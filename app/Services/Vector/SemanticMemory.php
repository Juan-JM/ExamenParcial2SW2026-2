<?php

namespace App\Services\Vector;

use App\Services\Ai\LocalLlmProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Memoria semántica: convierte textos en vectores con el modelo de embeddings
 * local y los guarda en Qdrant, para encontrar lo que el usuario quiere decir
 * aunque no use las mismas palabras ("¿quién cambió lo de los pagos?" encuentra
 * "Ana agregó el atributo monto a Factura").
 *
 * Nada de esto puede romper la app: si Qdrant o el modelo de embeddings no
 * están, se registra y se sigue sin búsqueda semántica.
 */
class SemanticMemory
{
    public const KIND_ACTIVITY = 'activity';

    public const KIND_MESSAGE = 'message';

    public const KIND_CLASS = 'class';

    public const KIND_HELP = 'help';

    /** Tras una falla no se reintenta durante este tiempo, para no frenar cada turno. */
    private const PAUSE_SECONDS = 60;

    public function __construct(
        private readonly QdrantStore $store,
        private readonly LocalLlmProvider $embeddings,
    ) {
    }

    public function isAvailable(): bool
    {
        return $this->store->isConfigured() && !Cache::has('semantic_memory_paused');
    }

    /**
     * @param  list<array{kind: string, ref: string, text: string, diagram_id?: string|null, meta?: array}>  $items
     */
    public function remember(array $items): void
    {
        $items = array_values(array_filter($items, fn (array $item) => trim($item['text']) !== ''));

        if ($items === [] || !$this->isAvailable()) {
            return;
        }

        $this->guard(function () use ($items) {
            $vectors = $this->embeddings->embed(array_column($items, 'text'));

            $this->store->upsert(array_map(fn (array $item, array $vector) => [
                'id' => $this->pointId($item['kind'], $item['ref']),
                'vector' => $vector,
                'payload' => [
                    'kind' => $item['kind'],
                    'ref' => $item['ref'],
                    'diagram_id' => $item['diagram_id'] ?? 'global',
                    'text' => $item['text'],
                    'created_at' => now()->toISOString(),
                ] + ($item['meta'] ?? []),
            ], $items, $vectors));
        });
    }

    /**
     * Lo más parecido en significado a la consulta, dentro del diagrama (y la guía
     * de uso, que es global).
     *
     * @return list<array{score: float, kind: string, text: string, meta: array}>
     */
    public function recall(string $query, ?string $diagramId, int $limit = 6, ?array $kinds = null, float $minScore = 0.35): array
    {
        if (trim($query) === '' || !$this->isAvailable()) {
            return [];
        }

        return $this->guard(function () use ($query, $diagramId, $limit, $kinds, $minScore) {
            $vector = $this->embeddings->embed([$query])[0] ?? null;

            if (!$vector) {
                return [];
            }

            $hits = $diagramId !== null
                ? [
                    ...$this->store->search($vector, ['diagram_id' => $diagramId], $limit, $kinds),
                    ...($kinds === null || in_array(self::KIND_HELP, $kinds, true)
                        ? $this->store->search($vector, ['diagram_id' => 'global'], 3, [self::KIND_HELP])
                        : []),
                ]
                : $this->store->search($vector, [], $limit, $kinds);

            usort($hits, fn ($a, $b) => $b['score'] <=> $a['score']);

            return array_values(array_map(fn (array $hit) => [
                'score' => round($hit['score'], 3),
                'kind' => $hit['payload']['kind'] ?? '',
                'text' => $hit['payload']['text'] ?? '',
                'meta' => array_diff_key($hit['payload'], array_flip(['kind', 'text'])),
            ], array_filter($hits, fn (array $hit) => $hit['score'] >= $minScore)));
        }) ?? [];
    }

    /** Qdrant acepta como id un UUID: se deriva siempre igual del contenido indexado. */
    private function pointId(string $kind, string $ref): string
    {
        $hash = md5("{$kind}:{$ref}");

        return sprintf('%s-%s-%s-%s-%s', substr($hash, 0, 8), substr($hash, 8, 4), substr($hash, 12, 4), substr($hash, 16, 4), substr($hash, 20, 12));
    }

    private function guard(\Closure $work): mixed
    {
        try {
            return $work();
        } catch (Throwable $e) {
            Cache::put('semantic_memory_paused', true, self::PAUSE_SECONDS);
            Log::warning('SemanticMemory: búsqueda semántica no disponible', ['error' => $e->getMessage()]);

            return null;
        }
    }
}
