/** Configuración de Tailwind (antes se definía en index.html para el CDN de desarrollo). */
module.exports = {
  content: ['./index.html', './404.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: {
          pearl: '#F8FAFC',
          surface: '#FFFFFF',
          surfaceRaised: '#F1F5F9',
          card: '#FFFFFF',
          gold: '#B8860B',
          goldLight: '#DFB743',
          goldDark: '#926704'
        }
      }
    }
  }
};
