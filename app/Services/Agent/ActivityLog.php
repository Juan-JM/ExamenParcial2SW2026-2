<?php

namespace App\Services\Agent;

use App\Events\ActivityRecorded;
use App\Models\ActivityEntry;
use App\Models\Diagram;
use App\Models\User;
use App\Models\WorkSession;
use App\Models\WorkSessionAttendee;
use App\Console\Commands\ActivityIndexText;
use App\Jobs\RememberSemantically;
use App\Services\Push\DiagramNotifier;
use App\Support\LiveBroadcast;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class ActivityLog
{
    /** Cambios hechos por una persona, a mano o mediante una importación. */
    public function recordUser(Diagram $diagram, User $user, array $items): array
    {
        return $this->store($diagram->id, array_map(fn (array $item) => [
            'actor_type' => ActivityEntry::ACTOR_USER,
            'actor_id' => $user->id,
            'actor_name' => $user->name,
            'origin' => ($item['origin'] ?? null) === ActivityEntry::ORIGIN_IMPORT
                ? ActivityEntry::ORIGIN_IMPORT
                : ActivityEntry::ORIGIN_MANUAL,
        ] + $this->itemFields($item), $items));
    }

    /** Cambios hechos por la IA a pedido de alguien. */
    public function recordAgent(Diagram $diagram, ?User $requester, array $items, array $trace = []): array
    {
        return $this->store($diagram->id, array_map(fn (array $item) => [
            'actor_type' => ActivityEntry::ACTOR_AI,
            'actor_id' => null,
            'actor_name' => config('services.ai.agent.name'),
            'origin' => ActivityEntry::ORIGIN_AGENT,
            'requested_by_id' => $requester?->id,
            'requested_by_name' => $requester?->name,
        ] + $trace + $this->itemFields($item), $items));
    }

    /** Hechos de la app: entradas, invitaciones, roles, renombres. */
    public function system(string $diagramId, ?User $user, string $action, string $summary): array
    {
        return $this->store($diagramId, [[
            'actor_type' => ActivityEntry::ACTOR_USER,
            'actor_id' => $user?->id,
            'actor_name' => $user?->name ?? 'Sistema',
            'origin' => ActivityEntry::ORIGIN_SYSTEM,
            'action' => $action,
            'summary' => $summary,
        ]]);
    }

    public function departure(WorkSession $session, WorkSessionAttendee $attendee, Carbon $at): void
    {
        $entry = ActivityEntry::create([
            'diagram_id' => $session->diagram_id,
            'work_session_id' => $session->id,
            'actor_type' => ActivityEntry::ACTOR_USER,
            'actor_id' => $attendee->user_id,
            'actor_name' => $attendee->name,
            'origin' => ActivityEntry::ORIGIN_SYSTEM,
            'action' => 'SESSION_LEAVE',
            'summary' => 'salió del diagrama',
        ]);

        $entry->created_at = $at;
        $entry->save();

        LiveBroadcast::send(new ActivityRecorded($session->diagram_id, [$entry->toClientArray()]));
    }

    private function itemFields(array $item): array
    {
        return [
            'action' => $item['action'],
            'element_id' => $item['elementId'] ?? null,
            'summary' => $item['summary'],
            'before' => $item['before'] ?? null,
            'after' => $item['after'] ?? null,
        ];
    }

    /** @param  list<array<string, mixed>>  $rows */
    private function store(string $diagramId, array $rows): array
    {
        if ($rows === []) {
            return [];
        }

        $diagram = Diagram::find($diagramId);
        $session = $diagram ? WorkSession::where('diagram_id', $diagramId)->where('is_open', true)->first() : null;

        $models = array_map(fn (array $row) => ActivityEntry::create($row + [
            'diagram_id' => $diagramId,
            'work_session_id' => $session?->id,
        ]), $rows);
        $entries = array_map(fn (ActivityEntry $entry) => $entry->toClientArray(), $models);

        RememberSemantically::later(array_map(fn (ActivityEntry $entry) => ActivityIndexText::forActivity($entry), $models));

        $session?->registerActivity(count($entries));

        LiveBroadcast::send(new ActivityRecorded($diagramId, $entries));

        app(DiagramNotifier::class)->activity($diagramId, $entries);

        return $entries;
    }

    /** @return Collection<int, ActivityEntry> Las más recientes, en orden cronológico. */
    public function recent(Diagram $diagram, int $limit): Collection
    {
        return ActivityEntry::where('diagram_id', $diagram->id)
            ->orderBy('created_at', 'desc')
            ->limit($limit)
            ->get()
            ->reverse()
            ->values();
    }

    /** @return Collection<int, ActivityEntry> */
    public function since(Diagram $diagram, Carbon $since, ?string $excludeActorId = null): Collection
    {
        $query = ActivityEntry::where('diagram_id', $diagram->id)
            ->where('created_at', '>', $since)
            ->where('origin', '!=', ActivityEntry::ORIGIN_SYSTEM);

        if ($excludeActorId !== null) {
            $query->where('actor_id', '!=', $excludeActorId);
        }

        return $query->orderBy('created_at')->get();
    }

    /**
     * Resumen determinista, sin gastar llamadas a la IA: agrupa por persona.
     *
     * @param  iterable<ActivityEntry>  $entries
     */
    public function digest(iterable $entries, int $maxPerActor = 6): string
    {
        $byActor = collect($entries)->groupBy('actor_name');

        return $byActor->map(function (Collection $items, string $actor) use ($maxPerActor) {
            $shown = $items->take(-$maxPerActor)->pluck('summary')->implode('; ');
            $extra = $items->count() - min($items->count(), $maxPerActor);

            return "{$actor}: {$shown}".($extra > 0 ? " (y {$extra} cambios más)" : '');
        })->implode("\n");
    }
}
