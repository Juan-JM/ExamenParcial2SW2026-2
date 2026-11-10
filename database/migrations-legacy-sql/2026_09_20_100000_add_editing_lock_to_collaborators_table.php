<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('collaborators', function (Blueprint $table) {
            // Bloqueo blando: qué celda de JointJS (clase/interfaz/relación)
            // está editando este colaborador ahora mismo, si alguna.
            $table->string('editing_element_id')->nullable()->after('current_selection');
            $table->timestamp('editing_started_at')->nullable()->after('editing_element_id');
        });
    }

    public function down(): void
    {
        Schema::table('collaborators', function (Blueprint $table) {
            $table->dropColumn(['editing_element_id', 'editing_started_at']);
        });
    }
};
