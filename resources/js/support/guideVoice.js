// resources/js/support/guideVoice.js
// Voz del Guía: escucha una pregunta (un turno por vez, con el botón del
// micrófono) y lee en voz alta las respuestas. Usa la Web Speech API igual que
// Nova (Chrome y Edge). Comparte con Nova la voz y la velocidad que la persona
// eligió, pero tiene su propio "silenciar".
//
// Mientras el Guía escucha o habla, se pausa el modo manos libres de Nova para
// que los dos no compitan por el micrófono ni se respondan entre ellos.

import { splitForSpeech, pickDefaultVoice, whenVoicesReady } from '../diagram/modules-ai/ai-chat/VoiceAssistant.js';

const MUTED_KEY = 'guide-muted';

/**
 * Se escucha de corrido y se corta recién tras una pausa larga: con el modo de
 * una sola frase de Chrome, una pausa corta para pensar cortaba la pregunta.
 */
const SILENCE_AFTER_SPEECH_MS = 2500;
const SILENCE_BEFORE_SPEECH_MS = 10000;

function read(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
    try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ }
}

/** El controlador de voz de Nova, si estamos en el editor. */
function novaVoice() {
    return window.DiagramEditor?.instance?.aiChat?.voice || null;
}

export class GuideVoice {
    /**
     * @param {{ onState: (state: 'idle'|'listening'|'speaking', info?: {transcript?: string}) => void,
     *           onHeard: (text: string) => void,
     *           onError: (message: string) => void }} handlers
     */
    constructor({ onState, onHeard, onError }) {
        this.onState = onState;
        this.onHeard = onHeard;
        this.onError = onError;

        this.muted = read(MUTED_KEY) === '1';
        this.listening = false;
        this.speaking = false;
        this.queue = [];
        this.speakDone = null;
        this.keepAlive = null;
        this.pausedNova = false;
        this.heard = '';

        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = Recognition ? new Recognition() : null;

        if (this.recognition) {
            this.recognition.lang = 'es-ES';
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.onresult = (event) => this._onResult(event);
            this.recognition.onerror = (event) => this._onError(event);
            this.recognition.onend = () => this._onEnd();
        }
    }

    get canListen() { return !!this.recognition; }

    get canSpeak() { return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); }

    get isMuted() { return this.muted; }

    toggleMuted() {
        this.muted = !this.muted;
        write(MUTED_KEY, this.muted ? '1' : '0');
        if (this.muted) this.stopSpeaking();
        return this.muted;
    }

    // ==================== ESCUCHAR ====================

    listen() {
        if (!this.recognition) {
            this.onError('Para hablarme necesitas Chrome o Edge. Igual puedes escribirme abajo.');
            return;
        }
        if (this.listening) return;

        this.stopSpeaking();
        this._pauseNova();
        this.heard = '';
        this.listening = true;
        this.onState('listening', { transcript: '' });
        this._armSilence(SILENCE_BEFORE_SPEECH_MS);

        try {
            this.recognition.start();
        } catch {
            // Ya estaba iniciando: el resultado llega igual.
        }
    }

    /** Termina de escuchar si no se oye nada durante ese tiempo. */
    _armSilence(ms) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = setTimeout(() => this.stopListening(), ms);
    }

    stopListening() {
        clearTimeout(this.silenceTimer);
        if (!this.listening) return;
        try { this.recognition.stop(); } catch { /* ya detenido */ }
    }

    cancelListening() {
        clearTimeout(this.silenceTimer);
        if (!this.listening) return;
        this.heard = '';
        try { this.recognition.abort(); } catch { /* ya detenido */ }
    }

    _onResult(event) {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const text = event.results[i][0].transcript;
            if (event.results[i].isFinal) final += text;
            else interim += text;
        }

        if (final) this.heard = `${this.heard} ${final}`.trim();
        this.onState('listening', { transcript: `${this.heard} ${interim}`.trim() });

        // Mientras siga hablando (aunque sea un resultado parcial) se espera.
        if (final || interim) this._armSilence(SILENCE_AFTER_SPEECH_MS);
    }

    _onError(event) {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            this.onError('El navegador no me dio permiso para usar el micrófono. Puedes habilitarlo en el candado de la barra de direcciones.');
        } else if (event.error === 'network') {
            this.onError('El reconocimiento de voz del navegador necesita internet. Prueba de nuevo o escríbeme.');
        } else if (event.error === 'audio-capture') {
            this.onError('No encontré un micrófono conectado.');
        }
        // "no-speech" y "aborted": la persona no dijo nada o canceló; no es un error.
    }

    _onEnd() {
        clearTimeout(this.silenceTimer);
        this.listening = false;
        const text = this.heard.trim();
        this.heard = '';
        this.onState('idle');

        if (text) {
            this.onHeard(text);
        } else {
            this._resumeNova();
        }
    }

    // ==================== HABLAR ====================

    /** Lee el texto en voz alta. La promesa se resuelve al terminar (o al cortarse). */
    speak(text) {
        this.stopSpeaking();

        const clean = (text || '').replace(/[«»"“”]/g, '').trim();
        if (this.muted || !this.canSpeak || !clean) return Promise.resolve();

        this.queue = splitForSpeech(clean.slice(0, 1500));
        if (!this.queue.length) return Promise.resolve();

        this._pauseNova();
        novaVoice()?.cancelSpeech?.();

        this.speaking = true;
        this.onState('speaking');

        // Chrome corta las lecturas largas si no se las "despierta".
        this.keepAlive = setInterval(() => {
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.pause();
                window.speechSynthesis.resume();
            }
        }, 10000);

        const queue = this.queue;
        return new Promise((resolve) => {
            this.speakDone = resolve;
            whenVoicesReady().then(() => {
                // Si mientras se esperaban las voces se cortó o empezó otra lectura, no se habla.
                if (this.queue === queue && this.speaking) this._next();
            });
        });
    }

    _next() {
        const chunk = this.queue.shift();
        if (!chunk) {
            this._finishSpeaking();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(chunk);
        const voice = this._voice();
        utterance.lang = voice?.lang || 'es-ES';
        if (voice) utterance.voice = voice;
        utterance.rate = Number(read('agent-voice-rate')) || 1.05;
        utterance.onend = () => this._next();
        utterance.onerror = (event) => {
            if (event.error === 'interrupted' || event.error === 'canceled') return;
            this._next();
        };

        window.speechSynthesis.speak(utterance);
    }

    _voice() {
        const voices = (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang?.toLowerCase().startsWith('es'));
        const chosen = read('agent-voice');
        return voices.find((v) => v.name === chosen) || pickDefaultVoice(voices);
    }

    stopSpeaking() {
        if (!this.speaking) return;
        this.queue = [];
        window.speechSynthesis?.cancel();
        this._finishSpeaking();
    }

    _finishSpeaking() {
        clearInterval(this.keepAlive);
        this.speaking = false;
        const done = this.speakDone;
        this.speakDone = null;
        this.onState('idle');
        this._resumeNova();
        done?.();
    }

    // ==================== CONVIVENCIA CON NOVA ====================

    _pauseNova() {
        const nova = novaVoice();
        if (!this.pausedNova && nova?.isHandsFreeOn?.()) {
            nova.setHandsFree(false);
            this.pausedNova = true;
        }
    }

    _resumeNova() {
        if (!this.pausedNova || this.listening || this.speaking) return;
        this.pausedNova = false;
        novaVoice()?.setHandsFree?.(true);
    }
}
