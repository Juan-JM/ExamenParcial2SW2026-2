<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use MongoDB\BSON\ObjectId;

/**
 * Copia los datos de PostgreSQL a MongoDB. Solo lee de PostgreSQL: no borra ni
 * modifica nada allí. Los ids enteros se reemplazan por ObjectId y las claves
 * foráneas se remapean, guardadas como string igual que las escribe la app.
 */
class CopyPostgresToMongo extends Command
{
    protected $signature = 'mongo:copy-from-postgres {--fresh : Vacía primero las colecciones de destino en MongoDB}';

    protected $description = 'Copia los datos de PostgreSQL a MongoDB sin tocar PostgreSQL';

    /** Orden: cada tabla solo referencia a tablas ya copiadas. */
    private const TABLES = [
        'users' => ['fks' => [], 'json' => []],
        'diagrams' => ['fks' => ['user_id' => 'users'], 'json' => ['data', 'settings']],
        'diagram_sessions' => ['fks' => ['diagram_id' => 'diagrams', 'owner_id' => 'users'], 'json' => ['permissions']],
        'collaborators' => [
            'fks' => ['diagram_session_id' => 'diagram_sessions', 'user_id' => 'users'],
            'json' => ['permissions', 'cursor_position', 'current_selection'],
        ],
        'collaboration_invitations' => [
            'fks' => ['diagram_id' => 'diagrams', 'inviter_id' => 'users', 'invitee_user_id' => 'users'],
            'json' => [],
        ],
    ];

    private const DATE_COLUMN = '/_at$/';

    /** @var array<string, array<int|string, string>> tabla => id viejo => id nuevo */
    private array $idMap = [];

    public function handle(): int
    {
        $target = DB::connection('mongodb');
        $allCollections = [...array_keys(self::TABLES), 'notifications'];

        foreach ($allCollections as $collection) {
            $existing = $target->getCollection($collection)->countDocuments();

            if ($existing > 0 && !$this->option('fresh')) {
                $this->error("La colección \"{$collection}\" ya tiene {$existing} documentos. Usá --fresh para vaciarla.");

                return self::FAILURE;
            }
        }

        if ($this->option('fresh')) {
            foreach ($allCollections as $collection) {
                $target->getCollection($collection)->deleteMany([]);
            }
        }

        foreach (self::TABLES as $table => $spec) {
            $documents = [];

            foreach (DB::connection('pgsql')->table($table)->orderBy('id')->get() as $row) {
                $newId = new ObjectId();
                $this->idMap[$table][$row->id] = (string) $newId;
                $documents[] = $this->toDocument((array) $row, $newId, $spec);
            }

            $this->insert($table, $documents);
        }

        $this->copyNotifications();

        $this->info('Copia terminada. PostgreSQL quedó intacto.');

        return self::SUCCESS;
    }

    private function toDocument(array $row, ObjectId $id, array $spec): array
    {
        unset($row['id']);
        $document = ['_id' => $id];

        foreach ($row as $column => $value) {
            if (isset($spec['fks'][$column])) {
                $value = $value === null ? null : ($this->idMap[$spec['fks'][$column]][$value] ?? null);
            } elseif (in_array($column, $spec['json'], true) && is_string($value)) {
                $value = json_decode($value, true);
            } elseif ($value !== null && preg_match(self::DATE_COLUMN, $column)) {
                $value = Carbon::parse($value);
            }

            $document[$column] = $value;
        }

        return $document;
    }

    private function copyNotifications(): void
    {
        $documents = [];

        foreach (DB::connection('pgsql')->table('notifications')->get() as $row) {
            $data = json_decode($row->data, true) ?: [];

            foreach (['invitation_id' => 'collaboration_invitations', 'diagram_id' => 'diagrams'] as $key => $table) {
                if (isset($data[$key])) {
                    $data[$key] = $this->idMap[$table][$data[$key]] ?? null;
                }
            }

            $documents[] = [
                '_id' => $row->id,
                'type' => $row->type,
                'notifiable_type' => $row->notifiable_type,
                'notifiable_id' => $this->idMap['users'][$row->notifiable_id] ?? null,
                'data' => $data,
                'read_at' => $row->read_at ? Carbon::parse($row->read_at) : null,
                'created_at' => Carbon::parse($row->created_at),
                'updated_at' => Carbon::parse($row->updated_at),
            ];
        }

        $this->insert('notifications', $documents);
    }

    private function insert(string $collection, array $documents): void
    {
        if ($documents !== []) {
            DB::connection('mongodb')->table($collection)->insert($documents);
        }

        $this->line(sprintf('%-28s %d documentos', $collection, count($documents)));
    }
}
