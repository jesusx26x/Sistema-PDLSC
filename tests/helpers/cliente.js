// Navegador simulado: carga js/config.js + js/api.js reales conectados a backend/Codigo.gs (GAS simulado)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { webcrypto } = require('crypto');
const { crearBackend } = require('./gas');

const RAIZ = path.resolve(__dirname, '..', '..');
const RUTA_GS = path.join(RAIZ, 'backend', 'Codigo.gs');

function crearStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}

function crearCliente(backend) {
  const elemento = () => ({
    style: {}, classList: { add() {}, remove() {} }, appendChild() {}, remove() {},
    querySelector: () => ({}), set innerHTML(v) {}, get innerHTML() { return ''; }
  });
  const red = {
    modo: 'normal',          // 'normal' | 'perder-respuesta' | 'caida' | 'manual'
    posts: [],               // payloads recibidos por el servidor
    enVuelo: 0,
    maxEnVuelo: 0,
    pendientes: []           // en modo manual: funciones para liberar respuestas
  };

  const fetch = async (url, opts = {}) => {
    if (red.modo === 'caida') throw new TypeError('Failed to fetch');
    if ((opts.method || 'GET') === 'GET') {
      const params = Object.fromEntries(new URL(url).searchParams);
      const out = JSON.stringify(backend.get(params));
      return { ok: true, json: async () => JSON.parse(out) };
    }
    red.enVuelo++;
    red.maxEnVuelo = Math.max(red.maxEnVuelo, red.enVuelo);
    try {
      if (red.modo === 'manual') {
        await new Promise(res => red.pendientes.push(res));
      }
      const payload = JSON.parse(opts.body);
      // Solo se registran las mutaciones (las lecturas también viajan por POST desde la Fase 7)
      if (!['getAllData', 'getInventory', 'getSales', 'getReceptions', 'getCobros'].includes(payload.action)) red.posts.push(payload);
      red.lecturas = (red.lecturas || 0) + (red.posts.includes(payload) ? 0 : 1);
      const out = backend.postRaw(opts.body);
      if (red.modo === 'perder-respuesta') throw new TypeError('Failed to fetch');
      return { ok: true, json: async () => JSON.parse(out) };
    } finally {
      red.enVuelo--;
    }
  };

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: crearStorage(),
    sessionStorage: crearStorage(),
    navigator: { onLine: true },
    document: { getElementById: () => null, createElement: elemento, body: { appendChild() {} } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    dispatchEvent: () => true,
    addEventListener() {},
    crypto: webcrypto,
    fetch, URL, AbortController, setTimeout, clearTimeout, Promise, Date, JSON, Math
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js', 'config.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js', 'api.js'), 'utf8'), ctx);
  const api = vm.runInContext('ThorAPI', ctx);
  return { ctx, api, red };
}

function entorno() {
  const backend = crearBackend(RUTA_GS);
  const token = backend.login();
  backend.post({ action: 'saveProduct', token, data: { id: 'PROD-BASE', nombre: 'Perfume Base', cantidad: 10, precio_venta_dop: 1000, costo_dop: 400 } });
  const cliente = crearCliente(backend);
  cliente.ctx.sessionStorage.setItem('thor_session_token', token);
  return { backend, ...cliente };
}

async function sincronizar(env) {
  const r = await env.api.fetchAllData(true);
  assert.strictEqual(r.status, 'success');
  env.api.setCachedData(r.data);
  return r.data;
}

const stockServidor = (b, id) => Number(b.filas('Inventario').find(f => f[0] === id)[4]);
const outbox = env => JSON.parse(env.ctx.localStorage.getItem('thor_outbox_queue_v1') || '[]');


module.exports = { crearCliente, entorno, sincronizar, outbox, stockServidor, RAIZ, RUTA_GS };
