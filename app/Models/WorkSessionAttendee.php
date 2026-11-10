<?php

namespace App\Models;

use Illuminate\Support\Carbon;
use MongoDB\Laravel\Eloquent\Model;

/**
 * Asistencia de una persona a una sesión de trabajo. Va en su propia colección
 * porque cada latido la escribe: dentro del documento de la sesión, dos latidos
 * simultáneos se pisarían entre sí.
 */
class WorkSessionAttendee extends Model
{
    protected $table = 'work_session_attendees';

    protected $fillable = ['work_session_id', 'user_id', 'name', 'joined_at', 'last_seen_at', 'left_at', 'gone_at', 'context'];

    protected $casts = [
        'joined_at' => 'datetime',
        'last_seen_at' => 'datetime',
        'left_at' => 'datetime',
        'gone_at' => 'datetime',
    ];

    /** Cuándo se fue, o null si sigue presente. */
    public function departureTime(): ?Carbon
    {
        if ($this->left_at && $this->left_at->lte(now()->subSeconds(WorkSession::LEAVE_GRACE_SECONDS))) {
            return $this->left_at;
        }

        if ($this->last_seen_at->lte(now()->subSeconds(WorkSession::PRESENCE_TTL_SECONDS))) {
            return $this->last_seen_at;
        }

        return null;
    }
}
