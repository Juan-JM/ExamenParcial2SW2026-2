<?php
// app/Models/Diagram.php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use MongoDB\Laravel\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Carbon\Carbon;

class Diagram extends Model
{
    use HasFactory;

    protected $fillable = [
        'title',
        'description',
        'slug',
        'data',
        'settings',
        'visibility',
        'elements_count',
        'classes_count',
        'relationships_count',
        'version',
        'last_saved_at',
        'user_id',
        'is_template',
    ];

    // Sin cast `array` en data/settings a propósito: en MongoDB se guardan
    // como subdocumentos reales, no como un string JSON.
    protected $attributes = [
        'visibility' => 'private',
        'elements_count' => 0,
        'classes_count' => 0,
        'relationships_count' => 0,
        'version' => 1,
        'is_template' => false,
    ];

    protected $casts = [
        'last_saved_at' => 'datetime',
        'is_template' => 'boolean'
    ];

    protected $dates = [
        'last_saved_at',
    ];

    // Relaciones
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(DiagramSession::class);
    }

    public function activeSession()
    {
        return $this->sessions()
            ->where('status', 'active')
            ->latest()
            ->first();
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(CollaborationInvitation::class);
    }

    protected static function booted(): void
    {
        static::creating(function (Diagram $diagram) {
            if (empty($diagram->slug)) {
                $diagram->slug = static::generateUniqueSlug();
            }
        });
    }

    /**
     * Código corto y estable para las URLs públicas del diagrama (editor,
     * vista compartida) — se genera UNA sola vez al crear (ver booted()
     * arriba) y no vuelve a cambiar. Antes se derivaba del título y se
     * regeneraba en CADA cambio de nombre (setTitleAttribute lo pisaba de
     * nuevo), lo que rompía cualquier link ya compartido apenas alguien
     * renombraba el diagrama — con el título ahora editable en cualquier
     * momento desde el editor, eso pasaba a ser el caso común, no una
     * rareza. Alfabeto sin caracteres ambiguos (sin 0/o, 1/i/l).
     */
    protected static function generateUniqueSlug(): string
    {
        $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';

        do {
            $slug = '';
            for ($i = 0; $i < 8; $i++) {
                $slug .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
        } while (static::where('slug', $slug)->exists());

        return $slug;
    }

    // Mutators y Accessors
    public function setTitleAttribute($value)
    {
        $this->attributes['title'] = $value;
    }

    public function getIsEmptyAttribute(): bool
    {
        return $this->elements_count === 0;
    }

    public function getIsSharedAttribute(): bool
    {
        return $this->visibility === 'shared' || $this->visibility === 'public';
    }

    // Scopes
    public function scopePublic($query)
    {
        return $query->where('visibility', 'public');
    }

    public function scopeTemplates($query)
    {
        return $query->where('is_template', true);
    }

    public function scopeByUser($query, $userId)
    {
        return $query->where('user_id', $userId);
    }

    public function scopeRecentlyUpdated($query)
    {
        return $query->orderBy('last_saved_at', 'desc');
    }

    // Métodos de negocio
    public function updateStats(): void
    {
        $data = $this->data ?? [];
        $cells = collect($data['cells'] ?? []);

        // El editor crea clases e interfaces como 'standard.Rectangle' (con
        // `umlData` adjunto) y toda relación como 'standard.Link' — nunca
        // existieron tipos JointJS 'uml.*'/'*Class*'.
        $this->elements_count = $cells->count();
        $this->classes_count = $cells->filter(
            fn ($cell) => ($cell['type'] ?? null) === 'standard.Rectangle' && isset($cell['umlData'])
        )->count();
        $this->relationships_count = $cells->filter(
            fn ($cell) => ($cell['type'] ?? null) === 'standard.Link'
        )->count();
        $this->last_saved_at = now();

        $this->save();
    }

    public function incrementVersion(): void
    {
        $this->increment('version');
        $this->last_saved_at = now();
        $this->save();
    }

    public function duplicate(string $title = null): self
    {
        $newDiagram = $this->replicate([
            'slug',
            'last_saved_at',
        ]);

        $newDiagram->title = $title ?? $this->title . ' (Copia)';
        $newDiagram->version = 1;
        $newDiagram->save();

        return $newDiagram;
    }

    public function canBeEditedBy(User $user): bool
    {
        // El propietario siempre puede editar
        if ($this->user_id === $user->id) {
            return true;
        }

        // Verificar si tiene sesión activa como editor
        $activeSession = $this->activeSession();
        if (!$activeSession) {
            return false;
        }

        $collaborator = $activeSession->collaborators()
            ->where('user_id', $user->id)
            ->where('status', 'online')
            ->first();

        return $collaborator && in_array($collaborator->role, ['owner', 'editor']);
    }

    /**
     * A diferencia de canBeEditedBy(), acá cualquier colaborador conectado
     * (incluidos los viewers) puede — es para acciones de solo lectura como
     * ver el título/estadísticas, no para editar.
     */
    public function canBeViewedBy(User $user): bool
    {
        if ($this->user_id === $user->id) {
            return true;
        }

        $activeSession = $this->activeSession();
        if (!$activeSession) {
            return false;
        }

        return $activeSession->collaborators()
            ->where('user_id', $user->id)
            ->where('status', 'online')
            ->exists();
    }

    /**
     * A diferencia de canBeViewedBy() (exige presencia en vivo, pensado para
     * gatear acciones dentro del editor en tiempo real), esto es para
     * páginas de solo lectura fuera del editor: cualquiera que alguna vez
     * fue agregado como colaborador de la sesión activa puede entrar, esté
     * "online" en este momento o no.
     */
    public function canBeAccessedBy(User $user): bool
    {
        if ($this->user_id === $user->id) {
            return true;
        }

        return $this->activeSession()
            ?->collaborators()
            ->where('user_id', $user->id)
            ->exists() ?? false;
    }

    // Métodos estáticos
    public static function createFromTemplate(string $templateSlug, User $user, string $title): ?self
    {
        $template = self::templates()->where('slug', $templateSlug)->first();

        if (!$template) {
            return null;
        }

        return $template->duplicate($title)->tap(function ($diagram) use ($user) {
            $diagram->user_id = $user->id;
            $diagram->is_template = false;
            $diagram->visibility = 'private';
            $diagram->save();
        });
    }
}
