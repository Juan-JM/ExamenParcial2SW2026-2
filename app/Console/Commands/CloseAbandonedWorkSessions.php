<?php

namespace App\Console\Commands;

use App\Models\WorkSession;
use Illuminate\Console\Command;

/** Cierra sesiones cuyos participantes desaparecieron sin avisar (corte de luz, sin red). */
class CloseAbandonedWorkSessions extends Command
{
    protected $signature = 'agent:close-abandoned-sessions';

    protected $description = 'Cierra las sesiones de trabajo sin nadie presente';

    public function handle(): int
    {
        foreach (WorkSession::where('is_open', true)->get() as $session) {
            $session->refreshPresence();
        }

        return self::SUCCESS;
    }
}
