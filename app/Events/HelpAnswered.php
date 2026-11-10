<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/** Respuesta del asistente de ayuda: solo la recibe quien preguntó. */
class HelpAnswered implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public string $userId, public array $help)
    {
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("help.{$this->userId}");
    }

    public function broadcastAs(): string
    {
        return 'HelpAnswered';
    }

    public function broadcastWith(): array
    {
        return ['help' => $this->help];
    }
}
