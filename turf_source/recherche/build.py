# Table « un partant par ligne » sur tout l'historique Yanis, avec rapports officiels
import json,gzip,glob,re,math
import pandas as pd, numpy as np
rows=[]
def tab(b): return [dict(zip(b['colonnes'],l)) for l in b['lignes']]
for f in sorted(glob.glob('/home/claude/yanis/donnees/*/*/*.json.gz')):
    j=json.load(gzip.open(f))
    if 'courses' not in j or 'partants' not in j: continue
    reu={r['r']:r for r in tab(j['reunions'])}
    C={(c['r'],c['c']):c for c in tab(j['courses'])}
    RP={}
    for x in tab(j.get('rapports',{'colonnes':[],'lignes':[]})):
        if x['pari'] in('SIMPLE_GAGNANT','SIMPLE_PLACE'): RP[(x['r'],x['c'],x['pari'],str(x['combinaison']))]=x['rapport_pour_1e']
    P={}
    for p in tab(j['partants']): P.setdefault((p['r'],p['c']),[]).append(p)
    for k,ps in P.items():
        c=C.get(k)
        if not c or not c.get('arrivee'): continue
        ps=[p for p in ps if p['statut']!='NON_PARTANT' and p['cote_finale'] and p['cote_finale']>1]
        if len(ps)<5: continue
        inv=[1/p['cote_finale'] for p in ps];s=sum(inv)
        order=sorted(ps,key=lambda p:p['cote_finale'])
        for p in ps:
            mus=re.sub(r'\(\d+\)','',p['musique'] or '');tok=re.findall(r'([0-9DATRN])[a-z]',mus)
            pl=p['place_arrivee']
            rows.append(dict(date=j['date'],course=f"{j['date']}R{k[0]}C{k[1]}",hippo=reu.get(k[0],{}).get('hippodrome'),spec=c['specialite'],
              dist=c['distance'],alloc=c['allocation'],n=len(ps),terrain=c.get('terrain'),corde_sens=c.get('corde'),cat=c.get('categorie'),
              num=p['num'],age=p['age'],sexe=p['sexe'],driver=p['driver'],trainer=p['entraineur'],owner=p['proprietaire'],pere=p['pere'],
              deferre=p['deferre'] or 'FERRE',oeil=p['oeilleres'] or 'SANS',recul=p['recul_m'],poids=p['poids_kg'],corde=p['place_corde'],
              ref=p['cote_reference'],cote=p['cote_finale'],pm=(1/p['cote_finale'])/s,rang=order.index(p)+1,
              last=tok[0] if tok else 'X',top3_5=sum(1 for t in tok[:5] if t in '123'),fautes5=sum(1 for t in tok[:5] if t in 'DAT'),
              nbc=p['nb_courses'],gains=p['gains_carriere'],win=1 if pl==1 else 0,plc=1 if pl and 1<=pl<=3 else 0,
              sg=RP.get((k[0],k[1],'SIMPLE_GAGNANT',str(p['num'])),0) if pl==1 else 0,
              sp=RP.get((k[0],k[1],'SIMPLE_PLACE',str(p['num'])),0) if pl and pl<=3 else 0))
df=pd.DataFrame(rows);df.to_parquet('runners.parquet') if False else df.to_pickle('runners.pkl')
print(len(df),'partants',df.course.nunique(),'courses',df.date.min(),'→',df.date.max())
print('ROI simple gagnant global',round(df.sg.sum()/len(df)-1,3),'| placé',round(df.sp.sum()/len(df)-1,3))
