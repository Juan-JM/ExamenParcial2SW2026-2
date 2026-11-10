// vite.config.js - Asegurar JointJS
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.js'],
            refresh: true,
            // El entorno de prueba (tests/e2e/server.mjs) compila aparte, para no
            // mezclarse con el servidor de desarrollo.
            buildDirectory: process.env.VITE_BUILD_DIRECTORY || 'build',
        }),
    ],
    // Escucha en todas las interfaces para que el celular (app móvil con el
    // lienzo embebido, o el navegador por Wi-Fi) cargue los scripts de
    // desarrollo. CORS solo para la propia laptop y redes privadas.
    server: {
        host: true,
        cors: {
            origin: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/,
        },
    },
    define: {
        global: 'globalThis',
    },
    optimizeDeps: {
        include: ['jointjs', 'lodash', 'backbone', 'jquery']
    }
});
