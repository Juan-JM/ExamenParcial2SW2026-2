// resources/js/diagram/undo/DiagramUndoManager.js
// Deshacer / rehacer (Ctrl+Z / Ctrl+Y) POR USUARIO, en colaboración.
//
// - Cada navegador registra solo lo que hizo su propio usuario: ignora la carga
//   del diagrama, los cambios en vivo de otros colaboradores y las restauraciones.
// - Los cambios se agrupan por ráfagas, como en Word: todo lo hecho seguido
//   (sin pausas de más de IDLE_MS, sobre la misma selección) es UN paso. Mover
//   una clase, importar o un pedido a la IA también son un paso cada uno.
// - Deshacer no restaura "una foto": aplica el cambio propio al revés, campo por
//   campo, sobre el estado actual (ver undoMerge.js). Lo que otro usuario cambió
//   después se respeta y se avisa.
// - Lo aplicado se difunde a los demás y se guarda igual que una edición a mano.

import { isUmlClassElement } from '../DiagramElementFactory.js';
import { clone, same, mergeUmlData, mergeRelationData, mergeValue } from './undoMerge.js';

const IDLE_MS = 1000;
const MAX_STEPS = 100;

export class DiagramUndoManager {
    constructor(editor) {
        this.editor = editor;
        this.undoStack = [];
        this.redoStack = [];
        this.current = null;        // grupo abierto: { label, entries: Map(id -> entry), lastAt }
        this.suspended = 0;
        this.batchDepth = 0;
        this.dragStart = null;
        this.idleTimer = null;
        this.storageKey = `uml-undo:${window.diagramId || 'local'}:${window.authUser?.id || 'anon'}`;

        this.wrapLoading();
        this.wrapImports();
        this.listen();
        this.bindKeyboard();
        this.bindButtons();
        this.restore();
        this.refreshButtons();
    }

    get enabled() {
        return !this.editor.viewerMode && !this.editor.readOnlyCollaborator;
    }

    // ==================== QUÉ SE REGISTRA ====================

    shouldIgnore() {
        return !this.enabled
            || this.suspended > 0
            || !!this.editor.collaborationManager?.isProcessingUpdates;
    }

    suspend() { this.suspended++; }

    resume() { this.suspended = Math.max(0, this.suspended - 1); }

    /** Cargar o recargar el diagrama recrea todo: no es una acción del usuario. */
    wrapLoading() {
        const saveManager = this.editor.saveManager;
        ['recreateElementsFromData', 'loadDiagramData'].forEach((method) => {
            const original = saveManager[method]?.bind(saveManager);
            if (!original) return;
            saveManager[method] = (...args) => {
                this.suspend();
                try { return original(...args); } finally { this.resume(); }
            };
        });
    }

    /** Una importación completa (XMI o imagen) se deshace en un solo paso. */
    wrapImports() {
        [[this.editor.xmiImporter, 'importFromXML', 'importar XMI'], [this.editor.imageImporter, 'importFromImage', 'importar imagen']]
            .forEach(([importer, method, label]) => {
                if (!importer?.[method]) return;
                const original = importer[method].bind(importer);
                importer[method] = async (...args) => {
                    this.beginBatch(label);
                    try { return await original(...args); } finally { this.endBatch(); }
                };
            });
    }

    listen() {
        const graph = this.editor.graph;
        graph.on('add', (cell) => this.onAdd(cell));
        graph.on('remove', (cell) => this.onRemove(cell));
        graph.on('change:umlData', (cell) => this.onChange(cell, 'umlData'));
        graph.on('change:relationData', (cell) => this.onChange(cell, 'relationData'));
        graph.on('change:labels', (cell) => this.onChange(cell, 'labels'));

        // Solo el arrastre sobre ESTE paper es un movimiento propio (las
        // posiciones de otros llegan por whisper y también cambian `position`).
        this.editor.paper?.on('element:pointerdown', (view) => {
            this.dragStart = { id: view.model.id, position: { ...view.model.position() } };
        });
        this.editor.paper?.on('element:pointerup', (view) => this.onDragEnd(view.model));
    }

