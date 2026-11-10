<?php

namespace App\Services\Agent;

/**
 * Las mismas reglas de resources/js/diagram/utils/schemaNormalizationChecker.js,
 * del lado del servidor, para dárselas a la IA ya calculadas: un modelo chico
 * revisa mucho mejor si parte de los hallazgos concretos que si debe deducirlos.
 * Si se cambia una regla, cambiarla en los dos archivos.
 */
class NormalizationHints
{
    private const COLLECTION_TYPE = '/^(List|Set|Map|Collection|ArrayList|HashSet)\s*<|\[\]$/';

    /** @return list<string> Frases listas para el prompt. */
    public function check(array $schema): array
    {
        $classes = $schema['classes'] ?? [];
        $issues = [];

        foreach ($classes as $class) {
            $attributes = array_values(array_filter(array_map(fn ($line) => $this->parse($line), $class['attributes'] ?? [])));

            foreach ($this->repeatingGroups($attributes) as $names) {
                $issues[] = "1FN en {$class['name']}: ".implode(', ', $names).' forman un grupo repetitivo; conviene una clase aparte con relación 1 a muchos.';
            }

            foreach ($attributes as $attribute) {
                if (preg_match(self::COLLECTION_TYPE, $attribute['type']) && $attribute['type'] !== 'byte[]') {
                    $issues[] = "1FN en {$class['name']}: {$attribute['name']} guarda varios valores ({$attribute['type']}) en una sola columna.";
                }

                if ($attribute['derived']) {
                    $issues[] = "3FN en {$class['name']}: {$attribute['name']} es derivado; no debería guardarse, se calcula.";
                }

                $owner = $this->foreignOwner($attribute['name'], $class['name'], $classes);
                if ($owner) {
                    $issues[] = "3FN en {$class['name']}: {$attribute['name']} depende de {$owner}, no de {$class['name']}; debería estar en {$owner} y accederse por la relación.";
                }
            }
        }

        return $issues;
    }

    private function parse(string $line): ?array
    {
        $text = trim(preg_replace('/^[+\-#~]\s*/', '', trim($line)));
        $colon = strrpos($text, ':');
        $name = trim($colon === false ? $text : substr($text, 0, $colon));

        if ($name === '') {
            return null;
        }

        return [
            'derived' => str_starts_with($name, '/'),
            'name' => ltrim($name, '/ '),
            'type' => $colon === false ? '' : trim(substr($text, $colon + 1)),
        ];
    }

    /** @return list<list<string>> */
    private function repeatingGroups(array $attributes): array
    {
        $groups = [];

        foreach ($attributes as $attribute) {
            if (preg_match('/^(.*?)[_-]?(\d+)$/', $attribute['name'], $match) && $match[1] !== '') {
                $groups[strtolower($match[1])][] = $attribute['name'];
            }
        }

        return array_values(array_filter($groups, fn ($names) => count($names) >= 2));
    }

    private function foreignOwner(string $attribute, string $className, array $classes): ?string
    {
        $tokens = $this->tokens($attribute);

        if (end($tokens) === 'id') {
            return null;
        }

        foreach ($classes as $other) {
            if ($other['name'] === $className) {
                continue;
            }

            $otherTokens = $this->tokens($other['name']);
            $length = count($otherTokens);

            if (count($tokens) <= $length) {
                continue;
            }

            if (array_slice($tokens, 0, $length) === $otherTokens || array_slice($tokens, -$length) === $otherTokens) {
                return $other['name'];
            }
        }

        return null;
    }

    /** "nombreCliente" y "nombre_cliente" dan ["nombre", "cliente"]. */
    private function tokens(string $name): array
    {
        $spaced = preg_replace('/([a-z0-9])([A-Z])/', '$1 $2', $name);

        return array_values(array_filter(array_map('mb_strtolower', preg_split('/[\s_-]+/', $spaced))));
    }
}
