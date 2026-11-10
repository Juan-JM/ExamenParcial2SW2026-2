// resources/js/support/supportChatContent.js
// Contenido estático (sin backend, sin IA) del chat de "Soporte" — una guía
// básica de preguntas frecuentes por pantalla. Puramente informativo: cada
// pregunta tiene una respuesta en texto y, opcionalmente, una "guía visual"
// (oscurece la pantalla y señala un botón real). Si en el futuro esto crece
// mucho o se vuelve dinámico, ahí sí tendría sentido moverlo a datos del
// backend — hoy es una lista fija, no hace falta.
//
// Cada pregunta puede tener:
// - id: identificador único dentro del contexto.
// - question: texto del botón/pregunta.
// - answer: texto de la respuesta del "bot".
// - guide (opcional): { selectors: [..candidatos..], tooltip, beforeShow?, fallback? }
//   - selectors: se prueba cada uno en orden, se usa el primero que exista en el DOM.
//   - beforeShow (opcional): selector de un elemento al que se le hace click antes
//     de buscar el target (ej. abrir la pestaña del Asistente IA antes de señalar el mic).
//   - fallback (opcional): mensaje a mostrar si ningún selector se encuentra.
//   - next (opcional): pasos siguientes [{ tooltip, target }], señalados por su
//     texto visible; sirven aunque estén en otra pantalla (el recorrido sigue
//     después de navegar).

