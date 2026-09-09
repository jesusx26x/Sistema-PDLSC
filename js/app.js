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
    cobros: [],
    metrics: {},
    config: {},
    exchangeRate: 60.50,
    searchQuery: '',
    selectedCategory: 'all',
    selectedStockFilter: 'all',
    selectedCobrosFilter: 'all',
    cobrosSearchQuery: '',
    saleMode: 'contado',
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
      if (icon) icon.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"/></svg>';
    } else {
      passInput.type = 'password';
      if (icon) icon.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>';
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
      if (btnIcon) btnIcon.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>';
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
    state.cobros = cached.cobros || [];
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
        state.cobros = res.data.cobros || [];
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
    if (tabName === 'cobros') renderCobros();
    if (tabName === 'tanques') renderReceptions();
    if (tabName === 'reportes') renderReports();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderAll() {
    renderDashboard();
    renderInventory();
    renderSales();
    renderCobros();
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

    // =========================================================================
    // KPI Y ALERTAS DE CUENTAS POR COBRAR ("FIADOS")
    // =========================================================================
    let totalPorCobrar = 0;
    let deudasActivas = 0;
    let cuotasVencenPronto = 0;
    const hoyStr = new Date().toISOString().substring(0, 10);
    const finQuincena = ThorAPI.obtenerProximaQuincena(new Date(), 1).toISOString().substring(0, 10);

    (state.cobros || []).forEach(c => {
      if (c.estado !== 'Saldada' && c.estado !== 'Cancelada') {
        totalPorCobrar += (parseFloat(c.saldo_pendiente_dop) || 0);
        deudasActivas++;
        if (c.proximo_vencimiento && c.proximo_vencimiento <= finQuincena) {
          cuotasVencenPronto++;
        }
      }
    });

    actualizarTexto('kpiTotalPorCobrar', `RD$ ${Math.round(totalPorCobrar).toLocaleString()}`);
    actualizarTexto('kpiCobrosBadge', `${deudasActivas} deudas activas`);
    actualizarTexto('kpiCuotasVencenPronto', `${cuotasVencenPronto} cuotas vencen pronto`);

    // Actualizar insignias de notificación en barra lateral y móvil
    const sidebarBadge = document.getElementById('sidebarCobrosBadge');
    const mobileDot = document.getElementById('mobileCobrosDot');
    if (sidebarBadge) {
      if (deudasActivas > 0) {
        sidebarBadge.textContent = deudasActivas;
        sidebarBadge.classList.remove('hidden');
      } else {
        sidebarBadge.classList.add('hidden');
      }
    }
    if (mobileDot) {
      if (deudasActivas > 0) {
        mobileDot.classList.remove('hidden');
      } else {
        mobileDot.classList.add('hidden');
      }
    }

    renderDashboardAlerts(bajoStock, agotados);
    renderDashboardCharts();
    renderRecentActivity();
  }

  function toggleNotificationDrawer(forceOpen) {
    const flyout = document.getElementById('notificationFlyout');
    if (!flyout) return;
    if (forceOpen === true) {
      flyout.classList.remove('hidden');
    } else if (forceOpen === false) {
      flyout.classList.add('hidden');
    } else {
      flyout.classList.toggle('hidden');
    }
  }

  function renderNotificationDrawer(itemsCriticos, cobrosUrgentes) {
    const list = document.getElementById('notificationFlyoutList');
    if (!list) return;

    const totalAlertas = (itemsCriticos ? itemsCriticos.length : 0) + (cobrosUrgentes ? cobrosUrgentes.length : 0);
    updateNotificationBadge(totalAlertas);

    if (totalAlertas === 0) {
      list.innerHTML = `
        <div class="p-6 text-center text-slate-400 space-y-2">
          <div class="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
          </div>
          <p class="text-xs font-semibold text-slate-200">Todo al día</p>
          <p class="text-[11px] text-slate-500">No tienes alertas urgentes de stock ni cobros vencidos pendientes.</p>
        </div>
      `;
      return;
    }

    let html = '';

    // Sección: Stock Crítico
    if (itemsCriticos && itemsCriticos.length > 0) {
      html += `
        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
            <span>Stock Crítico (${itemsCriticos.length})</span>
            <button onclick="ThorApp.filterInventoryStock('low'); ThorApp.toggleNotificationDrawer(false);" class="text-amber-400 hover:text-amber-300">Ver todo</button>
          </div>
      `;

      itemsCriticos.forEach(p => {
        const qty = parseInt(p.cantidad) || 0;
        const esAgotado = qty === 0;
        html += `
          <div class="p-2.5 rounded-xl bg-[#0D131F] border border-white/10 hover:border-amber-500/30 transition flex items-center justify-between gap-2 shadow-xs">
            <div class="min-w-0">
              <p class="text-xs font-semibold text-slate-100 truncate">${p.nombre}</p>
              <p class="text-[10px] text-slate-400">Quedan: <strong class="${esAgotado ? 'text-rose-400' : 'text-amber-400'} font-mono">${qty}</strong> (Mín: ${p.stock_minimo || 3})</p>
            </div>
            <button onclick="ThorApp.quickAdjustStock('${p.id}', 1)" class="btn-tactile px-2 py-1 text-[11px] bg-amber-500/15 text-amber-300 font-bold rounded-lg border border-amber-500/30 hover:bg-amber-500/25 shrink-0">
              + Stock
            </button>
          </div>
        `;
      });

      html += '</div>';
    }

    // Sección: Cuotas de Fiado
    if (cobrosUrgentes && cobrosUrgentes.length > 0) {
      html += `
        <div class="space-y-1.5 pt-2 border-t border-white/10">
          <div class="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
            <span>Cobros por Vencer (${cobrosUrgentes.length})</span>
            <button onclick="ThorApp.switchTab('cobros'); ThorApp.toggleNotificationDrawer(false);" class="text-amber-400 hover:text-amber-300">Ver todo</button>
          </div>
      `;

      cobrosUrgentes.forEach(c => {
        const pendiente = Math.round(parseFloat(c.saldo_pendiente_dop) || 0);
        html += `
          <div class="p-2.5 rounded-xl bg-[#0D131F] border border-white/10 hover:border-amber-500/30 transition flex items-center justify-between gap-2 shadow-xs">
            <div class="min-w-0">
              <p class="text-xs font-semibold text-slate-100 truncate">${c.cliente}</p>
              <p class="text-[10px] text-slate-400">Pendiente: <strong class="text-amber-400 font-mono">RD$ ${pendiente.toLocaleString()}</strong> • Vence: <span class="text-rose-400">${c.proximo_vencimiento || 'Pronto'}</span></p>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              ${c.telefono ? `
                <button onclick="ThorApp.openWhatsAppReminder('${c.id_cobro}')" class="btn-tactile p-1.5 text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/25" title="WhatsApp">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                </button>
              ` : ''}
              <button onclick="ThorApp.openAbonoModal('${c.id_cobro}'); ThorApp.toggleNotificationDrawer(false);" class="btn-tactile px-2 py-1 text-[11px] bg-emerald-500/15 text-emerald-300 font-bold rounded-lg border border-emerald-500/30 hover:bg-emerald-500/25">
                Abonar
              </button>
            </div>
          </div>
        `;
      });

      html += '</div>';
    }

    list.innerHTML = html;
  }

  function updateNotificationBadge(totalAlertas) {
    const badge = document.getElementById('notificationBadge');
    const countSpan = document.getElementById('flyoutAlertCount');
    if (countSpan) countSpan.textContent = totalAlertas;

    if (badge) {
      if (totalAlertas > 0) {
        badge.textContent = totalAlertas > 9 ? '9+' : totalAlertas;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }

  function renderDashboardAlerts(bajoStock, agotados) {
    // Recopilar alertas urgentes para el buzón flotante
    const itemsCriticos = state.inventory
      .filter(p => (parseInt(p.cantidad) || 0) <= (parseInt(p.stock_minimo) || 3));

    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() + 3);
    const fechaLimiteStr = fechaLimite.toISOString().substring(0, 10);

    const cobrosUrgentes = (state.cobros || []).filter(c => {
      if (c.estado === 'Saldada' || c.estado === 'Cancelada') return false;
      if (!c.proximo_vencimiento) return false;
      return c.proximo_vencimiento <= fechaLimiteStr;
    });

    renderNotificationDrawer(itemsCriticos, cobrosUrgentes);

    // Ocultar banner invasivo antiguo de la pantalla de inicio
    const legacy = document.getElementById('dashboardAlerts');
    if (legacy) {
      legacy.innerHTML = '';
      legacy.classList.add('hidden');
    }
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
            borderColor: '#E5B842',
            backgroundColor: 'rgba(229, 184, 66, 0.12)',
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointBackgroundColor: '#F3C958',
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
              grid: { color: 'rgba(255, 255, 255, 0.06)' },
              ticks: {
                color: '#94A3B8',
                callback: (val) => 'RD$ ' + val.toLocaleString()
              }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#94A3B8' }
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
              '#E5B842', '#F59E0B', '#F472B6', '#818CF8', '#38BDF8', '#34D399', '#94A3B8'
            ],
            borderColor: '#111827',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#94A3B8', font: { size: 11 }, boxWidth: 12 }
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
              ${esCancelada ? '<span class="text-rose-400 font-bold">✕</span>' : '<svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>'}
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
    renderStockFilterPills();
    renderCategoryFilters();

    const tbody = document.getElementById('inventoryTableBody');
    const cardsContainer = document.getElementById('inventoryCardsMobile');
    const countBadge = document.getElementById('inventoryCountBadge');
    const stockSelect = document.getElementById('inventoryStockSelect');

    if (stockSelect && stockSelect.value !== state.selectedStockFilter) {
      stockSelect.value = state.selectedStockFilter;
    }

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
          <svg class="w-12 h-12 mx-auto text-slate-500/50 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
          <p class="mt-2 text-sm text-slate-500 font-medium">No se encontraron productos con el filtro seleccionado (${state.selectedStockFilter === 'low' ? 'Stock Bajo' : state.selectedStockFilter === 'out' ? 'Agotados' : state.selectedStockFilter === 'in' ? 'En Stock' : 'Todos'}).</p>
          <button onclick="ThorApp.filterInventoryStock('all')" class="mt-4 btn-tactile btn-outline-gold text-xs py-2 px-4 shadow-xs">Ver Todos los Productos</button>
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

          const esLocal = (p.origen === 'local' || p.origen === 'Compra Local');
          const badgeOrigen = esLocal
            ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold whitespace-nowrap">Local</span>'
            : '<span class="text-[9px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-300 font-bold whitespace-nowrap">Tanque</span>';

          tableHtml += `
          <tr class="border-b border-slate-100 hover:bg-amber-50/40 transition">
            <td class="py-3 px-4">
              <div class="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
                <span>${p.nombre}</span>
                ${badgeOrigen}
              </div>
              <div class="text-xs text-slate-500 font-mono">${p.id} • ${p.ubicacion || (esLocal ? 'Tienda / Local' : 'Tanque')}</div>
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
                <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </button>
              <button onclick="ThorApp.openEditProductModal('${p.id}')" class="btn-tactile p-1.5 text-amber-700 hover:bg-amber-50 rounded-lg mr-1 border border-amber-200" title="Editar">
                <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button onclick="ThorApp.confirmDeleteProduct('${p.id}')" class="btn-tactile p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200" title="Eliminar">
                <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
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

        const esLocal = (p.origen === 'local' || p.origen === 'Compra Local');
        const badgeOrigen = esLocal
          ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold whitespace-nowrap">Local</span>'
          : '<span class="text-[9px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-300 font-bold whitespace-nowrap">Tanque</span>';

        cardsHtml += `
          <div class="p-4 rounded-2xl bento-card space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="flex items-center gap-1.5 mb-0.5">
                  <span class="text-[10px] uppercase font-bold text-amber-700 tracking-wider">${p.categoria || 'Variedades'}</span>
                  ${badgeOrigen}
                </div>
                <h4 class="font-bold text-slate-800 text-sm leading-snug">${p.nombre}</h4>
                <p class="text-[11px] text-slate-500">${p.ubicacion || (esLocal ? 'Tienda / Local' : 'Tanque')} • ID: ${p.id}</p>
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
                  <svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Vender
                </button>
                <button onclick="ThorApp.openEditProductModal('${p.id}')" class="btn-tactile p-2 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 text-xs">
                  <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>
                <button onclick="ThorApp.confirmDeleteProduct('${p.id}')" class="btn-tactile p-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs">
                  <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              </div>
            </div>
          </div>
        `;
      });
      cardsContainer.innerHTML = cardsHtml;
    }
  }

  function renderStockFilterPills() {
    const container = document.getElementById('stockFilterPillsContainer');
    if (!container) return;

    let total = state.inventory.length;
    let inCount = 0;
    let lowCount = 0;
    let outCount = 0;

    state.inventory.forEach(p => {
      const q = parseInt(p.cantidad) || 0;
      const m = parseInt(p.stock_minimo) || 3;
      if (q === 0) outCount++;
      else if (q <= m) lowCount++;
      else inCount++;
    });

    const pills = [
      { id: 'all', label: `Todos (${total})`, activeClass: 'bg-slate-800 text-white font-bold shadow-xs border-slate-800' },
      { id: 'in', label: `En Stock (${inCount})`, activeClass: 'bg-emerald-100 text-emerald-900 border-emerald-400 font-bold shadow-xs' },
      { id: 'low', label: `Stock Bajo (${lowCount})`, activeClass: 'bg-amber-100 text-amber-900 border-amber-400 font-bold shadow-xs ring-2 ring-amber-400/50' },
      { id: 'out', label: `Agotados (${outCount})`, activeClass: 'bg-rose-100 text-rose-900 border-rose-400 font-bold shadow-xs ring-2 ring-rose-400/50' }
    ];

    let html = '';
    pills.forEach(p => {
      const isSelected = state.selectedStockFilter === p.id;
      html += `
        <button type="button" onclick="ThorApp.filterInventoryStock('${p.id}')" 
          class="btn-tactile px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition border ${
            isSelected 
              ? p.activeClass 
              : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-300 shadow-2xs'
          }">
          ${p.label}
        </button>
      `;
    });

    container.innerHTML = html;
  }

  function renderCategoryFilters() {
    const container = document.getElementById('categoryPillsContainer');
    if (!container) return;

    const categories = ['all', ...ThorAPI.DEFAULT_CATEGORIES];
    let html = '';

    categories.forEach(cat => {
      const isSelected = state.selectedCategory === cat;
      const label = cat === 'all' ? 'Todos' : cat;
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
          <svg class="w-12 h-12 mx-auto text-slate-500/50 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
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
          <svg class="w-12 h-12 mx-auto text-slate-500/50 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
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
                <svg class="w-5 h-5 inline text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
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

  function openNewProductModal(preselectedOrigen = 'local') {
    document.getElementById('modalProductTitle').textContent = preselectedOrigen === 'local' ? 'Nuevo Producto (Compra Local / Sin Tanque)' : 'Nuevo Producto';
    document.getElementById('formProduct').reset();
    document.getElementById('prodId').value = '';
    const origenSelect = document.getElementById('prodOrigen');
    if (origenSelect) origenSelect.value = preselectedOrigen;
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
    const origenSelect = document.getElementById('prodOrigen');
    if (origenSelect) origenSelect.value = prod.origen || 'local';
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

    const origenSelect = document.getElementById('prodOrigen');
    const origen = origenSelect ? origenSelect.value : 'local';
    const costoUsd = parseFloat(document.getElementById('prodCostoUsd').value) || 0;
    const costoDop = parseFloat(document.getElementById('prodCostoDop').value) || (costoUsd * state.exchangeRate);
    const precioVenta = parseFloat(document.getElementById('prodPrecioVenta').value) || 0;
    const cantidad = parseInt(document.getElementById('prodCantidad').value) || 0;
    const stockMin = parseInt(document.getElementById('prodStockMin').value) || 3;

    const prodData = {
      id: id || undefined,
      nombre: nombre,
      origen: origen,
      categoria: document.getElementById('prodCategoria').value,
      descripcion: document.getElementById('prodDescripcion').value.trim(),
      cantidad: cantidad,
      stock_minimo: stockMin,
      costo_usd: costoUsd,
      costo_dop: costoDop,
      precio_venta_dop: precioVenta,
      ubicacion: document.getElementById('prodUbicacion').value.trim() || (origen === 'local' ? 'Compra Local' : 'Almacén Principal')
    };

    closeAllModals();

    const res = await ThorAPI.saveProduct(prodData);
    if (res && res.status === 'success') {
      Sonner.success(`Producto guardado correctamente (${origen === 'local' ? 'Compra Local' : 'Tanque EE.UU.'})`);
      await sincronizarConNube(false);
      renderAll();
    } else {
      Sonner.error(res.message || 'No se pudo guardar el producto');
    }
  }

  function openSaleModal(selectedProductId = null, initialMode = 'contado') {
    const select = document.getElementById('saleProductSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Selecciona un producto a vender --</option>';
    state.inventory.forEach(p => {
      const disabled = p.cantidad <= 0 ? 'disabled' : '';
      const stockTxt = p.cantidad <= 0 ? '(Agotado)' : `(${p.cantidad} disp.)`;
      const origTxt = (p.origen === 'local' || p.origen === 'Compra Local') ? 'Local' : 'Tanque';
      select.innerHTML += `
        <option value="${p.id}" ${disabled} ${selectedProductId === p.id ? 'selected' : ''}>
          ${p.nombre} — RD$ ${Number(p.precio_venta_dop || 0).toLocaleString()} ${stockTxt} [${origTxt}]
        </option>
      `;
    });

    const formSale = document.getElementById('formSale');
    if (formSale) formSale.reset();
    
    if (selectedProductId) {
      select.value = selectedProductId;
    }
    
    setSaleMode(initialMode);
    handleSaleProductChange();
    document.getElementById('modalSale').classList.remove('hidden');
  }

  function openSaleModalCredit(selectedProductId = null) {
    openSaleModal(selectedProductId, 'credito');
  }

  function setSaleMode(mode) {
    state.saleMode = mode;
    const contadoBtn = document.getElementById('saleModeContadoBtn');
    const creditoBtn = document.getElementById('saleModeCreditoBtn');
    const creditFields = document.getElementById('saleCreditFields');
    const changeGroup = document.getElementById('saleChangeGroup');
    const tipoVentaInput = document.getElementById('saleTipoVenta');
    const paymentMethodGroup = document.getElementById('salePaymentMethodGroup');

    if (tipoVentaInput) tipoVentaInput.value = mode;

    if (mode === 'credito') {
      if (contadoBtn) {
        contadoBtn.className = 'btn-tactile py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition bg-white text-slate-700 hover:bg-slate-100 border-slate-300';
      }
      if (creditoBtn) {
        creditoBtn.className = 'btn-tactile py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition bg-amber-600 text-white border-amber-600 shadow-xs';
      }
      if (creditFields) creditFields.classList.remove('hidden');
      if (changeGroup) changeGroup.classList.add('hidden');
      if (paymentMethodGroup) paymentMethodGroup.classList.add('hidden');
      recalcularCuotasVenta();
    } else {
      if (contadoBtn) {
        contadoBtn.className = 'btn-tactile py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition bg-amber-600 text-white border-amber-600 shadow-xs';
      }
      if (creditoBtn) {
        creditoBtn.className = 'btn-tactile py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition bg-white text-slate-700 hover:bg-slate-100 border-slate-300';
      }
      if (creditFields) creditFields.classList.add('hidden');
      if (changeGroup) changeGroup.classList.remove('hidden');
      if (paymentMethodGroup) paymentMethodGroup.classList.remove('hidden');
    }
  }

  function recalcularCuotasVenta() {
    const qtyInput = document.getElementById('saleQtyInput');
    const priceInput = document.getElementById('salePriceInput');
    const abonoInput = document.getElementById('saleCreditAbonoInicial');
    const frecSelect = document.getElementById('saleCreditFrecuencia');
    const cuotasSelect = document.getElementById('saleCreditNumCuotas');
    const previewDiv = document.getElementById('saleCreditCuotasPreview');

    if (!previewDiv) return;

    const qty = parseInt(qtyInput ? qtyInput.value : 1) || 1;
    const price = parseFloat(priceInput ? priceInput.value : 0) || 0;
    const totalVenta = qty * price;
    const abonoInicial = Math.min(totalVenta, Math.max(0, parseFloat(abonoInput ? abonoInput.value : 0) || 0));
    const saldoFinanciar = Math.max(0, totalVenta - abonoInicial);
    const frecuencia = frecSelect ? frecSelect.value : 'quincenal';
    const numCuotas = parseInt(cuotasSelect ? cuotasSelect.value : 2) || 2;

    if (totalVenta <= 0) {
      previewDiv.innerHTML = '<p class="text-slate-400 text-center py-2 text-[11px]">Ingresa precio y cantidad para proyectar el cronograma de cuotas.</p>';
      return;
    }

    const plan = ThorAPI.calcularPlanCuotas(totalVenta, abonoInicial, numCuotas, frecuencia, new Date());

    let html = `
      <div class="flex items-center justify-between text-[11px] font-semibold text-slate-700 pb-1 border-b border-amber-200">
        <span>Venta: RD$ ${Number(totalVenta).toLocaleString()}</span>
        ${abonoInicial > 0 ? `<span class="text-emerald-700 font-bold">Inicial: RD$ ${Number(abonoInicial).toLocaleString()}</span>` : ''}
        <span class="text-amber-900 font-bold">Por Financiar: RD$ ${Number(saldoFinanciar).toLocaleString()}</span>
      </div>
      <div class="space-y-1 pt-1">
    `;

    plan.forEach(c => {
      html += `
        <div class="flex items-center justify-between text-[11px] py-1 px-2 rounded-lg bg-amber-50/80 border border-amber-200">
          <span class="font-bold text-amber-950">Cuota #${c.numero} (${frecuencia === 'quincenal' ? '15 y 30' : 'Mensual'})</span>
          <span class="font-mono text-slate-600">Vence: <strong>${c.fecha_vencimiento}</strong></span>
          <span class="font-bold font-mono text-amber-800">RD$ ${Number(c.monto).toLocaleString()}</span>
        </div>
      `;
    });

    html += '</div>';
    previewDiv.innerHTML = html;
  }

  function handleSaleProductChange() {
    const id = (document.getElementById('saleProductSelect') || {}).value;
    const prod = state.inventory.find(p => p.id === id);
    const infoBox = document.getElementById('saleProductInfo');
    const availableStock = document.getElementById('saleAvailableStock');
    const unitCost = document.getElementById('saleUnitCost');
    const priceInput = document.getElementById('salePriceInput');
    const qtyInput = document.getElementById('saleQtyInput');

    if (prod) {
      if (infoBox) infoBox.classList.remove('hidden');
      if (availableStock) {
        const colorClass = prod.cantidad === 0 ? 'text-rose-600' : (prod.cantidad <= (prod.stock_minimo || 3) ? 'text-amber-600' : 'text-emerald-600');
        availableStock.className = `font-bold text-sm ${colorClass}`;
        availableStock.textContent = `${prod.cantidad} unidades disponibles`;
      }
      if (unitCost) {
        unitCost.textContent = `RD$ ${Number(prod.costo_dop || 0).toLocaleString()}`;
      }
      if (priceInput) priceInput.value = prod.precio_venta_dop || 0;
      if (qtyInput) {
        qtyInput.max = prod.cantidad;
        if (parseInt(qtyInput.value) > prod.cantidad) qtyInput.value = prod.cantidad;
        if (!qtyInput.value || parseInt(qtyInput.value) <= 0) qtyInput.value = 1;
      }
    } else {
      if (infoBox) infoBox.classList.add('hidden');
      if (priceInput) priceInput.value = '';
    }
    recalcularTotalVenta();
    if (state.saleMode === 'credito') {
      recalcularCuotasVenta();
    }
  }

  function recalcularTotalVenta() {
    const id = (document.getElementById('saleProductSelect') || {}).value;
    const prod = state.inventory.find(p => p.id === id);
    const qtyInput = document.getElementById('saleQtyInput');
    const priceInput = document.getElementById('salePriceInput');
    const totalElem = document.getElementById('saleTotalDop') || document.getElementById('saleTotalPreview');
    const profitElem = document.getElementById('saleNetProfitDop');
    const receivedInput = document.getElementById('saleReceivedInput');
    const changeElem = document.getElementById('saleChangeDop');

    const qty = parseInt(qtyInput ? qtyInput.value : 0) || 0;
    const price = parseFloat(priceInput ? priceInput.value : 0) || 0;
    const total = qty * price;

    if (totalElem) {
      totalElem.textContent = `RD$ ${total.toLocaleString()}`;
    }

    if (profitElem && prod) {
      const costoUnitario = parseFloat(prod.costo_dop) || 0;
      const ganancia = total - (costoUnitario * qty);
      profitElem.textContent = `${ganancia >= 0 ? '+' : ''}RD$ ${Math.round(ganancia).toLocaleString()}`;
      profitElem.className = `font-bold font-mono ${ganancia >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
    }

    if (receivedInput && changeElem) {
      const recibido = parseFloat(receivedInput.value) || 0;
      if (recibido > 0) {
        const cambio = recibido - total;
        changeElem.textContent = `RD$ ${cambio >= 0 ? cambio.toFixed(2) : '0.00'}`;
        changeElem.className = `text-xs sm:text-sm font-bold font-mono ${cambio >= 0 ? 'text-amber-700' : 'text-rose-600'}`;
      } else {
        changeElem.textContent = 'RD$ 0.00';
        changeElem.className = 'text-xs sm:text-sm font-bold text-amber-700 font-mono';
      }
    }
  }

  async function handleRegisterSale(e) {
    if (e) e.preventDefault();
    const idProd = (document.getElementById('saleProductSelect') || {}).value;
    const qtyInput = document.getElementById('saleQtyInput');
    const priceInput = document.getElementById('salePriceInput');
    const customerInput = document.getElementById('saleCustomerInput') || document.getElementById('saleCliente');
    const methodInput = document.getElementById('salePaymentMethod') || document.getElementById('saleMetodoPago');

    const cant = parseInt(qtyInput ? qtyInput.value : 0) || 0;
    const precio = parseFloat(priceInput ? priceInput.value : 0) || 0;
    const cliente = (customerInput && customerInput.value.trim()) || 'Cliente General';

    const esCredito = (state.saleMode === 'credito');
    const metodo = esCredito ? 'Crédito / Fiado' : ((methodInput && methodInput.value) || 'Efectivo');

    const phoneInput = document.getElementById('saleCreditPhone');
    const abonoInput = document.getElementById('saleCreditAbonoInicial');
    const frecSelect = document.getElementById('saleCreditFrecuencia');
    const cuotasSelect = document.getElementById('saleCreditNumCuotas');

    const telefonoCliente = esCredito && phoneInput ? phoneInput.value.trim() : '';
    const abonoInicial = esCredito ? Math.max(0, parseFloat(abonoInput ? abonoInput.value : 0) || 0) : 0;
    const frecuencia = esCredito && frecSelect ? frecSelect.value : 'quincenal';
    const numCuotas = esCredito && cuotasSelect ? (parseInt(cuotasSelect.value) || 2) : 1;

    if (!idProd) {
      Sonner.warning('Por favor selecciona un producto para vender');
      return;
    }

    const prod = state.inventory.find(p => p.id === idProd);
    if (!prod) {
      Sonner.error('El producto seleccionado no existe en inventario');
      return;
    }

    if (cant <= 0) {
      Sonner.warning('La cantidad a vender debe ser al menos 1 unidad');
      return;
    }

    if (prod.cantidad < cant) {
      Sonner.error(`Stock insuficiente: Solo quedan ${prod.cantidad} unidades disponibles.`);
      return;
    }

    const totalVenta = cant * precio;
    if (esCredito && abonoInicial >= totalVenta) {
      Sonner.warning('El abono inicial cubre el total de la venta. Puedes registrarla al contado.');
      return;
    }

    // =========================================================================
    // REDUCCIÓN AUTOMÁTICA DE STOCK INMEDIATA (0 LATENCIA VISUAL)
    // =========================================================================
    prod.cantidad = Math.max(0, prod.cantidad - cant);
    const stockMin = parseInt(prod.stock_minimo) || 3;
    prod.estado = prod.cantidad === 0 ? 'Agotado' : (prod.cantidad <= stockMin ? 'Stock Bajo' : 'En Stock');

    // Registrar venta en memoria local de inmediato
    const costoUnit = parseFloat(prod.costo_dop) || 0;
    const ganancia = totalVenta - (costoUnit * cant);
    const idVentaLocal = 'VTA-' + Date.now().toString().slice(-6);
    const nuevaVenta = {
      id_venta: idVentaLocal,
      fecha_venta: new Date().toISOString().replace('T', ' ').substring(0, 19),
      id_articulo: prod.id,
      nombre_articulo: prod.nombre,
      categoria: prod.categoria || 'Variedades',
      cantidad: cant,
      precio_unitario_dop: precio,
      total_dop: totalVenta,
      costo_unitario_dop: costoUnit,
      ganancia_dop: ganancia,
      cliente: cliente,
      telefono: telefonoCliente,
      metodo_pago: metodo,
      estado: esCredito ? 'Pendiente de Cobro' : 'Completada',
      notas: esCredito ? `${numCuotas} cuotas ${frecuencia === 'quincenal' ? 'quincenales (15 y 30)' : 'mensuales'}` : ''
    };

    state.sales.unshift(nuevaVenta);

    // Si es crédito, registrar la deuda en Cobros de inmediato
    let nuevoCobro = null;
    if (esCredito) {
      const idCobro = 'COB-' + Date.now().toString().slice(-6);
      const saldoPendiente = Math.max(0, totalVenta - abonoInicial);
      const planCuotas = ThorAPI.calcularPlanCuotas(totalVenta, abonoInicial, numCuotas, frecuencia, new Date());

      const historialAbonos = [];
      if (abonoInicial > 0) {
        historialAbonos.push({
          id_abono: 'ABN-INI-' + Date.now(),
          fecha: new Date().toLocaleString(),
          monto: abonoInicial,
          metodo_pago: 'Efectivo',
          nota: 'Abono inicial en tienda'
        });
      }

      let proximoVencimiento = '';
      const primerPendiente = planCuotas.find(c => c.estado === 'Pendiente');
      if (primerPendiente) proximoVencimiento = primerPendiente.fecha_vencimiento;

      nuevoCobro = {
        id_cobro: idCobro,
        id_venta: idVentaLocal,
        fecha_venta: nuevaVenta.fecha_venta,
        cliente: cliente,
        telefono: telefonoCliente,
        articulo: prod.nombre,
        monto_total_dop: totalVenta,
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

      state.cobros.unshift(nuevoCobro);
    }

    // Actualizar caché de inmediato en localStorage
    const cached = ThorAPI.getCachedData();
    if (cached) {
      if (cached.inventario) {
        const cp = cached.inventario.find(x => x.id === prod.id);
        if (cp) {
          cp.cantidad = prod.cantidad;
          cp.estado = prod.estado;
        }
      }
      if (!cached.ventas) cached.ventas = [];
      cached.ventas.unshift(nuevaVenta);
      if (esCredito && nuevoCobro) {
        if (!cached.cobros) cached.cobros = [];
        cached.cobros.unshift(nuevoCobro);
      }
      ThorAPI.setCachedData(cached);
    }

    // Cerrar modal y re-renderizar inmediatamente
    closeAllModals();
    renderAll();

    if (esCredito) {
      const saldo = totalVenta - abonoInicial;
      Sonner.success(`¡Venta a Crédito ("Fiado") registrada! Cliente: ${cliente} • Saldo: RD$ ${Number(saldo).toLocaleString()} en ${numCuotas} cuotas ${frecuencia}.`, 5500);
    } else {
      Sonner.success(`¡Venta registrada! Total: RD$ ${Number(totalVenta).toLocaleString()} — Stock restante: ${prod.cantidad} un.`, 4500);
    }

    // Sincronizar con Google Sheets en segundo plano sin congelar la pantalla
    const salePayload = {
      id_articulo: prod.id,
      cantidad: cant,
      precio_unitario_dop: precio,
      cliente: cliente,
      metodo_pago: metodo,
      tipo_venta: esCredito ? 'credito' : 'contado',
      es_credito: esCredito,
      telefono: telefonoCliente,
      abono_inicial: abonoInicial,
      frecuencia: frecuencia,
      num_cuotas: numCuotas
    };

    ThorAPI.registerSale(salePayload).then(res => {
      if (res && res.status === 'success') {
        sincronizarConNube(false);
      }
    }).catch(err => {
      console.warn('Error sincronizando venta con Google Sheets:', err);
    });
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
    if (confirm('¿Anular esta venta y devolver las unidades al inventario automáticamente?')) {
      const v = state.sales.find(x => x.id_venta === idVenta);
      if (v && v.estado !== 'Cancelada') {
        v.estado = 'Cancelada';
        const p = state.inventory.find(x => x.id === v.id_articulo);
        if (p) {
          p.cantidad += (parseInt(v.cantidad) || 0);
          const min = parseInt(p.stock_minimo) || 3;
          p.estado = p.cantidad > min ? 'En Stock' : (p.cantidad > 0 ? 'Stock Bajo' : 'Agotado');
        }

        // Si tenía cuenta por cobrar asociada, anularla también
        const cobro = state.cobros.find(c => c.id_venta === idVenta);
        if (cobro) {
          cobro.estado = 'Cancelada';
          cobro.saldo_pendiente_dop = 0;
        }

        const cached = ThorAPI.getCachedData();
        if (cached) {
          if (cached.inventario && p) {
            const cp = cached.inventario.find(x => x.id === v.id_articulo);
            if (cp) {
              cp.cantidad = p.cantidad;
              cp.estado = p.estado;
            }
          }
          const cv = (cached.ventas || []).find(x => x.id_venta === idVenta);
          if (cv) cv.estado = 'Cancelada';
          if (cached.cobros && cobro) {
            const cc = cached.cobros.find(x => x.id_venta === idVenta);
            if (cc) {
              cc.estado = 'Cancelada';
              cc.saldo_pendiente_dop = 0;
            }
          }
          ThorAPI.setCachedData(cached);
        }
        renderAll();
        Sonner.success(`Venta ${idVenta} anulada y ${v.cantidad} unidades devueltas al inventario`);
        ThorAPI.cancelSale(idVenta).then(() => sincronizarConNube(false));
      }
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

  // =========================================================================
  // MÓDULO DE COBROS & CUENTAS POR COBRAR ("FIADO")
  // =========================================================================
  function renderCobros() {
    renderCobrosFilterPills();

    const tbody = document.getElementById('cobrosTableBody');
    const cardsContainer = document.getElementById('cobrosCardsMobile');
    const countBadge = document.getElementById('cobrosCountBadge');

    let totalPendiente = 0;
    let vencenEstaQuincena = 0;
    let clientesMap = new Set();
    let totalRecuperado = 0;

    const hoyStr = new Date().toISOString().substring(0, 10);
    const finQuincena = ThorAPI.obtenerProximaQuincena(new Date(), 1).toISOString().substring(0, 10);

    state.cobros.forEach(c => {
      totalRecuperado += (parseFloat(c.total_cobrado_dop) || 0);
      if (c.estado !== 'Saldada' && c.estado !== 'Cancelada') {
        const saldo = parseFloat(c.saldo_pendiente_dop) || 0;
        totalPendiente += saldo;
        if (c.cliente) clientesMap.add(c.cliente.toLowerCase());
        if (c.proximo_vencimiento && c.proximo_vencimiento <= finQuincena) {
          vencenEstaQuincena++;
        }
      }
    });

    actualizarTexto('kpiCobrosTotalPendiente', `RD$ ${Math.round(totalPendiente).toLocaleString()}`);
    actualizarTexto('kpiCobrosVencenHoy', `${vencenEstaQuincena} cuotas`);
    actualizarTexto('kpiCobrosClientes', `${clientesMap.size} personas`);
    actualizarTexto('kpiCobrosTotalRecuperado', `RD$ ${Math.round(totalRecuperado).toLocaleString()}`);

    let filtered = state.cobros.filter(c => {
      const q = state.cobrosSearchQuery.toLowerCase();
      const matchSearch = !q ||
        (c.cliente && c.cliente.toLowerCase().includes(q)) ||
        (c.telefono && c.telefono.toLowerCase().includes(q)) ||
        (c.articulo && c.articulo.toLowerCase().includes(q)) ||
        (c.id_cobro && c.id_cobro.toLowerCase().includes(q));

      let matchStatus = true;
      if (state.selectedCobrosFilter === 'pending') {
        matchStatus = c.estado === 'Pendiente' || c.estado === 'Parcial';
      } else if (state.selectedCobrosFilter === 'paid') {
        matchStatus = c.estado === 'Saldada';
      } else if (state.selectedCobrosFilter === 'overdue') {
        matchStatus = (c.estado !== 'Saldada' && c.estado !== 'Cancelada') && c.proximo_vencimiento && c.proximo_vencimiento < hoyStr;
      }

      return matchSearch && matchStatus;
    });

    if (countBadge) countBadge.textContent = `${filtered.length} cuentas`;

    if (filtered.length === 0) {
      const emptyMsg = `
        <div class="text-center py-12">
          <svg class="w-12 h-12 mx-auto text-slate-500/50 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
          <p class="mt-2 text-sm text-slate-500 font-medium">No se encontraron cuentas por cobrar con los filtros aplicados.</p>
          <button onclick="ThorApp.openSaleModalCredit()" class="mt-4 btn-tactile btn-gold text-xs py-2 px-4 shadow-xs">+ Registrar Venta a Crédito ("Fiado")</button>
        </div>
      `;
      if (tbody) tbody.innerHTML = `<tr><td colspan="8">${emptyMsg}</td></tr>`;
      if (cardsContainer) cardsContainer.innerHTML = emptyMsg;
      return;
    }

    // Render Desktop Table
    if (tbody) {
      let tableHtml = '';
      filtered.forEach(c => {
        const isSaldada = c.estado === 'Saldada';
        const isVencida = !isSaldada && c.proximo_vencimiento && c.proximo_vencimiento < hoyStr;
        const isHoy = !isSaldada && c.proximo_vencimiento === hoyStr;

        let badgeClass = 'badge-warning';
        let statusText = c.estado || 'Pendiente';

        if (isSaldada) {
          badgeClass = 'badge-success';
          statusText = 'Saldada';
        } else if (isVencida) {
          badgeClass = 'badge-danger';
          statusText = 'Vencida';
        } else if (c.estado === 'Parcial') {
          badgeClass = 'badge-gold';
          statusText = 'Parcial';
        }

        const total = parseFloat(c.monto_total_dop) || 0;
        const cobrado = parseFloat(c.total_cobrado_dop) || 0;
        const saldo = parseFloat(c.saldo_pendiente_dop) || 0;
        const pct = total > 0 ? Math.round((cobrado / total) * 100) : 0;

        tableHtml += `
          <tr class="border-b border-slate-100 hover:bg-amber-50/40 transition">
            <td class="py-3 px-4">
              <div class="font-semibold text-slate-900 text-sm">${c.cliente}</div>
              <div class="text-xs text-slate-500 flex items-center gap-1.5">
                <span>${c.telefono || 'Sin WhatsApp'}</span>
                ${c.telefono ? `<button onclick="ThorApp.openWhatsAppReminder('${c.id_cobro}')" class="text-emerald-600 hover:text-emerald-700 text-xs font-bold" title="WhatsApp"><svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg></button>` : ''}
              </div>
            </td>
            <td class="py-3 px-3">
              <div class="font-medium text-slate-800 text-xs">${c.articulo}</div>
              <div class="text-[11px] text-amber-800 font-medium">${c.num_cuotas} cuotas (${c.frecuencia === 'quincenal' ? '15 y 30' : 'Mensual'})</div>
            </td>
            <td class="py-3 px-3 text-right font-bold text-sm text-slate-900 font-mono">
              RD$ ${Number(total).toLocaleString()}
            </td>
            <td class="py-3 px-3 text-right">
              <div class="text-xs text-emerald-700 font-mono font-semibold">+RD$ ${Number(cobrado).toLocaleString()}</div>
              <div class="text-xs font-bold font-mono ${isSaldada ? 'text-slate-400' : 'text-amber-900'}">RD$ ${Number(saldo).toLocaleString()}</div>
            </td>
            <td class="py-3 px-3 text-center">
              <div class="w-20 mx-auto bg-slate-200 h-1.5 rounded-full overflow-hidden">
                <div class="bg-gradient-to-r from-amber-500 to-emerald-500 h-full rounded-full" style="width: ${Math.min(100, pct)}%"></div>
              </div>
              <span class="text-[10px] text-slate-500 font-mono block mt-0.5">${pct}%</span>
            </td>
            <td class="py-3 px-3 text-center">
              <span class="text-xs font-medium ${isVencida ? 'text-rose-600 font-bold' : (isHoy ? 'text-amber-700 font-bold' : 'text-slate-700')}">
                ${c.proximo_vencimiento || '-'}
              </span>
            </td>
            <td class="py-3 px-3 text-center">
              <span class="${badgeClass}">${statusText}</span>
            </td>
            <td class="py-3 px-4 text-right whitespace-nowrap">
              ${!isSaldada ? `
                <button onclick="ThorApp.openAbonoModal('${c.id_cobro}')" class="btn-tactile px-2.5 py-1 text-xs bg-emerald-50 text-emerald-800 font-bold rounded-lg border border-emerald-300 hover:bg-emerald-100 mr-1 shadow-2xs">
                  <svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>Abonar
                </button>
              ` : ''}
              <button onclick="ThorApp.openWhatsAppReminder('${c.id_cobro}')" class="btn-tactile p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg mr-1 border border-emerald-200" title="WhatsApp">
                <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
              </button>
              <button onclick="ThorApp.openDetalleCobro('${c.id_cobro}')" class="btn-tactile p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200" title="Detalle">
                <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
              </button>
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = tableHtml;
    }

    // Render Mobile Cards
    if (cardsContainer) {
      let cardsHtml = '';
      filtered.forEach(c => {
        const isSaldada = c.estado === 'Saldada';
        const isVencida = !isSaldada && c.proximo_vencimiento && c.proximo_vencimiento < hoyStr;

        let badgeClass = 'badge-warning';
        let statusText = c.estado || 'Pendiente';

        if (isSaldada) {
          badgeClass = 'badge-success';
          statusText = 'Saldada';
        } else if (isVencida) {
          badgeClass = 'badge-danger';
          statusText = 'Vencida';
        } else if (c.estado === 'Parcial') {
          badgeClass = 'badge-gold';
          statusText = 'Parcial';
        }

        const total = parseFloat(c.monto_total_dop) || 0;
        const cobrado = parseFloat(c.total_cobrado_dop) || 0;
        const saldo = parseFloat(c.saldo_pendiente_dop) || 0;
        const pct = total > 0 ? Math.round((cobrado / total) * 100) : 0;

        cardsHtml += `
          <div class="p-4 rounded-2xl bento-card space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <span class="text-[10px] uppercase font-bold text-amber-700 tracking-wider font-mono">${c.id_cobro}</span>
                <h4 class="font-bold text-slate-900 text-sm">${c.cliente}</h4>
                <p class="text-xs text-slate-500">${c.articulo} • ${c.num_cuotas} cuotas</p>
              </div>
              <span class="${badgeClass}">${statusText}</span>
            </div>

            <div class="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-center">
              <div>
                <span class="text-[10px] text-slate-500 block">Total</span>
                <span class="text-xs font-bold text-slate-800 font-mono">RD$ ${Number(total).toLocaleString()}</span>
              </div>
              <div>
                <span class="text-[10px] text-slate-500 block">Abonado</span>
                <span class="text-xs font-bold text-emerald-600 font-mono">RD$ ${Number(cobrado).toLocaleString()}</span>
              </div>
              <div>
                <span class="text-[10px] text-slate-500 block">Resta</span>
                <span class="text-xs font-bold text-amber-900 font-mono">RD$ ${Number(saldo).toLocaleString()}</span>
              </div>
            </div>

            <div class="space-y-1">
              <div class="flex items-center justify-between text-[11px] text-slate-500">
                <span>Progreso de pago:</span>
                <span class="font-bold font-mono text-slate-700">${pct}%</span>
              </div>
              <div class="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                <div class="bg-gradient-to-r from-amber-500 to-emerald-500 h-full rounded-full" style="width: ${Math.min(100, pct)}%"></div>
              </div>
            </div>

            <div class="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
              <span class="text-[11px] text-slate-500">Vence: <strong class="${isVencida ? 'text-rose-600' : 'text-slate-700'}">${c.proximo_vencimiento || '-'}</strong></span>
              <div class="flex items-center gap-1.5">
                ${!isSaldada ? `
                  <button onclick="ThorApp.openAbonoModal('${c.id_cobro}')" class="btn-tactile px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-bold text-xs shadow-xs">
                    <svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>Abonar
                  </button>
                ` : ''}
                <button onclick="ThorApp.openWhatsAppReminder('${c.id_cobro}')" class="btn-tactile p-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">
                  <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                </button>
                <button onclick="ThorApp.openDetalleCobro('${c.id_cobro}')" class="btn-tactile p-1.5 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 text-xs">
                  <svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                </button>
              </div>
            </div>
          </div>
        `;
      });
      cardsContainer.innerHTML = cardsHtml;
    }
  }

  function renderCobrosFilterPills() {
    const container = document.getElementById('cobrosFilterPillsContainer');
    if (!container) return;

    const hoyStr = new Date().toISOString().substring(0, 10);
    let total = state.cobros.length;
    let pendingCount = 0;
    let paidCount = 0;
    let overdueCount = 0;

    state.cobros.forEach(c => {
      if (c.estado === 'Saldada') {
        paidCount++;
      } else if (c.estado !== 'Cancelada') {
        pendingCount++;
        if (c.proximo_vencimiento && c.proximo_vencimiento < hoyStr) {
          overdueCount++;
        }
      }
    });

    const pills = [
      { id: 'all', label: `Todos (${total})` },
      { id: 'pending', label: `⏳ Con Deuda (${pendingCount})` },
      { id: 'overdue', label: `Vencidos (${overdueCount})` },
      { id: 'paid', label: `Saldados (${paidCount})` }
    ];

    let html = '';
    pills.forEach(p => {
      const isSelected = state.selectedCobrosFilter === p.id;
      html += `
        <button type="button" onclick="ThorApp.filterCobrosStatus('${p.id}')"
          class="btn-tactile px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition border ${
            isSelected
              ? 'bg-amber-600 text-white font-bold shadow-xs border-amber-600'
              : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-300 shadow-2xs'
          }">
          ${p.label}
        </button>
      `;
    });

    container.innerHTML = html;
  }

  function filterCobrosStatus(status) {
    state.selectedCobrosFilter = status;
    renderCobros();
  }

  function handleCobrosSearch(query) {
    state.cobrosSearchQuery = query.trim();
    renderCobros();
  }

  function openAbonoModal(idCobro) {
    const cobro = state.cobros.find(c => c.id_cobro === idCobro);
    if (!cobro) return;

    document.getElementById('abonoIdCobro').value = cobro.id_cobro;
    actualizarTexto('modalAbonoSubtitle', `${cobro.cliente} • ${cobro.articulo}`);
    actualizarTexto('abonoTotalDop', `RD$ ${Number(cobro.monto_total_dop).toLocaleString()}`);
    actualizarTexto('abonoCobradoDop', `RD$ ${Number(cobro.total_cobrado_dop).toLocaleString()}`);
    actualizarTexto('abonoPendienteDop', `RD$ ${Number(cobro.saldo_pendiente_dop).toLocaleString()}`);

    const montoInput = document.getElementById('abonoMontoInput');
    const notaInput = document.getElementById('abonoNotaInput');
    if (montoInput) {
      montoInput.max = cobro.saldo_pendiente_dop;
      let nextCuotaMonto = cobro.saldo_pendiente_dop;
      if (cobro.plan_cuotas) {
        const pend = cobro.plan_cuotas.find(c => c.estado === 'Pendiente');
        if (pend) nextCuotaMonto = pend.monto;
      }
      montoInput.value = nextCuotaMonto;
    }
    if (notaInput) notaInput.value = 'Pago de cuota';

    const cuotasContainer = document.getElementById('abonoCuotasList');
    if (cuotasContainer) {
      let cuotasHtml = '';
      (cobro.plan_cuotas || []).forEach(c => {
        const pagada = c.estado === 'Cobrada' || c.estado === 'Saldada';
        cuotasHtml += `
          <div class="flex items-center justify-between text-xs p-2 rounded-xl ${pagada ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}">
            <span class="font-bold ${pagada ? 'text-emerald-800 line-through' : 'text-slate-800'}">Cuota #${c.numero} (${c.fecha_vencimiento})</span>
            <span class="font-bold font-mono ${pagada ? 'text-emerald-700' : 'text-amber-800'}">RD$ ${Number(c.monto).toLocaleString()} ${pagada ? '✓ Pagada' : ''}</span>
          </div>
        `;
      });
      cuotasContainer.innerHTML = cuotasHtml;
    }

    document.getElementById('modalAbono').classList.remove('hidden');
  }

  function sugerirMontoAbono(tipo) {
    const idCobro = document.getElementById('abonoIdCobro').value;
    const cobro = state.cobros.find(c => c.id_cobro === idCobro);
    if (!cobro) return;

    const montoInput = document.getElementById('abonoMontoInput');
    if (!montoInput) return;

    if (tipo === 'todo') {
      montoInput.value = cobro.saldo_pendiente_dop;
    } else if (tipo === 'cuota') {
      let nextCuotaMonto = cobro.saldo_pendiente_dop;
      if (cobro.plan_cuotas) {
        const pend = cobro.plan_cuotas.find(c => c.estado === 'Pendiente');
        if (pend) nextCuotaMonto = pend.monto;
      }
      montoInput.value = nextCuotaMonto;
    }
  }

  async function handleRegisterAbono(e) {
    if (e) e.preventDefault();
    const idCobro = document.getElementById('abonoIdCobro').value;
    const montoInput = document.getElementById('abonoMontoInput');
    const metodoInput = document.getElementById('abonoMetodoPago');
    const notaInput = document.getElementById('abonoNotaInput');
    const btnSubmit = document.getElementById('btnSubmitAbono');

    const monto = parseFloat(montoInput ? montoInput.value : 0) || 0;
    const metodo = metodoInput ? metodoInput.value : 'Efectivo';
    const nota = (notaInput && notaInput.value.trim()) || 'Abono a cuota';

    if (monto <= 0) {
      Sonner.warning('El monto del abono debe ser mayor a RD$ 0');
      return;
    }

    const cobro = state.cobros.find(c => c.id_cobro === idCobro);
    if (!cobro) {
      Sonner.error('No se encontró el registro de cobro');
      return;
    }

    if (monto > cobro.saldo_pendiente_dop) {
      Sonner.warning(`El monto (RD$ ${Number(monto).toLocaleString()}) no puede exceder el saldo restante (RD$ ${Number(cobro.saldo_pendiente_dop).toLocaleString()})`);
      return;
    }

    if (btnSubmit) btnSubmit.disabled = true;

    try {
      const res = await ThorAPI.registerPayment({
        id_cobro: idCobro,
        monto: monto,
        metodo_pago: metodo,
        nota: nota
      });

      if (res && res.status === 'success') {
        const nuevoCobrado = cobro.total_cobrado_dop + monto;
        const nuevoSaldo = Math.max(0, cobro.saldo_pendiente_dop - monto);
        cobro.total_cobrado_dop = nuevoCobrado;
        cobro.saldo_pendiente_dop = nuevoSaldo;
        cobro.estado = nuevoSaldo <= 0 ? 'Saldada' : 'Parcial';

        let restanteParaCuotas = monto;
        for (let c of (cobro.plan_cuotas || [])) {
          if (c.estado !== 'Cobrada' && restanteParaCuotas > 0) {
            const faltaPorCuota = c.monto - (c.monto_abonado || 0);
            if (restanteParaCuotas >= faltaPorCuota) {
              c.monto_abonado = c.monto;
              c.estado = 'Cobrada';
              c.fecha_pago = new Date().toISOString().substring(0, 10);
              restanteParaCuotas -= faltaPorCuota;
            } else {
              c.monto_abonado = (c.monto_abonado || 0) + restanteParaCuotas;
              restanteParaCuotas = 0;
            }
          }
        }

        const primerPendiente = (cobro.plan_cuotas || []).find(c => c.estado === 'Pendiente');
        cobro.proximo_vencimiento = primerPendiente ? primerPendiente.fecha_vencimiento : 'Saldada';

        if (!cobro.historial_abonos) cobro.historial_abonos = [];
        cobro.historial_abonos.push({
          id_abono: 'ABN-' + Date.now().toString().slice(-6),
          fecha: new Date().toLocaleString(),
          monto: monto,
          metodo_pago: metodo,
          nota: nota
        });

        const cached = ThorAPI.getCachedData();
        if (cached && cached.cobros) {
          const idx = cached.cobros.findIndex(x => x.id_cobro === idCobro);
          if (idx >= 0) cached.cobros[idx] = cobro;
          ThorAPI.setCachedData(cached);
        }

        closeAllModals();
        renderAll();

        if (nuevoSaldo <= 0) {
          Sonner.success(`¡Cuenta saldada por completo! ${cobro.cliente} ha completado el pago de RD$ ${Number(cobro.monto_total_dop).toLocaleString()}.`, 6000);
        } else {
          Sonner.success(`Abono de RD$ ${Number(monto).toLocaleString()} registrado con éxito. Resta: RD$ ${Number(nuevoSaldo).toLocaleString()}`, 4500);
        }

        sincronizarConNube(false);
      } else {
        Sonner.error(res.message || 'Error al procesar el abono');
      }
    } catch (err) {
      Sonner.error('Error al registrar abono: ' + err.message);
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  }

  function openWhatsAppReminder(idCobro) {
    const cobro = state.cobros.find(c => c.id_cobro === idCobro);
    if (!cobro) return;

    let telefono = (cobro.telefono || '').trim();
    if (!telefono) {
      telefono = prompt(`Ingresa el número de WhatsApp para ${cobro.cliente} (ej: 809-555-0123):`, '');
      if (!telefono) {
        Sonner.info('No se ingresó teléfono. Puedes agregarlo en cualquier momento.');
        return;
      }
      cobro.telefono = telefono.trim();
      const cached = ThorAPI.getCachedData();
      if (cached && cached.cobros) {
        const c = cached.cobros.find(x => x.id_cobro === idCobro);
        if (c) c.telefono = telefono.trim();
        ThorAPI.setCachedData(cached);
      }
      renderCobros();
    }

    let cleanPhone = telefono.replace(/\D/g, '');
    if (cleanPhone.length === 10) {
      cleanPhone = '1' + cleanPhone;
    }

    let proximoMonto = cobro.saldo_pendiente_dop;
    let proximaFecha = cobro.proximo_vencimiento || 'próximos días';
    if (cobro.plan_cuotas && cobro.plan_cuotas.length > 0) {
      const pend = cobro.plan_cuotas.find(c => c.estado === 'Pendiente');
      if (pend) {
        proximoMonto = pend.monto;
        proximaFecha = pend.fecha_vencimiento;
      }
    }

    const mensaje = `¡Hola ${cobro.cliente}! Te saluda Pamela de Thor Essence. Te escribo con un cordial saludo para recordarte la cuota pendiente de tu compra (${cobro.articulo}) por valor de RD$ ${Number(proximoMonto).toLocaleString()} acordada para el ${proximaFecha}. Saldo restante total: RD$ ${Number(cobro.saldo_pendiente_dop).toLocaleString()}. ¡Muchas gracias por tu preferencia y confianza!`;

    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, '_blank');
  }

  function openDetalleCobro(idCobro) {
    const cobro = state.cobros.find(c => c.id_cobro === idCobro);
    if (!cobro) return;

    const titleCliente = document.getElementById('detalleCobroCliente');
    const body = document.getElementById('detalleCobroBody');
    if (titleCliente) titleCliente.textContent = `${cobro.cliente} • ${cobro.articulo} (${cobro.telefono || 'Sin teléfono'})`;

    if (body) {
      const pct = cobro.monto_total_dop > 0 ? Math.round((cobro.total_cobrado_dop / cobro.monto_total_dop) * 100) : 0;
      let html = `
        <div class="grid grid-cols-3 gap-2 p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200 text-center">
          <div>
            <span class="text-[10px] text-slate-500 block">Total Fiado</span>
            <span class="font-bold text-sm text-slate-900 font-mono">RD$ ${Number(cobro.monto_total_dop).toLocaleString()}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-500 block">Abonado</span>
            <span class="font-bold text-sm text-emerald-600 font-mono">RD$ ${Number(cobro.total_cobrado_dop).toLocaleString()} (${pct}%)</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-500 block">Saldo Restante</span>
            <span class="font-bold text-sm text-amber-900 font-mono">RD$ ${Number(cobro.saldo_pendiente_dop).toLocaleString()}</span>
          </div>
        </div>

        <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
          <div class="bg-gradient-to-r from-amber-500 to-emerald-500 h-full rounded-full transition-all duration-500" style="width: ${Math.min(100, pct)}%"></div>
        </div>

        <div>
          <h4 class="font-bold text-xs text-slate-800 mb-2">Cronograma de Cuotas (${cobro.frecuencia === 'quincenal' ? 'Quincenal 15 y 30' : 'Mensual'})</h4>
          <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
      `;

      (cobro.plan_cuotas || []).forEach(c => {
        const pagada = c.estado === 'Cobrada' || c.estado === 'Saldada';
        html += `
          <div class="flex items-center justify-between p-2 rounded-xl text-xs ${pagada ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}">
            <div class="flex items-center gap-2">
              <span class="w-5 h-5 rounded-full ${pagada ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-slate-700'} flex items-center justify-center text-[10px] font-bold">
                ${pagada ? '✓' : c.numero}
              </span>
              <div>
                <span class="font-bold text-slate-800">Cuota #${c.numero}</span>
                <span class="text-[10px] text-slate-500 block">Vence: <strong>${c.fecha_vencimiento}</strong></span>
              </div>
            </div>
            <div class="text-right">
              <span class="font-bold font-mono ${pagada ? 'text-emerald-700' : 'text-slate-800'}">RD$ ${Number(c.monto).toLocaleString()}</span>
              <span class="block text-[10px] ${pagada ? 'text-emerald-600 font-semibold' : 'text-amber-700 font-semibold'}">${pagada ? 'Pagada (' + (c.fecha_pago || 'Abono') + ')' : 'Pendiente'}</span>
            </div>
          </div>
        `;
      });

      html += `
          </div>
        </div>

        <div>
          <h4 class="font-bold text-xs text-slate-800 mb-2">Historial de Abonos Recibidos</h4>
          <div class="space-y-1.5 max-h-40 overflow-y-auto pr-1">
      `;

      if (!cobro.historial_abonos || cobro.historial_abonos.length === 0) {
        html += `<p class="text-[11px] text-slate-400 py-2 text-center">No se han registrado abonos todavía.</p>`;
      } else {
        cobro.historial_abonos.forEach(ab => {
          html += `
            <div class="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 text-xs">
              <div>
                <span class="font-semibold text-slate-800">${ab.nota || 'Abono'}</span>
                <span class="text-[10px] text-slate-400 block">${ab.fecha} • ${ab.metodo_pago || 'Efectivo'}</span>
              </div>
              <span class="font-bold font-mono text-emerald-600">+RD$ ${Number(ab.monto).toLocaleString()}</span>
            </div>
          `;
        });
      }

      html += `
          </div>
        </div>
      `;

      body.innerHTML = html;
    }

    document.getElementById('modalDetalleCobro').classList.remove('hidden');
  }

  function setupEventListeners() {
    const searchInput = document.getElementById('inventorySearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim();
        renderInventory();
      });
    }

    const cobrosSearch = document.getElementById('cobrosSearchInput');
    if (cobrosSearch) {
      cobrosSearch.addEventListener('input', (e) => {
        handleCobrosSearch(e.target.value);
      });
    }

    const formProduct = document.getElementById('formProduct');
    if (formProduct) formProduct.addEventListener('submit', handleSaveProduct);

    const formSale = document.getElementById('formSale');
    if (formSale) formSale.addEventListener('submit', handleRegisterSale);

    const formAbono = document.getElementById('formAbono');
    if (formAbono) formAbono.addEventListener('submit', handleRegisterAbono);

    const formTank = document.getElementById('formTank');
    if (formTank) formTank.addEventListener('submit', handleSaveTank);

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', closeAllModals);
    });

    // Cerrar buzón flotante de alertas al hacer clic afuera
    document.addEventListener('click', (e) => {
      const flyout = document.getElementById('notificationFlyout');
      const btn = document.getElementById('btnNotifications');
      if (flyout && !flyout.classList.contains('hidden')) {
        if (!flyout.contains(e.target) && btn && !btn.contains(e.target)) {
          flyout.classList.add('hidden');
        }
      }
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

    const saleReceived = document.getElementById('saleReceivedInput');
    if (saleReceived) saleReceived.addEventListener('input', recalcularTotalVenta);
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
    toggleNotificationDrawer,
    switchTab,
    openNewProductModal,
    openEditProductModal,
    openSaleModal,
    openSaleModalFor: (id) => openSaleModal(id),
    openSaleModalCredit,
    setSaleMode,
    recalcularCuotasVenta,
    openTankModal,
    addTankDraftItem,
    removeTankDraftItem,
    updateTankDraftItem,
    quickAdjustStock,
    confirmDeleteProduct,
    confirmCancelSale,
    filterInventoryCategory: (cat) => { state.selectedCategory = cat; renderInventory(); },
    filterInventoryStock: (filter) => { 
      state.selectedStockFilter = filter; 
      const select = document.getElementById('inventoryStockSelect');
      if (select) select.value = filter;
      switchTab('inventario'); 
      renderInventory(); 
    },
    // Cobros & Cuentas por Cobrar
    renderCobros,
    filterCobrosStatus,
    handleCobrosSearch,
    openAbonoModal,
    sugerirMontoAbono,
    handleRegisterAbono,
    openWhatsAppReminder,
    openDetalleCobro,
    // Sincronización & Config
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
