// resources/js/diagram/DiagramRelationshipManager.js - REFACTORIZADO COMPLETO
// Mantiene TODA la funcionalidad original pero usa DiagramElementFactory para métodos duplicados

import * as joint from 'jointjs';
import { DiagramElementFactory } from './DiagramElementFactory.js';
import { openModal, confirmDialog } from './utils/modal.js';
import { icon } from './utils/uiIcons.js';

const ANCHOR_OPTIONS = [
    { value: 'auto', label: 'Automático' },
    { value: 'top', label: 'Arriba' },
    { value: 'right', label: 'Derecha' },
    { value: 'bottom', label: 'Abajo' },
    { value: 'left', label: 'Izquierda' },
    { value: 'center', label: 'Centro' },
];

const MULTIPLICITY_OPTIONS = [
    { value: '', label: 'Sin especificar' },
    { value: '1', label: '1 (uno)' },
    { value: '0..1', label: '0..1 (cero o uno)' },
    { value: '1..*', label: '1..* (uno o más)' },
    { value: '*', label: '* (muchos)' },
    { value: '0..*', label: '0..* (cero o más)' },
];

function anchorOptionsHTML(selected = 'auto') {
    return ANCHOR_OPTIONS.map(o => `<option value="${o.value}" ${o.value === selected ? 'selected' : ''}>${o.label}</option>`).join('');
}

function multiplicityOptionsHTML(selected = '') {
    return MULTIPLICITY_OPTIONS.map(o => `<option value="${o.value}" ${o.value === selected ? 'selected' : ''}>${o.label}</option>`).join('');
}

export class DiagramRelationshipManager {
    constructor(editor) {
        this.editor = editor;
        this.firstElementSelected = null;
        this.associativeClassSelected = null;
        // Ver editRelationshipImproved(): descarta respuestas de red tardías
        // que ya no corresponden al modal actualmente abierto.
        this._editToken = 0;

        // Usar la factory SOLO para métodos específicos duplicados
        this.elementFactory = new DiagramElementFactory();
    }

    // ==================== CREACIÓN MEJORADA DE RELACIONES ====================
    // Dos formas de conectar, ambas activas a la vez con una herramienta de
    // relación seleccionada: (a) clic-clic clásico — clic en la primera
    // clase, clic en la segunda; (b) arrastrar de una clase a otra — se
    // decide sobre la marcha según si hay movimiento real antes de soltar
    // el mouse (igual criterio que ya se usa para distinguir "clic" de
    // "arrastre" en el movimiento de elementos).

    handleRelationshipClick(element, evt) {
        if (!this.firstElementSelected) {
            this.firstElementSelected = element;
            this.editor.highlightElement(element, true, '#f59e0b');

            // Mostrar ayuda visual
            this.showRelationshipHelp(this.editor.selectedTool);
            console.log('Primera clase seleccionada para', this.editor.selectedTool);

            if (evt) this.startDragConnector(element, evt);
        } else {
            if (this.firstElementSelected.id !== element.id) {
                this.createRelationshipImproved(this.firstElementSelected, element);
            }

            this.finishRelationshipSelection();
        }
    }

    finishRelationshipSelection() {
        this._activeDragConnectorCleanup?.();
        if (this.firstElementSelected) {
            this.editor.highlightElement(this.firstElementSelected, false);
        }
        this.firstElementSelected = null;
        this.hideRelationshipHelp();
        this.editor.selectTool('select');
    }

    // ==================== CLASE ASOCIATIVA (link a otra relación) ====================
    // Notación UML real: una clase unida con línea PUNTEADA, sin flechas, al
    // MEDIO de otra relación ya existente (la asociación M:N) — no es una
    // relación clase-a-clase como las demás, por eso tiene su propio flujo
    // en vez de reusar handleRelationshipClick (que asume que el segundo
    // click siempre es sobre un elemento). Primer click: la clase asociativa.
    // Segundo click: la relación (línea) a la que se une — ver
    // editor.js onLinkClick(). No usa modal: no hay nombre/multiplicidad que
    // configurar para este conector.
    handleAssociationClassLinkClick(cell, evt) {
        const isLink = typeof cell.isLink === 'function' ? cell.isLink() : !!cell.get('source');

        if (!this.associativeClassSelected) {
            if (isLink) {
                this.editor.collaborationManager?.showLockConflictNotification(
                    'Primero elegí la clase asociativa (un rectángulo), no una relación.'
                );
                return;
            }
            this.associativeClassSelected = cell;
            this.editor.highlightElement(cell, true, '#f59e0b');
            this.showRelationshipHelp('associationClassLink');
            return;
        }

        if (!isLink) {
            this.editor.collaborationManager?.showLockConflictNotification(
                'Ahora hacé click sobre la relación (línea) a la que se une la clase asociativa.'
            );
            return;
        }

        const hostLink = cell;
        const hostType = hostLink.get('relationData')?.type;

        if (!['association', 'aggregation', 'composition'].includes(hostType)) {
            this.editor.collaborationManager?.showLockConflictNotification(
                'Una clase asociativa solo puede unirse a una asociación, agregación o composición.'
            );
            this.finishAssociationClassLinkSelection();
            return;
        }

        const alreadyAttached = this.editor.graph.getLinks().some(l =>
            l.get('relationData')?.type === 'associationClassLink' && l.get('target')?.id === hostLink.id
        );
        if (alreadyAttached) {
            this.editor.collaborationManager?.showLockConflictNotification(
                'Esa relación ya tiene una clase asociativa conectada.'
            );
            this.finishAssociationClassLinkSelection();
            return;
        }

        this.createRelationshipFromConfig('associationClassLink', this.associativeClassSelected, hostLink, {});

        this.editor.webSocketManager?.broadcastDiagramUpdate({
            type: 'relationship_created',
            data: {
                sourceId: this.associativeClassSelected.id,
                targetId: hostLink.id,
                relationshipType: 'associationClassLink',
                config: {}
            }
        });

        this.finishAssociationClassLinkSelection();
    }

