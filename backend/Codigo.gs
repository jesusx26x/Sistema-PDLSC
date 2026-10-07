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
 * 1. Credenciales fuera del código: usuario y hash SHA-256 con sal de la contraseña viven solo
 *    en ScriptProperties y se cambian desde el menú "🔑 Cambiar Usuario y Contraseña".
 *    Login con bloqueo temporal tras intentos fallidos.
 * 2. RLS (Row Level Security): Todas las consultas de lectura y mutación de la base de datos
 *    requieren un token de sesión activo y validado en el servidor.
 * 3. Signout en el Servidor: Al cerrar sesión se destruye el token en CacheService y
 *    PropertiesService, impidiendo que la sesión continúe abierta en el servidor.
 * 4. Operaciones atómicas con LockService para evitar condiciones de carrera.
 * 5. Disparador programable para Respaldo Automático diario en Google Drive (2:00 AM).
 */

// Versión del backend. Subirla en cada cambio de este archivo; el frontend exige una mínima
// y avisa si el código publicado en Apps Script quedó atrás.
const VERSION_BACKEND = 10;

// Zona horaria del negocio: fechas, "ventas de hoy" y vencimientos siempre en hora de RD,
// sin depender de la zona configurada en el proyecto de Apps Script.
const ZONA_HORARIA = 'America/Santo_Domingo';

const SHEETS = {
  INVENTARIO: 'Inventario',
  VENTAS: 'Ventas',
  RECEPCIONES: 'Recepciones',
  CONFIGURACION: 'Configuracion',
  COBROS: 'Cobros'
};

// Las credenciales NUNCA se escriben en el código: viven solo en ScriptProperties
// (AUTH_USER, AUTH_PASS_HASH, AUTH_SALT) y se definen desde el menú de administración.
const AUTH_CONFIG = {
  MIN_LONGITUD_CONTRASENA: 10,
  MAX_INTENTOS_FALLIDOS: 5,
  BLOQUEO_SEGUNDOS: 900, // 15 minutos
  DURACION_SESION_MS: 30 * 24 * 60 * 60 * 1000, // 30 días
  CACHE_SESION_SEGUNDOS: 21600, // 6 horas (máximo de CacheService)
  MAX_SESIONES_ACTIVAS: 20,
  RENOVAR_SI_QUEDAN_MS: 7 * 24 * 60 * 60 * 1000 // con menos de 7 días de vigencia, el uso la extiende otros 30
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
      .addItem('🔍 Diagnosticar Inventario (duplicados y excesos)', 'menuDiagnosticarInventario')
      .addItem('✅ Aplicar Correcciones Marcadas del Diagnóstico', 'menuAplicarCorrecciones')
      .addItem('💾 Crear Copia de Respaldo en Drive', 'crearRespaldoEnDrive')
      .addItem('⏰ Configurar Respaldo Automático Diario', 'configurarDisparadorRespaldo')
      .addItem('📬 Configurar Monitoreo Diario (correo al administrador)', 'configurarMonitoreoDiario')
      .addItem('🛡️ Proteger Hojas contra Ediciones Accidentales', 'menuProtegerHojas')
      .addSeparator()
      .addItem('🔑 Cambiar Usuario y Contraseña', 'menuCambiarCredenciales')
      .addItem('🚪 Cerrar Todas las Sesiones Activas', 'menuCerrarTodasLasSesiones')
      .addToUi();
  } catch (e) {
    console.log('No se pudo crear el menú en ejecución sin interfaz: ' + e);
  }
}

function menuInicializar() {
  inicializarHojasSiNoExisten(true);
  const aviso = credencialesConfiguradas()
    ? ''
    : '\n\n⚠️ Aún no hay usuario y contraseña configurados. Usa "🔑 Cambiar Usuario y Contraseña" para habilitar el acceso.';
  SpreadsheetApp.getUi().alert('✅ Estructura de Thor Essence verificada y lista para operar con RLS activo.' + aviso);
}

function menuDiagnosticarInventario() {
  const res = diagnosticarInventario(true);
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_DIAGNOSTICO);
  if (hoja) hoja.activate();
  SpreadsheetApp.getUi().alert('🔍 Diagnóstico de Inventario\n\n' + res.message +
    '\n\nRevisa la hoja "' + HOJA_DIAGNOSTICO + '", marca la casilla "Aplicar" en las filas que quieras corregir ' +
    '(puedes editar "Nuevo stock") y usa "✅ Aplicar Correcciones Marcadas del Diagnóstico".');
}

function menuAplicarCorrecciones() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('✅ Aplicar correcciones',
    'Se aplicarán SOLO las filas marcadas en la hoja "' + HOJA_DIAGNOSTICO + '".\n' +
    'Antes se creará una copia de respaldo en Google Drive.\n\n¿Continuar?',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  const res = aplicarCorreccionesMarcadas();
  ui.alert((res.status === 'success' ? '✅ ' : '❌ ') + res.message);
}

/**
 * Solicita usuario y contraseña nuevos desde Google Sheets.
 * La contraseña nunca se muestra ni se guarda en texto plano.
 */
function menuCambiarCredenciales() {
  const ui = SpreadsheetApp.getUi();
  const usuarioActual = PropertiesService.getScriptProperties().getProperty('AUTH_USER') || '';

  const rUser = ui.prompt('🔑 Usuario de acceso',
    'Escribe el usuario para iniciar sesión' + (usuarioActual ? ' (actual: ' + usuarioActual + ')' : '') + ':',
    ui.ButtonSet.OK_CANCEL);
  if (rUser.getSelectedButton() !== ui.Button.OK) return;
  const usuario = rUser.getResponseText().trim() || usuarioActual;

  const rPass = ui.prompt('🔑 Nueva contraseña',
    'Escribe la nueva contraseña (mínimo ' + AUTH_CONFIG.MIN_LONGITUD_CONTRASENA + ' caracteres):',
    ui.ButtonSet.OK_CANCEL);
  if (rPass.getSelectedButton() !== ui.Button.OK) return;

  const rPass2 = ui.prompt('🔑 Confirmar contraseña', 'Escribe la contraseña otra vez:', ui.ButtonSet.OK_CANCEL);
  if (rPass2.getSelectedButton() !== ui.Button.OK) return;

  if (rPass.getResponseText() !== rPass2.getResponseText()) {
    ui.alert('❌ Las contraseñas no coinciden. No se realizó ningún cambio.');
    return;
  }

  const res = establecerCredenciales(usuario, rPass.getResponseText());
  ui.alert(res.status === 'success'
    ? '✅ Credenciales actualizadas para el usuario "' + usuario + '".\n\nTodas las sesiones abiertas fueron cerradas: será necesario iniciar sesión de nuevo en cada dispositivo.'
    : '❌ ' + res.message);
}

function menuCerrarTodasLasSesiones() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('🚪 Cerrar todas las sesiones',
    '¿Cerrar la sesión en TODOS los dispositivos? Será necesario volver a iniciar sesión.',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  const cerradas = revocarTodasLasSesiones();
  ui.alert('✅ Se cerraron ' + cerradas + ' sesión(es) activas.');
}

/**
 * Crea una copia de respaldo automática en Google Drive
 */
function crearRespaldoEnDrive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombreCopia = 'Backup Thor Essence — ' + Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd_HH-mm');
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
  rotarRespaldos(carpetaBackup);
  return copia.getUrl();
}

/**
 * Conserva solo los últimos RESPALDOS_A_CONSERVAR respaldos; los anteriores van a la papelera
 * de Drive (recuperables durante 30 días).
 */
function rotarRespaldos(carpeta) {
  try {
    const respaldos = [];
    const it = carpeta.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (String(f.getName()).indexOf('Backup Thor Essence') === 0 && !f.isTrashed()) respaldos.push(f);
    }
    respaldos.sort((a, b) => b.getDateCreated().getTime() - a.getDateCreated().getTime());
    const sobrantes = respaldos.slice(RESPALDOS_A_CONSERVAR);
    sobrantes.forEach(f => f.setTrashed(true));
    return sobrantes.length;
  } catch (e) {
    console.warn('No se pudo rotar los respaldos:', e);
    return 0;
  }
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

function credencialesConfiguradas() {
  const props = PropertiesService.getScriptProperties();
  return !!(props.getProperty('AUTH_USER') && (props.getProperty('AUTH_PASS_HASH') || props.getProperty('AUTH_PASS')));
}

function bytesAHex(bytes) {
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function hashContrasena(pass, salt) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pass, Utilities.Charset.UTF_8);
  return bytesAHex(digest);
}

/**
 * Comparación en tiempo constante para no filtrar información por tiempos de respuesta.
 */
function compararSeguro(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Verifica usuario y contraseña contra ScriptProperties.
 * Si encuentra una contraseña heredada en texto plano (AUTH_PASS), la migra a hash tras un login correcto.
 */
function verificarCredenciales(user, pass) {
  if (!user || !pass) return false;
  const props = PropertiesService.getScriptProperties();
  const usuarioConfigurado = props.getProperty('AUTH_USER');
  if (!usuarioConfigurado) return false;

  const usuarioOk = compararSeguro(String(user).trim(), usuarioConfigurado.trim());
  const hash = props.getProperty('AUTH_PASS_HASH');
  const salt = props.getProperty('AUTH_SALT');

  if (hash && salt) {
    const passOk = compararSeguro(hashContrasena(pass, salt), hash);
    return usuarioOk && passOk;
  }

  const legado = props.getProperty('AUTH_PASS');
  if (!legado) return false;
  const passOk = compararSeguro(pass, legado);
  if (usuarioOk && passOk) {
    const nuevaSal = Utilities.getUuid();
    props.setProperties({ AUTH_SALT: nuevaSal, AUTH_PASS_HASH: hashContrasena(pass, nuevaSal) });
    props.deleteProperty('AUTH_PASS');
  }
  return usuarioOk && passOk;
}

/**
 * Define (o rota) las credenciales de acceso y revoca todas las sesiones existentes.
 */
function establecerCredenciales(usuario, pass) {
  usuario = String(usuario || '').trim();
  pass = String(pass || '').trim();
  if (!usuario) {
    return { status: 'error', message: 'El usuario no puede estar vacío.' };
  }
  if (pass.length < AUTH_CONFIG.MIN_LONGITUD_CONTRASENA) {
    return { status: 'error', message: 'La contraseña debe tener al menos ' + AUTH_CONFIG.MIN_LONGITUD_CONTRASENA + ' caracteres.' };
  }

  const props = PropertiesService.getScriptProperties();
  const salt = Utilities.getUuid();
  props.setProperties({
    AUTH_USER: usuario,
    AUTH_SALT: salt,
    AUTH_PASS_HASH: hashContrasena(pass, salt)
  });
  props.deleteProperty('AUTH_PASS');
  props.deleteProperty('MASTER_SERVICE_KEY');
  revocarTodasLasSesiones();

  return { status: 'success', message: 'Credenciales actualizadas.' };
}

function claveIntentosLogin(username) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(username || '').trim().toLowerCase(), Utilities.Charset.UTF_8);
  return 'LOGIN_FAIL_' + bytesAHex(digest);
}

function obtenerIntentosFallidos(username) {
  try {
    return parseInt(CacheService.getScriptCache().get(claveIntentosLogin(username))) || 0;
  } catch (e) {
    return 0;
  }
}

function registrarIntentoFallido(username) {
  try {
    const cache = CacheService.getScriptCache();
    const clave = claveIntentosLogin(username);
    const intentos = (parseInt(cache.get(clave)) || 0) + 1;
    cache.put(clave, String(intentos), AUTH_CONFIG.BLOQUEO_SEGUNDOS);
    return intentos;
  } catch (e) {
    return 0;
  }
}

function limpiarIntentosFallidos(username) {
  try {
    CacheService.getScriptCache().remove(claveIntentosLogin(username));
  } catch (e) {}
}

function manejarLogin(payload) {
  const username = String(payload.username || (payload.data && payload.data.username) || '').trim();
  const password = String(payload.password || (payload.data && payload.data.password) || '').trim();

  if (!credencialesConfiguradas()) {
    return jsonResponse({
      status: 'error',
      code: 'AUTH_NOT_CONFIGURED',
      message: 'El acceso aún no está configurado en el servidor. Contacta al administrador.'
    });
  }

  if (obtenerIntentosFallidos(username) >= AUTH_CONFIG.MAX_INTENTOS_FALLIDOS) {
    return jsonResponse({
      status: 'error',
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Demasiados intentos fallidos. Espera ' + Math.round(AUTH_CONFIG.BLOQUEO_SEGUNDOS / 60) + ' minutos e inténtalo de nuevo.'
    });
  }

  if (!verificarCredenciales(username, password)) {
    registrarIntentoFallido(username);
    return jsonResponse({
      status: 'error',
      code: 'INVALID_CREDENTIALS',
      message: 'Usuario o contraseña incorrectos. Verifique sus credenciales.'
    }, 401);
  }

  limpiarIntentosFallidos(username);
  purgarSesionesInvalidas();
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
}

function crearSesionEnServidor(username) {
  const token = 'THOR_SES_' + Utilities.getUuid().replace(/-/g, '') + '_' + Date.now();
  const ahora = Date.now();
  const sessionData = {
    username: username,
    creadoEn: ahora,
    expiraEn: ahora + AUTH_CONFIG.DURACION_SESION_MS
  };

  // Guardar en CacheService para respuestas ultra rápidas
  try {
    CacheService.getScriptCache().put(token, JSON.stringify(sessionData), AUTH_CONFIG.CACHE_SESION_SEGUNDOS);
  } catch (e) {
    console.warn('CacheService warning:', e);
  }

  // Persistir en PropertiesService durante toda la vigencia de la sesión
  try {
    PropertiesService.getScriptProperties().setProperty('SESSION_' + token, JSON.stringify(sessionData));
  } catch (e) {
    console.error('PropertiesService error:', e);
  }

  return token;
}

