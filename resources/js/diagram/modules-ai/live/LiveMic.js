// resources/js/diagram/modules-ai/live/LiveMic.js
// Micrófono siempre abierto con detección de voz (VAD) propia. Corta el audio en
// frases: empieza cuando alguien habla, termina tras una pausa, y entrega el PCM
// de 16 kHz que entiende Whisper. Mientras Nova habla sube el umbral para no
// activarse con su propia voz (además de la cancelación de eco del navegador).

const TARGET_RATE = 16000;
const FRAME = 512; // 32 ms a 16 kHz

/** Pausa que cierra una frase. Más corta = más ágil, pero corta a quien piensa. */
const END_SILENCE_MS = 750;
const MAX_SEGMENT_MS = 25000;
const MIN_SEGMENT_MS = 300;
/** Voz seguida antes de dar por empezada una frase, y antes de confirmar una interrupción. */
const START_MS = 96;
const SUSTAIN_MS = 380;
const PREROLL_MS = 320;

const MIN_THRESHOLD = 0.014;
const NOISE_FLOOR_MIN = 0.002;
const NOISE_FLOOR_MAX = 0.05;

const WORKLET = `
class Tap extends AudioWorkletProcessor {
    constructor() { super(); this.buf = new Float32Array(${FRAME}); this.n = 0; }
    process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (!ch) return true;
        for (let i = 0; i < ch.length; i++) {
            this.buf[this.n++] = ch[i];
            if (this.n === ${FRAME}) { this.port.postMessage(this.buf.slice()); this.n = 0; }
        }
        return true;
    }
}
registerProcessor('pcm-tap', Tap);
`;

export class LiveMic {
    /**
     * @param {object} handlers
     * @param {() => void} handlers.onSpeechStart  alguien empezó a hablar
     * @param {() => void} handlers.onSpeechSustained  lleva hablando lo bastante como para no ser un ruido
     * @param {(pcm: Int16Array, ms: number) => void} handlers.onSegment  frase completa
     * @param {() => void} handlers.onSegmentDiscarded  se activó pero era demasiado corto
     */
    constructor(handlers) {
        this.handlers = handlers;
        this.stream = null;
        this.context = null;
        this.muted = false;
        this.strict = false;
        this.level = 0; // 0..1, para animar la esfera

        this.noiseFloor = 0.006;
        this.reset();
    }

    reset() {
        this.inSpeech = false;
        this.voiceRun = 0;
        this.silenceMs = 0;
        this.segmentMs = 0;
        this.sustained = false;
        this.frames = [];
        this.preroll = [];
    }

    isSupported() {
        return !!(navigator.mediaDevices?.getUserMedia && window.AudioContext && window.AudioWorkletNode);
    }

    get isRunning() { return !!this.context; }

    get isSpeaking() { return this.inSpeech; }

