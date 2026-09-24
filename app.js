/**
 * PUNTO PRISMA - CONTROLADOR DE APLICACIÓN Y LÓGICA DE INTERFAZ (V28)
 * Integración con IndexedDB, blindaje de stock y UI estilo Apple
 */

function escapeHTML(str) {
    return String(str == null ? '' : str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

const formatoGs = num => "Gs. " + new Intl.NumberFormat('es-PY').format(Math.round(num || 0));
const genID = () => '_' + Math.random().toString(36).substr(2, 9);
const hoyISO = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const mockDataPrueba = {
    productos: [
        { id: 'p_espejo1', qrCode: '123', nombre: 'ESPEJO FLEXIBLE', costo: 3000, precio: 5000, categoria: 'ACCESORIOS', unidad: 'UNIDAD', detalle: 'Espejo flexible universal 10x15cm', observaciones: 'Frágil, embalar con cuidado', stockMin: 5, activo: true },
        { id: 'p_cable1', qrCode: '124', nombre: 'CABLE TIPO C REFORZADO', costo: 8000, precio: 15000, categoria: 'ACCESORIOS', unidad: 'UNIDAD', detalle: 'Carga rápida 3A trenzado 1m', observaciones: 'Garantía 30 días', stockMin: 10, activo: true }
    ],
    sucursales: [
        { id: 'suc_itagua', nombre: 'ITAGUA', direccion: 'Ruta 1 km 28', tel: '0294-220000', inventario: { 'p_espejo1': 10, 'p_cable1': 8 } },
        { id: 'suc_centro', nombre: 'SUCURSAL CENTRO', direccion: 'Palma c/ Chile', tel: '021-440000', inventario: { 'p_espejo1': 5, 'p_cable1': 0 } },
        { id: 'suc_deposito', nombre: 'DEPOSITO CENTRAL', direccion: 'Mburicaó', tel: '021-550000', inventario: { 'p_cable1': 20 } }
    ],
    proveedores: [
        { id: 'prov_1', nombre: 'IMPORTADORA CENTRAL S.A.', doc: '80012345-6', tel: '0981123456', dir: 'Asunción', contacto: 'Sr. Ramírez', email: 'ventas@importadora.com.py', ciudad: 'ASUNCIÓN', observaciones: 'Entrega los martes' }
    ],
    empleados: [
        { id: 'emp_elvio', nombre: 'ELVIO', apellido: 'GOMEZ', tipoDoc: 'Cedula', doc: '4123456', domicilio: 'Itaguá', idSuc: 'suc_itagua', rol: 'vendedor', pin: '1234', estado: 'activo', comision: 5, ventasTotal: 0, comisionAcumulada: 0 }
    ],
    clientes: [
        { id: 'cli_juan', nombre: 'JUAN', apellido: 'PÉREZ', tipoDoc: 'Cedula', doc: '1234567', direccion: 'Itaguá', tel: '0981000111', sexo: 'Masculino', ciudad: 'ITAGUÁ', email: '', observaciones: '', condicion: 'Contado', deuda: 0 }
    ],
    compras: [], gastos: [], ventas: [], traslados: [],
    caja: {}, config: { masterPin: '0000' }
};

// Variable reactiva global en memoria
window.db = mockDataPrueba;
PRISMA_CORE.migrar(window.db);

let usuarioActual = JSON.parse(sessionStorage.getItem('prismaSession') || 'null');
let html5QrCode = null, graficoChartJS = null, intentosFallidos = 0;
let carritoActual = [], stockTemporal = {};
let remitoActual = [], compraActual = [];
let itemEnEdicion = null, detalleActual = null;
let letraCliente = 'TODOS';

// Inicialización asíncrona de IndexedDB
async function inicializarPersistencia() {
    try {
        const stored = await PrismaDB.getDBState();
        if (stored && stored.productos) {
            window.db = stored;
        } else {
            // Guardar base inicial en IndexedDB
            await PrismaDB.setDBState(window.db);
        }
        PRISMA_CORE.migrar(window.db);
        console.log('[PrismaDB] Inicializado correctamente desde IndexedDB.');
    } catch (e) {
        console.warn('[PrismaDB] Fallback a memoria/localStorage:', e);
    }
    if (usuarioActual) {
        render();
    }
}

// Guardado asíncrono en IndexedDB (no bloquea UI)
let timerSincronizacionNube = null;
async function guardarDB(reRender = true) {
    PRISMA_CORE.migrar(window.db);
    await PrismaDB.setDBState(window.db);
    if (reRender) render();
    // Sincronización debounced con la nube para evitar múltiples peticiones concurrentes
    if (navigator.onLine && window.sincronizarTodoEnNube) {
        clearTimeout(timerSincronizacionNube);
        timerSincronizacionNube = setTimeout(() => {
            window.sincronizarTodoEnNube();
        }, 4000);
    }
}

function mostrarAlerta(msg, tipo = 'exito') {
    const cont = document.getElementById('contenedorAlertas');
    if (!cont) return;
    const alert = document.createElement('div');
    const colorBg = tipo === 'error'
        ? 'bg-rose-500/90 border-rose-400 text-white'
        : 'bg-emerald-500/90 border-emerald-400 text-white';
    alert.className = `toast-apple backdrop-blur-xl border px-4 py-3 rounded-2xl text-xs font-semibold flex items-center gap-2 max-w-xs ${colorBg}`;
    alert.innerHTML = `<span>${tipo === 'error' ? '⚠️' : '✓'}</span><span>${escapeHTML(msg)}</span>`;
    cont.appendChild(alert);
    setTimeout(() => alert.remove(), 3500);
}

const nombreSuc = id => { const s = window.db.sucursales.find(x => x.id === id); return s ? s.nombre : 'S/D'; };
const nombreProd = id => { const p = window.db.productos.find(x => x.id === id); return p ? p.nombre : 'S/D'; };
const ordenarAlfa = (arr, campo) => arr.slice().sort((a, b) => String(a[campo] || '').localeCompare(String(b[campo] || ''), 'es', { sensitivity: 'base' }));

function exigir(accion, msg) {
    if (!usuarioActual) return false;
    if (usuarioActual.isMaster) return true;
    if (PRISMA_CORE.puedeDB(window.db, usuarioActual.rol, accion)) return true;
    mostrarAlerta(msg || '⛔ Su rol no tiene permiso para esta acción', 'error');
    return false;
}

function obtenerDeviceId() {
    let id = localStorage.getItem('prismaDeviceId');
    if (!id) {
        id = 'dev_' + Math.random().toString(36).substr(2, 10) + Date.now().toString(36);
        localStorage.setItem('prismaDeviceId', id);
    }
    return id;
}

// ==================== IMPRESIÓN A4 Y TICKET ====================
function encabezadoA4(titulo, subtitulo) {
    return `<div style="border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:flex-end">
        <div><h1 style="font-size:20px;font-weight:900;margin:0">PUNTO PRISMA</h1><p style="font-size:12px;margin:2px 0 0">${escapeHTML(titulo)}</p></div>
        <div style="text-align:right;font-size:11px"><p style="margin:0">${escapeHTML(subtitulo || '')}</p><p style="margin:0">Emitido: ${new Date().toLocaleString('es-PY')}</p><p style="margin:0">Usuario: ${escapeHTML(usuarioActual ? usuarioActual.nombre : '')}</p></div></div>`;
}
function imprimirA4(titulo, cuerpoHtml, subtitulo) {
    const area = document.getElementById('areaFactura');
    area.innerHTML = encabezadoA4(titulo, subtitulo) + cuerpoHtml;
    document.body.classList.remove('modo-ticket');
    document.body.classList.add('modo-factura');
    setTimeout(() => { window.print(); document.body.classList.remove('modo-factura'); }, 250);
}
const estiloTabla = 'width:100%;border-collapse:collapse;font-size:11px';
const th = 'border:1px solid #000;padding:4px 6px;background:#eee;text-align:left';
const td = 'border:1px solid #000;padding:4px 6px';

// ==================== RED / LOGIN / SESIÓN ====================
function actualizarEstadoRed(esOnline) {
    const dot = document.getElementById('dotRed'), text = document.getElementById('textRed');
    if (!dot || !text) return;
    if (esOnline) {
        dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]";
        text.innerText = "Sincronizado";
        text.className = "text-slate-300 tracking-wider text-[11px] font-semibold";
        if (window.sincronizarTodoEnNube) window.sincronizarTodoEnNube();
    } else {
        dot.className = "w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]";
        text.innerText = "Modo Local (Offline)";
        text.className = "text-rose-400 tracking-wider text-[11px] font-semibold";
        mostrarAlerta("⚠️ Sin conexión: datos guardados en IndexedDB", "error");
    }
}
window.addEventListener('online', () => actualizarEstadoRed(true));
window.addEventListener('offline', () => actualizarEstadoRed(false));

async function intentarLogin(e) {
    e.preventDefault();
    const pin = document.getElementById('loginPin').value;
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    // Solo consultar servidor si el informático activó explícitamente la verificación remota y no estamos en localhost
    const esLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
    const consultarServidor = navigator.onLine && window.db?.config?.seguridadServidorActiva && window.iniciarSesionSegura && (!esLocal || window.__forzarCloudFunctionsEnLocal);

    if (consultarServidor) {
        let r;
        try { r = await window.iniciarSesionSegura(pin, obtenerDeviceId()); }
        catch (err) { r = { ok: false, rechazoDelServidor: false, error: err.message || 'Error de red' }; }
        if (btn) btn.disabled = false;
        if (r.ok) {
            usuarioActual = r.usuario;
            intentosFallidos = 0;
            const empLocal = window.db.empleados.find(x => x.id === r.usuario.id);
            if (empLocal) empLocal.dispositivoId = obtenerDeviceId();
            return iniciarSesionExitoso();
        }
        if (r.rechazoDelServidor) {
            document.getElementById('loginPin').value = '';
            return mostrarAlerta("⛔ " + r.error, "error");
        }
    }
    if (btn) btn.disabled = false;

    // Validación local offline con hash y sal
    const sal = window.db.config.salPin;
    const emp = window.db.empleados.find(x => PRISMA_CORE.pinCoincide(pin, sal, x.pinHash));
    if (emp) {
        if (emp.estado === 'bloqueado') {
            document.getElementById('loginPin').value = '';
            return mostrarAlerta("⛔ Usuario suspendido", "error");
        }
        const rolInfo = window.db.config.roles[emp.rol];
        if (!rolInfo || rolInfo.activo === false) {
            document.getElementById('loginPin').value = '';
            return mostrarAlerta("⛔ Su rol fue desactivado", "error");
        }
        const chDisp = PRISMA_CORE.validarDispositivo(emp, obtenerDeviceId());
        if (!chDisp.ok) {
            document.getElementById('loginPin').value = '';
            return mostrarAlerta("⛔ " + chDisp.error, "error");
        }
        if (chDisp.vincular) {
            emp.dispositivoId = obtenerDeviceId();
            PrismaDB.setDBState(window.db);
            if (navigator.onLine && window.guardarItemEnNube) window.guardarItemEnNube("empleados", emp);
        }
        usuarioActual = { id: emp.id, nombre: `${emp.nombre} ${emp.apellido}`, rol: emp.rol, idSuc: emp.idSuc, protegido: !!emp.protegido };
        intentosFallidos = 0;
        return iniciarSesionExitoso();
    }
    if (PRISMA_CORE.pinCoincide(pin, sal, window.db.config.masterPinHash)) {
        usuarioActual = { id: 'master', nombre: 'Gerencia Master', rol: 'dueño', idSuc: 'todas', isMaster: true };
        intentosFallidos = 0;
        return iniciarSesionExitoso();
    }

    intentosFallidos++;
    document.getElementById('lblIntentos').innerText = intentosFallidos >= 3 ? `⚠️ ${intentosFallidos} intentos fallidos.` : '';
    document.getElementById('loginPin').value = '';
    mostrarAlerta("❌ PIN incorrecto", "error");
}

function chequearLicencia() {
    const est = PRISMA_CORE.licenciaEstado(window.db.config.licencia, hoyISO());
    const aviso = document.getElementById('lblAvisoLicencia');
    if (aviso) aviso.innerText = (est.vencida || (est.dias !== null && est.dias <= 5)) ? '⚠️ Mantenimiento: ' + est.mensaje : '';
    if (est.bloqueado && usuarioActual && usuarioActual.rol !== 'informatico') {
        const lic = window.db.config.licencia;
        document.getElementById('lblBloqueoDetalle').innerText = est.mensaje + ' Venció el ' + (lic.vencimiento || '-') + '.';
        document.getElementById('lblBloqueoTecnico').innerText = lic.tecnico || 'S/D';
        document.getElementById('lblBloqueoContacto').innerText = lic.contacto || 'S/D';
        document.getElementById('lblBloqueoMonto').innerText = formatoGs(lic.monto || 0);
        document.getElementById('modalBloqueo').classList.remove('hidden');
        return true;
    }
    document.getElementById('modalBloqueo').classList.add('hidden');
    return false;
}

const ICONOS = {
    ventas: '🛒 Punto de Venta',
    traslados: '🚚 Logística & Stock',
    sucursales: '🏪 Sucursales',
    proveedores: '🏭 Proveedores',
    deposito: '📦 Catálogo & QR',
    compras: '📥 Compras Stock',
    gastos: '💸 Gastos Operativos',
    clientes: '🤝 Clientes',
    personal: '👥 Personal & Roles',
    caja: '💵 Caja Diaria',
    informes: '📊 Balance & Auditoría',
    informesAvanzados: '📑 Informes Gerenciales',
    sistema: '🛠️ Sistema'
};
const ORDEN_MENU = ['ventas', 'traslados', 'sucursales', 'proveedores', 'deposito', 'compras', 'gastos', 'clientes', 'personal', 'caja', 'informes', 'informesAvanzados', 'sistema'];

function iniciarSesionExitoso() {
    sessionStorage.setItem('prismaSession', JSON.stringify(usuarioActual));
    document.getElementById('modalLogin').classList.add('hidden');
    document.getElementById('loginPin').value = '';
    document.getElementById('lblUsuarioDesktop').innerText = `${usuarioActual.nombre} (${usuarioActual.rol})`;

    const secciones = ORDEN_MENU.filter(s => PRISMA_CORE.puedeVerDB(window.db, usuarioActual.rol, s));
    document.getElementById('menuNavegacion').innerHTML = secciones.map(s => {
        const color = s === 'ventas' ? 'text-teal-400 font-bold'
            : s === 'informes' ? 'text-amber-300 font-bold'
            : s === 'informesAvanzados' ? 'text-cyan-400 font-bold'
            : s === 'sistema' ? 'text-rose-400 font-bold' : 'text-slate-300';
        return `<button onclick="cambiarSeccion('${s}')" class="w-full text-left px-4 py-2.5 rounded-xl mb-1 hover:bg-white/[0.08] flex items-center gap-3 transition-colors ${color}">
            <span class="text-sm">${ICONOS[s]}</span>
        </button>`;
    }).join('');

    if (chequearLicencia()) return;
    if (window.iniciarEscuchaEnVivo && navigator.onLine) window.iniciarEscuchaEnVivo();
    render();
    renderAlertaStockMinimo();
    ejecutarBackupAutomaticoSiCorresponde();
    if (secciones.length) cambiarSeccion(secciones[0]);
}

function cerrarSesion() {
    cerrarModalCambiarPin();
    usuarioActual = null;
    sessionStorage.removeItem('prismaSession');
    document.getElementById('modalBloqueo').classList.add('hidden');
    document.getElementById('modalLogin').classList.remove('hidden');
    document.querySelectorAll('.seccion').forEach(s => s.classList.remove('activa'));
}

function abrirModalCambiarPin() {
    if (!usuarioActual) {
        return mostrarAlerta("❌ Debe iniciar sesión para cambiar el PIN", "error");
    }
    const input = document.getElementById('nuevoPinInput');
    if (input) input.value = '';
    const lbl = document.getElementById('lblCambiarPinUsuario');
    if (lbl) {
        lbl.innerText = `Cambiando PIN para: ${usuarioActual.nombre || 'Usuario actual'} (${usuarioActual.rol || ''})`;
    }
    const modal = document.getElementById('modalCambiarPin');
    if (modal) modal.classList.remove('hidden');
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('-translate-x-full') && window.innerWidth < 768) {
        sidebar.classList.add('-translate-x-full');
    }
    setTimeout(() => { if (input) input.focus(); }, 100);
}

function cerrarModalCambiarPin() {
    const input = document.getElementById('nuevoPinInput');
    if (input) input.value = '';
    const modal = document.getElementById('modalCambiarPin');
    if (modal) modal.classList.add('hidden');
}

async function guardarNuevoPin(e) {
    if (e) e.preventDefault();
    if (!usuarioActual) {
        cerrarModalCambiarPin();
        return mostrarAlerta("❌ Debe iniciar sesión para cambiar el PIN", "error");
    }
    const input = document.getElementById('nuevoPinInput');
    const nuevoPin = (input?.value || '').trim();

    if (!/^\d{4}$/.test(nuevoPin)) {
        return mostrarAlerta("❌ El PIN debe tener exactamente 4 dígitos numéricos", "error");
    }

    const esMaster = !!(usuarioActual.isMaster || usuarioActual.id === 'master');

    if (!esMaster && nuevoPin === '0000') {
        return mostrarAlerta("❌ El PIN 0000 está reservado para la Gerencia Master", "error");
    }
    if (usuarioActual.rol !== 'informatico' && nuevoPin === '6988') {
        return mostrarAlerta("❌ El PIN 6988 está reservado para el Informático", "error");
    }

    const sal = window.db.config.salPin || PRISMA_CORE.generarSal();
    window.db.config.salPin = sal;
    const nuevoHash = PRISMA_CORE.hashPin(nuevoPin, sal);

    const idExcluir = esMaster ? 'master' : usuarioActual.id;
    if (PRISMA_CORE.pinDuplicado(window.db, nuevoPin, idExcluir)) {
        return mostrarAlerta("❌ Ese PIN ya está en uso por otro usuario", "error");
    }

    const btnSubmit = document.getElementById('btnGuardarPin');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
        if (esMaster) {
            window.db.config.masterPinHash = nuevoHash;
            delete window.db.config.masterPin;
            PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'CAMBIAR PIN', 'config', 'PIN de Gerencia Master actualizado');
            if (navigator.onLine && window.db.config.seguridadServidorActiva && window.inicializarSeguridadCloud) {
                try { await window.inicializarSeguridadCloud(sal, nuevoHash); } catch (err) { console.warn(err); }
            }
            if (navigator.onLine && window.guardarConfiguracionEnNube) {
                try { await window.guardarConfiguracionEnNube(); } catch (err) { console.warn(err); }
            }
        } else {
            const emp = window.db.empleados.find(x => x.id === usuarioActual.id);
            if (!emp) {
                return mostrarAlerta("❌ No se encontró el registro del empleado", "error");
            }
            emp.pinHash = nuevoHash;
            delete emp.pin;
            PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'CAMBIAR PIN', 'empleados', `${emp.nombre} ${emp.apellido}`);
            if (navigator.onLine && window.guardarItemEnNube) {
                try { await window.guardarItemEnNube("empleados", emp); } catch (err) { console.warn(err); }
            }
            if (navigator.onLine && window.db.config.seguridadServidorActiva && window.asignarPinSeguro) {
                try { await window.asignarPinSeguro(emp.id, nuevoPin); } catch (err) { console.warn(err); }
            }
        }

        await guardarDB(false);
        cerrarModalCambiarPin();
        mostrarAlerta("🔐 PIN actualizado exitosamente");
    } catch (err) {
        console.error('Error al guardar nuevo PIN:', err);
        mostrarAlerta("❌ Error al guardar el PIN: " + (err.message || 'Error desconocido'), "error");
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
    }
}

function cambiarSeccion(id) {
    if (!usuarioActual) return;
    if (chequearLicencia()) return;
    if (!PRISMA_CORE.puedeVerDB(window.db, usuarioActual.rol, id)) {
        return mostrarAlerta("⛔ Acceso restringido para el rol " + usuarioActual.rol, "error");
    }
    document.querySelectorAll('.seccion').forEach(s => s.classList.remove('activa'));
    const target = document.getElementById(id);
    if (target) target.classList.add('activa');
    if (window.innerWidth < 768) toggleMenu();

    if (id === 'ventas') { vaciarCarrito(); renderizarHistorialFacturas(); verificarEstadoCajaPOS(); }
    if (id === 'traslados') { actualizarProductosTraslado(); renderRemito(); renderRemitos(); renderMovimientos(); renderMatrizStock(); }
    if (id === 'compras') { renderCompraCarrito(); sugerirCostoCompra(); }
    if (id === 'clientes') renderClientes();
    if (id === 'personal') { mostrarAyudaRol(); renderMatrizPermisos(); }
    if (id === 'informes') generarInformesGerenciales();
    if (id === 'informesAvanzados') { window.invSortCol = 'producto'; window.invSortAsc = true; document.getElementById('buscadorInventario').value = ''; generarInformesAvanzados(); }
    if (id === 'caja') { verificarEfectivoCaja(); renderHistorialCaja(); }
    if (id === 'sistema') renderSistema();
}

function toggleMenu() {
    document.getElementById('sidebar').classList.toggle('-translate-x-full');
}

