// =============================================================================
// resources/js/diagram/DiagramCollaborationManager.js
// Módulo especializado para gestión de colaboradores y cambios remotos
// =============================================================================

export class DiagramCollaborationManager {
    constructor(editor) {
        this.editor = editor;
        this.collaborators = new Map();
        this.remoteSelections = new Map();
        this.lockedElements = new Map(); // elementId -> { userId, userName, originalAttrs }
        this.updateQueue = [];
        this.isProcessingUpdates = false;

        // Colores para colaboradores
        this.collaboratorColors = [
            '#ef4444', '#f97316', '#eab308', '#22c55e',
            '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'
        ];
        this.colorIndex = 0;

        console.log('🤝 DiagramCollaborationManager inicializado');
    }

    // ==================== GESTIÓN DE COLABORADORES ====================

    addCollaborator(user) {
        if (this.collaborators.has(user.id)) {
            return; // Ya existe
        }

        const color = this.collaboratorColors[this.colorIndex % this.collaboratorColors.length];
        this.colorIndex++;

        const collaborator = {
            id: user.id,
            name: user.name,
            avatar: user.avatar,
            color: color,
            isOnline: true,
            joinedAt: Date.now(),
            lastActivity: Date.now()
        };

        this.collaborators.set(user.id, collaborator);
        this.updateCollaboratorsUI();

        console.log(`➕ Colaborador agregado: ${user.name}`, collaborator);
    }

    removeCollaborator(user) {
        if (!this.collaborators.has(user.id)) {
            return;
        }

        this.collaborators.delete(user.id);
        this.remoteSelections.delete(user.id);
        this.updateCollaboratorsUI();

        console.log(`➖ Colaborador removido: ${user.name}`);
    }

    updateCollaboratorsList(users) {
        // Limpiar colaboradores antiguos
        this.collaborators.clear();
        this.remoteSelections.clear();

        // Agregar usuarios actuales. Comparación laxa: Pusher entrega el
        // `user_id` de la autenticación de presencia como string, mientras
        // que window.authUser.id (usado como this.userId) es number.
        users.forEach(user => {
            if (String(user.id) !== String(this.editor.webSocketManager?.userId)) {
                this.addCollaborator(user);
            }
        });

        console.log(`👥 Lista de colaboradores actualizada: ${users.length} usuarios`);
    }

    /**
     * Pinta la barra de avatares a partir de this.collaborators, que se
     * mantiene al día con los eventos de PRESENCIA del canal (join/leave),
     * no con un timer — un colaborador aparece/desaparece para los demás en
     * el instante en que abre/cierra el diagrama, sin pedidos de más entre
     * medio (ver channel.here/joining/leaving en DiagramWebSocketManager).
     */
    updateCollaboratorsUI() {
        const barElement = document.getElementById('collaborators-bar');
        const listElement = document.getElementById('collaborators-list');
        const dividerElement = document.getElementById('collaborators-divider');
        if (!barElement || !listElement) return;

        if (this.collaborators.size === 0) {
            barElement.style.display = 'none';
            if (dividerElement) dividerElement.style.display = 'none';
            return;
        }

        barElement.style.display = 'flex';
        if (dividerElement) dividerElement.style.display = '';

        // Máximo 3 avatares visibles; si hay más, el cuarto es un ícono gris
        // "+N" en vez de seguir amontonando iniciales.
        const MAX_VISIBLE = 3;
        const collaborators = Array.from(this.collaborators.values());
        const visible = collaborators.slice(0, MAX_VISIBLE);
        const hiddenCount = collaborators.length - visible.length;

        listElement.innerHTML = visible.map(collaborator => `
            <div class="collaborator-avatar" style="background-color: ${collaborator.color};" title="${collaborator.name} · en línea">
                ${(collaborator.name || '?').trim().charAt(0).toUpperCase()}
            </div>
        `).join('') + (hiddenCount > 0 ? `
            <div class="collaborator-avatar collaborator-avatar-more" title="${hiddenCount} colaborador${hiddenCount === 1 ? '' : 'es'} más en línea">
                +${hiddenCount}
            </div>
        ` : '');
    }

    // ==================== APLICACIÓN DE CAMBIOS REMOTOS ====================

