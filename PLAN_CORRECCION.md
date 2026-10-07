# 🛠️ Plan de Corrección por Fases — Auditoría Octubre 2026

Origen: auditoría completa de `backend/Codigo.gs`, `js/api.js`, `js/app.js`, `sw.js` e `index.html`.
Los códigos (C1, A3, M5…) refieren a los hallazgos de esa auditoría.

> **Despliegue del backend**: cada fase que toque `backend/Codigo.gs` requiere pegar el archivo en el editor de Apps Script
> y publicar **Implementar › Gestionar implementaciones › Editar › Nueva versión** (la URL se mantiene).
> Si el frontend y el backend cambian juntos, publicar primero el backend.
> **Regla:** publicar el backend en Apps Script antes de hacer push a `main` (GitHub Pages publica el frontend al instante).
> Subir `CACHE_NAME` en `sw.js` en cada despliegue del frontend para que los dispositivos no sigan usando JS viejo.

---

## Fase 1 — Credenciales y sesiones (C1, M6, bajos de seguridad) · 🔴 URGENTE

| # | Cambio | Archivos |
|---|---|---|
| 1.1 | Eliminar la contraseña escrita en código y documentación. Las credenciales viven **solo** en `ScriptProperties`. | `Codigo.gs`, `TASKME.md`, `INSTRUCCIONES_CONFIGURACION.md` |
| 1.2 | Guardar la contraseña como hash SHA-256 con sal (`AUTH_PASS_HASH` + `AUTH_SALT`). Migración automática desde `AUTH_PASS` en texto plano al primer login correcto. | `Codigo.gs` |
| 1.3 | Menú **🔑 Cambiar usuario y contraseña** (pide los datos con `prompt`, nunca los muestra) y **🚪 Cerrar todas las sesiones**. Cambiar la contraseña revoca todas las sesiones existentes. | `Codigo.gs` |
| 1.4 | Bloqueo temporal tras 5 intentos fallidos de login (15 min). | `Codigo.gs` |
| 1.5 | Limpieza de sesiones expiradas en `ScriptProperties` y tope de sesiones activas. | `Codigo.gs` |
| 1.6 | Eliminar la puerta trasera `MASTER_SERVICE_KEY` y bloquear que `saveConfig` escriba claves `AUTH_*`/`SESSION_*`. | `Codigo.gs` |
| 1.7 | Login/logout fuera del `LockService` global; respuestas de error sin `stack`. | `Codigo.gs` |

**Acciones manuales (fuera del código):**
1. Desplegar la nueva versión del backend.
2. Desde Google Sheets: `🌸 Thor Essence Admin › 🔑 Cambiar usuario y contraseña` → **contraseña nueva** (la anterior está publicada y debe darse por comprometida).
3. Regenerar `assets/Manual_de_Usuario_Thor_Essence.pdf` sin credenciales (el PDF actual las contiene).
4. Decidir sobre el historial de git: la contraseña vieja sigue en commits anteriores. Rotarla la neutraliza; reescribir el historial es opcional.
5. Valorar quitar del repo público `Solicitud de sistema Pamela.ogg` y `backend/Thor_Essence_Base_De_Datos.xlsx`.

**Criterio de aceptación:** `grep` del repo sin contraseñas; login con credenciales migradas funciona; tras rotar, los tokens anteriores reciben `UNAUTHORIZED_RLS`; 6.º intento fallido devuelve `TOO_MANY_ATTEMPTS`.

---

## Fase 2 — Idempotencia e IDs únicos (C2, C4, A1, M5) · 🔴

- Cada operación del outbox lleva un `opId` (UUID) generado en el cliente.
- El servidor registra los `opId` procesados (hoja `OPERACIONES` + caché) y ante un reintento devuelve el resultado original sin volver a aplicar la mutación.
- El cliente genera los IDs definitivos (`VTA-`, `COB-`, `TANQ-`, `PROD-` con UUID) y el servidor los respeta → anular/abonar/vender antes de sincronizar funciona.
- Marcar ítems "en vuelo" para que `flushOutbox` no reenvíe lo que `apiPost` está enviando.
- Sustituir IDs por segundo + `random(100)` del servidor por `Utilities.getUuid()`.

**Aceptación:** reenviar el mismo payload 3 veces produce 1 venta; tanque con 30 productos nuevos → 30 IDs distintos.

