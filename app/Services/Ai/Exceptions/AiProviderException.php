<?php

namespace App\Services\Ai\Exceptions;

use Exception;

/**
 * Error del proveedor que NO es de cuota (400 de validación, 500, respuesta
 * que no vino en JSON, etc.). A propósito el orquestador NO hace fallback
 * ante esto — se propaga tal cual al controller, como pidió el usuario.
 */
class AiProviderException extends Exception
{
}
