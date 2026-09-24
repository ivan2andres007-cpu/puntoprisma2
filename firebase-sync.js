import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, deleteDoc, writeBatch, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

// Credenciales y configuración intacta de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyCGMzm-BS9qaMGNtxIoHpfbn-tVEdFqPf4",
    authDomain: "puntoprisma2.firebaseapp.com",
    projectId: "puntoprisma2",
    storageBucket: "puntoprisma2.firebasestorage.app",
    messagingSenderId: "414639636781",
    appId: "1:414639636781:web:795ccfd6fef2f51bee13a4",
    measurementId: "G-PFQVTYPTWR"
};
const app = initializeApp(firebaseConfig);
const dbCloud = getFirestore(app);
const authCloud = getAuth(app);
const fns = getFunctions(app);

const COLECCIONES = ["empleados", "productos", "sucursales", "proveedores", "clientes", "compras", "gastos", "traslados", "ventas"];
const CRONOLOGICAS = ["ventas", "compras", "gastos", "traslados"];

// Escucha en tiempo real sin romper flujo reactivo ni filtrado de credenciales
window.iniciarEscuchaEnVivo = function () {
    if (window.__escuchaActiva) return;
    window.__escuchaActiva = true;

    COLECCIONES.forEach(modulo => {
        onSnapshot(collection(dbCloud, modulo), async snapshot => {
            let lista = [];
            snapshot.forEach(d => {
                const data = d.data();
                if (data && typeof data === 'object') {
                    if (!data.id) data.id = d.id;
                    lista.push(data);
                }
            });
            if (!lista.length) return;

            // Conservar localmente los pinHash si vienen de la nube sin secreto
            if (modulo === 'empleados') {
                const previos = {};
                (window.db.empleados || []).forEach(e => { previos[e.id] = e.pinHash; });
                lista = lista.map(e => Object.assign({}, e, { pinHash: previos[e.id] || e.pinHash || '' }));
            }

            window.db[modulo] = CRONOLOGICAS.includes(modulo)
                ? lista.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
                : lista;

            PRISMA_CORE.migrar(window.db);
            // Persistencia asíncrona en IndexedDB
            await PrismaDB.setDBState(window.db);
            if (typeof window.render === 'function') window.render();
        }, (err) => {
            console.warn('[Firebase] Aviso onSnapshot en ' + modulo + ':', err?.message || err);
        });
    });

    onSnapshot(doc(dbCloud, "caja_global", "caja_estado"), async snap => {
        if (snap.exists() && snap.data()?.data) {
            const rawData = snap.data().data;
            if (typeof rawData === 'object' && rawData !== null) {
                // Filtrar cualquier clave vacía para evitar inconsistencias
                const limpia = {};
                for (const k in rawData) {
                    if (k && k.trim()) limpia[k] = rawData[k];
                }
                window.db.caja = limpia;
                await PrismaDB.setDBState(window.db);
                if (document.getElementById('caja')?.classList.contains('activa')) {
                    if (typeof window.verificarEfectivoCaja === 'function') window.verificarEfectivoCaja();
                    if (typeof window.renderHistorialCaja === 'function') window.renderHistorialCaja();
                }
                if (typeof window.verificarEstadoCajaPOS === 'function') window.verificarEstadoCajaPOS();
            }
        }
    }, (err) => {
        console.warn('[Firebase] Aviso onSnapshot caja_global:', err?.message || err);
    });

    onSnapshot(doc(dbCloud, "config", "general"), async snap => {
        if (snap.exists()) {
            const remoto = snap.data();
            const salPinLocal = window.db.config.salPin, masterHashLocal = window.db.config.masterPinHash;
            window.db.config = Object.assign(window.db.config || {}, remoto, { salPin: salPinLocal, masterPinHash: masterHashLocal });
            PRISMA_CORE.migrar(window.db);
            await PrismaDB.setDBState(window.db);
            if (typeof window.chequearLicencia === 'function') window.chequearLicencia();
        }
    }, (err) => {
        console.warn('[Firebase] Aviso onSnapshot config/general:', err?.message || err);
    });
};

// Métodos de escritura con filtrado estricto de secretos y saneamiento contra error 400
window.guardarItemEnNube = async (tabla, item) => {
    try {
        if (!item || !item.id || String(item.id).trim() === '') return;
        const idDoc = String(item.id).trim();
        const limpio = PRISMA_CORE.sanitizarEntidadFirestore(item, tabla);
        await setDoc(doc(dbCloud, tabla, idDoc), limpio);
    } catch (e) {
        console.warn('[Firebase] Aviso guardando ' + tabla + ':', e?.message || e);
    }
};

window.guardarVentaEnNube = async v => {
    try {
        if (!v || !v.id || String(v.id).trim() === '') return;
        const idDoc = String(v.id).trim();
        const limpio = PRISMA_CORE.sanitizarEntidadFirestore(v, "ventas");
        await setDoc(doc(dbCloud, "ventas", idDoc), limpio);
    } catch (e) {
        console.warn('[Firebase] Aviso guardando venta:', e?.message || e);
    }
};