function invalidarSesionEnServidor(token) {
  if (!token) return true;
  token = String(token).trim();

  try {
    CacheService.getScriptCache().remove(token);
  } catch (e) {}

  try {
    PropertiesService.getScriptProperties().deleteProperty('SESSION_' + token);
  } catch (e) {}

  return true;
}

/**
 * Revoca todas las sesiones: las persistidas se eliminan y cualquier token creado
 * antes de este momento (incluso si sigue en CacheService) deja de ser válido.
 */
function revocarTodasLasSesiones() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('AUTH_SESIONES_DESDE', String(Date.now()));

  const tokens = Object.keys(props.getProperties())
    .filter(k => k.indexOf('SESSION_') === 0)
    .map(k => k.substring('SESSION_'.length));

  tokens.forEach(t => props.deleteProperty('SESSION_' + t));
  try {
    if (tokens.length) CacheService.getScriptCache().removeAll(tokens);
  } catch (e) {}

  return tokens.length;
}

/**
 * Elimina sesiones expiradas o revocadas y conserva solo las más recientes
 * para no agotar la cuota de ScriptProperties.
 */
function purgarSesionesInvalidas() {
  try {
    const props = PropertiesService.getScriptProperties();
    const todas = props.getProperties();
    const desde = parseInt(todas.AUTH_SESIONES_DESDE) || 0;
    const ahora = Date.now();
    const vigentes = [];
    const eliminar = [];

    Object.keys(todas).forEach(k => {
      if (k.indexOf('SESSION_') !== 0) return;
      let data = null;
      try { data = JSON.parse(todas[k]); } catch (e) {}
      if (!data || !(data.expiraEn > ahora) || !(data.creadoEn >= desde)) {
        eliminar.push(k);
      } else {
        vigentes.push({ key: k, creadoEn: data.creadoEn });
      }
    });

    // Dejar espacio para la sesión que se está creando
    vigentes.sort((a, b) => b.creadoEn - a.creadoEn);
    vigentes.slice(AUTH_CONFIG.MAX_SESIONES_ACTIVAS - 1).forEach(s => eliminar.push(s.key));

    eliminar.forEach(k => props.deleteProperty(k));
    const tokens = eliminar.map(k => k.substring('SESSION_'.length));
    if (tokens.length) CacheService.getScriptCache().removeAll(tokens);
  } catch (e) {
    console.warn('No se pudieron purgar sesiones:', e);
  }
}

/**
 * Sesión deslizante: si a la sesión le quedan menos de 7 días y se está usando, se extiende
 * otros 30 días. Pamela no tiene que volver a escribir la contraseña mientras use la app.
 */
function renovarSesionSiCorresponde(token, data, props) {
  if (!data || (data.expiraEn - Date.now()) > AUTH_CONFIG.RENOVAR_SI_QUEDAN_MS) return;
  data.expiraEn = Date.now() + AUTH_CONFIG.DURACION_SESION_MS;
  const json = JSON.stringify(data);
  try { props.setProperty('SESSION_' + token, json); } catch (e) {}
  try { CacheService.getScriptCache().put(token, json, AUTH_CONFIG.CACHE_SESION_SEGUNDOS); } catch (e) {}
}

function sesionVigente(data, desde) {
  return !!(data && data.expiraEn > Date.now() && data.creadoEn >= desde);
}

/**
 * RLS (Row Level Security):
 * Valida que la solicitud provenga de una sesión activa autenticada.
 * Evita cualquier lectura anónima o no autorizada de la base de datos.
 */
