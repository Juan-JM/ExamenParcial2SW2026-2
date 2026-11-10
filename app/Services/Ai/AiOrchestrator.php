<?php

namespace App\Services\Ai;

use App\Services\Ai\Exceptions\AiAllModelsExhaustedException;
use App\Services\Ai\Exceptions\AiRateLimitException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Punto único de llamada a la IA. Solo usa el modelo local (LM Studio u Ollama):
 * los proveedores en la nube quedaron desactivados en app/Services/Ai/Disabled.
 *
 * Si hay varios modelos en LOCAL_LLM_MODELS, se prueban en orden: sirve para
 * tener uno chico de respaldo si el grande no entra en memoria.
 */
class AiOrchestrator
{
    /** Tiempo máximo de un pedido completo, sumando todos los modelos probados. */
    private const DEFAULT_TIME_BUDGET_SECONDS = 150;

    /** Modelo que resolvió el último pedido. */
    public ?string $lastAccountId = null;

    public ?string $lastModel = null;

    public function __construct(private readonly LocalLlmProvider $local)
    {
    }

    /**
     * @return array<string, mixed>  El envelope JSON ya decodificado (lo valida DiagramAiOpsValidator).
     *
     * @throws AiAllModelsExhaustedException
     */
    public function run(string $systemPrompt, string $userPrompt, ?int $timeBudgetSeconds = null): array
    {
        $messages = [
            ['role' => 'system', 'content' => $systemPrompt],
            ['role' => 'user', 'content' => $userPrompt],
        ];

        return $this->attempt(
            fn (string $model) => $this->local->generate('local', $model, $messages),
            $timeBudgetSeconds ?? self::DEFAULT_TIME_BUDGET_SECONDS,
        );
    }

    /**
     * Importación de un diagrama desde una foto: requiere un modelo con visión
     * (Qwen3.5 la tiene).
     *
     * @return array<string, mixed>
     *
     * @throws AiAllModelsExhaustedException
     */
    public function runVision(string $prompt, string $imageBase64, string $mimeType): array
    {
        return $this->attempt(
            fn (string $model) => $this->local->generateVision($model, $prompt, $imageBase64, $mimeType),
            self::DEFAULT_TIME_BUDGET_SECONDS,
        );
    }

    /** @return list<string> */
    public function models(): array
    {
        if (!config('services.ai.local.enabled')) {
            return [];
        }

        return array_values(array_filter(array_map('trim', (array) config('services.ai.local.models'))));
    }

    private function attempt(\Closure $call, int $budgetSeconds): array
    {
        $models = $this->models();

        if ($models === []) {
            throw new AiAllModelsExhaustedException(
                'El modelo local está desactivado (AI_LOCAL_ENABLED=false) o no hay modelos en LOCAL_LLM_MODELS.',
                0,
            );
        }

        $startedAt = microtime(true);
        $earliestRetry = null;

        foreach ($models as $model) {
            if ((microtime(true) - $startedAt) >= $budgetSeconds) {
                break;
            }

            $cooldownKey = "ai_cooldown:local:{$model}";
            $until = Cache::get($cooldownKey);

            if ($until !== null && now()->lt($until)) {
                $earliestRetry = $earliestRetry === null || $until->lt($earliestRetry) ? $until : $earliestRetry;

                continue;
            }

            try {
                $result = $call($model);
                $this->lastAccountId = 'local';
                $this->lastModel = $model;

                Log::info('AiOrchestrator: respondió el modelo local', ['model' => $model, 'type' => $result['type'] ?? null]);

                return $result;
            } catch (AiRateLimitException $e) {
                // Servidor local apagado o saturado: no insistir en cada pedido.
                $until = now()->addSeconds($e->retryAfterSeconds);
                Cache::put($cooldownKey, $until, $until);
                $earliestRetry = $earliestRetry === null || $until->lt($earliestRetry) ? $until : $earliestRetry;
                Log::warning('AiOrchestrator: modelo local no disponible', ['model' => $model, 'error' => $e->getMessage()]);
            } catch (Throwable $e) {
                Log::warning('AiOrchestrator: el modelo local falló', ['model' => $model, 'error' => $e->getMessage()]);
            }
        }

        throw new AiAllModelsExhaustedException(
            'El modelo local no respondió. Revisa que LM Studio u Ollama esté abierto con el modelo cargado.',
            $earliestRetry ? max(1, $earliestRetry->getTimestamp() - now()->getTimestamp()) : 0,
        );
    }
}
