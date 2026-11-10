// Deshacer por usuario: solo se revierte lo propio. Correr con: npm run test:js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeUmlData, mergeRelationData, mergeValue, toRows, fromRows } from '../../resources/js/diagram/undo/undoMerge.js';

const materia = (className, attributes, uml25 = null) => ({ className, type: 'class', attributes, methods: [], uml25 });

test('deshacer el renombre conserva el atributo que agregó otro usuario', () => {
    const before = materia('Materia', ['+ id: int', '+ nombre: String']);
    const afterA = materia('Materias', ['+ id: int', '+ nombre: String']);
    const current = materia('Materias', ['+ id: int', '+ nombre: String', '+ grado: int']); // B agregó "grado"

    // Deshacer = aplicar el cambio de A al revés (after → before) sobre lo actual.
    const { value, changed, conflicts } = mergeUmlData(current, afterA, before);

    assert.equal(changed, true);
    assert.deepEqual(conflicts, []);
    assert.equal(value.className, 'Materia');
    assert.deepEqual(value.attributes, ['+ id: int', '+ nombre: String', '+ grado: int']);
});

test('si otro usuario volvió a cambiar el mismo campo, no se pisa y se avisa', () => {
    const before = materia('Materia', ['+ id: int']);
    const afterA = materia('Materias', ['+ id: int']);
    const current = materia('Asignatura', ['+ id: int']); // B lo renombró después

    const { value, changed, conflicts } = mergeUmlData(current, afterA, before);

    assert.equal(changed, false);
    assert.equal(value.className, 'Asignatura');
    assert.deepEqual(conflicts, ['el nombre']);
});

test('deshacer un atributo agregado lo quita sin tocar los demás', () => {
    const before = materia('Materia', ['+ id: int']);
    const afterA = materia('Materia', ['+ id: int', '+ codigo: String']);
    const current = materia('Materia', ['+ id: int', '+ codigo: String', '+ grado: int']);

    const { value } = mergeUmlData(current, afterA, before);
    assert.deepEqual(value.attributes, ['+ id: int', '+ grado: int']);
});

test('deshacer un atributo borrado lo vuelve a poner en su lugar', () => {
    const before = materia('Materia', ['+ id: int', '+ nombre: String', '+ cupo: int']);
    const afterA = materia('Materia', ['+ id: int', '+ cupo: int']);
    const current = materia('Materia', ['+ id: int', '+ cupo: int', '+ grado: int']);

    const { value } = mergeUmlData(current, afterA, before);
    assert.deepEqual(value.attributes, ['+ id: int', '+ nombre: String', '+ cupo: int', '+ grado: int']);
});

test('dentro de un mismo atributo, solo se revierte la parte propia', () => {
    const before = materia('Materia', ['+ nombre: String']);
    const afterA = materia('Materia', ['+ nombre: Text']); // A cambió el tipo
    const current = materia('Materia', ['- nombre: Text']); // B cambió la visibilidad

    const { value, conflicts } = mergeUmlData(current, afterA, before);
    assert.deepEqual(conflicts, []);
    assert.deepEqual(value.attributes, ['- nombre: String']);
});

test('un atributo que otro usuario editó no se borra al deshacer su creación', () => {
    const before = materia('Materia', []);
    const afterA = materia('Materia', ['+ codigo: String']);
    const current = materia('Materia', ['+ codigo: int']);

    const { value, conflicts } = mergeUmlData(current, afterA, before);
    assert.deepEqual(value.attributes, ['+ codigo: int']);
    assert.equal(conflicts.length, 1);
});

test('las marcas por índice siguen a su fila al insertar o quitar', () => {
    // "grado" es estático (índice 2); A había borrado "nombre" (índice 1).
    const before = materia('M', ['+ id: int', '+ nombre: String', '+ cupo: int'], { staticAttributes: [2], attributeConstraints: ['', '', '{cupo > 0}'] });
    const afterA = materia('M', ['+ id: int', '+ cupo: int'], { staticAttributes: [1], attributeConstraints: ['', '{cupo > 0}'] });
    const current = afterA;

    const { value } = mergeUmlData(current, afterA, before);
    assert.deepEqual(value.attributes, ['+ id: int', '+ nombre: String', '+ cupo: int']);
    assert.deepEqual(value.uml25.staticAttributes, [2]);
    assert.equal(value.uml25.attributeConstraints[2], '{cupo > 0}');
});

test('rehacer es aplicar el mismo cambio hacia adelante', () => {
    const before = materia('Materia', ['+ id: int']);
    const afterA = materia('Materias', ['+ id: int']);
    const current = materia('Materia', ['+ id: int', '+ grado: int']);

    const { value } = mergeUmlData(current, before, afterA);
    assert.equal(value.className, 'Materias');
    assert.deepEqual(value.attributes, ['+ id: int', '+ grado: int']);
});

test('filas y marcas ida y vuelta sin pérdida', () => {
    const uml = materia('M', ['+ a: int', '+ b: int'], { derivedAttributes: [1], staticAttributes: [], attributeConstraints: ['x', ''] });
    const back = fromRows(toRows(uml, 'attributes'), 'attributes');
    assert.deepEqual(back.lines, uml.attributes);
    assert.deepEqual(back.flags.derivedAttributes, [1]);
    assert.deepEqual(back.constraints, ['x', '']);
});

test('relaciones: se revierte la multiplicidad propia y se conserva el nombre ajeno', () => {
    const before = { type: 'association', sourceMultiplicity: '1', targetMultiplicity: '*', name: '' };
    const afterA = { ...before, targetMultiplicity: '1..*' };
    const current = { ...afterA, name: 'inscribe' };

    const { value, conflicts } = mergeRelationData(current, afterA, before);
    assert.deepEqual(conflicts, []);
    assert.equal(value.targetMultiplicity, '*');
    assert.equal(value.name, 'inscribe');
});

test('valores vacíos equivalentes no cuentan como conflicto', () => {
    assert.deepEqual(mergeValue(null, undefined, 'x'), { value: 'x', changed: true, conflict: false });
    assert.equal(mergeValue('', null, 'x').conflict, false);
});
