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
        <div class="text-xs font-semibold text-slate-100">${message}</div>
      </div>
      <button class="text-slate-400 hover:text-slate-200 text-xs shrink-0 pl-2">✕</button>
    `;

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
    CACHE_DATA: 'thor_cached_system_data_v5'
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

  function getCachedData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CACHE_DATA);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error('Error leyendo caché:', e);
    }
    return INITIAL_DEMO_DATA;
  }

  function setCachedData(data) {
    try {
      localStorage.setItem(STORAGE_KEYS.CACHE_DATA, JSON.stringify(data));
    } catch (e) {
      console.error('Error guardando en caché:', e);
    }
  }

  /**
   * Iniciar Sesión de Pamela en el Servidor
   */
  async function login(username, password, remember = true) {
    const cfg = getConfig();
    if (!cfg.isConfigured) {
      // Modo local simulado
      if (username.trim() === 'Pameladlsantos' && password === 'Thorayka2419') {
        const fakeToken = 'LOCAL_SES_' + Date.now();
        const user = { username: 'Pameladlsantos', nombre: 'Pamela De Los Santos', rol: 'Administradora' };
        setSession(fakeToken, user, remember);
  return { success: true, user: user, token: fakeToken };
      }
return { success: false, message: 'Usuario o contraseña incorrectos.' };
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
      // Fallback si hay desconexión temporal de internet
      if (username.trim() === 'Pameladlsantos' && password === 'Thorayka2419') {
        const offlineToken = 'OFFLINE_SES_' + Date.now();
        const user = { username: 'Pameladlsantos', nombre: 'Pamela De Los Santos', rol: 'Administradora' };
        setSession(offlineToken, user, remember);
  return { success: true, user: user, isOffline: true };
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

  async function apiGet(action, extraParams = {}) {
    const cfg = getConfig();
    if (!cfg.isConfigured) {
return { status: 'success', data: getCachedData() };
    }

    const url = new URL(cfg.gasUrl);
    url.searchParams.append('action', action);
    url.searchParams.append('token', cfg.sessionToken);

    for (let k in extraParams) {
      url.searchParams.append(k, extraParams[k]);
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      const json = await response.json();
      if (json && json.code === 'UNAUTHORIZED_RLS') {
        clearSession();
        window.dispatchEvent(new CustomEvent('thor:session-expired'));
      }
      return json;
    } catch (e) {
      console.warn('apiGet red caída, usando caché local:', e);
return { status: 'success', data: getCachedData(), isCachedFallback: true };
    }
  }

  async function apiPost(action, data = {}) {
    const cfg = getConfig();
    if (!cfg.isConfigured) {
      return operarEnLocal(action, data);
    }

    const payload = {
      action: action,
      token: cfg.sessionToken,
      data: data
    };

    try {
      const response = await fetch(cfg.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      const json = await response.json();
      if (json && json.code === 'UNAUTHORIZED_RLS') {
        clearSession();
        window.dispatchEvent(new CustomEvent('thor:session-expired'));
      }
      return json;
    } catch (e) {
      console.warn('apiPost red caída, aplicando en modo local:', e);
      return operarEnLocal(action, data);
    }
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

  function operarEnLocal(action, data) {
    const current = getCachedData();

    if (action === 'saveProduct') {
      const p = data;
      const id = p.id || ('PROD-' + Date.now().toString().slice(-6));
      p.id = id;
      p.costo_usd = parseFloat(p.costo_usd) || 0;
      p.costo_dop = parseFloat(p.costo_dop) || (p.costo_usd * getUsdRate());
      p.precio_venta_dop = parseFloat(p.precio_venta_dop) || 0;
      p.cantidad = parseInt(p.cantidad) || 0;
      p.stock_minimo = parseInt(p.stock_minimo) || 3;
      p.estado = p.cantidad > 0 ? 'En Stock' : 'Agotado';
      p.fecha_actualizacion = new Date().toLocaleString();

      const idx = current.inventario.findIndex(x => x.id === id);
      if (idx >= 0) {
        current.inventario[idx] = { ...current.inventario[idx], ...p };
      } else {
        p.fecha_ingreso = new Date().toLocaleString();
        current.inventario.unshift(p);
      }
      recalcularMetricasLocales(current);
      setCachedData(current);
return { status: 'success', message: 'Producto guardado en modo local', id: id };
    }

    if (action === 'deleteProduct') {
      current.inventario = current.inventario.filter(x => x.id !== data);
      recalcularMetricasLocales(current);
      setCachedData(current);
return { status: 'success', message: 'Producto eliminado' };
    }

    if (action === 'adjustStock') {
      const item = current.inventario.find(x => x.id === data.id);
      if (item) {
        item.cantidad = Math.max(0, item.cantidad + parseInt(data.delta));
        item.estado = item.cantidad > 0 ? 'En Stock' : 'Agotado';
        recalcularMetricasLocales(current);
        setCachedData(current);
  return { status: 'success', message: 'Stock actualizado', nuevoStock: item.cantidad };
      }
return { status: 'error', message: 'Producto no encontrado' };
    }

    if (action === 'registerSale') {
      const v = data;
      const prod = current.inventario.find(x => x.id === v.id_articulo);
      if (!prod) return { status: 'error', message: 'Producto no encontrado' };

      const cant = parseInt(v.cantidad);
      if (prod.cantidad < cant) return { status: 'error', message: 'Stock insuficiente' };

      prod.cantidad -= cant;
      prod.estado = prod.cantidad > 0 ? 'En Stock' : 'Agotado';

      const precioUnitario = parseFloat(v.precio_unitario_dop) || prod.precio_venta_dop;
      const total = precioUnitario * cant;
      const costo = (prod.costo_dop || 0) * cant;
      const ganancia = total - costo;

      const esCredito = (v.tipo_venta === 'credito' || v.metodo_pago === 'Crédito' || v.metodo_pago === 'Fiado' || v.es_credito === true);
      const estadoVenta = esCredito ? 'Pendiente de Cobro' : 'Completada';
      const metodoPago = esCredito ? 'Crédito / Fiado' : (v.metodo_pago || 'Efectivo');
      const clienteNombre = v.cliente || 'Cliente General';
      const clienteTel = v.telefono || '';

      const nuevaVenta = {
        id_venta: 'VTA-' + Date.now().toString().slice(-6),
        fecha_venta: new Date().toLocaleString(),
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
        notas: v.notas || (esCredito ? `${v.num_cuotas || 2} cuotas ${v.frecuencia || 'quincenal'}` : ''),
        estado: estadoVenta
      };

      current.ventas.unshift(nuevaVenta);

      let nuevoCobro = null;
      if (esCredito) {
        if (!current.cobros) current.cobros = [];
        const abonoInicial = parseFloat(v.abono_inicial) || 0;
        const saldoPendiente = Math.max(0, total - abonoInicial);
        const numCuotas = parseInt(v.num_cuotas) || 2;
        const frecuencia = v.frecuencia || 'quincenal';

        const planCuotas = calcularPlanCuotasJS(total, abonoInicial, numCuotas, frecuencia, new Date());
        const historialAbonos = [];
        if (abonoInicial > 0) {
          historialAbonos.push({
            id_abono: 'ABN-INI-' + Date.now(),
            fecha: new Date().toLocaleString(),
            monto: abonoInicial,
            metodo_pago: 'Efectivo',
            nota: 'Abono inicial en venta'
          });
        }

        let proximoVencimiento = '';
        const primerPendiente = planCuotas.find(c => c.estado === 'Pendiente');
        if (primerPendiente) proximoVencimiento = primerPendiente.fecha_vencimiento;

        nuevoCobro = {
          id_cobro: 'COB-' + Date.now().toString().slice(-6),
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
          proximo_vencimiento: proximoVencimiento,
          historial_abonos: historialAbonos,
          plan_cuotas: planCuotas
        };

        current.cobros.unshift(nuevoCobro);
      }

      recalcularMetricasLocales(current);
      setCachedData(current);

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
      if (!current.cobros) current.cobros = [];
      const { id_cobro, monto, metodo_pago, nota } = data;
      const cobro = current.cobros.find(x => x.id_cobro === id_cobro);
      if (!cobro) return { status: 'error', message: 'Cuenta por cobrar no encontrada' };

      const montoAbono = parseFloat(monto) || 0;
      if (montoAbono <= 0) return { status: 'error', message: 'El monto debe ser mayor a 0' };

      const abonoEfectivo = Math.min(montoAbono, cobro.saldo_pendiente_dop);
      cobro.total_cobrado_dop = (cobro.total_cobrado_dop || 0) + abonoEfectivo;
      cobro.saldo_pendiente_dop = Math.max(0, cobro.monto_total_dop - cobro.total_cobrado_dop);

      const fechaStr = new Date().toLocaleString();
      if (!cobro.historial_abonos) cobro.historial_abonos = [];
      cobro.historial_abonos.push({
        id_abono: 'ABN-' + Date.now(),
        fecha: fechaStr,
        monto: abonoEfectivo,
        metodo_pago: metodo_pago || 'Efectivo',
        nota: nota || 'Abono a cuenta'
      });

      // Distribuir entre cuotas
      let rem = abonoEfectivo;
      if (cobro.plan_cuotas) {
        for (let i = 0; i < cobro.plan_cuotas.length; i++) {
          if (cobro.plan_cuotas[i].estado !== 'Cobrada') {
            const montoCuota = parseFloat(cobro.plan_cuotas[i].monto) || 0;
            const yaAbonado = parseFloat(cobro.plan_cuotas[i].monto_abonado) || 0;
            const falta = montoCuota - yaAbonado;

            if (rem >= falta) {
              cobro.plan_cuotas[i].monto_abonado = montoCuota;
              cobro.plan_cuotas[i].estado = 'Cobrada';
              cobro.plan_cuotas[i].fecha_pago = fechaStr;
              rem -= falta;
            } else if (rem > 0) {
              cobro.plan_cuotas[i].monto_abonado = yaAbonado + rem;
              cobro.plan_cuotas[i].estado = 'Parcial';
              rem = 0;
            }
          }
        }
      }

      const primerPendiente = (cobro.plan_cuotas || []).find(c => c.estado !== 'Cobrada');
      cobro.proximo_vencimiento = primerPendiente ? primerPendiente.fecha_vencimiento : '';
      cobro.estado = cobro.saldo_pendiente_dop <= 0 ? 'Saldada' : 'Parcial';

      if (cobro.saldo_pendiente_dop <= 0 && cobro.id_venta) {
        const v = current.ventas.find(x => x.id_venta === cobro.id_venta);
        if (v) v.estado = 'Completada';
      }

      recalcularMetricasLocales(current);
      setCachedData(current);

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
      if (v && v.estado !== 'Cancelada') {
        v.estado = 'Cancelada';
        const prod = current.inventario.find(x => x.id === v.id_articulo);
        if (prod) {
          prod.cantidad += v.cantidad;
          prod.estado = 'En Stock';
        }
        if (current.cobros) {
          const cob = current.cobros.find(x => x.id_venta === data.id_venta);
          if (cob) cob.estado = 'Cancelada';
        }
        recalcularMetricasLocales(current);
        setCachedData(current);
  return { status: 'success', message: 'Venta cancelada y stock devuelto' };
      }
return { status: 'error', message: 'Venta no encontrada o ya cancelada' };
    }

    if (action === 'registerReception') {
      const rec = data;
      const items = rec.articulos || [];
      const tasa = parseFloat(rec.tasa_cambio) || getUsdRate();
      let totalUnidades = 0;

      items.forEach(item => {
        const cant = parseInt(item.cantidad) || 0;
        if (cant <= 0) return;
        totalUnidades += cant;

        const costoUsd = parseFloat(item.costo_usd) || 0;
        const costoDop = parseFloat(item.costo_dop) || (costoUsd * tasa);
        const precioVentaDop = parseFloat(item.precio_venta_dop) || (costoDop * 1.5);

        let existing = current.inventario.find(x => x.id === item.id || (item.nombre && x.nombre.trim().toLowerCase() === item.nombre.trim().toLowerCase()));

        if (existing) {
          existing.cantidad += cant;
          if (costoUsd > 0) existing.costo_usd = costoUsd;
          if (costoDop > 0) existing.costo_dop = costoDop;
          if (precioVentaDop > 0) existing.precio_venta_dop = precioVentaDop;
          existing.estado = 'En Stock';
          existing.ubicacion = rec.nombre_tanque;
        } else {
          current.inventario.unshift({
            id: 'PROD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100),
            nombre: item.nombre,
            categoria: item.categoria || 'Variedades',
            descripcion: item.descripcion || '',
            cantidad: cant,
            stock_minimo: parseInt(item.stock_minimo) || 3,
            costo_usd: costoUsd,
            costo_dop: costoDop,
            precio_venta_dop: precioVentaDop,
            ubicacion: rec.nombre_tanque,
            estado: 'En Stock',
            fecha_ingreso: new Date().toLocaleString(),
            fecha_actualizacion: new Date().toLocaleString()
          });
        }
      });

      const nuevaRec = {
        id_recepcion: 'TANQ-' + Date.now().toString().slice(-6),
        fecha: rec.fecha || new Date().toISOString().substring(0, 10),
        nombre_tanque: rec.nombre_tanque,
        origen: rec.origen || 'EE.UU.',
        total_unidades: totalUnidades,
        flete_usd: parseFloat(rec.flete_usd) || 0,
        tasa_cambio: tasa,
        notas: rec.notas || '',
        articulos: items
      };

      current.recepciones.unshift(nuevaRec);
      recalcularMetricasLocales(current);
      setCachedData(current);

return {
        status: 'success',
        message: 'Tanque recibido registrado con éxito: ' + totalUnidades + ' unidades ingresadas.',
        total_unidades: totalUnidades
      };
    }

  

  return { status: 'success', message: 'Acción ejecutada en modo local' };
  }

  function recalcularMetricasLocales(data) {
    let totalProd = data.inventario.length;
    let totalUnidades = 0;
    let costoTotal = 0;
    let ventaTotal = 0;
    let stockBajo = 0;
    let agotados = 0;

    data.inventario.forEach(p => {
      totalUnidades += p.cantidad;
      costoTotal += (p.cantidad * (p.costo_dop || 0));
      ventaTotal += (p.cantidad * (p.precio_venta_dop || 0));
      if (p.cantidad === 0) agotados++;
      else if (p.cantidad <= p.stock_minimo) stockBajo++;
    });

    let ventasMes = 0;
    let gananciaMes = 0;
    data.ventas.forEach(v => {
      if (v.estado !== 'Cancelada') {
        ventasMes += v.total_dop;
        gananciaMes += v.ganancia_dop;
      }
    });

    if (!data.cobros) data.cobros = [];
    let totalPorCobrar = 0;
    let cuotasPendientesHoy = 0;
    let clientesConDeuda = 0;
    const hoyStr = new Date().toISOString().substring(0, 10);

    data.cobros.forEach(c => {
      if (c.estado !== 'Saldada' && c.estado !== 'Cancelada') {
        totalPorCobrar += (parseFloat(c.saldo_pendiente_dop) || 0);
        clientesConDeuda++;
        if (c.proximo_vencimiento && c.proximo_vencimiento <= hoyStr) {
          cuotasPendientesHoy++;
        }
      }
    });

    data.metricas = {
      total_productos: totalProd,
      total_unidades_stock: totalUnidades,
      valor_inventario_costo_dop: Math.round(costoTotal),
      valor_inventario_venta_dop: Math.round(ventaTotal),
      productos_stock_bajo: stockBajo,
      productos_agotados: agotados,
      ventas_hoy_dop: 0,
      ganancia_hoy_dop: 0,
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



  function resetSystemData() {
    try {
      localStorage.removeItem('thor_cached_system_data');
      localStorage.removeItem('thor_cached_system_data_v2');
      localStorage.removeItem('thor_cached_system_data_v3');
      localStorage.removeItem('thor_cached_system_data_v4');
      localStorage.removeItem('thor_cached_system_data_v5');
      setCachedData(INITIAL_DEMO_DATA);
      return { success: true };
    } catch (e) {
      console.error('Error al resetear datos:', e);
      return { success: false, error: e.message };
    }
  }

  return {
    getConfig,
    saveCredentials,
    getUsdRate,
    setUsdRate,
    fetchLiveExchangeRate,
    getCachedData,
    resetSystemData,
    setCachedData,
    testConnection,
    // Autenticación & Sesiones en Servidor (RLS)
    login,
    logout,
    getSessionToken,
    getCurrentUser,
    isAuthenticated,
    clearSession,
    // Operaciones protegidas por RLS
    fetchAllData: () => apiGet('getAllData'),
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
    obtenerProximaQuincena: obtenerProximaQuincenaJS,
    DEFAULT_CATEGORIES
  };
})();
