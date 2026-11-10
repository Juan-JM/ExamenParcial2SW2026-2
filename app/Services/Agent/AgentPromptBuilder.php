<?php

namespace App\Services\Agent;

use App\Models\ActivityEntry;
use App\Models\AiMessage;
use App\Models\Diagram;
use App\Models\WorkSession;
use App\Services\Ai\DiagramAiPromptBuilder;
use App\Services\Vector\SemanticMemory;

/**
 * Le da a la IA el contexto del equipo: quién pregunta, qué se conversó y qué
 * hizo cada persona. El catálogo de acciones sobre el diagrama sigue en
 * DiagramAiPromptBuilder, para no tener dos definiciones de lo mismo.
 */
class AgentPromptBuilder
{
    private const HISTORY_MESSAGES = 12;

    private const HISTORY_MESSAGE_CHARS = 400;

    private const ACTIVITY_ENTRIES = 40;

    private const PAST_SESSIONS = 5;

    public function __construct(
        private readonly DiagramAiPromptBuilder $catalog,
        private readonly ActivityLog $activityLog,
        private readonly SemanticMemory $memory,
        private readonly NormalizationHints $normalizationHints,
    ) {
    }

    public function system(bool $requesterCanEdit): string
    {
        $name = config('services.ai.agent.name');
        $editRule = $requesterCanEdit
            ? 'Quien te habla ahora puede editar: si te pide cambios o te pide dibujar una idea, usá type "ops". Podés sumar un campo "text" con una explicación breve junto a "ops".'
            : 'Quien te habla ahora no puede editar desde donde está (es observador o escribe desde el celular): nunca devuelvas "ops". Si pide cambios, respondé con type "message" explicando que no es posible desde ahí.';

        $persona = <<<PROMPT
Sos {$name}, una IA que es un desarrollador más en un equipo que modela una base
de datos con un diagrama de clases UML. Sos moderador, asesor y consultor, y
también dibujás en la misma pizarra que los demás.

Reglas de tu rol:
- Sos una sola instancia con UNA sola conversación grupal. No existen chats
  privados: todo lo que decís lo leen y escuchan todos, y podés contar lo que
  hizo cualquier integrante.
- Solo actuás cuando te lo piden. Nunca cambies el diagrama por iniciativa
  propia. Si te piden revisar o dar ideas, respondé con type "message" y no
  ejecutes cambios, salvo que además te pidan aplicarlos.
- Cada mensaje indica quién lo escribió. Dirigite a esa persona por su nombre.
- Para decir qué hizo alguien o qué se avanzó, usá SOLO el REGISTRO DE ACTIVIDAD
  y las SESIONES ANTERIORES. Si no figura, decí que no hay registro: no inventes.
- También enseñás a usar la aplicación: si preguntan cómo hacer algo, guiá
  paso a paso según la PANTALLA de quien pregunta y la guía de uso que aparezca
  en MEMORIA RELEVANTE. Nombrá los botones y pestañas tal como se ven.
- En revisiones nombrá la clase o relación concreta y qué corregir. Usá las
  OBSERVACIONES AUTOMÁTICAS DE NORMALIZACIÓN como base: ya están verificadas.
- Si el pedido es claro, ejecutalo. Preguntá solo si falta un dato sin el cual
  no se puede hacer.

Referencia (no la contradigas):
- UML 2.5: visibilidad + público, - privado, # protegido, ~ paquete. Un
  atributo derivado se marca con "/" antes del nombre y se calcula a partir de
  otros. Lo estático va subrayado; lo abstracto, en cursiva.
- Composición (rombo lleno): la parte no existe sin el todo. Agregación (rombo
  vacío): la parte existe por su cuenta. Herencia: triángulo hacia el padre.
  Realización: línea punteada con triángulo hacia la interfaz.
- Multiplicidades: 1, 0..1, *, 1..*. Muchos a muchos con datos propios se
  modela con una clase asociativa.
- 1FN: sin grupos repetidos (telefono1, telefono2) ni valores múltiples en un
  atributo. 2FN: en 1FN y cada atributo depende de toda la clave (aplica a
  claves compuestas, como en clases asociativas). 3FN: en 2FN y sin
  dependencias transitivas (un atributo que en realidad describe a otra clase,
  como nombreCliente dentro de Pedido).
- Respondé en español, breve y claro, porque tu respuesta puede leerse en voz
  alta. {$editRule}

A continuación, el formato de salida y las operaciones disponibles.

PROMPT;

        return $persona.$this->catalog->buildSystemPrompt();
    }

