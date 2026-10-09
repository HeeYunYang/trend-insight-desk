"""Private vault tools (same format as vault.js). Passphrase comes from the VAULT_PASS env var.

  python3 scripts/vault.py init  private/vault.json
  python3 scripts/vault.py dump  private/vault.json                      # prints plaintext JSON
  python3 scripts/vault.py merge private/vault.json <db_dir> <writes.json>

merge: <db_dir> holds the Claude page's private entries, one JSON file per document
(an ArtifactData dump of data/users/me). The union of both sides is computed per entry id,
keeping the copy with the later `updated`. The vault file is rewritten only if it changed;
<writes.json> receives the ArtifactData batch writes needed to bring the Claude side up to
date (empty list when nothing changed). Exit code 0 on success.
"""
import base64, datetime, glob, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITER = 600_000
KINDS = {"insight", "signal"}

def _key(pw, salt, it):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=it).derive(pw.encode())

def _pw():
    pw = os.environ.get("VAULT_PASS", "")
    if not pw:
        sys.exit("VAULT_PASS is not set")
    return pw

def seal(data, pw, salt, it=ITER):
    iv = os.urandom(12)
    ct = AESGCM(_key(pw, salt, it)).encrypt(iv, json.dumps(data, ensure_ascii=False).encode(), None)
    b = lambda x: base64.b64encode(x).decode()
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": it, "salt": b(salt), "iv": b(iv), "ct": b(ct)}

def unseal(f, pw):
    assert f.get("v") == 1, "unknown vault version"
    k = _key(pw, base64.b64decode(f["salt"]), f["iter"])
    d = json.loads(AESGCM(k).decrypt(base64.b64decode(f["iv"]), base64.b64decode(f["ct"]), None))
    if not isinstance(d.get("entries"), dict):
        d["entries"] = {}
    return d

def _ts(s):
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0

def _write(path, f):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(f, fh, indent=1)
    os.replace(tmp, path)

def main():
    cmd, path = sys.argv[1], sys.argv[2]
    pw = _pw()
    if cmd == "init":
        if os.path.exists(path):
            unseal(json.load(open(path)), pw)          # refuses to overwrite a vault with another passphrase
            print("vault exists and opens with this passphrase"); return
        _write(path, seal({"entries": {}, "updated": datetime.datetime.utcnow().isoformat() + "Z"}, pw, os.urandom(16)))
        print("created", path); return
    f = json.load(open(path))
    data = unseal(f, pw)
    if cmd == "dump":
        print(json.dumps(data, ensure_ascii=False, indent=1)); return
    if cmd == "merge":
        db_dir, writes_out = sys.argv[3], sys.argv[4]
        db = {}
        for p in glob.glob(os.path.join(db_dir, "**", "*.json"), recursive=True):
            d = json.load(open(p, encoding="utf-8"))
            if isinstance(d, dict) and d.get("kind") in KINDS:
                db[os.path.basename(p)[:-5]] = d
        vault = data["entries"]
        writes, vault_changed = [], False
        for i in sorted(set(db) | set(vault)):
            a, b = db.get(i), vault.get(i)
            if a is not None and (b is None or _ts(a.get("updated")) > _ts(b.get("updated"))):
                vault[i] = a; vault_changed = True
            elif b is not None and (a is None or _ts(b.get("updated")) > _ts(a.get("updated"))):
                writes.append({"op": "set", "collection": "data/users/me", "doc_id": i, "data": b})
        if vault_changed:
            data["updated"] = datetime.datetime.utcnow().isoformat() + "Z"
            _write(path, seal(data, pw, base64.b64decode(f["salt"]), f["iter"]))
        json.dump(writes, open(writes_out, "w", encoding="utf-8"), ensure_ascii=False)
        print(json.dumps({"vault_changed": vault_changed, "db_writes": len(writes), "entries": len(vault)}))
        return
    sys.exit("unknown command " + cmd)

if __name__ == "__main__":
    main()
