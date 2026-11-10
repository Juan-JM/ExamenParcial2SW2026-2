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

export const SUPPORT_CONTENT = {
    dashboard: [
        {
            id: 'crear-diagrama',
            question: '¿Cómo creo un nuevo diagrama?',
            answer: 'Hacé clic en el botón "Nuevo Diagrama". Se crea al instante y te lleva directo al editor con un lienzo vacío.',
            guide: {
                selectors: ['#support-target-new-diagram-header', '#support-target-new-diagram-nav'],
                tooltip: 'Hacé clic acá para crear un nuevo diagrama',
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
            answer: 'Ahí aparecen los diagramas de otras personas en los que sos colaborador — se llena sola cuando aceptás una invitación.',
            guide: {
                selectors: ['#compartidos'],
                tooltip: 'Esta es la sección de diagramas compartidos con vos',
            },
        },
        {
            id: 'notificaciones',
            question: '¿Para qué sirve la campana de notificaciones?',
            answer: 'Ahí llegan las invitaciones a colaborar en un diagrama. Podés aceptarlas o rechazarlas directamente desde ese menú.',
            guide: {
                selectors: ['#notification-bell-btn'],
                tooltip: 'Hacé clic acá para ver tus notificaciones e invitaciones',
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
            id: 'crear-clase',
            question: '¿Cómo creo una clase?',
            answer: 'Arrastrá la tarjeta "Clase" del panel izquierdo hacia el lienzo, o hacé clic en ella y después clic en el lienzo donde la querés ubicar. Lo mismo aplica para "Interfaz".',
            guide: {
                selectors: ['.uml-shape-btn[data-tool="class"]'],
                tooltip: 'Arrastrá esta tarjeta al lienzo, o hacé clic acá y luego clic en el lienzo',
            },
        },
        {
            id: 'crear-relacion',
            question: '¿Cómo agrego una relación entre dos clases?',
            answer: 'Elegí un tipo de relación (Asociación, Herencia, Agregación, Composición, Realización o Dependencia) y después hacé clic primero en la clase de origen y luego en la clase de destino.',
            guide: {
                selectors: ['.uml-tool-btn[data-tool="association"]'],
                tooltip: 'Elegí acá el tipo de relación, después hacé clic en la clase de origen y luego en la de destino',
            },
        },
        {
            id: 'editar-clase',
            question: '¿Cómo edito atributos y métodos de una clase?',
            answer: 'Hacé DOBLE clic sobre una clase ya creada (un clic simple solo la selecciona). Se abren los paneles de la derecha (nombre, estereotipo) y de abajo (pestañas Atributos / Métodos), con un botón "+ Agregar" debajo de cada tabla. No hay botón "Guardar" en el panel: los cambios se aplican solos mientras escribís.',
        },
        {
            id: 'compartir',
            question: '¿Cómo invito o agrego colaboradores?',
            answer: 'Si sos el dueño del diagrama, tenés el botón "Compartir" arriba. Desde ahí podés invitar por email (a alguien con cuenta o sin ella todavía) y elegir si va a poder editar o solo ver.',
            guide: {
                selectors: ['#support-target-share'],
                tooltip: 'Hacé clic acá para compartir el diagrama e invitar colaboradores',
                fallback: 'El botón "Compartir" solo aparece si sos el dueño de este diagrama.',
            },
        },
        {
            id: 'asistente-ia',
            question: '¿Cómo hablo con el Asistente de IA?',
            answer: 'Abrí la pestaña "Asistente IA" del panel izquierdo y escribile en lenguaje natural lo que querés (crear una clase, agregar un atributo, una relación, etc.). Los cambios se aplican directo sobre el diagrama, sin pedir confirmación.',
            guide: {
                selectors: ['#sidebar-tab-ai'],
                tooltip: 'Hacé clic acá para abrir el Asistente de IA',
            },
        },
        {
            id: 'voz-ia',
            question: '¿Cómo uso el botón de voz del Asistente IA?',
            answer: 'Adentro del chat de IA, hacé clic en el ícono del micrófono, decí tu pedido en voz alta y el texto se escribe solo en el cuadro, como si lo hubieras tipeado. Hacé clic de nuevo para detener la grabación.',
            guide: {
                selectors: ['#ai-chat-voice-btn'],
                beforeShow: '#sidebar-tab-ai',
                tooltip: 'Hacé clic en el micrófono para dictar tu pedido por voz',
            },
        },
        {
            id: 'guardar',
            question: '¿Cómo guardo mis cambios?',
            answer: 'No hace falta guardar a mano: el diagrama se autoguarda solo, poco después de cada cambio (y también cada 30 segundos). Si igual querés forzarlo, usá el botón "Guardar" o el atajo Ctrl+S.',
            guide: {
                selectors: ['#support-target-save'],
                tooltip: 'Este botón guarda el diagrama al instante',
            },
        },
        {
            id: 'exportar',
            question: '¿Cómo exporto el diagrama o genero código?',
            answer: 'Usá el menú "Exportar" de arriba: podés bajar una imagen (PNG/JPG), un archivo XMI, generar el script SQL, el backend en Java/Spring Boot o una colección de Postman.',
            guide: {
                selectors: ['#support-target-export'],
                tooltip: 'Hacé clic acá para exportar el diagrama o generar código',
            },
        },
        {
            id: 'mover-eliminar',
            question: '¿Cómo muevo o elimino una clase?',
            answer: 'Para moverla, arrastrala con el mouse. Para eliminarla, hacé clic en ella para seleccionarla y presioná la tecla Supr (o usá el botón eliminar del panel derecho).',
        },
    ],
};
