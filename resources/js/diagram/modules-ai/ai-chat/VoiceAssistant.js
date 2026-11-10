// resources/js/diagram/modules-ai/ai-chat/VoiceAssistant.js
// Voz del asistente: dictado manual, modo manos libres con palabra de activación
// ("Nova", "ok Nova") y lectura en voz alta de las respuestas. Usa Web Speech
// API, disponible en Chrome y Edge; esos navegadores envían el audio a su
// servicio de reconocimiento mientras el micrófono está activo.

const HANDS_FREE_KEY = 'agent-hands-free';
const MUTED_KEY = 'agent-muted';
const VOICE_KEY = 'agent-voice';
const RATE_KEY = 'agent-voice-rate';

/** Tiempo para decir el pedido después de "Nova" a secas. */
const COMMAND_WINDOW_MS = 8000;

/** Chrome corta en seco las frases largas: se lee por partes de este tamaño. */
const MAX_CHUNK_CHARS = 180;
const MAX_SPOKEN_CHARS = 2000;

/** Voces masculinas en español que suelen venir con Windows, Chrome y Edge. */
const MALE_VOICE_HINT = /(alvaro|álvaro|jorge|pablo|raul|raúl|tomas|tomás|gonzalo|emilio|diego|andres|andrés|gerardo|enrique|lorenzo|alonso|arnau|dario|darío|teo|male|hombre)/i;

function readValue(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function writeValue(key, value) {
    try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ }
}

/** Minúsculas y sin acentos: "Nová," y "nova" deben coincidir. */
export function normalizeSpeech(text) {
    return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Busca la palabra de activación. Devuelve null si no está, o el texto que sigue
 * (vacío si solo dijeron el nombre).
 */
export function extractCommand(transcript, wakeWords) {
    const normalized = normalizeSpeech(transcript);
    const alternatives = wakeWords.map((word) => normalizeSpeech(word).replace(/[^a-z0-9]/g, '')).filter(Boolean).join('|');
    if (!alternatives) return null;

    const match = new RegExp(`(?:^|[^a-z0-9])(?:(?:ok|okay|oye|hey|hola)[\\s,]+)?(?:${alternatives})(?![a-z0-9])[\\s,.:;!?]*`).exec(normalized);
    if (!match) return null;

    const source = normalized.length === transcript.length ? transcript : normalized;
    return source.slice(match.index + match[0].length).trim();
}

/** Parte el texto en frases cortas, sin cortar palabras. */
export function splitForSpeech(text, maxChars = MAX_CHUNK_CHARS) {
    const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?;:\n]+[.!?;:]*/g) || [];
    const chunks = [];

    sentences.forEach((sentence) => {
        let rest = sentence.trim();

        while (rest.length > maxChars) {
            const cut = rest.lastIndexOf(' ', maxChars);
            const at = cut > 0 ? cut : maxChars;
            chunks.push(rest.slice(0, at).trim());
            rest = rest.slice(at).trim();
        }

        if (rest) chunks.push(rest);
    });

    return chunks;
}

/** La mejor voz disponible: primero las "naturales" (neuronales), y masculinas. */
export function pickDefaultVoice(voices) {
    const spanish = voices.filter((v) => v.lang?.toLowerCase().startsWith('es'));
    const score = (v) => (/natural|online|neural/i.test(v.name) ? 2 : 0) + (MALE_VOICE_HINT.test(v.name) ? 1 : 0);

    return [...spanish].sort((a, b) => score(b) - score(a))[0] || null;
}

