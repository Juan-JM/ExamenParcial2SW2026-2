# Manual de usuario del diagramador UML

Cada sección responde UNA tarea y se puede leer sola: el Tutor busca aquí la
sección que corresponde a la pregunta (por significado con Qdrant, o por
palabras si no está) y la usa para guiar. La línea "También:" lista otras
formas de pedir lo mismo; sirve para encontrar la sección rápido.

Al cambiar este archivo, correr `php artisan vector:index`.

## Pantallas de la aplicación
También: dónde estoy, qué pantallas hay, partes de la aplicación, mapa, menú principal.
La aplicación tiene dos pantallas. "Mis Diagramas" es el panel principal: la lista de tus diagramas y los "Compartidos conmigo", con el botón "Nuevo Diagrama", la búsqueda y la campana de notificaciones. El editor es donde se dibuja UN diagrama: barra superior arriba, paleta de herramientas a la izquierda, lienzo en el centro, panel de atributos y métodos abajo, panel de propiedades a la derecha y el riel con Nova, Actividad y Versiones en el borde derecho. Desde el editor se vuelve con el enlace "Mis Diagramas" de arriba a la izquierda.

## Partes del editor
También: zonas del editor, barra superior, paleta, lienzo, panel derecho, riel, qué es cada cosa.
Barra superior: a la izquierda "Mis Diagramas" (volver), el nombre del diagrama (clic para renombrar) y el estado de guardado; en el centro Deshacer, Rehacer y Limpiar (papelera); a la derecha quién está conectado, Compartir (solo el dueño), Importar, Exportar y Guardar. Paleta de la izquierda ("Herramientas UML"): Seleccionar, los elementos Clase e Interfaz y las relaciones. Lienzo: el área cuadriculada del centro donde está el diagrama. Panel inferior: pestañas Atributos y Métodos de la clase abierta. Panel derecho: nombre, estereotipo y opciones de la clase abierta. Riel (borde derecho): botones Nova, Actividad y Versiones.

## Crear un diagrama nuevo
También: nuevo diagrama, empezar un diagrama, hacer otro diagrama, diagrama en blanco, crear proyecto.
Los diagramas nuevos se crean desde "Mis Diagramas", no desde el lienzo. Si estás en el editor, vuelve con el enlace "Mis Diagramas" de arriba a la izquierda y ahí toca "Nuevo Diagrama" (arriba a la derecha o en el menú superior): se crea al instante y se abre en el editor con el lienzo vacío. Importar no crea un diagrama nuevo: carga el contenido dentro del diagrama que tienes abierto.

## Abrir un diagrama
También: entrar a un diagrama, editar un diagrama, seguir trabajando, abrir proyecto.
En "Mis Diagramas" busca la tarjeta del diagrama y toca "Editar": se abre en el editor. "Ver" lo abre solo para mirar, sin poder cambiar nada. Los diagramas de otras personas están más abajo, en "Compartidos conmigo".

## Buscar o filtrar diagramas
También: encontrar un diagrama, ubicar un diagrama, localizar, no encuentro mi diagrama, filtrar, plantillas, templates.
En "Mis Diagramas" escribe en "Buscar por título o descripción..." y toca "Filtrar". El selector de visibilidad (Todas, Privados, Compartidos, Públicos) y la casilla "Solo templates" acotan la lista; "Limpiar" quita los filtros. También puedes bajar por la lista y ubicar la tarjeta por su nombre.

## Renombrar un diagrama
También: cambiar el nombre del diagrama, cambiar título, poner nombre.
En el editor, haz clic sobre el nombre del diagrama en la barra superior (junto a "Mis Diagramas"), escribe el nombre nuevo y pulsa Enter. Esc cancela. Solo quien puede editar el diagrama puede renombrarlo.

## Clonar un diagrama
También: duplicar diagrama, copiar diagrama, hacer una copia.
En "Mis Diagramas", toca "Clonar" en la tarjeta del diagrama: se crea una copia completa con la que puedes trabajar sin tocar el original.

## Eliminar un diagrama
También: borrar diagrama, quitar diagrama, borrar proyecto.
En "Mis Diagramas", toca "Eliminar" en la tarjeta del diagrama y confirma. No se puede deshacer. Solo el dueño puede eliminarlo.

## Diagramas compartidos conmigo
También: compartidos, diagramas de otros, donde colaboro, invitados.
En "Mis Diagramas", más abajo, la sección "Compartidos conmigo" muestra los diagramas de otras personas en los que eres colaborador. Aparecen ahí cuando aceptas una invitación. Si solo puedes ver, la tarjeta no tiene "Editar".

