const { PRISMA_CORE } = require('./core.js');

function assert(condition, message) {
    if (!condition) {
        console.error('❌ FAIL:', message);
        process.exit(1);
    } else {
        console.log('✅ PASS:', message);
    }
}

console.log('\n--- 1. Pruebas de Hashing y Coincidencia de PIN ---');
const sal = 'prueba_salt_123';
const hash0000 = PRISMA_CORE.hashPin('0000', sal);
const hash1234 = PRISMA_CORE.hashPin('1234', sal);
assert(typeof hash0000 === 'string' && hash0000.length === 64, 'Hash generado es SHA-256 de 64 caracteres');
assert(PRISMA_CORE.pinCoincide('0000', sal, hash0000), 'pinCoincide valida correctamente el PIN con sal');
assert(!PRISMA_CORE.pinCoincide('0001', sal, hash0000), 'pinCoincide rechaza un PIN incorrecto');

console.log('\n--- 2. Pruebas de Migración de Pines en DB ---');
const dbPrueba = {
    config: { salPin: sal, masterPin: '0000' },
    empleados: [
        { id: 'emp_1', nombre: 'JUAN', rol: 'vendedor', pin: '1234' },
        { id: 'emp_2', nombre: 'PEDRO', rol: 'vendedor', pin: '4321' }
    ]
};
PRISMA_CORE.migrarPinesAHash(dbPrueba);
assert(dbPrueba.config.masterPin === undefined, 'masterPin en texto plano fue eliminado');
assert(dbPrueba.config.masterPinHash === hash0000, 'masterPinHash fue generado correctamente');
assert(dbPrueba.empleados[0].pin === undefined, 'pin en texto plano de emp_1 fue eliminado');
assert(dbPrueba.empleados[0].pinHash === hash1234, 'pinHash de emp_1 coincide con hash de 1234');
assert(dbPrueba.empleados[1].pin === undefined, 'pin en texto plano de emp_2 fue eliminado');
assert(PRISMA_CORE.pinCoincide('4321', sal, dbPrueba.empleados[1].pinHash), 'pinHash de emp_2 coincide con hash de 4321');

console.log('\n--- 3. Pruebas de pinDuplicado ---');
// Para master
assert(!PRISMA_CORE.pinDuplicado(dbPrueba, '0000', 'master'), 'Master puede usar su propio PIN 0000');
assert(!PRISMA_CORE.pinDuplicado(dbPrueba, '9999', 'master'), 'Master puede usar PIN libre 9999');
assert(PRISMA_CORE.pinDuplicado(dbPrueba, '1234', 'master'), 'Master no puede usar PIN 1234 que pertenece a emp_1');

// Para emp_1
assert(!PRISMA_CORE.pinDuplicado(dbPrueba, '1234', 'emp_1'), 'emp_1 puede mantener su propio PIN 1234');
assert(!PRISMA_CORE.pinDuplicado(dbPrueba, '8888', 'emp_1'), 'emp_1 puede usar PIN libre 8888');
assert(PRISMA_CORE.pinDuplicado(dbPrueba, '0000', 'emp_1'), 'emp_1 no puede usar PIN 0000 del master');
assert(PRISMA_CORE.pinDuplicado(dbPrueba, '4321', 'emp_1'), 'emp_1 no puede usar PIN 4321 de emp_2');

console.log('\n--- 4. Simulación de Flujo de Cambio de PIN ---');
// Función de simulación idéntica a la implementada en app.js
function simularCambioPin(db, usuario, nuevoPin) {
    if (!usuario) return { ok: false, error: 'Debe iniciar sesión para cambiar el PIN' };
    nuevoPin = String(nuevoPin || '').trim();
    if (!/^\d{4}$/.test(nuevoPin)) return { ok: false, error: 'El PIN debe tener exactamente 4 dígitos numéricos' };

    const esMaster = !!(usuario.isMaster || usuario.id === 'master');
    if (!esMaster && nuevoPin === '0000') return { ok: false, error: 'El PIN 0000 está reservado para la Gerencia Master' };
    if (usuario.rol !== 'informatico' && nuevoPin === '6988') return { ok: false, error: 'El PIN 6988 está reservado para el Informático' };

    const idExcluir = esMaster ? 'master' : usuario.id;
    if (PRISMA_CORE.pinDuplicado(db, nuevoPin, idExcluir)) return { ok: false, error: 'Ese PIN ya está en uso por otro usuario' };

    const h = PRISMA_CORE.hashPin(nuevoPin, db.config.salPin);
    if (esMaster) {
        db.config.masterPinHash = h;
        delete db.config.masterPin;
    } else {
        const emp = db.empleados.find(x => x.id === usuario.id);
        if (!emp) return { ok: false, error: 'No se encontró el registro del empleado' };
        emp.pinHash = h;
        delete emp.pin;
    }
    return { ok: true };
}

// Validación de 4 dígitos
assert(!simularCambioPin(dbPrueba, { id: 'emp_1', rol: 'vendedor' }, '123').ok, 'Rechaza PIN de 3 dígitos');
assert(!simularCambioPin(dbPrueba, { id: 'emp_1', rol: 'vendedor' }, '12345').ok, 'Rechaza PIN de 5 dígitos');
assert(!simularCambioPin(dbPrueba, { id: 'emp_1', rol: 'vendedor' }, 'abcd').ok, 'Rechaza PIN con letras');

// Validación de pines reservados
assert(!simularCambioPin(dbPrueba, { id: 'emp_1', rol: 'vendedor' }, '0000').ok, 'Vendedor no puede usar 0000 (master)');
assert(!simularCambioPin(dbPrueba, { id: 'emp_1', rol: 'vendedor' }, '6988').ok, 'Vendedor no puede usar 6988 (informático)');
assert(!simularCambioPin(dbPrueba, { id: 'emp_1', rol: 'vendedor' }, '4321').ok, 'Vendedor no puede usar PIN de emp_2');

// Éxito: emp_1 cambia su PIN a 7777
const rEmp = simularCambioPin(dbPrueba, { id: 'emp_1', rol: 'vendedor' }, '7777');
assert(rEmp.ok, 'emp_1 cambió su PIN a 7777 con éxito');
assert(PRISMA_CORE.pinCoincide('7777', sal, dbPrueba.empleados[0].pinHash), 'Nuevo PIN 7777 funciona para emp_1');
assert(!PRISMA_CORE.pinCoincide('1234', sal, dbPrueba.empleados[0].pinHash), 'Antiguo PIN 1234 ya no funciona para emp_1');

// Éxito: Master cambia su PIN a 8888
const rMaster = simularCambioPin(dbPrueba, { id: 'master', isMaster: true }, '8888');
assert(rMaster.ok, 'Master cambió su PIN a 8888 con éxito');
assert(PRISMA_CORE.pinCoincide('8888', sal, dbPrueba.config.masterPinHash), 'Nuevo PIN 8888 funciona para Master');
assert(!PRISMA_CORE.pinCoincide('0000', sal, dbPrueba.config.masterPinHash), 'Antiguo PIN 0000 ya no funciona para Master');

console.log('\n🎉 ¡TODAS LAS PRUEBAS DE PIN PASARON SATISFACTORIAMENTE!\n');
