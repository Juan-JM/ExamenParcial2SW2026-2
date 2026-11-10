<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * MongoDB crea las colecciones solo. Lo único que hay que declarar son los
 * índices, para mantener las garantías de unicidad que daba PostgreSQL.
 */
return new class extends Migration
{
    private function indexes(): array
    {
        return [
            'users' => [[['email' => 1], ['unique' => true]]],
            'diagrams' => [
                [['slug' => 1], ['unique' => true]],
                [['user_id' => 1, 'last_saved_at' => -1], []],
            ],
            'diagram_sessions' => [
                [['session_id' => 1], ['unique' => true]],
                [['invite_token' => 1], ['unique' => true]],
                [['diagram_id' => 1, 'status' => 1], []],
            ],
            // Parcial: PostgreSQL admitía varios colaboradores anónimos
            // (user_id NULL) en la misma sesión.
            'collaborators' => [
                [['diagram_session_id' => 1, 'user_id' => 1], [
                    'unique' => true,
                    'partialFilterExpression' => ['user_id' => ['$type' => 'string']],
                ]],
                [['user_id' => 1], []],
            ],
            'collaboration_invitations' => [
                [['token' => 1], ['unique' => true]],
                [['diagram_id' => 1, 'status' => 1], []],
            ],
            'ai_messages' => [[['diagram_id' => 1, 'created_at' => -1], []]],
            'activity_log' => [
                [['diagram_id' => 1, 'created_at' => -1], []],
                [['work_session_id' => 1, 'created_at' => 1], []],
            ],
            // Una sola sesión abierta por diagrama, aunque dos personas lleguen a la vez.
            'work_sessions' => [
                [['diagram_id' => 1], ['unique' => true, 'partialFilterExpression' => ['is_open' => true]]],
                [['diagram_id' => 1, 'started_at' => -1], []],
            ],
            'work_session_attendees' => [[['work_session_id' => 1, 'user_id' => 1], ['unique' => true]]],
            'diagram_snapshots' => [[['diagram_id' => 1, 'created_at' => -1], []]],
            'diagram_visits' => [[['diagram_id' => 1, 'user_id' => 1], ['unique' => true]]],
            'personal_access_tokens' => [
                [['token' => 1], ['unique' => true]],
                [['tokenable_type' => 1, 'tokenable_id' => 1], []],
            ],
            'device_tokens' => [
                [['token' => 1], ['unique' => true]],
                [['user_id' => 1], []],
            ],
            'notifications' => [[['notifiable_type' => 1, 'notifiable_id' => 1, 'created_at' => -1], []]],
        ];
    }

    public function up(): void
    {
        $db = DB::connection('mongodb');

        foreach ($this->indexes() as $collection => $indexes) {
            foreach ($indexes as [$keys, $options]) {
                $db->getCollection($collection)->createIndex($keys, $options);
            }
        }
    }

    public function down(): void
    {
        $db = DB::connection('mongodb');

        foreach (array_keys($this->indexes()) as $collection) {
            $db->getCollection($collection)->dropIndexes();
        }
    }
};
