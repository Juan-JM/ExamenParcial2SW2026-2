<?php

namespace App\Services\Ai\Exceptions;

use Exception;

/**
 * El proveedor respondió 429 (cuota agotada) para ESTE modelo puntual.
 * El orquestador la atrapa, pone ese (cuenta, modelo) en cooldown por
 * retryAfterSeconds, y prueba el siguiente — nunca debe llegar al controller.
 */
class AiRateLimitException extends Exception
{
    public function __construct(
        string $message,
        public readonly int $retryAfterSeconds,
    ) {
        parent::__construct($message);
    }
}
