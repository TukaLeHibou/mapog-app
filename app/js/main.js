// Point d'entrée : carte, brouillard, GPS, UI, sync automatique.
(async function () {
  await DB.open();

  // Ensemble des cellules découvertes, gardé en mémoire pour le rendu
  const cells = new Set(await DB.allCellKeys());

  function cellKey(lat, lng) {
    return Math.round(lat / CONFIG.CELL_STEP) + '_' + Math.round(lng / CONFIG.CELL_STEP);
  }

  // --- Carte ---

  const lastView = await DB.getMeta('lastView') || CONFIG.DEFAULT_VIEW;
  const map = L.map('map', { zoomControl: false })
    .setView([lastView.lat, lastView.lng], lastView.zoom);

  L.tileLayer(CONFIG.TILE_URL, { maxZoom: 20, attribution: CONFIG.TILE_ATTRIB }).addTo(map);

  const fog = new FogLayer(cells).addTo(map);

  map.on('moveend', () => {
    const c = map.getCenter();
    DB.setMeta('lastView', { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  });

  // Marqueur de position + cercle de précision
  const accCircle = L.circle([0, 0], { radius: 0, weight: 1, color: '#3ddc97', fillOpacity: 0.08, interactive: false });
  const posMarker = L.circleMarker([0, 0], { radius: 7, weight: 2, color: '#0b0e14', fillColor: '#3ddc97', fillOpacity: 1, interactive: false });

  // --- UI ---

  const $ = id => document.getElementById(id);
  const statsEl = $('stats'), netDot = $('net-dot'), toast = $('toast');
  let follow = true;
  let firstFix = true;
  let toastTimer = null;

  function showToast(msg, ms = 3000) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), ms);
  }

  function updateStats() {
    // Aire approx. d'une cellule : (0.0005° ≈ 55,66 m) → ~0,0031 km²
    const km2 = cells.size * Math.pow(CONFIG.CELL_STEP * 111.32, 2);
    statsEl.textContent = cells.size.toLocaleString('fr-FR') + ' zones · ' +
      km2.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' km²';
  }

  function updateNetDot(state) {
    netDot.className = 'dot ' + (state || (navigator.onLine ? 'online' : 'offline'));
  }

  // --- Découverte ---

  async function onPosition(lat, lng, acc) {
    posMarker.setLatLng([lat, lng]);
    accCircle.setLatLng([lat, lng]).setRadius(acc);
    if (!map.hasLayer(posMarker)) { accCircle.addTo(map); posMarker.addTo(map); }

    if (firstFix) {
      firstFix = false;
      map.setView([lat, lng], Math.max(map.getZoom(), 16));
    } else if (follow) {
      map.panTo([lat, lng]);
    }

    const k = cellKey(lat, lng);
    if (!cells.has(k)) {
      cells.add(k);
      await DB.addCell(k, Date.now());
      fog.redraw();
      updateStats();
    }
  }

  function onGpsError(err) {
    showToast('GPS : ' + (err.message || 'erreur'), 5000);
    $('btn-gps').classList.remove('active');
  }

  // --- Sync ---

  async function autoSync(manual = false) {
    try {
      updateNetDot('syncing');
      const r = await Sync.syncNow();
      updateNetDot();
      if (r.pulledKeys && r.pulledKeys.length) {
        r.pulledKeys.forEach(k => cells.add(k));
        fog.redraw();
        updateStats();
      }
      if (manual) {
        if (r.noAccount) showToast('Crée un compte pour synchroniser');
        else if (r.offline) showToast('Hors-ligne — la sync reprendra au retour du réseau');
        else if (!r.skipped) showToast('Sync OK : +' + (r.pushed || 0) + ' envoyées, +' + (r.pulledKeys.length || 0) + ' reçues');
      }
      await refreshSyncInfo();
    } catch (e) {
      updateNetDot();
      if (manual) showToast('Sync impossible : ' + e.message, 5000);
    }
  }

  async function refreshSyncInfo() {
    const at = await DB.getMeta('lastSyncAt');
    $('sync-info').textContent = at
      ? 'Dernière sync : ' + new Date(at).toLocaleString('fr-FR')
      : 'Jamais synchronisé';
  }

  setInterval(autoSync, CONFIG.SYNC_INTERVAL_MS);
  window.addEventListener('online', () => { updateNetDot(); autoSync(); });
  window.addEventListener('offline', () => updateNetDot());

  // --- Boutons ---

  $('btn-follow').addEventListener('click', () => {
    follow = !follow;
    $('btn-follow').classList.toggle('active', follow);
    if (follow && posMarker.getLatLng().lat !== 0) map.panTo(posMarker.getLatLng());
  });
  map.on('dragstart', () => { // déplacer la carte à la main coupe le suivi
    follow = false;
    $('btn-follow').classList.remove('active');
  });

  $('btn-gps').addEventListener('click', () => {
    if (Tracker.active()) {
      Tracker.stop();
      $('btn-gps').classList.remove('active');
      showToast('GPS en pause');
    } else {
      Tracker.start(onPosition, onGpsError);
      $('btn-gps').classList.add('active');
      showToast('GPS actif');
    }
  });

  // --- Modal compte ---

  const modal = $('modal');

  async function refreshAccountUI() {
    const name = await Sync.username();
    $('account-logged').classList.toggle('hidden', !name);
    $('account-forms').classList.toggle('hidden', !!name);
    if (name) $('account-name').textContent = name;
    $('account-error').textContent = '';
    await refreshSyncInfo();
  }

  $('btn-account').addEventListener('click', async () => {
    await refreshAccountUI();
    modal.classList.remove('hidden');
  });
  $('btn-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

  async function doAuth(fn) {
    const user = $('in-user').value.trim();
    const pass = $('in-pass').value;
    try {
      await fn(user, pass);
      $('in-pass').value = '';
      await refreshAccountUI();
      showToast('Connecté — synchronisation…');
      await autoSync(true);
    } catch (e) {
      $('account-error').textContent = e.message;
    }
  }
  $('btn-register').addEventListener('click', () => doAuth(Sync.register));
  $('btn-login').addEventListener('click', () => doAuth(Sync.login));

  $('btn-logout').addEventListener('click', async () => {
    await Sync.logout();
    await refreshAccountUI();
    showToast('Déconnecté — la progression locale est conservée');
  });

  $('btn-sync-now').addEventListener('click', () => autoSync(true));

  // --- Démarrage ---

  updateStats();
  updateNetDot();

  const demo = new URLSearchParams(location.search).has('demo');
  if (demo) {
    // Mode démo (test sur PC, pas de GPS) : flèches du clavier pour "marcher"
    let dLat = lastView.lat, dLng = lastView.lng;
    showToast('Mode démo : déplace-toi avec les flèches du clavier', 6000);
    document.addEventListener('keydown', e => {
      const step = CONFIG.CELL_STEP * 0.8;
      if (e.key === 'ArrowUp') dLat += step;
      else if (e.key === 'ArrowDown') dLat -= step;
      else if (e.key === 'ArrowLeft') dLng -= step;
      else if (e.key === 'ArrowRight') dLng += step;
      else return;
      e.preventDefault();
      onPosition(dLat, dLng, 10);
    });
    onPosition(dLat, dLng, 10);
  } else {
    // Le GPS démarre tout de suite : c'est la raison d'être de l'app
    Tracker.start(onPosition, onGpsError);
    $('btn-gps').classList.add('active');
  }

  autoSync();

  // Service worker : utile en web (offline + cache tuiles). Dans l'app native,
  // les fichiers sont déjà embarqués dans l'APK — on ne l'enregistre pas.
  if ('serviceWorker' in navigator && !Tracker.isNative) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* http non sécurisé : tant pis */ });
  }
})();
