<?php

namespace Tests\Feature;

use App\Models\ActivityEntry;
use App\Models\DiagramSnapshot;
use App\Models\User;
use App\Services\DiagramService;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Tests\TestCase;

class DiagramVersionTest extends TestCase
{
    use DatabaseMigrations;

    public function test_versions_are_listed_and_a_restore_keeps_the_current_state(): void
    {
        $owner = User::factory()->create(['name' => 'Juan']);
        $viewer = User::factory()->create();
        $this->actingAs($owner);
        $service = app(DiagramService::class);

        $diagram = $service->create(['data' => ['cells' => []]]);
        $service->createCollaborativeSession($diagram)->addCollaborator($viewer, 'viewer');

        $service->save($diagram, ['data' => ['cells' => [['id' => 'a', 'umlData' => ['className' => 'Original']]]]], DiagramSnapshot::MANUAL);
        $first = DiagramSnapshot::first();

        $this->travel(2)->minutes();
        $service->save($diagram->fresh(), ['data' => ['cells' => [['id' => 'b', 'umlData' => ['className' => 'Nueva']]]]], DiagramSnapshot::MANUAL);

        $versions = $this->getJson(route('diagrams.versions.index', $diagram->id))->assertOk()->json();
        $this->assertTrue($versions['canRestore']);
        $this->assertCount(2, $versions['versions']);
        $this->assertSame(['Nueva'], $versions['versions'][0]['classNames']);
        $this->assertSame(1, $versions['versions'][1]['classesCount']);

        $this->actingAs($viewer)->postJson(route('diagrams.versions.restore', [$diagram->id, $first->id]))->assertForbidden();
        $this->assertFalse($this->actingAs($viewer)->getJson(route('diagrams.versions.index', $diagram->id))->json('canRestore'));

        $this->actingAs($owner)->postJson(route('diagrams.versions.restore', [$diagram->id, $first->id]))
            ->assertOk()
            ->assertJsonPath('data.cells.0.umlData.className', 'Original');

        $this->assertSame('Original', $diagram->fresh()->data['cells'][0]['umlData']['className']);
        // Lo que había antes de restaurar sigue guardado (si ya existía esa copia, no se duplica).
        $this->assertTrue(DiagramSnapshot::all()->contains(fn ($s) => ($s->data['cells'][0]['umlData']['className'] ?? null) === 'Nueva'));
        // Restaurar no agrega otra versión: lo restaurado ya está en la lista.
        $this->assertSame(0, DiagramSnapshot::where('reason', 'restored')->count());
        $this->assertSame(2, DiagramSnapshot::count());
        $this->assertSame(1, ActivityEntry::where('action', 'RESTORE_VERSION')->count());

        $this->getJson(route('diagrams.versions.current', $diagram->id))->assertJsonPath('data.cells.0.id', 'a');
    }

    public function test_unsaved_state_is_kept_before_restoring(): void
    {
        $owner = User::factory()->create();
        $this->actingAs($owner);
        $service = app(DiagramService::class);
        $diagram = $service->create([]);

        $service->save($diagram, ['data' => ['cells' => [['id' => 'a', 'umlData' => ['className' => 'Primera']]]]], DiagramSnapshot::MANUAL);
        $first = DiagramSnapshot::first();

        // Autoguardado: no genera versión propia.
        $service->save($diagram->fresh(), ['data' => ['cells' => [['id' => 'b', 'umlData' => ['className' => 'SinCopia']]]]]);
        $this->assertSame(1, DiagramSnapshot::count());

        $this->postJson(route('diagrams.versions.restore', [$diagram->id, $first->id]))->assertOk();

        $before = DiagramSnapshot::where('reason', 'before_restore')->first();
        $this->assertSame('SinCopia', $before->data['cells'][0]['umlData']['className']);
    }

    public function test_only_manual_saves_create_versions_and_never_duplicates(): void
    {
        $this->actingAs(User::factory()->create());
        $service = app(DiagramService::class);
        $diagram = $service->create([]);
        $data = ['cells' => [['id' => 'a', 'umlData' => ['className' => 'Uno']]]];

        $service->save($diagram, ['data' => $data]);
        $this->assertSame(0, DiagramSnapshot::count(), 'el autoguardado no es una versión');

        $service->save($diagram->fresh(), ['data' => $data], DiagramSnapshot::MANUAL);
        $service->save($diagram->fresh(), ['data' => $data], DiagramSnapshot::MANUAL);
        $this->assertSame(1, DiagramSnapshot::count(), 'guardar dos veces lo mismo no repite la versión');
        $this->assertSame('manual', DiagramSnapshot::first()->reason);
    }

    public function test_manual_save_through_the_editor_creates_a_version(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);
        $diagram = app(DiagramService::class)->create([]);

        \Livewire\Livewire::test(\App\Livewire\DiagramEditor::class, ['diagramId' => $diagram->id])
            ->call('saveDiagram', json_encode(['cells' => [['id' => 'x', 'umlData' => ['className' => 'Manual']]]]));

        $this->assertSame('manual', DiagramSnapshot::first()?->reason);
        // Guardar queda en la auditoría (y por eso avisa al equipo en el celular).
        $this->assertTrue(ActivityEntry::where('diagram_id', $diagram->id)->where('action', 'SAVE')->exists());

        $this->postJson(route('diagrams.api.autosave', $diagram->id), ['data' => json_encode(['cells' => [['id' => 'y', 'umlData' => ['className' => 'Auto']]]])])->assertOk();
        $this->assertSame(1, DiagramSnapshot::count());
    }

    public function test_outsiders_cannot_see_versions(): void
    {
        $this->actingAs(User::factory()->create());
        $diagram = app(DiagramService::class)->create([]);

        $this->actingAs(User::factory()->create())->getJson(route('diagrams.versions.index', $diagram->id))->assertForbidden();
    }
}