export const SUPPORT_CONTENT = {
    dashboard: [
        {
            id: 'crear-diagrama',
            question: '¿Cómo creo un nuevo diagrama?',
            answer: 'Haz clic en el botón "Nuevo Diagrama". Se crea al instante y te lleva directo al editor con un lienzo vacío.',
            guide: {
                selectors: ['#support-target-new-diagram-header', '#support-target-new-diagram-nav'],
                tooltip: 'Haz clic aquí para crear un nuevo diagrama',
            },
        },
        {
            id: 'ver-diagramas',
            question: '¿Dónde veo mis diagramas guardados?',
            answer: 'Aparecen como tarjetas en "Mis diagramas". Cada tarjeta tiene botones para Editar, Ver (solo lectura), Clonar o Eliminar ese diagrama.',
        },
        {
            id: 'compartidos',
            question: '¿Qué es la sección "Compartidos conmigo"?',
            answer: 'Ahí aparecen los diagramas de otras personas en los que eres colaborador — se llena sola cuando aceptas una invitación.',
            guide: {
                selectors: ['#compartidos'],
                tooltip: 'Esta es la sección de diagramas compartidos contigo',
            },
        },
        {
            id: 'notificaciones',
            question: '¿Para qué sirve la campana de notificaciones?',
            answer: 'Ahí llegan las invitaciones a colaborar en un diagrama. Puedes aceptarlas o rechazarlas directamente desde ese menú.',
            guide: {
                selectors: ['#notification-bell-btn'],
                tooltip: 'Haz clic aquí para ver tus notificaciones e invitaciones',
            },
        },
        {
            id: 'editar-eliminar',
            question: '¿Cómo edito o elimino un diagrama existente?',
            answer: 'En la tarjeta de cada diagrama vas a encontrar los botones Editar, Ver, Clonar y Eliminar. "Eliminar" te va a pedir confirmación antes de borrar.',
        },
    ],

    editor: [
        {
            id: 'renombrar',
            question: '¿Cómo le cambio el nombre al diagrama?',
            answer: 'Haz clic sobre el nombre del diagrama, arriba a la izquierda, escribe el nuevo y pulsa Enter.',
            guide: {
                selectors: ['#support-target-rename'],
                tooltip: 'Haz clic aquí sobre el nombre, escribe el nuevo y pulsa Enter.',
                fallback: 'Solo quien puede editar el diagrama puede cambiarle el nombre.',
            },
        },
        {
            id: 'nuevo-diagrama',
            question: '¿Cómo creo un diagrama nuevo?',
            answer: 'Los diagramas nuevos se crean desde "Mis Diagramas". Vuelve con el enlace de arriba a la izquierda y ahí toca "Nuevo Diagrama".',
            guide: {
                selectors: ['#support-target-dashboard'],
                tooltip: 'Primero vuelve a "Mis Diagramas" con este enlace: desde ahí se crean los diagramas.',
                next: [
                    { tooltip: 'Ahora toca "Nuevo Diagrama": se crea al instante y se abre en el editor.', target: 'Nuevo Diagrama' },
                ],
            },
        },
        {
            id: 'crear-clase',
            question: '¿Cómo creo una clase?',
            answer: 'Arrastra la tarjeta "Clase" del panel izquierdo hacia el lienzo, o haz clic en ella y después clic en el lienzo donde la quieres ubicar. Lo mismo aplica para "Interfaz".',
            guide: {
                selectors: ['.uml-shape-btn[data-tool="class"]'],
                tooltip: 'Arrastra esta tarjeta al lienzo, o haz clic aquí y luego clic en el lienzo',
            },
        },
        {
            id: 'crear-relacion',
            question: '¿Cómo agrego una relación entre dos clases?',
            answer: 'Elige un tipo de relación (Asociación, Herencia, Agregación, Composición, Realización o Dependencia) y después haz clic primero en la clase de origen y luego en la clase de destino.',
            guide: {
                selectors: ['.uml-tool-btn[data-tool="association"]'],
                tooltip: 'Elige aquí el tipo de relación, después haz clic en la clase de origen y luego en la de destino',
            },
        },
        {
            id: 'editar-clase',
            question: '¿Cómo edito atributos y métodos de una clase?',
            answer: 'Haz DOBLE clic sobre una clase ya creada (un clic simple solo la selecciona). Se abren los paneles de la derecha (nombre, estereotipo) y de abajo (pestañas Atributos / Métodos), con un botón "+ Agregar" debajo de cada tabla. No hay botón "Guardar" en el panel: los cambios se aplican solos mientras escribes.',
        },
        {
            id: 'compartir',
            question: '¿Cómo invito o agrego colaboradores?',
            answer: 'Si eres el dueño del diagrama, tienes el botón "Compartir" arriba. Desde ahí puedes invitar por email (a alguien con cuenta o sin ella todavía) y elegir si va a poder editar o solo ver.',
            guide: {
                selectors: ['#support-target-share'],
                tooltip: 'Haz clic aquí para compartir el diagrama e invitar colaboradores',
                fallback: 'El botón "Compartir" solo aparece si eres el dueño de este diagrama.',
            },
        },
        {
            id: 'asistente-ia',
            question: '¿Cómo hablo con el Asistente de IA?',
            answer: 'Toca "Nova" en la barra vertical de la derecha y escríbele en lenguaje natural lo que quieres (crear una clase, agregar un atributo, una relación, etc.). Los cambios se aplican directo sobre el diagrama, sin pedir confirmación.',
            guide: {
                selectors: ['#sidebar-tab-ai'],
                tooltip: 'Haz clic aquí para abrir el chat con Nova',
            },
        },
        {
            id: 'voz-ia',
            question: '¿Cómo uso el botón de voz del Asistente IA?',
            answer: 'En el chat con Nova (barra vertical de la derecha), haz clic en el ícono del micrófono, di tu pedido en voz alta y el texto se escribe solo en el cuadro, como si lo hubieras tipeado. Haz clic de nuevo para detener la grabación.',
            guide: {
                selectors: ['#ai-chat-voice-btn'],
                beforeShow: '#sidebar-tab-ai',
                tooltip: 'Haz clic en el micrófono para dictar tu pedido por voz',
            },
        },
        {
            id: 'guardar',
            question: '¿Cómo guardo mis cambios?',
            answer: 'No hace falta guardar a mano: el diagrama se autoguarda solo, poco después de cada cambio (y también cada 30 segundos). Si igual quieres forzarlo, usa el botón "Guardar" o el atajo Ctrl+S.',
            guide: {
                selectors: ['#support-target-save'],
                tooltip: 'Este botón guarda el diagrama al instante',
            },
        },
        {
            id: 'exportar',
            question: '¿Cómo exporto el diagrama o genero código?',
            answer: 'Usa el menú "Exportar" de arriba: puedes bajar una imagen (PNG/JPG), un archivo XMI, generar el script SQL, el backend en Java/Spring Boot o una colección de Postman.',
            guide: {
                selectors: ['#support-target-export'],
                tooltip: 'Haz clic aquí para exportar el diagrama o generar código',
            },
        },
        {
            id: 'mover-eliminar',
            question: '¿Cómo muevo o elimino una clase?',
            answer: 'Para moverla, arrástrala con el mouse. Para eliminarla, haz clic en ella para seleccionarla y presiona la tecla Supr (o usa el botón eliminar del panel derecho).',
        },
    ],
};
