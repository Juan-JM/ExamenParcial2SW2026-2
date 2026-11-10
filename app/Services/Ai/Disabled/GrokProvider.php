<?php

namespace App\Services\Ai\Disabled;

// DESACTIVADO: el sistema funciona solo con el modelo local (LocalLlmProvider).
// Esta clase ya no se usa en ningún lado; se conserva como referencia.

use App\Services\Ai\Concerns\StripsMarkdownJsonFence;
use App\Services\Ai\Contracts\AiProviderContract;
use App\Services\Ai\Exceptions\AiProviderException;
use App\Services\Ai\Exceptions\AiRateLimitException;
use Illuminate\Support\Facades\Http;

/**
 * Cliente HTTP crudo para la API de xAI (Grok) — compatible con el formato
 * de chat completions de OpenAI. No sabe nada de rotación/cooldown — eso
 * vive en AiOrchestrator.
 */
class GrokProvider implements AiProviderContract
{
    use StripsMarkdownJsonFence;

    private const ENDPOINT = 'https://api.x.ai/v1/chat/completions';

    public function generate(string $apiKey, string $model, array $messages): array
    {
        // 10s — mismo motivo que GeminiProvider, ver su comentario.
        $response = Http::timeout(10)
            ->withToken($apiKey)
            ->post(self::ENDPOINT, [
                'model' => $model,
                'messages' => $messages,
                'response_format' => ['type' => 'json_object'],
                'temperature' => 0.1,
            ]);

        if ($response->status() === 429) {
            throw new AiRateLimitException(
                "Grok rate limit para el modelo \"{$model}\"",
                $this->extractRetryAfterSeconds($response),
            );
        }

        if ($response->failed()) {
            throw new AiProviderException(
                "Grok error {$response->status()} para el modelo \"{$model}\": " . $response->body()
            );
        }

        $text = data_get($response->json(), 'choices.0.message.content');

        if (!is_string($text) || trim($text) === '') {
            throw new AiProviderException("Grok no devolvió texto para el modelo \"{$model}\".");
        }

        $decoded = json_decode($this->stripMarkdownJsonFence($text), true);

        if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
            throw new AiProviderException("Grok devolvió un JSON inválido para el modelo \"{$model}\": " . json_last_error_msg());
        }

        return $decoded;
    }

    private function extractRetryAfterSeconds($response): int
    {
        $retryHeader = $response->header('Retry-After');
        if (is_numeric($retryHeader)) {
            return (int) $retryHeader;
        }

        return (int) config('services.ai.default_cooldown_seconds', 30);
    }
}
