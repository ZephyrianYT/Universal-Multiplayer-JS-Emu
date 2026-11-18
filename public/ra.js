// RetroAchievements in the hub: your account (username + Web API key, kept in this browser only), the game's
// achievement set, your progress, and a toast (optionally a chat line) when something unlocks.
// Unlocking itself happens inside an emulator with RetroAchievements built in (RetroArch, PCSX2, Dolphin,
// DuckStation, PPSSPP, melonDS…): the native emulators the hub starts can do that. EmulatorJS in the browser
// can't award achievements, so for browser games this panel is for browsing the set and tracking progress.
(function () {
  "use strict";
  const { Settings, Modal, toast, offsite } = window.RH.UI;
  const RAH = window.RH.RAHash;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const creds = () => Settings.get("ra") || {};
  const configured = () => !!(creds().user && creds().key);
  async function api(url) {
    const c = creds();
    const r = await fetch(url, { cache: "no-store", headers: { "X-RA-User": c.user || "", "X-RA-Key": c.key || "" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }
  const media = p => p ? "/api/ra/media/" + String(p).replace(/^\//, "") : "";
  // Offsite links to retroachievements.org: the player's own profile and the game's page there.
  const RA_SITE = "https://retroachievements.org";
  const profileLink = user => offsite({ href: `${RA_SITE}/user/${encodeURIComponent(user)}`, label: "Your RetroAchievements profile",
    note: "Points, rank and every game you've played." });
  const gameLink = id => offsite({ href: `${RA_SITE}/game/${encodeURIComponent(id)}`, label: "This game on RetroAchievements",
    note: "Leaderboards, guides and comments." });
  const badge = (b, locked) => b ? `/api/ra/media/Badge/${encodeURIComponent(b)}${locked ? "_lock" : ""}.png` : "";

  // ---- account dialog (🏆 in the top bar)
  function openSettings() {
    const dlg = $("ra-dlg"), c = creds();
    $("ra-user").value = c.user || ""; $("ra-key").value = c.key || ""; $("ra-share").checked = c.share !== false;
    $("ra-result").hidden = true;
    Modal.open(dlg, { focus: c.user ? "#ra-key" : "#ra-user" });
  }
  function bindSettings() {
    const save = () => Settings.set("ra", { user: $("ra-user").value.trim(), key: $("ra-key").value.trim(), share: $("ra-share").checked });
    const show = (ok, html) => { const r = $("ra-result"); r.hidden = false; r.className = "msg " + (ok ? "info" : "error"); r.innerHTML = html; };
    $("ra-test").onclick = async () => {
      save();
      if (!configured()) return show(false, "Enter both your username and your Web API key.");
      $("ra-test").disabled = true;
      try {
        const p = await api("/api/ra/profile");
        show(true, `${p.avatar ? `<img class="ra-ava" alt="" src="${esc(media(p.avatar))}">` : ""}Signed in as <b>${esc(p.user)}</b> · ${Number(p.points || 0).toLocaleString()} points${profileLink(p.user)}`);
      } catch (e) { show(false, esc(e.message)); }
      $("ra-test").disabled = false;
    };
    $("ra-save").onclick = () => { save(); Modal.close($("ra-dlg")); toast(configured() ? "RetroAchievements saved in this browser." : "RetroAchievements turned off.", { kind: "ok" }); };
    $("ra-clear").onclick = () => { Settings.set("ra", {}); $("ra-user").value = $("ra-key").value = ""; $("ra-result").hidden = true; };
    $("ra-cancel").onclick = () => Modal.close($("ra-dlg"));
  }

  // ---- the game being played. params(): Promise<{ path } | { file, system, ext, name } | { system, ext, name }>
  // Library games are hashed by the hub; a file from this computer is hashed here (it never leaves the browser).
  async function lookupFor(p) {
    const qs = new URLSearchParams();
    if (p.path) qs.set("path", p.path);
    else {
      qs.set("system", p.system || ""); qs.set("ext", p.ext || ""); qs.set("name", p.name || "");
      if (p.file && p.file.size <= RAH.MAX_BYTES) {
        const data = RAH.hashData(p.system, p.ext, new Uint8Array(await p.file.arrayBuffer()));
        if (data) qs.set("md5", RAH.md5(data));
      }
    }
    return api("/api/ra/lookup?" + qs);
  }

  function createGame({ params, chat, isBrowserGame }) {
    let game = null, info = null, timer = 0, known = null, closed = false, reason = "", loading = true;
    const btn = $("g-ra"), panel = $("ra-panel");
    btn.hidden = !configured();
    if (!configured()) return { close() {} };
    btn.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden && $("friends-panel")) $("friends-panel").hidden = true; btn.setAttribute("aria-expanded", String(!panel.hidden)); if (!panel.hidden) render(); };
    $("ra-close").onclick = () => { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    $("ra-refresh").onclick = () => poll(true);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !panel.hidden && !document.querySelector("dialog[open]")) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    });
    function render() {
      const body = $("ra-body");
      $("ra-title").textContent = info?.title || game?.title || "RetroAchievements";
      if (loading) { body.innerHTML = '<p class="small muted">Looking up this game…</p>'; return; }
      if (!game) { body.innerHTML = `<p class="small muted">${esc(reason || "No RetroAchievements set found for this game.")}</p>${profileLink(creds().user)}`; return; }
      if (!info) { body.innerHTML = '<p class="small muted">Loading achievements…</p>'; return; }
      const pct = info.total ? Math.round(100 * info.earned / info.total) : 0;
      body.innerHTML = `
        <div class="ra-game">${info.icon ? `<img alt="" src="${esc(media(info.icon))}">` : ""}<div class="grow">
          <div class="small muted">${esc(info.console || "")}${game.matchedBy === "title" ? " · matched by title" : ""}</div>
          <div><b>${info.earned}</b> / ${info.total} unlocked${info.earnedHardcore ? ` · ${info.earnedHardcore} hardcore` : ""}</div>
          <div class="bar"><i style="width:${pct}%"></i></div></div></div>
        ${isBrowserGame ? '<p class="small muted">Browser games can\'t unlock achievements (EmulatorJS has no RetroAchievements support). Play in an emulator with RetroAchievements built in to earn them; progress shows up here.</p>' : ""}
        <ul class="ra-list">${info.achievements.map(a => `
          <li class="${a.earned ? "got" : ""}" title="${esc(a.desc)}">
            <img alt="" loading="lazy" src="${esc(badge(a.badge, !a.earned))}">
            <div class="grow"><div class="ra-a-title">${esc(a.title)} <span class="muted small">${a.points} pts${a.type ? " · " + esc(a.type) : ""}</span></div>
              <div class="small muted">${esc(a.desc)}</div>
              ${a.earned ? `<div class="small ra-when">Unlocked ${esc(new Date(String(a.hardcore || a.earned).replace(" ", "T") + "Z").toLocaleString())}${a.hardcore ? " · hardcore" : ""}</div>`
                : a.rarity != null ? `<div class="small muted">${Math.round(a.rarity * 1000) / 10}% of players</div>` : ""}</div></li>`).join("")}</ul>
        <div class="ra-links">${gameLink(game.id)}${profileLink(creds().user)}</div>`;
    }
    async function poll(manual) {
      if (closed || !game) return;
      try {
        const next = await api(`/api/ra/progress?game=${game.id}`);
        const earned = new Set(next.achievements.filter(a => a.earned).map(a => a.id));
        if (known) for (const a of next.achievements) if (earned.has(a.id) && !known.has(a.id)) {
          toast(`🏆 ${a.title} (${a.points} pts)`, { kind: "ok", ms: 6000 });
          if (creds().share !== false) chat?.(`🏆 unlocked "${a.title}" (${a.points} pts) in ${next.title}`);
        }
        known = earned; info = next;
        if (!panel.hidden) render();
      } catch (e) { if (manual) toast(e.message, { kind: "bad", ms: 5000 }); }
    }
    (async () => {
      try {
        const p = await params();
        const r = await lookupFor(p);
        game = r.game; reason = r.reason || "";
      } catch (e) { reason = e.message; }
      loading = false;
      btn.classList.toggle("has-set", !!game);
      btn.title = game ? `RetroAchievements: ${game.title} (${game.achievements} achievements)` : "RetroAchievements: no set found for this game";
      if (!panel.hidden) render();
      if (game) { await poll(); timer = setInterval(() => { if (!document.hidden) poll(); }, 60e3); }
    })();
    return { close() { closed = true; clearInterval(timer); panel.hidden = true; btn.hidden = true; } };
  }

  document.addEventListener("DOMContentLoaded", bindSettings);
  if (document.readyState !== "loading") bindSettings();
  window.RH = Object.assign(window.RH || {}, { RA: { configured, openSettings, createGame } });
})();
