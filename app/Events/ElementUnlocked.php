<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use App\Models\User;

class ElementUnlocked implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $sessionId;
    public $elementId;
    public $user;

    public function __construct($sessionId, string $elementId, User $user)
    {
        $this->sessionId = $sessionId;
        $this->elementId = $elementId;
        $this->user = $user;
    }

    public function broadcastOn()
    {
        return new PresenceChannel("diagram.{$this->sessionId}");
    }

    public function broadcastAs()
    {
        return 'ElementUnlocked';
    }

    public function broadcastWith()
    {
        return [
            'sessionId' => $this->sessionId,
            'elementId' => $this->elementId,
            'user' => [
                'id' => $this->user->id,
                'name' => $this->user->name,
            ],
            'timestamp' => now()->timestamp,
        ];
    }
}
