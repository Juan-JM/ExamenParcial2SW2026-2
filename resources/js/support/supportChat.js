// resources/js/support/supportChat.js
// Widget de "Ayuda", con dos formas de ayudar:
// - Preguntas frecuentes con texto fijo (supportChatContent.js).
// - Un asistente con IA que responde preguntas libres según lo que la persona
//   tiene en pantalla (pageSnapshot.js → HelpController → HelpAssistant).
// Las dos pueden mostrar una "guía visual": oscurece la pantalla y señala un
// botón real. No edita el diagrama ni toca JointJS o Livewire: solo lee la
// pantalla y, como mucho, simula un clic (por ejemplo, abrir la pestaña
// "Asistente IA" antes de señalar el micrófono). Si algo no existe en ese
// momento, avisa con un mensaje en vez de romper.

import { SUPPORT_CONTENT } from './supportChatContent.js';
import { capturePage, findByKey } from './pageSnapshot.js';

function findFirst(selectors) {
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return null;
}

class SupportGuide {
    constructor() {
        this.box = null;
        this.tooltip = null;
        this.target = null;
        this._reposition = this._reposition.bind(this);
        this._onKeydown = this._onKeydown.bind(this);
    }

    get isActive() {
        return !!this.box;
    }

    show(target, tooltipText) {
        this.dismiss();
        this.target = target;

        this.box = document.createElement('div');
        this.box.className = 'sc-spotlight-box';

        this.tooltip = document.createElement('div');
        this.tooltip.className = 'sc-spotlight-tooltip';
        this.tooltip.innerHTML = `
            <span class="sc-spotlight-tooltip-text"></span>
            <button type="button" class="sc-spotlight-dismiss">Descartar guía</button>
        `;
        this.tooltip.querySelector('.sc-spotlight-tooltip-text').textContent = tooltipText;
        this.tooltip.querySelector('.sc-spotlight-dismiss').addEventListener('click', () => this.dismiss());

        document.body.appendChild(this.box);
        document.body.appendChild(this.tooltip);

        this._reposition();

        window.addEventListener('resize', this._reposition);
        window.addEventListener('scroll', this._reposition, true);
        document.addEventListener('keydown', this._onKeydown);

        // Si el usuario efectivamente hace clic en el elemento señalado,
        // la guía cumplió su propósito: se retira sola.
        this._onTargetClick = () => this.dismiss();
        this.target.addEventListener('click', this._onTargetClick, { once: true });
    }

    _reposition() {
        if (!this.box || !this.target || !document.body.contains(this.target)) {
            this.dismiss();
            return;
        }

        const rect = this.target.getBoundingClientRect();
        const pad = 6;

        this.box.style.top = `${rect.top - pad}px`;
        this.box.style.left = `${rect.left - pad}px`;
        this.box.style.width = `${rect.width + pad * 2}px`;
        this.box.style.height = `${rect.height + pad * 2}px`;

        const tooltipRect = this.tooltip.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const showBelow = spaceBelow > tooltipRect.height + 20;

        let top = showBelow ? rect.bottom + 14 : rect.top - tooltipRect.height - 14;
        top = Math.max(8, Math.min(top, window.innerHeight - tooltipRect.height - 8));

        let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));

        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;
    }

    _onKeydown(e) {
        if (e.key === 'Escape') this.dismiss();
    }

    dismiss() {
        if (this._onTargetClick && this.target) {
            this.target.removeEventListener('click', this._onTargetClick);
        }
        this._onTargetClick = null;
        this.target = null;

        window.removeEventListener('resize', this._reposition);
        window.removeEventListener('scroll', this._reposition, true);
        document.removeEventListener('keydown', this._onKeydown);

        this.box?.remove();
        this.tooltip?.remove();
        this.box = null;
        this.tooltip = null;
    }
}

class SupportChatWidget {
    constructor(context) {
        this.context = context;
        this.items = SUPPORT_CONTENT[context] || [];
        this.guide = new SupportGuide();
        this.isOpen = false;
        this._build();
    }

