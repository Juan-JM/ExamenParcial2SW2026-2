<?php

namespace App\Models;

use MongoDB\Laravel\Eloquent\Model;

/** Última vez que cada usuario abrió un diagrama, para decirle qué se hizo desde entonces. */
class DiagramVisit extends Model
{
    protected $table = 'diagram_visits';

    protected $fillable = ['diagram_id', 'user_id', 'last_seen_at'];

    protected $casts = ['last_seen_at' => 'datetime'];
}
