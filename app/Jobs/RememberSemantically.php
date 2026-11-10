<?php

namespace App\Jobs;

use App\Services\Vector\SemanticMemory;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

/** Indexa en segundo plano: calcular vectores no debe demorar a quien edita. */
class RememberSemantically implements ShouldQueue
{
    use Dispatchable, Queueable;

    public int $tries = 1;

    /** @param  list<array{kind: string, ref: string, text: string, diagram_id?: string|null, meta?: array}>  $items */
    public function __construct(public array $items)
    {
    }

    public function handle(SemanticMemory $memory): void
    {
        $memory->remember($this->items);
    }

    /** Solo encola si hay base vectorial configurada. */
    public static function later(array $items): void
    {
        if ($items !== [] && config('services.vector.enabled')) {
            static::dispatch($items);
        }
    }
}
