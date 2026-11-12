// resources/js/diagram/modules-ai/live/LivePanel.js
// Interfaz de "Nova en vivo": esfera, subtítulo de lo que se dice, aviso de turno,
// charla del equipo y controles. Solo dibuja y avisa por callbacks; no sabe nada de
// audio ni de red. Todo el texto entra con textContent.

import { LiveOrb } from './LiveOrb.js';

const MODE_LABELS = {
    off: 'Apagada',
    idle: 'Te escucho',
    capturing: 'Escuchando…',
    transcribing: 'Entendiendo…',
    thinking: 'Pensando…',
    speaking: 'Hablando',
    waiting: 'En espera',
};

const LISTEN_OPTIONS = [
    ['mine', 'Solo mis respuestas'],
    ['all', 'Todas las respuestas'],
    ['others', 'Solo las de los demás'],
    ['none', 'Ninguna (solo leer)'],
];

const ICONS = {
    mic: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M9 5.2V6a3 3 0 0 1 5.6 1.5M15 11v.5a3 3 0 0 1-4.7 2.5M5.5 11a6.5 6.5 0 0 0 10.6 5M18.5 11a6.4 6.4 0 0 1-.4 2.2M12 17.5V21"/></svg>',
    min: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    ear: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5a6 6 0 1 1 12 0c0 3-2.5 3.8-2.5 6a3 3 0 0 1-5.7 1.2M9.5 9.5a2.5 2.5 0 0 1 5 0"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

export class LivePanel {
    /**
     * @param {object} callbacks onMicToggle, onAmbientToggle, onListenMode(mode),
     *   onSend(text), onMinimize, onExpand, onEnd
     * @param {() => number} levelProvider volumen actual (0..1) para la esfera
     */
    constructor(callbacks, levelProvider) {
        this.callbacks = callbacks;
        this.messages = new Map();
        this.mode = 'off';
        this.caption = '';

        this.root = el('aside', 'nova-live');
        this.root.id = 'nova-live';
        this.root.hidden = true;
        this.root.dataset.mode = 'off';
        this.root.setAttribute('aria-label', 'Conversación por voz con Nova');
        this.build();
        document.body.appendChild(this.root);

        this.orb = new LiveOrb(this.canvas, levelProvider);
    }

    build() {
        const head = el('header', 'nl-head');
        const title = el('div', 'nl-title');
        this.dot = el('span', 'nl-dot');
        this.nameEl = el('strong', 'nl-name', 'Nova');
        this.statusEl = el('span', 'nl-status', MODE_LABELS.off);
        title.append(this.dot, this.nameEl, this.statusEl);

        const actions = el('div', 'nl-actions');
        this.minBtn = this.iconButton(ICONS.min, 'Minimizar (sigue escuchando)', () => this.callbacks.onMinimize?.());
        this.endBtn = this.iconButton(ICONS.close, 'Terminar la conversación', () => this.callbacks.onEnd?.());
        actions.append(this.minBtn, this.endBtn);
        head.append(title, actions);

        const stage = el('section', 'nl-stage');
        this.canvas = el('canvas', 'nl-orb');
        this.canvas.setAttribute('aria-hidden', 'true');
        this.canvas.addEventListener('click', () => { if (this.root.classList.contains('is-mini')) this.callbacks.onExpand?.(); });
        this.captionEl = el('p', 'nl-caption');
        this.captionEl.setAttribute('aria-live', 'polite');
        this.floorEl = el('p', 'nl-floor');
        this.floorEl.hidden = true;
        stage.append(this.canvas, this.captionEl, this.floorEl);

        this.warnEl = el('p', 'nl-warn');
        this.warnEl.hidden = true;

        this.feed = el('div', 'nl-feed');
        this.feed.setAttribute('role', 'log');
        this.feed.setAttribute('aria-live', 'off');
        this.emptyEl = el('p', 'nl-empty', 'Aquí aparece lo que se conversa. Di “Nova” y pregúntale lo que quieras.');
        this.feed.appendChild(this.emptyEl);

        const controls = el('div', 'nl-controls');
        this.micBtn = el('button', 'nl-mic');
        this.micBtn.type = 'button';
        this.micBtn.addEventListener('click', () => this.callbacks.onMicToggle?.());

        const side = el('div', 'nl-toggles');
        this.ambientBtn = el('button', 'nl-chip');
        this.ambientBtn.type = 'button';
        this.ambientBtn.innerHTML = `${ICONS.ear}<span>Escucha de fondo</span>`;
        this.ambientBtn.title = 'Guarda un rato lo que el equipo conversa (sin que sea para Nova) para darle contexto';
        this.ambientBtn.addEventListener('click', () => this.callbacks.onAmbientToggle?.());

        const speakerWrap = el('label', 'nl-chip nl-select');
        speakerWrap.innerHTML = ICONS.speaker;
        this.listenSelect = el('select');
        this.listenSelect.setAttribute('aria-label', 'Qué respuestas se escuchan en voz alta');
        LISTEN_OPTIONS.forEach(([value, label]) => this.listenSelect.appendChild(new Option(label, value)));
        this.listenSelect.addEventListener('change', () => this.callbacks.onListenMode?.(this.listenSelect.value));
        speakerWrap.appendChild(this.listenSelect);

        side.append(this.ambientBtn, speakerWrap);
        controls.append(this.micBtn, side);

        const compose = el('form', 'nl-compose');
        this.input = el('input');
        this.input.type = 'text';
        this.input.placeholder = 'O escríbele a Nova…';
        this.input.maxLength = 600;
        this.input.autocomplete = 'off';
        const send = el('button');
        send.type = 'submit';
        send.title = 'Enviar';
        send.innerHTML = ICONS.send;
        compose.append(this.input, send);
        compose.addEventListener('submit', (event) => {
            event.preventDefault();
            const text = this.input.value.trim();
            if (!text) return;
            this.input.value = '';
            this.callbacks.onSend?.(text);
        });

        this.root.append(head, stage, this.warnEl, this.feed, controls, compose);
    }

    iconButton(svg, label, onClick) {
        const button = el('button', 'nl-icon-btn');
        button.type = 'button';
        button.innerHTML = svg;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', onClick);
        return button;
    }

    // ==================== ESTADO ====================

    setAgentName(name) {
        this.nameEl.textContent = name;
    }

    show({ mini = false } = {}) {
        this.root.hidden = false;
        this.setMini(mini);
        requestAnimationFrame(() => {
            this.root.classList.add('is-visible');
            this.orb.resize();
            this.orb.start();
        });
    }

    hide() {
        this.root.classList.remove('is-visible');
        this.orb.stop();
        this.root.hidden = true;
    }

    setMini(mini) {
        this.root.classList.toggle('is-mini', mini);
        requestAnimationFrame(() => this.orb.resize());
        if (!mini) this.scrollToEnd();
    }

    setMode(mode, label = null) {
        this.mode = mode;
        this.root.dataset.mode = mode;
        this.statusEl.textContent = label || MODE_LABELS[mode] || '';
        // La esfera no distingue "entendiendo" de "pensando".
        this.orb.setMode(mode === 'transcribing' ? 'thinking' : mode);
    }

    setCaption(text, who = 'me') {
        this.captionEl.textContent = text || '';
        this.captionEl.dataset.who = who;
        this.captionEl.classList.toggle('is-empty', !text);
    }

    setFloor(text) {
        this.floorEl.hidden = !text;
        this.floorEl.textContent = text || '';
    }

    setMuted(muted) {
        this.micBtn.classList.toggle('is-muted', muted);
        this.micBtn.innerHTML = muted ? ICONS.micOff : ICONS.mic;
        this.micBtn.setAttribute('aria-pressed', String(muted));
        this.micBtn.title = muted ? 'Activar el micrófono' : 'Silenciar el micrófono';
        this.micBtn.setAttribute('aria-label', this.micBtn.title);
    }

    setAmbient(on) {
        this.ambientBtn.classList.toggle('is-on', on);
        this.ambientBtn.setAttribute('aria-pressed', String(on));
    }

    setListenMode(mode) {
        this.listenSelect.value = mode;
    }

    /** Aviso fijo (servicio de voz apagado, sin permiso de micrófono…). */
    setWarning(text) {
        this.warnEl.hidden = !text;
        this.warnEl.textContent = text || '';
    }

    // ==================== CHARLA ====================

    renderAll(messages) {
        this.feed.replaceChildren();
        this.messages.clear();
        messages.forEach((message) => this.upsert(message, { scroll: false }));
        this.updateEmpty();
        this.scrollToEnd();
    }

    /** Agrega o actualiza un mensaje; los fundidos con otro se quitan. */
    upsert(message, { scroll = true } = {}) {
        const existing = this.messages.get(message.id);

        if (message.superseded) {
            existing?.remove();
            this.messages.delete(message.id);
            this.updateEmpty();
            return;
        }

        const bubble = this.bubble(message);
        if (existing) existing.replaceWith(bubble);
        else this.feed.appendChild(bubble);

        this.messages.set(message.id, bubble);
        this.updateEmpty();
        if (scroll) this.scrollToEnd();
    }

    bubble(message) {
        const isNote = message.role === 'system';
        const kind = message.role === 'assistant' ? 'nova' : (isNote || message.source === 'ambient' ? 'ambient' : (message.mine ? 'me' : 'other'));
        const bubble = el('div', `nl-msg is-${kind}`);
        bubble.dataset.id = message.id;

        if (kind !== 'me' && !isNote && message.authorName) {
            const who = el('span', 'nl-msg-who', kind === 'ambient' ? `${message.authorName} · de fondo` : message.authorName);
            bubble.appendChild(who);
        }

        const text = [message.text, message.opsSummary].filter(Boolean).join('\n');
        bubble.appendChild(el('p', 'nl-msg-text', text));

        if (message.source === 'live' || message.source === 'voice') bubble.classList.add('is-voice');

        return bubble;
    }

    updateEmpty() {
        this.emptyEl.hidden = this.messages.size > 0;
        if (this.messages.size === 0 && !this.emptyEl.isConnected) this.feed.appendChild(this.emptyEl);
    }

    scrollToEnd() {
        this.feed.scrollTop = this.feed.scrollHeight;
    }
}
