<?php

use App\Http\Controllers\Api\MobileController;
use Illuminate\Support\Facades\Route;

// App móvil informativa: ninguna de estas rutas edita el diagrama.
Route::prefix('mobile')->group(function () {
    Route::post('/login', [MobileController::class, 'login'])->middleware('throttle:10,1');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/logout', [MobileController::class, 'logout']);
        Route::get('/diagrams', [MobileController::class, 'diagrams']);
        Route::get('/diagrams/{diagram}', [MobileController::class, 'diagram']);
        Route::get('/diagrams/{diagram}/activity', [MobileController::class, 'activity']);
        Route::get('/diagrams/{diagram}/messages', [MobileController::class, 'messages']);
        Route::post('/diagrams/{diagram}/ask', [MobileController::class, 'ask']);
        Route::post('/diagrams/{diagram}/viewer-link', [MobileController::class, 'viewerLink']);
        Route::post('/devices', [MobileController::class, 'registerDevice']);
        Route::delete('/devices', [MobileController::class, 'unregisterDevice']);
        Route::get('/notifications', [MobileController::class, 'notifications']);
        Route::post('/notifications/read', [MobileController::class, 'markNotificationsRead']);
        Route::post('/broadcasting/auth', [MobileController::class, 'broadcastingAuth']);
        Route::get('/realtime', [MobileController::class, 'realtimeConfig']);
    });
});