    public function user(Diagram $diagram, AiMessage $message, array $schema): string
    {
        $schemaJson = json_encode($schema, JSON_UNESCAPED_UNICODE);

        return <<<PROMPT
SESIONES ANTERIORES:
{$this->pastSessions($diagram)}

SESIÓN ACTUAL:
{$this->currentSession($diagram)}

REGISTRO DE ACTIVIDAD (reciente, más nuevo al final):
{$this->activity($diagram)}

ESTADO ACTUAL DEL DIAGRAMA:
{$schemaJson}

OBSERVACIONES AUTOMÁTICAS DE NORMALIZACIÓN:
{$this->normalization($schema)}

CONVERSACIÓN DEL EQUIPO (más nuevo al final):
{$this->history($diagram, $message)}

MEMORIA RELEVANTE (búsqueda semántica en el historial y la guía de uso):
{$this->memory($diagram, $message)}

QUÉ ESTÁ HACIENDO CADA UNO AHORA EN LA APP:
{$this->presentContexts($diagram)}

PANTALLA DE {$message->author_name} AL ESCRIBIR:
{$this->describeContext($message->ui_context)}

MENSAJE ACTUAL de {$message->author_name}:
"{$message->text}"

Respondé solo con el JSON del envelope.
PROMPT;
    }

    private function normalization(array $schema): string
    {
        $issues = $this->normalizationHints->check($schema);

        return $issues === [] ? '(ninguna: cumple 1FN, 2FN y 3FN según las reglas automáticas)' : '- '.implode("\n- ", $issues);
    }

    private function memory(Diagram $diagram, AiMessage $message): string
    {
        $hits = $this->memory->recall($message->text ?? '', $diagram->id, 6);

        if ($hits === []) {
            return '(sin resultados o búsqueda semántica no disponible)';
        }

        return collect($hits)->map(fn (array $hit) => match ($hit['kind']) {
            SemanticMemory::KIND_HELP => "[guía] {$hit['text']}",
            SemanticMemory::KIND_CLASS => "[clase] {$hit['text']}",
            SemanticMemory::KIND_MESSAGE => "[chat] {$hit['text']}",
            default => "[actividad] {$hit['text']}",
        })->implode("\n");
    }

    private function presentContexts(Diagram $diagram): string
    {
        $session = WorkSession::where('diagram_id', $diagram->id)->where('is_open', true)->first();
        $attendees = $session?->attendees()->whereNull('gone_at')->get() ?? collect();

        $lines = $attendees
            ->filter(fn ($attendee) => !empty($attendee->context))
            ->map(fn ($attendee) => "{$attendee->name}: {$this->describeContext($attendee->context)}");

        return $lines->isEmpty() ? '(sin datos)' : $lines->implode("\n");
    }

