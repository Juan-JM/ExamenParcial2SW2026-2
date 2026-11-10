<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Avisos en vivo que no deben impedir guardar: si Reverb está caído, los datos ya
 * quedaron en la base y el pedido debe terminar bien. Lo pierde solo la pantalla
 * ajena, que se pone al día al recargar.
 */
class LiveBroadcast
{
    /** Tras una falla no se reintenta durante este tiempo, para no frenar cada petición. */
    private const PAUSE_AFTER_FAILURE_SECONDS = 15;

    private const PAUSE_KEY = 'live_broadcast_paused';

    public static function send(object $event): void
    {
        if (Cache::has(self::PAUSE_KEY)) {
            return;
        }

        try {
            broadcast($event);
        } catch (Throwable $e) {
            Cache::put(self::PAUSE_KEY, true, self::PAUSE_AFTER_FAILURE_SECONDS);
            Log::warning('LiveBroadcast: no se pudo difundir', ['event' => $event::class, 'error' => $e->getMessage()]);
        }
    }
}
