<?php
// routes/console.php - REGISTRAR COMANDOS Y SCHEDULING AQUÍ

use Illuminate\Support\Facades\Schedule;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

// Comando inspiracional por defecto de Laravel
Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Registrar nuestros comandos personalizados aquí si es necesario
// (Normalmente se auto-registran si están en app/Console/Commands/)

// === SCHEDULING DE TAREAS ===

// Cerrar sesiones de trabajo cuyos participantes desaparecieron sin avisar
Schedule::command('agent:close-abandoned-sessions')->everyFiveMinutes()->withoutOverlapping();

// Limpiar sesiones expiradas cada hora
Schedule::command('diagrams:cleanup-sessions --force')
    ->hourly()
    ->withoutOverlapping()
    ->appendOutputTo(storage_path('logs/cleanup.log'))
    ->name('cleanup-sessions')
    ->onSuccess(function () {
        // Log de éxito
        \Log::info('Cleanup sessions completed successfully');
    })
    ->onFailure(function () {
        // Log de error
        \Log::error('Cleanup sessions failed');
    });

// Estadísticas diarias en logs
Schedule::command('diagrams:cleanup-sessions --dry-run')
    ->daily()
    ->at('06:00')
    ->appendOutputTo(storage_path('logs/stats.log'))
    ->name('daily-stats');

// Limpiar logs antiguos cada semana
Schedule::command('log:clear')
    ->weekly()
    ->sundays()
    ->at('01:00')
    ->name('weekly-log-cleanup');

// === COMANDOS ADICIONALES DE DESARROLLO ===

// Comando para crear datos de prueba
Artisan::command('dev:seed-diagrams', function () {
    if (!app()->environment('local')) {
        $this->error('Este comando solo funciona en desarrollo');
        return 1;
    }

    $user = \App\Models\User::firstOrCreate(
        ['email' => 'test@example.com'],
        [
            'name' => 'Usuario de Prueba',
            'password' => bcrypt('password')
        ]
    );

    if ($user->diagrams()->count() === 0) {
        $diagrams = [
            [
                'title' => 'Sistema de Gestión de Usuarios',
                'description' => 'Diagrama UML para sistema de usuarios con roles',
                'visibility' => 'public'
            ],
            [
                'title' => 'E-commerce - Gestión de Productos',
                'description' => 'Clases para manejo de catálogo de productos',
                'visibility' => 'private'
            ],
            [
                'title' => 'Template - Patrón MVC',
                'description' => 'Template con patrón MVC básico',
                'visibility' => 'public',
                'is_template' => true
            ]
        ];

        foreach ($diagrams as $diagramData) {
            $user->diagrams()->create(array_merge($diagramData, [
                'data' => ['cells' => []],
                'version' => 1
            ]));
        }

        $this->info('✅ Datos de prueba creados exitosamente');
        $this->line("📧 Email: test@example.com");
        $this->line("🔑 Password: password");
    } else {
        $this->info('ℹ️  Los datos de prueba ya existen');
    }
})->purpose('Crear datos de prueba para desarrollo');

// Comando para estadísticas del sistema
Artisan::command('diagrams:stats', function () {
    $stats = app(\App\Services\DiagramService::class)->getSystemStats();

    $this->info('📊 Estadísticas del Sistema UML');
    $this->line('==================================');
    $this->line("📄 Total diagramas: {$stats['total_diagrams']}");
    $this->line("🔄 Sesiones activas: {$stats['active_sessions']}");
    $this->line("👥 Colaboradores online: {$stats['online_collaborators']}");
    $this->line("📅 Diagramas creados hoy: {$stats['diagrams_created_today']}");
    $this->line("⭐ Usuario más activo: {$stats['most_active_user']}");

})->purpose('Mostrar estadísticas del sistema');
