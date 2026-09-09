/**
 * =========================================================================
 * THOR ESSENCE — SISTEMA DE INVENTARIO Y VENTAS
 * Backend: Google Apps Script (Base de datos: Google Sheets)
 * Repositorio: https://github.com/jesusx26x/Sistema-PDLSC
 * =========================================================================
 * 
 * Este script actúa como API REST protegida para conectar el Frontend en GitHub Pages
 * con la hoja de cálculo de Google Sheets bajo arquitectura de seguridad RLS.
 * 
 * Medidas de Seguridad Implementadas:
 * 1. Clave de Servicio protegida: Ninguna clave maestra está expuesta en el navegador.
 * 2. RLS (Row Level Security): Todas las consultas de lectura y mutación de la base de datos
 *    requieren un token de sesión activo y validado en el servidor.
 * 3. Signout en el Servidor: Al cerrar sesión se destruye el token en CacheService y
 *    PropertiesService, impidiendo que la sesión continúe abierta en el servidor.
 * 4. Operaciones atómicas con LockService para evitar condiciones de carrera.
 * 5. Disparador programable para Respaldo Automático diario en Google Drive (2:00 AM).
 */

const SHEETS = {
  INVENTARIO: 'Inventario',
  VENTAS: 'Ventas',
  RECEPCIONES: 'Recepciones',
  CONFIGURACION: 'Configuracion'
};

// Credenciales oficiales predeterminadas para Pamela
const CREDENCIALES_SISTEMA = {
  usuario: 'Pameladlsantos',
  contrasena: 'Thorayka2419'
};

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
      .addSeparator()
      .addItem('🔑 Sincronizar Credenciales de Pamela', 'menuRestablecerCredenciales')
      .addToUi();
  } catch (e) {
    console.log('No se pudo crear el menú en ejecución sin interfaz: ' + e);
  }
}

function menuInicializar() {
  inicializarHojasSiNoExisten(true);
  SpreadsheetApp.getUi().alert('✅ Estructura de Thor Essence verificada y lista para operar con RLS activo.');
}

function menuRestablecerCredenciales() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('AUTH_USER', CREDENCIALES_SISTEMA.usuario);
  props.setProperty('AUTH_PASS', CREDENCIALES_SISTEMA.contrasena);
  SpreadsheetApp.getUi().alert('✅ Credenciales de acceso sincronizadas con el servidor:\n\nUsuario: ' + CREDENCIALES_SISTEMA.usuario + '\nContraseña: ' + CREDENCIALES_SISTEMA.contrasena);
}

/**
 * Crea una copia de respaldo automática en Google Drive
 */
function crearRespaldoEnDrive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombreCopia = 'Backup Thor Essence — ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Santo_Domingo', 'yyyy-MM-dd_HH-mm');
  const archivo = DriveApp.getFileById(ss.getId());
  
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
 * Configura un disparador (trigger) por tiempo para ejecutar respaldos diarios a las 2:00 AM
 */
function configurarDisparadorRespaldo() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'crearRespaldoEnDrive') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('crearRespaldoEnDrive')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();

  try {
    SpreadsheetApp.getUi().alert('⏰ Respaldo automático configurado con éxito:\nSe creará una copia de seguridad en Google Drive todos los días entre 2:00 AM y 3:00 AM.');
  } catch (e) {
    console.log('Disparador creado por script.');
  }
}

/**
 * =========================================================================
 * AUTENTICACIÓN, GESTIÓN DE SESIONES & SEGURIDAD RLS
 * =========================================================================
 */

function verificarCredenciales(user, pass) {
  if (!user || !pass) return false;
  const props = PropertiesService.getScriptProperties();
  const usuarioConfigurado = props.getProperty('AUTH_USER') || CREDENCIALES_SISTEMA.usuario;
  const claveConfigurada = props.getProperty('AUTH_PASS') || CREDENCIALES_SISTEMA.contrasena;

  return (user.trim() === usuarioConfigurado.trim() && pass === claveConfigurada);
}

