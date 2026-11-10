<?php

namespace App\Jobs;

use App\Models\AiMessage;
use App\Services\Agent\CollaborativeAgent;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * Un turno de la IA. Va en cola porque `php artisan serve` en Windows atiende
 * una petición a la vez: esperar al modelo dentro de la petición congelaría la
 * app para todo el equipo. Con un solo worker los turnos se procesan de a uno.
 */
class ProcessAgentTurn implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 1;

    public int $timeout = 240;

    public function __construct(public string $messageId, public ?array $schema = null)
    {
    }

    public function handle(CollaborativeAgent $agent): void
    {
        $message = AiMessage::find($this->messageId);

        if ($message) {
            $agent->respond($message, $this->schema);
        }
    }
}
