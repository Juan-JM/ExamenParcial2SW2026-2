<?php

namespace Database\Seeders;

use App\Models\Diagram;
use App\Models\User;
use App\Services\DiagramService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Auth;
use RuntimeException;

/**
 * Usuarios de prueba para tests/e2e/server.mjs. Se niega a correr fuera de esa
 * base, para no crear estas cuentas entre los datos reales.
 */
class E2eSeeder extends Seeder
{
    public const PASSWORD = 'prueba-e2e-1234';

    public function run(DiagramService $service): void
    {
        if (config('database.connections.mongodb.database') !== 'diagramador_e2e') {
            throw new RuntimeException('E2eSeeder solo corre sobre la base diagramador_e2e.');
        }

        $juan = User::create(['name' => 'Juan Prueba', 'email' => 'juan@e2e.test', 'password' => self::PASSWORD]);
        $ana = User::create(['name' => 'Ana Prueba', 'email' => 'ana@e2e.test', 'password' => self::PASSWORD]);

        Auth::setUser($juan);

        $diagram = $service->create(['title' => 'Ventas E2E', 'data' => ['cells' => []]]);
        $invitation = $service->inviteCollaborator($diagram, $juan, $ana->email, 'editor');
        $service->acceptInvitation($invitation, $ana);

        $this->command?->info("Diagrama de prueba: {$diagram->slug}");
    }
}
