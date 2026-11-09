const {loadAll}=require('./load.js');const E=require('/home/claude/single/engine.js');
E.setModels(JSON.parse(require('fs').readFileSync('models_train.json')));
const R=loadAll('/home/claude/yanis/donnees').filter(r=>r.course.date>='2026-06-01'&&r.course.arriveeTxt&&r.parts.filter(p=>p.statut!=='NON_PARTANT').length>=6);
const B={};R.forEach(r=>{const parts=r.parts.filter(p=>p.statut!=='NON_PARTANT');const H=parts.map(p=>E.extract(p,r.course)).filter(h=>h.num!=null&&h.cote>1);if(H.length<6)return;E.__score(H,r.course);
 const f=H.reduce((a,b)=>a.cote<b.cote?a:b);const q=f.p/f.pm;const k=q<0.85?'fragile (<0,85)':q<0.95?'un peu fragile':q<1.05?'normal':'solide (>1,05)';const won=+r.course.arriveeTxt.split('-')[0]===f.num;
 const o=B[k]=B[k]||[0,0,0];o[0]++;o[1]+=won;o[2]+=f.pm});
Object.entries(B).forEach(([k,o])=>console.log(k.padEnd(16),o[0],'favoris | gagnent',(o[1]/o[0]*100).toFixed(1)+'%','| la cote annonçait',(o[2]/o[0]*100).toFixed(1)+'%'));
