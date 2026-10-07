// Pruebas Fase 7: token fuera de la URL, compatibilidad con backend anterior y lectura única en getAllData
const fs = require('fs');
const assert = require('assert');
const { entorno, sincronizar } = require('./helpers/cliente');

let ok = 0;
async function test(nombre, fn) { await fn(); ok++; console.log('✔ ' + nombre); }

function espiarRed(env) {
  const llamadas = [];
  const real = env.ctx.fetch;
  env.ctx.fetch = (url, opts = {}) => {
    llamadas.push({ url: String(url), metodo: opts.method || 'GET', body: opts.body || '' });
    return real(url, opts);
  };
  return llamadas;
}

(async () => {
  await test('Ninguna petición lleva el token de sesión en la URL', async () => {
    const env = entorno();
    const llamadas = espiarRed(env);
    await sincronizar(env);
    await env.api.registerSale({ id_articulo: 'PROD-BASE', cantidad: 1, precio_unitario_dop: 1000 });
    await env.api.reconcileWithCloud();
    await sincronizar(env);
    assert.ok(llamadas.length >= 4);
    const tok = env.ctx.sessionStorage.getItem('thor_session_token');
    assert.ok(llamadas.every(l => !l.url.includes(tok) && !/token=/.test(l.url)), 'token en URL');
    assert.ok(llamadas.every(l => l.metodo === 'POST'));
    assert.ok(llamadas.some(l => JSON.parse(l.body).action === 'getAllData'));
  });

  await test('getAllData: métricas idénticas leyendo cada hoja una sola vez', async () => {
    const env = entorno();
    const t = env.ctx.sessionStorage.getItem('thor_session_token');
    env.backend.post({ action: 'registerSale', token: t, data: { id_articulo: 'PROD-BASE', cantidad: 2, tipo_venta: 'credito', num_cuotas: 2, cliente: 'Ana' } });
    const lecturas = { Inventario: 0, Ventas: 0, Cobros: 0 };
    Object.keys(lecturas).forEach(nombre => {
      const hoja = env.backend.hojas[nombre];
      const original = hoja.getDataRange.bind(hoja);
      hoja.getDataRange = () => { lecturas[nombre]++; return original(); };
    });
    const r = env.backend.post({ action: 'getAllData', token: t });
    assert.strictEqual(r.status, 'success');
    assert.deepStrictEqual(lecturas, { Inventario: 1, Ventas: 1, Cobros: 1 });
    const aparte = JSON.parse(JSON.stringify(env.backend.ctx.calcularMetricasGenerales()));
    assert.deepStrictEqual(r.data.metricas, aparte);
    assert.strictEqual(r.data.metricas.clientes_con_deuda, 1);
  });

  await test('Lecturas por POST exigen sesión válida', async () => {
    const env = entorno();
    const r = env.backend.post({ action: 'getAllData', token: 'THOR_SES_falso' });
    assert.strictEqual(r.code, 'UNAUTHORIZED_RLS');
    assert.ok(!r.data);
  });

  console.log(`\n${ok} pruebas superadas`);
})().catch(e => { console.error(e); process.exit(1); });
