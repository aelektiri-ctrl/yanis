// Relevé des paris détaillés (en test) via The Odds API — budget plafonné par exécution.
// Foot : mi-temps, les deux équipes marquent, buts en 1re mi-temps (Pinnacle + bookmakers français).
// NBA  : total de points et handicap (bulk, peu cher) + paris joueurs (points, rebonds, passes) des bookmakers américains,
//        utilisés comme référence : on lit l'information, on ne parie pas chez eux.
// Écrit docs/data/detail.json (état courant) et donnees_cotes/detail/AAAA-MM-JJ.json (historique, pour le bilan à 4-6 semaines).
const fs = require('fs');
const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.log('ODDS_API_KEY absent : étape ignorée'); process.exit(0); }
const BUDGET = +process.argv[2] || 40;
const BASE = 'https://api.the-odds-api.com/v4';
const FR = /betclic|winamax|zebet|parionssport|pmu|netbet|genybet|joa|vbet|unibet|bwin/i;
const isFR = b => FR.test(b.key + ' ' + (b.title || '')) && (/\(FR\)/i.test(b.title || '') || /_fr$/i.test(b.key));
const FOOT = ['soccer_epl', 'soccer_france_ligue_one', 'soccer_spain_la_liga', 'soccer_italy_serie_a', 'soccer_germany_bundesliga', 'soccer_italy_serie_b', 'soccer_uefa_champs_league'];
const FOOT_M = 'btts,h2h_h1,totals_h1';
const NBA_PROPS = 'player_points,player_rebounds,player_assists';
let spent = 0, left = null;

async function api(path) {
  const r = await fetch(BASE + path + (path.includes('?') ? '&' : '?') + 'apiKey=' + KEY);
  if (!r.ok) throw new Error(r.status + ' ' + path.split('?')[0]);
  left = r.headers.get('x-requests-remaining'); spent += +r.headers.get('x-requests-last') || 0;
  return r.json();
}
function devig(pr) {
  const q = pr.map(x => 1 / x); if (q.some(v => !isFinite(v) || v <= 0)) return null;
  const s = q.reduce((a, b) => a + b, 0); return q.map(v => v / s);
}
// regroupe les issues d'un même pari (même marché, même joueur, même ligne) et en tire : probabilité de référence + meilleure cote française
function lire(ev, sport, out) {
  const G = {};
  for (const b of ev.bookmakers || []) for (const m of b.markets || []) {
    const by = {};
    for (const o of m.outcomes || []) { const g = m.key + '|' + (o.description || '') + '|' + (o.point != null ? Math.abs(o.point) : ''); (by[g] = by[g] || []).push(o); }
    for (const [g, os] of Object.entries(by)) {
      if (os.length < 2) continue;
      const d = devig(os.map(o => o.price)); if (!d) continue;
      const x = G[g] = G[g] || { ref: {}, n: {}, fr: {} };
      os.forEach((o, i) => {
        const nm = o.name + (o.point != null ? ' ' + o.point : '');
        if (b.key === 'pinnacle') x.ref[nm] = d[i];
        x.n[nm] = x.n[nm] || []; x.n[nm].push(d[i]);
        if (isFR(b) && (!x.fr[nm] || o.price > x.fr[nm][0])) x.fr[nm] = [o.price, b.title];
      });
    }
  }
  for (const [g, x] of Object.entries(G)) {
    const [mk, joueur] = g.split('|');
    for (const nm of Object.keys(x.n)) {
      const cons = x.n[nm].length >= 3 ? x.n[nm].reduce((a, b) => a + b, 0) / x.n[nm].length : null;
      const p = x.ref[nm] != null ? x.ref[nm] : cons; if (p == null || p < 0.03 || p > 0.97) continue;
      const fr = x.fr[nm] || null;
      out.push({ sport, id: ev.id, t: ev.commence_time, m: ev.home_team + ' - ' + ev.away_team, marche: mk, joueur: joueur || undefined, issue: nm,
        p: +p.toFixed(3), src: x.ref[nm] != null ? 'pinnacle' : 'consensus ' + x.n[nm].length, cote: fr ? fr[0] : null, book: fr ? fr[1] : null,
        ev: fr ? +(p * fr[0] - 1).toFixed(3) : null, rentable: +(1 / p).toFixed(2) });
    }
  }
}

(async () => {
  const now = Date.now(), H = now + 30 * 3600e3, L = [];
  const dans = e => { const t = Date.parse(e.commence_time); return t > now && t < H; };
  try {   // NBA total + handicap : 1 appel pour tous les matchs
    const d = await api('/sports/basketball_nba/odds?regions=eu&markets=totals,spreads&oddsFormat=decimal');
    d.filter(dans).forEach(e => lire(e, 'NBA', L));
  } catch (e) { console.log('NBA lignes :', e.message); }
  const evs = [];
  for (const k of FOOT) { try { (await api('/sports/' + k + '/events')).filter(dans).forEach(e => evs.push([k, e])); } catch (e) { console.log(k, e.message); } }
  try { (await api('/sports/basketball_nba/events')).filter(dans).forEach(e => evs.push(['basketball_nba', e])); } catch (e) { }
  evs.sort((a, b) => Date.parse(a[1].commence_time) - Date.parse(b[1].commence_time));
  for (const [k, e] of evs) {
    if (spent >= BUDGET - 3 || (left != null && +left < 500)) { console.log('budget atteint'); break; }
    const nba = k === 'basketball_nba';
    try {
      const d = await api('/sports/' + k + '/events/' + e.id + '/odds?regions=' + (nba ? 'us' : 'eu') + '&markets=' + (nba ? NBA_PROPS : FOOT_M) + '&oddsFormat=decimal');
      lire(d, nba ? 'NBA' : 'Foot', L);
    } catch (err) { console.log(k, e.id, err.message); }
  }
  L.sort((a, b) => (b.ev ?? -9) - (a.ev ?? -9));
  const res = { maj: new Date(now).toISOString(), credits: spent, restants: left, n: L.length,
    valeur: L.filter(x => x.ev != null && x.ev > 0.02 && x.p >= 0.25).slice(0, 40), lignes: L };
  fs.writeFileSync('docs/data/detail.json', JSON.stringify(res));
  fs.mkdirSync('donnees_cotes/detail', { recursive: true });
  const f = 'donnees_cotes/detail/' + new Date(now).toISOString().slice(0, 10) + '.json';
  let old = []; try { old = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { }
  old.push({ c: res.maj, lignes: L }); fs.writeFileSync(f, JSON.stringify(old));
  console.log(L.length, 'lignes ;', res.valeur.length, 'à valeur ;', spent, 'crédits utilisés ; restants', left);
})();
