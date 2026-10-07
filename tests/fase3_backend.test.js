// Pruebas Fase 3 (backend): kardex, protección de eliminados, eliminarRecepcion y diagnóstico/corrección
const assert = require('assert');
const path = require('path');
const { crearBackend } = require('./helpers/gas');
const RUTA = path.resolve(__dirname, '..', 'backend', 'Codigo.gs');

let ok = 0;
function test(nombre, fn) { fn(); ok++; console.log('✔ ' + nombre); }

const fila = (b, id) => b.filas('Inventario').find(f => f[0] === id);
const stock = (b, id) => Number(fila(b, id)[4]);
const movs = (b, id) => b.filas('Movimientos').filter(m => !id || m[2] === id);
const sumaKardex = (b, id) => movs(b, id).reduce((t, m) => t + Number(m[5]), 0);

function verificarCuadreKardex(b) {
  b.filas('Inventario').filter(f => f[10] !== 'Eliminado').forEach(f => {
    assert.strictEqual(sumaKardex(b, f[0]), Number(f[4]), 'kardex descuadrado para ' + f[0]);
  });
}

test('Kardex: saldo inicial al activarse y cuadre exacto tras todo tipo de operaciones', () => {
  const b = crearBackend(RUTA);
  // Producto previo a la activación del kardex
  b.hojas.Inventario.data.push(['PROD-PREVIO', 'Perfume Previo', 'Perfumes', 'Tanque: T0', 7, 3, 0, 400, 1000, 'T0', 'En Stock', new Date(), new Date()]);
  const t = b.login();
  b.post({ action: 'saveProduct', token: t, data: { id: 'P1', nombre: 'Crema', cantidad: 10, precio_venta_dop: 500 } });
  assert.strictEqual(movs(b, 'PROD-PREVIO')[0][4], 'SALDO_INICIAL');
  assert.strictEqual(Number(movs(b, 'PROD-PREVIO')[0][5]), 7);
  b.post({ action: 'saveProduct', token: t, data: { id: 'P1', nombre: 'Crema', cantidad: 12, precio_venta_dop: 500 } });
  b.post({ action: 'adjustStock', token: t, data: { id: 'P1', delta: -2, motivo: 'Merma' } });
  b.post({ action: 'registerSale', token: t, data: { id_venta: 'V1', id_articulo: 'P1', cantidad: 3 } });
  b.post({ action: 'registerSale', token: t, data: { id_venta: 'V2', id_articulo: 'PROD-PREVIO', cantidad: 2 } });
  b.post({ action: 'cancelSale', token: t, data: { id_venta: 'V1' } });
  b.post({ action: 'registerReception', token: t, data: { id_recepcion: 'R1', nombre_tanque: 'T1', articulos: [
    { nombre: 'crema', cantidad: 5 }, { id: 'P2', nombre: 'Body Wash', cantidad: 4 }, { nombre: 'Body Wash', cantidad: 1 } ] } });
  b.post({ action: 'adjustStock', token: t, data: { id: 'P1', delta: -100 } });
  verificarCuadreKardex(b);
  const tipos = movs(b).map(m => m[4]);
  ['SALDO_INICIAL', 'ALTA', 'AJUSTE', 'VENTA', 'ANULACION', 'RECEPCION'].forEach(tp => assert.ok(tipos.includes(tp), 'falta ' + tp));
  // Fase 5: editar el producto no cambia la cantidad (10 → 12 en el formulario se ignora)
  assert.ok(!tipos.includes('EDICION'));
  assert.strictEqual(stock(b, 'P2'), 5);
  assert.ok(!b.hojas.AJUSTES, 'ya no se escribe la hoja AJUSTES');
});

test('Un producto eliminado no revive: venta, ajuste, edición y anulación', () => {
  const b = crearBackend(RUTA); const t = b.login();
  b.post({ action: 'saveProduct', token: t, data: { id: 'P1', nombre: 'Splash', cantidad: 5, precio_venta_dop: 300 } });
  b.post({ action: 'registerSale', token: t, data: { id_venta: 'V1', id_articulo: 'P1', cantidad: 2 } });
  b.post({ action: 'deleteProduct', token: t, data: 'P1' });
  assert.strictEqual(b.post({ action: 'registerSale', token: t, data: { id_articulo: 'P1', cantidad: 1 } }).code, 'PRODUCTO_ELIMINADO');
  assert.strictEqual(b.post({ action: 'adjustStock', token: t, data: { id: 'P1', delta: 3 } }).code, 'PRODUCTO_ELIMINADO');
  assert.strictEqual(b.post({ action: 'saveProduct', token: t, data: { id: 'P1', nombre: 'Splash', cantidad: 9, precio_venta_dop: 300 } }).code, 'PRODUCTO_ELIMINADO');
  const c = b.post({ action: 'cancelSale', token: t, data: { id_venta: 'V1' } });
  assert.strictEqual(c.status, 'success');
  assert.strictEqual(b.filas('Ventas')[0][13], 'Cancelada');
  assert.strictEqual(fila(b, 'P1')[10], 'Eliminado');
  assert.strictEqual(stock(b, 'P1'), 0);
  assert.ok(b.post({ action: 'deleteProduct', token: t, data: 'P1' }).duplicado);
});

