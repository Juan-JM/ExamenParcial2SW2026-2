// resources/js/diagram/utils/simpleXMIExport.js
// Exportación XMI 100% compatible con Enterprise Architect 13.5
// CORREGIDO: Herencias, composiciones y multiplicidades

export class SimpleXMIExporter {
    constructor(editor) {
        this.editor = editor;
    }

    exportToXMI() {
        try {
            console.log('📄 Iniciando exportación a XMI...');

            const xmiContent = this.generateXMI();
            this.downloadXMI(xmiContent, 'diagram.xmi');

            console.log('✅ Exportación XMI completada');
        } catch (error) {
            console.error('❌ Error en exportación XMI:', error);
            alert('Error al exportar XMI: ' + error.message);
        }
    }

    generateXMI() {
        const classes = this.extractClasses();
        const relationships = this.extractRelationships();

        const xmiContent = this.buildXMIStructure(classes, relationships);
        return xmiContent;
    }

    extractClasses() {
        const classes = [];
        const elements = this.editor.graph.getElements();

        elements.forEach(element => {
            const umlData = element.get('umlData');
            if (umlData && (umlData.type === 'class' || umlData.type === 'interface')) {
                classes.push({
                    id: element.id,
                    name: umlData.className || 'UnnamedClass',
                    type: umlData.type,
                    attributes: umlData.attributes || [],
                    methods: umlData.methods || [],
                    stereotype: umlData.uml25?.stereotype || null,
                    isAbstract: !!umlData.uml25?.isAbstract,
                    position: element.position(),
                    size: element.size()
                });
            }
        });

        console.log('🏗️ Clases extraídas:', classes.length);
        return classes;
    }

    extractRelationships() {
        const relationships = [];
        const links = this.editor.graph.getLinks();
        const elements = this.editor.graph.getElements();

        const elementMap = new Map();
        elements.forEach(el => {
            const umlData = el.get('umlData');
            if (umlData) {
                elementMap.set(el.id, umlData.className || 'UnnamedClass');
            }
        });

        links.forEach(link => {
            // OJO: getSourceElement()/getTargetElement() de JointJS NO
            // devuelven null para un link "clase asociativa" (target = otro
            // link, no una clase) — resuelven RECURSIVAMENTE a través del
            // link host hasta encontrar un elemento real (ej. acá
            // devolvía la clase del otro extremo de la asociación M:N, no
            // null) — visto en vivo al exportar XMI: aparecía una
            // asociación fantasma extra. Hay que excluir este tipo
            // explícitamente por relationData.type, no confiar en que
            // source/target den null.
            if ((link.get('relationData') || {}).type === 'associationClassLink') return;

            const source = link.getSourceElement();
            const target = link.getTargetElement();

            if (source && target) {
                const umlData = link.get('umlData') || {};
                const relationData = link.get('relationData') || {};
                const linkData = link.get('linkData') || {};
                const attrs = link.attributes || {};
                const labels = link.get('labels') || [];

                const sourceName = elementMap.get(source.id) || 'Unknown';
                const targetName = elementMap.get(target.id) || 'Unknown';

                let relationType = this.detectRelationTypeIntelligent(
                    link, umlData, relationData, linkData, attrs, labels
                );

                const sourceMultiplicity = this.extractMultiplicityIntelligent(
                    umlData, relationData, linkData, labels, 0
                );

                const targetMultiplicity = this.extractMultiplicityIntelligent(
                    umlData, relationData, linkData, labels, 1
                );

                const relationName = this.extractRelationNameIntelligent(
                    relationType, sourceName, targetName,
                    umlData, relationData, linkData, labels
                );

                relationships.push({
                    id: link.id,
                    sourceId: source.id,
                    targetId: target.id,
                    type: relationType,
                    name: relationName,
                    sourceName: sourceName,
                    targetName: targetName,
                    sourceMultiplicity: sourceMultiplicity,
                    targetMultiplicity: targetMultiplicity
                });

                console.log('✅ Relación:', {
                    type: relationType,
                    from: sourceName,
                    to: targetName,
                    mult: `${sourceMultiplicity} → ${targetMultiplicity}`
                });
            }
        });

        // Clases asociativas (notación UML real — ver
        // DiagramElementFactory.isAssociationClassLink): su target es OTRO
        // LINK, no una clase, así que getSourceElement()/getTargetElement()
        // devuelven null para ellas arriba y el loop principal las salta
        // solas (no terminan como una "relación" propia). Se procesan
        // aparte acá: por cada una, se busca la relación host YA extraída
        // (por id) y se le marca `associationClassId` — generateAssociationsXML()
        // lo usa para emitir el <UML:TaggedValue tag="associationclass">
        // real de EA (ver documentacion/03-generadores-codigo.md §6).
        links.forEach(link => {
            const relationData = link.get('relationData') || {};
            if (relationData.type !== 'associationClassLink') return;

            const classElement = link.getSourceElement();
            const hostLinkId = link.get('target')?.id;
            if (!classElement || !hostLinkId) return;

            const hostRelationship = relationships.find(r => r.id === hostLinkId);
            if (hostRelationship) {
                hostRelationship.associationClassId = classElement.id;
            }
        });

        console.log('🔗 Total relaciones:', relationships.length);
        return relationships;
    }

    detectRelationTypeIntelligent(link, umlData, relationData, linkData, attrs, labels) {
        if (relationData.type && relationData.type !== 'standard.Link') {
            return this.normalizeRelationType(relationData.type);
        }
        if (relationData.relationshipType) {
            return this.normalizeRelationType(relationData.relationshipType);
        }
        if (umlData.relationshipType) {
            return this.normalizeRelationType(umlData.relationshipType);
        }
        if (umlData.type && umlData.type !== 'standard.Link') {
            return this.normalizeRelationType(umlData.type);
        }
        if (linkData.relationshipType) {
            return this.normalizeRelationType(linkData.relationshipType);
        }
        if (linkData.type && linkData.type !== 'standard.Link') {
            return this.normalizeRelationType(linkData.type);
        }

        const jointType = attrs.type || link.get('type') || '';
        if (jointType.includes('Inheritance') || jointType.includes('Generalization')) {
            return 'inheritance';
        }
        if (jointType.includes('Composition')) {
            return 'composition';
        }
        if (jointType.includes('Aggregation')) {
            return 'aggregation';
        }

        const linkAttrs = attrs.attrs || link.get('attrs') || {};
        const line = linkAttrs.line || linkAttrs['.connection'] || {};

        if (line.sourceMarker?.fill === 'black' || line.targetMarker?.fill === 'black') {
            return 'composition';
        }
        if (line.sourceMarker?.fill === 'white' || line.targetMarker?.fill === 'white') {
            return 'aggregation';
        }
        if (line.targetMarker?.type === 'path' && line.targetMarker?.fill === 'white') {
            return 'inheritance';
        }

        const labelText = labels.map(l => {
            const text = l.attrs?.text?.text || '';
            return text.toLowerCase();
        }).join(' ');

        if (labelText.includes('inheritance') || labelText.includes('herencia') || labelText.includes('extends')) {
            return 'inheritance';
        }
        if (labelText.includes('composition') || labelText.includes('composición')) {
            return 'composition';
        }
        if (labelText.includes('aggregation') || labelText.includes('agregación')) {
            return 'aggregation';
        }

        return 'association';
    }

