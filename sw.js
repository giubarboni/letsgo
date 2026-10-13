// Funzionamento offline: pagine, dati, font e foto restano sul telefono.
// Si risponde subito dalla copia salvata e intanto la si aggiorna: le novità arrivano all'apertura successiva.
const CACHE = 'marocco-v12';
const BASE = ['./', 'index.html', 'voli.html', 'auto.html', 'dormire.html', 'valigia.html', 'stile.css', 'nav.js', 'manifest.webmanifest',
  'dati/tappe.md', 'dati/voli.json', 'dati/auto.json', 'dati/dormire.json', 'dati/valigia.json',
  'loghi/placeholder.svg', 'icone/favicon.svg', 'icone/favicon-32.png', 'foto/auto/1.png', 'foto/auto/2.png', 'foto/dormire/1.webp', 'foto/dormire/2.webp', 'foto/dormire/3.webp', 'foto/dormire/4.webp', 'foto/dormire/5.webp', 'foto/dormire/8.webp', 'foto/dormire/9.webp', 'font/GeneralSans-Variable.woff2',];

// All'installazione solo l'essenziale (poco peso: se la rete cade a metà, il sito non resta senza funzione offline).
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => Promise.all(BASE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting())));

// Le foto (circa 10 MB, elencate in tappe.md) si salvano dopo, su richiesta della pagina.
self.addEventListener('message', e => {
  if (e.data !== 'foto') return;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const md = await (await c.match('dati/tappe.md'))?.text() || '';
    for (const m of md.matchAll(/^- (foto\/\S+)/gm)) if (!await c.match(m[1])) await c.add(new Request(m[1], { cache: 'reload' })).catch(() => {});
  })());
});

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return; // i link a Drive non si salvano
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const salvata = await c.match(r, { ignoreSearch: true });
    const rete = fetch(r, { cache: 'no-cache' }).then(res => { if (res.ok) c.put(r.url.split('?')[0], res.clone()); return res; });
    if (salvata) { rete.catch(() => {}); return salvata; }
    return rete;
  })());
});
