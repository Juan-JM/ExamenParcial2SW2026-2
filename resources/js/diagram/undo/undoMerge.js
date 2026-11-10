// resources/js/diagram/undo/undoMerge.js
// Núcleo del "deshacer por usuario": aplica un cambio propio (estado `from` →
// estado `to`) sobre el estado ACTUAL del elemento, que puede tener cambios de
// otros colaboradores hechos después. Solo toca lo que ese cambio tocó, campo
// por campo y fila por fila; si alguien más cambió después ese mismo campo, no
// lo pisa y lo informa como conflicto.
//
// Ejemplo: A renombra "materia" → "materias"; B agrega el atributo "grado"; A
// deshace. Resultado: "materia" con "grado" (el nombre vuelve, el atributo de B
// se queda).
//
// Sin dependencias del navegador: se prueba con `npm run test:js`.

/** JSON con claves ordenadas: dos objetos iguales dan el mismo texto sin importar el orden de sus claves. */
export function stableStringify(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`;
}

/** Igualdad de contenido. `null`, `undefined`, `''`, `false` y `[]` cuentan como "vacío" y son iguales entre sí. */
export function same(a, b) {
    return stableStringify(normalizeEmpty(a)) === stableStringify(normalizeEmpty(b));
}

function normalizeEmpty(value) {
    if (value === undefined || value === null || value === '' || value === false) return null;
    if (Array.isArray(value) && value.length === 0) return null;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return null;
    return value;
}

export function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Fusión de tres vías de un valor indivisible.
 * @returns {{ value: any, changed: boolean, conflict: boolean }}
 */
export function mergeValue(current, from, to) {
    if (same(from, to)) return { value: current, changed: false, conflict: false }; // el cambio no tocó esto
    if (same(current, from)) return { value: clone(to), changed: true, conflict: false };
    if (same(current, to)) return { value: current, changed: false, conflict: false }; // ya está como se quiere
    return { value: current, changed: false, conflict: true }; // alguien lo cambió después: no se pisa
}

// ==================== FILAS DE ATRIBUTOS Y MÉTODOS ====================

function splitVisibility(line) {
    const text = String(line ?? '').trim();
    const match = text.match(/^([+\-#~])\s*/);
    return match ? { visibility: match[1], rest: text.slice(match[0].length) } : { visibility: '', rest: text };
}

function parseAttribute(line) {
    const { visibility, rest } = splitVisibility(line);
    const colon = rest.indexOf(':');
    return {
        visibility,
        name: (colon === -1 ? rest : rest.slice(0, colon)).trim(),
        type: colon === -1 ? '' : rest.slice(colon + 1).trim(),
    };
}

function serializeAttribute({ visibility, name, type }) {
    const head = visibility ? `${visibility} ${name}` : name;
    return type ? `${head}: ${type}` : head;
}

function parseMethod(line) {
    const { visibility, rest } = splitVisibility(line);
    const close = rest.lastIndexOf(')');
    const colon = rest.indexOf(':', close === -1 ? 0 : close);
    return {
        visibility,
        name: (colon === -1 ? rest : rest.slice(0, colon)).trim(),
        type: colon === -1 ? '' : rest.slice(colon + 1).trim(),
    };
}

const ROW_KINDS = {
    attributes: {
        parse: parseAttribute,
        serialize: serializeAttribute,
        flags: { derived: 'derivedAttributes', static: 'staticAttributes' },
        constraints: 'attributeConstraints',
        label: (row) => `el atributo ${row.name}`,
    },
    methods: {
        parse: parseMethod,
        serialize: serializeAttribute,
        flags: { abstract: 'abstractMethods', static: 'staticMethods' },
        constraints: 'methodConstraints',
        label: (row) => `el método ${row.name}`,
    },
};

/**
 * Pasa una lista de líneas ("+ id: int") y sus marcas por índice de uml25
 * (derivado, estático, restricción) a filas con identidad propia: el nombre.
 * Así, borrar o insertar una fila no corre las marcas de las demás.
 */
export function toRows(umlData, kind) {
    const spec = ROW_KINDS[kind];
    const uml25 = umlData?.uml25 || {};
    const seen = new Map();

    return (umlData?.[kind] || []).map((line, index) => {
        const parsed = spec.parse(line);
        const count = seen.get(parsed.name) || 0;
        seen.set(parsed.name, count + 1);

        const row = {
            key: count === 0 ? parsed.name : `${parsed.name}#${count}`,
            line,
            ...parsed,
            constraint: (uml25[spec.constraints] || [])[index] || '',
        };
        Object.entries(spec.flags).forEach(([flag, listName]) => {
            row[flag] = (uml25[listName] || []).includes(index);
        });
        return row;
    });
}

