<?php

namespace App\Livewire;

use App\Models\CollaborationInvitation;
use App\Services\DiagramService;
use Illuminate\Support\Facades\Auth;
use Livewire\Component;

class NotificationBell extends Component
{
    public bool $open = false;

    protected DiagramService $diagramService;

    public function boot(DiagramService $diagramService)
    {
        $this->diagramService = $diagramService;
    }

    public function toggle(): void
    {
        $this->open = !$this->open;
    }

    public function getNotificationsProperty()
    {
        return Auth::user()->unreadNotifications()->latest()->limit(10)->get();
    }

    public function accept(string $notificationId)
    {
        $notification = Auth::user()->notifications()->findOrFail($notificationId);
        $invitation = CollaborationInvitation::find($notification->data['invitation_id'] ?? null);

        if (!$invitation || $invitation->invitee_user_id !== Auth::id() || !$invitation->isPending()) {
            $notification->markAsRead();
            return;
        }

        $session = $this->diagramService->acceptInvitation($invitation, Auth::user());
        $notification->markAsRead();

        return $this->redirect(route('diagrams.editor', $session->diagram->slug));
    }

    public function reject(string $notificationId): void
    {
        $notification = Auth::user()->notifications()->findOrFail($notificationId);
        $invitation = CollaborationInvitation::find($notification->data['invitation_id'] ?? null);

        if ($invitation && $invitation->invitee_user_id === Auth::id() && $invitation->isPending()) {
            $invitation->update(['status' => 'rejected', 'responded_at' => now()]);

            app(\App\Services\Agent\ActivityLog::class)->system($invitation->diagram_id, Auth::user(), 'INVITE_REJECT', 'rechazó la invitación');
        }

        $notification->markAsRead();
    }

    public function render()
    {
        return view('livewire.notification-bell');
    }
}
