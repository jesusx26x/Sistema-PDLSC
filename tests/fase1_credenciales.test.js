// Arnés de pruebas Fase 1: simula servicios de Google Apps Script y carga backend/Codigo.gs
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const path = require('path');
const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'backend', 'Codigo.gs'), 'utf8');

function crearEntorno() {
  const props = {};
  const cache = {};
  let lockCalls = 0;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Date, JSON, Math, parseInt, parseFloat, String, Number, Object, Array, Map, isNaN,
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
      getUuid: () => crypto.randomUUID()
    },
    LockService: { getScriptLock: () => ({ tryLock: () => { lockCalls++; return true; }, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ setMimeType() { return { body: s }; } })
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => { throw new Error('sin hoja en pruebas'); } }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, props, cache, lockCalls: () => lockCalls };
}

const post = (env, payload) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify(payload) } }).body);
const get = (env, params) => JSON.parse(env.ctx.doGet({ parameter: params }).body);

let ok = 0;
function test(nombre, fn) {
  fn();
  ok++;
  console.log('✔ ' + nombre);
}

test('Sin credenciales configuradas el login devuelve AUTH_NOT_CONFIGURED', () => {
  const env = crearEntorno();
  const r = post(env, { action: 'login', username: 'x', password: 'y' });
  assert.strictEqual(r.code, 'AUTH_NOT_CONFIGURED');
});

test('Credenciales heredadas en texto plano: login ok y migración a hash', () => {
  const env = crearEntorno();
  env.props.AUTH_USER = 'usuarioPrueba';
  env.props.AUTH_PASS = 'claveHeredada123';
  const r = post(env, { action: 'login', username: ' usuarioPrueba ', password: 'claveHeredada123' });
  assert.strictEqual(r.status, 'success');
  assert.ok(r.token);
  assert.ok(!('AUTH_PASS' in env.props), 'AUTH_PASS debe eliminarse');
  assert.ok(env.props.AUTH_PASS_HASH && env.props.AUTH_SALT);
  assert.ok(!env.props.AUTH_PASS_HASH.includes('claveHeredada123'));
  // segundo login ya contra el hash
  const r2 = post(env, { action: 'login', username: 'usuarioPrueba', password: 'claveHeredada123' });
  assert.strictEqual(r2.status, 'success');
  const r3 = post(env, { action: 'login', username: 'usuarioPrueba', password: 'otra' });
  assert.strictEqual(r3.code, 'INVALID_CREDENTIALS');
});

test('Login y logout no adquieren el lock global', () => {
  const env = crearEntorno();
  env.ctx.establecerCredenciales('ana', 'contrasenaSegura1');
  const r = post(env, { action: 'login', username: 'ana', password: 'contrasenaSegura1' });
  post(env, { action: 'logout', token: r.token });
  post(env, { action: 'saveProduct', token: 'falso' });
  assert.strictEqual(env.lockCalls(), 0);
});

test('Bloqueo tras 5 intentos fallidos, incluso con la contraseña correcta', () => {
  const env = crearEntorno();
  env.ctx.establecerCredenciales('ana', 'contrasenaSegura1');
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(post(env, { action: 'login', username: 'ana', password: 'mala' + i }).code, 'INVALID_CREDENTIALS');
  }
  assert.strictEqual(post(env, { action: 'login', username: 'ANA', password: 'contrasenaSegura1' }).code, 'TOO_MANY_ATTEMPTS');
  // al expirar el bloqueo (simulado limpiando caché) vuelve a funcionar y el contador se reinicia
  Object.keys(env.cache).filter(k => k.startsWith('LOGIN_FAIL_')).forEach(k => delete env.cache[k]);
  assert.strictEqual(post(env, { action: 'login', username: 'ana', password: 'contrasenaSegura1' }).status, 'success');
});

test('Login exitoso reinicia el contador de fallos', () => {
  const env = crearEntorno();
  env.ctx.establecerCredenciales('ana', 'contrasenaSegura1');
  for (let i = 0; i < 4; i++) post(env, { action: 'login', username: 'ana', password: 'mala' });
  assert.strictEqual(post(env, { action: 'login', username: 'ana', password: 'contrasenaSegura1' }).status, 'success');
  for (let i = 0; i < 4; i++) post(env, { action: 'login', username: 'ana', password: 'mala' });
  assert.strictEqual(post(env, { action: 'login', username: 'ana', password: 'contrasenaSegura1' }).status, 'success');
});

test('Validación de longitud mínima de contraseña', () => {
  const env = crearEntorno();
  assert.strictEqual(env.ctx.establecerCredenciales('ana', 'corta').status, 'error');
  assert.strictEqual(env.ctx.establecerCredenciales('', 'contrasenaSegura1').status, 'error');
  assert.ok(!env.props.AUTH_USER);
});

