<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Diagram;
use App\Services\DiagramService;

class CollaborationController extends Controller
{
    protected $diagramService;

    public function __construct(DiagramService $diagramService)
    {
        $this->diagramService = $diagramService;
    }

    /**
     * Crear sesión colaborativa
     */
    public function createSession(Request $request)
    {
        $request->validate([
            'diagram_id' => 'required|exists:diagrams,id',
            'max_collaborators' => 'integer|min:1|max:50',
            'allow_anonymous' => 'boolean'
        ]);

        $diagram = Diagram::findOrFail($request->diagram_id);

        if ($diagram->user_id !== auth()->id()) {
            return response()->json(['error' => 'No autorizado'], 403);
        }

        $session = $this->diagramService->createCollaborativeSession($diagram, [
            'max_collaborators' => $request->max_collaborators ?? 10,
            'allow_anonymous' => $request->allow_anonymous ?? false
        ]);

        return response()->json([
            'session' => $session,
            'invite_url' => $session->generateInviteUrl()
        ]);
    }

    /**
     * Unirse a sesión
     */
public function joinSession($sessionId, $token)
{
    $session = $this->diagramService->joinSession($sessionId, $token, auth()->user());

    if (!$session) {
        return redirect()->route('diagrams.index')
            ->with('error', 'Sesión no válida o expirada');
    }

    // IMPORTANTE: Guardar en la sesión de Laravel
    session(['collaboration_session' => $session->session_id]);

    return redirect()->route('diagrams.editor', $session->diagram->slug)
        ->with([
            'success' => 'Te uniste a la sesión colaborativa'
        ]);
}
}
