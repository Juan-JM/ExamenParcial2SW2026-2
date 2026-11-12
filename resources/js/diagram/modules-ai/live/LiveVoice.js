// resources/js/diagram/modules-ai/live/LiveVoice.js
// Habla y escucha con el servicio local de voz (voice-service/): Whisper para
// entender y Piper para hablar. La respuesta se parte en frases y se va pidiendo
// el audio de la siguiente mientras suena la actual, así empieza a hablar en
// cuanto está lista la primera. Si el servicio no responde, habla con la voz del
// navegador para no quedarse mudo.

import { splitForSpeech, pickDefaultVoice, whenVoicesReady } from '../ai-chat/VoiceAssistant.js';
import { forSpeech } from './turns.js';

const MAX_SPOKEN_CHARS = 1500;
const PREFETCH_AHEAD = 2;
const DUCKED_GAIN = 0.12;

/** Si el navegador no está en localhost, el servicio de voz está en la misma máquina que la página. */
export function resolveServiceUrl(configured) {
    try {
        const url = new URL(configured || 'http://127.0.0.1:8770');
        const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
        if (!local) url.hostname = window.location.hostname;
        return url.toString().replace(/\/$/, '');
    } catch {
        return 'http://127.0.0.1:8770';
    }
}

export class LiveVoice {
    constructor({ serviceUrl, onSpeakingChange }) {
        this.baseUrl = resolveServiceUrl(serviceUrl);
        this.onSpeakingChange = onSpeakingChange;

        this.context = null;
        this.gain = null;
        this.analyser = null;
        this.samples = null;
        this.session = null;
        this.sequence = 0;
        this.speaking = false;
        this.serviceOk = null; // null: sin probar
    }

    /** Hay que llamarlo desde un gesto del usuario (clic): los navegadores no dejan sonar antes. */
    async unlock() {
        if (!this.context) {
            this.context = new AudioContext();
            this.gain = this.context.createGain();
            this.analyser = this.context.createAnalyser();
            this.analyser.fftSize = 512;
            this.samples = new Uint8Array(this.analyser.fftSize);
            this.gain.connect(this.analyser).connect(this.context.destination);
        }
        if (this.context.state === 'suspended') await this.context.resume();
    }

    async health() {
        try {
            const response = await fetch(`${this.baseUrl}/health`, { cache: 'no-store' });
            this.serviceOk = response.ok ? await response.json() : false;
        } catch {
            this.serviceOk = false;
        }
        return this.serviceOk;
    }

    // ==================== ESCUCHAR ====================

    /** PCM de 16 kHz (Int16) -> texto. Devuelve '' si no se entendió nada. */
    async transcribe(pcm, signal) {
        const response = await fetch(`${this.baseUrl}/stt?sr=16000&lang=es`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
            signal,
        });
        if (!response.ok) throw new Error(`El servicio de voz respondió ${response.status}`);

