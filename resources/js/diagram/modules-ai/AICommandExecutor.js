// resources/js/diagram/modules-ai/AICommandExecutor.js
// Ejecuta las operaciones que devuelve el asistente de IA sobre el diagrama
// real — el mismo camino (DiagramClassManager/DiagramRelationshipManager/
// ElementFactory) que usa cualquier edición manual del usuario, así que se
// sincroniza en colaborativo igual que cualquier otro cambio.
//
// Cada método executeXxx() devuelve { status, ... } en vez de tirar
// excepciones para los casos esperables del dominio:
//   'ok'         → se ejecutó
//   'not_found'  → no existe una clase/relación con ese nombre
//   'ambiguous'  → hay ≥2 elementos con ese nombre; candidates trae las opciones
//   'locked'     → el elemento existe pero otro colaborador lo tiene bloqueado ahora
//   'error'      → algo salió mal (nombre duplicado, dato inválido, etc.), ver `error`
// Quien llama (AIChatController) decide la UX para cada status — este
// módulo no sabe nada de chat ni de cómo mostrar mensajes.

import * as joint from 'jointjs';

export class AICommandExecutor {
    constructor(editor) {
        this.editor = editor;
        // Estimación de tamaño usada SOLO para elegir un hueco libre antes
        // de que el elemento exista (ver findFreeTopLeftPosition) — una vez
        // creado, su tamaño real lo calcula DiagramElementFactory según el
        // contenido real (nombre/atributos/métodos).
        this.DEFAULT_ELEMENT_WIDTH = 220;
        this.DEFAULT_ELEMENT_HEIGHT = 130;
    }

    // ==================== EJECUCIÓN PRINCIPAL ====================

    async executeCommand(command) {
        switch (command.action) {
            case 'CREATE_CLASS':
                return await this.executeCreateClass(command);
            case 'DELETE_CLASS':
                return await this.executeDeleteClass(command);
            case 'RENAME_CLASS':
                return await this.executeRenameClass(command);
            case 'EDIT_CLASS':
                return await this.executeEditClass(command);
            case 'MOVE_CLASS':
                return await this.executeMoveClass(command);
            case 'ADD_ATTRIBUTE':
                return await this.executeAddAttribute(command);
            case 'EDIT_ATTRIBUTE':
                return await this.executeEditAttribute(command);
            case 'DELETE_ATTRIBUTE':
                return await this.executeDeleteAttribute(command);
            case 'ADD_METHOD':
                return await this.executeAddMethod(command);
            case 'EDIT_METHOD':
                return await this.executeEditMethod(command);
            case 'DELETE_METHOD':
                return await this.executeDeleteMethod(command);
            case 'CREATE_RELATION':
                return await this.executeCreateRelation(command);
            case 'EDIT_RELATION':
                return await this.executeEditRelation(command);
            case 'DELETE_RELATION':
                return await this.executeDeleteRelation(command);
            case 'EDIT_MULTIPLICITY':
                return await this.executeEditMultiplicity(command);
            case 'SET_RELATION_NAME':
                return await this.executeSetRelationName(command);
            case 'CREATE_ASSOCIATION_CLASS_LINK':
                return await this.executeCreateAssociationClassLink(command);
            default:
                return { status: 'error', error: `Comando no soportado: ${command.action}` };
        }
    }

    // ==================== RESOLUCIÓN DE TARGET (compartida) ====================

    /** Busca por id (si vino) y si no por nombre exacto, SIN chequear lock. */
    resolveClassByName(name, targetElementId) {
        if (targetElementId) {
            const byId = this.editor.graph.getCell(targetElementId);
            if (byId) return { status: 'ok', element: byId };
            // El id que mandó la IA ya no existe (el diagrama cambió entre
            // medio) — cae a buscar por nombre en vez de fallar directo.
        }

        const matches = this.editor.graph.getElements().filter((el) => {
            const umlData = el.get('umlData');
            return umlData?.className?.toLowerCase() === name?.toLowerCase();
        });

        if (matches.length === 0) return { status: 'not_found' };
        if (matches.length > 1) {
            return { status: 'ambiguous', candidates: matches.map((el) => this.describeCandidate(el)) };
        }
        return { status: 'ok', element: matches[0] };
    }

    /**
     * Igual que resolveClassByName pero además corta si está bloqueado por
     * otro colaborador. `ambiguousField` le dice a quien llama qué campo del
     * comando original hay que rellenar con el id elegido si el usuario
     * resuelve una ambigüedad (ver AIChatController.resumeAmbiguousOp).
     */
    resolveTarget(name, targetElementId) {
        const resolved = this.resolveClassByName(name, targetElementId);
        if (resolved.status !== 'ok') return { ...resolved, ambiguousField: 'targetElementId' };
        return this.applyLockCheck(resolved.element);
    }

    /** Resuelve una relación por los nombres de sus dos clases (cada una puede ser ambigua) y chequea el lock de LA RELACIÓN (no el de las clases). */
    resolveRelationTarget(sourceClass, targetClass, sourceElementId, targetElementId) {
        const source = this.resolveClassByName(sourceClass, sourceElementId);
        if (source.status !== 'ok') return { ...source, ambiguousField: 'sourceElementId' };

        const target = this.resolveClassByName(targetClass, targetElementId);
        if (target.status !== 'ok') return { ...target, ambiguousField: 'targetElementId' };

        const link = this.findRelationBetweenElements(source.element, target.element);
        if (!link) return { status: 'not_found' };

        return this.applyLockCheck(link);
    }

