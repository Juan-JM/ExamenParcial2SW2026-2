<?php

namespace App\Jobs;

use App\Models\CollaborationInvitation;
use App\Services\Push\AppInbox;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

/** Avisa en el celular que alguien te invitó a un diagrama (se acepta desde la web). */
class NotifyInvitation implements ShouldQueue
{
    use Dispatchable, Queueable;

    public function __construct(public string $invitationId)
    {
    }

    public function handle(AppInbox $inbox): void
    {
        $invitation = CollaborationInvitation::with(['diagram', 'inviter'])->find($this->invitationId);

        if (!$invitation?->invitee_user_id || !$invitation->diagram) {
            return;
        }

        $role = $invitation->role === 'editor' ? 'editor' : 'observador';

        $inbox->deliver(
            [(string) $invitation->invitee_user_id],
            'invitation',
            'Nueva invitación',
            ($invitation->inviter?->name ?? 'Alguien')." te invitó a «{$invitation->diagram->title}» como {$role}.",
            (string) $invitation->diagram_id,
            $invitation->diagram->title,
        );
    }
}
