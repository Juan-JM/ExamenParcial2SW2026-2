<?php
// app/Events/DiagramUpdated.php - Evento principal de colaboración

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

// ShouldBroadcastNow (no ShouldBroadcast): este evento se dispara en ráfaga
// mientras alguien mueve/escribe/edita — encolarlo depende de que haya un
// worker (`queue:work`) corriendo, y si no lo hay (como pasaba acá) se
// acumulan sin enviarse nunca. Al emitirse en el momento no hace falta
// worker para que la colaboración en vivo funcione.
class DiagramUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $sessionId;
    public $userId;
    public $updateType;
    public $data;
    public $timestamp;

    public function __construct($sessionId, $userId, $updateType, $data)
    {
        $this->sessionId = $sessionId;
        $this->userId = $userId;
        $this->updateType = $updateType;
        $this->data = $data;
        $this->timestamp = now()->timestamp;
    }

    public function broadcastOn()
    {
        return new PresenceChannel("diagram.{$this->sessionId}");
    }

    public function broadcastAs()
    {
        return 'DiagramUpdated';
    }

    public function broadcastWith()
    {
        return [
            'sessionId' => $this->sessionId,
            'userId' => $this->userId,
            'updateType' => $this->updateType,
            'data' => $this->data,
            'timestamp' => $this->timestamp
        ];
    }
}
