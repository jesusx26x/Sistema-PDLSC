// Comprobaciones estáticas: referencias de la interfaz, archivos del modo sin conexión y sintaxis
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..');
const leer = rel => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let ok = 0;
function test(nombre, fn) { fn(); ok++; console.log('✔ ' + nombre); }

function exportados(codigo) {
  const bloque = codigo.slice(codigo.lastIndexOf('\n  return {'));
  return new Set((bloque.match(/^\s{4}([A-Za-z_]+)\s*(?:[:,]|$)/gm) || []).map(l => l.trim().replace(/[:,].*$/, '')));
}

test('Toda función ThorApp.* usada en index.html y app.js existe', () => {
  const usados = new Set([...(leer('index.html') + leer('js/app.js')).matchAll(/ThorApp\.([A-Za-z_]+)/g)].map(m => m[1]));
  const exp = exportados(leer('js/app.js'));
  const faltan = [...usados].filter(n => !exp.has(n));
  assert.deepStrictEqual(faltan, [], 'No existen: ' + faltan.join(', '));
});

test('Toda función ThorAPI.* usada en index.html y app.js existe', () => {
  const usados = new Set([...(leer('index.html') + leer('js/app.js')).matchAll(/ThorAPI\.([A-Za-z_]+)/g)].map(m => m[1]));
  const exp = exportados(leer('js/api.js'));
  const faltan = [...usados].filter(n => !exp.has(n));
  assert.deepStrictEqual(faltan, [], 'No existen: ' + faltan.join(', '));
});

test('Los archivos que el service worker guarda para el modo sin conexión existen', () => {
  const sw = leer('sw.js');
  const lista = sw.slice(sw.indexOf('APP_SHELL = ['), sw.indexOf('];', sw.indexOf('APP_SHELL = [')));
  const archivos = [...lista.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]).filter(Boolean);
  assert.ok(archivos.length >= 8);
  archivos.forEach(a => assert.ok(fs.existsSync(path.join(RAIZ, a)), 'Falta ' + a));
});

test('index.html no carga Tailwind ni Chart.js desde un CDN', () => {
  const html = leer('index.html');
  assert.ok(!/cdn\.tailwindcss\.com/.test(html));
  assert.ok(!/cdn\.jsdelivr\.net\/npm\/chart\.js/.test(html));
});

test('Sintaxis válida en api.js, app.js, config.js, sw.js y Codigo.gs', () => {
  ['js/api.js', 'js/app.js', 'js/config.js', 'sw.js', 'backend/Codigo.gs'].forEach(rel => {
    new vm.Script(leer(rel), { filename: rel });
  });
});

test('Ninguna credencial escrita en el código ni en la documentación', () => {
  ['backend/Codigo.gs', 'js/config.js', 'js/api.js', 'js/app.js', 'README.md', 'TASKME.md', 'backend/INSTRUCCIONES_CONFIGURACION.md']
    .forEach(rel => assert.ok(!/Thorayka|THOR_SECURE_2026/.test(leer(rel)), rel));
});

test('La versión del backend coincide con la que exige el frontend', () => {
  const vb = parseInt((leer('backend/Codigo.gs').match(/const VERSION_BACKEND = (\d+);/) || [])[1]);
  const req = parseInt((leer('js/api.js').match(/const VERSION_BACKEND_REQUERIDA = (\d+);/) || [])[1]);
  assert.ok(vb >= req, `Backend ${vb} < requerida ${req}`);
});

console.log(`\n${ok} pruebas superadas`);