    _build() {
        this.panel = document.createElement('div');
        this.panel.className = 'sc-panel';
        this.panel.style.display = 'none';
        this.panel.innerHTML = `
            <div class="sc-panel-header">
                <span class="sc-panel-title">Ayuda</span>
                <button type="button" class="sc-panel-close" aria-label="Cerrar">×</button>
            </div>
            <div class="sc-panel-body" aria-live="polite"></div>
            <form class="sc-ask">
                <textarea class="sc-ask-input" rows="1" maxlength="500" placeholder="Preguntame cómo hacer algo aquí…" aria-label="Pregunta para el asistente de ayuda"></textarea>
                <button type="submit" class="sc-ask-send">Preguntar</button>
            </form>
        `;
        document.body.appendChild(this.panel);

        this.body = this.panel.querySelector('.sc-panel-body');
        this.askInput = this.panel.querySelector('.sc-ask-input');
        this.askButton = this.panel.querySelector('.sc-ask-send');
        this.panel.querySelector('.sc-panel-close').addEventListener('click', () => this.close());
        this.panel.querySelector('.sc-ask').addEventListener('submit', (event) => {
            event.preventDefault();
            this._ask(this.askInput.value);
        });
        this.askInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                this._ask(this.askInput.value);
            }
        });

        this._listenForAnswers();
        this._renderMenu();
    }

    // ==================== ASISTENTE DE AYUDA (IA) ====================

    /** La respuesta llega en vivo por el canal privado; si no llega, se consulta. */
    _listenForAnswers() {
        this.pending = new Map(); // id -> { bubble, timer }
        const userId = document.querySelector('meta[name="user-id"]')?.content;

        if (window.Echo && userId) {
            try {
                window.Echo.private(`help.${userId}`).listen('.HelpAnswered', (event) => this._showAnswer(event.help));
            } catch (error) {
                console.warn('Ayuda: sin canal en vivo, se consultará la respuesta', error);
            }
        }
    }

    async _ask(text) {
        const question = (text || '').trim();
        if (!question || this.askButton.disabled) return;

        this.askInput.value = '';
        this._clearMenu();
        this.body.appendChild(this._bubble('user', question));
        const waiting = this._bubble('bot', 'Mirando tu pantalla…');
        waiting.classList.add('sc-bubble-waiting');
        this.body.appendChild(waiting);
        this._scroll();

        this.askButton.disabled = true;

        try {
            const response = await fetch('/help/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content || '',
                },
                body: JSON.stringify({ question, page: capturePage(this.context) }),
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const { help } = await response.json();
            this.pending.set(help.id, { bubble: waiting, polls: 0 });
            this._poll(help.id);
        } catch (error) {
            console.error('Ayuda: no se pudo enviar la pregunta', error);
            waiting.textContent = 'No pude enviar tu pregunta. Revisá tu conexión e intentá de nuevo.';
            waiting.classList.remove('sc-bubble-waiting');
            this.askButton.disabled = false;
        }
    }

    _poll(id) {
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
            if (entry.polls < 40) {
                this._poll(id);
            } else {
                this._showAnswer({ id, status: 'failed', answer: 'El asistente tardó demasiado. Revisá que la cola esté corriendo (composer run dev).', steps: [] });
            }
        }, 3000);
    }

    _showAnswer(help) {
        const entry = this.pending.get(help.id);
        if (!entry) return;

        clearTimeout(entry.timer);
        this.pending.delete(help.id);
        this.askButton.disabled = false;

        const bubble = entry.bubble;
        bubble.classList.remove('sc-bubble-waiting');
        bubble.textContent = help.answer || '';

        if (help.steps?.length) {
            const list = document.createElement('ol');
            list.className = 'sc-steps';
            help.steps.forEach((step) => {
                const item = document.createElement('li');
                item.textContent = step;
                list.appendChild(item);
            });
            bubble.appendChild(list);
        }

        const target = findByKey(help.highlight);
        if (target) {
            const show = document.createElement('button');
            show.type = 'button';
            show.className = 'sc-guide-btn';
            show.textContent = 'Mostrarme dónde';
            show.addEventListener('click', () => {
                this.close();
                this.guide.show(target, help.steps?.[0] || help.answer);
            });
            this.body.appendChild(show);
        }

        this._scroll();
    }

    /** Las preguntas frecuentes se esconden al empezar a conversar, sin perderse. */
    _clearMenu() {
        this.body.querySelectorAll('.sc-question-list, .sc-answer-actions').forEach((el) => el.remove());
        if (!this.body.querySelector('.sc-faq-link')) {
            const back = document.createElement('button');
            back.type = 'button';
            back.className = 'sc-back-btn sc-faq-link';
            back.textContent = 'Ver preguntas frecuentes';
            back.addEventListener('click', () => this._renderMenu());
            this.body.prepend(back);
        }
    }

    _scroll() {
        this.body.scrollTop = this.body.scrollHeight;
    }

    open() {
        this.isOpen = true;
        this.panel.style.display = 'flex';
    }

    close() {
        this.isOpen = false;
        this.panel.style.display = 'none';
        this.guide.dismiss();
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    _bubble(role, text) {
        const div = document.createElement('div');
        div.className = `sc-bubble sc-bubble-${role}`;
        div.textContent = text;
        return div;
    }

    _renderMenu() {
        this.body.innerHTML = '';

        this.body.appendChild(this._bubble('bot', 'Escribime abajo qué querés hacer y te guío según lo que tenés en pantalla, o elegí una pregunta frecuente:'));

        const list = document.createElement('div');
        list.className = 'sc-question-list';
        this.items.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sc-question-btn';
            btn.textContent = item.question;
            btn.addEventListener('click', () => this._renderAnswer(item));
            list.appendChild(btn);
        });
        this.body.appendChild(list);
    }

    _renderAnswer(item) {
        this.body.innerHTML = '';

        this.body.appendChild(this._bubble('user', item.question));
        this.body.appendChild(this._bubble('bot', item.answer));

        const actions = document.createElement('div');
        actions.className = 'sc-answer-actions';

        if (item.guide) {
            const showBtn = document.createElement('button');
            showBtn.type = 'button';
            showBtn.className = 'sc-guide-btn';
            showBtn.textContent = 'Mostrarme dónde';
            showBtn.addEventListener('click', () => this._runGuide(item.guide));
            actions.appendChild(showBtn);
        }

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'sc-back-btn';
        backBtn.textContent = '← Volver al menú';
        backBtn.addEventListener('click', () => this._renderMenu());
        actions.appendChild(backBtn);

        this.body.appendChild(actions);
    }

    _runGuide(guide) {
        if (guide.beforeShow) {
            document.querySelector(guide.beforeShow)?.click();
        }

        // Pequeña espera para que el DOM reaccione (ej. cambio de pestaña)
        // antes de buscar el elemento a señalar.
        setTimeout(() => {
            const target = findFirst(guide.selectors);
            if (!target) {
                this.body.appendChild(
                    this._bubble('bot', guide.fallback || 'No encontré ese elemento en pantalla ahora mismo.')
                );
                return;
            }

            // Cerramos el panel para no tapar lo que se está señalando;
            // la guía tiene su propio botón "Descartar guía" para salir.
            this.close();
            this.guide.show(target, guide.tooltip);
        }, guide.beforeShow ? 120 : 0);
    }
}

export function initSupportChat() {
    const buttons = document.querySelectorAll('[data-support-context]');
    if (!buttons.length) return;

    // Un widget por contexto detectado (normalmente hay un solo botón
    // visible por página: dashboard usa "dashboard", el editor usa "editor").
    const widgets = new Map();

    buttons.forEach((btn) => {
        const context = btn.getAttribute('data-support-context');
        if (!SUPPORT_CONTENT[context]) return;

        btn.addEventListener('click', () => {
            let widget = widgets.get(context);
            if (!widget) {
                widget = new SupportChatWidget(context);
                widgets.set(context, widget);
            }
            widget.toggle();
        });
    });
}
