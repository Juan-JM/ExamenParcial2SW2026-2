// resources/js/diagram/DiagramPropertiesPanel.js
// Paneles de propiedades estilo Enterprise Architect: reemplazan el modal
// "Editar Clase" — panel derecho (información del elemento) + panel
// inferior (tabla de atributos/métodos con responsabilidades/restricciones
// a la derecha), ambos siempre presentes (colapsables) en vez de un diálogo
// que tapa el lienzo. Solo aplica a clases/interfaces: las relaciones
// siguen editándose con su modal de siempre.

import { DiagramElementFactory } from './DiagramElementFactory.js';
import { icon } from './utils/uiIcons.js';

const STEREOTYPE_OPTIONS = [
    ['', 'Sin estereotipo'],
    ['entity', '<<entity>> Entidad de dominio'],
    ['enumeration', '<<enumeration>> Enumeración'],
    ['datatype', '<<datatype>> Tipo de dato'],
    ['service', '<<service>> Servicio'],
    ['repository', '<<repository>> Repositorio'],
    ['controller', '<<controller>> Controlador'],
    ['utility', '<<utility>> Utilidad'],
];

const VISIBILITY_OPTIONS = ['+', '-', '#', '~'];

function escapeHtml(text) {
    return (text ?? '').toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export class DiagramPropertiesPanel {
    constructor(editor) {
        this.editor = editor;
        this.elementFactory = new DiagramElementFactory();
        this.currentElement = null;
        this._applyTimer = null;

        this.rightPanelEl = document.getElementById('properties-right-panel');
        this.rightContentEl = document.getElementById('properties-right-content');
        this.bottomPanelEl = document.getElementById('properties-bottom-panel');
        this.bottomContentEl = document.getElementById('properties-bottom-content');

        this.bindToggles();
        this.bindDelegatedEvents();
    }

    bindToggles() {
        document.getElementById('right-panel-toggle')?.addEventListener('click', () => {
            this.rightPanelEl.classList.toggle('is-collapsed');
        });
        document.getElementById('bottom-panel-toggle')?.addEventListener('click', () => {
            this.bottomPanelEl.classList.toggle('is-collapsed');
        });
    }

    expandPanels() {
        this.rightPanelEl.classList.remove('is-collapsed');
        this.bottomPanelEl.classList.remove('is-collapsed');
    }

    // ==================== MOSTRAR / LIMPIAR ====================

    /**
     * El lock de edición ya lo pidió (o no) el editor al seleccionar el
     * elemento (ver selectElement()/_lockedSelectionId en editor.js) — acá
     * solo pintamos, usando isReadOnly() para saber si ese lock es nuestro.
     * Por eso este método nunca se llama si el elemento está bloqueado por
     * otro colaborador: onElementDoubleClick corta antes de llegar acá.
     */
    show(element) {
        if (this.currentElement && this.currentElement.id !== element.id) {
            clearTimeout(this._applyTimer);
            this.applyChanges();
        }

        this.currentElement = element;
        this.expandPanels();
        this.renderRightPanel();
        this.renderBottomPanel();
    }

    clear() {
        clearTimeout(this._applyTimer);

        if (this.currentElement) {
            this.applyChanges();
        }

        this.discard();
    }

    /**
     * Igual que clear(), pero SIN intentar aplicar cambios pendientes —
     * para cuando el elemento ya fue borrado del grafo (por el atajo Supr o
     * el botón eliminar) y ya no existe nada sobre lo que aplicar.
     */
    discard() {
        clearTimeout(this._applyTimer);
        this.currentElement = null;

        this.rightContentEl.innerHTML = '<div class="properties-panel-empty">Doble clic en un elemento del diagrama para ver su información.</div>';
        this.bottomContentEl.innerHTML = '<div class="properties-panel-empty">Doble clic en una clase o interfaz para ver sus atributos y métodos.</div>';

        // Sin nada seleccionado, los paneles vuelven a ocultarse solos — el
        // botón de flecha sigue disponible para abrirlos igual sin
        // seleccionar nada, pero no tiene sentido que ocupen pantalla vacíos.
        this.rightPanelEl.classList.add('is-collapsed');
        this.bottomPanelEl.classList.add('is-collapsed');
    }

    isReadOnly() {
        if (this.editor.readOnlyCollaborator) return true;
        return this.editor._lockedSelectionId !== this.currentElement?.id;
    }

    // ==================== PANEL DERECHO: INFORMACIÓN DEL ELEMENTO ====================

    renderRightPanel() {
        const element = this.currentElement;
        const umlData = element.get('umlData') || {};
        const type = umlData.type || 'class';
        const uml25 = this.elementFactory.getUML25Config(umlData);
        const readOnly = this.isReadOnly() ? 'disabled' : '';

        const stereotypeOptions = STEREOTYPE_OPTIONS.map(([value, label]) =>
            `<option value="${value}" ${uml25.stereotype === value ? 'selected' : ''}>${label}</option>`
        ).join('');

        this.rightContentEl.innerHTML = `
            <div class="properties-panel-header">
                ${icon(type === 'interface' ? 'interface' : 'class', { size: 16 })}
                <span class="properties-panel-title">${type === 'interface' ? 'Interfaz' : 'Clase'}</span>
                <button type="button" id="prop-delete-btn" class="icon-btn" style="margin-left:auto" title="Eliminar" ${readOnly}>
                    ${icon('trash', { size: 14 })}
                </button>
            </div>
            <div class="properties-panel-body">
                <div class="form-group">
                    <label class="form-label">Nombre</label>
                    <input type="text" id="prop-name" class="form-input" value="${escapeHtml(umlData.className)}" ${readOnly}>
                </div>

                <div class="form-group">
                    <label class="form-label">Estereotipo</label>
                    <select id="prop-stereotype" class="form-select" ${readOnly}>${stereotypeOptions}</select>
                </div>

                ${type === 'class' ? `
                    <div class="form-group">
                        <label class="form-checkbox-row">
                            <input type="checkbox" id="prop-abstract" ${uml25.isAbstract ? 'checked' : ''} ${readOnly}>
                            Clase abstracta <span class="form-label-hint">(nombre en cursiva)</span>
                        </label>
                    </div>
                ` : ''}

                <div class="form-group">
                    <label class="form-checkbox-row">
                        <input type="checkbox" id="prop-show-types" ${uml25.hideDataTypes ? '' : 'checked'} ${readOnly}>
                        Tipo de datos visible
                    </label>
                </div>

                <div class="form-group">
                    <label class="form-label">Responsabilidades <span class="form-label-hint">(una por línea)</span></label>
                    <textarea id="prop-responsibilities" class="form-textarea" rows="6" placeholder="Calcular el total de la compra&#10;Notificar cuando cambia el stock" ${readOnly}>${escapeHtml((uml25.responsibilities || []).join('\n'))}</textarea>
                </div>
            </div>
        `;

        document.getElementById('prop-delete-btn')?.addEventListener('click', () => this.deleteCurrentElement());
    }

    // ==================== PANEL INFERIOR: ATRIBUTOS / MÉTODOS ====================

    renderBottomPanel() {
        const element = this.currentElement;
        const umlData = element.get('umlData') || {};
        const type = umlData.type || 'class';
        const uml25 = this.elementFactory.getUML25Config(umlData);
        const readOnly = this.isReadOnly();

        // Clases e interfaces se editan igual acá (atributos y métodos, con
        // las mismas casillas) — quien decide si tiene sentido usar
        // atributos en una interfaz es quien diagrama, no el panel.
        if (!this.activeTab) this.activeTab = 'attributes';
        const effectiveTab = this.activeTab;

        const tabs = `
            <div class="properties-bottom-tabs">
                <button type="button" class="properties-bottom-tab ${effectiveTab === 'attributes' ? 'is-active' : ''}" data-tab="attributes">Atributos</button>
                <button type="button" class="properties-bottom-tab ${effectiveTab === 'methods' ? 'is-active' : ''}" data-tab="methods">Métodos</button>
            </div>
        `;

        const attributesView = effectiveTab === 'attributes' ? `
            <div class="properties-table-wrap">
                <table class="properties-table">
                    <thead>
                        <tr><th></th><th>Nombre</th><th>Tipo</th><th>Restricción</th><th>Derivado</th><th>Estático</th><th></th></tr>
                    </thead>
                    <tbody id="prop-attrs-body">
                        ${(umlData.attributes || []).map((line, i) => this.buildAttributeRow(line, i, uml25, readOnly)).join('')}
                    </tbody>
                </table>
                ${readOnly ? '' : `<button type="button" class="properties-table-add-row-full" data-add-attr>${icon('plus', { size: 12 })} Agregar atributo</button>`}
            </div>
        ` : '';

        const methodsView = effectiveTab === 'methods' ? `
            <div class="properties-table-wrap">
                <table class="properties-table">
                    <thead>
                        <tr><th></th><th>Nombre</th><th>Tipo retorno</th><th>Restricción</th><th>Abstracto</th><th>Estático</th><th></th></tr>
                    </thead>
                    <tbody id="prop-methods-body">
                        ${(umlData.methods || []).map((line, i) => this.buildMethodRow(line, i, uml25, readOnly)).join('')}
                    </tbody>
                </table>
                ${readOnly ? '' : `<button type="button" class="properties-table-add-row-full" data-add-method>${icon('plus', { size: 12 })} Agregar método</button>`}
            </div>
        ` : '';

        this.bottomContentEl.innerHTML = `
            <div class="properties-table-section">
                ${tabs}
                ${attributesView}${methodsView}
            </div>
        `;
    }

    visibilitySelect(current, cls, readOnly) {
        const opts = VISIBILITY_OPTIONS.map(v => `<option value="${v}" ${v === current ? 'selected' : ''}>${v}</option>`).join('');
        return `<select class="${cls}" ${readOnly ? 'disabled' : ''}>${opts}</select>`;
    }

    typeOptionsHtml(currentType) {
        const types = this.elementFactory.umlTemplates.commonTypes;
        const isCustom = !!currentType && !types.includes(currentType);
        const html = types.map(t => `<option value="${t}" ${t === currentType ? 'selected' : ''}>${t}</option>`).join('')
            + `<option value="__custom__" ${isCustom ? 'selected' : ''}>Personalizado…</option>`;
        return { html, isCustom };
    }

    buildAttributeRow(line, index, uml25, readOnly) {
        const { visibility, name, type } = this.elementFactory.parseAttributeLine(line);
        const { html: typeOptions, isCustom } = this.typeOptionsHtml(type);
        const isDerived = uml25.derivedAttributes.includes(index);
        const isStatic = uml25.staticAttributes.includes(index);
        const constraint = uml25.attributeConstraints[index] || '';
        const dis = readOnly ? 'disabled' : '';

        return `
            <tr data-index="${index}">
                <td>${this.visibilitySelect(visibility, 'prop-attr-visibility', readOnly)}</td>
                <td><input type="text" class="prop-attr-name" value="${escapeHtml(name)}" placeholder="atributo" ${dis}></td>
                <td>
                    <select class="prop-attr-type" ${dis}>${typeOptions}</select>
                    <input type="text" class="prop-attr-type-custom" placeholder="Tipo…" value="${isCustom ? escapeHtml(type) : ''}" style="${isCustom ? '' : 'display:none'}" ${dis}>
                </td>
                <td><input type="text" class="prop-attr-constraint" value="${escapeHtml(constraint)}" placeholder="ej: unique" ${dis}></td>
                <td style="text-align:center"><input type="checkbox" class="prop-attr-derived" ${isDerived ? 'checked' : ''} title="Atributo derivado" ${dis}></td>
                <td style="text-align:center"><input type="checkbox" class="prop-attr-static" ${isStatic ? 'checked' : ''} title="Atributo estático" ${dis}></td>
                <td>${readOnly ? '' : `<button type="button" class="properties-table-remove-btn" data-remove-attr title="Quitar">${icon('close', { size: 12 })}</button>`}</td>
            </tr>
        `;
    }

    buildMethodRow(line, index, uml25, readOnly) {
        const { visibility, signature, returnType } = this.elementFactory.parseMethodLine(line);
        const { html: typeOptions, isCustom } = this.typeOptionsHtml(returnType === 'void' ? '' : returnType);
        const isAbstract = uml25.abstractMethods.includes(index);
        const isStatic = uml25.staticMethods.includes(index);
        const constraint = uml25.methodConstraints[index] || '';
        const dis = readOnly ? 'disabled' : '';

        return `
            <tr data-index="${index}">
                <td>${this.visibilitySelect(visibility, 'prop-method-visibility', readOnly)}</td>
                <td><input type="text" class="prop-method-name" value="${escapeHtml(signature)}" placeholder="metodo()" ${dis}></td>
                <td>
                    <select class="prop-method-type" ${dis}>
                        <option value="void" ${!returnType || returnType === 'void' ? 'selected' : ''}>void</option>
                        ${typeOptions}
                    </select>
                    <input type="text" class="prop-method-type-custom" placeholder="Tipo…" value="${isCustom ? escapeHtml(returnType) : ''}" style="${isCustom ? '' : 'display:none'}" ${dis}>
                </td>
                <td><input type="text" class="prop-method-constraint" value="${escapeHtml(constraint)}" placeholder="ej: readOnly" ${dis}></td>
                <td style="text-align:center"><input type="checkbox" class="prop-method-abstract" ${isAbstract ? 'checked' : ''} title="Método abstracto" ${dis}></td>
                <td style="text-align:center"><input type="checkbox" class="prop-method-static" ${isStatic ? 'checked' : ''} title="Método estático" ${dis}></td>
                <td>${readOnly ? '' : `<button type="button" class="properties-table-remove-btn" data-remove-method title="Quitar">${icon('close', { size: 12 })}</button>`}</td>
            </tr>
        `;
    }

    // ==================== EVENTOS (DELEGADOS) ====================

    bindDelegatedEvents() {
        const scheduleApply = () => {
            clearTimeout(this._applyTimer);
            this._applyTimer = setTimeout(() => this.applyChanges(), 250);
        };

        // Mostrar/ocultar el input de tipo personalizado según el <select>.
        const handleTypeSelectChange = (target) => {
            if (target.classList.contains('prop-attr-type')) {
                const custom = target.closest('td').querySelector('.prop-attr-type-custom');
                custom.style.display = target.value === '__custom__' ? '' : 'none';
            }
            if (target.classList.contains('prop-method-type')) {
                const custom = target.closest('td').querySelector('.prop-method-type-custom');
                custom.style.display = target.value === '__custom__' ? '' : 'none';
            }
        };

        [this.rightContentEl, this.bottomContentEl].forEach(container => {
            container.addEventListener('input', () => scheduleApply());
            container.addEventListener('change', (e) => {
                handleTypeSelectChange(e.target);
                scheduleApply();
            });
        });

        this.bottomContentEl.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) {
                clearTimeout(this._applyTimer);
                this.applyChanges();
                this.activeTab = tabBtn.dataset.tab;
                this.renderBottomPanel();
                return;
            }
            if (e.target.closest('[data-add-attr]')) this.addAttributeRow();
            if (e.target.closest('[data-add-method]')) this.addMethodRow();
            if (e.target.closest('[data-remove-attr]')) this.removeRow(e.target.closest('tr'), 'attribute');
            if (e.target.closest('[data-remove-method]')) this.removeRow(e.target.closest('tr'), 'method');
        });
    }

    addAttributeRow() {
        if (!this.currentElement) return;
        clearTimeout(this._applyTimer);
        this.applyChanges();

        const umlData = this.currentElement.get('umlData') || {};
        const attributes = [...(umlData.attributes || []), '- nuevoAtributo: String'];
        this.editor.classManager.updateClassElement(
            this.currentElement, umlData.className, attributes, umlData.methods,
            umlData.type, umlData.uml25 || null
        );
        this.renderBottomPanel();
    }

    addMethodRow() {
        if (!this.currentElement) return;
        clearTimeout(this._applyTimer);
        this.applyChanges();

        const umlData = this.currentElement.get('umlData') || {};
        const methods = [...(umlData.methods || []), '+ nuevoMetodo(): void'];
        this.editor.classManager.updateClassElement(
            this.currentElement, umlData.className, umlData.attributes, methods,
            umlData.type, umlData.uml25 || null
        );
        this.renderBottomPanel();
    }

    removeRow(rowEl, kind) {
        if (!this.currentElement || !rowEl) return;
        clearTimeout(this._applyTimer);
        this.applyChanges(); // no perder lo tipeado en las otras filas

        const umlData = this.currentElement.get('umlData') || {};
        const uml25 = this.elementFactory.getUML25Config(umlData);
        const index = parseInt(rowEl.dataset.index, 10);

        if (kind === 'attribute') {
            const attributes = (umlData.attributes || []).filter((_, i) => i !== index);
            const newUml25 = {
                ...uml25,
                derivedAttributes: this.reindexAfterRemoval(uml25.derivedAttributes, index),
                staticAttributes: this.reindexAfterRemoval(uml25.staticAttributes, index),
                attributeConstraints: (uml25.attributeConstraints || []).filter((_, i) => i !== index)
            };
            this.editor.classManager.updateClassElement(
                this.currentElement, umlData.className, attributes, umlData.methods,
                umlData.type, newUml25
            );
        } else {
            const methods = (umlData.methods || []).filter((_, i) => i !== index);
            const newUml25 = {
                ...uml25,
                abstractMethods: this.reindexAfterRemoval(uml25.abstractMethods, index),
                staticMethods: this.reindexAfterRemoval(uml25.staticMethods, index),
                methodConstraints: (uml25.methodConstraints || []).filter((_, i) => i !== index)
            };
            this.editor.classManager.updateClassElement(
                this.currentElement, umlData.className, umlData.attributes, methods,
                umlData.type, newUml25
            );
        }

        this.renderBottomPanel();
        this.broadcastCurrent();
    }

    /** Tras borrar la fila `removedIndex`, cada índice guardado en una lista de flags se corre uno hacia abajo. */
    reindexAfterRemoval(indices, removedIndex) {
        return (indices || [])
            .filter(i => i !== removedIndex)
            .map(i => i > removedIndex ? i - 1 : i);
    }

    deleteCurrentElement() {
        if (!this.currentElement) return;
        if (!confirm('¿Estás seguro de que quieres eliminar esta clase?')) return;

        const elementId = this.currentElement.id;
        this.currentElement.remove();
        this.editor.selectedElement = null;
        this.discard();
        this.editor.updateCanvasInfo();

        this.editor.webSocketManager?.broadcastDiagramUpdate({
            type: 'element_deleted',
            data: { elementId }
        });
    }

    // ==================== APLICAR CAMBIOS ====================

    collectAttributesFromTable() {
        const rows = this.bottomContentEl.querySelectorAll('#prop-attrs-body tr');
        const attributes = [];
        const derivedAttributes = [];
        const staticAttributes = [];
        const attributeConstraints = [];

        rows.forEach(row => {
            const name = row.querySelector('.prop-attr-name')?.value.trim();
            if (!name) return;

            const visibility = row.querySelector('.prop-attr-visibility').value;
            const typeSelect = row.querySelector('.prop-attr-type').value;
            const type = typeSelect === '__custom__' ? row.querySelector('.prop-attr-type-custom').value.trim() : typeSelect;

            attributes.push(this.elementFactory.serializeAttributeLine({ visibility, name, type }));
            const idx = attributes.length - 1;
            if (row.querySelector('.prop-attr-derived')?.checked) derivedAttributes.push(idx);
            if (row.querySelector('.prop-attr-static')?.checked) staticAttributes.push(idx);
            attributeConstraints[idx] = row.querySelector('.prop-attr-constraint')?.value.trim() || '';
        });

        return { attributes, derivedAttributes, staticAttributes, attributeConstraints };
    }

    collectMethodsFromTable() {
        const rows = this.bottomContentEl.querySelectorAll('#prop-methods-body tr');
        const methods = [];
        const abstractMethods = [];
        const staticMethods = [];
        const methodConstraints = [];

        rows.forEach(row => {
            const signature = row.querySelector('.prop-method-name')?.value.trim();
            if (!signature) return;

            const visibility = row.querySelector('.prop-method-visibility').value;
            const typeSelect = row.querySelector('.prop-method-type').value;
            const returnType = typeSelect === '__custom__' ? row.querySelector('.prop-method-type-custom').value.trim() : typeSelect;

            methods.push(this.elementFactory.serializeMethodLine({ visibility, signature, returnType }));
            const idx = methods.length - 1;
            if (row.querySelector('.prop-method-abstract')?.checked) abstractMethods.push(idx);
            if (row.querySelector('.prop-method-static')?.checked) staticMethods.push(idx);
            methodConstraints[idx] = row.querySelector('.prop-method-constraint')?.value.trim() || '';
        });

        return { methods, abstractMethods, staticMethods, methodConstraints };
    }

    applyChanges() {
        if (!this.currentElement || this.isReadOnly()) return;

        const umlData = this.currentElement.get('umlData') || {};
        const type = umlData.type || 'class';
        const existing = this.elementFactory.getUML25Config(umlData);

        const className = document.getElementById('prop-name')?.value.trim() || 'Sin nombre';
        const stereotype = document.getElementById('prop-stereotype')?.value || null;
        const isAbstract = type === 'class' ? !!document.getElementById('prop-abstract')?.checked : false;
        const hideDataTypes = !document.getElementById('prop-show-types')?.checked;
        const responsibilities = (document.getElementById('prop-responsibilities')?.value || '')
            .split('\n').map(l => l.trim()).filter(Boolean);

        // Solo la pestaña actualmente en pantalla está en el DOM — la otra
        // se preserva tal cual estaba, si no, aplicar cambios mientras se
        // mira "Métodos" borraría todos los atributos (y viceversa).
        let attributes = umlData.attributes || [];
        let derivedAttributes = existing.derivedAttributes;
        let staticAttributes = existing.staticAttributes;
        let attributeConstraints = existing.attributeConstraints;
        if (document.getElementById('prop-attrs-body')) {
            ({ attributes, derivedAttributes, staticAttributes, attributeConstraints } = this.collectAttributesFromTable());
        }

        let methods = umlData.methods || [];
        let abstractMethods = existing.abstractMethods;
        let staticMethods = existing.staticMethods;
        let methodConstraints = existing.methodConstraints;
        if (document.getElementById('prop-methods-body')) {
            ({ methods, abstractMethods, staticMethods, methodConstraints } = this.collectMethodsFromTable());
        }

        let uml25 = {
            stereotype, isAbstract, hideDataTypes,
            derivedAttributes, staticAttributes, attributeConstraints,
            abstractMethods, staticMethods, methodConstraints,
            responsibilities,
            constraints: existing.constraints, // ya no se edita (ver DiagramElementFactory), se preserva si un diagrama viejo la traía
            extendedVisibility: false, multiplicities: {}
        };

        const isEmpty = !uml25.stereotype && !uml25.isAbstract && !uml25.hideDataTypes &&
            uml25.derivedAttributes.length === 0 && uml25.staticAttributes.length === 0 &&
            uml25.abstractMethods.length === 0 && uml25.staticMethods.length === 0 &&
            uml25.responsibilities.length === 0 && uml25.constraints.length === 0 &&
            !uml25.attributeConstraints.some(Boolean) && !uml25.methodConstraints.some(Boolean);
        if (isEmpty) uml25 = null;

        this.editor.classManager.updateClassElement(this.currentElement, className, attributes, methods, type, uml25);
        this.broadcastCurrent();
    }

    broadcastCurrent() {
        if (!this.currentElement) return;
        this.editor.webSocketManager?.broadcastDiagramUpdate({
            type: 'class_updated',
            data: {
                elementId: this.currentElement.id,
                umlData: this.currentElement.get('umlData'),
                position: this.currentElement.position()
            }
        });
    }
}
