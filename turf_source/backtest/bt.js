const {loadAll}=require('./load.js');const E=require('/home/claude/single/engine.js');if(process.env.MODELS){const M=JSON.parse(require('fs').readFileSync(process.env.MODELS));E.setModels(M);}
const R=loadAll('/home/claude/yanis/donnees').filter(r=>r.parts.filter(p=>p.statut!=='NON_PARTANT').length>=5&&r.course.arriveeTxt&&r.course.rapports.length);
const FROM=process.argv[2]||'2026-06-01',USE=process.argv[3]||'fin',N=+(process.argv[4]||3000);
const T=R.filter(r=>r.course.date>=FROM);
if(USE==='ref')T.forEach(r=>r.parts.forEach(p=>{p.dernierRapportDirect={rapport:p._ref}}));
let ll=0,llm=0,n=0,top=0,fav=0;const typ={},lev={},cal=[];
T.forEach((r,i)=>{
  const a=E.analyse(r.course,r.parts,{N:N});if(!a.ok||!a.arrivee)return;
  const w=a.H.find(h=>h.num===a.arrivee[0]);if(!w)return;
  n++;ll+=-Math.log(Math.max(1e-4,w.p));if(w.pm)llm+=-Math.log(Math.max(1e-4,w.pm));
  if(a.ranking[0].num===a.arrivee[0])top++;
  const fv=a.H.filter(h=>h.cote).sort((x,y)=>x.cote-y.cote)[0];if(fv&&fv.num===a.arrivee[0])fav++;
  a.jeux.forEach(j=>{if(!j.rapportOk)return;const k=j.type+(j.main?'*':'');const t=typ[k]=typ[k]||{n:0,hit:0,p:0,cost:0,ret:0};t.n++;t.hit+=j.gagne?1:0;t.p+=j.p;t.cost+=j.cout;t.ret+=j.retour});
  const m=a.main;if(m&&m.rapportOk){const L=lev[a.level]=lev[a.level]||{n:0,hit:0,p:0,cost:0,ret:0};L.n++;L.hit+=m.gagne?1:0;L.p+=m.p;L.cost+=m.cout;L.ret+=m.retour;cal.push([m.p,m.gagne?1:0])}
});
const f=x=>(x*100).toFixed(1)+'%';
console.log('Courses',n,'| log-loss gagnant: moteur',(ll/n).toFixed(4),'marché',(llm/n).toFixed(4),'| n°1 moteur gagne',f(top/n),'favori',f(fav/n));
console.log('Par niveau (jeu principal): annoncé / réel / ROI');Object.keys(lev).forEach(k=>{const L=lev[k];console.log(' ',k.padEnd(6),L.n,'annoncé',f(L.p/L.n),'réel',f(L.hit/L.n),'ROI',f(L.ret/L.cost-1))});
console.log('Par type de jeu (* = principal): n / annoncé / réel / ROI');Object.keys(typ).sort().forEach(k=>{const t=typ[k];console.log(' ',k.padEnd(18),String(t.n).padStart(5),'annoncé',f(t.p/t.n),'réel',f(t.hit/t.n),'ROI',f(t.ret/t.cost-1))});
const B=[[0,.2],[.2,.4],[.4,.6],[.6,.8],[.8,1.01]];console.log('Calibration jeu principal:');B.forEach(b=>{const c=cal.filter(x=>x[0]>=b[0]&&x[0]<b[1]);if(c.length)console.log(' ',Math.round(b[0]*100)+'-'+Math.round(b[1]*100)+'%',c.length,'annoncé',f(c.reduce((s,x)=>s+x[0],0)/c.length),'réel',f(c.reduce((s,x)=>s+x[1],0)/c.length))});
// stratégie Value : simple gagnant quand la cote paie plus que le risque
let vb=0,vw=0,vc=0,vr=0;const VB={};
T.forEach(r=>{const a=E.analyse(r.course,r.parts,{N:300});if(!a.ok||!a.arrivee)return;const sg=(r.course.rapports||[]).filter(x=>x.pari==='SIMPLE_GAGNANT');
  a.H.forEach(h=>{if(!h.cote||h.cote<4||h.p<0.05||!h.ev||h.ev<1.10)return;const won=a.arrivee[0]===h.num;const rp=won?(sg.find(x=>+x.combinaison===h.num)||{}).rapport||h.cote:0;vb++;vc+=1;vr+=rp;if(won)vw++;
    const b=h.ev>=1.3?'≥1,30':h.ev>=1.2?'1,20-1,30':'1,10-1,20';const o=VB[b]=VB[b]||[0,0,0];o[0]++;o[1]+=rp;o[2]+=won?1:0})});
console.log('VALUE simple gagnant :',vb,'paris, gagnants',f(vw/vb),'ROI',f(vr/vc-1));Object.keys(VB).forEach(k=>console.log('  valeur',k,VB[k][0],'paris, gagnants',f(VB[k][2]/VB[k][0]),'ROI',f(VB[k][1]/VB[k][0]-1)));
const HIST={};Object.keys(typ).forEach(k=>{const t=typ[k];HIST[k]={n:t.n,hit:+(t.hit/t.n).toFixed(3),roi:+(t.ret/t.cost-1).toFixed(3)}});
require('fs').writeFileSync('hist_'+USE+'.json',JSON.stringify({HIST,value:{n:vb,hit:+(vw/vb).toFixed(3),roi:+(vr/vc-1).toFixed(3)}}));