    applyLockCheck(element) {
        if (this.editor.collaborationManager?.isLockedByOther(element.id)) {
            const owner = this.editor.collaborationManager.getLockOwner(element.id);
            return { status: 'locked', element, ownerName: owner?.userName || 'otro colaborador' };
        }
        return { status: 'ok', element };
    }

    describeCandidate(element) {
        const umlData = element.get('umlData') || {};
        const attrs = (umlData.attributes || []).join(', ') || '(sin atributos)';
        return {
            id: element.id,
            className: umlData.className,
            summary: `${umlData.className} — ${attrs}`,
        };
    }

    // ==================== COMANDOS DE CLASES ====================

    async executeCreateClass(command) {
        const existing = this.resolveClassByName(command.className);
        if (existing.status !== 'not_found') {
            return { status: 'error', error: `Ya existe una clase llamada "${command.className}"` };
        }

        // command.position (coordenadas exactas) solo si la IA las mandó
        // explícitamente — no se le pide que haga geometría. Lo normal es
        // command.near (nombre de una clase existente, ej. "colocala al
        // lado de Cliente") o nada, y acá se calcula un hueco real que no
        // choque con lo que ya hay en el lienzo (ver findFreePosition).
        const position = command.position || this.findFreePosition(command.near || null, command.direction || 'right');
        const classType = command.classType === 'interface' ? 'interface' : 'class';
        const attributes = command.attributes || [];
        const methods = command.methods || [];
        const uml25 = command.uml25 || null;

        const element = this.editor.classManager.elementFactory.createClassElement(
            command.className,
            attributes,
            methods,
            position.x,
            position.y,
            classType,
            this.editor.graph,
            uml25,
        );

        // classManager.updateClassElement() (no elementFactory directo) es a
        // propósito: fuerza el repintado de la vista, actualiza el contador
        // "N clases" y dispara el broadcast a otros colaboradores (ver
        // DiagramWebSocketManager.integrateWithClassManager()) — igual que
        // pasa cuando un usuario humano crea una clase y le escribe el
        // nombre/atributos por primera vez en el panel. Sin este paso, la
        // clase quedaba mal pintada hasta recargar la página.
        this.editor.classManager.updateClassElement(element, command.className, attributes, methods, classType, uml25);

        this.animateElementEntry(element);
        return { status: 'ok', elementId: element.id };
    }

    async executeDeleteClass(command) {
        const resolved = this.resolveTarget(command.className, command.targetElementId);
        if (resolved.status !== 'ok') return resolved;

        const element = resolved.element;
        const elementId = element.id;

        this.editor.graph.getLinks().forEach((link) => {
            if (link.getSourceElement()?.id === elementId || link.getTargetElement()?.id === elementId) {
                const linkId = link.id;
                link.remove();
                this.editor.webSocketManager?.broadcastDiagramUpdate({ type: 'element_deleted', data: { elementId: linkId } });
            }
        });

        element.remove();
        this.editor.updateCanvasInfo();
        this.editor.webSocketManager?.broadcastDiagramUpdate({ type: 'element_deleted', data: { elementId } });

        return { status: 'ok' };
    }

    async executeRenameClass(command) {
        const resolved = this.resolveTarget(command.oldName, command.targetElementId);
        if (resolved.status !== 'ok') return resolved;

        const collision = this.resolveClassByName(command.newName);
        if (collision.status !== 'not_found') {
            return { status: 'error', error: `Ya existe una clase llamada "${command.newName}"` };
        }

        const element = resolved.element;
        const umlData = element.get('umlData') || {};
        this.editor.classManager.updateClassElement(
            element,
            command.newName,
            umlData.attributes || [],
            umlData.methods || [],
            umlData.type || 'class',
            umlData.uml25,
        );

        this.animateElementUpdate(element);
        return { status: 'ok', elementId: element.id };
    }

    /** Patch de metadata UML 2.5 (estereotipo, abstracta, tipos visibles, responsabilidades) — no toca el nombre. */
    async executeEditClass(command) {
        const resolved = this.resolveTarget(command.className, command.targetElementId);
        if (resolved.status !== 'ok') return resolved;

        const element = resolved.element;
        const umlData = element.get('umlData') || {};
        const mergedUml25 = { ...(umlData.uml25 || {}), ...(command.uml25 || {}) };

        this.editor.classManager.updateClassElement(
            element,
            umlData.className,
            umlData.attributes || [],
            umlData.methods || [],
            umlData.type || 'class',
            mergedUml25,
        );

        this.animateElementUpdate(element);
        return { status: 'ok', elementId: element.id };
    }

