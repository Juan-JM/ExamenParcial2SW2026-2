<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="csrf-token" content="{{ csrf_token() }}">

        <title>{{ config('app.name', 'UML Colaborativo') }}</title>

        <!-- Fonts -->
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

        <!-- Scripts -->
        @vite(['resources/css/app.css', 'resources/js/app.js'])
    </head>
    <body class="font-sans text-gray-900 antialiased">
        <!-- Fondo con gradiente elegante -->
        <div class="min-h-screen flex flex-col sm:justify-center items-center pt-6 sm:pt-0 bg-gradient-to-br from-gray-100 via-gray-50 to-white">

            <!-- Logo -->
            <div class="mb-6">
                <a href="/">
                    <x-application-logo class="w-32 h-auto hover:scale-105 transition-transform duration-200" />
                </a>
            </div>

            <!-- Contenedor del formulario con diseño mejorado -->
            <div class="w-full sm:max-w-md">
                <!-- Card elegante -->
                <div class="bg-white/80 backdrop-blur-sm shadow-xl border border-gray-200/50 overflow-hidden sm:rounded-2xl">
                    <div class="px-8 py-6">
                        {{ $slot }}
                    </div>
                </div>

                <!-- Texto informativo -->
                <div class="mt-6 text-center">
                    <p class="text-sm text-gray-600">
                        Diagramador UML Colaborativo en Tiempo Real
                    </p>
                    <p class="text-xs text-gray-500 mt-1">
                        Diseña • Colabora • Genera Código
                    </p>
                </div>
            </div>

            <!-- Footer discreto -->
            <div class="mt-8 text-center text-xs text-gray-400">
                <p>© {{ date('Y') }} UML Colaborativo. Construido con Laravel</p>
            </div>
        </div>
    </body>
</html>