test('Tanque con el nombre (o el ID) de un producto eliminado crea uno nuevo con ID nuevo', () => {
  const b = crearBackend(RUTA); const t = b.login();
  b.post({ action: 'saveProduct', token: t, data: { id: 'P-VIEJO', nombre: 'Splash Mango', cantidad: 2, precio_venta_dop: 300 } });
  b.post({ action: 'deleteProduct', token: t, data: 'P-VIEJO' });
  b.post({ action: 'registerReception', token: t, data: { nombre_tanque: 'T', articulos: [
    { nombre: 'Splash Mango', cantidad: 6 }, { id: 'P-VIEJO', nombre: 'Otro', cantidad: 1 } ] } });
  assert.strictEqual(fila(b, 'P-VIEJO')[10], 'Eliminado');
  assert.strictEqual(stock(b, 'P-VIEJO'), 0);
  const activos = b.filas('Inventario').filter(f => f[10] !== 'Eliminado');
  assert.strictEqual(activos.length, 2);
  assert.ok(activos.every(f => f[0] !== 'P-VIEJO'));
  assert.strictEqual(new Set(b.filas('Inventario').map(f => f[0])).size, 3, 'sin IDs repetidos');
});

test('Eliminar un tanque descuenta sus unidades (y avisa si ya se vendieron)', () => {
  const b = crearBackend(RUTA); const t = b.login();
  b.post({ action: 'saveProduct', token: t, data: { id: 'P1', nombre: 'Crema', cantidad: 2, precio_venta_dop: 500 } });
  b.post({ action: 'registerReception', token: t, data: { id_recepcion: 'R1', nombre_tanque: 'T1', articulos: [
    { id: 'P1', nombre: 'Crema', cantidad: 5 }, { nombre: 'Labial', cantidad: 4 } ] } });
  const labial = b.filas('Inventario').find(f => f[1] === 'Labial')[0];
  b.post({ action: 'registerSale', token: t, data: { id_articulo: labial, cantidad: 3 } });
  const r = b.post({ action: 'deleteReception', token: t, data: { id_recepcion: 'R1' } });
  assert.strictEqual(r.status, 'success');
  assert.strictEqual(stock(b, 'P1'), 2);
  assert.strictEqual(stock(b, labial), 0);
  assert.strictEqual(r.faltantes.length, 1);
  assert.strictEqual(b.filas('Recepciones').length, 0);
  verificarCuadreKardex(b);
});

