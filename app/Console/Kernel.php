<?php
// app/Console/Kernel.php - CREAR ESTE ARCHIVO PARA LARAVEL 11

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    /**
     * Los comandos Artisan proporcionados por tu aplicación.
     *
     * @var array
     */
    protected $commands = [
        \App\Console\Commands\CleanupExpiredSessions::class,
    ];

    /**
     * Definir el horario de comandos de la aplicación.
     */
    protected function schedule(Schedule $schedule): void
    {
        // Limpiar sesiones expiradas cada hora
        $schedule->command('diagrams:cleanup-sessions --force')
                 ->hourly()
                 ->withoutOverlapping()
                 ->appendOutputTo(storage_path('logs/cleanup.log'))
                 ->emailOutputOnFailure('admin@example.com'); // Opcional

        // Estadísticas diarias en logs
        $schedule->command('diagrams:cleanup-sessions --dry-run')
                 ->daily()
                 ->at('06:00')
                 ->appendOutputTo(storage_path('logs/stats.log'));

        // Otras tareas programadas que puedes agregar:

        // Backup diario de diagramas importantes
        // $schedule->call(function () {
        //     // Lógica de backup
        // })->dailyAt('02:00');

        // Limpiar logs antiguos cada semana
        $schedule->command('log:clear')
                 ->weekly()
                 ->sundays()
                 ->at('01:00');

        // Enviar estadísticas semanales por email
        // $schedule->call(function () {
        //     $stats = app(\App\Services\DiagramService::class)->getSystemStats();
        //     // Enviar email con estadísticas
        // })->weeklyOn(1, '09:00'); // Lunes a las 9am
    }

    /**
     * Registrar los comandos para la aplicación.
     */
    protected function commands(): void
    {
        $this->load(__DIR__.'/Commands');

        require base_path('routes/console.php');
    }
}
