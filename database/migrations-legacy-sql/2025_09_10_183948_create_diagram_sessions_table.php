<?php
// database/migrations/xxxx_xx_xx_create_diagram_sessions_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('diagram_sessions', function (Blueprint $table) {
            $table->id();
            $table->string('session_id')->unique(); // UUID para la sesión
            $table->foreignId('diagram_id')->constrained()->cascadeOnDelete();

            // Información de la sesión
            $table->string('title')->nullable();
            $table->enum('status', ['active', 'paused', 'ended'])->default('active');
            $table->timestamp('started_at');
            $table->timestamp('ended_at')->nullable();

            // Configuración de colaboración
            $table->integer('max_collaborators')->default(10);
            $table->boolean('allow_anonymous')->default(false);
            $table->json('permissions')->nullable(); // Permisos específicos por rol

            // Token de invitación
            $table->string('invite_token')->unique(); // Para compartir sesión
            $table->timestamp('invite_expires_at')->nullable();
            $table->boolean('is_public')->default(false);

            // Datos de sesión en tiempo real
            $table->json('current_state')->nullable(); // Estado actual del diagrama
            $table->json('cursor_positions')->nullable(); // Posiciones de cursores
            $table->integer('active_users_count')->default(0);

            // Propietario de la sesión
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();

            $table->timestamps();

            // Índices
            $table->index(['session_id']);
            $table->index(['invite_token']);
            $table->index(['diagram_id', 'status']);
            $table->index(['owner_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('diagram_sessions');
    }
};