function crearSesionEnServidor(username) {
  const token = 'THOR_SES_' + Utilities.getUuid().replace(/-/g, '') + '_' + Date.now();
  const duracionMs = 24 * 60 * 60 * 1000; // 24 horas de validez
  const sessionData = {
    username: username,
    creadoEn: Date.now(),
    expiraEn: Date.now() + duracionMs
  };
  
  // Guardar en CacheService para respuestas ultra rápidas
  try {
    const cache = CacheService.getScriptCache();
    cache.put(token, JSON.stringify(sessionData), 21600); // 6 horas
  } catch (e) {
    console.warn('CacheService warning:', e);
  }
  
  // Persistir en PropertiesService para que dure 24 horas
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('SESSION_' + token, JSON.stringify(sessionData));
  } catch (e) {
    console.error('PropertiesService error:', e);
  }
  
  return token;
}

function invalidarSesionEnServidor(token) {
  if (!token) return true;
  token = String(token).trim();

  try {
    const cache = CacheService.getScriptCache();
    cache.remove(token);
  } catch (e) {}

  try {
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('SESSION_' + token);
  } catch (e) {}

  return true;
}

/**
 * RLS (Row Level Security):
 * Valida que la solicitud provenga de una sesión activa autenticada.
 * Evita cualquier lectura anónima o no autorizada de la base de datos.
 */
function validarSesionRLS(token) {
  if (!token || typeof token !== 'string') return false;
  token = token.trim();

  // 1. Validar en CacheService
  try {
    const cache = CacheService.getScriptCache();
    const cachedStr = cache.get(token);
    if (cachedStr) {
      const data = JSON.parse(cachedStr);
      if (data && data.expiraEn > Date.now()) {
        return true;
      }
    }
  } catch (e) {}

  // 2. Validar en ScriptProperties (persistencia en servidor)
  try {
    const props = PropertiesService.getScriptProperties();
    const propStr = props.getProperty('SESSION_' + token);
    if (propStr) {
      const data = JSON.parse(propStr);
      if (data && data.expiraEn > Date.now()) {
        try {
          CacheService.getScriptCache().put(token, propStr, 21600);
        } catch (ce) {}
        return true;
      } else {
        props.deleteProperty('SESSION_' + token);
      }
    }
  } catch (e) {}

  // 3. Clave maestra interna de servicio (exclusiva del backend para tareas de mantenimiento)
  try {
    const masterKey = PropertiesService.getScriptProperties().getProperty('MASTER_SERVICE_KEY');
    if (masterKey && token === masterKey) {
      return true;
    }
  } catch (e) {}

  return false;
}

/**
 * Alias retrocompatible para funciones internas
 */
