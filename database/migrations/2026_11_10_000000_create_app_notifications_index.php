<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** Bandeja de la app móvil: se lee por usuario, de lo más nuevo a lo más viejo. */
return new class extends Migration
{
    public function up(): void
    {
        DB::connection('mongodb')->getCollection('app_notifications')
            ->createIndex(['user_id' => 1, 'created_at' => -1]);
    }

    public function down(): void
    {
        DB::connection('mongodb')->getCollection('app_notifications')->dropIndexes();
    }
};
