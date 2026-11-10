<?php

use App\Models\Diagram;
use App\Models\DiagramSession;
use Illuminate\Support\Facades\Broadcast;

// Canal privado (no de presencia) ligado al DIAGRAMA, no a una sesión — a
// diferencia de 'diagram.{sessionId}', existe incluso antes de que haya
// sesión colaborativa. Solo lo escucha el dueño mientras edita en modo
// local, para enterarse (vía CollaborationSessionStarted) en el momento en
// que un invitado acepta y se crea la sesión, sin tener que recargar.
Broadcast::channel('diagram-lobby.{diagramId}', function ($user, $diagramId) {
    $diagram = Diagram::find($diagramId);

    return $diagram && $diagram->user_id === $user->id;
});

// Respuestas del asistente de ayuda: cada persona solo escucha las suyas.
Broadcast::channel('help.{userId}', fn ($user, $userId) => (string) $user->id === (string) $userId);

// Conversación y actividad de la IA del diagrama. Existe aunque no haya sesión
// colaborativa, y también lo usa la app móvil.
Broadcast::channel('diagram-agent.{diagramId}', function ($user, $diagramId) {
    $diagram = Diagram::find($diagramId);

    return $diagram && $diagram->canBeAccessedBy($user);
});

// Canal de presencia para la colaboración de un diagrama. Solo el dueño de
// la sesión o un colaborador ya registrado en ella (cualquier estado, no
// solo "online" — así alguien que estuvo offline puede volver a entrar)
// puede unirse. El payload devuelto (id/name/lockedElementId) es lo que
// Echo entrega en el evento `here` a todos los que ya están conectados,
// así un usuario que entra tarde ve de una los bloqueos ya activos.
Broadcast::channel('diagram.{sessionId}', function ($user, $sessionId) {
    $session = DiagramSession::where('session_id', $sessionId)->first();

    if (!$session) {
        return false;
    }

    if ($session->owner_id === $user->id) {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'lockedElementId' => null,
        ];
    }

    $collaborator = $session->collaborators()->where('user_id', $user->id)->first();

    if (!$collaborator) {
        return false;
    }

    return [
        'id' => $user->id,
        'name' => $user->name,
        'lockedElementId' => $collaborator->editing_element_id,
    ];
});
