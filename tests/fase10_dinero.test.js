// Pruebas Fase 10: dinero exacto (cobros de más, fiados anulados con abonos, abono ≥ total y dinero cobrado)
const assert = require('assert');
const path = require('path');
const { crearBackend } = require('./helpers/gas');
const { entorno, sincronizar, outbox, crearCliente } = require('./helpers/cliente');

const RUTA = path.resolve(__dirname, '..', 'backend', 'Codigo.gs');
const token = env => env.ctx.sessionStorage.getItem('thor_session_token');
function otro(env) {
  const c = crearCliente(env.backend);
  c.ctx.sessionStorage.setItem('thor_session_token', token(env));
  return c;
}
const cobroNube = b => b.filas('Cobros')[0];

let ok = 0;
async function test(nombre, fn) { await fn(); ok++; console.log('✔ ' + nombre); }

(async () => {
  // ---------------- H6 ----------------
  await test('H6: dos equipos cobran el mismo fiado sin conexión → el sobrante queda registrado y en "Por revisar"', async () => {
    const env = entorno();
    await sincronizar(env);
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000, tipo_venta: 'credito', es_credito: true, num_cuotas: 2, cliente: 'Rosa' });
    await sincronizar(env);
    const b = otro(env);
    const rb = await b.api.fetchAllData(true); b.api.setCachedData(rb.data);
    const idCobro = env.api.getCachedData().cobros[0].id_cobro;
    env.ctx.navigator.onLine = false; b.ctx.navigator.onLine = false;
    await env.api.registerPayment({ id_cobro: idCobro, monto: 700 });
    await b.api.registerPayment({ id_cobro: idCobro, monto: 700 });
    env.ctx.navigator.onLine = true; b.ctx.navigator.onLine = true;
    await env.api.flushOutbox();
    const fb = await b.api.flushOutbox();
    assert.strictEqual(fb.rejected, 0);
    const fila = cobroNube(env.backend);
    assert.strictEqual(Number(fila[8]), 1000, 'cobrado aplicado al saldo');
    assert.strictEqual(fila[12], 'Saldada');
    const hist = JSON.parse(fila[14]);
    assert.strictEqual(hist.reduce((t, a) => t + (a.excedente || 0), 0), 400, 'los RD$ 400 de más quedan registrados');
    assert.ok(hist.some(a => /Excedente RD\$ 400/.test(a.nota)));
    const log = b.api.getHistorialSync();
    assert.strictEqual(log[0].tipo, 'excedente');
    assert.ok(/400/.test(log[0].mensaje));
    assert.strictEqual(b.api.contarPorRevisar(), 1);
    const data = await sincronizar(env);
    assert.strictEqual(data.cobros[0].excedente_dop, 400);
    assert.strictEqual(data.cobros[0].a_devolver_dop, 400);
  });

  await test('H6: un abono que llega a una cuenta ya saldada se registra completo como excedente (no se rechaza)', async () => {
    const b = crearBackend(RUTA);
    const t = b.login();
    b.post({ action: 'saveProduct', token: t, data: { id: 'P1', nombre: 'Crema', cantidad: 5, precio_venta_dop: 500 } });
    b.post({ action: 'registerSale', token: t, data: { id_venta: 'V1', id_cobro: 'C1', id_articulo: 'P1', cantidad: 1, tipo_venta: 'credito', num_cuotas: 1, cliente: 'Ana' } });
    b.post({ action: 'registerPayment', token: t, data: { id_cobro: 'C1', id_abono: 'A1', monto: 500 } });
    const r = b.post({ action: 'registerPayment', token: t, data: { id_cobro: 'C1', id_abono: 'A2', monto: 200 } });
    assert.strictEqual(r.status, 'success');
    assert.strictEqual(r.excedente, 200);
    assert.ok(/devuélvelos/i.test(r.message));
    assert.strictEqual(Number(cobroNube(b)[8]), 500);
    const repetido = b.post({ action: 'registerPayment', token: t, data: { id_cobro: 'C1', id_abono: 'A2', monto: 200 } });
    assert.ok(repetido.duplicado, 'el mismo abono no se registra dos veces');
    assert.strictEqual(JSON.parse(cobroNube(b)[14]).filter(a => a.excedente > 0).length, 1);
  });

  await test('H6: un abono mayor que el saldo aplica lo justo y registra el resto (servidor y dispositivo coinciden)', async () => {
    const env = entorno();
    await sincronizar(env);
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000, tipo_venta: 'credito', es_credito: true, num_cuotas: 2, cliente: 'Luis' });
    const idCobro = env.api.getCachedData().cobros[0].id_cobro;
    env.ctx.navigator.onLine = false;
    await env.api.registerPayment({ id_cobro: idCobro, monto: 1250 });
    const local = env.api.getCachedData().cobros[0];
    assert.strictEqual(local.saldo_pendiente_dop, 0);
    assert.strictEqual(local.excedente_dop, 250);
    env.ctx.navigator.onLine = true;
    await env.api.flushOutbox();
    assert.strictEqual(JSON.parse(cobroNube(env.backend)[14]).reduce((t, a) => t + (a.excedente || 0), 0), 250);
  });

  // ---------------- H7 ----------------
  await test('H7: anular un fiado con abonos deja anotado el dinero a devolver', async () => {
    const env = entorno();
    await sincronizar(env);
    await env.api.registerSale({ id_venta: 'VTA-F', id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000, tipo_venta: 'credito', es_credito: true, abono_inicial: 300, num_cuotas: 2, cliente: 'Marta' });
    const idCobro = env.api.getCachedData().cobros[0].id_cobro;
    await env.api.registerPayment({ id_cobro: idCobro, monto: 200 });
    const r = await env.api.cancelSale('VTA-F');
    assert.ok(/500\.00/.test(r.message) && /devolv/i.test(r.message), r.message);
    const fila = cobroNube(env.backend);
    assert.strictEqual(fila[12], 'Cancelada');
    assert.ok(JSON.parse(fila[14]).some(a => a.a_devolver === 500));
    const data = await sincronizar(env);
    assert.strictEqual(data.cobros[0].a_devolver_dop, 500);
    assert.strictEqual(data.metricas.total_por_cobrar_dop, 0);
  });

  await test('H7: anular un fiado sin abonos no genera dinero a devolver', async () => {
    const env = entorno();
    await sincronizar(env);
    await env.api.registerSale({ id_venta: 'VTA-G', id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000, tipo_venta: 'credito', es_credito: true, num_cuotas: 2, cliente: 'Pedro' });
    const r = await env.api.cancelSale('VTA-G');
    assert.ok(!/devolv/i.test(r.message));
    const data = await sincronizar(env);
    assert.strictEqual(data.cobros[0].a_devolver_dop, 0);
  });

  // ---------------- H19 ----------------
  await test('H19: una venta a crédito con abono inicial ≥ total se rechaza (servidor y dispositivo)', async () => {
    const env = entorno();
    await sincronizar(env);
    const r = await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000, tipo_venta: 'credito', es_credito: true, abono_inicial: 1000, cliente: 'X' });
    assert.strictEqual(r.status, 'error');
    assert.ok(/contado/.test(r.message));
    assert.strictEqual(outbox(env).length, 0);
    const s = env.backend.post({ action: 'registerSale', token: token(env), data: { id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000, tipo_venta: 'credito', abono_inicial: 1500 } });
    assert.strictEqual(s.code, 'VALIDACION');
    assert.strictEqual(env.backend.filas('Ventas').length, 0);
  });

  // ---------------- M2 ----------------
  await test('M2: el resumen histórico separa lo cobrado de lo vendido', async () => {
    const b = crearBackend(RUTA);
    const t = b.login();
    const viejo = new Date(Date.now() - 300 * 86400000);
    const V = b.hojas.Ventas;
    V.data.push(['V-C', viejo, 'P', 'Crema', 'Cremas', 1, 1000, 1000, 400, 600, 'Ana', 'Efectivo', '', 'Completada']);
    V.data.push(['V-F', viejo, 'P', 'Crema', 'Cremas', 1, 2000, 2000, 800, 1200, 'Luis', 'Crédito / Fiado', '', 'Completada']);
    V.data.push(['V-A', viejo, 'P', 'Crema', 'Cremas', 1, 900, 900, 400, 500, 'Rita', 'Crédito / Fiado', '', 'Cancelada']);
    b.hojas.Cobros.data.push(['C-F', 'V-F', viejo, 'Luis', '', 'Crema', 2000, 0, 2000, 0, 2, 'quincenal', 'Saldada', '', '[]', '[]']);
    b.hojas.Cobros.data.push(['C-A', 'V-A', viejo, 'Rita', '', 'Crema', 900, 300, 300, 0, 2, 'quincenal', 'Cancelada', '', '[]', '[]']);
    const h = b.post({ action: 'getAllData', token: t }).data.historial;
    assert.strictEqual(h.ingresos_dop, 3000, 'vendido');
    assert.strictEqual(h.cobrado_dop, 3000, 'contado 1000 + abonos 2000');
    assert.strictEqual(h.a_devolver_dop, 300, 'abonos de un fiado anulado');
  });

  console.log(`\n${ok} pruebas superadas`);
})().catch(e => { console.error(e); process.exit(1); });
