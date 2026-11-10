<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * `metadata`, `password`, `preview_image` y `exported_at` nunca llegaron a
 * usarse: no se leen ni se escriben en ningún lado más allá de estar
 * declaradas en el modelo (las exportaciones de Java/SQL/Flutter/Postman
 * descargan directo al navegador, nunca generaron ni guardaron un preview).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('diagrams', function (Blueprint $table) {
            $table->dropColumn(['metadata', 'password', 'preview_image', 'exported_at']);
        });
    }

    public function down(): void
    {
        Schema::table('diagrams', function (Blueprint $table) {
            $table->longText('metadata')->nullable();
            $table->string('password')->nullable();
            $table->string('preview_image')->nullable();
            $table->timestamp('exported_at')->nullable();
        });
    }
};
