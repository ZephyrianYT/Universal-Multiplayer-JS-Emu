// J2ME page: lists the owner's phone games in <roms>/j2me and opens them in freej2me-web (/j2me/run.html?jar=...).
"use strict";
(async () => {
  const $ = id => document.getElementById(id);
  const enc = p => p.split("/").map(encodeURIComponent).join("/");
  const touch = matchMedia("(pointer: coarse)").matches;
  let games = [];
  try { games = (await (await fetch("/api/j2me-games")).json()).games || []; } catch {}
  for (const g of games) {
    const a = document.createElement("a");
    a.className = "btn fl-game";
    a.href = "/j2me/run.html?jar=" + encodeURIComponent(g.file) + (touch ? "&mobile=1" : "");
    a.target = "_blank"; a.rel = "noopener";
    if (g.cover) { const im = document.createElement("img"); im.src = "/j2me/jar/" + enc(g.cover); im.alt = ""; im.loading = "lazy"; a.appendChild(im); }
    const t = document.createElement("span"); t.textContent = g.name; a.appendChild(t);
    const s = document.createElement("small"); s.className = "muted"; s.textContent = Math.max(1, Math.round(g.size / 1024)) + " KB"; a.appendChild(s);
    $("j2-lib").appendChild(a);
  }
  $("j2-lib-wrap").hidden = !games.length;
})();
