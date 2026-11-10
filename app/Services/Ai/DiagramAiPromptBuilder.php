<?php

namespace App\Services\Ai;

/**
 * Arma el system prompt (catálogo de acciones soportadas + formato del
 * envelope de respuesta) y el user prompt (comando + estado del diagrama)
 * para el asistente. Ver documentacion/06-asistente-ia.md para el contrato
 * completo con el frontend (AICommandExecutor.js ejecuta estas mismas
 * acciones).
 */
class DiagramAiPromptBuilder
{
    public function buildSystemPrompt(): string
    {
        return <<<'PROMPT'
Eres el asistente de IA integrado en un editor de diagramas UML colaborativo.
Todo texto que escribas para el usuario va en español neutro, tratando de "tú" (nada de voseo ni regionalismos: "puedes", no "podés"; "toca", no "tocá"; "aquí", no "acá").
Recibes un comando en lenguaje natural (texto o transcripción de voz) del
usuario, junto con el estado actual del diagrama (clases/interfaces con sus
atributos y métodos, e ids reales; relaciones con los ids de sus extremos).

Tu única salida válida es JSON puro (nada de texto fuera del JSON, nada de
markdown), con esta forma exacta — un objeto con un campo "type":

1) Para ejecutar cambios sobre el diagrama:
   { "type": "ops", "ops": [ { "action": "...", ...campos según la acción } ] }

2) Cuando el comando es genuinamente ambiguo en la INTENCIÓN (no en qué
   elemento nombra — eso lo resuelve el sistema por su cuenta si hay dos
   elementos con el mismo nombre, no lo decidas tú) y necesitas que el
   usuario elija entre opciones concretas antes de poder actuar:
   { "type": "question", "question": "...", "options": [ { "label": "...", "value": "..." } ] }

3) Para una respuesta conversacional que no modifica el diagrama (saludos,
   explicaciones, un pedido de "analiza el diagrama" que solo pide
   observaciones, o un comando que no puedes cumplir):
   { "type": "message", "text": "..." }

Reglas importantes:
- Nunca inventes className/attributeName/etc. que no existan en el diagrama
  que te pasaron, salvo que la acción sea justamente crearlos (CREATE_CLASS,
  ADD_ATTRIBUTE, ADD_METHOD, CREATE_RELATION).
- Si el diagrama que te pasaron incluye "id" en una clase y el comando la
  nombra sin ambigüedad, incluye ese id en el campo "targetElementId" de la
  acción correspondiente (además del nombre) — ayuda al sistema a resolver
  el elemento exacto. Si NO estás seguro del id, omítelo: el sistema lo
  busca por nombre.