    isTracked(cell) {
        return cell.isLink() ? !!cell.get('relationData') : isUmlClassElement(cell);
    }

    snapshot(cell, overrides = {}) {
        if (cell.isLink()) {
            return clone({
                kind: 'link',
                relationData: cell.get('relationData') || {},
                labels: cell.get('labels') || [],
                source: cell.get('source') || {},
                target: cell.get('target') || {},
                vertices: cell.get('vertices') || [],
                ...overrides,
            });
        }
        return clone({
            kind: 'element',
            umlData: cell.get('umlData') || {},
            position: cell.position(),
            ...overrides,
        });
    }

    /** Entrada del grupo abierto para esta celda; la crea con su estado "antes". */
    entryFor(cell, before) {
        const group = this.openGroup();
        if (!group.entries.has(cell.id)) {
            group.entries.set(cell.id, { id: cell.id, before: before === undefined ? this.snapshot(cell) : before, after: null });
        }
        return group.entries.get(cell.id);
    }

    onAdd(cell) {
        if (this.shouldIgnore() || !this.isTracked(cell)) return;
        const entry = this.entryFor(cell, null);
        entry.after = this.snapshot(cell);
        this.touch();
    }

    onRemove(cell) {
        if (this.shouldIgnore() || !this.isTracked(cell)) return;
        const entry = this.entryFor(cell);
        entry.after = null;
        this.touch();
    }

    onChange(cell, attribute) {
        if (this.shouldIgnore() || !this.isTracked(cell)) return;
        // El "antes" es el valor previo del atributo que cambió; el resto sigue igual.
        const entry = this.entryFor(cell, this.snapshot(cell, { [attribute]: cell.previous(attribute) ?? (attribute === 'labels' ? [] : {}) }));
        if (entry.after !== null || entry.before !== null) entry.after = this.snapshot(cell);
        this.touch();
    }

    onDragEnd(cell) {
        const start = this.dragStart;
        this.dragStart = null;
        if (!start || start.id !== cell.id || this.shouldIgnore() || !isUmlClassElement(cell)) return;

        const position = cell.position();
        if (position.x === start.position.x && position.y === start.position.y) return;

        // Mover es un paso propio, separado de lo que se venía escribiendo.
        if (!this.batchDepth) this.closeGroup();
        const entry = this.entryFor(cell, this.snapshot(cell, { position: start.position }));
        entry.after = this.snapshot(cell);
        if (!this.batchDepth) this.closeGroup();
        else this.touch();
    }

    // ==================== AGRUPADO ====================

    openGroup() {
        if (!this.current) this.current = { label: null, entries: new Map(), lastAt: Date.now() };
        return this.current;
    }

    touch() {
        this.current.lastAt = Date.now();
        clearTimeout(this.idleTimer);
        if (!this.batchDepth) this.idleTimer = setTimeout(() => this.closeGroup(), IDLE_MS);
    }

    /** Cierra la ráfaga actual: pasa a ser un paso de la pila de deshacer. */
    closeGroup(label = null) {
        clearTimeout(this.idleTimer);
        const group = this.current;
        this.current = null;
        if (!group) return;

        const entries = [...group.entries.values()].filter((entry) => !same(entry.before, entry.after));
        if (entries.length === 0) return;

        // En la pila se guarda "cómo deshacerlo": del estado después al de antes.
        const step = {
            label: group.label || label || this.describe(entries),
            entries: entries.map((entry) => ({ id: entry.id, from: entry.after, to: entry.before })),
        };

        this.undoStack.push(step);
        if (this.undoStack.length > MAX_STEPS) this.undoStack.shift();
        this.redoStack = []; // una acción nueva invalida lo que se podía rehacer
        this.persist();
        this.refreshButtons();
    }

    /** Todo lo que pase entre beginBatch y endBatch es un solo paso (IA, importaciones). */
    beginBatch(label) {
        if (this.batchDepth === 0) {
            this.closeGroup();
            this.openGroup().label = label;
        }
        this.batchDepth++;
    }

