{{-- resources/views/diagrams/viewer.blade.php
     Vista "Ver" (solo lectura). Usa el MISMO motor que el editor
     (UMLDiagramEditor con window.UML_VIEWER_MODE): mismas formas, mismo
     trazado de relaciones, clase asociativa y tiempo real. Con ?embed=1 solo
     queda el lienzo: lo embebe la app móvil (ver documentacion/10-app-movil.md). --}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="theme-color" content="#fafafa">
    <title>{{ $diagram->title }} · Vista</title>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet" />
    <link rel="stylesheet" type="text/css" href="https://cdnjs.cloudflare.com/ajax/libs/jointjs/3.7.3/joint.css" />

    <script>
        window.UML_VIEWER_MODE = true;
        window.UML_EMBED = @json($embed);
    </script>
    @vite(['resources/css/app.css', 'resources/js/app.js'])

    <style>
        :root {
            --v-bg: #fafafa;
            --v-surface: rgba(255, 255, 255, 0.92);
            --v-border: #e4e4e7;
            --v-text: #18181b;
            --v-muted: #71717a;
            --v-accent: #4f46e5;
            --v-live: #10b981;
            --v-shadow: 0 1px 2px rgba(24, 24, 27, 0.04), 0 8px 24px -8px rgba(24, 24, 27, 0.12);
        }
        html, body { height: 100%; margin: 0; background: var(--v-bg); color: var(--v-text); overscroll-behavior: none; }
        body { font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent; }

        .viewer { position: fixed; inset: 0; display: flex; flex-direction: column; }
        .viewer-bar {
            display: flex; align-items: center; gap: 14px;
            height: 56px; padding: 0 16px; flex-shrink: 0;
            background: #fff; border-bottom: 1px solid var(--v-border);
        }
        .viewer-back {
            display: inline-flex; align-items: center; justify-content: center;
            width: 34px; height: 34px; border-radius: 10px; color: var(--v-muted);
            transition: background .15s, color .15s;
        }
        .viewer-back:hover { background: #f4f4f5; color: var(--v-text); }
        .viewer-title { min-width: 0; flex: 1; }
        .viewer-title h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .viewer-title p { margin: 1px 0 0; font-size: 12px; color: var(--v-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .viewer-chip {
            display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px;
            border-radius: 999px; font-size: 12px; font-weight: 500; color: var(--v-muted);
            background: #f4f4f5; white-space: nowrap;
        }
        .viewer-edit {
            display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px;
            border-radius: 10px; font-size: 13px; font-weight: 600; color: #fff;
            background: var(--v-text); text-decoration: none; transition: opacity .15s;
        }
        .viewer-edit:hover { opacity: .88; }

        .viewer-stage { position: relative; flex: 1; min-height: 0; }
        /* overflow: durante el gesto táctil el SVG se mueve con CSS y no debe salirse del lienzo. */
        #paper-container { position: absolute; inset: 0; background-color: var(--v-bg); overflow: hidden; }

        .live-dot { width: 7px; height: 7px; border-radius: 50%; background: #a1a1aa; flex-shrink: 0; }
        .live-dot.is-live { background: var(--v-live); box-shadow: 0 0 0 0 rgba(16, 185, 129, .5); animation: pulse 2s infinite; }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,.45);} 70% { box-shadow: 0 0 0 7px rgba(16,185,129,0);} 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0);} }

        .floating {
            position: absolute; z-index: 10; display: flex; align-items: center; gap: 2px;
            padding: 4px; border-radius: 14px; background: var(--v-surface);
            border: 1px solid var(--v-border); box-shadow: var(--v-shadow);
            backdrop-filter: saturate(180%) blur(12px); -webkit-backdrop-filter: saturate(180%) blur(12px);
        }
        .floating-zoom { right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); }
        .floating-zoom button {
            display: inline-flex; align-items: center; justify-content: center;
            width: 38px; height: 38px; border: 0; border-radius: 10px; background: transparent;
            color: #3f3f46; cursor: pointer; transition: background .15s;
        }
        .floating-zoom button:hover, .floating-zoom button:active { background: #f4f4f5; }
        .floating-zoom .divider { width: 1px; height: 20px; background: var(--v-border); margin: 0 2px; }
        .floating-info { left: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); padding: 8px 12px; gap: 8px; font-size: 12px; color: var(--v-muted); }
        #canvas-info { font-variant-numeric: tabular-nums; }

        /* Presencia (DiagramCollaborationManager pinta #collaborators-list) */
        #collaborators-bar { display: flex; align-items: center; }
        #collaborators-list { display: flex; align-items: center; }
        #collaborators-divider { display: none !important; }

        /* Embebido en la app: sin barra, controles más grandes para el dedo */
        .is-embed .viewer-bar { display: none; }
        /* La app tiene "Encuadrar" en su barra y el zoom es con pellizco. */
        .is-embed .floating-zoom, .is-embed .floating-info { display: none; }

        /* El lienzo no se edita: sin cursores de arrastre de elementos */
        .viewer .joint-element, .viewer .joint-link { cursor: default !important; }

        /* Avisos de conexión del editor: discretos y arriba al centro */
        #connection-status { display: none !important; }

        @media (max-width: 640px) {
            .viewer-bar { padding: 0 10px; gap: 10px; }
            .viewer-chip.hide-sm, .viewer-edit span { display: none; }
        }
    </style>
