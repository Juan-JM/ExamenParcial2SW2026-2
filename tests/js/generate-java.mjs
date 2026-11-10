// Genera un proyecto Spring Boot desde un diagrama de ejemplo, sin navegador, para
// compilarlo con Maven y comprobar que el código generado es válido.
//   node tests/js/generate-java.mjs <carpeta-de-salida>
import fs from 'node:fs';
import path from 'node:path';
import { SimpleJavaGenerator } from '../../resources/js/diagram/utils/simpleJavaGenerator.js';

const output = process.argv[2];
if (!output) throw new Error('Falta la carpeta de salida');

globalThis.window = { diagramTitle: 'Prueba Generador' };

const cls = (id, className, attributes, uml25 = {}) => ({
    id,
    isLink: () => false,
    get: (key) => (key === 'umlData' ? { className, type: 'class', attributes, methods: [], uml25 } : undefined),
});
const link = (id, source, target, relationData) => ({
    id,
    getSourceElement: () => source,
    getTargetElement: () => target,
    get: (key) => (key === 'relationData' ? relationData : key === 'target' ? { id: target?.id } : undefined),
});

const persona = cls('p', 'Persona', ['+ nombre: String', '+ correo: String'], { isAbstract: true });
const cliente = cls('c', 'Cliente', ['+ nit: String']);
const empleado = cls('e', 'Empleado', ['+ cargo: String']);
const pedido = cls('o', 'Pedido', ['+ fecha: LocalDate', '+ total: double']);
const detalle = cls('d', 'DetallePedido', ['+ cantidad: int']);
const producto = cls('r', 'Producto', ['+ nombre: String', '+ precio: double']);
const etiqueta = cls('t', 'Etiqueta', ['+ nombre: String']);

const elements = [persona, cliente, empleado, pedido, detalle, producto, etiqueta];
const links = [
    link('l1', cliente, persona, { type: 'inheritance' }),
    link('l2', empleado, persona, { type: 'inheritance' }),
    link('l3', cliente, pedido, { type: 'association', sourceMultiplicity: '1', targetMultiplicity: '*' }),
    link('l4', pedido, detalle, { type: 'composition', sourceMultiplicity: '1', targetMultiplicity: '*' }),
    link('l5', detalle, producto, { type: 'association', sourceMultiplicity: '*', targetMultiplicity: '1' }),
    link('l6', producto, etiqueta, { type: 'association', sourceMultiplicity: '*', targetMultiplicity: '*' }),
];

const generator = new SimpleJavaGenerator({ graph: { getElements: () => elements, getLinks: () => links } });
generator.setupProjectConfig();

const zip = await generator.buildSpringBootProject(generator.extractClasses(), generator.extractRelationships());

for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const target = path.join(output, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await entry.async('string'));
}

console.log('Proyecto generado en', output);
