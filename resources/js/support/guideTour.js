// resources/js/support/guideTour.js
// Recorrido guiado: oscurece la pantalla, deja a la vista el botón o sección
// de cada paso y el Tutor lo explica (en voz alta y en una tarjeta al lado).
// Señala TODOS los pasos, no solo el primero: cuando la persona toca el botón
// resaltado, pasa sola al siguiente y busca el próximo elemento (que puede
// recién aparecer, como la opción de un menú que se acaba de abrir).
//
// Nunca bloquea la app: el oscurecido no recibe clics (pointer-events: none),
// así que la persona toca el botón real. Se sale con "×", con Esc, o al terminar.

const FIND_RETRY_MS = 150;
const FIND_TIMEOUT_MS = 1800;
const ADVANCE_DELAY_MS = 550;
const PAD = 6;

import { bringIntoView } from './pageSnapshot.js';

export const BOT_ICON = `
<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M16 4.5v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle cx="16" cy="3.6" r="1.8" fill="currentColor"/>
    <rect x="5.5" y="8.5" width="21" height="16" rx="6" stroke="currentColor" stroke-width="2"/>
    <path d="M3 14.5v5M29 14.5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle class="sc-bot-eye" cx="12" cy="16" r="2.1" fill="currentColor"/>
    <circle class="sc-bot-eye" cx="20" cy="16" r="2.1" fill="currentColor"/>
    <path d="M12.5 20.6c2 1.3 5 1.3 7 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M11 28.5h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

export class GuideTour {
    /**
     * @param {{ speak: (text: string) => Promise<void>, stopSpeaking: () => void, onEnd?: (finished: boolean) => void }} options
     */
    constructor({ name = 'Tutor', speak, stopSpeaking, onEnd }) {
        this.name = name;
        this.speak = speak;
        this.stopSpeaking = stopSpeaking;
        this.onEnd = onEnd;

        this.steps = [];
        this.index = -1;
        this.target = null;
        this.frame = null;
        this.findTimer = null;
        this.advanceTimer = null;

        this._onDocClick = this._onDocClick.bind(this);
        this._onKeydown = this._onKeydown.bind(this);
        this._loop = this._loop.bind(this);
    }

    get isActive() {
        return this.index >= 0;
    }

    /**
     * @param {Array<{ text: string, resolve?: () => Element|null }>} steps
     * @param {{ intro?: string }} options  "intro" se dice antes del primer paso.
     */
    /** offset: pasos ya hechos en la página anterior, para contar "Paso 2 de 2". */
    start(steps, { intro = '', offset = 0 } = {}) {
        this.offset = offset;
        this.end(false, { silent: true });
        if (!steps.length) return;

        this.steps = steps.map((step) => ({ ...step, text: step.text || intro }));
        this.intro = steps[0].text ? intro : '';

        this._build();
        document.addEventListener('click', this._onDocClick, true);
        document.addEventListener('keydown', this._onKeydown);
        this.frame = requestAnimationFrame(this._loop);

        this._go(0);
    }

    _build() {
        this.dim = document.createElement('div');
        this.dim.className = 'sc-tour-dim';

        this.box = document.createElement('div');
        this.box.className = 'sc-tour-spot';
        this.box.hidden = true;

        this.card = document.createElement('div');
        this.card.className = 'sc-tour-card';
        this.card.setAttribute('role', 'dialog');
        this.card.setAttribute('aria-live', 'polite');
        this.card.innerHTML = `
            <div class="sc-tour-head">
                <span class="sc-tour-avatar">${BOT_ICON}</span>
                <span class="sc-tour-who"><strong>${this.name}</strong><small class="sc-tour-count"></small></span>
                <button type="button" class="sc-tour-close" aria-label="Terminar la explicación" title="Terminar (Esc)">×</button>
            </div>
            <p class="sc-tour-text"></p>
            <p class="sc-tour-hint"></p>
            <div class="sc-tour-actions">
                <button type="button" class="sc-tour-replay" title="Repetir en voz alta">Repetir</button>
                <span class="sc-tour-spacer"></span>
                <button type="button" class="sc-tour-prev">Atrás</button>
                <button type="button" class="sc-tour-next">Siguiente</button>
            </div>
        `;

        this.card.querySelector('.sc-tour-close').addEventListener('click', () => this.end(false));
        this.card.querySelector('.sc-tour-prev').addEventListener('click', () => this._go(this.index - 1));
        this.card.querySelector('.sc-tour-next').addEventListener('click', () => this._next());
        this.card.querySelector('.sc-tour-replay').addEventListener('click', () => this.speak(this.steps[this.index].text));

        document.body.append(this.dim, this.box, this.card);
    }

    _go(index) {
        if (index < 0 || index >= this.steps.length) return;

        clearTimeout(this.findTimer);
        clearTimeout(this.advanceTimer);
        this.index = index;
        this.target = null;
        this.pendingAdvance = false;

        const step = this.steps[index];
        const last = index === this.steps.length - 1;

        this.card.querySelector('.sc-tour-text').textContent = step.text;
        this.card.querySelector('.sc-tour-count').textContent = this.offset + this.steps.length > 1 ? `Paso ${this.offset + index + 1} de ${this.offset + this.steps.length}` : 'Te muestro dónde está';
        this.card.querySelector('.sc-tour-prev').hidden = index === 0;
        this.card.querySelector('.sc-tour-next').textContent = last ? 'Ya entendí' : 'Siguiente';
        this.card.classList.remove('is-entering');
        void this.card.offsetWidth;
        this.card.classList.add('is-entering');

        const spoken = index === 0 && this.intro ? `${this.intro} ${step.text}` : step.text;
        this.speak(spoken);

        this._find(step, Date.now());
    }

    /** El elemento puede tardar en aparecer (menú abriéndose, cambio de pestaña). */
    _find(step, startedAt) {
        const el = step.resolve?.() || null;

        if (el) {
            this._setTarget(el);
            return;
        }

        this._setTarget(null);
        if (step.resolve && Date.now() - startedAt < FIND_TIMEOUT_MS) {
            this.findTimer = setTimeout(() => this._find(step, startedAt), FIND_RETRY_MS);
        }
    }

    _setTarget(el) {
        this.target = el;
        const hint = this.card.querySelector('.sc-tour-hint');

        if (el) {
            bringIntoView(el);
            const step = this.steps[this.index];
            const last = this.index === this.steps.length - 1;
            if (!step?.look) hint.textContent = 'Tócalo tú y seguimos con lo que sigue.';
            else hint.textContent = last ? '' : 'Cuando lo ubiques, toca Siguiente.';
        } else {
            hint.textContent = '';
        }

        this.box.hidden = !el;
        this.dim.classList.toggle('is-solid', !el);
        this.card.classList.toggle('is-centered', !el);
        this._position();
    }

    _loop() {
        if (!this.isActive) return;

        // Livewire puede re-dibujar el botón: se vuelve a buscar el nuevo.
        if (this.target && !document.body.contains(this.target)) {
            const step = this.steps[this.index];
            this._setTarget(step.resolve?.() || null);
        }

        this._position();
        this.frame = requestAnimationFrame(this._loop);
    }

    _position() {
        if (!this.card) return;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const cardRect = this.card.getBoundingClientRect();

        if (!this.target) {
            this.card.style.left = `${Math.max(12, (vw - cardRect.width) / 2)}px`;
            this.card.style.top = `${Math.max(12, (vh - cardRect.height) / 2)}px`;
            return;
        }

        const rect = this.target.getBoundingClientRect();
        Object.assign(this.box.style, {
            top: `${rect.top - PAD}px`,
            left: `${rect.left - PAD}px`,
            width: `${rect.width + PAD * 2}px`,
            height: `${rect.height + PAD * 2}px`,
        });

        // Debajo, arriba, a la derecha o a la izquierda: donde entre.
        const gap = 16;
        const fits = {
            below: vh - rect.bottom - gap >= cardRect.height,
            above: rect.top - gap >= cardRect.height,
            right: vw - rect.right - gap >= cardRect.width,
            left: rect.left - gap >= cardRect.width,
        };

        let top;
        let left;
        if (fits.below || fits.above) {
            top = fits.below ? rect.bottom + gap : rect.top - gap - cardRect.height;
            left = rect.left + rect.width / 2 - cardRect.width / 2;
        } else if (fits.right || fits.left) {
            left = fits.right ? rect.right + gap : rect.left - gap - cardRect.width;
            top = rect.top + rect.height / 2 - cardRect.height / 2;
        } else {
            top = vh - cardRect.height - 12;
            left = 12;
        }

        this.card.style.left = `${Math.max(12, Math.min(left, vw - cardRect.width - 12))}px`;
        this.card.style.top = `${Math.max(12, Math.min(top, vh - cardRect.height - 12))}px`;
    }

    _onDocClick(event) {
        if (!this.target || this.card.contains(event.target)) return;
        if (!this.target.contains(event.target)) return;

        // Tocó lo que se le señaló: se deja reaccionar a la app y se sigue.
        this.pendingAdvance = true;
        this.stopSpeaking();
        clearTimeout(this.advanceTimer);
        this.advanceTimer = setTimeout(() => this._next(true), ADVANCE_DELAY_MS);
    }

    _next(byClick = false) {
        if (this.index >= this.steps.length - 1) {
            this.end(true, { silent: !byClick });
            return;
        }
        this._go(this.index + 1);
    }

    /**
     * Pasos que faltan, para seguir el recorrido en otra página (el botón
     * señalado era un enlace). Si ya tocó el actual, se arranca del siguiente.
     */
    remaining() {
        if (!this.isActive) return [];
        const from = this.index + (this.pendingAdvance ? 1 : 0);
        return this.steps.slice(from).map((step, i) => ({ text: step.text, target: step.target || null, look: !!step.look, number: this.offset + from + i }));
    }

    _onKeydown(event) {
        if (event.key === 'Escape') this.end(false);
    }

    /**
     * @param {boolean} finished  true si llegó al final del recorrido.
     * @param {{ silent?: boolean }} options  silent: no decir "listo" al terminar.
     */
    end(finished = false, { silent = false } = {}) {
        if (!this.isActive) return;

        clearTimeout(this.findTimer);
        clearTimeout(this.advanceTimer);
        cancelAnimationFrame(this.frame);
        document.removeEventListener('click', this._onDocClick, true);
        document.removeEventListener('keydown', this._onKeydown);

        this.dim?.remove();
        this.box?.remove();
        this.card?.remove();
        this.dim = this.box = this.card = null;
        this.target = null;
        this.index = -1;

        this.stopSpeaking();
        if (finished && !silent) this.speak('¡Listo, ya lo tienes! Si te surge otra duda, aquí estoy.');

        this.onEnd?.(finished);
    }
}
