<?php

namespace App\Services\Help;

use App\Models\HelpRequest;
use App\Services\Ai\AiOrchestrator;
use Throwable;

/**
 * Asistente de uso de la aplicación. A diferencia de Nova (la IA del equipo, que
 * conversa en grupo y edita el diagrama), este es personal: responde solo a
 * quien pregunta, nunca edita, y se basa en lo que esa persona tiene en
 * pantalla y en la guía de uso.
 */
class HelpAssistant
{
    private const MAX_TARGETS = 100;

    public function __construct(
        private readonly AiOrchestrator $orchestrator,
        private readonly ManualSearch $manual,
    ) {
    }

    public function answer(HelpRequest $request): HelpRequest
    {
        $page = $request->page ?? [];
        $targets = array_slice($page['targets'] ?? [], 0, self::MAX_TARGETS);
        $started = microtime(true);

        try {
            $raw = $this->orchestrator->run(
                $this->system(),
                $this->user($request->question, $page, $targets, $request->history ?? []),
                90,
            );

            $keys = array_column($targets, 'key');
            $answer = $this->withoutKeys(trim((string) ($raw['answer'] ?? '')), $keys);
            $steps = $this->steps($raw, $targets, $keys, $request->question);
            $highlight = $steps[0]['highlight'] ?? null;

            // "¿Dónde está X?" con su tarjeta encontrada: la respuesta es mostrarla.
            // El modelo tiende a adornarla con datos que no ve ("está fuera de vista",
            // "es la tercera tarjeta"), así que se usa una frase fija.
            if (count($steps) === 1 && ($steps[0]['look'] ?? false) && $this->isWhereQuestion($request->question)) {
                $answer = 'Claro, te lo muestro.';
            }

            // "¿Para qué sirve el botón Ver?" se responde explicando, no con un
            // recorrido para usarlo: a lo sumo se resalta eso mismo mientras se
            // explica (paso sin texto: la tarjeta muestra la explicación).
            if ($this->isExplainQuestion($request->question)) {
                $steps = $this->explainOnly($request->question, $steps, $targets);
            }
            $highlight = $steps[0]['highlight'] ?? null;

            $request->update([
                'status' => 'answered',
                'answer' => $answer ?: 'No encontré cómo ayudarte con eso. Cuéntame qué quieres lograr y lo vemos juntos.',
                'steps' => $steps,
                'highlight' => $highlight,
                'model' => $this->orchestrator->lastModel,
                'latency_ms' => (int) ((microtime(true) - $started) * 1000),
            ]);
        } catch (Throwable $e) {
            $request->update([
                'status' => 'failed',
                'answer' => 'El asistente no está disponible ahora: revisa que LM Studio u Ollama esté abierto con el modelo cargado.',
                'error' => mb_strimwidth($e->getMessage(), 0, 500),
            ]);
        }

        return $request;
    }

