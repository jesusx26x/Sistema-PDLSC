// Pruebas Fase 9: detección temprana (registro de errores, monitoreo diario, versión, sesión deslizante,
// protección de hojas, rotación de respaldos y depuración de registros)
const assert = require('assert');
const path = require('path');
const { crearBackend } = require('./helpers/gas');
const { entorno, sincronizar, outbox } = require('./helpers/cliente');

const RUTA = path.resolve(__dirname, '..', 'backend', 'Codigo.gs');
const token = env => env.ctx.sessionStorage.getItem('thor_session_token');

let ok = 0;
async function test(nombre, fn) { await fn(); ok++; console.log('✔ ' + nombre); }

(async () => {
  // ---------------- H10: registro de errores ----------------
  await test('Una operación rechazada llega al "Registro de Errores" del servidor con su detalle', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 4, precio_unitario_dop: 1000, cliente: 'Rosa' });
    env.backend.post({ action: 'registerSale', token: token(env), data: { id_articulo: 'PROD-BASE', cantidad: 9 } });
    env.ctx.navigator.onLine = true;
    await env.api.flushOutbox();
    await sincronizar(env);
    await new Promise(r => setTimeout(r, 20));
    const filas = env.backend.filas('Registro de Errores');
    assert.strictEqual(filas.length, 1);
    assert.strictEqual(filas[0][2], 'rechazada');
    assert.strictEqual(filas[0][3], 'Venta');
    assert.ok(/Stock insuficiente/.test(filas[0][4]));
    assert.ok(/Rosa/.test(filas[0][5]));
    assert.strictEqual(filas[0][7], env.api.VERSION_APP);
    assert.strictEqual(JSON.parse(env.ctx.localStorage.getItem('thor_eventos_cliente_v1')).length, 0, 'enviado y borrado del dispositivo');
  });

  await test('Los eventos se conservan en el dispositivo si no hay conexión y se envían después', async () => {
    const env = entorno();
    await sincronizar(env);
    env.api.registrarEventoCliente('error_js', '', 'TypeError: x is undefined', '/js/app.js:10:5');
    env.api.registrarEventoCliente('error_js', '', 'TypeError: x is undefined', '/js/app.js:10:5'); // repetido: una vez
    env.ctx.navigator.onLine = false;
    await env.api.enviarEventosCliente();
    assert.strictEqual(JSON.parse(env.ctx.localStorage.getItem('thor_eventos_cliente_v1')).length, 1);
    env.ctx.navigator.onLine = true;
    await env.api.enviarEventosCliente();
    assert.strictEqual(env.backend.filas('Registro de Errores').length, 1);
    assert.strictEqual(env.backend.filas('Registro de Errores')[0][2], 'error_js');
  });

  await test('El registro de eventos exige sesión y limita el tamaño de cada envío', async () => {
    const b = crearBackend(RUTA);
    const t = b.login();
    assert.strictEqual(b.post({ action: 'logClientEvents', token: 'falso', data: { eventos: [{ tipo: 'x' }] } }).code, 'UNAUTHORIZED_RLS');
    const muchos = Array.from({ length: 60 }, (_, i) => ({ tipo: 'error_js', mensaje: 'e' + i + 'x'.repeat(2000) }));
    const r = b.post({ action: 'logClientEvents', token: t, data: { eventos: muchos } });
    assert.strictEqual(r.registrados, 25);
    assert.ok(b.filas('Registro de Errores').every(f => String(f[4]).length <= 500));
  });

  // ---------------- H11: monitoreo diario ----------------
  await test('Monitoreo diario: envía correo al administrador si hay errores o problemas de inventario', async () => {
    const b = crearBackend(RUTA);
    const t = b.login();
    b.post({ action: 'logClientEvents', token: t, data: { eventos: [{ tipo: 'rechazada', accion: 'Venta', mensaje: 'Stock insuficiente' }] } });
    // Duplicado de producto para que el diagnóstico lo detecte
    b.hojas.Inventario.data.push(['PROD-A', 'Crema', 'Cremas', 'Tanque: T', 3, 3, 0, 100, 200, 'T', 'En Stock', new Date(), new Date()]);
    b.hojas.Inventario.data.push(['PROD-REST-1', 'crema', 'Cremas', 'Tanque: T', 3, 3, 0, 100, 200, 'T', 'En Stock', new Date(), new Date()]);
    const informe = b.ctx.monitoreoDiario();
    assert.ok(informe.hayProblemas);
    assert.strictEqual(b.correos.length, 1);
    assert.strictEqual(b.correos[0].para, 'admin@ejemplo.com');
    assert.ok(/por revisar/.test(b.correos[0].asunto));
    assert.ok(/Stock insuficiente/.test(b.correos[0].cuerpo));
    assert.ok(/Productos duplicados: 1/.test(b.correos[0].cuerpo));
    assert.ok(b.props.MONITOREO_ULTIMA_EJECUCION);
  });

  await test('Monitoreo diario: sin novedades no envía correo (salvo el control de los lunes)', async () => {
    const b = crearBackend(RUTA);
    b.login();
    const informe = b.ctx.monitoreoDiario();
    assert.strictEqual(informe.hayProblemas, false);
    const esLunes = new Date().getDay() === 1;
    assert.strictEqual(b.correos.length, esLunes ? 1 : 0);
  });

  await test('Monitoreo diario: depura registros de más de 180 días y conserva los recientes', async () => {
    const b = crearBackend(RUTA);
    b.login();
    const viejo = new Date(Date.now() - 200 * 86400000);
    b.ctx.hojaOperaciones();
    b.hojas.Operaciones.data.push(['op-viejo-1', viejo, 'adjustStock', '{}'], ['op-viejo-2', viejo, 'adjustStock', '{}'], ['op-nuevo', new Date(), 'adjustStock', '{}']);
    b.ctx.hojaRegistroErrores();
    b.hojas['Registro de Errores'].data.push([viejo, '', 'error_js', '', 'viejo', '', '', ''], [new Date(), '', 'error_js', '', 'nuevo', '', '', '']);
    const informe = b.ctx.monitoreoDiario();
    assert.strictEqual(informe.depuradas, 3);
    assert.deepStrictEqual(b.filas('Operaciones').map(f => f[0]), ['op-nuevo']);
    assert.deepStrictEqual(b.filas('Registro de Errores').map(f => f[4]), ['nuevo']);
  });

  await test('Configurar monitoreo: un solo disparador diario a las 7 y correo de prueba', async () => {
    const b = crearBackend(RUTA);
    b.ctx.configurarMonitoreoDiario();
    b.ctx.configurarMonitoreoDiario();
    const t = b.triggers.filter(x => x.getHandlerFunction() === 'monitoreoDiario');
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].hora, 7);
    assert.strictEqual(b.correos.length, 2);
    b.props.ADMIN_EMAIL = 'otro@ejemplo.com';
    b.ctx.configurarMonitoreoDiario();
    assert.strictEqual(b.correos[2].para, 'otro@ejemplo.com');
  });

  // ---------------- H12: versión ----------------
  await test('El backend informa su versión y la app avisa si el servidor quedó desactualizado', async () => {
    const env = entorno();
    assert.ok(env.backend.get({ action: 'ping' }).version >= 9);
    const eventos = [];
    env.ctx.dispatchEvent = e => { eventos.push(e.type); return true; };
    await sincronizar(env);
    assert.ok(!eventos.includes('thor:backend-desactualizado'));
    // Simular un backend viejo: sin version_backend
    const fetchReal = env.ctx.fetch;
    env.ctx.fetch = async (url, opts) => {
      const r = await fetchReal(url, opts);
      const json = await r.json();
      if (json && json.data) delete json.data.version_backend;
      return { json: async () => json };
    };
    await env.api.fetchAllData(true);
    await env.api.fetchAllData(true);
    assert.strictEqual(eventos.filter(t => t === 'thor:backend-desactualizado').length, 1, 'avisa una sola vez');
    const pendientes = JSON.parse(env.ctx.localStorage.getItem('thor_eventos_cliente_v1') || '[]');
    assert.ok(pendientes.some(e => e.tipo === 'backend_desactualizado') || env.backend.filas('Registro de Errores').some(f => f[2] === 'backend_desactualizado'));
  });

  // ---------------- H13: sesión deslizante ----------------
  await test('Sesión deslizante: con menos de 7 días se extiende al usarla; con más, no se toca', async () => {
    const b = crearBackend(RUTA);
    const t = b.login();
    const leer = () => JSON.parse(b.props['SESSION_' + t]);
    const original = leer();
    b.post({ action: 'getAllData', token: t });
    assert.strictEqual(leer().expiraEn, original.expiraEn, 'con 30 días restantes no se reescribe');
    const casiVencida = Object.assign({}, original, { expiraEn: Date.now() + 2 * 86400000 });
    b.props['SESSION_' + t] = JSON.stringify(casiVencida);
    b.cache[t] = JSON.stringify(casiVencida);
    assert.strictEqual(b.post({ action: 'getAllData', token: t }).status, 'success');
    assert.ok(leer().expiraEn > Date.now() + 29 * 86400000, 'renovada por 30 días');
    assert.ok(JSON.parse(b.cache[t]).expiraEn > Date.now() + 29 * 86400000);
  });

  await test('Sesión deslizante: una sesión revocada o vencida no se renueva', async () => {
    const b = crearBackend(RUTA);
    const t = b.login();
    const data = JSON.parse(b.props['SESSION_' + t]);
    b.props['SESSION_' + t] = JSON.stringify(Object.assign(data, { expiraEn: Date.now() - 1000 }));
    delete b.cache[t];
    assert.strictEqual(b.post({ action: 'getAllData', token: t }).code, 'UNAUTHORIZED_RLS');
  });

  // ---------------- H14: protección de hojas ----------------
  await test('Protección de hojas con advertencia, sin duplicar protecciones', async () => {
    const b = crearBackend(RUTA);
    b.ctx.hojaMovimientos();
    b.ctx.protegerHojasDeDatos();
    const n = b.ctx.protegerHojasDeDatos();
    assert.ok(n >= 5);
    const inv = b.hojas.Inventario.getProtections();
    assert.strictEqual(inv.length, 1);
    assert.strictEqual(inv[0].soloAdvertencia, true);
    // La app sigue escribiendo con normalidad
    const t = b.login();
    assert.strictEqual(b.post({ action: 'adjustStock', token: t, data: { id: 'X', delta: 1 } }).status, 'error');
    b.post({ action: 'saveProduct', token: t, data: { id: 'P1', nombre: 'Crema', cantidad: 2, precio_venta_dop: 10 } });
    assert.strictEqual(b.filas('Inventario').length, 1);
  });

  // ---------------- H15: rotación de respaldos ----------------
  await test('Respaldo diario: conserva los últimos 30 y manda los anteriores a la papelera', async () => {
    const b = crearBackend(RUTA);
    for (let i = 0; i < 34; i++) b.crearArchivo('Backup Thor Essence — viejo ' + i, new Date(Date.now() - (40 - i) * 86400000));
    b.crearArchivo('Otro archivo personal', new Date(0));
    b.ctx.crearRespaldoEnDrive();
    const respaldos = b.archivosRespaldo.filter(f => f.nombre.indexOf('Backup Thor Essence') === 0);
    assert.strictEqual(respaldos.filter(f => !f.papelera).length, 30);
    assert.strictEqual(respaldos.filter(f => f.papelera).length, 5);
    assert.ok(!b.archivosRespaldo.find(f => f.nombre === 'Otro archivo personal').papelera, 'no toca otros archivos');
    assert.ok(!respaldos.find(f => f.nombre === b.respaldos[0]).papelera, 'el recién creado se conserva');
  });

  console.log(`\n${ok} pruebas superadas`);
})().catch(e => { console.error(e); process.exit(1); });
