/**
 * =========================================================================
 * THOR ESSENCE — SISTEMA DE INVENTARIO Y VENTAS
 * Backend: Google Apps Script (Base de datos: Google Sheets)
 * Repositorio: https://github.com/jesusx26x/Sistema-PDLSC
 * =========================================================================
 * 
 * Este script actúa como API REST segura para conectar el Frontend en GitHub Pages
 * con la hoja de cálculo de Google Sheets.
 * 
 * Funcionalidades clave:
 * - Operaciones atómicas con LockService (evita duplicados o descuadre de stock)
 * - Autenticación mediante Token de seguridad (en Script Properties o parámetro)
 * - Auto-inicialización de hojas y cabeceras si no existen
 * - Registro de recepciones por Tanque/Lote con actualización automática de stock
 * - Registro de ventas con cálculo automático de costo y ganancia
 * - Menú personalizado en Google Sheets para el administrador
 * - Función de Respaldo Automático diario en Google Drive (Disparador programable)
 */

const SHEETS = {
  INVENTARIO: 'Inventario',
  VENTAS: 'Ventas',
  RECEPCIONES: 'Recepciones',
  CONFIGURACION: 'Configuracion'
};

const DEFAULT_SECURITY_TOKEN = 'THOR_SECURE_2026';

/**
 * =========================================================================
 * MENÚ ADMINISTRATIVO EN GOOGLE SHEETS (onOpen)
 * =========================================================================
 */
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('🌸 Thor Essence Admin')
      .addItem('🚀 Inicializar / Verificar Estructura', 'menuInicializar')
      .addItem('💾 Crear Copia de Respaldo en Drive', 'crearRespaldoEnDrive')
      .addItem('⏰ Configurar Respaldo Automático Diario', 'configurarDisparadorRespaldo')
      .addToUi();
  } catch (e) {
    console.log('No se pudo crear el menú en ejecución sin interfaz: ' + e);
  }
}

function menuInicializar() {
  inicializarHojasSiNoExisten(true);
  SpreadsheetApp.getUi().alert('✅ Estructura de Thor Essence verificada y lista para operar.');
}

/**
 * Crea una copia de respaldo automática en Google Drive
 */
function crearRespaldoEnDrive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombreCopia = 'Backup Thor Essence — ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Santo_Domingo', 'yyyy-MM-dd_HH-mm');
  const archivo = DriveApp.getFileById(ss.getId());
  
  // Buscar o crear carpeta de respaldos
  let carpetaBackup;
  const carpetas = DriveApp.getFoldersByName('Respaldos Thor Essence');
  if (carpetas.hasNext()) {
    carpetaBackup = carpetas.next();
  } else {
    carpetaBackup = DriveApp.createFolder('Respaldos Thor Essence');
  }

  const copia = archivo.makeCopy(nombreCopia, carpetaBackup);
  console.log('Respaldo creado exitosamente: ' + copia.getName());
  return copia.getUrl();
}

/**
 * Configura un disparador (trigger) por tiempo para ejecutar respaldos diarios
 */
function configurarDisparadorRespaldo() {
  // Eliminar disparadores previos de respaldo para no duplicar
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'crearRespaldoEnDrive') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Crear nuevo disparador diario a las 2:00 AM
  ScriptApp.newTrigger('crearRespaldoEnDrive')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();

  SpreadsheetApp.getUi().alert('⏰ Respaldo automático configurado: se creará una copia de seguridad en Google Drive todos los días a las 2:00 AM.');
}

/**
 * =========================================================================
 * ENDPOINTS API REST (doGet / doPost)
 * =========================================================================
 */

