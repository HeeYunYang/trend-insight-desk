/* 트렌드 데스크 · 개인 금고 (내 인사이트, 현장 신호)
 * The vault file private/vault.json holds only ciphertext:
 *   {v:1, kdf:"PBKDF2-SHA256", iter, salt, iv, ct}   (base64; AES-256-GCM, tag appended to ct)
 * Plaintext: {entries:{<id>:{kind,text,...,updated}}, updated}
 * Reading needs only the passphrase. Writing goes through the GitHub contents API with a
 * fine-grained token that is stored on this device encrypted with the vault key.
 */
(function(){
  const CFG = Object.assign((() => {
    const host = location.hostname, seg = location.pathname.split("/").filter(Boolean)[0] || "";
    const owner = host.endsWith(".github.io") ? host.split(".")[0] : "";
    return { owner, repo: seg, branch: "main", path: "private/vault.json", api: "https://api.github.com" };
  })(), window.TD_CONFIG || {});
  const TOKEN_KEY = "td-vault-token-v1";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => { const b = new Uint8Array(buf); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => { const bin = atob(String(s).replace(/\s+/g, "")); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; };
  const utf8b64 = str => b64(enc.encode(str));
  const b64utf8 = s => dec.decode(unb64(s));

  async function deriveKey(pass, salt, iter){
    const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function seal(key, obj){ const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj))); return { iv: b64(iv), ct: b64(ct) }; }
  async function open_(key, box){ const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct)); return JSON.parse(dec.decode(pt)); }

  const V = {
    unlocked: false, onUnlock: null,
    _key: null, _file: null, _sha: null, _token: null, _data: { entries: {} }, _listeners: [],
    canWrite(){ return !!this._token; },
    async _fetchPublic(){
      const r = await fetch(CFG.path + "?t=" + Date.now(), { cache: "no-store" });
      if (r.status === 404) throw new Error("금고가 아직 만들어지지 않았습니다. 잠시 후 다시 시도해 주세요.");
      if (!r.ok) throw new Error("금고를 불러오지 못했습니다 (" + r.status + ")");
      return { file: await r.json(), sha: null };
    },
    async _fetchApi(token){
      const r = await fetch(`${CFG.api}/repos/${CFG.owner}/${CFG.repo}/contents/${CFG.path}?ref=${CFG.branch}&t=${Date.now()}`, { headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" }, cache: "no-store" });
      if (r.status === 401 || r.status === 403) { const e = new Error("GitHub 토큰이 거부됐습니다. 토큰 권한(Contents 읽기·쓰기)과 만료일을 확인해 주세요."); e.auth = true; throw e; }
      if (r.status === 404) throw new Error("GitHub에서 금고 파일을 찾지 못했습니다. 토큰이 이 저장소를 가리키는지 확인해 주세요.");
      if (!r.ok) throw new Error("GitHub 응답 오류 (" + r.status + ")");
      const j = await r.json();
      return { file: JSON.parse(b64utf8(j.content)), sha: j.sha };
    },
    async unlock(pass){
      if (!pass) throw new Error("암호를 입력해 주세요.");
      if (/^(github_pat_|ghp_)/.test(pass.trim())) throw new Error("여기는 금고 암호 칸입니다. GitHub 토큰은 금고를 연 다음 나오는 'GitHub 토큰' 칸에 넣어 주세요.");
      const { file } = await this._fetchPublic();
      if (!file || file.v !== 1 || !file.salt) throw new Error("금고 파일 형식이 올바르지 않습니다.");
      const key = await deriveKey(pass, unb64(file.salt), file.iter);
      let data;
      try { data = await open_(key, file); } catch (e) { throw new Error("암호가 맞지 않습니다."); }
      this._key = key; this._file = file; this._data = normalize(data);
      // device token (encrypted with the vault key)
      this._token = null;
      try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); if (t) this._token = (await open_(key, t)).token; } catch (e) { /* stale or foreign token: ignore */ }
      if (this._token) { try { const f = await this._fetchApi(this._token); this._sha = f.sha; this._data = normalize(await open_(key, f.file)); this._file = f.file; } catch (e) { if (e.auth) this._token = null; console.warn(e); } }
      this.unlocked = true; this._emit();
      if (this.onUnlock) this.onUnlock();
    },
    lock(){ this.unlocked = false; this._key = null; this._token = null; this._data = { entries: {} }; this._sha = null; },
    forgetToken(){ this._token = null; try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} },
    async setToken(token){
      if (!this.unlocked) throw new Error("먼저 금고를 열어 주세요.");
      if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) throw new Error("GitHub 토큰 형식이 아닙니다 (github_pat_로 시작).");
      const f = await this._fetchApi(token);
      await open_(this._key, f.file);                      // proves token + passphrase match this vault
      this._token = token; this._sha = f.sha; this._file = f.file; this._data = normalize(await open_(this._key, f.file));
      try { localStorage.setItem(TOKEN_KEY, JSON.stringify(await seal(this._key, { token }))); } catch (e) { /* private mode: token lives for this visit only */ }
      this._emit();
    },
    /* apply one mutation to the freshest copy on GitHub; retry on conflicts */
    async _mutate(fn){
      if (!this.unlocked) throw new Error("금고가 잠겨 있습니다.");
      if (!this._token) throw new Error("이 기기에서 기록하려면 먼저 GitHub 토큰을 등록해 주세요.");
      for (let attempt = 0; attempt < 4; attempt++) {
        const f = await this._fetchApi(this._token);
        const data = normalize(await open_(this._key, f.file));
        fn(data);
        data.updated = new Date().toISOString();
        const box = await seal(this._key, data);
        const file = { v: 1, kdf: "PBKDF2-SHA256", iter: f.file.iter, salt: f.file.salt, iv: box.iv, ct: box.ct };
        const r = await fetch(`${CFG.api}/repos/${CFG.owner}/${CFG.repo}/contents/${CFG.path}`, {
          method: "PUT", headers: { Authorization: "Bearer " + this._token, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
          body: JSON.stringify({ message: "vault: update from web", content: utf8b64(JSON.stringify(file, null, 1)), sha: f.sha, branch: CFG.branch })
        });
        if (r.status === 409 || r.status === 422) { await new Promise(res => setTimeout(res, 400 + Math.random() * 600)); continue; }
        if (r.status === 401 || r.status === 403) throw new Error("GitHub 토큰에 쓰기 권한이 없습니다.");
        if (!r.ok) throw new Error("저장하지 못했습니다 (GitHub " + r.status + ").");
        const j = await r.json();
        this._sha = j.content && j.content.sha; this._file = file; this._data = data; this._emit();
        return;
      }
      throw new Error("다른 기기와 동시에 저장되어 충돌했습니다. 다시 시도해 주세요.");
    },
    _docs(){ return Object.entries(this._data.entries).map(([id, d]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(d)), metadata: { fromCache: false, hasPendingWrites: false } })); },
    _emit(){ const snap = { docs: this._docs(), docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; snap.size = snap.docs.length; snap.empty = !snap.size; this._listeners.forEach(l => { try { l(snap); } catch (e) { console.error(e); } }); },
    collection(){
      const self = this;
      return {
        onSnapshot(cb){ self._listeners.push(cb); if (self.unlocked) setTimeout(() => self._emit(), 0); return () => { const i = self._listeners.indexOf(cb); if (i >= 0) self._listeners.splice(i, 1); }; },
        orderBy(){ return this; }, limit(){ return this; },
        doc(id){ return {
          set: data => self._mutate(d => { d.entries[id] = clean(data); }),
          update: data => self._mutate(d => { if (!d.entries[id]) throw new Error("이미 삭제된 기록입니다."); d.entries[id] = clean({ ...d.entries[id], ...data }); })
        }; }
      };
    }
  };
  function clean(o){ const out = {}; for (const [k, v] of Object.entries(o || {})) if (v !== undefined) out[k] = v; return out; }
  function normalize(d){ d = d && typeof d === "object" ? d : {}; if (!d.entries || typeof d.entries !== "object" || Array.isArray(d.entries)) d.entries = {}; return d; }
  window.TD_VAULT = V;
})();
