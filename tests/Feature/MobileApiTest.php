<?php

namespace Tests\Feature;

use App\Jobs\NotifyDiagramMembers;
use App\Jobs\ProcessAgentTurn;
use App\Models\ActivityEntry;
use App\Models\AiMessage;
use App\Models\DeviceToken;
use App\Models\Diagram;
use App\Models\User;
use App\Services\Agent\CollaborativeAgent;
use App\Services\DiagramService;
use App\Services\Push\DiagramNotifier;
use App\Jobs\NotifyInvitation;
use App\Models\AppNotification;
use App\Services\Push\AppInbox;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MobileApiTest extends TestCase
{
    use DatabaseMigrations;

    private User $owner;

    private User $guest;

    private Diagram $diagram;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::factory()->create(['name' => 'Juan', 'password' => 'clave-de-prueba']);
        $this->guest = User::factory()->create(['name' => 'Ana']);

        $this->actingAs($this->owner);
        $service = app(DiagramService::class);
        $this->diagram = $service->create(['title' => 'Ventas', 'data' => ['cells' => [
            ['type' => 'standard.Rectangle', 'id' => 'a', 'position' => ['x' => 10, 'y' => 20], 'size' => ['width' => 200, 'height' => 90], 'umlData' => ['className' => 'Cliente', 'attributes' => ['+ id: int']]],
            ['type' => 'standard.Rectangle', 'id' => 'b', 'position' => ['x' => 300, 'y' => 20], 'umlData' => ['className' => 'Pedido']],
            ['type' => 'standard.Link', 'id' => 'r', 'source' => ['id' => 'a'], 'target' => ['id' => 'b'], 'relationData' => ['type' => 'association', 'sourceMultiplicity' => '1', 'targetMultiplicity' => '*']],
        ]]]);
        $service->createCollaborativeSession($this->diagram)->addCollaborator($this->guest, 'editor');
        $this->diagram = $this->diagram->fresh();

        $this->app['auth']->forgetGuards();
    }

    public function test_login_issues_a_token_that_opens_the_api(): void
    {
        $this->postJson('/api/mobile/login', ['email' => $this->owner->email, 'password' => 'mala', 'device_name' => 'tel'])
            ->assertStatus(422);

        $token = $this->postJson('/api/mobile/login', ['email' => $this->owner->email, 'password' => 'clave-de-prueba', 'device_name' => 'tel'])
            ->assertOk()
            ->assertJsonPath('user.name', 'Juan')
            ->json('token');

        $this->withToken($token)->getJson('/api/mobile/diagrams')->assertOk()->assertJsonPath('diagrams.0.title', 'Ventas');

        $this->withToken($token)->postJson('/api/mobile/logout')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/mobile/diagrams')->assertUnauthorized();
    }

    public function test_requests_without_token_are_rejected(): void
    {
        $this->getJson('/api/mobile/diagrams')->assertUnauthorized();
    }

    public function test_shared_diagrams_are_listed_for_collaborators_only(): void
    {
        Sanctum::actingAs($this->guest);
        $this->getJson('/api/mobile/diagrams')->assertOk()
            ->assertJsonPath('diagrams.0.title', 'Ventas')
            ->assertJsonPath('diagrams.0.isOwner', false);

        Sanctum::actingAs(User::factory()->create());
        $this->getJson('/api/mobile/diagrams')->assertOk()->assertJsonCount(0, 'diagrams');
        $this->getJson("/api/mobile/diagrams/{$this->diagram->id}")->assertForbidden();
        $this->getJson("/api/mobile/diagrams/{$this->diagram->id}/activity")->assertForbidden();
    }

    public function test_diagram_detail_has_what_the_viewer_needs_to_draw(): void
    {
        Sanctum::actingAs($this->guest);

        $this->getJson("/api/mobile/diagrams/{$this->diagram->id}")->assertOk()
            ->assertJsonCount(2, 'classes')
            ->assertJsonPath('classes.0.name', 'Cliente')
            ->assertJsonPath('classes.0.x', 10)
            ->assertJsonPath('classes.0.width', 200)
            ->assertJsonPath('relations.0.source', 'a')
            ->assertJsonPath('relations.0.targetMultiplicity', '*')
            ->assertJsonPath('agentName', 'Nova');
    }

    public function test_viewer_link_opens_the_web_canvas_as_the_same_user(): void
    {
        $this->withoutVite();
        $stranger = User::factory()->create();

        Sanctum::actingAs($stranger);
        $this->postJson("/api/mobile/diagrams/{$this->diagram->id}/viewer-link")->assertForbidden();

        Sanctum::actingAs($this->guest);
        $path = $this->postJson("/api/mobile/diagrams/{$this->diagram->id}/viewer-link")->assertOk()->json('path');
        $this->assertStringStartsWith('/mobile/viewer/', $path);

        $this->app['auth']->forgetGuards();
        $this->get($path)->assertRedirect(route('diagrams.show', ['diagram' => $this->diagram->id, 'embed' => 1]));
        $this->assertAuthenticatedAs($this->guest, 'web');

        // La vista embebida es el motor del editor en modo "solo ver", unido a la sesión en vivo.
        $this->get(route('diagrams.show', ['diagram' => $this->diagram->id, 'embed' => 1]))
            ->assertOk()
            ->assertSee('window.UML_VIEWER_MODE = true', false)
            ->assertSee('is-embed', false)
            ->assertSee($this->diagram->activeSession()->session_id, false);
    }

    public function test_an_unknown_viewer_link_is_rejected(): void
    {
        $this->get('/mobile/viewer/inventado')->assertForbidden();
        $this->assertGuest('web');
    }

    public function test_mobile_has_no_route_that_edits(): void
    {
        $routes = collect(app('router')->getRoutes()->getRoutes())
            ->filter(fn ($route) => str_starts_with($route->uri(), 'api/mobile/diagrams'))
            ->filter(fn ($route) => array_intersect($route->methods(), ['PUT', 'PATCH', 'DELETE']))
            ->map(fn ($route) => $route->uri());

        $this->assertCount(0, $routes);
    }

    public function test_ai_never_edits_for_a_mobile_request_even_for_the_owner(): void
    {
        config(['services.ai.local.enabled' => true, 'services.ai.local.base_url' => 'http://127.0.0.1:1234/v1', 'services.ai.local.models' => ['m']]);
        Http::fake(['127.0.0.1:1234/*' => Http::response(['choices' => [['message' => ['content' => json_encode([
            'type' => 'ops', 'ops' => [['action' => 'DELETE_CLASS', 'className' => 'Cliente']],
        ])]]]])]);

        Sanctum::actingAs($this->owner);
        $this->postJson("/api/mobile/diagrams/{$this->diagram->id}/ask", ['text' => 'borra Cliente'])->assertStatus(202);

        $reply = AiMessage::where('role', 'assistant')->first();
        $this->assertEmpty($reply->ops);
        $this->assertNull($reply->ops_status);
    }

    public function test_activity_and_messages_are_readable_and_paged(): void
    {
        Bus::fake([ProcessAgentTurn::class]);

        foreach (range(1, 3) as $i) {
            ActivityEntry::create(['diagram_id' => $this->diagram->id, 'actor_name' => 'Juan', 'origin' => 'manual', 'action' => 'CREATE_CLASS', 'summary' => "cambio {$i}"]);
            $this->travel(1)->seconds();
        }

        app(CollaborativeAgent::class)->receive($this->diagram, $this->owner, 'hola', 'text', null, null, false);

        Sanctum::actingAs($this->guest);
        $entries = $this->getJson("/api/mobile/diagrams/{$this->diagram->id}/activity")->assertOk()->json('entries');
        $this->assertSame('cambio 3', $entries[0]['summary']);

        $older = $this->getJson("/api/mobile/diagrams/{$this->diagram->id}/activity?before=".urlencode($entries[0]['createdAt']))->json('entries');
        $this->assertSame('cambio 2', $older[0]['summary']);

        $this->getJson("/api/mobile/diagrams/{$this->diagram->id}/messages")->assertOk()->assertJsonPath('messages.0.text', 'hola');
    }

    public function test_device_token_is_registered_once_and_can_be_removed(): void
    {
        Sanctum::actingAs($this->guest);

        $this->postJson('/api/mobile/devices', ['token' => 'abc'])->assertOk();
        $this->postJson('/api/mobile/devices', ['token' => 'abc'])->assertOk();
        $this->assertSame(1, DeviceToken::count());
        $this->assertSame($this->guest->id, DeviceToken::first()->user_id);

        $this->deleteJson('/api/mobile/devices', ['token' => 'abc'])->assertOk();
        $this->assertSame(0, DeviceToken::count());
    }

    public function test_notifications_are_throttled_and_skip_minor_edits(): void
    {
        Bus::fake([NotifyDiagramMembers::class]);
        $notifier = app(DiagramNotifier::class);
        $id = $this->diagram->id;

        // Salir y mover clases no avisan.
        $notifier->activity($id, [['action' => 'SESSION_LEAVE', 'actorId' => 'x', 'actorName' => 'Juan', 'summary' => 'salió']]);
        $notifier->activity($id, [['action' => 'MOVE_CLASS', 'actorId' => 'x', 'actorName' => 'Juan', 'summary' => 'movió A']]);
        Bus::assertNotDispatched(NotifyDiagramMembers::class);

        // Una edición avisa; después, un minuto de silencio para esa persona.
        $notifier->activity($id, [
            ['action' => 'MOVE_CLASS', 'actorId' => 'x', 'actorName' => 'Juan', 'summary' => 'movió A'],
            ['action' => 'EDIT_CLASS', 'actorId' => 'x', 'actorName' => 'Juan', 'summary' => 'renombró A a B'],
        ]);
        $notifier->activity($id, [['action' => 'CREATE_CLASS', 'actorId' => 'x', 'actorName' => 'Juan', 'summary' => 'creó C']]);
        Bus::assertDispatchedTimes(NotifyDiagramMembers::class, 1);
        Bus::assertDispatched(NotifyDiagramMembers::class, fn ($job) => $job->body === 'Juan renombró A a B');

        // Lo de Juan no silencia a Ana, y entrar o guardar avisa siempre.
        $notifier->activity($id, [['action' => 'DELETE_RELATION', 'actorId' => 'y', 'actorName' => 'Ana', 'summary' => 'borró una relación']]);
        $notifier->activity($id, [['action' => 'SESSION_JOIN', 'actorId' => 'y', 'actorName' => 'Ana', 'summary' => 'entró al diagrama']]);
        $notifier->activity($id, [['action' => 'SAVE', 'actorId' => 'x', 'actorName' => 'Juan', 'summary' => 'guardó el diagrama']]);
        Bus::assertDispatchedTimes(NotifyDiagramMembers::class, 4);
    }

    public function test_recording_activity_triggers_the_notification(): void
    {
        Bus::fake([NotifyDiagramMembers::class]);

        $this->actingAs($this->owner)->postJson(route('diagrams.agent.activity', $this->diagram->id), [
            'entries' => [['action' => 'CREATE_CLASS', 'summary' => 'creó la clase Pago']],
        ])->assertOk();

        Bus::assertDispatched(NotifyDiagramMembers::class, fn ($job) => $job->body === 'Juan creó la clase Pago' && $job->actorId === $this->owner->id);
    }

    public function test_push_goes_to_members_except_the_actor_through_fcm(): void
    {
        $credentials = storage_path('framework/testing-fcm.json');
        // Clave desechable, solo para firmar en esta prueba: no corresponde a ninguna cuenta real.
        $privateKey = file_get_contents(base_path('tests/fixtures/fcm-test-key.pem'));
        file_put_contents($credentials, json_encode(['client_email' => 'a@b.c', 'private_key' => $privateKey, 'project_id' => 'proyecto']));

        try {
            config(['services.fcm.credentials' => $credentials]);
            Http::fake([
                'oauth2.googleapis.com/*' => Http::response(['access_token' => 'tok']),
                'fcm.googleapis.com/*' => Http::response(['name' => 'ok']),
            ]);

            DeviceToken::create(['user_id' => $this->owner->id, 'token' => 'del-dueño']);
            DeviceToken::create(['user_id' => $this->guest->id, 'token' => 'de-ana']);
            DeviceToken::create(['user_id' => User::factory()->create()->id, 'token' => 'de-otro']);

            (new NotifyDiagramMembers($this->diagram->id, $this->owner->id, 'Juan creó Pago'))->handle(app(AppInbox::class));

            $sent = collect(Http::recorded())
                ->map(fn ($pair) => $pair[0])
                ->filter(fn (HttpRequest $request) => str_contains($request->url(), 'fcm.googleapis.com'));

            $this->assertCount(1, $sent);
            $this->assertSame('de-ana', $sent->first()['message']['token']);
            $this->assertSame('Ventas', $sent->first()['message']['notification']['title']);
            $this->assertStringContainsString('/projects/proyecto/', $sent->first()->url());
        } finally {
            @unlink($credentials);
        }
    }

    public function test_without_firebase_configured_nothing_is_sent_and_nothing_fails(): void
    {
        config(['services.fcm.credentials' => null]);
        Http::fake();
        DeviceToken::create(['user_id' => $this->guest->id, 'token' => 'de-ana']);

        (new NotifyDiagramMembers($this->diagram->id, $this->owner->id, 'x'))->handle(app(AppInbox::class));

        Http::assertNothingSent();
        // Igual queda en la bandeja de la app.
        $this->assertSame(1, AppNotification::where('user_id', $this->guest->id)->count());
    }

    public function test_inbox_lists_notifications_and_marks_them_read(): void
    {
        config(['services.fcm.credentials' => null]);
        (new NotifyDiagramMembers($this->diagram->id, $this->owner->id, 'Juan creó Pago'))->handle(app(AppInbox::class));
        (new NotifyDiagramMembers($this->diagram->id, null, 'IA: listo', 'agent'))->handle(app(AppInbox::class));

        // El autor del cambio no recibe su propio aviso; la respuesta de la IA, sí.
        Sanctum::actingAs($this->owner);
        $this->getJson('/api/mobile/notifications')->assertOk()->assertJsonPath('unread', 1);

        Sanctum::actingAs($this->guest);
        $response = $this->getJson('/api/mobile/notifications')->assertOk()
            ->assertJsonPath('unread', 2)
            ->assertJsonPath('notifications.0.type', 'agent')
            ->assertJsonPath('notifications.1.body', 'Juan creó Pago')
            ->assertJsonPath('notifications.1.diagramTitle', 'Ventas');

        $first = $response->json('notifications.0.id');
        $this->postJson('/api/mobile/notifications/read', ['id' => $first])->assertOk()->assertJsonPath('unread', 1);
        $this->postJson('/api/mobile/notifications/read')->assertOk()->assertJsonPath('unread', 0);

        // Los avisos del dueño siguen sin leer: cada uno marca los suyos.
        Sanctum::actingAs($this->owner);
        $this->getJson('/api/mobile/notifications')->assertJsonPath('unread', 1);
    }

    public function test_an_invitation_reaches_the_invited_users_phone(): void
    {
        Bus::fake([NotifyInvitation::class]);
        $invited = User::factory()->create(['email' => 'luis@correo.com']);

        $invitation = app(DiagramService::class)->inviteCollaborator($this->diagram, $this->owner, 'luis@correo.com', 'viewer');
        Bus::assertDispatched(NotifyInvitation::class);

        config(['services.fcm.credentials' => null]);
        (new NotifyInvitation((string) $invitation->id))->handle(app(AppInbox::class));

        $notification = AppNotification::where('user_id', $invited->id)->firstOrFail();
        $this->assertSame('invitation', $notification->type);
        $this->assertSame('Juan te invitó a «Ventas» como observador.', $notification->body);
    }
}
