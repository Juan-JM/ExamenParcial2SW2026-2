// resources/js/diagram/modules-ai/ai-chat/AIChatController.js
// Conversación ÚNICA del diagrama con la IA: el historial vive en el servidor y
// llega a todos por el canal `diagram-agent.{id}` (ver
// documentacion/06-asistente-ia.md). Las operaciones que devuelve la IA las
// ejecuta solo el navegador de quien las pidió, vía AICommandExecutor; los demás
// las reciben como cualquier cambio de un colaborador.

import { AIChatPanel } from './AIChatPanel.js';
import { VoiceAssistant } from './VoiceAssistant.js';
import { ActivityTracker } from './ActivityTracker.js';
import { VoiceOrb } from './VoiceOrb.js';
import { AICommandExecutor } from '../AICommandExecutor.js';
import { EditorAIResponseParser } from '../EditorAIResponseParser.js';
import { isUmlClassElement } from '../../DiagramElementFactory.js';

/** Si no llega respuesta en este tiempo, se avisa: lo más común es que la cola no esté corriendo. */
const REPLY_TIMEOUT_MS = 180000;

/** Latido de presencia: Reverb no le avisa al servidor cuando alguien se va. */
const HEARTBEAT_MS = 30000;

const QUICK_COMMANDS = {
    review: 'Revisa el diagrama actual y dime qué corregir o mejorar. No cambies nada todavía.',
    normalize: 'Revisa si el modelo cumple primera, segunda y tercera forma normal. Dime qué clase incumple cada una y cómo corregirla. No cambies nada todavía.',
    summary: '¿Qué se avanzó en el diagrama y qué hizo cada integrante? Dame un resumen.',
};

/** Errores con un mensaje en español ya pensado para mostrarse tal cual en el chat. */
class UserFacingAiError extends Error {}

export class AIChatController {
    constructor(diagramEditor) {
        this.editor = diagramEditor;
        this.commandExecutor = new AICommandExecutor(diagramEditor);
        this.responseParser = new EditorAIResponseParser();

        this.diagramId = window.diagramId || null;
        this.userId = window.authUser?.id ?? null;
        this.urls = window.aiAssistant || {};

        this.agent = { name: 'Nova', wakeWords: ['nova'] };
        this.canEdit = true;
        this.messages = new Map();
        this.awaitingReplies = new Map(); // id del mensaje -> timeout
        this.executedOps = new Set();
        this.spoken = new Set();
        this.pendingAmbiguous = null; // { op, field, remainingOps, summaries, applied, reply }

        this.initializeTabs();
        this.orb = new VoiceOrb();
        this.initializePanel();
        this.voice = new VoiceAssistant({
            onCommand: (text, source) => this.handleUserCommand(text, source),
            onState: (state, detail) => {
                this.panel?.setVoiceState(state);
                this.orb.update(state, detail);
            },
            onUnavailable: (reason) => this.pushLocal(reason),
        });
        this.activityTracker = new ActivityTracker(diagramEditor, (entries) => this.sendActivity(entries));

        this.bootstrap();
    }

    // ==================== PESTAÑAS DEL SIDEBAR ====================

    initializeTabs() {
        this.toolsTabBtn = document.getElementById('sidebar-tab-tools');
        this.aiTabBtn = document.getElementById('sidebar-tab-ai');
        this.toolsPanel = document.getElementById('uml-tools-tab-panel');
        this.aiPanel = document.getElementById('ai-chat-tab-panel');

        if (!this.toolsTabBtn || !this.aiTabBtn || !this.toolsPanel || !this.aiPanel) return;

        this.toolsTabBtn.addEventListener('click', () => this.showTab('tools'));
        this.aiTabBtn.addEventListener('click', () => this.showTab('ai'));
    }

    showTab(tab) {
        const isAi = tab === 'ai';
        this.aiTabBtn?.classList.toggle('is-active', isAi);
        this.toolsTabBtn?.classList.toggle('is-active', !isAi);
        if (this.aiPanel) this.aiPanel.style.display = isAi ? 'flex' : 'none';
        if (this.toolsPanel) this.toolsPanel.style.display = isAi ? 'none' : 'flex';
    }

    // ==================== INICIALIZACIÓN ====================