    async executeMoveClass(command) {
        const resolved = this.resolveTarget(command.className, command.targetElementId);
        if (resolved.status !== 'ok') return resolved;

        const element = resolved.element;
        let position = command.position;

        if (!position) {
            if (command.near) {
                // Pedido relativo explícito ("muévela debajo de X"): NO se
                // reubica sola "cerca" si ese lugar exacto está ocupado —
                // eso fue justamente el bug reportado (la clase terminaba en
                // otro lado sin avisar, y parecía "perdida"). Ahora se
                // chequea el lugar EXACTO pedido, nada más: libre → se
                // mueve ahí; ocupado → se informa y no se toca nada.
                const near = this.resolveClassByName(command.near, command.nearElementId);

                if (near.status === 'not_found') {
                    return { status: 'error', error: `No encontré la clase de referencia "${command.near}" para mover "${command.className}".` };
                }
                if (near.status === 'ambiguous') {
                    // ambiguousField apunta a "nearElementId" (no
                    // "targetElementId"): lo ambiguo acá es la clase de
                    // REFERENCIA, no la que se está moviendo (esa ya se
                    // resolvió sin problema arriba, en resolveTarget).
                    return { status: 'ambiguous', candidates: near.candidates, ambiguousField: 'nearElementId' };
                }

                const direction = command.direction || 'right';
                const ownSize = element.size();
                const slot = this.computeDirectionalSlot(near.element, direction, ownSize);
                const occupant = this.findOverlappingElement(slot.x, slot.y, ownSize.width, ownSize.height, element.id);

                if (occupant) {
                    const occupantName = occupant.get('umlData')?.className || 'otra clase';
                    return {
                        status: 'error',
                        error: `No pude mover "${command.className}" ${this.directionLabel(direction)} de "${command.near}": ya está "${occupantName}" ahí.`,
                    };
                }

                position = slot;
            } else {
                // Sin "near" ni "position": no hay un lugar pedido que se
                // pueda rechazar por ocupado, así que acá sí tiene sentido
                // reubicar en el primer hueco libre que se encuentre.
                position = this.findFreeTopLeftPosition(null, element.id, 'right', element.size());
            }
        }

        element.position(position.x, position.y);
        this.editor.webSocketManager?.broadcastDiagramUpdate({
            type: 'element_moved',
            data: { elementId: element.id, position: { x: position.x, y: position.y } },
        });

        this.animateElementUpdate(element);
        return { status: 'ok', elementId: element.id };
    }

    // ==================== COMANDOS DE ATRIBUTOS ====================

    async executeAddAttribute(command) {
        const resolved = this.resolveTarget(command.className, command.targetElementId);
        if (resolved.status !== 'ok') return resolved;

        const element = resolved.element;
        const umlData = element.get('umlData') || {};
        const currentAttributes = umlData.attributes || [];
        const attribute = this.formatAttribute(command.attribute);

        if (currentAttributes.some((attr) => attr.toLowerCase().includes(attribute.name.toLowerCase()))) {
            return { status: 'error', error: `El atributo "${attribute.name}" ya existe en "${umlData.className}"` };
        }

        const newAttributes = [...currentAttributes, attribute.formatted];
        this.editor.classManager.updateClassElement(
            element, umlData.className, newAttributes, umlData.methods || [], umlData.type || 'class', umlData.uml25,
        );

        this.animateElementUpdate(element);
        return { status: 'ok', elementId: element.id };
    }

    async executeEditAttribute(command) {
        const resolved = this.resolveTarget(command.className, command.targetElementId);
        if (resolved.status !== 'ok') return resolved;

        const element = resolved.element;
        const umlData = element.get('umlData') || {};
        const currentAttributes = umlData.attributes || [];
        const index = currentAttributes.findIndex((attr) => attr.toLowerCase().includes(command.oldAttribute.name.toLowerCase()));

        if (index === -1) {
            return { status: 'error', error: `No se encontró el atributo "${command.oldAttribute.name}" en "${umlData.className}"` };
        }

        const newAttribute = this.formatAttribute(command.newAttribute);
        const newAttributes = [...currentAttributes];
        newAttributes[index] = newAttribute.formatted;

        this.editor.classManager.updateClassElement(
            element, umlData.className, newAttributes, umlData.methods || [], umlData.type || 'class', umlData.uml25,
        );

        this.animateElementUpdate(element);
        return { status: 'ok', elementId: element.id };
    }

    async executeDeleteAttribute(command) {
        const resolved = this.resolveTarget(command.className, command.targetElementId);
        if (resolved.status !== 'ok') return resolved;

        const element = resolved.element;
        const umlData = element.get('umlData') || {};
        const currentAttributes = umlData.attributes || [];
        const newAttributes = currentAttributes.filter((attr) => !attr.toLowerCase().includes(command.attributeName.toLowerCase()));

        if (newAttributes.length === currentAttributes.length) {
            return { status: 'error', error: `No se encontró el atributo "${command.attributeName}" en "${umlData.className}"` };
        }

        this.editor.classManager.updateClassElement(
            element, umlData.className, newAttributes, umlData.methods || [], umlData.type || 'class', umlData.uml25,
        );

        this.animateElementUpdate(element);
        return { status: 'ok', elementId: element.id };
    }

    // ==================== COMANDOS DE MÉTODOS ====================

