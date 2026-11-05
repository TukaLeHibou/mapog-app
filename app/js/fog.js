// Couche "Fog of War" : un canvas recouvre toute la carte, et on perce
// un trou (dégradé radial) au-dessus de chaque cellule déjà visitée.
const FogLayer = L.Layer.extend({

  initialize(cells) {
    this._cells = cells; // Set de clés "latIdx_lngIdx"
    this._raf = null;
  },

  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'fog-canvas');
    this._ctx = this._canvas.getContext('2d');
    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on('move zoom viewreset resize', this._scheduleRedraw, this);
    this._scheduleRedraw();
    return this;
  },

  onRemove(map) {
    map.off('move zoom viewreset resize', this._scheduleRedraw, this);
    L.DomUtil.remove(this._canvas);
  },

  redraw() { this._scheduleRedraw(); },

  // Au plus un rendu par frame, même pendant un drag rapide
  _scheduleRedraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
  },

  _draw() {
    const map = this._map;
    if (!map) return;

    const size = map.getSize();
    // Le canvas suit la fenêtre : son origine = coin haut-gauche du conteneur
    L.DomUtil.setPosition(this._canvas, map.containerPointToLayerPoint([0, 0]));
    if (this._canvas.width !== size.x) this._canvas.width = size.x;
    if (this._canvas.height !== size.y) this._canvas.height = size.y;

    const ctx = this._ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, size.x, size.y);
    ctx.fillStyle = CONFIG.FOG_COLOR;
    ctx.fillRect(0, 0, size.x, size.y);

    // Rayon révélé en pixels, selon le zoom et la latitude
    const lat = map.getCenter().lat;
    const metersPerPx = 40075016.686 * Math.abs(Math.cos(lat * Math.PI / 180)) / (256 * Math.pow(2, map.getZoom()));
    const r = Math.max(2.5, CONFIG.REVEAL_RADIUS_M / metersPerPx);
    const softEdges = r >= 6; // dégradés inutiles (et coûteux) quand on est dézoomé

    const bounds = map.getBounds().pad(0.05);
    ctx.globalCompositeOperation = 'destination-out';
    if (!softEdges) ctx.fillStyle = 'rgba(0,0,0,0.9)';

    for (const key of this._cells) {
      const sep = key.indexOf('_', 1); // le 1er caractère peut être un '-'
      const cLat = Number(key.slice(0, sep)) * CONFIG.CELL_STEP;
      const cLng = Number(key.slice(sep + 1)) * CONFIG.CELL_STEP;
      if (!bounds.contains([cLat, cLng])) continue;

      const p = map.latLngToContainerPoint([cLat, cLng]);
      if (softEdges) {
        const g = ctx.createRadialGradient(p.x, p.y, r * 0.55, p.x, p.y, r);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
});
