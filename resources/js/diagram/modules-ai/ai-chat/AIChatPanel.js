// resources/js/diagram/modules-ai/ai-chat/AIChatPanel.js
// Renderizado puro del panel del equipo (#ai-chat-tab-panel, dentro de
// #editor-dock a la derecha): Nova, Actividad y Versiones. No
// sabe nada de IA/backend/diagrama: solo pinta y avisa por callbacks. La lógica
// vive en AIChatController.js.

import { icon } from '../../utils/uiIcons.js';

const ACTIVITY_LIMIT = 200;

const ORIGIN_LABELS = {
    manual: () => 'a mano',
    agent: (entry) => `a pedido de ${entry.requestedByName || 'alguien'}`,
    import: () => 'por importación',
};

const SPEAKER_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16.5 9a4 4 0 010 6"/><path d="M19 6.5a7.5 7.5 0 010 11"/></svg>';
const SPEAKER_MUTED_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>';

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

    /** Encabezado común de cada vista del panel del equipo. */
    viewHeader({ iconName, title, subtitle, subtitleId = '', titleId = '', actions = '' }) {
        return `
            <header class="dock-header">
                <span class="dock-header-icon" aria-hidden="true">${icon(iconName, { size: 16 })}</span>
                <span class="dock-header-text">
                    <span class="dock-header-title" ${titleId ? `id="${titleId}"` : ''}>${title}</span>
                    <span class="dock-header-subtitle" ${subtitleId ? `id="${subtitleId}"` : ''}>${subtitle}</span>
                </span>
                ${actions}
                <button type="button" class="dock-icon-btn" data-dock-close title="Cerrar panel" aria-label="Cerrar panel">
                    ${icon('close', { size: 16 })}
                </button>
            </header>
        `;
    }

    build() {
        // Tres vistas independientes (Nova / Actividad / Versiones) que abre el
        // riel derecho. Antes vivían como sub-pestañas dentro de "Asistente IA",
        // mezclando la conversación con el historial del diagrama.
        this.container.innerHTML = `
            <section class="ai-agent-view" id="ai-agent-chat-view" aria-label="Conversación con Nova">
                ${this.viewHeader({
                    iconName: 'sparkle',
                    title: 'Asistente',
                    titleId: 'ai-agent-name',
                    subtitle: 'Chat del equipo',
                    subtitleId: 'ai-agent-status',
                    actions: `
                        <button type="button" class="dock-chip-toggle" id="ai-agent-handsfree" aria-pressed="false" title="Activar por nombre, sin tocar nada">
                            ${icon('mic', { size: 14 })}<span>Manos libres</span>
                        </button>
                        <span class="voice-menu-anchor">
                            <button type="button" class="dock-icon-btn" id="ai-agent-voice-settings" aria-haspopup="menu" aria-expanded="false" aria-controls="ai-voice-menu" title="Lectura en voz alta">
                                <span id="ai-voice-icon"></span>
                            </button>
                            <div class="voice-menu" id="ai-voice-menu" role="menu" aria-label="Lectura en voz alta" hidden>
                                <div class="voice-menu-title">Leer en voz alta</div>
                                <button type="button" class="voice-menu-item" role="menuitemradio" aria-checked="false" data-listen-mode="all">
                                    <span class="voice-menu-check" aria-hidden="true">${icon('check', { size: 14 })}</span>
                                    <span class="voice-menu-text"><span>Respuestas de todos</span><small>Lee lo que la IA le responde a cualquiera</small></span>
                                </button>
                                <button type="button" class="voice-menu-item" role="menuitemradio" aria-checked="false" data-listen-mode="mine">
                                    <span class="voice-menu-check" aria-hidden="true">${icon('check', { size: 14 })}</span>
                                    <span class="voice-menu-text"><span>Solo mis respuestas</span><small>Lee solo lo que te responde a ti</small></span>
                                </button>
                                <button type="button" class="voice-menu-item" role="menuitemradio" aria-checked="false" data-listen-mode="others">
                                    <span class="voice-menu-check" aria-hidden="true">${icon('check', { size: 14 })}</span>
                                    <span class="voice-menu-text"><span>Solo las de los demás</span><small>Lee lo que responde a otros integrantes</small></span>
                                </button>
                                <button type="button" class="voice-menu-item" role="menuitemradio" aria-checked="false" data-listen-mode="none">
                                    <span class="voice-menu-check" aria-hidden="true">${icon('check', { size: 14 })}</span>
                                    <span class="voice-menu-text"><span>Silencio</span><small>No lee nada en voz alta</small></span>
                                </button>
                                <div class="voice-menu-divider"></div>
                                <button type="button" class="voice-menu-item is-plain" role="menuitem" id="ai-voice-test">
                                    <span class="voice-menu-check" aria-hidden="true"></span>
                                    <span class="voice-menu-text"><span>Probar voz</span></span>
                                </button>
                            </div>
                        </span>
                    `,
                })}
                <div class="ai-session-bar">
                    <span class="ai-session-dot" aria-hidden="true"></span>
                    <label class="ai-session-label" for="ai-session-select">Sesión</label>
                    <select id="ai-session-select" class="ai-session-select" title="Cada sesión de trabajo tiene su propio chat. Elige una anterior para consultarla."></select>
                    <button type="button" class="ai-session-close" id="ai-session-close" hidden title="Termina la sesión para todos; la próxima empieza con el chat vacío">Cerrar sesión</button>
                </div>
                <div class="ai-session-readonly" id="ai-session-readonly" hidden>
                    <span>Estás viendo una sesión anterior (solo lectura).</span>
                    <button type="button" id="ai-session-back">Volver a la actual</button>
                </div>
                <div class="ai-chat-messages" id="ai-chat-messages" aria-live="polite"></div>
                <div class="ai-chat-typing" id="ai-chat-typing" style="display: none;">
                    <span class="ai-chat-typing-dot"></span>
                    <span class="ai-chat-typing-dot"></span>
                    <span class="ai-chat-typing-dot"></span>
                </div>
                <div class="ai-composer">
                    <div class="ai-chat-toolbar" id="ai-chat-toolbar" aria-label="Pedidos rápidos a la IA">
                        <button type="button" class="ai-chat-toolbar-btn" data-quick="review" title="La IA revisa el diagrama y sugiere correcciones, sin cambiar nada">${icon('check', { size: 14 })} Revisar</button>
                        <button type="button" class="ai-chat-toolbar-btn" data-quick="normalize" title="Revisa 1FN, 2FN y 3FN clase por clase, sin cambiar nada">${icon('sparkle', { size: 14 })} Normalización</button>
                        <button type="button" class="ai-chat-toolbar-btn" data-quick="summary" title="Qué se avanzó y qué hizo cada integrante">${icon('info', { size: 14 })} Resumen</button>
                    </div>
                    <div class="ai-chat-inputbar" id="ai-chat-inputbar">
                        <textarea id="ai-chat-input" class="ai-chat-input" placeholder="Escríbele al asistente…" maxlength="2000" rows="1" aria-label="Mensaje para el asistente"></textarea>
                        <div class="ai-chat-inputbar-footer">
                            <label class="ai-chat-audience" id="ai-chat-audience" title="Desmárcalo para escribirle solo al equipo, sin que la IA actúe">
                                <input type="checkbox" id="ai-chat-to-agent" checked>
                                <span class="ai-chat-audience-switch" aria-hidden="true"></span>
                                <span id="ai-chat-to-agent-label">Pedírselo al asistente</span>
                            </label>
                            <span class="ai-chat-inputbar-actions">
                                <button type="button" class="ai-chat-icon-btn" id="ai-chat-voice-btn" title="Dictar por voz" aria-label="Dictar por voz">
                                    ${icon('mic', { size: 16 })}
                                </button>
                                <button type="button" class="ai-chat-icon-btn ai-chat-send-btn" id="ai-chat-send-btn" title="Enviar (Enter)" aria-label="Enviar">
                                    ${icon('send', { size: 16 })}
                                </button>
                            </span>
                        </div>
                    </div>
                </div>
            </section>
            <section class="ai-agent-view" id="ai-agent-activity-view" style="display: none;" aria-label="Actividad del diagrama">
                ${this.viewHeader({
                    iconName: 'refresh',
                    title: 'Actividad',
                    subtitle: 'Quién cambió qué, a mano o con la IA',
                })}
                <form class="ai-search" id="ai-search-form" role="search">
                    <input type="search" id="ai-search-input" class="ai-search-input" placeholder="Buscar por significado: ¿quién tocó los pagos?" maxlength="300" aria-label="Buscar en el historial por significado">
                    <button type="submit" class="ai-chat-toolbar-btn">Buscar</button>
                </form>
                <div class="ai-search-results" id="ai-search-results" hidden></div>
                <div class="dock-scroll">
                    <ol class="ai-activity-list" id="ai-activity-list"></ol>
                    <p class="ai-activity-empty" id="ai-activity-empty">Todavía no hay actividad registrada.</p>
                </div>
            </section>
            <section class="ai-agent-view" id="ai-agent-versions-view" style="display: none;" aria-label="Versiones del diagrama">
                ${this.viewHeader({
                    iconName: 'folder',
                    title: 'Versiones',
                    subtitle: 'Copias guardadas del diagrama',
                })}
                <p class="ai-versions-intro">Se guarda una al apretar "Guardar" y otra al terminar cada sesión. Al restaurar, la versión actual también queda guardada.</p>
                <div class="dock-scroll">
                    <ol class="ai-versions-list" id="ai-versions-list"></ol>
                </div>
            </section>
        `;

        const find = (selector) => this.container.querySelector(selector);

        this.messagesEl = find('#ai-chat-messages');
        this.typingEl = find('#ai-chat-typing');
        this.inputEl = find('#ai-chat-input');
        this.voiceBtn = find('#ai-chat-voice-btn');
        this.handsFreeBtn = find('#ai-agent-handsfree');
        this.voiceSettingsBtn = find('#ai-agent-voice-settings');
        this.voiceMenuEl = find('#ai-voice-menu');
        this.voiceIconEl = find('#ai-voice-icon');
        this.voiceIconEl.innerHTML = SPEAKER_ICON;
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
        this.container.querySelectorAll('[data-dock-close]').forEach((btn) => {
            btn.addEventListener('click', () => this.callbacks.onDockClose?.());
        });

        find('#ai-chat-send-btn').addEventListener('click', () => this.submitInput());
        this.voiceBtn.addEventListener('click', () => this.callbacks.onVoiceToggle());
        this.handsFreeBtn.addEventListener('click', () => this.callbacks.onHandsFreeToggle());
        this.voiceSettingsBtn.addEventListener('click', () => this.toggleVoiceMenu());
        this.voiceMenuEl.querySelectorAll('[data-listen-mode]').forEach((item) => {
            item.addEventListener('click', () => {
                this.callbacks.onListenModeChange(item.dataset.listenMode);
                this.toggleVoiceMenu(false);
            });
        });
        find('#ai-voice-test').addEventListener('click', () => {
            this.callbacks.onVoiceTest();
            this.toggleVoiceMenu(false);
        });
        // Se cierra al hacer clic afuera o con Escape (sin cerrar el panel entero).
        document.addEventListener('pointerdown', (event) => {
            if (!this.voiceMenuEl.hidden && !event.target.closest('.voice-menu-anchor')) this.toggleVoiceMenu(false);
        });
        this.voiceMenuEl.parentElement.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !this.voiceMenuEl.hidden) {
                event.stopPropagation();
                this.toggleVoiceMenu(false);
                this.voiceSettingsBtn.focus();
            }
        });
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

    setAgent(agent, voiceSupported, listenMode, handsFreeOn) {
        this.agentName = agent.name;
        this.container.querySelector('#ai-agent-name').textContent = agent.name;
        const railLabel = document.getElementById('editor-rail-agent-name');
        if (railLabel) railLabel.textContent = agent.name;
        this.container.querySelector('#ai-chat-to-agent-label').textContent = `Pedírselo a ${agent.name}`;
        this.toAgentEl.addEventListener('change', () => this.updatePlaceholder());
        this.updatePlaceholder();
        this.handsFreeBtn.hidden = !voiceSupported;
        this.handsFreeBtn.title = `Activar diciendo "${agent.name}", sin tocar nada`;
        this.setListenMode(listenMode);
        this.setVoiceState(handsFreeOn ? 'standby' : 'idle');
    }

    updatePlaceholder() {
        this.inputEl.placeholder = this.toAgentEl.checked ? `Escríbele a ${this.agentName}…` : 'Escríbele al equipo…';
    }

    setListenMode(mode) {
        const titles = {
            all: 'Lectura en voz alta: respuestas de todos',
            mine: 'Lectura en voz alta: solo tus respuestas',
            others: 'Lectura en voz alta: solo las de los demás',
            none: 'Lectura en voz alta: en silencio',
        };
        const muted = mode === 'none';
        this.voiceIconEl.innerHTML = muted ? SPEAKER_MUTED_ICON : SPEAKER_ICON;
        this.voiceSettingsBtn.classList.toggle('is-muted', muted);
        this.voiceSettingsBtn.title = titles[mode] || titles.all;
        this.voiceSettingsBtn.setAttribute('aria-label', titles[mode] || titles.all);
        this.voiceMenuEl.querySelectorAll('[data-listen-mode]').forEach((item) => {
            item.setAttribute('aria-checked', String(item.dataset.listenMode === mode));
        });
    }

    toggleVoiceMenu(force) {
        const open = force ?? this.voiceMenuEl.hidden;
        this.voiceMenuEl.hidden = !open;
        this.voiceSettingsBtn.setAttribute('aria-expanded', String(open));
        if (open) this.voiceMenuEl.querySelector('[aria-checked="true"]')?.focus();
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

    /** La vista que el riel dejó a la vista (o null si el panel está cerrado). */
    setVisible(visible, { focus = true } = {}) {
        this.visible = visible;
        if (visible && this.view === 'chat') {
            this.scrollToBottom();
            if (focus) this.inputEl.focus({ preventScroll: true });
        }
    }

    isChatVisible() {
        return this.visible && this.view === 'chat';
    }

    showView(view) {
        this.view = view;
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
        // Mensaje en vivo de otra persona o de la IA con el chat fuera de vista:
        // el riel muestra un contador para que no pase desapercibido.
        // Los avisos locales (rol system: bienvenida, errores) no cuentan.
        if (scroll && !message.mine && message.role !== 'system' && !this.isChatVisible()) this.callbacks.onUnread?.();
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
        author.textContent = message.mine ? `${message.authorName} (tú)` : message.authorName;
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
            this.statusEl.textContent = `Di "${this.agentName}" para hablarle`;
        } else {
            this.statusEl.textContent = 'Chat del equipo';
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
