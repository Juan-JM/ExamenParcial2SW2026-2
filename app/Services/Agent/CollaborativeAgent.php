<?php

namespace App\Services\Agent;

use App\Events\AgentMessagePosted;
use App\Jobs\ProcessAgentTurn;
use App\Models\AiMessage;
use App\Models\Diagram;
use App\Models\User;
use App\Models\WorkSession;
use App\Services\Live\LiveFloor;
use App\Services\Ai\AiOrchestrator;
use App\Services\Ai\DiagramAiOpsValidator;
use App\Services\Ai\Exceptions\AiAllModelsExhaustedException;
use App\Console\Commands\ActivityIndexText;
use App\Jobs\RememberSemantically;
use App\Services\Push\DiagramNotifier;
use App\Support\LiveBroadcast;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * La instancia única de IA de cada diagrama. Todos los mensajes del equipo van a
 * la misma conversación; la IA solo responde a los dirigidos a ella.
 */
class CollaborativeAgent
{
    public function __construct(
        private readonly AiOrchestrator $orchestrator,
        private readonly AgentPromptBuilder $prompts,
        private readonly DiagramAiOpsValidator $validator,
        private readonly DiagramSchemaExtractor $schemaExtractor,
        private readonly ActivityLog $activityLog,
        private readonly DiagramNotifier $notifier,
    ) {
    }

    public function receive(
        Diagram $diagram,
        User $user,
        string $text,
        string $source = 'text',
        ?array $schema = null,
        ?string $originalCommand = null,
        bool $toAgent = true,
        ?array $uiContext = null,
        bool $dispatch = true,
    ): AiMessage {
        $toAgent = $toAgent || $this->mentionsAgent($text);

        $message = AiMessage::create([
            'diagram_id' => $diagram->id,
            'work_session_id' => WorkSession::where('diagram_id', $diagram->id)->where('is_open', true)->value('id'),
            'role' => AiMessage::ROLE_USER,
            'author_id' => $user->id,
            'author_name' => $user->name,
            'text' => $text,
            'source' => $source,
            'to_agent' => $toAgent,
            'original_command' => $originalCommand,
            'ui_context' => $uiContext,
        ]);

        RememberSemantically::later([ActivityIndexText::forMessage($message)]);

        LiveBroadcast::send(new AgentMessagePosted($message));

        if ($toAgent && $dispatch) {
            ProcessAgentTurn::dispatch($message->id, $schema);
        }

        return $message;
    }

    /**
     * Charla del equipo captada por el micrófono que no es para la IA. Se guarda
     * un tiempo para darle contexto ("estábamos hablando de Pedido y Cliente"),
     * pero no la responde, no entra a la memoria semántica ni al chat clásico.
     */
    public function receiveAmbient(Diagram $diagram, User $user, string $text): AiMessage
    {
        AiMessage::where('diagram_id', $diagram->id)
            ->where('source', 'ambient')
            ->where('created_at', '<', now()->subMinutes((int) config('services.ai.live.ambient_ttl_minutes')))
            ->delete();

        $message = AiMessage::create([
            'diagram_id' => $diagram->id,
            'work_session_id' => WorkSession::where('diagram_id', $diagram->id)->where('is_open', true)->value('id'),
            'role' => AiMessage::ROLE_USER,
            'author_id' => $user->id,
            'author_name' => $user->name,
            'text' => $text,
            'source' => 'ambient',
            'to_agent' => false,
        ]);

        LiveBroadcast::send(new AgentMessagePosted($message));

        return $message;
    }

    /** Un mensaje para el equipo igual llega a la IA si la nombran. */
    public function mentionsAgent(string $text): bool
    {
        $words = array_map(
            fn (string $word) => preg_quote($this->normalize($word), '/'),
            [config('services.ai.agent.name'), ...config('services.ai.agent.wake_words')],
        );

        return preg_match('/(?<![\p{L}\p{N}])('.implode('|', $words).')(?![\p{L}\p{N}])/u', $this->normalize($text)) === 1;
    }