    applyRemoteUpdate(event) {
        this.lastRemoteActivityAt = Date.now();
        this.updateQueue.push(event);

        if (!this.isProcessingUpdates) {
            this.processUpdateQueue();
        }
    }

    async processUpdateQueue() {
        this.isProcessingUpdates = true;

        while (this.updateQueue.length > 0) {
            const event = this.updateQueue.shift();
            await this.processRemoteUpdate(event);
        }

        this.isProcessingUpdates = false;
    }

    async processRemoteUpdate(event) {
        try {
            switch (event.updateType) {
                case 'diagram_saved':
                    await this.applyDiagramUpdate(event.data);
                    break;

                case 'class_updated':
                    await this.applyClassUpdate(event.data);
                    break;

                case 'relationship_created':
                    await this.applyRelationshipCreation(event.data);
                    break;

                case 'element_deleted':
                    await this.applyElementDeletion(event.data);
                    break;

                case 'element_moved':
                    await this.applyElementMoved(event.data);
                    break;

                case 'relationship_updated':
                    await this.applyRelationshipUpdate(event.data);
                    break;

                default:
                    console.warn(`🤷 Tipo de actualización desconocido: ${event.updateType}`);
            }

            // Actualizar actividad del colaborador
            if (this.collaborators.has(event.userId)) {
                const collaborator = this.collaborators.get(event.userId);
                collaborator.lastActivity = Date.now();
            }

        } catch (error) {
            console.error('❌ Error procesando actualización remota:', error);
        }
    }

    async applyDiagramUpdate(diagramData) {
        // Aplicar cambios completos del diagrama
        if (this.editor.saveManager) {
            // Temporalmente deshabilitar broadcasting para evitar loops
            const originalBroadcast = this.editor.webSocketManager?.broadcastDiagramUpdate;
            if (originalBroadcast) {
                this.editor.webSocketManager.broadcastDiagramUpdate = () => {};
            }

            this.editor.saveManager.recreateElementsFromData(diagramData.cells);

            // Restaurar broadcasting
            if (originalBroadcast) {
                this.editor.webSocketManager.broadcastDiagramUpdate = originalBroadcast;
            }
        }

        console.log('🔄 Diagrama actualizado remotamente');
    }

    async applyClassUpdate(data) {
        const factory = this.editor.classManager?.elementFactory;
        if (!factory) return;

        let element = this.editor.graph.getCell(data.elementId);

        if (!element) {
            // No existe todavía en este cliente: no hay ningún broadcast
            // dedicado de "clase creada" (crear una clase real dispara este
            // mismo evento 'class_updated' apenas se abre el modal de
            // edición automático), así que si el elemento no existe hay que
            // crearlo acá mismo — si no, la clase nunca aparece para los
            // demás colaboradores hasta el próximo guardado/reconciliación.
            if (!data.position) return; // sin posición no se puede crear de forma sensata

            element = factory.createClassElement(
                data.umlData.className,
                data.umlData.attributes,
                data.umlData.methods,
                data.position.x,
                data.position.y,
                data.umlData.type,
                this.editor.graph,
                data.umlData.uml25,
                data.elementId
            );

            // createClassElement() espera un punto CENTRAL en (x, y) — pero
            // `data.position` viene de `element.position()` del emisor, que
            // en JointJS es la esquina superior-izquierda. En vez de duplicar
            // el cálculo de dimensiones acá, se corrige de una: se fuerza la
            // posición final exacta después de crear.
            element.position(data.position.x, data.position.y);

            console.log('🏷️ Clase creada remotamente:', data.umlData.className);
            return;
        }

        factory.updateClassElement(
            element,
            data.umlData.className,
            data.umlData.attributes,
            data.umlData.methods,
            data.umlData.type,
            data.umlData.uml25
        );

        // Ver el comentario en DiagramClassManager.updateClassElement:
        // un cambio de `markup` en un elemento ya renderizado no siempre
        // se repinta solo.
        this.editor.paper?.findViewByModel(element)?.render();

        console.log('🏷️ Clase actualizada remotamente:', data.umlData.className);
    }

