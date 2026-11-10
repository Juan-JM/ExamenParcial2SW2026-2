<?php

namespace Tests\Feature;

use App\Models\ActivityEntry;
use App\Models\AiMessage;
use App\Models\User;
use App\Models\WorkSession;
use App\Services\Agent\AgentPromptBuilder;
use App\Services\Agent\CollaborativeAgent;
use App\Services\DiagramService;
use App\Services\Vector\SemanticMemory;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** Base vectorial (Qdrant) y asistente que conoce la pantalla de cada usuario. */
class SemanticMemoryTest extends TestCase
{
    use DatabaseMigrations;

    private array $qdrantPoints = [];

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'services.vector.enabled' => true,
            'services.vector.url' => 'http://qdrant.test',
            'services.ai.local.enabled' => true,
            'services.ai.local.base_url' => 'http://llm.test/v1',
            'services.ai.local.models' => ['m'],
        ]);
    }

    /** Embeddings de juguete: el vector marca qué palabras clave aparecen. */
    private function fakeServices(string $chatReply = '{"type":"message","text":"ok"}'): void
    {
        $vector = function (string $text): array {
            $text = mb_strtolower($text);

            return array_map(fn (string $word) => str_contains($text, $word) ? 1.0 : 0.0, ['pago', 'cliente', 'export', 'clase']);
        };

        Http::fake([
            'llm.test/v1/embeddings' => fn (HttpRequest $request) => Http::response([
                'data' => array_map(fn (string $text, int $i) => ['index' => $i, 'embedding' => $vector($text)], $request['input'], array_keys($request['input'])),
            ]),
            'llm.test/v1/chat/completions' => Http::response(['choices' => [['message' => ['content' => $chatReply]]]]),
            // Un Qdrant en memoria: un solo enrutador, para no depender del orden de los patrones.
            'qdrant.test/*' => function (HttpRequest $request) {
                $path = parse_url($request->url(), PHP_URL_PATH);

                if (str_ends_with($path, '/points/search')) {
                    return $this->fakeSearch($request);
                }

                if (str_ends_with($path, '/points')) {
                    foreach ($request['points'] as $point) {
                        $this->qdrantPoints[$point['id']] = $point;
                    }

                    return Http::response(['result' => ['status' => 'completed']]);
                }

                if ($request->method() === 'GET') {
                    return Http::response(['status' => ['error' => 'Not found']], 404);
                }

                return Http::response(['result' => true]);
            },
        ]);
    }

    private function fakeSearch(HttpRequest $request)
    {
                $hits = collect($this->qdrantPoints)
                    ->filter(function (array $point) use ($request) {
                        foreach ($request['filter']['must'] ?? [] as $condition) {
                            $value = $point['payload'][$condition['key']] ?? null;
                            $match = $condition['match'];
                            if (isset($match['value']) && $value !== $match['value']) return false;
                            if (isset($match['any']) && !in_array($value, $match['any'], true)) return false;
                        }
                        return true;
                    })
                    ->map(fn (array $point) => [
                        'score' => array_sum(array_map(fn ($a, $b) => $a * $b, $point['vector'], $request['vector'])),
                        'payload' => $point['payload'],
                    ])
                    ->sortByDesc('score')
                    ->take($request['limit'])
                    ->values()
                    ->all();

                return Http::response(['result' => $hits]);
    }

    private function diagram(User $owner)
    {
        $this->actingAs($owner);

        return app(DiagramService::class)->create(['title' => 'Ventas']);
    }

    public function test_activity_and_messages_are_indexed_and_found_by_meaning(): void
    {
        $this->fakeServices();
        $owner = User::factory()->create(['name' => 'Ana']);
        $diagram = $this->diagram($owner);

        $this->postJson(route('diagrams.agent.activity', $diagram->id), [
            'entries' => [
                ['action' => 'ADD_ATTRIBUTE', 'summary' => 'agregó el atributo monto a Pago'],
                ['action' => 'CREATE_CLASS', 'summary' => 'creó la clase Cliente'],
            ],
        ])->assertOk();

        $this->assertCount(2, $this->qdrantPoints);
        $payload = collect($this->qdrantPoints)->first()['payload'];
        $this->assertSame($diagram->id, $payload['diagram_id']);
        $this->assertSame('activity', $payload['kind']);

        $results = $this->getJson(route('diagrams.agent.search', [$diagram->id, 'q' => '¿quién tocó lo de los pagos?']))
            ->assertOk()
            ->assertJsonPath('available', true)
            ->json('results');

        $this->assertStringContainsString('monto a Pago', $results[0]['text']);
        $this->assertStringContainsString('Ana', $results[0]['text']);
    }

    public function test_search_never_returns_another_diagrams_history(): void
    {
        $this->fakeServices();
        $ana = User::factory()->create();
        $other = $this->diagram(User::factory()->create());
        $this->postJson(route('diagrams.agent.activity', $other->id), ['entries' => [['action' => 'X', 'summary' => 'creó la clase Pago']]]);

        $mine = $this->diagram($ana);
        $results = $this->getJson(route('diagrams.agent.search', [$mine->id, 'q' => 'pago']))->json('results');

        $this->assertSame([], $results);
    }

    public function test_help_guide_is_indexed_and_reaches_the_prompt(): void
    {
        $this->fakeServices();
        Artisan::call('vector:index');

        $help = collect($this->qdrantPoints)->where('payload.kind', 'help');
        $this->assertGreaterThan(10, $help->count());
        $this->assertTrue($help->contains(fn ($p) => str_contains($p['payload']['text'], 'Spring Boot')));

        $owner = User::factory()->create(['name' => 'Ana']);
        $diagram = $this->diagram($owner);
        $message = app(CollaborativeAgent::class)->receive($diagram, $owner, '¿cómo exporto el diagrama?');

        Http::assertSent(fn (HttpRequest $request) => str_contains($request->url(), 'chat/completions')
            && str_contains(json_encode($request->data(), JSON_UNESCAPED_UNICODE), '[guía]'));
        $this->assertNotNull(AiMessage::where('reply_to', $message->id)->first());
    }

    public function test_without_qdrant_everything_keeps_working(): void
    {
        Http::fake([
            'qdrant.test/*' => fn () => throw new \Illuminate\Http\Client\ConnectionException('apagado'),
            'llm.test/v1/embeddings' => Http::response(['data' => [['index' => 0, 'embedding' => [1, 0]]]]),
            'llm.test/v1/chat/completions' => Http::response(['choices' => [['message' => ['content' => '{"type":"message","text":"sigo andando"}']]]]),
        ]);

        $owner = User::factory()->create();
        $diagram = $this->diagram($owner);

        $this->postJson(route('diagrams.agent.activity', $diagram->id), ['entries' => [['action' => 'X', 'summary' => 'creó la clase Pago']]])->assertOk();
        $this->assertSame(1, ActivityEntry::count());
        $this->assertTrue(Cache::has('semantic_memory_paused'));

        $message = app(CollaborativeAgent::class)->receive($diagram, $owner, 'hola');
        $this->assertSame('sigo andando', AiMessage::where('reply_to', $message->id)->first()->text);

        $this->getJson(route('diagrams.agent.search', [$diagram->id, 'q' => 'pago']))
            ->assertOk()
            ->assertJsonPath('available', false);
    }

    public function test_the_assistant_knows_what_screen_each_person_is_on(): void
    {
        $this->fakeServices();
        $ana = User::factory()->create(['name' => 'Ana']);
        $juan = User::factory()->create(['name' => 'Juan']);
        $this->actingAs($ana);
        $service = app(DiagramService::class);
        $diagram = $service->create(['title' => 'Ventas']);
        $service->createCollaborativeSession($diagram)->addCollaborator($juan, 'editor');

        $this->actingAs($juan)->postJson(route('diagrams.agent.heartbeat', $diagram->id), [
            'context' => ['screen' => 'editor', 'tool' => 'composition', 'selection' => 'clase Pedido'],
        ])->assertOk();

        $this->actingAs($ana)->postJson(route('diagrams.agent.message', $diagram->id), [
            'text' => '¿cómo agrego un atributo?',
            'context' => ['screen' => 'editor', 'sidebarTab' => 'Herramientas UML', 'selection' => 'clase Cliente', 'propertiesOpen' => true],
        ])->assertStatus(202);

        Http::assertSent(function (HttpRequest $request) {
            if (!str_contains($request->url(), 'chat/completions')) return false;
            $prompt = json_encode($request->data(), JSON_UNESCAPED_UNICODE);

            return str_contains($prompt, 'con \\"clase Cliente\\" seleccionado')
                && str_contains($prompt, 'con el panel de propiedades abierto')
                && str_contains($prompt, 'Juan: está en el editor del diagrama, usando la herramienta \\"composition\\"');
        });

        $this->assertSame('clase Cliente', AiMessage::where('author_name', 'Ana')->first()->ui_context['selection']);
    }

    public function test_context_from_the_client_is_validated(): void
    {
        $owner = User::factory()->create();
        $diagram = $this->diagram($owner);

        $this->postJson(route('diagrams.agent.heartbeat', $diagram->id), ['context' => ['selection' => str_repeat('x', 500)]])
            ->assertStatus(422);
        $this->assertSame(0, WorkSession::count());
    }

    public function test_describe_context_reads_naturally(): void
    {
        $text = app(AgentPromptBuilder::class)->describeContext(['screen' => 'mobile']);
        $this->assertSame('está en la app móvil (solo lectura)', $text);
        $this->assertSame('(desconocida)', app(AgentPromptBuilder::class)->describeContext(null));
    }

    public function test_memory_is_not_used_when_disabled(): void
    {
        config(['services.vector.enabled' => false]);
        Http::fake();

        $this->assertFalse(app(SemanticMemory::class)->isAvailable());
        $this->assertSame([], app(SemanticMemory::class)->recall('pago', 'x'));
        Http::assertNothingSent();
    }
}
