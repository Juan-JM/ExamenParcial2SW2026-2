// resources/js/diagram/DiagramSaveManager.js - COMPATIBLE CON UML 2.5
// Mantiene retrocompatibilidad completa y soporte para características UML 2.5
// El título del diagrama NO se maneja acá — ver el <h1> clic-para-editar en
// livewire/diagram-editor.blade.php (Alpine + updateTitle() del componente).

import * as joint from 'jointjs';
import { DiagramElementFactory } from './DiagramElementFactory.js';
import { icon } from './utils/uiIcons.js';

export class DiagramSaveManager {
    constructor(editor) {
        this.editor = editor;
        this.elementFactory = new DiagramElementFactory();
    }

    // ==================== MÉTODOS PRINCIPALES ====================

    /**
     * El botón "Guardar" solo guarda el CONTENIDO del diagrama — nunca el
     * título. El título se renombra desde el `<h1>` clic-para-editar del
     * header (Alpine + `updateTitle()` en el componente Livewire, ver
     * `livewire/diagram-editor.blade.php`), que ya lo persiste solo con
     * Enter/blur. Antes este método TAMBIÉN mandaba un título (con un
     * `prompt()` nativo del navegador si no había ninguno todavía) junto
     * con los datos, y el backend lo usaba para PISAR el título actual en
     * cada guardado — si renombrabas el diagrama y después apretabas
     * "Guardar", el nombre volvía al que tenía la primera vez que se
     * guardó. El diagrama además ya existe desde que se entra al editor
     * (ver la ruta 'diagrams.editor'), así que tampoco hace falta manejar
     * acá el caso "todavía no tiene id".
     */
    saveDiagram() {
        try {
            var jsonData = JSON.stringify(this.editor.graph.toJSON());

            console.log('💾 Guardando diagrama...');

            // Análisis de contenido para logging
            const data = JSON.parse(jsonData);
            const uml25Elements = data.cells ?
                data.cells.filter(cell => cell.umlData?.uml25).length : 0;

            if (uml25Elements > 0) {
                console.log(`📊 Guardando ${uml25Elements} elementos con características UML 2.5`);
            }

            if (window.Livewire) {
                window.Livewire.dispatch('save-diagram', [jsonData]);
            }

            this.showSaveNotification(
                `Diagrama guardado correctamente${uml25Elements > 0 ? ' (UML 2.5)' : ''}`,
                'success'
            );

            console.log('💾 Diagrama guardado exitosamente');

        } catch (error) {
            console.error('❌ Error al guardar:', error);
            this.showSaveNotification('Error al guardar el diagrama', 'error');
        }
    }

    // ==================== MÉTODOS EXISTENTES (SIN CAMBIOS) ====================

    loadDiagramData() {
        console.log('🔄 Cargando datos del diagrama...');
        console.log('📊 Datos disponibles:', window.diagramData);

        if (window.diagramData && window.diagramData !== '[]') {
            try {
                var data = JSON.parse(window.diagramData);
                console.log('📋 Datos parseados:', data);

                if (data.cells && data.cells.length > 0) {
                    this.editor.graph.clear();
                    this.recreateElementsFromData(data.cells);
                    this.editor.updateCanvasInfo();

                    setTimeout(() => {
                        this.editor.zoomManager.zoomToFit();
                    }, 500);

                    // Análisis de contenido cargado
                    const uml25Elements = data.cells.filter(cell => cell.umlData?.uml25).length;
                    console.log(`✅ Diagrama cargado con ${data.cells.length} elementos` +
                               (uml25Elements > 0 ? ` (${uml25Elements} con UML 2.5)` : ''));
                } else {
                    console.log('ℹ️ No hay elementos en el diagrama');
                }
            } catch (e) {
                console.error('❌ Error cargando diagrama:', e);
                console.error('📊 Datos que causaron error:', window.diagramData);
                this.editor.graph.clear();
            }
        } else {
            console.log('ℹ️ No hay datos de diagrama para cargar');
        }

        if (window.diagramId) {
            window.currentDiagramId = window.diagramId;
            console.log('🆔 ID del diagrama establecido:', window.currentDiagramId);
        }

        if (window.diagramTitle) {
            window.currentDiagramTitle = window.diagramTitle;
            console.log('📝 Título del diagrama establecido:', window.currentDiagramTitle);
        }
    }