    initializePanel() {
        if (!this.aiPanel) return;

        this.panel = new AIChatPanel(this.aiPanel, {
            onSend: (text, toAgent) => this.handleUserCommand(text, 'text', null, toAgent),
            onVoiceToggle: () => this.voice.toggleManual(),
            onHandsFreeToggle: () => this.voice.toggleHandsFree(),
            onMuteToggle: () => this.panel.setMuted(this.voice.toggleMuted()),
            onVoiceSettingsOpen: () => this.refreshVoices(),
            onVoiceSelect: (name) => this.voice.setVoice(name),
            onVoiceRate: (rate) => this.voice.setRate(rate),
            onVoiceTest: () => this.voice.speak(`Hola, soy ${this.agent.name}. Así sueno al leer las respuestas del equipo.`, { force: true }),
            onSessionSelect: (id) => this.showSession(id),
            onSearch: (query) => this.search(query),
            onVersionsOpen: () => this.loadVersions(),
            onVersionRestore: (version) => this.restoreVersion(version),
            onSessionClose: () => this.closeSession(),
            onQuickCommand: (key) => this.handleUserCommand(QUICK_COMMANDS[key], 'text'),
            onOptionSelect: (messageId, value) => this.handleOptionSelect(messageId, value),
        });
    }

    async bootstrap() {
        if (!this.diagramId || !this.urls.stateUrl) return;

        // Primero el latido: así el estado ya trae la conversación de la sesión
        // (recién abierta o en curso) a la que se suma esta persona.
        await this.startPresence();
        await this.loadState({ greet: true });

        this.subscribe();
        this.voice.restoreHandsFree();
    }

    async loadState({ greet = false } = {}) {
        try {
            const state = await this.request(this.urls.stateUrl);

            this.agent = state.agent;
            this.canEdit = state.canEdit;
            this.voice.configure(state.agent);
            this.orb.setAgentName(state.agent.name);
            this.panel?.setAgent(state.agent, this.voice.isSupported(), this.voice.isMuted(), this.voice.isHandsFreeOn());
            this.activityTracker.setEnabled(state.canEdit);

            this.currentSessionId = state.currentSessionId;
            this.viewingSessionId = null;
            this.messages = new Map(state.messages.map((message) => [message.id, message]));
            this.renderAll();
            this.panel?.setActivity(state.activity);
            this.panel?.setSessions(state.sessions, state.currentSessionId, state.canCloseSession);

            if (greet && state.missedDigest) {
                this.pushLocal(`Desde tu última visita:\n${state.missedDigest}`);
            } else if (state.messages.length === 0) {
                this.pushLocal(`Sesión nueva: el chat empieza de cero. Soy ${state.agent.name}, un integrante más del equipo; todos ven esta conversación. Pedime cambios, revisiones o ideas; solo actúo cuando me lo piden.`);
            }
        } catch (error) {
            console.error('AIChatController: no se pudo cargar la conversación', error);
            this.pushLocal('No se pudo cargar la conversación del equipo. Recargá la página.');
        }
    }

    refreshVoices() {
        this.panel?.setVoiceOptions(this.voice.voices(), this.voice.currentVoice()?.name, this.voice.rate);
    }

    /** Consultar una sesión anterior (solo lectura) o volver a la actual. */
    async showSession(id) {
        if (id === 'current') {
            this.viewingSessionId = null;
            this.panel?.setReadOnly(false);
            this.renderAll();
            return;
        }

        try {
            const { messages } = await this.request(`${this.urls.sessionsBaseUrl}/${id}/messages`);
            this.viewingSessionId = id;
            this.panel?.setReadOnly(true);
            this.panel?.renderAll(messages.map((m) => ({ ...this.decorate(m), pending: false })));
            if (messages.length === 0) this.pushLocal('En esa sesión nadie escribió en el chat.');
        } catch (error) {
            this.reportError(error);
        }
    }

    async closeSession() {
        if (!window.confirm('¿Cerrar la sesión de trabajo para todos? Quienes sigan en el diagrama empezarán una sesión nueva con el chat vacío.')) return;

        try {
            await this.request(this.urls.closeSessionUrl, {});
        } catch (error) {
            this.reportError(error);
        }
    }

    /** Alguien cerró la sesión: se empieza otra, con el chat vacío. */
    async onSessionClosed(event) {
        this.voice.cancelSpeech();
        await this.beat();
        await this.loadState();
        this.pushLocal(`${event.closedByName} cerró la sesión anterior. Podés consultarla en el selector de sesiones.`);
    }

