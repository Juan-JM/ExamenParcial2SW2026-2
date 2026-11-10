<?php

namespace App\Services\Ai\Contracts;

interface AiProviderContract
{
    /**
     * Llama al modelo indicado y devuelve la respuesta ya decodificada como
     * array asociativo (el proveedor debe forzar salida JSON pura).
     *
     * @param  string  $apiKey
     * @param  string  $model
     * @param  array<int, array{role: string, content: string}>  $messages  Formato uniforme (role: system|user), cada provider lo traduce a su propio formato de API.
     * @return array<string, mixed>
     *
     * @throws \App\Services\Ai\Exceptions\AiRateLimitException  Cuota agotada (429) — el orquestador debe rotar de modelo/cuenta.
     * @throws \App\Services\Ai\Exceptions\AiProviderException  Cualquier otro error (validación, 5xx, respuesta no-JSON) — no hay fallback, se propaga.
     */
    public function generate(string $apiKey, string $model, array $messages): array;
}