    recreateElementsFromData(cells) {
        var elements = [];
        var links = [];

        cells.forEach(cell => {
            if (cell.type === 'standard.Rectangle') {
                elements.push(cell);
            } else if (cell.type === 'standard.Link') {
                links.push(cell);
            }
        });

        console.log('🔄 Recreando', elements.length, 'elementos y', links.length, 'enlaces');

        // Recrear elementos primero
        elements.forEach(elementData => {
            this.recreateElement(elementData);
        });

        // Luego recrear enlaces — en DOS pasadas: un link "clase asociativa"
        // (ver DiagramElementFactory.isAssociationClassLink) tiene como
        // target OTRO LINK, no una clase, así que necesita que ese link host
        // ya exista en el graph. En la práctica el host siempre se crea
        // antes (hace falta clickear una relación YA existente para poder
        // unirle una clase asociativa), pero no vale la pena depender del
        // orden en que haya quedado guardado el JSON — se procesan aparte,
        // después de todos los demás, para no arriesgarse a perderlos si
        // getCell(target.id) todavía no resuelve.
        const normalLinks = links.filter(l => (l.relationData || {}).type !== 'associationClassLink');
        const associationClassLinks = links.filter(l => (l.relationData || {}).type === 'associationClassLink');

        normalLinks.forEach(linkData => {
            this.recreateLink(linkData);
        });
        associationClassLinks.forEach(linkData => {
            this.recreateLink(linkData);
        });

        if (associationClassLinks.length > 0) {
            // Mismo motivo que en DiagramRelationshipManager.createRelationshipFromConfig
            // — sin forzar el flush del render async, un link "clase
            // asociativa" recién cargado se ve en vivo con el <g> vacío
            // (nunca llega a pintar su <path>) hasta la próxima interacción
            // que dispare un render por su cuenta.
            this.editor.paper.dumpViews();
        }
    }

    recreateElement(elementData) {
        try {
            var umlData = elementData.umlData || {};
            var position = elementData.position || { x: 100, y: 100 };
            var type = umlData.type || 'class';
            var className = umlData.className || 'Clase';
            var attributes = umlData.attributes || [];
            var methods = umlData.methods || [];

            // NUEVO: Extraer configuración UML 2.5 si existe
            var uml25Config = null;
            if (umlData.uml25) {
                uml25Config = this.elementFactory.getUML25Config(umlData);
                console.log(`🚀 Recreando elemento UML 2.5: ${className}`, uml25Config);
            }

            // Usar la factory factorizada para crear el elemento (con soporte UML 2.5)
            const element = this.elementFactory.createClassElement(
                className,
                attributes,
                methods,
                position.x,
                position.y,
                type,
                null, // No agregar al graph automáticamente
                uml25Config // NUEVO: Pasar configuración UML 2.5
            );

            // createClassElement() toma (x, y) como el CENTRO de la clase, pero lo
            // guardado es la esquina superior izquierda. Sin esto, cada carga
            // corría la clase medio ancho y medio alto: quien entraba a un
            // diagrama lo veía distinto que los demás, y si guardaba, el
            // corrimiento quedaba persistido y se acumulaba en cada apertura.
            element.position(position.x, position.y);

            // Establecer ID original si existe
            if (elementData.id) {
                element.set('id', elementData.id);
            }

            // Agregar al graph
            this.editor.graph.addCell(element);

            console.log(`✅ Elemento recreado: ${className}` +
                       (uml25Config ? ' (UML 2.5)' : ''));

        } catch (error) {
            console.error('❌ Error recreando elemento:', error);
        }
    }

    recreateLink(linkData) {
        try {
            var relationData = linkData.relationData || {};
            var source = linkData.source || {};
            var target = linkData.target || {};
            var labels = linkData.labels || [];

            var sourceElement = this.editor.graph.getCell(source.id);
            var targetElement = this.editor.graph.getCell(target.id);

            if (!sourceElement || !targetElement) {
                console.warn('⚠️ No se pudo recrear enlace: elementos fuente/destino no encontrados');
                return;
            }

            // Usar el método factorizado para obtener atributos de relación
            var attrs = this.elementFactory.getRelationshipAttrs(relationData.type);

            // `hideArrow` (asociación importada de un XMI sin flecha — ver
            // DiagramRelationshipManager.createRelationshipFromConfig) es un
            // override POR INSTANCIA sobre el default de la factory, no algo
            // que dependa del `type`. Al recrear el link desde los datos
            // guardados hay que volver a aplicarlo acá — si no, quedaba bien
            // al importar (attrs armados en el momento con el override ya
            // aplicado) pero se perdía al recargar la página, porque acá
            // `attrs` se recalcula de cero solo a partir de `relationData.type`.
            if (relationData.hideArrow) {
                attrs.line.targetMarker = null;
            }

            var newLink = new joint.shapes.standard.Link({
                id: linkData.id,
                source: source,
                target: target,
                attrs: attrs,
                labels: labels,
                relationData: relationData,
                // El link "clase asociativa" necesita su propio router
                // ('normal', no el distributedSide por defecto del paper —
                // ver DiagramRelationshipManager, ese router asume ambos
                // extremos son ELEMENTOS y rompe con un target que es otra
                // relación). Sin reenviarlo acá, se perdía al recargar
                // (quedaba sin dibujar) aunque sí se hubiera guardado bien.
                ...(linkData.router ? { router: linkData.router } : {})
            });

            this.editor.graph.addCell(newLink);
            console.log('✅ Enlace recreado:', relationData.type || 'Sin tipo');

        } catch (e) {
            console.error('❌ Error recreando enlace:', e, linkData);
        }
    }

