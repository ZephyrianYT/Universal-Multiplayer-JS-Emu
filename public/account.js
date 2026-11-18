// Local accounts: an Ed25519 key pair (TweetNaCl) kept only in this browser's IndexedDB.
// Signing in = sign the server's one-time challenge; the server checks it and sets a session cookie.
// Needs /vendor/nacl-fast.min.js loaded first (global `nacl`).
(function () {
  "use strict";
  const DB_NAME = "retro-hub", STORE = "accounts", CURRENT = "rh-current-account";

  const b64u = {
    enc(bytes) {
      let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    },
    dec(str) {
      const s = atob(String(str).replace(/-/g, "+").replace(/_/g, "/"));
      const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    },
  };
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  // Same as the server: first 16 hex chars of SHA-512 over the raw public key.
  const accountId = pub => hex(nacl.hash(pub)).slice(0, 16).toUpperCase();
  const prettyId = id => String(id || "").replace(/(.{4})(?=.)/g, "$1-");

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("This browser blocked local storage (IndexedDB)."));
    });
  }
  async function tx(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
      let result; const r = fn(st);
      if (r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => { db.close(); resolve(result); };
      t.onerror = t.onabort = () => { db.close(); reject(t.error); };
    });
  }

  const cleanName = n => String(n || "").replace(/[\x00-\x1f<>]/g, "").trim().slice(0, 20);
  function fromSecret(secretKey, name, created) {
    const kp = nacl.sign.keyPair.fromSecretKey(secretKey);
    return { id: accountId(kp.publicKey), name: cleanName(name) || "Player", pub: b64u.enc(kp.publicKey),
      secret: b64u.enc(kp.secretKey), created: created || Date.now() };
  }

  const Accounts = {
    list: () => tx("readonly", st => st.getAll()).then(a => (a || []).sort((x, y) => x.created - y.created)),
    get: id => tx("readonly", st => st.get(id)),
    save: acct => tx("readwrite", st => st.put(acct)),
    remove: id => tx("readwrite", st => st.delete(id)),
    async create(name) {
      const acct = fromSecret(nacl.sign.keyPair().secretKey, name);
      await Accounts.save(acct);
      return acct;
    },
    async rename(id, name) {
      const a = await Accounts.get(id); if (!a) return null;
      a.name = cleanName(name) || a.name; await Accounts.save(a); return a;
    },
    // Checks a stored account without contacting the server.
    // { ok } | { ok:false, fixed } (repairable: the ID/public key are rebuilt from the secret key) | { ok:false, reason } (unusable).
    check(a) {
      if (!a || typeof a !== "object") return { ok: false, reason: "the saved data is empty" };
      let sk;
      try { sk = b64u.dec(a.secret); } catch { sk = null; }
      if (!sk || sk.length !== 64) return { ok: false, reason: "its key is missing or damaged" };
      let kp;
      try { kp = nacl.sign.keyPair.fromSecretKey(sk); } catch { return { ok: false, reason: "its key is damaged" }; }
      const pub = b64u.enc(kp.publicKey), id = accountId(kp.publicKey), name = cleanName(a.name) || "Player";
      if (pub !== a.pub || id !== a.id || name !== a.name || !Number.isFinite(a.created))
        return { ok: false, fixed: { id, name, pub, secret: b64u.enc(kp.secretKey), created: Number.isFinite(a.created) ? a.created : Date.now() } };
      return { ok: true };
    },
    // Saves a repaired account; if its ID changed, the old record goes and "current" follows it.
    async repair(old, fixed) {
      await Accounts.save(fixed);
      if (old.id !== fixed.id) {
        await Accounts.remove(old.id);
        if (Accounts.current() === old.id) Accounts.setCurrent(fixed.id);
      }
      return fixed;
    },
    // Last resort when the browser's account store itself can't be opened.
    resetAll() {
      return new Promise((resolve, reject) => {
        const r = indexedDB.deleteDatabase(DB_NAME);
        r.onsuccess = () => { Accounts.setCurrent(null); resolve(); };
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error("Close other Retro Hub tabs first, then try again."));
      });
    },
    current() { try { return localStorage.getItem(CURRENT); } catch { return null; } },
    setCurrent(id) { try { id ? localStorage.setItem(CURRENT, id) : localStorage.removeItem(CURRENT); } catch {} },

    // Backup file: the secret key is the whole account. Anyone with this file IS this account.
    exportBlob(acct) {
      const data = { type: "retro-hub-account", v: 1, name: acct.name, id: acct.id, secretKey: acct.secret, created: acct.created };
      return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    },
    download(acct) {
      const url = URL.createObjectURL(Accounts.exportBlob(acct));
      const a = document.createElement("a");
      a.href = url; a.download = `retro-hub-${acct.name.replace(/[^\w-]+/g, "_")}-${acct.id.slice(0, 4)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
    async importFile(file) {
      if (file.size > 10000) throw new Error("That is not a Retro Hub account file.");
      let data; try { data = JSON.parse(await file.text()); } catch { throw new Error("That is not a Retro Hub account file."); }
      if (!data || data.type !== "retro-hub-account" || typeof data.secretKey !== "string") throw new Error("That is not a Retro Hub account file.");
      let sk; try { sk = b64u.dec(data.secretKey); } catch { sk = null; }
      if (!sk || sk.length !== 64) throw new Error("This account file is damaged.");
      const acct = fromSecret(sk, data.name, data.created);
      await Accounts.save(acct);
      return acct;
    },

    // Key handshake with the server. Throws an Error with .code === "access" if the access code is needed/wrong.
    async signIn(acct, accessCode) {
      const c = Accounts.check(acct);
      if (!c.ok && !c.fixed) { const e = new Error(`This account can't be used: ${c.reason}.`); e.code = "damaged"; throw e; }
      if (c.fixed) acct = await Accounts.repair(acct, c.fixed);
      let ch;
      try { ch = await fetch("/api/challenge", { cache: "no-store" }).then(r => r.json()); }
      catch { throw new Error("Can't reach the Retro Hub server. Is it running?"); }
      if (!ch.nonce) throw new Error(ch.error || "The server did not answer.");
      if (ch.accessCode && !accessCode) { const e = new Error("This server needs an access code."); e.code = "access"; throw e; }
      const msg = new TextEncoder().encode(`retro-hub-login\n${ch.nonce}`);
      const sig = nacl.sign.detached(msg, b64u.dec(acct.secret));
      const r = await fetch("/api/hello", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: acct.name, pub: acct.pub, nonce: ch.nonce, sig: b64u.enc(sig), access: accessCode || "" }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(res.error || "Sign-in failed."); e.code = res.code; throw e; }
      Accounts.setCurrent(acct.id);
      return res;
    },
    async signOut() {
      await fetch("/api/logout", { method: "POST" }).catch(() => {});
    },
  };

  window.RH = Object.assign(window.RH || {}, { Accounts, b64u, prettyId, accountId });
})();
