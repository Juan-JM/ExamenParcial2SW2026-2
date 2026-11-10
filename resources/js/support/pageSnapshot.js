// resources/js/support/pageSnapshot.js
// Describe lo que la persona tiene en pantalla, en texto, para el asistente de
// ayuda. Se mandan los textos reales de botones y pestañas (no una captura):
// es más liviano para el modelo y permite señalar el elemento exacto después.

const INTERACTIVE = 'button, a[href], [role="tab"], [role="button"], select, input[type="checkbox"], input[type="search"], textarea, label[for]';
const MAX_TARGETS = 60;
let nextKey = 0;

function isVisible(el) {
    if (el.closest('.sc-panel, .sc-spotlight-tooltip, .voice-orb')) return false;
    if (el.closest('[hidden]')) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    // Una pestaña en segundo plano puede informar una ventana de 0 px: en ese
    // caso no se descarta nada por posición.
    const width = window.innerWidth || document.documentElement.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight;
    if (width > 0 && height > 0 && (rect.bottom < 0 || rect.top > height || rect.right < 0 || rect.left > width)) return false;

    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
}

function labelOf(el) {
    const text = el.getAttribute('aria-label')
        || el.getAttribute('title')
        || el.innerText
        || el.getAttribute('placeholder')
        || el.value
        || '';

    return text.replace(/\s+/g, ' ').trim().slice(0, 100);
}

function kindOf(el) {
    if (el.getAttribute('role') === 'tab') return 'pestaña';
    if (el.tagName === 'A') return 'enlace';
    if (el.tagName === 'SELECT') return 'selector';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return 'campo';
    return 'botón';
}

/** Cada elemento recibe una clave estable para poder señalarlo con "Mostrarme dónde". */
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
    const targets = [];

    // Primero lo que está dentro de una ventana abierta: es lo que la persona está mirando.
    const modal = document.querySelector('.modal-overlay');
    const roots = modal ? [modal, document.body] : [document.body];

    roots.forEach((root) => {
        root.querySelectorAll(INTERACTIVE).forEach((el) => {
            if (targets.length >= MAX_TARGETS || seen.has(el) || !isVisible(el)) return;
            seen.add(el);

            const label = labelOf(el);
            if (!label) return;

            targets.push({ key: keyOf(el), label, kind: kindOf(el) });
        });
    });

    const headings = [...document.querySelectorAll('h1, h2, h3, .modal-title')]
        .filter(isVisible)
        .map((el) => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 10);

    const notices = [...document.querySelectorAll('[role="alert"], .alert, .flash-message, .toast')]
        .filter(isVisible)
        .map((el) => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 200))
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
