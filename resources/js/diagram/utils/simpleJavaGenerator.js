// resources/js/diagram/utils/simpleJavaGenerator.js
// Generador simple de proyectos Spring Boot desde diagramas UML

import JSZip from 'jszip';

export class SimpleJavaGenerator {
    constructor(editor) {
        this.editor = editor;
        this.packageName = 'com.proyecto';
        this.projectName = 'mi-proyecto';
        this.groupId = 'com.proyecto';
        this.artifactId = 'mi-proyecto-spring-boot';
        this.version = '1.0.0';
    }

    async generateJavaProject() {
        try {
            console.log('☕ Iniciando generación de proyecto Spring Boot...');

            // Configurar proyecto básico
            this.setupProjectConfig();

            // Extraer clases y relaciones del diagrama
            const classes = this.extractClasses();
            this.relationships = this.extractRelationships();

            if (classes.length === 0) {
                alert('⚠️ No hay clases en el diagrama para generar código.');
                return;
            }

            // Generar proyecto completo
            const zip = await this.buildSpringBootProject(classes, this.relationships);

            // Descargar
            this.downloadProject(zip);

            console.log('✅ Proyecto Spring Boot generado exitosamente');
        } catch (error) {
            console.error('❌ Error generando proyecto Java:', error);
            alert('Error al generar proyecto: ' + error.message);
        }
    }

    setupProjectConfig() {
        // Obtener título del diagrama si está disponible
        const diagramTitle = window.diagramTitle || 'MiProyecto';
        this.projectName = this.sanitizeProjectName(diagramTitle);
        this.artifactId = this.projectName.toLowerCase().replace(/\s+/g, '-');
        this.packageName = `com.${this.artifactId.replace(/-/g, '')}`;

        console.log('🏗️ Configuración del proyecto:', {
            projectName: this.projectName,
            packageName: this.packageName,
            artifactId: this.artifactId
        });
    }

    detectAuthenticationEntities(classes) {
        // Patrones de detección
        const USER_PATTERNS = ['user', 'usuario', 'account', 'cuenta', 'cliente', 'client'];
        const EMAIL_PATTERNS = ['email', 'correo', 'mail', 'e-mail'];
        const PASSWORD_PATTERNS = ['password', 'contraseña', 'clave', 'pass', 'pwd'];

        // Buscar entidad de usuario
        const userEntity = classes.find(cls => {
            const className = cls.name.toLowerCase();
            return USER_PATTERNS.some(pattern => className.includes(pattern));
        });

        if (!userEntity) {
            console.log('❌ No se encontró entidad de usuario');
            return { needsAuth: false };
        }

        console.log('✅ Entidad de usuario encontrada:', userEntity.name);

        // Verificar si tiene campos de email y password
        const attributes = userEntity.attributes.map(attr => attr.toLowerCase());

        const hasEmail = attributes.some(attr =>
            EMAIL_PATTERNS.some(pattern => attr.includes(pattern))
        );

        const hasPassword = attributes.some(attr =>
            PASSWORD_PATTERNS.some(pattern => attr.includes(pattern))
        );

        console.log('📧 Tiene email:', hasEmail);
        console.log('🔒 Tiene password:', hasPassword);

        if (hasEmail && hasPassword) {
            console.log('🎉 Sistema de autenticación será generado automáticamente');
            return {
                needsAuth: true,
                userEntity: userEntity,
                emailField: this.findFieldName(userEntity.attributes, EMAIL_PATTERNS),
                passwordField: this.findFieldName(userEntity.attributes, PASSWORD_PATTERNS)
            };
        }

        console.log('⚠️ Faltan campos necesarios para autenticación');
        return { needsAuth: false };
    }

    findFieldName(attributes, patterns) {
        const foundAttr = attributes.find(attr => {
            const attrLower = attr.toLowerCase();
            return patterns.some(pattern => attrLower.includes(pattern));
        });

        if (foundAttr) {
            const parsed = this.parseAttribute(foundAttr);
            return parsed.name;
        }

        return null;
    }

    extractClasses() {
        const classes = [];
        const elements = this.editor.graph.getElements();

        elements.forEach(element => {
            const umlData = element.get('umlData');
            if (umlData && umlData.type === 'class') {
                // Sanitizar SIEMPRE el nombre de la clase antes de usarlo como
                // identificador Java (nombre de clase, de archivo, de campo de
                // relación en otras entidades, etc.) — un nombre con espacios
                // u otros caracteres inválidos (ej. "Class 1", pegado como
                // clase huérfana de una prueba) generaba "public class Class
                // 1Controller {" y variantes: Java ve "1Controller" como un
                // token que empieza con dígito, un identificador inválido, y
                // el compilador tira una cascada de errores de sintaxis desde
                // ahí en más. Se sanitiza acá, una sola vez, para que TODO lo
                // que lee `cls.name` después (archivo, clase, campos de
                // relación en otras clases) ya reciba el nombre limpio.
                const className = this.sanitizeJavaIdentifier(umlData.className, 'Entidad');
                const stereotype = umlData.uml25?.stereotype || 'entity'; // Default a entity

                classes.push({
                    id: element.id,
                    name: className,
                    stereotype: stereotype,
                    attributes: umlData.attributes || [],
                    methods: umlData.methods || [],
                    responsibilities: umlData.uml25?.responsibilities || [],
                    constraints: umlData.uml25?.constraints || [],
                    isAbstract: umlData.uml25?.isAbstract || false
                });
            }
        });

        console.log('🏗️ Clases extraídas:', classes.length, 'con estereotipos:',
            classes.map(c => `${c.name}(${c.stereotype})`));
        return classes;
    }

extractRelationships() {
    const relationships = [];
    const links = this.editor.graph.getLinks();

    links.forEach(link => {
        const relationData = link.get('relationData') || {}; // AGREGAR ESTA LÍNEA

        // OJO: getSourceElement()/getTargetElement() de JointJS NO dan null
        // para un link "clase asociativa" (target = otro link) — resuelven
        // recursivamente a través del link host hasta un elemento real,
        // colándose acá como una relación fantasma sin multiplicidad.
        // Excluir por relationData.type, no confiar en que den null.
        if (relationData.type === 'associationClassLink') return;

        const source = link.getSourceElement();
        const target = link.getTargetElement();
        const umlData = link.get('umlData') || {};

        if (source && target) {
            const sourceUml = source.get('umlData');
            const targetUml = target.get('umlData');

            if (sourceUml?.type === 'class' && targetUml?.type === 'class') {
                relationships.push({
                    id: link.id,
                    // Mismo saneo que extractClasses() para el nombre de
                    // clase — si no coincide con `cls.name` carácter a
                    // carácter, el filtro por sourceClass/targetClass en
                    // generateEntity() nunca matchea y la entidad queda sin
                    // sus relaciones (bug real: un nombre con espacio se
                    // sanitizaba en un lado sí y en el otro no).
                    sourceClass: this.sanitizeJavaIdentifier(sourceUml.className, 'Entidad'),
                    targetClass: this.sanitizeJavaIdentifier(targetUml.className, 'Entidad'),
                    type: relationData.type || umlData.relationshipType || umlData.type || 'association', // CAMBIAR ESTA LÍNEA
                    sourceMultiplicity: umlData.sourceMultiplicity || relationData.sourceMultiplicity || '',
                    targetMultiplicity: umlData.targetMultiplicity || relationData.targetMultiplicity || ''
                });
            }
        }
    });

    // Clases asociativas (notación UML real — ver
    // DiagramElementFactory.isAssociationClassLink): la asociación M:N
    // (*/*) que quedó arriba no genera ningún campo (ningún caso de
    // generateRelationshipSide matchea */*, se ignora en silencio) — se
    // reemplaza acá por el mismo patrón que generaba el viejo workaround
    // manual de "clase intermedia + 2 relaciones 1:N": dos relaciones
    // sintéticas 1↔0..* desde cada clase original hacia la clase
    // asociativa, reusando el camino 1↔* YA probado de
    // generateRelationshipSide() en vez de escribir mapeo JPA nuevo.
    links.forEach(link => {
        const relationData = link.get('relationData') || {};
        if (relationData.type !== 'associationClassLink') return;

        const classElement = link.getSourceElement();
        const hostLinkId = link.get('target')?.id;
        if (!classElement) return;

        const hostIndex = relationships.findIndex(r => r.id === hostLinkId);
        if (hostIndex === -1) return;

        const hostRel = relationships[hostIndex];
        const rawAssociativeClassName = classElement.get('umlData')?.className;
        if (!rawAssociativeClassName) return;
        const associativeClassName = this.sanitizeJavaIdentifier(rawAssociativeClassName, 'Entidad');

        // '*' y no '0..*': el chequeo de multiplicidad acá abajo
        // (generateRelationshipSide, y en varios otros puntos de este
        // archivo) compara con === '*' de forma estricta, no con
        // .includes('*') como sí hace simpleSQLGenerator — con '0..*' el
        // chequeo no matchea nada y termina generando @OneToOne en vez de
        // @ManyToOne/@OneToMany (bug real, encontrado en vivo generando
        // este mismo patrón). Es una limitación preexistente del generador
        // Java con esa multiplicidad puntual, no algo nuevo de acá — se la
        // esquiva usando el valor que sí reconoce.
        relationships.splice(hostIndex, 1,
            { sourceClass: hostRel.sourceClass, targetClass: associativeClassName, type: 'association', sourceMultiplicity: '1', targetMultiplicity: '*' },
            { sourceClass: hostRel.targetClass, targetClass: associativeClassName, type: 'association', sourceMultiplicity: '1', targetMultiplicity: '*' },
        );
    });

    console.log('🔗 Relaciones extraídas:', relationships.length);

    // Debug detallado de relaciones para diagramas complejos
    if (relationships.length > 0) {
        console.group('📊 Análisis de relaciones:');
        relationships.forEach((rel, index) => {
            console.log(`${index + 1}. ${rel.sourceClass} (${rel.sourceMultiplicity || '1'}) ${rel.type} ${rel.targetClass} (${rel.targetMultiplicity || '1'})`);
        });

        // Detectar posibles conflictos de nombres
        const entityRelationCounts = {};
        relationships.forEach(rel => {
            const sourceKey = `${rel.sourceClass}`;
            const targetKey = `${rel.targetClass}`;
            entityRelationCounts[sourceKey] = (entityRelationCounts[sourceKey] || 0) + 1;
            entityRelationCounts[targetKey] = (entityRelationCounts[targetKey] || 0) + 1;
        });

        const complexEntities = Object.entries(entityRelationCounts)
            .filter(([entity, count]) => count > 2)
            .map(([entity, count]) => `${entity}(${count} relaciones)`);

        if (complexEntities.length > 0) {
            console.warn('⚠️ Entidades con múltiples relaciones (posibles conflictos de nombres):', complexEntities);
        }
        console.groupEnd();
    }

    return relationships;
}