function validarSesionRLS(token) {
  if (!token || typeof token !== 'string') return false;
  token = token.trim();

  const props = PropertiesService.getScriptProperties();
  const desde = parseInt(props.getProperty('AUTH_SESIONES_DESDE')) || 0;

  // 1. Validar en CacheService
  try {
    const cachedStr = CacheService.getScriptCache().get(token);
    if (cachedStr) {
      const data = JSON.parse(cachedStr);
      if (sesionVigente(data, desde)) {
        renovarSesionSiCorresponde(token, data, props);
        return true;
      }
    }
  } catch (e) {}

  // 2. Validar en ScriptProperties (persistencia en servidor)
  try {
    const propStr = props.getProperty('SESSION_' + token);
    if (propStr) {
      const data = JSON.parse(propStr);
      if (sesionVigente(data, desde)) {
        try {
          CacheService.getScriptCache().put(token, propStr, AUTH_CONFIG.CACHE_SESION_SEGUNDOS);
        } catch (ce) {}
        renovarSesionSiCorresponde(token, data, props);
        return true;
      }
      props.deleteProperty('SESSION_' + token);
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
  aliasEnMemoria = null;
  try {
    const params = e ? e.parameter : {};
    const action = params.action || 'ping';

    // Endpoint público de verificación de estado (no entrega datos de la BD)
    if (action === 'ping') {
      return jsonResponse({
        status: 'success',
        message: 'Backend Thor Essence activo y funcionando',
        version: VERSION_BACKEND,
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

    const lectura = responderLectura(action);
    if (lectura) return lectura;

    return jsonResponse({ status: 'error', message: 'Acción GET no reconocida' }, 400);

  } catch (err) {
    console.error('doGet:', err);
    return jsonResponse({ status: 'error', code: 'SERVER_ERROR', message: err.toString() }, 500);
  }
}

const LECTURAS = {
  getAllData: () => obtenerTodosLosDatos(),
  getInventory: () => obtenerInventario(),
  getSales: () => obtenerVentas(),
  getReceptions: () => obtenerRecepciones(),
  getCobros: () => obtenerCobros()
};

/**
 * Atiende una acción de solo lectura (ya autenticada). Devuelve null si la acción no es de lectura.
 * Espera a que termine cualquier escritura en curso para no leer una venta a medio registrar.
 */
function responderLectura(action) {
  const lector = LECTURAS[action];
  if (!lector) return null;
  inicializarHojasSiNoExisten();
  const lock = LockService.getScriptLock();
  const conLock = lock.tryLock(10000);
  try {
    return jsonResponse({ status: 'success', data: lector() });
  } finally {
    if (conLock) lock.releaseLock();
  }
}

function doPost(e) {
  aliasEnMemoria = null;
  let payload = {};
  if (e && e.postData && e.postData.contents) {
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      payload = e.parameter || {};
    }
  } else {
    payload = (e && e.parameter) || {};
  }

  const action = payload.action;

  // Login, logout y validación de sesión no tocan las hojas: se atienden sin el bloqueo
  // global para no hacer esperar a nadie detrás de una transacción de inventario.
  try {
    // =========================================================================
    // 1. ENDPOINT PÚBLICO: INICIO DE SESIÓN (LOGIN)
    // Valida credenciales en el servidor y genera token temporal de sesión
    // =========================================================================
    if (action === 'login') {
      return manejarLogin(payload);
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

    // 4. LECTURAS por POST: el token viaja en el cuerpo, no en la URL (historial, registros)
    const lectura = responderLectura(action);
    if (lectura) return lectura;

    // 5. Registro de errores y rechazos que reportan los dispositivos (no toca el inventario)
    if (action === 'logClientEvents') {
      return jsonResponse(registrarEventosCliente(payload.data || {}));
    }
  } catch (err) {
    console.error('doPost (' + action + '):', err);
    return jsonResponse({ status: 'error', code: 'SERVER_ERROR', message: err.toString() }, 500);
  }

  const lock = LockService.getScriptLock();
  const lockAcquired = lock.tryLock(30000);

  try {
    if (!lockAcquired) {
      return jsonResponse({ status: 'error', code: 'SERVER_BUSY', message: 'El servidor está ocupado procesando otra transacción. Reintenta en unos segundos.' }, 503);
    }

    inicializarHojasSiNoExisten();
    // El kardex se crea (con el saldo inicial) antes de la primera mutación
    hojaMovimientos();

    // Idempotencia: si esta operación ya se procesó (reintento de la cola offline o respuesta
    // perdida en la red), se devuelve el resultado original sin volver a aplicar la mutación.
    const opId = idCliente(payload.op_id);
    if (opId) {
      const previo = buscarOperacionProcesada(opId);
      if (previo) {
        previo.duplicado = true;
        return jsonResponse(previo);
      }
    }

    const resultado = ejecutarAccion(action, payload);
    if (opId && resultado && resultado.status === 'success') {
      registrarOperacionProcesada(opId, action, resultado);
    }
    return jsonResponse(resultado);

  } catch (err) {
    console.error('doPost (' + action + '):', err);
    return jsonResponse({ status: 'error', code: 'SERVER_ERROR', message: err.toString() }, 500);
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function ejecutarAccion(action, payload) {
  switch (action) {
    case 'saveProduct':
      return guardarOActualizarProducto(payload.data);

    case 'deleteProduct': {
      const delId = payload.id || (payload.data && (payload.data.id || payload.data));
      return eliminarProducto(delId);
    }

    case 'adjustStock': {
      const adjId = payload.id || (payload.data && payload.data.id);
      const adjDelta = payload.delta !== undefined ? payload.delta : (payload.data && payload.data.delta);
      const adjMotivo = payload.motivo || (payload.data && payload.data.motivo);
      return ajustarStockProducto(adjId, adjDelta, adjMotivo);
    }

    case 'registerSale':
      return registrarVenta(payload.data);

    case 'cancelSale': {
      const cancelId = payload.id_venta || (payload.data && (payload.data.id_venta || payload.data));
      return cancelarVenta(cancelId);
    }

    case 'registerReception':
      return registrarRecepcionTanque(payload.data);

    case 'registerPayment':
      return registrarAbono(payload.data);

    case 'saveConfig':
      return guardarConfiguracion(payload.data);

    case 'initSetup':
      inicializarHojasSiNoExisten(true);
      return { status: 'success', message: 'Estructura de hojas inicializada con éxito' };

    case 'resetAllData': {
      const conf = payload.confirmacion || (payload.data && payload.data.confirmacion);
      return purgarTodasLasHojas(conf);
    }

    case 'reconcileInventory':
      // Solo diagnostica: nunca modifica el inventario automáticamente
      return diagnosticarInventario(true);

    case 'deleteReception': {
      const delRecId = payload.id_recepcion || (payload.data && (payload.data.id_recepcion || payload.data));
      return eliminarRecepcion(delRecId);
    }

    default:
      return { status: 'error', message: 'Acción POST no reconocida: ' + action };
  }
}

/**
 * =========================================================================
 * IDENTIFICADORES ÚNICOS E IDEMPOTENCIA
 * =========================================================================
 */

/**
 * ID legible y único: PREFIJO-yyyyMMdd-XXXXXXXX (8 hex aleatorios de un UUID).
 * El frontend genera el mismo formato para que el ID local y el de la nube coincidan.
 */
/**
 * Redondeo a centavos para montos de dinero (evita saldos de 0.0000001).
 */
function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function generarId(prefijo) {
  const fecha = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyyMMdd');
  return prefijo + '-' + fecha + '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
}

/**
 * Acepta un ID enviado por el cliente solo si tiene un formato seguro; si no, devuelve ''.
 */
function idCliente(id) {
  const s = String(id === undefined || id === null ? '' : id).trim();
  return /^[A-Za-z0-9_-]{3,64}$/.test(s) ? s : '';
}

/**
 * Indica si un ID ya existe en la primera columna de una hoja (sin leerla completa).
 */
function existeIdEnHoja(sheet, id) {
  const ultima = sheet.getLastRow();
  if (!id || ultima < 2) return false;
  return !!sheet.getRange(2, 1, ultima - 1, 1)
    .createTextFinder(String(id))
    .matchEntireCell(true)
    .findNext();
}

/**
 * =========================================================================
 * ALIAS DE IDS DE PRODUCTO
 * =========================================================================
 * Un dispositivo sin conexión puede crear un producto (o recibirlo en un tanque) con un ID
 * propio cuando ese producto ya existía en la nube con otro ID. El servidor los une por nombre
 * y registra aquí "ID del dispositivo → ID real", de modo que las ventas, ajustes y ediciones
 * que lleguen después con el ID del dispositivo se apliquen al producto correcto.
 */
const HOJA_ALIAS = 'Alias';
let aliasEnMemoria = null;

function hojaAlias() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(HOJA_ALIAS);
  if (!sheet) {
    sheet = ss.insertSheet(HOJA_ALIAS);
    sheet.getRange(1, 1, 1, 4).setValues([['ID usado por el dispositivo', 'ID real', 'Fecha', 'Motivo']]);
    estilarCabecera(sheet, 4, '#0B132B', '#D4AF37');
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

function mapaAlias() {
  if (aliasEnMemoria) return aliasEnMemoria;
  aliasEnMemoria = new Map();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_ALIAS);
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(f => {
      const alias = String(f[0] || '').trim();
      const real = String(f[1] || '').trim();
      if (alias && real && alias !== real) aliasEnMemoria.set(alias, real);
    });
  }
  return aliasEnMemoria;
}

/**
 * Devuelve el ID real de un producto (sigue la cadena de alias; tolera ciclos).
 */
function resolverIdProducto(id) {
  let actual = String(id === undefined || id === null ? '' : id).trim();
  const mapa = mapaAlias();
  const vistos = new Set();
  while (actual && mapa.has(actual) && !vistos.has(actual)) {
    vistos.add(actual);
    actual = mapa.get(actual);
  }
  return actual;
}

function registrarAlias(alias, real, motivo) {
  alias = String(alias || '').trim();
  real = String(real || '').trim();
  if (!alias || !real || alias === real) return;
  const mapa = mapaAlias();
  if (mapa.get(alias) === real) return;
  hojaAlias().appendRow([alias, real, new Date(), motivo || '']);
  mapa.set(alias, real);
}

function obtenerAliasObjeto() {
  const obj = {};
  mapaAlias().forEach((real, alias) => { obj[alias] = resolverIdProducto(real) || real; });
  return obj;
}

const HOJA_OPERACIONES = 'Operaciones';

function hojaOperaciones() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(HOJA_OPERACIONES);
  if (!sheet) {
    sheet = ss.insertSheet(HOJA_OPERACIONES);
    sheet.getRange(1, 1, 1, 4).setValues([['Op ID', 'Fecha', 'Acción', 'Resultado (JSON)']]);
    estilarCabecera(sheet, 4, '#0B132B', '#D4AF37');
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

function buscarOperacionProcesada(opId) {
  const claveCache = 'OP_' + opId;
  try {
    const enCache = CacheService.getScriptCache().get(claveCache);
    if (enCache) return JSON.parse(enCache);
  } catch (e) {}

  const sheet = hojaOperaciones();
  const ultima = sheet.getLastRow();
  if (ultima < 2) return null;
  const celda = sheet.getRange(2, 1, ultima - 1, 1)
    .createTextFinder(opId)
    .matchEntireCell(true)
    .findNext();
  if (!celda) return null;

  try {
    return JSON.parse(sheet.getRange(celda.getRow(), 4).getValue());
  } catch (e) {
    return { status: 'success', message: 'Operación ya procesada anteriormente' };
  }
}

function registrarOperacionProcesada(opId, action, resultado) {
  let json = JSON.stringify(resultado);
  // Límite de 50.000 caracteres por celda en Google Sheets
  if (json.length > 45000) {
    json = JSON.stringify({ status: resultado.status, message: resultado.message });
  }
  hojaOperaciones().appendRow([opId, new Date(), action, json]);
  try {
    CacheService.getScriptCache().put('OP_' + opId, json, 21600);
  } catch (e) {}
}

/**
 * =========================================================================
 * FUNCIONES DE NEGOCIO Y CONSULTAS
 * =========================================================================
 */

/**
 * Días de historial detallado que se envían al dispositivo. Lo anterior viaja como resumen
 * (totales y productos más vendidos) para que el almacenamiento del navegador no se llene.
 */
const VENTANA_HISTORIAL_DIAS = 180;

function obtenerTodosLosDatos() {
  const inventario = obtenerInventario();
  const ventas = obtenerVentas();
  const cobros = obtenerCobros();

  const limite = Utilities.formatDate(new Date(Date.now() - VENTANA_HISTORIAL_DIAS * 86400000), ZONA_HORARIA, 'yyyy-MM-dd');
  const cobrosVisibles = cobros.filter(c =>
    (c.estado !== 'Saldada' && c.estado !== 'Cancelada') || String(c.fecha_venta) >= limite);
  const ventasConCobroVisible = new Set(cobrosVisibles.map(c => c.id_venta));

  const ventasVisibles = [];
  const historial = { desde: limite, ventas: 0, ingresos_dop: 0, ganancia_dop: 0, cobrado_dop: 0, a_devolver_dop: 0, por_producto: {} };
  ventas.forEach(v => {
    if (String(v.fecha_venta) >= limite || ventasConCobroVisible.has(v.id_venta)) {
      ventasVisibles.push(v);
      return;
    }
    if (v.estado === 'Cancelada') return;
    historial.ventas++;
    historial.ingresos_dop = r2(historial.ingresos_dop + v.total_dop);
    historial.ganancia_dop = r2(historial.ganancia_dop + v.ganancia_dop);
    if (v.metodo_pago !== 'Crédito / Fiado') historial.cobrado_dop = r2(historial.cobrado_dop + v.total_dop);
    const nombre = v.nombre_articulo || 'Sin Nombre';
    const acc = historial.por_producto[nombre] || { cantidad: 0, total: 0 };
    acc.cantidad += v.cantidad;
    acc.total = r2(acc.total + v.total_dop);
    historial.por_producto[nombre] = acc;
  });

  // Abonos de fiados que ya no viajan al dispositivo (cerrados hace más de 180 días)
  cobros.forEach(c => {
    if (cobrosVisibles.indexOf(c) >= 0) return;
    if (c.estado !== 'Cancelada') historial.cobrado_dop = r2(historial.cobrado_dop + c.total_cobrado_dop);
    historial.a_devolver_dop = r2(historial.a_devolver_dop + (c.a_devolver_dop || 0));
  });

  return {
    inventario: inventario,
    ventas: ventasVisibles,
    recepciones: obtenerRecepciones(),
    cobros: cobrosVisibles,
    configuracion: obtenerConfiguracion(),
    metricas: calcularMetricasGenerales(inventario, ventas, cobros),
    historial: historial,
    alias: obtenerAliasObjeto(),
    version_backend: VERSION_BACKEND,
    // El cliente descarta de su cola local las operaciones que ya están aplicadas aquí
    ops_aplicadas: obtenerOperacionesRecientes(500)
  };
}

function obtenerOperacionesRecientes(limite) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_OPERACIONES);
  if (!sheet) return [];
  const ultima = sheet.getLastRow();
  if (ultima < 2) return [];
  const desde = Math.max(2, ultima - limite + 1);
  return sheet.getRange(desde, 1, ultima - desde + 1, 1).getValues()
    .map(f => String(f[0] || ''))
    .filter(Boolean);
}

function obtenerInventario() {
  const sheet = getSheet(SHEETS.INVENTARIO);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    const estadoProd = String(row[10] || 'En Stock');
    if (estadoProd === 'Eliminado') continue; // A3 FIX: Omitir productos dados de baja

    items.push({
      id: String(row[0]),
      nombre: String(row[1] || ''),
      categoria: String(row[2] || 'Variedades'),
      descripcion: String(row[3] || ''),
      cantidad: Number(row[4]) || 0,
      stock_minimo: stockMinimoDe(row[5]),
      costo_usd: Number(row[6]) || 0,
      costo_dop: Number(row[7]) || 0,
      precio_venta_dop: Number(row[8]) || 0,
      ubicacion: String(row[9] || ''),
      estado: estadoProd,
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

  const idSolicitado = String(prod.id || '').trim();
  const id = idSolicitado ? resolverIdProducto(idSolicitado) : generarId('PROD');
  const nombre = String(prod.nombre).trim();
  const categoria = String(prod.categoria || 'Variedades').trim();
  const descripcion = String(prod.descripcion || '').trim();
  const cantidadRaw = parseInt(prod.cantidad);
  const cantidad = isNaN(cantidadRaw) ? 0 : cantidadRaw;
  const stockMinimoRaw = parseInt(prod.stock_minimo);
  const stockMinimo = (isNaN(stockMinimoRaw) || stockMinimoRaw < 0) ? 3 : stockMinimoRaw;
  const costoUsd = parseFloat(prod.costo_usd) || 0;
  const tasaConfig = (typeof obtenerConfiguracion === 'function') ? (parseFloat(obtenerConfiguracion().TASA_CAMBIO_USD_DOP) || 60.50) : 60.50;
  const costoDop = parseFloat(prod.costo_dop) || (costoUsd * tasaConfig);
  const precioVentaDop = parseFloat(prod.precio_venta_dop) || 0;
  const ubicacion = String(prod.ubicacion || 'Almacén Principal').trim();

  if (cantidad < 0) {
    return { status: 'error', code: 'VALIDACION', message: 'La cantidad no puede ser negativa' };
  }
  if (costoUsd < 0 || costoDop < 0 || precioVentaDop < 0) {
    return { status: 'error', code: 'VALIDACION', message: 'Los costos y el precio no pueden ser negativos' };
  }

  let filaEncontrada = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      filaEncontrada = i + 1;
      break;
    }
  }

  if (filaEncontrada > 0) {
    const filaActual = data[filaEncontrada - 1];
    if (String(filaActual[10]) === 'Eliminado') {
      return { status: 'error', code: 'PRODUCTO_ELIMINADO', message: 'El producto "' + filaActual[1] + '" fue eliminado del inventario y no se puede modificar.' };
    }
    // Al editar, la cantidad NO se sobrescribe: el stock solo cambia con ajustes, ventas y tanques.
    // Así un dispositivo con datos viejos no puede pisar ventas registradas desde otro.
    const cantidadActual = parseInt(filaActual[4]) || 0;
    const fechaIngresoOriginal = filaActual[11] || ahora;
    sheet.getRange(filaEncontrada, 1, 1, 13).setValues([[
      id, nombre, categoria, descripcion, cantidadActual, stockMinimo,
      costoUsd, costoDop, precioVentaDop, ubicacion, estadoPorStock(cantidadActual, stockMinimo),
      fechaIngresoOriginal, ahora
    ]]);
    return { status: 'success', message: 'Producto actualizado exitosamente', id: id, cantidad: cantidadActual };
  } else {
    // Alta de un producto cuyo nombre ya existe (p. ej. creado en dos equipos sin conexión):
    // no se crea un duplicado; se suman las unidades al existente y se registra el alias del ID nuevo
    const clave = normalizarNombre(nombre);
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0] || String(data[i][10]) === 'Eliminado' || normalizarNombre(data[i][1]) !== clave) continue;
      const idExistente = String(data[i][0]);
      registrarAlias(idSolicitado, idExistente, 'Alta con un nombre que ya existía: "' + nombre + '"');
      const stockActual = parseInt(data[i][4]) || 0;
      const nuevoStock = stockActual + cantidad;
      if (cantidad > 0) {
        sheet.getRange(i + 1, 5).setValue(nuevoStock);
        sheet.getRange(i + 1, 11).setValue(estadoPorStock(nuevoStock, stockMinimoDe(data[i][5])));
        sheet.getRange(i + 1, 13).setValue(ahora);
        registrarMovimientos([{
          id: idExistente, nombre: data[i][1], tipo: 'ALTA', delta: cantidad, stock: nuevoStock,
          referencia: idSolicitado, detalle: 'Alta manual unida al producto existente (mismo nombre)'
        }]);
      }
      return {
        status: 'success',
        id: idExistente,
        unido: true,
        cantidad: nuevoStock,
        message: 'Ya existía "' + data[i][1] + '": ' + (cantidad > 0
          ? 'se sumaron ' + cantidad + ' unidad(es) (total ' + nuevoStock + ') en lugar de crear un duplicado.'
          : 'no se creó un producto duplicado.')
      };
    }

    sheet.appendRow([
      id, nombre, categoria, descripcion, cantidad, stockMinimo,
      costoUsd, costoDop, precioVentaDop, ubicacion, estadoPorStock(cantidad, stockMinimo),
      ahora, ahora
    ]);
    registrarMovimientos([{
      id: id, nombre: nombre, tipo: 'ALTA', delta: cantidad, stock: cantidad,
      detalle: 'Producto creado manualmente'
    }]);
    return { status: 'success', message: 'Producto registrado exitosamente', id: id };
  }
}

function eliminarProducto(id) {
  if (!id) return { status: 'error', message: 'ID de producto requerido' };
  id = resolverIdProducto(id);
  const sheet = getSheet(SHEETS.INVENTARIO);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      if (String(data[i][10]) === 'Eliminado') {
        return { status: 'success', duplicado: true, message: 'El producto ya estaba dado de baja' };
      }
      const stockAnterior = parseInt(data[i][4]) || 0;
      // Soft-delete: se conserva la fila para el historial de ventas y movimientos
      sheet.getRange(i + 1, 5).setValue(0); // Cantidad a 0
      sheet.getRange(i + 1, 11).setValue('Eliminado'); // Estado Eliminado
      sheet.getRange(i + 1, 13).setValue(new Date()); // Fecha actualización
      registrarMovimientos([{
        id: id, nombre: data[i][1], tipo: 'ELIMINACION', delta: -stockAnterior, stock: 0,
        detalle: 'Producto dado de baja'
      }]);
      return { status: 'success', message: 'Producto dado de baja exitosamente' };
    }
  }
  return { status: 'error', message: 'Producto no encontrado' };
}

/**
 * Suma o resta unidades a un producto y lo registra en el kardex.
 * tipo: 'AJUSTE' (manual, por defecto) o 'ANULACION' (devolución por venta anulada).
 */