    extractMultiplicityIntelligent(umlData, relationData, linkData, labels, labelIndex) {
        if (labelIndex === 0 && relationData.sourceMultiplicity) {
            return this.normalizeMultiplicity(relationData.sourceMultiplicity);
        }
        if (labelIndex === 1 && relationData.targetMultiplicity) {
            return this.normalizeMultiplicity(relationData.targetMultiplicity);
        }
        if (labelIndex === 0 && umlData.sourceMultiplicity) {
            return this.normalizeMultiplicity(umlData.sourceMultiplicity);
        }
        if (labelIndex === 1 && umlData.targetMultiplicity) {
            return this.normalizeMultiplicity(umlData.targetMultiplicity);
        }
        if (labelIndex === 0 && linkData.sourceMultiplicity) {
            return this.normalizeMultiplicity(linkData.sourceMultiplicity);
        }
        if (labelIndex === 1 && linkData.targetMultiplicity) {
            return this.normalizeMultiplicity(linkData.targetMultiplicity);
        }
        if (labels && labels[labelIndex]) {
            const labelText = labels[labelIndex].attrs?.text?.text || '';
            if (labelText && this.isValidMultiplicity(labelText)) {
                return this.normalizeMultiplicity(labelText);
            }
        }
        return '';
    }

    extractRelationNameIntelligent(relationType, sourceName, targetName,
                                   umlData, relationData, linkData, labels) {
        if (relationType === 'inheritance') {
            return '';
        }
        if (relationData.name && relationData.name.trim() !== '') {
            return relationData.name.trim();
        }
        if (umlData.name && umlData.name.trim() !== '') {
            return umlData.name.trim();
        }
        if (linkData.name && linkData.name.trim() !== '') {
            return linkData.name.trim();
        }
        if (linkData.relationName && linkData.relationName.trim() !== '') {
            return linkData.relationName.trim();
        }

        for (const label of labels) {
            const text = label.attrs?.text?.text || '';
            if (text && !this.isValidMultiplicity(text)) {
                const cleanText = text.trim();
                if (cleanText &&
                    !['association', 'aggregation', 'composition', 'inheritance'].includes(cleanText.toLowerCase())) {
                    return cleanText;
                }
            }
        }

        // Antes se inventaba un nombre tipo "Origen_Destino" cuando la
        // relación no tenía ninguno propio — pedido explícito del usuario:
        // una relación sin nombre debe EXPORTARSE sin nombre, no con uno
        // sintético. Afecta sobre todo a las dos relaciones 1-a-muchos que
        // salen de convertir una clase asociativa n:m (ver
        // documentacion/06-asistente-ia.md §9.4) — esas ya se crean con
        // name:'' en la importación, así que antes de este fix el nombre
        // "inventado" solo aparecía al re-exportar, no al importar.
        return '';
    }

    normalizeRelationType(type) {
        if (!type) return 'association';

        const typeStr = type.toString().toLowerCase();
        const typeMap = {
            'inheritance': 'inheritance',
            'generalization': 'inheritance',
            'herencia': 'inheritance',
            'extends': 'inheritance',
            'composition': 'composition',
            'composición': 'composition',
            'composite': 'composition',
            'aggregation': 'aggregation',
            'agregación': 'aggregation',
            'shared': 'aggregation',
            'association': 'association',
            'asociación': 'association',
            'asociacion': 'association',
            'realization': 'realization',
            'realización': 'realization',
            'realizacion': 'realization',
            'implements': 'realization',
            'dependency': 'dependency',
            'dependencia': 'dependency'
        };

        return typeMap[typeStr] || 'association';
    }

    normalizeMultiplicity(mult) {
        if (!mult) return '';

        const text = mult.toString().trim().toLowerCase();

        const multiplicityMap = {
            '*': '*',
            '0..*': '0..*',
            '1..*': '1..*',
            '1': '1',
            '0..1': '0..1',
            'n': '*',
            'm': '*',
            'many': '*',
            'one': '1'
        };

        return multiplicityMap[text] || mult.toString().trim();
    }

    isValidMultiplicity(text) {
        if (!text) return false;
        const cleaned = text.toString().trim();
        const multiplicityPattern = /^(\d+|\*|n|m|many|one|0\.\.1|0\.\.\*|1\.\.\*)$/i;
        return multiplicityPattern.test(cleaned);
    }

