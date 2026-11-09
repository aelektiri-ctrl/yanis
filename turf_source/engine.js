/* Turf Analyste — moteur d'analyse hippique
   Entrées : une course du programme PMU + sa liste de participants.
   Sorties : probabilités par cheval, simulations d'arrivée, niveau de confiance,
   jeux proposés (sec / champ réduit / 2 sur 4) et explications. */
(function (root) {
  'use strict';

  var SPEC_LETTER = { TROT_ATTELE: 'a', TROT_MONTE: 'm', PLAT: 'p', HAIE: 'h', STEEPLECHASE: 's', CROSS: 'c' };
  var POS_PTS = { '1': 10, '2': 8, '3': 6.5, '4': 5, '5': 4, '6': 3, '7': 2, '8': 1.5, '9': 1, '0': 0.5, 'D': 0, 'A': 0, 'T': 0, 'R': 0.5, 'N': 0.5 };

  // ---------- utilitaires ----------
  function num(v) { var n = +v; return isFinite(n) ? n : null; }
  function mean(a) { var s = 0, n = 0; a.forEach(function (x) { if (x != null) { s += x; n++; } }); return n ? s / n : null; }
  function sd(a, m) { var s = 0, n = 0; a.forEach(function (x) { if (x != null) { s += (x - m) * (x - m); n++; } }); return n > 1 ? Math.sqrt(s / (n - 1)) : 0; }
  function zscores(a) {
    var m = mean(a); if (m == null) return a.map(function () { return 0; });
    var s = sd(a, m) || 1;
    return a.map(function (x) { return x == null ? 0 : Math.max(-2.5, Math.min(2.5, (x - m) / s)); });
  }
  function normalize(a) { var s = a.reduce(function (x, y) { return x + y; }, 0) || 1; return a.map(function (x) { return x / s; }); }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function comb(n, k) { if (k < 0 || k > n) return 0; var r = 1; for (var i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); }
  function pct(x) { return Math.round(x * 100) + ' %'; }
  function fmtCote(c) { return c == null ? '—' : (c < 10 ? c.toFixed(1) : Math.round(c)).toString().replace('.', ','); }

  // ---------- musique ----------
  function parseMusique(m) {
    var out = []; if (!m) return out;
    var re = /\((\d{2})\)|([0-9DATRN])([a-z])/g, x, year = 0;
    while ((x = re.exec(m))) { if (x[1]) { year++; continue; } out.push({ pos: x[2], disc: x[3], old: year > 0 }); }
    return out;
  }
  function formFromMusique(tokens, disc) {
    var w = [1, 0.85, 0.72, 0.6, 0.5, 0.42], s = 0, ws = 0, sd2 = 0, wsd = 0, faults = 0;
    tokens.slice(0, 6).forEach(function (t, i) {
      var p = POS_PTS[t.pos] != null ? POS_PTS[t.pos] : 1, wi = w[i] * (t.old ? 0.8 : 1);
      s += p * wi; ws += wi; if (t.disc === disc) { sd2 += p * wi; wsd += wi; }
    });
    tokens.slice(0, 5).forEach(function (t) { if ('DAT'.indexOf(t.pos) >= 0) faults++; });
    return { form: ws ? s / ws : null, formDisc: wsd ? sd2 / wsd : null, faults: faults, recent: tokens.slice(0, 5).map(function (t) { return t.pos; }) };
  }

  // ---------- caractéristiques d'un partant ----------
  function isTrot(course) { return /TROT/.test(course.specialite || '') || /TROT/.test(course.discipline || ''); }
  function isPlat(course) { return (course.specialite || '') === 'PLAT'; }

  function extract(p, course) {
    var disc = SPEC_LETTER[course.specialite] || '';
    var mus = parseMusique(p.musique || '');
    var f = formFromMusique(mus, disc);
    var nc = num(p.nombreCourses) || 0, nv = num(p.nombreVictoires) || 0, npl = num(p.nombrePlaces) || 0;
    var g = p.gainsParticipant || {};
    var gainsCar = (num(g.gainsCarriere) || 0) / 100, gainsAn = (num(g.gainsAnneeEnCours) || 0) / 100;
    var rd = p.dernierRapportDirect || {}, rr = p.dernierRapportReference || {};
    var cote = num(rd.rapport), coteRef = num(rr.rapport);
    var poids = num(p.handicapPoids) || num(p.poidsConditionMonte);
    if (poids != null && poids > 200) poids = poids / 10; // hectogrammes -> kg
    var recul = null;
    if (isTrot(course) && num(p.handicapDistance) && num(course.distance)) recul = num(p.handicapDistance) - num(course.distance);
    return {
      num: num(p.numPmu), nom: p.nom || ('N°' + p.numPmu), age: num(p.age), sexe: p.sexe,
      driver: (p.driver || p.jockey || ''), entraineur: p.entraineur || '', driverChange: !!p.driverChange,
      musique: p.musique || '', mus: mus, f: f, nc: nc, nv: nv, npl: npl,
      inedit: !!p.indicateurInedit || nc === 0,
      gainsCar: gainsCar, gainsAn: gainsAn, gps: nc ? gainsCar / nc : null,
      cote: cote, coteRef: coteRef, favori: !!rd.favoris,
      deferre: p.deferre || '', avis: p.avisEntraineur || '', oeil: p.oeilleres || '',
      corde: num(p.placeCorde), poids: poids, recul: recul,
      arrivee: num(p.ordreArrivee),
      py: num(p.proba), pyMarche: num(p.proba_marche), stD: p.st_driver || null, stT: p.st_entraineur || null,
      suivi: p.cotes_suivies || null, incident: p.incident || '', pere: p.pere || '', valueY: !!p.value
    };
  }

  // ---------- performances détaillées ----------
  function fmtRK(rk) { var m = Math.floor(rk / 60000), sec = (rk % 60000) / 1000; return m + "'" + sec.toFixed(1).replace('.', '"'); }
  function attachPerf(H, pj, course) {
    var list = pj && (pj.participants || pj); if (!Array.isArray(list)) return 0;
    var byNum = {}; list.forEach(function (x) { byNum[num(x.numPmu)] = x; });
    var trot = isTrot(course), now = course.heureDepart || Date.now();
    var hipp = (course.hippodromeNom || '').toUpperCase(), got = 0;
    H.forEach(function (h) {
      var x = byNum[h.num]; if (!x) return;
      var cc = x.coursesCourues || x.courses || []; if (!cc.length) return;
      var P = { n: 0, hippOk: 0, distOk: 0 }, rks = [], allocs = [];
      cc.slice(0, 8).forEach(function (r, i) {
        var me = (r.participants || []).filter(function (q) { return q.itsHim; })[0]; if (!me) return;
        P.n++;
        var dt = num(r.date); if (P.days == null && dt) P.days = Math.round((now - dt) / 864e5);
        var al = num(r.allocation); if (al && allocs.length < 4) allocs.push(al);
        var dist = num(me.distanceParcourue) || num(r.distance);
        var rk = num(me.reductionKilometrique);
        if (trot && rk && rk > 50000 && rk < 100000 && i < 6 && (!dist || !course.distance || Math.abs(dist - course.distance) <= 450)) rks.push(rk);
        var pl = num(me.place && me.place.place != null ? me.place.place : me.place);
        var hp = (typeof r.hippodrome === 'string' ? r.hippodrome : (r.hippodrome && (r.hippodrome.libelleCourt || r.hippodrome.libelle)) || '').toUpperCase();
        if (pl && pl <= 3 && hipp && hp && (hp.indexOf(hipp) >= 0 || hipp.indexOf(hp) >= 0)) P.hippOk++;
        if (pl && pl <= 3 && dist && course.distance && Math.abs(dist - course.distance) <= 100) P.distOk++;
      });
      if (!P.n) return;
      if (rks.length) P.rk = Math.min.apply(null, rks);
      if (allocs.length) P.alloc = allocs.reduce(function (a, b) { return a + b; }, 0) / allocs.length;
      h.perf = P; got++;
    });
    return got;
  }

  // ---------- caractéristiques et poids ----------
  var FEATS = ['form', 'disc', 'win', 'place', 'gps', 'an', 'faults', 'def4', 'def2', 'recul', 'poids', 'cordeG', 'cordeB', 'avisP', 'avisN', 'move',
    'rk', 'catDown', 'catUp', 'rentree', 'recent', 'hipp', 'dist', 'inedit', 'drv', 'trn', 'drvChg', 'exp', 'age'];
  var W0 = { form: 1.0, disc: 0.35, win: 0.35, place: 0.45, gps: 0.55, an: 0.25, faults: -0.35, def4: 0.35, def2: 0.15, recul: -0.3, poids: -0.06, cordeG: 0.1, cordeB: -0.15,
    avisP: 0.25, avisN: -0.3, move: 0.35, rk: 0.55, catDown: 0.3, catUp: -0.2, rentree: -0.2, recent: 0.05, hipp: 0.12, dist: 0.1, inedit: 0, drv: 0.25, trn: 0.2, drvChg: -0.05, exp: 0.05, age: 0 };
  var MODELS = null; // modèles appris { trot: {mkt:{bm,w}, nomkt:{w}}, galop: {...}, ctx: {drv, trn} }
  function setModels(m) { MODELS = m; }
  function family(course) { return isTrot(course) ? 'trot' : 'galop'; }

  function featurize(H, course, ctx) {
    var trot = isTrot(course), plat = isPlat(course), n = H.length;
    var zForm = zscores(H.map(function (h) { return h.f.form; }));
    var zDisc = zscores(H.map(function (h) { return h.f.formDisc; }));
    var zWin = zscores(H.map(function (h) { return h.nc ? (h.nv + 0.5) / (h.nc + 5) : null; }));
    var zPlace = zscores(H.map(function (h) { return h.nc ? (h.npl + 1) / (h.nc + 5) : null; }));
    var zGps = zscores(H.map(function (h) { return h.gps != null ? Math.log1p(h.gps) : null; }));
    var zAn = zscores(H.map(function (h) { return h.nc ? Math.log1p(h.gainsAn) : null; }));
    var zExp = zscores(H.map(function (h) { return Math.log1p(h.nc); }));
    var zAge = zscores(H.map(function (h) { return h.age; }));
    var poidsM = mean(H.map(function (h) { return h.poids; }));
    var zRK = zscores(H.map(function (h) { return h.perf && h.perf.rk ? -h.perf.rk : null; }));
    var nRK = H.filter(function (h) { return h.perf && h.perf.rk; }).length;
    var rate = function (map, name) { var s = map && name && map[name.toUpperCase()]; return s ? Math.log((s[0] + 0.5) / (s[1] + 5) / 0.1) : null; };
    var zDrv = zscores(H.map(function (h) { return rate(ctx && ctx.drv, h.driver); }));
    var zTrn = zscores(H.map(function (h) { return rate(ctx && ctx.trn, h.entraineur); }));
    H.forEach(function (h, i) {
      var f = {}, P = h.perf || {};
      f.form = zForm[i]; f.disc = zDisc[i]; f.win = zWin[i]; f.place = zPlace[i]; f.gps = zGps[i]; f.an = zAn[i];
      f.faults = h.f.faults; f.exp = zExp[i]; f.age = zAge[i];
      f.def4 = trot && /ANTERIEURS_POSTERIEURS/.test(h.deferre) ? 1 : 0;
      f.def2 = trot && !f.def4 && /DEFERRE/.test(h.deferre) ? 1 : 0;
      f.recul = trot && h.recul > 0 ? h.recul / 25 : 0;
      f.poids = plat && h.poids != null && poidsM != null ? Math.max(-6, Math.min(6, h.poids - poidsM)) : 0;
      f.cordeG = plat && h.corde != null && n >= 10 && h.corde <= 3 ? 1 : 0;
      f.cordeB = plat && h.corde != null && n >= 10 && h.corde > 0.75 * n ? 1 : 0;
      f.avisP = h.avis === 'POSITIF' ? 1 : 0; f.avisN = h.avis === 'NEGATIF' ? 1 : 0;
      f.move = h.cote && h.coteRef ? Math.max(-1, Math.min(1, Math.log(h.coteRef / h.cote))) : 0;
      f.rk = trot && P.rk && nRK >= 3 ? zRK[i] : 0;
      var ratio = P.alloc && course.montantPrix ? P.alloc / course.montantPrix : 1;
      f.catDown = ratio >= 1.4 ? 1 : 0; f.catUp = ratio <= 0.6 ? 1 : 0;
      f.rentree = P.days != null && P.days >= 90 ? 1 : 0; f.recent = P.days != null && P.days <= 30 ? 1 : 0;
      f.hipp = P.hippOk ? 1 : 0; f.dist = P.distOk ? 1 : 0;
      f.inedit = h.inedit ? 1 : 0;
      f.drv = zDrv[i]; f.trn = zTrn[i]; f.drvChg = h.driverChange ? 1 : 0;
      h.fx = f;
    });
  }

  function label(k, h, course) {
    var P = h.perf || {};
    switch (k) {
      case 'form': return 'Forme récente (musique ' + (h.f.recent.join('-') || '—') + ')';
      case 'disc': return 'Forme dans cette spécialité';
      case 'win': return 'Taux de victoire (' + h.nv + '/' + h.nc + ')';
      case 'place': return 'Régularité (' + h.npl + ' places sur ' + h.nc + ' courses)';
      case 'gps': return 'Classe : ' + (h.gps != null ? Math.round(h.gps).toLocaleString('fr-FR') + ' € gagnés par course' : 'gains');
      case 'an': return 'Gains de l\'année : ' + Math.round(h.gainsAn).toLocaleString('fr-FR') + ' €';
      case 'faults': return h.f.faults + ' faute(s) ou arrêt(s) sur 5 courses';
      case 'def4': return 'Déferré des 4 pieds';
      case 'def2': return 'Déferré des ' + (/ANTERIEURS/.test(h.deferre) ? 'antérieurs' : 'postérieurs');
      case 'recul': return 'Recul de ' + h.recul + ' m';
      case 'poids': return 'Poids ' + String(h.poids).replace('.', ',') + ' kg (' + (h.fx.poids > 0 ? '+' : '') + h.fx.poids.toFixed(1).replace('.', ',') + ' vs moyenne)';
      case 'cordeG': return 'Bonne place à la corde (' + h.corde + ')';
      case 'cordeB': return 'Place à la corde défavorable (' + h.corde + ')';
      case 'avisP': return 'Avis de l\'entraîneur positif';
      case 'avisN': return 'Avis de l\'entraîneur négatif';
      case 'move': return 'Cote ' + (h.fx.move > 0 ? 'en baisse' : 'en hausse') + ' (' + fmtCote(h.coteRef) + ' → ' + fmtCote(h.cote) + ')' + (h.fx.move > 0.25 ? ' : argent informé' : '');
      case 'rk': return 'Meilleure réduction kilométrique récente : ' + fmtRK(P.rk);
      case 'catDown': return 'Descend de catégorie (courait pour ' + Math.round(P.alloc).toLocaleString('fr-FR') + ' € en moyenne)';
      case 'catUp': return 'Monte de catégorie (courait pour ' + Math.round(P.alloc).toLocaleString('fr-FR') + ' € en moyenne)';
      case 'rentree': return 'Rentrée après ' + P.days + ' jours d\'absence';
      case 'recent': return 'En condition : a couru il y a ' + P.days + ' jours';
      case 'hipp': return 'Déjà placé sur cet hippodrome (' + P.hippOk + ' fois récemment)';
      case 'dist': return 'Déjà placé sur cette distance';
      case 'inedit': return 'Inédit ou sans référence';
      case 'drv': return (/TROT/.test(course.specialite) ? 'Driver ' : 'Jockey ') + h.driver + ' : réussite récente';
      case 'trn': return 'Entraîneur ' + h.entraineur + ' : réussite récente';
      case 'drvChg': return 'Changement de ' + (/TROT/.test(course.specialite) ? 'driver' : 'jockey');
      case 'exp': return 'Expérience (' + h.nc + ' courses)';
      case 'age': return 'Âge : ' + h.age + ' ans';
    }
    return k;
  }

  function score(H, course) {
    var n = H.length, fam = family(course), M = MODELS && MODELS[fam];
    featurize(H, course, MODELS && MODELS.ctx);
    var withCote = H.filter(function (h) { return h.cote; }).length;
    var market = withCote >= Math.max(2, 0.6 * n);
    var pm = null;
    if (market) {
      var qmin = Math.min.apply(null, H.filter(function (h) { return h.cote; }).map(function (h) { return 1 / h.cote; }));
      pm = normalize(H.map(function (h) { return h.cote ? 1 / h.cote : qmin; }));
    }
    var learned = !!(M && (market ? M.mkt : M.nomkt));
    var w, bm;
    if (learned) { w = market ? M.mkt.w : M.nomkt.w; bm = market ? M.mkt.bm : 0; }
    else { w = {}; FEATS.forEach(function (k) { w[k] = W0[k] / 1.1 * (market ? 0.4 : 1); }); bm = market ? 0.6 : 0; }
    // modèle sans marché (pour afficher l'avis propre du modèle)
    var w2 = M && M.nomkt ? M.nomkt.w : null;
    H.forEach(function (h) {
      var c = [], s = 0, s2 = 0;
      FEATS.forEach(function (k) { var v = h.fx[k] || 0, x = (w[k] || 0) * v; s += x; if (v) c.push([x, k]); if (w2) s2 += (w2[k] || 0) * v; });
      h.s = s; h.s2 = w2 ? s2 : s / (market ? 0.4 : 1);
      h.contrib = c.map(function (x) { return [x[0], label(x[1], h, course)]; });
      if (h.inedit) h.contrib.push([0, 'Inédit ou sans référence : incertitude élevée']);
    });
    var pf = normalize(H.map(function (h) { return Math.exp(h.s2); }));
    var p = normalize(H.map(function (h, i) { return Math.exp(h.s + (market ? bm * Math.log(pm[i]) : 0)); }));
    var yan = H.every(function (h) { return h.py != null && h.py > 0; });
    if (yan) {
      // probabilités Yanis (modèle entraîné sur 15 000 courses), affinées à 20 % par l'analyse détaillée
      p = normalize(H.map(function (h, i) { return Math.exp(0.8 * Math.log(h.py) + 0.2 * Math.log(p[i])); }));
    }
    H.forEach(function (h, i) { h.pf = pf[i]; h.pm = pm ? pm[i] : null; h.p = p[i]; h.ev = h.cote ? h.p * h.cote : null; });
    H.learned = learned; H.yanis = yan;
    H.forEach(function (h) {
      if (h.stD && h.stD[0] >= 5) h.contrib.push([0.0001 * (h.stD[1] / h.stD[0] - 0.1), 'Driver/jockey ' + h.driver + ' : ' + h.stD[1] + ' victoire(s) et ' + h.stD[2] + ' place(s) sur ' + h.stD[0] + ' courses']);
      if (h.stT && h.stT[0] >= 5) h.contrib.push([0.0001 * (h.stT[1] / h.stT[0] - 0.1), 'Entraîneur ' + h.entraineur + ' : ' + h.stT[1] + ' victoire(s) sur ' + h.stT[0] + ' courses']);
      if (h.suivi && h.suivi.length >= 2) { var a = h.suivi[0][1], b = h.suivi[h.suivi.length - 1][1]; if (a && b && Math.abs(Math.log(a / b)) > 0.2) h.contrib.push([0.0001 * (a > b ? 1 : -1), 'Cote suivie depuis ' + h.suivi[0][0] + ' : ' + fmtCote(a) + ' → ' + fmtCote(b)]); }
    });
    return market;
  }

  // ---------- simulations d'arrivée ----------
  function simulate(H, seed, N) {
    N = N || 20000;
    var n = H.length, rnd = mulberry32(seed), p1 = H.map(function (h) { return h.p; });
    var pl = normalize(p1.map(function (x) { return Math.pow(x, 0.85); }));
    var orders = new Array(N), idx = new Array(n);
    for (var s = 0; s < N; s++) {
      for (var k = 0; k < n; k++) idx[k] = k;
      var used = new Array(n).fill(false), ord = [], depth = Math.min(5, n);
      for (var pos = 0; pos < depth; pos++) {
        var w = pos === 0 ? p1 : pl, tot = 0;
        for (k = 0; k < n; k++) if (!used[k]) tot += w[k];
        var r = rnd() * tot, acc = 0, pick = -1;
        for (k = 0; k < n; k++) { if (used[k]) continue; acc += w[k]; if (acc >= r) { pick = k; break; } }
        if (pick < 0) for (k = n - 1; k >= 0; k--) if (!used[k]) { pick = k; break; }
        used[pick] = true; ord.push(pick);
      }
      orders[s] = ord;
    }
    var topk = [1, 2, 3, 4, 5].map(function () { return new Float64Array(n); });
    orders.forEach(function (o) { o.forEach(function (h, pos) { for (var k = pos; k < 5; k++) topk[k][h]++; }); });
    H.forEach(function (h, i) { h.top = topk.map(function (t) { return t[i] / N; }); });
    return orders;
  }
  function freq(orders, test) { var c = 0; for (var i = 0; i < orders.length; i++) if (test(orders[i])) c++; return c / orders.length; }
  function inTop(o, h, k) { for (var i = 0; i < k && i < o.length; i++) if (o[i] === h) return true; return false; }
  function countIn(o, set, k) { var c = 0; for (var i = 0; i < k && i < o.length; i++) if (set.indexOf(o[i]) >= 0) c++; return c; }

  // ---------- paris ----------
  function parisDispo(course) {
    var s = {}; (course.paris || []).forEach(function (p) { if (p.enVente !== false) s[p.typePari] = (p.miseBase || 200) / 100; }); return s;
  }

  function analyse(course, participants, opts) {
    opts = opts || {};
    var raw = (participants || []).filter(function (p) { return !(p.statut && /NON_PARTANT/.test(p.statut)); });
    var H = raw.map(function (p) { return extract(p, course); }).filter(function (h) { return h.num != null; });
    var res = { course: course, H: H, n: H.length, ok: H.length >= 3 };
    if (opts.perfs) res.perfN = attachPerf(H, opts.perfs, course);
    if (!res.ok) { res.message = H.length ? 'Pas assez de partants pour analyser.' : 'Partants non publiés pour le moment.'; return res; }
    res.market = score(H, course);
    var seed = (course.numReunion || 1) * 1000 + (course.numOrdre || 1) + (opts.dateSeed || 0);
    var orders = simulate(H, seed, opts.N);
    var order = H.map(function (h, i) { return i; }).sort(function (a, b) { return H[b].p - H[a].p; });
    H.forEach(function (h, i) { h.rang = order.indexOf(i) + 1; });
    var A = order[0], B = order[1], C = order[2];
    var dispo = parisDispo(course), n = H.length;
    var byTop = function (k, excl) { return H.map(function (h, i) { return i; }).filter(function (i) { return excl.indexOf(i) < 0; }).sort(function (a, b) { return H[b].top[k - 1] - H[a].top[k - 1]; }); };

    var pA = H[A].p, pB = H[B].p;
    var pCoupleAB = freq(orders, function (o) { return (o[0] === A && o[1] === B) || (o[0] === B && o[1] === A); });
    var pTrioABC = freq(orders, function (o) { return countIn(o, [A, B, C], 3) === 3; });
    var pABtop3 = freq(orders, function (o) { return inTop(o, A, 3) && inTop(o, B, 3); });
    var others3 = byTop(3, [A, B]);
    var trioK = {};
    [4, 5].forEach(function (k) { var set = others3.slice(0, k); trioK[k] = { set: set, p: freq(orders, function (o) { return inTop(o, A, 3) && inTop(o, B, 3) && countIn(o, set, 3) === 1; }) }; });
    var others4 = byTop(4, [A]), s4 = others4.slice(0, Math.min(4, n - 1));
    var p2sur4base = freq(orders, function (o) { return inTop(o, A, 4) && countIn(o, s4, 4) >= 1; });
    var p2sur4AB = freq(orders, function (o) { return inTop(o, A, 4) && inTop(o, B, 4); });
    var s5 = byTop(3, [A]).slice(0, Math.min(5, n - 1));
    var pTrio1b5 = freq(orders, function (o) { return inTop(o, A, 3) && countIn(o, s5, 3) === 2; });

    var level;
    if (pCoupleAB >= 0.30 || (pA >= 0.45 && pA >= 2.2 * pB)) level = 'SEC';
    else if (pABtop3 >= 0.38) level = 'FORT';
    else level = 'DOUTE';

    // ---- détection du « loup » : outsider sur lequel l'argent ou les données disent autre chose que la cote ----
    var loup = null;
    H.forEach(function (h, i) {
      if (i === A || i === B || !h.cote || h.cote < 6 || h.cote > 25 || h.p < 0.07) return;
      var sc = 0, why = [];
      var first = h.suivi && h.suivi.length >= 2 ? h.suivi[0][1] : h.coteRef;
      if (first && h.cote && first / h.cote >= 1.6) { sc += 2; why.push('cote écrasée de ' + fmtCote(first) + ' à ' + fmtCote(h.cote)); }
      if (h.pm && h.p / h.pm >= 1.5) { sc += 1.5; why.push('le modèle le voit ' + Math.round(h.p / h.pm * 10) / 10 + ' fois plus souvent gagnant que le public'); }
      if (h.pf && h.pm && h.pf / h.pm >= 2) { sc += 1; why.push('analyse détaillée très supérieure à sa cote'); }
      if (h.valueY) { sc += 0.5; why.push('signalé « value » par Yanis'); }
      if (/ANTERIEURS_POSTERIEURS/.test(h.deferre) && isTrot(course)) { sc += 0.5; why.push('déferré des 4 pieds'); }
      if (h.top[2] >= 0.30) sc += 0.5;
      var strong = (first && first / h.cote >= 1.6) || (h.pm && h.p / h.pm >= 1.8);
      if (strong && sc >= 3 && (!loup || sc > loup.sc)) loup = { i: i, sc: sc, why: why };
    });
    var L = loup ? loup.i : -1;

    var N = function (i) { return H[i].num; };
    var nums = function (arr) { return arr.map(N).join(' - '); };
    var jeux = [];
    function add(type, label, detail, combos, p, hit, main, list, lib) {
      if (!dispo[type] && !dispo['E_' + type]) return;
      var mise = dispo[type] || dispo['E_' + type];
      jeux.push({ type: type, label: label, detail: detail, combos: combos, cout: combos * mise, mise: mise, p: p, hit: hit, main: !!main, list: list || null, lib: lib || null });
    }
    function kOf(arr, k) { var o = []; (function rec(st, cur) { if (cur.length === k) { o.push(cur.slice()); return; } for (var i = st; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); } })(0, []); return o; }
    function champ(bases, others, size) { return kOf(others, size - bases.length).map(function (c) { return bases.map(N).concat(c.map(N)); }); }
    function inFirst(a, k, n) { return a.slice(0, k).indexOf(n) >= 0; }
    function hitChamp(bases, others, k, need) { return function (a) { var t = a.slice(0, k); return bases.every(function (b) { return t.indexOf(N(b)) >= 0; }) && others.filter(function (x) { return t.indexOf(N(x)) >= 0; }).length >= need; }; }
    function pChamp(bases, others, k, need) { return freq(orders, function (o) { return bases.every(function (b) { return inTop(o, b, k); }) && countIn(o, others, k) >= need; }); }

    // chevaux d'accompagnement classés par chance d'être dans les k premiers
    var B2 = [A, B], B3 = L >= 0 ? [A, B, L] : null;
    var for3 = byTop(3, B2), for4 = byTop(4, B2), for5 = byTop(5, B2);
    var k3 = (trioK[5].p - trioK[4].p) > 0.06 || level === 'DOUTE' ? 5 : 4;
    var o3 = for3.slice(0, Math.min(k3, n - 2)), o4 = for4.slice(0, Math.min(5, n - 2)), o5 = for5.slice(0, Math.min(5, n - 2));
    var o4L = B3 ? byTop(4, B3).slice(0, Math.min(5, n - 3)) : null, o5L = B3 ? byTop(5, B3).slice(0, Math.min(5, n - 3)) : null;

    // jumelés (couplés) et 2 sur 4 : toujours les 2 bases
    if (level === 'SEC') {
      add('COUPLE_GAGNANT', 'Couplé (jumelé) gagnant sec', nums(B2), 1, pCoupleAB, function (a) { return a.length >= 2 && [a[0], a[1]].sort().join() === [N(A), N(B)].sort().join(); }, true, [[N(A), N(B)]]);
      if (pA >= 0.3) add('SIMPLE_GAGNANT', 'Simple gagnant', String(N(A)), 1, pA, function (a) { return a[0] === N(A); }, false, [[N(A)]]);
    }
    if (n >= 8) add('COUPLE_PLACE', 'Couplé (jumelé) placé', nums(B2), 1, pABtop3, function (a) { return inFirst(a, 3, N(A)) && inFirst(a, 3, N(B)); }, level === 'FORT' && !B3, [[N(A), N(B)]]);
    if (n >= 6) add('DEUX_SUR_QUATRE', '2 sur 4', nums(B2), 1, p2sur4AB, function (a) { return inFirst(a, 4, N(A)) && inFirst(a, 4, N(B)); }, false, [[N(A), N(B)]]);
    if (level === 'DOUTE' && n >= 6) add('DEUX_SUR_QUATRE', '2 sur 4 champ réduit — 1 base + ' + s4.length, 'Base ' + N(A) + ' / avec ' + nums(s4), s4.length, p2sur4base, function (a) { var t = a.slice(0, 4); return t.indexOf(N(A)) >= 0 && s4.some(function (i) { return t.indexOf(N(i)) >= 0; }); }, !B3, s4.map(function (x) { return [N(A), N(x)]; }));
    // trio : 2 bases + 4 ou 5
    add('TRIO', 'Trio champ réduit — 2 bases + ' + o3.length, 'Bases ' + nums(B2) + ' / avec ' + nums(o3), o3.length, pChamp(B2, o3, 3, 1), hitChamp(B2, o3, 3, 1), level !== 'SEC' && level !== 'DOUTE' && !B3 && !dispo.MULTI, champ(B2, o3, 3));
    // multi (en 4) : 2 bases + 5, ou 3 bases + 5 s'il y a un loup
    if (n >= 8) {
      if (B3) add('MULTI', 'Multi champ réduit — 3 bases + ' + o4L.length + ' 🐺', 'Bases ' + nums(B3) + ' / avec ' + nums(o4L), o4L.length, pChamp(B3, o4L, 4, 1), hitChamp(B3, o4L, 4, 1), true, champ(B3, o4L, 4), /en 4/i);
      add('MULTI', 'Multi champ réduit — 2 bases + ' + o4.length, 'Bases ' + nums(B2) + ' / avec ' + nums(o4), comb(o4.length, 2), pChamp(B2, o4, 4, 2), hitChamp(B2, o4, 4, 2), !B3 && level !== 'SEC', champ(B2, o4, 4), /en 4/i);
    }
    // quinté+ (désordre) : 2 bases + 5, ou 3 bases + 5
    if (dispo.QUINTE_PLUS && n >= 8) {
      var qb = B3 || B2, qo = B3 ? o5L : o5, need = 5 - qb.length;
      add('QUINTE_PLUS', 'Quinté+ champ réduit — ' + qb.length + ' bases + ' + qo.length + (B3 ? ' 🐺' : '') + ' (désordre)', 'Bases ' + nums(qb) + ' / avec ' + nums(qo), comb(qo.length, need), pChamp(qb, qo, 5, need), hitChamp(qb, qo, 5, need), false, champ(qb, qo, 5), /sordre/i);
    }
    if (!jeux.some(function (j) { return j.main; }) && jeux.length) jeux[0].main = true;
    var main = jeux.filter(function (j) { return j.main; })[0] || null;

    // explication du format
    var why = [];
    var hA = H[A], hB = H[B];
    if (level === 'SEC') why.push('Course nette : le n°' + hA.num + ' (' + pct(pA) + ') et le n°' + hB.num + ' (' + pct(pB) + ') dominent. Le couplé ' + hA.num + '-' + hB.num + ' sort dans ' + pct(pCoupleAB) + ' des 20 000 simulations d\'arrivée.');
    else if (level === 'FORT') why.push('Les deux bases n°' + hA.num + ' et n°' + hB.num + ' finissent ensemble dans les 3 premiers dans ' + pct(pABtop3) + ' des simulations, mais la 3e place reste ouverte : champ réduit sur ' + (trioK[5].p - trioK[4].p > 0.06 ? 5 : 4) + ' chevaux.');
    else why.push('Course ouverte : le premier choix n°' + hA.num + ' n\'a que ' + pct(pA) + ' de chances de gagner. On joue la sécurité avec un 2 sur 4 et un trio en champ réduit.');
    if (loup) why.push('🐺 Anguille sous roche : le n°' + H[L].num + ' ' + H[L].nom + ' (cote ' + fmtCote(H[L].cote) + ') — ' + loup.why.join(', ') + '. On passe à 3 bases + 5 sur le multi et le quinté.');
    if (hA.ev != null && hA.ev >= 1.15) why.push('Le n°' + hA.num + ' est sous-coté par le public : espérance ' + hA.ev.toFixed(2).replace('.', ',') + ' € par euro joué au gagnant.');
    if (H.yanis) why.push('Probabilités du modèle Yanis, entraîné sur plus de 15 000 courses réelles, affinées par l\'analyse détaillée (forme, ferrure, recul, poids, corde, cote).');
    else why.push(H.learned ? 'Poids des facteurs appris sur l\'historique réel des courses (' + (family(course) === 'trot' ? 'trot' : 'galop') + ').' : 'Poids des facteurs par défaut : lance l\'apprentissage dans l\'onglet Bilan pour les caler sur les vrais résultats.');
    if (!res.market) why.push('Cotes pas encore ouvertes : analyse sur la forme et les performances uniquement, à revoir près du départ.');
    var nbIned = H.filter(function (h) { return h.inedit; }).length;
    if (nbIned >= 2) why.push(nbIned + ' chevaux sans référence : fiabilité réduite.');
    if (res.perfN) why.push('Historique course par course intégré pour ' + res.perfN + ' chevaux (réduction kilométrique, niveau des courses, fraîcheur, hippodrome, distance).');

    var conf = main ? main.p : 0;
    var potentiel = conf * (1 + Math.max(0, (hA.ev || 1) - 1)) * (level === 'SEC' ? 1.15 : level === 'FORT' ? 1.05 : 0.9) * (nbIned >= 2 ? 0.8 : 1) * (res.market ? 1 : 0.85);

    // résultat si arrivée connue
    var arr = H.filter(function (h) { return h.arrivee; }).sort(function (a, b) { return a.arrivee - b.arrivee; }).map(function (h) { return h.num; });
    if (arr.length < 3 && course.arriveeTxt) arr = course.arriveeTxt.split('-').map(Number).filter(function (x) { return x > 0; });
    if (arr.length >= 3) {
      res.arrivee = arr; jeux.forEach(function (j) { j.gagne = !!j.hit(arr); });
      var R = course.rapports;
      if (Array.isArray(R) && R.length) jeux.forEach(function (j) {
        if (!j.list) return; var ret = 0;
        j.list.forEach(function (cmb) {
          var key = cmb.slice().sort(function (a, b) { return a - b; }).join('-'), best = 0;
          R.forEach(function (r) {
            if (r.pari !== j.type) return;
            var rn = String(r.combinaison).split(/[-\s]+/).map(Number), k = rn.slice().sort(function (a, b) { return a - b; }).join('-');
            if (j.type === 'QUINTE_PLUS') {
              if (/sordre/i.test(r.libelle || '') && k === key) best = Math.max(best, num(r.rapport) || 0);
              else if (/bonus/i.test(r.libelle || '') && rn.every(function (x) { return cmb.indexOf(x) >= 0; })) best = Math.max(best, num(r.rapport) || 0);
              return;
            }
            if (j.lib && !j.lib.test(r.libelle || '')) return;
            if (k === key) best += num(r.rapport) || 0;
          });
          ret += best;
        });
        j.retour = ret * (j.mise || 1); j.rapportOk = true;
      });
    }

    res.loup = loup ? H[L] : null;
    res.level = level; res.jeux = jeux; res.main = main; res.conf = conf; res.potentiel = potentiel;
    res.why = why; res.order = order; res.A = A; res.B = B;
    res.ranking = order.map(function (i) { return H[i]; });
    return res;
  }

  // explications par cheval, triées par impact
  function horseReasons(h) {
    return h.contrib.filter(function (c) { return Math.abs(c[0]) >= 0.03 || Math.abs(c[0]) < 0.001; })
      .sort(function (a, b) { return Math.abs(b[0]) - Math.abs(a[0]); })
      .map(function (c) { return { sign: c[0] > 0.015 ? 1 : c[0] < -0.015 ? -1 : 0, txt: c[1], v: c[0] }; });
  }

  var api = { W0: W0, FEATS: FEATS, setModels: setModels, family: family, extract: extract, featurize: featurize, attachPerf: attachPerf, analyse: analyse, parseMusique: parseMusique, horseReasons: horseReasons, fmtCote: fmtCote, pct: pct, comb: comb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TurfEngine = api;
})(this);