function ajustarStockProducto(id, delta, motivo, tipo, referencia) {
  if (!id) return { status: 'error', message: 'ID de producto requerido' };
  id = resolverIdProducto(id);
  const deltaN = parseInt(delta);
  if (isNaN(deltaN)) return { status: 'error', message: 'Delta de ajuste inválido' };

  const sheet = getSheet(SHEETS.INVENTARIO);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      if (String(data[i][10]) === 'Eliminado') {
        return { status: 'error', code: 'PRODUCTO_ELIMINADO', message: 'El producto "' + data[i][1] + '" fue eliminado del inventario; no se ajustó su stock.' };
      }

      const actual = parseInt(data[i][4]) || 0;
      const nuevo = Math.max(0, actual + deltaN);
      const stockMin = stockMinimoDe(data[i][5]);

      sheet.getRange(i + 1, 5).setValue(nuevo);
      sheet.getRange(i + 1, 11).setValue(estadoPorStock(nuevo, stockMin));
      sheet.getRange(i + 1, 13).setValue(new Date());

      registrarMovimientos([{
        id: id, nombre: data[i][1], tipo: tipo || 'AJUSTE', delta: nuevo - actual, stock: nuevo,
        referencia: referencia, detalle: motivo || 'Ajuste manual'
      }]);

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

  const idVentaCliente = String(venta.id_venta || '').trim();
  if (idVentaCliente && existeIdEnHoja(getSheet(SHEETS.VENTAS), idVentaCliente)) {
    return {
      status: 'success',
      duplicado: true,
      id_venta: idVentaCliente,
      message: 'La venta ' + idVentaCliente + ' ya estaba registrada.'
    };
  }

  const invSheet = getSheet(SHEETS.INVENTARIO);
  const invData = invSheet.getDataRange().getValues();
  let producto = null;
  let filaProd = -1;

  const idArticulo = resolverIdProducto(venta.id_articulo);
  for (let i = 1; i < invData.length; i++) {
    if (String(invData[i][0]) === idArticulo) {
      producto = invData[i];
      filaProd = i + 1;
      break;
    }
  }

  if (!producto) {
    return { status: 'error', message: 'El producto vendido no existe en el inventario' };
  }
  if (String(producto[10]) === 'Eliminado') {
    return { status: 'error', code: 'PRODUCTO_ELIMINADO', message: 'El producto "' + producto[1] + '" fue eliminado del inventario.' };
  }

  const cantidadVenta = parseInt(venta.cantidad);
  if (isNaN(cantidadVenta) || cantidadVenta <= 0) {
    return { status: 'error', message: 'Cantidad inválida. Debe ser un número entero positivo.' };
  }
  const stockActual = parseInt(producto[4]) || 0;

  if (stockActual < cantidadVenta) {
    return {
      status: 'error',
      message: 'Stock insuficiente para esta venta. Stock actual: ' + stockActual + ', solicitado: ' + cantidadVenta
    };
  }

  const ahora = new Date();
  const idVenta = String(venta.id_venta || '').trim() || generarId('VTA');
  const precioUnitarioDop = parseFloat(venta.precio_unitario_dop) || parseFloat(producto[8]) || 0;
  if (precioUnitarioDop < 0) {
    return { status: 'error', code: 'VALIDACION', message: 'El precio de venta no puede ser negativo' };
  }
  if ((parseFloat(venta.abono_inicial) || 0) < 0) {
    return { status: 'error', code: 'VALIDACION', message: 'El abono inicial no puede ser negativo' };
  }
  const totalVentaDop = r2(precioUnitarioDop * cantidadVenta);
  const costoUnitarioDop = parseFloat(producto[7]) || 0;
  const gananciaNetaDop = r2(totalVentaDop - (costoUnitarioDop * cantidadVenta));

  const ventaACredito = (venta.tipo_venta === 'credito' || venta.metodo_pago === 'Crédito' || venta.metodo_pago === 'Fiado' || venta.es_credito === true);
  if (ventaACredito && totalVentaDop > 0 && (parseFloat(venta.abono_inicial) || 0) >= totalVentaDop) {
    return { status: 'error', code: 'VALIDACION', message: 'El abono inicial cubre el total de la venta: regístrala al contado.' };
  }

  // Modalidad: Contado vs Crédito / Fiado
  const esCredito = (venta.tipo_venta === 'credito' || venta.metodo_pago === 'Crédito' || venta.metodo_pago === 'Fiado' || venta.es_credito === true);
  const estadoVenta = esCredito ? 'Pendiente de Cobro' : 'Completada';
  const metodoPago = esCredito ? 'Crédito / Fiado' : String(venta.metodo_pago || 'Efectivo').trim();
  const clienteNombre = String(venta.cliente || 'Consumidor Final').trim();
  const clienteTelefono = String(venta.telefono || '').trim();

  // A1 FIX: Atomicidad. Registrar primero en hoja Ventas (y Cobros) antes de alterar el inventario
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
    clienteNombre,
    metodoPago,
    String(venta.notas || '').trim(),
    estadoVenta
  ]);

  let cobroCreado = null;
  if (esCredito) {
    cobroCreado = crearRegistroCobro({
      id_cobro: venta.id_cobro,
      id_abono_inicial: venta.id_abono_inicial,
      id_venta: idVenta,
      cliente: clienteNombre,
      telefono: clienteTelefono,
      articulo: producto[1],
      total_dop: totalVentaDop,
      abono_inicial: parseFloat(venta.abono_inicial) || 0,
      num_cuotas: parseInt(venta.num_cuotas) || 2,
      frecuencia: venta.frecuencia || 'quincenal',
      fecha_venta: ahora
    });
  }

  // Solo tras asegurar el registro contable, deducir stock en Inventario
  const nuevoStock = stockActual - cantidadVenta;
  const stockMin = stockMinimoDe(producto[5]);
  const nuevoEstado = nuevoStock === 0 ? 'Agotado' : (nuevoStock <= stockMin ? 'Stock Bajo' : 'En Stock');

  invSheet.getRange(filaProd, 5).setValue(nuevoStock);
  invSheet.getRange(filaProd, 11).setValue(nuevoEstado);
  invSheet.getRange(filaProd, 13).setValue(ahora);
  registrarMovimientos([{
    id: producto[0], nombre: producto[1], tipo: 'VENTA', delta: -cantidadVenta, stock: nuevoStock,
    referencia: idVenta, detalle: clienteNombre + ' · ' + metodoPago
  }]);

  return {
    status: 'success',
    message: esCredito 
      ? 'Venta a crédito ("fiado") registrada con éxito. Se descontó stock y se creó cuenta por cobrar.'
      : 'Venta registrada con éxito. Ganancia neta: RD$ ' + gananciaNetaDop.toFixed(2),
    id_venta: idVenta,
    nuevoStock: nuevoStock,
    cobro: cobroCreado
  };
}

function crearRegistroCobro(info) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cobSheet = getSheet(SHEETS.COBROS);
  const ahora = info.fecha_venta || new Date();
  const idCobro = String(info.id_cobro || '').trim() || generarId('COB');
  
  const totalDop = parseFloat(info.total_dop) || 0;
  const abonoInicial = parseFloat(info.abono_inicial) || 0;
  const saldoPendiente = r2(Math.max(0, totalDop - abonoInicial));
  const numCuotas = parseInt(info.num_cuotas) || 1;
  const frecuencia = info.frecuencia || 'quincenal';

  const planCuotas = calcularPlanCuotas(totalDop, abonoInicial, numCuotas, frecuencia, ahora);
  
  const historialAbonos = [];
  if (abonoInicial > 0) {
    historialAbonos.push({
      id_abono: String(info.id_abono_inicial || '').trim() || generarId('ABN'),
      fecha: Utilities.formatDate(ahora, ZONA_HORARIA, 'yyyy-MM-dd HH:mm:ss'),
      monto: abonoInicial,
      metodo_pago: 'Efectivo',
      nota: 'Abono inicial en venta'
    });
  }

  let proximoVencimiento = '';
  const primerPendiente = planCuotas.find(c => c.estado === 'Pendiente');
  if (primerPendiente) {
    proximoVencimiento = primerPendiente.fecha_vencimiento;
  }

  const estado = saldoPendiente <= 0 ? 'Saldada' : (abonoInicial > 0 ? 'Parcial' : 'Pendiente');

  cobSheet.appendRow([
    idCobro,
    info.id_venta,
    ahora,
    String(info.cliente || 'Cliente').trim(),
    String(info.telefono || '').trim(),
    String(info.articulo || '').trim(),
    totalDop,
    abonoInicial,
    abonoInicial,
    saldoPendiente,
    numCuotas,
    frecuencia,
    estado,
    proximoVencimiento,
    JSON.stringify(historialAbonos),
    JSON.stringify(planCuotas)
  ]);

  return {
    id_cobro: idCobro,
    id_venta: info.id_venta,
    cliente: info.cliente,
    telefono: info.telefono,
    articulo: info.articulo,
    total_dop: totalDop,
    abono_inicial_dop: abonoInicial,
    total_cobrado_dop: abonoInicial,
    saldo_pendiente_dop: saldoPendiente,
    num_cuotas: numCuotas,
    frecuencia: frecuencia,
    estado: estado,
    proximo_vencimiento: proximoVencimiento,
    historial_abonos: historialAbonos,
    plan_cuotas: planCuotas
  };
}

function calcularPlanCuotas(montoTotal, abonoInicial, numCuotas, frecuencia, fechaInicio) {
  numCuotas = Math.max(1, parseInt(numCuotas) || 1);
  const saldoRestante = Math.max(0, montoTotal - (abonoInicial || 0));
  const montoBasePorCuota = Math.floor((saldoRestante / numCuotas) * 100) / 100;
  
  const cuotas = [];
  const baseD = fechaInicio ? new Date(fechaInicio) : new Date();

  for (let i = 1; i <= numCuotas; i++) {
    let fechaVenc;
    if (frecuencia === 'mensual') {
      fechaVenc = new Date(baseD.getFullYear(), baseD.getMonth() + i, baseD.getDate(), 12, 0, 0);
    } else {
      fechaVenc = obtenerProximaQuincena(baseD, i);
    }

    const fechaStr = Utilities.formatDate(fechaVenc, ZONA_HORARIA, 'yyyy-MM-dd');
    const montoCuota = i === numCuotas 
      ? Math.round((saldoRestante - (montoBasePorCuota * (numCuotas - 1))) * 100) / 100 
      : montoBasePorCuota;

    cuotas.push({
      numero: i,
      monto: montoCuota,
      monto_abonado: saldoRestante === 0 ? montoCuota : 0,
      fecha_vencimiento: fechaStr,
      estado: saldoRestante === 0 ? 'Cobrada' : 'Pendiente',
      fecha_pago: saldoRestante === 0 ? fechaStr : null
    });
  }

  return cuotas;
}

function obtenerProximaQuincena(baseDate, step) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const day = baseDate.getDate();

  const isAfter15 = day > 15;
  const totalHalfMonths = (year * 24) + (month * 2) + (isAfter15 ? 1 : 0) + (step - 1);

  const targetYear = Math.floor(totalHalfMonths / 24);
  const rem = totalHalfMonths % 24;
  const targetMonth = Math.floor(rem / 2);
  const isSecondHalf = (rem % 2) === 1;

  if (isSecondHalf) {
    const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    const targetDay = Math.min(30, lastDay);
    return new Date(targetYear, targetMonth, targetDay, 12, 0, 0);
  } else {
    return new Date(targetYear, targetMonth, 15, 12, 0, 0);
  }
}

