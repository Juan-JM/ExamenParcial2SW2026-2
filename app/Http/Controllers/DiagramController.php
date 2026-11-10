<?php
// app/Http/Controllers/DiagramController.php

namespace App\Http\Controllers;

use App\Models\Diagram;
use App\Services\DiagramService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\Response;

class DiagramController extends Controller
{
    protected $diagramService;

    public function __construct(DiagramService $diagramService)
    {
        $this->diagramService = $diagramService;
    }

    /**
     * Mostrar lista de diagramas del usuario
     */
    public function index(Request $request)
    {
        $filters = [
            'search' => $request->get('search'),
            'visibility' => $request->get('visibility'),
            'is_template' => $request->get('templates') === '1',
            'per_page' => 12
        ];

        $diagrams = $this->diagramService->getOwnedDiagrams(Auth::user(), $filters);
        $sharedDiagrams = $this->diagramService->getSharedDiagrams(Auth::user(), $filters);

        // Estadísticas del usuario
        $stats = [
            'total' => Auth::user()->diagrams()->count(),
            'private' => Auth::user()->diagrams()->where('visibility', 'private')->count(),
            'shared' => Auth::user()->diagrams()->where('visibility', 'shared')->count(),
            'templates' => Auth::user()->diagrams()->where('is_template', true)->count(),
        ];

        return view('diagrams.index', compact('diagrams', 'sharedDiagrams', 'stats', 'filters'));
    }

    /**
     * Mostrar el editor para un nuevo diagrama
     */
    public function create()
    {
        return view('diagrams.editor');
    }

    /**
     * Almacenar un nuevo diagrama
     */
    public function store(Request $request)
    {
        $request->validate([
            'title' => 'required|string|max:255',
            'description' => 'nullable|string|max:1000',
            'visibility' => 'in:private,public,shared'
        ]);

        try {
            $diagram = $this->diagramService->create([
                'title' => $request->title,
                'description' => $request->description,
                'visibility' => $request->visibility ?? 'private'
            ]);

            if ($request->wantsJson()) {
                return response()->json([
                    'success' => true,
                    'diagram' => $diagram,
                    'redirect' => route('diagrams.editor', $diagram->slug)
                ]);
            }

            return redirect()
                ->route('diagrams.editor', $diagram->slug)
                ->with('success', 'Diagrama creado exitosamente');

        } catch (\Exception $e) {
            Log::error('Error creating diagram', ['error' => $e->getMessage()]);

            if ($request->wantsJson()) {
                return response()->json([
                    'success' => false,
                    'error' => 'Error al crear el diagrama'
                ], 500);
            }

            return redirect()->back()
                ->withInput()
                ->withErrors(['error' => 'Error al crear el diagrama']);
        }
    }

    /**
     * Mostrar el editor para un diagrama existente
     */
    public function edit(Diagram $diagram)
    {
        // Verificar permisos
        if (!$diagram->canBeEditedBy(Auth::user())) {
            return redirect()->route('diagrams.index')
                ->with('error', 'No tienes permisos para editar ese diagrama.');
        }

        return view('diagrams.editor', compact('diagram'));
    }

    /**
     * Actualizar un diagrama existente
     */
    public function update(Request $request, Diagram $diagram)
    {
        // Verificar permisos
        if (!$diagram->canBeEditedBy(Auth::user())) {
            abort(403);
        }

        $request->validate([
            'title' => 'required|string|max:255',
            'description' => 'nullable|string|max:1000',
            'data' => 'nullable|json',
            'settings' => 'nullable|json',
            'visibility' => 'in:private,public,shared'
        ]);

        try {
            $updateData = [
                'title' => $request->title,
                'description' => $request->description,
                'visibility' => $request->visibility
            ];

            if ($request->has('data')) {
                $updateData['data'] = json_decode($request->data, true);
            }

            if ($request->has('settings')) {
                $updateData['settings'] = json_decode($request->settings, true);
            }

            $success = $this->diagramService->save($diagram, $updateData, $request->has('data') ? \App\Models\DiagramSnapshot::MANUAL : null);

            if ($request->wantsJson()) {
                return response()->json([
                    'success' => $success,
                    'diagram' => $diagram->fresh()
                ]);
            }

            return redirect()->back()->with('success', 'Diagrama actualizado exitosamente');

        } catch (\Exception $e) {
            Log::error('Error updating diagram', [
                'diagram_id' => $diagram->id,
                'error' => $e->getMessage()
            ]);

            if ($request->wantsJson()) {
                return response()->json([
                    'success' => false,
                    'error' => 'Error al actualizar el diagrama'
                ], 500);
            }

            return redirect()->back()->withErrors(['error' => 'Error al actualizar el diagrama']);
        }
    }

