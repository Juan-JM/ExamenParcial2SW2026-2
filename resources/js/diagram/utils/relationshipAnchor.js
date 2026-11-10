// resources/js/diagram/utils/relationshipAnchor.js
// Ancla dinámica "distributedSide" + router a juego para relaciones UML.
//
// El comportamiento anterior ("selectSmartAnchor" en DiagramRelationshipManager,
// ya eliminado) resolvía el lado UNA SOLA VEZ al crear la relación, rotando
// entre top/right/bottom/left según cuántas conexiones tenía el elemento en
// ese momento — sin mirar la posición real del otro extremo. El resultado:
// relaciones que "siempre van arriba" (o a cualquier lado fijo, sin relación
// con la geometría real) y, si dos relaciones caían en el mismo lado,
// quedaban exactamente superpuestas en el mismo punto medio para siempre
// (no se recalculaba si se agregaban o movían otras relaciones).

/** Punto real del otro extremo de `link` respecto a `element` (centro de la
 * otra clase, o el punto suelto si el link todavía no está conectado). */
function otherPointFor(joint, element, link) {
    const sourceCell = link.getSourceCell();
    const targetCell = link.getTargetCell();
    const otherCell = (sourceCell === element) ? targetCell : sourceCell;
    if (otherCell && typeof otherCell.getBBox === 'function') {
        return otherCell.getBBox().center();
    }
    // Extremo suelto (todavía no conectado a un elemento, p.ej. mientras se
    // está arrastrando la punta del link).
    const loosePoint = (sourceCell === element) ? link.target() : link.source();
    return new joint.g.Point(loosePoint.x || 0, loosePoint.y || 0);
}

/** Lado del bbox de `element` más cercano al otro extremo de `link`. No usar
 * el `refPoint` que entrega JointJS para esto: para el primer extremo que
 * resuelve en cada render (source u target, según toque) todavía no tiene el
 * otro extremo calculado y llega vacío ({}), lo que elegía el lado por
 * "casualidad" (caía en el origen (0,0) del plano) en vez de por geometría
 * real. */
function sideOf(joint, element, link) {
    if (!element || typeof element.getBBox !== 'function') return null;
    return element.getBBox().sideNearestToPoint(otherPointFor(joint, element, link));
}

// Esta ancla es una función real de JointJS (se re-evalúa en cada render, no
// un string fijo calculado una vez), así que:
// - Elige el lado más cercano al otro extremo de la propia relación (igual
//   que el ancla nativa `midSide` de JointJS).
// - Si hay más de una relación compartiendo el mismo (elemento, lado), las
//   reparte a lo largo de ese lado en partes iguales, cada una centrada en
//   su propia porción — en vez de apilarse todas en el punto medio. El
//   orden del reparto sigue hacia dónde apunta cada una (no un id
//   arbitrario), para minimizar cruces entre líneas.
/**
 * OJO — no mutar `joint.anchors` directamente (`joint.anchors.distributedSide = fn`),
 * aunque funciona en desarrollo. JointJS arma ese objeto en su propio código
 * fuente con `import * as anchors from './anchors/index.mjs'` — eso es un
 * "Module Namespace Object" de ECMAScript, que por especificación del
 * lenguaje es SIEMPRE no-extensible (no es un detalle de Vite/Rollup, es
 * el motor de JS el que lo impone). En el build de producción (Rollup
 * preserva el objeto namespace real) intentar agregarle una propiedad
 * tira "Cannot add property distributedSide, object is not extensible" —
 * un throw sin try/catch a nivel de módulo que abortaba el resto de
 * `editor.js`, dejando el toolbar/asistente de IA en "Cargando..." para
 * siempre porque `window.diagramEditor` nunca llegaba a crearse. En
 * desarrollo el pre-bundle de Vite (esbuild) copia esas propiedades a un
 * objeto plano mutable como parte de su interop CJS/ESM, por eso ahí nunca
 * se vio.
 *
 * Fix real: JointJS soporta pasarle al Paper un `anchorNamespace`/
 * `routerNamespace` PROPIO (`dia/Paper.mjs`, `dia/LinkView.mjs`) en vez de
 * mutar el registro global — así que estas funciones ahora CONSTRUYEN y
 * DEVUELVEN un objeto nuevo (`{...joint.anchors, distributedSide: fn}`),
 * sin tocar el namespace congelado de JointJS en absoluto. Ver
 * `editor.js`, donde el resultado se pasa como opción al crear el Paper.
 */
