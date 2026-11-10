<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/** Alguien cerró la sesión a mano: quienes siguen en el diagrama empiezan otra. */
class WorkSessionClosed implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public string $diagramId, public string $sessionId, public string $closedByName)
    {
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("diagram-agent.{$this->diagramId}");
    }

    public function broadcastAs(): string
    {
        return 'WorkSessionClosed';
    }

    public function broadcastWith(): array
    {
        return ['sessionId' => $this->sessionId, 'closedByName' => $this->closedByName];
    }
}
