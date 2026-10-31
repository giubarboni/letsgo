// Parti comuni a tutte le pagine: dati dal foglio, navbar, funzionamento offline.
const PAGES = [['mappa', 'index.html', 'Mappa'], ['voli', 'voli.html', 'Voli'], ['auto', 'auto.html', 'Auto'], ['dormire', 'dormire.html', 'Dormire'], ['valigia', 'valigia.html', 'Valigia']];
const cur = document.body.dataset.page;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// Dati del viaggio: arrivano dal foglio Google tramite il suo script, che passa solo le schede e le colonne decise nel foglio.
// Con la rete lenta (più di 2,5 s) o assente si usa l'ultima copia salvata, e intanto si aggiorna per la volta dopo.
const FOGLIO = 'https://script.google.com/macros/s/AKfycbxJ9yiUvAH9bZ2JeltHj5YWQ5Hs-_KNHd5OFIoWYQocJrWVxu62dpSIB_-CF_e5zsC3Gw/exec';
const viaggio = () => viaggio.p ||= (() => {
  let copia = null; try { copia = JSON.parse(localStorage.getItem('viaggio')); } catch {}
  const rete = fetch(FOGLIO).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { try { localStorage.setItem('viaggio', JSON.stringify(d)); } catch {} return d; });
  return copia ? Promise.race([rete, new Promise(ok => setTimeout(() => ok(copia), 2500))]).catch(() => copia) : rete;
})();

