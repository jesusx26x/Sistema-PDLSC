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

Para ingresar al sistema Thor Essence:

- **Usuario:** `Pameladlsantos`
- **Contraseña:** `Thorayka2419`

### 🛡️ Medidas de Seguridad Implementadas:

1. **Clave de Servicio Oculta (No visible en el navegador):**
   - No existen llaves maestras ni contraseñas grabadas en el código JavaScript del navegador (`config.js`).
   - Las credenciales maestras y llaves de servicio residen **exclusivamente en el servidor** (`PropertiesService` de Google Apps Script).
   - El cliente solo maneja tokens temporales generados al autenticarse.

2. **RLS (Row Level Security) Activo:**
   - La API de Apps Script bloquea cualquier lectura o mutación anónima (`getAllData`, `saveProduct`, `registerSale`, etc.).
   - Si no se envía un token de sesión válido y no expirado, el servidor rechaza la solicitud de inmediato con un error `401 Unauthorized (UNAUTHORIZED_RLS)`.
   - Nadie puede consultar filas de la base de datos sin haber iniciado sesión.

3. **Signout Real en Servidor / Base de Datos:**
   - Al hacer clic en **Cerrar Sesión (🚪 Salir)**, el sistema no solo limpia el almacenamiento local del navegador:
   - Envía una petición `action: 'logout'` a Google Apps Script para **destruir e invalidar el token en el servidor** (`CacheService` y `PropertiesService`).
   - El token queda revocado en el backend y no puede volver a ser utilizado.

---

## 🌐 Paso 3: Actualizar el Despliegue en Apps Script (Si ya tenías uno)

Cada vez que actualices `Codigo.gs`:
1. En Apps Script, haz clic en **Implementar** > **Gestionar implementaciones**.
2. Selecciona tu implementación activa y pulsa el lápiz ✏️ (**Editar**).
3. En **Versión**, selecciona **Nueva versión**.
4. Haz clic en **Implementar**. La URL permanece igual y adoptará inmediatamente los cambios de RLS y autenticación.
