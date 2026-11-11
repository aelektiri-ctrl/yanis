// Cotes de référence (Pinnacle, exchanges, consensus des bookmakers) via The Odds API.
// Nécessite le secret GitHub ODDS_API_KEY ; sans clé, l'étape est ignorée sans erreur.
// Écrit docs/data/sharp.json, relu par l'appli : probabilités sans marge du marché le plus précis.
const fs = require('fs');
const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.log('ODDS_API_KEY absent : étape ignorée'); process.exit(0); }
const BUDGET = +process.argv[2] || 60;          // crédits maximum consommés par exécution
const BASE = 'https://api.the-odds-api.com/v4';
const OUT = 'docs/data/sharp.json';

async function api(path) {
  const r = await fetch(BASE + path + (path.includes('?') ? '&' : '?') + 'apiKey=' + KEY);
  if (!r.ok) throw new Error(r.status + ' ' + path.split('?')[0]);
  return { data: await r.json(), left: r.headers.get('x-requests-remaining'), cost: +r.headers.get('x-requests-last') || 1 };
}

// retire la marge : méthode de la puissance (corrige le biais favori/outsider), plus fidèle que la simple proportion
function devig(prices) {
  const q = prices.map(x => 1 / x);
  if (q.some(v => !isFinite(v) || v <= 0)) return null;
  const s = q.reduce((a, b) => a + b, 0);
  if (s <= 1.0001) return q.map(v => v / s);
  let lo = 1, hi = 8;
  for (let i = 0; i < 60; i++) { const k = (lo + hi) / 2; const t = q.reduce((a, v) => a + Math.pow(v, k), 0); if (t > 1) lo = k; else hi = k; }
  const k = (lo + hi) / 2, p = q.map(v => Math.pow(v, k)), t = p.reduce((a, b) => a + b, 0);
  return p.map(v => v / t);
}

// ordre de priorité quand le budget est limité
const PRIO = [/^tennis_/, /^basketball_nba$/, /^icehockey_nhl$/, /^mma_/, /^baseball_mlb$/, /^americanfootball_nfl$/, /^basketball_wnba$/,
  /^soccer_(epl|spain_la_liga|italy_serie_a|germany_bundesliga|france_ligue_one|uefa_champs_league|uefa_europa_league|uefa_europa_conf_league|netherlands_eredivisie|portugal_primeira_liga|efl_champ|spain_segunda_division|france_ligue_two|germany_bundesliga2|italy_serie_b|fa_cup|spain_copa_del_rey|italy_coppa_italia|germany_dfb_pokal|league_cup)/, /^soccer_/, /^rugby/];
const KEEP = /^(soccer_|basketball_(nba|wnba)$|icehockey_nhl$|baseball_mlb$|americanfootball_nfl$|mma_|tennis_(atp|wta)_|rugby)/;
const rank = k => { const i = PRIO.findIndex(r => r.test(k)); return i < 0 ? 99 : i; };

(async () => {
  const now = Date.now(), H48 = now + 48 * 3600e3, PAST = now - 3 * 3600e3;
  const sp = await api('/sports');
  const keys = sp.data.filter(s => s.active && !s.has_outrights && KEEP.test(s.key)).map(s => s.key).sort((a, b) => rank(a) - rank(b));
  console.log(keys.length, 'compétitions actives ; crédits restants', sp.left, '; budget', BUDGET);
  const events = []; let spent = 0, left = sp.left, fail = 0;
  for (const k of keys) {
    if (spent >= BUDGET) { console.log('budget atteint, compétitions non lues :', keys.slice(keys.indexOf(k)).length); break; }
    try {
      const { data, cost, left: l } = await api('/sports/' + k + '/odds?regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=iso');
      spent += cost; left = l;
      for (const e of data) {
        const t = Date.parse(e.commence_time); if (!(t >= PAST && t <= H48)) continue;
        const per = [];
        for (const b of e.bookmakers || []) {
          const m = (b.markets || []).find(x => x.key === 'h2h'); if (!m) continue;
          const get = n => { const o = m.outcomes.find(x => x.name === n); return o ? o.price : null; };
          const ph = get(e.home_team), pa = get(e.away_team), pd = get('Draw');
          if (!ph || !pa) continue;
          const arr = pd ? [ph, pd, pa] : [ph, pa], d = devig(arr);
          if (!d) continue;
          per.push({ b: b.key, p: pd ? { h: d[0], d: d[1], a: d[2] } : { h: d[0], a: d[1] } });
        }
        if (!per.length) continue;
        const sharp = per.find(x => x.b === 'pinnacle') || per.find(x => /betfair_ex|matchbook|smarkets/.test(x.b));
        let p, src, nb = per.length;
        if (sharp) { p = sharp.p; src = sharp.b; }
        else if (per.length >= 3) {
          const avg = f => per.reduce((a, x) => a + (x.p[f] || 0), 0) / per.length;
          p = per[0].p.d != null ? { h: avg('h'), d: avg('d'), a: avg('a') } : { h: avg('h'), a: avg('a') }; src = 'consensus';
        } else continue;
        events.push({ k, t: e.commence_time, h: e.home_team, a: e.away_team, p, src, nb });
      }
    } catch (err) { fail++; console.log('échec', k, err.message); if (fail >= 5) break; }
  }
  console.log(events.length, 'matchs avec cotes de référence ;', spent, 'crédits utilisés ; restants', left);
  if (!events.length) { console.log('rien à écrire : fichier précédent conservé'); return; }
  fs.mkdirSync('docs/data', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ maj: new Date().toISOString(), reste: left, n: events.length, events }));
})().catch(e => { console.log('erreur', e.message); process.exit(0); });
