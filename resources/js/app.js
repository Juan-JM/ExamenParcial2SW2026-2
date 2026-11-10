// resources/js/app.js
import '../css/uml-editor.css';
import '../css/support-chat.css';
import './bootstrap';

// Solo importar el editor, SIN shapes personalizadas
import * as joint from 'jointjs';
import { UMLDiagramEditor } from './diagram/editor.js';
import { icon } from './diagram/utils/uiIcons.js';
import { initSupportChat } from './support/supportChat.js';

window.joint = joint;

// Inicialización cuando DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    // Widget de "Soporte" (chat de preguntas frecuentes + guía visual, sin
    // IA ni backend) — independiente del editor, corre en cualquier página
    // que tenga un botón con data-support-context (dashboard, editor).
    initSupportChat();

    var container = document.getElementById('paper-container');
    if (container) {
        try {
            var editor = new UMLDiagramEditor();

            // Hacer disponible globalmente
            window.DiagramEditor = {
                instance: editor,
                debug: function() {
                    return editor.getState();
                }
            };

            window.umlEditor = editor;
            window.diagramEditor = editor;

            // Función global para eliminar clases (necesaria para el botón X)
            window.deleteClass = function(elementId) {
                if (window.umlEditor && window.umlEditor.graph) {
                    const element = window.umlEditor.graph.getCell(elementId);
                    if (element) {
                        const classDiv = document.getElementById(`class-overlay-${elementId}`);
                        if (classDiv) {
                            classDiv.classList.add('removing');
                            setTimeout(() => {
                                element.remove();
                            }, 300);
                        } else {
                            element.remove();
                        }
                    }
                }
            };

            // Configurar toolbar DESPUÉS de que el editor esté listo
            setTimeout(function() {
                setupToolbar(editor);
            }, 500);

        } catch (error) {
            console.error('Error inicializando editor:', error);
        }
    }
});

// Herramientas del sidebar, agrupadas en tres bloques:
// - "select" es el modo por defecto (deshacer cualquier herramienta activa).
// - "shapes" (Clase/Interfaz) se pueden arrastrar-y-soltar directo al canvas
//   y se muestran como tarjetas cuadradas.
// - "relations" necesitan dos clics (origen y destino), así que se
//   seleccionan por clic únicamente y se listan en filas, como antes.
var SELECT_TOOL = { id: 'select', icon: 'cursor', label: 'Seleccionar' };

var SHAPE_TOOLS = [
    { id: 'class', icon: 'class', label: 'Clase' },
    { id: 'interface', icon: 'interface', label: 'Interfaz' },
];

var RELATION_TOOLS = [
    { id: 'association', icon: 'association', label: 'Asociación' },
    { id: 'inheritance', icon: 'inheritance', label: 'Herencia' },
    { id: 'aggregation', icon: 'aggregation', label: 'Agregación' },
    { id: 'composition', icon: 'composition', label: 'Composición' },
    { id: 'realization', icon: 'realization', label: 'Realización' },
    { id: 'dependency', icon: 'dependency', label: 'Dependencia' },
    { id: 'associationClassLink', icon: 'associationClassLink', label: 'Clase asociativa' },
];

function setupToolbar(editor) {
    var toolbarContainer = document.getElementById('js-toolbar');
    if (!toolbarContainer) {
        return;
    }

    var loadingMsg = document.getElementById('loading-toolbar');
    if (loadingMsg) {
        loadingMsg.style.display = 'none';
    }

    function isActive(toolId) {
        return editor.selectedTool === toolId ? ' active' : '';
    }

    var html = '<div class="uml-tools-panel">';

    html += '<div class="uml-tool-list">' +
        '<button type="button" class="uml-tool-btn tool-btn' + isActive(SELECT_TOOL.id) + '" data-tool="' + SELECT_TOOL.id + '">' +
        '<span class="uml-tool-icon">' + icon(SELECT_TOOL.icon) + '</span>' +
        '<span>' + SELECT_TOOL.label + '</span>' +
        '</button></div>';

    html += '<div class="menu-divider"></div>';
    html += '<div class="menu-section">Elementos</div>';
    html += '<div class="uml-shape-grid">';
    SHAPE_TOOLS.forEach(function(tool) {
        html += '<button type="button" class="uml-shape-btn' + isActive(tool.id) + '" data-tool="' + tool.id + '" draggable="true">' +
            '<span class="uml-tool-icon">' + icon(tool.icon, { size: 22 }) + '</span>' +
            '<span>' + tool.label + '</span>' +
            '</button>';
    });
    html += '</div>';

    html += '<div class="menu-divider"></div>';
    html += '<div class="menu-section">Relaciones</div>';
    html += '<div class="uml-tool-list">';
    RELATION_TOOLS.forEach(function(tool) {
        html += '<button type="button" class="uml-tool-btn tool-btn' + isActive(tool.id) + '" data-tool="' + tool.id + '">' +
            '<span class="uml-tool-icon">' + icon(tool.icon) + '</span>' +
            '<span>' + tool.label + '</span>' +
            '</button>';
    });
    html += '</div>';

    html += '</div>';

    toolbarContainer.innerHTML = html;

    toolbarContainer.querySelectorAll('.uml-tool-btn, .uml-shape-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            window.selectEditorTool(btn.getAttribute('data-tool'));
        });

        if (btn.getAttribute('draggable') === 'true') {
            btn.addEventListener('dragstart', function(e) {
                e.dataTransfer.setData('text/uml-tool', btn.getAttribute('data-tool'));
                e.dataTransfer.effectAllowed = 'copy';
                btn.classList.add('is-dragging');
            });
            btn.addEventListener('dragend', function() {
                btn.classList.remove('is-dragging');
            });
        }
    });
}

// Función global para seleccionar herramienta (usada por el toolbar y por
// el editor mismo cuando cambia de herramienta programáticamente).
window.selectEditorTool = function(tool) {
    if (window.DiagramEditor && window.DiagramEditor.instance) {
        window.DiagramEditor.instance.selectTool(tool);
    } else {
        console.error('Editor no disponible');
    }
};