function doGet(e) {
  try {
    const params = e ? e.parameter : {};
    const action = params.action || 'ping';

    if (action === 'ping') {
      return jsonResponse({
        status: 'success',
        message: 'Backend Thor Essence activo y funcionando',
        timestamp: new Date().toISOString()
      });
    }

    if (!validarAcceso(params.token)) {
      return jsonResponse({ status: 'error', message: 'Acceso no autorizado: Token inválido' }, 401);
    }

    inicializarHojasSiNoExisten();

    if (action === 'getAllData') {
      return jsonResponse({
        status: 'success',
        data: obtenerTodosLosDatos()
      });
    }

    if (action === 'getInventory') {
      return jsonResponse({
        status: 'success',
        data: obtenerInventario()
      });
    }

    if (action === 'getSales') {
      return jsonResponse({
        status: 'success',
        data: obtenerVentas()
      });
    }

    if (action === 'getReceptions') {
      return jsonResponse({
        status: 'success',
        data: obtenerRecepciones()
      });
    }

    return jsonResponse({ status: 'error', message: 'Acción GET no reconocida' }, 400);

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() }, 500);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  const lockAcquired = lock.tryLock(30000);

  try {
    if (!lockAcquired) {
      return jsonResponse({ status: 'error', message: 'El servidor está ocupado procesando otra transacción. Reintenta en unos segundos.' }, 503);
    }

    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        payload = e.parameter || {};
      }
    } else {
      payload = e ? e.parameter : {};
    }

    if (!validarAcceso(payload.token)) {
      return jsonResponse({ status: 'error', message: 'Acceso no autorizado: Token inválido' }, 401);
    }

    inicializarHojasSiNoExisten();

    const action = payload.action;

    switch (action) {
      case 'saveProduct':
        return jsonResponse(guardarOActualizarProducto(payload.data));

      case 'deleteProduct':
        return jsonResponse(eliminarProducto(payload.id));

      case 'adjustStock':
        return jsonResponse(ajustarStockProducto(payload.id, payload.delta, payload.motivo));

      case 'registerSale':
        return jsonResponse(registrarVenta(payload.data));

      case 'cancelSale':
        return jsonResponse(cancelarVenta(payload.id_venta));

      case 'registerReception':
        return jsonResponse(registrarRecepcionTanque(payload.data));

      case 'saveConfig':
        return jsonResponse(guardarConfiguracion(payload.data));

      case 'initSetup':
        inicializarHojasSiNoExisten(true);
        return jsonResponse({ status: 'success', message: 'Estructura de hojas inicializada con éxito' });

      default:
        return jsonResponse({ status: 'error', message: 'Acción POST no reconocida: ' + action }, 400);
    }

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString(), stack: err.stack }, 500);
  } finally {
    lock.releaseLock();
  }
}

/**
 * =========================================================================
 * FUNCIONES DE NEGOCIO Y CONSULTAS
 * =========================================================================
 */

function obtenerTodosLosDatos() {
  return {
    inventario: obtenerInventario(),
    ventas: obtenerVentas(),
    recepciones: obtenerRecepciones(),
    configuracion: obtenerConfiguracion(),
    metricas: calcularMetricasGenerales()
  };
}

function obtenerInventario() {
  const sheet = getSheet(SHEETS.INVENTARIO);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;

    items.push({
      id: String(row[0]),
      nombre: String(row[1] || ''),
      categoria: String(row[2] || 'Variedades'),
      descripcion: String(row[3] || ''),
      cantidad: Number(row[4]) || 0,
      stock_minimo: Number(row[5]) || 3,
      costo_usd: Number(row[6]) || 0,
      costo_dop: Number(row[7]) || 0,
      precio_venta_dop: Number(row[8]) || 0,
      ubicacion: String(row[9] || ''),
      estado: String(row[10] || 'En Stock'),
      fecha_ingreso: row[11] ? formatearFecha(row[11]) : '',
      fecha_actualizacion: row[12] ? formatearFecha(row[12]) : ''
    });
  }
  return items;
}

function obtenerVentas() {
  const sheet = getSheet(SHEETS.VENTAS);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  const sales = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i];
    if (!row[0]) continue;

    sales.push({
      id_venta: String(row[0]),
      fecha_venta: row[1] ? formatearFecha(row[1]) : '',
      id_articulo: String(row[2] || ''),
      nombre_articulo: String(row[3] || ''),
      categoria: String(row[4] || ''),
      cantidad: Number(row[5]) || 0,
      precio_unitario_dop: Number(row[6]) || 0,
      total_dop: Number(row[7]) || 0,
      costo_unitario_dop: Number(row[8]) || 0,
      ganancia_dop: Number(row[9]) || 0,
      cliente: String(row[10] || 'Cliente General'),
      metodo_pago: String(row[11] || 'Efectivo'),
      notas: String(row[12] || ''),
      estado: String(row[13] || 'Completada')
    });
  }
  return sales;
}