    finishAssociationClassLinkSelection() {
        if (this.associativeClassSelected) {
            this.editor.highlightElement(this.associativeClassSelected, false);
        }
        this.associativeClassSelected = null;
        this.hideRelationshipHelp();
        this.editor.selectTool('select');
    }

    /**
     * Arranca el seguimiento del mouse para dibujar la línea de conexión en
     * vivo. No crea nada todavía: solo si hay movimiento real se muestra la
     * línea; si el gesto termina siendo un clic simple (sin mover el mouse),
     * no se dibuja nada y queda vigente el flujo clic-clic de siempre.
     */
    startDragConnector(sourceElement, evt) {
        const startX = evt.clientX;
        const startY = evt.clientY;
        const MOVE_THRESHOLD = 4; // px, para no confundir un clic con un micro-arrastre

        let line = null;
        let hoveredTarget = null;
        const paper = this.editor.paper;

        const localStart = () => {
            const bbox = sourceElement.getBBox();
            return bbox.center();
        };

        const setHoveredTarget = (element) => {
            if (hoveredTarget?.id === element?.id) return;
            if (hoveredTarget) this.editor.highlightElement(hoveredTarget, false);
            hoveredTarget = element;
            if (hoveredTarget) this.editor.highlightElement(hoveredTarget, true, '#f59e0b');
        };

        const onMouseMove = (moveEvt) => {
            const dx = moveEvt.clientX - startX;
            const dy = moveEvt.clientY - startY;

            if (!line) {
                if (Math.hypot(dx, dy) < MOVE_THRESHOLD) return;

                // Recién ahora se confirma que es un arrastre, no un clic:
                // se crea la línea guía dentro del propio SVG del paper para
                // que herede el mismo pan/zoom que el resto del diagrama.
                line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('stroke', '#f59e0b');
                line.setAttribute('stroke-width', 2);
                line.setAttribute('stroke-dasharray', '6,4');
                line.style.pointerEvents = 'none';
                // OJO: tiene que ir en paper.viewport (el <g> con el pan/zoom
                // aplicado), no en paper.svg directo — si no, la línea se
                // dibuja en coordenadas de pantalla sin transformar y
                // termina invisible o en un lugar completamente distinto al
                // que muestran las coordenadas locales que le calculamos.
                paper.viewport.appendChild(line);
            }

            const from = localStart();
            const to = paper.clientToLocalPoint(moveEvt.clientX, moveEvt.clientY);
            line.setAttribute('x1', from.x);
            line.setAttribute('y1', from.y);
            line.setAttribute('x2', to.x);
            line.setAttribute('y2', to.y);

            // Resaltar la clase/interfaz que está justo debajo del cursor en
            // este momento, igual que la de origen — cambia en vivo según
            // por dónde se mueva, y se apaga sola al salir de una clase.
            setHoveredTarget(this.findElementAtPoint(to, sourceElement));
        };

        const cleanup = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (line) {
                line.remove();
                line = null;
            }
            setHoveredTarget(null);
            if (this._activeDragConnectorCleanup === cleanup) {
                this._activeDragConnectorCleanup = null;
            }
        };

        const onMouseUp = (upEvt) => {
            const wasRealDrag = !!line;
            const point = paper.clientToLocalPoint(upEvt.clientX, upEvt.clientY);
            cleanup();

            // Si mientras tanto se canceló la selección (Escape) esta
            // conexión ya no es válida — no crear nada con datos viejos.
            if (this.firstElementSelected?.id !== sourceElement.id) return;

            // Sin arrastre real: fue un clic simple, se deja intacto el
            // flujo clic-clic (firstElementSelected ya quedó seteado).
            if (!wasRealDrag) return;

            const target = this.findElementAtPoint(point, sourceElement);

            if (target) {
                this.createRelationshipImproved(sourceElement, target);
                this.finishRelationshipSelection();
            }
            // Si se soltó fuera de una clase válida, no se cancela nada: el
            // usuario puede simplemente hacer clic en la clase destino a
            // continuación, como en el flujo clic-clic.
        };

