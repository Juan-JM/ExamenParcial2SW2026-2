<?php

namespace Tests\Feature;

use App\Events\AgentMessagePosted;
use App\Jobs\ProcessAgentTurn;
use App\Models\ActivityEntry;
use App\Models\AiMessage;
use App\Models\User;
use App\Models\WorkSession;
use App\Services\Agent\CollaborativeAgent;
use App\Services\DiagramService;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CollaborativeAgentTest extends TestCase
{
    use DatabaseMigrations;

    private User $owner;

    private User $guest;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::factory()->create(['name' => 'Juan']);
        $this->guest = User::factory()->create(['name' => 'Ana']);

        config([
            'services.ai.local.enabled' => true,
            'services.ai.local.base_url' => 'http://127.0.0.1:1234/v1',
            'services.ai.local.models' => ['modelo-local'],
        ]);
    }

    private function sharedDiagram(string $guestRole = 'editor')
    {
        $this->actingAs($this->owner);
        $service = app(DiagramService::class);
        $diagram = $service->create(['title' => 'Ventas']);
        $service->createCollaborativeSession($diagram)->addCollaborator($this->guest, $guestRole);

        return $diagram->fresh();
    }

    private function fakeLocalReply(array $envelope): void
    {
        Http::fake(['127.0.0.1:1234/*' => Http::response([
            'choices' => [['message' => ['content' => json_encode($envelope)]]],
        ])]);
    }

    public function test_message_is_stored_broadcast_to_everyone_and_queued(): void
    {
        Bus::fake();
        Event::fake([AgentMessagePosted::class]);
        $diagram = $this->sharedDiagram();

        $this->actingAs($this->guest)
            ->postJson(route('diagrams.agent.message', $diagram->id), ['text' => '¿Qué es un atributo derivado?'])
            ->assertStatus(202);

        $stored = AiMessage::first();
        $this->assertSame('Ana', $stored->author_name);
        $this->assertSame($this->guest->id, $stored->author_id);

        Event::assertDispatched(AgentMessagePosted::class);
        Bus::assertDispatched(ProcessAgentTurn::class);
    }

    public function test_outsider_cannot_read_or_write_the_conversation(): void
    {
        $diagram = $this->sharedDiagram();
        $outsider = User::factory()->create();

        $this->actingAs($outsider)->getJson(route('diagrams.agent.state', $diagram->id))->assertForbidden();
        $this->actingAs($outsider)->postJson(route('diagrams.agent.message', $diagram->id), ['text' => 'hola'])->assertForbidden();
    }

    public function test_every_participant_sees_the_same_conversation(): void
    {
        Bus::fake();
        $diagram = $this->sharedDiagram();

        $this->actingAs($this->owner)->postJson(route('diagrams.agent.message', $diagram->id), ['text' => 'mensaje de Juan']);
        $this->actingAs($this->guest)->postJson(route('diagrams.agent.message', $diagram->id), ['text' => 'mensaje de Ana']);

        foreach ([$this->owner, $this->guest] as $user) {
            $state = $this->actingAs($user)->getJson(route('diagrams.agent.state', $diagram->id))->assertOk()->json();
            $this->assertSame(['mensaje de Juan', 'mensaje de Ana'], array_column($state['messages'], 'text'));
            $this->assertSame('Nova', $state['agent']['name']);
        }
    }

    public function test_local_model_answers_and_prompt_includes_authors_and_activity(): void
    {
        $diagram = $this->sharedDiagram();
        ActivityEntry::create([
            'diagram_id' => $diagram->id,
            'actor_type' => 'user',
            'actor_id' => $this->owner->id,
            'actor_name' => 'Juan',
            'action' => 'CREATE_CLASS',
            'summary' => 'creó la clase Pedido',
        ]);
        $this->fakeLocalReply(['type' => 'message', 'text' => 'Ana, Juan creó Pedido.']);

        $message = app(CollaborativeAgent::class)->receive($diagram, $this->guest, '¿Qué hizo Juan?');

        $reply = AiMessage::where('reply_to', $message->id)->first();
        $this->assertSame('Ana, Juan creó Pedido.', $reply->text);
        $this->assertSame('Nova', $reply->author_name);
        $this->assertSame('local', $reply->provider);

        Http::assertSent(function (HttpRequest $request) {
            $body = json_encode($request->data(), JSON_UNESCAPED_UNICODE);

            return str_contains($request->url(), '127.0.0.1:1234')
                && str_contains($body, 'Juan: creó la clase Pedido')
                && str_contains($body, 'MENSAJE ACTUAL de Ana');
        });
    }

    public function test_without_local_model_the_team_is_told_and_no_cloud_is_called(): void
    {
        $diagram = $this->sharedDiagram();

        Http::fake([
            '127.0.0.1:1234/*' => fn () => throw new \Illuminate\Http\Client\ConnectionException('apagado'),
            '*' => Http::response(['no' => 'debía llamarse']),
        ]);

        $message = app(CollaborativeAgent::class)->receive($diagram, $this->owner, 'hola');

        $reply = AiMessage::where('reply_to', $message->id)->first();
        $this->assertSame('system', $reply->role);
        $this->assertStringContainsString('modelo local', $reply->text);

        Http::assertNotSent(fn (HttpRequest $request) => !str_contains($request->url(), '127.0.0.1:1234'));
    }

    public function test_second_local_model_is_used_when_the_first_fails(): void
    {
        config(['services.ai.local.models' => ['grande', 'chico']]);
        $diagram = $this->sharedDiagram();

        Http::fake(['127.0.0.1:1234/*' => function (HttpRequest $request) {
            return $request['model'] === 'grande'
                ? Http::response(['error' => 'sin memoria'], 500)
                : Http::response(['choices' => [['message' => ['content' => '{"type":"message","text":"respondió el chico"}']]]]);
        }]);

        $message = app(CollaborativeAgent::class)->receive($diagram, $this->owner, 'hola');

        $reply = AiMessage::where('reply_to', $message->id)->first();
        $this->assertSame('respondió el chico', $reply->text);
        $this->assertSame('chico', $reply->model);
    }

    public function test_image_import_uses_the_local_vision_model(): void
    {
        $this->fakeLocalReply(['classes' => [['name' => 'Cliente', 'attributes' => ['+ id: int']]], 'relationships' => []]);
        $diagram = $this->sharedDiagram();

        // PNG real de 1x1: el entorno no tiene GD para generar uno.
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
        $file = \Illuminate\Http\UploadedFile::fake()->createWithContent('diagrama.png', $png);

        $this->actingAs($this->owner)
            ->post(route('diagrams.ai.import-image', $diagram->id), ['image' => $file], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('classes.0.name', 'Cliente');

        Http::assertSent(fn (HttpRequest $request) => str_contains(json_encode($request->data(), JSON_UNESCAPED_SLASHES), 'data:image/png;base64,'));
    }

    public function test_ops_are_assigned_to_the_requester_and_logged_as_ai_on_result(): void
    {
        $diagram = $this->sharedDiagram();
        $this->fakeLocalReply(['type' => 'ops', 'text' => 'Va.', 'ops' => [['action' => 'CREATE_CLASS', 'className' => 'Pago']]]);

        $message = app(CollaborativeAgent::class)->receive($diagram, $this->guest, 'crea la clase Pago');
        $reply = AiMessage::where('reply_to', $message->id)->first();

        $this->assertSame('pending', $reply->ops_status);
        $this->assertSame($this->guest->id, $reply->executor_user_id);
        $this->assertSame('Pago', $reply->ops[0]['className']);

        $url = route('diagrams.agent.ops-result', [$diagram->id, $reply->id]);
        $payload = ['summary' => 'Creé la clase "Pago".', 'applied' => [['action' => 'CREATE_CLASS', 'summary' => 'creó la clase Pago']]];

        $this->actingAs($this->owner)->postJson($url, $payload)->assertForbidden();
        $this->actingAs($this->guest)->postJson($url, $payload)->assertOk();
        $this->actingAs($this->guest)->postJson($url, $payload)->assertStatus(409);

        $entry = ActivityEntry::where('actor_type', 'ai')->first();
        $this->assertSame('Nova', $entry->actor_name);
        $this->assertSame('Ana', $entry->requested_by_name);
    }

    public function test_viewer_can_ask_but_ai_cannot_edit_for_them(): void
    {
        $diagram = $this->sharedDiagram('viewer');
        $this->fakeLocalReply(['type' => 'ops', 'ops' => [['action' => 'DELETE_CLASS', 'className' => 'Pago']]]);

        $this->actingAs($this->guest);
        $message = app(CollaborativeAgent::class)->receive($diagram, $this->guest, 'borra Pago');
        $reply = AiMessage::where('reply_to', $message->id)->first();

        $this->assertEmpty($reply->ops);
        $this->assertStringContainsString('observador', $reply->text);
    }

    public function test_missed_digest_reports_what_others_did_since_last_visit(): void
    {
        $diagram = $this->sharedDiagram();

        $this->actingAs($this->guest)->getJson(route('diagrams.agent.state', $diagram->id))->assertJsonPath('missedDigest', null);

        $this->travel(1)->minutes();
        $this->actingAs($this->owner)->postJson(route('diagrams.agent.activity', $diagram->id), [
            'entries' => [['action' => 'CREATE_CLASS', 'summary' => 'creó la clase Cliente', 'elementId' => 'e1']],
        ])->assertOk();

        $this->travel(1)->minutes();
        $this->actingAs($this->guest)->getJson(route('diagrams.agent.state', $diagram->id))
            ->assertJsonPath('missedDigest', 'Juan: creó la clase Cliente');
        $this->actingAs($this->guest)->getJson(route('diagrams.agent.state', $diagram->id))
            ->assertJsonPath('missedDigest', null);
    }

    public function test_team_message_does_not_wake_the_agent_unless_it_is_named(): void
    {
        Bus::fake();
        $diagram = $this->sharedDiagram();
        $url = route('diagrams.agent.message', $diagram->id);

        $this->actingAs($this->owner)->postJson($url, ['text' => 'Ana, ¿terminaste Pedido?', 'toAgent' => false])->assertStatus(202);
        Bus::assertNotDispatched(ProcessAgentTurn::class);

        foreach (['nova, revisa esto', 'Oye NOVÁ qué opinas', 'jarvis ayúdame'] as $text) {
            $this->actingAs($this->owner)->postJson($url, ['text' => $text, 'toAgent' => false])->assertStatus(202);
        }
        Bus::assertDispatchedTimes(ProcessAgentTurn::class, 3);

        $this->actingAs($this->owner)->postJson($url, ['text' => 'la clase novedad está bien', 'toAgent' => false]);
        Bus::assertDispatchedTimes(ProcessAgentTurn::class, 3);

        $state = $this->actingAs($this->guest)->getJson(route('diagrams.agent.state', $diagram->id))->json();
        $this->assertSame('Juan', $state['messages'][0]['authorName']);
        $this->assertFalse($state['messages'][0]['toAgent']);
        $this->assertCount(5, $state['messages']);
    }

    public function test_audit_trail_tells_manual_agent_and_import_apart(): void
    {
        $diagram = $this->sharedDiagram();

        $this->actingAs($this->owner)->postJson(route('diagrams.agent.activity', $diagram->id), ['entries' => [
            ['action' => 'CREATE_CLASS', 'summary' => 'creó la clase A', 'elementId' => 'a', 'after' => ['className' => 'A']],
            ['action' => 'CREATE_CLASS', 'summary' => 'creó la clase B', 'origin' => 'import'],
        ]])->assertOk();

        $this->fakeLocalReply(['type' => 'ops', 'ops' => [['action' => 'RENAME_CLASS', 'oldName' => 'A', 'newName' => 'C']]]);
        $message = app(CollaborativeAgent::class)->receive($diagram, $this->guest, 'renombra A a C', 'voice');
        $reply = AiMessage::where('reply_to', $message->id)->first();

        $this->actingAs($this->guest)->postJson(route('diagrams.agent.ops-result', [$diagram->id, $reply->id]), [
            'summary' => 'Renombré.',
            'applied' => [['action' => 'RENAME_CLASS', 'summary' => 'renombró A a C', 'elementId' => 'a', 'before' => ['uml' => ['className' => 'A']], 'after' => ['uml' => ['className' => 'C']]]],
        ])->assertOk();

        $manual = ActivityEntry::where('summary', 'creó la clase A')->first();
        $this->assertSame('manual', $manual->origin);
        $this->assertSame('Juan', $manual->actor_name);
        $this->assertSame('A', $manual->after['className']);

        $this->assertSame('import', ActivityEntry::where('summary', 'creó la clase B')->first()->origin);

        $agent = ActivityEntry::where('origin', 'agent')->first();
        $this->assertSame('ai', $agent->actor_type);
        $this->assertSame('Nova', $agent->actor_name);
        $this->assertSame('Ana', $agent->requested_by_name);
        $this->assertSame('voice', $agent->source);
        $this->assertSame($message->id, $agent->request_message_id);
        $this->assertSame('A', $agent->before['uml']['className']);

        $this->assertNotEmpty($reply->prompt);
        $this->assertSame('RENAME_CLASS', $reply->raw_response['ops'][0]['action']);
        $this->assertIsInt($reply->latency_ms);

        $history = $this->actingAs($this->guest)->getJson(route('diagrams.agent.history', $diagram->id))->assertOk()->json('entries');
        $this->assertNotEmpty($history);
    }

    public function test_session_events_and_title_changes_are_audited(): void
    {
        $diagram = $this->sharedDiagram();
        $this->assertTrue(app(DiagramService::class)->save($diagram, ['title' => 'Otro nombre']));

        $this->assertSame(1, ActivityEntry::where('action', 'RENAME_DIAGRAM')->count());
        $this->assertSame('Juan', ActivityEntry::where('action', 'RENAME_DIAGRAM')->first()->actor_name);
    }

    public function test_nothing_is_lost_when_realtime_server_is_down(): void
    {
        Bus::fake();
        $diagram = $this->sharedDiagram();

        config([
            'broadcasting.default' => 'reverb',
            'broadcasting.connections.reverb.key' => 'k',
            'broadcasting.connections.reverb.secret' => 's',
            'broadcasting.connections.reverb.app_id' => '1',
            'broadcasting.connections.reverb.options.host' => '127.0.0.1',
            'broadcasting.connections.reverb.options.port' => 1,
            'broadcasting.connections.reverb.options.scheme' => 'http',
            'broadcasting.connections.reverb.options.useTLS' => false,
        ]);
        app('Illuminate\\Contracts\\Broadcasting\\Factory')->forgetDrivers();

        $this->actingAs($this->owner)->postJson(route('diagrams.agent.message', $diagram->id), ['text' => 'sigue guardando'])->assertStatus(202);
        $this->actingAs($this->owner)->postJson(route('diagrams.agent.activity', $diagram->id), [
            'entries' => [['action' => 'CREATE_CLASS', 'summary' => 'creó la clase Cliente']],
        ])->assertOk();

        $this->assertSame(1, AiMessage::where('text', 'sigue guardando')->count());
        $this->assertSame(1, ActivityEntry::where('summary', 'creó la clase Cliente')->count());
        Bus::assertDispatched(ProcessAgentTurn::class);
    }

    public function test_diagram_schema_is_built_from_saved_data_when_request_has_none(): void
    {
        $this->actingAs($this->owner);
        $diagram = app(DiagramService::class)->create(['data' => ['cells' => [
            ['type' => 'standard.Rectangle', 'id' => 'a', 'umlData' => ['className' => 'Cliente', 'attributes' => ['+ id: int']]],
            ['type' => 'standard.Rectangle', 'id' => 'b', 'umlData' => ['className' => 'Pedido']],
            ['type' => 'standard.Link', 'id' => 'r', 'source' => ['id' => 'a'], 'target' => ['id' => 'b'], 'relationData' => ['type' => 'composition']],
        ]]]);

        $schema = app(\App\Services\Agent\DiagramSchemaExtractor::class)->fromDiagram($diagram);

        $this->assertSame(['Cliente', 'Pedido'], array_column($schema['classes'], 'name'));
        $this->assertSame('composition', $schema['relations'][0]['type']);
    }
}
