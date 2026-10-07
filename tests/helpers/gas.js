// Simulador en memoria de los servicios de Google Apps Script que usa backend/Codigo.gs
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

class FakeRange {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const src = this.sheet.data[this.row - 1 + r] || [];
      const fila = [];
      for (let c = 0; c < this.nc; c++) {
        const v = src[this.col - 1 + c];
        fila.push(v === undefined ? '' : v);
      }
      out.push(fila);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  insertCheckboxes() {
    for (let r = 0; r < this.nr; r++) {
      const idx = this.row - 1 + r;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      this.sheet.data[idx][this.col - 1] = false;
    }
    return this;
  }
  setValues(vals) {
    vals.forEach((fila, r) => {
      const idx = this.row - 1 + r;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      fila.forEach((v, c) => { this.sheet.data[idx][this.col - 1 + c] = v; });
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  createTextFinder(text) {
    const range = this;
    return {
      matchEntireCell() { return this; },
      findNext() {
        const vals = range.getValues();
        for (let r = 0; r < vals.length; r++) {
          for (let c = 0; c < vals[r].length; c++) {
            if (String(vals[r][c]) === String(text)) {
              return { getRow: () => range.row + r, getColumn: () => range.col + c };
            }
          }
        }
        return null;
      }
    };
  }
}
['setBackground', 'setFontColor', 'setFontWeight', 'setFontSize', 'setHorizontalAlignment'].forEach(m => {
  FakeRange.prototype[m] = function () { return this; };
});

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.hidden = false; }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  getDataRange() {
    const rows = Math.max(this.data.length, 1);
    const cols = Math.max(1, ...this.data.map(f => f.length));
    return new FakeRange(this, 1, 1, rows, cols);
  }
  appendRow(fila) { this.data.push(fila.slice()); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  deleteRows(r, n) { this.data.splice(r - 1, n); }
  clearContents() { this.data = []; }
  clear() { this.data = []; }
  activate() {}
  setFrozenRows() {}
  hideSheet() { this.hidden = true; }
  protect() {
    const p = { descripcion: '', soloAdvertencia: false, sheet: this,
      setDescription(d) { this.descripcion = d; return this; },
      getDescription() { return this.descripcion; },
      setWarningOnly(v) { this.soloAdvertencia = v; return this; },
      remove: () => { this.protecciones = this.protecciones.filter(x => x !== p); } };
    this.protecciones = (this.protecciones || []).concat(p);
    return p;
  }
  getProtections() { return (this.protecciones || []).slice(); }
}

function crearBackend(rutaCodigo) {
  const SRC = fs.readFileSync(rutaCodigo, 'utf8');
  const props = {};
  const cache = {};
  const hojas = {};
  let lockCalls = 0;

  const pad = n => String(n).padStart(2, '0');
  const formatDate = (d, tz, fmt) => {
    d = new Date(d);
    return fmt
      .replace('yyyy', d.getFullYear())
      .replace('MM', pad(d.getMonth() + 1))
      .replace('dd', pad(d.getDate()))
      .replace('HH', pad(d.getHours()))
      .replace('mm', pad(d.getMinutes()))
      .replace('ss', pad(d.getSeconds()));
  };

  const spreadsheet = {
    getSheetByName: n => hojas[n] || null,
    insertSheet: n => (hojas[n] = new FakeSheet(n)),
    deleteSheet: sh => { delete hojas[sh.getName()]; },
    getId: () => 'fake'
  };

  const respaldos = [];
  const archivosRespaldo = [];
  const carpeta = {
    getFiles: () => {
      const lista = archivosRespaldo.slice();
      return { hasNext: () => lista.length > 0, next: () => lista.shift() };
    }
  };
  const crearArchivo = (nombre, fecha) => {
    const f = { nombre, fecha: fecha || new Date(), papelera: false,
      getName: () => nombre, getUrl: () => 'url', getDateCreated: () => f.fecha,
      isTrashed: () => f.papelera, setTrashed: v => { f.papelera = v; } };
    archivosRespaldo.push(f);
    return f;
  };
  const DriveApp = {
    getFileById: () => ({ makeCopy: (nombre) => { respaldos.push(nombre); return crearArchivo(nombre); } }),
    getFoldersByName: () => ({ hasNext: () => true, next: () => carpeta }),
    createFolder: () => carpeta
  };
  const correos = [];
  const triggers = [];
  const ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
    newTrigger: funcion => {
      const b = { timeBased: () => b, everyDays: () => b, atHour: h => { b.hora = h; return b; },
        create: () => { const t = { getHandlerFunction: () => funcion, hora: b.hora }; triggers.push(t); return t; } };
      return b;
    }
  };

  const ctx = {
    DriveApp,
    ScriptApp,
    MailApp: { sendEmail: (para, asunto, cuerpo) => correos.push({ para, asunto, cuerpo }) },
    console: { log() {}, warn() {}, error() {} },
    Date, JSON, Math, parseInt, parseFloat, String, Number, Object, Array, Map, isNaN,
    Session: { getScriptTimeZone: () => 'America/Santo_Domingo', getEffectiveUser: () => ({ getEmail: () => 'admin@ejemplo.com' }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        setProperties: o => { Object.keys(o).forEach(k => { props[k] = String(o[k]); }); },
        deleteProperty: k => { delete props[k]; },
        getProperties: () => Object.assign({}, props)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in cache ? cache[k] : null),
        put: (k, v) => { cache[k] = String(v); },
        remove: k => { delete cache[k]; },
        removeAll: ks => ks.forEach(k => delete cache[k])
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate
    },
    LockService: { getScriptLock: () => ({ tryLock: () => { lockCalls++; return true; }, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ setMimeType() { return { body: s, getContent: () => s }; } })
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, getUi: () => { throw new Error('sin UI'); }, ProtectionType: { SHEET: 'SHEET' } }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.inicializarHojasSiNoExisten(true);

  const backend = {
    ctx, props, cache, hojas, respaldos, archivosRespaldo, crearArchivo, correos, triggers,
    lockCalls: () => lockCalls,
    post: payload => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(payload) } }).body),
    postRaw: body => ctx.doPost({ postData: { contents: body } }).body,
    get: params => JSON.parse(ctx.doGet({ parameter: params }).body),
    filas: nombre => (hojas[nombre] ? hojas[nombre].data.slice(1).filter(f => f[0]) : []),
    login() {
      ctx.establecerCredenciales('ana', 'contrasenaSegura1');
      return backend.post({ action: 'login', username: 'ana', password: 'contrasenaSegura1' }).token;
    }
  };
  return backend;
}

module.exports = { crearBackend };