function obtenerRecepciones() {
  const sheet = getSheet(SHEETS.RECEPCIONES);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  const receptions = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i];
    if (!row[0]) continue;

    let articulosDetalle = [];
    try {
      articulosDetalle = row[8] ? JSON.parse(row[8]) : [];
    } catch (e) {
      articulosDetalle = [];
    }

    receptions.push({
      id_recepcion: String(row[0]),
      fecha: row[1] ? formatearFecha(row[1]) : '',
      nombre_tanque: String(row[2] || ''),
      origen: String(row[3] || 'EE.UU.'),
      total_unidades: Number(row[4]) || 0,
      flete_usd: Number(row[5]) || 0,
      tasa_cambio: Number(row[6]) || 60.50,
      notas: String(row[7] || ''),
      articulos: articulosDetalle
    });
  }
  return receptions;
}

function guardarOActualizarProducto(p) {
  if (!p || !p.nombre) {
    return { status: 'error', message: 'El nombre del producto es obligatorio' };
  }

  const sheet = getSheet(SHEETS.INVENTARIO);
  const rows = sheet.getDataRange().getValues();
  const now = new Date();

  const id = p.id || ('PROD-' + Utilities.getUuid().substring(0, 8).toUpperCase());
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      rowIndex = i + 1;
      break;
    }
  }

  const cant = Number(p.cantidad) || 0;
  const fila = [
    id,
    p.nombre,
    p.categoria || 'Variedades',
    p.descripcion || '',
    cant,
    Number(p.stock_minimo) || 3,
    Number(p.costo_usd) || 0,
    Number(p.costo_dop) || 0,
    Number(p.precio_venta_dop) || 0,
    p.ubicacion || 'Almacén Principal',
    p.estado || (cant > 0 ? 'En Stock' : 'Agotado'),
    p.fecha_ingreso ? new Date(p.fecha_ingreso) : now,
    now
  ];

  if (rowIndex > 0) {
    fila[11] = rows[rowIndex - 1][11] || now;
    sheet.getRange(rowIndex, 1, 1, fila.length).setValues([fila]);
  } else {
    sheet.appendRow(fila);
  }

  return {
    status: 'success',
    message: rowIndex > 0 ? 'Producto actualizado correctamente' : 'Producto creado con éxito',
    id: id
  };
}

function ajustarStockProducto(id, delta, motivo) {
  const sheet = getSheet(SHEETS.INVENTARIO);
  const rows = sheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    return { status: 'error', message: 'Producto no encontrado' };
  }

  const stockActual = Number(rows[rowIndex - 1][4]) || 0;
  const nuevoStock = Math.max(0, stockActual + Number(delta));
  const nuevoEstado = nuevoStock > 0 ? 'En Stock' : 'Agotado';

  sheet.getRange(rowIndex, 5).setValue(nuevoStock);
  sheet.getRange(rowIndex, 11).setValue(nuevoEstado);
  sheet.getRange(rowIndex, 13).setValue(new Date());

  return {
    status: 'success',
    message: 'Stock actualizado a ' + nuevoStock + ' unidades',
    nuevoStock: nuevoStock
  };
}

function eliminarProducto(id) {
  const sheet = getSheet(SHEETS.INVENTARIO);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { status: 'success', message: 'Producto eliminado correctamente' };
    }
  }

  return { status: 'error', message: 'Producto no encontrado' };
}

