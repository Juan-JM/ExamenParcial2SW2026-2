// resources/js/diagram/DiagramWebSocketManager.js
// Módulo especializado para gestión de WebSockets
// Integra con la arquitectura modular existente
import { alertDialog } from './utils/modal.js';

export class DiagramWebSocketManager {
    constructor(editor) {
        this.editor = editor;
        this.echo = null;
        this.channel = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.sessionId = null;
        this.userId = null;

        // Ver el comentario grande en requestLock(): cuenta de referencias
        // por elemento + promesas en vuelo, para no duplicar pedidos de
        // lock cuando dos partes del código lo piden casi a la vez.
        this._lockRefCounts = new Map();
        this._lockPromises = new Map();

        console.log('🔌 DiagramWebSocketManager inicializado');
    }

    // ==================== INICIALIZACIÓN ====================

    async initialize() {
        try {
            // Obtener datos de sesión
            this.sessionId = window.diagramSessionId || 'default';
            this.userId = window.authUser?.id || 'anonymous_' + Date.now();

            console.log(`🔗 Conectando a sesión: ${this.sessionId}`);

            // Configurar Laravel Echo
            this.setupLaravelEcho();

            // Conectar al canal del diagrama (setupChannelEvents() se llama
            // DENTRO, antes de esperar la confirmación de suscripción — ver
            // el comentario en connectToChannel() sobre por qué el orden importa).
            await this.connectToChannel();

            this.startConnectionMonitor();

            console.log('✅ WebSocket Manager inicializado correctamente');
            return true;

        } catch (error) {
            console.error('❌ Error inicializando WebSockets:', error);
            this.showConnectionError(error);
            return false;
        }
    }

    setupLaravelEcho() {
        if (!window.Echo) {
            throw new Error('Laravel Echo no está disponible');
        }

        this.echo = window.Echo;
        console.log('📡 Laravel Echo configurado');
    }

