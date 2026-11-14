// Premier lancement avec la clé enregistrée le 11/11/2026.
// Cotes de référence (Pinnacle, exchanges, consensus des bookmakers) via The Odds API.
// Nécessite le secret GitHub ODDS_API_KEY ; sans clé, l'étape est ignorée sans erreur.
// Écrit docs/data/sharp.json, relu par l'appli : probabilités sans marge du marché le plus précis.
const fs = require('fs');
const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.log('ODDS_API_KEY absent : étape ignorée'); process.exit(0); }
const BUDGET = +process.argv[2] || 60;          // crédits maximum consommés par exécution (réduit automatiquement pour ne jamais dépasser le forfait)
const FR = /betclic|winamax|zebet|parionssport|pmu|netbet|genybet|joa|vbet|unibet|bwin/i;   // bookmakers agréés en France
const isFR = b => FR.test(b.key + ' ' + (b.title || '')) && (/\(FR\)/i.test(b.title || '') || /_fr$/i.test(b.key));   // uniquement la version française (« Winamax (DE) » est allemand)
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
// forfait gratuit (500 crédits/mois) : peu de crédits par exécution, donc on lit d'abord ce qui produit le plus de paris à 70 % (NBA, NHL, grands championnats), puis le tennis
const PRIO_FREE = [/^basketball_nba$/, /^icehockey_nhl$/, /^soccer_(epl|spain_la_liga|italy_serie_a|germany_bundesliga|france_ligue_one|uefa_champs_league|uefa_europa_league)$/, /^tennis_/, /^mma_/, /^soccer_/, /^americanfootball_nfl$/];
const rank = (k, free) => { const L = free ? PRIO_FREE : PRIO; const i = L.findIndex(r => r.test(k)); return i < 0 ? 99 : i; };

