/* ================= PWA ================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ================= map ================= */
const map = new maplibregl.Map({
  container: 'map',
  center: [106.8272, -6.1754], // Jakarta
  zoom: 12,
  attributionControl: { compact: true },
  style: {
    version: 8,
    sources: {
      cyclosm: {
        type: 'raster',
        tiles: [
          'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
          'https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
          'https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Style: <a href="https://www.cyclosm.org">CyclOSM</a>'
      }
    },
    layers: [{ id: 'cyclosm', type: 'raster', source: 'cyclosm' }]
  }
});
// top-left biar gak numpuk sama .actions (fab GPX/export/undo/clear) yang di kanan
map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-left');
map.addControl(new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true }, trackUserLocation: true
}), 'top-left');

// topbar bisa wrap 2 baris di mobile (search box) — geser kontrol top-left biar gak ketutupan
function clampTopLeftControls() {
  const ctrl = document.querySelector('.maplibregl-ctrl-top-left');
  const topbar = document.querySelector('.topbar');
  if (ctrl && topbar) ctrl.style.marginTop = (topbar.offsetHeight + 6) + 'px';
}
new ResizeObserver(clampTopLeftControls).observe(document.querySelector('.topbar'));
window.addEventListener('load', clampTopLeftControls);
window.addEventListener('resize', clampTopLeftControls);
map.on('load', clampTopLeftControls);

/* ================= state ================= */
let waypoints = [];        // [{lng, lat, marker}]
let profile = 'gravel';
let routing = false;
let routeQueued = false;
let routeCoords = [];      // koordinat rute aktif [[lon,lat,ele], ...] untuk chart & export
let routeSourceName = null; // 'route' | 'gpx' — sumber data chart aktif

const $ = id => document.getElementById(id);
const statusEl = $('status');
let statusTimer;
function toast(msg, isErr = false, sticky = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', isErr);
  statusEl.classList.add('show');
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => statusEl.classList.remove('show'), 3500);
}
function hideToast() { statusEl.classList.remove('show'); }

/* ================= layers ================= */
map.on('load', () => {
  map.addSource('route', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route',
    paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': .9 },
    layout: { 'line-cap': 'round', 'line-join': 'round' }
  });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route',
    paint: { 'line-color': '#e0007a', 'line-width': 4.5 },
    layout: { 'line-cap': 'round', 'line-join': 'round' }
  });

  map.addSource('gpx', { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: 'gpx-casing', type: 'line', source: 'gpx',
    paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': .85 },
    layout: { 'line-cap': 'round', 'line-join': 'round' }
  });
  map.addLayer({
    id: 'gpx-line', type: 'line', source: 'gpx',
    paint: { 'line-color': '#0f7bff', 'line-width': 4, 'line-dasharray': [2.2, 1.4] },
    layout: { 'line-cap': 'round', 'line-join': 'round' }
  });

  restoreState();
});

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

/* ================= riwayat rute (localStorage) ================= */
const SAVE_KEY = 'gowes-route-v1';
let saveTimer;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!waypoints.length) { localStorage.removeItem(SAVE_KEY); return; }
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        profile, points: waypoints.map(w => [w.lng, w.lat])
      }));
    } catch (err) { console.error(err); }
  }, 300);
}
function restoreState() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return; }
  if (!saved?.points?.length) return;
  if (saved.profile) {
    profile = saved.profile;
    document.querySelectorAll('.profile-picker button').forEach(b => b.classList.toggle('active', b.dataset.profile === profile));
  }
  saved.points.forEach(([lng, lat]) => addWaypoint(lng, lat, false));
  if (waypoints.length) map.setCenter([waypoints[0].lng, waypoints[0].lat]);
  requestRoute();
}

/* ================= waypoints ================= */
map.on('click', e => { if (!navMode) addWaypoint(e.lngLat.lng, e.lngLat.lat); });

