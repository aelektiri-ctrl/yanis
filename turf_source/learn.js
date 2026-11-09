/* Turf Analyste — apprentissage des poids sur l'historique réel (logit conditionnel, méthode Benter) */
(function (root) {
  'use strict';
  var T = root.TurfEngine;
  var PERF = ['rk', 'catDown', 'catUp', 'rentree', 'recent', 'hipp', 'dist'];
  var TF = T.FEATS.filter(function (k) { return PERF.indexOf(k) < 0; });       // caractéristiques apprises
  var BASE = TF.filter(function (k) { return k !== 'drv' && k !== 'trn'; });   // stockées telles quelles
  function dd(d) { return ('0' + d.getDate()).slice(-2) + ('0' + (d.getMonth() + 1)).slice(-2) + d.getFullYear(); }
  function r2(x) { return Math.round((x || 0) * 100) / 100; }
  function up(s) { return (s || '').toUpperCase(); }

  // --- collecte d'une journée terminée ---
  async function collectDay(getJSON, date, onStep) {
    var d = dd(date), j = await getJSON(d);
    if (!j || !j.programme) return null;
    var races = [], todo = [];
    j.programme.reunions.forEach(function (r) { r.courses.forEach(function (c) { todo.push([r, c]); }); });
    var q = todo.slice();
    async function w() {
      while (q.length) {
        var it = q.shift(), r = it[0], c = it[1];
        try {
          var pj = await getJSON(d + '/R' + r.numOfficiel + '/C' + c.numOrdre + '/participants');
          var parts = pj && (pj.participants || pj);
          if (Array.isArray(parts)) { var rr = buildRace(Object.assign({ numReunion: r.numOfficiel, hippodromeNom: r.hippodrome.libelleCourt }, c), parts); if (rr) races.push(rr); }
        } catch (e) { }
        onStep && onStep();
      }
    }
    await Promise.all([w(), w(), w(), w(), w(), w()]);
    return { n: todo.length, races: races };
  }
  function buildRace(course, parts) {
    var P = parts.filter(function (p) { return !(p.statut && /NON_PARTANT/.test(p.statut)); });
    var H = P.map(function (p) { return T.extract(p, course); }).filter(function (h) { return h.num != null; });
    if (H.length < 4) return null;
    var pos = {};
    H.forEach(function (h) { if (h.arrivee) pos[h.num] = h.arrivee; });
    if (!Object.keys(pos).length && Array.isArray(course.ordreArrivee)) course.ordreArrivee.forEach(function (g, i) { (Array.isArray(g) ? g : [g]).forEach(function (n) { pos[n] = i + 1; }); });
    var winners = H.filter(function (h) { return pos[h.num] === 1; });
    if (winners.length !== 1) return null;
    T.featurize(H, course, null);
    return { f: T.family(course), rows: H.map(function (h) { return [h.num, pos[h.num] || 0, h.cote || 0, BASE.map(function (k) { return r2(h.fx[k]); }), up(h.driver), up(h.entraineur)]; }) };
  }

  // --- statistiques drivers / entraîneurs ---
  function stats(days, skip) {
    var drv = {}, trn = {};
    days.forEach(function (D) {
      if (D.key === skip) return;
      D.races.forEach(function (R) { R.rows.forEach(function (x) {
        if (x[4]) { var a = drv[x[4]] || (drv[x[4]] = [0, 0]); a[1]++; if (x[1] === 1) a[0]++; }
        if (x[5]) { var b = trn[x[5]] || (trn[x[5]] = [0, 0]); b[1]++; if (x[1] === 1) b[0]++; }
      }); });
    });
    return { drv: drv, trn: trn };
  }
  function zs(a) { var v = a.filter(function (x) { return x != null; }); if (v.length < 2) return a.map(function () { return 0; }); var m = v.reduce(function (s, x) { return s + x; }, 0) / v.length; var sd = Math.sqrt(v.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (v.length - 1)) || 1; return a.map(function (x) { return x == null ? 0 : Math.max(-2.5, Math.min(2.5, (x - m) / sd)); }); }
  function rate(map, n) { var s = map[n]; return s ? Math.log((s[0] + 0.5) / (s[1] + 5) / 0.1) : null; }

  // --- jeux de données ---
  function dataset(days, fam) {
    var out = [];
    days.forEach(function (D) {
      var st = stats(days, D.key);
      D.races.forEach(function (R) {
        if (R.f !== fam) return;
        var zd = zs(R.rows.map(function (x) { return rate(st.drv, x[4]); })), zt = zs(R.rows.map(function (x) { return rate(st.trn, x[5]); }));
        var X = R.rows.map(function (x, i) { var o = {}; BASE.forEach(function (k, j) { o[k] = x[3][j]; }); o.drv = zd[i]; o.trn = zt[i]; return TF.map(function (k) { return o[k] || 0; }); });
        var withC = R.rows.filter(function (x) { return x[2] > 1; }).length, lpm = null;
        if (withC >= Math.max(2, 0.6 * R.rows.length)) {
          var q = R.rows.map(function (x) { return x[2] > 1 ? 1 / x[2] : 0; }), qmin = Math.min.apply(null, q.filter(function (v) { return v > 0; }));
          q = q.map(function (v) { return v || qmin; }); var s = q.reduce(function (a, b) { return a + b; }, 0); lpm = q.map(function (v) { return Math.log(v / s); });
        }
        var w = -1, s2 = -1; R.rows.forEach(function (x, i) { if (x[1] === 1) w = i; if (x[1] === 2) s2 = i; });
        if (w >= 0) out.push({ day: D.key, X: X, lpm: lpm, w: w, s: s2 });
      });
    });
    return out;
  }

  // --- ajustement (Adam sur la vraisemblance conditionnelle) ---
  function fit(data, useM, init) {
    var K = TF.length, P = K + (useM ? 1 : 0), th = new Float64Array(P);
    TF.forEach(function (k, i) { th[i] = init[k] || 0; }); if (useM) th[K] = init.__bm || 0.6;
    var m = new Float64Array(P), v = new Float64Array(P), lr = 0.03, lam = 2 / Math.max(1, data.length);
    var D = data.filter(function (r) { return !useM || r.lpm; });
    for (var it = 1; it <= 200; it++) {
      var g = new Float64Array(P);
      D.forEach(function (r) {
        var n = r.X.length, s = new Float64Array(n);
        for (var i = 0; i < n; i++) { var z = 0; for (var k = 0; k < K; k++) z += th[k] * r.X[i][k]; if (useM) z += th[K] * r.lpm[i]; s[i] = z; }
        [[r.w, 1, -1], [r.s, 0.5, r.w]].forEach(function (t) {
          var tgt = t[0], wt = t[1], ex = t[2]; if (tgt < 0) return;
          var mx = -1e9; for (var i = 0; i < n; i++) if (i !== ex && s[i] > mx) mx = s[i];
          var Z = 0, e = new Float64Array(n); for (i = 0; i < n; i++) { if (i === ex) continue; e[i] = Math.exp(s[i] - mx); Z += e[i]; }
          for (i = 0; i < n; i++) { if (i === ex) continue; var pr = e[i] / Z, d = ((i === tgt ? 1 : 0) - pr) * wt;
            for (var k = 0; k < K; k++) g[k] += d * r.X[i][k]; if (useM) g[K] += d * r.lpm[i]; }
        });
      });
      for (var k = 0; k < P; k++) {
        var gk = g[k] / D.length - lam * (k < K ? th[k] - (init[TF[k]] || 0) * 0 : 0);
        m[k] = 0.9 * m[k] + 0.1 * gk; v[k] = 0.999 * v[k] + 0.001 * gk * gk;
        th[k] += lr * (m[k] / (1 - Math.pow(0.9, it))) / (Math.sqrt(v[k] / (1 - Math.pow(0.999, it))) + 1e-8);
      }
    }
    var w = {}; TF.forEach(function (k, i) { w[k] = th[i]; });
    return useM ? { w: w, bm: th[K] } : { w: w };
  }
  function probs(r, M) {
    var K = TF.length, s = r.X.map(function (x, i) { var z = 0; for (var k = 0; k < K; k++) z += (M.w[TF[k]] || 0) * x[k]; if (M.bm != null && r.lpm) z += M.bm * r.lpm[i]; return z; });
    var mx = Math.max.apply(null, s), e = s.map(function (z) { return Math.exp(z - mx); }), Z = e.reduce(function (a, b) { return a + b; }, 0);
    return e.map(function (x) { return x / Z; });
  }
  function evaluate(test, M, useM) {
    var T2 = test.filter(function (r) { return !useM || r.lpm; }), ll = 0, llm = 0, top = 0, topM = 0, sumP = 0, nm = 0;
    T2.forEach(function (r) {
      var p = probs(r, M); ll += -Math.log(Math.max(1e-6, p[r.w]));
      var b = p.indexOf(Math.max.apply(null, p)); if (b === r.w) top++; sumP += p[b];
      if (r.lpm) { nm++; llm += -r.lpm[r.w]; var bm = r.lpm.indexOf(Math.max.apply(null, r.lpm)); if (bm === r.w) topM++; }
    });
    var n = T2.length || 1;
    return { n: T2.length, ll: ll / n, llMarket: nm ? llm / nm : null, top: top / n, topMarket: nm ? topM / nm : null, topPred: sumP / n };
  }
  function scaleDefaults(w, mkt) { var o = {}; T.FEATS.forEach(function (k) { o[k] = PERF.indexOf(k) >= 0 ? DEF[k] / 1.1 * (mkt ? 0.4 : 1) : (w[k] || 0); }); return o; }
  var DEF = { rk: 0.55, catDown: 0.3, catUp: -0.2, rentree: -0.2, recent: 0.05, hipp: 0.12, dist: 0.1 };

  // --- pipeline complet ---
  async function learn(getJSON, store, nDays, onProgress) {
    var today = new Date(); today.setHours(12, 0, 0, 0);
    var days = [], steps = 0, est = nDays * 90;
    for (var i = 1; i <= nDays; i++) {
      var dt = new Date(today.getTime() - i * 864e5), key = dd(dt), D = store.get('th.' + key);
      if (!D) {
        onProgress && onProgress(steps / est, 'Téléchargement du ' + dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + '…');
        var got = await collectDay(getJSON, dt, function () { steps++; onProgress && onProgress(Math.min(0.95, steps / est), 'Téléchargement du ' + dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + '…'); });
        if (got) { D = { key: key, races: got.races }; store.set('th.' + key, D); }
      } else steps += 90;
      if (D) days.push(D);
    }
    store.prune('th.', days.map(function (D) { return 'th.' + D.key; }));
    onProgress && onProgress(0.96, 'Apprentissage des poids…');
    await new Promise(function (r) { setTimeout(r, 30); });
    var testKeys = days.slice(0, 2).map(function (D) { return D.key; });
    var out = { at: Date.now(), days: days.length, races: 0, eval: {} };
    ['trot', 'galop'].forEach(function (fam) {
      var all = dataset(days, fam); out.races += all.length;
      if (all.length < 60) return;
      var train = all.filter(function (r) { return testKeys.indexOf(r.day) < 0; }), test = all.filter(function (r) { return testKeys.indexOf(r.day) >= 0; });
      var init = {}; TF.forEach(function (k) { init[k] = (T.W0 ? T.W0[k] : 0) || 0; });
      var i1 = {}, i2 = {}; TF.forEach(function (k) { i1[k] = init[k] / 1.1 * 0.4; i2[k] = init[k] / 1.1; }); i1.__bm = 0.6;
      var e1 = fit(train, true, i1), e2 = fit(train, false, i2);
      var ev = { mkt: evaluate(test, e1, true), nomkt: evaluate(test, e2, false), nTrain: train.length };
      var f1 = fit(all, true, i1), f2 = fit(all, false, i2);
      out[fam] = { mkt: { w: scaleDefaults(f1.w, true), bm: f1.bm }, nomkt: { w: scaleDefaults(f2.w, false) }, n: all.length };
      out.eval[fam] = ev;
    });
    var st = stats(days, null); out.ctx = st;
    onProgress && onProgress(1, 'Terminé');
    return out;
  }

  root.TurfLearn = { learn: learn, TF: TF };
})(typeof window !== "undefined" ? window : globalThis);