    async executeAddMethod(command) {
        const resolved = this.resolveTarget(command.className, command.targetElementId);
        if (resolved.status !== 'ok') return resolved;

        const element = resolved.element;
        const umlData = element.get('umlData') || {};
        const currentMethods = umlData.methods || [];
        const method = this.formatMethod(command.method);

        if (currentMethods.some((m) => m.toLowerCase().includes(method.name.toLowerCase()))) {
            return { status: 'error', error: `El método "${method.name}" ya existe en "${umlData.className}"` };
        }

        const newMethods = [...currentMethods, method.formatted];
        this.editor.classManager.updateClassElement(
            element, umlData.className, umlData.attributes || [], newMethods, umlData.type || 'class', umlData.uml25,
        );

        this.animateElementUpdate(element);
        return { status: 'ok', elementId: element.id };
    }

    async executeEditMethod(command) {
        const resolved = this.resolveTarget(command.className, command.targetElementId);
        if (resolved.status !== 'ok') return resolved;

        const element = resolved.element;
        const umlData = element.get('umlData') || {};
        const currentMethods = umlData.methods || [];
        const index = currentMethods.findIndex((m) => m.toLowerCase().includes(command.oldMethod.name.toLowerCase()));

        if (index === -1) {
            return { status: 'error', error: `No se encontró el método "${command.oldMethod.name}" en "${umlData.className}"` };
        }

        const newMethod = this.formatMethod(command.newMethod);
        const newMethods = [...currentMethods];
        newMethods[index] = newMethod.formatted;

        this.editor.classManager.updateClassElement(
            element, umlData.className, umlData.attributes || [], newMethods, umlData.type || 'class', umlData.uml25,
        );

        this.animateElementUpdate(element);
        return { status: 'ok', elementId: element.id };
    }

    async executeDeleteMethod(command) {
        const resolved = this.resolveTarget(command.className, command.targetElementId);
        if (resolved.status !== 'ok') return resolved;

        const element = resolved.element;
        const umlData = element.get('umlData') || {};
        const currentMethods = umlData.methods || [];
        const newMethods = currentMethods.filter((m) => !m.toLowerCase().includes(command.methodName.toLowerCase()));

        if (newMethods.length === currentMethods.length) {
            return { status: 'error', error: `No se encontró el método "${command.methodName}" en "${umlData.className}"` };
        }

        this.editor.classManager.updateClassElement(
            element, umlData.className, umlData.attributes || [], newMethods, umlData.type || 'class', umlData.uml25,
        );

        this.animateElementUpdate(element);
        return { status: 'ok', elementId: element.id };
    }

    // ==================== COMANDOS DE RELACIONES ====================

    async executeCreateRelation(command) {
        const source = this.resolveClassByName(command.sourceClass, command.sourceElementId);
        if (source.status !== 'ok') return { ...source, ambiguousField: 'sourceElementId' };

        const target = this.resolveClassByName(command.targetClass, command.targetElementId);
        if (target.status !== 'ok') return { ...target, ambiguousField: 'targetElementId' };

        if (this.findRelationBetweenElements(source.element, target.element, command.relationType)) {
            return { status: 'error', error: `Ya existe una relación ${command.relationType || 'association'} entre estas clases` };
        }

        const relationType = command.relationType || 'association';
        const sourceMultiplicity = command.sourceMultiplicity || '1';
        const targetMultiplicity = command.targetMultiplicity || '1';
        const relationName = command.relationName || '';

        const relationship = this.createRelationshipWithMultiplicity(
            source.element,
            target.element,
            relationType,
            sourceMultiplicity,
            targetMultiplicity,
            relationName,
        );

        // createRelationshipFromConfig() (llamado adentro) a propósito NO
        // difunde el cambio — el mismo método se usa para APLICAR una
        // relación que ya llegó de otro colaborador, y difundir ahí generaría
        // un eco infinito. La difusión es responsabilidad de quien crea la
        // relación de verdad (ver el handler del modal en
        // DiagramRelationshipManager.js) — acá hacemos lo mismo.
        this.editor.webSocketManager?.broadcastDiagramUpdate({
            type: 'relationship_created',
            data: {
                sourceId: source.element.id,
                targetId: target.element.id,
                relationshipType: relationType,
                config: { sourceMultiplicity, targetMultiplicity, name: relationName, sourceAnchor: 'auto', targetAnchor: 'auto' },
            },
        });

        this.animateRelationEntry(relationship);
        return { status: 'ok', relationId: relationship.id };
    }

    async executeEditRelation(command) {
        const resolved = this.resolveRelationTarget(command.sourceClass, command.targetClass);
        if (resolved.status !== 'ok') return resolved;

        const relation = resolved.element;
        const current = relation.get('relationData') || {};
        const modifications = command.modifications || {};

        if (modifications.relationType) this.configureRelationshipType(relation, modifications.relationType);

        this.applyRelationLabelsAndData(relation, {
            sourceMultiplicity: modifications.sourceMultiplicity ?? current.sourceMultiplicity ?? '',
            targetMultiplicity: modifications.targetMultiplicity ?? current.targetMultiplicity ?? '',
            name: modifications.relationName ?? current.name ?? '',
            type: modifications.relationType || current.type,
        });

        return { status: 'ok', relationId: relation.id };
    }

    async executeDeleteRelation(command) {
        const resolved = this.resolveRelationTarget(command.sourceClass, command.targetClass);
        if (resolved.status !== 'ok') return resolved;

        const linkId = resolved.element.id;
        resolved.element.remove();
        this.editor.webSocketManager?.broadcastDiagramUpdate({ type: 'element_deleted', data: { elementId: linkId } });

        return { status: 'ok' };
    }

