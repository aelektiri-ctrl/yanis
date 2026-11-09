const {loadAll}=require('./load.js');const E=require('/home/claude/single/engine.js');
const R=loadAll('/home/claude/yanis/donnees').filter(r=>r.parts.filter(p=>p.statut!=='NON_PARTANT').length>=5&&r.course.arriveeTxt);
R.sort((a,b)=>a.course.date<b.course.date?-1:1);
const F=E.FEATS.filter(k=>['rk','catDown','catUp','rentree','recent','hipp','dist'].indexOf(k)<0);
// statistiques drivers / entraîneurs cumulées AVANT chaque journée (pas de fuite)
const drv={},trn={};let day='';let pend=[];
const rows=[];
R.forEach(r=>{
  if(r.course.date!==day){pend.forEach(x=>{const d=drv[x[0]]||(drv[x[0]]=[0,0]);d[1]++;if(x[2])d[0]++;const t=trn[x[1]]||(trn[x[1]]=[0,0]);t[1]++;if(x[2])t[0]++});pend=[];day=r.course.date}
  const parts=r.parts.filter(p=>p.statut!=='NON_PARTANT');
  const H=parts.map(p=>E.extract(p,r.course)).filter(h=>h.num!=null);
  const pos={};H.forEach(h=>{if(h.arrivee)pos[h.num]=h.arrivee});
  const ar=(r.course.arriveeTxt||'').split('-').map(Number);ar.forEach((n,i)=>{if(!pos[n])pos[n]=i+1});
  H.forEach(h=>pend.push([(h.driver||'').toUpperCase(),(h.entraineur||'').toUpperCase(),pos[h.num]===1]));
  const wi=H.findIndex(h=>pos[h.num]===1);if(wi<0)return;
  E.featurize(H,r.course,{drv:drv,trn:trn});
  const c=H.map(h=>h._fin>1?h._fin:(h.cote>1?h.cote:0));
  const cref=H.map(h=>h.coteRef>1?h.coteRef:0);
  const mk=arr=>{if(arr.filter(v=>v>1).length<Math.max(3,0.6*H.length))return null;const q=arr.map(v=>v>1?1/v:0),qm=Math.min(...q.filter(v=>v>0));const q2=q.map(v=>v||qm),s=q2.reduce((a,b)=>a+b);return q2.map(v=>Math.log(v/s))};
  rows.push({d:r.course.date,fam:(['TROT_ATTELE','TROT_MONTE','PLAT'].indexOf(r.course.specialite)>=0?r.course.specialite:'OBSTACLE'),X:H.map(h=>F.map(k=>h.fx[k]||0)),lpm:mk(c),lref:mk(cref),pos:H.map(h=>pos[h.num]||0),w:wi});
});
console.log('lignes',rows.length);
function fit(D,useM,iters){const K=F.length,P=K+(useM?1:0),th=new Float64Array(P);if(useM)th[K]=1;const m=new Float64Array(P),v=new Float64Array(P);
  for(let it=1;it<=iters;it++){const g=new Float64Array(P);let ll=0;
    D.forEach(r=>{const n=r.X.length,s=new Float64Array(n);let mx=-1e9;for(let i=0;i<n;i++){let z=0;for(let k=0;k<K;k++)z+=th[k]*r.X[i][k];if(useM)z+=th[K]*r.lpm[i];s[i]=z;if(z>mx)mx=z}
      let Z=0;const e=new Float64Array(n);for(let i=0;i<n;i++){e[i]=Math.exp(s[i]-mx);Z+=e[i]}ll+=-Math.log(e[r.w]/Z);
      for(let i=0;i<n;i++){const d=(i===r.w?1:0)-e[i]/Z;for(let k=0;k<K;k++)g[k]+=d*r.X[i][k];if(useM)g[K]+=d*r.lpm[i]}});
    for(let k=0;k<P;k++){const gk=g[k]/D.length-0.002*(k<K?th[k]:0);m[k]=.9*m[k]+.1*gk;v[k]=.999*v[k]+.001*gk*gk;th[k]+=0.02*(m[k]/(1-Math.pow(.9,it)))/(Math.sqrt(v[k]/(1-Math.pow(.999,it)))+1e-8)}
  }
  const w={};F.forEach((k,i)=>w[k]=+th[i].toFixed(4));return useM?{w,bm:+th[K].toFixed(4)}:{w}}
function ev(D,M,useM,key){let ll=0,top=0;D.forEach(r=>{const K=F.length,L=r[key||'lpm'];const s=r.X.map((x,i)=>{let z=0;for(let k=0;k<K;k++)z+=(M.w[F[k]]||0)*x[k];if(useM)z+=M.bm*L[i];return z});const mx=Math.max(...s),e=s.map(z=>Math.exp(z-mx)),Z=e.reduce((a,b)=>a+b);ll+=-Math.log(e[r.w]/Z);if(s.indexOf(mx)===r.w)top++});return {ll:+(ll/D.length).toFixed(4),top:+(top/D.length*100).toFixed(1)}}
function evM(D,key){let ll=0,top=0;D.forEach(r=>{const L=r[key];ll+=-L[r.w];if(L.indexOf(Math.max(...L))===r.w)top++});return {ll:+(ll/D.length).toFixed(4),top:+(top/D.length*100).toFixed(1)}}
const CUT='2026-06-01',out={},outT={};
['TROT_ATTELE','TROT_MONTE','PLAT','OBSTACLE'].forEach(fam=>{
  const A=rows.filter(r=>r.fam===fam&&r.lpm&&r.lref),tr=A.filter(r=>r.d<CUT),te=A.filter(r=>r.d>=CUT);
  const M1=fit(tr,true,250),M0=fit(tr,false,250);
  console.log(fam,'entraînement',tr.length,'test',te.length);
  console.log('  public (cote finale)   ',evM(te,'lpm'),'| modèle+public',ev(te,M1,true));
  console.log('  public (cote du matin) ',evM(te,'lref'),'| modèle+cote matin',ev(te,M1,true,'lref'),'| modèle seul',ev(te,M0,false));
  // refit on all data for production
  const F1=fit(A,true,250),F0=fit(A,false,250);out[fam]={mkt:F1,nomkt:F0,n:A.length};outT[fam]={mkt:M1,nomkt:M0,n:tr.length};
  console.log('  poids principaux',Object.entries(F1.w).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,8).map(x=>x[0]+' '+x[1]).join(', '),'| marché',F1.bm);
});
// stats drivers finales pour la production (top 400 pour rester léger)
const pick=o=>Object.fromEntries(Object.entries(o).filter(x=>x[1][1]>=15).sort((a,b)=>b[1][1]-a[1][1]).slice(0,1500));
out.ctx={drv:pick(drv),trn:pick(trn)};

// stats drivers arrêtées au 1er juin pour le test honnête
outT.ctx=out.ctx;
// sauvegarde des lignes de test pour le calage des places

// sauvegarde des modèles par discipline (production + test honnête)
const outD={},outDT={};['TROT_ATTELE','TROT_MONTE','PLAT','OBSTACLE'].forEach(fam=>{const A=rows.filter(r=>r.fam===fam&&r.lpm&&r.lref),tr=A.filter(r=>r.d<CUT);outD[fam]={mkt:fit(A,true,250),nomkt:fit(A,false,250),n:A.length};outDT[fam]={mkt:fit(tr,true,250),nomkt:fit(tr,false,250),n:tr.length}});
require('fs').writeFileSync('models_disc.json',JSON.stringify(outD));require('fs').writeFileSync('models_disc_train.json',JSON.stringify(outDT));
