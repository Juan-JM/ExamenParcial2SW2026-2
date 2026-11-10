// resources/js/support/pageSnapshot.js
// Describe lo que la persona tiene en pantalla, en texto, para el Tutor. Se
// mandan los textos reales de botones y pestañas (no una captura): es más
// liviano para el modelo y permite señalar el elemento exacto después.
//
// Se manda TODA la página dibujada, no solo lo que entra en la ventana: si la
// persona bajó en "Mis Diagramas", el menú de arriba sigue existiendo y el
// recorrido lo trae a la vista. Lo que está fuera de la ventana va al final de
// la lista y marcado "fuera de vista".

const INTERACTIVE = [
    'button', 'a[href]', '[role="tab"]', '[role="button"]', 'select', 'textarea', 'label[for]',
    'input[type="checkbox"]', 'input[type="search"]', 'input[type="text"]', 'input[type="email"]', 'input:not([type])',
].join(', ');
const MAX_TARGETS = 100;
const MAX_REGIONS = 25;
let nextKey = 0;

/** Está dibujado (aunque haya que desplazarse para verlo) y no es parte del propio Tutor. */
export function isVisible(el) {
    if (el.closest('.sc-panel, .sc-fab, .sc-tour-card, .voice-orb')) return false;
    if (el.closest('[hidden]')) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
}

/**
 * Está dentro de la ventana ahora mismo. Una pestaña en segundo plano puede
 * informar una ventana de 0 px: en ese caso se considera todo a la vista.
 */
function inViewport(el) {
    const width = window.innerWidth || document.documentElement.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight;
    if (!width || !height) return true;

    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width;
}

function clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
}

function labelOf(el) {
    return clean(
        el.getAttribute('aria-label')
        || el.getAttribute('title')
        || el.innerText
        || el.getAttribute('placeholder')
        || el.value
        || '',
    ).slice(0, 100);
}

function kindOf(el) {
    if (el.getAttribute('role') === 'tab') return 'pestaña';
    if (el.tagName === 'A') return 'enlace';
    if (el.tagName === 'SELECT') return 'selector';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return 'campo';
    return 'botón';
}

/**
 * De qué es un botón repetido: "Editar" en la tarjeta de "Gimnasio". Se sube
 * hasta el primer contenedor que tenga un solo título adentro.
 */
function contextOf(el) {
    let node = el.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 8; depth++, node = node.parentElement) {
        const headings = node.querySelectorAll('h1, h2, h3, h4, [data-help-context]');
        if (headings.length === 1 && !headings[0].contains(el)) return clean(headings[0].innerText).slice(0, 60);
        if (headings.length > 1) return '';
    }
    return '';
}

/**
 * Las tarjetas y secciones de la página ("SistemaGimnasio", "Compartidos
 * conmigo"): para "¿dónde está…?" se señala la tarjeta entera, no uno de sus
 * botones. Desde el título se sube mientras el contenedor no tenga otro título:
 * así se llega a la tarjeta completa.
 */
function regions() {
    const found = [];

    // En el editor las partes se describen con las zonas y el lienzo; los
    // títulos solo cuentan dentro de una ventana abierta.
    const inEditor = !!document.querySelector('#paper-container');

    document.querySelectorAll('h1, h2, h3, h4, [data-help-context]').forEach((heading) => {
        if (found.length >= MAX_REGIONS || !isVisible(heading)) return;
        if (inEditor && !heading.closest('.modal-overlay')) return;

        const label = clean(heading.innerText).slice(0, 80);
        if (!label) return;

        let box = heading;
        for (let depth = 0; depth < 8; depth++) {
            const parent = box.parentElement;
            if (!parent || parent === document.body || parent.id === 'app') break;
            if (parent.querySelectorAll('h1, h2, h3, h4, [data-help-context]').length > 1) break;
            box = parent;
        }

        const isCard = box !== heading && box.querySelector(INTERACTIVE) !== null;
        found.push({ el: box, label, kind: isCard ? 'tarjeta' : 'sección' });
    });

    return found;
}

