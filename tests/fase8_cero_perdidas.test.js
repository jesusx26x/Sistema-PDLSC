// Pruebas Fase 8: cero pérdidas y cero duplicados (H1–H5 de la auditoría integral)
const fs = require('fs');
const assert = require('assert');
const { entorno, sincronizar, outbox, stockServidor, crearCliente } = require('./helpers/cliente');

let ok = 0;
async function test(nombre, fn) { await fn(); ok++; console.log('✔ ' + nombre); }

const token = env => env.ctx.sessionStorage.getItem('thor_session_token');
const activos = (b, re) => b.filas('Inventario').filter(f => f[10] !== 'Eliminado' && re.test(f[1]));
function otro(env) {
  const c = crearCliente(env.backend);
  c.ctx.sessionStorage.setItem('thor_session_token', token(env));
  return c;
}

(async () => {
  // ---------------- H1 ----------------
  await test('H1: tanque + venta sin conexión de un producto que otro equipo ya creó → la venta se aplica al producto real', async () => {
    const env = entorno();
    await sincronizar(env);
    env.backend.post({ action: 'saveProduct', token: token(env), data: { id: 'PROD-NUBE', nombre: 'Crema Coco', cantidad: 5, precio_venta_dop: 500 } });
    env.ctx.navigator.onLine = false;
    await env.api.registerReception({ nombre_tanque: 'T', tasa_cambio: 60, articulos: [{ nombre: 'Crema Coco', cantidad: 4, precio_venta_dop: 500 }] });
    const idLocal = env.api.getCachedData().inventario.find(p => p.nombre === 'Crema Coco').id;
    assert.notStrictEqual(idLocal, 'PROD-NUBE');
    await env.api.registerSale({ id_articulo: idLocal, cantidad: 1, precio_unitario_dop: 500 });
    await env.api.adjustStock(idLocal, -1, 'Merma');
    env.ctx.navigator.onLine = true;
    const f = await env.api.flushOutbox();
    assert.strictEqual(f.rejected, 0, 'nada rechazado');
    assert.strictEqual(env.backend.filas('Ventas').length, 1);
    assert.strictEqual(env.backend.filas('Ventas')[0][2], 'PROD-NUBE');
    assert.strictEqual(stockServidor(env.backend, 'PROD-NUBE'), 7); // 5 + 4 − 1 venta − 1 merma
    const data = await sincronizar(env);
    assert.strictEqual(data.alias[idLocal], 'PROD-NUBE');
    assert.strictEqual(data.inventario.filter(p => /coco/i.test(p.nombre)).length, 1);
    assert.strictEqual(env.api.getHistorialSync().length, 0);
  });

  await test('H1: mientras la venta sigue pendiente, la pantalla la muestra sobre el producto real', async () => {
    const env = entorno();
    await sincronizar(env);
    env.backend.post({ action: 'saveProduct', token: token(env), data: { id: 'PROD-NUBE', nombre: 'Crema Coco', cantidad: 5, precio_venta_dop: 500 } });
    env.ctx.navigator.onLine = false;
    await env.api.registerReception({ nombre_tanque: 'T', tasa_cambio: 60, articulos: [{ nombre: 'Crema Coco', cantidad: 4, precio_venta_dop: 500 }] });
    const idLocal = env.api.getCachedData().inventario.find(p => p.nombre === 'Crema Coco').id;
    env.ctx.navigator.onLine = true;
    // Sube solo el tanque; la venta queda pendiente
    await env.api.flushOutbox();
    env.ctx.navigator.onLine = false;
    await env.api.registerSale({ id_articulo: idLocal, cantidad: 2, precio_unitario_dop: 500 });
    env.ctx.navigator.onLine = true;
    env.red.modo = 'caida';
    await env.api.flushOutbox();
    env.red.modo = 'normal';
    // Descarga sin que la venta haya subido: alias + re-aplicación
    const fetchReal = env.ctx.fetch;
    env.ctx.fetch = (url, opts) => (JSON.parse(opts.body).action === 'getAllData' ? fetchReal(url, opts) : Promise.reject(new TypeError('Failed to fetch')));
    const data = await sincronizar(env);
    env.ctx.fetch = fetchReal;
    assert.strictEqual(outbox(env).length, 1);
    assert.strictEqual(data.inventario.find(p => p.id === 'PROD-NUBE').cantidad, 7, '9 en la nube − 2 pendientes');
    assert.ok(!data.inventario.some(p => p.id === idLocal));
  });

  // ---------------- H2 ----------------
  await test('H2: dos equipos sin conexión crean el mismo producto → 1 solo producto con la suma', async () => {
    const env = entorno();
    await sincronizar(env);
    const b = otro(env);
    const rb = await b.api.fetchAllData(true); b.api.setCachedData(rb.data);
    env.ctx.navigator.onLine = false; b.ctx.navigator.onLine = false;
    await env.api.saveProduct({ nombre: 'Splash Mango', cantidad: 3, precio_venta_dop: 400 });
    await b.api.saveProduct({ nombre: 'Splash  mango ', cantidad: 2, precio_venta_dop: 400 });
    const idB = b.api.getCachedData().inventario.find(p => /mango/i.test(p.nombre)).id;
    await b.api.registerSale({ id_articulo: idB, cantidad: 1, precio_unitario_dop: 400 });
    env.ctx.navigator.onLine = true; b.ctx.navigator.onLine = true;
    await env.api.flushOutbox();
    const fb = await b.api.flushOutbox();
    assert.strictEqual(fb.rejected, 0);
    const filas = activos(env.backend, /mango/i);
    assert.strictEqual(filas.length, 1, 'sin duplicado');
    assert.strictEqual(Number(filas[0][4]), 4, '3 + 2 − 1 vendida');
    assert.strictEqual(env.backend.filas('Ventas')[0][2], filas[0][0]);
  });

  await test('H2: el servidor no crea un producto con un nombre que ya existe (espacios, mayúsculas, acentos)', async () => {
    const env = entorno();
    const r1 = env.backend.post({ action: 'saveProduct', token: token(env), data: { nombre: '  perfume   BASE ', cantidad: 2, precio_venta_dop: 900 } });
    const r2 = env.backend.post({ action: 'saveProduct', token: token(env), data: { nombre: 'Pérfume Base', cantidad: 0, precio_venta_dop: 900 } });
    assert.ok(r1.unido && r2.unido);
    assert.strictEqual(r1.id, 'PROD-BASE');
    assert.strictEqual(activos(env.backend, /erfume/i).length, 1);
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 12);
    const movs = env.backend.filas('Movimientos').filter(m => m[2] === 'PROD-BASE');
    assert.strictEqual(movs.reduce((t, m) => t + Number(m[5]), 0), 12, 'kardex cuadrado');
  });

  await test('H2: el formulario y el tanque reconocen el producto aunque cambien acentos o espacios', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    const r = await env.api.saveProduct({ nombre: 'Pérfume  base', cantidad: 3, precio_venta_dop: 900 });
    assert.ok(r.unido);
    await env.api.registerReception({ nombre_tanque: 'T', articulos: [{ nombre: 'PERFUME BÁSE', cantidad: 1 }] });
    const locales = env.api.getCachedData().inventario.filter(p => /rfume/i.test(p.nombre));
    assert.strictEqual(locales.length, 1);
    assert.strictEqual(locales[0].cantidad, 14);
    env.ctx.navigator.onLine = true;
    await env.api.flushOutbox();
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 14);
    assert.strictEqual(activos(env.backend, /rfume/i).length, 1);
  });

  // ---------------- H3 ----------------
  await test('H3: en el dispositivo solo se guarda la foto del servidor (la vista vive en memoria)', async () => {
    const env = entorno();
    env.ctx.localStorage.setItem('thor_cached_system_data_v5', '{"inventario":[]}');
    await sincronizar(env);
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000 });
    assert.strictEqual(env.ctx.localStorage.getItem('thor_cached_system_data_v5'), null);
    assert.ok(env.ctx.localStorage.getItem('thor_server_snapshot_v1'));
    // Al reabrir la app la vista se reconstruye desde la foto + la cola
    const c = crearCliente(env.backend);
    ['thor_server_snapshot_v1', 'thor_outbox_queue_v1'].forEach(k => c.ctx.localStorage.setItem(k, env.ctx.localStorage.getItem(k) || '[]'));
    assert.strictEqual(c.api.getCachedData().inventario.find(p => p.id === 'PROD-BASE').cantidad, 9);
  });

  await test('H3: si el almacenamiento se llena, la sesión no vuelve a una foto vieja y avisa una sola vez', async () => {
    const env = entorno();
    await sincronizar(env);
    const set = env.ctx.localStorage.setItem;
    env.ctx.localStorage.setItem = (k, v) => { if (k === 'thor_server_snapshot_v1') { const e = new Error('lleno'); e.name = 'QuotaExceededError'; throw e; } return set(k, v); };
    const avisos = [];
    env.ctx.dispatchEvent = e => { avisos.push(e.type); return true; };
    env.backend.post({ action: 'adjustStock', token: token(env), data: { id: 'PROD-BASE', delta: 5 } });
    let data = await sincronizar(env);
    assert.strictEqual(data.inventario[0].cantidad, 15, 'datos nuevos aunque no se pudieron guardar');
    env.backend.post({ action: 'adjustStock', token: token(env), data: { id: 'PROD-BASE', delta: 1 } });
    data = await sincronizar(env);
    assert.strictEqual(env.api.getCachedData().inventario[0].cantidad, 16);
    assert.strictEqual(avisos.filter(t => t === 'thor:almacenamiento-lleno').length, 1);
  });

  await test('H3: el servidor envía solo los últimos 180 días + fiados abiertos, y un resumen exacto de lo anterior', async () => {
    const env = entorno();
    const t = token(env);
    const viejo = new Date(Date.now() - 400 * 86400000);
    const V = env.backend.hojas.Ventas;
    V.data.push(['VTA-VIEJA-1', viejo, 'PROD-BASE', 'Perfume Base', 'Perfumes', 2, 1000, 2000, 400, 1200, 'Ana', 'Efectivo', '', 'Completada']);
    V.data.push(['VTA-VIEJA-2', viejo, 'PROD-BASE', 'Perfume Base', 'Perfumes', 1, 1000, 1000, 400, 600, 'Ana', 'Efectivo', '', 'Cancelada']);
    V.data.push(['VTA-VIEJA-FIADO', viejo, 'PROD-BASE', 'Perfume Base', 'Perfumes', 1, 1000, 1000, 400, 600, 'Luis', 'Crédito / Fiado', '', 'Pendiente de Cobro']);
    env.backend.hojas.Cobros.data.push(['COB-VIEJO', 'VTA-VIEJA-FIADO', viejo, 'Luis', '', 'Perfume Base', 1000, 0, 0, 1000, 2, 'quincenal', 'Pendiente', '2025-01-15', '[]', '[]']);
    env.backend.post({ action: 'registerSale', token: t, data: { id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000 } });
    const r = env.backend.post({ action: 'getAllData', token: t });
    const ids = r.data.ventas.map(v => v.id_venta);
    assert.ok(!ids.includes('VTA-VIEJA-1') && !ids.includes('VTA-VIEJA-2'));
    assert.ok(ids.includes('VTA-VIEJA-FIADO'), 'la venta de un fiado abierto sigue visible');
    assert.ok(r.data.cobros.some(c => c.id_cobro === 'COB-VIEJO'));
    assert.strictEqual(r.data.historial.ventas, 1);
    assert.strictEqual(r.data.historial.ingresos_dop, 2000);
    assert.strictEqual(r.data.historial.ganancia_dop, 1200);
    assert.strictEqual(r.data.historial.por_producto['Perfume Base'].cantidad, 2);
    assert.strictEqual(r.data.metricas.clientes_con_deuda, 1, 'las métricas usan todo el historial');
  });

  // ---------------- H4 / H5 ----------------
  await test('H5: una operación rechazada queda en el historial con su detalle hasta revisarla', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 4, precio_unitario_dop: 1000, cliente: 'Rosa' });
    env.backend.post({ action: 'registerSale', token: token(env), data: { id_articulo: 'PROD-BASE', cantidad: 9 } });
    env.ctx.navigator.onLine = true;
    await env.api.flushOutbox();
    const h = env.api.getHistorialSync();
    assert.strictEqual(h.length, 1);
    assert.strictEqual(h[0].tipo, 'rechazada');
    assert.ok(/4 × Perfume Base/.test(h[0].resumen) && /Rosa/.test(h[0].resumen), h[0].resumen);
    assert.ok(/Stock insuficiente/.test(h[0].mensaje));
    assert.strictEqual(env.api.contarPorRevisar(), 1);
    env.api.marcarHistorialVisto('rechazada');
    assert.strictEqual(env.api.contarPorRevisar(), 0);
    assert.strictEqual(env.api.getHistorialSync().length, 1, 'se conserva como historial');
  });

  await test('H5: un rechazo directo (con la pantalla abierta) se registra como ya visto', async () => {
    const env = entorno();
    await sincronizar(env);
    env.backend.post({ action: 'registerSale', token: token(env), data: { id_articulo: 'PROD-BASE', cantidad: 9 } });
    const r = await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 5, precio_unitario_dop: 1000 });
    assert.strictEqual(r.status, 'error');
    assert.strictEqual(env.api.getHistorialSync()[0].visto, true);
    assert.strictEqual(env.api.contarPorRevisar(), 0);
  });

  await test('H4: la cola de recuperación se puede reintentar (sin duplicar) y queda en el historial', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 2, precio_unitario_dop: 1000 });
    env.ctx.navigator.onLine = true;
    const fetchReal = env.ctx.fetch;
    env.ctx.fetch = async (url, opts) => (JSON.parse(opts.body).action === 'registerSale'
      ? { json: async () => ({ status: 'error', code: 'SERVER_ERROR', message: 'Exception: cuota' }) }
      : fetchReal(url, opts));
    for (let i = 0; i < 5; i++) await env.api.flushOutbox();
    assert.strictEqual(env.api.getDeadLetterQueue().length, 1);
    assert.strictEqual(env.api.getHistorialSync()[0].tipo, 'recuperacion');
    assert.strictEqual(env.api.contarPorRevisar(), 2);
    env.ctx.fetch = fetchReal;
    const r = await env.api.reintentarRecuperacion();
    assert.strictEqual(r.reintentadas, 1);
    assert.strictEqual(env.api.getDeadLetterQueue().length, 0);
    assert.strictEqual(outbox(env).length, 0);
    assert.strictEqual(env.backend.filas('Ventas').length, 1);
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 8);
    // Reintentar otra vez la misma operación (mismo op_id) no la duplica
    env.ctx.localStorage.setItem('thor_dead_letter_queue_v1', JSON.stringify([Object.assign({}, r.resultado && {}, JSON.parse(JSON.stringify({ queueId: 'X', opId: env.backend.filas('Operaciones')[0][0], action: 'registerSale', data: { id_articulo: 'PROD-BASE', cantidad: 2 } })))]));
    await env.api.reintentarRecuperacion();
    assert.strictEqual(env.backend.filas('Ventas').length, 1);
  });

  await test('H4: reintento automático diario de la cola de recuperación al sincronizar', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.localStorage.setItem('thor_dead_letter_queue_v1', JSON.stringify([
      { queueId: 'Q1', opId: 'op-auto-1', action: 'adjustStock', data: { id: 'PROD-BASE', delta: -1 }, retries: 5 }
    ]));
    await sincronizar(env);
    await new Promise(r => setTimeout(r, 20));
    await env.api.flushOutbox();
    assert.strictEqual(env.api.getDeadLetterQueue().length, 0);
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 9);
    // Solo una vez por día
    env.ctx.localStorage.setItem('thor_dead_letter_queue_v1', JSON.stringify([
      { queueId: 'Q2', opId: 'op-auto-2', action: 'adjustStock', data: { id: 'PROD-BASE', delta: -1 }, retries: 5 }
    ]));
    await sincronizar(env);
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(env.api.getDeadLetterQueue().length, 1);
  });

  await test('Diagnóstico: un producto con alias no aparece como duplicado ni con exceso', async () => {
    const env = entorno();
    await sincronizar(env);
    env.backend.post({ action: 'saveProduct', token: token(env), data: { id: 'PROD-NUBE', nombre: 'Crema Coco', cantidad: 0, precio_venta_dop: 500 } });
    env.ctx.navigator.onLine = false;
    await env.api.registerReception({ nombre_tanque: 'T', tasa_cambio: 60, articulos: [{ nombre: 'Crema Coco', cantidad: 4, precio_venta_dop: 500 }] });
    env.ctx.navigator.onLine = true;
    await env.api.flushOutbox();
    const d = env.backend.ctx.diagnosticarInventario(false);
    assert.strictEqual(d.resumen.productos_duplicados + d.resumen.productos_con_exceso + d.resumen.recepciones_duplicadas, 0, d.message);
  });

  console.log(`\n${ok} pruebas superadas`);
})().catch(e => { console.error(e); process.exit(1); });
