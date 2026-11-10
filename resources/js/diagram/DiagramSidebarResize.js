// resources/js/diagram/DiagramSidebarResize.js
// Sidebar del editor con ancho ajustable a mano (agarradera en el borde
// derecho), con un mínimo y un máximo — antes era un w-64 (256px) fijo.
// Se guarda el ancho elegido en localStorage para que no se resetee cada
// vez que se recarga la página.

const MIN_WIDTH = 216;
const MAX_WIDTH = 420;
// Clave nueva: la paleta ahora tiene solo herramientas (el chat pasó al panel
// derecho), así que el ancho viejo de 320px+ ya no tiene sentido como punto de partida.
const STORAGE_KEY = 'uml-editor:palette-width';

export class DiagramSidebarResize {
    constructor(editor) {
        this.editor = editor;
        this.sidebar = document.getElementById('editor-sidebar');
        this.handle = document.getElementById('sidebar-resize-handle');

        if (!this.sidebar || !this.handle) return;

        this.dragging = false;
        this.startX = 0;
        this.startWidth = 0;

        this.applyStoredWidth();

        this.handle.addEventListener('mousedown', this.onDragStart.bind(this));
        // Los listeners de move/up van en document (no en la agarradera):
        // el mouse casi siempre se mueve más rápido que el ancho del borde
        // de 6px durante un drag real, y si estuvieran en el handle el
        // arrastre se "soltaría" solo apenas el cursor se despega de esa
        // franja angosta.
        document.addEventListener('mousemove', this.onDragMove.bind(this));
        document.addEventListener('mouseup', this.onDragEnd.bind(this));
    }

    applyStoredWidth() {
        const stored = parseInt(localStorage.getItem(STORAGE_KEY), 10);
        if (!Number.isNaN(stored)) {
            this.sidebar.style.width = `${this.clamp(stored)}px`;
        }
    }

    clamp(width) {
        return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
    }

    onDragStart(e) {
        this.dragging = true;
        this.startX = e.clientX;
        this.startWidth = this.sidebar.getBoundingClientRect().width;
        this.handle.classList.add('is-dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    }

    onDragMove(e) {
        if (!this.dragging) return;
        const newWidth = this.clamp(this.startWidth + (e.clientX - this.startX));
        this.sidebar.style.width = `${newWidth}px`;
    }

    onDragEnd() {
        if (!this.dragging) return;
        this.dragging = false;
        this.handle.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(STORAGE_KEY, Math.round(this.sidebar.getBoundingClientRect().width));
    }
}
