# 🔍 Auditoría Integral — Thor Essence (segunda revisión)

**Fecha:** 7 de octubre de 2026
**Versión auditada:** `main` @ `545da4a` (Fases 1–7 del plan de corrección desplegadas)
**Objetivo:** que Pamela no vuelva a tener problemas de sincronización, inventario ni duplicados.

---

## 1. Resumen ejecutivo

Las 7 fases corrigieron los fallos que causaban las quejas originales: ventas duplicadas, productos que reaparecían, stock inflado, mermas revertidas y operaciones perdidas al vencer la sesión. Hay **71 pruebas automatizadas en verde** y verificación en navegador, también sin conexión.

En esta revisión aparecieron **5 riesgos que todavía pueden generar una queja**. Los 4 primeros los confirmé con pruebas que reproducen el caso:

| # | Riesgo | Qué vería Pamela | Probabilidad |
|---|---|---|---|
| **H1** | Venta sin conexión de un producto recibido en un tanque, cuando otro equipo ya lo había creado en la nube | "Se me perdió una venta" (la rechaza: *"El producto vendido no existe"*) | Media: requiere 2 equipos y trabajo sin señal |
| **H2** | Dos equipos sin conexión crean el mismo producto, o se escribe un nombre con otro espaciado | "Tengo productos duplicados" | Media |
| **H3** | El almacenamiento del navegador se llena hacia las **~2.300 ventas** | "El inventario no se actualiza" y un aviso de error en cada sincronización | **Alta a mediano plazo**: inevitable con el uso |
| **H4** | La cola de recuperación no tiene botón para reintentar | Operaciones que nunca suben | Baja, pero con pérdida definitiva |
| **H5** | Los avisos de operación rechazada duran 9 segundos | No se entera de que algo no se guardó | Media |

**Recomendación:** ejecutar primero la **Fase 8 (H1–H5)**. Cierra los últimos caminos hacia una queja de sincronización o duplicados. Después, la **Fase 9 (monitoreo)**, para detectar cualquier problema antes que Pamela.

---

## 2. Metodología

- Revisión completa de `backend/Codigo.gs` (2.497 líneas), `js/api.js`, `js/app.js`, `sw.js`, `index.html` y `404.html`.
- Verificación mecánica:
  - todas las funciones que llama la interfaz existen;
  - ninguna inserción de texto del usuario en el HTML queda sin escapar;
  - no queda ningún camino que cambie el stock sin registrar un movimiento.
- **Escenarios reproducidos** con el `api.js` real conectado al `Codigo.gs` real, sobre un Google Sheets simulado, con varios dispositivos, sin conexión, respuestas perdidas y sesiones vencidas.
- Ejecución de las 71 pruebas de regresión de las Fases 1–7: todas pasan.
- **Limitación:** no tengo acceso a la hoja real de Pamela. Los volúmenes (H3) se estimaron con datos simulados.

---

## 3. Lo que ya está sólido (no requiere acción)

| Área | Estado | Evidencia |
|---|---|---|
| Duplicación por reintentos | ✅ Cada operación lleva `op_id`; el servidor no la aplica dos veces | Pruebas Fase 2: respuesta perdida, envíos simultáneos |
| IDs locales = IDs de la nube | ✅ Venta, cobro, abono, tanque y producto | Prueba de integración "IDs locales = IDs del servidor" |
| Productos que reaparecían / stock inflado | ✅ Sin conciliación automática; kardex en `Movimientos`; diagnóstico con corrección manual | Pruebas Fase 3 y limpieza real de 62 unidades |
| Productos eliminados | ✅ Ninguna operación los revive | Prueba "un producto eliminado no revive" |
| Rechazos del servidor | ✅ Se descartan, se revierten y se avisan | Pruebas Fase 4 |
| Sesión vencida | ✅ La cola se conserva sin gastar reintentos | Prueba Fase 4 |
| Edición desde un equipo desactualizado | ✅ No pisa el stock (la cantidad cambia solo por ajustes) | Prueba Fase 5 |
| Centavos en fiados | ✅ Saldan exacto | Prueba Fase 5 |
| Credenciales | ✅ Fuera del código, con hash y bloqueo por intentos | Pruebas Fase 1 |
| Funcionamiento sin conexión | ✅ App completa con estilos y gráficas | Verificado con el servidor apagado |
| Texto con HTML (XSS) | ✅ Escapado en todas las plantillas | Barrido de todas las interpolaciones |
| Kardex | ✅ Todo cambio de stock registra un movimiento | Revisión de cada escritura en la columna de cantidad |

