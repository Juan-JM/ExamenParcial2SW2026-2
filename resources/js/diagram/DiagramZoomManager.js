// resources/js/diagram/DiagramZoomManager.js
// Módulo encargado del zoom y navegación - TAL COMO ESTABA EN EL EDITOR ORIGINAL

export class DiagramZoomManager {
    constructor(editor) {
        this.editor = editor;
        this.currentZoom = 1;
    }

    // ==================== CONFIGURACIÓN DE BOTONES DE ZOOM ====================

    setupZoomButtons() {
        // Buscar botones de zoom
        var zoomInBtn = document.getElementById('zoom-in');
        var zoomOutBtn = document.getElementById('zoom-out');
        var zoomFitBtn = document.getElementById('zoom-fit');
        var zoom100Btn = document.getElementById('zoom-100');

        // Configurar eventos
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => {
                this.zoomIn();
            });
            console.log('✅ Botón Zoom In configurado');
        }

        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => {
                this.zoomOut();
            });
            console.log('✅ Botón Zoom Out configurado');
        }

        if (zoomFitBtn) {
            zoomFitBtn.addEventListener('click', () => {
                this.zoomToFit();
            });
            console.log('✅ Botón Zoom Fit configurado');
        }

        if (zoom100Btn) {
            zoom100Btn.addEventListener('click', () => {
                this.setZoom(1);
            });
            console.log('✅ Botón Zoom 100% configurado');
        }

        // También buscar por clases CSS alternativas
        document.querySelectorAll('.zoom-in-btn').forEach(btn => {
            btn.addEventListener('click', () => this.zoomIn());
        });

        document.querySelectorAll('.zoom-out-btn').forEach(btn => {
            btn.addEventListener('click', () => this.zoomOut());
        });

        document.querySelectorAll('.zoom-fit-btn').forEach(btn => {
            btn.addEventListener('click', () => this.zoomToFit());
        });

        console.log('✅ Botones de zoom configurados');
    }

    // ==================== NAVEGACIÓN PAN CON MOUSE ====================

    setupPanNavigation() {
        var paperEl = this.editor.paper.el;
        var isDragging = false;
        var lastPoint = null;

        paperEl.addEventListener('mousedown', (e) => {
            // Solo iniciar pan si no hay elemento seleccionado y es click del botón izquierdo
            if (e.button !== 0) return; // Solo botón izquierdo

            var target = e.target;
            var isElement = target.closest('.joint-element') || target.closest('.joint-link');

            // Si clicked en elemento, no hacer pan
            if (isElement) return;

            // Si herramienta de creación está activa, no hacer pan
            if (this.editor.selectedTool !== 'select') return;

            isDragging = true;
            lastPoint = { x: e.clientX, y: e.clientY };

            paperEl.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            var dx = e.clientX - lastPoint.x;
            var dy = e.clientY - lastPoint.y;
            lastPoint = { x: e.clientX, y: e.clientY };

            // Delta desde el ÚLTIMO mousemove (no desde el mousedown) sobre
            // la traslación ACTUAL leída en el momento (no una capturada al
            // empezar el arrastre): si algo más la cambió mientras el botón
            // seguía apretado — el zoom con rueda del mouse, que recalcula
            // la traslación para mantener centrado el punto bajo el cursor—
            // hay que seguir desde ese valor nuevo. Con un snapshot fijo del
            // mousedown, el siguiente mousemove pisaba ese recentrado del
            // zoom con la traslación vieja + un delta chico, y el diagrama
            // "saltaba" a la posición de antes del zoom.
            var currentTranslate = this.editor.paper.translate();
            this.editor.paper.translate(currentTranslate.tx + dx, currentTranslate.ty + dy);

            e.preventDefault();
        });

        document.addEventListener('mouseup', (e) => {
            if (isDragging) {
                isDragging = false;
                lastPoint = null;
                paperEl.style.cursor = this.editor.selectedTool === 'select' ?
                    'default' : 'crosshair';
            }
        });

        // Cambiar cursor cuando hover sobre canvas vacío
        paperEl.addEventListener('mousemove', (e) => {
            if (isDragging) return;

            var target = e.target;
            var isElement = target.closest('.joint-element') || target.closest('.joint-link');

            if (this.editor.selectedTool === 'select' && !isElement) {
                paperEl.style.cursor = 'grab';
            } else if (this.editor.selectedTool !== 'select') {
                paperEl.style.cursor = 'crosshair';
            } else {
                paperEl.style.cursor = 'default';
            }
        });

        paperEl.addEventListener('mouseleave', () => {
            paperEl.style.cursor = 'default';
        });

        console.log('✅ Navegación pan configurada');
    }

    // ==================== GESTOS TÁCTILES (celular / tablet) ====================
    // Un dedo sobre el fondo desplaza; dos dedos hacen zoom centrado en el
    // punto medio del pellizco. En modo "solo ver" un dedo desplaza aunque
    // empiece sobre una clase, porque nada se puede arrastrar.

    setupTouchNavigation() {
        var paperEl = this.editor.paper.el;
        var mode = null;
        var last = null;
        var startDistance = 0;
        var startZoom = 1;

        var distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        var midpoint = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

        paperEl.style.touchAction = 'none';

        paperEl.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                mode = 'pinch';
                startDistance = distance(e.touches[0], e.touches[1]);
                startZoom = this.currentZoom;
                last = midpoint(e.touches[0], e.touches[1]);
                e.preventDefault();
            } else if (e.touches.length === 1) {
                var onShape = e.target.closest('.joint-element') || e.target.closest('.joint-link');
                if (onShape && !this.editor.viewerMode) return;
                mode = 'pan';
                last = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        }, { passive: false });

        paperEl.addEventListener('touchmove', (e) => {
            if (!mode) return;
            e.preventDefault();

            if (mode === 'pan' && e.touches.length === 1) {
                var t = this.editor.paper.translate();
                this.editor.paper.translate(t.tx + e.touches[0].clientX - last.x, t.ty + e.touches[0].clientY - last.y);
                last = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                return;
            }

            if (mode === 'pinch' && e.touches.length === 2) {
                var mid = midpoint(e.touches[0], e.touches[1]);
                var newZoom = Math.max(0.05, Math.min(3, startZoom * distance(e.touches[0], e.touches[1]) / startDistance));
                var rect = paperEl.getBoundingClientRect();
                var px = mid.x - rect.left;
                var py = mid.y - rect.top;
                var t = this.editor.paper.translate();
                var ratio = newZoom / this.currentZoom;

                // Zoom hacia el punto medio + desplazamiento del propio pellizco.
                var tx = px - (px - t.tx) * ratio + (mid.x - last.x);
                var ty = py - (py - t.ty) * ratio + (mid.y - last.y);

                this.currentZoom = newZoom;
                this.editor.paper.scale(newZoom, newZoom);
                this.editor.paper.translate(tx, ty);
                last = mid;
                this.updateCanvasInfo();
            }
        }, { passive: false });

        paperEl.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                mode = null;
            } else if (e.touches.length === 1) {
                // Se levantó un dedo del pellizco: seguir desplazando con el otro.
                mode = 'pan';
                last = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        });
    }

    setupMouseWheelZoom() {
        // El scroll simple (sin modificador) hace zoom centrado en el cursor,
        // igual que Figma/Miro. Ctrl+scroll sigue funcionando idéntico por
        // si alguien ya tenía ese hábito.
        this.editor.paper.el.addEventListener('wheel', (e) => {
            e.preventDefault();

            // Calcular nuevo zoom
            var delta = e.deltaY > 0 ? 0.9 : 1.1;
            var newZoom = this.currentZoom * delta;

            // Limitar zoom
            newZoom = Math.max(0.05, Math.min(3, newZoom));

            if (newZoom !== this.currentZoom) {
                // Fórmula estándar de "zoom hacia un punto": paper.translate()
                // fija la traslación en PÍXELES de forma absoluta (no la suma
                // a la actual), así que hay que calcular el nuevo (tx,ty)
                // absoluto que deja el mismo punto de modelo bajo el cursor,
                // no un delta a sumar (eso era el bug: la traducción vieja
                // trataba `translate()` como relativa y mezclaba unidades de
                // modelo con píxeles, por eso el zoom "se volvía loco").
                var rect = this.editor.paper.el.getBoundingClientRect();
                var mouseX = e.clientX - rect.left;
                var mouseY = e.clientY - rect.top;

                var oldTranslate = this.editor.paper.translate();
                var scaleRatio = newZoom / this.currentZoom;

                var newTx = mouseX - (mouseX - oldTranslate.tx) * scaleRatio;
                var newTy = mouseY - (mouseY - oldTranslate.ty) * scaleRatio;

                this.currentZoom = newZoom;
                this.editor.paper.scale(this.currentZoom, this.currentZoom);
                this.editor.paper.translate(newTx, newTy);
                this.updateCanvasInfo();
            }
        }, { passive: false });
    }

    // ==================== MÉTODOS DE ZOOM ====================

    zoomIn() {
        var newZoom = Math.min(3, this.currentZoom * 1.1);
        this.setZoom(newZoom);
        console.log('🔍 Zoom In:', Math.round(this.currentZoom * 100) + '%');
        this.updateCanvasInfo();
    }

    zoomOut() {
        var newZoom = Math.max(0.05, this.currentZoom * 0.9);
        this.setZoom(newZoom);
        console.log('🔍 Zoom Out:', Math.round(this.currentZoom * 100) + '%');
        this.updateCanvasInfo();
    }

    setZoom(zoom) {
        this.currentZoom = zoom;
        this.editor.paper.scale(this.currentZoom, this.currentZoom);
        this.updateCanvasInfo();
    }

    zoomToFit() {
        try {
            // Obtener elementos para calcular el área ocupada
            var elements = this.editor.graph.getElements();
            var links = this.editor.graph.getLinks();

            if (elements.length === 0 && links.length === 0) {
                // Si no hay elementos, resetear zoom y centrar
                this.currentZoom = 1;
                this.editor.paper.scale(1, 1);
                this.editor.paper.translate(0, 0);
                console.log('🔍 Zoom Reset: 100% (sin elementos)');
                this.updateCanvasInfo();
                return;
            }

            // Encuadre propio en vez de paper.scaleContentToFit(): con el
            // paper en width/height '100%' y una pantalla angosta (celular),
            // JointJS dejaba una traslación de miles de píxeles y el
            // diagrama quedaba fuera de la vista. Acá se calcula directo con
            // el área del grafo (en coordenadas del modelo) y el tamaño real
            // del contenedor.
            var bbox = this.editor.graph.getBBox();
            var el = this.editor.paper.el;
            var width = el.clientWidth;
            var height = el.clientHeight;
            var padding = Math.min(50, Math.max(16, Math.min(width, height) * 0.06));

            if (!bbox || !width || !height) throw new Error('Sin área para encuadrar');

            var scale = Math.min(
                (width - padding * 2) / Math.max(bbox.width, 1),
                (height - padding * 2) / Math.max(bbox.height, 1)
            );
            scale = Math.max(0.05, Math.min(1.5, scale));

            this.currentZoom = scale;
            this.editor.paper.scale(scale, scale);
            this.editor.paper.translate(
                (width - bbox.width * scale) / 2 - bbox.x * scale,
                (height - bbox.height * scale) / 2 - bbox.y * scale
            );

            console.log('🔍 Zoom to Fit:', Math.round(this.currentZoom * 100) + '%');
            this.updateCanvasInfo();

        } catch (error) {
            console.error('❌ Error en zoom to fit:', error);
            // Fallback: zoom manual centrado
            this.currentZoom = 1;
            this.editor.paper.scale(1, 1);
            this.editor.paper.translate(0, 0);
            this.updateCanvasInfo();
        }
    }

    // Método para centrar la vista
    centerView() {
        try {
            var elements = this.editor.graph.getElements();
            if (elements.length === 0) return;

            // Calcular centro de todos los elementos
            var bbox = this.editor.graph.getBBox();
            if (!bbox) return;

            var containerRect = this.editor.paper.el.getBoundingClientRect();
            var centerX = containerRect.width / 2;
            var centerY = containerRect.height / 2;

            var modelCenterX = bbox.x + bbox.width / 2;
            var modelCenterY = bbox.y + bbox.height / 2;

            // Calcular traslación para centrar
            var translateX = centerX - modelCenterX * this.currentZoom;
            var translateY = centerY - modelCenterY * this.currentZoom;

            this.editor.paper.translate(translateX, translateY);

            console.log('🎯 Vista centrada');

        } catch (error) {
            console.error('❌ Error centrando vista:', error);
        }
    }

    // Método para resetear zoom y pan
    resetViewport() {
        this.currentZoom = 1;
        this.editor.paper.scale(1, 1);
        this.editor.paper.translate(0, 0);
        console.log('🔄 Viewport reseteado');
        this.updateCanvasInfo();
    }

    // ==================== INFORMACIÓN DEL CANVAS MEJORADA ====================

    updateCanvasInfo() {
        var elements = this.editor.graph.getElements();
        var links = this.editor.graph.getLinks();
        var zoom = Math.round(this.currentZoom * 100);

        // Información más detallada
        var info = `${elements.length} clases · ${links.length} relaciones · ${zoom}%`;

        var infoElement = document.getElementById('canvas-info');
        if (infoElement) {
            infoElement.textContent = info;
        }

        // Actualizar título si está disponible
        if (window.currentDiagramTitle && !this.editor.viewerMode) {
            document.title = `${window.currentDiagramTitle} - Editor UML (${zoom}%)`;
        }

        // Actualizar controles de zoom si existen
        this.updateZoomControls();
    }

    updateZoomControls() {
        // Actualizar estado de botones de zoom
        var zoomInBtn = document.getElementById('zoom-in');
        var zoomOutBtn = document.getElementById('zoom-out');
        var zoomFitBtn = document.getElementById('zoom-fit');
        var zoomPercentage = document.getElementById('zoom-percentage');

        if (zoomInBtn) {
            zoomInBtn.disabled = this.currentZoom >= 3;
        }

        if (zoomOutBtn) {
            zoomOutBtn.disabled = this.currentZoom <= 0.2;
        }

        if (zoomPercentage) {
            zoomPercentage.textContent = Math.round(this.currentZoom * 100) + '%';
        }
    }

    getCurrentZoom() {
        return this.currentZoom;
    }
}
