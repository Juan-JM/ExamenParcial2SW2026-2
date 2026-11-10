// resources/js/diagram/utils/modal.js
// Shell reutilizable para los modales del editor: overlay + dialog (.card) + cierre con Escape.

/**
 * @param {string} contentHTML - innerHTML del diálogo.
 * @param {{maxWidth?: string, id?: string, closeOnOverlayClick?: boolean, onClose?: () => void}} [opts]
 * @returns {{overlay: HTMLElement, dialog: HTMLElement, close: () => void}}
 */
export function openModal(contentHTML, opts = {}) {
    // Evita apilar dos instancias del mismo modal (p. ej. doble clic en "Importar").
    if (opts.id) {
        const existing = document.getElementById(opts.id);
        if (existing) existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    if (opts.id) overlay.id = opts.id;

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog card';
    if (opts.maxWidth) {
        dialog.style.maxWidth = opts.maxWidth;
    }
    dialog.innerHTML = contentHTML;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;

        if (overlay.parentNode) {
            document.body.removeChild(overlay);
        }
        document.removeEventListener('keydown', handleKeyDown);
        opts.onClose?.();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);

    if (opts.closeOnOverlayClick) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
    }

    return { overlay, dialog, close };
}
