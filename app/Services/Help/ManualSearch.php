<?php

namespace App\Services\Help;

use App\Services\Vector\SemanticMemory;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Busca en el manual de usuario (resources/help/guia-de-uso.md) las secciones
 * que responden la pregunta, para el Tutor.
 *
 * Búsqueda híbrida y rápida:
 * - Por palabras, en PHP y en memoria (≈1 ms): sin tildes, con raíces cortas
 *   ("elimino" encuentra "eliminar"), y el título y la línea "También:" pesan
 *   más que el cuerpo. Funciona aunque Qdrant o el modelo de embeddings estén
 *   apagados.
 * - Por significado (Qdrant), si está disponible.
 * Las dos listas se combinan por posición (reciprocal rank fusion): lo que
 * aparece arriba en ambas gana.
 */
class ManualSearch
{
    private const STOPWORDS = [
        'como', 'cómo', 'que', 'qué', 'para', 'por', 'con', 'una', 'uno', 'unos', 'unas', 'los', 'las', 'del', 'el',
        'la', 'lo', 'le', 'les', 'de', 'en', 'un', 'y', 'o', 'a', 'al', 'es', 'se', 'mi', 'mis', 'me', 'te', 'tu',
        'su', 'sus', 'yo', 'puedo', 'puede', 'quiero', 'hago', 'hacer', 'donde', 'dónde', 'esta', 'está', 'este',
        'esto', 'eso', 'ese', 'esa', 'hay', 'hola', 'necesito', 'ayuda', 'ayudame', 'ayúdame', 'favor', 'cual',
        'cuál', 'tengo', 'debo', 'algo', 'ahora', 'aqui', 'aquí', 'muestrame', 'muéstrame', 'indicame', 'indícame',
        'señalame', 'señálame', 'dime', 'si', 'no', 'ya', 'pero', 'cuando', 'mas', 'más',
    ];

    private const RRF_K = 10;

    /** Subirlo si cambia cómo se calculan los términos: invalida lo guardado en caché. */
    private const INDEX_VERSION = 2;

    public function __construct(private readonly SemanticMemory $memory)
    {
    }

    /**
     * @return list<string> texto de cada sección ("Título. cuerpo"), la más útil primero
     */
    public function search(string $question, int $limit = 3): array
    {
        $sections = $this->sections();
        if ($sections === []) {
            return [];
        }

        $ranks = [];
        foreach ($this->byWords($question, $sections) as $position => $title) {
            $ranks[$title] = ($ranks[$title] ?? 0) + 1 / (self::RRF_K + $position + 1);
        }
        foreach ($this->byMeaning($question) as $position => $title) {
            if (isset($sections[$title])) {
                $ranks[$title] = ($ranks[$title] ?? 0) + 1 / (self::RRF_K + $position + 1);
            }
        }

        arsort($ranks);

        return array_map(
            fn (string $title) => "{$title}. {$sections[$title]['body']}",
            array_slice(array_keys($ranks), 0, $limit),
        );
    }

    /** @return list<string> títulos ordenados por coincidencia de palabras */
    private function byWords(string $question, array $sections): array
    {
        $words = $this->terms($question);
        if ($words === []) {
            return [];
        }

        // Una palabra que aparece en casi todo el manual ("diagrama", "clase")
        // casi no distingue; una rara ("recupero", "ia") decide.
        $idf = $this->idf($sections);

        $scores = [];
        foreach ($sections as $title => $section) {
            $score = 0;
            foreach ($words as $word) {
                $score += ($idf[$word] ?? 0) * (
                    3 * ($section['title_terms'][$word] ?? 0)
                    + 2 * ($section['also_terms'][$word] ?? 0)
                    + min(2, $section['body_terms'][$word] ?? 0)
                );
            }
            if ($score > 0) {
                $scores[$title] = $score;
            }
        }

        arsort($scores);

        return array_slice(array_keys($scores), 0, 6);
    }

    /** @return array<string, float> rareza de cada término en el manual */
    private function idf(array $sections): array
    {
        $count = count($sections);
        $documents = [];

        foreach ($sections as $section) {
            foreach (array_keys($section['title_terms'] + $section['also_terms'] + $section['body_terms']) as $term) {
                $documents[$term] = ($documents[$term] ?? 0) + 1;
            }
        }

        return array_map(fn (int $df) => log(1 + $count / $df), $documents);
    }

    /** @return list<string> títulos ordenados por significado (vacío si Qdrant no está) */
    private function byMeaning(string $question): array
    {
        try {
            return collect($this->memory->recall($question, null, 6, [SemanticMemory::KIND_HELP], 0.3))
                ->map(fn (array $hit) => $hit['meta']['title'] ?? strtok($hit['text'], '.'))
                ->filter()
                ->values()
                ->all();
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * Secciones del manual con sus términos ya calculados. Se recalculan solo
     * cuando el archivo cambia.
     *
     * @return array<string, array{body: string, title_terms: array, also_terms: array, body_terms: array}>
     */
    private function sections(): array
    {
        $path = resource_path('help/guia-de-uso.md');
        $mtime = @filemtime($path) ?: 0;

        return Cache::rememberForever("help-manual-sections:v".self::INDEX_VERSION.":{$mtime}", function () use ($path) {
            $sections = [];

            foreach (array_slice(preg_split('/^## /m', (string) @file_get_contents($path)), 1) as $block) {
                [$title, $body] = array_pad(explode("\n", trim($block), 2), 2, '');
                $title = trim($title);
                $body = trim($body);

                $also = '';
                if (preg_match('/^También:\s*(.+)$/mu', $body, $match)) {
                    $also = $match[1];
                    $body = trim(str_replace($match[0], '', $body));
                }

                $sections[$title] = [
                    'body' => $body,
                    'title_terms' => array_count_values($this->terms($title)),
                    'also_terms' => array_count_values($this->terms($also)),
                    'body_terms' => array_count_values($this->terms($body)),
                ];
            }

            return $sections;
        });
    }

    /**
     * Palabras útiles, sin tildes y reducidas a una raíz corta: "elimino",
     * "eliminar" y "eliminación" quedan como "elimi".
     *
     * @return list<string>
     */
    private function terms(string $text): array
    {
        $text = mb_strtolower($text);
        $words = preg_split('/[^\p{L}\p{N}]+/u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $stop = array_flip(self::STOPWORDS);
        $terms = [];

        foreach ($words as $word) {
            if (isset($stop[$word]) || mb_strlen($word) < 2) {
                continue;
            }
            $plain = strtr($word, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u']);
            $terms[] = mb_strlen($plain) > 5 ? mb_substr($plain, 0, 5) : $plain;
        }

        return $terms;
    }
}