function validarAcceso(token) {
  return validarSesionRLS(token);
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

    // Endpoint público de verificación de estado (no entrega datos de la BD)
    if (action === 'ping') {
      return jsonResponse({
        status: 'success',
        message: 'Backend Thor Essence activo y funcionando',
        rls: 'Activo (Acceso Restringido)',
        timestamp: new Date().toISOString()
      });
    }

    // =========================================================================
    // SEGURIDAD RLS EN LECTURA:
    // Nadie puede leer inventario, ventas ni reportes sin una sesión activa
    // =========================================================================
    if (!validarSesionRLS(params.token)) {
      return jsonResponse({
        status: 'error',
        code: 'UNAUTHORIZED_RLS',
        message: 'Acceso denegado por RLS: Sesión no válida o expirada. Debe iniciar sesión.'
      }, 401);
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

    const action = payload.action;

    // =========================================================================
    // 1. ENDPOINT PÚBLICO: INICIO DE SESIÓN (LOGIN)
    // Valida credenciales en el servidor y genera token temporal de sesión
    // =========================================================================
    if (action === 'login') {
      const username = (payload.username || (payload.data && payload.data.username) || '').trim();
      const password = (payload.password || (payload.data && payload.data.password) || '').trim();

      if (verificarCredenciales(username, password)) {
        const token = crearSesionEnServidor(username);
        return jsonResponse({
          status: 'success',
          message: 'Inicio de sesión exitoso',
          token: token,
          user: {
            username: username,
            nombre: 'Pamela De Los Santos',
            rol: 'Administradora'
          }
        });
      } else {
        return jsonResponse({
          status: 'error',
          code: 'INVALID_CREDENTIALS',
          message: 'Usuario o contraseña incorrectos. Verifique sus credenciales.'
        }, 401);
      }
    }

    // =========================================================================
    // 2. ENDPOINT DE CIERRE DE SESIÓN EN SERVIDOR (SIGNOUT)
    // Invalida inmediatamente el token en CacheService y PropertiesService
    // =========================================================================
    if (action === 'logout') {
      const token = payload.token || (payload.data && payload.data.token);
      invalidarSesionEnServidor(token);
      return jsonResponse({
        status: 'success',
        message: 'Sesión invalidada y destruida exitosamente en el servidor.'
      });
    }

    // =========================================================================
    // 3. SEGURIDAD RLS EN ESCRITURA Y ACCIONES:
    // Requiere sesión válida para cualquier modificación de la base de datos
    // =========================================================================
    if (!validarSesionRLS(payload.token)) {
      return jsonResponse({
        status: 'error',
        code: 'UNAUTHORIZED_RLS',
        message: 'Acceso denegado por RLS: Sesión no autorizada, inválida o expirada.'
      }, 401);
    }

    inicializarHojasSiNoExisten();

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

function guardarOActualizarProducto(prod) {
  if (!prod || !prod.nombre) {
    return { status: 'error', message: 'El producto debe tener al menos un nombre' };
  }

  const sheet = getSheet(SHEETS.INVENTARIO);
  const data = sheet.getDataRange().getValues();
  const ahora = new Date();

  const id = prod.id || ('PROD-' + Utilities.formatDate(ahora, 'GMT', 'yyyyMMddHHmmss'));
  const nombre = String(prod.nombre).trim();
  const categoria = String(prod.categoria || 'Variedades').trim();
  const descripcion = String(prod.descripcion || '').trim();
  const cantidad = parseInt(prod.cantidad) || 0;
  const stockMinimo = parseInt(prod.stock_minimo) || 3;
  const costoUsd = parseFloat(prod.costo_usd) || 0;
  const costoDop = parseFloat(prod.costo_dop) || (costoUsd * 60.50);
  const precioVentaDop = parseFloat(prod.precio_venta_dop) || 0;
  const ubicacion = String(prod.ubicacion || 'Almacén Principal').trim();
  const estado = cantidad === 0 ? 'Agotado' : (cantidad <= stockMinimo ? 'Stock Bajo' : 'En Stock');

  let filaEncontrada = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      filaEncontrada = i + 1;
      break;
    }
  }

  if (filaEncontrada > 0) {
    const fechaIngresoOriginal = data[filaEncontrada - 1][11] || ahora;
    sheet.getRange(filaEncontrada, 1, 1, 13).setValues([[
      id, nombre, categoria, descripcion, cantidad, stockMinimo,
      costoUsd, costoDop, precioVentaDop, ubicacion, estado,
      fechaIngresoOriginal, ahora
    ]]);
    return { status: 'success', message: 'Producto actualizado exitosamente', id: id };
  } else {
    sheet.appendRow([
      id, nombre, categoria, descripcion, cantidad, stockMinimo,
      costoUsd, costoDop, precioVentaDop, ubicacion, estado,
      ahora, ahora
    ]);
    return { status: 'success', message: 'Producto registrado exitosamente', id: id };
  }
}

