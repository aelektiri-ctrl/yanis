s=open('shell.html').read()
for k,f in [('ENGINE','engine.js'),('SPORT','sport.js'),('LEARN','learn.js'),('APP','app.js')]:
    s=s.replace('/*%s*/'%k,open(f).read())
open('index.html','w').write(s)