    async buildSpringBootProject(classes, relationships) {
        const zip = new JSZip();

        // Estructura base del proyecto Maven
        const srcPath = `src/main/java/${this.packageName.replace(/\./g, '/')}`;
        const resourcesPath = 'src/main/resources';
        const testPath = `src/test/java/${this.packageName.replace(/\./g, '/')}`;

        // Detectar si necesita sistema de autenticación
        const authInfo = this.detectAuthenticationEntities(classes);
        console.log('🔐 Detección de autenticación:', authInfo);

        // Categorizar clases por estereotipo
        const entitiesClasses = classes.filter(c => c.stereotype === 'entity');
        const serviceClasses = classes.filter(c => c.stereotype === 'service');
        const repositoryClasses = classes.filter(c => c.stereotype === 'repository');
        const controllerClasses = classes.filter(c => c.stereotype === 'controller');
        const utilityClasses = classes.filter(c => c.stereotype === 'utility');

        // Generar entidades JPA
        entitiesClasses.forEach(cls => {
            const entityCode = this.generateEntity(cls, relationships);
            zip.file(`${srcPath}/domain/model/${cls.name}.java`, entityCode);

            // Generar Repository para cada entidad
            const repoCode = this.generateRepository(cls, authInfo);
            zip.file(`${srcPath}/domain/repository/${cls.name}Repository.java`, repoCode);

            // Generar Service para cada entidad
            const serviceCode = this.generateService(cls);
            zip.file(`${srcPath}/domain/service/${cls.name}Service.java`, serviceCode);

            // Generar Controller REST para cada entidad
            const controllerCode = this.generateController(cls);
            zip.file(`${srcPath}/web/controller/${cls.name}Controller.java`, controllerCode);

            // Generar DTOs
            const requestDtoCode = this.generateRequestDTO(cls);
            const responseDtoCode = this.generateResponseDTO(cls);
            zip.file(`${srcPath}/web/dto/${cls.name}RequestDTO.java`, requestDtoCode);
            zip.file(`${srcPath}/web/dto/${cls.name}ResponseDTO.java`, responseDtoCode);
        });

        // Generar servicios standalone
        serviceClasses.forEach(cls => {
            const serviceCode = this.generateStandaloneService(cls);
            zip.file(`${srcPath}/domain/service/${cls.name}.java`, serviceCode);
        });

        // Generar repositorios standalone
        repositoryClasses.forEach(cls => {
            const repoCode = this.generateStandaloneRepository(cls);
            zip.file(`${srcPath}/domain/repository/${cls.name}.java`, repoCode);
        });

        // Generar controladores standalone
        controllerClasses.forEach(cls => {
            const controllerCode = this.generateStandaloneController(cls);
            zip.file(`${srcPath}/web/controller/${cls.name}.java`, controllerCode);
        });

        // Generar clases utilitarias
        utilityClasses.forEach(cls => {
            const utilityCode = this.generateUtilityClass(cls);
            zip.file(`${srcPath}/util/${cls.name}.java`, utilityCode);
        });

        // Generar sistema de autenticación si es necesario
        if (authInfo.needsAuth) {
            console.log('🔐 Generando sistema de autenticación completo...');

            // Configuración de seguridad
            zip.file(`${srcPath}/config/SecurityConfig.java`, this.generateSecurityConfig());
            zip.file(`${srcPath}/config/JwtUtil.java`, this.generateJwtUtil());

            // Servicios de autenticación
            zip.file(`${srcPath}/auth/service/UserDetailsServiceImpl.java`, this.generateUserDetailsService(authInfo.userEntity, authInfo));
            zip.file(`${srcPath}/auth/service/AuthService.java`, this.generateAuthService(authInfo.userEntity, authInfo));

            // Controlador de autenticación
            zip.file(`${srcPath}/auth/controller/AuthController.java`, this.generateAuthController(authInfo.userEntity));

            // DTOs de autenticación
            zip.file(`${srcPath}/auth/dto/LoginRequestDTO.java`, this.generateLoginRequestDTO());
            zip.file(`${srcPath}/auth/dto/RegisterRequestDTO.java`, this.generateRegisterRequestDTO(authInfo.userEntity, authInfo));
            zip.file(`${srcPath}/auth/dto/AuthResponseDTO.java`, this.generateAuthResponseDTO());

            // Filtro JWT
            zip.file(`${srcPath}/auth/filter/JwtAuthenticationFilter.java`, this.generateJwtAuthenticationFilter());

            // Excepciones de autenticación
            zip.file(`${srcPath}/exception/AuthenticationException.java`, this.generateAuthenticationException());
        }

        // Excepciones globales (siempre necesarias para los Services)
        zip.file(`${srcPath}/exception/GlobalExceptionHandler.java`, this.generateGlobalExceptionHandler(authInfo.needsAuth));
        zip.file(`${srcPath}/exception/EntityNotFoundException.java`, this.generateEntityNotFoundException());

        // Generar archivos de configuración
        zip.file('pom.xml', this.generatePomXml(authInfo.needsAuth));
        zip.file(`${resourcesPath}/application.properties`, this.generateApplicationProperties());
        zip.file(`${resourcesPath}/application-dev.properties`, this.generateDevProperties());
        zip.file(`${resourcesPath}/application-prod.properties`, this.generateProdProperties());

        // Generar clase principal Spring Boot
        const mainClassCode = this.generateMainClass();
        zip.file(`${srcPath}/${this.capitalizeFirst(this.projectName.replace(/\s+/g, ''))}Application.java`, mainClassCode);

        // Generar archivos adicionales
        zip.file('README.md', this.generateReadme(classes));
        zip.file('.gitignore', this.generateGitignore());

        return zip;
    }

    // ==================== GENERADORES DE CÓDIGO JAVA ====================

    generateEntity(cls, relationships) {
        const className = cls.name;
        const tableName = this.camelToSnakeCase(className).toLowerCase();

        // Analizar relaciones para esta entidad
        const entityRelationships = relationships.filter(r =>
            r.sourceClass === className || r.targetClass === className
        );

        // Realización → `implements Interfaz` en la firma de la clase (no genera
        // campo: a diferencia de composición/agregación/asociación, no es una
        // relación estructural con datos propios).
        const realizedInterfaces = entityRelationships
            .filter(r => r.type === 'realization' && r.sourceClass === className)
            .map(r => r.targetClass);
        const implementsClause = realizedInterfaces.length > 0
            ? ` implements ${realizedInterfaces.join(', ')}`
            : '';
        const abstractModifier = cls.isAbstract ? 'abstract ' : '';

        // Generalización (regla OMT: una tabla por clase, con la clave primaria
        // compartida). En Java es herencia real: la subclase hereda id y
        // auditoría del padre, y JPA une las tablas por esa clave.
        const parentClass = entityRelationships
            .find(r => r.type === 'inheritance' && r.sourceClass === className)?.targetClass || null;
        const hasChildren = entityRelationships
            .some(r => r.type === 'inheritance' && r.targetClass === className);
        const extendsClause = parentClass ? ` extends ${parentClass}` : '';
        const inheritanceAnnotations = [
            hasChildren ? '@Inheritance(strategy = InheritanceType.JOINED)' : null,
            parentClass ? '@PrimaryKeyJoinColumn(name = "id")' : null,
            parentClass ? '@EqualsAndHashCode(callSuper = true)' : null,
            parentClass ? '@ToString(callSuper = true)' : null,
        ].filter(Boolean).join('\n');
        const identityAndAudit = parentClass ? '' : `
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
`;
        const auditFields = parentClass ? '' : `
    // Campos de auditoría
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }`;

        return `package ${this.packageName}.domain.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import java.time.LocalDate;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import java.util.HashSet;

/**
 * Entidad JPA para ${className}
 * Generada automáticamente desde diagrama UML
 ${cls.responsibilities.length > 0 ? `*
 * Responsabilidades:
${cls.responsibilities.map(r => ` * - ${r}`).join('\n')}` : ''}
 ${cls.constraints.length > 0 ? `*
 * Restricciones:
${cls.constraints.map(c => ` * - ${c}`).join('\n')}` : ''}
 */
@Entity
@Table(name = "${tableName}")
${inheritanceAnnotations ? inheritanceAnnotations + '\n' : ''}@Data
@NoArgsConstructor
@AllArgsConstructor
public ${abstractModifier}class ${className}${extendsClause}${implementsClause} {
${identityAndAudit}
${this.generateEntityAttributes(cls.attributes)}

${this.generateEntityRelationships(className, entityRelationships.filter(r => !['realization', 'dependency', 'inheritance'].includes(r.type)))}
${auditFields}
}`;
    }