---

## 4. Hallazgos

Severidad: 🔴 Alta (puede causar queja o pérdida de datos) · 🟠 Media · 🟡 Baja · 💡 Mejora.
Esfuerzo: **S** (horas) · **M** (1 día) · **L** (varios días).

### 4.1 Sincronización, inventario y duplicados

#### H1 🔴 Venta rechazada de un producto recibido sin conexión que ya existía en la nube — *M*
**Escenario reproducido:**
1. La tableta crea "Crema Coco".
2. El teléfono, que no la tiene descargada, recibe un tanque sin conexión con "Crema Coco" y le asigna un ID nuevo (`PROD-…C2087A5A`).
3. El teléfono vende 1 unidad.
4. Al reconectar, el servidor suma el tanque al producto existente por nombre, pero la venta llega con el ID que el servidor nunca creó.

**Resultado medido:** la venta se rechaza (*"El producto vendido no existe en el inventario"*) y no queda en la nube.

**Acción:** tabla de **alias de IDs** (hoja oculta `Alias`).
- Cuando el servidor une un artículo con un producto existente por nombre, registra `ID_cliente → ID_real`.
- Todas las operaciones (venta, ajuste, edición, anulación) resuelven el ID por esa tabla.
- `getAllData` devuelve los alias para que el dispositivo reasigne sus referencias locales.

#### H2 🔴 Productos duplicados al crearlos desde el formulario — *M (comparte la infraestructura de H1)*
**Escenarios reproducidos:**
- Dos equipos sin conexión crean "Splash Mango" y "Splash  mango". Resultado: **2 productos activos**.
- El servidor acepta crear "perfume   base" aunque ya existe "Perfume Base".

**Causas:**
- El servidor no impide nombres repetidos al crear productos (los tanques sí los unen).
- El formulario compara con `trim().toLowerCase()` y no colapsa espacios internos ni ignora acentos.

**Acción:**
- En el servidor, al crear un producto con un nombre normalizado que ya existe y está activo: **unirlo**. Sumar la cantidad como movimiento, registrar el alias (H1) y devolver el ID real.
- En el formulario, usar la misma normalización que el servidor (espacios, mayúsculas, acentos) para detectar "producto existente".

#### H3 🔴 El almacenamiento del navegador se llena (≈ 2.300 ventas) — *M*
**Medición:**
- Cada venta ocupa ~1.100 caracteres entre la foto del servidor y la caché local, porque ambas guardan el historial completo.
- El límite habitual del navegador (~5 MB) se alcanza con unas **2.300 ventas**. Con 10–20 ventas al día, eso son **4 a 8 meses**.

**Qué pasa al llegar al límite:**
- La foto del servidor deja de actualizarse.
- La pantalla se reconstruye sobre una foto vieja: **inventario y ventas desactualizados**.
- Aparece un aviso de "límite de almacenamiento" en cada sincronización (cada 90 s).

**Agravante:** todas las páginas de `jesusx26x.github.io` comparten origen. Comparten la misma cuota y pueden leer los datos y el token de Pamela.

**Acción (en este orden):**
1. Que el servidor envíe solo las **ventas de los últimos 120 días** y los **fiados abiertos**. Los reportes históricos se calcularían en el servidor.
2. Guardar solo la foto del servidor; la vista se reconstruye en memoria. Eso reduce el uso a la mitad.
3. Si falla guardar la foto, **no** reconstruir desde una foto vieja: avisar y forzar una descarga limpia.
4. A mediano plazo: IndexedDB, que tiene una cuota mucho mayor, y/o dominio propio para no compartir origen.

**Dato a confirmar:** número de filas actuales en la hoja `Ventas`, para saber cuánto margen queda.

#### H4 🔴 La cola de recuperación no tiene salida — *S*
- `reintentarColaRecuperacion()` existe pero **ningún botón la invoca**.
- El diagnóstico le dice a Pamela *"Usa Reintentar Recuperación"*, un botón que no existe.
- Una operación que llegue ahí (5 errores internos seguidos del servidor) **nunca sube**.

