<?php
// app/Livewire/DiagramEditor.php - ACTUALIZADO CON PERSISTENCIA

namespace App\Livewire;

use App\Models\Diagram;
use App\Models\User;
use App\Services\DiagramService;
use Livewire\Attributes\On;
use Livewire\Component;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

class DiagramEditor extends Component
{
    // Props principales
    public $diagramId = null;
    public $diagram = null;
    public $diagramData = '[]';
    public $diagramTitle = 'Nuevo Diagrama UML';
    public $diagramDescription = '';

    // Estado del editor
    public $elementCount = 0;
    public $lastSaved = null;
    public $isDirty = false;
    public $autoSaveEnabled = true;

    // Configuración
    public $settings = [
        'zoom' => 1,
        'panX' => 0,
        'panY' => 0,
        'gridSize' => 20,
        'snapToGrid' => true
    ];

    // Modal "Compartir"
    public bool $shareModalOpen = false;
    public string $inviteEmail = '';
    public string $inviteRole = 'editor';
    public bool $inviteCanEdit = true;

    protected $diagramService;

    public function boot(DiagramService $diagramService)
    {
        $this->diagramService = $diagramService;
    }

    public function mount($diagramId = null)
    {
        $this->diagramId = $diagramId;

        if ($diagramId) {
            $this->loadExistingDiagram($diagramId);
        } else {
            $this->initializeNewDiagram();
        }

        Log::info("DiagramEditor mounted", [
            'diagramId' => $this->diagramId,
            'user_id' => Auth::id()
        ]);
    }

    private function loadExistingDiagram($diagramId)
    {
        $this->diagram = $this->diagramService->loadById($diagramId);

        if (!$this->diagram) {
            session()->flash('error', 'Diagrama no encontrado o sin permisos');
            return redirect()->route('diagrams.index');
        }

        $this->diagramData = json_encode($this->diagram->data);
        $this->diagramTitle = $this->diagram->title;
        $this->diagramDescription = $this->diagram->description ?? '';
        $this->settings = $this->diagram->settings ?? $this->settings;
        $this->elementCount = $this->diagram->elements_count;
        $this->lastSaved = $this->diagram->last_saved_at;
        $this->isDirty = false;
    }

    private function initializeNewDiagram()
    {
        $this->diagramData = json_encode(['cells' => []]);
        $this->diagramTitle = 'Nuevo Diagrama UML';
        $this->diagramDescription = '';
        $this->elementCount = 0;
        $this->isDirty = false;
    }

    /**
     * Guardar diagrama - FUNCIÓN PRINCIPAL
     *
     * Ya NO recibe (ni toca) el título — el diagrama existe desde que se
     * entra al editor (ver la ruta 'diagrams.editor' en routes/web.php, que
     * lo crea de una en vez de dejarlo en un estado "borrador" hasta el
     * primer guardado), así que $this->diagram siempre está seteado acá. El
     * título es responsabilidad exclusiva de updateTitle() (clic para
     * renombrar): antes este método TAMBIÉN recibía un $title desde el
     * botón "Guardar" (window.saveFromButton → DiagramSaveManager.js) y lo
     * pisaba encima del nombre real en cada guardado — si renombrabas el
     * diagrama y después apretabas "Guardar", el nombre volvía al que
     * tenía la primera vez que se guardó.
     */
    #[On('save-diagram')]
    public function saveDiagram($diagramData = null)
    {
        try {
            if (!Auth::check()) {
                session()->flash('error', 'Debes iniciar sesión para guardar');
                return;
            }

            if (!$this->diagram) {
                // No debería pasar nunca en el flujo normal — el diagrama ya
                // existe antes de llegar acá. Si esto se dispara, algo cargó
                // el editor sin uno (ver mount()).
                session()->flash('error', 'No hay un diagrama para guardar');
                return;
            }

            if (!$this->diagram->canBeEditedBy(Auth::user())) {
                session()->flash('error', 'No tienes permiso para editar este diagrama');
                return;
            }

            // Actualizar datos locales
            if ($diagramData) {
                $this->diagramData = $diagramData;
                $this->updateElementCount($diagramData);
            }

            // Guardado manual (botón "Guardar" o Ctrl+S): queda como versión.
            $success = $this->diagramService->save($this->diagram, [
                'data' => json_decode($this->diagramData, true),
                'settings' => $this->settings,
                'description' => $this->diagramDescription
            ], \App\Models\DiagramSnapshot::MANUAL);

            $message = 'Diagrama actualizado exitosamente';

            if ($success) {
                $this->lastSaved = now();
                $this->isDirty = false;
                session()->flash('message', $message);

                // Queda en la auditoría y avisa al equipo en el celular.
                app(\App\Services\Agent\ActivityLog::class)->system($this->diagram->id, Auth::user(), 'SAVE', 'guardó el diagrama');

                Log::info("Diagram saved successfully", [
                    'diagram_id' => $this->diagram->id,
                    'title' => $this->diagramTitle,
                    'elements_count' => $this->elementCount
                ]);
            } else {
                throw new \Exception('Error al guardar en la base de datos');
            }

        } catch (\Exception $e) {
            Log::error("Error saving diagram", [
                'error' => $e->getMessage(),
                'user_id' => Auth::id()
            ]);

            session()->flash('error', 'Error al guardar: ' . $e->getMessage());
        }
    }

