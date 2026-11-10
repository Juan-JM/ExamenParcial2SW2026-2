// resources/js/diagram/modules-ai/ai-chat/ActivityTracker.js
// Registra lo que hace ESTE usuario en el diagrama, para que la IA pueda responder
// "¿qué hizo fulano?". Observa el grafo e ignora tres casos que no son acciones
// de esta persona: la carga del diagrama, los cambios remotos de otro colaborador
// y las operaciones de la IA (esas se reportan aparte como autoría de la IA).

import { isUmlClassElement } from '../../DiagramElementFactory.js';

const FLUSH_DELAY_MS = 2500;

const RELATION_NAMES = {
    association: 'asociación',
    aggregation: 'agregación',
    composition: 'composición',
    inheritance: 'herencia',
    realization: 'realización',
    dependency: 'dependencia',
    associationClassLink: 'clase asociativa',
};

/** Nombres de las líneas agregadas y quitadas: "+ id: int" y "- id: int" son el mismo atributo. */
export function diffLines(before = [], after = []) {
    const name = (line) => String(line).replace(/^[+\-#~]\s*/, '').split(/[:(]/)[0].trim();
    const beforeNames = new Set(before.map(name));
    const afterNames = new Set(after.map(name));

    return {
        added: [...afterNames].filter((n) => n && !beforeNames.has(n)),
        removed: [...beforeNames].filter((n) => n && !afterNames.has(n)),
    };
}

/** Traduce el antes y el después de una clase a frases para el registro. */
export function describeClassChange(before, after) {
    const name = after.className || 'SinNombre';
    const changes = [];

    if (before.className && before.className !== after.className) {
        changes.push(`renombró ${before.className} a ${name}`);
    }

    const attributes = diffLines(before.attributes, after.attributes);
    attributes.added.forEach((n) => changes.push(`agregó el atributo ${n} a ${name}`));
    attributes.removed.forEach((n) => changes.push(`quitó el atributo ${n} de ${name}`));

    const methods = diffLines(before.methods, after.methods);
    methods.added.forEach((n) => changes.push(`agregó el método ${n} a ${name}`));
    methods.removed.forEach((n) => changes.push(`quitó el método ${n} de ${name}`));

    if (changes.length === 0 && JSON.stringify(before) !== JSON.stringify(after)) {
        changes.push(`editó la clase ${name}`);
    }

    return changes;
}

export class ActivityTracker {
    constructor(editor, send) {
        this.editor = editor;
        this.send = send;
        this.enabled = false;
        this.suspended = 0;
        this.pending = new Map(); // id del elemento -> { created, deleted, before, cell, isLink, last }
        this.origin = 'manual';
        this.dragStart = null;
        this.flushTimer = null;

        this.wrapLoading();
        this.wrapExportsAndImports();
        this.editor.graph.on('add', (cell) => this.onAdd(cell));
        this.editor.graph.on('remove', (cell) => this.onRemove(cell));
        this.editor.graph.on('change:umlData', (cell, value) => this.onChange(cell, cell.previous('umlData'), value));
        this.editor.graph.on('change:relationData', (cell, value) => this.onChange(cell, cell.previous('relationData'), value));

        // Las posiciones también llegan por whisper de otros colaboradores: solo
        // el gesto de arrastre sobre este paper es una acción de esta persona.
        this.editor.paper?.on('element:pointerdown', (view) => { this.dragStart = { id: view.model.id, position: view.model.position() }; });
        this.editor.paper?.on('element:pointerup', (view) => this.onDragEnd(view.model));
    }

    setEnabled(enabled) {
        this.enabled = enabled;
    }

    suspend() { this.suspended++; }

    resume() { this.suspended = Math.max(0, this.suspended - 1); }

    /** Cargar o recargar el diagrama crea todos los elementos de nuevo: no es actividad. */
    wrapLoading() {
        const saveManager = this.editor.saveManager;
        const original = saveManager.recreateElementsFromData.bind(saveManager);

        saveManager.recreateElementsFromData = (...args) => {
            this.suspend();
            try {
                return original(...args);
            } finally {
                this.resume();
            }
        };
    }

    /** Las exportaciones no cambian el grafo; las importaciones sí, pero con otro origen. */
    wrapExportsAndImports() {
        const exports = {
            exportToPNG: 'exportó el diagrama como PNG',
            exportToJPG: 'exportó el diagrama como JPG',
            exportToXMI: 'exportó el diagrama como XMI',
            generateJavaProject: 'generó el backend Spring Boot',
            generatePostmanCollection: 'generó la colección de Postman',
        };

        Object.entries(exports).forEach(([method, summary]) => {
            const original = this.editor[method]?.bind(this.editor);
            if (!original) return;

            this.editor[method] = (...args) => {
                this.push([{ action: 'EXPORT', summary }]);
                return original(...args);
            };
        });

        this.wrapImport(this.editor.xmiImporter, 'importFromXML', 'importó un archivo XMI');
        this.wrapImport(this.editor.imageImporter, 'importFromImage', 'importó el diagrama desde una imagen');
    }

    wrapImport(importer, method, summary) {
        if (!importer?.[method]) return;
        const original = importer[method].bind(importer);

        importer[method] = async (...args) => {
            this.flush();
            this.origin = 'import';
            try {
                const result = await original(...args);
                this.flush();
                this.push([{ action: 'IMPORT', summary, origin: 'import' }]);
                return result;
            } finally {
                this.origin = 'manual';
            }
        };
    }

    push(entries) {
        if (this.enabled) this.send(entries);
    }

    onDragEnd(cell) {
        const start = this.dragStart;
        this.dragStart = null;

        if (!start || start.id !== cell.id || this.shouldIgnore() || !isUmlClassElement(cell)) return;

        const position = cell.position();
        if (position.x === start.position.x && position.y === start.position.y) return;

        const entry = this.entryFor(cell);
        if (!entry.moveFrom) entry.moveFrom = start.position;
        entry.moveTo = position;
        this.scheduleFlush();
    }

    shouldIgnore() {
        return !this.enabled || this.suspended > 0 || this.editor.collaborationManager?.isProcessingUpdates;
    }

    entryFor(cell) {
        if (!this.pending.has(cell.id)) {
            this.pending.set(cell.id, { cell, isLink: cell.isLink(), created: false, deleted: false, before: null, origin: this.origin });
        }
        return this.pending.get(cell.id);
    }

    onAdd(cell) {
        if (this.shouldIgnore() || (!cell.isLink() && !isUmlClassElement(cell))) return;
        this.entryFor(cell).created = true;
        this.scheduleFlush();
    }

    onRemove(cell) {
        if (this.shouldIgnore() || (!cell.isLink() && !isUmlClassElement(cell))) return;

        const entry = this.entryFor(cell);
        entry.deleted = true;
        entry.last = cell.isLink() ? this.describeRelation(cell) : cell.get('umlData')?.className;
        this.scheduleFlush();
    }

    onChange(cell, before) {
        if (this.shouldIgnore()) return;

        const entry = this.entryFor(cell);
        if (entry.before === null) entry.before = before || {};
        this.scheduleFlush();
    }

    scheduleFlush() {
        // Un cambio hecho aquí: este navegador es el responsable de guardarlo
        // (también cubre caminos que no se difunden en vivo, como importar XMI).
        window.AutoSaveManager?.scheduleImmediateSave();

        clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
    }

    flush() {
        const entries = [];

        this.pending.forEach((entry, id) => {
            this.summarize(entry).forEach((item) => entries.push({ origin: entry.origin, ...item, elementId: String(id) }));
        });
        this.pending.clear();

        if (entries.length > 0) this.push(entries);
    }

    summarize(entry) {
        if (entry.created && entry.deleted) return [];
        return entry.isLink ? this.summarizeRelation(entry) : this.summarizeClass(entry);
    }

    summarizeClass(entry) {
        const uml = entry.cell.get('umlData') || {};

        if (entry.created) return [{ action: 'CREATE_CLASS', summary: `creó la clase ${uml.className || 'SinNombre'}`, after: uml }];
        if (entry.deleted) return [{ action: 'DELETE_CLASS', summary: `eliminó la clase ${entry.last || uml.className || 'SinNombre'}`, before: uml }];

        const items = entry.before
            ? describeClassChange(entry.before, uml).map((summary) => ({ action: 'EDIT_CLASS', summary, before: entry.before, after: uml }))
            : [];

        if (entry.moveTo) {
            items.push({ action: 'MOVE_CLASS', summary: `movió la clase ${uml.className || 'SinNombre'}`, before: entry.moveFrom, after: entry.moveTo });
        }

        return items;
    }

    summarizeRelation(entry) {
        const data = entry.cell.get('relationData') || {};

        if (entry.created) return [{ action: 'CREATE_RELATION', summary: `creó ${this.describeRelation(entry.cell)}`, after: data }];
        if (entry.deleted) return [{ action: 'DELETE_RELATION', summary: `eliminó ${entry.last}`, before: data }];
        return [{ action: 'EDIT_RELATION', summary: `editó ${this.describeRelation(entry.cell)}`, before: entry.before || null, after: data }];
    }

    describeRelation(link) {
        const data = link.get('relationData') || {};
        const kind = RELATION_NAMES[data.type] || 'relación';
        const source = this.classNameOfEnd(link.get('source'));
        const target = this.classNameOfEnd(link.get('target'));

        return `una ${kind} entre ${source} y ${target}`;
    }

    classNameOfEnd(end) {
        const cell = end?.id ? this.editor.graph.getCell(end.id) : null;
        return cell?.get('umlData')?.className || 'otra relación';
    }
}