## Notificaciones e invitaciones
También: campana, aceptar invitación, rechazar invitación, me invitaron, avisos.
La campana de la barra superior de "Mis Diagramas" muestra un punto rojo cuando llega algo. Ahí aparecen las invitaciones a colaborar: tócalas para aceptarlas o rechazarlas. Al aceptar, el diagrama aparece en "Compartidos conmigo".

## Cerrar sesión de la cuenta
También: salir, logout, cerrar cuenta, perfil.
En "Mis Diagramas", toca tu inicial (el círculo arriba a la derecha) y elige "Cerrar sesión".

## Crear una clase o una interfaz
También: agregar clase, nueva clase, crear entidad, crear tabla, poner una clase, nueva interfaz.
En la paleta de la izquierda, en Elementos, arrastra "Clase" (o "Interfaz") hasta el lienzo y suéltala donde la quieras. Otra forma: toca "Clase" y después haz clic en el lienzo, en el lugar donde va. Aparece con un nombre de ejemplo; para cambiarlo, haz doble clic sobre ella.

## Seleccionar o editar una clase
También: abrir propiedades, modificar clase, cambiar nombre de la clase, doble clic.
Un clic sobre la clase en el lienzo la selecciona (queda resaltada). Un doble clic la abre para editar: a la derecha aparece el panel con nombre, estereotipo y opciones, y abajo las pestañas Atributos y Métodos. No hay botón de guardar en esos paneles: los cambios se aplican mientras escribes.

## Cambiar el nombre de una clase
También: renombrar clase, nombre de la entidad.
Haz doble clic sobre la clase en el lienzo y escribe el nuevo nombre en el campo "Nombre" del panel derecho. Se aplica solo.

