// Pruebas de la lógica sin navegador. Correr con: npm run test:js
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNormalization } from '../../resources/js/diagram/utils/schemaNormalizationChecker.js';
import { extractCommand, normalizeSpeech, splitForSpeech, pickDefaultVoice } from '../../resources/js/diagram/modules-ai/ai-chat/VoiceAssistant.js';

const WAKE = ['nova', 'jarvis', 'yarvis', 'harvis'];

test('la palabra de activación extrae el pedido', () => {
    assert.equal(extractCommand('Nova agrega la clase Pago', WAKE), 'agrega la clase Pago');
    assert.equal(extractCommand('ok nova, qué avanzaron hoy', WAKE), 'qué avanzaron hoy');
    assert.equal(extractCommand('oye Jarvis revisa el diagrama', WAKE), 'revisa el diagrama');
    assert.equal(extractCommand('Yarvis resumen', WAKE), 'resumen');
});

test('solo el nombre abre la ventana para el pedido', () => {
    assert.equal(extractCommand('Nova', WAKE), '');
    assert.equal(extractCommand('ok nova.', WAKE), '');
});

test('la conversación normal no activa al asistente', () => {
    assert.equal(extractCommand('la clase novedad está bien', WAKE), null);
    assert.equal(extractCommand('eso es una innovación', WAKE), null);
    assert.equal(extractCommand('terminemos el diagrama', WAKE), null);
    assert.equal(extractCommand('', WAKE), null);
});

test('los acentos no impiden reconocer el nombre', () => {
    assert.equal(normalizeSpeech('NOVÁ'), 'nova');
    assert.notEqual(extractCommand('Nová crea Pago', WAKE), null);
});

test('un modelo sano no tiene observaciones', () => {
    const issues = checkNormalization([
        { className: 'Cliente', attributes: ['+ id: int', '+ nombre: String', '+ telefono: String'] },
        { className: 'Pedido', attributes: ['+ id: int', '+ fecha: Date', '+ clienteId: int'] },
    ]);
    assert.deepEqual(issues, []);
});

test('1FN: grupos repetitivos y valores múltiples', () => {
    const issues = checkNormalization([{
        className: 'Cliente',
        attributes: ['+ telefono1: String', '+ telefono2: String', '+ correos: List<String>', '+ foto: byte[]', '+ direccion1: String'],
    }]);

    assert.equal(issues.length, 2);
    assert.ok(issues.every((issue) => issue.form === '1FN'));
    assert.match(issues[0].attribute, /telefono1, telefono2/);
    assert.equal(issues[1].attribute, 'correos');
});

test('3FN: dato de otra clase y atributo derivado', () => {
    const issues = checkNormalization([
        { className: 'Cliente', attributes: ['+ nombre: String'] },
        { className: 'Pedido', attributes: ['+ nombreCliente: String', '+ clienteTelefono: String', '+ /total: double', '+ subtotal: double'], derivedAttributes: [3] },
    ]);

    const byAttribute = Object.fromEntries(issues.map((issue) => [issue.attribute, issue.form]));
    assert.deepEqual(byAttribute, { nombreCliente: '3FN', clienteTelefono: '3FN', total: '3FN', subtotal: '3FN' });
});

test('2FN: en una clase asociativa, dato de una sola de sus partes', () => {
    const issues = checkNormalization(
        [
            { className: 'Pedido', attributes: [] },
            { className: 'Producto', attributes: [] },
            { className: 'Detalle', attributes: ['+ cantidad: int', '+ productoPrecio: double'] },
        ],
        [{ associationClass: 'Detalle', sourceClass: 'Pedido', targetClass: 'Producto' }],
    );

    assert.equal(issues.length, 1);
    assert.equal(issues[0].form, '2FN');
    assert.equal(issues[0].attribute, 'productoPrecio');
});

test('el nombre de la propia clase o una referencia no son incumplimientos', () => {
    assert.deepEqual(checkNormalization([
        { className: 'Cliente', attributes: ['+ clienteNombre: String'] },
        { className: 'Pedido', attributes: ['+ cliente_id: int', '+ cliente: String'] },
    ]), []);
});

test('una respuesta larga se lee completa, por partes', () => {
    const long = 'Primera frase. ' + 'palabra '.repeat(80) + 'final. ¿Y una pregunta?';
    const chunks = splitForSpeech(long, 180);

    assert.ok(chunks.length >= 3);
    assert.ok(chunks.every((chunk) => chunk.length <= 180));
    assert.equal(chunks.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' ').trim());
});

test('la voz por defecto prefiere natural y masculina en español', () => {
    const voices = [
        { name: 'Microsoft Helena - Spanish (Spain)', lang: 'es-ES' },
        { name: 'Google español', lang: 'es-ES' },
        { name: 'Microsoft Alvaro Online (Natural) - Spanish (Spain)', lang: 'es-ES' },
        { name: 'Microsoft David - English', lang: 'en-US' },
    ];
    assert.match(pickDefaultVoice(voices).name, /Alvaro/);
    assert.equal(pickDefaultVoice([{ name: 'English', lang: 'en-US' }]), null);
});