function addWaypoint(lng, lat, autoRoute = true) {
  const el = document.createElement('div');
  el.className = 'wp';
  const marker = new maplibregl.Marker({ element: el, draggable: true })
    .setLngLat([lng, lat]).addTo(map);
  const wp = { lng, lat, marker };
  marker.on('dragend', () => {
    const p = marker.getLngLat();
    wp.lng = p.lng; wp.lat = p.lat;
    requestRoute();
    saveState();
  });
  waypoints.push(wp);
  relabelMarkers();
  if (autoRoute) requestRoute();
  saveState();
}

function relabelMarkers() {
  waypoints.forEach((wp, i) => {
    const el = wp.marker.getElement();
    el.classList.remove('start', 'end');
    if (i === 0) { el.classList.add('start'); el.textContent = 'S'; }
    else if (i === waypoints.length - 1 && waypoints.length > 1) { el.classList.add('end'); el.textContent = 'F'; }
    else el.textContent = i;
  });
  $('statWp').textContent = waypoints.length;
}

$('btnUndo').addEventListener('click', () => {
  const wp = waypoints.pop();
  if (wp) wp.marker.remove();
  relabelMarkers();
  requestRoute();
  saveState();
});

$('btnClear').addEventListener('click', () => {
  waypoints.forEach(w => w.marker.remove());
  waypoints = [];
  relabelMarkers();
  map.getSource('route') && map.getSource('route').setData(emptyFC());
  map.getSource('gpx') && map.getSource('gpx').setData(emptyFC());
  setRouteData([], null);
  setStats(0, 0);
  hideToast();
  saveState();
});

/* ================= search location ================= */
const searchInput = $('searchInput');
const searchResults = $('searchResults');
let searchTimer, searchAbort;
const searchCache = new Map(); // ponytail: in-memory aja, no size cap — query nominatim jarang banyak dalam 1 sesi

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 3) { searchResults.classList.remove('show'); return; }
  searchTimer = setTimeout(() => runSearch(q), 400);
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-box')) searchResults.classList.remove('show');
});

async function runSearch(q) {
  const key = q.toLowerCase();
  if (searchCache.has(key)) { renderSearchResults(searchCache.get(key)); return; }
  searchAbort?.abort();
  searchAbort = new AbortController();
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal: searchAbort.signal, headers: { 'Accept-Language': 'id' } });
    const list = await res.json();
    searchCache.set(key, list);
    renderSearchResults(list);
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
  }
}

function renderSearchResults(list) {
  searchResults.innerHTML = '';
  if (!list.length) {
    searchResults.innerHTML = '<div class="empty">Tidak ditemukan</div>';
  } else {
    list.forEach(item => {
      const btn = document.createElement('button');
      btn.textContent = item.display_name;
      btn.addEventListener('click', () => selectSearchResult(item));
      searchResults.appendChild(btn);
    });
  }
  searchResults.classList.add('show');
}

function selectSearchResult(item) {
  const lng = parseFloat(item.lon), lat = parseFloat(item.lat);
  searchResults.classList.remove('show');
  searchInput.value = '';
  map.flyTo({ center: [lng, lat], zoom: 15, duration: 800 });
}

/* ================= profile ================= */
document.querySelectorAll('.profile-picker button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.profile-picker button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    profile = btn.dataset.profile;
    requestRoute();
    saveState();
  });
});

/* ================= routing (BRouter) ================= */
async function requestRoute() {
  if (waypoints.length < 2) {
    map.getSource('route') && map.getSource('route').setData(emptyFC());
    if (routeSourceName === 'route') setRouteData([], null);
    if (waypoints.length === 0 && routeSourceName === null) setStats(0, 0);
    return;
  }
  if (routing) { routeQueued = true; return; }
  routing = true;
  toast('Menghitung rute…', false, true);

  const lonlats = waypoints.map(w => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join('|');
  const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    const gj = await res.json();
    map.getSource('route').setData(gj);

    const feat = gj.features?.[0];
    const props = feat?.properties || {};
    const distKm = (parseFloat(props['track-length'] || 0) / 1000);
    const ascend = parseInt(props['filtered ascend'] || props['plain-ascend'] || 0, 10);
    setStats(distKm, ascend);
    setRouteData(feat?.geometry?.coordinates || [], 'route');
    hideToast();
  } catch (err) {
    console.error(err);
    const msg = /island/i.test(err.message)
      ? 'Titik tidak terhubung ke jalur ' + profile.toUpperCase() + ' — coba geser ke jalur/trek yang lebih ramai'
      : 'Rute gagal — coba geser titik lebih dekat ke jalan';
    toast(msg, true);
  } finally {
    routing = false;
    if (routeQueued) { routeQueued = false; requestRoute(); }
  }
}