// ==================== PUNTO DE VENTA (BLINDADO) ====================
function vaciarCarrito() {
    carritoActual = [];
    stockTemporal = {};
    const idSuc = document.getElementById('ventaSucursal')?.value;
    const suc = window.db.sucursales.find(s => s.id === idSuc);
    if (suc) {
        window.db.productos.forEach(p => {
            stockTemporal[p.id] = suc.inventario[p.id] || 0;
        });
    }
    limpiarBuscadorPOS();
    renderizarCarrito();
}

function limpiarBuscadorPOS() {
    const b = document.getElementById('ventaBuscadorProd');
    if (!b) return;
    b.value = '';
    document.getElementById('ventaProductoId').value = '';
    document.getElementById('ventaCantidad').value = 1;
    document.getElementById('ventaTotalCalculado').value = '';
    document.getElementById('ventaSugerenciasProd').classList.add('hidden');
}

// Filtrado con bloqueo visual y funcional de productos sin stock
function filtrarProductosPOS() {
    const query = document.getElementById('ventaBuscadorProd').value.toLowerCase();
    const sug = document.getElementById('ventaSugerenciasProd');
    const idSuc = document.getElementById('ventaSucursal').value;
    if (!idSuc) {
        sug.innerHTML = '<div class="p-3 text-xs text-rose-400">Seleccione primero el local</div>';
        sug.classList.remove('hidden');
        return;
    }
    const filtrados = ordenarAlfa(window.db.productos.filter(p =>
        p.nombre.toLowerCase().includes(query) ||
        (p.qrCode && String(p.qrCode).toLowerCase().includes(query)) ||
        (p.detalle || '').toLowerCase().includes(query)
    ), 'nombre');

    let html = '';
    filtrados.slice(0, 25).forEach(p => {
        const disp = stockTemporal[p.id] !== undefined ? stockTemporal[p.id] : PRISMA_CORE.stockEn(window.db, idSuc, p.id);
        const conStock = disp > 0;
        html += `<div onclick="${conStock ? `seleccionarProductoPOS('${p.id}')` : ''}" class="p-3 border-b border-slate-800/60 ${conStock ? 'hover:bg-slate-800/50 cursor-pointer' : 'opacity-40 cursor-not-allowed bg-slate-900/40'}">
            <div class="flex justify-between items-center">
                <b class="text-sm ${conStock ? 'text-white' : 'text-slate-500 line-through'}">${escapeHTML(p.nombre)}</b>
                <span class="badge-apple ${conStock ? 'badge-emerald' : 'badge-rose'}">${conStock ? `Stock: ${disp}` : 'SIN STOCK'}</span>
            </div>
            <p class="text-[11px] text-slate-400 mt-1">${escapeHTML(p.detalle || '')} ${p.categoria ? '· ' + escapeHTML(p.categoria) : ''} · <span class="font-bold text-teal-400">${formatoGs(p.precio)}</span></p>
        </div>`;
    });
    sug.innerHTML = html || '<div class="p-3 text-xs text-slate-400">Sin coincidencias</div>';
    sug.classList.remove('hidden');
}

function seleccionarProductoPOS(id) {
    const p = window.db.productos.find(x => x.id === id);
    if (!p) return;
    const idSuc = document.getElementById('ventaSucursal').value;
    const disp = stockTemporal[p.id] !== undefined ? stockTemporal[p.id] : PRISMA_CORE.stockEn(window.db, idSuc, p.id);

    if (disp <= 0) {
        mostrarAlerta(`⛔ BLOQUEADO: "${p.nombre}" no tiene stock en este local`, "error");
        return;
    }

    document.getElementById('ventaProductoId').value = p.id;
    document.getElementById('ventaBuscadorProd').value = p.nombre;
    document.getElementById('ventaSugerenciasProd').classList.add('hidden');
    const inputCant = document.getElementById('ventaCantidad');
    inputCant.max = disp;
    inputCant.value = 1;
    actualizarPrecioVenta();
}

function actualizarPrecioVenta() {
    const idProd = document.getElementById('ventaProductoId')?.value;
    const cantInput = document.getElementById('ventaCantidad');
    let cant = parseInt(cantInput?.value) || 1;
    const p = window.db.productos.find(x => x.id === idProd);
    if (!p) {
        document.getElementById('ventaTotalCalculado').value = '';
        return;
    }
    const idSuc = document.getElementById('ventaSucursal').value;
    const disp = stockTemporal[p.id] !== undefined ? stockTemporal[p.id] : PRISMA_CORE.stockEn(window.db, idSuc, p.id);

    if (cant > disp) {
        cant = Math.max(1, disp);
        cantInput.value = cant;
        mostrarAlerta(`⚠️ Ajustado al máximo stock disponible (${disp})`, "error");
    }
    document.getElementById('ventaTotalCalculado').value = formatoGs(p.precio * cant);
}

function agregarItemAlCarrito(e) {
    e.preventDefault();
    if (!exigir('vender')) return;
    const idSuc = document.getElementById('ventaSucursal').value;
    if (!idSuc) return mostrarAlerta("❌ Seleccione el local", "error");
    if (!PRISMA_CORE.sucursalPermitida(usuarioActual, idSuc)) return mostrarAlerta("⛔ Sólo puede vender en su sucursal", "error");
    const idProd = document.getElementById('ventaProductoId').value;
    const cant = parseInt(document.getElementById('ventaCantidad').value);
    const p = window.db.productos.find(x => x.id === idProd);
    if (!p) return mostrarAlerta("❌ Elija un producto de la lista", "error");
    if (!(cant > 0)) return mostrarAlerta("❌ Cantidad inválida", "error");

    const disp = stockTemporal[idProd] !== undefined ? stockTemporal[idProd] : PRISMA_CORE.stockEn(window.db, idSuc, idProd);
    if (disp <= 0) {
        return mostrarAlerta(`⛔ VENTA BLOQUEADA: "${p.nombre}" no tiene stock disponible`, "error");
    }
    if (disp < cant) {
        return mostrarAlerta(`⛔ Stock insuficiente de "${p.nombre}" (disponible: ${disp})`, "error");
    }

    stockTemporal[idProd] = disp - cant;
    const ex = carritoActual.find(i => i.idProd === idProd);
    if (ex) {
        ex.cant += cant;
        ex.subtotal = ex.cant * ex.precioUnit;
    } else {
        carritoActual.push({ idProd, nombre: p.nombre, cant, precioUnit: p.precio, subtotal: p.precio * cant });
    }
    limpiarBuscadorPOS();
    renderizarCarrito();
    mostrarAlerta(`✓ Agregado: ${p.nombre} (x${cant})`);
}

function quitarDelCarrito(i) {
    const it = carritoActual[i];
    if (!it) return;
    stockTemporal[it.idProd] = (stockTemporal[it.idProd] || 0) + it.cant;
    carritoActual.splice(i, 1);
    renderizarCarrito();
}