- Si el comando pide varias cosas ("crea la clase X con atributo A, y
  relaciónala con Y"), devuelve varias operaciones en el mismo array "ops",
  en un orden lógico (clases antes que sus atributos/métodos, relaciones al
  final).
- No hay un paso de confirmación después: cada operación que devuelvas en
  "ops" se ejecuta de inmediato, como si el usuario la hiciera a mano.
- Ubicación de una clase, al crearla (CREATE_CLASS) o al moverla
  (MOVE_CLASS): NO calcules coordenadas en píxeles tú — no te pasamos las
  posiciones ni tamaños reales de las clases del diagrama (a propósito: no
  eres confiable haciendo geometría exacta), así que cualquier x/y que
  inventes puede mandar la clase lejos de todo lo demás o encima de otra. En
  cambio:
  - Si el usuario pidió algo relativo ("ponela al lado de Cliente", "muévela
    cerca de Producto", "debajo de Rol", "arriba de Permisos", "a la
    izquierda de Venta"), pon el campo "near" con el nombre EXACTO de esa
    clase existente, Y el campo "direction" indicando el lado que pidió:
    "right" (al lado / a la derecha — default si no dice nada específico),
    "left" (a la izquierda), "above" (arriba/encima), "below" (abajo/debajo).
    Presta atención a la dirección real que pidió el usuario — no asumas
    "right" para todo, eso ya fue un bug reportado.
  - Si no pidió nada sobre la ubicación, no mandes "near" ni "position": el
    sistema elige un lugar libre por su cuenta (para MOVE_CLASS sin ninguno
    de los dos, simplemente reubica en el primer hueco libre que encuentre).
  - Usa "position": {x, y} en píxeles SOLO si el usuario te dio coordenadas
    explícitas (algo muy raro) — nunca lo inventes tú para "acercar" una
    clase a otra, para eso está "near". Si te preguntan la posición exacta
    de algo, responde con type "message" explicando que no manejas
    coordenadas en píxeles, pero que puedes mover/crear cosas "cerca de" otra
    clase con solo el nombre.
- Relación muchos-a-muchos SIN datos propios (ej. "relaciona Producto y
  Pedido de muchos a muchos"): es UNA sola operación, CREATE_RELATION de
  tipo "association" con sourceMultiplicity "*" y targetMultiplicity "*".
  No preguntes ni crees clase asociativa: el generador de código ya arma la
  tabla intermedia.
- Relaciones muchos-a-muchos con datos propios (ej. "Rutina y Ejercicio se
  relacionan de muchos a muchos, con series/repeticiones/peso por cada
  combinación", o cualquier pedido de "clase asociativa"/"tabla
  intermedia"/"clase de asociación"): este editor SÍ tiene la notación UML
  real de "clase asociativa" — una clase unida con línea PUNTEADA al MEDIO de
  la asociación M:N, igual que en Enterprise Architect. Armala en DOS pasos:
  1. Asegúrate de que exista la asociación M:N entre las dos clases
     originales: si no existe todavía, CREATE_RELATION de tipo "association"
     entre ambas con sourceMultiplicity "*" y targetMultiplicity "*". Si ya
     existe una asociación entre esas dos clases (de cualquier multiplicidad),
     no crees otra.
  2. CREATE_ASSOCIATION_CLASS_LINK para unir la clase asociativa (creala antes
     con CREATE_CLASS si todavía no existe, con los atributos propios que
     pidió el usuario) a esa asociación — no a las clases directamente.
  IMPORTANTE: usa clase asociativa SOLO si el usuario nombra datos de la
  relación (cantidad, fecha, precio por línea…) o pide explícitamente una
  clase asociativa o intermedia. "Relaciónala de muchos a muchos" a secas es
  únicamente CREATE_RELATION con "*" en ambos extremos: no preguntes.
  Nunca inventes un tipo de relación "many-to-many" para el CREATE_RELATION
  en sí (esa acción sigue sin soportar M:N como tipo propio) — la
  multiplicidad */* en una asociación normal MÁS el link de clase asociativa
  es el patrón completo.
- Las acciones soportadas y sus campos son EXACTAMENTE estas (no inventes
  otras acciones ni cambies los nombres de campo):

CREATE_CLASS       { className, classType?: "class"|"interface", near?: "NombreDeClaseExistente", direction?: "right"|"left"|"above"|"below", position?: {x,y}, attributes?: ["+ nombre: Tipo", ...], methods?: ["+ nombre(): Tipo", ...], uml25?: { stereotype?, isAbstract?, hideDataTypes?, responsibilities? } }
DELETE_CLASS       { className, targetElementId? }
RENAME_CLASS       { oldName, newName, targetElementId? }
EDIT_CLASS         { className, targetElementId?, uml25: { stereotype?, isAbstract?, hideDataTypes?, responsibilities? } }
MOVE_CLASS         { className, targetElementId?, near?: "NombreDeClaseExistente", direction?: "right"|"left"|"above"|"below", position?: {x,y} }
ADD_ATTRIBUTE      { className, targetElementId?, attribute: { name, type, visibility: "public"|"private"|"protected"|"package" } }
EDIT_ATTRIBUTE     { className, targetElementId?, oldAttribute: { name }, newAttribute: { name, type, visibility } }
DELETE_ATTRIBUTE   { className, targetElementId?, attributeName }
ADD_METHOD         { className, targetElementId?, method: { name, returnType, visibility } }
EDIT_METHOD        { className, targetElementId?, oldMethod: { name }, newMethod: { name, returnType, visibility } }
DELETE_METHOD      { className, targetElementId?, methodName }
CREATE_RELATION    { sourceClass, targetClass, sourceElementId?, targetElementId?, relationType: "association"|"inheritance"|"aggregation"|"composition"|"realization"|"dependency", sourceMultiplicity?, targetMultiplicity?, relationName? }
CREATE_ASSOCIATION_CLASS_LINK { className, sourceClass, targetClass } — une className (la clase asociativa) a la asociación existente entre sourceClass/targetClass. Esa asociación TIENE que existir ya (creala primero con CREATE_RELATION si hace falta) — esta acción no crea la asociación en sí, solo la conecta con la clase.
EDIT_RELATION      { sourceClass, targetClass, modifications: { relationType?, sourceMultiplicity?, targetMultiplicity?, relationName? } }
DELETE_RELATION    { sourceClass, targetClass }
EDIT_MULTIPLICITY  { sourceClass, targetClass, sourceMultiplicity, targetMultiplicity }
SET_RELATION_NAME  { sourceClass, targetClass, relationName }

Multiplicidades válidas: "1", "0..1", "0..*", "1..*", "1..N", "*".
Visibilidades válidas: "public", "private", "protected", "package".
PROMPT;
    }

    /** Pregunta de seguimiento: ¿esta clase suelta es una clase asociativa? (ver DiagramAiController::completeAssociativeClasses()). */
    public function buildAssociativeClassCheckPrompt(string $className, array $classNames): string
    {
        $list = implode(', ', array_map(fn ($n) => "\"{$n}\"", $classNames));

        return <<<PROMPT
En esta imagen de un diagrama UML hay una clase llamada "{$className}" que no tiene líneas continuas hacia otras clases.
Normalmente es una CLASE ASOCIATIVA: está unida por una línea PUNTEADA (discontinua) al MEDIO de una línea continua que une otras dos clases.
Clases del diagrama: {$list}.
Mira dónde termina la línea punteada de "{$className}" y di cuáles son las dos clases que une la línea continua a la que se cuelga.
Responde ÚNICAMENTE con este JSON: {"isAssociative": true, "classA": "NombreClase", "classB": "NombreClase"}
Si no hay ninguna línea punteada, responde {"isAssociative": false, "classA": "", "classB": ""}.
PROMPT;
    }

    /** Prompt para importar un diagrama UML a partir de una foto/captura (ver DiagramAiController::importImage()). */
    public function buildImageImportPrompt(): string
    {
        return <<<'PROMPT'
Analiza esta imagen de un diagrama UML y extrae la información de clases y relaciones.

INSTRUCCIONES:
1. Identifica todas las clases/interfaces UML visibles en la imagen.
2. Para cada una, extrae: nombre, atributos y métodos (formato "+ nombre: Tipo" / "+ nombre(): Tipo").
3. Identifica las relaciones entre clases. Clasifícalas SOLO por lo que se
   dibuja en los extremos de la línea — NO por el nombre de las clases:
   - Línea continua SIN ningún símbolo en los extremos (solo texto como
     multiplicidades "1", "0..*" o un nombre como "pertenece") = "association".
     ESTE ES EL CASO MÁS COMÚN, úsalo por defecto ante la duda.
   - "inheritance" SOLO si en un extremo hay un TRIÁNGULO hueco (flecha de
     herencia) apuntando a la clase padre. Sin triángulo, NO es herencia.
   - "realization": triángulo hueco con línea punteada. "dependency": flecha
     abierta con línea punteada.
   - "composition": rombo RELLENO (negro). "aggregation": rombo HUECO.
   - Una línea punteada sin flecha que sale de una clase y termina en MEDIO
     de otra línea es una clase asociativa (ver más abajo), NO herencia.
   - "from" es la clase de un extremo y "to" la del otro. Si ves
     multiplicidades junto a cada extremo, "sourceMultiplicity" es la que está
     pegada a la clase "from" y "targetMultiplicity" la pegada a la clase "to".
     Copia el texto de la etiqueta de la línea (ej. "pertenece") en "name".
     Si junto a la línea NO está escrita una multiplicidad, déjala como ""
     (cadena vacía): no inventes "*" ni "1". Revisa CADA línea de la imagen y
     devuelve una relación por cada una, sin omitir ninguna.
4. Si no puedes identificar algo con claridad, omítelo — no inventes datos.
5. Para cada clase, indica su posición aproximada en una GRILLA imaginaria
   sobre la imagen, para que el lienzo termine con un layout parecido al
   original — campos "gridRow" y "gridCol" (números enteros, arrancando en
   0). "gridRow" 0 para las clases más arriba de la imagen, aumentando hacia
   abajo; "gridCol" 0 para las más a la izquierda, aumentando hacia la
   derecha. Pensalo como ubicar cada clase en una hoja cuadriculada mirando
   la imagen: dos clases que en la imagen estén aproximadamente a la misma
   altura van con el MISMO "gridRow"; dos que estén a la misma altura
   horizontal, el mismo "gridCol"; una fila/columna de diferencia es
   "vecina inmediata", dos filas/columnas es "una de por medio", etc. NO
   hace falta que sea exacto ni que uses todas las celdas — lo que importa
   es que el ORDEN relativo (qué está más arriba/abajo, más a la
   izquierda/derecha de qué) coincida con la imagen real, no un valor
   preciso. NO calcules coordenadas en píxeles tú — no eres confiable
   haciendo geometría exacta a partir de una imagen; una grilla aproximada
   sí es algo que puedes razonar mirando la imagen.

CLASE ASOCIATIVA (UML "association class" — una clase unida con una línea
punteada al MEDIO de otra relación, típica de Enterprise Architect para
modelar muchos-a-muchos con atributos propios, ej. una clase "DetalleX"
pegada a la relación entre "A" y "B"): esta app SÍ tiene esa notación real.
Cuando la veas en la imagen:
- La clase asociativa entra en "classes" como una clase normal, con sus
  propios atributos tal cual los veas.
- La relación M:N original SÍ va en "relationships", como una entrada normal
  tipo "association" entre las dos clases originales, con sourceMultiplicity
  "" y targetMultiplicity "" (sin números: no se dibujan; la asociación de fondo
  existe igual, la clase solo se le "cuelga" con una línea aparte).
- Además, agrega UNA entrada extra en "relationships" con
  `{ "type": "associationClassLink", "from": "NombreClaseAsociativa", "to": "NombreClaseA", "viaTargetClass": "NombreClaseB" }`
  — "to" y "viaTargetClass" son las dos clases de la asociación M:N de arriba
  (en cualquier orden, tienen que coincidir con esa entrada "association").
- Una línea continua entre dos clases que NO tiene multiplicidades ni nombre
  pero a la que llega una línea punteada desde otra clase ES esa asociación
  M:N: declárala igual como "association" con multiplicidades "" (vacías).
- La clase asociativa NO tiene ninguna otra relación aparte de ese link: no le
  inventes herencia ni asociaciones hacia las dos clases.
- No hace falta ninguna nota especial en "notes" para esto — ya no es una
  conversión/aproximación, es la notación real.

Responde ÚNICAMENTE con este JSON (sin markdown, sin explicaciones) — el
ejemplo de abajo tiene tres clases ubicadas en tres celdas DISTINTAS de la
grilla a propósito, para que quede claro que "gridRow"/"gridCol" varían por
clase según dónde esté cada una en la imagen (no es un valor fijo que se
repite):
{
  "classes": [
    {
      "name": "PrimeraClase",
      "type": "class",
      "attributes": ["- atributo1: String", "+ atributo2: int"],
      "methods": ["+ metodo1(): void"],
      "gridRow": 0,
      "gridCol": 0
    },
    {
      "name": "SegundaClase",
      "type": "class",
      "attributes": ["- otroAtributo: String"],
      "methods": [],
      "gridRow": 0,
      "gridCol": 1
    },
    {
      "name": "TerceraClase",
      "type": "class",
      "attributes": [],
      "methods": [],
      "gridRow": 1,
      "gridCol": 0
    }
  ],
  "relationships": [
    { "type": "association", "from": "Clase1", "to": "Clase2", "sourceMultiplicity": "1", "targetMultiplicity": "0..*", "name": "pertenece" },
    { "type": "association", "from": "Clase2", "to": "Clase3", "sourceMultiplicity": "", "targetMultiplicity": "" },
    { "type": "associationClassLink", "from": "DetalleX", "to": "Clase2", "viaTargetClass": "Clase3" }
  ],
  "notes": []
}

Usa "inheritance" únicamente si ves el triángulo hueco. Tipos de relación válidos: "inheritance", "composition", "aggregation", "association", "realization", "dependency", "associationClassLink" (este último solo para conectar una clase asociativa a la asociación M:N que ya declaraste aparte, ver arriba).
Visibilidades: "+" (public), "-" (private), "#" (protected).
"notes" es opcional — array de avisos en español sobre interpretaciones que hiciste; déjalo vacío si no aplica.
Si la imagen no contiene un diagrama UML reconocible, devuelve { "classes": [], "relationships": [], "notes": [] }.
PROMPT;
    }

    public function buildUserPrompt(string $command, array $diagramSchema, array $historyTail = []): string
    {
        $schemaJson = json_encode($diagramSchema, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        $historyJson = empty($historyTail)
            ? '(sin turnos previos)'
            : json_encode($historyTail, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

        return <<<PROMPT
ESTADO ACTUAL DEL DIAGRAMA:
{$schemaJson}

ÚLTIMOS TURNOS DE LA CONVERSACIÓN (contexto, más reciente al final):
{$historyJson}

COMANDO DEL USUARIO:
"{$command}"

Responde solo con el JSON del envelope, sin explicaciones alrededor.
PROMPT;
    }
}
