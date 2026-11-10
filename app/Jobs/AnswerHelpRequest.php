<?php

namespace App\Jobs;

use App\Events\HelpAnswered;
use App\Models\HelpRequest;
use App\Services\Help\HelpAssistant;
use App\Support\LiveBroadcast;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

/** En cola por el mismo motivo que los turnos de Nova: no bloquear el servidor mientras piensa el modelo. */
class AnswerHelpRequest implements ShouldQueue
{
    use Dispatchable, Queueable;

    public int $tries = 1;

    public int $timeout = 120;

    public function __construct(public string $helpRequestId)
    {
    }

    public function handle(HelpAssistant $assistant): void
    {
        $request = HelpRequest::find($this->helpRequestId);

        if (!$request) {
            return;
        }

        $assistant->answer($request);

        LiveBroadcast::send(new HelpAnswered($request->user_id, $request->toClientArray()));
    }
}
