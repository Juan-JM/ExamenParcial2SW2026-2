<?php

namespace App\Models;

use App\Events\WorkSessionClosed;
use App\Jobs\CloseWorkSessionIfEmpty;
use App\Support\LiveBroadcast;
use App\Services\Agent\ActivityLog;
use Illuminate\Database\Eloquent\Relations\HasMany;
use MongoDB\Driver\Exception\BulkWriteException;
use MongoDB\Laravel\Eloquent\Model;

/**
 * Una sesión de trabajo sobre un diagrama: empieza cuando alguien lo abre y
 * termina cuando todos se fueron. Puede haber varias en un mismo día. No es lo
 * mismo que DiagramSession, que controla la colaboración en vivo (locks, roles).
 *
 * Reverb no avisa al servidor cuando alguien se desconecta, así que la presencia
 * se sabe por un latido del editor y un aviso al cerrar la pestaña.
 */
class WorkSession extends Model
{
    /** Sin latido durante este tiempo, se considera que la persona se fue (pestaña cerrada de golpe, sin red). */
    public const PRESENCE_TTL_SECONDS = 90;

    /** Margen tras salir: recargar la página no debe partir la sesión en dos. */
    public const LEAVE_GRACE_SECONDS = 30;

    protected $table = 'work_sessions';

    protected $fillable = [
        'diagram_id',
        'is_open',
        'started_at',
        'ended_at',
        'started_by_id',
        'started_by_name',
        'participants',
        'activity_count',
    ];

    protected $attributes = [
        'is_open' => true,
        'activity_count' => 0,
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
        'is_open' => 'boolean',
    ];

    public function attendees(): HasMany
    {
        return $this->hasMany(WorkSessionAttendee::class);
    }

    /** La sesión en curso del diagrama, o null si nadie lo tiene abierto. */
    public static function open(Diagram $diagram): ?self
    {
        $session = static::where('diagram_id', $diagram->id)->where('is_open', true)->first();

        if ($session && !$session->refreshPresence()) {
            return null;
        }

        return $session;
    }

    /** Alguien abrió el diagrama o sigue con él abierto. */
    public static function heartbeat(Diagram $diagram, User $user, ?array $context = null): self
    {
        $session = static::open($diagram) ?? static::begin($diagram, $user);
        $session->touchAttendee($user, $context);

        return $session;
    }

    private static function begin(Diagram $diagram, User $user): self
    {
        try {
            return static::create([
                'diagram_id' => $diagram->id,
                'started_at' => now(),
                'started_by_id' => $user->id,
                'started_by_name' => $user->name,
                'participants' => [],
            ]);
        } catch (BulkWriteException) {
            // Otro usuario la abrió en el mismo instante (índice único parcial).
            return static::where('diagram_id', $diagram->id)->where('is_open', true)->firstOrFail();
        }
    }

    private function touchAttendee(User $user, ?array $context = null): void
    {
        $attendee = $this->attendees()->where('user_id', $user->id)->first();

        if ($attendee) {
            $attendee->update(['last_seen_at' => now(), 'left_at' => null] + ($context ? ['context' => $context] : []));

            return;
        }

        $this->attendees()->create([
            'user_id' => $user->id,
            'name' => $user->name,
            'joined_at' => now(),
            'last_seen_at' => now(),
            'context' => $context,
        ]);

        $this->push('participants', $user->name, true);

        app(ActivityLog::class)->system($this->diagram_id, $user, 'SESSION_JOIN', 'entró al diagrama');
    }

    /** La persona cerró la pestaña. Se confirma pasado el margen, por si solo recargaba. */
    public function leave(User $user): void
    {
        $this->attendees()->where('user_id', $user->id)->update(['left_at' => now()]);

        CloseWorkSessionIfEmpty::dispatch($this->id)->delay(now()->addSeconds(self::LEAVE_GRACE_SECONDS + 2));
    }

    /**
     * Registra la salida de quienes ya no están y cierra la sesión si no queda
     * nadie. Devuelve si sigue abierta.
     */
    public function refreshPresence(): bool
    {
        if (!$this->is_open) {
            return false;
        }

        $present = 0;
        $lastSeen = $this->started_at;

        $attendees = $this->attendees()->get();

        foreach ($attendees as $attendee) {
            $goneAt = $attendee->gone_at ?? $attendee->departureTime();

            if ($goneAt === null) {
                $present++;

                continue;
            }

            if ($attendee->gone_at === null) {
                $attendee->update(['gone_at' => $goneAt]);
                app(ActivityLog::class)->departure($this, $attendee, $goneAt);
            }

            if ($goneAt->gt($lastSeen)) {
                $lastSeen = $goneAt;
            }
        }

        // Sin asistentes todavía: quien la abrió está registrándose en este instante.
        $justCreated = $attendees->isEmpty() && $this->started_at->gt(now()->subSeconds(self::PRESENCE_TTL_SECONDS));

        if ($present > 0 || $justCreated) {
            return true;
        }

        $this->update(['is_open' => false, 'ended_at' => $lastSeen]);
        DiagramSnapshot::capture($this->diagram_id, $this->id, DiagramSnapshot::SESSION_END);

        return false;
    }

    /** Quien tiene permiso puede cerrarla a mano: el dueño del diagrama o quien la abrió. */
    public function canBeClosedBy(User $user): bool
    {
        return $user->id === $this->started_by_id
            || Diagram::where('_id', $this->diagram_id)->where('user_id', $user->id)->exists();
    }

    /** Cierre manual. Los que siguen conectados empiezan una sesión nueva con chat vacío. */
    public function close(User $by): void
    {
        $this->attendees()->whereNull('gone_at')->update(['gone_at' => now()]);
        $this->update(['is_open' => false, 'ended_at' => now()]);

        app(ActivityLog::class)->system($this->diagram_id, $by, 'SESSION_CLOSE', 'cerró la sesión de trabajo');
        DiagramSnapshot::capture($this->diagram_id, $this->id, DiagramSnapshot::SESSION_END, $by);

        LiveBroadcast::send(new WorkSessionClosed($this->diagram_id, $this->id, $by->name));
    }

    public function registerActivity(int $count = 1): void
    {
        $this->increment('activity_count', $count);
    }

    public function toClientArray(): array
    {
        return [
            'id' => $this->id,
            'isOpen' => $this->is_open,
            'startedAt' => $this->started_at?->toISOString(),
            'endedAt' => $this->ended_at?->toISOString(),
            'startedByName' => $this->started_by_name,
            'participants' => $this->participants ?? [],
            'activityCount' => $this->activity_count,
        ];
    }
}
