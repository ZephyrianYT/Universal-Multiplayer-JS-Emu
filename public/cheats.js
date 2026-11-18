// 🧩 Cheats: GameShark / Action Replay codes from Project64 (.cht with [CRC1-CRC2-C:XX] sections) and RetroArch
// (.cht with cheatN_desc / cheatN_code) files. Library games: the hub finds the files near the ROM (/api/cheats);
// any game: "Load a .cht file". Choices are saved per game in this browser and applied by app.js when the emulator
// starts (EmulatorJS gameManager.setCheat). Some ROM hacks need theirs: OoT Multiplayer only works with
// "4 Swords Codes" (4P) or "OoT 2 Player Codes" (2P) on.
(function () {
  "use strict";
  const { Settings, Modal, toast } = window.RH.UI;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- N64 cartridge id from the first 64 bytes (any byte order), like server-side core/library/cheats.mjs
  async function n64IdFromFile(file) {
    const h = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (h[0] === 0x37) for (let i = 0; i < 64; i += 2) { const t = h[i]; h[i] = h[i + 1]; h[i + 1] = t; }
    else if (h[0] === 0x40) for (let i = 0; i < 64; i += 4) { let t = h[i]; h[i] = h[i + 3]; h[i + 3] = t; t = h[i + 1]; h[i + 1] = h[i + 2]; h[i + 2] = t; }
    if (h[0] !== 0x80) return null;
    const hex = (o, n) => Array.from(h.slice(o, o + n), b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    return { crc1: hex(16, 4), crc2: hex(20, 4), country: h[0x3e].toString(16).toUpperCase().padStart(2, "0") };
  }

  // ---- parsing. Returns [{ name, group, label, code, note, options }]; code uses "+" between lines (libretro format).
  const unq = s => String(s).trim().replace(/^"(.*)"$/, "$1");
  // Project64 1.7-3.x: CheatN="Group\Name",code,code  CheatN_N=note  CheatN_O=$01 option,…
  // Project64 4 / Rosalie's Mupen GUI: "$Group\Name" then Note=… / Options=… then one "XXXXXXXX YYYY" code per line.
  function parsePJ64(text, id) {
    const out = [];
    let on = false, n = 0, cur = null;
    const raw = new Map();                         // N -> { name, codes, note, options }
    const opts = v => v.split(",").map(o => /^\$([0-9A-F]+)\s*(.*)$/i.exec(o.trim())).filter(Boolean).map(o => ({ value: o[1], label: o[2] || o[1] }));
    for (const line of text.split(/\r?\n/)) {
      const sec = /^\s*\[([0-9A-F]{8})-([0-9A-F]{8})-C:([0-9A-F]{2})\]\s*$/i.exec(line);
      if (sec) { on = !!id && sec[1].toUpperCase() === id.crc1 && sec[2].toUpperCase() === id.crc2; cur = null; continue; }
      if (/^\s*\[/.test(line)) { on = false; cur = null; continue; }
      if (!on) continue;
      const dollar = /^\s*\$(.+?)\s*$/.exec(line);
      if (dollar) { cur = { name: dollar[1], codes: [], note: "", options: null }; raw.set("d" + (n++), cur); continue; }
      if (cur) {
        let mm = /^\s*Note\s*=\s*(.*)$/i.exec(line);
        if (mm) { cur.note = mm[1].trim(); continue; }
        mm = /^\s*Options\s*=\s*(.*)$/i.exec(line);
        if (mm) { cur.options = opts(mm[1]); continue; }
        mm = /^\s*([0-9A-F]{8}\s+[0-9A-F?]{4})\s*$/i.exec(line);
        if (mm) { cur.codes.push(mm[1].replace(/\s+/, " ")); continue; }
      }
      let m = /^\s*Cheat(\d+)\s*=\s*"([^"]*)"\s*,?(.*)$/.exec(line);
      if (m) { raw.set(m[1], { ...(raw.get(m[1]) || {}), name: m[2], codes: m[3].trim() }); continue; }
      m = /^\s*Cheat(\d+)_N\s*=\s*(.*)$/.exec(line);
      if (m) { raw.set(m[1], { ...(raw.get(m[1]) || {}), note: m[2].trim() }); continue; }
      m = /^\s*Cheat(\d+)_O\s*=\s*(.*)$/.exec(line);
      if (m && m[2].trim()) raw.set(m[1], { ...(raw.get(m[1]) || {}), options: m[2].split(",").map(o => /^\$([0-9A-F]+)\s*(.*)$/i.exec(o.trim())).filter(Boolean).map(o => ({ value: o[1], label: o[2] || o[1] })) });
    }
    for (const [, c] of raw) if (Array.isArray(c.codes)) c.codes = c.codes.join(",");    // "$" entries: same shape as CheatN
    for (const [, c] of [...raw].sort((a, b) => (a[0][0] === "d") - (b[0][0] === "d") || parseInt(a[0].replace("d", ""), 10) - parseInt(b[0].replace("d", ""), 10))) {
      if (!c.name || !c.codes) continue;               // headers / notes without codes
      const parts = c.name.split("\\");
      out.push({ name: c.name, group: parts.length > 1 ? parts[0] : "", label: parts.length > 1 ? parts.slice(1).join(" › ") : c.name,
        code: c.codes.split(",").map(s => s.trim()).filter(Boolean).join("+"), note: c.note || "", options: c.options || null });
    }
    return out;
  }
  function parseRetroArch(text) {
    const kv = {};
    for (const line of text.split(/\r?\n/)) { const m = /^\s*(cheat\d+_(desc|code|enable))\s*=\s*(.*)$/i.exec(line); if (m) kv[m[1].toLowerCase()] = unq(m[3]); }
    const out = [];
    for (let i = 0; kv[`cheat${i}_desc`] !== undefined || kv[`cheat${i}_code`] !== undefined; i++) {
      const code = (kv[`cheat${i}_code`] || "").trim();
      if (!code) continue;
      const name = kv[`cheat${i}_desc`] || `Cheat ${i + 1}`;
      out.push({ name, group: "", label: name, code, note: "", options: null, on: /^true$/i.test(kv[`cheat${i}_enable`] || "") });
    }
    return out;
  }
  const isRetroArch = t => /^\s*cheat\d+_code\s*=/im.test(t);
  const norm = s => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "");
  // files: [{ name, text }] ; id: N64 id or null ; gameName: for RetroArch files (named after the game)
  function parseFiles(files, id, gameName) {
    const lists = [];
    for (const f of files) {
      let list = [];
      if (isRetroArch(f.text)) { const base = String(f.name).split(/[\\/]/).pop(); if (!gameName || f.loaded || norm(base) === norm(gameName)) list = parseRetroArch(f.text); }
      else list = parsePJ64(f.text, id);
      if (list.length) lists.push({ file: f.name, cheats: list });
    }
    return lists;
  }

  // ---- saved choices: Settings "cheats" { gameKey: [{ name, code }] }
  const saved = key => (Settings.get("cheats") || {})[key] || [];
  function save(key, list) { Settings.patch("cheats", { [key]: list }); }
  // Turn the saved codes on in a running EmulatorJS game.
  function apply(gm, list) {
    if (!gm) return 0;
    try { gm.resetCheat?.(); } catch {}
    let n = 0;
    (list || []).forEach((c, i) => { try { gm.setCheat(i, 1, c.code); n++; } catch (e) { console.warn("cheat", c.name, e); } });
    return n;
  }
  const summary = list => {
    const groups = [...new Set((list || []).map(c => c.name.split("\\")[0]))];
    return groups.length > 3 ? `${groups.slice(0, 3).join(", ")} +${groups.length - 3}` : groups.join(", ");
  };

  // ---- dialog
  let dlg = null, ctx = null, lists = [];
  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "wide cheats-dlg"; dlg.setAttribute("aria-labelledby", "ch-title");
    dlg.innerHTML = `
      <h2 id="ch-title">🧩 Cheats</h2>
      <p class="small muted" id="ch-sub"></p>
      <div class="row"><label class="btn small file-btn"><input type="file" id="ch-file" accept=".cht,.txt"> Load a .cht file…</label>
        <span class="small muted" id="ch-count"></span></div>
      <div class="msg info small" id="ch-tip" hidden></div>
      <div class="ch-lists" id="ch-lists"></div>
      <div class="row end" style="margin-top:12px">
        <button class="ghost" id="ch-none" type="button">Turn all off</button><span class="grow"></span>
        <button class="ghost" id="ch-cancel" type="button">Cancel</button>
        <button class="primary" id="ch-save" type="button">Save</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector("#ch-cancel").onclick = () => Modal.close(dlg);
    dlg.querySelector("#ch-none").onclick = () => { dlg.querySelectorAll("[data-ch]").forEach(c => { c.checked = false; }); dlg.querySelectorAll("[data-grp]").forEach(c => { c.checked = false; c.indeterminate = false; }); count(); };
    dlg.querySelector("#ch-save").onclick = () => {
      const list = [];
      dlg.querySelectorAll("[data-ch]:checked").forEach(cb => {
        const c = lists[cb.dataset.l].cheats[cb.dataset.ch];
        let code = c.code;
        if (c.options) { const v = dlg.querySelector(`[data-opt="${cb.dataset.l}-${cb.dataset.ch}"]`)?.value; if (v) code = code.replace(/\?{2,}/g, m => v.padStart(m.length, "0").slice(-m.length)); }
        if (!/\?/.test(code)) list.push({ name: c.name, code });
      });
      save(ctx.key, list);
      Modal.close(dlg);
      toast(list.length ? `${list.length} cheat code${list.length === 1 ? "" : "s"} on for ${ctx.name}.` : `Cheats off for ${ctx.name}.`, { kind: "ok", ms: 3500 });
      ctx.onSave?.(list);
    };
    dlg.querySelector("#ch-file").addEventListener("change", async e => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      const more = parseFiles([{ name: f.name, text: await f.text(), loaded: true }], ctx.id, ctx.name);
      if (!more.length) return toast(ctx.id ? "No codes for this game in that file (its sections are for other games)." : "No cheat codes found in that file.", { kind: "bad", ms: 5000 });
      lists = lists.concat(more); render();
    });
    dlg.addEventListener("change", e => {
      const g = e.target.dataset?.grp;
      if (g != null) dlg.querySelectorAll(`[data-ch][data-g="${CSS.escape(g)}"]`).forEach(c => { c.checked = e.target.checked; });
      if (e.target.dataset?.ch != null || g != null) count();
    });
  }
  function count() {
    const n = dlg.querySelectorAll("[data-ch]:checked").length;
    dlg.querySelector("#ch-count").textContent = `${n} selected`;
    // group boxes: on / off / partly
    dlg.querySelectorAll("[data-grp]").forEach(gb => {
      const all = [...dlg.querySelectorAll(`[data-ch][data-g="${CSS.escape(gb.dataset.grp)}"]`)], on = all.filter(c => c.checked).length;
      gb.checked = on > 0 && on === all.length; gb.indeterminate = on > 0 && on < all.length;
    });
    const names = [...dlg.querySelectorAll("[data-ch]:checked")].map(cb => lists[cb.dataset.l].cheats[cb.dataset.ch].name);
    const tip = dlg.querySelector("#ch-tip");
    const oot2 = names.some(n => /^OoT 2 Player Codes/i.test(n)), oot4 = names.some(n => /^4 Swords Codes/i.test(n));
    tip.hidden = !(oot2 || oot4);
    tip.textContent = oot2 && oot4 ? "OoT Multiplayer: use either \"4 Swords Codes\" (4 players) or \"OoT 2 Player Codes\" (2 players), not both."
      : oot2 ? "OoT Multiplayer, 2 players: Player 2 is controller 4, so your friend takes the P4 seat in the lobby."
      : "OoT Multiplayer, 4 players: players take seats P1-P4 as usual.";
  }
  function render() {
    const on = new Set(saved(ctx.key).map(c => c.name));
    dlg.querySelector("#ch-lists").innerHTML = lists.length ? lists.map((L, li) => {
      const groups = new Map();
      L.cheats.forEach((c, ci) => { const g = c.group || ""; if (!groups.has(g)) groups.set(g, []); groups.get(g).push([c, ci]); });
      return `<div class="sys-group">${esc(L.file)}</div>` + [...groups].map(([g, items]) => `
        <div class="ch-group">${g ? `<label class="check ch-ghead"><input type="checkbox" data-grp="${esc(li + ":" + g)}"> <b>${esc(g)}</b> <span class="small muted">(${items.length})</span></label>` : ""}
          <ul class="ch-items">${items.map(([c, ci]) => `<li><label class="check"><input type="checkbox" data-l="${li}" data-ch="${ci}" data-g="${esc(li + ":" + g)}"${on.has(c.name) || (!on.size && c.on) ? " checked" : ""}> ${esc(c.label)}</label>
            ${c.options ? `<select data-opt="${li}-${ci}" class="ch-opt">${c.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select>` : ""}
            ${c.note ? `<div class="small muted ch-note">${esc(c.note)}</div>` : ""}</li>`).join("")}</ul></div>`).join("");
    }).join("") : `<p class="small muted">No cheat codes found${ctx.libPath ? " next to this game (or in its console folder)" : ""}. Load a .cht file (Project64 or RetroArch format).</p>`;
    count();
  }
  // ctx: { key, name, system, libPath?, file?, onSave(list) }
  async function open(c) {
    if (!dlg) build();
    ctx = { ...c, id: null }; lists = [];
    dlg.querySelector("#ch-sub").textContent = `${c.name}: codes are applied when the game starts (and right away if it's running). Some ROM hacks need theirs switched on.`;
    dlg.querySelector("#ch-lists").innerHTML = '<p class="small muted">Looking for cheat files…</p>';
    Modal.open(dlg, { focus: "#ch-save" });
    try {
      if (c.libPath) {
        const r = await fetch(`/api/cheats?path=${encodeURIComponent(c.libPath)}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null);
        if (r) { ctx.id = r.n64; lists = parseFiles(r.files || [], r.n64, c.name); }
      } else if (c.file && c.system === "n64") ctx.id = await n64IdFromFile(c.file);
    } catch {}
    render();
  }
  window.RH = Object.assign(window.RH || {}, { Cheats: { open, saved, apply, summary, parseFiles, parsePJ64 } });
})();
