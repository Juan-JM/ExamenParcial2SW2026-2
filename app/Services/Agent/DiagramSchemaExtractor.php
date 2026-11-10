<?php

namespace App\Services\Agent;

use App\Models\Diagram;

/**
 * Arma el resumen del diagrama desde lo guardado, para los pedidos que no
 * vienen del editor (la app móvil no tiene el grafo cargado).
 */
class DiagramSchemaExtractor
{
    public function fromDiagram(Diagram $diagram): array
    {
        $cells = $diagram->data['cells'] ?? [];
        $names = [];
        $classes = [];

        foreach ($cells as $cell) {
            if (!isset($cell['umlData'])) {
                continue;
            }

            $uml = $cell['umlData'];
            $names[$cell['id']] = $uml['className'] ?? 'SinNombre';
            $classes[] = [
                'id' => $cell['id'],
                'name' => $names[$cell['id']],
                'type' => $uml['type'] ?? 'class',
                'attributes' => $uml['attributes'] ?? [],
                'methods' => $uml['methods'] ?? [],
            ];
        }

        $relations = [];

        foreach ($cells as $cell) {
            $relation = $cell['relationData'] ?? null;
            $sourceId = $cell['source']['id'] ?? null;
            $targetId = $cell['target']['id'] ?? null;

            if (!$relation || !isset($names[$sourceId], $names[$targetId])) {
                continue;
            }

            $relations[] = [
                'id' => $cell['id'],
                'sourceId' => $sourceId,
                'targetId' => $targetId,
                'source' => $names[$sourceId],
                'target' => $names[$targetId],
                'type' => $relation['type'] ?? 'association',
                'sourceMultiplicity' => $relation['sourceMultiplicity'] ?? '',
                'targetMultiplicity' => $relation['targetMultiplicity'] ?? '',
                'name' => $relation['name'] ?? '',
            ];
        }

        return ['classes' => $classes, 'relations' => $relations];
    }
}
