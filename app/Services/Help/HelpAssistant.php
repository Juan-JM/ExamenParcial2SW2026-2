<?php

namespace App\Services\Help;

use App\Models\HelpRequest;
use App\Services\Ai\AiOrchestrator;
use App\Services\Vector\SemanticMemory;
use Throwable;

/**
 * Asistente de uso de la aplicación. A diferencia de Nova (la IA del equipo, que
 * conversa en grupo y edita el diagrama), este es personal: responde solo a
 * quien pregunta, nunca edita, y se basa en lo que esa persona tiene en
 * pantalla y en la guía de uso.
 */
class HelpAssistant
{
    private const MAX_TARGETS = 60;

    public function __construct(
        private readonly AiOrchestrator $orchestrator,
        private readonly SemanticMemory $memory,
    ) {
    }

    public function answer(HelpRequest $request): HelpRequest
    {
        $page = $request->page ?? [];
        $targets = array_slice($page['targets'] ?? [], 0, self::MAX_TARGETS);
        $started = microtime(true);

        try {
            $raw = $this->orchestrator->run($this->system(), $this->user($request->question, $page, $targets), 90);

            $keys = array_column($targets, 'key');
            $steps = array_values(array_filter(array_map(
                fn ($step) => is_string($step) ? $this->withoutKeys(trim($step), $keys) : null,
                is_array($raw['steps'] ?? null) ? array_slice($raw['steps'], 0, 8) : [],
            )));
            $answer = $this->withoutKeys(trim((string) ($raw['answer'] ?? '')), $keys);

            $highlight = is_string($raw['highlight'] ?? null) && in_array($raw['highlight'], $keys, true)
                ? $raw['highlight']
                : $this->guessHighlight($steps[0] ?? $answer, $targets);

            $request->update([
                'status' => 'answered',
                'answer' => $answer ?: 'No encontré cómo ayudarte con eso. Probá contarme qué querés lograr.',
                'steps' => $steps,
                'highlight' => $highlight,
                'model' => $this->orchestrator->lastModel,
                'latency_ms' => (int) ((microtime(true) - $started) * 1000),
            ]);
        } catch (Throwable $e) {
            $request->update([
                'status' => 'failed',
                'answer' => 'El asistente no está disponible ahora: revisá que LM Studio u Ollama esté abierto con el modelo cargado.',
                'error' => mb_strimwidth($e->getMessage(), 0, 500),
            ]);
        }

        return $request;
    }

    private function system(): string
    {
        return <<<'PROMPT'
Sos el asistente de ayuda de un editor colaborativo de diagramas de clases UML
(una herramienta CASE). Tu único trabajo es enseñar a usar la aplicación a la
persona que te pregunta, según lo que ella tiene en pantalla AHORA. No editás
el diagrama ni hablás por el equipo.

Reglas:
- Basate en la GUÍA DE USO y en la PANTALLA ACTUAL. Si algo no aparece ahí, no
  inventes botones ni menús: decí que no lo ves y sugerí dónde buscarlo.
- Respondé en español, breve, en segunda persona ("hacé clic en…").
- Si hace falta más de una acción, listalas en "steps", cada una corta.
- En "highlight" poné la "key" (de ELEMENTOS VISIBLES) del primer elemento
  que la persona tiene que tocar. Usá null solo si ninguno de la lista sirve.
- En el texto nombrá los elementos por su texto visible, nunca por su "key".
- Si la persona pide que algo se haga en el diagrama (crear clases, etc.),
  explicá cómo hacerlo o sugerile pedírselo a Nova en la pestaña "Asistente IA".

Salida: solo JSON, sin markdown:
{ "answer": "texto", "steps": ["paso 1", "paso 2"], "highlight": "key" | null }
PROMPT;
    }