    private function system(): string
    {
        return <<<'PROMPT'
Eres el "Tutor", el asistente con voz que enseña a usar un editor colaborativo de
diagramas de clases UML (una herramienta CASE). La persona te habla (por voz o
por escrito) y tú le respondes EN VOZ ALTA mientras le vas señalando en
pantalla qué tocar. Solo enseñas a usar la aplicación: no editas el diagrama ni
hablas por el equipo.

Cómo hablas:
- En español neutro, tratando de "tú" (nada de voseo ni regionalismos: "puedes", no "podés"; "toca", no "tocá"; "aquí", no "acá").
- Cálido y natural, como alguien sentado al lado: "Claro, te enseño.",
  "Primero ve a…", "Ahora toca…", "Listo, con eso ya…". Segunda persona.
- Frases cortas, sin markdown, sin viñetas, sin emojis: todo se lee en voz alta.
- Si te saludan o charlan, responde con naturalidad y ofrece ayuda.

MAPA DE LA APLICACIÓN (siempre vale, aunque no esté en pantalla):
- "Mis Diagramas" (el panel principal, ruta /diagrams): la lista de diagramas
  propios y "Compartidos conmigo". Ahí está el botón "Nuevo Diagrama" para
  CREAR un diagrama, y cada tarjeta tiene Editar, Ver, Clonar y Eliminar. La
  campana de arriba tiene las invitaciones a colaborar.
- Editor (el lienzo de UN diagrama, ruta /diagrams/editor/...): todo lo que
  hay ahí trabaja sobre ESE diagrama. Arriba a la izquierda, el enlace
  "Mis Diagramas" vuelve al panel principal. Barra de arriba: el nombre
  del diagrama (clic para renombrar), deshacer, rehacer y Limpiar (papelera)
  en el centro, y a la derecha Compartir (solo el dueño), Importar, Exportar
  y Guardar. A la izquierda, el panel "Herramientas UML" (clases,
  interfaces, relaciones). A la derecha, un riel vertical con "Nova" (el chat
  del equipo con la IA, que sí edita el diagrama), "Actividad" (quién cambió
  qué) y "Versiones" (copias guardadas); cada botón abre su panel al lado.
- Desde el editor NO se crea, abre ni borra otro diagrama: para eso el primer
  paso es ir a "Mis Diagramas". Importar carga contenido DENTRO del diagrama
  abierto; no crea uno nuevo.
- Renombrar el diagrama se hace en el editor: clic sobre su nombre (arriba a
  la izquierda, encima del lienzo), se escribe el nuevo y se pulsa Enter.
- Buscar un diagrama: en "Mis Diagramas", la caja "Buscar por título o
  descripción…" o directamente su tarjeta (el botón "Editar" de esa tarjeta
  lo abre).
- Solo si lo que pide está en OTRA pantalla, el primer paso es el enlace para
  ir ahí (con su "target") y los siguientes son los de esa pantalla (con
  "highlight": null y el "target" del botón que va a aparecer). Si ya está en
  la pantalla correcta, NUNCA le digas que vaya a ella.

Qué dices:
- Lo primero es DÓNDE ESTÁ AHORA y los ELEMENTOS VISIBLES: si lo que necesita
  está en esa lista, señálalo directamente con su "key". Los marcados "fuera
  de vista" existen en la página (el recorrido los trae a la vista).
- Los botones repetidos dicen de qué son: "Editar (Gimnasio)" es el Editar de
  la tarjeta del diagrama Gimnasio.
- En el editor la lista también trae "zona" (Lienzo, Paleta de herramientas,
  paneles, Riel) y lo que está dibujado: "Clase Cliente (en el lienzo)" y sus
  relaciones. Puedes señalar cualquiera de esas cosas.
- El botón "Clase" (o "Interfaz") de la paleta SOLO sirve para crear una
  clase nueva. Para seleccionar, editar, mover o borrar una clase que ya
  existe, señala esa clase en el lienzo; si la persona no dijo cuál, señala la
  zona Lienzo y dile que toque la que quiera.
- "Haz clic en el lienzo" se señala con la zona Lienzo.
- Si pregunta QUÉ ES, PARA QUÉ SIRVE o QUÉ HACE algo, EXPLÍCALO en "answer"
  (dos o tres frases claras: qué es y para qué sirve, con un ejemplo si
  ayuda) y NO des pasos para usarlo: "steps" vacío, o un solo paso con el
  "highlight" de eso mismo. Solo guías paso a paso si pide CÓMO hacer algo.
- Si pregunta DÓNDE está algo (un diagrama, una sección, un botón), señala
  ESO MISMO: la "tarjeta" o "sección" con su nombre, o el botón que busca. Es
  un solo paso que dice "Aquí está…". No propongas acciones que no pidió
  (nunca Clonar, Eliminar ni Editar si solo preguntó dónde está).
- "fuera de vista" es un dato interno: nunca se lo digas a la persona. El
  recorrido desplaza la pantalla solo.
- Básate en el MAPA, la GUÍA DE USO y la PANTALLA ACTUAL. Si algo no aparece ahí, no
  inventes botones ni menús: di que no lo ves y sugiere dónde buscarlo.
- La CONVERSACIÓN PREVIA solo sirve para entender preguntas de seguimiento
  ("¿y después?"). No repitas respuestas anteriores: la persona puede haber
  cambiado de pantalla desde entonces.
- "answer": una o dos frases. Si hay pasos, es solo la introducción ("Claro,
  invitar a alguien es fácil, te guío."); si no hay pasos, es la respuesta.
- "steps": cada acción que la persona tiene que hacer, en orden, máximo 6.
  Cada paso:
  - "say": lo que le dices en ese paso, una o dos frases que dicen qué tocar y
    para qué sirve ("Primero ve al botón Compartir, aquí arriba: desde ahí
    invitas gente a tu diagrama.").
  - "highlight": la "key" (de ELEMENTOS VISIBLES) del elemento a tocar en ese
    paso, o null si no está en la lista (por ejemplo, aparece recién después
    de abrir un menú).
  - "target": el texto visible exacto del elemento a tocar en ese paso (aunque
    todavía no esté en pantalla), o null si el paso no es tocar algo.
- En el texto nombra los elementos por su texto visible, nunca por su "key".
- Si la persona pide que algo se haga DENTRO del diagrama (crear clases,
  atributos, relaciones), explica cómo hacerlo; puedes mencionar que también
  puede pedírselo a Nova. Nunca derives a Nova algo que se hace en otra
  pantalla (como crear un diagrama nuevo).

Salida: solo JSON, sin markdown:
{ "answer": "texto", "steps": [ { "say": "texto", "highlight": "key" | null, "target": "texto" | null } ] }
PROMPT;
    }

    private function user(string $question, array $page, array $targets, array $history = []): string
    {
        $guide = $this->manual->search($question, 3);

        $elements = collect($targets)
            ->map(fn (array $target) => "- {$target['key']}: {$target['label']}".(!empty($target['kind']) ? " ({$target['kind']})" : ''))
            ->implode("\n");

        $context = collect([
            'Pantalla' => $page['screen'] ?? null,
            'Título' => $page['title'] ?? null,
            'Ruta' => $page['path'] ?? null,
            'Encabezados' => implode(' · ', $page['headings'] ?? []),
            'Ventana abierta' => $page['modal'] ?? null,
            'Pestaña lateral' => $page['editor']['sidebarTab'] ?? null,
            'Herramienta' => $page['editor']['tool'] ?? null,
            'Seleccionado' => $page['editor']['selection'] ?? null,
            'Panel de propiedades abierto' => isset($page['editor']['propertiesOpen']) ? ($page['editor']['propertiesOpen'] ? 'sí' : 'no') : null,
            'Rol' => $page['editor']['role'] ?? null,
            'Avisos en pantalla' => implode(' · ', $page['notices'] ?? []),
        ])->filter()->map(fn ($value, $key) => "{$key}: {$value}")->implode("\n");

        $guideText = $guide === [] ? '(sin secciones relacionadas)' : '- '.implode("\n- ", $guide);

        $conversation = collect(array_slice($history, -4))
            ->filter(fn ($turn) => is_array($turn) && !empty($turn['q']))
            ->map(fn (array $turn) => "Persona: {$turn['q']}\nTutor: ".($turn['a'] ?? ''))
            ->implode("\n");
        $conversation = $conversation === '' ? '(es el primer mensaje)' : $conversation;

        $where = $this->where($page);

        return <<<PROMPT
DÓNDE ESTÁ AHORA: {$where}

GUÍA DE USO (secciones relacionadas):
{$guideText}

PANTALLA ACTUAL:
{$context}

ELEMENTOS VISIBLES (key: texto):
{$elements}

CONVERSACIÓN PREVIA:
{$conversation}

PREGUNTA (la persona está en: {$where}):
"{$question}"
PROMPT;
    }

    /** La pantalla en palabras, para que el modelo no confunda "dashboard" con otra cosa. */
    private function where(array $page): string
    {
        $screen = $page['screen'] ?? '';
        $title = trim(preg_replace('/\s*-\s*Editor UML.*$/u', '', (string) ($page['title'] ?? '')));

        $where = match ($screen) {
            'dashboard' => '"Mis Diagramas", el panel principal con la lista de diagramas',
            'editor' => 'el editor (lienzo) del diagrama'.($title !== '' ? " \"{$title}\"" : ''),
            default => $screen !== '' ? $screen : 'una pantalla de la aplicación',
        };

        if (!empty($page['modal'])) {
            $where .= ", con la ventana \"{$page['modal']}\" abierta";
        }

        return $where;
    }

    /**
     * Cada paso señala su propio elemento. Si el modelo no dio la "key" pero sí
     * el texto del botón (o lo nombró en la frase), se busca entre lo visible.
     * Si el elemento recién aparece después (un menú que se abre), queda
     * "target" para que el navegador lo encuentre en ese momento.
     *
     * @return list<array{text: string, highlight: ?string, target: ?string}>
     */
    private function steps(array $raw, array $targets, array $keys, string $question = ''): array
    {
        $steps = [];

        foreach (is_array($raw['steps'] ?? null) ? array_slice($raw['steps'], 0, 8) : [] as $step) {
            if (is_string($step)) {
                $step = ['say' => $step];
            }

            if (!is_array($step)) {
                continue;
            }

            $text = $this->withoutKeys(trim((string) ($step['say'] ?? $step['text'] ?? '')), $keys);
            if ($text === '') {
                continue;
            }

            $target = is_string($step['target'] ?? null) ? mb_substr(trim($step['target']), 0, 120) : null;
            $highlight = is_string($step['highlight'] ?? null) && in_array($step['highlight'], $keys, true)
                ? $step['highlight']
                : null;

            if ($highlight === null && $target) {
                foreach ($targets as $candidate) {
                    if (mb_strtolower(trim($candidate['label'])) === mb_strtolower($target)) {
                        $highlight = $candidate['key'];
                        break;
                    }
                }
            }

            [$highlight, $target] = $this->namedInStep($text, $highlight, $target, $targets);
            $highlight = $this->onTheCanvas($text, $highlight, $targets, $question) ?? $highlight;
            $highlight ??= $this->guessHighlight($text, $targets);
            // La adivinanza también puede caer en el botón "Clase" de la paleta.
            $highlight = $this->onTheCanvas($text, $highlight, $targets, $question) ?? $highlight;

            $steps[] = ['text' => $text, 'highlight' => $highlight, 'target' => $target ?: null];
        }

        $steps = $this->pointAtTheThingItself($question, $steps, $targets);

        // Formato anterior: un solo "highlight" para toda la respuesta.
        $legacy = is_string($raw['highlight'] ?? null) && in_array($raw['highlight'], $keys, true) ? $raw['highlight'] : null;

        if ($legacy !== null) {
            if ($steps === []) {
                $steps[] = ['text' => '', 'highlight' => $legacy, 'target' => null];
            } elseif ($steps[0]['highlight'] === null) {
                $steps[0]['highlight'] = $legacy;
            }
        }

        $kinds = array_column($targets, 'kind', 'key');

        return array_map(function (array $step) use ($kinds) {
            $kind = $step['highlight'] !== null ? (string) ($kinds[$step['highlight']] ?? '') : '';
            $step['look'] = str_starts_with($kind, 'tarjeta') || str_starts_with($kind, 'sección');

            return $step;
        }, $steps);
    }

    /**
     * "¿Dónde está SistemaGimnasio?" se responde señalando su tarjeta, no un
     * botón suyo ni otra tarjeta. Prioridad:
     * 1. La tarjeta o sección que la pregunta nombra (gana la más larga:
     *    "sistema gimnasio" es SistemaGimnasio, no Gimnasio).
     * 2. La tarjeta o sección que eligió el modelo.
     * 3. La tarjeta del botón que eligió el modelo: "Clonar (SistemaGimnasio)".
     */
    private function pointAtTheThingItself(string $question, array $steps, array $targets): array
    {
        if (!$this->isWhereQuestion($question)) {
            return $steps;
        }

        $areas = array_values(array_filter($targets, fn ($t) => $this->isArea($t)));
        $byKey = array_column($targets, null, 'key');
        $first = $steps[0] ?? ['text' => '', 'highlight' => null, 'target' => null];
        $chosen = $first['highlight'] !== null ? ($byKey[$first['highlight']] ?? null) : null;

        $area = $this->areaNamedIn($question, $areas);

        if ($area === null && $chosen !== null && $this->isArea($chosen)) {
            $area = $chosen;
        }

        if ($area === null) {
            foreach ([$chosen['label'] ?? null, $first['target'] ?? null] as $label) {
                if (is_string($label) && preg_match('/\(([^()]+)\)\s*$/u', $label, $m)) {
                    foreach ($areas as $candidate) {
                        if (mb_strtolower(trim($candidate['label'])) === mb_strtolower(trim($m[1]))) {
                            $area = $candidate;
                            break 2;
                        }
                    }
                }
            }
        }

        return $area === null
            ? $steps
            : [['text' => "Aquí está {$area['label']}.", 'highlight' => $area['key'], 'target' => $area['label']]];
    }

    private function areaNamedIn(string $question, array $areas): ?array
    {
        $compactQuestion = $this->compact($question);
        $best = null;

        foreach ($areas as $area) {
            $name = $this->compact($area['label']);
            if (mb_strlen($name) >= 4 && str_contains($compactQuestion, $name)
                && ($best === null || mb_strlen($name) > mb_strlen($this->compact($best['label'])))) {
                $best = $area;
            }
        }

        return $best;
    }

    /** "Sistema Gimnasio" y "SistemaGimnasio" se comparan igual. */
    private function compact(string $text): string
    {
        return preg_replace('/[^\p{L}\p{N}]+/u', '', mb_strtolower(
            strtr($text, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'Á' => 'a', 'É' => 'e', 'Í' => 'i', 'Ó' => 'o', 'Ú' => 'u'])
        ));
    }