function renderizarCarrito() {
    const tbody = document.getElementById('grillaCarritoBody');
    if (!tbody) return;
    let suma = 0;
    tbody.innerHTML = carritoActual.map((it, idx) => {
        suma += it.subtotal;
        return `<tr class="border-b border-slate-800/40 hover:bg-white/[0.02]">
            <td class="p-3 font-bold text-center tabular-nums">${it.cant}</td>
            <td class="p-3 font-medium text-white">${escapeHTML(it.nombre)}</td>
            <td class="p-3 text-right tabular-nums text-slate-300">${formatoGs(it.precioUnit)}</td>
            <td class="p-3 text-right font-black text-emerald-400 tabular-nums">${formatoGs(it.subtotal)}</td>
            <td class="p-3 text-center">
                <button onclick="quitarDelCarrito(${idx})" class="p-1 text-rose-400 hover:text-rose-300 font-bold transition-transform active:scale-95">✕</button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" class="p-8 text-center text-slate-500 text-sm">El carrito está vacío</td></tr>';

    document.getElementById('lblTotalNumeroCarrito').innerText = formatoGs(suma);
    document.getElementById('lblTotalLetrasCarrito').innerText = suma > 0 ? numeroALetras(suma) : '';
    const btn = document.getElementById('btnPrepararFactura');
    const cajaOk = cajaAbierta(document.getElementById('ventaSucursal')?.value);
    btn.disabled = carritoActual.length === 0 || !cajaOk;
}

function cajaAbierta(idSuc) {
    const c = window.db.caja[idSuc];
    return !!(c && c.estado === 'abierta');
}

// Verificación atómica antes de previsualizar la factura
function prepararVenta() {
    if (!exigir('vender')) return;
    if (!carritoActual.length) return mostrarAlerta("❌ Carrito vacío", "error");
    const idSuc = document.getElementById('ventaSucursal').value;
    if (!cajaAbierta(idSuc)) return mostrarAlerta("❌ La caja está cerrada", "error");
    if (!document.getElementById('ventaVendedor').value) return mostrarAlerta("❌ Seleccione el vendedor", "error");
    const idCliente = document.getElementById('ventaCliente').value, cli = window.db.clientes.find(c => c.id === idCliente);
    if (!cli) return mostrarAlerta("❌ Seleccione un cliente", "error");

    const v = PRISMA_CORE.validarVenta(window.db, idSuc, carritoActual);
    if (!v.ok) {
        mostrarAlerta("⛔ " + v.error, "error");
        return;
    }

    const suc = window.db.sucursales.find(s => s.id === idSuc);
    const vendText = document.getElementById('ventaVendedor').options[document.getElementById('ventaVendedor').selectedIndex]?.text || 'Vendedor';
    let suma = 0, htmlGrilla = '';
    carritoActual.forEach(i => {
        suma += i.subtotal;
        htmlGrilla += `<tr class="border-b border-dashed border-slate-700 text-sm">
            <td class="py-2 tabular-nums">${i.cant}</td>
            <td class="py-2">${escapeHTML(i.nombre)}</td>
            <td class="py-2 text-right tabular-nums">${formatoGs(i.precioUnit)}</td>
            <td class="py-2 text-right font-bold tabular-nums">${formatoGs(i.subtotal)}</td>
        </tr>`;
    });
    document.getElementById('facVistaSucursal').innerText = suc.nombre;
    document.getElementById('facVistaVendedor').innerText = vendText;
    document.getElementById('facVistaFecha').innerText = new Date().toLocaleString('es-PY');
    document.getElementById('facVistaCondicion').innerText = document.getElementById('ventaPago').value.toUpperCase();
    document.getElementById('facVistaCliente').innerText = `${cli.nombre} ${cli.apellido}`;
    document.getElementById('facVistaRuc').innerText = cli.doc;
    document.getElementById('facVistaDir').innerText = cli.direccion || 'S/D';
    document.getElementById('facVistaGrilla').innerHTML = htmlGrilla;
    document.getElementById('facVistaLetras').innerText = numeroALetras(suma);
    document.getElementById('facVistaTotalNum').innerText = formatoGs(suma);
    document.getElementById('modalFactura').classList.remove('hidden');
}

function cerrarModalFactura() {
    document.getElementById('modalFactura').classList.add('hidden');
}

// Procesamiento blindado de la venta
async function procesarVentaReal(formato) {
    const idSuc = document.getElementById('ventaSucursal').value;
    const aplica = PRISMA_CORE.aplicarVenta(window.db, idSuc, carritoActual);
    if (!aplica.ok) {
        cerrarModalFactura();
        return mostrarAlerta("⛔ " + aplica.error, "error");
    }

    const suc = window.db.sucursales.find(s => s.id === idSuc);
    const idVend = document.getElementById('ventaVendedor').value;
    const vendText = document.getElementById('ventaVendedor').options[document.getElementById('ventaVendedor').selectedIndex]?.text || 'Vendedor';
    const emp = window.db.empleados.find(e => e.id === idVend);
    const idCli = document.getElementById('ventaCliente').value, cli = window.db.clientes.find(c => c.id === idCli);
    const pago = document.getElementById('ventaPago').value, fechaAct = new Date().toLocaleString('es-PY'), grupoTk = genID();
    const ahoraVenta = Date.now();
    const fe = window.db.config.facturacionElectronica;
    let numeroLegal = '', cdc = '';
    if (fe && fe.habilitada) {
        numeroLegal = PRISMA_CORE.proximoNumeroLegal(window.db);
        cdc = PRISMA_CORE.generarCDC(window.db, numeroLegal, cli.doc, hoyISO());
        PRISMA_CORE.registrarNumeroLegalUsado(window.db);
    }
    let totalFac = 0;
    const nuevas = [];
    carritoActual.forEach(i => {
        totalFac += i.subtotal;
        const nV = {
            id: genID(), idGrupoTicket: grupoTk, idSuc, idProd: i.idProd, cant: i.cant, pago,
            idCliente: idCli, total: i.subtotal, fecha: fechaAct, timestamp: ahoraVenta, nombreProd: i.nombre,
            nombreSuc: suc.nombre, nombreCliente: `${cli.nombre} ${cli.apellido}`,
            vendedor: vendText, precioUnit: i.precioUnit, idVendedor: idVend, numeroLegal, cdc
        };
        window.db.ventas.unshift(nV);
        nuevas.push(nV);
    });
    if (pago === 'Crédito') cli.deuda = (cli.deuda || 0) + totalFac;
    if (emp) {
        emp.ventasTotal = (emp.ventasTotal || 0) + totalFac;
        emp.comisionAcumulada = (emp.comisionAcumulada || 0) + Math.round(totalFac * (emp.comision || 0) / 100);
    }

    const copiaCarrito = carritoActual.slice();
    await guardarDB(false);

    if (navigator.onLine && window.guardarVentaEnNube) {
        nuevas.forEach(v => window.guardarVentaEnNube(v));
        window.guardarItemEnNube("sucursales", suc);
        window.guardarItemEnNube("clientes", cli);
        if (emp) window.guardarItemEnNube("empleados", emp);
    }

    cerrarModalFactura();
    imprimirComprobanteVenta(formato, {
        fecha: fechaAct, suc: suc.nombre, vend: vendText, cli, pago,
        items: copiaCarrito, total: totalFac, titulo: 'FACTURA', numeroLegal, cdc
    });
    carritoActual = [];
    render();
    vaciarCarrito();
    renderizarHistorialFacturas();
    mostrarAlerta("✅ Venta registrada y stock actualizado");
}

function moldeFacturaHTML(d) {
    return `<div style="border:2px solid #000;padding:14px;background:#fff;color:#000">
        <div style="display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:8px">
            <div><h2 style="margin:0;font-size:18px;font-weight:900">PUNTO PRISMA</h2><p style="margin:0;font-size:11px">SUCURSAL: ${escapeHTML(d.suc)}</p><p style="margin:0;font-size:11px">VENDEDOR: ${escapeHTML(d.vend)}</p></div>
            <div style="text-align:right"><h3 style="margin:0;font-size:14px">${escapeHTML(d.titulo)}</h3><p style="margin:0;font-size:11px">FECHA: ${escapeHTML(d.fecha)}</p><p style="margin:0;font-size:11px">CONDICIÓN: ${escapeHTML(String(d.pago).toUpperCase())}</p></div>
        </div>
        ${d.numeroLegal ? `<div style="font-size:11px;margin-bottom:8px;background:#f0fdf4;border:1px solid #16a34a;padding:6px;border-radius:4px"><b>FACTURA ELECTRÓNICA Nº:</b> ${escapeHTML(d.numeroLegal)} &nbsp; <b>CDC:</b> ${escapeHTML(d.cdc)}</div>` : ''}
        <div style="font-size:11px;margin-bottom:8px"><b>CLIENTE:</b> ${escapeHTML(d.cli.nombre + ' ' + d.cli.apellido)} &nbsp; <b>DOC:</b> ${escapeHTML(d.cli.doc || 'S/D')} &nbsp; <b>DIR:</b> ${escapeHTML(d.cli.direccion || 'S/D')} &nbsp; <b>TEL:</b> ${escapeHTML(d.cli.tel || 'S/D')}</div>
        <table style="${estiloTabla}"><thead><tr><th style="${th}">CANT</th><th style="${th}">DESCRIPCIÓN</th><th style="${th}">P. UNIT</th><th style="${th}">SUBTOTAL</th></tr></thead>
        <tbody>${d.items.map(i => `<tr><td style="${td}">${i.cant}</td><td style="${td}">${escapeHTML(i.nombre)}</td><td style="${td};text-align:right">${formatoGs(i.precioUnit)}</td><td style="${td};text-align:right">${formatoGs(i.subtotal)}</td></tr>`).join('')}</tbody></table>
        <div style="display:flex;justify-content:space-between;margin-top:10px;border-top:2px solid #000;padding-top:8px">
            <div style="font-size:10px;max-width:60%"><b>TOTAL EN LETRAS:</b><br>${numeroALetras(d.total)}</div>
            <div style="text-align:right"><p style="margin:0;font-size:10px">TOTAL GENERAL</p><p style="margin:0;font-size:20px;font-weight:900">${formatoGs(d.total)}</p></div>
        </div></div>`;
}

function imprimirComprobanteVenta(formato, d) {
    const area = document.getElementById('areaFactura');
    if (formato === 'ticket') {
        area.innerHTML = `<div style="font-family:monospace;font-size:11px;background:#fff;color:#000"><p style="text-align:center;font-weight:bold">PUNTO PRISMA<br>${escapeHTML(d.suc)}</p><p>${escapeHTML(d.fecha)}<br>Vend: ${escapeHTML(d.vend)}<br>Cli: ${escapeHTML(d.cli.nombre + ' ' + d.cli.apellido)}<br>Cond: ${escapeHTML(d.pago)}</p><hr>${d.items.map(i => `<p style="margin:2px 0">${i.cant} x ${escapeHTML(i.nombre)}<br><span style="float:right">${formatoGs(i.subtotal)}</span></p>`).join('')}<hr><p style="font-weight:bold">TOTAL: ${formatoGs(d.total)}</p><p style="font-size:9px">${numeroALetras(d.total)}</p><p style="text-align:center">¡Gracias por su compra!</p></div>`;
        document.body.classList.remove('modo-factura');
        document.body.classList.add('modo-ticket');
    } else {
        area.innerHTML = moldeFacturaHTML(d);
        document.body.classList.remove('modo-ticket');
        document.body.classList.add('modo-factura');
    }
    setTimeout(() => {
        window.print();
        document.body.classList.remove('modo-factura', 'modo-ticket');
    }, 250);
}

function agruparVentas(lista) {
    const grupos = new Map();
    lista.forEach(v => {
        const key = v.idGrupoTicket || (v.fecha + '_' + v.idCliente);
        if (!grupos.has(key)) grupos.set(key, { idGrp: key, fecha: v.fecha, idSuc: v.idSuc, nombreSuc: v.nombreSuc, cliente: v.nombreCliente, idCliente: v.idCliente, vendedor: v.vendedor, pago: v.pago, total: 0, items: [] });
        const g = grupos.get(key);
        g.total += v.total;
        g.items.push(v);
    });
    return Array.from(grupos.values());
}

function renderizarHistorialFacturas() {
    const idSuc = document.getElementById('ventaSucursal')?.value, cont = document.getElementById('grillaReimpresionBody');
    if (!cont) return;
    if (!idSuc) return cont.innerHTML = '<p class="text-xs text-slate-400">Seleccione un local.</p>';
    const grupos = agruparVentas(window.db.ventas.filter(v => v.idSuc === idSuc && !v.esCobroDeuda)).slice(0, 15);
    cont.innerHTML = grupos.map(g => `<div class="bg-slate-900/60 border border-slate-800 p-2.5 rounded-xl text-xs flex flex-col gap-1.5">
        <div class="flex justify-between items-center"><b class="text-white">${escapeHTML(g.fecha)}</b><b class="text-emerald-400 tabular-nums">${formatoGs(g.total)}</b></div>
        <p class="text-slate-400">${escapeHTML(g.cliente)} · ${g.items.length} ítem(s)</p>
        <div class="flex gap-1.5 mt-1">
            <button onclick="verFacturaEnPantalla('${g.idGrp}')" class="btn-apple btn-apple-secondary text-[10px] py-1 px-2.5 flex-1">👁️ Ver</button>
            <button onclick="lanzarReimpresion('${g.idGrp}','factura')" class="btn-apple btn-apple-indigo text-[10px] py-1 px-2.5 flex-1">📄 A4</button>
            <button onclick="lanzarReimpresion('${g.idGrp}','ticket')" class="btn-apple btn-apple-secondary text-[10px] py-1 px-2.5 flex-1">🧾 Ticket</button>
        </div></div>`).join('') || '<p class="text-xs text-slate-500">Sin facturas en este local.</p>';
}

function datosFactura(idGrp) {
    const items = window.db.ventas.filter(v => (v.idGrupoTicket === idGrp) || ((v.fecha + '_' + v.idCliente) === idGrp));
    if (!items.length) return null;
    const info = items[0];
    const cli = window.db.clientes.find(c => c.id === info.idCliente) || { nombre: info.nombreCliente || 'S/D', apellido: '', doc: 'S/D', direccion: 'S/D', tel: '' };
    let total = 0;
    const its = items.map(i => { total += i.total; return { cant: i.cant, nombre: i.nombreProd, precioUnit: i.precioUnit, subtotal: i.total }; });
    return { fecha: info.fecha, suc: info.nombreSuc, vend: info.vendedor, cli, pago: info.pago, items: its, total, titulo: 'FACTURA (REIMPRESIÓN)', numeroLegal: info.numeroLegal || '', cdc: info.cdc || '' };
}

function lanzarReimpresion(idGrp, formato) {
    const d = datosFactura(idGrp);
    if (!d) return mostrarAlerta("❌ Factura no encontrada", "error");
    imprimirComprobanteVenta(formato, d);
}

function verFacturaEnPantalla(idGrp) {
    const d = datosFactura(idGrp);
    if (!d) return mostrarAlerta("❌ Factura no encontrada", "error");
    abrirDetalle('🧾 Factura ' + d.fecha, moldeFacturaHTML(d), 'Factura ' + escapeHTML(d.cli.nombre));
}

function actualizarVendedoresSucursal() {
    const selSuc = document.getElementById('ventaSucursal'), selVend = document.getElementById('ventaVendedor');
    if (!selVend || !selSuc) return;
    if (!PRISMA_CORE.esAdmin(usuarioActual.rol) && !usuarioActual.isMaster) {
        selSuc.value = usuarioActual.idSuc;
        selSuc.disabled = true;
        selVend.innerHTML = `<option value="${usuarioActual.id}">${escapeHTML(usuarioActual.nombre)}</option>`;
        selVend.disabled = true;
    } else {
        selSuc.disabled = false;
        selVend.disabled = false;
        const idSuc = selSuc.value;
        if (!idSuc) return selVend.innerHTML = '<option value="">-- Elija un local --</option>';
        const emps = window.db.empleados.filter(e => e.idSuc === idSuc && e.estado !== 'bloqueado' && PRISMA_CORE.puedeDB(window.db, e.rol, 'vender'));
        selVend.innerHTML = '<option value="">-- Seleccione vendedor --</option>' + emps.map(e => `<option value="${e.id}">${escapeHTML(e.nombre + ' ' + e.apellido)} (${e.rol})</option>`).join('');
    }
}

function procesarEscaneoQR(qr) {
    if (!qr) return;
    const p = window.db.productos.find(x => x.id === qr || x.qrCode === qr || x.nombre === String(qr).toUpperCase());
    if (!p) {
        mostrarAlerta("❌ Código no encontrado", "error");
    } else {
        const idSuc = document.getElementById('ventaSucursal').value;
        const disp = stockTemporal[p.id] !== undefined ? stockTemporal[p.id] : PRISMA_CORE.stockEn(window.db, idSuc, p.id);
        if (disp > 0) {
            seleccionarProductoPOS(p.id);
            mostrarAlerta(`✓ ${p.nombre} (Stock: ${disp})`);
        } else {
            mostrarAlerta(`⛔ SIN STOCK: "${p.nombre}" no disponible`, "error");
        }
    }
    detenerEscannerQR();
    document.getElementById('inputEscaneoQR').value = '';
}

function iniciarEscannerCamaraReal() {
    document.getElementById('modalEscanerQR').classList.remove('hidden');
    try {
        html5QrCode = new Html5Qrcode("reader");
        html5QrCode.start({ facingMode: "environment" }, { fps: 15, qrbox: { width: 250, height: 150 } }, txt => procesarEscaneoQR(txt), () => { });
    } catch (e) {
        detenerEscannerQR();
    }
}
function detenerEscannerQR() {
    try { if (html5QrCode) html5QrCode.stop(); } catch (e) { }
    document.getElementById('modalEscanerQR').classList.add('hidden');
}

// ==================== LOGÍSTICA / REMITOS (BLINDADOS) ====================
function vaciarRemito() {
    remitoActual = [];
    renderRemito();
}

function agregarItemRemito(e) {
    e.preventDefault();
    if (!exigir('crearTraslado')) return;
    const origen = document.getElementById('trasOrigen').value, idProd = document.getElementById('trasProducto').value;
    const cant = parseInt(document.getElementById('trasCantidad').value);
    const p = window.db.productos.find(x => x.id === idProd);
    if (!p) return mostrarAlerta("❌ Seleccione un producto", "error");
    if (!(cant > 0)) return mostrarAlerta("❌ Cantidad inválida", "error");

    const stockActual = PRISMA_CORE.stockEn(window.db, origen, idProd);
    if (stockActual <= 0) {
        return mostrarAlerta(`⛔ REMITO BLOQUEADO: "${p.nombre}" no tiene stock en origen`, "error");
    }
    const yaCargado = remitoActual.filter(i => i.idProd === idProd).reduce((a, b) => a + b.cant, 0);
    if (stockActual < yaCargado + cant) {
        return mostrarAlerta(`⛔ Stock insuficiente de "${p.nombre}" (disponible: ${stockActual - yaCargado})`, "error");
    }

    const ex = remitoActual.find(i => i.idProd === idProd);
    if (ex) ex.cant += cant; else remitoActual.push({ idProd, nombre: p.nombre, cant });
    document.getElementById('trasCantidad').value = 1;
    renderRemito();
}

function quitarItemRemito(i) {
    remitoActual.splice(i, 1);
    renderRemito();
}

function renderRemito() {
    const t = document.getElementById('grillaRemitoBody');
    if (!t) return;
    t.innerHTML = remitoActual.map((i, idx) => `<tr class="border-b border-slate-800/40">
        <td class="py-1.5 font-bold tabular-nums">${i.cant}</td>
        <td class="py-1.5 text-white">${escapeHTML(i.nombre)}</td>
        <td class="py-1.5 text-right"><button onclick="quitarItemRemito(${idx})" class="text-rose-400 font-bold hover:text-rose-300">✕</button></td>
    </tr>`).join('') || '<tr><td colspan="3" class="py-4 text-center text-slate-500">Remito vacío</td></tr>';

    document.getElementById('lblRemitoResumen').innerText = remitoActual.length
        ? `${remitoActual.length} ítem(s) · ${remitoActual.reduce((a, b) => a + b.cant, 0)} unidad(es)`
        : '';
    document.getElementById('btnEnviarRemito').disabled = remitoActual.length === 0;
}

function actualizarProductosTraslado() {
    const origId = document.getElementById('trasOrigen')?.value, sel = document.getElementById('trasProducto');
    if (!sel) return;
    const suc = window.db.sucursales.find(s => s.id === origId);
    let opts = '';
    if (suc) {
        ordenarAlfa(window.db.productos.filter(p => (suc.inventario[p.id] || 0) > 0), 'nombre').forEach(p => {
            opts += `<option value="${p.id}">${escapeHTML(p.nombre)} (Disp: ${suc.inventario[p.id]})</option>`;
        });
    }
    sel.innerHTML = opts || '<option value="">Sin productos con stock en origen</option>';
}

async function crearTraslado() {
    if (!exigir('crearTraslado')) return;
    const origen = document.getElementById('trasOrigen').value, destino = document.getElementById('trasDestino').value;
    const remito = {
        id: genID(), nroRemito: PRISMA_CORE.proximoNro('R-', window.db.traslados, 'nroRemito'),
        origen, destino, items: remitoActual.map(i => ({ idProd: i.idProd, nombre: i.nombre, cant: i.cant })),
        estado: 'En Tránsito', fecha: new Date().toLocaleString('es-PY'), usuario: usuarioActual.nombre,
        recibidoPor: '', fechaRecepcion: ''
    };
    const r = PRISMA_CORE.aplicarSalidaRemito(window.db, remito);
    if (!r.ok) return mostrarAlerta("⛔ " + r.error, "error");

    window.db.traslados.unshift(remito);
    await guardarDB(false);

    if (navigator.onLine && window.guardarItemEnNube) {
        await window.guardarItemEnNube("traslados", remito);
        await window.guardarItemEnNube("sucursales", window.db.sucursales.find(s => s.id === origen));
    }
    vaciarRemito();
    render();
    mostrarAlerta(`🚚 Remito ${remito.nroRemito} en tránsito`);
    imprimirRemito(remito.id);
}

window.recibirTraslado = async function (id) {
    if (!exigir('recibirTraslado')) return;
    const t = window.db.traslados.find(x => x.id === id);
    const r = PRISMA_CORE.aplicarEntradaRemito(window.db, t);
    if (!r.ok) return mostrarAlerta("❌ " + r.error, "error");
    t.recibidoPor = usuarioActual.nombre;
    t.fechaRecepcion = new Date().toLocaleString('es-PY');
    await guardarDB(false);
    if (navigator.onLine && window.guardarItemEnNube) {
        await window.guardarItemEnNube("traslados", t);
        await window.guardarItemEnNube("sucursales", window.db.sucursales.find(s => s.id === t.destino));
    }
    render();
    mostrarAlerta("✅ Remito " + t.nroRemito + " recibido con éxito");
};

function cuerpoRemitoHTML(t) {
    return `<table style="${estiloTabla};margin-bottom:10px"><tbody>
        <tr><td style="${td}"><b>Remito Nº</b></td><td style="${td}">${escapeHTML(t.nroRemito)}</td><td style="${td}"><b>Estado</b></td><td style="${td}">${escapeHTML(t.estado)}</td></tr>
        <tr><td style="${td}"><b>Origen</b></td><td style="${td}">${escapeHTML(nombreSuc(t.origen))}</td><td style="${td}"><b>Destino</b></td><td style="${td}">${escapeHTML(nombreSuc(t.destino))}</td></tr>
        <tr><td style="${td}"><b>Envío</b></td><td style="${td}">${escapeHTML(t.fecha)}</td><td style="${td}"><b>Responsable</b></td><td style="${td}">${escapeHTML(t.usuario || 'S/D')}</td></tr>
        <tr><td style="${td}"><b>Recepción</b></td><td style="${td}">${escapeHTML(t.fechaRecepcion || '-')}</td><td style="${td}"><b>Recibido por</b></td><td style="${td}">${escapeHTML(t.recibidoPor || '-')}</td></tr></tbody></table>
        <table style="${estiloTabla}"><thead><tr><th style="${th}">#</th><th style="${th}">Producto</th><th style="${th}">Detalle</th><th style="${th}">Cantidad</th><th style="${th}">Conforme</th></tr></thead><tbody>
        ${t.items.map((i, n) => { const p = window.db.productos.find(x => x.id === i.idProd) || {}; return `<tr><td style="${td}">${n + 1}</td><td style="${td}">${escapeHTML(i.nombre || nombreProd(i.idProd))}</td><td style="${td}">${escapeHTML(p.detalle || '')}</td><td style="${td};text-align:center;font-weight:bold">${i.cant}</td><td style="${td};width:60px"></td></tr>`; }).join('')}
        <tr><td style="${td}" colspan="3"><b>TOTAL DE UNIDADES</b></td><td style="${td};text-align:center;font-weight:bold">${t.items.reduce((a, b) => a + b.cant, 0)}</td><td style="${td}"></td></tr></tbody></table>
        <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:11px"><div style="border-top:1px solid #000;width:200px;text-align:center">Entregué conforme</div><div style="border-top:1px solid #000;width:200px;text-align:center">Recibí conforme</div></div>`;
}
function verRemito(id) { const t = window.db.traslados.find(x => x.id === id); if (t) abrirDetalle('🚚 Remito ' + t.nroRemito, cuerpoRemitoHTML(t), nombreSuc(t.origen) + ' → ' + nombreSuc(t.destino)); }
function imprimirRemito(id) { const t = window.db.traslados.find(x => x.id === id); if (t) imprimirA4('REMITO DE TRASLADO ' + t.nroRemito, cuerpoRemitoHTML(t), nombreSuc(t.origen) + ' → ' + nombreSuc(t.destino)); }

function renderRemitos() {
    const cont = document.getElementById('listaTraslados');
    if (!cont) return;
    const filtro = document.getElementById('filtroRemitoEstado')?.value || 'TODOS';
    const lista = window.db.traslados.filter(t => filtro === 'TODOS' || t.estado === filtro);
    cont.innerHTML = lista.map(t => `<div class="card-apple p-3 flex justify-between items-center gap-3 flex-wrap">
        <div class="cursor-pointer" onclick="verRemito('${t.id}')">
            <div class="flex items-center gap-2">
                <b class="text-white">${escapeHTML(t.nroRemito)}</b>
                <span class="badge-apple ${t.estado === 'Recibido' ? 'badge-emerald' : 'badge-amber'}">${escapeHTML(t.estado)}</span>
            </div>
            <p class="text-xs text-slate-400 mt-1">${escapeHTML(nombreSuc(t.origen))} ➔ ${escapeHTML(nombreSuc(t.destino))}</p>
            <p class="text-[11px] text-slate-500">${escapeHTML(t.fecha)} · ${t.items.length} ítem(s) · ${t.items.reduce((a, b) => a + b.cant, 0)} u. · ${escapeHTML(t.usuario || '')}</p>
        </div>
        <div class="flex gap-1.5 items-center">
            <button onclick="verRemito('${t.id}')" class="btn-apple btn-apple-secondary text-xs py-1.5 px-3">👁️ Ver</button>
            <button onclick="imprimirRemito('${t.id}')" class="btn-apple btn-apple-secondary text-xs py-1.5 px-3">🖨️ A4</button>
            ${t.estado === 'En Tránsito'
                ? `<button onclick="recibirTraslado('${t.id}')" class="btn-apple btn-apple-primary text-xs py-1.5 px-3">Recibir</button>`
                : `<span class="text-emerald-400 font-bold text-xs px-2">✔ Recibido</span>`}
        </div></div>`).join('') || '<p class="text-xs text-slate-500">Sin remitos registrados.</p>';
}

function renderMatrizStock() {
    const head = document.getElementById('matrizStockHead'), body = document.getElementById('matrizStockBody');
    if (!head || !body) return;
    const q = (document.getElementById('buscadorMatrizStock')?.value || '').toLowerCase();
    head.innerHTML = `<tr><th class="p-2.5 text-left">Producto</th>${window.db.sucursales.map(s => `<th class="p-2.5 text-center">${escapeHTML(s.nombre)}</th>`).join('')}<th class="p-2.5 text-center">TOTAL</th></tr>`;
    const prods = ordenarAlfa(window.db.productos.filter(p => p.nombre.toLowerCase().includes(q)), 'nombre');
    body.innerHTML = prods.map(p => {
        const total = PRISMA_CORE.stockTotal(window.db, p.id);
        const alerta = total <= (p.stockMin || 0) ? 'text-rose-400 font-black' : 'text-emerald-400 font-bold';
        return `<tr class="border-b border-slate-800/40 hover:bg-white/[0.02]">
            <td class="p-2.5 font-medium text-white">${escapeHTML(p.nombre)}</td>
            ${window.db.sucursales.map(s => `<td class="p-2.5 text-center tabular-nums text-slate-300">${s.inventario[p.id] || 0}</td>`).join('')}
            <td class="p-2.5 text-center tabular-nums ${alerta}">${total}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="10" class="p-6 text-center text-slate-500">Sin productos</td></tr>';
}

function imprimirMatrizStock() {
    const prods = ordenarAlfa(window.db.productos, 'nombre');
    const cuerpo = `<table style="${estiloTabla}"><thead><tr><th style="${th}">Producto</th>${window.db.sucursales.map(s => `<th style="${th}">${escapeHTML(s.nombre)}</th>`).join('')}<th style="${th}">TOTAL</th></tr></thead><tbody>
        ${prods.map(p => `<tr><td style="${td}">${escapeHTML(p.nombre)}</td>${window.db.sucursales.map(s => `<td style="${td};text-align:center">${s.inventario[p.id] || 0}</td>`).join('')}<td style="${td};text-align:center;font-weight:bold">${PRISMA_CORE.stockTotal(window.db, p.id)}</td></tr>`).join('')}</tbody></table>`;
    imprimirA4('STOCK POR SUCURSAL (orden alfabético)', cuerpo, window.db.sucursales.length + ' sucursales');
}

function movimientosFiltrados() {
    const suc = document.getElementById('filtroMovSucursal')?.value || 'TODAS';
    const tipo = document.getElementById('filtroMovTipo')?.value || 'TODOS';
    const q = (document.getElementById('buscadorMovimientos')?.value || '').toLowerCase();
    return PRISMA_CORE.construirMovimientos(window.db)
        .filter(m => (suc === 'TODAS' || m.idSuc === suc) && (tipo === 'TODOS' || m.tipo === tipo) && (!q || String(m.producto).toLowerCase().includes(q)))
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

function renderMovimientos() {
    const body = document.getElementById('grillaMovimientosBody');
    if (!body) return;
    const colores = { 'COMPRA': 'text-emerald-400', 'VENTA': 'text-rose-400', 'TRASLADO-SALIDA': 'text-amber-400', 'TRASLADO-ENTRADA': 'text-cyan-400' };
    const movs = movimientosFiltrados();
    body.innerHTML = movs.slice(0, 300).map(m => `<tr class="border-b border-slate-800/40 hover:bg-white/[0.02]">
        <td class="p-2.5 text-slate-400 text-xs">${escapeHTML(m.fecha)}</td>
        <td class="p-2.5 font-bold ${colores[m.tipo] || 'text-slate-300'}">${m.tipo}</td>
        <td class="p-2.5 text-slate-300">${escapeHTML(m.sucursal)}</td>
        <td class="p-2.5 text-white">${escapeHTML(m.producto)}</td>
        <td class="p-2.5 text-center font-bold tabular-nums ${m.signo > 0 ? 'text-emerald-400' : 'text-rose-400'}">${m.signo > 0 ? '+' : '-'}${m.cant}</td>
        <td class="p-2.5 text-slate-400 text-xs">${escapeHTML(m.doc || '')}</td>
        <td class="p-2.5 text-slate-400 text-xs">${escapeHTML(m.responsable || '')}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="p-8 text-center text-slate-500">Sin movimientos registrados</td></tr>';
}

function imprimirMovimientos() {
    const movs = movimientosFiltrados();
    const cuerpo = `<table style="${estiloTabla}"><thead><tr><th style="${th}">Fecha</th><th style="${th}">Tipo</th><th style="${th}">Sucursal</th><th style="${th}">Producto</th><th style="${th}">Cant.</th><th style="${th}">Documento</th><th style="${th}">Responsable</th></tr></thead><tbody>
        ${movs.map(m => `<tr><td style="${td}">${escapeHTML(m.fecha)}</td><td style="${td}">${m.tipo}</td><td style="${td}">${escapeHTML(m.sucursal)}</td><td style="${td}">${escapeHTML(m.producto)}</td><td style="${td};text-align:center">${m.signo > 0 ? '+' : '-'}${m.cant}</td><td style="${td}">${escapeHTML(m.doc || '')}</td><td style="${td}">${escapeHTML(m.responsable || '')}</td></tr>`).join('')}</tbody></table>`;
    imprimirA4('LIBRO DE MOVIMIENTOS DE STOCK', cuerpo, movs.length + ' movimientos');
}

// ==================== DETALLE UNIVERSAL ====================
function abrirDetalle(titulo, html, subtitulo) {
    detalleActual = { titulo, html, subtitulo };
    document.getElementById('tituloDetalle').innerText = titulo;
    document.getElementById('cuerpoDetalle').innerHTML = html;
    document.getElementById('modalDetalle').classList.remove('hidden');
}
function cerrarDetalle() {
    document.getElementById('modalDetalle').classList.add('hidden');
}
function imprimirDetalleActual() {
    if (detalleActual) imprimirA4(detalleActual.titulo, detalleActual.html, detalleActual.subtitulo);
}

// ==================== SUCURSALES ====================
async function agregarSucursal(e) {
    e.preventDefault();
    if (!exigir('gestionarSucursales')) return;
    const nombre = document.getElementById('sucNombre').value.trim().toUpperCase();
    if (!nombre) return mostrarAlerta("❌ Nombre obligatorio", "error");
    if (PRISMA_CORE.nombreDuplicado(window.db.sucursales, nombre)) return mostrarAlerta("❌ Ya existe una sucursal con ese nombre", "error");
    const nueva = { id: genID(), nombre, direccion: document.getElementById('sucDireccion').value.trim().toUpperCase(), tel: document.getElementById('sucTel').value.trim(), inventario: {} };
    window.db.sucursales.push(nueva);
    await guardarDB();
    if (navigator.onLine && window.guardarItemEnNube) await window.guardarItemEnNube("sucursales", nueva);
    e.target.reset();
    mostrarAlerta("🏪 Sucursal creada con éxito");
}

function cuerpoSucursalHTML(s) {
    const items = ordenarAlfa(window.db.productos.filter(p => (s.inventario[p.id] || 0) !== 0), 'nombre');
    const valor = items.reduce((a, p) => a + (s.inventario[p.id] || 0) * (p.costo || 0), 0);
    const emps = window.db.empleados.filter(e => e.idSuc === s.id);
    const caja = window.db.caja[s.id];
    return `<table style="${estiloTabla};margin-bottom:10px"><tbody>
        <tr><td style="${td}"><b>Sucursal</b></td><td style="${td}">${escapeHTML(s.nombre)}</td><td style="${td}"><b>Teléfono</b></td><td style="${td}">${escapeHTML(s.tel || 'S/D')}</td></tr>
        <tr><td style="${td}"><b>Dirección</b></td><td style="${td}">${escapeHTML(s.direccion || 'S/D')}</td><td style="${td}"><b>Caja</b></td><td style="${td}">${caja ? escapeHTML(caja.estado) : 'nunca abierta'}</td></tr>
        <tr><td style="${td}"><b>Personal</b></td><td style="${td}" colspan="3">${emps.map(e => escapeHTML(e.nombre + ' ' + e.apellido + ' (' + e.rol + ')')).join(', ') || 'S/D'}</td></tr>
        <tr><td style="${td}"><b>Valor del stock (costo)</b></td><td style="${td}" colspan="3"><b>${formatoGs(valor)}</b></td></tr></tbody></table>
        <table style="${estiloTabla}"><thead><tr><th style="${th}">Producto</th><th style="${th}">Detalle</th><th style="${th}">Categoría</th><th style="${th}">Stock</th><th style="${th}">Costo unit.</th><th style="${th}">Valor</th></tr></thead><tbody>
        ${items.map(p => `<tr><td style="${td}">${escapeHTML(p.nombre)}</td><td style="${td}">${escapeHTML(p.detalle || '')}</td><td style="${td}">${escapeHTML(p.categoria || '')}</td><td style="${td};text-align:center;font-weight:bold">${s.inventario[p.id]}</td><td style="${td};text-align:right">${formatoGs(p.costo)}</td><td style="${td};text-align:right">${formatoGs((s.inventario[p.id] || 0) * (p.costo || 0))}</td></tr>`).join('') || `<tr><td style="${td}" colspan="6">Sin mercadería cargada</td></tr>`}
        </tbody></table>`;
}
function verSucursal(id) { const s = window.db.sucursales.find(x => x.id === id); if (s) abrirDetalle('🏪 ' + s.nombre, cuerpoSucursalHTML(s), 'Detalle de mercaderías'); }

// ==================== PROVEEDORES ====================
async function agregarProveedor(e) {
    e.preventDefault();
    if (!exigir('gestionarProveedores')) return;
    const nombre = document.getElementById('provNombre').value.trim().toUpperCase();
    if (PRISMA_CORE.nombreDuplicado(window.db.proveedores, nombre)) return mostrarAlerta("❌ Ya existe un proveedor con esa razón social", "error");
    const nuevo = {
        id: genID(), nombre, doc: document.getElementById('provDoc').value.trim(), tel: document.getElementById('provTel').value.trim(),
        dir: document.getElementById('provDir').value.trim().toUpperCase(), contacto: document.getElementById('provContacto').value.trim().toUpperCase(),
        email: document.getElementById('provEmail').value.trim(), ciudad: '', observaciones: document.getElementById('provObs').value.trim()
    };
    window.db.proveedores.push(nuevo);
    await guardarDB();
    if (navigator.onLine && window.guardarItemEnNube) await window.guardarItemEnNube("proveedores", nuevo);
    e.target.reset();
    mostrarAlerta("🏭 Proveedor registrado");
}

function cuerpoProveedorHTML(p) {
    const compras = window.db.compras.filter(c => c.idProv === p.id);
    const total = compras.reduce((a, b) => a + (b.costoTotal || 0), 0);
    return `<table style="${estiloTabla};margin-bottom:10px"><tbody>
        <tr><td style="${td}"><b>Razón social</b></td><td style="${td}">${escapeHTML(p.nombre)}</td><td style="${td}"><b>RUC</b></td><td style="${td}">${escapeHTML(p.doc || 'S/D')}</td></tr>
        <tr><td style="${td}"><b>Teléfono</b></td><td style="${td}">${escapeHTML(p.tel || 'S/D')}</td><td style="${td}"><b>Email</b></td><td style="${td}">${escapeHTML(p.email || 'S/D')}</td></tr>
        <tr><td style="${td}"><b>Dirección</b></td><td style="${td}">${escapeHTML(p.dir || 'S/D')}</td><td style="${td}"><b>Contacto</b></td><td style="${td}">${escapeHTML(p.contacto || 'S/D')}</td></tr>
        <tr><td style="${td}"><b>Observaciones</b></td><td style="${td}" colspan="3">${escapeHTML(p.observaciones || 'S/D')}</td></tr>
        <tr><td style="${td}"><b>Compras realizadas</b></td><td style="${td}">${compras.length}</td><td style="${td}"><b>Total comprado</b></td><td style="${td}"><b>${formatoGs(total)}</b></td></tr></tbody></table>
        <table style="${estiloTabla}"><thead><tr><th style="${th}">Nº</th><th style="${th}">Fecha</th><th style="${th}">Destino</th><th style="${th}">Ítems</th><th style="${th}">Total</th></tr></thead><tbody>
        ${compras.map(c => `<tr><td style="${td}">${escapeHTML(c.nroCompra)}</td><td style="${td}">${escapeHTML(c.fecha)}</td><td style="${td}">${escapeHTML(c.sucursal || nombreSuc(c.idSuc))}</td><td style="${td}">${c.items.length}</td><td style="${td};text-align:right">${formatoGs(c.costoTotal)}</td></tr>`).join('') || `<tr><td style="${td}" colspan="5">Sin compras registradas</td></tr>`}</tbody></table>`;
}
function verProveedor(id) { const p = window.db.proveedores.find(x => x.id === id); if (p) abrirDetalle('🏭 ' + p.nombre, cuerpoProveedorHTML(p), 'Ficha de proveedor'); }

// ==================== CATÁLOGO ====================
async function agregarProducto(e) {
    e.preventDefault();
    if (!exigir('editarCatalogo')) return;
    const nombre = document.getElementById('prodNombre').value.trim().toUpperCase();
    const costo = parseFloat(document.getElementById('prodCosto').value), precio = parseFloat(document.getElementById('prodPrecio').value);
    if (PRISMA_CORE.nombreDuplicado(window.db.productos, nombre)) return mostrarAlerta("❌ Ya existe un producto con ese nombre", "error");
    if (costo > precio) return mostrarAlerta("❌ El costo no puede superar el precio de venta", "error");
    const nuevo = {
        id: genID(), qrCode: genID(), nombre, costo, precio,
        categoria: (document.getElementById('prodCategoria').value.trim().toUpperCase() || 'GENERAL'),
        unidad: document.getElementById('prodUnidad').value, stockMin: parseInt(document.getElementById('prodStockMin').value) || 0,
        detalle: document.getElementById('prodDetalle').value.trim(), observaciones: document.getElementById('prodObservaciones').value.trim(), activo: true
    };
    window.db.productos.push(nuevo);
    await guardarDB();
    if (navigator.onLine && window.guardarItemEnNube) await window.guardarItemEnNube("productos", nuevo);
    e.target.reset();
    mostrarAlerta("📦 Producto creado con éxito");
}

function cuerpoProductoHTML(p) {
    const vendidos = window.db.ventas.filter(v => v.idProd === p.id && !v.esCobroDeuda).reduce((a, b) => a + b.cant, 0);
    return `<table style="${estiloTabla};margin-bottom:10px"><tbody>
        <tr><td style="${td}"><b>Producto</b></td><td style="${td}">${escapeHTML(p.nombre)}</td><td style="${td}"><b>Categoría</b></td><td style="${td}">${escapeHTML(p.categoria || '')}</td></tr>
        <tr><td style="${td}"><b>Costo</b></td><td style="${td}">${formatoGs(p.costo)}</td><td style="${td}"><b>Precio venta</b></td><td style="${td}">${formatoGs(p.precio)}</td></tr>
        <tr><td style="${td}"><b>Margen</b></td><td style="${td}">${p.precio ? Math.round((p.precio - p.costo) / p.precio * 100) : 0}%</td><td style="${td}"><b>Unidad</b></td><td style="${td}">${escapeHTML(p.unidad || '')}</td></tr>
        <tr><td style="${td}"><b>Stock mínimo</b></td><td style="${td}">${p.stockMin || 0}</td><td style="${td}"><b>Vendidos (histórico)</b></td><td style="${td}">${vendidos}</td></tr>
        <tr><td style="${td}"><b>Detalle</b></td><td style="${td}" colspan="3">${escapeHTML(p.detalle || 'S/D')}</td></tr>
        <tr><td style="${td}"><b>Observaciones</b></td><td style="${td}" colspan="3">${escapeHTML(p.observaciones || 'S/D')}</td></tr>
        <tr><td style="${td}"><b>Código QR</b></td><td style="${td}" colspan="3">${escapeHTML(p.qrCode || p.id)}</td></tr></tbody></table>
        <table style="${estiloTabla}"><thead><tr><th style="${th}">Sucursal</th><th style="${th}">Stock</th><th style="${th}">Valor a costo</th></tr></thead><tbody>
        ${window.db.sucursales.map(s => `<tr><td style="${td}">${escapeHTML(s.nombre)}</td><td style="${td};text-align:center;font-weight:bold">${s.inventario[p.id] || 0}</td><td style="${td};text-align:right">${formatoGs((s.inventario[p.id] || 0) * (p.costo || 0))}</td></tr>`).join('')}
        <tr><td style="${td}"><b>TOTAL</b></td><td style="${td};text-align:center;font-weight:bold">${PRISMA_CORE.stockTotal(window.db, p.id)}</td><td style="${td};text-align:right"><b>${formatoGs(PRISMA_CORE.stockTotal(window.db, p.id) * (p.costo || 0))}</b></td></tr></tbody></table>`;
}
function verProducto(id) { const p = window.db.productos.find(x => x.id === id); if (p) abrirDetalle('📦 ' + p.nombre, cuerpoProductoHTML(p), 'Ficha de producto'); }

// ==================== COMPRAS MULTI-ÍTEM ====================
function vaciarCompra() { compraActual = []; renderCompraCarrito(); }
function sugerirCostoCompra() {
    const p = window.db.productos.find(x => x.id === document.getElementById('compraProducto')?.value);
    const inp = document.getElementById('compraCostoUnit');
    if (inp && p) inp.value = p.costo || 0;
}

function agregarItemCompra(e) {
    e.preventDefault();
    if (!exigir('registrarCompra')) return;
    const idProd = document.getElementById('compraProducto').value, p = window.db.productos.find(x => x.id === idProd);
    const cant = parseInt(document.getElementById('compraCantidad').value), costoUnit = parseFloat(document.getElementById('compraCostoUnit').value);
    if (!p) return mostrarAlerta("❌ Seleccione un producto", "error");
    if (!(cant > 0)) return mostrarAlerta("❌ Cantidad inválida", "error");
    if (!(costoUnit >= 0)) return mostrarAlerta("❌ Costo inválido", "error");
    if (costoUnit > p.precio) mostrarAlerta("⚠️ El costo supera el precio de venta de " + p.nombre, "error");
    const ex = compraActual.find(i => i.idProd === idProd && i.costoUnit === costoUnit);
    if (ex) ex.cant += cant; else compraActual.push({ idProd, nombre: p.nombre, cant, costoUnit });
    document.getElementById('compraCantidad').value = 1;
    renderCompraCarrito();
}

function quitarItemCompra(i) { compraActual.splice(i, 1); renderCompraCarrito(); }

function renderCompraCarrito() {
    const t = document.getElementById('grillaCompraBody');
    if (!t) return;
    let total = 0;
    t.innerHTML = compraActual.map((i, idx) => {
        const sub = i.cant * i.costoUnit; total += sub;
        return `<tr class="border-b border-slate-800/40">
            <td class="py-1.5 font-bold tabular-nums">${i.cant}</td>
            <td class="py-1.5 text-white">${escapeHTML(i.nombre)}</td>
            <td class="py-1.5 text-right tabular-nums text-emerald-400">${formatoGs(sub)}</td>
            <td class="py-1.5 text-right"><button onclick="quitarItemCompra(${idx})" class="text-rose-400 hover:text-rose-300 font-bold">✕</button></td>
        </tr>`;
    }).join('') || '<tr><td colspan="4" class="py-4 text-center text-slate-500">Sin ítems en la compra</td></tr>';
    document.getElementById('lblCompraTotal').innerText = formatoGs(total);
    document.getElementById('btnRegistrarCompra').disabled = compraActual.length === 0;
}

async function registrarCompra() {
    if (!exigir('registrarCompra')) return;
    const idProv = document.getElementById('compraProveedor').value, idSuc = document.getElementById('compraDestino').value;
    const prov = window.db.proveedores.find(p => p.id === idProv), suc = window.db.sucursales.find(s => s.id === idSuc);
    if (!prov || !suc) return mostrarAlerta("❌ Seleccione proveedor y destino", "error");
    const compra = {
        id: genID(), nroCompra: PRISMA_CORE.proximoNro('C-', window.db.compras, 'nroCompra'), fecha: new Date().toLocaleString('es-PY'),
        idProv, proveedor: prov.nombre, idSuc, sucursal: suc.nombre, facturaProv: document.getElementById('compraFactura').value.trim(),
        usuario: usuarioActual.nombre, items: compraActual.map(i => ({ idProd: i.idProd, nombre: i.nombre, cant: i.cant, costoUnit: i.costoUnit, subtotal: i.cant * i.costoUnit })), costoTotal: 0
    };
    const r = PRISMA_CORE.aplicarCompra(window.db, compra);
    if (!r.ok) return mostrarAlerta("❌ " + r.error, "error");
    window.db.compras.unshift(compra);
    await guardarDB(false);
    if (navigator.onLine && window.guardarItemEnNube) {
        await window.guardarItemEnNube("compras", compra);
        await window.guardarItemEnNube("sucursales", suc);
        compra.items.forEach(i => {
            const p = window.db.productos.find(x => x.id === i.idProd);
            if (p) window.guardarItemEnNube("productos", p);
        });
    }
    vaciarCompra();
    document.getElementById('compraFactura').value = '';
    render();
    mostrarAlerta(`📥 Compra ${compra.nroCompra} registrada`);
}

function cuerpoCompraHTML(c) {
    const prov = window.db.proveedores.find(p => p.id === c.idProv) || { nombre: c.proveedor, doc: 'S/D', tel: 'S/D' };
    return `<table style="${estiloTabla};margin-bottom:10px"><tbody>
        <tr><td style="${td}"><b>Compra Nº</b></td><td style="${td}">${escapeHTML(c.nroCompra)}</td><td style="${td}"><b>Fecha</b></td><td style="${td}">${escapeHTML(c.fecha)}</td></tr>
        <tr><td style="${td}"><b>Proveedor</b></td><td style="${td}">${escapeHTML(prov.nombre)}</td><td style="${td}"><b>RUC</b></td><td style="${td}">${escapeHTML(prov.doc || 'S/D')}</td></tr>
        <tr><td style="${td}"><b>Destino</b></td><td style="${td}">${escapeHTML(c.sucursal || nombreSuc(c.idSuc))}</td><td style="${td}"><b>Factura prov.</b></td><td style="${td}">${escapeHTML(c.facturaProv || 'S/D')}</td></tr>
        <tr><td style="${td}"><b>Cargado por</b></td><td style="${td}" colspan="3">${escapeHTML(c.usuario || 'S/D')}</td></tr></tbody></table>
        <table style="${estiloTabla}"><thead><tr><th style="${th}">#</th><th style="${th}">Producto</th><th style="${th}">Cant.</th><th style="${th}">Costo unit.</th><th style="${th}">Subtotal</th></tr></thead><tbody>
        ${c.items.map((i, n) => `<tr><td style="${td}">${n + 1}</td><td style="${td}">${escapeHTML(i.nombre)}</td><td style="${td};text-align:center">${i.cant}</td><td style="${td};text-align:right">${formatoGs(i.costoUnit)}</td><td style="${td};text-align:right">${formatoGs(i.subtotal)}</td></tr>`).join('')}
        <tr><td style="${td}" colspan="4"><b>TOTAL DE LA COMPRA</b></td><td style="${td};text-align:right;font-weight:bold">${formatoGs(c.costoTotal)}</td></tr></tbody></table>`;
}
function verCompra(id) { const c = window.db.compras.find(x => x.id === id); if (c) abrirDetalle('📥 Compra ' + c.nroCompra, cuerpoCompraHTML(c), c.proveedor); }

// ==================== GASTOS ====================
async function registrarGasto(e) {
    e.preventDefault();
    if (!exigir('registrarGasto')) return;
    const idSuc = document.getElementById('gastoSucursal').value;
    const nuevo = {
        id: genID(), fecha: new Date().toLocaleString('es-PY'), categoria: document.getElementById('gastoCategoria').value,
        idSuc, sucursal: nombreSuc(idSuc), detalle: document.getElementById('gastoDetalle').value.trim().toUpperCase(),
        monto: parseFloat(document.getElementById('gastoMonto').value), usuario: usuarioActual.nombre
    };
    window.db.gastos.unshift(nuevo);
    await guardarDB();
    if (navigator.onLine && window.guardarItemEnNube) await window.guardarItemEnNube("gastos", nuevo);
    e.target.reset();
    mostrarAlerta("💸 Gasto registrado");
}

// ==================== CLIENTES ====================
async function agregarCliente(e) {
    e.preventDefault();
    if (!exigir('crearCliente')) return;
    const doc = document.getElementById('cliDoc').value.trim();
    if (window.db.clientes.some(c => c.doc === doc)) return mostrarAlerta("❌ Ya existe un cliente con ese documento", "error");
    const nuevo = {
        id: genID(), nombre: document.getElementById('cliNombre').value.trim().toUpperCase(), apellido: document.getElementById('cliApellido').value.trim().toUpperCase(),
        tipoDoc: document.getElementById('cliTipoDoc').value, doc, tel: document.getElementById('cliTel').value.trim(),
        sexo: document.getElementById('cliSexo').value, direccion: document.getElementById('cliDireccion').value.trim().toUpperCase(),
        ciudad: document.getElementById('cliCiudad').value.trim().toUpperCase(), email: '', condicion: document.getElementById('cliCondicion').value,
        observaciones: document.getElementById('cliObservaciones').value.trim(), deuda: 0, fechaAlta: new Date().toLocaleDateString('es-PY')
    };
    window.db.clientes.push(nuevo);
    await guardarDB();
    if (navigator.onLine && window.guardarItemEnNube) await window.guardarItemEnNube("clientes", nuevo);
    e.target.reset();
    mostrarAlerta("🤝 Cliente registrado");
}

async function guardarClienteRapido(e) {
    e.preventDefault();
    if (!exigir('crearCliente')) return;
    const doc = document.getElementById('cliRapidoDoc').value.trim();
    if (window.db.clientes.some(c => c.doc === doc)) return mostrarAlerta("❌ Documento ya registrado", "error");
    const id = genID();
    const nuevo = { id, nombre: document.getElementById('cliRapidoNombre').value.trim().toUpperCase(), apellido: document.getElementById('cliRapidoApellido').value.trim().toUpperCase(), tipoDoc: 'Cedula', doc, tel: document.getElementById('cliRapidoTel').value.trim(), sexo: '', direccion: 'S/D', ciudad: '', email: '', condicion: 'Contado', observaciones: 'Alta express desde POS', deuda: 0, fechaAlta: new Date().toLocaleDateString('es-PY') };
    window.db.clientes.push(nuevo);
    await guardarDB(false);
    if (navigator.onLine && window.guardarItemEnNube) await window.guardarItemEnNube("clientes", nuevo);
    render();
    document.getElementById('modalClienteRapido').classList.add('hidden');
    document.getElementById('ventaCliente').value = id;
    e.target.reset();
    mostrarAlerta("⚡ Cliente express guardado");
}

function filtrarPorLetra(l) { letraCliente = l; renderClientes(); }

function clientesFiltrados() {
    const q = (document.getElementById('buscadorClientes')?.value || '').toLowerCase();
    return ordenarAlfa(window.db.clientes, 'apellido').filter(c => {
        const ini = String(c.apellido || c.nombre || '').charAt(0).toUpperCase();
        const okLetra = letraCliente === 'TODOS' || ini === letraCliente;
        const okQ = !q || (c.nombre + ' ' + c.apellido + ' ' + c.doc + ' ' + (c.tel || '')).toLowerCase().includes(q);
        return okLetra && okQ;
    });
}

function renderClientes() {
    const barra = document.getElementById('barraAbecedario'), cont = document.getElementById('listaClientes');
    if (!barra || !cont) return;
    const letras = ['TODOS'].concat('ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.split(''));
    const usadas = new Set(window.db.clientes.map(c => String(c.apellido || c.nombre || '').charAt(0).toUpperCase()));
    barra.innerHTML = letras.map(l => {
        const activa = l === letraCliente, tiene = l === 'TODOS' || usadas.has(l);
        return `<button onclick="filtrarPorLetra('${l}')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${activa ? 'bg-teal-500 text-white shadow-sm' : tiene ? 'bg-slate-800/80 text-slate-300 hover:bg-slate-700' : 'bg-slate-900/40 text-slate-600'}">${l}</button>`;
    }).join('');

    const lista = clientesFiltrados();
    const puedeEditar = PRISMA_CORE.puedeDB(window.db, usuarioActual.rol, 'editarCliente') || usuarioActual.isMaster;
    cont.innerHTML = lista.map(c => `<div class="card-apple p-4 flex flex-col justify-between">
        <div class="cursor-pointer" onclick="verCliente('${c.id}')">
            <div class="flex justify-between items-start">
                <b class="text-white text-base">${escapeHTML(c.apellido)}, ${escapeHTML(c.nombre)}</b>
                <span class="badge-apple ${c.condicion === 'Crédito' ? 'badge-amber' : 'badge-teal'}">${escapeHTML(c.condicion)}</span>
            </div>
            <p class="text-xs text-slate-400 mt-1">${escapeHTML(c.tipoDoc)}: <span class="tabular-nums">${escapeHTML(c.doc)}</span></p>
            <p class="text-xs text-slate-400">📞 ${escapeHTML(c.tel || 'S/D')}</p>
            ${c.deuda > 0 ? `<p class="text-xs font-bold text-rose-400 mt-2">Deuda pendiente: <span class="tabular-nums">${formatoGs(c.deuda)}</span></p>` : ''}
        </div>
        <div class="flex gap-2 mt-3 pt-3 border-t border-slate-800/60">
            <button onclick="verCliente('${c.id}')" class="btn-apple btn-apple-secondary text-xs py-1.5 flex-1">👁️ Ficha</button>
            ${puedeEditar ? `<button onclick="abrirEditor('clientes','${c.id}')" class="btn-apple btn-apple-secondary text-xs py-1.5 px-3">✏️</button>` : ''}
            ${(c.deuda > 0 && (PRISMA_CORE.puedeDB(window.db, usuarioActual.rol, 'cobrarDeuda') || usuarioActual.isMaster))
                ? `<button onclick="cobrarDeuda('${c.id}')" class="btn-apple btn-apple-emerald text-xs py-1.5 px-3">💰 Cobrar</button>`
                : ''}
        </div></div>`).join('') || '<p class="text-xs text-slate-500">Sin clientes que coincidan con la búsqueda.</p>';
}

function cuerpoClienteHTML(c) {
    const compras = agruparVentas(window.db.ventas.filter(v => v.idCliente === c.id && !v.esCobroDeuda));
    const total = compras.reduce((a, b) => a + b.total, 0);
    return `<table style="${estiloTabla};margin-bottom:10px"><tbody>
        <tr><td style="${td}"><b>Cliente</b></td><td style="${td}">${escapeHTML(c.nombre + ' ' + c.apellido)}</td><td style="${td}"><b>${escapeHTML(c.tipoDoc || 'Doc')}</b></td><td style="${td}">${escapeHTML(c.doc)}</td></tr>
        <tr><td style="${td}"><b>Teléfono</b></td><td style="${td}">${escapeHTML(c.tel || 'S/D')}</td><td style="${td}"><b>Sexo</b></td><td style="${td}">${escapeHTML(c.sexo || 'Sin especificar')}</td></tr>
        <tr><td style="${td}"><b>Dirección</b></td><td style="${td}">${escapeHTML(c.direccion || 'S/D')}</td><td style="${td}"><b>Ciudad</b></td><td style="${td}">${escapeHTML(c.ciudad || 'S/D')}</td></tr>
        <tr><td style="${td}"><b>Condición</b></td><td style="${td}">${escapeHTML(c.condicion)}</td><td style="${td}"><b>Deuda actual</b></td><td style="${td}"><b>${formatoGs(c.deuda || 0)}</b></td></tr>
        <tr><td style="${td}"><b>Alta</b></td><td style="${td}">${escapeHTML(c.fechaAlta || 'S/D')}</td><td style="${td}"><b>Compras</b></td><td style="${td}">${compras.length} · ${formatoGs(total)}</td></tr>
        <tr><td style="${td}"><b>Observaciones</b></td><td style="${td}" colspan="3">${escapeHTML(c.observaciones || 'S/D')}</td></tr></tbody></table>
        <table style="${estiloTabla}"><thead><tr><th style="${th}">Fecha</th><th style="${th}">Sucursal</th><th style="${th}">Ítems</th><th style="${th}">Condición</th><th style="${th}">Total</th></tr></thead><tbody>
        ${compras.slice(0, 40).map(g => `<tr><td style="${td}">${escapeHTML(g.fecha)}</td><td style="${td}">${escapeHTML(g.nombreSuc || '')}</td><td style="${td};text-align:center">${g.items.length}</td><td style="${td}">${escapeHTML(g.pago || '')}</td><td style="${td};text-align:right">${formatoGs(g.total)}</td></tr>`).join('') || `<tr><td style="${td}" colspan="5">Sin compras registradas</td></tr>`}</tbody></table>`;
}
function verCliente(id) { const c = window.db.clientes.find(x => x.id === id); if (c) abrirDetalle('🤝 ' + c.nombre + ' ' + c.apellido, cuerpoClienteHTML(c), 'Ficha de cliente'); }

function imprimirListadoClientes() {
    const lista = clientesFiltrados();
    const cuerpo = `<table style="${estiloTabla}"><thead><tr><th style="${th}">Apellido y nombre</th><th style="${th}">Documento</th><th style="${th}">Teléfono</th><th style="${th}">Dirección</th><th style="${th}">Condición</th><th style="${th}">Deuda</th></tr></thead><tbody>
        ${lista.map(c => `<tr><td style="${td}">${escapeHTML(c.apellido + ', ' + c.nombre)}</td><td style="${td}">${escapeHTML(c.doc)}</td><td style="${td}">${escapeHTML(c.tel || '')}</td><td style="${td}">${escapeHTML(c.direccion || '')}</td><td style="${td}">${escapeHTML(c.condicion)}</td><td style="${td};text-align:right">${formatoGs(c.deuda || 0)}</td></tr>`).join('')}</tbody></table>`;
    imprimirA4('LISTADO DE CLIENTES (orden alfabético)', cuerpo, 'Filtro: ' + letraCliente + ' · ' + lista.length + ' clientes');
}

window.cobrarDeuda = async function (id) {
    if (!exigir('cobrarDeuda')) return;
    const cli = window.db.clientes.find(c => c.id === id);
    if (!cli || cli.deuda <= 0) return;
    const monto = prompt(`Cobro a ${cli.nombre} ${cli.apellido} (deuda ${formatoGs(cli.deuda)}). Monto a abonar:`, cli.deuda);
    if (!monto || isNaN(monto) || parseFloat(monto) <= 0) return;
    const pago = Math.min(parseFloat(monto), cli.deuda);
    cli.deuda -= pago;

    const ahoraCobro = Date.now();
    const idSucCobro = (usuarioActual.idSuc && usuarioActual.idSuc !== 'todas')
        ? usuarioActual.idSuc
        : (document.getElementById('ventaSucursal')?.value || (window.db.sucursales[0] || {}).id || '');

    const cob = {
        id: genID(),
        fecha: new Date().toLocaleString('es-PY'),
        timestamp: ahoraCobro,
        idSuc: idSucCobro,
        nombreSuc: nombreSuc(idSucCobro) || 'COBRANZA',
        vendedor: usuarioActual.nombre,
        nombreCliente: `${cli.nombre} ${cli.apellido}`,
        idCliente: cli.id,
        nombreProd: 'PAGO CUENTA CORRIENTE',
        cant: 1,
        total: pago,
        pago: 'Efectivo',
        esCobroDeuda: true
    };
    window.db.ventas.unshift(cob);
    await guardarDB();
    if (navigator.onLine && window.guardarVentaEnNube) {
        window.guardarVentaEnNube(cob);
        window.guardarItemEnNube("clientes", cli);
    }
    mostrarAlerta(`💰 Cobrado ${formatoGs(pago)}`);
    if (document.getElementById('caja')?.classList.contains('activa')) {
        verificarEfectivoCaja();
    }
};

// ==================== PERSONAL Y PERMISOS ====================
function rolesSelectHTML(seleccionado, incluirInactivos, excluirInformatico) {
    const claves = PRISMA_CORE.listaRoles(window.db).filter(k => k !== 'informatico' || (!excluirInformatico && usuarioActual.rol === 'informatico'))
        .filter(k => incluirInactivos || window.db.config.roles[k].activo !== false)
        .sort((a, b) => window.db.config.roles[a].label.localeCompare(window.db.config.roles[b].label, 'es'));
    return claves.map(k => `<option value="${k}" ${k === seleccionado ? 'selected' : ''}>${escapeHTML(window.db.config.roles[k].label)}${window.db.config.roles[k].activo === false ? ' (inactivo)' : ''}</option>`).join('');
}

function mostrarAyudaRol() {
    const rol = document.getElementById('empRol')?.value, p = document.getElementById('ayudaRol');
    if (p && rol) p.innerText = '🔐 ' + (PRISMA_CORE.AYUDA_ROL[rol] || 'Rol con permisos personalizados: ' + (PRISMA_CORE.seccionesDeDB(window.db, rol).join(', ') || 'sin secciones asignadas'));
}

function renderMatrizPermisos() {
    const cont = document.getElementById('matrizPermisos'), wrap = document.getElementById('gestionRolesWrap');
    if (!cont) return;
    const puedeGestionar = PRISMA_CORE.esAltoMando(usuarioActual);
    const secs = PRISMA_CORE.SECCIONES_BASE.concat(['sistema']);
    const roles = PRISMA_CORE.listaRoles(window.db).sort((a, b) => window.db.config.roles[a].label.localeCompare(window.db.config.roles[b].label, 'es'));

    cont.innerHTML = `<table class="table-apple text-[11px]"><thead><tr><th class="p-2 text-left">Rol</th>${secs.map(s => `<th class="p-2 text-center">${s}</th>`).join('')}${puedeGestionar ? '<th class="p-2 text-center">Estado</th><th class="p-2"></th>' : ''}</tr></thead><tbody>
        ${roles.map(r => {
            const info = window.db.config.roles[r];
            const editable = puedeGestionar && !info.protegido;
            return `<tr class="${info.activo === false ? 'opacity-40' : ''}">
                <td class="p-2 font-bold text-white">${escapeHTML(info.label)}${info.protegido ? ' 🛡️' : ''}</td>
                ${secs.map(s => {
                    const on = PRISMA_CORE.puedeVerDB(window.db, r, s);
                    return `<td class="p-2 text-center">${editable
                        ? `<input type="checkbox" ${on ? 'checked' : ''} onchange="togglePermisoRolUI('${r}','${s}',this.checked)" class="accent-teal-500 rounded">`
                        : (on ? '<span class="text-emerald-400 font-bold">✔</span>' : '<span class="text-slate-600">·</span>')}</td>`;
                }).join('')}
                ${puedeGestionar ? `
                <td class="p-2 text-center">${info.protegido ? '—' : `<button onclick="toggleActivoRolUI('${r}',${info.activo === false})" class="btn-apple btn-apple-secondary text-[10px] py-0.5 px-2">${info.activo === false ? 'Activar' : 'Desactivar'}</button>`}</td>
                <td class="p-2 text-center">${info.protegido ? '' : `<button onclick="eliminarRolUI('${r}')" class="text-rose-400 hover:text-rose-300 font-bold text-xs">🗑️</button>`}</td>` : ''}
            </tr>`;
        }).join('')}</tbody></table>`;

    if (!wrap) return;
    if (!puedeGestionar) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `<div class="border-t border-slate-800/60 pt-4 mt-3">
        <p class="text-slate-400 mb-2 text-xs">🛡️ Sólo el dueño y el informático pueden crear roles nuevos o gestionar permisos.</p>
        <form onsubmit="crearRolUI(event)" class="flex flex-wrap gap-2 items-end">
            <div><label class="block text-[11px] font-semibold text-slate-400 uppercase mb-1">Nombre del nuevo rol</label><input id="nuevoRolNombre" required placeholder="Ej: Supervisor" class="input-apple text-xs py-1.5"></div>
            <div class="flex flex-wrap gap-1.5 max-w-md">${PRISMA_CORE.SECCIONES_BASE.map(s => `<label class="bg-slate-900 border border-slate-800 px-2 py-1 rounded-lg text-[10px] flex items-center gap-1.5 text-slate-300"><input type="checkbox" name="nuevoRolSec" value="${s}" class="accent-teal-500"> ${s}</label>`).join('')}</div>
            <button type="submit" class="btn-apple btn-apple-indigo text-xs py-2">+ Crear rol</button>
        </form></div>`;
}

window.togglePermisoRolUI = async function (rol, seccion, valor) {
    const r = PRISMA_CORE.actualizarSeccionRol(window.db, usuarioActual, rol, seccion, valor);
    if (!r.ok) { mostrarAlerta("⛔ " + r.error, "error"); return renderMatrizPermisos(); }
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'PERMISO ' + (valor ? 'OTORGADO' : 'QUITADO'), 'roles', `${rol}: ${seccion}`);
    await guardarDB(false); render(); mostrarAlerta("🔐 Permiso actualizado");
};

window.toggleActivoRolUI = async function (rol, valor) {
    const r = PRISMA_CORE.toggleActivoRol(window.db, usuarioActual, rol, valor);
    if (!r.ok) return mostrarAlerta("⛔ " + r.error, "error");
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, valor ? 'ACTIVAR ROL' : 'DESACTIVAR ROL', 'roles', rol);
    await guardarDB(false); render(); mostrarAlerta(valor ? "✅ Rol activado" : "⛔ Rol desactivado");
};

window.eliminarRolUI = async function (rol) {
    if (!confirm('¿Eliminar el rol "' + (window.db.config.roles[rol] || {}).label + '"?')) return;
    const r = PRISMA_CORE.eliminarRol(window.db, usuarioActual, rol);
    if (!r.ok) return mostrarAlerta("⛔ " + r.error, "error");
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'ELIMINAR ROL', 'roles', rol);
    await guardarDB(false); render(); mostrarAlerta("🗑️ Rol eliminado");
};

window.crearRolUI = async function (e) {
    e.preventDefault();
    const label = document.getElementById('nuevoRolNombre').value.trim();
    const secciones = Array.from(document.querySelectorAll('input[name="nuevoRolSec"]:checked')).map(x => x.value);
    const r = PRISMA_CORE.crearRol(window.db, usuarioActual, label, { label, secciones });
    if (!r.ok) return mostrarAlerta("⛔ " + r.error, "error");
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'CREAR ROL', 'roles', label + ' (' + secciones.join(', ') + ')');
    await guardarDB(false); render(); mostrarAlerta("👤 Rol \"" + label + "\" creado");
};

window.desvincularDispositivoUI = async function (id) {
    const emp = window.db.empleados.find(e => e.id === id);
    const r = PRISMA_CORE.desvincularDispositivo(usuarioActual, emp);
    if (!r.ok) return mostrarAlerta("⛔ " + r.error, "error");
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'DESVINCULAR DISPOSITIVO', 'empleados', `${emp.nombre} ${emp.apellido}`);
    await guardarDB(false);
    if (navigator.onLine && window.guardarItemEnNube) window.guardarItemEnNube("empleados", emp);
    mostrarAlerta("🔓 Dispositivo desvinculado");
};

