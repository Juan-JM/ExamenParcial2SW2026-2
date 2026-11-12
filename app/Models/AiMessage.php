<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use MongoDB\Laravel\Eloquent\Model;

/**
 * Un mensaje de la conversación ÚNICA del diagrama: no hay chats por usuario,
 * todos los participantes y la IA comparten esta misma colección.
 */
class AiMessage extends Model
{
    public const ROLE_USER = 'user';

    public const ROLE_ASSISTANT = 'assistant';

    public const ROLE_SYSTEM = 'system';

    protected $table = 'ai_messages';

    protected $fillable = [
        'diagram_id',
        'work_session_id',
        'role',
        'author_id',
        'author_name',
        'text',
        'source',
        'to_agent',
        'ui_context',
        'reply_to',
        'executor_user_id',
        'ops',
        'ops_status',
        'ops_summary',
        'options',
        'original_command',
        'provider',
        'model',
        'latency_ms',
        'prompt',
        'raw_response',
        'error',
        'superseded',
    ];

    /** La conversación de una sesión de trabajo (o la de fuera de sesión, si es null). */
    public function scopeOfConversation($query, string $diagramId, ?string $workSessionId)
    {
        $query->where('diagram_id', $diagramId);

        return $workSessionId === null
            ? $query->whereNull('work_session_id')
            : $query->where('work_session_id', $workSessionId);
    }

    public function diagram(): BelongsTo
    {
        return $this->belongsTo(Diagram::class);
    }

    public function toClientArray(): array
    {
        return [
            'id' => $this->id,
            'role' => $this->role,
            'authorId' => $this->author_id,
            'authorName' => $this->author_name,
            'text' => $this->text,
            'source' => $this->source,
            'toAgent' => $this->to_agent,
            'replyTo' => $this->reply_to,
            'executorUserId' => $this->executor_user_id,
            'ops' => $this->ops ?? [],
            'opsStatus' => $this->ops_status,
            'opsSummary' => $this->ops_summary,
            'options' => $this->options ?? [],
            'originalCommand' => $this->original_command,
            'superseded' => (bool) $this->superseded,
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
