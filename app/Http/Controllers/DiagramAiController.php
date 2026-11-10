<?php
// app/Http/Controllers/DiagramAiController.php

namespace App\Http\Controllers;

use App\Models\Diagram;
use App\Services\Ai\AiOrchestrator;
use App\Services\Ai\DiagramAiOpsValidator;
use App\Services\Ai\DiagramAiPromptBuilder;
use App\Services\Ai\Exceptions\AiAllModelsExhaustedException;
use App\Services\Ai\Exceptions\AiProviderException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

class DiagramAiController extends Controller
{
    public function __construct(
        private readonly AiOrchestrator $orchestrator,
        private readonly DiagramAiPromptBuilder $promptBuilder,
        private readonly DiagramAiOpsValidator $opsValidator,
    ) {
    }

    /**
     * Importa un diagrama a partir de una foto/captura (reemplaza la llamada
     * directa a Groq Vision que hacía SimpleImageImporter.js — ver
     * documentacion/06-asistente-ia.md). Usa el modelo local con visión.
     */
    public function importImage(Request $request, Diagram $diagram)
    {
        // Mismo respaldo defensivo que command() — ver su comentario.
        set_time_limit(150);

        if (!config('services.ai.enabled', true)) {
            return response()->json(['error' => 'ai_disabled', 'message' => 'El asistente de IA está deshabilitado.'], 503);
        }

        if (!$diagram->canBeEditedBy(Auth::user())) {
            abort(403, 'No tienes permisos para editar este diagrama.');
        }

        $validated = $request->validate([
            'image' => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
        ]);

        $file = $validated['image'];
        $imageBase64 = base64_encode(file_get_contents($file->getRealPath()));
        $mimeType = $file->getMimeType() ?: 'image/jpeg';

        try {
            $raw = $this->orchestrator->runVision(
                $this->promptBuilder->buildImageImportPrompt(),
                $imageBase64,
                $mimeType,
            );

            $result = $this->opsValidator->validateImageImport($raw);

            return response()->json($this->completeAssociativeClasses($result, $imageBase64, $mimeType));
        } catch (AiAllModelsExhaustedException $e) {
            return response()->json([
                'error' => 'ai_unavailable',
                'message' => $e->getMessage(),
                'retryAfterSeconds' => $e->retryAfterSeconds,
            ], 503);
        } catch (AiProviderException $e) {
            Log::warning('DiagramAiController: error de proveedor de IA (imagen)', ['message' => $e->getMessage()]);

            return response()->json([
                'error' => 'ai_provider_error',
                'message' => 'El asistente de IA no pudo analizar la imagen. Prueba con otra foto/captura.',
            ], 502);
        }
    }

    /**
     * Un modelo chico a veces no devuelve el enlace de la clase asociativa.
     * Si queda una clase suelta (sin ninguna relación), se le pregunta aparte
     * al modelo si está unida con línea punteada al medio de otra relación.
     */
    private function completeAssociativeClasses(array $result, string $imageBase64, string $mimeType): array
    {
        $names = array_column($result['classes'], 'name');
        $norm = fn (string $n) => mb_strtolower(trim($n));
        $linked = [];
        $withRel = [];

        foreach ($result['relationships'] as $rel) {
            $withRel[$norm($rel['from'])] = true;
            $withRel[$norm($rel['to'])] = true;
            if ($rel['type'] === 'associationClassLink') {
                $linked[$norm($rel['from'])] = true;
                // Los extremos de la asociación a la que se cuelga también tienen relación.
                $withRel[$norm($rel['viaTargetClass'])] = true;
            }
        }

        $orphans = array_values(array_filter($names, fn ($n) => !isset($withRel[$norm($n)]) && !isset($linked[$norm($n)])));

        if (count($names) < 3 || count($orphans) === 0 || count($orphans) > 2) {
            return $result;
        }

        foreach ($orphans as $orphan) {
            try {
                $answer = $this->orchestrator->runVision(
                    $this->promptBuilder->buildAssociativeClassCheckPrompt($orphan, $names),
                    $imageBase64,
                    $mimeType,
                );
            } catch (AiProviderException|AiAllModelsExhaustedException $e) {
                Log::info('DiagramAiController: no se pudo verificar la clase asociativa', ['clase' => $orphan]);
                continue;
            }

            $a = is_string($answer['classA'] ?? null) ? trim($answer['classA']) : '';
            $b = is_string($answer['classB'] ?? null) ? trim($answer['classB']) : '';
            $valid = fn (string $n) => $n !== '' && in_array($norm($n), array_map($norm, $names), true) && $norm($n) !== $norm($orphan);

            if (($answer['isAssociative'] ?? false) !== true || !$valid($a) || !$valid($b) || $norm($a) === $norm($b)) {
                continue;
            }

            $hasHost = false;
            foreach ($result['relationships'] as $rel) {
                if ($rel['type'] === 'associationClassLink') {
                    continue;
                }
                $pair = [$norm($rel['from']), $norm($rel['to'])];
                if (in_array($norm($a), $pair, true) && in_array($norm($b), $pair, true)) {
                    $hasHost = true;
                }
            }

            if (!$hasHost) {
                $result['relationships'][] = [
                    'type' => 'association', 'from' => $a, 'to' => $b,
                    'sourceMultiplicity' => '', 'targetMultiplicity' => '', 'label' => '',
                ];
            }

            $result['relationships'][] = ['type' => 'associationClassLink', 'from' => $orphan, 'to' => $a, 'viaTargetClass' => $b];
        }

        return $result;
    }
}