async function agregarEmpleado(e) {
    e.preventDefault();
    if (!exigir('gestionarPersonal')) return;
    const pin = document.getElementById('empPin').value, doc = document.getElementById('empDoc').value.trim();
    const rol = document.getElementById('empRol').value;
    if (rol === 'informatico') return mostrarAlerta("❌ El rol informático es único y ya existe", "error");
    if (!window.db.config.roles[rol] || window.db.config.roles[rol].activo === false) return mostrarAlerta("❌ Rol no válido o desactivado", "error");
    if (pin === '0000' || pin === '6988') return mostrarAlerta("❌ PIN reservado por el sistema", "error");
    if (!/^\d{4}$/.test(pin)) return mostrarAlerta("❌ El PIN debe tener exactamente 4 dígitos", "error");
    if (PRISMA_CORE.pinDuplicado(window.db, pin)) return mostrarAlerta("❌ PIN en uso", "error");
    if (window.db.empleados.some(x => x.doc === doc)) return mostrarAlerta("❌ Cédula en uso", "error");
    if (!document.getElementById('empSucursal').value) return mostrarAlerta("❌ Seleccione una sucursal", "error");

    const sal = window.db.config.salPin || PRISMA_CORE.generarSal();
    window.db.config.salPin = sal;
    const nuevo = {
        id: genID(), nombre: document.getElementById('empNombre').value.trim().toUpperCase(), apellido: document.getElementById('empApellido').value.trim().toUpperCase(),
        tipoDoc: 'Cedula', doc, domicilio: document.getElementById('empDomicilio').value.trim().toUpperCase(), idSuc: document.getElementById('empSucursal').value,
        rol, pinHash: PRISMA_CORE.hashPin(pin, sal), estado: 'activo', comision: parseFloat(document.getElementById('empComision').value) || 0, ventasTotal: 0, comisionAcumulada: 0, protegido: false, dispositivoId: ''
    };
    window.db.empleados.push(nuevo);
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'ALTA EMPLEADO', 'empleados', `${nuevo.nombre} ${nuevo.apellido} (${rol})`);
    await guardarDB();
    if (navigator.onLine && window.guardarItemEnNube) await window.guardarItemEnNube("empleados", nuevo);
    if (navigator.onLine && window.db.config.seguridadServidorActiva && window.asignarPinSeguro) {
        await window.asignarPinSeguro(nuevo.id, pin);
    }
    e.target.reset();
    mostrarAyudaRol();
    mostrarAlerta("👥 Empleado registrado");
}