test('Rotar credenciales revoca tokens previos (también los que solo están en caché)', () => {
  const env = crearEntorno();
  env.ctx.establecerCredenciales('ana', 'contrasenaSegura1');
  const t1 = post(env, { action: 'login', username: 'ana', password: 'contrasenaSegura1' }).token;
  assert.strictEqual(env.ctx.validarSesionRLS(t1), true);
  // token que solo vive en caché (p. ej. si falló la escritura en Properties)
  const soloCache = 'THOR_SES_solo_cache';
  env.cache[soloCache] = JSON.stringify({ username: 'ana', creadoEn: Date.now(), expiraEn: Date.now() + 1e9 });
  assert.strictEqual(env.ctx.validarSesionRLS(soloCache), true);

  const espera = Date.now() + 2; while (Date.now() < espera) {}
  env.ctx.establecerCredenciales('ana', 'contrasenaNueva99');
  assert.strictEqual(env.ctx.validarSesionRLS(t1), false);
  assert.strictEqual(env.ctx.validarSesionRLS(soloCache), false);
  assert.strictEqual(post(env, { action: 'login', username: 'ana', password: 'contrasenaSegura1' }).code, 'INVALID_CREDENTIALS');
  const t2 = post(env, { action: 'login', username: 'ana', password: 'contrasenaNueva99' }).token;
  assert.strictEqual(env.ctx.validarSesionRLS(t2), true);
  assert.strictEqual(get(env, { action: 'getSales', token: t1 }).code, 'UNAUTHORIZED_RLS');
});

test('Sesiones existentes en producción siguen válidas tras desplegar (sin rotación)', () => {
  const env = crearEntorno();
  env.props.AUTH_USER = 'u';
  env.props.AUTH_PASS = 'legado12345';
  const viejo = 'THOR_SES_viejo';
  env.props['SESSION_' + viejo] = JSON.stringify({ username: 'u', creadoEn: Date.now() - 5 * 864e5, expiraEn: Date.now() + 864e5 });
  assert.strictEqual(env.ctx.validarSesionRLS(viejo), true);
});

test('Logout invalida el token', () => {
  const env = crearEntorno();
  env.ctx.establecerCredenciales('ana', 'contrasenaSegura1');
  const t = post(env, { action: 'login', username: 'ana', password: 'contrasenaSegura1' }).token;
  post(env, { action: 'logout', token: t });
  assert.strictEqual(env.ctx.validarSesionRLS(t), false);
});

test('MASTER_SERVICE_KEY ya no concede acceso', () => {
  const env = crearEntorno();
  env.props.MASTER_SERVICE_KEY = 'llave-maestra';
  assert.strictEqual(env.ctx.validarSesionRLS('llave-maestra'), false);
});

test('Purga de sesiones expiradas/revocadas y tope de sesiones activas', () => {
  const env = crearEntorno();
  env.ctx.establecerCredenciales('ana', 'contrasenaSegura1');
  const desde = parseInt(env.props.AUTH_SESIONES_DESDE);
  env.props.SESSION_expirada = JSON.stringify({ creadoEn: Date.now(), expiraEn: Date.now() - 1 });
  env.props.SESSION_revocada = JSON.stringify({ creadoEn: desde - 10, expiraEn: Date.now() + 1e9 });
  env.props.SESSION_corrupta = '{no-json';
  for (let i = 0; i < 30; i++) {
    env.props['SESSION_v' + i] = JSON.stringify({ creadoEn: desde + i, expiraEn: Date.now() + 1e9 });
  }
  const t = post(env, { action: 'login', username: 'ana', password: 'contrasenaSegura1' }).token;
  const sesiones = Object.keys(env.props).filter(k => k.startsWith('SESSION_'));
  assert.strictEqual(sesiones.length, 20);
  assert.ok(!('SESSION_expirada' in env.props) && !('SESSION_revocada' in env.props) && !('SESSION_corrupta' in env.props));
  assert.ok('SESSION_v29' in env.props && !('SESSION_v0' in env.props), 'conserva las más recientes');
  assert.ok(('SESSION_' + t) in env.props);
});

test('saveConfig no puede escribir credenciales ni sesiones', () => {
  const env = crearEntorno();
  env.ctx.establecerCredenciales('ana', 'contrasenaSegura1');
  const filas = [['Clave', 'Valor']];
  env.ctx.getSheet = () => ({
    getDataRange: () => ({ getValues: () => filas }),
    getRange: () => ({ setValue() {} }),
    appendRow: r => filas.push(r)
  });
  env.ctx.inicializarHojasSiNoExisten = () => {};
  env.ctx.hojaMovimientos = () => {};
  const t = post(env, { action: 'login', username: 'ana', password: 'contrasenaSegura1' }).token;
  const hashAntes = env.props.AUTH_PASS_HASH;
  const r = post(env, { action: 'saveConfig', token: t, data: { AUTH_USER: 'atacante', AUTH_PASS_HASH: 'x', AUTH_SESIONES_DESDE: '0', MASTER_SERVICE_KEY: 'k', SESSION_x: '{}', TASA_CAMBIO_USD_DOP: 61 } });
  assert.strictEqual(r.status, 'success');
  assert.strictEqual(env.props.AUTH_USER, 'ana');
  assert.strictEqual(env.props.AUTH_PASS_HASH, hashAntes);
  assert.ok(!('MASTER_SERVICE_KEY' in env.props) && !('SESSION_x' in env.props));
  assert.strictEqual(JSON.stringify(filas.slice(1)), JSON.stringify([['TASA_CAMBIO_USD_DOP', 61]]));
});

test('Errores 500 no exponen stack', () => {
  const env = crearEntorno();
  env.ctx.establecerCredenciales('ana', 'contrasenaSegura1');
  const t = post(env, { action: 'login', username: 'ana', password: 'contrasenaSegura1' }).token;
  const r = post(env, { action: 'saveProduct', token: t, data: { nombre: 'X' } });
  assert.strictEqual(r.status, 'error');
  assert.ok(!('stack' in r));
});

test('Ninguna credencial escrita en el código', () => {
  assert.ok(!/Thorayka|Pameladlsantos|CREDENCIALES_SISTEMA/.test(SRC));
});

console.log(`\n${ok} pruebas superadas`);
