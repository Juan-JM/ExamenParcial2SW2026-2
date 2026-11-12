<?php

namespace Tests\Feature;

use App\Events\AgentMessagePosted;
use App\Events\LiveFloorChanged;
use App\Jobs\ProcessAgentTurn;
use App\Models\AiMessage;
use App\Models\User;
use App\Services\Agent\CollaborativeAgent;
use App\Services\DiagramService;
use App\Services\Live\LiveFloor;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** "Nova en vivo": turnos entre varias personas, charla de fondo y fusión de frases. */
class NovaLiveTest extends TestCase
{
    use DatabaseMigrations;

    private User $carlos;

    private User $ana;

    protected function setUp(): void
    {
        parent::setUp();

        $this->carlos = User::factory()->create(['name' => 'Carlos Pérez']);
        $this->ana = User::factory()->create(['name' => 'Ana Torres']);

        config([
            'services.ai.local.enabled' => true,
            'services.ai.local.base_url' => 'http://127.0.0.1:1234/v1',
            'services.ai.local.models' => ['modelo-local'],
        ]);
    }

    private function sharedDiagram()
    {
        $this->actingAs($this->carlos);
        $service = app(DiagramService::class);
        $diagram = $service->create(['title' => 'Ventas']);
        $service->createCollaborativeSession($diagram)->addCollaborator($this->ana, 'editor');

        return $diagram->fresh();
    }

    private function say(User $user, $diagram, string $text, array $extra = [])
    {
        return $this->actingAs($user)->postJson(route('diagrams.live.utterance', $diagram->id), array_merge(['text' => $text, 'addressed' => true], $extra));
    }

    private function fakeReply(array $envelope): void
    {
        Http::fake(['127.0.0.1:1234/*' => Http::response([
            'choices' => [['message' => ['content' => json_encode($envelope)]]],
        ])]);
    }

    public function test_addressed_utterance_is_stored_as_live_and_queued_for_the_model(): void
    {
        Bus::fake();
        $diagram = $this->sharedDiagram();

        $response = $this->say($this->ana, $diagram, '¿La relación es de uno a muchos?')->assertStatus(202);

        $message = AiMessage::first();
        $this->assertSame('live', $message->source);
        $this->assertTrue($message->to_agent);
        $this->assertSame('Ana Torres', $message->author_name);
        $response->assertJsonPath('queue', null)->assertJsonPath('merged', false);
        Bus::assertDispatched(ProcessAgentTurn::class);
        $this->assertSame($message->id, app(LiveFloor::class)->snapshot($diagram->id)['currentMessageId']);
    }

    public function test_background_chatter_is_kept_but_not_answered_nor_shown_in_the_classic_chat(): void
    {
        Bus::fake();
        $diagram = $this->sharedDiagram();

        $this->say($this->carlos, $diagram, 'creo que Pedido necesita un total', ['addressed' => false])->assertStatus(202);

        $message = AiMessage::first();
        $this->assertSame('ambient', $message->source);
        $this->assertFalse($message->to_agent);
        Bus::assertNotDispatched(ProcessAgentTurn::class);
        $this->assertSame([], app(LiveFloor::class)->snapshot($diagram->id)['queue']);

        $classic = $this->actingAs($this->carlos)->getJson(route('diagrams.agent.state', $diagram->id))->json('messages');
        $this->assertSame([], $classic);

        $live = $this->actingAs($this->carlos)->getJson(route('diagrams.live.state', $diagram->id))->assertOk()->json();
        $this->assertSame(['creo que Pedido necesita un total'], array_column($live['messages'], 'text'));
        $this->assertSame('Nova', $live['agent']['name']);
    }

    public function test_naming_nova_makes_even_a_background_phrase_addressed(): void
    {
        Bus::fake();
        $diagram = $this->sharedDiagram();

        $this->say($this->carlos, $diagram, 'oye Nova qué opinas', ['addressed' => false])->assertStatus(202);

        $this->assertSame('live', AiMessage::first()->source);
        Bus::assertDispatched(ProcessAgentTurn::class);
    }

    public function test_old_background_chatter_is_pruned(): void
    {
        Bus::fake();
        $diagram = $this->sharedDiagram();
        config(['services.ai.live.ambient_ttl_minutes' => 60]);

        $old = AiMessage::create([
            'diagram_id' => $diagram->id, 'role' => 'user', 'author_id' => $this->carlos->id, 'author_name' => 'Carlos',
            'text' => 'viejo', 'source' => 'ambient', 'to_agent' => false,
        ]);
        $old->created_at = now()->subHours(3);
        $old->save();

        $this->say($this->carlos, $diagram, 'nuevo', ['addressed' => false]);

        $this->assertSame(['nuevo'], AiMessage::pluck('text')->all());
    }

