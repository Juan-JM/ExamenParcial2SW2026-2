// resources/js/support/supportChat.js
// "Tutor": el asistente con IA que enseña a usar la aplicación. Botón flotante
// con un bot abajo a la derecha; se le habla por voz o por escrito, responde en
// voz alta y hace un recorrido por la pantalla señalando cada botón.
//
// - Preguntas libres: pageSnapshot.js describe la pantalla → HelpController →
//   HelpAssistant (modelo local) → respuesta con pasos, cada uno con su botón.
// - Sugerencias rápidas con texto fijo (supportChatContent.js), sin IA.
//
// La conversación, el panel abierto, una respuesta en camino y el recorrido en
// curso sobreviven al cambio de página (sessionStorage): ir del editor a
// "Mis Diagramas" no corta la charla.
//
// Solo enseña: nunca edita el diagrama ni toca JointJS o Livewire. Lo único que
// hace sobre la página es, en algunas sugerencias fijas, simular el clic que la
// persona haría (por ejemplo, abrir la pestaña "Asistente IA" para señalar el
// micrófono). Si algo no existe en ese momento, lo dice en vez de romper.

import { SUPPORT_CONTENT } from './supportChatContent.js';
import { capturePage, findByKey, findVisibleByLabel, isVisible } from './pageSnapshot.js';
import { GuideVoice } from './guideVoice.js';
import { GuideTour, BOT_ICON } from './guideTour.js';

/** Nombre visible del asistente. Cambiarlo acá y en HelpAssistant::system(). */
export const TUTOR_NAME = 'Tutor';

const HISTORY_TURNS = 4;
const MAX_SAVED_MESSAGES = 40;
const POLL_MS = 3000;
const MAX_POLLS = 40;
const STATE_KEY = 'tutor-state';
const RESUME_KEY = 'tutor-tour-resume';
const RESUME_MAX_AGE_MS = 30000;

const ICONS = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/></svg>',
    muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" fill="currentColor"/></svg>',
};

const STATUS_TEXT = {
    idle: 'Te enseño a usar la aplicación',
    listening: 'Te escucho…',
    thinking: 'Mirando tu pantalla…',
    speaking: 'Hablando…',
};

const GREETING = `Hola, soy tu ${TUTOR_NAME}. Cuéntame qué quieres aprender a hacer y te lo enseño paso a paso, aquí mismo en tu pantalla.`;

function findFirst(selectors) {
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) return el;
    }
    return null;
}

function findFaq(id) {
    for (const items of Object.values(SUPPORT_CONTENT)) {
        const item = items.find((candidate) => candidate.id === id);
        if (item) return item;
    }
    return null;
}

function readJson(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}

function writeJson(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
}

class TutorAssistant {
    constructor(context) {
        this.context = context;
        this.items = SUPPORT_CONTENT[context] || [];
        this.isOpen = false;
        this.thinking = false;
        this.voiceState = 'idle';
        this.lastWasVoice = false;

        // Conversación: lo que se dibuja y lo que se guarda entre páginas.
        // Un mensaje: { role, text, steps?: [{text, target, highlight}], intro?, faq?, live? }
        this.messages = [];
        this.history = [];
        this.pending = new Map(); // id -> { bubble, timer, polls, question }

        this.voice = new GuideVoice({
            onState: (state, info) => this._onVoiceState(state, info),
            onHeard: (text) => this._ask(text, { voice: true }),
            onError: (message) => this._say(message),
        });

        this.tour = new GuideTour({
            name: TUTOR_NAME,
            speak: (text) => this.voice.speak(text),
            stopSpeaking: () => this.voice.stopSpeaking(),
            onEnd: () => this._renderState(),
        });

        this._buildFab();
        this._buildPanel();
        this._listenForAnswers();

        window.addEventListener('pagehide', () => this._saveState());
        this._restoreState();
        this._renderState();
    }