(async () => {
  const now = Date.now(), H48 = now + 48 * 3600e3;
  const sp = await api('/sports');
  const rem0 = +sp.left, free = isFinite(rem0) && rem0 <= 1000;           // plus de 1 000 crédits restants = forfait payant
  const forced = process.env.GITHUB_EVENT_NAME && process.env.GITHUB_EVENT_NAME !== 'schedule';   // lancement manuel : toujours exécuté
  if (free && !forced && ![9, 15].includes(new Date().getUTCHours())) { console.log('forfait gratuit : 2 lectures par jour (10 h et 16 h, heure de Paris) ; exécution ignorée'); return; }
  const keys = sp.data.filter(s => s.active && !s.has_outrights && KEEP.test(s.key)).map(s => s.key).sort((a, b) => rank(a, free) - rank(b, free));
  // budget adaptatif : on répartit les crédits restants sur les exécutions restantes du mois (8 par jour) ; le forfait n'est jamais dépassé
  const dNow = new Date(), dim = new Date(dNow.getFullYear(), dNow.getMonth() + 1, 0).getDate(), runsLeft = Math.max(1, (dim - dNow.getDate() + 1) * (free ? 2 : 8));
  const rem = +sp.left, budget = isFinite(rem) ? Math.max(0, Math.min(BUDGET, Math.floor(0.9 * rem / runsLeft))) : BUDGET;
  console.log(keys.length, 'compétitions actives ; crédits restants', sp.left, '; budget de cette exécution', budget);
  if (budget < 1) { console.log('plus de crédits à dépenser : fichier précédent conservé'); return; }
  const events = []; let spent = 0, left = sp.left, fail = 0;
  for (const k of keys) {
    if (spent >= budget) { console.log('budget atteint, compétitions non lues :', keys.slice(keys.indexOf(k)).length); break; }
    try {
      const { data, cost, left: l } = await api('/sports/' + k + '/odds?regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=iso');
      spent += cost; left = l;
      for (const e of data) {
        const t = Date.parse(e.commence_time); if (!(t > now && t <= H48)) continue;   // avant-match uniquement : les cotes en direct ne sont pas une probabilité d'avant-match
        const per = [], frl = [];
        for (const b of e.bookmakers || []) {
          const m = (b.markets || []).find(x => x.key === 'h2h'); if (!m) continue;
          const get = n => { const o = m.outcomes.find(x => x.name === n); return o ? o.price : null; };
          const ph = get(e.home_team), pa = get(e.away_team), pd = get('Draw');
          if (!ph || !pa) continue;
          const arr = pd ? [ph, pd, pa] : [ph, pa], d = devig(arr);
          if (!d) continue;
          per.push({ b: b.key, p: pd ? { h: d[0], d: d[1], a: d[2] } : { h: d[0], a: d[1] } });
          if (isFR(b)) frl.push({ t: b.title || b.key, h: ph, d: pd, a: pa });
        }
        if (!per.length) continue;
        const sharp = per.find(x => x.b === 'pinnacle') || per.find(x => /betfair_ex|matchbook|smarkets/.test(x.b));
        let p, src, nb = per.length;
        if (sharp) { p = sharp.p; src = sharp.b; }
        else {
          // on ne mélange jamais un marché à 3 issues (victoire / nul / défaite, ex. hockey en temps réglementaire) avec un marché à 2 issues (prolongation incluse)
          const n3 = per.filter(x => x.p.d != null).length, three0 = n3 * 2 > per.length, same = per.filter(x => (x.p.d != null) === three0);
          if (same.length < 3) continue;
          const avg = f => same.reduce((a, x) => a + (x.p[f] || 0), 0) / same.length;
          p = three0 ? { h: avg('h'), d: avg('d'), a: avg('a') } : { h: avg('h'), a: avg('a') }; src = 'consensus'; nb = same.length;
        }
        // cotes françaises : seulement celles du même type de marché que la probabilité de référence (sinon la comparaison est fausse)
        const three = p.d != null, fr = {};
        frl.filter(x => (x.d != null) === three).forEach(x => { [['h', x.h], ['d', x.d], ['a', x.a]].forEach(([f, v]) => { if (v && (!fr[f] || v > fr[f][0])) fr[f] = [v, x.t]; }); });
        const vals = Object.values(p); if (vals.some(v => !(v > 0.02 && v < 0.98))) continue;   // probabilité dégénérée : on ignore
        events.push({ k, t: e.commence_time, h: e.home_team, a: e.away_team, p, src, nb, c: new Date(now).toISOString(), fr: Object.keys(fr).length ? fr : undefined });
      }
    } catch (err) { fail++; console.log('échec', k, err.message); if (fail >= 5) break; }
  }
  console.log(events.length, 'matchs avec cotes de référence ;', spent, 'crédits utilisés ; restants', left);
  // on garde les cotes d'avant-match des matchs déjà commencés (6 h) et des compétitions non relues ce coup-ci : elles servent de base au pronostic en direct
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).events || [], id = e => e.k + '|' + e.h + '|' + e.a, have = new Set(events.map(id));
    prev.forEach(e => {
      const t = Date.parse(e.t), c = Date.parse(e.c);
      if (!e.c || !(c < t) || have.has(id(e)) || t < now - 6 * 3600e3) return;
      if (t > now && now - c > 30 * 3600e3) return;
      events.push(e);
    });
  } catch (e) { }
  // ---- Valeur pure (EV) et mouvements de cotes (argent sharp) ----
  const MV = [], VAL = [];
  try {
    const old = JSON.parse(fs.readFileSync(OUT, 'utf8')).events || [], oid = e => e.k + '|' + e.h + '|' + e.a + '|' + String(e.t).slice(0, 10), om = new Map(old.map(e => [oid(e), e]));
    for (const e of events) {
      if (!(Date.parse(e.c) < Date.parse(e.t)) || e.c !== new Date(now).toISOString()) continue;      // seulement les cotes lues à l'instant
      if (e.fr) {
        e.ev = {};
        for (const f of Object.keys(e.p)) if (e.fr[f]) { const v = e.p[f] * e.fr[f][0] - 1; e.ev[f] = +v.toFixed(4); if (v > 0.01 && e.p[f] >= 0.2) VAL.push({ k: e.k, t: e.t, m: e.h + ' - ' + e.a, f, nom: f === 'h' ? e.h : f === 'a' ? e.a : 'Nul', p: +e.p[f].toFixed(3), cote: e.fr[f][0], book: e.fr[f][1], ev: +v.toFixed(3) }); }
      }
      const o = om.get(oid(e));
      if (o && o.p && e.src === o.src && e.src !== 'consensus') {
        const dh = (now - Date.parse(o.c)) / 3600e3;
        for (const f of Object.keys(e.p)) {
          const d = e.p[f] - (o.p[f] || 0);
          if (dh <= 7 && d >= 0.04) MV.push({ k: e.k, t: e.t, m: e.h + ' - ' + e.a, f, nom: f === 'h' ? e.h : f === 'a' ? e.a : 'Nul', de: +o.p[f].toFixed(3), a: +e.p[f].toFixed(3), h: +dh.toFixed(1), src: e.src, ev: e.ev ? e.ev[f] : null, cote: e.fr && e.fr[f] ? e.fr[f][0] : null });
        }
      }
    }
    MV.sort((a, b) => Math.abs(b.a - b.de) - Math.abs(a.a - a.de)); VAL.sort((a, b) => b.ev - a.ev);
    console.log(VAL.length, 'paris à valeur positive ;', MV.length, 'mouvements de cote');
  } catch (err) { console.log('valeur / mouvements ignorés :', err.message); }
  // ---- Bilan vérifié : chaque probabilité d'avant-match est enregistrée, puis comparée au vrai résultat (scores de The Odds API) ----
  try {
    const SUIVI = 'docs/data/sharp_suivi.json', BILAN = 'docs/data/sharp_bilan.json';
    let sv = { depuis: new Date(now).toISOString().slice(0, 10), regle: 0, ev: {} };
    try { sv = JSON.parse(fs.readFileSync(SUIVI, 'utf8')); } catch (e) { }
    const sid = (k, h, a, t) => k + '|' + h + '|' + a + '|' + String(t).slice(0, 10);
    for (const e of events) {
      if (!(Date.parse(e.c) < Date.parse(e.t))) continue;
      const id = sid(e.k, e.h, e.a, e.t), o = sv.ev[id];
      if (!o || !o.res) {
        const n = { k: e.k, t: e.t, h: e.h, a: e.a, p: e.p, src: e.src, p0: (o && o.p0) || e.p, v: o && o.v };
        if (!n.v && e.ev) { const f = Object.keys(e.ev).find(x => e.ev[x] > 0.01 && e.p[x] >= 0.2); if (f) n.v = { f, cote: e.fr[f][0], book: e.fr[f][1], p: e.p[f], pris: new Date(now).toISOString() }; }
        sv.ev[id] = n;
      }      // dernière probabilité connue avant le coup d'envoi
    }
    const pend = {};
    for (const [id, o] of Object.entries(sv.ev)) {
      const t = Date.parse(o.t);
      if (t < now - 45 * 86400e3) { delete sv.ev[id]; continue; }
      if (!o.res && t < now - 3 * 3600e3) { if (t < now - 3 * 86400e3) o.res = '?'; else (pend[o.k] = pend[o.k] || []).push(id); }
    }
    if (Object.keys(pend).length && now - (sv.regle || 0) > 5.5 * 3600e3 && +left > 2000) {      // au plus 4 lectures de résultats par jour
      sv.regle = now; let lus = 0;
      for (const k of Object.keys(pend)) {
        try {
          const { data, cost, left: l } = await api('/sports/' + k + '/scores?daysFrom=3&dateFormat=iso'); spent += cost; left = l;
          for (const sc of data) {
            if (!sc.completed || !sc.scores) continue;
            const o = sv.ev[sid(k, sc.home_team, sc.away_team, sc.commence_time)]; if (!o || o.res) continue;
            const g = n => { const x = sc.scores.find(y => y.name === n); return x ? +x.score : NaN; }, hs = g(sc.home_team), as = g(sc.away_team);
            if (!isFinite(hs) || !isFinite(as)) continue;
            o.res = hs > as ? 'h' : hs < as ? 'a' : 'd'; o.sc = [hs, as]; lus++;
          }
        } catch (err) { console.log('résultats indisponibles', k, err.message); }
      }
      console.log(lus, 'résultats enregistrés ; crédits restants', left);
    }
    const fam = k => /^soccer_/.test(k) ? 'Football' : k === 'basketball_nba' ? 'NBA' : k === 'icehockey_nhl' ? 'NHL' : /^tennis_/.test(k) ? 'Tennis' : /^mma_/.test(k) ? 'MMA' : k === 'americanfootball_nfl' ? 'NFL' : /^rugby/.test(k) ? 'Rugby' : 'Autres';
    const vide = () => ({ n: 0, fav: 0, att: 0, n70: 0, w70: 0, a70: 0 }), B = { total: vide(), sports: {}, derniers: [] };
    const regles = Object.values(sv.ev).filter(o => o.res && o.res !== '?').sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
    for (const o of regles) {
      const iss = Object.keys(o.p), f = iss.reduce((a, b) => o.p[a] >= o.p[b] ? a : b), pf = o.p[f], ok = o.res === f ? 1 : 0;
      for (const S of [B.total, (B.sports[fam(o.k)] = B.sports[fam(o.k)] || vide())]) { S.n++; S.fav += ok; S.att += pf; if (pf >= 0.7) { S.n70++; S.w70 += ok; S.a70 += pf; } }
      if (pf >= 0.7 && B.derniers.length < 25) B.derniers.push({ t: o.t, s: fam(o.k), m: o.h + ' - ' + o.a, f: f === 'h' ? o.h : f === 'a' ? o.a : 'Nul', p: +pf.toFixed(3), ok: !!ok, sc: o.sc });
    }
    // CLV : cote prise comparée à la probabilité de clôture (dernière lecture avant le match). Positif = on a battu le marché.
    const VB = Object.values(sv.ev).filter(o => o.v), clv = VB.map(o => o.v.cote * o.p[o.v.f] - 1), vr = VB.filter(o => o.res && o.res !== '?');
    B.valeur = { paris: VB.length, clv_moy: clv.length ? +(clv.reduce((a, b) => a + b, 0) / clv.length).toFixed(4) : null, clv_pos: clv.filter(x => x > 0).length,
      regles: vr.length, gagnes: vr.filter(o => o.res === o.v.f).length, mise: vr.length, retour: +vr.reduce((a, o) => a + (o.res === o.v.f ? o.v.cote : 0), 0).toFixed(2),
      liste: VB.sort((a, b) => Date.parse(b.t) - Date.parse(a.t)).slice(0, 20).map(o => ({ t: o.t, m: o.h + ' - ' + o.a, nom: o.v.f === 'h' ? o.h : o.v.f === 'a' ? o.a : 'Nul', cote: o.v.cote, book: o.v.book, ev: +(o.v.cote * o.v.p - 1).toFixed(3), clv: +(o.v.cote * o.p[o.v.f] - 1).toFixed(3), res: o.res ? (o.res === '?' ? '?' : o.res === o.v.f ? 'gagné' : 'perdu') : null })) };
    B.a_venir = VAL.filter(x => Date.parse(x.t) > now).slice(0, 20); B.mouvements = MV.filter(x => Date.parse(x.t) > now).slice(0, 20);
    const arr = S => { S.att = +S.att.toFixed(1); S.a70 = +S.a70.toFixed(1); }; arr(B.total); Object.values(B.sports).forEach(arr);
    B.maj = new Date().toISOString(); B.depuis = sv.depuis; B.en_attente = Object.values(sv.ev).filter(o => !o.res).length;
    fs.mkdirSync('docs/data', { recursive: true });
    fs.writeFileSync(SUIVI, JSON.stringify(sv)); fs.writeFileSync(BILAN, JSON.stringify(B));
    console.log('bilan vérifié :', B.total.n, 'matchs réglés ;', B.en_attente, 'en attente');
  } catch (err) { console.log('bilan vérifié ignoré :', err.message); }
  if (!events.length) { console.log('rien à écrire : fichier précédent conservé'); return; }
  fs.mkdirSync('docs/data', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ maj: new Date().toISOString(), reste: left, n: events.length, events }));
})().catch(e => { console.log('erreur', e.message); process.exit(0); });
