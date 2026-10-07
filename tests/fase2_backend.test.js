// Pruebas Fase 2 (backend): idempotencia por op_id, deduplicación por entidad e IDs únicos
const assert = require('assert');
const path = require('path');
const { crearBackend } = require('./helpers/gas');
const RUTA = path.resolve(__dirname, '..', 'backend', 'Codigo.gs');

let ok = 0;
function test(nombre, fn) { fn(); ok++; console.log('✔ ' + nombre); }

function conProducto(b, token, cantidad = 10) {
  const r = b.post({ action: 'saveProduct', token, data: { id: 'PROD-TEST-1', nombre: 'Perfume Uno', cantidad, precio_venta_dop: 1000, costo_dop: 400 } });
  assert.strictEqual(r.status, 'success');
}
const stock = (b, id) => Number(b.filas('Inventario').find(f => f[0] === id)[4]);

test('Mismo op_id enviado 3 veces → 1 venta y stock descontado una sola vez', () => {
  const b = crearBackend(RUTA); const t = b.login(); conProducto(b, t);
  const payload = { action: 'registerSale', token: t, op_id: 'op-venta-1', data: { id_articulo: 'PROD-TEST-1', cantidad: 2 } };
  const r1 = b.post(payload), r2 = b.post(payload), r3 = b.post(payload);
  assert.strictEqual(r1.status, 'success');
  assert.ok(!r1.duplicado && r2.duplicado && r3.duplicado);
  assert.strictEqual(r2.id_venta, r1.id_venta);
  assert.strictEqual(b.filas('Ventas').length, 1);
  assert.strictEqual(stock(b, 'PROD-TEST-1'), 8);
  assert.strictEqual(b.filas('Operaciones').length, 1);
  assert.ok(b.hojas.Operaciones.hidden);
});

test('Op_id resuelto desde la hoja aunque la caché haya expirado', () => {
  const b = crearBackend(RUTA); const t = b.login(); conProducto(b, t);
  const payload = { action: 'adjustStock', token: t, op_id: 'op-aj-1', data: { id: 'PROD-TEST-1', delta: -3 } };
  b.post(payload);
  Object.keys(b.cache).filter(k => k.startsWith('OP_')).forEach(k => delete b.cache[k]);
  const r = b.post(payload);
  assert.ok(r.duplicado);
  assert.strictEqual(stock(b, 'PROD-TEST-1'), 7);
});

test('Mismo id_venta con op_id distinto (p. ej. re-encolado manual) → no duplica', () => {
  const b = crearBackend(RUTA); const t = b.login(); conProducto(b, t, 3);
  const data = { id_venta: 'VTA-20261007-AAAA1111', id_articulo: 'PROD-TEST-1', cantidad: 3 };
  assert.strictEqual(b.post({ action: 'registerSale', token: t, op_id: 'op-a', data }).status, 'success');
  // Sin stock ya: el reintento no debe fallar por "stock insuficiente" sino reconocerse como duplicado
  const r = b.post({ action: 'registerSale', token: t, op_id: 'op-b', data });
  assert.strictEqual(r.status, 'success');
  assert.ok(r.duplicado);
  assert.strictEqual(b.filas('Ventas').length, 1);
  assert.strictEqual(stock(b, 'PROD-TEST-1'), 0);
});

test('Venta a crédito respeta id_venta, id_cobro e id_abono_inicial del cliente', () => {
  const b = crearBackend(RUTA); const t = b.login(); conProducto(b, t);
  const r = b.post({ action: 'registerSale', token: t, op_id: 'op-c', data: {
    id_venta: 'VTA-X', id_cobro: 'COB-X', id_abono_inicial: 'ABN-X', id_articulo: 'PROD-TEST-1',
    cantidad: 1, tipo_venta: 'credito', abono_inicial: 200, num_cuotas: 2, cliente: 'Laura'
  } });
  assert.strictEqual(r.id_venta, 'VTA-X');
  assert.strictEqual(r.cobro.id_cobro, 'COB-X');
  assert.strictEqual(r.cobro.historial_abonos[0].id_abono, 'ABN-X');
  const cob = b.filas('Cobros')[0];
  assert.strictEqual(cob[0], 'COB-X');
  assert.strictEqual(cob[1], 'VTA-X');
});

test('Abono repetido (mismo id_abono) se aplica una sola vez, también si saldó la cuenta', () => {
  const b = crearBackend(RUTA); const t = b.login(); conProducto(b, t);
  b.post({ action: 'registerSale', token: t, data: { id_venta: 'VTA-Y', id_cobro: 'COB-Y', id_articulo: 'PROD-TEST-1', cantidad: 1, tipo_venta: 'credito', num_cuotas: 2 } });
  const pago = { id_cobro: 'COB-Y', id_abono: 'ABN-Y1', monto: 1000 };
  const r1 = b.post({ action: 'registerPayment', token: t, op_id: 'p1', data: pago });
  assert.strictEqual(r1.estado, 'Saldada');
  const r2 = b.post({ action: 'registerPayment', token: t, op_id: 'p2', data: pago });
  assert.strictEqual(r2.status, 'success');
  assert.ok(r2.duplicado);
  const cob = b.filas('Cobros')[0];
  assert.strictEqual(Number(cob[8]), 1000);
  assert.strictEqual(JSON.parse(cob[14]).length, 1);
});

