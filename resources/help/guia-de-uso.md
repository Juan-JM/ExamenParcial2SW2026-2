# Guía de uso del diagramador

Cada sección es una respuesta que el asistente puede usar para enseñar a usar la
aplicación. Se indexa en la base vectorial con `php artisan vector:index-help`.

## Crear una clase o una interfaz
En la pestaña "Herramientas UML" elige "Clase" o "Interfaz" y haz clic en la pizarra. Para editarla, haz doble clic sobre ella: se abre el panel de propiedades a la derecha y abajo, donde cambias el nombre, el estereotipo, si es abstracta, y sus atributos y métodos.

## Agregar atributos y métodos
Con doble clic sobre la clase se abre el panel de propiedades. En la tabla de atributos escribe nombre, tipo y visibilidad (+ público, - privado, # protegido, ~ paquete). Puedes marcar un atributo como estático o derivado (se muestra con /). Los métodos se agregan igual en su propia tabla.

## Relacionar dos clases
En "Herramientas UML", sección Relaciones, elige asociación, agregación, composición, herencia, realización o dependencia. Haz clic en la clase de origen y luego en la de destino. En herencia, el origen es la clase hija y el destino la clase padre (por ejemplo, primero Cliente y después Persona); en realización, primero la clase y después la interfaz. Con doble clic sobre la línea puedes cambiar multiplicidades (1, *, 0..1, 1..*) y el nombre de la relación.

## Clase asociativa
Para una relación muchos a muchos con datos propios (por ejemplo, cantidad en un pedido), crea la asociación con multiplicidad * en ambos extremos, crea la clase con esos datos y usa la herramienta "Clase asociativa": primero clic en la clase y después en la línea de la asociación.

## Mover y ordenar el diagrama
Con la herramienta "Seleccionar" arrastra las clases. Usa la rueda del ratón para acercar o alejar, y "Ajustar vista" (Ctrl+9) para ver todo el diagrama.

## Trabajar en equipo
Usa el botón "Compartir" para invitar por correo como editor u observador. Cuando alguien selecciona una clase, queda bloqueada con borde rojo para los demás hasta que la suelte. Todos ven los cambios en vivo.

## Hablar con el asistente
En la pestaña "Asistente IA" escribe un pedido y deja marcada la casilla "Pedírselo a Nova". Si la desmarcas, el mensaje va solo al equipo. También puedes dictar con el micrófono o activar "Manos libres" y decir "Nova" seguido del pedido. El asistente solo actúa cuando se lo piden.

## Sesiones de trabajo y chat
Al abrir el diagrama empieza una sesión de trabajo; termina cuando todos salen (unos 30 segundos después) o cuando el dueño la cierra con "Cerrar sesión". Cada sesión tiene su propio chat. Las anteriores se consultan en el selector "Sesión".

## Ver qué hizo cada uno
En la pestaña "Actividad" del asistente está el registro de todo lo que hizo cada persona y la IA, indicando si fue a mano, a pedido de alguien o por importación. También puedes preguntarle al asistente "¿qué hizo Ana hoy?".

## Versiones del diagrama
En la pestaña "Versiones" del asistente están las copias guardadas del diagrama. Puedes restaurar una versión anterior: antes de restaurar se guarda la versión actual, así que no se pierde nada.

## Revisar la normalización
El botón "Normalización" le pide al asistente revisar primera, segunda y tercera forma normal. Además, al generar SQL la aplicación avisa si hay atributos repetidos, valores múltiples, datos que pertenecen a otra clase o atributos derivados.

## Generar el backend en Spring Boot
En el menú Exportar elige "Spring Boot". Se descarga un proyecto Maven con entidades JPA, repositorios, servicios, controladores y DTO. La base de datos la crea Hibernate al arrancar (ddl-auto=update), sin escribir SQL a mano. La herencia se mapea con una tabla por clase (JOINED).

## Generar SQL y Postman
En el menú Exportar, "SQL" descarga el script PostgreSQL y "Postman" la colección para probar la API generada.

## Importar y exportar XMI
En Exportar, "XMI" genera un archivo compatible con Enterprise Architect. En Importar, "XMI" carga un archivo de Enterprise Architect con sus clases, relaciones y posiciones.

## Importar desde una imagen
En Importar, "Analizar imagen" recibe una foto o captura de un diagrama de clases y lo reconstruye. Usa el modelo local con visión, así que LM Studio u Ollama deben estar abiertos.

## Guardar
El diagrama se guarda solo a los pocos segundos de cada cambio. También puedes forzar el guardado con Ctrl+S.

## Aplicación móvil
La app móvil sirve para seguir el avance desde el celular: muestra el diagrama en vivo, la actividad y permite preguntarle al asistente. No edita el diagrama.
