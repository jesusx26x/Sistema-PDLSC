// Ejecuta todas las pruebas (tests/*.test.js) en orden y termina con error si alguna falla.
// Uso: npm test   (no requiere dependencias: solo Node.js 18+)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const archivos = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let fallos = 0;
let total = 0;

for (const archivo of archivos) {
  const r = spawnSync(process.execPath, [path.join(__dirname, archivo)], { encoding: 'utf8' });
  const salida = (r.stdout || '') + (r.stderr || '');
  const superadas = (salida.match(/^✔ /gm) || []).length;
  total += superadas;
  if (r.status === 0) {
    console.log(`✅ ${archivo} — ${superadas} pruebas`);
  } else {
    fallos++;
    console.log(`❌ ${archivo} — falló tras ${superadas} pruebas\n${salida.split('\n').filter(l => !/^\s+at /.test(l)).join('\n')}`);
  }
}

console.log(`\n${total} pruebas superadas en ${archivos.length} archivos${fallos ? `, ${fallos} archivo(s) con fallos` : ''}`);
process.exit(fallos ? 1 : 0);