// ---------------------------------------------------------------------------
// Escenario que reproduce el reporte de Pamela con datos dejados por el código anterior
// ---------------------------------------------------------------------------
function escenarioPamela() {
  const b = crearBackend(RUTA);
  const H = b.hojas;
  const d = m => new Date(2026, 8, 1, 10, m);
  const inv = (id, nombre, desc, cant, estado = 'En Stock', fecha = d(0)) =>
    H.Inventario.data.push([id, nombre, 'Perfumes', desc, cant, 3, 5, 300, 900, 'T1', estado, fecha, fecha]);
  const tanque = (id, minuto) => H.Recepciones.data.push([id, d(minuto), 'Tanque Septiembre', 'Miami', 21, 0, 60, '',
    JSON.stringify([{ id: 'PROD-A', nombre: 'Perfume Rosa', cantidad: 10 }, { nombre: 'Crema de Coco 200ml', cantidad: 8 }, { nombre: 'Splash Viejo', cantidad: 3 }])]);
  const venta = (id, idProd, nombre, cant, estado = 'Completada') =>
    H.Ventas.data.push([id, d(30), idProd, nombre, 'Perfumes', cant, 900, 900 * cant, 300, 600 * cant, 'Cliente', 'Efectivo', '', estado]);

  // Perfume Rosa: recibido 10, vendido 3 (+2 anuladas), merma -1 → justificado 6... menos 1 vendida desde su clon = 5
  inv('PROD-A', 'Perfume Rosa', 'Tanque: Tanque Septiembre', 12);
  inv('PROD-REST-111', 'Perfume Rosa', 'Tanque: Tanque Septiembre', 7, 'En Stock', d(50));
  // Crema renombrada: se recibió como "Crema de Coco 200ml", hoy se llama "Crema Coco"; su clon conserva el nombre viejo
  inv('PROD-B', 'Crema Coco', 'Tanque: Tanque Septiembre', 6);
  inv('PROD-REST-222', 'Crema de Coco 200ml', 'Tanque: Tanque Septiembre', 8, 'En Stock', d(50));
  // Producto manual sin tanques y uno eliminado
  inv('PROD-C', 'Labial Rojo', 'Labial mate', 4);
  inv('PROD-D', 'Splash Viejo', 'Tanque: Tanque Septiembre', 0, 'Eliminado');
  // Tanque registrado dos veces (doble envío)
  tanque('TANQ-1', 0);
  tanque('TANQ-1-DUP', 2);
  venta('V1', 'PROD-A', 'Perfume Rosa', 3);
  venta('V2', 'PROD-A', 'Perfume Rosa', 2, 'Cancelada');
  venta('V3', 'PROD-REST-111', 'Perfume Rosa', 1);
  venta('V4', 'PROD-B', 'Crema de Coco 200ml', 2);
  H.AJUSTES = new (H.Inventario.constructor)('AJUSTES');
  H.AJUSTES.data.push(['Fecha', 'ID Producto', 'Nombre Producto', 'Cantidad Anterior', 'Delta', 'Cantidad Nueva', 'Motivo', 'Usuario']);
  H.AJUSTES.data.push([d(40), 'PROD-A', 'Perfume Rosa', 10, -1, 9, 'Merma/Ajuste manual (-1)', 'Sistema']);
  H.AJUSTES.data.push([d(41), 'PROD-A', 'Perfume Rosa', 9, 2, 11, 'Cancelación de venta V2', 'Sistema']);
  return b;
}

const diag = b => b.hojas['Diagnóstico Inventario'].data;
const filaDiag = (b, id) => diag(b).find(f => f[2] === id);

test('Diagnóstico detecta duplicados (incluido el renombrado), tanque doble y calcula el stock justificado', () => {
  const b = escenarioPamela();
  const r = b.ctx.diagnosticarInventario(true);
  assert.strictEqual(r.resumen.grupos_duplicados, 2);
  assert.strictEqual(r.resumen.productos_duplicados, 2);
  assert.strictEqual(r.resumen.recepciones_duplicadas, 1);

  const a = filaDiag(b, 'PROD-A');
  assert.strictEqual(a[12], 'AJUSTAR_STOCK');
  assert.strictEqual(a[6], 10, 'el tanque duplicado no se cuenta dos veces');
  assert.strictEqual(a[7], 4, 'vendido = 3 + 1 del clon; la anulada no cuenta');
  assert.strictEqual(a[8], -1, 'la anulación de AJUSTES no se cuenta dos veces');
  assert.strictEqual(a[9], 5);
  assert.strictEqual(a[13], 5);
  assert.strictEqual(a[11], 'Alta');
  assert.strictEqual(filaDiag(b, 'PROD-REST-111')[12], 'ELIMINAR_DUPLICADO');

  const bb = filaDiag(b, 'PROD-B');
  assert.strictEqual(bb[4], 'PROD-B', 'el original renombrado es el principal');
  assert.strictEqual(bb[13], 6);
  assert.strictEqual(filaDiag(b, 'PROD-REST-222')[12], 'ELIMINAR_DUPLICADO');

  assert.strictEqual(filaDiag(b, 'TANQ-1-DUP')[12], 'ELIMINAR_RECEPCION_DUPLICADA');
  assert.strictEqual(filaDiag(b, 'PROD-C')[11], 'No verificable');
  assert.strictEqual(filaDiag(b, 'PROD-C')[12], '');
  assert.ok(diag(b).some(f => f[1] === 'RECIBIDO SIN PRODUCTO' && f[3] === 'Splash Viejo'));
  // Casillas solo en filas con acción, sin marcar
  diag(b).slice(1).forEach(f => assert.strictEqual(f[0], f[12] ? false : f[0]));
});

