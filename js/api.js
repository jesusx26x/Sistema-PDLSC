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
    SECURITY_TOKEN: 'thor_security_token',
    USD_RATE: 'thor_usd_dop_rate',
    CACHE_DATA: 'thor_cached_system_data'
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
    inventario: [
      {
        id: 'PROD-001',
        nombre: 'Perfume Thor Gold Luxury 100ml',
        categoria: 'Perfumes',
        descripcion: 'Fragancia premium importada de larga duración',
        cantidad: 14,
        stock_minimo: 4,
        costo_usd: 15.00,
        costo_dop: 907.50,
        precio_venta_dop: 1950,
        ubicacion: 'Tanque #1 Miami',
        estado: 'En Stock',
        fecha_ingreso: '2026-09-01 10:00:00',
        fecha_actualizacion: '2026-09-01 10:00:00'
      },
      {
        id: 'PROD-002',
        nombre: 'Splash Vainilla & Rose 250ml',
        categoria: 'Splash',
        descripcion: 'Aroma fresco floral y dulce para uso diario',
        cantidad: 26,
        stock_minimo: 6,
        costo_usd: 4.20,
        costo_dop: 254.10,
        precio_venta_dop: 650,
        ubicacion: 'Tanque #1 Miami',
        estado: 'En Stock',
        fecha_ingreso: '2026-09-01 10:00:00',
        fecha_actualizacion: '2026-09-01 10:00:00'
      },
      {
        id: 'PROD-003',
        nombre: 'Crema Hidratante Karité & Almendras 200ml',
        categoria: 'Cremas',
        descripcion: 'Nutrición intensa para manos y cuerpo',
        cantidad: 19,
        stock_minimo: 5,
        costo_usd: 5.50,
        costo_dop: 332.75,
        precio_venta_dop: 750,
        ubicacion: 'Tanque #1 Miami',
        estado: 'En Stock',
        fecha_ingreso: '2026-09-01 10:00:00',
        fecha_actualizacion: '2026-09-01 10:00:00'
      },
      {
        id: 'PROD-004',
        nombre: 'Body Wash Coco & Miel 300ml',
        categoria: 'Body Wash',
        descripcion: 'Gel de baño revitalizante suave',
        cantidad: 2,
        stock_minimo: 4,
        costo_usd: 4.80,
        costo_dop: 290.40,
        precio_venta_dop: 700,
        ubicacion: 'Tanque #1 Miami',
        estado: 'Stock Bajo',
        fecha_ingreso: '2026-09-01 10:00:00',
        fecha_actualizacion: '2026-09-01 10:00:00'
      }
    ],
    ventas: [
      {
        id_venta: 'VTA-001',
        fecha_venta: '2026-09-08 14:30:00',
        id_articulo: 'PROD-001',
        nombre_articulo: 'Perfume Thor Gold Luxury 100ml',
        categoria: 'Perfumes',
        cantidad: 2,
        precio_unitario_dop: 1950,
        total_dop: 3900,
        costo_unitario_dop: 907.50,
        ganancia_dop: 2085,
        cliente: 'Laura Rodríguez',
        metodo_pago: 'Transferencia',
        notas: 'Cliente frecuente',
        estado: 'Completada'
      }
    ],
    recepciones: [
      {
        id_recepcion: 'TANQ-001',
        fecha: '2026-09-01',
        nombre_tanque: 'Tanque #1 Miami - Importación Directa',
        origen: 'Miami, FL - EE.UU.',
        total_unidades: 61,
        flete_usd: 65,
        tasa_cambio: 60.50,
        notas: 'Llegó en excelente estado',
        articulos: []
      }
    ],
    configuracion: {
      NOMBRE_NEGOCIO: 'Thor Essence',
      SLOGAN: 'Belleza, aroma y estilo en un solo lugar',
      MONEDA_PRINCIPAL: 'DOP',
      TASA_CAMBIO_USD_DOP: 60.50,
      CATEGORIAS: 'Perfumes, Splash, Cremas, Body Wash, Accesorios, Maquillaje, Variedades'
    },
    metricas: {
      total_productos: 4,
      total_unidades_stock: 61,
      valor_inventario_costo_dop: 27960,
      valor_inventario_venta_dop: 63950,
      productos_stock_bajo: 1,
      productos_agotados: 0,
      ventas_hoy_dop: 0,
      ganancia_hoy_dop: 0,
      ventas_mes_dop: 3900,
      ganancia_mes_dop: 2085
    }
  };

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

    let token = 'THOR_SECURE_2026';
    if (typeof THOR_CONFIG !== 'undefined' && THOR_CONFIG.SECURITY_TOKEN) {
      token = THOR_CONFIG.SECURITY_TOKEN;
    }
    if (localStorage.getItem(STORAGE_KEYS.SECURITY_TOKEN)) {
      token = localStorage.getItem(STORAGE_KEYS.SECURITY_TOKEN);
    }

    return {
      gasUrl: gasUrl.trim(),
      token: token.trim(),
      usdRate: parseFloat(localStorage.getItem(STORAGE_KEYS.USD_RATE)) || DEFAULT_RATE,
      isConfigured: !!gasUrl.trim()
    };
  }

  function saveCredentials(url, token) {
    if (url) localStorage.setItem(STORAGE_KEYS.GAS_URL, url.trim());
    if (token) localStorage.setItem(STORAGE_KEYS.SECURITY_TOKEN, token.trim());
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

  async function apiGet(action, extraParams = {}) {
    const cfg = getConfig();
    if (!cfg.isConfigured) {
      return { status: 'success', data: getCachedData() };
    }

    const url = new URL(cfg.gasUrl);
    url.searchParams.append('action', action);
    url.searchParams.append('token', cfg.token);

    for (let k in extraParams) {
      url.searchParams.append(k, extraParams[k]);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    return await response.json();
  }

  async function apiPost(action, data = {}) {
    const cfg = getConfig();
    if (!cfg.isConfigured) {
      return operarEnLocal(action, data);
    }

    const payload = {
      action: action,
      token: cfg.token,
      data: data
    };

    const response = await fetch(cfg.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    return await response.json();
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
        cliente: v.cliente || 'Cliente General',
        metodo_pago: v.metodo_pago || 'Efectivo',
        notas: v.notas || '',
        estado: 'Completada'
      };

      current.ventas.unshift(nuevaVenta);
      recalcularMetricasLocales(current);
      setCachedData(current);

      return {
        status: 'success',
        message: 'Venta registrada con éxito',
        id_venta: nuevaVenta.id_venta,
        stock_restante: prod.cantidad,
        total_dop: total,
        ganancia_dop: ganancia
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
      ganancia_mes_dop: Math.round(gananciaMes)
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
    testConnection,
    fetchAllData: () => apiGet('getAllData'),
    saveProduct: (p) => apiPost('saveProduct', p),
    deleteProduct: (id) => apiPost('deleteProduct', id),
    adjustStock: (id, delta, motivo) => apiPost('adjustStock', { id, delta, motivo }),
    registerSale: (v) => apiPost('registerSale', v),
    cancelSale: (id_venta) => apiPost('cancelSale', { id_venta }),
    registerReception: (r) => apiPost('registerReception', r),
    saveConfig: (c) => apiPost('saveConfig', c),
    DEFAULT_CATEGORIES
  };
})();