    /** Traduce lo que reporta el editor a una frase que la IA puede usar para guiar. */
    public function describeContext(?array $context): string
    {
        if (!$context) {
            return '(desconocida)';
        }

        $parts = [];
        $parts[] = match ($context['screen'] ?? null) {
            'mobile' => 'está en la app móvil (solo lectura)',
            default => 'está en el editor del diagrama',
        };

        if (!empty($context['sidebarTab'])) {
            $parts[] = "con la pestaña \"{$context['sidebarTab']}\" abierta";
        }

        if (!empty($context['tool']) && $context['tool'] !== 'select') {
            $parts[] = "usando la herramienta \"{$context['tool']}\"";
        }

        if (!empty($context['selection'])) {
            $parts[] = "con \"{$context['selection']}\" seleccionado";
        }

        if (!empty($context['propertiesOpen'])) {
            $parts[] = 'con el panel de propiedades abierto';
        }

        if (!empty($context['modal'])) {
            $parts[] = "con la ventana \"{$context['modal']}\" abierta";
        }

        if (!empty($context['role'])) {
            $parts[] = "(rol: {$context['role']})";
        }

        return implode(', ', $parts);
    }

    private function currentSession(Diagram $diagram): string
    {
        $session = WorkSession::where('diagram_id', $diagram->id)->where('is_open', true)->first();

        if (!$session) {
            return '(nadie tiene el diagrama abierto)';
        }

        $present = $session->attendees()->whereNull('gone_at')->pluck('name')->implode(', ');
        $start = $session->started_at->setTimezone(config('services.ai.agent.timezone'))->format('d/m H:i');

        return "Empezó el {$start}. Presentes: {$present}.";
    }

    private function pastSessions(Diagram $diagram): string
    {
        $sessions = WorkSession::where('diagram_id', $diagram->id)
            ->where('is_open', false)
            ->orderBy('started_at', 'desc')
            ->limit(self::PAST_SESSIONS)
            ->get()
            ->reverse();

        if ($sessions->isEmpty()) {
            return '(ninguna)';
        }

        return $sessions->map(function (WorkSession $session) {
            $entries = ActivityEntry::where('work_session_id', $session->id)->orderBy('created_at')->get();

            $timezone = config('services.ai.agent.timezone');
            $range = $session->started_at->setTimezone($timezone)->format('d/m H:i').' a '.$session->ended_at?->setTimezone($timezone)->format('H:i');
            $changes = $entries->where('origin', '!=', ActivityEntry::ORIGIN_SYSTEM);

            return "{$range}:\n".($this->activityLog->digest($changes) ?: '(sin cambios registrados)');
        })->implode("\n");
    }

    private function activity(Diagram $diagram): string
    {
        $timezone = config('services.ai.agent.timezone');

        $lines = $this->activityLog->recent($diagram, self::ACTIVITY_ENTRIES)->map(function (ActivityEntry $entry) use ($timezone) {
            $time = $entry->created_at?->setTimezone($timezone)->format('d/m H:i');
            $requested = match ($entry->origin) {
                ActivityEntry::ORIGIN_AGENT => " (a pedido de {$entry->requested_by_name})",
                ActivityEntry::ORIGIN_IMPORT => ' (por importación)',
                ActivityEntry::ORIGIN_MANUAL => ' (a mano)',
                default => '',
            };

            return "{$time} {$entry->actor_name}{$requested}: {$entry->summary}";
        });

        return $lines->isEmpty() ? '(sin actividad registrada)' : $lines->implode("\n");
    }

    private function history(Diagram $diagram, AiMessage $current): string
    {
        // Solo la conversación de esta sesión: lo de sesiones anteriores llega resumido.
        $messages = AiMessage::ofConversation($diagram->id, $current->work_session_id)
            ->where('id', '!=', $current->id)
            ->where('role', '!=', AiMessage::ROLE_SYSTEM)
            ->orderBy('created_at', 'desc')
            ->limit(self::HISTORY_MESSAGES)
            ->get()
            ->reverse();

        if ($messages->isEmpty()) {
            return '(sin mensajes previos)';
        }

        return $messages->map(function (AiMessage $message) {
            $text = mb_strimwidth(trim(($message->text ?? '').' '.($message->ops_summary ?? '')), 0, self::HISTORY_MESSAGE_CHARS, '…');

            return "{$message->author_name}: {$text}";
        })->implode("\n");
    }
}
