<?php

namespace App\Console\Commands;

use App\Jobs\IndexDiagramClasses;
use App\Models\ActivityEntry;
use App\Models\AiMessage;
use App\Models\Diagram;
use App\Services\Agent\DiagramSchemaExtractor;
use App\Services\Vector\SemanticMemory;
use Illuminate\Console\Command;

/**
 * Carga en la base vectorial la guía de uso y, con --all, todo el historial ya
 * existente (actividad, mensajes y clases de cada diagrama).
 */
class IndexSemanticMemory extends Command
{
    protected $signature = 'vector:index {--all : También el historial y las clases de todos los diagramas}';

    protected $description = 'Indexa la guía de uso (y opcionalmente el historial) en la base vectorial';

    public function handle(SemanticMemory $memory, DiagramSchemaExtractor $extractor): int
    {
        if (!$memory->isAvailable()) {
            $this->error('La base vectorial está desactivada (VECTOR_ENABLED) o pausada por una falla reciente.');

            return self::FAILURE;
        }

        // Se borra la guía vieja primero: si una sección cambió de título o se
        // quitó, no debe seguir apareciendo en las búsquedas.
        app(\App\Services\Vector\QdrantStore::class)->deleteKind(SemanticMemory::KIND_HELP);

        $sections = $this->helpSections();
        $memory->remember($sections);
        $this->line(count($sections).' secciones de la guía de uso');

        if (!$this->option('all')) {
            return $this->finish($memory);
        }

        ActivityEntry::orderBy('created_at')->chunk(50, function ($entries) use ($memory) {
            $memory->remember($entries->map(fn (ActivityEntry $entry) => ActivityIndexText::forActivity($entry))->all());
        });
        $this->line(ActivityEntry::count().' entradas de actividad');

        AiMessage::whereIn('role', [AiMessage::ROLE_USER, AiMessage::ROLE_ASSISTANT])->orderBy('created_at')->chunk(50, function ($messages) use ($memory) {
            $memory->remember($messages->map(fn (AiMessage $message) => ActivityIndexText::forMessage($message))->all());
        });
        $this->line(AiMessage::count().' mensajes');

        foreach (Diagram::all(['_id']) as $diagram) {
            (new IndexDiagramClasses($diagram->id))->handle($memory, $extractor);
        }
        $this->line(Diagram::count().' diagramas');

        return $this->finish($memory);
    }

    private function finish(SemanticMemory $memory): int
    {
        if (!$memory->isAvailable()) {
            $this->error('Falló la indexación: revisa que Qdrant y el modelo de embeddings estén corriendo (ver storage/logs/laravel.log).');

            return self::FAILURE;
        }

        $this->info('Listo.');

        return self::SUCCESS;
    }

    /** @return list<array{kind: string, ref: string, text: string, diagram_id: string}> */
    private function helpSections(): array
    {
        $guide = file_get_contents(resource_path('help/guia-de-uso.md'));
        $sections = [];

        foreach (preg_split('/^## /m', $guide) as $index => $block) {
            if ($index === 0) {
                continue;
            }

            [$title, $body] = array_pad(explode("\n", trim($block), 2), 2, '');
            $sections[] = [
                'kind' => SemanticMemory::KIND_HELP,
                'ref' => 'guia:'.md5($title),
                'diagram_id' => 'global',
                'text' => "{$title}. ".trim($body),
                'meta' => ['title' => $title],
            ];
        }

        return $sections;
    }
}
