// 🌐 Online services: which emulators are set up for their game-online service (Pretendo, RPCN, Insignia...).
// Owner on the hub's own PC only (the server answers 403 to anyone else, and the button stays hidden).
// Retro Hub's own play works for every console without any of this; these are the games' OWN online modes.
// Cemu also gets buttons: copy files to where Cemu reads them, import own files, pick the network service.
(function () {
  "use strict";
  const { Settings, Modal, toast, offsite } = window.RH.UI;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const STATE = {
    ready: ["✅", "Ready", "ok"], partial: ["🟡", "Almost", "mid"], limited: ["⚠️", "Limited until set up", "bad"],
    builtin: ["✅", "Built in, nothing to set up", "ok"], guide: ["📘", "Set up in the emulator (can't be checked)", "mid"],
    none: ["➖", "No online service: Retro Hub play only", "muted"], missing: ["⬜", "Not installed", "muted"], unknown: ["❔", "Couldn't check", "mid"],
  };
  let data = null, busy = false;

  async function load() {
    const r = await fetch("/api/online", { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) return null;
    data = await r.json().catch(() => null);
    if (data?.available === false) data = null;      // not the owner on the hub's own computer: no 🌐 button
    return data;
  }
  const limitedRows = () => (data?.emulators || []).filter(e => e.installed && e.state === "limited");

  function renderButton() {
    const b = $("online-btn"); if (!b) return;
    b.hidden = !data;
    const n = limitedRows().length;
    $("online-dot").hidden = !n;
    b.title = n ? `Online services: ${n} need setup (the games' own online modes are limited until then)` : "Online services for each console";
  }

  function card(e) {
    const [icon, label, cls] = STATE[e.state] || STATE.unknown;
    const problems = (e.problems || []).map(p => `<li>${esc(p)}</li>`).join("");
    const facts = (e.facts || []).map(f => `<span class="ol-fact">${esc(f)}</span>`).join("");
    const steps = (e.steps || []).map(s => `<li>${esc(s)}</li>`).join("");
    const links = (e.links || []).map(l => offsite({ href: l.url, label: l.label })).join("");
    const open = e.installed && (e.state === "limited" || e.state === "partial");
    return `<article class="ol-card ol-${esc(cls)}" data-emu="${esc(e.id)}">
      <header><b>${esc(e.label)}</b><span class="muted small">${esc(e.consoles)}</span><span class="spacer"></span>
        <span class="ol-state" title="${esc(label)}">${icon} ${esc(label)}</span></header>
      <div class="ol-service"><b>${esc(e.service)}</b> · <span class="muted">${esc(e.gives)}</span></div>
      ${e.installed && e.state === "limited" && e.limited ? `<p class="ol-limited">${esc(e.limited)}</p>` : ""}
      ${facts ? `<div class="ol-facts">${facts}</div>` : ""}
      ${e.installed && problems ? `<ul class="ol-problems">${problems}</ul>` : ""}
      ${e.id === "cemu" && e.installed ? cemuTools(e) : ""}
      ${e.gba && e.installed ? dolphinTools() : ""}
      ${steps || links ? `<details class="ol-steps"${open ? " open" : ""}><summary>How to set it up</summary>${steps ? `<ol>${steps}</ol>` : ""}${servers(e)}${links ? `<div class="ol-links">${links}</div>` : ""}</details>` : ""}
    </article>`;
  }
  // Community revival servers (services.json "servers"): only addresses confirmed from a named source.
  function servers(e) {
    if (!e.servers?.length && !e.serversUnverified) return "";
    const rows = (e.servers || []).map(s => `<tr><td><b>${esc(s.name)}</b><br><span class="muted">${esc(s.games)}</span></td>
      <td><code class="mono">${esc(s.dns)}</code> <button type="button" class="small ghost" data-copy="${esc(s.dns)}" title="Copy">📋</button></td>
      <td class="muted">${esc(s.source)}</td></tr>`).join("");
    return `<div class="ol-servers"><b>Community servers</b> <span class="muted small">(DNS address for that game's custom configuration)</span>
      ${rows ? `<table><thead><tr><th>Project</th><th>DNS</th><th>Where it's from</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
      ${e.serversUnverified ? `<p class="muted small">${esc(e.serversUnverified)}</p>` : ""}</div>`;
  }
  // 🗡️ Dolphin GBA netplay (Four Swords Adventures with everyone on their own PC).
  function dolphinTools() {
    return `<div class="ol-tools ol-dolphin">
      <b class="small">🗡️ GBA netplay (Four Swords Adventures…)</b>
      <label class="small">Host code to join <span class="muted">(leave empty to host)</span><input type="text" class="ol-hostcode" maxlength="8" placeholder="e.g. 1a2b3c4d" spellcheck="false"></label>
      <label class="small">Highest ping in ms <span class="muted">(sets the pad buffer)</span><input type="number" class="ol-ping" min="0" max="600" placeholder="e.g. 60"></label>
      <button type="button" class="small primary" data-dolphin="netplay">Open Dolphin for GBA netplay</button>
      <p class="muted small">Opens Dolphin with 4 GBA ports, your GBA BIOS (Retro Hub's bios folder), Hide Remote GBAs and traversal (no port forwarding), in its own settings folder. Then Tools → Start NetPlay → Host, or Connect with the code.</p>
    </div>`;
  }
  function cemuTools(e) {
    const c = e.cemu || {};
    return `<div class="ol-tools">
      ${c.stray?.length ? `<button type="button" class="primary small" data-cemu="move">📂 Copy them to where Cemu reads</button>` : ""}
      <button type="button" class="small" data-cemu="import">📥 Import my files…</button>
      <button type="button" class="small" data-cemu="pretendo"${c.service === "Pretendo" && c.online && !c.proxy ? " disabled" : ""}>🌐 Use Pretendo</button>
      <button type="button" class="small" data-cemu="own">🖥️ My own server…</button>
      ${c.service === "Custom" || (c.stray || []).includes("network_services.xml") ? `<button type="button" class="small" data-cemu="custom" title="network_services.xml (for example SmmServer)">Custom (network_services.xml)</button>` : ""}
      <button type="button" class="small ghost" data-cemu="offline"${c.service === "Offline" ? " disabled" : ""}>Offline</button>
      <div class="ol-import" hidden>
        <label class="small">Folder with your otp.bin and seeprom.bin (a Dumpling dump, or pretendo-docker's online-files)
          <input type="text" class="ol-from" placeholder="e.g. D:\\wiiu\\dumps\\online" spellcheck="false"></label>
        <button type="button" class="small primary" data-cemu="import-go">Copy into Cemu</button>
      </div>
      <div class="ol-own" hidden>
        <label class="small">Your Pretendo server (pretendo-docker), as http://address:port
          <input type="text" class="ol-proxy" placeholder="http://192.168.1.20:8080" value="${esc(c.proxy || "")}" spellcheck="false"></label>
        <button type="button" class="small primary" data-cemu="own-go">Use my server</button>
      </div>
      <p class="muted small">Close Cemu first: it rewrites its settings when it exits. Anything replaced is backed up in Retro Hub's backup folder.</p>
    </div>`;
  }

  function render() {
    const list = $("online-list"); if (!list) return;
    if (!data) { list.innerHTML = `<p class="muted">Couldn't check the emulators.</p>`; return; }
    const lim = limitedRows();
    $("online-summary").innerHTML = lim.length
      ? `⚠️ <b>Limited use until set up:</b> ${lim.map(e => esc(`${e.consoles} (${e.service})`)).join(", ")}. The games' own online modes won't connect yet. <b>Retro Hub co-op still works for every console.</b>`
      : `✅ Every installed emulator that Retro Hub can check is set up. Retro Hub co-op works for every console.`;
    const order = ["limited", "partial", "unknown", "guide", "ready", "builtin", "none", "missing"];
    const rows = [...data.emulators].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
    list.innerHTML = `<article class="ol-card ol-ok"><header><b>${esc(data.hub.label)}</b><span class="muted small">${esc(data.hub.consoles)}</span><span class="spacer"></span>
      <span class="ol-state">✅ Always on</span></header><div class="ol-service muted">${esc(data.hub.gives)}</div></article>` + rows.map(card).join("");
  }

  async function cemuAction(body, okMsg) {
    if (busy) return; busy = true;
    try {
      const r = await fetch("/api/online/cemu", { method: "POST", headers: { "Content-Type": "application/json", "X-Retro-Hub": "online" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || `Request failed (${r.status})`);
      toast(okMsg(j), { kind: "ok", ms: 7000 });
      await load(); render(); renderButton();
    } catch (e) { toast(e.message, { kind: "bad", ms: 8000 }); }
    finally { busy = false; }
  }
  const copiedMsg = j => `Copied ${[...(j.copied || []), ...(j.accounts?.length ? [`account ${j.accounts.join(", ")}`] : [])].join(", ") || "nothing"} to ${j.to}.${j.backup ? " Old files are in the backup folder." : ""}`;
  function onClick(e) {
    const cp = e.target.closest("[data-copy]");
    if (cp) { window.RH.UI.copy(cp.dataset.copy, `Copied ${cp.dataset.copy}`); return; }
    const dn = e.target.closest("[data-dolphin=netplay]");
    if (dn) {
      const box = dn.closest(".ol-dolphin");
      const hostCode = box.querySelector(".ol-hostcode").value.trim(), ping = Number(box.querySelector(".ol-ping").value) || 0;
      if (hostCode && !/^[0-9a-f]{8}$/i.test(hostCode)) return toast("A Dolphin host code is 8 characters (0-9, a-f).", { kind: "bad" });
      (async () => {
        try {
          const r = await fetch("/api/online/dolphin-netplay", { method: "POST", headers: { "Content-Type": "application/json", "X-Retro-Hub": "online" },
            body: JSON.stringify({ hostCode, ping }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
          toast(`Dolphin is opening${j.buffer ? ` (pad buffer ${j.buffer})` : ""}. ${hostCode ? "Tools → Start NetPlay → Connect: the code is filled in." : "Tools → Start NetPlay → Host, then send your host code in the lobby chat."}`, { kind: "ok", ms: 9000 });
        } catch (err) { toast(err.message, { kind: "bad", ms: 8000 }); }
      })();
      return;
    }
    const b = e.target.closest("[data-cemu]"); if (!b) return;
    const box = b.closest(".ol-tools"), a = b.dataset.cemu;
    if (a === "move") {
      if (!confirm("Copy otp.bin, seeprom.bin, network_services.xml and the Wii U accounts from Cemu's program folder to the folder Cemu reads? An account with the same number there is replaced (backed up first).")) return;
      cemuAction({ action: "import", from: "" }, copiedMsg);
    } else if (a === "import") { box.querySelector(".ol-import").hidden = false; box.querySelector(".ol-from").focus(); }
    else if (a === "import-go") {
      const from = box.querySelector(".ol-from").value.trim();
      if (!from) return toast("Type the folder that has your otp.bin and seeprom.bin.", { kind: "bad" });
      cemuAction({ action: "import", from }, copiedMsg);
    }
    else if (a === "own") { box.querySelector(".ol-own").hidden = false; box.querySelector(".ol-proxy").focus(); }
    else if (a === "own-go") cemuAction({ action: "service", service: "pretendo", proxy: box.querySelector(".ol-proxy").value.trim() },
      () => "Cemu now uses Pretendo through your own server. Your files must have been made by that server.");
    else if (a === "pretendo") cemuAction({ action: "service", service: "pretendo", proxy: "" }, () => "Cemu now uses Pretendo Network, online mode on.");
    else if (a === "custom") cemuAction({ action: "service", service: "custom", proxy: "" }, () => "Cemu now uses the Custom service from network_services.xml.");
    else if (a === "offline") cemuAction({ action: "service", service: "offline" }, () => "Cemu is offline now.");
  }

  async function open(focusId) {
    await load(); render(); renderButton();
    Modal.open($("online-dlg"));
    if (focusId) $("online-list").querySelector(`[data-emu="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: "start" });
  }
  // When a native console is hosted: one short line if its emulator's online isn't set up (checked ones only).
  function launchNote(system) {
    const e = (data?.emulators || []).find(x => x.installed && x.state === "limited" && (x.systems || []).includes(system));
    if (!e) return;
    toast(`${e.service}: ${e.limited || "not set up."}`, { kind: "bad", ms: 9000, action: { label: "Set up", run: () => open(e.id) } });
  }

  async function start() {
    if (!$("online-btn")) return;
    $("online-btn").addEventListener("click", () => open());
    $("online-close").addEventListener("click", () => Modal.close($("online-dlg")));
    $("online-refresh").addEventListener("click", async () => { await load(); render(); renderButton(); });
    $("online-list").addEventListener("click", onClick);
    $("online-list").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches(".ol-from, .ol-proxy")) {
      e.preventDefault(); e.target.closest(".ol-tools").querySelector(e.target.matches(".ol-from") ? "[data-cemu=import-go]" : "[data-cemu=own-go]").click(); } });
    if (!(await load())) return;
    renderButton();
    // Tell the owner once (and again only when the list changes) which consoles are limited until set up.
    const lim = limitedRows(), sig = lim.map(e => e.id).sort().join(",");
    if (lim.length && Settings.get("onlineNoted") !== sig) {
      Settings.set("onlineNoted", sig);
      toast(`Online for ${lim.map(e => e.consoles).join(", ")} is limited until it's set up. Retro Hub co-op works for every console.`,
        { ms: 10000, action: { label: "See how", run: () => open() } });
    }
  }
  window.RH.Online = { open, launchNote, refresh: async () => { await load(); renderButton(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