window.toggleEstadoEmpleado = async function (id) {
    if (!exigir('gestionarPersonal')) return;
    const emp = window.db.empleados.find(e => e.id === id); if (!emp) return;
    if (PRISMA_CORE.esProtegido(emp)) return mostrarAlerta("🛡️ El usuario INFORMÁTICO no se puede suspender", "error");
    if (emp.id === usuarioActual.id) return mostrarAlerta("❌ No puede suspenderse a sí mismo", "error");
    emp.estado = emp.estado === 'bloqueado' ? 'activo' : 'bloqueado';
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, emp.estado === 'bloqueado' ? 'SUSPENDER EMPLEADO' : 'REACTIVAR EMPLEADO', 'empleados', `${emp.nombre} ${emp.apellido}`);
    await guardarDB();
    if (navigator.onLine && window.guardarItemEnNube) await window.guardarItemEnNube("empleados", emp);
    mostrarAlerta(`✓ ${emp.nombre} ${emp.estado === 'bloqueado' ? 'SUSPENDIDO' : 'ACTIVO'}`);
};

window.eliminarEmpleado = async function (id) {
    const emp = window.db.empleados.find(e => e.id === id);
    const r = PRISMA_CORE.puedeEliminarEmpleado(usuarioActual, emp);
    if (!r.ok) return mostrarAlerta("⛔ " + r.error, "error");
    if (!confirm(`¿Eliminar definitivamente a ${emp.nombre} ${emp.apellido}?`)) return;
    window.db.empleados = window.db.empleados.filter(e => e.id !== id);
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'ELIMINAR EMPLEADO', 'empleados', `${emp.nombre} ${emp.apellido}`);
    await guardarDB();
    if (navigator.onLine && window.borrarItemEnNube) await window.borrarItemEnNube("empleados", id);
    mostrarAlerta("🗑️ Empleado eliminado");
};

// ==================== CAJA DIARIA ====================
function parseFechaHora(str) {
    if (!str) return 0;
    if (typeof str === 'number') return str;
    const direct = Date.parse(str);
    if (!isNaN(direct) && direct > 0) return direct;
    try {
        const partes = String(str).split(/[\s,]+/);
        if (partes.length >= 2) {
            const fPartes = partes[0].split('/');
            if (fPartes.length === 3) {
                const dia = parseInt(fPartes[0]);
                const mes = parseInt(fPartes[1]) - 1;
                const anio = parseInt(fPartes[2]);
                const tPartes = partes[1].split(':');
                let hora = parseInt(tPartes[0]) || 0;
                const min = parseInt(tPartes[1]) || 0;
                const seg = parseInt(tPartes[2]) || 0;
                const ampm = (partes.slice(2).join(' ')).toLowerCase();
                if (ampm.includes('p') && hora < 12) hora += 12;
                if (ampm.includes('a') && hora === 12) hora = 0;
                const d = new Date(anio, mes, dia, hora, min, seg);
                return d.getTime() || 0;
            }
        }
    } catch (e) { }
    return 0;
}

async function abrirCaja(e) {
    e.preventDefault();
    if (!exigir('abrirCaja')) return;
    const id = document.getElementById('cajaSucursalApertura')?.value;
    if (!id || !id.trim()) return mostrarAlerta("❌ Debe seleccionar una sucursal válida", "error");
    if (!PRISMA_CORE.sucursalPermitida(usuarioActual, id)) return mostrarAlerta("⛔ Sólo puede abrir la caja de su sucursal", "error");
    if (cajaAbierta(id)) return mostrarAlerta("⚠️ La caja de esta sucursal ya está abierta", "error");

    const m = parseFloat(document.getElementById('cajaMontoApertura').value) || 0;
    const ahora = Date.now();
    const fechaHora = new Date().toLocaleString('es-PY');
    const hoy = new Date().toLocaleDateString('es-PY');

    window.db.caja[id] = {
        estado: 'abierta',
        fechaAbierta: hoy,
        fechaHoraApertura: fechaHora,
        timestampApertura: ahora,
        montoInicial: m,
        abiertaPor: usuarioActual.nombre,
        historial: (window.db.caja[id] && window.db.caja[id].historial) || []
    };

    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'APERTURA CAJA', 'caja', `${nombreSuc(id)} - Inicial: ${formatoGs(m)}`);
    await guardarDB();
    if (navigator.onLine && window.guardarCajaEnNube) await window.guardarCajaEnNube();
    mostrarAlerta(`💵 Caja abierta con ${formatoGs(m)}`);
    verificarEstadoCajaPOS();
    verificarEfectivoCaja();
}

async function prepararDepositoCierre(e) {
    e.preventDefault();
    if (!exigir('cerrarCaja')) return;
    const id = document.getElementById('cajaSucursalCierre')?.value;
    if (!id || !id.trim()) return mostrarAlerta("❌ Debe seleccionar una sucursal válida", "error");
    if (!PRISMA_CORE.sucursalPermitida(usuarioActual, id)) return mostrarAlerta("⛔ Sólo puede cerrar la caja de su sucursal", "error");
    if (!window.db.caja[id] || window.db.caja[id].estado !== 'abierta') return mostrarAlerta("❌ La caja no está abierta", "error");

    const dep = parseFloat(document.getElementById('cajaMontoDeposito').value) || 0;
    const tT = efectivoTeorico(id);
    const ahora = Date.now();
    const fechaHora = new Date().toLocaleString('es-PY');

    window.db.caja[id].estado = 'cerrada';
    window.db.caja[id].timestampCierre = ahora;
    window.db.caja[id].fechaHoraCierre = fechaHora;

    window.db.caja[id].historial.unshift({
        id: genID(),
        fecha: fechaHora,
        timestamp: ahora,
        timestampApertura: window.db.caja[id].timestampApertura || ahora,
        depositoDeclarado: dep,
        teoricoSistema: tT,
        diferencia: dep - tT,
        responsable: usuarioActual.nombre
    });

    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'CIERRE CAJA', 'caja', `${nombreSuc(id)} - Declarado: ${formatoGs(dep)} - Teórico: ${formatoGs(tT)}`);
    await guardarDB();
    if (navigator.onLine && window.guardarCajaEnNube) await window.guardarCajaEnNube();
    mostrarAlerta("🏦 Cierre de caja registrado exitosamente");
    verificarEstadoCajaPOS();
    renderHistorialCaja();
    verificarEfectivoCaja();
}

