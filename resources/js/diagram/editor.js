// resources/js/diagram/editor.js - VERSIÓN REFACTORIZADA CON MÓDULOS
// Mantiene exactamente la misma funcionalidad, pero dividida en módulos

import * as joint from 'jointjs';
import { DiagramSaveManager } from './DiagramSaveManager.js';
import { DiagramZoomManager } from './DiagramZoomManager.js';
import { DiagramClassManager } from './DiagramClassManager.js';
import { DiagramPropertiesPanel, describeElement } from './DiagramPropertiesPanel.js';
import { DiagramRelationshipManager } from './DiagramRelationshipManager.js';
import { DiagramWebSocketManager } from './DiagramWebSocketManager.js';
import { DiagramCollaborationManager } from './DiagramCollaborationManager.js';
import { DiagramSidebarResize } from './DiagramSidebarResize.js';
import { SimpleImageExporter } from './utils/simpleImageExport.js';
import { SimpleXMIExporter } from './utils/simpleXMIExport.js';
import { SimpleXMIImporter } from './utils/simpleXMIImport.js';
import { SimpleImageImporter } from './utils/simpleImageImport.js';
import { SimpleSQLGenerator } from './utils/simpleSQLGenerator.js';
import { SimpleJavaGenerator } from './utils/simpleJavaGenerator.js';
import { SimplePostmanGenerator } from './utils/simplePostmanGenerator.js';
import { AIChatController } from './modules-ai/ai-chat/AIChatController.js';
import { DiagramUndoManager } from './undo/DiagramUndoManager.js';
import { icon } from './utils/uiIcons.js';
import { openModal, confirmDialog } from './utils/modal.js';
import { isUmlClassElement } from './DiagramElementFactory.js';
import { buildAnchorNamespace, buildRouterNamespace } from './utils/relationshipAnchor.js';
// Configurar JointJS correctamente
joint.config.useCSSSelectors = false;
// No mutar joint.anchors/joint.routers (namespace de JointJS, no-extensible
// en el build de producción — ver el docblock de buildAnchorNamespace en
// relationshipAnchor.js). Se arman objetos propios y se pasan al Paper
// como anchorNamespace/routerNamespace más abajo.
const customAnchorNamespace = buildAnchorNamespace(joint);
const customRouterNamespace = buildRouterNamespace(joint);

/** Texto dinámico (ej. notas del importador de IA) va siempre por acá antes de insertarse en innerHTML. */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

class UMLDiagramEditor {
    constructor() {
        console.log('🚀 Inicializando UMLDiagramEditor...');

        this.graph = new joint.dia.Graph();
        this.paper = null;
        this.selectedTool = 'select';
        this.selectedElement = null;
        this.currentZoom = 1;

        // Estados para relaciones
        this.relationshipMode = false;
        this.firstElementSelected = null;

        // Un colaborador con rol "viewer" ve los cambios en vivo pero no
        // puede crear/editar nada (Collaborator::canEdit() en el backend).
        this.readOnlyCollaborator = window.collaboratorRole === 'viewer';

        // Modo "solo ver" (resources/views/diagrams/viewer.blade.php): el
        // mismo motor de dibujo y el mismo tiempo real que el editor, pero
        // sin herramientas, sin locks, sin guardar y sin difundir nada. Lo
        // usan la página "Ver" de la web y la app móvil (embebida).
        this.viewerMode = window.UML_VIEWER_MODE === true;
        if (this.viewerMode) this.readOnlyCollaborator = true;

        // Templates UML mejorados
        this.umlTemplates = {
            visibility: {
                '+': 'public',
                '-': 'private',
                '#': 'protected',
                '~': 'package'
            },
            commonTypes: [
                'String', 'int', 'boolean', 'double', 'float', 'long', 'char',
                'Date', 'LocalDateTime', 'BigDecimal', 'List<>', 'Set<>', 'Map<,>'
            ]
        };

        // Inicializar módulos
        this.saveManager = new DiagramSaveManager(this);
        this.zoomManager = new DiagramZoomManager(this);
        this.classManager = new DiagramClassManager(this);
        this.relationshipManager = new DiagramRelationshipManager(this);
        this.propertiesPanel = new DiagramPropertiesPanel(this);

        // Bloqueo de edición: se pide/suelta UNA vez por cada cambio real de
        // selección (ver selectElement), no por cada arrastre — arrastrar
        // ya presupone que el elemento está seleccionado (y por lo tanto
        // bloqueado), así que no hace falta un lock aparte para el gesto de
        // mover. _lockedSelectionId es el elemento cuyo lock tenemos
        // nosotros ahora mismo (o null si no tenemos ninguno);
        // _lockHeartbeatInterval lo va renovando mientras dure la selección
        // (ver _startLockHeartbeat/_stopLockHeartbeat) para que no expire
        // por TTL mientras seguimos genuinamente mirando/editando algo.
        this._lockedSelectionId = null;
        this._lockHeartbeatInterval = null;

        this.init();
    }

