<?php

namespace App\Services\Ai\Concerns;

/**
 * Compartido entre los providers (Gemini/Grok/OpenRouter): aunque el prompt
 * pide "SOLO JSON, nada de markdown", los modelos gratis/chicos (los que
 * mayormente usa este orquestador) a veces igual envuelven la respuesta en
 * ```json ... ``` — sin esto, `json_decode()` falla, se cuenta como "modelo
 * falló" (AiProviderException) y se quema un intento entero (con su
 * timeout) por algo trivialmente arreglable. Idea tomada de un orquestador
 * Python/LangChain de otro proyecto que hacía exactamente este stripping
 * como red de seguridad antes de parsear.
 */
trait StripsMarkdownJsonFence
{
    private function stripMarkdownJsonFence(string $text): string
    {
        $text = trim($text);

        if (str_starts_with($text, '```json')) {
            $text = substr($text, 7);
        } elseif (str_starts_with($text, '```')) {
            $text = substr($text, 3);
        }

        if (str_ends_with($text, '```')) {
            $text = substr($text, 0, -3);
        }

        return trim($text);
    }
}
