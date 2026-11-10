<?php

namespace App\Services\Ai;

use App\Services\Ai\Exceptions\AiProviderException;

/**
 * Whitelist server-side del envelope que devuelve el modelo — defensa en
 * profundidad además de lo que ya valida EditorAIResponseParser.js en el
 * cliente. Nunca confiamos ciegamente en el JSON que devuelve el LLM.
 */
class DiagramAiOpsValidator
{
    private const VALID_ACTIONS = [
        'CREATE_CLASS', 'DELETE_CLASS', 'RENAME_CLASS', 'EDIT_CLASS', 'MOVE_CLASS',
        'ADD_ATTRIBUTE', 'EDIT_ATTRIBUTE', 'DELETE_ATTRIBUTE',
        'ADD_METHOD', 'EDIT_METHOD', 'DELETE_METHOD',
        'CREATE_RELATION', 'EDIT_RELATION', 'DELETE_RELATION',
        'EDIT_MULTIPLICITY', 'SET_RELATION_NAME', 'CREATE_ASSOCIATION_CLASS_LINK',
    ];

    private const REQUIRED_FIELDS = [
        'CREATE_CLASS' => ['className'],
        'DELETE_CLASS' => ['className'],
        'RENAME_CLASS' => ['oldName', 'newName'],
        'EDIT_CLASS' => ['className', 'uml25'],
        'MOVE_CLASS' => ['className'], // "near" o "position" son opcionales — ver AICommandExecutor.findFreeTopLeftPosition()
        'ADD_ATTRIBUTE' => ['className', 'attribute'],
        'EDIT_ATTRIBUTE' => ['className', 'oldAttribute', 'newAttribute'],
        'DELETE_ATTRIBUTE' => ['className', 'attributeName'],
        'ADD_METHOD' => ['className', 'method'],
        'EDIT_METHOD' => ['className', 'oldMethod', 'newMethod'],
        'DELETE_METHOD' => ['className', 'methodName'],
        'CREATE_RELATION' => ['sourceClass', 'targetClass'],
        'EDIT_RELATION' => ['sourceClass', 'targetClass', 'modifications'],
        'DELETE_RELATION' => ['sourceClass', 'targetClass'],
        'EDIT_MULTIPLICITY' => ['sourceClass', 'targetClass', 'sourceMultiplicity', 'targetMultiplicity'],
        'SET_RELATION_NAME' => ['sourceClass', 'targetClass', 'relationName'],
        'CREATE_ASSOCIATION_CLASS_LINK' => ['className', 'sourceClass', 'targetClass'],
    ];

    /**
     * @param  array<string, mixed>  $envelope  Salida cruda ya decodificada del proveedor.
     * @return array<string, mixed>  Envelope saneado, listo para devolver al frontend.
     *
     * @throws AiProviderException  Si el envelope no tiene un "type" reconocible — no hay nada rescatable.
     */
    public function validate(array $envelope): array
    {
        $type = $envelope['type'] ?? null;

        if (!in_array($type, ['ops', 'question', 'message'], true)) {
            throw new AiProviderException('El modelo devolvió una respuesta sin "type" válido (ops|question|message): ' . json_encode($envelope));
        }

        if ($type === 'message') {
            return ['type' => 'message', 'text' => (string) ($envelope['text'] ?? '')];
        }

        if ($type === 'question') {
            $options = array_values(array_filter(array_map(function ($opt) {
                if (!is_array($opt) || empty($opt['label']) || !array_key_exists('value', $opt)) {
                    return null;
                }

                return ['label' => (string) $opt['label'], 'value' => $opt['value']];
            }, (array) ($envelope['options'] ?? []))));

            return [
                'type' => 'question',
                'question' => (string) ($envelope['question'] ?? ''),
                'options' => $options,
            ];
        }

        $ops = [];
        foreach ((array) ($envelope['ops'] ?? []) as $op) {
            $validated = $this->validateOp($op);
            if ($validated !== null) {
                $ops[] = $validated;
            }
        }

        return ['type' => 'ops', 'ops' => $ops];
    }

