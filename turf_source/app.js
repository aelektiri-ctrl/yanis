(function(){
'use strict';
var E=window.TurfEngine;
/* stockage local robuste */
var ST={
  get:function(k){try{var v=localStorage.getItem('ta.'+k);return v?JSON.parse(v):null}catch(e){return null}},
  set:function(k,v){var s=JSON.stringify(v);for(var t=0;t<3;t++){try{localStorage.setItem('ta.'+k,s);return true}catch(e){ST.freeSome()}}return false},
  keys:function(pre){var o=[];try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf('ta.'+pre)===0)o.push(k.slice(3))}}catch(e){}return o},
  prune:function(pre,keep){ST.keys(pre).forEach(function(k){if(keep.indexOf(k)<0)try{localStorage.removeItem('ta.'+k)}catch(e){}})},
  freeSome:function(){var k=ST.keys('sh2.')[0]||ST.keys('th.').sort()[0]||ST.keys('sh3.')[0];if(k)try{localStorage.removeItem('ta.'+k)}catch(e){}}
};
ST.keys('sh2.').forEach(function(k){try{localStorage.removeItem('ta.'+k)}catch(e){}});
var MODELS=ST.get('turf.models');if(MODELS)E.setModels(MODELS);
var LEARN={running:false,msg:''};
async function runLearn(auto){
  if(LEARN.running)return;LEARN.running=true;LEARN.err=null;render();
  try{
    var m=await TurfLearn.learn(function(p){return getJSON(API+p)},ST,10,function(x,msg){LEARN.msg=msg;setProg(x);setStatus('Apprentissage : '+msg+' '+Math.round(x*100)+' %')});
    if(!m.trot&&!m.galop)throw new Error('pas assez de courses terminées récupérées ('+m.races+')');
    MODELS=m;ST.set('turf.models',m);E.setModels(m);
    LEARN.running=false;setProg(0);S.an={};await loadDay(true);
  }catch(e){LEARN.err=e.message;setStatus('Apprentissage impossible : '+e.message)}
  LEARN.running=false;setProg(0);render();
}
function learnCard(full){
  if(YANIS)return yBancCard(full);
  var h='<div class="card" style="border-color:var(--accent)"><div class="ttl">🧠 Modèle entraîné sur les vrais résultats</div>';
  if(LEARN.running)return h+'<p>'+esc(LEARN.msg||'En cours…')+'</p><p class="mute">Première fois : 1 à 3 minutes, idéalement en Wi-Fi. Ensuite, seule la journée d\'hier est ajoutée.</p></div>';
  if(!MODELS){
    return h+'<p>Pas encore entraîné. L\'appli va télécharger les 10 derniers jours de courses (environ 900 courses avec leurs arrivées) et calculer le poids exact de chaque facteur, séparément pour le trot et le galop.</p>'+(LEARN.err?'<p class="ko">'+esc(LEARN.err)+'</p>':'')+'<button class="primary" id="learnBtn">Lancer l\'apprentissage</button></div>';
  }
  h+='<p class="mute">Dernier entraînement : '+new Date(MODELS.at).toLocaleString('fr-FR',{weekday:'short',hour:'2-digit',minute:'2-digit'})+' · '+MODELS.races+' courses sur '+MODELS.days+' jours.</p>';
  if(full){
    ['trot','galop'].forEach(function(f){var ev=MODELS.eval&&MODELS.eval[f];if(!ev)return;var a=ev.mkt,b=ev.nomkt;
      h+='<div class="ttl" style="margin-top:8px">'+(f==='trot'?'Trot':'Galop (plat et obstacle)')+'</div><div class="mute">Test sur '+a.n+' courses des 2 derniers jours, jamais vues pendant l\'apprentissage :</div>';
      h+='<div class="mk"><span>Le n°1 du modèle gagne</span><span class="conf">'+E.pct(a.top)+'</span></div>';
      if(a.topMarket!=null)h+='<div class="mk"><span>Le favori du public gagne</span><span class="conf">'+E.pct(a.topMarket)+'</span></div>';
      h+='<div class="mk"><span>Probabilité annoncée pour le n°1</span><span class="conf">'+E.pct(a.topPred)+'</span></div>';
      if(a.llMarket!=null)h+='<div class="mk"><span>Précision (log-loss, plus bas = mieux)</span><span class="conf">'+a.ll.toFixed(3).replace('.',',')+' vs public '+a.llMarket.toFixed(3).replace('.',',')+'</span></div>';
      var W=MODELS[f].mkt.w,top=Object.keys(W).filter(function(k){return TurfLearn.TF.indexOf(k)>=0}).sort(function(x,y){return Math.abs(W[y])-Math.abs(W[x])}).slice(0,6);
      h+='<div class="mute" style="margin-top:4px">Facteurs les plus déterminants : '+top.map(function(k){return FNAME[k]+(W[k]<0?' (−)':'')}).join(', ')+'.</div>';
    });
  }
  return h+'<button id="learnBtn" style="margin-top:8px">Réentraîner maintenant</button></div>';
}
function seTxt(st){var h=st.reussite;if(!(h>0&&h<1&&st.paris>0))return '';var se=((1+st.roi)/h)*Math.sqrt(h*(1-h))/Math.sqrt(st.paris);var sure=st.paris>=500&&Math.abs(st.roi)>2.58*se;return '± '+String(Math.round(se*1000)/10).replace('.',',')+' pts · '+(sure?'écart établi':'non démontré (trop peu de paris)')}
function yBancCard(full){
  var b=YD.banc;if(!b)return '';
  if(!full)return '';
  var h='<div class="card hl"><div class="ttl">🧠 Modèle Yanis : test honnête sur '+b.courses.toLocaleString('fr-FR')+' courses réelles</div><div class="mute">Mois testés : '+(b.mois_testes||[]).join(', ')+'. Le modèle n\'avait jamais vu ces courses.</div>';
  h+='<div class="mk"><span>Le n°1 du modèle gagne</span><span class="conf">'+E.pct(b.n1_yanis_gagne)+'</span></div><div class="mk"><span>Le favori du public gagne</span><span class="conf">'+E.pct(b.favori_gagne)+'</span></div>';
  if(b.strategies){h+='<div class="ttl" style="margin-top:8px">Stratégies testées (rentabilité réelle avec les rapports PMU)</div>';Object.keys(b.strategies).forEach(function(k){var st=b.strategies[k];h+='<div class="mk"><span>'+esc(st.nom)+'<br><span class="mute">'+st.paris.toLocaleString('fr-FR')+' paris · '+E.pct(st.reussite)+' gagnants</span></span><span class="'+(st.roi>=0?'ok':'ko')+'">'+(st.roi>=0?'+':'')+String(Math.round(st.roi*1000)/10).replace('.',',')+' %<br><span class="mute" style="font-weight:400">'+seTxt(st)+'</span></span></div>'})}
  return h+'<p class="mute">Rentabilité = gain net pour 100 € joués. Négatif = perte sur la durée. C\'est la réalité du PMU : le prélèvement est de 15 à 30 % selon le pari.</p></div>';
}
var FNAME={form:'forme',disc:'forme dans la spécialité',win:'taux de victoire',place:'régularité',gps:'classe',an:'gains de l\'année',faults:'fautes',def4:'déferré 4 pieds',def2:'déferré 2 pieds',recul:'recul',poids:'poids',cordeG:'bonne corde',cordeB:'mauvaise corde',avisP:'avis entraîneur +',avisN:'avis entraîneur −',move:'mouvement de cote',inedit:'inédit',drv:'driver/jockey',trn:'entraîneur',drvChg:'changement de driver',exp:'expérience',age:'âge'};