function efectivoTeorico(id) {
    const c = window.db.caja[id];
    if (!c || c.estado !== 'abierta') return 0;
    const tApertura = c.timestampApertura || 0;
    let efVentas = 0;

    (window.db.ventas || []).forEach(v => {
        if (v.idSuc === id && v.pago !== 'Crédito') {
            const vTime = v.timestamp || parseFechaHora(v.fecha);
            if (tApertura > 0 && vTime > 0) {
                // Solo ventas realizadas desde la última apertura
                if (vTime >= tApertura) {
                    efVentas += (v.total || 0);
                }
            } else if (tApertura === 0) {
                // Fallback para datos legados
                const hoy = new Date().toLocaleDateString('es-PY');
                if (String(v.fecha).includes(hoy)) efVentas += (v.total || 0);
            }
        }
    });

    return (c.montoInicial || 0) + efVentas;
}

function verificarEfectivoCaja() {
    const id = document.getElementById('cajaSucursalCierre')?.value, lbl = document.getElementById('lblEfectivoVentas');
    if (!id || !lbl) return;
    const c = window.db.caja[id];
    lbl.innerText = (!c || c.estado !== 'abierta') ? "CAJA CERRADA" : formatoGs(efectivoTeorico(id));
}

function verificarEstadoCajaPOS() {
    const id = document.getElementById('ventaSucursal')?.value, b = document.getElementById('estadoCajaBadge');
    if (!b) return;
    if (cajaAbierta(id)) {
        b.className = "badge-apple badge-emerald";
        b.innerText = "CAJA ABIERTA";
    } else {
        b.className = "badge-apple badge-rose";
        b.innerText = "CAJA CERRADA";
    }
    renderizarCarrito();
}

function renderHistorialCaja() {
    const id = document.getElementById('cajaHistorialFiltroSucursal')?.value, list = document.getElementById('listaHistorialCaja');
    if (!list) return;
    const h = (window.db.caja[id] && window.db.caja[id].historial) || [];
    list.innerHTML = h.map(x => `<div class="card-apple p-3 text-xs flex justify-between items-center">
        <div>
            <b class="text-white">${escapeHTML(x.fecha)}</b>
            <p class="text-slate-400 mt-0.5">Resp: ${escapeHTML(x.responsable)}</p>
        </div>
        <div class="text-right">
            <p class="text-slate-400 tabular-nums">Sistema: ${formatoGs(x.teoricoSistema)} | Depósito: ${formatoGs(x.depositoDeclarado)}</p>
            <p class="font-bold tabular-nums ${x.diferencia < 0 ? 'text-rose-400' : 'text-emerald-400'}">Dif: ${formatoGs(x.diferencia)}</p>
        </div>
    </div>`).join('') || '<p class="text-xs text-slate-500">No hay cierres previos.</p>';
}

// ==================== BALANCE & AUDITORÍA ====================
function generarInformesGerenciales() {
    const sel = document.getElementById('balanceSucursal');
    if (!sel) return;
    const idSuc = sel.value || 'TODAS';
    const b = PRISMA_CORE.balance(window.db, idSuc);
    document.getElementById('listaConciliacion').innerHTML = `
        <li class="flex justify-between border-b border-slate-800/60 pb-1.5"><span class="font-medium text-slate-400">Sucursal:</span><span class="font-bold text-white">${escapeHTML(b.sucursal)}</span></li>
        <li class="flex justify-between py-1"><span class="text-slate-300">Ventas brutas (${b.cantidadVentas} líneas):</span><span class="text-emerald-400 font-bold tabular-nums">${formatoGs(b.totalVentas)}</span></li>
        <li class="flex justify-between py-1"><span class="text-slate-300">Cobros cuenta corriente:</span><span class="text-teal-400 font-bold tabular-nums">${formatoGs(b.totalCobros)}</span></li>
        <li class="flex justify-between py-1"><span class="text-slate-300">Compras de stock:</span><span class="text-rose-400 font-bold tabular-nums">-${formatoGs(b.totalCompras)}</span></li>
        <li class="flex justify-between py-1"><span class="text-slate-300">Gastos:</span><span class="text-rose-400 font-bold tabular-nums">-${formatoGs(b.totalGastos)}</span></li>
        <li class="flex justify-between border-b border-slate-800/60 py-1"><span class="text-slate-300">Comisiones:</span><span class="text-indigo-400 font-bold tabular-nums">-${formatoGs(b.totalComisiones)}</span></li>
        <li class="flex justify-between py-1.5"><span class="text-slate-300">Valor stock en depósito (costo):</span><span class="font-bold text-cyan-300 tabular-nums">${formatoGs(b.valorStock)}</span></li>
        <li class="flex justify-between pt-2 font-black text-lg border-t border-slate-800"><span class="text-white">Resultado neto:</span><span class="${b.neto < 0 ? 'text-rose-400' : 'text-emerald-400'} tabular-nums">${formatoGs(b.neto)}</span></li>`;

    try {
        const ctx = document.getElementById('graficoVentas');
        if (ctx) {
            let vS = {};
            window.db.ventas.filter(v => !v.esCobroDeuda && (idSuc === 'TODAS' || v.idSuc === idSuc)).forEach(v => {
                vS[v.nombreSuc] = (vS[v.nombreSuc] || 0) + v.total;
            });
            if (graficoChartJS) graficoChartJS.destroy();
            graficoChartJS = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: Object.keys(vS),
                    datasets: [{ label: 'Ventas Gs.', data: Object.values(vS), backgroundColor: '#06b6d4', borderRadius: 8 }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                    }
                }
            });
        }
    } catch (e) { }
    renderAuditoria();
}

function renderAuditoria() {
    const cont = document.getElementById('auditoriaVentasLista');
    if (!cont) return;
    const idSuc = document.getElementById('balanceSucursal')?.value || 'TODAS';
    const q = (document.getElementById('buscadorAuditoria')?.value || '').toLowerCase();
    const grupos = agruparVentas(window.db.ventas.filter(v => !v.esCobroDeuda && (idSuc === 'TODAS' || v.idSuc === idSuc)))
        .filter(g => !q || (g.cliente + ' ' + g.vendedor + ' ' + g.fecha).toLowerCase().includes(q));

    cont.innerHTML = grupos.slice(0, 100).map(g => `<div onclick="verFacturaEnPantalla('${g.idGrp}')" class="card-apple p-3 mb-2 flex justify-between items-center cursor-pointer hover:border-cyan-500/40">
        <div>
            <b class="text-white text-xs">${escapeHTML(g.fecha)} | ${escapeHTML(g.nombreSuc || '')}</b>
            <p class="text-[11px] text-slate-400 mt-0.5">Cli: ${escapeHTML(g.cliente)} · Vend: ${escapeHTML(g.vendedor)} (${g.items.length} ítems)</p>
        </div>
        <div class="text-right">
            <span class="font-bold text-emerald-400 tabular-nums">${formatoGs(g.total)}</span><br>
            <span class="text-[10px] text-teal-400 font-semibold">👁️ Ver factura</span>
        </div></div>`).join('') || '<p class="text-xs text-slate-500">Sin ventas registradas.</p>';
}

function imprimirBalance() {
    const idSuc = document.getElementById('balanceSucursal').value || 'TODAS';
    const b = PRISMA_CORE.balance(window.db, idSuc);
    const cuerpo = `<table style="${estiloTabla}"><tbody>
        <tr><td style="${td}"><b>Sucursal</b></td><td style="${td}">${escapeHTML(b.sucursal)}</td></tr>
        <tr><td style="${td}">Ventas brutas</td><td style="${td};text-align:right">${formatoGs(b.totalVentas)}</td></tr>
        <tr><td style="${td}">Cobros cuenta corriente</td><td style="${td};text-align:right">${formatoGs(b.totalCobros)}</td></tr>
        <tr><td style="${td}">Compras de stock</td><td style="${td};text-align:right">-${formatoGs(b.totalCompras)}</td></tr>
        <tr><td style="${td}">Gastos</td><td style="${td};text-align:right">-${formatoGs(b.totalGastos)}</td></tr>
        <tr><td style="${td}">Comisiones</td><td style="${td};text-align:right">-${formatoGs(b.totalComisiones)}</td></tr>
        <tr><td style="${td}">Valor del stock a costo</td><td style="${td};text-align:right">${formatoGs(b.valorStock)}</td></tr>
        <tr><td style="${td}"><b>RESULTADO NETO</b></td><td style="${td};text-align:right"><b>${formatoGs(b.neto)}</b></td></tr></tbody></table>`;
    imprimirA4('BALANCE GENERAL', cuerpo, b.sucursal);
}

// ==================== INFORMES GERENCIALES ====================
window.invSortCol = 'producto'; window.invSortAsc = true; window.inventarioDataCache = [];
window.ordenarInventario = function (col) {
    if (window.invSortCol === col) window.invSortAsc = !window.invSortAsc;
    else { window.invSortCol = col; window.invSortAsc = true; }
    ['producto', 'sucursal', 'stock'].forEach(c => {
        const el = document.getElementById('sort_' + c);
        if (el) el.innerText = c === col ? (window.invSortAsc ? '🔼' : '🔽') : '';
    });
    renderizarTablaInventario();
};

function inventarioOrdenado(forzarAlfabetico) {
    let d = window.inventarioDataCache.slice();
    const bs = (document.getElementById('buscadorInventario')?.value || '').toLowerCase();
    if (bs) d = d.filter(i => i.producto.toLowerCase().includes(bs));
    if (forzarAlfabetico) return d.sort((a, b) => a.producto.localeCompare(b.producto, 'es', { sensitivity: 'base' }) || a.sucursal.localeCompare(b.sucursal, 'es'));
    const col = window.invSortCol, asc = window.invSortAsc;
    return d.sort((a, b) => {
        let vA = a[col], vB = b[col];
        if (typeof vA === 'string') {
            const r = vA.localeCompare(vB, 'es', { sensitivity: 'base' });
            return asc ? r : -r;
        }
        return asc ? vA - vB : vB - vA;
    });
}

