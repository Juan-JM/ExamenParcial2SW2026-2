// resources/js/diagram/modules-ai/live/NovaLive.js
// "Nova en vivo": conversar con la IA por voz, de tú a tú. Es un módulo aparte del
// chat clásico (ai-chat/): comparte con él la conversación del equipo y la forma de
// ejecutar cambios, pero tiene su propia escucha, voz e interfaz.
// Ver documentacion/12-nova-en-vivo.md.
//
//   micrófono ─VAD─▶ frase ─Whisper─▶ texto ─▶ ¿me hablan a mí? ─▶ POST /live/utterance
//   Reverb ─▶ respuesta de Nova ─▶ ¿es mi turno? ─▶ Piper ─▶ altavoz ─▶ POST /live/done
//
// Si alguien habla mientras Nova piensa o contesta, la frase nueva se funde con la
// anterior (el servidor une los textos) y Nova responde la idea completa.

import { LivePanel } from './LivePanel.js';
import { LiveMic } from './LiveMic.js';
import { LiveVoice, resolveServiceUrl } from './LiveVoice.js';
import { detectWake, shouldMerge, waitPhrase, reactionPhrase } from './turns.js';

const STORE = { ambient: 'nova-live:ambient', listen: 'nova-live:listen' };
const LISTEN_MODES = ['mine', 'all', 'others', 'none'];

/** Si las operaciones de una respuesta no se confirman en este tiempo, se dice igual. */
const OPS_WAIT_MS = 25000;
const REACTION_GAP_MS = 25000;
const WATCHDOG_MS = 3000;
const CAPTION_MS = 4500;

