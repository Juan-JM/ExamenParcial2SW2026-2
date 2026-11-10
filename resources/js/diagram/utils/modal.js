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

// ==================== CONFIRMAR / AVISAR ====================
// Reemplazan a confirm() y alert() del navegador en toda la app: mismo estilo
// que el resto de los modales, título claro y botones con el verbo de la
// acción ("Eliminar", no "Aceptar"). Devuelven una promesa, así que quien los
// usa tiene que esperar la respuesta (await) antes de seguir.
// También quedan como window.uiConfirm / window.uiAlert (app.js) para las
// vistas Blade y Livewire.

const TONE_ICONS = {
    danger: '<path d="M5 7h14"/><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"/><path d="M7 7l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12"/>',
    warning: '<path d="M12 4l9 16H3L12 4z" stroke-linejoin="round"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5l5 5m0-5l-5 5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
};

let activeDialog = null;

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {{title: string, message?: string, confirmLabel?: string, cancelLabel?: string|null, tone?: 'danger'|'warning'|'error'|'info'}} opts
 * @returns {Promise<boolean>} true si se eligió la acción principal.
 */
function openDecision({ title, message = '', confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', tone = 'info' }) {
    // Un solo diálogo de decisión a la vez: el anterior se da por cancelado.
    activeDialog?.(false);

    return new Promise((resolve) => {
        const previousFocus = document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay ui-dialog-overlay';

        const paragraphs = String(message).split(/\n{2,}/).filter(Boolean)
            .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');

        overlay.innerHTML = `
            <div class="modal-dialog card ui-dialog is-${tone}" role="alertdialog" aria-modal="true" aria-labelledby="ui-dialog-title" aria-describedby="ui-dialog-message">
                <div class="ui-dialog-body">
                    <span class="ui-dialog-icon" aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${TONE_ICONS[tone] || TONE_ICONS.info}</svg>
                    </span>
                    <div class="ui-dialog-text">
                        <h3 class="ui-dialog-title" id="ui-dialog-title">${escapeHtml(title)}</h3>
                        <div class="ui-dialog-message" id="ui-dialog-message">${paragraphs}</div>
                    </div>
                </div>
                <div class="ui-dialog-actions">
                    ${cancelLabel ? `<button type="button" class="btn btn-secondary btn-sm" data-ui-cancel>${escapeHtml(cancelLabel)}</button>` : ''}
                    <button type="button" class="btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'} btn-sm" data-ui-confirm>${escapeHtml(confirmLabel)}</button>
                </div>
            </div>
        `;

        const finish = (result) => {
            if (activeDialog !== finish) return;
            activeDialog = null;
            document.removeEventListener('keydown', onKey, true);
            overlay.classList.add('is-leaving');
            setTimeout(() => overlay.remove(), 120);
            if (previousFocus && document.contains(previousFocus)) previousFocus.focus?.({ preventScroll: true });
            resolve(result);
        };

        // En captura y sin propagar: si hay otro modal abajo (p. ej. editar
        // relación), Escape/Enter solo afectan a este diálogo.
        const onKey = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                finish(false);
            } else if (event.key === 'Enter' && !event.isComposing) {
                event.preventDefault();
                event.stopImmediatePropagation();
                finish(!event.target.matches?.('[data-ui-cancel]'));
            } else if (event.key === 'Tab') {
                const buttons = [...overlay.querySelectorAll('button')];
                const index = buttons.indexOf(document.activeElement);
                event.preventDefault();
                buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
                // Que el atajo Supr del editor no dispare otro borrado debajo.
                event.stopImmediatePropagation();
            }
        };

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) finish(false);
        });
        overlay.querySelector('[data-ui-confirm]').addEventListener('click', () => finish(true));
        overlay.querySelector('[data-ui-cancel]')?.addEventListener('click', () => finish(false));

        activeDialog = finish;
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        overlay.querySelector('[data-ui-confirm]').focus();
    });
}

/**
 * Pide confirmación. Reemplaza a confirm().
 * @param {{title: string, message?: string, confirmLabel?: string, cancelLabel?: string, tone?: 'danger'|'warning'|'info'}} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts) {
    return openDecision({ tone: 'warning', ...opts });
}

/**
 * Aviso con un solo botón. Reemplaza a alert().
 * @param {{title: string, message?: string, confirmLabel?: string, tone?: 'error'|'warning'|'info'}} opts
 * @returns {Promise<void>}
 */
export async function alertDialog(opts) {
    await openDecision({ tone: 'info', confirmLabel: 'Entendido', ...opts, cancelLabel: null });
}