test('Tanque con 30 productos nuevos → 30 IDs distintos, guardados en el detalle', () => {
  const b = crearBackend(RUTA); const t = b.login();
  const articulos = Array.from({ length: 30 }, (_, i) => ({ nombre: 'Producto ' + i, cantidad: 2, costo_usd: 5 }));
  const r = b.post({ action: 'registerReception', token: t, data: { nombre_tanque: 'Tanque Oct', articulos } });
  assert.strictEqual(r.status, 'success');
  const ids = b.filas('Inventario').map(f => f[0]);
  assert.strictEqual(ids.length, 30);
  assert.strictEqual(new Set(ids).size, 30);
  ids.forEach(id => assert.match(id, /^PROD-\d{8}-[0-9A-F]{8}$/));
  const detalle = JSON.parse(b.filas('Recepciones')[0][8]);
  assert.deepStrictEqual(detalle.map(a => a.id).sort(), ids.slice().sort());
});

test('Tanque: respeta IDs del cliente, suma a existente por nombre y no se duplica al reintentar', () => {
  const b = crearBackend(RUTA); const t = b.login(); conProducto(b, t, 5);
  const data = { id_recepcion: 'TANQ-Z', nombre_tanque: 'Tanque Z', articulos: [
    { id: 'PROD-NUEVO-Z', nombre: 'Crema Nueva', cantidad: 4 },
    { id: 'PROD-CLIENTE-NO-EXISTE', nombre: '  perfume   UNO ', cantidad: 3 }
  ] };
  b.post({ action: 'registerReception', token: t, op_id: 'r1', data });
  const r2 = b.post({ action: 'registerReception', token: t, op_id: 'r2', data });
  assert.ok(r2.duplicado);
  assert.strictEqual(b.filas('Recepciones').length, 1);
  assert.strictEqual(stock(b, 'PROD-NUEVO-Z'), 4);
  assert.strictEqual(stock(b, 'PROD-TEST-1'), 8);
  const detalle = JSON.parse(b.filas('Recepciones')[0][8]);
  assert.strictEqual(detalle[1].id, 'PROD-TEST-1', 'el detalle guarda el ID real del producto existente');
});

test('Anular dos veces la misma venta → éxito idempotente y stock repuesto una sola vez', () => {
  const b = crearBackend(RUTA); const t = b.login(); conProducto(b, t);
  b.post({ action: 'registerSale', token: t, data: { id_venta: 'VTA-C', id_articulo: 'PROD-TEST-1', cantidad: 4 } });
  const r1 = b.post({ action: 'cancelSale', token: t, data: { id_venta: 'VTA-C' } });
  const r2 = b.post({ action: 'cancelSale', token: t, data: { id_venta: 'VTA-C' } });
  assert.strictEqual(r1.status, 'success');
  assert.strictEqual(r2.status, 'success');
  assert.ok(r2.duplicado);
  assert.strictEqual(stock(b, 'PROD-TEST-1'), 10);
});

test('Una operación rechazada no queda registrada: el reintento posterior puede aplicarse', () => {
  const b = crearBackend(RUTA); const t = b.login(); conProducto(b, t, 1);
  const payload = { action: 'registerSale', token: t, op_id: 'op-fallo', data: { id_articulo: 'PROD-TEST-1', cantidad: 2 } };
  assert.strictEqual(b.post(payload).status, 'error');
  b.post({ action: 'adjustStock', token: t, data: { id: 'PROD-TEST-1', delta: 5 } });
  const r = b.post(payload);
  assert.strictEqual(r.status, 'success');
  assert.ok(!r.duplicado);
});

test('Frontend anterior (sin op_id ni IDs) sigue funcionando, con IDs nuevos únicos', () => {
  const b = crearBackend(RUTA); const t = b.login(); conProducto(b, t);
  const r1 = b.post({ action: 'registerSale', token: t, data: { id_articulo: 'PROD-TEST-1', cantidad: 1 } });
  const r2 = b.post({ action: 'registerSale', token: t, data: { id_articulo: 'PROD-TEST-1', cantidad: 1 } });
  assert.match(r1.id_venta, /^VTA-\d{8}-[0-9A-F]{8}$/);
  assert.notStrictEqual(r1.id_venta, r2.id_venta);
  assert.strictEqual(b.filas('Operaciones').length, 0);
  const p = b.post({ action: 'saveProduct', token: t, data: { nombre: 'Sin ID', precio_venta_dop: 5 } });
  assert.match(p.id, /^PROD-\d{8}-[0-9A-F]{8}$/);
});

test('op_id con formato inválido se ignora (no se usa como clave)', () => {
  const b = crearBackend(RUTA); const t = b.login(); conProducto(b, t);
  b.post({ action: 'adjustStock', token: t, op_id: "x'); DROP", data: { id: 'PROD-TEST-1', delta: 1 } });
  assert.strictEqual(b.filas('Operaciones').length, 0);
});

test('Acción desconocida devuelve error sin romper', () => {
  const b = crearBackend(RUTA); const t = b.login();
  const r = b.post({ action: 'noExiste', token: t, op_id: 'op-x' });
  assert.strictEqual(r.status, 'error');
});

console.log(`\n${ok} pruebas superadas`);
