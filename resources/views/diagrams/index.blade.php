{{-- resources/views/diagrams/index.blade.php --}}
<x-app-layout>
    <x-slot name="header">
        <div class="flex justify-between items-center">
            <h2 class="font-semibold text-xl text-gray-900 leading-tight">
                {{ __('Mis Diagramas UML') }}
            </h2>
            <a href="{{ route('diagrams.editor') }}" id="support-target-new-diagram-header" class="btn btn-primary">
                <x-icon name="plus" :size="15" />
                Nuevo Diagrama
            </a>
        </div>
    </x-slot>

    <div class="py-6">
        <div class="max-w-7xl mx-auto sm:px-6 lg:px-8">

            {{-- Estadísticas rápidas --}}
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div class="card p-5 flex items-center gap-4">
                    <div class="w-9 h-9 rounded-md bg-zinc-100 text-zinc-900 flex items-center justify-center flex-shrink-0">
                        <x-icon name="chart" :size="18" />
                    </div>
                    <div>
                        <dt class="text-xs font-medium text-gray-500">Total</dt>
                        <dd class="text-lg font-semibold text-gray-900">{{ $stats['total'] }}</dd>
                    </div>
                </div>

                <div class="card p-5 flex items-center gap-4">
                    <div class="w-9 h-9 rounded-md bg-gray-100 text-gray-600 flex items-center justify-center flex-shrink-0">
                        <x-icon name="lock" :size="18" />
                    </div>
                    <div>
                        <dt class="text-xs font-medium text-gray-500">Privados</dt>
                        <dd class="text-lg font-semibold text-gray-900">{{ $stats['private'] }}</dd>
                    </div>
                </div>

                <div class="card p-5 flex items-center gap-4">
                    <div class="w-9 h-9 rounded-md bg-zinc-100 text-zinc-900 flex items-center justify-center flex-shrink-0">
                        <x-icon name="users" :size="18" />
                    </div>
                    <div>
                        <dt class="text-xs font-medium text-gray-500">Compartidos</dt>
                        <dd class="text-lg font-semibold text-gray-900">{{ $stats['shared'] }}</dd>
                    </div>
                </div>

                <div class="card p-5 flex items-center gap-4">
                    <div class="w-9 h-9 rounded-md bg-gray-100 text-gray-600 flex items-center justify-center flex-shrink-0">
                        <x-icon name="template" :size="18" />
                    </div>
                    <div>
                        <dt class="text-xs font-medium text-gray-500">Templates</dt>
                        <dd class="text-lg font-semibold text-gray-900">{{ $stats['templates'] }}</dd>
                    </div>
                </div>
            </div>

            {{-- Filtros y búsqueda --}}
            <div class="card mb-6">
                <div class="p-5">
                    <form method="GET" action="{{ route('diagrams.index') }}" class="space-y-3 sm:space-y-0 sm:flex sm:items-center sm:space-x-3">
                        <div class="flex-1 relative">
                            <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                                <x-icon name="search" :size="16" />
                            </span>
                            <input type="text"
                                   name="search"
                                   value="{{ $filters['search'] }}"
                                   placeholder="Buscar por título o descripción..."
                                   class="block w-full pl-9 border-gray-300 rounded-md shadow-sm focus:border-zinc-800 focus:ring-zinc-800 sm:text-sm">
                        </div>

                        <div>
                            <select name="visibility" class="border-gray-300 rounded-md shadow-sm focus:border-zinc-800 focus:ring-zinc-800 sm:text-sm">
                                <option value="">Todas las visibilidades</option>
                                <option value="private" {{ $filters['visibility'] === 'private' ? 'selected' : '' }}>Privados</option>
                                <option value="shared" {{ $filters['visibility'] === 'shared' ? 'selected' : '' }}>Compartidos</option>
                                <option value="public" {{ $filters['visibility'] === 'public' ? 'selected' : '' }}>Públicos</option>
                            </select>
                        </div>

                        <div class="flex items-center">
                            <input type="checkbox"
                                   name="templates"
                                   id="templates"
                                   value="1"
                                   {{ $filters['is_template'] ? 'checked' : '' }}
                                   class="h-4 w-4 text-zinc-900 border-gray-300 rounded focus:ring-zinc-800">
                            <label for="templates" class="ml-2 text-sm text-gray-700">Solo templates</label>
                        </div>

                        <div class="flex gap-2">
                            <button type="submit" class="btn btn-secondary">
                                <x-icon name="search" :size="14" />
                                Filtrar
                            </button>
                            <a href="{{ route('diagrams.index') }}" class="btn btn-ghost">
                                <x-icon name="close" :size="14" />
                                Limpiar
                            </a>
                        </div>
                    </form>
                </div>
            </div>

            {{-- Mis diagramas --}}
            @include('diagrams.partials.diagram-grid', [
                'diagrams' => $diagrams,
                'emptyTitle' => 'No tienes diagramas aún',
                'emptyMessage' => 'Comenzá creando tu primer diagrama de clases UML',
                'emptyAction' => true,
            ])

            {{-- Compartidos conmigo: diagramas de otros donde te invitaron
                 como colaborador — a esta sección apunta el link de la
                 notificación de invitación. --}}
            <div id="compartidos" class="mt-10 pt-8 border-t border-gray-200">
                <h2 class="text-lg font-semibold text-gray-900 mb-4">Compartidos conmigo</h2>

                @include('diagrams.partials.diagram-grid', [
                    'diagrams' => $sharedDiagrams,
                    'emptyTitle' => 'Todavía nadie compartió un diagrama contigo',
                    'emptyMessage' => 'Cuando alguien te invite a colaborar en uno de los suyos, va a aparecer aquí.',
                    'emptyAction' => false,
                ])
            </div>
        </div>
    </div>

    {{-- Notificaciones --}}
    @if (session('success'))
        <x-toast type="success" :message="session('success')" />
    @endif
</x-app-layout>
