// resources/js/diagram/utils/simplePostmanGenerator.js
// Generador simple de colecciones Postman desde diagramas UML

import { SimpleJavaGenerator } from './simpleJavaGenerator.js';

export class SimplePostmanGenerator {
    constructor(editor) {
        this.editor = editor;
        this.projectName = 'MiProyecto';
        this.baseUrl = 'http://localhost:8090'; // mismo puerto que server.port en simpleJavaGenerator.js
        this.collectionId = this.generateUUID();
        // Instancia del generador Java para usar su lógica de mapeo
        this.javaGenerator = new SimpleJavaGenerator(editor);
    }

    generatePostmanCollection() {
        try {
            console.log('📡 Iniciando generación de colección Postman...');

            // Configurar proyecto
            this.setupProjectConfig();

            // Extraer clases entities del diagrama (misma lógica que Java Generator)
            const entities = this.extractEntities();
            this.relationships = this.extractRelationships();

            // Sincronizar relaciones con el generador Java
            this.javaGenerator.relationships = this.relationships;

            if (entities.length === 0) {
                alert('⚠️ No hay clases en el diagrama para generar endpoints.');
                return;
            }

            // Detectar si necesita autenticación JWT
            const authInfo = this.detectAuthenticationEntities(entities);

            // Generar colección completa
            const collection = this.buildPostmanCollection(entities, this.relationships, authInfo);

            // Descargar
            this.downloadCollection(collection);

            console.log('✅ Colección Postman generada exitosamente');
        } catch (error) {
            console.error('❌ Error generando colección Postman:', error);
            alert('Error al generar colección: ' + error.message);
        }
    }

    setupProjectConfig() {
        const diagramTitle = window.diagramTitle || 'MiProyecto';
        this.projectName = this.sanitizeProjectName(diagramTitle);

        console.log('📡 Configuración de la colección:', {
            projectName: this.projectName,
            baseUrl: this.baseUrl
        });
    }