## Agregar atributos
También: nuevo atributo, campos, propiedades de la clase, columnas, agregar dato.
Haz doble clic sobre la clase. En el panel de abajo, pestaña "Atributos", toca "+ Agregar" debajo de la tabla y completa la fila: visibilidad (+ público, - privado, # protegido, ~ paquete), nombre y tipo (elige uno de la lista o "Personalizado…"). En la misma fila puedes poner una restricción como unique y marcar estático o derivado (derivado se muestra con /).

## Agregar métodos
También: nuevo método, operaciones, funciones de la clase.
Haz doble clic sobre la clase, ve a la pestaña "Métodos" del panel de abajo y toca "+ Agregar". Completa visibilidad, nombre y tipo de retorno. Puedes marcarlo como estático o abstracto.

## Quitar un atributo o un método
También: borrar atributo, eliminar método, sacar campo.
Haz doble clic sobre la clase, ve a la pestaña Atributos o Métodos del panel de abajo y usa el botón de quitar al final de la fila.

## Estereotipo, clase abstracta y opciones de la clase
También: entity, service, abstracta, cursiva, ocultar tipos, responsabilidades.
Con doble clic sobre la clase, el panel derecho tiene: "Estereotipo" (por ejemplo entity o service, cambia el color), "Clase abstracta" (el nombre va en cursiva), "Tipo de datos visible" (muestra u oculta los tipos) y "Responsabilidades".

## Eliminar una clase
También: borrar clase, quitar clase, sacar una clase del diagrama, borrar entidad, eliminar interfaz.
Haz clic sobre la clase en el lienzo para seleccionarla y pulsa la tecla Supr (Delete). Otra forma: doble clic sobre la clase y, en el panel derecho, el botón de la papelera "Eliminar". Sus relaciones se borran con ella. Si te equivocas, Ctrl+Z la recupera.

## Mover una clase
También: arrastrar clase, ordenar diagrama, reubicar.
Con la herramienta "Seleccionar" (arriba de la paleta) arrastra la clase por el lienzo. Si otra persona la está editando no se puede mover hasta que la suelte.

## Moverse por el lienzo y hacer zoom
También: acercar, alejar, zoom, desplazar, ver todo, centrar, ajustar vista.
Arrastra el fondo vacío del lienzo para desplazarte. La rueda del ratón acerca y aleja. Ctrl + y Ctrl - también; Ctrl+0 vuelve al 100 %, Ctrl+9 ajusta para ver todo el diagrama e Inicio lo centra. Abajo del lienzo están los botones Acercar, Alejar y "Ajustar al contenido".

## Relacionar dos clases
También: crear relación, unir clases, conectar clases, línea entre clases, flecha.
En la paleta, en Relaciones, elige el tipo. Luego haz clic en la clase de origen y después en la de destino, en el lienzo. Para tener las dos clases a la vista, ajusta el zoom antes.

## Tipos de relación
También: diferencia entre agregación y composición, qué es herencia, qué es dependencia, qué relación uso.
Asociación: dos clases se conocen (un Cliente hace Pedidos). Herencia: una clase es un tipo de otra (Alumno es una Persona); origen la hija, destino la padre. Agregación (rombo vacío): un todo con partes que existen solas (Equipo y Jugador). Composición (rombo lleno): las partes no existen sin el todo (Pedido y sus Líneas). Realización: una clase implementa una interfaz; origen la clase, destino la interfaz. Dependencia (línea punteada): una clase usa a otra de forma temporal.

## Editar una relación
También: multiplicidad, cardinalidad, uno a muchos, nombre de la relación, 1..*, 0..1.
Haz doble clic sobre la línea de la relación en el lienzo. En la ventana que se abre cambias la multiplicidad de cada extremo (1, *, 0..1, 1..*) y el nombre de la relación.

## Eliminar una relación
También: borrar relación, quitar línea, borrar flecha.
Haz doble clic sobre la línea de la relación y toca "Eliminar" en la ventana. También puedes hacer clic sobre la línea y pulsar Supr.

## Clase asociativa
También: muchos a muchos con datos, tabla intermedia, relación con atributos.
Para una relación muchos a muchos con datos propios (por ejemplo, la cantidad de un producto en un pedido): crea la asociación con multiplicidad * en ambos extremos, crea la clase con esos datos y elige "Clase asociativa" en la paleta: primero clic en la clase y después en la línea de la asociación.

## Guardar
También: guardar cambios, se guarda solo, autoguardado, Ctrl+S.
El diagrama se guarda solo a los pocos segundos de cada cambio; el estado se ve junto al nombre ("Guardado"). El botón "Guardar" (o Ctrl+S) además deja una versión guardada a la que puedes volver.

## Deshacer y rehacer
También: deshago, volver atrás, me equivoqué, recupero lo que borré, Ctrl+Z, Ctrl+Y.
Usa Deshacer y Rehacer en el centro de la barra superior, o Ctrl+Z y Ctrl+Y. Solo deshace lo que hiciste tú, no lo que hicieron otras personas.

## Limpiar el diagrama
También: borrar todo, vaciar lienzo, empezar de cero.
El botón de la papelera "Limpiar", en el centro de la barra superior, borra todo el diagrama después de confirmar. Se puede volver atrás desde Versiones.

## Compartir el diagrama e invitar colaboradores
También: invito, invitar a alguien, invitar a un compañero, agregar colaborador, trabajar con otros, dar acceso, compartir por correo.
Solo el dueño ve el botón "Compartir" en la barra superior del editor. Escribe el correo de la persona, marca "Puede editar" si quieres que pueda cambiar el diagrama (si no, solo puede verlo) y toca "Enviar invitación". Puede invitarse a alguien sin cuenta: la invitación le aparece al registrarse.

## Cambiar permisos o quitar a un colaborador
También: hacer editor, solo lectura, sacar a alguien, quitar acceso, rol.
En "Compartir", en la lista de colaboradores, marca o desmarca "Puede editar" para cambiar su permiso, o usa "Quitar colaborador". Si estaba con el diagrama abierto, pierde el acceso al instante.

## Trabajar en equipo en vivo
También: varios a la vez, quién está conectado, colaboración en tiempo real, borde rojo, bloqueado.
Todos ven los cambios de los demás al instante. Arriba a la derecha se ve quién está conectado. Cuando alguien selecciona una clase, para los demás queda con borde rojo y no se puede editar hasta que la suelte; si lo intentas, un aviso dice quién la está usando.

## No puedo editar el diagrama
También: no me deja editar, solo lectura, está bloqueado, no puedo mover.
Si en la barra dice "Solo lectura", tu permiso es de observador: pídele al dueño que te marque "Puede editar". Si una clase tiene borde rojo, otra persona la está editando: espera a que la suelte.

## Hablar con Nova
También: que la IA dibuje, que la IA cree las clases, que la IA haga el diagrama, generar con IA, automático, asistente del equipo, chat del equipo, inteligencia artificial que edita.
Nova es la IA del equipo que sí cambia el diagrama. Ábrela con el botón "Nova" del riel derecho, escribe tu pedido (por ejemplo "crea la clase Cliente con nombre y correo") y deja activado "Pedírselo a Nova". Si lo desactivas, el mensaje va solo al chat del equipo. Los botones Revisar, Normalización y Resumen le hacen esos pedidos de una vez.

## Hablar con Nova por voz
También: dictar, micrófono de Nova, manos libres, comando de voz.
En el panel de Nova, el micrófono dicta tu pedido. Con "Manos libres" activado basta con decir "Nova" y el pedido. El parlante del encabezado elige la voz y la velocidad, y qué respuestas se leen en voz alta. Funciona en Chrome o Edge.

## Sesiones de trabajo y chat del equipo
También: sesión, chat anterior, cerrar sesión de trabajo, historial del chat.
Al abrir el diagrama empieza una sesión de trabajo; termina cuando todos salen o cuando el dueño toca "Cerrar sesión" en el panel de Nova. Cada sesión tiene su propio chat; las anteriores se leen en el selector "Sesión".

## Ver qué hizo cada uno
También: actividad, historial de cambios, quién cambió qué, auditoría, registro.
El botón "Actividad" del riel derecho muestra todo lo que hizo cada persona y la IA, con hora y si fue a mano, por pedido a Nova o por importación. Tiene una búsqueda por significado.

## Versiones del diagrama
También: recupero, recuperar, se borró, perdí cambios, volver a una versión anterior, restaurar, historial de versiones.
El botón "Versiones" del riel derecho lista las copias guardadas (al tocar Guardar y al terminar cada sesión). Toca "Restaurar esta versión" en la que quieras; antes se guarda la actual, así que no se pierde nada.

## Exportar como imagen
También: descargar imagen, PNG, JPG, foto del diagrama.
En el menú "Exportar" de la barra superior elige "Exportar PNG" o "Exportar JPG".

## Generar el backend en Spring Boot
También: generar Java, código, backend, API, proyecto Maven.
En el menú "Exportar" elige "Generar Java" (Spring Boot). Se descarga un proyecto Maven con entidades JPA, repositorios, servicios, controladores y DTO. La base de datos la crea Hibernate al arrancar; la herencia se mapea con una tabla por clase.

## Generar el script SQL
También: base de datos, PostgreSQL, tablas, script.
En el menú "Exportar" elige "Generar SQL": descarga el script para PostgreSQL. Antes avisa si encuentra problemas de normalización en el diagrama.

## Generar la colección de Postman
También: probar la API, Postman, colección.
En el menú "Exportar" elige "Generar Postman": descarga la colección para probar la API que genera Spring Boot.

## Exportar e importar XMI
También: Enterprise Architect, XML, intercambiar con otra herramienta.
En "Exportar", "Exportar XMI" genera un archivo compatible con Enterprise Architect. En "Importar", "Importar XML/XMI" (Desde archivo) carga un archivo de Enterprise Architect con clases, relaciones y posiciones dentro del diagrama abierto.

## Importar desde una imagen
También: foto de un diagrama, captura, escanear diagrama, analizar imagen.
En "Importar" elige "Analizar imagen" (Desde imagen, IA) y sube una foto o captura de un diagrama de clases: la IA lo reconstruye en el lienzo. Necesita LM Studio u Ollama abierto.

## Revisar la normalización
También: formas normales, 1FN, 2FN, 3FN, revisar diseño de base de datos.
En el panel de Nova toca "Normalización": la IA revisa primera, segunda y tercera forma normal y explica qué cambiar. Al generar SQL también se avisa si hay atributos repetidos, valores múltiples o datos que pertenecen a otra clase.

## Ver un diagrama sin editar
También: modo ver, solo mirar, vista de lectura.
En "Mis Diagramas", el botón "Ver" de la tarjeta abre el diagrama solo para mirar: puedes desplazarte y hacer zoom, pero no cambiar nada. Si hay una sesión en curso, se ven los cambios en vivo.

## Aplicación móvil
También: celular, teléfono, app, Android.
La app móvil sirve para seguir el avance desde el celular: muestra el diagrama en vivo, la actividad, avisos y permite preguntarle a Nova. No edita el diagrama.

## El Tutor
También: asistente de ayuda, quién eres, cómo me ayudas, botón de abajo a la derecha.
El Tutor es el botón con el robot de abajo a la derecha. Enseña a usar la aplicación: le preguntas por voz o por escrito y te muestra en pantalla qué tocar, paso a paso. No cambia nada del diagrama; para que la IA dibuje, se usa Nova. El botón de reiniciar de su panel empieza una conversación nueva.

## Atajos de teclado
También: teclas rápidas, shortcuts, combinaciones.
Ctrl+S guarda. Ctrl+Z deshace y Ctrl+Y rehace. Supr borra lo seleccionado. Esc cancela la herramienta y vuelve a Seleccionar. Ctrl + y Ctrl - acercan y alejan, Ctrl+0 vuelve al 100 %, Ctrl+9 ajusta para ver todo e Inicio centra el diagrama.

## Nova no responde
También: la IA no contesta, asistente no funciona, error de IA, se queda pensando.
Nova y el Tutor usan un modelo que corre en la computadora: LM Studio u Ollama deben estar abiertos con el modelo cargado, y la cola de trabajos corriendo (composer run dev).

## La voz no funciona
También: no me escucha, micrófono no funciona, no habla, sin sonido.
Hablarle a las IAs necesita Chrome o Edge, permiso de micrófono (el candado de la barra de direcciones) y conexión a internet, porque el navegador envía el audio a su servicio de reconocimiento. Si no suena la respuesta, revisa que la voz no esté silenciada en el parlante del panel.
