<?php

namespace App\Models;

use MongoDB\Laravel\Eloquent\Model;

/**
 * Aviso de la bandeja de la app móvil. Se guarda uno por destinatario aunque
 * no tenga el celular registrado: así la vista de notificaciones muestra lo
 * que pasó mientras la app estaba cerrada o Firebase no llegó.
 *
 * Tipos: `activity` (cambios del equipo), `agent` (respuesta de la IA) e
 * `invitation` (te invitaron a un diagrama).
 */
class AppNotification extends Model
{
    protected $table = 'app_notifications';

    protected $fillable = ['user_id', 'diagram_id', 'diagram_title', 'type', 'title', 'body', 'read_at'];

    protected $casts = ['read_at' => 'datetime'];

    public function toClientArray(): array
    {
        return [
            'id' => (string) $this->id,
            'type' => $this->type,
            'title' => $this->title,
            'body' => $this->body,
            'diagramId' => $this->diagram_id,
            'diagramTitle' => $this->diagram_title,
            'read' => $this->read_at !== null,
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
