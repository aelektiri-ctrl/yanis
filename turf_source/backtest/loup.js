// Étude du « loup » : quels signaux font vraiment finir un outsider dans les 3 premiers ?
const {loadAll}=require('./load.js');const E=require('/home/claude/single/engine.js');
const MT=JSON.parse(require('fs').readFileSync('models_train.json'));
const R=loadAll('/home/claude/yanis/donnees').filter(r=>r.parts.filter(p=>p.statut!=='NON_PARTANT').length>=7&&r.course.arriveeTxt);
R.sort((a,b)=>a.course.date<b.course.date?-1:1);
const drv={},trn={},trn30=[];let day='',pend=[];const rows=[];
R.forEach(r=>{
  if(r.course.date!==day){pend.forEach(x=>{const d=drv[x[0]]||(drv[x[0]]=[0,0]);d[1]++;if(x[2])d[0]++;const t=trn[x[1]]||(trn[x[1]]=[0,0,[]]);t[1]++;if(x[2])t[0]++;t[2].push([x[3],x[2]?1:0])});pend=[];day=r.course.date}
  const parts=r.parts.filter(p=>p.statut!=='NON_PARTANT');const H=parts.map(p=>Object.assign(E.extract(p,r.course),{_ref:p._ref,_fin:p._fin})).filter(h=>h.num!=null);
  const ar=(r.course.arriveeTxt||'').split('-').map(Number);const pos={};ar.forEach((n,i)=>{if(!pos[n])pos[n]=i+1});
  H.forEach(h=>pend.push([(h.driver||'').toUpperCase(),(h.entraineur||'').toUpperCase(),pos[h.num]===1,r.course.date]));
  if(H.filter(h=>h._fin>1).length<0.8*H.length||H.filter(h=>h._ref>1).length<0.8*H.length)return;
  E.setModels(Object.assign({},MT,{ctx:{drv,trn}}));E.__score(H,r.course);
  const sp=(r.course.rapports||[]).filter(x=>x.pari==='SIMPLE_PLACE');
  const gps=H.map(h=>h.gps||0).sort((a,b)=>b-a);
  H.forEach(h=>{
    if(!(h._fin>=6&&h._fin<=30))return;
    const T=trn[(h.entraineur||'').toUpperCase()],t30=T?T[2].filter(x=>x[0]>=dshift(r.course.date,-30)):[];
    const D=drv[(h.driver||'').toUpperCase()];
    const mus=h.f.recent||[];const top3=mus.slice(0,5).filter(x=>/^[123]$/.test(x)).length;
    const f={
      crash:Math.log((h._ref||h._fin)/h._fin),             // argent de dernière minute
      ratio:Math.log(h.p/h.pm),                           // modèle vs public
      drv:D&&D[1]>=20?Math.log((D[0]+1)/(D[1]+10)/0.1):0,   // réussite du driver/jockey
      trn30:t30.length>=5?(t30.reduce((s,x)=>s+x[1],0)+0.5)/(t30.length+5)/0.1-1:0, // entraîneur en forme (30 j)
      top3:top3, last:/^[123]$/.test(mus[0]||'')?1:0, faults:h.f.faults,
      classe:h.gps?gps.indexOf(h.gps)/H.length:1, def4:h.fx&&h.fx.def4||0, recul:h.fx&&h.fx.recul||0
    };
    const placed=pos[h.num]>0&&pos[h.num]<=3;const rp=placed?((sp.find(x=>+x.combinaison===h.num)||{}).rapport||0):0;
    rows.push({d:r.course.date,race:r.course.date+'R'+r.course.numReunion+'C'+r.course.numOrdre,f,placed:placed?1:0,rp,lpm:Math.log(h.pm),top3model:h.top?h.top[2]:null,cote:h._fin,wolfOld:0});
  });
});
function dshift(d,n){const t=new Date(d);t.setDate(t.getDate()+n);return t.toISOString().slice(0,10)}
const K=Object.keys(rows[0].f);console.log('outsiders',rows.length,'facteurs',K.join(', '));
// régression logistique : placé ~ marché + facteurs
function fit(D){const P=K.length+2,th=new Float64Array(P);const m=new Float64Array(P),v=new Float64Array(P);
  for(let it=1;it<=400;it++){const g=new Float64Array(P);D.forEach(r=>{const x=[1,r.lpm].concat(K.map(k=>r.f[k]));let z=0;for(let i=0;i<P;i++)z+=th[i]*x[i];const p=1/(1+Math.exp(-z)),d=r.placed-p;for(let i=0;i<P;i++)g[i]+=d*x[i]});
    for(let i=0;i<P;i++){const gi=g[i]/D.length-(i>1?0.001*th[i]:0);m[i]=.9*m[i]+.1*gi;v[i]=.999*v[i]+.001*gi*gi;th[i]+=0.03*(m[i]/(1-Math.pow(.9,it)))/(Math.sqrt(v[i]/(1-Math.pow(.999,it)))+1e-8)}}return th}
