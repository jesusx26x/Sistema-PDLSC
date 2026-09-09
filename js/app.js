/**
 * =========================================================================
 * THOR ESSENCE — APLICACIÓN PRINCIPAL (SPA & CONTROLADOR UI)
 * Estilo: Emil Kowalski & UX-UI-PRO-MAX
 * Cero configuración para Pamela (Plug & Play)
 * =========================================================================
 */

document.addEventListener('DOMContentLoaded', async () => {
  await ThorApp.init();
});

const ThorApp = (function() {
  let state = {
    currentTab: 'dashboard',
    inventory: [],
    sales: [],
    receptions: [],
    metrics: {},
    config: {},
    exchangeRate: 60.50,
    searchQuery: '',
    selectedCategory: 'all',
    selectedStockFilter: 'all',
    charts: {
      salesChart: null,
      categoryChart: null
    },
    tankDraftItems: []
  };

  async function init() {
    setupNavigation();
    setupModals();
    setupCurrencyHandlers();
    setupEventListeners();

    // Configurar escucha de eventos de seguridad RLS
    window.addEventListener('thor:session-expired', () => {
      Sonner.warning('Tu sesión ha expirado en el servidor. Por favor ingresa nuevamente.', 4000);
      showLoginView();
    });

    // Validar estado de autenticación (RLS)
    if (checkAuthStatus()) {
      // Cargar datos locales de inmediato
      cargarDatosDesdeCache();
      renderAll();

      // Actualizar tasa de cambio en segundo plano sin bloquear
      actualizarTasaCambio(false);

      // Sincronizar automáticamente con Google Sheets
      await sincronizarConNube(false);
    }
  }

  function checkAuthStatus() {
    const isAuth = ThorAPI.isAuthenticated();
    if (isAuth) {
      hideLoginView();
      return true;
    } else {
      showLoginView();
      return false;
    }
  }

  function showLoginView() {
    const el = document.getElementById('view-login');
    if (el) el.classList.remove('hidden');
  }

  function hideLoginView() {
    const el = document.getElementById('view-login');
    if (el) el.classList.add('hidden');
  }

  function togglePasswordVisibility() {
    const passInput = document.getElementById('loginPassword');
    const icon = document.getElementById('togglePasswordIcon');
    if (!passInput) return;
    if (passInput.type === 'password') {
      passInput.type = 'text';
      if (icon) icon.textContent = '🙈';
    } else {
      passInput.type = 'password';
      if (icon) icon.textContent = '👁️';
    }
  }

  async function handleLogin(e) {
    if (e) e.preventDefault();
    const userInput = document.getElementById('loginUsername');
    const passInput = document.getElementById('loginPassword');
    const rememberInput = document.getElementById('loginRemember');
    const btnSubmit = document.getElementById('btnLoginSubmit');
    const btnText = document.getElementById('loginBtnText');
    const btnIcon = document.getElementById('loginBtnIcon');

    const username = userInput ? userInput.value.trim() : '';
    const password = passInput ? passInput.value.trim() : '';
    const remember = rememberInput ? rememberInput.checked : true;

    if (!username || !password) {
      Sonner.warning('Por favor completa tu usuario y contraseña');
      return;
    }

    if (btnSubmit) btnSubmit.disabled = true;
    if (btnText) btnText.textContent = 'Verificando con servidor...';
    if (btnIcon) btnIcon.textContent = '⏳';

    try {
      const res = await ThorAPI.login(username, password, remember);
      if (res.success) {
        Sonner.success('¡Bienvenida, Pamela! Conexión segura RLS activa.');
        hideLoginView();
        cargarDatosDesdeCache();
        renderAll();
        actualizarTasaCambio(false);
        await sincronizarConNube(false);
      } else {
        Sonner.error(res.message || 'Usuario o contraseña incorrectos');
      }
    } catch (err) {
      Sonner.error('Error al iniciar sesión: ' + err.message);
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
      if (btnText) btnText.textContent = 'Iniciar Sesión';
      if (btnIcon) btnIcon.textContent = '✨';
    }
  }

  async function logout() {
    const confirmLogout = confirm('¿Deseas cerrar tu sesión? El servidor destruirá la sesión activa de forma segura.');
    if (!confirmLogout) return;

    Sonner.info('Cerrando sesión en el servidor...', 1500);
    await ThorAPI.logout();
    showLoginView();
    Sonner.success('Sesión cerrada de forma segura en el servidor.');
  }

  function cargarDatosDesdeCache() {
    const cached = ThorAPI.getCachedData();
    state.inventory = cached.inventario || [];
    state.sales = cached.ventas || [];
    state.receptions = cached.recepciones || [];
    state.metrics = cached.metricas || {};
    state.config = cached.configuracion || {};
    state.exchangeRate = ThorAPI.getUsdRate();

    actualizarBadgeTasa();
  }

  async function sincronizarConNube(mostrarToast = false) {
    const cfg = ThorAPI.getConfig();
    const syncIndicator = document.getElementById('syncIndicator');
    const syncText = document.getElementById('syncText');

    if (!cfg.isConfigured) {
      if (syncIndicator) syncIndicator.className = 'w-2 h-2 rounded-full bg-amber-400';
      if (syncText) syncText.textContent = 'Modo Local Listo';
      return;
    }

    if (syncIndicator) syncIndicator.className = 'w-2 h-2 rounded-full bg-blue-400 animate-pulse';
    if (syncText) syncText.textContent = 'Sincronizando...';

    try {
      const res = await ThorAPI.fetchAllData();
      if (res && res.status === 'success' && res.data) {
        state.inventory = res.data.inventario || [];
        state.sales = res.data.ventas || [];
        state.receptions = res.data.recepciones || [];
        state.metrics = res.data.metricas || {};
        state.config = res.data.configuracion || {};

        ThorAPI.setCachedData(res.data);
        renderAll();

        if (syncIndicator) syncIndicator.className = 'pulse-dot-green';
        if (syncText) syncText.textContent = 'Nube Activa (Sheets)';

        if (mostrarToast) {
          Sonner.success('Base de datos sincronizada con Google Sheets');
        }
      } else {
        throw new Error(res.message || 'Error al obtener datos');
      }
    } catch (e) {
      console.warn('Sincronización con nube:', e);
      if (syncIndicator) syncIndicator.className = 'w-2 h-2 rounded-full bg-amber-400';
      if (syncText) syncText.textContent = 'Datos Locales Activos';

      if (mostrarToast) {
        Sonner.warning('Usando datos locales en este dispositivo');
      }
    }
  }

  async function actualizarTasaCambio(forzarEnVivo = false) {
    const rateElem = document.getElementById('headerUsdRate');
    const sidebarRate = document.getElementById('sidebarUsdRate');

    if (forzarEnVivo) {
      if (rateElem) rateElem.textContent = 'Consultando...';
      const result = await ThorAPI.fetchLiveExchangeRate();
      state.exchangeRate = result.rate;
      actualizarBadgeTasa();
      Sonner.info(`Tasa actualizada: 1 USD = RD$ ${state.exchangeRate.toFixed(2)}`);
    } else {
      state.exchangeRate = ThorAPI.getUsdRate();
      actualizarBadgeTasa();
    }
  }

  function actualizarBadgeTasa() {
    const rateStr = `1 USD = RD$ ${state.exchangeRate.toFixed(2)}`;
    const headerRate = document.getElementById('headerUsdRate');
    const sidebarRate = document.getElementById('sidebarUsdRate');
    const cfgRate = document.getElementById('cfgUsdRate');

    if (headerRate) headerRate.textContent = rateStr;
    if (sidebarRate) sidebarRate.textContent = rateStr;
    if (cfgRate) cfgRate.value = state.exchangeRate.toFixed(2);
  }

  function setupNavigation() {
    const navButtons = document.querySelectorAll('[data-tab]');
    navButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
      });
    });
  }

  function switchTab(tabName) {
    state.currentTab = tabName;

    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.add('hidden');
    });

    const activeView = document.getElementById(`view-${tabName}`);
    if (activeView) {
      activeView.classList.remove('hidden');
    }

    document.querySelectorAll('[data-tab]').forEach(btn => {
      const isCurrent = btn.getAttribute('data-tab') === tabName;
      if (btn.classList.contains('sidebar-link')) {
        if (isCurrent) {
          btn.classList.add('bg-amber-400/15', 'text-amber-300', 'border-l-2', 'border-amber-400');
          btn.classList.remove('text-slate-400');
        } else {
          btn.classList.remove('bg-amber-400/15', 'text-amber-300', 'border-l-2', 'border-amber-400');
          btn.classList.add('text-slate-400');
        }
      }

      if (btn.classList.contains('mobile-nav-btn')) {
        if (isCurrent) {
          btn.classList.add('text-amber-300', 'scale-105');
          btn.classList.remove('text-slate-400');
        } else {
          btn.classList.remove('text-amber-300', 'scale-105');
          btn.classList.add('text-slate-400');
        }
      }
    });

    if (tabName === 'dashboard') renderDashboard();
    if (tabName === 'inventario') renderInventory();
    if (tabName === 'ventas') renderSales();
    if (tabName === 'tanques') renderReceptions();
    if (tabName === 'reportes') renderReports();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderAll() {
    renderDashboard();
    renderInventory();
    renderSales();
    renderReceptions();
    renderReports();
  }

  function renderDashboard() {
    actualizarTexto('kpiTotalProductos', state.inventory.length);
    
    let totalUnidades = 0;
    let valorCosto = 0;
    let valorVenta = 0;
    let bajoStock = 0;
    let agotados = 0;

    state.inventory.forEach(p => {
      const qty = parseInt(p.cantidad) || 0;
      totalUnidades += qty;
      valorCosto += qty * (parseFloat(p.costo_dop) || 0);
      valorVenta += qty * (parseFloat(p.precio_venta_dop) || 0);
      if (qty === 0) agotados++;
      else if (qty <= (parseInt(p.stock_minimo) || 3)) bajoStock++;
    });

    actualizarTexto('kpiUnidadesStock', totalUnidades.toLocaleString());
    actualizarTexto('kpiValorInventario', `RD$ ${Math.round(valorVenta).toLocaleString()}`);
    actualizarTexto('kpiCostoInventario', `RD$ ${Math.round(valorCosto).toLocaleString()}`);
    actualizarTexto('kpiBajoStock', bajoStock);

    let ventasMes = 0;
    let gananciaMes = 0;
    const mesActual = new Date().toISOString().substring(0, 7);

    state.sales.forEach(v => {
      if (v.estado === 'Cancelada') return;
      const f = (v.fecha_venta || '').substring(0, 7);
      if (f === mesActual || !v.fecha_venta) {
        ventasMes += parseFloat(v.total_dop) || 0;
        gananciaMes += parseFloat(v.ganancia_dop) || 0;
      }
    });

    actualizarTexto('kpiVentasMes', `RD$ ${Math.round(ventasMes).toLocaleString()}`);
    actualizarTexto('kpiGananciaMes', `RD$ ${Math.round(gananciaMes).toLocaleString()}`);

    renderDashboardAlerts(bajoStock, agotados);
    renderDashboardCharts();
    renderRecentActivity();
  }

  function renderDashboardAlerts(bajoStock, agotados) {
    const container = document.getElementById('dashboardAlerts');
    if (!container) return;

    if (bajoStock === 0 && agotados === 0) {
      container.innerHTML = `
        <div class="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3">
          <span class="text-xl">✨</span>
          <p class="text-xs sm:text-sm text-emerald-300 font-medium">¡Inventario óptimo! Todas las fragancias y artículos tienen existencias suficientes.</p>
        </div>
      `;
      return;
    }

    const itemsCriticos = state.inventory
      .filter(p => p.cantidad <= (p.stock_minimo || 3))
      .slice(0, 4);

    let html = `
      <div class="space-y-2">
        <div class="p-3 rounded-2xl bg-amber-50 border border-amber-200/80 shadow-xs flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-amber-600 text-lg">⚠️</span>
            <span class="text-xs sm:text-sm text-amber-900 font-medium">Tienes <strong>${bajoStock}</strong> productos con stock bajo y <strong>${agotados}</strong> agotados.</span>
          </div>
          <button onclick="ThorApp.filterInventoryStock('low')" class="text-xs text-amber-700 underline font-bold hover:text-amber-800">Ver todos</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
    `;

    itemsCriticos.forEach(p => {
      const esAgotado = p.cantidad === 0;
      html += `
        <div class="p-3 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold text-slate-800 truncate max-w-[170px] sm:max-w-[220px]">${p.nombre}</p>
            <p class="text-[11px] text-slate-500">Quedan: <span class="font-bold ${esAgotado ? 'text-rose-600' : 'text-amber-600'}">${p.cantidad}</span> (Mín: ${p.stock_minimo || 3})</p>
          </div>
          <button onclick="ThorApp.quickAdjustStock('${p.id}', 1)" class="btn-tactile px-2.5 py-1 text-xs bg-amber-50 text-amber-800 font-semibold rounded-lg border border-amber-200 hover:bg-amber-100">+ Stock</button>
        </div>
      `;
    });

    html += `</div></div>`;
    container.innerHTML = html;
  }

  function renderDashboardCharts() {
    const ctxSales = document.getElementById('chartSalesTrend');
    if (ctxSales && typeof Chart !== 'undefined') {
      const ultimos7Dias = obtenerUltimosDias(7);
      const labels = ultimos7Dias.map(d => d.label);
      const dataVentas = ultimos7Dias.map(d => {
        let total = 0;
        state.sales.forEach(v => {
          if (v.estado !== 'Cancelada' && (v.fecha_venta || '').startsWith(d.dateStr)) {
            total += parseFloat(v.total_dop) || 0;
          }
        });
        return total;
      });

      if (state.charts.salesChart) state.charts.salesChart.destroy();

      state.charts.salesChart = new Chart(ctxSales, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Ventas (RD$)',
            data: dataVentas,
            borderColor: '#D4AF37',
            backgroundColor: 'rgba(212, 175, 55, 0.12)',
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointBackgroundColor: '#F3E5AB',
            pointRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(15, 23, 42, 0.06)' },
              ticks: {
                color: '#64748B',
                callback: (val) => 'RD$ ' + val.toLocaleString()
              }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#64748B' }
            }
          }
        }
      });
    }

    const ctxCat = document.getElementById('chartCategories');
    if (ctxCat && typeof Chart !== 'undefined') {
      const catCount = {};
      state.inventory.forEach(p => {
        const c = p.categoria || 'Otros';
        catCount[c] = (catCount[c] || 0) + (parseInt(p.cantidad) || 0);
      });

      const catLabels = Object.keys(catCount);
      const catValues = Object.values(catCount);

      if (state.charts.categoryChart) state.charts.categoryChart.destroy();

      state.charts.categoryChart = new Chart(ctxCat, {
        type: 'doughnut',
        data: {
          labels: catLabels,
          datasets: [{
            data: catValues,
            backgroundColor: [
              '#D4AF37', '#F59E0B', '#EC4899', '#8B5CF6', '#3B82F6', '#10B981', '#64748B'
            ],
            borderColor: '#FFFFFF',
            borderWidth: 3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#475569', font: { size: 11 }, boxWidth: 12 }
            }
          }
        }
      });
    }
  }

  function renderRecentActivity() {
    const list = document.getElementById('recentActivityList');
    if (!list) return;

    const ultimasVentas = state.sales.slice(0, 5);
    if (ultimasVentas.length === 0) {
      list.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">No hay ventas registradas aún.</p>`;
      return;
    }

    let html = '';
    ultimasVentas.forEach(v => {
      const esCancelada = v.estado === 'Cancelada';
      html += `
        <div class="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full ${esCancelada ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200'} flex items-center justify-center text-xs font-bold shrink-0">
              ${esCancelada ? '✕' : '🛍️'}
            </div>
            <div>
              <p class="text-xs font-semibold text-slate-800 ${esCancelada ? 'line-through text-slate-400' : ''}">${v.nombre_articulo}</p>
              <p class="text-[11px] text-slate-500">${v.cantidad} un. • ${v.cliente || 'Cliente'} • <span class="text-amber-700 font-medium">${v.metodo_pago || 'Efectivo'}</span></p>
            </div>
          </div>
          <div class="text-right shrink-0">
            <p class="text-xs font-bold ${esCancelada ? 'text-slate-400' : 'text-emerald-600'}">RD$ ${Number(v.total_dop || 0).toLocaleString()}</p>
            <p class="text-[10px] text-slate-400">${(v.fecha_venta || '').substring(5, 16)}</p>
          </div>
        </div>
      `;
    });

    list.innerHTML = html;
  }

  function renderInventory() {
    renderCategoryFilters();

    const tbody = document.getElementById('inventoryTableBody');
    const cardsContainer = document.getElementById('inventoryCardsMobile');
    const countBadge = document.getElementById('inventoryCountBadge');

    let filtered = state.inventory.filter(item => {
      const matchQuery = !state.searchQuery || 
        item.nombre.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
        item.id.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
        (item.ubicacion && item.ubicacion.toLowerCase().includes(state.searchQuery.toLowerCase()));

      const matchCat = state.selectedCategory === 'all' || item.categoria === state.selectedCategory;

      let matchStock = true;
      if (state.selectedStockFilter === 'low') {
        matchStock = item.cantidad > 0 && item.cantidad <= (item.stock_minimo || 3);
      } else if (state.selectedStockFilter === 'out') {
        matchStock = item.cantidad === 0;
      } else if (state.selectedStockFilter === 'in') {
        matchStock = item.cantidad > (item.stock_minimo || 3);
      }

      return matchQuery && matchCat && matchStock;
    });

    if (countBadge) countBadge.textContent = `${filtered.length} productos`;

    if (filtered.length === 0) {
      const emptyMsg = `
        <div class="text-center py-12">
          <span class="text-4xl">📦</span>
          <p class="mt-2 text-sm text-slate-400">No se encontraron productos con los filtros seleccionados.</p>
          <button onclick="ThorApp.openNewProductModal()" class="mt-4 btn-tactile btn-gold text-xs py-2 px-4">Agregar Producto</button>
        </div>
      `;
      if (tbody) tbody.innerHTML = `<tr><td colspan="7">${emptyMsg}</td></tr>`;
      if (cardsContainer) cardsContainer.innerHTML = emptyMsg;
      return;
    }

    if (tbody) {
      let tableHtml = '';
      filtered.forEach(p => {
        const qty = parseInt(p.cantidad) || 0;
        const min = parseInt(p.stock_minimo) || 3;
        let badgeClass = 'badge-success';
        let statusText = 'En Stock';

        if (qty === 0) {
          badgeClass = 'badge-danger';
          statusText = 'Agotado';
        } else if (qty <= min) {
          badgeClass = 'badge-warning';
          statusText = 'Stock Bajo';
        }

        const margen = p.precio_venta_dop && p.costo_dop 
          ? Math.round(((p.precio_venta_dop - p.costo_dop) / p.precio_venta_dop) * 100) 
          : 0;

        tableHtml += `
          <tr class="border-b border-slate-100 hover:bg-amber-50/40 transition">
            <td class="py-3 px-4">
              <div class="font-semibold text-slate-800 text-sm">${p.nombre}</div>
              <div class="text-xs text-slate-500 font-mono">${p.id} • ${p.ubicacion || 'Tanque'}</div>
            </td>
            <td class="py-3 px-3">
              <span class="text-xs px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-800 font-medium border border-amber-200/80">${p.categoria || 'Variedades'}</span>
            </td>
            <td class="py-3 px-3 text-center">
              <div class="flex items-center justify-center gap-1.5">
                <button onclick="ThorApp.quickAdjustStock('${p.id}', -1)" class="btn-tactile w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center border border-slate-200">-</button>
                <span class="font-bold text-sm px-1.5 ${qty === 0 ? 'text-rose-600' : qty <= min ? 'text-amber-600' : 'text-slate-800'}">${qty}</span>
                <button onclick="ThorApp.quickAdjustStock('${p.id}', 1)" class="btn-tactile w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center border border-slate-200">+</button>
              </div>
              <span class="text-[10px] text-slate-400">Mín: ${min}</span>
            </td>
            <td class="py-3 px-3 text-right">
              <div class="text-xs text-slate-700 font-medium">RD$ ${Number(p.costo_dop || 0).toLocaleString()}</div>
              <div class="text-[11px] text-amber-700 font-mono font-medium">$ ${Number(p.costo_usd || 0).toFixed(2)} USD</div>
            </td>
            <td class="py-3 px-3 text-right font-bold text-sm text-emerald-600">
              RD$ ${Number(p.precio_venta_dop || 0).toLocaleString()}
              <div class="text-[10px] font-normal text-slate-500">+${margen}% margen</div>
            </td>
            <td class="py-3 px-3 text-center">
              <span class="${badgeClass}">${statusText}</span>
            </td>
            <td class="py-3 px-4 text-right whitespace-nowrap">
              <button onclick="ThorApp.openSaleModalFor('${p.id}')" class="btn-tactile p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg mr-1 border border-emerald-200" title="Vender">
                💰
              </button>
              <button onclick="ThorApp.openEditProductModal('${p.id}')" class="btn-tactile p-1.5 text-amber-700 hover:bg-amber-50 rounded-lg mr-1 border border-amber-200" title="Editar">
                ✏️
              </button>
              <button onclick="ThorApp.confirmDeleteProduct('${p.id}')" class="btn-tactile p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200" title="Eliminar">
                🗑️
              </button>
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = tableHtml;
    }

    if (cardsContainer) {
      let cardsHtml = '';
      filtered.forEach(p => {
        const qty = parseInt(p.cantidad) || 0;
        const min = parseInt(p.stock_minimo) || 3;
        let badgeClass = 'badge-success';
        let statusText = 'En Stock';

        if (qty === 0) {
          badgeClass = 'badge-danger';
          statusText = 'Agotado';
        } else if (qty <= min) {
          badgeClass = 'badge-warning';
          statusText = 'Stock Bajo';
        }

        cardsHtml += `
          <div class="p-4 rounded-2xl bento-card space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <span class="text-[10px] uppercase font-bold text-amber-700 tracking-wider">${p.categoria || 'Variedades'}</span>
                <h4 class="font-bold text-slate-800 text-sm leading-snug">${p.nombre}</h4>
                <p class="text-[11px] text-slate-500">${p.ubicacion || 'Tanque'} • ID: ${p.id}</p>
              </div>
              <span class="${badgeClass}">${statusText}</span>
            </div>

            <div class="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
              <div>
                <p class="text-[10px] text-slate-500">Costo (USD / RD$)</p>
                <p class="text-xs font-semibold text-slate-700">$${Number(p.costo_usd || 0).toFixed(2)} / RD$${Number(p.costo_dop || 0).toLocaleString()}</p>
              </div>
              <div class="text-right">
                <p class="text-[10px] text-slate-500">Precio Venta</p>
                <p class="text-sm font-bold text-emerald-600">RD$ ${Number(p.precio_venta_dop || 0).toLocaleString()}</p>
              </div>
            </div>

            <div class="flex items-center justify-between pt-1 border-t border-slate-100">
              <div class="flex items-center gap-2">
                <button onclick="ThorApp.quickAdjustStock('${p.id}', -1)" class="btn-tactile w-9 h-9 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center border border-slate-200 text-sm">-</button>
                <div class="text-center px-1">
                  <span class="text-base font-bold ${qty === 0 ? 'text-rose-600' : qty <= min ? 'text-amber-600' : 'text-slate-800'}">${qty}</span>
                  <span class="block text-[9px] text-slate-500">unid.</span>
                </div>
                <button onclick="ThorApp.quickAdjustStock('${p.id}', 1)" class="btn-tactile w-9 h-9 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center border border-slate-200 text-sm">+</button>
              </div>

              <div class="flex items-center gap-1.5">
                <button onclick="ThorApp.openSaleModalFor('${p.id}')" class="btn-tactile px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold flex items-center gap-1">
                  💰 Vender
                </button>
                <button onclick="ThorApp.openEditProductModal('${p.id}')" class="btn-tactile p-2 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 text-xs">
                  ✏️
                </button>
                <button onclick="ThorApp.confirmDeleteProduct('${p.id}')" class="btn-tactile p-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs">
                  🗑️
                </button>
              </div>
            </div>
          </div>
        `;
      });
      cardsContainer.innerHTML = cardsHtml;
    }
  }

  function renderCategoryFilters() {
    const container = document.getElementById('categoryPillsContainer');
    if (!container) return;

    const categories = ['all', ...ThorAPI.DEFAULT_CATEGORIES];
    let html = '';

    categories.forEach(cat => {
      const isSelected = state.selectedCategory === cat;
      const label = cat === 'all' ? '✨ Todos' : cat;
      html += `
        <button onclick="ThorApp.filterInventoryCategory('${cat}')" 
          class="btn-tactile px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
            isSelected 
              ? 'bg-gradient-to-r from-amber-400 to-amber-300 text-slate-950 font-bold shadow-xs' 
              : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 shadow-xs'
          }">
          ${label}
        </button>
      `;
    });

    container.innerHTML = html;
  }

  function renderSales() {
    const tbody = document.getElementById('salesTableBody');
    const cardsMobile = document.getElementById('salesCardsMobile');
    const totalCount = document.getElementById('salesCountBadge');

    if (totalCount) totalCount.textContent = `${state.sales.length} ventas`;

    if (state.sales.length === 0) {
      const emptyMsg = `
        <div class="text-center py-12">
          <span class="text-4xl">🧾</span>
          <p class="mt-2 text-sm text-slate-400">Aún no hay ventas registradas.</p>
          <button onclick="ThorApp.openSaleModal()" class="mt-4 btn-tactile btn-gold text-xs py-2 px-4">Registrar Primera Venta</button>
        </div>
      `;
      if (tbody) tbody.innerHTML = `<tr><td colspan="7">${emptyMsg}</td></tr>`;
      if (cardsMobile) cardsMobile.innerHTML = emptyMsg;
      return;
    }

    if (tbody) {
      let html = '';
      state.sales.forEach(v => {
        const esCancelada = v.estado === 'Cancelada';
        html += `
          <tr class="border-b border-slate-100 hover:bg-amber-50/40 transition ${esCancelada ? 'opacity-40' : ''}">
            <td class="py-3 px-4 font-mono text-xs text-slate-500">
              ${v.id_venta}
              <div class="text-[11px] text-slate-400">${v.fecha_venta || ''}</div>
            </td>
            <td class="py-3 px-3">
              <div class="font-semibold text-slate-800 text-sm ${esCancelada ? 'line-through text-slate-400' : ''}">${v.nombre_articulo}</div>
              <div class="text-xs text-slate-500">${v.cliente || 'Cliente General'}</div>
            </td>
            <td class="py-3 px-3 text-center font-bold text-sm text-slate-800">
              ${v.cantidad} un.
            </td>
            <td class="py-3 px-3 text-right">
              <div class="font-bold text-sm text-slate-800">RD$ ${Number(v.total_dop || 0).toLocaleString()}</div>
              <div class="text-[11px] text-slate-500">${v.metodo_pago || 'Efectivo'}</div>
            </td>
            <td class="py-3 px-3 text-right font-semibold text-sm ${esCancelada ? 'text-slate-400' : 'text-emerald-600'}">
              RD$ ${Number(v.ganancia_dop || 0).toLocaleString()}
            </td>
            <td class="py-3 px-3 text-center">
              <span class="${esCancelada ? 'badge-danger' : 'badge-success'}">${v.estado || 'Completada'}</span>
            </td>
            <td class="py-3 px-4 text-right">
              ${!esCancelada ? `
                <button onclick="ThorApp.confirmCancelSale('${v.id_venta}')" class="btn-tactile px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200">
                  Anular
                </button>
              ` : '<span class="text-xs text-slate-400">Anulada</span>'}
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    }

    if (cardsMobile) {
      let cardsHtml = '';
      state.sales.forEach(v => {
        const esCancelada = v.estado === 'Cancelada';
        cardsHtml += `
          <div class="p-4 rounded-2xl bento-card space-y-2.5 ${esCancelada ? 'opacity-40' : ''}">
            <div class="flex items-center justify-between">
              <span class="text-xs font-mono text-amber-700 font-semibold">${v.id_venta}</span>
              <span class="${esCancelada ? 'badge-danger' : 'badge-success'}">${v.estado || 'Completada'}</span>
            </div>
            <div>
              <h4 class="font-bold text-slate-800 text-sm ${esCancelada ? 'line-through text-slate-400' : ''}">${v.nombre_articulo}</h4>
              <p class="text-xs text-slate-500">${v.cantidad} unidades • ${v.cliente || 'Cliente General'}</p>
            </div>
            <div class="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
              <div>
                <span class="text-slate-500 block text-[10px]">Total Venta</span>
                <span class="font-bold text-slate-800 text-sm">RD$ ${Number(v.total_dop || 0).toLocaleString()}</span>
              </div>
              <div class="text-right">
                <span class="text-slate-500 block text-[10px]">Ganancia Neta</span>
                <span class="font-bold text-emerald-600 text-sm">RD$ ${Number(v.ganancia_dop || 0).toLocaleString()}</span>
              </div>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-400 pt-1">
              <span>${v.fecha_venta || ''}</span>
              ${!esCancelada ? `
                <button onclick="ThorApp.confirmCancelSale('${v.id_venta}')" class="text-rose-600 underline font-semibold">Anular Venta</button>
              ` : ''}
            </div>
          </div>
        `;
      });
      cardsMobile.innerHTML = cardsHtml;
    }
  }

  function renderReceptions() {
    const container = document.getElementById('receptionsList');
    if (!container) return;

    if (state.receptions.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12">
          <span class="text-4xl">🚢</span>
          <p class="mt-2 text-sm text-slate-400">Aún no hay recepciones de tanques registradas.</p>
          <button onclick="ThorApp.openTankModal()" class="mt-4 btn-tactile btn-gold text-xs py-2 px-4">+ Ingresar Primer Tanque</button>
        </div>
      `;
      return;
    }

    let html = '';
    state.receptions.forEach(r => {
      html += `
        <div class="p-5 rounded-2xl bento-card space-y-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="text-xl">📦</span>
                <h3 class="font-bold text-base text-slate-800">${r.nombre_tanque}</h3>
              </div>
              <p class="text-xs text-slate-500 mt-0.5">Llegada: <strong>${r.fecha}</strong> • Origen: <strong>${r.origen || 'EE.UU.'}</strong></p>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge-gold">${r.total_unidades} Unidades</span>
              <span class="text-xs text-amber-700 font-mono font-medium">Tasa: RD$ ${Number(r.tasa_cambio || 60.50).toFixed(2)}</span>
            </div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
            <div>
              <span class="text-slate-500 block text-[11px]">Flete / Envío</span>
              <span class="font-semibold text-slate-800">$${Number(r.flete_usd || 0).toFixed(2)} USD</span>
            </div>
            <div>
              <span class="text-slate-500 block text-[11px]">Unidades Ingresadas</span>
              <span class="font-semibold text-emerald-600">${r.total_unidades} piezas</span>
            </div>
            <div class="col-span-2 sm:col-span-1">
              <span class="text-slate-500 block text-[11px]">Notas / Observaciones</span>
              <span class="text-slate-700 truncate block">${r.notas || 'Sin notas'}</span>
            </div>
          </div>

          ${r.articulos && r.articulos.length > 0 ? `
            <div class="mt-2">
              <p class="text-xs font-bold text-slate-700 mb-2">Artículos incluidos en este tanque:</p>
              <div class="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                ${r.articulos.map(item => `
                  <div class="flex items-center justify-between text-xs py-1.5 px-3 rounded-xl bg-white border border-slate-200">
                    <span class="text-slate-800 font-medium">${item.nombre}</span>
                    <span class="text-amber-800 font-bold">${item.cantidad} un. • RD$ ${Number(item.precio_venta_dop || 0).toLocaleString()}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function renderReports() {
    let totalIngresos = 0;
    let totalCostos = 0;
    let totalGanancia = 0;
    const ventasPorProducto = {};

    state.sales.forEach(v => {
      if (v.estado === 'Cancelada') return;
      const t = parseFloat(v.total_dop) || 0;
      const g = parseFloat(v.ganancia_dop) || 0;
      const c = t - g;

      totalIngresos += t;
      totalCostos += c;
      totalGanancia += g;

      const nom = v.nombre_articulo || 'Sin Nombre';
      if (!ventasPorProducto[nom]) {
        ventasPorProducto[nom] = { cantidad: 0, total: 0 };
      }
      ventasPorProducto[nom].cantidad += (parseInt(v.cantidad) || 0);
      ventasPorProducto[nom].total += t;
    });

    actualizarTexto('repTotalIngresos', `RD$ ${Math.round(totalIngresos).toLocaleString()}`);
    actualizarTexto('repTotalCostos', `RD$ ${Math.round(totalCostos).toLocaleString()}`);
    actualizarTexto('repTotalGanancia', `RD$ ${Math.round(totalGanancia).toLocaleString()}`);

    const margen = totalIngresos > 0 ? Math.round((totalGanancia / totalIngresos) * 100) : 0;
    actualizarTexto('repMargenGeneral', `${margen}%`);

    const topList = document.getElementById('repTopProductsList');
    if (topList) {
      const sorted = Object.keys(ventasPorProducto)
        .map(k => ({ nombre: k, ...ventasPorProducto[k] }))
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 5);

      if (sorted.length === 0) {
        topList.innerHTML = `<p class="text-xs text-slate-500 py-3 text-center">Sin datos suficientes de ventas.</p>`;
      } else {
        let html = '';
        sorted.forEach((item, idx) => {
          html += `
            <div class="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0 text-xs">
              <div class="flex items-center gap-2.5">
                <span class="w-5 h-5 rounded-full bg-amber-50 text-amber-800 font-bold flex items-center justify-center text-[10px] border border-amber-200">${idx + 1}</span>
                <span class="text-slate-800 font-medium">${item.nombre}</span>
              </div>
              <div class="text-right">
                <span class="font-bold text-slate-800">${item.cantidad} un.</span>
                <span class="text-slate-500 block text-[10px]">RD$ ${Math.round(item.total).toLocaleString()}</span>
              </div>
            </div>
          `;
        });
        topList.innerHTML = html;
      }
    }
  }

  function setupModals() {
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeAllModals();
      });
    });
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-container').forEach(m => m.classList.add('hidden'));
  }

  function openNewProductModal() {
    document.getElementById('modalProductTitle').textContent = 'Nuevo Producto';
    document.getElementById('formProduct').reset();
    document.getElementById('prodId').value = '';
    document.getElementById('prodCurrencyToggle').checked = true;
    toggleProductCurrency(true);
    document.getElementById('modalProduct').classList.remove('hidden');
  }

  function openEditProductModal(id) {
    const prod = state.inventory.find(p => p.id === id);
    if (!prod) return;

    document.getElementById('modalProductTitle').textContent = 'Editar Producto';
    document.getElementById('prodId').value = prod.id;
    document.getElementById('prodNombre').value = prod.nombre;
    document.getElementById('prodCategoria').value = prod.categoria || 'Variedades';
    document.getElementById('prodDescripcion').value = prod.descripcion || '';
    document.getElementById('prodCantidad').value = prod.cantidad;
    document.getElementById('prodStockMin').value = prod.stock_minimo || 3;
    document.getElementById('prodUbicacion').value = prod.ubicacion || '';
    document.getElementById('prodCostoUsd').value = prod.costo_usd || '';
    document.getElementById('prodCostoDop').value = prod.costo_dop || '';
    document.getElementById('prodPrecioVenta').value = prod.precio_venta_dop || '';

    const isUsd = (prod.costo_usd > 0);
    document.getElementById('prodCurrencyToggle').checked = isUsd;
    toggleProductCurrency(isUsd);
    calcularMargenProducto();

    document.getElementById('modalProduct').classList.remove('hidden');
  }

  function toggleProductCurrency(isUsd) {
    const usdGroup = document.getElementById('prodUsdGroup');
    const currencyLabel = document.getElementById('prodCurrencyLabel');

    if (isUsd) {
      usdGroup.classList.remove('hidden');
      if (currencyLabel) currencyLabel.textContent = 'Costo en Dólares (USD)';
    } else {
      usdGroup.classList.add('hidden');
      if (currencyLabel) currencyLabel.textContent = 'Costo en Pesos (RD$)';
    }
    recalcularCostoProducto();
  }

  function recalcularCostoProducto() {
    const isUsd = document.getElementById('prodCurrencyToggle').checked;
    const usdInput = document.getElementById('prodCostoUsd');
    const dopInput = document.getElementById('prodCostoDop');
    const previewSpan = document.getElementById('prodConvertedCostPreview');

    if (isUsd) {
      const valUsd = parseFloat(usdInput.value) || 0;
      const converted = valUsd * state.exchangeRate;
      dopInput.value = converted.toFixed(2);
      if (previewSpan) previewSpan.textContent = `= RD$ ${converted.toFixed(2)} (a tasa ${state.exchangeRate.toFixed(2)})`;
    } else {
      const valDop = parseFloat(dopInput.value) || 0;
      if (previewSpan) previewSpan.textContent = '';
      if (state.exchangeRate > 0) {
        usdInput.value = (valDop / state.exchangeRate).toFixed(2);
      }
    }
    calcularMargenProducto();
  }

  function calcularMargenProducto() {
    const costoDop = parseFloat(document.getElementById('prodCostoDop').value) || 0;
    const precioVenta = parseFloat(document.getElementById('prodPrecioVenta').value) || 0;
    const marginBadge = document.getElementById('prodMarginPreview');

    if (!marginBadge) return;

    if (precioVenta > 0 && costoDop > 0) {
      const ganancia = precioVenta - costoDop;
      const porcentaje = Math.round((ganancia / precioVenta) * 100);
      marginBadge.innerHTML = `
        Margen Estimado: <strong class="${ganancia >= 0 ? 'text-emerald-400' : 'text-rose-400'}">RD$ ${ganancia.toFixed(2)} (${porcentaje}%)</strong>
      `;
    } else {
      marginBadge.innerHTML = '';
    }
  }

  async function handleSaveProduct(e) {
    e.preventDefault();
    const id = document.getElementById('prodId').value;
    const nombre = document.getElementById('prodNombre').value.trim();
    if (!nombre) return;

    const costoUsd = parseFloat(document.getElementById('prodCostoUsd').value) || 0;
    const costoDop = parseFloat(document.getElementById('prodCostoDop').value) || (costoUsd * state.exchangeRate);
    const precioVenta = parseFloat(document.getElementById('prodPrecioVenta').value) || 0;
    const cantidad = parseInt(document.getElementById('prodCantidad').value) || 0;
    const stockMin = parseInt(document.getElementById('prodStockMin').value) || 3;

    const prodData = {
      id: id || undefined,
      nombre: nombre,
      categoria: document.getElementById('prodCategoria').value,
      descripcion: document.getElementById('prodDescripcion').value.trim(),
      cantidad: cantidad,
      stock_minimo: stockMin,
      costo_usd: costoUsd,
      costo_dop: costoDop,
      precio_venta_dop: precioVenta,
      ubicacion: document.getElementById('prodUbicacion').value.trim() || 'Almacén Principal'
    };

    closeAllModals();

    const res = await ThorAPI.saveProduct(prodData);
    if (res && res.status === 'success') {
      Sonner.success('Producto guardado correctamente');
      await sincronizarConNube(false);
      renderAll();
    } else {
      Sonner.error(res.message || 'No se pudo guardar el producto');
    }
  }

  function openSaleModal(selectedProductId = null) {
    const select = document.getElementById('saleProductSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Selecciona un producto --</option>';
    state.inventory.forEach(p => {
      const disabled = p.cantidad <= 0 ? 'disabled' : '';
      const stockTxt = p.cantidad <= 0 ? '(Agotado)' : `(${p.cantidad} disponibles)`;
      select.innerHTML += `
        <option value="${p.id}" ${disabled} ${selectedProductId === p.id ? 'selected' : ''}>
          ${p.nombre} - RD$ ${Number(p.precio_venta_dop || 0).toLocaleString()} ${stockTxt}
        </option>
      `;
    });

    document.getElementById('formSale').reset();
    document.getElementById('saleProductSelect').value = selectedProductId || '';
    handleSaleProductChange();

    document.getElementById('modalSale').classList.remove('hidden');
  }

  function handleSaleProductChange() {
    const id = document.getElementById('saleProductSelect').value;
    const prod = state.inventory.find(p => p.id === id);
    const stockBadge = document.getElementById('saleStockBadge');
    const priceInput = document.getElementById('salePriceInput');
    const qtyInput = document.getElementById('saleQtyInput');

    if (prod) {
      if (stockBadge) {
        stockBadge.innerHTML = `Stock actual: <strong class="${prod.cantidad > 0 ? 'text-emerald-400' : 'text-rose-400'}">${prod.cantidad} unidades</strong>`;
      }
      if (priceInput) priceInput.value = prod.precio_venta_dop || 0;
      if (qtyInput) {
        qtyInput.max = prod.cantidad;
        if (parseInt(qtyInput.value) > prod.cantidad) qtyInput.value = prod.cantidad;
        if (!qtyInput.value || qtyInput.value <= 0) qtyInput.value = 1;
      }
    } else {
      if (stockBadge) stockBadge.innerHTML = '';
      if (priceInput) priceInput.value = '';
    }
    recalcularTotalVenta();
  }

  function recalcularTotalVenta() {
    const qty = parseInt(document.getElementById('saleQtyInput').value) || 0;
    const price = parseFloat(document.getElementById('salePriceInput').value) || 0;
    const totalElem = document.getElementById('saleTotalPreview');
    const total = qty * price;

    if (totalElem) {
      totalElem.textContent = `RD$ ${total.toLocaleString()}`;
    }
  }

  async function handleRegisterSale(e) {
    e.preventDefault();
    const idProd = document.getElementById('saleProductSelect').value;
    const cant = parseInt(document.getElementById('saleQtyInput').value) || 0;
    const precio = parseFloat(document.getElementById('salePriceInput').value) || 0;
    const cliente = document.getElementById('saleCliente').value.trim() || 'Cliente General';
    const metodo = document.getElementById('saleMetodoPago').value;
    const notas = document.getElementById('saleNotas').value.trim();

    if (!idProd || cant <= 0 || precio <= 0) {
      Sonner.warning('Por favor completa todos los datos de la venta');
      return;
    }

    const saleData = {
      id_articulo: idProd,
      cantidad: cant,
      precio_unitario_dop: precio,
      cliente: cliente,
      metodo_pago: metodo,
      notas: notas
    };

    closeAllModals();

    const res = await ThorAPI.registerSale(saleData);
    if (res && res.status === 'success') {
      Sonner.success(`¡Venta registrada! Total: RD$ ${Number(res.total_dop || (cant * precio)).toLocaleString()}`);
      await sincronizarConNube(false);
      renderAll();
    } else {
      Sonner.error(res.message || 'No se pudo procesar la venta');
    }
  }

  function openTankModal() {
    state.tankDraftItems = [];
    document.getElementById('formTank').reset();
    document.getElementById('tankDate').value = new Date().toISOString().substring(0, 10);
    document.getElementById('tankRate').value = state.exchangeRate.toFixed(2);
    renderTankDraftItems();
    document.getElementById('modalTank').classList.remove('hidden');
  }

  function addTankDraftItem() {
    const tasa = parseFloat(document.getElementById('tankRate').value) || state.exchangeRate;
    state.tankDraftItems.push({
      tempId: Date.now() + Math.random(),
      nombre: '',
      categoria: 'Perfumes',
      cantidad: 1,
      costo_usd: 5.00,
      costo_dop: 5.00 * tasa,
      precio_venta_dop: Math.round((5.00 * tasa) * 1.6)
    });
    renderTankDraftItems();
  }

  function removeTankDraftItem(tempId) {
    state.tankDraftItems = state.tankDraftItems.filter(i => i.tempId !== tempId);
    renderTankDraftItems();
  }

  function renderTankDraftItems() {
    const container = document.getElementById('tankDraftItemsContainer');
    const totalCountBadge = document.getElementById('tankTotalDraftUnits');
    if (!container) return;

    let totalUnits = 0;
    state.tankDraftItems.forEach(i => totalUnits += (parseInt(i.cantidad) || 0));
    if (totalCountBadge) totalCountBadge.textContent = `${totalUnits} piezas`;

    if (state.tankDraftItems.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
          <p class="text-xs text-slate-500">Aún no has agregado artículos a este tanque.</p>
          <button type="button" onclick="ThorApp.addTankDraftItem()" class="btn-tactile mt-2 text-xs text-amber-700 font-bold underline">+ Agregar primer artículo</button>
        </div>
      `;
      return;
    }

    const tasa = parseFloat(document.getElementById('tankRate').value) || state.exchangeRate;
    let html = '';

    state.tankDraftItems.forEach((item, idx) => {
      html += `
        <div class="p-3.5 rounded-xl bg-white border border-slate-200 shadow-xs space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-amber-700">Artículo #${idx + 1}</span>
            <button type="button" onclick="ThorApp.removeTankDraftItem(${item.tempId})" class="btn-tactile text-rose-600 text-xs font-semibold hover:text-rose-700">✕ Quitar</button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label class="block text-[10px] font-semibold text-slate-600">Nombre del Producto</label>
              <input type="text" value="${item.nombre}" onchange="ThorApp.updateTankDraftItem(${item.tempId}, 'nombre', this.value)" placeholder="Ej: Perfume 100ml..." class="form-input text-xs py-1.5" required>
            </div>
            <div>
              <label class="block text-[10px] font-semibold text-slate-600">Categoría</label>
              <select onchange="ThorApp.updateTankDraftItem(${item.tempId}, 'categoria', this.value)" class="form-input text-xs py-1.5">
                ${ThorAPI.DEFAULT_CATEGORIES.map(c => `<option value="${c}" ${item.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="block text-[10px] font-semibold text-slate-600">Cantidad</label>
              <input type="number" min="1" value="${item.cantidad}" onchange="ThorApp.updateTankDraftItem(${item.tempId}, 'cantidad', this.value)" class="form-input text-xs py-1.5 font-bold" required>
            </div>
            <div>
              <label class="block text-[10px] font-semibold text-slate-600">Costo USD ($)</label>
              <input type="number" step="0.01" min="0" value="${item.costo_usd}" onchange="ThorApp.updateTankDraftItem(${item.tempId}, 'costo_usd', this.value)" class="form-input text-xs py-1.5 font-mono" required>
            </div>
            <div>
              <label class="block text-[10px] font-semibold text-slate-600">Precio Venta (RD$)</label>
              <input type="number" step="1" min="0" value="${Math.round(item.precio_venta_dop)}" onchange="ThorApp.updateTankDraftItem(${item.tempId}, 'precio_venta_dop', this.value)" class="form-input text-xs py-1.5 font-bold text-emerald-600" required>
            </div>
          </div>
          <div class="text-[10px] text-slate-500 text-right">
            Costo convertido: <strong class="text-slate-800">RD$ ${Math.round(item.costo_usd * tasa).toLocaleString()}</strong>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function updateTankDraftItem(tempId, field, value) {
    const item = state.tankDraftItems.find(i => i.tempId === tempId);
    if (!item) return;

    if (field === 'cantidad') item.cantidad = parseInt(value) || 1;
    else if (field === 'costo_usd') {
      item.costo_usd = parseFloat(value) || 0;
      const tasa = parseFloat(document.getElementById('tankRate').value) || state.exchangeRate;
      item.costo_dop = item.costo_usd * tasa;
      if (!item.precio_venta_dop || item.precio_venta_dop === 0) {
        item.precio_venta_dop = Math.round(item.costo_dop * 1.6);
      }
    } else if (field === 'precio_venta_dop') item.precio_venta_dop = parseFloat(value) || 0;
    else item[field] = value;

    renderTankDraftItems();
  }

  async function handleSaveTank(e) {
    e.preventDefault();
    const nombreTanque = document.getElementById('tankName').value.trim();
    if (!nombreTanque) return;

    if (state.tankDraftItems.length === 0) {
      Sonner.warning('Debes agregar al menos un artículo en este tanque');
      return;
    }

    const tasa = parseFloat(document.getElementById('tankRate').value) || state.exchangeRate;
    const flete = parseFloat(document.getElementById('tankFreight').value) || 0;

    const payload = {
      nombre_tanque: nombreTanque,
      fecha: document.getElementById('tankDate').value,
      origen: document.getElementById('tankOrigin').value.trim() || 'EE.UU.',
      flete_usd: flete,
      tasa_cambio: tasa,
      notas: document.getElementById('tankNotes').value.trim(),
      articulos: state.tankDraftItems
    };

    closeAllModals();

    const res = await ThorAPI.registerReception(payload);
    if (res && res.status === 'success') {
      Sonner.success(`Tanque ingresado: ${res.total_unidades} unidades añadidas al inventario`);
      await sincronizarConNube(false);
      renderAll();
    } else {
      Sonner.error(res.message || 'Error al registrar tanque');
    }
  }

  async function quickAdjustStock(id, delta) {
    const prod = state.inventory.find(p => p.id === id);
    if (!prod) return;

    const nuevoStock = Math.max(0, prod.cantidad + delta);
    prod.cantidad = nuevoStock;
    prod.estado = nuevoStock > 0 ? 'En Stock' : 'Agotado';
    renderInventory();
    renderDashboard();

    // Sincronizar en segundo plano
    ThorAPI.adjustStock(id, delta, 'Ajuste rápido');
    Sonner.info(`Stock de "${prod.nombre}": ${nuevoStock} un.`);
  }

  function confirmDeleteProduct(id) {
    const prod = state.inventory.find(p => p.id === id);
    if (!prod) return;

    if (confirm(`¿Eliminar "${prod.nombre}" del inventario?`)) {
      ThorAPI.deleteProduct(id);
      state.inventory = state.inventory.filter(p => p.id !== id);
      renderAll();
      Sonner.success('Producto eliminado');
    }
  }

  function confirmCancelSale(idVenta) {
    if (confirm('¿Anular esta venta y devolver las unidades al inventario?')) {
      ThorAPI.cancelSale(idVenta);
      const v = state.sales.find(x => x.id_venta === idVenta);
      if (v) {
        v.estado = 'Cancelada';
        const p = state.inventory.find(x => x.id === v.id_articulo);
        if (p) p.cantidad += v.cantidad;
      }
      renderAll();
      Sonner.success('Venta anulada y stock devuelto');
    }
  }

  function exportInventoryToExcel() {
    if (state.inventory.length === 0) {
      Sonner.info('No hay productos para exportar');
      return;
    }

    let csv = 'ID,Nombre,Categoria,Cantidad,Costo USD,Costo DOP,Precio Venta DOP,Ubicacion,Estado\n';
    state.inventory.forEach(p => {
      csv += `"${p.id}","${p.nombre.replace(/"/g, '""')}","${p.categoria}","${p.cantidad}","${p.costo_usd}","${p.costo_dop}","${p.precio_venta_dop}","${p.ubicacion}","${p.estado}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `Thor_Essence_Inventario_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    Sonner.success('Descargando archivo Excel (.CSV)...');
  }

  function setupEventListeners() {
    const searchInput = document.getElementById('inventorySearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim();
        renderInventory();
      });
    }

    const formProduct = document.getElementById('formProduct');
    if (formProduct) formProduct.addEventListener('submit', handleSaveProduct);

    const formSale = document.getElementById('formSale');
    if (formSale) formSale.addEventListener('submit', handleRegisterSale);

    const formTank = document.getElementById('formTank');
    if (formTank) formTank.addEventListener('submit', handleSaveTank);

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', closeAllModals);
    });
  }

  function setupCurrencyHandlers() {
    const toggle = document.getElementById('prodCurrencyToggle');
    if (toggle) {
      toggle.addEventListener('change', (e) => toggleProductCurrency(e.target.checked));
    }

    const usdInput = document.getElementById('prodCostoUsd');
    if (usdInput) usdInput.addEventListener('input', recalcularCostoProducto);

    const dopInput = document.getElementById('prodCostoDop');
    if (dopInput) dopInput.addEventListener('input', recalcularCostoProducto);

    const ventaInput = document.getElementById('prodPrecioVenta');
    if (ventaInput) ventaInput.addEventListener('input', calcularMargenProducto);

    const saleProdSelect = document.getElementById('saleProductSelect');
    if (saleProdSelect) saleProdSelect.addEventListener('change', handleSaleProductChange);

    const saleQty = document.getElementById('saleQtyInput');
    if (saleQty) saleQty.addEventListener('input', recalcularTotalVenta);

    const salePrice = document.getElementById('salePriceInput');
    if (salePrice) salePrice.addEventListener('input', recalcularTotalVenta);
  }

  function actualizarTexto(id, texto) {
    const el = document.getElementById(id);
    if (el) el.textContent = texto;
  }

  function obtenerUltimosDias(dias) {
    const resultado = [];
    for (let i = dias - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const diaNom = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getDay()];
      resultado.push({
        label: `${diaNom} ${d.getDate()}`,
        dateStr: d.toISOString().substring(0, 10)
      });
    }
    return resultado;
  }

  return {
    init,
    switchTab,
    openNewProductModal,
    openEditProductModal,
    openSaleModal,
    openSaleModalFor: (id) => openSaleModal(id),
    openTankModal,
    addTankDraftItem,
    removeTankDraftItem,
    updateTankDraftItem,
    quickAdjustStock,
    confirmDeleteProduct,
    confirmCancelSale,
    filterInventoryCategory: (cat) => { state.selectedCategory = cat; renderInventory(); },
    filterInventoryStock: (filter) => { state.selectedStockFilter = filter; switchTab('inventario'); },
    sincronizarConNube: () => sincronizarConNube(true),
    actualizarTasaCambio: () => actualizarTasaCambio(true),
    exportInventoryToExcel,
    closeAllModals,
    // Autenticación & RLS
    handleLogin,
    logout,
    togglePasswordVisibility,
    showLoginView,
    hideLoginView
  };
})();
