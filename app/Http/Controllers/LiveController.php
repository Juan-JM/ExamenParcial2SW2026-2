<?php

namespace App\Http\Controllers;

use App\Events\AgentMessagePosted;
use App\Jobs\ProcessAgentTurn;
use App\Models\AiMessage;
use App\Models\Diagram;
use App\Models\WorkSession;
use App\Services\Agent\CollaborativeAgent;
use App\Services\Live\LiveFloor;
use App\Support\LiveBroadcast;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * "Nova en vivo": conversación por voz. Aquí solo llega TEXTO ya transcrito (el
 * audio lo procesa el servicio local de voz, que el navegador llama directo).
 * Ver documentacion/12-nova-en-vivo.md.
 */
class LiveController extends Controller
{
    private const MESSAGES_ON_LOAD = 60;

    public function __construct(
        private readonly CollaborativeAgent $agent,
        private readonly LiveFloor $floor,
    ) {
    }

    /** Lo necesario para abrir el modo conversación: charla reciente (con la de fondo), turno actual y ajustes. */
    public function state(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeAccess($request, $diagram);

        $session = WorkSession::open($diagram);
        $messages = AiMessage::ofConversation($diagram->id, $session?->id)
            ->orderBy('created_at', 'desc')
            ->limit(self::MESSAGES_ON_LOAD)
            ->get()
            ->reverse()
            ->values();

        return response()->json([
            'agent' => ['name' => config('services.ai.agent.name'), 'wakeWords' => config('services.ai.agent.wake_words')],
            'canEdit' => $diagram->canBeEditedBy($request->user()),
            'voiceServiceUrl' => config('services.ai.live.voice_service_url'),
            'conversationWindowSeconds' => (int) config('services.ai.live.conversation_window_seconds'),
            'floor' => $this->floor->snapshot($diagram->id),
            'messages' => $messages->map->toClientArray()->all(),
        ]);
    }

    /**
     * Una frase dicha por voz. Si va dirigida a Nova entra a la fila de turnos; si no,
     * se guarda como charla de fondo. `supersedes` funde esta frase con otra anterior
     * de la misma persona que Nova aún no terminó de contestar ("hola quería
     * preguntarte sobre…" + "…cómo estará el clima hoy").
     */
    public function utterance(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeAccess($request, $diagram);

        $validated = $request->validate([
            'text' => ['required', 'string', 'max:2000'],
            'addressed' => ['required', 'boolean'],
            'supersedes' => ['sometimes', 'nullable', 'string', 'max:64'],
            'diagramSchema' => ['sometimes', 'nullable', 'array'],
            'context' => ['sometimes', 'nullable', 'array'],
            'context.screen' => ['nullable', 'string', 'max:40'],
            'context.sidebarTab' => ['nullable', 'string', 'max:60'],
            'context.tool' => ['nullable', 'string', 'max:60'],
            'context.selection' => ['nullable', 'string', 'max:160'],
            'context.propertiesOpen' => ['nullable', 'boolean'],
            'context.modal' => ['nullable', 'string', 'max:120'],
            'context.role' => ['nullable', 'string', 'max:20'],
        ]);

        if (!config('services.ai.enabled', true)) {
            return response()->json(['message' => 'El asistente de IA está deshabilitado.'], 503);
        }

        $user = $request->user();
        $text = trim($validated['text']);

        if (!$validated['addressed'] && !$this->agent->mentionsAgent($text)) {
            $message = $this->agent->receiveAmbient($diagram, $user, $text);

            return response()->json(['message' => $message->toClientArray(), 'queue' => null, 'merged' => false], 202);
        }

        $merged = false;

        if (!empty($validated['supersedes'])) {
            $previousText = $this->supersede($diagram, $user->id, $validated['supersedes']);

            if ($previousText !== null) {
                $text = trim($previousText.' '.$text);
                $merged = true;
            }
        }

        $message = $this->agent->receive(
            $diagram,
            $user,
            $text,
            'live',
            $validated['diagramSchema'] ?? null,
            null,
            true,
            $validated['context'] ?? null,
            dispatch: false,
        );

        // Primero el turno, después el modelo: si no, la respuesta podría estar lista antes de que exista la fila.
        $queue = $this->floor->join($diagram->id, $message->id, (string) $user->id, $user->name);
        ProcessAgentTurn::dispatch($message->id, $validated['diagramSchema'] ?? null);

        return response()->json([
            'message' => $message->toClientArray(),
            'queue' => $queue['position'] > 0 ? $queue : null,
            'merged' => $merged,
        ], 202);
    }

    /** El navegador de quien hablaba terminó de decir la respuesta: le toca a quien sigue. */
    public function done(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeAccess($request, $diagram);

        $validated = $request->validate(['messageId' => ['required', 'string', 'max:64']]);

        $this->floor->release($diagram->id, $validated['messageId'], (string) $request->user()->id);

        return response()->json(['floor' => $this->floor->snapshot($diagram->id)]);
    }

    /**
     * Anula un pedido que Nova todavía no contestó del todo y devuelve su texto para
     * fundirlo con la frase nueva. No se funde si Nova ya cambió el diagrama con él:
     * eso no se puede deshacer desde aquí.
     */
    private function supersede(Diagram $diagram, mixed $userId, string $messageId): ?string
    {
        $old = AiMessage::find($messageId);

        if (!$old || $old->diagram_id !== $diagram->id || (string) $old->author_id !== (string) $userId || !$old->to_agent || $old->superseded) {
            return null;
        }

        $oldReply = AiMessage::where('reply_to', $old->id)->where('role', AiMessage::ROLE_ASSISTANT)->first();

        if ($oldReply && !empty($oldReply->ops)) {
            return null;
        }

        $old->update(['superseded' => true]);
        $oldReply?->update(['superseded' => true]);
        $this->floor->release($diagram->id, $old->id);

        LiveBroadcast::send(new AgentMessagePosted($old));

        if ($oldReply) {
            LiveBroadcast::send(new AgentMessagePosted($oldReply));
        }

        return $old->text;
    }

    private function authorizeAccess(Request $request, Diagram $diagram): void
    {
        abort_unless($diagram->canBeAccessedBy($request->user()), 403);
    }
}
