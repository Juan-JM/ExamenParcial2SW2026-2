<?php

namespace Tests\Feature;

use App\Jobs\CloseWorkSessionIfEmpty;
use App\Models\ActivityEntry;
use App\Models\Diagram;
use App\Models\DiagramSnapshot;
use App\Models\User;
use App\Models\WorkSession;
use App\Services\DiagramService;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class WorkSessionTest extends TestCase
{
    use DatabaseMigrations;

    private User $owner;

    private User $guest;

    private Diagram $diagram;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::factory()->create(['name' => 'Juan']);
        $this->guest = User::factory()->create(['name' => 'Ana']);

        $this->actingAs($this->owner);
        $service = app(DiagramService::class);
        $this->diagram = $service->create(['title' => 'Ventas']);
        $service->createCollaborativeSession($this->diagram)->addCollaborator($this->guest, 'editor');
    }

    private function beat(User $user)
    {
        return $this->actingAs($user)->postJson(route('diagrams.agent.heartbeat', $this->diagram->id))->assertOk();
    }

    private function leave(User $user)
    {
        return $this->actingAs($user)->postJson(route('diagrams.agent.leave', $this->diagram->id))->assertOk();
    }

    private function runClose(): void
    {
        foreach (WorkSession::where('is_open', true)->get() as $session) {
            (new CloseWorkSessionIfEmpty($session->id))->handle();
        }
    }

    public function test_session_starts_when_someone_opens_and_others_join_it(): void
    {
        $this->assertSame(0, WorkSession::count());

        $first = $this->beat($this->owner)->json('session.id');
        $this->assertSame($first, $this->beat($this->guest)->json('session.id'));

        $session = WorkSession::find($first);
        $this->assertTrue($session->is_open);
        $this->assertSame('Juan', $session->started_by_name);
        $this->assertSame(['Juan', 'Ana'], $session->participants);
        $this->assertSame(2, ActivityEntry::where('action', 'SESSION_JOIN')->count());
    }

    public function test_session_stays_open_until_everyone_leaves(): void
    {
        $this->beat($this->owner);
        $this->beat($this->guest);

        $this->leave($this->owner);
        $this->travel(WorkSession::LEAVE_GRACE_SECONDS + 5)->seconds();
        $this->beat($this->guest);
        $this->runClose();
        $this->assertSame(1, WorkSession::where('is_open', true)->count());
        $this->assertSame(1, ActivityEntry::where('action', 'SESSION_LEAVE')->where('actor_name', 'Juan')->count());

        $this->leave($this->guest);
        $this->travel(WorkSession::LEAVE_GRACE_SECONDS + 5)->seconds();
        $this->runClose();

        $session = WorkSession::first();
        $this->assertFalse($session->is_open);
        $this->assertNotNull($session->ended_at);
    }

    public function test_reloading_the_page_does_not_split_the_session(): void
    {
        $first = $this->beat($this->owner)->json('session.id');

        $this->leave($this->owner);
        $this->travel(2)->seconds();
        $second = $this->beat($this->owner)->json('session.id');

        $this->travel(WorkSession::LEAVE_GRACE_SECONDS + 5)->seconds();
        $this->runClose();

        $this->assertSame($first, $second);
        $this->assertTrue(WorkSession::find($first)->is_open);
        $this->assertSame(0, ActivityEntry::where('action', 'SESSION_LEAVE')->count());
    }

    public function test_several_sessions_can_happen_on_the_same_day(): void
    {
        $first = $this->beat($this->owner)->json('session.id');
        $this->leave($this->owner);
        $this->travel(WorkSession::LEAVE_GRACE_SECONDS + 5)->seconds();
        $this->runClose();

        $second = $this->beat($this->guest)->json('session.id');

        $this->assertNotSame($first, $second);
        $this->assertSame(2, WorkSession::where('diagram_id', $this->diagram->id)->count());
        $this->assertSame(1, WorkSession::where('is_open', true)->count());

        $sessions = $this->actingAs($this->owner)->getJson(route('diagrams.agent.state', $this->diagram->id))->json('sessions');
        $this->assertCount(2, $sessions);
    }

    public function test_session_closes_when_everyone_vanishes_without_notice(): void
    {
        $this->beat($this->owner);
        $this->travel(WorkSession::PRESENCE_TTL_SECONDS + 5)->seconds();

        Artisan::call('agent:close-abandoned-sessions');

        $session = WorkSession::first();
        $this->assertFalse($session->is_open);
        $this->assertSame(1, ActivityEntry::where('action', 'SESSION_LEAVE')->count());
    }

    public function test_activity_is_tied_to_the_open_session(): void
    {
        $id = $this->beat($this->owner)->json('session.id');

        $this->actingAs($this->owner)->postJson(route('diagrams.agent.activity', $this->diagram->id), [
            'entries' => [['action' => 'CREATE_CLASS', 'summary' => 'creó la clase Cliente']],
        ])->assertOk();

        $this->assertSame($id, ActivityEntry::where('action', 'CREATE_CLASS')->first()->work_session_id);
        $this->assertGreaterThan(0, WorkSession::find($id)->activity_count);
    }

    public function test_autosaves_do_not_create_versions_but_the_end_of_the_session_does(): void
    {
        $this->beat($this->owner);
        $service = app(DiagramService::class);

        // Los autoguardados de la sesión no dejan versiones...
        $service->save($this->diagram, ['data' => ['cells' => [['id' => 'a', 'umlData' => ['className' => 'A']]]]]);
        $this->travel(60)->seconds();
        $this->beat($this->owner);
        $service->save($this->diagram->fresh(), ['data' => ['cells' => [['id' => 'b', 'umlData' => ['className' => 'B']]]]]);
        $this->assertSame(0, DiagramSnapshot::count());

        // ...el último, al cerrar la sesión, sí.
        $this->leave($this->owner);
        $this->travel(WorkSession::LEAVE_GRACE_SECONDS + 5)->seconds();
        $this->runClose();

        $this->assertSame(1, DiagramSnapshot::count());
        $last = DiagramSnapshot::first();
        $this->assertSame('session_end', $last->reason);
        $this->assertSame('b', $last->data['cells'][0]['id']);
    }

    public function test_a_session_that_only_moved_classes_does_not_create_a_version(): void
    {
        $service = app(DiagramService::class);
        $cell = fn (int $x) => ['cells' => [['id' => 'a', 'position' => ['x' => $x, 'y' => 0], 'umlData' => ['className' => 'A']]]];

        $this->beat($this->owner);
        $service->save($this->diagram, ['data' => $cell(0)], DiagramSnapshot::MANUAL);
        $this->assertSame(1, DiagramSnapshot::count());

        $service->save($this->diagram->fresh(), ['data' => $cell(300)]);
        $this->leave($this->owner);
        $this->travel(WorkSession::LEAVE_GRACE_SECONDS + 5)->seconds();
        $this->runClose();

        $this->assertSame(1, DiagramSnapshot::count(), 'mover una clase no es una versión nueva');
    }

    public function test_each_session_starts_with_an_empty_chat_and_old_ones_stay_readable(): void
    {
        \Illuminate\Support\Facades\Bus::fake([\App\Jobs\ProcessAgentTurn::class]);
        $first = $this->beat($this->owner)->json('session.id');

        $this->actingAs($this->owner)->postJson(route('diagrams.agent.message', $this->diagram->id), ['text' => 'mensaje de la primera']);
        $this->assertSame(['mensaje de la primera'], array_column(
            $this->actingAs($this->guest)->getJson(route('diagrams.agent.state', $this->diagram->id))->json('messages'), 'text'));

        $this->leave($this->owner);
        $this->travel(WorkSession::LEAVE_GRACE_SECONDS + 5)->seconds();
        $this->runClose();
        $this->beat($this->guest);

        $state = $this->actingAs($this->guest)->getJson(route('diagrams.agent.state', $this->diagram->id))->json();
        $this->assertSame([], $state['messages']);
        $this->assertNotSame($first, $state['currentSessionId']);

        $old = $this->actingAs($this->guest)->getJson(route('diagrams.agent.session-messages', [$this->diagram->id, $first]))->assertOk();
        $this->assertSame('mensaje de la primera', $old->json('messages.0.text'));
    }

    public function test_owner_can_close_the_session_by_hand_and_a_new_one_starts(): void
    {
        $first = $this->beat($this->owner)->json('session.id');
        $this->beat($this->guest);

        $this->assertFalse($this->actingAs($this->guest)->getJson(route('diagrams.agent.state', $this->diagram->id))->json('canCloseSession'));
        $this->actingAs($this->guest)->postJson(route('diagrams.agent.close-session', $this->diagram->id))->assertForbidden();

        $this->assertTrue($this->actingAs($this->owner)->getJson(route('diagrams.agent.state', $this->diagram->id))->json('canCloseSession'));
        $this->actingAs($this->owner)->postJson(route('diagrams.agent.close-session', $this->diagram->id))->assertOk();

        $closed = WorkSession::find($first);
        $this->assertFalse($closed->is_open);
        $this->assertSame(1, ActivityEntry::where('action', 'SESSION_CLOSE')->count());

        $second = $this->beat($this->guest)->json('session.id');
        $this->assertNotSame($first, $second);

        $this->actingAs($this->owner)->postJson(route('diagrams.agent.close-session', $this->diagram->id))->assertOk();
        $this->actingAs($this->owner)->postJson(route('diagrams.agent.close-session', $this->diagram->id))->assertStatus(409);
    }

    public function test_outsider_cannot_join_a_session(): void
    {
        $outsider = User::factory()->create();

        $this->actingAs($outsider)->postJson(route('diagrams.agent.heartbeat', $this->diagram->id))->assertForbidden();
    }
}
