<?php

namespace App\Services\Vector;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Cliente de Qdrant, la base de datos vectorial. Guarda cada texto como un vector
 * (embedding) con sus datos, y busca por cercanía de significado.
 */
class QdrantStore
{
    private bool $collectionReady = false;

    public function isConfigured(): bool
    {
        return (bool) config('services.vector.enabled');
    }

    /** @param  list<array{id: string, vector: list<float>, payload: array<string, mixed>}>  $points */
    public function upsert(array $points): void
    {
        if ($points === []) {
            return;
        }

        $this->ensureCollection(count($points[0]['vector']));

        $this->request('put', "/collections/{$this->collection()}/points?wait=true", ['points' => $points]);
    }

    /**
     * @param  array<string, string>  $filters  Campo => valor exacto.
     * @return list<array{score: float, payload: array<string, mixed>}>
     */
    public function search(array $vector, array $filters = [], int $limit = 8, ?array $kinds = null): array
    {
        $must = [];

        foreach ($filters as $key => $value) {
            $must[] = ['key' => $key, 'match' => ['value' => $value]];
        }

        if ($kinds) {
            $must[] = ['key' => 'kind', 'match' => ['any' => array_values($kinds)]];
        }

        $response = $this->request('post', "/collections/{$this->collection()}/points/search", array_filter([
            'vector' => $vector,
            'limit' => $limit,
            'with_payload' => true,
            'filter' => $must ? ['must' => $must] : null,
        ]), allowMissingCollection: true);

        return array_map(fn (array $hit) => [
            'score' => (float) $hit['score'],
            'payload' => $hit['payload'] ?? [],
        ], $response['result'] ?? []);
    }

    private function ensureCollection(int $dimension): void
    {
        if ($this->collectionReady) {
            return;
        }

        $exists = Http::timeout(5)->get($this->url("/collections/{$this->collection()}"));

        if ($exists->status() === 404) {
            $this->request('put', "/collections/{$this->collection()}", [
                'vectors' => ['size' => $dimension, 'distance' => 'Cosine'],
            ]);

            foreach (['diagram_id', 'kind'] as $field) {
                $this->request('put', "/collections/{$this->collection()}/index", [
                    'field_name' => $field,
                    'field_schema' => 'keyword',
                ]);
            }
        } elseif ($exists->failed()) {
            throw new RuntimeException('Qdrant respondió '.$exists->status());
        }

        $this->collectionReady = true;
    }

    private function request(string $method, string $path, array $body, bool $allowMissingCollection = false): array
    {
        $response = Http::connectTimeout(1)->timeout(10)->{$method}($this->url($path), $body);

        if ($allowMissingCollection && $response->status() === 404) {
            return ['result' => []];
        }

        if ($response->failed()) {
            throw new RuntimeException("Qdrant {$method} {$path} respondió {$response->status()}: {$response->body()}");
        }

        return $response->json() ?? [];
    }

    private function url(string $path): string
    {
        return rtrim(config('services.vector.url'), '/').$path;
    }

    private function collection(): string
    {
        return config('services.vector.collection');
    }
}
