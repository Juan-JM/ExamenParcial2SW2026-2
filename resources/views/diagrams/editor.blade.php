{{-- resources/views/diagrams/editor.blade.php --}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="user-id" content="{{ auth()->id() }}">

    <title>
        @if(isset($diagramId))
            Editor UML - {{ config('app.name') }}
        @else
            Nuevo Diagrama - {{ config('app.name') }}
        @endif
    </title>

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500;600&display=swap" rel="stylesheet" />

    <!-- JointJS CSS -->
    <link rel="stylesheet" type="text/css" href="https://cdnjs.cloudflare.com/ajax/libs/jointjs/3.7.3/joint.css" />

    <!-- Scripts -->
    @vite(['resources/css/app.css', 'resources/js/app.js'])
    @livewireStyles
</head>
<body class="font-sans antialiased bg-gray-100">
    <div id="app" class="h-screen flex flex-col">
        {{-- La barra superior (volver, título, guardado, edición, archivo,
             compartir y usuario) es UNA sola y vive en el componente Livewire
             (livewire/diagram-editor.blade.php). Antes había dos barras
             apiladas con el título repetido. --}}

        {{-- El Tutor (asistente de ayuda con IA) es un botón flotante: resources/js/support/supportChat.js.
             En el editor se acomoda al pie del riel derecho. --}}
        <span hidden data-support-context="editor"></span>

        {{-- Editor principal --}}
        <div class="flex-1 flex flex-col min-h-0">
            @livewire('diagram-editor', ['diagramId' => $diagramId ?? null])
        </div>
    </div>

    {{-- Scripts de auto-guardado --}}
    <script>
        // Auto-save functionality
        class AutoSaveManager {
            constructor() {
                this.diagramId = @json($diagramId ?? null);
                this.autoSaveInterval = 30000; // 30 segundos
                this.lastSavedData = '';
                this.autoSaveTimer = null;
                this.isAutoSaving = false;

                this.init();
            }

            init() {
                // El diagrama ya existe desde que se entra al editor (ver
                // la ruta 'diagrams.editor'), así que this.diagramId
                // siempre viene seteado acá — ya no hace falta escuchar un
                // evento "diagram-created" para arrancar esto más tarde.
                if (this.diagramId) {
                    this.startAutoSave();
                }

                // Actualizar breadcrumb al cargar
                this.updateBreadcrumb();
            }

            startAutoSave() {
                if (this.autoSaveTimer) {
                    clearInterval(this.autoSaveTimer);
                }

                this.autoSaveTimer = setInterval(() => {
                    this.performAutoSave();
                }, this.autoSaveInterval);

                console.log('🔄 Auto-save iniciado cada', this.autoSaveInterval / 1000, 'segundos');
            }

            /**
             * Guardar poco después de una edición real (no cada 30s a lo
             * sumo) — si no, un segundo usuario que recién abre el mismo
             * diagrama puede recibir de la base de datos una versión de
             * hasta 30s desatrasada de lo que el primer usuario ya movió/
             * escribió/creó, aunque ambos estén "en vivo" al mismo tiempo:
             * lo que viaja por el WebSocket nunca se persiste por sí solo,
             * solo lo ve quien ya estaba conectado en ese instante.
             */
            scheduleImmediateSave() {
                this.hasLocalChanges = true;
                clearTimeout(this.immediateSaveTimer);
                this.immediateSaveTimer = setTimeout(() => this.performAutoSave(), 1500);
            }

            /**
             * En colaboración, cada navegador guarda solo lo que editó su propio
             * usuario. Si guardara cualquier diferencia, también guardaría los
             * cambios recibidos de otros, y una pantalla atrasada podía pisar la
             * versión más nueva guardada por quien hizo el cambio.
             */
            shouldSave(editor) {
                const collaborating = !!editor.webSocketManager?.isConnected;
                return !collaborating || this.hasLocalChanges;
            }

            async performAutoSave() {
                if (this.isAutoSaving || !this.diagramId || !window.DiagramEditor?.instance) {
                    return;
                }

                try {
                    const editor = window.DiagramEditor.instance;
                    if (!this.shouldSave(editor)) {
                        return;
                    }

                    const currentData = JSON.stringify(editor.graph.toJSON());
                    this.hasLocalChanges = false;

                    // Solo auto-guardar si hay cambios
                    if (currentData === this.lastSavedData) {
                        return;
                    }

                    this.isAutoSaving = true;
                    this.updateSaveStatus('saving', 'Auto-guardando...');

                    const response = await fetch(`/diagrams/api/${this.diagramId}/autosave`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content
                        },
                        body: JSON.stringify({
                            data: currentData
                        })
                    });

                    const result = await response.json();

                    if (result.success) {
                        this.lastSavedData = currentData;
                        this.updateSaveStatus('saved', 'Auto-guardado');
                        console.log('🔄 Auto-save exitoso');
                    } else {
                        throw new Error(result.error || 'Error en auto-save');
                    }

                } catch (error) {
                    // Se reintenta en el próximo ciclo: el cambio local sigue sin guardar.
                    this.hasLocalChanges = true;
                    console.warn('⚠️ Auto-save falló:', error);
                    this.updateSaveStatus('error', 'Error auto-guardado');
                } finally {
                    this.isAutoSaving = false;
                }
            }

            updateSaveStatus(status, text) {
                const indicator = document.getElementById('save-indicator');
                const textEl = document.getElementById('save-text');

                if (!indicator || !textEl) return;

                switch (status) {
                    case 'saving':
                        indicator.className = 'w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse';
                        break;
                    case 'saved':
                        indicator.className = 'w-1.5 h-1.5 bg-emerald-500 rounded-full';
                        break;
                    case 'error':
                        indicator.className = 'w-1.5 h-1.5 bg-red-500 rounded-full';
                        break;
                }

                textEl.textContent = text;
            }

            async updateBreadcrumb() {
                if (!this.diagramId) return;

                try {
                    const response = await fetch(`/diagrams/api/${this.diagramId}/stats`);
                    const data = await response.json();

                    if (data.title) {
                        document.title = `${data.title} - Editor UML`;
                    }
                } catch (error) {
                    console.warn('No se pudo cargar el título del diagrama:', error);
                }
            }

            // Método público para forzar guardado
            forceSave() {
                if (this.diagramId && window.DiagramEditor?.instance) {
                    const editor = window.DiagramEditor.instance;
                    const currentData = JSON.stringify(editor.graph.toJSON());

                    // Forzar guardado a través de Livewire
                    window.Livewire.dispatch('save-diagram', [currentData]);
                }
            }

            /**
             * Al cerrar o recargar la pestaña: manda lo pendiente sin esperar los
             * 1,5 s del guardado inmediato. Ese último autoguardado es el que
             * queda como versión cuando todos salen de la sesión (fin de sesión).
             * `keepalive` deja terminar el pedido aunque la página se cierre.
             */
            flushOnExit() {
                const editor = window.DiagramEditor?.instance;
                if (!this.diagramId || !editor || editor.viewerMode || editor.readOnlyCollaborator) return;
                if (!this.shouldSave(editor)) return;

                const currentData = JSON.stringify(editor.graph.toJSON());
                if (currentData === this.lastSavedData) return;

                clearTimeout(this.immediateSaveTimer);
                this.hasLocalChanges = false;
                this.lastSavedData = currentData;

                try {
                    fetch(`/diagrams/api/${this.diagramId}/autosave`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content
                        },
                        body: JSON.stringify({ data: currentData }),
                        // El navegador limita keepalive a ~64 KB: un diagrama más
                        // grande se manda igual, como pedido normal.
                        keepalive: currentData.length < 60000,
                    }).catch(() => {});
                } catch (error) {
                    console.warn('⚠️ No se pudo enviar el último autoguardado:', error);
                }
            }

            // Parar auto-save
            stop() {
                if (this.autoSaveTimer) {
                    clearInterval(this.autoSaveTimer);
                    this.autoSaveTimer = null;
                    console.log('🛑 Auto-save detenido');
                }
            }
        }

        // Inicializar cuando el DOM esté listo
        document.addEventListener('DOMContentLoaded', () => {
            window.AutoSaveManager = new AutoSaveManager();

            // Atajo de teclado para guardado manual
            document.addEventListener('keydown', (e) => {
                if (e.ctrlKey && e.key === 's') {
                    e.preventDefault();
                    window.AutoSaveManager.forceSave();
                    console.log('💾 Guardado manual activado');
                }
            });
        });

        // Limpiar al cerrar la página
        window.addEventListener('pagehide', () => {
            if (window.AutoSaveManager) {
                window.AutoSaveManager.flushOnExit();
                window.AutoSaveManager.stop();
            }
        });
    </script>

    @livewireScripts
    @stack('scripts')
</body>
</html>
