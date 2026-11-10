<?php

namespace App\Services\Push;

use App\Models\DeviceToken;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Envía notificaciones push por Firebase Cloud Messaging (API HTTP v1). Sin la
 * cuenta de servicio configurada no envía nada: la app sigue funcionando y solo
 * avisa mientras está abierta.
 */
class FcmSender
{
    private const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

    public function isConfigured(): bool
    {
        $path = config('services.fcm.credentials');

        return is_string($path) && $path !== '' && is_file($path);
    }

    /**
     * @param  iterable<DeviceToken>  $devices
     * @param  array<string, string>  $data
     */
    public function send(iterable $devices, string $title, string $body, array $data = []): void
    {
        $devices = collect($devices);

        if (!$this->isConfigured() || $devices->isEmpty()) {
            return;
        }

        $credentials = $this->credentials();
        $accessToken = $this->accessToken($credentials);

        foreach ($devices as $device) {
            $response = Http::withToken($accessToken)->post(
                "https://fcm.googleapis.com/v1/projects/{$credentials['project_id']}/messages:send",
                ['message' => [
                    'token' => $device->token,
                    'notification' => ['title' => $title, 'body' => $body],
                    'data' => $data,
                    'android' => ['priority' => 'high', 'notification' => ['channel_id' => 'diagram_updates']],
                ]],
            );

            if ($response->status() === 404 || str_contains($response->body(), 'UNREGISTERED')) {
                // La app se desinstaló o el token venció.
                $device->delete();
            } elseif ($response->failed()) {
                Log::warning('FcmSender: no se pudo enviar', ['status' => $response->status(), 'body' => $response->body()]);
            }
        }
    }

    private function credentials(): array
    {
        $credentials = json_decode((string) file_get_contents(config('services.fcm.credentials')), true);

        if (!isset($credentials['client_email'], $credentials['private_key'], $credentials['project_id'])) {
            throw new RuntimeException('La cuenta de servicio de Firebase está incompleta.');
        }

        return $credentials;
    }

    private function accessToken(array $credentials): string
    {
        return Cache::remember('fcm_access_token', 3000, function () use ($credentials) {
            return Http::asForm()->post('https://oauth2.googleapis.com/token', [
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion' => $this->signedJwt($credentials),
            ])->throw()->json('access_token');
        });
    }

    private function signedJwt(array $credentials): string
    {
        $encode = fn (string $value) => rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
        $now = time();

        $unsigned = $encode(json_encode(['alg' => 'RS256', 'typ' => 'JWT'])).'.'.$encode(json_encode([
            'iss' => $credentials['client_email'],
            'scope' => self::SCOPE,
            'aud' => 'https://oauth2.googleapis.com/token',
            'iat' => $now,
            'exp' => $now + 3600,
        ]));

        openssl_sign($unsigned, $signature, $credentials['private_key'], OPENSSL_ALGO_SHA256);

        return $unsigned.'.'.$encode($signature);
    }
}