    async executeEditMultiplicity(command) {
        const resolved = this.resolveRelationTarget(command.sourceClass, command.targetClass);
        if (resolved.status !== 'ok') return resolved;

        const current = resolved.element.get('relationData') || {};
        this.applyRelationLabelsAndData(resolved.element, {
            sourceMultiplicity: command.sourceMultiplicity,
            targetMultiplicity: command.targetMultiplicity,
            name: current.name || '',
            type: current.type,
        });

        return { status: 'ok', relationId: resolved.element.id };
    }

    async executeSetRelationName(command) {
        const resolved = this.resolveRelationTarget(command.sourceClass, command.targetClass);
        if (resolved.status !== 'ok') return resolved;

        const current = resolved.element.get('relationData') || {};
        this.applyRelationLabelsAndData(resolved.element, {
            sourceMultiplicity: current.sourceMultiplicity || '',
            targetMultiplicity: current.targetMultiplicity || '',
            name: command.relationName,
            type: current.type,
        });

        return { status: 'ok', relationId: resolved.element.id };
    }

    /**
     * Notación UML real de "clase asociativa": une una clase YA EXISTENTE
     * con línea punteada a una ASOCIACIÓN ya existente entre otras dos
     * clases (no crea la asociación en sí — ver DiagramAiPromptBuilder, el
     * modelo tiene que haberla creado antes con CREATE_RELATION si hacía
     * falta). El "target" de este link es la relación misma, no una clase
     * — ver DiagramElementFactory.isAssociationClassLink().
     */
    async executeCreateAssociationClassLink(command) {
        const classResult = this.resolveClassByName(command.className, command.classElementId);
        if (classResult.status !== 'ok') return { ...classResult, ambiguousField: 'classElementId' };

        const source = this.resolveClassByName(command.sourceClass, command.sourceElementId);
        if (source.status !== 'ok') return { ...source, ambiguousField: 'sourceElementId' };

        const target = this.resolveClassByName(command.targetClass, command.targetElementId);
        if (target.status !== 'ok') return { ...target, ambiguousField: 'targetElementId' };

        const hostLink = this.findRelationBetweenElements(source.element, target.element);
        if (!hostLink) {
            return { status: 'error', error: `No existe una asociación entre "${command.sourceClass}" y "${command.targetClass}" todavía — hay que crearla primero.` };
        }

        const hostType = (hostLink.get('relationData') || {}).type;
        if (!['association', 'aggregation', 'composition'].includes(hostType)) {
            return { status: 'error', error: 'Una clase asociativa solo puede unirse a una asociación, agregación o composición.' };
        }

        const alreadyAttached = this.editor.graph.getLinks().some((l) =>
            (l.get('relationData') || {}).type === 'associationClassLink' && l.get('target')?.id === hostLink.id
        );
        if (alreadyAttached) {
            return { status: 'error', error: 'Esa relación ya tiene una clase asociativa conectada.' };
        }

        const link = this.editor.relationshipManager.createRelationshipFromConfig(
            'associationClassLink', classResult.element, hostLink, {},
        );

        // createRelationshipFromConfig() no difunde por su cuenta (ver el
        // comentario equivalente en executeCreateRelation) — se reusa el
        // mismo tipo de evento 'relationship_created' que ya sabe manejar
        // DiagramCollaborationManager.applyRelationshipCreation() vía
        // graph.getCell(), que resuelve tanto elementos como links por igual.
        this.editor.webSocketManager?.broadcastDiagramUpdate({
            type: 'relationship_created',
            data: {
                sourceId: classResult.element.id,
                targetId: hostLink.id,
                relationshipType: 'associationClassLink',
                config: {},
            },
        });

        this.animateRelationEntry(link);
        return { status: 'ok', relationId: link.id };
    }

    // ==================== CREACIÓN/EDICIÓN DE RELACIONES (auxiliares) ====================

    createRelationshipWithMultiplicity(sourceElement, targetElement, type, sourceMultiplicity, targetMultiplicity, relationName) {
        if (this.editor.relationshipManager) {
            const relationship = this.editor.relationshipManager.createRelationshipFromConfig(
                type,
                sourceElement,
                targetElement,
                {
                    sourceMultiplicity: sourceMultiplicity || '',
                    targetMultiplicity: targetMultiplicity || '',
                    name: relationName || '',
                    sourceAnchor: 'auto',
                    targetAnchor: 'auto',
                },
            );

            if (relationship) return relationship;
        }

        // Fallback: crear directamente si no hay RelationshipManager o si falló
        const link = new joint.shapes.standard.Link({
            source: { id: sourceElement.id },
            target: { id: targetElement.id },
        });

        this.configureRelationshipType(link, type);
        this.editor.graph.addCell(link);
        this.applyRelationLabelsAndData(link, { sourceMultiplicity, targetMultiplicity, name: relationName, type }, { broadcast: false });

        return link;
    }

