"""Build the static GitHub Pages version of 트렌드 데스크 from the Claude artifact page.

Usage: python3 tools/build_site.py <artifact_html> <out_index_html>

The artifact page reads its data through `window.claude.use("db")`. Here we provide a
small read-only shim with the same API that serves data/bundle.json instead, and we hide
every control that writes data (writes stay on the Claude page).
"""
import re, sys

src, out = sys.argv[1], sys.argv[2]
page = open(src, encoding="utf-8").read()

title = re.search(r"<title>(.*?)</title>", page, re.S).group(1)
links = "\n".join(re.findall(r"<link[^>]+>", page))
style = re.search(r"<style>(.*?)</style>", page, re.S).group(1)
script = re.search(r"<script>(.*)</script>", page, re.S).group(1)
body = page[page.index("</style>") + len("</style>"): page.index("<script>")]

# 1) header line shows when the data was published instead of the local-archive status
hook = "function renderSync(){"
assert hook in script, "renderSync not found"
script = script.replace(hook, hook + """
  if(window.TD_STATIC){ const el=$("syncline"); const t=window.TD_STATIC.generated_at;
    el.innerHTML = t ? `업데이트 <b>${esc(t.slice(5,16).replace("T"," "))}</b>` : "&nbsp;"; return; }""", 1)

assert 'id="t-field"' in body and 'id="t-mine"' in body

SHIM = r"""<script src="vault.js"></script>
<script>
/* Read-only stand-in for the Claude artifact database: serves data/bundle.json. */
(function(){
  const listeners=[]; let bundle=null, loadedAt=0, loading=null;
  function banner(msg){ let b=document.getElementById("td-banner"); if(!b){ b=document.createElement("div"); b.id="td-banner"; b.setAttribute("role","status"); document.body.prepend(b); } b.textContent=msg; b.hidden=!msg; }
  async function load(){
    if(loading) return loading;
    loading=(async()=>{
      try{
        const r=await fetch("data/bundle.json?t="+Date.now(),{cache:"no-store"});
        if(!r.ok) throw new Error("HTTP "+r.status);
        const j=await r.json();
        if(!j||typeof j!=="object"||!j.collections) throw new Error("bad bundle");
        bundle=j; loadedAt=Date.now(); window.TD_STATIC={generated_at:j.generated_at||""};
        banner("");
        return true;
      }catch(e){ console.warn("bundle load failed",e); banner("데이터를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요."); return false; }
      finally{ loading=null; }
    })();
    return loading;
  }
  const clone=o=>JSON.parse(JSON.stringify(o));
  function snapDoc(id,data){ return {id, exists:!!data, data:()=>data?clone(data):undefined, metadata:{fromCache:false,hasPendingWrites:false}}; }
  function runQuery(q){
    let rows=((bundle&&bundle.collections[q.path])||[]).slice();
    if(q.order){ const {f,dir}=q.order; rows.sort((a,b)=>{ const x=a[f],y=b[f]; if(x===y) return 0; if(x==null) return 1; if(y==null) return -1; return (x<y?-1:1)*(dir==="desc"?-1:1); }); }
    else rows.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    if(q.lim) rows=rows.slice(0,q.lim);
    const docs=rows.map(r=>{ const {id,...rest}=r; return snapDoc(id,rest); });
    return {docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{fromCache:false,hasPendingWrites:false}};
  }
  function emit(l){ try{ l.kind==="q" ? l.next(runQuery(l.q)) : l.next(snapDoc(l.path.split("/").pop(), bundle&&bundle.docs?bundle.docs[l.path]:undefined)); }catch(e){ console.error(e); } }
  const ro=()=>Promise.reject({code:"not_granted",message:"read-only"});
  function query(q){
    return {
      orderBy(f,dir){ return query({...q,order:{f,dir:dir||"asc"}}); },
      limit(n){ return query({...q,lim:n}); },
      where(){ return query(q); },
      async get(){ await load(); return runQuery(q); },
      onSnapshot(next){ const l={kind:"q",q,next}; listeners.push(l); load().then(ok=>{ if(ok) emit(l); }); return ()=>{ const i=listeners.indexOf(l); if(i>=0) listeners.splice(i,1); }; },
      doc(id){ return docRef(q.path+"/"+id); },
      add:ro
    };
  }
  function docRef(path){
    return { id:path.split("/").pop(), path,
      async get(){ await load(); return snapDoc(path.split("/").pop(), bundle&&bundle.docs?bundle.docs[path]:undefined); },
      onSnapshot(next){ const l={kind:"d",path,next}; listeners.push(l); load().then(ok=>{ if(ok) emit(l); }); return ()=>{ const i=listeners.indexOf(l); if(i>=0) listeners.splice(i,1); }; },
      set:ro, update:ro, delete:ro, collection(p){ return query({path:path+"/"+p}); } };
  }
  const DB={ collection:p=> String(p).startsWith("data/users/") ? window.TD_VAULT.collection() : query({path:p}), doc:docRef };
  window.claude={ use: async n => n==="db" ? DB : null };
  /* pick up the daily update when the app comes back to the foreground */
  document.addEventListener("visibilitychange", async ()=>{
    if(document.visibilityState!=="visible" || Date.now()-loadedAt < 10*60*1000) return;
    const before=bundle&&bundle.generated_at;
    if(await load() && bundle.generated_at!==before) listeners.slice().forEach(emit);
  });
})();
</script>"""

READONLY_CSS = """
/* static (GitHub Pages) build: read-only */
[data-act],[data-pact],#predform{display:none!important}
#td-banner{position:relative;z-index:20;background:var(--down);color:var(--accent-ink);padding:10px 16px;font-size:14px;text-align:center}
"""

HEAD = f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="매일 아침 세계 정세, 지표, 큰 이야기, 트렌드 장부를 정리하는 트렌드 데스크">
<meta name="theme-color" content="#F2F4F2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0F1413" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="트렌드 데스크">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="robots" content="noindex,nofollow">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
{links}
<style>
html{{color-scheme:light;-webkit-text-size-adjust:100%}}
:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}
body{{margin:0;font:14px/1.5 system-ui,-apple-system,sans-serif}}
img{{max-width:100%}}
{style}
{READONLY_CSS}
</style>
</head>
<body>
"""

html = HEAD + SHIM + "\n" + body + "<script>" + script + "</script>\n</body>\n</html>\n"
open(out, "w", encoding="utf-8").write(html)
print("wrote", out, len(html), "bytes")
