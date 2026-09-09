/**
 * =========================================================================
 * THOR ESSENCE — CONFIGURACIÓN CENTRALIZADA (ZERO-CONFIG PARA PAMELA)
 * =========================================================================
 * 
 * Este archivo conecta automáticamente el frontend con Google Sheets.
 * Pamela no tiene que configurar nada: solo entra al enlace y empieza a usarlo.
 */

const THOR_CONFIG = {
  // 🔗 URL de la Aplicación Web de Google Apps Script activa:
  GAS_URL: "https://script.google.com/macros/s/AKfycbw26MgtyFPbH1kKKxhPOBY24s8avoGP0hGz9DkIQC4qe1-52d4FZ1cWeBuX7cdA4MRr/exec",

  // 🆔 ID de Implementación oficial:
  DEPLOYMENT_ID: "AKfycbw26MgtyFPbH1kKKxhPOBY24s8avoGP0hGz9DkIQC4qe1-52d4FZ1cWeBuX7cdA4MRr",

  // 🔑 Token de seguridad para comunicación cifrada con la hoja:
  SECURITY_TOKEN: "THOR_SECURE_2026",

  // 💵 Tasa de cambio inicial sugerida USD a DOP:
  DEFAULT_USD_RATE: 60.50,

  // 🌸 Datos del negocio:
  APP_NAME: "Thor Essence",
  SLOGAN: "Belleza, aroma y estilo en un solo lugar",
  OWNER: "Pamela",

  // 🌐 Repositorio oficial en GitHub:
  GITHUB_REPO: "https://github.com/jesusx26x/Sistema-PDLSC",
  GITHUB_PAGES_URL: "https://jesusx26x.github.io/Sistema-PDLSC/",

  // ⏱️ Opciones de micro-interacciones (estilo Emil Kowalski):
  ANIMATION_DURATION_MS: 220,
  SPRING_EASING: "cubic-bezier(0.16, 1, 0.3, 1)"
};
