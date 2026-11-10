// resources/js/diagram/utils/simpleSQLGenerator.js
// Generación de scripts SQL desde diagramas UML — dialecto PostgreSQL (motor
// real del proyecto, ver documentacion/00-general.md). Antes generaba
// sintaxis MySQL (backticks, AUTO_INCREMENT, ENGINE=InnoDB) aunque el botón
// decía "MySQL" — el nombre del botón ya reflejaba la realidad, lo que
// estaba mal era que ese script nunca iba a correr contra el Postgres real
// de este mismo proyecto. Ver documentacion/03-generadores-codigo.md para el
// detalle de qué cambió y por qué.

import { checkNormalization } from './schemaNormalizationChecker.js';
import { openModal, alertDialog } from './modal.js';

export class SimpleSQLGenerator {
    constructor(editor) {
        this.editor = editor;
        this.typeMapping = {
            'String': 'VARCHAR(255)',
            'int': 'INTEGER',
            'Integer': 'INTEGER',
            'long': 'BIGINT',
            'Long': 'BIGINT',
            'double': 'DECIMAL(10,2)',
            'Double': 'DECIMAL(10,2)',
            'float': 'REAL',
            'Float': 'REAL',
            'boolean': 'BOOLEAN',
            'Boolean': 'BOOLEAN',
            // MySQL usa DATETIME — Postgres no tiene ese tipo, es TIMESTAMP.
            'Date': 'TIMESTAMP',
            'LocalDateTime': 'TIMESTAMP',
            'LocalDate': 'DATE',
            'BigDecimal': 'DECIMAL(15,2)',
            'char': 'CHAR(1)',
            'Character': 'CHAR(1)',
            // MySQL usa BLOB — el tipo binario de Postgres es BYTEA.
            'byte[]': 'BYTEA',
            'text': 'TEXT'
        };
    }

    generateSQL() {
        try {
            console.log('🗄️ Iniciando generación de SQL...');

            const classes = this.extractClassesForSQL();
            console.log('📊 Clases extraídas:', classes);

            const relationships = this.extractRelationshipsForSQL();
            console.log('🔗 Relaciones extraídas:', relationships);

            const issues = checkNormalization(classes, this.associationClassesOf(relationships, classes));

            if (issues.length > 0) {
                this.showNormalizationReport(issues, classes, relationships);
                return;
            }

            this.finishGeneration(classes, relationships, []);
        } catch (error) {
            console.error('❌ Error en generación SQL:', error);
            alertDialog({ tone: 'error', title: 'No se pudo generar el SQL', message: error.message });
        }
    }

    finishGeneration(classes, relationships, issues) {
        const sqlScript = this.normalizationHeader(issues) + this.buildSQLScript(classes, relationships);
        this.downloadSQL(sqlScript, 'database_schema.sql');

        this.editor.aiChat?.activityTracker?.push([{
            action: 'EXPORT',
            summary: issues.length > 0
                ? `generó el script SQL con ${issues.length} observaciones de normalización sin corregir`
                : 'generó el script SQL, sin observaciones de normalización',
        }]);

        console.log('✅ Generación SQL completada');
    }

    normalizationHeader(issues) {
        if (issues.length === 0) {
            return '-- Verificación de formas normales: sin observaciones.\n\n';
        }

        const lines = issues.map((issue) => `--   [${issue.form}] ${issue.className}: ${issue.problem}`);
        return `-- ATENCIÓN: se generó con observaciones de normalización sin corregir:\n${lines.join('\n')}\n\n`;
    }

    associationClassesOf(relationships, classes) {
        return relationships
            .filter((rel) => rel.associationClassTable)
            .map((rel) => ({
                associationClass: classes.find((c) => c.tableName === rel.associationClassTable)?.className,
                sourceClass: rel.sourceClass,
                targetClass: rel.targetClass,
            }));
    }

