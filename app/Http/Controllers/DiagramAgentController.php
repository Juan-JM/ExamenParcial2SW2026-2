<?php

namespace App\Http\Controllers;

use App\Models\ActivityEntry;
use App\Models\AiMessage;
use App\Models\Diagram;
use App\Models\DiagramVisit;
use App\Models\WorkSession;
use App\Services\Agent\ActivityLog;
use App\Services\Agent\CollaborativeAgent;
use App\Services\Vector\SemanticMemory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class DiagramAgentController extends Controller
{
    private const MESSAGES_ON_LOAD = 100;

    private const ACTIVITY_ON_LOAD = 50;

    public function __construct(
        private readonly CollaborativeAgent $agent,
        private readonly ActivityLog $activityLog,
    ) {
    }

    /** Todo lo necesario para retomar: conversación, actividad y qué pasó desde la última visita. */
    public function state(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeAccess($request, $diagram);

        $user = $request->user();
        $visit = DiagramVisit::where('diagram_id', $diagram->id)->where('user_id', $user->id)->first();
        $missed = $visit ? $this->activityLog->since($diagram, $visit->last_seen_at, $user->id) : collect();

        DiagramVisit::updateOrCreate(
            ['diagram_id' => $diagram->id, 'user_id' => $user->id],
            ['last_seen_at' => now()],
        );

        // Cada sesión tiene su propia conversación: al empezar una nueva, el chat arranca vacío.
        $session = WorkSession::open($diagram);
        $messages = $this->conversation($diagram, $session?->id);

        $sessions = WorkSession::where('diagram_id', $diagram->id)->orderBy('started_at', 'desc')->limit(30)->get();

        return response()->json([
            'agent' => [
                'name' => config('services.ai.agent.name'),
                'wakeWords' => config('services.ai.agent.wake_words'),
            ],
            'canEdit' => $diagram->canBeEditedBy($user),
            'currentSessionId' => $session?->id,
            'canCloseSession' => $session?->canBeClosedBy($user) ?? false,
            'messages' => $messages->map->toClientArray()->all(),
            'activity' => $this->activityLog->recent($diagram, self::ACTIVITY_ON_LOAD)->map->toClientArray()->all(),
            'missedDigest' => $missed->isEmpty() ? null : $this->activityLog->digest($missed),
            'sessions' => $sessions->map->toClientArray()->all(),
        ]);
    }

    /** Conversación de una sesión anterior, solo para consultar. */
    public function sessionMessages(Request $request, Diagram $diagram, WorkSession $session): JsonResponse
    {
        $this->authorizeAccess($request, $diagram);
        abort_unless($session->diagram_id === $diagram->id, 404);

        return response()->json([
            'session' => $session->toClientArray(),
            'messages' => $this->conversation($diagram, $session->id)->map->toClientArray()->all(),
        ]);
    }

    public function closeSession(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeAccess($request, $diagram);

        $session = WorkSession::open($diagram);
        abort_if(!$session, 409, 'No hay ninguna sesión abierta.');
        abort_unless($session->canBeClosedBy($request->user()), 403, 'Solo el dueño del diagrama o quien abrió la sesión puede cerrarla.');

        $session->close($request->user());

        return response()->json(['ok' => true]);
    }

    private function conversation(Diagram $diagram, ?string $sessionId)
    {
        return AiMessage::ofConversation($diagram->id, $sessionId)
            ->orderBy('created_at', 'desc')
            ->limit(self::MESSAGES_ON_LOAD)
            ->get(['role', 'author_id', 'author_name', 'text', 'source', 'to_agent', 'reply_to', 'executor_user_id', 'ops', 'ops_status', 'ops_summary', 'options', 'original_command', 'created_at'])
            ->reverse()
            ->values();
    }

    public function message(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeAccess($request, $diagram);

        $validated = $request->validate([
            'text' => ['required', 'string', 'max:2000'],
            'source' => ['sometimes', 'in:text,voice,wake,mobile,option'],
            'diagramSchema' => ['sometimes', 'nullable', 'array'],
            'originalCommand' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'toAgent' => ['sometimes', 'boolean'],
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

        $message = $this->agent->receive(
            $diagram,
            $request->user(),
            $validated['text'],
            $validated['source'] ?? 'text',
            $validated['diagramSchema'] ?? null,
            $validated['originalCommand'] ?? null,
            $validated['toAgent'] ?? true,
            $validated['context'] ?? null,
        );

        return response()->json(['message' => $message->toClientArray()], 202);
    }

    public function opsResult(Request $request, Diagram $diagram, AiMessage $message): JsonResponse
    {
        abort_unless($message->diagram_id === $diagram->id, 404);
        abort_unless($message->executor_user_id === $request->user()->id, 403);
        abort_unless($message->ops_status === 'pending', 409);

        $validated = $request->validate([
            'summary' => ['required', 'string', 'max:4000'],
            'applied' => ['sometimes', 'array', 'max:100'],
            'applied.*.action' => ['required', 'string', 'max:60'],
            'applied.*.summary' => ['required', 'string', 'max:500'],
            'applied.*.elementId' => ['nullable', 'string', 'max:100'],
            'applied.*.before' => ['nullable', 'array'],
            'applied.*.after' => ['nullable', 'array'],
        ]);

        $this->agent->reportOpsResult($message, $validated['summary'], $validated['applied'] ?? []);

        return response()->json(['ok' => true]);
    }

    public function activity(Request $request, Diagram $diagram): JsonResponse
    {
        abort_unless($diagram->canBeEditedBy($request->user()), 403);

        $validated = $request->validate([
            'entries' => ['required', 'array', 'max:100'],
            'entries.*.action' => ['required', 'string', 'max:60'],
            'entries.*.summary' => ['required', 'string', 'max:500'],
            'entries.*.elementId' => ['nullable', 'string', 'max:100'],
            'entries.*.origin' => ['nullable', 'in:manual,import'],
            'entries.*.before' => ['nullable', 'array'],
            'entries.*.after' => ['nullable', 'array'],
        ]);

        $this->activityLog->recordUser($diagram, $request->user(), $validated['entries']);

        return response()->json(['ok' => true]);
    }

    /** Historial completo, de a páginas. */
    public function history(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeAccess($request, $diagram);

        $validated = $request->validate([
            'before' => ['sometimes', 'date'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:200'],
        ]);

        $query = ActivityEntry::where('diagram_id', $diagram->id)->orderBy('created_at', 'desc');

        if (isset($validated['before'])) {
            $query->where('created_at', '<', Carbon::parse($validated['before']));
        }

        return response()->json([
            'entries' => $query->limit($validated['limit'] ?? 50)->get()->map->toClientArray()->all(),
        ]);
    }

    public function heartbeat(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeAccess($request, $diagram);

        $validated = $request->validate([
            'context' => ['sometimes', 'nullable', 'array'],
            'context.screen' => ['nullable', 'string', 'max:40'],
            'context.sidebarTab' => ['nullable', 'string', 'max:60'],
            'context.tool' => ['nullable', 'string', 'max:60'],
            'context.selection' => ['nullable', 'string', 'max:160'],
            'context.propertiesOpen' => ['nullable', 'boolean'],
            'context.modal' => ['nullable', 'string', 'max:120'],
            'context.role' => ['nullable', 'string', 'max:20'],
        ]);

        return response()->json(['session' => WorkSession::heartbeat($diagram, $request->user(), $validated['context'] ?? null)->toClientArray()]);
    }

    /** Búsqueda por significado en el historial del diagrama y la guía de uso. */
    public function search(Request $request, Diagram $diagram, SemanticMemory $memory): JsonResponse
    {
        $this->authorizeAccess($request, $diagram);

        $validated = $request->validate(['q' => ['required', 'string', 'max:300']]);

        return response()->json([
            'available' => $memory->isAvailable(),
            'results' => $memory->recall($validated['q'], $diagram->id, 10),
        ]);
    }

    public function leave(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeAccess($request, $diagram);

        WorkSession::open($diagram)?->leave($request->user());

        return response()->json(['ok' => true]);
    }

    private function authorizeAccess(Request $request, Diagram $diagram): void
    {
        abort_unless($diagram->canBeAccessedBy($request->user()), 403);
    }
}