    generateEntityAttributes(attributes) {
        return this.excludeIdAttribute(attributes).map(attr => {
            const attrData = this.parseAttribute(attr);
            const javaType = this.mapUMLTypeToJava(attrData.type);
            const columnName = this.camelToSnakeCase(attrData.name);

            const nullable = attrData.visibility !== '-'; // Private = NOT NULL
            const validations = this.generateValidations(attrData.type, nullable);

            return `
    ${validations}
    @Column(name = "${columnName}"${nullable ? '' : ', nullable = false'})
    private ${javaType} ${attrData.name};`;
        }).join('\n');
    }

generateEntityRelationships(className, relationships) {
    const allRelationships = [];
    const generatedFields = new Set(); // Para evitar campos duplicados

    relationships.forEach(rel => {
        console.log('🔗 Procesando relación para clase:', className, rel);

        // Determine relationship direction and field names
        const isSource = (rel.sourceClass === className);
        const isTarget = (rel.targetClass === className);

        if (isSource) {
            // Esta clase es la fuente de la relación
            const targetClass = rel.targetClass;
            const baseFieldName = this.decapitalizeFirst(targetClass);
            const fieldName = this.generateUniqueFieldName(baseFieldName, generatedFields, rel);

            // Para determinar mappedBy, necesitamos el nombre del campo en el target que apunta de vuelta
            // Si es 1-to-many, el lado many (target) debe tener un campo que referencie al uno (source)
            let mappedByFieldName = null;
            if (rel.sourceMultiplicity === '1' && rel.targetMultiplicity === '*') {
                // OneToMany: el lado target (many) tendrá un campo que referencia al source (one)
                mappedByFieldName = this.decapitalizeFirst(className);
            }

            const relationship = this.generateRelationshipSide(rel, 'source', className, targetClass, fieldName, mappedByFieldName);
            if (relationship) {
                console.log('✅ Lado SOURCE generado para', className, '->', targetClass, 'campo:', fieldName);
                allRelationships.push(relationship);
                generatedFields.add(fieldName);
            }
        }

        if (isTarget) {
            // Esta clase es el destino de la relación
            const sourceClass = rel.sourceClass;
            const baseFieldName = this.decapitalizeFirst(sourceClass);
            const fieldName = this.generateUniqueFieldName(baseFieldName, generatedFields, rel);

            // El lado target nunca usa mappedBy en relaciones OneToMany (es el lado que posee la FK)
            const relationship = this.generateRelationshipSide(rel, 'target', className, sourceClass, fieldName, null);
            if (relationship) {
                console.log('✅ Lado TARGET generado para', sourceClass, '->', className, 'campo:', fieldName);
                allRelationships.push(relationship);
                generatedFields.add(fieldName);
            }
        }
    });

    return allRelationships.join('\n');
}

generateUniqueFieldName(baseFieldName, generatedFields, rel) {
    let fieldName = baseFieldName;
    let counter = 1;

    // Si ya existe, agregar sufijo basado en el tipo de relación o contador
    while (generatedFields.has(fieldName)) {
        // Intentar nombres más descriptivos basados en el tipo de relación
        if (counter === 1) {
            if (rel.type === 'composition') {
                fieldName = `${baseFieldName}Composition`;
            } else if (rel.type === 'aggregation') {
                fieldName = `${baseFieldName}Aggregation`;
            } else if (rel.name && rel.name.trim()) {
                // Usar el nombre de la relación si está disponible
                fieldName = this.decapitalizeFirst(rel.name.trim().replace(/\s+/g, ''));
            } else {
                fieldName = `${baseFieldName}${counter}`;
            }
        } else {
            fieldName = `${baseFieldName}${counter}`;
        }
        counter++;

        // Prevenir bucle infinito
        if (counter > 10) {
            fieldName = `${baseFieldName}${Date.now()}`;
            break;
        }
    }

    console.log(`🏷️ Campo único generado: ${baseFieldName} -> ${fieldName}`);
    return fieldName;
}

generateRelationshipSide(rel, side, currentClass, otherClass, fieldName, mappedByFieldName = null) {
    console.log('🔧 Generando lado de relación:', {
        side: side,
        currentClass: currentClass,
        otherClass: otherClass,
        fieldName: fieldName,
        mappedByFieldName: mappedByFieldName,
        type: rel.type,
        sourceMultiplicity: rel.sourceMultiplicity,
        targetMultiplicity: rel.targetMultiplicity
    });

    switch (rel.type) {
        case 'inheritance':
            // HERENCIA: Solo el hijo tiene referencia al padre
            if (side === 'source') {
                return `
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "${this.camelToSnakeCase(fieldName)}_id")
    private ${otherClass} ${fieldName};`;
            }
            return null; // El padre no tiene referencia directa

        case 'association':
            return this.generateAssociationSide(rel, side, currentClass, otherClass, fieldName, mappedByFieldName);

        case 'composition':
            // COMPOSICIÓN: Padre->Hijos (OneToMany), Hijo->Padre (ManyToOne)
            if (side === 'source') {
                // El padre tiene una colección de hijos
                // mappedBy debe apuntar al campo que existe en la clase hija que referencia al padre
                if (!mappedByFieldName) {
                    console.warn('⚠️ mappedByFieldName es null para composición source');
                    return null;
                }
                return `
    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY, mappedBy = "${mappedByFieldName}")
    private Set<${otherClass}> ${fieldName}s = new HashSet<>();`;
            } else {
                // El hijo tiene referencia al padre (este ES el campo referenciado por mappedBy)
                return `
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "${this.camelToSnakeCase(fieldName)}_id", nullable = false)
    private ${otherClass} ${fieldName};`;
            }

        case 'aggregation':
            // AGREGACIÓN: Similar a composición pero sin orphanRemoval
            if (side === 'source') {
                // El padre tiene una colección de hijos
                // mappedBy debe apuntar al campo que existe en la clase hija que referencia al padre
                if (!mappedByFieldName) {
                    console.warn('⚠️ mappedByFieldName es null para agregación source');
                    return null;
                }
                return `
    @OneToMany(cascade = {CascadeType.PERSIST, CascadeType.MERGE}, fetch = FetchType.LAZY, mappedBy = "${mappedByFieldName}")
    private Set<${otherClass}> ${fieldName}s = new HashSet<>();`;
            } else {
                // El hijo tiene referencia al padre (este ES el campo referenciado por mappedBy)
                return `
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "${this.camelToSnakeCase(fieldName)}_id")
    private ${otherClass} ${fieldName};`;
            }

        default:
            return `// Relación ${rel.type} con ${otherClass}`;
    }
}

generateAssociationSide(rel, side, currentClass, otherClass, fieldName, mappedByFieldName = null) {
    const sourceMultiplicity = rel.sourceMultiplicity || '1';
    const targetMultiplicity = rel.targetMultiplicity || '1';

    // Determinar el tipo de relación basado en multiplicidades
    const isSourceMany = this.isMany(sourceMultiplicity);
    const isTargetMany = this.isMany(targetMultiplicity);

    console.log('🔗 Generando asociación:', {
        side,
        currentClass,
        otherClass,
        fieldName,
        mappedByFieldName,
        sourceMultiplicity,
        targetMultiplicity,
        isSourceMany,
        isTargetMany
    });

    // Muchos a muchos: JPA genera la tabla intermedia, igual que el script SQL.
    if (isSourceMany && isTargetMany) {
        if (side === 'source') {
            const sourceColumn = this.camelToSnakeCase(this.decapitalizeFirst(currentClass));
            const targetColumn = this.camelToSnakeCase(fieldName);
            const joinColumn = sourceColumn === targetColumn ? `${sourceColumn}_origen_id` : `${sourceColumn}_id`;
            const inverseColumn = sourceColumn === targetColumn ? `${targetColumn}_destino_id` : `${targetColumn}_id`;

            return `
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "${sourceColumn}_${targetColumn}",
        joinColumns = @JoinColumn(name = "${joinColumn}"),
        inverseJoinColumns = @JoinColumn(name = "${inverseColumn}"))
    private Set<${otherClass}> ${fieldName}s = new HashSet<>();`;
        }

        return `
    @ManyToMany(fetch = FetchType.LAZY, mappedBy = "${this.decapitalizeFirst(currentClass)}s")
    private Set<${otherClass}> ${fieldName}s = new HashSet<>();`;
    }

    if (side === 'source') {
        if (isTargetMany) {
            // 1 -> * : OneToMany
            if (!mappedByFieldName) {
                console.warn('⚠️ mappedByFieldName es null para asociación OneToMany source');
                return null;
            }
            return `
    @OneToMany(cascade = CascadeType.ALL, fetch = FetchType.LAZY, mappedBy = "${mappedByFieldName}")
    private Set<${otherClass}> ${fieldName}s = new HashSet<>();`;
        } else {
            // 1 -> 1 : OneToOne - este lado posee la relación
            return `
    @OneToOne(cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @JoinColumn(name = "${this.camelToSnakeCase(fieldName)}_id")
    private ${otherClass} ${fieldName};`;
        }
    } else { // side === 'target'
        // Bug real preexistente (encontrado al generar Java para el patrón
        // de clase asociativa, pero afecta a CUALQUIER asociación 1:N
        // manual con multiplicidad literal "*"): acá comparaba
        // `isSourceMany` en vez de `isTargetMany`. El caso canónico que
        // maneja el resto del generador (ver el mappedBy en
        // generateEntityRelationships, que solo se arma para
        // sourceMultiplicity==='1' && targetMultiplicity==='*') es
        // exactamente el que hay que detectar acá: si ESTA clase (el lado
        // target) es la "muchos", tiene que quedar con la FK real
        // (@ManyToOne) hacia el lado "uno" — no un @OneToOne. Con el chequeo
        // viejo, ese caso (el más común de todos, 1→N derecho) generaba
        // @OneToOne del lado "muchos", que ni siquiera es válido JPA contra
        // el @OneToMany(mappedBy=...) que sí se genera bien del otro lado
        // (Hibernate no arranca: mappedBy apuntando a un campo @OneToOne).
        if (isTargetMany) {
            // 1 -> * : ManyToOne - este lado (el "muchos") tiene la foreign key
            return `
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "${this.camelToSnakeCase(fieldName)}_id")
    private ${otherClass} ${fieldName};`;
        } else {
            // 1 -> 1 : OneToOne (lado inverso) - NO usa mappedBy en target
            return `
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "${this.camelToSnakeCase(fieldName)}_id")
    private ${otherClass} ${fieldName};`;
        }
    }
}

isMany(multiplicity) {
    return multiplicity.includes('*') ||
           multiplicity.includes('n') ||
           multiplicity.includes('..') ||
           multiplicity === '0..*' ||
           multiplicity === '1..*';
}

/**
 * Los métodos de búsqueda por "email" (login) solo tienen sentido para la
 * entidad que `detectAuthenticationEntities()` identificó como la de
 * usuario/autenticación — antes se generaban para CUALQUIER clase cuyo
 * NOMBRE contuviera "user"/"usuario"/"account"/"cuenta", con el campo
 * hardcodeado literal "email" en el método derivado (`findByEmailIgnoreCase`)
 * y en la @Query manual (`u.email = :email`), sin importar si esa entidad
 * realmente tenía un atributo llamado así. Con cualquier diagrama cuyo campo
 * de login se llamara distinto (o que directamente no tuviera campo de
 * email) esto ni arrancaba — Spring Data JPA valida la @Query contra el
 * modelo JPA real al levantar el contexto, falla ahí, no en compilación.
 */
generateRepository(cls, authInfo) {
    const className = cls.name;

    const emailField = (authInfo?.needsAuth && authInfo.userEntity?.name === className)
        ? authInfo.emailField
        : null;
    const capitalizedEmailField = emailField ? this.capitalizeFirst(emailField) : null;

    const userSpecificMethods = capitalizedEmailField ? `
    // Métodos específicos para autenticación (campo detectado: "${emailField}")
    Optional<${className}> findBy${capitalizedEmailField}(String ${emailField});

    @Query("SELECT u FROM ${className} u WHERE LOWER(u.${emailField}) = LOWER(:${emailField})")
    Optional<${className}> findBy${capitalizedEmailField}IgnoreCase(@Param("${emailField}") String ${emailField});

    boolean existsBy${capitalizedEmailField}(String ${emailField});` : '';

    return `package ${this.packageName}.domain.repository;

import ${this.packageName}.domain.model.${className};
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

/**
 * Repositorio JPA para ${className}
 * Generado automáticamente desde diagrama UML
 */
@Repository
public interface ${className}Repository extends JpaRepository<${className}, Long> {

    // Métodos de consulta básicos

    List<${className}> findByOrderByCreatedAtDesc();

    List<${className}> findTop10ByOrderByCreatedAtDesc();

    @Query("SELECT e FROM ${className} e ORDER BY e.createdAt DESC")
    List<${className}> findAllOrderedByDate();

    // Buscar por ID con validación
    @Query("SELECT e FROM ${className} e WHERE e.id = :id")
    Optional<${className}> findByIdSafe(@Param("id") Long id);
${userSpecificMethods}

    // TODO: Agregar métodos de consulta específicos según necesidades del negocio
    // Ejemplo:
    // List<${className}> findByNombreContaining(String nombre);
}`;
}

    generateService(cls) {
        const className = cls.name;

        // Generar imports para relaciones
        const relationshipImports = this.generateServiceRelationshipImports(className);
        const relationshipRepositories = this.generateServiceRelationshipRepositories(className);

        return `package ${this.packageName}.domain.service;

import ${this.packageName}.domain.model.${className};
import ${this.packageName}.domain.repository.${className}Repository;
import ${this.packageName}.web.dto.${className}RequestDTO;
import ${this.packageName}.web.dto.${className}ResponseDTO;
import ${this.packageName}.exception.EntityNotFoundException;${relationshipImports}
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDate;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Servicio de negocio para ${className}
 * Generado automáticamente desde diagrama UML
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class ${className}Service {

    private final ${className}Repository ${this.decapitalizeFirst(className)}Repository;${relationshipRepositories}

    /**
     * Crear nueva entidad ${className}
     */
    public ${className}ResponseDTO create(${className}RequestDTO requestDTO) {
        log.info("Creando nueva entidad ${className}: {}", requestDTO);
${cls.isAbstract ? `
        // ${className} es abstracta (UML): se crea a través de una de sus subclases.
        throw new UnsupportedOperationException("${className} es abstracta: crea una de sus subclases");
    }
` : `
        ${className} entity = new ${className}();
        mapRequestToEntity(requestDTO, entity);`}${cls.isAbstract ? `