    /** Antes de generar: mostrar qué incumple y dejar elegir qué hacer. */
    showNormalizationReport(issues, classes, relationships) {
        const { dialog, close } = openModal(`
            <div class="normalization-report">
                <h3 class="normalization-title">El modelo no cumple las formas normales</h3>
                <p class="normalization-intro"></p>
                <ul class="normalization-list"></ul>
                <div class="normalization-actions">
                    <button type="button" class="btn btn-secondary" data-action="cancel">Cancelar</button>
                    <button type="button" class="btn btn-secondary" data-action="generate">Generar igual</button>
                    <button type="button" class="btn btn-primary" data-action="agent">Pedir corrección al asistente</button>
                </div>
            </div>
        `, { id: 'normalization-report', maxWidth: '560px', closeOnOverlayClick: true });

        dialog.querySelector('.normalization-intro').textContent = issues.length === 1
            ? 'Hay 1 observación antes de generar la base de datos.'
            : `Hay ${issues.length} observaciones antes de generar la base de datos.`;

        const list = dialog.querySelector('.normalization-list');
        issues.forEach((issue) => {
            const item = document.createElement('li');
            const heading = document.createElement('strong');
            heading.textContent = `${issue.form} · ${issue.className}`;
            const problem = document.createElement('div');
            problem.textContent = issue.problem;
            const suggestion = document.createElement('div');
            suggestion.className = 'normalization-suggestion';
            suggestion.textContent = issue.suggestion;
            item.append(heading, problem, suggestion);
            list.appendChild(item);
        });

        dialog.querySelector('[data-action="cancel"]').addEventListener('click', close);
        dialog.querySelector('[data-action="generate"]').addEventListener('click', () => {
            close();
            this.finishGeneration(classes, relationships, issues);
        });
        dialog.querySelector('[data-action="agent"]').addEventListener('click', () => {
            close();
            this.askAgentToFix(issues);
        });
    }

    askAgentToFix(issues) {
        const chat = this.editor.aiChat;
        const detail = issues.map((issue) => `${issue.form} en ${issue.className}: ${issue.problem}`).join(' ');

        chat?.showTab('ai');
        chat?.handleUserCommand(`Corrige en el diagrama estos incumplimientos de normalización: ${detail}`, 'text');
    }

    extractClassesForSQL() {
        const classes = [];
        const elements = this.editor.graph.getElements();

        elements.forEach(element => {
            const umlData = element.get('umlData');
            console.log('🔍 Elemento encontrado:', {
                id: element.id,
                umlData: umlData
            });

            if (umlData && umlData.type === 'class') {
                // Sanitizar el nombre ANTES de derivar el nombre de tabla —
                // un nombre con espacios u otros caracteres (ej. una clase
                // huérfana "Class 1") generaba un identificador SQL con
                // espacio adentro. Con las comillas invertidas de MySQL eso
                // "colaba" sin error de sintaxis (backtick-quoted admite casi
                // cualquier caracter) — con identificadores sin comillas
                // (que es lo que este archivo genera ahora, ver más abajo)
                // un espacio rompe la sentencia. Mismo criterio que
                // `SimpleJavaGenerator.sanitizeJavaIdentifier()`, solo que acá
                // alcanza con un identificador SQL válido (no hace falta que
                // sea válido como identificador Java).
                const className = this.sanitizeSqlName(umlData.className, 'Entidad');
                const tableName = this.classNameToTableName(className);

                classes.push({
                    id: element.id,
                    className: className,
                    tableName: tableName,
                    attributes: umlData.attributes || [],
                    derivedAttributes: umlData.uml25?.derivedAttributes || [],
                    methods: umlData.methods || [],
                    stereotype: umlData.uml25?.stereotype || null
                });
            }
        });

        console.log('🏗️ Clases para SQL extraídas:', classes.length);
        return classes;
    }