**Implementado:**
- Backend: `ejecutarAccion()` + hoja oculta `Operaciones` (op_id → resultado, con caché de 6 h). Solo se registran operaciones exitosas.
- Backend: deduplicación por entidad aunque cambie el op_id: `id_venta` (antes de validar stock), `id_recepcion`, `id_abono`; anular una venta ya anulada es éxito idempotente.
- Backend: `generarId()` → `PREFIJO-yyyyMMdd-XXXXXXXX`; respeta `id_venta`, `id_cobro`, `id_abono_inicial`, `id_abono`, `id_recepcion` y `art.id` enviados por el cliente; el detalle del tanque guarda el ID real de cada artículo.
- Cliente: `prepararIdsOperacion()` asigna los IDs antes de aplicar en local; cada ítem del outbox lleva `opId` (también los heredados y los re-encolados desde la cola de recuperación).
- Cliente: todos los envíos pasan por una cadena en serie (`enSerie`) con timeout de 45 s; las operaciones en vuelo de `apiPost` no se reenvían desde `flushOutbox`; `flushOutbox` ya no devuelve `{inProgress}` sin conteo de pendientes.
- Cliente: el abono ya no se aplica dos veces en `app.js` (se recarga desde la caché).
- Compatibilidad: backend nuevo + frontend viejo y frontend nuevo + backend viejo siguen funcionando.

**Notas para fases siguientes:**
- Fase 3: en el backend la búsqueda por nombre en tanques incluye filas `Eliminado` (revive el producto con su ID viejo), mientras que el cliente crea uno nuevo → decidir la regla al rehacer la conciliación.
- Fase 4: al sacar del outbox los rechazos de negocio, tener en cuenta que un rechazo puede deberse a una operación anterior aún pendiente (p. ej. venta de un producto cuyo alta falló).

## Fase 3 — Conciliación de inventario (C3, A4, A8) · 🔴

- Eliminar `autoConciliarInventarioConRecepciones` del cliente (no más reversión de mermas ni productos resucitados).
- Reescribir la conciliación del servidor **por ID** y con registro de movimientos (kardex: recepción, venta, anulación, ajuste, edición), corrigiendo: doble conteo de anulaciones, que solo suba stock, borrado de filas activas tras una "Eliminado", y `clearContents` no atómico.
- `eliminarRecepcion` descuenta realmente las unidades del tanque.
- Ningún ajuste, anulación ni recepción revive un producto `Eliminado` sin intención explícita.
- Conciliación solo bajo demanda y con vista previa de cambios.

**Implementado:**
- Cliente: eliminada `autoConciliarInventarioConRecepciones` (origen de los `PROD-REST-…`, de productos eliminados/renombrados que reaparecían y de mermas revertidas).
- Backend: kardex en la hoja `Movimientos` con `SALDO_INICIAL` al activarse; todas las operaciones de stock registran su movimiento. Ya no se escribe `AJUSTES`.
- Backend: un producto `Eliminado` no se revive (venta, ajuste, edición, anulación y tanque por nombre o ID); un tanque con el ID de un eliminado crea un producto con ID nuevo.
- Backend: `eliminarRecepcion` descuenta las unidades del tanque (con aviso si ya se vendieron).
- Backend: `diagnosticarInventario()` reemplaza a `conciliarInventarioConRecepciones()`. No modifica nada; agrupa duplicados por nombre actual e histórico (ventas y tanques), excluye tanques registrados dos veces, no cuenta dos veces las anulaciones y propone acciones en la hoja `Diagnóstico Inventario`.
- Backend: `aplicarCorreccionesMarcadas()` aplica solo filas marcadas, con respaldo previo en Drive, lock, y omite filas cuyo stock cambió desde el diagnóstico.
- Despliegue: backend y frontend deben publicarse juntos (el frontend anterior seguía recreando copias); diagnosticar después de que los dispositivos carguen la versión nueva (`CACHE_NAME` v4).

## Fase 4 — Robustez de la cola y sincronización (A2, A5, A6, A7, M7) · 🟠

- Distinguir fallo de red (reintentar) de rechazo de negocio (sacar del outbox, revertir el cambio local, mostrar el error).
- No vaciar la cola sin sesión; un 401 no cuenta como reintento.
- Tras descargar datos del servidor, re-aplicar las operaciones pendientes sobre la instantánea (rebase) en lugar de descartarlas.
- Quitar la doble aplicación local de `quickAdjustStock`.
- `resetAllData`/`reconcileInventory` nunca pasan por el outbox; arreglar la clave duplicada `resetSystemData`; la purga limpia también `AJUSTES`.

**Implementado:**
- La pantalla muestra la última foto del servidor (`thor_server_snapshot_v1`) con las operaciones pendientes re-aplicadas encima (`reconstruirCache`): descargar ya no borra lo pendiente y una operación rechazada se deshace sola.
- `getAllData` lee con lock (sin estados a medio escribir) y devuelve `ops_aplicadas`; el cliente quita de su cola lo que el servidor ya aplicó.
- `procesarCola`: envío estrictamente en orden; se detiene ante red caída, sesión vencida (`UNAUTHORIZED_RLS`) o `SERVER_BUSY` sin gastar reintentos; solo `SERVER_ERROR` cuenta para la cola de recuperación; los rechazos de negocio se descartan, se revierten y se avisan (`thor:operacion-rechazada`).
- `apiPost` devuelve el error real cuando el servidor rechaza (antes decía "guardado"); lo inválido en local no se encola.
- Sin sesión no se sube ni descarga nada; un solo aviso de sesión vencida.
- Ajuste rápido, anulación y eliminación: una sola aplicación local (antes el ajuste se aplicaba dos veces).
- Purga y diagnóstico por `apiDirecto` (requieren conexión, nunca en cola); la purga solo limpia el dispositivo si el servidor confirma.

