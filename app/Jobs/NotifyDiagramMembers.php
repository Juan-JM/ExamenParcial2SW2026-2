<?php

namespace App\Jobs;

use App\Models\Collaborator;
use App\Models\Diagram;
use App\Models\DiagramSession;
use App\Services\Push\AppInbox;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

/** Avisa a los integrantes del diagrama (bandeja + push), salvo a quien causó el cambio. */
class NotifyDiagramMembers implements ShouldQueue
{
    use Dispatchable, Queueable;

    public function __construct(
        public string $diagramId,
        public ?string $actorId,
        public string $body,
        public string $type = 'activity',
    ) {
    }

    public function handle(AppInbox $inbox): void
    {
        $diagram = Diagram::find($this->diagramId);

        if (!$diagram) {
            return;
        }

        $sessionIds = DiagramSession::where('diagram_id', $diagram->id)->pluck('id')->map(fn ($id) => (string) $id)->all();

        $memberIds = Collaborator::whereIn('diagram_session_id', $sessionIds)
            ->whereNotNull('user_id')
            ->pluck('user_id')
            ->push($diagram->user_id)
            ->map(fn ($id) => (string) $id)
            ->unique()
            ->reject(fn ($id) => $id === $this->actorId)
            ->values()
            ->all();

        $inbox->deliver($memberIds, $this->type, $diagram->title, $this->body, (string) $diagram->id, $diagram->title);
    }
}