    /**
     * Único lugar que escribe `relationData` (así se llama de verdad el slot
     * de datos de una relación — `DiagramElementFactory`/`DiagramRelationshipManager`/
     * `DiagramSaveManager`/los generadores de código y XMI todos leen
     * `relationData`, NUNCA `linkData`) y reconstruye las labels con
     * `relationshipManager.createRelationLabelsImproved()`, la misma función
     * que usa el modal de edición manual — así una relación editada por la
     * IA se ve y se guarda IGUAL que una editada a mano. También difunde el
     * cambio a otros colaboradores, con la misma forma que espera
     * `DiagramCollaborationManager.applyRelationshipUpdate()`.
     */
    applyRelationLabelsAndData(relation, { sourceMultiplicity, targetMultiplicity, name, type }, { broadcast = true } = {}) {
        const current = relation.get('relationData') || {};

        const labels = this.editor.relationshipManager
            ? this.editor.relationshipManager.createRelationLabelsImproved(sourceMultiplicity, targetMultiplicity, name)
            : this.buildFallbackLabels(sourceMultiplicity, targetMultiplicity, name);

        relation.set('labels', labels);

        const relationData = {
            ...current,
            type: type || current.type || 'association',
            sourceMultiplicity: sourceMultiplicity || '',
            targetMultiplicity: targetMultiplicity || '',
            name: name || '',
        };
        relation.set('relationData', relationData);

        if (broadcast) {
            this.editor.webSocketManager?.broadcastDiagramUpdate({
                type: 'relationship_updated',
                data: {
                    linkId: relation.id,
                    labels,
                    sourceAnchor: relationData.sourceAnchor || 'auto',
                    targetAnchor: relationData.targetAnchor || 'auto',
                    relationData,
                },
            });
        }
    }

    /** Solo se usa si por algún motivo `relationshipManager` no está disponible (no debería pasar en la práctica). */
    buildFallbackLabels(sourceMultiplicity, targetMultiplicity, name) {
        const labels = [];
        if (sourceMultiplicity) labels.push({ position: 0.15, attrs: { text: { text: sourceMultiplicity, fontSize: 13, fill: '#374151', fontWeight: 'bold' } } });
        if (name) labels.push({ position: 0.5, attrs: { text: { text: name, fontSize: 14, fill: '#334155', fontWeight: 'bold' } } });
        if (targetMultiplicity) labels.push({ position: 0.85, attrs: { text: { text: targetMultiplicity, fontSize: 13, fill: '#374151', fontWeight: 'bold' } } });
        return labels;
    }

    configureRelationshipType(link, type) {
        const configs = {
            association: { attrs: { line: { stroke: '#1e40af', strokeWidth: 2 } } },
            inheritance: {
                attrs: {
                    line: { stroke: '#1e40af', strokeWidth: 2 },
                    'marker-target': { type: 'polygon', points: '0,0 10,5 0,10', fill: 'white', stroke: '#1e40af', strokeWidth: 2 },
                },
            },
            composition: {
                attrs: {
                    line: { stroke: '#1e40af', strokeWidth: 2 },
                    'marker-source': { type: 'polygon', points: '0,5 5,0 10,5 5,10', fill: '#1e40af', stroke: '#1e40af' },
                },
            },
            aggregation: {
                attrs: {
                    line: { stroke: '#1e40af', strokeWidth: 2 },
                    'marker-source': { type: 'polygon', points: '0,5 5,0 10,5 5,10', fill: 'white', stroke: '#1e40af', strokeWidth: 2 },
                },
            },
        };

        const config = configs[type] || configs.association;
        link.attr(config.attrs);
    }

    findRelationBetweenElements(sourceElement, targetElement, type = null) {
        const links = this.editor.graph.getLinks();
        return links.find((link) => {
            // OJO: getSourceElement()/getTargetElement() de JointJS NO dan
            // null para un link "clase asociativa" (target = otro link) —
            // resuelven recursivamente a través del link host hasta un
            // elemento real, así que sin este chequeo podría "matchear"
            // como si fuera una relación normal entre dos clases. Esta
            // función busca relaciones REALES clase-a-clase — nunca debe
            // devolver un conector de clase asociativa.
            if ((link.get('relationData') || {}).type === 'associationClassLink') return false;

            const source = link.getSourceElement();
            const target = link.getTargetElement();
            const connects = (source?.id === sourceElement.id && target?.id === targetElement.id)
                || (source?.id === targetElement.id && target?.id === sourceElement.id);
            if (!connects) return false;
            if (!type) return true;
            return (link.get('relationData') || {}).type === type;
        });
    }

    // ==================== FORMATEO ====================

    formatAttribute(attribute) {
        if (typeof attribute === 'string') {
            return { name: attribute, formatted: `- ${attribute}: String` };
        }

        const visibility = this.getVisibilitySymbol(attribute.visibility || 'private');
        const name = attribute.name || 'nuevoAtributo';
        const type = attribute.type || 'String';

        return { name, formatted: `${visibility} ${name}: ${type}` };
    }

    formatMethod(method) {
        if (typeof method === 'string') {
            return { name: method, formatted: `+ ${method}(): void` };
        }

        const visibility = this.getVisibilitySymbol(method.visibility || 'public');
        const name = method.name || 'nuevoMetodo';
        const returnType = method.returnType || 'void';

        return { name, formatted: `${visibility} ${name}(): ${returnType}` };
    }