    extractRelationshipsForSQL() {
        const relationships = [];
        const links = this.editor.graph.getLinks();

        console.log(`🔍 Total de links encontrados: ${links.length}`);

        links.forEach(link => {
            // OJO: getSourceElement()/getTargetElement() de JointJS NO dan
            // null para un link "clase asociativa" (target = otro link) —
            // resuelven recursivamente a través del link host hasta un
            // elemento real, colándose acá como una relación fantasma con
            // multiplicidades vacías. Excluir por relationData.type, no
            // confiar en que source/target den null.
            if ((link.get('relationData') || {}).type === 'associationClassLink') return;

            const source = link.getSourceElement();
            const target = link.getTargetElement();

            // Probar diferentes formas de obtener los datos de la relación
            const umlData = link.get('umlData') || {};
            const relationData = link.get('relationData') || {};
            const attrs = link.get('attrs') || {};
            const labels = link.get('labels') || [];
            const linkData = { ...umlData, ...relationData };

            console.log('🔍 Link encontrado:', {
                id: link.id,
                umlData: umlData,
                relationData: relationData,
                attrs: attrs,
                labels: labels,
                linkData: linkData,
                source: source?.id,
                target: target?.id,
                // Probar todas las propiedades posibles
                allProps: {
                    type: link.get('type'),
                    relationshipType: linkData.relationshipType || umlData.relationshipType || relationData.type,
                    sourceMultiplicity: linkData.sourceMultiplicity || umlData.sourceMultiplicity,
                    targetMultiplicity: linkData.targetMultiplicity || umlData.targetMultiplicity
                }
            });

            if (source && target) {
                const sourceUml = source.get('umlData');
                const targetUml = target.get('umlData');

                if (sourceUml?.type === 'class' && targetUml?.type === 'class') {
                    // Intentar múltiples formas de obtener el tipo de relación
                    let relationshipType =
                        linkData.relationshipType ||
                        linkData.type ||
                        umlData.relationshipType ||
                        relationData.type ||
                        relationData.relationshipType ||
                        link.get('type') ||
                        'association';

                    // Si el tipo es 'standard.Link', buscar en otras propiedades
                    if (relationshipType === 'standard.Link') {
                        // Buscar en labels si tiene información del tipo
                        const labelText = labels.map(label => label.attrs?.text?.text).join(' ');
                        if (labelText.includes('inheritance') || labelText.includes('herencia')) {
                            relationshipType = 'inheritance';
                        } else if (labelText.includes('composition')) {
                            relationshipType = 'composition';
                        } else if (labelText.includes('aggregation')) {
                            relationshipType = 'aggregation';
                        }
                    }

                    // Mismo saneo que extractClassesForSQL() — si no coincide
                    // carácter a carácter con `cls.className`/`cls.tableName`,
                    // analyzeForeignKeyRelationship() y el resto de los
                    // lookups por nombre de tabla dejan de encontrar la
                    // clase correspondiente.
                    const sourceClassName = this.sanitizeSqlName(sourceUml.className, 'Entidad');
                    const targetClassName = this.sanitizeSqlName(targetUml.className, 'Entidad');

                    const relationship = {
                        id: link.id,
                        sourceId: source.id,
                        targetId: target.id,
                        sourceClass: sourceClassName,
                        targetClass: targetClassName,
                        sourceTable: this.classNameToTableName(sourceClassName),
                        targetTable: this.classNameToTableName(targetClassName),
                        type: relationshipType,
                        sourceMultiplicity: linkData.sourceMultiplicity || umlData.sourceMultiplicity || relationData.sourceMultiplicity || '',
                        targetMultiplicity: linkData.targetMultiplicity || umlData.targetMultiplicity || relationData.targetMultiplicity || '',
                        name: linkData.name || linkData.relationName || umlData.name || relationData.name || ''
                    };

                    relationships.push(relationship);
                    console.log('✅ Relación agregada:', relationship);
                }
            }
        });

        // Clases asociativas (notación UML real — ver
        // DiagramElementFactory.isAssociationClassLink): su target es OTRO
        // LINK, no una clase, así que el loop de arriba las salta solas
        // (getTargetElement() da null). Se procesan aparte: por cada una,
        // se marca la asociación M:N host (ya extraída arriba, por id) con
        // el nombre de tabla de la clase asociativa — generateAssociationForeignKeys()
        // lo usa para generar FKs reales en esa tabla en vez del comentario
        // placeholder de "tabla intermedia" (que sigue siendo lo que se
        // genera para un M:N SIN clase asociativa colgada, eso no cambió).
        //
        // Importante: esta clase asociativa NO tiene PK compuesta — sigue
        // siendo una tabla más del montón, con su propio `id SERIAL` (ya
        // generado como cualquier otra clase en generateCreateTable) más las
        // dos FK que se agregan acá. Full CRUD igual que cualquier tabla,
        // la única diferencia real es que estas dos columnas FK no son
        // nullable. Decisión ya documentada en 06-asistente-ia.md §9.4 — no
        // se modela como PK/FK compuesta (@IdClass/@EmbeddedId) a propósito.
        links.forEach(link => {
            const relationData = link.get('relationData') || {};
            if (relationData.type !== 'associationClassLink') return;

            const classElement = link.getSourceElement();
            const hostLinkId = link.get('target')?.id;
            if (!classElement || !hostLinkId) return;

            const hostRelationship = relationships.find(r => r.id === hostLinkId);
            if (!hostRelationship) return;

            const classUml = classElement.get('umlData');
            const associativeClassName = this.sanitizeSqlName(classUml?.className, 'Entidad');
            hostRelationship.associationClassTable = this.classNameToTableName(associativeClassName);
        });

        console.log('🔗 Relaciones para SQL extraídas:', relationships.length);
        return relationships;
    }