    showSaveNotification(message, type) {
        const variantClass = type === 'error' ? ' toast-error' : type === 'info' ? ' toast-info' : '';
        const iconName = type === 'error' ? 'x' : type === 'info' ? 'info' : 'check';

        var notification = document.createElement('div');
        notification.className = `toast${variantClass}`;
        notification.style.transition = 'opacity 0.3s ease';
        notification.innerHTML = `
            <span class="toast-icon">${icon(iconName, { size: 16 })}</span>
            <span>${message}</span>
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    /** El botón "Limpiar" ya confirma del lado de Livewire (`wire:confirm`, ver diagram-editor.blade.php) antes de que este método se llegue a llamar — no volver a confirmar acá, o queda un doble diálogo. */
    clearDiagram() {
        this.editor.graph.clear();
        this.editor.selectedElement = null;
        this.editor.firstElementSelected = null;
        this.editor.updateCanvasInfo();
        console.log('🧹 Diagrama limpiado');
    }

    exportToPNG() {
        console.log('📸 Export a PNG no implementado aún');
        this.showSaveNotification('Export a PNG será implementado próximamente', 'info');
    }

    // ==================== MÉTODOS UML 2.5 (SIN CAMBIOS) ====================

    getDiagramStats() {
        const elements = this.editor.graph.getElements();
        const links = this.editor.graph.getLinks();

        let uml25Count = 0;
        let stereotypeCount = {};
        let derivedAttributesCount = 0;
        let responsibilitiesCount = 0;
        let constraintsCount = 0;

        elements.forEach(element => {
            const umlData = element.get('umlData');
            if (umlData?.uml25) {
                uml25Count++;

                if (umlData.uml25.stereotype) {
                    stereotypeCount[umlData.uml25.stereotype] =
                        (stereotypeCount[umlData.uml25.stereotype] || 0) + 1;
                }

                derivedAttributesCount += umlData.uml25.derivedAttributes?.length || 0;
                responsibilitiesCount += umlData.uml25.responsibilities?.length || 0;
                constraintsCount += umlData.uml25.constraints?.length || 0;
            }
        });

        return {
            totalElements: elements.length,
            totalLinks: links.length,
            uml25Elements: uml25Count,
            stereotypes: stereotypeCount,
            derivedAttributes: derivedAttributesCount,
            responsibilities: responsibilitiesCount,
            constraints: constraintsCount
        };
    }

    convertToLegacy() {
        if (!confirm('¿Convertir elementos UML 2.5 a formato legacy?\n\nEsto eliminará las características avanzadas.')) {
            return;
        }

        const elements = this.editor.graph.getElements();
        let convertedCount = 0;

        elements.forEach(element => {
            const umlData = element.get('umlData');
            if (umlData?.uml25) {
                // Remover configuración UML 2.5
                const newUmlData = { ...umlData };
                delete newUmlData.uml25;
                element.set('umlData', newUmlData);

                // Recrear elemento sin características UML 2.5
                this.elementFactory.updateClassElement(
                    element,
                    umlData.className,
                    umlData.attributes,
                    umlData.methods,
                    umlData.type,
                    null // Sin configuración UML 2.5
                );

                convertedCount++;
            }
        });

        this.showSaveNotification(`${convertedCount} elementos convertidos a legacy`, 'success');
        console.log(`🔄 Convertidos ${convertedCount} elementos a formato legacy`);
    }

    exportUML25Features() {
        const elements = this.editor.graph.getElements();
        const uml25Data = [];

        elements.forEach(element => {
            const umlData = element.get('umlData');
            if (umlData?.uml25) {
                uml25Data.push({
                    className: umlData.className,
                    type: umlData.type,
                    uml25Features: umlData.uml25
                });
            }
        });

        if (uml25Data.length === 0) {
            this.showSaveNotification('No hay elementos UML 2.5 para exportar', 'info');
            return;
        }

        // Crear y descargar archivo JSON
        const blob = new Blob([JSON.stringify(uml25Data, null, 2)],
                             { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `uml25-features-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        this.showSaveNotification(`Exportadas ${uml25Data.length} características UML 2.5`, 'success');
    }
}

// ==================== FUNCIONES GLOBALES ====================

// Función global para compatibilidad (ORIGINAL)
window.saveFromButton = function() {
    if (window.DiagramEditor?.instance?.saveManager) {
        window.DiagramEditor.instance.saveManager.saveDiagram();
    } else {
        console.error('❌ Save Manager no disponible');
    }
};

// Funciones globales adicionales para UML 2.5 (SIN CAMBIOS)
window.exportUML25Features = function() {
    if (window.DiagramEditor?.instance?.saveManager) {
        window.DiagramEditor.instance.saveManager.exportUML25Features();
    }
};

window.convertToLegacy = function() {
    if (window.DiagramEditor?.instance?.saveManager) {
        window.DiagramEditor.instance.saveManager.convertToLegacy();
    }
};

window.getDiagramStats = function() {
    if (window.DiagramEditor?.instance?.saveManager) {
        return window.DiagramEditor.instance.saveManager.getDiagramStats();
    }
};