const CUT='2026-06-01',tr=rows.filter(r=>r.d<CUT),te=rows.filter(r=>r.d>=CUT);
const th=fit(tr);const pr=r=>{const x=[1,r.lpm].concat(K.map(k=>r.f[k]));let z=0;x.forEach((v,i)=>z+=th[i]*v);return 1/(1+Math.exp(-z))};
const th0=(function(){const D=tr;let a=0,b=0;for(let it=0;it<300;it++){let ga=0,gb=0;D.forEach(r=>{const p=1/(1+Math.exp(-(a+b*r.lpm)));ga+=r.placed-p;gb+=(r.placed-p)*r.lpm});a+=0.5*ga/D.length;b+=0.5*gb/D.length}return [a,b]})();
const pr0=r=>1/(1+Math.exp(-(th0[0]+th0[1]*r.lpm)));
console.log('Poids (placé) :',K.map((k,i)=>k+' '+th[i+2].toFixed(3)).join(' | '));
// un loup par course : l'outsider avec le plus gros écart modèle/marché pour la place
const by={};te.forEach(r=>{(by[r.race]=by[r.race]||[]).push(r)});
let n=0,pl=0,ret=0,base=0,bret=0,bn=0;const S=[];
Object.values(by).forEach(L=>{L.forEach(r=>{bn++;base+=r.placed;bret+=r.rp});const s=L.map(r=>({r,e:pr(r)/pr0(r),p:pr(r)})).sort((a,b)=>b.e-a.e)[0];if(!s||s.e<1.15)return;n++;pl+=s.r.placed;ret+=s.r.rp;S.push([s.p,s.r.placed])});
console.log('TEST juin-nov :');
console.log('  outsider moyen (cote 6-30) : placé',(base/bn*100).toFixed(1)+'%','| simple placé ROI',((bret/bn-1)*100).toFixed(1)+'%','| n',bn);
console.log('  nouveau loup (1 par course max) : placé',(pl/n*100).toFixed(1)+'%','| simple placé ROI',((ret/n-1)*100).toFixed(1)+'%','| n',n);
const sel=te.filter(r=>r.f.crash>=Math.log(1.6));console.log('  ancien critère « cote écrasée ≥1,6 » : placé',(sel.reduce((s,r)=>s+r.placed,0)/sel.length*100).toFixed(1)+'% n',sel.length,'ROI',((sel.reduce((s,r)=>s+r.rp,0)/sel.length-1)*100).toFixed(1)+'%');
[[0,.25],[.25,.35],[.35,.45],[.45,1]].forEach(b=>{const c=S.filter(x=>x[0]>=b[0]&&x[0]<b[1]);if(c.length)console.log('  calibration loup annoncé',b.join('-'),c.length,'annoncé',(c.reduce((s,x)=>s+x[0],0)/c.length*100).toFixed(1)+'% réel',(c.reduce((s,x)=>s+x[1],0)/c.length*100).toFixed(1)+'%')});
require('fs').writeFileSync('loup_model.json',JSON.stringify({K,th:Array.from(th),th0}));
console.log('Seuils :');[1.15,1.25,1.35,1.5].forEach(T=>{let n=0,pl=0,ret=0;Object.values(by).forEach(L=>{const s=L.map(r=>({r,e:pr(r)/pr0(r)})).sort((a,b)=>b.e-a.e)[0];if(!s||s.e<T)return;n++;pl+=s.r.placed;ret+=s.r.rp});console.log('  écart ≥',T,'courses',n,'placé',(pl/n*100).toFixed(1)+'%','ROI placé',((ret/n-1)*100).toFixed(1)+'%')});