    buildSQLScript(classes, relationships) {
        const timestamp = new Date().toISOString();

        let sql = `-- ===============================================
-- Database Schema Generated from UML Diagram
-- Generated: ${timestamp}
-- Tool: Laravel UML Diagrammer
-- Dialecto: PostgreSQL
-- ===============================================

BEGIN;

`;

        // Separar herencias de otras relaciones
        const inheritances = relationships.filter(rel =>
            rel.type === 'inheritance' || rel.type === 'generalization'
        );
        const associations = relationships.filter(rel =>
            rel.type !== 'inheritance' && rel.type !== 'generalization'
        );

        console.log('🧬 Herencias detectadas:', inheritances);
        console.log('🔗 Asociaciones detectadas:', associations);

        // Generate CREATE TABLE statements
        sql += this.generateCreateTables(classes, inheritances);

        // Función + triggers para mantener `updated_at` al día (reemplaza al
        // "ON UPDATE CURRENT_TIMESTAMP" de MySQL, que Postgres no tiene)
        sql += this.generateUpdatedAtTriggers(classes);

        // Generate FOREIGN KEY constraints for inheritance
        sql += this.generateInheritanceForeignKeys(inheritances);

        // Generate FOREIGN KEY constraints for associations
        sql += this.generateAssociationForeignKeys(associations, classes);

        // Generate optimized indexes
        sql += this.generateOptimizedIndexes(classes);

        // Generate useful views for inheritance
        sql += this.generateUsefulViews(classes, inheritances);

        // Generate sample INSERT statements
        sql += this.generateSampleData(classes);

        sql += `
COMMIT;

-- ===============================================
-- End of generated schema
-- ===============================================
`;

        return sql;
    }

    generateCreateTables(classes, inheritances) {
        let sql = `-- ===============================================
-- CREATE TABLES
-- ===============================================

`;

        // Separar clases padre e hijas para orden de creación
        const childTableNames = inheritances.map(inh => inh.sourceTable);
        const parentClasses = classes.filter(cls => !childTableNames.includes(cls.tableName));
        const childClasses = classes.filter(cls => childTableNames.includes(cls.tableName));

        // Crear primero las clases padre
        parentClasses.forEach(cls => {
            sql += this.generateCreateTable(cls, null);
        });

        // Luego las clases hijas con FK a padre
        childClasses.forEach(cls => {
            const inheritance = inheritances.find(inh => inh.sourceTable === cls.tableName);
            sql += this.generateCreateTable(cls, inheritance);
        });

        return sql;
    }

    generateCreateTable(cls, inheritance = null) {
        const tableName = cls.tableName;
        let sql = `-- Table: ${tableName} (from class ${cls.className})`;

        if (inheritance) {
            sql += ` - hereda de ${inheritance.targetTable}`;
        }

        sql += `\nCREATE TABLE ${tableName} (
    id SERIAL PRIMARY KEY,\n`;

        // Si es herencia, añadir FK al padre
        if (inheritance) {
            const parentSingular = this.getTableNameSingular(inheritance.targetTable);
            sql += `    ${parentSingular}_id INTEGER NOT NULL UNIQUE, -- FK a ${inheritance.targetTable} (herencia)\n`;
        }

        // Process attributes
        cls.attributes.forEach(attr => {
            const column = this.parseAttributeForSQL(attr);
            if (column) {
                sql += `    ${column.name} ${column.type}${column.nullable ? '' : ' NOT NULL'},\n`;
            }
        });

        // Add common audit fields
        sql += `    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

`;

        return sql;
    }