export class VoiceAssistant {
    constructor({ onCommand, onState, onUnavailable }) {
        this.onCommand = onCommand;
        this.onState = onState;
        this.onUnavailable = onUnavailable;

        this.wakeWords = ['nova'];
        this.handsFree = false;
        this.manual = false;
        this.speaking = false;
        this.running = false;
        this.commandWindowUntil = 0;
        this.commandWindowTimer = null;
        this.interim = '';
        this.restartDelay = 300;
        this.reportedErrors = new Set();
        this.muted = readValue(MUTED_KEY) === '1';
        this.rate = Number(readValue(RATE_KEY)) || 1;
        this.voiceName = readValue(VOICE_KEY);
        this.speechQueue = [];
        this.keepAliveTimer = null;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = SpeechRecognition ? new SpeechRecognition() : null;

        if (this.recognition) {
            this.recognition.lang = 'es-ES';
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.onstart = () => { this.running = true; this.publishState(); };
            this.recognition.onend = () => this.handleEnd();
            this.recognition.onerror = (event) => this.handleError(event);
            this.recognition.onresult = (event) => this.handleResult(event);
        }

        // La lista de voces llega tarde en Chrome.
        window.speechSynthesis?.addEventListener?.('voiceschanged', () => this.onVoicesChanged?.());
    }

    configure(agent) {
        this.wakeWords = agent.wakeWords?.length ? agent.wakeWords : [agent.name];
    }

    isSupported() { return !!this.recognition; }

    isMuted() { return this.muted; }

    isHandsFreeOn() { return this.handsFree; }

    /** El navegador exige permiso de micrófono: solo se reactiva si ya lo había concedido. */
    async restoreHandsFree() {
        if (!this.recognition || readValue(HANDS_FREE_KEY) !== '1') return;

        try {
            const permission = await navigator.permissions?.query({ name: 'microphone' });
            if (permission?.state === 'granted') this.setHandsFree(true);
        } catch { /* el navegador no permite consultar el permiso */ }
    }

    toggleHandsFree() {
        if (!this.recognition) {
            this.onUnavailable('El reconocimiento de voz requiere Chrome o Edge.');
            return;
        }
        this.setHandsFree(!this.handsFree);
    }

    setHandsFree(enabled) {
        this.handsFree = enabled;
        writeValue(HANDS_FREE_KEY, enabled ? '1' : '0');

        if (enabled) {
            this.start();
        } else if (!this.manual) {
            this.stop();
        }
        this.publishState();
    }

    toggleManual() {
        if (!this.recognition) {
            this.onUnavailable('El reconocimiento de voz requiere Chrome o Edge.');
            return;
        }

        this.manual = !this.manual;

        if (this.manual) {
            this.openCommandWindow();
            this.start();
        } else {
            this.closeCommandWindow();
            if (!this.handsFree) this.stop();
        }
        this.publishState();
    }

    start() {
        if (!this.recognition || this.running || this.speaking) return;
        try { this.recognition.start(); } catch { /* ya estaba iniciando */ }
    }

    stop() {
        if (!this.recognition) return;
        try { this.recognition.stop(); } catch { /* ya estaba detenido */ }
    }

    /** Hay alguien hablándole a la IA ahora mismo (no solo esperando el nombre). */
    isCapturingCommand() {
        return this.manual || Date.now() < this.commandWindowUntil;
    }

    handleEnd() {
        this.running = false;

        // El navegador corta la escucha continua cada cierto tiempo.
        if ((this.handsFree || this.manual) && !this.speaking) {
            setTimeout(() => this.start(), this.restartDelay);
        }
        this.publishState();
    }