## Fase 5 — Integridad de producto y reglas de negocio (A3, M4, M9, M10) · 🟠

- `saveProduct` en modo edición no modifica `cantidad`; el stock solo cambia por movimientos (delta).
- Validación en servidor: sin cantidades/precios negativos, `stock_minimo` 0 permitido.
- Redondeo a centavos en abonos/saldos; deudas canceladas fuera de las métricas por cobrar.
- Prorrateo opcional del flete del tanque en el costo unitario; mismo precio por defecto en cliente y servidor.

**Implementado:**
- `saveProduct` en edición ignora `cantidad`; el formulario envía la corrección como `adjustStock` (delta) y "sumar a existente" también.
- Validación (código `VALIDACION`): cantidades, costos, precios y abonos negativos; `stock_minimo` 0 permitido.
- Dinero redondeado a centavos (`r2`) en ventas, cobros y abonos, con tolerancia de medio centavo por cuota; mensaje claro para cuentas anuladas.
- Cuentas `Cancelada` fuera de las métricas por cobrar (servidor y dispositivo).
- Tanque: precio sugerido costo × 1.5 solo para productos nuevos sin precio (igual en ambos lados; ya no pisa el precio de existentes); flete prorrateado si `Configuracion › PRORRATEAR_FLETE = SI` (por defecto `NO`).
- Fase 6 adelantada: fechas locales en formato `yyyy-MM-dd HH:mm:ss`, métricas de hoy/mes en hora local.

## Fase 6 — Métricas y fechas (M2, M3) · 🟡

- Formato único de fecha `yyyy-MM-dd HH:mm:ss` en zona `America/Santo_Domingo` en cliente y servidor.
- `recalcularMetricasLocales` calcula ventas de hoy/mes reales con fecha local (no UTC).

## Fase 7 — PWA offline, XSS y rendimiento (M1, M8, bajos) · 🟡

- Compilar Tailwind a CSS estático, alojar Chart.js con versión fija, versionar `CACHE_NAME` por despliegue, network-first para el app shell.
- Función `escapeHtml` aplicada a todo texto de usuario en `innerHTML` y en Sonner.
- Token por POST en lugar de query string; evitar `inicializarHojasSiNoExisten` en cada request y la doble lectura en `getAllData`.

**Implementado (Fases 6 y 7):**
- Fechas de la interfaz en hora local (antes UTC: después de las 8 PM contaba el día siguiente); backend con zona fija `America/Santo_Domingo`.
- Tailwind compilado a `css/tailwind.css` (sin CDN de desarrollo) y Chart.js 4.5.1 en `js/vendor/`; `npm run build` los regenera.
- Service worker v6: pre-cachea el app shell, primero red con respaldo en caché (timeout 4 s), fuentes en caché; la app abre con estilos y gráficas sin conexión.
- `esc()` en todas las plantillas HTML con texto del usuario; los avisos (Sonner) se muestran como texto; CSV protegido contra fórmulas.
- Lecturas por POST (token fuera de la URL) con respaldo GET para backends anteriores; `getAllData` lee cada hoja una sola vez.
- `404.html` con `<base>` para funcionar en cualquier ruta.

---

## Estado

| Fase | Estado |
|---|---|
| 1 — Credenciales y sesiones | ✅ Desplegado (pendiente: regenerar el manual PDF sin credenciales) |
| 2 — Idempotencia e IDs | ✅ Desplegado |
| 3 — Conciliación | ✅ Desplegado y datos corregidos (tanque duplicado + 2 productos con 62 u. de más) |
| 4 — Cola y sincronización | ✅ Desplegado |
| 5 — Reglas de negocio | ✅ Desplegado (prorrateo de flete pospuesto por decisión del negocio) |
| 6 — Métricas y fechas | ✅ Desplegado |
| 7 — PWA, XSS, rendimiento | ✅ Desplegado |
| 8 — Cero pérdidas y cero duplicados (auditoría 2) | ✅ Desplegado |
| 9 — Detección temprana (auditoría 2) | ✅ Desplegado (monitoreo diario y protección de hojas activos) |

> Las fases 8 en adelante provienen de [AUDITORIA_INTEGRAL_2026-10.md](AUDITORIA_INTEGRAL_2026-10.md).