/** Lo inverso de toRows(): devuelve la lista de líneas y las marcas por índice. */
export function fromRows(rows, kind) {
    const spec = ROW_KINDS[kind];
    const result = { lines: [], flags: {}, constraints: [] };
    Object.values(spec.flags).forEach((listName) => { result.flags[listName] = []; });

    rows.forEach((row, index) => {
        result.lines.push(row.line);
        Object.entries(spec.flags).forEach(([flag, listName]) => {
            if (row[flag]) result.flags[listName].push(index);
        });
        result.constraints[index] = row.constraint || '';
    });

    return result;
}

const ROW_FIELDS = ['visibility', 'name', 'type', 'constraint', 'derived', 'static', 'abstract'];

function mergeRow(current, from, to, kind) {
    const merged = { ...current };
    let changed = false;
    let conflict = false;

    ROW_FIELDS.forEach((field) => {
        const result = mergeValue(current[field], from[field], to[field]);
        if (result.changed) {
            merged[field] = result.value;
            changed = true;
        }
        conflict ||= result.conflict;
    });

    if (changed && ['visibility', 'name', 'type'].some((field) => merged[field] !== current[field])) {
        merged.line = ROW_KINDS[kind].serialize(merged);
    }

    return { row: merged, changed, conflict };
}

/**
 * Fusión de tres vías de una lista de filas (atributos o métodos).
 * - Fila agregada por el cambio: se inserta si no está, junto a la fila que la precedía.
 * - Fila quitada por el cambio: se quita si sigue igual; si alguien la editó después, se deja.
 * - Fila editada: se fusiona campo por campo (tipo, visibilidad, restricción, marcas).
 */
export function mergeRows(currentRows, fromRows, toRows, kind) {
    const spec = ROW_KINDS[kind];
    const fromMap = new Map(fromRows.map((row) => [row.key, row]));
    const toMap = new Map(toRows.map((row) => [row.key, row]));
    let rows = currentRows.map((row) => ({ ...row }));
    const conflicts = [];
    let changed = false;

    const indexOf = (key) => rows.findIndex((row) => row.key === key);

    // Quitadas o editadas por el cambio.
    fromRows.forEach((fromRow) => {
        const toRow = toMap.get(fromRow.key);
        const index = indexOf(fromRow.key);

        if (!toRow) {
            if (index === -1) return; // ya no está
            if (sameRow(rows[index], fromRow)) {
                rows.splice(index, 1);
                changed = true;
            } else {
                conflicts.push(`${spec.label(fromRow)} (otro usuario lo modificó después)`);
            }
            return;
        }

        if (sameRow(fromRow, toRow)) return;

        if (index === -1) {
            conflicts.push(`${spec.label(fromRow)} (otro usuario lo eliminó)`);
            return;
        }

        const result = mergeRow(rows[index], fromRow, toRow, kind);
        if (result.changed) {
            rows[index] = result.row;
            changed = true;
        }
        if (result.conflict) conflicts.push(`${spec.label(fromRow)} (otro usuario lo modificó después)`);
    });

    // Agregadas por el cambio.
    toRows.forEach((toRow, toIndex) => {
        if (fromMap.has(toRow.key)) return;

        const index = indexOf(toRow.key);
        if (index !== -1) {
            if (!sameRow(rows[index], toRow)) conflicts.push(`${spec.label(toRow)} (ya existe con otros datos)`);
            return;
        }

        // Junto a la fila que la precedía en el estado de destino, si sigue estando.
        let insertAt = 0;
        for (let i = toIndex - 1; i >= 0; i--) {
            const previous = indexOf(toRows[i].key);
            if (previous !== -1) {
                insertAt = previous + 1;
                break;
            }
        }
        rows.splice(insertAt, 0, { ...toRow });
        changed = true;
    });

    return { rows, changed, conflicts };
}

function sameRow(a, b) {
    return ROW_FIELDS.every((field) => same(a[field], b[field]));
}

// ==================== DATOS DE UNA CLASE (umlData) ====================

