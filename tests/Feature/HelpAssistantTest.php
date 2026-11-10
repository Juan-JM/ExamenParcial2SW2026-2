<?php

namespace Tests\Feature;

use App\Jobs\AnswerHelpRequest;
use App\Models\HelpRequest;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class HelpAssistantTest extends TestCase
{
    use DatabaseMigrations;

    private function page(): array
    {
        return [
            'screen' => 'editor',
            'title' => 'Ventas - Editor UML',
            'path' => '/diagrams/editor/abc',
            'headings' => ['Ventas'],
            'editor' => ['sidebarTab' => 'Herramientas UML', 'tool' => 'select', 'selection' => 'clase Cliente', 'propertiesOpen' => false],
            'targets' => [
                ['key' => 'support-target-share', 'label' => 'Compartir', 'kind' => 'botón'],
                ['key' => 'support-target-export', 'label' => 'Exportar', 'kind' => 'botón'],
            ],
        ];
    }

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'services.ai.local.enabled' => true,
            'services.ai.local.base_url' => 'http://llm.test/v1',
            'services.ai.local.models' => ['m'],
        ]);
    }

    public function test_question_is_stored_with_the_screen_and_queued(): void
    {
        Bus::fake();
        $user = User::factory()->create();

        $id = $this->actingAs($user)->postJson('/help/ask', ['question' => '¿cómo invito a alguien?', 'page' => $this->page()])
            ->assertStatus(202)
            ->assertJsonPath('help.status', 'pending')
            ->json('help.id');

        $help = HelpRequest::find($id);
        $this->assertSame('clase Cliente', $help->page['editor']['selection']);
        Bus::assertDispatched(AnswerHelpRequest::class);
    }

    public function test_answer_uses_the_screen_and_guide_and_points_to_a_real_element(): void
    {
        Http::fake(['llm.test/v1/chat/completions' => Http::response(['choices' => [['message' => ['content' => json_encode([
            'answer' => 'Usa el botón Compartir.',
            'steps' => [
                ['say' => 'Primero ve a Compartir', 'highlight' => 'support-target-share', 'target' => 'Compartir'],
                ['say' => 'Escribe el correo', 'highlight' => null, 'target' => 'Correo electrónico'],
            ],
        ])]]]])]);

        $user = User::factory()->create();
        $id = $this->actingAs($user)->postJson('/help/ask', ['question' => '¿cómo invito a alguien?', 'page' => $this->page()])->json('help.id');

        $this->getJson("/help/{$id}")
            ->assertOk()
            ->assertJsonPath('help.status', 'answered')
            ->assertJsonPath('help.highlight', 'support-target-share')
            ->assertJsonPath('help.steps.0.highlight', 'support-target-share')
            ->assertJsonPath('help.steps.1.text', 'Escribe el correo')
            ->assertJsonPath('help.steps.1.target', 'Correo electrónico');

        Http::assertSent(function (HttpRequest $request) {
            $prompt = json_encode($request->data(), JSON_UNESCAPED_UNICODE);

            return str_contains($prompt, 'support-target-share: Compartir')
                && str_contains($prompt, 'Seleccionado: clase Cliente')
                && str_contains($prompt, 'Compartir el diagrama e invitar colaboradores')
                && str_contains($prompt, 'MAPA DE LA APLICACIÓN');
        });
    }

    public function test_a_highlight_that_is_not_on_screen_is_ignored(): void
    {
        Http::fake(['llm.test/*' => Http::response(['choices' => [['message' => ['content' => '{"answer":"ok","steps":[],"highlight":"boton-inventado"}']]]])]);

        $id = $this->actingAs(User::factory()->create())->postJson('/help/ask', ['question' => 'hola', 'page' => $this->page()])->json('help.id');

        $this->assertNull(HelpRequest::find($id)->highlight);
    }

    public function test_every_step_points_to_its_own_element(): void
    {
        Http::fake(['llm.test/*' => Http::response(['choices' => [['message' => ['content' => json_encode([
            'answer' => 'Claro, te guío.',
            'steps' => [
                ['say' => 'Primero ve a Compartir', 'highlight' => null, 'target' => 'Compartir'],
                ['say' => 'Después toca Exportar', 'highlight' => 'inventado', 'target' => null],
            ],
        ])]]]])]);

        $id = $this->actingAs(User::factory()->create())->postJson('/help/ask', [
            'question' => 'y ahora?',
            'page' => $this->page(),
            'history' => [['q' => '¿cómo invito a alguien?', 'a' => 'Con Compartir.']],
        ])->json('help.id');

        $help = HelpRequest::find($id);
        $this->assertSame('support-target-share', $help->steps[0]['highlight']);
        $this->assertSame('support-target-export', $help->steps[1]['highlight']);
        $this->assertSame('support-target-share', $help->highlight);

        Http::assertSent(fn (HttpRequest $request) => str_contains(json_encode($request->data(), JSON_UNESCAPED_UNICODE), 'Persona: ¿cómo invito a alguien?'));
    }

    public function test_the_prompt_says_where_the_person_is_and_names_repeated_buttons(): void
    {
        Http::fake(['llm.test/*' => Http::response(['choices' => [['message' => ['content' => json_encode([
            'answer' => 'Está en tu lista.',
            'steps' => [['say' => "Toca 'Gimnasio' para abrirlo", 'highlight' => null, 'target' => null]],
        ])]]]])]);

        $page = [
            'screen' => 'dashboard',
            'title' => 'Mis diagramas',
            'path' => '/diagrams',
            'targets' => [
                ['key' => 'h5', 'label' => 'Editar (Gimnasio)', 'kind' => 'enlace'],
                ['key' => 'h40', 'label' => 'Mis Diagramas', 'kind' => 'enlace, fuera de vista'],
            ],
        ];

        $id = $this->actingAs(User::factory()->create())
            ->postJson('/help/ask', ['question' => '¿dónde está gimnasio?', 'page' => $page])
            ->assertStatus(202)
            ->json('help.id');

        // "Gimnasio" entre comillas encuentra "Editar (Gimnasio)".
        $this->assertSame('h5', HelpRequest::find($id)->steps[0]['highlight']);

        Http::assertSent(function (HttpRequest $request) {
            $prompt = json_encode($request->data(), JSON_UNESCAPED_UNICODE);

            return str_contains($prompt, 'DÓNDE ESTÁ AHORA: \\"Mis Diagramas\\"')
                && str_contains($prompt, 'h40: Mis Diagramas (enlace, fuera de vista)');
        });
    }

    public function test_where_is_points_at_the_card_not_at_one_of_its_buttons(): void
    {
        // El modelo contestó "¿dónde está?" mandando a Clonar: se cambia por la tarjeta.
        Http::fake(['llm.test/*' => Http::response(['choices' => [['message' => ['content' => json_encode([
            'answer' => 'Está fuera de vista, es la tercera tarjeta.',
            'steps' => [['say' => 'Toca Clonar de su tarjeta', 'highlight' => 'h31', 'target' => 'Clonar (SistemaGimnasio)']],
        ])]]]])]);

        $page = [
            'screen' => 'dashboard',
            'targets' => [
                ['key' => 'a3', 'label' => 'Gimnasio', 'kind' => 'tarjeta'],
                ['key' => 'a7', 'label' => 'SistemaGimnasio', 'kind' => 'tarjeta, fuera de vista'],
                ['key' => 'h31', 'label' => 'Clonar (SistemaGimnasio)', 'kind' => 'botón, fuera de vista'],
            ],
        ];

        $id = $this->actingAs(User::factory()->create())
            ->postJson('/help/ask', ['question' => 'Dónde está el diagrama sistema gimnasio', 'page' => $page])
            ->json('help.id');

        $help = HelpRequest::find($id);
        $this->assertCount(1, $help->steps);
        $this->assertSame('a7', $help->steps[0]['highlight']);
        $this->assertTrue($help->steps[0]['look']);
        $this->assertSame('Aquí está SistemaGimnasio.', $help->steps[0]['text']);
        $this->assertSame('Claro, te lo muestro.', $help->answer);
    }

    public function test_deleting_a_class_points_at_the_canvas_not_at_the_palette_button(): void
    {
        // Lo que pasó de verdad: "toca la clase ... en el lienzo" señalaba el botón "Clase" de la paleta.
        Http::fake(['llm.test/*' => Http::response(['choices' => [['message' => ['content' => json_encode([
            'answer' => 'Claro.',
            'steps' => [
                ['say' => 'Primero toca la clase que quieres eliminar en el lienzo para seleccionarla.', 'highlight' => 'h5', 'target' => 'Clase'],
                ['say' => 'Ahora toca en el lienzo la clase Cliente y pulsa Supr.', 'highlight' => null, 'target' => null],
            ],
        ])]]]])]);

        $page = [
            'screen' => 'editor',
            'targets' => [
                ['key' => 'paper-container', 'label' => 'Lienzo (el área donde se dibuja el diagrama)', 'kind' => 'zona'],
                ['key' => 'j_7', 'label' => 'Clase Cliente (en el lienzo)', 'kind' => 'elemento del lienzo'],
                ['key' => 'h5', 'label' => 'Clase', 'kind' => 'botón'],
            ],
        ];

        $id = $this->actingAs(User::factory()->create())
            ->postJson('/help/ask', ['question' => 'cómo elimino una clase', 'page' => $page])
            ->json('help.id');

        $steps = HelpRequest::find($id)->steps;
        $this->assertSame('paper-container', $steps[0]['highlight']);
        $this->assertSame('j_7', $steps[1]['highlight']);
    }

    public function test_without_the_local_model_the_person_is_told(): void
    {
        Http::fake(['llm.test/*' => fn () => throw new \Illuminate\Http\Client\ConnectionException('apagado')]);

        $id = $this->actingAs(User::factory()->create())->postJson('/help/ask', ['question' => 'hola', 'page' => $this->page()])->json('help.id');

        $help = HelpRequest::find($id);
        $this->assertSame('failed', $help->status);
        $this->assertStringContainsString('LM Studio', $help->answer);
    }

    public function test_nobody_can_read_someone_elses_answer(): void
    {
        Bus::fake();
        $id = $this->actingAs(User::factory()->create())->postJson('/help/ask', ['question' => 'hola', 'page' => $this->page()])->json('help.id');

        $this->actingAs(User::factory()->create())->getJson("/help/{$id}")->assertNotFound();
    }

    public function test_page_data_is_validated(): void
    {
        $this->actingAs(User::factory()->create())
            ->postJson('/help/ask', ['question' => 'hola', 'page' => ['targets' => [['key' => 'x']]]])
            ->assertStatus(422);
    }
}