    /**
     * Postgres no tiene "ON UPDATE CURRENT_TIMESTAMP" (eso es sintaxis
     * MySQL) — el equivalente real es una función `set_updated_at()`
     * compartida (se define UNA sola vez) más un trigger `BEFORE UPDATE`
     * por tabla que la invoca. Sin esto, `updated_at` se hubiera quedado
     * fijo en la fecha de creación para siempre después del primer UPDATE.
     */
    generateUpdatedAtTriggers(classes) {
        if (classes.length === 0) return '';

        let sql = `-- ===============================================
-- TRIGGERS: mantener "updated_at" al día
-- ===============================================
-- Postgres no soporta "ON UPDATE CURRENT_TIMESTAMP" como MySQL — se logra
-- lo mismo con esta función compartida + un trigger por tabla.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

`;

        classes.forEach(cls => {
            sql += `CREATE TRIGGER trg_${cls.tableName}_updated_at
BEFORE UPDATE ON ${cls.tableName}
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

`;
        });

        return sql;
    }

    generateInheritanceForeignKeys(inheritances) {
        if (inheritances.length === 0) {
            return `-- ===============================================
-- FOREIGN KEY CONSTRAINTS - HERENCIAS
-- ===============================================
-- No se detectaron relaciones de herencia

`;
        }

        let sql = `-- ===============================================
-- FOREIGN KEY CONSTRAINTS - HERENCIAS
-- ===============================================

`;

        inheritances.forEach(inh => {
            const parentSingular = this.getTableNameSingular(inh.targetTable);
            sql += `-- Herencia: ${inh.sourceClass} hereda de ${inh.targetClass}
ALTER TABLE ${inh.sourceTable}
ADD CONSTRAINT fk_${inh.sourceTable}_${parentSingular}
FOREIGN KEY (${parentSingular}_id) REFERENCES ${inh.targetTable} (id)
ON DELETE CASCADE ON UPDATE CASCADE;

`;
        });

        return sql;
    }

