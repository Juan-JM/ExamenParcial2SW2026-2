<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use App\Models\User;

class UserLeftSession implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $sessionId;
    public $user;

    public function __construct($sessionId, User $user)
    {
        $this->sessionId = $sessionId;
        $this->user = $user;
    }

    public function broadcastOn()
    {
        return new PresenceChannel("diagram.{$this->sessionId}");
    }

    public function broadcastAs()
    {
        return 'UserLeftSession';
    }

    public function broadcastWith()
    {
        return [
            'sessionId' => $this->sessionId,
            'user' => [
                'id' => $this->user->id,
                'name' => $this->user->name
            ],
            'timestamp' => now()->timestamp
        ];
    }
}