    async applyRelationshipCreation(data) {
        const source = this.editor.graph.getCell(data.sourceId);
        const target = this.editor.graph.getCell(data.targetId);

        if (!source || !target || !this.editor.relationshipManager) return;

        this.editor.relationshipManager.createRelationshipFromConfig(
            data.relationshipType, source, target, { ...(data.config || {}), ...(data.linkId ? { id: data.linkId } : {}) }
        );

        console.log('🔗 Relación creada remotamente:', data.relationshipType);
    }

    async applyRelationshipUpdate(data) {
        const link = this.editor.graph.getCell(data.linkId);
        if (!link) return;

        if (data.labels) {
            link.set('labels', data.labels);
        }
        // Cambio de tipo (por ejemplo, al deshacer): también cambian las flechas.
        if (data.relationData?.type && data.relationData.type !== link.get('relationData')?.type) {
            const attrs = this.editor.classManager?.elementFactory?.getRelationshipAttrs(data.relationData.type);
            if (attrs) link.attr(attrs);
        }
        if (data.sourceAnchor) {
            link.prop('source/anchor', { name: data.sourceAnchor === 'auto' ? 'distributedSide' : data.sourceAnchor });
        }
        if (data.targetAnchor) {
            link.prop('target/anchor', { name: data.targetAnchor === 'auto' ? 'distributedSide' : data.targetAnchor });
        }
        link.set('relationData', data.relationData);

        // Igual que con las clases: forzar el repintado de la vista por si
        // el cambio de labels/anchors no se refleja solo en el SVG.
        this.editor.paper?.findViewByModel(link)?.render();

        console.log('🔗 Relación actualizada remotamente:', data.linkId);
    }

    async applyElementMoved(data) {
        this.lastRemoteActivityAt = Date.now();
        // La posición final manda: se corta el deslizamiento en vivo de ese elemento.
        this._liveTargets?.delete(data.elementId);
        const element = this.editor.graph.getCell(data.elementId);
        if (element && data.position) {
            element.position(data.position.x, data.position.y);
        }
    }

    /**
     * Posición en vivo mientras otro colaborador arrastra un elemento
     * (llega por whisper cada ~40 ms, fuera de la cola de actualizaciones fiables).
     *
     * Cada mensaje es un DESTINO: un bucle de requestAnimationFrame desliza el
     * elemento hacia él moviendo el modelo de JointJS en cada cuadro, así las
     * relaciones se recalculan junto con la caja. Antes:
     * - se animaba solo la caja con `transition: transform 80ms` y las líneas
     *   saltaban directo al final (se despegaban de la clase);
     * - o se saltaba de golpe cada 40 ms (25 saltos por segundo, las líneas
     *   quedaban quietas un instante entre mensaje y mensaje).
     * Sin transiciones CSS en los elementos del lienzo.
     */
    applyElementMovedLive(elementId, position) {
        if (!position) return;
        this.lastRemoteActivityAt = Date.now();

        if (!this._liveTargets) this._liveTargets = new Map();
        this._liveTargets.set(elementId, { x: position.x, y: position.y });
        if (!this._liveFrame) {
            this._liveLastTick = performance.now();
            this._scheduleLiveStep();
        }
    }

    /**
     * Próximo paso del deslizamiento: en el próximo cuadro o, si el navegador
     * no está dibujando cuadros (pestaña en segundo plano, WebView del celular
     * en ciertos estados), por temporizador. Sin este respaldo, con
     * requestAnimationFrame pausado los movimientos no se aplicaban nunca y la
     * vista "Ver" quedaba quieta.
     */
    _scheduleLiveStep() {
        let done = false;
        const run = () => {
            if (done) return;
            done = true;
            cancelAnimationFrame(rafId);
            clearTimeout(timerId);
            this._stepLiveMoves(performance.now());
        };
        const rafId = requestAnimationFrame(run);
        const timerId = setTimeout(run, 34);
        this._liveFrame = true;
    }

    _stepLiveMoves(now) {
        this._liveFrame = false;
        // Fracción del camino que se recorre por cuadro, independiente de los
        // FPS: alcanza el destino en ~70 ms, menos que el intervalo entre mensajes.
        const dt = Math.min(64, now - (this._liveLastTick || now));
        this._liveLastTick = now;
        const k = 1 - Math.exp(-dt / 25);

        this._liveTargets.forEach((target, id) => {
            const element = this.editor.graph.getCell(id);
            if (!element) {
                this._liveTargets.delete(id);
                return;
            }
            const current = element.position();
            const dx = target.x - current.x;
            const dy = target.y - current.y;
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
                element.position(target.x, target.y);
                this._liveTargets.delete(id);
                return;
            }
            element.position(current.x + dx * k, current.y + dy * k);
        });

