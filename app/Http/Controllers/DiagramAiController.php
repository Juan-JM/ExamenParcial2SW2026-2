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
        set_time_limit(55);

        if (!config('services.ai.enabled', true)) {
            return response()->json(['error' => 'ai_disabled', 'message' => 'El asistente de IA está deshabilitado.'], 503);
        }

        if (!$diagram->canBeEditedBy(Auth::user())) {
            abort(403, 'No tenés permisos para editar este diagrama.');
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

            return response()->json($this->opsValidator->validateImageImport($raw));
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
                'message' => 'El asistente de IA no pudo analizar la imagen. Probá con otra foto/captura.',
            ], 502);
        }
    }
}