function setStats(distKm, ascend) {
  $('statDist').innerHTML = (distKm >= 100 ? distKm.toFixed(0) : distKm.toFixed(1)) + '<small>km</small>';
  $('statAsc').innerHTML = Math.max(0, Math.round(ascend)) + '<small>m</small>';
  updateEstimate(distKm, Math.max(0, ascend));
}

// ponytail: rough estimate, gak pake berat badan user — upgrade kalau mau akurat (tambah input berat)
const PROFILE_SPEED_KMH = { fastbike: 22, gravel: 16, mtb: 13, trekking: 15, safety: 14 };
function updateEstimate(distKm, ascendM) {
  const el = $('estLine');
  if (!distKm) { el.textContent = ''; return; }
  const speed = PROFILE_SPEED_KMH[profile] || 15;
  const hours = distKm / speed + ascendM / 300 / 3; // +1 jam tiap 900m ascend (Naismith-ish, disesuaikan buat sepeda)
  const mins = Math.round(hours * 60);
  const timeText = mins >= 60 ? `${Math.floor(mins / 60)}j ${mins % 60}m` : `${mins} menit`;
  const cal = Math.round(distKm * 30 + ascendM * 0.7);
  el.innerHTML = `Estimasi <b>${timeText}</b> · <b>${cal}</b> kkal`;
}

/* ================= route data → chart + export ================= */
function setRouteData(coords, sourceName) {
  routeCoords = coords;
  routeSourceName = coords.length ? sourceName : null;
  $('btnExport').disabled = !(routeSourceName === 'route' && coords.length > 1);
  $('btnNav').disabled = coords.length < 2;
  buildElevSeries();
  drawChart();
}

/* ================= elevation chart ================= */
let elevSeries = [];   // [{d: meter kumulatif, e: elevasi, lon, lat}]
let elevMarker = null;

$('chartToggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('chart-open');
  $('chartToggle').setAttribute('aria-expanded', open);
  if (open) requestAnimationFrame(drawChart);
});

function buildElevSeries() {
  elevSeries = [];
  let d = 0, prev = null;
  for (const c of routeCoords) {
    if (prev) d += haversine(prev, c);
    if (c.length > 2 && isFinite(c[2])) {
      elevSeries.push({ d, e: c[2], lon: c[0], lat: c[1] });
    }
    prev = c;
  }
  if (elevSeries.length < 2) elevSeries = [];
}