    init() {
        this.createPaper();
        if (!this.viewerMode) {
            this.aiChat = new AIChatController(this);
            this.xmiImporter = new SimpleXMIImporter(this);
            this.imageImporter = new SimpleImageImporter(this);
            this.setupEventListeners();
        }
        this.zoomManager.setupZoomButtons();
        this.zoomManager.setupPanNavigation();
        this.zoomManager.setupTouchNavigation();
        if (!this.viewerMode) {
            this.sidebarResize = new DiagramSidebarResize(this);
        }
        this.saveManager.loadDiagramData();
        // Deshacer/rehacer por usuario: se crea DESPUÉS de cargar, así la carga
        // inicial no cuenta como acción (ver undo/DiagramUndoManager.js).
        if (!this.viewerMode) {
            this.undoManager = new DiagramUndoManager(this);
        }
        // NUEVO: Inicializar colaboración si está disponible
        this.initializeCollaboration();
        if (this.viewerMode) {
            this.listenForSavedVersions();
        }
        console.log('✅ UMLDiagramEditor inicializado correctamente');
    }
// NUEVO: Método para inicializar colaboración opcional
async initializeCollaboration() {
    // Solo inicializar colaboración si hay datos de sesión
    const hasSessionData = !!window.diagramSessionId;
    const hasEcho = window.Echo !== undefined;

    if (hasEcho && hasSessionData) {
        console.log('🤝 Iniciando modo colaborativo...');

        // Inicializar módulos de colaboración
        this.webSocketManager = new DiagramWebSocketManager(this);
        this.collaborationManager = new DiagramCollaborationManager(this);

        // Intentar conectar
        try {
            const connected = await this.webSocketManager.initialize();
            if (connected) {
                if (!this.viewerMode) this.webSocketManager.integrateWithClassManager();
                console.log('✅ Colaboración activada');
            } else {
                console.warn('⚠️ Colaboración no disponible');
            }
        } catch (error) {
            console.error('❌ Error en colaboración:', error);
        }
    } else {
        console.log('📝 Modo individual (sin colaboración)');
        // Inicializar variables nulas para evitar errores
        this.webSocketManager = null;
        this.collaborationManager = null;

        // Todavía no hay sesión — si somos el dueño, nos quedamos
        // escuchando el "lobby" del diagrama para enterarnos en el momento
        // en que alguien acepte una invitación y se cree la sesión, y pasar
        // a modo colaborativo sin recargar la página.
        if (hasEcho && window.isDiagramOwner && window.diagramId && !this.viewerMode) {
            this.listenForCollaborationStart();
        }
    }
}

/**
 * Solo en modo "solo ver" (vista "Ver" y app móvil): cada vez que alguien
 * guarda, el servidor avisa por 'diagram-agent.{id}' con DiagramContentChanged.
 *
 * - Sin sesión en vivo es la única vía de actualización: se pide el diagrama.
 * - Con sesión en vivo los cambios ya llegan uno por uno por el canal del
 *   diagrama, y el autoguardado corre 1,5 s después de CADA edición. Antes se
 *   borraba y redibujaba todo con cada guardado: una versión atrasada respecto
 *   de lo que ya se veía (las clases saltaban hacia atrás), parpadeo y mucho
 *   trabajo en el celular. Ahora, en vivo, se espera a que el otro deje de
 *   editar y solo se redibuja si lo guardado difiere de lo que hay en pantalla
 *   (corrige un cambio en vivo perdido, nada más).
 */
listenForSavedVersions() {
    if (!window.Echo || !window.diagramId || !window.authUser) return;

    let lastVersion = null;
    window.Echo.private(`diagram-agent.${window.diagramId}`)
        .listen('.DiagramContentChanged', (event) => {
            if (event?.version && event.version === lastVersion) return;
            lastVersion = event?.version ?? null;
            this.scheduleViewerReload();
        });
}

isLiveViewer() {
    return !!this.webSocketManager?.isConnected;
}

scheduleViewerReload() {
    clearTimeout(this._viewerReloadTimer);
    // En vivo: esperar a que haya calma (sin movimientos remotos recientes).
    const delay = this.isLiveViewer() ? 2500 : 0;
    this._viewerReloadTimer = setTimeout(() => {
        if (this.isLiveViewer() && this.collaborationManager?.hadRecentRemoteActivity(2000)) {
            this.scheduleViewerReload();
            return;
        }
        this.reloadFromServer();
    }, delay);
}

/** Lo que importa comparar de un diagrama: ids, posiciones, contenido UML y extremos. */
viewerFingerprint(cells) {
    return JSON.stringify((cells || []).map((cell) => [
        cell.id,
        cell.position ? Math.round(cell.position.x) : null,
        cell.position ? Math.round(cell.position.y) : null,
        cell.umlData || null,
        cell.relationData || null,
        cell.source?.id || null,
        cell.target?.id || null,
        cell.labels || null,
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

async reloadFromServer() {
    // Un solo pedido a la vez; si llega otro aviso mientras tanto, se repite al final.
    if (this._viewerReloading) {
        this._viewerReloadPending = true;
        return;
    }
    this._viewerReloading = true;

    try {
        const response = await fetch(`/diagrams/api/${window.diagramId}/data`, {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
        });
        if (!response.ok) return;
        const payload = await response.json();
        const cells = payload?.data?.cells;
        if (!Array.isArray(cells)) return;

        // Igual a lo que ya se ve (llegó en vivo): no se redibuja, pero se avisa
        // igual, así la app móvil actualiza sus contadores.
        const current = this.graph.toJSON().cells;
        if (this.viewerFingerprint(cells) === this.viewerFingerprint(current)) {
            document.dispatchEvent(new CustomEvent('uml-viewer:reloaded'));
            return;
        }

        // Conserva el encuadre actual: recargar no debe mover la vista.
        const scale = this.paper.scale();
        const translate = this.paper.translate();
        this.graph.clear();
        this.saveManager.recreateElementsFromData(cells);
        this.paper.scale(scale.sx, scale.sy);
        this.paper.translate(translate.tx, translate.ty);
        this.updateCanvasInfo();
        document.dispatchEvent(new CustomEvent('uml-viewer:reloaded'));
    } catch (error) {
        console.warn('No se pudo recargar el diagrama:', error);
    } finally {
        this._viewerReloading = false;
        if (this._viewerReloadPending) {
            this._viewerReloadPending = false;
            this.scheduleViewerReload();
        }
    }
}

/**
 * Canal aparte de 'diagram.{sessionId}' (que todavía no existe en este
 * punto): 'diagram-lobby.{diagramId}' vive mientras dure la página, esté o
 * no activa la colaboración, así el dueño puede recibir el aviso de que se
 * creó una sesión sin haber estado suscrito a nada de esa sesión todavía.
 */
listenForCollaborationStart() {
    if (this._lobbyChannel) return; // ya estamos escuchando

    const channelName = `diagram-lobby.${window.diagramId}`;
    this._lobbyChannel = window.Echo.private(channelName);

    this._lobbyChannel.listen('.CollaborationSessionStarted', (event) => {
        console.log('🤝 Sesión colaborativa activada (otro usuario se sumó):', event.sessionId);

        window.Echo.leave(channelName);
        this._lobbyChannel = null;

        window.diagramSessionId = event.sessionId;
        this.initializeCollaboration();
    });
}
    createPaper() {
        var container = document.getElementById('paper-container');
        if (!container) {
            console.error('❌ Container #paper-container no encontrado');
            return;
        }

        console.log('📋 Creando paper...');

        this.paper = new joint.dia.Paper({
            el: container,
            model: this.graph,
            width: '100%',
            height: '100%',
            gridSize: 10,
            anchorNamespace: customAnchorNamespace,
            // joint.linkAnchors (para anclar un link A OTRO LINK, ej. el
            // conector de clase asociativa — ver DiagramRelationshipManager,
            // case 'associationClassLink') es un registro SEPARADO de
            // joint.anchors (para anclar a un ELEMENTO) — tiene sus propias
            // funciones (`connectionRatio`, `connectionLength`, etc.), no
            // están en joint.anchors. Antes esto apuntaba por error a
            // customAnchorNamespace (el de elementos), así que
            // 'connectionRatio' nunca se encontraba y el link de clase
            // asociativa se creaba pero quedaba sin dibujar (path vacío,
            // sin error en consola) — visto en vivo al probar la feature.
            // No hace falta envolverlo en un objeto propio como los otros
            // dos: acá no se agrega ningún anchor custom, solo se lee, así
            // que pasar el namespace congelado de JointJS tal cual alcanza.
            linkAnchorNamespace: joint.linkAnchors,
            routerNamespace: customRouterNamespace,
            drawGrid: {
                name: 'mesh',
                args: {
                    color: '#e5e7eb',
                    thickness: 1,
                    scaleFactor: 5
                }
            },
            background: {
                color: 'transparent',
               // image: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxMCAxMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNSIgY3k9IjUiIHI9IjAuNSIgZmlsbD0iI2Q2ZDNkMSIvPgo8L3N2Zz4K'
            },

            // Configuración para interactividad con pan
            interactive: function(elementView) {
                if (this.viewerMode) return false;
                // Los elementos son interactivos solo en modo select, y nunca
                // si otro colaborador ya lo tiene bloqueado (editándolo o
                // arrastrándolo en este mismo instante).
                if (this.selectedTool !== 'select') return false;
                if (this.collaborationManager?.isLockedByOther(elementView.model.id)) return false;
                return true;
            }.bind(this),

            // DESHABILITAR zoom con rueda nativo para usar el personalizado
            mouseWheelZoom: false,
            restrictTranslate: false, // Permitir movimiento libre
            snapLabels: true,
            markAvailable: true,

            // Permitir que el paper se mueva fuera de los límites
            // 'distributedSide' (definido en utils/relationshipAnchor.js) envuelve
            // al manhattan de JointJS: calcula el camino más corto entre los
            // dos anchors evitando pasar por encima de otras clases (las
            // trata como obstáculos) — orthogonal (el de antes) solo traza
            // en L/Z sin mirar qué hay en el medio, por eso las líneas antes
            // atravesaban clases. excludeEnds evita que la propia clase de
            // origen/destino cuente como obstáculo contra sí misma.
            // startDirections/endDirections con los 4 lados es el valor por
            // defecto que el wrapper usa SOLO si no puede determinar el lado
            // real del ancla — normalmente los reemplaza por el lado exacto
            // que ya resolvió el ancla, para que la línea salga siempre
            // perpendicular al centro del lado en vez de colarse por una
            // esquina (ver el comentario largo en relationshipAnchor.js).
            defaultRouter: {
                name: 'distributedSide',
                args: {
                    // step más grande (20 en vez del default 10) = menos
                    // "escalones" innecesarios cerca de los extremos: cuando
                    // el punto de anclaje no cae justo en la grilla, el
                    // router antes corregía con dos giros pegados uno al
                    // otro a solo 10-20px del borde, y el conector 'rounded'
                    // (radio 10) los dibujaba superpuestos — la línea rota y
                    // "flotando" que se veía en la herencia. Con más espacio
                    // entre giros alcanza para que el radio del conector no
                    // se pise a sí mismo.
                    step: 20,
                    padding: 20,
                    excludeEnds: ['source', 'target'],
                    startDirections: ['top', 'right', 'bottom', 'left'],
                    endDirections: ['top', 'right', 'bottom', 'left'],
                }
            },
            defaultConnector: { name: 'rounded' },

            // Configuración de viewport
            async: true,
            frozen: false,
            sorting: joint.dia.Paper.sorting.APPROX
        });

        // Eventos del paper (en modo "solo ver" no se selecciona ni edita nada)
        if (this.viewerMode) {
            // Grilla CSS: la de JointJS se regenera como imagen en cada desplazamiento.
            this.zoomManager.useLightGrid();
            this.zoomManager.setupMouseWheelZoom();
            return;
        }
        this.paper.on('element:pointerdown', this.onElementClick.bind(this));
        this.paper.on('blank:pointerdown', this.onBlankClick.bind(this));
        this.paper.on('element:pointermove', this.onElementPointerMove.bind(this));
        this.paper.on('element:pointerup', this.onElementPointerUp.bind(this));
        this.paper.on('link:pointerdown', this.onLinkClick.bind(this));
        this.paper.on('element:pointerdblclick', this.onElementDoubleClick.bind(this));
        this.paper.on('link:pointerdblclick', this.onLinkDoubleClick.bind(this));

        // Configurar zoom personalizado con rueda del mouse
        this.zoomManager.setupMouseWheelZoom();

        console.log('✅ Paper creado correctamente con pan support');
    }

    setupEventListeners() {
        // Shortcuts de teclado
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.saveManager.saveDiagram();
            } else if (e.key === 'Delete' && this.selectedElement && !e.target.closest?.('input, textarea, select, [contenteditable="true"]')) {
                // Supr dentro de un campo (chat, propiedades) borra texto, no la clase.
                this.deleteElement();
            } else if (e.key === 'Escape') {
                this.cancelOperation();
            }
            // Shortcuts de zoom
            else if (e.ctrlKey && e.key === '+') {
                e.preventDefault();
                this.zoomManager.zoomIn();
            } else if (e.ctrlKey && e.key === '-') {
                e.preventDefault();
                this.zoomManager.zoomOut();
            } else if (e.ctrlKey && e.key === '0') {
                e.preventDefault();
                this.zoomManager.setZoom(1); // Reset a 100%
            } else if (e.ctrlKey && e.key === '9') {
                e.preventDefault();
                this.zoomManager.zoomToFit();
            }
            // Shortcuts de navegación
            else if (e.key === 'Home') {
                e.preventDefault();
                this.zoomManager.centerView();
            } else if (e.ctrlKey && e.key === 'h') {
                e.preventDefault();
                this.zoomManager.resetViewport();
            }
        });

        this.setupCanvasDragAndDrop();

        console.log('✅ Event listeners configurados (incluyendo zoom shortcuts y pan)');
        const exportPNGBtn = document.getElementById('export-png-btn');
        const exportJPGBtn = document.getElementById('export-jpg-btn');

        if (exportPNGBtn) {
            exportPNGBtn.addEventListener('click', () => this.exportToPNG());
        }

        if (exportJPGBtn) {
            exportJPGBtn.addEventListener('click', () => this.exportToJPG());
        }

        // Botón de exportación XMI
        const exportXMIBtn = document.getElementById('export-xmi-btn');
        if (exportXMIBtn) {
            exportXMIBtn.addEventListener('click', () => this.exportToXMI());
        }

        // Botón de importación XMI
        const importXMIBtn = document.getElementById('import-xmi-btn');
        if (importXMIBtn) {
            importXMIBtn.addEventListener('click', () => this.importFromXMI());
        }

        // Botón de importación desde imagen
        const importImageBtn = document.getElementById('import-image-btn');
        if (importImageBtn) {
            importImageBtn.addEventListener('click', () => this.importFromImage());
        }

        // Botón de generación SQL
        const generateSQLBtn = document.getElementById('generate-sql-btn');
        if (generateSQLBtn) {
            generateSQLBtn.addEventListener('click', () => this.generateSQL());
        }

        const generateJavaBtn = document.getElementById('generate-java-btn');
        if (generateJavaBtn) {
            generateJavaBtn.addEventListener('click', () => this.generateJavaProject());
        }

        const generatePostmanBtn = document.getElementById('generate-postman-btn');
        if (generatePostmanBtn) {
            generatePostmanBtn.addEventListener('click', () => this.generatePostmanCollection());
        }
    }

    // ==================== SELECCIÓN DE HERRAMIENTAS ====================

    selectTool(tool) {
        this.selectedTool = tool;

        // Resetear estados
        if (this.relationshipManager.getFirstElementSelected()) {
            this.highlightElement(this.relationshipManager.getFirstElementSelected(), false);
            this.relationshipManager.resetFirstElementSelected();
        }
        if (this.relationshipManager.associativeClassSelected) {
            this.highlightElement(this.relationshipManager.associativeClassSelected, false);
            this.relationshipManager.associativeClassSelected = null;
        }
        this.relationshipManager.hideRelationshipHelp();

        // Cambiar cursor del paper
        var paperEl = this.paper.el;
        paperEl.style.cursor = 'default';

        if (tool === 'class' || tool === 'interface') {
            paperEl.style.cursor = 'crosshair';
        }

        // Actualizar UI de herramientas
        document.querySelectorAll('.tool-btn, .uml-shape-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-tool="${tool}"]`)?.classList.add('active');

        console.log('🔧 Herramienta seleccionada:', tool);
    }

    // ==================== EVENTOS DEL PAPER ====================

    onElementClick(elementView, evt) {
        evt.stopPropagation();

        if (this.selectedTool === 'select') {
            this.selectElement(elementView.model);

            // Avisar a los demás qué elemento estoy mirando/por interactuar,
            // aunque no llegue a moverlo ni editarlo (resaltado liviano, no
            // es un bloqueo). Un elemento ya bloqueado por otro no se toca.
            if (!this.collaborationManager?.isLockedByOther(elementView.model.id)) {
                this.webSocketManager?.broadcastElementSelection(elementView.model.id);
            }
        } else if (!this.readOnlyCollaborator && ['association', 'aggregation', 'composition', 'inheritance', 'realization', 'dependency'].includes(this.selectedTool)) {
            this.relationshipManager.handleRelationshipClick(elementView.model, evt);
        } else if (!this.readOnlyCollaborator && this.selectedTool === 'associationClassLink') {
            this.relationshipManager.handleAssociationClassLinkClick(elementView.model, evt);
        }
    }

    onBlankClick(evt) {
        if (this.readOnlyCollaborator) return;

        if (this.selectedTool === 'class') {
            var point = this.paper.clientToLocalPoint(evt.clientX, evt.clientY);
            this.classManager.createClassImproved(point.x, point.y);
        } else if (this.selectedTool === 'interface') {
            var point = this.paper.clientToLocalPoint(evt.clientX, evt.clientY);
            this.classManager.createInterface(point.x, point.y);
        }

        // Clic en el vacío con una herramienta de relación a medias: se cancela
        // y se vuelve a "Seleccionar", así nunca queda el lienzo trabado.
        if (this.selectedTool !== 'select' && this.selectedTool !== 'class' && this.selectedTool !== 'interface') {
            this.relationshipManager.hideRelationshipHelp();
            this.selectTool('select');
        }

        // Deseleccionar elemento
        this.selectElement(null);
        this.releaseAnyHeldLock();

        // Avisar a los demás que ya no estoy mirando ningún elemento — si no,
        // el resaltado de "lo tengo seleccionado" les queda pegado hasta que
        // expire solo (5s) en vez de desaparecer al instante.
        this.webSocketManager?.broadcastElementSelection(null);
    }

    /**
     * Suelta el bloqueo de edición que tengamos tomado ahora mismo, si hay
     * alguno (ver _lockedSelectionId en el constructor y selectElement) —
     * usado al cambiar de selección, y como red de seguridad para cuando el
     * elemento se pierde de otra forma (Escape, clic en pizarra en blanco,
     * borrado, pérdida de foco de la ventana). Sin esto el elemento queda
     * marcado como "en edición" para los demás hasta que expire el TTL del
     * backend (120s).
     */
    releaseAnyHeldLock() {
        this._stopLockHeartbeat();
        if (!this._lockedSelectionId) return;
        this.webSocketManager?.releaseLock(this._lockedSelectionId);
        this._lockedSelectionId = null;
    }

    /**
     * Mientras un elemento siga seleccionado (con o sin el panel de
     * propiedades abierto — da igual, dura lo mismo que la selección) hay
     * que seguir renovando su lock: el backend lo trata como abandonado a
     * los 120s sin noticias (Collaborator::LOCK_TTL_SECONDS), así que sin
     * esto alguien podría quedarse mirando/editando una clase más de 2
     * minutos y perder el lock (o que a los demás se les borre el borde
     * rojo) sin haber soltado nada — el lock tiene que durar hasta que el
     * USUARIO haga clic en otro lado, no hasta que se cumpla un reloj fijo.
     */
    _startLockHeartbeat(elementId) {
        this._stopLockHeartbeat();
        this._lockHeartbeatInterval = setInterval(() => {
            this.webSocketManager?.renewLock(elementId);
        }, 60000); // bien por debajo del TTL de 120s del backend
    }

    _stopLockHeartbeat() {
        clearInterval(this._lockHeartbeatInterval);
        this._lockHeartbeatInterval = null;
    }

    // Arrastrar una herramienta de "clase"/"interfaz" desde el sidebar y
    // soltarla sobre el canvas la crea en ese punto exacto. Usa la misma
    // API nativa de drag & drop del navegador, que es un gesto distinto e
    // independiente del click (blank:pointerdown de JointJS), así que no
    // puede disparar una creación doble ni interferir con el flujo de
    // "clic en herramienta + clic en canvas" que sigue funcionando igual.
    setupCanvasDragAndDrop() {
        var container = this.paper.el;

        container.addEventListener('dragover', (e) => {
            var tool = e.dataTransfer.types.includes('text/uml-tool');
            if (!tool) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            container.classList.add('uml-drop-zone-active');
        });

        container.addEventListener('dragleave', (e) => {
            if (e.target === container) {
                container.classList.remove('uml-drop-zone-active');
            }
        });

        container.addEventListener('drop', (e) => {
            var tool = e.dataTransfer.getData('text/uml-tool');
            container.classList.remove('uml-drop-zone-active');
            if (!tool || this.readOnlyCollaborator) return;
            e.preventDefault();

            var point = this.paper.clientToLocalPoint(e.clientX, e.clientY);
            if (tool === 'class') {
                this.classManager.createClassImproved(point.x, point.y);
            } else if (tool === 'interface') {
                this.classManager.createInterface(point.x, point.y);
            }
        });
    }

    onElementDoubleClick(elementView, evt) {
        const element = elementView.model;
        if (!isUmlClassElement(element)) return;

        // El clic simple que precedió a este doble clic ya intentó tomar el
        // lock en selectElement() — si otro colaborador ya lo tenía, no lo
        // conseguimos. En ese caso el panel NO se abre (ni en modo lectura):
        // solo se avisa que está ocupado, igual que si se intentara arrastrarlo.
        if (this.collaborationManager?.isLockedByOther(element.id)) {
            const lock = this.collaborationManager.getLockOwner(element.id);
            this.collaborationManager.showLockConflictNotification(`${lock?.userName || 'Otro usuario'} está editando este elemento`);
            return;
        }

        this.classManager.editClassImproved(element);
    }

    onElementPointerMove(elementView) {
        this.updateCanvasInfo();

        if (!this.webSocketManager) return;

        // El lock de edición ya se pidió al seleccionar (ver selectElement) —
        // arrastrar es parte del mismo gesto de "tener el elemento
        // seleccionado", no dispara un lock aparte.

        // Posición en vivo mientras se arrastra: va por "whisper" (mensaje
        // cliente-a-cliente directo sobre el WebSocket ya abierto, sin pasar
        // por el backend), no por el relevo HTTP normal. Es el mecanismo
        // correcto para datos efímeros de alta frecuencia como este — y con
        // Reverb autoalojado (a diferencia de Pusher) no depende de ninguna
        // config externa, así que ya no hay motivo para no usarlo acá.
        const now = Date.now();
        if (this._lastPositionBroadcast && now - this._lastPositionBroadcast < 40) return;
        this._lastPositionBroadcast = now;

        const elementId = elementView.model.id;
        const position = elementView.model.position();
        this.webSocketManager.whisperElementMove(elementId, { x: position.x, y: position.y });
    }

    onElementPointerUp(elementView) {
        if (!this.webSocketManager) return;

        const element = elementView.model;
        const position = element.position();

        // Posición final por el canal fiable (no whisper): garantiza que
        // llegue aunque se haya perdido algún whisper intermedio, y que
        // quede como base correcta para quien se una a la sesión después.
        this.webSocketManager.broadcastDiagramUpdate({
            type: 'element_moved',
            data: { elementId: element.id, position: { x: position.x, y: position.y } }
        });

        // El lock se suelta al cambiar de selección (selectElement) o al
        // deseleccionar (onBlankClick/cancelOperation), no acá — terminar de
        // arrastrar no implica soltar el elemento, sigue seleccionado.
    }

    onLinkClick(linkView, evt) {
        evt.stopPropagation();
        if (this.selectedTool === 'select') {
            this.selectElement(linkView.model);
        } else if (!this.readOnlyCollaborator && this.selectedTool === 'associationClassLink') {
            // Segundo click del flujo clase asociativa: acá es donde se
            // elige LA RELACIÓN a la que se une la clase (ver
            // DiagramRelationshipManager.handleAssociationClassLinkClick).
            this.relationshipManager.handleAssociationClassLinkClick(linkView.model, evt);
        }
    }

    onLinkDoubleClick(linkView, evt) {
        if (this.readOnlyCollaborator) return;

        // Editar relación
        this.relationshipManager.editRelationship(linkView.model);
    }

    // ==================== UTILIDADES Y RESTO DE FUNCIONES ====================

    selectElement(element) {
        const previous = this.selectedElement;
        const sameElement = !!previous && !!element && previous.id === element.id;

        // Remover selección anterior
        if (previous && !sameElement) {
            this.highlightElement(previous, false);
        }

        this.selectedElement = element;

        if (element && !sameElement) {
            this.highlightElement(element, true, '#4f46e5');
            console.log('Elemento seleccionado:', element.get('type'));
        }

        if (sameElement) return; // no cambió la selección: nada que (des)bloquear ni cerrar

        // Cambiar de selección corta la ráfaga de deshacer (cada clase, su paso).
        this.undoManager?.boundary(element?.id ?? null);

        // Bloqueo de edición: se pide/suelta acá, una única vez por cambio
        // de selección — ver el comentario en el constructor sobre
        // _lockedSelectionId. Clases/interfaces se bloquean; relaciones no
        // (se siguen editando aparte, con su propio modal de doble clic), así
        // que clickear una relación simplemente suelta el lock que hubiera.
        this.releaseAnyHeldLock();

        if (
            element && isUmlClassElement(element) &&
            !this.readOnlyCollaborator &&
            !this.collaborationManager?.isLockedByOther(element.id)
        ) {
            this._lockedSelectionId = element.id;
            const requestedElementId = element.id;
            this._startLockHeartbeat(requestedElementId);

            // Optimista: ya se marcó como bloqueado por nosotros arriba, sin
            // esperar la red. Si el servidor responde (en paralelo) que en
            // realidad ya lo tenía otro colaborador, hay que dar marcha
            // atrás — pero solo si la selección no cambió mientras tanto.
            this.webSocketManager?.requestLock(element.id).then(granted => {
                if (this._lockedSelectionId !== requestedElementId) return;
                if (granted) return;

                this._lockedSelectionId = null;
                this._stopLockHeartbeat();
                this.collaborationManager?.showLockConflictNotification('Otro usuario ya está editando este elemento');
                if (this.propertiesPanel?.currentElement?.id === requestedElementId) {
                    this.propertiesPanel.renderRightPanel();
                    this.propertiesPanel.renderBottomPanel();
                }
            });
        }

        // Paneles de propiedades (derecha/abajo): un clic simple ya NO los
        // abre (eso hacía que se abrieran con cualquier interacción sobre
        // una clase) — solo el doble clic los abre, ver onElementDoubleClick.
        // Acá solo nos encargamos de cerrarlos si había uno abierto y la
        // selección cambió de elemento (si acabamos de re-seleccionar el
        // mismo, ya se cortó arriba con el `return` de sameElement).
        if (this.propertiesPanel?.currentElement) {
            this.propertiesPanel.clear();
        }
    }

    highlightElement(element, highlight, color = '#4f46e5') {
        if (element.isLink && element.isLink()) {
            // Resaltar enlaces — el color base de la línea es el mismo para
            // los 6 tipos de relación (ver getRelationshipAttrs), así que no
            // hace falta mirar el tipo para restaurarlo.
            element.attr('line/strokeWidth', highlight ? 3 : 2);
            element.attr('line/stroke', highlight ? color : '#334155');
        } else {
            // Restaurar el borde a SU color real (no uno fijo): depende del
            // tipo (clase/interfaz) y del estereotipo UML 2.5 (entity,
            // service, etc. tienen cada uno el suyo) — antes esto pisaba
            // todo con un azul fijo al deseleccionar, dejando clases con
            // estereotipo (o el borde negro por defecto) con un borde que no
            // les correspondía apenas se las tocaba una vez.
            const umlData = element.get('umlData') || {};
            const baseStroke = this.classManager.elementFactory.getElementColors(umlData.type, umlData.uml25).stroke;

            element.attr('body/strokeWidth', highlight ? 3 : 2);
            element.attr('body/stroke', highlight ? color : baseStroke);
        }
    }

    async deleteElement() {
        const element = this.selectedElement;
        if (!element) {
            console.log('⚠️ No hay elemento seleccionado para eliminar');
            return;
        }

        const ok = await confirmDialog({
            tone: 'danger',
            title: `¿Eliminar ${describeElement(element)}?`,
            message: element.isLink() ? 'Puedes recuperarla con Deshacer (Ctrl+Z).' : 'También se borran sus relaciones. Puedes recuperarla con Deshacer (Ctrl+Z).',
            confirmLabel: 'Eliminar',
        });
        // Mientras se decidía, la selección pudo cambiar o el elemento ya no existir.
        if (ok && this.selectedElement === element && element.graph) {
            var elementId = element.id;
            element.remove();
            this.selectedElement = null;
            this.propertiesPanel?.discard();
            this.releaseAnyHeldLock();
            this.updateCanvasInfo();

            // Este es el atajo de teclado (Supr), un camino de borrado
            // aparte del botón "Eliminar" del modal — cada camino de borrado
            // tiene que difundir el cambio, si no el borrado nunca llega a
            // los demás colaboradores por esta vía.
            this.webSocketManager?.broadcastDiagramUpdate({
                type: 'element_deleted',
                data: { elementId: elementId }
            });

            console.log('🗑️ Elemento eliminado');
        }
    }

    cancelOperation() {
        this.selectElement(null);
        this.relationshipManager.resetFirstElementSelected();
        this.relationshipManager.associativeClassSelected = null;
        this.selectTool('select');
        this.releaseAnyHeldLock();
        this.webSocketManager?.broadcastElementSelection(null);
        console.log('❌ Operación cancelada');
    }

    // Delegar métodos de zoom al ZoomManager
    updateCanvasInfo() {
        this.zoomManager.updateCanvasInfo();
    }

    zoomIn() {
        this.zoomManager.zoomIn();
    }

    zoomOut() {
        this.zoomManager.zoomOut();
    }

    zoomToFit() {
        this.zoomManager.zoomToFit();
    }

    setZoom(zoom) {
        this.zoomManager.setZoom(zoom);
    }

    // Delegar métodos de guardado al SaveManager
    saveDiagram() {
        this.saveManager.saveDiagram();
    }

    clearDiagram() {
        this.saveManager.clearDiagram();
    }

    exportToPNG() {
        this.saveManager.exportToPNG();
    }

    generateJavaProject() {
        SimpleJavaGenerator.quickGenerateJava(this);
    }

    generatePostmanCollection() {
        SimplePostmanGenerator.quickGeneratePostman(this);
    }

    getState() {
        return {
            selectedTool: this.selectedTool,
            elementCount: this.graph.getElements().length,
            linkCount: this.graph.getLinks().length,
            zoom: this.zoomManager.getCurrentZoom(),
            relationshipMode: this.relationshipMode,
            hasSelection: !!this.selectedElement
        };
    }

    // ==================== DEBUG Y DESARROLLO ====================

    debug() {
        console.log('🔧 Estado del editor:', {
            selectedTool: this.selectedTool,
            elements: this.graph.getElements().length,
            links: this.graph.getLinks().length,
            zoom: this.zoomManager.getCurrentZoom(),
            selectedElement: this.selectedElement?.id || 'ninguno',
            firstElementSelected: this.relationshipManager.getFirstElementSelected()?.id || 'ninguno'
        });

        console.log('📊 Elementos en el graph:', this.graph.toJSON());
        return this.getState();
    }
        exportToPNG() {
            SimpleImageExporter.quickExportPNG(this);
        }

        exportToJPG() {
            SimpleImageExporter.quickExportJPG(this);
        }

        exportToXMI() {
            SimpleXMIExporter.quickExportXMI(this);
        }

        // ==================== MÉTODOS DE IMPORTACIÓN ====================

        importFromXMI() {
            this.showXMIImportModal();
        }

        importFromImage() {
            this.showImageImportModal();
        }

        showXMIImportModal() {
            const html = `
                <div class="modal-header">
                    <h3 class="modal-title">${icon('folder', { size: 18 })} Importar diagrama UML</h3>
                    <button id="closeModalBtn" class="icon-btn">${icon('x', { size: 16 })}</button>
                </div>

                <div class="form-group">
                    <label for="xmiFileInput" class="form-label">Seleccionar archivo XML/XMI/UML</label>
                    <input type="file" id="xmiFileInput" accept=".xml,.xmi,.uml" class="file-drop-input">
                    <p style="margin: 8px 0 0 0; font-size: 12px; color: var(--uml-gray-500);">
                        Formatos soportados: XML, XMI, UML (Enterprise Architect, StarUML, etc.)
                    </p>
                </div>

                <div class="modal-callout" style="margin-bottom: 20px;">
                    <span class="modal-callout-icon">${icon('info', { size: 15 })}</span>
                    <span><strong>Información:</strong> la importación reemplazará el diagrama actual. Se recomienda guardar el trabajo actual antes de proceder.</span>
                </div>

                <div id="importProgress" style="display: none; margin-bottom: 20px;">
                    <div class="modal-progress"><div class="modal-progress-fill"></div></div>
                    <p style="text-align: center; margin: 0; color: var(--uml-gray-500); font-size: 13px;">Procesando archivo...</p>
                </div>

                <div id="importResult" style="display: none; margin-bottom: 20px;"></div>

                <div class="modal-footer">
                    <button id="cancelImportBtn" class="btn btn-secondary">Cancelar</button>
                    <button id="startImportBtn" class="btn btn-primary">${icon('send', { size: 14 })} Importar</button>
                </div>
            `;

            const { close } = openModal(html, { maxWidth: '560px', id: 'xmiImportModal', closeOnOverlayClick: true });

            // Configurar eventos
            this.setupXMIImportEvents(close);

            // Focus en el input de archivo
            setTimeout(() => {
                const fileInput = document.getElementById('xmiFileInput');
                if (fileInput) fileInput.focus();
            }, 100);
        }

        setupXMIImportEvents(closeModal) {
            const fileInput = document.getElementById('xmiFileInput');
            const startImportBtn = document.getElementById('startImportBtn');
            const closeModalBtn = document.getElementById('closeModalBtn');
            const cancelImportBtn = document.getElementById('cancelImportBtn');
            const progressDiv = document.getElementById('importProgress');
            const resultDiv = document.getElementById('importResult');

            if (!fileInput || !startImportBtn) {
                console.error('Elementos del modal de importación no encontrados');
                return;
            }

            closeModalBtn.addEventListener('click', closeModal);
            cancelImportBtn.addEventListener('click', closeModal);

            startImportBtn.addEventListener('click', async () => {
                const file = fileInput.files[0];
                if (!file) {
                    this.saveManager.showSaveNotification('Por favor selecciona un archivo XML/XMI', 'info');
                    return;
                }

                try {
                    // Mostrar progreso
                    progressDiv.style.display = 'block';
                    resultDiv.style.display = 'none';
                    startImportBtn.disabled = true;

                    // Leer archivo
                    const xmlContent = await this.readFileAsText(file);

                    // Importar diagrama
                    const result = await this.xmiImporter.importFromXML(xmlContent, this.paper);

                    // Ocultar progreso
                    progressDiv.style.display = 'none';

                    // Mostrar resultado
                    let resultHtml = '';
                    if (result.success) {
                        const notes = Array.isArray(result.notes) ? result.notes.filter(Boolean) : [];
                        const notesHtml = notes.length > 0 ? `
                            <div class="modal-callout" style="margin-top: 12px;">
                                <span class="modal-callout-icon">${icon('info', { size: 15 })}</span>
                                <div>
                                    <strong>Se interpretó/adaptó algo del original:</strong>
                                    <ul style="margin: 6px 0 0 0; padding-left: 18px;">
                                        ${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
                                    </ul>
                                </div>
                            </div>
                        ` : '';

                        resultHtml = `
                            <div class="modal-result">
                                <span class="modal-result-icon">${icon('check', { size: 18 })}</span>
                                <div>
                                    <p style="margin: 0 0 6px 0; font-weight: 600;">¡Importación exitosa!</p>
                                    <p style="margin: 0;">Clases creadas: ${result.classesCreated || 0}</p>
                                    <p style="margin: 0;">Relaciones creadas: ${result.relationshipsCreated || 0}</p>
                                </div>
                            </div>
                            ${notesHtml}
                        `;

                        // Si hubo avisos, dejar el modal abierto para leerlos.
                        if (notes.length === 0) {
                            setTimeout(() => {
                                closeModal();
                            }, 2000);
                        }
                    } else {
                        resultHtml = `
                            <div class="modal-result is-error">
                                <span class="modal-result-icon">${icon('x', { size: 18 })}</span>
                                <div>
                                    <p style="margin: 0 0 4px 0; font-weight: 600;">Error en la importación</p>
                                    <p style="margin: 0;">${result.error || 'Error desconocido'}</p>
                                </div>
                            </div>
                        `;
                    }

                    resultDiv.innerHTML = resultHtml;
                    resultDiv.style.display = 'block';

                } catch (error) {
                    console.error('Error durante la importación:', error);

                    // Ocultar progreso
                    progressDiv.style.display = 'none';

                    // Mostrar error
                    resultDiv.innerHTML = `
                        <div class="modal-result is-error">
                            <span class="modal-result-icon">${icon('x', { size: 18 })}</span>
                            <div>
                                <p style="margin: 0 0 4px 0; font-weight: 600;">Error:</p>
                                <p style="margin: 0;">${error.message}</p>
                            </div>
                        </div>
                    `;
                    resultDiv.style.display = 'block';
                } finally {
                    startImportBtn.disabled = false;
                }
            });
        }

        showImageImportModal() {
            const html = `
                <div class="modal-header">
                    <h3 class="modal-title">${icon('image', { size: 18 })} Importar desde imagen</h3>
                    <button id="closeImageModalBtn" class="icon-btn">${icon('x', { size: 16 })}</button>
                </div>

                <div class="form-group">
                    <label for="imageFileInput" class="form-label">Seleccionar imagen de diagrama UML</label>
                    <input type="file" id="imageFileInput" accept=".jpg,.jpeg,.png,.webp" class="file-drop-input">
                    <p style="margin: 8px 0 0 0; font-size: 12px; color: var(--uml-gray-500);">
                        Formatos soportados: JPG, PNG, WebP • Tamaño máximo: 5MB
                    </p>
                </div>

                <div class="modal-callout" style="margin-bottom: 16px;">
                    <span class="modal-callout-icon">${icon('sparkle', { size: 15 })}</span>
                    <span><strong>Con IA:</strong> el asistente analizará tu diagrama UML y recreará automáticamente las clases y relaciones. Funciona con diagramas dibujados a mano, digitales, fotografías, etc.</span>
                </div>

                <div class="modal-callout" style="margin-bottom: 20px;">
                    <span class="modal-callout-icon">${icon('info', { size: 15 })}</span>
                    <span><strong>Consejos para mejores resultados:</strong><br>
                    • Asegúrate de que el texto sea legible<br>
                    • Usa imágenes con buen contraste<br>
                    • Incluye nombres de clases y métodos claros</span>
                </div>

                <div id="imageImportProgress" style="display: none; margin-bottom: 20px;">
                    <div class="modal-progress"><div class="modal-progress-fill"></div></div>
                    <p style="text-align: center; margin: 0; color: var(--uml-gray-500); font-size: 13px;">Analizando imagen con IA...</p>
                </div>

                <div id="imageImportResult" style="display: none; margin-bottom: 20px;"></div>

                <div class="modal-footer">
                    <button id="cancelImageImportBtn" class="btn btn-secondary">Cancelar</button>
                    <button id="startImageImportBtn" class="btn btn-primary">${icon('sparkle', { size: 14 })} Analizar con IA</button>
                </div>
            `;

            const { close } = openModal(html, { maxWidth: '560px', id: 'imageImportModal', closeOnOverlayClick: true });

            // Configurar eventos
            this.setupImageImportEvents(close);

            // Focus en el input de archivo
            setTimeout(() => {
                const fileInput = document.getElementById('imageFileInput');
                if (fileInput) fileInput.focus();
            }, 100);
        }

        setupImageImportEvents(closeModal) {
            const fileInput = document.getElementById('imageFileInput');
            const startImportBtn = document.getElementById('startImageImportBtn');
            const closeModalBtn = document.getElementById('closeImageModalBtn');
            const cancelImportBtn = document.getElementById('cancelImageImportBtn');
            const progressDiv = document.getElementById('imageImportProgress');
            const resultDiv = document.getElementById('imageImportResult');

            if (!fileInput || !startImportBtn) {
                console.error('Elementos del modal de importación de imagen no encontrados');
                return;
            }

            closeModalBtn.addEventListener('click', closeModal);
            cancelImportBtn.addEventListener('click', closeModal);

            startImportBtn.addEventListener('click', async () => {
                const file = fileInput.files[0];
                if (!file) {
                    this.saveManager.showSaveNotification('Por favor selecciona una imagen', 'info');
                    return;
                }

                try {
                    // Mostrar progreso
                    progressDiv.style.display = 'block';
                    resultDiv.style.display = 'none';
                    startImportBtn.disabled = true;

                    // Importar desde imagen usando el ImageImporter
                    const result = await this.imageImporter.importFromImage(file);

                    // El paper solo permite arrastrar/soltar elementos con la
                    // herramienta "Seleccionar" activa (ver `interactive:` en
                    // el Paper, más arriba en este archivo) — si el usuario
                    // tenía otra herramienta activa (ej. "Asociación") antes
                    // de abrir este modal, las clases recién importadas (y
                    // TODO el resto del diagrama) quedaban "tiesas", sin
                    // reaccionar a ningún intento de moverlas, hasta que
                    // alguien pensara en volver a clickear "Seleccionar" a
                    // mano. Se fuerza acá, sea cual sea el resultado.
                    this.selectTool('select');

                    // Ocultar progreso
                    progressDiv.style.display = 'none';

                    // Mostrar resultado
                    let resultHtml = '';
                    if (result.success) {
                        const notes = Array.isArray(result.notes) ? result.notes.filter(Boolean) : [];
                        const notesHtml = notes.length > 0 ? `
                            <div class="modal-callout" style="margin-top: 12px;">
                                <span class="modal-callout-icon">${icon('info', { size: 15 })}</span>
                                <div>
                                    <strong>La IA interpretó/adaptó algo del original:</strong>
                                    <ul style="margin: 6px 0 0 0; padding-left: 18px;">
                                        ${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
                                    </ul>
                                </div>
                            </div>
                        ` : '';

                        resultHtml = `
                            <div class="modal-result">
                                <span class="modal-result-icon">${icon('check', { size: 18 })}</span>
                                <div>
                                    <p style="margin: 0 0 6px 0; font-weight: 600;">¡Análisis de imagen exitoso!</p>
                                    <p style="margin: 0;">Clases creadas: ${result.classesCreated || 0}${result.classesUpdated ? ` · actualizadas: ${result.classesUpdated}` : ''}</p>
                                    <p style="margin: 0;">Relaciones creadas: ${result.relationshipsCreated || 0}${result.relationshipsUpdated ? ` · actualizadas: ${result.relationshipsUpdated}` : ''}</p>
                                </div>
                            </div>
                            ${notesHtml}
                        `;

                        // Si hubo avisos, dejar el modal abierto para que se
                        // alcancen a leer — si no, cerrar solo como siempre.
                        if (notes.length === 0) {
                            setTimeout(() => {
                                closeModal();
                            }, 3000);
                        }
                    } else {
                        resultHtml = `
                            <div class="modal-result is-error">
                                <span class="modal-result-icon">${icon('x', { size: 18 })}</span>
                                <div>
                                    <p style="margin: 0 0 4px 0; font-weight: 600;">Error en el análisis</p>
                                    <p style="margin: 0;">${result.error || 'Error desconocido'}</p>
                                </div>
                            </div>
                        `;
                    }

                    resultDiv.innerHTML = resultHtml;
                    resultDiv.style.display = 'block';

                } catch (error) {
                    console.error('Error durante la importación de imagen:', error);

                    // Ocultar progreso
                    progressDiv.style.display = 'none';

                    // Mostrar error
                    resultDiv.innerHTML = `
                        <div class="modal-result is-error">
                            <span class="modal-result-icon">${icon('x', { size: 18 })}</span>
                            <div>
                                <p style="margin: 0 0 4px 0; font-weight: 600;">Error:</p>
                                <p style="margin: 0;">${error.message}</p>
                            </div>
                        </div>
                    `;
                    resultDiv.style.display = 'block';
                } finally {
                    startImportBtn.disabled = false;
                }
            });
        }

        showImportAlert(message, type) {
            const importResult = document.getElementById('importResult');
            importResult.innerHTML = `
                <div class="alert alert-${type}" role="alert">
                    <i class="bi bi-${type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : 'x-circle'}"></i>
                    ${message}
                </div>
            `;
            importResult.classList.remove('d-none');
        }

        showImportResult(result, type) {
            let message;
            let icon;

            if (result.success) {
                message = result.message;
                icon = 'check-circle';
            } else {
                message = `Error: ${result.error}`;
                icon = 'x-circle';
            }

            const importResult = document.getElementById('importResult');
            importResult.innerHTML = `
                <div class="alert alert-${type}" role="alert">
                    <i class="bi bi-${icon}"></i>
                    <strong>${result.success ? 'Importación exitosa' : 'Error de importación'}</strong><br>
                    ${message}
                </div>
            `;
            importResult.classList.remove('d-none');
        }

        generateSQL() {
            SimpleSQLGenerator.quickGenerateSQL(this);
        }

        // Método para leer archivos como texto
        readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target.result);
                reader.onerror = (error) => reject(error);
                reader.readAsText(file);
            });
        }
}

// Hacer disponible globalmente
window.UMLDiagramEditor = UMLDiagramEditor;

export { UMLDiagramEditor };
