# Recherche systématique de « coïncidences » rentables, validées hors échantillon
import pandas as pd, numpy as np, itertools
df=pd.read_pickle('runners.pkl')
df['cote_b']=pd.cut(df.cote,[1,2,3,5,8,12,20,40,1000],labels=['<2','2-3','3-5','5-8','8-12','12-20','20-40','40+']).astype(str)
df['n_b']=pd.cut(df.n,[0,8,11,14,30],labels=['≤8','9-11','12-14','15+']).astype(str)
df['dist_b']=pd.cut(df.dist,[0,1400,1900,2400,2800,9000],labels=['sprint','mile','moyenne','2400-2800','long']).astype(str)
df['age_b']=df.age.clip(2,10).astype(str)
df['move']=np.log(df.ref.fillna(df.cote)/df.cote);df['move_b']=pd.cut(df.move,[-9,-0.4,-0.15,0.15,0.4,9],labels=['forte hausse','hausse','stable','baisse','forte baisse']).astype(str)
df['corde_b']=pd.cut(df.corde.fillna(0),[-1,0,3,7,30],labels=['n/a','1-3','4-7','8+']).astype(str)
df['rang_b']=df.rang.clip(1,6).astype(str)
df['top3_b']=df.top3_5.clip(0,3).astype(str)
for col,k in [('driver',300),('trainer',300),('pere',200),('hippo',60)]:
    top=df[col].value_counts().index[:k];df[col+'_t']=df[col].where(df[col].isin(top),'autre')
ATTR=['spec','hippo_t','dist_b','n_b','cote_b','rang_b','deferre','oeil','sexe','age_b','last','top3_b','move_b','corde_b','driver_t','trainer_t','pere_t','terrain','cat']
CUT='2026-06-01';tr=df[df.date<CUT];te=df[df.date>=CUT]
print('entraînement',len(tr),'partants | test',len(te))
res=[]
for kind,col in [('gagnant','sg'),('placé','sp')]:
    for a,b in list(itertools.combinations(ATTR,2))+[(a,None) for a in ATTR]:
        keys=[a]+([b] if b else [])
        g=tr.groupby(keys)[col].agg(['count','mean','std'])
        g=g[g['count']>=100]
        g['roi']=g['mean']-1;g['z']=g['roi']/(g['std']/np.sqrt(g['count']))
        for idx,r in g[(g.roi>0.0)&(g.z>1.0)].iterrows():
            idx=idx if isinstance(idx,tuple) else (idx,)
            res.append((kind,col,tuple(keys),idx,int(r['count']),r.roi,r.z))
print('combinaisons testées : environ',sum(len(tr.groupby([a]+([b] if b else [])).size()) for a,b in list(itertools.combinations(ATTR,2))+[(a,None) for a in ATTR])*2)
print('« coïncidences » rentables trouvées avant juin (ROI>0, z>1) :',len(res))
out=[];tot_bets=tot_ret=0
for kind,col,keys,vals,n,roi,z in res:
    m=np.ones(len(te),bool)
    for k,v in zip(keys,vals): m&=(te[k]==v).values
    t=te[m]
    if len(t)<30: continue
    out.append((kind,' & '.join(f'{k}={v}' for k,v in zip(keys,vals)),n,roi,len(t),t[col].mean()-1));tot_bets+=len(t);tot_ret+=t[col].sum()
O=pd.DataFrame(out,columns=['pari','motif','n_avant','roi_avant','n_apres','roi_apres'])
print('motifs avec assez de paris après juin :',len(O))
print('  toujours rentables après juin :',(O.roi_apres>0).sum(),'sur',len(O))
print('  ROI moyen avant juin : +%.1f %% → après juin : %.1f %%'%(O.roi_avant.mean()*100,O.roi_apres.mean()*100))
print('  si on avait joué tous ces motifs après juin : %d paris, ROI %.1f %%'%(tot_bets,(tot_ret/tot_bets-1)*100))
print('Référence : tous les paris après juin — gagnant %.1f %%, placé %.1f %%'%((te.sg.mean()-1)*100,(te.sp.mean()-1)*100))
O['stable']=(O.roi_apres>0.05)&(O.n_apres>=100)
print('\nMotifs qui tiennent (ROI après juin >+5 %, ≥100 paris) :')
print(O[O.stable].sort_values('roi_apres',ascending=False).head(25).to_string(index=False))
O.to_pickle('motifs.pkl')
