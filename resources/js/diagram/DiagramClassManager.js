// resources/js/diagram/DiagramClassManager.js
// Creación de clases/interfaces UML. La edición (nombre, atributos, métodos,
// características UML 2.5) ya no vive acá — desde el rediseño de paneles
// estilo Enterprise Architect, la maneja DiagramPropertiesPanel (panel
// derecho + panel inferior, siempre visibles en vez de un modal).

import { DiagramElementFactory } from './DiagramElementFactory.js';

export class DiagramClassManager {
    constructor(editor) {
        this.editor = editor;
        this.classCounter = 1;
        this.interfaceCounter = 1;

        // Usar la factory factorizada con soporte UML 2.5
        this.elementFactory = new DiagramElementFactory();
    }

    createClassImproved(x, y) {
        const className = `Class ${this.classCounter++}`;
        const attributes = ['- attribute1: String', '- attribute2: int'];
        const methods = ['+ method1(): void', '+ method2(): String'];

        // Crear con configuración básica (retrocompatible)
        const element = this.elementFactory.createClassElement(
            className, attributes, methods, x, y, 'class', this.editor.graph, null
        );

        this.makeElementEditable(element);
        this.broadcastCreated(element);
        this.editor.updateCanvasInfo();
        this.editor.selectTool('select');

        // Seleccionarla de una la puebla en los paneles de propiedades,
        // lista para completar nombre/atributos/métodos.
        this.editor.selectElement(element);

        return element;
    }

    createInterface(x, y) {
        const interfaceName = `Interface ${this.interfaceCounter++}`;
        const methods = ['+ method1(): void', '+ method2(): String'];

        // Crear con configuración básica (retrocompatible)
        const element = this.elementFactory.createClassElement(
            interfaceName, [], methods, x, y, 'interface', this.editor.graph, null
        );

        this.makeElementEditable(element);
        this.broadcastCreated(element);
        this.editor.updateCanvasInfo();
        this.editor.selectTool('select');

        this.editor.selectElement(element);

        return element;
    }

    /**
     * Avisa en vivo que se creó una clase/interfaz (como 'class_updated' con
     * posición: el receptor la crea si no la tiene). Antes solo viajaba al
     * editarla, así que los demás —y la vista "Ver"/celular— no la veían hasta
     * el próximo guardado.
     */
    broadcastCreated(element) {
        const umlData = element.get('umlData') || {};
        this.editor.webSocketManager?.broadcastDiagramUpdate({
            type: 'class_updated',
            data: {
                elementId: element.id,
                umlData: {
                    className: umlData.className,
                    attributes: umlData.attributes || [],
                    methods: umlData.methods || [],
                    type: umlData.type,
                    uml25: umlData.uml25 || null,
                },
                position: element.position(),
            },
        });
    }

    editClassImproved(element) {
        this.editor.propertiesPanel?.show(element);
    }

    updateClassElement(element, className, attributes, methods, type, uml25Config = null) {
        // Usar el método factorizado para actualizar
        this.elementFactory.updateClassElement(element, className, attributes, methods, type, uml25Config);

        // JointJS no siempre vuelve a pintar solo el DOM de un elemento ya
        // renderizado cuando se le cambia el `markup` (estructura interna),
        // a diferencia de un simple cambio de `attrs` — el modelo queda
        // correcto pero el SVG visible se queda con el texto viejo. Forzar
        // el re-render deja esto determinístico en vez de depender de que
        // "algo más" dispare un repintado de casualidad.
        this.editor.paper?.findViewByModel(element)?.render();

        this.editor.updateCanvasInfo();
    }

    makeElementEditable(element) {
        element.on('change:position', () => {
            // Mantener sincronizado si se mueve
        });
    }
}
