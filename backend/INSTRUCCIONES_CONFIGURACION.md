# 🚀 Guía de Activación del Backend & Disparadores — Thor Essence
**Desarrollado para**: [jesusx26x/Sistema-PDLSC](https://github.com/jesusx26x/Sistema-PDLSC)  
**Cliente Final**: Pamela (Zero-Config: no necesita configurar nada)

---

## 💡 ¿Cómo proceder con el archivo de Google Sheets?

Te hemos preparado **las 2 opciones** para que elijas la que prefieras. 

### 🏆 Opción A (Recomendada — La más rápida y automática):
Ya creamos el archivo Excel con formato y tablas profesionales listas en:  
📁 **`backend/Thor_Essence_Base_De_Datos.xlsx`**

**Procedimiento:**
1. Ve a tu [Google Drive](https://drive.google.com).
2. Arrastra y suelta el archivo `Thor_Essence_Base_De_Datos.xlsx` en tu Drive.
3. Haz doble clic en él y pulsa **Abrir con Hojas de cálculo de Google** (o Archivo > Guardar como hoja de cálculo de Google).
4. ¡Listo! Ya tienes las 4 hojas creadas (`Inventario`, `Ventas`, `Recepciones`, `Configuracion`) con los colores oficiales de Thor Essence, fórmulas de formato de moneda (USD y RD$) y artículos de muestra.

---

### Opción B (Manual desde una hoja en blanco):
Si prefieres crear una hoja vacía desde cero:
1. Entra a [Google Sheets](https://sheets.new).
2. Nómbrala como: `Thor Essence - Base de Datos`.
3. No tienes que crear columnas a mano: nuestro script tiene la función `inicializarHojasSiNoExisten(true)` que crea y diseña todas las hojas automáticamente al ejecutarse por primera vez.

---

## ⚡ Paso 2: Pegar el Script en Apps Script

1. En tu hoja de cálculo abierta en Google Sheets, ve al menú superior:  
   **Extensiones** > **Apps Script**.
2. Se abrirá el editor. Borra cualquier código existente en `Código.gs`.
3. Abre el archivo **`backend/Codigo.gs`** de este proyecto, copia todo su contenido y pégalo en el editor.
4. Haz clic en el ícono de disquete 💾 (**Guardar proyecto**).

---

## 🌐 Paso 3: Desplegar como Aplicación Web (Generar la URL de la API)

1. En la esquina superior derecha del editor de Apps Script, haz clic en el botón azul **Implementar** (Deploy) > **Nueva implementación**.
2. En el engranaje ⚙️ (Tipo), asegúrate de que esté marcado **Aplicación web**.
3. Configura estos 3 campos:
   - **Descripción**: `API Thor Essence v1`
   - **Ejecutar como**: **Yo (tu correo de Google)**
   - **Quién tiene acceso**: **Cualquier usuario** *(Crucial para que Pamela pueda consultar y guardar datos desde GitHub Pages sin iniciar sesión de Google)*.
4. Haz clic en **Implementar**.
5. Autoriza los permisos de Google:
   - Haz clic en **Autorizar acceso**.
   - Selecciona tu cuenta de Google.
   - En la advertencia *"Google no ha verificado esta aplicación"*, haz clic en **Avanzado** (abajo a la izquierda) y luego en **Ir a Thor Essence (no seguro)**.
   - Haz clic en **Permitir**.
6. Google te mostrará la **URL de la aplicación web** (termina en `/exec`).  
   Copia esa URL completa. Se verá así:  
   `https://script.google.com/macros/s/AKfycbx.../exec`

---

## ⏰ Paso 4: Configurar los Disparadores (Triggers) de Respaldo Automático

Para garantizar la seguridad de los datos de Pamela contra cualquier imprevisto:

1. Regresa a la pestaña de tu hoja de Google Sheets y **recarga la página** (F5).
2. En el menú superior de la hoja aparecerá un nuevo menú exclusivo:  
   👉 **`🌸 Thor Essence Admin`**
3. Haz clic en:  
   **`🌸 Thor Essence Admin` > `⏰ Configurar Respaldo Automático Diario`**.
4. Autoriza la ejecución si te lo solicita.
5. **¿Qué hace este disparador?**  
   Google Apps Script programará automáticamente una tarea que, **todas las madrugadas a las 2:00 AM**, crea una copia completa de la base de datos con fecha y hora dentro de una carpeta llamada `Respaldos Thor Essence` en tu Google Drive. ¡Seguridad 100% automatizada!
6. También puedes hacer clic en **`💾 Crear Copia de Respaldo en Drive`** en cualquier momento para generar un respaldo instantáneo manual.

---

## 🔒 Paso 5: Dejar el Sistema Zero-Config para Pamela

Para que Pamela no tenga que configurar absolutamente nada:

1. Abre el archivo **`js/config.js`** en tu editor de código.
2. Pega la URL de Apps Script en la variable `GAS_URL`:
   ```javascript
   const THOR_CONFIG = {
     GAS_URL: "https://script.google.com/macros/s/TU_URL_COPIADA_AQUI/exec",
     SECURITY_TOKEN: "THOR_SECURE_2026",
     ...
   };
   ```
3. Guarda el archivo, haz commit y súbelo a GitHub:
   ```bash
   git add .
   git commit -m "feat: conectar backend de Google Sheets con respaldo automatico"
   git push origin main
   ```
4. **¡Listo!** A partir de ese momento, cualquier persona que entre a:  
   👉 **`https://jesusx26x.github.io/Sistema-PDLSC/`**  
   estará conectada directamente y en tiempo real a la base de datos de Google Sheets sin configurar nada.
