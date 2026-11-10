<?php
// database/migrations/xxxx_xx_xx_create_collaborators_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('collaborators', function (Blueprint $table) {
            $table->id();
            $table->foreignId('diagram_session_id')->constrained()->cascadeOnDelete();

            // Usuario colaborador (puede ser null para anónimos)
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('anonymous_name')->nullable(); // Para usuarios no registrados
            $table->string('anonymous_color', 7)->nullable(); // Color del cursor (#ff0000)

            // Información de conexión
            $table->string('socket_id')->nullable(); // ID del socket WebSocket
            $table->ipAddress('ip_address');
            $table->text('user_agent')->nullable();

            // Estado y permisos
            $table->enum('role', ['owner', 'editor', 'viewer'])->default('viewer');
            $table->enum('status', ['online', 'away', 'offline'])->default('online');
            $table->json('permissions')->nullable(); // Permisos específicos

            // Actividad en tiempo real
            $table->timestamp('joined_at');
            $table->timestamp('last_seen_at');
            $table->timestamp('left_at')->nullable();
            $table->json('cursor_position')->nullable(); // {x, y, elementId}
            $table->json('current_selection')->nullable(); // Elementos seleccionados

            // Estadísticas de colaboración
            $table->integer('edits_count')->default(0);
            $table->integer('elements_created')->default(0);
            $table->integer('elements_modified')->default(0);
            $table->integer('chat_messages')->default(0);

            // Invitación
            $table->string('invited_by_email')->nullable();
            $table->timestamp('invitation_sent_at')->nullable();
            $table->timestamp('invitation_accepted_at')->nullable();

            $table->timestamps();

            // Índices
            $table->index(['diagram_session_id', 'status']);
            $table->index(['user_id']);
            $table->index(['socket_id']);
            $table->index(['joined_at']);
            $table->unique(['diagram_session_id', 'user_id']); // Un usuario por sesión
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('collaborators');
    }
};
