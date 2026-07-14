# Gowes — Cycling Route Planner

PWA rute sepeda: tap peta buat bikin rute, atau import GPX. Single-file static app, no build step, no backend.

## Fitur

- **3 mode rute**: Gravel, Roadbike, MTB (via [BRouter](https://brouter.de) public API)
- **Cari lokasi** — search box pakai Nominatim (OSM), gratis, no API key
- **Import/export GPX**, termasuk file dengan banyak track (muncul picker)
- **Grafik elevasi** interaktif, tap chart → nunjuk titik di peta
- **Estimasi waktu tempuh & kalori** (kasar, disesuaikan per profile + elevasi)
- **Mode navigasi** ala Google Maps:
  - Auto-follow kamera ke lokasi GPS live, top-down view
  - Instruksi belok real-time (dihitung dari geometri rute — bukan nama jalan, BRouter publik gak expose itu)
  - Auto recalculate rute kalau melenceng >40m dari track selama 5 detik
  - Tombol recenter kalau map digeser manual pas navigasi
  - Wake lock — layar gak mati selama navigasi
- **Riwayat rute** tersimpan otomatis di localStorage (auto-restore pas reload)
- **Offline-ready PWA** — app shell + tile map di-cache lewat service worker

## Tech stack

- [MapLibre GL JS](https://maplibre.org/) + tile [CyclOSM](https://www.cyclosm.org/)
- [BRouter](https://brouter.de) — routing engine (profile: gravel/fastbike/mtb)
- [Nominatim](https://nominatim.org/) — geocoding/search lokasi
- Vanilla JS, no framework, no build step

## Struktur

```
index.html              # markup + CSS
js/app.js               # seluruh logic app
sw.js                   # service worker (cache app shell, tile, CDN)
manifest.webmanifest    # PWA manifest
assets/                 # icon PWA
vercel.json              # header cache buat sw.js
```

## Jalanin lokal

Static file, tinggal serve pakai HTTP server apa aja (perlu HTTP karena service worker gak jalan di `file://`):

```bash
npx serve .
# atau
python3 -m http.server 8000
```

## Deploy

Static site murni, gak ada build command:

- **Vercel**: import repo, framework preset "Other", build command kosong, output directory `.`. `vercel.json` udah include header no-cache buat `sw.js`.
- **Netlify**: sama, publish directory `.`, no build command.

## Update PWA

Tiap deploy yang ubah `index.html` atau `js/app.js`, bump versi `SHELL_CACHE` di `sw.js` (mis. `gowes-shell-v2` → `v3`). Tanpa ini browser gak detect ada `sw.js` baru, jadi cache-first tetep serve app shell versi lama meski udah re-deploy.

## Batasan yang disengaja

- Instruksi navigasi gak sebut nama jalan — cuma arah belok + jarak, dihitung dari geometri rute. Upgrade butuh routing engine berbayar (Mapbox/Google Directions).
- Estimasi waktu/kalori gak pake berat badan user, formula generik.
- No voice guidance.