function eliminarProducto(id) {
  if (!id) return { status: 'error', message: 'ID de producto requerido' };
  const sheet = getSheet(SHEETS.INVENTARIO);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { status: 'success', message: 'Producto eliminado del inventario' };
    }
  }
  return { status: 'error', message: 'Producto no encontrado' };
}

function ajustarStockProducto(id, delta, motivo) {
  if (!id) return { status: 'error', message: 'ID de producto requerido' };
  const sheet = getSheet(SHEETS.INVENTARIO);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      let actual = parseInt(data[i][4]) || 0;
      let nuevo = Math.max(0, actual + parseInt(delta));
      let stockMin = parseInt(data[i][5]) || 3;
      let nuevoEstado = nuevo === 0 ? 'Agotado' : (nuevo <= stockMin ? 'Stock Bajo' : 'En Stock');

      sheet.getRange(i + 1, 5).setValue(nuevo);
      sheet.getRange(i + 1, 11).setValue(nuevoEstado);
      sheet.getRange(i + 1, 13).setValue(new Date());

      return {
        status: 'success',
        message: 'Stock ajustado de ' + actual + ' a ' + nuevo,
        id: id,
        nuevoStock: nuevo
      };
    }
  }
  return { status: 'error', message: 'Producto no encontrado para ajuste' };
}

function registrarVenta(venta) {
  if (!venta || !venta.id_articulo || !venta.cantidad) {
    return { status: 'error', message: 'Datos de venta incompletos' };
  }

  const invSheet = getSheet(SHEETS.INVENTARIO);
  const invData = invSheet.getDataRange().getValues();
  let producto = null;
  let filaProd = -1;

  for (let i = 1; i < invData.length; i++) {
    if (String(invData[i][0]) === String(venta.id_articulo)) {
      producto = invData[i];
      filaProd = i + 1;
      break;
    }
  }

  if (!producto) {
    return { status: 'error', message: 'El producto vendido no existe en el inventario' };
  }

  const cantidadVenta = parseInt(venta.cantidad);
  const stockActual = parseInt(producto[4]) || 0;

  if (stockActual < cantidadVenta) {
    return {
      status: 'error',
      message: 'Stock insuficiente para esta venta. Stock actual: ' + stockActual + ', solicitado: ' + cantidadVenta
    };
  }

  const ahora = new Date();
  const idVenta = venta.id_venta || ('VTA-' + Utilities.formatDate(ahora, 'GMT', 'yyyyMMddHHmmss'));
  const precioUnitarioDop = parseFloat(venta.precio_unitario_dop) || parseFloat(producto[8]) || 0;
  const totalVentaDop = precioUnitarioDop * cantidadVenta;
  const costoUnitarioDop = parseFloat(producto[7]) || 0;
  const gananciaNetaDop = totalVentaDop - (costoUnitarioDop * cantidadVenta);

  // Actualizar inventario
  const nuevoStock = stockActual - cantidadVenta;
  const stockMin = parseInt(producto[5]) || 3;
  const nuevoEstado = nuevoStock === 0 ? 'Agotado' : (nuevoStock <= stockMin ? 'Stock Bajo' : 'En Stock');

  invSheet.getRange(filaProd, 5).setValue(nuevoStock);
  invSheet.getRange(filaProd, 11).setValue(nuevoEstado);
  invSheet.getRange(filaProd, 13).setValue(ahora);

  // Registrar en hoja Ventas
  const venSheet = getSheet(SHEETS.VENTAS);
  venSheet.appendRow([
    idVenta,
    ahora,
    producto[0],
    producto[1],
    producto[2],
    cantidadVenta,
    precioUnitarioDop,
    totalVentaDop,
    costoUnitarioDop,
    gananciaNetaDop,
    String(venta.cliente || 'Consumidor Final').trim(),
    String(venta.metodo_pago || 'Efectivo').trim(),
    String(venta.notas || '').trim(),
    'Completada'
  ]);

  return {
    status: 'success',
    message: 'Venta registrada con éxito. Ganancia neta: RD$ ' + gananciaNetaDop.toFixed(2),
    id_venta: idVenta,
    nuevoStock: nuevoStock
  };
}