    /**
     * Dialecto REAL "XMI 1.1" de Enterprise Architect — no confundir con el
     * XMI 2.x genérico (`xmi:XMI xmi:version="2.0"`, `uml:Class`,
     * `ownedAttribute`, `ownedEnd`) que este exportador generaba antes. Son
     * dos vocabularios completamente distintos; EA real (probado en esta
     * sesión, archivo `diagramagimnasioxmi11.xmi` exportado por EA 2.5)
     * usa: raíz `<XMI xmi.version="1.1" xmlns:UML="omg.org/UML1.3">` (SIN
     * namespace "xmi:", atributos con PUNTO — `xmi.id`/`xmi.idref`, no
     * `xmi:id`), tags `UML:Class`/`UML:Attribute`/`UML:Association.connection`/
     * `UML:AssociationEnd`, y — el punto crítico que faltaba — un
     * `<UML:Diagram>` como HERMANO de `<UML:Model>` dentro de `<XMI.content>`
     * (NO un `<xmi:Extension>` anidado). Ese `<UML:Diagram>` con su
     * `<UML:Diagram.element><UML:DiagramElement geometry=".." subject=".."/>`
     * es lo único que EA reconoce como "hay un diagrama para abrir" — sin
     * él, las clases/relaciones importan bien al árbol de paquetes pero no
     * hay canvas, que era exactamente el síntoma reportado. Toda esta
     * estructura fue calcada campo a campo contra el archivo real, no
     * inventada — ver documentacion/03-generadores-codigo.md §6.
     *
     * **`<XMI.exporter>Enterprise Architect</XMI.exporter>` / `toolName=
     * "Enterprise Architect 2.5"` / `xmi.extender="Enterprise Architect 2.5"`
     * NO son un error de copiar-pegar — son intencionales.** Comparando el
     * LOG de import real de EA (usuario lo generó con "Write Log File") para
     * el archivo real de EA vs. para el que exportaba esta app con
     * `<XMI.exporter>Laravel UML Diagrammer</XMI.exporter>`, el segundo
     * mostraba un camino de import MUY distinto y más pobre: sin los pasos
     * "Resolving Association Classes" / "Resolving Owners" / "Resolving
     * DiagramIDs" / "Resolving Attribute Types" que sí tiene el log del
     * archivo real, y con cientos de líneas extra de "Adding tagged values
     * (attribute/object/link)" que el archivo real ni siquiera dispara. Todo
     * apunta a que EA elige qué camino de import tomar mirando el campo
     * `<XMI.exporter>` del header — si no dice "Enterprise Architect", cae a
     * un camino genérico que no aplica geometría de diagrama ni resuelve
     * clases asociativas de la misma forma. Se prueba autoidentificarse como
     * EA en los 3 lugares donde el archivo real lo hace, ver §22 en
     * documentacion/03-generadores-codigo.md para el resultado — pendiente
     * de que el usuario vuelva a probar con el log activado.
     */
    buildXMIStructure(classes, relationships) {
        const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const modelId = 'model_' + Date.now();
        const packageId = 'package_main';
        const diagramId = 'diagram_' + Date.now();
        const diagramName = this.escapeXML(window.diagramTitle || 'Diagrama de Clases');

        // Mapa GUID -> {localId, name, type}. El archivo real de EA cruza
        // clases y asociaciones por un id LOCAL entero propio del paquete
        // (`ea_localid`, `ea_sourceID`/`ea_targetID`) ADEMÁS del `xmi.id`/
        // `type=".."` con el que ya se resuelven los extremos — ver
        // generateClassesXML/generateAssociationsXML. Se arma acá, una sola
        // vez, para que ambos generadores usen los MISMOS números.
        const classLookup = this.buildClassLookup(classes);

        return `<?xml version="1.0" encoding="UTF-8"?>
<XMI xmi.version="1.1" xmlns:UML="omg.org/UML1.3" timestamp="${timestamp}">
	<XMI.header>
		<XMI.documentation>
			<XMI.exporter>Enterprise Architect</XMI.exporter>
			<XMI.exporterVersion>2.5</XMI.exporterVersion>
		</XMI.documentation>
	</XMI.header>
	<XMI.content>
		<UML:Model name="EA Model" xmi.id="${modelId}">
			<UML:Namespace.ownedElement>
				<UML:Package name="MainPackage" xmi.id="${packageId}" isRoot="false" isLeaf="false" isAbstract="false" visibility="public">
					<UML:ModelElement.taggedValue>
						<UML:TaggedValue tag="ea_package_id" value="1"/>
						<UML:TaggedValue tag="created" value="${timestamp}"/>
						<UML:TaggedValue tag="modified" value="${timestamp}"/>
						<UML:TaggedValue tag="iscontrolled" value="FALSE"/>
						<UML:TaggedValue tag="lastloaddate" value="${timestamp}"/>
						<UML:TaggedValue tag="lastsavedate" value="${timestamp}"/>
						<UML:TaggedValue tag="version" value="1.0"/>
						<UML:TaggedValue tag="isprotected" value="FALSE"/>
						<UML:TaggedValue tag="usedtd" value="FALSE"/>
						<UML:TaggedValue tag="logxml" value="FALSE"/>
						<UML:TaggedValue tag="tpos" value="0"/>
						<UML:TaggedValue tag="packageFlags" value="CRC=0;"/>
						<UML:TaggedValue tag="batchsave" value="0"/>
						<UML:TaggedValue tag="batchload" value="0"/>
						<UML:TaggedValue tag="phase" value="1.0"/>
						<UML:TaggedValue tag="status" value="Proposed"/>
						<UML:TaggedValue tag="complexity" value="1"/>
						<UML:TaggedValue tag="ea_stype" value="Public"/>
						<UML:TaggedValue tag="gentype" value="Java"/>
					</UML:ModelElement.taggedValue>
					<UML:Namespace.ownedElement>
						${this.generateClassesXML(classes, packageId, relationships, classLookup, timestamp)}
						${this.generateAssociationsXML(relationships, classLookup)}
						${this.generateGeneralizationsXML(relationships)}
						${this.generateRealizationsAndDependenciesXML(relationships)}
					</UML:Namespace.ownedElement>
				</UML:Package>
				${this.generatePrimitiveTypesXML(classes)}
			</UML:Namespace.ownedElement>
		</UML:Model>
		${this.generateDiagramXML(classes, relationships, packageId, diagramId, diagramName)}
	</XMI.content>
	<XMI.difference/>
	<XMI.extensions xmi.extender="Enterprise Architect 2.5">
		<EAModel.paramSub/>
	</XMI.extensions>
</XMI>`;
    }

    /**
     * Id local entero (1, 2, 3...) por clase, único dentro del paquete —
     * distinto del `xmi.id` (GUID). Confirmado en un archivo real de EA
     * (`Diagram_Exported_From_EA.xmi`): CADA clase trae su propio
     * `ea_localid`, y cada asociación referencia el `ea_localid` de sus dos
     * extremos vía `ea_sourceID`/`ea_targetID` — un sistema de
     * cross-referencia paralelo al `type="class_X"` de `UML:AssociationEnd`.
     * Hipótesis (no confirmada abriendo EA real, no se puede desde este
     * entorno): el "Import Package from XMI" de EA usa este id local, no
     * solo el GUID, para reconciliar el modelo recién creado con la
     * geometría de `<UML:DiagramElement subject="..">` — sin él, un archivo
     * que SÍ trae posiciones bien formadas seguía sin respetarlas al
     * importar (reportado por el usuario, confirmado comparando este mismo
     * archivo contra uno real de EA que sí las respeta).
     */
    buildClassLookup(classes) {
        const lookup = new Map();
        classes.forEach((cls, index) => {
            lookup.set(cls.id, {
                localId: index + 1,
                name: cls.name,
                type: cls.type === 'interface' ? 'Interface' : 'Class',
            });
        });
        return lookup;
    }

