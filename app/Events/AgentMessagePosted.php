<?php

namespace App\Events;

use App\Models\AiMessage;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/** Mensaje nuevo o actualizado en la conversación compartida. Llega a todos, incluido quien lo envió. */
class AgentMessagePosted implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public AiMessage $message)
    {
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel("diagram-agent.{$this->message->diagram_id}");
    }

    public function broadcastAs(): string
    {
        return 'AgentMessagePosted';
    }

    public function broadcastWith(): array
    {
        return ['message' => $this->message->toClientArray()];
    }
}