    /**
     * Mostrar un diagrama específico (solo lectura)
     */
    public function show(Diagram $diagram)
    {
        // Verificar permisos de visualización. OJO: a diferencia de
        // canBeViewedBy() (pensado para gatear acciones EN VIVO dentro del
        // editor, por eso exige status='online' en la sesión activa), esta
        // es una página de solo lectura a la que un colaborador debe poder
        // entrar aunque no esté conectado en este momento — con
        // canBeViewedBy() un colaborador real que abre el link "Ver" sin
        // tener el editor abierto en otra pestaña recibía 403 igual.
        if ($diagram->visibility === 'private' && !$diagram->canBeAccessedBy(Auth::user())) {
            return redirect()->route('diagrams.index')
                ->with('error', 'No tienes permisos para ver ese diagrama.');
        }

        $user = Auth::user();

        // Si hay sesión colaborativa y somos parte de ella, la vista se une al
        // canal de presencia y ve los cambios en vivo (mismo mecanismo que el
        // editor, en modo "solo ver"). Si no, se actualiza en cada guardado.
        $session = $diagram->activeSession();
        $sessionId = null;
        $role = null;

        if ($session) {
            if ($diagram->user_id === $user->id) {
                $sessionId = $session->session_id;
                $role = 'owner';
            } elseif ($collaborator = $session->collaborators()->where('user_id', $user->id)->first()) {
                $sessionId = $session->session_id;
                $role = $collaborator->role;
            }
        }

        return view('diagrams.viewer', [
            'diagram' => $diagram,
            'sessionId' => $sessionId,
            'canEdit' => $diagram->canBeEditedBy($user),
            'embed' => request()->boolean('embed'),
            'role' => $role,
        ]);
    }

    /**
     * Duplicar un diagrama
     */
    public function duplicate(Diagram $diagram)
    {
        try {
            // Verificar que pueda ver el diagrama
            if ($diagram->visibility === 'private' && $diagram->user_id !== Auth::id()) {
                abort(403);
            }

            $duplicate = $this->diagramService->duplicate($diagram);

            return redirect()
                ->route('diagrams.editor', $duplicate->slug)
                ->with('success', 'Diagrama duplicado exitosamente');

        } catch (\Exception $e) {
            Log::error('Error duplicating diagram', [
                'diagram_id' => $diagram->id,
                'error' => $e->getMessage()
            ]);

            return redirect()->back()->withErrors(['error' => 'Error al duplicar el diagrama']);
        }
    }

    /**
     * Eliminar un diagrama
     */
    public function destroy(Diagram $diagram)
    {
        // Solo el propietario puede eliminar
        if ($diagram->user_id !== Auth::id()) {
            abort(403);
        }

        try {
            // Terminar sesiones activas
            $diagram->sessions()->where('status', 'active')->each(function($session) {
                $session->end();
            });

            $title = $diagram->title;
            $diagram->delete();

            return redirect()
                ->route('diagrams.index')
                ->with('success', "Diagrama '{$title}' eliminado exitosamente");

        } catch (\Exception $e) {
            Log::error('Error deleting diagram', [
                'diagram_id' => $diagram->id,
                'error' => $e->getMessage()
            ]);

            return redirect()->back()->withErrors(['error' => 'Error al eliminar el diagrama']);
        }
    }

