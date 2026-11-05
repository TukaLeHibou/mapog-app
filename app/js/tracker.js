// Suivi GPS, deux modes :
//  - App native (Capacitor) : plugin background-geolocation → le suivi continue
//    écran éteint / app en poche, avec une notification persistante Android.
//  - Navigateur (dev, démo PC) : API Geolocation classique, premier plan
//    uniquement (et HTTPS obligatoire, sauf localhost).
const Tracker = (() => {
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform());
  const BgGeo = isNative ? window.Capacitor.registerPlugin('BackgroundGeolocation') : null;

  let watchId = null; // id navigateur (number) ou id de watcher natif (string)

  function start(onPosition, onError) {
    if (isNative) {
      BgGeo.addWatcher(
        {
          backgroundTitle: 'Exploration en cours',
          backgroundMessage: 'Mapog révèle la carte autour de toi.',
          requestPermissions: true,
          stale: false,
          distanceFilter: 25 // mètres entre deux mises à jour — économise la batterie
        },
        (location, error) => {
          if (error) {
            if (error.code === 'NOT_AUTHORIZED' && BgGeo.openSettings) {
              // L'utilisateur a refusé la permission : on le renvoie aux réglages
              onError(new Error('Permission localisation refusée — à activer dans les réglages ("Toujours autoriser" pour l\'arrière-plan)'));
            } else {
              onError(new Error(error.message || 'erreur GPS'));
            }
            return;
          }
          if (location.accuracy > CONFIG.MAX_GPS_ACCURACY_M) return;
          onPosition(location.latitude, location.longitude, location.accuracy);
        }
      ).then(id => { watchId = id; })
       .catch(err => onError(err));
      return;
    }

    if (!('geolocation' in navigator)) {
      onError(new Error('Géolocalisation non supportée par ce navigateur'));
      return;
    }
    watchId = navigator.geolocation.watchPosition(
      pos => {
        if (pos.coords.accuracy > CONFIG.MAX_GPS_ACCURACY_M) return; // trop imprécis
        onPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      err => onError(err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );
  }

  function stop() {
    if (watchId === null) return;
    if (isNative) {
      BgGeo.removeWatcher({ id: watchId });
    } else {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
  }

  function active() { return watchId !== null; }

  return { start, stop, active, isNative };
})();
