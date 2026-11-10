<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">

        <title>Diagramador UML Colaborativo</title>

        <!-- Fonts -->
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

        <!-- Styles / Scripts -->
        @vite(['resources/css/app.css', 'resources/js/app.js'])
    </head>
    <body class="font-sans antialiased bg-gray-50 text-gray-900">
        <div class="min-h-screen flex flex-col">
            <header class="border-b border-gray-200 bg-white">
                <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <x-icon name="logo" :size="22" class="text-zinc-900" />
                        <span class="text-base font-semibold tracking-tight">UML Designer</span>
                    </div>

                    @if (Route::has('login'))
                        <nav class="flex items-center gap-2">
                            @auth
                                <a href="{{ url('/diagrams') }}" class="btn btn-primary btn-sm">Mis Diagramas</a>
                            @else
                                <a href="{{ route('login') }}" class="btn btn-ghost btn-sm">Iniciar sesión</a>
                                @if (Route::has('register'))
                                    <a href="{{ route('register') }}" class="btn btn-primary btn-sm">Registrarse</a>
                                @endif
                            @endauth
                        </nav>
                    @endif
                </div>
            </header>

            <main class="flex-1">
                <!-- Hero -->
                <section class="max-w-6xl mx-auto px-6 pt-16 pb-14 text-center">
                    <h1 class="text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900 max-w-2xl mx-auto">
                        Diseña diagramas UML y genera código, en un solo lugar
                    </h1>
                    <p class="mt-4 text-gray-500 max-w-xl mx-auto">
                        Editor de clases UML 2.5 colaborativo con un asistente de IA integrado y generación directa de backend, app móvil, SQL y colecciones de API.
                    </p>
                    <div class="mt-8 flex items-center justify-center gap-3">
                        <a href="{{ route('register') }}" class="btn btn-primary">
                            <x-icon name="plus" :size="15" /> Crear cuenta gratis
                        </a>
                        <a href="{{ route('login') }}" class="btn btn-secondary">Iniciar sesión</a>
                    </div>
                </section>

                <!-- Preview -->
                <section class="max-w-5xl mx-auto px-6 pb-16">
                    <div class="card p-3 sm:p-4">
                        <svg viewBox="0 0 800 340" class="w-full h-auto rounded-md" xmlns="http://www.w3.org/2000/svg">
                            <rect width="800" height="340" rx="8" fill="#fbfbfd" />
                            <g opacity="0.5">
                                <path d="M0 20h800M0 60h800M0 100h800M0 140h800M0 180h800M0 220h800M0 260h800M0 300h800" stroke="#eef0f3" stroke-width="1"/>
                            </g>
                            <rect x="60" y="60" width="150" height="100" rx="6" fill="white" stroke="#334155" stroke-width="1.5"/>
                            <line x1="60" y1="90" x2="210" y2="90" stroke="#334155" stroke-width="1"/>
                            <line x1="60" y1="115" x2="210" y2="115" stroke="#334155" stroke-width="1"/>
                            <text x="135" y="78" text-anchor="middle" fill="#1e293b" font-family="Inter, sans-serif" font-size="13" font-weight="600">Usuario</text>
                            <text x="70" y="105" fill="#475569" font-family="Fira Code, monospace" font-size="10">- email: String</text>
                            <text x="70" y="130" fill="#475569" font-family="Fira Code, monospace" font-size="10">- password: String</text>

                            <rect x="360" y="140" width="150" height="100" rx="6" fill="white" stroke="#334155" stroke-width="1.5"/>
                            <line x1="360" y1="170" x2="510" y2="170" stroke="#334155" stroke-width="1"/>
                            <line x1="360" y1="195" x2="510" y2="195" stroke="#334155" stroke-width="1"/>
                            <text x="435" y="158" text-anchor="middle" fill="#1e293b" font-family="Inter, sans-serif" font-size="13" font-weight="600">Pedido</text>
                            <text x="370" y="185" fill="#475569" font-family="Fira Code, monospace" font-size="10">+ fecha: Date</text>
                            <text x="370" y="210" fill="#475569" font-family="Fira Code, monospace" font-size="10">+ total: Double</text>

                            <rect x="600" y="50" width="150" height="80" rx="6" fill="white" stroke="#334155" stroke-width="1.5" stroke-dasharray="6 4"/>
                            <line x1="600" y1="80" x2="750" y2="80" stroke="#334155" stroke-width="1" stroke-dasharray="6 4"/>
                            <text x="675" y="68" text-anchor="middle" fill="#1e293b" font-family="Inter, sans-serif" font-size="12" font-weight="600">«interface»</text>
                            <text x="675" y="105" text-anchor="middle" fill="#1e293b" font-family="Fira Code, monospace" font-size="10">Notificable</text>

                            <line x1="210" y1="130" x2="360" y2="170" stroke="#18181b" stroke-width="1.5"/>
                            <text x="270" y="145" fill="#18181b" font-family="Inter, sans-serif" font-size="10">realiza</text>
                            <line x1="510" y1="180" x2="600" y2="120" stroke="#18181b" stroke-width="1.5" stroke-dasharray="4 3"/>
                        </svg>
                    </div>
                </section>

                <!-- Features -->
                <section class="max-w-6xl mx-auto px-6 pb-20">
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                        <div class="card p-6">
                            <div class="w-9 h-9 rounded-md bg-zinc-100 text-zinc-900 flex items-center justify-center mb-4">
                                <x-icon name="pencil" :size="18" />
                            </div>
                            <h2 class="text-sm font-semibold text-gray-900">Editor UML avanzado</h2>
                            <p class="mt-2 text-sm text-gray-500 leading-relaxed">
                                Clases, interfaces, asociaciones, herencia, composición y agregación con arrastrar-y-soltar.
                            </p>
                        </div>

                        <div class="card p-6">
                            <div class="w-9 h-9 rounded-md bg-zinc-100 text-zinc-900 flex items-center justify-center mb-4">
                                <x-icon name="users" :size="18" />
                            </div>
                            <h2 class="text-sm font-semibold text-gray-900">Colaboración en tiempo real</h2>
                            <p class="mt-2 text-sm text-gray-500 leading-relaxed">
                                Invita a tu equipo mediante un enlace y trabajen juntos sobre el mismo diagrama.
                            </p>
                        </div>

                        <div class="card p-6">
                            <div class="w-9 h-9 rounded-md bg-zinc-100 text-zinc-900 flex items-center justify-center mb-4">
                                <x-icon name="document" :size="18" />
                            </div>
                            <h2 class="text-sm font-semibold text-gray-900">Generación de código</h2>
                            <p class="mt-2 text-sm text-gray-500 leading-relaxed">
                                Backend Spring Boot, script SQL y colección Postman a partir de tu diagrama.
                            </p>
                        </div>

                        <div class="card p-6">
                            <div class="w-9 h-9 rounded-md bg-zinc-100 text-zinc-900 flex items-center justify-center mb-4">
                                <x-icon name="save" :size="18" />
                            </div>
                            <h2 class="text-sm font-semibold text-gray-900">Exportación profesional</h2>
                            <p class="mt-2 text-sm text-gray-500 leading-relaxed">
                                PNG en alta calidad, XMI compatible con Enterprise Architect e importación desde imagen con IA.
                            </p>
                        </div>
                    </div>
                </section>
            </main>

            <footer class="border-t border-gray-200 py-8 text-center text-xs text-gray-400">
                Diagramador UML Colaborativo · Laravel v{{ Illuminate\Foundation\Application::VERSION }}
            </footer>
        </div>
    </body>
</html>
