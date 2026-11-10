<?php

namespace App\Notifications;

use App\Models\CollaborationInvitation;
use Illuminate\Notifications\Notification;

class DiagramCollaborationInvite extends Notification
{
    public function __construct(public CollaborationInvitation $invitation)
    {
    }

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toDatabase(object $notifiable): array
    {
        $this->invitation->loadMissing(['diagram', 'inviter']);

        return [
            'invitation_id' => $this->invitation->id,
            'diagram_id' => $this->invitation->diagram_id,
            'diagram_title' => $this->invitation->diagram?->title,
            'inviter_name' => $this->invitation->inviter?->name,
            'role' => $this->invitation->role,
            'status' => $this->invitation->status,
        ];
    }
}