function drawChart() {
  const canvas = $('elevChart');
  const wrap = canvas.parentElement;
  const cssW = wrap.clientWidth || 320;
  const cssH = 110;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const empty = $('chartEmpty');
  if (!elevSeries.length) { empty.style.display = 'grid'; return; }
  empty.style.display = 'none';

  const padL = 34, padR = 6, padT = 8, padB = 16;
  const W = cssW - padL - padR, H = cssH - padT - padB;
  const maxD = elevSeries[elevSeries.length - 1].d;
  let minE = Infinity, maxE = -Infinity;
  for (const p of elevSeries) { if (p.e < minE) minE = p.e; if (p.e > maxE) maxE = p.e; }
  if (maxE - minE < 20) { const mid = (maxE + minE) / 2; minE = mid - 10; maxE = mid + 10; }

  const x = d => padL + (d / maxD) * W;
  const y = e => padT + (1 - (e - minE) / (maxE - minE)) * H;

  // grid + label elevasi
  ctx.font = '10px Barlow, sans-serif';
  ctx.fillStyle = '#9aa0ab';
  ctx.strokeStyle = '#33373f';
  ctx.lineWidth = 1;
  [minE, (minE + maxE) / 2, maxE].forEach(e => {
    const yy = y(e);
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(cssW - padR, yy); ctx.stroke();
    ctx.fillText(Math.round(e) + 'm', 2, yy + 3);
  });
  // label jarak
  ctx.textAlign = 'center';
  [0, .5, 1].forEach(f => {
    ctx.fillText((maxD * f / 1000).toFixed(1) + 'km', x(maxD * f), cssH - 4);
  });
  ctx.textAlign = 'left';

  // area
  const grad = ctx.createLinearGradient(0, padT, 0, padT + H);
  grad.addColorStop(0, 'rgba(215,251,62,.35)');
  grad.addColorStop(1, 'rgba(215,251,62,.02)');
  ctx.beginPath();
  ctx.moveTo(x(elevSeries[0].d), y(elevSeries[0].e));
  for (const p of elevSeries) ctx.lineTo(x(p.d), y(p.e));
  ctx.lineTo(x(maxD), padT + H); ctx.lineTo(padL, padT + H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // garis
  ctx.beginPath();
  ctx.moveTo(x(elevSeries[0].d), y(elevSeries[0].e));
  for (const p of elevSeries) ctx.lineTo(x(p.d), y(p.e));
  ctx.strokeStyle = '#d7fb3e'; ctx.lineWidth = 2; ctx.stroke();

  canvas._geom = { padL, padR, W, maxD };
}

/* chart interaktif: sentuh → titik di peta */
const chartCanvas = $('elevChart');
function chartPointer(ev) {
  if (!elevSeries.length || !chartCanvas._geom) return;
  const rect = chartCanvas.getBoundingClientRect();
  const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
  const { padL, W, maxD } = chartCanvas._geom;
  const d = Math.min(Math.max((px - padL) / W, 0), 1) * maxD;

  // cari titik terdekat (elevSeries terurut by d → binary-ish scan sederhana)
  let best = elevSeries[0];
  for (const p of elevSeries) { if (Math.abs(p.d - d) < Math.abs(best.d - d)) best = p; else if (p.d > d) break; }

  if (!elevMarker) {
    const el = document.createElement('div');
    el.className = 'elev-dot';
    elevMarker = new maplibregl.Marker({ element: el }).setLngLat([best.lon, best.lat]).addTo(map);
  } else {
    elevMarker.setLngLat([best.lon, best.lat]);
  }
  const ro = $('chartReadout');
  ro.textContent = (best.d / 1000).toFixed(1) + ' km · ' + Math.round(best.e) + ' m';
  ro.style.display = 'block';
}
function chartPointerEnd() {
  if (elevMarker) { elevMarker.remove(); elevMarker = null; }
  $('chartReadout').style.display = 'none';
}
chartCanvas.addEventListener('pointerdown', e => { chartCanvas.setPointerCapture(e.pointerId); chartPointer(e); });
chartCanvas.addEventListener('pointermove', e => { if (e.pressure > 0 || e.pointerType === 'mouse' && e.buttons === 0) chartPointer(e); });
chartCanvas.addEventListener('pointerup', chartPointerEnd);
chartCanvas.addEventListener('pointerleave', chartPointerEnd);
window.addEventListener('resize', () => { if (document.body.classList.contains('chart-open')) drawChart(); });

/* ================= export GPX ================= */
$('btnExport').addEventListener('click', () => {
  if (!routeCoords.length) return;
  const esc = s => String(s);
  const now = new Date().toISOString();
  let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="Gowes" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `  <metadata><name>Rute Gowes</name><time>${now}</time></metadata>\n` +
    '  <trk><name>Rute Gowes</name><trkseg>\n';
  for (const c of routeCoords) {
    gpx += `    <trkpt lat="${esc(c[1].toFixed(6))}" lon="${esc(c[0].toFixed(6))}">`;
    if (c.length > 2 && isFinite(c[2])) gpx += `<ele>${esc(Math.round(c[2] * 10) / 10)}</ele>`;
    gpx += '</trkpt>\n';
  }
  gpx += '  </trkseg></trk>\n</gpx>\n';

  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rute-gowes-' + new Date().toISOString().slice(0, 10) + '.gpx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Rute tersimpan sebagai GPX');
});

/* ================= GPX import ================= */
$('btnGpx').addEventListener('click', () => $('gpxInput').click());
$('gpxInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadGpx(reader.result, file.name);
  reader.readAsText(file);
  e.target.value = '';
});