    generateAssociationForeignKeys(associations, classes) {
        if (associations.length === 0) {
            return `-- ===============================================
-- FOREIGN KEY CONSTRAINTS - ASOCIACIONES
-- ===============================================
-- No se detectaron relaciones de asociación

`;
        }

        let sql = `-- ===============================================
-- FOREIGN KEY CONSTRAINTS - ASOCIACIONES
-- ===============================================

`;

        associations.forEach(rel => {
            console.log('🔧 Procesando relación:', rel);

            if (rel.associationClassTable) {
                // Clase asociativa real (ver extractRelationshipsForSQL): la
                // asociación M:N en sí no genera tabla propia — la clase
                // asociativa YA existe como tabla normal (se generó junto
                // con el resto de las clases) — acá se agregan las DOS FK
                // reales hacia ella, una por cada extremo de la asociación.
                // Mismo resultado final que el viejo workaround de "clase
                // intermedia + 2 relaciones 1:N" generaba, ahora derivado
                // del link de notación real en vez de necesitar dos
                // relaciones dibujadas a mano.
                let sourceCol = `${this.getTableNameSingular(rel.sourceTable)}_id`;
                let targetCol = `${this.getTableNameSingular(rel.targetTable)}_id`;
                if (sourceCol === targetCol) {
                    // Autorrelación (la clase asociativa conecta una clase
                    // consigo misma) — sin esto las dos columnas colisionan.
                    sourceCol = `${this.getTableNameSingular(rel.sourceTable)}_origen_id`;
                    targetCol = `${this.getTableNameSingular(rel.targetTable)}_destino_id`;
                }

                sql += `-- Clase asociativa: ${rel.associationClassTable} conecta ${rel.sourceClass} <-> ${rel.targetClass}
ALTER TABLE ${rel.associationClassTable}
ADD COLUMN ${sourceCol} INTEGER NOT NULL,
ADD COLUMN ${targetCol} INTEGER NOT NULL;

ALTER TABLE ${rel.associationClassTable}
ADD CONSTRAINT fk_${rel.associationClassTable}_${rel.sourceTable}
FOREIGN KEY (${sourceCol}) REFERENCES ${rel.sourceTable} (id)
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE ${rel.associationClassTable}
ADD CONSTRAINT fk_${rel.associationClassTable}_${rel.targetTable}
FOREIGN KEY (${targetCol}) REFERENCES ${rel.targetTable} (id)
ON DELETE CASCADE ON UPDATE CASCADE;

`;
                return;
            }

            const fkInfo = this.analyzeForeignKeyRelationship(rel, classes);
            console.log('🔑 FK Info generada:', fkInfo);

            if (fkInfo) {
                // Si necesitamos añadir la columna FK
                if (fkInfo.addColumn) {
                    sql += `-- Añadir columna FK para ${fkInfo.description}
ALTER TABLE ${fkInfo.childTable}
ADD COLUMN ${fkInfo.foreignKeyColumn} INTEGER${fkInfo.nullable ? '' : ' NOT NULL'};

`;
                }

                sql += `-- ${fkInfo.description}
ALTER TABLE ${fkInfo.childTable}
ADD CONSTRAINT fk_${fkInfo.childTable}_${fkInfo.parentTable}
FOREIGN KEY (${fkInfo.foreignKeyColumn}) REFERENCES ${fkInfo.parentTable} (id)
ON DELETE ${fkInfo.onDelete} ON UPDATE CASCADE;

`;
            } else if (rel.type === 'association' &&
                       (rel.sourceMultiplicity.includes('*') && rel.targetMultiplicity.includes('*'))) {
                // Una relación muchos a muchos sin tabla intermedia no se puede
                // representar en primera forma normal.
                const table1Singular = this.getTableNameSingular(rel.sourceTable);
                const table2Singular = this.getTableNameSingular(rel.targetTable);
                const joinTable = `${table1Singular}_${table2Singular}`;
                const isSelfRelation = table1Singular === table2Singular;
                const sourceColumn = isSelfRelation ? `${table1Singular}_origen_id` : `${table1Singular}_id`;
                const targetColumn = isSelfRelation ? `${table2Singular}_destino_id` : `${table2Singular}_id`;

                sql += `-- Relación muchos a muchos: ${rel.sourceClass} <-> ${rel.targetClass}
CREATE TABLE ${joinTable} (
    ${sourceColumn} INTEGER NOT NULL,
    ${targetColumn} INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (${sourceColumn}, ${targetColumn}),
    FOREIGN KEY (${sourceColumn}) REFERENCES ${rel.sourceTable} (id) ON DELETE CASCADE,
    FOREIGN KEY (${targetColumn}) REFERENCES ${rel.targetTable} (id) ON DELETE CASCADE
);

CREATE TRIGGER trg_${joinTable}_updated_at
BEFORE UPDATE ON ${joinTable}
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

`;
            }
        });

        return sql;
    }

