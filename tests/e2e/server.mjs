// Levanta la app para probarla de punta a punta, sin tocar los datos reales:
// base de datos propia (diagramador_e2e), sin claves de IA en la nube y con un
// modelo simulado, para que las pruebas no gasten cuota ni GPU.
//
//   node tests/e2e/server.mjs
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LLM_PORT = 11999;
// Puerto propio para no chocar con el Reverb de `composer run dev`.
const REVERB_PORT = 8081;
// Puerto de la app: E2E_PORT si 8765 está ocupado (p. ej. por voice-service).
const APP_PORT = process.env.E2E_PORT || '8765';

/** Copia el .env, reemplazando lo que no debe usarse en la prueba. */
function writeEnvironment() {
    const overrides = {
        APP_ENV: 'e2e',
        MONGODB_DATABASE: 'diagramador_e2e',
        GEMINI_API_KEY_1: '',
        GEMINI_API_KEY_2: '',
        GROK_API_KEY: '',
        OPENROUTER_API_KEY: '',
        FCM_CREDENTIALS: '',
        AI_LOCAL_ENABLED: 'true',
        // E2E_REAL_AI=1 usa el LM Studio real en vez del modelo simulado.
        LOCAL_LLM_BASE_URL: process.env.E2E_REAL_AI ? 'http://127.0.0.1:1234/v1' : `http://127.0.0.1:${LLM_PORT}/v1`,
        LOCAL_LLM_MODELS: process.env.E2E_REAL_AI ? 'qwen3.5-4b' : 'modelo-simulado',
        VECTOR_ENABLED: 'false',
        REVERB_PORT: String(REVERB_PORT),
        VITE_REVERB_PORT: String(REVERB_PORT),
    };

    const lines = readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/);
    const seen = new Set();
    const output = lines.map((line) => {
        const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
        if (!key || !(key in overrides)) return line;
        seen.add(key);
        return `${key}=${overrides[key]}`;
    });

    Object.keys(overrides).filter((key) => !seen.has(key)).forEach((key) => output.push(`${key}=${overrides[key]}`));
    writeFileSync(join(root, '.env.e2e'), output.join('\n'));
}

/** Responde de forma predecible según lo que se le pide. */
function fakeReply(prompt) {
    // Asistente de ayuda (Guía): un recorrido de dos pasos por el menú Exportar.
    if (prompt.includes('ELEMENTOS VISIBLES')) {
        if (/nuevo diagrama|diagrama nuevo/i.test(prompt.split('PREGUNTA:').pop())) {
            return {
                answer: 'Claro, los diagramas nuevos se crean desde Mis Diagramas.',
                steps: [
                    { say: 'Primero vuelve a Mis Diagramas con este enlace de arriba.', highlight: null, target: 'Mis Diagramas' },
                    { say: 'Ahora toca Nuevo Diagrama y se abre uno vacío.', highlight: null, target: 'Nuevo Diagrama' },
                ],
            };
        }
        return {
            answer: 'Claro, generar el SQL es rápido. Te muestro.',
            steps: [
                { say: 'Primero ve al menú Exportar, aquí arriba: ahí está todo lo que se puede generar.', highlight: null, target: 'Exportar' },
                { say: 'Ahora toca Generar SQL y se descarga el script de la base de datos.', highlight: null, target: 'Generar SQL' },
            ],
        };
    }

    const request = prompt.match(/MENSAJE ACTUAL de ([^:]+):\n"([\s\S]*?)"\n\nRespond/);
    const author = request?.[1] ?? 'alguien';
    const text = request?.[2] ?? '';
    const create = text.match(/crea la clase (\w+)/i);

    if (create) {
        return {
            type: 'ops',
            text: `${author}, agrego ${create[1]}.`,
            ops: [{ action: 'CREATE_CLASS', className: create[1], attributes: ['+ id: int', '+ nombre: String'] }],
        };
    }

    if (/borra la clase (\w+)/i.test(text)) {
        return { type: 'ops', ops: [{ action: 'DELETE_CLASS', className: text.match(/borra la clase (\w+)/i)[1] }] };
    }

    if (/qu[eé] (hizo|avanz)/i.test(text)) {
        const log = prompt.match(/REGISTRO DE ACTIVIDAD[^\n]*\n([\s\S]*?)\n\nESTADO ACTUAL/)?.[1] ?? '';
        return { type: 'message', text: `Registro:\n${log}` };
    }

    if (/elige/i.test(text)) {
        return {
            type: 'question',
            question: `${author}, ¿qué opción prefieres?`,
            options: [{ label: 'Opción uno', value: 'uno' }, { label: 'Opción dos', value: 'dos' }],
        };
    }

    return { type: 'message', text: `Hola ${author}, recibí: ${text}` };
}

createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
        const messages = JSON.parse(body || '{}').messages ?? [];
        const prompt = messages[messages.length - 1]?.content ?? '';
        const content = JSON.stringify(fakeReply(prompt));

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
}).listen(LLM_PORT, '127.0.0.1');

writeEnvironment();

const env = { ...process.env, APP_ENV: 'e2e' };
const artisan = (...args) => spawnSync('php', ['artisan', ...args], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });

artisan('config:clear');

// Compilación propia, conectada al Reverb de la prueba.
spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build'], {
    cwd: root,
    env: { ...process.env, VITE_BUILD_DIRECTORY: 'build-e2e', VITE_REVERB_PORT: String(REVERB_PORT) },
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
});
artisan('migrate:fresh', '--force');
artisan('db:seed', '--class=E2eSeeder', '--force');

const children = [
    ['serve', `--port=${APP_PORT}`],
    ['reverb:start', `--port=${REVERB_PORT}`],
    ['queue:listen', '--tries=1', '--timeout=240', '--sleep=1'],
].map((args) => spawn('php', ['artisan', ...args], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] }));

const stop = () => {
    children.forEach((child) => child.kill());
    process.exit(0);
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