window.renderizarTablaInventario = function () {
    const body = document.getElementById('infoInventarioBody');
    if (!body) return;
    body.innerHTML = inventarioOrdenado(false).map(i => `<tr class="border-b border-slate-800/40 hover:bg-white/[0.02]">
        <td class="p-3 font-medium text-white">${escapeHTML(i.producto)}</td>
        <td class="p-3 text-slate-300">${escapeHTML(i.sucursal)}</td>
        <td class="p-3 text-center font-bold tabular-nums text-cyan-400">${i.stock}</td>
        <td class="p-3 border-x border-slate-800/40"></td>
        <td class="p-3"></td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-center p-8 text-slate-500">Sin datos de inventario</td></tr>';
};

window.generarInformesAvanzados = function () {
    const sel = document.getElementById('filtroInfoSucursal');
    if (!sel) return;
    const fS = sel.value || 'TODAS';
    let vD = window.db.ventas.filter(v => !v.esCobroDeuda && (fS === 'TODAS' || v.idSuc === fS));
    let rS = {}, rV = {}, rC = {}, rP = {};
    vD.forEach(v => {
        rS[v.nombreSuc] = (rS[v.nombreSuc] || 0) + v.total;
        rV[v.vendedor] = (rV[v.vendedor] || 0) + v.total;
        rC[v.nombreCliente] = (rC[v.nombreCliente] || 0) + v.total;
        if (!rP[v.idProd]) rP[v.idProd] = { nombre: v.nombreProd, cant: 0, total: 0 };
        rP[v.idProd].cant += v.cant;
        rP[v.idProd].total += v.total;
    });

    const linea = (k, val) => `<div class="flex justify-between py-1.5 border-b border-slate-800/40 text-xs"><span class="text-slate-300">${escapeHTML(k)}</span><b class="text-white tabular-nums">${formatoGs(val)}</b></div>`;
    document.getElementById('infoVentasSucursal').innerHTML = Object.entries(rS).sort((a, b) => b[1] - a[1]).map(([s, t]) => linea(s, t)).join('') || '<p class="text-slate-500 text-xs">Sin datos</p>';
    document.getElementById('infoTopVendedores').innerHTML = Object.entries(rV).sort((a, b) => b[1] - a[1]).map(([v, t], i) => linea((i + 1) + '. ' + v, t)).join('') || '<p class="text-slate-500 text-xs">Sin datos</p>';
    document.getElementById('infoTopClientes').innerHTML = Object.entries(rC).sort((a, b) => b[1] - a[1]).map(([c, t], i) => linea((i + 1) + '. ' + c, t)).join('') || '<p class="text-slate-500 text-xs">Sin datos</p>';

    let sP = Object.values(rP);
    const lP = parseInt(document.getElementById('limiteTopProductos')?.value || 5);
    sP.sort((a, b) => (document.getElementById('ordenTopProductos')?.value || 'desc') === 'desc' ? b.cant - a.cant : a.cant - b.cant);
    document.getElementById('infoTopProductos').innerHTML = sP.slice(0, lP).map((p, i) => `<div class="flex justify-between py-1.5 border-b border-slate-800/40 text-xs">
        <div><b class="text-white">${i + 1}. ${escapeHTML(p.nombre)}</b><br><span class="text-[10px] text-slate-400">Cant: ${p.cant}</span></div>
        <b class="text-emerald-400 tabular-nums">${formatoGs(p.total)}</b>
    </div>`).join('') || '<p class="text-slate-500 text-xs">Sin ventas</p>';

    let dS = window.db.productos.filter(p => !rP[p.id]).map(p => ({
        nombre: p.nombre,
        stock: fS === 'TODAS' ? PRISMA_CORE.stockTotal(window.db, p.id) : PRISMA_CORE.stockEn(window.db, fS, p.id)
    }));
    const lD = parseInt(document.getElementById('limiteDeadStock')?.value || 5);
    dS.sort((a, b) => (document.getElementById('ordenDeadStock')?.value || 'stock_desc') === 'stock_desc' ? b.stock - a.stock : a.stock - b.stock);
    document.getElementById('infoDeadStock').innerHTML = dS.slice(0, lD).map((p, i) => `<div class="flex justify-between py-1.5 border-b border-slate-800/40 text-xs text-rose-400">
        <span>🚫 ${i + 1}. ${escapeHTML(p.nombre)}</span><b class="tabular-nums">Stock: ${p.stock}</b>
    </div>`).join('') || '<p class="text-slate-500 text-xs">Todo el stock tiene rotación.</p>';

    window.inventarioDataCache = [];
    (fS === 'TODAS' ? window.db.sucursales : window.db.sucursales.filter(s => s.id === fS)).forEach(s => {
        ordenarAlfa(window.db.productos, 'nombre').forEach(p => {
            window.inventarioDataCache.push({ producto: p.nombre, sucursal: s.nombre, stock: s.inventario[p.id] || 0 });
        });
    });
    renderizarTablaInventario();
};

function pedirSucursalParaImprimir() {
    const sel = document.getElementById('selectSucursalImpresion');
    sel.innerHTML = '<option value="TODAS">TODAS las sucursales (consolidado)</option>' + ordenarAlfa(window.db.sucursales, 'nombre').map(s => `<option value="${s.id}">${escapeHTML(s.nombre)}</option>`).join('');
    sel.value = document.getElementById('filtroInfoSucursal').value || 'TODAS';
    document.getElementById('modalElegirSucursal').classList.remove('hidden');
}

function confirmarImpresionInventario() {
    const id = document.getElementById('selectSucursalImpresion').value;
    document.getElementById('modalElegirSucursal').classList.add('hidden');
    document.getElementById('filtroInfoSucursal').value = id;
    generarInformesAvanzados();
    const datos = inventarioOrdenado(true);
    const cuerpo = `<table style="${estiloTabla}"><thead><tr><th style="${th}">Producto</th><th style="${th}">Sucursal</th><th style="${th}">Stock sistema</th><th style="${th}">Conteo físico</th><th style="${th}">Observación</th></tr></thead><tbody>
        ${datos.map(i => `<tr><td style="${td}">${escapeHTML(i.producto)}</td><td style="${td}">${escapeHTML(i.sucursal)}</td><td style="${td};text-align:center">${i.stock}</td><td style="${td};width:70px"></td><td style="${td};width:120px"></td></tr>`).join('')}</tbody></table>`;
    imprimirA4('CONTROL DE INVENTARIO (orden alfabético)', cuerpo, id === 'TODAS' ? 'Todas las sucursales' : nombreSuc(id));
}

function exportarExcel() {
    let csv = "Fecha,Sucursal,Vendedor,Cliente,Producto,Cantidad,PrecioUnit,Total,Pago\n";
    window.db.ventas.forEach(v => {
        csv += `"${v.fecha}","${v.nombreSuc}","${v.vendedor}","${v.nombreCliente}","${v.nombreProd}",${v.cant},${v.precioUnit || ''},${v.total},"${v.pago}"\n`;
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `Ventas_${hoyISO()}.csv`;
    a.click();
}

// ==================== SISTEMA (INFORMÁTICO) ====================
function renderSistema() {
    const lic = window.db.config.licencia;
    document.getElementById('licTecnico').value = lic.tecnico || '';
    document.getElementById('licContacto').value = lic.contacto || '';
    document.getElementById('licMonto').value = lic.monto || 0;
    document.getElementById('licVencimiento').value = lic.vencimiento || '';
    document.getElementById('licGracia').value = typeof lic.gracia === 'number' ? lic.gracia : 3;
    document.getElementById('licActiva').value = lic.activa ? 'si' : 'no';
    const est = PRISMA_CORE.licenciaEstado(lic, hoyISO());
    document.getElementById('estadoLicenciaBox').innerHTML = `<div class="p-3.5 rounded-xl border ${est.bloqueado ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : est.vencida ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}">
        <b class="text-sm">${est.bloqueado ? '🔒 SISTEMA SUSPENDIDO' : est.vencida ? '⚠️ PERÍODO DE GRACIA' : '✅ SERVICIO VIGENTE'}</b>
        <p class="text-xs mt-1">${escapeHTML(est.mensaje)}</p>
    </div>`;
    document.getElementById('historialPagosLic').innerHTML = (lic.historialPagos || []).map(p => `<div class="bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs">💰 ${escapeHTML(p.fecha)} · ${formatoGs(p.monto)} · nuevo vto: ${escapeHTML(p.nuevoVencimiento)}</div>`).join('') || '<p class="text-slate-500 text-xs">Sin pagos registrados.</p>';
    document.getElementById('diagnosticoDB').innerHTML = diagnostico();
    renderFacturacionElectronica();
    renderBackupAuto();
    renderAuditoriaSistema();
    renderSeguridadServidor();
}

function renderSeguridadServidor() {
    const cont = document.getElementById('seguridadServidorWrap');
    if (!cont) return;
    const activa = !!window.db.config.seguridadServidorActiva;
    const conectada = !!window.__sesionSeguraActiva;
    if (activa) {
        cont.innerHTML = `<div class="p-3.5 rounded-xl border ${conectada ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}">
            <b>${conectada ? '✅ Servidor de seguridad conectado' : '⚠️ Seguridad activa (esperando conexión)'}</b>
            <p class="text-xs mt-1">El inicio de sesión se valida contra Cloud Functions y Firestore. Modo local IndexedDB garantizado ante caídas de internet.</p>
        </div>`;
        return;
    }
    if (usuarioActual.rol !== 'informatico') {
        cont.innerHTML = `<p class="text-xs text-slate-500">🛡️ Sólo el informático puede activar la verificación remota de seguridad.</p>`;
        return;
    }
    cont.innerHTML = `<p class="text-xs text-slate-400 mb-2">Despliega las Cloud Functions y las reglas de Firestore antes de activar. Los hashes y sales permanecerán protegidos.</p>
        <button onclick="activarSeguridadServidorUI()" class="btn-apple btn-apple-indigo text-xs py-2 w-full">🔒 Activar verificación segura en el servidor</button>`;
}

window.activarSeguridadServidorUI = async function () {
    if (usuarioActual.rol !== 'informatico') return mostrarAlerta("⛔ Sólo el informático puede activar esto", "error");
    if (!navigator.onLine) return mostrarAlerta("❌ Necesita conexión a internet", "error");
    if (!window.inicializarSeguridadCloud) return mostrarAlerta("❌ No se encontró el módulo de seguridad", "error");
    const r = await window.inicializarSeguridadCloud(window.db.config.salPin, window.db.config.masterPinHash);
    if (!r.ok) return mostrarAlerta("⛔ " + r.error, "error");
    window.db.config.seguridadServidorActiva = true;
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'ACTIVAR SEGURIDAD SERVIDOR', 'sistema', '');
    await guardarDB(false);
    renderSeguridadServidor();
    mostrarAlerta("🔒 Seguridad de servidor activada");
};

function diagnostico() {
    const probs = PRISMA_CORE.verificarIntegridad(window.db);
    const l = [
        `almacenamiento: IndexedDB (PuntoPrismaDB_v28)`,
        `productos: ${window.db.productos.length}`,
        `sucursales: ${window.db.sucursales.length}`,
        `proveedores: ${window.db.proveedores.length}`,
        `clientes: ${window.db.clientes.length}`,
        `empleados: ${window.db.empleados.length}`,
        `ventas: ${window.db.ventas.length}`,
        `compras: ${window.db.compras.length}`,
        `remitos: ${window.db.traslados.length}`,
        `gastos: ${window.db.gastos.length}`,
        `conexión: ${navigator.onLine ? 'ONLINE' : 'OFFLINE'}`
    ];
    return l.map(x => '&gt; ' + x).join('<br>') + '<br>&gt; integridad: ' + (probs.length ? '<span style="color:#fb7185">' + probs.length + ' problema(s)</span><br>' + probs.map(p => '&nbsp;&nbsp;✗ ' + escapeHTML(p)).join('<br>') : '<span style="color:#34d399">OK (BLINDADO)</span>');
}

function guardarLicencia(e) {
    e.preventDefault();
    if (!exigir('sistema')) return;
    window.db.config.licencia = Object.assign(window.db.config.licencia || {}, {
        tecnico: document.getElementById('licTecnico').value.trim().toUpperCase(), contacto: document.getElementById('licContacto').value.trim(),
        monto: parseFloat(document.getElementById('licMonto').value) || 0, vencimiento: document.getElementById('licVencimiento').value,
        gracia: parseInt(document.getElementById('licGracia').value) || 0, activa: document.getElementById('licActiva').value === 'si'
    });
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'CONTRATO MANTENIMIENTO', 'sistema', 'Actualizado');
    guardarDB(false);
    renderSistema();
    chequearLicencia();
    mostrarAlerta("📄 Contrato actualizado");
}

function registrarPagoMantenimiento() {
    if (!exigir('sistema')) return;
    const lic = window.db.config.licencia;
    const base = new Date(); base.setDate(base.getDate() + 30);
    const nuevo = base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0') + '-' + String(base.getDate()).padStart(2, '0');
    lic.historialPagos = lic.historialPagos || [];
    lic.historialPagos.unshift({ fecha: new Date().toLocaleString('es-PY'), monto: lic.monto || 0, nuevoVencimiento: nuevo, registradoPor: usuarioActual.nombre });
    lic.vencimiento = nuevo;
    window.db.gastos.unshift({ id: genID(), fecha: new Date().toLocaleString('es-PY'), categoria: 'MANTENIMIENTO SISTEMA', idSuc: '', sucursal: 'ADMINISTRACIÓN', detalle: 'PAGO MANTENIMIENTO SISTEMA', monto: lic.monto || 0, usuario: usuarioActual.nombre });
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'PAGO MANTENIMIENTO', 'sistema', formatoGs(lic.monto || 0));
    guardarDB(false);
    renderSistema();
    chequearLicencia();
    mostrarAlerta("💰 Pago registrado. 30 días de servicio.");
}

function descargarBackup() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(window.db, null, 2)], { type: 'application/json' }));
    a.download = `Backup_Prisma_${hoyISO()}.json`;
    a.click();
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'BACKUP MANUAL', 'sistema', 'Descargado');
    guardarDB(false);
}

function restaurarBackup(e) {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async (evt) => {
        try {
            const nuevo = JSON.parse(evt.target.result);
            if (!nuevo.productos || !nuevo.sucursales) throw new Error('formato');
            PRISMA_CORE.registrarAuditoria(nuevo, usuarioActual, 'RESTAURAR BACKUP', 'sistema', 'Desde archivo');
            window.db = PRISMA_CORE.migrar(nuevo);
            await PrismaDB.setDBState(window.db);
            if (navigator.onLine && window.sincronizarTodoEnNube) await window.sincronizarTodoEnNube();
            mostrarAlerta("♻️ Backup restaurado. Recargando...");
            setTimeout(() => location.reload(), 1500);
        } catch (err) {
            mostrarAlerta("❌ Archivo de backup inválido", "error");
        }
    };
    r.readAsText(f);
}

async function forzarSincronizacion() {
    if (!navigator.onLine) return mostrarAlerta("❌ Sin conexión", "error");
    if (window.sincronizarTodoEnNube) {
        await window.sincronizarTodoEnNube();
        mostrarAlerta("🔄 Sincronización writeBatch enviada a la nube");
    }
}

function repararBaseDatos() {
    let arreglos = 0;
    window.db.sucursales.forEach(s => {
        for (const pid in s.inventario) {
            if (s.inventario[pid] < 0) { s.inventario[pid] = 0; arreglos++; }
            if (!window.db.productos.find(p => p.id === pid)) { delete s.inventario[pid]; arreglos++; }
        }
    });
    window.db.traslados = window.db.traslados.filter(t => t.items && t.items.length);
    window.db.compras = window.db.compras.filter(c => c.items && c.items.length);
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'REPARAR BASE', 'sistema', arreglos + ' correcciones');
    PRISMA_CORE.migrar(window.db);
    guardarDB(false);
    renderSistema();
    mostrarAlerta(`🧰 Integridad verificada (${arreglos} correcciones)`);
}

function reiniciarBaseDatos() {
    if (!exigir('sistema')) return;
    if (!confirm("Esto reinicia la base de datos local. ¿Continuar?")) return;
    if (prompt("Escriba BORRAR para confirmar:") !== 'BORRAR') return mostrarAlerta("Cancelado");
    localStorage.removeItem('puntoPrismaDB_v27');
    localStorage.removeItem('puntoPrismaDB_v17');
    indexedDB.deleteDatabase('PuntoPrismaDB_v28');
    location.reload();
}

function renderFacturacionElectronica() {
    const cont = document.getElementById('feWrap');
    if (!cont) return;
    const fe = window.db.config.facturacionElectronica;
    const esInfo = usuarioActual.rol === 'informatico';
    let html = `<div class="p-3.5 rounded-xl mb-3 border ${fe.habilitada ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'}">
        <b>${fe.habilitada ? '✅ Facturación electrónica habilitada' : 'Facturación electrónica deshabilitada'}</b>
        ${fe.habilitada ? `<br><span class="text-xs">Timbrado ${escapeHTML(fe.timbrado)} · Est. ${escapeHTML(fe.establecimiento)}-${escapeHTML(fe.puntoExpedicion)}</span>` : ''}
    </div>`;
    if (esInfo) {
        html += `<form onsubmit="habilitarFacturacionElectronicaUI(event)" class="space-y-2">
            <input id="feTimbrado" placeholder="Nº de timbrado" value="${escapeHTML(fe.timbrado)}" required class="input-apple text-xs">
            <div class="grid grid-cols-2 gap-2">
                <input id="feEstablecimiento" placeholder="Est. (001)" value="${escapeHTML(fe.establecimiento)}" class="input-apple text-xs">
                <input id="fePuntoExp" placeholder="Pto. Exp. (001)" value="${escapeHTML(fe.puntoExpedicion)}" class="input-apple text-xs">
            </div>
            <div class="flex gap-2">
                <button type="submit" class="btn-apple btn-apple-emerald text-xs py-2 flex-1">${fe.habilitada ? 'Actualizar' : 'Habilitar'}</button>
                ${fe.habilitada ? `<button type="button" onclick="deshabilitarFacturacionElectronicaUI()" class="btn-apple btn-apple-danger text-xs py-2 flex-1">Deshabilitar</button>` : ''}
            </div>
        </form>`;
    }
    cont.innerHTML = html;
}

window.habilitarFacturacionElectronicaUI = async function (e) {
    e.preventDefault();
    const r = PRISMA_CORE.habilitarFacturacionElectronica(window.db, usuarioActual, {
        timbrado: document.getElementById('feTimbrado').value.trim(),
        establecimiento: document.getElementById('feEstablecimiento').value.trim() || '001',
        puntoExpedicion: document.getElementById('fePuntoExp').value.trim() || '001',
        fecha: hoyISO()
    });
    if (!r.ok) return mostrarAlerta("⛔ " + r.error, "error");
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'HABILITAR FE', 'sistema', window.db.config.facturacionElectronica.timbrado);
    await guardarDB(false);
    renderFacturacionElectronica();
    mostrarAlerta("🧾 Facturación electrónica actualizada");
};

window.deshabilitarFacturacionElectronicaUI = async function () {
    const r = PRISMA_CORE.deshabilitarFacturacionElectronica(window.db, usuarioActual);
    if (!r.ok) return mostrarAlerta("⛔ " + r.error, "error");
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'DESHABILITAR FE', 'sistema', '');
    await guardarDB(false);
    renderFacturacionElectronica();
    mostrarAlerta("🧾 Facturación electrónica deshabilitada");
};

function renderBackupAuto() {
    const cont = document.getElementById('backupAutoWrap');
    if (!cont) return;
    const b = window.db.config.backupAuto;
    cont.innerHTML = `<label class="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-2">
        <input type="checkbox" ${b.activo ? 'checked' : ''} onchange="toggleBackupAutoUI(this.checked)" class="accent-teal-500 rounded">
        Copia de seguridad automática diaria
    </label>
    <p class="text-[11px] text-slate-500">${b.ultimoBackup ? 'Último respaldo: ' + escapeHTML(b.ultimoBackup) : 'Sin respaldos previos.'}</p>`;
}

window.toggleBackupAutoUI = async function (valor) {
    window.db.config.backupAuto.activo = valor;
    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, valor ? 'ACTIVAR BACKUP AUTO' : 'DESACTIVAR BACKUP AUTO', 'sistema', '');
    await guardarDB(false);
    renderBackupAuto();
    mostrarAlerta(valor ? "🗓️ Backup automático activado" : "Backup automático desactivado");
};

function ejecutarBackupAutomaticoSiCorresponde() {
    if (!window.db.config.backupAuto || !PRISMA_CORE.necesitaBackupAuto(window.db, hoyISO())) return;
    const clave = 'prismaBackupAuto_' + hoyISO();
    try { localStorage.setItem(clave, JSON.stringify(window.db)); } catch (err) { }
    window.db.config.backupAuto.ultimoBackup = hoyISO();
    PRISMA_CORE.registrarAuditoria(window.db, { nombre: 'SISTEMA', rol: '' }, 'BACKUP AUTOMÁTICO', 'sistema', clave);
    guardarDB(false);
}

function renderAuditoriaSistema() {
    const cont = document.getElementById('auditoriaWrap');
    if (!cont) return;
    if (!PRISMA_CORE.esAltoMando(usuarioActual)) { cont.innerHTML = ''; return; }
    const q = (document.getElementById('buscadorAuditoriaSistema')?.value || '').toLowerCase();
    const lista = (window.db.auditoria || []).filter(a => !q || (a.usuario + ' ' + a.accion + ' ' + a.entidad + ' ' + a.detalle).toLowerCase().includes(q)).slice(0, 150);
    cont.innerHTML = `<input id="buscadorAuditoriaSistema" oninput="renderAuditoriaSistema()" placeholder="Filtrar por usuario, acción o detalle..." class="input-apple text-xs mb-2.5" value="${escapeHTML(q)}">
        <div class="max-h-72 overflow-y-auto custom-scrollbar space-y-1.5">${lista.map(a => `<div class="card-apple p-2 text-[11px] border border-slate-800">
            <div class="flex justify-between items-center"><b class="text-white">${escapeHTML(a.usuario)}</b><span class="text-slate-500 text-[10px]">${new Date(a.fecha).toLocaleString('es-PY')}</span></div>
            <p class="text-slate-400 mt-0.5"><span class="badge-apple badge-teal text-[10px]">${escapeHTML(a.accion)}</span> ${escapeHTML(a.entidad)} ${a.detalle ? '· ' + escapeHTML(a.detalle) : ''}</p>
        </div>`).join('') || '<p class="text-slate-500 text-xs">Sin actividad registrada.</p>'}</div>`;
}

function renderAlertaStockMinimo() {
    const badge = document.getElementById('badgeStockMinimo'), wrap = document.getElementById('btnStockMinimo');
    if (!badge || !wrap) return;
    const idSuc = (usuarioActual.isMaster || PRISMA_CORE.esAdmin(usuarioActual.rol)) ? 'TODAS' : usuarioActual.idSuc;
    const alertas = PRISMA_CORE.productosBajoMinimo(window.db, idSuc);
    if (!alertas.length) {
        wrap.classList.add('hidden');
        window.__alertasStockActuales = [];
        return;
    }
    wrap.classList.remove('hidden');
    badge.innerText = alertas.length;
    window.__alertasStockActuales = alertas;
}

window.verAlertasStockMinimo = function () {
    const alertas = window.__alertasStockActuales || [];
    const cuerpo = `<table style="${estiloTabla}"><thead><tr><th style="${th}">Producto</th><th style="${th}">Sucursal</th><th style="${th}">Stock</th><th style="${th}">Mínimo</th></tr></thead><tbody>
        ${alertas.map(a => `<tr><td style="${td}">${escapeHTML(a.producto)}</td><td style="${td}">${escapeHTML(a.sucursal)}</td><td style="${td};text-align:center;color:#b91c1c;font-weight:bold">${a.stock}</td><td style="${td};text-align:center">${a.stockMin}</td></tr>`).join('') || `<tr><td style="${td}" colspan="4">Sin alertas</td></tr>`}</tbody></table>`;
    abrirDetalle('📦 Stock bajo el mínimo', cuerpo, alertas.length + ' alerta(s)');
};

// ==================== EDITOR UNIVERSAL ====================
const ETIQUETAS = { nombre: 'Nombre', apellido: 'Apellido', doc: 'Documento', tel: 'Teléfono', dir: 'Dirección', direccion: 'Dirección', ciudad: 'Ciudad', email: 'Email', contacto: 'Contacto', observaciones: 'Observaciones', detalle: 'Detalle', categoria: 'Categoría', unidad: 'Unidad', stockMin: 'Stock mínimo', costo: 'Costo', precio: 'Precio venta', condicion: 'Condición', domicilio: 'Domicilio', comision: 'Comisión %', pin: 'PIN', idSuc: 'Sucursal', rol: 'Rol', tipoDoc: 'Tipo doc.' };
const OCULTOS = ['id', 'qrCode', 'inventario', 'ventasTotal', 'comisionAcumulada', 'historial', 'deuda', 'estado', 'items', 'protegido', 'fechaAlta', 'activo', 'pinHash', 'dispositivoId', 'pin'];

window.abrirEditor = function (tabla, id) {
    const item = window.db[tabla].find(x => x.id === id);
    if (!item) return;
    if (tabla === 'empleados' && PRISMA_CORE.esProtegido(item) && usuarioActual.rol !== 'informatico') return mostrarAlerta("🛡️ Sólo el informático puede editar este usuario", "error");
    itemEnEdicion = { tabla, id, original: JSON.parse(JSON.stringify(item)) };
    let html = '';
    for (let key in item) {
        if (OCULTOS.includes(key) || typeof item[key] === 'object') continue;
        const lbl = ETIQUETAS[key] || key;
        if (tabla === 'empleados' && key === 'idSuc') {
            html += `<div class="mb-3"><label class="block text-xs font-semibold text-slate-300 uppercase mb-1">${lbl}</label><select id="edit_${key}" class="input-apple">${window.db.sucursales.map(s => `<option value="${s.id}" ${s.id === item[key] ? 'selected' : ''}>${escapeHTML(s.nombre)}</option>`).join('')}</select></div>`;
        } else if (tabla === 'empleados' && key === 'rol') {
            html += `<div class="mb-3"><label class="block text-xs font-semibold text-slate-300 uppercase mb-1">${lbl}</label><select id="edit_${key}" class="input-apple">${rolesSelectHTML(item[key], true)}</select></div>`;
        } else if (tabla === 'clientes' && key === 'sexo') {
            html += `<div class="mb-3"><label class="block text-xs font-semibold text-slate-300 uppercase mb-1">${lbl}</label><select id="edit_${key}" class="input-apple">${['', 'Femenino', 'Masculino', 'Otro'].map(r => `<option value="${r}" ${r === item[key] ? 'selected' : ''}>${r || 'Sin especificar'}</option>`).join('')}</select></div>`;
        } else if (tabla === 'clientes' && key === 'condicion') {
            html += `<div class="mb-3"><label class="block text-xs font-semibold text-slate-300 uppercase mb-1">${lbl}</label><select id="edit_${key}" class="input-apple">${['Contado', 'Crédito'].map(r => `<option value="${r}" ${r === item[key] ? 'selected' : ''}>${r}</option>`).join('')}</select></div>`;
        } else {
            html += `<div class="mb-3"><label class="block text-xs font-semibold text-slate-300 uppercase mb-1">${lbl}</label><input type="${typeof item[key] === 'number' ? 'number' : 'text'}" id="edit_${key}" value="${escapeHTML(item[key])}" class="input-apple"></div>`;
        }
    }
    if (tabla === 'empleados') {
        html += `<div class="mb-3">
            <label class="block text-xs font-semibold text-slate-300 uppercase mb-1">Cambiar PIN (4 dígitos)</label>
            <input type="password" id="edit_pin" maxlength="4" pattern="[0-9]{4}" placeholder="•••• (dejar en blanco para mantener)" class="input-apple text-center font-mono tracking-widest bg-slate-950/70">
            <p class="text-[10px] text-slate-500 mt-1">Ingrese 4 dígitos sólo si desea cambiar el PIN de este empleado</p>
        </div>`;
    }
    document.getElementById('formEditorUniversal').innerHTML = html;
    document.getElementById('modalEditorUniversal').classList.remove('hidden');
};

window.cerrarEditor = function () {
    document.getElementById('modalEditorUniversal').classList.add('hidden');
    itemEnEdicion = null;
};

window.guardarEdicion = async function (e) {
    if (e) e.preventDefault();
    if (!itemEnEdicion) return;
    const { tabla, id, original } = itemEnEdicion, ref = window.db[tabla].find(x => x.id === id);
    const val = k => document.getElementById('edit_' + k)?.value;

    const nuevoNombre = val('nombre');
    if (['sucursales', 'proveedores', 'productos'].includes(tabla) && nuevoNombre && PRISMA_CORE.nombreDuplicado(window.db[tabla], nuevoNombre, id)) {
        return mostrarAlerta("❌ Ya existe otro registro con ese nombre", "error");
    }
    if (tabla === 'productos') {
        const c = parseFloat(val('costo')), p = parseFloat(val('precio'));
        if (c > p) return mostrarAlerta("❌ El costo no puede superar el precio", "error");
    }
    if (tabla === 'empleados') {
        const docEd = val('doc'), pinEd = (val('pin') || '').trim();
        if (docEd && window.db.empleados.some(x => x.doc === docEd && x.id !== id)) return mostrarAlerta("❌ Cédula en uso", "error");
        if (pinEd) {
            if (!/^\d{4}$/.test(pinEd)) return mostrarAlerta("❌ El PIN debe tener 4 dígitos numéricos", "error");
            if (pinEd === '0000') return mostrarAlerta("❌ El PIN 0000 está reservado para la Gerencia Master", "error");
            if (pinEd === '6988' && val('rol') !== 'informatico' && original.rol !== 'informatico') {
                return mostrarAlerta("❌ El PIN 6988 está reservado para el Informático", "error");
            }
            if (PRISMA_CORE.pinDuplicado(window.db, pinEd, id)) return mostrarAlerta("❌ PIN en uso", "error");
        }
        if (PRISMA_CORE.esProtegido(original) && val('rol') !== 'informatico') return mostrarAlerta("🛡️ No se puede quitar el rol informático", "error");
        if (val('rol') && !window.db.config.roles[val('rol')]) return mostrarAlerta("❌ Rol inválido", "error");
    }
    if (tabla === 'clientes') {
        const d = val('doc');
        if (d && window.db.clientes.some(x => x.doc === d && x.id !== id)) return mostrarAlerta("❌ Documento en uso", "error");
    }

    const SIN_MAYUSCULAS = ['email', 'observaciones', 'detalle', 'pin', 'tel', 'doc', 'contacto'];
    for (let k in original) {
        if (k === 'pinHash' || k === 'dispositivoId' || k === 'pin') continue;
        const inp = document.getElementById('edit_' + k);
        if (!inp) continue;
        let v = inp.value;
        if (typeof original[k] === 'number') v = parseFloat(v) || 0;
        else if (['idSuc', 'rol', 'sexo', 'condicion', 'tipoDoc'].includes(k) || SIN_MAYUSCULAS.includes(k)) { /* tal cual */ }
        else v = String(v).toUpperCase();
        ref[k] = v;
    }

    if (tabla === 'empleados') {
        const pinEd = (val('pin') || '').trim();
        if (pinEd) {
            const sal = window.db.config.salPin || PRISMA_CORE.generarSal();
            window.db.config.salPin = sal;
            ref.pinHash = PRISMA_CORE.hashPin(pinEd, sal);
            delete ref.pin;
            PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'CAMBIAR PIN EMPLEADO', 'empleados', `${ref.nombre} ${ref.apellido}`);
            if (navigator.onLine && window.db.config.seguridadServidorActiva && window.asignarPinSeguro) {
                try { await window.asignarPinSeguro(ref.id, pinEd); } catch (err) { console.warn(err); }
            }
        }
    }

    PRISMA_CORE.registrarAuditoria(window.db, usuarioActual, 'EDITAR', tabla, ref.nombre || ref.id);
    await guardarDB();
    if (navigator.onLine && window.guardarItemEnNube) await window.guardarItemEnNube(tabla, ref);
    cerrarEditor();
    mostrarAlerta("✅ Registro actualizado");
};

// ==================== RENDER PRINCIPAL ====================
function setOpciones(id, html, mantener = true) {
    const el = document.getElementById(id); if (!el) return;
    const prev = el.value; el.innerHTML = html;
    if (mantener && prev && Array.from(el.options).some(o => o.value === prev)) el.value = prev;
}

function render() {
    if (!usuarioActual) {
        if (sessionStorage.getItem('prismaSession')) {
            usuarioActual = JSON.parse(sessionStorage.getItem('prismaSession'));
            return iniciarSesionExitoso();
        }
        return;
    }

    const esAdmin = usuarioActual.isMaster || PRISMA_CORE.esAdmin(usuarioActual.rol);
    const sucVisibles = esAdmin || usuarioActual.rol === 'comprador' || usuarioActual.rol === 'repartidor' ? window.db.sucursales : window.db.sucursales.filter(s => s.id === usuarioActual.idSuc);
    const optSuc = ordenarAlfa(sucVisibles, 'nombre').map(s => `<option value="${s.id}">${escapeHTML(s.nombre)}</option>`).join('');
    const optSucTodas = ordenarAlfa(window.db.sucursales, 'nombre').map(s => `<option value="${s.id}">${escapeHTML(s.nombre)}</option>`).join('');
    const optProd = ordenarAlfa(window.db.productos, 'nombre').map(p => `<option value="${p.id}">${escapeHTML(p.nombre)} (Total: ${PRISMA_CORE.stockTotal(window.db, p.id)})</option>`).join('');
    const optProv = ordenarAlfa(window.db.proveedores, 'nombre').map(p => `<option value="${p.id}">${escapeHTML(p.nombre)}</option>`).join('');
    const optCli = ordenarAlfa(window.db.clientes, 'apellido').map(c => `<option value="${c.id}">${escapeHTML(c.apellido + ', ' + c.nombre)} (${escapeHTML(c.condicion)})</option>`).join('');

    if (document.getElementById('ventaSucursal')) {
        setOpciones('ventaSucursal', (esAdmin ? '<option value="">-- Seleccione el local --</option>' : '') + optSuc);
        if (!esAdmin) document.getElementById('ventaSucursal').value = usuarioActual.idSuc;
        setOpciones('ventaCliente', optCli);
        actualizarVendedoresSucursal();
        verificarEstadoCajaPOS();
        renderizarHistorialFacturas();
    }

    setOpciones('compraDestino', optSucTodas);
    setOpciones('compraProveedor', optProv);
    setOpciones('compraProducto', optProd);
    setOpciones('filtroCompraProveedor', '<option value="TODOS">Todos los proveedores</option>' + optProv);
    setOpciones('empSucursal', optSucTodas);
    const elEmpRol = document.getElementById('empRol');
    if (elEmpRol) {
        elEmpRol.innerHTML = rolesSelectHTML('', false, true);
        mostrarAyudaRol();
    }
    if (document.getElementById('personal')?.classList.contains('activa')) renderMatrizPermisos();
    setOpciones('gastoSucursal', '<option value="">ADMINISTRACIÓN (sin sucursal)</option>' + optSucTodas);
    setOpciones('cajaSucursalApertura', optSuc);
    setOpciones('cajaSucursalCierre', optSuc);
    setOpciones('cajaHistorialFiltroSucursal', optSuc);
    verificarEfectivoCaja();
    renderHistorialCaja();
    setOpciones('trasOrigen', optSucTodas);
    setOpciones('trasDestino', optSucTodas);
    setOpciones('filtroMovSucursal', '<option value="TODAS">Todas las sucursales</option>' + optSucTodas);
    setOpciones('balanceSucursal', '<option value="TODAS">GENERAL (todas las sucursales)</option>' + optSucTodas);
    setOpciones('filtroInfoSucursal', '<option value="TODAS">Todas las sucursales (consolidado)</option>' + optSucTodas);
    actualizarProductosTraslado();

    const gridSuc = document.getElementById('listaSucursalesGrid');
    if (gridSuc) gridSuc.innerHTML = ordenarAlfa(window.db.sucursales, 'nombre').map(s => {
        const unidades = Object.values(s.inventario).reduce((a, b) => a + b, 0);
        const tipos = Object.values(s.inventario).filter(v => v > 0).length;
        return `<div class="card-apple p-4 flex flex-col justify-between">
            <div class="cursor-pointer" onclick="verSucursal('${s.id}')">
                <div class="flex justify-between items-start">
                    <b class="text-white text-base">${escapeHTML(s.nombre)}</b>
                    <span class="badge-apple badge-teal">${tipos} prods</span>
                </div>
                <p class="text-xs text-slate-400 mt-1">${escapeHTML(s.direccion || 'Sin dirección')}</p>
                <p class="text-xs text-slate-400">📞 ${escapeHTML(s.tel || 'S/T')}</p>
                <p class="text-xs text-slate-300 font-bold mt-2">Unidades físicas: <span class="tabular-nums text-emerald-400">${unidades}</span></p>
            </div>
            <div class="flex gap-2 mt-3 pt-3 border-t border-slate-800/60">
                <button onclick="verSucursal('${s.id}')" class="btn-apple btn-apple-secondary text-xs py-1.5 flex-1">👁️ Detalle</button>
                <button onclick="abrirEditor('sucursales','${s.id}')" class="btn-apple btn-apple-secondary text-xs py-1.5 px-3">✏️</button>
            </div></div>`;
    }).join('');

    const gridProv = document.getElementById('listaProveedores');
    if (gridProv) gridProv.innerHTML = ordenarAlfa(window.db.proveedores, 'nombre').map(p => `<div class="card-apple p-4 flex flex-col justify-between">
        <div class="cursor-pointer" onclick="verProveedor('${p.id}')">
            <b class="text-white text-base">${escapeHTML(p.nombre)}</b>
            <p class="text-xs text-slate-400 mt-1">RUC: <span class="tabular-nums">${escapeHTML(p.doc || 'S/D')}</span></p>
            <p class="text-xs text-slate-400">📞 ${escapeHTML(p.tel || 'S/D')} · ${escapeHTML(p.contacto || '')}</p>
        </div>
        <div class="flex gap-2 mt-3 pt-3 border-t border-slate-800/60">
            <button onclick="verProveedor('${p.id}')" class="btn-apple btn-apple-secondary text-xs py-1.5 flex-1">👁️ Ficha</button>
            <button onclick="abrirEditor('proveedores','${p.id}')" class="btn-apple btn-apple-secondary text-xs py-1.5 px-3">✏️</button>
        </div></div>`).join('');

    if (document.getElementById('listaClientes')) renderClientes();

    const listaEmp = document.getElementById('listaEmpleados');
    if (listaEmp) listaEmp.innerHTML = ordenarAlfa(window.db.empleados, 'nombre').map(e => {
        const prot = PRISMA_CORE.esProtegido(e);
        const infoRol = window.db.config.roles[e.rol];
        const puedeDesvincular = PRISMA_CORE.esAltoMando(usuarioActual) && !PRISMA_CORE.puedeUsarOtroDispositivo(e.rol) && e.dispositivoId;
        return `<div class="card-apple p-4 flex flex-col justify-between">
            <div>
                <div class="flex justify-between items-start">
                    <b class="text-white">${escapeHTML(e.nombre + ' ' + e.apellido)}</b>
                    ${prot ? '<span class="badge-apple badge-rose">🛡️ PROTEGIDO</span>' : `<span class="badge-apple ${e.estado === 'bloqueado' ? 'badge-rose' : 'badge-emerald'}">${e.estado}</span>`}
                </div>
                <p class="text-xs text-slate-400 mt-1">Doc: <span class="tabular-nums">${escapeHTML(e.doc)}</span> · <b>${escapeHTML((infoRol && infoRol.label) || e.rol)}</b></p>
                <p class="text-xs text-slate-400">${escapeHTML(nombreSuc(e.idSuc))} · Comisión ${e.comision || 0}%</p>
                ${e.dispositivoId ? '<p class="text-[10px] text-teal-400 mt-1">🔗 Dispositivo vinculado</p>' : ''}
            </div>
            <div class="flex gap-1.5 mt-3 pt-3 border-t border-slate-800/60 flex-wrap">
                <button onclick="abrirEditor('empleados','${e.id}')" class="btn-apple btn-apple-secondary text-xs py-1 px-2.5">✏️</button>
                ${!prot ? `<button onclick="toggleEstadoEmpleado('${e.id}')" class="btn-apple btn-apple-secondary text-xs py-1 px-2.5 flex-1">${e.estado === 'bloqueado' ? '🔓 Desbloquear' : '🔒 Suspender'}</button>
                <button onclick="eliminarEmpleado('${e.id}')" class="btn-apple btn-apple-danger text-xs py-1 px-2.5">🗑️</button>` : '<span class="text-[10px] text-rose-400 font-semibold py-1">Usuario protegido</span>'}
                ${puedeDesvincular ? `<button onclick="desvincularDispositivoUI('${e.id}')" class="btn-apple btn-apple-secondary text-[10px] py-1 w-full">🔓 Desvincular dispositivo</button>` : ''}
            </div></div>`;
    }).join('');

    const listaCompras = document.getElementById('listaCompras');
    if (listaCompras) {
        const f = document.getElementById('filtroCompraProveedor')?.value || 'TODOS';
        listaCompras.innerHTML = window.db.compras.filter(c => f === 'TODOS' || c.idProv === f).map(c => `<div onclick="verCompra('${c.id}')" class="card-apple p-3 flex justify-between items-center cursor-pointer hover:border-cyan-500/40">
            <div>
                <b class="text-white text-xs">${escapeHTML(c.nroCompra)} · ${escapeHTML(c.fecha)}</b>
                <p class="text-xs text-slate-300 mt-0.5">Prov: ${escapeHTML(c.proveedor)} → ${escapeHTML(c.sucursal || nombreSuc(c.idSuc))}</p>
                <p class="text-[11px] text-slate-400">${c.items.length} ítem(s) · ${c.items.reduce((a, b) => a + b.cant, 0)} u. por ${escapeHTML(c.usuario || 'S/D')}</p>
            </div>
            <div class="text-right">
                <b class="text-emerald-400 tabular-nums">${formatoGs(c.costoTotal)}</b><br>
                <span class="text-[10px] text-teal-400 font-semibold">👁️ Ver</span>
            </div></div>`).join('') || '<p class="text-xs text-slate-500">Sin compras registradas.</p>';
    }

    const listaGastos = document.getElementById('listaGastos');
    if (listaGastos) listaGastos.innerHTML = window.db.gastos.map(g => `<div class="card-apple p-3 flex justify-between items-center text-xs">
        <div>
            <span class="text-slate-400">${escapeHTML(g.fecha)} | <b class="text-slate-200">${escapeHTML(g.categoria)}</b> | ${escapeHTML(g.sucursal || 'ADMINISTRACIÓN')}</span>
            <p class="text-white font-medium mt-0.5">${escapeHTML(g.detalle)}</p>
        </div>
        <b class="text-rose-400 tabular-nums text-sm">${formatoGs(g.monto)}</b>
    </div>`).join('') || '<p class="text-xs text-slate-500">Sin gastos.</p>';

    if (document.getElementById('listaTraslados')) {
        renderRemitos();
        renderMovimientos();
        renderMatrizStock();
        renderRemito();
    }

    const tabla = document.getElementById('tablaProductos');
    if (tabla) {
        const q = (document.getElementById('buscadorCatalogo')?.value || '').toLowerCase();
        const prods = ordenarAlfa(window.db.productos.filter(p => p.nombre.toLowerCase().includes(q) || (p.categoria || '').toLowerCase().includes(q)), 'nombre');
        tabla.innerHTML = prods.map(p => {
            const total = PRISMA_CORE.stockTotal(window.db, p.id);
            const alerta = total <= (p.stockMin || 0);
            return `<tr class="border-b border-slate-800/40 hover:bg-white/[0.02]">
                <td class="p-3.5 cursor-pointer" onclick="verProducto('${p.id}')">
                    <b class="text-white">${escapeHTML(p.nombre)}</b>
                    <p class="text-[11px] text-slate-400">${escapeHTML(p.detalle || 'Sin detalle')}</p>
                </td>
                <td class="p-3.5 text-xs text-slate-300">${escapeHTML(p.categoria || '')}</td>
                <td class="p-3.5 tabular-nums text-slate-400">${formatoGs(p.costo)}</td>
                <td class="p-3.5 font-bold tabular-nums text-emerald-400">${formatoGs(p.precio)}</td>
                <td class="p-3.5 text-center font-bold tabular-nums">
                    <span class="badge-apple ${alerta ? 'badge-rose' : 'badge-emerald'}">${total}</span>
                </td>
                <td class="p-3.5">
                    <div id="qr_${p.id}" class="bg-white p-1 rounded inline-block"></div>
                    <button onclick="abrirEditor('productos','${p.id}')" class="btn-apple btn-apple-secondary text-[10px] py-1 px-2.5 block mt-1">✏️ Editar</button>
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="p-8 text-center text-slate-500">Sin productos</td></tr>';
        setTimeout(() => {
            prods.forEach(p => {
                const c = document.getElementById(`qr_${p.id}`);
                if (c && !c.hasChildNodes()) {
                    try { new QRCode(c, { text: p.qrCode || p.id, width: 40, height: 40 }); } catch (e) { }
                }
            });
        }, 80);
    }

    if (document.getElementById('informes')?.classList.contains('activa')) generarInformesGerenciales();
    if (document.getElementById('informesAvanzados')?.classList.contains('activa')) generarInformesAvanzados();
    if (document.getElementById('sistema')?.classList.contains('activa')) renderSistema();
    renderAlertaStockMinimo();
    chequearLicencia();
}

