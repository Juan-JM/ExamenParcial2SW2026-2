<?php

namespace App\Jobs;

use App\Models\WorkSession;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

/** Corre pasado el margen de salida: si nadie volvió, la sesión termina. */
class CloseWorkSessionIfEmpty implements ShouldQueue
{
    use Dispatchable, Queueable;

    public function __construct(public string $workSessionId)
    {
    }

    public function handle(): void
    {
        WorkSession::find($this->workSessionId)?->refreshPresence();
    }
}