    private function user(string $question, array $page, array $targets): string
    {
        $guide = collect($this->memory->recall($question, null, 4, [SemanticMemory::KIND_HELP], 0.3))
            ->pluck('text')
            ->all();

        if ($guide === []) {
            $guide = $this->keywordGuide($question);
        }

        $elements = collect($targets)
            ->map(fn (array $target) => "- {$target['key']}: {$target['label']}".(!empty($target['kind']) ? " ({$target['kind']})" : ''))
            ->implode("\n");

        $context = collect([
            'Pantalla' => $page['screen'] ?? null,
            'Título' => $page['title'] ?? null,
            'Ruta' => $page['path'] ?? null,
            'Encabezados' => implode(' · ', $page['headings'] ?? []),
            'Ventana abierta' => $page['modal'] ?? null,
            'Pestaña lateral' => $page['editor']['sidebarTab'] ?? null,
            'Herramienta' => $page['editor']['tool'] ?? null,
            'Seleccionado' => $page['editor']['selection'] ?? null,
            'Panel de propiedades abierto' => isset($page['editor']['propertiesOpen']) ? ($page['editor']['propertiesOpen'] ? 'sí' : 'no') : null,
            'Rol' => $page['editor']['role'] ?? null,
            'Avisos en pantalla' => implode(' · ', $page['notices'] ?? []),
        ])->filter()->map(fn ($value, $key) => "{$key}: {$value}")->implode("\n");

        $guideText = $guide === [] ? '(sin secciones relacionadas)' : '- '.implode("\n- ", $guide);

        return <<<PROMPT
GUÍA DE USO (secciones relacionadas):
{$guideText}

PANTALLA ACTUAL:
{$context}

ELEMENTOS VISIBLES (key: texto):
{$elements}

PREGUNTA:
"{$question}"
PROMPT;
    }

    /**
     * Si el modelo no marcó qué señalar, se busca en el primer paso el texto de
     * un elemento visible ("Hacé clic en Exportar" → el botón Exportar). Gana
     * la coincidencia más larga, para no confundir "Clase" con "Clase asociativa".
     */
    private function guessHighlight(string $text, array $targets): ?string
    {
        // Si el paso nombra algo entre comillas ('Clase Cliente'), solo vale una
        // coincidencia exacta con eso: "Clase" a secas sería otro botón.
        if (preg_match_all('/[\'"«“‘]([^\'"»”’]{2,60})[\'"»”’]/u', $text, $quoted) && $quoted[1] !== []) {
            $names = array_map(fn ($name) => mb_strtolower(trim($name)), $quoted[1]);

            foreach ($targets as $target) {
                if (in_array(mb_strtolower(trim($target['label'])), $names, true)) {
                    return $target['key'];
                }
            }

            return null;
        }

        $haystack = mb_strtolower($text);
        $best = null;

        foreach ($targets as $target) {
            $label = mb_strtolower(trim($target['label']));

            if (mb_strlen($label) < 4 || !preg_match('/(?<![\p{L}\p{N}])'.preg_quote($label, '/').'(?![\p{L}\p{N}])/u', $haystack)) {
                continue;
            }

            if ($best === null || mb_strlen($label) > mb_strlen($best['label'])) {
                $best = ['key' => $target['key'], 'label' => $label];
            }
        }

        return $best['key'] ?? null;
    }

    /** El modelo a veces copia las claves internas ("h4: Herencia"): no deben llegar al usuario. */
    private function withoutKeys(string $text, array $keys): string
    {
        foreach ($keys as $key) {
            $text = preg_replace('/\b'.preg_quote($key, '/').':\s*/u', '', $text);
        }

        return $text;
    }

    /** Sin base vectorial: secciones de la guía que comparten palabras con la pregunta. */
    private function keywordGuide(string $question): array
    {
        $guide = (string) @file_get_contents(resource_path('help/guia-de-uso.md'));
        $words = array_filter(preg_split('/\W+/u', mb_strtolower($question)), fn ($word) => mb_strlen($word) > 3);

        return collect(preg_split('/^## /m', $guide))
            ->slice(1)
            ->map(fn ($section) => trim($section))
            ->sortByDesc(fn ($section) => collect($words)->filter(fn ($word) => str_contains(mb_strtolower($section), $word))->count())
            ->take(3)
            ->values()
            ->all();
    }
}
