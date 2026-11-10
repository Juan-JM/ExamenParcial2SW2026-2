<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use MongoDB\Laravel\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class CollaborationInvitation extends Model
{
    use HasFactory;

    protected $fillable = [
        'diagram_id',
        'inviter_id',
        'invitee_email',
        'invitee_user_id',
        'role',
        'token',
        'status',
        'responded_at',
    ];

    protected $attributes = [
        'role' => 'editor',
        'status' => 'pending',
    ];

    protected $casts = [
        'responded_at' => 'datetime',
    ];

    protected static function boot()
    {
        parent::boot();

        static::creating(function (CollaborationInvitation $invitation) {
            if (!$invitation->token) {
                $invitation->token = Str::random(40);
            }
        });
    }

    public function diagram(): BelongsTo
    {
        return $this->belongsTo(Diagram::class);
    }

    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'inviter_id');
    }

    public function invitee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invitee_user_id');
    }

    public function isPending(): bool
    {
        return $this->status === 'pending';
    }
}
