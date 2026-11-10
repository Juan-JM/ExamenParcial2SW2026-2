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
 * Cliente HTTP crudo para la API de Google AI Studio (Gemini).
 * No sabe nada de rotación/cooldown — eso vive en AiOrchestrator.
 */
class GeminiProvider implements AiProviderContract
{
    use StripsMarkdownJsonFence;

    public function generate(string $apiKey, string $model, array $messages): array
    {
        $systemText = collect($messages)
            ->where('role', 'system')
            ->pluck('content')
            ->implode("\n\n");

        $contents = collect($messages)
            ->where('role', 'user')
            ->map(fn (array $m) => [
                'role' => 'user',
                'parts' => [['text' => $m['content']]],
            ])
            ->values()
            ->all();

        return $this->call($apiKey, $model, $contents, $systemText);
    }

    /**
     * Igual que generate() pero el turno del usuario incluye una imagen
     * (usado por la importación de diagramas desde foto/captura — ver
     * SimpleImageImporter.js y documentacion/06-asistente-ia.md §9).
     */
    public function generateVision(string $apiKey, string $model, string $prompt, string $imageBase64, string $mimeType): array
    {
        $contents = [[
            'role' => 'user',
            'parts' => [
                ['text' => $prompt],
                ['inline_data' => ['mime_type' => $mimeType, 'data' => $imageBase64]],
            ],
        ]];

        return $this->call($apiKey, $model, $contents);
    }

    private function call(string $apiKey, string $model, array $contents, string $systemText = ''): array
    {
        $body = [
            'contents' => $contents,
            'generationConfig' => [
                'responseMimeType' => 'application/json',
                'temperature' => 0.1,
            ],
        ];

        if ($systemText !== '') {
            $body['systemInstruction'] = [
                'parts' => [['text' => $systemText]],
            ];
        }

        $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent";

        // 10s, no 30 — con la rotación por-cualquier-error de AiOrchestrator,
        // un timeout largo por intento multiplicado por varios modelos que
        // fallan en cadena termina superando el límite de ejecución de PHP
        // para una request web real (60s por defecto — a diferencia de la
        // CLI, que no tiene ese límite, por eso probar esto con `artisan
        // tinker` no lo detectaba). Ver también el presupuesto de tiempo
        // total en AiOrchestrator::run()/runVision().
        $response = Http::timeout(10)
            ->withHeaders(['Content-Type' => 'application/json'])
            ->post($url . '?key=' . urlencode($apiKey), $body);

        if ($response->status() === 429) {
            throw new AiRateLimitException(
                "Gemini rate limit para el modelo \"{$model}\"",
                $this->extractRetryAfterSeconds($response),
            );
        }

        if ($response->failed()) {
            throw new AiProviderException(
                "Gemini error {$response->status()} para el modelo \"{$model}\": " . $response->body()
            );
        }

        $text = data_get($response->json(), 'candidates.0.content.parts.0.text');

        if (!is_string($text) || trim($text) === '') {
            throw new AiProviderException("Gemini no devolvió texto para el modelo \"{$model}\" (posible bloqueo de safety filters).");
        }

        $decoded = json_decode($this->stripMarkdownJsonFence($text), true);

        if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
            throw new AiProviderException("Gemini devolvió un JSON inválido para el modelo \"{$model}\": " . json_last_error_msg());
        }

        return $decoded;
    }

    private function extractRetryAfterSeconds($response): int
    {
        $retryHeader = $response->header('Retry-After');
        if (is_numeric($retryHeader)) {
            return (int) $retryHeader;
        }

        $retryDelay = data_get($response->json(), 'error.details', []);
        foreach ((array) $retryDelay as $detail) {
            if (isset($detail['retryDelay']) && preg_match('/(\d+(?:\.\d+)?)s/', $detail['retryDelay'], $m)) {
                return (int) ceil((float) $m[1]);
            }
        }

        return (int) config('services.ai.default_cooldown_seconds', 30);
    }
}
