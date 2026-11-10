<?php

namespace App\Events;

use App\Models\Diagram;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/** Aviso liviano de que hay una versión nueva: la app móvil la pide cuando le llega. */
class DiagramContentChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public Diagram $diagram)
    {
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("diagram-agent.{$this->diagram->id}");
    }

    public function broadcastAs(): string
    {
        return 'DiagramContentChanged';
    }

    public function broadcastWith(): array
    {
        return [
            'version' => $this->diagram->version,
            'classesCount' => $this->diagram->classes_count,
            'relationshipsCount' => $this->diagram->relationships_count,
        ];
    }
}