    private function isArea(array $target): bool
    {
        return preg_match('/^(tarjeta|sección)/u', (string) ($target['kind'] ?? '')) === 1;
    }

    /** "¿Para qué sirve…?", "¿qué es…?", "¿qué hace…?": piden una explicación, no un recorrido. */
    private function isExplainQuestion(string $question): bool
    {
        if ($this->isWhereQuestion($question) || preg_match('/\bc[oó]mo\s+(hago|creo|puedo|se\s+hace|agrego|elimino|borro|cambio|pongo|uso)\b/iu', $question)) {
            return false;
        }

        return preg_match('/para\s+qu[eé]\s+(sirve|sirven|es|son|se\s+usa)|qu[eé]\s+(es|son|hace|hacen|significa|significan|quiere\s+decir)\b|c[oó]mo\s+funciona|en\s+qu[eé]\s+consiste|diferencia\s+entre|expl[ií]ca(me)?\b/iu', $question) === 1;
    }

    /**
     * Un solo paso, sin texto y solo para mirar, sobre lo que se pregunta: el
     * que eligió el modelo, o el que la pregunta nombra ("el botón que dice Ver").
     */
    private function explainOnly(string $question, array $steps, array $targets): array
    {
        $highlight = null;
        foreach ($steps as $step) {
            if ($step['highlight'] !== null) {
                $highlight = $step['highlight'];
                break;
            }
        }

        if ($highlight === null && preg_match('/(?:dice|llama|botón|boton|opción|opcion|pestaña|menú|menu|enlace)\s+(?:de\s+)?[\'"«“]?([+\p{L}\p{N}][\p{L}\p{N} ]{0,30}?)[\'"»”]?\s*(?:\?|$|,|\.|\s+(?:que|para|de|del|en)\b)/iu', $question, $m)) {
            $name = mb_strtolower(trim($m[1]));
            foreach ($targets as $target) {
                if (in_array($name, $this->labelForms($target['label']), true)) {
                    $highlight = $target['key'];
                    break;
                }
            }
        }

        $highlight ??= $this->guessHighlight($question, $targets);

        return $highlight === null ? [] : [['text' => '', 'highlight' => $highlight, 'target' => null, 'look' => true]];
    }

