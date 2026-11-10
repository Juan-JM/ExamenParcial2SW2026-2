<?php

return [
    'default' => env('BROADCAST_CONNECTION', 'pusher'),

    'connections' => [
        'reverb' => [
            'driver' => 'reverb',
            'key' => env('REVERB_APP_KEY'),
            'secret' => env('REVERB_APP_SECRET'),
            'app_id' => env('REVERB_APP_ID'),
            'options' => [
                'host' => env('REVERB_HOST'),
                'port' => env('REVERB_PORT', 443),
                'scheme' => env('REVERB_SCHEME', 'https'),
                'useTLS' => env('REVERB_SCHEME', 'https') === 'https',
            ],
            // Reverb corre en esta misma máquina: si no conecta en medio segundo
            // está caído. Sin este límite, Windows tarda unos 2 s en rendirse por
            // cada aviso, y `artisan serve` (que atiende de a una petición) se
            // frenaba para todos.
            'client_options' => [
                'connect_timeout' => 0.5,
                'timeout' => 3,
            ],
        ],

        'pusher' => [
            'driver' => 'pusher',
            'key' => env('PUSHER_APP_KEY'),
            'secret' => env('PUSHER_APP_SECRET'),
            'app_id' => env('PUSHER_APP_ID'),
            'options' => [
                'cluster' => env('PUSHER_APP_CLUSTER'),
                'useTLS' => false, // Para desarrollo local
                'encrypted' => false,
            ],
        ],

        'log' => [
            'driver' => 'log',
        ],

        'null' => [
            'driver' => 'null',
        ],
    ],
];
