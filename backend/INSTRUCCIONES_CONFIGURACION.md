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

## 🔄 Menú de Conciliación en Google Sheets (En caso de dudas de stock)

Si en algún momento Pamela desea verificar o auditar su inventario:
1. Abre la hoja de cálculo de Google Sheets.
2. En la barra superior, haz clic en:  
   👉 **`🌸 Thor Essence Admin`** > **`🔄 Reconciliar y Reparar Stock de Inventario`**.
3. El sistema auditará automáticamente todas las recepciones históricas contra las ventas registradas y corregirá cualquier discrepancia al instante sin perder ni una sola unidad.