    /**
     * Sanea la respuesta de importación de imagen ({classes, relationships} —
     * ver DiagramAiPromptBuilder::buildImageImportPrompt()). Tolerante: filtra
     * entradas mal formadas en vez de rechazar todo el resultado, porque acá
     * "algo se pudo rescatar" es mejor que nada (a diferencia de las ops de
     * edición, donde una acción a medias puede corromper el diagrama).
     *
     * @param  array<string, mixed>  $data
     * @return array{classes: list<array<string, mixed>>, relationships: list<array<string, mixed>>, notes: list<string>}
     */
    public function validateImageImport(array $data): array
    {
        $classes = [];
        foreach ((array) ($data['classes'] ?? []) as $class) {
            if (!is_array($class) || empty($class['name']) || !is_string($class['name'])) {
                continue;
            }

            $classes[] = [
                'name' => $class['name'],
                'type' => in_array($class['type'] ?? null, ['class', 'interface'], true) ? $class['type'] : 'class',
                'attributes' => array_values(array_filter((array) ($class['attributes'] ?? []), 'is_string')),
                'methods' => array_values(array_filter((array) ($class['methods'] ?? []), 'is_string')),
                // "gridRow"/"gridCol": posición aproximada en una grilla
                // imaginaria (0 = arriba/izquierda, aumenta hacia
                // abajo/derecha) — reemplaza a un primer intento con
                // "near"/"direction" (relación de vecindad contra una sola
                // clase de referencia) que resultó demasiado rígido: solo
                // podía expresar "al lado de una clase ya ubicada", no un
                // layout 2D real como el de la imagen. La grilla le da a
                // cada clase una coordenada propia e independiente. Ver
                // SimpleImageImporter.js (frontend, aplica la grilla con
                // espaciado fijo) y 06-asistente-ia.md §9.6/§9.7/§9.8.
                'gridRow' => is_numeric($class['gridRow'] ?? null) ? (int) $class['gridRow'] : 0,
                'gridCol' => is_numeric($class['gridCol'] ?? null) ? (int) $class['gridCol'] : 0,
            ];
        }

        $relationships = [];
        foreach ((array) ($data['relationships'] ?? []) as $rel) {
            if (!is_array($rel) || empty($rel['from']) || empty($rel['to'])) {
                continue;
            }

            // associationClassLink es una forma distinta ("from" = la clase
            // asociativa, "to" + "viaTargetClass" = las dos clases de la
            // asociación M:N a la que se cuelga) — sin multiplicidades ni
            // label, esos campos no aplican a este conector. Ver
            // DiagramAiPromptBuilder::buildImageImportPrompt().
            if (($rel['type'] ?? null) === 'associationClassLink') {
                if (empty($rel['viaTargetClass']) || !is_string($rel['viaTargetClass'])) {
                    continue;
                }

                $relationships[] = [
                    'type' => 'associationClassLink',
                    'from' => (string) $rel['from'],
                    'to' => (string) $rel['to'],
                    'viaTargetClass' => (string) $rel['viaTargetClass'],
                ];

                continue;
            }

            $relationships[] = [
                'type' => is_string($rel['type'] ?? null) ? $rel['type'] : 'association',
                'from' => (string) $rel['from'],
                'to' => (string) $rel['to'],
                'sourceMultiplicity' => (string) ($rel['sourceMultiplicity'] ?? ''),
                'targetMultiplicity' => (string) ($rel['targetMultiplicity'] ?? ''),
                'label' => (string) ($rel['label'] ?? $rel['name'] ?? ''),
            ];
        }

        $relationships = $this->dedupeAssociationClassLinks($relationships);

        $notes = array_values(array_filter((array) ($data['notes'] ?? []), 'is_string'));

        return ['classes' => $classes, 'relationships' => $relationships, 'notes' => $notes];
    }

    /**
     * Los modelos chicos a veces repiten la misma clase asociativa con los
     * roles cruzados (detalle→A/B y B→A/detalle). Gana el primer enlace; se
     * descarta el que use como "asociativa" a una clase que ya es extremo de
     * otro enlace, o que repita el mismo trío de clases.
     */
    private function dedupeAssociationClassLinks(array $relationships): array
    {
        $norm = fn (string $n) => mb_strtolower(trim($n));
        $assoc = [];
        $hosts = [];
        $triples = [];
        $out = [];

        foreach ($relationships as $rel) {
            if ($rel['type'] !== 'associationClassLink') {
                $out[] = $rel;
                continue;
            }

            $from = $norm($rel['from']);
            $to = $norm($rel['to']);
            $via = $norm($rel['viaTargetClass']);
            $triple = [$from, $to, $via];
            sort($triple);
            $key = implode('|', $triple);

            if ($from === $to || $from === $via || $to === $via
                || isset($triples[$key]) || isset($hosts[$from]) || isset($assoc[$to]) || isset($assoc[$via])) {
                continue;
            }

            $triples[$key] = true;
            $assoc[$from] = true;
            $hosts[$to] = true;
            $hosts[$via] = true;
            $out[] = $rel;
        }

        return $out;
    }

    private function validateOp(mixed $op): ?array
    {
        if (!is_array($op) || !isset($op['action']) || !in_array($op['action'], self::VALID_ACTIONS, true)) {
            return null;
        }

        foreach (self::REQUIRED_FIELDS[$op['action']] as $field) {
            if (!array_key_exists($field, $op) || $op[$field] === null || $op[$field] === '') {
                return null;
            }
        }

        return $op;
    }
}
