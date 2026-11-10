<?php

namespace App\Console\Commands;

use App\Models\ActivityEntry;
use App\Models\AiMessage;
use App\Services\Vector\SemanticMemory;

/** El texto que se convierte en vector para cada actividad y cada mensaje. */
final class ActivityIndexText
{
    private const ORIGIN = [
        'manual' => 'a mano',
        'agent' => 'con la IA',
        'import' => 'por importación',
        'system' => '',
    ];

    public static function forActivity(ActivityEntry $entry): array
    {
        $how = self::ORIGIN[$entry->origin] ?? '';
        $requested = $entry->requested_by_name ? " a pedido de {$entry->requested_by_name}" : '';
        $date = $entry->created_at?->setTimezone(config('services.ai.agent.timezone'))->format('d/m/Y H:i');

        return [
            'kind' => SemanticMemory::KIND_ACTIVITY,
            'ref' => (string) $entry->id,
            'diagram_id' => $entry->diagram_id,
            'text' => trim("{$entry->actor_name} {$entry->summary}{$requested} {$how}")." ({$date})",
            'meta' => ['actor' => $entry->actor_name, 'origin' => $entry->origin, 'date' => $entry->created_at?->toISOString()],
        ];
    }

    public static function forMessage(AiMessage $message): array
    {
        $text = trim(($message->text ?? '').' '.($message->ops_summary ?? ''));

        return [
            'kind' => SemanticMemory::KIND_MESSAGE,
            'ref' => (string) $message->id,
            'diagram_id' => $message->diagram_id,
            'text' => "{$message->author_name}: {$text}",
            'meta' => ['author' => $message->author_name, 'session' => $message->work_session_id, 'date' => $message->created_at?->toISOString()],
        ];
    }
}
