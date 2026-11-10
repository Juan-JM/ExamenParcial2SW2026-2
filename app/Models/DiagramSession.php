<?php
// app/Models/DiagramSession.php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use MongoDB\Laravel\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;
use App\Events\UserJoinedSession;
use App\Events\UserLeftSession;

class DiagramSession extends Model
{
    use HasFactory;

    protected $fillable = [
        'session_id',
        'diagram_id',
        'title',
        'status',
        'started_at',
        'ended_at',
        'max_collaborators',
        'allow_anonymous',
        'permissions',
        'invite_token',
        'invite_expires_at',
        'is_public',
        'active_users_count',
        'owner_id'
    ];

    protected $attributes = [
        'status' => 'active',
        'max_collaborators' => 10,
        'allow_anonymous' => false,
        'is_public' => false,
        'active_users_count' => 0,
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
        'invite_expires_at' => 'datetime',
        'allow_anonymous' => 'boolean',
        'is_public' => 'boolean'
    ];

    protected static function boot()
    {
        parent::boot();

        static::creating(function ($session) {
            if (!$session->session_id) {
                $session->session_id = (string) Str::uuid();
            }
            if (!$session->invite_token) {
                $session->invite_token = Str::random(32);
            }
            if (!$session->started_at) {
                $session->started_at = now();
            }
        });
    }

    // Relaciones
    public function diagram(): BelongsTo
    {
        return $this->belongsTo(Diagram::class);
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function collaborators(): HasMany
    {
        return $this->hasMany(Collaborator::class);
    }

    // Scopes
    public function scopeActive($query)
    {
        return $query->where('status', 'active');
    }

    public function scopePublic($query)
    {
        return $query->where('is_public', true);
    }

    // Métodos de negocio
    public function addCollaborator(User $user = null, string $role = 'viewer', array $permissions = []): Collaborator
    {
        $collaborator = $this->collaborators()->create([
            'user_id' => $user?->id,
            'anonymous_name' => $user ? null : 'Usuario Anónimo',
            'anonymous_color' => $user ? null : $this->generateRandomColor(),
            'role' => $role,
            'permissions' => $permissions,
            'joined_at' => now(),
            'last_seen_at' => now(),
            'ip_address' => request()->ip()
        ]);

        $this->updateActiveUsersCount();

        if ($user) {
            \App\Support\LiveBroadcast::send(new UserJoinedSession($this->session_id, $user));
        }

        return $collaborator;
    }

    public function removeCollaborator($collaboratorId): bool
    {
        $collaborator = $this->collaborators()->find($collaboratorId);

        if ($collaborator) {
            $wasEditing = $collaborator->editing_element_id;

            $collaborator->update([
                'status' => 'offline',
                'left_at' => now(),
                'editing_element_id' => null,
                'editing_started_at' => null,
            ]);
            $this->updateActiveUsersCount();

            // Si se va con un elemento bloqueado, no debe quedar bloqueado
            // para los demás hasta que expire el TTL — se libera de una.
            if ($wasEditing && $collaborator->user) {
                broadcast(new \App\Events\ElementUnlocked($this->session_id, $wasEditing, $collaborator->user))->toOthers();
            }

            if ($collaborator->user) {
                broadcast(new UserLeftSession($this->session_id, $collaborator->user))->toOthers();
            }

            return true;
        }

        return false;
    }

    public function updateActiveUsersCount(): void
    {
        $this->active_users_count = $this->collaborators()
            ->where('status', 'online')
            ->count();
        $this->save();
    }

    public function canAcceptMoreCollaborators(): bool
    {
        return $this->active_users_count < $this->max_collaborators;
    }

public function generateInviteUrl(): string
{
    return route('collaborate.join-with-token', [
        'sessionId' => $this->session_id,
        'token' => $this->invite_token
    ]);
}

    public function isInviteValid(): bool
    {
        return !$this->invite_expires_at || $this->invite_expires_at->isFuture();
    }

    public function end(): void
    {
        $this->update([
            'status' => 'ended',
            'ended_at' => now()
        ]);

        // Marcar todos los colaboradores como offline
        $this->collaborators()->update([
            'status' => 'offline',
            'left_at' => now()
        ]);
    }

    private function generateRandomColor(): string
    {
        $colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
        return $colors[array_rand($colors)];
    }
}