function readGpxPts(parent, sel) {
  const coords = [];
  let dist = 0, ascend = 0, prev = null, prevEle = null;
  parent.querySelectorAll(sel).forEach(pt => {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    if (isNaN(lat) || isNaN(lon)) return;
    const eleEl = pt.querySelector('ele');
    const ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
    coords.push(isFinite(ele) ? [lon, lat, ele] : [lon, lat]);
    if (prev) dist += haversine(prev, [lon, lat]);
    if (isFinite(ele)) {
      if (prevEle !== null && ele > prevEle) ascend += ele - prevEle;
      prevEle = ele;
    }
    prev = [lon, lat];
  });
  return { coords, dist, ascend };
}

async function loadGpx(xmlText, name) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('parse');
  } catch { toast('File GPX tidak valid', true); return; }

  const lines = [];
  doc.querySelectorAll('trk').forEach((trk, i) => {
    const trkName = trk.querySelector('name')?.textContent?.trim() || `Track ${i + 1}`;
    const coords = [];
    let dist = 0, ascend = 0;
    trk.querySelectorAll('trkseg').forEach(seg => {
      const r = readGpxPts(seg, 'trkpt');
      if (r.coords.length > 1) { coords.push(...r.coords); dist += r.dist; ascend += r.ascend; }
    });
    if (coords.length > 1) lines.push({ name: trkName, coords, dist, ascend });
  });
  doc.querySelectorAll('rte').forEach((rte, i) => {
    const rteName = rte.querySelector('name')?.textContent?.trim() || `Rute ${i + 1}`;
    const r = readGpxPts(rte, 'rtept');
    if (r.coords.length > 1) lines.push({ name: rteName, ...r });
  });

  if (!lines.length) { toast('Tidak ada track di file GPX ini', true); return; }

  const fc = {
    type: 'FeatureCollection',
    features: lines.map(l => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: l.coords }, properties: {} }))
  };
  map.getSource('gpx').setData(fc);

  const bounds = new maplibregl.LngLatBounds();
  lines.forEach(l => l.coords.forEach(c => bounds.extend([c[0], c[1]])));
  map.fitBounds(bounds, { padding: 60, duration: 800 });

  const active = lines.length > 1 ? await pickGpxTrack(lines) : lines[0];

  // kalau belum ada rute buatan sendiri → GPX jadi sumber stats & chart
  if (waypoints.length < 2) {
    setStats(active.dist / 1000, active.ascend);
    setRouteData(active.coords, 'gpx');
    $('btnExport').disabled = true; // export hanya untuk rute buatan sendiri
  }
  toast(`GPX dimuat: ${name}${lines.length > 1 ? ' — ' + active.name : ''}`);
}

function pickGpxTrack(lines) {
  return new Promise(resolve => {
    const panel = $('gpxPicker');
    const list = $('gpxPickerList');
    list.innerHTML = '';
    lines.forEach(line => {
      const btn = document.createElement('button');
      btn.textContent = `${line.name} — ${(line.dist / 1000).toFixed(1)} km`;
      btn.addEventListener('click', () => { panel.classList.remove('show'); resolve(line); });
      list.appendChild(btn);
    });
    panel.classList.add('show');
  });
}