var PMU='https://online.turfinfo.api.pmu.fr/rest/client/1/programme/';var API='';var LOCAL=(new URLSearchParams(location.search).get('api'))||'/pmu/';
var ROUTES=[
  {name:'serveur Netlify',f:function(p){return LOCAL+p}},
  {name:'PMU direct',f:function(p){return PMU+p}},
  {name:'relais 1',f:function(p){return 'https://api.allorigins.win/raw?url='+encodeURIComponent(PMU+p)}},
  {name:'relais 2',f:function(p){return 'https://corsproxy.io/?url='+encodeURIComponent(PMU+p)}}
];
var route=0;try{route=+localStorage.getItem('turf.route2')||0}catch(e){}
var QD=new URLSearchParams(location.search).get('date');
var S={perf:{},alerts:[],date:QD?new Date(QD+'T12:00:00'):new Date(),prog:null,an:{},tab:'sel',open:null,loading:false,last:null,err:null};
var $=function(id){return document.getElementById(id)};
function pL(p){return p>=0.995?'> 99 %':p<=0.005?'< 1 %':E.pct(p)}
var EMO=/(?:[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{1F900}-\u{1F9FF}]|[\u2600-\u26FF\u2B50\u2B06]|[\u2700-\u2712\u2714-\u2716\u2718-\u27BF])\uFE0F?\u200D?\s?/gu;
function clean(h){return String(h).replace(EMO,'')}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function ddmmyyyy(d){return ('0'+d.getDate()).slice(-2)+('0'+(d.getMonth()+1)).slice(-2)+d.getFullYear()}
function hhmm(ms){return new Date(ms).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
function key(r,c){return 'R'+r+'C'+c}
function euros(x){return (Math.round(x*100)/100).toString().replace('.',',')+' €'}
var SPEC={TROT_ATTELE:'Trot attelé',TROT_MONTE:'Trot monté',PLAT:'Plat',HAIE:'Haies',STEEPLECHASE:'Steeple',CROSS:'Cross'};
var LVL={SEC:'COURSE NETTE',FORT:'ÉQUILIBRÉE',DOUTE:'OUVERTE'};

function timeout(ms){return new Promise(function(_,rej){setTimeout(function(){rej(new Error('délai dépassé'))},ms)})}
async function getJSON(url){
  var last;
  for(var k=0;k<ROUTES.length;k++){
    var i=(route+k)%ROUTES.length;
    try{
      var r=await Promise.race([fetch(ROUTES[i].f(url),{cache:'no-store'}),timeout(15000)]);
      if(r.status===204||(r.status===404&&i!==0))return null;
      if(!r.ok)throw new Error('HTTP '+r.status);
      var j=await r.json();
      if(i!==route){route=i;try{localStorage.setItem('turf.route2',i)}catch(e){}}
      return j;
    }catch(e){last=new Error(ROUTES[i].name+' : '+e.message)}
  }
  throw last||new Error('connexion impossible');
}

function setStatus(t){S.stTurf=t;if(S.mode!=='sport')$('st').textContent=t}
function setProg(x){$('prog').style.width=Math.round(x*100)+'%'}

/* ===== source Yanis (GitHub Pages) ===== */
var YANIS=/github\.io$/.test(location.hostname)||/[?&]src=yanis/.test(location.search);
var YBASE=(new URLSearchParams(location.search).get('ydata'))||'../data/';
var YD={files:{},banc:null,ent:null};
async function yFetch(name){var r=await Promise.race([fetch(YBASE+name+'?t='+Date.now(),{cache:'no-store'}),timeout(20000)]);if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
function yTime(s){if(!s)return 0;var m=String(s).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);return m?new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5]).getTime():0}
function musN(m,re){if(!m)return 0;var t=String(m).replace(/\(\d+\)/g,'').match(/[0-9DATRN][a-z]/g)||[];return t.filter(function(x){return re.test(x.charAt(0))}).length}
function yConv(j){
  var reus=(j.reunions||[]).map(function(r){
    var R={numOfficiel:r.r,hippodrome:{libelleCourt:r.hippodrome},pays:{code:r.pays},meteo:r.temperature!=null?{temperature:r.temperature,nebulositeLibelleCourt:r.ciel||''}:null,courses:[]};
    R.courses=(r.courses||[]).map(function(c){
      var C={numReunion:r.r,numOrdre:c.c,heureDepart:yTime(c.depart),libelle:c.libelle||'',libelleCourt:c.libelle||'',distance:c.distance,specialite:c.specialite,discipline:c.discipline,
        montantPrix:c.allocation,conditions:c.conditions||'',nombreDeclaresPartants:c.nb_partants,statut:c.statut||'',arriveeTxt:c.arrivee||'',rapports:c.rapports||[],
        paris:(c.paris||[]).map(function(t){return {typePari:t,miseBase:100}}),hippodromeNom:r.hippodrome,terrain:c.terrain,dateStr:j.date};
      C._parts=(c.partants||[]).map(function(p){return {numPmu:p.num,nom:p.nom,statut:p.statut,age:p.age,sexe:p.sexe,driver:p.driver,entraineur:p.entraineur,musique:p.musique,
        deferre:p.deferre,oeilleres:p.oeilleres,handicapDistance:p.recul,handicapPoids:p.poids,placeCorde:p.corde,dernierRapportDirect:{rapport:p.cote},dernierRapportReference:{rapport:p.cote_ref},
        gainsParticipant:{gainsCarriere:p.gains},ordreArrivee:p.place,proba:p.proba,proba_marche:p.proba_marche,st_driver:p.st_driver,st_entraineur:p.st_entraineur,cotes_suivies:p.cotes_suivies,incident:p.incident,value:p.value,nombreCourses:musN(p.musique,/./),nombreVictoires:musN(p.musique,/^1$/),nombrePlaces:musN(p.musique,/^[123]$/)}});
      return C;
    });
    return R;
  });
  return {reunions:reus,date:j.date,maj:j.maj};
}
function ymdDash(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)}
async function loadDayY(full){
  if(S.loading)return;S.loading=true;S.err=null;
  try{
    setStatus('Chargement des courses (données Yanis)…');setProg(.1);
    var names=['aujourdhui','demain','hier'];
    for(var i=0;i<names.length;i++){var n=names[i];if(!full&&n!=='aujourdhui'&&YD.files[n])continue;try{var j=await yFetch(n+'.json');YD.files[n]=j}catch(e){if(n==='aujourdhui')throw e}setProg(.1+.25*(i+1))}
    if(!YD.ent)try{var re=await fetch('entourage.json',{cache:'no-store'});if(re.ok)YD.ent=await re.json()}catch(e){}
    if(!YD.banc)try{var hv=await yFetch('hippique_v2.json');YD.banc=hv.banc_essai;YD.bancMaj=hv.banc_fait_le}catch(e){}
    var want=ymdDash(S.date),src=null;
    Object.keys(YD.files).forEach(function(n){if(YD.files[n]&&YD.files[n].date===want)src=YD.files[n]});
    if(!src){S.prog={reunions:[]};S.an={};throw new Error('Seuls hier, aujourd\'hui et demain sont disponibles.')}
    var P=yConv(src);S.prog=P;S.maj=src.maj;if(full)S.an={};
    var tot=0,done=0;P.reunions.forEach(function(r){tot+=r.courses.length});
    P.reunions.forEach(function(r){r.courses.forEach(function(c){
      var k=key(r.numOfficiel,c.numOrdre),oa=S.an[k];
      var na=E.analyse(c,c._parts,{dateSeed:+want.slice(0,4)});
      S.an[k]=na;
      if(oa&&oa.ok&&na.ok&&!na.arrivee&&c.heureDepart>Date.now()){
        var lbl='R'+r.numOfficiel+'C'+c.numOrdre+' '+hhmm(c.heureDepart)+' · ';
        if(na.n<oa.n)pushAlert('turf',k,lbl+'Non-partant : '+na.n+' partants désormais.');
        if(na.pick&&!oa.pick)pushAlert('turf',k,lbl+'Nouvelle formule à plus de 70 % : '+na.main.label+' — '+na.main.detail+' ('+E.pct(na.conf)+')');
        else if(!na.pick&&oa.pick)pushAlert('turf',k,lbl+'La formule repasse sous 70 % : ne plus jouer.');
        else if(na.pick&&oa.pick&&oa.main.detail!==na.main.detail)pushAlert('turf',k,lbl+'Formule modifiée : '+na.main.label+' — '+na.main.detail+' ('+E.pct(na.conf)+')');
      }
      if(oa&&oa.ok&&!oa.arrivee&&na.arrivee&&na.main)pushAlert('turf',k,'R'+r.numOfficiel+'C'+c.numOrdre+' · Arrivée '+na.arrivee.slice(0,5).join('-')+' : '+(na.main.gagne?'✓ '+na.main.label+' gagnant'+(na.main.retour?' ('+euros(na.main.retour)+' pour '+euros(na.main.cout)+')':''):'✗ '+na.main.label+' perdu'));
      done++;
    })});
    S.last=new Date();
    setStatus(countCourses()+' courses analysées · données mises à jour à '+(src.maj||'').slice(-5));
  }catch(e){S.err=e.message;setStatus('Erreur : '+e.message)}
  setProg(0);S.loading=false;render();
  $('upd').textContent=S.last?'MAJ '+S.last.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'';
}
async function loadDay(full){
  if(YANIS)return loadDayY(full);
  if(S.loading)return;S.loading=true;S.err=null;
  var d=ddmmyyyy(S.date);
  try{
    setStatus('Connexion au programme PMU…');setProg(.03);
    var j=await getJSON(API+d);
    if(!j||!j.programme){S.prog={reunions:[]};S.an={};throw new Error('Aucun programme publié pour cette date.')}
    S.prog=j.programme;
    if(full)S.an={};
    var todo=[];
    S.prog.reunions.forEach(function(r){r.courses.forEach(function(c){
      var k=key(r.numOfficiel,c.numOrdre),a=S.an[k];
      var soon=c.heureDepart-Date.now()<75*60000&&c.heureDepart-Date.now()>-60*60000;
      var finished=a&&a.arrivee;
      if(!a||!a.ok||(soon&&!finished)||(!finished&&c.heureDepart<Date.now()))todo.push([r,c]);
    })});
    var done=0,tot=todo.length;render();
    async function worker(){
      while(todo.length){
        var it=todo.shift(),r=it[0],c=it[1];
        try{
          var pj=await getJSON(API+d+'/R'+r.numOfficiel+'/C'+c.numOrdre+'/participants');
          var parts=pj&&(pj.participants||pj)||[],k=key(r.numOfficiel,c.numOrdre);
          if(S.perf[k]===undefined&&c.heureDepart>Date.now()-30*60000){
            try{S.perf[k]=await getJSON(API+d+'/R'+r.numOfficiel+'/C'+c.numOrdre+'/performances-detaillees/pretty')||false}catch(e){S.perf[k]=false}
          }
          var oa=S.an[k];
          var na=E.analyse(Object.assign({numReunion:r.numOfficiel,hippodromeNom:r.hippodrome.libelleCourt},c),Array.isArray(parts)?parts:[],{dateSeed:+d.slice(0,4),perfs:S.perf[k]||null});
          S.an[k]=na;
          if(oa&&oa.ok&&na.ok&&!na.arrivee&&c.heureDepart>Date.now()){
            var lbl='R'+r.numOfficiel+'C'+c.numOrdre+' '+hhmm(c.heureDepart)+' · ';
            if(na.n<oa.n)pushAlert('turf',k,lbl+'Non-partant : '+na.n+' partants désormais.');
            if(na.pick&&!oa.pick)pushAlert('turf',k,lbl+'Nouvelle formule à plus de 70 % : '+na.main.label+' — '+na.main.detail+' ('+E.pct(na.conf)+')');
        else if(!na.pick&&oa.pick)pushAlert('turf',k,lbl+'La formule repasse sous 70 % : ne plus jouer.');
        else if(na.pick&&oa.pick&&oa.main.detail!==na.main.detail)pushAlert('turf',k,lbl+'Formule modifiée : '+na.main.label+' — '+na.main.detail+' ('+E.pct(na.conf)+')');
            else if(oa.ranking[0].num!==na.ranking[0].num)pushAlert('turf',k,lbl+'Nouvelle base : n°'+na.ranking[0].num+' '+na.ranking[0].nom);
          }
        }catch(e){S.an[key(r.numOfficiel,c.numOrdre)]={ok:false,message:'Partants indisponibles ('+e.message+')',course:c}}
        done++;setProg(.05+.95*done/Math.max(1,tot));setStatus('Analyse des courses… '+done+'/'+tot);
        if(done%8===0)render();
      }
    }
    await Promise.all([worker(),worker(),worker(),worker()]);
    S.last=new Date();
    setStatus(countCourses()+' courses analysées · source '+ROUTES[route].name+(MODELS?' · modèle entraîné':''));
    if(MODELS&&!LEARN.running&&Date.now()-MODELS.at>20*3600e3)setTimeout(function(){runLearn(true)},500);
  }catch(e){S.err=e.message;setStatus('Erreur : '+e.message)}
  setProg(0);S.loading=false;render();
  $('upd').textContent=S.last?'MAJ '+S.last.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'';
}
function countCourses(){return Object.keys(S.an).filter(function(k){return S.an[k].ok}).length}

function allCourses(){
  var out=[];if(!S.prog)return out;
  S.prog.reunions.forEach(function(r){r.courses.forEach(function(c){out.push({r:r,c:c,a:S.an[key(r.numOfficiel,c.numOrdre)]})})});
  return out;
}
function wolf(a){if(!a||!a.watch)return '';var w=a.watch;return '<div class="wolf'+(w.strong?' strong':'')+'">🐺 '+(w.strong?'LOUP':'À surveiller')+' : n°'+w.h.num+' '+esc(w.h.nom)+' · cote '+E.fmtCote(w.h.cote)+' · dans les 3 : '+E.pct(w.pPlace)+' (outsider moyen '+E.pct(w.pBase)+')'+(w.strong?' → '+(a.loupMode||'3 bases + 5'):'')+'</div>'}
function badge(a){if(!a||!a.ok)return '<span class="badge NA">EN ATTENTE</span>';return (a.loup?'<span class="badge LOUP">LOUP</span> ':'')+(a.avoid?'<span class="badge NA">À ÉVITER</span>':'<span class="badge '+a.level+'">'+LVL[a.level]+'</span>')}
function resultTag(a){if(!a||!a.arrivee||!a.main)return '';return a.main.gagne?' <span class="ok">✓ gagnant</span>':' <span class="ko">✗ perdu</span>'}

