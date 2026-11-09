// Cale l'exposant des places (modèle de Harville corrigé, type Lo-Bacon-Shone) sur les vraies arrivées
const {loadAll}=require('./load.js');const E=require('/home/claude/single/engine.js');
const M=JSON.parse(require('fs').readFileSync('models.json'));E.setModels(M);
const R=loadAll('/home/claude/yanis/donnees').filter(r=>r.parts.filter(p=>p.statut!=='NON_PARTANT').length>=6&&r.course.arriveeTxt&&r.course.date<'2026-06-01');
const S=[];
R.forEach(r=>{const parts=r.parts.filter(p=>p.statut!=='NON_PARTANT');const H=parts.map(p=>E.extract(p,r.course)).filter(h=>h.num!=null);if(H.filter(h=>h.cote>1).length<0.6*H.length)return;
  E.__score(H,r.course);const ar=(r.course.arriveeTxt||'').split('-').map(Number);const idx=ar.slice(0,4).map(n=>H.findIndex(h=>h.num===n));if(idx.some(i=>i<0))return;S.push({p:H.map(h=>h.p),idx})});
console.log('courses',S.length);
function ll(pos,lam){let L=0,nn=0;S.forEach(s=>{const used=s.idx.slice(0,pos);const w=s.p.map((p,i)=>used.indexOf(i)>=0?0:Math.pow(p,lam));const Z=w.reduce((a,b)=>a+b);const v=-Math.log(w[s.idx[pos]]/Z);if(isFinite(v)){L+=v;nn++}});return L/nn}
[1,2,3].forEach(pos=>{let best=null;for(let l=0.3;l<=1.21;l+=0.05){const v=ll(pos,l);if(!best||v<best[1])best=[l,v]}console.log('place',pos+1,'exposant optimal',best[0].toFixed(2),'(0,85 avant :',ll(pos,0.85).toFixed(4),'→',best[1].toFixed(4)+')')});