    /**
     * Auto-guardado silencioso
     */
    #[On('auto-save-diagram')]
    public function autoSave($diagramData)
    {
        if (!$this->autoSaveEnabled || !$this->diagram) {
            return;
        }

        if (!$this->diagram->canBeEditedBy(Auth::user())) {
            return;
        }

        try {
            $this->diagramService->save($this->diagram, [
                'data' => json_decode($diagramData, true)
            ]);

            $this->lastSaved = now();
            $this->isDirty = false;

            Log::debug("Auto-save performed", ['diagram_id' => $this->diagram->id]);

        } catch (\Exception $e) {
            Log::warning("Auto-save failed", [
                'diagram_id' => $this->diagram->id,
                'error' => $e->getMessage()
            ]);
        }
    }

    /**
     * Modal "Compartir": invitar colaboradores por email. El botón que lo
     * dispara vive en el <nav> del blade padre (fuera del árbol de este
     * componente Livewire), así que además de wire:click se escucha como
     * evento de navegador para poder dispararlo desde ahí.
     */
    #[On('open-share-modal')]
    public function openShareModal(): void
    {
        if (!$this->diagram || $this->diagram->user_id !== Auth::id()) {
            return;
        }

        $this->shareModalOpen = true;
    }

    public function closeShareModal(): void
    {
        $this->shareModalOpen = false;
        $this->inviteEmail = '';
        $this->inviteRole = 'editor';
        $this->inviteCanEdit = true;
    }

    public function sendInvitation(): void
    {
        if (!$this->diagram || $this->diagram->user_id !== Auth::id()) {
            return;
        }

        $this->validate([
            'inviteEmail' => 'required|email',
        ]);

        $alreadyPending = $this->diagram->invitations()
            ->where('invitee_email', $this->inviteEmail)
            ->where('status', 'pending')
            ->exists();

        if ($alreadyPending) {
            $this->addError('inviteEmail', 'Ya hay una invitación pendiente para ese correo.');
            return;
        }

        $role = $this->inviteCanEdit ? 'editor' : 'viewer';
        $this->diagramService->inviteCollaborator($this->diagram, Auth::user(), $this->inviteEmail, $role);

        session()->flash('message', "Invitación enviada a {$this->inviteEmail}");
        $this->inviteEmail = '';
    }

    /**
     * Cambiar el permiso de un colaborador ya conectado, en cualquier
     * momento — no solo el rol inicial con el que se lo invitó.
     */
    public function updateCollaboratorRole(string $collaboratorId, bool $canEdit): void
    {
        if (!$this->diagram || $this->diagram->user_id !== Auth::id()) {
            return;
        }

        $session = $this->diagram->activeSession();
        $collaborator = $session?->collaborators()->find($collaboratorId);

        if ($collaborator && $collaborator->role !== 'owner' && $collaborator->user_id) {
            $role = $canEdit ? 'editor' : 'viewer';
            $collaborator->update(['role' => $role]);

            app(\App\Services\Agent\ActivityLog::class)->system($this->diagram->id, Auth::user(), 'ROLE_CHANGE', "cambió el rol de {$collaborator->display_name} a {$role}");

            // El colaborador puede tener el diagrama abierto AHORA MISMO: sin
            // esto, seguiría pudiendo editar (o viendo un botón "Editar" que
            // ya no le corresponde) hasta que recargara la página por su cuenta.
            broadcast(new \App\Events\CollaboratorRoleChanged($session->session_id, $collaborator->user_id, $role))->toOthers();
        }
    }