// ==================== ARRANQUE Y UTILIDAD NÚMERO A LETRAS ====================
const Unidades=n=>{switch(n){case 1:return'UN';case 2:return'DOS';case 3:return'TRES';case 4:return'CUATRO';case 5:return'CINCO';case 6:return'SEIS';case 7:return'SIETE';case 8:return'OCHO';case 9:return'NUEVE';default:return'';}};
const Decenas=n=>{let d=Math.floor(n/10),u=n-(d*10);switch(d){case 1:switch(u){case 0:return'DIEZ';case 1:return'ONCE';case 2:return'DOCE';case 3:return'TRECE';case 4:return'CATORCE';case 5:return'QUINCE';default:return'DIECI'+Unidades(u);}case 2:return u===0?'VEINTE':'VEINTI'+Unidades(u);case 3:return u>0?'TREINTA Y '+Unidades(u):'TREINTA';case 4:return u>0?'CUARENTA Y '+Unidades(u):'CUARENTA';case 5:return u>0?'CINCUENTA Y '+Unidades(u):'CINCUENTA';case 6:return u>0?'SESENTA Y '+Unidades(u):'SESENTA';case 7:return u>0?'SETENTA Y '+Unidades(u):'SETENTA';case 8:return u>0?'OCHENTA Y '+Unidades(u):'OCHENTA';case 9:return u>0?'NOVENTA Y '+Unidades(u):'NOVENTA';default:return Unidades(u);}};
const Centenas=n=>{let c=Math.floor(n/100),d=n-(c*100);switch(c){case 1:return d>0?'CIENTO '+Decenas(d):'CIEN';case 2:return'DOSCIENTOS '+Decenas(d);case 3:return'TRESCIENTOS '+Decenas(d);case 4:return'CUATROCIENTOS '+Decenas(d);case 5:return'QUINIENTOS '+Decenas(d);case 6:return'SEISCIENTOS '+Decenas(d);case 7:return'SETECIENTOS '+Decenas(d);case 8:return'OCHOCIENTOS '+Decenas(d);case 9:return'NOVECIENTOS '+Decenas(d);default:return Decenas(d);}};
const Miles=n=>{let c=Math.floor(n/1000),r=n-(c*1000),sm=c>0?(c>1?Centenas(c)+' MIL':'MIL'):'',sc=Centenas(r);return sm===''?sc:sm+' '+sc;};
const Millones=n=>{let c=Math.floor(n/1000000),r=n-(c*1000000),smi=c>0?(c>1?Centenas(c)+' MILLONES':'UN MILLON'):'',sm=Miles(r);return smi===''?sm:smi+' '+sm;};
function numeroALetras(num){num=Math.floor(num||0);if(num===0)return'CERO GUARANÍES';if(num<1000)return Centenas(num)+' GUARANÍES';if(num<1000000)return Miles(num)+' GUARANÍES';return Millones(num).trim()+' GUARANÍES';}

// Exponer variables y métodos globalmente
window.render = render;
window.guardarDB = guardarDB;
window.mostrarAlerta = mostrarAlerta;
window.abrirDetalle = abrirDetalle;
window.cerrarDetalle = cerrarDetalle;
window.imprimirDetalleActual = imprimirDetalleActual;
window.intentarLogin = intentarLogin;
window.cerrarSesion = cerrarSesion;
window.cambiarSeccion = cambiarSeccion;
window.toggleMenu = toggleMenu;
window.filtrarProductosPOS = filtrarProductosPOS;
window.seleccionarProductoPOS = seleccionarProductoPOS;
window.actualizarPrecioVenta = actualizarPrecioVenta;
window.agregarItemAlCarrito = agregarItemAlCarrito;
window.quitarDelCarrito = quitarDelCarrito;
window.prepararVenta = prepararVenta;
window.procesarVentaReal = procesarVentaReal;
window.cerrarModalFactura = cerrarModalFactura;
window.verFacturaEnPantalla = verFacturaEnPantalla;
window.lanzarReimpresion = lanzarReimpresion;
window.actualizarVendedoresSucursal = actualizarVendedoresSucursal;
window.procesarEscaneoQR = procesarEscaneoQR;
window.iniciarEscannerCamaraReal = iniciarEscannerCamaraReal;
window.detenerEscannerQR = detenerEscannerQR;
window.agregarItemRemito = agregarItemRemito;
window.quitarItemRemito = quitarItemRemito;
window.vaciarRemito = vaciarRemito;
window.actualizarProductosTraslado = actualizarProductosTraslado;
window.crearTraslado = crearTraslado;
window.verRemito = verRemito;
window.imprimirRemito = imprimirRemito;
window.renderRemitos = renderRemitos;
window.renderMovimientos = renderMovimientos;
window.imprimirMovimientos = imprimirMovimientos;
window.renderMatrizStock = renderMatrizStock;
window.imprimirMatrizStock = imprimirMatrizStock;
window.agregarSucursal = agregarSucursal;
window.verSucursal = verSucursal;
window.agregarProveedor = agregarProveedor;
window.verProveedor = verProveedor;
window.agregarProducto = agregarProducto;
window.verProducto = verProducto;
window.sugerirCostoCompra = sugerirCostoCompra;
window.agregarItemCompra = agregarItemCompra;
window.quitarItemCompra = quitarItemCompra;
window.vaciarCompra = vaciarCompra;
window.registrarCompra = registrarCompra;
window.verCompra = verCompra;
window.registrarGasto = registrarGasto;
window.agregarCliente = agregarCliente;
window.guardarClienteRapido = guardarClienteRapido;
window.filtrarPorLetra = filtrarPorLetra;
window.renderClientes = renderClientes;
window.verCliente = verCliente;
window.imprimirListadoClientes = imprimirListadoClientes;
window.mostrarAyudaRol = mostrarAyudaRol;
window.agregarEmpleado = agregarEmpleado;
window.abrirCaja = abrirCaja;
window.prepararDepositoCierre = prepararDepositoCierre;
window.verificarEfectivoCaja = verificarEfectivoCaja;
window.verificarEstadoCajaPOS = verificarEstadoCajaPOS;
window.renderHistorialCaja = renderHistorialCaja;
window.generarInformesGerenciales = generarInformesGerenciales;
window.imprimirBalance = imprimirBalance;
window.pedirSucursalParaImprimir = pedirSucursalParaImprimir;
window.confirmarImpresionInventario = confirmarImpresionInventario;
window.exportarExcel = exportarExcel;
window.guardarLicencia = guardarLicencia;
window.registrarPagoMantenimiento = registrarPagoMantenimiento;
window.descargarBackup = descargarBackup;
window.restaurarBackup = restaurarBackup;
window.forzarSincronizacion = forzarSincronizacion;
window.repararBaseDatos = repararBaseDatos;
window.reiniciarBaseDatos = reiniciarBaseDatos;
window.chequearLicencia = chequearLicencia;
window.renderAlertaStockMinimo = renderAlertaStockMinimo;
window.vaciarCarrito = vaciarCarrito;
window.renderizarHistorialFacturas = renderizarHistorialFacturas;
window.abrirModalCambiarPin = abrirModalCambiarPin;
window.cerrarModalCambiarPin = cerrarModalCambiarPin;
window.guardarNuevoPin = guardarNuevoPin;

// Inicializar IndexedDB e interfaz al cargar el script
inicializarPersistencia();

if (!sessionStorage.getItem('prismaSession')) {
    document.getElementById('modalLogin').classList.remove('hidden');
} else {
    usuarioActual = JSON.parse(sessionStorage.getItem('prismaSession'));
    iniciarSesionExitoso();
}
setInterval(() => {
    if (usuarioActual) {
        chequearLicencia();
        renderAlertaStockMinimo();
        ejecutarBackupAutomaticoSiCorresponde();
    }
}, 60000);
