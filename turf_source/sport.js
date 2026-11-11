/* Turf Analyste — module Sport : uniquement les compétitions ouvertes aux paris en France (liste ANJ)
   Source : flux publics ESPN (scoreboard + classements), relayés par Netlify. */
(function (root) {
  'use strict';
  var LEAGUES = [
    ['fra.1', 'Ligue 1'], ['fra.2', 'Ligue 2'], ['fra.coupe_de_france', 'Coupe de France'],
    ['eng.1', 'Premier League'], ['eng.2', 'Championship'], ['eng.fa', 'FA Cup'], ['eng.league_cup', 'League Cup'],
    ['esp.1', 'Liga'], ['esp.2', 'Liga 2'], ['esp.copa_del_rey', 'Coupe du Roi'],
    ['ita.1', 'Serie A'], ['ita.2', 'Serie B'], ['ita.coppa_italia', 'Coupe d\'Italie'],
    ['ger.1', 'Bundesliga'], ['ger.2', '2. Bundesliga'], ['ger.dfb_pokal', 'Coupe d\'Allemagne'],
    ['ned.1', 'Eredivisie'], ['por.1', 'Liga Portugal'], ['por.taca.portugal', 'Coupe du Portugal'], ['pol.1', 'Ekstraklasa'], ['bel.1', 'Pro League'], ['sco.1', 'Premiership (Écosse)'],
    ['tur.1', 'Süper Lig'], ['gre.1', 'Super League (Grèce)'], ['aut.1', 'Bundesliga (Autriche)'], ['sui.1', 'Super League (Suisse)'],
    ['den.1', 'Superliga (Danemark)'], ['nor.1', 'Eliteserien'], ['swe.1', 'Allsvenskan'], ['irl.1', 'Premier Division (Irlande)'],
    ['uefa.champions', 'Ligue des champions'], ['uefa.europa', 'Ligue Europa'], ['uefa.europa.conf', 'Conference League'], ['uefa.nations', 'Ligue des nations'],
    ['fifa.worldq.uefa', 'Qualif. Coupe du monde (Europe)'], ['fifa.friendly', 'Matchs amicaux'], ['uefa.euroq', 'Qualif. Euro'],
    ['usa.1', 'MLS'], ['mex.1', 'Liga MX'], ['bra.1', 'Brasileirão'], ['arg.1', 'Liga Argentina'], ['col.1', 'Liga Colombia'], ['chi.1', 'Primera (Chili)'],
    ['conmebol.libertadores', 'Copa Libertadores'], ['conmebol.sudamericana', 'Copa Sudamericana'],
    ['ecu.1', 'Serie A (Équateur)'], ['par.1', 'Primera (Paraguay)'], ['jpn.1', 'J1 League'], ['kor.1', 'K League 1'], ['ksa.1', 'Saudi Pro League'], ['aus.1', 'A-League'], ['chn.1', 'Super League (Chine)'],
    ['concacaf.champions', 'Ligue des champions CONCACAF'], ['afc.champions', 'Ligue des champions AFC'], ['caf.champions', 'Ligue des champions CAF']
  ].map(function (x) { return { id: x[0], name: x[1] }; });
  var US = [
    { sport: 'nba', path: 'basketball/nba', name: 'NBA', homeAdv: 0.3, cap: 25, sd: 12 },
    { sport: 'wnba', path: 'basketball/wnba', name: 'WNBA', homeAdv: 0.25, cap: 25, sd: 11 },
    { sport: 'nfl', path: 'football/nfl', name: 'NFL', homeAdv: 0.2, cap: 21, sd: 13.5 },
    { sport: 'nhl', path: 'hockey/nhl', name: 'NHL', homeAdv: 0.15, cap: 4, sd: 2.4 },
    { sport: 'mlb', path: 'baseball/mlb', name: 'MLB', homeAdv: 0.08, cap: 6, sd: 4.2 },
    { sport: 'rugby', path: 'rugby/270559', name: 'Top 14', homeAdv: 0.45, cap: 30, sd: 13 },
    { sport: 'rugby', path: 'rugby/267979', name: 'Premiership (Angleterre)', homeAdv: 0.35, cap: 30, sd: 13 },
    { sport: 'rugby', path: 'rugby/270557', name: 'United Rugby Championship', homeAdv: 0.35, cap: 30, sd: 13 },
    { sport: 'rugby', path: 'rugby/271937', name: 'Champions Cup', homeAdv: 0.35, cap: 30, sd: 13 },
    { sport: 'rugby', path: 'rugby/272073', name: 'Challenge Cup', homeAdv: 0.35, cap: 30, sd: 13 },
    { sport: 'rugby', path: 'rugby/180659', name: 'Tournoi des Six Nations', homeAdv: 0.3, cap: 30, sd: 13 },
    { sport: 'rugby', path: 'rugby/242041', name: 'Super Rugby', homeAdv: 0.3, cap: 30, sd: 13 },
    { sport: 'rugby', path: 'rugby/244293', name: 'Rugby Championship', homeAdv: 0.3, cap: 30, sd: 13 },
    { sport: 'rugby', path: 'rugby/289234', name: 'Tests internationaux', homeAdv: 0.25, cap: 30, sd: 14 }
  ];

  // ---------- historique de saison et notes de force ----------
  function dayN(d) { return Math.floor(d / 864e5); }
  function ymdOf(dn) { var d = new Date(dn * 864e5); return d.getUTCFullYear() + ('0' + (d.getUTCMonth() + 1)).slice(-2) + ('0' + d.getUTCDate()).slice(-2); }
  function parseGames(j) {
    var g = [];
    ((j && j.events) || []).forEach(function (ev) {
      var c = (ev.competitions || [])[0]; if (!c) return;
      if (!pick(c, 'status.type.completed') && !pick(ev, 'status.type.completed')) return;
      var ha = compsHA(c), H = ha[0], A = ha[1]; if (!H || !A) return;
      var hs = num(H.score && H.score.value != null ? H.score.value : H.score), as = num(A.score && A.score.value != null ? A.score.value : A.score);
      if (hs == null || as == null) return;
      g.push([dayN(new Date(ev.date).getTime()), String(pick(H, 'team.id')), String(pick(A, 'team.id')), hs, as, c.neutralSite ? 1 : 0]);
      // buteurs du match (événements « but » du flux), sans les buts contre son camp
      var sc = [];
      (c.details || []).forEach(function (d) {
        if (!d.scoringPlay || d.ownGoal) return;
        var ath = (d.athletesInvolved || d.participants || [])[0]; ath = ath && (ath.athlete || ath);
        var tid = String(pick(d, 'team.id') || pick(ath, 'team.id') || '');
        if (ath && ath.displayName && tid) sc.push([tid, ath.displayName, d.penaltyKick ? 1 : 0]);
      });
      // meilleur marqueur de chaque équipe (basket) : points du match
      [H, A].forEach(function (T) { (T.leaders || []).forEach(function (L) { if (!/^points$/i.test(L.name || '')) return; (L.leaders || []).slice(0, 1).forEach(function (l) { var nm = pick(l, 'athlete.displayName'), v = num(l.value); if (nm && v != null) sc.push([String(pick(T, 'team.id')), nm, 0, v]); }); }); });
      g[g.length - 1].push(sc);
    });
    return g;
  }
  // Historique : ESPN n'accepte plus les plages de dates (erreur 400). La bibliothèque est donc construite
  // jour par jour sur GitHub (data/hist/*.json) ; l'appli ne demande elle-même que les 4 derniers jours.
  var HIST_SRC = null;
  function setHistSource(fn) { HIST_SRC = fn; }
  function histKey(path) { return String(path).replace(/[^a-z0-9.]+/gi, '_'); }
  async function history(getJSON, path, q, store, todayN) {
    var key = 'sh3.' + path, st = store.get(key) || { to: 0, g: [] };
    var seen = {}; st.g.forEach(function (x) { seen[x.slice(0, 3).join('|')] = 1; });
    function add(list) { (list || []).forEach(function (x) { var k = x.slice(0, 3).join('|'); if (!seen[k]) { seen[k] = 1; st.g.push(x); } }); }
    if (HIST_SRC && (!st.srv || Date.now() - st.srv > 2 * 3600e3)) {
      try { var f = await HIST_SRC(histKey(path)); if (f && Array.isArray(f.g)) { add(f.g); st.to = Math.max(st.to, f.to || 0); st.srv = Date.now(); st.srvN = f.g.length; } } catch (e) { }
    }
    var from = Math.max(st.to + 1, todayN - 4), to = todayN - 1, failed = 0;
    for (var d = from; d <= to; d++) {
      try { add(parseGames(await getJSON('site/v2/sports/' + path + '/scoreboard?dates=' + ymdOf(d) + '&limit=300' + (q || '')))); if (!failed) st.to = d; }
      catch (e) { failed++; }
    }
    st.g = st.g.filter(function (x) { return x[0] >= todayN - 200; });
    store.set(key, st);
    return st.g;
  }
  function fitSoccer(G, todayN, before) {
    var g = G.filter(function (x) { return x[0] < before; }); if (g.length < 30) return null;
    var w = g.map(function (x) { return Math.exp(-0.006 * (todayN - x[0])); });
    var T = {}; g.forEach(function (x) { [x[1], x[2]].forEach(function (t) { T[t] = T[t] || { A: 1, D: 1, n: 0 }; }); T[x[1]].n++; T[x[2]].n++; });
    var tg = 0, tw = 0; g.forEach(function (x, i) { tg += w[i] * (x[3] + x[4]); tw += 2 * w[i]; });
    var c = tg / tw, H = 1.2, k = 2;
    for (var it = 0; it < 30; it++) {
      var nA = {}, dA = {}, nD = {}, dD = {};
      Object.keys(T).forEach(function (t) { nA[t] = dA[t] = nD[t] = dD[t] = 0; });
      g.forEach(function (x, i) {
        var h = T[x[1]], a = T[x[2]], hh = x[5] ? 1 : H, wi = w[i];
        nA[x[1]] += wi * x[3]; dA[x[1]] += wi * a.D * c * hh; nA[x[2]] += wi * x[4]; dA[x[2]] += wi * h.D * c;
        nD[x[1]] += wi * x[4]; dD[x[1]] += wi * a.A * c; nD[x[2]] += wi * x[3]; dD[x[2]] += wi * h.A * c * hh;
      });
      Object.keys(T).forEach(function (t) { T[t].A = (nA[t] + k * c) / (dA[t] + k * c * T[t].A ** 0) ; T[t].D = (nD[t] + k * c) / (dD[t] + k * c); });
      var mA = 0, mD = 0, n = 0; Object.keys(T).forEach(function (t) { mA += T[t].A; mD += T[t].D; n++; }); mA /= n; mD /= n;
      Object.keys(T).forEach(function (t) { T[t].A /= mA; T[t].D /= mD; });
      var gN = 0, gD = 0, hN = 0, hD = 0;
      g.forEach(function (x, i) { var h = T[x[1]], a = T[x[2]], hh = x[5] ? 1 : H; gN += w[i] * (x[3] + x[4]); gD += w[i] * (hh * h.A * a.D + a.A * h.D); if (!x[5]) { hN += w[i] * x[3]; hD += w[i] * h.A * a.D; } });
      c = gN / gD; if (hD) H = Math.max(0.9, Math.min(1.6, hN / (hD * c)));
    }
    return { T: T, c: c, H: H, n: g.length };
  }
  function fitMargin(G, todayN, before, lg) {
    var g = G.filter(function (x) { return x[0] < before; }); if (g.length < 40) return null;
    var w = g.map(function (x) { return Math.exp(-0.008 * (todayN - x[0])); }), R = {}, N = {}, h = 0;
    g.forEach(function (x) { R[x[1]] = 0; R[x[2]] = 0; N[x[1]] = (N[x[1]] || 0) + 1; N[x[2]] = (N[x[2]] || 0) + 1; });
    var m = g.map(function (x) { return Math.max(-lg.cap, Math.min(lg.cap, x[3] - x[4])); });
    for (var it = 0; it < 40; it++) {
      var hn = 0, hw = 0; g.forEach(function (x, i) { if (x[5]) return; hn += w[i] * (m[i] - (R[x[1]] - R[x[2]])); hw += w[i]; }); h = hw ? hn / hw : 0;
      var S = {}, W = {}; Object.keys(R).forEach(function (t) { S[t] = 0; W[t] = 3; });
      g.forEach(function (x, i) { var hh = x[5] ? 0 : h; S[x[1]] += w[i] * (m[i] - hh + R[x[2]]); W[x[1]] += w[i]; S[x[2]] += w[i] * (-(m[i] - hh) + R[x[1]]); W[x[2]] += w[i]; });
      var mean = 0, n = 0; Object.keys(R).forEach(function (t) { R[t] = S[t] / W[t]; mean += R[t]; n++; }); Object.keys(R).forEach(function (t) { R[t] -= mean / n; });
    }
    var ss = 0, sw = 0; g.forEach(function (x, i) { var e = m[i] - ((x[5] ? 0 : h) + R[x[1]] - R[x[2]]); ss += w[i] * e * e; sw += w[i]; });
    var sd = Math.max(lg.sd * 0.85, Math.sqrt(ss / sw));
    return { R: R, N: N, h: h, sd: sd, n: g.length };
  }
  function Phi(x) { var t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
  function soccerProbs(lh, la) {
    var p1 = 0, px = 0, p2 = 0, Z = 0, M = [], rho = -0.08;
    for (var i = 0; i <= 10; i++) for (var j = 0; j <= 10; j++) {
      var t = i === 0 && j === 0 ? 1 - lh * la * rho : i === 0 && j === 1 ? 1 + lh * rho : i === 1 && j === 0 ? 1 + la * rho : i === 1 && j === 1 ? 1 - rho : 1;
      var p = pois(lh, i) * pois(la, j) * t; M.push([i, j, p]); Z += p;
    }
    M.forEach(function (m) { m[2] /= Z; if (m[0] > m[1]) p1 += m[2]; else if (m[0] === m[1]) px += m[2]; else p2 += m[2]; });
    return { M: M, p: [p1, px, p2] };
  }
  // backtest : on refait le modèle sans les 21 derniers jours et on le confronte aux résultats réels
  function backtest(G, todayN, kind, lg, cal, sport) {
    var cut = todayN - 21, recent = G.filter(function (x) { return x[0] >= cut; }); if (!recent.length) return;
    if (kind === 'foot') {
      var F = fitSoccer(G, todayN, cut); if (!F) return;
      recent.forEach(function (x) {
        var h = F.T[x[1]], a = F.T[x[2]]; if (!h || !a || h.n < 4 || a.n < 4) return;
        var P = soccerProbs(F.c * (x[5] ? 1 : F.H) * h.A * a.D, F.c * a.A * h.D).p;
        var fav = P[0] >= P[2] ? 0 : 2, res = x[3] > x[4] ? 0 : x[3] === x[4] ? 1 : 2;
        cal.push([P[fav], res === fav ? 1 : 0, sport, 'win']); cal.push([P[fav] + P[1], res !== 2 - fav ? 1 : 0, sport, 'dc']);
      });
    } else {
      var R = fitMargin(G, todayN, cut, lg); if (!R) return;
      recent.forEach(function (x) {
        if (R.R[x[1]] == null || R.R[x[2]] == null || R.N[x[1]] < 4 || R.N[x[2]] < 4 || x[3] === x[4]) return;
        var p = Phi(((x[5] ? 0 : R.h) + R.R[x[1]] - R.R[x[2]]) / R.sd), fav = p >= 0.5;
        cal.push([fav ? p : 1 - p, (fav ? x[3] > x[4] : x[4] > x[3]) ? 1 : 0, sport, 'win']);
      });
    }
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function sig(x) { return 1 / (1 + Math.exp(-x)); }
  function logit(p) { p = Math.min(0.995, Math.max(0.005, p)); return Math.log(p / (1 - p)); }
  function pct(x) { return Math.round(x * 100) + ' %'; }
  function mlToP(ml) {
    if (ml == null) return null; if (typeof ml === 'string') { if (/even/i.test(ml)) return 0.5; ml = parseFloat(ml.replace('+', '')); }
    if (!isFinite(ml) || ml === 0) return null; return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100);
  }
  function mlToDec(ml) { var p = mlToP(ml); if (p == null) return null; if (typeof ml === 'string') ml = parseFloat(ml.replace('+', '')); return ml < 0 ? 1 + 100 / -ml : 1 + ml / 100; }
  function pick(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function oddsOf(comp) {
    var o = (comp.odds || [])[0]; if (!o) return null;
    var g = function (side) {
      return o[side + 'TeamOdds'] && o[side + 'TeamOdds'].moneyLine != null ? o[side + 'TeamOdds'].moneyLine
        : pick(o, 'moneyline.' + side + '.close.odds') != null ? pick(o, 'moneyline.' + side + '.close.odds') : pick(o, 'moneyline.' + side + '.open.odds');
    };
    var draw = o.drawOdds && o.drawOdds.moneyLine != null ? o.drawOdds.moneyLine : pick(o, 'moneyline.draw.close.odds');
    return { home: g('home'), away: g('away'), draw: draw, spread: num(o.spread), ou: num(o.overUnder), details: o.details || '', provider: pick(o, 'provider.name') || '' };
  }
  function rec(c, kind) {
    var r = (c.records || []).filter(function (x) {
      var t = (x.type || '') + ' ' + (x.name || '');
      return kind === 'total' ? /total|overall|all splits|ytd/i.test(t) : new RegExp(kind === 'home' ? 'home' : 'road|away', 'i').test(t);
    })[0];
    if (!r && kind === 'total') r = (c.records || [])[0];
    if (!r || !r.summary) return null;
    var p = r.summary.split('-').map(function (x) { return parseInt(x, 10) || 0; });
    return { s: r.summary, w: p[0] || 0, l: p[1] || 0, t: p[2] || 0 };
  }
  function state(ev, comp) {
    var st = (comp && comp.status) || ev.status || {}; var t = st.type || {};
    var tx = t.shortDetail || t.detail || '';
    if ((t.state || 'pre') === 'pre') tx = /postpon/i.test(tx) ? 'Reporté' : /cancel/i.test(tx) ? 'Annulé' : '';
    else tx = tx.replace(/^Final(\/OT|\/SO)?$/i, function (m0, o) { return 'Terminé' + (o ? (o === '/SO' ? ' (tirs au but)' : ' (prolongation)') : ''); }).replace(/^FT$/, 'Terminé').replace(/^HT$|Halftime/i, 'Mi-temps').replace(/^(\d)(st|nd|rd|th)$/, '$1e set').replace(/(\d)(st|nd|rd|th) Quarter/i, '$1e quart-temps').replace(/(\d)(st|nd|rd|th) Period/i, '$1e période').replace(/End of /i, 'Fin du ').replace(/Top /, 'Haut ').replace(/Bot /, 'Bas ').replace(/Delayed/i, 'Retardé').replace(/Rain Delay/i, 'Interrompu (pluie)').replace(/(\d)(st|nd|rd|th)\b/g, '$1e').replace(/\bOT\b/, 'prolongation');
    return { state: t.state || 'pre', done: !!t.completed, txt: tx, period: num(st.period) || 0, clock: num(st.clock), disp: st.displayClock || '', half: /half|mi-temps|HT/i.test(t.shortDetail || t.name || '') };
  }
  // ---------- simulations Monte-Carlo (avant-match et en direct) ----------
  var NSIM = 20000;
  function rng(seed) { var a = seed >>> 0 || 1; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function poisR(l, R) { if (l <= 0) return 0; var L = Math.exp(-l), k = 0, p = 1; do { k++; p *= R(); } while (p > L); return k - 1; }
  function gaussR(R) { var u = 1 - R(), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  // fraction de match restant
  var DUR = { nba: [4, 720], wnba: [4, 600], nfl: [4, 900], nhl: [3, 1200], rugby: [2, 2400], mlb: [9, 0] };
  function remaining(x) {
    var st = x.state; if (st.state === 'pre') return 1; if (st.done) return 0;
    if (x.sport === 'foot') {
      var m = null, d = String(st.disp || st.txt || '').match(/(\d+)(?:'|\+)/); if (d) m = +d[1];
      if (m == null && st.clock != null) m = st.clock / 60;
      if (st.half || /HT|Half/i.test(st.txt)) m = 45;
      if (m == null) m = st.period >= 2 ? 60 : 20;
      return Math.max(0.01, (93 - Math.min(m, 92)) / 93);
    }
    var D = DUR[x.sport]; if (!D) return 0.5;
    if (x.sport === 'mlb') return Math.max(0.02, (9 - Math.max(0, st.period - 1)) / 9);
    var per = Math.max(1, st.period || 1), left = st.clock != null ? st.clock : D[1] / 2;
    if (per > D[0]) return 0.03; // prolongation
    return Math.max(0.01, ((D[0] - per) * D[1] + Math.min(left, D[1])) / (D[0] * D[1]));
  }
  // Simulation minute par minute (modèle à intensités variables, type Dixon-Robinson) :
  //  - rythme de buts croissant au fil du match (≈ 45 % des buts en 1re mi-temps, pic en fin de match),
  //  - effet du score : l'équipe menée accélère, celle qui mène gère ; plus fort pour la grosse équipe menée,
  //  - cartons rouges, domination réelle (tirs cadrés, possession) pendant le match.
  function minuteW(t) { return 0.80 + 0.40 * (t / 90) + (t >= 88 ? 0.35 : 0); }
  var WTOT = (function () { var s = 0; for (var t = 0; t < 94; t++) s += minuteW(t); return s; })();
  function minuteNow(x) {
    var st = x.state; if (st.state === 'pre') return 0; if (st.done) return 94;
    var d = String(st.disp || st.txt || '').match(/(\d+)(?:'|\+)/), m = d ? +d[1] : null;
    if (m == null && st.clock != null) m = st.clock / 60;
    if (st.half || /HT|Half/i.test(st.txt)) m = 45;
    if (m == null) m = st.period >= 2 ? 60 : 20;
    return Math.min(93, Math.max(0, m));
  }
  function simFoot(x, withBuilder) {
    if (!x.lam) return null;
    var live = x.live && x.live[0] != null && x.state.state === 'in';
    var R = rng(hash(x.id + '|' + (live ? x.live.join('-') : '') + '|' + x.state.txt)), m0 = live ? Math.floor(minuteNow(x)) : 0;
    var E = x.enr || {}, rh = 1, ra = 1, notes = [];
    // cartons rouges
    if (E.reds) { var r0 = E.reds[0], r1 = E.reds[1]; if (r0 || r1) { rh *= Math.pow(0.72, r0) * Math.pow(1.18, r1); ra *= Math.pow(0.72, r1) * Math.pow(1.18, r0); notes.push('cartons rouges ' + r0 + '-' + r1); } }
    // domination mesurée pendant le match
    if (live && E.stats) { var so = E.stats.sot, tot = so[0] + so[1]; if (tot >= 3) { var dom = Math.max(-1, Math.min(1, (so[0] - so[1]) / Math.max(4, tot))); rh *= 1 + 0.18 * dom; ra *= 1 - 0.18 * dom; notes.push('tirs cadrés ' + so[0] + '-' + so[1]); } }
    var strongH = x.lam[0] > x.lam[1] * 1.3, strongA = x.lam[1] > x.lam[0] * 1.3;
    var bh = x.lam[0] * rh / WTOT, ba = x.lam[1] * ra / WTOT;
    var h0 = live ? x.live[0] : 0, a0 = live ? x.live[1] : 0, w1 = 0, wx = 0, w2 = 0, mainOk = 0, sc = {}, comeback = 0, trailing = h0 !== a0;
    var T0 = h0 + a0, tot = {}, nextH = 0, nextA = 0, btts = 0;
    // buteurs possibles de chaque équipe (3 premiers) pour attribuer chaque but simulé
    var SW = [0, 1].map(function (k) {
      var L = x.hsc && x.hsc[String(k ? x.aid : x.hid)] || [], st = E.lineups && E.lineups[k] ? E.lineups[k].starters : null;
      var inj = E.abs ? E.abs[k].list.filter(function (p) { return /out|absent|suspen|doubt/i.test(p.status); }).map(function (p) { return p.name; }) : [];
      return L.filter(function (p) { return inj.indexOf(p.name) < 0; }).slice(0, 3).map(function (p) { var sh = (p.goals + 0.3) / (p.goals / Math.max(p.share, 0.01) + 3); return { name: p.name, w: sh * (st ? (st.indexOf(p.name) >= 0 ? 0.92 : 0.25) : 0.80) / 0.85 }; });
    });
    var OUT = withBuilder ? new Array(NSIM) : null; // issue de chaque match simulé, pour les montages de paris (calculés à l'ouverture de la fiche)
    for (var i = 0; i < NSIM; i++) {
      var h = h0, a = a0;
      var first = 0, fm = -1, fs = -1, mask = 0, hh = h0, ha = a0;
      for (var t = m0; t < 94; t++) {
        var w = minuteW(t), d = h - a, fh = 1, fa = 1;
        if (d < 0) { fh = d === -1 ? 1.20 : 1.32; fa = 0.90; if (strongH) fh *= 1.10; }
        else if (d > 0) { fa = d === 1 ? 1.20 : 1.32; fh = 0.90; if (strongA) fa *= 1.10; }
        for (var side = 0; side < 2; side++) {
          if (R() < (side ? ba * w * fa : bh * w * fh)) {
            if (side) a++; else h++;
            var u = R(), acc = 0, who = -1, L2 = SW[side];
            for (var q = 0; q < L2.length; q++) { acc += L2[q].w; if (u < acc) { who = q; break; } }
            if (who >= 0) mask |= 1 << (side * 3 + who);
            if (!first) { first = side + 1; fm = t; fs = who >= 0 ? side * 3 + who : -1; }
          }
        }
        if (t === 45) { hh = h; ha = a; }
      }
      if (OUT) OUT[i] = [h, a, first, fm, fs, mask, hh, ha];
      tot[h + a] = (tot[h + a] || 0) + 1; if (first === 1) nextH++; else if (first === 2) nextA++; if (h > 0 && a > 0) btts++;
      var k = h + '-' + a; sc[k] = (sc[k] || 0) + 1;
      if (h > a) w1++; else if (h === a) wx++; else w2++;
      if (x.main && x.main.ok && x.main.ok(h, a)) mainOk++;
      if (trailing && ((h0 < a0 && h >= a) || (a0 < h0 && a >= h))) comeback++;
    }
    var top = Object.keys(sc).sort(function (u, v) { return sc[v] - sc[u]; }).slice(0, 5).map(function (k) { return [k, sc[k] / NSIM]; });
    // propositions de paris à l'instant T
    var props = [], P = function (lab, p, kind) { props.push({ label: lab, p: p, kind: kind }); };
    var over = function (k) { var c = 0; Object.keys(tot).forEach(function (g) { if (+g > k) c += tot[g]; }); return c / NSIM; };
    for (var k = T0; k <= T0 + 2; k++) { var po = over(k + 0.5); P('Plus de ' + (k + 0.5).toString().replace('.', ',') + ' buts', po, 'total'); P('Moins de ' + (k + 0.5).toString().replace('.', ',') + ' buts', 1 - po, 'total'); }
    P('Victoire ' + x.home, w1 / NSIM, 'res'); P('Match nul', wx / NSIM, 'res'); P('Victoire ' + x.away, w2 / NSIM, 'res');
    P(x.home + ' ou nul', (w1 + wx) / NSIM, 'dc'); P(x.away + ' ou nul', (w2 + wx) / NSIM, 'dc'); P(x.home + ' ou ' + x.away + ' (pas de nul)', (w1 + w2) / NSIM, 'dc');
    if (!(h0 > 0 && a0 > 0)) { P('Les deux équipes marquent', btts / NSIM, 'btts'); P('Au moins une équipe ne marque pas', 1 - btts / NSIM, 'btts'); }
    if (live) { P('Prochain but : ' + x.home, nextH / NSIM, 'next'); P('Prochain but : ' + x.away, nextA / NSIM, 'next'); P('Plus aucun but', 1 - (nextH + nextA) / NSIM, 'next'); }
    var res = { n: NSIM, r: Math.max(0, 94 - m0) / 94, p: [w1 / NSIM, wx / NSIM, w2 / NSIM], main: mainOk / NSIM, top: top, comeback: trailing ? comeback / NSIM : null, minute: m0, notes: notes, props: props };
    if (OUT) res.builder = builder(x, OUT, SW, live && T0 > 0, m0);
    return res;
  }

  // ---------- montages de paris (Créa Bet) : probabilité jointe lue directement sur les matchs simulés ----------
  function builder(x, OUT, SW, goalAlready, m0) {
    var N = OUT.length, legs = [], H = x.home, A = x.away;
    function L(id, label, f, grp) { var c = 0; for (var i = 0; i < N; i++) if (f(OUT[i])) c++; legs.push({ id: id, label: label, f: f, p: c / N, grp: grp }); }
    var fav = x.lam[0] >= x.lam[1] ? 0 : 1, F = fav ? A : H, O = fav ? H : A;
    var fW = function (o) { return fav ? o[1] > o[0] : o[0] > o[1]; };
    L('w', 'Victoire ' + F, fW, 'res');
    L('dc', F + ' ou nul', function (o) { return fav ? o[1] >= o[0] : o[0] >= o[1]; }, 'res');
    L('w2', F + ' gagne par 2 buts ou plus', function (o) { return (fav ? o[1] - o[0] : o[0] - o[1]) >= 2; }, 'res');
    L('cs', F + ' gagne sans encaisser', function (o) { return fW(o) && (fav ? o[0] : o[1]) === 0; }, 'res');
    L('ht', F + ' mène à la pause et gagne', function (o) { return fW(o) && (fav ? o[7] > o[6] : o[6] > o[7]); }, 'res');
    [1.5, 2.5, 3.5].forEach(function (k) { L('o' + k, 'Plus de ' + String(k).replace('.', ',') + ' buts', function (o) { return o[0] + o[1] > k; }, 'tot'); L('u' + k, 'Moins de ' + String(k).replace('.', ',') + ' buts', function (o) { return o[0] + o[1] < k; }, 'tot'); });
    L('btts', 'Les deux équipes marquent', function (o) { return o[0] > 0 && o[1] > 0; }, 'btts');
    L('nbtts', O + ' ne marque pas', function (o) { return (fav ? o[0] : o[1]) === 0; }, 'btts');
    if (!goalAlready) {
      L('ff', F + ' marque le premier but', function (o) { return o[2] === fav + 1; }, 'first');
      [[0, 15], [0, 30], [16, 30], [31, 45], [46, 60], [61, 75], [76, 94]].forEach(function (w) {
        if (w[1] <= m0) return;
        L('t' + w[0], 'Premier but ' + (w[0] === 0 ? 'avant la ' + w[1] + 'e' : w[1] === 94 ? 'après la 75e' : 'entre la ' + w[0] + 'e et la ' + w[1] + 'e'), function (o) { return o[3] >= w[0] && o[3] < w[1]; }, 'time');
      });
    }
    var scorers = [];
    [0, 1].forEach(function (k) { (SW[k] || []).forEach(function (p, j) {
      var bit = 1 << (k * 3 + j);
      L('s' + k + j, p.name + ' buteur', function (o) { return (o[5] & bit) !== 0; }, 'sc' + k);
      if (!goalAlready) L('fs' + k + j, p.name + ' premier buteur', function (o) { return o[4] === k * 3 + j; }, 'fs');
      scorers.push(p.name);
    }); });
    // marchés seuls (premier buteur, période du premier but)
    var singles = legs.filter(function (l) { return l.grp === 'fs' || l.grp === 'time'; }).sort(function (a, b) { return b.p - a.p; });
    // combinaisons de 2 ou 3 éléments : un seul par famille, et chaque élément doit vraiment ajouter quelque chose
    var pool = legs.filter(function (l) { return l.p >= 0.10 && l.p <= 0.97; }), combos = [], PAIR = {};
    function joint(ls) { var c = 0; for (var n = 0; n < N; n++) { var o = OUT[n], ok = true; for (var z = 0; z < ls.length; z++) if (!ls[z].f(o)) { ok = false; break; } if (ok) c++; } return c / N; }
    var fam = function (l) { return l.grp === 'fs' ? 'first' : l.grp.indexOf('sc') === 0 ? 'sc' : l.grp; };
    for (var i = 0; i < pool.length; i++) for (var j = i + 1; j < pool.length; j++) {
      if (fam(pool[i]) === fam(pool[j])) continue;
      var p2 = joint([pool[i], pool[j]]); PAIR[i + '|' + j] = p2;
      if (p2 >= 0.05 && p2 < Math.min(pool[i].p, pool[j].p) - 0.02) combos.push({ ls: [pool[i], pool[j]], p: p2 });
    }
    for (i = 0; i < pool.length; i++) for (j = i + 1; j < pool.length; j++) for (var k = j + 1; k < pool.length; k++) {
      var f3 = [fam(pool[i]), fam(pool[j]), fam(pool[k])]; if (f3[0] === f3[1] || f3[0] === f3[2] || f3[1] === f3[2]) continue;
      var pr = [PAIR[i + '|' + j], PAIR[i + '|' + k], PAIR[j + '|' + k]]; if (pr.some(function (v) { return v == null || v < 0.05; })) continue;
      var p3 = joint([pool[i], pool[j], pool[k]]);
      if (p3 >= 0.05 && p3 < Math.min.apply(null, pr) - 0.02) combos.push({ ls: [pool[i], pool[j], pool[k]], p: p3 });
    }
    combos.forEach(function (c) { c.legs = c.ls.map(function (l) { return l.label; }); c.ids = c.ls.map(function (l) { return l.id; }); c.lift = c.p / c.ls.reduce(function (s, l) { return s * l.p; }, 1); c.focus = c.ls.filter(function (l) { return /^(w|dc|w2|cs|ht|ff|s0|s1|fs)/.test(l.id) && l.label.indexOf(F) >= 0 || /^s|^fs/.test(l.id); }).length; });
    function band(lo, hi, k) {
      var L2 = combos.filter(function (c) { return c.p >= lo && c.p < hi; }).sort(function (a, b) { return (b.focus - a.focus) || (a.p - b.p); }), out = [];
      L2.forEach(function (c) { if (out.length >= k) return; if (out.some(function (o) { return o.ids.filter(function (id) { return c.ids.indexOf(id) >= 0; }).length >= 2; })) return; out.push({ legs: c.legs, ids: c.ids, p: c.p, lift: c.lift }); });
      return out;
    }
    return { sur: band(0.50, 0.90, 3), equilibre: band(0.25, 0.50, 3), grosse: band(0.06, 0.25, 3), singles: singles.slice(0, 8) };
  }
  function simUS(x) {
    if (x.mu == null) return null;
    var R = rng(hash(x.id + '|' + (x.live ? x.live.join('-') : '') + '|' + x.state.txt)), r = remaining(x);
    var m0 = x.live && x.live[0] != null ? x.live[0] - x.live[1] : 0, win = 0, mg = {};
    for (var i = 0; i < NSIM; i++) {
      var m = m0 + x.mu * r + x.sdm * Math.sqrt(r) * gaussR(R);
      if (m > 0 || (m === 0 && R() < 0.5)) win++;
      var noTie = x.sport === 'nhl' || x.sport === 'mlb', b = noTie ? Math.round(m) : Math.round(m / 5) * 5;
      if (noTie && b === 0) b = m > 0 ? 1 : m < 0 ? -1 : (R() < 0.5 ? 1 : -1);   // égalité : prolongation / manches supplémentaires, gagnées d'un point
      mg[b] = (mg[b] || 0) + 1;
    }
    var top = Object.keys(mg).sort(function (u, v) { return mg[v] - mg[u]; }).slice(0, 5).map(function (k) { return [k, mg[k] / NSIM]; });
    var ph = win / NSIM;
    var props = [{ label: 'Victoire ' + x.home, p: ph, kind: 'res' }, { label: 'Victoire ' + x.away, p: 1 - ph, kind: 'res' }];
    // handicaps : écart final simulé
    var keys = Object.keys(mg).map(Number), cover = function (line) { var c = 0; keys.forEach(function (k) { if (k + line > 0) c += mg[k]; }); return c / NSIM; };
    var step = x.sport === 'nhl' || x.sport === 'mlb' ? 1.5 : 5.5;
    [-step, step].forEach(function (l) { props.push({ label: x.home + ' ' + (l > 0 ? '+' : '') + l.toString().replace('.', ','), p: cover(l), kind: 'hcp' }); });
    return { n: NSIM, r: r, p: [ph, 0, 1 - ph], main: x.favHome ? ph : 1 - ph, top: top, margin: true, props: props };
  }
  var CALUS = { nba: 0.70, nhl: 0.55, wnba: 0.8 }, CALFOOT = 0.80;
  var EXT = {};
  function nrm(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function setExtern(sp) {
    EXT = {};
    Object.keys(sp || {}).forEach(function (k) {
      var S = sp[k], m = {}, b = S.bibliotheque || {}, t = S.banc_essai || {};
      (S.a_venir || []).forEach(function (r) { if (r.p_dom != null) m[nrm(r.dom) + '|' + nrm(r.ext)] = r; });
      EXT[k] = { m: m, base: (b.rencontres || 0).toLocaleString('fr-FR') + ' matchs ' + (S.nom || k) + ' depuis ' + (b.debut || '').slice(0, 7), test: t.matchs ? 'Testé sur ' + t.matchs.toLocaleString('fr-FR') + ' matchs : le favori Elo gagne ' + pct(t.reussite_favori) + '.' : '' };
    });
  }
  function extP(k, na, nb) {
    var T = EXT[k]; if (!T) return null;
    var r = T.m[nrm(na) + '|' + nrm(nb)], inv = false; if (!r) { r = T.m[nrm(nb) + '|' + nrm(na)]; inv = true; }
    if (!r || r.fiable === false) return null;
    return { p: inv ? 1 - r.p_dom : r.p_dom, ea: inv ? r.elo_ext : r.elo_dom, eb: inv ? r.elo_dom : r.elo_ext, base: T.base, test: T.test };
  }
  function setProb(p, bo) { var lo = 0.01, hi = 0.99; for (var i = 0; i < 40; i++) { var q = (lo + hi) / 2, m = bo === 5 ? q * q * q * (10 - 15 * q + 6 * q * q) : q * q * (3 - 2 * q); if (m < p) lo = q; else hi = q; } return (lo + hi) / 2; }
  // probabilité de gagner le set en cours depuis le score en jeux (i, j), jeu gagné avec la probabilité g, tie-break à 6-6
  function setFrom(g, i, j) {
    var memo = {};
    function f(a, b) {
      if (a >= 6 && a - b >= 2) return 1; if (b >= 6 && b - a >= 2) return 0; if (a === 7) return 1; if (b === 7) return 0;
      if (a === 6 && b === 6) return g;
      var k = a + ',' + b; if (memo[k] != null) return memo[k];
      return (memo[k] = g * f(a + 1, b) + (1 - g) * f(a, b + 1));
    }
    return f(Math.min(i, 7), Math.min(j, 7));
  }
  function gameProb(q) { var lo = 0.2, hi = 0.8; for (var it = 0; it < 40; it++) { var m = (lo + hi) / 2; if (setFrom(m, 0, 0) < q) lo = m; else hi = m; } return (lo + hi) / 2; }
  function simTennis(x) {
    if (x.pA == null) return null;
    var bo = x.bo || 3, need = (bo + 1) / 2, q = setProb(x.pA, bo), sw = x.setsWon || [0, 0], R = rng(hash(x.id + '|' + sw.join('-') + '|' + (x.curSet || []).join('-'))), win = 0;
    var qCur = x.curSet ? setFrom(gameProb(q), x.curSet[0], x.curSet[1]) : null;   // set en cours : on part du score en jeux
    for (var i = 0; i < NSIM; i++) { var a = sw[0], b = sw[1]; if (qCur != null) { if (R() < qCur) a++; else b++; } while (a < need && b < need) { if (R() < q) a++; else b++; } if (a === need) win++; }
    var pa = win / NSIM;
    return { n: NSIM, r: null, p: [pa, 0, 1 - pa], main: x.favA ? pa : 1 - pa };
  }
  function simulate(x) {
    if (x.nodata) { x.sim = null; return x; }
    var S = x.sport === 'foot' ? simFoot(x) : x.sport === 'tennis' ? simTennis(x) : x.sport === 'mma' ? null : simUS(x);
    x.sim = S;
    x.lv = null;
    if (S && x.state.state === 'in') {
      x.lvP = S.main;
      // Pronostic en direct : si le pari d'avant-match est passé sous 50 %, on affiche le favori ACTUEL (jamais un perdant donné « solide »)
      var P = S.p || [], nm = [x.home, 'Match nul', x.away], lvl = function (q) { return q >= 0.75 ? 'SEC' : q >= 0.62 ? 'FORT' : 'DOUTE'; };
      if (S.main >= 0.5) x.lv = { label: x.main.label, p: S.main, level: lvl(S.main), switched: false };
      else {
        var bi = 0; for (var q = 1; q < P.length; q++) if (P[q] > P[bi]) bi = q;
        var dc = x.sport === 'foot' ? Math.max(P[0] + P[1], P[1] + P[2]) : 0;
        if (x.sport === 'foot' && P[bi] < 0.5 && dc >= 0.62) x.lv = { label: (P[0] >= P[2] ? x.home : x.away) + ' ou nul', p: dc, level: lvl(dc), switched: true };
        else x.lv = { label: bi === 1 ? 'Match nul' : 'Victoire ' + nm[bi], p: P[bi], level: lvl(P[bi]), switched: true };
      }
    }
    if (x.sport === 'foot') x.buteurs = scorerProbs(x);
    if (x.sport === 'nba' || x.sport === 'wnba') x.points = pointsProps(x);
    return x;
  }

  // ---------- buteurs : meilleurs buteurs de la compétition, croisés avec les buts attendus du match ----------
  function parseScorers(j) {
    var out = {}, seen = {}, NAMES = {};
    (j && j.categories || []).forEach(function (c) { if (Array.isArray(c.names)) NAMES[c.name] = c.names; });
    function add(name, tid, goals, aid) { if (!name || tid == null || !(goals >= 0)) return; var k = String(tid) + '|' + name; if (seen[k] && seen[k].goals >= goals) return; var o = { name: name, goals: goals, id: aid }; seen[k] = o; out[tid] = (out[tid] || []).filter(function (x) { return x.name !== name; }); out[tid].push(o); }
    (function walk(n, cat) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(function (x) { walk(x, cat); }); return; }
      var nm = String(n.name || n.displayName || n.abbreviation || n.label || '');
      var c = /goal|^g$|buts?$/i.test(nm) && !/assist|against|conced|keeper|save|per|ratio|own/i.test(nm) ? 'goals' : cat;
      var ath = n.athlete || (n.athletes && n.athletes[0] && n.athletes[0].athlete);
      if (ath && c === 'goals') {
        var tid = pick(ath, 'team.id') || pick(n, 'team.id') || pick(ath, 'teams.0.id');
        var v = num(n.value != null ? n.value : n.displayValue);
        add(ath.displayName || ath.fullName || ath.shortName, tid, v, ath.id);
      }
      if (ath && Array.isArray(n.categories)) {   // format « byathlete » : noms en tête, valeurs par joueur
        n.categories.forEach(function (c) { var nms = c.names || NAMES[c.name] || [], vals = c.values || c.totals || []; var gi = nms.indexOf('goals'); if (gi < 0) gi = nms.indexOf('totalGoals'); if (gi >= 0) add(ath.displayName || ath.fullName, pick(ath, 'teams.0.id') || pick(ath, 'team.id') || ath.teamId || pick(n, 'team.id'), num(vals[gi]), ath.id); });
      }
      if (ath && Array.isArray(n.statistics || n.stats)) {   // format « par joueur » : { athlete, stats/categories }
        (n.statistics || n.stats).forEach(function (st, i) { var nm2 = String(st.name || st.abbreviation || (Array.isArray(n.names) ? n.names[i] : '') || ''); if (/^(goals|totalGoals|g)$/i.test(nm2)) add(ath.displayName, pick(ath, 'team.id') || pick(n, 'team.id'), num(st.value != null ? st.value : st.displayValue), ath.id); });
      }
      Object.keys(n).forEach(function (k) { if (k !== 'athlete') walk(n[k], c); });
    })(j, null);
    Object.keys(out).forEach(function (t) { out[t].sort(function (a, b) { return b.goals - a.goals; }); out[t] = out[t].slice(0, 12); });
    return Object.keys(out).length ? out : null;
  }
  var SC_PATHS = function (lid) { return ['site/v2/sports/soccer/' + lid + '/statistics', 'https://site.web.api.espn.com/apis/common/v3/sports/soccer/' + lid + '/statistics/byathlete?category=general&sort=general.goals:desc&limit=200', 'site/v2/sports/soccer/' + lid + '/leaders']; };
  async function scorers(getJSON, lid, store, ymd) {
    var key = 'sc.' + lid, c = store.get(key);
    if (c && c.d === ymd) return c.s;
    var res = null, P = SC_PATHS(lid);
    for (var i = 0; i < P.length && !res; i++) { try { res = parseScorers(await getJSON(P[i])); } catch (e) { } }
    store.set(key, { d: ymd, s: res });
    return res;
  }
  // début de la saison en cours : dernière coupure d'au moins 25 jours sans match dans la compétition
  function seasonStart(G) {
    var d = (G || []).map(function (x) { return x[0]; }).sort(function (a, b) { return a - b; }), st = d.length ? d[0] : 0;
    for (var i = 1; i < d.length; i++) if (d[i] - d[i - 1] >= 25) st = d[i];
    return st;
  }
  function teamScorers(G, todayN) {
    var T = {}, games = {}, s0 = seasonStart(G);
    // seulement la saison en cours : un joueur transféré l'été n'est pas compté dans son ancien club
    (G || []).filter(function (x) { return x[0] >= s0; }).forEach(function (x) {
      var w = Math.exp(-0.004 * (todayN - x[0]));
      games[x[1]] = (games[x[1]] || 0) + 1; games[x[2]] = (games[x[2]] || 0) + 1;
      (x[6] || []).forEach(function (s) { if (s[3] != null) return; var t = T[s[0]] || (T[s[0]] = {}); var p = t[s[1]] || (t[s[1]] = { name: s[1], goals: 0, w: 0, pen: 0 }); p.goals++; p.w += w; p.pen += s[2]; });
    });
    var out = {};
    Object.keys(T).forEach(function (tid) {
      var L = Object.keys(T[tid]).map(function (k) { return T[tid][k]; }), tot = L.reduce(function (s, p) { return s + p.w; }, 0);
      L.forEach(function (p) { p.share = p.w / Math.max(tot, 1); p.games = games[tid] || 0; });
      out[tid] = L.sort(function (a, b) { return b.w - a.w; }).slice(0, 8);
    });
    return Object.keys(out).length ? out : null;
  }
  function scorerProbs(x) {
    if (x.hsc && x.lam) return scorerProbsH(x);
    if (!x.scorers || !x.lam) return null;
    var E = x.enr || {}, out = [], live = x.state.state === 'in', rem = live && x.sim ? x.sim.r : 1;
    [0, 1].forEach(function (k) {
      var tid = String(k ? x.aid : x.hid), L = x.scorers[tid]; if (!L || !L.length) return;
      var tot = Math.max(L.reduce(function (s, p) { return s + p.goals; }, 0) + 2.5, 2.8 * L[0].goals);
      var injured = E.abs ? E.abs[k].list.filter(function (p) { return /out|absent|suspen|doubt/i.test(p.status); }).map(function (p) { return p.name; }) : [];
      var starters = E.lineups && E.lineups[k] ? E.lineups[k].starters : null;
      var lamT = x.lam[k] * rem;
      L.forEach(function (p) {
        if (injured.indexOf(p.name) >= 0) return;
        var share = (p.goals + 0.15) / tot, play = starters ? (starters.indexOf(p.name) >= 0 ? 0.92 : 0.25) : 0.80;
        var pr = 1 - Math.exp(-lamT * share * play * 0.9);
        out.push({ name: p.name, team: k ? x.away : x.home, goals: p.goals, p: pr, starter: starters ? starters.indexOf(p.name) >= 0 : null });
      });
    });
    return out.sort(function (a, b) { return b.p - a.p; }).slice(0, 10);
  }

  // buteurs tirés de l'historique des matchs de la compétition (part pondérée des buts de l'équipe)
  function scorerProbsH(x) {
    var E = x.enr || {}, live = x.state.state === 'in', rem = live && x.sim ? x.sim.r : 1, teams = [];
    [0, 1].forEach(function (k) {
      var tid = String(k ? x.aid : x.hid), L = x.hsc[tid] || [], out = [];
      var injured = E.abs ? E.abs[k].list.filter(function (p) { return /out|absent|suspen|doubt/i.test(p.status); }).map(function (p) { return p.name; }) : [];
      var starters = E.lineups && E.lineups[k] ? E.lineups[k].starters : null;
      L.forEach(function (p) {
        if (injured.indexOf(p.name) >= 0) return;
        var play = starters ? (starters.indexOf(p.name) >= 0 ? 0.92 : 0.25) : 0.80;
        var share = (p.goals + 0.3) / (p.goals / Math.max(p.share, 0.01) + 3); // part des buts, lissée
        out.push({ name: p.name, team: k ? x.away : x.home, goals: p.goals, pen: p.pen, p: 1 - Math.exp(-x.lam[k] * rem * share * play), starter: starters ? starters.indexOf(p.name) >= 0 : null });
      });
      teams.push({ team: k ? x.away : x.home, list: out.sort(function (a, b) { return b.p - a.p; }).slice(0, 5) });
    });
    x.buteursEq = teams;
    return teams[0].list.concat(teams[1].list).sort(function (a, b) { return b.p - a.p; });
  }

  // NBA / WNBA : meilleurs marqueurs et paliers de points
  function nbaScorers(G, todayN) {
    var T = {}, s0 = seasonStart(G);
    (G || []).forEach(function (x) {
      if (todayN - x[0] > 60 || x[0] < s0) return;
      (x[6] || []).forEach(function (s) { if (s[3] == null) return; var t = T[s[0]] || (T[s[0]] = {}); var p = t[s[1]] || (t[s[1]] = { name: s[1], pts: [] }); p.pts.push(s[3]); });
    });
    return T;
  }
  var TIERS = [10, 15, 20, 25, 30, 35];
  function pointsProps(x) {
    if (!x.nbaLead && !(x.enr && x.enr.ppg)) return null;
    var E = x.enr || {}, teams = [], live = x.state.state === 'in' && !!E.box, rem = live && x.sim && x.sim.r != null ? x.sim.r : 1; // sans feuille de match en direct : estimation d'avant-match
    var paceF = x.ou ? Math.max(0.9, Math.min(1.1, x.ou / 228)) : 1;
    [0, 1].forEach(function (k) {
      var tid = String(k ? x.aid : x.hid), byName = {};
      ((E.ppg && E.ppg[k]) || []).forEach(function (p) { byName[p.name] = { name: p.name, mean: p.ppg, n: 10, src: 'moyenne de la saison' }; });
      var H = x.nbaLead && x.nbaLead[tid];
      if (H) Object.keys(H).forEach(function (nm) { var a = H[nm].pts; if (a.length < 2) return; var m = a.reduce(function (s, v) { return s + v; }, 0) / a.length; if (!byName[nm] || a.length >= 4) byName[nm] = { name: nm, mean: byName[nm] ? (byName[nm].mean + m) / 2 : m * 0.92, n: a.length, src: a.length + ' matchs où il a fini meilleur marqueur' }; });
      var injured = E.abs ? E.abs[k].list.filter(function (p) { return /out|doubt/i.test(p.status); }).map(function (p) { return p.name; }) : [];
      var cur = {}; if (live && E.box) (E.box[k] || []).forEach(function (b) { cur[b.name] = b.pts; });
      var out = [];
      Object.keys(byName).forEach(function (nm) {
        if (injured.indexOf(nm) >= 0) return;
        var p = byName[nm], mu = p.mean * paceF, sd = 3.5 + 0.22 * mu, now = cur[nm] || 0;
        var muR = now + mu * rem, sdR = sd * Math.sqrt(Math.max(rem, 0.02));
        var tiers = TIERS.map(function (t) { return [t, now >= t ? 1 : 1 - Phi((t - 0.5 - muR) / sdR)]; });
        var best = tiers.filter(function (q) { return q[1] >= 0.70 && q[1] < 0.995; }).pop() || null;
        out.push({ name: nm, team: k ? x.away : x.home, mean: mu, now: live ? now : null, tiers: tiers, best: best, src: p.src });
      });
      teams.push({ team: k ? x.away : x.home, list: out.sort(function (a, b) { return b.mean - a.mean; }).slice(0, 5) });
    });
    return teams;
  }

  // ---------- paris « value » : la cote paie plus que le risque réel ----------
  function valueBets(x) {
    var out = [];
    if (x.state.done) return out;
    function push(label, p, dec) { if (p && dec && dec > 1.01) out.push({ label: label, p: p, dec: dec, ev: p * dec }); }
    if (x.sport === 'foot' && x.probs) {
      var od = (x.enr && x.enr.odds) || x._od;
      if (od) { push('Victoire ' + x.home, x.probs['1'], mlToDec(od.home)); push('Match nul', x.probs.X, mlToDec(od.draw)); push('Victoire ' + x.away, x.probs['2'], mlToDec(od.away)); }
    } else if (x.pHome != null && x.odNow) {
      push('Victoire ' + x.home, x.pHome, mlToDec(x.odNow.home)); push('Victoire ' + x.away, 1 - x.pHome, mlToDec(x.odNow.away));
    } else if (x.pA != null && x.odNow) {
      var dA = mlToDec(x.homeFirst ? x.odNow.home : x.odNow.away), dB = mlToDec(x.homeFirst ? x.odNow.away : x.odNow.home);
      push('Victoire ' + x.home, x.pA, dA); push('Victoire ' + x.away, 1 - x.pA, dB);
    }
    return out;
  }

  function tvOf(comp) {
    var n = [];
    (comp.broadcasts || []).forEach(function (b) { (b.names || []).forEach(function (x) { if (n.indexOf(x) < 0) n.push(x); }); });
    (comp.geoBroadcasts || []).forEach(function (b) { var x = pick(b, 'media.shortName'); if (x && n.indexOf(x) < 0) n.push(x); });
    return n.slice(0, 4);
  }
  function liveOf(s, H, A) { return s.state !== 'pre' ? [num(H.score && H.score.value != null ? H.score.value : H.score), num(A.score && A.score.value != null ? A.score.value : A.score)] : null; }
  function teamName(c) { return pick(c, 'team.shortDisplayName') || pick(c, 'team.displayName') || pick(c, 'athlete.displayName') || pick(c, 'athlete.fullName') || '?'; }

  // ---------- football ----------
  function parseStandings(j) {
    var map = {}, tot = { gf: 0, gp: 0 };
    var groups = [];
    (function walk(n) { if (!n) return; if (n.standings && n.standings.entries) groups.push(n.standings.entries); (n.children || []).forEach(walk); })(j);
    groups.forEach(function (entries) {
      entries.forEach(function (e) {
        var s = {}; (e.stats || []).forEach(function (x) { s[x.name || x.type] = num(x.value); });
        var gp = s.gamesPlayed, gf = s.pointsFor != null ? s.pointsFor : s.goalsFor, ga = s.pointsAgainst != null ? s.pointsAgainst : s.goalsAgainst;
        if (gp && gf != null && ga != null && e.team) {
          map[e.team.id] = { gp: gp, gf: gf, ga: ga, pts: s.points, rank: s.rank };
          tot.gf += gf; tot.gp += gp;
        }
      });
    });
    return { map: map, avg: tot.gp ? tot.gf / tot.gp : 1.35 };
  }
  function pois(l, k) { var p = Math.exp(-l); for (var i = 1; i <= k; i++) p *= l / i; return p; }
  function formPts(f) { if (!f) return null; var s = 0, n = 0; f.replace(/[^WDL]/gi, '').slice(-5).split('').forEach(function (c) { n++; s += c.toUpperCase() === 'W' ? 3 : c.toUpperCase() === 'D' ? 1 : 0; }); return n ? s / n : null; }

  function f2(x) { return x.toFixed(2).replace('.', ','); }
  function compsHA(comp) {
    var cs = comp.competitors || [];
    return [cs.filter(function (c) { return c.homeAway === 'home'; })[0], cs.filter(function (c) { return c.homeAway === 'away'; })[0]];
  }

  function analyseFoot(ev, league, st, F) {
    var comp = (ev.competitions || [])[0]; if (!comp) return null;
    var ha = compsHA(comp), H = ha[0], A = ha[1];
    if (!H || !A) return null;
    var why = [], avg = st ? st.avg : 1.35;
    var sh = st && st.map[pick(H, 'team.id')], sa = st && st.map[pick(A, 'team.id')];
    function strength(s, r) {
      if (s) { var w = s.gp / (s.gp + 8); return { att: 1 + w * ((s.gf / s.gp) / avg - 1), def: 1 + w * ((s.ga / s.gp) / avg - 1) }; }
      if (r) { var g = r.w + r.l + r.t, ppg = g ? (3 * r.w + r.t) / g : 1.35; var k = 1 + 0.25 * (ppg - 1.35) * (g / (g + 5)); return { att: k, def: 1 / k }; }
      return { att: 1, def: 1 };
    }
    var rh = rec(H, 'total'), ra = rec(A, 'total');
    var a = strength(sh, rh), b = strength(sa, ra);
    var lh = avg * 1.12 * a.att * b.def, la = avg * 0.89 * b.att * a.def;
    var hn = teamName(H), an = teamName(A);
    var th = F && F.T[String(pick(H, 'team.id'))], ta = F && F.T[String(pick(A, 'team.id'))], rated = false;
    if (th && ta && th.n >= 4 && ta.n >= 4) {
      var neutral = comp.neutralSite;
      lh = F.c * (neutral ? 1 : F.H) * th.A * ta.D; la = F.c * ta.A * th.D; rated = true;
      why.push('Notes de force calculées sur ' + F.n + ' matchs récents de la compétition (les plus récents comptent plus) : attaque ' + hn + ' ' + th.A.toFixed(2).replace('.', ',') + ', défense ' + (1 / th.D).toFixed(2).replace('.', ',') + ' ; attaque ' + an + ' ' + ta.A.toFixed(2).replace('.', ',') + ', défense ' + (1 / ta.D).toFixed(2).replace('.', ',') + ' (1 = moyenne).');
    }
    if (sh && sa) why.push('Attaque/défense (buts marqués / encaissés par match) : ' + hn + ' ' + (sh.gf / sh.gp).toFixed(1).replace('.', ',') + ' / ' + (sh.ga / sh.gp).toFixed(1).replace('.', ',') + ', ' + an + ' ' + (sa.gf / sa.gp).toFixed(1).replace('.', ',') + ' / ' + (sa.ga / sa.gp).toFixed(1).replace('.', ',') + '.');
    else if (rh && ra) why.push('Bilans : ' + hn + ' ' + rh.s + ', ' + an + ' ' + ra.s + ' (V-N-D).');
    if (sh && sh.rank && sa && sa.rank) why.push('Classement : ' + hn + ' ' + sh.rank + 'e, ' + an + ' ' + sa.rank + 'e.');
    var s = state(ev, comp);
    var x = { sport: 'foot', lid: league.id, league: league.name, id: ev.id, date: ev.date, home: hn, away: an, hid: pick(H, 'team.id'), aid: pick(A, 'team.id'),
      title: hn + ' – ' + an, state: s, score: s.done ? [num(H.score), num(A.score)] : null, live: liveOf(s, H, A), tv: tvOf(comp),
      _lh: lh, _la: la, _rated: rated, _form: [H.form || '', A.form || ''], _od: oddsOf(comp), _why0: why };
    return finishFoot(x);
  }

  function finishFoot(x) {
    x.nodata = false;
    var lh = x._lh, la = x._la, why = x._why0.slice(), E = x.enr || {}, hn = x.home, an = x.away;
    var fh = formPts(E.form5 ? E.form5[0] : x._form[0]), fa = formPts(E.form5 ? E.form5[1] : x._form[1]);
    var fH = E.form5 ? E.form5[0] : x._form[0], fA = E.form5 ? E.form5[1] : x._form[1];
    if (fh != null && fa != null) { var d = (fh - fa) * (x._rated ? 0.02 : 0.06); lh *= Math.exp(d); la *= Math.exp(-d); if (Math.abs(fh - fa) >= 0.8) why.push('Forme sur 5 matchs : ' + fH + ' contre ' + fA + '.'); }
    // absences
    if (E.abs) {
      var pen = function (t) { return Math.min(0.25, t.out * 0.04 + t.keyOut * 0.08); };
      var ph = pen(E.abs[0]), pa = pen(E.abs[1]);
      if (ph || pa) {
        lh *= (1 - ph) * (1 + pa * 0.6); la *= (1 - pa) * (1 + ph * 0.6);
        why.push('Absences prises en compte : ' + hn + ' ' + E.abs[0].out + ' absent(s) probable(s)' + (E.abs[0].unc ? ' + ' + E.abs[0].unc + ' incertain(s)' : '') + (E.abs[0].keyOut ? ' dont ' + E.abs[0].keyOut + ' cadre(s)' : '') + ', ' + an + ' ' + E.abs[1].out + (E.abs[1].keyOut ? ' dont ' + E.abs[1].keyOut + ' cadre(s)' : '') + '.');
      }
    }
    if (E.lineups) why.push('Compositions officielles publiées' + (E.lineups[0].formation ? ' (' + E.lineups[0].formation + ' contre ' + (E.lineups[1].formation || '?') + ')' : '') + '.');
    lh = Math.max(0.2, Math.min(4, lh)); la = Math.max(0.2, Math.min(4, la));
    var SP = soccerProbs(lh, la), p1 = SP.p[0], px = SP.p[1], p2 = SP.p[2], o15 = 0, o25 = 0, u35 = 0, btts = 0;
    SP.M.forEach(function (m) { var p = m[2], i = m[0], j = m[1]; if (i + j >= 2) o15 += p; if (i + j >= 3) o25 += p; if (i + j <= 3) u35 += p; if (i > 0 && j > 0) btts += p; });
    var top = SP.M.slice().sort(function (u, v) { return v[2] - u[2]; }).slice(0, 3);
    x.scores = top.map(function (m) { return [m[0] + '-' + m[1], m[2]]; });
    var model = [p1, px, p2].map(function (v) { return Math.pow(v, CALFOOT); });   // température mesurée (0,80) : le modèle de buts était trop confiant
    var ms = model[0] + model[1] + model[2]; model = model.map(function (v) { return v / ms; });
    var od = E.odds || x._od, market = null;
    if (od && od.home != null && od.away != null && od.draw != null) {
      var q = [mlToP(od.home), mlToP(od.draw), mlToP(od.away)];
      if (q.every(function (v) { return v; })) { var s = q[0] + q[1] + q[2]; market = q.map(function (v) { return v / s; }); }
    }
    if (!x._rated && !market) {
      x.nodata = true; x.lam = null; x.main = { label: 'Pas de pronostic', p: 0 }; x.conf = 0; x.level = 'NA'; x.markets = []; x.probs = null;
      x.why = ['Au moins une des deux équipes n\'a pas assez de matchs dans nos données pour cette compétition (souvent une équipe de division inférieure en coupe), et aucune cote n\'est publiée. Pas de pronostic plutôt qu\'un pronostic inventé.'];
      return x;
    }
    var fin = market ? (x._rated ? model.map(function (v, k) { return 0.6 * market[k] + 0.4 * v; }) : market) : model;
    if (!x._rated) why.push('Pas assez de matchs pour noter au moins une des deux équipes : la probabilité vient des cotes seules.');
    var mk = [
      { k: '1', label: 'Victoire ' + hn, p: fin[0], dec: od ? mlToDec(od.home) : null, ok: function (h, a) { return h > a; } },
      { k: '2', label: 'Victoire ' + an, p: fin[2], dec: od ? mlToDec(od.away) : null, ok: function (h, a) { return a > h; } },
      { k: '1X', label: hn + ' ou nul', p: fin[0] + fin[1], ok: function (h, a) { return h >= a; } },
      { k: 'X2', label: an + ' ou nul', p: fin[2] + fin[1], ok: function (h, a) { return a >= h; } },
      { k: 'O15', label: 'Plus de 1,5 but', p: o15, ok: function (h, a) { return h + a >= 2; } },
      { k: 'O25', label: 'Plus de 2,5 buts', p: o25, ok: function (h, a) { return h + a >= 3; } },
      { k: 'U35', label: 'Moins de 3,5 buts', p: u35, ok: function (h, a) { return h + a <= 3; } },
      { k: 'BTTS', label: 'Les deux équipes marquent', p: btts, ok: function (h, a) { return h > 0 && a > 0; } },
      { k: 'NBTTS', label: 'Au moins une équipe ne marque pas', p: 1 - btts, ok: function (h, a) { return h === 0 || a === 0; } }
    ];
    mk.slice(4).forEach(function (m) { m.p = 0.5 + 0.9 * (m.p - 0.5); });
    var win = fin[0] >= fin[2] ? mk[0] : mk[1], dc = fin[0] >= fin[2] ? mk[2] : mk[3], main;
    if (win.p >= 0.62) main = win; else if (dc.p >= 0.74 || !x._rated) main = dc; else main = mk.slice(4).sort(function (u, v) { return v.p - u.p; })[0];
    var level = main.p >= 0.75 ? 'SEC' : main.p >= 0.62 ? 'FORT' : 'DOUTE';
    var safe = mk.filter(function (m) { return m !== main; }).sort(function (u, v) { return v.p - u.p; })[0];
    var value = null;
    if (market) [0, 1].forEach(function (k) { var m = mk[k]; if (m.dec && m.p * m.dec >= 1.08 && m.p >= 0.3 && (!value || m.p * m.dec > value.p * value.dec)) value = m; });
    why.push('Buts attendus : ' + f2(lh) + ' – ' + f2(la) + ' (avantage du terrain inclus).');
    if (market) why.push('Cotes ' + (od.provider || 'du marché') + (E.odds ? ' (mises à jour)' : '') + ' : le marché donne ' + pct(market[0]) + ' / ' + pct(market[1]) + ' / ' + pct(market[2]) + '.');
    else why.push('Pas de cote disponible : estimation sur les statistiques uniquement.');
    // buts attendus recalés pour que la simulation colle à la probabilité finale (modèle + cotes)
    var tot = lh + la, lo = -2, hi = 2;
    for (var it = 0; it < 30; it++) { var md = (lo + hi) / 2, f = Math.exp(md), q = soccerProbs(lh * f, la / f).p; if (q[0] - q[2] < fin[0] - fin[2]) lo = md; else hi = md; }
    var ff = Math.exp((lo + hi) / 2); x.lam = [lh * ff, la / ff];
    x.probs = { '1': fin[0], 'X': fin[1], '2': fin[2] }; x.markets = mk; x.main = main; x.safe = safe; x.value = value; x.level = level; x.why = why; x.conf = main.p;
    x.won = (x.score && x.score[0] != null) ? main.ok(x.score[0], x.score[1]) : undefined;
    return x;
  }

  // ---------- NBA / NFL / NHL ----------
  function analyseUS(ev, lg, R) {
    var comp = (ev.competitions || [])[0]; if (!comp) return null;
    var ha = compsHA(comp), H = ha[0], A = ha[1];
    if (!H || !A) return null;
    var hn = teamName(H), an = teamName(A), why = [];
    var rh = rec(H, 'total'), ra = rec(A, 'total'), hh = rec(H, 'home'), aa = rec(A, 'road');
    function wp(r, n) { if (!r) return 0.5; var g = r.w + r.l + r.t; return (r.w + 0.5 * r.t + n * 0.5) / (g + n); }
    var z = logit(wp(rh, 6)) - logit(wp(ra, 6)) + lg.homeAdv;
    if (hh && aa && hh.w + hh.l >= 3 && aa.w + aa.l >= 3) z = 0.7 * z + 0.3 * (logit(wp(hh, 4)) - logit(wp(aa, 4)));
    if (rh && ra) why.push('Bilans : ' + hn + ' ' + rh.s + ' (dom. ' + (hh ? hh.s : '—') + '), ' + an + ' ' + ra.s + ' (ext. ' + (aa ? aa.s : '—') + ').');
    var idH = String(pick(H, 'team.id')), idA = String(pick(A, 'team.id'));
    if (R && R.R[idH] != null && R.R[idA] != null && R.N[idH] >= 4 && R.N[idA] >= 4) {
      var mg = (comp.neutralSite ? 0 : R.h) + R.R[idH] - R.R[idA], pr = Phi(mg / R.sd);
      z = logit(pr);
      why.push('Notes de force sur ' + R.n + ' matchs récents (écarts de score, adversaires, terrain) : écart attendu ' + (mg >= 0 ? hn + ' +' : an + ' +') + Math.abs(mg).toFixed(1).replace('.', ',') + ' pts.');
    }
    // Calibration mesurée sur 40 jours de matchs réels prédits à l'aveugle : les notes de force sont trop confiantes en début de saison
    z *= CALUS[lg.sport] || 1;
    var s = state(ev, comp);
    var x = { sport: lg.sport, path: lg.path, league: lg.name, id: ev.id, date: ev.date, home: hn, away: an, hid: pick(H, 'team.id'), aid: pick(A, 'team.id'),
      title: an + ' @ ' + hn, state: s, score: s.done ? [num(H.score), num(A.score)] : null, live: liveOf(s, H, A), tv: tvOf(comp), _z: z, _od: oddsOf(comp), _why0: why, _lg: lg };
    return finishUS(x);
  }

  var INJ_W = { rugby: [0.2, 0.03], nba: [0.45, 0.08], wnba: [0.45, 0.08], ncaab: [0.35, 0.06], nfl: [0.3, 0.05], ncaaf: [0.25, 0.04], nhl: [0.25, 0.04], mlb: [0.15, 0.03] };
  function finishUS(x) {
    var E = x.enr || {}, why = x._why0.slice(), z = x._z, hn = x.home, an = x.away, lg = x._lg;
    if (E.form5) why.push('5 derniers matchs : ' + hn + ' ' + (E.form5[0] || '—') + ', ' + an + ' ' + (E.form5[1] || '—') + '.');
    if (E.abs) {
      var w = INJ_W[x.sport] || [0.3, 0.05];
      var imp = function (t) { return Math.min(1.2, t.keyOutW * w[0] + (t.outW - t.keyOutW) * w[1]); };
      var ih = imp(E.abs[0]), ia = imp(E.abs[1]);
      z += ia - ih;
      var absTxt = function (t) { return t.out + ' absent(s) probable(s)' + (t.keyOut ? ' dont ' + t.keyNames.join(', ') : '') + (t.unc ? ', ' + t.unc + ' incertain(s) comptés à 30 %' : ''); };
      if (ih || ia) why.push('Blessures prises en compte : ' + hn + ' ' + absTxt(E.abs[0]) + ' ; ' + an + ' ' + absTxt(E.abs[1]) + '.');
    }
    var pModel = sig(z);
    why.push('Modèle statistique : ' + hn + ' ' + pct(pModel) + ' (terrain et blessures inclus).');
    var od = E.odds || x._od, pMarket = null;
    if (od && od.home != null && od.away != null) { var q1 = mlToP(od.home), q2 = mlToP(od.away); if (q1 && q2) pMarket = q1 / (q1 + q2); }
    else if (od && od.spread != null && x.sport === 'nba') pMarket = sig(-od.spread * 0.135);
    if (pMarket != null) why.push('Marché' + (od.provider ? ' (' + od.provider + ')' : '') + (E.odds ? ', cote mise à jour' : '') + ' : ' + hn + ' ' + pct(pMarket) + (od.details ? ', ligne ' + od.details : '') + '.');
    var pB = E.bpi != null ? E.bpi : null;
    if (pB != null) why.push('Prédicteur ESPN : ' + hn + ' ' + pct(pB) + '.');
    var parts = [];
    if (pMarket != null) parts.push([0.6, pMarket]);
    if (pB != null) parts.push([0.25, pB]);
    parts.push([pMarket != null ? 0.15 : 0.5, pModel]);
    var tw = parts.reduce(function (s, p) { return s + p[0]; }, 0);
    var p = sig(parts.reduce(function (s, q) { return s + q[0] * logit(q[1]); }, 0) / tw);
    if (pMarket == null && pB == null) why.push('Pas de cote disponible : estimation sur les bilans uniquement.');
    var fav = p >= 0.5, pf = fav ? p : 1 - p;
    var level = pf >= 0.70 ? 'SEC' : pf >= 0.60 ? 'FORT' : 'DOUTE';
    if (level === 'DOUTE') why.push('Match serré : à éviter ou à jouer petit.');
    var dec = od ? mlToDec(fav ? od.home : od.away) : null;
    x.main = { label: 'Victoire ' + (fav ? hn : an), p: pf, dec: dec };
    x.favHome = fav;
    var lgd = x._lg || {}; x.sdm = lgd.sd || 12; var pc = Math.min(0.995, Math.max(0.005, p));
    // écart attendu cohérent avec la probabilité finale (inverse de la loi normale)
    var lo = -60, hi = 60; for (var it = 0; it < 50; it++) { var md = (lo + hi) / 2; if (Phi(md / x.sdm) < pc) lo = md; else hi = md; } x.mu = (lo + hi) / 2;
    x.level = level; x.why = why; x.conf = pf; x.value = dec && pf * dec >= 1.06 ? x.main : null; x.ou = od ? od.ou : null;
    x.pHome = p; x.odNow = od;
    x.won = (x.score && x.score[0] != null) ? (fav ? x.score[0] > x.score[1] : x.score[1] > x.score[0]) : undefined;
    return x;
  }

  // ---------- fiche détaillée (dernière minute) ----------
  var OUT_RE = /out|absent|injured reserve|suspen/i, DOUBT_RE = /doubt/i, Q_RE = /question|day-to-day|game-time|probable/i;
  function parseSummary(j, x) {
    var E = {}, ids = [String(x.hid), String(x.aid)];
    var side = function (t) { var id = String(pick(t, 'team.id') || pick(t, 'id') || ''); var k = ids.indexOf(id); if (k >= 0) return k; var ha = t.homeAway; return ha === 'home' ? 0 : ha === 'away' ? 1 : -1; };
    // joueurs clés
    var key = [{}, {}];
    (j.leaders || []).forEach(function (t) { var k = side(t); if (k < 0) return; (t.leaders || []).forEach(function (c) { (c.leaders || []).slice(0, 1).forEach(function (l) { var n = pick(l, 'athlete.displayName'); if (n) key[k][n] = 1; }); }); });
    // blessures
    if (Array.isArray(j.injuries) && j.injuries.length) {
      var abs = [{ out: 0, outW: 0, keyOut: 0, keyOutW: 0, keyNames: [], list: [] }, { out: 0, outW: 0, keyOut: 0, keyOutW: 0, keyNames: [], list: [] }];
      j.injuries.forEach(function (t) {
        var k = side(t); if (k < 0) return;
        (t.injuries || []).forEach(function (inj) {
          var name = pick(inj, 'athlete.displayName') || pick(inj, 'athlete.fullName') || '?';
          var st = inj.status || pick(inj, 'type.description') || pick(inj, 'type.name') || '';
          var det = pick(inj, 'details.type') || pick(inj, 'details.detail') || pick(inj, 'shortComment') || '';
          var wgt = OUT_RE.test(st) ? 1 : DOUBT_RE.test(st) ? 0.7 : Q_RE.test(st) ? 0.3 : 0.5;
          var isKey = !!key[k][name];
          abs[k].list.push({ name: name, status: st, detail: det, key: isKey, pos: pick(inj, 'athlete.position.abbreviation') || '' });
          if (wgt >= 0.5) abs[k].out++; else abs[k].unc = (abs[k].unc || 0) + 1;
          abs[k].outW += wgt;
          if (isKey) { abs[k].keyOutW += wgt; if (wgt >= 0.5) { abs[k].keyOut++; abs[k].keyNames.push(name); } }
        });
      });
      E.abs = abs;
    }
    // compositions
    if (Array.isArray(j.rosters) && j.rosters.length) {
      var lu = [null, null];
      j.rosters.forEach(function (t) {
        var k = side(t); if (k < 0) return;
        var st = (t.roster || []).filter(function (p) { return p.starter; }).map(function (p) { return pick(p, 'athlete.displayName') || pick(p, 'athlete.shortName') || '?'; });
        if (st.length >= 9) lu[k] = { formation: t.formation || '', starters: st };
      });
      if (lu[0] && lu[1]) E.lineups = lu;
    }
    // prédicteur
    var gp = num(pick(j, 'predictor.homeTeam.gameProjection')), ga = num(pick(j, 'predictor.awayTeam.gameProjection'));
    if (gp != null) { var hid = String(pick(j, 'predictor.homeTeam.id') || ''); var ph = gp / 100; if (hid && hid === String(x.aid)) ph = 1 - ph; if (ga != null && Math.abs(gp + ga - 100) > 5) ph = gp / (gp + ga); if (ph > 0.01 && ph < 0.99) E.bpi = ph; }
    // cotes fraîches
    var pc = (j.pickcenter || []).filter(function (o) { return o && (pick(o, 'homeTeamOdds.moneyLine') != null || o.spread != null); })[0];
    if (pc) E.odds = { home: pick(pc, 'homeTeamOdds.moneyLine'), away: pick(pc, 'awayTeamOdds.moneyLine'), draw: pick(pc, 'drawOdds.moneyLine'), spread: num(pc.spread), ou: num(pc.overUnder), details: pc.details || '', provider: pick(pc, 'provider.name') || '' };
    // forme 5 derniers
    if (Array.isArray(j.lastFiveGames) && j.lastFiveGames.length) {
      var f = ['', ''];
      j.lastFiveGames.forEach(function (t) { var k = side(t); if (k < 0) return; f[k] = (t.events || []).map(function (e) { return (e.gameResult || '').charAt(0).toUpperCase().replace('V', 'W').replace('N', 'D'); }).join(''); });
      if (f[0] || f[1]) E.form5 = f;
    }
    // basket : moyennes de points des leaders et points du match en direct
    var ppg = [[], []], gotP = false;
    (j.leaders || []).forEach(function (t) { var k = side(t); if (k < 0) return; (t.leaders || []).forEach(function (c) { if (!/points/i.test(c.name || c.displayName || '')) return; (c.leaders || []).forEach(function (l) { var nm = pick(l, 'athlete.displayName'), v = num(l.value != null ? l.value : l.displayValue); if (nm && v != null && v < 60) { ppg[k].push({ name: nm, ppg: v }); gotP = true; } }); }); });
    if (gotP) E.ppg = ppg;
    if (pick(j, 'boxscore.players')) {
      var box = [[], []];
      j.boxscore.players.forEach(function (t) { var k = side(t); if (k < 0) return; (t.statistics || []).forEach(function (st) { var keys = st.keys || st.names || st.labels || [], pi = keys.indexOf('points'); if (pi < 0) pi = keys.indexOf('PTS'); if (pi < 0) return; (st.athletes || []).forEach(function (a) { var v = num((a.stats || [])[pi]); if (v != null) box[k].push({ name: pick(a, 'athlete.displayName'), pts: v }); }); }); });
      E.box = box;
    }
    // cartons rouges (événements clés)
    if (Array.isArray(j.keyEvents)) {
      var reds = [0, 0];
      j.keyEvents.forEach(function (ev) { var ty = (pick(ev, 'type.text') || pick(ev, 'type.type') || '') + ' ' + (ev.text || ''); if (!/red card|carton rouge|second yellow/i.test(ty)) return; var tid = String(pick(ev, 'team.id') || ''); var k = ids.indexOf(tid); if (k >= 0) reds[k]++; });
      E.reds = reds;
    }
    // statistiques en direct (tirs cadrés, possession)
    if (pick(j, 'boxscore.teams')) {
      var sot = [0, 0], pos = [null, null], got = false;
      j.boxscore.teams.forEach(function (t) { var k = side(t); if (k < 0) return; (t.statistics || []).forEach(function (st) { var nm = (st.name || st.label || '').toLowerCase(); var v = num(st.displayValue != null ? String(st.displayValue).replace('%', '') : st.value); if (v == null) return; if (/shotsontarget|on target|ontarget/.test(nm.replace(/\s/g, ''))) { sot[k] = v; got = true; } if (/possession/.test(nm)) pos[k] = v; }); });
      if (got) E.stats = { sot: sot, pos: pos };
    }
    E.at = Date.now();
    return E;
  }
  function summaryPath(x) { return x.sport === 'foot' ? 'site/v2/sports/soccer/' + x.lid + '/summary?event=' + x.id : x.path ? 'site/v2/sports/' + x.path + '/summary?event=' + x.id : null; }
  function refresh(x) { return simulate(x.sport === 'foot' ? finishFoot(x) : finishUS(x)); }

  async function enrich(getJSON, items, cache, onProgress) {
    var now = Date.now();
    var todo = items.filter(function (x) {
      if (!summaryPath(x) || x.state.done) return false;
      var t = new Date(x.date).getTime(), c = cache[x.id];
      if (!c) return t - now < 36 * 3600e3;
      var soon = t - now < 3 * 3600e3;
      return soon && now - c.at > (x.state.state === 'in' ? 50e3 : 4 * 60e3);
    });
    items.forEach(function (x) { if (cache[x.id] && !x.enr) { x.enr = cache[x.id]; refresh(x); } });
    var done = 0, n = todo.length, q = todo.slice();
    async function w() { while (q.length) { var x = q.shift(); try { var j = await getJSON(summaryPath(x)); if (j) { x.enr = cache[x.id] = parseSummary(j, x); refresh(x); } } catch (e) { } done++; onProgress && onProgress(done / Math.max(1, n)); } }
    await Promise.all([w(), w(), w(), w(), w()]);
    return n;
  }

  // ---------- tennis ----------
  function rankOf(c) { return num(pick(c, 'curatedRank.current')) || num(c.rank) || num(pick(c, 'athlete.rank')) || null; }
  function analyseTennis(comp, ev, tour) {
    var cs = comp.competitors || []; if (cs.length !== 2) return null;
    var a = cs[0], b = cs[1], ra = rankOf(a), rb = rankOf(b), na = teamName(a), nb = teamName(b);
    if (/TBD|^\?$/i.test(na + nb)) return null;
    var why = [];
    var E = extP(tour === 'ATP' ? 'atp' : 'wta', na, nb), pElo = E ? E.p : null;
    // ESPN ne donne que le numéro de tête de série du tournoi (pas le classement mondial) : on ne s'en sert pas dans le calcul
    var pModel = pElo;
    var od = oddsOf(comp), pM = null;
    if (od && od.home != null && od.away != null) { var q1 = mlToP(od.home), q2 = mlToP(od.away); if (q1 && q2) { pM = q1 / (q1 + q2); if (a.homeAway === 'away') pM = 1 - pM; } }
    var sNow = state(ev, comp), noPre = pM == null && pModel == null;
    var nodata = noPre && sNow.state !== 'in';   // en direct, le score seul suffit à simuler la fin du match
    var p = pM != null && pModel != null ? sig(0.7 * logit(pM) + 0.3 * logit(pModel)) : pM != null ? pM : pModel != null ? pModel : 0.5;
    var fa = p >= 0.5, pf = fa ? p : 1 - p;
    var level = nodata ? 'NA' : pf >= 0.72 ? 'SEC' : pf >= 0.62 ? 'FORT' : 'DOUTE';
    if (E) why.push('Elo calculé sur ' + E.base + ' : ' + na + ' ' + E.ea + ', ' + nb + ' ' + E.eb + ' → ' + na + ' gagne ' + pct(pElo) + '. ' + E.test);
    if (ra || rb) why.push('Têtes de série du tournoi : ' + na + ' ' + (ra ? 'n°' + ra : 'non tête de série') + ', ' + nb + ' ' + (rb ? 'n°' + rb : 'non tête de série') + ' (information seulement : un non-classé peut être un ancien top 10).');
    if (pM != null) why.push('Marché : ' + na + ' ' + pct(pM) + '.');
    else if (pModel != null) why.push('Pas de cote publiée dans ce flux : estimation sur le classement Elo seul (surface et fatigue non prises en compte).');
    if (nodata) why.push('Ni classement, ni Elo, ni cote pour ces joueurs : aucun pronostic plutôt qu\'un pronostic au hasard.');
    if (noPre && !nodata) why.push('Aucune donnée d\'avant-match sur ces joueurs : le pronostic en direct vient uniquement du score (sets et jeux) et du temps restant.');
    var s = state(ev, comp), done = s.done || a.winner === true || b.winner === true;
    var sets = [a, b].map(function (c) { return (c.linescores || []).map(function (l) { return num(l.value); }); });
    var setTxt = sets[0].length ? sets[0].map(function (v, i) { return v + '-' + (sets[1][i] != null ? sets[1][i] : 0); }).join(' ') : '';
    var res = { sport: 'tennis', league: tour + (ev.name ? ' · ' + ev.name : ''), id: comp.id || ev.id, date: comp.date || ev.date, home: na, away: nb, title: na + ' – ' + nb,
      state: { state: done ? 'post' : s.state, done: done, txt: s.txt }, setTxt: setTxt, tv: tvOf(comp), main: { label: 'Victoire ' + (fa ? na : nb), p: pf }, level: level, why: why, conf: pf };
    if (done && (a.winner === true || b.winner === true)) res.won = fa ? a.winner === true : b.winner === true;
    if (nodata) { res.won = undefined; res.nodata = true; res.main = { label: 'Pas de pronostic', p: 0 }; res.conf = 0; return res; }
    res.pA = p; res.favA = fa; res.odNow = od; res.homeFirst = a.homeAway !== 'away'; res.bo = tour === 'ATP' && /australian open|us open|wimbledon|roland|garros/i.test(ev.name || '') ? 5 : 3;
    var sw = [0, 0], nS = sets[0].length - (s.state === 'in' ? 1 : 0);
    for (var k = 0; k < nS; k++) { var va = sets[0][k] || 0, vb = sets[1][k] || 0; if (va > vb) sw[0]++; else if (vb > va) sw[1]++; }
    res.setsWon = sw;
    if (s.state === 'in' && sets[0].length > nS) res.curSet = [sets[0][nS] || 0, sets[1][nS] || 0];
    return res;
  }

  // ---------- MMA ----------
  function analyseMMA(comp, ev) {
    var cs = comp.competitors || []; if (cs.length !== 2) return null;
    var a = cs[0], b = cs[1], na = teamName(a), nb = teamName(b), ra = rec(a, 'total'), rb = rec(b, 'total');
    function s(r) { if (!r) return 0; return logit((r.w + 2) / (r.w + r.l + 4)) + 0.12 * Math.log(1 + r.w + r.l); }
    var pModel = sig(0.7 * (s(ra) - s(rb)));
    var od = oddsOf(comp), pM = null;
    if (od && od.home != null && od.away != null) { var q1 = mlToP(od.home), q2 = mlToP(od.away); if (q1 && q2) { pM = q1 / (q1 + q2); if (a.homeAway === 'away') pM = 1 - pM; } }
    var EU = extP('ufc', na, nb);
    if (EU) pModel = sig(0.5 * logit(pModel) + 0.5 * logit(EU.p));
    var p = pM != null ? sig(0.75 * logit(pM) + 0.25 * logit(pModel)) : pModel;
    var fa = p >= 0.5, pf = fa ? p : 1 - p;
    var level = pf >= 0.72 && pM != null ? 'SEC' : pf >= 0.62 ? 'FORT' : 'DOUTE';
    var why = ['Palmarès : ' + na + ' ' + (ra ? ra.s : '—') + ', ' + nb + ' ' + (rb ? rb.s : '—') + ' (V-D-N).'];
    if (EU) why.push('Classement Elo calculé sur ' + EU.base + ' : ' + na + ' ' + EU.ea + ', ' + nb + ' ' + EU.eb + ' (moitié du calcul sans cote). ' + EU.test);
    if (pM != null) why.push('Marché : ' + na + ' ' + pct(pM) + '.'); else why.push('Pas de cote : estimation sur le palmarès' + (EU ? ' et le classement Elo' : ' seul') + '. Styles, allonge et cut de poids absents de ce flux : jamais classé SEC sans cote.');
    var st = state(ev, comp), done = st.done || a.winner === true || b.winner === true;
    var res0 = { od: od, p: p, homeFirst: a.homeAway !== 'away' };
    var res = { pA: res0.p, odNow: res0.od, homeFirst: res0.homeFirst, sport: 'mma', league: ev.name || 'UFC', id: comp.id || ev.id, date: comp.date || ev.date, home: na, away: nb, title: na + ' – ' + nb,
      state: { state: done ? 'post' : st.state, done: done, txt: st.txt }, tv: tvOf(comp), main: { label: 'Victoire ' + (fa ? na : nb), p: pf }, level: level, why: why, conf: pf };
    if (done && (a.winner === true || b.winner === true)) res.won = fa ? a.winner === true : b.winner === true;
    return res;
  }

  // ---------- chargement ----------
  async function loadAll(getJSON, ymd, onProgress, diag, store) {
    var out = [], jobs = [], cal = [], info = { games: 0, leagues: 0 };
    var tN = dayN(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
    store = store || { get: function () { return null; }, set: function () { } };
    // Les dates ESPN suivent l'heure américaine : après minuit en France, les matchs encore en cours
    // (NBA, NHL…) sont rangés à la veille. On récupère donc aussi la veille et on garde les matchs en direct
    // ou terminés depuis moins de 4 heures.
    var nowD = new Date(), todayYmd = nowD.getFullYear() + ('0' + (nowD.getMonth() + 1)).slice(-2) + ('0' + nowD.getDate()).slice(-2);
    var withPrev = ymd === todayYmd && nowD.getHours() < 12, prevYmd = ymdOf(tN - 1);
    async function board(path, q) {
      var sb = await getJSON(path + '?dates=' + ymd + (q || ''));
      if (!withPrev) return sb;
      var pv = null; try { pv = await getJSON(path + '?dates=' + prevYmd + (q || '')); } catch (e) { }
      var keep = ((pv && pv.events) || []).filter(function (ev) {
        var st = pick(ev, 'status.type.state') || pick(ev, 'competitions.0.status.type.state');
        if (st === 'in') return true;
        if (st === 'post') return Date.now() - new Date(ev.date).getTime() < 7 * 3600e3;
        return false;
      });
      if (!keep.length) return sb;
      var ids = {}; ((sb && sb.events) || []).forEach(function (e) { ids[e.id] = 1; });
      var out = Object.assign({}, sb || {}); out.events = keep.filter(function (e) { return !ids[e.id]; }).concat((sb && sb.events) || []);
      return out;
    }
    LEAGUES.forEach(function (lg) { jobs.push(async function () {
      var sb = await board('site/v2/sports/soccer/' + lg.id + '/scoreboard');
      var evs = (sb && sb.events) || []; diag('foot ' + lg.id, sb);
      if (!evs.length) return;
      var F = null;
      var HSC = null;
      try { var G = await history(getJSON, 'soccer/' + lg.id, '', store, tN); F = fitSoccer(G, tN, tN); HSC = teamScorers(G, tN); backtest(G, tN, 'foot', null, cal, 'foot'); if (F) { info.games += F.n; info.leagues++; } } catch (e) { }
      var SCR = null; try { SCR = await scorers(getJSON, lg.id, store, ymd); } catch (e) { }
      evs.forEach(function (ev) { var r = analyseFoot(ev, lg, null, F); if (r) { r.scorers = SCR; r.hsc = HSC; out.push(r); } });
    }); });
    US.forEach(function (lg) { jobs.push(async function () {
      var sb = await board('site/v2/sports/' + lg.path + '/scoreboard', lg.q); diag(lg.sport, sb);
      var evs = (sb && sb.events) || []; if (!evs.length) return;
      var R = null;
      var NL = null;
      try { var G = await history(getJSON, lg.path, lg.q, store, tN); R = fitMargin(G, tN, tN, lg); if (/basketball/.test(lg.path)) NL = nbaScorers(G, tN); backtest(G, tN, 'us', lg, cal, lg.sport); if (R) { info.games += R.n; info.leagues++; } } catch (e) { }
      evs.forEach(function (ev) { var r = analyseUS(ev, lg, R); if (r) { r.nbaLead = NL; out.push(r); } });
    }); });
    [['atp', 'ATP'], ['wta', 'WTA']].forEach(function (t) { jobs.push(async function () {
      var sb = await board('site/v2/sports/tennis/' + t[0] + '/scoreboard'); diag('tennis ' + t[0], sb);
      ((sb && sb.events) || []).forEach(function (ev) {
        var comps = [];
        (ev.groupings || []).forEach(function (g) { if (/single/i.test(pick(g, 'grouping.displayName') || 'single')) comps = comps.concat(g.competitions || []); });
        if (!comps.length) comps = ev.competitions || [];
        comps.forEach(function (c) {
          var d = (c.date || ev.date || '').slice(0, 10).replace(/-/g, '');
          if (d && d !== ymd && !(c.status && pick(c, 'status.type.state') === 'in')) return;
          var r = analyseTennis(c, ev, t[1]); if (r) out.push(r);
        });
      });
    }); });
    jobs.push(async function () {
      var sb = await getJSON('site/v2/sports/mma/ufc/scoreboard?dates=' + ymd + '-' + ymdOf(tN + 14)); diag('mma', sb);
      ((sb && sb.events) || []).forEach(function (ev) {
        var cs = (ev.competitions || []).slice(), seg = cs.filter(function (c) { return /main/i.test(pick(c, 'cardSegment.name') || pick(c, 'cardSegment.description') || ''); });
        if (!seg.length) seg = cs.sort(function (a, b) { return new Date(a.date) - new Date(b.date); }).slice(-5);
        seg.forEach(function (c) { var r = analyseMMA(c, ev); if (r) { r.league = (ev.name || 'UFC') + ' · carte principale'; out.push(r); } });
      });
    });
    var done = 0, errors = [], q = jobs.slice();
    async function worker() { while (q.length) { var j = q.shift(); try { await j(); } catch (e) { errors.push(e.message); } done++; onProgress(done / jobs.length); } }
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    out.forEach(simulate);
    out.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    return { items: out, errors: errors, jobs: jobs.length, cal: cal, info: info };
  }

  var api = { US: US, ymdOf: ymdOf, dayN: dayN, histKey: histKey, setHistSource: setHistSource, setExtern: setExtern, buildFor: function (x) { var r = x.sport === 'foot' && x.lam ? simFoot(x, true) : null; return r && r.builder; }, teamScorers: teamScorers, pointsProps: pointsProps, parseGames: parseGames, parseScorers: parseScorers, scorerProbs: scorerProbs, valueBets: valueBets, simulate: simulate, remaining: remaining, fitSoccer: fitSoccer, fitMargin: fitMargin, soccerProbs: soccerProbs, Phi: Phi, loadAll: loadAll, enrich: enrich, parseSummary: parseSummary, refresh: refresh, analyseFoot: analyseFoot, analyseUS: analyseUS, analyseTennis: analyseTennis, analyseMMA: analyseMMA, parseStandings: parseStandings, LEAGUES: LEAGUES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SportEngine = api;
})(this);

