// resources/js/diagram/utils/simpleXMIImport.js
// Importador de diagramas UML desde archivos XML/XMI

export class SimpleXMIImporter {
    constructor(editor) {
        this.editor = editor;
        this.graph = editor.graph;
        this.paper = editor.paper;
        this.classManager = editor.classManager;
        this.relationshipManager = editor.relationshipManager;

        // Mapas para mantener referencia de elementos creados
        this.classMap = new Map(); // xmi.id -> elemento JointJS
        this.relationshipMap = new Map();

        // Contadores para posicionamiento
        this.classPositionX = 100;
        this.classPositionY = 100;
        this.classSpacingX = 280;
        this.classSpacingY = 200;
        this.maxClassesPerRow = 4;
        this.classCount = 0;

        console.log('🔄 SimpleXMIImporter inicializado');
    }

    // ==================== MÉTODO PRINCIPAL DE IMPORTACIÓN ====================

    async importFromXML(xmlContent) {
        try {
            console.log('📁 Iniciando importación de XML/XMI...');

            // Limpiar el diagrama actual
            this.clearDiagram();

            // Parsear el XML
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

            // Verificar si hay errores de parsing
            if (xmlDoc.documentElement.nodeName === 'parsererror') {
                throw new Error('Error al parsear el archivo XML');
            }

            // Se guarda como propiedad de instancia (en vez de pasarlo por
            // parámetro en cada función) para que cualquier método pueda
            // resolver un xmi.idref contra el documento completo sin
            // encadenar el parámetro por 3+ niveles de llamadas — lo usa
            // extractClassAttributes() para resolver el tipo real de un
            // atributo (ver resolveTypeIdToName()).
            this._xmlDoc = xmlDoc;

            // Extraer clases y relaciones
            const classes = this.extractClassesFromXML(xmlDoc);
            const relationships = this.extractRelationshipsFromXML(xmlDoc);
            this.classLayoutMap = this.extractDiagramLayout(xmlDoc);

            console.log(`📊 Clases encontradas: ${classes.length}`);
            console.log(`🔗 Relaciones encontradas: ${relationships.length}`);
            console.log(`📐 Posiciones guardadas encontradas: ${this.classLayoutMap.size}`);

            // Crear clases primero
            await this.createClassesInDiagram(classes);

            // Crear relaciones después
            await this.createRelationshipsInDiagram(relationships);

            // Ajustar vista
            this.adjustDiagramView();

            console.log('✅ Importación completada exitosamente');

            return {
                success: true,
                classesCreated: classes.length,
                relationshipsCreated: relationships.length,
                notes: this.importNotes || [],
                message: `Diagrama importado: ${classes.length} clases y ${relationships.length} relaciones`
            };

        } catch (error) {
            console.error('❌ Error en importación:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ==================== EXTRACCIÓN DE CLASES ====================

    /**
     * Esta app solo soporta el dialecto XMI 1.1 real de Enterprise Architect
     * (ver documentacion/03-generadores-codigo.md §18 sobre por qué se sacó
     * el soporte a XMI 2.1/`packagedElement` con `xmi:type` y a formatos
     * "nativos" viejos de esta misma app) — por eso todo este archivo
     * recorre por tag name (`getElementsByTagName`, que matchea nombres con
     * ":" de forma confiable) los tags reales que usa ese dialecto
     * (`UML:Class`, `UML:Attribute`, `UML:Association`, etc.), en vez de
     * intentar cubrir varios formatos a la vez.
     */
    extractClassesFromXML(xmlDoc) {
        const classes = [];
        const seenIds = new Set();

        const addIfClass = (el) => {
            const info = this.parseClassElement(el);
            if (info && !seenIds.has(info.xmiId)) {
                seenIds.add(info.xmiId);
                classes.push(info);
                console.log(`✅ Clase procesada: ${info.name}`);
            }
        };

        // `UML:Class` y `UML:Interface` (dos tags reales distintos en este
        // dialecto, no un `stereotype` — ver generateClassesXML en
        // simpleXMIExport.js). Antes solo se buscaba `UML:Class`: una
        // interfaz exportada por esta misma app (o por EA) se perdía en
        // silencio al reimportarla. "Clase asociativa" (uml:AssociationClass
        // en XMI2.1) en este dialecto NO es un tag propio — es una
        // `<UML:Class>` normal más — se detecta por el tagged value
        // `associationclass` en su asociación M:N, ver parseAssociation() /
        // documentacion/06-asistente-ia.md §9.4.
        ['UML:Class', 'UML:Interface'].forEach((tagName) => {
            Array.from(xmlDoc.getElementsByTagName(tagName)).forEach(addIfClass);
        });

        return classes;
    }

    parseClassElement(classElement) {
        try {
            // Extraer información básica
            const xmiId = classElement.getAttribute('xmi.id');
            const name = classElement.getAttribute('name');
            const visibility = classElement.getAttribute('visibility') || 'public';
            const isAbstract = classElement.getAttribute('isAbstract') === 'true';

            if (!name || !xmiId) {
                return null; // Clase sin nombre o ID válido
            }

            // Todo archivo XMI real exportado por Enterprise Architect trae,
            // SIEMPRE, este stub interno (`isRoot="true"`, sin atributos, sin
            // namespace de paquete, y sin entrada en <UML:Diagram.element> —
            // ver diagramagimnasioxmi11.xmi / Diagram_Exported_From_EA.xmi
            // línea 12) — es un marcador propio del modelo de EA, nunca un
            // elemento dibujado en ningún diagrama. Antes se importaba como
            // una clase real más (vacía, sin PK/FK) y aparecía como una caja
            // fantasma en el lienzo. Se filtra por nombre + isRoot="true"
            // para no descartar, por las dudas, una clase de usuario que
            // coincidiera de nombre pero no sea el stub de EA.
            if (name === 'EARootClass' && classElement.getAttribute('isRoot') === 'true') {
                return null;
            }

            // Extraer atributos
            const attributes = this.extractClassAttributes(classElement);

            // Extraer métodos/operaciones
            const methods = this.extractClassMethods(classElement);

            // Determinar tipo de clase. "Abstracta" es un MODIFICADOR de una
            // clase (se guarda en uml25.isAbstract, ver createClassElement),
            // no un tercer tipo — antes se guardaba como type: 'abstract',
            // lo que la excluía silenciosamente de todo lo que filtra por
            // umlData.type === 'class' (generadores de código, conteos, etc.)
            // El tag REAL (`UML:Interface` vs `UML:Class`, ver
            // extractClassesFromXML) manda — el estereotipo es un concepto
            // aparte (`<<entity>>`, etc.) que puede convivir con cualquiera
            // de los dos, no es lo que decide si es interfaz.
            let classType = classElement.tagName === 'UML:Interface' ? 'interface' : 'class';

            const stereotype = this.extractStereotype(classElement);
            if (classType !== 'interface' && stereotype && stereotype.toLowerCase().includes('interface')) {
                classType = 'interface';
            }

            console.log(`📝 Clase encontrada: ${name} (${classType})`);

            return {
                xmiId: xmiId,
                name: name,
                type: classType,
                visibility: visibility,
                isAbstract: isAbstract,
                attributes: attributes,
                methods: methods,
                stereotype: stereotype
            };

        } catch (error) {
            console.warn('⚠️ Error procesando clase:', error);
            return null;
        }
    }

    extractClassAttributes(classElement) {
        const attributes = [];

        // `getElementsByTagName`, NO `querySelectorAll`: contra un documento
        // XML con namespace declarado (`xmlns:UML=...`), `querySelectorAll`
        // con un selector de tag escapado (`'UML\\:Attribute'`, con o sin
        // combinador `>`) devuelve SIEMPRE 0 resultados en este entorno —
        // confirmado en vivo, incluso para el selector más simple posible.
        // `getElementsByTagName` sí matchea de forma confiable (mismo
        // gotcha que ya estaba documentado para selectores de ATRIBUTO como
        // `packagedElement[xmi\\:type=...]`, pero acá aplica también a
        // selectores de TAG simples). Las clases no anidan otras clases en
        // este dialecto, así que buscar por todo el subárbol de la clase
        // alcanza sin necesitar acotar explícitamente a `Classifier.feature`.
        const attributeElements = Array.from(classElement.getElementsByTagName('UML:Attribute'));

        attributeElements.forEach(attrElement => {
            const name = attrElement.getAttribute('name');
            const visibility = attrElement.getAttribute('visibility') || 'private';

            if (name) {
                // Extraer tipo. Orden de intentos:
                // 1) `<UML:TaggedValue tag="type" value="..">` — es lo que
                //    Enterprise Architect realmente usa como tipo mostrado/
                //    para codegen; es la fuente de verdad incluso cuando el
                //    idref formal de abajo apunta a un DataType genérico.
                //    Ver generateAttributesXML en simpleXMIExport.js.
                // 2) `<UML:StructuralFeature.type><UML:Classifier
                //    xmi.idref="..">` — se resuelve buscando ESE id en todo
                //    el documento y leyendo su `name`, sin necesitar una
                //    tabla fija de tipos conocidos de antemano.
                let type = this.findTaggedValue(attrElement, 'type');

                if (!type) {
                    const classifier = attrElement.getElementsByTagName('UML:Classifier')[0];
                    const classifierIdref = classifier ? classifier.getAttribute('xmi.idref') : null;
                    if (classifierIdref) {
                        type = this.resolveTypeIdToName(classifierIdref) || this.resolveTypeReference(classifierIdref);
                    }
                }

                type = type || 'String';

                // Formatear según visibilidad UML
                const visibilitySymbol = this.getVisibilitySymbol(visibility);
                const formattedAttribute = `${visibilitySymbol} ${name}: ${type}`;

                attributes.push(formattedAttribute);
                console.log(`   📝 Atributo encontrado: ${formattedAttribute}`);
            }
        });

        return attributes;
    }

    extractClassMethods(classElement) {
        const methods = [];

        // getElementsByTagName, no querySelectorAll — ver el gotcha
        // documentado en extractClassAttributes().
        const operationElements = Array.from(classElement.getElementsByTagName('UML:Operation'));

        operationElements.forEach(opElement => {
            const name = opElement.getAttribute('name');
            const visibility = opElement.getAttribute('visibility') || 'public';

            if (name) {
                // Extraer parámetros si están disponibles
                const parameters = this.extractMethodParameters(opElement);

                // El tipo de retorno viene en un `UML:Parameter[kind="return"]`
                // con su propio `TaggedValue tag="type"` — dialecto real de
                // EA, ver generateMethodsXML en simpleXMIExport.js.
                const returnParam = Array.from(opElement.getElementsByTagName('UML:Parameter'))
                    .find((p) => p.getAttribute('kind') === 'return');
                const returnType = (returnParam ? this.findTaggedValue(returnParam, 'type') : null) || 'void';

                // Formatear método
                const visibilitySymbol = this.getVisibilitySymbol(visibility);
                const paramStr = parameters.length > 0 ? parameters.join(', ') : '';
                const formattedMethod = `${visibilitySymbol} ${name}(${paramStr}): ${returnType}`;

                methods.push(formattedMethod);
                console.log(`   🔧 Método encontrado: ${formattedMethod}`);
            }
        });

        return methods;
    }

    extractMethodParameters(operationElement) {
        const parameters = [];

        const paramElements = Array.from(operationElement.getElementsByTagName('UML:Parameter'));

        paramElements.forEach(paramElement => {
            const name = paramElement.getAttribute('name');
            const kind = paramElement.getAttribute('kind');

            // Filtrar parámetros de retorno
            if (name && kind !== 'return') {
                parameters.push(`${name}: String`); // Tipo simplificado
            }
        });

        return parameters;
    }

    // ==================== EXTRACCIÓN DE RELACIONES ====================

    extractRelationshipsFromXML(xmlDoc) {
        const relationships = [];
        this.importNotes = []; // se lee desde importFromXML() al final

        // Asociaciones (incluye "clase asociativa": en este dialecto no es
        // un tag propio, se detecta por el tagged value `associationclass`
        // dentro de la asociación M:N — ver parseAssociation()).
        Array.from(xmlDoc.getElementsByTagName('UML:Association')).forEach((assoc) => {
            const rel = this.parseAssociation(assoc);
            if (!rel) return;

            relationships.push(rel);
            if (rel.associationClassId) {
                console.log(`✅ Asociación con clase asociativa real procesada: ${rel.sourceClass} -> ${rel.targetClass}, clase "${rel.associationClassId}"`);
            } else {
                console.log(`✅ Relación procesada: ${rel.sourceClass} -> ${rel.targetClass} (${rel.type})`);
            }
        });

        // Herencia.
        Array.from(xmlDoc.getElementsByTagName('UML:Generalization')).forEach((gen) => {
            const rel = this.parseGeneralization(gen);
            if (rel) {
                relationships.push(rel);
                console.log(`✅ Herencia procesada: ${rel.sourceClass} -> ${rel.targetClass}`);
            }
        });

        // Realización (implementa interfaz) y dependencia (usa) — mismo
        // client/supplier, ver generateRealizationsAndDependenciesXML en
        // simpleXMIExport.js.
        Array.from(xmlDoc.getElementsByTagName('UML:Abstraction')).forEach((el) => {
            const rel = this.parseRealizationOrDependency(el, 'realization');
            if (rel) {
                relationships.push(rel);
                console.log(`✅ Realización procesada: ${rel.sourceClass} -> ${rel.targetClass}`);
            }
        });

        Array.from(xmlDoc.getElementsByTagName('UML:Dependency')).forEach((el) => {
            const rel = this.parseRealizationOrDependency(el, 'dependency');
            if (rel) {
                relationships.push(rel);
                console.log(`✅ Dependencia procesada: ${rel.sourceClass} -> ${rel.targetClass}`);
            }
        });

        return relationships;
    }

    /** Realización/Dependencia usan client/supplier en vez de AssociationEnd — sin multiplicidad ni agregación. */
    parseRealizationOrDependency(element, type) {
        try {
            const xmiId = element.getAttribute('xmi.id');
            const name = element.getAttribute('name') || '';
            // client/supplier apuntan al xmi.id completo de la clase (ej.
            // "class_5", ver generateRealizationsAndDependenciesXML) — debe
            // quedar intacto: classMap se indexa por ese mismo xmi.id tal cual.
            const client = element.getAttribute('client') || '';
            const supplier = element.getAttribute('supplier') || '';

            if (!client || !supplier) {
                return null;
            }

            return {
                xmiId: xmiId,
                type: type,
                name: name,
                sourceClass: client,
                targetClass: supplier,
                sourceMultiplicity: '',
                targetMultiplicity: ''
            };
        } catch (error) {
            console.warn(`⚠️ Error procesando ${type}:`, error);
            return null;
        }
    }

    /**
     * Parser de `<UML:Association>` — dialecto XMI 1.1 real de EA
     * (VERIFICADO de punta a punta contra archivos reales, incluyendo el
     * caso de clase asociativa vía el tagged value `associationclass`).
     */
    parseAssociation(assocElement) {
        try {
            const xmiId = assocElement.getAttribute('xmi.id');
            const name = assocElement.getAttribute('name') || '';

            // EA marca una clase asociativa con un
            // <UML:TaggedValue tag="associationclass" value="claseId"/>
            // DENTRO de la asociación normal — no es un elemento propio
            // separado. Si esto viene presente, la asociación source↔target
            // se crea IGUAL (es la asociación M:N real) y además se marca
            // `associationClassId` para que createRelationshipsInDiagram()
            // le cuelgue el link punteado hacia esa clase después.
            const associationClassId = this.findAssociationClassTaggedValue(assocElement);

            // EA marca con `headStyle`/`lineStyle` (dentro de
            // ModelElement.taggedValue) si la asociación se dibuja con
            // flecha o como línea lisa — `"0"` es "sin flecha" (lo que EA
            // llama dirección "Unspecified"), cualquier otro valor es una
            // flecha real. Nuestro propio exportador ya escribe este mismo
            // tag para las asociaciones que genera (ver
            // generateAssociationsXML en simpleXMIExport.js) — así que esto
            // también hace que reimportar un XMI que exportamos nosotros
            // mismos preserve si tenía flecha o no. Si el tag no viene (un
            // XMI de otro origen que no sea EA/esta app), se deja `hideArrow`
            // en `false` — comportamiento de siempre, no se rompe nada para
            // esos archivos.
            const headStyle = this.findTaggedValue(assocElement, 'headStyle');
            const hideArrow = headStyle === '0';

            const associationEnds = assocElement.getElementsByTagName('UML:AssociationEnd');

            if (associationEnds.length !== 2) {
                return null; // Asociación incompleta
            }

            const sourceEnd = associationEnds[0];
            const targetEnd = associationEnds[1];

            // Extraer información de los extremos
            const sourceType = sourceEnd.getAttribute('type');
            const targetType = targetEnd.getAttribute('type');

            // La asociación M:N que sostiene una clase asociativa no trae
            // `multiplicity` en NINGÚN extremo — así lo escribe EA de verdad
            // (confirmado contra un archivo real con clase asociativa) y así
            // la exporta esta misma app (ver `SimpleXMIExporter.generateAssociationsXML()`).
            // El fallback genérico de acá abajo ('1') es para una asociación
            // NORMAL sin multiplicidad explícita — pero para ESTE caso
            // puntual el default correcto es '*' (es una M:N por
            // definición, la clase asociativa lo implica), no '1'.
            const fallbackMultiplicity = associationClassId ? '*' : '1';
            const sourceMultiplicityRaw = sourceEnd.getAttribute('multiplicity');
            const targetMultiplicityRaw = targetEnd.getAttribute('multiplicity');
            const sourceMultiplicity = sourceMultiplicityRaw || fallbackMultiplicity;
            const targetMultiplicity = targetMultiplicityRaw || fallbackMultiplicity;

            // EA tampoco dibuja ninguna etiqueta de multiplicidad sobre esa
            // misma línea (se sobreentiende que es M:N por tener una clase
            // asociativa colgada) — `sourceMultiplicity`/`targetMultiplicity`
            // de arriba siguen siendo '*'/'*' como valor SEMÁNTICO (por si
            // algo los llega a leer), esto solo controla si se muestran como
            // texto sobre la línea en el lienzo. Si el archivo SÍ trae un
            // atributo `multiplicity` explícito (caso raro, no es lo que
            // exporta EA ni esta app), se respeta y se muestra igual.
            const hideMultiplicityLabels = !!(associationClassId && !sourceMultiplicityRaw && !targetMultiplicityRaw);

            // Determinar tipo de relación por agregación
            let relationType = 'association';
            const sourceAggregation = sourceEnd.getAttribute('aggregation');
            const targetAggregation = targetEnd.getAttribute('aggregation');

            if (sourceAggregation === 'composite' || targetAggregation === 'composite') {
                relationType = 'composition';
            } else if (sourceAggregation === 'shared' || targetAggregation === 'shared') {
                relationType = 'aggregation';
            }

            console.log(`🔗 Asociación encontrada: ${sourceType} -> ${targetType} (${relationType})`);

            return {
                xmiId: xmiId,
                type: relationType,
                name: name,
                sourceClass: sourceType,
                targetClass: targetType,
                sourceMultiplicity: sourceMultiplicity,
                targetMultiplicity: targetMultiplicity,
                hideMultiplicityLabels: hideMultiplicityLabels,
                hideArrow: hideArrow,
                ...(associationClassId ? { associationClassId } : {}),
            };

        } catch (error) {
            console.warn('⚠️ Error procesando asociación:', error);
            return null;
        }
    }

    /** El TaggedValue "associationclass" marca que ESTA asociación tiene una clase asociativa colgada — su value es el xmi.id de esa clase. */
    findAssociationClassTaggedValue(assocElement) {
        const taggedValues = assocElement.getElementsByTagName('UML:TaggedValue');
        for (const tv of taggedValues) {
            if (tv.getAttribute('tag') === 'associationclass') {
                return tv.getAttribute('value');
            }
        }
        return null;
    }

    /**
     * Busca CUALQUIER elemento por su `xmi.id` en todo el documento (no solo
     * clases — sirve igual para un `UML:DataType` declarado en un paquete de
     * tipos, como el que genera `simpleXMIExport.js`, o el
     * `EA_PrimitiveTypes_Package` de un .xmi real de EA) y devuelve su
     * `name`. Usado por `extractClassAttributes()` para resolver el tipo
     * real de un atributo a partir de `<UML:Classifier xmi.idref="..">`, sin
     * necesitar una tabla fija de ids conocidos de antemano (a diferencia
     * de `resolveTypeReference()`, que sí depende de una tabla así y queda
     * como último fallback).
     */
    resolveTypeIdToName(xmiId) {
        if (!xmiId || !this._xmlDoc) return null;
        for (const tagName of ['UML:DataType', 'UML:Class', 'UML:Interface']) {
            for (const el of this._xmlDoc.getElementsByTagName(tagName)) {
                if (el.getAttribute('xmi.id') === xmiId) {
                    return el.getAttribute('name');
                }
            }
        }
        return null;
    }

    /** Busca un `<UML:TaggedValue tag="X" value="..">` entre los hijos directos de `ModelElement.taggedValue` de un elemento — usado para leer el "type" real (atributos, retorno de método) en el dialecto XMI 1.1 de EA. */
    findTaggedValue(element, tag) {
        const taggedValues = element.getElementsByTagName('UML:TaggedValue');
        for (const tv of taggedValues) {
            if (tv.getAttribute('tag') === tag) {
                return tv.getAttribute('value');
            }
        }
        return null;
    }

    parseGeneralization(genElement) {
        try {
            const xmiId = genElement.getAttribute('xmi.id');
            const subtype = genElement.getAttribute('subtype');
            const supertype = genElement.getAttribute('supertype');

            if (!subtype || !supertype) {
                return null;
            }

            console.log(`🔗 Herencia encontrada: ${subtype} -> ${supertype}`);

            return {
                xmiId: xmiId,
                type: 'inheritance',
                name: '',
                sourceClass: subtype,
                targetClass: supertype,
                sourceMultiplicity: '',
                targetMultiplicity: ''
            };

        } catch (error) {
            console.warn('⚠️ Error procesando generalización:', error);
            return null;
        }
    }

    // ==================== CREACIÓN EN EL DIAGRAMA ====================

    async createClassesInDiagram(classes) {
        console.log('🏗️ Creando clases en el diagrama...');

        for (let i = 0; i < classes.length; i++) {
            const classInfo = classes[i];
            const savedPosition = this.classLayoutMap?.get(classInfo.xmiId);
            const position = savedPosition || this.calculateClassPosition(i);

            // Crear elemento usando ClassManager
            const element = this.createClassElement(classInfo, position.x, position.y);

            if (element) {
                if (savedPosition) {
                    // classLayout (ver extractDiagramLayout) guarda la
                    // esquina superior-izquierda tal cual la escribió
                    // simpleXMIExport.js (element.position()) — pero
                    // createClassElement(x,y) interpreta su x,y como el
                    // CENTRO del rectángulo (ver DiagramElementFactory), así
                    // que se corrige acá, ya con las dimensiones reales
                    // calculadas, en vez de tratar de adivinarlas antes.
                    element.position(savedPosition.x, savedPosition.y);
                }

                // Guardar referencia
                this.classMap.set(classInfo.xmiId, element);
                console.log(`✅ Clase creada: ${classInfo.name} en posición (${position.x}, ${position.y})${savedPosition ? ' [layout guardado]' : ''}`);
            }

            // Pequeña pausa para evitar problemas de rendering
            await this.delay(50);
        }
    }

    /**
     * Lee las posiciones desde `<UML:DiagramElement geometry="Left=X;Top=Y;..."
     * subject="claseId">` dentro de `<UML:Diagram>` — dialecto XMI 1.1 real
     * de EA, y la ÚNICA fuente de posición que escribe `generateDiagramXML`
     * en `simpleXMIExport.js`. Un archivo que no trae `<UML:Diagram>` (poco
     * probable viniendo de EA o de esta app, pero posible con un XMI
     * recortado a mano) simplemente no aporta ninguna posición acá, y el
     * import sigue usando el grid automático como fallback
     * (`calculateClassPosition`).
     */
    extractDiagramLayout(xmlDoc) {
        const layout = new Map();
        Array.from(xmlDoc.getElementsByTagName('UML:DiagramElement')).forEach((el) => {
            const subject = el.getAttribute('subject');
            if (!subject) return;
            const geometry = el.getAttribute('geometry') || '';
            const left = geometry.match(/Left=(-?\d+)/);
            const top = geometry.match(/Top=(-?\d+)/);
            if (left && top) {
                layout.set(subject, { x: parseFloat(left[1]), y: parseFloat(top[1]) });
            }
        });

        return layout;
    }

    createClassElement(classInfo, x, y) {
        try {
            // Usar la factory del DiagramElementFactory
            const element = this.classManager.elementFactory.createClassElement(
                classInfo.name,
                classInfo.attributes,
                classInfo.methods,
                x,
                y,
                classInfo.type,
                this.graph
            );

            // Configurar datos UML adicionales. isAbstract va anidado en
            // uml25 (igual que el resto de la notación UML 2.5: derivados,
            // responsabilidades, etc.) para que DiagramElementFactory lo
            // renderice (nombre de clase en cursiva) y los generadores de
            // código lo lean — antes se guardaba suelto y nada lo leía.
            element.set('umlData', {
                className: classInfo.name,
                type: classInfo.type,
                attributes: classInfo.attributes,
                methods: classInfo.methods,
                visibility: classInfo.visibility,
                stereotype: classInfo.stereotype,
                ...(classInfo.isAbstract ? { uml25: { isAbstract: true } } : {})
            });

            return element;

        } catch (error) {
            console.error(`❌ Error creando clase ${classInfo.name}:`, error);
            return null;
        }
    }

    async createRelationshipsInDiagram(relationships) {
        console.log('🔗 Creando relaciones en el diagrama...');

        for (const relInfo of relationships) {
            // Buscar elementos source y target
            const sourceElement = this.findElementByXmiId(relInfo.sourceClass);
            const targetElement = this.findElementByXmiId(relInfo.targetClass);

            if (sourceElement && targetElement) {
                const relationship = this.createRelationshipElement(relInfo, sourceElement, targetElement);

                if (relationship) {
                    this.relationshipMap.set(relInfo.xmiId, relationship);
                    console.log(`✅ Relación creada: ${relInfo.type} entre ${relInfo.sourceClass} y ${relInfo.targetClass}`);
                }
            } else {
                console.warn(`⚠️ No se encontraron elementos para la relación: ${relInfo.sourceClass} -> ${relInfo.targetClass}`);
            }

            await this.delay(50);
        }

        // Segunda pasada: clases asociativas reales (`associationClassId`,
        // ver parseAssociation()) — necesitan
        // que la asociación M:N a la que se cuelgan ya exista como link real
        // en el graph (recién creada arriba), así que van después de todas
        // las relaciones normales.
        for (const relInfo of relationships) {
            if (!relInfo.associationClassId) continue;

            const classElement = this.findElementByXmiId(relInfo.associationClassId);
            const hostLink = this.relationshipMap.get(relInfo.xmiId);

            if (!classElement || !hostLink) {
                console.warn(`⚠️ No se pudo conectar la clase asociativa "${relInfo.associationClassId}" — falta la clase o la asociación.`);
                continue;
            }

            this.relationshipManager.createRelationshipFromConfig('associationClassLink', classElement, hostLink, {});
            console.log(`✅ Clase asociativa conectada: "${relInfo.associationClassId}" -> asociación ${relInfo.sourceClass}↔${relInfo.targetClass}`);
        }
    }

    createRelationshipElement(relInfo, sourceElement, targetElement) {
        try {
            // Configuración de la relación. `hideMultiplicityLabels` solo
            // afecta el TEXTO sobre la línea (relInfo.sourceMultiplicity ya
            // sigue siendo '*'/'*' como valor semántico, ver parseAssociation) —
            // los generadores de backend no leen esta multiplicidad para el
            // caso de clase asociativa (van por associationClassId/associationClassTable),
            // así que ocultar el label acá no les afecta.
            const config = {
                sourceMultiplicity: relInfo.hideMultiplicityLabels ? '' : relInfo.sourceMultiplicity,
                targetMultiplicity: relInfo.hideMultiplicityLabels ? '' : relInfo.targetMultiplicity,
                name: relInfo.name,
                sourceAnchor: 'auto',
                targetAnchor: 'auto',
                hideArrow: relInfo.hideArrow
            };

            // Crear relación usando RelationshipManager
            const relationship = this.relationshipManager.createRelationshipFromConfig(
                relInfo.type,
                sourceElement,
                targetElement,
                config
            );

            return relationship;

        } catch (error) {
            console.error(`❌ Error creando relación ${relInfo.type}:`, error);
            return null;
        }
    }

    // ==================== MÉTODOS UTILITARIOS ====================

    clearDiagram() {
        console.log('🧹 Limpiando diagrama actual...');
        this.graph.clear();
        this.classMap.clear();
        this.relationshipMap.clear();
        this.classLayoutMap = null;
        this.classCount = 0;
    }

    calculateClassPosition(index) {
        const row = Math.floor(index / this.maxClassesPerRow);
        const col = index % this.maxClassesPerRow;

        return {
            x: this.classPositionX + (col * this.classSpacingX),
            y: this.classPositionY + (row * this.classSpacingY)
        };
    }

    findElementByXmiId(xmiId) {
        // Primero buscar en el mapa de clases
        if (this.classMap.has(xmiId)) {
            return this.classMap.get(xmiId);
        }

        // Buscar por nombre de clase si no encuentra por ID
        for (const [id, element] of this.classMap.entries()) {
            const umlData = element.get('umlData');
            if (umlData && umlData.className === xmiId) {
                return element;
            }
        }

        return null;
    }

    getVisibilitySymbol(visibility) {
        const symbols = {
            'public': '+',
            'private': '-',
            'protected': '#',
            'package': '~'
        };
        return symbols[visibility] || '+';
    }

    resolveTypeReference(typeRef) {
        // Mapeo de tipos básicos XMI a tipos Java
        const typeMap = {
            'eaxmiid0': 'String',
            'string': 'String',
            'String': 'String',
            'int': 'int',
            'Integer': 'Integer',
            'boolean': 'boolean',
            'Boolean': 'Boolean',
            'double': 'double',
            'Double': 'Double',
            'long': 'long',
            'Long': 'Long',
            'Date': 'Date',
            'LocalDateTime': 'LocalDateTime',
            'BigDecimal': 'BigDecimal'
        };

        return typeMap[typeRef] || 'String';
    }

    extractStereotype(classElement) {
        // Solo el tag "stereotype" real. "ea_stype" NO es un estereotipo UML
        // — es metadata interna de EA sobre el TIPO de elemento ("Class",
        // "Interface", etc.) que EA agrega a CUALQUIER clase real exportada;
        // antes se leía también ese tag, así que TODA clase importada desde
        // un archivo real de EA (ea_stype="Class") terminaba con un falso
        // estereotipo «Class» visible en el diagrama — bug descubierto acá,
        // sin relación con el resto de este cambio, pero en el mismo código.
        return this.findTaggedValue(classElement, 'stereotype');
    }

    adjustDiagramView() {
        console.log('🔍 Ajustando vista del diagrama...');

        // Centrar y ajustar zoom si hay elementos
        if (this.graph.getElements().length > 0) {
            try {
                // Obtener bounding box de todos los elementos
                const bbox = this.graph.getBBox(this.graph.getElements());

                if (bbox) {
                    // Ajustar el paper para mostrar todos los elementos
                    this.paper.scaleContentToFit({
                        padding: 50,
                        maxScale: 1,
                        minScale: 0.2
                    });

                    // Centrar la vista
                    this.paper.center();
                }
            } catch (error) {
                console.warn('⚠️ No se pudo ajustar la vista automáticamente:', error);
            }
        }

        // Actualizar información del canvas
        if (this.editor.updateCanvasInfo) {
            this.editor.updateCanvasInfo();
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== MÉTODO PÚBLICO PARA ARCHIVOS ====================

    async importFromFile(file) {
        try {
            console.log(`📂 Importando archivo: ${file.name}`);

            // Validar tipo de archivo
            if (!this.isValidXMLFile(file)) {
                throw new Error('El archivo debe ser un archivo XML válido (.xml, .xmi, .uml)');
            }

            // Leer contenido del archivo
            const content = await this.readFileContent(file);

            // Importar desde contenido XML
            return await this.importFromXML(content);

        } catch (error) {
            console.error('❌ Error importando archivo:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    isValidXMLFile(file) {
        const validExtensions = ['.xml', '.xmi', '.uml'];
        const fileName = file.name.toLowerCase();

        return validExtensions.some(ext => fileName.endsWith(ext));
    }

    readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                resolve(e.target.result);
            };

            reader.onerror = (e) => {
                reject(new Error('Error leyendo el archivo'));
            };

            reader.readAsText(file, 'UTF-8');
        });
    }

    // ==================== INFORMACIÓN DE ESTADO ====================

    getImportStatistics() {
        return {
            classesImported: this.classMap.size,
            relationshipsImported: this.relationshipMap.size,
            totalElements: this.graph.getElements().length,
            totalLinks: this.graph.getLinks().length
        };
    }
}
