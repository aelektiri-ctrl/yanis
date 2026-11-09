// Entourage : gagne-t-il plus ou moins que ce que ses cotes annoncent ? (A/E = réel / attendu)
const {loadAll}=require('./load.js');const E=require('/home/claude/single/engine.js');
const MT=JSON.parse(require('fs').readFileSync('models_train.json'));E.setModels(MT);
const R=loadAll('/home/claude/yanis/donnees').filter(r=>r.parts.filter(p=>p.statut!=='NON_PARTANT').length>=5&&r.course.arriveeTxt);
R.sort((a,b)=>a.course.date<b.course.date?-1:1);
const ROLES=['driver','entraineur','proprietaire'];
const ST={};ROLES.forEach(k=>ST[k]={});
function upd(role,name,pm,won,fav,pl,epl){if(!name)return;const s=ST[role][name]||(ST[role][name]={n:0,w:0,e:0,fn:0,fw:0,fe:0,pl:0,epl:0});s.n++;s.w+=won;s.e+=pm;s.pl+=pl;s.epl+=epl;if(fav){s.fn++;s.fw+=won;s.fe+=pm}}
function ae(role,name,kind){const s=ST[role][(name||'').toUpperCase()];if(!s)return 0;if(kind==='fav'){if(s.fn<3)return 0;return Math.log((s.fw+2*s.fe/s.fn)/(s.fe+2*s.fe/s.fn))}return Math.log((s.w+3)/(s.e+3))}
let day='',pend=[];const rows=[];
R.forEach(r=>{
  if(r.course.date!==day){pend.forEach(x=>upd.apply(null,x));pend=[];day=r.course.date}
  const parts=r.parts.filter(p=>p.statut!=='NON_PARTANT');
  const H=parts.map(p=>Object.assign(E.extract(p,r.course),{own:p.proprietaire,_fin:p._fin})).filter(h=>h.num!=null);
  if(H.filter(h=>h._fin>1).length<0.8*H.length)return;
  const ar=(r.course.arriveeTxt||'').split('-').map(Number);const pos={};ar.forEach((n,i)=>{if(!pos[n])pos[n]=i+1});
  const q=H.map(h=>h._fin>1?1/h._fin:0),s=q.reduce((a,b)=>a+b),pm=q.map(v=>v/s);const fi=pm.indexOf(Math.max(...pm));
  const pl3=H.map((h,i)=>Math.min(0.95,pm[i]*2.6));
  H.forEach((h,i)=>{const won=pos[h.num]===1?1:0,pl=pos[h.num]>0&&pos[h.num]<=3?1:0;[['driver',h.driver],['entraineur',h.entraineur],['proprietaire',h.own]].forEach(x=>pend.push([x[0],(x[1]||'').toUpperCase(),pm[i],won,i===fi,pl,pl3[i]]))});
  const wi=H.findIndex(h=>pos[h.num]===1);if(wi<0)return;
  E.__score(H,r.course);
  rows.push({d:r.course.date,fam:E.family(r.course),w:wi,base:H.map(h=>Math.log(h.p)),
    X:H.map((h,i)=>[ae('driver',h.driver),ae('entraineur',h.entraineur),ae('proprietaire',h.own),i===fi?ae('driver',h.driver,'fav'):0,i===fi?ae('entraineur',h.entraineur,'fav'):0,i===fi?ae('proprietaire',h.own,'fav'):0])});
});
const NAMES=['A/E driver','A/E entraîneur','A/E propriétaire','faux favori driver','faux favori entraîneur','faux favori propriétaire'];
function fit(D){const K=6,th=new Float64Array(K+1);th[K]=1;const m=new Float64Array(K+1),v=new Float64Array(K+1);
  for(let it=1;it<=300;it++){const g=new Float64Array(K+1);D.forEach(r=>{const n=r.X.length,s=r.X.map((x,i)=>{let z=th[K]*r.base[i];for(let k=0;k<K;k++)z+=th[k]*x[k];return z});const mx=Math.max(...s);const e=s.map(z=>Math.exp(z-mx)),Z=e.reduce((a,b)=>a+b);
    for(let i=0;i<n;i++){const d=(i===r.w?1:0)-e[i]/Z;for(let k=0;k<K;k++)g[k]+=d*r.X[i][k];g[K]+=d*r.base[i]}});
    for(let k=0;k<=K;k++){const gk=g[k]/D.length;m[k]=.9*m[k]+.1*gk;v[k]=.999*v[k]+.001*gk*gk;th[k]+=0.02*(m[k]/(1-Math.pow(.9,it)))/(Math.sqrt(v[k]/(1-Math.pow(.999,it)))+1e-8)}}return th}
function ll(D,th){let L=0,top=0;D.forEach(r=>{const s=r.X.map((x,i)=>{let z=(th?th[6]:1)*r.base[i];if(th)for(let k=0;k<6;k++)z+=th[k]*x[k];return z});const mx=Math.max(...s),e=s.map(z=>Math.exp(z-mx)),Z=e.reduce((a,b)=>a+b);L+=-Math.log(e[r.w]/Z);if(s.indexOf(mx)===r.w)top++});return [(L/D.length).toFixed(4),(top/D.length*100).toFixed(1)+'%']}
const CUT='2026-06-01';
['trot','galop'].forEach(f=>{const tr=rows.filter(r=>r.fam===f&&r.d<CUT),te=rows.filter(r=>r.fam===f&&r.d>=CUT);const th=fit(tr);
  console.log(f,'| test',te.length,'| moteur actuel',ll(te,null).join(' n°1 '),'| + entourage',ll(te,th).join(' n°1 '));console.log('   poids',NAMES.map((n,i)=>n+' '+th[i].toFixed(3)).join(' | '))});
// faux favoris les plus marqués (au moins 15 courses favori)
['driver','entraineur','proprietaire'].forEach(role=>{const L=Object.entries(ST[role]).filter(x=>x[1].fn>=15).map(x=>[x[0],x[1].fn,x[1].fw,x[1].fe,x[1].fw/x[1].fe]).sort((a,b)=>a[4]-b[4]);
  console.log(role,': favoris qui rendent le moins (n fav, gagnés, attendus) :',L.slice(0,3).map(x=>x[1]+'/'+x[2]+'/'+x[3].toFixed(1)).join(' ; '),'| le plus :',L.slice(-2).map(x=>x[1]+'/'+x[2]+'/'+x[3].toFixed(1)).join(' ; '))});
require('fs').writeFileSync('entourage.json',JSON.stringify(ST));