    endBatch() {
        this.batchDepth = Math.max(0, this.batchDepth - 1);
        if (this.batchDepth === 0) this.closeGroup();
    }

    /**
     * Cambiar de selección también corta la ráfaga (como cambiar de párrafo en
     * Word). Excepción: seleccionar el elemento que la ráfaga ya venía tocando
     * (crear una clase la selecciona sola) no la corta, así "crear y completar
     * sus datos" es un solo paso.
     */
    boundary(selectedId = null) {
        if (this.batchDepth || !this.current) return;
        const ids = [...this.current.entries.keys()];
        if (selectedId && ids.length > 0 && ids.every((id) => id === selectedId)) return;
        this.closeGroup();
    }

    /** Restaurar una versión reemplaza todo el diagrama: el historial anterior ya no aplica. */
    reset() {
        clearTimeout(this.idleTimer);
        this.current = null;
        this.undoStack = [];
        this.redoStack = [];
        this.persist();
        this.refreshButtons();
    }

    describe(entries) {
        if (entries.length > 1) {
            const created = entries.filter((e) => !e.before).length;
            const deleted = entries.filter((e) => !e.after).length;
            const classes = entries.filter((e) => (e.before || e.after).kind === 'element');
            const relations = entries.length - classes.length;
            // Una clase con sus relaciones (borrarla arrastra las líneas conectadas).
            if (classes.length === 1 && relations > 0 && (deleted === entries.length || created === entries.length)) {
                const name = (classes[0].before || classes[0].after).umlData?.className || 'clase';
                const verb = deleted === entries.length ? 'eliminar' : 'crear';
                return `${verb} ${name} (con ${relations} ${relations === 1 ? 'relación' : 'relaciones'})`;
            }
            if (deleted === entries.length) return `eliminar ${deleted} elementos`;
            if (created === entries.length) return `crear ${created} elementos`;
            return `${entries.length} cambios`;
        }

        const [entry] = entries;
        const state = entry.after || entry.before;
        const name = state.kind === 'element' ? (state.umlData?.className || 'clase') : 'relación';
        if (!entry.before) return `crear ${name}`;
        if (!entry.after) return `eliminar ${name}`;
        if (state.kind === 'element' && same(entry.before.umlData, entry.after.umlData)) return `mover ${name}`;
        return `editar ${name}`;
    }

    // ==================== DESHACER / REHACER ====================

    canUndo() { return this.enabled && (this.undoStack.length > 0 || !!this.current?.entries.size); }

    canRedo() { return this.enabled && this.redoStack.length > 0; }

    undo() { this.run(this.undoStack, this.redoStack, 'Deshacer'); }

    redo() { this.run(this.redoStack, this.undoStack, 'Rehacer'); }

    run(source, target, verb) {
        if (!this.enabled) return;

        // Lo que se esté escribiendo en el panel de propiedades entra primero
        // en la ráfaga, y la ráfaga se cierra: Ctrl+Z deshace lo último completo.
        const panel = this.editor.propertiesPanel;
        if (panel?.currentElement && panel._applyTimer) {
            clearTimeout(panel._applyTimer);
            panel._applyTimer = null;
            panel.applyChanges();
        }
        this.closeGroup();

        const step = source.pop();
        if (!step) {
            this.flash(`Nada para ${verb.toLowerCase()}`);
            return;
        }

        const { applied, conflicts } = this.apply(step);

        // El paso inverso se arma con lo que REALMENTE cambió, así rehacer
        // (o volver a deshacer) no reintenta lo que se saltó por conflicto.
        if (applied.length > 0) {
            target.push({ label: step.label, entries: applied.map((e) => ({ id: e.id, from: e.to, to: e.from })) });
            if (target.length > MAX_STEPS) target.shift();
        }

        this.persist();
        this.refreshButtons();
        this.report(verb, step.label, applied.length, conflicts);
    }

