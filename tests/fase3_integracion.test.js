// Integración Fase 3: el navegador ya no "concilia" por su cuenta (no revierte mermas ni recrea productos)
const fs = require('fs');
const assert = require('assert');
const { entorno, sincronizar, outbox, stockServidor } = require('./helpers/cliente');

let ok = 0;
async function test(nombre, fn) { await fn(); ok++; console.log('✔ ' + nombre); }

(async () => {
  await test('Una merma registrada no se revierte al sincronizar', async () => {
    const env = entorno();
    const t = env.ctx.sessionStorage.getItem('thor_session_token');
    env.backend.post({ action: 'registerReception', token: t, data: { nombre_tanque: 'T1', articulos: [{ nombre: 'Crema Coco', cantidad: 10 }] } });
    await sincronizar(env);
    const crema = env.api.getCachedData().inventario.find(p => p.nombre === 'Crema Coco');
    await env.api.adjustStock(crema.id, -2, 'Merma');
    for (let i = 0; i < 3; i++) await sincronizar(env);
    await env.api.flushOutbox();
    assert.strictEqual(outbox(env).length, 0, 'la sincronización no encola correcciones automáticas');
    assert.strictEqual(stockServidor(env.backend, crema.id), 8);
    assert.strictEqual(env.api.getCachedData().inventario.find(p => p.id === crema.id).cantidad, 8);
  });

  await test('Un producto de tanque eliminado no reaparece como PROD-REST tras sincronizar', async () => {
    const env = entorno();
    const t = env.ctx.sessionStorage.getItem('thor_session_token');
    env.backend.post({ action: 'registerReception', token: t, data: { nombre_tanque: 'T1', articulos: [{ nombre: 'Splash Viejo', cantidad: 4 }] } });
    await sincronizar(env);
    const splash = env.api.getCachedData().inventario.find(p => p.nombre === 'Splash Viejo');
    await env.api.deleteProduct(splash.id);
    for (let i = 0; i < 3; i++) await sincronizar(env);
    await env.api.flushOutbox();
    const activos = env.backend.filas('Inventario').filter(f => f[10] !== 'Eliminado');
    assert.ok(!activos.some(f => /splash viejo/i.test(f[1])), 'no se recreó');
    assert.ok(!env.api.getCachedData().inventario.some(p => /^PROD-REST/.test(p.id)));
  });

  await test('Un producto renombrado no genera una copia con el nombre viejo', async () => {
    const env = entorno();
    const t = env.ctx.sessionStorage.getItem('thor_session_token');
    env.backend.post({ action: 'registerReception', token: t, data: { nombre_tanque: 'T1', articulos: [{ nombre: 'Crema de Coco 200ml', cantidad: 5 }] } });
    await sincronizar(env);
    const p = env.api.getCachedData().inventario.find(x => x.nombre === 'Crema de Coco 200ml');
    await env.api.saveProduct(Object.assign({}, p, { nombre: 'Crema Coco' }));
    for (let i = 0; i < 3; i++) await sincronizar(env);
    await env.api.flushOutbox();
    const activos = env.backend.filas('Inventario').filter(f => f[10] !== 'Eliminado');
    assert.strictEqual(activos.filter(f => /coco/i.test(f[1])).length, 1);
  });

  await test('El botón de diagnóstico (reconcileWithCloud) devuelve el resumen sin tocar el inventario', async () => {
    const env = entorno();
    await sincronizar(env);
    const antes = JSON.stringify(env.backend.hojas.Inventario.data);
    const r = await env.api.reconcileWithCloud();
    assert.strictEqual(r.status, 'success');
    assert.ok(r.resumen);
    assert.strictEqual(JSON.stringify(env.backend.hojas.Inventario.data), antes);
  });

  console.log(`\n${ok} pruebas superadas`);
})().catch(e => { console.error(e); process.exit(1); });
