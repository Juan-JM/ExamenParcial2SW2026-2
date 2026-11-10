<?php

namespace App\Models;

use MongoDB\Laravel\Eloquent\Model;

/** Celular registrado para recibir notificaciones push. */
class DeviceToken extends Model
{
    protected $table = 'device_tokens';

    protected $fillable = ['user_id', 'token', 'platform'];
}
