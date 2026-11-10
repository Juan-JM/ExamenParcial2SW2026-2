<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use MongoDB\Laravel\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<\Database\Factories\UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * Notificaciones como documentos MongoDB: la clase nativa de Laravel no
     * sabe usar esta conexión.
     */
    public function notifications()
    {
        return $this->morphMany(DatabaseNotification::class, 'notifiable')->latest();
    }

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    /**
 * Los diagramas creados por el usuario
 */
public function diagrams(): HasMany
{
    return $this->hasMany(Diagram::class);
}

/**
 * Las sesiones de diagramas donde el usuario es owner
 */
public function ownedSessions(): HasMany
{
    return $this->hasMany(DiagramSession::class, 'owner_id');
}

/**
 * Colaboraciones del usuario en sesiones de diagramas
 */
public function collaborations(): HasMany
{
    return $this->hasMany(Collaborator::class);
}

/**
 * Sesiones activas donde el usuario está colaborando
 */
public function activeSessions()
{
    return $this->collaborations()
        ->with('session')
        ->whereHas('session', function ($query) {
            $query->where('status', 'active');
        })
        ->where('status', 'online');
}

/**
 * Diagramas públicos o compartidos que puede ver
 */
public function accessibleDiagrams()
{
    return Diagram::where(function ($query) {
        $query->where('visibility', 'public')
              ->orWhere('user_id', $this->id)
              ->orWhereHas('sessions.collaborators', function ($q) {
                  $q->where('user_id', $this->id);
              });
    });
}

/**
 * Crear un nuevo diagrama para el usuario
 */
public function createDiagram(string $title, string $description = null): Diagram
{
    return $this->diagrams()->create([
        'title' => $title,
        'description' => $description,
        'data' => ['cells' => []],
        'visibility' => 'private',
        'version' => 1
    ]);
}

/**
 * Crear una sesión colaborativa para un diagrama
 */
public function createDiagramSession(Diagram $diagram, array $options = []): DiagramSession
{
    return $diagram->sessions()->create(array_merge([
        'owner_id' => $this->id,
        'title' => $diagram->title . ' - Sesión Colaborativa',
        'max_collaborators' => 10,
        'allow_anonymous' => false,
        'is_public' => false
    ], $options));
}
}
