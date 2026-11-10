<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'resend' => [
        'key' => env('RESEND_KEY'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],
    // Notificaciones push. Ruta al JSON de la cuenta de servicio de Firebase; sin
    // este archivo la app móvil solo avisa mientras está abierta.
    'fcm' => [
        'credentials' => env('FCM_CREDENTIALS'),
    ],

    // Base de datos vectorial (Qdrant) para la búsqueda semántica: memoria del
    // equipo y guía de uso. Si no está corriendo, la app funciona sin ella.
    'vector' => [
        'enabled' => env('VECTOR_ENABLED', true),
        'url' => env('QDRANT_URL', 'http://127.0.0.1:6333'),
        'collection' => env('QDRANT_COLLECTION', 'diagramador'),
    ],

    'ai' => [
        // El asistente de IA del diagrama (ver documentacion/06-asistente-ia.md).
        // Solo usa el modelo local: los proveedores en la nube (Gemini, Grok,
        // OpenRouter) quedaron desactivados en app/Services/Ai/Disabled.
        'enabled' => env('AI_ASSISTANT_ENABLED', true),

        // Identidad de la IA en el equipo y palabras que la activan por voz.
        'agent' => [
            'name' => env('AI_AGENT_NAME', 'Nova'),
            'wake_words' => array_filter(explode(',', env('AI_AGENT_WAKE_WORDS', 'nova,jarvis,yarvis,harvis,yervis,charvis'))),
            'timezone' => env('AI_AGENT_TIMEZONE', 'America/La_Paz'),
            // Un modelo local tarda más que uno en la nube, y un turno corre
            // en la cola (sin el límite de 60 s de una petición web).
            'turn_budget_seconds' => env('AI_AGENT_TURN_BUDGET_SECONDS', 150),
        ],

        // Servidor local con API compatible con OpenAI. LM Studio por defecto;
        // para Ollama: http://127.0.0.1:11434/v1
        'local' => [
            'enabled' => env('AI_LOCAL_ENABLED', true),
            'base_url' => env('LOCAL_LLM_BASE_URL', 'http://127.0.0.1:1234/v1'),
            // Se prueban en orden: el segundo sirve de respaldo si el primero no carga.
            'models' => explode(',', env('LOCAL_LLM_MODELS', 'qwen/qwen3.5-9b')),
            'embedding_model' => env('LOCAL_EMBEDDING_MODEL', 'text-embedding-nomic-embed-text-v1.5'),
            'timeout_seconds' => env('LOCAL_LLM_TIMEOUT_SECONDS', 120),
            'max_tokens' => env('LOCAL_LLM_MAX_TOKENS', 1500),
        ],
    ],

];
