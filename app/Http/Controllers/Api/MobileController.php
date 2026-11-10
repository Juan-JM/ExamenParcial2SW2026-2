<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityEntry;
use App\Models\AiMessage;
use App\Models\AppNotification;
use App\Models\Collaborator;
use App\Models\DeviceToken;
use App\Models\Diagram;
use App\Models\DiagramSession;
use App\Models\User;
use App\Models\WorkSession;
use App\Services\Agent\CollaborativeAgent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * API de la app móvil, que es informativa: ver el diagrama, la actividad y
 * preguntarle a la IA. No hay ninguna ruta que edite el diagrama.
 */
class MobileController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'device_name' => ['required', 'string', 'max:120'],
        ]);

        $user = User::where('email', $validated['email'])->first();

        if (!$user || !Hash::check($validated['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => 'Correo o contraseña incorrectos.']);
        }

        return response()->json([
            'token' => $user->createToken($validated['device_name'])->plainTextToken,
            'user' => ['id' => $user->id, 'name' => $user->name, 'email' => $user->email],
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['ok' => true]);
    }

    public function diagrams(Request $request): JsonResponse
    {
        $user = $request->user();

        $sessionIds = Collaborator::where('user_id', $user->id)->pluck('diagram_session_id')->all();
        $sharedIds = DiagramSession::whereIn('id', $sessionIds)->pluck('diagram_id')->all();

        $diagrams = Diagram::where('user_id', $user->id)
            ->orWhereIn('id', $sharedIds)
            ->orderBy('last_saved_at', 'desc')
            ->get(['title', 'slug', 'user_id', 'classes_count', 'relationships_count', 'version', 'last_saved_at']);

        return response()->json([
            'diagrams' => $diagrams->map(fn (Diagram $diagram) => [
                'id' => $diagram->id,
                'title' => $diagram->title,
                'isOwner' => $diagram->user_id === $user->id,
                'classesCount' => $diagram->classes_count,
                'relationshipsCount' => $diagram->relationships_count,
                'version' => $diagram->version,
                'lastSavedAt' => $diagram->last_saved_at?->toISOString(),
                'isLive' => WorkSession::where('diagram_id', $diagram->id)->where('is_open', true)->exists(),
            ])->values()->all(),
        ]);
    }

    public function diagram(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeMember($request, $diagram);

        $classes = [];
        $relations = [];
        $names = [];

        foreach ($diagram->data['cells'] ?? [] as $cell) {
            if (isset($cell['umlData'])) {
                $names[$cell['id']] = $cell['umlData']['className'] ?? 'SinNombre';
                $classes[] = [
                    'id' => $cell['id'],
                    'name' => $names[$cell['id']],
                    'kind' => $cell['umlData']['type'] ?? 'class',
                    'attributes' => $cell['umlData']['attributes'] ?? [],
                    'methods' => $cell['umlData']['methods'] ?? [],
                    'x' => $cell['position']['x'] ?? 0,
                    'y' => $cell['position']['y'] ?? 0,
                    'width' => $cell['size']['width'] ?? 180,
                    'height' => $cell['size']['height'] ?? 120,
                ];
            }
        }

        foreach ($diagram->data['cells'] ?? [] as $cell) {
            $relation = $cell['relationData'] ?? null;
            $source = $cell['source']['id'] ?? null;
            $target = $cell['target']['id'] ?? null;

            if ($relation && isset($names[$source], $names[$target])) {
                $relations[] = [
                    'id' => $cell['id'],
                    'source' => $source,
                    'target' => $target,
                    'type' => $relation['type'] ?? 'association',
                    'name' => $relation['name'] ?? '',
                    'sourceMultiplicity' => $relation['sourceMultiplicity'] ?? '',
                    'targetMultiplicity' => $relation['targetMultiplicity'] ?? '',
                ];
            }
        }

        $session = WorkSession::where('diagram_id', $diagram->id)->where('is_open', true)->first();

        return response()->json([
            'id' => $diagram->id,
            'title' => $diagram->title,
            'version' => $diagram->version,
            'lastSavedAt' => $diagram->last_saved_at?->toISOString(),
            'classes' => $classes,
            'relations' => $relations,
            'session' => $session?->toClientArray(),
            'present' => $session ? $session->attendees()->whereNull('gone_at')->pluck('name')->all() : [],
            'agentName' => config('services.ai.agent.name'),
        ]);
    }

    public function activity(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeMember($request, $diagram);

        $validated = $request->validate(['before' => ['sometimes', 'date']]);
        $query = ActivityEntry::where('diagram_id', $diagram->id)->orderBy('created_at', 'desc');

        if (isset($validated['before'])) {
            $query->where('created_at', '<', Carbon::parse($validated['before']));
        }

        return response()->json(['entries' => $query->limit(50)->get()->map->toClientArray()->all()]);
    }

    public function messages(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeMember($request, $diagram);

        // La conversación de la sesión en curso, igual que en el editor.
        $sessionId = WorkSession::where('diagram_id', $diagram->id)->where('is_open', true)->value('id');

        $messages = AiMessage::ofConversation($diagram->id, $sessionId)
            ->orderBy('created_at', 'desc')
            ->limit(50)
            ->get()
            ->reverse()
            ->values();

        return response()->json(['messages' => $messages->map->toClientArray()->all()]);
    }

    /** Preguntarle a la IA desde el celular. CollaborativeAgent nunca edita para este origen. */
    public function ask(Request $request, Diagram $diagram, CollaborativeAgent $agent): JsonResponse
    {
        $this->authorizeMember($request, $diagram);

        $validated = $request->validate(['text' => ['required', 'string', 'max:2000']]);
        $message = $agent->receive($diagram, $request->user(), $validated['text'], 'mobile', uiContext: ['screen' => 'mobile']);

        return response()->json(['message' => $message->toClientArray()], 202);
    }

    public function registerDevice(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'token' => ['required', 'string', 'max:4096'],
            'platform' => ['sometimes', 'in:android,ios'],
        ]);

        DeviceToken::updateOrCreate(
            ['token' => $validated['token']],
            ['user_id' => $request->user()->id, 'platform' => $validated['platform'] ?? 'android'],
        );

        return response()->json(['ok' => true]);
    }

    public function unregisterDevice(Request $request): JsonResponse
    {
        $validated = $request->validate(['token' => ['required', 'string']]);

        DeviceToken::where('token', $validated['token'])->where('user_id', $request->user()->id)->delete();

        return response()->json(['ok' => true]);
    }

    /** Bandeja de la app: los últimos 50 avisos y cuántos faltan leer. */
    public function notifications(Request $request): JsonResponse
    {
        $userId = (string) $request->user()->id;

        $items = AppNotification::where('user_id', $userId)
            ->orderBy('created_at', 'desc')
            ->limit(50)
            ->get();

        return response()->json([
            'notifications' => $items->map->toClientArray()->values()->all(),
            'unread' => AppNotification::where('user_id', $userId)->whereNull('read_at')->count(),
        ]);
    }

    /** Marca como leído un aviso (`id`), los de un diagrama (`diagramId`) o todos. */
    public function markNotificationsRead(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'id' => ['sometimes', 'string'],
            'diagramId' => ['sometimes', 'string'],
        ]);

        $query = AppNotification::where('user_id', (string) $request->user()->id)->whereNull('read_at');

        if (isset($validated['id'])) {
            $query->where('_id', $validated['id']);
        } elseif (isset($validated['diagramId'])) {
            $query->where('diagram_id', $validated['diagramId']);
        }

        $query->update(['read_at' => now()]);

        return response()->json([
            'unread' => AppNotification::where('user_id', (string) $request->user()->id)->whereNull('read_at')->count(),
        ]);
    }

    /**
     * Enlace temporal (1 minuto) para abrir el lienzo web dentro de la
     * app: el WebView no tiene el token, así que la ruta web `mobile.viewer`
     * inicia la sesión web de ese usuario y redirige a la vista "Ver"
     * embebida. No da permisos nuevos: esa vista es de solo lectura.
     */
    public function viewerLink(Request $request, Diagram $diagram): JsonResponse
    {
        $this->authorizeMember($request, $diagram);

        $code = Str::random(48);
        Cache::put("mobile-viewer:{$code}", [
            'user_id' => $request->user()->id,
            'diagram_id' => $diagram->id,
        ], now()->addMinute());

        return response()->json(['path' => route('mobile.viewer', $code, false)]);
    }

    /** Autoriza el canal de tiempo real con el token de la app, sin cookies. */
    public function broadcastingAuth(Request $request)
    {
        return Broadcast::auth($request);
    }

    /** Lo que la app necesita para conectarse a Reverb. Son datos públicos, igual que en la web. */
    public function realtimeConfig(): JsonResponse
    {
        return response()->json([
            'key' => config('broadcasting.connections.reverb.key'),
            'port' => (int) config('broadcasting.connections.reverb.options.port'),
            'scheme' => config('broadcasting.connections.reverb.options.scheme'),
        ]);
    }

    private function authorizeMember(Request $request, Diagram $diagram): void
    {
        abort_unless($diagram->canBeAccessedBy($request->user()), 403);
    }
}
