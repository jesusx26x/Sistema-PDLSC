/**
 * =========================================================================
 * THOR ESSENCE — MÓDULO API, SINCRONIZACIÓN Y NOTIFICACIONES SONNER
 * (Inspirado en Emil Kowalski & UX-UI-PRO-MAX)
 * =========================================================================
 */

// Notificaciones estilo Sonner (Emil Kowalski)
const Sonner = (function() {
  function getContainer() {
    let container = document.getElementById('sonner-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'sonner-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, type = 'info', duration = 3500) {
    const container = getContainer();
    const toast = document.createElement('div');
    toast.className = 'sonner-toast';

    let icon = '✨';
    let borderColor = 'rgba(212, 175, 55, 0.4)';
    if (type === 'success') {
      icon = '✅';
      borderColor = 'rgba(16, 185, 129, 0.5)';
    } else if (type === 'error') {
      icon = '✕';
      borderColor = 'rgba(239, 68, 68, 0.5)';
    } else if (type === 'warning') {
      icon = '⚠️';
      borderColor = 'rgba(245, 158, 11, 0.5)';
    }

    toast.style.borderColor = borderColor;

    toast.innerHTML = `
      <div class="flex items-center gap-2.5">
        <span class="text-base shrink-0">${icon}</span>
        <div class="text-xs font-semibold text-slate-100" data-mensaje></div>
      </div>
      <button class="text-slate-400 hover:text-slate-200 text-xs shrink-0 pl-2">✕</button>
    `;
    // El mensaje puede contener nombres escritos por el usuario: siempre como texto, nunca HTML
    toast.querySelector('[data-mensaje]').textContent = String(message);

    const closeBtn = toast.querySelector('button');
    const dismiss = () => {
      toast.classList.add('sonner-exit');
      setTimeout(() => toast.remove(), 180);
    };

    closeBtn.onclick = dismiss;
    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(dismiss, duration);
    }
  }



  return {
    success: (msg, dur) => show(msg, 'success', dur),
    error: (msg, dur) => show(msg, 'error', dur),
    warning: (msg, dur) => show(msg, 'warning', dur),
    info: (msg, dur) => show(msg, 'info', dur)
  };
})();