    async start() {
        if (this.context) return;

        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });

        try {
            this.context = new AudioContext({ sampleRate: TARGET_RATE });
        } catch {
            this.context = new AudioContext(); // el navegador no acepta 16 kHz: se remuestrea abajo
        }

        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        try {
            await this.context.audioWorklet.addModule(url);
        } finally {
            URL.revokeObjectURL(url);
        }

        const source = this.context.createMediaStreamSource(this.stream);
        this.node = new AudioWorkletNode(this.context, 'pcm-tap');
        this.node.port.onmessage = (event) => this.process(event.data);

        // El nodo solo corre si está conectado a la salida; con ganancia 0 no suena nada.
        const silent = this.context.createGain();
        silent.gain.value = 0;
        source.connect(this.node).connect(silent).connect(this.context.destination);

        this.rateRatio = this.context.sampleRate / TARGET_RATE;
        if (this.context.state === 'suspended') await this.context.resume();
    }

    stop() {
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
        this.node?.disconnect();
        this.node = null;
        this.context?.close().catch(() => {});
        this.context = null;
        this.reset();
        this.level = 0;
    }

    setMuted(muted) {
        this.muted = muted;
        if (muted) {
            this.reset();
            this.level = 0;
        }
    }

    /** Mientras Nova habla: umbral más alto para no oírse a sí misma. */
    setStrict(strict) {
        this.strict = strict;
    }

    process(raw) {
        if (this.muted) return;

        const frame = this.rateRatio > 1.01 ? this.downsample(raw) : raw;
        let sum = 0;
        for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
        const rms = Math.sqrt(sum / frame.length);

        // El suelo de ruido sigue al ambiente solo cuando nadie habla.
        if (!this.inSpeech) {
            this.noiseFloor = Math.min(NOISE_FLOOR_MAX, Math.max(NOISE_FLOOR_MIN, this.noiseFloor * 0.985 + rms * 0.015));
        }

        const on = Math.max(MIN_THRESHOLD, this.noiseFloor * 3.2) * (this.strict ? 1.9 : 1);
        const off = on * 0.55;
        const frameMs = (frame.length / TARGET_RATE) * 1000;

        this.level += (Math.min(1, rms * 9) - this.level) * 0.35;

        if (!this.inSpeech) {
            this.preroll.push(frame);
            // ~320 ms de lo anterior: el comienzo de la palabra ya pasó cuando se detecta la voz.
            while (this.preroll.length > 1 && this.preroll.length * frameMs > PREROLL_MS) this.preroll.shift();

            this.voiceRun = rms > on ? this.voiceRun + frameMs : 0;
            if (this.voiceRun >= START_MS) {
                this.inSpeech = true;
                this.sustained = false;
                this.silenceMs = 0;
                this.segmentMs = this.preroll.length * frameMs;
                this.frames = [...this.preroll];
                this.preroll = [];
                this.handlers.onSpeechStart?.();
            }
            return;
        }

        this.frames.push(frame);
        this.segmentMs += frameMs;
        this.silenceMs = rms < off ? this.silenceMs + frameMs : 0;

        if (!this.sustained && this.segmentMs - this.silenceMs >= SUSTAIN_MS) {
            this.sustained = true;
            this.handlers.onSpeechSustained?.();
        }

        if (this.silenceMs >= END_SILENCE_MS || this.segmentMs >= MAX_SEGMENT_MS) this.finish();
    }

    finish() {
        const frames = this.frames;
        const silenceMs = this.silenceMs;
        const speechMs = this.segmentMs - silenceMs;
        this.reset();

        if (speechMs < MIN_SEGMENT_MS) {
            this.handlers.onSegmentDiscarded?.();
            return;
        }

        // Del silencio final se deja un poco (Whisper lo agradece) y se quita el resto.
        let trimMs = Math.max(0, silenceMs - 200);
        const kept = [...frames];
        while (kept.length > 1 && trimMs > 0) {
            const dropped = kept.pop();
            trimMs -= (dropped.length / TARGET_RATE) * 1000;
        }

        const pcm = new Int16Array(kept.reduce((total, frame) => total + frame.length, 0));
        let offset = 0;
        kept.forEach((frame) => {
            for (let i = 0; i < frame.length; i++) pcm[offset++] = Math.max(-1, Math.min(1, frame[i])) * 0x7fff;
        });

        this.handlers.onSegment?.(pcm, speechMs);
    }

    /** Decimación simple: suficiente para voz cuando el navegador no da 16 kHz. */
    downsample(input) {
        const out = new Float32Array(Math.floor(input.length / this.rateRatio));
        for (let i = 0; i < out.length; i++) {
            const start = Math.floor(i * this.rateRatio);
            const end = Math.min(input.length, Math.floor((i + 1) * this.rateRatio));
            let acc = 0;
            for (let j = start; j < end; j++) acc += input[j];
            out[i] = acc / Math.max(1, end - start);
        }
        return out;
    }
}