    getVisibilitySymbol(visibility) {
        const symbols = { public: '+', private: '-', protected: '#', package: '~' };
        return symbols[visibility] || '-';
    }

    /**
     * Busca un hueco libre de verdad (chequea el bounding box real de CADA
     * elemento existente, no un conteo) — evita dos problemas del enfoque
     * anterior (un índice creciente basado en `graph.getElements().length`):
     * 1. Con muchas clases creadas/borradas en la sesión, el índice seguía
     *    subiendo y las nuevas terminaban lejísimos del área visible (el
     *    usuario "no las encontraba" aunque el contador sí las contara).
     * 2. No había forma de pedir "cerca de tal clase" — todo caía en la
     *    misma grilla ciega sin importar el contenido real del diagrama.
     *
     * Si `nearClassName` resuelve a una clase existente (sin ambigüedad),
     * arranca la búsqueda pegado a su borde derecho; si no, arranca cerca
     * del "borde" del conjunto de clases ya dibujadas (no en un punto fijo
     * que se aleja con el tiempo). Después expande en anillos concéntricos
     * hasta encontrar un rectángulo que no choque con ningún elemento
     * existente.
     *
     * `DiagramElementFactory.createClassElement(x, y, ...)` interpreta su
     * `x,y` como el CENTRO del rectángulo (`position: {x: x - width/2, y: y
     * - height/2}`), así que esto devuelve centro (usar para CREATE_CLASS).
     * Para MOVE_CLASS (que llama a `element.position(x,y)` directo, que SÍ
     * espera esquina) usar `findFreeTopLeftPosition` en cambio.
     */
    findFreePosition(nearClassName = null, direction = 'right') {
        const { x, y } = this.findFreeTopLeftPosition(nearClassName, null, direction);
        return { x: x + this.DEFAULT_ELEMENT_WIDTH / 2, y: y + this.DEFAULT_ELEMENT_HEIGHT / 2 };
    }

    /**
     * Igual que `findFreePosition` pero devuelve la esquina superior
     * izquierda tal cual (para `element.position(x,y)`, usado por
     * MOVE_CLASS) en vez de convertir a centro.
     *
     * @param {string|null} nearClassName - si resuelve a una clase existente (sin ambigüedad), arranca la búsqueda pegada a ese lado suyo.
     * @param {string|null} excludeElementId - id a ignorar al chequear choques (el propio elemento, cuando se lo está MOVIENDO — si no, "chocaría contra sí mismo" y nunca lo dejaría quedarse cerca de donde ya está).
     * @param {'right'|'left'|'above'|'below'} direction - de qué lado de `nearClassName` arrancar la búsqueda. Antes esto SIEMPRE era "right" sin importar lo que pidiera el usuario ("debajo de X", "arriba de X") — ahora se respeta.
     * @param {{width:number,height:number}|null} ownSize - tamaño real del elemento que se está ubicando, si ya se conoce (MOVE_CLASS lo conoce; CREATE_CLASS todavía no, usa la estimación por defecto).
     */
    findFreeTopLeftPosition(nearClassName = null, excludeElementId = null, direction = 'right', ownSize = null) {
        const W = ownSize?.width || this.DEFAULT_ELEMENT_WIDTH;
        const H = ownSize?.height || this.DEFAULT_ELEMENT_HEIGHT;
        // Antes 40 — reproducido en vivo (caso mínimo: dos clases con
        // exactamente 40px de gap y una asociación entre ellas): el router
        // custom "distributedSide" (relationshipAnchor.js) dibuja un
        // rulito/loop espurio en el medio de la línea cuando el hueco entre
        // los dos elementos conectados es demasiado chico — no es un bug de
        // geometría de ESTE archivo, es el router quedándose sin espacio
        // para trazar un camino limpio. Confirmado en vivo que con 80px el
        // rulito desaparece (60px todavía dejaba un zigzag chico). Afecta a
        // CREATE_CLASS/MOVE_CLASS con "near" Y a la importación de imagen
        // (`SimpleImageImporter`, que reusa este mismo método) — varias
        // clases ubicadas en cadena con "near"/"direction" quedaban con
        // rulitos en cada conexión por el mismo motivo.
        const PADDING = 80;
        const STEP_X = 260;
        const STEP_Y = 180;
        const MAX_RING = 15;

        const existingRects = this.editor.graph.getElements()
            .filter((el) => el.id !== excludeElementId)
            .map((el) => {
                const pos = el.position();
                const size = el.size();
                return { x: pos.x, y: pos.y, w: size.width || W, h: size.height || H };
            });

        const overlapsAny = (x, y, w, h) => existingRects.some((r) => (
            x < r.x + r.w + PADDING && x + w + PADDING > r.x
            && y < r.y + r.h + PADDING && y + h + PADDING > r.y
        ));

        let startX = 100;
        let startY = 100;

        if (nearClassName) {
            const near = this.resolveClassByName(nearClassName);
            if (near.status === 'ok' && near.element.id !== excludeElementId) {
                const slot = this.computeDirectionalSlot(near.element, direction, { width: W, height: H });
                startX = slot.x;
                startY = slot.y;
            }
        } else if (existingRects.length > 0) {
            // Debajo de TODO el conjunto ya dibujado, arrancando desde su
            // borde izquierdo — no al lado del borde derecho de la clase
            // más ancha (eso hacía que una clase suelta que quedó lejos a la
            // derecha "arrastrara" ahí a todas las próximas creaciones sin
            // ubicación pedida, alejándolas del área que el usuario está
            // mirando). Así las clases nuevas quedan pegadas al bloque
            // existente, como una fila nueva debajo, previsibles de
            // encontrar.
            startX = Math.min(...existingRects.map((r) => r.x));
            startY = Math.max(...existingRects.map((r) => r.y + r.h)) + PADDING;
        }

        if (!overlapsAny(startX, startY, W, H)) {
            return { x: startX, y: startY };
        }

        for (let ring = 1; ring <= MAX_RING; ring++) {
            for (let dy = -ring; dy <= ring; dy++) {
                for (let dx = -ring; dx <= ring; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;

                    const x = Math.max(20, startX + dx * STEP_X);
                    const y = Math.max(20, startY + dy * STEP_Y);

                    if (!overlapsAny(x, y, W, H)) {
                        return { x, y };
                    }
                }
            }
        }

        return { x: startX, y: startY };
    }