function registrarVenta(venta) {
  if (!venta || !venta.id_articulo || !venta.cantidad || venta.cantidad <= 0) {
    return { status: 'error', message: 'Datos de venta incompletos o cantidad inválida' };
  }

  const invSheet = getSheet(SHEETS.INVENTARIO);
  const invRows = invSheet.getDataRange().getValues();
  let productRow = -1;
  let producto = null;

  for (let i = 1; i < invRows.length; i++) {
    if (String(invRows[i][0]) === String(venta.id_articulo)) {
      productRow = i + 1;
      producto = {
        id: invRows[i][0],
        nombre: invRows[i][1],
        categoria: invRows[i][2],
        stock: Number(invRows[i][4]) || 0,
        costo_dop: Number(invRows[i][7]) || 0,
        precio_sugerido: Number(invRows[i][8]) || 0
      };
      break;
    }
  }

  if (!producto) {
    return { status: 'error', message: 'El producto a vender no existe en el inventario' };
  }

  const cantVenta = Number(venta.cantidad);
  if (producto.stock < cantVenta) {
    return {
      status: 'error',
      message: 'Stock insuficiente. Solo quedan ' + producto.stock + ' unidades disponibles de "' + producto.nombre + '".'
    };
  }

  const nuevoStock = producto.stock - cantVenta;
  const nuevoEstado = nuevoStock > 0 ? 'En Stock' : 'Agotado';
  invSheet.getRange(productRow, 5).setValue(nuevoStock);
  invSheet.getRange(productRow, 11).setValue(nuevoEstado);
  invSheet.getRange(productRow, 13).setValue(new Date());

  const salesSheet = getSheet(SHEETS.VENTAS);
  const idVenta = 'VTA-' + Utilities.getUuid().substring(0, 8).toUpperCase();
  const precioUnitario = Number(venta.precio_unitario_dop) || producto.precio_sugerido;
  const totalVenta = precioUnitario * cantVenta;
  const costoTotal = (producto.costo_dop || 0) * cantVenta;
  const ganancia = totalVenta - costoTotal;
  const fechaVenta = venta.fecha ? new Date(venta.fecha) : new Date();

  const filaVenta = [
    idVenta,
    fechaVenta,
    producto.id,
    producto.nombre,
    producto.categoria,
    cantVenta,
    precioUnitario,
    totalVenta,
    producto.costo_dop,
    ganancia,
    venta.cliente || 'Cliente General',
    venta.metodo_pago || 'Efectivo',
    venta.notas || '',
    'Completada'
  ];

  salesSheet.appendRow(filaVenta);

  return {
    status: 'success',
    message: 'Venta registrada con éxito. Stock restante: ' + nuevoStock,
    id_venta: idVenta,
    stock_restante: nuevoStock,
    total_dop: totalVenta,
    ganancia_dop: ganancia
  };
}

function cancelarVenta(idVenta) {
  const salesSheet = getSheet(SHEETS.VENTAS);
  const salesRows = salesSheet.getDataRange().getValues();
  let saleRow = -1;
  let venta = null;

  for (let i = 1; i < salesRows.length; i++) {
    if (String(salesRows[i][0]) === String(idVenta)) {
      saleRow = i + 1;
      venta = {
        id_articulo: salesRows[i][2],
        cantidad: Number(salesRows[i][5]) || 0,
        estado: salesRows[i][13]
      };
      break;
    }
  }

  if (!venta) {
    return { status: 'error', message: 'Venta no encontrada' };
  }

  if (venta.estado === 'Cancelada') {
    return { status: 'error', message: 'Esta venta ya se encuentra cancelada' };
  }

  ajustarStockProducto(venta.id_articulo, venta.cantidad, 'Devolución por cancelación de venta ' + idVenta);
  salesSheet.getRange(saleRow, 14).setValue('Cancelada');

  return {
    status: 'success',
    message: 'Venta cancelada y ' + venta.cantidad + ' unidades devueltas al inventario'
  };
}