    /**
     * En manos libres el navegador reinicia la escucha seguido, y un corte de red
     * momentáneo no le importa a nadie: solo se avisa si alguien estaba dictando
     * un pedido, y una sola vez.
     */
    handleError(event) {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            this.handsFree = false;
            this.manual = false;
            writeValue(HANDS_FREE_KEY, '0');
            this.report('permiso', 'El navegador no dio permiso para usar el micrófono.');
        } else if (event.error === 'network') {
            this.restartDelay = Math.min(this.restartDelay * 2, 30000);

            if (this.isCapturingCommand()) {
                this.report('red', 'No se pudo entender el pedido: el dictado por voz del navegador necesita internet. Probá de nuevo o escribilo.');
                this.manual = false;
                this.closeCommandWindow();
            }
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
            console.error('VoiceAssistant: error de reconocimiento', event.error);
        }
        this.publishState();
    }

    report(kind, message) {
        if (this.reportedErrors.has(kind)) return;
        this.reportedErrors.add(kind);
        this.onUnavailable(message);
    }

    handleResult(event) {
        this.restartDelay = 300;
        this.reportedErrors.delete('red');

        let interim = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.trim();

            if (event.results[i].isFinal) {
                if (transcript) this.handleTranscript(transcript);
            } else {
                interim += transcript + ' ';
            }
        }

        this.interim = this.isCapturingCommand() ? interim.trim() : '';
        this.publishState();
    }

    handleTranscript(transcript) {
        if (this.manual) {
            this.manual = false;
            this.closeCommandWindow();
            if (!this.handsFree) this.stop();
            this.onCommand(transcript, 'voice');
            return;
        }

        if (Date.now() < this.commandWindowUntil) {
            this.closeCommandWindow();
            this.onCommand(transcript, 'wake');
            return;
        }

        const command = extractCommand(transcript, this.wakeWords);
        if (command === null) return;

        if (command) {
            this.onCommand(command, 'wake');
        } else {
            this.openCommandWindow();
        }
    }

    openCommandWindow() {
        this.commandWindowUntil = Date.now() + COMMAND_WINDOW_MS;
        clearTimeout(this.commandWindowTimer);
        this.commandWindowTimer = setTimeout(() => {
            this.closeCommandWindow();
            if (this.manual) {
                this.manual = false;
                if (!this.handsFree) this.stop();
            }
            this.publishState();
        }, COMMAND_WINDOW_MS);
    }

    closeCommandWindow() {
        this.commandWindowUntil = 0;
        this.interim = '';
        clearTimeout(this.commandWindowTimer);
    }

    /** idle: apagado. standby: esperando el nombre. listening: captando el pedido. speaking: la IA habla. */
    publishState() {
        let state = 'idle';
        if (this.speaking) state = 'speaking';
        else if (this.isCapturingCommand()) state = 'listening';
        else if (this.handsFree) state = 'standby';

        this.onState(state, { transcript: this.interim });
    }

    // ==================== LECTURA EN VOZ ALTA ====================

    voices() {
        return (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang?.toLowerCase().startsWith('es'));
    }

    currentVoice() {
        const voices = this.voices();
        return voices.find((v) => v.name === this.voiceName) || pickDefaultVoice(voices);
    }

    setVoice(name) {
        this.voiceName = name;
        writeValue(VOICE_KEY, name);
    }

    setRate(rate) {
        this.rate = rate;
        writeValue(RATE_KEY, String(rate));
    }

    toggleMuted() {
        this.muted = !this.muted;
        writeValue(MUTED_KEY, this.muted ? '1' : '0');
        if (this.muted) this.cancelSpeech();
        return this.muted;
    }

    speak(text, { force = false } = {}) {
        if ((this.muted && !force) || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;

        this.cancelSpeech();
        this.speechQueue = splitForSpeech(text.slice(0, MAX_SPOKEN_CHARS));
        if (this.speechQueue.length === 0) return;

        // Se deja de escuchar mientras habla, para que no se active con su propia voz.
        this.speaking = true;
        this.stop();
        this.publishState();

        // Chrome deja de hablar si una lectura dura más de unos 15 s: pausar y
        // reanudar lo mantiene vivo.
        this.keepAliveTimer = setInterval(() => {
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.pause();
                window.speechSynthesis.resume();
            }
        }, 10000);

        this.speakNext();
    }

    speakNext() {
        const chunk = this.speechQueue.shift();

        if (!chunk) {
            this.finishSpeaking();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(chunk);
        const voice = this.currentVoice();
        utterance.lang = voice?.lang || 'es-ES';
        if (voice) utterance.voice = voice;
        utterance.rate = this.rate;

        utterance.onend = () => this.speakNext();
        utterance.onerror = (event) => {
            if (event.error !== 'interrupted' && event.error !== 'canceled') this.speakNext();
        };

        window.speechSynthesis.speak(utterance);
    }

    cancelSpeech() {
        this.speechQueue = [];
        clearInterval(this.keepAliveTimer);
        window.speechSynthesis?.cancel();
        if (this.speaking) this.finishSpeaking();
    }

    finishSpeaking() {
        clearInterval(this.keepAliveTimer);
        this.speaking = false;
        this.publishState();
        if (this.handsFree || this.manual) this.start();
    }
}
