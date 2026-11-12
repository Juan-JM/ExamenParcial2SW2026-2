// resources/js/diagram/modules-ai/live/turns.js
// Lógica pura de "Nova en vivo": ¿me están hablando a mí?, ¿esta frase continúa la
// anterior?, qué dice Nova cuando alguien espera. Sin DOM ni red, para probarla
// con `npm run test:js`.

/** Minúsculas, sin acentos ni signos: "¡Nová!," y "nova" deben coincidir. */
export function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9ñ\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Cómo suele transcribir Whisper los nombres que se le dicen a la IA. */
const NAME_ALIASES = {
    nova: ['noba', 'novva', 'nouva', 'nobba'],
};

const FILLERS = new Set(['oye', 'hey', 'ey', 'ok', 'okay', 'hola', 'eh', 'mira', 'dime', 'buenas']);

/**
 * Busca el nombre de la IA en lo que se dijo. Devuelve si estaba y el pedido sin
 * el nombre ni los saludos de relleno ("oye nova, qué piensas" -> "qué piensas").
 * Solo coincide con la palabra entera: "innovar" no es "nova".
 */
export function detectWake(text, wakeWords = ['nova']) {
    const original = String(text || '').trim();
    const names = new Set();

    wakeWords.forEach((word) => {
        const base = normalize(word);
        if (!base) return;
        names.add(base);
        (NAME_ALIASES[base] || []).forEach((alias) => names.add(alias));
    });

    const tokens = original.split(/\s+/).filter(Boolean);
    const at = tokens.findIndex((token) => names.has(normalize(token)));
    if (at === -1) return { found: false, command: original };

    // Se quita el nombre y, si solo lo precedían saludos ("oye", "hola"), también ellos.
    // El resto queda tal cual se transcribió, con acentos y signos.
    let before = tokens.slice(0, at);
    if (before.every((token) => FILLERS.has(normalize(token)))) before = [];

    const command = [...before, ...tokens.slice(at + 1)]
        .join(' ')
        .replace(/^[\s,.:;!¡-]+|[\s,:;-]+$/g, '');

    return { found: true, command };
}

/** Palabras con las que una frase casi nunca termina: la persona siguió pensando. */
const DANGLING = new Set([
    'a', 'al', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'que', 'y', 'o', 'e', 'u',
    'pero', 'sobre', 'con', 'para', 'por', 'en', 'si', 'como', 'cual', 'entre', 'mi', 'tu', 'su', 'se',
    'cuando', 'donde', 'quien', 'porque',
]);

export function looksIncomplete(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    if (/(\.\.\.|…|,|:|;|-)$/.test(raw)) return true;
    if (/[.?!¿¡]$/.test(raw) && !/\.\.\.$/.test(raw)) return false;

    const last = normalize(raw).split(' ').pop();
    return DANGLING.has(last);
}

const MERGE_MAX_GAP_MS = 25000;
const MERGE_MAX_SPOKEN_MS = 2500;

/**
 * Cuando la persona vuelve a hablar mientras Nova piensa o contesta, ¿es la misma
 * idea? Sí si Nova casi no había dicho nada (se cortó a mitad de la primera frase)
 * o si lo anterior quedó a medias ("…quería preguntarte sobre"). No si Nova ya
 * había explicado algo: ahí es una pregunta nueva, aunque haya interrumpido.
 */
export function shouldMerge({ prevText, spokenMs = 0, gapMs = 0, opsApplied = false }) {
    if (!prevText || opsApplied) return false;
    if (gapMs > MERGE_MAX_GAP_MS) return false;

    return spokenMs < MERGE_MAX_SPOKEN_MS || looksIncomplete(prevText);
}

/** Qué dice Nova a quien le habla mientras atiende a otra persona. */
export function waitPhrase(userName, servingName, pick = Math.random) {
    const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
    const me = first(userName);
    const other = first(servingName);
    const options = [
        `Un momento ${me}, termino con ${other} y te atiendo.`,
        `${me}, dame un segundo, estoy respondiendo a ${other}.`,
        `Ya te escuché ${me}. Termino con ${other} y sigo contigo.`,
    ];

    return options[Math.floor(pick() * options.length) % options.length].replace(/\s+/g, ' ').replace(' ,', ',');
}

/** Frase corta cuando alguien cambia el diagrama mientras se conversa. */
export function reactionPhrase(entry, pick = Math.random) {
    const actor = String(entry?.actorName || 'Alguien').trim().split(/\s+/)[0];
    const summary = String(entry?.summary || '').trim().replace(/[.!?]+$/, '');
    if (!summary) return null;

    const lower = summary.charAt(0).toLowerCase() + summary.slice(1);
    const options = [
        `Ah, mira, ${actor} acaba de hacer un cambio: ${lower}.`,
        `Oh, ${actor} acaba de modificar algo: ${lower}.`,
        `Ojo, ${actor} acaba de tocar el diagrama: ${lower}.`,
    ];

    return options[Math.floor(pick() * options.length) % options.length];
}

/** Texto limpio para decirlo en voz alta. */
export function forSpeech(text) {
    return String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[*_`#>|~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