    /** Revocar el acceso de un colaborador (no solo bajarle el rol). */
    public function removeCollaborator(string $collaboratorId): void
    {
        if (!$this->diagram || $this->diagram->user_id !== Auth::id()) {
            return;
        }

        $session = $this->diagram->activeSession();
        $collaborator = $session?->collaborators()->find($collaboratorId);

        if ($collaborator && $collaborator->role !== 'owner') {
            // Método de dominio (no borrado directo): ya se encarga de
            // marcarlo offline, liberar un lock que tuviera tomado, y avisar
            // por broadcast (UserLeftSession) — el propio cliente afectado
            // escucha ese evento y se saca solo del editor si sigue conectado.
            $session->removeCollaborator($collaboratorId);

            app(\App\Services\Agent\ActivityLog::class)->system($this->diagram->id, Auth::user(), 'COLLABORATOR_REMOVE', "quitó a {$collaborator->display_name} del diagrama");
            session()->flash('message', 'Colaborador eliminado');
        }
    }

    /** Usuarios registrados que calzan con lo tipeado, para el autocompletado del modal "Compartir". */
    public function getMatchingUsersProperty()
    {
        if (strlen($this->inviteEmail) < 3) {
            return collect();
        }

        return User::where('email', 'like', "%{$this->inviteEmail}%")
            ->where('email', '!=', $this->inviteEmail)
            ->where('id', '!=', Auth::id())
            ->limit(5)
            ->get(['id', 'name', 'email']);
    }

    public function selectUserForInvite(string $userId): void
    {
        $user = User::find($userId);
        if ($user) {
            $this->inviteEmail = $user->email;
        }
    }

    /** Colaboradores activos + invitaciones pendientes, para el modal "Compartir". */
    public function getCollaboratorsProperty()
    {
        return $this->diagram?->activeSession()?->collaborators()->with('user')->get() ?? collect();
    }

    public function getPendingInvitationsProperty()
    {
        return $this->diagram?->invitations()->where('status', 'pending')->latest()->get() ?? collect();
    }

    /**
     * Actualizar título del diagrama
     */
    public function updateTitle()
    {
        if ($this->diagram && !$this->diagram->canBeEditedBy(Auth::user())) {
            $this->diagramTitle = $this->diagram->title;
            return;
        }

        $this->validate([
            'diagramTitle' => 'required|string|max:255'
        ]);

        if ($this->diagram) {
            $this->diagramService->save($this->diagram, [
                'title' => $this->diagramTitle
            ]);
        }

        $this->isDirty = true;
        session()->flash('message', 'Título actualizado');
    }

    /**
     * Actualizar descripción
     */
    public function updateDescription()
    {
        if ($this->diagram) {
            $this->diagramService->save($this->diagram, [
                'description' => $this->diagramDescription
            ]);
        }

        $this->isDirty = true;
        session()->flash('message', 'Descripción actualizada');
    }

    /**
     * Limpiar diagrama
     */
    public function clearDiagram()
    {
        $this->diagramData = json_encode(['cells' => []]);
        $this->elementCount = 0;
        $this->isDirty = true;

        if ($this->diagram) {
            app(\App\Services\Agent\ActivityLog::class)->system($this->diagram->id, Auth::user(), 'CLEAR_DIAGRAM', 'limpió el diagrama');
        }

        $this->dispatch('clear-diagram');
        session()->flash('message', 'Diagrama limpiado');
    }

    /**
     * Duplicar diagrama
     */
    public function duplicateDiagram()
    {
        if (!$this->diagram) {
            session()->flash('error', 'Guarda el diagrama primero');
            return;
        }

        try {
            $duplicate = $this->diagramService->duplicate(
                $this->diagram,
                $this->diagramTitle . ' (Copia)'
            );

            session()->flash('message', 'Diagrama duplicado exitosamente');

            // Redirigir al duplicado
            return redirect()->route('diagrams.editor', ['diagram' => $duplicate->slug]);

        } catch (\Exception $e) {
            session()->flash('error', 'Error al duplicar: ' . $e->getMessage());
        }
    }