    private function isWhereQuestion(string $question): bool
    {
        return preg_match('/d[oó]nde\s+(est[aá]n?|queda|se\s+encuentra|veo|lo\s+encuentro)|ub[ií]ca(me|lo|la)?\b|enc[uo]entr|mu[eé]strame\s+d[oó]nde|se[ñn][aá]la(me)?/iu', $question) === 1;
    }

    /**
     * Si el modelo no marcó qué señalar, se busca en el primer paso el texto de
     * un elemento visible ("Haz clic en Exportar" → el botón Exportar). Gana
     * la coincidencia más larga, para no confundir "Clase" con "Clase asociativa".
     */
    private function guessHighlight(string $text, array $targets): ?string
    {
        // Si el paso nombra algo entre comillas ('Clase Cliente'), solo vale una
        // coincidencia exacta con eso: "Clase" a secas sería otro botón.
        if (preg_match_all('/[\'"«“‘]([^\'"»”’]{2,60})[\'"»”’]/u', $text, $quoted) && $quoted[1] !== []) {
            $names = array_map(fn ($name) => mb_strtolower(trim($name)), $quoted[1]);

            foreach ($targets as $target) {
                if (array_intersect($this->labelForms($target['label']), $names) !== []) {
                    return $target['key'];
                }
            }

            return null;
        }

        $haystack = mb_strtolower($text);
        $best = null;

        foreach ($targets as $target) {
            // El texto completo, o sin la aclaración entre paréntesis: "Paleta de
            // herramientas (Herramientas UML)" se nombra "la paleta de herramientas",
            // y "Clase Socio (en el lienzo)" se nombra "la clase Socio".
            $full = mb_strtolower(trim($target['label']));
            $names = array_unique([$full, trim(preg_replace('/\s*\(.*\)$/u', '', $full))]);

            foreach ($names as $label) {
                if (mb_strlen($label) < 4 || !preg_match('/(?<![\p{L}\p{N}])'.preg_quote($label, '/').'(?![\p{L}\p{N}])/u', $haystack)) {
                    continue;
                }

                if ($best === null || mb_strlen($label) > mb_strlen($best['label'])) {
                    $best = ['key' => $target['key'], 'label' => $label];
                }
            }
        }

        return $best['key'] ?? null;
    }

