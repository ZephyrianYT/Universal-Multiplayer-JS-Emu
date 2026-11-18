// Retro Hub's ScummVM page: the Module setup from the ScummVM web build's own page, plus a game to start.
// play.html?game=<folder in roms/scummvm> starts that folder with --auto-detect (ScummVM finds the game itself);
// with no game, ScummVM's own launcher opens (its "Add Game..." can browse /data/games).
"use strict";
(() => {
  const canvas = document.getElementById("canvas");
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.addEventListener("webglcontextlost", e => { alert("The graphics context was lost. Reload the page."); e.preventDefault(); });
  const game = new URLSearchParams(location.search).get("game");
  const title = document.querySelector("#download-modal-title h3");

  window.Module = {
    preRun: [() => {
      // scummvm.js empties Module.arguments when it loads and starts the program with that same array,
      // so the game is added here (a folder name with spaces stays one argument, unlike the #hash form).
      if (game && !/[\\]|(^|\/)\.\.(\/|$)/.test(game)) {
        Module.arguments.push("--path=/data/games/" + game, "--auto-detect");
        document.title = "Retro Hub · " + game;
      }
    }],
    postRun: [],
    print: text => console.log(text),
    printErr: text => console.error(text),
    canvas,
    setStatus(text) {
      const modal = document.getElementById("download-modal");
      modal.style.display = "block";
      if (text === Module.setStatus.last) return;
      Module.setStatus.last = text;
      if (text) title.textContent = text;
      else {
        modal.style.display = "none";
        const fill = document.getElementById("download-modal-progress-fill");
        fill.style.transition = "none"; fill.style.width = "0%";
      }
    },
    onRuntimeInitialized() { if (typeof httpHideProgressBar === "function") httpHideProgressBar(); },
    totalDependencies: 0,
    monitorRunDependencies(left) {
      this.totalDependencies = Math.max(this.totalDependencies, left);
      Module.setStatus(left ? "Preparing... (" + (this.totalDependencies - left) + "/" + this.totalDependencies + ")" : "All downloads complete.");
    },
  };
  Module.setStatus.last = "";
  window.addEventListener("error", e => console.error("ScummVM page error:", e.message));
})();
