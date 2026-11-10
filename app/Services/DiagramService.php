<?php
// app/Services/DiagramService.php

namespace App\Services;

use App\Models\Diagram;
use App\Models\DiagramSession;
use App\Models\Collaborator;
use App\Models\CollaborationInvitation;
use App\Models\User;
use App\Events\DiagramContentChanged;
use App\Events\DiagramUpdated;
use App\Events\CollaborationSessionStarted;
use App\Models\DiagramSnapshot;
use App\Models\WorkSession;
use App\Services\Agent\ActivityLog;
use App\Support\LiveBroadcast;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class DiagramService
{
    /**
     * Crear un nuevo diagrama
     */
    public function create(array $data): Diagram
    {
        $user = Auth::user();

        $diagram = Diagram::create([
            'title' => $data['title'] ?? 'Nuevo Diagrama UML',
            'description' => $data['description'] ?? null,
            'data' => $data['data'] ?? ['cells' => []],
            'user_id' => $user->id,
            'visibility' => $data['visibility'] ?? 'private',
            'settings' => $data['settings'] ?? [
                'zoom' => 1,
                'panX' => 0,
                'panY' => 0,
                'gridSize' => 20,
                'snapToGrid' => true
            ]
        ]);

        // Actualizar estadísticas
        $diagram->updateStats();

        Log::info('Nuevo diagrama creado', [
            'diagram_id' => $diagram->id,
            'user_id' => $user->id,
            'title' => $diagram->title
        ]);

        return $diagram;
    }

    /**
     * Guardar cambios en un diagrama existente.
     *
     * $versionReason: si es un hito (por ejemplo DiagramSnapshot::MANUAL), además
     * queda como versión en el historial. El autoguardado pasa null: no genera
     * versiones; la de fin de sesión la toma WorkSession al cerrarse.
     */
    public function save(Diagram $diagram, array $data, ?string $versionReason = null): bool
    {
        try {
            $previousTitle = $diagram->title;

            $diagram->fill([
                'data' => $data['data'] ?? $diagram->data,
                'settings' => $data['settings'] ?? $diagram->settings,
                'title' => $data['title'] ?? $diagram->title,
                'description' => $data['description'] ?? $diagram->description
            ]);

            // Actualizar estadísticas automáticamente
            $diagram->updateStats();
            $diagram->incrementVersion();

            Log::info('Diagrama guardado', [
                'diagram_id' => $diagram->id,
                'version' => $diagram->version,
                'elements_count' => $diagram->elements_count
            ]);

            if ($previousTitle !== $diagram->title) {
                app(ActivityLog::class)->system($diagram->id, Auth::user(), 'RENAME_DIAGRAM', "renombró el diagrama de \"{$previousTitle}\" a \"{$diagram->title}\"");
            }

            if ($versionReason) {
                DiagramSnapshot::capture(
                    $diagram->id,
                    WorkSession::where('diagram_id', $diagram->id)->where('is_open', true)->value('id'),
                    $versionReason,
                    Auth::user(),
                );
            }

            // Solo un aviso liviano (lo usa la app móvil). El diagrama completo ya
            // no se difunde: cada cambio viaja en vivo por separado, y reenviarlo
            // entero en cada guardado hacía que los demás navegadores redibujaran
            // todo con una versión que podía estar atrasada respecto de su pantalla.
            LiveBroadcast::send(new DiagramContentChanged($diagram));
            \App\Jobs\IndexDiagramClasses::schedule($diagram->id);

            return true;

        } catch (\Exception $e) {
            Log::error('Error guardando diagrama', [
                'diagram_id' => $diagram->id,
                'error' => $e->getMessage()
            ]);

            return false;
        }
    }

    /**
     * Cargar un diagrama por slug
     */
    public function loadBySlug(string $slug): ?Diagram
    {
        return Diagram::where('slug', $slug)
            ->with(['user', 'sessions'])
            ->first();
    }

    /**
     * Cargar diagrama por ID con verificación de permisos
     */
    public function loadById(string $id, User $user = null): ?Diagram
    {
        $user = $user ?? Auth::user();

        $diagram = Diagram::with(['user', 'sessions'])->find($id);

        if (!$diagram) {
            return null;
        }

        // Verificar permisos
        if ($diagram->visibility === 'private' && $diagram->user_id !== $user->id) {
            // Verificar si el usuario tiene acceso a través de una sesión colaborativa
            $hasAccess = $diagram->sessions()
                ->whereHas('collaborators', function ($query) use ($user) {
                    $query->where('user_id', $user->id)
                          ->where('status', 'online');
                })
                ->exists();

            if (!$hasAccess) {
                return null;
            }
        }

        return $diagram;
    }

    /**
     * Duplicar un diagrama
     */
    public function duplicate(Diagram $diagram, string $newTitle = null): Diagram
    {
        $user = Auth::user();

        $newDiagram = $diagram->duplicate($newTitle);
        $newDiagram->user_id = $user->id;
        $newDiagram->save();

        Log::info('Diagrama duplicado', [
            'original_id' => $diagram->id,
            'new_id' => $newDiagram->id,
            'user_id' => $user->id
        ]);

        return $newDiagram;
    }

    /**
     * Crear sesión colaborativa. $owner es quien queda como dueño de la
     * sesión (por defecto, quien la solicita) — se pasa explícitamente desde
     * acceptInvitation() porque ahí quien dispara la creación es el invitado
     * que acepta, no el dueño real del diagrama.
     */
    public function createCollaborativeSession(Diagram $diagram, array $options = [], User $owner = null): DiagramSession
    {
        $user = $owner ?? Auth::user();

        // Terminar sesiones activas previas
        $diagram->sessions()
            ->where('status', 'active')
            ->update(['status' => 'paused']);

        $session = $diagram->sessions()->create(array_merge([
            'owner_id' => $user->id,
            'title' => $diagram->title . ' - Colaboración',
            'max_collaborators' => 10,
            'allow_anonymous' => true,
            'is_public' => false,
            'invite_expires_at' => Carbon::now()->addHours(24),
        ], $options));

        // Agregar al owner como colaborador
        $session->addCollaborator($user, 'owner');

        Log::info('Sesión colaborativa creada', [
            'session_id' => $session->session_id,
            'diagram_id' => $diagram->id,
            'owner_id' => $user->id
        ]);

        // Si el dueño ya tenía el editor abierto en modo local (todavía no
        // existía ninguna sesión cuando cargó la página), esto lo avisa para
        // que pase a modo colaborativo solo, sin recargar — ver el frontend
        // en editor.js (canal 'diagram-lobby.{diagramId}').
        LiveBroadcast::send(new CollaborationSessionStarted($diagram->id, $session->session_id));

        return $session;
    }

    /**
     * Unirse a una sesión colaborativa
     */
    public function joinSession(string $sessionId, string $inviteToken, User $user = null): ?DiagramSession
    {
        $session = DiagramSession::where('session_id', $sessionId)
            ->where('invite_token', $inviteToken)
            ->where('status', 'active')
            ->first();

        if (!$session || !$session->isInviteValid()) {
            return null;
        }

        if (!$session->canAcceptMoreCollaborators()) {
            return null;
        }

        // Verificar si ya es colaborador
        if ($user) {
            $existingCollaborator = $session->collaborators()
                ->where('user_id', $user->id)
                ->first();

            if ($existingCollaborator) {
                // Reactivar colaboración existente
                $existingCollaborator->update([
                    'status' => 'online',
                    'last_seen_at' => now()
                ]);

                return $session;
            }
        }

        // Agregar nuevo colaborador
        $role = $session->allow_anonymous && !$user ? 'viewer' : 'editor';
        $session->addCollaborator($user, $role);

        Log::info('Usuario se unió a sesión colaborativa', [
            'session_id' => $session->session_id,
            'user_id' => $user?->id ?? 'anonymous',
            'role' => $role
        ]);

        return $session;
    }

    /**
     * Invita a colaborar en $diagram al $email dado: si ya existe un usuario
     * registrado con ese correo, le llega como notificación in-app; si no,
     * se le envía un correo con enlace de registro (se enlaza solo cuando
     * complete el registro, ver RegisteredUserController).
     */
    public function inviteCollaborator(Diagram $diagram, User $inviter, string $email, string $role = 'editor'): CollaborationInvitation
    {
        $invitedUser = User::where('email', $email)->first();

        $invitation = $diagram->invitations()->create([
            'inviter_id' => $inviter->id,
            'invitee_email' => $email,
            'invitee_user_id' => $invitedUser?->id,
            'role' => $role,
        ]);

        app(ActivityLog::class)->system($diagram->id, $inviter, 'INVITE', "invitó a {$email} como {$role}");

        if ($invitedUser) {
            $invitedUser->notify(new \App\Notifications\DiagramCollaborationInvite($invitation));
            // Y en el celular (bandeja de la app + push).
            \App\Jobs\NotifyInvitation::dispatch((string) $invitation->id);
        } else {
            \Illuminate\Support\Facades\Mail::to($email)->send(new \App\Mail\DiagramInvitationMail($invitation));
        }

        return $invitation;
    }

    /**
     * Aceptar una invitación de colaboración: reutiliza la sesión activa del
     * diagrama o crea una, y añade/reactiva al usuario invitado como
     * colaborador con el rol acordado en la invitación.
     */
    public function acceptInvitation(CollaborationInvitation $invitation, User $user): DiagramSession
    {
        $diagram = $invitation->diagram;
        $session = $diagram->activeSession() ?? $this->createCollaborativeSession($diagram, [], $diagram->user);

        $existingCollaborator = $session->collaborators()->where('user_id', $user->id)->first();

        if ($existingCollaborator) {
            $existingCollaborator->update(['status' => 'online', 'last_seen_at' => now()]);
        } else {
            $session->addCollaborator($user, $invitation->role);
        }

        $invitation->update(['status' => 'accepted', 'responded_at' => now()]);

        app(ActivityLog::class)->system($diagram->id, $user, 'INVITE_ACCEPT', "aceptó la invitación como {$invitation->role}");

        return $session;
    }

    /**
     * Query base compartida por getOwnedDiagrams()/getSharedDiagrams(): el
     * eager-loading y los filtros de búsqueda/visibilidad/template son
     * iguales en ambas, lo único que cambia es el criterio de "a cuáles
     * diagramas pertenece esto".
     */
    private function baseDiagramsQuery(array $filters = [])
    {
        $query = Diagram::with([
            'user',
            // Para la tarjeta del dashboard: dueño, colaboradores y quién
            // está en línea, sin disparar una consulta extra por diagrama.
            'sessions' => fn ($q) => $q->where('status', 'active')->latest()->with('collaborators.user'),
        ]);

        if (isset($filters['visibility'])) {
            $query->where('visibility', $filters['visibility']);
        }

        if (isset($filters['is_template'])) {
            $query->where('is_template', $filters['is_template']);
        }

        if (isset($filters['search'])) {
            $search = $filters['search'];
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                  ->orWhere('description', 'like', "%{$search}%");
            });
        }

        return $query;
    }

    /** Diagramas creados por el propio usuario — sección "Mis diagramas". */
    public function getOwnedDiagrams(User $user = null, array $filters = []): \Illuminate\Pagination\LengthAwarePaginator
    {
        $user = $user ?? Auth::user();

        return $this->baseDiagramsQuery($filters)
            ->where('user_id', $user->id)
            ->orderBy('last_saved_at', 'desc')
            ->paginate($filters['per_page'] ?? 15, ['*'], 'page');
    }

    /**
     * Diagramas de OTROS donde el usuario es colaborador invitado (no
     * incluye diagramas públicos que nunca lo invitaron — ver sección
     * "Compartidos conmigo").
     */
    public function getSharedDiagrams(User $user = null, array $filters = []): \Illuminate\Pagination\LengthAwarePaginator
    {
        $user = $user ?? Auth::user();

        return $this->baseDiagramsQuery($filters)
            ->where('user_id', '!=', $user->id)
            ->whereHas('sessions.collaborators', function ($subQ) use ($user) {
                $subQ->where('user_id', $user->id);
            })
            ->orderBy('last_saved_at', 'desc')
            ->paginate($filters['per_page'] ?? 15, ['*'], 'shared_page');
    }

    /**
     * Exportar diagrama a diferentes formatos
     */
    public function exportDiagram(Diagram $diagram, string $format = 'json'): array
    {
        switch ($format) {
            case 'json':
                return [
                    'success' => true,
                    'data' => $diagram->data,
                    'filename' => $diagram->slug . '.json',
                    'content_type' => 'application/json'
                ];

            case 'png':
                // Placeholder - se implementará con html2canvas
                return [
                    'success' => false,
                    'message' => 'Exportación PNG próximamente'
                ];

            case 'java':
                // Placeholder - se implementará en días siguientes
                return [
                    'success' => false,
                    'message' => 'Generación de código Java próximamente'
                ];

            default:
                return [
                    'success' => false,
                    'message' => 'Formato no soportado'
                ];
        }
    }

    /**
     * Limpiar sesiones expiradas
     */
    public function cleanupExpiredSessions(): int
    {
        $expiredSessions = DiagramSession::where('status', 'active')
            ->where('invite_expires_at', '<', now())
            ->get();

        $count = 0;
        foreach ($expiredSessions as $session) {
            $session->end();
            $count++;
        }

        Log::info('Sesiones expiradas limpiadas', ['count' => $count]);

        return $count;
    }

    /**
     * Estadísticas generales del sistema
     */
    public function getSystemStats(): array
    {
        return [
            'total_diagrams' => Diagram::count(),
            'active_sessions' => DiagramSession::where('status', 'active')->count(),
            'online_collaborators' => Collaborator::where('status', 'online')
                ->where('last_seen_at', '>', now()->subMinutes(5))
                ->count(),
            'diagrams_created_today' => Diagram::whereDate('created_at', today())->count(),
            'most_active_user' => User::find(
                Diagram::all(['user_id'])->countBy('user_id')->sortDesc()->keys()->first()
            )?->name ?? 'N/A'
        ];
    }
}