    /** Guarda una instancia de alguna subclase de ${className}. */
    protected ${className}ResponseDTO saveEntity(${className} entity) {` : ''}

        ${className} savedEntity = ${this.decapitalizeFirst(className)}Repository.save(entity);

        log.info("Entidad ${className} creada con ID: {}", savedEntity.getId());
        return mapEntityToResponse(savedEntity);
    }

    /**
     * Obtener entidad por ID
     */
    @Transactional(readOnly = true)
    public ${className}ResponseDTO findById(Long id) {
        log.debug("Buscando ${className} con ID: {}", id);

        ${className} entity = ${this.decapitalizeFirst(className)}Repository.findById(id)
            .orElseThrow(() -> EntityNotFoundException.notFound("${className}", id));

        return mapEntityToResponse(entity);
    }

    /**
     * Obtener todas las entidades
     */
    @Transactional(readOnly = true)
    public List<${className}ResponseDTO> findAll() {
        log.debug("Obteniendo todas las entidades ${className}");

        return ${this.decapitalizeFirst(className)}Repository.findByOrderByCreatedAtDesc()
            .stream()
            .map(this::mapEntityToResponse)
            .collect(Collectors.toList());
    }

    /**
     * Actualizar entidad existente
     */
    public ${className}ResponseDTO update(Long id, ${className}RequestDTO requestDTO) {
        log.info("Actualizando ${className} con ID: {}", id);

        ${className} entity = ${this.decapitalizeFirst(className)}Repository.findById(id)
            .orElseThrow(() -> EntityNotFoundException.notFound("${className}", id));

        mapRequestToEntity(requestDTO, entity);
        ${className} updatedEntity = ${this.decapitalizeFirst(className)}Repository.save(entity);

        log.info("Entidad ${className} actualizada: {}", updatedEntity.getId());
        return mapEntityToResponse(updatedEntity);
    }

    /**
     * Eliminar entidad (soft delete)
     */
    public void delete(Long id) {
        log.info("Eliminando ${className} con ID: {}", id);

        ${className} entity = ${this.decapitalizeFirst(className)}Repository.findById(id)
            .orElseThrow(() -> EntityNotFoundException.notFound("${className}", id));

        // Implementar soft delete si es necesario
        ${this.decapitalizeFirst(className)}Repository.delete(entity);

        log.info("Entidad ${className} eliminada: {}", id);
    }

    // ==================== MÉTODOS DE MAPEO ====================

    private void mapRequestToEntity(${className}RequestDTO requestDTO, ${className} entity) {
        // TODO: Implementar mapeo específico de campos
        // Ejemplo básico:
        ${this.generateDtoToEntityMapping(cls.attributes, cls.name)}
    }

    private ${className}ResponseDTO mapEntityToResponse(${className} entity) {
        ${className}ResponseDTO responseDTO = new ${className}ResponseDTO();
        responseDTO.setId(entity.getId());
        responseDTO.setCreatedAt(entity.getCreatedAt());
        responseDTO.setUpdatedAt(entity.getUpdatedAt());

        // TODO: Implementar mapeo específico de campos
        // Ejemplo básico:
        ${this.generateEntityToResponseMapping(cls.attributes)}

        return responseDTO;
    }
}`;
    }

    generateDtoToEntityMapping(attributes, className = null) {
        let mappings = [];

        // Mapeo de atributos regulares
        mappings = mappings.concat(this.excludeIdAttribute(attributes).map(attr => {
            const attrData = this.parseAttribute(attr);
            const fieldName = attrData.name;
            const capitalizedField = this.capitalizeFirst(fieldName);
            const javaType = this.mapUMLTypeToJava(attrData.type);

            // Generar validación y mapeo específico según el tipo
            let mapping = `        if (requestDTO.get${capitalizedField}() != null) {\n`;

            if (javaType === 'String') {
                mapping += `            entity.set${capitalizedField}(requestDTO.get${capitalizedField}().trim());\n`;
            } else if (javaType === 'LocalDateTime') {
                mapping += `            entity.set${capitalizedField}(requestDTO.get${capitalizedField}());\n`;
            } else if (javaType === 'BigDecimal') {
                mapping += `            entity.set${capitalizedField}(requestDTO.get${capitalizedField}());\n`;
            } else {
                mapping += `            entity.set${capitalizedField}(requestDTO.get${capitalizedField}());\n`;
            }

            mapping += `        }`;
            return mapping;
        }));

        // Mapeo de relaciones (foreign keys)
        if (className && this.relationships) {
            mappings = mappings.concat(this.generateRelationshipMappings(className));
        }

        return mappings.join('\n');
    }

    /**
     * Genera mapeos de campos de relación (foreign keys) en DTOs
     */
    generateRelationshipMappings(className) {
        const mappings = [];

        if (!this.relationships || this.relationships.length === 0) {
            return mappings;
        }

        this.relationships.forEach(rel => {
            console.log(`🔧 Generando mapeo de relación para ${className}:`, rel);

            let needsForeignKey = false;
            let relatedClass = null;

            // Determinar si esta clase necesita foreign key basándose en multiplicidades
            if (rel.targetClass === className) {
                // Esta clase es el target de la relación
                if (rel.sourceMultiplicity === '1' && (rel.targetMultiplicity === '*' || rel.targetMultiplicity === 'many')) {
                    needsForeignKey = true;
                    relatedClass = rel.sourceClass;
                }
            } else if (rel.sourceClass === className) {
                // Esta clase es el source de la relación
                if (rel.targetMultiplicity === '1' && (rel.sourceMultiplicity === '*' || rel.sourceMultiplicity === 'many')) {
                    needsForeignKey = true;
                    relatedClass = rel.targetClass;
                }
            }

            // Generar mapeo si necesita FK
            if (needsForeignKey && relatedClass) {
                const fieldName = relatedClass.toLowerCase();
                const foreignKeyField = `${fieldName}Id`;
                const capitalizedFK = this.capitalizeFirst(foreignKeyField);
                const relationField = this.capitalizeFirst(fieldName);

                console.log(`🔗 Mapeando FK: ${foreignKeyField} -> ${relatedClass}`);
                mappings.push(`        if (requestDTO.get${capitalizedFK}() != null) {
            ${relatedClass} ${fieldName} = ${this.decapitalizeFirst(relatedClass)}Repository.findById(requestDTO.get${capitalizedFK}())
                .orElseThrow(() -> new EntityNotFoundException("${relatedClass} no encontrado con ID: " + requestDTO.get${capitalizedFK}()));
            entity.set${relationField}(${fieldName});
        }`);
            }
        });        return mappings;
    }

    /**
     * Genera imports para entidades y repositorios relacionados en Services
     */
    generateServiceRelationshipImports(className) {
        const imports = new Set();

        if (!this.relationships || this.relationships.length === 0) {
            return '';
        }

        this.relationships.forEach(rel => {
            let relatedClass = null;

            // Determinar qué entidad relacionada necesitamos importar
            if (rel.targetClass === className) {
                if (rel.sourceMultiplicity === '1' && (rel.targetMultiplicity === '*' || rel.targetMultiplicity === 'many')) {
                    relatedClass = rel.sourceClass;
                }
            } else if (rel.sourceClass === className) {
                if (rel.targetMultiplicity === '1' && (rel.sourceMultiplicity === '*' || rel.sourceMultiplicity === 'many')) {
                    relatedClass = rel.targetClass;
                }
            }

            if (relatedClass) {
                imports.add(`import ${this.packageName}.domain.model.${relatedClass};`);
                imports.add(`import ${this.packageName}.domain.repository.${relatedClass}Repository;`);
            }
        });

        return imports.size > 0 ? '\n' + Array.from(imports).join('\n') : '';
    }

    /**
     * Genera campos de repositorios para entidades relacionadas en Services
     */
    generateServiceRelationshipRepositories(className) {
        const repositories = [];

        if (!this.relationships || this.relationships.length === 0) {
            return '';
        }

        this.relationships.forEach(rel => {
            let relatedClass = null;

            // Determinar qué repositorio necesitamos
            if (rel.targetClass === className) {
                if (rel.sourceMultiplicity === '1' && (rel.targetMultiplicity === '*' || rel.targetMultiplicity === 'many')) {
                    relatedClass = rel.sourceClass;
                }
            } else if (rel.sourceClass === className) {
                if (rel.targetMultiplicity === '1' && (rel.sourceMultiplicity === '*' || rel.sourceMultiplicity === 'many')) {
                    relatedClass = rel.targetClass;
                }
            }

            if (relatedClass) {
                repositories.push(`    private final ${relatedClass}Repository ${this.decapitalizeFirst(relatedClass)}Repository;`);
            }
        });

        return repositories.length > 0 ? '\n' + repositories.join('\n') : '';
    }

    generateEntityToResponseMapping(attributes) {
        return this.excludeIdAttribute(attributes).map(attr => {
            const attrData = this.parseAttribute(attr);
            const fieldName = attrData.name;
            const capitalizedField = this.capitalizeFirst(fieldName);
            const javaType = this.mapUMLTypeToJava(attrData.type);

            // Mapeo específico según el tipo
            if (javaType === 'LocalDateTime') {
                return `        responseDTO.set${capitalizedField}(entity.get${capitalizedField}());`;
            } else if (javaType === 'BigDecimal') {
                return `        responseDTO.set${capitalizedField}(entity.get${capitalizedField}());`;
            } else {
                return `        responseDTO.set${capitalizedField}(entity.get${capitalizedField}());`;
            }
        }).join('\n');
    }

    generateController(cls) {
        const className = cls.name;
        const basePath = this.camelToKebabCase(className);

        return `package ${this.packageName}.web.controller;

import ${this.packageName}.domain.service.${className}Service;
import ${this.packageName}.web.dto.${className}RequestDTO;
import ${this.packageName}.web.dto.${className}ResponseDTO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.List;

/**
 * Controlador REST para ${className}
 * Generado automáticamente desde diagrama UML
 */
@RestController
@RequestMapping("/api/${basePath}")
@RequiredArgsConstructor
@Slf4j
@Validated
@CrossOrigin(origins = "*")
public class ${className}Controller {

    private final ${className}Service ${this.decapitalizeFirst(className)}Service;

    /**
     * Crear nuevo ${className}
     */
    @PostMapping
    public ResponseEntity<${className}ResponseDTO> create(@Valid @RequestBody ${className}RequestDTO requestDTO) {
        log.info("REST: Creando ${className}: {}", requestDTO);

        ${className}ResponseDTO responseDTO = ${this.decapitalizeFirst(className)}Service.create(requestDTO);

        return ResponseEntity.status(HttpStatus.CREATED).body(responseDTO);
    }

    /**
     * Obtener ${className} por ID
     */
    @GetMapping("/{id}")
    public ResponseEntity<${className}ResponseDTO> findById(@PathVariable Long id) {
        log.debug("REST: Obteniendo ${className} con ID: {}", id);

        ${className}ResponseDTO responseDTO = ${this.decapitalizeFirst(className)}Service.findById(id);

        return ResponseEntity.ok(responseDTO);
    }

    /**
     * Obtener todos los ${className}
     */
    @GetMapping
    public ResponseEntity<List<${className}ResponseDTO>> findAll() {
        log.debug("REST: Obteniendo todos los ${className}");

        List<${className}ResponseDTO> responseDTOs = ${this.decapitalizeFirst(className)}Service.findAll();

        return ResponseEntity.ok(responseDTOs);
    }

    /**
     * Actualizar ${className} existente
     */
    @PutMapping("/{id}")
    public ResponseEntity<${className}ResponseDTO> update(
            @PathVariable Long id,
            @Valid @RequestBody ${className}RequestDTO requestDTO) {
        log.info("REST: Actualizando ${className} con ID: {}", id);

        ${className}ResponseDTO responseDTO = ${this.decapitalizeFirst(className)}Service.update(id, requestDTO);

        return ResponseEntity.ok(responseDTO);
    }

    /**
     * Eliminar ${className}
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        log.info("REST: Eliminando ${className} con ID: {}", id);

        ${this.decapitalizeFirst(className)}Service.delete(id);

        return ResponseEntity.noContent().build();
    }
}`;
    }