/** Zonas del editor que el Tutor puede señalar aunque no sean botones. */
const ZONES = [
    ['#paper-container', 'Lienzo (el área donde se dibuja el diagrama)'],
    ['#editor-sidebar', 'Paleta de herramientas (Herramientas UML)'],
    ['#properties-right-panel', 'Panel de propiedades de la clase (derecha)'],
    ['#properties-bottom-panel', 'Panel de atributos y métodos (abajo)'],
    ['#editor-dock', 'Panel del equipo abierto (Nova, Actividad o Versiones)'],
    ['#editor-rail', 'Riel de la derecha (botones Nova, Actividad y Versiones)'],
    ['#collaborators-bar', 'Personas conectadas'],
    ['#canvas-info', 'Zoom y contador del lienzo'],
];

const RELATION_NAMES = {
    association: 'asociación', inheritance: 'herencia', aggregation: 'agregación', composition: 'composición',
    realization: 'realización', dependency: 'dependencia', associationClassLink: 'clase asociativa',
};

const MAX_CANVAS_ITEMS = 30;

function editorInstance() {
    return window.DiagramEditor?.instance || null;
}

function zones() {
    return ZONES
        .map(([selector, label]) => ({ el: document.querySelector(selector), label, kind: 'zona' }))
        .filter((zone) => zone.el && isVisible(zone.el));
}

/**
 * Lo que está dibujado en el lienzo: cada clase o interfaz por su nombre, y
 * las relaciones entre ellas. Así el Tutor puede decir "toca la clase
 * Cliente" y señalarla de verdad.
 */
function canvasItems() {
    const editor = editorInstance();
    if (!editor?.graph || !editor?.paper) return [];

    const items = [];
    const nameOf = (cell) => cell?.get?.('umlData')?.className || null;

    editor.graph.getElements().forEach((cell) => {
        const data = cell.get('umlData');
        const el = editor.paper.findViewByModel(cell)?.el;
        if (!data || !el || items.length >= MAX_CANVAS_ITEMS) return;

        const type = data.type === 'interface' ? 'Interfaz' : 'Clase';
        items.push({ el, label: `${type} ${data.className || 'sin nombre'} (en el lienzo)`, kind: 'elemento del lienzo' });
    });

    editor.graph.getLinks().forEach((link) => {
        const data = link.get('relationData');
        const el = editor.paper.findViewByModel(link)?.el;
        if (!data || !el || items.length >= MAX_CANVAS_ITEMS) return;

        const from = nameOf(link.getSourceElement());
        const to = nameOf(link.getTargetElement());
        if (!from || !to) return;

        const type = RELATION_NAMES[data.type] || 'relación';
        items.push({ el, label: `Relación ${from} → ${to} (${type}, en el lienzo)`, kind: 'relación del lienzo' });
    });

    return items;
}

/**
 * Trae el elemento a la vista. Si está en el lienzo, mueve el lienzo para
 * centrarlo (no sirve desplazar la página: el lienzo tiene su propio encuadre).
 */
export function bringIntoView(el) {
    const editor = editorInstance();
    const paperBox = document.querySelector('#paper-container');
    const modelId = el.closest?.('[model-id]')?.getAttribute('model-id');

    if (editor?.paper && paperBox?.contains(el) && modelId) {
        const box = paperBox.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const visible = rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom;
        if (visible) return;

        const cell = editor.graph.getCell(modelId);
        const bbox = cell?.getBBox?.();
        if (!bbox) return;

        const scale = editor.paper.scale().sx || 1;
        editor.paper.translate(
            box.width / 2 - (bbox.x + bbox.width / 2) * scale,
            box.height / 2 - (bbox.y + bbox.height / 2) * scale,
        );
        return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }
}

/** Cada elemento recibe una clave estable para poder señalarlo. */
function keyOf(el) {
    if (el.id) return el.id;
    if (!el.dataset.helpKey) el.dataset.helpKey = `h${++nextKey}`;
    return el.dataset.helpKey;
}

export function findByKey(key) {
    if (!key) return null;
    return document.getElementById(key) || document.querySelector(`[data-help-key="${CSS.escape(key)}"]`);
}

