"""Turn an ArtifactData dump (one JSON file per document) into data/bundle.json.

Usage: python3 scripts/build_bundle.py <dump_dir> <out_json> [--with-signals]
<dump_dir>/<collection>/<doc_id>.json  -> collections[<collection>]
<dump_dir>/meta/<doc_id>.json          -> docs["meta/<doc_id>"]
"""
import json, os, sys, glob, datetime
dump, out = sys.argv[1], sys.argv[2]
with_signals = "--with-signals" in sys.argv
COLLECTIONS = ["briefs", "stories", "indicators", "trends", "slow_vars", "predictions"] + (["field_signals"] if with_signals else [])
META_DOCS = ["indicator_groups", "indicators_day"]

def read(p):
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    if not isinstance(d, dict):
        raise ValueError(f"{p}: not an object")
    return d

bundle = {"generated_at": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-7))).isoformat(timespec="minutes"),
          "collections": {}, "docs": {}}
for c in COLLECTIONS:
    rows = []
    for p in sorted(glob.glob(os.path.join(dump, c, "*.json"))):
        d = read(p)
        d.pop("id", None)
        rows.append({"id": os.path.basename(p)[:-5], **d})
    bundle["collections"][c] = rows
for m in META_DOCS:
    p = os.path.join(dump, "meta", m + ".json")
    if os.path.exists(p):
        bundle["docs"]["meta/" + m] = read(p)

# sanity checks: fail loudly instead of publishing a broken bundle
assert bundle["collections"]["indicators"], "no indicators in dump"
assert bundle["collections"]["briefs"], "no briefs in dump"
for b in bundle["collections"]["briefs"]:
    assert "date" in b and isinstance(b.get("items", []), list), f"bad brief {b.get('id')}"
for x in bundle["collections"]["indicators"]:
    s = x.get("series", {})
    assert isinstance(s, dict), f"bad series {x['id']}"
    if "value" in s and "main" not in s:          # tolerate the old key name
        s["main"] = s.pop("value")
    for k, pts in list(s.items()):
        if not isinstance(pts, list):
            s.pop(k); continue
        s[k] = sorted({p[0]: p for p in pts if isinstance(p, list) and len(p) == 2 and isinstance(p[1], (int, float))}.values())

os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
tmp = out + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
os.replace(tmp, out)
print("bundle:", {k: len(v) for k, v in bundle["collections"].items()}, "docs:", list(bundle["docs"]), os.path.getsize(out), "bytes")