export function buildAnchorNamespace(joint) {
    const distributedSide = function distributedSide(view, magnet, refPoint, opt) {
        const element = view.model;
        const link = this.model;
        const graph = this.paper.model;

        const bbox = view.getNodeBBox(magnet);
        const padding = opt.padding;
        if (isFinite(padding)) bbox.inflate(padding);

        const side = bbox.sideNearestToPoint(otherPointFor(joint, element, link));

        // En qué orden van a lo largo del lado compartido: no por un id
        // arbitrario, sino por hacia dónde apunta cada una — así una
        // relación cuyo destino está más a la izquierda cae en la parte
        // izquierda del lado, y así sucesivamente. Esto evita que las
        // líneas se crucen entre sí sin necesidad y hace que el reparto se
        // vea intencional en vez de aleatorio (el id se usa solo como
        // desempate si dos hermanos apuntan exactamente al mismo lugar).
        const isHorizontalSide = side === 'top' || side === 'bottom';
        const sortCoord = (l) => {
            const p = otherPointFor(joint, element, l);
            return isHorizontalSide ? p.x : p.y;
        };

        const siblings = graph.getConnectedLinks(element, { inbound: true, outbound: true })
            .filter((otherLink) => sideOf(joint, element, otherLink) === side)
            .sort((a, b) => {
                const byCoord = sortCoord(a) - sortCoord(b);
                if (byCoord !== 0) return byCoord;
                return String(a.id).localeCompare(String(b.id));
            });

        let index = siblings.findIndex((l) => l.id === link.id);
        if (index === -1) index = siblings.length; // por si el link todavía no figura (recién creándose)
        const count = Math.max(siblings.length, index + 1);

        const t = (index + 0.5) / count;

        switch (side) {
            case 'left':
                return new joint.g.Point(bbox.x, bbox.y + bbox.height * t);
            case 'right':
                return new joint.g.Point(bbox.x + bbox.width, bbox.y + bbox.height * t);
            case 'top':
                return new joint.g.Point(bbox.x + bbox.width * t, bbox.y);
            case 'bottom':
            default:
                return new joint.g.Point(bbox.x + bbox.width * t, bbox.y + bbox.height);
        }
    };

    return Object.assign({}, joint.anchors, { distributedSide });
}

// El router 'manhattan' de JointJS, dejado en libertad total (startDirections/
// endDirections con los 4 lados), no sabe que el ancla ya decidió un lado
// específico — para CADA dirección permitida prueba un punto de salida
// disparando un rayo desde el ancla en esa dirección, incluso direcciones que
// no tienen sentido dado en qué lado del cuadro está realmente el ancla. Como
// el ancla vive sobre el borde (no en el centro del cuadro), un rayo en una
// dirección "equivocada" reintersecta el cuadro casi de inmediato, cerca de
// una esquina — y si esa ruta resulta más barata para el buscador A*, la
// termina eligiendo. Resultado: la línea sale de la esquina en vez del centro
// del lado, incluso cuando el ancla en sí estaba perfectamente centrada.
//
// Este router envuelve a 'manhattan' pero fuerza startDirections/endDirections
// a un único elemento: exactamente el lado que 'distributedSide' ya resolvió
// para cada extremo. Así el camino siempre sale perpendicular al lado
// elegido, y solo dobla hacia otras direcciones una vez que ya dejó el
// cuadro — como lo haría un diagramador UML profesional.
const CARDINAL_SIDES = ['top', 'right', 'bottom', 'left'];

/** Lado que de verdad va a usar este extremo: si el ancla es un lado fijo
 * elegido a mano (no "distributedSide"/"auto"), respetar ESE — forzar el
 * lado recalculado dinámicamente pelearía contra un punto de anclaje que ya
 * está sobre otro lado distinto. Si es dinámica (o no hay dato todavía),
 * recalcular con el mismo criterio que la ancla. */
function resolvedSideFor(joint, cell, link, endType) {
    const anchorName = link.get(endType)?.anchor?.name;
    if (CARDINAL_SIDES.includes(anchorName)) return anchorName;
    return cell ? sideOf(joint, cell, link) : null;
}

/** Mismo motivo que buildAnchorNamespace() — ver su comentario. Devuelve un objeto nuevo en vez de mutar `joint.routers` (namespace congelado de JointJS en producción). */
export function buildRouterNamespace(joint) {
    const manhattan = joint.routers.manhattan;

    const distributedSide = function(vertices, opt, linkView) {
        const link = linkView.model;
        const sourceCell = link.getSourceCell();
        const targetCell = link.getTargetCell();

        const sourceSide = resolvedSideFor(joint, sourceCell, link, 'source');
        const targetSide = resolvedSideFor(joint, targetCell, link, 'target');

        const constrainedOpt = Object.assign({}, opt);
        if (sourceSide) constrainedOpt.startDirections = [sourceSide];
        if (targetSide) constrainedOpt.endDirections = [targetSide];

        return manhattan(vertices, constrainedOpt, linkView);
    };

    return Object.assign({}, joint.routers, { distributedSide });
}
