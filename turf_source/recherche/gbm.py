import pandas as pd, numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
df=pd.read_pickle('runners.pkl')
df['lpm']=np.log(df.pm);df['move']=np.log(df.ref.fillna(df.cote).clip(1.01)/df.cote)
df['def4']=(df.deferre=='DEFERRE_ANTERIEURS_POSTERIEURS').astype(int);df['def2']=df.deferre.str.contains('DEFERRE').astype(int)-df.def4
df['trot']=df.spec.str.contains('TROT').astype(int);df['gps']=np.log1p(df.gains.fillna(0)/df.nbc.clip(1))
df['gps_r']=df.groupby('course').gps.rank(pct=True);df['poids_r']=df.poids-df.groupby('course').poids.transform('mean')
df['recul_r']=df.recul-df.dist;df['lastn']=df['last'].map(lambda x:int(x) if x.isdigit() and x!='0' else (10 if x=='0' else 12))
# stats driver / entraîneur cumulées avant chaque jour (sans fuite)
df=df.sort_values('date')
for col in['driver','trainer']:
    g=df.groupby([col,'date']).agg(w=('win','sum'),n=('win','size'),e=('pm','sum')).reset_index().sort_values('date')
    g[['cw','cn','ce']]=g.groupby(col)[['w','n','e']].cumsum()-g[['w','n','e']].values
    g[col+'_ae']=np.log((g.cw+3)/(g.ce+3));g[col+'_n']=g.cn
    df=df.merge(g[[col,'date',col+'_ae',col+'_n']],on=[col,'date'],how='left')
F=['lpm','move','def4','def2','trot','gps_r','poids_r','recul_r','lastn','top3_5','fautes5','age','n','dist','corde','rang','nbc','driver_ae','trainer_ae','driver_n','trainer_n']
A=df[df.date<'2026-06-01'];B=df[(df.date>='2026-06-01')&(df.date<'2026-09-01')];C=df[df.date>='2026-09-01']
m=HistGradientBoostingClassifier(max_iter=400,learning_rate=0.04,max_leaf_nodes=31,min_samples_leaf=200,l2_regularization=1.0,random_state=0)
m.fit(A[F],A.win)
def norm(D,raw):
    D=D.copy();D['raw']=raw;D['p']=D.raw/D.groupby('course').raw.transform('sum');return D
def report(D,name):
    W=D[D.win==1];llm=-np.log(W.pm).mean();llg=-np.log(W.p).mean()
    t1=D.loc[D.groupby('course').p.idxmax()].win.mean();f1=D.loc[D.groupby('course').pm.idxmax()].win.mean()
    print(f'{name}: log-loss machine {llg:.4f} vs public {llm:.4f} | n°1 machine gagne {t1*100:.1f} % vs favori {f1*100:.1f} %')
Bp=norm(B,m.predict_proba(B[F])[:,1]);Cp=norm(C,m.predict_proba(C[F])[:,1])
report(Bp,'juin-août');report(Cp,'sept-nov ')
# stratégie value : seuil choisi sur juin-août, jugé sur sept-nov
best=None
for th in [1.05,1.1,1.2,1.3,1.5]:
    for lo,hi in [(2,8),(4,15),(6,30),(2,30)]:
        s=Bp[(Bp.p*Bp.cote>=th)&(Bp.cote>=lo)&(Bp.cote<=hi)]
        if len(s)>=150:
            roi=s.sg.mean()-1
            if not best or roi>best[0]: best=(roi,th,lo,hi,len(s))
print('meilleure règle value sur juin-août : valeur ≥%.2f, cote %d-%d → %d paris, ROI %+.1f %%'%(best[1],best[2],best[3],best[4],best[0]*100))
s=Cp[(Cp.p*Cp.cote>=best[1])&(Cp.cote>=best[2])&(Cp.cote<=best[3])]
print('même règle en sept-nov : %d paris, %.1f %% gagnants, ROI %+.1f %%'%(len(s),s.win.mean()*100,(s.sg.mean()-1)*100))
r=Cp[(Cp.cote>=best[2])&(Cp.cote<=best[3])];print('référence (toutes les cotes %d-%d en sept-nov) : ROI %+.1f %%'%(best[2],best[3],(r.sg.mean()-1)*100))
x=s.sg.values;rng=np.random.default_rng(0);bs=[rng.choice(x,len(x)).mean()-1 for _ in range(5000)]
print('sept-nov, intervalle à 90 %% du ROI : %+.0f %% à %+.0f %% ; probabilité ROI<0 : %.0f %%'%(np.percentile(bs,5)*100,np.percentile(bs,95)*100,np.mean(np.array(bs)<0)*100))
print('gains des 9 gagnants :',sorted([round(v,1) for v in x if v>0],reverse=True),'| sans le plus gros : ROI %+.1f %%'%((x.sum()-x.max())/len(x)*100-100))