/* ================= navigation mode (gmaps-style follow) ================= */
let navMode = false;
let navWatchId = null;
let wakeLock = null;
let followMode = true;
let puckMarker = null;
let lastNavPos = null;
let lastBearing = 0;
let offRouteSince = null;
let navRecalculating = false;
let maneuverData = { cum: [], total: 0, maneuvers: [] };
let maneuverPtr = 0;
let compassHeading = null;
let orientationHandler = null;

$('btnNav').addEventListener('click', startNavigation);
$('btnNavExit').addEventListener('click', stopNavigation);
$('btnRecenter').addEventListener('click', () => {
  followMode = true;
  $('btnRecenter').classList.remove('show');
  if (lastNavPos) map.easeTo({ center: lastNavPos, bearing: map.getBearing(), duration: 400 });
});
// dragstart cuma nembak dari pan manual user, bukan dari easeTo/flyTo programatik
map.on('dragstart', () => {
  if (navMode && followMode) { followMode = false; $('btnRecenter').classList.add('show'); }
});

function startNavigation() {
  if (routeCoords.length < 2) return;
  if (!navigator.geolocation) { toast('Geolocation tidak didukung di device ini', true); return; }
  navMode = true;
  followMode = true;
  lastBearing = map.getBearing();
  $('btnRecenter').classList.remove('show');
  maneuverData = buildManeuvers(routeCoords);
  maneuverPtr = 0;
  document.body.classList.add('nav-mode');
  map.easeTo({ pitch: 0, zoom: 17, duration: 600 });
  navWatchId = navigator.geolocation.watchPosition(onNavPosition, onNavError, {
    enableHighAccuracy: true, maximumAge: 5000, timeout: 30000
  });
  requestWakeLock();
  initCompass();
}

// kompas device (magnetometer) — kaya gmaps, biar puck tetep nunjuk arah pas hp diem/pelan.
// GPS course cuma akurat pas gerak; compass isi kekosongan pas diem.
function initCompass() {
  compassHeading = null;
  orientationHandler = e => {
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number') {
      heading = e.webkitCompassHeading; // iOS Safari — udah 0=utara searah jarum jam
    } else if (e.absolute && typeof e.alpha === 'number') {
      heading = (360 - e.alpha) % 360; // Android deviceorientationabsolute — alpha muter CCW, dibalik
    }
    if (heading != null && isFinite(heading)) compassHeading = heading;
  };
  // ponytail: no UI prompt "putar angka 8" ala gmaps, browser compass biasanya udah auto-calibrated
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(state => {
      if (state === 'granted') attachOrientation();
    }).catch(() => {});
  } else {
    attachOrientation();
  }
}
function attachOrientation() {
  window.addEventListener('deviceorientationabsolute', orientationHandler, true);
  window.addEventListener('deviceorientation', orientationHandler, true);
}
function detachOrientation() {
  if (!orientationHandler) return;
  window.removeEventListener('deviceorientationabsolute', orientationHandler, true);
  window.removeEventListener('deviceorientation', orientationHandler, true);
  orientationHandler = null;
  compassHeading = null;
}

// ponytail: no fallback buat browser tanpa wakeLock API — layar mati ya mati, gak fatal
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) { console.error(err); }
}
document.addEventListener('visibilitychange', () => {
  if (navMode && document.visibilityState === 'visible') requestWakeLock();
});

function stopNavigation() {
  navMode = false;
  document.body.classList.remove('nav-mode');
  if (navWatchId != null) navigator.geolocation.clearWatch(navWatchId);
  navWatchId = null;
  if (puckMarker) { puckMarker.remove(); puckMarker = null; }
  map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  lastNavPos = null;
  offRouteSince = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  detachOrientation();
}

let lastNavErrToast = 0;
function onNavError(err) {
  console.error(err);
  // ponytail: watchPosition auto-retry sendiri, timeout code 3 sering muncul pas cold-start GPS — jangan spam toast
  if (err.code === 3 && lastNavPos) return;
  if (Date.now() - lastNavErrToast < 8000) return;
  lastNavErrToast = Date.now();
  toast(err.code === 3 ? 'Mencari sinyal GPS…' : 'Sinyal GPS hilang — cek izin lokasi', true);
}

