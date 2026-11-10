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
            'answer' => 'Usá el botón Compartir.',
            'steps' => ['Hacé clic en Compartir', 'Escribí el correo'],
            'highlight' => 'support-target-share',
        ])]]]])]);

        $user = User::factory()->create();
        $id = $this->actingAs($user)->postJson('/help/ask', ['question' => '¿cómo invito a alguien?', 'page' => $this->page()])->json('help.id');

        $this->getJson("/help/{$id}")
            ->assertOk()
            ->assertJsonPath('help.status', 'answered')
            ->assertJsonPath('help.highlight', 'support-target-share')
            ->assertJsonPath('help.steps.1', 'Escribí el correo');

        Http::assertSent(function (HttpRequest $request) {
            $prompt = json_encode($request->data(), JSON_UNESCAPED_UNICODE);

            return str_contains($prompt, 'support-target-share: Compartir')
                && str_contains($prompt, 'Seleccionado: clase Cliente')
                && str_contains($prompt, 'Trabajar en equipo');
        });
    }

    public function test_a_highlight_that_is_not_on_screen_is_ignored(): void
    {
        Http::fake(['llm.test/*' => Http::response(['choices' => [['message' => ['content' => '{"answer":"ok","steps":[],"highlight":"boton-inventado"}']]]])]);

        $id = $this->actingAs(User::factory()->create())->postJson('/help/ask', ['question' => 'hola', 'page' => $this->page()])->json('help.id');

        $this->assertNull(HelpRequest::find($id)->highlight);
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
