{{-- resources/views/livewire/diagram-editor.blade.php --}}
{{-- VERSIÓN SIMPLIFICADA - Solo responsabilidades de Livewire --}}
{{-- Un único elemento raíz: Livewire v3 solo puede morphear correctamente un
     componente con una sola raíz. Antes había un <link> hermano de este <div>
     (la hoja de JointJS, ya cargada por la vista padre diagrams/editor.blade.php)
     que hacía que Livewire tratara el <link> como la raíz "real" del componente
     y dejara este <div> completo fuera de cualquier actualización reactiva. --}}
<div class="h-full flex flex-col bg-gray-50">
    {{-- ============ BARRA SUPERIOR (única) ============
         Tres zonas, de izquierda a derecha:
         1. Dónde estoy: volver, título editable y estado de guardado.
         2. Edición del lienzo: deshacer, rehacer, limpiar.
         3. El diagrama hacia afuera: quién está, compartir, importar/exportar,
            guardar (acción primaria) y la cuenta. --}}
    <header class="editor-topbar">
        <div class="editor-topbar-zone editor-topbar-start">
            <a href="{{ route('diagrams.index') }}" id="support-target-dashboard" class="topbar-back" title="Volver a Mis Diagramas">
                <x-icon name="arrow-left" :size="16" />
                <span>Mis Diagramas</span>
            </a>

            <span class="topbar-sep" aria-hidden="true"></span>

            <div class="topbar-title-block">
                @if (!$diagram || $diagram->canBeEditedBy(auth()->user()))
                    {{-- Clic para renombrar (updateTitle en el componente). --}}
                    <div x-data="{ editing: false }" class="min-w-0">
                        <h1
                            x-show="!editing"
                            @click="editing = true; $nextTick(() => $refs.titleInput.focus())"
                            class="topbar-title is-editable"
                            title="Clic para renombrar"
                            role="button"
                            id="support-target-rename"
                            aria-label="Renombrar diagrama: {{ $diagramTitle }}"
                        >{{ $diagramTitle }}</h1>
                        <input
                            x-show="editing"
                            x-ref="titleInput"
                            type="text"
                            wire:model="diagramTitle"
                            @blur="editing = false; window.currentDiagramTitle = $wire.diagramTitle; $wire.updateTitle()"
                            @keydown.enter.prevent="editing = false; window.currentDiagramTitle = $wire.diagramTitle; $wire.updateTitle()"
                            @keydown.escape.prevent="editing = false; $wire.diagramTitle = @js($diagramTitle)"
                            maxlength="255"
                            class="topbar-title-input"
                        >
                    </div>
                @else
                    <h1 class="topbar-title">{{ $diagramTitle }}</h1>
                    <span class="topbar-badge" title="Tu rol en este diagrama solo permite verlo">Solo lectura</span>
                @endif

                {{-- Estado de guardado: lo actualiza AutoSaveManager (diagrams/editor.blade.php)
                     tocando #save-indicator / #save-text; wire:ignore para que un morph no lo pise. --}}
                <div wire:ignore>
                    <span id="save-status" class="topbar-save-status" title="El diagrama se guarda solo poco después de cada cambio">
                        <span class="w-1.5 h-1.5 bg-emerald-500 rounded-full" id="save-indicator"></span>
                        <span id="save-text">Guardado</span>
                    </span>
                </div>
            </div>
        </div>

        <div class="editor-topbar-zone editor-topbar-center" role="toolbar" aria-label="Edición del lienzo">
            <div class="topbar-segment">
                {{-- Deshacer/rehacer por usuario (undo/DiagramUndoManager.js):
                     wire:ignore para que Livewire no le pise el estado
                     habilitado/deshabilitado que maneja JS. --}}
                <div wire:ignore class="flex items-center">
                    <button id="undoBtn" type="button" class="topbar-icon-btn" title="Deshacer (Ctrl+Z)" aria-label="Deshacer" disabled>
                        <x-icon name="undo" :size="16" />
                    </button>
                    <button id="redoBtn" type="button" class="topbar-icon-btn" title="Rehacer (Ctrl+Y)" aria-label="Rehacer" disabled>
                        <x-icon name="redo" :size="16" />
                    </button>
                </div>
                <span class="topbar-segment-sep" aria-hidden="true"></span>
                <button
                    type="button"
                    {{-- Confirmación con el diálogo propio (window.uiConfirm), no wire:confirm, que usa el confirm() del navegador --}}
                    x-data
                    @click="window.uiConfirm({ tone: 'danger', title: '¿Limpiar toda la pizarra?', message: 'Se borran todas las clases y relaciones, para todos los que tienen el diagrama abierto. Puedes recuperarlas con Deshacer (Ctrl+Z).', confirmLabel: 'Limpiar pizarra' }).then(ok => ok && $wire.clearDiagram())"
                    class="topbar-icon-btn is-danger"
                    title="Limpiar pizarra (borra todas las clases y relaciones)"
                    aria-label="Limpiar pizarra">
                    <x-icon name="trash" :size="16" />
                </button>
            </div>
        </div>

        <div class="editor-topbar-zone editor-topbar-end">
            {{-- Presencia en vivo: la puebla JS a partir de los eventos
                 de presencia del canal (join/leave), no un timer. Ver
                 DiagramWebSocketManager (channel.here/joining/leaving) y
                 DiagramCollaborationManager (updateCollaboratorsUI). --}}
            <div wire:ignore class="flex items-center gap-3">
                <div id="collaborators-bar" class="collaborators-bar" style="display: none;" title="Personas con el diagrama abierto ahora">
                    <div id="collaborators-list"></div>
                </div>
                <span class="topbar-sep" id="collaborators-divider" style="display: none;" aria-hidden="true"></span>
            </div>

            @if($diagram && $diagram->user_id === auth()->id())
                <button
                    type="button"
                    id="support-target-share"
                    onclick="window.Livewire.dispatch('open-share-modal')"
                    class="btn btn-secondary btn-sm">
                    <x-icon name="users" :size="14" /> Compartir
                </button>
            @endif

            {{-- Archivo: importar y exportar van juntos, como un grupo segmentado --}}
            <div class="topbar-button-group">
                {{-- Dropdown de Importación --}}
                <div class="relative" x-data="{ open: false }">
                    <button
                        type="button"
                        @click="open = !open"
                        @click.outside="open = false"
                        :aria-expanded="open"
                        class="topbar-group-btn">
                        <x-icon name="folder" :size="14" /> Importar
                        <svg class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-180': open }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </button>

                    <div
                        x-show="open"
                        x-transition:enter="transition ease-out duration-150"
                        x-transition:enter-start="opacity-0 scale-95"
                        x-transition:enter-end="opacity-100 scale-100"
                        x-transition:leave="transition ease-in duration-100"
                        x-transition:leave-start="opacity-100 scale-100"
                        x-transition:leave-end="opacity-0 scale-95"
                        class="absolute top-full right-0 mt-2 w-64 menu z-50"
                        style="display: none;">

                        <div class="menu-section">Desde archivo</div>

                        <button id="import-xmi-btn" @click="open = false" class="menu-item">
                            <x-icon name="document" :size="16" class="menu-item-icon" />
                            Importar XML/XMI
                            <span class="menu-item-tag">UML 2.5</span>
                        </button>

                        <div class="menu-divider"></div>

                        <div class="menu-section">Desde imagen (IA)</div>

                        <button id="import-image-btn" @click="open = false" class="menu-item">
                            <x-icon name="image" :size="16" class="menu-item-icon" />
                            Analizar imagen
                            <span class="menu-item-tag">IA</span>
                        </button>
                    </div>
                </div>

                {{-- Dropdown de Exportación --}}
                <div class="relative" x-data="{ open: false }">
                    <button
                        type="button"
                        id="support-target-export"
                        @click="open = !open"
                        @click.outside="open = false"
                        :aria-expanded="open"
                        class="topbar-group-btn">
                        <x-icon name="document" :size="14" /> Exportar
                        <svg class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-180': open }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </button>

                    <div
                        x-show="open"
                        x-transition:enter="transition ease-out duration-200"
                        x-transition:enter-start="opacity-0 scale-95"
                        x-transition:enter-end="opacity-100 scale-100"
                        x-transition:leave="transition ease-in duration-150"
                        x-transition:leave-start="opacity-100 scale-100"
                        x-transition:leave-end="opacity-0 scale-95"
                        class="absolute top-full right-0 mt-2 w-60 menu z-50"
                        style="display: none;">

                        <div class="menu-section">Imágenes</div>

                        <button id="export-png-btn" @click="open = false" class="menu-item">
                            <x-icon name="image" :size="16" class="menu-item-icon" />
                            Exportar PNG
                        </button>

                        <button id="export-jpg-btn" @click="open = false" class="menu-item">
                            <x-icon name="image" :size="16" class="menu-item-icon" />
                            Exportar JPG
                        </button>

                        <div class="menu-divider"></div>

                        <div class="menu-section">Otros formatos</div>
                        <button id="export-xmi-btn" @click="open = false" class="menu-item">
                            <x-icon name="document" :size="16" class="menu-item-icon" />
                            Exportar XMI
                            <span class="menu-item-tag">UML 2.5</span>
                        </button>

                        <button id="generate-sql-btn" @click="open = false" class="menu-item">
                            <x-icon name="database" :size="16" class="menu-item-icon" />
                            Generar SQL
                            <span class="menu-item-tag">PostgreSQL</span>
                        </button>

                        <div class="menu-divider"></div>
                        <div class="menu-section">Backend</div>
                        <button id="generate-java-btn" @click="open = false" class="menu-item">
                            <x-icon name="code" :size="16" class="menu-item-icon" />
                            Generar Java
                            <span class="menu-item-tag">Spring Boot</span>
                        </button>

                        <button id="generate-postman-btn" @click="open = false" class="menu-item">
                            <x-icon name="send" :size="16" class="menu-item-icon" />
                            Generar Postman
                            <span class="menu-item-tag">API Collection</span>
                        </button>
                    </div>
                </div>
            </div>

            <button id="support-target-save" type="button" onclick="saveFromButton()" class="btn btn-primary btn-sm" title="Guardar ahora (Ctrl+S) — igual se guarda solo">
                <x-icon name="save" :size="14" /> Guardar
            </button>

            <span class="topbar-sep" aria-hidden="true"></span>

            {{-- Cuenta --}}
            <x-dropdown align="right" width="48">
                <x-slot name="trigger">
                    <button type="button" class="topbar-account" title="{{ Auth::user()->name }}">
                        <span class="topbar-account-avatar">{{ strtoupper(substr(Auth::user()->name, 0, 1)) }}</span>
                        <span class="topbar-account-name">{{ Auth::user()->name }}</span>
                        <x-icon name="chevron-down" :size="14" />
                    </button>
                </x-slot>

                <x-slot name="content">
                    <x-dropdown-link :href="route('profile.edit')">
                        {{ __('Perfil') }}
                    </x-dropdown-link>

                    <form method="POST" action="{{ route('logout') }}">
                        @csrf
                        <x-dropdown-link :href="route('logout')"
                                onclick="event.preventDefault(); this.closest('form').submit();">
                            {{ __('Cerrar sesión') }}
                        </x-dropdown-link>
                    </form>
                </x-slot>
            </x-dropdown>
        </div>
    </header>

    {{-- wire:ignore: JointJS y app.js mutan este árbol directamente (el canvas,
         el toolbar generado por JS, los overlays de estado). Si Livewire intenta
         reconciliarlo en cada morph choca con esos cambios externos y el morph
         de TODO el componente deja de aplicarse (incluida esta misma barra
         superior) — por eso el modal "Compartir" no se actualizaba. --}}
    <div class="flex flex-1 overflow-hidden" wire:ignore>
        {{-- ============ IZQUIERDA: PALETA (solo crear) ============
             Clase/Interfaz se arrastran al lienzo; las relaciones se eligen y
             se hacen dos clics (origen → destino). La arma app.js (setupToolbar).
             Ancho ajustable (DiagramSidebarResize.js). --}}
        <aside id="editor-sidebar" class="editor-palette" style="width: 248px;" aria-label="Paleta de herramientas UML">
            <div class="editor-palette-header">
                <span class="editor-palette-title">Herramientas UML</span>
            </div>

            <div id="uml-tools-tab-panel" class="flex-1 flex flex-col overflow-hidden">
                {{-- Container para toolbar generado por JavaScript --}}
                <div id="js-toolbar" class="flex-1 overflow-y-auto">
                    <div class="p-4 text-center text-gray-400 text-sm" id="loading-toolbar">
                        <div class="animate-pulse">Cargando herramientas...</div>
                    </div>
                </div>
            </div>

            {{-- Agarradera para redimensionar el ancho de la paleta --}}
            <div id="sidebar-resize-handle" class="sidebar-resize-handle" title="Arrastrar para cambiar el ancho"></div>
        </aside>

        {{-- ============ CENTRO: LIENZO + atributos/métodos abajo ============ --}}
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
            <div class="flex-1 relative overflow-hidden">
                <div
                    id="paper-container"
                    class="w-full h-full bg-gray-50 relative">
                    {{-- JointJS se renderiza aquí — el propio JointJS reemplaza el
                         contenido de este div al inicializar el Paper, así que
                         ningún overlay puede vivir DENTRO de él. Los overlays van
                         afuera, como hermanos, sobre el mismo contenedor relative. --}}
                </div>

                {{-- Overlay de estado: medidor de latencia y conexión de red --}}
                <div id="connection-status" class="connection-status absolute top-4 left-4 z-10" style="display: none;" title="Latencia servidor + red">
                    <span id="connection-status-dot" class="connection-status-dot"></span>
                    <span id="connection-status-text">Conectando…</span>
                </div>

                {{-- Popup transitorio: alguien más ya está editando el elemento que se intentó tocar --}}
                <div id="lock-conflict-popup" class="lock-conflict-popup" style="display: none;">
                    <span id="lock-conflict-text"></span>
                </div>

                {{-- Zoom + info del diagrama, agrupados en un popup flotante abajo a la izquierda --}}
                <div class="canvas-info-popup">
                    <div class="zoom-controls">
                        <button id="zoom-in" class="zoom-btn" title="Acercar (Ctrl +)">
                            <x-icon name="zoom-in" :size="16" />
                        </button>
                        <button id="zoom-out" class="zoom-btn" title="Alejar (Ctrl −)">
                            <x-icon name="zoom-out" :size="16" />
                        </button>
                        <button id="zoom-fit" class="zoom-btn" title="Ajustar al contenido (Ctrl+9)">
                            <x-icon name="frame" :size="16" />
                        </button>
                    </div>
                    <div class="h-4 w-px bg-gray-200"></div>
                    <span id="canvas-info">
                        0 clases · 0 relaciones · 100%
                    </span>
                </div>

                {{-- Loading overlay — SOLO para "Limpiar" (wire:target). --}}
                <div
                    wire:loading
                    wire:target="clearDiagram"
                    class="absolute inset-0 bg-gray-900 bg-opacity-10 flex items-center justify-center z-20">
                    <div class="card px-6 py-3">
                        <div class="flex items-center space-x-3">
                            <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-zinc-900"></div>
                            <span class="text-gray-600 font-medium">Procesando...</span>
                        </div>
                    </div>
                </div>
            </div>

            {{-- Panel inferior: atributos y métodos de la clase/interfaz seleccionada --}}
            <div id="properties-bottom-panel" class="properties-panel properties-panel-bottom is-collapsed">
                <button type="button" id="bottom-panel-toggle" class="properties-panel-toggle-bottom" title="Mostrar/ocultar atributos y métodos">
                    <x-icon name="chevron-down" :size="14" />
                </button>
                <div class="properties-panel-bottom-content" id="properties-bottom-content">
                    <div class="properties-panel-empty">Haz doble clic en una clase o interfaz para ver sus atributos y métodos.</div>
                </div>
            </div>
        </div>

        {{-- ============ DERECHA 1: INSPECTOR del elemento seleccionado ============ --}}
        <div id="properties-right-panel" class="properties-panel properties-panel-right is-collapsed">
            <button type="button" id="right-panel-toggle" class="properties-panel-toggle-right" title="Mostrar/ocultar propiedades">
                <x-icon name="chevron-down" :size="14" />
            </button>
            <div class="properties-panel-right-content" id="properties-right-content">
                <div class="properties-panel-empty">Haz doble clic en un elemento del diagrama para ver sus propiedades.</div>
            </div>
        </div>

        {{-- ============ DERECHA 2: PANEL DEL EQUIPO (Nova, Actividad, Versiones) ============
             Se abre desde el riel. El contenido lo arma AIChatPanel.js y la
             apertura/cierre la maneja AIChatController (openDock/closeDock). --}}
        <aside id="editor-dock" class="editor-dock" hidden aria-label="Panel del equipo">
            <div id="ai-chat-tab-panel" class="editor-dock-inner"></div>
        </aside>

        {{-- Riel: siempre visible, abre/cierra el panel del equipo.
             #sidebar-tab-ai se conserva como id del botón de Nova (lo usa el Tutor). --}}
        <nav id="editor-rail" class="editor-rail" aria-label="Equipo">
            <button type="button" class="editor-rail-btn" id="sidebar-tab-ai" data-dock="chat" aria-pressed="false" title="Nova: conversación del equipo con la IA">
                <span class="editor-rail-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.6L18 9l-4.2 1.9L12 15l-1.8-4.1L6 9l4.2-1.4L12 3z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15z"/></svg>
                    <span class="editor-rail-badge" id="editor-rail-unread" hidden></span>
                </span>
                <span class="editor-rail-label" id="editor-rail-agent-name">Nova</span>
            </button>
            <button type="button" class="editor-rail-btn" id="dock-tab-activity" data-dock="activity" aria-pressed="false" title="Actividad: quién cambió qué, con búsqueda">
                <span class="editor-rail-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>
                </span>
                <span class="editor-rail-label">Actividad</span>
            </button>
            <button type="button" class="editor-rail-btn" id="dock-tab-versions" data-dock="versions" aria-pressed="false" title="Versiones guardadas del diagrama">
                <span class="editor-rail-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>
                </span>
                <span class="editor-rail-label">Versiones</span>
            </button>
        </nav>
    </div>

    {{-- Modal "Compartir": invitar colaboradores --}}
    @if($shareModalOpen)
        <div class="modal-overlay" wire:keydown.escape="closeShareModal">
            <div class="modal-dialog card" style="max-width: 480px;">
                <div class="modal-header">
                    <h3 class="modal-title"><x-icon name="users" :size="18" /> Compartir diagrama</h3>
                    <button wire:click="closeShareModal" class="icon-btn"><x-icon name="close" :size="16" /></button>
                </div>

                <form wire:submit.prevent="sendInvitation" class="modal-section">
                    <div class="form-group" style="position: relative;">
                        <label class="form-label">Correo del colaborador</label>
                        <input type="email" wire:model.live.debounce.300ms="inviteEmail" autocomplete="off" class="form-input" placeholder="persona@email.com">
                        @error('inviteEmail') <p style="color: var(--uml-error); font-size: 12px; margin: 4px 0 0;">{{ $message }}</p> @enderror
                        <p style="margin: 6px 0 0; font-size: 12px; color: var(--uml-gray-500);">
                            Si ya tiene cuenta le llega una notificación; si no, le enviamos un correo para registrarse.
                        </p>

                        @if($this->matchingUsers->count() > 0)
                            <div class="menu" style="position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px; z-index: 10;">
                                <div class="menu-section">Usuarios registrados</div>
                                @foreach($this->matchingUsers as $user)
                                    <button type="button" wire:click="selectUserForInvite('{{ $user->id }}')" class="menu-item">
                                        <x-icon name="users" :size="14" class="menu-item-icon" />
                                        <span>{{ $user->name }} <span style="color: var(--uml-gray-400);">{{ $user->email }}</span></span>
                                    </button>
                                @endforeach
                            </div>
                        @endif
                    </div>

                    <div class="form-group">
                        <label class="form-checkbox-row">
                            <input type="checkbox" wire:model="inviteCanEdit" />
                            Puede editar <span class="form-label-hint">(si no, solo puede ver)</span>
                        </label>
                    </div>

                    <button type="submit" class="btn btn-primary btn-block">
                        <x-icon name="send" :size="14" /> Enviar invitación
                    </button>
                </form>

                @if($this->pendingInvitations->count() > 0)
                    <div class="modal-section">
                        <div class="modal-section-title">Invitaciones pendientes</div>
                        @foreach($this->pendingInvitations as $invitation)
                            <div class="form-checkbox-row" style="justify-content: space-between; padding: 4px 0;">
                                <span>{{ $invitation->invitee_email }}</span>
                                <span class="menu-item-tag">{{ $invitation->role === 'editor' ? 'Editor' : 'Observador' }}</span>
                            </div>
                        @endforeach
                    </div>
                @endif

                @if($this->collaborators->count() > 0)
                    <div class="modal-section">
                        <div class="modal-section-title">Colaboradores</div>
                        @foreach($this->collaborators as $collaborator)
                            <div class="form-checkbox-row" style="justify-content: space-between; padding: 6px 0;">
                                <span>
                                    {{ $collaborator->display_name }}
                                    <span class="menu-item-tag">{{ $collaborator->is_online ? 'En línea' : 'Desconectado' }}</span>
                                </span>

                                @if($collaborator->role === 'owner')
                                    <span class="menu-item-tag">Dueño</span>
                                @else
                                    <span style="display: flex; align-items: center; gap: 10px;">
                                        <label class="form-checkbox-row" style="gap: 6px;">
                                            <input
                                                type="checkbox"
                                                {{ $collaborator->role === 'editor' ? 'checked' : '' }}
                                                wire:click="updateCollaboratorRole('{{ $collaborator->id }}', {{ $collaborator->role === 'editor' ? 'false' : 'true' }})"
                                            />
                                            Puede editar
                                        </label>
                                        <button
                                            type="button"
                                            x-data
                                            @click="window.uiConfirm({ tone: 'danger', title: @js('¿Quitar a '.$collaborator->display_name.' de este diagrama?'), message: 'Pierde el acceso al instante; si lo tiene abierto, se le cierra.', confirmLabel: 'Quitar' }).then(ok => ok && $wire.removeCollaborator(@js((string) $collaborator->id)))"
                                            class="icon-btn"
                                            title="Quitar colaborador">
                                            <x-icon name="close" :size="14" />
                                        </button>
                                    </span>
                                @endif
                            </div>
                        @endforeach
                    </div>
                @endif
            </div>
        </div>
    @endif

    {{-- Notificaciones flash - Solo para operaciones Livewire --}}
    @if (session()->has('message'))
        <x-toast type="success" :message="session('message')" />
    @endif

    {{-- Error notifications --}}
    @if (session()->has('error'))
        <x-toast type="error" :message="session('error')" />
    @endif

    {{-- Scripts simplificados --}}
    <script>
        // Datos del diagrama para JavaScript
        window.diagramData = @json($diagramData);
        window.diagramId = @json($diagramId ?? null);
        window.diagramTitle = @json($diagramTitle ?? 'Nuevo Diagrama UML');
        window.authUser = @json(auth()->user());
        // El asistente de IA ya no llama a ningún proveedor directo desde acá
        // (ver documentacion/06-asistente-ia.md) — solo necesita saber a qué
        // endpoint propio pegarle. La API key nunca sale del backend.
        window.aiAssistant = {
            enabled: @json(config('services.ai.enabled', true)),
            stateUrl: @json($diagramId ? route('diagrams.agent.state', $diagramId) : null),
            messageUrl: @json($diagramId ? route('diagrams.agent.message', $diagramId) : null),
            activityUrl: @json($diagramId ? route('diagrams.agent.activity', $diagramId) : null),
            heartbeatUrl: @json($diagramId ? route('diagrams.agent.heartbeat', $diagramId) : null),
            leaveUrl: @json($diagramId ? route('diagrams.agent.leave', $diagramId) : null),
            versionsUrl: @json($diagramId ? route('diagrams.versions.index', $diagramId) : null),
            currentDiagramUrl: @json($diagramId ? route('diagrams.versions.current', $diagramId) : null),
            searchUrl: @json($diagramId ? route('diagrams.agent.search', $diagramId) : null),
            closeSessionUrl: @json($diagramId ? route('diagrams.agent.close-session', $diagramId) : null),
            sessionsBaseUrl: @json($diagramId ? url('/diagrams/'.$diagramId.'/agent/sessions') : null),
            importImageUrl: @json($diagramId ? route('diagrams.ai.import-image', $diagramId) : null),
        };
        // NUEVO: Datos de sesión colaborativa
        // IMPORTANTE: nunca condicionar estas asignaciones con una directiva
        // Blade de bloque (if/endif) aquí dentro. Livewire inserta comentarios
        // de límite de bloque alrededor de esas directivas, y ese comentario,
        // al caer dentro de un <script>, es válido como inicio de comentario
        // JS heredado de una sola línea y se come la primera línea del bloque
        // entero, dejando la asignación sin ejecutar en silencio. Por eso se
        // asigna siempre, con `null` si no aplica.
        window.diagramSessionId = @json($collaborationSession ?? null);
        window.collaboratorRole = @json($collaboratorRole ?? null);
        // Para el canal 'diagram-lobby.{diagramId}' (ver editor.js): solo el
        // dueño lo escucha, para enterarse en vivo de que se activó la
        // colaboración sin haber tenido sesión al cargar la página.
        window.isDiagramOwner = @json($diagram && $diagram->user_id === auth()->id());
        if (window.diagramSessionId) {
            console.log('🤝 Sesión colaborativa detectada:', window.diagramSessionId, window.collaboratorRole);
        }

        console.log('📊 Datos del template:', {
            hasData: window.diagramData !== '[]',
            diagramId: window.diagramId,
            title: window.diagramTitle,
            dataLength: window.diagramData.length
        });

        // Función simple para guardar desde botón
        function saveFromButton() {
            console.log('💾 Guardado desde botón...');

            if (window.DiagramEditor && window.DiagramEditor.instance) {
                window.DiagramEditor.instance.saveDiagram();
            } else {
                console.error('❌ Editor no disponible');
                window.uiAlert?.({ tone: 'warning', title: 'El editor todavía está cargando', message: 'Espera un momento y vuelve a intentar.' });
            }
        }

        // El botón "Limpiar" ($wire.clearDiagram() tras window.uiConfirm, ver
        // arriba en este mismo archivo) solo limpia el $diagramData del LADO
        // DEL SERVIDOR y dispara este evento — nada escuchaba 'clear-diagram'
        // del lado del cliente, así que el lienzo (el grafo real de JointJS)
        // nunca se vaciaba: el botón "no hacía nada" visualmente. Acá se
        // completa la otra mitad.
        document.addEventListener('livewire:initialized', () => {
            Livewire.on('clear-diagram', () => {
                window.DiagramEditor?.instance?.clearDiagram();
            });
        });

        console.log('✅ Template Livewire scripts cargados');
    </script>
</div>
