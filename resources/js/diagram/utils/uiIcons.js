// resources/js/diagram/utils/uiIcons.js
// Íconos SVG inline (línea, 24x24, sin dependencias externas) usados por el
// toolbar del editor y el panel del asistente de IA, en reemplazo de emojis.

const PATHS = {
    select: '<path d="M5 3l14 8-6 1.5L11 19 5 3z" stroke-linejoin="round"/>',
    class: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M4 14.5h16"/>',
    interface: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/><path d="M4 9.5h16" stroke-dasharray="3 3"/>',
    association: '<path d="M4 12h16" /><path d="M15 8l4 4-4 4" stroke-linejoin="round"/>',
    inheritance: '<path d="M12 20V6"/><path d="M7 11l5-5 5 5" stroke-linejoin="round"/>',
    aggregation: '<path d="M4 12l4-4 4 4-4 4-4-4z" stroke-linejoin="round"/><path d="M12 12h8"/>',
    composition: '<path d="M4 12l4-4 4 4-4 4-4-4z" fill="currentColor" stroke-linejoin="round"/><path d="M12 12h8"/>',
    realization: '<path d="M12 20V6" stroke-dasharray="3 3"/><path d="M7 11l5-5 5 5" stroke-linejoin="round"/>',
    dependency: '<path d="M4 12h16" stroke-dasharray="3 3"/><path d="M15 8l4 4-4 4" stroke-linejoin="round"/>',
    associationClassLink: '<rect x="3" y="3" width="7" height="6" rx="1"/><path d="M6.5 9v7" stroke-dasharray="2 2"/><path d="M3 19h18"/><circle cx="6.5" cy="19" r="1.6" fill="currentColor" stroke="none"/>',
    cursor: '<path d="M5 3l14 8-6 1.5L11 19 5 3z" stroke-linejoin="round"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3"/>',
    'mic-active': '<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5L4 12z" stroke-linejoin="round" stroke-linecap="round"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7" stroke-linejoin="round"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    refresh: '<path d="M4 4v5h5"/><path d="M20 20v-5h-5"/><path d="M5.5 9a7 7 0 0112.6-2.5L20 9M4 15l1.9 2.5A7 7 0 0018.5 15"/>',
    message: '<path d="M4 5h16v11H8l-4 4V5z" stroke-linejoin="round"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9.5" cy="10.5" r="1.5"/><path d="M4 16l4.5-4.5a2 2 0 012.8 0L16 16"/>',
    sparkle: '<path d="M12 3l1.8 4.6L18 9l-4.2 1.9L12 15l-1.8-4.1L6 9l4.2-1.4L12 3z" stroke-linejoin="round"/><path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15z" stroke-linejoin="round"/>',
    folder: '<path d="M4 7a1 1 0 011-1h4l2 2h8a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1V7z" stroke-linejoin="round"/>',
    trash: '<path d="M5 7h14"/><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"/><path d="M7 7l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
};

/**
 * Devuelve el markup SVG de un ícono de línea (sin relleno salvo composición/mic activo).
 * @param {keyof typeof PATHS} name
 * @param {{size?: number, strokeWidth?: number, className?: string}} [opts]
 */
export function icon(name, opts = {}) {
    const size = opts.size || 18;
    const strokeWidth = opts.strokeWidth || 1.75;
    const className = opts.className || '';
    const body = PATHS[name];
    if (!body) return '';
    return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

export const ICON_NAMES = Object.keys(PATHS);