    /**
     * El `<UML:Diagram>` real — ver docblock de buildXMIStructure(). Mismo
     * cálculo de posiciones/DUID que antes, solo cambian los nombres de tag
     * y que ahora va SUELTO (hermano de Model), no envuelto en un
     * xmi:Extension.
     *
     * `offsetX`/`offsetY`: el canvas de esta app permite paneo infinito en
     * cualquier dirección, así que un diagrama usado un tiempo termina con
     * clases en coordenadas NEGATIVAS sin problema (el archivo original de
     * EA de referencia, en cambio, nunca las tenía — todo positivo). Probado
     * en vivo con un archivo real exportado por esta app con clases en
     * negativo (ej. `Left=-331;Top=-522;`): al abrirlo en EA, todas las
     * clases aparecían amontonadas en un mismo punto con las líneas de
     * relación cruzándose — EA no parece manejar bien `Left`/`Top`
     * negativos en la geometría del diagrama. Se traslada todo el layout
     * (misma forma relativa, solo desplazado) para que el punto más
     * arriba-izquierda quede en `PADDING` — nunca negativo — sin tocar las
     * posiciones reales de los elementos en el editor.
     */
    generateDiagramXML(classes, relationships, packageId, diagramId, diagramName) {
        const PADDING = 40;

        // Factor de escala SOLO para la geometría que se exporta a EA — no
        // toca `element.position()`/`element.size()` reales del canvas de
        // esta app (cero riesgo para la UI en vivo). El usuario reportó que,
        // al abrir en EA, las clases se ven con las cajas más grandes de lo
        // que necesita su texto y mucho más separadas entre sí que en
        // nuestro propio canvas — consistente con que EA dibuja el nombre/
        // atributos con una fuente bastante más chica que la nuestra, así
        // que las MISMAS dimensiones en píxeles le sobran. Se escala
        // posición Y tamaño juntos por el mismo factor (no solo el tamaño)
        // para que la relación separación-entre-cajas/tamaño-de-caja quede
        // igual que en el canvas original — así no se puede introducir un
        // solapamiento nuevo que no existiera ya antes de escalar.
        // NO verificado contra EA real (no se puede abrir desde acá) — es
        // una corrección visual, no de datos; si no ayuda o empeora algo,
        // alcanza con volver `EXPORT_SCALE` a `1` para dejarlo como estaba.
        const EXPORT_SCALE = 0.65;

        const scaledPositions = classes.map((cls) => ({
            x: cls.position.x * EXPORT_SCALE,
            y: cls.position.y * EXPORT_SCALE,
            width: Math.round((cls.size?.width || 220) * EXPORT_SCALE),
            height: Math.round((cls.size?.height || 120) * EXPORT_SCALE),
        }));

        const minX = scaledPositions.length ? Math.min(...scaledPositions.map((p) => p.x)) : 0;
        const minY = scaledPositions.length ? Math.min(...scaledPositions.map((p) => p.y)) : 0;
        const offsetX = PADDING - minX;
        const offsetY = PADDING - minY;

        const duidByClassId = new Map();
        classes.forEach((cls) => duidByClassId.set(cls.id, this.generateDuid(cls.id)));

        const classElements = classes.map((cls, index) => {
            const { width, height, x, y } = scaledPositions[index];
            const left = Math.round(x) + offsetX;
            const top = Math.round(y) + offsetY;
            const duid = duidByClassId.get(cls.id);

            return `
				<UML:DiagramElement geometry="Left=${left};Top=${top};Right=${left + width};Bottom=${top + height};" subject="class_${cls.id}" seqno="${index + 1}" style="DUID=${duid};"/>`;
        }).join('');

        // Sub-campos de posición de las labels del conector (multiplicidad
        // origen/destino + nombre) — antes iban TODOS vacíos
        // (`$LLB=;LLT=;LMT=;...`). El archivo real de EA de referencia
        // (`diagramagimnasioxmi11.xmi`) sí trae 3 de los 6 populados con
        // valores concretos para una asociación simple de 2 clases
        // (`LLB`/`LMT`/`LRB` — multiplicidad origen, nombre, multiplicidad
        // destino). Best-effort, NO verificado pixel a pixel contra EA real
        // (no se pudo abrir EA desde acá): se reusa ese mismo patrón real
        // como default genérico para todo conector en vez de dejarlo en
        // blanco — más parecido a lo que EA escribiría que un string vacío,
        // aunque el ancho/offset exacto de cada label no se recalcula por
        // longitud de texto real.
        const LABEL_POSITIONS = 'LLB=CX=17:CY=14:OX=0:OY=0:HDN=0:BLD=0:ITA=0:UND=0:CLR=-1:ALN=1:DIR=0:ROT=0;LLT=;LMT=CX=41:CY=14:OX=-1:OY=4:HDN=0:BLD=0:ITA=0:UND=0:CLR=-1:ALN=0:DIR=0:ROT=0;LMB=;LRT=;LRB=CX=17:CY=14:OX=0:OY=0:HDN=0:BLD=0:ITA=0:UND=0:CLR=-1:ALN=1:DIR=0:ROT=0;';

        // El host M:N de una clase asociativa no lleva multiplicidad en
        // ningún extremo (ver generateAssociationsXML / isAssociationClassHost
        // — el archivo real de EA de referencia lo confirma: en ese caso
        // concreto deja estos 6 sub-campos de posición de labels TODOS
        // vacíos también, porque no hay ninguna etiqueta de multiplicidad
        // que posicionar). Usar LABEL_POSITIONS (pensado para una
        // multiplicidad origen/destino + nombre reales) ahí sería
        // inconsistente con lo que la propia asociación ya no declara.
        const EMPTY_LABEL_POSITIONS = 'LLB=;LLT=;LMT=;LMB=;LRT=;LRB=;';

        const relationshipElements = relationships.map((rel) => {
            const sourceDuid = duidByClassId.get(rel.sourceId);
            const targetDuid = duidByClassId.get(rel.targetId);
            if (!sourceDuid || !targetDuid) return '';

            const labelBlock = rel.associationClassId ? EMPTY_LABEL_POSITIONS : LABEL_POSITIONS;

            return `
				<UML:DiagramElement geometry="EDGE=1;$${labelBlock}IRHS=;ILHS=;Path=;" subject="rel_${rel.id}" style="Mode=3;EOID=${targetDuid};SOID=${sourceDuid};Color=-1;LWidth=0;Hidden=0;"/>`;
        }).join('');

        // `DocSize.cx`/`DocSize.cy` (tamaño de página del diagrama) calculado
        // desde el borde más lejano de las clases ya desplazadas arriba —
        // con margen. El archivo real de EA de referencia SIEMPRE trae este
        // `ModelElement.taggedValue` con `EAStyle` en el propio `<UML:Diagram>`;
        // acá faltaba por completo (solo se generaban los `<UML:DiagramElement>`
        // hijos) — sospecha de por qué EA seguía sin respetar las posiciones
        // aunque la geometría ya no tuviera negativos: sin esto, puede que EA
        // no confíe en que el diagrama trae layout guardado y aplique su
        // propio auto-arreglo al abrirlo por primera vez. Valores de estilo
        // copiados literales del archivo real (son config por defecto, no
        // datos específicos de un diagrama en particular) salvo `DocSize`,
        // que sí se calcula real.
        const maxRight = scaledPositions.length ? Math.max(...scaledPositions.map((p) => Math.round(p.x) + offsetX + p.width)) : 800;
        const maxBottom = scaledPositions.length ? Math.max(...scaledPositions.map((p) => Math.round(p.y) + offsetY + p.height)) : 600;
        const docSizeX = maxRight + PADDING;
        const docSizeY = maxBottom + PADDING;

        return `<UML:Diagram name="${diagramName}" xmi.id="${diagramId}" diagramType="ClassDiagram" owner="${packageId}" toolName="Enterprise Architect 2.5">
			<UML:ModelElement.taggedValue>
				<UML:TaggedValue tag="type" value="Logical"/>
				<UML:TaggedValue tag="package" value="${packageId}"/>
				<UML:TaggedValue tag="ea_localid" value="1"/>
				<UML:TaggedValue tag="swimlanes" value="locked=false;orientation=0;width=0;inbar=false;names=false;color=-1;bold=false;fcol=0;tcol=-1;ofCol=-1;ufCol=-1;hl=0;ufh=0;hh=0;cls=0;bw=0;hli=0;"/>
				<UML:TaggedValue tag="matrixitems" value="locked=false;matrixactive=false;swimlanesactive=true;kanbanactive=false;width=1;clrLine=0;"/>
				<UML:TaggedValue tag="EAStyle" value="ShowPrivate=1;ShowProtected=1;ShowPublic=1;HideRelationships=0;Locked=0;Border=1;HighlightForeign=1;PackageContents=1;SequenceNotes=0;ScalePrintImage=0;PPgs.cx=0;PPgs.cy=0;DocSize.cx=${docSizeX};DocSize.cy=${docSizeY};ShowDetails=0;Orientation=P;Zoom=100;ShowTags=0;OpParams=1;VisibleAttributeDetail=1;ShowOpRetType=1;ShowIcons=0;CollabNums=0;HideProps=0;ShowReqs=0;ShowCons=0;PaperSize=9;HideParents=0;UseAlias=0;HideAtts=0;HideOps=0;HideStereo=1;HideElemStereo=1;ShowTests=0;ShowMaint=0;ConnectorNotation=UML 2.1;ExplicitNavigability=0;ShowShape=1;AllDockable=0;AdvancedElementProps=0;AdvancedFeatureProps=0;AdvancedConnectorProps=1;m_bElementClassifier=0;SPT=0;ShowNotes=0;SuppressBrackets=0;SuppConnectorLabels=0;PrintPageHeadFoot=0;ShowAsList=0;"/>
			</UML:ModelElement.taggedValue>
			<UML:Diagram.element>${classElements}${relationshipElements}
			</UML:Diagram.element>
		</UML:Diagram>`;
    }

