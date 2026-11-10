<?php

namespace App\Mail;

use App\Models\CollaborationInvitation;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class DiagramInvitationMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public CollaborationInvitation $invitation)
    {
    }

    public function build()
    {
        $this->invitation->loadMissing(['diagram', 'inviter']);

        return $this->subject("{$this->invitation->inviter->name} te invitó a colaborar en un diagrama UML")
            ->view('emails.diagram-invitation', [
                'invitation' => $this->invitation,
                'registerUrl' => route('register', ['invite_token' => $this->invitation->token]),
            ]);
    }
}
