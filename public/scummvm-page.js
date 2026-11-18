// ScummVM page: lists the game folders in <roms>/scummvm and opens them in /scummvm/play.html?game=<folder>.
"use strict";
(async () => {
  const $ = id => document.getElementById(id);
  const enc = p => p.split("/").map(encodeURIComponent).join("/");
  let data = { games: [] };
  try { data = await (await fetch("/api/scummvm-games")).json(); } catch {}
  const games = data.games || [];
  for (const g of games) {
    const a = document.createElement("a");
    a.className = "btn fl-game";
    a.href = "/scummvm/play.html?game=" + encodeURIComponent(g.name);
    a.target = "_blank"; a.rel = "noopener";
    if (g.cover) { const im = document.createElement("img"); im.src = "/scummvm/data/games/" + enc(g.cover); im.alt = ""; im.loading = "lazy"; a.appendChild(im); }
    const t = document.createElement("span"); t.textContent = g.name; a.appendChild(t);
    const s = document.createElement("small"); s.className = "muted"; s.textContent = g.files + (g.files === 1 ? " file" : " files"); a.appendChild(s);
    $("sv-lib").appendChild(a);
  }
  $("sv-lib-wrap").hidden = !games.length;
  $("sv-none").hidden = !!games.length || !!data.locked;
})();
