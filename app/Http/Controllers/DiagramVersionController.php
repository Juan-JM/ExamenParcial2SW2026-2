<?php

namespace App\Http\Controllers;

use App\Events\DiagramRestored;
use App\Models\Diagram;
use App\Models\DiagramSnapshot;
use App\Models\WorkSession;
use App\Services\Agent\ActivityLog;
use App\Services\DiagramService;
use App\Support\LiveBroadcast;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Historial de versiones del diagrama: consultar y restaurar. */
class DiagramVersionController extends Controller
{
    public function index(Request $request, Diagram $diagram): JsonResponse
    {
        abort_unless($diagram->canBeAccessedBy($request->user()), 403);

        $timezone = config('services.ai.agent.timezone');

        $snapshots = DiagramSnapshot::where('diagram_id', $diagram->id)
            ->orderBy('created_at', 'desc')
            ->limit(100)
            ->get();

        return response()->json([
            'canRestore' => $diagram->canBeEditedBy($request->user()),
            'versions' => $snapshots->map(function (DiagramSnapshot $snapshot) use ($timezone) {
                $cells = collect($snapshot->data['cells'] ?? []);

                return [
                    'id' => $snapshot->id,
                    'version' => $snapshot->version,
                    'reason' => $snapshot->reason,
                    'authorName' => $snapshot->author_name,
                    'classesCount' => $cells->filter(fn ($cell) => isset($cell['umlData']))->count(),
                    'relationshipsCount' => $cells->filter(fn ($cell) => isset($cell['relationData']))->count(),
                    'classNames' => $cells->pluck('umlData.className')->filter()->values()->take(12)->all(),
                    'createdAt' => $snapshot->created_at?->toISOString(),
                    'label' => $snapshot->created_at?->setTimezone($timezone)->format('d/m/Y H:i:s'),
                ];
            })->all(),
        ]);
    }

    public function restore(Request $request, Diagram $diagram, DiagramSnapshot $snapshot, DiagramService $service, ActivityLog $log): JsonResponse
    {
        abort_unless($diagram->canBeEditedBy($request->user()), 403);
        abort_unless($snapshot->diagram_id === $diagram->id, 404);

        $user = $request->user();
        $sessionId = WorkSession::where('diagram_id', $diagram->id)->where('is_open', true)->value('id');

        // Lo de ahora también queda guardado: restaurar nunca pierde nada.
        DiagramSnapshot::capture($diagram->id, $sessionId, DiagramSnapshot::BEFORE_RESTORE, $user);

        $service->save($diagram, ['data' => $snapshot->data]);
        $diagram->refresh();

        $label = $snapshot->created_at?->setTimezone(config('services.ai.agent.timezone'))->format('d/m H:i');
        // No se crea otra versión: el estado restaurado ya ES una versión de la lista.
        $log->system($diagram->id, $user, 'RESTORE_VERSION', "restauró la versión del {$label}");

        LiveBroadcast::send(new DiagramRestored($diagram->id, $user->name, $diagram->version));

        return response()->json(['ok' => true, 'version' => $diagram->version, 'data' => $diagram->data]);
    }

    /** El diagrama tal como está guardado, para recargarlo tras una restauración. */
    public function current(Request $request, Diagram $diagram): JsonResponse
    {
        abort_unless($diagram->canBeAccessedBy($request->user()), 403);

        return response()->json(['version' => $diagram->version, 'data' => $diagram->data]);
    }
}
