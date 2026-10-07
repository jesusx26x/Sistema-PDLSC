# 🚀 Guía de Activación del Backend, Trigger & Seguridad RLS — Thor Essence
**Desarrollado para**: [jesusx26x/Sistema-PDLSC](https://github.com/jesusx26x/Sistema-PDLSC)  
**Cliente Final**: Pamela (Zero-Config: no necesita configurar nada)  
**Seguridad**: RLS en Servidor (Row Level Security) + Sesiones Revocables

---

## ⏰ Configuración del Disparador (Trigger) de Respaldo Diario

El sistema incluye una función automatizada para respaldar la base de datos de Pamela en Google Drive todas las noches a las 2:00 AM. Puedes configurarlo de dos maneras:

### 🏆 Método 1: En 1 Clic desde Google Sheets (El más fácil)
1. Abre tu hoja de cálculo vinculada a Thor Essence.
2. En la barra superior de herramientas de Google Sheets, haz clic en el menú:  
   👉 **`🌸 Thor Essence Admin`** > **`⏰ Configurar Respaldo Automático Diario`**.
3. Google solicitará autorización la primera vez. Concédele permisos y listo.
4. Aparecerá una confirmación indicando que el respaldo nocturno quedó programado todos los días entre 2:00 AM y 3:00 AM.

---

### 🛠️ Método 2: Configuración Manual en la Consola de Apps Script
Si prefieres verificarlo o configurarlo directamente en el panel de activadores de Google Apps Script:

1. En el editor de **Apps Script**, ve al panel lateral izquierdo y haz clic en el ícono de reloj ⏰ (**Activadores** / *Triggers*).
2. Haz clic en el botón azul **+ Añadir activador** (abajo a la derecha).
3. Completa exactamente los siguientes campos:

| Campo | Valor a Seleccionar | Explicación |
|:---|:---|:---|
| **Qué función desea ejecutar** | `crearRespaldoEnDrive` | Función que genera la copia con sello de tiempo en Google Drive |
| **Qué despliegue se debe ejecutar** | `Principal` (o *Head*) | Ejecuta el código principal actualizado |
| **Seleccionar fuente del evento** | `Según el tiempo` (*Time-driven*) | Disparador programado por reloj |
| **Seleccionar tipo de disparador basado en la hora** | `Temporizador por días` (*Day timer*) | Ejecución recurrente una vez al día |
| **Seleccionar hora del día** | `De 2:00 a 3:00` (*2am to 3am*) | Horario de menor actividad para evitar colisiones |
| **Configuración de notificación de fallos** | `Notificarme inmediatamente` | Te envía un correo si surge algún error de cuota o permiso |

4. Haz clic en **Guardar**.

---

## 🔐 Credenciales del Sistema & Seguridad RLS

> [!CAUTION]
> El repositorio es **público**. Nunca escribas usuarios, contraseñas ni tokens en el código ni en esta documentación.

### 🔑 Definir o cambiar el usuario y la contraseña

1. Abre la hoja de cálculo de Google Sheets vinculada.
2. Menú 👉 **`🌸 Thor Essence Admin`** > **`🔑 Cambiar Usuario y Contraseña`**.
3. Escribe el usuario, la contraseña nueva (mínimo 10 caracteres) y confírmala.
4. Entrega la contraseña a Pamela por un canal privado.

Al cambiar la contraseña **se cierran todas las sesiones abiertas** en todos los dispositivos. Para cerrar sesiones sin cambiar la contraseña (por ejemplo, si se pierde un teléfono) usa **`🚪 Cerrar Todas las Sesiones Activas`**.

Si el servidor todavía tiene una contraseña antigua en texto plano (`AUTH_PASS`), se convierte automáticamente a hash en el primer inicio de sesión correcto.

### 🛡️ Medidas de Seguridad Implementadas:

1. **Credenciales solo en el servidor:**
   - No existen llaves maestras ni contraseñas grabadas en el código (ni del navegador ni de Apps Script).
   - El usuario y el hash SHA-256 con sal de la contraseña residen **exclusivamente** en `PropertiesService` (`AUTH_USER`, `AUTH_PASS_HASH`, `AUTH_SALT`).
   - Tras 5 intentos fallidos, el inicio de sesión se bloquea 15 minutos.
   - El cliente solo maneja tokens temporales generados al autenticarse (válidos 30 días, máximo 20 sesiones activas).

2. **RLS (Row Level Security) Activo:**
   - La API de Apps Script bloquea cualquier lectura o mutación anónima (`getAllData`, `saveProduct`, `registerSale`, etc.).
   - Si no se envía un token de sesión válido y no expirado, el servidor rechaza la solicitud de inmediato con un error `401 Unauthorized (UNAUTHORIZED_RLS)`.
   - Nadie puede consultar filas de la base de datos sin haber iniciado sesión.

3. **Signout Real en Servidor / Base de Datos:**
   - Al hacer clic en **Cerrar Sesión (🚪 Salir)**, el sistema no solo limpia el almacenamiento local del navegador:
   - Envía una petición `action: 'logout'` a Google Apps Script para **destruir e invalidar el token en el servidor** (`CacheService` y `PropertiesService`).
   - El token queda revocado en el backend y no puede volver a ser utilizado.

---

## 🌐 Paso 3: Actualizar el Despliegue en Apps Script (¡Crucial para sincronización de Tanques!)

Para que los cambios de suma acumulativa atómica y autoconciliación queden 100% activos en la nube de Google Sheets:

1. Abre tu proyecto en **Google Apps Script** (desde Google Sheets: *Extensiones > Apps Script* o en [script.google.com](https://script.google.com)).
2. Abre el archivo de código (`Código.gs` o `Codigo.gs`) y **reemplaza todo su contenido** con el nuevo contenido de `backend/Codigo.gs`.
3. Haz clic en el disquete 💾 (**Guardar**).
4. Arriba a la derecha, haz clic en **Implementar** > **Gestionar implementaciones**.
5. Selecciona la implementación de tipo Aplicación web y pulsa el lápiz ✏️ (**Editar**).
6. En el selector **Versión**, haz clic y selecciona **Nueva versión**.
7. Haz clic en el botón azul **Implementar**.
8. ¡Listo! La URL permanece exactamente igual y Pamela disfrutará de suma acumulativa instantánea en todos sus tanques.

---

## 🔍 Diagnóstico y Corrección de Inventario (duplicados y stock de más)

La antigua "conciliación automática" se eliminó: podía duplicar productos e inflar el stock. Ahora el sistema **nunca corrige el inventario por su cuenta**; propone y el administrador decide.

1. En Google Sheets: **`🌸 Thor Essence Admin`** > **`🔍 Diagnosticar Inventario (duplicados y excesos)`**.
2. Se abre la hoja **`Diagnóstico Inventario`**. Las filas con acción propuesta aparecen primero:
   - **`ELIMINAR_DUPLICADO`**: copia de otro producto (incluye las `PROD-REST-…` y productos renombrados). Se da de baja; sus ventas quedan en el historial.
   - **`AJUSTAR_STOCK`**: el stock supera lo que justifican tanques − ventas + ajustes. La columna **Nuevo stock** trae la propuesta y **se puede editar** con el conteo físico.
   - **`ELIMINAR_RECEPCION_DUPLICADA`**: tanque registrado dos veces. Solo borra el registro repetido.
   - Confianza **Revisar**: el producto se creó a mano antes de esta versión y pudo tener stock inicial no registrado. Verificar antes de marcar.
3. Marca la casilla **Aplicar** solo en las filas que quieras corregir.
4. **`🌸 Thor Essence Admin`** > **`✅ Aplicar Correcciones Marcadas del Diagnóstico`**. Se crea antes un respaldo en Drive (`Respaldos Thor Essence`). Si el stock de un producto cambió desde el diagnóstico (por ejemplo, hubo una venta), esa fila se omite y hay que volver a diagnosticar.

El botón de diagnóstico de la app ejecuta el mismo análisis (sin aplicar nada) y avisa si hay hallazgos.

### 📒 Hoja `Movimientos` (kardex)
Cada cambio de stock queda registrado: `SALDO_INICIAL`, `ALTA`, `EDICION`, `AJUSTE`, `VENTA`, `ANULACION`, `RECEPCION`, `REVERSION_RECEPCION`, `ELIMINACION` y `CORRECCION`, con la cantidad (+/−), el stock resultante y la referencia (venta, tanque). La suma de los movimientos de un producto debe ser igual a su stock; el diagnóstico avisa si no coincide (por ejemplo, por una edición directa en la hoja Inventario). **No edites ni borres esta hoja.** La hoja `AJUSTES` queda como historial y ya no se escribe.

## ⚙️ Opciones de la hoja `Configuracion`

| Clave | Valores | Efecto |
|:---|:---|:---|
| `TASA_CAMBIO_USD_DOP` | número | Tasa por defecto para convertir costos en USD. |
| `PRORRATEAR_FLETE` | `SI` / `NO` (por defecto `NO`) | Con `SI`, el flete del tanque se reparte entre todas sus unidades y se suma al costo de cada producto recibido (la ganancia refleja el costo real puesto en RD). Solo afecta a tanques registrados después del cambio. Si la fila no existe, agrégala manualmente. |

**Edición de productos:** al editar un producto se guardan nombre, precio, costo, categoría, etc., pero **la cantidad no se sobrescribe**. Si se cambia la cantidad en el formulario, la app registra la diferencia como un ajuste (queda en `Movimientos`). Así, dos dispositivos con datos desactualizados no se pisan las ventas.

## 🗂️ Hojas internas (ocultas) — no editar ni borrar

| Hoja | Para qué sirve |
|:---|:---|
| `Operaciones` | Registro de operaciones ya aplicadas: evita duplicar ventas, tanques o abonos si un teléfono reenvía una operación. |
| `Alias` | Cuando dos equipos crean el mismo producto (o un tanque sin conexión trae un producto que ya existía), guarda "ID del dispositivo → ID real" para que las ventas posteriores caigan en el producto correcto. |
| `Movimientos` | Kardex: cada entrada y salida de stock. |

**Productos con el mismo nombre:** el sistema no permite dos productos activos con el mismo nombre (sin distinguir mayúsculas, acentos ni espacios repetidos). Si se crea uno repetido, las unidades se suman al existente.

**Historial en el teléfono:** la app descarga el detalle de las ventas de los últimos 180 días y los fiados abiertos; los reportes incluyen todo el historial mediante un resumen que calcula el servidor.