    /** Id corto y ESTABLE (8 hex) derivado de un id real — imita el "DUID" (Diagram Unique ID) que usa EA para referenciar sus propios <element> de diagrama desde los edges (SOID/EOID). No necesita ser criptográfico, solo estable y con baja chance de choque dentro de UN diagrama. */
    generateDuid(id) {
        let hash = 0;
        const str = String(id);
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
    }

    /**
     * `relationships` se usa para armar `conID` (ver más abajo) — la
     * referencia cruzada que EA espera del lado de la CLASE asociativa
     * hacia la Association que "cuelga" (comparado campo a campo contra
     * `diagramagimnasioxmi11.xmi`, un archivo real exportado por EA con una
     * clase asociativa real: la clase trae `<UML:TaggedValue tag="conID"
     * value="{xmi.id de la Association}"/>` — antes este exportador solo
     * escribía la referencia en el sentido INVERSO (`associationclass` del
     * lado de la Association, ver `generateAssociationsXML`), nunca esta.
     * Sin `conID`, EA importa la clase como una clase suelta común — sin la
     * línea punteada de "clase asociativa" hacia la relación M:N.
     */
    generateClassesXML(classes, packageId, relationships = [], classLookup = null, timestamp = '') {
        const assocRelIdByClassId = new Map();
        relationships.forEach((rel) => {
            if (rel.associationClassId) {
                assocRelIdByClassId.set(rel.associationClassId, `rel_${rel.id}`);
            }
        });

        // `ea_localid` de los ATRIBUTOS es un contador GLOBAL a través de
        // todas las clases del diagrama (no se reinicia por clase) — así lo
        // numera el archivo real de EA de referencia. Se arma acá, una sola
        // vez para todo el documento, y se le pasa a cada llamada de
        // generateAttributesXML().
        let attrLocalIdCounter = 0;
        const nextAttrLocalId = () => ++attrLocalIdCounter;

        return classes.map(cls => {
            const classId = `class_${cls.id}`;
            const xmiType = cls.type === 'interface' ? 'Interface' : 'Class';
            const conId = assocRelIdByClassId.get(cls.id);

            // Bloque completo, calcado del archivo real de EA de referencia
            // (antes solo se escribían `ea_eleType`/`ea_localid`). Dos cosas
            // puntuales encontradas comparando el archivo real contra el
            // exportado por este mismo software para el mismo diagrama:
            // - `ea_ntype="17"` SOLO en la clase asociativa (todas las demás
            //   clases reales traen `ea_ntype="0"`) — posible marcador interno
            //   de EA para "esto es una clase asociativa", nunca escrito acá.
            // - El resto de los campos (`ea_stype`, `version`, `package`,
            //   fechas, `gentype`, `tagged`, `package_name`, `phase`,
            //   `complexity`, `status`, `tpos`, `style` con los colores por
            //   defecto) son metadata que el archivo real SIEMPRE trae y
            //   nuestro export nunca escribió — no hay forma de confirmar
            //   cuál es funcionalmente necesaria sin poder abrir EA, así que
            //   se agregan todas por completitud estructural.
            const taggedValues = [
                `<UML:TaggedValue tag="isSpecification" value="false"/>`,
                `<UML:TaggedValue tag="ea_stype" value="${xmiType}"/>`,
                `<UML:TaggedValue tag="ea_ntype" value="${conId ? '17' : '0'}"/>`,
                `<UML:TaggedValue tag="version" value="1.0"/>`,
                `<UML:TaggedValue tag="package" value="${packageId}"/>`,
                `<UML:TaggedValue tag="date_created" value="${timestamp}"/>`,
                `<UML:TaggedValue tag="date_modified" value="${timestamp}"/>`,
                `<UML:TaggedValue tag="gentype" value="Java"/>`,
                `<UML:TaggedValue tag="tagged" value="0"/>`,
                `<UML:TaggedValue tag="package_name" value="MainPackage"/>`,
                `<UML:TaggedValue tag="phase" value="1.0"/>`,
                `<UML:TaggedValue tag="complexity" value="1"/>`,
                `<UML:TaggedValue tag="status" value="Proposed"/>`,
                `<UML:TaggedValue tag="tpos" value="0"/>`,
                `<UML:TaggedValue tag="ea_eleType" value="element"/>`,
                `<UML:TaggedValue tag="style" value="BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;VSwimLanes=1;HSwimLanes=1;BorderStyle=0;"/>`,
            ];
            const localId = classLookup?.get(cls.id)?.localId;
            if (localId) {
                taggedValues.push(`<UML:TaggedValue tag="ea_localid" value="${localId}"/>`);
            }
            if (cls.stereotype) {
                taggedValues.push(`<UML:TaggedValue tag="stereotype" value="${this.escapeXML(cls.stereotype)}"/>`);
            }
            if (conId) {
                taggedValues.push(`<UML:TaggedValue tag="conID" value="${conId}"/>`);
            }
            const taggedValueBlock = `
        <UML:ModelElement.taggedValue>
          ${taggedValues.join('\n          ')}
        </UML:ModelElement.taggedValue>`;

            return `
      <UML:${xmiType} name="${this.escapeXML(cls.name)}" xmi.id="${classId}" visibility="public" namespace="${packageId}" isRoot="false" isLeaf="false" isAbstract="${cls.isAbstract ? 'true' : 'false'}" isActive="false">${taggedValueBlock}
        <UML:Classifier.feature>
          ${this.generateAttributesXML(cls.attributes, nextAttrLocalId)}
          ${this.generateMethodsXML(cls.methods)}
        </UML:Classifier.feature>
      </UML:${xmiType}>`;
        }).join('');
    }