function registrarAbono(pago) {
  if (!pago || !pago.id_cobro || !pago.monto) {
    return { status: 'error', message: 'ID de cobro y monto de abono son requeridos' };
  }

  const montoAbono = parseFloat(pago.monto);
  if (isNaN(montoAbono) || montoAbono <= 0) {
    return { status: 'error', message: 'Monto inválido. Debe ser un número positivo mayor a 0.' };
  }

  const cobSheet = getSheet(SHEETS.COBROS);
  const rows = cobSheet.getDataRange().getValues();
  let filaEncontrada = -1;
  let filaData = null;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(pago.id_cobro)) {
      filaEncontrada = i + 1;
      filaData = rows[i];
      break;
    }
  }

  if (filaEncontrada <= 0) {
    return { status: 'error', message: 'Registro de cobro no encontrado: ' + pago.id_cobro };
  }

  const totalDop = parseFloat(filaData[6]) || 0;
  let totalCobrado = parseFloat(filaData[8]) || 0;
  let saldoPendiente = parseFloat(filaData[9]) || 0;

  let historialAbonos = [];
  try {
    if (filaData[14]) historialAbonos = JSON.parse(filaData[14]);
  } catch (e) {}

  // Un reintento del mismo abono (mismo id_abono) no se vuelve a aplicar
  const idAbono = String(pago.id_abono || '').trim() || generarId('ABN');
  if (historialAbonos.some(a => a && String(a.id_abono) === idAbono)) {
    return {
      status: 'success',
      duplicado: true,
      id_cobro: pago.id_cobro,
      id_abono: idAbono,
      saldo_pendiente_dop: saldoPendiente,
      total_cobrado_dop: totalCobrado,
      estado: String(filaData[12] || ''),
      message: 'El abono ' + idAbono + ' ya estaba registrado.'
    };
  }

  const ahoraAbono = new Date();
  const fechaAbonoStr = Utilities.formatDate(ahoraAbono, ZONA_HORARIA, 'yyyy-MM-dd HH:mm:ss');
  const cuentaAnulada = String(filaData[12]) === 'Cancelada';

  // Dinero recibido para una cuenta ya saldada o anulada (p. ej. dos equipos cobraron el mismo
  // fiado sin conexión): no se aplica al saldo, pero se registra para devolverlo o dejarlo a favor
  if (cuentaAnulada || saldoPendiente <= 0) {
    const excedenteTotal = r2(montoAbono);
    historialAbonos.push({
      id_abono: idAbono,
      fecha: fechaAbonoStr,
      monto: 0,
      excedente: excedenteTotal,
      metodo_pago: pago.metodo_pago || 'Efectivo',
      nota: 'Excedente RD$ ' + excedenteTotal.toFixed(2) + ': la cuenta ya estaba ' + (cuentaAnulada ? 'anulada' : 'saldada') +
        '. Devolver al cliente o dejar a favor.'
    });
    cobSheet.getRange(filaEncontrada, 15).setValue(JSON.stringify(historialAbonos));
    return {
      status: 'success',
      id_cobro: pago.id_cobro,
      id_abono: idAbono,
      excedente: excedenteTotal,
      saldo_pendiente_dop: saldoPendiente,
      total_cobrado_dop: totalCobrado,
      estado: String(filaData[12]),
      message: 'La cuenta de ' + filaData[3] + ' ya estaba ' + (cuentaAnulada ? 'anulada' : 'saldada') +
        ': se recibieron RD$ ' + excedenteTotal.toFixed(2) + ' de más. Devuélvelos al cliente o déjalos a favor.'
    };
  }

  const abonoEfectivo = r2(Math.min(montoAbono, saldoPendiente));
  const excedente = r2(montoAbono - abonoEfectivo);
  totalCobrado = r2(totalCobrado + abonoEfectivo);
  saldoPendiente = r2(Math.max(0, totalDop - totalCobrado));

  const ahora = new Date();
  const fechaStr = Utilities.formatDate(ahora, ZONA_HORARIA, 'yyyy-MM-dd HH:mm:ss');
  historialAbonos.push({
    id_abono: idAbono,
    fecha: fechaStr,
    monto: abonoEfectivo,
    excedente: excedente,
    metodo_pago: pago.metodo_pago || 'Efectivo',
    nota: (pago.nota || 'Abono a cuenta') +
      (excedente > 0 ? ' — Excedente RD$ ' + excedente.toFixed(2) + ': devolver al cliente o dejar a favor.' : '')
  });

  let planCuotas = [];
  try {
    if (filaData[15]) planCuotas = JSON.parse(filaData[15]);
  } catch (e) {}

  // Distribuir abono progresivamente entre las cuotas pendientes
  let rem = abonoEfectivo;
  for (let i = 0; i < planCuotas.length; i++) {
    if (planCuotas[i].estado !== 'Cobrada') {
      const montoTotalCuota = parseFloat(planCuotas[i].monto) || 0;
      const yaAbonado = parseFloat(planCuotas[i].monto_abonado) || 0;
      const faltaEnCuota = r2(montoTotalCuota - yaAbonado);

      // Tolerancia de medio centavo para no dejar cuotas "casi pagadas"
      if (rem > 0 && rem >= faltaEnCuota - 0.005) {
        planCuotas[i].monto_abonado = montoTotalCuota;
        planCuotas[i].estado = 'Cobrada';
        planCuotas[i].fecha_pago = fechaStr;
        rem = r2(rem - faltaEnCuota);
      } else if (rem > 0) {
        planCuotas[i].monto_abonado = r2(yaAbonado + rem);
        planCuotas[i].estado = 'Parcial';
        rem = 0;
      }
    }
  }

  let proximoVencimiento = '';
  const primerPendiente = planCuotas.find(c => c.estado !== 'Cobrada');
  if (primerPendiente) {
    proximoVencimiento = primerPendiente.fecha_vencimiento;
  }

  const nuevoEstado = saldoPendiente <= 0 ? 'Saldada' : 'Parcial';

  cobSheet.getRange(filaEncontrada, 9).setValue(totalCobrado);
  cobSheet.getRange(filaEncontrada, 10).setValue(saldoPendiente);
  cobSheet.getRange(filaEncontrada, 13).setValue(nuevoEstado);
  cobSheet.getRange(filaEncontrada, 14).setValue(proximoVencimiento);
  cobSheet.getRange(filaEncontrada, 15).setValue(JSON.stringify(historialAbonos));
  cobSheet.getRange(filaEncontrada, 16).setValue(JSON.stringify(planCuotas));

  if (saldoPendiente <= 0 && filaData[1]) {
    actualizarEstadoVenta(filaData[1], 'Completada');
  }

  return {
    status: 'success',
    message: (saldoPendiente <= 0
      ? '¡Cuenta saldada en su totalidad! Saldo restante: RD$ 0.00'
      : 'Abono de RD$ ' + abonoEfectivo.toFixed(2) + ' registrado. Saldo pendiente: RD$ ' + saldoPendiente.toFixed(2)) +
      (excedente > 0 ? ' Se recibieron RD$ ' + excedente.toFixed(2) + ' de más: devuélvelos al cliente o déjalos a favor.' : ''),
    excedente: excedente,
    id_cobro: pago.id_cobro,
    id_abono: idAbono,
    saldo_pendiente_dop: saldoPendiente,
    total_cobrado_dop: totalCobrado,
    estado: nuevoEstado,
    proximo_vencimiento: proximoVencimiento,
    historial_abonos: historialAbonos,
    plan_cuotas: planCuotas
  };
}

function actualizarEstadoVenta(idVenta, nuevoEstado) {
  try {
    const venSheet = getSheet(SHEETS.VENTAS);
    const data = venSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(idVenta)) {
        venSheet.getRange(i + 1, 14).setValue(nuevoEstado);
        break;
      }
    }
  } catch (e) {
    console.warn('No se pudo actualizar estado en Ventas:', e);
  }
}

function obtenerCobros() {
  const sheet = getSheet(SHEETS.COBROS);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;

    let historialAbonos = [];
    let planCuotas = [];
    try {
      if (row[14]) historialAbonos = JSON.parse(row[14]);
    } catch (e) {}
    try {
      if (row[15]) planCuotas = JSON.parse(row[15]);
    } catch (e) {}

    items.push({
      id_cobro: String(row[0]),
      id_venta: String(row[1] || ''),
      fecha_venta: row[2] ? formatearFecha(row[2]) : '',
      cliente: String(row[3] || ''),
      telefono: String(row[4] || ''),
      articulo: String(row[5] || ''),
      monto_total_dop: Number(row[6]) || 0,
      abono_inicial_dop: Number(row[7]) || 0,
      total_cobrado_dop: Number(row[8]) || 0,
      saldo_pendiente_dop: Number(row[9]) || 0,
      num_cuotas: Number(row[10]) || 1,
      frecuencia: String(row[11] || 'quincenal'),
      estado: String(row[12] || 'Pendiente'),
      proximo_vencimiento: String(row[13] || ''),
      historial_abonos: historialAbonos,
      plan_cuotas: planCuotas,
      excedente_dop: r2(historialAbonos.reduce((t, a) => t + (parseFloat(a && a.excedente) || 0), 0)),
      // Dinero ya cobrado que hay que devolver: abonos de una venta anulada + excedentes
      a_devolver_dop: r2((String(row[12]) === 'Cancelada' ? (Number(row[8]) || 0) : 0) +
        historialAbonos.reduce((t, a) => t + (parseFloat(a && a.excedente) || 0), 0))
    });
  }
  return items.reverse();
}

