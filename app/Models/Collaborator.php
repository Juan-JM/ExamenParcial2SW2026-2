<?php


// app/Models/Collaborator.php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use MongoDB\Laravel\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Collaborator extends Model
{
    use HasFactory;

    protected $fillable = [
        'diagram_session_id',
        'user_id',
        'anonymous_name',
        'anonymous_color',
        'socket_id',
        'ip_address',
        'user_agent',
        'role',
        'status',
        'permissions',
        'joined_at',
        'last_seen_at',
        'left_at',
        'cursor_position',
        'current_selection',
        'edits_count',
        'elements_created',
        'elements_modified',
        'chat_messages',
        'invited_by_email',
        'invitation_sent_at',
        'invitation_accepted_at',
        'editing_element_id',
        'editing_started_at'
    ];

    protected $attributes = [
        'role' => 'viewer',
        'status' => 'online',
        'edits_count' => 0,
        'elements_created' => 0,
        'elements_modified' => 0,
        'chat_messages' => 0,
    ];

    protected $casts = [
        'joined_at' => 'datetime',
        'last_seen_at' => 'datetime',
        'left_at' => 'datetime',
        'invitation_sent_at' => 'datetime',
        'invitation_accepted_at' => 'datetime',
        'editing_started_at' => 'datetime'
    ];

    // Relaciones
    public function session(): BelongsTo
    {
        return $this->belongsTo(DiagramSession::class, 'diagram_session_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    // Accessors
    public function getDisplayNameAttribute(): string
    {
        return $this->user?->name ?? $this->anonymous_name ?? 'Usuario Anónimo';
    }

    public function getIsAnonymousAttribute(): bool
    {
        return is_null($this->user_id);
    }

    public function getIsOnlineAttribute(): bool
    {
        return $this->status === 'online' &&
               $this->last_seen_at->diffInMinutes(now()) < 5;
    }

    // Scopes
    public function scopeOnline($query)
    {
        return $query->where('status', 'online')
                    ->where('last_seen_at', '>', now()->subMinutes(5));
    }

    public function scopeEditors($query)
    {
        return $query->whereIn('role', ['owner', 'editor']);
    }

    public function scopeViewers($query)
    {
        return $query->where('role', 'viewer');
    }

    // Métodos de negocio
    public function updateLastSeen(): void
    {
        $this->last_seen_at = now();
        $this->save();
    }

    public function incrementEdit(): void
    {
        $this->increment('edits_count');
        $this->updateLastSeen();
    }

    public function canEdit(): bool
    {
        return in_array($this->role, ['owner', 'editor']);
    }

    public function canView(): bool
    {
        return in_array($this->role, ['owner', 'editor', 'viewer']);
    }

    public function promoteToEditor(): bool
    {
        if ($this->role === 'viewer') {
            $this->role = 'editor';
            $this->save();
            return true;
        }
        return false;
    }

    public function demoteToViewer(): bool
    {
        if ($this->role === 'editor') {
            $this->role = 'viewer';
            $this->save();
            return true;
        }
        return false;
    }

    /**
     * Bloqueo blando por elemento: intenta tomar el lock de $elementId.
     * Devuelve false si otro colaborador ya lo tiene bloqueado.
     */
    /**
     * Un lock sin liberar (pestaña cerrada de golpe, crash del navegador, red
     * caída a mitad de un drag) no debe bloquear un elemento para siempre:
     * pasado este tiempo se trata como abandonado y deja de contar.
     */
    private const LOCK_TTL_SECONDS = 120;

    public function lockElement(string $elementId): bool
    {
        $lockedByOther = $this->session()->first()
            ?->collaborators()
            ->where('id', '!=', $this->id)
            ->where('editing_element_id', $elementId)
            ->where('editing_started_at', '>', now()->subSeconds(self::LOCK_TTL_SECONDS))
            ->exists();

        if ($lockedByOther) {
            return false;
        }

        $this->editing_element_id = $elementId;
        $this->editing_started_at = now();
        $this->save();

        return true;
    }

    public function unlockElement(): void
    {
        $this->editing_element_id = null;
        $this->editing_started_at = null;
        $this->save();
    }
}