function tState(c,a){
  var now=Date.now(),st=c.statut||'';
  if(a&&a.arrivee)return {cls:'fin',txt:'🏁 Arrivée : '+a.arrivee.slice(0,5).join(' - ')};
  if(/ANNUL/.test(st))return {cls:'fin',txt:'Course annulée'};
  if(/EN_COURS|COURSE_PARTIE|FIN_COURSE/.test(st)||(c.heureDepart&&now>=c.heureDepart&&now<c.heureDepart+20*60000))return {cls:'live',txt:'EN COURSE'};
  if(c.heureDepart&&now<c.heureDepart){var m=Math.round((c.heureDepart-now)/60000);return {cls:m<=15?'soon':'pre',txt:m<=60?'Départ dans '+m+' min':'Départ '+hhmm(c.heureDepart)}}
  return {cls:'pre',txt:'Résultat en attente'};
}
function liveStrip(c,a){var t=tState(c,a);return '<div class="strip '+t.cls+'">'+(t.cls==='live'?'<i class="dot"></i>':'')+esc(t.txt)+'</div>'}
function equidiaUrl(c,r){var d=c.dateStr||ymdDash(S.date);return 'https://www.equidia.fr/courses/'+d+'/R'+r.numOfficiel+'/C'+c.numOrdre}
var RORDER=['SIMPLE_GAGNANT','SIMPLE_PLACE','COUPLE_GAGNANT','COUPLE_PLACE','COUPLE_ORDRE','DEUX_SUR_QUATRE','TRIO','TRIO_ORDRE','TIERCE','QUARTE_PLUS','QUINTE_PLUS','MULTI','MINI_MULTI','SUPER_QUATRE','SUPER_PICK5'];
var RNAME={SIMPLE_GAGNANT:'Simple gagnant',SIMPLE_PLACE:'Simple placé',COUPLE_GAGNANT:'Jumelé (couplé) gagnant',COUPLE_PLACE:'Jumelé (couplé) placé',COUPLE_ORDRE:'Couplé ordre',DEUX_SUR_QUATRE:'2 sur 4',TRIO:'Trio',TRIO_ORDRE:'Trio ordre',TIERCE:'Tiercé',QUARTE_PLUS:'Quarté+',QUINTE_PLUS:'Quinté+',MULTI:'Multi',MINI_MULTI:'Mini multi',SUPER_QUATRE:'Super 4',SUPER_PICK5:'Pick 5'};
function rLabel(r){
  var l=String(r.libelle||RNAME[r.pari]||r.pari).replace(/2sur4/i,'2 sur 4').replace(/Super4/i,'Super 4').replace(/Pick5/i,'Pick 5').replace(/ 1 NP$/,' (1 non-partant)').replace(/Bonus 4sur5/i,'Bonus 4 sur 5');
  if(/^Bonus/i.test(l))l=(RNAME[r.pari]||'')+' '+l;
  l=l.replace(/^Couplé Gagnant/i,'Couplé gagnant (jumelé)').replace(/^Couplé Placé/i,'Couplé placé (jumelé)').replace(/^Simple Gagnant/i,'Simple gagnant').replace(/^Simple Placé/i,'Simple placé');
  return l.charAt(0).toUpperCase()+l.slice(1);
}
function fmtR(x){return x==null?'—':Number(x).toFixed(2).replace('.',',')+' €'}
function rapportsTable(c){
  var R=(c.rapports||[]).filter(function(r){return r.rapport>0});if(!R.length)return c.arriveeTxt?'<h2>Rapports officiels PMU</h2><div class="card mute">Rapports pas encore publiés par le PMU. Ils apparaissent ici dès leur publication (mise à jour toutes les 15 minutes).</div>':'';
  var rs=R.slice().sort(function(a,b){return (RORDER.indexOf(a.pari)+1||99)-(RORDER.indexOf(b.pari)+1||99)||String(a.libelle).localeCompare(String(b.libelle))});
  var h='<h2>Rapports officiels PMU — pour 1 € joué</h2><div class="card rtab"><div class="rh"><span>Pari</span><span>Combinaison</span><span>Pour 1 €</span></div>';
  rs.forEach(function(r){h+='<div class="rr"><span>'+esc(rLabel(r))+'</span><span class="mono">'+esc(String(r.combinaison))+'</span><b>'+fmtR(r.rapport)+'</b></div>'});
  return h+'</div>';
}
function rapportsMini(c){var R=c.rapports||[];if(!R.length)return '';var pick=function(t,re){var x=R.filter(function(r){return r.pari===t&&(!re||re.test(r.libelle||''))})[0];return x&&x.rapport>0?x.rapport:null};
  var pl=R.filter(function(r){return r.pari==='SIMPLE_PLACE'&&r.rapport>0}).map(function(r){return ['Placé n°'+String(r.combinaison).replace(/\D+/g,''),r.rapport]});
  var o=[['Gagnant',pick('SIMPLE_GAGNANT')]].concat(pl,[['Couplé G.',pick('COUPLE_GAGNANT')],['2 sur 4',pick('DEUX_SUR_QUATRE')],['Trio',pick('TRIO')],['Multi en 4',pick('MULTI',/en 4/i)],['Mini multi en 4',pick('MINI_MULTI',/en 4/i)],['Quinté+ désordre',pick('QUINTE_PLUS',/sordre/i)]]).filter(function(x){return x[1]!=null});
  return o.length?'<div class="rmini"><em>Rapports pour 1 €</em>'+o.map(function(x){return '<span>'+x[0]+' <b>'+fmtR(x[1])+'</b></span>'}).join('')+'</div>':''}