// Formati: "28 dic", "28–29 dic", "430,51 €", "6,5 h"
const GIORNO = d => new Date(d + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }).replace('.', '');
const INTERVALLO = (da, a) => da === a ? GIORNO(da) : da.slice(0, 7) === a.slice(0, 7) ? `${+da.slice(8)}–${GIORNO(a)}` : `${GIORNO(da)} – ${GIORNO(a)}`;
const EURO = v => typeof v === 'number' ? v.toLocaleString('it-IT', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €' : v;
const ORE = h => h === '' ? '' : String(h).replace('.', ',') + ' h';
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Dal programma (un giorno per riga) alle tappe: giorni consecutivi nello stesso posto.
const TIPI = { 'Natura': 'nat', 'Città / cultura': 'city', 'Costa': 'coast', 'Transito': 'transit' };
function tappe(d) {
  const out = [];
  for (const [data, nome, tipo, guida, cosa, dorm, stato, link, prezzo] of d.giorni) {
    let t = out.at(-1);
    if (!t || t.nome !== nome) out.push(t = { n: out.length + 1, nome, slug: slug(nome), tipo: TIPI[tipo] || 'city', guida, ll: (d.coordinate[nome] || '').split(',').map(Number), giorni: [], notti: 0 });
    const notte = data < d.viaggio.ritorno; // l'ultimo giorno non ha notte
    t.giorni.push({ data, cosa, dorm, stato, link, prezzo, notte });
    if (notte) t.notti++;
  }
  return out;
}
// Soggiorni: notti consecutive nella stessa tappa e nella stessa struttura.
function soggiorni(d) {
  const out = [];
  for (const t of tappe(d)) for (const g of t.giorni) {
    if (!g.notte) continue;
    const s = out.at(-1);
    if (s && s.tappa === t.nome && s.struttura === g.dorm) { s.notti++; s.a = g.data; s.prezzo ||= g.prezzo; }
    else out.push({ tappa: t.nome, slug: t.slug, struttura: g.dorm, stato: g.stato, link: g.link, prezzo: g.prezzo, notti: 1, da: g.data, a: g.data });
  }
  return out;
}

// Descrizioni e foto delle tappe: dati/tappe.md (le cura chi gestisce il sito). Chiave: nome della tappa, senza accenti né parentesi.
const contenuti = () => contenuti.p ||= fetch('dati/tappe.md').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).then(t => {
  const out = {};
  for (const b of t.split(/^## /m).slice(1)) {
    const [head, ...rest] = b.split('\n'), body = rest.join('\n');
    const [sl, nome] = head.split(' — ');
    const sec = n => (body.split(new RegExp(`^### ${n}\\s*$`, 'm'))[1] || '').split(/^### /m)[0];
    const items = x => x.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
    const foto = l => { const [src, cap, cred, url] = l.split(' | '); return { src, cap, cred, url }; };
    out[sl.trim()] = { nome: nome.trim(), desc: body.split(/^### /m)[0].trim(), foto: items(sec('Foto')).map(foto), alloggio: items(sec('Alloggio')).map(foto)[0] };
  }
  return out;
});

// Tappe senza sezione in dati/tappe.md: testo da Wikipedia e foto da Wikimedia Commons, cercati per coordinate.
// Il risultato resta sul telefono (se Wikipedia non risponde non si salva nulla e si riprova). Stessa forma di contenuti(): { desc, foto: [{ src, cap, cred, url }] }.
const memo = {};
const automatico = t => memo[t.slug] ||= (async () => {
  const k = 'wiki:' + t.slug;
  try { const c = JSON.parse(localStorage.getItem(k)); if (c) return c; } catch {}
  const [la, lo] = t.ll; if (!(la && lo)) return { desc: '', foto: [] };
  let ko = false; // l'API di Wikipedia a volte risponde "troppo occupata": si riprova, e se non va non si salva niente
  const pagine = async (host, p) => {
    for (let i = 0; i < 5; i++) try {
      const j = await fetch(`https://${host}/w/api.php?action=query&generator=geosearch&ggscoord=${la}|${lo}&format=json&origin=*&${p}`).then(r => r.json());
      if (!j.error) return Object.values(j.query?.pages || {});
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    } catch {}
    ko = true; return [];
  };
  const [wiki, commons] = await Promise.all([
    pagine('it.wikipedia.org', 'ggsradius=10000&ggslimit=10&prop=extracts|pageimages&exintro=1&explaintext=1&exsentences=3&piprop=thumbnail&pithumbsize=800'),
    pagine('commons.wikimedia.org', 'ggsnamespace=6&ggsradius=3000&ggslimit=50&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=800')]);
  // Il testo si accetta solo se il titolo dell'articolo è la tappa (meglio nessun testo che quello sbagliato).
  const p = wiki.sort((a, b) => a.index - b.index).find(w => slug(w.title) === t.slug) || wiki.find(w => slug(w.title).length > 3 && t.slug.includes(slug(w.title)));
  const testo = h => new DOMParser().parseFromString(h || '', 'text/html').body.textContent.trim();
  // solo foto grandi e orizzontali: le altre sono spesso scansioni d'archivio
  const foto = commons.filter(c => { const i = c.imageinfo?.[0]; return i?.mime === 'image/jpeg' && i.extmetadata.LicenseShortName && i.width >= 1600 && i.width / i.height >= 1.3; }).slice(0, 3).map(c => {
    const i = c.imageinfo[0], m = i.extmetadata;
    return { src: i.thumburl, cap: c.title.replace(/^File:|\.jpe?g$|\s*-?\s*panoramio.*$/gi, '').replace(/_/g, ' '), cred: `${testo(m.Artist?.value) || 'Wikimedia Commons'} · ${m.LicenseShortName.value}`, url: i.descriptionurl };
  });
  if (/\.jpe?g/i.test(p?.thumbnail?.source)) foto.unshift({ src: p.thumbnail.source, cap: p.title, cred: 'Wikipedia', url: `https://it.wikipedia.org/?curid=${p.pageid}` });
  const out = { desc: (p?.extract || '').replace(/\s*\([^)]*\)/g, '').split('\n')[0], foto };
  if (ko) delete memo[t.slug]; else try { localStorage.setItem(k, JSON.stringify(out)); } catch {}
  return out;
})();

// Icone Material Symbols: vuote per le sezioni, piene per quella attuale. Salvate qui per funzionare anche offline.
const ICONE = {
  mappa: ['m612-120-263-93-179 71q-17 9-33.5-1T120-173v-558q0-13 7.5-23t19.5-15l202-71 263 92 178-71q17-8 33.5 1.5T840-788v565q0 11-7.5 19T814-192l-202 72Zm-34-75v-505l-196-66v505l196 66Zm60 0 142-47v-512l-142 54v505Zm-458-12 142-54v-505l-142 47v512Zm458-493v505-505Zm-316-66v505-505Z', 'm612-120-263-93-179 71q-17 9-33.5-1T120-173v-558q0-13 7.5-23t19.5-15l202-71 263 92 178-71q17-8 33.5 1.5T840-788v565q0 11-7.5 19T814-192l-202 72Zm-34-75v-505l-196-66v505l196 66Z'],
  voli: ['M285-80v-83l124-86v-172L80-288v-102l329-231v-188q0-29 21-50t50-21q29 0 50 21t21 50v188l329 231v102L551-421v172l123 86v83l-194-59-195 59Z', 'M285-80v-83l124-86v-172L80-288v-102l329-231v-188q0-29 21-50t50-21q29 0 50 21t21 50v188l329 231v102L551-421v172l123 86v83l-194-59-195 59Z', true], // l'aereo è una sagoma piena: la versione vuota è lo stesso disegno solo a contorno
  auto: ['M200-204v54q0 12.75-8.62 21.37Q182.75-120 170-120h-20q-12.75 0-21.37-8.63Q120-137.25 120-150v-324l85-256q5-14 16.5-22t26.5-8h464q15 0 26.5 8t16.5 22l85 256v324q0 12.75-8.62 21.37Q822.75-120 810-120h-21q-13 0-21-8.63-8-8.62-8-21.37v-54H200Zm3-330h554l-55-166H258l-55 166Zm-23 60v210-210Zm105.76 160q23.24 0 38.74-15.75Q340-345.5 340-368q0-23.33-15.75-39.67Q308.5-424 286-424q-23.33 0-39.67 16.26Q230-391.47 230-368.24q0 23.24 16.26 38.74 16.27 15.5 39.5 15.5ZM675-314q23.33 0 39.67-15.75Q731-345.5 731-368q0-23.33-16.26-39.67Q698.47-424 675.24-424q-23.24 0-38.74 16.26-15.5 16.27-15.5 39.5 0 23.24 15.75 38.74Q652.5-314 675-314Zm-495 50h600v-210H180v210Z', 'M200-204v54q0 12.75-8.62 21.37Q182.75-120 170-120h-20q-12.75 0-21.37-8.63Q120-137.25 120-150v-324l85-256q5-14 16.5-22t26.5-8h464q15 0 26.5 8t16.5 22l85 256v324q0 12.75-8.62 21.37Q822.75-120 810-120h-21q-12.75 0-21.37-8.63Q759-137.25 759-150v-54H200Zm3-330h554l-55-166H258l-55 166Zm82.76 220q23.24 0 38.74-15.75Q340-345.5 340-368q0-23.33-15.75-39.67Q308.5-424 286-424q-23.33 0-39.67 16.26Q230-391.47 230-368.24q0 23.24 16.26 38.74 16.27 15.5 39.5 15.5ZM675-314q23.33 0 39.67-15.75Q731-345.5 731-368q0-23.33-16.26-39.67Q698.47-424 675.24-424q-23.24 0-38.74 16.26-15.5 16.27-15.5 39.5 0 23.24 15.75 38.74Q652.5-314 675-314Z'],
  dormire: ['M80-200v-255q0-25 10-47t30-36v-116q0-45 30.5-75.5T226-760h180q22 0 41 10t33 27q14-17 32.5-27t40.5-10h180q45 0 76 30.5t31 75.5v116q20 14 30 36t10 47v255h-60v-80H140v80H80Zm430-355h270v-99q0-20-13.5-33T733-700H550q-17 0-28.5 14T510-654v99Zm-330 0h270v-99q0-18-11.5-32T410-700H226q-19 0-32.5 13.5T180-654v99Zm-40 215h680v-115q0-17-11.5-28.5T780-495H180q-17 0-28.5 11.5T140-455v115Zm680 0H140h680Z', 'M80-200v-255q0-25 10-47t30-36v-116q0-45 30.5-75.5T226-760h180q22 0 41 10t33 27q14-17 32.5-27t40.5-10h180q45 0 76 30.5t31 75.5v116q20 14 30 36t10 47v255h-60v-80H140v80H80Zm430-355h270v-99q0-20-13.5-33T733-700H550q-17 0-28.5 14T510-654v99Zm-330 0h270v-99q0-18-11.5-32T410-700H226q-19 0-32.5 13.5T180-654v99Z'],
  valigia: ['M260-120q-24.75 0-42.37-17.63Q200-155.25 200-180v-480q0-24.75 17.63-42.38Q235.25-720 260-720h105v-100q0-24.75 17.63-42.38Q400.25-880 425-880h110q24.75 0 42.38 17.62Q595-844.75 595-820v100h105q24.75 0 42.38 17.62Q760-684.75 760-660v480q0 24.75-17.62 42.37Q724.75-120 700-120q0 17-11.5 28.5T660-80q-17 0-28.5-11.5T620-120H340q0 17-11.5 28.5T300-80q-17 0-28.5-11.5T260-120Zm0-60h440v-480H260v480Zm105-60h60v-360h-60v360Zm170 0h60v-360h-60v360ZM425-720h110v-100H425v100Zm55 300Z', 'M260-120q-24.75 0-42.37-17.63Q200-155.25 200-180v-480q0-24.75 17.63-42.38Q235.25-720 260-720h105v-100q0-24.75 17.63-42.38Q400.25-880 425-880h110q24.75 0 42.38 17.62Q595-844.75 595-820v100h105q24.75 0 42.38 17.62Q760-684.75 760-660v480q0 24.75-17.62 42.37Q724.75-120 700-120q0 17-11.5 28.5T660-80q-17 0-28.5-11.5T620-120H340q0 17-11.5 28.5T300-80q-17 0-28.5-11.5T260-120Zm105-120h60v-360h-60v360Zm170 0h60v-360h-60v360ZM425-720h110v-100H425v100Z']
};
const INFO = 'M453-280h60v-240h-60v240Zm50.5-323.2q9.5-9.2 9.5-22.8 0-14.45-9.48-24.22-9.48-9.78-23.5-9.78t-23.52 9.78Q447-640.45 447-626q0 13.6 9.48 22.8 9.48 9.2 23.5 9.2t23.52-9.2ZM480.27-80q-82.74 0-155.5-31.5Q252-143 197.5-197.5t-86-127.34Q80-397.68 80-480.5t31.5-155.66Q143-709 197.5-763t127.34-85.5Q397.68-880 480.5-880t155.66 31.5Q709-817 763-763t85.5 127Q880-563 880-480.27q0 82.74-31.5 155.5Q817-252 763-197.68q-54 54.31-127 86Q563-80 480.27-80Zm.23-60Q622-140 721-239.5t99-241Q820-622 721.19-721T480-820q-141 0-240.5 98.81T140-480q0 141 99.5 240.5t241 99.5Zm-.5-340Z'; // icona "info"
const iconaSvg = (d, size = 24) => `<svg viewBox="0 -960 960 960" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;

// Finestra con titolo e contenuto (si chiude con ×, tocco fuori o Esc).
function modale(titolo, ...nodi) {
  const ov = el('div', 'dlg-ov'), box = el('div', 'dlg'), x = el('button', 'btn', 'Chiudi');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); x.type = 'button';
  const chiudi = () => { ov.remove(); removeEventListener('keydown', esc); }, esc = e => { if (e.key === 'Escape') chiudi(); };
  x.onclick = chiudi; ov.onclick = e => { if (e.target === ov) chiudi(); }; addEventListener('keydown', esc);
  box.append(el('h2', '', titolo), ...nodi, x); ov.append(box); document.body.append(ov);
}

// Barra in alto con una icona per sezione, uguale su tutte le pagine.
const navbar = el('nav', 'navbar'); navbar.setAttribute('aria-label', 'Sezioni');
const icona = id => {
  const [vuota, piena, contorno] = ICONE[id], attuale = id === cur, linea = contorno && !attuale;
  return `<svg viewBox="0 -960 960 960" width="24" height="24" fill="${linea ? 'none' : 'currentColor'}"${linea ? ' stroke="currentColor" stroke-width="55" stroke-linejoin="round"' : ''}><path d="${attuale ? piena : vuota}"/></svg>`;
};
navbar.innerHTML = PAGES.map(([id, href, nome]) => `<a href="${href}" title="${nome}" aria-label="${nome}"${id === cur ? ' aria-current="page"' : ''}>${icona(id)}</a>`).join('');
document.body.prepend(navbar);
// Titolo della pagina (la mappa ha quello del pannello).
if (cur !== 'mappa') document.querySelector('.page').prepend(el('h1', 'ptitle', PAGES.find(p => p[0] === cur)[2]));

const root = document.getElementById('root');
// Bottoni di una scheda: senza link (documento non ancora caricato) restano disattivati.
const bottoni = (act, lista) => { for (const [l, u] of lista) {
  const b = u ? el('a', 'btn', l) : el('button', 'btn', l);
  if (u) { b.href = u; b.target = '_blank'; b.rel = 'noopener'; } else { b.type = 'button'; b.disabled = true; b.title = 'Non ancora disponibile'; }
  act.append(b);
} };
// Disegna la pagina con i dati del viaggio; se non arrivano e non c'è una copia, lo dice.
const pagina = disegna => viaggio().then(disegna).catch(() => root.append(el('p', 'intro', 'Dati non disponibili.')));

// Offline: dopo la prima apertura con rete il sito resta sul telefono (sw.js).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(r => r.active.postMessage('foto')).catch(() => {});