</head>
<body>
<div class="viewer {{ $embed ? 'is-embed' : '' }}">
    <header class="viewer-bar">
        <a href="{{ route('diagrams.index') }}" class="viewer-back" title="Mis diagramas" aria-label="Volver a mis diagramas">
            <x-icon name="arrow-left" :size="18" />
        </a>
        <div class="viewer-title">
            <h1>{{ $diagram->title }}</h1>
            <p>{{ $diagram->user->name ?? '' }} · actualizado {{ $diagram->last_saved_at?->diffForHumans() ?? 'recién' }}</p>
        </div>
        <div id="collaborators-bar" style="display:none;"><div id="collaborators-list"></div></div>
        <div id="collaborators-divider"></div>
        <span class="viewer-chip" id="live-chip">
            <span class="live-dot {{ $sessionId ? 'is-live' : '' }}"></span>
            <span id="live-text">{{ $sessionId ? 'En vivo' : 'Al guardar' }}</span>
        </span>
        <span class="viewer-chip hide-sm"><x-icon name="eye" :size="13" /> Solo lectura</span>
        @if($canEdit)
            <a href="{{ route('diagrams.editor', $diagram->slug) }}" class="viewer-edit">
                <x-icon name="pencil" :size="14" /><span>Editar</span>
            </a>
        @endif
    </header>

    <main class="viewer-stage">
        <div id="paper-container"></div>

        <div id="connection-status"><span id="connection-status-dot"></span><span id="connection-status-text"></span></div>
        <div id="lock-conflict-popup" style="display:none;"><span id="lock-conflict-text"></span></div>

        <div class="floating floating-info">
            <span class="live-dot {{ $sessionId ? 'is-live' : '' }}"></span>
            <span id="canvas-info">Cargando…</span>
        </div>

        <div class="floating floating-zoom">
            <button id="zoom-out" type="button" aria-label="Alejar"><x-icon name="zoom-out" :size="18" /></button>
            <button id="zoom-in" type="button" aria-label="Acercar"><x-icon name="zoom-in" :size="18" /></button>
            <span class="divider"></span>
            <button id="zoom-fit" type="button" aria-label="Encuadrar"><x-icon name="frame" :size="18" /></button>
        </div>
    </main>

    {{-- El motor del editor crea estos paneles; en esta vista no se muestran. --}}
    <div id="properties-right-panel" hidden><div id="properties-right-content"></div></div>
    <div id="properties-bottom-panel" hidden><div id="properties-bottom-content"></div></div>
</div>

<script>
    window.diagramData = @json(json_encode($diagram->data ?? ['cells' => []]));
    window.diagramId = @json($diagram->id);
    window.diagramTitle = @json($diagram->title);
    window.authUser = @json(auth()->user()?->only(['id', 'name']));
    window.diagramSessionId = @json($sessionId);
    window.collaboratorRole = 'viewer';
    window.isDiagramOwner = false;

    // Puente con la app móvil (JavaScriptChannel "UmlApp" del WebView).
    (function () {
        const post = (type, extra = {}) => {
            try { window.UmlApp?.postMessage(JSON.stringify({ type, ...extra })); } catch (e) {}
        };
        const report = () => {
            const editor = window.umlEditor;
            if (!editor) return;
            post('state', {
                classes: editor.graph.getElements().length,
                relations: editor.graph.getLinks().length,
                live: !!window.diagramSessionId,
            });
        };
        document.addEventListener('uml-viewer:reloaded', () => { report(); post('updated'); });
        window.addEventListener('load', () => setTimeout(() => { report(); post('ready'); }, 700));
        // Para que la app pueda pedir "encuadrar" desde su propia barra.
        window.umlViewerFit = () => window.umlEditor?.zoomManager.zoomToFit();
    })();
</script>
</body>
</html>