    /**
     * `<UML:StructuralFeature.type><UML:Classifier xmi.idref="type_X"/></UML:StructuralFeature.type>`
     * + `<UML:TaggedValue tag="type" value="X"/>` — así lo escribe Enterprise
     * Architect de verdad (dialecto XMI 1.1, ver docblock de
     * buildXMIStructure). El idref apunta a un `UML:DataType` declarado por
     * `generatePrimitiveTypesXML()`. Se escribe el tipo en AMBOS lugares
     * (Classifier idref Y TaggedValue) porque el TaggedValue "type" es lo
     * que EA realmente muestra en el diagrama/usa para codegen — el archivo
     * real de EA que se usó de referencia tiene el idref formal apuntando
     * SIEMPRE a un DataType genérico "int" sin importar el tipo real,
     * confiando en el TaggedValue como fuente de verdad; acá se prefirió
     * apuntar el idref al tipo correcto también (más correcto y sin costo),
     * pero el importador (extractClassAttributes) igual prioriza el
     * TaggedValue "type" primero por si algún archivo real viene con esa
     * inconsistencia.
     */
    /**
     * `nextLocalId`: función que devuelve el próximo `ea_localid` GLOBAL
     * (no por clase — el archivo real de EA de referencia numera los
     * atributos de forma continua a través de TODAS las clases, 1..N en el
     * orden en que aparecen; ver `generateClassesXML`, que arma un único
     * contador y se lo pasa a cada llamada de este método). El resto de los
     * campos (`derived`, `containment`, `length`, `ordered`, `precision`,
     * `scale`, `static`, `collection`, `lowerBound`, `upperBound`,
     * `duplicates`, `styleex`) son defaults estáticos — el archivo real trae
     * el MISMO valor en cada atributo de muestra, sin variar según el tipo
     * declarado, así que no hay nada que derivar de nuestro lado. `ea_guid`
     * es un GUID nuevo generado acá — EA solo necesita que sea único, no
     * que coincida con nada.
     */
    generateAttributesXML(attributes, nextLocalId = (() => { let n = 0; return () => ++n; })()) {
        return attributes.map((attr, index) => {
            const attrData = this.parseAttribute(attr);
            const typeId = this.typeIdFor(attrData.type);
            const localId = nextLocalId();

            return `
          <UML:Attribute name="${this.escapeXML(attrData.name)}" changeable="none" visibility="${attrData.visibility}" ownerScope="instance" targetScope="instance">
            <UML:Attribute.initialValue><UML:Expression/></UML:Attribute.initialValue>
            <UML:StructuralFeature.type><UML:Classifier xmi.idref="${typeId}"/></UML:StructuralFeature.type>
            <UML:ModelElement.taggedValue>
              <UML:TaggedValue tag="type" value="${this.escapeXML(attrData.type)}"/>
              <UML:TaggedValue tag="derived" value="0"/>
              <UML:TaggedValue tag="containment" value="Not Specified"/>
              <UML:TaggedValue tag="length" value="0"/>
              <UML:TaggedValue tag="ordered" value="0"/>
              <UML:TaggedValue tag="precision" value="0"/>
              <UML:TaggedValue tag="scale" value="0"/>
              <UML:TaggedValue tag="static" value="0"/>
              <UML:TaggedValue tag="collection" value="false"/>
              <UML:TaggedValue tag="position" value="${index}"/>
              <UML:TaggedValue tag="lowerBound" value="1"/>
              <UML:TaggedValue tag="upperBound" value="1"/>
              <UML:TaggedValue tag="duplicates" value="0"/>
              <UML:TaggedValue tag="ea_guid" value="${this.generateGuid()}"/>
              <UML:TaggedValue tag="ea_localid" value="${localId}"/>
              <UML:TaggedValue tag="styleex" value="volatile=0;"/>
            </UML:ModelElement.taggedValue>
          </UML:Attribute>`;
        }).join('');
    }