window.borrarItemEnNube = async (tabla, id) => {
    try {
        if (!id || String(id).trim() === '') return;
        await deleteDoc(doc(dbCloud, tabla, String(id).trim()));
    } catch (e) {
        console.warn('[Firebase] Aviso borrando ' + tabla + ':', e?.message || e);
    }
};

window.guardarCajaEnNube = async () => {
    try {
        const cajaLimpia = {};
        for (const sucId in window.db.caja) {
            // Filtrar claves vacías que ocasionan error 400 en Firestore
            if (sucId && sucId.trim()) {
                cajaLimpia[sucId] = PRISMA_CORE.sanitizarEntidadFirestore(window.db.caja[sucId]);
            }
        }
        await setDoc(doc(dbCloud, "caja_global", "caja_estado"), {
            data: cajaLimpia
        });
    } catch (e) {
        console.warn('[Firebase] Aviso guardando caja_global:', e?.message || e);
    }
};

window.sincronizarTodoEnNube = async () => {
    if (!navigator.onLine) return;
    try {
        const operaciones = [];
        COLECCIONES.forEach(col => {
            (window.db[col] || []).forEach(x => {
                if (x && x.id && String(x.id).trim() !== '') {
                    operaciones.push({
                        ref: doc(dbCloud, col, String(x.id).trim()),
                        data: PRISMA_CORE.sanitizarEntidadFirestore(x, col)
                    });
                }
            });
        });

        operaciones.push({
            ref: doc(dbCloud, "config", "general"),
            data: PRISMA_CORE.sanitizarEntidadFirestore(PRISMA_CORE.configSinSecretos(window.db.config))
        });

        const cajaLimpia = {};
        for (const sucId in window.db.caja) {
            if (sucId && sucId.trim()) {
                cajaLimpia[sucId] = PRISMA_CORE.sanitizarEntidadFirestore(window.db.caja[sucId]);
            }
        }
        operaciones.push({
            ref: doc(dbCloud, "caja_global", "caja_estado"),
            data: { data: cajaLimpia }
        });

        // Enviar en bloques de máximo 400 escrituras para respetar el límite de 500 de Firestore
        const TAM_BLOQUE = 400;
        for (let i = 0; i < operaciones.length; i += TAM_BLOQUE) {
            const bloque = operaciones.slice(i, i + TAM_BLOQUE);
            const batch = writeBatch(dbCloud);
            bloque.forEach(op => batch.set(op.ref, op.data));
            await batch.commit();
        }
        console.log(`[Firebase] Sincronización writeBatch finalizada (${operaciones.length} documentos actualizados).`);
    } catch (e) {
        console.warn('[Firebase] Aviso en writeBatch:', e?.message || e);
    }
};

// Capa de autenticación y seguridad con Functions (protegida contra fallos de CORS en localhost)
window.iniciarSesionSegura = async function (pin, deviceId) {
    // Si la seguridad remota de servidor no está explícitamente activada por el informático, omitir llamadas de red
    if (!window.db?.config?.seguridadServidorActiva) {
        return { ok: false, rechazoDelServidor: false, error: 'Seguridad remota no activada.' };
    }

    // Si estamos en entorno local y no se ha desplegado o no hay emulador, evitar llamadas que originen error CORS
    const esLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
    if (esLocal && !window.__forzarCloudFunctionsEnLocal) {
        return { ok: false, rechazoDelServidor: false, error: 'Entorno local: usando verificación local en IndexedDB.' };
    }

    try {
        const callable = httpsCallable(fns, 'login');
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de conexión')), 3500));
        const r = await Promise.race([callable({ pin, deviceId }), timeoutPromise]);
        await signInWithCustomToken(authCloud, r.data.token);
        return { ok: true, usuario: r.data.usuario };
    } catch (e) {
        const rechazoDelServidor = e && e.code && e.code.indexOf('functions/') === 0 &&
            ['functions/unauthenticated', 'functions/permission-denied', 'functions/invalid-argument'].includes(e.code);
        return { ok: false, rechazoDelServidor, error: (e && e.message) || 'Sin conexión con el servidor de seguridad.' };
    }
};

window.asignarPinSeguro = async function (empId, pin) {
    if (!window.db?.config?.seguridadServidorActiva) return { ok: false, error: 'Seguridad remota no activada.' };
    const esLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
    if (esLocal && !window.__forzarCloudFunctionsEnLocal) return { ok: true };
    try {
        await httpsCallable(fns, 'asignarPin')({ empId, pin });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: (e && e.message) || 'No se pudo registrar el PIN en el servidor.' };
    }
};

window.inicializarSeguridadCloud = async function (salPin, masterPinHash) {
    try {
        await httpsCallable(fns, 'inicializarSeguridad')({ salPin, masterPinHash });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: (e && e.message) || 'No se pudo inicializar en el servidor.' };
    }
};

onAuthStateChanged(authCloud, u => {
    window.__sesionSeguraActiva = !!u;
});