function money(a){var m=a.main;if(!m||!a.arrivee)return '';if(m.rapportOk)return m.gagne?' <span class="ok">✓ retour '+euros(m.retour)+' pour '+euros(m.cout)+'</span>':' <span class="ko">✗ −'+euros(m.cout)+'</span>';return resultTag(a)}
/* ===== onglet Value : la cote paie plus que le risque ===== */
var VF={f:'all'};
function valueList(){
  var out=[],now=Date.now();
  allCourses().forEach(function(x){var a=x.a,c=x.c;if(!a||!a.ok||a.arrivee||!c.heureDepart||c.heureDepart<now)return;
    a.ranking.forEach(function(h){if(!h.cote||h.cote<4||h.p<0.05||!h.ev||h.ev<1.10)return;
      out.push({kind:'turf',k:key(x.r.numOfficiel,x.c.numOrdre),when:c.heureDepart,ctx:'🏇 R'+x.r.numOfficiel+'C'+x.c.numOrdre+' · '+x.r.hippodrome.libelleCourt+' · '+hhmm(c.heureDepart),title:'n°'+h.num+' '+h.nom,pari:'Simple gagnant',p:h.p,dec:h.cote,ev:h.ev,place:h.top[2],extra:h.loupFlag})});
  });
  (SP.data||[]).forEach(function(x,i){SportEngine.valueBets(x).forEach(function(v){if(v.dec<1.8||v.ev<1.05||v.p<0.12)return;
    var t=new Date(x.date);out.push({kind:'sport',s:i,when:t.getTime(),ctx:(ICON[x.sport]||'')+' '+x.league+' · '+(isNaN(t)?'':t.toLocaleString('fr-FR',{weekday:'short',hour:'2-digit',minute:'2-digit'}))+(x.state.state==='in'?' · EN DIRECT':''),title:x.title,pari:v.label,p:v.p,dec:v.dec,ev:v.ev})})});
  return out.filter(function(v){return VF.f==='all'||v.kind===VF.f}).sort(function(a,b){return b.ev-a.ev});
}
function pointsTurf(){
  var now=Date.now(),faux=[],solides=[],loups=[];
  allCourses().forEach(function(x){var a=x.a,c=x.c;if(!a||!a.ok||a.arrivee||!c.heureDepart||c.heureDepart<now-5*60000||!a.market)return;
    var f=a.H.filter(function(h){return h.cote}).sort(function(u,v){return u.cote-v.cote})[0];if(!f||!f.pm)return;
    var q=f.p/f.pm,it={x:x,a:a,f:f,q:q,k:key(x.r.numOfficiel,x.c.numOrdre)};
    if(q<0.95)faux.push(it);else if(q>1.05)solides.push(it);
    if(a.watch&&a.watch.strong)loups.push(it);
  });
  faux.sort(function(u,v){return u.q-v.q});solides.sort(function(u,v){return v.q-u.q});
  return {faux:faux,solides:solides,loups:loups};
}
function ctxLine(it){return '🏇 R'+it.x.r.numOfficiel+'C'+it.x.c.numOrdre+' · '+esc(it.x.r.hippodrome.libelleCourt)+' · '+hhmm(it.x.c.heureDepart)}
function viewValue(){
  var h='<div class="chips"><button data-vf="all" class="'+(VF.f==='all'?'on':'')+'">🎯 Tout</button><button data-vf="turf" class="'+(VF.f==='turf'?'on':'')+'">🏇 Courses</button><button data-vf="sport" class="'+(VF.f==='sport'?'on':'')+'">⚽ Matchs</button></div>';
  if(VF.f!=='sport'){
    var P=pointsTurf();
    h+='<h2>⚠️ Faux favoris ('+P.faux.length+') — le public se trompe</h2>';
    if(!P.faux.length)h+='<div class="card mute">Aucun faux favori repéré pour les courses à venir.</div>';
    P.faux.forEach(function(it){h+='<div class="card tap pn bad" data-k="'+it.k+'"><div class="mute">'+ctxLine(it)+'</div><div class="ttl" style="margin:4px 0">Favori n°'+it.f.num+' '+esc(it.f.nom)+' · cote '+E.fmtCote(it.f.cote)+'</div><div>Le public lui donne <b>'+E.pct(it.f.pm)+'</b>, nos calculs seulement <b class="ko">'+E.pct(it.f.p)+'</b>. Ne pas le prendre en base : jouer les autres.</div></div>'});
    h+='<p class="mute">Vérifié sur juin–novembre : ces favoris gagnent 21,9 % au lieu des 25,1 % annoncés par leur cote, et les plus fragiles 6 % au lieu de 23 %.</p>';
    h+='<h2>🐺 Loups ('+P.loups.length+') — l\'outsider qui cache son jeu</h2>';
    if(!P.loups.length)h+='<div class="card mute">Aucun loup fort pour les courses à venir.</div>';
    P.loups.forEach(function(it){var w=it.a.watch;h+='<div class="card tap pn wolfc" data-k="'+it.k+'"><div class="mute">'+ctxLine(it)+'</div><div class="ttl" style="margin:4px 0">n°'+w.h.num+' '+esc(w.h.nom)+' · cote '+E.fmtCote(w.h.cote)+'</div><div>Dans les 3 premiers : <b class="ok">'+E.pct(w.pPlace)+'</b> (un outsider à cette cote : '+E.pct(w.pBase)+')'+(w.why.length?' — '+esc(w.why.join(', ')):'')+'</div><div class="mute">À mettre en 3e base : multi / quinté 3 bases + 5.</div></div>'});
    h+='<h2>✅ Favoris solides ('+P.solides.length+') — bases fiables</h2>';
    P.solides.slice(0,15).forEach(function(it){h+='<div class="card tap pn good" data-k="'+it.k+'"><div class="mute">'+ctxLine(it)+'</div><div class="ttl" style="margin:4px 0">n°'+it.f.num+' '+esc(it.f.nom)+' · cote '+E.fmtCote(it.f.cote)+'</div><div>Nos calculs : <b class="ok">'+E.pct(it.f.p)+'</b> de chances de gagner, le public : '+E.pct(it.f.pm)+'.</div></div>'});
    h+='<p class="mute">Vérifié sur juin–novembre : ces favoris gagnent 34,2 % au lieu des 31,9 % annoncés.</p>';
  }
  var L=valueList().filter(function(v){return VF.f==='all'||v.kind===VF.f});
  h+='<h2>💎 Cotes trop belles ('+L.length+') — la cote paie plus que la vraie chance</h2>';
  if(!L.length)h+='<div class="card mute">Aucune pour l\'instant'+(SP.loading?' (matchs en cours de chargement)':'')+'.</div>';
  L.forEach(function(v){
    h+='<div class="card tap vcard" '+(v.kind==='turf'?'data-k="'+v.k+'"':'data-s="'+v.s+'"')+'><div class="mute">'+esc(v.ctx)+'</div>'+
      '<div class="ttl" style="font-size:16px;margin:4px 0">'+esc(v.title)+'</div><div>🎯 '+esc(v.pari)+'</div>'+
      '<div class="vgrid"><div><span>Cote</span><b class="cote">'+String(Math.round(v.dec*100)/100).replace('.',',')+'</b></div><div class="win"><span>Chance de gagner</span><b class="ok">'+E.pct(v.p)+'</b></div><div class="lose"><span>Si ça passe</span><b>1 € → '+String((Math.round(v.dec*100)/100).toFixed(2)).replace('.',',')+' €</b></div></div>'+
      '<div class="ev">La cote juste serait '+fair(v.p)+' : elle est payée '+String((Math.round(v.dec*100)/100).toFixed(2)).replace('.',',')+'.'+(v.place!=null?' Dans les 3 premiers : '+E.pct(v.place)+'.':'')+'</div></div>';
  });
  return h;
}
function viewSel(){
  var now=Date.now();
  var list=allCourses().filter(function(x){return x.a&&x.a.ok&&x.a.main&&!x.a.arrivee&&x.c.heureDepart>now-25*60000});
  list.sort(function(x,y){return y.a.potentiel-x.a.potentiel});
  var top=list;
  if(!S.prog)return intro();
  var lc=(!MODELS||LEARN.running)?learnCard(false):'';
  if(!top.length)return lc+'<div class="card">'+(S.loading?'Analyse en cours…':'Aucune course à venir avec des partants publiés pour cette date.')+'</div>'+finishedBlock();
  var picks=top.filter(function(x){return x.a.pick}),rest=top.filter(function(x){return !x.a.pick});
  var h=lc+'<h2>'+picks.length+' course'+(picks.length>1?'s':'')+' avec une formule à plus de 70 %</h2><p class="mute" style="margin-top:-4px">Pour chaque course, l\'appli teste le simple placé, le 2 sur 4, le trio et le multi (jusqu\'à 8 combinaisons) et ne retient que la formule la moins chère qui dépasse 70 % de chances. Le pourcentage est la chance que la formule passe. Elle n\'est rentable que si le rapport dépasse le retour indiqué sur la carte.</p>';
  if(!picks.length)h+='<div class="card">Aucune course n\'a pour l\'instant de formule au-dessus de 70 %. Les cotes ouvrent en général une à deux heures avant le départ : l\'analyse se met à jour toute seule.</div>';
  picks.forEach(function(x,i){
    var a=x.a,m=a.main,base=a.ranking[0];
    h+='<div class="card tap sp-'+(/TROT/.test(x.c.specialite)?'trot':'galop')+'" data-k="'+key(x.r.numOfficiel,x.c.numOrdre)+'">'+liveStrip(x.c,a)+
      '<div class="row"><span class="mute">#'+(i+1)+' · '+hhmm(x.c.heureDepart)+' · R'+x.r.numOfficiel+'C'+x.c.numOrdre+' '+esc(x.r.hippodrome.libelleCourt)+'</span>'+badge(a)+'</div>'+
      '<div class="big">'+esc(m.label)+'</div><div>'+esc(m.detail)+'</div>'+wolf(a)+
      '<div class="kv"><span>Base n°'+base.num+' '+esc(base.nom)+'</span><span>cote '+E.fmtCote(base.cote)+' · gagne '+E.pct(base.p)+' · top 3 '+E.pct(base.top[2])+'</span></div>'+
      '<div class="kv"><span>La formule passe</span><b class="conf">'+E.pct(a.conf)+'</b></div><div class="meter"><i style="width:'+Math.round(a.conf*100)+'%"></i></div>'+(m.combos?'<div class="mute">'+m.combos+' combinaison'+(m.combos>1?'s':'')+' · '+euros(m.cout)+' (1 € par combinaison) · rentable si le retour dépasse '+euros(m.cout/m.p)+'</div>':'')+'</div>';
  });
  if(rest.length){
    h+='<h2>Sous 70 % : pas de pari ('+rest.length+')</h2><p class="mute" style="margin-top:-4px">Aucune formule à 8 combinaisons ou moins ne dépasse 70 % sur ces courses. Beaucoup n\'ont pas encore leurs cotes : elles sont réanalysées à l\'ouverture.</p>';
    rest.forEach(function(x){var a=x.a;
      h+='<div class="card tap" data-k="'+key(x.r.numOfficiel,x.c.numOrdre)+'"><div class="row"><span class="mute">'+hhmm(x.c.heureDepart)+' · R'+x.r.numOfficiel+'C'+x.c.numOrdre+' '+esc(x.r.hippodrome.libelleCourt)+'</span><span class="badge NA">'+(a.market?'SOUS 70 %':'COTES FERMÉES')+'</span></div><div class="mute">Meilleur jeu : '+esc(a.main.label)+' à '+E.pct(a.conf)+(a.market?'':' (forme seule, à revoir à l\'ouverture des cotes)')+'</div></div>';});
  }
  h+='<p class="mute">Les pourcentages viennent de 20 000 arrivées simulées. Le bilan réel des formules retenues (prévu contre réussi) est dans l\'onglet Bilan.</p>';
  return h+finishedBlock();
}
function finishedBlock(){
  var fin=allCourses().filter(function(x){return x.a&&x.a.ok&&x.a.arrivee}).sort(function(u,v){return v.c.heureDepart-u.c.heureDepart});
  if(!fin.length)return '';
  var h='<h2>Courses terminées ('+fin.length+') — arrivée et rapports pour 1 €</h2>';
  fin.forEach(function(x){var m=x.a.main;h+='<div class="card tap fin" data-k="'+key(x.r.numOfficiel,x.c.numOrdre)+'"><div class="row"><span class="mute">'+hhmm(x.c.heureDepart)+' · R'+x.r.numOfficiel+'C'+x.c.numOrdre+' '+esc(x.r.hippodrome.libelleCourt)+'</span><span class="mono">'+x.a.arrivee.slice(0,5).join(' - ')+'</span></div>'+(m?'<div>'+esc(m.label)+' : '+esc(m.detail)+money(x.a)+'</div>':'')+(rapportsMini(x.c)||'<div class="mute">Rapports PMU pas encore publiés.</div>')+'</div>'});
  return h;
}
function viewProg(){
  if(!S.prog)return intro();
  var h='';
  S.prog.reunions.forEach(function(r){
    var met=r.meteo?' · '+r.meteo.temperature+'° '+esc(r.meteo.nebulositeLibelleCourt||''):'';
    h+='<div class="reu"><div class="row"><span class="ttl">R'+r.numOfficiel+' · '+esc(r.hippodrome.libelleCourt)+'</span><span class="mute">'+esc(r.pays.code)+met+'</span></div><div class="card">';
    r.courses.forEach(function(c){
      var a=S.an[key(r.numOfficiel,c.numOrdre)];
      var sub=a&&a.ok&&a.main?esc(a.main.label)+' · '+esc(a.main.detail):(a&&a.message?esc(a.message):'Analyse en attente');
      h+='<div class="crow tap" data-k="'+key(r.numOfficiel,c.numOrdre)+'"><span class="h">'+hhmm(c.heureDepart)+'</span><span class="m"><div class="ttl">C'+c.numOrdre+' · '+esc(c.libelleCourt||c.libelle)+'</div><div class="mute">'+(SPEC[c.specialite]||esc(c.discipline))+' · '+c.distance+' m · '+(a&&a.ok?a.n:c.nombreDeclaresPartants)+' partants</div><div class="mute">'+sub+money(a||{})+'</div>'+(a&&!a.arrivee?wolf(a):'')+liveStrip(c,a)+rapportsMini(c)+'</span>'+badge(a)+'</div>';
    });
    h+='</div></div>';
  });
  return h||'<div class="card">Aucune réunion.</div>';
}
function viewBilan(){
  if(!S.prog)return intro();
  var lc=learnCard(true);
  var fin=allCourses().filter(function(x){return x.a&&x.a.ok&&x.a.arrivee&&x.a.main});
  if(!fin.length)return lc+'<div class="card">Aucune arrivée connue pour le moment. Le bilan se remplit automatiquement au fil des courses.</div>';
  var win=0,mise=0,ret=0,nR=0,byL={SEC:[0,0,0,0],FORT:[0,0,0,0],DOUTE:[0,0,0,0]};
  fin.forEach(function(x){var m=x.a.main,g=m.gagne;if(g)win++;mise+=m.cout;var L=byL[x.a.level];L[0]+=g?1:0;L[1]++;if(m.rapportOk){nR++;ret+=m.retour;L[2]+=m.cout;L[3]+=m.retour}});
  var exp=fin.reduce(function(s,x){return s+x.a.conf},0);
  var h=lc+'<div class="kpis"><div><b>'+win+'/'+fin.length+'</b><span class="mute">jeux gagnants</span></div><div><b>'+E.pct(win/fin.length)+'</b><span class="mute">réussite réelle</span></div><div><b>'+E.pct(exp/fin.length)+'</b><span class="mute">réussite prévue</span></div></div>';
  var fp=fin.filter(function(x){return x.a.pick});
  if(fp.length){var wp=fp.filter(function(x){return x.a.main.gagne}).length,ep=fp.reduce(function(s,x){return s+x.a.conf},0)/fp.length,mp=0,rp=0,np=0;fp.forEach(function(x){var m=x.a.main;mp+=m.cout;if(m.rapportOk){rp+=m.retour;np++}});
    h+='<h2>Formules à plus de 70 %</h2><div class="card"><div class="mk"><span>Formules retenues passées</span><b>'+wp+' / '+fp.length+'</b></div><div class="mk"><span>Réussite réelle / annoncée</span><b>'+E.pct(wp/fp.length)+' / '+E.pct(ep)+'</b></div>'+(np?'<div class="mk"><span>Résultat avec les rapports PMU</span><b class="'+(rp>=mp?'ok':'ko')+'">'+(rp-mp>=0?'+':'')+euros(rp-mp)+' pour '+euros(mp)+' misés</b></div>':'')+'</div>';
  }else h+='<h2>Formules à plus de 70 %</h2><div class="card mute">Aucune course terminée n\'avait de formule à plus de 70 %. Le suivi apparaît ici dès qu\'il y en a.</div>';
  h+='<h2>Par niveau</h2><div class="card">';
  ['SEC','FORT','DOUTE'].forEach(function(l){var v=byL[l];h+='<div class="row" style="padding:4px 0"><span class="badge '+l+'">'+LVL[l]+'</span><span>'+v[0]+' / '+v[1]+(v[2]?' · <span class="'+(v[3]>=v[2]?'ok':'ko')+'">'+(v[3]-v[2]>=0?'+':'')+euros(v[3]-v[2])+'</span>':'')+'</span></div>'});
  h+='</div>';
  if(nR){var net=ret-mise;h+='<div class="card money '+(net>=0?'up':'down')+'"><div class="mute">Bilan réel avec les rapports PMU (1 € par combinaison, jeux principaux)</div><div class="big">'+(net>=0?'+':'')+euros(net)+'</div><div class="mute">Mis : '+euros(mise)+' · Rapporté : '+euros(ret)+'</div></div>'}
  h+='<p class="mute">Si la réussite réelle reste proche de la réussite prévue sur plusieurs semaines, le modèle est bien calibré.</p><h2>Courses terminées</h2>';
  fin.forEach(function(x){h+='<div class="card tap" data-k="'+key(x.r.numOfficiel,x.c.numOrdre)+'"><div class="row"><span class="mute">R'+x.r.numOfficiel+'C'+x.c.numOrdre+' · '+esc(x.r.hippodrome.libelleCourt)+'</span>'+badge(x.a)+'</div><div>'+esc(x.a.main.label)+' : '+esc(x.a.main.detail)+money(x.a)+'</div><div class="mute">Arrivée : '+x.a.arrivee.slice(0,5).join(' - ')+'</div>'+(rapportsMini(x.c)||'<div class="mute">Rapports PMU pas encore publiés.</div>')+'</div>'});
  return h;
}
function intro(){
  if(S.err)return '<div class="card err"><div class="ttl">Connexion au PMU impossible</div><p>'+esc(S.err)+'</p><p class="mute">L\'appli a essayé la connexion directe puis deux relais. Vérifie ta connexion internet et réessaie.</p><button class="primary" id="retry">Réessayer</button></div>';
  return '<div class="card">Chargement du programme…</div>';
}