        if (this._liveTargets.size > 0) this._scheduleLiveStep();
    }

    /** Hubo cambios en vivo de otro colaborador hace menos de `ms`. */
    hadRecentRemoteActivity(ms) {
        return !!this.lastRemoteActivityAt && Date.now() - this.lastRemoteActivityAt < ms;
    }

    async applyElementDeletion(data) {
        const element = this.editor.graph.getCell(data.elementId);
        if (element) {
            element.remove();
            console.log('🗑️ Elemento eliminado remotamente');
        }
    }

    // ==================== SELECCIONES REMOTAS ====================

    highlightRemoteSelection(elementId, user) {
        const element = this.editor.graph.getCell(elementId);
        if (!element) return;

        // No pisar el resaltado persistente de un bloqueo activo.
        if (this.lockedElements.has(elementId)) return;

        const collaborator = this.collaborators.get(user.id);
        if (!collaborator) return;

        // Limpiar selección anterior de este usuario
        this.clearRemoteSelection(user.id);

        const originalAttrs = this.captureOriginalAttrs(element);

        // Aplicar nuevo highlight
        if (element.isLink && element.isLink()) {
            element.attr('line/stroke', collaborator.color);
            element.attr('line/strokeWidth', 3);
        } else {
            element.attr('body/stroke', collaborator.color);
            element.attr('body/strokeWidth', 3);
            element.attr('body/strokeDasharray', '5,5');
        }

        // Auto-limpiar después de 5 segundos — si el usuario ya deselecciona
        // antes (clic en pizarra en blanco), clearRemoteSelection() cancela
        // este timeout explícitamente, así que no hace falta esperar.
        const expiryTimeout = setTimeout(() => {
            this.clearRemoteSelection(user.id);
        }, 5000);

        // Guardar selección
        this.remoteSelections.set(user.id, {
            elementId: elementId,
            element: element,
            user: user,
            originalAttrs,
            timestamp: Date.now(),
            expiryTimeout
        });

        console.log(`🎯 Selección remota de ${user.name} en elemento ${elementId}`);
    }

    clearRemoteSelection(userId) {
        const selection = this.remoteSelections.get(userId);
        if (!selection) return;

        clearTimeout(selection.expiryTimeout);
        this.restoreOriginalAttrs(selection.element, selection.originalAttrs);
        this.remoteSelections.delete(userId);
    }

    captureOriginalAttrs(element) {
        if (element.isLink && element.isLink()) {
            return {
                isLink: true,
                stroke: element.attr('line/stroke'),
                strokeWidth: element.attr('line/strokeWidth'),
            };
        }
        return {
            isLink: false,
            stroke: element.attr('body/stroke'),
            strokeWidth: element.attr('body/strokeWidth'),
            strokeDasharray: element.attr('body/strokeDasharray'),
        };
    }

    restoreOriginalAttrs(element, original) {
        if (!element || !original) return;

        if (original.isLink) {
            element.attr('line/stroke', original.stroke);
            element.attr('line/strokeWidth', original.strokeWidth);
        } else {
            element.attr('body/stroke', original.stroke);
            element.attr('body/strokeWidth', original.strokeWidth);
            element.attr('body/strokeDasharray', original.strokeDasharray);
        }
    }

    // ==================== BLOQUEO BLANDO POR ELEMENTO ====================

    lockElement(elementId, user) {
        const element = this.editor.graph.getCell(elementId);
        if (!element) return;

        const existing = this.lockedElements.get(elementId);
        if (existing) {
            // Ya lo teníamos marcado como bloqueado — esto es una RENOVACIÓN
            // (el que lo tiene sigue con el panel/modal abierto y manda un
            // nuevo lock periódicamente para no perderlo, ver renewLock() en
            // DiagramWebSocketManager.js). Solo hay que estirar el
            // vencimiento visual: no volver a pintar ni recapturar attrs
            // originales, eso pisaría lo guardado con el rojo ya aplicado.
            clearTimeout(existing.expiryTimeout);
            existing.expiryTimeout = setTimeout(() => this.unlockElement(elementId), 120000);
            existing.userId = user.id;
            existing.userName = user.name;
            return;
        }

        // Un lock manda sobre cualquier resaltado de selección efímero.
        this.clearRemoteSelection(user.id);

        const originalAttrs = this.captureOriginalAttrs(element);
        const lockColor = '#dc2626';

        if (element.isLink && element.isLink()) {
            element.attr('line/stroke', lockColor);
            element.attr('line/strokeWidth', 3);
        } else {
            element.attr('body/stroke', lockColor);
            element.attr('body/strokeWidth', 3);
            element.attr('body/strokeDasharray', '4,3');
        }

        // Salvo que se renueve (ver arriba), un lock sin actividad por 120s
        // se trata como abandonado — igual que el backend (ver
        // Collaborator::LOCK_TTL_SECONDS): si el ElementUnlocked se pierde
        // (desconexión, crash del otro cliente) sin esto el candado visual
        // quedaría pegado para siempre.
        const expiryTimeout = setTimeout(() => this.unlockElement(elementId), 120000);

        this.lockedElements.set(elementId, { userId: user.id, userName: user.name, originalAttrs, expiryTimeout });

        // El aviso ("Fulano está editando esto") NO se dispara acá — esto
        // corre para TODOS los demás colaboradores con solo que alguien
        // seleccione un elemento, así que mostraba el popup a todo el mundo
        // por el simple hecho de que otro haya hecho clic en algo. El borde
        // rojo (arriba) sí es para todos, como indicador visual pasivo; el
        // popup queda reservado para cuando alguien intenta específicamente
        // interactuar con el elemento ya bloqueado (ver onElementDoubleClick
        // en editor.js y handleRelationshipClick/editRelationship en
        // DiagramRelationshipManager.js).
    }

    unlockElement(elementId) {
        const lock = this.lockedElements.get(elementId);
        if (!lock) return;

        clearTimeout(lock.expiryTimeout);
        const element = this.editor.graph.getCell(elementId);
        this.restoreOriginalAttrs(element, lock.originalAttrs);
        this.lockedElements.delete(elementId);
    }

    /** @returns {{userId:number, userName:string}|null} */
    getLockOwner(elementId) {
        return this.lockedElements.get(elementId) || null;
    }

    isLockedByOther(elementId) {
        const lock = this.lockedElements.get(elementId);
        return !!lock && lock.userId !== this.editor.webSocketManager?.userId;
    }

    showSaveNotification(message, type) {
        this.editor.saveManager?.showSaveNotification(message, type);
    }

    /**
     * Popup transitorio en la esquina superior derecha del lienzo, para
     * avisos de "esto ya lo está editando otro usuario" — a diferencia de
     * showSaveNotification() (toast genérico abajo, usado para guardado/
     * exportación), este es específico de conflictos de bloqueo en vivo.
     */
    showLockConflictNotification(message) {
        const popup = document.getElementById('lock-conflict-popup');
        const textEl = document.getElementById('lock-conflict-text');
        if (!popup || !textEl) return;

        textEl.textContent = message;
        popup.style.display = 'block';
        // Forzar reflow para que la transición de opacidad se dispare
        // incluso si el popup ya estaba visible por un aviso anterior.
        void popup.offsetWidth;
        popup.classList.add('is-visible');

        clearTimeout(this._lockConflictTimeout);
        this._lockConflictTimeout = setTimeout(() => {
            popup.classList.remove('is-visible');
            setTimeout(() => { popup.style.display = 'none'; }, 150);
        }, 2500);
    }

    // ==================== UTILIDADES ====================

    getCollaboratorByUserId(userId) {
        return this.collaborators.get(userId);
    }

    getActiveCollaborators() {
        return Array.from(this.collaborators.values())
            .filter(collaborator => collaborator.isOnline);
    }

    getCollaborationStats() {
        return {
            totalCollaborators: this.collaborators.size,
            activeSelections: this.remoteSelections.size,
            updateQueueLength: this.updateQueue.length,
            isProcessingUpdates: this.isProcessingUpdates
        };
    }
}