    // Copiar lógica de detección de autenticación del Spring Boot Generator
    detectAuthenticationEntities(entities) {
        // Patrones de detección (mismos que Spring Boot Generator)
        const USER_PATTERNS = ['user', 'usuario', 'account', 'cuenta', 'cliente', 'client'];
        const EMAIL_PATTERNS = ['email', 'correo', 'mail', 'e-mail'];
        const PASSWORD_PATTERNS = ['password', 'contraseña', 'clave', 'pass', 'pwd'];

        // Buscar entidad de usuario
        const userEntity = entities.find(entity => {
            const className = entity.name.toLowerCase();
            return USER_PATTERNS.some(pattern => className.includes(pattern));
        });

        if (!userEntity) {
            console.log('❌ No se encontró entidad de usuario para autenticación');
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
            console.log('🎉 Endpoints de autenticación JWT serán incluidos');
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

    extractEntities() {
        const entities = [];
        const elements = this.editor.graph.getElements();

        elements.forEach(element => {
            const umlData = element.get('umlData');
            // Procesar TODAS las clases (misma lógica que Spring Boot Generator)
            if (umlData && umlData.type === 'class') {
                // Mismo saneo que `SimpleJavaGenerator.sanitizeJavaIdentifier()`
                // (nombres idénticos, no solo "parecidos") — la colección
                // Postman arma sus URLs con `camelToKebabCase(className)`, que
                // tiene que dar EXACTAMENTE lo mismo que las rutas reales que
                // expone el backend generado (`03-generadores-codigo.md` §5 ya
                // documenta este acoplamiento). Un nombre con espacio (ej. una
                // clase huérfana "Class 1") generaba una URL con espacio
                // adentro, mientras el backend real ya sanitizaba a "Class1".
                const className = this.sanitizeIdentifier(umlData.className, 'UnnamedEntity');
                const stereotype = umlData.uml25?.stereotype || 'entity'; // Default a entity

                entities.push({
                    id: element.id,
                    name: className,
                    stereotype: stereotype,
                    attributes: umlData.attributes || [],
                    methods: umlData.methods || [],
                    responsibilities: umlData.uml25?.responsibilities || [],
                    constraints: umlData.uml25?.constraints || []
                });
            }
        });

        console.log('🏗️ Entidades extraídas:', entities.length, 'con estereotipos:',
            entities.map(e => `${e.name}(${e.stereotype})`));
        return entities;
    }

    extractRelationships() {
        const relationships = [];
        const links = this.editor.graph.getLinks();

        links.forEach(link => {
            // OJO: getSourceElement()/getTargetElement() de JointJS NO dan
            // null para un link "clase asociativa" (target = otro link) —
            // resuelven recursivamente a través del link host hasta un
            // elemento real. Excluir por relationData.type acá también.
            if ((link.get('relationData') || {}).type === 'associationClassLink') return;

            const source = link.getSourceElement();
            const target = link.getTargetElement();
            const umlData = link.get('umlData') || {};

            if (source && target) {
                const sourceUml = source.get('umlData');
                const targetUml = target.get('umlData');

                // Procesar relaciones entre TODAS las clases (misma lógica que Spring Boot)
                if (sourceUml?.type === 'class' && targetUml?.type === 'class') {
                    const sourceClassName = this.sanitizeIdentifier(sourceUml.className, 'UnnamedEntity');
                    const targetClassName = this.sanitizeIdentifier(targetUml.className, 'UnnamedEntity');
                    relationships.push({
                        id: link.id,
                        sourceClass: sourceClassName,
                        targetClass: targetClassName,
                        sourceEntity: sourceClassName, // Compatibilidad
                        targetEntity: targetClassName, // Compatibilidad
                        type: umlData.relationshipType || 'association',
                        sourceMultiplicity: umlData.sourceMultiplicity || '1',
                        targetMultiplicity: umlData.targetMultiplicity || '1',
                        name: umlData.name || ''
                    });
                }
            }
        });

        console.log('🔗 Relaciones extraídas:', relationships.length,
            'relaciones:', relationships.map(r => `${r.sourceClass} -> ${r.targetClass}`));
        return relationships;
    }

    buildPostmanCollection(entities, relationships, authInfo = { needsAuth: false }) {
        const authSection = authInfo.needsAuth ?
            `**🔐 Autenticación JWT:**\\n` +
            `- Sistema de autenticación detectado automáticamente\\n` +
            `- JWT seguro con clave de 256 bits (cumple RFC 7518)\\n` +
            `- Usar /api/auth/login para obtener token\\n` +
            `- Token se guarda automáticamente en variable {{jwtToken}}\\n` +
            `- Expiración: 24 horas (configurable en application.properties)\\n\\n` : '';

        const collection = {
            info: {
                _postman_id: this.collectionId,
                name: `${this.projectName} - API REST`,
                description: `Colección Postman generada automáticamente desde diagrama UML\\n\\n` +
                            `**Entidades incluidas:** ${entities.map(e => e.name).join(', ')}\\n\\n` +
                            authSection +
                            `**Configuración:**\\n` +
                            `- Configura la variable {{baseUrl}} = ${this.baseUrl}\\n` +
                            `- Asegúrate de que el servidor Spring Boot esté ejecutándose\\n\\n` +
                            `**Endpoints generados:**\\n` +
                            `- CRUD completo para cada entidad\\n` +
                            `- Tests automáticos incluidos\\n` +
                            `- Autenticación JWT (si se detectó usuario)\\n\\n` +
                            `*Generado por UML Diagrammer*`,
                schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
            },
            item: [],
            variable: this.generateEnvironmentVariables(authInfo.needsAuth)
        };

        // Agregar carpeta de autenticación JWT si se detectó
        if (authInfo.needsAuth) {
            const authFolder = this.generateAuthFolder(authInfo);
            collection.item.push(authFolder);
        }

        // Generar carpetas y endpoints por entidad
        entities.forEach(entity => {
            const entityFolder = this.generateEntityFolder(entity, relationships, authInfo.needsAuth);
            collection.item.push(entityFolder);
        });

        // Agregar carpeta de endpoints de relaciones si existen
        if (relationships.length > 0) {
            const relationshipsFolder = this.generateRelationshipsFolder(relationships, entities);
            collection.item.push(relationshipsFolder);
        }

        // Agregar carpeta de utilidades
        const utilsFolder = this.generateUtilsFolder();
        collection.item.push(utilsFolder);

        return collection;
    }

    generateAuthFolder(authInfo) {
        return {
            name: "🔐 Autenticación JWT",
            item: [
                this.generateLoginEndpoint(authInfo),
                this.generateRegisterEndpoint(authInfo)
            ]
        };
    }

    generateLoginEndpoint(authInfo) {
        const requestBody = {};
        requestBody[authInfo.emailField] = "usuario@ejemplo.com";
        requestBody[authInfo.passwordField] = "password123";

        return {
            name: "🔑 Login",
            request: {
                method: "POST",
                header: [
                    {
                        key: "Content-Type",
                        value: "application/json"
                    },
                    {
                        key: "Accept",
                        value: "application/json"
                    }
                ],
                body: {
                    mode: "raw",
                    raw: JSON.stringify(requestBody, null, 2)
                },
                url: {
                    raw: "{{baseUrl}}/api/auth/login",
                    host: ["{{baseUrl}}"],
                    path: ["api", "auth", "login"]
                },
                description: `Autenticación con JWT Token seguro\\n\\n` +
                           `**Credenciales de ejemplo:**\\n` +
                           `- ${authInfo.emailField}: usuario@ejemplo.com\\n` +
                           `- ${authInfo.passwordField}: password123\\n\\n` +
                           `**Seguridad JWT:**\\n` +
                           `- Algoritmo: HMAC-SHA256 (HS256)\\n` +
                           `- Clave: 256 bits (cumple RFC 7518)\\n` +
                           `- Expiración: 24 horas\\n\\n` +
                           `**Respuesta esperada:**\\n` +
                           `- Status: 200 OK\\n` +
                           `- JWT token seguro en el response\\n` +
                           `- Token se guarda automáticamente en variable {{jwtToken}}`
            },
            event: [
                {
                    listen: "test",
                    script: {
                        exec: [
                            "pm.test('Login exitoso', function () {",
                            "    pm.response.to.have.status(200);",
                            "});",
                            "",
                            "pm.test('Response contiene token JWT', function () {",
                            "    const jsonData = pm.response.json();",
                            "    pm.expect(jsonData).to.have.property('token');",
                            "    pm.expect(jsonData.token).to.be.a('string');",
                            "});",
                            "",
                            "// Guardar token JWT para otros endpoints",
                            "if (pm.response.code === 200) {",
                            "    const jsonData = pm.response.json();",
                            "    pm.collectionVariables.set('jwtToken', jsonData.token);",
                            "    console.log('🔑 JWT Token guardado para requests posteriores');",
                            "}"
                        ]
                    }
                }
            ]
        };
    }

    generateRegisterEndpoint(authInfo) {
        const requestBody = {};
        // En el RegisterRequestDTO, email y password se estandarizan
        requestBody["email"] = "nuevo@ejemplo.com";
        requestBody["password"] = "password123";

        // Otros campos mantienen sus nombres originales de la entidad
        // Agregar todos los campos no-email/password de la entidad usuario
        authInfo.userEntity.attributes.forEach(attrString => {
            const attrData = this.parseAttribute(attrString);
            const fieldName = attrData.name;
            const fieldLower = fieldName.toLowerCase();

            // Saltar campos automáticos y ya incluidos
            if (fieldName.toLowerCase() === 'id' ||
                fieldLower.includes('email') ||
                fieldLower.includes('password') ||
                fieldLower.includes('contraseña') ||
                fieldName.toLowerCase() === 'createdat' ||
                fieldName.toLowerCase() === 'updatedat') {
                return;
            }

            // Agregar campo con valor de ejemplo usando tipos Java exactos
            const javaType = this.javaGenerator.mapUMLTypeToJava(attrData.type);
            requestBody[fieldName] = this.generateSampleValueForJavaType(javaType, fieldName, attrData.type);
        });

        return {
            name: "📝 Register",
            request: {
                method: "POST",
                header: [
                    {
                        key: "Content-Type",
                        value: "application/json"
                    },
                    {
                        key: "Accept",
                        value: "application/json"
                    }
                ],
                body: {
                    mode: "raw",
                    raw: JSON.stringify(requestBody, null, 2)
                },
                url: {
                    raw: "{{baseUrl}}/api/auth/register",
                    host: ["{{baseUrl}}"],
                    path: ["api", "auth", "register"]
                },
                description: `Registro de nuevo usuario\\n\\n` +
                           `**Datos requeridos:**\\n` +
                           `- ${authInfo.emailField}: Email único\\n` +
                           `- ${authInfo.passwordField}: Contraseña (mín. 6 caracteres)\\n` +
                           `- nombre: Nombre del usuario\\n\\n` +
                           `**Respuesta esperada:**\\n` +
                           `- Status: 201 Created\\n` +
                           `- JWT token del nuevo usuario`
            },
            event: [
                {
                    listen: "test",
                    script: {
                        exec: [
                            "pm.test('Registro exitoso', function () {",
                            "    pm.response.to.have.status(201);",
                            "});",
                            "",
                            "pm.test('Response contiene token JWT', function () {",
                            "    const jsonData = pm.response.json();",
                            "    pm.expect(jsonData).to.have.property('token');",
                            "});",
                            "",
                            "// Guardar token del nuevo usuario",
                            "if (pm.response.code === 201) {",
                            "    const jsonData = pm.response.json();",
                            "    pm.collectionVariables.set('jwtToken', jsonData.token);",
                            "    console.log('🔑 JWT Token del nuevo usuario guardado');",
                            "}"
                        ]
                    }
                }
            ]
        };
    }

    generateEntityFolder(entity, relationships, hasAuth = false) {
        const entityName = entity.name;
        const entityPath = this.camelToKebabCase(entityName);
        const entityRelationships = relationships.filter(r =>
            r.sourceEntity === entityName || r.targetEntity === entityName
        );

        return {
            name: `📦 ${entityName}`,
            item: [
                this.generateGetAllEndpoint(entity, hasAuth),
                this.generateGetByIdEndpoint(entity, hasAuth),
                this.generateCreateEndpoint(entity, hasAuth),
                this.generateUpdateEndpoint(entity, hasAuth),
                this.generateDeleteEndpoint(entity, hasAuth),
                // Endpoints específicos de relaciones para esta entidad
                ...this.generateEntityRelationshipEndpoints(entity, entityRelationships)
            ]
        };
    }

    generateGetAllEndpoint(entity, hasAuth = false) {
        const entityPath = this.camelToKebabCase(entity.name);
        const headers = [
            {
                key: "Accept",
                value: "application/json"
            }
        ];

        // Agregar header JWT si hay autenticación
        if (hasAuth) {
            headers.push({
                key: "Authorization",
                value: "Bearer {{jwtToken}}"
            });
        }

        return {
            name: `📋 Obtener todos los ${entity.name}`,
            request: {
                method: "GET",
                header: headers,
                url: {
                    raw: "{{baseUrl}}/api/" + entityPath,
                    host: ["{{baseUrl}}"],
                    path: ["api", entityPath]
                },
                description: `Obtiene una lista de todos los ${entity.name}s disponibles.\\n\\n` +
                           `**Respuesta esperada:**\\n` +
                           `- Status: 200 OK\\n` +
                           `- Array de objetos ${entity.name}ResponseDTO`
            },
            response: [
                this.generateSampleResponse(entity, 'array')
            ],
            event: [
                this.generateBasicTest(`Listar ${entity.name}s`)
            ]
        };
    }

    generateGetByIdEndpoint(entity, hasAuth = false) {
        const entityPath = this.camelToKebabCase(entity.name);
        const headers = [
            {
                key: "Accept",
                value: "application/json"
            }
        ];

        if (hasAuth) {
            headers.push({
                key: "Authorization",
                value: "Bearer {{jwtToken}}"
            });
        }

        return {
            name: `🔍 Obtener ${entity.name} por ID`,
            request: {
                method: "GET",
                header: headers,
                url: {
                    raw: "{{baseUrl}}/api/" + entityPath + "/{{entityId}}",
                    host: ["{{baseUrl}}"],
                    path: ["api", entityPath, "{{entityId}}"]
                },
                description: `Obtiene un ${entity.name} específico por su ID.\\n\\n` +
                           `**Parámetros:**\\n` +
                           `- entityId: ID del ${entity.name} a buscar\\n\\n` +
                           `**Respuesta esperada:**\\n` +
                           `- Status: 200 OK si existe\\n` +
                           `- Status: 404 Not Found si no existe`
            },
            response: [
                this.generateSampleResponse(entity, 'single')
            ],
            event: [
                this.generateBasicTest(`Obtener ${entity.name} por ID`)
            ]
        };
    }

    generateCreateEndpoint(entity, hasAuth = false) {
        const entityPath = this.camelToKebabCase(entity.name);
        const requestBody = this.generateRequestBody(entity);
        const headers = [
            {
                key: "Content-Type",
                value: "application/json"
            },
            {
                key: "Accept",
                value: "application/json"
            }
        ];

        if (hasAuth) {
            headers.push({
                key: "Authorization",
                value: "Bearer {{jwtToken}}"
            });
        }

        return {
            name: `➕ Crear nuevo ${entity.name}`,
            request: {
                method: "POST",
                header: headers,
                body: {
                    mode: "raw",
                    raw: JSON.stringify(requestBody, null, 2)
                },
                url: {
                    raw: "{{baseUrl}}/api/" + entityPath,
                    host: ["{{baseUrl}}"],
                    path: ["api", entityPath]
                },
                description: `Crea un nuevo ${entity.name}.\\n\\n` +
                           `**Body requerido:**\\n` +
                           `- JSON con datos del ${entity.name}RequestDTO\\n\\n` +
                           `**Respuesta esperada:**\\n` +
                           `- Status: 201 Created\\n` +
                           `- Objeto ${entity.name}ResponseDTO creado`
            },
            response: [
                this.generateSampleResponse(entity, 'created')
            ],
            event: [
                this.generateCreateTest(entity.name)
            ]
        };
    }

    generateUpdateEndpoint(entity, hasAuth = false) {
        const entityPath = this.camelToKebabCase(entity.name);
        const requestBody = this.generateRequestBody(entity);
        const headers = [
            {
                key: "Content-Type",
                value: "application/json"
            },
            {
                key: "Accept",
                value: "application/json"
            }
        ];

        if (hasAuth) {
            headers.push({
                key: "Authorization",
                value: "Bearer {{jwtToken}}"
            });
        }

        return {
            name: `✏️ Actualizar ${entity.name}`,
            request: {
                method: "PUT",
                header: headers,
                body: {
                    mode: "raw",
                    raw: JSON.stringify(requestBody, null, 2)
                },
                url: {
                    raw: "{{baseUrl}}/api/" + entityPath + "/{{entityId}}",
                    host: ["{{baseUrl}}"],
                    path: ["api", entityPath, "{{entityId}}"]
                },
                description: `Actualiza un ${entity.name} existente.\\n\\n` +
                           `**Parámetros:**\\n` +
                           `- entityId: ID del ${entity.name} a actualizar\\n\\n` +
                           `**Body requerido:**\\n` +
                           `- JSON con datos actualizados\\n\\n` +
                           `**Respuesta esperada:**\\n` +
                           `- Status: 200 OK si se actualiza\\n` +
                           `- Status: 404 Not Found si no existe`
            },
            response: [
                this.generateSampleResponse(entity, 'updated')
            ],
            event: [
                this.generateBasicTest(`Actualizar ${entity.name}`)
            ]
        };
    }

    generateDeleteEndpoint(entity, hasAuth = false) {
        const entityPath = this.camelToKebabCase(entity.name);
        const headers = [
            {
                key: "Accept",
                value: "application/json"
            }
        ];

        if (hasAuth) {
            headers.push({
                key: "Authorization",
                value: "Bearer {{jwtToken}}"
            });
        }

        return {
            name: `🗑️ Eliminar ${entity.name}`,
            request: {
                method: "DELETE",
                header: headers,
                url: {
                    raw: "{{baseUrl}}/api/" + entityPath + "/{{entityId}}",
                    host: ["{{baseUrl}}"],
                    path: ["api", entityPath, "{{entityId}}"]
                },
                description: `Elimina un ${entity.name} específico.\\n\\n` +
                           `**Parámetros:**\\n` +
                           `- entityId: ID del ${entity.name} a eliminar\\n\\n` +
                           `**Respuesta esperada:**\\n` +
                           `- Status: 204 No Content si se elimina\\n` +
                           `- Status: 404 Not Found si no existe`
            },
            event: [
                this.generateDeleteTest(entity.name)
            ]
        };
    }

    generateEntityRelationshipEndpoints(entity, relationships) {
        const endpoints = [];

        relationships.forEach(rel => {
            if (rel.sourceEntity === entity.name) {
                // Esta entidad es la fuente de la relación
                const targetPath = this.camelToKebabCase(rel.targetEntity);
                const entityPath = this.camelToKebabCase(entity.name);

                if (rel.targetMultiplicity.includes('*') || rel.targetMultiplicity.includes('n')) {
                    // Relación uno-a-muchos: obtener entidades relacionadas
                    endpoints.push({
                        name: `🔗 Obtener ${rel.targetEntity}s de ${entity.name}`,
                        request: {
                            method: "GET",
                            header: [
                                {
                                    key: "Accept",
                                    value: "application/json"
                                }
                            ],
                            url: {
                                raw: `{{baseUrl}}/api/${entityPath}/{{entityId}}/${targetPath}`,
                                host: ["{{baseUrl}}"],
                                path: ["api", entityPath, "{{entityId}}", targetPath]
                            },
                            description: `Obtiene todos los ${rel.targetEntity}s asociados a un ${entity.name} específico.\\n\\n` +
                                       `**Relación UML:** ${rel.type}\\n` +
                                       `**Multiplicidad:** ${rel.sourceMultiplicity} → ${rel.targetMultiplicity}`
                        },
                        event: [
                            this.generateBasicTest(`Obtener ${rel.targetEntity}s relacionados`)
                        ]
                    });
                }
            }
        });

        return endpoints;
    }

    generateRelationshipsFolder(relationships, entities) {
        return {
            name: "🔗 Endpoints de Relaciones",
            item: [
                {
                    name: "📋 Resumen de Relaciones",
                    request: {
                        method: "GET",
                        header: [],
                        url: {
                            raw: "{{baseUrl}}/api/relationships/summary",
                            host: ["{{baseUrl}}"],
                            path: ["api", "relationships", "summary"]
                        },
                        description: `**Relaciones detectadas en el diagrama UML:**\\n\\n` +
                                   relationships.map(rel =>
                                       `- **${rel.sourceEntity}** ${rel.type} **${rel.targetEntity}** ` +
                                       `(${rel.sourceMultiplicity} → ${rel.targetMultiplicity})`
                                   ).join('\\n') +
                                   `\\n\\n*Nota: Este endpoint no existe en el servidor, es solo documentación.*`
                    }
                }
            ]
        };
    }

    generateUtilsFolder() {
        return {
            name: "🛠️ Utilidades",
            item: [
                {
                    name: "❤️ Health Check",
                    request: {
                        method: "GET",
                        header: [
                            {
                                key: "Accept",
                                value: "application/json"
                            }
                        ],
                        url: {
                            raw: "{{baseUrl}}/actuator/health",
                            host: ["{{baseUrl}}"],
                            path: ["actuator", "health"]
                        },
                        description: "Verifica que el servidor Spring Boot esté funcionando correctamente."
                    },
                    event: [
                        {
                            listen: "test",
                            script: {
                                exec: [
                                    "pm.test('Servidor Spring Boot activo', function () {",
                                    "    pm.response.to.have.status(200);",
                                    "});",
                                    "",
                                    "pm.test('Health check response', function () {",
                                    "    const jsonData = pm.response.json();",
                                    "    pm.expect(jsonData.status).to.eql('UP');",
                                    "});"
                                ]
                            }
                        }
                    ]
                },
                {
                    name: "📊 Configurar Variables",
                    request: {
                        method: "GET",
                        header: [],
                        url: {
                            raw: "{{baseUrl}}",
                            host: ["{{baseUrl}}"]
                        },
                        description: `**Configuración de variables de entorno:**\\n\\n` +
                                   `1. **baseUrl:** ${this.baseUrl}\\n` +
                                   `2. **entityId:** 1 (o el ID que quieras probar)\\n\\n` +
                                   `**Pasos para configurar:**\\n` +
                                   `1. Haz clic en el ojo 👁️ en la esquina superior derecha\\n` +
                                   `2. Edita las variables según tu configuración\\n` +
                                   `3. Guarda los cambios\\n\\n` +
                                   `**Verificar servidor:**\\n` +
                                   `- Ejecuta: mvn spring-boot:run\\n` +
                                   `- Verifica: ${this.baseUrl}/actuator/health`
                    }
                }
            ]
        };
    }

    // ==================== GENERADORES DE DATOS Y RESPUESTAS ====================

    generateRequestBody(entity) {
        const body = {};

        // Agregar atributos regulares
        entity.attributes.forEach(attr => {
            const attrData = this.parseAttribute(attr);
            const javaType = this.javaGenerator.mapUMLTypeToJava(attrData.type);

            // Usar exactamente la misma lógica que los DTOs del backend
            body[attrData.name] = this.generateSampleValueForJavaType(javaType, attrData.name, attrData.type);
        });

        // Agregar campos de relación (foreign keys)
        const relationshipFields = this.generateRelationshipFieldsForPostman(entity.name);
        Object.assign(body, relationshipFields);

        return body;
    }

    /**
     * Genera campos de relación (foreign keys) para Postman
     */
    generateRelationshipFieldsForPostman(className) {
        const fields = {};

        console.log(`🔍 Postman: Generando FK para ${className}`);
        console.log(`🔍 Postman: Relaciones disponibles:`, this.relationships?.length || 0);

        if (!this.relationships || this.relationships.length === 0) {
            console.log(`⚠️ Postman: No hay relaciones para procesar en ${className}`);
            return fields;
        }

        this.relationships.forEach(rel => {
            console.log(`🔍 Postman: Analizando relación para ${className}:`, rel);

            let needsForeignKey = false;
            let relatedClass = null;

            // Determinar si esta clase necesita foreign key (misma lógica que el generador Java)
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

            // Agregar foreign key field si es necesario
            if (needsForeignKey && relatedClass) {
                const fieldName = relatedClass.toLowerCase();
                const foreignKeyField = `${fieldName}Id`;

                console.log(`🔗 Postman: Agregando campo de relación a ${className}: ${foreignKeyField} -> ${relatedClass}`);
                fields[foreignKeyField] = 1;
            }
        });

        console.log(`✅ Postman: FK generadas para ${className}:`, Object.keys(fields));
        return fields;
    }

    generateSampleResponse(entity, type) {
        const body = {
            id: 1,
            createdAt: "2024-01-15T10:30:00",
            updatedAt: "2024-01-15T10:30:00"
        };

        entity.attributes.forEach(attr => {
            const attrData = this.parseAttribute(attr);
            const javaType = this.javaGenerator.mapUMLTypeToJava(attrData.type);
            // Usar exactamente la misma lógica que los ResponseDTOs del Spring Boot generator
            body[attrData.name] = this.generateSampleValueForJavaType(javaType, attrData.name, attrData.type);
        });

        let responseBody;
        let status;

        switch (type) {
            case 'array':
                responseBody = [body, { ...body, id: 2 }];
                status = 200;
                break;
            case 'created':
                status = 201;
                responseBody = body;
                break;
            case 'updated':
                status = 200;
                responseBody = body;
                break;
            default:
                status = 200;
                responseBody = body;
        }

        return {
            name: `Ejemplo de respuesta ${type}`,
            originalRequest: {
                method: "GET",
                header: [],
                url: {
                    raw: "{{baseUrl}}/api/ejemplo",
                    host: ["{{baseUrl}}"],
                    path: ["api", "ejemplo"]
                }
            },
            status: `${status} ${this.getStatusText(status)}`,
            code: status,
            _postman_previewlanguage: "json",
            header: [
                {
                    key: "Content-Type",
                    value: "application/json"
                }
            ],
            cookie: [],
            body: JSON.stringify(responseBody, null, 2)
        };
    }

    generateSampleValue(type, name) {
        const lowerName = name.toLowerCase();

        // Valores específicos basados en el nombre del atributo
        if (lowerName.includes('email')) return 'usuario@ejemplo.com';
        if (lowerName.includes('nombre') || lowerName.includes('name')) return 'Ejemplo Nombre';
        if (lowerName.includes('descripcion') || lowerName.includes('description')) return 'Descripción de ejemplo';
        if (lowerName.includes('precio') || lowerName.includes('price')) return 99.99;
        if (lowerName.includes('cantidad') || lowerName.includes('quantity')) return 10;
        if (lowerName.includes('telefono') || lowerName.includes('phone')) return '+1234567890';
        if (lowerName.includes('direccion') || lowerName.includes('address')) return 'Calle Ejemplo 123';
        if (lowerName.includes('codigo') || lowerName.includes('code')) return 'ABC123';

        // Valores por tipo
        const typeMap = {
            'String': 'Valor de ejemplo',
            'int': 42,
            'Integer': 42,
            'long': 123456789,
            'Long': 123456789,
            'double': 99.99,
            'Double': 99.99,
            'float': 99.9,
            'Float': 99.9,
            'boolean': true,
            'Boolean': true,
            'Date': '2024-01-15T10:30:00',
            'LocalDateTime': '2024-01-15T10:30:00',
            'LocalDate': '2024-01-15',
            'BigDecimal': '999.99'
        };

        return typeMap[type] || 'Valor de ejemplo';
    }

    /**
     * Genera valores de ejemplo basados exactamente en los tipos Java del backend
     */
    generateSampleValueForJavaType(javaType, fieldName, originalType) {
        const lowerName = fieldName.toLowerCase();

        // Valores específicos basados en el nombre del campo (prioritarios)
        if (lowerName.includes('email')) return 'usuario@ejemplo.com';
        if (lowerName.includes('password') || lowerName.includes('contraseña')) return 'MiContraseña123';
        if (lowerName.includes('nombre') || lowerName.includes('name')) return 'Ejemplo Nombre';
        if (lowerName.includes('descripcion') || lowerName.includes('description')) return 'Descripción de ejemplo';
        if (lowerName.includes('precio') || lowerName.includes('price')) return '99.99';
        if (lowerName.includes('cantidad') || lowerName.includes('quantity')) return 10;
        if (lowerName.includes('telefono') || lowerName.includes('phone')) return '+1234567890';
        if (lowerName.includes('direccion') || lowerName.includes('address')) return 'Calle Ejemplo 123';
        if (lowerName.includes('codigo') || lowerName.includes('code')) return 'ABC123';
        if (lowerName.includes('sitio') || lowerName.includes('web') || lowerName.includes('url')) return 'https://ejemplo.com';

        // Mapeo exacto por tipos Java (como los genera el SimpleJavaGenerator)
        const javaTypeMap = {
            'String': 'Valor de ejemplo',
            'int': 42,
            'Integer': 42,
            'long': 123456789,
            'Long': 123456789,
            'double': 99.99,
            'Double': 99.99,
            'float': 99.9,
            'Float': 99.9,
            'boolean': true,
            'Boolean': true,
            'Date': '2024-01-15T10:30:00',
            'LocalDateTime': '2024-01-15T10:30:00',
            'LocalDate': '2024-01-15',
            'LocalTime': '14:30:00',
            'BigDecimal': '999.99'
        };

        return javaTypeMap[javaType] || 'Valor de ejemplo';
    }

    // ==================== GENERADORES DE TESTS ====================

    generateBasicTest(operationName) {
        return {
            listen: "test",
            script: {
                exec: [
                    `pm.test('${operationName} - Status code válido', function () {`,
                    "    pm.expect(pm.response.code).to.be.oneOf([200, 201, 204]);",
                    "});",
                    "",
                    "pm.test('Response time razonable', function () {",
                    "    pm.expect(pm.response.responseTime).to.be.below(3000);",
                    "});",
                    "",
                    "// Validar JWT si hay token en headers",
                    "if (pm.request.headers.get('Authorization')) {",
                    "    pm.test('JWT Token present', function () {",
                    "        const authHeader = pm.request.headers.get('Authorization');",
                    "        pm.expect(authHeader).to.include('Bearer');",
                    "    });",
                    "}",
                    "",
                    "if (pm.response.code === 200 || pm.response.code === 201) {",
                    "    pm.test('Content-Type es JSON', function () {",
                    "        pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json');",
                    "    });",
                    "",
                    "    pm.test('Response structure válida', function () {",
                    "        const jsonData = pm.response.json();",
                    "        pm.expect(jsonData).to.be.an('object');",
                    "        if (Array.isArray(jsonData)) {",
                    "            pm.expect(jsonData).to.be.an('array');",
                    "        } else {",
                    "            pm.expect(jsonData).to.have.property('id');",
                    "        }",
                    "    });",
                    "}"
                ]
            }
        };
    }

    generateCreateTest(entityName) {
        return {
            listen: "test",
            script: {
                exec: [
                    `pm.test('${entityName} creado exitosamente', function () {`,
                    "    pm.response.to.have.status(201);",
                    "});",
                    "",
                    "pm.test('Response contiene ID generado', function () {",
                    "    const jsonData = pm.response.json();",
                    "    pm.expect(jsonData).to.have.property('id');",
                    "    pm.expect(jsonData.id).to.be.a('number');",
                    "});",
                    "",
                    "pm.test('Response contiene timestamps', function () {",
                    "    const jsonData = pm.response.json();",
                    "    pm.expect(jsonData).to.have.property('created_at');",
                    "    pm.expect(jsonData).to.have.property('updated_at');",
                    "});",
                    "",
                    "// Guardar ID para otros tests",
                    "if (pm.response.code === 201) {",
                    "    const jsonData = pm.response.json();",
                    "    pm.collectionVariables.set('entityId', jsonData.id);",
                    "}"
                ]
            }
        };
    }

    generateDeleteTest(entityName) {
        return {
            listen: "test",
            script: {
                exec: [
                    `pm.test('${entityName} eliminado exitosamente', function () {`,
                    "    pm.response.to.have.status(204);",
                    "});",
                    "",
                    "pm.test('Response body está vacío', function () {",
                    "    pm.expect(pm.response.text()).to.be.empty;",
                    "});"
                ]
            }
        };
    }

    // ==================== CONFIGURACIÓN DE VARIABLES ====================

    generateEnvironmentVariables(hasAuth = false) {
        const variables = [
            {
                key: "baseUrl",
                value: this.baseUrl,
                description: "URL base del servidor Spring Boot"
            },
            {
                key: "entityId",
                value: "1",
                description: "ID de entidad para pruebas (se actualiza automáticamente)"
            }
        ];

        if (hasAuth) {
            variables.push({
                key: "jwtToken",
                value: "",
                description: "JWT Token de autenticación (se llena automáticamente al hacer login)"
            });
        }

        return variables;
    }

    // ==================== MÉTODOS AUXILIARES ====================

    /**
     * Mismo bug/fix que `SimpleJavaGenerator.parseAttribute()`: un atributo
     * sin tipo (el usuario dejó "Tipo" vacío en el panel) se guarda SIN el
     * ":" en absoluto (`DiagramElementFactory.serializeAttributeLine()`) —
     * el regex viejo exigía un ":" sí o sí, y sin él devolvía el string
     * CRUDO (con el símbolo de visibilidad y el espacio) como nombre de
     * campo. Acá eso no rompía la sintaxis (una clave de JSON de ejemplo
     * puede ser casi cualquier string), pero sí generaba ejemplos de body
     * con claves como `"- orden"` en vez de `"orden"` — no coincidía con el
     * nombre de campo real que el backend Java espera.
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
            name: this.sanitizeIdentifier(rawName, 'campo'),
            type: rawType || 'String'
        };
    }

    /** Ver `SimpleJavaGenerator.sanitizeJavaIdentifier()` — misma idea, mismo resultado para el mismo nombre. */
    sanitizeIdentifier(rawName, fallback) {
        let id = String(rawName || '').replace(/[^A-Za-z0-9_$]/g, '');
        if (!id) id = fallback;
        if (/^[0-9]/.test(id)) id = '_' + id;
        return id;
    }

    camelToKebabCase(str) {
        return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    }

    camelToSnakeCase(str) {
        return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    }

    sanitizeProjectName(name) {
        return name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    }

    getStatusText(code) {
        const statusTexts = {
            200: 'OK',
            201: 'Created',
            204: 'No Content',
            404: 'Not Found',
            500: 'Internal Server Error'
        };
        return statusTexts[code] || 'Unknown';
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    downloadCollection(collection) {
        const filename = `${this.projectName}-Postman.json`;
        const content = JSON.stringify(collection, null, 2);

        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(() => URL.revokeObjectURL(url), 100);

        console.log('📥 Colección Postman descargada:', filename);
    }

    // Método estático para uso rápido
    static quickGeneratePostman(editor) {
        const generator = new SimplePostmanGenerator(editor);
        generator.generatePostmanCollection();
    }
}
