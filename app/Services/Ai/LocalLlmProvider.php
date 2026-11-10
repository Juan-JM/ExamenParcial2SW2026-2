<?php

namespace App\Services\Ai;

use App\Services\Ai\Concerns\StripsMarkdownJsonFence;
use App\Services\Ai\Contracts\AiProviderContract;
use App\Services\Ai\Exceptions\AiProviderException;
use App\Services\Ai\Exceptions\AiRateLimitException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Modelo local vía API compatible con OpenAI. Sirve igual para LM Studio
 * (http://127.0.0.1:1234/v1) que para Ollama (http://127.0.0.1:11434/v1).
 */
class LocalLlmProvider implements AiProviderContract
{
    use StripsMarkdownJsonFence;

    /** Si el servidor local no responde, se espera este tiempo antes de reintentar. */
    private const UNAVAILABLE_COOLDOWN_SECONDS = 20;

    public function generate(string $apiKey, string $model, array $messages): array
    {
        return $this->complete($model, $messages);
    }

    public function generateVision(string $model, string $prompt, string $imageBase64, string $mimeType): array
    {
        return $this->complete($model, [[
            'role' => 'user',
            'content' => [
                ['type' => 'text', 'text' => $prompt],
                ['type' => 'image_url', 'image_url' => ['url' => "data:{$mimeType};base64,{$imageBase64}"]],
            ],
        ]]);
    }

    /** Vectores de texto para la búsqueda semántica (modelo de embeddings local). */
    public function embed(array $texts): array
    {
        $config = config('services.ai.local');

        try {
            $response = Http::connectTimeout(2)
                ->timeout(60)
                ->post(rtrim($config['base_url'], '/').'/embeddings', [
                    'model' => $config['embedding_model'],
                    'input' => array_values($texts),
                ]);
        } catch (ConnectionException $e) {
            throw new AiRateLimitException("Modelo de embeddings no disponible: {$e->getMessage()}", self::UNAVAILABLE_COOLDOWN_SECONDS);
        }

        if ($response->failed()) {
            throw new AiProviderException("El modelo de embeddings respondió {$response->status()}: ".$response->body());
        }

        return collect($response->json('data', []))
            ->sortBy('index')
            ->pluck('embedding')
            ->values()
            ->all();
    }

    private function complete(string $model, array $messages): array
    {
        $config = config('services.ai.local');

        try {
            $response = Http::connectTimeout(2)
                ->timeout((int) $config['timeout_seconds'])
                ->post(rtrim($config['base_url'], '/').'/chat/completions', [
                    'model' => $model,
                    'messages' => $messages,
                    'temperature' => 0.1,
                    'max_tokens' => (int) $config['max_tokens'],
                    'stream' => false,
                    // El razonamiento consume los tokens de salida antes de
                    // llegar al JSON. Cada servidor lo apaga de forma distinta.
                    'reasoning_effort' => 'none',
                    'think' => false,
                    'chat_template_kwargs' => ['enable_thinking' => false],
                    'response_format' => [
                        'type' => 'json_schema',
                        'json_schema' => ['name' => 'respuesta', 'schema' => ['type' => 'object']],
                    ],
                ]);
        } catch (ConnectionException $e) {
            throw new AiRateLimitException(
                "Modelo local \"{$model}\" no disponible: {$e->getMessage()}",
                self::UNAVAILABLE_COOLDOWN_SECONDS,
            );
        }

        if ($response->failed()) {
            throw new AiProviderException("Modelo local \"{$model}\" respondió {$response->status()}: ".$response->body());
        }

        $text = data_get($response->json(), 'choices.0.message.content');

        if (!is_string($text) || trim($text) === '') {
            throw new AiProviderException("El modelo local \"{$model}\" no devolvió texto.");
        }

        $text = trim((string) preg_replace('/<think>.*?<\/think>/s', '', $text));
        $decoded = json_decode($this->stripMarkdownJsonFence($text), true);

        if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
            throw new AiProviderException("El modelo local \"{$model}\" devolvió un JSON inválido: ".json_last_error_msg());
        }

        return $decoded;
    }
}
