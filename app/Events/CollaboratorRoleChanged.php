<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * El dueño le cambió el rol a un colaborador ya conectado (editor <-> viewer)
 * — a diferencia de UserLeftSession (colaborador removido del todo), acá
 * sigue en la sesión pero con otro permiso; el propio cliente afectado
 * reacciona pasando a modo solo-lectura sin necesidad de recargar.
 */
class CollaboratorRoleChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $sessionId;
    public $userId;
    public $role;

    public function __construct($sessionId, string $userId, string $role)
    {
        $this->sessionId = $sessionId;
        $this->userId = $userId;
        $this->role = $role;
    }

    public function broadcastOn()
    {
        return new PresenceChannel("diagram.{$this->sessionId}");
    }

    public function broadcastAs()
    {
        return 'CollaboratorRoleChanged';
    }

    public function broadcastWith()
    {
        return [
            'sessionId' => $this->sessionId,
            'userId' => $this->userId,
            'role' => $this->role,
        ];
    }
}