        // Si se cancela por otra vía (Escape, cambio de herramienta) antes
        // de soltar el mouse, resetFirstElementSelected() usa esto para
        // limpiar la línea guía y los listeners colgados.
        this._activeDragConnectorCleanup = cleanup;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    /** Busca la clase (distinta de la de origen) bajo un punto en coordenadas locales del paper. */
    findElementAtPoint(point, excludeElement) {
        const elements = this.editor.graph.getElements();
        for (const element of elements) {
            if (element.id === excludeElement.id) continue;
            if (element.getBBox().containsPoint(point)) {
                return element;
            }
        }
        return null;
    }

    showRelationshipHelp(toolType) {
        const helpText = {
            'association': '↔ Asociación: relación general entre clases',
            'aggregation': '◇ Agregación: "tiene un" (composición débil)',
            'composition': '◆ Composición: "parte de" (composición fuerte)',
            'inheritance': '△ Herencia: "es un" (especialización)',
            'realization': '⇢▷ Realización: implementa una interfaz',
            'dependency': '⇢ Dependencia: usa a otra clase (no permanente)',
            'associationClassLink': '┅ Clase asociativa: elegí la clase, después la relación a la que se une'
        };

        // Crear tooltip temporal
        const tooltip = document.createElement('div');
        tooltip.id = 'relationship-tooltip';
        tooltip.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--uml-gray-900);
            color: #fff;
            padding: 8px 16px;
            border-radius: var(--uml-radius-md);
            box-shadow: var(--uml-shadow-lg);
            z-index: 5000;
            font-family: var(--uml-font-sans);
            font-size: 13px;
        `;
        tooltip.textContent = helpText[toolType] + ' — selecciona la segunda clase';
        document.body.appendChild(tooltip);
    }

    hideRelationshipHelp() {
        const tooltip = document.getElementById('relationship-tooltip');
        if (tooltip) {
            tooltip.remove();
        }
    }

    createRelationshipImproved(source, target) {
        const relationshipType = this.editor.selectedTool;

        // Mostrar modal de configuración según el tipo de relación
        this.showRelationshipConfigModal(relationshipType, source, target);
    }

    // ==================== MODAL DE CONFIGURACIÓN DE RELACIONES ====================

    showRelationshipConfigModal(relationshipType, source, target) {
        const relationshipInfo = this.getRelationshipInfo(relationshipType);
        const showMultiplicity = relationshipType === 'association' || relationshipType === 'aggregation' || relationshipType === 'composition';
        const showName = relationshipType !== 'inheritance' && relationshipType !== 'realization';

        const html = `
            <div class="modal-header">
                <h3 class="modal-title">${relationshipInfo.icon} Configurar ${relationshipInfo.name}</h3>
            </div>

            <div class="modal-callout" style="margin-bottom: 18px;">
                <span>
                    <strong>De:</strong> ${source.get('umlData')?.className || 'Clase origen'} &rarr;
                    <strong>Hacia:</strong> ${target.get('umlData')?.className || 'Clase destino'}
                    <br>${relationshipInfo.description}
                </span>
            </div>

            ${showMultiplicity ? `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;" class="form-group">
                    <div>
                        <label class="form-label">Multiplicidad origen</label>
                        <select id="sourceMultiplicity" class="form-select">
                            ${multiplicityOptionsHTML('1')}
                        </select>
                    </div>
                    <div>
                        <label class="form-label">Multiplicidad destino</label>
                        <select id="targetMultiplicity" class="form-select">
                            ${multiplicityOptionsHTML('*')}
                        </select>
                    </div>
                </div>
            ` : ''}

            ${showName ? `
                <div class="form-group">
                    <label class="form-label">Nombre de la relación <span class="form-label-hint">(opcional)</span></label>
                    <input type="text" id="relationName" class="form-input" placeholder="Ej: gestiona, pertenece a, contiene...">
                </div>
            ` : ''}

            <div class="modal-section">
                <div class="modal-section-title">Puntos de conexión</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                    <div>
                        <label class="form-label">Salida desde ${source.get('umlData')?.className || 'origen'}</label>
                        <select id="sourceAnchor" class="form-select">${anchorOptionsHTML('auto')}</select>
                    </div>
                    <div>
                        <label class="form-label">Llegada a ${target.get('umlData')?.className || 'destino'}</label>
                        <select id="targetAnchor" class="form-select">${anchorOptionsHTML('auto')}</select>
                    </div>
                </div>
                <p style="margin: 8px 0 0 0; color: var(--uml-gray-500); font-size: 12px;">
                    Usa "Automático" para evitar superposiciones, o selecciona manualmente los puntos específicos.
                </p>
            </div>

