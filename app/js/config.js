// Réglages globaux de Mapog
const CONFIG = {
  // Grille de découverte : taille d'une cellule en degrés (~55 m en latitude).
  // NE PAS CHANGER après lancement : les clés stockées en dépendent.
  CELL_STEP: 0.0005,

  // Rayon révélé (en mètres) autour de chaque point visité
  REVEAL_RADIUS_M: 120,

  // Positions GPS ignorées au-delà de cette imprécision (mètres)
  MAX_GPS_ACCURACY_M: 150,

  // API de sync. Dans l'app native (Capacitor), les fichiers sont embarqués
  // dans l'APK : l'API doit être une URL absolue vers le serveur. En web/dev,
  // api.php est servi à côté de index.html.
  API_URL: (window.Capacitor && window.Capacitor.isNativePlatform())
    ? 'https://mapog.goret.click/api.php'
    : './api.php',
  SYNC_INTERVAL_MS: 60000,
  PUSH_BATCH: 4000,

  // Rendu
  FOG_COLOR: 'rgba(7, 9, 14, 0.94)',
  TILE_URL: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  TILE_ATTRIB: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',

  // Vue par défaut (France) tant qu'aucune position n'est connue
  DEFAULT_VIEW: { lat: 46.6, lng: 2.4, zoom: 6 }
};