function cancelarVenta(idVenta) {
  if (!idVenta) return { status: 'error', message: 'ID de venta requerido' };

  const venSheet = getSheet(SHEETS.VENTAS);
  const data = venSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(idVenta)) {
      if (data[i][13] === 'Cancelada') {
        return { status: 'error', message: 'Esta venta ya se encuentra cancelada' };
      }

      const idProd = String(data[i][2]);
      const cantRestituir = parseInt(data[i][5]) || 0;

      // Restituir stock en inventario
      ajustarStockProducto(idProd, cantRestituir, 'Cancelación de venta ' + idVenta);

      // Marcar estado cancelada
      venSheet.getRange(i + 1, 14).setValue('Cancelada');

      return { status: 'success', message: 'Venta ' + idVenta + ' cancelada y stock repuesto' };
    }
  }

  return { status: 'error', message: 'Venta no encontrada' };
}

function obtenerVentas() {
  const sheet = getSheet(SHEETS.VENTAS);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;

    items.push({
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
      cliente: String(row[10] || ''),
      metodo_pago: String(row[11] || 'Efectivo'),
      notas: String(row[12] || ''),
      estado: String(row[13] || 'Completada')
    });
  }
  return items.reverse(); // Más recientes primero
}

function registrarRecepcionTanque(rec) {
  if (!rec || !rec.articulos || !rec.articulos.length) {
    return { status: 'error', message: 'La recepción de tanque debe contener al menos un artículo' };
  }

  const ahora = new Date();
  const idRecepcion = rec.id_recepcion || ('TANQ-' + Utilities.formatDate(ahora, 'GMT', 'yyyyMMddHHmmss'));
  const nombreTanque = String(rec.nombre_tanque || 'Tanque Importado de EE.UU.').trim();
  const origen = String(rec.origen || 'Miami, FL - EE.UU.').trim();
  const fleteUsd = parseFloat(rec.flete_usd) || 0;
  const tasaCambio = parseFloat(rec.tasa_cambio) || 60.50;
  const notas = String(rec.notas || '').trim();

  let totalUnidades = 0;
  rec.articulos.forEach(art => {
    totalUnidades += (parseInt(art.cantidad) || 0);
  });

  // Guardar cada artículo en Inventario (actualizando existencia o creando nuevo)
  rec.articulos.forEach(art => {
    const costoUsd = parseFloat(art.costo_usd) || 0;
    const costoDop = parseFloat(art.costo_dop) || (costoUsd * tasaCambio);
    const precioVentaDop = parseFloat(art.precio_venta_dop) || 0;

    guardarOActualizarProducto({
      id: art.id || '',
      nombre: art.nombre,
      categoria: art.categoria || 'Variedades',
      descripcion: (art.descripcion || '') + (art.descripcion ? ' | ' : '') + 'Tanque: ' + nombreTanque,
      cantidad: parseInt(art.cantidad) || 0,
      stock_minimo: parseInt(art.stock_minimo) || 3,
      costo_usd: costoUsd,
      costo_dop: costoDop,
      precio_venta_dop: precioVentaDop,
      ubicacion: nombreTanque
    });
  });

  // Registrar en hoja Recepciones
  const recSheet = getSheet(SHEETS.RECEPCIONES);
  recSheet.appendRow([
    idRecepcion,
    ahora,
    nombreTanque,
    origen,
    totalUnidades,
    fleteUsd,
    tasaCambio,
    notas,
    JSON.stringify(rec.articulos)
  ]);

  return {
    status: 'success',
    message: 'Tanque registrado exitosamente con ' + totalUnidades + ' unidades ingresadas al inventario.',
    id_recepcion: idRecepcion,
    totalUnidades: totalUnidades
  };
}

