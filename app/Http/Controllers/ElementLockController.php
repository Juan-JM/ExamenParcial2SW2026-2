<?php

namespace App\Http\Controllers;

use App\Events\ElementLocked;
use App\Events\ElementUnlocked;
use App\Models\DiagramSession;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class ElementLockController extends Controller
{
    /**
     * Intenta tomar el bloqueo blando de un elemento del canvas para el
     * colaborador autenticado. 409 si ya lo tiene otro colaborador.
     */
    public function lock(Request $request, DiagramSession $session)
    {
        $request->validate(['element_id' => 'required|string']);

        $collaborator = $this->collaboratorFor($session);

        abort_unless($collaborator->canEdit(), 403, 'Los observadores no pueden editar');

        if (!$collaborator->lockElement($request->element_id)) {
            return response()->json(['locked' => false, 'message' => 'Elemento bloqueado por otro colaborador'], 409);
        }

        broadcast(new ElementLocked($session->session_id, $request->element_id, Auth::user()))->toOthers();

        return response()->json(['locked' => true]);
    }

    public function unlock(Request $request, DiagramSession $session)
    {
        $request->validate(['element_id' => 'required|string']);

        $collaborator = $this->collaboratorFor($session);

        if ($collaborator->editing_element_id === $request->element_id) {
            $collaborator->unlockElement();
            broadcast(new ElementUnlocked($session->session_id, $request->element_id, Auth::user()))->toOthers();
        }

        return response()->json(['locked' => false]);
    }

    private function collaboratorFor(DiagramSession $session)
    {
        $collaborator = $session->collaborators()->where('user_id', Auth::id())->first();

        // El dueño puede no tener fila de colaborador si la sesión se creó
        // por otro flujo sin agregarlo explícitamente — se crea aquí.
        if (!$collaborator && $session->owner_id === Auth::id()) {
            $collaborator = $session->addCollaborator(Auth::user(), 'owner');
        }

        abort_if(!$collaborator, 403, 'No eres colaborador de esta sesión');

        return $collaborator;
    }
}
