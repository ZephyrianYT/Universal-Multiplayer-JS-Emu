// Retro Hub: hub page (hosts list, host form, library), the room lobby (ready-up, rules, voice, countdown)
// and the in-game view (loading board, host emulator / guest stream).
(function () {
  "use strict";
  const { Accounts, prettyId, Input, Net, UI, Voice, Calibrate, Ghost, Saves, Native, Race, RA, Cheats } = window.RH;
  const { Settings, Modal, guard, toast, Sfx, pingClass, pingLabel } = UI;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = n => { n = Number(n); return Number.isFinite(n) ? n : 0; };   // counts from other hubs: never raw text in HTML
  // Only plain http(s) links from other hubs are ever opened or put in an href.
  const safeHttp = u => { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:" ? x.href : null; } catch { return null; } };
  const wsUrl = () => (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
  const fmtSize = n => n > 1 << 20 ? (n / (1 << 20)).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  const showErr = (el, text) => { el.textContent = text || ""; el.hidden = !text; };
  // Invite links use the hub's public address (PUBLIC_URL, e.g. a Cloudflare tunnel) when the server has one.
  const LOCAL_HOST_RE = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;
  const inviteBase = () => (config && config.publicUrl) || location.origin;
  const inviteLink = code => `${inviteBase()}/?join=${code}`;
  // A link built from localhost only works on this computer: say so instead of a cheerful "Copied!".
  function copyInvite(code, label) {
    const link = inviteLink(code);
    if (LOCAL_HOST_RE.test(new URL(link).hostname)) {
      return UI.copy(link, "Copied, but a localhost link only works on this PC")
        .then(() => UI.toast("Friends elsewhere need a public address: start the hub with the Internet (Cloudflare Tunnel) option in the Retro Hub window (or set PUBLIC_URL).", { kind: "bad", ms: 6000 }));
    }
    return UI.copy(link, label);
  }
  const GHOST_TIP = "Each player runs their own local ROM independently. Other players appear as 60% translucent ghosts\u2014no collisions, shared items, or game interference.";
  // "race" is Single-Player Ghost plus the race / speedrun timer (public/race.js), so it counts as ghost here.
  const hostModeRaw = () => document.querySelector("input[name=mode]:checked")?.value || "coop";
  const hostMode = () => ["ghost", "race"].includes(hostModeRaw()) ? "ghost" : "coop";
  const hostShuffle = () => hostModeRaw() === "shuffle";      // Co-op with several games (shuffler-core.js)
  const hostRace = () => hostModeRaw() === "race";

  let me = null, config = null;

  // ---------------------------------------------------------------- keyboard shortcuts list (? or the ⌨ button)
  // shortcutCtx is filled in by the room: { system, inGame, canSave, ghost } so the list only shows what applies.
  let shortcutCtx = null;
  $("keys-btn").addEventListener("click", openShortcuts);
  $("ra-btn").addEventListener("click", () => RA.openSettings());
  // Small screens: the less-used top-bar buttons fold into ☰ (style.css hides .tb-more below 700 px).
  $("tb-menu").addEventListener("click", () => {
    const open = document.querySelector(".topbar").classList.toggle("menu-open");
    $("tb-menu").setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll(".topbar .tb-more").forEach(b => b.addEventListener("click", () => {
    document.querySelector(".topbar").classList.remove("menu-open"); $("tb-menu").setAttribute("aria-expanded", "false");
  }));
  $("keys-close").addEventListener("click", () => Modal.close($("keys-dlg")));

  // ---------------------------------------------------------------- 🎨 themes (public/theme.js applies them)
  function renderThemes() {
    const T = window.RH.Theme, cur = T.current();
    $("theme-grid").innerHTML = T.list.map(t => `<button type="button" class="theme-card" role="radio" data-theme-id="${esc(t.id)}"
        aria-checked="${t.id === cur}" tabindex="${t.id === cur ? 0 : -1}">
      <span class="theme-sw" aria-hidden="true">${t.sw.map(c => `<span style="background:${esc(c)}"></span>`).join("")}</span>
      <b>${esc(t.name)}</b><span class="muted">${esc(t.desc)}</span></button>`).join("");
  }
  // ✏️ Custom theme editor (under the cards). Edits are saved as they happen and shown live.
  function renderEditor() {
    const T = window.RH.Theme, on = T.current() === "custom";
    $("theme-edit").hidden = !on; $("theme-make").hidden = on;
    if (!on) return;
    const c = T.custom();
    for (const inp of $("theme-edit").querySelectorAll("[data-te]")) inp.value = String(c[inp.dataset.te]);
    const bg = T.customBg();
    $("te-bg-state").textContent = bg ? "set" : "none";
    $("te-bg-clear").hidden = !bg; $("theme-edit").querySelector(".te-dim").hidden = !bg;
  }
  function teRead() {
    const c = {}; for (const inp of $("theme-edit").querySelectorAll("[data-te]")) c[inp.dataset.te] = inp.value;
    return c;
  }
  function teSave(bgImg) {
    const r = window.RH.Theme.saveCustom(teRead(), bgImg);
    $("te-warn").hidden = r.ok; $("te-warn").textContent = r.ok ? "" : r.msg;
    renderThemes(); renderEditor();
  }
  $("theme-make").addEventListener("click", () => {
    const T = window.RH.Theme;
    T.saveCustom(T.snapshot()); renderThemes(); renderEditor();
    $("theme-edit").querySelector("[data-te]")?.focus();
  });
  $("theme-edit").addEventListener("input", e => { if (e.target.dataset.te) window.RH.Theme.apply("custom", teRead()); });
  $("theme-edit").addEventListener("change", e => { if (e.target.dataset.te) teSave(); });
  $("te-bg-pick").addEventListener("click", () => $("te-bg-file").click());
  $("te-bg-clear").addEventListener("click", () => teSave(""));
  $("te-bg-file").addEventListener("change", async () => {
    const f = $("te-bg-file").files[0]; $("te-bg-file").value = "";
    if (!f || !/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return;
    if (f.size > 40e6) return toast("That picture is over 40 MB.", { kind: "bad" });
    // Shrink to at most 1920x1200 as a JPEG so it fits in browser storage (a few hundred KB).
    try {
      const bmp = await createImageBitmap(f);
      const s = Math.min(1, 1920 / bmp.width, 1200 / bmp.height);
      const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
      teSave(cv.toDataURL("image/jpeg", .82));
    } catch { toast("Couldn't read that picture.", { kind: "bad" }); }
  });
  $("te-copy").addEventListener("click", async () => {
    const code = window.RH.Theme.exportCode();
    try { await navigator.clipboard.writeText(code); toast("Share code copied. Background pictures aren't included.", { kind: "ok", ms: 3000 }); }
    catch { $("te-code").value = code; $("te-code").select(); toast("Copy the code from the box.", { ms: 3000 }); }
  });
  $("te-paste").addEventListener("click", () => {
    const c = window.RH.Theme.importCode($("te-code").value);
    if (!c) return toast("That isn't a Retro Hub theme code.", { kind: "bad", ms: 3000 });
    window.RH.Theme.saveCustom(c); $("te-code").value = ""; renderThemes(); renderEditor();
    toast("Theme applied.", { kind: "ok", ms: 2000 });
  });
  $("te-code").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("te-paste").click(); } });
  $("te-reset").addEventListener("click", () => {
    if (!confirm("Reset your custom theme to the default colors and remove its picture?")) return;
    window.RH.Theme.saveCustom(window.RH.Theme.defaults, ""); renderThemes(); renderEditor();
  });
  $("theme-btn").addEventListener("click", () => {
    if (!window.RH.Theme) return;
    renderThemes(); renderEditor();
    Modal.open($("theme-dlg"), { focus: '.theme-card[aria-checked="true"]' });
  });
  $("theme-grid").addEventListener("click", e => {
    const b = e.target.closest("[data-theme-id]"); if (!b) return;
    window.RH.Theme.choose(b.dataset.themeId); renderThemes(); renderEditor();
    $("theme-grid").querySelector(`[data-theme-id="${b.dataset.themeId}"]`)?.focus();
  });
  $("theme-grid").addEventListener("keydown", e => {        // radio group: arrows move and pick
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
    const cards = [...$("theme-grid").querySelectorAll("[data-theme-id]")];
    const i = cards.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); cards[(i + d + cards.length) % cards.length].click();
  });
  $("theme-close").addEventListener("click", () => Modal.close($("theme-dlg")));
  const isTyping = el => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
  function openShortcuts() {
    const k = (...keys) => keys.map(x => `<kbd>${esc(x)}</kbd>`).join(" + ");
    const group = (title, rows) => rows.length ? `<section class="keys-group"><h3>${esc(title)}</h3><dl class="keys-list">${
      rows.map(([keys, what]) => `<dt>${keys}</dt><dd>${esc(what)}</dd>`).join("")}</dl></section>` : "";
    const c = typeof shortcutCtx === "function" ? shortcutCtx() : null;
    let html = group("Anywhere", [[k("?"), "Show this list"], [k("Esc"), "Close the open dialog or panel"]]);
    if (!c) html += group("Game library", [[`${k("←")} ${k("→")} ${k("↑")} ${k("↓")}`, "Move between games"],
      [k("Enter"), "Pick the focused game"], [k("Ctrl", "Enter"), "Pick it and open a lobby"]]);
    if (c) html += group("Chat", [
      ...(c.inGame ? [[k("/"), "Open chat and start typing"]] : []),
      [k("Enter"), c.inGame ? "Send, and hand the keyboard back to the game" : "Send"],
      [k("↑"), "Recall your last message (empty box)"],
      ...(c.inGame ? [[k("Esc"), "Close chat"]] : [])]);
    if (c?.inGame && c.canSave) html += group("Save states (host)", [[k("F2"), "Save now"], [k("F4"), "Load the newest save"]]);
    if (c?.streamerHost) html += group("Streamer Mode (host)", [[k("Ctrl", "Shift", "R"), "Rotate seats"]]);
    if (c?.inGame && c.race) html += group("Race / speedrun", [[k("F6"), "Split (the last split finishes your run)"], [k("F7"), "Undo the last split"]]);
    if (c?.inGame && c.ghost) html += group("Ghost mode", [[k("O"), "Show or hide all ghosts"],
      [`${k("Enter")} / ${k("Space")}`, "Ghost chip: show or hide that player"], [k("P"), "Ghost chip: pop out / put back"]]);
    if (c?.system && !isNative(c.system)) {
      const help = Input.KEY_HELP[Input.scheme(c.system)];
      html += group(`Game controls (${config.systems[c.system] || c.system})`, [["P1", help.A], ["P2", help.B]]);
    } else if (c?.system) {
      html += group("Game controls", [["", "Native games use the emulator's own controls and save-state keys, in its window."]]);
    }
    $("keys-body").innerHTML = html;
    Modal.open($("keys-dlg"), { focus: "#keys-close" });
  }
  window.addEventListener("keydown", e => {
    if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
    if (document.querySelector("dialog[open]")) return;          // don't stack on top of another dialog
    e.preventDefault(); e.stopImmediatePropagation();
    openShortcuts();
  }, true);
  const state = { rooms: [], library: null, inRoom: false, myRtt: null };
  let hubPicked = null;

  // ================================================================ boot
  // "What's new": once per version, for people who used an earlier one here (the changelog's newest sections).
  async function whatsNew() {
    const seen = Settings.get("seenVersion");
    Settings.set("seenVersion", me.version);
    if (!seen || seen === me.version || state.inRoom) return;
    const r = await fetch(`/api/whatsnew?since=${encodeURIComponent(seen)}`, { cache: "no-store" }).then(x => x.ok ? x.json() : null).catch(() => null);
    if (!r?.sections?.length) return;
    $("news-title").textContent = `What's new in Retro Hub ${me.version}`;
    $("news-body").innerHTML = r.sections.map(s => `<section><h3>${esc(s.version)}<span class="muted small"> ${esc(s.date)}</span></h3>${s.html}</section>`).join("");
    $("news-ok").onclick = () => Modal.close($("news-dlg"));
    Modal.open($("news-dlg"), { focus: "#news-ok" });
  }
  async function boot() {
    const r = await fetch("/api/me", { cache: "no-store" });
    if (r.status === 401) { location.replace("/login.html?next=" + encodeURIComponent(location.pathname + location.search)); return; }
    me = await r.json();
    config = await fetch("/api/config", { cache: "no-store" }).then(r => r.json());
    renderTopbar();
    renderSystems();
    renderSeats();
    renderModePick();
    renderFilters();
    renderIntro();
    makePicker($("hub-picker"), p => {
      if (hostShuffle()) return addHostShuffle(p);
      hubPicked = p;
      const remembered = p.kind === "file" && !p.system ? (Settings.get("extSys") || {})[fileExt(p.file)] : "";
      markConsoles(p);
      // Library games: the console picked last time for games of this console (DS -> melonDS), if it can run this one.
      const usual = p.kind === "lib" && !p.item.app ? (Settings.get("consoleFor") || {})[p.system] : "";
      const useUsual = !!usual && usual !== p.system && !!config.systems[usual] && takesExt(usual, String(p.item.ext || "").toLowerCase());
      $("system").value = (useUsual ? usual : p.system) || remembered || "";
      renderPlayIn();
      showPicked(useUsual ? `Console: ${config.systems[usual]}, as last time for ${config.systems[p.system] || p.system} games. Change it under Console.`
        : p.system ? "" : remembered ? "Console remembered from last time; change it if it's wrong." : "Choose the console for this file.");
      coopCheck(p); gbaCheck(p);
    }, () => { if (!$("host-btn").disabled) $("host-btn").click(); });
    if (!(await resumeRoom())) lobbySocket();
    linkRefresh();
    whatsNew();
    setInterval(() => { if (!document.hidden && linkState?.available) linkRefresh(); }, 5000);
  }

  // Host migration hands off through a quick page reload: the hub marks our held seat as "handing off" and gives
  // it back to the same signed-in account. Only the (non-secret) room code is kept in sessionStorage; no token.
  async function resumeRoom() {
    let r = null;
    try { r = JSON.parse(sessionStorage.getItem("rh-rejoin") || "null"); sessionStorage.removeItem("rh-rejoin"); } catch {}
    if (!r || !r.code || Date.now() - r.at > 25000) return false;
    try {
      // Everything that takes time comes first: once the socket is open the hub sends the roster (rules, chat history)
      // straight away, and the room's handlers have to be in place by then (enterRoom right after open, no await).
      let libItem = null;
      if (r.lib && me.library) {
        const lib = state.library || await fetch("/api/library", { cache: "no-store" }).then(x => x.ok ? x.json() : null).catch(() => null);
        if (lib) state.library = lib;
        libItem = lib?.find(g => g.path === r.lib) || null;
      }
      const hostFile = await FileStash.take("host"), romFile = await FileStash.take("rom");
      // A reload or a closed-and-reopened tab carries the resume token (same seat); a planned reload (host
      // migration, rematch) is matched by "handoff".
      const sock = await GameSocket.open({ t: "join", role: "guest", room: r.code, ...(r.token ? { resume: r.token } : { handoff: true }) });
      const j = sock.joined;
      if (j.host) {
        const params = { t: "join", role: "host", room: r.code, game: j.game, system: j.system, local: [Math.max(0, j.slot)], mode: j.mode };
        sock.joinMsg = params;
        // The host's game comes back with it: a library game, or a file from this computer parked for the reload.
        const picked = libItem ? { kind: "lib", item: libItem, name: r.coop?.name || libItem.name, system: libItem.system, ...(r.coop ? { coop: r.coop } : {}),
          ...(r.gba && Number.isInteger(r.gba.players) ? { gba: { players: Math.max(1, Math.min(4, r.gba.players)) } } : {}) }
          : hostFile ? { kind: "file", file: hostFile, name: hostFile.name.replace(/\.[^.]+$/, ""), system: j.system } : null;
        enterRoom(sock, { host: true, params, picked, promoted: !picked });
      } else enterRoom(sock, { host: false, room: { code: r.code, game: j.game, system: j.system, mode: j.mode }, romFile, resumed: true });
      if (r.rematch) setTimeout(() => toast("Back in the lobby for a rematch. Ready up!", { kind: "ok", ms: 5000 }), 300);
      else if (r.token) setTimeout(() => toast("You're back in the lobby. Your seat was kept.", { kind: "ok" }), 300);
      return true;
    } catch (e) { toast(e.message || "Couldn't get back into the lobby.", { kind: "bad", ms: 4000 }); return false; }
  }
  // A game file picked on this computer doesn't survive a page reload. For a planned reload (rematch, host change)
  // it is parked in this browser's own IndexedDB for two minutes and picked up again; it never leaves the browser.
  const FileStash = {
    MAX: 768 * 1024 * 1024,
    open() {
      return new Promise((resolve, reject) => {
        const r = indexedDB.open("rh-stash", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("files");
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
    },
    async put(key, file) {
      if (!file || file.size > this.MAX) return;
      const db = await this.open();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction("files", "readwrite");
          tx.objectStore("files").put({ file, name: file.name, at: Date.now() }, key);
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
    },
    async take(key) {
      try {
        const db = await this.open();
        const v = await new Promise(resolve => {
          const tx = db.transaction("files", "readwrite"), st = tx.objectStore("files"), g = st.get(key);
          g.onsuccess = () => { st.delete(key); resolve(g.result || null); }; g.onerror = () => resolve(null);
        });
        db.close();
        return v && Date.now() - v.at < 120e3 ? new File([v.file], v.name) : null;
      } catch { return null; }
    },
  };
  // extra: { lib } the host's library game path (comes back after the reload), { rematch } for the toast.
  // files: { host, rom } game files from this computer to bring back (the host's game, a ghost player's own ROM).
  async function handOff(sock, code, extra = {}, files = {}) {
    if (sock.handoff) return;
    sock.handoff = true;
    sock.send({ t: "handoff" });
    const stash = Object.entries(files).filter(([, f]) => f);
    if (stash.length) {
      toast("Keeping your game file for the reload…", { ms: 4000 });
      await Promise.race([Promise.all(stash.map(([k, f]) => FileStash.put(k, f).catch(() => {}))), new Promise(r => setTimeout(r, 15000))]);
    }
    try { sessionStorage.setItem("rh-rejoin", JSON.stringify({ code, at: Date.now(), ...extra })); } catch {}
    setTimeout(() => location.reload(), 50);
  }

  function renderTopbar() {
    $("me-name").textContent = me.name; $("me-name").title = me.name;
    $("me-id").textContent = "#" + prettyId(me.id);
    $("version").textContent = "v" + me.version;
    $("unlock-btn").hidden = !me.canUnlock;
    $("libdirs-btn").hidden = me.role !== "admin";
    window.RH.Friends?.start(me);
  }

  $("switch-btn").addEventListener("click", async () => {
    await Accounts.signOut();
    Accounts.setCurrent(null);
    location.replace("/login.html");
  });
  $("export-btn").addEventListener("click", async () => {
    const acct = await Accounts.get(me.id).catch(() => null);
    if (!acct) return alert("This account's key isn't stored in this browser, so it can't be exported from here.");
    Accounts.download(acct);
  });

  // ---------------------------------------------------------------- calibration
  function openCalibration(after) {
    Calibrate.open({
      onDone: ({ reason, results }) => {
        if (reason === "done" && results.length) toast(`Calibration saved for ${results.filter(r => r.ok).length} controller(s).`, { kind: "ok" });
        renderCalibSummary();
        after?.();
      },
    });
  }
  $("calib-btn").addEventListener("click", () => openCalibration());
  function renderCalibSummary() {
    const cal = Calibrate.load(), keys = Object.keys(cal);
    $("r-calib-sum").textContent = keys.length
      ? keys.map(k => `${Calibrate.deviceName(k)} ${Number.isFinite(cal[k].offsetMs) ? (cal[k].offsetMs >= 0 ? "+" : "") + cal[k].offsetMs + " ms" : ""}`).join(" · ")
      : "Not calibrated yet";
    $("r-calib-sum").title = $("r-calib-sum").textContent;
  }

  // ---------------------------------------------------------------- unlock library
  $("unlock-btn").addEventListener("click", () => {
    showErr($("unlock-error"), ""); $("unlock-pw").value = "";
    Modal.open($("unlock-dlg"), { focus: "#unlock-pw" });
  });
  const doUnlock = guard($("unlock-form").querySelector("button[value=ok]"), async () => {
    const r = await fetch("/api/unlock", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("unlock-pw").value }) });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) return showErr($("unlock-error"), res.error || "Could not unlock.");
    Modal.close($("unlock-dlg"));
    me = await fetch("/api/me", { cache: "no-store" }).then(r => r.json());
    renderTopbar();
    state.library = null;
    document.querySelectorAll(".game-picker").forEach(el => el.__refresh?.());
    openLibDirs();
  });

  // ---------------------------------------------------------------- library folders (owner)
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function refreshLibrary() {
    state.library = null;
    document.querySelectorAll(".game-picker").forEach(p => p.__refresh?.());
  }
  async function setLibDir(system, dir) {
    const r = await fetch("/api/library/folders", { method: "POST", headers: { "Content-Type": "application/json", "X-Retro-Hub": "library" },
      body: JSON.stringify({ system, dir }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Couldn't save (${r.status}).`);
    refreshLibrary();
    return j;
  }
  async function openLibDirs() {
    const dlg = $("libdirs-dlg"), list = $("libdirs-list");
    showErr($("libdirs-error"), "");
    list.replaceChildren(el("li", "muted small", "Loading…"));
    if (!Modal.isOpen(dlg)) Modal.open(dlg, { focus: "#libdirs-close" });
    const r = await fetch("/api/library/folders", { cache: "no-store" }).catch(() => null);
    const j = r && await r.json().catch(() => null);
    if (!r?.ok || !j) { list.replaceChildren(); return showErr($("libdirs-error"), j?.error || "Couldn't load the library folders."); }
    if (!j.canEdit) showErr($("libdirs-error"), "You can look here, but folders can only be changed from a browser on the hub's own computer.");
    $("libdirs-sub").textContent = `Pick the folder each console's games are in. Consoles without one use their sub-folder of the main ROM folder (${j.romsDir}).`;
    list.replaceChildren(...j.systems.map(s => {
      const li = el("li");
      const info = el("div", "grow");
      info.append(el("b", "", s.label), s.native ? el("span", "badge", "native") : "");
      info.append(el("div", "small muted trunc" + (s.dir ? " set" : ""), s.dir || `default: ${s.defaultDirs.map(d => d + "/").join(", ") || "by file type"}`));
      info.lastChild.title = info.lastChild.textContent;
      const browse = el("button", "small", "Browse…"); browse.type = "button"; browse.disabled = !j.canEdit;
      browse.onclick = () => pickFolder(s.dir || "", async dir => {
        try { await setLibDir(s.id, dir); toast(`${s.label}: ${dir}`, { kind: "ok" }); openLibDirs(); }
        catch (e) { showErr($("libdirs-error"), e.message); }
      });
      li.append(info, browse);
      if (s.dir) {
        const clr = el("button", "small ghost", "Clear"); clr.type = "button"; clr.disabled = !j.canEdit; clr.title = "Use the default folder again";
        clr.onclick = async () => { try { await setLibDir(s.id, null); openLibDirs(); } catch (e) { showErr($("libdirs-error"), e.message); } };
        li.append(clr);
      }
      return li;
    }));
  }
  $("libdirs-btn").addEventListener("click", () => openLibDirs());
  $("libdirs-close").addEventListener("click", () => Modal.close($("libdirs-dlg")));

  // Folder picker: the hub lists folders on its own computer (owner, local browser only).
  let fsPick = null;
  async function fsGo(dir) {
    showErr($("fs-error"), "");
    const r = await fetch("/api/fs/dirs?dir=" + encodeURIComponent(dir || ""), { cache: "no-store" }).catch(() => null);
    const j = r && await r.json().catch(() => null);
    if (!r?.ok || !j) return showErr($("fs-error"), j?.error || "Couldn't open that folder.");
    fsPick.dir = j.dir;
    $("fs-path").textContent = j.dir || "Pick a drive or place to start";
    $("fs-ok").disabled = !j.dir;
    const items = [];
    if (j.parent !== null) { const up = el("li", "fs-up", "⬑  Up"); up.onclick = () => fsGo(j.parent); items.push(up); }
    for (const d of j.dirs) { const li = el("li", "", "📁  " + d.name); li.title = d.path; li.onclick = () => fsGo(d.path); items.push(li); }
    if (!j.dirs.length) items.push(el("li", "muted small empty-row", "No folders in here. Press Use this folder to pick it."));
    $("fs-list").replaceChildren(...items);
    $("fs-list").scrollTop = 0;
  }
  function pickFolder(start, onPick) {
    fsPick = { dir: "", onPick };
    Modal.open($("fs-dlg"), { focus: "#fs-cancel" });
    fsGo(start);
  }
  $("fs-cancel").addEventListener("click", () => Modal.close($("fs-dlg")));
  $("fs-ok").addEventListener("click", () => {
    const p = fsPick; Modal.close($("fs-dlg"));
    if (p?.dir) p.onPick(p.dir);
  });

  // ---------------------------------------------------------------- check for emulators
  $("emu-check-btn").addEventListener("click", guard($("emu-check-btn"), async () => {
    const list = $("emu-list"), sum = $("emu-check-sum");
    list.hidden = false; sum.textContent = "Checking…";
    list.replaceChildren();
    const r = await fetch("/api/emulators", { cache: "no-store" }).catch(() => null);
    const j = r && await r.json().catch(() => null);
    if (!r?.ok || !j) { sum.textContent = (j && j.error) || "Couldn't check the emulators."; return; }
    const ok = j.emulators.filter(e => e.installed).length;
    sum.textContent = `${ok} of ${j.emulators.filter(e => !e.unknown).length} loaded` + (j.folder ? ` · ${j.folder}` : "");
    sum.title = j.folder || "";
    if (!j.ok && j.error) list.append(el("li", "emu-warn small", j.error));
    for (const e of j.emulators) {
      const li = el("li", e.installed ? "on" : "off");
      li.append(el("span", "emu-mark", e.installed ? "✔" : "✖"), el("span", "emu-name", e.label));
      const note = e.unknown ? "folder not recognized" : e.systems.join(", ") + (e.custom ? " · added by you" : "");
      if (note) li.append(el("span", "small muted trunc", note));
      li.title = e.installed ? "Loaded" : e.unknown ? "This folder doesn't match a known emulator" : "Not found in the emulators folder";
      list.append(li);
    }
  }));
  $("unlock-form").addEventListener("submit", e => {
    if (e.submitter && e.submitter.value === "cancel") return;
    e.preventDefault(); doUnlock();
  });

  // ---------------------------------------------------------------- first-visit guide + join by code
  function renderIntro() {
    $("intro").hidden = !!Settings.get("introSeen");
    $("intro-close").onclick = () => { Settings.set("introSeen", true); $("intro").hidden = true; };
  }
  $("empty-host").addEventListener("click", e => {
    e.preventDefault();
    const box = $("hub-picker");
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    (box.querySelector("[role=tab][aria-selected=true]") || box.querySelector("input"))?.focus({ preventScroll: true });
  });
  // Accepts a bare code or a whole pasted invite link.
  $("code-form").addEventListener("submit", e => {
    e.preventDefault();
    let v = $("code-input").value.trim();
    const m = /[?&]join=([A-Za-z0-9-]+)/.exec(v); if (m) v = m[1];
    const c = v.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
    if (!c) return $("code-input").focus();
    const r = state.rooms.find(x => x.code === c);
    if (!r) return toast(`No lobby with code ${c} is open right now.`, { kind: "bad", ms: 3500 });
    if (r.hostKey === me.id) return toast("That's your own lobby.");
    $("code-input").value = "";
    openJoin(r, true, r.open === 0 && r.watchable);
  });

  // ================================================================ lobby list (live)
  let lobbyWs = null, lobbyRetry = 1000, pingTimer = 0;
  function lobbySocket() {
    const ws = lobbyWs = new WebSocket(wsUrl());
    const ping = () => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: "ping", ts: performance.now() })); };
    ws.onopen = () => {
      lobbyRetry = 1000; $("lobby-status").textContent = "Live";
      ws.send(JSON.stringify({ t: "lobby" }));
      ping(); clearInterval(pingTimer); pingTimer = setInterval(ping, 3000);
    };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === "rooms") { state.rooms = m.rooms || []; LB.roomsSeen = true; renderRooms(); checkInvite(); }
      if (m.t === "lan") { state.lan = Array.isArray(m.lobbies) ? m.lobbies : []; renderLan(); }
      if (m.t === "pong") {
        const rtt = performance.now() - m.ts;
        state.myRtt = state.myRtt == null ? rtt : state.myRtt * 0.6 + rtt * 0.4;   // smoothed
        $("my-ping").innerHTML = `You <span class="ping ${pingClass(state.myRtt)}">${pingLabel(state.myRtt)}</span>`;
        renderRooms();
      }
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      if (state.inRoom) return;
      $("lobby-status").textContent = "Reconnecting…";
      setTimeout(lobbySocket, lobbyRetry); lobbyRetry = Math.min(lobbyRetry * 2, 15000);
    };
  }
  const estPing = r => (state.myRtt == null || r.hostRtt == null) ? null : state.myRtt + r.hostRtt;

  function renderModePick() {
    const saved = ["ghost", "race", "shuffle"].includes(Settings.get("hostMode")) ? Settings.get("hostMode") : "coop";
    document.querySelectorAll("input[name=mode]").forEach(r => {
      r.checked = r.value === saved;
      r.addEventListener("change", () => { Settings.set("hostMode", hostModeRaw()); modeHelp(); });
    });
    modeHelp();
  }
  function modeHelp() {
    const ghost = hostMode() === "ghost";
    $("mode-help").hidden = !ghost;
    $("shuffle-wrap").hidden = !hostShuffle();
    $("system").hidden = hostShuffle(); const sl = document.querySelector("label[for=system]"); if (sl) sl.hidden = hostShuffle();   // each shuffle game has its own console
    $("picked").hidden = hostShuffle() || !hubPicked;
    renderHostShuffle();
    $("mode-help").textContent = hostRace()
      ? "Race or speedrun: everyone runs their own copy, starts together on GO and is timed by the hub. Split with F6. Alone, it's a speedrun timer with personal bests. Friends show as ghosts, or drag them out into pop-out windows."
      : GHOST_TIP;
    $("seats-wrap").hidden = ghost;       // one player per computer in ghost mode
  }

  function renderFilters() {
    const f = Settings.get("filters");
    const sel = $("f-system");
    for (const [id, label] of Object.entries(config.systems)) { const o = document.createElement("option"); o.value = id; o.textContent = label; sel.appendChild(o); }
    $("f-full").checked = !!f.hideFull; $("f-locked").checked = !!f.hideLocked; sel.value = f.system || ""; $("f-mode").value = f.mode || "";
    const upd = () => { Settings.patch("filters", { hideFull: $("f-full").checked, hideLocked: $("f-locked").checked, system: sel.value, mode: $("f-mode").value }); renderRooms(); };
    $("f-full").addEventListener("change", upd); $("f-locked").addEventListener("change", upd); sel.addEventListener("change", upd);
    $("f-mode").addEventListener("change", upd);
  }

  let roomsKey = "";
  function renderRooms() {
    if (state.inRoom) return;
    renderBrowser();
    const f = Settings.get("filters");
    const list = state.rooms
      .filter(r => !(f.hideFull && r.open === 0) && !(f.hideLocked && r.locked) && !(f.system && r.system !== f.system)
        && !(f.mode && (r.mode || "coop") !== f.mode))
      .map(r => ({ r, ping: estPing(r) }))
      .sort((a, b) => (a.ping ?? 1e9) - (b.ping ?? 1e9) || String(a.r.game).localeCompare(b.r.game));
    // Skip re-rendering when nothing visible changed (keeps focus and hover state stable).
    const key = JSON.stringify(list.map(x => [x.r, x.ping == null ? null : Math.round(x.ping / 5)]));
    if (key === roomsKey) return;
    roomsKey = key;
    const focusedCode = document.activeElement?.closest?.("#rooms li")?.dataset.code;
    const focusedAct = document.activeElement?.dataset?.act;
    const ul = $("rooms"); ul.textContent = "";
    $("rooms-empty").hidden = list.length > 0;
    $("rooms-empty-title").textContent = state.rooms.length ? "No lobbies match your filters." : "Nobody is hosting right now.";
    $("rooms-empty-sub").hidden = !!state.rooms.length;
    $("rooms-count").textContent = state.rooms.length ? `${list.length} of ${state.rooms.length}` : "";
    for (const { r, ping } of list) {
      const li = document.createElement("li");
      li.dataset.code = r.code;
      const mine = r.hostKey === me.id;
      const sys = config.systems[r.system] || "";
      const canJoin = r.open > 0 && !mine, canWatch = !mine && r.open === 0 && r.watchable;
      li.innerHTML = `
        <div class="grow">
          <div class="title" title="${esc(r.game || "Untitled game")}">${esc(r.game || "Untitled game")}</div>
          <div class="sub trunc">${esc(r.host)} <span class="id">#${esc(prettyId(r.hostKey))}</span>${sys ? " · " + esc(sys) : ""}${r.spectators ? ` · ${num(r.spectators)} watching` : ""}</div>
        </div>
        ${r.mode === "ghost" ? `<span class="badge mode-ghost" title="${esc(r.race ? "Race: everyone runs their own copy, timed by the hub. " + GHOST_TIP : GHOST_TIP)}">${r.race ? "Race" : "Ghost"}</span>` : ""}
        ${r.phase && r.phase !== "lobby" ? `<span class="badge">${r.phase === "playing" ? "In game" : r.phase === "countdown" ? "Starting" : "Loading"}</span>` : ""}
        <span class="ping ${pingClass(ping)}" title="Estimated ping through the hub">${pingLabel(ping)}</span>
        ${r.locked ? '<span class="badge lock" title="Needs a lobby password">🔒</span>' : ""}
        <span class="badge ${r.open ? "" : "full"}">${num(r.players)}/${num(r.max)}</span>
        <button class="small icon" data-act="copy" title="Copy invite link" aria-label="Copy invite link for ${esc(r.game || "this lobby")}">⧉</button>
        <button class="small ${canJoin || canWatch ? "primary" : ""}" data-act="join" ${canJoin || canWatch ? "" : "disabled"}>${mine ? "Yours" : canJoin ? "Join" : canWatch ? "Watch" : "Full"}</button>`;
      li.querySelector("[data-act=copy]").addEventListener("click", () => copyInvite(r.code));
      const jb = li.querySelector("[data-act=join]");
      jb.addEventListener("click", () => openJoin(r, false, canWatch));
      ul.appendChild(li);
      if (r.code === focusedCode && focusedAct) li.querySelector(`[data-act=${focusedAct}]`)?.focus();
    }
  }

  // Lobbies on other Retro Hub servers: same Wi-Fi/LAN (multicast beacons) or the master pool. Joining opens
  // that hub's own page with ?join=<code>; the server only ever sends http(s) links it built itself.
  function renderLan() {
    renderBrowser();
    const list = (state.lan || []).filter(l => /^https?:\/\//.test(l.connection_string));
    $("lan-box").hidden = !list.length;
    $("lan-count").textContent = list.length ? String(list.length) : "";
    const ul = $("lan-rooms"); ul.textContent = "";
    for (const l of list) {
      const li = document.createElement("li");
      const sys = config.systems[l.system] || "";
      const where = (() => { try { return new URL(l.connection_string).host; } catch { return ""; } })();
      const open = l.current_players < l.max_players;
      li.innerHTML = `
        <div class="grow">
          <div class="title" title="${esc(l.game_title || "Untitled game")}">${esc(l.game_title || "Untitled game")}</div>
          <div class="sub trunc">${esc(l.host_name)}${sys ? " · " + esc(sys) : ""} · <span class="id">${esc(where)}</span></div>
        </div>
        <span class="badge" title="${l.is_lan ? "Found on your local network" : "From the master lobby pool"}">${l.is_lan ? "LAN" : "Online"}</span>
        ${l.link ? '<span class="badge" title="GBA link cable session: everyone runs their own VBA-M">Link</span>' : ""}
        ${l.netplay_mode === "pretendo" ? '<span class="badge" title="The host\'s Cemu is online through Pretendo Network">Pretendo</span>' : ""}
        ${l.phase && l.phase !== "lobby" ? `<span class="badge">${l.phase === "playing" ? "In game" : "Starting"}</span>` : ""}
        ${l.locked ? '<span class="badge lock" title="Needs a lobby password">🔒</span>' : ""}
        <span class="badge ${open ? "" : "full"}">${num(l.current_players)}/${num(l.max_players)}</span>
        ${l.link
          ? `<button class="small ${open ? "primary" : ""}" data-act="link" ${open && linkState?.available ? "" : "disabled"} title="${linkState?.available ? "Start your VBA-M linked to this session" : "Only the owner, on this hub's own computer, can join link sessions"}">${open ? "Join link" : "Full"}</button>`
          : `<a class="btn small ${open ? "primary" : ""}" href="${esc(safeHttp(l.connection_string) || "#")}" rel="noopener noreferrer">${open ? "Join" : "Open"}</a>`}`;
      li.querySelector("[data-act=link]")?.addEventListener("click", e => linkJoin(l, e.currentTarget));
      ul.appendChild(li);
    }
  }

  // ================================================================ GBA link cable (VBA-M, hub to hub on the LAN)
  // The server does the work (core/net/link.mjs); this panel only exists for the owner on the hub's own PC.
  let linkState = null;
  const linkPost = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Retro-Hub": "link" },
    body: JSON.stringify(body || {}) }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; });
  const linkSteps = (role, ip, port, players) => role === "server"
    ? `In VBA-M: <b>Options → Link → Start Network Link</b>, choose <b>Server</b>, ${players} players, press <b>Start</b>. Then the others connect to <span class="code">${esc(ip)}:${port}</span>. Allow VBA-M through Windows Firewall if asked.`
    : `In VBA-M: <b>Options → Link → Start Network Link</b>, choose <b>Client</b>; the host <span class="code">${esc(ip)}</span> is filled in. Press <b>Connect</b> after the host has started the server, in seat order (P2, then P3, then P4).`;
  async function linkRefresh() {
    try { linkState = await fetch("/api/link", { cache: "no-store" }).then(r => r.json()); } catch { linkState = null; }
    const box = $("link-box");
    box.hidden = !linkState?.available;
    if (box.hidden) return;
    $("link-ip").textContent = linkState.ip ? `This PC: ${linkState.ip}` : "";
    const busy = !!(linkState.hosting || linkState.joined);
    $("link-host-row").hidden = busy; $("link-stop").hidden = !busy; $("link-status").hidden = !busy;
    if (!linkState.installed) $("link-help").innerHTML = `VBA-M isn't installed. Put a portable <b>visualboyadvance-m.exe</b> in the <span class="code">emulators/vbam</span> folder (official builds: visualboyadvance-m.org), then reload.`;
    const h = linkState.hosting, j = linkState.joined;
    if (h) $("link-status").innerHTML = `Hosting <b>${esc(h.game)}</b> as <b>P1 (server)</b> · ${h.seats.map(x => `P${x.slot + 1} ${esc(x.name)}`).join(", ")} (${h.seats.length}/${h.players})<br>${linkSteps("server", linkState.ip, linkState.port, h.players)}`;
    else if (j) $("link-status").innerHTML = `Joined <b>${esc(j.game)}</b> from ${esc(j.host)} as <b>P${j.slot + 1}</b><br>${linkSteps("client", j.hostIp, j.port, j.players)}`;
    if (!busy) {
      if (!state.library) { try { const r = await fetch("/api/library", { cache: "no-store" }); if (r.ok) state.library = await r.json(); } catch {} }
      const games = (state.library || []).filter(isLinkGame);
      const sel = $("link-game"), keep = sel.value;
      sel.textContent = "";
      for (const g of games) { const o = document.createElement("option"); o.value = g.path; o.textContent = g.name; sel.appendChild(o); }
      if (keep) sel.value = keep;
      $("link-host").disabled = !games.length || !linkState.installed;
      if (!games.length && linkState.installed) $("link-help").textContent = "No .gba, .gb or .gbc games in the server library yet.";
    }
    renderLan();
    renderPlayIn(); updateHostBtn();
  }
  $("link-host").addEventListener("click", guard($("link-host"), async () => {
    try {
      const r = await linkPost("/api/link/host", { path: $("link-game").value, players: Number($("link-players").value) });
      toast(`VBA-M started as the link server (P1, ${r.players} players).`, { ms: 4000 });
    } catch (e) { toast(e.message, { kind: "bad", ms: 7000 }); }
    linkRefresh();
  }));
  $("link-stop").addEventListener("click", guard($("link-stop"), async () => {
    try { await linkPost("/api/link/stop"); } catch (e) { toast(e.message, { kind: "bad", ms: 5000 }); }
    linkRefresh();
  }));
  async function linkJoin(l, btn) {
    btn.disabled = true;
    try {
      const r = await linkPost("/api/link/join", { lobby_id: l.lobby_id });
      toast(`You're P${r.slot + 1}. VBA-M is starting; connect it as a client.`, { ms: 5000 });
    } catch (e) { toast(e.message, { kind: "bad", ms: 8000 }); }
    btn.disabled = false;
    linkRefresh();
  }

  // ================================================================ join
  let joinTarget = null, joinWatch = false;
  let invite = new URLSearchParams(location.search).get("join");
  // Friends panel (public/friends.js): "Join" on a friend uses the same flow as an invite link.
  window.RH.Friends?.onJoin(code => {
    const r = state.rooms.find(x => x.code === code);
    if (r) return openJoin(r, true, r.open === 0 && r.watchable);
    invite = code; checkInvite();
  });
  if (invite) invite = invite.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24) || null;

  function checkInvite() {
    if (!invite || state.inRoom) return;
    const r = state.rooms.find(x => x.code === invite);
    if (!r) { $("lobby-status").textContent = `Waiting for lobby ${invite} to open…`; return; }
    invite = null;
    history.replaceState(null, "", "/");
    if (r.hostKey === me.id) return;
    openJoin(r, true, r.open === 0 && r.watchable);
  }

  function showJoinDlg(room) {
    $("join-title").textContent = `${joinWatch ? "Watch" : "Join"} ${room.host}'s lobby`;
    $("join-sub").textContent = `${room.game || "Untitled game"}${config.systems[room.system] ? " · " + config.systems[room.system] : ""}`;
    $("join-ok").textContent = joinWatch ? "Watch" : "Join";
    if (!Modal.isOpen($("join-dlg"))) Modal.open($("join-dlg"), { focus: room.locked ? "#join-pw" : "#join-ok" });
  }
  // Connection check: Co-op sends every button press to the host and the picture back, so a slow route lags.
  // Ghost and Race run the game on each player's own computer, so ping doesn't matter there.
  function pingWarning(room) {
    const ms = estPing(room);
    if (ms == null || ms < 150 || (room.mode && room.mode !== "coop") || joinWatch) return "";
    return `Your connection to ${room.host} is about ${Math.round(ms)} ms, so Co-op will feel laggy (each button press reaches the host that late). `
      + (ms >= 250 ? "Single-Player Ghost or Race mode would play smoothly instead." : "Fine for slower games; fast action games will feel it.");
  }
  function openJoin(room, fromInvite, watch) {
    joinTarget = room; joinWatch = !!watch;
    $("join-wait").hidden = true; $("join-ok").textContent = watch ? "Watch" : "Join";
    const warn = pingWarning(room);
    $("join-ping").hidden = !warn; $("join-ping").textContent = warn;
    if (!room.locked && !fromInvite && !warn) return doJoin(room, "");
    $("join-pw-wrap").hidden = !room.locked;
    $("join-pw").value = "";
    showErr($("join-error"), "");
    showJoinDlg(room);
  }
  const submitJoin = guard($("join-ok"), () => joinTarget && doJoin(joinTarget, $("join-pw").value));
  $("join-form").addEventListener("submit", e => {
    if (e.submitter && e.submitter.value === "cancel") return;
    e.preventDefault(); submitJoin();
  });

  let joining = false;
  // quiet: a retry while waiting for a seat (no dialog when it's still full). Returns true once joined.
  async function doJoin(room, password, { quiet = false } = {}) {
    if (joining) return false;      // one join request at a time
    joining = true;
    const btn = document.querySelector(`#rooms li[data-code="${room.code}"] [data-act=join]`);
    if (btn) btn.disabled = true;
    try {
      const sock = await GameSocket.open({ t: "join", role: "guest", room: room.code, password, spectate: joinWatch });
      if (Modal.isOpen($("join-dlg"))) Modal.close($("join-dlg"));
      if (quiet) seatFound(room);
      stopWaiting();
      enterRoom(sock, { host: false, room, password });
      return true;
    } catch (e) {
      if (btn) btn.disabled = false;
      if (quiet && e.code === "full") return false;          // someone was faster: keep waiting
      if (quiet) stopWaiting(`Stopped waiting: ${e.message}`);
      const full = e.code === "full";
      if (full && e.watchable && !joinWatch) { joinWatch = true; e.message += " Press Join to watch, or wait for a seat."; }
      else if (full) e.message += " You can wait for a seat.";
      $("join-pw-wrap").hidden = !(room.locked || e.code === "password");
      $("join-wait").hidden = !full;
      $("join-ok").textContent = full && joinWatch ? "Watch" : "Join";
      showJoinDlg(room);
      showErr($("join-error"), e.message);
      return false;
    } finally { setTimeout(() => { joining = false; }, 300); }
  }
  $("join-wait").addEventListener("click", () => {
    if (!joinTarget) return;
    startWaiting(joinTarget, $("join-pw").value);
    Modal.close($("join-dlg"));
  });

  // ================================================================ Lobby Browser (tab next to Play)
  // One table of every lobby the hub knows: its own (state.rooms) and other hubs' (state.lan: LAN beacons and the
  // master lobby pool). Search, filters, sortable columns, who's in a lobby, friends marked. Two helpers from the
  // community request: "Wait for a seat" (joins a full lobby the moment a seat opens) and "Alert me" (a pop-up and
  // a notification when a lobby matching the filters opens). Both work while this page is open.
  // alerted: lobbies already announced. baselined: the lobbies listed when the alert was turned on (or the page loaded)
  // count as seen, so only lobbies that open later pop up (and a reload doesn't repeat old alerts).
  const LB = { open: new Set(), alerted: new Set(), waiting: null, roomsSeen: false, baselined: false };
  const lbFilters = () => ({ q: "", system: "", mode: "", min: 1, open: false, nopw: false, waiting: false, friends: false, here: false,
    sort: "ping", dir: 1, ...(Settings.get("lbFilters") || {}) });
  const lbFriendsIn = code => window.RH.Friends?.friendsIn?.(code) || [];
  // Every lobby as one shape. src: "hub" (this hub), "lan" (another hub on the network), "pool" (master lobby pool).
  function lbRows() {
    const rows = state.rooms.map(r => ({ key: "hub:" + r.code, src: "hub", r, code: r.code, game: r.game || "Untitled game", system: r.system,
      mode: r.race ? "race" : (r.mode || "coop"), players: r.players, max: r.max, open: r.open, ping: estPing(r), host: r.host, locked: r.locked,
      phase: r.phase || "lobby", names: r.names || [], where: "This hub", mine: r.hostKey === me.id, watchable: r.watchable, friends: lbFriendsIn(r.code) }));
    for (const l of state.lan || []) {
      if (!/^https?:\/\//.test(l.connection_string)) continue;
      let where = ""; try { where = new URL(l.connection_string).host; } catch {}
      rows.push({ key: (l.is_lan ? "lan:" : "pool:") + where + "/" + l.lobby_id, src: l.is_lan ? "lan" : "pool", l, code: l.lobby_id,
        game: l.game_title || "Untitled game", system: l.system, mode: l.link ? "link" : (l.mode || "coop"), players: l.current_players, max: l.max_players,
        open: Math.max(0, l.max_players - l.current_players), ping: null, host: l.host_name, locked: !!l.locked, phase: l.phase || "lobby",
        names: [], where, href: l.connection_string, friends: [] });
    }
    return rows;
  }
  function lbMatch(row, f) {
    if (f.system && row.system !== f.system) return false;
    if (f.mode && row.mode !== f.mode) return false;
    if (row.players < (Number(f.min) || 1)) return false;
    if (f.open && !(row.open > 0)) return false;
    if (f.nopw && row.locked) return false;
    if (f.waiting && row.phase !== "lobby") return false;
    if (f.friends && !row.friends.length) return false;
    if (f.here && row.src !== "hub") return false;
    const terms = String(f.q || "").toLowerCase().split("|").map(t => t.trim()).filter(Boolean);
    if (!terms.length) return true;
    const hay = [row.game, row.host, config.systems[row.system] || row.system, row.where, ...row.names.map(n => n.name)].join("\n").toLowerCase();
    return terms.some(t => hay.includes(t));
  }
  const MODE_LABEL = { coop: "Co-op", ghost: "Ghost", race: "Race", link: "Link cable" };
  const SRC_LABEL = { hub: "This hub", lan: "LAN", pool: "Online" };
  function lbSort(rows, f) {
    const key = { game: r => r.game.toLowerCase(), system: r => (config.systems[r.system] || r.system || "").toLowerCase(),
      players: r => -r.players, ping: r => (r.src === "hub" ? 0 : r.src === "lan" ? 1e6 : 2e6) + (r.ping ?? 9e5), where: r => r.src + r.where }[f.sort] || (r => r.ping ?? 9e5);
    return rows.sort((a, b) => (b.friends.length > 0) - (a.friends.length > 0) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * f.dir || a.game.localeCompare(b.game));
  }
  let lbFilled = false;
  function renderBrowser() {
    if (!config || state.inRoom) return;
    const f = lbFilters();
    if (!lbFilled) {
      lbFilled = true;
      for (const [id, label] of Object.entries(config.systems)) { const o = document.createElement("option"); o.value = id; o.textContent = label; $("lb-system").appendChild(o); }
      $("lb-search").value = f.q; $("lb-system").value = f.system; $("lb-mode").value = f.mode; $("lb-min").value = f.min;
      for (const k of ["open", "nopw", "waiting", "friends", "here"]) $("lb-" + k).checked = !!f[k];
    }
    const all = lbRows();
    lbCheckWatch(all);
    lbCheckWait();
    const openHub = state.rooms.filter(r => r.open > 0 && r.hostKey !== me.id).length;
    $("lb-tab-count").hidden = !all.length; $("lb-tab-count").textContent = String(all.length);
    $("lb-tab-count").title = `${all.length} lobb${all.length === 1 ? "y" : "ies"}, ${openHub} with open seats on this hub`;
    if ($("lobbies-panel").hidden) return;
    const rows = lbSort(all.filter(r => lbMatch(r, f)), f);
    $("lb-count").textContent = all.length ? (rows.length === all.length ? `${all.length} lobb${all.length === 1 ? "y" : "ies"}` : `${rows.length} of ${all.length}`) : "";
    document.querySelectorAll(".lb-table [data-sort]").forEach(b => {
      const on = b.dataset.sort === f.sort;
      b.closest("th").setAttribute("aria-sort", on ? (f.dir > 0 ? "ascending" : "descending") : "none");
      b.dataset.dir = on ? (f.dir > 0 ? "▲" : "▼") : "";
    });
    $("lb-empty").hidden = rows.length > 0;
    $("lb-empty").textContent = all.length ? "No lobbies match these filters." : "Nobody is hosting right now. Use 🔔 Alert me to hear when someone does.";
    const tb = $("lb-rows"), focusKey = document.activeElement?.closest?.("tr")?.dataset.key, focusAct = document.activeElement?.dataset?.act;
    tb.textContent = "";
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.dataset.key = row.key; tr.className = "lb-row" + (row.friends.length ? " has-friend" : "") + (LB.waiting?.code === row.code && row.src === "hub" ? " waiting" : "");
      tr.tabIndex = 0; tr.setAttribute("aria-expanded", String(LB.open.has(row.key)));
      const sys = config.systems[row.system] || row.system || "";
      const phaseBadge = row.phase === "lobby" ? "" : `<span class="badge">${row.phase === "playing" ? "In game" : row.phase === "countdown" ? "Starting" : "Loading"}</span>`;
      tr.innerHTML = `
        <td class="lb-c-game"><div class="title trunc" title="${esc(row.game)}">${esc(row.game)}</div>
          <div class="sub trunc">${esc(row.host)}${row.friends.length ? ` · <span class="lb-friend" title="Friends in this lobby">👥 ${esc(row.friends.join(", "))}</span>` : ""}</div></td>
        <td class="lb-c-sys trunc" title="${esc(sys)}">${esc(sys)}</td>
        <td class="lb-c-mode">${esc(MODE_LABEL[row.mode] || row.mode)}</td>
        <td><span class="badge ${row.open > 0 ? "" : "full"}">${num(row.players)}/${num(row.max)}</span>${row.locked ? ' <span class="badge lock" title="Needs a lobby password">🔒</span>' : ""} ${phaseBadge}</td>
        <td class="lb-c-ping">${row.src === "hub" ? `<span class="ping ${pingClass(row.ping)}">${pingLabel(row.ping)}</span>` : "<span class=\"muted small\">—</span>"}</td>
        <td class="lb-c-where"><span class="badge" title="${esc(row.where)}">${esc(SRC_LABEL[row.src] || "")}</span></td>
        <td class="lb-c-act">${lbActions(row)}</td>`;
      tb.appendChild(tr);
      if (LB.open.has(row.key)) {
        const d = document.createElement("tr"); d.className = "lb-detail";
        const who = row.names.length ? row.names.map(n => `<span class="lb-name${row.friends.includes(n.name) ? " friend" : ""}">${esc(n.name)}${n.host ? " <small>host</small>" : n.watching ? " <small>watching</small>" : ""}</span>`).join("")
          : `<span class="muted">${row.src === "hub" ? "Nobody yet." : "Player names aren't shared between hubs."}</span>`;
        d.innerHTML = `<td colspan="7"><div class="lb-who">${who}</div><div class="small muted">${esc(sys)} · ${esc(MODE_LABEL[row.mode] || row.mode)} · ${num(row.open)} open seat${row.open === 1 ? "" : "s"} · ${esc(row.src === "hub" ? "on this hub, lobby code " + row.code : row.where)}</div></td>`;
        tb.appendChild(d);
      }
      if (row.key === focusKey) (focusAct ? tr.querySelector(`[data-act="${focusAct}"]`) : tr)?.focus();
    }
  }
  function lbActions(row) {
    if (row.src !== "hub") {
      if (row.mode === "link") return `<button class="small" data-act="tab-play" title="Link cable sessions are joined from the GBA / Game Boy link cable panel on the Play tab">Link panel</button>`;
      return `<a class="btn small ${row.open > 0 ? "primary" : ""}" data-act="go" href="${esc(safeHttp(row.href) || "#")}" rel="noopener noreferrer" title="Opens that hub (you make an account there)">${row.open > 0 ? "Join" : "Open"} ↗</a>`;
    }
    if (row.mine) return '<span class="small muted">Yours</span>';
    const w = LB.waiting?.code === row.code;
    if (w) return '<button class="small" data-act="unwait">Stop waiting</button>';
    if (row.open > 0) return '<button class="small primary" data-act="join">Join</button>';
    return `${row.watchable ? '<button class="small" data-act="watch">Watch</button>' : ""}<button class="small primary" data-act="wait" title="Join automatically the moment a seat opens">⏳ Wait for a seat</button>`;
  }
  $("lb-rows").addEventListener("click", e => {
    const tr = e.target.closest("tr.lb-row"); if (!tr) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    const row = lbRows().find(r => r.key === tr.dataset.key); if (!row) return;
    if (act === "go") return;                            // a plain link to the other hub
    if (act === "tab-play") return $("tab-play").click();
    if (act === "join") return openJoin(row.r, false, false);
    if (act === "watch") return openJoin(row.r, false, true);
    if (act === "wait") return row.locked ? openJoin(row.r, true, false) : startWaiting(row.r, "");
    if (act === "unwait") return stopWaiting("Stopped waiting.");
    if (LB.open.has(row.key)) LB.open.delete(row.key); else LB.open.add(row.key);
    renderBrowser();
  });
  $("lb-rows").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr.lb-row")) { e.preventDefault(); e.target.click(); } });
  const lbSave = () => {
    Settings.patch("lbFilters", { q: $("lb-search").value.trim(), system: $("lb-system").value, mode: $("lb-mode").value,
      min: Math.max(1, Math.min(12, Number($("lb-min").value) || 1)),
      ...Object.fromEntries(["open", "nopw", "waiting", "friends", "here"].map(k => [k, $("lb-" + k).checked])) });
    renderBrowser();
  };
  $("lb-search").addEventListener("input", UI.debounce(lbSave, 150));
  for (const id of ["lb-system", "lb-mode", "lb-min", "lb-open", "lb-nopw", "lb-waiting", "lb-friends", "lb-here"]) $(id).addEventListener("change", lbSave);
  document.querySelectorAll(".lb-table [data-sort]").forEach(b => b.addEventListener("click", () => {
    const f = lbFilters();
    Settings.patch("lbFilters", f.sort === b.dataset.sort ? { dir: -f.dir } : { sort: b.dataset.sort, dir: 1 });
    renderBrowser();
  }));
  window.addEventListener("rh-friends", () => renderBrowser());
  window.addEventListener("rh-hubtab", () => renderBrowser());

  // ---- getting someone's attention: a toast (with an action), the sound, the tab title and, while the tab is in the
  // background, a system notification (only if the player allowed them when turning the alert on).
  let titleFlash = 0;
  function lbAlert(text, action, tag) {
    Sfx.chime();
    toast(text, { kind: "ok", ms: 15000, action });
    if (document.hidden) {
      clearInterval(titleFlash);
      const base = document.title.replace(/^\(!\) /, "");
      titleFlash = setInterval(() => { document.title = document.title.startsWith("(!) ") ? base : "(!) " + base; }, 1000);
      const stop = () => { clearInterval(titleFlash); document.title = base; document.removeEventListener("visibilitychange", stop); };
      document.addEventListener("visibilitychange", stop);
      try {
        if ("Notification" in window && Notification.permission === "granted") {
          const n = new Notification("Retro Hub", { body: text, tag, icon: "/icon.svg" });
          n.onclick = () => { window.focus(); n.close(); };
        }
      } catch {}
    }
  }
  const askNotify = () => { try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); } catch {} };

  // ---- 🔔 Alert me: the current filters become a watch, kept in this browser.
  function lbWatchLabel(w) {
    const parts = [];
    if (w.q) parts.push(`"${w.q}"`);
    if (w.system) parts.push(config.systems[w.system] || w.system);
    if (w.mode) parts.push(MODE_LABEL[w.mode] || w.mode);
    if (w.min > 1) parts.push(`${w.min}+ players`);
    if (w.open) parts.push("open seats"); if (w.nopw) parts.push("no password"); if (w.waiting) parts.push("not started");
    if (w.friends) parts.push("with friends"); if (w.here) parts.push("this hub");
    return parts.length ? parts.join(", ") : "any lobby";
  }
  function renderWatch() {
    const w = Settings.get("lbWatch");
    $("lb-watch").setAttribute("aria-pressed", String(!!w));
    $("lb-watch").textContent = w ? "🔕 Stop alert" : "🔔 Alert me";
    $("lb-watching").hidden = !w;
    if (w) $("lb-watching").textContent = `Alerting you when a lobby opens that matches: ${lbWatchLabel(w)}.`;
  }
  $("lb-watch").addEventListener("click", () => {
    if (Settings.get("lbWatch")) { Settings.set("lbWatch", null); toast("Alert off."); }
    else {
      const f = lbFilters(); delete f.sort; delete f.dir;
      Settings.set("lbWatch", f); LB.alerted.clear(); LB.baselined = false; askNotify();
      toast(`Alert on: ${lbWatchLabel(f)}. You'll hear about new lobbies like that while this page is open (a background tab is fine).`, { kind: "ok", ms: 5000 });
    }
    renderWatch(); renderBrowser();
  });
  function lbCheckWatch(rows) {
    const w = Settings.get("lbWatch"); if (!w) return;
    if (!LB.baselined) {
      if (!LB.roomsSeen) return;
      for (const row of rows) if (!row.mine && lbMatch(row, w)) LB.alerted.add(row.key);
      LB.baselined = true;
      return;
    }
    const seen = new Set();
    for (const row of rows) {
      if (row.mine || !lbMatch(row, w)) continue;
      seen.add(row.key);
      if (LB.alerted.has(row.key)) continue;
      LB.alerted.add(row.key);
      const go = row.src === "hub" ? () => { $("tab-lobbies").click(); openJoin(row.r, false, row.open === 0 && row.watchable); } : () => { const u = safeHttp(row.href); if (u) window.open(u, "_blank", "noopener,noreferrer"); };
      lbAlert(`Lobby found: ${row.host} is hosting ${row.game}${config.systems[row.system] ? " (" + config.systems[row.system] + ")" : ""}${row.src === "hub" ? "" : " on " + row.where}.`,
        { label: row.open > 0 ? "Join" : "Show", run: go }, "rh-watch-" + row.key);
    }
    for (const k of LB.alerted) if (!seen.has(k)) LB.alerted.delete(k);     // closed or no longer matching: alert again if it comes back
  }

  // ---- ⏳ Wait for a seat (this hub's lobbies): retry as soon as the lobby list shows an open seat.
  function startWaiting(room, password) {
    LB.waiting = { code: room.code, password, game: room.game || "the game", host: room.host, since: Date.now() };
    askNotify();
    renderWait(); renderBrowser();
    toast(`Waiting for a seat in ${room.host}'s lobby. You'll join automatically.`, { ms: 4000 });
  }
  function stopWaiting(msg) {
    if (!LB.waiting) return;
    LB.waiting = null; renderWait(); renderBrowser();
    if (msg) toast(msg, { ms: 4000 });
  }
  function seatFound(room) { lbAlert(`A seat opened: you joined ${room.host}'s lobby (${room.game || "game"}).`, null, "rh-seat"); }
  function renderWait() {
    const w = LB.waiting, box = $("lb-wait");
    box.hidden = !w;
    if (!w) return;
    box.innerHTML = `⏳ Waiting for a seat in <b>${esc(w.host)}</b>'s lobby (${esc(w.game)}). You'll join the moment one opens. <button class="small" id="lb-wait-stop">Stop waiting</button>`;
    $("lb-wait-stop").onclick = () => stopWaiting("Stopped waiting.");
  }
  function lbCheckWait() {
    const w = LB.waiting; if (!w || joining) return;
    const r = state.rooms.find(x => x.code === w.code);
    if (!r) return stopWaiting(`${w.host}'s lobby closed, so you stopped waiting.`);
    if (r.open > 0) { joinWatch = false; doJoin(r, w.password, { quiet: true }); }
  }
  renderWatch();

  // ================================================================ game picker (hub card + "Change game" dialog)
  const fileExt = f => (String(f?.name || "").split(".").pop() || "").toLowerCase();
  // onActivate (optional): double-click / Ctrl+Enter on a library game = pick it and go.
  function makePicker(box, onPick, onActivate) {
    const tab = Settings.get("tab") === "lib" ? "lib" : "file";
    box.innerHTML = `
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="file">My files</button>
        <button role="tab" data-tab="lib" hidden>Server library</button>
      </div>
      <div data-panel="file">
        <p class="small muted">Pick a game file from this computer. It stays here: it's never uploaded.</p>
        <input type="file" class="rom-file" aria-label="Game file">
      </div>
      <div data-panel="lib" hidden>
        <div class="lib-tools">
          <input type="search" class="lib-search" placeholder="Search the library" aria-label="Search the library">
          <select class="lib-sys" aria-label="Console"><option value="">All consoles</option></select>
          <select class="lib-sort" aria-label="Sort games">
            <option value="name">A–Z</option><option value="recent">Recently played</option><option value="system">By console</option>
          </select>
          <label class="check small lib-hidden-wrap" hidden title="Games you hid stay hidden from everyone else"><input type="checkbox" class="lib-show-hidden"> <span>Show hidden</span></label>
          <select class="lib-covers" aria-label="Cover art" hidden title="Auto covers: box art from libretro-thumbnails, matched by file name. Right-click a game for more.">
            <option value="off">Covers: my own only</option><option value="libretro">Covers: auto (libretro)</option>
          </select>
        </div>
        <div class="small muted lib-count" aria-live="polite"></div>
        <div class="library lib-grid" role="listbox" aria-label="Games"></div>
      </div>`;
    const q = s => box.querySelector(s);
    let picked = null;
    const select = name => {
      if (name === "lib" && !me.library) name = "file";
      box.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
      box.querySelectorAll("[data-panel]").forEach(p => { p.hidden = p.dataset.panel !== name; });
      Settings.set("tab", name);
      if (name === "lib") loadLibrary(q(".library"), render);
    };
    box.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => select(b.dataset.tab)));
    q(".rom-file").addEventListener("change", () => {
      const f = q(".rom-file").files[0]; if (!f) return;
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      picked = { kind: "file", file: f, name: f.name.replace(/\.[^.]+$/, ""), system: config.detect.ext[ext] || "" };
      onPick(picked);
    });
    const libPrefs = () => ({ sys: "", sort: "name", ...(Settings.get("lib") || {}) });
    q(".lib-sort").value = libPrefs().sort;
    q(".lib-sys").addEventListener("change", () => { Settings.patch("lib", { sys: q(".lib-sys").value }); render(); });
    q(".lib-sort").addEventListener("change", () => { Settings.patch("lib", { sort: q(".lib-sort").value }); render(); });
    q(".lib-show-hidden").addEventListener("change", () => render());
    // Favorites: kept in this browser, shown first in every sort. Right-click a game or press F on it.
    const favs = () => new Set(Settings.get("favs") || []);
    const toggleFav = g => {
      const f = favs(), on = !f.has(g.path);
      on ? f.add(g.path) : f.delete(g.path);
      Settings.set("favs", [...f].slice(-500));
      toast(on ? `★ ${g.name} added to favorites.` : `${g.name} removed from favorites.`, { kind: on ? "ok" : "" });
      render();
      q(`.tile[data-path="${CSS.escape(g.path)}"]`)?.focus();
    };
    let sysFilled = false;
    const render = () => {
      if (!state.library) return;
      const lib = q(".library"), term = q(".lib-search").value.trim().toLowerCase();
      const prefs = libPrefs();
      if (!sysFilled) {           // only consoles that are actually in the library
        sysFilled = true;
        const present = [...new Set(state.library.map(g => g.system))].sort((a, b) => (config.systems[a] || a).localeCompare(config.systems[b] || b));
        for (const id of present) { const o = document.createElement("option"); o.value = id; o.textContent = config.systems[id] || id; q(".lib-sys").appendChild(o); }
        q(".lib-sys").value = present.includes(prefs.sys) ? prefs.sys : "";
        q(".lib-sys").hidden = present.length < 2;
      }
      const sys = q(".lib-sys").value, fav = favs();
      const hiddenCount = state.library.filter(g => g.hidden).length, showHidden = q(".lib-show-hidden").checked;
      q(".lib-hidden-wrap").hidden = !hiddenCount;
      q(".lib-hidden-wrap span").textContent = `Show hidden (${hiddenCount})`;
      lib.textContent = "";
      if (!state.library.length) {
        lib.innerHTML = `<div class="empty"><div class="empty-title">No games in the server's ROM folder yet.</div>
          <div class="small">Put ROM files in <code>roms/</code> (one folder per console, e.g. <code>roms/snes</code>) and reopen this tab.</div></div>`;
        q(".lib-count").textContent = ""; return;
      }
      const recent = Settings.get("recent") || [];
      const rank = g => { const i = recent.indexOf(g.path); return i < 0 ? 1e9 : i; };
      const sysName = id => config.systems[id] || id;
      const favFirst = (a, b) => fav.has(b.path) - fav.has(a.path);
      const shown = state.library.filter(g => showHidden || !g.hidden);
      const items = shown
        .filter(g => (!sys || g.system === sys) && (!term || g.name.toLowerCase().includes(term) || g.path.toLowerCase().includes(term)))
        .sort(prefs.sort === "recent" ? (a, b) => favFirst(a, b) || rank(a) - rank(b) || a.name.localeCompare(b.name)
          : prefs.sort === "system" ? (a, b) => sysName(a.system).localeCompare(sysName(b.system)) || favFirst(a, b) || a.name.localeCompare(b.name)
          : (a, b) => favFirst(a, b) || a.name.localeCompare(b.name));
      const favShown = shown.filter(g => fav.has(g.path)).length;
      q(".lib-count").textContent = (items.length === shown.length ? `${items.length} game${items.length === 1 ? "" : "s"}` : `${items.length} of ${shown.length} games`)
        + (favShown ? ` · ★ ${favShown} favorite${favShown === 1 ? "" : "s"}` : "");
      if (!items.length) { lib.innerHTML = '<div class="empty">No games match.</div>'; return; }
      // "By console": one heading per console (with its game count) so the grouping is visible; clicking a
      // heading shows only that console, clicking it again shows them all.
      const grouped = prefs.sort === "system" && !sys;
      const perSys = grouped ? items.reduce((m, g) => m.set(g.system, (m.get(g.system) || 0) + 1), new Map()) : null;
      let lastSys = null;
      for (const g of items) {
        if (grouped && g.system !== lastSys) {
          lastSys = g.system;
          const h = document.createElement("button");
          h.type = "button"; h.className = "lib-group"; h.dataset.sys = g.system;
          h.title = `Show only ${sysName(g.system)} games`;
          h.innerHTML = `<span class="lib-group-name"></span><span class="muted small"></span>`;
          h.firstChild.textContent = sysName(g.system);
          h.lastChild.textContent = `${perSys.get(g.system)} game${perSys.get(g.system) === 1 ? "" : "s"}`;
          h.addEventListener("click", () => {
            const sel = q(".lib-sys");
            if (![...sel.options].some(o => o.value === g.system)) return;
            sel.value = g.system; Settings.patch("lib", { sys: g.system }); render();
          });
          lib.appendChild(h);
        }
        const t = document.createElement("button");
        t.type = "button"; t.className = "tile" + (g.hidden ? " is-hidden" : ""); t.setAttribute("role", "option"); t.dataset.path = g.path;
        t.setAttribute("aria-selected", String(picked?.kind === "lib" && picked.item.path === g.path));
        t.title = `${g.name}\n${sysName(g.system)} · ${g.ext.toUpperCase()} · ${fmtSize(g.size)}`;
        t.innerHTML = `<span class="cover" style="--hue:${sysHue(g.system)}"><span class="cover-sys">${esc(sysShort(g.system))}</span><span class="cover-init">${esc(initials(g.name))}</span></span>
          <span class="t-name"></span><span class="t-sub"></span>${rank(g) < 1e9 ? '<span class="t-recent" title="Played recently"></span>' : ""}${fav.has(g.path) ? '<span class="t-fav" title="Favorite">★</span>' : ""}${g.hidden ? '<span class="t-hidden">Hidden</span>' : ""}`;
        t.querySelector(".t-name").textContent = g.name;
        t.querySelector(".t-sub").textContent = `${sysShort(g.system)} · ${fmtSize(g.size)}`;
        if (g.cover) {
          const img = new Image(); img.alt = ""; img.loading = "lazy"; img.decoding = "async";
          img.addEventListener("load", () => {
            t.querySelector(".cover").classList.add("has-img");
            // A full case scan (back, spine, front: TheCoverProject style) is much wider than tall: show its front half.
            if (img.naturalWidth / img.naturalHeight > 1.55) img.classList.add("wrap");
          });
          img.addEventListener("error", () => img.remove());
          img.src = "/covers/" + g.cover.split("/").map(encodeURIComponent).join("/");
          t.querySelector(".cover").appendChild(img);
        }
        if (onActivate) {
          t.title += "\nDouble-click to open a lobby with it";
          t.addEventListener("dblclick", () => onActivate());
          t.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); t.click(); onActivate(); } });
        }
        t.addEventListener("keydown", e => { if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleFav(g); } });
        t.addEventListener("click", () => {
          picked = { kind: "lib", item: g, name: g.name, system: g.system };
          lib.querySelectorAll(".tile").forEach(x => x.setAttribute("aria-selected", "false"));
          t.setAttribute("aria-selected", "true");
          onPick(picked);
        });
        lib.appendChild(t);
      }
    };
    // Arrow keys move between tiles (row by row, using the rendered layout).
    q(".library").addEventListener("keydown", e => {
      if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
      const tiles = [...q(".library").querySelectorAll(".tile")], i = tiles.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const cols = Math.max(1, tiles.filter(t => t.offsetTop === tiles[0].offsetTop).length);
      const j = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" ? i - cols : i + cols;
      tiles[Math.max(0, Math.min(tiles.length - 1, j))].focus();
    });
    q(".lib-search").addEventListener("input", UI.debounce(render, 120));
    // ---- cover art (owner): auto covers on/off, right-click a game for TheCoverProject / your own image,
    // or drop an image file onto a game.
    const owner = () => me.role === "admin";
    const coverPost = (url, body, type = "application/json") => fetch(url, { method: "POST", headers: { "Content-Type": type, "X-Retro-Hub": "covers" }, body })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; });
    const refreshCovers = async () => { state.library = null; libLoading = null; await loadLibrary(q(".library"), render); };
    if (owner()) {
      const sel = q(".lib-covers"); sel.hidden = false;
      fetch("/api/covers", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(st => { if (st) sel.value = st.auto; }).catch(() => {});
      sel.addEventListener("change", async () => {
        try {
          const st = await coverPost("/api/covers", JSON.stringify({ auto: sel.value }));
          toast(st.auto === "libretro" ? `Fetching covers in the background${st.queued ? ` (${st.queued} games)` : ""}. They appear as they arrive.` : "Auto covers off. Covers already fetched stay.", { ms: 5000 });
          if (st.auto === "libretro") { let n = 0; const t = setInterval(async () => { await refreshCovers(); if (++n >= 6) clearInterval(t); }, 10000); }
        } catch (e) { toast(e.message, { kind: "bad" }); }
      });
    }
    async function setCover(g, file) {
      try {
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG, JPEG or WebP image.");
        await coverPost(`/api/covers/upload?path=${encodeURIComponent(g.path)}`, file, file.type);
        toast(`Cover set for ${g.name}.`, { kind: "ok" }); await refreshCovers();
      } catch (e) { toast(e.message, { kind: "bad", ms: 5000 }); }
    }
    let menu = null;
    const closeMenu = () => { menu?.remove(); menu = null; };
    window.addEventListener("pointerdown", e => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
    const hidePost = (g, hidden) => fetch("/api/library/hide", { method: "POST", headers: { "Content-Type": "application/json", "X-Retro-Hub": "library" }, body: JSON.stringify({ path: g.path, hidden }) })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; });
    async function setHidden(g, hidden) {
      try {
        await hidePost(g, hidden);
        if (hidden) g.hidden = true; else delete g.hidden;
        render();
        toast(hidden ? `${g.name} hidden from the library.` : `${g.name} is back in the library.`, hidden ? { ms: 6000, action: { label: "Undo", run: () => setHidden(g, false) } } : { kind: "ok" });
      } catch (err) { toast(err.message, { kind: "bad" }); }
    }
    q(".library").addEventListener("contextmenu", e => {
      const t = e.target.closest(".tile"); if (!t) return;
      const g = state.library?.find(x => x.path === t.dataset.path); if (!g) return;
      e.preventDefault(); closeMenu();
      menu = document.createElement("div"); menu.className = "ctx-menu"; menu.setAttribute("role", "menu");
      const item = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem"); b.textContent = label; b.onclick = () => { closeMenu(); fn(); }; menu.appendChild(b); };
      item(favs().has(g.path) ? "Remove from favorites  (F)" : "★ Add to favorites  (F)", () => toggleFav(g));
      if (owner()) item(g.hidden ? "Unhide (show in the library)" : "Hide from the library", () => setHidden(g, !g.hidden));
      if (owner() && !g.app) item("Find a cover on TheCoverProject ↗", () => window.open(`https://www.thecoverproject.net/view.php?searchstring=${encodeURIComponent(g.name.replace(/\s*[([].*$/, ""))}`, "_blank", "noopener"));
      if (owner() && !g.app) item("Set cover from an image file…", () => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/png,image/jpeg,image/webp"; i.onchange = () => i.files[0] && setCover(g, i.files[0]); i.click(); });
      if (owner() && String(g.cover || "").includes(".manual.")) item("Remove my cover", async () => { try { await coverPost(`/api/covers/remove?path=${encodeURIComponent(g.path)}`, "{}"); await refreshCovers(); } catch (err) { toast(err.message, { kind: "bad" }); } });
      document.body.appendChild(menu);
      menu.style.left = Math.min(e.clientX, innerWidth - menu.offsetWidth - 8) + "px";
      menu.style.top = Math.min(e.clientY, innerHeight - menu.offsetHeight - 8) + "px";
      menu.querySelector("button").focus();
    });
    q(".library").addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
    q(".library").addEventListener("dragover", e => { if (owner() && e.target.closest(".tile") && [...e.dataTransfer.items].some(i => i.type.startsWith("image/"))) { e.preventDefault(); e.target.closest(".tile").classList.add("drop"); } });
    q(".library").addEventListener("dragleave", e => e.target.closest(".tile")?.classList.remove("drop"));
    q(".library").addEventListener("drop", e => {
      const t = e.target.closest(".tile"); if (!t || !owner()) return;
      e.preventDefault(); t.classList.remove("drop");
      const f = [...e.dataTransfer.files].find(x => x.type.startsWith("image/")), g = state.library?.find(x => x.path === t.dataset.path);
      if (f && g) setCover(g, f);
    });
    box.__refresh = () => { q("[data-tab=lib]").hidden = !me.library; select(me.library ? Settings.get("tab") : "file"); };
    q("[data-tab=lib]").hidden = !me.library;
    select(tab);
    return { reset() { picked = null; q(".rom-file").value = ""; render(); } };
  }
  const SYS_SHORT = { n64: "N64", nes: "NES", snes: "SNES", gb: "GB", gbc: "GBC", gba: "GBA", nds: "DS", psx: "PS1", segaMD: "MD", segaMS: "SMS",
    segaGG: "GG", segaCD: "SCD", sega32x: "32X", segaSaturn: "SAT", atari2600: "2600", atari7800: "7800", lynx: "LYNX", jaguar: "JAG",
    pce: "PCE", ngp: "NGP", ws: "WS", vb: "VB", coleco: "CV", arcade: "ARC", psp: "PSP",
    ps2: "PS2", gc: "GC", wii: "WII", ps3: "PS3", xbox360: "360", wiiu: "WIIU", switch: "NSW", xbox: "XBOX", n3ds: "3DS",
    dreamcast: "DC", pc: "PC" };
  // Native emulators (PS2 and newer) run on the hub's computer, launched by the server: library games only.
  const isNative = sys => (config?.nativeSystems || []).includes(sys);
  const isLinkGame = g => ["gba", "gb", "gbc", "gbalink"].includes(g?.system) && ["gba", "gb", "gbc"].includes(g?.ext) && !g.app;
  const sysShort = id => SYS_SHORT[id] || String(id || "?").toUpperCase().slice(0, 4);
  const sysHue = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  // "The Legend of Zelda (U) [!]" -> "LZ": first letters of the main words, tags in brackets dropped.
  const initials = name => (String(name).replace(/[([].*$/, "").replace(/([a-z])(?=[A-Z0-9])|(of)(?=[A-Z])/g, "$1$2 ").match(/[A-Za-z0-9]+/g) || ["?"])
    .filter(w => !/^(the|of|a|an|and|de|la|le)$/i.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
  function rememberPlayed(item) {
    const recent = (Settings.get("recent") || []).filter(p => p !== item.path);
    Settings.set("recent", [item.path, ...recent].slice(0, 30));
  }
  let libLoading = null;
  async function loadLibrary(box, render) {
    if (state.library) return render();
    box.innerHTML = '<div class="empty">Loading…</div>';
    libLoading = libLoading || fetch("/api/library", { cache: "no-store" }).then(async r => r.ok ? r.json() : null).finally(() => { libLoading = null; });
    // A big library (or one on a network drive) takes a while to scan the first time: show how far it's got.
    let waiting = true, jet = null;
    const progress = async () => {
      while (waiting) {
        await new Promise(r => setTimeout(r, 1000));
        const st = waiting && await fetch("/api/library/status", { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (!waiting || !st?.scanning) continue;
        // the text stays underneath (shown if the jet is off or skipped); the jet sits on top of it (public/jetfx)
        let txt = box.querySelector(".lib-scan");
        if (!txt) { box.innerHTML = '<div class="empty lib-scan"></div>'; txt = box.firstChild; }
        txt.innerHTML = `<div class="empty-title">Scanning the library…</div>
          <div class="small">${st.found.toLocaleString()} game${st.found === 1 ? "" : "s"} found so far (${st.seconds} s). Big libraries and network drives take a minute the first time.</div>`;
        jet = jet || window.RH.JetFX?.hold("library", { mount: box, delay: 300, kicker: "Please wait", title: "Scanning the library", progress: null, tips: false });
        jet?.update({ status: `${st.found.toLocaleString()} game${st.found === 1 ? "" : "s"} found · ${st.seconds} s` });
      }
    };
    progress();
    const lib = await libLoading.finally(() => { waiting = false; jet?.done(); });
    if (!lib) { box.innerHTML = '<div class="empty">The library is owner-only.</div>'; return; }
    state.library = lib; render();
  }

  // ================================================================ host form
  function renderSystems() {
    for (const sel of [$("system"), $("r-system")]) {
      for (const [id, label] of Object.entries(config.systems)) {
        const o = document.createElement("option"); o.value = id; o.textContent = label; sel.appendChild(o);
      }
    }
    $("system").addEventListener("change", () => {
      if (hubPicked?.kind === "file" && !hubPicked.system && $("system").value)
        Settings.patch("extSys", { [fileExt(hubPicked.file)]: $("system").value });
      // Remember the choice for this game's console (picking its own console again goes back to the default).
      if (hubPicked?.kind === "lib" && !hubPicked.item.app && hubPicked.system && $("system").value)
        Settings.patch("consoleFor", { [hubPicked.system]: $("system").value === hubPicked.system ? "" : $("system").value });
      if (hubCoop && $("system").value !== hubCoop.system) { hubCoop = null; coopRender(); }
      updateHostBtn();
    });
  }
  // A library game can be hosted on any console that takes its file type: GBA in the browser or in VBA-M
  // (GBA link), DS in the browser or melonDS, a game in another native emulator. Consoles that can't run it are greyed out.
  const takesExt = (sys, ext) => { const e = config.systemExts?.[sys]; return !e || e.includes(ext) || (config.ambiguousExts || []).includes(ext); };
  function markConsoles(p) {
    const ext = p?.kind === "lib" && !p.item?.app ? String(p.item.ext || "").toLowerCase() : "";
    for (const o of $("system").options) if (o.value) o.disabled = !!ext && !takesExt(o.value, ext);
  }
  function renderSeats() {
    const box = $("seats"); box.textContent = "";
    const p1 = document.createElement("label"); p1.className = "check";
    p1.innerHTML = `<input type="checkbox" checked disabled> P1: you`;
    box.appendChild(p1);
    const saved = new Set(Settings.get("localSeats") || []);      // remembered from the last lobby you hosted
    for (let s = 1; s < config.maxPlayers; s++) {
      const l = document.createElement("label"); l.className = "check";
      l.innerHTML = `<input type="checkbox" data-seat="${s}"${saved.has(s) ? " checked" : ""}> P${s + 1} on this computer`;
      box.appendChild(l);
    }
    box.addEventListener("change", () => {
      Settings.set("localSeats", [...box.querySelectorAll("[data-seat]")].filter(c => c.checked).map(c => Number(c.dataset.seat)));
      seatHelp();
    });
    seatHelp();
  }
  const localSeats = () => hostMode() === "ghost" ? [0] : [0, ...[...document.querySelectorAll("[data-seat]")].filter(c => c.checked).map(c => Number(c.dataset.seat))];
  function seatHelp() {
    const seats = localSeats();
    const parts = seats.map((s, i) => `P${s + 1}: ${i === 0 ? "keyboard (arrows) or gamepad 1" : i === 1 ? "numpad keys or gamepad 2" : `gamepad ${i + 1}`}`);
    const online = config.maxPlayers - seats.length;
    $("seat-help").textContent = parts.join(" · ") + ` · ${online} seat${online === 1 ? "" : "s"} open online.`;
  }
  function showPicked(note) {
    const p = hubPicked;
    $("picked").hidden = !p;
    if (p) $("picked").innerHTML = `Game: <b class="trunc-inline" title="${esc(p.name)}">${esc(p.name)}</b> <span class="muted">(${p.kind === "file" ? "from this computer" : "server library"})</span>${note ? `<div class="small muted">${esc(note)}</div>` : ""}`;
    updateHostBtn();
  }
  // GBA / Game Boy link play: a link-cable game runs in VBA-M on each player's PC (GBA link cable panel),
  // never in EmulatorJS, which can't link. Shown for library GBA/GB games when VBA-M is installed.
  const canLink = p => p?.kind === "lib" && isLinkGame(p.item) && !!(linkState?.available && linkState.installed);
  const linkChosen = () => canLink(hubPicked) && document.querySelector("input[name=playin]:checked")?.value === "link";
  let playInFor = null;
  function renderPlayIn() {
    const show = canLink(hubPicked);
    $("playin-wrap").hidden = !show;
    if (!show || playInFor === hubPicked.item.path) return;
    playInFor = hubPicked.item.path;           // pick the default once per game, not on every refresh
    // Games in VBA-M's own folders (system gbalink) always default to the link cable; others remember the last pick.
    const want = hubPicked.system === "gbalink" ? "link" : (Settings.get("playIn") === "link" ? "link" : "browser");
    document.querySelectorAll("input[name=playin]").forEach(r => { r.checked = r.value === want; });
  }
  document.querySelectorAll("input[name=playin]").forEach(r => r.addEventListener("change", () => {
    Settings.set("playIn", linkChosen() ? "link" : "browser"); updateHostBtn();
  }));
  // ---- 🤝 Co-op ROM hacks: a library ROM that is a listed hack's base (core/coop-hacks.json) gets "Patch for co-op"
  // next to it. Owner on the hub's own PC only (the hacks play in Project64 there). The patched copy is made by the
  // server when the game starts; the ROM itself is never changed.
  let hubCoop = null, coopState = null;
  async function coopCheck(p) {
    hubCoop = null; coopState = null; coopRender();
    if (p?.kind !== "lib" || p.item.app || me.role !== "admin" || !LOCAL_HOST_RE.test(location.hostname)) return;
    if (!["z64", "n64", "v64"].includes(String(p.item.ext || "").toLowerCase())) return;
    const mine = coopState = { p, r: null };
    const r = await fetch(`/api/coop?path=${encodeURIComponent(p.item.path)}`, { cache: "no-store" }).then(x => x.ok ? x.json() : null).catch(() => null);
    if (coopState !== mine || hubPicked !== p) return;
    mine.r = r && (r.offers.length || r.notes.length) ? r : null;
    coopRender();
  }
  function coopRender() {
    let box = $("coop-box");
    const r = coopState?.r;
    if (!r || hostShuffle()) { box?.remove(); return; }
    if (!box) { box = document.createElement("div"); box.id = "coop-box"; box.className = "coop-box"; $("picked").after(box); box.addEventListener("click", coopClick); }
    const base = r.offers[0]?.base;
    box.innerHTML = (base ? `<div class="coop-ok">✓ Recognized: <b>${esc(base)}</b></div>` : "") +
      r.offers.map((o, i) => {
        const missing = [!o.patch.found && o.patch.file, o.cheats && !o.cheats.found && `${o.cheats.file} (cheats: ${o.cheats.group})`].filter(Boolean);
        const on = hubCoop && hubCoop.hack === o.hack && hubCoop.variant === o.variant;
        return `<div class="coop-row"><button type="button" class="small" data-coop="${i}"${missing.length ? " disabled" : ""} aria-pressed="${!!on}">🤝 Patch for co-op: ${esc(o.name)}</button>
          <span class="small muted">${o.players} players · plays in Project64${o.version ? ` · v${esc(o.version)}` : ""}</span>
          ${missing.length ? `<div class="small coop-miss">Not found: ${esc(missing.join(", "))}. Put it next to the ROM or in the hub's <code>patches</code> folder, or <button type="button" class="linkish" data-coop-add>add the file…</button>${o.where ? ` ${esc(o.where)}` : ""}</div>` : ""}
          ${o.tested ? `<div class="small muted coop-tested">${esc(o.tested)}</div>` : ""}</div>`;
      }).join("") +
      r.notes.map(n => `<div class="small muted coop-note">ℹ ${esc(n.note)}</div>`).join("") +
      (hubCoop ? `<div class="small coop-on"><b>${esc(hubCoop.name)}</b> is set: the lobby plays it in Project64. ${esc(hubCoop.notes || "")} Hack by ${esc(hubCoop.credit || "its authors")}. <button type="button" class="linkish" data-coop-off>Play the unpatched game instead</button></div>` : "") +
      '<input type="file" class="coop-file" accept=".ppf,.ips,.bps,.ups,.cht" hidden>';
    box.querySelector(".coop-file").addEventListener("change", coopUpload);
  }
  function coopClick(e) {
    const r = coopState?.r; if (!r) return;
    const pick = e.target.closest("[data-coop]");
    if (pick) {
      const o = r.offers[Number(pick.dataset.coop)];
      hubCoop = o;
      if ([...$("system").options].some(x => x.value === o.system)) $("system").value = o.system;
      const coopRadio = document.querySelector("input[name=mode][value=coop]");
      if (coopRadio && !coopRadio.checked) { coopRadio.checked = true; coopRadio.dispatchEvent(new Event("change", { bubbles: true })); }
      coopRender(); updateHostBtn();
      toast(`${o.name}: open the lobby and start it as usual. The patched copy is made when the game starts.`, { kind: "ok", ms: 5000 });
    } else if (e.target.closest("[data-coop-off]")) {
      hubCoop = null;
      if (hubPicked?.system) $("system").value = hubPicked.system;
      coopRender(); updateHostBtn();
    } else if (e.target.closest("[data-coop-add]")) $("coop-box").querySelector(".coop-file").click();
  }
  async function coopUpload(e) {
    const f = e.target.files[0]; if (!f) return;
    try {
      const r = await fetch("/api/coop/patch-file", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Retro-Hub": "coop", "X-File-Name": encodeURIComponent(f.name).slice(0, 200) }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      toast(`Saved ${j.saved} in the hub's patches folder.`, { kind: "ok" });
      coopCheck(hubPicked);
    } catch (err) { toast(err.message, { kind: "bad", ms: 7000 }); }
  }
  // ---- 🗡️ GBA screens: GameCube games played with GBA controllers (Four Swords Adventures...). Owner on the hub's
  // own PC; Dolphin runs every port as an integrated GBA and each GBA window is streamed only to its player.
  let hubGba = null, gbaState = null;
  async function gbaCheck(p) {
    hubGba = null; gbaState = null; gbaRender();
    if (p?.kind !== "lib" || p.item.app || p.system !== "gc" || me.role !== "admin" || !LOCAL_HOST_RE.test(location.hostname)) return;
    const mine = gbaState = { p, r: null };
    const r = await fetch(`/api/native/gba?path=${encodeURIComponent(p.item.path)}`, { cache: "no-store" }).then(x => x.ok ? x.json() : null).catch(() => null);
    if (gbaState !== mine || hubPicked !== p) return;
    mine.r = r?.game ? r : null;
    gbaRender();
  }
  function gbaRender() {
    let box = $("gba-box");
    const r = gbaState?.r;
    if (!r || hostShuffle()) { box?.remove(); return; }
    if (!box) { box = document.createElement("div"); box.id = "gba-box"; box.className = "coop-box gba-box"; ($("coop-box") || $("picked")).after(box); box.addEventListener("click", gbaClick); }
    const padsOk = r.pads?.ok && r.pads.mode === "gamepad";
    const blockers = [!r.bios.ok && r.bios.error, !padsOk && "Guests need virtual gamepads for their GBAs: install ViGEmBus + vgamepad (Retro Hub's setup/deps.ps1 does it)."].filter(Boolean);
    box.innerHTML = `<div class="coop-ok">🗡️ <b>${esc(r.game.name)}</b> uses Game Boy Advance controllers.</div>
      <div class="coop-row"><button type="button" class="small" data-gba-on aria-pressed="${!!hubGba}"${r.bios.ok ? "" : " disabled"}>🎮 GBA screens mode (${r.game.players} players)</button>
        <span class="small muted">Dolphin with ${r.game.players} built-in GBAs. ${esc(r.game.note)}</span></div>
      ${blockers.map(b => `<div class="small coop-miss">${esc(b)}</div>`).join("")}
      ${hubGba ? `<div class="small coop-on">GBA screens mode is on: after the game starts, share the TV window, then each GBA window. <button type="button" class="linkish" data-gba-off>Turn it off</button></div>` : ""}`;
  }
  function gbaClick(e) {
    const r = gbaState?.r; if (!r) return;
    if (e.target.closest("[data-gba-on]")) { hubGba = { players: r.game.players, name: r.game.name }; gbaRender(); updateHostBtn(); }
    else if (e.target.closest("[data-gba-off]")) { hubGba = null; gbaRender(); updateHostBtn(); }
  }
  // ---- 🔀 Shuffle lobbies: the list of games for the host form
  const hostShuffleList = [];
  const hsPrefs = () => ({ min: 15, max: 45, saver: true, ...(Settings.get("shuffle") || {}) });
  function addHostShuffle(p) {
    if (hostShuffleList.length >= 8) return toast("Up to 8 games.", { kind: "bad" });
    const sys = p.system || (p.kind === "file" ? (Settings.get("extSys") || {})[fileExt(p.file)] : "") || "";
    if (sys && isNative(sys)) return toast(`${config.systems[sys]} games need a native emulator, so they can't be shuffled.`, { kind: "bad", ms: 5000 });
    hostShuffleList.push({ ...p, system: sys });
    renderHostShuffle();
  }
  function renderHostShuffle() {
    if (!config || !$("hs-games")) return;
    const p = hsPrefs();
    if (!$("hs-min").value) { $("hs-min").value = p.min; $("hs-max").value = p.max; $("hs-saver").checked = p.saver; }
    const opts = sys => Object.keys(config.systems).filter(id => !isNative(id)).map(id => `<option value="${id}"${id === sys ? " selected" : ""}>${esc(config.systems[id])}</option>`).join("");
    $("hs-games").innerHTML = hostShuffleList.map((g, i) => `<li><span class="slotnum">${i + 1}</span><span class="pname trunc grow" title="${esc(g.name)}">${esc(g.name)}</span>
      <select data-hs-sys="${i}" aria-label="Console for ${esc(g.name)}"><option value="">Console…</option>${opts(g.system)}</select>
      <button class="small ghost icon" data-hs-rm="${i}" aria-label="Remove ${esc(g.name)}">✕</button></li>`).join("") || '<li class="small muted">Pick games in the box below: each one is added here.</li>';
    updateHostBtn();
  }
  document.addEventListener("change", e => {
    if (e.target.dataset?.hsSys != null) { hostShuffleList[e.target.dataset.hsSys].system = e.target.value; renderHostShuffle(); }
    if (["hs-min", "hs-max", "hs-saver"].includes(e.target.id)) {
      const min = Math.max(5, Math.min(600, Number($("hs-min").value) || 15)), max = Math.max(min, Math.min(900, Number($("hs-max").value) || 45));
      $("hs-min").value = min; $("hs-max").value = max;
      Settings.set("shuffle", { ...(Settings.get("shuffle") || {}), min, max, saver: $("hs-saver").checked });
    }
  });
  document.addEventListener("click", e => { const i = e.target.closest?.("[data-hs-rm]")?.dataset.hsRm; if (i != null) { hostShuffleList.splice(Number(i), 1); renderHostShuffle(); } });
  function updateHostBtn() {
    if (hostShuffle()) {
      const ok = hostShuffleList.length >= 2 && hostShuffleList.every(g => g.system);
      $("host-btn").textContent = "Open shuffle lobby"; $("host-btn").disabled = !ok;
      showErr($("host-error"), hostShuffleList.length >= 2 && !ok ? "Pick the console for every game." : "");
      return;
    }
    const link = linkChosen();
    $("host-btn").textContent = link ? "Host link session" : "Open lobby";
    $("playin-help").textContent = link ? "Everyone plays their own copy in VBA-M on their own PC (same network, same ROM). Friends join from Other hubs nearby." : "";
    document.querySelector(".mode-pick").hidden = link;
    if (link) { $("host-btn").disabled = false; showErr($("host-error"), ""); return; }
    document.querySelector(".mode-pick").hidden = false;
    const sys = $("system").value, nativeFile = isNative(sys) && hubPicked?.kind !== "lib";
    $("host-btn").disabled = !(hubPicked && sys) || nativeFile;
    showErr($("host-error"), nativeFile && hubPicked
      ? `${config.systems[sys]} games run in a native emulator on the hub's computer: pick the game from the server library.` : "");
  }

  const CODE_CHARS = "ABCDEFGHJKMNPQRTUVWXY346789";      // no look-alikes: 0/O, 1/I/L, 2/Z, 5/S
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => CODE_CHARS[b % CODE_CHARS.length]).join("");

  const openLobby = guard($("host-btn"), async () => {
    if (hostShuffle()) {
      if (hostShuffleList.length < 2) return;
      showErr($("host-error"), "");
      const list = hostShuffleList.map(g => ({ ...g })), hp = hsPrefs();
      const name = ("🔀 " + list.map(g => g.name.replace(/\s*[([].*$/, "")).join(" / ")).slice(0, 80);
      const params = { t: "join", role: "host", room: newCode(), password: $("lobby-pw").value, game: name, system: list[0].system,
        local: localSeats(), mode: "coop", shuffle: { games: list.map(g => ({ name: g.name, system: g.system })) } };
      try {
        const sock = await GameSocket.open(params);
        for (const g of list) if (g.kind === "lib") rememberPlayed(g.item);
        enterRoom(sock, { host: true, params, picked: { kind: "shuffle", name, list, min: hp.min, max: hp.max, saver: hp.saver } });
      } catch (e) { showErr($("host-error"), e.message); }
      finally { updateHostBtn(); }
      return;
    }
    const p = hubPicked, system = $("system").value;
    if (linkChosen()) {
      showErr($("host-error"), "");
      try {
        const r = await linkPost("/api/link/host", { path: p.item.path, players: Number($("link-players").value) });
        rememberPlayed(p.item);
        toast(`VBA-M started as the link server (P1, ${r.players} players).`, { ms: 4000 });
      } catch (e) { showErr($("host-error"), e.message); }
      await linkRefresh();
      $("link-box").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!p || !system) return;
    showErr($("host-error"), "");
    const code = newCode();
    const coop = hubCoop && p.kind === "lib" && system === hubCoop.system
      ? { hack: hubCoop.hack, variant: hubCoop.variant, name: hubCoop.name, players: hubCoop.players, ports: hubCoop.ports } : null;
    const params = { t: "join", role: "host", room: code, password: $("lobby-pw").value, game: coop ? coop.name : p.name, system,
      local: isNative(system) && hostMode() === "ghost" ? [0] : localSeats(), mode: isNative(system) ? "coop" : hostMode(),
      race: !isNative(system) && hostRace(), splits: (Settings.get("raceSplits") || {})[p.name] || [] };
    try {
      const sock = await GameSocket.open(params);
      if (p.kind === "lib") rememberPlayed(p.item);
      const gba = !coop && hubGba && p.kind === "lib" && system === "gc" ? { players: hubGba.players } : null;
      enterRoom(sock, { host: true, params, picked: coop ? { ...p, name: coop.name, coop } : gba ? { ...p, gba } : p });
    } catch (e) { showErr($("host-error"), e.message); }
    finally { updateHostBtn(); }
  });
  $("host-btn").addEventListener("click", openLobby);

  // ================================================================ game socket (signaling) with auto-rejoin
  const GameSocket = {
    // Resolves once the server says "joined"; rejects with {message, code} on a join error.
    open(joinMsg) {
      return new Promise((resolve, reject) => {
        const sock = { joinMsg, handlers: {}, ws: null, closed: false, joined: null,
          on(t, fn) { this.handlers[t] = fn; return this; },
          send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
          // Intentional leave: tell the hub first so it frees the seat now instead of holding it for a resume.
          close() { this.closed = true; this.send({ t: "leave" }); try { this.ws.close(); } catch {} } };
        let first = true, retry = 1500;     // reconnect delay: 1.5 s, doubling up to 5 s (the hub holds the seat for 30 s)
        // Reload / tab closed: don't give the seat up. The hub holds it for 30 s, and this tab (reloaded, or reopened
        // with Ctrl+Shift+T) gets it back with the resume token. Leave (the button) still frees it at once.
        window.addEventListener("pagehide", e => {
          if (e.persisted || sock.closed || sock.handoff || !sock.joined) return;
          try { sessionStorage.setItem("rh-rejoin", JSON.stringify({ code: sock.joined.room, token: sock.token, at: Date.now(),
            ...(sock.joined.host && sock.libPath ? { lib: sock.libPath, ...(sock.coop ? { coop: sock.coop } : {}), ...(sock.gba ? { gba: sock.gba } : {}) } : {}) })); } catch {}
        });
        const connect = () => {
          const ws = sock.ws = new WebSocket(wsUrl());
          // After a drop, the resume token from "joined" gets this player back the same id, seat and ready state.
          ws.onopen = () => { retry = 1500; ws.send(JSON.stringify(sock.token ? { ...sock.joinMsg, resume: sock.token } : sock.joinMsg)); };
          ws.onmessage = e => {
            let m; try { m = JSON.parse(e.data); } catch { return; }
            if (m.t === "joined") {
              if (m.token) sock.token = m.token;
              sock.joined = m;
              if (first) { first = false; resolve(sock); } else sock.handlers.rejoined?.(m);
              return;
            }
            if (m.t === "error" && first) {
              first = false; sock.closed = true; ws.close();
              const err = new Error(m.msg || "Could not join."); err.code = m.code; err.watchable = m.watchable; return reject(err);
            }
            if (m.t === "error") { sock.handlers.fatal?.(m); sock.closed = true; ws.close(); return; }
            if (typeof m.t === "string" && Object.hasOwn(sock.handlers, m.t)) sock.handlers[m.t](m);
          };
          ws.onclose = () => {
            if (first) { first = false; return reject(new Error("Lost the connection to the hub.")); }
            if (sock.closed) return;
            sock.handlers.dropped?.();
            setTimeout(() => { if (!sock.closed) connect(); }, retry);
            retry = Math.min(retry * 2, 5000);
          };
        };
        connect();
      });
    },
  };

  // ================================================================ ROOM (lobby -> countdown -> loading -> playing)
  function enterRoom(sock, opts) {
    state.inRoom = true;
    try { lobbyWs?.close(); } catch {}
    const isHost = opts.host;
    const code = isHost ? opts.params.room : opts.room.code;
    window.RH.Friends?.setRoom(code);
    window.addEventListener("rh-friends", () => renderSlots());     // "+ Friend" buttons follow the list
    let picked = opts.picked || null;
    if (isHost && picked?.kind === "lib") { sock.libPath = picked.item.path; sock.coop = picked.coop || null; sock.gba = picked.gba || null; }
    let players = [], phase = sock.joined.phase || "lobby", rules = { spectators: true, mode: isHost ? opts.params.mode : (opts.room.mode || "coop") }, reserved = [], staged = false;
    const ghostMode = () => rules.mode === "ghost";
    let myRom = null;            // ghost mode: { crc, size, name, file?, src } of the ROM this player will run
    let romHash = null;          // { pct, name } while hashing
    let roomGame = isHost ? opts.params.game : opts.room.game, roomSystem = isHost ? opts.params.system : opts.room.system;
    const myId = () => sock.joined.id;
    const mine = () => players.find(p => p.id === myId());
    const keyOf = id => players.find(p => p.id === id)?.key;
    shortcutCtx = () => ({ system: roomSystem, inGame, canSave: canSave(), ghost: ghostMode(), race: !!rules.race, streamerHost: isHost && !!streamer?.on });   // for the ? list

    // ---- views
    $("hub-main").hidden = true; $("room").hidden = false;
    document.querySelectorAll("#room .host-only").forEach(el => { el.hidden = !isHost; });
    $("r-code").textContent = code;
    $("r-copy-code").onclick = () => UI.copy(code, "Code copied!");
    $("r-copy-link").onclick = () => copyInvite(code, "Copied! (password not included)");
    $("r-leave").onclick = () => {
      if (isHost && players.length > 1 && !confirm("Leave the lobby? Hosting passes to another player.")) return;
      leave();
    };
    // The Retro Hub title goes home from a lobby too, after asking (offsite.js handles it on the hub page).
    $("brand-home").onclick = e => {
      e.preventDefault();
      if (!confirm(isHost && players.length > 1 ? "Leave the lobby and go back to the home screen? Hosting passes to another player."
        : "Leave the lobby and go back to the home screen?")) return;
      leave();
    };
    if (opts.promoted) setTimeout(() => toast(`You're the host now. Pick the game with "Change…" to start.`, { kind: "ok", ms: 6000 }), 300);
    const leave = () => { racePanel?.close(); raGame?.close(); game?.close?.(); sock.close(); net.close(); voice.close(); comp?.destroy(); if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {}); location.replace("/"); };
    window.addEventListener("beforeunload", e => { if (isHost && (phase === "playing" || phase === "loading")) { e.preventDefault(); e.returnValue = ""; } });

    // ---- settings panel (persisted)
    const det = $("r-settings");
    det.open = !!Settings.get("panels").settings;
    det.addEventListener("toggle", () => Settings.patch("panels", { settings: det.open }));
    $("s-volume").value = Settings.get("volume"); $("s-voice").value = Settings.get("voiceVolume");
    $("s-sfx").checked = !!Settings.get("sfx"); $("s-eq").checked = !!Settings.get("equalizeLag");
    $("s-volume").addEventListener("input", () => { const v = Number($("s-volume").value); Settings.set("volume", v); applyGameVolume(v); });
    $("s-voice").addEventListener("input", () => voice.setVolume(Number($("s-voice").value)));
    $("s-sfx").addEventListener("change", () => Settings.set("sfx", $("s-sfx").checked));
    $("s-eq").addEventListener("change", () => Settings.set("equalizeLag", $("s-eq").checked));
    $("r-calib").onclick = () => openCalibration();
    renderCalibSummary();
    const applyGameVolume = v => {
      if (window.EJS_emulator) { try { window.EJS_emulator.setVolume(v); } catch {} }
      else $("guest-video").volume = v;
    };

    // ---- voice
    const voice = new Voice.Voice();
    Voice.animateMeters(voice, me.id);
    const micButtons = [$("r-mic"), $("g-mic")];
    const renderMic = () => micButtons.forEach(b => {
      const on = !!voice.mic; b.setAttribute("aria-pressed", String(on));
      b.textContent = b.id === "r-mic" ? (on ? "🎙 Mic on" : "🎙 Mic off") : (on ? "🎙 On" : "🎙 Off");
      b.classList.toggle("on", on);
    });
    const toggleMic = guard(null, async () => {
      if (voice.mic) { voice.disable(); }
      else {
        try { await voice.enable(); }
        catch (e) { toast(e.name === "NotAllowedError" ? "Microphone permission was denied." : "No microphone available.", { kind: "bad", ms: 3000 }); }
      }
      if (isHost) net.setHostMic(voice.mic, myId()); else net.setMic(voice.mic);
      sock.send({ t: "voice", on: !!voice.mic });
      renderMic();
    });
    micButtons.forEach(b => b.addEventListener("click", toggleMic));
    renderMic();

    // ---- networking (started now so voice works in the lobby; the game stream joins at load time)
    // The game object is created when the match loads, once the mode is final:
    // co-op host (emulator + stream), co-op guest (stream), ghost player (own emulator) or ghost spectator.
    let net, game = null, lastStream = null, netStateNow = "new";
    let comp = null;                          // ghost compositor
    let ghostTracks = new Map();              // playerId -> remote ghost video track
    let myGhost = null;                       // this player's own ghost track
    if (isHost) {
      net = new Net.HostNet({
        iceServers: config.iceServers,
        sendSignal: (to, data) => sock.send({ t: "signal", to, data }),
        onInput: (id, v) => game?.input?.(id, v),
        onState: () => { renderSlots(); game?.redraw(); },
        onVoice: (id, track) => { const k = keyOf(id); if (!k) return; track ? voice.setRemote(k, track) : voice.dropRemote(k); },
        onGhost: (id, track) => { track ? ghostTracks.set(id, track) : ghostTracks.delete(id); syncGhosts(); },
        onAbuse: id => toast(`Cut off ${players.find(p => p.id === id)?.name || "a player"}'s connection: it was flooding or sending bad data.`, { kind: "bad", ms: 5000 }),
        onCtl: (id, m) => { if (m.t === "quality") { net.setPeerCap(id, m.cap); if (Modal.isOpen($("stream-panel"))) renderStreamStats(); } },
      });
      net.start();
    } else {
      net = new Net.GuestNet({
        iceServers: config.iceServers,
        sendSignal: (to, data) => sock.send({ t: "signal", to, data }),
        onStream: s => { lastStream = s; game?.stream?.(s); },
        onState: st => { netStateNow = st; game?.netState?.(st); },
        onGhosts: map => { ghostTracks = new Map(Object.entries(map).map(([id, t]) => [Number(id), t])); syncGhosts(); },
        onAbuse: () => toast("Disconnected from the host: it was flooding or sending bad data.", { kind: "bad", ms: 5000 }),
        onVoice: map => {
          const want = new Map(Object.entries(map).map(([id, tr]) => [keyOf(Number(id)), tr]).filter(([k]) => k));
          for (const k of [...voice.remote.keys()]) if (!want.has(k)) voice.dropRemote(k);
          for (const [k, tr] of want) voice.setRemote(k, tr);
        },
      });
      net.onSide = track => window.RH.GbaView?.show(track, players.find(x => x.id === myId())?.slot);   // 🗡️ GBA screens mode: only my own GBA
    }
    voice.onChange(() => renderSlots());
    if (!isHost) net.onSharedState = bytes => receiveSharedSave(bytes);

    // ---- text chat (relayed and kept by the hub; works for players and spectators, with or without a mic)
    const chatLog = $("chat-log"), chatSeen = new Set();
    let chatOpen = false, unread = 0, peekT = 0;
    $("r-chat-home").appendChild($("chat"));
    const atBottom = () => chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;
    function addChat(msg) {
      if (!msg || typeof msg.n !== "number" || chatSeen.has(msg.n)) return false;
      chatSeen.add(msg.n);
      const stick = atBottom();
      const li = document.createElement("li");
      const time = new Date(msg.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (msg.sys) {
        li.className = "sys";
        li.innerHTML = `<span class="c-text"></span><time></time>`;
      } else {
        li.className = msg.key === me.id ? "mine" : "";
        li.innerHTML = `<div class="c-who"><span class="c-slot"></span><b class="trunc"></b><time></time></div><div class="c-text"></div>`;
        li.querySelector(".c-slot").textContent = msg.slot >= 0 ? `P${msg.slot + 1}` : "👁";
        li.querySelector(".c-who b").textContent = msg.name; li.querySelector(".c-who b").title = `${msg.name} #${prettyId(msg.key || "")}`;
      }
      if (msg.sys || !window.RH.Emotes) li.querySelector(".c-text").textContent = msg.text;
      else window.RH.Emotes.render(li.querySelector(".c-text"), msg.text);
      li.querySelector("time").textContent = time;
      chatLog.appendChild(li);
      while (chatLog.children.length > 200) chatLog.firstElementChild.remove();
      $("chat-empty").hidden = true;
      if (stick) chatLog.scrollTop = chatLog.scrollHeight;
      return true;
    }
    function onNewChat(msg) {
      if (!inGame || chatOpen || msg.key === me.id) return;
      if (!msg.sys) { unread++; renderUnread(); }
      // A short "peek" bubble over the game so nobody misses a message.
      const peek = $("chat-peek");
      const line = document.createElement("div");
      line.className = "peek-line" + (msg.sys ? " sys" : "");
      if (msg.sys || !window.RH.Emotes) line.textContent = msg.sys ? msg.text : `${msg.name}: ${msg.text}`;
      else { const b = document.createElement("b"); b.textContent = `${msg.name}: `; const s = document.createElement("span"); window.RH.Emotes.render(s, msg.text); line.append(b, s); }
      peek.appendChild(line);
      while (peek.children.length > 3) peek.firstElementChild.remove();
      clearTimeout(peekT); peekT = setTimeout(() => { peek.textContent = ""; }, 6000);
    }
    const renderUnread = () => { const u = $("g-chat-unread"); u.hidden = !unread; u.textContent = unread > 9 ? "9+" : String(unread); };
    sock.on("chat", m => { if (addChat(m.msg)) { onNewChat(m.msg); noteTitle(m.msg); } });
    sock.on("chat-history", m => { (Array.isArray(m.list) ? m.list : []).forEach(addChat); chatLog.scrollTop = chatLog.scrollHeight; });
    let lastSent = "", sendTimes = [];
    $("chat-form").addEventListener("submit", e => {
      e.preventDefault();
      const text = $("chat-input").value.trim();
      if (!text) return;
      // Keep the text in the box when it can't go out now, instead of silently dropping it.
      if (!sock.ws || sock.ws.readyState !== 1) return toast("Not connected to the hub right now. Your message is still in the box.", { kind: "bad", ms: 3000 });
      const now = Date.now(); sendTimes = sendTimes.filter(t => now - t < 8000);
      if (sendTimes.length >= 6) return toast("Slow down a little: wait a few seconds before sending more.", { ms: 2500 });
      sendTimes.push(now);
      sock.send({ t: "chat", text });
      lastSent = text;
      $("chat-input").value = ""; renderChatCount();
      if (inGame) $("chat-input").blur();          // in a match, Enter sends and hands the keyboard back to the game
    });
    const renderChatCount = () => {
      const n = $("chat-input").value.length, c = $("chat-count");
      c.hidden = n < 240; c.textContent = `${300 - n}`; c.classList.toggle("bad", n >= 290);
    };
    $("chat-input").addEventListener("input", renderChatCount);
    $("chat-emote").addEventListener("click", () => window.RH.Emotes?.picker($("chat-emote"), s => window.RH.Emotes.insert($("chat-input"), s)));
    // Tab title shows unread messages while the page is in the background.
    let titleUnread = 0;
    const baseTitle = document.title;
    const renderTitle = () => { document.title = titleUnread ? `(${titleUnread}) ${baseTitle}` : baseTitle; };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { titleUnread = 0; renderTitle(); } });
    function noteTitle(msg) { if (document.hidden && !msg.sys && msg.key !== me.id) { titleUnread++; renderTitle(); } }
    // Typing must never leave a game button held down: release every key the moment the chat box gets focus.
    $("chat-input").addEventListener("focus", () => window.dispatchEvent(new Event("blur")));
    $("chat-input").addEventListener("keydown", e => {
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation(); $("chat-input").blur();
        if (inGame) setChatOpen(false);
      } else if (e.key === "ArrowUp" && !$("chat-input").value && lastSent) {      // recall your last message
        e.preventDefault(); $("chat-input").value = lastSent; renderChatCount();
      }
    });
    function setChatOpen(open, focus) {
      chatOpen = open;
      $("g-chat-drawer").hidden = !open;
      $("g-chat").setAttribute("aria-expanded", String(open));
      $("g-chat").classList.toggle("on", open);
      if (open && Modal.isOpen(savesPanel)) Modal.close(savesPanel);
      if (open) { unread = 0; renderUnread(); $("chat-peek").textContent = ""; chatLog.scrollTop = chatLog.scrollHeight; if (focus) $("chat-input").focus(); }
    }
    $("g-chat").onclick = () => setChatOpen(!chatOpen, !chatOpen);
    $("chat-close").onclick = () => setChatOpen(false);
    window.addEventListener("keydown", e => {
      if (!inGame || (e.code !== "Slash" && e.key !== "/") || e.key === "?" || e.code === "NumpadDivide" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      setChatOpen(true, true);
    });

    // ---- save states (co-op host). Every save is also copied to each guest, so whoever hosts next can resume.
    const savesPanel = $("saves-panel");
    const emuReady = () => !!window.EJS_emulator?.gameManager && phase === "playing";
    // Hub save states are EmulatorJS's; native emulators keep their own (use the emulator's save/load keys).
    const canSave = () => isHost && !ghostMode() && !isNative(roomSystem) && picked?.kind !== "shuffle";
    async function saveNow() {
      if (!canSave()) return;
      if (!emuReady()) return toast("The game isn't running yet.", { kind: "bad" });
      const gm = window.EJS_emulator.gameManager;
      try { if (gm.supportsStates && !gm.supportsStates()) return toast("This console's emulator can't make save states.", { kind: "bad", ms: 3500 }); } catch {}
      let bytes;
      try { bytes = gm.getState(); } catch { return toast("Couldn't save the game right now.", { kind: "bad" }); }
      const png = await Promise.race([Promise.resolve().then(() => gm.screenshot()).catch(() => null), new Promise(r => setTimeout(() => r(null), 1500))]);
      const thumb = png ? await Saves.thumbFrom(png) : null;
      const label = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      let entry;
      try {
        entry = await Saves.make(bytes, { system: roomSystem, game: roomGame, by: me.name, byKey: me.id, label, thumb });
        entry.id = await Saves.put(entry);
      } catch (e) { return toast("Couldn't store the save in this browser.", { kind: "bad", ms: 3500 }); }
      sock.send({ t: "savestate", act: "save", label });
      toast(`Game saved (${fmtSize(entry.size)}).`, { kind: "ok" });
      if (Modal.isOpen(savesPanel)) renderSaves();
      if (players.some(p => !p.host)) {
        const packed = await Saves.pack(entry);
        if (packed.length <= Saves.MAX_PACKED) net.sendState(packed).then(n => { if (n) toast(`Save copied to ${n} other player${n === 1 ? "" : "s"}.`, { ms: 2200 }); });
      }
    }
    async function loadSave(id) {
      if (!canSave()) return;
      if (!emuReady()) return toast("Start the match first, then load the save.", { kind: "bad", ms: 3000 });
      const entry = await Saves.get(id).catch(() => null);
      if (!entry) return toast("That save is gone.", { kind: "bad" });
      let bytes;
      try { bytes = await Saves.load(entry); window.EJS_emulator.gameManager.loadState(bytes); }
      catch (e) { return toast(e.message && e.message.length < 80 ? e.message : "Couldn't load that save.", { kind: "bad", ms: 3500 }); }
      sock.send({ t: "savestate", act: "load", label: `${entry.label || Saves.ago(entry.at)}${entry.by ? ` by ${entry.by}` : ""}` });
      toast("Save loaded.", { kind: "ok" });
    }
    async function receiveSharedSave(bytes) {
      try {
        const head = Saves.unpack(bytes);
        if (head.system !== roomSystem || head.game.toLowerCase() !== String(roomGame).toLowerCase()) return;   // not this match's game
        await Saves.importPacked(bytes, { shared: true });
        toast(`${head.by || "The host"} saved the game. A copy is kept on this computer too.`, { ms: 3000 });
      } catch {}
    }
    // Saves deleted in the last few seconds (Undo still possible): id -> timer. Hidden everywhere until then.
    const pendingDel = new Map();
    const liveSaves = list => list.filter(r => !pendingDel.has(r.id));
    window.addEventListener("pagehide", () => { for (const [id, t] of pendingDel) { clearTimeout(t); Saves.remove(id).catch(() => {}); } pendingDel.clear(); });
    async function renderSaves() {
      const list = $("sv-list");
      const rows = liveSaves(await Saves.list(roomSystem, roomGame).catch(() => []));
      const others = liveSaves(await Saves.listSystem(roomSystem).catch(() => [])).filter(r => r.gameKey !== rows[0]?.gameKey && r.game.toLowerCase() !== String(roomGame).toLowerCase());
      $("sv-save").hidden = !canSave();
      const row = (r, other) => `<li data-id="${r.id}">
          ${r.thumb ? `<img class="sv-thumb" src="${esc(r.thumb)}" alt="">` : `<span class="sv-thumb none">${esc(sysShort(r.system))}</span>`}
          <div class="grow min0">
            <div class="title trunc" title="${esc(r.by ? `Saved by ${r.by}` : "")}">${esc(other ? r.game : (r.label || "Save"))}${r.by ? ` <span class="muted small">· ${esc(r.by)}</span>` : ""}</div>
            <div class="sub trunc">${esc(Saves.ago(r.at))} · ${fmtSize(r.size)}${r.shared ? " · shared" : ""}</div>
          </div>
          ${!other && canSave() ? `<button class="small primary" data-load="${r.id}">Load</button>` : ""}
          <button class="small icon" data-dl="${r.id}" title="Download a .rhsave file" aria-label="Download">⤓</button>
          <button class="small icon" data-del="${r.id}" title="Delete" aria-label="Delete">🗑</button>
        </li>`;
      list.innerHTML = rows.length ? rows.map(r => row(r)).join("")
        : `<li class="empty-row"><div class="empty small">No saves for this game yet.${canSave() ? " Press 💾 Save (or F2) during the match." : ""}</div></li>`;
      if (others.length) list.insertAdjacentHTML("beforeend", `<li class="sv-group small muted">Other ${esc(config.systems[roomSystem] || "")} games</li>` + others.slice(0, 8).map(r => row(r, true)).join(""));
      list.querySelectorAll("[data-load]").forEach(b => b.onclick = guard(b, async () => { await loadSave(Number(b.dataset.load)); }));
      list.querySelectorAll("[data-dl]").forEach(b => b.onclick = async () => { const e = await Saves.get(Number(b.dataset.dl)); if (e) Saves.download(e); });
      // Delete at once with Undo instead of a confirm dialog: the save is hidden now and only really removed
      // when the toast runs out (or the page closes).
      list.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
        const id = Number(b.dataset.del);
        const finish = () => { if (!pendingDel.has(id)) return; clearTimeout(pendingDel.get(id)); pendingDel.delete(id); Saves.remove(id).catch(() => {}); };
        pendingDel.set(id, setTimeout(finish, 6000));
        renderSaves();
        toast("Save deleted.", { ms: 5500, action: { label: "Undo", run: () => { clearTimeout(pendingDel.get(id)); pendingDel.delete(id); renderSaves(); } } });
      });
    }
    $("sv-save").onclick = guard($("sv-save"), saveNow);
    $("sv-import").addEventListener("change", async e => {
      const f = e.target.files[0]; e.target.value = "";
      if (!f) return;
      if (f.size > Saves.MAX_PACKED) return toast("That file is too big to be a save.", { kind: "bad" });
      try {
        const entry = await Saves.importPacked(new Uint8Array(await f.arrayBuffer()), { shared: true });
        toast(entry.system === roomSystem && entry.game.toLowerCase() === String(roomGame).toLowerCase()
          ? "Save imported." : `Imported a save for ${entry.game}, which isn't this game.`, { kind: "ok", ms: 3500 });
        renderSaves();
      } catch (err) { toast(err.message || "Couldn't import that file.", { kind: "bad" }); }
    });
    $("sv-close").onclick = () => Modal.close(savesPanel);
    $("g-save").onclick = guard($("g-save"), saveNow);
    $("g-saves").onclick = () => {
      if (Modal.isOpen(savesPanel)) return Modal.close(savesPanel);
      renderSaves();
      Modal.open(savesPanel, { focus: "#sv-close" });
    };
    window.addEventListener("keydown", async e => {
      if (!inGame || !canSave() || e.repeat || (e.key !== "F2" && e.key !== "F4")) return;
      e.preventDefault();
      if (e.key === "F2") return saveNow();
      const newest = liveSaves(await Saves.list(roomSystem, roomGame).catch(() => []))[0];
      newest ? loadSave(newest.id) : toast("No save for this game yet (F2 saves).", { ms: 2500 });
    });
    // ---- stream quality (co-op): host limits for everyone, guests can ask for a lighter stream for themselves
    const PRESETS = {
      auto: { maxKbps: 6000, fps: 60, maxHeight: 0, prefer: "smooth", audioKbps: 96 },
      high: { maxKbps: 12000, fps: 60, maxHeight: 0, prefer: "balanced", audioKbps: 128 },
      balanced: { maxKbps: 4000, fps: 60, maxHeight: 720, prefer: "smooth", audioKbps: 96 },
      saver: { maxKbps: 1500, fps: 30, maxHeight: 480, prefer: "smooth", audioKbps: 64 },
    };
    const curQuality = () => { const s = Settings.get("stream") || {}; return Net.cleanQuality(s.preset && PRESETS[s.preset] ? { ...PRESETS[s.preset], codec: s.codec } : s); };
    const CODEC_LABEL = { h264: "H.264", vp9: "VP9", av1: "AV1", vp8: "VP8" };
    const supported = new Set(Net.supportedVideoCodecs());
    for (const o of $("sq-codec").options) if (o.value !== "auto" && !supported.has(o.value)) o.hidden = o.disabled = true;
    const presetOf = q => Object.keys(PRESETS).find(k => Object.keys(PRESETS[k]).every(f => PRESETS[k][f] === q[f])) || "custom";
    const fmtKbps = k => k == null ? "—" : k >= 1000 ? (k / 1000).toFixed(k >= 10000 ? 0 : 1) + " Mbps" : k + " kbps";
    function renderStreamBox() {
      const coop = !ghostMode(), q = curQuality();
      $("sq-host").hidden = !isHost || !coop;
      $("sq-guest").hidden = isHost || !coop;
      $("sq-ghost-note").hidden = coop;
      $("sq-preset").value = presetOf(q);
      $("sq-bitrate").value = q.maxKbps; $("sq-bitrate-val").textContent = fmtKbps(q.maxKbps);
      $("sq-fps").value = String(q.fps); $("sq-res").value = String(q.maxHeight);
      $("sq-prefer").value = q.prefer; $("sq-audio").value = String(q.audioKbps);
      $("sq-codec").value = supported.has(q.codec) ? q.codec : "auto";
      $("sq-codec-note").textContent = !$("game").hidden ?"Changing the codec reconnects each player's video: expect a pause of a second or two." :
        "If a player's browser can't decode the chosen codec, their stream falls back to one it can.";
      $("sq-cap").value = String(Settings.get("streamCap") || 0);
    }
    function saveQuality(patch) {
      const q = Net.cleanQuality({ ...curQuality(), ...patch });
      Settings.set("stream", { ...q, preset: presetOf(q) });   // q includes the codec
      if (isHost) net.setQuality(q);
      renderStreamBox();
    }
    $("sq-preset").onchange = () => { const v = $("sq-preset").value; if (PRESETS[v]) saveQuality(PRESETS[v]); };
    $("sq-bitrate").oninput = () => { $("sq-bitrate-val").textContent = fmtKbps(Number($("sq-bitrate").value)); };
    $("sq-bitrate").onchange = () => saveQuality({ maxKbps: Number($("sq-bitrate").value) });
    $("sq-fps").onchange = () => saveQuality({ fps: Number($("sq-fps").value) });
    $("sq-res").onchange = () => saveQuality({ maxHeight: Number($("sq-res").value) });
    $("sq-prefer").onchange = () => saveQuality({ prefer: $("sq-prefer").value });
    $("sq-audio").onchange = () => saveQuality({ audioKbps: Number($("sq-audio").value) });
    $("sq-codec").onchange = () => {
      saveQuality({ codec: $("sq-codec").value });
      if (inGame && players.some(p => !p.host)) toast(`Switching video to ${CODEC_LABEL[$("sq-codec").value] || "the browser's choice"}…`, { ms: 2500 });
    };
    $("sq-cap").onchange = () => {
      const v = Number($("sq-cap").value) || 0;
      Settings.set("streamCap", v);
      net.setCap?.(v);
      toast(v ? `Asked the host for a lighter stream (up to ${fmtKbps(v)}).` : "Back to the host's full quality.", { ms: 2200 });
    };
    $("r-stream-home").appendChild($("stream-box"));
    if (isHost) net.setQuality(curQuality());
    else if (Settings.get("streamCap")) net.setCap(Settings.get("streamCap"));
    renderStreamBox();

    // Live stats in the Stream panel (refreshed every 2 s while it is open).
    const sp = $("stream-panel");
    let spTimer = 0;
    const lossCls = v => v == null ? "" : v >= 5 ? "sp-bad" : v >= 1 ? "sp-warn" : "";
    const codecLabel = c => CODEC_LABEL[String(c).toLowerCase()] || c;
    const hwLabel = hw => hw === true ? " · hardware" : hw === false ? " · software" : "";
    const LIMIT = { bandwidth: "network", cpu: "host CPU", other: "browser" };
    async function renderStreamStats() {
      const box = $("sp-stats");
      if (ghostMode()) { box.innerHTML = ""; return; }
      if (isHost) {
        const rows = await net.stats();
        // "Limited by network" is normal for a few seconds while the link ramps up, or when the picture barely moves
        // (almost nothing to send). Only flag it when video is flowing and the measured link is clearly below the target.
        const target = id => { const c = net.peerCap(id), q = curQuality(); return c ? Math.min(c, q.maxKbps) : q.maxKbps; };
        const named = rows.map(r => ({ ...r, p: players.find(x => x.id === r.id) })).filter(r => r.p)
          .map(r => ({ ...r, limit: r.limit === "bandwidth" && !((r.kbps || 0) > 200 && r.availKbps != null && r.availKbps < target(r.id) * 0.8) ? null : r.limit }));
        if (!named.length) { box.innerHTML = '<p class="small muted">No other players connected yet.</p>'; return; }
        box.innerHTML = `<table class="sp-table"><thead><tr><th>Player</th><th>Video</th><th>FPS</th><th>Size</th><th>Loss</th><th>Ping</th></tr></thead><tbody>${named.map(r => r.state !== "connected"
          ? `<tr><td class="pn" title="${esc(r.p.name)}">${esc(r.p.name)}</td><td colspan="5" class="muted">${esc(r.state)}…</td></tr>`
          : `<tr><td class="pn" title="${esc(r.p.name)}">${esc(r.p.name)}</td><td>${fmtKbps(r.kbps)}</td><td>${r.fps ?? "—"}</td><td>${r.h ? r.h + "p" : "—"}</td>
              <td class="${lossCls(r.lossPct)}">${r.lossPct != null ? r.lossPct + "%" : "—"}</td><td>${r.rttMs != null ? r.rttMs + " ms" : "—"}</td></tr>
             ${r.cap || r.limit || r.relay || r.codec ? `<tr><td></td><td colspan="5">${r.codec ? `<span class="sp-tag" title="${esc(r.impl || "")}">${esc(codecLabel(r.codec))}${hwLabel(r.hw)}</span>` : ""}${r.cap ? `<span class="sp-tag">asked for ≤ ${fmtKbps(r.cap)}</span>` : ""}${r.limit ? `<span class="sp-tag sp-warn">limited by ${esc(LIMIT[r.limit] || r.limit)}</span>` : ""}${r.relay ? '<span class="sp-tag">via TURN relay</span>' : ""}</td></tr>` : ""}`).join("")}</tbody></table>
          <p class="small muted sp-hint">${named.some(r => r.limit === "cpu") ? "Your computer is struggling to encode: try 30 fps or a lower resolution." : named.some(r => r.limit === "bandwidth" || (r.lossPct || 0) >= 2) ? "A connection can't keep up: a lower bitrate or the Balanced preset may look smoother." : named.some(r => r.codec && r.hw === false) && supported.has("h264") && curQuality().codec !== "h264" ? "Video is encoded in software. H.264 is often hardware-encoded and lighter on your CPU." : "All good."}</p>`;
      } else {
        const s = await net.stats();
        if (!s) { box.innerHTML = '<p class="small muted">Waiting for the host\'s stream…</p>'; return; }
        const cell = (label, value, cls = "") => `<div><span>${label}</span><b class="${cls}">${value}</b></div>`;
        box.innerHTML = `<div class="sp-grid">${cell("Video", fmtKbps(s.kbps))}${cell("Frame rate", s.fps != null ? s.fps + " fps" : "—")}${cell("Size", s.w && s.h ? `${s.w}×${s.h}` : "—")}
          ${cell("Loss", s.lossPct != null ? s.lossPct + "%" : "—", lossCls(s.lossPct))}${cell("Dropped", s.droppedPct != null ? s.droppedPct + "%" : "—", lossCls(s.droppedPct != null ? s.droppedPct / 2 : null))}${cell("Ping", s.rttMs != null ? s.rttMs + " ms" : "—")}
          ${cell("Jitter", s.jitterMs != null ? s.jitterMs + " ms" : "—")}${cell("Audio", fmtKbps(s.audioKbps))}${cell("Path", s.relay ? "TURN relay" : "Direct")}${cell("Codec", s.codec ? `${esc(codecLabel(s.codec))}${hwLabel(s.hw)}` : "—")}</div>
          <p class="small muted sp-hint">${(s.lossPct || 0) >= 2 || (s.droppedPct || 0) >= 5 ? "Picture stuttering? Pick a lighter stream below." : "All good."}</p>`;
      }
    }
    const closeSp = () => Modal.close(sp);
    $("sp-close").onclick = closeSp;
    $("g-stream").onclick = () => {
      if (Modal.isOpen(sp)) return closeSp();
      if (Modal.isOpen(savesPanel)) Modal.close(savesPanel);
      renderStreamBox(); renderStreamStats();
      clearInterval(spTimer); spTimer = setInterval(renderStreamStats, 2000);
      Modal.open(sp, { focus: "#sp-close", onClose: () => clearInterval(spTimer) });
    };

    // When the match starts, mention a save that can be continued (e.g. a copy the previous host shared).
    async function offerResume() {
      if (!canSave()) return;
      const newest = liveSaves(await Saves.list(roomSystem, roomGame).catch(() => []))[0];
      if (newest) toast(`Saved game from ${Saves.ago(newest.at)}${newest.by ? ` by ${newest.by}` : ""} available. Open 📂 Saves (or press F4) to continue it.`, { ms: 6500 });
    }

    // ---- ghost mode: the player's own ROM (checksum only is shared)
    const romMeta = r => r ? { crc: r.crc, size: r.size, name: r.name } : null;
    const refRom = () => players.find(p => p.host)?.rom || null;
    let hashToken = 0;
    async function useRom(blob, name, src, file) {
      const token = ++hashToken;
      romHash = { pct: 0, name };
      renderRomBoxes();
      try {
        const crc = await Ghost.crc32File(blob, pct => { if (token === hashToken) { romHash.pct = Math.round(pct * 100); renderRomBoxes(); } });
        if (token !== hashToken) return;
        myRom = { crc, size: blob.size, name, file, src };
        romHash = null;
        sock.send({ t: "rom", rom: romMeta(myRom) });
        sock.joinMsg = { ...sock.joinMsg, rom: romMeta(myRom) };
        game?.romReady?.();
      } catch (e) {
        if (token !== hashToken) return;
        romHash = null;
        toast("Couldn't read that file.", { kind: "bad", ms: 3000 });
      }
      renderRoom();
    }
    // The host's reference ROM is the game they picked (a local file or the server library).
    async function hashHostRom() {
      if (!isHost || !picked || !ghostMode()) return;
      const src = picked.kind === "lib" ? "lib:" + picked.item.path : picked.file;
      if (myRom && myRom.src === src) return;
      if (picked.kind === "file") return useRom(picked.file, picked.file.name, src, picked.file);
      const r = await fetch(libUrl(picked.item), { cache: "no-store" }).catch(() => null);
      if (!r || !r.ok) { toast("Couldn't read the library ROM to make its checksum.", { kind: "bad", ms: 3000 }); return; }
      const blob = await r.blob();
      useRom(blob, picked.item.path.split("/").pop(), src, null);
    }
    const libUrl = item => {
      const parts = item.path.split("/");
      if (roomSystem !== "arcade") parts[parts.length - 1] = me.id.slice(0, 8) + "__" + parts[parts.length - 1];
      return "/roms/" + parts.map(encodeURIComponent).join("/");
    };
    function romBadge(rom, ref, host) {
      if (host) return `<span class="rom-badge ref" title="Other players compare their ROM to this one">Reference ROM</span>`;
      if (!rom) return `<span class="rom-badge none">No ROM loaded</span>`;
      if (!ref) return `<span class="rom-badge warn">Waiting for host's ROM</span>`;
      return Ghost.sameRom(rom, ref)
        ? `<span class="rom-badge ok" title="Same checksum as the host's ROM">✓ ROM Verified (Match)</span>`
        : `<span class="rom-badge warn" title="Different checksum from the host's ROM (${esc(ref.crc)}). Levels or the camera may not line up.">⚠ ROM differs (may desync)</span>`;
    }
    // Renders a ROM drop zone into box. Host: read-only reference (changed with "Change…").
    function renderRomBox(box) {
      if (!box || box.hidden) return;
      let html;
      if (romHash) {
        html = `<div class="rom-row"><span class="rom-name trunc" title="${esc(romHash.name)}">${esc(romHash.name)}</span><span class="rom-meta">Checking… ${romHash.pct}%</span></div>
          <div class="bar"><i style="width:${romHash.pct}%"></i></div>`;
      } else if (myRom) {
        html = `<div class="rom-row"><span class="rom-name trunc" title="${esc(myRom.name)}">${esc(myRom.name)}</span>${romBadge(myRom, refRom(), isHost)}</div>
          <div class="rom-meta trunc">CRC32 ${esc(myRom.crc)} · ${fmtSize(myRom.size)}</div>`;
      } else {
        html = `<div class="rom-row"><span class="rom-name muted">${isHost ? "Reading your game…" : "Drop your own copy of the game here"}</span>${isHost ? "" : romBadge(null)}</div>`;
      }
      if (!isHost) {
        const locked = phase !== "lobby" && !(phase === "loading" && !myRom);
        html += `<div class="small muted" style="margin-top:6px">Your file stays on this computer: only its checksum is shared.</div>
          ${locked ? "" : `<input type="file" class="rom-input" aria-label="Your ROM file" style="margin-top:8px">`}`;
      }
      if (box.__html === html) return;
      box.__html = html; box.innerHTML = html;
      box.querySelector(".rom-input")?.addEventListener("change", e => { const f = e.target.files[0]; if (f) useRom(f, f.name, f, f); });
    }
    function bindDrop(box) {
      const ok = () => !isHost && ghostMode() && (phase === "lobby" || (phase === "loading" && !myRom)) && !mine()?.spectator;
      box.addEventListener("dragover", e => { if (!ok()) return; e.preventDefault(); box.classList.add("dragover"); });
      box.addEventListener("dragleave", () => box.classList.remove("dragover"));
      box.addEventListener("drop", e => {
        box.classList.remove("dragover");
        if (!ok()) return;
        e.preventDefault();
        const f = e.dataTransfer.files[0]; if (f) useRom(f, f.name, f, f);
      });
    }
    bindDrop($("r-rom-box")); bindDrop($("load-rom"));
    function renderRomBoxes() {
      const seated = !!mine() && !mine().spectator;
      $("r-rom").hidden = !ghostMode() || !seated;
      renderRomBox($("r-rom-box"));
      renderRomBox($("load-rom"));
    }

    // ---- ready / spectate / start / rules
    const readyBtn = $("r-ready");
    const toggleReady = guard(readyBtn, async () => {
      const r = mine()?.ready === "ready" ? "notready" : "ready";
      sock.send({ t: "ready", state: r });
    });
    readyBtn.onclick = toggleReady;
    $("r-spectate").onclick = guard($("r-spectate"), async () => {
      const m = mine();
      if (streamer?.on && m?.spectator) return sock.send({ t: "queue", on: !m.queue });
      sock.send({ t: "spectate", on: !(m?.spectator) });
    });
    $("r-start").onclick = guard($("r-start"), async () => { Sfx.unlock(); sock.send({ t: "start" }); });
    $("r-system").onchange = () => { if (isHost) sock.send({ t: "rules", system: $("r-system").value }); };
    $("r-mode").onchange = () => {
      if (!isHost) return;
      const v = $("r-mode").value, mode = v === "ghost" || v === "race" ? "ghost" : "coop";
      sock.send({ t: "rules", mode, race: v === "race" });
      if (mode === "ghost") sock.joinMsg = { ...sock.joinMsg, local: [Math.min(...sock.joinMsg.local)] };
    };
    $("r-spec-rule").onchange = () => { if (isHost) sock.send({ t: "rules", spectators: $("r-spec-rule").checked }); };
    let dlgPicker = null;
    $("r-change-game").onclick = () => {
      if (!dlgPicker) dlgPicker = makePicker($("dlg-picker"), p => {
        picked = p;
        sock.libPath = p.kind === "lib" ? p.item.path : null; sock.coop = null;
        if (p.kind === "lib") rememberPlayed(p.item);
        Modal.close($("game-dlg"));
        sock.send({ t: "rules", game: p.name, ...(p.system ? { system: p.system } : {}) });
        sock.joinMsg = { ...sock.joinMsg, game: p.name, system: p.system || sock.joinMsg.system };
        hashHostRom();
        renderRoom();       // the hub sends no roster when the name didn't change (e.g. a promoted host re-picking it)
      });
      else dlgPicker.reset();
      Modal.open($("game-dlg"));
    };
    $("game-dlg-cancel").onclick = () => Modal.close($("game-dlg"));

    // ---- race splits (host edits, everyone sees them). One name per line; none = a single "Finish" split.
    const raceNames = () => rules.splits?.length ? rules.splits : ["Finish"];
    function renderSplitsRule() {
      const box = $("r-splits-wrap"), ta = $("r-splits");
      box.hidden = !rules.race;
      if (!rules.race) return;
      ta.readOnly = !isHost || phase !== "lobby";
      if (document.activeElement !== ta) ta.value = (rules.splits || []).join("\n");
      $("r-splits-help").textContent = (rules.splits || []).length
        ? `${rules.splits.length} split${rules.splits.length === 1 ? "" : "s"}. The last one finishes the run.`
        : isHost ? "Optional: one split name per line (levels, bosses…). Empty = just a finish time." : "No splits: just a finish time.";
    }
    $("r-splits").onchange = () => {
      if (!isHost) return;
      const splits = $("r-splits").value.split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 40);
      Settings.patch("raceSplits", { [roomGame]: splits });         // remembered per game for next time
      sock.send({ t: "rules", splits });
    };
    // In game: the hub's race clock, kept as "GO happened at this performance.now()".
    let raceGo = null, racePanel = null, raceId = 0, raGame = null;
    function syncRaceClock(info) {
      if (!info || phase !== "playing") { raceGo = null; return; }
      const go = performance.now() - info.elapsed;
      if (raceGo == null || Math.abs(go - raceGo) > 150) { if (raceGo == null || go - raceGo > 1000) raceId++; raceGo = go; }
    }
    function ensureRacePanel() {
      const box = $("race-panel");
      box.hidden = !(rules.race && inGame);
      if (!rules.race || !inGame) { racePanel?.close(); racePanel = null; return; }
      if (racePanel) return racePanel.render();
      racePanel = Race.createPanel(box, {
        game: () => roomGame, system: () => roomSystem, systemLabel: () => config.systems[roomSystem] || roomSystem,
        names: raceNames, me: () => mine(), players: () => players, raceId: () => raceId,
        elapsed: () => raceGo == null ? null : performance.now() - raceGo,
        solo: () => players.filter(p => !p.spectator).length <= 1,
        send: act => sock.send({ t: "race", act }),
        pipAll: () => players.filter(p => !p.spectator && p.id !== myId()).forEach(p => openPip(p.id)),
        onRecord: (r, t) => toast(r.pb ? (r.previous ? `New personal best: ${Race.fmt(t)} (${Race.fmtDelta(t - r.previous.total)})` : `First finish recorded: ${Race.fmt(t)}`)
          : `Finished in ${Race.fmt(t)}. PB is ${Race.fmt(r.previous.total)}.`, { kind: r.pb ? "ok" : undefined, ms: 5000 }),
      });
      racePanel.render();
    }

    // ---- Streamer Mode (server.mjs "Streamer Mode"): waiting room, seat offers, rotation, privacy, OBS overlay
    let streamer = null, offer = null;
    const overlayUrl = `http://localhost:${location.port || (location.protocol === "https:" ? 443 : 80)}/overlay/queue`;
    function renderStreamer() {
      const on = !!streamer?.on;
      $("st-on").checked = on; $("st-on").disabled = !isHost || ghostMode();
      $("r-streamer").hidden = !isHost && !on;
      $("st-opts").hidden = !on || !isHost;
      if (on) $("st-turn").value = String(streamer.turnMin || 0);
      $("st-overlay-url").textContent = overlayUrl;
      $("g-rotate").hidden = !(on && isHost);
      const m = mine(), q = $("g-queue");
      q.hidden = !(on && !isHost && m?.spectator);
      if (!q.hidden) q.textContent = m.queue ? `🎟 #${m.queue} in line` : "🎟 Join the line";
    }
    $("st-on").onchange = () => { if (isHost) sock.send({ t: "streamer", on: $("st-on").checked }); };
    $("st-turn").onchange = () => { if (isHost) sock.send({ t: "streamer", turnMin: Number($("st-turn").value) }); };
    const rotate = () => { if (isHost && streamer?.on) sock.send({ t: "rotate" }); };
    $("st-rotate").onclick = guard($("st-rotate"), async () => rotate());
    $("g-rotate").onclick = guard($("g-rotate"), async () => rotate());
    $("g-queue").onclick = guard($("g-queue"), async () => sock.send({ t: "queue", on: !mine()?.queue }));
    $("st-overlay-copy").onclick = () => UI.copy(overlayUrl, "Overlay address copied. Paste it into an OBS Browser Source.");
    window.addEventListener("keydown", e => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === "R" || e.key === "r") && isHost && streamer?.on) { e.preventDefault(); rotate(); }
    }, true);
    // Hide codes and passwords on this screen (streaming). Per browser.
    const applySafe = () => document.body.classList.toggle("streamer-safe", !!Settings.get("streamerSafe"));
    $("st-safe").checked = !!Settings.get("streamerSafe"); applySafe();
    $("st-safe").onchange = () => { Settings.set("streamerSafe", $("st-safe").checked); applySafe(); };
    // "You're up!": take the seat within the time, by click, Enter or any gamepad button.
    let offerTimer = 0, offerPad = 0;
    function closeOffer() { offer = null; clearInterval(offerTimer); cancelAnimationFrame(offerPad); $("seat-offer").hidden = true; }
    function answerOffer(take) { if (!offer) return; sock.send({ t: "take", slot: offer.slot, ...(take ? {} : { no: true }) }); closeOffer(); }
    sock.on("seat-offer", m => {
      offer = { slot: m.slot, until: Date.now() + (m.ms || 10000) };
      $("so-sub").textContent = `A seat is free: P${m.slot + 1} in ${roomGame || "the game"}.`;
      $("seat-offer").hidden = false; $("so-take").focus();
      Sfx.chime();
      if (document.hidden) { try { if ("Notification" in window && Notification.permission === "granted") new Notification("Retro Hub: you're up!", { body: `Take P${m.slot + 1} now`, tag: "rh-offer", icon: "/icon.svg" }).onclick = () => window.focus(); } catch {} }
      const draw = () => { const left = Math.max(0, Math.ceil((offer?.until - Date.now()) / 1000)); $("so-left").textContent = `(${left})`; if (offer && left <= 0) closeOffer(); };
      clearInterval(offerTimer); offerTimer = setInterval(draw, 250); draw();
      const before = new Set();
      for (const g of navigator.getGamepads?.() || []) if (g) g.buttons.forEach((b, i) => { if (b.pressed) before.add(g.index + ":" + i); });
      const poll = () => {
        if (!offer) return;
        for (const g of navigator.getGamepads?.() || []) if (g) for (let i = 0; i < g.buttons.length; i++) {
          const k = g.index + ":" + i;
          if (g.buttons[i].pressed && !before.has(k)) return answerOffer(true);
          if (!g.buttons[i].pressed) before.delete(k);
        }
        offerPad = requestAnimationFrame(poll);
      };
      offerPad = requestAnimationFrame(poll);
    });
    sock.on("seat-offer-expired", () => { closeOffer(); toast("You missed your turn, so you were skipped. Join the line again when you're ready.", { kind: "bad", ms: 7000 }); });
    sock.on("turn-warn", m => toast(`Your turn ends in ${Math.round((m.ms || 15000) / 1000)} s. The next viewer is up after you.`, { ms: 8000 }));
    $("so-take").onclick = () => answerOffer(true);
    $("so-skip").onclick = () => answerOffer(false);
    $("seat-offer").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); answerOffer(true); } else if (e.key === "Escape") { e.preventDefault(); answerOffer(false); } });
    // ---- 🧩 Cheats (public/cheats.js): for whoever runs a copy of a browser game (co-op host, every Ghost / Race
    // player), saved per game, applied when the emulator starts and right away when changed mid-game.
    const cheatGame = () => {
      if (isNative(roomSystem) || picked?.kind === "shuffle") return null;
      const p = ghostMode() && !isHost ? (myRom?.file ? { kind: "file", file: myRom.file } : null) : isHost ? picked : null;
      if (p?.kind === "lib") return { key: "lib:" + p.item.path, libPath: p.item.path, name: roomGame || p.name };
      if (p?.kind === "file") return { key: `file:${p.file.name}:${p.file.size}`, file: p.file, name: roomGame || p.file.name };
      return null;
    };
    function renderCheats() {
      const g = cheatGame(), list = g ? Cheats.saved(g.key) : [];
      $("r-cheats-row").hidden = !g; $("g-cheats").hidden = !g || !inGame;
      $("r-cheats-sum").textContent = list.length ? `On: ${Cheats.summary(list)} (${list.length})` : "";
      $("g-cheats").classList.toggle("on", list.length > 0);
    }
    let cheatsAnnounced = "";
    function applyCheats(gm, announce) {
      const g = cheatGame(); if (!g || !gm) return;
      const list = Cheats.saved(g.key), n = Cheats.apply(gm, list);
      const sum = n ? `🧩 Cheats on: ${Cheats.summary(list)} (${n} code${n === 1 ? "" : "s"})` : "";
      if (announce && sum && sum !== cheatsAnnounced) { cheatsAnnounced = sum; sock.send({ t: "chat", text: sum }); }
    }
    const openCheats = () => {
      const g = cheatGame(); if (!g) return;
      Cheats.open({ ...g, system: roomSystem, onSave: () => {
        renderCheats();
        const gm = window.EJS_emulator?.gameManager;
        if (gm && inGame) applyCheats(gm, true);
      } });
    };
    $("r-cheats").onclick = openCheats;
    $("g-cheats").onclick = openCheats;

    // Host: a muted seat's buttons are ignored (and released once).
    const inputMuted = id => !!players.find(p => p.id === id)?.muted;

    // ---- 🎲 Viewer effects (server.mjs "Viewer effects"). The hub announces each effect to everyone ({t:"fx"}):
    // the host's page applies control / speed / pause / rewind effects to the game; every page applies the picture
    // effects to its own view of the game (so they're on the host's screen, which is what a stream captures).
    let fxGame = null;                       // set by the host's game: { inputChanged(), gm() }
    const fxActive = new Map();              // code -> { until, by, label }
    const fxNow = code => (fxActive.get(code)?.until || 0) > Date.now();
    const VISUAL_FX = ["flip", "mirror", "gray", "negative", "tiny"];
    // RetroPad ids: 0 B, 1 Y, 4-7 up/down/left/right, 8 A, 9 X, 16-19 stick right/left/down/up (N64: 0 A, 1 B).
    function fxInput(v) {
      if (!streamer?.fx?.on || !fxActive.size) return v;
      if (fxNow("freeze")) return new Array(Input.N).fill(0);
      const o = v.slice();
      const swap = (a, b) => { const t = o[a]; o[a] = o[b]; o[b] = t; };
      if (fxNow("invert")) { swap(4, 5); swap(6, 7); swap(16, 17); swap(18, 19); }
      if (fxNow("swapab")) { if (roomSystem === "n64") swap(0, 1); else { swap(0, 8); swap(1, 9); } }
      return o;
    }
    const rewindRing = [];                   // host, browser games: { at, bytes } every 3 s, about 20 s back
    let rewindTimer = 0, rewindOff = false;
    function rewindKeep() {
      const want = isHost && !rewindOff && !!streamer?.fx?.on && (streamer.fx.enabled || []).includes("rewind");
      if (want === !!rewindTimer) return;                // already in the right state: keep the ring going
      clearInterval(rewindTimer); rewindTimer = 0;
      if (!want) { rewindRing.length = 0; return; }
      rewindTimer = setInterval(() => {
        const gm = fxGame?.gm?.(); if (!gm || phase !== "playing") return;
        try {
          const bytes = gm.getState();
          if (!bytes || bytes.length > 24 * 1024 * 1024) { rewindOff = true; clearInterval(rewindTimer); rewindTimer = 0; rewindRing.length = 0; return; }   // huge states: no rewind
          rewindRing.push({ at: Date.now(), bytes }); while (rewindRing.length > 7) rewindRing.shift();
        } catch {}
      }, 3000);
    }
    function fxApply(code, start) {
      if (VISUAL_FX.includes(code)) {
        const st = $("stage");
        for (const v of VISUAL_FX) st.classList.toggle("fx-" + v, fxNow(v));
      }
      if (!isHost) return;
      if (["invert", "swapab", "freeze"].includes(code)) fxGame?.inputChanged();
      const gm = fxGame?.gm?.();
      if (!gm) return;
      try {
        if (code === "fast") { if (start) gm.setFastForwardRatio(2); gm.toggleFastForward(start ? 1 : 0); }
        if (code === "slow") { if (start) gm.setSlowMotionRatio(2); gm.toggleSlowMotion(start ? 1 : 0); }
        if (code === "pause") start ? window.EJS_emulator.pause() : window.EJS_emulator.play();
        if (code === "rewind" && start) {
          const target = Date.now() - 10000;
          const snap = rewindRing.filter(r => r.at <= target).at(-1) || rewindRing[0];
          if (snap) gm.loadState(snap.bytes); else toast("Rewind: nothing saved yet.", { ms: 2500 });
        }
      } catch (e) { console.warn("effect", code, e); }
    }
    function fxStart(m) {
      if (m.ms) fxActive.set(m.code, { until: Date.now() + m.ms, by: m.by, label: m.label });
      fxApply(m.code, true);
      if (m.ms) setTimeout(() => { if ((fxActive.get(m.code)?.until || 0) <= Date.now() + 50) fxEnd(m.code); }, m.ms + 100);
      renderFx();
    }
    function fxEnd(code) {
      if (!fxActive.has(code)) return;
      fxActive.delete(code);
      fxApply(code, false);
      renderFx();
    }
    sock.on("fx", m => fxStart(m));
    sock.on("fx-end", m => fxEnd(m.code));
    let fxBannerTimer = 0;
    function renderFx() {
      const fx = streamer?.fx, on = !!fx?.on, me = mine();
      // host settings
      $("fx-on").checked = on; $("fx-on").disabled = !isHost;
      $("fx-enabled").hidden = !on || !isHost;
      if (isHost && on && fx.catalog) {
        const en = new Set(fx.enabled || []);
        const key = JSON.stringify([...en]);
        if ($("fx-enabled").dataset.key !== key) {
          $("fx-enabled").dataset.key = key;
          $("fx-enabled").innerHTML = fx.catalog.map(e => `<label class="chip" title="${esc(e.label)}: ${e.cost} points${e.native ? "" : " (browser games only)"}"><input type="checkbox" data-fx="${e.code}"${en.has(e.code) ? " checked" : ""}> ${esc(e.label)}</label>`).join("");
        }
      }
      // buttons
      $("r-fx").hidden = !on; $("g-fx").hidden = !on;
      $("g-fx-pts").textContent = on && !isHost ? String(me?.points ?? 0) : on ? "Effects" : "";
      if (!on && !$("fx-panel").hidden) $("fx-panel").hidden = true;
      // panel
      if (on && !$("fx-panel").hidden) {
        $("fx-points").innerHTML = isHost ? "You're the host: effects are free for you (to test them)." : `You have <b>${me?.points ?? 0}</b> point${me?.points === 1 ? "" : "s"}. +1 every 30 s while you're here (up to 30).`;
        const activeGroups = new Map((fx.active || []).map(a => [fx.effects.find(e => e.code === a.code)?.group, a]));
        $("fx-grid").innerHTML = (fx.effects || []).map(e => {
          const busy = activeGroups.get(e.group), cd = e.cooldown > 0, poor = !isHost && (me?.points ?? 0) < e.cost;
          const why = !e.ok ? "Browser games only" : phase !== "playing" ? "Once the match runs" : busy ? `${busy.label} running` : cd ? `Ready in ${Math.ceil(e.cooldown / 1000)} s` : poor ? `Needs ${e.cost}` : "";
          return `<button type="button" class="fx-btn" data-fxgo="${e.code}" ${why ? "disabled" : ""} title="${esc(e.label)}${e.ms ? " for " + Math.round(e.ms / 1000) + " s" : ""}">
            <span class="fx-name">${esc(e.label)}</span><span class="fx-cost">${isHost ? "free" : e.cost + " pt" + (e.cost === 1 ? "" : "s")}</span>${why ? `<span class="fx-why">${esc(why)}</span>` : ""}</button>`;
        }).join("") || '<p class="small muted">The host has no effects switched on.</p>';
        $("fx-note").textContent = fx.native ? "Native emulator game: speed, pause and rewind aren't available; control effects apply to guests' seats." : "";
      }
      // banner over the game
      const live = [...fxActive.entries()].filter(([, a]) => a.until > Date.now());
      $("fx-banner").hidden = !live.length;
      $("fx-banner").textContent = live.map(([, a]) => `🎲 ${a.label} · ${a.by} · ${Math.max(0, Math.ceil((a.until - Date.now()) / 1000))} s`).join("   ");
      clearTimeout(fxBannerTimer);
      if (live.length) fxBannerTimer = setTimeout(renderFx, 500);
      rewindKeep();
    }
    $("fx-on").onchange = () => { if (isHost) sock.send({ t: "fx-config", on: $("fx-on").checked }); };
    $("fx-enabled").addEventListener("change", () => {
      if (!isHost) return;
      sock.send({ t: "fx-config", enabled: [...$("fx-enabled").querySelectorAll("[data-fx]")].filter(c => c.checked).map(c => c.dataset.fx) });
    });
    const toggleFx = btn => { const p = $("fx-panel"); p.hidden = !p.hidden; btn.setAttribute("aria-expanded", String(!p.hidden)); renderFx(); };
    $("r-fx").onclick = () => toggleFx($("r-fx"));
    $("g-fx").onclick = () => toggleFx($("g-fx"));
    $("fx-close").onclick = () => { $("fx-panel").hidden = true; };
    $("fx-grid").addEventListener("click", e => { const b = e.target.closest("[data-fxgo]"); if (b && !b.disabled) sock.send({ t: "fx", code: b.dataset.fxgo }); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("fx-panel").hidden && !document.querySelector("dialog[open]")) $("fx-panel").hidden = true; });

    // ---- roster rendering
    function renderRoom() {
      const sys = config.systems[roomSystem] || "Unknown console";
      $("r-game").textContent = roomGame || "Untitled game"; $("r-game").title = roomGame || "";
      const host = players.find(p => p.host);
      $("r-sub").textContent = `${sys} · ${rules.race ? "Race / speedrun" : ghostMode() ? "Single-Player Ghost" : "Co-op Netplay"}${streamer?.on ? " · Streamer Mode" : ""} · hosted by ${host ? host.name : "…"}`;
      $("r-ghost-badge").hidden = !ghostMode();
      $("r-mode").value = rules.race ? "race" : rules.mode || "coop";
      renderSplitsRule();
      renderCheats();
      $("r-mode").disabled = !isHost || phase !== "lobby";
      $("r-phase").textContent = { lobby: "Lobby", countdown: "Starting", loading: "Loading", playing: "In game" }[phase];
      $("r-phase").dataset.phase = phase;
      $("r-game-pick").textContent = roomGame || "—"; $("r-game-pick").title = roomGame || "";
      $("r-system").value = roomSystem;
      $("r-system").disabled = !isHost || phase !== "lobby";
      $("r-spec-rule").checked = !!rules.spectators; $("r-spec-rule").disabled = !isHost || phase !== "lobby";
      $("r-change-game").disabled = phase !== "lobby";
      $("r-rules-who").textContent = isHost ? "You set the rules" : "The host sets the rules";
      const m = mine();
      const ready = m?.ready === "ready";
      readyBtn.hidden = isHost || !!m?.spectator;
      readyBtn.textContent = ready ? "Ready ✓" : "Ready up";
      readyBtn.classList.toggle("primary", !ready);
      readyBtn.classList.toggle("is-ready", ready);
      readyBtn.setAttribute("aria-pressed", String(ready));
      const needRom = ghostMode() && !myRom && !ready;
      if (needRom) readyBtn.textContent = romHash ? "Checking ROM…" : "Load ROM first";
      readyBtn.title = needRom ? "Load your own ROM file before you ready up" : "";
      readyBtn.dataset.lockDisabled = (phase === "lobby" || phase === "countdown") && !needRom ? "0" : "1";
      readyBtn.disabled = readyBtn.dataset.lockDisabled === "1";
      $("r-spectate").hidden = isHost;
      $("r-spectate").textContent = streamer?.on ? (m?.spectator ? (m.queue ? "Sit out" : "Join the line") : "Back to the waiting room") : m?.spectator ? "Take a player slot" : "Watch instead";
      $("r-spectate").disabled = phase === "countdown" || (!m?.spectator && !rules.spectators);
      renderStreamer();
      const seated = players.filter(p => !p.spectator && !p.host);
      const waiting = seated.filter(p => p.ready !== "ready");
      if (isHost) {
        const noGame = !picked;             // a promoted host has no game file yet
        const noRom = ghostMode() && !myRom;
        $("r-start").dataset.lockDisabled = phase !== "lobby" || waiting.length || noRom || noGame ? "1" : "0";
        $("r-start").disabled = $("r-start").dataset.lockDisabled === "1";
        $("r-start-help").textContent = phase !== "lobby" ? "" : noGame ? `Pick the game file with "Change…" first.` : noRom ? "Reading your ROM…" : waiting.length ? `Waiting for ${waiting.map(p => p.name).join(", ")}` : seated.length ? "Everyone is ready." : "You can start alone or wait for friends.";
      } else {
        $("r-start-help").textContent = phase === "lobby" ? (waiting.length ? `${seated.length - waiting.length}/${seated.length} ready` : "Waiting for the host to start") : "";
      }
      $("r-start-help").title = $("r-start-help").textContent;
      renderRomBoxes();
      renderSlots();
      renderLoadActions();
      renderStreamBox();
    }

    function slotCard(s) {
      const p = players.find(x => x.slot === s && !x.spectator);
      const localSeat = reserved.includes(s) && !p;
      const el = document.createElement("div");
      el.className = "slotcard";
      if (!p && !localSeat) {
        el.classList.add("empty");
        const canMove = !isHost && phase !== "countdown" && mine() && (mine().slot !== s) && !(streamer?.on && mine().spectator);   // Streamer Mode: seats go in line order
        el.innerHTML = `<span class="slotnum">P${s + 1}</span><span class="muted grow">Open</span>
          ${canMove ? `<button class="small" data-move="${s}">Move here</button>` : ""}
          ${isHost && phase !== "countdown" && swapFrom != null && swapFrom !== s ? `<button class="small" data-swapto="${s}">Move P${swapFrom + 1} here</button>` : ""}`;
      } else if (localSeat) {
        const host = players.find(x => x.host);
        el.innerHTML = `<span class="slotnum">P${s + 1}</span>
          <div class="grow min0"><div class="pname trunc">${esc(host?.name || "Host")}'s PC</div><div class="small muted">Local player</div></div>
          <span class="rstate ${phaseStateClass(host)}">${stateLabel(host, true)}</span>`;
      } else {
        const isMe = p.id === myId();
        const muted = voice.muted.has(p.key);
        const ping = p.rtt;
        el.classList.toggle("me", isMe);
        el.innerHTML = `<span class="slotnum">P${s + 1}</span>
          <div class="grow min0">
            <div class="pname-row">
              <span class="pname trunc" title="${esc(p.name)}">${esc(p.name)}</span>
              ${p.voice ? `<span class="vu ${muted ? "muted" : ""}" data-key="${esc(p.key)}" title="${muted ? "Muted" : "Voice"}"><i></i><i></i><i></i><i></i></span>` : ""}
            </div>
            <div class="small muted trunc"><span class="id">#${esc(prettyId(p.key).slice(0, 9))}</span>${p.host ? " · Host" : ""}${isMe ? " · You" : ""}</div>
          </div>
          <span class="ping ${pingClass(ping)}" title="Round trip to the hub">${pingLabel(ping)}</span>
          ${p.voice && !isMe ? `<button class="small icon mute ${muted ? "on" : ""}" data-mute="${esc(p.key)}" aria-pressed="${muted}" title="${muted ? "Unmute" : "Mute"} ${esc(p.name)} for you" aria-label="${muted ? "Unmute" : "Mute"} ${esc(p.name)}">${muted ? "🔇" : "🔊"}</button>` : ""}
          ${ghostMode() && (p.rom || p.host) ? romBadge(p.rom, refRom(), p.host) : ""}
          <span class="rstate ${phaseStateClass(p)}">${stateLabel(p)}</span>
          ${streamer?.on && !p.host && p.turnLeft != null ? `<span class="small muted st-left" title="Time left in this turn">⏱ ${Math.ceil(p.turnLeft / 60000)} min</span>` : ""}
          ${streamer?.on && isHost && !p.host ? `<span class="st-seat">
            <button class="small icon${p.keep ? " on" : ""}" data-st="keep" data-id="${p.id}" aria-pressed="${!!p.keep}" title="${p.keep ? "Kept: stays on the next rotation" : "Keep this player on the next rotation (winner stays)"}">👑</button>
            <button class="small icon${p.muted ? " on" : ""}" data-st="mute-input" data-id="${p.id}" aria-pressed="${!!p.muted}" title="${p.muted ? "Inputs muted: their buttons are ignored. Click to allow." : "Mute this player's inputs"}">${p.muted ? "🚫" : "🎮"}</button>
            <button class="small icon" data-st="seat-back" data-id="${p.id}" title="Send back to the waiting room">⤺</button></span>` : ""}
          ${!isMe && window.RH.Friends && !window.RH.Friends.isFriend(p.key) ? `<button class="small" data-addfriend="${esc(p.key)}" data-name="${esc(p.name)}" title="Add ${esc(p.name)} to your Buddy List">＋ Buddy</button>` : ""}
          ${isHost && !p.host && phase !== "countdown" ? `<button class="small" data-swap="${s}" aria-pressed="${swapFrom === s}">${swapFrom === s ? "Cancel" : swapFrom != null ? `Swap with P${swapFrom + 1}` : "Swap"}</button>` : ""}`;
        if (phase === "loading" || (phase === "playing" && p.progress < 100)) {
          el.insertAdjacentHTML("beforeend", `<div class="bar"><i style="width:${p.progress}%"></i></div>`);
        }
      }
      return el;
    }
    const stateLabel = (p, local) => {
      if (!p) return "—";
      if (p.away) return "Reconnecting…";      // seat held by the hub for 30 s
      if (p.host && phase === "lobby") return local ? "Host" : "Host";
      if (p.ready === "loading") return `Loading ${p.progress}%`;
      if (ghostMode() && phase === "lobby" && !p.rom && !p.host) return "No ROM loaded";
      return p.ready === "ready" ? "Ready" : "Not ready";
    };
    const phaseStateClass = p => !p ? "" : p.away ? "loading" : p.ready === "ready" || (p.host && phase === "lobby") ? "ready" : p.ready === "loading" ? "loading" : "notready";

    let swapFrom = null;
    function renderSlots() {
      const box = $("r-slots"); box.textContent = "";
      for (let s = 0; s < config.maxPlayers; s++) box.appendChild(slotCard(s));
      const specs = players.filter(p => p.spectator);
      if (streamer?.on) specs.sort((a, b) => (a.queue || 999) - (b.queue || 999) || a.id - b.id);
      $("r-specs").hidden = !specs.length && !streamer?.on;
      $("r-specs-title").textContent = streamer?.on ? `Waiting room · ${streamer.waiting} in line` : "Spectators";
      $("r-queue-help").hidden = !streamer?.on;
      $("r-queue-help").textContent = !streamer?.on ? "" : isHost ? "Viewers watch the stream here and get a seat in turn. Rotate with ↻ (Ctrl+Shift+R)."
        : mine()?.spectator ? (mine().queue ? `You're #${mine().queue} in line for a seat.` : mine().afk ? "You were away when your turn came. Join the line again when you're ready." : "You're sitting out: just watching.") : "";
      if (!specs.length && streamer?.on) $("r-spec-list").innerHTML = '<li class="small muted">Nobody waiting yet. Viewers who open your invite link land here.</li>';
      else $("r-spec-list").innerHTML = specs.map(p => `<li>${streamer?.on ? `<span class="q-num">${p.queue ? "#" + p.queue : p.afk ? "away" : "out"}</span>` : ""}<span class="pname trunc grow" title="${esc(p.name)}">${esc(p.name)}${p.offered != null ? ` <small class="muted">offered P${p.offered + 1}</small>` : ""}</span>
        ${p.voice ? `<span class="vu" data-key="${esc(p.key)}"><i></i><i></i><i></i><i></i></span>` : ""}
        <span class="ping ${pingClass(p.rtt)}">${pingLabel(p.rtt)}</span></li>`).join("");
      $("r-count").textContent = `${players.filter(p => !p.spectator).length + reserved.filter(s => !players.some(p => p.slot === s)).length}/${config.maxPlayers}`;
      box.querySelectorAll("[data-move]").forEach(b => b.onclick = guard(b, async () => sock.send({ t: "slot", slot: Number(b.dataset.move) })));
      box.querySelectorAll("[data-mute]").forEach(b => b.onclick = () => { voice.toggleMute(b.dataset.mute); });
      box.querySelectorAll("[data-st]").forEach(b => b.onclick = guard(b, async () => sock.send({ t: b.dataset.st, id: Number(b.dataset.id), on: b.getAttribute("aria-pressed") !== "true" })));
      box.querySelectorAll("[data-swap]").forEach(b => b.onclick = () => {
        const s = Number(b.dataset.swap);
        if (swapFrom === s) swapFrom = null;
        else if (swapFrom == null) swapFrom = s;
        else { sock.send({ t: "swap", a: swapFrom, b: s }); swapFrom = null; }
        renderSlots();
      });
      box.querySelectorAll("[data-swapto]").forEach(b => b.onclick = () => { sock.send({ t: "swap", a: swapFrom, b: Number(b.dataset.swapto) }); swapFrom = null; renderSlots(); });
      game?.redraw();
      if (Modal.isOpen($("ghost-panel"))) renderGhostPanel();
    }

    // ---- countdown (server-timed; freezes and aborts if anyone unreadies or drops)
    const cd = $("countdown");
    let cdTimer = 0;
    function startCountdown(ms) {
      clearInterval(cdTimer);
      Sfx.unlock();
      const end = performance.now() + ms;
      cd.classList.remove("frozen");
      $("cd-sub").textContent = ghostMode() && inGame ? "Runs start on GO!" : "Match starting";
      $("cd-abort").textContent = isHost ? "Abort" : "Not ready";
      if (!Modal.isOpen(cd)) Modal.open(cd, { focus: "#cd-abort" });
      let lastN = null;
      const tick = () => {
        const left = end - performance.now();
        const n = Math.max(0, Math.ceil(left / 1000));
        if (n !== lastN) {
          lastN = n;
          $("cd-num").textContent = n > 0 ? n : "GO!";
          $("cd-num").classList.remove("pop"); void $("cd-num").offsetWidth; $("cd-num").classList.add("pop");
          n > 0 ? Sfx.tick() : Sfx.go();
          if (n === 0 && ghostMode()) game?.go?.();      // everyone's run starts on their own GO
        }
        if (left <= 0) clearInterval(cdTimer);
      };
      tick(); cdTimer = setInterval(tick, 50);
    }
    function freezeCountdown(reason) {
      clearInterval(cdTimer);
      if (!Modal.isOpen(cd)) return;
      cd.classList.add("frozen");
      $("cd-sub").textContent = reason || "Countdown stopped";
      Sfx.warn();
      setTimeout(() => { if (cd.classList.contains("frozen")) Modal.close(cd); }, 1600);
    }
    $("cd-abort").onclick = guard($("cd-abort"), async () => {
      if (isHost) sock.send({ t: "abort" }); else sock.send({ t: "ready", state: "notready" });
    });

    // ---- phase changes
    let inGame = false;
    function onPhase(next) {
      const prev = phase; phase = next;
      if (next === "loading" || next === "playing") {
        if (Modal.isOpen(cd)) { clearInterval(cdTimer); Modal.close(cd); }
        if (!inGame) { inGame = true; enterGame(); }
      }
      if (next === "playing" && prev !== "playing") { game?.started(); offerResume(); }
      if (inGame) $("loadboard").hidden = next === "playing" || (next === "countdown" && ghostMode());
      renderRoom();
      renderLoadBoard();
    }
    function enterGame() {
      document.body.classList.add("playing");
      $("hub").hidden = true; $("game").hidden = false;
      $("g-title").textContent = roomGame; $("g-title").title = roomGame;
      $("g-code").textContent = code;
      $("g-invite").onclick = () => copyInvite(code, "Copied! (password not included)");
      $("g-full").onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else $("game").requestFullscreen?.().catch(() => {}); };
      $("g-rematch").hidden = !isHost;
      $("g-rematch").onclick = () => {
        if (!confirm("Play again? Everyone goes back to the lobby with the same game and settings, and readies up again.")) return;
        sock.send({ t: "rematch" });
      };
      $("g-leave").onclick = () => {
        if (isHost && !confirm("Stop hosting? The match ends for everyone and hosting passes to another player.")) return;
        leave();
      };
      $("loadboard").hidden = phase === "playing";
      $("g-ghost-badge").hidden = !ghostMode();
      $("g-ghosts").hidden = !ghostMode();
      $("g-ghost-toggle").hidden = !ghostMode();
      $("g-save").hidden = $("g-saves").hidden = !canSave();
      $("g-stream").hidden = ghostMode();
      $("sp-settings").appendChild($("stream-box"));
      $("g-chat-drawer").appendChild($("chat"));
      $("chat-close").hidden = false;
      renderGhostToggle();
      $("load-help").textContent = ghostMode()
        ? "Everyone boots their own copy of the game. The 3-2-1 starts when everyone is at 100%."
        : "The match starts when everyone is at 100%.";
      if (!game) {
        if (ghostMode()) game = mine()?.spectator ? makeGhostWatch() : makeEmuGame({ ghost: true });
        else game = isHost ? (isNative(roomSystem) ? makeNativeGame() : picked?.kind === "shuffle" ? makeShuffleGame() : makeEmuGame({ ghost: false })) : makeGuestGame();
        if (lastStream) game.stream?.(lastStream);
      }
      game.load();
      syncJet();
      renderLoadActions();
      // RetroAchievements: whoever runs a copy of the game looks it up by its ROM hash; co-op guests by title.
      raGame?.close();
      raGame = RA.createGame({
        isBrowserGame: !isNative(roomSystem),
        chat: text => sock.send({ t: "chat", text }),
        params: async () => {
          const p = ghostMode() && !isHost ? (myRom ? { kind: "file", file: myRom.file } : null) : isHost ? picked : null;
          if (p?.kind === "lib") return { path: p.item.path };
          if (p?.kind === "file") return { file: p.file, system: roomSystem, ext: fileExt(p.file), name: roomGame };
          return { system: roomSystem, ext: "", name: roomGame };
        },
      });
    }
    // Ghost mode after an aborted countdown: guests ready up again, the host restarts the countdown.
    function renderLoadActions() {
      const show = inGame && ghostMode() && phase === "loading" && staged;
      $("load-actions").hidden = !show;
      if (!show) return;
      const m = mine();
      const lb = $("lb-ready"), ready = m?.ready === "ready";
      lb.hidden = isHost || !!m?.spectator;
      lb.textContent = ready ? "Ready ✓" : "Ready up";
      lb.classList.toggle("is-ready", ready); lb.setAttribute("aria-pressed", String(ready));
      lb.dataset.lockDisabled = (m?.progress ?? 0) < 100 ? "1" : "0"; lb.disabled = lb.dataset.lockDisabled === "1";
      const st = $("lb-start");
      st.hidden = !isHost;
      const loading = players.filter(p => p.progress < 100), waiting = players.filter(p => !p.spectator && !p.host && p.ready !== "ready");
      st.dataset.lockDisabled = loading.length || waiting.length ? "1" : "0"; st.disabled = st.dataset.lockDisabled === "1";
      $("load-help").textContent = loading.length ? `Loading: ${loading.map(p => p.name).join(", ")}`
        : waiting.length ? `Countdown stopped. Waiting for ${waiting.map(p => p.name).join(", ")} to ready up.`
        : isHost ? "Everyone is ready. Start the countdown when you are." : "Everyone is ready. Waiting for the host.";
    }
    $("lb-ready").onclick = guard($("lb-ready"), async () => sock.send({ t: "ready", state: mine()?.ready === "ready" ? "notready" : "ready" }));
    $("lb-start").onclick = guard($("lb-start"), async () => { Sfx.unlock(); sock.send({ t: "start" }); });
    function renderLoadBoard() {
      if ($("loadboard").hidden) return;
      const rows = [];
      for (const p of players.slice().sort((a, b) => (a.spectator - b.spectator) || a.slot - b.slot)) {
        const label = p.spectator ? "Watching" : `P${p.slot + 1}`;
        rows.push(`<div class="lrow"><span class="slotnum">${label}</span><span class="pname trunc" title="${esc(p.name)}">${esc(p.name)}</span>
          <div class="bar grow"><i style="width:${p.progress}%"></i></div><span class="pct">${p.progress}%</span></div>`);
      }
      $("load-rows").innerHTML = rows.join("");
    }

    // ---- jet loading screen (public/jetfx): flies behind the loading board for as long as the board is up.
    // Event-driven: whatever shows or hides the board (phase changes, the native host steps) starts or ends it.
    let jet = null;
    const syncJet = () => {
      const on = inGame && !$("loadboard").hidden;
      if (on && !jet) jet = window.RH.JetFX?.hold("match", { mount: $("stage"), panel: false, lite: true, delay: 600, title: roomGame,
        console: config.systems?.[roomSystem] || roomSystem, progress: lastPct >= 0 ? lastPct : 0, status: "Loading" }) || null;
      else if (!on && jet) { jet.done({ ready: true }); jet = null; }
    };
    new MutationObserver(syncJet).observe($("loadboard"), { attributes: true, attributeFilter: ["hidden"] });

    // ---- progress reporting (rate-limited)
    let lastPct = -1, pctTimer = 0, pendingPct = 0;
    function reportProgress(pct) {
      pct = Math.max(0, Math.min(100, Math.round(pct)));
      jet?.update({ progress: Math.max(pct, jet.opts.progress || 0) });
      if (pct <= lastPct && pct !== 100) return;
      pendingPct = Math.max(pendingPct, pct);
      if (pctTimer) return;
      const flush = () => {
        pctTimer = 0;
        if (pendingPct === lastPct) return;
        lastPct = pendingPct;
        sock.send({ t: "progress", pct: lastPct });
        if (isHost) sock.joinMsg = { ...sock.joinMsg, progress: lastPct };
      };
      if (pct === 100) flush(); else pctTimer = setTimeout(flush, 200);
    }

    // ---- socket handlers
    let awayIds = new Set(), hostAwayMsg = false;
    sock.on("roster", m => {
      players = m.players || [];
      streamer = m.streamer || null;
      for (const a of streamer?.fx?.active || []) if (!fxActive.has(a.code) && a.left > 0) fxStart({ code: a.code, ms: a.left, by: a.by, label: a.label });
      if (!streamer?.fx?.on) for (const code of [...fxActive.keys()]) fxEnd(code);
      queueMicrotask(renderFx);
      const wasGhost = ghostMode();
      rules = m.rules || rules; reserved = m.reserved || reserved; staged = !!m.staged;
      if (ghostMode() && !wasGhost) hashHostRom();
      if (m.game != null) roomGame = m.game;
      if (m.system) { if (m.system !== roomSystem) game?.systemChanged?.(m.system); roomSystem = m.system; }
      if (m.phase && m.phase !== phase) onPhase(m.phase); else renderRoom();
      syncRaceClock(m.race);
      showShuffle(m.shuffle);
      ensureRacePanel();
      if (isHost) {
        game?.roster?.(players);
        net.setGuests(players.filter(p => !p.host).map(p => p.id));
        net.setVoiceOn(players.filter(p => !p.host && p.voice).map(p => p.id));
        net.setGhostOn(players.filter(p => !p.host && p.ghost).map(p => p.id));
      } else if (inGame && phase !== "lobby") {
        const host = players.find(p => p.host);
        if (m.hostId == null || host?.away) { message("The host disconnected. Waiting for them to come back…", true); hostAwayMsg = true; }
        else if (hostAwayMsg) { message("", false); hostAwayMsg = false; }
      }
      const nowAway = new Set(players.filter(p => p.away && p.id !== myId()).map(p => p.id));
      for (const id of nowAway) if (!awayIds.has(id)) toast(`${players.find(p => p.id === id).name} lost connection. Holding their seat…`, { ms: 3000 });
      for (const id of awayIds) if (!nowAway.has(id)) { const p = players.find(x => x.id === id); toast(p ? `${p.name} is back.` : "A player didn't come back in time.", { kind: p ? "ok" : undefined, ms: 2500 }); }
      awayIds = nowAway;
      syncGhosts();
      renderLoadBoard();
      renderLoadActions();
    });
    // A running match went back to the lobby (host migration): the game lived in the old host's browser,
    // so reload into the lobby with our seat kept.
    // Back to the lobby from a running game (rematch, host migration): reload into it; the host keeps a library game.
    const keepGame = () => (isHost && picked?.kind === "lib" ? { lib: picked.item.path } : {});
    const keepFiles = () => ({ host: isHost && picked?.kind === "file" ? picked.file : null,
      rom: !isHost && ghostMode() && myRom?.file ? myRom.file : null });
    sock.on("phase", m => { if (m.phase === "lobby" && inGame) return handOff(sock, code, keepGame(), keepFiles()); onPhase(m.phase); });
    sock.on("promoted", () => handOff(sock, code, {}, keepFiles()));
    // Rematch: everyone reloads into the lobby (the game itself can't be reset in place); the host keeps the game.
    sock.on("rematch", () => handOff(sock, code, { rematch: true, ...keepGame() }, keepFiles()));
    sock.on("countdown", m => {
      if (m.cancelled) { freezeCountdown(m.reason); return; }
      startCountdown(m.ms || 3000);
    });
    sock.on("notice", m => {
      showErr($("r-notice"), m.msg);
      toast(m.msg, { ms: 3000 });
      clearTimeout(sock.noticeT); sock.noticeT = setTimeout(() => showErr($("r-notice"), ""), 6000);
    });
    sock.on("signal", m => net.onSignal(m.from, m.data));
    // A hub drop doesn't break the WebRTC game link, so play goes on if it's still up; the hub holds our seat for 30 s.
    let dropOverlay = false;
    sock.on("dropped", () => {
      toast("Connection to the hub lost. Reconnecting…", { kind: "bad", ms: 2500 });
      if (inGame && !isHost && !net.connected) { message("Connection to the hub lost. Reconnecting…", true); dropOverlay = true; }
    });
    sock.on("rejoined", m => {
      toast(m.resumed ? "Reconnected. Your seat was kept." : "Reconnected.", { kind: "ok" });
      if (dropOverlay) { message("", false); dropOverlay = false; }
      if (myGhost) { if (isHost) net.setHostGhost(myGhost, myId()); sock.send({ t: "ghost", on: true }); }
      if (lastPct >= 0) { const p = lastPct; lastPct = -1; reportProgress(p); }
      sock.send({ t: "voice", on: !!voice.mic });
    });
    sock.on("fatal", m => {
      // No inline handlers (the Content-Security-Policy blocks them): wire the button up after rendering.
      const text = esc(m.msg || "You were disconnected from the lobby.") + ' <div style="margin-top:10px"><button data-act="hub">Back to the hub</button></div>';
      if (inGame) { message(text, true); $("g-msg").querySelector("[data-act=hub]").onclick = () => location.replace("/"); }
      else { showErr($("r-notice"), m.msg || "You were disconnected from the lobby."); }
    });
    if (!isHost) sock.joinMsg = { t: "join", role: "guest", room: code, password: opts.password, spectate: false };
    if (isHost) hashHostRom();
    // Back after a reload in ghost / race mode: the ROM file parked for the reload, else tell the hub we have none,
    // so this player loads it again instead of looking ready without a file.
    if (!isHost && opts.resumed && ghostMode()) {
      const f = opts.romFile;
      if (f) useRom(f, f.name, f, f);
      else if (mine()?.rom || sock.joined?.rom) sock.send({ t: "rom", rom: null });
      else setTimeout(() => { if (!myRom && mine()?.rom) sock.send({ t: "rom", rom: null }); }, 1500);
    }
    // Reconnects should keep the seat type we have now.
    const syncJoinMsg = () => { if (!isHost) sock.joinMsg = { ...sock.joinMsg, spectate: !!mine()?.spectator, slot: mine()?.slot }; };
    setInterval(syncJoinMsg, 1000);

    // ---- ghost overlay: other players' runs drawn translucent over this player's game
    function ensureComp() {
      if (comp) return comp;
      comp = new Ghost.Compositor($("stage"));
      comp.setOptions(Settings.get("ghost"));
      queueMicrotask(syncGhosts);           // ghosts that arrived before the game view existed
      return comp;
    }
    function syncGhosts() {
      if (!comp) return;
      const follow = game?.following?.() ?? null;
      for (const [id, track] of ghostTracks) {
        const p = players.find(x => x.id === id);
        if (!p || id === myId() || id === follow || pips.has(id)) { comp.set(id, null); continue; }
        comp.set(id, track, { slot: p.slot, name: p.name });
      }
      for (const g of comp.list()) if (!ghostTracks.has(g.id)) comp.set(g.id, null);
      for (const [id, w] of pips) {
        const p = players.find(x => x.id === id);
        if (!p || p.spectator) { closePip(id); continue; }
        w.setTrack(ghostTracks.get(id) || null);
        w.setName(p);
      }
      game?.ghostsChanged?.();
      if (Modal.isOpen($("ghost-panel"))) renderGhostPanel();
    }
    const gp = $("ghost-panel");
    const saveGhost = patch => { Settings.patch("ghost", patch); comp?.setOptions(Settings.get("ghost")); renderPlayersNow(); };
    function renderGhostPanel() {
      const g = Settings.get("ghost");
      $("gp-opacity").value = Math.round(g.opacity * 100);
      $("gp-opacity-val").textContent = Math.round(g.opacity * 100) + "%";
      $("gp-tint").checked = !!g.tint;
      $("gp-show").checked = g.enabled !== false;
      $("gp-blend").value = g.blend === "screen" ? "screen" : "normal";
      const others = players.filter(p => !p.spectator && p.id !== myId()).sort((a, b) => a.slot - b.slot);
      const follow = game?.following?.();
      const box = $("gp-slots");
      const opts = c => Ghost.PALETTE.map(o => `<option value="${o.hex}" ${o.hex === c ? "selected" : ""}>${o.label}</option>`).join("");
      box.innerHTML = others.length ? others.map(p => {
        const c = g.colors[p.slot] ?? "";
        return `<div class="gp-slot"><span class="slotnum">P${p.slot + 1}</span>
          <span class="swatch ${c ? "" : "none"}" style="${c ? `background:${c}` : ""}"></span>
          <span class="pname trunc" title="${esc(p.name)}">${esc(p.name)}${ghostTracks.has(p.id) ? "" : ' <span class="muted small">(no video yet)</span>'}</span>
          ${game?.follow ? `<button class="small ${follow === p.id ? "on" : ""}" data-follow="${p.id}" aria-pressed="${follow === p.id}" title="Show this player solid">Follow</button>` : ""}
          <button class="small" data-pip="${p.id}" aria-pressed="${pips.has(p.id)}" title="${pips.has(p.id) ? "Put back as a ghost" : "Pop out into its own window"}">${pips.has(p.id) ? "Pop in" : "Pop out"}</button>
          <select data-color="${p.slot}" aria-label="Ghost color for P${p.slot + 1}">${opts(c)}</select>
          <input type="checkbox" data-show="${p.slot}" ${g.hidden.includes(p.slot) ? "" : "checked"} aria-label="Show P${p.slot + 1}'s ghost" title="Show ghost">
        </div>`;
      }).join("") : '<div class="small muted">No other players yet.</div>';
      box.querySelectorAll("[data-color]").forEach(sel => sel.onchange = () => { saveGhost({ colors: { ...Settings.get("ghost").colors, [sel.dataset.color]: sel.value } }); renderGhostPanel(); });
      box.querySelectorAll("[data-show]").forEach(cb => cb.onchange = () => {
        const s = Number(cb.dataset.show), hidden = new Set(Settings.get("ghost").hidden);
        cb.checked ? hidden.delete(s) : hidden.add(s);
        saveGhost({ hidden: [...hidden] });
      });
      box.querySelectorAll("[data-follow]").forEach(b => b.onclick = () => { game.follow(Number(b.dataset.follow)); renderGhostPanel(); });
      box.querySelectorAll("[data-pip]").forEach(b => b.onclick = () => { const id = Number(b.dataset.pip); pips.has(id) ? closePip(id) : openPip(id); renderGhostPanel(); });
    }
    $("gp-show").addEventListener("change", () => setGhostsOn($("gp-show").checked));
    $("gp-opacity").addEventListener("input", () => { const v = Number($("gp-opacity").value) / 100; $("gp-opacity-val").textContent = Math.round(v * 100) + "%"; saveGhost({ opacity: v }); });
    $("gp-tint").addEventListener("change", () => saveGhost({ tint: $("gp-tint").checked }));
    $("gp-blend").addEventListener("change", () => saveGhost({ blend: $("gp-blend").value }));
    const closeGp = () => Modal.close(gp);
    $("gp-close").onclick = closeGp;
    $("g-ghosts").onclick = () => {
      if (Modal.isOpen(gp)) return closeGp();
      renderGhostPanel();
      $("g-ghosts").setAttribute("aria-expanded", "true");
      Modal.open(gp, { focus: "#gp-opacity", onClose: () => $("g-ghosts").setAttribute("aria-expanded", "false") });
    };
    const renderPlayersNow = () => game?.redraw();
    const ghostColors = () => ghostMode() && Settings.get("ghost").tint ? Settings.get("ghost").colors : null;
    const ghostHud = () => ghostMode() ? { hidden: new Set(Settings.get("ghost").hidden), pipped: new Set(pips.keys()) } : null;

    // Master on/off: one click (HUD button) or the O key.
    function renderGhostToggle() {
      const on = Settings.get("ghost").enabled !== false, b = $("g-ghost-toggle");
      b.setAttribute("aria-pressed", String(on));
      b.textContent = on ? "👻 Ghosts on" : "👻 Ghosts off";
      if (Modal.isOpen(gp)) $("gp-show").checked = on;
    }
    function setGhostsOn(on) { saveGhost({ enabled: on }); renderGhostToggle(); }
    $("g-ghost-toggle").onclick = () => setGhostsOn(Settings.get("ghost").enabled === false);
    window.addEventListener("keydown", e => {
      if (e.code !== "KeyO" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !inGame || !ghostMode()) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      setGhostsOn(Settings.get("ghost").enabled === false);
      toast(Settings.get("ghost").enabled === false ? "Ghosts hidden (O to show)" : "Ghosts shown", { ms: 1000 });
    });
    // One player's ghost on/off (click their chip in the top bar). A popped-out player is put back instead.
    function toggleGhost(id) {
      if (pips.has(id)) { closePip(id); return; }
      const p = players.find(x => x.id === id); if (!p) return;
      const hidden = new Set(Settings.get("ghost").hidden);
      hidden.has(p.slot) ? hidden.delete(p.slot) : hidden.add(p.slot);
      saveGhost({ hidden: [...hidden] });
      if (Modal.isOpen(gp)) renderGhostPanel();
    }
    // Chips: click = toggle that ghost; drag onto the game = pop out into a picture-in-picture window.
    const chipBox = $("g-players");
    chipBox.addEventListener("pointerdown", e => {
      const chip = e.target.closest(".pchip[data-gid]");
      if (!chip || !ghostMode() || e.button !== 0) return;
      e.preventDefault();
      const id = Number(chip.dataset.gid), sx = e.clientX, sy = e.clientY;
      let proxy = null;
      const stage = $("stage"), drop = $("pip-drop");
      const overStage = ev => { const r = stage.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; };
      const move = ev => {
        if (!proxy && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
          hudDrag.on = true;
          proxy = chip.cloneNode(true); proxy.classList.add("chip-proxy"); document.body.appendChild(proxy);
          drop.hidden = false;
        }
        if (proxy) { proxy.style.left = ev.clientX + "px"; proxy.style.top = ev.clientY + "px"; drop.style.opacity = overStage(ev) ? "1" : ".4"; }
      };
      const end = ev => {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
        hudDrag.on = false;
        drop.hidden = true;
        if (proxy) { proxy.remove(); if (ev.type === "pointerup" && overStage(ev)) openPip(id, ev.clientX, ev.clientY); }
        else if (ev.type === "pointerup") toggleGhost(id);
        renderPlayersNow();
      };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
    });
    chipBox.addEventListener("keydown", e => {
      const chip = e.target.closest(".pchip[data-gid]"); if (!chip) return;
      const id = Number(chip.dataset.gid);
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGhost(id); }
      else if (e.key === "p" || e.key === "P") { e.preventDefault(); pips.has(id) ? closePip(id) : openPip(id); }
    });

    // ---- picture-in-picture windows: a partner's run, solid, movable and resizable
    const pips = new Map();   // playerId -> window api
    const pipLayer = $("pip-layer");
    const savePipGeo = (slot, el) => {
      const L = pipLayer.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      Settings.patch("ghost", { pip: { ...Settings.get("ghost").pip, [slot]: { x: (r.left - L.left) / L.width, y: (r.top - L.top) / L.height, w: r.width / L.width } } });
    };
    function clampPip(el) {
      const L = pipLayer.getBoundingClientRect();
      const w = Math.min(el.offsetWidth, L.width), h = Math.min(el.offsetHeight, L.height);
      el.style.left = Math.max(0, Math.min(L.width - w, parseFloat(el.style.left) || 0)) + "px";
      el.style.top = Math.max(0, Math.min(L.height - h, parseFloat(el.style.top) || 0)) + "px";
    }
    function dragWith(handle, onMove, onEnd) {
      handle.addEventListener("pointerdown", e => {
        if (e.button !== 0 || e.target.closest("button")) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const sx = e.clientX, sy = e.clientY;
        const mv = ev => onMove(ev.clientX - sx, ev.clientY - sy, true);
        const up = () => { handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up); onEnd(); };
        onMove(0, 0, false);
        handle.addEventListener("pointermove", mv); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
      });
    }
    function openPip(id, cx, cy) {
      if (pips.has(id)) return;
      const p = players.find(x => x.id === id); if (!p || p.spectator) return;
      const el = document.createElement("div");
      el.className = "pip"; el.setAttribute("role", "group");
      el.innerHTML = `<div class="pip-bar" title="Drag to move">
          <span class="slotnum">P${p.slot + 1}</span><span class="pname trunc"></span>
          <button class="small icon" data-act="native" title="Separate window that stays on top of other apps" aria-label="Open in a separate window">⧉</button>
          <button class="small icon" data-act="close" title="Put back as a ghost" aria-label="Close and put back as a ghost">✕</button>
        </div>
        <video muted autoplay playsinline></video>
        <div class="pip-resize" title="Drag to resize"></div>`;
      pipLayer.appendChild(el);
      const video = el.querySelector("video");
      const L = pipLayer.getBoundingClientRect();
      const geo = Settings.get("ghost").pip?.[p.slot];
      const w = Math.max(180, Math.min(L.width * 0.9, geo ? geo.w * L.width : Math.max(240, L.width * 0.28)));
      el.style.width = w + "px";
      const h = el.offsetHeight;
      if (cx != null) { el.style.left = (cx - L.left - w / 2) + "px"; el.style.top = (cy - L.top - 14) + "px"; }
      else if (geo) { el.style.left = geo.x * L.width + "px"; el.style.top = geo.y * L.height + "px"; }
      else { el.style.left = (L.width - w - 12) + "px"; el.style.top = (L.height - h - 12) + "px"; }
      clampPip(el);
      // move
      let ox = 0, oy = 0;
      dragWith(el.querySelector(".pip-bar"), (dx, dy, moving) => {
        if (!moving) { ox = parseFloat(el.style.left); oy = parseFloat(el.style.top); return; }
        el.style.left = ox + dx + "px"; el.style.top = oy + dy + "px"; clampPip(el);
      }, () => savePipGeo(p.slot, el));
      // resize (keeps the picture's aspect; height follows the video)
      let ow = 0;
      dragWith(el.querySelector(".pip-resize"), (dx, dy, moving) => {
        if (!moving) { ow = el.offsetWidth; return; }
        const max = pipLayer.getBoundingClientRect().width - parseFloat(el.style.left);
        el.style.width = Math.max(160, Math.min(max, ow + Math.max(dx, dy * 4 / 3))) + "px"; clampPip(el);
      }, () => savePipGeo(p.slot, el));
      video.addEventListener("resize", () => { if (video.videoWidth) video.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`; clampPip(el); });
      // the browser's own floating window (works over other apps / on a second monitor)
      const nativeBtn = el.querySelector("[data-act=native]");
      nativeBtn.hidden = !document.pictureInPictureEnabled;
      nativeBtn.onclick = () => video.requestPictureInPicture?.().catch(() => toast("This browser can't pop the video out.", { kind: "bad" }));
      video.addEventListener("enterpictureinpicture", () => el.classList.add("native"));
      video.addEventListener("leavepictureinpicture", () => el.classList.remove("native"));
      el.querySelector("[data-act=close]").onclick = () => closePip(id);
      let cur = null;
      const api = {
        el, video,
        setTrack(t) { if (t === cur) return; cur = t; video.srcObject = t ? new MediaStream([t]) : null; if (t) video.play().catch(() => {}); },
        setName(pl) { const n = el.querySelector(".pname"); n.textContent = pl.name; n.title = pl.name; el.setAttribute("aria-label", `P${pl.slot + 1} ${pl.name}`); },
      };
      pips.set(id, api);
      api.setName(p);
      syncGhosts(); renderPlayersNow();
    }
    function closePip(id) {
      const w = pips.get(id); if (!w) return;
      pips.delete(id);
      if (document.pictureInPictureElement === w.video) document.exitPictureInPicture().catch(() => {});
      w.video.srcObject = null; w.el.remove();
      syncGhosts(); renderPlayersNow();
      if (Modal.isOpen(gp)) renderGhostPanel();
    }
    window.addEventListener("resize", () => pips.forEach(w => clampPip(w.el)));

    // Late join: the match is already running.
    renderRoom();
    if (phase === "loading" || phase === "playing") { inGame = true; enterGame(); }

    // ============================================================ emulator game
    // Co-op host: runs the game, streams it, applies guests' inputs.
    // Ghost (any seated player): runs their own ROM, sends a low-rate ghost of their screen, starts on GO.
    function makeEmuGame({ ghost }) {
      const local = ghost ? [0] : opts.params.local.slice().sort((a, b) => a - b);
      const guestSlot = new Map();       // guestId -> slot
      const applied = new Map();         // slot -> last values sent to the core
      let gm = null, loaded = false, waitingRom = false, started = false, wentGo = false, goPending = false;
      const zero = () => new Array(Input.N).fill(0);
      const raw = new Map();             // slot -> buttons as pressed (before viewer effects)
      function apply(slot, values) {
        raw.set(slot, values.slice());
        push(slot, fxInput(values));
      }
      function push(slot, values) {
        if (!gm) return;
        const prev = applied.get(slot) || zero();
        for (let i = 0; i < Input.N; i++) if (values[i] !== prev[i]) { try { gm.simulateInput(slot, i, values[i]); } catch {} }
        applied.set(slot, values.slice());
      }
      const pads = local.map(slot => new Input.Pad(v => apply(slot, v)));
      fxGame = {
        inputChanged() { for (const [slot, v] of raw) push(slot, fxInput(v)); },
        gm: () => (!ghost && gm) || null,
      };
      let knownGuests = null;
      const api = {
        input(id, v) { if (ghost || inputMuted(id)) return; const s = guestSlot.get(id); if (s !== undefined && s >= 0 && !local.includes(s)) apply(s, v); },
        roster(list) {
          if (ghost) { api.redraw(); return; }
          const before = new Map(guestSlot);
          guestSlot.clear();
          for (const p of list) if (!p.host) guestSlot.set(p.id, p.slot);
          for (const [id, slot] of before) if (slot >= 0 && (!guestSlot.has(id) || guestSlot.get(id) !== slot)) apply(slot, zero());
          for (const p of list) if (p.muted && p.slot >= 0 && !p.host) apply(p.slot, zero());     // Streamer Mode: inputs muted -> nothing held
          if (knownGuests) for (const [id] of guestSlot) if (!knownGuests.has(id)) toast(`${list.find(p => p.id === id)?.name || "A player"} joined.`);
          knownGuests = new Set(guestSlot.keys());
          api.redraw();
        },
        redraw() { if (inGame) renderPlayers(players, { local: ghost ? [] : local, hostName: me.name, netState: isHost ? id => net.state(id) : null, voice, colors: ghostColors(), me: myId(), ghost: ghostHud() }); },
        message, started() {},
        romReady() { if (waitingRom) { waitingRom = false; $("load-rom").hidden = true; api.load(); } },
        go() {
          if (!ghost || wentGo) return;
          if (!started) { goPending = true; return; }
          wentGo = true;
          try { window.EJS_emulator.play(); } catch {}
        },
        load() {
          if (loaded) return;
          if (ghost && !myRom && !(isHost && picked)) {      // late joiner: needs their own ROM first
            waitingRom = true;
            $("load-rom").hidden = false; renderRomBoxes();
            $("load-help").textContent = "Drop your own copy of the game to join the run.";
            return;
          }
          loaded = true;
          $("ejs-wrap").hidden = false;
          if (ghost) { const c = ensureComp(); c.setTarget(() => window.EJS_emulator?.canvas || null); }
          // Local controllers; lag equalization only matters with two or more players on this computer.
          // Ghost mode: one player per computer, so any keyboard layout or gamepad drives P1.
          const lagFor = Settings.get("equalizeLag") && local.length > 1
            ? Input.lagPlan(["keyboard", ...Array.from(navigator.getGamepads?.() || []).filter(Boolean).map(g => g.id)]) : null;
          Input.attachKeyboard(roomSystem, { A: pads[0], B: pads[1] }, { lagFor });
          Input.attachGamepads(roomSystem, ghost ? () => pads[0] : order => pads[order] || null, { lagFor });
          const help = Input.KEY_HELP[Input.scheme(roomSystem)];
          const helpText = `<div class="small muted" style="margin-top:8px">P1 keys: ${esc(help.A)}${pads[1] ? `<br>P2 keys: ${esc(help.B)}` : ""}</div>`;
          // Capture the game's audio for the guests (must happen before the emulator makes its AudioContext).
          if (!ghost) Net.tapPageAudio(track => net.addTrack(track));
          const tag = me.id.slice(0, 8) + "__";           // separate saves per account on a shared computer
          const arcade = roomSystem === "arcade";          // arcade romsets must keep their exact file name
          const p = ghost && !isHost ? (myRom?.file ? { kind: "file", file: myRom.file } : null) : picked;
          if (!p) { message("Load your ROM in the lobby first (it's needed again after a page reload).", true); return; }
          if (p.kind === "lib") {
            const parts = p.item.path.split("/");
            if (!arcade) parts[parts.length - 1] = tag + parts[parts.length - 1];
            window.EJS_gameUrl = "/roms/" + parts.map(encodeURIComponent).join("/");
          } else {
            window.EJS_gameUrl = URL.createObjectURL(p.file);
            window.EJS_gameName = (arcade ? "" : tag) + p.file.name;
          }
          const noKeys = {};
          for (let pl = 0; pl < 4; pl++) { noKeys[pl] = {}; for (let i = 0; i < 30; i++) noKeys[pl][i] = { value: "", value2: "" }; }
          Object.assign(window, {
            EJS_player: "#ejs-player", EJS_core: config.cores?.[roomSystem] || roomSystem, EJS_pathtodata: "/data/", EJS_startOnLoaded: true,
            EJS_threads: !!window.crossOriginIsolated && typeof SharedArrayBuffer === "function",
            EJS_color: "#ffd60a", EJS_backgroundColor: "#000000", EJS_language: "en-US", EJS_disableAutoLang: false,
            EJS_volume: Settings.get("volume"),
            EJS_defaultControls: noKeys,     // Retro Hub handles keyboards and gamepads itself (local seats + guests)
            EJS_Buttons: { netplay: false },
            EJS_onGameStart: () => {
              gm = window.EJS_emulator.gameManager;
              applyCheats(gm, true);
              if (ghost) {
                // Hold at the first frame until GO so every run starts together (late joiners start at once).
                if (phase !== "playing" && !goPending) { try { window.EJS_emulator.pause(); } catch {} }
                else wentGo = true;
                started = true;
                if (goPending) { goPending = false; api.go(); }
                myGhost = window.EJS_emulator.canvas.captureStream(Net.GHOST_FPS).getVideoTracks()[0] || null;
                if (myGhost) {
                  try { myGhost.contentHint = "motion"; } catch {}
                  isHost ? net.setHostGhost(myGhost, myId()) : net.setGhost(myGhost);
                  sock.send({ t: "ghost", on: true });
                }
              } else {
                const stream = window.EJS_emulator.canvas.captureStream(60);
                stream.getVideoTracks().forEach(t => net.addTrack(t));
              }
              pads.forEach((pad, i) => apply(local[i], pad.values));
              reportProgress(100);
              obs?.disconnect();
              api.helpText = helpText;
            },
          });
          // EmulatorJS has no progress API: read the percentage from its loading text.
          reportProgress(2);
          let obs = null;
          const watch = () => {
            const el = document.querySelector("#ejs-player .ejs_loading_text");
            if (!el) return setTimeout(watch, 100);
            const read = () => {
              const t = el.textContent || "", n = Number((/(\d{1,3})%/.exec(t) || [])[1]);
              if (/error|failed/i.test(t) || el.classList.contains("ejs_error_text")) {
                $("load-help").textContent = `The emulator couldn't load the game: ${t}. Leave and try again.`;
                $("load-help").classList.add("error-text");
                return;
              }
              if (/core/i.test(t)) reportProgress(5 + (Number.isFinite(n) ? n * 0.4 : 0));
              else if (/game data|download/i.test(t)) reportProgress(45 + (Number.isFinite(n) ? n * 0.4 : 0));
              else if (/decompress|extract/i.test(t)) reportProgress(85 + (Number.isFinite(n) ? n * 0.1 : 0));
              else if (/loading/i.test(t)) reportProgress(4);
            };
            obs = new MutationObserver(read); obs.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] }); read();
          };
          watch();
          const s = document.createElement("script");
          s.src = "/data/loader.js";
          s.onerror = () => message("Couldn't load the emulator files.", true);
          document.body.appendChild(s);
        },
      };
      api.started = () => {
        if (ghost) {
          api.go();
          message(`GO! Your run is your own: other players are ghosts only.${api.helpText || ""}`, false);
          return;
        }
        message(`Lobby <b class="code">${esc(code)}</b> is live. Use <b>Copy invite link</b> to invite more friends.${api.helpText || ""}`, false);
        setTimeout(() => message("", false), 8000);
      };
      return api;
    }

    // ============================================================ native emulator (co-op host)
    // The server launches PCSX2 / Dolphin / RPCS3 / Xenia / Cemu on this computer; the host shares its window
    // (one click, the browser asks which window) and that capture becomes the normal stream to guests.
    // Guests' inputs go to virtual gamepads through the server's input bridge. Players on this computer use
    // their own controllers directly in the emulator.
    function makeNativeGame() {
      const local = opts.params.local.slice();
      const online = [];
      for (let s = 0; s < config.maxPlayers; s++) if (!local.includes(s)) online.push(s);
      const guestSlot = new Map();
      const zero = () => new Array(Input.N).fill(0);
      let bridge = null, shared = null, launched = false, padNote = "", keyMode = false, watchTimer = 0;
      // Headless: the emulator's window stays off-screen and the host plays it in this page (the captured window
      // is shown here). Needs virtual gamepads: keyboard-mode keys only reach a focused emulator window.
      let headless = false, detachKb = null, winShown = false;
      const nraw = new Map();            // slot -> buttons as pressed (viewer effects are applied on the way out)
      // 🤝 Co-op ROM hack: each online seat goes to the controller port the hack reads (OoT Multiplayer 2P: P2 is
      // controller 4); null = that seat has no player in this hack. The host's own seats are never moved.
      const coopPorts = picked?.coop?.ports || null;
      const portOf = s => !coopPorts || local.includes(s) || !(String(s) in coopPorts) ? s : coopPorts[String(s)];
      const toPad = (s, v) => { const t = portOf(s); if (t != null) bridge?.send(t, v); };
      const padOnline = [...new Set([...online, ...online.map(portOf).filter(t => t != null)])].sort((a, b) => a - b);
      fxGame = { inputChanged() { for (const [slot, v] of nraw) local.includes(slot) ? bridge?.send(slot, fxInput(v)) : toPad(slot, fxInput(v)); }, gm: () => null };
      const hlBox = $("nv-headless");
      hlBox.checked = Settings.get("nativeHeadless") !== false;
      hlBox.onchange = () => { Settings.set("nativeHeadless", hlBox.checked); toast(launched ? `Applies the next time ${emuName()} starts (Restart).` : "Saved.", { ms: 3000 }); };
      $("g-emuwin").onclick = guard($("g-emuwin"), async () => {
        try { await Native.showWindow(!winShown); winShown = !winShown; } catch (e) { toast(e.message, { kind: "bad" }); }
        $("g-emuwin").setAttribute("aria-pressed", String(winShown));
        $("g-emuwin").textContent = winShown ? "🪟 Hide emulator window" : "🪟 Emulator window";
      });
      const box = $("native-actions"), preview = $("guest-video");
      // The program's name comes from the hub (apps.py status): the console's emulator, or the PC game itself.
      let appName = roomSystem === "pc" ? (picked?.name || "game") : "emulator";
      const emuName = () => appName;
      // Three visible steps: start the program -> share its window -> live for guests.
      // Each is todo / active / done / error; the help line under them says what to do right now.
      const STEPS = ["launch", "share", "live"], STATE_TEXT = { todo: "not started", active: "in progress", done: "done", error: "failed" };
      function step(name, state, detail = "") {
        box.hidden = false;
        const at = STEPS.indexOf(name);
        box.querySelectorAll("[data-step]").forEach(li => {
          const j = STEPS.indexOf(li.dataset.step);
          li.dataset.state = j < at ? "done" : j === at ? state : "todo";
          li.querySelector(".nv-state").textContent = `: ${STATE_TEXT[li.dataset.state]}`;
          if (j === at) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
        });
        box.querySelector('[data-step="launch"] .nv-label').textContent = `Start ${emuName()}`;
        $("nv-share").hidden = !(name === "share" && state === "active");
        const again = $("nv-relaunch");
        again.hidden = name === "launch" && state === "active";
        again.textContent = state === "error" ? "Retry" : `Restart ${emuName()}`;
        again.classList.toggle("primary", state === "error");
        $("load-help").classList.toggle("error-text", state === "error");
        $("load-help").textContent = detail;
      }
      const fail = text => step("launch", "error", text);
      box.insertBefore($("load-help"), box.querySelector(".row"));     // read order: steps, what to do now, buttons
      async function start() {
        $("loadboard").hidden = false;
        if (picked?.kind !== "lib") return fail("Native games must come from the server library. Leave and pick it from the library.");
        step("launch", "active", `Starting ${emuName()}…`);
        reportProgress(10);
        let st;
        try { st = await Native.status(); } catch { st = null; }
        if (!st?.available) return fail(st?.reason || "Couldn't reach the hub.");
        if (st.runner && !st.runner.ok) return fail(st.runner.error);
        const sys = st.systems?.[roomSystem];
        if (roomSystem !== "pc" && sys?.emulatorLabel) appName = sys.emulatorLabel;
        if (!sys?.installed) return fail(`${emuName()} isn't installed. Put a portable build in the emulators/${sys?.emulator || ""} folder (${st.folder}) or add one with "python apps.py", then press Retry.`);
        keyMode = st.bridge?.ok && st.bridge.mode === "keyboard";
        headless = hlBox.checked && /Windows/.test(navigator.userAgent) && !!st.bridge?.ok && !keyMode;
        if (hlBox.checked && !headless) toast(keyMode || !st.bridge?.ok
          ? `Headless needs virtual gamepads (ViGEmBus + vgamepad, see requirements-native.txt): without them, keys only reach a focused ${emuName()} window, so it opens normally.`
          : "Headless works on Windows only; the emulator opens normally.", { kind: "bad", ms: 9000 });
        // Headless: the host's local seats get virtual controllers too, fed from this page's keyboard.
        const padSlots = headless ? [...new Set([...local, ...padOnline])].sort((a, b) => a - b) : padOnline;
        padNote = !st.bridge?.ok ? ` Guest controllers are off: ${st.bridge?.error || "the input bridge isn't available."}`
          : keyMode ? " Guests' buttons arrive as keyboard keys (emulators/KEYBOARD.md): click the game window after sharing so they reach it."
          : "";
        // Plug the guests' virtual controllers in BEFORE the emulator boots: xemu, melonDS, Dolphin and others only
        // see controllers that exist when they start, so pads added later (after "Share the window") never worked.
        if (st.bridge?.ok && padSlots.length && !bridge) {
          step("launch", "active", `Connecting ${padSlots.length} virtual controller${padSlots.length === 1 ? "" : "s"} (P${padSlots.map(s => s + 1).join("/P")})…`);
          await new Promise(resolve => {
            const t = setTimeout(resolve, 9000);
            bridge = new Native.Bridge(padSlots, { onState: (s, info) => {
              if (s === "ready" || s === "unavailable") { clearTimeout(t); resolve(); }
              if (s === "unavailable") toast(`Guest controllers are off: ${info}`, { kind: "bad", ms: 8000 });
            } });
          });
        }
        // Wii U: say whether Cemu will be online through Pretendo Network (the game's own online modes).
        if (roomSystem === "wiiu") await pretendoCheck();
        else window.RH.Online?.launchNote(roomSystem);   // other consoles: RPCN, Insignia... (core/online)
        step("launch", "active", `Starting ${emuName()}…`);
        if (picked.coop) step("launch", "active", `Patching ${picked.coop.name} and switching on its Project64 cheats…`);
        try {
          const r = await Native.launch(picked.item.path, roomSystem, { headless, coop: picked.coop, gba: picked.gba });
          launched = true; winShown = false; watchExit();
          if (r.coop) toast(`${r.coop.name} started${r.coop.cheats ? ` with ${r.coop.cheats} Project64 cheats on` : ""}.`, { kind: "ok", ms: 5000 });
        }
        catch (e) { return fail(e.message); }
        reportProgress(40);
        step("share", "active", headless
          ? `${emuName()} is running off-screen. Press "Share the window" and pick the ${emuName()} window: you'll play it right here.${padNote}`
          : `When the game is on screen, press "Share the window" and pick the ${emuName()} window.${padNote}`);
      }
      async function pretendoCheck() {
        let p; try { p = await fetch("/api/pretendo?fresh", { cache: "no-store" }).then(r => r.json()); } catch { return; }
        if (!p?.available) return;
        if (p.ready) { toast(`Cemu is online through Pretendo Network as ${p.account?.networkId || "your PNID"}.`, { ms: 5000 }); return; }
        const onlyService = p.problems.length === 1 && /network service/.test(p.problems[0]);
        toast(`Pretendo (online play) isn't ready: ${p.problems[0]}${p.problems.length > 1 ? ` (+${p.problems.length - 1} more)` : ""} Local co-op through the hub still works.`, {
          kind: "bad", ms: 9000,
          action: onlyService ? { label: "Use Pretendo", run: async () => {
            try {
              await fetch("/api/pretendo/enable", { method: "POST", headers: { "Content-Type": "application/json", "X-Retro-Hub": "pretendo" }, body: "{}" })
                .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Request failed (${r.status})`); });
              toast("Cemu now uses Pretendo Network (settings.xml backed up). Restart Cemu for it to apply.", { ms: 6000 });
            } catch (e) { toast(e.message, { kind: "bad", ms: 6000 }); }
          } } : window.RH.Online ? { label: "Set up", run: () => window.RH.Online.open("cemu") } : null,
        });
      }
      // While the program runs, ask the hub every few seconds whether it is still open. When it closed by itself
      // (window closed, game quit, crash right after starting), say so instead of waiting on "Share the window".
      function watchExit() {
        clearInterval(watchTimer);
        watchTimer = setInterval(async () => {
          if (!launched) return clearInterval(watchTimer);
          let st; try { st = await Native.status(); } catch { return; }
          if (!launched || st?.running || !st?.lastExit) return;
          clearInterval(watchTimer);
          launched = false;
          const x = st.lastExit, code = x.code == null ? "" : ` (exit code ${x.code})`;
          $("loadboard").hidden = false;
          fail(x.quick
            ? `${emuName()} closed right after it started${code}. Usually it can't open this game file, or it needs setup first (BIOS, keys, or its first-run settings). Open ${emuName()} by itself once to check, then press Retry.`
            : `${emuName()} was closed${code}. Press Retry to start it again.`);
        }, 3000);
      }
      async function share() {
        let stream;
        try { stream = await Native.capture({ headless }); }
        catch (e) { if (e.name !== "NotAllowedError") toast(e.message || "Couldn't capture the window.", { kind: "bad", ms: 4000 }); return; }
        const prev = shared;
        shared = stream;
        for (const t of stream.getTracks()) net.replaceTrack(prev?.getTracks().find(o => o.kind === t.kind) || null, t);
        prev?.getTracks().forEach(t => t.stop());
        const v = stream.getVideoTracks()[0];
        v.addEventListener("ended", () => {
          if (shared !== stream) return;
          toast("Window sharing stopped: guests see a frozen picture.", { kind: "bad", ms: 6000 });
          $("loadboard").hidden = false;
          step("share", "active", `Sharing stopped. Press "Share the window" and pick the ${emuName()} window again.`);
        });
        preview.srcObject = new MediaStream([v]); preview.muted = true; preview.hidden = false; preview.play().catch(() => {});
        $("g-emuwin").hidden = !headless;
        // Headless: this page's keyboard drives the host's seats through their virtual controllers (gamepads
        // plugged into this PC are read by the emulator itself, as usual).
        if (headless && !detachKb && bridge) {
          const pads = local.map(slot => new Input.Pad(vals => { nraw.set(slot, vals.slice()); bridge?.send(slot, fxInput(vals)); }));
          detachKb = Input.attachKeyboard(roomSystem, { A: pads[0], B: pads[1] });
          const help = Input.KEY_HELP[Input.scheme(roomSystem)];
          toast(`Playing here. Keyboard → virtual controller P${local[0] + 1} (${help.A}); map it in ${emuName()}'s controller settings once. Your own gamepad works in ${emuName()} directly.`, { ms: 10000 });
        }
        if (!stream.getAudioTracks().length) toast("Sharing video only. For game sound, share your whole screen and tick \"Share system audio\".", { ms: 6000 });
        if (!bridge && online.length) {
          bridge = new Native.Bridge(padOnline, { onState: (s, info) => {
            if (s === "unavailable") toast(`Guest controllers are off: ${info}`, { kind: "bad", ms: 8000 });
          } });
        }
        if (keyMode) toast("Now click the game window: guests' keys only reach it while it's focused.", { ms: 7000 });
        renderGbaBtns();
        if (phase === "playing" && !(gbaN && gbaTracks.size < gbaN)) { step("live", "done"); $("loadboard").hidden = true; }      // re-shared mid-match
        else step("live", "active", "Waiting for everyone to finish loading…");
        reportProgress(100);
      }
      $("nv-share").onclick = () => share();
      // 🗡️ GBA screens mode: one shared window per GBA (Dolphin opens one per port). Each goes ONLY to the player in
      // that seat (a per-guest side video), so solo rooms and items stay private; the host sees their own GBA here.
      const gbaN = picked.gba ? picked.gba.players : 0, gbaTracks = new Map();
      function routeGba() {
        if (!gbaN) return;
        for (const [id, slot] of guestSlot) net.setSide(id, slot >= 0 ? gbaTracks.get(slot) || null : null);
        window.RH.GbaView?.show(gbaTracks.get(local[0]) || null, local[0]);
      }
      function renderGbaBtns() {
        const box = $("nv-gba"); box.hidden = !gbaN || !shared;
        if (box.hidden) return;
        const who = s => local.includes(s) ? "you" : [...guestSlot].find(([, v]) => v === s) ? (players.find(p => p.slot === s)?.name || "guest") : "empty seat";
        box.innerHTML = `<div class="small"><b>GBA screens.</b> Share each GBA window (Dolphin titles them GBA1 … GBA${gbaN}); each one goes only to that player.</div>
          <div class="row wrap">${Array.from({ length: gbaN }, (_, s) => `<button type="button" class="small${gbaTracks.has(s) ? "" : " primary"}" data-gba-share="${s}">
            ${gbaTracks.has(s) ? "✓" : "🎮"} GBA ${s + 1} <span class="muted">(${esc(who(s))})</span></button>`).join("")}</div>`;
      }
      async function shareGba(slot) {
        let st;
        try { st = await Native.capture({ headless }); }
        catch (e) { if (e.name !== "NotAllowedError") toast(e.message || "Couldn't capture the window.", { kind: "bad", ms: 4000 }); return; }
        st.getAudioTracks().forEach(t => t.stop());
        const v = st.getVideoTracks()[0]; if (!v) return;
        try { v.contentHint = "detail"; } catch {}
        gbaTracks.get(slot)?.stop();
        gbaTracks.set(slot, v);
        v.addEventListener("ended", () => {
          if (gbaTracks.get(slot) !== v) return;
          gbaTracks.delete(slot); routeGba(); renderGbaBtns();
          toast(`GBA ${slot + 1} sharing stopped: that player's GBA screen is blank until you share it again.`, { kind: "bad", ms: 6000 });
        });
        routeGba(); renderGbaBtns();
      }
      $("nv-gba").onclick = e => { const b = e.target.closest("[data-gba-share]"); if (b) shareGba(Number(b.dataset.gbaShare)); };
      $("nv-relaunch").onclick = guard($("nv-relaunch"), async () => { await Native.stop(); launched = false; await start(); });
      const api = {
        input(id, v) { if (inputMuted(id)) return; const s = guestSlot.get(id); if (s !== undefined && s >= 0 && !local.includes(s)) { nraw.set(s, v.slice()); toPad(s, fxInput(v)); } },
        roster(list) {
          const before = new Map(guestSlot);
          guestSlot.clear();
          for (const p of list) if (!p.host) guestSlot.set(p.id, p.slot);
          for (const [id, slot] of before) if (slot >= 0 && (!guestSlot.has(id) || guestSlot.get(id) !== slot)) toPad(slot, zero());
          for (const p of list) if (p.muted && p.slot >= 0 && !p.host && !local.includes(p.slot)) toPad(p.slot, zero());
          routeGba(); renderGbaBtns();
          api.redraw();
        },
        redraw() { if (inGame) renderPlayers(players, { local, hostName: me.name, netState: id => net.state(id), voice, colors: null, me: myId(), ghost: null }); },
        message,
        load() { if (!launched) start(); },
        started() {
          step("live", "done");
          message(`Lobby <b class="code">${esc(code)}</b> is live. ${headless ? "Play right here" : `Play in the ${esc(emuName())} window`}; guests get P${online.map(s => s + 1).join("/P")} as ${keyMode ? "keyboard keys" : "virtual controllers"}.${padNote ? `<br>${esc(padNote)}` : ""}`, false);
          setTimeout(() => message("", false), 9000);
        },
        close() {
          clearInterval(watchTimer);
          detachKb?.(); detachKb = null;
          bridge?.close(); bridge = null;
          shared?.getTracks().forEach(t => t.stop()); shared = null;
          for (const t of gbaTracks.values()) t.stop();
          gbaTracks.clear(); if (gbaN) { net.clearSides(); window.RH.GbaView?.show(null); }
          if (launched) Native.stop();
        },
      };
      return api;
    }

    // ============================================================ 🔀 Shuffle lobby: everyone sees which game is on
    let shuffleSeen = null;
    function showShuffle(st) {
      const list = rules.shuffle?.games;
      if (!list || !st) return;
      const g = list[st.cur];
      if (inGame && g) { $("g-title").textContent = `🔀 ${g.name}`; $("g-title").title = `${g.name} · ${config.systems[g.system] || g.system}`; }
      if (shuffleSeen != null && st.cur !== shuffleSeen && g && inGame) {
        const b = $("g-sh-banner"); b.textContent = `🔀 ${g.name}`; b.hidden = false;
        clearTimeout(showShuffle.t); showShuffle.t = setTimeout(() => { b.hidden = true; }, 1800);
      }
      shuffleSeen = st.cur;
    }

    // ============================================================ 🔀 Shuffle lobby, host: runs every game, streams the one on
    function makeShuffleGame() {
      const local = opts.params.local.slice().sort((a, b) => a - b);
      const guestSlot = new Map(), rawIn = new Map();
      const box = $("sh-lobby-stage");
      let engine = null, video = null, started = false, won = false, detach = [], inputSystem = "";
      const fmtT = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
      const send = (slot, v) => { rawIn.set(slot, v.slice()); engine?.input(slot, fxInput(v)); };
      const pads = local.map(slot => new Input.Pad(v => send(slot, v)));
      fxGame = { inputChanged() { for (const [slot, v] of rawIn) engine?.input(slot, fxInput(v)); }, gm: () => engine?.gm() || null };
      function attachInput(system) {
        if (system === inputSystem) return;
        inputSystem = system;
        detach.forEach(fn => { try { fn(); } catch {} }); detach = [];
        detach.push(Input.attachKeyboard(system, { A: pads[0], B: pads[1] }));
        detach.push(Input.attachGamepads(system, order => pads[order] || null));
      }
      function useVideo() {
        const c = engine?.canvas(); if (!c) return;
        const t = c.captureStream(60).getVideoTracks()[0]; if (!t) return;
        try { t.contentHint = "motion"; } catch {}
        if (video) { net.replaceTrack(video, t); video.stop(); } else net.addTrack(t);
        video = t;
      }
      const pushState = done => {
        if (!engine) return;
        done = done || won;                       // the win stays a win (the engine reports one more change after it)
        const st = engine.state(), s = engine.stats();
        sock.send({ t: "shuffle-state", cur: st.cur, beaten: engine.games.map(g => g.beaten), done: !!done, time: done ? fmtT(s.total) : undefined, swaps: done ? s.swaps : undefined });
      };
      const hud = () => {
        const st = engine?.state(); if (!st) return;
        $("g-sh-hold").setAttribute("aria-pressed", String(st.hold)); $("g-sh-hold").classList.toggle("on", st.hold);
      };
      const keys = e => {
        if (!inGame || e.repeat || isTyping(e.target) || !engine) return;
        if (e.key === "F8") { e.preventDefault(); beaten(); }
        else if (e.key === "F9") { e.preventDefault(); engine.swapNow(); }
        else if (e.key === "F10") { e.preventDefault(); engine.setHold(!engine.hold); }
      };
      function beaten() { const g = engine?.markBeaten(); if (g) toast(`✓ ${g.name} beaten!`, { kind: "ok", ms: 3000 }); }
      const api = {
        input(id, v) { if (inputMuted(id)) return; const s = guestSlot.get(id); if (s !== undefined && s >= 0 && !local.includes(s)) send(s, v); },
        roster(list) {
          const before = new Map(guestSlot);
          guestSlot.clear();
          for (const p of list) if (!p.host) guestSlot.set(p.id, p.slot);
          for (const [id, slot] of before) if (slot >= 0 && (!guestSlot.has(id) || guestSlot.get(id) !== slot)) { rawIn.delete(slot); engine?.release(slot); }
          for (const p of list) if (p.muted && p.slot >= 0 && !p.host) { rawIn.delete(p.slot); engine?.release(p.slot); }
          api.redraw();
        },
        redraw() { if (inGame) renderPlayers(players, { local, hostName: me.name, netState: id => net.state(id), voice, colors: null, me: myId(), ghost: null }); },
        message, systemChanged() {},
        async load() {
          if (engine) return;
          box.hidden = false;
          for (const id of ["g-sh-beaten", "g-sh-swap", "g-sh-hold"]) $(id).hidden = false;
          $("g-sh-beaten").onclick = beaten;
          $("g-sh-swap").onclick = () => engine?.swapNow();
          $("g-sh-hold").onclick = () => engine?.setHold(!engine.hold);
          window.addEventListener("keydown", keys, true);
          const total = picked.list.length;
          let done = 0;
          reportProgress(3);
          engine = window.RH.ShuffleEngine({
            stage: box, cores: config.cores, min: picked.min, max: picked.max, memorySaver: picked.saver, tapAudio: true,
            volume: () => Settings.get("volume") ?? 0.5,
            games: picked.list.map(g => ({ name: g.name, system: g.system,
              url: g.kind === "lib" ? "/roms/" + g.item.path.split("/").map(encodeURIComponent).join("/") : URL.createObjectURL(g.file),
              saveName: "shuffle__" + (g.kind === "lib" ? g.item.path.split("/").pop() : g.file.name) })),
            onLoad: (i, text) => { if (/Ready|Failed|memory saver/.test(text)) { done++; reportProgress(5 + Math.round(90 * done / total)); }
              $("load-help").textContent = `Shuffle: ${picked.list[i].name}: ${text}`; },
            onSwap: (g, i, prev) => { attachInput(g.system); useVideo(); pushState(false); if (prev >= 0 && Settings.get("sfx")) Sfx.go(); },
            onChange: () => { hud(); if (engine && started) pushState(false); },
            onWin: s => { won = true; pushState(true); message(`🏆 All games beaten in ${fmtT(s.total)} with ${s.swaps} swaps!`, false); Sfx.chime(); },
            onBusy: text => { const b = $("g-sh-banner"); if (text) { b.textContent = text; b.hidden = false; } else b.hidden = true; },
          });
          await engine.boot();
          if (!engine.games.some(g => !g.beaten)) { message("None of the shuffle games could start. Leave and pick others.", true); return; }
          engine.setHold(true);                         // the first game waits for GO
          await engine.start();
          const a = engine.audioTrack(); if (a) net.addTrack(a);
          reportProgress(100);
        },
        started() {
          started = true;
          engine?.setHold(false);
          const help = Input.KEY_HELP[Input.scheme(engine?.active()?.system || roomSystem)];
          message(`🔀 Shuffle is live. ✓ Beaten (F8) · ⤳ Swap (F9) · ⏸ Hold (F10).<div class="small muted" style="margin-top:8px">P1 keys: ${esc(help.A)}</div>`, false);
          setTimeout(() => message("", false), 9000);
          pushState(false);
        },
        close() {
          window.removeEventListener("keydown", keys, true);
          detach.forEach(fn => { try { fn(); } catch {} });
          engine?.destroy(); engine = null; video?.stop();
        },
      };
      return api;
    }

    // ============================================================ ghost spectator
    // Shows one player's run solid (lowest seat by default; "Follow" in the Ghosts panel) with the others as ghosts.
    function makeGhostWatch() {
      let base = null, followId = null, chosen = false;
      const api = {
        message, systemChanged() {},
        redraw() { if (inGame) renderPlayers(players, { voice, colors: ghostColors(), me: myId(), ghost: ghostHud() }); },
        following: () => followId,
        follow(id) { chosen = true; followId = id; api.ghostsChanged(); syncGhosts(); },
        ghostsChanged() {
          if (!base) return;
          if (!chosen || !ghostTracks.has(followId)) {
            const live = players.filter(p => !p.spectator && ghostTracks.has(p.id)).sort((a, b) => a.slot - b.slot)[0];
            const next = live ? live.id : null;
            if (next !== followId) { followId = next; queueMicrotask(syncGhosts); }
          }
          const t = followId != null ? ghostTracks.get(followId) : null;
          const cur = base.srcObject?.getVideoTracks?.()[0] || null;
          if (t !== cur) { base.srcObject = t ? new MediaStream([t]) : null; if (t) base.play().catch(() => {}); comp?.setBase(base); }
        },
        load() {
          if (base) return;
          base = document.createElement("video");
          base.id = "ghost-base"; base.muted = true; base.playsInline = true; base.autoplay = true;
          $("stage").prepend(base);
          const c = ensureComp(); c.setTarget(() => base); c.setBase(base);
          api.ghostsChanged(); syncGhosts();
          reportProgress(100);
        },
        started() { message("You are watching. Open <b>Ghosts</b> to pick who to follow.", false); },
      };
      return api;
    }

    // ============================================================ guest game
    function makeGuestGame() {
      const video = $("guest-video");
      let touch = null, gotVideo = false, system = roomSystem, loaded = false;
      const pad = new Input.Pad(v => net.sendInput(v));
      const progressFor = () => {
        if (gotVideo && video.readyState >= 2) return 100;
        if (gotVideo) return 80;
        if (net?.channelOpen) return 60;
        if (netStateNow === "connected") return 45;
        if (netStateNow === "connecting") return 20;
        return 10;
      };
      const bump = () => { if (phase === "loading" || phase === "playing") reportProgress(progressFor()); };
      video.addEventListener("loadeddata", bump);
      video.addEventListener("playing", bump);
      const api = {
        message,
        redraw() { if (inGame) renderPlayers(players, { voice }); },
        stream(s) {
          if (video.srcObject !== s) video.srcObject = s;
          video.volume = Settings.get("volume");
          video.muted = false;
          video.play().then(() => { $("g-sound").hidden = true; }).catch(() => {
            video.muted = true; video.play().catch(() => {});
            $("g-sound").hidden = false;
          });
          gotVideo = true; bump();
        },
        netState(st) {
          bump();
          if (!inGame) return;
          if (st === "failed") message("Couldn't connect to the host directly. The hub owner may need to set up a TURN server.", true);
          else if (st === "disconnected") message("Connection to the host is unstable…", true);
        },
        systemChanged(sys) { system = sys; if (loaded) buildTouch(); },
        load() {
          if (loaded) return; loaded = true;
          video.hidden = false;
          Input.attachKeyboard(system, { A: pad });
          Input.attachGamepads(system, () => pad);
          buildTouch();
          $("g-touch").hidden = false;
          bump();
        },
        started() {
          const m = mine();
          message(m?.spectator ? "You are watching." : `You are <b>P${(m?.slot ?? 0) + 1}</b>. ${esc(Input.KEY_HELP[Input.scheme(system)].A)}`, false);
        },
      };
      setInterval(bump, 500);
      // Touch controller: automatic on touch screens, toggle with the HUD button; the choice is remembered.
      const coarse = matchMedia("(pointer: coarse)").matches;
      const pref = () => { try { const v = localStorage.getItem("rh-touchpad"); return v == null ? coarse : v === "1"; } catch { return coarse; } };
      const buildTouch = () => { touch?.destroy(); touch = Input.createTouch($("stage"), system, pad); touch.show(pref()); };
      $("g-touch").onclick = () => {
        const on = !pref();
        try { localStorage.setItem("rh-touchpad", on ? "1" : "0"); } catch {}
        touch?.show(on);
      };
      $("g-sound").onclick = () => { video.muted = false; video.play().catch(() => {}); $("g-sound").hidden = true; };
      // Top bar: ping to the host plus what the stream is actually delivering.
      let live = null;
      setInterval(async () => { live = await net.stats().catch(() => null); }, 2000);
      setInterval(() => {
        const parts = net.rtt != null ? [`Host ${net.rtt} ms`] : [];
        if (live?.kbps != null) parts.push(live.kbps >= 1000 ? (live.kbps / 1000).toFixed(1) + " Mbps" : live.kbps + " kbps");
        if (live?.fps != null) parts.push(live.fps + " fps");
        $("g-net").textContent = parts.join(" · ");
        $("g-net").title = "Ping to the host · video bitrate · frame rate (📶 Stream for details)";
        $("g-net").className = "small trunc ping " + pingClass(net.rtt);
      }, 1000);
      return api;
    }
  }

  // ================================================================ in-game HUD helpers
  let flashTimer = 0;
  function message(text, sticky) {
    clearTimeout(flashTimer);
    $("g-msg").innerHTML = text; $("g-msg").hidden = !text;
    if (text && !sticky) flashTimer = setTimeout(() => { $("g-msg").hidden = true; }, 3500);
  }
  const hudDrag = { on: false };   // don't rebuild the chips while one is being dragged
  function renderPlayers(players, extra = {}) {
    if (hudDrag.on) return;
    const box = $("g-players");
    const focusGid = document.activeElement?.closest?.("#g-players .pchip")?.dataset.gid;
    box.textContent = "";
    const bySlot = new Map(players.filter(p => !p.spectator).map(p => [p.slot, p]));
    for (let s = 0; s < config.maxPlayers; s++) {
      const p = bySlot.get(s), loc = extra.local?.includes(s) && !p;
      const chip = document.createElement("span");
      chip.className = "pchip" + (p || loc ? "" : " open");
      let net = "";
      if (p && !p.host && extra.netState) {
        const st = extra.netState(p.id);
        net = `<span class="net ${st === "connected" ? "ok" : st === "failed" || st === "disconnected" ? "bad" : ""}" title="${esc(st)}"></span>`;
      }
      const vu = p?.voice ? `<span class="vu ${extra.voice?.muted.has(p.key) ? "muted" : ""}" data-key="${esc(p.key)}"><i></i><i></i><i></i><i></i></span>` : "";
      const col = p && extra.colors && p.id !== extra.me ? extra.colors[s] : "";
      const sw = col ? `<span class="swatch" style="background:${col}" title="Ghost color"></span>` : "";
      chip.innerHTML = `<span class="slot">P${s + 1}</span>${p ? `${net}${sw}<span class="trunc pn">${esc(p.name)}</span>${vu}`
        : loc ? `<span class="trunc pn">${esc(extra.hostName)}'s PC</span>` : `<span class="muted">open</span>`}`;
      if (p) chip.title = `${p.name} #${prettyId(p.key)}`;
      if (p && extra.ghost && p.id !== extra.me) {
        const off = extra.ghost.hidden.has(s), pip = extra.ghost.pipped.has(p.id);
        chip.classList.add("ghostable");
        chip.classList.toggle("ghost-off", off && !pip);
        chip.classList.toggle("pipped", pip);
        chip.dataset.gid = p.id;
        chip.tabIndex = 0; chip.setAttribute("role", "button");
        chip.setAttribute("aria-pressed", String(!off && !pip));
        if (pip) chip.insertAdjacentHTML("beforeend", '<span class="pipmark" aria-hidden="true">⧉</span>');
        chip.title = `${p.name}: ${pip ? "in a window (click to put back)" : off ? "ghost hidden (click to show)" : "click to hide ghost"} · drag onto the game to pop out · P = pop out`;
      }
      box.appendChild(chip);
      if (focusGid && chip.dataset.gid === focusGid) chip.focus();
    }
    const specs = players.filter(p => p.spectator).length;
    if (specs) { const c = document.createElement("span"); c.className = "pchip open"; c.textContent = `👁 ${specs}`; c.title = `${specs} watching`; box.appendChild(c); }
  }

  boot().catch(e => { console.error(e); document.body.insertAdjacentHTML("beforeend", `<div class="msg error" style="margin:20px">${esc(e.message || e)}</div>`); });
})();