    /**
     * Qué tiene en pantalla esta persona: el asistente lo usa para guiarla y para
     * contarle al equipo en qué está cada uno.
     */
    uiContext() {
        const editor = this.editor;
        const selectedId = editor._lockedSelectionId || editor.propertiesPanel?.currentElement?.id;
        const selected = selectedId ? editor.graph.getCell(selectedId) : null;
        const className = selected?.get('umlData')?.className;
        const modalTitle = document.querySelector('.modal-overlay .modal-title, .modal-overlay h2, .modal-overlay h3')?.textContent?.trim();
        const tab = document.querySelector('.sidebar-tab-btn.is-active')?.textContent?.trim();
        const panelView = this.panel?.view;

        return {
            screen: 'editor',
            sidebarTab: tab === 'Asistente IA' && panelView ? `Asistente IA / ${panelView}` : (tab || null),
            tool: editor.selectedTool || null,
            selection: className ? `clase ${className}` : (selected?.isLink?.() ? 'una relación' : null),
            propertiesOpen: !!editor.propertiesPanel?.currentElement,
            modal: modalTitle ? modalTitle.slice(0, 120) : null,
            role: window.collaboratorRole || (window.isDiagramOwner ? 'owner' : null),
        };
    }

    async search(query) {
        try {
            this.panel?.setSearchResults(await this.request(`${this.urls.searchUrl}?q=${encodeURIComponent(query)}`));
        } catch (error) {
            this.reportError(error);
        }
    }

    async loadVersions() {
        try {
            this.panel?.setVersions(await this.request(this.urls.versionsUrl));
        } catch (error) {
            this.reportError(error);
        }
    }

    async restoreVersion(version) {
        if (!window.confirm(`¿Restaurar la versión del ${version.label}? La versión actual queda guardada y se puede volver a ella.`)) return;

        try {
            await this.request(`${this.urls.versionsUrl}/${version.id}/restore`, {});
        } catch (error) {
            this.reportError(error);
        }
    }

    /** Alguien restauró una versión: todos cargan el diagrama tal como quedó guardado. */
    async onDiagramRestored(event) {
        try {
            const { data } = await this.request(this.urls.currentDiagramUrl);
            this.activityTracker.suspend();
            try {
                this.editor.graph.clear();
                this.editor.saveManager.recreateElementsFromData(data.cells || []);
                this.editor.updateCanvasInfo?.();
            } finally {
                this.activityTracker.resume();
            }
            // El diagrama se reemplazó entero: el historial de deshacer ya no aplica.
            this.editor.undoManager?.reset();
            this.pushLocal(`${event.restoredByName} restauró una versión anterior del diagrama.`);
            if (this.panel?.view === 'versions') this.loadVersions();
        } catch (error) {
            this.reportError(error);
        }
    }

    beat() {
        return this.request(this.urls.heartbeatUrl, { context: this.uiContext() }).catch((error) => {
            console.warn('AIChatController: latido de presencia fallido', error);
        });
    }

    /** Abrir el editor abre (o se suma a) la sesión de trabajo. */
    async startPresence() {
        setInterval(() => this.beat(), HEARTBEAT_MS);

        window.addEventListener('pagehide', () => {
            this.activityTracker.flush();
            fetch(this.urls.leaveUrl, {
                method: 'POST',
                keepalive: true,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '',
                },
                body: '{}',
            }).catch(() => {});
        });

