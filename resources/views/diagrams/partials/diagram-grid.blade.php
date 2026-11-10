{{-- resources/views/diagrams/partials/diagram-grid.blade.php
     Grilla de tarjetas de diagrama, reutilizada por "Mis diagramas" y
     "Compartidos conmigo" — la única diferencia entre ambas secciones es
     QUÉ paginator llega aquí, no cómo se dibuja cada tarjeta. --}}
@if($diagrams->count() > 0)
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        @foreach($diagrams as $diagram)
            <div class="card card-hover">
                <div class="p-5">
                    {{-- Header del diagrama --}}
                    <div class="flex items-start justify-between mb-3 gap-3">
                        <div class="flex-1 min-w-0">
                            <h3 class="text-base font-semibold text-gray-900 truncate">
                                {{ $diagram->title }}
                            </h3>
                            @if($diagram->description)
                                <p class="mt-1 text-sm text-gray-500 line-clamp-2">
                                    {{ Str::limit($diagram->description, 100) }}
                                </p>
                            @endif
                        </div>

                        {{-- Indicador de visibilidad --}}
                        <div class="flex-shrink-0 flex flex-col items-end gap-1">
                            @if($diagram->visibility === 'private')
                                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                                    <x-icon name="lock" :size="11" /> Privado
                                </span>
                            @elseif($diagram->visibility === 'shared')
                                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-800">
                                    <x-icon name="users" :size="11" /> Compartido
                                </span>
                            @elseif($diagram->visibility === 'public')
                                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                                    <x-icon name="globe" :size="11" /> Público
                                </span>
                            @endif

                            @if($diagram->is_template)
                                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                                    <x-icon name="template" :size="11" /> Template
                                </span>
                            @endif
                        </div>
                    </div>

                    {{-- Estadísticas del diagrama --}}
                    <div class="flex items-center text-xs text-gray-500 gap-3 mb-4">
                        <span>{{ $diagram->elements_count }} elementos</span>
                        <span class="text-gray-300">·</span>
                        <span>{{ $diagram->classes_count }} clases</span>
                        <span class="text-gray-300">·</span>
                        <span>v{{ $diagram->version }}</span>
                    </div>

                    {{-- Fechas --}}
                    <div class="text-xs text-gray-400 mb-2">
                        <div>Creado: {{ $diagram->created_at->format('d/m/Y H:i') }}</div>
                        @if($diagram->last_saved_at)
                            <div>Guardado: {{ $diagram->last_saved_at->diffForHumans() }}</div>
                        @endif
                    </div>

                    {{-- Colaboración: dueño y quién está trabajando en esto --}}
                    @php($activeSession = $diagram->sessions->first())
                    <div class="flex items-center flex-wrap text-xs text-gray-500 gap-x-3 gap-y-1 mb-4">
                        <span class="flex items-center gap-1">
                            <x-icon name="users" :size="12" />
                            {{ $diagram->user->name }}
                        </span>
                        @if($activeSession && $activeSession->collaborators->count() > 0)
                            <span class="text-gray-300">·</span>
                            <span>
                                {{ $activeSession->collaborators->count() }}
                                {{ Str::plural('colaborador', $activeSession->collaborators->count()) }}
                            </span>
                            @php($onlineCount = $activeSession->collaborators->filter->is_online->count())
                            @if($onlineCount > 0)
                                <span class="inline-flex items-center gap-1 text-emerald-600 font-medium">
                                    <span class="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                                    {{ $onlineCount }} en línea
                                </span>
                            @endif
                        @endif
                    </div>

                    {{-- Botones de acción --}}
                    @php($myRole = $diagram->user_id === auth()->id() ? 'owner' : $activeSession?->collaborators->firstWhere('user_id', auth()->id())?->role)
                    @php($canEditDiagram = in_array($myRole, ['owner', 'editor'], true))
                    <div class="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                        @if($canEditDiagram)
                            <a href="{{ route('diagrams.editor', $diagram->slug) }}" class="btn btn-primary btn-sm">
                                <x-icon name="pencil" :size="13" /> Editar
                            </a>
                        @endif

                        <a href="{{ route('diagrams.show', $diagram->id) }}" class="btn btn-secondary btn-sm">
                            <x-icon name="eye" :size="13" /> Ver
                        </a>

                        <form method="POST" action="{{ route('diagrams.duplicate', $diagram->id) }}" class="inline">
                            @csrf
                            <button type="submit" class="btn btn-secondary btn-sm">
                                <x-icon name="copy" :size="13" /> Clonar
                            </button>
                        </form>

                        @if($diagram->user_id === auth()->id())
                            <form method="POST" action="{{ route('diagrams.destroy', $diagram->id) }}"
                                  class="inline"
                                  onsubmit="event.preventDefault(); window.uiConfirm({ tone: 'danger', title: {{ \Illuminate\Support\Js::from('¿Eliminar «'.$diagram->title.'»?') }}, message: 'Deja de estar disponible para ti y para sus colaboradores. No se puede deshacer.', confirmLabel: 'Eliminar diagrama' }).then(ok => ok && this.submit())">
                                @csrf
                                @method('DELETE')
                                <button type="submit" class="btn btn-danger btn-sm">
                                    <x-icon name="trash" :size="13" /> Eliminar
                                </button>
                            </form>
                        @endif
                    </div>
                </div>
            </div>
        @endforeach
    </div>

    <div class="mt-6">
        {{ $diagrams->appends(request()->query())->links() }}
    </div>
@else
    <div class="card">
        <div class="p-16 text-center">
            <div class="w-16 h-16 mx-auto bg-gray-100 rounded-full flex items-center justify-center mb-5 text-gray-400">
                <x-icon name="chart" :size="28" />
            </div>

            <h3 class="text-base font-medium text-gray-900 mb-1.5">{{ $emptyTitle ?? 'No tienes diagramas aún' }}</h3>
            <p class="text-sm text-gray-500 mb-6">{{ $emptyMessage ?? 'Comenzá creando tu primer diagrama de clases UML' }}</p>

            @if($emptyAction ?? true)
                <a href="{{ route('diagrams.editor') }}" class="btn btn-primary">
                    <x-icon name="plus" :size="15" />
                    Crear mi primer diagrama
                </a>
            @endif
        </div>
    </div>
@endif