export function capturePage(screen) {
    const seen = new Set();
    const found = [];

    // Primero lo que está dentro de una ventana abierta: es lo que la persona está mirando.
    const modal = document.querySelector('.modal-overlay');
    const roots = modal ? [modal, document.body] : [document.body];

    roots.forEach((root) => {
        root.querySelectorAll(INTERACTIVE).forEach((el) => {
            if (seen.has(el) || !isVisible(el)) return;
            seen.add(el);

            const label = labelOf(el);
            if (label) found.push({ el, label, onScreen: inViewport(el) });
        });
    });

    // Los botones con el mismo texto ("Editar" en cada tarjeta) llevan de qué son.
    const counts = found.reduce((acc, item) => acc.set(item.label, (acc.get(item.label) || 0) + 1), new Map());

    const controls = [...found.filter((item) => item.onScreen), ...found.filter((item) => !item.onScreen)]
        .map(({ el, label, onScreen }) => {
            const context = counts.get(label) > 1 ? contextOf(el) : '';
            return {
                key: keyOf(el),
                label: (context ? `${label} (${context})` : label).slice(0, 120),
                kind: onScreen ? kindOf(el) : `${kindOf(el)}, fuera de vista`,
            };
        });

    // Primero el mapa de la página (zonas, lo dibujado en el lienzo, tarjetas
    // y secciones), después los controles.
    const areas = [...zones(), ...canvasItems(), ...regions()].map(({ el, label, kind }) => ({
        key: keyOf(el),
        label,
        kind: inViewport(el) ? kind : `${kind}, fuera de vista`,
    }));

    const targets = [...areas, ...controls].slice(0, MAX_TARGETS);

    const headings = [...document.querySelectorAll('h1, h2, h3, .modal-title')]
        .filter(isVisible)
        .map((el) => clean(el.innerText).slice(0, 120))
        .filter(Boolean)
        .slice(0, 10);

    const notices = [...document.querySelectorAll('[role="alert"], .alert, .flash-message, .toast')]
        .filter(isVisible)
        .map((el) => clean(el.innerText).slice(0, 200))
        .filter(Boolean)
        .slice(0, 5);

    const editor = window.DiagramEditor?.instance?.aiChat?.uiContext?.() || null;

    return {
        screen,
        title: document.title.slice(0, 200),
        path: location.pathname.slice(0, 300),
        headings,
        notices,
        modal: modal?.querySelector('.modal-title, h2, h3')?.innerText?.trim().slice(0, 300) || null,
        editor,
        targets,
    };
}

function normalize(text) {
    return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Busca en la página el elemento cuyo texto coincide con el que nombró el
 * Tutor. Sirve para los pasos cuyo botón aparece recién después del paso
 * anterior (un menú que se abre, otra pantalla). Acepta "Editar (Gimnasio)":
 * busca el "Editar" que está en la tarjeta de "Gimnasio".
 */
export function findVisibleByLabel(label) {
    const wanted = normalize(label);
    if (wanted.length < 2) return null;

    const withContext = wanted.match(/^(.*?)\s*\((.+)\)$/);
    const base = withContext ? withContext[1] : wanted;
    const context = withContext ? withContext[2] : '';

    const modal = document.querySelector('.modal-overlay');
    const candidates = [...(modal || document.body).querySelectorAll(INTERACTIVE)].filter(isVisible);
    if (modal) candidates.push(...[...document.body.querySelectorAll(INTERACTIVE)].filter((el) => !modal.contains(el) && isVisible(el)));

    // Los que están a la vista ganan sobre los que hay que desplazarse para ver.
    candidates.sort((a, b) => Number(inViewport(b)) - Number(inViewport(a)));

    // Si no es un botón, puede ser una zona, algo del lienzo, o una tarjeta o
    // sección con ese nombre ("Clase Cliente", "Lienzo").
    const area = [...zones(), ...canvasItems(), ...regions()].find((item) => {
        const label = normalize(item.label);
        return label === wanted || label.startsWith(`${wanted} (`) || label.replace(/\s*\(.*\)$/, '') === wanted;
    });
    if (area && !candidates.some((el) => normalize(labelOf(el)) === wanted)) return area.el;

    let partial = null;
    for (const el of candidates) {
        const text = normalize(labelOf(el));
        if (!text) continue;

        if (context) {
            if (text === base && normalize(contextOf(el)) === context) return el;
            continue;
        }

        if (text === wanted) return el;
        if (!partial && wanted.length >= 4 && (text.startsWith(wanted) || (text.length >= 4 && wanted.includes(text) && text.length > wanted.length / 2))) {
            partial = el;
        }
    }

    if (context && !partial) return findVisibleByLabel(base);
    return partial;
}
