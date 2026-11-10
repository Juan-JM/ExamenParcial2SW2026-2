<?php

namespace App\Models;

use MongoDB\Laravel\Eloquent\Model;

/** Una consulta al asistente de ayuda: qué preguntó, qué tenía en pantalla y qué se le respondió. */
class HelpRequest extends Model
{
    protected $table = 'help_requests';

    protected $fillable = [
        'user_id',
        'user_name',
        'question',
        'page',
        'history',
        'status',
        'answer',
        'steps',
        'highlight',
        'model',
        'latency_ms',
        'error',
    ];

    public function toClientArray(): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'question' => $this->question,
            'answer' => $this->answer,
            'steps' => $this->steps ?? [],
            'highlight' => $this->highlight,
        ];
    }
}