        await this.beat();
    }

    subscribe() {
        if (!window.Echo) return;

        try {
            window.Echo.private(`diagram-agent.${this.diagramId}`)
                .listen('.AgentMessagePosted', (event) => this.onMessage(event.message))
                .listen('.ActivityRecorded', (event) => this.panel?.appendActivity(event.entries))
                .listen('.WorkSessionClosed', (event) => this.onSessionClosed(event))
                .listen('.DiagramRestored', (event) => this.onDiagramRestored(event));
        } catch (error) {
            console.error('AIChatController: no se pudo suscribir al canal de la IA', error);
        }
    }

    // ==================== MENSAJES ====================

    decorate(message) {
        const mine = message.role === 'user' && String(message.authorId) === String(this.userId);
        return { ...message, mine, pending: this.isLatest(message) && (message.options || []).length > 0 };
    }

    isLatest(message) {
        return [...this.messages.keys()].pop() === message.id;
    }

    renderAll() {
        this.panel?.renderAll([...this.messages.values()].map((m) => this.decorate(m)));
    }

    onMessage(message) {
        if (this.viewingSessionId) this.showSession('current');

        const isNew = !this.messages.has(message.id);
        this.messages.set(message.id, message);

        if (isNew) {
            this.panel?.disableAllOptions();
            this.panel?.appendMessage(this.decorate(message));
        } else {
            this.panel?.updateMessage(this.decorate(message));
        }

        if (message.role === 'user' && isNew && message.toAgent) {
            this.trackAwaiting(message.id);
        }

        if (message.replyTo) {
            this.clearAwaiting(message.replyTo);
        }

        const hasPendingOps = message.opsStatus === 'pending' && (message.ops || []).length > 0;

        if (hasPendingOps && message.executorUserId === this.userId && !this.executedOps.has(message.id)) {
            this.executedOps.add(message.id);
            this.applyReplyOps(message);
        }

        this.speakIfReady(message, hasPendingOps);
    }

    /** Se lee una vez: si hay operaciones en curso, se espera al resumen de lo aplicado. */
    speakIfReady(message, hasPendingOps) {
        if (message.role !== 'assistant' || hasPendingOps || this.spoken.has(message.id)) return;

        const text = [message.text, message.opsSummary].filter(Boolean).join('. ');

        if (text) {
            this.spoken.add(message.id);
            this.voice.speak(text);
        }
    }

    trackAwaiting(messageId) {
        if (this.awaitingReplies.has(messageId)) return;

        this.awaitingReplies.set(messageId, setTimeout(() => {
            this.clearAwaiting(messageId);
            this.pushLocal(`${this.agent.name} no respondió a tiempo. Revisá que la cola esté corriendo (composer run dev).`);
        }, REPLY_TIMEOUT_MS));

        this.panel?.setTyping(true);
    }

    clearAwaiting(messageId) {
        clearTimeout(this.awaitingReplies.get(messageId));
        this.awaitingReplies.delete(messageId);
        this.panel?.setTyping(this.awaitingReplies.size > 0);
    }

    /** Aviso visible solo para este usuario: no entra a la conversación compartida. */
    pushLocal(text, extra = {}) {
        const message = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'system', text, options: [], ...extra };
        this.panel?.appendMessage(message);
        return message;
    }

    // ==================== ENVÍO ====================

    async handleUserCommand(text, source = 'text', originalCommand = null, toAgent = true) {
        const trimmed = (text || '').trim();
        if (!trimmed) return;

        const schema = this.buildDiagramSchema();
        const lockedBlock = toAgent ? this.findSingleLockedMention(trimmed, schema.classes) : null;

        if (lockedBlock) {
            this.pushLocal(`No hice nada: la clase "${lockedBlock.className}" la está editando ${lockedBlock.ownerName} en este momento.`);
            return;
        }

        try {
            const { message } = await this.request(this.urls.messageUrl, {
                text: trimmed,
                source,
                diagramSchema: schema,
                originalCommand,
                toAgent,
                context: this.uiContext(),
            });

            // Si el WebSocket ya lo entregó, esto no duplica: se busca por id.
            if (!this.messages.has(message.id)) this.onMessage(message);
        } catch (error) {
            this.reportError(error);
        }
    }

    async handleOptionSelect(messageId, value) {
        this.panel.disableOptions(messageId);

        if (this.pendingAmbiguous && String(messageId).startsWith('local-')) {
            const { op, field, remainingOps, summaries, applied, reply } = this.pendingAmbiguous;
            this.pendingAmbiguous = null;

            op[field] = value;
            await this.executeAndCollect(op, summaries, applied);
            await this.runOps(remainingOps, reply, summaries, applied);
            return;
        }

        const message = this.messages.get(messageId);
        const chosen = (message?.options || []).find((option) => option.value === value);

        await this.handleUserCommand(chosen?.label || String(value), 'option', message?.originalCommand || null);
    }

    reportError(error) {
        if (error instanceof UserFacingAiError) {
            this.pushLocal(error.message);
            return;
        }

        console.error('AIChatController: error inesperado', error);
        this.pushLocal('Hubo un error inesperado. Mirá la consola del navegador (F12) para el detalle técnico.');
    }

    async request(url, body = null) {
        if (!url) throw new UserFacingAiError('El asistente de IA no está disponible para este diagrama.');

        let response;
        try {
            response = await fetch(url, {
                method: body ? 'POST' : 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '',
                    Accept: 'application/json',
                },
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch (networkError) {
            console.error('AIChatController: fallo de red', networkError);
            throw new UserFacingAiError('No se pudo conectar con el servidor (revisá tu conexión).');
        }

        let payload = null;
        try { payload = await response.json(); } catch { /* respuesta sin cuerpo JSON */ }

        if (!response.ok) {
            console.error('AIChatController: error del servidor', { status: response.status, payload });
            throw new UserFacingAiError(payload?.message || 'El servidor no pudo procesar el pedido.');
        }

        return payload;
    }

    sendActivity(entries) {
        return this.request(this.urls.activityUrl, { entries }).catch((error) => {
            console.warn('AIChatController: no se pudo registrar la actividad', error);
        });
    }

    /** Best-effort: si el comando nombra una sola clase y otro la tiene bloqueada, no gastamos una llamada a la IA. */
    findSingleLockedMention(commandText, classes) {
        const lower = commandText.toLowerCase();
        const mentioned = classes.filter((c) => {
            if (!c.name) return false;
            const pattern = new RegExp(`\\b${this.escapeRegex(c.name.toLowerCase())}\\b`, 'i');
            return pattern.test(lower);
        });

        if (mentioned.length !== 1) return null;

        const target = mentioned[0];
        if (this.editor.collaborationManager?.isLockedByOther(target.id)) {
            const owner = this.editor.collaborationManager.getLockOwner(target.id);
            return { className: target.name, ownerName: owner?.userName || 'otro colaborador' };
        }
        return null;
    }

    escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ==================== EJECUCIÓN DE OPERACIONES ====================

    async applyReplyOps(reply) {
        const ops = this.responseParser.validateOps(reply.ops || []);

        if (ops.length === 0) {
            await this.finishOps(reply, ['No encontré ninguna acción válida para ese pedido.'], [], false);
            return;
        }

        await this.runOps(ops, reply);
    }

    elementState(id, name) {
        const cell = (id && this.editor.graph.getCell(id))
            || this.editor.graph.getElements().find((e) => e.get('umlData')?.className === name);

        return cell ? { id: cell.id, uml: cell.get('umlData'), position: cell.position() } : null;
    }

    async executeAndCollect(op, summaries, applied) {
        const before = this.elementState(op.targetElementId, op.className || op.oldName);

        this.activityTracker.suspend();
        let result;
        try {
            result = await this.commandExecutor.executeCommand(op);
        } finally {
            this.activityTracker.resume();
        }

        if (result.status === 'ok') {
            summaries.push(this.describeOpSuccess(op));
            const after = this.elementState(result.elementId || before?.id, op.newName || op.className);

            applied.push({
                action: op.action,
                summary: this.describeActivity(op),
                elementId: result.elementId || before?.id || null,
                before,
                after: op.action === 'DELETE_CLASS' ? null : after,
            });
        } else if (result.status !== 'ambiguous') {
            summaries.push(this.describeOpFailure(op, result));
        }

        return result;
    }

    async runOps(ops, reply, summaries = [], applied = []) {
        // Lo que hace la IA a pedido de esta persona se deshace en un solo paso.
        this.editor.undoManager?.beginBatch('cambios de la IA');
        try {
            await this.runOpsBatch(ops, reply, summaries, applied);
        } finally {
            this.editor.undoManager?.endBatch();
        }
    }

    async runOpsBatch(ops, reply, summaries, applied) {
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            const result = await this.executeAndCollect(op, summaries, applied);

            if (result.status === 'ok') {
                // El paper de JointJS renderiza en modo async: sin esta pausa,
                // varias mutaciones seguidas quedan visualmente rotas.
                await this.sleep(120);
            }

            if (result.status === 'ambiguous') {
                const question = this.pushLocal(`Hay ${result.candidates.length} clases que coinciden con ese nombre. ¿A cuál te referís?`, {
                    options: result.candidates.map((c) => ({ label: c.summary, value: c.id })),
                    pending: true,
                });

                this.pendingAmbiguous = {
                    op,
                    field: result.ambiguousField || 'targetElementId',
                    remainingOps: ops.slice(i + 1),
                    summaries,
                    applied,
                    reply,
                    questionId: question.id,
                };
                return;
            }
        }

        await this.finishOps(reply, summaries, applied, applied.length > 0);
    }

    async finishOps(reply, summaries, applied, changed) {
        // Lo que se acaba de crear o mover siempre debe quedar a la vista.
        if (changed) this.editor.zoomManager?.zoomToFit();

        try {
            await this.request(`${this.urls.messageUrl}/${reply.id}/ops-result`, {
                summary: summaries.join('\n') || 'No hubo cambios para aplicar.',
                applied,
            });
        } catch (error) {
            this.reportError(error);
        }
    }

    describeOpSuccess(op) {
        const templates = {
            CREATE_CLASS: `Creé la clase "${op.className}".`,
            DELETE_CLASS: `Eliminé la clase "${op.className}".`,
            RENAME_CLASS: `Renombré "${op.oldName}" a "${op.newName}".`,
            EDIT_CLASS: `Actualicé las propiedades de "${op.className}".`,
            MOVE_CLASS: `Moví "${op.className}".`,
            ADD_ATTRIBUTE: `Agregué el atributo "${op.attribute?.name || ''}" a "${op.className}".`,
            EDIT_ATTRIBUTE: `Edité un atributo de "${op.className}".`,
            DELETE_ATTRIBUTE: `Eliminé el atributo "${op.attributeName}" de "${op.className}".`,
            ADD_METHOD: `Agregué el método "${op.method?.name || ''}" a "${op.className}".`,
            EDIT_METHOD: `Edité un método de "${op.className}".`,
            DELETE_METHOD: `Eliminé el método "${op.methodName}" de "${op.className}".`,
            CREATE_RELATION: `Creé una relación entre "${op.sourceClass}" y "${op.targetClass}".`,
            EDIT_RELATION: `Edité la relación entre "${op.sourceClass}" y "${op.targetClass}".`,
            DELETE_RELATION: `Eliminé la relación entre "${op.sourceClass}" y "${op.targetClass}".`,
            EDIT_MULTIPLICITY: `Actualicé la multiplicidad entre "${op.sourceClass}" y "${op.targetClass}".`,
            SET_RELATION_NAME: `Puse el nombre "${op.relationName}" a la relación entre "${op.sourceClass}" y "${op.targetClass}".`,
            CREATE_ASSOCIATION_CLASS_LINK: `Uní "${op.className}" como clase asociativa de la relación entre "${op.sourceClass}" y "${op.targetClass}".`,
        };
        return templates[op.action] || `Ejecuté ${op.action}.`;
    }

    /** Para el registro: misma información, en tercera persona. */
    describeActivity(op) {
        return this.describeOpSuccess(op)
            .replace(/^Creé/, 'creó').replace(/^Eliminé/, 'eliminó').replace(/^Renombré/, 'renombró')
            .replace(/^Actualicé/, 'actualizó').replace(/^Moví/, 'movió').replace(/^Agregué/, 'agregó')
            .replace(/^Edité/, 'editó').replace(/^Puse/, 'puso').replace(/^Uní/, 'unió').replace(/^Ejecuté/, 'ejecutó')
            .replace(/\.$/, '');
    }

    describeOpFailure(op, result) {
        const target = op.className || op.oldName
            || (op.sourceClass && op.targetClass ? `${op.sourceClass} → ${op.targetClass}` : 'el elemento indicado');

        if (result.status === 'not_found') return `No encontré "${target}" en el diagrama.`;
        if (result.status === 'locked') return `No pude modificar "${target}": lo está editando ${result.ownerName} ahora mismo.`;
        return result.error || `No pude ejecutar la acción sobre "${target}".`;
    }

    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // ==================== ESTADO DEL DIAGRAMA PARA EL BACKEND ====================

    buildDiagramSchema() {
        const classes = [];
        this.editor.graph.getElements().forEach((element) => {
            if (!isUmlClassElement(element)) return;
            const umlData = element.get('umlData') || {};
            classes.push({
                id: element.id,
                name: umlData.className || 'SinNombre',
                type: umlData.type || 'class',
                attributes: umlData.attributes || [],
                methods: umlData.methods || [],
            });
        });

        const relations = [];
        this.editor.graph.getLinks().forEach((link) => {
            // El link "clase asociativa" no es una relación clase-a-clase (su
            // target es OTRA relación). Sin este chequeo,
            // getSourceElement()/getTargetElement() de JointJS resuelven
            // recursivamente hasta un elemento real y se colaría como una
            // relación fantasma.
            if ((link.get('relationData') || {}).type === 'associationClassLink') return;

            const sourceElement = link.getSourceElement();
            const targetElement = link.getTargetElement();
            if (!sourceElement || !targetElement) return;

            const relationData = link.get('relationData') || {};
            relations.push({
                id: link.id,
                sourceId: sourceElement.id,
                targetId: targetElement.id,
                source: (sourceElement.get('umlData') || {}).className || 'Unknown',
                target: (targetElement.get('umlData') || {}).className || 'Unknown',
                type: relationData.type || 'association',
                sourceMultiplicity: relationData.sourceMultiplicity || '',
                targetMultiplicity: relationData.targetMultiplicity || '',
                name: relationData.name || '',
            });
        });

        return { classes, relations };
    }
}
