import pandas as pd, numpy as np, itertools
exec(open('scan.py').read().split("CUT='2026-06-01'")[0])
A,B,C=df[df.date<'2026-06-01'],df[(df.date>='2026-06-01')&(df.date<'2026-09-01')],df[df.date>='2026-09-01']
print('périodes :',len(A),len(B),len(C),'partants')
def seg(D,keys,vals):
    m=np.ones(len(D),bool)
    for k,v in zip(keys,vals): m&=(D[k]==v).values
    return D[m]
cand=[]
for kind,col in [('gagnant','sg'),('placé','sp')]:
    for a,b in list(itertools.combinations(ATTR,2))+[(a,None) for a in ATTR]:
        keys=[a]+([b] if b else [])
        g=A.groupby(keys)[col].agg(['count','mean','std']);g=g[g['count']>=100];g['roi']=g['mean']-1;g['z']=g['roi']/(g['std']/np.sqrt(g['count']))
        for idx,r in g[(g.roi>0)&(g.z>1)].iterrows():
            idx=idx if isinstance(idx,tuple) else (idx,);cand.append((col,keys,idx))
conf=[]
for col,keys,vals in cand:
    b=seg(B,keys,vals)
    if len(b)>=40 and b[col].mean()>1.05: conf.append((col,keys,vals,len(b),b[col].mean()-1))
print('motifs trouvés avant juin :',len(cand),'| confirmés juin-août (ROI>+5 %) :',len(conf))
bets=ret=0;rows=[]
for col,keys,vals,nb,rb in conf:
    c=seg(C,keys,vals)
    if len(c)<20: continue
    bets+=len(c);ret+=c[col].sum();rows.append((col,' & '.join(f'{k}={v}' for k,v in zip(keys,vals)),nb,round(rb,3),len(c),round(c[col].mean()-1,3)))
R=pd.DataFrame(rows,columns=['pari','motif','n_juin_aout','roi_juin_aout','n_sept_nov','roi_sept_nov'])
print('sept-nov : %d motifs jouables, %d encore positifs ; tous joués : %d paris, ROI %.1f %%'%(len(R),(R.roi_sept_nov>0).sum(),bets,(ret/bets-1)*100))
print('référence sept-nov : gagnant %.1f %%, placé %.1f %%'%((C.sg.mean()-1)*100,(C.sp.mean()-1)*100))
# Monte-Carlo : même nombre de motifs tirés au hasard -> combien positifs par chance ?
rng=np.random.default_rng(1);pos=[]
for _ in range(30):
    cnt=0;tot=0
    for col,keys,vals in [cand[i] for i in rng.choice(len(cand),len(R),replace=False)]:
        c=seg(C,keys,vals)
        if len(c)>=20: tot+=1;cnt+=c[col].mean()>1
    pos.append(cnt/max(1,tot))
print('part de motifs positifs en sept-nov : confirmés %.0f %% contre %.0f %% pour des motifs pris au hasard'%((R.roi_sept_nov>0).mean()*100,np.mean(pos)*100))
print(R.sort_values('roi_sept_nov',ascending=False).head(12).to_string(index=False))
R.to_pickle('motifs3.pkl')