            <div class="modal-footer">
                <button id="cancelRelationBtn" class="btn btn-secondary">Cancelar</button>
                <button id="createRelationBtn" class="btn btn-primary">Crear relación</button>
            </div>
        `;

        const { close } = openModal(html, { maxWidth: '540px' });

        document.getElementById('cancelRelationBtn').onclick = () => close();

        document.getElementById('createRelationBtn').onclick = () => {
            const sourceMultiplicity = showMultiplicity ? document.getElementById('sourceMultiplicity').value : '';
            const targetMultiplicity = showMultiplicity ? document.getElementById('targetMultiplicity').value : '';
            const relationName = showName ? document.getElementById('relationName').value.trim() : '';

            // Obtener los anchors seleccionados por el usuario
            const sourceAnchorChoice = document.getElementById('sourceAnchor').value;
            const targetAnchorChoice = document.getElementById('targetAnchor').value;

            const config = {
                sourceMultiplicity,
                targetMultiplicity,
                name: relationName,
                sourceAnchor: sourceAnchorChoice,
                targetAnchor: targetAnchorChoice
            };

            this.createRelationshipFromConfig(relationshipType, source, target, config);

            // Difundir a los demás colaboradores (solo desde la acción local del
            // usuario, no desde createRelationshipFromConfig, para no generar
            // un eco cuando el mismo método se usa para aplicar el cambio remoto).
            this.editor.webSocketManager?.broadcastDiagramUpdate({
                type: 'relationship_created',
                data: { sourceId: source.id, targetId: target.id, relationshipType, config }
            });

            close();
        };
    }

    getRelationshipInfo(type) {
        const info = {
            'association': {
                name: 'Asociación',
                icon: '↔',
                description: 'Relación general entre clases. Indica que una clase conoce o usa otra.'
            },
            'aggregation': {
                name: 'Agregación',
                icon: '◇',
                description: 'Relación "tiene un" (composición débil). Las partes pueden existir independientemente.'
            },
            'composition': {
                name: 'Composición',
                icon: '◆',
                description: 'Relación "parte de" (composición fuerte). Las partes no pueden existir sin el todo.'
            },
            'inheritance': {
                name: 'Herencia',
                icon: '△',
                description: 'Relación "es un". Una clase hereda propiedades y métodos de otra.'
            },
            'realization': {
                name: 'Realización',
                icon: '⇢▷',
                description: 'Relación "implementa". Una clase realiza el contrato definido por una interfaz.'
            },
            'dependency': {
                name: 'Dependencia',
                icon: '⇢',
                description: 'Relación "usa". Una clase depende de otra de forma puntual (ej. un parámetro o variable local), sin ser una relación estructural permanente.'
            }
        };
        return info[type] || { name: 'Relación', icon: '→', description: 'Relación entre clases.' };
    }

    // ==================== CREACIÓN DE RELACIONES CON CONFIGURACIÓN ====================

    createRelationshipFromConfig(relationshipType, source, target, config) {
        let link;

        // "Automático" usa el ancla dinámica 'distributedSide' (ver
        // utils/relationshipAnchor.js): elige el lado del elemento más
        // cercano al otro extremo, y si hay más de una relación en el mismo
        // lado las reparte en vez de apilarlas todas en el punto medio. Es
        // una función real de JointJS, re-evaluada en cada render — no un
        // valor fijo calculado una sola vez al crear la relación.
        const sourceAnchor = config.sourceAnchor === 'auto' ? 'distributedSide' : config.sourceAnchor;
        const targetAnchor = config.targetAnchor === 'auto' ? 'distributedSide' : config.targetAnchor;

        switch(relationshipType) {
            case 'association': {
                const associationAttrs = this.elementFactory.getRelationshipAttrs('association'); // ← Usar factory
                // `hideArrow`: lo pasa el importador XMI cuando el archivo de
                // origen (EA u otro) marca la asociación como sin flecha
                // (`headStyle="0"`/dirección "Unspecified" — ver
                // simpleXMIImport.js parseAssociation()). El default de la
                // factory (targetMarker con flecha abierta) es la notación
                // propia de esta app para una asociación dibujada a mano, y
                // NO se toca — esto solo pisa el marker para esta instancia
                // puntual, para que una asociación importada se vea igual
                // que en el archivo de origen.
                if (config.hideArrow) {
                    associationAttrs.line.targetMarker = null;
                }
                link = new joint.shapes.standard.Link({
                    source: {
                        id: source.id,
                        anchor: { name: sourceAnchor }
                    },
                    target: {
                        id: target.id,
                        anchor: { name: targetAnchor }
                    },
                    attrs: associationAttrs,
                    labels: this.createRelationLabelsImproved(
                        config.sourceMultiplicity,
                        config.targetMultiplicity,
                        config.name
                    ),
                    relationData: {
                        type: 'association',
                        sourceMultiplicity: config.sourceMultiplicity,
                        targetMultiplicity: config.targetMultiplicity,
                        name: config.name,
                        sourceAnchor: config.sourceAnchor,
                        targetAnchor: config.targetAnchor,
                        ...(config.hideArrow ? { hideArrow: true } : {})
                    }
                });
                break;
            }

            case 'inheritance':
                link = new joint.shapes.standard.Link({
                    source: {
                        id: source.id,
                        anchor: { name: sourceAnchor }
                    },
                    target: {
                        id: target.id,
                        anchor: { name: targetAnchor }
                    },
                    attrs: this.elementFactory.getRelationshipAttrs('inheritance'), // ← Usar factory
                    labels: config.name ? [{
                        attrs: {
                            text: {
                                text: config.name,
                                fontSize: 14,
                                fontFamily: 'Arial, sans-serif',
                                fill: '#334155',
                                fontWeight: 'bold'
                            }
                        },
                        position: {
                            distance: 0.5,
                            offset: -18
                        }
                    }] : [],
                    relationData: {
                        type: 'inheritance',
                        sourceMultiplicity: '',
                        targetMultiplicity: '',
                        name: config.name,
                        sourceAnchor: config.sourceAnchor,
                        targetAnchor: config.targetAnchor
                    }
                });
                break;

            case 'aggregation':
                link = new joint.shapes.standard.Link({
                    source: {
                        id: source.id,
                        anchor: { name: sourceAnchor }
                    },
                    target: {
                        id: target.id,
                        anchor: { name: targetAnchor }
                    },
                    attrs: this.elementFactory.getRelationshipAttrs('aggregation'), // ← Usar factory
                    labels: this.createRelationLabelsImproved(
                        config.sourceMultiplicity,
                        config.targetMultiplicity,
                        config.name
                    ),
                    relationData: {
                        type: 'aggregation',
                        sourceMultiplicity: config.sourceMultiplicity,
                        targetMultiplicity: config.targetMultiplicity,
                        name: config.name,
                        sourceAnchor: config.sourceAnchor,
                        targetAnchor: config.targetAnchor
                    }
                });
                break;

            case 'composition':
                link = new joint.shapes.standard.Link({
                    source: {
                        id: source.id,
                        anchor: { name: sourceAnchor }
                    },
                    target: {
                        id: target.id,
                        anchor: { name: targetAnchor }
                    },
                    attrs: this.elementFactory.getRelationshipAttrs('composition'), // ← Usar factory
                    labels: this.createRelationLabelsImproved(
                        config.sourceMultiplicity,
                        config.targetMultiplicity,
                        config.name
                    ),
                    relationData: {
                        type: 'composition',
                        sourceMultiplicity: config.sourceMultiplicity,
                        targetMultiplicity: config.targetMultiplicity,
                        name: config.name,
                        sourceAnchor: config.sourceAnchor,
                        targetAnchor: config.targetAnchor
                    }
                });
                break;

            case 'realization':
                link = new joint.shapes.standard.Link({
                    source: {
                        id: source.id,
                        anchor: { name: sourceAnchor }
                    },
                    target: {
                        id: target.id,
                        anchor: { name: targetAnchor }
                    },
                    attrs: this.elementFactory.getRelationshipAttrs('realization'), // ← Usar factory
                    labels: config.name ? [{
                        attrs: {
                            text: {
                                text: config.name,
                                fontSize: 14,
                                fontFamily: 'Arial, sans-serif',
                                fill: '#334155',
                                fontWeight: 'bold'
                            }
                        },
                        position: {
                            distance: 0.5,
                            offset: -18
                        }
                    }] : [],
                    relationData: {
                        type: 'realization',
                        sourceMultiplicity: '',
                        targetMultiplicity: '',
                        name: config.name,
                        sourceAnchor: config.sourceAnchor,
                        targetAnchor: config.targetAnchor
                    }
                });
                break;

            case 'dependency':
                link = new joint.shapes.standard.Link({
                    source: {
                        id: source.id,
                        anchor: { name: sourceAnchor }
                    },
                    target: {
                        id: target.id,
                        anchor: { name: targetAnchor }
                    },
                    attrs: this.elementFactory.getRelationshipAttrs('dependency'), // ← Usar factory
                    labels: config.name ? [{
                        attrs: {
                            text: {
                                text: config.name,
                                fontSize: 14,
                                fontFamily: 'Arial, sans-serif',
                                fill: '#334155',
                                fontWeight: 'bold'
                            }
                        },
                        position: {
                            distance: 0.5,
                            offset: -18
                        }
                    }] : [],
                    relationData: {
                        type: 'dependency',
                        sourceMultiplicity: '',
                        targetMultiplicity: '',
                        name: config.name,
                        sourceAnchor: config.sourceAnchor,
                        targetAnchor: config.targetAnchor
                    }
                });
                break;

            case 'associationClassLink':
                // Clase asociativa real: source = la clase, target = OTRA
                // RELACIÓN (el link de la asociación M:N), no una clase. Sin
                // labels/multiplicidad — no aplica a este conector.
                // El target necesita un anchor de joint.linkAnchors (NO de
                // joint.anchors — son registros separados, ver
                // editor.js/linkAnchorNamespace): 'connectionRatio' ancla al
                // punto medio (ratio 0.5) del PATH del link host, en vez de
                // a un magnet de elemento. Sin esto el link se crea en el
                // grafo pero queda sin dibujar — JointJS no puede resolver
                // un punto de conexión contra otro link sin un anchor
                // explícito de esta familia.
                link = new joint.shapes.standard.Link({
                    source: {
                        id: source.id,
                        // Este conector no pasa por el modal de config (no
                        // tiene campos que configurar) — se llama siempre con
                        // config: {}, así que sourceAnchor de arriba da
                        // undefined en vez de 'auto'/'distributedSide'
                        // (JointJS tira "Unknown anchor: undefined" si se le
                        // pasa tal cual). Default explícito acá.
                        anchor: { name: sourceAnchor || 'distributedSide' }
                    },
                    target: {
                        id: target.id,
                        anchor: { name: 'connectionRatio', args: { ratio: 0.5 } }
                    },
                    // El router por defecto del paper (distributedSide, ver
                    // relationshipAnchor.js) asume que AMBOS extremos son
                    // ELEMENTOS (calcula lado más cercano vía getBBox() de
                    // cada cell) — acá el target es otra RELACIÓN, no una
                    // clase, y esa cuenta de "lado más cercano" contra el
                    // bbox de un link no tiene sentido: en vivo producía una
                    // ruta degenerada (un lazo cerrado sobre sí mismo, ver
                    // documentacion/01-editor-diagrama.md). 'normal' es el
                    // router trivial de JointJS — línea recta punto a punto,
                    // exactamente lo que hace falta para este conector.
                    router: { name: 'normal' },
                    attrs: this.elementFactory.getRelationshipAttrs('associationClassLink'),
                    labels: [],
                    relationData: {
                        type: 'associationClassLink',
                        sourceAnchor: config.sourceAnchor
                    }
                });
                break;

            default:
                console.error('Tipo de relación no soportado:', relationshipType);
                return;
        }

        // Mismo id en todos los navegadores: quien la crea lo difunde (ver
        // DiagramWebSocketManager.broadcastDiagramUpdate) y quien la recibe lo
        // usa acá. Sin esto, editar, borrar o deshacer esa relación desde otro
        // navegador no la encontraba hasta recargar.
        if (config.id) {
            if (this.editor.graph.getCell(config.id)) return this.editor.graph.getCell(config.id);
            link.set('id', config.id);
        }
        this.lastCreatedLink = link;

        // Añadir doble click para editar
        link.on('cell:pointerdblclick', () => {
            this.editRelationshipImproved(link);
        });

        this.editor.graph.addCell(link);
        this.editor.updateCanvasInfo();

        if (relationshipType === 'associationClassLink') {
            // El paper renderiza en modo async (ver 00-general.md) — para
            // la mayoría de las relaciones (clase↔clase) el próximo render
            // automático ya alcanza a pintarlas bien porque hay más tiempo
            // real entre acciones de un usuario. Para este link en
            // particular (target = OTRO LINK, no una clase) se vio en vivo
            // que sin forzar el flush quedaba sin pintar del todo (el `<g>`
            // se creaba vacío, sin ningún <path> adentro) — dumpViews()
            // fuerza el ciclo de update pendiente ya mismo, en el orden de
            // dependencias correcto (primero el link host, después este).
            this.editor.paper.dumpViews();
        }

        console.log('✅ Relación', relationshipType, 'creada con anti-superposición');

        // Retornar el link creado para que pueda ser usado por otros métodos
        return link;
    }

    // ==================== LABELS MEJORADAS ====================

    createRelationLabelsImproved(sourceMultiplicity, targetMultiplicity, relationName) {
        const labels = [];

        // Label de multiplicidad origen (cerca del source)
        if (sourceMultiplicity) {
            labels.push({
                attrs: {
                    text: {
                        text: sourceMultiplicity,
                        fontSize: 13,
                        fontFamily: 'Arial, sans-serif',
                        fill: '#374151',
                        fontWeight: 'bold'
                    }
                },
                position: {
                    distance: 0.15,
                    offset: -18
                }
            });
        }

        // Label del nombre de la relación (centro)
        if (relationName) {
            labels.push({
                attrs: {
                    text: {
                        text: relationName,
                        fontSize: 14,
                        fontFamily: 'Arial, sans-serif',
                        fill: '#334155',
                        fontWeight: 'bold'
                    }
                },
                position: {
                    distance: 0.5,
                    offset: -18
                }
            });
        }

        // Label de multiplicidad destino (cerca del target)
        if (targetMultiplicity) {
            labels.push({
                attrs: {
                    text: {
                        text: targetMultiplicity,
                        fontSize: 13,
                        fontFamily: 'Arial, sans-serif',
                        fill: '#374151',
                        fontWeight: 'bold'
                    }
                },
                position: {
                    distance: 0.85,
                    offset: -18
                }
            });
        }

        return labels;
    }

    // ==================== EDICIÓN MEJORADA DE RELACIONES ====================

    /**
     * El modal se abre YA, sin esperar al servidor — el pedido de bloqueo
     * real viaja en paralelo, en segundo plano (mismo motivo que
     * DiagramPropertiesPanel.show(): esperar la red antes de mostrar algo
     * se sentía como 1-2s de demora por cada relación, y encima, si se
     * hacía doble clic rápido sobre dos relaciones distintas, la respuesta
     * de la primera podía llegar tarde y pisar/cerrar el modal de la
     * segunda). this._editToken descarta cualquier respuesta que ya no
     * corresponda al modal actualmente abierto.
     */
    editRelationshipImproved(link) {
        const collab = this.editor.collaborationManager;
        const ws = this.editor.webSocketManager;

        if (collab?.isLockedByOther(link.id)) {
            const lock = collab.getLockOwner(link.id);
            collab.showLockConflictNotification(`${lock?.userName || 'Otro usuario'} ya está editando esta relación`);
            return;
        }

        const myToken = ++this._editToken;

        const relationData = link.get('relationData') || {};
        const currentType = relationData.type || 'association';
        const currentSource = relationData.sourceMultiplicity || '';
        const currentTarget = relationData.targetMultiplicity || '';
        const currentName = relationData.name || '';

        const closeModal = this.showEditRelationshipModal(link, currentType, currentSource, currentTarget, currentName, () => {
            this.editor._stopLockHeartbeat?.();
            ws?.releaseLock(link.id);
        });

        if (ws) {
            // Igual que selectElement() en editor.js: mientras el modal siga
            // abierto hay que renovar el lock periódicamente, si no el
            // backend lo trata como abandonado a los 120s (ver
            // Collaborator::LOCK_TTL_SECONDS) aunque lo sigamos teniendo
            // abierto — el lock tiene que durar hasta que el usuario cierre
            // el modal, no hasta que se cumpla un reloj fijo.
            this.editor._startLockHeartbeat?.(link.id);

            ws.requestLock(link.id).then(locked => {
                if (myToken !== this._editToken) return; // ya se cerró/abrió otro modal mientras tanto
                if (!locked) {
                    this.editor._stopLockHeartbeat?.();
                    collab?.showLockConflictNotification('Otro usuario ya está editando esta relación');
                    closeModal?.();
                }
            });
        }
    }

    showEditRelationshipModal(link, relationshipType, currentSource, currentTarget, currentName, onReleaseLock = () => {}) {
        // Obtener los anchors actuales del relationData
        const relationData = link.get('relationData') || {};
        const currentSourceAnchor = relationData.sourceAnchor || 'auto';
        const currentTargetAnchor = relationData.targetAnchor || 'auto';

        // Snapshot para poder revertir la vista de los demás si se cierra sin
        // guardar (ya vieron el borrador en vivo mientras se editaba).
        const originalRelationData = { ...relationData };
        const originalLabels = link.get('labels');

        const relationshipInfo = this.getRelationshipInfo(relationshipType);
        const showMultiplicity = relationshipType === 'association' || relationshipType === 'aggregation' || relationshipType === 'composition';
        const showName = relationshipType !== 'inheritance' && relationshipType !== 'realization';

        const html = `
            <div class="modal-header">
                <h3 class="modal-title">${relationshipInfo.icon} Editar ${relationshipInfo.name}</h3>
            </div>