**Acción:** contador visible de "operaciones por revisar" y un botón **Reintentar**. Además, reintento automático una vez al día o tras actualizar la app.

#### H5 🟠 Los rechazos solo se ven 9 segundos — *S–M*
- Si una venta hecha sin conexión se rechaza al reconectar (por ejemplo, otro equipo vendió el último), el aviso dura 9 s.
- Si la app estaba en segundo plano, Pamela no lo ve: la venta simplemente "desaparece".

**Acción:** **Historial de sincronización** persistente, con lo rechazado, el motivo, la fecha y el botón "Rehacer". Insignia en el menú hasta que se revise.

#### H6 🟠 Cobro doble de un fiado sin conexión — *S*
- **Escenario reproducido:** dos equipos registran cada uno un abono de RD$ 700 a un fiado de RD$ 1.000.
- **Resultado:** la nube registra RD$ 1.000 y los RD$ 400 sobrantes **no quedan registrados**. El segundo equipo recibe "¡Cuenta saldada!" como éxito.

**Acción:** el servidor devuelve `excedente`, lo anota en el historial del fiado ("Excedente RD$ 400: devolver o dejar a favor") y la app lo avisa.

#### H7 🟠 Anular un fiado con abonos no avisa del dinero cobrado — *S*
- Al anular una venta a crédito, la cuenta pasa a "Cancelada" con saldo 0.
- Los abonos ya cobrados no quedan señalados como dinero a devolver.

**Acción:** la confirmación muestra "Este fiado tiene RD$ X abonados" y se registra en el historial del fiado.

#### H8 🟡 La pantalla puede quedar desactualizada tras cerrar un formulario — *S*
- Si la sincronización llega con un formulario abierto, el redibujado se pospone, pero `closeAllModals()` no lo retoma.
- Si el cursor queda en el buscador, tampoco se redibuja.
- La pantalla queda vieja hasta la siguiente sincronización (≤ 90 s).

**Acción:** marcar el redibujado pendiente y ejecutarlo al cerrar el formulario o salir del campo.

### 4.2 Detección temprana y operación

#### H9 🟠 Sin pruebas en el repositorio ni verificación automática — *S*
Las 71 pruebas viven en una carpeta temporal. Un cambio futuro podría reintroducir un fallo sin que nadie lo note.

**Acción:**
- Agregar `tests/` (simulador de Apps Script incluido) con `npm test`.
- GitHub Actions que las ejecute en cada push y bloquee si fallan.

#### H10 🟠 Sin registro de errores: los problemas se conocen cuando Pamela se queja — *M*
**Acción:**
- La app envía a una hoja `Registro de Errores`, con límite de envíos:
  - operaciones rechazadas;
  - operaciones en la cola de recuperación;
  - errores de JavaScript.
- Disparador diario que envía un **correo de resumen** al administrador.

#### H11 🟠 Sin verificación automática del inventario — *S (junto con H10)*
El diagnóstico y el cuadre del kardex solo se ejecutan a mano.

**Acción:** disparador nocturno que ejecuta `diagnosticarInventario(false)` y avisa por correo si hay duplicados, excesos o diferencias de kardex.

#### H12 🟠 Backend y frontend sin control de versión — *S*
El backend se actualiza pegando el código a mano. Si se publica el frontend sin actualizar el backend, nadie se entera.

**Acción:**
- Constante `VERSION_BACKEND` devuelta en `ping` y `getAllData`; la app avisa si el backend es más antiguo de lo esperado.
- Opcional: `clasp` para publicar el backend desde el repositorio.

#### H13 🟠 La sesión vence a los 30 días sí o sí — *S*
Pamela tendrá que volver a escribir la contraseña cada mes, lo que se traduce en bloqueos y llamadas.

**Acción:** renovación deslizante. Si quedan menos de 7 días y se usa la app, se extiende otros 30.

#### H14 🟠 Las hojas se pueden editar a mano — *S*
Una edición directa en `Inventario` descuadra el kardex. El diagnóstico lo detecta, pero después del hecho.

**Acción:** proteger `Inventario`, `Ventas`, `Cobros`, `Movimientos` y `Operaciones` (solo el propietario, o con advertencia al editar).

#### H15 🟡 Respaldos sin rotación — *S*
Se crea una copia diaria en Drive que nunca se borra (365 copias al año).