    generateRequestDTO(cls) {
        const className = cls.name;

        return `package ${this.packageName}.web.dto;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import jakarta.validation.constraints.*;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.LocalDate;
import java.math.BigDecimal;
import java.time.LocalDateTime;
/**
 * DTO de Request para ${className}
 * Generado automáticamente desde diagrama UML
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ${className}RequestDTO {

${this.generateDTOAttributes(cls.attributes, true, cls.name)}

    // TODO: Agregar validaciones específicas según reglas de negocio
}`;
    }

    generateResponseDTO(cls) {
        const className = cls.name;

        return `package ${this.packageName}.web.dto;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.LocalDate;
import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * DTO de Response para ${className}
 * Generado automáticamente desde diagrama UML
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ${className}ResponseDTO {

    private Long id;

${this.generateDTOAttributes(cls.attributes, false, cls.name)}

    @JsonProperty("created_at")
    private LocalDateTime createdAt;

    @JsonProperty("updated_at")
    private LocalDateTime updatedAt;
}`;
    }

    // ==================== MÉTODOS AUXILIARES ====================

    /**
     * Antes exigía un ":" en el string para reconocer el atributo (regex
     * `^([+\-#~])\s*([^:]+):\s*(.+)$`) — un atributo creado en el panel SIN
     * tipo (el usuario dejó "Tipo" vacío) se guarda como "- orden" (SIN
     * colon, ver `DiagramElementFactory.serializeAttributeLine()`: si no hay
     * `type`, no escribe el ":"), así que el regex no matcheaba NADA y caía
     * al fallback, que devolvía `name: attributeString` — el string CRUDO
     * completo, con el símbolo de visibilidad y el espacio incluidos (ej.
     * "- orden"). Eso terminaba como `private String - orden;` en la
     * entidad: sintaxis inválida, "identifier expected" en el compilador.
     * Ahora se separa visibilidad y ":" por separado (igual que
     * `DiagramElementFactory.parseAttributeLine()`), así que un atributo sin
     * tipo simplemente cae a `type: 'String'` sin arrastrar basura al nombre,
     * y el nombre además se sanitiza a un identificador Java válido por las
     * dudas (espacios u otros caracteres sueltos que el usuario haya tipeado).
     */
    parseAttribute(attributeString) {
        const trimmed = String(attributeString || '').trim();
        const visibilityMatch = trimmed.match(/^([+\-#~])\s*(.*)$/);
        const visibility = visibilityMatch ? visibilityMatch[1] : '+';
        const rest = visibilityMatch ? visibilityMatch[2] : trimmed;

        const colonIdx = rest.lastIndexOf(':');
        const rawName = colonIdx === -1 ? rest : rest.slice(0, colonIdx).trim();
        const rawType = colonIdx === -1 ? '' : rest.slice(colonIdx + 1).trim();

        return {
            visibility,
            name: this.sanitizeJavaIdentifier(rawName, 'campo'),
            type: rawType || 'String'
        };
    }

    /**
     * Reduce un nombre arbitrario a un identificador Java válido: se queda
     * solo con letras/dígitos/guion bajo/`$`, y si queda vacío o arranca con
     * un dígito (identificador ilegal en Java) usa `fallback`/antepone `_`.
     * Usado tanto para nombres de clase (ver `extractClasses()`) como para
     * nombres de atributo (ver `parseAttribute()`) — cualquier espacio u
     * otro caracter inválido que el usuario haya tipeado en el diagrama se
     * limpia ACÁ, una sola vez, en vez de que cada generador tenga que
     * acordarse de sanitizar por su cuenta.
     */
    sanitizeJavaIdentifier(rawName, fallback) {
        let id = String(rawName || '').replace(/[^A-Za-z0-9_$]/g, '');
        if (!id) id = fallback;
        if (/^[0-9]/.test(id)) id = '_' + id;
        return id;
    }

    /**
     * Descarta un atributo propio del diagrama literalmente llamado "id"
     * (sin importar mayúsculas). El generador SIEMPRE declara su propio
     * campo `id` (Long, `@Id @GeneratedValue` en la entidad; `private Long
     * id` a mano en el ResponseDTO) — si el usuario también definió su
     * propio atributo "id" en el diagrama (típico al importar un modelo que
     * ya traía su propia PK explícita, ej. desde XMI), quedaban DOS campos
     * `id` en la misma clase Java y no compilaba ("variable id is already
     * defined"). Se usa en los 4 lugares que vuelcan `cls.attributes` a
     * código Java (entidad, DTOs, mapeos) para que el filtro sea consistente
     * en todos — filtrar solo en uno de los cuatro dejaba los otros tres
     * generando código que referenciaba un campo "id" que ya no existía (o
     * que sí duplicaba, según el lugar).
     */
    excludeIdAttribute(attributes) {
        return attributes.filter(attr => this.parseAttribute(attr).name.toLowerCase() !== 'id');
    }

    mapUMLTypeToJava(umlType) {
        const typeMap = {
            'String': 'String',
            'int': 'Integer',
            'Integer': 'Integer',
            'long': 'Long',
            'Long': 'Long',
            'double': 'Double',
            'Double': 'Double',
            'float': 'Float',
            'Float': 'Float',
            'boolean': 'Boolean',
            'Boolean': 'Boolean',
            'Date': 'LocalDateTime',
            'LocalDateTime': 'LocalDateTime',
            'LocalDate': 'LocalDate',
            'BigDecimal': 'BigDecimal',
            'List<String>': 'List<String>',
            'Set<String>': 'Set<String>',
            'Map<String,String>': 'Map<String, String>'
        };
        return typeMap[umlType] || 'String';
    }

    generateDTOAttributes(attributes, isRequest, className = null) {
        let dtoFields = [];

        // Agregar atributos regulares
        this.excludeIdAttribute(attributes).forEach(attr => {
            const attrData = this.parseAttribute(attr);
            const javaType = this.mapUMLTypeToJava(attrData.type);
            const validations = isRequest ? this.generateValidations(attrData.type, false) : '';

            dtoFields.push(`
    ${validations}
    private ${javaType} ${attrData.name};`);
        });

        // Si tenemos el nombre de la clase, agregar campos de relación
        if (className && this.relationships) {
            const relationshipFields = this.generateRelationshipDTOFields(className, isRequest);
            dtoFields = dtoFields.concat(relationshipFields);
        }

        return dtoFields.join('\n');
    }

    /**
     * Genera campos de relación (foreign keys) para DTOs
     */
    generateRelationshipDTOFields(className, isRequest) {
        const relationshipFields = [];

        if (!this.relationships || this.relationships.length === 0) {
            return relationshipFields;
        }

        this.relationships.forEach(rel => {
            console.log(`🔍 Analizando relación para ${className}:`, rel);

            let needsForeignKey = false;
            let relatedClass = null;

            // Determinar si esta clase necesita foreign key basándose en multiplicidades
            if (rel.targetClass === className) {
                // Esta clase es el target de la relación
                // Si source es "1" y target es "*", entonces target (esta clase) necesita FK
                if (rel.sourceMultiplicity === '1' && (rel.targetMultiplicity === '*' || rel.targetMultiplicity === 'many')) {
                    needsForeignKey = true;
                    relatedClass = rel.sourceClass;
                    console.log(`📋 ${className} es lado MANY, necesita FK hacia ${relatedClass}`);
                }
            } else if (rel.sourceClass === className) {
                // Esta clase es el source de la relación
                // Si target es "1" y source es "*", entonces source (esta clase) necesita FK
                if (rel.targetMultiplicity === '1' && (rel.sourceMultiplicity === '*' || rel.sourceMultiplicity === 'many')) {
                    needsForeignKey = true;
                    relatedClass = rel.targetClass;
                    console.log(`📋 ${className} es lado MANY, necesita FK hacia ${relatedClass}`);
                }
            }

            // Agregar foreign key field al DTO
            if (needsForeignKey && relatedClass) {
                const fieldName = relatedClass.toLowerCase();
                const foreignKeyField = `${fieldName}Id`;

                const validation = isRequest ? '\n    @NotNull(message = "El ID de ' + relatedClass.toLowerCase() + ' es obligatorio")' : '';

                console.log(`➕ Agregando foreign key a ${className}: ${foreignKeyField} -> ${relatedClass}`);
                relationshipFields.push(`
    ${validation}
    private Long ${foreignKeyField};`);
            }
        });        return relationshipFields;
    }

    generateValidations(type, nullable) {
        const validations = [];

        if (!nullable) {
            validations.push('@NotNull');
        }

        if (type === 'String') {
            validations.push('@NotBlank');
            validations.push('@Size(max = 255)');
        }

        if (type.includes('Email') || type.includes('email')) {
            validations.push('@Email');
        }

        return validations.length > 0 ? '    ' + validations.join('\n    ') : '';
    }

    generateStandaloneService(cls) {
        const className = cls.name;
        return `package ${this.packageName}.domain.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Servicio ${className}
 * Generado automáticamente desde diagrama UML
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class ${className} {

${this.generateServiceMethods(cls.methods)}
}`;
    }

    generateStandaloneRepository(cls) {
        return `package ${this.packageName}.domain.repository;

import org.springframework.stereotype.Repository;

/**
 * Repositorio ${cls.name}
 * Generado automáticamente desde diagrama UML
 */
@Repository
public interface ${cls.name} {

${this.generateRepositoryMethods(cls.methods)}
}`;
    }

    generateStandaloneController(cls) {
        return `package ${this.packageName}.web.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

/**
 * Controlador ${cls.name}
 * Generado automáticamente desde diagrama UML
 */
@RestController
@RequestMapping("/api/${this.camelToKebabCase(cls.name)}")
@RequiredArgsConstructor
@Slf4j
public class ${cls.name} {

${this.generateControllerMethods(cls.methods)}
}`;
    }

    generateUtilityClass(cls) {
        return `package ${this.packageName}.util;

/**
 * Clase utilitaria ${cls.name}
 * Generada automáticamente desde diagrama UML
 */
public final class ${cls.name} {

    private ${cls.name}() {
        // Utility class
    }

${this.generateUtilityMethods(cls.methods)}
}`;
    }

    generateServiceMethods(methods) {
        return methods.map(method => {
            const methodData = this.parseMethod(method);
            return `
    /**
     * ${methodData.name}
     */
    public ${methodData.returnType} ${methodData.name}() {
        log.info("Ejecutando ${methodData.name}");
        // TODO: Implementar lógica de negocio
        ${methodData.returnType === 'void' ? '' : `return ${this.getDefaultValue(methodData.returnType)};`}
    }`;
        }).join('\n');
    }

    generateRepositoryMethods(methods) {
        return methods.map(method => {
            const methodData = this.parseMethod(method);
            return `    ${methodData.returnType} ${methodData.name}();`;
        }).join('\n\n');
    }

    generateControllerMethods(methods) {
        return methods.map(method => {
            const methodData = this.parseMethod(method);
            return `
    @GetMapping("/${this.camelToKebabCase(methodData.name)}")
    public ${methodData.returnType} ${methodData.name}() {
        log.info("REST: ${methodData.name}");
        // TODO: Implementar endpoint
        ${methodData.returnType === 'void' ? '' : `return ${this.getDefaultValue(methodData.returnType)};`}
    }`;
        }).join('\n');
    }

    generateUtilityMethods(methods) {
        return methods.map(method => {
            const methodData = this.parseMethod(method);
            return `
    /**
     * ${methodData.name}
     */
    public static ${methodData.returnType} ${methodData.name}() {
        // TODO: Implementar método utilitario
        ${methodData.returnType === 'void' ? '' : `return ${this.getDefaultValue(methodData.returnType)};`}
    }`;
        }).join('\n');
    }

    parseMethod(methodString) {
        const match = methodString.match(/^([+\-#~])\s*([^()]+)\(\):\s*(.+)$/);
        if (match) {
            return {
                visibility: match[1],
                name: match[2].trim(),
                returnType: this.mapUMLTypeToJava(match[3].trim())
            };
        }
        return { visibility: '+', name: methodString.replace(/[()]/g, ''), returnType: 'void' };
    }

    getDefaultValue(javaType) {
        const defaults = {
            'String': 'null',
            'Integer': '0',
            'Long': '0L',
            'Double': '0.0',
            'Float': '0.0f',
            'Boolean': 'false',
            'LocalDateTime': 'LocalDateTime.now()',
            'LocalDate': 'LocalDate.now()',
            'BigDecimal': 'BigDecimal.ZERO'
        };
        return defaults[javaType] || 'null';
    }

    // ==================== GENERADORES DE ARCHIVOS DE CONFIGURACIÓN ====================

    generatePomXml(needsAuth = false) {
        const authDependencies = needsAuth ? `
        <!-- Spring Security -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-security</artifactId>
        </dependency>

        <!-- JWT Dependencies -->
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-api</artifactId>
            <version>0.11.5</version>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-impl</artifactId>
            <version>0.11.5</version>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-jackson</artifactId>
            <version>0.11.5</version>
            <scope>runtime</scope>
        </dependency>` : '';

        return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.0</version>
        <relativePath/>
    </parent>

    <groupId>${this.groupId}</groupId>
    <artifactId>${this.artifactId}</artifactId>
    <version>${this.version}</version>
    <name>${this.projectName}</name>
    <description>Proyecto Spring Boot generado desde diagrama UML</description>

    <properties>
        <java.version>17</java.version>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <!-- Se fija una versión reciente en vez de dejar la que trae por
             default spring-boot-starter-parent:3.2.0 (~1.18.30): esa versión
             vieja de Lombok es conocida por fallar en silencio (sin error de
             build, simplemente no genera getters/setters/@Slf4j) bajo JDKs
             más nuevos que el 17 objetivo de este proyecto (21+). Fijar una
             versión reciente reduce ese riesgo sin depender de qué JDK real
             tenga instalado quien compile el proyecto generado. -->
        <lombok.version>1.18.34</lombok.version>
    </properties>

    <dependencies>
        <!-- Spring Boot Starters -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>

        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>
${authDependencies}
        <!-- Database -->
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>

        <!-- Lombok -->
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <version>\${lombok.version}</version>
            <optional>true</optional>
        </dependency>

        <!-- Testing -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>

        <!-- H2 Database for Testing -->
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <!-- annotationProcessorPaths explícito: sin esto, Lombok
                 normalmente igual se auto-descubre desde el classpath de
                 compilación, pero es justo ese auto-descubrimiento el que
                 puede fallar en silencio (compila sin errores propios de
                 Lombok, pero ningún getter/setter/@Slf4j se genera, y el
                 error real aparece recién como "cannot find symbol" en
                 CUALQUIER código que use esos métodos). Declararlo acá saca
                 la ambigüedad — es la forma recomendada oficialmente por
                 Lombok para proyectos Maven con Java 9+. -->
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <configuration>
                    <annotationProcessorPaths>
                        <path>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                            <version>\${lombok.version}</version>
                        </path>
                    </annotationProcessorPaths>
                </configuration>
            </plugin>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`;
    }

    generateApplicationProperties() {
        return `# Configuración generada automáticamente desde diagrama UML
# ${this.projectName} - Spring Boot Application

# Server Configuration
# Puerto 8090, no el 8080 clásico de Tomcat/Spring Boot — a propósito: el
# stack de este mismo diagramador ("composer run dev") levanta Laravel
# Reverb (WebSocket) en el puerto 8080 por defecto (ver config/reverb.php),
# así que un backend generado que también pidiera 8080 chocaba con eso si
# ambos corrían a la vez en la misma máquina.
server.port=8090
server.servlet.context-path=/

# Database Configuration
# Puerto 5433 (no el 5432 estándar de Postgres) a propósito — pensado para
# correr en un contenedor Docker separado sin chocar con una instancia de
# Postgres que ya esté escuchando en el puerto estándar en la misma máquina.
spring.datasource.url=jdbc:postgresql://localhost:5433/${this.artifactId.replace(/-/g, '_')}_db
spring.datasource.username=postgres
spring.datasource.password=postgres
spring.datasource.driver-class-name=org.postgresql.Driver

# JPA Configuration
spring.jpa.hibernate.ddl-auto=update
spring.jpa.show-sql=true
spring.jpa.format-sql=true
spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect

# Logging
logging.level.${this.packageName}=DEBUG
logging.level.org.springframework.web=INFO
logging.level.org.hibernate.SQL=DEBUG
logging.level.org.hibernate.type.descriptor.sql.BasicBinder=TRACE

# Jackson JSON Configuration
spring.jackson.default-property-inclusion=NON_NULL
spring.jackson.date-format=yyyy-MM-dd HH:mm:ss
spring.jackson.time-zone=GMT-5

# JWT Configuration (Secure 256-bit key)
jwt.secret=404E635266556A586E3272357538782F413F4428472B4B6250645367566B5970
jwt.expiration=86400000

# Profile
spring.profiles.active=dev`;
    }

    generateDevProperties() {
        return `# Configuración de Desarrollo
# ${this.projectName} - Development Environment

# Database Development
spring.datasource.url=jdbc:postgresql://localhost:5433/${this.artifactId.replace(/-/g, '_')}_db
spring.datasource.username=postgres
spring.datasource.password=postgres

# JPA Development
spring.jpa.hibernate.ddl-auto=update
spring.jpa.show-sql=true
spring.jpa.format-sql=true

# JWT Development
jwt.secret=404E635266556A586E3272357538782F413F4428472B4B6250645367566B5970
jwt.expiration=86400000

# Logging Development
logging.level.root=INFO
logging.level.${this.packageName}=DEBUG`;
    }

    generateProdProperties() {
        return `# Configuración de Producción
# ${this.projectName} - Production Environment

# Database Production
spring.datasource.url=\${DATABASE_URL:jdbc:postgresql://localhost:5433/${this.artifactId.replace(/-/g, '_')}_prod}
spring.datasource.username=\${DATABASE_USERNAME:prod_user}
spring.datasource.password=\${DATABASE_PASSWORD:prod_pass}

# JPA Production
spring.jpa.hibernate.ddl-auto=validate
spring.jpa.show-sql=false
spring.jpa.format-sql=false

# Logging Production
logging.level.root=WARN
logging.level.${this.packageName}=INFO`;
    }

    generateMainClass() {
        const className = this.capitalizeFirst(this.projectName.replace(/\s+/g, ''));
        return `package ${this.packageName};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Clase principal de la aplicación Spring Boot
 * Generada automáticamente desde diagrama UML
 */
@SpringBootApplication
public class ${className}Application {

    public static void main(String[] args) {
        SpringApplication.run(${className}Application.class, args);
    }
}`;
    }

    generateReadme(classes) {
        const authInfo = this.detectAuthenticationEntities(classes);
        const authSection = authInfo.needsAuth ? `

## 🔐 Autenticación

Este proyecto incluye un **sistema de autenticación JWT completo** generado automáticamente porque se detectó una entidad **${authInfo.userEntity.name}** con campos de email y contraseña.

### Endpoints de Autenticación

- **POST** \`/api/auth/register\` - Registrar nuevo usuario
- **POST** \`/api/auth/login\` - Iniciar sesión
- **GET** \`/api/auth/validate\` - Validar token (requiere autenticación)

### Ejemplo de Login

\`\`\`bash
curl -X POST http://localhost:8090/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "usuario@email.com",
    "password": "123456"
  }'
\`\`\`

### Ejemplo de Uso con Token

\`\`\`bash
curl -X GET http://localhost:8090/api/usuario \\
  -H "Authorization: Bearer tu_jwt_token_aqui"
\`\`\`

### Características de Seguridad

- ✅ **JWT (JSON Web Tokens)** para autenticación stateless
- ✅ **BCrypt** para cifrado de contraseñas
- ✅ **Spring Security** configurado automáticamente
- ✅ **CORS** habilitado para frontend
- ✅ **Manejo de errores** personalizado
- ✅ **Validaciones** de entrada en DTOs` : '';

        return `# ${this.projectName}

Proyecto Spring Boot generado automáticamente desde diagrama UML.

## Descripción

Este proyecto contiene ${classes.length} clases principales:

${classes.map(cls => `- **${cls.name}** (${cls.stereotype}): ${cls.responsibilities.join(', ') || 'Sin descripción'}`).join('\n')}
${authSection}

## Estructura del Proyecto

\`\`\`
src/main/java/${this.packageName.replace(/\./g, '/')}/
├── domain/
│   ├── model/          # Entidades JPA
│   ├── repository/     # Repositorios
│   └── service/        # Servicios de negocio
├── web/
│   ├── controller/     # Controladores REST
│   └── dto/           # DTOs Request/Response
${authInfo.needsAuth ? `├── auth/
│   ├── controller/     # AuthController
│   ├── service/        # AuthService, UserDetailsService
│   ├── dto/           # DTOs de autenticación
│   └── filter/        # Filtros JWT
├── config/            # SecurityConfig, JwtUtil
├── exception/         # Manejo global de errores` : ''}
└── util/              # Clases utilitarias
\`\`\`

## Tecnologías

- **Spring Boot 3.2.0**
- **Java 17**
- **Spring Data JPA** (Hibernate genera/actualiza las tablas solo — \`ddl-auto=update\` — no hace falta escribir migraciones a mano)
- **PostgreSQL 16**
- **Lombok**
- **Bean Validation**

## Configuración

### Opción 1: Docker (Recomendado)

1. **Ejecutar PostgreSQL con Docker** (puerto 5433, no el 5432 estándar — así no choca con otra instancia de Postgres que ya tengas corriendo en la máquina). Un solo comando, sin continuaciones de línea (\`\\\` es sintaxis de Bash — en PowerShell rompe el comando):
   \`\`\`bash
   docker run --name ${this.artifactId}-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=${this.artifactId.replace(/-/g, '_')}_db -p 5433:5432 -d postgres:16
   \`\`\`

2. **Ejecutar aplicación:**
   \`\`\`bash
   mvn spring-boot:run
   \`\`\`

   Al arrancar, Hibernate crea las tablas automáticamente en la base de datos ya creada por \`POSTGRES_DB\` — no hace falta ningún paso manual extra.

3. **Comandos útiles:**
   \`\`\`bash
   # Ver el contenedor
   docker ps

   # Detener Postgres
   docker stop ${this.artifactId}-postgres

   # Iniciar Postgres existente
   docker start ${this.artifactId}-postgres

   # Eliminar contenedor
   docker rm -f ${this.artifactId}-postgres

   # Conectarse con psql dentro del contenedor
   docker exec -it ${this.artifactId}-postgres psql -U postgres -d ${this.artifactId.replace(/-/g, '_')}_db
   \`\`\`

### Opción 2: PostgreSQL Local

1. Crear base de datos por comando: \`createdb -U postgres ${this.artifactId.replace(/-/g, '_')}_db\` (o \`psql -U postgres -c "CREATE DATABASE ${this.artifactId.replace(/-/g, '_')}_db;"\`)
2. Ajustar host/puerto/credenciales en \`application.properties\` si tu Postgres local no corre en el 5433 (ver arriba)
3. Ejecutar: \`mvn spring-boot:run\`

## Inicio Rápido

\`\`\`bash
# 1. Levantar PostgreSQL en Docker (puerto 5433)
docker run --name ${this.artifactId}-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=${this.artifactId.replace(/-/g, '_')}_db -p 5433:5432 -d postgres:16

# 2. Esperar unos segundos para que Postgres inicie
sleep 10

# 3. Ejecutar aplicación Spring Boot (Hibernate crea las tablas solo)
mvn spring-boot:run

# 4. Probar API
curl http://localhost:8090/api/usuario
\`\`\`

## Endpoints Generados

${classes.filter(c => c.stereotype === 'entity').map(cls => {
    const basePath = this.camelToKebabCase(cls.name);
    return `### ${cls.name}
- GET    \`/api/${basePath}\`     - Listar todos
- GET    \`/api/${basePath}/{id}\` - Obtener por ID
- POST   \`/api/${basePath}\`     - Crear nuevo
- PUT    \`/api/${basePath}/{id}\` - Actualizar
- DELETE \`/api/${basePath}/{id}\` - Eliminar`;
}).join('\n\n')}

## Notas

- Los DTOs y validaciones deben completarse según reglas de negocio
- Los métodos de mapeo en Services requieren implementación específica
- Se recomienda agregar tests unitarios e integración
- Configurar profiles para diferentes ambientes

---
*Generado automáticamente por UML Diagrammer*`;
    }

    generateGitignore() {
        return `# Compiled class file
*.class

# Log file
*.log

# BlueJ files
*.ctxt

# Mobile Tools for Java (J2ME)
.mtj.tmp/

# Package Files #
*.jar
*.war
*.nar
*.ear
*.zip
*.tar.gz
*.rar

# Maven
target/
pom.xml.tag
pom.xml.releaseBackup
pom.xml.versionsBackup
pom.xml.next
release.properties
dependency-reduced-pom.xml
buildNumber.properties
.mvn/timing.properties
.mvn/wrapper/maven-wrapper.jar

# IDE
.idea/
*.iws
*.iml
*.ipr
.vscode/
.settings/
.project
.classpath

# OS
.DS_Store
Thumbs.db

# Application
application-local.properties
*.env`;
    }

    // ==================== GENERADORES DE AUTENTICACIÓN ====================

    generateSecurityConfig() {
        return `package ${this.packageName}.config;

import ${this.packageName}.auth.filter.JwtAuthenticationFilter;
import ${this.packageName}.auth.service.UserDetailsServiceImpl;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;

/**
 * Configuración de Spring Security
 * Generada automáticamente desde diagrama UML
 */
@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final UserDetailsServiceImpl userDetailsService;
    private final JwtAuthenticationFilter jwtAuthenticationFilter;

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public DaoAuthenticationProvider authenticationProvider() {
        DaoAuthenticationProvider authProvider = new DaoAuthenticationProvider();
        authProvider.setUserDetailsService(userDetailsService);
        authProvider.setPasswordEncoder(passwordEncoder());
        return authProvider;
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.disable())
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll()
                .requestMatchers("/api/public/**").permitAll()
                .anyRequest().authenticated()
            )
            .authenticationProvider(authenticationProvider())
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOriginPatterns(Arrays.asList("*"));
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(Arrays.asList("*"));
        configuration.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}`;
    }

    generateJwtUtil() {
        return `package ${this.packageName}.config;

import io.jsonwebtoken.*;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Component;

import java.security.Key;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;

/**
 * Utilidad para manejo de tokens JWT
 * Generada automáticamente desde diagrama UML
 */
@Component
@Slf4j
public class JwtUtil {

    @Value("\${jwt.secret:404E635266556A586E3272357538782F413F4428472B4B6250645367566B5970}")
    private String secret;

    @Value("\${jwt.expiration:86400000}") // 24 horas
    private int jwtExpiration;

    public String extractUsername(String token) {
        return extractClaim(token, Claims::getSubject);
    }

    public Date extractExpiration(String token) {
        return extractClaim(token, Claims::getExpiration);
    }

    public <T> T extractClaim(String token, Function<Claims, T> claimsResolver) {
        final Claims claims = extractAllClaims(token);
        return claimsResolver.apply(claims);
    }

    private Claims extractAllClaims(String token) {
        return Jwts.parserBuilder()
                .setSigningKey(getSignKey())
                .build()
                .parseClaimsJws(token)
                .getBody();
    }

    private Boolean isTokenExpired(String token) {
        return extractExpiration(token).before(new Date());
    }

    public String generateToken(UserDetails userDetails) {
        Map<String, Object> claims = new HashMap<>();
        return createToken(claims, userDetails.getUsername());
    }

    private String createToken(Map<String, Object> claims, String subject) {
        return Jwts.builder()
                .setClaims(claims)
                .setSubject(subject)
                .setIssuedAt(new Date(System.currentTimeMillis()))
                .setExpiration(new Date(System.currentTimeMillis() + jwtExpiration))
                .signWith(getSignKey(), SignatureAlgorithm.HS256)
                .compact();
    }

    public Boolean validateToken(String token, UserDetails userDetails) {
        try {
            final String username = extractUsername(token);
            return (username.equals(userDetails.getUsername()) && !isTokenExpired(token));
        } catch (Exception e) {
            log.error("Error validando token JWT: {}", e.getMessage());
            return false;
        }
    }

    private Key getSignKey() {
        try {
            // Decodificar la clave secreta desde Base64 hexadecimal
            byte[] keyBytes = Decoders.BASE64.decode(secret);
            // Crear clave HMAC segura (mínimo 256 bits)
            return Keys.hmacShaKeyFor(keyBytes);
        } catch (Exception e) {
            log.error("Error generando clave JWT: {}", e.getMessage());
            // Fallback: generar clave segura automáticamente
            return Keys.secretKeyFor(SignatureAlgorithm.HS256);
        }
    }
}`;
    }

    generateUserDetailsService(userEntity, authInfo) {
        const emailField = authInfo.emailField || 'email';
        const passwordField = authInfo.passwordField || 'password';

        return `package ${this.packageName}.auth.service;

import ${this.packageName}.domain.model.${userEntity.name};
import ${this.packageName}.domain.repository.${userEntity.name}Repository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;

/**
 * Implementación de UserDetailsService para ${userEntity.name}
 * Generada automáticamente desde diagrama UML
 */
@Service
@RequiredArgsConstructor
public class UserDetailsServiceImpl implements UserDetailsService {

    private final ${userEntity.name}Repository userRepository;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        ${userEntity.name} user = userRepository.findByEmail(username)
                .orElseThrow(() -> new UsernameNotFoundException("Usuario no encontrado: " + username));

        return org.springframework.security.core.userdetails.User.builder()
                .username(user.get${this.capitalizeFirst(emailField)}())
                .password(user.get${this.capitalizeFirst(passwordField)}())
                .authorities(new ArrayList<>()) // TODO: Implementar roles si es necesario
                .build();
    }
}`;
    }

    generateAuthService(userEntity, authInfo) {
        // Usar los nombres de campos detectados para la entidad
        const emailField = authInfo.emailField || 'email';
        const passwordField = authInfo.passwordField || 'password';

        // Los DTOs siempre usan 'email' y 'password' estandarizados
        const emailSetter = `set${this.capitalizeFirst(emailField)}`;
        const passwordSetter = `set${this.capitalizeFirst(passwordField)}`;

        return `package ${this.packageName}.auth.service;

import ${this.packageName}.auth.dto.AuthResponseDTO;
import ${this.packageName}.auth.dto.LoginRequestDTO;
import ${this.packageName}.auth.dto.RegisterRequestDTO;
import ${this.packageName}.config.JwtUtil;
import ${this.packageName}.domain.model.${userEntity.name};
import ${this.packageName}.domain.repository.${userEntity.name}Repository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Servicio de autenticación
 * Generado automáticamente desde diagrama UML
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class AuthService {

    private final ${userEntity.name}Repository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final UserDetailsServiceImpl userDetailsService;
    private final JwtUtil jwtUtil;

    public AuthResponseDTO login(LoginRequestDTO request) {
        log.info("Intento de login para: {}", request.getEmail());

        // Autenticar usuario
        authenticationManager.authenticate(
            new UsernamePasswordAuthenticationToken(request.getEmail(), request.getPassword())
        );

        // Cargar detalles del usuario
        UserDetails userDetails = userDetailsService.loadUserByUsername(request.getEmail());

        // Generar token
        String token = jwtUtil.generateToken(userDetails);

        // Obtener información del usuario
        ${userEntity.name} user = userRepository.findByEmail(request.getEmail())
            .orElseThrow(() -> new RuntimeException("Usuario no encontrado"));

        log.info("Login exitoso para: {}", request.getEmail());

        return AuthResponseDTO.builder()
            .token(token)
            .email(user.get${this.capitalizeFirst(emailField)}())
            .message("Login exitoso")
            .build();
    }

    public AuthResponseDTO register(RegisterRequestDTO request) {
        log.info("Registro de nuevo usuario: {}", request.getEmail());

        // Verificar si el usuario ya existe
        if (userRepository.findByEmail(request.getEmail()).isPresent()) {
            throw new RuntimeException("El email ya está registrado");
        }

        // Crear nuevo usuario
        ${userEntity.name} user = new ${userEntity.name}();
        user.${emailSetter}(request.getEmail());
        user.${passwordSetter}(passwordEncoder.encode(request.getPassword()));

        // Mapear automáticamente otros campos de la entidad
${this.generateFieldMappingForRegister(userEntity, authInfo)}

        ${userEntity.name} savedUser = userRepository.save(user);

        // Generar token
        UserDetails userDetails = userDetailsService.loadUserByUsername(savedUser.get${this.capitalizeFirst(emailField)}());
        String token = jwtUtil.generateToken(userDetails);

        log.info("Usuario registrado exitosamente: {}", request.getEmail());

        return AuthResponseDTO.builder()
            .token(token)
            .email(savedUser.get${this.capitalizeFirst(emailField)}())
            .message("Usuario registrado exitosamente")
            .build();
    }
}`;
    }

    generateFieldMappingForRegister(userEntity, authInfo) {
        const mappings = [];
        const emailField = authInfo.emailField || 'email';
        const passwordField = authInfo.passwordField || 'password';
        const EMAIL_PATTERNS = ['email', 'correo', 'mail', 'e-mail'];
        const PASSWORD_PATTERNS = ['password', 'contraseña', 'clave', 'pass', 'pwd'];

        // Mapear todos los campos excepto email y password que ya están mapeados
        userEntity.attributes.forEach(attrString => {
            const attrData = this.parseAttribute(attrString);
            const fieldName = attrData.name;

            // Saltar campos ya mapeados o campos automáticos
            if (fieldName.toLowerCase() === 'id' ||
                fieldName === emailField ||
                fieldName === passwordField ||
                fieldName.toLowerCase() === 'createdat' ||
                fieldName.toLowerCase() === 'updatedat') {
                return;
            }

            // Determinar el nombre del campo en el DTO (mismo que en RegisterRequestDTO)
            const fieldLower = fieldName.toLowerCase();
            let dtoFieldName = fieldName; // Por defecto usar el nombre original

            // En el DTO se estandarizan email y password, otros campos mantienen nombre original
            if (EMAIL_PATTERNS.some(pattern => fieldLower.includes(pattern))) {
                dtoFieldName = 'email';
            } else if (PASSWORD_PATTERNS.some(pattern => fieldLower.includes(pattern))) {
                dtoFieldName = 'password';
            }

            // Generar setter para la entidad y getter del DTO
            const entitySetter = `set${this.capitalizeFirst(fieldName)}`;
            const dtoGetter = `get${this.capitalizeFirst(dtoFieldName)}`;

            mappings.push(`        user.${entitySetter}(request.${dtoGetter}());`);
            console.log(`Mapeo generado: request.${dtoGetter}() -> user.${entitySetter}()`);
        });

        return mappings.join('\n');
    }

    // ==================== MÉTODOS UTILITARIOS ====================

    generateAuthController(userEntity) {
        return `package ${this.packageName}.auth.controller;

import ${this.packageName}.auth.dto.AuthResponseDTO;
import ${this.packageName}.auth.dto.LoginRequestDTO;
import ${this.packageName}.auth.dto.RegisterRequestDTO;
import ${this.packageName}.auth.service.AuthService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;

/**
 * Controlador de autenticación
 * Generado automáticamente desde diagrama UML
 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
@Slf4j
@Validated
@CrossOrigin(origins = "*")
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public ResponseEntity<AuthResponseDTO> login(@Valid @RequestBody LoginRequestDTO request) {
        log.info("REST: Login attempt for {}", request.getEmail());
        AuthResponseDTO response = authService.login(request);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponseDTO> register(@Valid @RequestBody RegisterRequestDTO request) {
        log.info("REST: Register attempt for {}", request.getEmail());
        AuthResponseDTO response = authService.register(request);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/validate")
    public ResponseEntity<String> validateToken() {
        return ResponseEntity.ok("Token válido");
    }
}`;
    }

    generateLoginRequestDTO() {
        return `package ${this.packageName}.auth.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/**
 * DTO para solicitud de login
 * Generado automáticamente desde diagrama UML
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class LoginRequestDTO {

    @NotBlank(message = "El email es obligatorio")
    @Email(message = "El formato del email no es válido")
    private String email;

    @NotBlank(message = "La contraseña es obligatoria")
    private String password;
}`;
    }

    generateRegisterRequestDTO(userEntity, authInfo) {
        const EMAIL_PATTERNS = ['email', 'correo', 'mail', 'e-mail'];
        const PASSWORD_PATTERNS = ['password', 'contraseña', 'clave', 'pass', 'pwd'];

        const userAttributes = userEntity.attributes
            .filter(attr => {
                const attrLower = attr.toLowerCase();
                return !attrLower.includes('id') &&
                       !attrLower.includes('created') &&
                       !attrLower.includes('updated');
            })
            .map(attr => {
                const attrData = this.parseAttribute(attr);
                const javaType = this.mapUMLTypeToJava(attrData.type);
                let fieldName = attrData.name;

                // Estandarizar nombres para consistencia en DTOs
                const fieldLower = fieldName.toLowerCase();
                if (EMAIL_PATTERNS.some(pattern => fieldLower.includes(pattern))) {
                    fieldName = 'email';
                } else if (PASSWORD_PATTERNS.some(pattern => fieldLower.includes(pattern))) {
                    fieldName = 'password';
                }

                let validation = '';
                if (fieldName === 'email') {
                    validation = `    @NotBlank(message = "El email es obligatorio")
    @Email(message = "El formato del email no es válido")`;
                } else if (fieldName === 'password') {
                    validation = `    @NotBlank(message = "La contraseña es obligatoria")
    @Size(min = 6, message = "La contraseña debe tener al menos 6 caracteres")`;
                } else if (javaType === 'String') {
                    validation = `    @NotBlank(message = "El campo ${fieldName} es obligatorio")`;
                } else {
                    validation = `    @NotNull(message = "El campo ${fieldName} es obligatorio")`;
                }

                return `${validation}
    private ${javaType} ${fieldName};`;
            }).join('\n\n');

        return `package ${this.packageName}.auth.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import jakarta.validation.constraints.*;

/**
 * DTO para solicitud de registro
 * Generado automáticamente desde diagrama UML
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class RegisterRequestDTO {

${userAttributes}
}`;
    }    generateAuthResponseDTO() {
        return `package ${this.packageName}.auth.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO para respuesta de autenticación
 * Generado automáticamente desde diagrama UML
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AuthResponseDTO {

    private String token;
    private String email;
    private String message;
    private String type = "Bearer";
}`;
    }

    generateJwtAuthenticationFilter() {
        return `package ${this.packageName}.auth.filter;

import ${this.packageName}.auth.service.UserDetailsServiceImpl;
import ${this.packageName}.config.JwtUtil;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Filtro para autenticación JWT
 * Generado automáticamente desde diagrama UML
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;
    private final UserDetailsServiceImpl userDetailsService;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                  HttpServletResponse response,
                                  FilterChain filterChain) throws ServletException, IOException {

        final String authHeader = request.getHeader("Authorization");
        final String jwt;
        final String userEmail;

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            filterChain.doFilter(request, response);
            return;
        }

        jwt = authHeader.substring(7);

        try {
            userEmail = jwtUtil.extractUsername(jwt);

            if (userEmail != null && SecurityContextHolder.getContext().getAuthentication() == null) {
                UserDetails userDetails = this.userDetailsService.loadUserByUsername(userEmail);

                if (jwtUtil.validateToken(jwt, userDetails)) {
                    UsernamePasswordAuthenticationToken authToken = new UsernamePasswordAuthenticationToken(
                            userDetails,
                            null,
                            userDetails.getAuthorities()
                    );
                    authToken.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                    SecurityContextHolder.getContext().setAuthentication(authToken);
                }
            }
        } catch (Exception e) {
            log.error("Error procesando token JWT: {}", e.getMessage());
        }

        filterChain.doFilter(request, response);
    }
}`;
    }

    generateGlobalExceptionHandler(needsAuth = false) {
        const securityImports = needsAuth ?
            `import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.userdetails.UsernameNotFoundException;` : '';

        return `package ${this.packageName}.exception;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;${securityImports ? '\n' + securityImports : ''}
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * Manejador global de excepciones
 * Generado automáticamente desde diagrama UML
 */
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(EntityNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleEntityNotFoundException(EntityNotFoundException ex) {
        log.error("Entity not found: {}", ex.getMessage());

        ErrorResponse error = ErrorResponse.builder()
            .timestamp(LocalDateTime.now())
            .status(HttpStatus.NOT_FOUND.value())
            .error("Not Found")
            .message(ex.getMessage())
            .build();

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
    }${needsAuth ? `

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<ErrorResponse> handleBadCredentials(BadCredentialsException ex) {
        log.error("Bad credentials: {}", ex.getMessage());

        ErrorResponse error = ErrorResponse.builder()
            .timestamp(LocalDateTime.now())
            .status(HttpStatus.UNAUTHORIZED.value())
            .error("Unauthorized")
            .message("Credenciales inválidas")
            .build();

        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
    }

    @ExceptionHandler(UsernameNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUsernameNotFound(UsernameNotFoundException ex) {
        log.error("Username not found: {}", ex.getMessage());

        ErrorResponse error = ErrorResponse.builder()
            .timestamp(LocalDateTime.now())
            .status(HttpStatus.UNAUTHORIZED.value())
            .error("Unauthorized")
            .message("Usuario no encontrado")
            .build();

        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
    }` : ''}

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationExceptions(MethodArgumentNotValidException ex) {
        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getAllErrors().forEach((error) -> {
            String fieldName = ((FieldError) error).getField();
            String errorMessage = error.getDefaultMessage();
            errors.put(fieldName, errorMessage);
        });

        ErrorResponse error = ErrorResponse.builder()
            .timestamp(LocalDateTime.now())
            .status(HttpStatus.BAD_REQUEST.value())
            .error("Validation Failed")
            .message("Datos de entrada inválidos")
            .validationErrors(errors)
            .build();

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<ErrorResponse> handleRuntimeException(RuntimeException ex) {
        log.error("Runtime exception: {}", ex.getMessage(), ex);

        ErrorResponse error = ErrorResponse.builder()
            .timestamp(LocalDateTime.now())
            .status(HttpStatus.INTERNAL_SERVER_ERROR.value())
            .error("Internal Server Error")
            .message(ex.getMessage())
            .build();

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGenericException(Exception ex) {
        log.error("Unexpected exception: {}", ex.getMessage(), ex);

        ErrorResponse error = ErrorResponse.builder()
            .timestamp(LocalDateTime.now())
            .status(HttpStatus.INTERNAL_SERVER_ERROR.value())
            .error("Internal Server Error")
            .message("Error interno del servidor")
            .build();

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }
}

@lombok.Data
@lombok.Builder
@lombok.NoArgsConstructor
@lombok.AllArgsConstructor
class ErrorResponse {
    private LocalDateTime timestamp;
    private int status;
    private String error;
    private String message;
    private Map<String, String> validationErrors;
}`;
    }

    generateEntityNotFoundException() {
        return `package ${this.packageName}.exception;

/**
 * Excepción para entidad no encontrada
 * Generada automáticamente desde diagrama UML
 */
public class EntityNotFoundException extends RuntimeException {

    public EntityNotFoundException(String message) {
        super(message);
    }

    public EntityNotFoundException(String message, Throwable cause) {
        super(message, cause);
    }

    public static EntityNotFoundException notFound(String entityName, Object id) {
        return new EntityNotFoundException(
            String.format("%s no encontrado con ID: %s", entityName, id)
        );
    }
}`;
    }

    generateAuthenticationException() {
        return `package ${this.packageName}.exception;

/**
 * Excepción para errores de autenticación
 * Generada automáticamente desde diagrama UML
 */
public class AuthenticationException extends RuntimeException {

    public AuthenticationException(String message) {
        super(message);
    }

    public AuthenticationException(String message, Throwable cause) {
        super(message, cause);
    }
}`;
    }

    sanitizeProjectName(name) {
        return name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    }

    camelToSnakeCase(str) {
        return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    }

    camelToKebabCase(str) {
        return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    decapitalizeFirst(str) {
        return str.charAt(0).toLowerCase() + str.slice(1);
    }

    downloadProject(zip) {
        const filename = `${this.artifactId}-SpringBoot.zip`;

        zip.generateAsync({ type: 'blob' }).then(content => {
            const url = URL.createObjectURL(content);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setTimeout(() => URL.revokeObjectURL(url), 100);

            console.log('📥 Proyecto Spring Boot descargado:', filename);
        });
    }
}

// Método estático para uso rápido
SimpleJavaGenerator.quickGenerateJava = function(editor) {
    const generator = new SimpleJavaGenerator(editor);
    generator.generateJavaProject();
};
