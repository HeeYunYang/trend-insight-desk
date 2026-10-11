"""Permanent brief archive for the static site (kept in git, never pruned).

data/archive/briefs/<date>.json  full brief, written once and rewritten only if it changed
data/archive/<year>.json          light search index for that year (one entry per day)
data/archive/index.json           list of years

The Claude page keeps only ~90 days of briefs; this archive keeps everything.
"""
import json, os, glob, datetime

def _short(s, n):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"

def entry(b):
    """Small search record for one brief (works for the old and the v2 layout)."""
    e = {"date": b["date"], "headline": _short(b.get("headline"), 140), "deep": [], "news": [], "watch": []}
    for d in b.get("deep_issues") or []:
        e["deep"].append({"q": _short(d.get("q"), 90), "c": _short(d.get("conclusion"), 300),
                          "t": " / ".join(_short(x.get("title"), 60) for x in (d.get("disputes") or [])),
                          "b": _short(d.get("built"), 300),
                          "issue": d.get("issue", ""), "theme": d.get("theme", "")})
    if not b.get("deep_issues"):
        for d in b.get("deep") or []:
            e["deep"].append({"q": _short(d.get("title"), 120), "c": _short(d.get("fact"), 300), "t": "", "b": _short(d.get("context"), 300), "issue": "", "theme": ""})
    for s in (b.get("selected") or b.get("items") or [])[:15]:
        e["news"].append({"t": _short(s.get("title"), 100), "u": s.get("url", ""), "f": s.get("field", "")})
    for w in ((b.get("watch") or {}).get("fired") or []):
        e["watch"].append({"id": w.get("id", ""), "t": _short(w.get("text"), 160), "u": w.get("url", "")})
    return e

def write(briefs, root="data/archive"):
    bdir = os.path.join(root, "briefs")
    os.makedirs(bdir, exist_ok=True)
    wrote = 0
    for b in briefs:
        if not b.get("date"):
            continue
        doc = {k: v for k, v in b.items() if k not in ("id", "synced")}
        txt = json.dumps(doc, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        p = os.path.join(bdir, b["date"] + ".json")
        if os.path.exists(p) and open(p, encoding="utf-8").read() == txt:
            continue
        with open(p, "w", encoding="utf-8") as f:
            f.write(txt)
        wrote += 1
    # rebuild the yearly search indexes from every archived brief
    years = {}
    for p in sorted(glob.glob(os.path.join(bdir, "*.json"))):
        try:
            b = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        years.setdefault(b["date"][:4], []).append(entry(b))
    idx = []
    for y, es in sorted(years.items()):
        es.sort(key=lambda e: e["date"], reverse=True)
        with open(os.path.join(root, y + ".json"), "w", encoding="utf-8") as f:
            json.dump({"year": y, "entries": es}, f, ensure_ascii=False, separators=(",", ":"))
        idx.append({"year": y, "days": len(es), "first": es[-1]["date"], "last": es[0]["date"]})
    idx.sort(key=lambda r: r["year"], reverse=True)
    with open(os.path.join(root, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.date.today().isoformat(), "years": idx}, f, ensure_ascii=False)
    return wrote, sum(r["days"] for r in idx)
