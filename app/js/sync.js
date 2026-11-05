// Synchronisation avec le serveur (api.php).
// La progression est un ensemble qui ne fait que grandir : la fusion
// local/serveur est une simple union — aucun conflit possible, même après
// des semaines hors-ligne. On pousse nos cellules non-synchronisées, puis
// on récupère celles que le serveur a en plus (autre appareil, restauration…).
const Sync = (() => {
  let syncing = false;

  async function api(action, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(CONFIG.API_URL + '?action=' + action, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Erreur HTTP ' + res.status));
    return data;
  }

  async function register(username, password) {
    const data = await api('register', { username, password });
    await DB.setMeta('token', data.token);
    await DB.setMeta('username', data.username);
    await DB.setMeta('lastPull', 0);
    await DB.resetSynced(); // tout pousser vers ce compte tout neuf
    return data;
  }

  async function login(username, password) {
    const data = await api('login', { username, password });
    await DB.setMeta('token', data.token);
    await DB.setMeta('username', data.username);
    await DB.setMeta('lastPull', 0);  // re-pull complet (nouvel appareil ou autre compte)
    await DB.resetSynced();           // re-push complet — le serveur déduplique
    return data;
  }

  async function logout() {
    // La progression locale reste : seul le lien avec le compte est coupé
    await DB.delMeta('token');
    await DB.delMeta('username');
    await DB.delMeta('lastPull');
  }

  async function username() { return DB.getMeta('username'); }
  async function hasAccount() { return (await DB.getMeta('token')) !== null; }

  // Retourne { pushed, pulledKeys } ou { offline|noAccount|skipped: true }
  async function syncNow() {
    if (syncing) return { skipped: true };
    const token = await DB.getMeta('token');
    if (!token) return { noAccount: true };
    if (!navigator.onLine) return { offline: true };

    syncing = true;
    try {
      // 1. Push : tout ce qui a été découvert depuis la dernière sync
      let pushed = 0;
      for (;;) {
        const batch = await DB.unsynced(CONFIG.PUSH_BATCH);
        if (!batch.length) break;
        await api('push', { cells: batch.map(c => [c.k, c.t]) }, token);
        await DB.markSynced(batch);
        pushed += batch.length;
        if (batch.length < CONFIG.PUSH_BATCH) break;
      }

      // 2. Pull : ce que le serveur a reçu d'ailleurs depuis notre dernier pull
      const pulledKeys = [];
      for (;;) {
        const since = (await DB.getMeta('lastPull')) || 0;
        const data = await api('pull', { since }, token);
        if (data.cells.length) {
          await DB.putCells(data.cells.map(([k, t]) => ({ k, t, synced: 1 })));
          data.cells.forEach(([k]) => pulledKeys.push(k));
        }
        await DB.setMeta('lastPull', data.since);
        if (!data.more) break;
      }

      await DB.setMeta('lastSyncAt', Date.now());
      return { pushed, pulledKeys };
    } finally {
      syncing = false;
    }
  }

  return { register, login, logout, username, hasAccount, syncNow };
})();
