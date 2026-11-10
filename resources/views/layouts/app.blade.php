{{-- resources/views/layouts/app.blade.php --}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="user-id" content="{{ auth()->id() }}">

    <title>{{ config('app.name', 'Diagramador UML') }}</title>

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500;600&display=swap" rel="stylesheet" />
    <!-- Scripts -->
    @vite(['resources/css/app.css', 'resources/js/app.js'])
    @livewireStyles
</head>
<body class="font-sans antialiased bg-gray-50 text-gray-900">
    <div class="min-h-screen">
        <!-- Navigation -->
        <nav class="bg-white border-b border-gray-200">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between h-16">
                    <div class="flex">
                        <!-- Logo -->
                        <div class="flex-shrink-0 flex items-center">
                            <a href="{{ route('diagrams.index') }}" class="flex items-center gap-2 text-gray-900">
                                <x-icon name="logo" :size="22" class="text-zinc-900" />
                                <span class="text-base font-semibold tracking-tight">UML Designer</span>
                            </a>
                        </div>

                        <!-- Primary Navigation Menu -->
                        <div class="hidden space-x-6 sm:-my-px sm:ml-10 sm:flex">
                            <a href="{{ route('diagrams.index') }}"
                               class="inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium {{ request()->routeIs('diagrams.index') ? 'border-zinc-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300' }} transition duration-150 ease-in-out">
    Mis Diagramas
                            </a>

                            <a href="{{ route('diagrams.editor') }}"
                               id="support-target-new-diagram-nav"
                               class="inline-flex items-center gap-1.5 px-1 pt-1 border-b-2 text-sm font-medium {{ request()->routeIs('diagrams.editor') ? 'border-zinc-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300' }} transition duration-150 ease-in-out">
    <x-icon name="plus" :size="15" />
                                Nuevo Diagrama
                            </a>
                        </div>
                    </div>

                    <!-- Settings Dropdown -->
                    <div class="hidden sm:flex sm:items-center sm:ml-6">
                        <div class="ml-3 relative">
                            <div class="flex items-center space-x-3">
                                <button type="button" id="support-chat-btn" data-support-context="dashboard" class="icon-btn" aria-label="Soporte" title="Soporte">
                                    <x-icon name="help" :size="18" />
                                </button>

                                @livewire('notification-bell')

                                <span class="text-gray-600 text-sm">{{ Auth::user()->name }}</span>

                                <!-- Dropdown menu -->
                                <div class="relative" x-data="{ open: false }">
                                    <button @click="open = !open"
                                            class="flex text-sm rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-800 focus-visible:ring-offset-2 transition duration-150 ease-in-out">
                                        <div class="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center">
                                            <span class="text-white text-xs font-semibold">
                                                {{ substr(Auth::user()->name, 0, 1) }}
                                            </span>
                                        </div>
                                    </button>

                                    <div x-show="open"
                                         @click.away="open = false"
                                         x-transition:enter="transition ease-out duration-150"
                                         x-transition:enter-start="transform opacity-0 scale-95"
                                         x-transition:enter-end="transform opacity-100 scale-100"
                                         x-transition:leave="transition ease-in duration-100"
                                         x-transition:leave-start="transform opacity-100 scale-100"
                                         x-transition:leave-end="transform opacity-0 scale-95"
                                         class="origin-top-right absolute right-0 mt-2 w-48 menu z-50"
                                         style="display: none;">
                                        <a href="#" class="menu-item">Perfil</a>
                                        <a href="#" class="menu-item">Configuración</a>
                                        <div class="menu-divider"></div>
                                        <form method="POST" action="{{ route('logout') }}">
                                            @csrf
                                            <button type="submit" class="menu-item">
                                                Cerrar sesión
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Hamburger (mobile) -->
                    <div class="-mr-2 flex items-center sm:hidden">
                        <button class="icon-btn">
                            <svg class="h-6 w-6" stroke="currentColor" fill="none" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </nav>

        <!-- Page Heading -->
        @isset($header)
            <header class="bg-white shadow">
                <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                    {{ $header }}
                </div>
            </header>
        @endisset

        <!-- Page Content -->
        <main>
            {{ $slot }}
        </main>
    </div>

    {{-- Flash Messages --}}
    @if (session('success'))
        <x-toast type="success" :message="session('success')" />
    @endif

    @if (session('error'))
        <x-toast type="error" :message="session('error')" />
    @endif

    @livewireScripts
</body>
</html>