    /**
     * "Toca el botón Asociación", "ve a la pestaña Atributos": lo que el paso
     * nombra después de botón/pestaña/opción/enlace/menú manda sobre la "key"
     * que eligió el modelo (a veces se equivoca de fila: "Seleccionar" en vez
     * de "Asociación"). Si ese elemento todavía no está en pantalla (aparece al
     * abrir un panel), se guarda su nombre como "target" para buscarlo cuando
     * aparezca.
     *
     * @return array{0: ?string, 1: ?string} [highlight, target]
     */
    private function namedInStep(string $text, ?string $highlight, ?string $target, array $targets): array
    {
        if (!preg_match('/\b(?:botón|boton|pestaña|opción|opcion|enlace|menú|menu|casilla|campo)\s+(?:de\s+|del\s+)?[\'"«“]?([+\p{L}\p{N}][^,.;:\'"»”()]{0,40}?)[\'"»”]?(?=\s+(?:que|para|debajo|arriba|abajo|en|de|del|a|y|junto|ahí|ahora|se|con)\b|[,.;:()]|$)/iu', $text, $m)) {
            return [$highlight, $target];
        }

        $name = mb_strtolower(trim($m[1]));
        $byKey = array_column($targets, null, 'key');
        $current = $highlight !== null ? ($byKey[$highlight] ?? null) : null;

        if ($current !== null && in_array($name, $this->labelForms($current['label']), true)) {
            return [$highlight, $target];
        }

        foreach ($targets as $candidate) {
            if (in_array($name, $this->labelForms($candidate['label']), true)) {
                return [$candidate['key'], $target ?? $candidate['label']];
            }
        }

        // No está en pantalla todavía: se busca por su nombre cuando aparezca.
        return $current === null ? [null, $target ?? trim($m[1])] : [$highlight, $target];
    }

