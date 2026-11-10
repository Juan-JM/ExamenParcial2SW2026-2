// resources/js/diagram/utils/simpleImageImport.js
// Importador de diagramas UML desde imágenes — analiza la imagen en el
// backend propio (ver documentacion/06-asistente-ia.md §9), que rota entre
// el modelo local con visión. Ya no llama a ningún proveedor directo
// desde el navegador.

import * as joint from 'jointjs';

export class SimpleImageImporter {
    constructor(editor) {
        this.editor = editor;
        this.graph = editor.graph;
        this.paper = editor.paper;
        this.classManager = editor.classManager;
        this.relationshipManager = editor.relationshipManager;
        // Reusa el mismo buscador de huecos libres que ya usa CREATE_CLASS/
        // MOVE_CLASS del chat de comandos de IA (ver AICommandExecutor.js) —
        // en vez de duplicar la lógica de "esquivar clases ya dibujadas",
        // se apoya en la misma que ya está probada ahí. `editor.aiChat` ya
        // existe para cuando se construye este importador (ver el orden en
        // `editor.js::init()`).
        this.positionFinder = editor.aiChat?.commandExecutor || null;

        // Configuración de procesamiento
        this.maxImageSize = 5 * 1024 * 1024; // 5MB
        this.supportedFormats = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

        // Contadores para posicionamiento automático (fallback sin grilla)
        this.classPositionX = 100;
        this.classPositionY = 100;
        this.classSpacingX = 280;
        this.classSpacingY = 200;
        this.maxClassesPerRow = 4;
        this.classCount = 0;

        // Tamaño de celda para "gridRow"/"gridCol" (ver applyGridPosition) —
        // generoso a propósito: el router de relaciones dibuja un rulito
        // espurio si dos clases conectadas quedan a menos de ~80px de
        // distancia entre bordes (ver 06-asistente-ia.md §9.7.1). Con estos
        // tamaños de celda, incluso una clase inusualmente grande (varios
        // atributos) deja margen de sobra contra su vecina.
        this.gridColWidth = 380;
        this.gridRowHeight = 300;
        this.gridOffsetX = 100;
        this.gridOffsetY = 100;

        console.log('📷 SimpleImageImporter inicializado');
    }

    // ==================== MÉTODO PRINCIPAL DE IMPORTACIÓN ====================

    async importFromImage(imageFile) {
        try {
            console.log('📷 Iniciando importación desde imagen...');

            if (!window.aiAssistant?.enabled || !window.aiAssistant?.importImageUrl) {
                throw new Error('El asistente de IA no está disponible para este diagrama.');
            }

            this.validateImageFile(imageFile);

            // Analizar imagen con el backend (modelo local con visión)
            const diagramData = await this.analyzeImageWithBackend(imageFile);

            // Procesar respuesta y crear elementos
            const importResult = await this.processAnalysisResult(diagramData);

            console.log('✅ Importación de imagen completada:', importResult);

            return {
                success: true,
                classesCreated: importResult.classesCreated || 0,
                classesUpdated: importResult.classesUpdated || 0,
                relationshipsCreated: importResult.relationshipsCreated || 0,
                relationshipsUpdated: importResult.relationshipsUpdated || 0,
                notes: importResult.notes || [],
                message: 'Diagrama importado exitosamente desde imagen'
            };

        } catch (error) {
            console.error('❌ Error en importación de imagen:', error);
            return {
                success: false,
                error: error.message,
                classesCreated: 0,
                relationshipsCreated: 0
            };
        }
    }

    // ==================== VALIDACIONES ====================

    validateImageFile(file) {
        if (!file) {
            throw new Error('No se seleccionó ningún archivo');
        }

        if (!this.supportedFormats.includes(file.type)) {
            throw new Error('Formato de imagen no soportado. Use: JPG, PNG o WebP');
        }

        if (file.size > this.maxImageSize) {
            throw new Error('La imagen es demasiado grande. Máximo: 5MB');
        }

        console.log('✅ Archivo validado:', {
            name: file.name,
            type: file.type,
            size: `${(file.size / 1024 / 1024).toFixed(2)}MB`
        });
    }

    // ==================== ANÁLISIS EN EL BACKEND ====================

