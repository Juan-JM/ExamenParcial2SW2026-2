<?php

namespace App\Models;

use Illuminate\Notifications\DatabaseNotification as BaseNotification;
use MongoDB\Laravel\Eloquent\DocumentModel;

/**
 * Notificación guardada en MongoDB. La clase base de Laravel no sabe usar esta
 * conexión por sí sola.
 */
class DatabaseNotification extends BaseNotification
{
    use DocumentModel;

    protected $primaryKey = '_id';

    protected $keyType = 'string';

    public $incrementing = false;
}