    /**
     * Pasos que hablan del lienzo ("toca la clase que quieres borrar en el
     * lienzo", "haz clic en el lienzo"). El modelo tiende a señalar el botón
     * "Clase" de la paleta por la palabra "clase", que solo crea clases nuevas.
     * Devuelve la clase del lienzo que el paso nombra o, si no nombra ninguna,
     * la zona Lienzo. null si el paso no es sobre el lienzo o ya está bien.
     */
    private function onTheCanvas(string $text, ?string $highlight, array $targets, string $question = ''): ?string
    {
        $lower = mb_strtolower($text);
        $byKey = array_column($targets, null, 'key');
        $current = $highlight !== null ? ($byKey[$highlight] ?? null) : null;
        $paletteTool = $current !== null && in_array(mb_strtolower(trim($current['label'])), ['clase', 'interfaz'], true);

        // "Toca la clase que quieres borrar" no dice "lienzo", pero habla de una
        // clase que ya existe: si señala el botón de la paleta, es un error.
        $aboutExisting = preg_match('/\b(borr|elimin|quit|seleccion|edit|mov|renombr|doble clic|que (quieres|deseas))/u', $lower.' '.mb_strtolower($question)) === 1;

        if (!preg_match('/\b(lienzo|pizarra)\b/u', $lower) && !($paletteTool && $aboutExisting)) {
            return null;
        }

        $currentKind = (string) ($current['kind'] ?? '');

        // Ya señala algo del lienzo o el lienzo mismo: está bien.
        if (str_contains($currentKind, 'lienzo') || str_starts_with((string) ($current['label'] ?? ''), 'Lienzo')) {
            return null;
        }

        // Crear una clase nueva sí es la paleta: "arrastra Clase al lienzo".
        $creating = preg_match('/\b(arrastr|cre[ae]|nuev|paleta|herramienta|botón)/u', $lower) === 1;
        if ($current !== null && (!$paletteTool || $creating)) {
            return null;
        }

        // La clase del lienzo que el paso nombra ("la clase Cliente").
        foreach ($targets as $target) {
            if (str_starts_with((string) ($target['kind'] ?? ''), 'elemento del lienzo')
                && preg_match('/^(clase|interfaz)\s+(.+?)\s*\(en el lienzo\)$/iu', $target['label'], $m)
                && mb_strlen($m[2]) >= 3
                && preg_match('/(?<![\p{L}\p{N}])'.preg_quote(mb_strtolower($m[2]), '/').'(?![\p{L}\p{N}])/u', $lower)) {
                return $target['key'];
            }
        }

        foreach ($targets as $target) {
            if (($target['kind'] ?? '') !== '' && str_starts_with((string) $target['kind'], 'zona') && str_starts_with($target['label'], 'Lienzo')) {
                return $target['key'];
            }
        }

        return null;
    }