    analyzeForeignKeyRelationship(rel, classes) {
        // Realización y dependencia no son relaciones estructurales (no
        // implican que una tabla necesite una columna/FK hacia la otra) —
        // sin esto, con multiplicidad vacía caían por defecto en la rama
        // "uno a uno" de abajo y generaban una FK espuria.
        if (rel.type === 'realization' || rel.type === 'dependency') {
            return null;
        }

        const sourceClass = classes.find(c => c.id === rel.sourceId);
        const targetClass = classes.find(c => c.id === rel.targetId);

        if (!sourceClass || !targetClass) {
            console.warn('⚠️ No se encontraron clases para relación:', rel);
            return null;
        }

        let fkInfo = null;
        const sourceMultiplicity = rel.sourceMultiplicity || '';
        const targetMultiplicity = rel.targetMultiplicity || '';

        console.log(`🔍 Analizando relación ${rel.type}: ${sourceClass.className}(${sourceMultiplicity}) -> ${targetClass.className}(${targetMultiplicity})`);

        // Lógica mejorada basada en multiplicidad
        if (targetMultiplicity.includes('1') && sourceMultiplicity.includes('*')) {
            // Muchos a uno: FK en tabla source hacia target
            fkInfo = {
                childTable: sourceClass.tableName,
                parentTable: targetClass.tableName,
                foreignKeyColumn: `${this.getTableNameSingular(targetClass.tableName)}_id`,
                description: `${rel.type}: ${sourceClass.className} (*) -> ${targetClass.className} (1)`,
                onDelete: rel.type === 'composition' ? 'CASCADE' : 'RESTRICT',
                addColumn: true,
                nullable: rel.type === 'aggregation'
            };
        } else if (sourceMultiplicity.includes('1') && targetMultiplicity.includes('*')) {
            // Uno a muchos: FK en tabla target hacia source
            fkInfo = {
                childTable: targetClass.tableName,
                parentTable: sourceClass.tableName,
                foreignKeyColumn: `${this.getTableNameSingular(sourceClass.tableName)}_id`,
                description: `${rel.type}: ${sourceClass.className} (1) -> ${targetClass.className} (*)`,
                onDelete: rel.type === 'composition' ? 'CASCADE' : 'RESTRICT',
                addColumn: true,
                nullable: rel.type === 'aggregation'
            };
        } else if (!sourceMultiplicity.includes('*') && !targetMultiplicity.includes('*')) {
            // Uno a uno: FK en tabla source hacia target (por convención)
            fkInfo = {
                childTable: sourceClass.tableName,
                parentTable: targetClass.tableName,
                foreignKeyColumn: `${this.getTableNameSingular(targetClass.tableName)}_id`,
                description: `${rel.type}: ${sourceClass.className} (1) -> ${targetClass.className} (1)`,
                onDelete: rel.type === 'composition' ? 'CASCADE' : 'SET NULL',
                addColumn: true,
                nullable: true
            };
        } else if (sourceMultiplicity.includes('*') && targetMultiplicity.includes('*')) {
            // Muchos a muchos: requiere tabla intermedia
            console.log('🔄 Relación muchos a muchos detectada, requiere tabla intermedia');
            return null;
        }

        console.log('✅ FK Info creada:', fkInfo);
        return fkInfo;
    }

    generateOptimizedIndexes(classes) {
        let sql = `-- ===============================================
-- ÍNDICES OPTIMIZADOS
-- ===============================================

`;

        classes.forEach(cls => {
            // Índices para campos únicos comunes
            const commonUniqueFields = ['email', 'codigo', 'numero_est', 'codigo_emp'];

            cls.attributes.forEach(attr => {
                const column = this.parseAttributeForSQL(attr);
                if (column && commonUniqueFields.some(field => column.name.includes(field))) {
                    sql += `CREATE INDEX idx_${cls.tableName}_${column.name} ON ${cls.tableName} (${column.name});\n`;
                }
            });
        });

        sql += '\n';
        return sql;
    }

    generateUsefulViews(classes, inheritances) {
        if (inheritances.length === 0) {
            return `-- ===============================================
-- VISTAS ÚTILES
-- ===============================================
-- No se generaron vistas (sin herencias detectadas)

`;
        }

        let sql = `-- ===============================================
-- VISTAS ÚTILES
-- ===============================================

`;

        inheritances.forEach(inh => {
            const childClass = classes.find(c => c.tableName === inh.sourceTable);
            const parentSingular = this.getTableNameSingular(inh.targetTable);

            if (childClass) {
                sql += `-- Vista completa: ${inh.sourceClass} con datos de ${inh.targetClass}
CREATE VIEW v_${inh.sourceTable}_completos AS
SELECT
    c.*,
    p.*
FROM ${inh.sourceTable} c
JOIN ${inh.targetTable} p ON c.${parentSingular}_id = p.id;

`;
            }
        });

        return sql;
    }

    getTableNameSingular(pluralTableName) {
        // Pluralización simple: quitar la 's' final si existe
        if (pluralTableName.endsWith('s')) {
            return pluralTableName.slice(0, -1);
        }
        return pluralTableName;
    }

    classNameToTableName(className) {
        // Convert PascalCase to snake_case and make plural
        return this.camelToSnakeCase(className) + 's';
    }

