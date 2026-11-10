<?php
// database/migrations/xxxx_xx_xx_create_diagrams_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('diagrams', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->text('description')->nullable();
            $table->string('slug')->unique();

            // Datos del diagrama JointJS
            $table->longText('data'); // JSON del diagrama
            $table->longText('metadata')->nullable(); // Metadatos adicionales

            // Configuración
            $table->json('settings')->nullable(); // Zoom, posición, etc.
            $table->enum('visibility', ['private', 'public', 'shared'])->default('private');
            $table->string('password')->nullable(); // Para diagramas protegidos

            // Estadísticas
            $table->integer('elements_count')->default(0);
            $table->integer('classes_count')->default(0);
            $table->integer('relationships_count')->default(0);

            // Versionado básico
            $table->integer('version')->default(1);
            $table->timestamp('last_saved_at')->nullable();

            // Propietario y colaboración
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->boolean('is_template')->default(false);

            // Exportación y caché
            $table->string('preview_image')->nullable(); // Path a imagen preview
            $table->timestamp('exported_at')->nullable();

            $table->timestamps();

            // Índices para performance
            $table->index(['user_id', 'visibility']);
            $table->index(['slug']);
            $table->index(['is_template']);
            $table->index(['created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('diagrams');
    }
};