    // ==================== ENTRE PÁGINAS ====================

    _saveState() {
        writeJson(STATE_KEY, {
            messages: this.messages.slice(-MAX_SAVED_MESSAGES).map(({ live, ...message }) => message),
            history: this.history,
            open: this.isOpen,
            pending: [...this.pending.entries()].map(([id, entry]) => ({ id, question: entry.question })),
            lastWasVoice: this.lastWasVoice,
        });

        // Si el paso señalado era un enlace a otra pantalla, el recorrido sigue allá.
        const steps = this.tour.remaining();
        if (steps.length) writeJson(RESUME_KEY, { at: Date.now(), steps });
    }

    _restoreState() {
        const saved = readJson(STATE_KEY);
        const tour = readJson(RESUME_KEY);
        try { sessionStorage.removeItem(RESUME_KEY); } catch { /* sin almacenamiento */ }

        if (saved) {
            this.messages = Array.isArray(saved.messages) ? saved.messages : [];
            this.history = Array.isArray(saved.history) ? saved.history : [];
            this.lastWasVoice = !!saved.lastWasVoice;
            this.messages.forEach((message) => this.body.appendChild(this._renderMessage(message)));

            // Una respuesta que estaba en camino se sigue esperando en esta página.
            (saved.pending || []).forEach(({ id, question }) => {
                const bubble = this._typingBubble();
                this.body.appendChild(bubble);
                this.pending.set(id, { bubble, polls: 0, question });
                this.thinking = true;
                this._poll(id, 300);
            });
        }

        const resumeTour = tour?.steps?.length && Date.now() - tour.at < RESUME_MAX_AGE_MS;

        if (resumeTour) {
            const steps = tour.steps.map((step) => ({
                text: step.text,
                target: step.target,
                look: step.look,
                resolve: () => (step.target ? findVisibleByLabel(step.target) : null),
            }));
            // Se deja terminar de dibujar la página nueva antes de buscar el botón.
            setTimeout(() => this._startTour(steps, '', tour.steps[0].number || 0), 500);
        } else if (saved?.open) {
            this.open({ quiet: true });
        }

        this._scroll();
    }

    _push(message) {
        this.messages.push({ ...message, live: true });
        if (this.messages.length > MAX_SAVED_MESSAGES) this.messages.shift();
        const bubble = this._renderMessage(this.messages[this.messages.length - 1]);
        this.body.appendChild(bubble);
        this._scroll();
        return bubble;
    }

    // ==================== INTERFAZ ====================

    _buildFab() {
        this.fab = document.createElement('button');
        this.fab.type = 'button';
        this.fab.className = 'sc-fab';
        this.fab.setAttribute('aria-label', `Abrir ${TUTOR_NAME}: aprende a usar la aplicación con IA`);
        this.fab.innerHTML = `
            <span class="sc-fab-ring" aria-hidden="true"></span>
            <span class="sc-fab-face">${BOT_ICON}</span>
            <span class="sc-fab-badge" aria-hidden="true">${ICONS.spark}IA</span>
            <span class="sc-fab-label">${TUTOR_NAME} IA · aprende a usar la app</span>
        `;
        this.fab.addEventListener('click', () => this.toggle());
        document.body.appendChild(this.fab);
        document.body.classList.add('has-sc-fab');
    }

