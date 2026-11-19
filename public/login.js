(function () {
  "use strict";
  const { Accounts, prettyId } = window.RH;
  const $ = id => document.getElementById(id);
  const sections = ["busy", "pick", "make", "access"];
  const show = id => sections.forEach(s => { $(s).hidden = s !== id; });
  const err = text => { $("error").textContent = text || ""; $("error").hidden = !text; };

  // Only same-site paths are allowed as a return address.
  function nextUrl() {
    const n = new URLSearchParams(location.search).get("next") || "/";
    // Same-site paths only: resolve it, then keep it only if it stays on this hub.
    let u; try { u = new URL(n, location.origin); } catch { return "/"; }
    if (u.origin !== location.origin || !n.startsWith("/") || u.pathname.startsWith("/login.html")) return "/";
    return u.pathname + u.search + u.hash;
  }

  let pending = null; // account waiting for the access code

  async function signIn(acct, access) {
    err(""); show("busy"); $("busy-text").textContent = `Signing in as ${acct.name}…`;
    try {
      await Accounts.signIn(acct, access);
      location.replace(nextUrl());
    } catch (e) {
      if (e.code === "access") {
        pending = acct; show("access");
        if (access) err(e.message);
        $("access-code").focus();
        return;
      }
      // Don't retry this account automatically on the next visit: show the list so another one can be picked or removed.
      if (Accounts.current() === acct.id) Accounts.setCurrent(null);
      err(`Couldn't sign in as ${acct.name}. ${e.message || "Sign-in failed."}` +
        (e.code === "damaged" ? " Remove it below, then import a backup or make a new account." : ""));
      await renderPick();
    }
  }

  // Removing deletes the key from this browser for good; without a backup file the account can't come back.
  async function removeAccount(a, damaged) {
    const msg = damaged
      ? `Remove the damaged account "${a.name || "?"}" from this browser?`
      : `Remove "${a.name}" (#${prettyId(a.id)}) from this browser?\n\n` +
        `This can't be undone. Without a backup file (the ⤓ button) the account is gone for good: ` +
        `nobody can sign in as it again. Its game saves on this computer are not deleted.`;
    if (!confirm(msg)) return;
    await Accounts.remove(a.id);
    if (Accounts.current() === a.id) Accounts.setCurrent(null);
    err("");
    await renderPick();
  }

  async function renderPick() {
    let accts;
    try { accts = await Accounts.list(); }
    catch (e) { return storageBroken(e); }
    // Fix accounts whose saved ID or name doesn't match their key (older or damaged records).
    for (let i = 0; i < accts.length; i++) {
      const c = Accounts.check(accts[i]);
      if (c.fixed) { try { accts[i] = await Accounts.repair(accts[i], c.fixed); } catch {} }
    }
    const ul = $("acct-list"); ul.textContent = "";
    // No accounts yet: nothing to go back to, so no Back button (it only re-showed this same form).
    $("make-back").hidden = !accts.length;
    if (!accts.length) { $("make-title").textContent = "Make an account"; show("make"); $("name").focus(); return; }
    for (const a of accts) {
      const c = Accounts.check(a), damaged = !c.ok;
      const li = document.createElement("li"); li.tabIndex = 0;
      li.classList.toggle("damaged", damaged);
      li.innerHTML = `<div class="grow"><div class="title"></div><div class="id"></div></div>
        ${damaged ? "" : `<button class="small icon" data-act="export" title="Download a backup of this account" aria-label="Download a backup">⤓</button>`}
        <button class="small icon" data-act="remove" title="Remove from this browser" aria-label="Remove account">🗑</button>
        ${damaged ? "" : `<button class="primary small" data-act="play">Play</button>`}`;
      li.querySelector(".title").textContent = a.name || "(no name)";
      li.querySelector(".id").textContent = damaged ? `Damaged: ${c.reason}` : "#" + prettyId(a.id);
      const go = () => { if (!damaged) signIn(a); };
      li.addEventListener("click", e => {
        const act = e.target.closest("button")?.dataset.act;
        if (act === "remove") return removeAccount(a, damaged);
        if (act === "export") return Accounts.download(a);
        go();
      });
      li.addEventListener("keydown", e => {
        if (e.target !== li) return;
        if (e.key === "Enter") go();
        if (e.key === "Delete") removeAccount(a, damaged);
      });
      ul.appendChild(li);
    }
    const add = document.createElement("li");
    add.tabIndex = 0;
    add.innerHTML = `<div class="grow"><div class="title">+ New account</div><div class="sub">For another player on this computer, or to start fresh</div></div>`;
    const open = () => { err(""); $("make-title").textContent = "New account"; show("make"); $("name").focus(); };
    add.addEventListener("click", open);
    add.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
    ul.appendChild(add);
    show("pick");
  }

  // The browser refused to open the account store (blocked storage, or data from an incompatible version).
  function storageBroken(e) {
    err(`This browser can't open its saved Retro Hub accounts (${e?.message || e}).`);
    $("reset-wrap").hidden = false;
    show("make");
  }
  $("reset-btn").addEventListener("click", async () => {
    if (!confirm("Delete every Retro Hub account saved in this browser?\n\nThis can't be undone. Accounts without a backup file are gone for good.")) return;
    try { await Accounts.resetAll(); err(""); $("reset-wrap").hidden = true; await renderPick(); }
    catch (e) { err(e.message || "Couldn't reset the accounts."); }
  });

  $("make-form").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("name").value.trim();
    if (!name) return;
    try { signIn(await Accounts.create(name)); } catch (ex) { err(ex.message); }
  });
  $("import-btn").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async () => {
    const f = $("import-file").files[0]; $("import-file").value = "";
    if (!f) return;
    try { signIn(await Accounts.importFile(f)); } catch (ex) { err(ex.message); }
  });
  $("access-form").addEventListener("submit", e => {
    e.preventDefault();
    if (pending) signIn(pending, $("access-code").value);
  });
  $("access-back").addEventListener("click", () => { err(""); pending = null; renderPick(); });
  $("make-back").addEventListener("click", () => { err(""); renderPick(); });

  (async () => {
    try {
      const id = Accounts.current();
      const acct = id && await Accounts.get(id);
      if (acct) return signIn(acct);
      await renderPick();
    } catch (e) {
      storageBroken(e);
    }
  })();
})();
