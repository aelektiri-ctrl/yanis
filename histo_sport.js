// Bibliothèque des résultats sport pour l'appli (docs/data/hist/*.json), construite jour par jour :
// ESPN refuse désormais les plages de dates. Chaque passage complète les jours manquants (200 jours glissants).
// Usage : node histo_sport.js [budget_minutes]
const fs = require('fs'), path = require('path');
const SE = require('./turf_source/sport.js');
const OUT = path.join(__dirname, 'docs', 'data', 'hist');
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/';
const WINDOW = 200, budget = (+process.argv[2] || 20) * 60e3, t0 = Date.now();
const today = SE.dayN(Date.now());
fs.mkdirSync(OUT, { recursive: true });
const leagues = SE.LEAGUES.map(l => 'soccer/' + l.id).concat(SE.US.map(l => l.path));
const files = {};
for (const p of leagues) {
  const f = path.join(OUT, SE.histKey(p) + '.json');
  let d = { path: p, to: 0, done: [], g: [] };
  try { d = Object.assign(d, JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (e) { }
  d.done = d.done.filter(x => x >= today - WINDOW); files[p] = { f, d };
}
// travail : d'abord les 3 derniers jours pour tous, puis l'historique en remontant, ligue par ligue en alternance
const jobs = [];
for (let k = 1; k <= 3; k++) for (const p of leagues) jobs.push([p, today - k]);
for (let k = 4; k <= WINDOW - 40; k++) for (const p of leagues) if (!files[p].d.done.includes(today - k)) jobs.push([p, today - k]);
let ok = 0, ko = 0, n400 = 0;
async function one([p, day]) {
  const D = files[p].d;
  for (let i = 0; i < 3; i++) {
    try {
      const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 15000);
      const r = await fetch(BASE + p + '/scoreboard?dates=' + SE.ymdOf(day) + '&limit=300', { signal: ac.signal }); clearTimeout(tm);
      if (r.status === 400 || r.status === 404) { n400++; if (!D.done.includes(day)) D.done.push(day); return; }
      if (!r.ok) throw new Error(r.status);
      const seen = new Set(D.g.map(x => x.slice(0, 3).join('|')));
      for (const x of SE.parseGames(await r.json())) { const k = x.slice(0, 3).join('|'); if (!seen.has(k)) { seen.add(k); D.g.push(x); } }
      if (day < today - 1 && !D.done.includes(day)) D.done.push(day);
      ok++; return;
    } catch (e) { if (i === 2) { ko++; return; } await new Promise(r => setTimeout(r, 800)); }
  }
}
(async () => {
  const q = jobs.slice();
  await Promise.all(Array.from({ length: 8 }, async () => { while (q.length && Date.now() - t0 < budget) await one(q.shift()); }));
  for (const p of leagues) {
    const { f, d } = files[p];
    d.g = d.g.filter(x => x[0] >= today - WINDOW).sort((a, b) => a[0] - b[0]);
    // « to » = dernier jour couvert sans trou depuis le début de la fenêtre utile (160 jours)
    let to = 0; for (let k = 160; k >= 2; k--) { if (d.done.includes(today - k)) to = today - k; else break; }
    d.to = to; d.maj = new Date().toISOString().slice(0, 16);
    fs.writeFileSync(f, JSON.stringify(d));
  }
  console.log('requêtes ok', ok, 'échecs', ko, '400/404', n400, 'restant', q.length, 'sur', jobs.length);
})();