**Acción:** conservar las últimas 30 y verificar que el disparador de las 2:00 AM esté activo.

#### H16 🟡 `Operaciones` crece sin límite — *S*
Cada operación añade una fila y la búsqueda de duplicados recorre toda la columna.

**Acción:** depurar filas de más de 180 días en el disparador nocturno.

### 4.3 Calidad y seguridad menores

| # | Sev. | Hallazgo | Acción | Esf. |
|---|---|---|---|---|
| H17 | 🟡 | El buscador del inventario llama a `ThorApp.handleSearch`, que no existe: un error en consola por cada tecla (la búsqueda funciona por otro listener) | Quitar el `oninput` del HTML | S |
| H18 | 🟡 | `doGet` sigue aceptando el token en la URL (compatibilidad con versiones viejas) | Retirarlo cuando todos los dispositivos tengan la versión 6+ | S |
| H19 | 🟡 | Venta a crédito con abono ≥ total: la venta queda "Pendiente de Cobro" con la cuenta saldada (la app lo impide, el servidor no) | Validarlo en el servidor | S |
| H20 | 🟡 | El bloqueo de 15 min por usuario permite que alguien impida el acceso de Pamela con intentos falsos | Bloqueo progresivo y aviso al administrador | S |
| H21 | 🟡 | `user-scalable=no` impide hacer zoom (accesibilidad) | Permitir zoom | S |
| H22 | 🟡 | `404.html` tiene fija la ruta `/Sistema-PDLSC/` | Documentarlo (si se renombra el repositorio, actualizarla) | S |
| H23 | 🟡 | Manual PDF con la contraseña antigua (ya no sirve) y la contraseña en el historial de git | Regenerar el manual | S |

### 4.4 Mejoras y optimizaciones

| # | Mejora | Beneficio | Esf. |
|---|---|---|---|
| M1 | **Venta con varios productos (carrito)** | Menos pasos y menos errores al cobrar varios artículos | L |
| M2 | Reportes "vendido" vs "cobrado" (los fiados hoy cuentan como ingreso al venderse) | Caja real del día | M |
| M3 | Sincronización incremental (solo cambios desde la última descarga) | Menos datos móviles y menos espera; complementa H3 | L |
| M4 | La tasa USD→DOP se guarda por dispositivo y no se sincroniza con `Configuracion` | Costos coherentes entre equipos | S |
| M5 | Advertir al eliminar un producto con stock > 0 | Evita perder existencias por error | S |
| M6 | Prorrateo del flete (ya implementado, desactivado) | Ganancia real | — (decisión de negocio) |

---

## 5. Plan de acción propuesto

| Fase | Contenido | Prioridad | Esfuerzo estimado | Requiere actualizar Apps Script |
|---|---|---|---|---|
| **8 — Cero pérdidas y cero duplicados** | H1, H2 (alias + unión por nombre), H3 (ventas recientes + solo foto + protección ante cuota llena), H4, H5, H8 | 🔴 Inmediata | 2–3 días | Sí |
| **9 — Detección temprana** | H9 (tests + CI), H10 (registro de errores + correo diario), H11 (diagnóstico nocturno), H12 (versión), H13 (sesión deslizante), H14, H15, H16 | 🟠 Alta | 2 días | Sí |
| **10 — Dinero exacto** | H6, H7, H19, M2 | 🟠 Media | 1 día | Sí |
| **11 — Pulido** | H17, H18, H20, H21, H22, M4, M5 | 🟡 Baja | 0,5 día | Sí |
| **12 — Evolución** | M1 (carrito), M3 (incremental), IndexedDB/dominio propio | 💡 | A definir | Sí |

**Acciones fuera del código:**
1. Confirmar cuántas filas tiene hoy la hoja `Ventas` (para dimensionar H3).
2. Verificar en Apps Script › Activadores que exista `crearRespaldoEnDrive` diario.
3. Regenerar el manual PDF sin credenciales.
4. Confirmar quién más tiene acceso de edición a la hoja de cálculo (para H14).

---

## 6. Seguimiento

### Fase 8 — ✅ desplegada