function cancelarVenta(idVenta) {
  if (!idVenta) return { status: 'error', message: 'ID de venta requerido' };

  const venSheet = getSheet(SHEETS.VENTAS);
  const data = venSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(idVenta)) {
      if (data[i][13] === 'Cancelada') {
        return { status: 'success', duplicado: true, message: 'La venta ' + idVenta + ' ya se encontraba cancelada' };
      }

      const idProd = String(data[i][2]);
      const cantRestituir = parseInt(data[i][5]) || 0;

      // Restituir stock en inventario (si el producto fue eliminado, la venta se anula igual sin revivirlo)
      const resStock = ajustarStockProducto(idProd, cantRestituir, 'Anulación de venta ' + idVenta, 'ANULACION', idVenta);

      // Marcar estado cancelada en Ventas
      venSheet.getRange(i + 1, 14).setValue('Cancelada');

      // A2 FIX: Si la venta era a crédito, anular también la cuenta por cobrar en COBROS
      let avisoDevolucion = '';
      try {
        const cobSheet = getSheet(SHEETS.COBROS);
        const cobData = cobSheet.getDataRange().getValues();
        for (let c = 1; c < cobData.length; c++) {
          if (String(cobData[c][1]) === String(idVenta)) {
            cobSheet.getRange(c + 1, 10).setValue(0); // Saldo pendiente = 0
            cobSheet.getRange(c + 1, 13).setValue('Cancelada'); // Estado = Cancelada
            const cobrado = r2(parseFloat(cobData[c][8]) || 0);
            if (cobrado > 0) {
              let hist = [];
              try { hist = JSON.parse(cobData[c][14] || '[]') || []; } catch (e) {}
              hist.push({
                id_abono: generarId('ANU'),
                fecha: Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd HH:mm:ss'),
                monto: 0,
                a_devolver: cobrado,
                metodo_pago: '',
                nota: 'Venta anulada con RD$ ' + cobrado.toFixed(2) + ' ya abonados: devolver al cliente.'
              });
              cobSheet.getRange(c + 1, 15).setValue(JSON.stringify(hist));
              avisoDevolucion = ' El cliente había abonado RD$ ' + cobrado.toFixed(2) + ': hay que devolvérselos.';
            }
            break;
          }
        }
      } catch (cobErr) {
        console.warn('Error cancelando cobro en COBROS:', cobErr);
      }

      return {
        status: 'success',
        message: (resStock.status === 'success'
          ? 'Venta ' + idVenta + ' cancelada, stock repuesto y cuenta por cobrar anulada.'
          : 'Venta ' + idVenta + ' cancelada. ' + resStock.message) + avisoDevolucion
      };
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

  const idRecepcionCliente = String(rec.id_recepcion || '').trim();
  if (idRecepcionCliente && existeIdEnHoja(getSheet(SHEETS.RECEPCIONES), idRecepcionCliente)) {
    return {
      status: 'success',
      duplicado: true,
      id_recepcion: idRecepcionCliente,
      message: 'El tanque ' + idRecepcionCliente + ' ya estaba registrado.'
    };
  }

  const ahora = new Date();
  const idRecepcion = String(rec.id_recepcion || '').trim() || generarId('TANQ');
  const nombreTanque = String(rec.nombre_tanque || 'Tanque Importado de EE.UU.').replace(/\s+/g, ' ').trim();
  const origen = String(rec.origen || 'Miami, FL - EE.UU.').trim();
  const fleteUsd = parseFloat(rec.flete_usd) || 0;
  const tasaCambio = parseFloat(rec.tasa_cambio) || ((typeof obtenerConfiguracion === 'function') ? (parseFloat(obtenerConfiguracion().TASA_CAMBIO_USD_DOP) || 60.50) : 60.50);
  const notas = String(rec.notas || '').trim();

  let totalUnidades = 0;
  rec.articulos.forEach(art => {
    const c = parseInt(art.cantidad) || 0;
    if (c > 0) totalUnidades += c;
  });

  const norm = normalizarNombre;

  // Flete prorrateado en el costo unitario (Configuracion › PRORRATEAR_FLETE = SI)
  const prorratearFlete = String(obtenerConfiguracion().PRORRATEAR_FLETE || 'NO').trim().toUpperCase() === 'SI';
  const fletePorUnidadUsd = (prorratearFlete && totalUnidades > 0) ? fleteUsd / totalUnidades : 0;

  // Guardar cada artículo en Inventario (sumando acumulativamente al stock existente)
  const invSheet = getSheet(SHEETS.INVENTARIO);
  const invData = invSheet.getDataRange().getValues();

  // Mapa de búsqueda rápida por ID y nombre normalizado (solo productos activos:
  // un producto eliminado nunca se revive al recibir un tanque)
  const idMap = new Map();
  const nomMap = new Map();
  const todosLosIds = new Set();
  const movimientos = [];

  for (let i = 1; i < invData.length; i++) {
    const rowId = String(invData[i][0] || '').trim();
    if (rowId) todosLosIds.add(rowId);
    if (String(invData[i][10]) === 'Eliminado') continue;
    const rowNom = norm(invData[i][1]);
    if (rowId) idMap.set(rowId, i);
    if (rowNom && !nomMap.has(rowNom)) nomMap.set(rowNom, i);
  }

  rec.articulos.forEach(art => {
    const cant = parseInt(art.cantidad) || 0;
    if (cant <= 0) return;

    let costoUsd = Math.max(0, parseFloat(art.costo_usd) || 0);
    let costoDop = Math.max(0, parseFloat(art.costo_dop) || (costoUsd * tasaCambio));
    if (fletePorUnidadUsd > 0) {
      costoUsd = r2(costoUsd + fletePorUnidadUsd);
      costoDop = r2(costoDop + fletePorUnidadUsd * tasaCambio);
    }
    const precioVentaDop = Math.max(0, parseFloat(art.precio_venta_dop) || 0);
    const artIdOriginal = String(art.id || '').trim();
    const artId = artIdOriginal ? resolverIdProducto(artIdOriginal) : '';
    const artNom = norm(art.nombre);

    let rowIdx = -1;
    if (artId && idMap.has(artId)) {
      rowIdx = idMap.get(artId);
    } else if (artNom && nomMap.has(artNom)) {
      rowIdx = nomMap.get(artNom);
      // El dispositivo creó este producto con su propio ID: las ventas que haga con ese ID
      // deben aplicarse al producto real
      if (artIdOriginal && !todosLosIds.has(artIdOriginal)) {
        registrarAlias(artIdOriginal, invData[rowIdx][0], 'Tanque ' + idRecepcion + ': unido por nombre con "' + invData[rowIdx][1] + '"');
      }
    }

    if (rowIdx > 0) {
      art.id = String(invData[rowIdx][0]);
      // PRODUCTO EXISTENTE: SUMAR EXISTENCIA ACUMULATIVAMENTE (NUNCA SOBREESCRIBIR)
      const stockAnterior = parseInt(invData[rowIdx][4]) || 0;
      const nuevoStock = stockAnterior + cant;
      const stockMin = stockMinimoDe(invData[rowIdx][5]);
      const nuevoEstado = nuevoStock === 0 ? 'Agotado' : (nuevoStock <= stockMin ? 'Stock Bajo' : 'En Stock');

      invData[rowIdx][4] = nuevoStock;
      invData[rowIdx][5] = stockMin;
      if (costoUsd > 0) invData[rowIdx][6] = costoUsd;
      if (costoDop > 0) invData[rowIdx][7] = costoDop;
      if (precioVentaDop > 0) invData[rowIdx][8] = precioVentaDop;
      invData[rowIdx][9] = nombreTanque;
      invData[rowIdx][10] = nuevoEstado;
      invData[rowIdx][12] = ahora;
      movimientos.push({
        id: invData[rowIdx][0], nombre: invData[rowIdx][1], tipo: 'RECEPCION', delta: cant, stock: nuevoStock,
        referencia: idRecepcion, detalle: nombreTanque
      });
    } else {
      // PRODUCTO NUEVO: REGISTRAR EN INVENTARIO
      // (si el ID enviado pertenece a un producto eliminado, se genera uno nuevo para no duplicar IDs)
      const nuevoId = (artId && !todosLosIds.has(artId)) ? artId : generarId('PROD');
      art.id = nuevoId;
      todosLosIds.add(nuevoId);
      const estado = cant === 0 ? 'Agotado' : (cant <= 3 ? 'Stock Bajo' : 'En Stock');
      const newRowIdx = invData.length;
      invData.push([
        nuevoId,
        String(art.nombre || '').trim(),
        art.categoria || 'Variedades',
        'Tanque: ' + nombreTanque,
        cant,
        3,
        costoUsd,
        costoDop,
        // Sin precio indicado: precio sugerido costo × 1.5 (igual que el frontend) para no vender a RD$ 0
        precioVentaDop > 0 ? precioVentaDop : r2(costoDop * 1.5),
        nombreTanque,
        estado,
        ahora,
        ahora
      ]);
      idMap.set(nuevoId, newRowIdx);
      if (artNom) nomMap.set(artNom, newRowIdx);
      movimientos.push({
        id: nuevoId, nombre: art.nombre, tipo: 'RECEPCION', delta: cant, stock: cant,
        referencia: idRecepcion, detalle: nombreTanque + ' (producto nuevo)'
      });
    }
  });

  // ESCRITURA EN UN SOLO BLOQUE ATÓMICO (ultra rápido y sin timeouts)
  invSheet.getRange(1, 1, invData.length, 13).setValues(invData);
  estilarCabecera(invSheet, 13, '#0B132B', '#D4AF37');
  invSheet.setFrozenRows(1);

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
  registrarMovimientos(movimientos);

  return {
    status: 'success',
    message: 'Tanque registrado exitosamente: ' + totalUnidades + ' unidades ingresadas y acumuladas al inventario.',
    id_recepcion: idRecepcion,
    totalUnidades: totalUnidades,
    total_unidades: totalUnidades
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

function calcularMetricasGenerales(inventarioLeido, ventasLeidas, cobrosLeidos) {
  const inventario = inventarioLeido || obtenerInventario();
  const ventas = ventasLeidas || obtenerVentas();

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

  const hoyStr = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  const mesStr = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM');

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

  const cobros = cobrosLeidos || obtenerCobros();
  let totalPorCobrarDop = 0;
  let cuotasPendientesHoy = 0;
  let clientesConDeuda = 0;

  cobros.forEach(c => {
    if (c.estado !== 'Saldada' && c.estado !== 'Cancelada') {
      totalPorCobrarDop += (c.saldo_pendiente_dop || 0);
      clientesConDeuda++;
      if (c.proximo_vencimiento && c.proximo_vencimiento <= hoyStr) {
        cuotasPendientesHoy++;
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
    ganancia_mes_dop: Math.round(gananciaMesDop),
    total_por_cobrar_dop: Math.round(totalPorCobrarDop),
    cuotas_pendientes_hoy: cuotasPendientesHoy,
    clientes_con_deuda: clientesConDeuda
  };
}

function obtenerConfiguracion() {
  const sheet = getSheet(SHEETS.CONFIGURACION);
  const rows = sheet.getDataRange().getValues();
  const cfg = {
    NOMBRE_NEGOCIO: 'Thor Essence',
    MONEDA_PRINCIPAL: 'DOP',
    TASA_CAMBIO_USD_DOP: 60.50,
    CATEGORIAS: 'Perfumes, Splash, Cremas, Body Wash, Accesorios, Maquillaje, Variedades',
    PRORRATEAR_FLETE: 'NO'
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
    // Credenciales y sesiones solo se gestionan desde el menú de administración de la hoja
    if (/^(AUTH_|SESSION_|MASTER_SERVICE_KEY$)/.test(key)) {
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

    // Thor Essence: Las hojas inician completamente en blanco para Pamela (0 datos demo)
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
      ['PRORRATEAR_FLETE', 'NO']
    ];
    cfgSheet.getRange(2, 1, defaultValues.length, 2).setValues(defaultValues);
  }

  let cobSheet = ss.getSheetByName(SHEETS.COBROS);
  if (!cobSheet || forzar) {
    if (!cobSheet) cobSheet = ss.insertSheet(SHEETS.COBROS);
    const cabecerasCob = [
      ['ID Cobro', 'ID Venta', 'Fecha Venta', 'Cliente', 'Teléfono WhatsApp', 'Artículo', 'Monto Total DOP', 'Abono Inicial DOP', 'Total Cobrado DOP', 'Saldo Pendiente DOP', 'Num Cuotas', 'Frecuencia', 'Estado', 'Próximo Vencimiento', 'Historial Abonos (JSON)', 'Plan Cuotas (JSON)']
    ];
    cobSheet.getRange(1, 1, 1, cabecerasCob[0].length).setValues(cabecerasCob);
    estilarCabecera(cobSheet, cabecerasCob[0].length, '#0B132B', '#D4AF37');
    cobSheet.setFrozenRows(1);
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
    return Utilities.formatDate(new Date(dateObj), ZONA_HORARIA, 'yyyy-MM-dd HH:mm:ss');
  } catch (e) {
    return String(dateObj);
  }
}

function jsonResponse(data, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function purgarTodasLasHojas(confirmacion) {
  if (confirmacion !== 'CONFIRMAR_PURGA_TOTAL_THOR') {
    return { status: 'error', message: 'Acción rechazada: código de confirmación requerido para purgar todas las hojas.' };
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetsToPurge = [SHEETS.INVENTARIO, SHEETS.VENTAS, SHEETS.RECEPCIONES, SHEETS.COBROS, 'AJUSTES'];
  sheetsToPurge.forEach(name => {
    const s = ss.getSheetByName(name);
    if (s && s.getLastRow() > 1) {
      s.deleteRows(2, s.getLastRow() - 1);
    }
  });
  // El kardex y el diagnóstico se regeneran desde cero
  [HOJA_MOVIMIENTOS, HOJA_DIAGNOSTICO, HOJA_ALIAS].forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) ss.deleteSheet(s);
  });
  return { status: 'success', message: 'Todas las tablas de datos han sido limpiadas a 0 en Google Sheets.' };
}

/**
 * =========================================================================
 * KARDEX: REGISTRO DE MOVIMIENTOS DE INVENTARIO
 * =========================================================================
 * Cada cambio de stock queda en la hoja "Movimientos" con su tipo, cantidad (+/-),
 * stock resultante y referencia (venta, tanque…). Al crear la hoja se registra el
 * SALDO_INICIAL de cada producto, de modo que la suma de los movimientos de un
 * producto debe ser siempre igual a su stock en Inventario.
 */
const HOJA_MOVIMIENTOS = 'Movimientos';

/**
 * Stock mínimo de una fila: acepta 0; vacío o inválido → 3.
 */
function stockMinimoDe(valor) {
  const n = parseInt(valor);
  return (isNaN(n) || n < 0) ? 3 : n;
}

function estadoPorStock(cantidad, stockMin) {
  return cantidad <= 0 ? 'Agotado' : (cantidad <= stockMin ? 'Stock Bajo' : 'En Stock');
}

function hojaMovimientos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(HOJA_MOVIMIENTOS);
  if (sheet) return sheet;

  sheet = ss.insertSheet(HOJA_MOVIMIENTOS);
  sheet.getRange(1, 1, 1, 9).setValues([[
    'ID Movimiento', 'Fecha', 'ID Producto', 'Producto', 'Tipo', 'Cantidad (+/-)', 'Stock Resultante', 'Referencia', 'Detalle'
  ]]);
  estilarCabecera(sheet, 9, '#0B132B', '#D4AF37');
  sheet.setFrozenRows(1);

  const inv = getSheet(SHEETS.INVENTARIO).getDataRange().getValues();
  const ahora = new Date();
  const filas = [];
  for (let i = 1; i < inv.length; i++) {
    const id = String(inv[i][0] || '').trim();
    if (!id || String(inv[i][10]) === 'Eliminado') continue;
    const cant = parseInt(inv[i][4]) || 0;
    filas.push([generarId('MOV'), ahora, id, String(inv[i][1] || ''), 'SALDO_INICIAL', cant, cant, '', 'Stock existente al activar el registro de movimientos']);
  }
  if (filas.length) sheet.getRange(2, 1, filas.length, 9).setValues(filas);
  return sheet;
}

/**
 * movimientos: [{ id, nombre, tipo, delta, stock, referencia, detalle }]
 * Se escriben en un solo bloque. Los movimientos con delta 0 se omiten.
 */
function registrarMovimientos(movimientos) {
  const lista = (movimientos || []).filter(m => m && (parseInt(m.delta) || 0) !== 0);
  if (!lista.length) return;
  const sheet = hojaMovimientos();
  const ahora = new Date();
  const filas = lista.map(m => [
    generarId('MOV'), ahora, String(m.id), String(m.nombre || ''), m.tipo,
    parseInt(m.delta) || 0, parseInt(m.stock) || 0, String(m.referencia || ''), String(m.detalle || '')
  ]);
  sheet.getRange(sheet.getLastRow() + 1, 1, filas.length, 9).setValues(filas);
}

/**
 * =========================================================================
 * DIAGNÓSTICO Y CORRECCIÓN DE INVENTARIO
 * =========================================================================
 * Reemplaza la antigua "conciliación automática", que podía duplicar productos
 * (recreaba los eliminados o renombrados) e inflar el stock. El diagnóstico NO
 * modifica el inventario: genera la hoja "Diagnóstico Inventario" con propuestas,
 * y solo se aplican las filas que el administrador marca.
 *
 * Stock justificado de un producto (o grupo de duplicados) =
 *     recibido en tanques (sin contar tanques registrados dos veces)
 *   − vendido (ventas no anuladas, por ID de producto)
 *   + ajustes manuales (hoja AJUSTES histórica, sin anulaciones; y movimientos ALTA/AJUSTE/EDICION)
 */
const HOJA_DIAGNOSTICO = 'Diagnóstico Inventario';
const VENTANA_TANQUE_DUPLICADO_MS = 30 * 60 * 1000;
const COLUMNAS_DIAGNOSTICO = [
  'Aplicar', 'Tipo', 'ID', 'Nombre', 'Grupo (ID principal)', 'Stock actual', 'Recibido en tanques',
  'Vendido', 'Ajustes', 'Stock justificado', 'Diferencia', 'Confianza', 'Acción propuesta', 'Nuevo stock', 'Explicación'
];

/**
 * Nombre comparable: sin acentos, sin espacios repetidos y en minúsculas.
 * "Crema  Coco", "crema coco" y "Créma Coco" son el mismo producto.
 */
function normalizarNombre(str) {
  return String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function diagnosticarInventario(escribirHoja) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const norm = normalizarNombre;

  // 1. Productos activos
  const inv = getSheet(SHEETS.INVENTARIO).getDataRange().getValues();
  const productos = new Map();
  for (let i = 1; i < inv.length; i++) {
    const id = String(inv[i][0] || '').trim();
    if (!id || String(inv[i][10]) === 'Eliminado') continue;
    const fecha = inv[i][11] ? new Date(inv[i][11]).getTime() : NaN;
    productos.set(id, {
      id: id,
      nombre: String(inv[i][1] || ''),
      clave: norm(inv[i][1]),
      stock: parseInt(inv[i][4]) || 0,
      fechaIngreso: isNaN(fecha) ? Number.MAX_SAFE_INTEGER : fecha,
      restaurado: id.indexOf('PROD-REST-') === 0,
      creadoPorTanque: String(inv[i][3] || '').indexOf('Tanque:') === 0,
      vendido: 0,
      ajustes: 0,
      tieneAlta: false,
      kardex: null
    });
  }

  // 2. Alias: nombres con los que se conoce cada producto (actual, ventas y tanques con ID)
  const alias = new Map();
  const agregarAlias = (nombre, id) => {
    const k = norm(nombre);
    if (!k || !productos.has(id)) return;
    if (!alias.has(k)) alias.set(k, new Set());
    alias.get(k).add(id);
  };
  productos.forEach(p => agregarAlias(p.nombre, p.id));

  // 3. Ventas (por ID de producto)
  const ven = getSheet(SHEETS.VENTAS).getDataRange().getValues();
  for (let i = 1; i < ven.length; i++) {
    const idProd = String(ven[i][2] || '').trim();
    if (!ven[i][0] || !productos.has(idProd)) continue;
    agregarAlias(ven[i][3], idProd);
    if (String(ven[i][13]) !== 'Cancelada') {
      productos.get(idProd).vendido += parseInt(ven[i][5]) || 0;
    }
  }

  // 4. Recepciones y tanques registrados dos veces
  const recData = getSheet(SHEETS.RECEPCIONES).getDataRange().getValues();
  const recepciones = [];
  for (let i = 1; i < recData.length; i++) {
    if (!recData[i][0]) continue;
    let articulos = [];
    try { articulos = JSON.parse(recData[i][8] || '[]') || []; } catch (e) {}
    const firma = norm(recData[i][2]) + '|' + articulos
      .map(a => norm(a.nombre) + ':' + (parseInt(a.cantidad) || 0))
      .sort()
      .join(';');
    const fecha = recData[i][1] ? new Date(recData[i][1]).getTime() : 0;
    recepciones.push({ id: String(recData[i][0]), fecha: fecha, tanque: String(recData[i][2] || ''), total: parseInt(recData[i][4]) || 0, articulos: articulos, firma: firma, duplicadaDe: null });
    articulos.forEach(a => {
      const idResuelto = a && a.id ? resolverIdProducto(a.id) : '';
      if (idResuelto && productos.has(idResuelto)) agregarAlias(a.nombre, idResuelto);
    });
  }
  recepciones.sort((a, b) => a.fecha - b.fecha);
  const ultimaPorFirma = new Map();
  recepciones.forEach(r => {
    const previa = ultimaPorFirma.get(r.firma);
    if (previa && r.articulos.length && (r.fecha - previa.fecha) <= VENTANA_TANQUE_DUPLICADO_MS) {
      r.duplicadaDe = previa.id;
    } else {
      ultimaPorFirma.set(r.firma, r);
    }
  });

  // 5. Grupos de duplicados: productos que comparten algún nombre (actual o histórico)
  const padre = new Map();
  const raiz = id => {
    while (padre.get(id) !== id) {
      padre.set(id, padre.get(padre.get(id)));
      id = padre.get(id);
    }
    return id;
  };
  productos.forEach((p, id) => padre.set(id, id));
  alias.forEach(ids => {
    const lista = Array.from(ids);
    for (let i = 1; i < lista.length; i++) padre.set(raiz(lista[i]), raiz(lista[0]));
  });

  const grupos = new Map();
  productos.forEach((p, id) => {
    const r = raiz(id);
    if (!grupos.has(r)) grupos.set(r, { miembros: [], recibido: 0 });
    grupos.get(r).miembros.push(p);
  });
  const grupoDe = id => grupos.get(raiz(id));

  // 6. Unidades recibidas por grupo (tanques no duplicados)
  const sinProducto = new Map();
  recepciones.forEach(r => {
    if (r.duplicadaDe) return;
    r.articulos.forEach(a => {
      const cant = parseInt(a && a.cantidad) || 0;
      if (cant <= 0) return;
      const idResuelto = a.id ? resolverIdProducto(a.id) : '';
      let idProd = idResuelto && productos.has(idResuelto) ? idResuelto : null;
      if (!idProd) {
        const ids = alias.get(norm(a.nombre));
        if (ids && ids.size) idProd = Array.from(ids)[0];
      }
      if (idProd) {
        grupoDe(idProd).recibido += cant;
      } else {
        const k = norm(a.nombre);
        sinProducto.set(k, { nombre: a.nombre, cantidad: ((sinProducto.get(k) || {}).cantidad || 0) + cant });
      }
    });
  });

  // 7. Ajustes históricos (hoja AJUSTES; las anulaciones ya están fuera de "vendido")
  const ajSheet = ss.getSheetByName('AJUSTES');
  if (ajSheet) {
    const aj = ajSheet.getDataRange().getValues();
    for (let i = 1; i < aj.length; i++) {
      const idProd = String(aj[i][1] || '').trim();
      if (!productos.has(idProd)) continue;
      if (/^(Cancelación|Anulación) de venta/i.test(String(aj[i][6] || ''))) continue;
      productos.get(idProd).ajustes += parseInt(aj[i][4]) || 0;
    }
  }

  // 8. Movimientos del kardex: ajustes nuevos y cuadre por producto
  const movSheet = ss.getSheetByName(HOJA_MOVIMIENTOS);
  if (movSheet) {
    const mov = movSheet.getDataRange().getValues();
    for (let i = 1; i < mov.length; i++) {
      const idProd = String(mov[i][2] || '').trim();
      const p = productos.get(idProd);
      if (!p) continue;
      const tipo = String(mov[i][4]);
      const delta = parseInt(mov[i][5]) || 0;
      if (tipo === 'ALTA' || tipo === 'AJUSTE' || tipo === 'EDICION') p.ajustes += delta;
      if (tipo === 'ALTA') p.tieneAlta = true;
      p.kardex = (p.kardex || 0) + delta;
    }
  }

  // 9. Filas del diagnóstico
  const filas = [];
  const resumen = {
    productos: productos.size,
    grupos_duplicados: 0,
    productos_duplicados: 0,
    productos_con_exceso: 0,
    unidades_de_mas: 0,
    recepciones_duplicadas: 0,
    diferencias_kardex: 0
  };

  recepciones.filter(r => r.duplicadaDe).forEach(r => {
    resumen.recepciones_duplicadas++;
    filas.push({
      prioridad: 0,
      valores: [false, 'TANQUE DUPLICADO', r.id, r.tanque, r.duplicadaDe, '', r.total, '', '', '', '', 'Alta',
        'ELIMINAR_RECEPCION_DUPLICADA', '',
        'Mismo tanque y mismos artículos que ' + r.duplicadaDe + ' registrados con menos de 30 min de diferencia. ' +
        'Solo borra el registro repetido; el stock de más se corrige con las filas de productos.']
    });
  });

  grupos.forEach(g => {
    const miembros = g.miembros.slice().sort((a, b) =>
      (a.restaurado - b.restaurado) || (a.fechaIngreso - b.fechaIngreso) || (b.vendido - a.vendido));
    const principal = miembros[0];
    const actual = miembros.reduce((t, p) => t + p.stock, 0);
    const vendido = miembros.reduce((t, p) => t + p.vendido, 0);
    const ajustes = miembros.reduce((t, p) => t + p.ajustes, 0);
    const tieneAlta = miembros.some(p => p.tieneAlta);
    const verificable = g.recibido > 0 || tieneAlta;
    const justificado = g.recibido - vendido + ajustes;
    const diferencia = actual - justificado;
    const confianza = !verificable ? 'No verificable'
      : (miembros.some(p => !p.creadoPorTanque) && !tieneAlta ? 'Revisar' : 'Alta');
    const notaManual = confianza === 'Revisar'
      ? ' El producto se creó a mano antes de activar el registro de movimientos: si tenía stock inicial, súmalo en "Nuevo stock".'
      : '';
    const notaKardex = p => (p.kardex !== null && p.kardex !== p.stock)
      ? ' | Movimientos suman ' + p.kardex + ' pero el inventario dice ' + p.stock + ' (¿edición directa en la hoja?).'
      : '';
    miembros.forEach(p => { if (p.kardex !== null && p.kardex !== p.stock) resumen.diferencias_kardex++; });

    const filaGrupo = (accion, nuevo, explicacion, prioridad) => ({
      prioridad: prioridad,
      valores: [false, 'PRODUCTO', principal.id, principal.nombre, principal.id, principal.stock,
        g.recibido, vendido, ajustes, verificable ? justificado : '', verificable ? diferencia : '',
        confianza, accion, nuevo, explicacion + notaManual + notaKardex(principal)]
    });

    if (miembros.length > 1) {
      resumen.grupos_duplicados++;
      resumen.productos_duplicados += miembros.length - 1;
      const nuevo = verificable ? Math.max(0, justificado) : actual;
      if (verificable && diferencia > 0) resumen.unidades_de_mas += diferencia;
      filas.push(filaGrupo('AJUSTAR_STOCK', nuevo,
        'Producto principal de un grupo de ' + miembros.length + ' registros con el mismo nombre. Stock total del grupo: ' +
        actual + (verificable ? ' (justificado: ' + justificado + ')' : '') + '. Quedará con ' + nuevo + ' unidades.', 1));
      miembros.slice(1).forEach(p => {
        filas.push({
          prioridad: 1,
          valores: [false, 'PRODUCTO', p.id, p.nombre, principal.id, p.stock, '', p.vendido, p.ajustes, '', '',
            confianza, 'ELIMINAR_DUPLICADO', 0,
            (p.restaurado ? 'Copia creada por la antigua conciliación automática' : 'Registro repetido') +
            ' de "' + principal.nombre + '". Se da de baja; sus ventas se conservan en el historial.' + notaKardex(p)]
        });
      });
      return;
    }

    if (verificable && diferencia > 0) {
      resumen.productos_con_exceso++;
      resumen.unidades_de_mas += diferencia;
      filas.push(filaGrupo('AJUSTAR_STOCK', Math.max(0, justificado),
        'Hay ' + diferencia + ' unidad(es) más de lo que justifican tanques, ventas y ajustes registrados. ' +
        'Si antes de esta versión cambiaste la cantidad en el formulario del producto, ese cambio no quedó registrado: verifica el conteo físico.', 2));
    } else {
      filas.push(filaGrupo('', '',
        !verificable ? 'Sin tanques ni alta registrada: no se puede verificar.'
          : (diferencia < 0 ? 'Hay ' + (-diferencia) + ' unidad(es) menos de lo esperado (ventas o mermas no registradas). No se propone subir stock.'
            : 'Correcto.'), 3));
    }
  });

  sinProducto.forEach(info => {
    filas.push({
      prioridad: 4,
      valores: [false, 'RECIBIDO SIN PRODUCTO', '', info.nombre, '', '', info.cantidad, '', '', '', '', '', '', '',
        'Artículo recibido en tanques que no corresponde a ningún producto activo (probablemente eliminado).']
    });
  });

  filas.sort((a, b) => a.prioridad - b.prioridad);
  const valores = filas.map(f => f.valores);
  if (escribirHoja) escribirHojaDiagnostico(valores);

  const hallazgos = resumen.productos_duplicados + resumen.productos_con_exceso + resumen.recepciones_duplicadas;
  return {
    status: 'success',
    resumen: resumen,
    filas: valores,
    message: hallazgos === 0
      ? 'Inventario sin duplicados ni excesos detectados (' + resumen.productos + ' productos revisados).'
      : 'Se detectaron ' + resumen.productos_duplicados + ' producto(s) duplicado(s), ' +
        resumen.productos_con_exceso + ' producto(s) con stock de más, ' +
        resumen.recepciones_duplicadas + ' tanque(s) registrados dos veces y ' +
        resumen.unidades_de_mas + ' unidad(es) por encima de lo justificado. ' +
        'El administrador puede revisarlo en la hoja "' + HOJA_DIAGNOSTICO + '".'
  };
}

function escribirHojaDiagnostico(valores) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(HOJA_DIAGNOSTICO);
  if (!sheet) sheet = ss.insertSheet(HOJA_DIAGNOSTICO);
  sheet.clear();
  sheet.getRange(1, 1, 1, COLUMNAS_DIAGNOSTICO.length).setValues([COLUMNAS_DIAGNOSTICO]);
  estilarCabecera(sheet, COLUMNAS_DIAGNOSTICO.length, '#0B132B', '#D4AF37');
  sheet.setFrozenRows(1);
  if (!valores.length) return sheet;

  sheet.getRange(2, 1, valores.length, COLUMNAS_DIAGNOSTICO.length).setValues(valores);
  // Casillas solo en las filas con acción propuesta (están ordenadas primero)
  const conAccion = valores.filter(v => v[12]).length;
  if (conAccion) sheet.getRange(2, 1, conAccion, 1).insertCheckboxes();
  return sheet;
}

/**
 * Aplica las filas marcadas en la hoja de diagnóstico. Crea antes un respaldo en Drive.
 * Una fila de producto se omite si su stock cambió desde el diagnóstico (p. ej. hubo una venta).
 */
function aplicarCorreccionesMarcadas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(HOJA_DIAGNOSTICO);
  if (!hoja) return { status: 'error', message: 'Primero ejecuta "🔍 Diagnosticar Inventario".' };

  const marcadas = hoja.getDataRange().getValues().slice(1).filter(f => f[0] === true && f[12]);
  if (!marcadas.length) return { status: 'error', message: 'No hay filas marcadas en la columna "Aplicar".' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { status: 'error', message: 'El sistema está procesando otra operación. Inténtalo de nuevo en unos segundos.' };
  }

  try {
    hojaMovimientos();
    try {
      crearRespaldoEnDrive();
    } catch (e) {
      return { status: 'error', message: 'No se pudo crear el respaldo en Drive; no se aplicó ningún cambio. ' + e };
    }

    const invSheet = getSheet(SHEETS.INVENTARIO);
    const inv = invSheet.getDataRange().getValues();
    const filaPorId = new Map();
    for (let i = 1; i < inv.length; i++) {
      if (inv[i][0]) filaPorId.set(String(inv[i][0]).trim(), i);
    }

    const ahora = new Date();
    const movimientos = [];
    const recepcionesABorrar = [];
    const avisos = [];
    let aplicadas = 0;

    marcadas.forEach(f => {
      const accion = String(f[12]);
      const id = String(f[2]).trim();

      if (accion === 'ELIMINAR_RECEPCION_DUPLICADA') {
        recepcionesABorrar.push(id);
        return;
      }

      const idx = filaPorId.get(id);
      if (idx === undefined || String(inv[idx][10]) === 'Eliminado') {
        avisos.push(id + ': ya no está activo');
        return;
      }
      const stockActual = parseInt(inv[idx][4]) || 0;
      if (f[5] !== '' && stockActual !== (parseInt(f[5]) || 0)) {
        avisos.push(id + ': su stock cambió desde el diagnóstico (' + f[5] + ' → ' + stockActual + '); vuelve a diagnosticar');
        return;
      }

      if (accion === 'ELIMINAR_DUPLICADO') {
        inv[idx][4] = 0;
        inv[idx][10] = 'Eliminado';
        inv[idx][12] = ahora;
        movimientos.push({ id: id, nombre: inv[idx][1], tipo: 'ELIMINACION', delta: -stockActual, stock: 0,
          referencia: String(f[4]), detalle: 'Duplicado eliminado desde el diagnóstico (principal: ' + f[4] + ')' });
        aplicadas++;
      } else if (accion === 'AJUSTAR_STOCK') {
        const nuevo = parseInt(f[13]);
        if (isNaN(nuevo) || nuevo < 0) {
          avisos.push(id + ': "Nuevo stock" inválido');
          return;
        }
        inv[idx][4] = nuevo;
        inv[idx][10] = estadoPorStock(nuevo, stockMinimoDe(inv[idx][5]));
        inv[idx][12] = ahora;
        movimientos.push({ id: id, nombre: inv[idx][1], tipo: 'CORRECCION', delta: nuevo - stockActual, stock: nuevo,
          detalle: 'Corrección desde el diagnóstico de inventario' });
        aplicadas++;
      } else {
        avisos.push(id + ': acción desconocida "' + accion + '"');
      }
    });

    if (inv.length > 1) invSheet.getRange(1, 1, inv.length, 13).setValues(inv);
    registrarMovimientos(movimientos);

    if (recepcionesABorrar.length) {
      const recSheet = getSheet(SHEETS.RECEPCIONES);
      const rec = recSheet.getDataRange().getValues();
      const borrar = new Set(recepcionesABorrar);
      for (let i = rec.length - 1; i >= 1; i--) {
        if (borrar.has(String(rec[i][0]).trim())) {
          recSheet.deleteRow(i + 1);
          aplicadas++;
        }
      }
    }

    const despues = diagnosticarInventario(true);
    return {
      status: 'success',
      aplicadas: aplicadas,
      avisos: avisos,
      message: 'Se aplicaron ' + aplicadas + ' corrección(es). Se creó un respaldo en Drive antes de los cambios.' +
        (avisos.length ? '\n\nOmitidas:\n- ' + avisos.join('\n- ') : '') +
        '\n\nNuevo diagnóstico: ' + despues.message
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Elimina una recepción de tanque y descuenta del inventario las unidades que ingresó.
 * Si parte de esas unidades ya se vendió, el stock queda en 0 y se informa el faltante.
 */
function eliminarRecepcion(idRecepcion) {
  if (!idRecepcion) return { status: 'error', message: 'ID de recepción requerido' };
  const recSheet = getSheet(SHEETS.RECEPCIONES);
  const rows = recSheet.getDataRange().getValues();
  let filaRec = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(idRecepcion).trim()) {
      filaRec = i;
      break;
    }
  }
  if (filaRec < 0) return { status: 'error', message: 'Recepción no encontrada: ' + idRecepcion };

  let articulos = [];
  try { articulos = JSON.parse(rows[filaRec][8] || '[]') || []; } catch (e) {}

  const invSheet = getSheet(SHEETS.INVENTARIO);
  const inv = invSheet.getDataRange().getValues();
  const idMap = new Map();
  const nomMap = new Map();
  for (let i = 1; i < inv.length; i++) {
    if (String(inv[i][10]) === 'Eliminado') continue;
    const id = String(inv[i][0] || '').trim();
    if (id) idMap.set(id, i);
    const k = normalizarNombre(inv[i][1]);
    if (k && !nomMap.has(k)) nomMap.set(k, i);
  }

  const ahora = new Date();
  const movimientos = [];
  const faltantes = [];
  articulos.forEach(a => {
    const cant = parseInt(a && a.cantidad) || 0;
    if (cant <= 0) return;
    const idReal = a.id ? resolverIdProducto(a.id) : '';
    const idx = (idReal && idMap.has(idReal)) ? idMap.get(idReal) : nomMap.get(normalizarNombre(a.nombre));
    if (idx === undefined) {
      faltantes.push(a.nombre + ': producto no activo (' + cant + ' u.)');
      return;
    }
    const actual = parseInt(inv[idx][4]) || 0;
    const quitar = Math.min(actual, cant);
    if (quitar < cant) faltantes.push(inv[idx][1] + ': solo había ' + actual + ' de ' + cant + ' u.');
    const nuevo = actual - quitar;
    inv[idx][4] = nuevo;
    inv[idx][10] = estadoPorStock(nuevo, stockMinimoDe(inv[idx][5]));
    inv[idx][12] = ahora;
    movimientos.push({ id: inv[idx][0], nombre: inv[idx][1], tipo: 'REVERSION_RECEPCION', delta: -quitar, stock: nuevo,
      referencia: idRecepcion, detalle: 'Tanque eliminado: ' + rows[filaRec][2] });
  });

  if (inv.length > 1) invSheet.getRange(1, 1, inv.length, 13).setValues(inv);
  registrarMovimientos(movimientos);
  recSheet.deleteRow(filaRec + 1);

  return {
    status: 'success',
    faltantes: faltantes,
    message: 'Recepción ' + idRecepcion + ' eliminada y sus unidades descontadas del inventario.' +
      (faltantes.length ? ' No se pudo descontar todo: ' + faltantes.join('; ') : '')
  };
}

/**
 * =========================================================================
 * MONITOREO, REGISTRO DE ERRORES Y MANTENIMIENTO
 * =========================================================================
 * - Los dispositivos reportan rechazos, operaciones en recuperación y errores de la app
 *   a la hoja "Registro de Errores".
 * - Cada mañana, monitoreoDiario() revisa ese registro, ejecuta el diagnóstico de inventario
 *   (duplicados, excesos, tanques dobles y cuadre del kardex), depura registros antiguos y
 *   envía un correo al administrador si hay algo que revisar (y uno de control los lunes).
 */
const HOJA_REGISTRO_ERRORES = 'Registro de Errores';
const DIAS_CONSERVAR_REGISTROS = 180;
const RESPALDOS_A_CONSERVAR = 30;
const MAX_EVENTOS_POR_ENVIO = 25;

function hojaRegistroErrores() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(HOJA_REGISTRO_ERRORES);
  if (!sheet) {
    sheet = ss.insertSheet(HOJA_REGISTRO_ERRORES);
    sheet.getRange(1, 1, 1, 8).setValues([[
      'Fecha (servidor)', 'Fecha (dispositivo)', 'Tipo', 'Acción', 'Mensaje', 'Detalle', 'Dispositivo', 'Versión app'
    ]]);
    estilarCabecera(sheet, 8, '#0B132B', '#D4AF37');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function registrarEventosCliente(datos) {
  const eventos = (Array.isArray(datos.eventos) ? datos.eventos : []).slice(0, MAX_EVENTOS_POR_ENVIO);
  if (!eventos.length) return { status: 'success', registrados: 0 };
  const texto = (v, max) => String(v === undefined || v === null ? '' : v).substring(0, max || 500);
  const ahora = new Date();
  const filas = eventos.map(e => [
    ahora, texto(e.fecha, 40), texto(e.tipo, 40), texto(e.accion, 80), texto(e.mensaje), texto(e.detalle),
    texto(datos.dispositivo, 160), texto(datos.version, 40)
  ]);

  const lock = LockService.getScriptLock();
  const conLock = lock.tryLock(5000);
  try {
    const sheet = hojaRegistroErrores();
    if (conLock) {
      sheet.getRange(sheet.getLastRow() + 1, 1, filas.length, 8).setValues(filas);
    } else {
      filas.forEach(f => sheet.appendRow(f));
    }
  } finally {
    if (conLock) lock.releaseLock();
  }
  return { status: 'success', registrados: filas.length };
}

/**
 * Borra filas más antiguas que `dias` (las hojas de registro crecen en orden cronológico).
 */
function depurarFilasAntiguas(nombreHoja, columnaFecha, dias) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const limite = Date.now() - dias * 86400000;
  const fechas = sheet.getRange(2, columnaFecha, sheet.getLastRow() - 1, 1).getValues();
  let antiguas = 0;
  for (let i = 0; i < fechas.length; i++) {
    const t = fechas[i][0] ? new Date(fechas[i][0]).getTime() : 0;
    if (t && t < limite) antiguas++;
    else break;
  }
  if (antiguas > 0) sheet.deleteRows(2, antiguas);
  return antiguas;
}

function correoAdministrador() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || Session.getEffectiveUser().getEmail();
}

function monitoreoDiario() {
  const lock = LockService.getScriptLock();
  const conLock = lock.tryLock(60000);
  try {
    const ahora = Date.now();
    const informe = { errores: [], totalEventos: 0, diagnostico: null, depuradas: 0 };

    // 1. Errores y rechazos reportados por los dispositivos en las últimas 24 horas
    const reg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_REGISTRO_ERRORES);
    if (reg && reg.getLastRow() > 1) {
      const grupos = {};
      reg.getRange(2, 1, reg.getLastRow() - 1, 8).getValues().forEach(f => {
        const t = f[0] ? new Date(f[0]).getTime() : 0;
        if (!t || ahora - t > 86400000) return;
        informe.totalEventos++;
        const clave = f[2] + ' · ' + f[3] + ' · ' + f[4];
        grupos[clave] = (grupos[clave] || 0) + 1;
      });
      informe.errores = Object.keys(grupos).map(k => ({ descripcion: k, veces: grupos[k] }))
        .sort((a, b) => b.veces - a.veces);
    }

    // 2. Inventario: duplicados, excesos, tanques dobles y cuadre del kardex
    informe.diagnostico = diagnosticarInventario(false);

    // 3. Mantenimiento
    if (conLock) {
      informe.depuradas = depurarFilasAntiguas(HOJA_OPERACIONES, 2, DIAS_CONSERVAR_REGISTROS) +
        depurarFilasAntiguas(HOJA_REGISTRO_ERRORES, 1, DIAS_CONSERVAR_REGISTROS);
    }

    // 4. Aviso al administrador
    const r = informe.diagnostico.resumen;
    const problemasInventario = r.productos_duplicados + r.productos_con_exceso + r.recepciones_duplicadas + r.diferencias_kardex;
    informe.hayProblemas = informe.totalEventos > 0 || problemasInventario > 0;
    const esLunes = Utilities.formatDate(new Date(), ZONA_HORARIA, 'u') === '1';
    if (informe.hayProblemas || esLunes) {
      MailApp.sendEmail(correoAdministrador(), asuntoMonitoreo(informe), cuerpoMonitoreo(informe));
      informe.correoEnviado = true;
    }
    PropertiesService.getScriptProperties().setProperty('MONITOREO_ULTIMA_EJECUCION', new Date().toISOString());
    return informe;
  } finally {
    if (conLock) lock.releaseLock();
  }
}