    /**
     * Formas en que el modelo puede nombrar un elemento: "Editar (Gimnasio)"
     * también es "Editar"; "Renombrar diagrama: Gimnasio" también es "Gimnasio";
     * "Clase Cliente (en el lienzo)" también es "Cliente".
     *
     * @return list<string>
     */
    private function labelForms(string $label): array
    {
        $label = mb_strtolower(trim($label));
        $forms = [$label, trim(preg_replace('/\s*\(.*\)$/u', '', $label))];

        if (preg_match('/\(([^()]+)\)$/u', $label, $match)) {
            $forms[] = trim($match[1]);
        }

        if (preg_match('/^(clase|interfaz)\s+(.+?)\s*\(en el lienzo\)$/u', $label, $canvas)) {
            $forms[] = trim($canvas[2]);
            $forms[] = "{$canvas[1]} ".trim($canvas[2]);
        }

        if (str_contains($label, ':')) {
            $forms[] = trim(mb_substr($label, mb_strpos($label, ':') + 1));
        }

        return array_values(array_unique(array_filter($forms)));
    }

    /** El modelo a veces copia las claves internas ("h4: Herencia"): no deben llegar al usuario. */
    private function withoutKeys(string $text, array $keys): string
    {
        foreach ($keys as $key) {
            $text = preg_replace('/\b'.preg_quote($key, '/').':\s*/u', '', $text);
        }

        return $text;
    }
}
