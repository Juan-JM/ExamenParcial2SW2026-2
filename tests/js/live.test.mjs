// "Nova en vivo": lógica de turnos (resources/js/diagram/modules-ai/live/turns.js).
import test from 'node:test';
import assert from 'node:assert/strict';

import { detectWake, looksIncomplete, shouldMerge, waitPhrase, reactionPhrase, forSpeech, normalize } from '../../resources/js/diagram/modules-ai/live/turns.js';

test('detectWake reconoce el nombre y limpia el saludo', () => {
    assert.deepEqual(detectWake('Oye Nova, ¿qué piensas de esta clase?'), { found: true, command: '¿qué piensas de esta clase?' });
    assert.equal(detectWake('qué opinas tú, Nova').found, true);
    assert.equal(detectWake('qué opinas tú, Nova').command, 'qué opinas tú');
    assert.equal(detectWake('hola nova quería preguntarte sobre la clase').command, 'quería preguntarte sobre la clase');
});

test('detectWake acepta cómo transcribe Whisper el nombre y no confunde palabras parecidas', () => {
    assert.equal(detectWake('oye noba dime algo').found, true);
    assert.equal(detectWake('hay que innovar en esto').found, false);
    assert.equal(detectWake('esa nota está mal').found, false);
    assert.equal(detectWake('una nueva clase').found, false);
});

test('detectWake con solo el nombre deja el pedido vacío', () => {
    assert.deepEqual(detectWake('Nova'), { found: true, command: '' });
});

test('detectWake respeta otras palabras de activación', () => {
    assert.equal(detectWake('hey jarvis revisa esto', ['nova', 'jarvis']).found, true);
});

test('looksIncomplete detecta frases a medias', () => {
    assert.equal(looksIncomplete('hola quería preguntarte sobre'), true);
    assert.equal(looksIncomplete('quería preguntarte sobre...'), true);
    assert.equal(looksIncomplete('y también la relación entre'), true);
    assert.equal(looksIncomplete('¿cómo estará el clima de hoy?'), false);
    assert.equal(looksIncomplete('dime cuántas clases hay'), false);
    assert.equal(looksIncomplete(''), false);
});

test('shouldMerge funde cuando Nova casi no habló o la frase quedó a medias', () => {
    assert.equal(shouldMerge({ prevText: 'hola quería preguntarte sobre', spokenMs: 800, gapMs: 3000 }), true);
    assert.equal(shouldMerge({ prevText: 'revisa la clase Pedido', spokenMs: 0, gapMs: 2000 }), true, 'Nova aún pensaba');
});

test('shouldMerge no funde si Nova ya explicó algo, hay cambios hechos o pasó mucho tiempo', () => {
    assert.equal(shouldMerge({ prevText: 'revisa la clase Pedido.', spokenMs: 6000, gapMs: 2000 }), false);
    assert.equal(shouldMerge({ prevText: 'crea la clase Pedido', spokenMs: 0, gapMs: 2000, opsApplied: true }), false);
    assert.equal(shouldMerge({ prevText: 'hola quería preguntarte sobre', spokenMs: 0, gapMs: 60000 }), false);
    assert.equal(shouldMerge({ prevText: '', spokenMs: 0, gapMs: 0 }), false);
});

test('waitPhrase nombra a ambos por su primer nombre', () => {
    const phrase = waitPhrase('Ana Torres', 'Carlos Pérez', () => 0);
    assert.match(phrase, /Ana/);
    assert.match(phrase, /Carlos/);
    assert.doesNotMatch(phrase, /Torres|Pérez/);
});

test('reactionPhrase cuenta el cambio de otra persona', () => {
    const phrase = reactionPhrase({ actorName: 'Pepito Gómez', summary: 'Creó la clase Pedido.' }, () => 0);
    assert.match(phrase, /Pepito/);
    assert.match(phrase, /creó la clase Pedido\./);
    assert.equal(reactionPhrase({ actorName: 'X', summary: '' }), null);
});

test('forSpeech quita markdown y símbolos', () => {
    assert.equal(forSpeech('**Hola** `código` # título\n\n```js\nx\n```fin'), 'Hola código título fin');
});

test('normalize quita acentos y signos', () => {
    assert.equal(normalize('¡Nová, qué tal!'), 'nova que tal');
});
