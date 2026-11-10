<?php

namespace App\Jobs;

use App\Models\Diagram;
use App\Services\Agent\DiagramSchemaExtractor;
use App\Services\Vector\SemanticMemory;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\Cache;

/**
 * Indexa las clases del diagrama para buscarlas por significado. Corre con
 * demora y a lo sumo una vez por intervalo: lee el diagrama al ejecutarse, así
 * que siempre toma el último guardado.
 */
class IndexDiagramClasses implements ShouldQueue
{
    use Dispatchable, Queueable;

    private const DELAY_SECONDS = 30;

    public int $tries = 1;

    public function __construct(public string $diagramId)
    {
    }

    public static function schedule(string $diagramId): void
    {
        if (config('services.vector.enabled') && Cache::add("index_classes:{$diagramId}", true, self::DELAY_SECONDS)) {
            static::dispatch($diagramId)->delay(now()->addSeconds(self::DELAY_SECONDS));
        }
    }

    public function handle(SemanticMemory $memory, DiagramSchemaExtractor $extractor): void
    {
        $diagram = Diagram::find($this->diagramId);

        if (!$diagram) {
            return;
        }

        $schema = $extractor->fromDiagram($diagram);
        $relationsByClass = [];

        foreach ($schema['relations'] as $relation) {
            $relationsByClass[$relation['sourceId']][] = "{$relation['type']} con {$relation['target']}";
            $relationsByClass[$relation['targetId']][] = "{$relation['type']} con {$relation['source']}";
        }

        $memory->remember(array_map(fn (array $class) => [
            'kind' => SemanticMemory::KIND_CLASS,
            'ref' => "{$diagram->id}:{$class['id']}",
            'diagram_id' => $diagram->id,
            'text' => trim(sprintf(
                'Clase %s. Atributos: %s. Métodos: %s. Relaciones: %s.',
                $class['name'],
                implode(', ', $class['attributes']) ?: 'ninguno',
                implode(', ', $class['methods']) ?: 'ninguno',
                implode('; ', $relationsByClass[$class['id']] ?? []) ?: 'ninguna',
            )),
            'meta' => ['element_id' => $class['id'], 'class_name' => $class['name']],
        ], $schema['classes']));
    }
}
