// resources/js/diagram/modules-ai/ai-chat/VoiceOrb.js
// Esfera flotante que muestra que la IA escucha (o habla), con lo que va
// entendiendo. Mide el volumen del micrófono solo mientras está visible y con
// un analizador chico, para no gastar recursos en reposo.

const HIDE_DELAY_MS = 400;

export class VoiceOrb {
    constructor(agentName = 'Asistente') {
        this.agentName = agentName;
        this.state = 'idle';
        this.stream = null;
        this.audioContext = null;
        this.analyser = null;
        this.frame = null;
        this.hideTimer = null;

        this.el = document.createElement('div');
        this.el.className = 'voice-orb';
        this.el.setAttribute('role', 'status');
        this.el.setAttribute('aria-live', 'polite');
        this.el.hidden = true;
        this.el.innerHTML = `
            <div class="voice-orb-sphere" aria-hidden="true"><span></span><span></span><span></span></div>
            <div class="voice-orb-text">
                <strong class="voice-orb-title"></strong>
                <span class="voice-orb-transcript"></span>
            </div>
        `;
        document.body.appendChild(this.el);

        this.sphere = this.el.querySelector('.voice-orb-sphere');
        this.title = this.el.querySelector('.voice-orb-title');
        this.transcript = this.el.querySelector('.voice-orb-transcript');
    }

    setAgentName(name) {
        this.agentName = name;
    }

    update(state, { transcript = '' } = {}) {
        const visible = state === 'listening' || state === 'speaking';

        this.el.classList.toggle('is-speaking', state === 'speaking');
        this.title.textContent = state === 'speaking' ? `${this.agentName} está respondiendo` : 'Te escucho…';
        this.transcript.textContent = state === 'listening' ? transcript : '';

        if (visible) {
            clearTimeout(this.hideTimer);
            this.el.hidden = false;
            requestAnimationFrame(() => this.el.classList.add('is-visible'));
        } else if (!this.el.hidden) {
            this.el.classList.remove('is-visible');
            this.hideTimer = setTimeout(() => { this.el.hidden = true; }, HIDE_DELAY_MS);
        }

        if (state === 'listening' && this.state !== 'listening') this.startMeter();
        if (state !== 'listening' && this.state === 'listening') this.stopMeter();

        this.state = state;
    }

    async startMeter() {
        if (this.analyser || !navigator.mediaDevices?.getUserMedia) return;

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            if (this.state !== 'listening') {
                this.stopMeter();
                return;
            }

            this.audioContext = new AudioContext();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.audioContext.createMediaStreamSource(this.stream).connect(this.analyser);

            const samples = new Uint8Array(this.analyser.fftSize);
            const tick = () => {
                if (!this.analyser) return;

                this.analyser.getByteTimeDomainData(samples);
                let sum = 0;
                for (const value of samples) sum += (value - 128) ** 2;
                const level = Math.min(1, Math.sqrt(sum / samples.length) / 40);

                this.sphere.style.setProperty('--level', level.toFixed(2));
                this.frame = requestAnimationFrame(tick);
            };
            tick();
        } catch {
            // Sin acceso al volumen: la esfera sigue con su animación de reposo.
        }
    }

    stopMeter() {
        cancelAnimationFrame(this.frame);
        this.stream?.getTracks().forEach((track) => track.stop());
        this.audioContext?.close();
        this.stream = null;
        this.audioContext = null;
        this.analyser = null;
        this.sphere.style.setProperty('--level', '0');
    }
}
