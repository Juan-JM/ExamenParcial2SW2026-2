<?php

namespace App\Services\Push;

use App\Jobs\NotifyDiagramMembers;
use Illuminate\Support\Facades\Cache;

/**
 * Decide cuándo un cambio merece molestar en el celular. Avisa de los cambios
 * importantes y como máximo una vez por minuto por diagrama: arrastrar clases o
 * editar diez atributos seguidos no debe generar diez notificaciones.
 */
class DiagramNotifier
{
    private const THROTTLE_SECONDS = 60;

    /** Las ediciones menores y los movimientos no notifican. */
    private const NOTIFIABLE_ACTIONS = [
        'CREATE_CLASS', 'DELETE_CLASS', 'RENAME_CLASS',
        'CREATE_RELATION', 'DELETE_RELATION',
        'IMPORT', 'CLEAR_DIAGRAM', 'SESSION_JOIN',
    ];

    /** @param  list<array<string, mixed>>  $entries */
    public function activity(string $diagramId, array $entries): void
    {
        foreach ($entries as $entry) {
            if (!in_array($entry['action'], self::NOTIFIABLE_ACTIONS, true)) {
                continue;
            }

            $this->notify($diagramId, $entry['actorId'], "{$entry['actorName']} {$entry['summary']}");

            return;
        }
    }

    /** Lo que dice la IA siempre le interesa al equipo, sin límite por minuto. */
    public function agentReply(string $diagramId, string $agentName, string $text): void
    {
        if (trim($text) !== '') {
            NotifyDiagramMembers::dispatch($diagramId, null, mb_strimwidth("{$agentName}: {$text}", 0, 160, '…'), 'agent');
        }
    }

    private function notify(string $diagramId, ?string $actorId, string $body): void
    {
        if (Cache::add("push_throttle:{$diagramId}", true, self::THROTTLE_SECONDS)) {
            NotifyDiagramMembers::dispatch($diagramId, $actorId, $body);
        }
    }
}
