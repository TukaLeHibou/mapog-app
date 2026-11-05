// Stockage local (IndexedDB) : cellules découvertes + métadonnées (token, dernière sync…)
// Tout vit d'abord ici — le serveur n'est qu'une sauvegarde.
const DB = (() => {
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('mapog', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const cells = db.createObjectStore('cells', { keyPath: 'k' });
        cells.createIndex('synced', 'synced');
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => { _db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  function _store(name, mode = 'readonly') {
    return _db.transaction(name, mode).objectStore(name);
  }

  function _p(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Cellules ---

  function addCell(k, t) {
    return _p(_store('cells', 'readwrite').put({ k, t, synced: 0 }));
  }

  // Écrit un lot de cellules en une seule transaction
  function putCells(cells) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction('cells', 'readwrite');
      const store = tx.objectStore('cells');
      cells.forEach(c => store.put(c));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function allCellKeys() {
    return _p(_store('cells').getAllKeys());
  }

  function unsynced(limit) {
    return _p(_store('cells').index('synced').getAll(0, limit));
  }

  function markSynced(cells) {
    return putCells(cells.map(c => ({ k: c.k, t: c.t, synced: 1 })));
  }

  // Remet tout "à pousser" — utilisé à la connexion pour garantir que le
  // compte reçoit bien TOUTE la progression locale (le serveur déduplique)
  async function resetSynced() {
    const all = await _p(_store('cells').getAll());
    return putCells(all.map(c => ({ k: c.k, t: c.t, synced: 0 })));
  }

  function countCells() {
    return _p(_store('cells').count());
  }

  // --- Métadonnées (clé/valeur) ---

  async function getMeta(key) {
    const row = await _p(_store('meta').get(key));
    return row ? row.value : null;
  }

  function setMeta(key, value) {
    return _p(_store('meta', 'readwrite').put({ key, value }));
  }

  function delMeta(key) {
    return _p(_store('meta', 'readwrite').delete(key));
  }

  return { open, addCell, putCells, allCellKeys, unsynced, markSynced, resetSynced, countCells, getMeta, setMeta, delMeta };
})();
