// 🗡️ GBA screens mode: this player's own Game Boy Advance screen, shown over the corner of the game view.
// Host: their own GBA window share. Guest: the side video the host sends to this player only (netplay.js setSide).
// Sized in whole multiples of 240x160 so the pixels stay sharp; ⤢ cycles small / big / hidden-while-you-look-at-the-TV.
(function () {
  "use strict";
  const SIZES = [2, 3, 0];          // scale; 0 = tucked away (a small tab stays to bring it back)
  let box = null, video = null, idx = 0;
  try { idx = Math.max(0, SIZES.indexOf(Number(localStorage.getItem("rh-gba-size")))); } catch {}

  function build() {
    const stage = document.getElementById("stage"); if (!stage) return null;
    box = document.createElement("div");
    box.className = "gba-view"; box.hidden = true;
    box.innerHTML = `<div class="gba-bar"><span class="gba-title">GBA</span><button type="button" class="gba-size" title="Bigger / smaller / tuck away">⤢</button></div>
      <video autoplay playsinline muted></video>`;
    video = box.querySelector("video");
    box.querySelector(".gba-size").addEventListener("click", e => { e.stopPropagation(); idx = (idx + 1) % SIZES.length; apply(); });
    stage.appendChild(box);
    return box;
  }
  function apply() {
    if (!box) return;
    const s = SIZES[idx];
    box.classList.toggle("tucked", s === 0);
    box.style.setProperty("--gba-w", `${240 * (s || 1)}px`);
    try { localStorage.setItem("rh-gba-size", String(s)); } catch {}
  }
  // track: the GBA video, or null to hide. slot: the seat it belongs to (for the label).
  function show(track, slot) {
    if (!box && !build()) return;
    if (!track) { box.hidden = true; video.srcObject = null; return; }
    if (video.srcObject?.getVideoTracks?.()[0] !== track) video.srcObject = new MediaStream([track]);
    box.querySelector(".gba-title").textContent = Number.isInteger(slot) && slot >= 0 ? `Your GBA (P${slot + 1})` : "Your GBA";
    box.hidden = false; apply();
    video.play().catch(() => {});
  }
  window.RH = window.RH || {};
  window.RH.GbaView = { show };
})();
