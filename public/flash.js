// Flash page: plays a .swf the player picks from their own computer with Ruffle (public/ruffle/, self-hosted).
// The file is read in the browser and handed to Ruffle as bytes: it is never uploaded to the hub.
"use strict";
// Must be set before ruffle.js runs (this script is loaded first).
window.RufflePlayer = window.RufflePlayer || {};
window.RufflePlayer.config = {
  publicPath: "/ruffle/",
  polyfills: false,            // don't scan the page for <object>/<embed> tags
  autoplay: "on",
  unmuteOverlay: "hidden",
  letterbox: "on",
  allowNetworking: "none",     // the game can't reach the internet or the hub (the CSP blocks other hosts too)
  allowScriptAccess: false,    // no calls from the game into this page
  openUrlMode: "deny",         // no navigateToURL / getURL pop-ups
  showSwfDownload: false,
  warnOnUnsupportedContent: false,
  logLevel: "error",
};

(() => {
  const $ = id => document.getElementById(id);
  const MAX = 200 * 1024 * 1024;
  let player = null;

  function fail(msg) { const e = $("fl-error"); e.textContent = msg; e.hidden = !msg; }

  async function play(file) {
    fail("");
    if (!file) return;
    if (!/\.swf$/i.test(file.name)) return fail("That isn't a .swf file.");
    if (file.size > MAX) return fail("That file is too big (over 200 MB).");
    playBytes(new Uint8Array(await file.arrayBuffer()), file.name, file.name.replace(/\.swf$/i, ""));
  }

  // Games in the hub's roms/swf folder (owner's files, same access as the ROM library).
  const enc = p => p.split("/").map(encodeURIComponent).join("/");
  async function loadList() {
    let games = [];
    try { games = (await (await fetch("/api/flash-games")).json()).games || []; } catch {}
    const box = $("fl-lib");
    box.textContent = "";
    for (const g of games) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "fl-game";
      if (g.cover) { const im = document.createElement("img"); im.src = "/flash/" + enc(g.cover); im.alt = ""; im.loading = "lazy"; b.appendChild(im); }
      const t = document.createElement("span"); t.textContent = g.name; b.appendChild(t);
      const s = document.createElement("small"); s.className = "muted"; s.textContent = (g.size / 1048576).toFixed(1) + " MB"; b.appendChild(s);
      b.addEventListener("click", async () => {
        fail(""); b.disabled = true; const was = t.textContent; t.textContent = "Loading…";
        try {
          const r = await fetch("/flash/" + enc(g.file));
          if (!r.ok) throw new Error("the hub said " + r.status);
          playBytes(new Uint8Array(await r.arrayBuffer()), g.file.split("/").pop(), g.name);
        } catch (e) { fail("Couldn't load " + g.name + ": " + (e.message || e)); }
        finally { b.disabled = false; t.textContent = was; }
      });
      box.appendChild(b);
    }
    $("fl-lib-wrap").hidden = !games.length;
  }
  loadList();

  async function playBytes(data, fileName, title) {
    // Every SWF starts with FWS (plain), CWS (zlib) or ZWS (LZMA).
    const sig = String.fromCharCode(data[0], data[1], data[2]);
    if (!/^[FCZ]WS$/.test(sig)) return fail("That file doesn't look like a Flash game (not a SWF inside).");
    if (!window.RufflePlayer || !window.RufflePlayer.newest) return fail("The Flash player (Ruffle) didn't load. Reload the page.");
    eject();
    player = window.RufflePlayer.newest().createPlayer();
    player.className = "fl-player";
    $("fl-stage").appendChild(player);
    $("fl-setup").hidden = true;
    $("fl-stage").hidden = false;
    $("fl-full").hidden = $("fl-eject").hidden = false;
    $("fl-name").textContent = title;
    document.title = "Retro Hub · " + title;
    const api = typeof player.ruffle === "function" ? player.ruffle() : player;
    try {
      await api.load({ data, swfFileName: fileName });
    } catch (e) {
      eject();
      fail("Ruffle couldn't start this game: " + (e && e.message || e));
    }
  }

  function eject() {
    if (player) { player.remove(); player = null; }
    $("fl-stage").hidden = true;
    $("fl-setup").hidden = false;
    $("fl-full").hidden = $("fl-eject").hidden = true;
    $("fl-name").textContent = "";
    document.title = "Retro Hub · Flash";
    $("fl-file").value = "";
  }

  $("fl-file").addEventListener("change", e => play(e.target.files[0]));
  const drop = $("fl-drop");
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", e => { e.preventDefault(); play(e.dataTransfer.files[0]); });
  $("fl-eject").addEventListener("click", eject);
  $("fl-full").addEventListener("click", () => {
    const api = player && (typeof player.ruffle === "function" ? player.ruffle() : player);
    if (api && api.enterFullscreen) api.enterFullscreen(); else $("fl-stage").requestFullscreen?.();
  });
  window.addEventListener("beforeunload", e => { if (player) { e.preventDefault(); e.returnValue = ""; } });
})();