    async connectToChannel() {
        const channelName = `diagram.${this.sessionId}`;

        // Canal de PRESENCIA (no privado): necesario para que .here()/.joining()/
        // .leaving() disparen y para ver quién está conectado ahora mismo.
        this.channel = this.echo.join(channelName);

        // IMPORTANTE: registrar los listeners (incluido .here()) ANTES de
        // esperar la confirmación de suscripción, no después. Pusher dispara
        // el evento interno que alimenta a .here() en el momento mismo en que
        // la suscripción se confirma; si el listener se agrega recién cuando
        // esa promesa ya resolvió, la llegada puede perderse (visto en la
        // práctica: un cliente veía la lista de presencia vacía al conectarse
        // a una sesión donde ya había otro colaborador).
        this.setupChannelEvents();

        // Verificar conexión
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout conectando al canal'));
            }, 10000);

            this.channel.subscribed(() => {
                clearTimeout(timeout);
                this.isConnected = true;
                this.reconnectAttempts = 0;
                console.log(`✅ Conectado al canal: ${channelName}`);
                resolve();
            });

            this.channel.error((error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    // ==================== EVENTOS DEL CANAL ====================

    setupChannelEvents() {
        // Eventos reales de servidor (broadcast auténtico, no whisper). El punto
        // inicial es necesario: broadcastAs() en el evento PHP devuelve el nombre
        // pelado, pero Echo antepone "App.Events." salvo que se le diga lo contrario
        // con un `.` inicial en .listen().
        this.channel.listen('.DiagramUpdated', (event) => {
            this.handleDiagramUpdate(event);
        });

        this.channel.listen('.UserJoinedSession', (event) => {
            this.handleUserJoined(event);
        });

        this.channel.listen('.UserLeftSession', (event) => {
            this.handleUserLeft(event);
        });

        this.channel.listen('.ElementLocked', (event) => {
            this.handleElementLocked(event);
        });

        this.channel.listen('.ElementUnlocked', (event) => {
            this.handleElementUnlocked(event);
        });

        this.channel.listen('.CollaboratorRoleChanged', (event) => {
            this.handleCollaboratorRoleChanged(event);
        });

        // Nota: la selección de elemento viaja por el mismo evento
        // DiagramUpdated de arriba (distinguida por updateType), como
        // broadcast real del servidor — es de baja frecuencia (un clic),
        // no hace falta optimizarla.
        //
        // La posición en vivo durante un arrastre SÍ es de alta frecuencia,
        // así que va por whisper (cliente-a-cliente directo sobre el
        // WebSocket, sin tocar el backend por cada frame). Con Reverb
        // autoalojado esto funciona out-of-the-box en cualquier canal
        // private/presence — a diferencia de Pusher, no depende de
        // habilitar "Client Events" a mano en un dashboard externo.
        this.channel.listenForWhisper('element-move', (payload) => {
            if (payload.userId === this.userId) return;
            this.editor.collaborationManager?.applyElementMovedLive(payload.elementId, payload.position);
        });

        // Eventos de presencia del canal (solo disparan en un canal `join()`).
        this.channel.here((users) => {
            this.handleUsersHere(users);
        });

        this.channel.joining((user) => {
            this.handleUserJoining(user);
        });

        this.channel.leaving((user) => {
            this.handleUserLeaving(user);
        });

        console.log('🎧 Event listeners configurados');
    }

    // ==================== MANEJADORES DE EVENTOS ====================

    handleDiagramUpdate(event) {
        if (event.userId === this.userId) {
            return; // Ignorar nuestros propios cambios
        }

        // La selección remota no es un cambio de contenido: se resuelve
        // directamente contra collaborationManager, usando el nombre/color
        // ya conocidos por presencia.
        if (event.updateType === 'element_selected') {
            // elementId null/vacío = "me deseleccioné" (clic en pizarra en
            // blanco): hay que soltar el resaltado, no aplicar uno nuevo.
            if (!event.data.elementId) {
                this.editor.collaborationManager?.clearRemoteSelection(event.userId);
                return;
            }

            const user = this.editor.collaborationManager?.getCollaboratorByUserId(event.userId);
            if (user) {
                this.editor.collaborationManager?.highlightRemoteSelection(event.data.elementId, user);
            }
            return;
        }

        console.log('📊 Actualización de diagrama recibida:', event);

        // Delegar al CollaborationManager
        if (this.editor.collaborationManager) {
            this.editor.collaborationManager.applyRemoteUpdate(event);
        }
    }

    handleUserJoined(event) {
        console.log(`👤 Usuario se unió: ${event.user.name}`);

        if (this.editor.collaborationManager) {
            this.editor.collaborationManager.addCollaborator(event.user);
        }

        this.showNotification(`${event.user.name} se unió al diagrama`, 'info');
    }

    handleUserLeft(event) {
        console.log(`👤 Usuario salió: ${event.user.name}`);

        // Esto también se dispara cuando el DUEÑO nos removió a NOSOTROS del
        // diagrama (ver DiagramSession::removeCollaborator) mientras lo
        // teníamos abierto — sin esto, se podía seguir editando desde esa
        // pestaña hasta cerrarla, aunque el acceso ya estuviera revocado en
        // el servidor.
        if (event.user.id === this.userId) {
            alertDialog({
                tone: 'warning',
                title: 'Ya no tienes acceso a este diagrama',
                message: 'El dueño te quitó de los colaboradores. Te llevamos a Mis Diagramas.',
                confirmLabel: 'Ir a Mis Diagramas',
            }).then(() => { window.location.href = '/diagrams'; });
            // Aunque no toque el botón, no puede seguir editando: se va igual.
            setTimeout(() => { window.location.href = '/diagrams'; }, 8000);
            return;
        }

        if (this.editor.collaborationManager) {
            this.editor.collaborationManager.removeCollaborator(event.user);
        }

        this.showNotification(`${event.user.name} salió del diagrama`, 'info');
    }

    /**
     * El dueño puede quitar o degradar a un colaborador mientras este sigue
     * con el diagrama abierto en su navegador — sin esto, seguiría editando
     * (o viendo controles que ya no le corresponden) hasta que recargara la
     * página por su cuenta. Solo actúa si el evento es sobre uno mismo.
     */
    handleCollaboratorRoleChanged(event) {
        if (event.userId !== this.userId) return;

        this.editor.readOnlyCollaborator = this.editor.viewerMode || event.role !== 'editor';
        window.collaboratorRole = event.role;

        this.showNotification(
            event.role === 'editor'
                ? 'Ahora puedes editar este diagrama'
                : 'El dueño cambió tu permiso a solo lectura',
            'info'
        );
    }

    handleUsersHere(users) {
        console.log('👥 Usuarios presentes:', users);

        if (this.editor.collaborationManager) {
            this.editor.collaborationManager.updateCollaboratorsList(users);

            // Un usuario que entra tarde debe ver de una los bloqueos ya
            // activos (el canal de presencia los incluye en su payload).
            users.forEach((user) => {
                if (user.lockedElementId && user.id !== this.userId) {
                    this.editor.collaborationManager.lockElement(user.lockedElementId, user);
                }
            });
        }
    }

    handleUserJoining(user) {
        this.handleUserJoined({ user });
    }

    handleUserLeaving(user) {
        this.handleUserLeft({ user });
    }

    handleElementLocked(event) {
        if (event.user.id === this.userId) return;

        if (this.editor.collaborationManager) {
            this.editor.collaborationManager.lockElement(event.elementId, event.user);
        }
    }

    handleElementUnlocked(event) {
        if (this.editor.collaborationManager) {
            this.editor.collaborationManager.unlockElement(event.elementId);
        }
    }

    // ==================== ENVÍO DE EVENTOS ====================
    // Los cambios que importa que lleguen sí o sí (crear/editar/borrar,
    // posición final, locks) pasan por el servidor (POST fire-and-forget a
    // /sync, que retransmite por Reverb de inmediato): un viaje de ida y
    // vuelta (~10-50ms en local), imperceptible, y a cambio queda persistido
    // en el estado del backend para quien se conecte después. Los datos
    // efímeros de altísima frecuencia (posición mientras se arrastra, ver
    // whisperElementMove) van directo cliente-a-cliente por whisper —
    // perder alguno no importa porque la posición final siempre llega por
    // la vía fiable.

    csrfToken() {
        return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    }

    /** Fire-and-forget: no bloquea la interacción del usuario ni espera respuesta. */
    syncToServer(type, data) {
        if (this.editor.viewerMode) return;
        if (!this.isConnected || !this.sessionId || this.sessionId === 'default') return;

        fetch(`/collaboration/sessions/${this.sessionId}/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': this.csrfToken(),
                'Accept': 'application/json',
            },
            body: JSON.stringify({ type, data }),
            keepalive: true,
        }).catch((error) => console.warn(`⚠️ No se pudo sincronizar "${type}":`, error));
    }

    broadcastDiagramUpdate(updateData) {
        // Las relaciones nuevas viajan con su id (ver createRelationshipFromConfig).
        if (updateData.type === 'relationship_created' && !updateData.data?.linkId) {
            const link = this.editor.relationshipManager?.lastCreatedLink;
            const data = updateData.data || {};
            if (link && link.get('source')?.id === data.sourceId && link.get('target')?.id === data.targetId) {
                updateData = { ...updateData, data: { ...data, linkId: link.id } };
            }
        }

        this.syncToServer(updateData.type, updateData.data);

        // Ver el comentario en AutoSaveManager.scheduleImmediateSave(): esto
        // acorta a ~1.5s (en vez de hasta 30s) la ventana en la que alguien
        // que recién abre el mismo diagrama podría ver una versión vieja.
        window.AutoSaveManager?.scheduleImmediateSave();
    }

    broadcastElementSelection(elementId) {
        this.syncToServer('element_selected', { elementId });
    }

    /** Fire-and-forget cliente-a-cliente: no pasa por el backend. */
    whisperElementMove(elementId, position) {
        if (!this.channel || this.editor.viewerMode) return;
        this.channel.whisper('element-move', { elementId, position, userId: this.userId });
    }

    /**
     * Distintas partes del editor piden el lock del MISMO elemento casi al
     * mismo tiempo — ej. seleccionar una clase (para el panel de
     * propiedades) y arrastrarla son el mismo gesto de mouse, y cada uno
     * pedía su propio lock por separado. Eso duplicaba el viaje a la red
     * (y su escritura en la base) por cada clic+arrastre, lo cual — en un
     * server de desarrollo de un solo proceso — se sentía como picos de
     * latencia real. _lockRefCounts lleva cuántas partes del código creen
     * tener el lock de cada elemento: solo se pide de verdad al servidor la
     * primera vez, y solo se libera de verdad cuando ya no lo necesita
     * nadie. _lockPromises además evita dos pedidos HTTP en simultáneo para
     * el mismo elemento si ambos piden el lock antes de que el primero
     * responda: el segundo espera la MISMA promesa en vez de disparar otra.
     */

    /** @returns {Promise<boolean>} true si se consiguió (o ya se tenía) el lock. */
    async requestLock(elementId) {
        if (!this.sessionId || this.sessionId === 'default') return true;

        const current = this._lockRefCounts.get(elementId) || 0;
        if (current > 0) {
            this._lockRefCounts.set(elementId, current + 1);
            return true;
        }

        let promise = this._lockPromises.get(elementId);
        if (!promise) {
            promise = this._requestLockHttp(elementId);
            this._lockPromises.set(elementId, promise);
            promise.finally(() => {
                if (this._lockPromises.get(elementId) === promise) {
                    this._lockPromises.delete(elementId);
                }
            });
        }

        const granted = await promise;
        if (granted) {
            this._lockRefCounts.set(elementId, (this._lockRefCounts.get(elementId) || 0) + 1);
        }
        return granted;
    }

    /**
     * A diferencia de requestLock(), esto SIEMPRE pega contra el servidor —
     * no pasa por _lockRefCounts/_lockPromises, porque su trabajo es otro:
     * el backend trata un lock sin renovar por 120s como abandonado (ver
     * Collaborator::LOCK_TTL_SECONDS) para poder recuperarlo si el dueño
     * real se colgó/cerró la pestaña sin avisar. Mientras el elemento siga
     * genuinamente seleccionado (panel o modal de relación abiertos), hay
     * que seguir pisando ese reloj — si no, alguien más podría robarse el
     * lock (o a los demás se les borra el borde rojo) por seguir mirando el
     * panel más de 2 minutos, no por haberlo soltado. Se llama periódicamente
     * desde donde se sostiene el lock (ver _startLockHeartbeat en editor.js
     * y editRelationshipImproved en DiagramRelationshipManager.js).
     */
    renewLock(elementId) {
        if (!this.sessionId || this.sessionId === 'default') return;
        if (!this._lockRefCounts.get(elementId)) return; // no lo tenemos nosotros, nada que renovar
        this._requestLockHttp(elementId).catch(() => {});
    }

    async _requestLockHttp(elementId) {
        try {
            const response = await fetch(`/collaboration/sessions/${this.sessionId}/lock`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': this.csrfToken(),
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ element_id: elementId }),
            });

            if (response.status === 409) {
                return false; // conflicto real: otro colaborador ya lo tiene
            }

            if (!response.ok) {
                // Cualquier otro error (500, 419 CSRF vencido, servidor
                // lento/caído) NO es un conflicto de bloqueo — no hay que
                // reportarlo como "otro usuario está editando esto", que es
                // engañoso y no tiene nada que ver con lo que realmente pasó.
                // El lock es "blando"/best-effort: fallar abierto (permitir)
                // es consistente con el resto de este método.
                console.warn(`⚠️ No se pudo confirmar el lock (HTTP ${response.status}), se permite editar igual`);
                return true;
            }

            return true;
        } catch (error) {
            console.warn('⚠️ No se pudo solicitar el lock (modo individual o sin red):', error);
            return true;
        }
    }

    releaseLock(elementId) {
        if (!this.sessionId || this.sessionId === 'default') return;

        const current = this._lockRefCounts.get(elementId) || 0;
        if (current > 1) {
            // Todavía lo necesita otra parte del código (ej. el panel de
            // propiedades sigue mostrando este elemento aunque el arrastre
            // ya terminó) — no liberar de verdad todavía.
            this._lockRefCounts.set(elementId, current - 1);
            return;
        }
        this._lockRefCounts.delete(elementId);

        fetch(`/collaboration/sessions/${this.sessionId}/unlock`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': this.csrfToken(),
                'Accept': 'application/json',
            },
            body: JSON.stringify({ element_id: elementId }),
        }).catch((error) => console.warn('⚠️ No se pudo liberar el lock:', error));
    }

    // ==================== GESTIÓN DE CONEXIÓN ====================

    async reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Máximo de intentos de reconexión alcanzado');
            this.showConnectionError('No se pudo reconectar al servidor');
            return false;
        }

        this.reconnectAttempts++;
        console.log(`🔄 Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

        try {
            // connectToChannel() ya registra los listeners por su cuenta
            // (setupChannelEvents() corre adentro) — llamarlo de nuevo acá
            // duplicaba cada listener por cada reconexión, así que cada
            // evento se procesaba N veces tras N reconexiones.
            await this.connectToChannel();
            console.log('✅ Reconectado exitosamente');
            return true;
        } catch (error) {
            console.error('❌ Error en reconexión:', error);

            // Esperar antes del siguiente intento
            setTimeout(() => {
                this.reconnect();
            }, 2000 * this.reconnectAttempts);

            return false;
        }
    }

    disconnect() {
        if (this.channel) {
            this.channel.unsubscribe();
            this.channel = null;
        }

        this.isConnected = false;
        clearInterval(this._pingInterval);
        console.log('🔌 WebSocket desconectado');
    }

    // ==================== INDICADOR DE CONEXIÓN / PING ====================
    // Mide la latencia real servidor+red (no solo si el WebSocket sigue
    // vivo) porque el problema reportado fue justamente eso: requests HTTP
    // lentos, no el canal de tiempo real en sí. Se combina con el estado de
    // la conexión de Reverb para dar una lectura completa: "conectado pero
    // con ping alto" es un estado real y distinto de "desconectado".

    startConnectionMonitor() {
        const pusherConnection = this.echo?.connector?.pusher?.connection;
        if (pusherConnection) {
            pusherConnection.bind('state_change', (states) => {
                this.renderConnectionStatus(states.current, this._lastPingMs);
            });
        }

        this.measurePing();
        this._pingInterval = setInterval(() => this.measurePing(), 6000);
    }

    async measurePing() {
        const start = performance.now();
        try {
            await fetch('/ping', { cache: 'no-store' });
            this._lastPingMs = Math.round(performance.now() - start);
        } catch (error) {
            this._lastPingMs = null;
        }

        const state = this.echo?.connector?.pusher?.connection?.state || 'unknown';
        this.renderConnectionStatus(state, this._lastPingMs);
    }

    renderConnectionStatus(connectionState, pingMs) {
        const el = document.getElementById('connection-status');
        const textEl = document.getElementById('connection-status-text');
        if (!el || !textEl) return;

        el.style.display = 'flex';

        if (connectionState !== 'connected') {
            const labels = { connecting: 'Conectando…', unavailable: 'Sin conexión', failed: 'Sin conexión', disconnected: 'Desconectado' };
            el.dataset.state = connectionState === 'connecting' ? 'connecting' : 'bad';
            textEl.textContent = labels[connectionState] || 'Reconectando…';
            return;
        }

        if (pingMs === null || pingMs === undefined) {
            el.dataset.state = 'bad';
            textEl.textContent = 'Sin respuesta del servidor';
            return;
        }

        if (pingMs < 150) {
            el.dataset.state = 'good';
            textEl.textContent = `Estable · ${pingMs}ms`;
        } else if (pingMs < 600) {
            el.dataset.state = 'slow';
            textEl.textContent = `Ping alto · ${pingMs}ms`;
        } else {
            el.dataset.state = 'bad';
            textEl.textContent = `Muy lento · ${pingMs}ms`;
        }
    }

    // ==================== UTILIDADES ====================

    showNotification(message, type = 'info') {
        if (this.editor.saveManager) {
            this.editor.saveManager.showSaveNotification(message, type);
        } else {
            console.log(`🔔 ${type.toUpperCase()}: ${message}`);
        }
    }

    showConnectionError(error) {
        const message = typeof error === 'string' ? error : 'Error de conexión WebSocket';
        this.showNotification(message, 'error');
    }

    getConnectionStatus() {
        return {
            connected: this.isConnected,
            sessionId: this.sessionId,
            userId: this.userId,
            reconnectAttempts: this.reconnectAttempts,
            channelName: this.channel ? `diagram.${this.sessionId}` : null
        };
    }

    // ==================== INTEGRACIÓN CON MÓDULOS EXISTENTES ====================
    // Nota: el guardado completo del diagrama ya no se difunde desde aquí — el
    // servidor lo hace de forma fiable en DiagramService::save() (evento
    // DiagramUpdated) cada vez que hay una sesión activa. Duplicarlo aquí solo
    // generaría dos recargas completas del diagrama por cada guardado.
    // La creación/edición/borrado de relaciones se difunde de forma explícita
    // desde DiagramRelationshipManager (no por monkey-patching): así el
    // handler remoto puede llamar a los mismos métodos sin generar un eco.

    integrateWithClassManager() {
        if (!this.editor.classManager) return;

        // Interceptar creación/actualización de clases
        const originalUpdate = this.editor.classManager.updateClassElement.bind(this.editor.classManager);

        this.editor.classManager.updateClassElement = (element, className, attributes, methods, type, uml25Config) => {
            const result = originalUpdate(element, className, attributes, methods, type, uml25Config);

            // Broadcast cambio de clase (con posición: si el otro colaborador
            // todavía no tiene este elemento —recién creado—, hace falta
            // para poder crearlo de una, no solo actualizarlo).
            this.broadcastDiagramUpdate({
                type: 'class_updated',
                data: {
                    elementId: element.id,
                    umlData: {
                        className,
                        attributes,
                        methods,
                        type,
                        uml25: uml25Config
                    },
                    position: element.position()
                }
            });

            return result;
        };

        console.log('🔗 Integrado con ClassManager');
    }
}

