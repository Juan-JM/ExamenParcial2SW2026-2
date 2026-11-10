<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/** Una o más entradas nuevas del registro de actividad. */
class ActivityRecorded implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    /** @param  list<array<string, mixed>>  $entries */
    public function __construct(public string $diagramId, public array $entries)
    {
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("diagram-agent.{$this->diagramId}");
    }

    public function broadcastAs(): string
    {
        return 'ActivityRecorded';
    }

    public function broadcastWith(): array
    {
        return ['entries' => $this->entries];
    }
}