var TOPN=null;function topNames(){if(TOPN||!YD.ent)return TOPN;var L=Object.entries(YD.ent.driver||{}).sort(function(a,b){return b[1][1]-a[1][1]}).slice(0,20).map(function(x){return x[0]});TOPN=L;return L}
function bigName(h){var T=topNames();if(!T||!h.cote||h.cote>3)return '';if(T.indexOf((h.driver||'').toUpperCase())<0)return '';return '<li class="p">▲ Grand nom à cote courte : sur 14 mois, les 20 drivers/jockeys qui gagnent le plus, à cote ≤ 3, gagnent 41 à 43 % des courses quand leurs cotes en annoncent 38 % (dans les 3 premiers : 70 %)</li>'}
function entLine(role,name){
  var T=YD.ent&&YD.ent[role],s=T&&T[(name||'').toUpperCase()];if(!s)return '';
  var ae=s[1]/Math.max(0.1,s[2]),lab=role==='driver'?'Driver/jockey':'Entraîneur',txt=lab+' '+name+' : '+s[1]+' victoires pour '+String(s[2]).replace('.',',')+' attendues par les cotes sur '+s[0]+' courses';
  if(s[3]>=10)txt+=' · favori '+s[3]+' fois, '+s[4]+' gagnées pour '+String(s[5]).replace('.',',')+' attendues';
  var cls=ae>=1.25?'p':ae<=0.75?'n':'';return '<li class="'+cls+'">'+(cls==='p'?'▲ ':cls==='n'?'▼ ':'• ')+esc(txt)+'</li>';
}
function sheet(k){
  var x=allCourses().filter(function(y){return key(y.r.numOfficiel,y.c.numOrdre)===k})[0];if(!x)return;
  var a=x.a,c=x.c,r=x.r;
  var h='<div class="row" style="margin-bottom:8px"><button id="close">‹ Retour</button>'+badge(a)+'</div>';
  h+='<div class="ttl" style="font-size:18px">R'+r.numOfficiel+'C'+c.numOrdre+' · '+esc(c.libelle)+'</div>';
  h+='<div class="mute">'+hhmm(c.heureDepart)+' · '+esc(r.hippodrome.libelleCourt)+' · '+(SPEC[c.specialite]||esc(c.discipline))+' · '+c.distance+' m · '+(c.montantPrix||0).toLocaleString('fr-FR')+' €</div>';
  if(c.conditions)h+='<div class="mute" style="margin-top:4px">'+esc(c.conditions)+'</div>';
  if(!a||!a.ok){sheetOpen(h+'<div class="card" style="margin-top:12px">'+esc(a&&a.message||'Analyse en attente.')+'</div>');return}
  h+='<div style="margin-top:10px">'+liveStrip(c,a)+'</div>';
  h+=wolf(a);if(a.watch&&!a.watch.strong&&a.watch.why.length)h+='<div class="mute" style="margin-top:4px">Pourquoi le surveiller : '+esc(a.watch.why.join(', '))+'. Écart trop faible avec un outsider ordinaire pour passer à 3 bases : à ajouter si tu veux élargir.</div>';
  h+='<a class="btn-eq" href="'+equidiaUrl(c,r)+'" target="_blank" rel="noopener">▶ Regarder sur Equidia (direct et replay)</a>';
  h+='<h2>Jeux proposés</h2>';
  a.jeux.forEach(function(j){
    h+='<div class="jeu'+(j.main?' main':'')+'"><div class="row"><span class="ttl">'+(j.main?'★ ':'')+esc(j.label)+'</span><span class="conf">'+E.pct(j.p)+'</span></div><div>'+esc(j.detail)+'</div><div class="mute">'+j.combos+' combinaison'+(j.combos>1?'s':'')+' · '+euros(j.cout)+(YANIS?' (1 € par combinaison)':' en mise de base')+(j.hist?'<br>📊 Testé sur '+j.hist.n+' courses réelles : '+E.pct(j.hist.hit)+' gagnants · rentabilité <span class="'+(j.hist.roi>=0?'ok':'ko')+'">'+(j.hist.roi>=0?'+':'')+String(Math.round(j.hist.roi*1000)/10).replace('.',',')+' %</span>':'')+(j.gagne===true?' · <span class="ok">✓ gagnant'+(j.rapportOk?' : retour '+euros(j.retour):'')+'</span>':j.gagne===false?' · <span class="ko">✗ perdu</span>':'')+'</div></div>';
  });
  if(a.cands&&a.cands.length)h+='<h2>Formules testées sur cette course</h2><div class="card">'+a.cands.slice().sort(function(u,v){return u.cost-v.cost||v.p-u.p}).map(function(q){return '<div class="mk"><span>'+esc(q.l)+'<br><span class="mute">'+q.cost+' combinaison'+(q.cost>1?'s':'')+'</span></span><span class="'+(q.p>=0.72?'ok':'ko')+'">'+E.pct(q.p)+'</span></div>'}).join('')+'<p class="mute">Retenue : la moins chère à 72 % ou plus (marge de sécurité sur les 70 % affichés).</p></div>';
  h+=rapportsTable(c);
  h+='<h2>Pourquoi ce choix</h2><div class="card">'+a.why.map(function(w){return '<p style="margin:4px 0">'+esc(w)+'</p>'}).join('')+'</div>';
  h+='<h2>Classement du modèle</h2><div class="card">';
  a.ranking.forEach(function(hh,i){
    var rs=E.horseReasons(hh).filter(function(x){return !(YD.ent&&/victoire\(s\)/.test(x.txt)&&/^(Driver\/jockey|Entraîneur) /.test(x.txt))}).slice(0,5);
    var ev=hh.ev!=null?(hh.ev>=1.15?' · <span class="ok">value '+hh.ev.toFixed(2).replace('.',',')+'</span>':''):'';
    h+='<div class="horse"><div class="row"><span style="display:flex;align-items:center;min-width:0"><span class="hn'+(i<2?' b':'')+'">'+hh.num+'</span><span style="min-width:0"><div class="ttl">'+esc(hh.nom)+(hh.arrivee?' <span class="mute">('+hh.arrivee+'e)</span>':'')+'</div><div class="mute">'+esc(hh.driver)+(hh.driverChange?' (nouveau)':'')+' · '+esc(hh.musique||'pas de musique')+'</div></span></span><span style="text-align:right"><div class="conf">'+E.pct(hh.p)+'</div><div class="mute">cote '+E.fmtCote(hh.cote)+(hh.suivi&&hh.suivi.length>1?' <span style="opacity:.8">(début '+E.fmtCote(hh.suivi[0][1])+')</span>':hh.coteRef&&hh.coteRef!==hh.cote?' <span style="opacity:.8">(réf. '+E.fmtCote(hh.coteRef)+')</span>':'')+ev+'</div></span></div>'+
      '<div class="mute" style="margin-left:36px">Gagne '+E.pct(hh.top[0])+' · Top 3 '+E.pct(hh.top[2])+' · Top 4 '+E.pct(hh.top[3])+'</div>'+
      (rs.length||YD.ent?'<ul class="why">'+rs.map(function(x){return '<li class="'+(x.sign>0?'p':x.sign<0?'n':'')+'">'+(x.sign>0?'▲ ':x.sign<0?'▼ ':'• ')+esc(x.txt)+'</li>'}).join('')+bigName(hh)+entLine('driver',hh.driver)+entLine('entraineur',hh.entraineur)+'</ul>':'')+'</div>';
  });
  h+='</div><p class="mute">Entourage (driver, entraîneur) : victoires réelles comparées à ce que leurs cotes annonçaient, sur 14 mois. Information seulement : testé sur 5 818 courses, cet historique n\'améliore pas les prédictions (le public l\'intègre déjà dans les cotes), il n\'entre donc pas dans le calcul. Un écart sur quelques dizaines de courses peut être dû au hasard et ne prouve aucune intention.</p><p class="mute">Probabilités = forme (musique pondérée), régularité, classe (gains), spécificités (ferrure, recul, poids, corde, avis entraîneur) combinées avec la cote du public. Les arrangements de course et incidents ne sont pas calculables.</p>';
  sheetOpen(h);
}
function sheetOpen(h){S.open=true;$('sheetIn').innerHTML=clean(h);$('sheet').classList.add('open');$('sheet').scrollTop=0;$('close')&&($('close').onclick=function(){if(history.state&&history.state.s)history.back();else closeSheet()});try{history.pushState({s:1},'')}catch(e){}}
function closeSheet(){if(!S.open)return;S.open=null;$('sheet').classList.remove('open')}
window.addEventListener('popstate',closeSheet);

function render(){
  var v=S.mode==='value'?viewValue():S.mode==='sport'?SP.view():S.tab==='sel'?viewSel():S.tab==='prog'?viewProg():viewBilan();
  var dl=S.date.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  $('view').innerHTML=clean('<div class="mute" style="margin-bottom:8px;text-transform:capitalize">'+dl+'</div>'+v+'<p class="foot">Jeu responsable : fixe ton budget à l\'avance. Joueurs Info Service 09 74 75 13 13.</p>');
  document.querySelectorAll('[data-vf]').forEach(function(b){b.onclick=function(){VF.f=b.dataset.vf;render()}});
  var lb=$('learnBtn');if(lb)lb.onclick=function(){runLearn(false)};
  var rb=$('retry');if(rb)rb.onclick=function(){S.mode==='sport'?SP.load(true):loadDay(true)};SP.bind();
}
$('view').addEventListener('click',function(e){var t=e.target.closest('[data-k]');if(t)sheet(t.getAttribute('data-k'));var u=e.target.closest('[data-s]');if(u)SP.sheet(u.getAttribute('data-s'))});
document.querySelectorAll('#navTurf button').forEach(function(b){b.onclick=function(){document.querySelectorAll('#navTurf button').forEach(function(x){x.classList.toggle('on',x===b)});S.tab=b.dataset.t;render();window.scrollTo(0,0)}});
document.querySelectorAll('#navSport button').forEach(function(b){b.onclick=function(){document.querySelectorAll('#navSport button').forEach(function(x){x.classList.toggle('on',x===b)});SP.tab=b.dataset.t;render();window.scrollTo(0,0)}});
document.querySelectorAll('.modes button').forEach(function(b){b.onclick=function(){document.querySelectorAll('.modes button').forEach(function(x){x.classList.toggle('on',x===b)});S.mode=b.dataset.m;$('navTurf').hidden=S.mode!=='turf';$('navSport').hidden=S.mode!=='sport';$('navValue').hidden=S.mode!=='value';try{localStorage.setItem('turf.mode',S.mode)}catch(e){}$('st').textContent=S.mode==='sport'?(SP.st||'Prêt'):(S.stTurf||'Prêt');if(S.mode!=='turf'&&!SP.data&&!SP.loading)SP.load(true);render();window.scrollTo(0,0)}});
function shift(n){S.date=new Date(S.date.getFullYear(),S.date.getMonth(),S.date.getDate()+n);S.prog=null;S.an={};S.perf={};SP.data=null;SP.cache={};render();loadDay(true);if(S.mode==='sport')SP.load(true)}
$('prev').onclick=function(){shift(-1)};$('next').onclick=function(){shift(1)};
$('today').onclick=function(){S.date=new Date();S.prog=null;S.an={};S.perf={};SP.data=null;SP.cache={};render();loadDay(true);if(S.mode==='sport')SP.load(true)};
function liveDay(){var n=new Date(),y=new Date(n.getFullYear(),n.getMonth(),n.getDate()-1);return ddmmyyyy(S.date)===ddmmyyyy(n)||(ddmmyyyy(S.date)===ddmmyyyy(y)&&n.getHours()<12)}
setInterval(function(){if(document.hidden||S.mode==='turf'||!liveDay())return;var live=(SP.data||[]).some(function(x){return x.state.state==='in'});var age=SP.last?Date.now()-SP.last:1e9;if(live?age>45000:age>3*60000)SP.load(false)},15000);
setInterval(function(){if(!document.hidden&&ddmmyyyy(S.date)===ddmmyyyy(new Date()))loadDay(false)},(YANIS?2:3)*60000);
document.addEventListener('visibilitychange',function(){if(!document.hidden&&S.mode!=='turf'&&SP.data&&!SP.loading&&Date.now()-(SP.last||0)>30000)SP.load(false);if(!document.hidden&&S.last&&Date.now()-S.last>2*60000)loadDay(false)});

/* ===== alertes ===== */
var SEEN={};
function pushAlert(mode,k,txt){
  if(SEEN[txt])return;SEEN[txt]=1;
  S.alerts.unshift({t:new Date(),mode:mode,k:k,txt:txt});S.alerts=S.alerts.slice(0,60);
  $('bellN').textContent=S.alerts.filter(function(a){return !a.read}).length||'';
  try{if(window.Notification&&Notification.permission==='granted'&&navigator.serviceWorker){navigator.serviceWorker.ready.then(function(r){r.showNotification('Turf Analyste',{body:txt,icon:'icon-192.png',tag:k})})}}catch(e){}
}
function alertSheet(){
  S.alerts.forEach(function(a){a.read=true});$('bellN').textContent='';
  var h='<div class="row" style="margin-bottom:8px"><button id="close">‹ Retour</button></div><div class="ttl" style="font-size:18px">Alertes de dernière minute</div>';
  h+='<p class="mute">Non-partants, blessures, compositions et mouvements de cotes qui changent un pronostic. L\'appli vérifie toutes les 3 minutes (turf) et 5 minutes (sport) tant qu\'elle est ouverte.</p>';
  var perm=window.Notification?Notification.permission:'unsupported';
  if(perm==='default')h+='<button class="primary" id="notifOn">Activer les notifications</button>';
  else if(perm==='granted')h+='<p class="mute">Notifications activées.</p>';
  else if(perm==='denied')h+='<p class="mute">Notifications bloquées : autorise-les dans les réglages du site.</p>';
  if(!S.alerts.length)h+='<div class="card" style="margin-top:10px">Aucune alerte pour le moment.</div>';
  S.alerts.forEach(function(a){h+='<div class="alert tap" data-ak="'+esc(a.mode+'|'+a.k)+'">'+(a.mode==='turf'?'🏇 ':'⚽ ')+esc(a.txt)+'<div class="mute">'+a.t.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'</div></div>'});
  sheetOpen(h);
  var b=$('notifOn');if(b)b.onclick=function(){Notification.requestPermission().then(function(){alertSheet()})};
  document.querySelectorAll('[data-ak]').forEach(function(el){el.onclick=function(){var v=el.getAttribute('data-ak').split('|');if(v[0]==='turf')sheet(v[1]);else{var i=(SP.data||[]).findIndex(function(x){return String(x.id)===v[1]});if(i>=0)SP.sheet(i)}}});
}
$('bell').onclick=alertSheet;