            ${showMultiplicity ? `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;" class="form-group">
                    <div>
                        <label class="form-label">Multiplicidad origen</label>
                        <select id="editSourceMultiplicity" class="form-select">${multiplicityOptionsHTML(currentSource)}</select>
                    </div>
                    <div>
                        <label class="form-label">Multiplicidad destino</label>
                        <select id="editTargetMultiplicity" class="form-select">${multiplicityOptionsHTML(currentTarget)}</select>
                    </div>
                </div>
            ` : ''}

            ${showName ? `
                <div class="form-group">
                    <label class="form-label">Nombre de la relación</label>
                    <input type="text" id="editRelationName" value="${currentName}" class="form-input">
                </div>
            ` : ''}

            <div class="modal-section">
                <div class="modal-section-title">Puntos de conexión</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                    <div>
                        <label class="form-label">Salida desde origen</label>
                        <select id="editSourceAnchor" class="form-select">${anchorOptionsHTML(currentSourceAnchor)}</select>
                    </div>
                    <div>
                        <label class="form-label">Llegada a destino</label>
                        <select id="editTargetAnchor" class="form-select">${anchorOptionsHTML(currentTargetAnchor)}</select>
                    </div>
                </div>
            </div>

            <div class="modal-footer">
                <button id="cancelEditBtn" class="btn btn-secondary">Cancelar</button>
                <button id="deleteRelationBtn" class="btn btn-danger">${icon('trash', { size: 14 })} Eliminar</button>
                <button id="saveEditBtn" class="btn btn-primary">${icon('check', { size: 14 })} Guardar</button>
            </div>
        `;

        let finalized = false;
        // Ver el comentario equivalente en DiagramClassManager.showEditDialog:
        // hay que poder cancelar un broadcast en vivo pendiente al cerrar, y
        // reenviar la reversión después por si uno ya estaba en vuelo.
        const liveBroadcastState = { timeoutId: null };

        const revertBroadcast = () => {
            this.editor.webSocketManager?.broadcastDiagramUpdate({
                type: 'relationship_updated',
                data: {
                    linkId: link.id,
                    labels: originalLabels,
                    sourceAnchor: originalRelationData.sourceAnchor,
                    targetAnchor: originalRelationData.targetAnchor,
                    relationData: originalRelationData
                }
            });
        };

        const { close, dialog } = openModal(html, {
            maxWidth: '540px',
            onClose: () => {
                this._editToken++; // invalida un requestLock() de este modal si seguía en vuelo
                onReleaseLock();
                clearTimeout(liveBroadcastState.timeoutId);
                if (!finalized) {
                    revertBroadcast();
                    setTimeout(revertBroadcast, 400);
                }
            },
        });

        const collectDraft = () => ({
            sourceMultiplicity: showMultiplicity ? document.getElementById('editSourceMultiplicity').value : '',
            targetMultiplicity: showMultiplicity ? document.getElementById('editTargetMultiplicity').value : '',
            name: showName ? document.getElementById('editRelationName').value.trim() : '',
            sourceAnchor: document.getElementById('editSourceAnchor').value,
            targetAnchor: document.getElementById('editTargetAnchor').value,
        });

        // Difundir en vivo cada cambio del formulario (sin tocar el link
        // local todavía: eso pasa recién al guardar). 'input' es necesario
        // además de 'change' porque el campo de texto (nombre) solo dispara
        // 'change' al perder el foco — con eso solo, escribir el nombre no
        // se vería en vivo hasta hacer click afuera.
        const scheduleLiveBroadcast = () => {
            clearTimeout(liveBroadcastState.timeoutId);
            liveBroadcastState.timeoutId = setTimeout(() => {
                if (!document.getElementById('editSourceAnchor')) return;

                const draft = collectDraft();
                const draftLabels = this.createRelationLabelsImproved(draft.sourceMultiplicity, draft.targetMultiplicity, draft.name);
                this.editor.webSocketManager?.broadcastDiagramUpdate({
                    type: 'relationship_updated',
                    data: {
                        linkId: link.id,
                        labels: draftLabels,
                        sourceAnchor: draft.sourceAnchor,
                        targetAnchor: draft.targetAnchor,
                        relationData: { ...relationData, ...draft, type: relationshipType }
                    }
                });
            }, 150);
        };
        dialog.addEventListener('input', scheduleLiveBroadcast);
        dialog.addEventListener('change', scheduleLiveBroadcast);

        // Event listeners
        document.getElementById('cancelEditBtn').onclick = () => close();

        document.getElementById('saveEditBtn').onclick = () => {
            const draft = collectDraft();

            // Actualizar labels
            const newLabels = this.createRelationLabelsImproved(
                draft.sourceMultiplicity,
                draft.targetMultiplicity,
                draft.name
            );
            link.set('labels', newLabels);

            // Siempre se setea explícito (incluso "automático"): si no, volver
            // a elegir "Automático" después de haber fijado un lado manual no
            // tendría efecto, porque el anchor anterior seguiría ahí.
            link.prop('source/anchor', { name: draft.sourceAnchor === 'auto' ? 'distributedSide' : draft.sourceAnchor });
            link.prop('target/anchor', { name: draft.targetAnchor === 'auto' ? 'distributedSide' : draft.targetAnchor });

            // Actualizar datos
            // Copia nueva (no mutar la existente): si no, `set` no detecta el cambio
            // y ni la auditoría ni el deshacer se enteran de la edición.
            const newRelationData = { ...(link.get('relationData') || {}) };
            newRelationData.sourceMultiplicity = draft.sourceMultiplicity;
            newRelationData.targetMultiplicity = draft.targetMultiplicity;
            newRelationData.name = draft.name;
            newRelationData.sourceAnchor = draft.sourceAnchor;
            newRelationData.targetAnchor = draft.targetAnchor;
            link.set('relationData', newRelationData);

            finalized = true;
            this.editor.webSocketManager?.broadcastDiagramUpdate({
                type: 'relationship_updated',
                data: {
                    linkId: link.id,
                    labels: newLabels,
                    sourceAnchor: draft.sourceAnchor,
                    targetAnchor: draft.targetAnchor,
                    relationData: newRelationData
                }
            });

            close();
            console.log('✅ Relación editada con nuevos puntos de conexión');
        };

        document.getElementById('deleteRelationBtn').onclick = async () => {
            const ok = await confirmDialog({
                tone: 'danger',
                title: '¿Eliminar esta relación?',
                message: 'Puedes recuperarla con Deshacer (Ctrl+Z).',
                confirmLabel: 'Eliminar',
            });
            if (ok && link.graph) {
                finalized = true;
                const linkId = link.id;
                link.remove();
                this.editor.webSocketManager?.broadcastDiagramUpdate({
                    type: 'element_deleted',
                    data: { elementId: linkId }
                });
                close();
                console.log('✅ Relación eliminada');
            }
        };

        // Para que quien la abrió pueda cerrarla desde afuera si el pedido
        // de bloqueo en segundo plano (ver editRelationshipImproved) resulta
        // negativo después de todo.
        return close;
    }

    // ==================== UTILIDADES ====================

    resetFirstElementSelected() {
        this._activeDragConnectorCleanup?.();
        if (this.firstElementSelected) {
            this.editor.highlightElement(this.firstElementSelected, false);
            this.firstElementSelected = null;
            this.hideRelationshipHelp();
        }
    }

    getFirstElementSelected() {
        return this.firstElementSelected;
    }

    // Método legacy para compatibilidad
    editRelationship(link) {
        this.editRelationshipImproved(link);
    }
}