const UML25_ROW_LISTS = new Set([
    'derivedAttributes', 'staticAttributes', 'attributeConstraints',
    'abstractMethods', 'staticMethods', 'methodConstraints',
]);

const FIELD_LABELS = {
    className: 'el nombre',
    type: 'el tipo (clase o interfaz)',
    stereotype: 'el estereotipo',
    isAbstract: 'la marca de abstracta',
    hideDataTypes: 'mostrar tipos',
    responsibilities: 'las responsabilidades',
    constraints: 'las restricciones',
};

/**
 * Aplica sobre `current` el cambio de una clase que fue de `from` a `to`.
 * @returns {{ value: object, changed: boolean, conflicts: string[] }}
 */
export function mergeUmlData(current, from, to) {
    current = current || {};
    from = from || {};
    to = to || {};

    const result = { ...clone(current) };
    const conflicts = [];
    let changed = false;

    ['className', 'type'].forEach((field) => {
        const merged = mergeValue(current[field], from[field], to[field]);
        if (merged.changed) {
            result[field] = merged.value;
            changed = true;
        }
        if (merged.conflict) conflicts.push(FIELD_LABELS[field]);
    });

    // Opciones UML 2.5 que no dependen de las filas.
    const currentUml25 = current.uml25 || {};
    const fromUml25 = from.uml25 || {};
    const toUml25 = to.uml25 || {};
    const uml25 = { ...clone(currentUml25) };
    let uml25Changed = false;

    const uml25Keys = new Set([...Object.keys(fromUml25), ...Object.keys(toUml25)]);
    uml25Keys.forEach((key) => {
        if (UML25_ROW_LISTS.has(key)) return;
        const merged = mergeValue(currentUml25[key], fromUml25[key], toUml25[key]);
        if (merged.changed) {
            uml25[key] = merged.value;
            uml25Changed = true;
        }
        if (merged.conflict) conflicts.push(FIELD_LABELS[key] || key);
    });

    // Atributos y métodos, fila por fila (con sus marcas por índice).
    ['attributes', 'methods'].forEach((kind) => {
        const merged = mergeRows(toRows(current, kind), toRows(from, kind), toRows(to, kind), kind);
        conflicts.push(...merged.conflicts);
        if (!merged.changed) return;

        const rebuilt = fromRows(merged.rows, kind);
        result[kind] = rebuilt.lines;
        Object.assign(uml25, rebuilt.flags);
        uml25[ROW_KINDS[kind].constraints] = rebuilt.constraints;
        changed = true;
        uml25Changed = true;
    });

    if (uml25Changed) {
        result.uml25 = isEmptyUml25(uml25) ? null : uml25;
        changed = true;
    }

    return { value: result, changed, conflicts };
}

/** Mismo criterio que el panel de propiedades: sin ninguna opción, uml25 se guarda como null. */
function isEmptyUml25(uml25) {
    return !uml25.stereotype && !uml25.isAbstract && !uml25.hideDataTypes
        && !(uml25.derivedAttributes || []).length && !(uml25.staticAttributes || []).length
        && !(uml25.abstractMethods || []).length && !(uml25.staticMethods || []).length
        && !(uml25.responsibilities || []).length && !(uml25.constraints || []).length
        && !(uml25.attributeConstraints || []).some(Boolean) && !(uml25.methodConstraints || []).some(Boolean);
}

// ==================== DATOS DE UNA RELACIÓN ====================

const RELATION_LABELS = {
    type: 'el tipo de relación',
    name: 'el nombre de la relación',
    sourceMultiplicity: 'la multiplicidad de origen',
    targetMultiplicity: 'la multiplicidad de destino',
    sourceAnchor: 'el punto de conexión de origen',
    targetAnchor: 'el punto de conexión de destino',
};

/** Aplica sobre `current` el cambio de una relación, clave por clave. */
export function mergeRelationData(current, from, to) {
    current = current || {};
    from = from || {};
    to = to || {};

    const value = { ...clone(current) };
    const conflicts = [];
    let changed = false;

    new Set([...Object.keys(from), ...Object.keys(to)]).forEach((key) => {
        const merged = mergeValue(current[key], from[key], to[key]);
        if (merged.changed) {
            value[key] = merged.value;
            changed = true;
        }
        if (merged.conflict) conflicts.push(RELATION_LABELS[key] || key);
    });

    return { value, changed, conflicts };
}