test('El diagnóstico (API reconcileInventory) no modifica el inventario', () => {
  const b = escenarioPamela();
  const antes = JSON.stringify(b.hojas.Inventario.data);
  const t = b.login();
  const r = b.post({ action: 'reconcileInventory', token: t, data: {} });
  assert.strictEqual(r.status, 'success');
  assert.ok(r.resumen.productos_duplicados === 2);
  assert.strictEqual(JSON.stringify(b.hojas.Inventario.data), antes);
});

test('Aplicar correcciones marcadas: respaldo previo, deja el inventario correcto y el diagnóstico limpio', () => {
  const b = escenarioPamela();
  b.ctx.diagnosticarInventario(true);
  diag(b).slice(1).forEach(f => { if (f[12]) f[0] = true; });
  const r = b.ctx.aplicarCorreccionesMarcadas();
  assert.strictEqual(r.status, 'success', r.message);
  assert.strictEqual(b.respaldos.length, 1);
  assert.strictEqual(stock(b, 'PROD-A'), 5);
  assert.strictEqual(stock(b, 'PROD-B'), 6);
  assert.strictEqual(fila(b, 'PROD-REST-111')[10], 'Eliminado');
  assert.strictEqual(fila(b, 'PROD-REST-222')[10], 'Eliminado');
  assert.strictEqual(fila(b, 'PROD-C')[4], 4, 'lo no verificable no se toca');
  assert.deepStrictEqual(b.filas('Recepciones').map(f => f[0]), ['TANQ-1']);
  const tipos = movs(b).map(m => m[4]);
  assert.ok(tipos.includes('CORRECCION') && tipos.includes('ELIMINACION'));
  verificarCuadreKardex(b);
  // Unidades totales: de 37 (12+7+6+8+4) a 15 (5+6+4)
  const total = b.filas('Inventario').filter(f => f[10] !== 'Eliminado').reduce((t, f) => t + Number(f[4]), 0);
  assert.strictEqual(total, 15);
  const r2 = b.ctx.diagnosticarInventario(false);
  assert.strictEqual(r2.resumen.productos_duplicados + r2.resumen.productos_con_exceso + r2.resumen.recepciones_duplicadas, 0, r2.message);
});

test('Solo se aplica lo marcado y se respeta el "Nuevo stock" editado a mano', () => {
  const b = escenarioPamela();
  b.ctx.diagnosticarInventario(true);
  const a = filaDiag(b, 'PROD-A');
  a[0] = true;
  a[13] = 8; // conteo físico de Pamela
  b.ctx.aplicarCorreccionesMarcadas();
  assert.strictEqual(stock(b, 'PROD-A'), 8);
  assert.strictEqual(fila(b, 'PROD-REST-111')[10], 'En Stock');
  assert.strictEqual(stock(b, 'PROD-B'), 6);
  assert.strictEqual(b.filas('Recepciones').length, 2);
});

test('Si el stock cambió desde el diagnóstico (venta posterior), esa fila se omite', () => {
  const b = escenarioPamela();
  b.ctx.diagnosticarInventario(true);
  filaDiag(b, 'PROD-A')[0] = true;
  const t = b.login();
  b.post({ action: 'registerSale', token: t, data: { id_articulo: 'PROD-A', cantidad: 1 } });
  const r = b.ctx.aplicarCorreccionesMarcadas();
  assert.strictEqual(r.aplicadas, 0);
  assert.strictEqual(stock(b, 'PROD-A'), 11);
  assert.ok(/cambió desde el diagnóstico/.test(r.message));
});

test('Sin filas marcadas no se cambia nada ni se crea respaldo', () => {
  const b = escenarioPamela();
  b.ctx.diagnosticarInventario(true);
  const r = b.ctx.aplicarCorreccionesMarcadas();
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(b.respaldos.length, 0);
});

test('Purga total limpia también AJUSTES, Movimientos y Diagnóstico', () => {
  const b = escenarioPamela(); const t = b.login();
  b.ctx.diagnosticarInventario(true);
  b.post({ action: 'adjustStock', token: t, data: { id: 'PROD-C', delta: 1 } });
  b.post({ action: 'resetAllData', token: t, data: { confirmacion: 'CONFIRMAR_PURGA_TOTAL_THOR' } });
  assert.strictEqual(b.filas('Inventario').length, 0);
  assert.strictEqual(b.filas('AJUSTES').length, 0);
  assert.ok(!b.hojas.Movimientos && !b.hojas['Diagnóstico Inventario']);
});

console.log(`\n${ok} pruebas superadas`);