    /**
     * Crear sesión colaborativa
     */
    public function createCollaborativeSession()
    {
        if (!$this->diagram) {
            session()->flash('error', 'Guarda el diagrama primero');
            return;
        }

        try {
            $session = $this->diagramService->createCollaborativeSession($this->diagram, [
                'allow_anonymous' => true,
                'max_collaborators' => 10
            ]);

            $inviteUrl = $session->generateInviteUrl();

            session()->flash('message', 'Sesión colaborativa creada');
            session()->flash('invite_url', $inviteUrl);

            $this->dispatch('session-created', [
                'sessionId' => $session->session_id,
                'inviteUrl' => $inviteUrl
            ]);

        } catch (\Exception $e) {
            session()->flash('error', 'Error creando sesión: ' . $e->getMessage());
        }
    }

    /**
     * Exportar diagrama
     */
    public function exportDiagram($format = 'json')
    {
        if (!$this->diagram) {
            session()->flash('error', 'Guarda el diagrama primero');
            return;
        }

        try {
            $result = $this->diagramService->exportDiagram($this->diagram, $format);

            if ($result['success']) {
                $this->dispatch('download-export', $result);
                session()->flash('message', 'Exportación lista para descarga');
            } else {
                session()->flash('error', $result['message']);
            }

        } catch (\Exception $e) {
            session()->flash('error', 'Error al exportar: ' . $e->getMessage());
        }
    }

    /**
     * Alternar auto-guardado
     */
    public function toggleAutoSave()
    {
        $this->autoSaveEnabled = !$this->autoSaveEnabled;

        $message = $this->autoSaveEnabled ? 'Auto-guardado activado' : 'Auto-guardado desactivado';
        session()->flash('message', $message);
    }

    /**
     * Obtener estadísticas del diagrama
     */
    public function getStats()
    {
        try {
            $data = json_decode($this->diagramData, true) ?? [];
            $cells = $data['cells'] ?? [];

            return [
                'totalElements' => count($cells),
                'classes' => collect($cells)->where('type', 'like', '%Class%')->count(),
                'relationships' => collect($cells)->where('type', 'like', '%Link%')->count(),
                'lastSaved' => $this->lastSaved?->diffForHumans(),
                'isDirty' => $this->isDirty,
                'autoSaveEnabled' => $this->autoSaveEnabled,
                'diagramId' => $this->diagramId
            ];

        } catch (\Exception $e) {
            Log::error("Error getting stats", ['error' => $e->getMessage()]);
            return ['error' => 'Error obteniendo estadísticas'];
        }
    }

    private function updateElementCount($diagramData)
    {
        try {
            $data = json_decode($diagramData, true);
            $this->elementCount = count($data['cells'] ?? []);
        } catch (\Exception $e) {
            $this->elementCount = 0;
        }
    }

/**
 * Render del componente
 */
public function render()
{
    // Sesión colaborativa: además del flujo por invite-link (guardado en la
    // sesión de Laravel al unirse), el propio dueño abriendo su diagrama debe
    // activar el modo colaborativo si ya existe una sesión activa para él.
    $collaborationSession = session('collaboration_session');
    $collaboratorRole = null;

    if (!$collaborationSession && $this->diagram) {
        $activeSession = $this->diagram->activeSession();

        if ($activeSession) {
            if ($this->diagram->user_id === Auth::id()) {
                $collaborationSession = $activeSession->session_id;
                $collaboratorRole = 'owner';
            } else {
                $role = $activeSession->collaborators()
                    ->where('user_id', Auth::id())
                    ->value('role');

                if ($role) {
                    $collaborationSession = $activeSession->session_id;
                    $collaboratorRole = $role;
                }
            }
        }
    } elseif ($collaborationSession && $this->diagram) {
        $collaboratorRole = $this->diagram->user_id === Auth::id()
            ? 'owner'
            : $this->diagram->activeSession()?->collaborators()->where('user_id', Auth::id())->value('role');
    }

    return view('livewire.diagram-editor', [
        'stats' => $this->getStats(),
        'canExport' => $this->diagram && !empty($this->diagramData) && $this->diagramData !== '[]',
        'collaboratorRole' => $collaboratorRole,
        'hasChanges' => $this->isDirty,
        'isNewDiagram' => !$this->diagram,
        'diagramId' => $this->diagramId,
        'diagramData' => $this->diagramData,
        'diagramTitle' => $this->diagramTitle,
        // NUEVO: Pasar sesión colaborativa a la vista
        'collaborationSession' => $collaborationSession
    ]);
}
}