    /**
     * Reduce la imagen a un máximo de 1600 px (respetando la orientación EXIF)
     * y la convierte a JPEG. Si el navegador no puede, devuelve el archivo original.
     */
    async prepareImageForModel(file, maxSide = 1600) {
        try {
            const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
            const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
            const w = Math.max(1, Math.round(bitmap.width * scale));
            const h = Math.max(1, Math.round(bitmap.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(bitmap, 0, 0, w, h);
            bitmap.close?.();
            const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
            if (!blob) return file;
            console.log(`🖼️ Imagen reducida a ${w}x${h} (${(blob.size / 1024).toFixed(0)}KB)`);
            return new File([blob], 'diagrama.jpg', { type: 'image/jpeg' });
        } catch (e) {
            console.warn('No se pudo reducir la imagen, se envía original:', e);
            return file;
        }
    }

    async analyzeImageWithBackend(imageFile) {
        console.log('🤖 Enviando imagen al asistente de IA...');

        // Las fotos del celular (4000+ px) no las procesa el modelo local
        // ("The image failed to upload"): se reducen y recomprimen aquí.
        const prepared = await this.prepareImageForModel(imageFile);
        const formData = new FormData();
        formData.append('image', prepared, prepared.name || 'diagrama.jpg');

        let response;
        try {
            response = await fetch(window.aiAssistant.importImageUrl, {
                method: 'POST',
                headers: {
                    'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '',
                    Accept: 'application/json',
                },
                body: formData,
            });
        } catch (networkError) {
            throw new Error('No se pudo conectar con el asistente de IA (revisá tu conexión).');
        }

        let body = null;
        try { body = await response.json(); } catch { /* sin cuerpo JSON */ }

        if (!response.ok) {
            if (response.status === 503 && body?.retryAfterSeconds !== undefined) {
                const secs = body.retryAfterSeconds;
                throw new Error(secs > 0
                    ? `El modelo local no respondió. Probá de nuevo en ~${secs}s.`
                    : 'El modelo local no está disponible. Abre LM Studio u Ollama con un modelo con visión cargado.');
            }
            throw new Error(body?.message || 'No se pudo analizar la imagen.');
        }

        console.log('✅ Respuesta del asistente de IA recibida');
        return body;
    }

    // ==================== PROCESAMIENTO DE RESULTADOS ====================

    async processAnalysisResult(diagramData) {
        try {
            if (!diagramData || !Array.isArray(diagramData.classes)) {
                throw new Error('Estructura de respuesta inválida: falta array de clases');
            }

            console.log('📊 Datos extraídos de la imagen:', diagramData);

            // Limpiar diagrama actual (opcional)
            // this.graph.clear();

            // Crear/actualizar clases — ver createClassesFromData: si ya
            // existe una clase con el mismo nombre en el diagrama, se
            // EDITA (atributos/métodos se pisan con lo que trae la imagen)
            // en vez de crear una duplicada.
            const classesResult = await this.createClassesFromData(diagramData.classes);

            // Crear/actualizar relaciones (mismo criterio: si ya existe una
            // relación entre las mismas dos clases, se actualiza en vez de
            // duplicarse).
            let relationshipsResult = { created: 0, updated: 0 };
            if (diagramData.relationships && Array.isArray(diagramData.relationships)) {
                relationshipsResult = await this.createRelationshipsFromData(diagramData.relationships, classesResult.classes);
            }

            return {
                classesCreated: classesResult.created,
                classesUpdated: classesResult.updated,
                relationshipsCreated: relationshipsResult.created,
                relationshipsUpdated: relationshipsResult.updated,
                notes: Array.isArray(diagramData.notes) ? diagramData.notes : [],
            };

        } catch (error) {
            console.error('❌ Error procesando resultado de análisis:', error);
            throw error;
        }
    }

    // ==================== CREACIÓN DE ELEMENTOS ====================

    /**
     * Crea O EDITA clases según lo que ya haya en el diagrama: si ya existe
     * una clase con el MISMO NOMBRE (comparación case-insensitive), se
     * actualiza con lo que trae la imagen — atributos y métodos se PISAN por
     * completo, no se mergean — en vez de crear una duplicada. Decisión
     * explícita del usuario: reimportar una imagen sobre un diagrama que ya
     * tiene esas clases debe EDITARLAS, no clonarlas.
     *
     * @return {{ created: number, updated: number, classes: Array<{name: string, element: object, data: object}> }}
     */
    async createClassesFromData(classesData) {
        const resultClasses = [];
        let created = 0;
        let updated = 0;

        const existingByName = new Map();
        let existingClassCount = 0;
        this.graph.getElements().forEach((el) => {
            const umlData = el.get('umlData');
            if (umlData?.className) {
                existingByName.set(umlData.className.trim().toLowerCase(), el);
                existingClassCount++;
            }
        });
        // Arrancar el auto-layout de clases NUEVAS después de lo que ya
        // había en el diagrama, para no amontonarlas todas en el mismo
        // punto (100,100) encima de clases preexistentes — antes esto no
        // importaba porque el import siempre partía de un diagrama vacío o
        // simplemente sumaba de más; ahora que reimportar sobre un diagrama
        // ya poblado es un caso esperado (ver modo edición), hace falta.
        this.classCount = existingClassCount;

        for (const classData of classesData) {
            try {
                const name = classData.name || 'UnnamedClass';
                const attributes = classData.attributes || [];
                const methods = classData.methods || [];
                const type = classData.type || 'class';
                const existing = existingByName.get(name.trim().toLowerCase());

                let element;
                if (existing) {
                    // classManager.updateClassElement() fuerza el repintado
                    // y difunde el cambio a otros colaboradores (ver el
                    // mismo comentario en AICommandExecutor). Se preserva la
                    // config UML 2.5 (estereotipo, etc.) que ya tuviera —
                    // la imagen no trae esa información, no hay que perderla.
                    const currentUmlData = existing.get('umlData') || {};
                    this.classManager.updateClassElement(existing, name, attributes, methods, type, currentUmlData.uml25 || null);
                    element = existing;
                    updated++;
                    console.log(`✏️ Clase actualizada desde imagen: ${name}`);

                    // Pedido explícito del usuario: si la imagen ubica esta
                    // clase en otra celda de la grilla (ej. "estaba a la
                    // izquierda, ahora la imagen la muestra a la derecha"),
                    // reubicarla también — antes una clase que YA existía
                    // nunca se movía al reimportar, solo se le pisaban
                    // atributos/métodos, y el layout del lienzo podía
                    // terminar sin relación con el de la imagen nueva.
                    this.applyGridPosition(element, classData);
                } else {
                    // Posición PROVISORIA (fallback por contador) — recién
                    // se corrige a su celda de grilla DESPUÉS de creado el
                    // elemento (no antes) para no depender de una ESTIMACIÓN
                    // de tamaño: `applyGridPosition()` ya deja margen fijo de
                    // sobra entre celdas, así que en la práctica no importa
                    // tanto como con el viejo esquema "near" (que sí
                    // necesitaba el tamaño real para calcular el hueco
                    // exacto) — pero mantener el mismo orden (crear, después
                    // reposicionar) evita tener que duplicar el cálculo.
                    const provisional = this.calculateClassPosition();
                    element = this.classManager.elementFactory.createClassElement(
                        name, attributes, methods, provisional.x, provisional.y, type, this.graph, null,
                    );
                    this.classManager.updateClassElement(element, name, attributes, methods, type, null);
                    created++;
                    console.log(`✅ Clase creada desde imagen: ${name}`);

                    this.applyGridPosition(element, classData);
                }

                resultClasses.push({ name, element, data: classData });

            } catch (error) {
                console.error(`❌ Error procesando clase ${classData.name}:`, error);
            }
        }

        this.editor.updateCanvasInfo();

        return { created, updated, classes: resultClasses };
    }

    /**
     * Busca una relación YA EXISTENTE entre dos elementos (en cualquier
     * dirección), sin importar el tipo — para poder EDITARLA en vez de
     * duplicarla si la imagen trae una multiplicidad/nombre/tipo distinto.
     * Ignora los links "clase asociativa" (su target es otra relación, no
     * una clase — nunca son lo que se busca acá).
     */
    findExistingLinkBetween(elementA, elementB) {
        const links = this.graph.getLinks();
        for (const link of links) {
            if ((link.get('relationData') || {}).type === 'associationClassLink') continue;

            const src = link.getSourceElement();
            const tgt = link.getTargetElement();
            if (!src || !tgt) continue;

            if (src.id === elementA.id && tgt.id === elementB.id) return { link, reversed: false };
            if (src.id === elementB.id && tgt.id === elementA.id) return { link, reversed: true };
        }
        return null;
    }

    /**
     * Actualiza una relación existente (tipo, multiplicidades, nombre). Si
     * `reversed` es true, la relación existente está al revés respecto a lo
     * que dice la imagen (source/target intercambiados) — se intercambian
     * las multiplicidades para que sigan correspondiendo al lado correcto.
     *
     * BUG REAL encontrado y arreglado (reportado por el usuario: relaciones
     * que quedaban "tiesas" — no volvían a seguir a la clase conectada
     * cuando se la arrastraba, hasta recargar la página): mutar el `link` YA
     * RENDERIZADO con `.set('attrs', ...)` (necesario cuando la relación
     * CAMBIA DE TIPO — asociación → composición, etc. — para que los
     * marcadores/flecha correspondan al nuevo tipo) deja a la `LinkView` sin
     * volver a reaccionar NUNCA MÁS a que se mueva la clase conectada —
     * confirmado en vivo con drags reales: after `.set('attrs', ...)`, ni
     * `paper.findViewByModel(link)?.render()` (el fix ya usado para el caso
     * PARECIDO de `DiagramCollaborationManager.applyRelationshipUpdate()`,
     * que NUNCA toca `attrs`, por eso ese otro camino no tiene este bug) ni
     * `.update()` looks devuelven la conexión a la normalidad — solo un
     * reload completo (que reconstruye toda vista desde cero) la arregla,
     * exactamente lo que reportó el usuario. La única forma confirmada de
     * arreglarlo sin reload es TIRAR el link viejo y crear uno nuevo desde
     * cero con los mismos datos (mismo `id`, así cualquier referencia por id
     * — ej. un `associationClassLink` colgado de este link como host — se
     * sigue resolviendo bien) — eso sí fuerza a JointJS a rearmar la
     * conexión con el ciclo de vida normal de un link recién creado.
     */
    updateExistingLink(link, relationshipType, sourceMultiplicity, targetMultiplicity, name, reversed) {
        const finalSourceMultiplicity = reversed ? targetMultiplicity : sourceMultiplicity;
        const finalTargetMultiplicity = reversed ? sourceMultiplicity : targetMultiplicity;

        const labels = this.relationshipManager.createRelationLabelsImproved(finalSourceMultiplicity, finalTargetMultiplicity, name);
        const relationData = {
            ...(link.get('relationData') || {}),
            type: relationshipType,
            sourceMultiplicity: finalSourceMultiplicity,
            targetMultiplicity: finalTargetMultiplicity,
            name: name || '',
        };
        const attrs = this.classManager.elementFactory.getRelationshipAttrs(relationshipType);
        // Mismo gotcha que en DiagramSaveManager.recreateLink(): `hideArrow`
        // (asociación importada de un XMI sin flecha) es un override por
        // instancia que no depende del `type`, y `relationData` de acá arriba
        // sí lo conserva (hace spread del relationData viejo) — pero hay que
        // reaplicarlo a `attrs` explícitamente, si no se pierde apenas esta
        // relación se toca por un reimport de imagen.
        if (relationData.hideArrow) {
            attrs.line.targetMarker = null;
        }

        const rebuilt = new joint.shapes.standard.Link({
            id: link.id,
            source: link.get('source'),
            target: link.get('target'),
            vertices: link.get('vertices') || [],
            z: link.get('z'),
            attrs,
            labels,
            relationData,
        });

        link.remove();
        this.graph.addCell(rebuilt);

        this.editor.webSocketManager?.broadcastDiagramUpdate({
            type: 'relationship_updated',
            data: { linkId: rebuilt.id, labels, relationData },
        });
    }

    /**
     * @param {Array} relationshipsData
     * @param {Array<{name: string, element: object}>} allClasses Clases YA
     *   resueltas (creadas o editadas) por createClassesFromData — incluye
     *   tanto las nuevas de este import como las que ya existían y se
     *   editaron, así una relación puede conectar cualquier combinación.
     * @return {{ created: number, updated: number }}
     */
    async createRelationshipsFromData(relationshipsData, allClasses) {
        let created = 0;
        let updated = 0;

        const classMap = new Map();
        allClasses.forEach(cls => {
            classMap.set(cls.name.trim().toLowerCase(), cls.element);
        });

        // Las relaciones "clase asociativa" se procesan en una segunda
        // pasada, después de TODAS las demás — necesitan que la asociación
        // M:N a la que se cuelgan ya exista en el graph (recién creada en
        // este mismo lote, o ya estaba antes).
        const associationClassLinkRels = relationshipsData.filter(r => r.type === 'associationClassLink');
        // Una clase asociativa solo se conecta con su línea punteada: el modelo
        // a veces le inventa herencia/asociaciones hacia las clases del host.
        const assocClassNames = new Set(associationClassLinkRels.map(r => (r.from || '').trim().toLowerCase()));
        const normalRels = relationshipsData.filter(r =>
            r.type !== 'associationClassLink'
            && !assocClassNames.has((r.from || '').trim().toLowerCase())
            && !assocClassNames.has((r.to || '').trim().toLowerCase())
        );

        for (const relData of normalRels) {
            try {
                const sourceElement = classMap.get((relData.from || '').trim().toLowerCase());
                const targetElement = classMap.get((relData.to || '').trim().toLowerCase());

                if (!sourceElement || !targetElement) {
                    console.warn(`⚠️ Relación ignorada: ${relData.from} -> ${relData.to} (clases no encontradas)`);
                    continue;
                }

                const relationshipType = this.mapRelationshipType(relData.type);
                const existing = this.findExistingLinkBetween(sourceElement, targetElement);

                if (existing) {
                    this.updateExistingLink(
                        existing.link, relationshipType,
                        relData.sourceMultiplicity || '', relData.targetMultiplicity || '',
                        relData.label || '', existing.reversed,
                    );
                    updated++;
                    console.log(`✏️ Relación actualizada: ${relData.from} -> ${relData.to} (${relData.type})`);
                    continue;
                }

                const config = {
                    sourceMultiplicity: relData.sourceMultiplicity || '',
                    targetMultiplicity: relData.targetMultiplicity || '',
                    relationName: relData.label || '',
                    sourceAnchor: 'auto',
                    targetAnchor: 'auto'
                };

                this.relationshipManager.createRelationshipFromConfig(
                    relationshipType,
                    sourceElement,
                    targetElement,
                    config
                );

                // createRelationshipFromConfig() no difunde por su cuenta
                // (ver el comentario en AICommandExecutor.executeCreateRelation) —
                // hay que avisarle a los demás colaboradores desde acá.
                this.editor.webSocketManager?.broadcastDiagramUpdate({
                    type: 'relationship_created',
                    data: { sourceId: sourceElement.id, targetId: targetElement.id, relationshipType, config },
                });

                created++;
                console.log(`✅ Relación creada: ${relData.from} -> ${relData.to} (${relData.type})`);

            } catch (error) {
                console.error(`❌ Error procesando relación ${relData.from} -> ${relData.to}:`, error);
            }
        }

        for (const relData of associationClassLinkRels) {
            try {
                const classEl = classMap.get((relData.from || '').trim().toLowerCase());
                const hostA = classMap.get((relData.to || '').trim().toLowerCase());
                const hostB = classMap.get((relData.viaTargetClass || '').trim().toLowerCase());

                if (!classEl || !hostA || !hostB) {
                    console.warn(`⚠️ Clase asociativa ignorada: ${relData.from} (clases no encontradas)`);
                    continue;
                }

                let hostLinkInfo = this.findExistingLinkBetween(hostA, hostB);
                if (!hostLinkInfo) {
                    // La imagen muestra la asociación M:N (línea sin símbolos) pero el
                    // modelo no la listó: se crea, es lo que la clase asociativa necesita.
                    const hostConfig = { sourceMultiplicity: '*', targetMultiplicity: '*', relationName: '', sourceAnchor: 'auto', targetAnchor: 'auto' };
                    const hostLink = this.relationshipManager.createRelationshipFromConfig('association', hostA, hostB, hostConfig);
                    if (!hostLink) {
                        console.warn(`⚠️ Clase asociativa ignorada: no hay asociación entre "${relData.to}" y "${relData.viaTargetClass}"`);
                        continue;
                    }
                    this.editor.webSocketManager?.broadcastDiagramUpdate({
                        type: 'relationship_created',
                        data: { sourceId: hostA.id, targetId: hostB.id, relationshipType: 'association', config: hostConfig },
                    });
                    created++;
                    hostLinkInfo = { link: hostLink, reversed: false };
                }

                const alreadyAttached = this.graph.getLinks().some((l) =>
                    (l.get('relationData') || {}).type === 'associationClassLink' && l.get('target')?.id === hostLinkInfo.link.id
                );
                if (alreadyAttached) {
                    console.log(`↷ "${relData.to}"↔"${relData.viaTargetClass}" ya tenía una clase asociativa conectada — no se duplica.`);
                    continue;
                }

                this.relationshipManager.createRelationshipFromConfig('associationClassLink', classEl, hostLinkInfo.link, {});

                this.editor.webSocketManager?.broadcastDiagramUpdate({
                    type: 'relationship_created',
                    data: { sourceId: classEl.id, targetId: hostLinkInfo.link.id, relationshipType: 'associationClassLink', config: {} },
                });

                created++;
                console.log(`✅ Clase asociativa conectada: ${relData.from}`);

            } catch (error) {
                console.error(`❌ Error creando clase asociativa ${relData.from}:`, error);
            }
        }

        return { created, updated };
    }

    // ==================== UTILIDADES ====================

    /**
     * Fallback puro por contador — se usa para la posición PROVISORIA de
     * una clase nueva (después se corrige con `applyGridPosition` si trae
     * `gridRow`/`gridCol`) y para cualquier clase que no traiga esos campos.
     */
    calculateClassPosition() {
        const row = Math.floor(this.classCount / this.maxClassesPerRow);
        const col = this.classCount % this.maxClassesPerRow;

        const x = this.classPositionX + (col * this.classSpacingX);
        const y = this.classPositionY + (row * this.classSpacingY);

        this.classCount++;

        return { x, y };
    }

    /**
     * Ubica (o reubica) `element` según `classData.gridRow`/`gridCol` — una
     * celda de grilla imaginaria que la IA de visión asigna por clase (ver
     * `DiagramAiPromptBuilder::buildImageImportPrompt()`).
     *
     * Historia: el primer intento (documentado en `06-asistente-ia.md`
     * §9.6/§9.7) pedía "near"+"direction" (ubicar cada clase pegada a UNA
     * sola clase de referencia ya lista) — funcionaba para evitar
     * superposiciones, pero solo podía expresar una cadena lineal de
     * vecindad, no un layout 2D real: el resultado se veía como un
     * "patrón" (una fila/columna prolija) en vez de parecerse a la imagen
     * original. Pedido explícito del usuario: más libertad para que cada
     * clase termine donde la imagen realmente la muestra. Una coordenada de
     * grilla (fila/columna INDEPENDIENTE por clase, sin depender de otra ya
     * ubicada) es lo que permite eso, y sigue siendo algo que un modelo de
     * visión puede estimar razonablemente (a diferencia de píxeles exactos).
     *
     * El tamaño de celda (`this.gridColWidth/gridRowHeight`) ya deja margen
     * de sobra para el router (ver §9.7.1) — como red de seguridad extra,
     * si la celda calculada choca igual con algo ya ubicado (dos clases con
     * la misma celda por error del modelo, o una clase mucho más grande de
     * lo normal desbordando la suya), se cae al buscador de huecos libres
     * ya probado (`this.positionFinder`) en vez de dejarlas superpuestas —
     * en ese caso puntual el resultado ya no coincide con la grilla pedida,
     * pero es preferible a una superposición real.
     */
    applyGridPosition(element, classData) {
        const hasGrid = Number.isFinite(classData.gridRow) || Number.isFinite(classData.gridCol);
        if (!hasGrid) return;

        const row = Number.isFinite(classData.gridRow) ? classData.gridRow : 0;
        const col = Number.isFinite(classData.gridCol) ? classData.gridCol : 0;

        let x = this.gridOffsetX + col * this.gridColWidth;
        let y = this.gridOffsetY + row * this.gridRowHeight;

        if (this.positionFinder) {
            const size = element.size();
            const overlap = this.positionFinder.findOverlappingElement(x, y, size.width, size.height, element.id);
            if (overlap) {
                const fallback = this.positionFinder.findFreeTopLeftPosition(null, element.id, 'right', size);
                x = fallback.x;
                y = fallback.y;
            }
        }

        const current = element.position();
        if (Math.abs(current.x - x) < 1 && Math.abs(current.y - y) < 1) return;

        element.position(x, y);
        this.editor.webSocketManager?.broadcastDiagramUpdate({
            type: 'element_moved',
            data: { elementId: element.id, position: { x, y } },
        });
    }

    mapRelationshipType(type) {
        // Mapear tipos de relación del JSON a los tipos de JointJS
        const typeMap = {
            'inheritance': 'inheritance',
            'composition': 'composition',
            'aggregation': 'aggregation',
            'association': 'association',
            'dependency': 'dependency',
            'realization': 'realization'
        };

        return typeMap[type] || 'association';
    }

    // ==================== MÉTODO ESTÁTICO PARA USO RÁPIDO ====================

    static async quickImportFromImage(editor, imageFile) {
        const importer = new SimpleImageImporter(editor);
        return await importer.importFromImage(imageFile);
    }
}

// Método estático para uso rápido
SimpleImageImporter.quickImportFromImage = function(editor, imageFile) {
    const importer = new SimpleImageImporter(editor);
    return importer.importFromImage(imageFile);
};