function registrarRecepcionTanque(data) {
  if (!data || !data.nombre_tanque) {
    return { status: 'error', message: 'El nombre o descripción del tanque es obligatorio' };
  }

  const items = data.articulos || [];
  if (items.length === 0) {
    return { status: 'error', message: 'Debe incluir al menos un artículo en el tanque recibido' };
  }

  const invSheet = getSheet(SHEETS.INVENTARIO);
  const invRows = invSheet.getDataRange().getValues();
  const now = new Date();
  const tasa = Number(data.tasa_cambio) || 60.50;

  let totalUnidades = 0;
  const articulosProcesados = [];

  const mapaPorId = {};
  const mapaPorNombre = {};
  for (let i = 1; i < invRows.length; i++) {
    const rowId = String(invRows[i][0]);
    const rowName = String(invRows[i][1]).trim().toLowerCase();
    mapaPorId[rowId] = i + 1;
    mapaPorNombre[rowName] = i + 1;
  }

  for (let k = 0; k < items.length; k++) {
    const item = items[k];
    const cant = Number(item.cantidad) || 0;
    if (cant <= 0) continue;

    totalUnidades += cant;

    const costoUsd = Number(item.costo_usd) || 0;
    const costoDop = Number(item.costo_dop) || (costoUsd * tasa);
    const precioVentaDop = Number(item.precio_venta_dop) || (costoDop * 1.5);

    let targetRow = -1;
    let itemId = item.id;

    if (itemId && mapaPorId[itemId]) {
      targetRow = mapaPorId[itemId];
    } else if (item.nombre && mapaPorNombre[item.nombre.trim().toLowerCase()]) {
      targetRow = mapaPorNombre[item.nombre.trim().toLowerCase()];
      itemId = invRows[targetRow - 1][0];
    }

    if (targetRow > 0) {
      const stockAnterior = Number(invRows[targetRow - 1][4]) || 0;
      const nuevoStock = stockAnterior + cant;

      invSheet.getRange(targetRow, 5).setValue(nuevoStock);
      if (costoUsd > 0) invSheet.getRange(targetRow, 7).setValue(costoUsd);
      if (costoDop > 0) invSheet.getRange(targetRow, 8).setValue(costoDop);
      if (precioVentaDop > 0) invSheet.getRange(targetRow, 9).setValue(precioVentaDop);
      invSheet.getRange(targetRow, 10).setValue(data.nombre_tanque);
      invSheet.getRange(targetRow, 11).setValue('En Stock');
      invSheet.getRange(targetRow, 13).setValue(now);

      articulosProcesados.push({
        id: itemId,
        nombre: invRows[targetRow - 1][1],
        cantidad: cant,
        nuevo_stock: nuevoStock,
        costo_usd: costoUsd,
        costo_dop: costoDop,
        precio_venta_dop: precioVentaDop
      });
    } else {
      const newId = 'PROD-' + Utilities.getUuid().substring(0, 8).toUpperCase();
      const filaNueva = [
        newId,
        item.nombre,
        item.categoria || 'Variedades',
        item.descripcion || '',
        cant,
        Number(item.stock_minimo) || 3,
        costoUsd,
        costoDop,
        precioVentaDop,
        data.nombre_tanque,
        'En Stock',
        now,
        now
      ];
      invSheet.appendRow(filaNueva);

      articulosProcesados.push({
        id: newId,
        nombre: item.nombre,
        cantidad: cant,
        nuevo_stock: cant,
        costo_usd: costoUsd,
        costo_dop: costoDop,
        precio_venta_dop: precioVentaDop
      });
    }
  }

  const recSheet = getSheet(SHEETS.RECEPCIONES);
  const idRecepcion = 'TANQ-' + Utilities.getUuid().substring(0, 8).toUpperCase();
  const filaRecepcion = [
    idRecepcion,
    data.fecha ? new Date(data.fecha) : now,
    data.nombre_tanque,
    data.origen || 'EE.UU.',
    totalUnidades,
    Number(data.flete_usd) || 0,
    tasa,
    data.notas || '',
    JSON.stringify(articulosProcesados)
  ];

  recSheet.appendRow(filaRecepcion);

  return {
    status: 'success',
    message: 'Tanque registrado con éxito: ' + totalUnidades + ' artículos ingresados al inventario.',
    id_recepcion: idRecepcion,
    total_unidades: totalUnidades,
    articulos: articulosProcesados
  };
}

function calcularMetricasGenerales() {
  const inv = obtenerInventario();
  const ventas = obtenerVentas();

  let totalArticulos = 0;
  let totalStockUnidades = 0;
  let valorInventarioCostoDop = 0;
  let valorInventarioVentaDop = 0;
  let productosStockBajo = 0;
  let productosAgotados = 0;

  inv.forEach(function(item) {
    totalArticulos++;
    totalStockUnidades += item.cantidad;
    valorInventarioCostoDop += (item.cantidad * item.costo_dop);
    valorInventarioVentaDop += (item.cantidad * item.precio_venta_dop);

    if (item.cantidad === 0) {
      productosAgotados++;
    } else if (item.cantidad <= item.stock_minimo) {
      productosStockBajo++;
    }
  });

  const hoyStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Santo_Domingo', 'yyyy-MM-dd');
  let ventasHoyDop = 0;
  let gananciaHoyDop = 0;
  let ventasMesDop = 0;
  let gananciaMesDop = 0;
  const mesActual = hoyStr.substring(0, 7);

  ventas.forEach(function(v) {
    if (v.estado === 'Cancelada') return;
    const vFechaStr = String(v.fecha_venta).substring(0, 10);
    if (vFechaStr === hoyStr) {
      ventasHoyDop += v.total_dop;
      gananciaHoyDop += v.ganancia_dop;
    }
    if (vFechaStr.startsWith(mesActual)) {
      ventasMesDop += v.total_dop;
      gananciaMesDop += v.ganancia_dop;
    }
  });

  return {
    total_productos: totalArticulos,
    total_unidades_stock: totalStockUnidades,
    valor_inventario_costo_dop: Math.round(valorInventarioCostoDop),
    valor_inventario_venta_dop: Math.round(valorInventarioVentaDop),
    productos_stock_bajo: productosStockBajo,
    productos_agotados: productosAgotados,
    ventas_hoy_dop: Math.round(ventasHoyDop),
    ganancia_hoy_dop: Math.round(gananciaHoyDop),
    ventas_mes_dop: Math.round(ventasMesDop),
    ganancia_mes_dop: Math.round(gananciaMesDop)
  };
}