function read(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function write(key, value) {
    try { localStorage.setItem(key, value); } catch { /* sin almacenamiento: no pasa nada */ }
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

export class NovaLive {
    /**
     * @param {object} editor el editor del diagrama
     * @param {object} aiChat el chat clásico: de él se toman el esquema del diagrama y el contexto de pantalla
     */
    constructor(editor, aiChat) {
        this.editor = editor;
        this.aiChat = aiChat;
        this.urls = window.liveAssistant || {};
        this.diagramId = window.diagramId || null;
        this.userId = String(window.authUser?.id ?? '');
        this.userName = window.authUser?.name || '';

        this.agent = { name: 'Nova', wakeWords: ['nova'] };
        this.config = { conversationWindowSeconds: 40, voiceServiceUrl: null };

        this.active = false;
        this.mini = false;
        this.muted = false;
        this.ambient = read(STORE.ambient, '1') === '1';
        this.listenMode = LISTEN_MODES.includes(read(STORE.listen, 'mine')) ? read(STORE.listen, 'mine') : 'mine';

        this.known = new Map(); // id -> mensaje, para saber a quién contesta cada respuesta
        this.spoken = new Set(); // respuestas ya dichas (o descartadas)
        this.pending = new Map(); // id de respuesta -> { message, text, requestId, isMine, speak }
        this.turn = null; // mi último pedido a Nova: { messageId, text, sentAt, state, spokenMs, opsApplied }
        this.floor = null;
        this.engagedUntil = 0;
        this.transcribing = 0;
        this.chain = Promise.resolve();
        this.speakingReplyId = null;
        this.lastReactionAt = 0;
        this.warnings = {};
        this.subscribed = false;
        this.captionTimer = null;
        this.watchdog = null;

        this.mic = new LiveMic({
            onSpeechStart: () => this.onSpeechStart(),
            onSpeechSustained: () => this.onSpeechSustained(),
            onSegment: (pcm, ms) => this.onSegment(pcm, ms),
            onSegmentDiscarded: () => this.onSegmentDiscarded(),
        });
        this.voice = new LiveVoice({
            serviceUrl: null,
            onSpeakingChange: (speaking) => {
                this.mic.setStrict(speaking);
                this.refreshMode();
                if (!speaking) this.tryAdvance();
            },
        });

        this.panel = new LivePanel({
            onMicToggle: () => this.toggleMute(),
            onAmbientToggle: () => this.toggleAmbient(),
            onListenMode: (mode) => this.setListenMode(mode),
            onSend: (text) => this.sendCommand(text),
            onMinimize: () => this.setMini(true),
            onExpand: () => this.setMini(false),
            onEnd: () => this.end(),
        }, () => this.orbLevel());
        this.panel.setAmbient(this.ambient);
        this.panel.setListenMode(this.listenMode);
        this.panel.setMuted(false);

        this.launcher = document.getElementById('nova-live-launch');
        this.launcher?.addEventListener('click', () => this.onLauncher());
        window.addEventListener('beforeunload', () => this.mic.stop());
    }

    // ==================== APERTURA Y CIERRE ====================

    onLauncher() {
        if (!this.active) this.open();
        else this.setMini(!this.mini);
    }

    async open() {
        if (this.active || !this.diagramId || !this.urls.stateUrl) return;

        this.active = true;
        this.mini = false;
        this.launcher?.classList.add('is-live');
        this.launcher?.setAttribute('aria-pressed', 'true');
        this.panel.show();
        this.panel.setMode('idle', 'Conectando…');

        // Dentro del clic: los navegadores solo dejan sonar si el usuario ya interactuó.
        await this.voice.unlock();

        try {
            await this.loadState();
        } catch (error) {
            console.error('NovaLive: no se pudo cargar la conversación', error);
            this.warn('state', 'No se pudo cargar la conversación del equipo. Recarga la página.');
        }

        this.subscribe();

        const health = await this.voice.health();
        this.warn('service', health ? null : 'No encuentro el servicio de voz. Inícialo con “npm run voice”. Mientras tanto puedes escribirle a Nova aquí abajo.');

        await this.startMic();
        this.watchdog = setInterval(() => this.watchFloor(), WATCHDOG_MS);
        this.refreshMode();
    }

    async startMic() {
        if (!this.mic.isSupported()) {
            this.setMuted(true);
            this.warn('mic', 'Este navegador no permite captar el micrófono así. Usa Chrome o Edge, o escríbele a Nova aquí abajo.');
            return;
        }

        try {
            await this.mic.start();
            this.warn('mic', null);
            this.setMuted(false);
        } catch (error) {
            this.setMuted(true);
            this.warn('mic', error?.name === 'NotAllowedError'
                ? 'Sin permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones, o escríbele a Nova aquí abajo.'
                : 'No se pudo abrir el micrófono. Revisa que no lo use otra aplicación.');
        }
    }

    end() {
        if (!this.active) return;

        const mine = this.turn && ['thinking', 'speaking'].includes(this.turn.state) ? this.turn.messageId : null;

        this.active = false;
        this.mic.stop();
        this.voice.stop();
        clearInterval(this.watchdog);
        clearTimeout(this.captionTimer);
        this.pending.clear();
        this.speakingReplyId = null;
        this.turn = null;
        this.transcribing = 0;
        this.chain = Promise.resolve();
        this.launcher?.classList.remove('is-live');
        this.launcher?.setAttribute('aria-pressed', 'false');
        this.panel.hide();

        // Si dejó a Nova hablándole al aire, el turno pasa a quien sigue.
        if (mine) this.postDone(mine);
    }

    setMini(mini) {
        this.mini = mini;
        this.panel.setMini(mini);
    }

    async loadState() {
        const state = await this.request(this.urls.stateUrl);

        this.agent = state.agent;
        this.config = state;
        this.voice.baseUrl = resolveServiceUrl(state.voiceServiceUrl);
        this.floor = state.floor;
        this.panel.setAgentName(state.agent.name);

        this.known = new Map(state.messages.map((message) => [message.id, message]));
        // Lo que ya estaba dicho en la conversación no se repite al abrir.
        state.messages.forEach((message) => this.spoken.add(message.id));
        this.panel.renderAll(state.messages.map((message) => this.decorate(message)));
        this.updateFloorBanner();
    }

    subscribe() {
        if (this.subscribed || !window.Echo) return;
        this.subscribed = true;

        try {
            window.Echo.private(`diagram-agent.${this.diagramId}`)
                .listen('.AgentMessagePosted', (event) => this.onMessage(event.message))
                .listen('.LiveFloorChanged', (event) => this.onFloor(event.floor))
                .listen('.ActivityRecorded', (event) => this.onActivity(event.entries));
        } catch (error) {
            console.error('NovaLive: no se pudo suscribir al canal', error);
        }
    }

    // ==================== PREFERENCIAS ====================

    toggleMute() {
        if (!this.mic.isRunning) {
            this.startMic().then(() => this.refreshMode());
            return;
        }
        this.setMuted(!this.muted);
    }

    setMuted(muted) {
        this.muted = muted;
        this.mic.setMuted(muted);
        this.panel.setMuted(muted);
        this.refreshMode();
    }

    toggleAmbient() {
        this.ambient = !this.ambient;
        write(STORE.ambient, this.ambient ? '1' : '0');
        this.panel.setAmbient(this.ambient);
    }

    setListenMode(mode) {
        if (!LISTEN_MODES.includes(mode)) return;
        this.listenMode = mode;
        write(STORE.listen, mode);
        this.panel.setListenMode(mode);
        if (mode === 'none') this.voice.stop();
    }

    warn(key, text) {
        if (text) this.warnings[key] = text;
        else delete this.warnings[key];
        this.panel.setWarning(Object.values(this.warnings)[0] || null);
    }

    // ==================== ESCUCHA ====================

    onSpeechStart() {
        // Mientras Nova habla, solo se baja el volumen: aún no se sabe si es una interrupción o un ruido.
        if (this.voice.isSpeaking) this.voice.duck(true);
        this.refreshMode();
    }

    /** Lleva hablando lo bastante como para no ser un ruido: si Nova hablaba, se calla. */
    onSpeechSustained() {
        if (this.voice.isSpeaking) this.voice.stop();
        this.refreshMode();
    }

    onSegmentDiscarded() {
        this.voice.duck(false);
        this.refreshMode();
    }

    onSegment(pcm) {
        this.transcribing++;
        this.refreshMode();

        // En fila: así las frases se procesan en el orden en que se dijeron.
        this.chain = this.chain.then(async () => {
            try {
                const text = await this.voice.transcribe(pcm);
                this.warn('service', null);
                await this.handleText(text);
            } catch (error) {
                console.warn('NovaLive: falló la transcripción', error);
                this.warn('service', 'El servicio de voz no responde. Revisa que esté encendido (“npm run voice”).');
            } finally {
                this.transcribing = Math.max(0, this.transcribing - 1);
                this.voice.duck(false);
                this.refreshMode();
                this.tryAdvance();
            }
        });
    }

    /** Qué hacer con lo que se acaba de oír. */
    async handleText(rawText) {
        const text = (rawText || '').trim();
        if (!text || !this.active) return;

        const wake = detectWake(text, this.agent.wakeWords);
        const engaged = Date.now() < this.engagedUntil;
        this.showCaption(text, 'me');

        if (wake.found && !wake.command) {
            // Solo dijo el nombre: se queda atento, como si lo hubieran llamado.
            this.engage();
            this.voice.speak('Dime.');
            return;
        }

        if (!wake.found && !engaged) {
            if (this.ambient) this.sendAmbient(text);
            return;
        }

        await this.sendCommand(wake.found ? wake.command : text);
    }

    engage() {
        this.engagedUntil = Date.now() + (this.config.conversationWindowSeconds || 40) * 1000;
    }

    // ==================== ENVÍO ====================

    async sendAmbient(text) {
        try {
            await this.request(this.urls.utteranceUrl, { text, addressed: false });
        } catch (error) {
            console.warn('NovaLive: no se pudo guardar la charla de fondo', error);
        }
    }

    /** Un pedido para Nova (hablado o escrito). Si continúa el anterior, se funde con él. */
    async sendCommand(text) {
        const command = (text || '').trim();
        if (!command || !this.active) return;

        this.engage();

        const previous = this.turn;
        const supersedes = previous && previous.state !== 'done' && shouldMerge({
            prevText: previous.text,
            spokenMs: previous.spokenMs,
            gapMs: Date.now() - previous.sentAt,
            opsApplied: previous.opsApplied,
        }) ? previous.messageId : null;

        this.panel.setMode('thinking');

        let result;
        try {
            result = await this.request(this.urls.utteranceUrl, {
                text: command,
                addressed: true,
                supersedes,
                diagramSchema: this.aiChat?.buildDiagramSchema?.() ?? null,
                context: this.aiChat?.uiContext?.() ?? null,
            });
        } catch (error) {
            this.note(error.message || 'No se pudo enviar el mensaje a Nova.');
            this.refreshMode();
            return;
        }

        const { message, queue, merged } = result;

        if (merged && previous) {
            // El pedido anterior ya no vale; su respuesta (si la hubo) tampoco.
            this.dropReplyTo(previous.messageId);
            this.panel.upsert({ id: previous.messageId, superseded: true });
        }

        this.known.set(message.id, message);
        this.panel.upsert(this.decorate(message));
        this.turn = {
            messageId: message.id,
            // Si se fundió, el texto completo es el que guardó el servidor.
            text: message.text,
            sentAt: Date.now(),
            state: 'thinking',
            spokenMs: 0,
            opsApplied: false,
        };

        if (queue) {
            // Nova está con otra persona: se avisa con cortesía y se espera el turno.
            const phrase = waitPhrase(this.userName, queue.servingName);
            if (this.voice.isSpeaking) this.voice.append(phrase);
            else this.voice.speak(phrase);
        }

        this.refreshMode();
    }

    // ==================== RESPUESTAS ====================

    onMessage(message) {
        if (!this.active) return;

        this.known.set(message.id, message);

        if (message.superseded) {
            this.panel.upsert(message);
            this.dropReplyTo(message.replyTo || message.id);
            if (this.speakingReplyId === message.id) this.voice.stop();
            return;
        }

        this.panel.upsert(this.decorate(message));

        if (message.role === 'assistant') this.onReply(message);
    }

    onReply(message) {
        const request = this.known.get(message.replyTo);

        // Solo las respuestas a pedidos hechos por voz: las del chat de texto las dice el chat clásico.
        if (request?.source !== 'live') return;

        const hasPendingOps = message.opsStatus === 'pending' && (message.ops || []).length > 0;
        const isMine = message.executorUserId != null
            ? String(message.executorUserId) === this.userId
            : String(request.authorId) === this.userId;

        if (isMine && this.turn?.messageId === request.id && (message.ops || []).length > 0) this.turn.opsApplied = true;

        if (this.spoken.has(message.id)) return;

        if (hasPendingOps) {
            // Se espera a que quien pidió el cambio lo aplique, para contar lo que realmente pasó.
            setTimeout(() => {
                const latest = this.known.get(message.id);
                if (!this.spoken.has(message.id) && latest?.opsStatus === 'pending') this.queueReply(latest, request, isMine);
            }, OPS_WAIT_MS);
            return;
        }

        this.queueReply(message, request, isMine);
    }

    queueReply(message, request, isMine) {
        if (this.spoken.has(message.id) || this.pending.has(message.id)) return;

        const text = [message.text, message.opsSummary].filter(Boolean).join('. ');
        if (!text) return;

        const speak = {
            mine: isMine,
            all: true,
            others: !isMine,
            none: false,
        }[this.listenMode];

        this.pending.set(message.id, { message, text, requestId: request.id, isMine, speak });
        this.tryAdvance();
    }

    /** Descarta lo que estaba por decirse de un pedido que se fundió con otro. */
    dropReplyTo(requestId) {
        this.pending.forEach((entry, id) => {
            if (entry.requestId === requestId) {
                this.pending.delete(id);
                this.spoken.add(id);
            }
        });
    }

    /**
     * Dice la siguiente respuesta si es su turno. Nada empieza mientras alguien habla
     * (tú o Nova) o se está entendiendo una frase, para no pisarse.
     */
    tryAdvance() {
        if (!this.active || this.voice.isSpeaking || this.mic.isSpeaking || this.transcribing > 0) return;

        const current = this.floor?.currentMessageId ?? null;

        for (const [id, entry] of this.pending) {
            if (current !== null && current !== entry.requestId) continue;

            if (!entry.speak) {
                // No la voy a decir: si era mía, el turno no tiene por qué esperar mi voz.
                this.pending.delete(id);
                this.spoken.add(id);
                if (entry.isMine) this.finishTurn(entry.requestId);
                continue;
            }

            this.startSpeaking(id, entry);
            return;
        }
    }

    async startSpeaking(id, entry) {
        this.pending.delete(id);
        this.spoken.add(id);
        this.speakingReplyId = id;

        const mineTurn = entry.isMine && this.turn?.messageId === entry.requestId ? this.turn : null;
        if (mineTurn) mineTurn.state = 'speaking';

        this.refreshMode();

        const result = await this.voice.speak(entry.text, {
            onChunk: (chunk) => this.showCaption(chunk, 'nova', { sticky: true }),
            onProgress: ({ spokenMs }) => { if (mineTurn) mineTurn.spokenMs = spokenMs; },
        });

        if (this.speakingReplyId === id) this.speakingReplyId = null;
        clearTimeout(this.captionTimer);
        this.panel.setCaption('');

        if (mineTurn) {
            mineTurn.spokenMs = result.spokenMs;
            // Cortada por la persona: queda como candidata a fundirse con lo que diga a continuación.
            mineTurn.state = result.completed ? 'done' : 'interrupted';
        }

        if (result.completed && entry.isMine) this.engage();
        if (entry.isMine) this.finishTurn(entry.requestId);

        this.refreshMode();
        this.tryAdvance();
    }

    finishTurn(requestId) {
        if (this.turn?.messageId === requestId && this.turn.state === 'thinking') this.turn.state = 'done';
        this.postDone(requestId);
    }

    async postDone(messageId) {
        try {
            const { floor } = await this.request(this.urls.doneUrl, { messageId });
            this.onFloor(floor);
        } catch (error) {
            console.warn('NovaLive: no se pudo liberar el turno', error);
        }
    }

    // ==================== TURNOS ====================

    onFloor(floor) {
        this.floor = floor;
        this.updateFloorBanner();
        this.refreshMode();
        this.tryAdvance();
    }

    updateFloorBanner() {
        const floor = this.floor;

        if (!floor?.currentMessageId) {
            this.panel.setFloor(null);
            return;
        }

        const itsMe = String(floor.currentUserId) === this.userId;
        const waiting = floor.queue.length - 1;

        if (itsMe) {
            this.panel.setFloor(waiting > 0 ? `${waiting} ${waiting === 1 ? 'persona espera' : 'personas esperan'} su turno` : null);
            return;
        }

        const iAmWaiting = floor.queue.some((entry) => String(entry.userId) === this.userId);
        const who = firstName(floor.currentUserName);
        this.panel.setFloor(iAmWaiting ? `${this.agent.name} atiende a ${who} · sigues tú` : `${this.agent.name} está atendiendo a ${who}`);
    }

    /** Si el turno de otra persona venció (cerró la pestaña, sin audio), se libera para que la fila avance. */
    watchFloor() {
        const floor = this.floor;
        if (!floor?.currentMessageId || !floor.expiresAt) return;

        const waitingOnIt = this.pending.size > 0 || this.turn?.state === 'thinking';
        if (waitingOnIt && floor.expiresAt * 1000 < Date.now()) this.postDone(floor.currentMessageId);
    }

    // ==================== CAMBIOS EN EL DIAGRAMA ====================

    /** Si alguien toca el diagrama mientras se conversa, Nova lo nota, como un compañero. */
    onActivity(entries) {
        if (!this.active || this.listenMode === 'none') return;

        const conversing = this.voice.isSpeaking || Date.now() < this.engagedUntil;
        if (!conversing || this.mic.isSpeaking || Date.now() - this.lastReactionAt < REACTION_GAP_MS) return;

        const entry = (entries || []).find((item) => (
            item.origin === 'manual'
            && String(item.actorId) !== this.userId
            && !/mov/i.test(item.action || '')
        ));
        const phrase = entry ? reactionPhrase(entry) : null;
        if (!phrase) return;

        this.lastReactionAt = Date.now();
        this.panel.upsert({ id: `react-${Date.now()}`, role: 'assistant', authorName: this.agent.name, text: phrase });

        if (this.voice.isSpeaking) this.voice.append(phrase);
        else this.voice.speak(phrase);
    }

    // ==================== PANTALLA ====================

    decorate(message) {
        return { ...message, mine: message.role === 'user' && String(message.authorId) === this.userId };
    }

    note(text) {
        this.panel.upsert({ id: `note-${Date.now()}`, role: 'system', text });
    }

    showCaption(text, who, { sticky = false } = {}) {
        this.panel.setCaption(text, who);
        clearTimeout(this.captionTimer);
        if (!sticky) this.captionTimer = setTimeout(() => this.panel.setCaption(''), CAPTION_MS);
    }

    orbLevel() {
        if (this.voice.isSpeaking) return this.voice.level;
        if (this.muted) return 0;
        return this.mic.isSpeaking ? this.mic.level : this.mic.level * 0.3;
    }

    /** Qué está pasando ahora, para la esfera y la etiqueta. */
    refreshMode() {
        if (!this.active) return;

        const thinking = this.turn?.state === 'thinking';
        const itsMyTurn = !this.floor?.currentMessageId || this.floor.currentMessageId === this.turn?.messageId;

        if (this.voice.isSpeaking) this.panel.setMode('speaking');
        else if (this.mic.isSpeaking) this.panel.setMode('capturing');
        else if (this.transcribing > 0) this.panel.setMode('transcribing');
        else if (thinking && itsMyTurn) this.panel.setMode('thinking');
        else if (thinking) this.panel.setMode('waiting', 'Esperando tu turno');
        else if (this.muted) this.panel.setMode('idle', 'Micrófono en pausa');
        else this.panel.setMode('idle');
    }

    // ==================== RED ====================

    async request(url, body = null) {
        if (!url) throw new Error('Nova en vivo no está disponible para este diagrama.');

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
        } catch {
            throw new Error('No se pudo conectar con el servidor (revisa tu conexión).');
        }

        let payload = null;
        try { payload = await response.json(); } catch { /* sin cuerpo JSON */ }

        if (!response.ok) throw new Error(payload?.message || 'El servidor no pudo procesar el pedido.');

        return payload;
    }
}