    report(verb, label, appliedCount, conflicts) {
        if (conflicts.length === 0) {
            this.flash(`${verb}: ${label}`);
            return;
        }

        const detail = [...new Set(conflicts)].slice(0, 3).join('; ');
        const prefix = appliedCount > 0 ? `${verb} en parte (${label}). No se tocó` : `No se pudo ${verb.toLowerCase()} (${label}):`;
        this.editor.collaborationManager?.showLockConflictNotification
            ? this.editor.collaborationManager.showLockConflictNotification(`${prefix} ${detail}`)
            : this.flash(`${prefix} ${detail}`, 'error');
    }

    flash(message, type = 'info') {
        this.editor.saveManager?.showSaveNotification?.(message, type);
    }

    /**
     * Aplica cada entrada (from → to) sobre el estado actual. Orden: primero se
     * recrean clases, después relaciones (las que apuntan a otra relación al
     * final); al borrar, al revés.
     * @returns {{ applied: Array<{id, from, to}>, conflicts: string[] }}
     */
    apply(step) {
        const applied = [];
        const conflicts = [];
        const rank = (entry) => {
            const state = entry.to || entry.from;
            if (state.kind === 'element') return 0;
            return this.isLinkTarget(state) ? 2 : 1;
        };
        const removals = step.entries.filter((e) => e.from && !e.to).sort((a, b) => rank(b) - rank(a));
        const others = step.entries.filter((e) => !(e.from && !e.to)).sort((a, b) => rank(a) - rank(b));
        const removingIds = new Set(removals.map((e) => e.id));

        this.suspend();
        try {
            [...removals, ...others].forEach((entry) => {
                const result = this.applyEntry(entry, removingIds);
                if (result.applied) applied.push(result.applied);
                conflicts.push(...result.conflicts);
            });
        } finally {
            this.resume();
        }

        this.editor.updateCanvasInfo?.();
        return { applied, conflicts };
    }

    isLinkTarget(state) {
        const targetId = state.target?.id;
        const target = targetId ? this.editor.graph.getCell(targetId) : null;
        return state.relationData?.type === 'associationClassLink' || !!target?.isLink?.();
    }

    nameOf(state) {
        return state?.kind === 'element' ? `la clase ${state.umlData?.className || 'SinNombre'}` : 'la relación';
    }

    lockedByOther(id) {
        const owner = this.editor.collaborationManager?.getLockOwner?.(id);
        return this.editor.collaborationManager?.isLockedByOther?.(id) ? (owner?.userName || 'otro usuario') : null;
    }

    applyEntry(entry, removingIds) {
        const cell = this.editor.graph.getCell(entry.id);
        const state = entry.to || entry.from;
        const name = this.nameOf(state);

        const locker = cell ? this.lockedByOther(entry.id) : null;
        if (locker) return { applied: null, conflicts: [`${name} (la está editando ${locker})`] };

        // Recrear (deshacer un borrado o rehacer una creación).
        if (!entry.from) {
            if (cell) return { applied: null, conflicts: [] }; // ya existe
            return this.recreate(entry.id, entry.to);
        }

        // Borrar (deshacer una creación o rehacer un borrado).
        if (!entry.to) {
            if (!cell) return { applied: null, conflicts: [] }; // ya no está
            return this.removeCell(cell, entry.from, removingIds);
        }

        if (!cell) return { applied: null, conflicts: [`${name} (otro usuario la eliminó)`] };
        return state.kind === 'element' ? this.updateElement(cell, entry) : this.updateLink(cell, entry);
    }