| Hallazgo | Resultado | Verificación |
|---|---|---|
| H1 | Hoja oculta `Alias`: el servidor registra "ID del dispositivo → ID real" al unir por nombre y todas las operaciones resuelven el ID. El dispositivo reasigna sus operaciones pendientes. | Escenario A: venta guardada (antes rechazada) |
| H2 | El servidor no crea productos con un nombre ya existente (espacios, mayúsculas y acentos normalizados): suma las unidades al existente. Formulario y tanque usan la misma normalización. | Escenarios B y C: 1 solo producto (antes 2) |
| H3 | Detalle de ventas de los últimos 180 días + fiados abiertos; resumen exacto de lo anterior para reportes. Solo se guarda la foto del servidor (la vista vive en memoria). Si el almacenamiento se llena, no se vuelve a una foto vieja y se avisa. Las operaciones confirmadas se aplican a la foto (al reabrir sin conexión se ve lo último). | ~4.650 ventas en 180 días antes de llenarse (antes ~2.300 en total). Con el volumen actual (84 ventas) no se alcanza. |
| H4 | Panel **⚠️ Por revisar** con botón "Reintentar ahora" y reintento automático diario, conservando el `op_id`. | Prueba: reintento sin duplicar |
| H5 | Historial persistente de lo no guardado: qué era, motivo y fecha, hasta marcarlo como revisado. | Prueba y verificación en navegador |
| H8 | Redibujado pendiente al cerrar el formulario o salir del campo. | Verificación en navegador |
| H17 | Quitado el `oninput` inexistente del buscador. | — |

**Pruebas:** 84 automatizadas en verde (13 nuevas de la Fase 8) + verificación en navegador (escritorio y teléfono).

### Fase 9 — ✅ desplegada (monitoreo diario y protección de hojas activos)

| Hallazgo | Resultado |
|---|---|
| H9 | 102 pruebas en `tests/` (`npm test`) + GitHub Actions en cada push; prueba estática que detecta funciones inexistentes (como H17) y CSS desactualizado. |
| H10 | La app reporta rechazos, operaciones en recuperación, errores de JavaScript, almacenamiento lleno y backend desactualizado a la hoja `Registro de Errores`. |
| H11 | `monitoreoDiario()` a las 7:00 AM: errores de 24 h + diagnóstico de inventario + cuadre del kardex → correo al administrador si hay algo (y control los lunes). |
| H12 | `VERSION_BACKEND` en `ping` y `getAllData`; la app avisa si el servidor está desactualizado. |
| H13 | Sesión deslizante: se extiende 30 días al usarla cuando le quedan menos de 7. |
| H14 | Menú para proteger las hojas de datos con advertencia. |
| H15 | El respaldo diario conserva las últimas 30 copias. |
| H16 | Depuración de `Operaciones` y `Registro de Errores` de más de 180 días. |

### Fase 10 — ✅ desplegada

| Hallazgo | Resultado |
|---|---|
| H6 | Un abono mayor que el saldo, o que llega a una cuenta ya saldada o anulada (p. ej. dos equipos cobraron el mismo fiado sin conexión), aplica lo justo y **registra el excedente** en el historial del fiado; aparece en "⚠️ Por revisar" y en el correo del administrador. Antes: RD$ 400 sin registro. |
| H7 | Al anular un fiado con abonos, la confirmación muestra lo abonado y queda anotado "a devolver" en la cuenta. |
| H19 | El servidor rechaza una venta a crédito cuyo abono inicial cubre el total ("regístrala al contado"). |
| M2 | Reportes con **Dinero Cobrado** (contado + abonos), **Pendiente por Cobrar** y **A Devolver a Clientes**; la ganancia indica que incluye ventas a crédito. |

**Pruebas:** 109 automatizadas en verde (7 nuevas) + verificación en navegador.

## 7. Criterios de "cero quejas"

Al cerrar las Fases 8 y 9, el sistema debería cumplir lo siguiente:

1. **Ninguna operación desaparece en silencio.** Todo rechazo o error queda en el historial visible y en el registro del administrador.
2. **Ningún producto puede existir dos veces con el mismo nombre**, ni por formulario, ni por tanque, ni por dos equipos.
3. **La pantalla nunca muestra datos viejos sin avisar**, aunque pase un año de uso.
4. **El administrador se entera primero:** correo diario con errores, diagnóstico de inventario y cuadre del kardex.
5. **Ningún cambio de código puede romper lo corregido** sin que fallen las pruebas automáticas.