    private function normalize(string $text): string
    {
        return mb_strtolower(strtr($text, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'Á' => 'a', 'É' => 'e', 'Í' => 'i', 'Ó' => 'o', 'Ú' => 'u']));
    }

    public function respond(AiMessage $message, ?array $schema): ?AiMessage
    {
        // La persona siguió hablando y este pedido se fundió con el siguiente.
        if ($message->superseded) {
            return null;
        }

        $diagram = Diagram::findOrFail($message->diagram_id);
        $requester = User::find($message->author_id);
        // El móvil es informativo: desde ahí no se edita, ni siquiera siendo dueño.
        $canEdit = $message->source !== 'mobile' && $requester && $diagram->canBeEditedBy($requester);
        $schema ??= $this->schemaExtractor->fromDiagram($diagram);

        // Copia en memoria: el mensaje guardado conserva lo que la persona escribió.
        $turn = $message->replicate();
        $turn->id = $message->id;

        if ($message->original_command) {
            $turn->text = "{$message->original_command}\n(Eligió: {$message->text})";
        }

        $userPrompt = $this->prompts->user($diagram, $turn, $schema);
        $startedAt = microtime(true);

        try {
            $raw = $this->orchestrator->run(
                $this->prompts->system($canEdit, $message->source === 'live'),
                $userPrompt,
                (int) config('services.ai.agent.turn_budget_seconds'),
            );
            $envelope = $this->validator->validate($raw);

            if ($envelope['type'] === 'ops' && !$canEdit) {
                $envelope = ['type' => 'message', 'text' => $message->source === 'mobile'
                    ? 'Desde el celular solo puedo informarte. Para cambiar el diagrama, pedímelo desde el editor.'
                    : 'Tu rol de observador no permite cambios en el diagrama.'];
            }

            $reply = $this->storeReply($turn, $envelope, $raw, $userPrompt, $startedAt);
        } catch (AiAllModelsExhaustedException $e) {
            Log::warning('CollaborativeAgent: sin modelos disponibles', ['error' => $e->getMessage()]);
            $reply = $this->storeSystemReply($message, $e->retryAfterSeconds > 0
                ? "El modelo local no responde. Revisen que LM Studio u Ollama esté abierto con el modelo cargado y prueben en unos {$e->retryAfterSeconds} segundos."
                : 'El modelo local no está disponible: hay que abrir LM Studio u Ollama con el modelo cargado.', $e->getMessage());
        } catch (Throwable $e) {
            Log::error('CollaborativeAgent: error procesando el turno', ['message_id' => $message->id, 'error' => $e->getMessage()]);
            $reply = $this->storeSystemReply($message, 'No pude procesar ese mensaje. Prueba reformularlo.', $e->getMessage());
        }

        // Mientras pensaba, la persona pudo seguir hablando: esa respuesta ya no corresponde.
        if (AiMessage::find($message->id)?->superseded) {
            $reply->delete();

            return null;
        }

        LiveBroadcast::send(new AgentMessagePosted($reply));

        if ($message->source === 'live') {
            $live = app(LiveFloor::class);
            // Sin voz que esperar (error del modelo) el turno se libera ya.
            $reply->role === AiMessage::ROLE_ASSISTANT
                ? $live->markReady($message->diagram_id, $message->id, trim(($reply->text ?? '').' '.($reply->ops_summary ?? '')))
                : $live->release($message->diagram_id, $message->id);
        }

        if ($reply->role === AiMessage::ROLE_ASSISTANT) {
            RememberSemantically::later([ActivityIndexText::forMessage($reply)]);
        }

        if ($reply->role === AiMessage::ROLE_ASSISTANT && $reply->ops_status !== 'pending') {
            $this->notifier->agentReply($message->diagram_id, $reply->author_name, $reply->text ?? '');
        }

        return $reply;
    }

    /** Lo reporta el navegador que ejecutó las operaciones, con lo que realmente se aplicó. */
    public function reportOpsResult(AiMessage $reply, string $summary, array $applied): void
    {
        $reply->update(['ops_status' => 'done', 'ops_summary' => $summary]);
        // Los cambios de la IA no generan versión propia: quien los pidió puede
        // deshacerlos en un paso (Ctrl+Z) y quedan en la versión de fin de sesión.

        $request = AiMessage::find($reply->reply_to);

        $this->activityLog->recordAgent(
            Diagram::findOrFail($reply->diagram_id),
            User::find($reply->executor_user_id),
            $applied,
            [
                'request_message_id' => $reply->reply_to,
                'reply_message_id' => $reply->id,
                'source' => $request?->source,
            ],
        );

        LiveBroadcast::send(new AgentMessagePosted($reply));
    }

    private function storeReply(AiMessage $turn, array $envelope, array $raw, string $userPrompt, float $startedAt): AiMessage
    {
        $attributes = [
            'diagram_id' => $turn->diagram_id,
            'work_session_id' => $turn->work_session_id,
            'role' => AiMessage::ROLE_ASSISTANT,
            'author_name' => config('services.ai.agent.name'),
            'reply_to' => $turn->id,
            'provider' => $this->orchestrator->lastAccountId,
            'model' => $this->orchestrator->lastModel,
            'latency_ms' => (int) ((microtime(true) - $startedAt) * 1000),
            'prompt' => $userPrompt,
            'raw_response' => $raw,
        ];

        return AiMessage::create(match ($envelope['type']) {
            'ops' => $attributes + [
                'text' => is_string($raw['text'] ?? null) ? $raw['text'] : '',
                'ops' => $envelope['ops'],
                'ops_status' => 'pending',
                'executor_user_id' => $turn->author_id,
            ],
            'question' => $attributes + [
                'text' => $envelope['question'] ?? '',
                'options' => $envelope['options'] ?? [],
                'original_command' => $turn->text,
            ],
            default => $attributes + ['text' => $envelope['text'] ?? ''],
        });
    }

    private function storeSystemReply(AiMessage $message, string $text, string $error): AiMessage
    {
        return AiMessage::create([
            'diagram_id' => $message->diagram_id,
            'work_session_id' => $message->work_session_id,
            'role' => AiMessage::ROLE_SYSTEM,
            'author_name' => 'Sistema',
            'text' => $text,
            'reply_to' => $message->id,
            'error' => $error,
        ]);
    }
}
