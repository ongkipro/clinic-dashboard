import re,sys,os,collections,json
root=sys.argv[1]; out={}
ROUTE=re.compile(r'''["'`](/(?:[a-z0-9][a-z0-9_-]*)(?:/[a-z0-9:_\-\[\]{}$]+){0,5})["'`]''',re.I)
API=re.compile(r'''["'`]((?:https?://[^"'`\s]+)?/?(?:api|v1|v2|v3|graphql|rest)/[A-Za-z0-9_\-/{}:$.]+)["'`]''')
PERM=re.compile(r'''["'`]([a-z_]+[.:](?:view|create|read|update|delete|edit|approve|manage|list|export|print|void|refund)[a-z_]*)["'`]''')
LABEL=re.compile(r'''(?:title|label|name|text|header|menu)\s*:\s*["'`]([A-Z][A-Za-z &/().,'-]{3,48})["'`]''')
for d in sorted(os.listdir(root)):
    p=os.path.join(root,d)
    if not os.path.isdir(p): continue
    R=collections.Counter();A=collections.Counter();P=collections.Counter();L=collections.Counter()
    for f in os.listdir(p):
        if not re.search(r'\.(js|mjs|html)$|chunk|bundle',f): continue
        if re.search(r'pdfkit|pdfmake|vfs_fonts|chart\.js|fuse\.js|moment|lodash|swiper|sweetalert|headlessui|prismjs|global_plugins|select2|jquery|vendors|mui-vendor',f): continue
        s=open(os.path.join(p,f),errors='ignore').read()
        for m in ROUTE.findall(s):
            if not re.search(r'\.(js|css|png|svg|jpg|woff|ico|json|webp)$|^/(?:node_modules|static|assets|_next)',m): R[m]+=1
        for m in API.findall(s): A[re.sub(r'\?.*','',m)]+=1
        for m in PERM.findall(s): P[m]+=1
        for m in LABEL.findall(s): L[m]+=1
    out[d]={'routes':sorted(R)[:400],'api':sorted(A)[:400],'perms':sorted(P)[:300],'labels':[k for k,_ in L.most_common(400)]}
    print(d,'routes',len(R),'api',len(A),'perms',len(P),'labels',len(L))
json.dump(out,open(os.path.join(root,'..','static-extract.json'),'w'),indent=1)