    recreate(id, state) {
        if (state.kind === 'element') {
            const factory = this.editor.classManager?.elementFactory;
            if (!factory) return { applied: null, conflicts: [] };
            const uml = state.umlData || {};
            const element = factory.createClassElement(
                uml.className, uml.attributes || [], uml.methods || [],
                state.position.x, state.position.y, uml.type, this.editor.graph, uml.uml25 || null, id,
            );
            element.position(state.position.x, state.position.y); // la fábrica toma (x, y) como centro
            this.broadcast('class_updated', { elementId: id, umlData: element.get('umlData'), position: element.position() });
            return { applied: { id, from: null, to: this.snapshot(element) }, conflicts: [] };
        }

        const source = this.editor.graph.getCell(state.source?.id);
        const target = this.editor.graph.getCell(state.target?.id);
        if (!source || !target) return { applied: null, conflicts: ['la relación (una de sus clases ya no existe)'] };

        const data = state.relationData || {};
        const config = { ...data, id };
        const link = this.editor.relationshipManager?.createRelationshipFromConfig(data.type, source, target, config);
        if (!link) return { applied: null, conflicts: [] };
        if (state.labels) link.set('labels', clone(state.labels));
        if (state.vertices?.length) link.set('vertices', clone(state.vertices));

        this.broadcast('relationship_created', { sourceId: source.id, targetId: target.id, relationshipType: data.type, config, linkId: id });
        this.broadcast('relationship_updated', this.linkPayload(link));
        return { applied: { id, from: null, to: this.snapshot(link) }, conflicts: [] };
    }

    removeCell(cell, expected, removingIds) {
        const name = this.nameOf(expected);
        const key = expected.kind === 'element' ? 'umlData' : 'relationData';

        // Solo se borra si nadie la cambió después; mover no cuenta.
        if (!same(cell.get(key), expected[key])) {
            return { applied: null, conflicts: [`${name} (otro usuario la modificó; no se eliminó)`] };
        }

        // Borrar una clase arrastra sus relaciones: si alguna es de otro usuario, no se borra.
        const foreign = this.editor.graph.getConnectedLinks(cell).filter((link) => !removingIds.has(link.id));
        if (foreign.length > 0) {
            return { applied: null, conflicts: [`${name} (tiene relaciones que agregó otro usuario)`] };
        }

        const before = this.snapshot(cell);
        if (this.editor.selectedElement?.id === cell.id) {
            this.editor.selectedElement = null;
            this.editor.releaseAnyHeldLock?.();
        }
        if (this.editor.propertiesPanel?.currentElement?.id === cell.id) this.editor.propertiesPanel.discard();

        cell.remove();
        this.broadcast('element_deleted', { elementId: cell.id });
        return { applied: { id: cell.id, from: before, to: null }, conflicts: [] };
    }

    updateElement(element, entry) {
        const name = this.nameOf(entry.from);
        const before = this.snapshot(element);
        const conflicts = [];

        const uml = mergeUmlData(element.get('umlData'), entry.from.umlData, entry.to.umlData);
        conflicts.push(...uml.conflicts.map((field) => `${field} de ${name}`));

        const position = mergeValue(element.position(), entry.from.position, entry.to.position);
        if (position.conflict) conflicts.push(`la posición de ${name}`);

        if (!uml.changed && !position.changed) return { applied: null, conflicts };

        if (uml.changed) {
            const data = uml.value;
            this.editor.classManager.updateClassElement(element, data.className, data.attributes || [], data.methods || [], data.type, data.uml25 || null);
        }
        if (position.changed) element.position(position.value.x, position.value.y);

        this.broadcast('class_updated', { elementId: element.id, umlData: element.get('umlData'), position: element.position() });
        if (position.changed) this.broadcast('element_moved', { elementId: element.id, position: element.position() });

        // Si el panel muestra esta clase, se vuelve a pintar con los datos nuevos.
        const panel = this.editor.propertiesPanel;
        if (panel?.currentElement?.id === element.id) {
            panel.renderRightPanel();
            panel.renderBottomPanel();
        }

        return { applied: { id: element.id, from: before, to: this.snapshot(element) }, conflicts };
    }

