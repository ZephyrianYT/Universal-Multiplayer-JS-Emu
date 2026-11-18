// Race / speedrun mode: a timer with splits on top of Single-Player Ghost (everyone runs their own copy).
// The hub stamps every split (server.mjs raceAct), so all players are timed by one clock. This file holds the
// page side: the timer panel, standings, personal bests kept in this browser, a LiveSplit .lss export, and an
// optional mirror to LiveSplit Server running on the player's own PC.
(function () {
  "use strict";
  const { Settings, offsite } = window.RH.UI;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 1:02:03.456 / 2:03.456 / 0:03.45 (short: hundredths, for the live clock)
  function fmt(ms, short) {
    if (ms == null || !Number.isFinite(ms)) return "–";
    const t = Math.max(0, Math.round(ms)), h = Math.floor(t / 3600e3), m = Math.floor(t / 60e3) % 60, s = Math.floor(t / 1e3) % 60;
    const frac = short ? String(Math.floor((t % 1000) / 10)).padStart(2, "0") : String(t % 1000).padStart(3, "0");
    return `${h ? h + ":" + String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}.${frac}`;
  }
  const fmtDelta = ms => (ms < 0 ? "−" : "+") + (Math.abs(ms) < 60e3 ? (Math.abs(ms) / 1000).toFixed(Math.abs(ms) < 10e3 ? 2 : 1) : fmt(Math.abs(ms)));

  // ---- personal bests (per game + console + split names), kept in this browser
  const pbKey = (game, system, names) => `${system}|${String(game).toLowerCase()}|${names.join("␟")}`;
  const allPbs = () => Settings.get("racePbs") || {};
  function getPb(game, system, names) { return allPbs()[pbKey(game, system, names)] || null; }
  // splits: cumulative times. Returns { pb: true } when this run is a new personal best.
  function recordRun(game, system, names, splits) {
    const key = pbKey(game, system, names), pbs = allPbs(), old = pbs[key] || null;
    const segs = splits.map((t, i) => t - (i ? splits[i - 1] : 0));
    const golds = segs.map((s, i) => Math.min(s, old?.golds?.[i] ?? Infinity));
    const total = splits[splits.length - 1];
    const isPb = !old || total < old.total;
    pbs[key] = { game, system, names, golds, total: isPb ? total : old.total, splits: isPb ? splits.slice() : old.splits,
      at: isPb ? Date.now() : old.at, attempts: (old?.attempts || 0) + 1 };
    const keys = Object.keys(pbs);            // keep the 200 most recent
    if (keys.length > 200) keys.sort((a, b) => (pbs[a].at || 0) - (pbs[b].at || 0)).slice(0, keys.length - 200).forEach(k => delete pbs[k]);
    Settings.set("racePbs", pbs);
    return { pb: isPb, previous: old };
  }

  // ---- LiveSplit splits file (.lss) with the personal best and best segments
  function lss(game, system, names, pb) {
    const t = ms => { if (ms == null || !Number.isFinite(ms)) return ""; const x = Math.max(0, ms); const h = Math.floor(x / 3600e3), m = Math.floor(x / 60e3) % 60, s = (x % 60e3) / 1e3;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(7).padStart(10, "0")}`; };
    const x = s => esc(s);
    const segs = names.map((n, i) => `    <Segment>
      <Name>${x(n)}</Name>
      <Icon />
      <SplitTimes>
        <SplitTime name="Personal Best">${pb?.splits?.[i] != null ? `
          <RealTime>${t(pb.splits[i])}</RealTime>` : ""}
        </SplitTime>
      </SplitTimes>
      <BestSegmentTime>${pb?.golds?.[i] != null ? `
        <RealTime>${t(pb.golds[i])}</RealTime>` : ""}
      </BestSegmentTime>
      <SegmentHistory />
    </Segment>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<Run version="1.7.0">
  <GameIcon />
  <GameName>${x(game)}</GameName>
  <CategoryName>Any%</CategoryName>
  <Metadata>
    <Run id="" />
    <Platform usesEmulator="True">${x(system)}</Platform>
    <Region />
    <Variables />
  </Metadata>
  <Offset>00:00:00</Offset>
  <AttemptCount>${pb?.attempts || 0}</AttemptCount>
  <AttemptHistory />
  <Segments>
${segs}
  </Segments>
  <AutoSplitterSettings />
</Run>
`;
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/xml" }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---- LiveSplit Server mirror (LiveSplit: Control > Start Server / the LiveSplit.Server component, WebSocket).
  // Only ever connects to this computer (the page's Content-Security-Policy allows ws://localhost only).
  const LS_DEFAULT = "ws://localhost:16834/livesplit";
  class LiveSplit {
    constructor() { this.ws = null; this.url = ""; this.state = "off"; this.onState = () => {}; }
    connect(url) {
      this.close();
      let u; try { u = new URL(url || LS_DEFAULT); } catch { this._set("error", "Not a valid address."); return; }
      if (u.protocol !== "ws:" || !["localhost", "127.0.0.1"].includes(u.hostname)) { this._set("error", "Use a ws://localhost:<port> address."); return; }
      this.url = u.href; this._set("connecting");
      try { this.ws = new WebSocket(this.url); } catch (e) { this._set("error", e.message); return; }
      this.ws.onopen = () => this._set("on");
      this.ws.onclose = () => { if (this.ws) { this.ws = null; this._set("error", "LiveSplit isn't answering. Start its server, then reconnect."); } };
      this.ws.onerror = () => {};
    }
    send(cmd) { if (this.ws?.readyState === 1) { try { this.ws.send(cmd); } catch {} } }
    close() { const w = this.ws; this.ws = null; try { w?.close(); } catch {} this._set("off"); }
    _set(s, info = "") { this.state = s; this.onState(s, info); }
  }

  // ---- in-game panel. ctx: { game, system, names(), me(), players(), elapsed() -> ms|null, over(), send(act), solo() }
  function createPanel(root, ctx) {
    root.innerHTML = `
      <div class="rc-head"><span class="rc-mode"></span><span class="grow"></span>
        <button class="small ghost icon rc-min" title="Shrink / grow the timer" aria-label="Shrink or grow the timer">▁</button></div>
      <div class="rc-clock" aria-live="off">0:00.00</div>
      <div class="rc-now small muted"></div>
      <ol class="rc-splits"></ol>
      <ol class="rc-board" aria-label="Standings"></ol>
      <div class="row rc-btns">
        <button class="small primary rc-split" title="Split (F6)">Split <kbd>F6</kbd></button>
        <button class="small rc-undo" title="Undo the last split (F7)">Undo <kbd>F7</kbd></button>
        <button class="small rc-quit">Forfeit</button>
        <button class="small rc-restart" hidden title="Reset the timer for another attempt (reset your game too)">Reset</button>
      </div>
      <details class="rc-more"><summary class="small">PB, LiveSplit &amp; pop-outs</summary>
        <div class="small muted rc-pb"></div>
        <div class="row"><button class="small rc-lss">⤓ LiveSplit splits (.lss)</button><button class="small rc-pipall">📺 Pop out everyone</button></div>
        <label class="check small"><input type="checkbox" class="rc-ls-on"> Mirror to LiveSplit on this PC</label>
        <div class="row nowrap"><input type="text" class="rc-ls-url" spellcheck="false" aria-label="LiveSplit Server address"><button class="small rc-ls-go">Connect</button></div>
        <div class="small muted rc-ls-state"></div>
      </details>
      <div class="rc-src"></div>`;
    const q = s => root.querySelector(s);
    const ls = new LiveSplit();
    const lsPrefs = () => ({ on: false, url: LS_DEFAULT, ...(Settings.get("livesplit") || {}) });
    q(".rc-ls-url").value = lsPrefs().url;
    q(".rc-ls-on").checked = lsPrefs().on;
    ls.onState = (s, info) => { q(".rc-ls-state").textContent = s === "on" ? "Connected to LiveSplit." : s === "connecting" ? "Connecting…" : s === "error" ? info : ""; };
    const lsGo = () => { Settings.patch("livesplit", { on: q(".rc-ls-on").checked, url: q(".rc-ls-url").value.trim() || LS_DEFAULT }); if (q(".rc-ls-on").checked) ls.connect(lsPrefs().url); else ls.close(); };
    q(".rc-ls-on").onchange = lsGo; q(".rc-ls-go").onclick = lsGo;
    if (lsPrefs().on) ls.connect(lsPrefs().url);
    q(".rc-min").onclick = () => { root.classList.toggle("mini"); Settings.patch("racePanel", { mini: root.classList.contains("mini") }); };
    if (Settings.get("racePanel")?.mini) root.classList.add("mini");
    q(".rc-split").onclick = () => ctx.send("split");
    q(".rc-undo").onclick = () => ctx.send("undo");
    q(".rc-quit").onclick = () => { if (confirm("Forfeit this race? Your timer stops.")) ctx.send("forfeit"); };
    q(".rc-restart").onclick = () => ctx.send("restart");
    q(".rc-pipall").onclick = () => ctx.pipAll?.();
    // World records live on speedrun.com, not here: an offsite link to the game's page there.
    const srcName = () => String(ctx.game() || "").replace(/\s*[([][^)\]]*[)\]]/g, "").trim();
    q(".rc-src").innerHTML = offsite({ href: `https://www.speedrun.com/search?q=${encodeURIComponent(srcName())}`,
      label: "Leaderboards on speedrun.com", note: "World records and rules. Submit runs there." });
    // Plain link (opens in a new tab like any other); when the pointer reaches it or it gets keyboard focus, the hub
    // looks up the game's own page and the link is pointed there. Until then (or with no match) it opens the search.
    const srcLink = q(".rc-src a");
    let srcAsked = false;
    const srcResolve = () => {
      if (srcAsked) return; srcAsked = true;
      fetch(`/api/speedrun?name=${encodeURIComponent(ctx.game() || "")}`).then(x => x.json())
        .then(r => { const u = r.url || r.search; if (/^https:\/\/www\.speedrun\.com\//.test(u || "")) srcLink.href = u; }).catch(() => {});
    };
    srcLink.addEventListener("pointerenter", srcResolve);
    srcLink.addEventListener("focus", srcResolve);
    q(".rc-lss").onclick = () => {
      const names = ctx.names();
      download(`${String(ctx.game()).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "splits"}.lss`, lss(ctx.game(), ctx.systemLabel(), names, getPb(ctx.game(), ctx.system(), names)));
    };
    const onKey = e => {
      if (e.repeat || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.key === "F6") { e.preventDefault(); ctx.send("split"); }
      else if (e.key === "F7") { e.preventDefault(); ctx.send("undo"); }
    };
    window.addEventListener("keydown", onKey, true);

    let raf = 0, lastSplits = -1, wasRunning = false, recorded = null, lastKey = "";
    function tick() {
      raf = requestAnimationFrame(tick);
      const m = ctx.me(), run = m?.run, el = ctx.elapsed();
      const t = run?.done != null ? run.done : el;
      q(".rc-clock").textContent = t == null ? "0:00.00" : fmt(t, run?.done == null);
      q(".rc-clock").dataset.state = run?.quit ? "quit" : run?.done != null ? "done" : el != null ? "running" : "idle";
      // ahead / behind the PB at the current split, while running
      const names = ctx.names(), pb = getPb(ctx.game(), ctx.system(), names);
      if (run && run.done == null && !run.quit && pb?.splits && el != null) {
        const i = run.splits.length, ref = pb.splits[i];
        q(".rc-clock").dataset.vs = ref == null ? "" : el > ref ? "behind" : "ahead";
      } else q(".rc-clock").dataset.vs = "";
    }
    // LiveSplit follows the hub's events: start at GO, split / undo, reset on forfeit or reset.
    function mirror(run, running) {
      if (running && !wasRunning) ls.send("starttimer");
      if (!running && wasRunning && (!run || !run.done)) ls.send("reset");
      wasRunning = running;
      const n = run ? run.splits.length : 0;
      if (lastSplits >= 0 && run) { for (let i = lastSplits; i < n; i++) ls.send("split"); for (let i = n; i < lastSplits; i++) ls.send("unsplit"); }
      lastSplits = run ? n : -1;
    }
    function render() {
      const names = ctx.names(), m = ctx.me(), run = m?.run, solo = ctx.solo();
      const pb = getPb(ctx.game(), ctx.system(), names);
      mirror(run, ctx.elapsed() != null && !!run && !run.quit);
      q(".rc-mode").textContent = solo ? "Speedrun" : "Race";
      const i = run ? run.splits.length : 0;
      q(".rc-now").textContent = !run ? (ctx.elapsed() == null ? "The timer starts on GO." : "You joined mid-race: not timed.")
        : run.quit ? "Forfeited." : run.done != null ? "Finished!" : `Next: ${names[i] || "Finish"} (${i + 1}/${names.length})`;
      // my splits: time, and the difference to the PB at the same split
      q(".rc-splits").innerHTML = names.map((n, k) => {
        const t = run?.splits[k], ref = pb?.splits?.[k];
        const seg = t != null ? t - (k ? run.splits[k - 1] : 0) : null, gold = seg != null && pb?.golds?.[k] != null && seg < pb.golds[k];
        const d = t != null && ref != null ? `<span class="rc-d ${t > ref ? "behind" : "ahead"}${gold ? " gold" : ""}">${fmtDelta(t - ref)}</span>` : "";
        return `<li class="${k === i && run && run.done == null ? "cur" : ""}"><span class="trunc">${esc(n)}</span>${d}<span class="rc-t">${t != null ? fmt(t) : ref != null ? `<span class="muted">${fmt(ref)}</span>` : "–"}</span></li>`;
      }).join("");
      q(".rc-splits").hidden = names.length < 2 && !pb;
      // standings: finished by time, then by splits done, then forfeits
      const list = ctx.players().filter(p => !p.spectator && p.run);
      const score = p => p.run.done != null ? [0, p.run.done] : p.run.quit ? [2, 0] : [1, -p.run.splits.length, p.run.splits.at(-1) ?? 0];
      list.sort((a, b) => { const x = score(a), y = score(b); return x[0] - y[0] || x[1] - y[1] || (x[2] ?? 0) - (y[2] ?? 0); });
      const lead = list.find(p => p.run.done != null)?.run.done;
      q(".rc-board").innerHTML = solo ? "" : list.map((p, k) => {
        const r = p.run, st = r.done != null ? fmt(r.done) + (lead != null && r.done !== lead ? ` <span class="muted">${fmtDelta(r.done - lead)}</span>` : "")
          : r.quit ? "forfeit" : `${r.splits.length}/${names.length}${r.splits.length ? " · " + fmt(r.splits.at(-1)) : ""}`;
        return `<li class="${p.id === m?.id ? "me" : ""}"><span class="rc-place">${r.done != null ? k + 1 : "·"}</span><span class="trunc grow">${esc(p.name)}</span><span class="rc-t">${st}</span></li>`;
      }).join("");
      q(".rc-board").hidden = solo;
      const can = !!run && run.done == null && !run.quit && ctx.elapsed() != null;
      q(".rc-split").disabled = !can; q(".rc-quit").disabled = !can;
      q(".rc-undo").disabled = !run || !run.splits.length || run.quit;
      q(".rc-restart").hidden = !solo; q(".rc-restart").disabled = ctx.elapsed() == null;
      q(".rc-pipall").hidden = solo;
      q(".rc-pb").textContent = pb ? `PB ${fmt(pb.total)} · ${pb.attempts} attempt${pb.attempts === 1 ? "" : "s"} · sum of best ${fmt(pb.golds.reduce((a, b) => a + b, 0))}` : "No personal best for these splits yet.";
      // record the run once it's finished
      const key = run?.done != null ? `${ctx.raceId()}:${run.done}` : "";
      if (key && key !== lastKey && run.splits.length === names.length) {
        lastKey = key;
        recorded = recordRun(ctx.game(), ctx.system(), names, run.splits);
        ctx.onRecord?.(recorded, run.done);
      }
    }
    tick();
    return { render, close() { cancelAnimationFrame(raf); window.removeEventListener("keydown", onKey, true); ls.close(); root.innerHTML = ""; } };
  }

  window.RH = Object.assign(window.RH || {}, { Race: { fmt, fmtDelta, getPb, recordRun, lss, createPanel } });
})();
