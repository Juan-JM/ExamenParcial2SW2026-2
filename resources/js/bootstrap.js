import axios from 'axios';
window.axios = axios;

window.axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

window.Pusher = Pusher;

// REVERB_HOST es 127.0.0.1 (ver documentacion/00-general.md), que solo sirve
// desde la propia laptop. Si la página se abrió por la red (celular por Wi-Fi,
// app móvil embebida), Reverb está en el mismo host que la página.
const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const reverbHost = loopback.includes(window.location.hostname)
    ? import.meta.env.VITE_REVERB_HOST
    : window.location.hostname;

window.Echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: reverbHost,
    wsPort: import.meta.env.VITE_REVERB_PORT ?? 80,
    wssPort: import.meta.env.VITE_REVERB_PORT ?? 443,
    forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'https') === 'https',
    enabledTransports: ['ws', 'wss'],
});

console.log('✅ Echo configurado correctamente');
