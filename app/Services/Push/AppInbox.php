<?php

namespace App\Services\Push;

use App\Models\AppNotification;
use App\Models\DeviceToken;

/**
 * Entrega un aviso a la app móvil: lo guarda en la bandeja de cada
 * destinatario y lo envía por push a sus celulares registrados.
 */
class AppInbox
{
    public function __construct(private readonly FcmSender $sender)
    {
    }

    /** @param  list<string>  $userIds */
    public function deliver(array $userIds, string $type, string $title, string $body, ?string $diagramId = null, ?string $diagramTitle = null): void
    {
        foreach (array_unique($userIds) as $userId) {
            $notification = AppNotification::create([
                'user_id' => $userId,
                'diagram_id' => $diagramId,
                'diagram_title' => $diagramTitle,
                'type' => $type,
                'title' => $title,
                'body' => $body,
                'read_at' => null,
            ]);

            $this->sender->send(DeviceToken::where('user_id', $userId)->get(), $title, $body, [
                'type' => $type,
                'diagramId' => (string) $diagramId,
                'notificationId' => (string) $notification->id,
            ]);
        }
    }
}
