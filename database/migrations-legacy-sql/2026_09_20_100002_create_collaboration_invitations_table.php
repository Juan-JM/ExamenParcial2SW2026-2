<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('collaboration_invitations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('diagram_id')->constrained()->cascadeOnDelete();
            $table->foreignId('inviter_id')->constrained('users')->cascadeOnDelete();

            // El invitado puede ser un usuario ya registrado (invitee_user_id)
            // o solo un email externo hasta que se registre (se enlaza después).
            $table->string('invitee_email');
            $table->foreignId('invitee_user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->enum('role', ['editor', 'viewer'])->default('editor');
            $table->string('token')->unique();
            $table->enum('status', ['pending', 'accepted', 'rejected'])->default('pending');
            $table->timestamp('responded_at')->nullable();

            $table->timestamps();

            $table->index(['invitee_email']);
            $table->index(['diagram_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('collaboration_invitations');
    }
};