    /** GUID con formato `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}` — mismo formato que `ea_guid` en un archivo real de EA. Solo necesita ser único, no coincidir con nada del lado de EA. */
    generateGuid() {
        const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1).toUpperCase();
        return `{${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}}`;
    }

    /** Id estable para un nombre de tipo (ej. "String" -> "type_String") — usado tanto al declarar el tipo (generatePrimitiveTypesXML) como al referenciarlo (generateAttributesXML). */
    typeIdFor(typeName) {
        const safe = (typeName || 'String').replace(/[^A-Za-z0-9_]/g, '_');
        return `type_${safe}`;
    }

    /** Todos los nombres de tipo distintos usados en atributos Y retornos de método del diagrama — para declarar solo lo que hace falta en generatePrimitiveTypesXML(). */
    collectUsedTypes(classes) {
        const types = new Set();
        classes.forEach((cls) => {
            (cls.attributes || []).forEach((attr) => {
                types.add(this.parseAttribute(attr).type || 'String');
            });
            (cls.methods || []).forEach((method) => {
                types.add(this.parseMethod(method).returnType || 'void');
            });
        });
        if (types.size === 0) types.add('String');
        return Array.from(types);
    }

    /**
     * Cada tipo usado como su propio `UML:DataType` — permite resolver
     * `xmi.idref="type_X"` a un nombre real buscando ese id en el documento,
     * sin tabla fija de tipos conocidos de antemano. `visibility="private"`
     * y HERMANO de `<UML:Package>` (no adentro): así lo trae el archivo real
     * de EA de referencia — el `UML:DataType` de "int" vive directo bajo
     * `<UML:Model><UML:Namespace.ownedElement>`, no dentro del paquete que
     * lo usa. Antes iba adentro del paquete con `visibility="public"`.
     */
    generatePrimitiveTypesXML(classes) {
        const types = this.collectUsedTypes(classes);
        return types.map((t) => `
				<UML:DataType name="${this.escapeXML(t)}" xmi.id="${this.typeIdFor(t)}" visibility="private" isRoot="false" isLeaf="false" isAbstract="false"/>`).join('');
    }

    /** El tipo de retorno va como `UML:Parameter name="return" kind="return"` dentro de `BehavioralFeature.parameter` (patrón estándar UML1.3/EA) — no como atributo plano `type=".."` en la propia Operation, que EA real no trae. */
    generateMethodsXML(methods) {
        return methods.map((method) => {
            const methodData = this.parseMethod(method);
            const typeId = this.typeIdFor(methodData.returnType);

            return `
          <UML:Operation name="${this.escapeXML(methodData.name)}" visibility="${methodData.visibility}" ownerScope="instance" isQuery="false" concurrency="sequential">
            <UML:BehavioralFeature.parameter>
              <UML:Parameter name="return" kind="return">
                <UML:Parameter.type><UML:Classifier xmi.idref="${typeId}"/></UML:Parameter.type>
                <UML:ModelElement.taggedValue>
                  <UML:TaggedValue tag="type" value="${this.escapeXML(methodData.returnType)}"/>
                </UML:ModelElement.taggedValue>
              </UML:Parameter>
            </UML:BehavioralFeature.parameter>
          </UML:Operation>`;
        }).join('');
    }

    /** Herencia: `UML:Generalization` es un elemento propio dentro del namespace (con subtype/supertype), NO anidado dentro de la clase como en el dialecto XMI2.x. */
    generateGeneralizationsXML(relationships) {
        return relationships
            .filter(rel => rel.type === 'inheritance')
            .map(rel => `
      <UML:Generalization xmi.id="rel_${rel.id}" subtype="class_${rel.sourceId}" supertype="class_${rel.targetId}"/>`)
            .join('');
    }

    // Realización (implementa interfaz) y Dependencia (usa): UML:Abstraction/
    // UML:Dependency con client/supplier — sin conexión de extremos ni
    // multiplicidad, a diferencia de una asociación.
    generateRealizationsAndDependenciesXML(relationships) {
        return relationships
            .filter(rel => rel.type === 'realization' || rel.type === 'dependency')
            .map(rel => {
                const tag = rel.type === 'realization' ? 'Abstraction' : 'Dependency';
                return `
      <UML:${tag} xmi.id="rel_${rel.id}" client="class_${rel.sourceId}" supplier="class_${rel.targetId}"/>`;
            }).join('');
    }

    /**
     * `UML:Association` con `UML:Association.connection` conteniendo dos
     * `UML:AssociationEnd` — cada extremo lleva `type="class_X"` (atributo
     * PLANO, no hijo `<type>`), `multiplicity="X"` como string UML directo
     * (no lowerValue/upperValue separados) y `aggregation`. Estructura
     * calcada del archivo real de EA (dialecto XMI 1.1) — ver docblock de
     * buildXMIStructure(). Semántica de aggregation (interpretación literal
     * UML1.3, autorreferencial): el extremo cuyo `type` es la clase
     * CONTENEDORA lleva el valor "composite"/"shared" directamente, sin
     * invertir — a diferencia del dialecto UML2/XMI2.x donde iba en el
     * extremo opuesto.
     *
     * DOS campos que faltaban por completo hasta ahora, encontrados
     * releyendo con lupa `Diagram_Exported_From_EA.xmi` (el usuario reportó
     * que EA seguía dibujando flecha en TODO, aun con `headStyle`/`lineStyle`/
     * `direction` ya puestos — ver §17 — así que había que seguir buscando):
     * 1) La propia `<UML:Association>` SIEMPRE trae, como PRIMER tagged
     *    value, `<UML:TaggedValue tag="style" value="3"/>` — nuestro export
     *    nunca lo tuvo.
     * 2) Cada `<UML:AssociationEnd>` real NO es un tag auto-cerrado — trae su
     *    PROPIO `<UML:ModelElement.taggedValue>` anidado con `containment`,
     *    `sourcestyle`/`deststyle` (`"Union=0;Derived=0;AllowDuplicates=0;
     *    Owned=0;Navigable=Unspecified;"`) y `ea_end` ("source"/"target").
     *    El campo `Navigable=` DENTRO de ese string es un candidato mucho más
     *    directo para controlar la flecha que `direction` a nivel de la
     *    Association — nuestro export nunca escribió nada de esto, los
     *    `AssociationEnd` quedaban auto-cerrados sin hijos.
     * Ninguno de los dos está confirmado como LA causa exacta de las flechas
     * (no se puede abrir EA desde acá) — se agregan ambos porque son
     * diferencias reales y concretas contra el archivo de referencia, no
     * una corazonada.
     */
    generateAssociationsXML(relationships, classLookup = null) {
        return relationships
            .filter(rel => !['inheritance', 'realization', 'dependency'].includes(rel.type))
            .map((rel, index) => {
                const relId = `rel_${rel.id}`;
                // `ea_localid` propio de CADA asociación (distinto de
                // `ea_sourceID`/`ea_targetID`, que apuntan al `ea_localid` de
                // sus dos extremos) — el archivo real de EA de referencia lo
                // trae siempre, no se estaba escribiendo.
                const relLocalId = index + 1;
                const nameAttr = rel.name ? ` name="${this.escapeXML(rel.name)}"` : '';

                let sourceAggregation = 'none';
                if (rel.type === 'composition') {
                    sourceAggregation = 'composite';
                } else if (rel.type === 'aggregation') {
                    sourceAggregation = 'shared';
                }

                const associationClassTag = rel.associationClassId
                    ? `\n          <UML:TaggedValue tag="associationclass" value="class_${rel.associationClassId}"/>`
                    : '';

                // `subtype value="Class"` — SOLO en el host de una clase
                // asociativa en el archivo real de EA usado de referencia
                // (nunca en una asociación simple). Se copia literal, mismo
                // criterio que `associationclass`.
                const subtypeTag = rel.associationClassId
                    ? `\n          <UML:TaggedValue tag="subtype" value="Class"/>`
                    : '';

                // `ea_sourceID`/`ea_targetID` (+ nombre/tipo) — ver
                // buildClassLookup(). Mismo criterio que `ea_localid` en
                // generateClassesXML: un archivo real de EA siempre trae
                // este cruce por id local en cada asociación, además del
                // `type="class_X"` de cada `UML:AssociationEnd`.
                const sourceInfo = classLookup?.get(rel.sourceId);
                const targetInfo = classLookup?.get(rel.targetId);
                const crossRefTags = (sourceInfo && targetInfo) ? `
          <UML:TaggedValue tag="seqno" value="0"/>
          <UML:TaggedValue tag="ea_localid" value="${relLocalId}"/>
          <UML:TaggedValue tag="virtualInheritance" value="0"/>
          <UML:TaggedValue tag="ea_sourceName" value="${this.escapeXML(sourceInfo.name)}"/>
          <UML:TaggedValue tag="ea_targetName" value="${this.escapeXML(targetInfo.name)}"/>
          <UML:TaggedValue tag="ea_sourceType" value="${sourceInfo.type}"/>
          <UML:TaggedValue tag="ea_targetType" value="${targetInfo.type}"/>
          <UML:TaggedValue tag="ea_sourceID" value="${sourceInfo.localId}"/>
          <UML:TaggedValue tag="ea_targetID" value="${targetInfo.localId}"/>` : '';

                // `lb`/`mt`/`rb` (multiplicidad origen / nombre / multiplicidad
                // destino, como tags PLANOS — redundante con lo que ya va en
                // `AssociationEnd`/`name`, pero el archivo real de EA de
                // referencia los trae siempre en una asociación normal). El
                // host de una clase asociativa NUNCA los trae (no tiene
                // multiplicidad ni nombre real, ver más abajo).
                const lbMtRbTags = !rel.associationClassId ? `
          <UML:TaggedValue tag="lb" value="${this.escapeXML(rel.sourceMultiplicity || '1')}"/>${rel.name ? `
          <UML:TaggedValue tag="mt" value="${this.escapeXML(rel.name)}"/>` : ''}
          <UML:TaggedValue tag="rb" value="${this.escapeXML(rel.targetMultiplicity || '1')}"/>` : '';

                // La relación M:N que sostiene una clase asociativa, en el
                // archivo real de EA usado de referencia, NO trae
                // `multiplicity` en ninguno de los dos extremos (se omite el
                // atributo directamente) — EA no le pide multiplicidad
                // explícita a esa asociación "de fondo", la clase asociativa
                // ya expresa la relación real. Antes esta rama cascaba al
                // `|| '1'` de siempre igual que cualquier otra asociación —
                // si `rel.sourceMultiplicity`/`targetMultiplicity` venían
                // vacíos (nunca se les asignó nada porque nadie los edita a
                // mano para este tipo de link), el resultado quedaba
                // `multiplicity="1"` en los dos extremos, que no refleja que
                // es una M:N. Replicando el comportamiento real: se omite el
                // atributo entero en este caso puntual.
                const isAssociationClassHost = !!rel.associationClassId;
                const sourceMultAttr = isAssociationClassHost
                    ? ''
                    : ` multiplicity="${this.escapeXML(rel.sourceMultiplicity || '1')}"`;
                const targetMultAttr = isAssociationClassHost
                    ? ''
                    : ` multiplicity="${this.escapeXML(rel.targetMultiplicity || '1')}"`;

                return `
      <UML:Association${nameAttr} xmi.id="${relId}" visibility="public" isRoot="false" isLeaf="false" isAbstract="false">
        <UML:ModelElement.taggedValue>
          <UML:TaggedValue tag="style" value="3"/>
          <UML:TaggedValue tag="ea_type" value="Association"/>
          <UML:TaggedValue tag="direction" value="Unspecified"/>
          <UML:TaggedValue tag="linemode" value="3"/>
          <UML:TaggedValue tag="linecolor" value="-1"/>
          <UML:TaggedValue tag="linewidth" value="0"/>
          <UML:TaggedValue tag="headStyle" value="0"/>
          <UML:TaggedValue tag="lineStyle" value="0"/>${subtypeTag}${crossRefTags}${lbMtRbTags}${associationClassTag}
        </UML:ModelElement.taggedValue>
        <UML:Association.connection>
          <UML:AssociationEnd visibility="public"${sourceMultAttr} aggregation="${sourceAggregation}" isOrdered="false" targetScope="instance" changeable="none" isNavigable="true" type="class_${rel.sourceId}">
            <UML:ModelElement.taggedValue>
              <UML:TaggedValue tag="containment" value="Unspecified"/>
              <UML:TaggedValue tag="sourcestyle" value="Union=0;Derived=0;AllowDuplicates=0;Owned=0;Navigable=Unspecified;"/>
              <UML:TaggedValue tag="ea_end" value="source"/>
            </UML:ModelElement.taggedValue>
          </UML:AssociationEnd>
          <UML:AssociationEnd visibility="public"${targetMultAttr} aggregation="none" isOrdered="false" targetScope="instance" changeable="none" isNavigable="true" type="class_${rel.targetId}">
            <UML:ModelElement.taggedValue>
              <UML:TaggedValue tag="containment" value="Unspecified"/>
              <UML:TaggedValue tag="deststyle" value="Union=0;Derived=0;AllowDuplicates=0;Owned=0;Navigable=Unspecified;"/>
              <UML:TaggedValue tag="ea_end" value="target"/>
            </UML:ModelElement.taggedValue>
          </UML:AssociationEnd>
        </UML:Association.connection>
      </UML:Association>`;
            }).join('');
    }

    /**
     * Mismo bug/fix que `SimpleJavaGenerator.parseAttribute()`: un atributo
     * sin tipo (usuario dejó "Tipo" vacío) se guarda SIN ":" en absoluto —
     * el regex viejo lo exigía, y sin él devolvía el string CRUDO (con el
     * símbolo de visibilidad incluido, ej. "- orden") como `name`. Acá eso
     * no rompía el XML (cualquier string es válido en un atributo XML), pero
     * corrompía el dato: se exportaba `name="- orden"`, y una reimportación
     * de ese mismo XMI volvía con ese nombre sucio pegado para siempre.
     */
    parseAttribute(attributeString) {
        const trimmed = String(attributeString || '').trim();
        const visibilityMatch = trimmed.match(/^([+\-#~])\s*(.*)$/);
        const visibilitySymbol = visibilityMatch ? visibilityMatch[1] : '+';
        const rest = visibilityMatch ? visibilityMatch[2] : trimmed;

        const colonIdx = rest.lastIndexOf(':');
        const name = colonIdx === -1 ? rest : rest.slice(0, colonIdx).trim();
        const type = colonIdx === -1 ? '' : rest.slice(colonIdx + 1).trim();

        return {
            visibility: this.visibilitySymbolToName(visibilitySymbol),
            name: name || 'campo',
            type: type || 'String'
        };
    }

    parseMethod(methodString) {
        const match = methodString.match(/^([+\-#~])\s*([^()]+)\(\):\s*(.+)$/);
        if (match) {
            return {
                visibility: this.visibilitySymbolToName(match[1]),
                name: match[2].trim(),
                returnType: match[3].trim()
            };
        }
        return { visibility: 'public', name: methodString, returnType: 'void' };
    }

    visibilitySymbolToName(symbol) {
        const map = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package' };
        return map[symbol] || 'public';
    }

    escapeXML(str) {
        if (!str) return '';
        return str.toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    downloadXMI(content, filename) {
        const blob = new Blob([content], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(() => URL.revokeObjectURL(url), 100);

        console.log('📥 Descarga XMI iniciada:', filename);
    }

    static quickExportXMI(editor) {
        const exporter = new SimpleXMIExporter(editor);
        exporter.exportToXMI();
    }
}
