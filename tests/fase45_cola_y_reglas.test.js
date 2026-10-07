// Pruebas Fases 4 y 5: cola robusta (rechazos, sesión, orden, foto + pendientes) y reglas de negocio
const fs = require('fs');
const assert = require('assert');
const { entorno, sincronizar, outbox, stockServidor, crearCliente } = require('./helpers/cliente');

let ok = 0;
async function test(nombre, fn) { await fn(); ok++; console.log('✔ ' + nombre); }

const token = env => env.ctx.sessionStorage.getItem('thor_session_token');
const local = (env, id) => env.api.getCachedData().inventario.find(p => p.id === id);
const fila = (b, id) => b.filas('Inventario').find(f => f[0] === id);
function capturarEventos(env) {
  const eventos = [];
  env.ctx.dispatchEvent = e => { eventos.push(e); return true; };
  return eventos;
}
// Segundo dispositivo conectado al mismo servidor
function otroDispositivo(env) {
  const c = crearCliente(env.backend);
  c.ctx.sessionStorage.setItem('thor_session_token', token(env));
  return c;
}

(async () => {
  // ======================= FASE 4 =======================
  await test('Venta sin conexión rechazada al subir (otro equipo vendió el stock): se descarta, se revierte y se avisa', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    const r = await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 4, precio_unitario_dop: 1000 });
    assert.ok(r.isQueued);
    assert.strictEqual(local(env, 'PROD-BASE').cantidad, 6);
    // Mientras tanto, otro dispositivo vende 8
    env.backend.post({ action: 'registerSale', token: token(env), data: { id_articulo: 'PROD-BASE', cantidad: 8 } });

    const eventos = capturarEventos(env);
    env.ctx.navigator.onLine = true;
    const f = await env.api.flushOutbox();
    assert.strictEqual(f.rejected, 1);
    assert.strictEqual(outbox(env).length, 0);
    assert.strictEqual(env.api.getDeadLetterQueue().length, 0, 'un rechazo de negocio no va a la cola de recuperación');
    const rechazo = eventos.find(e => e.type === 'thor:operacion-rechazada');
    assert.ok(rechazo && /Stock insuficiente/.test(rechazo.detail.message));
    assert.strictEqual(rechazo.detail.accion, 'Venta');
    // La venta desaparece de la pantalla; tras sincronizar se ve el stock real
    assert.strictEqual(local(env, 'PROD-BASE').cantidad, 10);
    await sincronizar(env);
    assert.strictEqual(local(env, 'PROD-BASE').cantidad, 2);
    assert.strictEqual(env.backend.filas('Ventas').length, 1);
  });

  await test('Con conexión: un rechazo devuelve error a la pantalla (no "guardado") y no queda en cola', async () => {
    const env = entorno();
    await sincronizar(env);
    env.backend.post({ action: 'registerSale', token: token(env), data: { id_articulo: 'PROD-BASE', cantidad: 9 } });
    const r = await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 5, precio_unitario_dop: 1000 });
    assert.strictEqual(r.status, 'error');
    assert.ok(r.rechazada);
    assert.ok(!r.isQueued);
    assert.strictEqual(outbox(env).length, 0);
    assert.strictEqual(local(env, 'PROD-BASE').cantidad, 10, 'revertido a la última foto del servidor');
  });

  await test('Lo inválido en local no se encola (stock insuficiente, cuenta saldada)', async () => {
    const env = entorno();
    await sincronizar(env);
    const r = await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 50 });
    assert.strictEqual(r.status, 'error');
    assert.strictEqual(outbox(env).length, 0);
    assert.strictEqual(env.red.posts.length, 0);
  });

  await test('Sesión vencida: la cola se conserva intacta (sin gastar reintentos) y se sube tras iniciar sesión', async () => {
    const env = entorno();
    await sincronizar(env);
    const valido = token(env);
    env.ctx.navigator.onLine = false;
    await env.api.adjustStock('PROD-BASE', -1, 'Merma');
    await env.api.adjustStock('PROD-BASE', -1, 'Merma');
    env.ctx.navigator.onLine = true;
    env.ctx.sessionStorage.setItem('thor_session_token', 'THOR_SES_vencido');
    const eventos = capturarEventos(env);
    for (let i = 0; i < 6; i++) await env.api.flushOutbox();
    assert.strictEqual(outbox(env).length, 2);
    assert.ok(outbox(env).every(q => !q.retries));
    assert.strictEqual(env.api.getDeadLetterQueue().length, 0);
    assert.strictEqual(eventos.filter(e => e.type === 'thor:session-expired').length, 1, 'avisa una sola vez');
    assert.strictEqual(token(env), null, 'la sesión inválida se descarta');

    env.ctx.sessionStorage.setItem('thor_session_token', valido);
    const f = await env.api.flushOutbox();
    assert.strictEqual(f.pending, 0);
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 8);
  });

  await test('Fallo de red y "servidor ocupado" no gastan reintentos ni alteran el orden', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    await env.api.saveProduct({ id: 'PROD-NUEVO', nombre: 'Splash Nuevo', cantidad: 5, precio_venta_dop: 400 });
    await env.api.registerSale({ id_articulo: 'PROD-NUEVO', cantidad: 2, precio_unitario_dop: 400 });
    env.ctx.navigator.onLine = true;

    env.red.modo = 'caida';
    let f = await env.api.flushOutbox();
    assert.strictEqual(f.motivo, 'red');
    const fetchReal = env.ctx.fetch;
    env.red.modo = 'normal';
    env.ctx.fetch = async () => ({ json: async () => ({ status: 'error', code: 'SERVER_BUSY', message: 'ocupado' }) });
    f = await env.api.flushOutbox();
    assert.strictEqual(f.motivo, 'servidor');
    assert.ok(outbox(env).every(q => !q.retries));

    env.ctx.fetch = fetchReal;
    f = await env.api.flushOutbox();
    assert.strictEqual(f.pending, 0);
    assert.deepStrictEqual(env.red.posts.map(p => p.action), ['saveProduct', 'registerSale']);
    assert.strictEqual(stockServidor(env.backend, 'PROD-NUEVO'), 3);
  });

  await test('Error interno repetido → cola de recuperación tras 5 intentos, y las siguientes continúan', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    await env.api.adjustStock('PROD-BASE', -1, 'Merma');
    await env.api.adjustStock('PROD-BASE', -2, 'Merma');
    env.ctx.navigator.onLine = true;
    const fetchReal = env.ctx.fetch;
    let llamadas = 0;
    env.ctx.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.data && body.data.delta === -1) { llamadas++; return { json: async () => ({ status: 'error', code: 'SERVER_ERROR', message: 'Exception: fallo' }) }; }
      return fetchReal(url, opts);
    };
    for (let i = 0; i < 5; i++) await env.api.flushOutbox();
    assert.strictEqual(llamadas, 5);
    assert.strictEqual(env.api.getDeadLetterQueue().length, 1);
    assert.strictEqual(outbox(env).length, 0);
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 8);
  });

  await test('Descargar con operaciones pendientes no las borra de la pantalla (foto + pendientes)', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 3, precio_unitario_dop: 1000 });
    env.ctx.navigator.onLine = true;
    // Otro equipo agrega stock; la descarga llega antes de que suba la venta pendiente
    env.backend.post({ action: 'adjustStock', token: token(env), data: { id: 'PROD-BASE', delta: 5 } });
    const data = await sincronizar(env);
    assert.strictEqual(outbox(env).length, 1);
    assert.strictEqual(data.inventario.find(p => p.id === 'PROD-BASE').cantidad, 12, '10 + 5 de la nube − 3 pendientes');
    assert.strictEqual(data.ventas.length, 1);
    await env.api.flushOutbox();
    const despues = await sincronizar(env);
    assert.strictEqual(despues.inventario.find(p => p.id === 'PROD-BASE').cantidad, 12, 'sin doble descuento');
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 12);
  });

  await test('Respuesta perdida: la descarga reconoce la operación ya aplicada y la quita de la cola', async () => {
    const env = entorno();
    await sincronizar(env);
    env.red.modo = 'perder-respuesta';
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 2, precio_unitario_dop: 1000 });
    assert.strictEqual(outbox(env).length, 1);
    env.red.modo = 'normal';
    const data = await sincronizar(env);
    assert.strictEqual(outbox(env).length, 0);
    assert.strictEqual(data.inventario.find(p => p.id === 'PROD-BASE').cantidad, 8, 'no se descuenta dos veces');
  });

  await test('Purga y diagnóstico nunca pasan por la cola; la purga limpia el dispositivo solo si el servidor confirma', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    let r = await env.api.resetSystemData('CONFIRMAR_PURGA_TOTAL_THOR');
    assert.strictEqual(r.status, 'error');
    r = await env.api.reconcileWithCloud();
    assert.strictEqual(r.status, 'error');
    assert.strictEqual(outbox(env).length, 0);
    assert.strictEqual(env.api.getCachedData().inventario.length, 1, 'nada se borró');

    env.ctx.navigator.onLine = true;
    r = await env.api.resetSystemData('codigo-incorrecto');
    assert.strictEqual(r.status, 'error');
    assert.strictEqual(env.api.getCachedData().inventario.length, 1);
    r = await env.api.resetSystemData('CONFIRMAR_PURGA_TOTAL_THOR');
    assert.strictEqual(r.status, 'success');
    assert.strictEqual(env.api.getCachedData().inventario.length, 0);
    assert.strictEqual(env.backend.filas('Inventario').length, 0);
  });

  // ======================= FASE 5 =======================
  await test('Editar un producto desde un equipo con datos viejos no pisa las ventas del otro', async () => {
    const env = entorno();
    await sincronizar(env);
    const b = otroDispositivo(env);
    const rb = await b.api.fetchAllData(true);
    b.api.setCachedData(rb.data);
    // A vende 3; B (con stock 10 en pantalla) cambia el precio
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 3, precio_unitario_dop: 1000 });
    const prodB = b.api.getCachedData().inventario.find(p => p.id === 'PROD-BASE');
    await b.api.saveProduct(Object.assign({}, prodB, { precio_venta_dop: 1200 }));
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 7);
    assert.strictEqual(Number(fila(env.backend, 'PROD-BASE')[8]), 1200);
  });

  await test('Corregir la cantidad en el formulario se envía como ajuste relativo', async () => {
    const env = entorno();
    await sincronizar(env);
    const b = otroDispositivo(env);
    const rb = await b.api.fetchAllData(true);
    b.api.setCachedData(rb.data);
    // B abre el formulario con 10 y escribe 12 (+2); mientras, A vende 3
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 3, precio_unitario_dop: 1000 });
    const prodB = b.api.getCachedData().inventario.find(p => p.id === 'PROD-BASE');
    await b.api.saveProduct(Object.assign({}, prodB, { cantidad: 12 }));
    await b.api.adjustStock('PROD-BASE', 12 - 10, 'Cantidad corregida en el formulario (10 → 12)');
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 9);
  });

  await test('Validaciones: sin cantidades ni precios negativos (servidor y dispositivo); stock mínimo 0 permitido', async () => {
    const env = entorno();
    await sincronizar(env);
    let r = await env.api.saveProduct({ nombre: 'Malo', cantidad: -3, precio_venta_dop: 100 });
    assert.strictEqual(r.status, 'error');
    r = await env.api.saveProduct({ nombre: 'Malo', cantidad: 1, precio_venta_dop: -100 });
    assert.strictEqual(r.status, 'error');
    assert.strictEqual(outbox(env).length, 0);
    const s = env.backend.post({ action: 'saveProduct', token: token(env), data: { nombre: 'Malo', cantidad: -1, precio_venta_dop: 5 } });
    assert.strictEqual(s.code, 'VALIDACION');
    const v = env.backend.post({ action: 'registerSale', token: token(env), data: { id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: -5 } });
    assert.strictEqual(v.code, 'VALIDACION');

    await env.api.saveProduct({ id: 'PROD-MIN0', nombre: 'Muestra', cantidad: 1, stock_minimo: 0, precio_venta_dop: 50 });
    assert.strictEqual(fila(env.backend, 'PROD-MIN0')[5], 0);
    assert.strictEqual(fila(env.backend, 'PROD-MIN0')[10], 'En Stock');
    assert.strictEqual(local(env, 'PROD-MIN0').estado, 'En Stock');
  });

  await test('Fiado: abonos con centavos saldan exactamente la cuenta (servidor y dispositivo coinciden)', async () => {
    const env = entorno();
    const t = token(env);
    env.backend.post({ action: 'saveProduct', token: t, data: { id: 'PROD-C', nombre: 'Crema', cantidad: 5, precio_venta_dop: 100.1 } });
    await sincronizar(env);
    await env.api.registerSale({ id_articulo: 'PROD-C', cantidad: 1, precio_unitario_dop: 100.1, tipo_venta: 'credito', es_credito: true, num_cuotas: 3, cliente: 'Ana' });
    const cobro = env.api.getCachedData().cobros[0];
    const montos = cobro.plan_cuotas.map(c => c.monto);
    for (const m of montos) {
      const r = await env.api.registerPayment({ id_cobro: cobro.id_cobro, monto: m });
      assert.strictEqual(r.status, 'success', r.message);
    }
    const srv = env.backend.filas('Cobros')[0];
    assert.strictEqual(Number(srv[9]), 0);
    assert.strictEqual(srv[12], 'Saldada');
    assert.ok(JSON.parse(srv[15]).every(c => c.estado === 'Cobrada'));
    const loc = env.api.getCachedData().cobros[0];
    assert.strictEqual(loc.saldo_pendiente_dop, 0);
    assert.strictEqual(loc.estado, 'Saldada');
    assert.strictEqual(env.backend.filas('Ventas')[0][13], 'Completada');
  });

  await test('Métricas: una deuda anulada no cuenta como deuda pendiente', async () => {
    const env = entorno();
    await sincronizar(env);
    await env.api.registerSale({ id_venta: 'VTA-F', id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000, tipo_venta: 'credito', es_credito: true, num_cuotas: 2, cliente: 'Luis' });
    await env.api.cancelSale('VTA-F');
    const data = await sincronizar(env);
    assert.strictEqual(data.metricas.clientes_con_deuda, 0);
    assert.strictEqual(data.metricas.total_por_cobrar_dop, 0);
  });

  await test('Tanque: precio sugerido igual en ambos lados y no pisa el precio de un producto existente', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    await env.api.registerReception({ nombre_tanque: 'T', tasa_cambio: 60, articulos: [
      { id: 'PROD-SINPRECIO', nombre: 'Body Wash', cantidad: 2, costo_usd: 5 },
      { nombre: 'Perfume Base', cantidad: 1, costo_usd: 4 }
    ] });
    const enLocal = local(env, 'PROD-SINPRECIO').precio_venta_dop;
    assert.strictEqual(local(env, 'PROD-BASE').precio_venta_dop, 1000);
    env.ctx.navigator.onLine = true;
    await env.api.flushOutbox();
    assert.strictEqual(Number(fila(env.backend, 'PROD-SINPRECIO')[8]), 450);
    assert.strictEqual(enLocal, 450);
    assert.strictEqual(Number(fila(env.backend, 'PROD-BASE')[8]), 1000);
  });

  await test('Flete prorrateado en el costo cuando PRORRATEAR_FLETE = SI (servidor y dispositivo)', async () => {
    const env = entorno();
    const cfg = env.backend.hojas.Configuracion.data;
    cfg.find(f => f[0] === 'PRORRATEAR_FLETE')[1] = 'SI';
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    await env.api.registerReception({ nombre_tanque: 'T', tasa_cambio: 60, flete_usd: 20, articulos: [
      { id: 'PROD-F1', nombre: 'Crema A', cantidad: 4, costo_usd: 5, precio_venta_dop: 900 },
      { id: 'PROD-F2', nombre: 'Crema B', cantidad: 6, costo_usd: 3, precio_venta_dop: 700 }
    ] });
    // 20 USD / 10 unidades = 2 USD por unidad
    assert.strictEqual(local(env, 'PROD-F1').costo_usd, 7);
    assert.strictEqual(local(env, 'PROD-F1').costo_dop, 420);
    env.ctx.navigator.onLine = true;
    await env.api.flushOutbox();
    assert.strictEqual(Number(fila(env.backend, 'PROD-F1')[6]), 7);
    assert.strictEqual(Number(fila(env.backend, 'PROD-F2')[7]), 300);
  });

  await test('Sin prorrateo (por defecto) el costo no cambia', async () => {
    const env = entorno();
    await sincronizar(env);
    await env.api.registerReception({ nombre_tanque: 'T', tasa_cambio: 60, flete_usd: 20, articulos: [
      { id: 'PROD-F1', nombre: 'Crema A', cantidad: 4, costo_usd: 5, precio_venta_dop: 900 } ] });
    assert.strictEqual(Number(fila(env.backend, 'PROD-F1')[6]), 5);
  });

  await test('Métricas locales: "ventas de hoy" correctas tras vender sin conexión y fechas en formato del servidor', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 2, precio_unitario_dop: 1000 });
    const d = env.api.getCachedData();
    assert.strictEqual(d.metricas.ventas_hoy_dop, 2000);
    assert.strictEqual(d.metricas.ventas_mes_dop, 2000);
    assert.match(d.ventas[0].fecha_venta, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.strictEqual(env.api.normalizarFecha('7/10/2026, 3:45:00 p. m.'), '2026-10-07');
  });

  console.log(`\n${ok} pruebas superadas`);
})().catch(e => { console.error(e); process.exit(1); });
