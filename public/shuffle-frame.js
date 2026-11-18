// One Shuffler game: the parent page (shuffle.js) calls startGame() and then drives the emulator directly
// (same origin): pause / play / volume / simulateInput. Keys and gamepads are read by the parent, not here.
(function () {
  "use strict";
  window.startGame = ({ url, core, name, volume }) => new Promise((resolve, reject) => {
    const noKeys = {};
    for (let p = 0; p < 4; p++) { noKeys[p] = {}; for (let i = 0; i < 30; i++) noKeys[p][i] = { value: "", value2: "" }; }
    let done = false;
    Object.assign(window, {
      EJS_player: "#game", EJS_core: core, EJS_gameUrl: url, EJS_gameName: name, EJS_pathtodata: "/data/",
      EJS_startOnLoaded: true, EJS_volume: volume ?? 0.5, EJS_color: "#ffd60a", EJS_backgroundColor: "#000000",
      EJS_threads: !!window.crossOriginIsolated && typeof SharedArrayBuffer === "function",
      EJS_defaultControls: noKeys,                    // the Shuffler page handles keyboard and gamepads
      EJS_Buttons: { netplay: false },
      EJS_onGameStart: () => { done = true; resolve(window.EJS_emulator); },
    });
    // EmulatorJS has no progress or error callback: watch its loading text.
    const watch = setInterval(() => {
      const el = document.querySelector(".ejs_loading_text");
      if (!el) return;
      const t = el.textContent || "";
      window.parent?.postMessage?.({ t: "shuffle-progress", name, text: t }, location.origin);
      if (/error|failed/i.test(t) || el.classList.contains("ejs_error_text")) { clearInterval(watch); if (!done) reject(new Error(t || "The emulator couldn't load this game.")); }
    }, 300);
    const s = document.createElement("script");
    s.src = "/data/loader.js";
    s.onerror = () => reject(new Error("Couldn't load the emulator files."));
    document.body.appendChild(s);
    setTimeout(() => { if (!done) { clearInterval(watch); reject(new Error("The game took too long to start.")); } }, 180000);
  });
})();