    public function test_second_person_waits_politely_while_nova_serves_the_first(): void
    {
        Bus::fake();
        Event::fake([LiveFloorChanged::class, AgentMessagePosted::class]);
        $diagram = $this->sharedDiagram();

        $first = $this->say($this->carlos, $diagram, 'revisa la clase Pedido')->assertJsonPath('queue', null)->json('message.id');
        $second = $this->say($this->ana, $diagram, 'y la clase Cliente')->assertStatus(202);

        $second->assertJsonPath('queue.position', 1)->assertJsonPath('queue.servingName', 'Carlos Pérez');

        $floor = app(LiveFloor::class)->snapshot($diagram->id);
        $this->assertSame($first, $floor['currentMessageId']);
        $this->assertCount(2, $floor['queue']);
        Event::assertDispatched(LiveFloorChanged::class);
    }

    public function test_turn_passes_to_the_next_person_when_the_first_finishes_speaking(): void
    {
        Bus::fake();
        $diagram = $this->sharedDiagram();

        $first = $this->say($this->carlos, $diagram, 'primero')->json('message.id');
        $second = $this->say($this->ana, $diagram, 'segundo')->json('message.id');

        // Ana no puede cortarle el turno a Carlos.
        $this->actingAs($this->ana)->postJson(route('diagrams.live.done', $diagram->id), ['messageId' => $first])->assertOk();
        $this->assertSame($first, app(LiveFloor::class)->snapshot($diagram->id)['currentMessageId']);

        $this->actingAs($this->carlos)->postJson(route('diagrams.live.done', $diagram->id), ['messageId' => $first])
            ->assertOk()
            ->assertJsonPath('floor.currentMessageId', $second)
            ->assertJsonPath('floor.currentUserName', 'Ana Torres');
    }

    public function test_an_expired_turn_can_be_released_by_anyone(): void
    {
        Bus::fake();
        $diagram = $this->sharedDiagram();

        $first = $this->say($this->carlos, $diagram, 'primero')->json('message.id');
        $this->say($this->ana, $diagram, 'segundo');

        $this->travel(5)->minutes();

        // Al consultar, el turno vencido de Carlos ya no cuenta.
        $this->assertNotSame($first, app(LiveFloor::class)->snapshot($diagram->id)['currentMessageId']);
    }

    public function test_reply_to_a_live_request_marks_the_turn_ready_and_it_is_released_when_voice_ends(): void
    {
        $diagram = $this->sharedDiagram();
        $this->fakeReply(['type' => 'message', 'text' => 'Es de uno a muchos.']);

        $messageId = $this->say($this->ana, $diagram, 'la relación entre Pedido y Cliente')->assertStatus(202)->json('message.id');

        $reply = AiMessage::where('reply_to', $messageId)->first();
        $this->assertSame('Es de uno a muchos.', $reply->text);

        $floor = app(LiveFloor::class)->snapshot($diagram->id);
        $this->assertSame($messageId, $floor['currentMessageId']);
        $this->assertSame('ready', $floor['queue'][0]['status']);

        $this->actingAs($this->ana)->postJson(route('diagrams.live.done', $diagram->id), ['messageId' => $messageId])
            ->assertJsonPath('floor.currentMessageId', null);
    }

    public function test_a_model_error_frees_the_turn_immediately(): void
    {
        $diagram = $this->sharedDiagram();
        Http::fake(['127.0.0.1:1234/*' => fn () => throw new \Illuminate\Http\Client\ConnectionException('apagado')]);

        $this->say($this->ana, $diagram, 'hola nova')->assertStatus(202);

        $this->assertSame('system', AiMessage::where('role', 'system')->first()->role);
        $this->assertNull(app(LiveFloor::class)->snapshot($diagram->id)['currentMessageId']);
    }

    public function test_continuing_a_sentence_merges_it_with_the_unanswered_request(): void
    {
        Bus::fake();
        $diagram = $this->sharedDiagram();

        $firstId = $this->say($this->ana, $diagram, 'hola quería preguntarte sobre')->json('message.id');
        $response = $this->say($this->ana, $diagram, 'cómo está la relación de Pedido', ['supersedes' => $firstId])->assertStatus(202);

        $response->assertJsonPath('merged', true)
            ->assertJsonPath('message.text', 'hola quería preguntarte sobre cómo está la relación de Pedido');

        $this->assertTrue((bool) AiMessage::find($firstId)->superseded);

        // El turno de la frase vieja se fue; queda solo el de la fusionada.
        $floor = app(LiveFloor::class)->snapshot($diagram->id);
        $this->assertSame([$response->json('message.id')], array_column($floor['queue'], 'messageId'));
    }