    /** Esquina superior izquierda pegada al lado `direction` de `nearElement`, para un rectángulo de `ownSize` — pura geometría, sin chequear si choca con nada. */
    computeDirectionalSlot(nearElement, direction, ownSize) {
        const nearPos = nearElement.position();
        const nearSize = nearElement.size();
        // Ver el comentario sobre PADDING en findFreeTopLeftPosition — mismo
        // valor, mismo motivo (el router necesita más de 40px para no
        // dibujar un rulito espurio en la línea).
        const PADDING = 80;

        switch (direction) {
            case 'left':
                return { x: nearPos.x - ownSize.width - PADDING, y: nearPos.y };
            case 'above':
                return { x: nearPos.x, y: nearPos.y - ownSize.height - PADDING };
            case 'below':
                return { x: nearPos.x, y: nearPos.y + nearSize.height + PADDING };
            case 'right':
            default:
                return { x: nearPos.x + nearSize.width + PADDING, y: nearPos.y };
        }
    }

    /** El primer elemento (si hay alguno) cuyo rectángulo choca con el rectángulo dado — usado para decir QUIÉN está ocupando un lugar, no solo que está ocupado. */
    findOverlappingElement(x, y, w, h, excludeElementId = null) {
        // Mismo PADDING que findFreeTopLeftPosition/computeDirectionalSlot —
        // si no coincidieran, un lugar que ESE método ofrece como "libre"
        // podría reportarse acá como "ocupado" (o viceversa).
        const PADDING = 80;
        return this.editor.graph.getElements().find((el) => {
            if (el.id === excludeElementId) return false;
            const pos = el.position();
            const size = el.size();
            return x < pos.x + size.width + PADDING && x + w + PADDING > pos.x
                && y < pos.y + size.height + PADDING && y + h + PADDING > pos.y;
        }) || null;
    }

    directionLabel(direction) {
        const labels = { right: 'al lado', left: 'a la izquierda', above: 'arriba', below: 'abajo' };
        return labels[direction] || 'cerca';
    }

    // ==================== ANIMACIONES (feedback visual al aplicar directo) ====================

    // OJO: `element.transition()`/`relation.transition()` sobre rutas
    // `attrs/*` NO funciona de forma confiable en este JointJS — se probó en
    // vivo (`el.transition('attrs/body/stroke', ...)`) y el valor se queda
    // pegado para siempre, sin tirar error ni avisar. Con un string no
    // numérico (`"scale(0.8)"`) directamente corrompe el valor
    // (`"scale(0.8)NaN"` real, visto en el modelo). Por eso ninguno de estos
    // helpers usa `.transition()` — todos hacen un set directo con
    // `setTimeout`, sin fundido suave. Si algún día se necesita una animación
    // realmente suave, hay que hacerla a mano con `requestAnimationFrame`
    // (o CSS transition sobre `view.el.style`), no confiar en este método de
    // JointJS para estas rutas.

    animateElementEntry(element) {
        if (!element) return;
        element.attr('body/opacity', 0.4);
        setTimeout(() => element.attr('body/opacity', 1), 200);
    }

    animateElementUpdate(element) {
        if (!element) return;

        const originalStroke = element.attr('body/stroke');
        const originalStrokeWidth = element.attr('body/strokeWidth');

        element.attr('body/stroke', '#10b981');
        element.attr('body/strokeWidth', 3);

        setTimeout(() => {
            // Negro (no el azul #1e40af que tenía este fallback antes) porque
            // ese es el color por defecto real de esta app hoy — ver
            // DiagramElementFactory.getDefaultColors() y el gotcha ya
            // documentado en 01-editor-diagrama.md sobre no restaurar bordes
            // a un color fijo hardcodeado.
            element.attr('body/stroke', originalStroke || '#000000');
            element.attr('body/strokeWidth', originalStrokeWidth || 2);
        }, 550);
    }

    animateRelationEntry(relation) {
        if (!relation) return;

        const originalStrokeWidth = relation.attr('line/strokeWidth');
        relation.attr('line/strokeWidth', 0);

        setTimeout(() => {
            relation.attr('line/strokeWidth', originalStrokeWidth || 2);
        }, 200);
    }
}
