<?php

namespace App\Http\Controllers;

use App\Events\DiagramUpdated;
use App\Models\DiagramSession;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class DiagramSyncController extends Controller
{
    /**
     * Tipos que no modifican el diagrama (resaltado de selección): cualquier
     * colaborador puede emitirlos, incluidos los observadores.
     */
    private const EPHEMERAL_TYPES = ['element_selected'];

    /**
     * Retransmite un cambio a los demás colaboradores conectados a la
     * sesión, sin tocar la base de datos. Este es el mecanismo real de
     * "tiempo real": cada acción del usuario (mover, escribir, crear,
     * borrar) llega acá y se reenvía al instante por Pusher; el guardado en
     * la base de datos es un proceso aparte (autosave periódico / guardado
     * manual), para no acoplar "verse en vivo" con "persistirse".
     */
    public function sync(Request $request, DiagramSession $session)
    {
        $request->validate([
            'type' => 'required|string',
            'data' => 'required|array',
        ]);

        $type = $request->input('type');
        $collaborator = $session->collaborators()->where('user_id', Auth::id())->first();

        abort_if(!$collaborator, 403, 'No eres colaborador de esta sesión');

        if (!in_array($type, self::EPHEMERAL_TYPES, true)) {
            abort_unless($collaborator->canEdit(), 403, 'Los observadores no pueden editar');
        }

        $collaborator->updateLastSeen();

        broadcast(new DiagramUpdated($session->session_id, Auth::id(), $type, $request->input('data')))->toOthers();

        return response()->json(['ok' => true]);
    }
}