function asuntoMonitoreo(informe) {
  return informe.hayProblemas
    ? '⚠️ Thor Essence: hay elementos por revisar'
    : '✅ Thor Essence: control semanal sin novedades';
}

function cuerpoMonitoreo(informe) {
  const r = informe.diagnostico.resumen;
  const lineas = [
    'Resumen automático del sistema Thor Essence — ' + Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd HH:mm'),
    '',
    '1) Errores y operaciones rechazadas en las últimas 24 h: ' + informe.totalEventos
  ];
  informe.errores.slice(0, 15).forEach(e => lineas.push('   - (' + e.veces + 'x) ' + e.descripcion));
  lineas.push(
    '',
    '2) Inventario (' + r.productos + ' productos revisados):',
    '   - Productos duplicados: ' + r.productos_duplicados,
    '   - Productos con stock de más: ' + r.productos_con_exceso + ' (' + r.unidades_de_mas + ' unidades)',
    '   - Tanques registrados dos veces: ' + r.recepciones_duplicadas,
    '   - Diferencias entre Movimientos e Inventario: ' + r.diferencias_kardex,
    '',
    '3) Mantenimiento: ' + informe.depuradas + ' registro(s) de más de ' + DIAS_CONSERVAR_REGISTROS + ' días depurados.',
    ''
  );
  if (informe.hayProblemas) {
    lineas.push('Qué hacer: abre la hoja de cálculo › 🌸 Thor Essence Admin › 🔍 Diagnosticar Inventario,',
      'y revisa la hoja "' + HOJA_REGISTRO_ERRORES + '" para el detalle de los errores.');
  } else {
    lineas.push('Todo en orden. Este correo de control se envía los lunes para confirmar que el monitoreo funciona.');
  }
  return lineas.join('\n');
}

