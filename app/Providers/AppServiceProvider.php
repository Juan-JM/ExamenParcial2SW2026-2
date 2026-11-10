<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Scripts de Vite alcanzables desde el celular por Wi-Fi (ver la clase).
        $this->app->singleton(\Illuminate\Foundation\Vite::class, \App\Support\NetworkAwareVite::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Entorno de prueba aislado: no usa el Vite de desarrollo ni su compilación.
        if ($this->app->environment('e2e')) {
            \Illuminate\Support\Facades\Vite::useHotFile(storage_path('framework/e2e.hot'))->useBuildDirectory('build-e2e');
        }

        \Laravel\Sanctum\Sanctum::usePersonalAccessTokenModel(\App\Models\PersonalAccessToken::class);

        \Illuminate\Support\Facades\Broadcast::routes(['middleware' => ['web', 'auth']]);
    }
}
