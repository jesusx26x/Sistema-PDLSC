# 🌸 Thor Essence — Sistema de Inventario & Ventas

[![GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-D4AF37?style=for-the-badge&logo=github)](https://jesusx26x.github.io/Sistema-PDLSC/)
[![Repository](https://img.shields.io/badge/Repo-jesusx26x%2FSistema--PDLSC-0E172E?style=for-the-badge&logo=github)](https://github.com/jesusx26x/Sistema-PDLSC)
[![Design](https://img.shields.io/badge/Design-Emil%20Kowalski%20%26%20UX--UI--PRO--MAX-F472B6?style=for-the-badge)](https://animations.dev)
[![Backend](https://img.shields.io/badge/Backend-Google%20Sheets%20API-10B981?style=for-the-badge&logo=googlesheets)](https://sheets.google.com)

Sistema de gestión comercial y control de existencias diseñado exclusivamente para **Thor Essence** (Pamela). Desarrollado bajo la filosofía de micro-interacciones fluidas de **Emil Kowalski** y los estándares de diseño de **UX-UI-PRO-MAX**.

🔗 **Acceso en Vivo**: [https://jesusx26x.github.io/Sistema-PDLSC/](https://jesusx26x.github.io/Sistema-PDLSC/)

![Thor Essence Logo](assets/logo.jpg)

> *"Belleza, aroma y estilo en un solo lugar"*  
> **Especialidad**: Perfumes, Splash, Cremas, Body Wash, Accesorios, Maquillaje y Variedades importadas desde EE.UU.

---

## 🎯 Cero Configuración para el Cliente Final (Pamela)

> [!IMPORTANT]
> **Pamela solo necesita abrir el enlace en su celular o tableta**.  
> Toda la conexión a la base de datos en Google Sheets y los tokens de seguridad están precableados de forma invisible en [`js/config.js`](js/config.js). Ella nunca verá pantallas técnicas ni tendrá que configurar nada; solo entra y empieza a registrar mercancía y ventas de inmediato.

---

## ✨ Características Principales

### 1. 🎨 Experiencia Visual Emil Kowalski & UX-UI-PRO-MAX
- **Física de resortes (Spring Easing)**: Todas las transiciones utilizan curvas cúbicas naturales (`cubic-bezier(0.16, 1, 0.3, 1)`) con tiempos sub-300ms.
- **Micro-interacciones táctiles**: Botones con efecto de presión real (`active:scale-[0.96]`) y retroalimentación inmediata.
- **Sistema de Toasts Sonner**: Notificaciones apilables ultraligeras, elegantes y sin saltos de interfaz.
- **Cajón Inferior (Vaul Drawer)**: En teléfonos celulares, los formularios emergen suavemente desde abajo con tirador táctil redondeado para manejo natural con una sola mano.
- **Bento Grid Luxury**: Paleta profunda Dark Navy (`#040714`) con acentos en Champagne Gold (`#D4AF37`) y destellos florales.

### 2. 💵 Doble Moneda con Conversión Automática (USD ➔ RD$)
- Moneda oficial en Pesos Dominicanos (**RD$**).
- Entrada flexible para costos en **USD ($)** o en **RD$**.
- Conversión instantánea con consulta automática de la **tasa del mercado del día** (vía API en vivo con botón 🔄).
- Cálculo en tiempo real de margen de ganancia en porcentaje (`%`) y en pesos netos.

### 3. 🚢 Módulo Especializado para "Tanques de EE.UU."
- Diseñado para resolver la recepción frecuente de tanques con variedad de artículos.
- Permite registrar el nombre del lote, fecha, flete en dólares y agregar múltiples productos en una sola sesión.
- Actualización atómica del inventario en un solo paso.

### 4. 💰 Punto de Venta (POS) & Historial
- Registro rápido de ventas con comprobación de existencias en tiempo real.
- Opción de anulación con **reingreso automático del stock** al inventario.
- Reportes financieros de ingresos, costo de mercancía y beneficio neto.
- Exportación directa a **Excel (.CSV)** para respaldos contables.

### 5. 🔒 Seguridad y Respaldo en Google Drive
- Google Sheets actúa como base de datos en la nube sin costo alguno.
- La hoja incluye un **disparador automático (Trigger)** para crear respaldos diarios automáticos a las 2:00 AM en Google Drive.
- Google Apps Script actúa como proxy seguro: no hay credenciales ni contraseñas expuestas en GitHub Pages.

---

## 🏗️ Estructura del Repositorio

```
Sistema-PDLSC/
├── index.html                   # Aplicación Web SPA (Mobile / Tablet / PC)
├── manifest.json                # PWA Manifest para instalar en celular
├── .nojekyll                    # Asegura que GitHub Pages sirva todos los archivos
├── README.md                    # Documentación del sistema
├── TASKME.md                    # Bitácora y seguimiento de tareas del desarrollador
│
├── assets/
│   └── logo.jpg                 # Logotipo oficial de Thor Essence
│
├── css/
│   └── styles.css               # Estilos Emil Kowalski + Bento Grid UX-UI-PRO-MAX
│
├── js/
│   ├── config.js                # Configuración centralizada (Zero-Config para Pamela)
│   ├── api.js                   # Módulo API, Toasts Sonner y tasa de cambio
│   └── app.js                   # Controlador UI, ventas, inventario y tanques
│
└── backend/
    ├── Thor_Essence_Base_De_Datos.xlsx # Plantilla Excel lista para subir a Google Drive
    ├── Codigo.gs                # Código de Google Apps Script con menú y respaldos
    └── INSTRUCCIONES_CONFIGURACION.md  # Guía paso a paso para el desarrollador
```

---

## 🚀 Despliegue en GitHub Pages (jesusx26x)

1. Sube este proyecto al repositorio [jesusx26x/Sistema-PDLSC](https://github.com/jesusx26x/Sistema-PDLSC).
2. Ve a **Settings > Pages**.
3. En **Branch**, selecciona `main` y la carpeta `/(root)`.
4. El sistema estará disponible públicamente en:  
   👉 **`https://jesusx26x.github.io/Sistema-PDLSC/`**

---

© 2026 **Thor Essence** — Desarrollado para Pamela por jesusx26x.
