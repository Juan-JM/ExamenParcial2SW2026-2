<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * `current_state` se escribía una sola vez, al crear la sesión (snapshot de
 * $diagram->data en ese momento) — nunca se leyó de vuelta en ningún lado.
 * El estado real de un diagrama, para cualquiera que lo abra (dueño o
 * colaborador recién unido), siempre sale de `diagrams.data` (mantenido al
 * día por el autosave inmediato tras cada cambio, ver
 * AutoSaveManager.scheduleImmediateSave()) — nunca de esta columna, que
 * daba la falsa impresión de que la sesión tenía su propio estado aparte.
 *
 * `cursor_positions` es otro resabio: quedó de la función de cursores
 * remotos, rechazada explícitamente y borrada por completo en JS
 * (DiagramCursorManager.js) — esta columna nunca se enteró de esa
 * decisión y siguió declarada sin que nada la lea ni la escriba.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('diagram_sessions', function (Blueprint $table) {
            $table->dropColumn(['current_state', 'cursor_positions']);
        });
    }

    public function down(): void
    {
        Schema::table('diagram_sessions', function (Blueprint $table) {
            $table->json('current_state')->nullable();
            $table->json('cursor_positions')->nullable();
        });
    }
};
