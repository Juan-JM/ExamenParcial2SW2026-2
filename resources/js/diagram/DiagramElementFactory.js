// resources/js/diagram/DiagramElementFactory.js - EXTENSIÓN UML 2.5
// Mantiene retrocompatibilidad completa pero agrega soporte opcional para UML 2.5

import * as joint from 'jointjs';

/**
 * Único criterio válido para "esto es una clase/interfaz UML" en todo el código.
 * La factory siempre crea clases e interfaces como `standard.Rectangle` (no existe
 * un tipo JointJS `uml.Class`/`uml.Interface`); lo que las distingue de un rectángulo
 * cualquiera es que traen `umlData` adjunto, y `umlData.type` distingue clase de interfaz.
 */
export function isUmlClassElement(element) {
    return element.get('type') === 'standard.Rectangle' && !!element.get('umlData');
}

export function isUmlLinkElement(link) {
    return link.get('type') === 'standard.Link' && !!link.get('relationData');
}

export class DiagramElementFactory {
    constructor() {
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
            ],
            // NUEVOS: Estereotipos UML 2.5
            uml25Stereotypes: {
                'entity': '<<entity>>',
                'enumeration': '<<enumeration>>',
                'datatype': '<<datatype>>',
                'service': '<<service>>',
                'repository': '<<repository>>',
                'controller': '<<controller>>',
                'utility': '<<utility>>'
            }
        };
    }

    // ==================== ANÁLISIS DE DATOS UML 2.5 ====================

    /**
     * Verifica si un elemento usa características UML 2.5
     */
    isUML25Element(umlData) {
        return !!(umlData.uml25 && Object.keys(umlData.uml25).length > 0);
    }

    /**
     * Obtiene la configuración UML 2.5 con valores por defecto
     */
    getUML25Config(umlData) {
        return {
            stereotype: umlData.uml25?.stereotype || null,
            derivedAttributes: umlData.uml25?.derivedAttributes || [],
            responsibilities: umlData.uml25?.responsibilities || [],
            constraints: umlData.uml25?.constraints || [],
            extendedVisibility: umlData.uml25?.extendedVisibility || false,
            multiplicities: umlData.uml25?.multiplicities || {},
            // Notación estándar UML 2.5: abstracto (cursiva) y estático (subrayado)
            isAbstract: umlData.uml25?.isAbstract || false,
            abstractMethods: umlData.uml25?.abstractMethods || [],
            staticAttributes: umlData.uml25?.staticAttributes || [],
            staticMethods: umlData.uml25?.staticMethods || [],
            // Oculta el ": Tipo" en el dibujo de la clase (útil para modelos
            // de dominio/conceptuales) sin perder el dato: sigue guardado en
            // el string real, solo cambia lo que se muestra.
            hideDataTypes: umlData.uml25?.hideDataTypes || false,
            // Restricción {ej: unique} por fila — reemplaza a la vieja lista
            // de "constraints" a nivel de clase (ver arriba, se deja de
            // editar pero diagramas viejos con eso siguen mostrándose
            // igual). Arrays alineados por índice con attributes/methods.
            attributeConstraints: umlData.uml25?.attributeConstraints || [],
            methodConstraints: umlData.uml25?.methodConstraints || []
        };
    }

    // ==================== MÉTODOS DE CÁLCULO EXTENDIDOS ====================

    calculateElementDimensions(className, attributes, methods, type, uml25Config = null) {
        // OJO: el ancho tiene que medirse sobre el mismo texto que
        // buildTextElements() va a dibujar de verdad (tipo oculto, prefijo
        // "/" derivado, sufijo {restricción}) — por eso ambos pasan por los
        // mismos buildAttributeDisplay/buildMethodDisplay, o la caja
        // quedaría más angosta o más ancha de lo necesario.
        const visibleAttributes = attributes.map((attr, i) => this.buildAttributeDisplay(attr, i, uml25Config));
        const visibleMethods = methods.map((method, i) => this.buildMethodDisplay(method, i, uml25Config));

        const maxLineLength = Math.max(
            className.length,
            ...visibleAttributes.map(attr => attr.length),
            ...visibleMethods.map(method => method.length),
            // NUEVO: Considerar responsibilities y constraints si existen
            ...(uml25Config?.responsibilities || []).map(resp => resp.length),
            ...(uml25Config?.constraints || []).map(constraint => constraint.length)
        );
        const width = Math.max(200, maxLineLength * 8 + 30);

        const lineHeight = 16;
        const responsibilities = uml25Config?.responsibilities || [];
        const constraints = uml25Config?.constraints || [];
        const hasStereotype = type === 'interface' || !!uml25Config?.stereotype;

        // Simula la MISMA secuencia de <tspan dy> que buildTextElements()
        // genera de verdad (dy es siempre relativo al renglón anterior), en
        // vez de mantener una fórmula aparte que tiene que "adivinar" el
        // resultado. Antes esta cuenta no sabía que el primer renglón de
        // cada sección (atributos/métodos/responsabilidades) usa el doble
        // de espacio (dy: lineHeight*2) para separarse de la anterior, así
        // que con clases con varias secciones llenas el alto calculado
        // quedaba corto y el texto de más abajo se veía cortado por el
        // borde. Así no se puede desincronizar de nuevo si cambia el layout
        // real, porque es literalmente el mismo cálculo.
        let totalDy = 0;
        let isFirstLine = true;
        const addLine = (extraGap) => {
            totalDy += isFirstLine ? 0 : (extraGap ? lineHeight * 2 : lineHeight);
            isFirstLine = false;
        };

        if (hasStereotype) addLine(false);
        addLine(false); // nombre de la clase
        attributes.forEach((_, i) => addLine(i === 0));
        methods.forEach((_, i) => addLine(i === 0));
        responsibilities.forEach((_, i) => addLine(i === 0));
        constraints.forEach((_, i) => addLine(i === 0 && responsibilities.length === 0));

        // classText.y = 20 (offset inicial fijo, ver buildTextElements) +
        // lo acumulado + margen inferior para que la última línea no quede
        // pegada al borde.
        const height = Math.max(120, 20 + totalDy + 24);

        return { width, height };
    }

    getElementColors(type, uml25Config = null) {
        // Colores especiales para estereotipos UML 2.5
        if (uml25Config?.stereotype) {
            const stereotypeColors = {
                'entity': { fill: '#fef3c7', stroke: '#f59e0b', textColor: '#92400e' },
                'enumeration': { fill: '#f3e8ff', stroke: '#8b5cf6', textColor: '#6b21a8' },
                'datatype': { fill: '#ecfdf5', stroke: '#10b981', textColor: '#065f46' },
                'service': { fill: '#eff6ff', stroke: '#3b82f6', textColor: '#1e40af' },
                'repository': { fill: '#f0fdf4', stroke: '#22c55e', textColor: '#15803d' },
                'controller': { fill: '#fefce8', stroke: '#eab308', textColor: '#a16207' },
                'utility': { fill: '#f8fafc', stroke: '#6b7280', textColor: '#374151' }
            };

            return stereotypeColors[uml25Config.stereotype] || this.getDefaultColors(type);
        }

        return this.getDefaultColors(type);
    }

    getDefaultColors(type) {
        return type === 'interface' ? {
            fill: '#faf5ff',
            stroke: '#000000',
            strokeDasharray: '8,4',
            textColor: '#000000'
        } : {
            fill: '#ffffff',
            stroke: '#000000',
            strokeDasharray: 'none',
            textColor: '#000000'
        };
    }

    getColorByVisibility(text) {
        if (text.startsWith('+')) return '#059669'; // public - verde
        if (text.startsWith('-')) return '#dc2626'; // private - rojo
        if (text.startsWith('#')) return '#d97706'; // protected - naranja
        if (text.startsWith('~')) return '#7c3aed'; // package - violeta (UML 2.5)
        if (text.startsWith('/')) return '#0891b2'; // derivado - azul cian (UML 2.5)
        return '#374151'; // default - gris
    }

    // ==================== PARSEO/SERIALIZACIÓN DE ATRIBUTOS Y MÉTODOS ====================
    // Único lugar que entiende la convención de texto UML ("- nombre: Tipo",
    // "+ metodo(): Tipo") para editarla como filas de tabla (panel de
    // propiedades) — el ARRAY DE STRINGS sigue siendo el formato de
    // almacenamiento real (el que ya leen los 5 generadores de código, XMI,
    // etc.), esto solo lo traduce de ida y vuelta para la UI.

    static VISIBILITY_SYMBOLS = ['+', '-', '#', '~'];

    splitVisibility(line) {
        const trimmed = (line || '').trim();
        if (DiagramElementFactory.VISIBILITY_SYMBOLS.includes(trimmed[0])) {
            return { visibility: trimmed[0], rest: trimmed.slice(1).trim() };
        }
        return { visibility: '+', rest: trimmed };
    }

    parseAttributeLine(line) {
        const { visibility, rest } = this.splitVisibility(line);
        const colonIdx = rest.lastIndexOf(':');
        if (colonIdx === -1) return { visibility, name: rest, type: '' };
        return { visibility, name: rest.slice(0, colonIdx).trim(), type: rest.slice(colonIdx + 1).trim() };
    }

    serializeAttributeLine({ visibility, name, type }) {
        const v = visibility || '+';
        return type ? `${v} ${name}: ${type}` : `${v} ${name}`;
    }

    parseMethodLine(line) {
        const { visibility, rest } = this.splitVisibility(line);
        const colonIdx = rest.lastIndexOf(':');
        const signature = colonIdx === -1 ? rest : rest.slice(0, colonIdx).trim();
        const returnType = colonIdx === -1 ? 'void' : rest.slice(colonIdx + 1).trim();
        return { visibility, signature, returnType };
    }

    serializeMethodLine({ visibility, signature, returnType }) {
        const v = visibility || '+';
        // Comodidad: si se escribe solo el nombre sin paréntesis, se agregan solos.
        const sig = signature.includes('(') ? signature : `${signature}()`;
        return `${v} ${sig}: ${returnType || 'void'}`;
    }

    /** Texto a mostrar en el diagrama: igual al guardado, salvo que se pidió ocultar el tipo de dato. */
    getDisplayAttributeLine(line, hideDataTypes) {
        if (!hideDataTypes) return line;
        const { visibility, name } = this.parseAttributeLine(line);
        return `${visibility} ${name}`;
    }

    getDisplayMethodLine(line, hideDataTypes) {
        if (!hideDataTypes) return line;
        const { visibility, signature } = this.parseMethodLine(line);
        return `${visibility} ${signature}`;
    }

    /**
     * Texto final a dibujar/medir para un atributo (tipo oculto si
     * corresponde + prefijo "/" si es derivado + restricción {ej} al
     * final) — UN SOLO lugar que arma esto, para que el cálculo de ancho
     * de la caja (calculateElementDimensions) y el dibujo real
     * (buildTextElements) nunca puedan quedar desincronizados entre sí.
     */
    buildAttributeDisplay(attr, index, uml25Config) {
        let text = this.getDisplayAttributeLine(attr, uml25Config?.hideDataTypes);
        if (uml25Config?.derivedAttributes?.includes(index) && !text.startsWith('/')) {
            text = `/${text}`;
        }
        const constraint = uml25Config?.attributeConstraints?.[index];
        if (constraint) text += ` {${constraint}}`;
        return text;
    }

    buildMethodDisplay(method, index, uml25Config) {
        let text = this.getDisplayMethodLine(method, uml25Config?.hideDataTypes);
        const constraint = uml25Config?.methodConstraints?.[index];
        if (constraint) text += ` {${constraint}}`;
        return text;
    }

    // ==================== CONSTRUCCIÓN DE TEXTO SVG EXTENDIDA ====================

    buildTextElements(className, attributes, methods, type, width, uml25Config = null) {
        const elements = [];
        let currentY = 0;
        const lineHeight = 16;

        // NUEVO: Estereotipo UML 2.5 (más prioritario que interface)
        if (uml25Config?.stereotype) {
            elements.push({
                tagName: 'tspan',
                attributes: {
                    x: width / 2,
                    dy: currentY === 0 ? 0 : lineHeight,
                    'font-style': 'italic',
                    'font-size': '10px',
                    'text-anchor': 'middle',
                    'fill': '#6b7280'
                },
                textContent: this.umlTemplates.uml25Stereotypes[uml25Config.stereotype]
            });
            currentY += lineHeight;
        }

        // Estereotipo interface (solo si no hay estereotipo UML 2.5)
        if (type === 'interface' && !uml25Config?.stereotype) {
            elements.push({
                tagName: 'tspan',
                attributes: {
                    x: width / 2,
                    dy: currentY === 0 ? 0 : lineHeight,
                    'font-style': 'italic',
                    'font-size': '10px',
                    'text-anchor': 'middle'
                },
                textContent: '<<interface>>'
            });
            currentY += lineHeight;
        }

        // Nombre de la clase - CENTRADO (cursiva si la clase es abstracta, UML 2.5)
        elements.push({
            tagName: 'tspan',
            attributes: {
                x: width / 2,
                dy: currentY === 0 ? 0 : lineHeight,
                'font-weight': 'bold',
                'font-size': '13px',
                'text-anchor': 'middle',
                'font-style': uml25Config?.isAbstract ? 'italic' : 'normal'
            },
            textContent: className
        });
        currentY += lineHeight;

        // Atributos - ALINEADOS A LA IZQUIERDA (con soporte para derivados y estáticos)
        if (attributes.length > 0) {
            attributes.forEach((attr, index) => {
                // NUEVO: Marcar atributos derivados si están en la lista
                const isDerived = uml25Config?.derivedAttributes?.includes(index);
                const isStatic = uml25Config?.staticAttributes?.includes(index);
                const displayText = this.buildAttributeDisplay(attr, index, uml25Config);

                elements.push({
                    tagName: 'tspan',
                    attributes: {
                        x: 15,
                        dy: index === 0 ? lineHeight * 2 : lineHeight,
                        fill: this.getColorByVisibility(displayText),
                        'text-anchor': 'start',
                        'font-style': isDerived ? 'italic' : 'normal',
                        'text-decoration': isStatic ? 'underline' : 'none'
                    },
                    textContent: displayText
                });
                currentY += lineHeight;
            });
        }

        // Métodos - ALINEADOS A LA IZQUIERDA (con soporte para abstractos y estáticos)
        if (methods.length > 0) {
            methods.forEach((method, index) => {
                const isAbstractMethod = uml25Config?.abstractMethods?.includes(index);
                const isStaticMethod = uml25Config?.staticMethods?.includes(index);
                const visibleMethod = this.buildMethodDisplay(method, index, uml25Config);

                elements.push({
                    tagName: 'tspan',
                    attributes: {
                        x: 15,
                        dy: index === 0 ?
                            (attributes.length > 0 ? lineHeight * 2 : lineHeight * 2) : lineHeight,
                        fill: this.getColorByVisibility(visibleMethod),
                        'text-anchor': 'start',
                        'font-style': isAbstractMethod ? 'italic' : 'normal',
                        'text-decoration': isStaticMethod ? 'underline' : 'none'
                    },
                    textContent: visibleMethod
                });
                currentY += lineHeight;
            });
        }

        // NUEVO: Responsabilidades UML 2.5
        if (uml25Config?.responsibilities?.length > 0) {
            uml25Config.responsibilities.forEach((responsibility, index) => {
                elements.push({
                    tagName: 'tspan',
                    attributes: {
                        x: 15,
                        dy: index === 0 ? lineHeight * 2 : lineHeight,
                        fill: '#6b7280',
                        'text-anchor': 'start',
                        'font-size': '11px',
                        'font-style': 'italic'
                    },
                    textContent: responsibility
                });
                currentY += lineHeight;
            });
        }

        // NUEVO: Restricciones UML 2.5
        if (uml25Config?.constraints?.length > 0) {
            uml25Config.constraints.forEach((constraint, index) => {
                elements.push({
                    tagName: 'tspan',
                    attributes: {
                        x: 15,
                        dy: index === 0 && uml25Config.responsibilities.length === 0 ? lineHeight * 2 : lineHeight,
                        fill: '#dc2626',
                        'text-anchor': 'start',
                        'font-size': '11px',
                        'font-weight': 'bold'
                    },
                    textContent: constraint
                });
                currentY += lineHeight;
            });
        }

        return elements;
    }

    // ==================== CÁLCULO DE POSICIONES DE LÍNEAS EXTENDIDO ====================

    calculateDividerPositions(type, attributes, methods, width, uml25Config = null) {
        const lineHeight = 16;
        let currentY = 20;

        // Saltar el estereotipo UML 2.5 si existe
        if (uml25Config?.stereotype) {
            currentY += lineHeight;
        }

        // Saltar el estereotipo interface si no hay UML 2.5
        if (type === 'interface' && !uml25Config?.stereotype) {
            currentY += lineHeight;
        }

        // Saltar el nombre de la clase
        currentY += lineHeight;

        // Primera línea divisoria (después del nombre)
        const line1Y = currentY + 5;

        // Segunda línea divisoria (después de atributos, si existen)
        const line2Y = attributes.length > 0 ?
            line1Y + (attributes.length * lineHeight) + lineHeight :
            -100;

        // NUEVA: Tercera línea divisoria (después de métodos, si hay responsabilidades o restricciones)
        const hasUML25Sections = uml25Config?.responsibilities?.length > 0 || uml25Config?.constraints?.length > 0;
        const line3Y = hasUML25Sections && methods.length > 0 ?
            line2Y + (methods.length * lineHeight) + lineHeight :
            -100;

        return {
            line1: {
                x1: 5, y1: line1Y, x2: width - 5, y2: line1Y
            },
            line2: {
                x1: 5, y1: line2Y, x2: width - 5, y2: line2Y,
                // Solo tiene sentido como separador si HAY algo debajo (métodos)
                // que separar de los atributos — si no hay métodos, mostrarla
                // deja una línea colgando sin nada debajo (bug reportado).
                display: attributes.length > 0 && methods.length > 0 ? 'block' : 'none'
            },
            // NUEVA: Línea para separar responsabilidades/restricciones
            line3: {
                x1: 5, y1: line3Y, x2: width - 5, y2: line3Y,
                display: hasUML25Sections && methods.length > 0 ? 'block' : 'none'
            }
        };
    }

    // ==================== CREACIÓN COMPLETA DE ELEMENTOS EXTENDIDA ====================

    createClassElement(className, attributes, methods, x, y, type, graph, uml25Config = null, elementId = null) {
        const dimensions = this.calculateElementDimensions(className, attributes, methods, type, uml25Config);
        const colors = this.getElementColors(type, uml25Config);
        const textElements = this.buildTextElements(className, attributes, methods, type, dimensions.width, uml25Config);
        const dividers = this.calculateDividerPositions(type, attributes, methods, dimensions.width, uml25Config);

        // Determinar si necesitamos markup extendido para UML 2.5
        const hasUML25Sections = uml25Config?.responsibilities?.length > 0 || uml25Config?.constraints?.length > 0;

        const markup = [
            { tagName: 'rect', selector: 'body' },
            { tagName: 'text', selector: 'classText', children: textElements },
            { tagName: 'line', selector: 'divider1' },
            { tagName: 'line', selector: 'divider2' }
        ];

        // NUEVO: Agregar tercera línea divisoria si hay secciones UML 2.5
        if (hasUML25Sections) {
            markup.push({ tagName: 'line', selector: 'divider3' });
        }

        const classElement = new joint.shapes.standard.Rectangle({
            ...(elementId ? { id: elementId } : {}),
            position: { x: x - dimensions.width/2, y: y - dimensions.height/2 },
            size: { width: dimensions.width, height: dimensions.height },
            attrs: {
                body: {
                    fill: colors.fill,
                    stroke: colors.stroke,
                    strokeWidth: 2,
                    strokeDasharray: colors.strokeDasharray,
                    rx: 4, ry: 4,
                    filter: {
                        name: 'dropShadow',
                        args: { dx: 2, dy: 2, blur: 4, color: 'rgba(0,0,0,0.15)' }
                    }
                },
                label: { text: '', display: 'none' }
            },
            markup: markup,
            umlData: {
                // Campos existentes (retrocompatibilidad)
                className: className,
                attributes: attributes,
                methods: methods,
                type: type,
                // NUEVO: Configuración UML 2.5 opcional
                ...(uml25Config ? { uml25: uml25Config } : {})
            }
        });

        // Configurar texto
        classElement.attr('classText', {
            x: 15, y: 20, fontSize: 12,
            fontFamily: '"Fira Code", "Consolas", monospace',
            fill: colors.textColor, textAnchor: 'start', dominantBaseline: 'hanging'
        });

        // Configurar líneas divisorias
        classElement.attr({
            'divider1': { ...dividers.line1, stroke: colors.stroke, strokeWidth: 1 },
            'divider2': { ...dividers.line2, stroke: colors.stroke, strokeWidth: 1 }
        });

        // NUEVO: Configurar tercera línea si existe
        if (hasUML25Sections) {
            classElement.attr('divider3', {
                ...dividers.line3, stroke: colors.stroke, strokeWidth: 1
            });
        }

        if (graph) {
            graph.addCell(classElement);
        }

        return classElement;
    }

    // ==================== ACTUALIZACIÓN DE ELEMENTOS EXISTENTES EXTENDIDA ====================

    updateClassElement(element, className, attributes, methods, type, uml25Config = null) {
        const dimensions = this.calculateElementDimensions(className, attributes, methods, type, uml25Config);
        const colors = this.getElementColors(type, uml25Config);
        const textElements = this.buildTextElements(className, attributes, methods, type, dimensions.width, uml25Config);
        const dividers = this.calculateDividerPositions(type, attributes, methods, dimensions.width, uml25Config);

        element.resize(dimensions.width, dimensions.height);

        // Determinar markup necesario
        const hasUML25Sections = uml25Config?.responsibilities?.length > 0 || uml25Config?.constraints?.length > 0;

        const markup = [
            { tagName: 'rect', selector: 'body' },
            { tagName: 'text', selector: 'classText', children: textElements },
            { tagName: 'line', selector: 'divider1' },
            { tagName: 'line', selector: 'divider2' }
        ];

        if (hasUML25Sections) {
            markup.push({ tagName: 'line', selector: 'divider3' });
        }

        element.set('markup', markup);

        // Actualizar configuración del texto
        element.attr('classText', {
            x: 15, y: 20, fontSize: 12,
            fontFamily: '"Fira Code", "Consolas", monospace',
            fill: colors.textColor, textAnchor: 'start', dominantBaseline: 'hanging'
        });

        // Actualizar líneas divisorias
        element.attr({
            'divider1': { ...dividers.line1, stroke: colors.stroke, strokeWidth: 1 },
            'divider2': { ...dividers.line2, stroke: colors.stroke, strokeWidth: 1 }
        });

        if (hasUML25Sections) {
            element.attr('divider3', { ...dividers.line3, stroke: colors.stroke, strokeWidth: 1 });
        }

        // Actualizar datos UML (manteniendo retrocompatibilidad)
        element.set('umlData', {
            className: className,
            attributes: attributes,
            methods: methods,
            type: type,
            ...(uml25Config ? { uml25: uml25Config } : {})
        });

        return element;
    }

    // ==================== MÉTODOS PARA RELACIONES (INALTERADOS) ====================

    getRelationshipAttrs(type) {
        const baseAttrs = {
            line: { stroke: '#334155', strokeWidth: 2.5 }
        };

        switch(type) {
            case 'inheritance':
                baseAttrs.line.targetMarker = {
                    type: 'path', d: 'M 20 -12 L 0 0 L 20 12 Z',
                    fill: 'white', stroke: '#334155', strokeWidth: 2.5
                };
                break;
            case 'aggregation':
                // El rombo tiene que tocar la clase directamente: el vértice
                // más cercano al punto de conexión va en (0,0), igual que ya
                // hacen la flecha y el triángulo de herencia. Antes empezaba
                // en x=12 en vez de x=0, dejando un hueco de 12px sin nada
                // entre el rombo y el borde de la clase.
                baseAttrs.line.sourceMarker = {
                    type: 'path', d: 'M 12 -10 0 0 12 10 24 0 z',
                    fill: 'white', stroke: '#334155', strokeWidth: 2.5
                };
                baseAttrs.line.targetMarker = {
                    type: 'path', d: 'M 12 -6 0 0 12 6',
                    stroke: '#334155', fill: 'none', strokeWidth: 2.5
                };
                break;
            case 'composition':
                baseAttrs.line.sourceMarker = {
                    type: 'path', d: 'M 12 -10 0 0 12 10 24 0 z',
                    fill: '#334155', stroke: '#334155', strokeWidth: 2.5
                };
                baseAttrs.line.targetMarker = {
                    type: 'path', d: 'M 12 -6 0 0 12 6',
                    stroke: '#334155', fill: 'none', strokeWidth: 2.5
                };
                break;
            case 'realization':
                // Igual que herencia (triángulo hueco) pero con línea discontinua:
                // "implementa" en vez de "es un".
                baseAttrs.line.strokeDasharray = '6,4';
                baseAttrs.line.targetMarker = {
                    type: 'path', d: 'M 20 -12 L 0 0 L 20 12 Z',
                    fill: 'white', stroke: '#334155', strokeWidth: 2.5
                };
                break;
            case 'dependency':
                // Igual que asociación (flecha abierta) pero con línea discontinua:
                // "usa" en vez de "conoce permanentemente".
                baseAttrs.line.strokeDasharray = '6,4';
                baseAttrs.line.targetMarker = {
                    type: 'path', d: 'M 12 -6 0 0 12 6',
                    stroke: '#334155', fill: 'none', strokeWidth: 2.5
                };
                break;
            case 'associationClassLink':
                // Clase asociativa real (UML "association class"): línea
                // punteada SIN flechas en ningún extremo — no es "A conoce a
                // B", es "esta clase ES la relación". El target de este link
                // es OTRO LINK (la asociación M:N), no una clase — ver
                // isAssociationClassLink() más abajo y DiagramRelationshipManager.
                // targetMarker: null (no {type:'none'} — JointJS no tiene un
                // caso especial para ese "type", igual arma un <marker> y lo
                // referencia) es necesario de forma EXPLÍCITA —
                // joint.shapes.standard.Link trae una flecha por defecto en
                // sus propios `defaults`, y el constructor MERGEA nuestros
                // attrs con esos defaults en vez de reemplazarlos. El
                // procesador de este atributo en JointJS solo corre su lógica
                // si el valor pasa `isPlainObject` — con `null` directamente
                // no se llega a generar ningún marker-end (visto en vivo:
                // con {type:'none'} igual quedaba una flechita chica).
                baseAttrs.line.strokeDasharray = '4,3';
                baseAttrs.line.strokeWidth = 1.5;
                baseAttrs.line.targetMarker = null;
                break;
            case 'association':
            default:
                baseAttrs.line.targetMarker = {
                    type: 'path', d: 'M 12 -6 0 0 12 6',
                    stroke: '#334155', fill: 'none', strokeWidth: 2.5
                };
                break;
        }

        return baseAttrs;
    }
}

/**
 * Un link "clase asociativa → relación": su `target` es OTRO LINK (la
 * asociación M:N real), no una clase. JointJS soporta nativamente que el
 * extremo de un link apunte a otro link (ambos son `dia.Cell`) — no hace
 * falta ninguna extensión rara, pero SÍ hay que tratarlo distinto en varios
 * lugares (extracción para generadores, guardado/orden de carga, IA) porque
 * asumen que source/target son siempre clases. Ver documentacion/01-editor-diagrama.md.
 */
export function isAssociationClassLink(link) {
    return isUmlLinkElement(link) && link.get('relationData')?.type === 'associationClassLink';
}
