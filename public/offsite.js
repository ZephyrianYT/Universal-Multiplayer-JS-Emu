// Off Site Games tab: games that run on other websites (list from /api/offsite-games: the owner's
// offsite-games.json, else core/offsite-games.json). Every entry is an "Offsite" link (ui.js offsite()): new tab,
// no referrer, clearly marked as not part of Retro Hub.
(function () {
  "use strict";
  const { Settings, offsite } = window.RH.UI;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let games = null, loading = null;

  // The hub page's tabs (this file owns them): Play, Lobby Browser (app.js renders it), Off Site Games.
  const PANELS = { play: "hub-play", lobbies: "lobbies-panel", offsite: "offsite-panel" };
  const TABS = Object.keys(PANELS);
  function select(tab) {
    tab = TABS.includes(tab) ? tab : "play";
    document.querySelectorAll("[data-hubtab]").forEach(b => { b.setAttribute("aria-selected", String(b.dataset.hubtab === tab)); b.tabIndex = b.dataset.hubtab === tab ? 0 : -1; });
    for (const [t, id] of Object.entries(PANELS)) $(id).hidden = t !== tab;
    Settings.set("hubTab", tab);
    if (tab === "offsite") load();
    window.dispatchEvent(new Event("rh-hubtab"));
  }

  async function load() {
    if (games) return render();
    $("og-list").innerHTML = '<div class="empty">Loading…</div>';
    loading = loading || Promise.all([
      fetch("/api/offsite-games", { cache: "no-store" }).then(r => r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))),
      fetch("/api/me", { cache: "no-store" }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]);
    try {
      const [data, me] = await loading;
      games = data.games || [];
      $("og-owner").hidden = me.role !== "admin";
      if (data.custom && me.role === "admin") $("og-owner").textContent = "Owner: this is your own list (offsite-games.json in the hub's main folder). Edit it there; updates keep it.";
      const cats = [...new Set(games.map(g => g.category))].sort((a, b) => a.localeCompare(b));
      const sel = $("og-cat"), keep = Settings.get("ogCat") || "";
      for (const c of cats) { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); }
      sel.value = cats.includes(keep) ? keep : "";
      $("og-touch").closest("label").hidden = !games.some(g => g.touch);
      render();
    } catch (e) {
      loading = null;
      $("og-list").innerHTML = `<div class="empty">Couldn't load the list: ${esc(e.message)}</div>`;
    }
  }

  function render() {
    const term = $("og-search").value.trim().toLowerCase(), cat = $("og-cat").value, touch = $("og-touch").checked;
    const list = games.filter(g => (!cat || g.category === cat) && (!touch || g.touch)
      && (!term || g.name.toLowerCase().includes(term) || g.category.toLowerCase().includes(term)));
    $("og-count").textContent = list.length === games.length ? `${games.length} game${games.length === 1 ? "" : "s"}` : `${list.length} of ${games.length}`;
    if (!games.length) { $("og-list").innerHTML = '<div class="empty">No off site games in the list.</div>'; return; }
    if (!list.length) { $("og-list").innerHTML = '<div class="empty">No games match.</div>'; return; }
    const byCat = new Map();
    for (const g of list.slice().sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))) {
      if (!byCat.has(g.category)) byCat.set(g.category, []);
      byCat.get(g.category).push(g);
    }
    $("og-list").innerHTML = [...byCat].map(([c, gs]) => `<h3 class="sys-group og-cat">${esc(c)}</h3><div class="og-grid">${
      gs.map(g => offsite({ href: g.url, label: g.name, note: [g.touch ? "📱 Phone / tablet friendly." : "", g.note].filter(Boolean).join(" ") })).join("")}</div>`).join("");
  }

  function init() {
    document.querySelectorAll("[data-hubtab]").forEach(b => b.addEventListener("click", () => select(b.dataset.hubtab)));
    // Arrow keys move between the two tabs (tablist pattern).
    $("tab-play").parentElement.addEventListener("keydown", e => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const i = TABS.indexOf(document.activeElement?.dataset.hubtab); if (i < 0) return;
      const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
      select(next); $("tab-" + next).focus(); e.preventDefault();
    });
    let t = 0;
    $("og-search").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => games && render(), 120); });
    $("og-cat").addEventListener("change", () => { Settings.set("ogCat", $("og-cat").value); if (games) render(); });
    $("og-touch").addEventListener("change", () => games && render());
    select(Settings.get("hubTab"));
    // Clicking the Retro Hub title: back to the home screen (Play tab, top of the page). In a lobby app.js
    // replaces this with "leave the lobby?" first.
    const home = $("brand-home");
    if (home) home.onclick = e => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;     // new tab / window: let the link do it
      e.preventDefault();
      document.querySelector(".topbar")?.classList.remove("menu-open");
      select("play");
      $("tab-play")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
