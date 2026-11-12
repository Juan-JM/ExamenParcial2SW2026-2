<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/** Cambió a quién está atendiendo Nova por voz o quién espera. Llega a todos. */
class LiveFloorChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    /** @param  array<string, mixed>  $floor */
    public function __construct(public string $diagramId, public array $floor)
    {
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("diagram-agent.{$this->diagramId}");
    }

    public function broadcastAs(): string
    {
        return 'LiveFloorChanged';
    }

    public function broadcastWith(): array
    {
        return ['floor' => $this->floor];
    }
}
