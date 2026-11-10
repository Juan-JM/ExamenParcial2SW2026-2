<?php

namespace App\Http\Controllers;

use App\Models\CollaborationInvitation;
use App\Models\Diagram;
use App\Services\DiagramService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class CollaborationInvitationController extends Controller
{
    public function __construct(protected DiagramService $diagramService)
    {
    }

    /**
     * Invita a colaborar en $diagram, ya sea a un usuario registrado
     * (encontrado por email) o a un email externo sin cuenta todavía.
     */
    public function store(Request $request, Diagram $diagram)
    {
        if ($diagram->user_id !== Auth::id()) {
            abort(403, 'Solo el dueño del diagrama puede invitar colaboradores');
        }

        $request->validate([
            'email' => 'required|email',
            'role' => 'nullable|in:editor,viewer',
        ]);

        $email = $request->email;
        $role = $request->role ?? 'editor';

        $existingPending = $diagram->invitations()
            ->where('invitee_email', $email)
            ->where('status', 'pending')
            ->first();

        if ($existingPending) {
            return response()->json(['message' => 'Ya hay una invitación pendiente para ese correo'], 422);
        }

        $invitation = $this->diagramService->inviteCollaborator($diagram, Auth::user(), $email, $role);

        return response()->json([
            'success' => true,
            'invitation' => $invitation,
            'registered' => (bool) $invitation->invitee_user_id,
        ]);
    }

    public function accept(CollaborationInvitation $invitation)
    {
        if ($invitation->invitee_user_id !== Auth::id()) {
            abort(403);
        }

        if (!$invitation->isPending()) {
            return redirect()->route('diagrams.index')->with('error', 'Esta invitación ya fue respondida');
        }

        $this->diagramService->acceptInvitation($invitation, Auth::user());
        $diagram = $invitation->diagram;

        return redirect()->route('diagrams.editor', $diagram->slug)
            ->with('success', 'Te uniste a la colaboración de "' . $diagram->title . '"');
    }

    public function reject(CollaborationInvitation $invitation)
    {
        if ($invitation->invitee_user_id !== Auth::id()) {
            abort(403);
        }

        if ($invitation->isPending()) {
            $invitation->update(['status' => 'rejected', 'responded_at' => now()]);
        }

        return back()->with('success', 'Invitación rechazada');
    }
}