    public function test_the_stale_answer_is_discarded_when_the_request_was_merged_while_thinking(): void
    {
        $diagram = $this->sharedDiagram();
        $this->fakeReply(['type' => 'message', 'text' => 'respuesta vieja']);

        $stale = app(CollaborativeAgent::class)->receive($diagram, $this->ana, 'hola quería preguntarte sobre', 'live', null, null, true, null, dispatch: false);
        $stale->update(['superseded' => true]);

        $this->assertNull(app(CollaborativeAgent::class)->respond($stale->fresh(), null));
        Http::assertNothingSent();
        $this->assertSame(0, AiMessage::where('role', 'assistant')->count());
    }

    public function test_an_answer_that_arrives_after_the_merge_is_deleted(): void
    {
        $diagram = $this->sharedDiagram();
        $stale = app(CollaborativeAgent::class)->receive($diagram, $this->ana, 'primera parte', 'live', null, null, true, null, dispatch: false);

        // El modelo "tarda": durante su respuesta la frase queda anulada.
        Http::fake(['127.0.0.1:1234/*' => function () use ($stale) {
            AiMessage::find($stale->id)->update(['superseded' => true]);

            return Http::response(['choices' => [['message' => ['content' => '{"type":"message","text":"tarde"}']]]]);
        }]);

        $this->assertNull(app(CollaborativeAgent::class)->respond($stale, null));
        $this->assertSame(0, AiMessage::where('role', 'assistant')->count());
    }

    public function test_a_request_that_already_changed_the_diagram_is_not_merged(): void
    {
        $diagram = $this->sharedDiagram();
        $this->fakeReply(['type' => 'ops', 'text' => 'Va.', 'ops' => [['action' => 'CREATE_CLASS', 'className' => 'Pago']]]);

        $firstId = $this->say($this->ana, $diagram, 'crea la clase Pago')->json('message.id');
        $this->assertNotEmpty(AiMessage::where('reply_to', $firstId)->first()->ops);

        $response = $this->say($this->ana, $diagram, 'con un atributo monto', ['supersedes' => $firstId])->assertStatus(202);

        $response->assertJsonPath('merged', false)->assertJsonPath('message.text', 'con un atributo monto');
        $this->assertFalse((bool) AiMessage::find($firstId)->superseded);
    }

    public function test_nobody_can_merge_with_someone_elses_request(): void
    {
        Bus::fake();
        $diagram = $this->sharedDiagram();

        $carlosId = $this->say($this->carlos, $diagram, 'pregunta de Carlos')->json('message.id');
        $response = $this->say($this->ana, $diagram, 'pregunta de Ana', ['supersedes' => $carlosId])->assertStatus(202);

        $response->assertJsonPath('merged', false);
        $this->assertFalse((bool) AiMessage::find($carlosId)->superseded);
    }

    public function test_voice_requests_get_conversational_rules_and_background_chatter_as_context(): void
    {
        $diagram = $this->sharedDiagram();
        $this->say($this->carlos, $diagram, 'creo que Pedido necesita un total', ['addressed' => false]);
        $this->fakeReply(['type' => 'message', 'text' => 'Sí, tiene sentido.']);

        $this->say($this->ana, $diagram, 'Nova, ¿qué opinas de lo que dijo Carlos?');

        Http::assertSent(function (HttpRequest $request) {
            $body = json_encode($request->data(), JSON_UNESCAPED_UNICODE);

            return str_contains($body, 'ESTÁS HABLANDO POR VOZ')
                && str_contains($body, 'Carlos Pérez (charla de fondo): creo que Pedido necesita un total');
        });
    }

    public function test_text_requests_do_not_get_the_voice_rules(): void
    {
        $diagram = $this->sharedDiagram();
        $this->fakeReply(['type' => 'message', 'text' => 'Hola.']);

        app(CollaborativeAgent::class)->receive($diagram, $this->ana, 'hola');

        Http::assertSent(fn (HttpRequest $request) => !str_contains(json_encode($request->data(), JSON_UNESCAPED_UNICODE), 'ESTÁS HABLANDO POR VOZ'));
    }

    public function test_outsiders_cannot_use_the_live_endpoints(): void
    {
        $diagram = $this->sharedDiagram();
        $outsider = User::factory()->create();

        $this->actingAs($outsider)->getJson(route('diagrams.live.state', $diagram->id))->assertForbidden();
        $this->say($outsider, $diagram, 'hola')->assertForbidden();
        $this->actingAs($outsider)->postJson(route('diagrams.live.done', $diagram->id), ['messageId' => 'x'])->assertForbidden();
    }
}