    /**
     * Exportar diagrama en diferentes formatos
     */
    public function export(Request $request, Diagram $diagram)
    {
        $request->validate([
            'format' => 'required|in:json,png,svg,java,xmi'
        ]);

        try {
            $result = $this->diagramService->exportDiagram($diagram, $request->format);

            if (!$result['success']) {
                return response()->json($result, 400);
            }

            // Según el formato, retornar diferente respuesta
            switch ($request->format) {
                case 'json':
                    return response()->json($result['data'])
                        ->header('Content-Disposition', 'attachment; filename="' . $result['filename'] . '"');

                case 'png':
                case 'svg':
                    // Se implementará con frontend (html2canvas)
                    return response()->json([
                        'success' => false,
                        'message' => 'Use la funcionalidad de exportación del editor'
                    ]);

                case 'java':
                case 'xmi':
                    // Se implementará en los próximos días
                    return response()->json([
                        'success' => false,
                        'message' => 'Funcionalidad próximamente disponible'
                    ]);

                default:
                    return response()->json([
                        'success' => false,
                        'message' => 'Formato no soportado'
                    ], 400);
            }

        } catch (\Exception $e) {
            Log::error('Error exporting diagram', [
                'diagram_id' => $diagram->id,
                'format' => $request->format,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'error' => 'Error al exportar el diagrama'
            ], 500);
        }
    }

    /**
     * API endpoint para auto-guardado
     */
    public function autosave(Request $request, Diagram $diagram)
    {
        // Verificar permisos
        if (!$diagram->canBeEditedBy(Auth::user())) {
            return response()->json(['success' => false, 'error' => 'Sin permisos'], 403);
        }

        $request->validate([
            'data' => 'required|json'
        ]);

        try {
            $this->diagramService->save($diagram, [
                'data' => json_decode($request->data, true)
            ]);

            return response()->json([
                'success' => true,
                'last_saved' => now()->toISOString(),
                'version' => $diagram->fresh()->version
            ]);

        } catch (\Exception $e) {
            Log::warning('Autosave failed', [
                'diagram_id' => $diagram->id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'error' => 'Auto-guardado falló'
            ], 500);
        }
    }

    /**
     * Obtener estadísticas del diagrama
     */
    public function stats(Diagram $diagram)
    {
        // Antes solo dejaba pasar al dueño exacto en un diagrama privado —
        // un colaborador real (invitado, sesión activa) recibía un 403 aquí,
        // lo cual devuelve HTML de error en vez de JSON y rompía el fetch()
        // que carga el título en el breadcrumb (quedaba en "Cargando..."
        // para siempre para cualquiera que no fuera el dueño).
        if ($diagram->visibility === 'private' && !$diagram->canBeViewedBy(Auth::user())) {
            abort(403);
        }

        $data = $diagram->data ?? [];
        $cells = collect($data['cells'] ?? []);

        // El editor crea clases e interfaces como 'standard.Rectangle' (con
        // `umlData` adjunto) y toda relación como 'standard.Link' (con
        // `relationData` adjunto) — nunca existieron tipos JointJS 'uml.*'.
        $elements = $cells->filter(fn ($cell) => ($cell['type'] ?? null) === 'standard.Rectangle' && isset($cell['umlData']));
        $links = $cells->filter(fn ($cell) => ($cell['type'] ?? null) === 'standard.Link' && isset($cell['relationData']));

        $countLinksOfType = fn (string $type) => $links->filter(fn ($cell) => ($cell['relationData']['type'] ?? null) === $type)->count();

        $stats = [
            'id' => $diagram->id,
            'title' => $diagram->title,
            'total_elements' => $cells->count(),
            'classes' => $elements->filter(fn ($cell) => ($cell['umlData']['type'] ?? 'class') === 'class')->count(),
            'interfaces' => $elements->filter(fn ($cell) => ($cell['umlData']['type'] ?? null) === 'interface')->count(),
            'associations' => $countLinksOfType('association'),
            'inheritances' => $countLinksOfType('inheritance'),
            'aggregations' => $countLinksOfType('aggregation'),
            'compositions' => $countLinksOfType('composition'),
            'version' => $diagram->version,
            'created_at' => $diagram->created_at->toISOString(),
            'updated_at' => $diagram->updated_at->toISOString(),
            'last_saved_at' => $diagram->last_saved_at?->toISOString(),
        ];

        return response()->json($stats);
    }
}
