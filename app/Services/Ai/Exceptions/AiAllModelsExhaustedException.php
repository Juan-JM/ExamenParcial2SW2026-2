<?php

namespace App\Services\Ai\Exceptions;

use Exception;

/**
 * Todas las combinaciones (cuenta, modelo) configuradas están en cooldown
 * ahora mismo. No bloqueamos el request esperando — se devuelve de una con
 * el tiempo estimado hasta que el cooldown más próximo libere algo, para que
 * el chat lo muestre como mensaje de sistema.
 */
class AiAllModelsExhaustedException extends Exception
{
    public function __construct(
        string $message,
        public readonly int $retryAfterSeconds,
    ) {
        parent::__construct($message);
    }
}