        this.serviceOk = this.serviceOk || true;
        return ((await response.json()).text || '').trim();
    }

    // ==================== HABLAR ====================

    /** Nivel de salida 0..1, para animar la esfera mientras Nova habla. */
    get level() {
        if (!this.analyser || !this.speaking) return 0;

        this.analyser.getByteTimeDomainData(this.samples);
        let sum = 0;
        for (let i = 0; i < this.samples.length; i++) {
            const v = (this.samples[i] - 128) / 128;
            sum += v * v;
        }
        return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
    }

    /** Baja el volumen mientras se confirma si el usuario está interrumpiendo. */
    duck(on) {
        if (!this.gain) return;
        this.gain.gain.setTargetAtTime(on ? DUCKED_GAIN : 1, this.context.currentTime, 0.04);
    }

    /**
     * Dice un texto. Reemplaza lo que estuviera diciendo.
     * Devuelve una promesa que se resuelve con `{ completed, spokenMs }`.
     */
    speak(text, { onProgress, onChunk } = {}) {
        this.stop();

        const chunks = splitForSpeech(forSpeech(text).slice(0, MAX_SPOKEN_CHARS));
        if (chunks.length === 0) return Promise.resolve({ completed: true, spokenMs: 0 });

        const session = {
            id: ++this.sequence,
            chunks,
            audio: chunks.map(() => null),
            stopped: false,
            spokenMs: 0,
            onProgress,
            onChunk,
            source: null,
        };
        this.session = session;
        this.duck(false);

        return this.run(session);
    }

    /** Suma algo al final de lo que se está diciendo (o lo dice si no hay nada). */
    append(text) {
        const chunks = splitForSpeech(forSpeech(text));
        if (chunks.length === 0) return Promise.resolve({ completed: true, spokenMs: 0 });

        if (!this.session || this.session.stopped) return this.speak(text);

        this.session.chunks.push(...chunks);
        chunks.forEach(() => this.session.audio.push(null));

        return this.session.finished;
    }

    stop() {
        const session = this.session;
        if (!session) return;

        session.stopped = true;
        try { session.source?.stop(); } catch { /* ya había terminado */ }
        window.speechSynthesis?.cancel();
        this.session = null;
        this.setSpeaking(false);
        session.resolve?.({ completed: false, spokenMs: session.spokenMs });
    }

    get isSpeaking() { return this.speaking; }

    setSpeaking(value) {
        if (this.speaking === value) return;
        this.speaking = value;
        this.onSpeakingChange?.(value);
    }

    run(session) {
        session.finished = new Promise((resolve) => { session.resolve = resolve; });

        (async () => {
            for (let i = 0; i < session.chunks.length; i++) {
                if (session.stopped) return;

                for (let ahead = i; ahead <= i + PREFETCH_AHEAD && ahead < session.chunks.length; ahead++) this.prefetch(session, ahead);

                let buffer = null;
                try {
                    buffer = await session.audio[i];
                } catch {
                    this.serviceOk = false;
                }
                if (session.stopped) return;

                this.setSpeaking(true);
                session.onChunk?.(session.chunks[i]);
                const startedAt = performance.now();

                if (buffer) await this.play(session, buffer);
                else await this.speakWithBrowser(session, session.chunks[i]);

                if (session.stopped) return;
                session.spokenMs += performance.now() - startedAt;
                session.onProgress?.({ spokenMs: session.spokenMs, index: i, total: session.chunks.length });
            }

            if (this.session === session) this.session = null;
            this.setSpeaking(false);
            session.resolve({ completed: true, spokenMs: session.spokenMs });
        })();

        return session.finished;
    }

    prefetch(session, index) {
        if (session.audio[index]) return;

        const request = fetch(`${this.baseUrl}/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: session.chunks[index], speed: 1.0 }),
        })
            .then((response) => {
                if (!response.ok) throw new Error(`TTS ${response.status}`);
                return response.arrayBuffer();
            })
            .then((bytes) => this.context.decodeAudioData(bytes));

        // Si se cortó la lectura antes de llegar a esta frase, el error no le importa a nadie.
        request.catch(() => {});
        session.audio[index] = request;
    }

    play(session, buffer) {
        return new Promise((resolve) => {
            const source = this.context.createBufferSource();
            source.buffer = buffer;
            source.connect(this.gain);
            source.onended = resolve;
            session.source = source;
            source.start();
        });
    }

    /** Respaldo: la voz del navegador, si el servicio local de voz no está. */
    async speakWithBrowser(session, text) {
        const synth = window.speechSynthesis;
        if (!synth || !window.SpeechSynthesisUtterance) return;

        await whenVoicesReady();
        await new Promise((resolve) => {
            const utterance = new SpeechSynthesisUtterance(text);
            const voice = pickDefaultVoice(synth.getVoices());
            utterance.lang = voice?.lang || 'es-ES';
            if (voice) utterance.voice = voice;
            utterance.onend = resolve;
            utterance.onerror = resolve;
            synth.speak(utterance);
        });
    }
}
