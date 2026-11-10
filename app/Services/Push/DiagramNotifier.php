<?php

namespace App\Services\Push;

use App\Jobs\NotifyDiagramMembers;
use Illuminate\Support\Facades\Cache;

/**
 * Decide cuándo algo del diagrama merece un aviso en el celular.
 *
 * - Hechos puntuales (alguien entra, guarda, importa, limpia, restaura o
 *   renombra el diagrama): siempre avisan.
 * - Ediciones (crear, borrar o editar clases y relaciones): como máximo
 *   un aviso por minuto **por persona y diagrama**. Arrastrar clases o editar
 *   diez atributos seguidos no genera diez avisos, pero lo que hace una
 *   persona nunca silencia lo que hace otra.
 */
class DiagramNotifier
{
    private const THROTTLE_SECONDS = 60;

    private const ALWAYS = [
        'SESSION_JOIN', 'SAVE', 'IMPORT', 'CLEAR_DIAGRAM', 'RESTORE_VERSION', 'RENAME_DIAGRAM',
    ];

    private const EDITS = [
        'CREATE_CLASS', 'DELETE_CLASS', 'RENAME_CLASS', 'EDIT_CLASS',
        'CREATE_RELATION', 'DELETE_RELATION', 'EDIT_RELATION',
    ];
    // Mover clases (MOVE_CLASS) no avisa: es reacomodar, no cambiar el modelo.

    /** @param  list<array<string, mixed>>  $entries */
    public function activity(string $diagramId, array $entries): void
    {
        $edits = [];

        foreach ($entries as $entry) {
            if (in_array($entry['action'], self::ALWAYS, true)) {
                $this->dispatch($diagramId, $entry);
            } elseif (in_array($entry['action'], self::EDITS, true)) {
                $edits[$entry['actorId'] ?? ''][] = $entry;
            }
        }

        foreach ($edits as $actorId => $actorEdits) {
            if (Cache::add("push_throttle:{$diagramId}:{$actorId}", true, self::THROTTLE_SECONDS)) {
                $this->dispatch($diagramId, $actorEdits[0]);
            }
        }
    }

    /** Lo que dice la IA siempre le interesa al equipo, sin límite por minuto. */
    public function agentReply(string $diagramId, string $agentName, string $text): void
    {
        if (trim($text) !== '') {
            NotifyDiagramMembers::dispatch($diagramId, null, mb_strimwidth("{$agentName}: {$text}", 0, 160, '…'), 'agent');
        }
    }

    private function dispatch(string $diagramId, array $entry): void
    {
        NotifyDiagramMembers::dispatch($diagramId, $entry['actorId'] ?? null, "{$entry['actorName']} {$entry['summary']}");
    }
}