/* ===== module Sport : interface ===== */
var ESPN_LOCAL=(new URLSearchParams(location.search).get('espn'))||'/espn/';
var ESPN=(new URLSearchParams(location.search).get('espnfull'))||'https://site.api.espn.com/apis/';
async function getESPN(path){
  var urls=/^https?:/.test(path)?[path]:YANIS?[ESPN+path]:[ESPN_LOCAL+path,ESPN+path],last;
  for(var i=0;i<urls.length;i++){
    try{var r=await Promise.race([fetch(urls[i],{cache:'no-store'}),timeout(15000)]);if(!r.ok)throw new Error('HTTP '+r.status);var ct=r.headers.get('content-type')||'';if(ct.indexOf('json')<0&&i===0)throw new Error('réponse non JSON');return await r.json()}
    catch(e){last=new Error((i?'ESPN direct':'serveur Netlify')+' : '+e.message)}
  }
  throw last;
}
var ICON={rugby:'🏉',foot:'⚽',nba:'🏀',wnba:'🏀',nfl:'🏈',nhl:'🏒',mlb:'⚾',tennis:'🎾',mma:'🥊'};
var SNAME={all:'Tous',rugby:'Rugby',foot:'Football',nba:'NBA',wnba:'WNBA',nfl:'NFL',nhl:'NHL',mlb:'MLB',tennis:'Tennis',mma:'MMA'};
var SLVL={SEC:'SEC',FORT:'SOLIDE',DOUTE:'PRUDENT',NA:'SANS DONNÉES'};
function advice(p){
  if(p>=0.80)return {t:'Mise normale',c:'ok'};
  if(p>=0.65)return {t:'Mise petite',c:'warn'};
  if(p>=0.50)return {t:'Très petite mise, c\'est serré',c:'warn'};
  return {t:'Seulement si la cote dépasse '+(1/p).toFixed(2).replace('.',','),c:'ko'};
}
function fair(p){return (1/Math.max(0.01,p)).toFixed(2).replace('.',',')}
function bestProp(x){var P=(x.sim&&x.sim.props)||[];return P.filter(function(q){return q.p>=0.55&&q.p<=0.88}).sort(function(a,b){return Math.abs(a.p-0.70)-Math.abs(b.p-0.70)})[0]||null}
function oddsRow(x){var V=SportEngine.valueBets(x);if(!V.length)return '';return '<div class="odds">'+(x.state.state==='in'?'Cotes d\'avant-match (retour pour 1 €) : ':'Cotes (retour pour 1 € misé) : ')+V.map(function(v){return '<span>'+esc(v.label.replace('Victoire ',''))+' <b>'+v.dec.toFixed(2).replace('.',',')+'</b></span>'}).join('')+'</div>'}
function hk(x){return (x.lid||x.path||x.sport)+'|'+x.id}
var SP={hist:{},nsim:function(x){return (x.sim&&x.sim.n||20000).toLocaleString('fr-FR')+' matchs simulés'},tab:'top',filter:'all',data:null,loading:false,st:null,diag:{},cache:{},
  setSt:function(t){SP.st=t;if(S.mode==='sport')$('st').textContent=t},
  load:async function(full){
    if(SP.loading)return;SP.loading=true;SP.err=null;
    var d=S.date,ymd=d.getFullYear()+('0'+(d.getMonth()+1)).slice(-2)+('0'+d.getDate()).slice(-2);
    SP.setSt('Chargement des matchs…');if(S.mode==='sport')setProg(.03);
    try{
      if(YANIS)SportEngine.setHistSource(function(k){return yFetch('hist/'+k+'.json')});
      if(YANIS&&(!SP.ext||Date.now()-SP.ext>20*60000))try{var sj=await yFetch('sports.json');SportEngine.setExtern(sj.sports);SP.ext=Date.now()}catch(e){}
      if(YANIS&&(!SP.shT||Date.now()-SP.shT>10*60000)){try{var sh=await yFetch('sharp.json');var okSh=sh&&sh.events&&sh.events.length&&Date.now()-Date.parse(sh.maj)<8*3600e3;SportEngine.setSharp(okSh?sh.events:[]);SP.sharpOn=!!okSh}catch(e){SportEngine.setSharp([]);SP.sharpOn=false}SP.shT=Date.now()}
      var res=await SportEngine.loadAll(getESPN,ymd,function(x){if(S.mode==='sport')setProg(x);SP.setSt('Matchs et historiques de saison… '+Math.round(x*100)+' %')},function(k,j){SP.diag[k]=j?(j.events||[]).length+' évts':'vide'},ST);
      SP.cal=res.cal;SP.info=res.info;
      if(!res.items.length&&res.errors.length===res.jobs)throw new Error(res.errors[0]||'aucune donnée');
      var old={};(SP.data||[]).forEach(function(x){if(x.main)old[x.id]={l:x.main.label,c:x.conf,pk:x.pick?x.pick.label:null,pp:x.pick?x.pick.p:null,inj:x.enr&&x.enr.abs?x.enr.abs[0].out+x.enr.abs[1].out:null,lu:!!(x.enr&&x.enr.lineups)}});
      SP.setSt('Blessures, compos et cotes de dernière minute…');
      var nE=await SportEngine.enrich(getESPN,res.items,SP.cache,function(x){if(S.mode==='sport')setProg(x)});
      SP.data=res.items;SP.last=new Date();
      res.items.forEach(function(x){if(x.liveP!=null){var h=SP.hist[hk(x)]||(SP.hist[hk(x)]=[]);if(!h.length||h[h.length-1]!==x.liveP)h.push(x.liveP);if(h.length>120)h.shift()}});
      res.items.forEach(function(x){
        var o=old[x.id];if(!o||x.state.done||!x.main)return;
        var lbl=x.title+' · ';
        var npk=x.pick?x.pick.label:null;
        if(npk&&!o.pk)pushAlert('sport',x.id,lbl+'Nouveau pronostic à plus de 70 % : '+npk+' ('+E.pct(x.pick.p)+', cote mini '+x.pick.minOdds.toFixed(2).replace('.',',')+')');
        else if(!npk&&o.pk)pushAlert('sport',x.id,lbl+'Le pronostic « '+o.pk+' » repasse sous 70 % : ne plus jouer.');
        else if(npk&&o.pk&&npk!==o.pk)pushAlert('sport',x.id,lbl+'Pronostic modifié : '+npk+' ('+E.pct(x.pick.p)+')');
        if(!o.lu&&x.enr&&x.enr.lineups)pushAlert('sport',x.id,lbl+'Compositions officielles publiées.');
        var inj=x.enr&&x.enr.abs?x.enr.abs[0].out+x.enr.abs[1].out:null;
        if(o.inj!=null&&inj!=null&&inj>o.inj)pushAlert('sport',x.id,lbl+'Nouvelle absence signalée.');
      });
      SP.setSt(res.items.length+' matchs analysés · '+res.info.games+' matchs d\'historique');
    }catch(e){SP.err=e.message;SP.setSt('Erreur : '+e.message)}
    setProg(0);SP.loading=false;if(S.mode==='value')render();if(S.mode==='sport'){render();$('upd').textContent=SP.last?'MAJ '+SP.last.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):''}
  },
  items:function(){return (SP.data||[]).filter(function(x){return SP.filter==='all'||x.sport===SP.filter})},
  chips:function(){
    var have={};(SP.data||[]).forEach(function(x){have[x.sport]=(have[x.sport]||0)+1});
    return '<div class="chips">'+['all','foot','rugby','nba','wnba','nfl','nhl','mlb','tennis','mma'].filter(function(k){return k==='all'||have[k]}).map(function(k){return '<button data-f="'+k+'" class="'+(SP.filter===k?'on':'')+'">'+(ICON[k]||'')+' '+SNAME[k]+(k!=='all'?' '+have[k]:'')+'</button>'}).join('')+'</div>';
  },
  card:function(x,i){
    var t=new Date(x.date),hh=isNaN(t)?'':t.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    var day=isNaN(t)?'':(t.toDateString()!==new Date().toDateString()?t.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric'})+' ':'');
    var tags='';if(x.enr){var ab=x.enr.abs?x.enr.abs[0].out+x.enr.abs[1].out:0;if(ab)tags+='<span class="tag">🩹 '+ab+' absent'+(ab>1?'s':'')+'</span>';if(x.enr.lineups)tags+='<span class="tag">📋 compos</span>';}
    var st=x.state.state,isLive=st==='in',done=x.state.done;
    var chip=isLive?'<span class="chip live"><i class="dot"></i>EN DIRECT'+(x.state.txt?' · '+esc(x.state.txt):'')+'</span>':done?'<span class="chip fin">Terminé</span>':'<span class="chip pre">'+day+hh+'</span>';
    var sc=x.live||x.score, mid;
    if(x.sport==='tennis')mid=x.setTxt?'<b class="sc">'+esc(x.setTxt)+'</b>':'<b class="vs">vs</b>';
    else if(x.sport==='mma')mid='<b class="vs">vs</b>';
    else mid=sc&&sc[0]!=null?'<b class="sc">'+sc[0]+' - '+sc[1]+'</b>':'<b class="vs">vs</b>';
    var trend='';
    if(isLive&&sc&&sc[0]!=null&&!x.nodata&&!(x.lv&&x.lv.switched)){var ok=null;if(x.main.ok)ok=x.main.ok(sc[0],sc[1]);else if(x.favHome!=null)ok=x.favHome?sc[0]>sc[1]:sc[1]>sc[0];if(ok!=null)trend=ok?' <span class="ok">· en bonne voie</span>':' <span class="ko">· menacé</span>'}
    var res=x.won===true?' <span class="ok">✓ gagné</span>':x.won===false?' <span class="ko">✗ perdu</span>':trend;
    var tv=x.tv&&x.tv.length?'<div class="tv">📺 '+esc(x.tv.join(' · '))+'</div>':'';
    tv=oddsRow(x)+tv;
    if(!done&&x.sport==='foot'&&x.lam)tv='<div class="odds">🧩 Montages de paris (premier but, buteurs, combinés) dans la fiche</div>'+tv;
    if(!done&&x.buteursEq){var bl=x.buteursEq.filter(function(t){return t.list.length}).map(function(t){return '<b>'+esc(t.list[0].name)+'</b> '+E.pct(t.list[0].p)});if(bl.length)tv='<div class="odds">⚽ Buteurs : '+bl.join(' · ')+'</div>'+tv}
    else if(x.buteurs&&x.buteurs.length&&!done){var b0=x.buteurs[0];tv='<div class="odds">⚽ Buteur le plus probable : <b>'+esc(b0.name)+'</b> ('+esc(b0.team)+') '+E.pct(b0.p)+' · cote mini '+fair(b0.p)+'</div>'+tv}
    if(!done&&x.points){var pl=[];x.points.forEach(function(t){var q=t.list.filter(function(p){return p.best})[0];if(q)pl.push('<b>'+esc(q.name)+'</b> '+q.best[0]+'+ pts '+E.pct(q.best[1]))});if(pl.length)tv='<div class="odds">🏀 '+pl.join(' · ')+'</div>'+tv}
    if(isLive){var bp=bestProp(x);if(bp){var ad=advice(bp.p);tv='<div class="lprop">💡 En direct : <b>'+esc(bp.label)+'</b> · '+E.pct(bp.p)+' · cote mini '+fair(bp.p)+' · <span class="'+ad.c+'">'+ad.t+'</span></div>'+tv}}
    if(isLive&&x.liveP!=null){var hs=SP.hist[hk(x)]||[],prev=hs.length>1?hs[hs.length-2]:null,arrow=prev==null?'':x.liveP>prev+0.01?' ▲':x.liveP<prev-0.01?' ▼':'';if(arrow)tv='<div class="livesim"><span>Tendance en direct</span><b>'+arrow+'</b></div>'+tv}
    return '<div class="card tap sp-'+x.sport+(isLive?' is-live':'')+'" data-s="'+i+'"><div class="row"><span class="mute">'+(ICON[x.sport]||'')+' '+esc(x.league)+'</span>'+chip+'</div>'+
      '<div class="board"><span class="tm">'+esc(x.home)+'</span>'+mid+'<span class="tm r">'+esc(x.away)+'</span></div>'+(tags?'<div style="text-align:center">'+tags+'</div>':'')+
      (x.nodata?'<div class="prono"><span class="mute">Pas de pronostic : données insuffisantes'+res+'</span><span class="badge NA">'+SLVL.NA+'</span></div>':
      (x.lv?'<div class="prono"><span>'+esc(x.lv.label)+trend+'</span><span class="row" style="gap:6px"><span class="badge '+x.lv.level+'">'+SLVL[x.lv.level]+'</span><span class="conf">'+pL(x.lv.p)+'</span></span></div><div class="meter"><i style="width:'+Math.round(x.lv.p*100)+'%"></i></div><div class="mute">Pronostic en direct, recalculé avec le score.'+(x.lv.switched?' Pronostic d\'avant-match dépassé : '+esc(x.main.label)+' ('+E.pct(x.conf)+').':' Avant-match : '+E.pct(x.conf)+'.')+'</div>'
      :x.pick?'<div class="prono"><span>'+esc(x.pick.label)+(x.pickWon===true?' <span class="ok">✓ gagné</span>':x.pickWon===false?' <span class="ko">✗ perdu</span>':'')+'</span><span class="row" style="gap:6px"><span class="badge '+(x.pick.p>=0.8?'SEC':'FORT')+'">'+(x.pick.p>=0.8?'SEC':'SOLIDE')+'</span><span class="conf">'+E.pct(x.pick.p)+'</span></span></div><div class="meter"><i style="width:'+Math.round(x.pick.p*100)+'%"></i></div><div class="mute">Cote minimale pour jouer : <b>'+x.pick.minOdds.toFixed(2).replace('.',',')+'</b>. En dessous, le pari perd de l\'argent sur la durée. Match : '+esc(x.main.label)+' '+E.pct(x.conf)+'.</div>'
      :'<div class="prono"><span class="mute">Pas de pari : aucune formule à 70 %. '+(x.picks&&x.picks[0]?'Meilleure : '+esc(x.picks[0].label)+' '+E.pct(x.picks[0].p)+'.':esc(x.main.label)+' '+E.pct(x.conf)+'.')+'</span><span class="badge NA">SOUS 70 %</span></div>'))+tv+'</div>';
  },
  view:function(){
    if(SP.err&&!SP.data)return '<div class="card err"><div class="ttl">Connexion aux données sport impossible</div><p>'+esc(SP.err)+'</p><button class="primary" id="retry">Réessayer</button></div>';
    if(!SP.data)return '<div class="card">Chargement des matchs du jour…</div>';
    var all=SP.items(),h=SP.chips();
    if(SP.tab==='top'){
      var nSh=all.filter(function(x){return x.sharp}).length,nUp=all.filter(function(x){return !x.state.done}).length;
      h+='<p class="mute" style="margin:2px 0 6px">'+(SP.sharpOn?'Cotes de référence (Pinnacle et marchés précis) : '+nSh+' match'+(nSh>1?'s':'')+' sur '+nUp+' à venir. Elles pèsent 80 à 90 % du pronostic quand elles existent.':'Cotes de référence Pinnacle non activées : le pronostic s\'appuie sur les cotes ESPN et le modèle. Activation : clé The Odds API dans les secrets du dépôt (ODDS_API_KEY).')+'</p>';
      var lv=all.filter(function(x){return x.state.state==='in'});
      if(lv.length){h+='<h2>🔴 En direct ('+lv.length+')</h2>';lv.forEach(function(x){h+=SP.card(x,SP.data.indexOf(x))})}
      var up=all.filter(function(x){return !x.state.done&&x.state.state!=='in'&&!x.nodata});
      var top=up.filter(function(x){return x.pick}).sort(function(a,b){return b.pick.p-a.pick.p}),rest=up.filter(function(x){return !x.pick});
      h+='<h2>'+top.length+' pronostic'+(top.length>1?'s':'')+' à plus de 70 %</h2>';
      if(!top.length)h+='<div class="card">Aucun match à venir n\'a de formule au-dessus de 70 %. L\'appli attend les cotes, les compositions et les absences : elle se met à jour toute seule.</div>';
      top.forEach(function(x){h+=SP.card(x,SP.data.indexOf(x))});
      if(rest.length){h+='<h2>Sous 70 % : pas de pari ('+rest.length+')</h2>';rest.forEach(function(x){h+=SP.card(x,SP.data.indexOf(x))})}
      return h+'<p class="mute">Pour chaque match, l\'appli teste toutes les formules (victoire, handicaps, buts, double chance, sets) et retient la plus payante dont la probabilité dépasse 72 % (75 % en NBA et NFL). Mesuré sur environ 70 jours de matchs passés : 77 % annoncé pour 77 % réel en football, 75 % pour 75 % en NBA. Un 75 % perd encore une fois sur quatre : joue seulement à la cote minimale indiquée ou au-dessus. WNBA, MLB et rugby : pas assez de recul, aucune formule publiée.</p>';
    }
    if(SP.tab==='list'){
      if(!all.length)return h+'<div class="card">Aucun match pour ce filtre aujourd\'hui.</div>';
      var g={};all.forEach(function(x){(g[x.league]=g[x.league]||[]).push(x)});
      Object.keys(g).forEach(function(k){h+='<h2>'+(ICON[g[k][0].sport]||'')+' '+esc(k)+'</h2>';g[k].forEach(function(x){h+=SP.card(x,SP.data.indexOf(x))})});
      return h;
    }
    h+=SP.calCard();
    var fin=all.filter(function(x){return !x.nodata&&(x.won===true||x.won===false)});
    if(!fin.length)return h+'<div class="card">Aucun résultat connu pour le moment pour cette date. Le bilan du jour se remplit au fil des matchs.</div>';
    var w=fin.filter(function(x){return x.won}).length,exp=fin.reduce(function(s,x){return s+x.conf},0)/fin.length;
    var f70=fin.filter(function(x){return x.conf>=0.7}),w70=f70.filter(function(x){return x.won}).length;
    h+='<div class="kpis"><div><b>'+w+'/'+fin.length+'</b><span class="mute">pronostics gagnants</span></div><div><b>'+E.pct(w/fin.length)+'</b><span class="mute">réussite réelle</span></div><div><b>'+E.pct(exp)+'</b><span class="mute">réussite prévue</span></div></div>';
    if(f70.length)h+='<div class="card" style="margin-top:10px">Pronostics à 70 % et plus : <b>'+w70+' / '+f70.length+'</b> gagnants.</div>';
    h+='<h2>Matchs terminés</h2>';fin.forEach(function(x){h+=SP.card(x,SP.data.indexOf(x))});
    return h;
  },
  sheet:function(i){
    var x=SP.data[+i];if(!x)return;
    var t=new Date(x.date);
    var h='<div class="row" style="margin-bottom:8px"><button id="close">‹ Retour</button><span class="badge '+x.level+'">'+SLVL[x.level]+'</span></div>';
    h+='<div class="ttl" style="font-size:18px">'+(ICON[x.sport]||'')+' '+esc(x.title)+'</div><div class="mute">'+esc(x.league)+' · '+(isNaN(t)?'':t.toLocaleString('fr-FR',{weekday:'short',hour:'2-digit',minute:'2-digit'}))+(x.state.txt?' · '+esc(x.state.txt):'')+'</div>';
    var sc=x.live||x.score;if(sc&&sc[0]!=null&&x.sport!=='tennis'&&x.sport!=='mma')h+='<div class="card board big2" style="margin-top:10px"><span class="tm">'+esc(x.home)+'</span><b class="sc">'+sc[0]+' - '+sc[1]+'</b><span class="tm r">'+esc(x.away)+'</span></div><div class="mute" style="text-align:center">'+(x.state.state==='in'?'🔴 En direct '+esc(x.state.txt||''):x.state.done?'Score final':'')+'</div>';
    if(x.setTxt)h+='<div class="card" style="margin-top:10px;text-align:center"><b class="sc">'+esc(x.setTxt)+'</b></div>';
    h+=oddsRow(x);
    h+='<div class="tv" style="margin-top:8px">'+(x.tv&&x.tv.length?'📺 Diffusion annoncée : '+esc(x.tv.join(', '))+' · ':'')+'<a href="https://www.google.com/search?q='+encodeURIComponent(x.home+' '+x.away+' diffusion tv chaîne')+'" target="_blank" rel="noopener">Où regarder ce match ?</a></div>';
    if(x.nodata)h+='<h2>Pronostic</h2><div class="card">Pas de pronostic pour ce match : données insuffisantes (voir ci-dessous).</div>';
    else if(x.lv)h+='<h2>Pronostic en direct</h2><div class="jeu main"><div class="row"><span class="ttl">'+esc(x.lv.label)+'</span><span class="conf">'+pL(x.lv.p)+'</span></div><div class="mute">Recalculé avec le score et le temps restant ('+SP.nsim(x)+'). Avant le match : '+esc(x.main.label)+' à '+E.pct(x.conf)+(x.lv.switched?' — dépassé par le score.':'.')+'</div></div>';
    else h+='<h2>Pronostic principal</h2><div class="jeu main"><div class="row"><span class="ttl">'+esc(x.main.label)+'</span><span class="conf">'+E.pct(x.main.p)+'</span></div>'+(x.main.dec?'<div class="mute">Cote '+x.main.dec.toFixed(2).replace('.',',')+' : 1 € misé rapporte '+x.main.dec.toFixed(2).replace('.',',')+' € si gagnant · cote juste '+fair(x.main.p)+'</div>':'<div class="mute">Cote juste (minimum à exiger) : '+fair(x.main.p)+'</div>')+(x.won===true?'<div class="ok">✓ gagnant</div>':x.won===false?'<div class="ko">✗ perdu</div>':'')+'</div>';
    if(x.safe&&x.safe.p>=0.7)h+='<div class="jeu"><div class="row"><span class="ttl">Option la plus sûre : '+esc(x.safe.label)+'</span><span class="conf">'+E.pct(x.safe.p)+'</span></div></div>';
    if(x.value)h+='<div class="jeu"><div class="row"><span class="ttl">Pari value : '+esc(x.value.label)+'</span><span class="conf">'+E.pct(x.value.p)+'</span></div><div class="mute">Cote '+x.value.dec.toFixed(2).replace('.',',')+' : le marché sous-estime cette issue.</div></div>';
    if(x.enr){
      var en=x.enr,names=[x.home,x.away];
      h+='<h2>Dernière minute <span class="mute" style="text-transform:none;letter-spacing:0">· MAJ '+new Date(en.at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'</span></h2><div class="card">';
      if(en.abs){[0,1].forEach(function(k){var t=en.abs[k];h+='<div class="ttl" style="margin-top:'+(k?'10':'0')+'px">'+esc(names[k])+' : '+(t.list.length?t.list.length+' joueur(s) signalé(s)':'aucune absence signalée')+'</div>';t.list.slice(0,10).forEach(function(p){h+='<div class="inj"><span>'+(p.key?'⭐ ':'')+esc(p.name)+(p.pos?' <span class="mute">'+esc(p.pos)+'</span>':'')+'</span><span class="mute">'+esc(p.status)+(p.detail?' · '+esc(p.detail):'')+'</span></div>'})})}
      else h+='<div class="mute">Pas de rapport de blessures publié pour ce match.</div>';
      if(en.lineups){h+='<div class="ttl" style="margin-top:10px">Compositions officielles</div>';[0,1].forEach(function(k){h+='<div class="mute" style="margin-top:4px"><b>'+esc(names[k])+'</b>'+(en.lineups[k].formation?' ('+esc(en.lineups[k].formation)+')':'')+' : '+esc(en.lineups[k].starters.join(', '))+'</div>'})}
      else if(x.sport==='foot')h+='<div class="mute" style="margin-top:8px">Compositions pas encore publiées (en général 1 h avant le coup d\'envoi).</div>';
      if(en.bpi!=null)h+='<div class="mute" style="margin-top:8px">Prédicteur ESPN : '+esc(x.home)+' '+E.pct(en.bpi)+'</div>';
      if(en.form5)h+='<div class="mute">Forme 5 derniers matchs : '+esc(x.home)+' '+esc(en.form5[0]||'—')+' · '+esc(x.away)+' '+esc(en.form5[1]||'—')+'</div>';
      h+='</div>';
    }
    if(x.sport==='foot'&&!x.state.done){
      h+='<h2>⚽ Buteurs potentiels'+(x.state.state==='in'?' (temps restant)':'')+'</h2><div class="card">';
      if(x.buteursEq&&x.buteursEq.some(function(t){return t.list.length})){
        h+='<div class="mute" style="margin-bottom:6px">Chance de marquer = sa part des buts de son équipe cette saison (buts réellement marqués dans la compétition, les plus récents comptent plus) × buts attendus de son équipe dans ce match'+(x.enr&&x.enr.lineups?', composition officielle prise en compte':'')+'. Cote mini = cote à exiger.</div>';
        x.buteursEq.forEach(function(t){h+='<div class="ttl" style="margin-top:8px">'+esc(t.team)+'</div>';if(!t.list.length)h+='<div class="mute">Pas encore de buteur enregistré.</div>';t.list.forEach(function(b){h+='<div class="prow"><span>'+esc(b.name)+' <span class="mute">'+b.goals+' but'+(b.goals>1?'s':'')+(b.pen?' dont '+b.pen+' pen.':'')+(b.starter===false?' · remplaçant':b.starter?' · titulaire':'')+'</span></span><b>'+E.pct(b.p)+'</b><span class="mute">mini '+fair(b.p)+'</span></div>'})});
      }
      else if(x.buteurs&&x.buteurs.length){h+='<div class="mute" style="margin-bottom:6px">Chance de marquer = part des buts de l\'équipe marqués par le joueur cette saison × buts attendus de son équipe dans ce match'+(x.enr&&x.enr.lineups?', composition officielle prise en compte':', composition pas encore connue')+'. Cote mini = cote à exiger chez ton opérateur.</div>';
        x.buteurs.forEach(function(b){var ad=advice(b.p);h+='<div class="prow"><span>'+esc(b.name)+' <span class="mute">'+esc(b.team)+' · '+b.goals+' but'+(b.goals>1?'s':'')+(b.starter===false?' · remplaçant':b.starter?' · titulaire':'')+'</span></span><b>'+E.pct(b.p)+'</b><span class="mute">mini '+fair(b.p)+'</span></div>'})}
      else h+='<div class="mute">Classement des buteurs indisponible pour cette compétition dans la source gratuite.</div>';
      h+='</div>';
    }
    if(x.points&&!x.state.done){
      h+='<h2>🏀 Points par joueur'+(x.state.state==='in'?' (en direct)':'')+'</h2><div class="card"><div class="mute" style="margin-bottom:6px">Chance de dépasser chaque palier, d\'après sa moyenne'+(x.ou?' et le rythme attendu du match (total '+String(x.ou).replace('.',',')+')':'')+'. Palier conseillé = le plus haut qui passe au moins 70 % du temps.</div>';
      x.points.forEach(function(t){h+='<div class="ttl" style="margin-top:8px">'+esc(t.team)+'</div>';if(!t.list.length)h+='<div class="mute">Statistiques indisponibles.</div>';
        t.list.forEach(function(p){h+='<div class="pts"><div class="row"><span><b>'+esc(p.name)+'</b> <span class="mute">moy. '+p.mean.toFixed(1).replace('.',',')+(p.now!=null?' · déjà '+p.now+' pts':'')+'</span></span><span class="'+(p.best?'ok':'mute')+'">'+(p.best?'🎯 '+p.best[0]+'+ pts · '+E.pct(p.best[1]):'pas de palier sûr')+'</span></div><div class="tiers">'+p.tiers.map(function(q){return '<span class="'+(q[1]>=0.7?'hi':q[1]>=0.5?'mid':'')+'">'+q[0]+'+ <b>'+E.pct(q[1])+'</b></span>'}).join('')+'</div></div>'})});
      h+='</div>';
    }
    if(x.sport==='foot'&&!x.state.done&&x.lam){var BB=null;try{BB=SportEngine.buildFor(x)}catch(e){}
      if(BB){var bl=function(t,arr,ico){if(!arr.length)return '';var o='<div class="ttl" style="margin-top:8px">'+ico+' '+t+'</div>';arr.forEach(function(c){o+='<div class="combo"><div>'+c.legs.map(esc).join(' <b>+</b> ')+'</div><div class="row"><span class="ok">'+E.pct(c.p)+'</span><span class="mute">cote mini <b class="cm">'+fair(c.p)+'</b></span></div></div>'});return o};
        h+='<h2>🧩 Montages de paris'+(x.state.state==='in'?' (à l\'instant T)':'')+'</h2><div class="card"><div class="mute">Chaque montage est vérifié sur 20 000 matchs simulés minute par minute (but, minute, équipe, buteur) : les liens entre les paris sont pris en compte. Ton opérateur doit proposer au moins la cote mini, sinon passe.</div>'+bl('Le plus sûr',BB.sur,'🟢')+bl('Équilibré',BB.equilibre,'🟠')+bl('Grosse cote',BB.grosse,'🔴');
        if(BB.singles.length){h+='<div class="ttl" style="margin-top:8px">⏱️ Premier but et premier buteur</div>';BB.singles.forEach(function(l){h+='<div class="prow"><span>'+esc(l.label)+'</span><b>'+E.pct(l.p)+'</b><span class="mute">mini '+fair(l.p)+'</span></div>'})}
        h+='</div>';}}
    if(x.sim){var S2=x.sim,lv=x.state.state==='in';
      h+='<h2>'+(lv?'📡 Simulation en direct':'🎲 Simulation avant-match')+' ('+S2.n.toLocaleString('fr-FR')+' '+(x.sport==='tennis'?'matchs':x.sport==='foot'?'matchs':'matchs')+')</h2><div class="card">';
      if(lv&&S2.r!=null)h+='<div class="mute">Le reste du match ('+Math.round(S2.r*100)+' % du temps de jeu) est rejoué '+S2.n.toLocaleString('fr-FR')+' fois à partir du score actuel.</div>';
      if(lv&&x.sport==='tennis')h+='<div class="mute">La fin du match est rejouée '+S2.n.toLocaleString('fr-FR')+' fois à partir du score actuel (sets gagnés et jeux du set en cours).</div>';
      h+='<div class="mk"><span>'+esc(x.main.label)+'</span><span class="conf">'+E.pct(S2.main)+'</span></div>';
      if(S2.comeback!=null){var trail=x.live[0]<x.live[1]?x.home:x.away;h+='<div class="mk"><span>'+esc(trail)+' revient au moins au nul</span><span class="conf">'+E.pct(S2.comeback)+'</span></div>'}
      if(x.sport==='foot')h+='<div class="mute" style="margin:4px 0">Simulation minute par minute'+(lv?' depuis la '+S2.minute+'e':'')+' : rythme de buts croissant en fin de match, l\'équipe menée accélère (encore plus si c\'est la favorite), celle qui mène gère'+(S2.notes&&S2.notes.length?', '+esc(S2.notes.join(', ')):'')+'.</div>';
      if(x.sport==='foot')h+='<div class="mk"><span>'+esc(x.home)+' / Nul / '+esc(x.away)+'</span><span>'+E.pct(S2.p[0])+' · '+E.pct(S2.p[1])+' · '+E.pct(S2.p[2])+'</span></div>';
      else h+='<div class="mk"><span>Victoire '+esc(x.home)+' / '+esc(x.away)+'</span><span>'+E.pct(S2.p[0])+' · '+E.pct(S2.p[2])+'</span></div>';
      if(S2.top&&S2.top.length){h+='<div class="mute" style="margin-top:6px">'+(S2.margin?'Écarts finaux les plus fréquents ('+esc(x.home)+')':'Scores finaux les plus fréquents')+' :</div>';S2.top.forEach(function(t){var lab=S2.margin?((+t[0]>0?'+':'')+t[0]):t[0];h+='<div class="simbar"><span>'+esc(lab)+'</span><i style="width:'+Math.round(t[1]/S2.top[0][1]*100)+'%"></i><b>'+E.pct(t[1])+'</b></div>'})}
      if(S2.props&&S2.props.length){var PP=S2.props.slice().filter(function(q){return q.p>=0.03&&q.p<=0.985}).sort(function(a,b){return b.p-a.p});
        h+='</div><h2>💡 Propositions '+(lv?'à l\'instant T (minute '+(S2.minute!=null?S2.minute:'')+')':'avant-match')+'</h2><div class="card"><div class="mute" style="margin-bottom:6px">« Cote mini » = la cote à partir de laquelle le pari devient rentable. Si ton opérateur propose plus, c\'est un bon pari ; moins, passe ton tour.</div>';
        PP.forEach(function(q){var ad=advice(q.p);h+='<div class="prow"><span>'+esc(q.label)+'</span><b>'+E.pct(q.p)+'</b><span class="mute">mini '+fair(q.p)+'</span><span class="'+ad.c+' adv">'+ad.t+'</span></div>'});
      }
      var hs=SP.hist[hk(x)];if(lv&&hs&&hs.length>1)h+='<div class="mute" style="margin-top:6px">Évolution en direct : '+hs.slice(-12).map(function(v){return Math.round(v*100)}).join(' → ')+' %</div>';
      h+='</div>';
    }
    h+='<h2>Pourquoi</h2><div class="card">'+x.why.map(function(w){return '<p style="margin:4px 0">'+esc(w)+'</p>'}).join('')+'</div>';
    if(x.markets){h+='<h2>Tous les marchés</h2><div class="card">'+x.markets.map(function(m){return '<div class="mk"><span>'+esc(m.label)+'</span><span class="conf">'+E.pct(m.p)+'</span></div>'}).join('')+'</div>'}
    if(x.ou)h+='<div class="mute">Total de points proposé par le marché : '+String(x.ou).replace('.',',')+'</div>';
    h+='<p class="mute">⭐ = joueur clé de l\'équipe. Les absences, compositions et cotes sont relues toutes les 5 minutes dans les 3 heures avant le match.</p>';
    sheetOpen(h);
  },
  calCard:function(){
    var C=(SP.cal||[]).filter(function(c){return SP.filter==='all'||c[2]===SP.filter});
    if(!C.length)return '<div class="card">La vérification de fiabilité apparaît dès que l\'historique des compétitions du jour est chargé.</div>';
    var B=[[0.5,0.6],[0.6,0.7],[0.7,0.8],[0.8,0.9],[0.9,1.01]],h='<h2>Fiabilité vérifiée (21 derniers jours)</h2><div class="card"><div class="mute" style="margin-bottom:6px">Le modèle a été recalculé sans les 21 derniers jours, puis confronté aux '+C.length+' résultats réels de cette période (sans les cotes).</div>';
    h+='<div class="mk"><b>Annoncé</b><b>Matchs</b><b>Prévu</b><b>Réel</b></div>';
    B.forEach(function(b){var c=C.filter(function(x){return x[0]>=b[0]&&x[0]<b[1]});if(!c.length)return;var pr=c.reduce(function(s,x){return s+x[0]},0)/c.length,re=c.reduce(function(s,x){return s+x[1]},0)/c.length;
      h+='<div class="mk"><span>'+Math.round(b[0]*100)+'–'+Math.min(100,Math.round(b[1]*100))+' %</span><span>'+c.length+'</span><span>'+E.pct(pr)+'</span><span class="'+(re>=pr-0.05?'ok':'ko')+'">'+E.pct(re)+'</span></div>'});
    var i=SP.info||{};
    return h+'<div class="mute" style="margin-top:6px">Uniquement des compétitions ouvertes aux paris en France (liste officielle ANJ). Notes de force calculées sur '+(i.games||0)+' matchs dans '+(i.leagues||0)+' compétitions.</div></div>';
  },
  bind:function(){document.querySelectorAll('.chips button').forEach(function(b){b.onclick=function(){SP.filter=b.dataset.f;render()}})}
};
try{if(localStorage.getItem('turf.mode')==='sport'){setTimeout(function(){var b=document.querySelector('.modes button[data-m=sport]');b&&b.click()},0)}}catch(e){}

if(/[?&]test=1/.test(location.search))window.__t={loadDay:loadDay,SP:SP,S:S};
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(function(){});
render();loadDay(true);
})();
