<?php

namespace App\Services\Live;

use App\Events\LiveFloorChanged;
use App\Support\LiveBroadcast;
use Illuminate\Support\Facades\Cache;

/**
 * El "turno de palabra" de Nova en un diagrama. Varias personas pueden hablarle
 * a la vez: Nova las atiende de a una, en orden de llegada, y a las demás les
 * avisa con cortesía ("un momento, Ana, termino con Carlos").
 *
 * El modelo genera las respuestas en orden (un solo worker), pero cada respuesta
 * solo se dice en voz alta cuando es el turno de su dueño: así nadie se pisa y
 * la respuesta de quien espera ya está lista cuando le toca.
 *
 * El turno se libera cuando el navegador de quien habla termina de reproducir la
 * respuesta. Si ese aviso nunca llega (pestaña cerrada, sin audio), vence solo.
 */
class LiveFloor
{
    /** Mientras el modelo piensa, el turno aguanta este tiempo antes de darse por perdido. */
    private const THINKING_TTL_SECONDS = 200;

    /** Margen sobre la duración estimada de la voz. */
    private const SPEECH_MARGIN_SECONDS = 8;

    /** Caracteres que se dicen por segundo, aproximadamente. */
    private const CHARS_PER_SECOND = 14;

    private const KEY_TTL_SECONDS = 3600;

    /**
     * @return array{position: int, servingName: ?string} position 0: le toca ya.
     */
    public function join(string $diagramId, string $messageId, string $userId, string $userName): array
    {
        $queue = $this->load($diagramId);

        $queue[] = [
            'messageId' => $messageId,
            'userId' => $userId,
            'userName' => $userName,
            'status' => 'thinking',
            'expiresAt' => now()->timestamp + self::THINKING_TTL_SECONDS,
        ];

        $this->save($diagramId, $queue);

        $position = count($queue) - 1;

        return ['position' => $position, 'servingName' => $position > 0 ? $queue[0]['userName'] : null];
    }

    /** La respuesta ya está escrita: se calcula cuánto tardará en decirse. */
    public function markReady(string $diagramId, string $messageId, string $replyText): void
    {
        $queue = $this->load($diagramId);
        $seconds = (int) ceil(mb_strlen($replyText) / self::CHARS_PER_SECOND) + self::SPEECH_MARGIN_SECONDS;
        $found = false;

        foreach ($queue as &$entry) {
            if ($entry['messageId'] === $messageId) {
                $entry['status'] = 'ready';
                // El plazo de voz cuenta desde que le toca el turno, no desde ahora.
                $entry['speechSeconds'] = $seconds;
                $found = true;
            }
        }
        unset($entry);

        if ($found) {
            $this->save($diagramId, $this->stamp($queue));
        }
    }

    /**
     * Libera el turno. Lo puede pedir su dueño, o cualquiera si ya venció.
     */
    public function release(string $diagramId, string $messageId, ?string $byUserId = null): bool
    {
        $queue = $this->load($diagramId);
        $kept = array_values(array_filter($queue, function (array $entry) use ($messageId, $byUserId) {
            if ($entry['messageId'] !== $messageId) {
                return true;
            }

            $isOwner = $byUserId === null || (string) $entry['userId'] === (string) $byUserId;

            return !($isOwner || $entry['expiresAt'] < now()->timestamp);
        }));

        if (count($kept) === count($queue)) {
            return false;
        }

        $this->save($diagramId, $this->stamp($kept));

        return true;
    }

    /** @return array<string, mixed> */
    public function snapshot(string $diagramId): array
    {
        return $this->payload($this->load($diagramId));
    }

    /** @param  list<array<string, mixed>>  $queue */
    private function payload(array $queue): array
    {
        $current = $queue[0] ?? null;

        return [
            'currentMessageId' => $current['messageId'] ?? null,
            'currentUserId' => $current['userId'] ?? null,
            'currentUserName' => $current['userName'] ?? null,
            'expiresAt' => $current['expiresAt'] ?? null,
            'queue' => array_map(fn (array $e) => [
                'messageId' => $e['messageId'],
                'userId' => $e['userId'],
                'userName' => $e['userName'],
                'status' => $e['status'],
            ], $queue),
        ];
    }

    /**
     * Quien está primero arranca su plazo: si ya tiene respuesta, lo que dura en decirse;
     * si no, lo que aguante el modelo pensando.
     *
     * @param  list<array<string, mixed>>  $queue
     * @return list<array<string, mixed>>
     */
    private function stamp(array $queue): array
    {
        if ($queue === []) {
            return [];
        }

        $head = &$queue[0];
        $head['expiresAt'] = now()->timestamp + ($head['status'] === 'ready'
            ? ($head['speechSeconds'] ?? self::THINKING_TTL_SECONDS)
            : self::THINKING_TTL_SECONDS);

        return $queue;
    }

    /** @return list<array<string, mixed>> */
    private function load(string $diagramId): array
    {
        $queue = Cache::get($this->key($diagramId), []);
        $now = now()->timestamp;

        // Solo vence el primero: los de atrás todavía no empezaron su turno.
        while ($queue !== [] && ($queue[0]['expiresAt'] ?? 0) < $now) {
            array_shift($queue);
            $queue = $this->stamp($queue);
        }

        return array_values($queue);
    }

    /** @param  list<array<string, mixed>>  $queue */
    private function save(string $diagramId, array $queue): void
    {
        Cache::put($this->key($diagramId), $queue, self::KEY_TTL_SECONDS);

        LiveBroadcast::send(new LiveFloorChanged($diagramId, $this->payload($queue)));
    }

    private function key(string $diagramId): string
    {
        return "live-floor:{$diagramId}";
    }
}
