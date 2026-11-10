<?php

namespace App\Support;

use Illuminate\Foundation\Vite;

/**
 * En desarrollo, Vite escucha en todas las interfaces (`vite.config.js`,
 * `server.host: true`) y `public/hot` queda con una dirección comodín
 * (`http://[::]:5173`) que ningún navegador puede pedir. Se reemplaza por el
 * host con el que llegó la petición: `127.0.0.1`/`localhost` en la laptop, o
 * la IP Wi-Fi cuando la página la pide el celular (navegador o la app móvil,
 * que embebe el lienzo). Lo mismo si `hot` trae una dirección local y la
 * petición viene de la red.
 */
class NetworkAwareVite extends Vite
{
    private const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
    private const WILDCARD = ['[::]', '0.0.0.0'];

    protected function hotAsset($asset)
    {
        $url = parent::hotAsset($asset);
        $requestHost = request()?->getHost();

        if (!$requestHost || !preg_match('#^(https?://)(\[[^\]]+\]|[^:/]+)#', $url, $m)) {
            return $url;
        }

        $hotHost = $m[2];
        $fromNetwork = !in_array($requestHost, self::LOOPBACK, true);

        if (!in_array($hotHost, self::WILDCARD, true) && !$fromNetwork) {
            return $url;
        }

        $host = str_contains($requestHost, ':') && $requestHost[0] !== '[' ? "[{$requestHost}]" : $requestHost;

        return $m[1].$host.substr($url, strlen($m[0]));
    }
}
