// 🎸 Controllers & instruments: teach the hub what each part of a guitar or drum kit is (any brand: PS3, Wii,
// Xbox 360, Rock Band / Guitar Hero dongles). The layout is saved per device in this browser (input.js reads it).
// Parts are mapped like an Xbox 360 instrument, so on the host's PC (native emulators: RPCS3, PCSX2, Dolphin) the
// player's virtual Xbox controller looks like a 360 guitar / drum kit. Setup per emulator: emulators/INSTRUMENTS.md.
(function () {
  "use strict";
  const { Modal, toast } = window.RH.UI;
  const { Input } = window.RH;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // RetroPad ids (input.js): 0 south/A, 8 east/B, 1 west/X, 9 north/Y, 10 LB, 11 RB, 2 Back, 3 Start, 4/5 D-pad up/down, 20 right stick right
  const PROFILES = {
    guitar: { label: "🎸 Guitar", steps: [
      { label: "Green fret", id: 0 }, { label: "Red fret", id: 8 }, { label: "Yellow fret", id: 9 }, { label: "Blue fret", id: 1 },
      { label: "Orange fret", id: 10 }, { label: "Strum up", id: 4 }, { label: "Strum down", id: 5 }, { label: "Start", id: 3 },
      { label: "Star Power / Select button", id: 2, optional: true },
      { label: "Whammy bar: push it all the way, then let go", id: 20, analog: true, optional: true },
      { label: "Tilt the neck up (Star Power), then back down", id: 2, optional: true, extra: true },
    ] },
    drums: { label: "🥁 Drums", steps: [
      { label: "Red pad", id: 8 }, { label: "Yellow pad", id: 9 }, { label: "Blue pad", id: 1 }, { label: "Green pad", id: 0 },
      { label: "Bass (kick) pedal", id: 10 }, { label: "Orange cymbal (Guitar Hero kits)", id: 11, optional: true },
      { label: "Start", id: 3 }, { label: "Select / Back", id: 2, optional: true },
    ] },
  };
  const PART_NAMES = { 0: "Green", 8: "Red", 9: "Yellow", 1: "Blue", 10: "Orange / Kick", 11: "Cymbal", 4: "Strum ↑", 5: "Strum ↓", 3: "Start", 2: "Star Power", 20: "Whammy" };
  const maps = () => { try { return JSON.parse(localStorage.getItem("rh-padmaps") || "{}") || {}; } catch { return {}; } };
  const saveMaps = m => { try { localStorage.setItem("rh-padmaps", JSON.stringify(m)); } catch {} window.dispatchEvent(new Event("rh-padmaps")); };
  const pads = () => Array.from(navigator.getGamepads?.() || []).filter(Boolean);

  let dlg = null, raf = 0, wizard = null, testPad = null, testDetach = null, selected = null;
  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "wide inst-dlg"; dlg.setAttribute("aria-labelledby", "inst-title");
    dlg.innerHTML = `
      <h2 id="inst-title">🎸 Controllers &amp; instruments</h2>
      <p class="small muted">Guitar Hero / Rock Band guitars and drum kits: set them up once here and they work in lobbies (as your seat's controller)
        and on the host's PC as an Xbox 360-style instrument. <b>Xbox 360 instruments</b> usually work on <i>Automatic</i>. PS3, Wii and Rock Band
        dongles need <b>Guitar</b> or <b>Drums</b>: you press each part once. Saved in this browser, per device.</p>
      <ul class="list inst-list" id="inst-list"></ul>
      <div class="inst-wizard" id="inst-wizard" hidden>
        <div class="inst-step" id="inst-step"></div>
        <div class="small muted" id="inst-progress"></div>
        <div class="row"><button class="small" id="inst-skip" type="button">Skip</button><button class="small ghost" id="inst-cancel" type="button">Cancel</button></div>
      </div>
      <div class="inst-test" id="inst-test" hidden><div class="sys-group">Test: press things</div><div class="inst-parts" id="inst-parts"></div></div>
      <p class="small muted">Rhythm games over a stream: friends see and hear the game a little late, so each player should run the game's own
        audio / video calibration (lag) once. On the host's PC, set the emulator up for instruments: see <code>emulators/INSTRUMENTS.md</code>.</p>
      <div class="row end" style="margin-top:12px"><button class="primary" id="inst-close" type="button">Done</button></div>`;
    document.body.appendChild(dlg);
    dlg.querySelector("#inst-close").onclick = () => Modal.close(dlg);
    dlg.querySelector("#inst-cancel").onclick = () => stopWizard("Cancelled.");
    dlg.querySelector("#inst-skip").onclick = () => { if (wizard && wizard.steps[wizard.i].optional) advance(null); };
    dlg.querySelector("#inst-list").addEventListener("click", e => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      const gp = pads().find(p => p.index === Number(b.dataset.index)); if (!gp) return;
      selected = gp.id;
      if (b.dataset.act === "auto") { const m = maps(); delete m[gp.id]; saveMaps(m); toast("Back to automatic.", { ms: 2000 }); renderList(); }
      else if (b.dataset.act === "test") renderList();
      else startWizard(gp, b.dataset.act);
    });
    dlg.addEventListener("close", () => { clearInterval(raf); wizard = null; testDetach?.(); testDetach = null; });
  }
  function renderList() {
    const m = maps(), list = pads();
    dlg.querySelector("#inst-list").innerHTML = list.length ? list.map(gp => {
      const kind = m[gp.id]?.kind;
      return `<li class="${gp.id === selected ? "sel" : ""}"><div class="grow min0"><b class="trunc" title="${esc(gp.id)}">${esc(gp.id.replace(/\s*\(.*$/, "") || "Controller")}</b>
        <div class="small muted">Controller ${gp.index + 1} · ${gp.mapping === "standard" ? "standard layout" : "non-standard layout"} · ${kind ? PROFILES[kind].label : "Automatic"}</div></div>
        <button class="small" data-act="guitar" data-index="${gp.index}">🎸 Guitar</button>
        <button class="small" data-act="drums" data-index="${gp.index}">🥁 Drums</button>
        ${kind ? `<button class="small ghost" data-act="auto" data-index="${gp.index}">Automatic</button>` : ""}
        <button class="small ghost" data-act="test" data-index="${gp.index}">Test</button></li>`;
    }).join("") : '<li class="small muted">No controller found. Plug it in (or its dongle) and press a button on it.</li>';
    startTest();
  }
  // Live test of the selected device through the real input path (learned layout or automatic).
  function startTest() {
    testDetach?.(); testDetach = null;
    const box = dlg.querySelector("#inst-test");
    const list = pads(), order = list.findIndex(p => p.id === selected);
    box.hidden = order < 0 || !!wizard;
    if (box.hidden) return;
    const kind = maps()[selected]?.kind;
    const show = kind === "drums" ? [8, 9, 1, 0, 10, 11, 3, 2] : [0, 8, 9, 1, 10, 4, 5, 3, 2, 20];
    testPad = new Input.Pad(v => {
      dlg.querySelector("#inst-parts").innerHTML = show.map(id => `<span class="inst-part${v[id] ? " on" : ""} p${id}">${esc(kind === "drums" && id === 10 ? "Kick" : PART_NAMES[id])}</span>`).join("");
    });
    testPad.onChange(new Array(Input.N).fill(0));
    testDetach = Input.attachGamepads("ps3", o => (o === order ? testPad : null));
  }
  // ---- learn wizard
  const snap = gp => ({ b: gp.buttons.map(b => typeof b === "object" ? (b.pressed || b.value > 0.5) : b > 0.5), a: gp.axes.slice() });
  function startWizard(gp, kind) {
    testDetach?.(); testDetach = null;
    wizard = { id: gp.id, index: gp.index, kind, steps: PROFILES[kind].steps, i: 0, controls: [], base: null, waitRelease: false, peak: null };
    dlg.querySelector("#inst-test").hidden = true;
    dlg.querySelector("#inst-wizard").hidden = false;
    // a moment to take the hands off, then read the resting state
    setTimeout(() => { const p = pads().find(x => x.index === gp.index); if (wizard && p) { wizard.base = snap(p); showStep(); poll(); } }, 400);
    showStep();
  }
  function showStep() {
    if (!wizard) return;
    const st = wizard.steps[wizard.i];
    dlg.querySelector("#inst-step").textContent = wizard.base ? `Press: ${st.label}` : "Hands off the controller for a moment…";
    dlg.querySelector("#inst-progress").textContent = `${PROFILES[wizard.kind].label} · step ${wizard.i + 1} of ${wizard.steps.length}${st.optional ? " · optional" : ""}`;
    dlg.querySelector("#inst-skip").hidden = !st.optional;
  }
  // A steady 30 ms poll (not animation frames, which slow down in a background window and would miss quick taps).
  function poll() {
    clearInterval(raf);
    const tick = () => {
      if (!wizard || !dlg.open) return clearInterval(raf);
      const gp = pads().find(x => x.index === wizard.index);
      if (gp && wizard.base) {
        const now = snap(gp), base = wizard.base, st = wizard.steps[wizard.i];
        const moved = (i) => Math.abs((now.a[i] ?? 0) - (base.a[i] ?? 0));
        if (wizard.waitRelease) {
          const calm = now.b.every((p, i) => p === base.b[i]) && now.a.every((_, i) => moved(i) < 0.25);
          if (calm) { wizard.waitRelease = false; }
        } else if (st.analog) {
          // whammy: follow the axis that moves most, record its furthest point, finish when it's back at rest
          let best = -1, bestD = 0.35;
          now.a.forEach((_, i) => { if (moved(i) > bestD) { bestD = moved(i); best = i; } });
          if (best >= 0 && (!wizard.peak || wizard.peak.index === best)) {
            if (!wizard.peak || moved(best) > Math.abs(wizard.peak.target - base.a[best])) wizard.peak = { type: "axis", index: best, target: now.a[best], rest: base.a[best], analog: true };
          } else if (wizard.peak && moved(wizard.peak.index) < 0.15) { const c = wizard.peak; wizard.peak = null; advance(c); }
        } else {
          const bi = now.b.findIndex((p, i) => p && !base.b[i]);
          if (bi >= 0) advance({ type: "button", index: bi });
          else {
            let ai = -1, d = 0.5;
            now.a.forEach((_, i) => { if (moved(i) > d) { d = moved(i); ai = i; } });
            if (ai >= 0) advance({ type: "axis", index: ai, target: now.a[ai], rest: base.a[ai] });
          }
        }
      }
    };
    raf = setInterval(tick, 30);
  }
  function advance(control) {
    const st = wizard.steps[wizard.i];
    if (control) wizard.controls.push({ id: st.id, ...control });
    wizard.waitRelease = !!control;
    wizard.i++;
    if (wizard.i >= wizard.steps.length) return finish();
    showStep();
  }
  function finish() {
    const w = wizard; wizard = null; clearInterval(raf);
    const m = maps(); m[w.id] = { kind: w.kind, controls: w.controls, at: Date.now() }; saveMaps(m);
    dlg.querySelector("#inst-wizard").hidden = true;
    toast(`${PROFILES[w.kind].label} set up (${w.controls.length} parts). Try it in the test below.`, { kind: "ok", ms: 4000 });
    selected = w.id; renderList();
  }
  function stopWizard(msg) {
    wizard = null; clearInterval(raf);
    dlg.querySelector("#inst-wizard").hidden = true;
    if (msg) toast(msg, { ms: 2000 });
    renderList();
  }
  function open() {
    if (!dlg) build();
    selected = selected || pads()[0]?.id || null;
    dlg.querySelector("#inst-wizard").hidden = true; wizard = null;
    Modal.open(dlg, { focus: "#inst-close" });
    renderList();
  }
  window.addEventListener("gamepadconnected", () => { if (dlg?.open && !wizard) renderList(); });
  window.addEventListener("gamepaddisconnected", () => { if (dlg?.open && !wizard) renderList(); });
  document.addEventListener("click", e => { if (e.target.closest?.("[data-open-instruments]")) open(); });
  window.RH = Object.assign(window.RH || {}, { Instruments: { open, PROFILES } });
})();