function onNavPosition(pos) {
  const { longitude: lng, latitude: lat, heading, speed } = pos.coords;
  // ponytail: GPS heading/posisi noise beberapa meter pas diem/pelan bikin bearing acak — pertahanin arah terakhir
  // kecuali gerakan cukup jauh (>5m) atau device kasih heading valid pas speed lumayan
  const moved = lastNavPos ? haversine(lastNavPos, [lng, lat]) : Infinity;
  let bearing = lastBearing;
  if (typeof heading === 'number' && isFinite(heading) && speed > 1) {
    bearing = heading; // GPS course — paling akurat pas beneran gerak
  } else if (compassHeading != null) {
    bearing = compassHeading; // kompas device — akurat pas diem/pelan, kaya gmaps
  } else if (moved > 5) {
    bearing = lastNavPos ? bearingBetween(lastNavPos, [lng, lat]) : bearing;
  }
  lastBearing = bearing;
  lastNavPos = [lng, lat];

  updatePuck(lng, lat, bearing);
  if (followMode) map.easeTo({ center: [lng, lat], bearing, duration: 500 });

  const idx = nearestRouteIndex(routeCoords, lng, lat);
  const distToRoute = haversine([lng, lat], routeCoords[idx]);
  const remaining = remainingDistance(routeCoords, idx);
  updateNavReadout(remaining, speed);
  updateManeuver(maneuverData.cum[idx] ?? 0);

  if (remaining < 20) {
    toast('Sampai tujuan 🎉');
    stopNavigation();
    return;
  }

  // ponytail: off-route = jarak ke rute >40m selama >5dtk, ambang tetap tanpa tuning per-profile
  if (distToRoute > 40) {
    if (!offRouteSince) offRouteSince = Date.now();
    else if (Date.now() - offRouteSince > 5000) { offRouteSince = null; recalcFromPosition(lng, lat); }
  } else {
    offRouteSince = null;
  }
}

function updateNavReadout(remainingM, speedMs) {
  const km = remainingM / 1000;
  $('navDist').innerHTML = (km >= 10 ? km.toFixed(0) : km.toFixed(1)) + '<small>km</small>';
  const v = (speedMs && speedMs > 1) ? speedMs : 4.2; // fallback ~15km/h kalau GPS speed belum ada
  $('navEta').textContent = Math.max(1, Math.round(remainingM / v / 60)) + ' menit';
}

async function recalcFromPosition(lng, lat) {
  if (navRecalculating || !waypoints.length) return;
  navRecalculating = true;
  toast('Menghitung ulang rute…', false, true);
  const dest = waypoints[waypoints.length - 1];
  const lonlats = `${lng.toFixed(6)},${lat.toFixed(6)}|${dest.lng.toFixed(6)},${dest.lat.toFixed(6)}`;
  const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    const gj = await res.json();
    map.getSource('route').setData(gj);
    routeCoords = gj.features?.[0]?.geometry?.coordinates || routeCoords;
    maneuverData = buildManeuvers(routeCoords);
    maneuverPtr = 0;
    hideToast();
  } catch (err) {
    console.error(err);
    toast('Gagal hitung ulang rute, lanjut pakai rute lama', true);
  } finally {
    navRecalculating = false;
  }
}

function updatePuck(lng, lat, bearing) {
  if (!puckMarker) {
    const el = document.createElement('div');
    el.className = 'puck';
    el.innerHTML = '<div class="puck-arrow"></div>';
    puckMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat([lng, lat]).addTo(map);
  } else {
    puckMarker.setLngLat([lng, lat]);
  }
  puckMarker.setRotation(bearing);
}