const ThorAPI = (function() {
  const STORAGE_KEYS = {
    GAS_URL: 'thor_gas_url',
    SESSION_TOKEN: 'thor_session_token',
    CURRENT_USER: 'thor_current_user',
    USD_RATE: 'thor_usd_dop_rate',
    CACHE_DATA: 'thor_cached_system_data_v5',
    SERVER_SNAPSHOT: 'thor_server_snapshot_v1',
    OUTBOX_QUEUE: 'thor_outbox_queue_v1',
    SYNC_LOG: 'thor_sync_log_v1',
    DLQ: 'thor_dead_letter_queue_v1',
    DLQ_AUTO: 'thor_dlq_reintento_auto'
  };

  const DEFAULT_RATE = (typeof THOR_CONFIG !== 'undefined' && THOR_CONFIG.DEFAULT_USD_RATE) ? THOR_CONFIG.DEFAULT_USD_RATE : 60.50;
  const DEFAULT_CATEGORIES = [
    'Perfumes',
    'Splash',
    'Cremas',
    'Body Wash',
    'Accesorios',
    'Maquillaje',
    'Variedades'
  ];

  const INITIAL_DEMO_DATA = {
    inventario: [],
    ventas: [],
    recepciones: [],
    cobros: [],
    configuracion: {
      NOMBRE_NEGOCIO: 'Thor Essence',
      SLOGAN: 'Belleza, aroma y estilo',
      MONEDA_PRINCIPAL: 'DOP',
      TASA_CAMBIO_USD_DOP: DEFAULT_RATE,
      CATEGORIAS: 'Perfumes, Splash, Cremas, Body Wash, Accesorios, Maquillaje, Variedades'
    },
    metricas: {
      total_productos: 0,
      total_unidades_stock: 0,
      valor_inventario_costo_dop: 0,
      valor_inventario_venta_dop: 0,
      productos_stock_bajo: 0,
      productos_agotados: 0,
      ventas_hoy_dop: 0,
      ganancia_hoy_dop: 0,
      ventas_mes_dop: 0,
      ganancia_mes_dop: 0,
      total_por_cobrar_dop: 0,
      cuotas_pendientes_hoy: 0,
      clientes_con_deuda: 0
    }
  };

  function getSessionToken() {
    return sessionStorage.getItem(STORAGE_KEYS.SESSION_TOKEN) || localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN) || '';
  }

  function setSession(token, user, remember = true) {
    if (token) {
      sessionStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, token);
      if (user) sessionStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
      if (remember) {
        localStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, token);
        if (user) localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
      }
    }
  }

  function clearSession() {
    sessionStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
    sessionStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  }

  function getCurrentUser() {
    try {
      const u = sessionStorage.getItem(STORAGE_KEYS.CURRENT_USER) || localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
      return u ? JSON.parse(u) : null;
    } catch (e) {
      return null;
    }
  }

  function isAuthenticated() {
    return !!getSessionToken();
  }

  /**
   * Obtiene la configuración activa
   * Prioriza THOR_CONFIG (cero configuración para Pamela)
   */
  function getConfig() {
    let gasUrl = '';
    if (typeof THOR_CONFIG !== 'undefined' && THOR_CONFIG.GAS_URL) {
      gasUrl = THOR_CONFIG.GAS_URL;
    }
    if (!gasUrl) {
      gasUrl = localStorage.getItem(STORAGE_KEYS.GAS_URL) || '';
    }

  

  return {
      gasUrl: gasUrl.trim(),
      sessionToken: getSessionToken(),
      usdRate: parseFloat(localStorage.getItem(STORAGE_KEYS.USD_RATE)) || DEFAULT_RATE,
      isConfigured: !!gasUrl.trim()
    };
  }

  function saveCredentials(url) {
    if (url) localStorage.setItem(STORAGE_KEYS.GAS_URL, url.trim());
  }

  function getUsdRate() {
    return parseFloat(localStorage.getItem(STORAGE_KEYS.USD_RATE)) || DEFAULT_RATE;
  }

  function setUsdRate(rate) {
    const num = parseFloat(rate);
    if (!isNaN(num) && num > 0) {
      localStorage.setItem(STORAGE_KEYS.USD_RATE, num.toFixed(2));
    }
  }

  async function fetchLiveExchangeRate() {
    try {
      const resp = await fetch('https://open.er-api.com/v6/latest/USD');
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.rates && data.rates.DOP) {
          const liveRate = parseFloat(data.rates.DOP);
          setUsdRate(liveRate);
    return { success: true, rate: liveRate, source: 'Mercado en Vivo (open.er-api)' };
        }
      }
    } catch (e) {
      console.warn('No se pudo obtener la tasa en vivo:', e);
    }
  

  return { success: false, rate: getUsdRate(), source: 'Local' };
  }

  // Vista actual (foto del servidor + operaciones pendientes). Vive en memoria: en el dispositivo
  // solo se guardan la foto del servidor y la cola, así el almacenamiento rinde el doble.
  let cacheEnMemoria = null;

  function getCachedData() {
    if (!cacheEnMemoria) cacheEnMemoria = cargarCacheInicial();
    return JSON.parse(JSON.stringify(cacheEnMemoria));
  }

  function cargarCacheInicial() {
    if (getSnapshot()) {
      // Versiones anteriores guardaban también la vista: ya no hace falta
      try { localStorage.removeItem(STORAGE_KEYS.CACHE_DATA); } catch (e) {}
      return reconstruirSobre(getSnapshot());
    }
    // Instalación que aún no descargó una foto del servidor: la vista heredada ya incluye lo pendiente
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CACHE_DATA);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error('Error leyendo caché:', e);
    }
    return JSON.parse(JSON.stringify(INITIAL_DEMO_DATA));
  }

  function setCachedData(data) {
    cacheEnMemoria = JSON.parse(JSON.stringify(data));
    // Sin servidor configurado (modo solo local) la vista es la única copia: se guarda
    if (!getConfig().isConfigured) {
      try {
        localStorage.setItem(STORAGE_KEYS.CACHE_DATA, JSON.stringify(data));
      } catch (e) {
        console.error('Error guardando en caché:', e);
      }
    }
  }

  /**
   * Iniciar Sesión de Pamela en el Servidor
   */
  async function login(username, password, remember = true) {
    const cfg = getConfig();
    if (!cfg.isConfigured) {
      return { success: false, message: 'Sistema no configurado. Conecte con Google Sheets primero.' };
    }

    try {
      const payload = {
        action: 'login',
        username: username.trim(),
        password: password
      };

      const response = await fetch(cfg.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      const res = await response.json();
      if (res && res.status === 'success' && res.token) {
        setSession(res.token, res.user, remember);
  return { success: true, user: res.user, token: res.token };
      } else {
  return { success: false, message: res.message || 'Credenciales inválidas.' };
      }
    } catch (e) {
      console.error('Error conectando con autenticación:', e);
      // Offline: intentar usar sesión guardada previamente
      const savedToken = getSessionToken();
      const savedUser = getCurrentUser();
      if (savedToken && savedUser) {
        return { success: true, user: savedUser, isOffline: true, message: 'Usando sesión guardada (sin conexión).' };
      }
return { success: false, message: 'No se pudo conectar con el servidor de autenticación.' };
    }
  }

  /**
   * Cerrar Sesión en el Servidor (Signout real en BD/Servidor)
   */
  async function logout() {
    const cfg = getConfig();
    const token = getSessionToken();

    if (cfg.isConfigured && token && !token.startsWith('OFFLINE_') && !token.startsWith('LOCAL_')) {
      try {
        await fetch(cfg.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'logout', token: token })
        });
      } catch (e) {
        console.warn('Signout en servidor no pudo completarse en la red:', e);
      }
    }

    clearSession();
  

  return { success: true };
  }

  function getOutbox() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.OUTBOX_QUEUE);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveOutbox(queue) {
    try {
      localStorage.setItem(STORAGE_KEYS.OUTBOX_QUEUE, JSON.stringify(queue));
    } catch (e) {
      console.warn('Error guardando cola outbox:', e);
    }
  }

  function generarUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /**
   * ID definitivo generado en el dispositivo: PREFIJO-yyyyMMdd-XXXXXXXX.
   * Mismo formato que generarId() del backend; el servidor lo respeta, así el ID local
   * y el de Google Sheets coinciden aunque la operación se suba horas después.
   */
  function generarId(prefijo) {
    const d = new Date();
    const fecha = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `${prefijo}-${fecha}-${generarUuid().replace(/-/g, '').substring(0, 8).toUpperCase()}`;
  }

  function esVentaCredito(v) {
    return !!v && (v.tipo_venta === 'credito' || v.metodo_pago === 'Crédito' || v.metodo_pago === 'Fiado' || v.es_credito === true);
  }

  /**
   * Asigna los IDs definitivos antes de aplicar la operación en local y encolarla.
   */
  function prepararIdsOperacion(action, data) {
    if (!data || typeof data !== 'object') return;

    if (action === 'saveProduct' && !data.id) {
      data.id = generarId('PROD');
    }

    if (action === 'registerSale') {
      if (!data.id_venta) data.id_venta = generarId('VTA');
      if (esVentaCredito(data)) {
        if (!data.id_cobro) data.id_cobro = generarId('COB');
        if ((parseFloat(data.abono_inicial) || 0) > 0 && !data.id_abono_inicial) {
          data.id_abono_inicial = generarId('ABN');
        }
      }
    }

    if (action === 'registerPayment' && !data.id_abono) {
      data.id_abono = generarId('ABN');
    }

    if (action === 'registerReception' && !data.id_recepcion) {
      data.id_recepcion = generarId('TANQ');
    }
  }

  function enqueueOutbox(action, data, opId) {
    const queue = getOutbox();
    const item = {
      queueId: 'OUTBOX_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      // Clave de idempotencia: el servidor no aplica dos veces la misma operación
      opId: opId || generarUuid(),
      action: action,
      data: data,
      timestamp: Date.now(),
      retries: 0
    };
    queue.push(item);
    saveOutbox(queue);
    window.dispatchEvent(new CustomEvent('thor:outbox-updated', { detail: { count: queue.length } }));
    return item;
  }

  function removeFromOutbox(queueId) {
    let queue = getOutbox();
    queue = queue.filter(item => item.queueId !== queueId);
    saveOutbox(queue);
    window.dispatchEvent(new CustomEvent('thor:outbox-updated', { detail: { count: queue.length } }));
  }

  function moveToDeadLetterQueue(item) {
    try {
      const dlq = getDeadLetterQueue();
      item.failedAt = new Date().toISOString();
      dlq.push(item);
      localStorage.setItem(STORAGE_KEYS.DLQ, JSON.stringify(dlq));
      console.warn('Operación movida a dead-letter queue:', item.queueId, item.action);
      registrarEnHistorial('recuperacion', item, 'El servidor falló 5 veces seguidas. Queda guardada para reintentar.');
    } catch (e) {
      console.error('Error guardando en dead-letter queue:', e);
    }
  }

  function getDeadLetterQueue() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DLQ);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Devuelve a la cola las operaciones en recuperación (conservando su op_id: si el servidor
   * ya las había aplicado, no se duplican) y las envía.
   */
  async function reintentarRecuperacion() {
    const dlq = getDeadLetterQueue();
    if (!dlq.length) return { reintentadas: 0 };
    const queue = getOutbox();
    dlq.forEach(item => {
      queue.push(Object.assign({}, item, { retries: 0, failedAt: undefined }));
    });
    saveOutbox(queue);
    localStorage.removeItem(STORAGE_KEYS.DLQ);
    marcarHistorialVisto('recuperacion');
    reconstruirCache();
    window.dispatchEvent(new CustomEvent('thor:outbox-updated', { detail: { count: queue.length } }));
    const r = await flushOutbox();
    return { reintentadas: dlq.length, resultado: r };
  }

  /**
   * Reintento automático una vez al día (p. ej. tras corregir un error del servidor).
   */
  async function reintentarRecuperacionAutomatica() {
    if (!getDeadLetterQueue().length || !navigator.onLine || !sesionDisponible()) return null;
    const hoy = fechaLocal().substring(0, 10);
    if (localStorage.getItem(STORAGE_KEYS.DLQ_AUTO) === hoy) return null;
    localStorage.setItem(STORAGE_KEYS.DLQ_AUTO, hoy);
    return reintentarRecuperacion();
  }

  function getHistorialSync() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SYNC_LOG);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function guardarHistorialSync(lista) {
    try {
      localStorage.setItem(STORAGE_KEYS.SYNC_LOG, JSON.stringify(lista.slice(0, 100)));
    } catch (e) {
      console.warn('No se pudo guardar el historial de sincronización:', e);
    }
    window.dispatchEvent(new CustomEvent('thor:historial-sync'));
  }

  /**
   * Describe una operación en palabras (para que Pamela sepa exactamente qué no se guardó).
   */
  function resumirOperacion(item) {
    const d = item.data || {};
    const inventario = (cacheEnMemoria && cacheEnMemoria.inventario) || [];
    const nombreProducto = id => (inventario.find(p => p.id === id) || {}).nombre || id || 'producto';
    switch (item.action) {
      case 'registerSale':
        return `${d.cantidad} × ${nombreProducto(d.id_articulo)} a RD$ ${Number(d.precio_unitario_dop || 0).toLocaleString()} — ${d.cliente || 'Consumidor Final'}${esVentaCredito(d) ? ' (fiado)' : ''}`;
      case 'registerPayment':
        return `Abono de RD$ ${Number(d.monto || 0).toLocaleString()} a la cuenta ${d.id_cobro}`;
      case 'adjustStock':
        return `${d.delta > 0 ? '+' : ''}${d.delta} unidad(es) a ${nombreProducto(d.id)}${d.motivo ? ' (' + d.motivo + ')' : ''}`;
      case 'saveProduct':
        return `Producto "${d.nombre || d.id}"`;
      case 'deleteProduct':
        return `Eliminar ${nombreProducto(typeof d === 'string' ? d : d.id)}`;
      case 'cancelSale':
        return `Anular la venta ${d.id_venta}`;
      case 'registerReception':
        return `Tanque "${d.nombre_tanque}" con ${(d.articulos || []).length} artículo(s)`;
      default:
        return item.action;
    }
  }

  function registrarEnHistorial(tipo, item, mensaje, visto = false) {
    const lista = getHistorialSync();
    lista.unshift({
      id: generarUuid(),
      fecha: fechaLocal(),
      tipo: tipo, // 'rechazada' | 'recuperacion'
      accion: NOMBRES_ACCION[item.action] || item.action,
      mensaje: mensaje,
      resumen: resumirOperacion(item),
      visto: visto
    });
    guardarHistorialSync(lista);
  }

  function marcarHistorialVisto(tipo) {
    guardarHistorialSync(getHistorialSync().map(e => (!tipo || e.tipo === tipo) ? Object.assign(e, { visto: true }) : e));
  }

  function contarPorRevisar() {
    return getHistorialSync().filter(e => !e.visto).length + getDeadLetterQueue().length;
  }

  async function silentRelogin() {
    // No hay renovación silenciosa: las credenciales nunca se guardan en el dispositivo.
    // Si había un token, se descarta y se pide iniciar sesión de nuevo.
    if (getSessionToken()) notificarSesionVencida();
    return false;
  }

  let inFlightFetchAll = null;
  let lastFetchAllTimestamp = 0;

  // Todos los envíos de mutaciones pasan por esta cadena y se ejecutan de uno en uno,
  // en el mismo orden en que se registraron.
  let cadenaEnvios = Promise.resolve();
  function enSerie(tarea) {
    const resultado = cadenaEnvios.then(tarea, tarea);
    cadenaEnvios = resultado.catch(() => {});
    return resultado;
  }

  const TIMEOUT_ENVIO_MS = 45000;
  async function fetchConTimeout(url, opciones) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_ENVIO_MS);
    try {
      return await fetch(url, Object.assign({}, opciones, { signal: controller.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  function sesionDisponible() {
    const token = getSessionToken();
    return !!token && !token.startsWith('OFFLINE_') && !token.startsWith('LOCAL_');
  }

  function notificarSesionVencida() {
    clearSession();
    window.dispatchEvent(new CustomEvent('thor:session-expired'));
  }

  /**
   * Envía una operación de la cola al servidor (con su op_id) y devuelve el JSON de respuesta.
   * Lanza excepción ante fallos de red, timeout o respuesta no JSON.
   */
  async function enviarOperacion(cfg, item) {
    const respuesta = await fetchConTimeout(cfg.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: item.action,
        token: getSessionToken(),
        op_id: item.opId,
        data: item.data
      })
    });
    return respuesta.json();
  }

  const NOMBRES_ACCION = {
    saveProduct: 'Guardar producto',
    deleteProduct: 'Eliminar producto',
    adjustStock: 'Ajuste de stock',
    registerSale: 'Venta',
    cancelSale: 'Anulación de venta',
    registerReception: 'Recepción de tanque',
    registerPayment: 'Abono',
    saveConfig: 'Configuración'
  };
  const MAX_REINTENTOS_ERROR_SERVIDOR = 5;

  /**
   * 'ok'          → aplicada (o ya lo estaba)
   * 'sesion'      → sesión vencida: se conserva en la cola hasta volver a iniciar sesión
   * 'transitorio' → servidor ocupado o error interno: se reintenta más tarde, sin saltarse el orden
   * 'rechazada'   → el servidor la rechazó por una regla de negocio: se descarta y se revierte en local
   */
  function clasificarRespuesta(json) {
    if (json && json.status === 'success') return 'ok';
    if (!json || typeof json !== 'object') return 'transitorio';
    if (json.code === 'UNAUTHORIZED_RLS') return 'sesion';
    if (json.code === 'SERVER_BUSY' || json.code === 'SERVER_ERROR') return 'transitorio';
    if (!json.code && /ocupado/i.test(json.message || '')) return 'transitorio';
    return 'rechazada';
  }

  /**
   * Última foto de los datos tal como están en Google Sheets.
   */
  // La foto más reciente también se conserva en memoria: si el almacenamiento se llenara,
  // la sesión actual nunca vuelve a una foto vieja
  let snapshotEnMemoria = null;

  function getSnapshot() {
    if (snapshotEnMemoria) return snapshotEnMemoria;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SERVER_SNAPSHOT);
      snapshotEnMemoria = raw ? JSON.parse(raw) : null;
    } catch (e) {
      snapshotEnMemoria = null;
    }
    return snapshotEnMemoria;
  }

  let avisoAlmacenamientoMostrado = false;

  /**
   * Guarda la foto del servidor. Devuelve false si el almacenamiento del navegador está lleno
   * (la foto queda igualmente en memoria para esta sesión y se avisa una vez).
   */
  function setSnapshot(data) {
    snapshotEnMemoria = data;
    try {
      localStorage.setItem(STORAGE_KEYS.SERVER_SNAPSHOT, JSON.stringify(data));
      // Con una foto guardada, la vista completa que guardaban versiones anteriores sobra
      if (getConfig().isConfigured) localStorage.removeItem(STORAGE_KEYS.CACHE_DATA);
      return true;
    } catch (e) {
      console.warn('No se pudo guardar la foto del servidor:', e);
      if (!avisoAlmacenamientoMostrado) {
        avisoAlmacenamientoMostrado = true;
        window.dispatchEvent(new CustomEvent('thor:almacenamiento-lleno'));
      }
      return false;
    }
  }

  /**
   * Caché local = última foto del servidor + operaciones pendientes re-aplicadas encima, en orden.
   * Así una descarga nunca borra de la pantalla lo que aún no subió, y una operación rechazada
   * desaparece sin dejar rastro.
   */
  function reconstruirCache() {
    const snapshot = getSnapshot();
    if (!snapshot) return null;
    const base = reconstruirSobre(snapshot);
    setCachedData(base);
    return base;
  }

  /**
   * Reasigna IDs de producto que el servidor unió a otro producto (alias): así una venta
   * pendiente hecha con el ID del dispositivo se ve sobre el producto real.
   */
  function remapearIds(data, alias) {
    if (!alias || !data) return data;
    const real = id => {
      let actual = id;
      const vistos = new Set();
      while (actual && alias[actual] && !vistos.has(actual)) {
        vistos.add(actual);
        actual = alias[actual];
      }
      return actual;
    };
    if (typeof data === 'string') return real(data);
    if (typeof data !== 'object') return data;
    if (data.id) data.id = real(data.id);
    if (data.id_articulo) data.id_articulo = real(data.id_articulo);
    if (Array.isArray(data.articulos)) data.articulos.forEach(a => { if (a && a.id) a.id = real(a.id); });
    return data;
  }

  /**
   * Aplica a la foto guardada una operación que el servidor acaba de confirmar, para que al
   * reabrir la app (incluso sin conexión) se vea el estado ya aceptado por la nube.
   */
  function aplicarEnFoto(item, respuesta) {
    const snap = getSnapshot();
    if (!snap) return;
    const incluidas = snap.ops_aplicadas || [];
    if (item.opId && incluidas.includes(item.opId)) return;
    const copia = JSON.parse(JSON.stringify(snap));
    copia.alias = copia.alias || {};
    if (respuesta && respuesta.unido && respuesta.id && item.data && item.data.id && item.data.id !== respuesta.id) {
      // El servidor lo unió a un producto existente: la próxima descarga trae las cantidades exactas
      copia.alias[item.data.id] = respuesta.id;
    } else {
      try {
        aplicarOperacion(copia, item.action, remapearIds(JSON.parse(JSON.stringify(item.data)), copia.alias));
        recalcularMetricasLocales(copia);
      } catch (e) {
        console.warn('No se pudo aplicar a la foto la operación confirmada', item.action, e);
      }
    }
    copia.ops_aplicadas = incluidas.concat(item.opId ? [item.opId] : []).slice(-500);
    setSnapshot(copia);
  }

  function reconstruirSobre(snapshot) {
    const base = JSON.parse(JSON.stringify(snapshot));
    const incluidas = new Set(snapshot.ops_aplicadas || []);
    const pendientes = getOutbox().filter(item => !incluidas.has(item.opId));
    pendientes.forEach(item => {
      try {
        const datos = remapearIds(JSON.parse(JSON.stringify(item.data)), snapshot.alias);
        aplicarOperacion(base, item.action, datos);
      } catch (e) {
        console.warn('No se pudo re-aplicar la operación pendiente', item.action, e);
      }
    });
    if (pendientes.length) recalcularMetricasLocales(base);
    return base;
  }

  /**
   * Envía la cola en orden. Se detiene ante fallos de red, sesión vencida o error transitorio
   * (para no saltarse el orden); las operaciones rechazadas se descartan y se revierten en local.
   * opciones.hasta: queueId cuya respuesta espera apiPost (no se notifica por evento).
   */
  async function procesarCola(opciones = {}) {
    const cfg = getConfig();
    const resultados = {};
    const rechazadas = [];
    let processed = 0;
    let motivo = null;

    if (!cfg.isConfigured || !navigator.onLine) motivo = 'offline';
    else if (!sesionDisponible()) motivo = 'sesion';

    // Operaciones encoladas antes de existir op_id: asignarles uno estable desde ahora
    const inicial = getOutbox();
    if (inicial.some(q => !q.opId)) {
      inicial.forEach(q => { if (!q.opId) q.opId = generarUuid(); });
      saveOutbox(inicial);
    }

    if (!motivo && inicial.length > 50) {
      Sonner.warning(`Hay ${inicial.length} operaciones pendientes de sincronizar. Verifique su conexión a internet.`, 6000);
    }

    const limite = opciones.limite || 25;
    let enviados = 0;
    while (!motivo && enviados < limite) {
      const item = getOutbox()[0];
      if (!item) break;
      enviados++;

      let json;
      try {
        json = await enviarOperacion(cfg, item);
      } catch (e) {
        console.warn('Sin respuesta del servidor; la operación queda en cola:', e);
        motivo = 'red';
        break;
      }

      const tipo = clasificarRespuesta(json);
      if (tipo === 'ok') {
        removeFromOutbox(item.queueId);
        aplicarEnFoto(item, json);
        resultados[item.queueId] = json;
        processed++;
      } else if (tipo === 'rechazada') {
        removeFromOutbox(item.queueId);
        resultados[item.queueId] = json;
        rechazadas.push({ item, json });
        // Queda registrada para que no "desaparezca" en silencio (la de apiPost ya se ve en pantalla)
        registrarEnHistorial('rechazada', item, (json && json.message) || 'El servidor rechazó la operación',
          item.queueId === opciones.hasta);
      } else if (tipo === 'sesion') {
        motivo = 'sesion';
        notificarSesionVencida();
      } else {
        resultados[item.queueId] = json;
        motivo = 'servidor';
        // Solo los errores internos cuentan como reintento; "servidor ocupado" no
        if (!json || json.code === 'SERVER_ERROR') {
          const queue = getOutbox();
          const q = queue.find(x => x.queueId === item.queueId);
          if (q) {
            q.retries = (q.retries || 0) + 1;
            if (q.retries >= MAX_REINTENTOS_ERROR_SERVIDOR) {
              // Mover a dead-letter queue en vez de borrar — NUNCA perder datos
              moveToDeadLetterQueue(q);
              removeFromOutbox(q.queueId);
              reconstruirCache();
              Sonner.error('Error persistente sincronizando una operación. Se guardó en la cola de recuperación.', 6000);
              motivo = null; // las siguientes pueden continuar
            } else {
              saveOutbox(queue);
            }
          }
        }
      }

      if (opciones.hasta && !getOutbox().some(q => q.queueId === opciones.hasta)) break;
    }

    if (rechazadas.length) {
      reconstruirCache();
      rechazadas
        .filter(r => r.item.queueId !== opciones.hasta)
        .forEach(r => window.dispatchEvent(new CustomEvent('thor:operacion-rechazada', {
          detail: {
            accion: NOMBRES_ACCION[r.item.action] || r.item.action,
            message: (r.json && r.json.message) || 'El servidor rechazó la operación',
            item: r.item
          }
        })));
    }

    const pending = getOutbox().length;
    window.dispatchEvent(new CustomEvent('thor:outbox-updated', { detail: { count: pending } }));
    return {
      success: !motivo,
      processed,
      rejected: rechazadas.length,
      pending,
      motivo,
      offline: motivo === 'offline',
      authRequired: motivo === 'sesion',
      resultados
    };
  }

  function flushOutbox() {
    return enSerie(() => procesarCola({ limite: 25 }));
  }

  async function apiGet(action, extraParams = {}) {
    const cfg = getConfig();
    if (!cfg.isConfigured) {
      return { status: 'success', data: getCachedData() };
    }
    if (!sesionDisponible()) {
      return { status: 'error', code: 'UNAUTHORIZED_RLS', authRequired: true, message: 'Sesión no iniciada' };
    }

    // Lectura por POST: el token viaja en el cuerpo y no queda en historiales ni registros de URL
    const leerPorPost = () => fetchConTimeout(cfg.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({}, extraParams, { action: action, token: getSessionToken() }))
    });
    // Respaldo para backends anteriores que solo aceptan lecturas por GET
    const leerPorGet = () => {
      const url = new URL(cfg.gasUrl);
      url.searchParams.append('action', action);
      url.searchParams.append('token', getSessionToken());
      for (let k in extraParams) {
        url.searchParams.append(k, extraParams[k]);
      }
      return fetchConTimeout(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
    };

    try {
      let json = await (await leerPorPost()).json();
      if (json && json.status === 'error' && /no reconocida/i.test(json.message || '')) {
        json = await (await leerPorGet()).json();
      }
      if (json && json.code === 'UNAUTHORIZED_RLS') {
        notificarSesionVencida();
      }
      return json;
    } catch (e) {
      console.warn('apiGet red caída, usando caché local:', e);
      return { status: 'error', isCachedFallback: true, data: getCachedData(), message: e.message };
    }
  }

  async function apiPost(action, data = {}) {
    const cfg = getConfig();

    // 0. IDs definitivos generados en el dispositivo (iguales en local y en la nube)
    prepararIdsOperacion(action, data);

    // 1. Ejecutar de inmediato en caché local para respuesta ultra-rápida (0ms)
    const localResult = operarEnLocal(action, data);

    if (!cfg.isConfigured) {
      return localResult;
    }
    // Lo que ya es inválido en local no se encola (p. ej. stock insuficiente, cuenta saldada)
    if (localResult && localResult.status === 'error') {
      return localResult;
    }

    // 2. Encolar la mutación en OutboxQueue persistente (con op_id de idempotencia)
    const outboxItem = enqueueOutbox(action, data);

    // Respuesta inmediata con el resultado local (p. ej. "unido" a un producto existente)
    const respuestaEncolada = () => Object.assign({}, localResult, {
      status: 'success',
      isQueued: true,
      message: localResult.message || 'Operación guardada localmente y encolada para sincronización'
    });

    if (!navigator.onLine || !sesionDisponible()) {
      return respuestaEncolada();
    }

    // 3. Enviar la cola en orden hasta procesar esta operación
    const r = await enSerie(() => procesarCola({ hasta: outboxItem.queueId, limite: 50 }));
    const propia = r.resultados[outboxItem.queueId];
    if (propia && clasificarRespuesta(propia) === 'ok') return propia;
    if (propia && clasificarRespuesta(propia) === 'rechazada') {
      return Object.assign({}, propia, { status: 'error', rechazada: true });
    }
    return respuestaEncolada();
  }

  /**
   * Acciones administrativas que nunca pasan por la cola offline (purga, diagnóstico):
   * requieren conexión y se ejecutan una sola vez, en orden con el resto de envíos.
   */
  async function apiDirecto(action, data = {}) {
    const cfg = getConfig();
    if (!cfg.isConfigured || !navigator.onLine) {
      return { status: 'error', message: 'Se necesita conexión a internet para esta acción.' };
    }
    if (!sesionDisponible()) {
      return { status: 'error', code: 'UNAUTHORIZED_RLS', message: 'Inicia sesión nuevamente.' };
    }
    return enSerie(async () => {
      try {
        const json = await enviarOperacion(cfg, { action, data, opId: generarUuid() });
        if (json && json.code === 'UNAUTHORIZED_RLS') notificarSesionVencida();
        return json;
      } catch (e) {
        return { status: 'error', message: 'No se pudo conectar con el servidor: ' + e.message };
      }
    });
  }

  /**
   * Borra todos los datos en Google Sheets y, si el servidor confirma, también en este dispositivo.
   */
  async function purgarTodo(confirmacion) {
    const res = await apiDirecto('resetAllData', { confirmacion: confirmacion || '' });
    if (res && res.status === 'success') {
      limpiarDatosLocales();
    }
    return res;
  }

  function limpiarDatosLocales() {
    [
      'thor_cached_system_data', 'thor_cached_system_data_v2', 'thor_cached_system_data_v3',
      'thor_cached_system_data_v4', STORAGE_KEYS.CACHE_DATA, STORAGE_KEYS.SERVER_SNAPSHOT,
      STORAGE_KEYS.OUTBOX_QUEUE, STORAGE_KEYS.DLQ, STORAGE_KEYS.SYNC_LOG
    ].forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    snapshotEnMemoria = null;
    setCachedData(JSON.parse(JSON.stringify(INITIAL_DEMO_DATA)));
    window.dispatchEvent(new CustomEvent('thor:outbox-updated', { detail: { count: 0 } }));
  }

  function obtenerProximaQuincenaJS(baseDate, step) {
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

  function calcularPlanCuotasJS(montoTotal, abonoInicial, numCuotas, frecuencia, fechaInicio) {
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
        fechaVenc = obtenerProximaQuincenaJS(baseD, i);
      }

      const y = fechaVenc.getFullYear();
      const m = String(fechaVenc.getMonth() + 1).padStart(2, '0');
      const d = String(fechaVenc.getDate()).padStart(2, '0');
      const fechaStr = `${y}-${m}-${d}`;
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

  /**
   * Nombre comparable igual que en el servidor: sin acentos, sin espacios repetidos, en minúsculas.
   */
  function normalizarNombre(str) {
    return String(str || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // Redondeo a centavos para montos de dinero
  function r2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  /**
   * Fecha y hora local en el mismo formato que usa el servidor: yyyy-MM-dd HH:mm:ss
   */
  function fechaLocal(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /**
   * Convierte fechas heredadas (toLocaleString "d/m/aaaa, hh:mm") al formato yyyy-MM-dd HH:mm:ss.
   */
  function normalizarFecha(valor) {
    const s = String(valor || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : fechaLocal(d);
  }

  function estadoPorStock(cantidad, stockMinimo) {
    const min = stockMinimo === undefined || stockMinimo === null || isNaN(parseInt(stockMinimo)) ? 3 : parseInt(stockMinimo);
    return cantidad <= 0 ? 'Agotado' : (cantidad <= min ? 'Stock Bajo' : 'En Stock');
  }

  function stockMinimoValido(valor) {
    const n = parseInt(valor);
    return isNaN(n) || n < 0 ? 3 : n;
  }

  // Precio sugerido para productos nuevos de un tanque sin precio (igual que el backend)
  function precioSugerido(costoDop) {
    return r2((Number(costoDop) || 0) * 1.5);
  }

  /**
   * Aplica una operación en la caché local y la guarda (respuesta inmediata en pantalla).
   */
  function operarEnLocal(action, data) {
    const current = getCachedData();
    const resultado = aplicarOperacion(current, action, data);
    if (resultado && resultado.status === 'success' && !resultado.sinCambios) {
      recalcularMetricasLocales(current);
      setCachedData(current);
    }
    return resultado;
  }

  /**
   * Aplica una operación sobre un objeto de datos (caché o copia de la foto del servidor),
   * reproduciendo las mismas reglas que el backend.
   */
  function aplicarOperacion(current, action, data) {
    if (!current.inventario) current.inventario = [];
    if (!current.ventas) current.ventas = [];
    if (!current.recepciones) current.recepciones = [];
    if (!current.cobros) current.cobros = [];

    if (action === 'saveProduct') {
      const p = data;
      const id = p.id || generarId('PROD');
      p.id = id;
      const costoUsd = parseFloat(p.costo_usd) || 0;
      const costoDop = parseFloat(p.costo_dop) || (costoUsd * getUsdRate());
      const precio = parseFloat(p.precio_venta_dop) || 0;
      const cantidadNueva = parseInt(p.cantidad) || 0;
      if (cantidadNueva < 0) return { status: 'error', message: 'La cantidad no puede ser negativa' };
      if (costoUsd < 0 || costoDop < 0 || precio < 0) return { status: 'error', message: 'Los costos y el precio no pueden ser negativos' };

      const campos = {
        id: id,
        nombre: String(p.nombre || '').trim(),
        categoria: p.categoria || 'Variedades',
        descripcion: p.descripcion || '',
        stock_minimo: stockMinimoValido(p.stock_minimo),
        costo_usd: costoUsd,
        costo_dop: costoDop,
        precio_venta_dop: precio,
        ubicacion: p.ubicacion || 'Almacén Principal',
        fecha_actualizacion: fechaLocal()
      };

      const existente = current.inventario.find(x => x.id === id);
      if (existente) {
        // Al editar, la cantidad NO se toca: el stock solo cambia con ajustes, ventas y tanques
        Object.assign(existente, campos);
        existente.estado = estadoPorStock(existente.cantidad, existente.stock_minimo);
        return { status: 'success', message: 'Producto actualizado', id: id };
      }
      const mismoNombre = current.inventario.find(x => normalizarNombre(x.nombre) === normalizarNombre(campos.nombre));
      if (mismoNombre) {
        mismoNombre.cantidad = (parseInt(mismoNombre.cantidad) || 0) + cantidadNueva;
        mismoNombre.estado = estadoPorStock(mismoNombre.cantidad, mismoNombre.stock_minimo);
        return { status: 'success', message: `Ya existía "${mismoNombre.nombre}": se sumaron ${cantidadNueva} unidad(es)`, id: mismoNombre.id, unido: true };
      }
      current.inventario.unshift(Object.assign(campos, {
        cantidad: cantidadNueva,
        estado: estadoPorStock(cantidadNueva, campos.stock_minimo),
        fecha_ingreso: fechaLocal()
      }));
      return { status: 'success', message: 'Producto guardado', id: id };
    }

    if (action === 'deleteProduct') {
      const id = (data && typeof data === 'object') ? data.id : data;
      current.inventario = current.inventario.filter(x => x.id !== id);
      return { status: 'success', message: 'Producto eliminado' };
    }

    if (action === 'adjustStock') {
      const item = current.inventario.find(x => x.id === data.id);
      if (!item) return { status: 'error', message: 'Producto no encontrado' };
      const delta = parseInt(data.delta);
      if (isNaN(delta)) return { status: 'error', message: 'Ajuste inválido' };
      item.cantidad = Math.max(0, (parseInt(item.cantidad) || 0) + delta);
      item.estado = estadoPorStock(item.cantidad, item.stock_minimo);
      item.fecha_actualizacion = fechaLocal();
      return { status: 'success', message: 'Stock actualizado', nuevoStock: item.cantidad };
    }

    if (action === 'registerSale') {
      const v = data;
      if (current.ventas.some(x => x.id_venta === v.id_venta)) {
        return { status: 'success', sinCambios: true, id_venta: v.id_venta, message: 'Venta ya registrada' };
      }
      const prod = current.inventario.find(x => x.id === v.id_articulo);
      if (!prod) return { status: 'error', message: 'Producto no encontrado' };

      const cant = parseInt(v.cantidad);
      if (isNaN(cant) || cant <= 0) return { status: 'error', message: 'Cantidad inválida' };
      if (prod.cantidad < cant) return { status: 'error', message: `Stock insuficiente: solo quedan ${prod.cantidad} unidades` };

      const precioUnitario = parseFloat(v.precio_unitario_dop) || prod.precio_venta_dop;
      const abonoInicial = parseFloat(v.abono_inicial) || 0;
      if (precioUnitario < 0) return { status: 'error', message: 'El precio no puede ser negativo' };
      if (abonoInicial < 0) return { status: 'error', message: 'El abono inicial no puede ser negativo' };

      prod.cantidad -= cant;
      prod.estado = estadoPorStock(prod.cantidad, prod.stock_minimo);

      const total = r2(precioUnitario * cant);
      const ganancia = r2(total - (prod.costo_dop || 0) * cant);

      const esCredito = esVentaCredito(v);
      const metodoPago = esCredito ? 'Crédito / Fiado' : (v.metodo_pago || 'Efectivo');
      const clienteNombre = String(v.cliente || 'Consumidor Final').trim();
      const clienteTel = v.telefono || '';
      const ahora = new Date();

      const nuevaVenta = {
        id_venta: v.id_venta || generarId('VTA'),
        fecha_venta: fechaLocal(ahora),
        id_articulo: prod.id,
        nombre_articulo: prod.nombre,
        categoria: prod.categoria,
        cantidad: cant,
        precio_unitario_dop: precioUnitario,
        total_dop: total,
        costo_unitario_dop: prod.costo_dop,
        ganancia_dop: ganancia,
        cliente: clienteNombre,
        telefono: clienteTel,
        metodo_pago: metodoPago,
        notas: v.notas || '',
        estado: esCredito ? 'Pendiente de Cobro' : 'Completada'
      };
      current.ventas.unshift(nuevaVenta);

      let nuevoCobro = null;
      if (esCredito) {
        const saldoPendiente = r2(Math.max(0, total - abonoInicial));
        const numCuotas = parseInt(v.num_cuotas) || 2;
        const frecuencia = v.frecuencia || 'quincenal';
        const planCuotas = calcularPlanCuotasJS(total, abonoInicial, numCuotas, frecuencia, ahora);
        const historialAbonos = [];
        if (abonoInicial > 0) {
          historialAbonos.push({
            id_abono: v.id_abono_inicial || generarId('ABN'),
            fecha: fechaLocal(ahora),
            monto: abonoInicial,
            metodo_pago: 'Efectivo',
            nota: 'Abono inicial en venta'
          });
        }
        const primerPendiente = planCuotas.find(c => c.estado === 'Pendiente');

        nuevoCobro = {
          id_cobro: v.id_cobro || generarId('COB'),
          id_venta: nuevaVenta.id_venta,
          fecha_venta: nuevaVenta.fecha_venta,
          cliente: clienteNombre,
          telefono: clienteTel,
          articulo: prod.nombre,
          monto_total_dop: total,
          abono_inicial_dop: abonoInicial,
          total_cobrado_dop: abonoInicial,
          saldo_pendiente_dop: saldoPendiente,
          num_cuotas: numCuotas,
          frecuencia: frecuencia,
          estado: saldoPendiente <= 0 ? 'Saldada' : (abonoInicial > 0 ? 'Parcial' : 'Pendiente'),
          proximo_vencimiento: primerPendiente ? primerPendiente.fecha_vencimiento : '',
          historial_abonos: historialAbonos,
          plan_cuotas: planCuotas
        };
        current.cobros.unshift(nuevoCobro);
      }

      return {
        status: 'success',
        message: esCredito ? 'Venta a crédito ("fiado") registrada con éxito.' : 'Venta registrada con éxito',
        id_venta: nuevaVenta.id_venta,
        stock_restante: prod.cantidad,
        total_dop: total,
        ganancia_dop: ganancia,
        cobro: nuevoCobro
      };
    }

    if (action === 'registerPayment') {
      const { id_cobro, id_abono, monto, metodo_pago, nota } = data;
      const cobro = current.cobros.find(x => x.id_cobro === id_cobro);
      if (!cobro) return { status: 'error', message: 'Cuenta por cobrar no encontrada' };

      const montoAbono = parseFloat(monto) || 0;
      if (montoAbono <= 0) return { status: 'error', message: 'El monto debe ser mayor a 0' };
      if (id_abono && (cobro.historial_abonos || []).some(a => a && a.id_abono === id_abono)) {
        return { status: 'success', sinCambios: true, message: 'Abono ya registrado', cobro: cobro };
      }
      if (cobro.estado === 'Cancelada') return { status: 'error', message: 'Esta cuenta fue anulada junto con su venta' };
      if ((parseFloat(cobro.saldo_pendiente_dop) || 0) <= 0) return { status: 'error', message: 'Esta cuenta ya está totalmente saldada' };

      const abonoEfectivo = r2(Math.min(montoAbono, cobro.saldo_pendiente_dop));
      cobro.total_cobrado_dop = r2((parseFloat(cobro.total_cobrado_dop) || 0) + abonoEfectivo);
      cobro.saldo_pendiente_dop = r2(Math.max(0, cobro.monto_total_dop - cobro.total_cobrado_dop));

      const fechaStr = fechaLocal();
      if (!cobro.historial_abonos) cobro.historial_abonos = [];
      cobro.historial_abonos.push({
        id_abono: id_abono || generarId('ABN'),
        fecha: fechaStr,
        monto: abonoEfectivo,
        metodo_pago: metodo_pago || 'Efectivo',
        nota: nota || 'Abono a cuenta'
      });

      // Distribuir entre cuotas (con tolerancia de medio centavo)
      let rem = abonoEfectivo;
      (cobro.plan_cuotas || []).forEach(c => {
        if (c.estado === 'Cobrada' || rem <= 0) return;
        const falta = r2((parseFloat(c.monto) || 0) - (parseFloat(c.monto_abonado) || 0));
        if (rem >= falta - 0.005) {
          c.monto_abonado = parseFloat(c.monto) || 0;
          c.estado = 'Cobrada';
          c.fecha_pago = fechaStr;
          rem = r2(rem - falta);
        } else {
          c.monto_abonado = r2((parseFloat(c.monto_abonado) || 0) + rem);
          c.estado = 'Parcial';
          rem = 0;
        }
      });

      const primerPendiente = (cobro.plan_cuotas || []).find(c => c.estado !== 'Cobrada');
      cobro.proximo_vencimiento = primerPendiente ? primerPendiente.fecha_vencimiento : '';
      cobro.estado = cobro.saldo_pendiente_dop <= 0 ? 'Saldada' : 'Parcial';

      if (cobro.saldo_pendiente_dop <= 0 && cobro.id_venta) {
        const v = current.ventas.find(x => x.id_venta === cobro.id_venta);
        if (v) v.estado = 'Completada';
      }

      return {
        status: 'success',
        message: cobro.saldo_pendiente_dop <= 0
          ? '¡Cuenta saldada en su totalidad! RD$ 0.00 restante.'
          : `Abono de RD$ ${abonoEfectivo.toFixed(2)} registrado. Saldo pendiente: RD$ ${cobro.saldo_pendiente_dop.toFixed(2)}`,
        cobro: cobro
      };
    }

    if (action === 'cancelSale') {
      const v = current.ventas.find(x => x.id_venta === data.id_venta);
      if (!v) return { status: 'error', message: 'Venta no encontrada' };
      if (v.estado === 'Cancelada') return { status: 'success', sinCambios: true, message: 'La venta ya estaba anulada' };

      v.estado = 'Cancelada';
      const prod = current.inventario.find(x => x.id === v.id_articulo);
      if (prod) {
        prod.cantidad = (parseInt(prod.cantidad) || 0) + (parseInt(v.cantidad) || 0);
        prod.estado = estadoPorStock(prod.cantidad, prod.stock_minimo);
      }
      const cob = current.cobros.find(x => x.id_venta === data.id_venta);
      if (cob) {
        cob.estado = 'Cancelada';
        cob.saldo_pendiente_dop = 0;
      }
      return { status: 'success', message: 'Venta anulada y stock devuelto' };
    }

    if (action === 'registerReception') {
      const rec = data;
      if (rec.id_recepcion && current.recepciones.some(r => r.id_recepcion === rec.id_recepcion)) {
        return { status: 'success', sinCambios: true, message: 'Tanque ya registrado', total_unidades: 0 };
      }
      const items = rec.articulos || [];
      const tasa = parseFloat(rec.tasa_cambio) || getUsdRate();
      // Misma normalización de nombres que registrarRecepcionTanque() en el backend
      const norm = normalizarNombre;

      let totalUnidades = 0;
      items.forEach(item => {
        const c = parseInt(item.cantidad) || 0;
        if (c > 0) totalUnidades += c;
      });
      const fleteUsd = parseFloat(rec.flete_usd) || 0;
      const prorratear = String((current.configuracion || {}).PRORRATEAR_FLETE || 'NO').toUpperCase() === 'SI';
      const fletePorUnidadUsd = prorratear && totalUnidades > 0 ? fleteUsd / totalUnidades : 0;

      items.forEach(item => {
        const cant = parseInt(item.cantidad) || 0;
        if (cant <= 0) return;

        let costoUsd = Math.max(0, parseFloat(item.costo_usd) || 0);
        let costoDop = Math.max(0, parseFloat(item.costo_dop) || (costoUsd * tasa));
        if (fletePorUnidadUsd > 0) {
          costoUsd = r2(costoUsd + fletePorUnidadUsd);
          costoDop = r2(costoDop + fletePorUnidadUsd * tasa);
        }
        const precioIndicado = Math.max(0, parseFloat(item.precio_venta_dop) || 0);

        const existing = (item.id && current.inventario.find(x => x.id === item.id)) ||
          (item.nombre && current.inventario.find(x => norm(x.nombre) === norm(item.nombre)));

        if (existing) {
          // El servidor recibe el ID del producto existente y suma sobre él
          item.id = existing.id;
          existing.cantidad = (parseInt(existing.cantidad) || 0) + cant;
          if (costoUsd > 0) existing.costo_usd = costoUsd;
          if (costoDop > 0) existing.costo_dop = costoDop;
          if (precioIndicado > 0) existing.precio_venta_dop = precioIndicado;
          existing.estado = estadoPorStock(existing.cantidad, existing.stock_minimo);
          existing.ubicacion = rec.nombre_tanque;
          existing.fecha_actualizacion = fechaLocal();
        } else {
          // Producto nuevo: el ID se genera aquí y el servidor lo respeta
          if (!item.id) item.id = generarId('PROD');
          current.inventario.unshift({
            id: item.id,
            nombre: String(item.nombre || '').trim(),
            categoria: item.categoria || 'Variedades',
            descripcion: 'Tanque: ' + rec.nombre_tanque,
            cantidad: cant,
            stock_minimo: 3,
            costo_usd: costoUsd,
            costo_dop: costoDop,
            precio_venta_dop: precioIndicado > 0 ? precioIndicado : precioSugerido(costoDop),
            ubicacion: rec.nombre_tanque,
            estado: estadoPorStock(cant, 3),
            fecha_ingreso: fechaLocal(),
            fecha_actualizacion: fechaLocal()
          });
        }
      });

      // Igual que en el servidor: cada envío es una recepción propia (la UI agrupa por nombre de tanque)
      current.recepciones.unshift({
        id_recepcion: rec.id_recepcion || generarId('TANQ'),
        fecha: fechaLocal(),
        nombre_tanque: rec.nombre_tanque,
        origen: rec.origen || 'EE.UU.',
        total_unidades: totalUnidades,
        flete_usd: fleteUsd,
        tasa_cambio: tasa,
        notas: rec.notas || '',
        articulos: items
      });

      return {
        status: 'success',
        message: 'Tanque recibido registrado con éxito: ' + totalUnidades + ' unidades ingresadas.',
        total_unidades: totalUnidades
      };
    }

    return { status: 'success', sinCambios: true, message: 'Acción ejecutada en modo local' };
  }

  function recalcularMetricasLocales(data) {
    let totalUnidades = 0;
    let costoTotal = 0;
    let ventaTotal = 0;
    let stockBajo = 0;
    let agotados = 0;

    data.inventario.forEach(p => {
      const cant = parseInt(p.cantidad) || 0;
      totalUnidades += cant;
      costoTotal += cant * (p.costo_dop || 0);
      ventaTotal += cant * (p.precio_venta_dop || 0);
      if (cant === 0) agotados++;
      else if (cant <= stockMinimoValido(p.stock_minimo)) stockBajo++;
    });

    // "Hoy" y "este mes" según la hora local del dispositivo (no UTC)
    const hoy = fechaLocal().substring(0, 10);
    const mes = hoy.substring(0, 7);
    let ventasHoy = 0, gananciaHoy = 0, ventasMes = 0, gananciaMes = 0;
    (data.ventas || []).forEach(v => {
      if (v.estado === 'Cancelada') return;
      const f = normalizarFecha(v.fecha_venta);
      if (f.startsWith(hoy)) {
        ventasHoy += Number(v.total_dop) || 0;
        gananciaHoy += Number(v.ganancia_dop) || 0;
      }
      if (f.startsWith(mes)) {
        ventasMes += Number(v.total_dop) || 0;
        gananciaMes += Number(v.ganancia_dop) || 0;
      }
    });

    if (!data.cobros) data.cobros = [];
    let totalPorCobrar = 0;
    let cuotasPendientesHoy = 0;
    let clientesConDeuda = 0;
    data.cobros.forEach(c => {
      if (c.estado === 'Saldada' || c.estado === 'Cancelada') return;
      totalPorCobrar += parseFloat(c.saldo_pendiente_dop) || 0;
      clientesConDeuda++;
      if (c.proximo_vencimiento && c.proximo_vencimiento <= hoy) cuotasPendientesHoy++;
    });

    data.metricas = {
      total_productos: data.inventario.length,
      total_unidades_stock: totalUnidades,
      valor_inventario_costo_dop: Math.round(costoTotal),
      valor_inventario_venta_dop: Math.round(ventaTotal),
      productos_stock_bajo: stockBajo,
      productos_agotados: agotados,
      ventas_hoy_dop: Math.round(ventasHoy),
      ganancia_hoy_dop: Math.round(gananciaHoy),
      ventas_mes_dop: Math.round(ventasMes),
      ganancia_mes_dop: Math.round(gananciaMes),
      total_por_cobrar_dop: Math.round(totalPorCobrar),
      cuotas_pendientes_hoy: cuotasPendientesHoy,
      clientes_con_deuda: clientesConDeuda
    };
  }

  async function testConnection(url, token) {
    try {
      const testUrl = new URL(url.trim());
      testUrl.searchParams.append('action', 'ping');
      testUrl.searchParams.append('token', token.trim());

      const res = await fetch(testUrl.toString());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      return json.status === 'success';
    } catch (e) {
      console.error('Fallo de conexión:', e);
      return false;
    }
  }




  return {
    getConfig,
    saveCredentials,
    getUsdRate,
    setUsdRate,
    fetchLiveExchangeRate,
    getCachedData,
    setCachedData,
    limpiarDatosLocales,
    testConnection,
    // Autenticación & Sesiones en Servidor (RLS)
    login,
    logout,
    silentRelogin,
    getSessionToken,
    getCurrentUser,
    isAuthenticated,
    clearSession,
    // Operaciones protegidas por RLS
    fetchAllData: async (force = false) => {
      const now = Date.now();
      // M6 FIX: Deduplicar peticiones simultáneas en vuelo
      if (inFlightFetchAll) {
        return inFlightFetchAll;
      }
      // M6 FIX: Throttling inteligente ante clics continuos en sincronizar (< 2.5 seg)
      if (!force && (now - lastFetchAllTimestamp < 2500)) {
        return { status: 'success', data: getCachedData(), isThrottled: true };
      }

      lastFetchAllTimestamp = now;
      inFlightFetchAll = (async () => {
        try {
          const res = await apiGet('getAllData');
          if (res && res.status === 'success' && res.data) {
            // Operaciones que el servidor ya aplicó (p. ej. respuesta perdida): no deben re-aplicarse
            const aplicadas = new Set(res.data.ops_aplicadas || []);
            if (aplicadas.size) {
              const queue = getOutbox();
              const restantes = queue.filter(q => !aplicadas.has(q.opId));
              if (restantes.length !== queue.length) {
                saveOutbox(restantes);
                window.dispatchEvent(new CustomEvent('thor:outbox-updated', { detail: { count: restantes.length } }));
              }
            }
            setSnapshot(res.data);
            res.data = reconstruirCache();
            reintentarRecuperacionAutomatica();
          }
          return res;
        } finally {
          inFlightFetchAll = null;
        }
      })();

      return inFlightFetchAll;
    },
    fetchCobros: () => apiGet('getCobros'),
    saveProduct: (p) => apiPost('saveProduct', p),
    deleteProduct: (id) => apiPost('deleteProduct', id),
    adjustStock: (id, delta, motivo) => apiPost('adjustStock', { id, delta, motivo }),
    registerSale: (v) => apiPost('registerSale', v),
    registerPayment: (p) => apiPost('registerPayment', p),
    cancelSale: (id_venta) => apiPost('cancelSale', { id_venta }),
    registerReception: (r) => apiPost('registerReception', r),
    saveConfig: (c) => apiPost('saveConfig', c),
    calcularPlanCuotas: calcularPlanCuotasJS,
    fechaLocal,
    normalizarFecha,
    obtenerProximaQuincena: obtenerProximaQuincenaJS,
    // Confiabilidad, Cola Outbox y Autoconciliación
    flushOutbox,
    getPendingOutboxCount: () => getOutbox().length,
    reconcileWithCloud: () => apiDirecto('reconcileInventory', {}),
    resetSystemData: purgarTodo,
    getDeadLetterQueue,
    clearDeadLetterQueue: () => localStorage.removeItem(STORAGE_KEYS.DLQ),
    reintentarRecuperacion,
    getHistorialSync,
    marcarHistorialVisto,
    contarPorRevisar,
    normalizarNombre,
    enqueueOutbox,
    generarId,
    DEFAULT_CATEGORIES
  };
})();
