<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `diagrams.data`/`metadata` ya se leen/escriben como arrays PHP (Eloquent
 * los castea con 'array' en App\Models\Diagram), así que esto es puramente
 * un cambio de tipo de columna en la base — Eloquent sigue json_encode/decode
 * igual que antes, nada en JS ni en los generadores de código toca la
 * columna cruda. Solo se aplica en Postgres (el motor real de la app): en
 * SQLite (usado en tests) las columnas no tienen tipado estricto, así que
 * quedarse en TEXT ahí es funcionalmente idéntico y evita depender de
 * doctrine/dbal (no instalado) para un ALTER TYPE en un motor donde no hace falta.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::getConnection()->getDriverName() !== 'pgsql') {
            return;
        }

        // NULLIF(...,'')::json protege el caso borde de un string vacío en
        // vez de NULL (data no es nullable, pero metadata sí, y por las
        // dudas): un '' no es JSON válido y rompería el ALTER a mitad de tabla.
        DB::statement("ALTER TABLE diagrams ALTER COLUMN data TYPE json USING NULLIF(data, '')::json");
        DB::statement("ALTER TABLE diagrams ALTER COLUMN metadata TYPE json USING NULLIF(metadata, '')::json");
    }

    public function down(): void
    {
        if (Schema::getConnection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("ALTER TABLE diagrams ALTER COLUMN data TYPE text USING data::text");
        DB::statement("ALTER TABLE diagrams ALTER COLUMN metadata TYPE text USING metadata::text");
    }
};
