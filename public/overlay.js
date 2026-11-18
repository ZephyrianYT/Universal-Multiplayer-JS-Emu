// OBS overlay for Streamer Mode: who's playing and who's up next. Polls /api/overlay every 2 s (hub PC only).
(function () {
  "use strict";
  const q = new URLSearchParams(location.search);
  const room = (q.get("room") || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
  if (q.get("side") === "right") document.body.classList.add("right");
  const scale = Number(q.get("scale"));
  if (scale > 0.3 && scale < 4) document.body.style.zoom = String(scale);
  const $ = id => document.getElementById(id);
  const li = (slot, name, t) => {
    const el = document.createElement("li");
    el.innerHTML = '<span class="slot"></span><span class="name"></span><span class="t"></span>';
    el.children[0].textContent = slot; el.children[1].textContent = name; el.children[2].textContent = t || "";
    return el;
  };
  const mmss = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  async function tick() {
    let d = null;
    try { d = await fetch("/api/overlay" + (room ? "?room=" + room : ""), { cache: "no-store" }).then(r => r.ok ? r.json() : null); } catch {}
    $("box").classList.toggle("hidden", !d?.on);
    if (!d?.on) return;
    $("game").textContent = [d.game, d.system].filter(Boolean).join(" · ");
    $("seats").replaceChildren(...d.seats.map(s => li(`P${s.slot + 1}`, s.name, s.left != null ? mmss(s.left) : "")));
    $("next-wrap").classList.toggle("hidden", !d.streamer);
    $("next").replaceChildren(...(d.next.length ? d.next.map((n, i) => li(`${i + 1}.`, n)) : [li("", "Nobody waiting. Join the stream's lobby!")]),
      ...(d.waiting > d.next.length ? [li("", `+${d.waiting - d.next.length} more`)] : []));
  }
  tick();
  setInterval(tick, 2000);
})();
