<?php
// app/Console/Commands/CleanupExpiredSessions.php

namespace App\Console\Commands;

use App\Services\DiagramService;
use Illuminate\Console\Command;

class CleanupExpiredSessions extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'diagrams:cleanup-sessions
                            {--dry-run : Show what would be cleaned without actually doing it}
                            {--force : Force cleanup without confirmation}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Limpiar sesiones colaborativas expiradas';

    protected DiagramService $diagramService;

    public function __construct(DiagramService $diagramService)
    {
        parent::__construct();
        $this->diagramService = $diagramService;
    }

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $this->info('🧹 Iniciando limpieza de sesiones expiradas...');

        try {
            if ($this->option('dry-run')) {
                $this->info('🔍 Modo DRY RUN - Solo mostrando lo que se limpiaría');
                $this->dryRun();
                return 0;
            }

            if (!$this->option('force') && !$this->confirm('¿Deseas continuar con la limpieza?')) {
                $this->info('❌ Operación cancelada');
                return 0;
            }

            $cleanedCount = $this->diagramService->cleanupExpiredSessions();

            if ($cleanedCount > 0) {
                $this->info("✅ Se limpiaron {$cleanedCount} sesiones expiradas");
            } else {
                $this->info("✨ No hay sesiones expiradas para limpiar");
            }

            // Estadísticas adicionales
            $this->showStats();

            return 0;

        } catch (\Exception $e) {
            $this->error("❌ Error durante la limpieza: " . $e->getMessage());
            return 1;
        }
    }

    protected function dryRun(): void
    {
        $expiredSessions = \App\Models\DiagramSession::where('status', 'active')
            ->where('invite_expires_at', '<', now())
            ->with(['diagram', 'collaborators'])
            ->get();

        if ($expiredSessions->isEmpty()) {
            $this->info("✨ No hay sesiones expiradas");
            return;
        }

        $this->table(
            ['ID', 'Diagrama', 'Creada', 'Expira', 'Colaboradores'],
            $expiredSessions->map(function ($session) {
                return [
                    $session->session_id,
                    $session->diagram->title,
                    $session->started_at->format('Y-m-d H:i'),
                    $session->invite_expires_at?->format('Y-m-d H:i') ?? 'N/A',
                    $session->collaborators->count()
                ];
            })
        );

        $this->info("📊 Se limpiarían {$expiredSessions->count()} sesiones expiradas");
    }

    protected function showStats(): void
    {
        $stats = $this->diagramService->getSystemStats();

        $this->newLine();
        $this->info('📊 Estadísticas del sistema:');
        $this->line("   Total diagramas: {$stats['total_diagrams']}");
        $this->line("   Sesiones activas: {$stats['active_sessions']}");
        $this->line("   Colaboradores online: {$stats['online_collaborators']}");
        $this->line("   Diagramas creados hoy: {$stats['diagrams_created_today']}");
    }
}