function validarAcceso(tokenEnviado) {
  if (!tokenEnviado) return false;
  const scriptProps = PropertiesService.getScriptProperties();
  const tokenGuardado = scriptProps.getProperty('SECURITY_TOKEN');

  if (tokenGuardado) {
    return tokenEnviado === tokenGuardado;
  }

  try {
    const config = obtenerConfiguracion();
    if (config && config.SECURITY_TOKEN) {
      return tokenEnviado === config.SECURITY_TOKEN;
    }
  } catch (e) {}

  return tokenEnviado === DEFAULT_SECURITY_TOKEN;
}

function obtenerConfiguracion() {
  const sheet = getSheet(SHEETS.CONFIGURACION);
  const rows = sheet.getDataRange().getValues();
  const cfg = {
    NOMBRE_NEGOCIO: 'Thor Essence',
    MONEDA_PRINCIPAL: 'DOP',
    TASA_CAMBIO_USD_DOP: 60.50,
    CATEGORIAS: 'Perfumes, Splash, Cremas, Body Wash, Accesorios, Maquillaje, Variedades',
    SECURITY_TOKEN: DEFAULT_SECURITY_TOKEN
  };

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      cfg[String(rows[i][0])] = rows[i][1];
    }
  }
  return cfg;
}

function guardarConfiguracion(nuevaCfg) {
  const sheet = getSheet(SHEETS.CONFIGURACION);
  const rows = sheet.getDataRange().getValues();
  const mapa = {};

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      mapa[String(rows[i][0])] = i + 1;
    }
  }

  for (let key in nuevaCfg) {
    if (mapa[key]) {
      sheet.getRange(mapa[key], 2).setValue(nuevaCfg[key]);
    } else {
      sheet.appendRow([key, nuevaCfg[key]]);
    }

    if (key === 'SECURITY_TOKEN') {
      PropertiesService.getScriptProperties().setProperty('SECURITY_TOKEN', String(nuevaCfg[key]));
    }
  }

  return { status: 'success', message: 'Configuración guardada correctamente' };
}

