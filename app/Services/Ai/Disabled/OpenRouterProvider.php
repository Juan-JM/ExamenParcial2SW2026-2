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
 * Cliente HTTP crudo para OpenRouter (openrouter.ai) — agrega muchos
 * proveedores distintos (Meta, Mistral, Qwen, DeepSeek, etc.) bajo una sola
 * API compatible con el formato de chat completions de OpenAI, igual que
 * GrokProvider. No sabe nada de rotación/cooldown — eso vive en
 * AiOrchestrator.
 *
 * Se agregó como tercer/cuarto proveedor independiente (infraestructura
 * totalmente distinta a Gemini y a Grok) para tener redundancia real cuando
 * Gemini está inestable — ver documentacion/06-asistente-ia.md.
 *
 * Modelos gratis: OpenRouter los marca con el sufijo ":free" en el id
 * (ej. "meta-llama/llama-3.3-70b-instruct:free") — son de tasa limitada,
 * compartidos entre todos los usuarios gratis de OpenRouter. La lista en
 * `OPENROUTER_MODELS` (.env) es un punto de partida, NO una garantía de que
 * esos modelos sigan existiendo o siendo gratis — hay que confirmarla contra
 * https://openrouter.ai/models?max_price=0 (misma filosofía que ya aplica
 * a la lista de modelos de Gemini, revisar periódicamente).
 */
class OpenRouterProvider implements AiProviderContract
{
    use StripsMarkdownJsonFence;

    private const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

    public function generate(string $apiKey, string $model, array $messages): array
    {
        $response = Http::timeout(10)
            ->withToken($apiKey)
            ->withHeaders([
                // OpenRouter los pide para atribuir uso/rankings — no son
                // estrictamente obligatorios para que la request funcione,
                // pero es la práctica recomendada por ellos mismos.
                'HTTP-Referer' => config('app.url', 'http://localhost'),
                'X-Title' => config('app.name', 'Laravel'),
            ])
            ->post(self::ENDPOINT, [
                'model' => $model,
                'messages' => $messages,
                'response_format' => ['type' => 'json_object'],
                'temperature' => 0.1,
            ]);

        if ($response->status() === 429) {
            throw new AiRateLimitException(
                "OpenRouter rate limit para el modelo \"{$model}\"",
                $this->extractRetryAfterSeconds($response),
            );
        }

        if ($response->failed()) {
            throw new AiProviderException(
                "OpenRouter error {$response->status()} para el modelo \"{$model}\": " . $response->body()
            );
        }

        $text = data_get($response->json(), 'choices.0.message.content');

        if (!is_string($text) || trim($text) === '') {
            throw new AiProviderException("OpenRouter no devolvió texto para el modelo \"{$model}\".");
        }

        $decoded = json_decode($this->stripMarkdownJsonFence($text), true);

        if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
            throw new AiProviderException("OpenRouter devolvió un JSON inválido para el modelo \"{$model}\": " . json_last_error_msg());
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
