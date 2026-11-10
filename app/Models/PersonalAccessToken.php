<?php

namespace App\Models;

use Laravel\Sanctum\PersonalAccessToken as SanctumToken;
use MongoDB\Laravel\Eloquent\DocumentModel;

/** Tokens de la app móvil, guardados en MongoDB. */
class PersonalAccessToken extends SanctumToken
{
    use DocumentModel;

    protected $primaryKey = '_id';

    protected $keyType = 'string';
}