function inicializarHojasSiNoExisten(forzar) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let invSheet = ss.getSheetByName(SHEETS.INVENTARIO);
  if (!invSheet || forzar) {
    if (!invSheet) invSheet = ss.insertSheet(SHEETS.INVENTARIO);
    const cabecerasInv = [
      ['ID', 'Nombre del Producto', 'Categoría', 'Descripción', 'Cantidad', 'Stock Mínimo', 'Costo USD', 'Costo DOP', 'Precio Venta DOP', 'Ubicación / Tanque', 'Estado', 'Fecha Ingreso', 'Fecha Actualización']
    ];
    invSheet.getRange(1, 1, 1, cabecerasInv[0].length).setValues(cabecerasInv);
    estilarCabecera(invSheet, cabecerasInv[0].length, '#0B132B', '#D4AF37');
    invSheet.setFrozenRows(1);

    if (invSheet.getLastRow() === 1) {
      const ejemplos = [
        ['PROD-001', 'Perfume Thor Gold Luxury 100ml', 'Perfumes', 'Fragancia premium importada', 14, 4, 15.00, 907.50, 1950, 'Tanque #1 Miami', 'En Stock', new Date(), new Date()],
        ['PROD-002', 'Splash Vainilla & Rose 250ml', 'Splash', 'Aroma dulce y floral', 26, 6, 4.20, 254.10, 650, 'Tanque #1 Miami', 'En Stock', new Date(), new Date()],
        ['PROD-003', 'Crema Hidratante Karité 200ml', 'Cremas', 'Nutrición profunda para la piel', 19, 5, 5.50, 332.75, 750, 'Tanque #1 Miami', 'En Stock', new Date(), new Date()],
        ['PROD-004', 'Body Wash Coco & Miel 300ml', 'Body Wash', 'Gel de ducha relajante', 2, 4, 4.80, 290.40, 700, 'Tanque #1 Miami', 'Stock Bajo', new Date(), new Date()]
      ];
      invSheet.getRange(2, 1, ejemplos.length, ejemplos[0].length).setValues(ejemplos);
    }
  }

  let venSheet = ss.getSheetByName(SHEETS.VENTAS);
  if (!venSheet || forzar) {
    if (!venSheet) venSheet = ss.insertSheet(SHEETS.VENTAS);
    const cabecerasVen = [
      ['ID Venta', 'Fecha y Hora', 'ID Artículo', 'Nombre Artículo', 'Categoría', 'Cantidad', 'Precio Unitario DOP', 'Total Venta DOP', 'Costo Unitario DOP', 'Ganancia Neta DOP', 'Cliente', 'Método Pago', 'Notas', 'Estado']
    ];
    venSheet.getRange(1, 1, 1, cabecerasVen[0].length).setValues(cabecerasVen);
    estilarCabecera(venSheet, cabecerasVen[0].length, '#0B132B', '#D4AF37');
    venSheet.setFrozenRows(1);
  }

  let recSheet = ss.getSheetByName(SHEETS.RECEPCIONES);
  if (!recSheet || forzar) {
    if (!recSheet) recSheet = ss.insertSheet(SHEETS.RECEPCIONES);
    const cabecerasRec = [
      ['ID Recepción', 'Fecha', 'Nombre Tanque / Lote', 'Origen', 'Total Unidades', 'Flete USD', 'Tasa Cambio USD-DOP', 'Notas', 'Detalle Artículos (JSON)']
    ];
    recSheet.getRange(1, 1, 1, cabecerasRec[0].length).setValues(cabecerasRec);
    estilarCabecera(recSheet, cabecerasRec[0].length, '#0B132B', '#D4AF37');
    recSheet.setFrozenRows(1);
  }

  let cfgSheet = ss.getSheetByName(SHEETS.CONFIGURACION);
  if (!cfgSheet || forzar) {
    if (!cfgSheet) cfgSheet = ss.insertSheet(SHEETS.CONFIGURACION);
    const cabecerasCfg = [['Clave', 'Valor']];
    cfgSheet.getRange(1, 1, 1, 2).setValues(cabecerasCfg);
    estilarCabecera(cfgSheet, 2, '#0B132B', '#D4AF37');

    const defaultValues = [
      ['NOMBRE_NEGOCIO', 'Thor Essence'],
      ['SLOGAN', 'Belleza, aroma y estilo en un solo lugar'],
      ['MONEDA_PRINCIPAL', 'DOP'],
      ['TASA_CAMBIO_USD_DOP', 60.50],
      ['CATEGORIAS', 'Perfumes, Splash, Cremas, Body Wash, Accesorios, Maquillaje, Variedades'],
      ['SECURITY_TOKEN', DEFAULT_SECURITY_TOKEN]
    ];
    cfgSheet.getRange(2, 1, defaultValues.length, 2).setValues(defaultValues);
  }

  PropertiesService.getScriptProperties().setProperty('SECURITY_TOKEN', DEFAULT_SECURITY_TOKEN);
}

function estilarCabecera(sheet, numCols, bgColor, textColor) {
  const headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setBackground(bgColor);
  headerRange.setFontColor(textColor);
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(10);
  headerRange.setHorizontalAlignment('center');
}

function getSheet(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(nombre);
  if (!sheet) {
    inicializarHojasSiNoExisten();
    sheet = ss.getSheetByName(nombre);
  }
  return sheet;
}

function formatearFecha(dateObj) {
  try {
    return Utilities.formatDate(new Date(dateObj), Session.getScriptTimeZone() || 'America/Santo_Domingo', 'yyyy-MM-dd HH:mm:ss');
  } catch (e) {
    return String(dateObj);
  }
}

function jsonResponse(data, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
