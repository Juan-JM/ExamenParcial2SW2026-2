// resources/js/diagram/utils/schemaNormalizationChecker.js
// Revisa el modelo antes de generar la base de datos. Son reglas fijas, sin IA:
// detectan los incumplimientos que se ven en los nombres y tipos de los atributos.
// No reemplazan un análisis completo de dependencias funcionales; para eso está el
// botón "Normalización" del asistente.

const COLLECTION_TYPE = /^(List|Set|Map|Collection|ArrayList|HashSet)\s*<|\[\]$/;

function parseAttribute(line) {
    const text = String(line || '').trim().replace(/^[+\-#~]\s*/, '');
    const colon = text.lastIndexOf(':');
    const rawName = (colon === -1 ? text : text.slice(0, colon)).trim();

    return {
        derived: rawName.startsWith('/'),
        name: rawName.replace(/^\//, '').trim(),
        type: colon === -1 ? '' : text.slice(colon + 1).trim(),
    };
}

/** "nombreCliente" y "nombre_cliente" dan ["nombre", "cliente"]. */
function tokens(name) {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[\s_-]+/)
        .map((token) => token.toLowerCase())
        .filter(Boolean);
}

function findRepeatingGroups(cls, attributes) {
    const groups = new Map();

    attributes.forEach(({ name }) => {
        const match = name.match(/^(.*?)[_-]?(\d+)$/);
        if (!match || !match[1]) return;

        const base = match[1].toLowerCase();
        groups.set(base, [...(groups.get(base) || []), name]);
    });

    return [...groups.entries()]
        .filter(([, names]) => names.length >= 2)
        .map(([base, names]) => ({
            form: '1FN',
            className: cls.className,
            attribute: names.join(', '),
            problem: `${names.join(', ')} forman un grupo repetitivo.`,
            suggestion: `Crea una clase para "${base}" con una relación 1 a muchos desde ${cls.className}.`,
        }));
}

function findMultivalued(cls, attributes) {
    return attributes
        .filter(({ type }) => COLLECTION_TYPE.test(type) && type !== 'byte[]')
        .map(({ name, type }) => ({
            form: '1FN',
            className: cls.className,
            attribute: name,
            problem: `${name} guarda varios valores (${type}) en una sola columna.`,
            suggestion: `Pasa ${name} a una clase propia relacionada con ${cls.className}.`,
        }));
}

function findDerived(cls, attributes, derivedIndexes) {
    return attributes
        .filter(({ derived }, index) => derived || derivedIndexes.includes(index))
        .map(({ name }) => ({
            form: '3FN',
            className: cls.className,
            attribute: name,
            problem: `${name} es un atributo derivado: se calcula a partir de otros datos.`,
            suggestion: `No lo guardes como columna; calcúlalo al consultarlo.`,
        }));
}

/** "clienteNombre" dentro de Pedido: ese dato le pertenece a Cliente. */
function findForeignData(cls, attributes, classes, associationParticipants) {
    const issues = [];
    const participants = associationParticipants.get(cls.className) || [];

    attributes.forEach(({ name, derived }) => {
        if (derived) return;

        const nameTokens = tokens(name);
        const last = nameTokens[nameTokens.length - 1];

        // "clienteId" es una referencia, no un dato copiado.
        if (last === 'id') return;

        const owner = classes.find((other) => {
            if (other.className === cls.className) return false;

            const otherTokens = tokens(other.className);
            if (nameTokens.length <= otherTokens.length) return false;

            const startsWith = otherTokens.every((token, i) => nameTokens[i] === token);
            const endsWith = otherTokens.every((token, i) => nameTokens[nameTokens.length - otherTokens.length + i] === token);

            return startsWith || endsWith;
        });

        if (!owner) return;

        const isPartial = participants.includes(owner.className);

        issues.push({
            form: isPartial ? '2FN' : '3FN',
            className: cls.className,
            attribute: name,
            problem: isPartial
                ? `${name} depende solo de ${owner.className}, no de toda la asociación.`
                : `${name} depende de ${owner.className}, no de ${cls.className}.`,
            suggestion: `Mueve el dato a ${owner.className} y accede a él por la relación.`,
        });
    });

    return issues;
}

/**
 * @param {Array<{className: string, attributes: string[], derivedAttributes?: number[]}>} classes
 * @param {Array<{associationClass?: string, sourceClass: string, targetClass: string}>} associationClasses
 * @returns {Array<{form: string, className: string, attribute: string, problem: string, suggestion: string}>}
 */
export function checkNormalization(classes, associationClasses = []) {
    const participants = new Map(
        associationClasses.map((a) => [a.associationClass, [a.sourceClass, a.targetClass]]),
    );

    return classes.flatMap((cls) => {
        const attributes = (cls.attributes || []).map(parseAttribute).filter((attribute) => attribute.name);

        return [
            ...findRepeatingGroups(cls, attributes),
            ...findMultivalued(cls, attributes),
            ...findDerived(cls, attributes, cls.derivedAttributes || []),
            ...findForeignData(cls, attributes, classes, participants),
        ];
    });
}
