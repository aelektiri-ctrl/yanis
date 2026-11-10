// Enregistre toutes les réponses ESPN qu'utilise l'appli pour une journée (pour l'audit hors ligne)
const fs=require('fs'),zlib=require('zlib'),SE=require('./sport.js');
const BASE='https://site.api.espn.com/apis/',REC={},mem={};
async function getJSON(p){const u=/^https?:/.test(p)?p:BASE+p;for(let i=0;i<3;i++){try{const r=await fetch(u);if(!r.ok)throw new Error(r.status);const j=await r.json();REC[p]=j;return j}catch(e){if(i==2){REC[p]=null;throw e}}}}
const store={get:k=>mem[k],set:(k,v)=>{mem[k]=v}};
(async()=>{
 const d=new Date(Date.now()+3600e3),ymd=d.toISOString().slice(0,10).replace(/-/g,'');
 const res=await SE.loadAll(getJSON,ymd,null,()=>{},store);
 await SE.enrich(getJSON,res.items,{},null);
 fs.mkdirSync('fixtures',{recursive:true});
 fs.writeFileSync('fixtures/espn_'+ymd+'.json.gz',zlib.gzipSync(JSON.stringify({ymd,REC})));
 console.log(ymd,Object.keys(REC).length,'réponses',res.items.length,'matchs');
})();