    updateLink(link, entry) {
        const before = this.snapshot(link);
        const merged = mergeRelationData(link.get('relationData'), entry.from.relationData, entry.to.relationData);
        const conflicts = merged.conflicts.map((field) => `${field} de la relación`);
        if (!merged.changed) return { applied: null, conflicts };

        const data = merged.value;
        const typeChanged = data.type !== link.get('relationData')?.type;

        // Etiquetas: las del destino si todo se pudo revertir; si no, se arman de nuevo.
        const labels = conflicts.length === 0 && entry.to.labels
            ? clone(entry.to.labels)
            : this.editor.relationshipManager?.createRelationLabelsImproved(data.sourceMultiplicity, data.targetMultiplicity, data.name);
        if (labels) link.set('labels', labels);

        if (typeChanged) {
            const attrs = this.editor.classManager?.elementFactory?.getRelationshipAttrs(data.type);
            if (attrs) link.attr(attrs);
        }
        if (data.sourceAnchor) link.prop('source/anchor', { name: data.sourceAnchor === 'auto' ? 'distributedSide' : data.sourceAnchor });
        if (data.targetAnchor && data.type !== 'associationClassLink') {
            link.prop('target/anchor', { name: data.targetAnchor === 'auto' ? 'distributedSide' : data.targetAnchor });
        }
        link.set('relationData', data);
        this.editor.paper?.findViewByModel(link)?.render();

        this.broadcast('relationship_updated', this.linkPayload(link));
        return { applied: { id: link.id, from: before, to: this.snapshot(link) }, conflicts };
    }

    linkPayload(link) {
        const data = link.get('relationData') || {};
        return {
            linkId: link.id,
            labels: link.get('labels') || [],
            sourceAnchor: data.sourceAnchor || null,
            targetAnchor: data.targetAnchor || null,
            relationData: data,
        };
    }

    broadcast(type, data) {
        const ws = this.editor.webSocketManager;
        if (ws) ws.broadcastDiagramUpdate({ type, data });
        else window.AutoSaveManager?.scheduleImmediateSave();
    }

    // ==================== TECLADO, BOTONES, PERSISTENCIA ====================

    bindKeyboard() {
        document.addEventListener('keydown', (event) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            const key = event.key.toLowerCase();
            const isUndo = key === 'z' && !event.shiftKey;
            const isRedo = key === 'y' || (key === 'z' && event.shiftKey);
            if (!isUndo && !isRedo) return;

            // Dentro de un campo de texto, Ctrl+Z es el del navegador (deshace lo tipeado).
            const target = event.target;
            if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
            if (document.querySelector('.modal-overlay, .uml-modal-overlay')) return;

            event.preventDefault();
            isUndo ? this.undo() : this.redo();
        });
    }

    bindButtons() {
        this.undoButton = document.getElementById('undoBtn');
        this.redoButton = document.getElementById('redoBtn');
        this.undoButton?.addEventListener('click', () => this.undo());
        this.redoButton?.addEventListener('click', () => this.redo());
        if (!this.enabled) {
            this.undoButton?.classList.add('hidden');
            this.redoButton?.classList.add('hidden');
        }
    }

    refreshButtons() {
        const lastUndo = this.undoStack[this.undoStack.length - 1];
        const lastRedo = this.redoStack[this.redoStack.length - 1];
        if (this.undoButton) {
            this.undoButton.disabled = !this.canUndo();
            this.undoButton.title = lastUndo ? `Deshacer: ${lastUndo.label} (Ctrl+Z)` : 'Deshacer (Ctrl+Z)';
        }
        if (this.redoButton) {
            this.redoButton.disabled = !this.canRedo();
            this.redoButton.title = lastRedo ? `Rehacer: ${lastRedo.label} (Ctrl+Y)` : 'Rehacer (Ctrl+Y)';
        }
    }

    /** Sobrevive a recargar la pestaña (no a cerrarla), como el historial de un documento abierto. */
    persist() {
        try {
            sessionStorage.setItem(this.storageKey, JSON.stringify({ undo: this.undoStack, redo: this.redoStack }));
        } catch { /* sin almacenamiento: el historial vive solo en memoria */ }
    }

    restore() {
        try {
            const saved = JSON.parse(sessionStorage.getItem(this.storageKey) || 'null');
            if (saved) {
                this.undoStack = Array.isArray(saved.undo) ? saved.undo : [];
                this.redoStack = Array.isArray(saved.redo) ? saved.redo : [];
            }
        } catch { /* ignorado */ }
    }
}
