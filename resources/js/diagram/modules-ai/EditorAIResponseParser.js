// resources/js/diagram/modules-ai/EditorAIResponseParser.js
// Red de seguridad client-side sobre las operaciones que ya vinieron
// validadas por DiagramAiOpsValidator en el backend (ver
// documentacion/06-asistente-ia.md). El backend garantiza JSON estructurado
// (Gemini/Grok con salida forzada a JSON), así que ya no hace falta un
// parser de texto libre ni un intento de "adivinar" comandos por regex —
// esto solo filtra formas obviamente inválidas antes de ejecutar.

export class EditorAIResponseParser {
    constructor() {
        this.validActions = [
            'CREATE_CLASS', 'DELETE_CLASS', 'RENAME_CLASS', 'EDIT_CLASS', 'MOVE_CLASS',
            'ADD_ATTRIBUTE', 'EDIT_ATTRIBUTE', 'DELETE_ATTRIBUTE',
            'ADD_METHOD', 'EDIT_METHOD', 'DELETE_METHOD',
            'CREATE_RELATION', 'EDIT_RELATION', 'DELETE_RELATION',
            'EDIT_MULTIPLICITY', 'SET_RELATION_NAME',
        ];
    }

    /** @param {Array} ops - ops[] del envelope {type:"ops", ops:[...]} ya devuelto por el backend. */
    validateOps(ops) {
        if (!Array.isArray(ops)) return [];

        return ops
            .map((op) => this.validateCommand(op))
            .filter((op) => op !== null);
    }

    validateCommand(command) {
        if (!command || typeof command !== 'object') return null;

        const action = command.action;
        if (!this.validActions.includes(action)) {
            console.warn(`❌ Acción no válida: ${action}`);
            return null;
        }

        switch (action) {
            case 'CREATE_CLASS':
                return this.validateCreateClass(command);
            case 'DELETE_CLASS':
                return this.requireFields(command, ['className']);
            case 'RENAME_CLASS':
                return this.requireFields(command, ['oldName', 'newName']);
            case 'EDIT_CLASS':
                return this.requireFields(command, ['className', 'uml25']);
            case 'MOVE_CLASS':
                // "near"/"position" son opcionales — ver AICommandExecutor.findFreeTopLeftPosition()
                return this.requireFields(command, ['className']);
            case 'ADD_ATTRIBUTE':
                return this.requireFields(command, ['className', 'attribute']);
            case 'EDIT_ATTRIBUTE':
                return this.requireFields(command, ['className', 'oldAttribute', 'newAttribute']);
            case 'DELETE_ATTRIBUTE':
                return this.requireFields(command, ['className', 'attributeName']);
            case 'ADD_METHOD':
                return this.requireFields(command, ['className', 'method']);
            case 'EDIT_METHOD':
                return this.requireFields(command, ['className', 'oldMethod', 'newMethod']);
            case 'DELETE_METHOD':
                return this.requireFields(command, ['className', 'methodName']);
            case 'CREATE_RELATION':
                return this.validateCreateRelation(command);
            case 'EDIT_RELATION':
                return this.requireFields(command, ['sourceClass', 'targetClass', 'modifications']);
            case 'DELETE_RELATION':
                return this.requireFields(command, ['sourceClass', 'targetClass']);
            case 'EDIT_MULTIPLICITY':
                return this.requireFields(command, ['sourceClass', 'targetClass', 'sourceMultiplicity', 'targetMultiplicity']);
            case 'SET_RELATION_NAME':
                return this.requireFields(command, ['sourceClass', 'targetClass', 'relationName']);
            default:
                return null;
        }
    }

    requireFields(command, fields) {
        for (const field of fields) {
            if (command[field] === undefined || command[field] === null || command[field] === '') {
                console.warn(`❌ ${command.action}: falta el campo "${field}"`);
                return null;
            }
        }
        return command;
    }

    validateCreateClass(command) {
        if (!command.className || typeof command.className !== 'string') {
            console.warn('❌ CREATE_CLASS: falta className');
            return null;
        }
        return {
            ...command,
            className: command.className.trim(),
            attributes: command.attributes || [],
            methods: command.methods || [],
        };
    }

    validateCreateRelation(command) {
        if (!command.sourceClass || !command.targetClass) {
            console.warn('❌ CREATE_RELATION: falta sourceClass o targetClass');
            return null;
        }
        return {
            ...command,
            relationType: this.normalizeRelationType(command.relationType) || 'association',
            sourceMultiplicity: command.sourceMultiplicity || '1',
            targetMultiplicity: command.targetMultiplicity || '1',
            relationName: command.relationName || '',
        };
    }

    normalizeRelationType(type) {
        const typeMap = {
            'asociación': 'association', asociacion: 'association',
            'relación': 'association', relacion: 'association',
            herencia: 'inheritance',
            'composición': 'composition', composicion: 'composition',
            'agregación': 'aggregation', agregacion: 'aggregation',
        };
        return typeMap[type?.toLowerCase()] || type || 'association';
    }
}
