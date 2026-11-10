<?php

namespace Tests\Feature;

use App\Models\Collaborator;
use App\Models\Diagram;
use App\Models\User;
use App\Services\DiagramService;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Lo que más riesgo tenía al pasar de PostgreSQL a MongoDB: ids string,
 * subdocumentos, relaciones entre colecciones y valores por defecto.
 */
class DiagramPersistenceTest extends TestCase
{
    use DatabaseMigrations;

    private function service(): DiagramService
    {
        return app(DiagramService::class);
    }

    private function cells(): array
    {
        return ['cells' => [[
            'type' => 'standard.Rectangle',
            'id' => 'abc',
            'umlData' => ['className' => 'Cliente', 'attributes' => ['+ id: int']],
            'attrs' => ['.label' => ['text' => 'con punto en la clave']],
        ]]];
    }

    public function test_diagram_is_stored_as_a_real_subdocument_with_defaults(): void
    {
        $this->actingAs(User::factory()->create());

        $diagram = $this->service()->create(['data' => $this->cells()]);

        $raw = DB::connection('mongodb')->getCollection('diagrams')
            ->findOne(['slug' => $diagram->slug], ['typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']]);

        $this->assertIsArray($raw['data'], 'data no debe guardarse como string JSON');
        $this->assertSame('Cliente', $raw['data']['cells'][0]['umlData']['className']);
        $this->assertSame('private', $raw['visibility']);
        $this->assertSame(1, $raw['classes_count']);

        $fresh = Diagram::where('slug', $diagram->slug)->first();
        $this->assertSame('con punto en la clave', $fresh->data['cells'][0]['attrs']['.label']['text']);
        $this->assertSame(1, $fresh->version);
        $this->assertFalse($fresh->is_template);
    }

    public function test_save_updates_content_and_increments_version(): void
    {
        $this->actingAs(User::factory()->create());
        $diagram = $this->service()->create([]);

        $this->assertTrue($this->service()->save($diagram, ['data' => $this->cells(), 'title' => 'Nuevo']));

        $fresh = $diagram->fresh();
        $this->assertSame('Nuevo', $fresh->title);
        $this->assertSame(2, $fresh->version);
        $this->assertSame(1, $fresh->classes_count);
    }

    public function test_duplicate_creates_an_independent_copy(): void
    {
        $owner = User::factory()->create();
        $this->actingAs($owner);
        $diagram = $this->service()->create(['data' => $this->cells(), 'title' => 'Original']);

        $copy = $this->service()->duplicate($diagram, 'Copia');

        $this->assertNotSame($diagram->id, $copy->id);
        $this->assertNotSame($diagram->slug, $copy->slug);
        $this->assertSame('Cliente', $copy->fresh()->data['cells'][0]['umlData']['className']);
    }

    public function test_invitation_flow_shares_the_diagram_with_string_ids(): void
    {
        $owner = User::factory()->create();
        $guest = User::factory()->create();
        $stranger = User::factory()->create();

        $this->actingAs($owner);
        $diagram = $this->service()->create(['title' => 'Compartido']);

        $invitation = $this->service()->inviteCollaborator($diagram, $owner, $guest->email, 'editor');
        $this->assertSame('pending', $invitation->fresh()->status);

        $notification = $guest->unreadNotifications()->first();
        $this->assertNotNull($notification, 'la notificación debe guardarse en MongoDB');
        $this->assertSame((string) $invitation->id, (string) $notification->data['invitation_id']);

        $session = $this->service()->acceptInvitation($invitation, $guest);

        $this->assertSame('accepted', $invitation->fresh()->status);
        $this->assertSame('active', $session->fresh()->status);
        $this->assertTrue($diagram->fresh()->canBeEditedBy($guest));
        $this->assertFalse($diagram->fresh()->canBeEditedBy($stranger));

        $shared = $this->service()->getSharedDiagrams($guest);
        $this->assertSame(['Compartido'], $shared->pluck('title')->all());
        $this->assertCount(0, $this->service()->getSharedDiagrams($stranger));
        $this->assertCount(1, $this->service()->getOwnedDiagrams($owner));

        $notification->markAsRead();
        $this->assertCount(0, $guest->fresh()->unreadNotifications()->get());
    }

    public function test_element_lock_is_exclusive_between_collaborators(): void
    {
        $owner = User::factory()->create();
        $guest = User::factory()->create();

        $this->actingAs($owner);
        $diagram = $this->service()->create([]);
        $session = $this->service()->createCollaborativeSession($diagram);
        $session->addCollaborator($guest, 'editor');

        $ownerCollaborator = Collaborator::where('user_id', $owner->id)->first();
        $guestCollaborator = Collaborator::where('user_id', $guest->id)->first();

        $this->assertSame('online', $guestCollaborator->status);
        $this->assertTrue($ownerCollaborator->lockElement('element-1'));
        $this->assertFalse($guestCollaborator->lockElement('element-1'));
        $this->assertTrue($guestCollaborator->lockElement('element-2'));

        $ownerCollaborator->unlockElement();
        $this->assertTrue($guestCollaborator->fresh()->lockElement('element-1'));
    }

    public function test_main_pages_and_autosave_work_over_http(): void
    {
        $owner = User::factory()->create();
        $this->actingAs($owner);
        $diagram = $this->service()->create(['data' => $this->cells(), 'title' => 'Visible']);

        $this->get(route('diagrams.index'))->assertOk()->assertSee('Visible');
        $this->get(route('diagrams.editor', $diagram->slug))
            ->assertOk()
            ->assertSee('window.diagramId = "'.$diagram->id.'"', false);
        $this->get(route('diagrams.show', $diagram->id))->assertOk();

        $this->postJson(route('diagrams.api.autosave', $diagram->id), ['data' => json_encode($this->cells())])->assertOk();

        $other = User::factory()->create();
        $this->actingAs($other);
        $this->get(route('diagrams.editor', $diagram->slug))->assertRedirect(route('diagrams.index'));
    }
}