function obtenerRecepciones() {
  const sheet = getSheet(SHEETS.RECEPCIONES);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;

    let articulos = [];
    try {
      if (row[8]) articulos = JSON.parse(row[8]);
    } catch (e) {}

    items.push({
      id_recepcion: String(row[0]),
      fecha: row[1] ? formatearFecha(row[1]) : '',
      nombre_tanque: String(row[2] || ''),
      origen: String(row[3] || ''),
      total_unidades: Number(row[4]) || 0,
      flete_usd: Number(row[5]) || 0,
      tasa_cambio: Number(row[6]) || 60.50,
      notas: String(row[7] || ''),
      articulos: articulos
    });
  }
  return items.reverse();
}

function calcularMetricasGenerales() {
  const inventario = obtenerInventario();
  const ventas = obtenerVentas();

  let totalProductos = inventario.length;
  let totalUnidadesStock = 0;
  let valorInventarioCostoDop = 0;
  let valorInventarioVentaDop = 0;
  let productosStockBajo = 0;
  let productosAgotados = 0;

  inventario.forEach(p => {
    totalUnidadesStock += p.cantidad;
    valorInventarioCostoDop += (p.cantidad * p.costo_dop);
    valorInventarioVentaDop += (p.cantidad * p.precio_venta_dop);
    if (p.cantidad === 0) productosAgotados++;
    else if (p.cantidad <= p.stock_minimo) productosStockBajo++;
  });

  const hoyStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Santo_Domingo', 'yyyy-MM-dd');
  const mesStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Santo_Domingo', 'yyyy-MM');

  let ventasHoyDop = 0;
  let gananciaHoyDop = 0;
  let ventasMesDop = 0;
  let gananciaMesDop = 0;

  ventas.forEach(v => {
    if (v.estado !== 'Cancelada') {
      const fechaVta = String(v.fecha_venta || '');
      if (fechaVta.startsWith(hoyStr)) {
        ventasHoyDop += v.total_dop;
        gananciaHoyDop += v.ganancia_dop;
      }
      if (fechaVta.startsWith(mesStr)) {
        ventasMesDop += v.total_dop;
        gananciaMesDop += v.ganancia_dop;
      }
    }
  });

  return {
    total_productos: totalProductos,
    total_unidades_stock: totalUnidadesStock,
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

function obtenerConfiguracion() {
  const sheet = getSheet(SHEETS.CONFIGURACION);
  const rows = sheet.getDataRange().getValues();
  const cfg = {
    NOMBRE_NEGOCIO: 'Thor Essence',
    MONEDA_PRINCIPAL: 'DOP',
    TASA_CAMBIO_USD_DOP: 60.50,
    CATEGORIAS: 'Perfumes, Splash, Cremas, Body Wash, Accesorios, Maquillaje, Variedades'
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
    if (key === 'AUTH_USER' || key === 'AUTH_PASS' || key === 'MASTER_SERVICE_KEY') {
      // Guardar en ScriptProperties privadas para máxima seguridad
      PropertiesService.getScriptProperties().setProperty(key, String(nuevaCfg[key]));
      continue;
    }

    if (mapa[key]) {
      sheet.getRange(mapa[key], 2).setValue(nuevaCfg[key]);
    } else {
      sheet.appendRow([key, nuevaCfg[key]]);
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
      ['CATEGORIAS', 'Perfumes, Splash, Cremas, Body Wash, Accesorios, Maquillaje, Variedades']
    ];
    cfgSheet.getRange(2, 1, defaultValues.length, 2).setValues(defaultValues);
  }

  // Asegurar que las credenciales de Pamela estén en PropertiesService en el servidor
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('AUTH_USER')) {
    props.setProperty('AUTH_USER', CREDENCIALES_SISTEMA.usuario);
    props.setProperty('AUTH_PASS', CREDENCIALES_SISTEMA.contrasena);
  }
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
