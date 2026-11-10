<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/** Se restauró una versión anterior: todos recargan el diagrama completo. */
class DiagramRestored implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public string $diagramId, public string $restoredByName, public int $version)
    {
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("diagram-agent.{$this->diagramId}");
    }

    public function broadcastAs(): string
    {
        return 'DiagramRestored';
    }

    public function broadcastWith(): array
    {
        return ['restoredByName' => $this->restoredByName, 'version' => $this->version];
    }
}