/**
 * Crea el disparador diario (7:00 AM) y envía un correo de prueba. Ejecutarlo desde el menú
 * también concede el permiso de envío de correos.
 */
function configurarMonitoreoDiario() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'monitoreoDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('monitoreoDiario').timeBased().everyDays(1).atHour(7).create();

  const destino = correoAdministrador();
  MailApp.sendEmail(destino, '✅ Thor Essence: monitoreo diario activado',
    'Recibirás un correo cada mañana (7:00 AM) si hay errores en los dispositivos o problemas de inventario, ' +
    'y un correo de control todos los lunes.\n\nPara cambiar el destinatario, crea la propiedad de script ADMIN_EMAIL.');
  try {
    SpreadsheetApp.getUi().alert('📬 Monitoreo diario activado.\n\nSe envió un correo de prueba a ' + destino + '.');
  } catch (e) {
    console.log('Monitoreo configurado por script.');
  }
}

/**
 * H14: protección "con advertencia" de las hojas de datos: si alguien intenta editarlas a mano,
 * Google Sheets pide confirmación. La app y los menús siguen funcionando normalmente.
 */
function menuProtegerHojas() {
  const n = protegerHojasDeDatos();
  SpreadsheetApp.getUi().alert('🛡️ ' + n + ' hoja(s) protegidas.\n\nSi alguien intenta editarlas a mano, Google Sheets mostrará una advertencia. ' +
    'Los datos deben modificarse desde la app o desde este menú.');
}

function protegerHojasDeDatos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombres = [SHEETS.INVENTARIO, SHEETS.VENTAS, SHEETS.COBROS, SHEETS.RECEPCIONES, HOJA_MOVIMIENTOS, HOJA_OPERACIONES, HOJA_ALIAS];
  let protegidas = 0;
  nombres.forEach(nombre => {
    const sheet = ss.getSheetByName(nombre);
    if (!sheet) return;
    sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => {
      if (String(p.getDescription()).indexOf('Thor Essence') === 0) p.remove();
    });
    sheet.protect()
      .setDescription('Thor Essence: los datos se modifican desde la app')
      .setWarningOnly(true);
    protegidas++;
  });
  return protegidas;
}

