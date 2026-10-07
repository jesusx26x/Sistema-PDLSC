// Integración Fase 2: idempotencia e IDs (js/api.js real ↔ backend/Codigo.gs real)
const assert = require('assert');
const { entorno, sincronizar, outbox, stockServidor } = require('./helpers/cliente');

let ok = 0;
async function test(nombre, fn) { await fn(); ok++; console.log('✔ ' + nombre); }

(async () => {
  await test('Respuesta perdida tras guardar en el servidor → el reintento NO duplica la venta', async () => {
    const env = entorno();
    await sincronizar(env);
    env.red.modo = 'perder-respuesta';
    const r = await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 2, precio_unitario_dop: 1000 });
    assert.ok(r.isQueued);
    assert.strictEqual(outbox(env).length, 1);
    assert.ok(outbox(env)[0].opId);

    env.red.modo = 'normal';
    const f = await env.api.flushOutbox();
    assert.strictEqual(f.pending, 0);
    assert.strictEqual(env.backend.filas('Ventas').length, 1);
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 8);
    const ops = env.red.posts.map(p => p.op_id);
    assert.strictEqual(ops[0], ops[1], 'mismo op_id en el reintento');
  });

  await test('apiPost en vuelo + flushOutbox simultáneo (p. ej. volver de WhatsApp) → un solo envío', async () => {
    const env = entorno();
    await sincronizar(env);
    env.red.modo = 'manual';
    const venta = env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000 });
    const flush = env.api.flushOutbox();
    const flush2 = env.api.flushOutbox();
    for (let i = 0; i < 20 && env.red.pendientes.length === 0; i++) await new Promise(r => setImmediate(r));
    env.red.modo = 'normal';
    while (env.red.pendientes.length) env.red.pendientes.shift()();
    const [rv, rf] = await Promise.all([venta, flush, flush2]);
    assert.strictEqual(rv.status, 'success');
    assert.ok(!rv.isQueued);
    assert.strictEqual(rf.pending, 0);
    assert.strictEqual(env.red.posts.filter(p => p.action === 'registerSale').length, 1);
    assert.strictEqual(env.backend.filas('Ventas').length, 1);
    assert.strictEqual(env.red.maxEnVuelo, 1);
  });

  await test('Varias operaciones seguidas se envían de una en una y en orden', async () => {
    const env = entorno();
    await sincronizar(env);
    const ps = [
      env.api.saveProduct({ nombre: 'Splash Nuevo', cantidad: 5, precio_venta_dop: 500 }),
      env.api.adjustStock('PROD-BASE', -1, 'Merma'),
      env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000 })
    ];
    await Promise.all(ps);
    assert.strictEqual(env.red.maxEnVuelo, 1);
    assert.deepStrictEqual(env.red.posts.map(p => p.action), ['saveProduct', 'adjustStock', 'registerSale']);
  });

  await test('IDs locales = IDs del servidor (venta, cobro, abono, productos de tanque)', async () => {
    const env = entorno();
    await sincronizar(env);
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000, tipo_venta: 'credito', es_credito: true, abono_inicial: 100, num_cuotas: 2, cliente: 'Laura' });
    await env.api.registerReception({ nombre_tanque: 'Tanque Oct', tasa_cambio: 60, articulos: [
      { nombre: 'Crema Coco', cantidad: 3, costo_usd: 4, precio_venta_dop: 600 },
      { nombre: 'perfume  base', cantidad: 2 },
      { nombre: 'Body Wash Lila', cantidad: 6, costo_usd: 3, precio_venta_dop: 450 }
    ] });
    const local = env.api.getCachedData();
    const idsLocales = local.inventario.map(p => p.id).sort();
    const idsServidor = env.backend.filas('Inventario').map(f => f[0]).sort();
    assert.deepStrictEqual(idsLocales, idsServidor);
    assert.strictEqual(local.ventas[0].id_venta, env.backend.filas('Ventas')[0][0]);
    assert.strictEqual(local.cobros[0].id_cobro, env.backend.filas('Cobros')[0][0]);
    assert.strictEqual(local.recepciones[0].id_recepcion, env.backend.filas('Recepciones')[0][0]);
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 11);
    assert.strictEqual(local.inventario.find(p => p.id === 'PROD-BASE').cantidad, 11);
  });

  await test('Sin conexión: vender a crédito, abonar y anular otra venta → todo se aplica al reconectar', async () => {
    const env = entorno();
    await sincronizar(env);
    env.ctx.navigator.onLine = false;
    const vc = await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000, tipo_venta: 'credito', es_credito: true, num_cuotas: 2, cliente: 'Rosa' });
    assert.ok(vc.isQueued);
    const cobroLocal = env.api.getCachedData().cobros[0];
    await env.api.registerPayment({ id_cobro: cobroLocal.id_cobro, monto: 400, metodo_pago: 'Efectivo' });
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 2, precio_unitario_dop: 1000 });
    const ventaContado = env.api.getCachedData().ventas[0];
    await env.api.cancelSale(ventaContado.id_venta);
    assert.strictEqual(outbox(env).length, 4);

    env.ctx.navigator.onLine = true;
    const f = await env.api.flushOutbox();
    assert.strictEqual(f.pending, 0, 'ninguna operación termina en la cola de recuperación');
    assert.strictEqual(env.api.getDeadLetterQueue().length, 0);
    const cob = env.backend.filas('Cobros')[0];
    assert.strictEqual(cob[0], cobroLocal.id_cobro);
    assert.strictEqual(Number(cob[8]), 400);
    const vendida = env.backend.filas('Ventas').find(f => f[0] === ventaContado.id_venta);
    assert.strictEqual(vendida[13], 'Cancelada');
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 9);
  });

  await test('Operaciones heredadas en la cola sin opId reciben uno estable', async () => {
    const env = entorno();
    env.ctx.localStorage.setItem('thor_outbox_queue_v1', JSON.stringify([
      { queueId: 'OUTBOX_viejo', action: 'adjustStock', data: { id: 'PROD-BASE', delta: 1 }, retries: 0 }
    ]));
    env.red.modo = 'perder-respuesta';
    await env.api.flushOutbox();
    const opId = outbox(env)[0].opId;
    assert.ok(opId);
    env.red.modo = 'normal';
    await env.api.flushOutbox();
    assert.strictEqual(env.red.posts[0].op_id, opId);
    assert.strictEqual(env.red.posts[1].op_id, opId);
    assert.strictEqual(stockServidor(env.backend, 'PROD-BASE'), 11);
  });

  await test('enqueueOutbox conserva el opId al re-encolar desde la cola de recuperación', async () => {
    const env = entorno();
    const item = env.api.enqueueOutbox('adjustStock', { id: 'PROD-BASE', delta: 1 }, 'op-original');
    assert.strictEqual(item.opId, 'op-original');
  });

  await test('Formato de generarId compatible con el backend', async () => {
    const env = entorno();
    const id = env.api.generarId('VTA');
    assert.match(id, /^VTA-\d{8}-[0-9A-F]{8}$/);
    assert.notStrictEqual(env.api.generarId('VTA'), id);
  });

  console.log(`\n${ok} pruebas superadas`);
})().catch(e => { console.error(e); process.exit(1); });
