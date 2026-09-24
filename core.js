/**
 * PUNTO PRISMA - MOTOR NÚCLEO Y ALMACENAMIENTO INDEXEDDB (V28)
 * Blindaje de inventario, seguridad de credenciales y persistencia híbrida
 */

// ==================== 1. MOTOR INDEXEDDB ====================
const PrismaDB = (function () {
    const DB_NAME = 'PuntoPrismaDB_v28';
    const DB_VERSION = 1;
    const STORE_NAME = 'app_state';
    const KEY_NAME = 'current_database';
    let dbInstance = null;

    function openDB() {
        return new Promise((resolve, reject) => {
            if (dbInstance) return resolve(dbInstance);
            if (!('indexedDB' in window)) {
                console.warn('[PrismaDB] IndexedDB no soportado en este entorno. Usando localStorage.');
                return resolve(null);
            }
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = function (event) {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = function (event) {
                dbInstance = event.target.result;
                resolve(dbInstance);
            };
            request.onerror = function (event) {
                console.error('[PrismaDB] Error abriendo IndexedDB:', event.target.error);
                resolve(null);
            };
        });
    }

    async function getDBState() {
        const idb = await openDB();
        if (!idb) {
            const raw = localStorage.getItem('puntoPrismaDB_v27') || localStorage.getItem('puntoPrismaDB_v17');
            return raw ? JSON.parse(raw) : null;
        }
        return new Promise((resolve) => {
            try {
                const tx = idb.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(KEY_NAME);
                req.onsuccess = function () {
                    if (req.result) {
                        resolve(req.result);
                    } else {
                        // Migración desde LocalStorage a IndexedDB en el primer arranque
                        const raw = localStorage.getItem('puntoPrismaDB_v27') || localStorage.getItem('puntoPrismaDB_v17');
                        if (raw) {
                            try {
                                const parsed = JSON.parse(raw);
                                setDBState(parsed); // Guardar en IndexedDB
                                resolve(parsed);
                            } catch (e) {
                                resolve(null);
                            }
                        } else {
                            resolve(null);
                        }
                    }
                };
                req.onerror = function () {
                    const raw = localStorage.getItem('puntoPrismaDB_v27') || localStorage.getItem('puntoPrismaDB_v17');
                    resolve(raw ? JSON.parse(raw) : null);
                };
            } catch (err) {
                const raw = localStorage.getItem('puntoPrismaDB_v27') || localStorage.getItem('puntoPrismaDB_v17');
                resolve(raw ? JSON.parse(raw) : null);
            }
        });
    }

    async function setDBState(data) {
        if (!data) return;
        // Guardar también en localStorage como réplica secundaria ultrarrápida
        try {
            localStorage.setItem('puntoPrismaDB_v27', JSON.stringify(data));
        } catch (e) {
            // LocalStorage puede exceder cuota de 5MB; IndexedDB no tiene ese límite
        }
        const idb = await openDB();
        if (!idb) return;
        return new Promise((resolve, reject) => {
            try {
                const tx = idb.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.put(data, KEY_NAME);
                req.onsuccess = () => resolve(true);
                req.onerror = (e) => {
                    console.error('[PrismaDB] Error al persistir en IndexedDB:', e.target.error);
                    resolve(false);
                };
            } catch (err) {
                console.error('[PrismaDB] Fallo de transacción:', err);
                resolve(false);
            }
        });
    }

    return {
        openDB,
        getDBState,
        setDBState
    };
})();

// ==================== 2. NÚCLEO PURO TESTEABLE ====================
var PRISMA_CORE = (function () {
    const ROLES_ADMIN = ['dueño', 'gerente', 'administrador', 'informatico'];
    const SECCIONES_BASE = ['ventas', 'traslados', 'sucursales', 'proveedores', 'deposito', 'compras', 'gastos', 'clientes', 'personal', 'caja', 'informes', 'informesAvanzados'];
    const ACCIONES_TODAS = [
        'vender', 'reimprimirFactura', 'crearCliente', 'editarCliente', 'cobrarDeuda', 'abrirCaja', 'cerrarCaja',
        'registrarCompra', 'crearTraslado', 'recibirTraslado', 'reimprimirRemito', 'verCatalogo', 'editarCatalogo',
        'gestionarPersonal', 'gestionarSucursales', 'gestionarProveedores', 'registrarGasto', 'verInformes', 'sistema'
    ];

    const PERMISOS = {
        'dueño':         { secciones: SECCIONES_BASE.slice(), acciones: ACCIONES_TODAS.filter(a => a !== 'sistema') },
        'gerente':       { secciones: SECCIONES_BASE.slice(), acciones: ACCIONES_TODAS.filter(a => a !== 'sistema') },
        'administrador': { secciones: SECCIONES_BASE.slice(), acciones: ACCIONES_TODAS.filter(a => a !== 'sistema') },
        'informatico':   { secciones: SECCIONES_BASE.concat(['sistema']), acciones: ACCIONES_TODAS.slice() },
        'vendedor':      { secciones: ['ventas', 'caja', 'clientes'], acciones: ['vender', 'reimprimirFactura', 'crearCliente', 'abrirCaja', 'cerrarCaja'] },
        'comprador':     { secciones: ['compras', 'traslados', 'deposito'], acciones: ['registrarCompra', 'crearTraslado', 'recibirTraslado', 'reimprimirRemito', 'verCatalogo'] },
        'repartidor':    { secciones: ['traslados'], acciones: ['crearTraslado', 'recibirTraslado', 'reimprimirRemito'] }
    };
    const LABEL_ROL = { 'dueño': 'Dueño', 'gerente': 'Gerente', 'administrador': 'Administrador', 'informatico': 'Informático', 'vendedor': 'Vendedor', 'comprador': 'Comprador', 'repartidor': 'Repartidor' };

    const SECCION_ACCIONES = {
        ventas: ['vender', 'reimprimirFactura'], traslados: ['crearTraslado', 'recibirTraslado', 'reimprimirRemito'],
        sucursales: ['gestionarSucursales'], proveedores: ['gestionarProveedores'], deposito: ['verCatalogo', 'editarCatalogo'],
        compras: ['registrarCompra'], gastos: ['registrarGasto'], clientes: ['crearCliente', 'editarCliente', 'cobrarDeuda'],
        personal: ['gestionarPersonal'], caja: ['abrirCaja', 'cerrarCaja'], informes: ['verInformes'], informesAvanzados: ['verInformes'], sistema: ['sistema']
    };
    const MAPA_ACCION_SECCION = {};
    Object.keys(SECCION_ACCIONES).forEach(sec => SECCION_ACCIONES[sec].forEach(acc => { MAPA_ACCION_SECCION[acc] = sec; }));
    function seccionDeAccion(accion) { return MAPA_ACCION_SECCION[accion] || null; }

    function accionesDeSecciones(secciones) { let out = []; (secciones || []).forEach(s => { out = out.concat(SECCION_ACCIONES[s] || []); }); return out; }
    function rolesPorDefecto() {
        const out = {};
        Object.keys(PERMISOS).forEach(k => { out[k] = { label: LABEL_ROL[k] || k, secciones: PERMISOS[k].secciones.slice(), acciones: PERMISOS[k].acciones.slice(), activo: true, protegido: k === 'informatico' }; });
        return out;
    }
    function migrarRoles(db) {
        if (!db.config.roles) db.config.roles = rolesPorDefecto();
        for (const k in db.config.roles) {
            const r = db.config.roles[k];
            if (r.activo === undefined) r.activo = true;
            if (r.protegido === undefined) r.protegido = false;
            if (!r.label) r.label = LABEL_ROL[k] || k;
            if (!r.acciones) r.acciones = PERMISOS[k] ? PERMISOS[k].acciones.slice() : accionesDeSecciones(r.secciones);
        }
        db.config.roles.informatico = { label: 'Informático', secciones: SECCIONES_BASE.concat(['sistema']), acciones: ACCIONES_TODAS.slice(), activo: true, protegido: true };
    }
    function puedeVerDB(db, rol, sec) {
        const r = db && db.config && db.config.roles && db.config.roles[rol];
        return !!r && r.activo !== false && r.secciones.indexOf(sec) !== -1;
    }
    function puedeDB(db, rol, accion) {
        const r = db && db.config && db.config.roles && db.config.roles[rol];
        return !!r && r.activo !== false && r.acciones.indexOf(accion) !== -1;
    }
    function seccionesDeDB(db, rol) { const r = db && db.config && db.config.roles && db.config.roles[rol]; return (r && r.activo !== false) ? r.secciones.slice() : []; }
    function listaRoles(db) { return Object.keys((db.config && db.config.roles) || {}); }
    function esAltoMando(usuario) { return !!usuario && (usuario.isMaster || usuario.rol === 'dueño' || usuario.rol === 'informatico'); }

    function crearRol(db, usuario, key, datos) {
        if (!esAltoMando(usuario)) return { ok: false, error: 'Sólo el dueño o el informático pueden crear roles.' };
        const k = norm(key).toLowerCase().replace(/\s+/g, '_');
        if (!k) return { ok: false, error: 'El rol necesita un identificador.' };
        if (db.config.roles[k]) return { ok: false, error: 'Ya existe un rol con ese identificador.' };
        if (!datos || !datos.label || !norm(datos.label)) return { ok: false, error: 'El rol necesita un nombre.' };
        const secciones = (datos.secciones || []).filter(s => SECCIONES_BASE.indexOf(s) !== -1);
        db.config.roles[k] = { label: datos.label, secciones, acciones: accionesDeSecciones(secciones), activo: true, protegido: false };
        return { ok: true, key: k };
    }
    function actualizarSeccionRol(db, usuario, key, seccion, valor) {
        if (!esAltoMando(usuario)) return { ok: false, error: 'Sólo el dueño o el informático pueden modificar permisos.' };
        const r = db.config.roles[key]; if (!r) return { ok: false, error: 'Rol inexistente.' };
        if (r.protegido) return { ok: false, error: 'El rol informático no se puede modificar.' };
        if (SECCIONES_BASE.indexOf(seccion) === -1) return { ok: false, error: 'Sección inválida.' };
        const idx = r.secciones.indexOf(seccion);
        const accsSeccion = SECCION_ACCIONES[seccion] || [];
        if (valor && idx === -1) { r.secciones.push(seccion); accsSeccion.forEach(a => { if (r.acciones.indexOf(a) === -1) r.acciones.push(a); }); }
        if (!valor && idx !== -1) { r.secciones.splice(idx, 1); r.acciones = r.acciones.filter(a => accsSeccion.indexOf(a) === -1); }
        return { ok: true };
    }
    function toggleActivoRol(db, usuario, key, valor) {
        if (!esAltoMando(usuario)) return { ok: false, error: 'Sólo el dueño o el informático pueden activar/desactivar roles.' };
        const r = db.config.roles[key]; if (!r) return { ok: false, error: 'Rol inexistente.' };
        if (r.protegido) return { ok: false, error: 'El rol informático no se puede desactivar.' };
        r.activo = !!valor; return { ok: true };
    }
    function eliminarRol(db, usuario, key) {
        if (!esAltoMando(usuario)) return { ok: false, error: 'Sólo el dueño o el informático pueden eliminar roles.' };
        const r = db.config.roles[key]; if (!r) return { ok: false, error: 'Rol inexistente.' };
        if (r.protegido) return { ok: false, error: 'El rol informático no se puede eliminar.' };
        const enUso = (db.empleados || []).filter(e => e.rol === key).length;
        if (enUso > 0) return { ok: false, error: 'Hay ' + enUso + ' empleado(s) con ese rol. Reasígnelos primero.' };
        delete db.config.roles[key]; return { ok: true };
    }

    function puedeUsarOtroDispositivo(rol) { return ROLES_ADMIN.indexOf(rol) !== -1; }
    function validarDispositivo(emp, deviceId) {
        if (!emp) return { ok: false, error: 'Empleado inexistente.' };
        if (puedeUsarOtroDispositivo(emp.rol)) return { ok: true, vincular: false };
        if (!emp.dispositivoId) return { ok: true, vincular: true };
        if (emp.dispositivoId === deviceId) return { ok: true, vincular: false };
        return { ok: false, error: 'Ese PIN ya está vinculado a otro dispositivo. Pida a un alto mando que lo desvincule.' };
    }
    function desvincularDispositivo(usuario, emp) {
        if (!esAltoMando(usuario)) return { ok: false, error: 'Sólo el dueño o el informático pueden desvincular un dispositivo.' };
        if (!emp) return { ok: false, error: 'Empleado inexistente.' };
        emp.dispositivoId = ''; return { ok: true };
    }

    const AYUDA_ROL = {
        'vendedor': 'Sólo Punto de Venta: vende, abre/cierra su caja y crea clientes. No ve compras, stock general ni informes.',
        'comprador': 'Sólo carga compras y hace los traslados de mercadería. Ve el catálogo en modo lectura.',
        'repartidor': 'Sólo logística: arma remitos, los envía y confirma la recepción.',
        'gerente': 'Acceso total operativo y de informes (no toca el módulo Sistema).',
        'dueño': 'Acceso total operativo y de informes (no toca el módulo Sistema).',
        'informatico': 'Control total del sistema, base de datos y contrato de mantenimiento. No se puede borrar ni bloquear.'
    };

    const esAdmin = rol => ROLES_ADMIN.indexOf(rol) !== -1;
    function puedeVer(rol, sec) { const p = PERMISOS[rol]; return !!p && p.secciones.indexOf(sec) !== -1; }
    function puede(rol, accion) { const p = PERMISOS[rol]; return !!p && p.acciones.indexOf(accion) !== -1; }
    function seccionesDe(rol) { return PERMISOS[rol] ? PERMISOS[rol].secciones.slice() : []; }

    function sucursalPermitida(usuario, idSuc) {
        if (!usuario) return false;
        if (usuario.isMaster || esAdmin(usuario.rol)) return true;
        if (usuario.rol === 'repartidor' || usuario.rol === 'comprador') return true;
        return usuario.idSuc === idSuc;
    }

    const norm = s => String(s == null ? '' : s).trim().toUpperCase();
    function nombreDuplicado(lista, nombre, idExcluir) {
        const n = norm(nombre);
        return (lista || []).some(x => norm(x.nombre) === n && x.id !== idExcluir);
    }
    function pinDuplicado(db, pin, idExcluir) {
        const sal = db && db.config && db.config.salPin; if (!sal) return false;
        const h = hashPin(pin, sal);
        if (idExcluir !== 'master' && ((db.config.masterPinHash && db.config.masterPinHash === h) || (db.config.masterPin && db.config.masterPin === pin))) return true;
        return (db.empleados || []).some(e => e.id !== idExcluir && ((e.pinHash && e.pinHash === h) || (e.pin && e.pin === pin)));
    }

    function stockEn(db, idSuc, idProd) {
        const s = db.sucursales.find(x => x.id === idSuc);
        return (s && s.inventario && s.inventario[idProd]) || 0;
    }
    function stockTotal(db, idProd) {
        return db.sucursales.reduce((a, s) => a + ((s.inventario && s.inventario[idProd]) || 0), 0);
    }

    // ==================== BLINDAJE DE INVENTARIO: REMITOS ====================
    function validarRemito(db, remito) {
        if (!remito || !remito.items || !remito.items.length) return { ok: false, error: 'El remito no tiene ítems.' };
        if (!remito.origen || !remito.destino) return { ok: false, error: 'Falta origen o destino.' };
        if (remito.origen === remito.destino) return { ok: false, error: 'Origen y destino no pueden ser iguales.' };
        if (!db.sucursales.find(s => s.id === remito.origen) || !db.sucursales.find(s => s.id === remito.destino)) return { ok: false, error: 'Sucursal inexistente.' };
        const acumulado = {};
        for (const it of remito.items) {
            if (!it.idProd || !(it.cant > 0)) return { ok: false, error: 'Cantidad inválida en un ítem.' };
            acumulado[it.idProd] = (acumulado[it.idProd] || 0) + it.cant;
        }
        for (const idProd in acumulado) {
            const disponible = stockEn(db, remito.origen, idProd);
            if (disponible <= 0) {
                const p = db.productos.find(x => x.id === idProd);
                return { ok: false, error: 'El producto "' + ((p && p.nombre) || idProd) + '" no tiene stock en origen (0 disponible).' };
            }
            if (disponible < acumulado[idProd]) {
                const p = db.productos.find(x => x.id === idProd);
                return { ok: false, error: 'Stock insuficiente de "' + ((p && p.nombre) || idProd) + '" (disponible: ' + disponible + ', solicitado: ' + acumulado[idProd] + ').' };
            }
        }
        return { ok: true };
    }
    function aplicarSalidaRemito(db, remito) {
        const v = validarRemito(db, remito); if (!v.ok) return v;
        const orig = db.sucursales.find(s => s.id === remito.origen);
        remito.items.forEach(it => {
            const actual = orig.inventario[it.idProd] || 0;
            orig.inventario[it.idProd] = Math.max(0, actual - it.cant);
        });
        remito.estado = 'En Tránsito';
        return { ok: true };
    }
    function aplicarEntradaRemito(db, remito) {
        if (!remito) return { ok: false, error: 'Remito inexistente.' };
        if (remito.estado === 'Recibido') return { ok: false, error: 'El remito ya fue recibido.' };
        const dest = db.sucursales.find(s => s.id === remito.destino);
        if (!dest) return { ok: false, error: 'Sucursal destino inexistente.' };
        remito.items.forEach(it => { dest.inventario[it.idProd] = (dest.inventario[it.idProd] || 0) + it.cant; });
        remito.estado = 'Recibido';
        return { ok: true };
    }

    // ==================== COMPRAS ====================
    function validarCompra(db, compra) {
        if (!compra || !compra.items || !compra.items.length) return { ok: false, error: 'La compra no tiene ítems.' };
        if (!db.proveedores.find(p => p.id === compra.idProv)) return { ok: false, error: 'Proveedor inexistente.' };
        if (!db.sucursales.find(s => s.id === compra.idSuc)) return { ok: false, error: 'Depósito destino inexistente.' };
        for (const it of compra.items) {
            if (!it.idProd || !(it.cant > 0)) return { ok: false, error: 'Cantidad inválida en un ítem.' };
            if (!(it.costoUnit >= 0)) return { ok: false, error: 'Costo inválido en un ítem.' };
        }
        return { ok: true };
    }
    function aplicarCompra(db, compra) {
        const v = validarCompra(db, compra); if (!v.ok) return v;
        const suc = db.sucursales.find(s => s.id === compra.idSuc);
        compra.items.forEach(it => {
            suc.inventario[it.idProd] = (suc.inventario[it.idProd] || 0) + it.cant;
            it.subtotal = it.cant * it.costoUnit;
            const p = db.productos.find(x => x.id === it.idProd);
            if (p && it.costoUnit > 0) p.costo = it.costoUnit;
        });
        compra.costoTotal = compra.items.reduce((a, b) => a + b.subtotal, 0);
        return { ok: true };
    }

    // ==================== BLINDAJE DE INVENTARIO: VENTAS ====================
    function validarVenta(db, idSuc, items) {
        if (!items || !items.length) return { ok: false, error: 'Carrito vacío.' };
        const suc = db.sucursales.find(s => s.id === idSuc);
        if (!suc) return { ok: false, error: 'Sucursal no válida para la venta.' };
        const acum = {};
        for (const i of items) {
            if (!i.idProd || !(i.cant > 0)) return { ok: false, error: 'Cantidad inválida para venta.' };
            acum[i.idProd] = (acum[i.idProd] || 0) + i.cant;
        }
        for (const idProd in acum) {
            const stockActual = stockEn(db, idSuc, idProd);
            const p = db.productos.find(x => x.id === idProd);
            const nombre = (p && p.nombre) || idProd;
            if (stockActual <= 0) {
                return { ok: false, error: 'VENTA BLOQUEADA: El producto "' + nombre + '" no cuenta con stock en esta sucursal (0 disponible).' };
            }
            if (stockActual < acum[idProd]) {
                return { ok: false, error: 'VENTA BLOQUEADA: Stock insuficiente de "' + nombre + '". Disponible: ' + stockActual + ', Solicitado: ' + acum[idProd] + '.' };
            }
        }
        return { ok: true };
    }
    function aplicarVenta(db, idSuc, items) {
        const v = validarVenta(db, idSuc, items); if (!v.ok) return v;
        const suc = db.sucursales.find(s => s.id === idSuc);
        items.forEach(i => {
            const previo = suc.inventario[i.idProd] || 0;
            suc.inventario[i.idProd] = Math.max(0, previo - i.cant);
        });
        return { ok: true };
    }

    // ==================== LIBRO DE MOVIMIENTOS ====================
    function construirMovimientos(db) {
        const movs = [];
        const nombreSuc = id => { const s = db.sucursales.find(x => x.id === id); return s ? s.nombre : 'S/D'; };
        const nombreProd = id => { const p = db.productos.find(x => x.id === id); return p ? p.nombre : 'S/D'; };
        (db.compras || []).forEach(c => (c.items || []).forEach(it => movs.push({
            fecha: c.fecha, tipo: 'COMPRA', sucursal: c.sucursal || nombreSuc(c.idSuc), idSuc: c.idSuc,
            producto: it.nombre || nombreProd(it.idProd), cant: it.cant, signo: 1,
            doc: c.nroCompra || 'COMPRA', responsable: c.usuario || 'S/D'
        })));
        (db.ventas || []).filter(v => !v.esCobroDeuda).forEach(v => movs.push({
            fecha: v.fecha, tipo: 'VENTA', sucursal: v.nombreSuc, idSuc: v.idSuc,
            producto: v.nombreProd, cant: v.cant, signo: -1, doc: v.idGrupoTicket || 'VENTA', responsable: v.vendedor
        }));
        (db.traslados || []).forEach(t => (t.items || []).forEach(it => {
            movs.push({ fecha: t.fecha, tipo: 'TRASLADO-SALIDA', sucursal: nombreSuc(t.origen), idSuc: t.origen, producto: it.nombre || nombreProd(it.idProd), cant: it.cant, signo: -1, doc: t.nroRemito, responsable: t.usuario || 'S/D' });
            if (t.estado === 'Recibido') movs.push({ fecha: t.fechaRecepcion || t.fecha, tipo: 'TRASLADO-ENTRADA', sucursal: nombreSuc(t.destino), idSuc: t.destino, producto: it.nombre || nombreProd(it.idProd), cant: it.cant, signo: 1, doc: t.nroRemito, responsable: t.recibidoPor || 'S/D' });
        }));
        return movs;
    }

    // ==================== BALANCE POR SUCURSAL ====================
    function balance(db, idSuc) {
        const suc = idSuc && idSuc !== 'TODAS' ? db.sucursales.find(s => s.id === idSuc) : null;
        const nombre = suc ? suc.nombre : null;
        const ventas = (db.ventas || []).filter(v => !v.esCobroDeuda && (!nombre || v.idSuc === idSuc || v.nombreSuc === nombre));
        const cobros = (db.ventas || []).filter(v => v.esCobroDeuda && (!nombre || v.idSuc === idSuc));
        const compras = (db.compras || []).filter(c => !nombre || c.idSuc === idSuc || c.sucursal === nombre);
        const gastos = (db.gastos || []).filter(g => !nombre || g.idSuc === idSuc || g.sucursal === nombre);
        const empleados = (db.empleados || []).filter(e => !nombre || e.idSuc === idSuc);
        const totalVentas = ventas.reduce((a, b) => a + b.total, 0);
        const totalCobros = cobros.reduce((a, b) => a + b.total, 0);
        const totalCompras = compras.reduce((a, b) => a + (b.costoTotal || 0), 0);
        const totalGastos = gastos.reduce((a, b) => a + (b.monto || 0), 0);
        const totalComisiones = empleados.reduce((a, b) => a + (b.comisionAcumulada || 0), 0);
        let valorStock = 0;
        (suc ? [suc] : db.sucursales).forEach(s => {
            for (const pid in s.inventario) { const p = db.productos.find(x => x.id === pid); if (p) valorStock += (s.inventario[pid] || 0) * (p.costo || 0); }
        });
        return {
            sucursal: nombre || 'GENERAL (todas)', totalVentas, totalCobros, totalCompras, totalGastos, totalComisiones,
            valorStock, neto: totalVentas - (totalCompras + totalGastos + totalComisiones), cantidadVentas: ventas.length
        };
    }

    // ==================== LICENCIA / MANTENIMIENTO ====================
    function licenciaEstado(lic, hoyISO) {
        if (!lic || lic.activa === false) return { bloqueado: false, vencida: false, dias: null, mensaje: 'Bloqueo automático desactivado.' };
        if (!lic.vencimiento) return { bloqueado: false, vencida: false, dias: null, mensaje: 'Sin vencimiento configurado.' };
        const hoy = new Date(hoyISO + 'T00:00:00');
        const vto = new Date(lic.vencimiento + 'T00:00:00');
        const dias = Math.round((vto - hoy) / 86400000);
        const gracia = typeof lic.gracia === 'number' ? lic.gracia : 3;
        const bloqueado = dias < -gracia;
        return {
            bloqueado, vencida: dias < 0, dias,
            mensaje: bloqueado ? 'Servicio suspendido por falta de pago del mantenimiento.'
                : (dias < 0 ? 'Vencido hace ' + Math.abs(dias) + ' día(s). Quedan ' + (gracia + dias) + ' día(s) de gracia.'
                    : 'Vigente. Vence en ' + dias + ' día(s).')
        };
    }

    function esProtegido(emp) { return !!emp && (emp.protegido === true || emp.rol === 'informatico'); }
    function puedeEliminarEmpleado(usuario, emp) {
        if (!emp) return { ok: false, error: 'Empleado inexistente.' };
        if (esProtegido(emp)) return { ok: false, error: 'El usuario INFORMÁTICO no se puede eliminar ni bloquear.' };
        if (usuario && usuario.id === emp.id) return { ok: false, error: 'No puede eliminarse a sí mismo.' };
        if (!usuario || !(usuario.isMaster || esAdmin(usuario.rol))) return { ok: false, error: 'Sin permisos.' };
        return { ok: true };
    }

    // ==================== CRIPTOGRAFÍA SHA-256 ====================
    function sha256Hex(mensaje) {
        function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
        const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
        let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
        const bytes = []; const utf8 = unescape(encodeURIComponent(mensaje));
        for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i) & 0xff);
        const bitLen = bytes.length * 8;
        bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
        for (let i = 7; i >= 0; i--) bytes.push((i * 8 < 32) ? ((bitLen >>> (i * 8)) & 0xff) : 0);
        for (let chunk = 0; chunk < bytes.length; chunk += 64) {
            const w = new Array(64);
            for (let i = 0; i < 16; i++) w[i] = (bytes[chunk + i * 4] << 24) | (bytes[chunk + i * 4 + 1] << 16) | (bytes[chunk + i * 4 + 2] << 8) | (bytes[chunk + i * 4 + 3]);
            for (let i = 16; i < 64; i++) { const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3); const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10); w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0; }
            let [a,b,c,d,e,f,g,h] = H;
            for (let i = 0; i < 64; i++) {
                const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + w[i]) | 0;
                const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22), maj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + maj) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            H = [H[0]+a|0, H[1]+b|0, H[2]+c|0, H[3]+d|0, H[4]+e|0, H[5]+f|0, H[6]+g|0, H[7]+h|0];
        }
        return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
    }
    function generarSal() { return Math.random().toString(36).substr(2) + Date.now().toString(36); }
    function hashPin(pin, sal) { return sha256Hex('prisma:' + sal + ':' + String(pin)); }
    function pinCoincide(pinIngresado, sal, hashGuardado) { return hashPin(pinIngresado, sal) === hashGuardado; }

    function migrarPinesAHash(db) {
        if (!db.config.salPin) db.config.salPin = generarSal();
        const sal = db.config.salPin;
        if (db.config.masterPin) { db.config.masterPinHash = hashPin(db.config.masterPin, sal); delete db.config.masterPin; }
        (db.empleados || []).forEach(e => { if (e.pin) { e.pinHash = hashPin(e.pin, sal); delete e.pin; } });
    }

    // ==================== SEGURIDAD: FILTRADO DE SECRETOS Y SANEAMIENTO FIRESTORE ====================
    // Estos campos NUNCA salen a la red ni a Firestore, y se eliminan claves vacías/undefined que causan error 400
    function sanitizarEntidadFirestore(obj, tabla = '') {
        if (!obj || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) {
            return obj
                .filter(x => x !== undefined)
                .map(item => sanitizarEntidadFirestore(item, tabla));
        }
        const limpio = {};
        for (const k of Object.keys(obj)) {
            // Descartar claves vacías o de sólo espacios (provocan 400 INVALID_ARGUMENT en Firestore)
            if (!k || k.trim() === '') continue;
            // Filtrar credenciales y secretos en cualquier nivel de profundidad
            if (k === 'pin' || k === 'pinHash' || k === 'masterPin' || k === 'masterPinHash' || k === 'salPin') {
                continue;
            }
            const val = obj[k];
            if (val === undefined) continue;
            if (val !== null && typeof val === 'object') {
                limpio[k] = sanitizarEntidadFirestore(val, tabla);
            } else {
                limpio[k] = val;
            }
        }
        return limpio;
    }

    function sinSecretos(tabla, obj) {
        if (!obj || typeof obj !== 'object') return obj;
        return sanitizarEntidadFirestore(obj, tabla);
    }

    function configSinSecretos(cfg) {
        if (!cfg || typeof cfg !== 'object') return cfg;
        const copia = JSON.parse(JSON.stringify(cfg));
        delete copia.masterPin;
        delete copia.masterPinHash;
        delete copia.salPin;
        return sanitizarEntidadFirestore(copia, 'config');
    }

    // ==================== FACTURACIÓN ELECTRÓNICA ====================
    function migrarFacturacionElectronica(db) {
        if (!db.config.facturacionElectronica) db.config.facturacionElectronica = { habilitada: false, timbrado: '', establecimiento: '001', puntoExpedicion: '001', proximoNro: 1, habilitadaPor: '', fecha: '' };
    }
    function habilitarFacturacionElectronica(db, usuario, datos) {
        if (!usuario || usuario.rol !== 'informatico') return { ok: false, error: 'Sólo el informático puede habilitar la facturación electrónica.' };
        if (!datos || !norm(datos.timbrado)) return { ok: false, error: 'Falta el número de timbrado.' };
        const fe = db.config.facturacionElectronica;
        fe.habilitada = true; fe.timbrado = datos.timbrado; fe.establecimiento = datos.establecimiento || '001'; fe.puntoExpedicion = datos.puntoExpedicion || '001';
        fe.habilitadaPor = usuario.nombre; fe.fecha = datos.fecha || '';
        return { ok: true };
    }
    function deshabilitarFacturacionElectronica(db, usuario) {
        if (!usuario || usuario.rol !== 'informatico') return { ok: false, error: 'Sólo el informático puede deshabilitar la facturación electrónica.' };
        db.config.facturacionElectronica.habilitada = false; return { ok: true };
    }
    function proximoNumeroLegal(db) {
        const fe = db.config.facturacionElectronica;
        const nro = String(fe.proximoNro).padStart(7, '0');
        return fe.establecimiento + '-' + fe.puntoExpedicion + '-' + nro;
    }
    function generarCDC(db, nroLegal, ruc, fechaISO) {
        const base = (ruc || '0') + nroLegal.replace(/-/g, '') + (fechaISO || '').replace(/-/g, '');
        const h = sha256Hex(base).toUpperCase();
        return (h + h).substr(0, 44);
    }
    function registrarNumeroLegalUsado(db) { db.config.facturacionElectronica.proximoNro++; }

    // ==================== BACKUPS AUTOMÁTICOS ====================
    function migrarBackupAuto(db) { if (!db.config.backupAuto) db.config.backupAuto = { activo: false, frecuenciaDias: 1, ultimoBackup: '' }; }
    function necesitaBackupAuto(db, hoyISOv) {
        const b = db.config.backupAuto; if (!b || !b.activo) return false;
        if (!b.ultimoBackup) return true;
        const dias = Math.floor((new Date(hoyISOv) - new Date(b.ultimoBackup)) / 86400000);
        return dias >= (b.frecuenciaDias || 1);
    }

    // ==================== AUDITORÍA ====================
    function registrarAuditoria(db, usuario, accion, entidad, detalle) {
        db.auditoria = db.auditoria || [];
        db.auditoria.unshift({ id: 'aud_' + Math.random().toString(36).substr(2, 9), fecha: new Date().toISOString(), usuario: usuario ? usuario.nombre : 'SISTEMA', rol: usuario ? usuario.rol : '', accion, entidad: entidad || '', detalle: detalle || '' });
        if (db.auditoria.length > 500) db.auditoria.length = 500;
    }

    // ==================== STOCK MÍNIMO ====================
    function productosBajoMinimo(db, idSuc) {
        const out = [];
        const sucs = idSuc && idSuc !== 'TODAS' ? db.sucursales.filter(s => s.id === idSuc) : db.sucursales;
        db.productos.forEach(p => {
            if (!(p.stockMin > 0)) return;
            sucs.forEach(s => { const stock = s.inventario[p.id] || 0; if (stock <= p.stockMin) out.push({ producto: p.nombre, sucursal: s.nombre, idSuc: s.id, stock, stockMin: p.stockMin }); });
        });
        return out;
    }

    // ==================== MIGRACIÓN GENERAL ====================
    function migrar(db) {
        db.productos = db.productos || []; db.sucursales = db.sucursales || []; db.proveedores = db.proveedores || [];
        db.empleados = db.empleados || []; db.clientes = db.clientes || []; db.compras = db.compras || [];
        db.gastos = db.gastos || []; db.ventas = db.ventas || []; db.traslados = db.traslados || []; db.caja = db.caja || {};
        db.config = db.config || {}; if (!db.config.masterPin && !db.config.masterPinHash) db.config.masterPin = '0000';
        db.config.licencia = Object.assign({ activa: false, monto: 0, vencimiento: '', gracia: 3, tecnico: 'SOPORTE PRISMA', contacto: '', historialPagos: [] }, db.config.licencia || {});
        db.auditoria = db.auditoria || [];
        if (!db.config.salPin) db.config.salPin = generarSal();
        migrarRoles(db);
        migrarFacturacionElectronica(db);
        migrarBackupAuto(db);

        db.productos.forEach(p => {
            if (!p.qrCode) p.qrCode = p.id;
            if (p.detalle === undefined) p.detalle = '';
            if (p.observaciones === undefined) p.observaciones = '';
            if (p.categoria === undefined) p.categoria = 'GENERAL';
            if (p.unidad === undefined) p.unidad = 'UNIDAD';
            if (p.stockMin === undefined) p.stockMin = 0;
            if (p.activo === undefined) p.activo = true;
        });
        db.sucursales.forEach(s => { s.inventario = s.inventario || {}; if (s.direccion === undefined) s.direccion = ''; if (s.tel === undefined) s.tel = ''; });
        db.proveedores.forEach(p => { ['email', 'contacto', 'observaciones', 'ciudad'].forEach(k => { if (p[k] === undefined) p[k] = ''; }); });
        db.clientes.forEach(c => { ['tel', 'sexo', 'observaciones', 'email', 'ciudad'].forEach(k => { if (c[k] === undefined) c[k] = ''; }); if (c.deuda === undefined) c.deuda = 0; });

        db.compras.forEach((c, i) => {
            if (!c.items) {
                c.items = [{ idProd: c.idProd || '', nombre: c.producto || 'S/D', cant: c.cantidad || 0, costoUnit: c.cantidad ? Math.round((c.costoTotal || 0) / c.cantidad) : 0, subtotal: c.costoTotal || 0 }];
            }
            if (!c.nroCompra) c.nroCompra = 'C-' + String(i + 1).padStart(5, '0');
            if (c.usuario === undefined) c.usuario = 'MIGRADO';
        });
        db.traslados.forEach((t, i) => {
            if (!t.items) t.items = [{ idProd: t.idProd, nombre: (db.productos.find(p => p.id === t.idProd) || {}).nombre || 'S/D', cant: t.cant || 0 }];
            if (!t.nroRemito) t.nroRemito = 'R-' + String(i + 1).padStart(5, '0');
            if (t.usuario === undefined) t.usuario = 'MIGRADO';
        });

        let info = db.empleados.find(e => e.rol === 'informatico' || e.protegido === true);
        if (!info) {
            info = {
                id: 'emp_informatico', nombre: 'SOPORTE', apellido: 'INFORMATICO', tipoDoc: 'Cedula', doc: 'TEC-0001',
                domicilio: '', idSuc: (db.sucursales[0] || {}).id || '', rol: 'informatico', pin: '6988',
                estado: 'activo', comision: 0, ventasTotal: 0, comisionAcumulada: 0, protegido: true
            };
            db.empleados.push(info);
        }
        info.rol = 'informatico'; info.protegido = true; info.estado = 'activo';
        if (!info.pin && !info.pinHash) info.pin = '6988';
        const hashReservado = hashPin('6988', db.config.salPin);
        db.empleados.forEach(e => { if (e.id !== info.id && ((e.pin && e.pin === '6988') || (e.pinHash && e.pinHash === hashReservado))) { e.pin = String(Math.floor(1000 + Math.random() * 8999)); e.pinHash = ''; } });
        db.empleados.forEach(e => { if (!db.config.roles[e.rol]) e.rol = 'vendedor'; if (e.dispositivoId === undefined) e.dispositivoId = ''; });
        migrarPinesAHash(db);
        return db;
    }

    function verificarIntegridad(db) {
        const p = [];
        db.sucursales.forEach(s => { for (const pid in s.inventario) {
            if (s.inventario[pid] < 0) p.push('Stock negativo: ' + s.nombre + ' / ' + pid);
            if (!db.productos.find(x => x.id === pid)) p.push('Producto huérfano en ' + s.nombre + ': ' + pid);
        }});
        const vistos = {};
        db.sucursales.forEach(s => { const n = norm(s.nombre); if (vistos['S' + n]) p.push('Sucursal duplicada: ' + s.nombre); vistos['S' + n] = 1; });
        db.proveedores.forEach(x => { const n = norm(x.nombre); if (vistos['P' + n]) p.push('Proveedor duplicado: ' + x.nombre); vistos['P' + n] = 1; });
        db.productos.forEach(x => { const n = norm(x.nombre); if (vistos['R' + n]) p.push('Producto duplicado: ' + x.nombre); vistos['R' + n] = 1; });
        db.empleados.forEach(e => { const clave = e.pinHash || e.pin; if (clave && vistos['N' + clave]) p.push('PIN repetido: ' + e.nombre); if (clave) vistos['N' + clave] = 1; });
        if (!db.empleados.some(e => e.rol === 'informatico')) p.push('Falta el usuario INFORMÁTICO.');
        (db.traslados || []).forEach(t => { if (!t.items || !t.items.length) p.push('Remito sin ítems: ' + t.nroRemito); });
        (db.compras || []).forEach(c => { if (!c.items || !c.items.length) p.push('Compra sin ítems: ' + c.nroCompra); });
        return p;
    }

    function proximoNro(prefijo, lista, campo) {
        let max = 0;
        (lista || []).forEach(x => { const v = parseInt(String(x[campo] || '').replace(prefijo, '')) || 0; if (v > max) max = v; });
        return prefijo + String(max + 1).padStart(5, '0');
    }

    return {
        ROLES_ADMIN, PERMISOS, AYUDA_ROL, SECCIONES_BASE, ACCIONES_TODAS, SECCION_ACCIONES, LABEL_ROL, esAdmin, puedeVer, puede, seccionesDe, sucursalPermitida,
        nombreDuplicado, pinDuplicado, stockEn, stockTotal, validarRemito, aplicarSalidaRemito, aplicarEntradaRemito,
        validarCompra, aplicarCompra, validarVenta, aplicarVenta, construirMovimientos, balance, licenciaEstado,
        esProtegido, puedeEliminarEmpleado, migrar, verificarIntegridad, proximoNro, norm,
        seccionDeAccion, rolesPorDefecto, migrarRoles, puedeVerDB, puedeDB, seccionesDeDB, listaRoles, esAltoMando,
        crearRol, actualizarSeccionRol, toggleActivoRol, eliminarRol, puedeUsarOtroDispositivo, validarDispositivo, desvincularDispositivo,
        sha256Hex, generarSal, hashPin, pinCoincide, migrarPinesAHash, sinSecretos, configSinSecretos, sanitizarEntidadFirestore,
        migrarFacturacionElectronica, habilitarFacturacionElectronica, deshabilitarFacturacionElectronica, proximoNumeroLegal, generarCDC, registrarNumeroLegalUsado,
        migrarBackupAuto, necesitaBackupAuto, registrarAuditoria, productosBajoMinimo
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PRISMA_CORE, PrismaDB };
}
