<?php

namespace App\Models;

use MongoDB\Laravel\Eloquent\Model;

/**
 * Registro de auditoría: quién hizo qué, cómo y sobre qué. Es la fuente de "¿qué
 * hizo fulano?" y de los resúmenes para quien llega tarde.
 */
class ActivityEntry extends Model
{
    public const ACTOR_USER = 'user';

    public const ACTOR_AI = 'ai';

    /** Editó la persona, sin la IA. */
    public const ORIGIN_MANUAL = 'manual';

    /** Lo hizo la IA porque alguien se lo pidió. */
    public const ORIGIN_AGENT = 'agent';

    /** Entró por una importación (XMI o imagen). */
    public const ORIGIN_IMPORT = 'import';

    /** Hechos de la app: entradas, salidas, invitaciones, cambios de rol. */
    public const ORIGIN_SYSTEM = 'system';

    protected $table = 'activity_log';

    protected $fillable = [
        'diagram_id',
        'work_session_id',
        'actor_type',
        'actor_id',
        'actor_name',
        'origin',
        'requested_by_id',
        'requested_by_name',
        'request_message_id',
        'reply_message_id',
        'source',
        'action',
        'element_id',
        'summary',
        'before',
        'after',
    ];

    public function toClientArray(): array
    {
        return [
            'id' => $this->id,
            'workSessionId' => $this->work_session_id,
            'actorType' => $this->actor_type,
            'actorId' => $this->actor_id,
            'actorName' => $this->actor_name,
            'origin' => $this->origin,
            'requestedByName' => $this->requested_by_name,
            'source' => $this->source,
            'action' => $this->action,
            'elementId' => $this->element_id,
            'summary' => $this->summary,
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
