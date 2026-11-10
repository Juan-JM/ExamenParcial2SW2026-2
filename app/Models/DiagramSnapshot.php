<?php

namespace App\Models;

use MongoDB\Laravel\Eloquent\Model;

/**
 * Versión del diagrama: una copia completa para poder volver a ella. Solo se
 * guarda en los hitos, no en cada autoguardado:
 *
 * - `manual`: alguien apretó "Guardar" o Ctrl+S.
 * - `session_end`: todos salieron de la sesión de trabajo. Es el estado del
 *   último autoguardado de la sesión.
 * - `before_restore`: lo que había antes de restaurar otra versión.
 *
 * Nunca se repite una versión igual a la anterior. Al cerrar una sesión,
 * además, cambiar solo posiciones (mover clases) no cuenta como versión nueva.
 * El paso a paso fino de lo que hizo cada uno está en la auditoría y en el
 * deshacer de cada usuario (Ctrl+Z).
 */
class DiagramSnapshot extends Model
{
    public const MANUAL = 'manual';

    public const SESSION_END = 'session_end';

    public const BEFORE_RESTORE = 'before_restore';

    protected $table = 'diagram_snapshots';

    protected $fillable = ['diagram_id', 'work_session_id', 'version', 'data', 'content_hash', 'semantic_hash', 'author_id', 'author_name', 'reason'];

    public static function capture(string $diagramId, ?string $workSessionId, string $reason, ?User $author = null): ?self
    {
        $diagram = Diagram::find($diagramId);

        if (!$diagram) {
            return null;
        }

        $data = $diagram->data ?? ['cells' => []];
        $hash = static::contentHash($data);
        $semantic = static::semanticHash($data);

        $last = static::where('diagram_id', $diagramId)
            ->orderBy('created_at', 'desc')
            ->first(['content_hash', 'semantic_hash']);

        if ($last) {
            // Exactamente igual a la última versión: nada nuevo que guardar.
            if ($last->content_hash === $hash) {
                return null;
            }

            // Fin de sesión sin cambios de contenido (solo se movieron clases).
            if ($reason === self::SESSION_END && $last->semantic_hash === $semantic) {
                return null;
            }
        } elseif ($reason === self::SESSION_END && empty($data['cells'])) {
            // Una sesión que no dibujó nada no deja una versión vacía.
            return null;
        }

        return static::create([
            'diagram_id' => $diagramId,
            'work_session_id' => $workSessionId,
            'version' => $diagram->version,
            'data' => $data,
            'content_hash' => $hash,
            'semantic_hash' => $semantic,
            'author_id' => $author?->id,
            'author_name' => $author?->name,
            'reason' => $reason,
        ]);
    }

    public static function contentHash(array $data): string
    {
        return md5(json_encode($data));
    }

    /**
     * Huella del contenido sin la geometría: clases (nombre, atributos,
     * métodos, opciones UML) y relaciones (extremos, tipo, multiplicidades).
     * Mover una clase o doblar una línea no la cambia.
     */
    public static function semanticHash(array $data): string
    {
        $cells = collect($data['cells'] ?? [])
            ->map(fn ($cell) => array_filter([
                'id' => $cell['id'] ?? null,
                'umlData' => $cell['umlData'] ?? null,
                'relationData' => $cell['relationData'] ?? null,
                'source' => $cell['source']['id'] ?? null,
                'target' => $cell['target']['id'] ?? null,
            ], fn ($value) => $value !== null))
            ->filter(fn ($cell) => isset($cell['umlData']) || isset($cell['relationData']))
            ->sortBy('id')
            ->values()
            ->all();

        return md5(json_encode($cells));
    }
}
