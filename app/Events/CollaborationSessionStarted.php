<?php
// app/Events/CollaborationSessionStarted.php
// Avisa al dueño del diagrama que ya existe una sesión colaborativa activa,
// para cuando la abrió ANTES de que nadie se sumara (empezó en modo local,
// sin sessionId) y por lo tanto no estaba escuchando el canal de la sesión
// todavía. Viaja por un canal aparte, ligado al diagrama (no a la sesión,
// que todavía no existía cuando el dueño cargó la página), así su editor ya
// abierto puede pasar a modo colaborativo solo con esto, sin recargar.
namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class CollaborationSessionStarted implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $diagramId;
    public $sessionId;

    public function __construct($diagramId, $sessionId)
    {
        $this->diagramId = $diagramId;
        $this->sessionId = $sessionId;
    }

    public function broadcastOn()
    {
        return new PrivateChannel("diagram-lobby.{$this->diagramId}");
    }

    public function broadcastAs()
    {
        return 'CollaborationSessionStarted';
    }

    public function broadcastWith()
    {
        return [
            'sessionId' => $this->sessionId,
        ];
    }
}