/* ---- deteksi belokan dari geometri rute (bukan nama jalan — brouter publik gak expose itu) ---- */
function signedAngleDiff(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
function turnLabel(diff) {
  const a = Math.abs(diff);
  if (a < 25) return null;
  const dir = diff > 0 ? 'kanan' : 'kiri';
  if (a >= 150) return { text: 'Putar balik', dir: 'uturn' };
  if (a >= 100) return { text: `Belok tajam ke ${dir}`, dir };
  if (a >= 45) return { text: `Belok ${dir}`, dir };
  return { text: `Belok sedikit ke ${dir}`, dir };
}
function buildManeuvers(coords) {
  const n = coords.length;
  if (n < 3) return { cum: coords.map(() => 0), total: 0, maneuvers: [] };
  const cum = new Array(n).fill(0);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + haversine(coords[i - 1], coords[i]);
  const WINDOW = 18; // meter — smoothing biar noise titik GPX/route gak jadi "belokan" palsu
  const raw = [];
  let back = 0, fwd = 0;
  for (let i = 0; i < n; i++) {
    while (back < i - 1 && cum[i] - cum[back] > WINDOW) back++;
    if (fwd < i) fwd = i;
    while (fwd < n - 1 && cum[fwd] - cum[i] < WINDOW) fwd++;
    if (back === i || fwd === i) continue;
    const diff = signedAngleDiff(bearingBetween(coords[back], coords[i]), bearingBetween(coords[i], coords[fwd]));
    if (Math.abs(diff) >= 25) raw.push({ i, d: cum[i], diff });
  }
  const merged = [];
  for (const c of raw) {
    const last = merged[merged.length - 1];
    if (last && c.d - last.d < 25) { if (Math.abs(c.diff) > Math.abs(last.diff)) merged[merged.length - 1] = c; }
    else merged.push(c);
  }
  const maneuvers = merged
    .map(c => ({ distFromStart: c.d, turn: turnLabel(c.diff) }))
    .filter(m => m.turn);
  return { cum, total: cum[n - 1], maneuvers };
}

function formatNavDist(m) {
  if (m < 30) return 'Sekarang';
  if (m < 1000) return Math.round(m / 10) * 10 + ' m';
  return (m / 1000).toFixed(1) + ' km';
}

function updateManeuver(userDist) {
  while (maneuverPtr < maneuverData.maneuvers.length && maneuverData.maneuvers[maneuverPtr].distFromStart < userDist - 15) maneuverPtr++;
  const next = maneuverData.maneuvers[maneuverPtr];
  const arrow = $('navArrow');
  arrow.className = 'nav-arrow';
  if (!next) {
    $('navInstDist').textContent = '';
    $('navInstLabel').textContent = 'Lurus menuju tujuan';
    return;
  }
  const distTo = Math.max(0, next.distFromStart - userDist);
  arrow.classList.add('dir-' + next.turn.dir);
  $('navInstDist').textContent = formatNavDist(distTo);
  $('navInstLabel').textContent = next.turn.text;
}

function nearestRouteIndex(coords, lng, lat) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversine([lng, lat], coords[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
function remainingDistance(coords, fromIndex) {
  let d = 0;
  for (let i = fromIndex; i < coords.length - 1; i++) d += haversine(coords[i], coords[i + 1]);
  return d;
}
function bearingBetween(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// ponytail: self-check util murni, jalan sekali di load, bukan test framework
(function navSelfCheck() {
  const sq = [[0, 0], [0, 0.001], [0.001, 0.001], [0.001, 0]];
  console.assert(nearestRouteIndex(sq, 0.0011, 0.0009) === 2, 'nav: nearestRouteIndex salah');
  console.assert(remainingDistance(sq, 0) > 0, 'nav: remainingDistance salah');
  console.assert(Math.abs(bearingBetween([0, 0], [0, 1])) < 1, 'nav: bearingBetween salah');
  console.assert(signedAngleDiff(350, 10) === 20, 'nav: signedAngleDiff wrap salah');
  const lTurn = [[0,0],[0,0.0005],[0,0.001],[0.0006,0.0011],[0.0012,0.0011]]; // lurus lalu belok kanan
  const md = buildManeuvers(lTurn);
  console.assert(md.maneuvers.length >= 1, 'nav: buildManeuvers gak nemu belokan sample');
})();

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