    _buildPanel() {
        this.panel = document.createElement('section');
        this.panel.className = 'sc-panel';
        this.panel.hidden = true;
        this.panel.setAttribute('aria-label', `${TUTOR_NAME}, te enseña a usar la aplicación`);
        this.panel.innerHTML = `
            <header class="sc-head">
                <span class="sc-head-avatar">${BOT_ICON}</span>
                <div class="sc-head-text">
                    <strong>${TUTOR_NAME} <span class="sc-head-tag">IA</span></strong>
                    <small class="sc-head-status"></small>
                </div>
                <button type="button" class="sc-icon-btn sc-reset" aria-label="Empezar una conversación nueva" title="Conversación nueva">${ICONS.reset}</button>
                <button type="button" class="sc-icon-btn sc-mute" aria-pressed="false"></button>
                <button type="button" class="sc-icon-btn sc-close" aria-label="Cerrar" title="Cerrar">${ICONS.close}</button>
            </header>
            <div class="sc-body" aria-live="polite"></div>
            <div class="sc-suggest">
                <button type="button" class="sc-suggest-toggle" aria-expanded="false">Sugerencias</button>
                <div class="sc-chips" hidden></div>
            </div>
            <form class="sc-compose">
                <button type="button" class="sc-mic" title="Hablar"></button>
                <textarea class="sc-input" rows="1" maxlength="500" placeholder="¿Qué quieres aprender? Escribe o toca el micrófono…" aria-label="Pregunta para el ${TUTOR_NAME}"></textarea>
                <button type="submit" class="sc-send" aria-label="Enviar" title="Enviar">${ICONS.send}</button>
            </form>
            <p class="sc-foot">Solo te enseño: no cambio nada de tu diagrama.</p>
        `;
        document.body.appendChild(this.panel);

        this.body = this.panel.querySelector('.sc-body');
        this.status = this.panel.querySelector('.sc-head-status');
        this.input = this.panel.querySelector('.sc-input');
        this.sendBtn = this.panel.querySelector('.sc-send');
        this.micBtn = this.panel.querySelector('.sc-mic');
        this.muteBtn = this.panel.querySelector('.sc-mute');
        this.chips = this.panel.querySelector('.sc-chips');
        this.chipsToggle = this.panel.querySelector('.sc-suggest-toggle');

        this.panel.querySelector('.sc-close').addEventListener('click', () => this.close());
        this.panel.querySelector('.sc-reset').addEventListener('click', () => this.reset());
        this.panel.querySelector('.sc-compose').addEventListener('submit', (event) => {
            event.preventDefault();
            this._ask(this.input.value);
        });
        this.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                this._ask(this.input.value);
            }
        });
        this.input.addEventListener('input', () => this._autosize());
        this.micBtn.addEventListener('click', () => this._toggleMic());
        this.muteBtn.addEventListener('click', () => {
            this.voice.toggleMuted();
            this._renderState();
        });
        this.chipsToggle.addEventListener('click', () => this._toggleChips());
        this.panel.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') this.close();
        });

        this._renderChips();
        if (!this.voice.canListen) this.micBtn.classList.add('is-unavailable');
    }

    _renderChips() {
        this.chips.innerHTML = '';
        this.items.forEach((item) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'sc-chip';
            chip.textContent = item.question;
            chip.addEventListener('click', () => {
                this._toggleChips(false);
                this._answerFaq(item);
            });
            this.chips.appendChild(chip);
        });
        this.panel.querySelector('.sc-suggest').hidden = this.items.length === 0;
    }

    _toggleChips(force) {
        const show = force ?? this.chips.hidden;
        this.chips.hidden = !show;
        this.chipsToggle.setAttribute('aria-expanded', String(show));
    }

    _autosize() {
        this.input.style.height = 'auto';
        this.input.style.height = `${Math.min(this.input.scrollHeight, 96)}px`;
    }

    _renderState() {
        let state = 'idle';
        if (this.voiceState === 'listening') state = 'listening';
        else if (this.voiceState === 'speaking') state = 'speaking';
        else if (this.thinking) state = 'thinking';

        this.fab.dataset.state = state;
        this.panel.dataset.state = state;
        this.fab.classList.toggle('is-open', this.isOpen);
        this.fab.classList.toggle('is-touring', this.tour.isActive);
        this.status.textContent = STATUS_TEXT[state];

        const listening = state === 'listening';
        this.micBtn.innerHTML = listening ? ICONS.stop : ICONS.mic;
        this.micBtn.classList.toggle('is-listening', listening);
        this.micBtn.setAttribute('aria-label', listening ? 'Dejar de escuchar' : `Hablarle al ${TUTOR_NAME}`);
        this.sendBtn.disabled = this.thinking;

        const muted = this.voice.isMuted;
        this.muteBtn.innerHTML = muted ? ICONS.muted : ICONS.sound;
        this.muteBtn.setAttribute('aria-pressed', String(muted));
        this.muteBtn.title = muted ? 'Activar la voz' : 'Silenciar la voz';
        this.muteBtn.setAttribute('aria-label', this.muteBtn.title);
    }

    _onVoiceState(state, info = {}) {
        this.voiceState = state;
        if (state === 'listening') {
            this.input.value = info.transcript || '';
            this.input.placeholder = 'Te escucho, habla con calma…';
            this._autosize();
        } else {
            this.input.placeholder = '¿Qué quieres aprender? Escribe o toca el micrófono…';
        }
        this._renderState();
    }

    _toggleMic() {
        if (this.voice.listening) {
            this.voice.stopListening();
            return;
        }
        if (this.thinking) return;
        this.tour.end(false, { silent: true });
        this.voice.listen();
    }

    /** @param {{ quiet?: boolean }} options  quiet: al volver de otra página, sin saludar ni robar el foco. */
    open({ quiet = false } = {}) {
        this.isOpen = true;
        this.panel.hidden = false;
        requestAnimationFrame(() => this.panel.classList.add('is-visible'));

        if (!this.messages.length) {
            this._push({ role: 'bot', text: GREETING });
            this.voice.speak(GREETING);
        }

        this._renderState();
        this._scroll();
        if (!quiet && !this.voice.listening) this.input.focus({ preventScroll: true });
    }

    close() {
        this.isOpen = false;
        this.panel.classList.remove('is-visible');
        this.panel.hidden = true;
        this.voice.cancelListening();
        this._renderState();
    }

    /**
     * Conversación nueva: borra los mensajes, lo que recuerda la IA de esta
     * charla y lo guardado para otras páginas, y corta lo que esté en curso.
     */
    reset() {
        this.tour.end(false, { silent: true });
        this.voice.cancelListening();
        this.voice.stopSpeaking();

        this.pending.forEach((entry) => clearTimeout(entry.timer));
        this.pending.clear();
        this.thinking = false;
        this.lastWasVoice = false;

        this.messages = [];
        this.history = [];
        this.body.innerHTML = '';
        this.input.value = '';
        this._autosize();

        try {
            sessionStorage.removeItem(STATE_KEY);
            sessionStorage.removeItem(RESUME_KEY);
        } catch { /* sin almacenamiento */ }

        this._push({ role: 'bot', text: GREETING });
        this._renderState();
        this.input.focus({ preventScroll: true });
    }

    /** El panel se esconde durante el recorrido para no tapar lo que se señala. */
    _hideForTour() {
        this.panel.classList.remove('is-visible');
        this.panel.hidden = true;
        this.isOpen = false;
    }

    toggle() {
        // Con un recorrido en curso, tocar el bot lo corta y vuelve a la charla.
        if (this.tour.isActive) {
            this.tour.end(false, { silent: true });
            this.open();
            return;
        }
        if (this.isOpen) this.close();
        else this.open();
    }

    _renderMessage(message) {
        const div = document.createElement('div');
        div.className = `sc-bubble sc-bubble-${message.role}`;

        if (message.text) {
            const p = document.createElement('p');
            p.textContent = message.text;
            div.appendChild(p);
        }

        const listed = (message.steps || []).filter((step) => step.text);
        if (listed.length) {
            const list = document.createElement('ol');
            list.className = 'sc-steps';
            listed.forEach((step) => {
                const li = document.createElement('li');
                li.textContent = step.text;
                list.appendChild(li);
            });
            div.appendChild(list);
        }

        if (message.steps?.length || message.faq) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sc-replay';
            btn.textContent = 'Enséñame de nuevo';
            btn.addEventListener('click', () => this._replay(message));
            div.appendChild(btn);
        }

        return div;
    }

    _replay(message) {
        if (message.faq) {
            const item = findFaq(message.faq);
            if (item) this._runFaqGuide(item);
            return;
        }
        this._startTour(this._tourSteps(message), message.intro || '');
    }

    _typingBubble() {
        const bubble = document.createElement('div');
        bubble.className = 'sc-bubble sc-bubble-bot sc-bubble-typing';
        bubble.innerHTML = '<span class="sc-dots"><i></i><i></i><i></i></span>';
        return bubble;
    }

    _say(text) {
        if (!this.isOpen && !this.tour.isActive) this.open();
        this._push({ role: 'bot', text });
        this.voice.speak(text);
    }

    _scroll() {
        this.body.scrollTop = this.body.scrollHeight;
    }

    // ==================== PREGUNTAS AL TUTOR (IA) ====================

    /** La respuesta llega en vivo por el canal privado; si no llega, se consulta. */
    _listenForAnswers() {
        const userId = document.querySelector('meta[name="user-id"]')?.content;
        if (!window.Echo || !userId) return;

        try {
            window.Echo.private(`help.${userId}`).listen('.HelpAnswered', (event) => this._showAnswer(event.help));
        } catch (error) {
            console.warn('Tutor: sin canal en vivo, se consultará la respuesta', error);
        }
    }

    async _ask(text, { voice = false } = {}) {
        const question = (text || '').trim();
        if (!question || this.thinking) return;

        if (!this.isOpen) this.open();
        this.lastWasVoice = voice;
        this.input.value = '';
        this._autosize();
        this.tour.end(false, { silent: true });
        this.voice.stopSpeaking();

        this._push({ role: 'user', text: question });
        const waiting = this._typingBubble();
        this.body.appendChild(waiting);
        this._scroll();

        this.thinking = true;
        this._renderState();

        try {
            const response = await fetch('/help/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content || '',
                },
                body: JSON.stringify({
                    question,
                    page: capturePage(this.context),
                    history: this.history.slice(-HISTORY_TURNS),
                }),
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const { help } = await response.json();
            this.pending.set(help.id, { bubble: waiting, polls: 0, question });
            this._poll(help.id);
        } catch (error) {
            console.error('Tutor: no se pudo enviar la pregunta', error);
            waiting.remove();
            this.thinking = false;
            this._renderState();
            this._say('No pude enviar tu pregunta. Revisa tu conexión e inténtalo de nuevo.');
        }
    }

    _poll(id, delay = POLL_MS) {
        const entry = this.pending.get(id);
        if (!entry) return;

        entry.timer = setTimeout(async () => {
            if (!this.pending.has(id)) return;

            try {
                const response = await fetch(`/help/${id}`, { headers: { Accept: 'application/json' } });
                const { help } = await response.json();
                if (help.status !== 'pending') {
                    this._showAnswer(help);
                    return;
                }
            } catch {
                // Se reintenta abajo.
            }

            entry.polls++;
            if (entry.polls < MAX_POLLS) {
                this._poll(id);
            } else {
                this._showAnswer({ id, status: 'failed', answer: 'Estoy tardando demasiado. Revisa que la cola esté corriendo (composer run dev).', steps: [] });
            }
        }, delay);
    }

    _showAnswer(help) {
        const entry = this.pending.get(help.id);
        if (!entry) return;

        clearTimeout(entry.timer);
        this.pending.delete(help.id);
        this.thinking = this.pending.size > 0;
        entry.bubble.remove();

        const answer = help.answer || '';
        const steps = this._normalizeSteps(help);
        const message = { role: 'bot', text: answer, steps, intro: answer };
        this._push(message);

        if (help.status !== 'failed') {
            const said = [answer, ...steps.filter((s) => s.text).map((s) => s.text)].join(' ');
            this.history.push({ q: entry.question, a: said.slice(0, 1500) });
            this.history = this.history.slice(-HISTORY_TURNS);
        }

        this._renderState();

        if (steps.length) {
            this._startTour(this._tourSteps(this.messages[this.messages.length - 1]), answer);
            return;
        }

        this.voice.speak(answer).then(() => this._continueConversation());
    }

    /** Acepta el formato nuevo ({text, highlight, target}) y el anterior (texto suelto). */
    _normalizeSteps(help) {
        const steps = (help.steps || []).map((step) => (typeof step === 'string'
            ? { text: step, highlight: null, target: null }
            : { text: step.text || '', highlight: step.highlight || null, target: step.target || null, look: !!step.look }));

        if (steps.length && !steps[0].highlight && help.highlight) steps[0].highlight = help.highlight;
        if (!steps.length && help.highlight) steps.push({ text: '', highlight: help.highlight, target: null });

        return steps;
    }

    /**
     * Las claves de elementos (h12…) solo valen en la página donde se hizo la
     * pregunta; un mensaje que viene de otra página se señala por el texto.
     */
    _tourSteps(message) {
        return (message.steps || []).map((step) => ({
            text: step.text,
            target: step.target,
            look: step.look,
            resolve: () => {
                if (message.live && step.highlight) {
                    const byKey = findByKey(step.highlight);
                    if (byKey && isVisible(byKey)) return byKey;
                }
                return step.target ? findVisibleByLabel(step.target) : null;
            },
        }));
    }

    _startTour(steps, intro, offset = 0) {
        if (!steps.length) return;
        this._hideForTour();
        this.tour.start(steps, { intro, offset });
        this._renderState();
    }

    /** Si la persona habló, después de responder se la vuelve a escuchar: charla fluida. */
    _continueConversation() {
        if (this.lastWasVoice && this.isOpen && !this.thinking && !this.tour.isActive && this.voice.canListen) {
            this.voice.listen();
        }
    }

    // ==================== SUGERENCIAS FIJAS (sin IA) ====================

    _answerFaq(item) {
        this.lastWasVoice = false;
        this.tour.end(false, { silent: true });
        this._push({ role: 'user', text: item.question });
        this._push({ role: 'bot', text: item.answer, faq: item.guide ? item.id : undefined });

        if (item.guide) this._runFaqGuide(item);
        else this.voice.speak(item.answer);
    }

    _runFaqGuide(item) {
        const { guide } = item;
        // Si ya está abierto (un botón conmutador con aria-pressed="true", como
        // el de Nova en el riel), no se vuelve a clicar: eso lo cerraría.
        const opener = guide.beforeShow ? document.querySelector(guide.beforeShow) : null;
        if (opener && opener.getAttribute('aria-pressed') !== 'true') opener.click();

        setTimeout(() => {
            if (!findFirst(guide.selectors)) {
                this._say(guide.fallback || 'Ahora mismo no veo ese botón en tu pantalla.');
                return;
            }
            this._startTour([
                { text: guide.tooltip, resolve: () => findFirst(guide.selectors) },
                ...(guide.next || []).map((step) => ({
                    text: step.tooltip,
                    target: step.target,
                    resolve: () => findVisibleByLabel(step.target),
                })),
            ], item.answer);
        }, guide.beforeShow ? 160 : 0);
    }
}

/**
 * Crea el botón flotante del Tutor en las páginas que lo piden con un
 * elemento `[data-support-context]` (dashboard o editor).
 */
export function initSupportChat() {
    const marker = document.querySelector('[data-support-context]');
    const context = marker?.getAttribute('data-support-context');
    if (!context || !SUPPORT_CONTENT[context] || window.__tutorAssistant) return;

    window.__tutorAssistant = new TutorAssistant(context);
}