    /**
     * Reduce un nombre arbitrario a un identificador SQL válido sin
     * comillas: solo letras/dígitos/guion bajo, nunca arranca con dígito.
     * Mismo motivo que `SimpleJavaGenerator.sanitizeJavaIdentifier()` — este
     * archivo generaba antes identificadores entre backticks (MySQL), que
     * toleran casi cualquier caracter adentro (incluido un espacio, como en
     * una clase huérfana "Class 1"); al pasar a identificadores SIN comillas
     * (más simple y suficiente, ya que `camelToSnakeCase` ya deja todo en
     * snake_case) un espacio o guion rompe la sentencia SQL.
     */
    sanitizeSqlName(rawName, fallback) {
        let id = String(rawName || '').replace(/[^A-Za-z0-9_]/g, '');
        if (!id) id = fallback;
        if (/^[0-9]/.test(id)) id = '_' + id;
        return id;
    }

    parseAttributeForSQL(attributeString) {
        // Antes exigía un ":" en el string (regex con `:` obligatorio) — un
        // atributo creado en el panel SIN tipo se guarda sin colon en
        // absoluto (ver `DiagramElementFactory.serializeAttributeLine()`),
        // así que el regex no matcheaba y la función devolvía `null` — el
        // atributo se descartaba en SILENCIO (ni una fila de log), la
        // columna simplemente no existía en la tabla generada. Mismo
        // criterio que el fix en `SimpleJavaGenerator.parseAttribute()`:
        // separar visibilidad y ":" por separado en vez de un solo regex
        // todo-o-nada, y usar VARCHAR(255) (vía mapUMLTypeToSQL) cuando no
        // hay tipo en vez de perder la columna.
        const trimmed = String(attributeString || '').trim();
        const visibilityMatch = trimmed.match(/^([+\-#~])\s*(.*)$/);
        const visibility = visibilityMatch ? visibilityMatch[1] : '+';
        const rest = visibilityMatch ? visibilityMatch[2] : trimmed;
        if (!rest) return null;

        const colonIdx = rest.lastIndexOf(':');
        const rawName = colonIdx === -1 ? rest : rest.slice(0, colonIdx).trim();
        const type = colonIdx === -1 ? '' : rest.slice(colonIdx + 1).trim();
        if (!rawName) return null;

        // Convert to snake_case for database
        const columnName = this.sanitizeSqlName(this.camelToSnakeCase(rawName), 'campo');
        const sqlType = this.mapUMLTypeToSQL(type || 'String');

        return {
            name: columnName,
            type: sqlType,
            nullable: visibility === '-' ? false : true // Private attributes are NOT NULL
        };
    }

    camelToSnakeCase(str) {
        return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/_{2,}/g, '_').replace(/^_/, '');
    }

    mapUMLTypeToSQL(umlType) {
        // Handle generic types like List<String>
        const baseType = umlType.replace(/<.*>/, '').trim();

        // Handle arrays
        if (umlType.includes('[]')) {
            return 'JSONB'; // Postgres: JSONB para arrays (ver 00-general.md, ya se usa JSONB en el resto del proyecto)
        }

        // Handle collections
        if (baseType.includes('List') || baseType.includes('Set') || baseType.includes('Collection')) {
            return 'JSONB'; // Postgres: JSONB para colecciones
        }

        return this.typeMapping[baseType] || 'VARCHAR(255)';
    }

    generateSampleData(classes) {
        let sql = `-- ===============================================
-- SAMPLE DATA (Optional - Remove if not needed)
-- ===============================================

`;

        classes.forEach(cls => {
            sql += `-- Sample data for ${cls.tableName}
-- INSERT INTO ${cls.tableName} (column1, column2) VALUES ('value1', 'value2');

`;
        });

        return sql;
    }

    downloadSQL(content, filename) {
        const blob = new Blob([content], { type: 'text/sql' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(() => URL.revokeObjectURL(url), 100);

        console.log('📥 Descarga SQL iniciada:', filename);
    }

    // Método estático para uso rápido
    static quickGenerateSQL(editor) {
        const generator = new SimpleSQLGenerator(editor);
        generator.generateSQL();
    }
}
