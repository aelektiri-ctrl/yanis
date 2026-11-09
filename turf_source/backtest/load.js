// Charge l'historique brut Yanis et le convertit au format du moteur
const fs=require('fs'),zlib=require('zlib'),path=require('path');
function tab(b){const c=b.colonnes;return b.lignes.map(l=>{const o={};c.forEach((k,i)=>o[k]=l[i]);return o})}
function loadDay(f){
  const j=JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString());
  if(!j.courses||!j.partants)return [];
  const reus={};tab(j.reunions).forEach(r=>reus[r.r]=r);
  const P={};tab(j.partants).forEach(p=>{(P[p.r+'-'+p.c]=P[p.r+'-'+p.c]||[]).push(p)});
  const RP={};(j.rapports?tab(j.rapports):[]).forEach(p=>{(RP[p.r+'-'+p.c]=RP[p.r+'-'+p.c]||[]).push({pari:p.pari,libelle:p.libelle,combinaison:p.combinaison,rapport:p.rapport_pour_1e})});
  return tab(j.courses).map(c=>{const k=c.r+'-'+c.c,re=reus[c.r]||{};
    const course={date:j.date,numReunion:c.r,numOrdre:c.c,heureDepart:0,libelle:c.libelle,distance:c.distance,specialite:c.specialite,discipline:c.discipline,montantPrix:c.allocation,
      paris:(c.paris||'').split(',').filter(Boolean).map(t=>({typePari:t,miseBase:100})),arriveeTxt:c.arrivee||'',rapports:RP[k]||[],hippodromeNom:re.hippodrome,pays:re.pays,statut:c.statut};
    const parts=(P[k]||[]).map(p=>({numPmu:p.num,nom:p.nom,statut:p.statut,age:p.age,sexe:p.sexe,driver:p.driver,entraineur:p.entraineur,musique:p.musique,
      nombreCourses:p.nb_courses,nombreVictoires:p.nb_victoires,nombrePlaces:p.nb_places,gainsParticipant:{gainsCarriere:p.gains_carriere,gainsAnneeEnCours:p.gains_annee},
      deferre:p.deferre,oeilleres:p.oeilleres,handicapDistance:p.recul_m,handicapPoids:p.poids_kg,placeCorde:p.place_corde,
      dernierRapportDirect:{rapport:p.cote_finale},dernierRapportReference:{rapport:p.cote_reference},ordreArrivee:p.place_arrivee,_ref:p.cote_reference,_fin:p.cote_finale}));
    return {course,parts};
  });
}
function loadAll(dir){const files=[];(function walk(d){fs.readdirSync(d).forEach(x=>{const p=path.join(d,x);if(fs.statSync(p).isDirectory())walk(p);else if(x.endsWith('.json.gz'))files.push(p)})})(dir);files.sort();
  let out=[];files.forEach(f=>{try{out=out.concat(loadDay(f))}catch(e){}});return out}
module.exports={loadAll};
if(require.main===module){const t=Date.now();const R=loadAll('/home/claude/yanis/donnees');console.log(R.length,'courses',(Date.now()-t)+'ms');
 const ok=R.filter(r=>r.parts.length>=4&&r.course.arriveeTxt);console.log('avec arrivée',ok.length);
 const s=ok[5000];console.log(s.course.date,s.course.specialite,s.parts.length,JSON.stringify(s.parts[0]).slice(0,400),s.course.rapports.length);
 // fuite ? le gagnant a-t-il sa victoire déjà comptée dans sa musique ?
 let w1=0,n=0;ok.slice(0,3000).forEach(r=>{const w=r.parts.find(p=>p.ordreArrivee===1);if(w&&w.musique){n++;if(/^1/.test(w.musique))w1++}});console.log('gagnants dont la musique commence par 1 :',w1,'/',n);
 let pf=0,nf=0;ok.forEach(r=>{const c=r.parts.filter(p=>p._fin>1);if(c.length<4)return;const f=c.reduce((a,b)=>a._fin<b._fin?a:b);nf++;if(f.ordreArrivee===1)pf++});console.log('favori final gagne',(pf/nf*100).toFixed(1)+'%',nf);
}
