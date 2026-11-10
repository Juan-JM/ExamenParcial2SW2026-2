// resources/js/diagram/modules-ai/ai-chat/AIChatPanel.js
// Renderizado puro de la conversación del equipo dentro de #ai-chat-tab-panel. No
// sabe nada de IA/backend/diagrama: solo pinta y avisa por callbacks. La lógica
// vive en AIChatController.js.

import { icon } from '../../utils/uiIcons.js';

const ACTIVITY_LIMIT = 200;

const ORIGIN_LABELS = {
    manual: () => 'a mano',
    agent: (entry) => `a pedido de ${entry.requestedByName || 'alguien'}`,
    import: () => 'por importación',
};

const VOICE_TITLES = {
    idle: 'Dictar por voz',
    standby: 'Dictar por voz',
    listening: 'Escuchando…',
    speaking: 'Dictar por voz',
};

export class AIChatPanel {
    constructor(container, callbacks) {
        this.container = container;
        this.callbacks = callbacks;
        this.view = 'chat';
        this.build();
    }

    build() {
        this.container.innerHTML = `
            <div class="ai-agent-header">
                <span class="ai-agent-avatar" aria-hidden="true">${icon('sparkle', { size: 14 })}</span>
                <span class="ai-agent-identity">
                    <span class="ai-agent-name" id="ai-agent-name">Asistente</span>
                    <span class="ai-agent-status" id="ai-agent-status">Conversación del equipo</span>
                </span>
                <button type="button" class="ai-agent-toggle" id="ai-agent-handsfree" aria-pressed="false" title="Activar por nombre, sin tocar nada">
                    ${icon('mic', { size: 14 })}<span>Manos libres</span>
                </button>
                <button type="button" class="ai-agent-toggle ai-agent-toggle-icon" id="ai-agent-voice-settings" aria-expanded="false" aria-controls="ai-voice-settings" title="Voz de las respuestas">
                    ${icon('message', { size: 14 })}
                </button>
            </div>
            <div class="ai-voice-settings" id="ai-voice-settings" hidden>
                <label class="ai-voice-row">
                    <input type="checkbox" id="ai-voice-enabled">
                    <span>Leer las respuestas en voz alta</span>
                </label>
                <label class="ai-voice-row ai-voice-field">
                    <span>Voz</span>
                    <select id="ai-voice-select"></select>
                </label>
                <label class="ai-voice-row ai-voice-field">
                    <span>Velocidad</span>
                    <input type="range" id="ai-voice-rate" min="0.8" max="1.4" step="0.1">
                </label>
                <div class="ai-voice-row">
                    <button type="button" class="ai-chat-toolbar-btn" id="ai-voice-test">Probar voz</button>
                    <span class="ai-voice-hint">Las voces "Natural" de Microsoft Edge son las que mejor suenan.</span>
                </div>
            </div>
            <div class="ai-agent-tabs" role="tablist">
                <button type="button" role="tab" class="ai-agent-tab is-active" data-view="chat">Conversación</button>
                <button type="button" role="tab" class="ai-agent-tab" data-view="activity">Actividad</button>
                <button type="button" role="tab" class="ai-agent-tab" data-view="versions">Versiones</button>
            </div>
            <div class="ai-agent-view" id="ai-agent-chat-view">
                <div class="ai-session-bar">
                    <label class="ai-session-label" for="ai-session-select">Sesión</label>
                    <select id="ai-session-select" class="ai-session-select"></select>
                    <button type="button" class="ai-session-close" id="ai-session-close" hidden>Cerrar sesión</button>
                </div>
                <div class="ai-session-readonly" id="ai-session-readonly" hidden>
                    <span>Estás viendo una sesión anterior.</span>
                    <button type="button" id="ai-session-back">Volver a la actual</button>
                </div>
                <div class="ai-chat-toolbar" id="ai-chat-toolbar">
                    <button type="button" class="ai-chat-toolbar-btn" data-quick="review">${icon('check', { size: 14 })} Revisar</button>
                    <button type="button" class="ai-chat-toolbar-btn" data-quick="normalize">${icon('sparkle', { size: 14 })} Normalización</button>
                    <button type="button" class="ai-chat-toolbar-btn" data-quick="summary">${icon('info', { size: 14 })} Resumen</button>
                </div>
                <div class="ai-chat-messages" id="ai-chat-messages" aria-live="polite"></div>
                <div class="ai-chat-typing" id="ai-chat-typing" style="display: none;">
                    <span class="ai-chat-typing-dot"></span>
                    <span class="ai-chat-typing-dot"></span>
                    <span class="ai-chat-typing-dot"></span>
                </div>
                <label class="ai-chat-audience" id="ai-chat-audience">
                    <input type="checkbox" id="ai-chat-to-agent" checked>
                    <span id="ai-chat-to-agent-label">Pedírselo al asistente</span>
                </label>
                <div class="ai-chat-inputbar" id="ai-chat-inputbar">
                    <textarea id="ai-chat-input" class="ai-chat-input" placeholder="Escribile al asistente…" maxlength="2000" rows="1" aria-label="Mensaje para el asistente"></textarea>
                    <button type="button" class="ai-chat-icon-btn" id="ai-chat-voice-btn" title="Dictar por voz" aria-label="Dictar por voz">
                        ${icon('mic', { size: 16 })}
                    </button>
                    <button type="button" class="ai-chat-icon-btn ai-chat-send-btn" id="ai-chat-send-btn" title="Enviar" aria-label="Enviar">
                        ${icon('send', { size: 16 })}
                    </button>
                </div>
            </div>
            <div class="ai-agent-view" id="ai-agent-activity-view" style="display: none;">
                <form class="ai-search" id="ai-search-form" role="search">
                    <input type="search" id="ai-search-input" class="ai-search-input" placeholder="Buscar por significado: ¿quién tocó los pagos?" maxlength="300" aria-label="Buscar en el historial por significado">
                    <button type="submit" class="ai-chat-toolbar-btn">Buscar</button>
                </form>
                <div class="ai-search-results" id="ai-search-results" hidden></div>
                <ol class="ai-activity-list" id="ai-activity-list"></ol>
                <p class="ai-activity-empty" id="ai-activity-empty">Todavía no hay actividad registrada.</p>
            </div>
            <div class="ai-agent-view" id="ai-agent-versions-view" style="display: none;">
                <p class="ai-versions-intro">Copias guardadas del diagrama. Al restaurar, la versión actual también queda guardada.</p>
                <ol class="ai-versions-list" id="ai-versions-list"></ol>
            </div>
        `;

        const find = (selector) => this.container.querySelector(selector);

        this.messagesEl = find('#ai-chat-messages');
        this.typingEl = find('#ai-chat-typing');
        this.inputEl = find('#ai-chat-input');
        this.voiceBtn = find('#ai-chat-voice-btn');
        this.handsFreeBtn = find('#ai-agent-handsfree');
        this.voiceSettingsBtn = find('#ai-agent-voice-settings');
        this.voiceSettingsEl = find('#ai-voice-settings');
        this.voiceEnabledEl = find('#ai-voice-enabled');
        this.voiceSelectEl = find('#ai-voice-select');
        this.voiceRateEl = find('#ai-voice-rate');
        this.sessionSelectEl = find('#ai-session-select');
        this.sessionCloseBtn = find('#ai-session-close');
        this.readonlyEl = find('#ai-session-readonly');
        this.statusEl = find('#ai-agent-status');
        this.toAgentEl = find('#ai-chat-to-agent');
        this.activityListEl = find('#ai-activity-list');
        this.activityEmptyEl = find('#ai-activity-empty');

        this.container.querySelectorAll('[data-quick]').forEach((btn) => {
            btn.addEventListener('click', () => this.callbacks.onQuickCommand(btn.dataset.quick));
        });
        this.container.querySelectorAll('.ai-agent-tab').forEach((btn) => {
            btn.addEventListener('click', () => this.showView(btn.dataset.view));
        });

        find('#ai-chat-send-btn').addEventListener('click', () => this.submitInput());
        this.voiceBtn.addEventListener('click', () => this.callbacks.onVoiceToggle());
        this.handsFreeBtn.addEventListener('click', () => this.callbacks.onHandsFreeToggle());
        this.voiceSettingsBtn.addEventListener('click', () => this.toggleVoiceSettings());
        this.voiceEnabledEl.addEventListener('change', () => this.callbacks.onMuteToggle());
        this.voiceSelectEl.addEventListener('change', () => this.callbacks.onVoiceSelect(this.voiceSelectEl.value));
        this.voiceRateEl.addEventListener('change', () => this.callbacks.onVoiceRate(Number(this.voiceRateEl.value)));
        find('#ai-voice-test').addEventListener('click', () => this.callbacks.onVoiceTest());
        this.sessionSelectEl.addEventListener('change', () => this.callbacks.onSessionSelect(this.sessionSelectEl.value));
        this.sessionCloseBtn.addEventListener('click', () => this.callbacks.onSessionClose());
        find('#ai-session-back').addEventListener('click', () => this.callbacks.onSessionSelect('current'));
        find('#ai-search-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const query = find('#ai-search-input').value.trim();
            if (query) this.callbacks.onSearch(query);
        });

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.submitInput();
            }
        });

        this.inputEl.addEventListener('input', () => {
            this.inputEl.style.height = 'auto';
            this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';
        });
    }

    setAgent(agent, voiceSupported, muted, handsFreeOn) {
        this.agentName = agent.name;
        this.container.querySelector('#ai-agent-name').textContent = agent.name;
        this.container.querySelector('#ai-chat-to-agent-label').textContent = `Pedírselo a ${agent.name}`;
        this.toAgentEl.addEventListener('change', () => this.updatePlaceholder());
        this.updatePlaceholder();
        this.handsFreeBtn.hidden = !voiceSupported;
        this.handsFreeBtn.title = `Activar diciendo "${agent.name}", sin tocar nada`;
        this.setMuted(muted);
        this.setVoiceState(handsFreeOn ? 'standby' : 'idle');
    }

    updatePlaceholder() {
        this.inputEl.placeholder = this.toAgentEl.checked ? `Escribile a ${this.agentName}…` : 'Escribile al equipo…';
    }

    setMuted(muted) {
        this.voiceEnabledEl.checked = !muted;
        this.voiceSettingsBtn.classList.toggle('is-off', muted);
        this.voiceSettingsBtn.title = muted ? 'Voz desactivada' : 'Voz de las respuestas';
    }

    toggleVoiceSettings(force) {
        const open = force ?? this.voiceSettingsEl.hidden;
        this.voiceSettingsEl.hidden = !open;
        this.voiceSettingsBtn.setAttribute('aria-expanded', String(open));
        if (open) this.callbacks.onVoiceSettingsOpen();
    }

    /** @param {SpeechSynthesisVoice[]} voices */
    setVoiceOptions(voices, selectedName, rate) {
        this.voiceSelectEl.innerHTML = '';

        if (voices.length === 0) {
            this.voiceSelectEl.append(new Option('No hay voces en español en este navegador', ''));
            this.voiceSelectEl.disabled = true;
        } else {
            this.voiceSelectEl.disabled = false;
            voices.forEach((voice) => {
                this.voiceSelectEl.append(new Option(`${voice.name} (${voice.lang})`, voice.name, false, voice.name === selectedName));
            });
        }

        this.voiceRateEl.value = String(rate);
    }

    /** @param {Array<{id: string, isOpen: boolean, startedAt: string, participants: string[]}>} sessions */
    setSessions(sessions, currentId, canClose) {
        this.sessionSelectEl.innerHTML = '';
        this.sessionSelectEl.append(new Option(currentId ? 'Actual (en curso)' : 'Sin sesión abierta', 'current'));

        sessions.filter((s) => s.id !== currentId).forEach((session) => {
            const start = new Date(session.startedAt).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const people = session.participants.length ? ` · ${session.participants.join(', ')}` : '';
            this.sessionSelectEl.append(new Option(`${start}${people}`, session.id));
        });

        this.sessionSelectEl.value = 'current';
        this.sessionCloseBtn.hidden = !canClose;
        this.setReadOnly(false);
    }

    /** Al consultar una sesión anterior no se puede escribir en ella. */
    setReadOnly(readOnly) {
        this.readonlyEl.hidden = !readOnly;
        ['#ai-chat-toolbar', '#ai-chat-audience', '#ai-chat-inputbar'].forEach((selector) => {
            this.container.querySelector(selector).hidden = readOnly;
        });
        if (!readOnly) this.sessionSelectEl.value = 'current';
    }

    showView(view) {
        this.view = view;
        this.container.querySelectorAll('.ai-agent-tab').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.view === view);
        });
        this.container.querySelector('#ai-agent-chat-view').style.display = view === 'chat' ? 'flex' : 'none';
        this.container.querySelector('#ai-agent-activity-view').style.display = view === 'activity' ? 'flex' : 'none';
        this.container.querySelector('#ai-agent-versions-view').style.display = view === 'versions' ? 'flex' : 'none';
        if (view === 'versions') this.callbacks.onVersionsOpen();
    }

    // ==================== BÚSQUEDA SEMÁNTICA ====================

    setSearchResults(response) {
        const box = this.container.querySelector('#ai-search-results');
        box.hidden = false;
        box.innerHTML = '';

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'ai-search-close';
        close.textContent = 'Cerrar resultados';
        close.addEventListener('click', () => { box.hidden = true; });

        if (!response.available) {
            box.append(this.note('La búsqueda por significado no está disponible: falta iniciar Qdrant o el modelo de embeddings.'), close);
            return;
        }

        if (response.results.length === 0) {
            box.append(this.note('No encontré nada parecido.'), close);
            return;
        }

        const kinds = { activity: 'Actividad', message: 'Chat', class: 'Clase', help: 'Guía de uso' };
        const list = document.createElement('ol');
        list.className = 'ai-search-list';

        response.results.forEach((result) => {
            const item = document.createElement('li');
            const tag = document.createElement('span');
            tag.className = 'ai-search-kind';
            tag.textContent = kinds[result.kind] || result.kind;
            item.append(tag, document.createTextNode(` ${result.text}`));
            list.appendChild(item);
        });

        box.append(list, close);
    }

    note(text) {
        const p = document.createElement('p');
        p.className = 'ai-activity-empty';
        p.textContent = text;
        return p;
    }

    // ==================== VERSIONES ====================

    setVersions({ versions, canRestore }) {
        const list = this.container.querySelector('#ai-versions-list');
        list.innerHTML = '';

        if (versions.length === 0) {
            list.appendChild(this.note('Todavía no hay versiones guardadas.'));
            return;
        }

        const reasons = {
            manual: 'guardado manual',
            session_end: 'fin de sesión',
            before_restore: 'antes de restaurar',
            // Motivos de versiones viejas, de cuando se copiaba cada autoguardado.
            save: 'autoguardado',
            agent: 'cambios de la IA',
            restored: 'restaurada',
        };

        versions.forEach((version, index) => {
            const item = document.createElement('li');
            item.className = 'ai-version-item';

            const title = document.createElement('div');
            title.className = 'ai-version-title';
            title.textContent = `${version.label} · v${version.version}${index === 0 ? ' · la más reciente' : ''}`;

            const meta = document.createElement('div');
            meta.className = 'ai-activity-meta';
            meta.textContent = [
                reasons[version.reason] || version.reason,
                version.authorName,
                `${version.classesCount} clases, ${version.relationshipsCount} relaciones`,
            ].filter(Boolean).join(' · ');

            const classes = document.createElement('div');
            classes.className = 'ai-version-classes';
            classes.textContent = version.classNames.join(', ');

            item.append(title, meta, classes);

            if (canRestore && index > 0) {
                const restore = document.createElement('button');
                restore.type = 'button';
                restore.className = 'ai-chat-toolbar-btn';
                restore.textContent = 'Restaurar esta versión';
                restore.addEventListener('click', () => this.callbacks.onVersionRestore(version));
                item.appendChild(restore);
            }

            list.appendChild(item);
        });
    }

    submitInput() {
        const text = this.inputEl.value.trim();
        if (!text) return;
        this.inputEl.value = '';
        this.inputEl.style.height = 'auto';
        this.callbacks.onSend(text, this.toAgentEl.checked);
    }

    // ==================== MENSAJES ====================

    renderAll(messages) {
        this.messagesEl.innerHTML = '';
        messages.forEach((m) => this.appendMessage(m, { scroll: false }));
        this.scrollToBottom();
    }

    appendMessage(message, { scroll = true } = {}) {
        this.messagesEl.appendChild(this.buildBubble(message));
        if (scroll) this.scrollToBottom();
    }

    updateMessage(message) {
        const current = this.messagesEl.querySelector(`[data-message-id="${message.id}"]`);
        if (current) {
            current.replaceWith(this.buildBubble(message));
            this.scrollToBottom();
        } else {
            this.appendMessage(message);
        }
    }

    bubbleClass(message) {
        if (message.role === 'user') return message.mine ? 'ai-chat-bubble-user' : 'ai-chat-bubble-other';
        return `ai-chat-bubble-${message.role}`;
    }

    buildBubble(message) {
        const bubble = document.createElement('div');
        bubble.className = `ai-chat-bubble ${this.bubbleClass(message)}`;
        bubble.dataset.messageId = message.id;

        if (message.authorName && message.role !== 'system') {
            bubble.appendChild(this.buildBubbleHeader(message));
        }

        const text = [message.text, message.opsSummary].filter(Boolean).join('\n');
        const hasPendingOps = message.opsStatus === 'pending';

        if (text || !hasPendingOps) {
            const textEl = document.createElement('div');
            textEl.className = 'ai-chat-bubble-text';
            textEl.textContent = text;
            bubble.appendChild(textEl);
        }

        if (hasPendingOps) {
            const status = document.createElement('div');
            status.className = 'ai-chat-bubble-status';
            status.textContent = 'Dibujando en la pizarra…';
            bubble.appendChild(status);
        }

        if (Array.isArray(message.options) && message.options.length > 0) {
            const optionsEl = document.createElement('div');
            optionsEl.className = 'ai-chat-bubble-options';

            message.options.forEach((opt) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'ai-chat-option-btn';
                btn.textContent = opt.label;
                btn.disabled = !message.pending;
                btn.addEventListener('click', () => this.callbacks.onOptionSelect(message.id, opt.value));
                optionsEl.appendChild(btn);
            });

            bubble.appendChild(optionsEl);
        }

        return bubble;
    }

    buildBubbleHeader(message) {
        const header = document.createElement('div');
        header.className = 'ai-chat-bubble-header';

        const author = document.createElement('span');
        author.className = 'ai-chat-bubble-author';
        author.textContent = message.mine ? `${message.authorName} (vos)` : message.authorName;
        if (!message.mine) author.style.color = message.role === 'assistant' ? '' : this.colorFor(message.authorId);
        header.appendChild(author);

        if (message.createdAt) {
            const time = document.createElement('time');
            time.textContent = new Date(message.createdAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
            header.appendChild(time);
        }

        return header;
    }

    /** Cada persona conserva su color en todas las pantallas. */
    colorFor(id) {
        const hash = [...String(id)].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 7);
        return `hsl(${hash % 360}, 60%, 36%)`;
    }

    disableOptions(messageId) {
        this.messagesEl.querySelector(`[data-message-id="${messageId}"]`)
            ?.querySelectorAll('.ai-chat-option-btn')
            .forEach((btn) => { btn.disabled = true; });
    }

    disableAllOptions() {
        this.messagesEl.querySelectorAll('.ai-chat-option-btn').forEach((btn) => { btn.disabled = true; });
    }

    setTyping(isTyping) {
        this.typingEl.style.display = isTyping ? 'flex' : 'none';
        if (isTyping) this.scrollToBottom();
    }

    /** idle: apagado. standby: esperando el nombre. listening: captando el pedido. speaking: la IA habla. */
    setVoiceState(state) {
        const listening = state === 'listening';
        const standby = state === 'standby';

        this.voiceBtn.innerHTML = icon(listening ? 'mic-active' : 'mic', { size: 16 });
        this.voiceBtn.classList.toggle('is-recording', listening);
        this.voiceBtn.title = VOICE_TITLES[state];
        this.voiceBtn.setAttribute('aria-pressed', String(listening));

        this.handsFreeBtn.classList.toggle('is-on', standby || (listening && this.handsFreeWasOn));
        this.handsFreeBtn.setAttribute('aria-pressed', String(standby));
        if (state !== 'listening') this.handsFreeWasOn = standby;

        if (listening) {
            this.statusEl.textContent = 'Escuchando tu pedido…';
        } else if (standby) {
            this.statusEl.textContent = `Decí "${this.agentName}" para hablarle`;
        } else {
            this.statusEl.textContent = 'Conversación del equipo';
        }
    }

    scrollToBottom() {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    // ==================== ACTIVIDAD ====================

    setActivity(entries) {
        this.activityListEl.innerHTML = '';
        this.appendActivity(entries);
    }

    /** Lo más reciente va primero. */
    appendActivity(entries) {
        entries.forEach((entry) => this.activityListEl.prepend(this.buildActivityItem(entry)));

        while (this.activityListEl.children.length > ACTIVITY_LIMIT) {
            this.activityListEl.lastElementChild.remove();
        }

        this.activityEmptyEl.style.display = this.activityListEl.children.length > 0 ? 'none' : 'block';
    }

    buildActivityItem(entry) {
        const item = document.createElement('li');
        item.className = `ai-activity-item ${entry.actorType === 'ai' ? 'is-ai' : ''}`;

        const line = document.createElement('div');
        const actor = document.createElement('strong');
        actor.textContent = entry.actorName;
        line.append(actor, ` ${entry.summary}`);
        item.appendChild(line);

        const meta = document.createElement('div');
        meta.className = 'ai-activity-meta';
        const time = entry.createdAt
            ? new Date(entry.createdAt).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : '';
        meta.textContent = [time, ORIGIN_LABELS[entry.origin]?.(entry)].filter(Boolean).join(' · ');
        item.appendChild(meta);

        return item;
    }
}
