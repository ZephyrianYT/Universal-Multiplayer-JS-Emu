// Retro Hub Messenger: buddies and instant messages in the style of a classic 90s/2000s messenger (Buddy List
// window, IM windows, away messages, profiles, buddy icons, warnings, door sounds). Replaces the old Friends panel.
//
// Same rules as before: you add people by their account ID (or find them with Find a Buddy); the hub only shows
// two people to each other, and only relays IMs between them, once BOTH have added each other. The buddy list,
// groups, away messages and profile live in this browser, per account. The hub keeps nothing: it relays.
// Sounds are synthesized here (no recorded sound files); no logos or names of the original service are used.
//
// API kept from friends.js for app.js: RH.Friends.start(me), setRoom(code), onJoin(fn), isFriend(id), add(id, name),
// parseId(s), friendsIn(code). Fires "rh-friends" on window when the list or presence changes.
(function () {
  "use strict";
  const { Settings, toast } = window.RH.UI;
  const { prettyId } = window.RH;
  const ID_RE = /^[0-9A-F]{16}$/;
  const parseId = s => { const h = String(s || "").toUpperCase().replace(/[^0-9A-F]/g, ""); return ID_RE.test(h) ? h : ""; };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const DEFAULT_GROUP = "Buddies";
  const ICONS = ["🦆", "😎", "👾", "🎮", "🕹️", "🐱", "🐶", "🦊", "🐸", "🐼", "🦄", "🐉", "👽", "🤖", "💀", "🎸", "⚡", "🔥", "🌈", "🍕", "🌮", "🍩", "⭐", "🌙", "🏎️", "🚀", "🛹", "🏀", "⚽", "🎃", "👻", "🧙"];
  const SMILEYS = ["🙂", "😉", "😛", "😄", "😮", "😢", "😠", "😎", "😇", "😳", "🤔", "😴", "❤️", "👍", "😂", "🙄"];
  const AWAY_PRESETS = ["I'm away from my computer right now.", "brb", "Playing a game, talk later!", "Out to lunch.", "Sleeping. zzz"];

  let myId = "", myName = "", ws = null, retry = 1500, inRoom = null, joinFn = null, started = false;
  let presence = { friends: [], requests: [] }, prevOnline = new Map(), firstPresence = true;
  let idle = false, lastInput = Date.now();

  // ---------------------------------------------------------------- stored state (per account, this browser)
  const store = () => Settings.get("friends") || {};
  const mine = () => ({ list: [], ignored: [], hidden: false, groups: [DEFAULT_GROUP], away: "", awayPresets: AWAY_PRESETS.slice(),
    profile: "", icon: "", sound: true, popups: true, times: false, ...(store()[myId] || {}) });
  function save(patch, { quiet = false } = {}) {
    const all = store(); all[myId] = { ...mine(), ...patch }; Settings.set("friends", all);
    if (!quiet) { sendState(); renderAll(); window.dispatchEvent(new Event("rh-friends")); }
  }
  const list = () => mine().list || [];
  const groupsOf = () => { const g = mine().groups?.length ? mine().groups.slice() : [DEFAULT_GROUP]; for (const f of list()) if (f.group && !g.includes(f.group)) g.push(f.group); return g; };
  const buddy = id => list().find(f => f.id === id);
  const isFriend = id => list().some(f => f.id === id);
  const online = id => presence.friends.find(p => p.id === id);
  const nameOf = id => online(id)?.name || buddy(id)?.name || "#" + prettyId(id);

  function add(id, name, group) {
    id = parseId(id);
    if (!id) return { ok: false, msg: "That isn't an account ID. It looks like #9FD5-A732-4F9D-42EA (16 letters and numbers)." };
    if (id === myId) return { ok: false, msg: "That's your own ID." };
    if (isFriend(id)) return { ok: false, msg: "Already on your Buddy List." };
    if (list().length >= 200) return { ok: false, msg: "Your Buddy List is full (200)." };
    const g = String(group || "").trim().slice(0, 24) || groupsOf()[0] || DEFAULT_GROUP;
    save({ list: [...list(), { id, name: String(name || "").slice(0, 20), group: g, added: Date.now() }],
      ignored: (mine().ignored || []).filter(x => x !== id), groups: groupsOf().includes(g) ? groupsOf() : [...groupsOf(), g] });
    return { ok: true };
  }
  const remove = id => save({ list: list().filter(f => f.id !== id) });
  const block = id => save({ list: list().filter(f => f.id !== id), ignored: [...new Set([...(mine().ignored || []), id])].slice(-200) });

  // ---------------------------------------------------------------- sounds (synthesized, no recordings)
  let actx = null;
  function tone(seq) {
    if (!mine().sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.__rhNoTap = true;
      if (actx.state === "suspended") actx.resume();
      const t0 = actx.currentTime;
      for (const [f0, f1, start, dur, type = "triangle", gain = 0.12] of seq) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type; o.frequency.setValueAtTime(f0, t0 + start); o.frequency.exponentialRampToValueAtTime(f1, t0 + start + dur);
        g.gain.setValueAtTime(0, t0 + start); g.gain.linearRampToValueAtTime(gain, t0 + start + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
        o.connect(g); g.connect(actx.destination); o.start(t0 + start); o.stop(t0 + start + dur + 0.02);
      }
    } catch {}
  }
  const SND = {
    on: () => tone([[300, 520, 0, 0.18, "sawtooth", 0.05], [520, 780, 0.16, 0.22, "triangle", 0.1]]),           // a door creaking open
    off: () => tone([[700, 420, 0, 0.16, "triangle", 0.1], [300, 120, 0.12, 0.2, "square", 0.05]]),             // ...and shutting
    im: () => tone([[880, 880, 0, 0.07, "sine", 0.14], [1320, 1320, 0.08, 0.12, "sine", 0.12]]),
    sent: () => tone([[1200, 900, 0, 0.06, "sine", 0.06]]),
    warn: () => tone([[200, 140, 0, 0.35, "sawtooth", 0.08]]),
  };

  // ---------------------------------------------------------------- presence socket
  function sendState() {
    if (ws?.readyState !== 1) return;
    const m = mine();
    ws.send(JSON.stringify({ t: "friends", ids: list().map(f => f.id), hidden: !!m.hidden, away: m.away || "", idle, profile: m.profile || "", icon: m.icon || "" }));
  }
  const wsSend = obj => { if (ws?.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; };
  function connect() {
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws.onopen = () => { retry = 1500; sendState(); setConn(true); };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === "presence") onPresence(m);
      else if (m.t === "im") onIm(m);
      else if (m.t === "im-result") onImResult(m);
      else if (m.t === "typing") onTyping(m);
      else if (m.t === "info") onInfo(m);
      else if (m.t === "found") onFound(m);
      else if (m.t === "warned") { SND.warn(); toast(`${m.by} warned you. Your warning level is now ${m.level}%.`, { kind: "bad", ms: 6000 }); }
      else if (m.t === "warn-result") toast(m.ok ? `${nameOf(m.id)} was warned (now ${m.level}%).` : m.msg, { kind: m.ok ? "ok" : "bad", ms: 3500 });
      else if (m.t === "invite") onInvite(m);
      else if (m.t === "invite-result") { const w = imWins.get(m.to); if (w) sysLine(w, m.ok ? "Invite sent." : m.msg); else toast(m.ok ? "Invite sent." : m.msg, { kind: m.ok ? "ok" : "bad", ms: 3500 }); }
    };
    ws.onclose = () => { ws = null; setConn(false); setTimeout(connect, retry); retry = Math.min(retry * 2, 20000); };
  }
  function onPresence(m) {
    presence = { friends: m.friends || [], requests: m.requests || [] };
    const now = new Map(presence.friends.map(p => [p.id, p]));
    if (!firstPresence) {
      let on = false, off = false;
      for (const id of now.keys()) if (!prevOnline.has(id)) on = true;
      for (const id of prevOnline.keys()) if (!now.has(id)) off = true;
      if (on) SND.on(); else if (off) SND.off();
      for (const [id, p] of now) if (!prevOnline.has(id)) { const w = imWins.get(id); if (w) sysLine(w, `${p.name} signed on.`); }
      for (const [id, p] of prevOnline) if (!now.has(id)) { const w = imWins.get(id); if (w) sysLine(w, `${p.name} signed off.`); }
    }
    firstPresence = false; prevOnline = now;
    // remember current names for when they're offline
    let changed = false;
    const l = list().map(f => { const p = now.get(f.id); if (p && p.name !== f.name) { changed = true; return { ...f, name: p.name }; } return f; });
    if (changed) save({ list: l }, { quiet: true });
    renderAll();
    window.dispatchEvent(new Event("rh-friends"));
  }

  // ---------------------------------------------------------------- windows
  let zTop = 1000;
  const layer = el("div", "aim-layer");
  const dock = el("div", "aim-dock");
  function makeWin({ key, title, cls = "", w = 320, h = 0, x, y, onClose, minimizable = true, icon = "" }) {
    const win = el("section", "aim-win " + cls);
    win.setAttribute("role", "dialog"); win.setAttribute("aria-label", title);
    win.innerHTML = `<header class="aim-title"><span class="aim-ticon" aria-hidden="true"></span><span class="aim-ttext"></span>
      <span class="aim-tbtns">${minimizable ? `<button type="button" class="aim-tb" data-act="min" aria-label="Minimize" title="Minimize">_</button>` : ""}<button type="button" class="aim-tb" data-act="close" aria-label="Close" title="Close">✕</button></span></header>
      <div class="aim-body"></div>`;
    win.querySelector(".aim-ticon").textContent = icon;
    win.querySelector(".aim-ttext").textContent = title;
    win.style.width = w + "px"; if (h) win.style.height = h + "px";
    const pos = (Settings.get("aimPos") || {})[key];
    const vw = innerWidth, vh = innerHeight;
    const px = pos?.x ?? x ?? Math.max(8, vw - w - 30 - (layer.children.length % 6) * 24);
    const py = pos?.y ?? y ?? Math.max(60, 80 + (layer.children.length % 6) * 24);
    win.style.left = Math.min(Math.max(0, px), vw - 120) + "px"; win.style.top = Math.min(Math.max(0, py), vh - 40) + "px";
    const front = () => { win.style.zIndex = ++zTop; layer.querySelectorAll(".aim-win.active").forEach(x => x.classList.remove("active")); win.classList.add("active"); };
    win.addEventListener("pointerdown", front);
    // drag by the title bar
    const bar = win.querySelector(".aim-title");
    bar.addEventListener("pointerdown", e => {
      if (e.target.closest("button") || matchMedia("(max-width: 640px)").matches) return;
      const sx = e.clientX - win.offsetLeft, sy = e.clientY - win.offsetTop;
      bar.setPointerCapture(e.pointerId);
      const move = ev => {
        win.style.left = Math.min(Math.max(-win.offsetWidth + 80, ev.clientX - sx), innerWidth - 80) + "px";
        win.style.top = Math.min(Math.max(0, ev.clientY - sy), innerHeight - 30) + "px";
      };
      const up = () => {
        bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up);
        const all = Settings.get("aimPos") || {}; all[key] = { x: win.offsetLeft, y: win.offsetTop }; Settings.set("aimPos", all);
      };
      bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up);
    });
    const api = {
      el: win, body: win.querySelector(".aim-body"), key, minimized: false, dockBtn: null,
      setTitle(t) { win.querySelector(".aim-ttext").textContent = t; win.setAttribute("aria-label", t); if (api.dockBtn) api.dockBtn.querySelector("span").textContent = t; },
      front, show() { api.minimized = false; win.hidden = false; front(); api.dockBtn?.classList.remove("flash"); renderDock(); },
      minimize() { api.minimized = true; win.hidden = true; renderDock(); },
      close() { win.remove(); api.dockBtn?.remove(); onClose?.(); renderDock(); },
      flash() { if (api.minimized || win.hidden) api.dockBtn?.classList.add("flash"); else if (!win.classList.contains("active")) { win.classList.add("flash"); setTimeout(() => win.classList.remove("flash"), 1600); } },
    };
    win.querySelector(".aim-tbtns").addEventListener("click", e => {
      const a = e.target.closest("button")?.dataset.act;
      if (a === "min") api.minimize(); else if (a === "close") api.close();
    });
    win.addEventListener("keydown", e => { if (e.key === "Escape" && !e.target.closest(".aim-menu")) { e.stopPropagation(); minimizable ? api.minimize() : api.close(); } });
    api.dockBtn = el("button", "aim-dockbtn"); api.dockBtn.type = "button";
    api.dockBtn.innerHTML = `<i aria-hidden="true"></i><span></span>`;
    api.dockBtn.querySelector("i").textContent = icon; api.dockBtn.querySelector("span").textContent = title;
    api.dockBtn.onclick = () => (api.minimized || win.hidden) ? api.show() : (win.classList.contains("active") ? api.minimize() : api.front());
    layer.appendChild(win); front();
    return api;
  }
  function renderDock() {
    dock.textContent = "";
    if (!started) return;
    const blBtn = el("button", "aim-dockbtn aim-dock-bl"); blBtn.type = "button";
    const n = presence.friends.length, req = pendingRequests().length;
    blBtn.innerHTML = `<i aria-hidden="true">👥</i><span>Buddy List</span>${n || req ? `<b class="aim-count">${n}${req ? " · " + req + " new" : ""}</b>` : ""}`;
    blBtn.title = `Buddy List: ${n} online${req ? `, ${req} request${req === 1 ? "" : "s"}` : ""}`;
    blBtn.onclick = toggleBuddyList;
    dock.appendChild(blBtn);
    for (const w of imWins.values()) dock.appendChild(w.dockBtn);
    for (const w of otherWins.values()) if (w.minimized) dock.appendChild(w.dockBtn);
  }
  const otherWins = new Map();
  function single(key, make) {           // one window of a kind (Add Buddy, Find, Away...)
    const w = otherWins.get(key);
    if (w && document.contains(w.el)) { w.show(); return w; }
    const nw = make(); const close = nw.close;
    nw.close = () => { otherWins.delete(key); close(); };
    otherWins.set(key, nw);
    return nw;
  }

  // ---------------------------------------------------------------- Buddy List window
  let bl = null, blTab = "online", collapsed = new Set(Settings.get("aimCollapsed") || []), selected = null, connOk = false;
  const pendingRequests = () => presence.requests.filter(r => !isFriend(r.id) && !(mine().ignored || []).includes(r.id));
  function toggleBuddyList() {
    if (bl && document.contains(bl.el)) { if (bl.minimized || bl.el.hidden) bl.show(); else bl.minimize(); }
    else openBuddyList();
    Settings.set("aimBlOpen", !!(bl && !bl.minimized));
  }
  function openBuddyList() {
    if (bl && document.contains(bl.el)) return bl.show();
    bl = makeWin({ key: "bl", title: `${myName}'s Buddy List`, cls: "aim-bl", w: 250, h: 470, icon: "👥", onClose: () => { bl = null; Settings.set("aimBlOpen", false); } });
    const minimize = bl.minimize; bl.minimize = () => { minimize(); Settings.set("aimBlOpen", false); };
    bl.body.innerHTML = `
      <nav class="aim-menubar">
        <button type="button" data-menu="me">My Stuff</button><button type="button" data-menu="people">People</button><button type="button" data-menu="help">Help</button>
      </nav>
      <div class="aim-me">
        <span class="aim-myicon" title="Buddy icon (click to change)"></span>
        <div class="aim-mewho"><b class="trunc"></b><small class="aim-mestatus"></small></div>
      </div>
      <div class="aim-back" hidden><span>You are away.</span><button type="button" class="aim-btn" data-act="back">I'm Back</button></div>
      <div class="aim-tabs" role="tablist">
        <button type="button" role="tab" data-tab="online">Online</button><button type="button" role="tab" data-tab="setup">List Setup</button>
      </div>
      <div class="aim-tree" tabindex="0" aria-label="Buddies"></div>
      <div class="aim-conn" hidden>Connecting to the hub…</div>
      <footer class="aim-bar">
        <button type="button" data-act="im" title="Send an Instant Message"><i>💬</i>IM</button>
        <button type="button" data-act="info" title="Get the buddy's info"><i>ℹ️</i>Info</button>
        <button type="button" data-act="invite" title="Invite the buddy to your lobby"><i>🎮</i>Invite</button>
        <button type="button" data-act="away" title="Away message"><i>📝</i>Away</button>
        <button type="button" data-act="add" title="Add a buddy"><i>➕</i>Add</button>
      </footer>`;
    bl.body.addEventListener("click", blClick);
    bl.body.addEventListener("dblclick", e => { const r = e.target.closest("[data-id]"); if (r) openIm(r.dataset.id); });
    bl.body.addEventListener("contextmenu", e => { const r = e.target.closest("[data-id]"); if (!r) return; e.preventDefault(); select(r.dataset.id); buddyMenu(r.dataset.id, e.clientX, e.clientY); });
    bl.body.querySelector(".aim-tree").addEventListener("keydown", e => {
      const rows = [...bl.body.querySelectorAll(".aim-tree [data-id]")]; if (!rows.length) return;
      let i = rows.findIndex(r => r.dataset.id === selected);
      if (e.key === "ArrowDown") i = Math.min(rows.length - 1, i + 1); else if (e.key === "ArrowUp") i = Math.max(0, i - 1);
      else if (e.key === "Enter" && selected) return openIm(selected); else return;
      e.preventDefault(); select(rows[i].dataset.id); rows[i].scrollIntoView({ block: "nearest" });
    });
    Settings.set("aimBlOpen", true);
    renderBuddyList(); renderDock();
  }
  function select(id) { selected = id; bl?.body.querySelectorAll(".aim-tree [data-id]").forEach(r => r.classList.toggle("sel", r.dataset.id === id)); }
  function statusText(p) {
    if (!p) return "Offline";
    const bits = [];
    if (p.away) bits.push("Away"); else if (p.idle) bits.push("Idle");
    if (p.room) bits.push(`${p.state === "playing" ? "Playing" : "In a lobby"}: ${p.game || "a game"}${p.locked ? " 🔒" : ""}`);
    if (p.warn) bits.push(`warned ${p.warn}%`);
    return bits.join(" · ") || "Available";
  }
  function buddyRow(f, p) {
    const row = el("div", "aim-buddy" + (p ? " on" : " off") + (p?.away ? " away" : "") + (p?.idle ? " idle" : "") + (selected === f.id ? " sel" : ""));
    row.dataset.id = f.id; row.tabIndex = -1; row.setAttribute("role", "treeitem");
    row.title = `${f.name || "Buddy"} #${prettyId(f.id)}\n${statusText(p)}${p?.away ? "\nAway: " + p.away : ""}`;
    const ic = el("span", "aim-bicon", p?.icon || (p ? "🙂" : "")); ic.setAttribute("aria-hidden", "true");
    const nm = el("span", "aim-bname trunc", f.name || "#" + prettyId(f.id));
    row.append(ic, nm);
    if (p?.away) row.appendChild(el("span", "aim-flag", "📝"));
    if (p?.room) row.appendChild(el("span", "aim-flag", p.state === "playing" ? "🎮" : "🚪"));
    if (p?.warn) row.appendChild(el("span", "aim-warnpct", p.warn + "%"));
    return row;
  }
  function renderBuddyList() {
    if (!bl || !document.contains(bl.el)) return;
    const m = mine(), b = bl.body;
    bl.setTitle(`${myName}'s Buddy List`);
    b.querySelector(".aim-myicon").textContent = m.icon || "🙂";
    b.querySelector(".aim-mewho b").textContent = myName;
    b.querySelector(".aim-mestatus").textContent = m.hidden ? "Invisible (appear offline)" : m.away ? "Away: " + m.away : idle ? "Idle" : "Available";
    b.querySelector(".aim-back").hidden = !m.away;
    b.querySelectorAll(".aim-tabs button").forEach(t => t.setAttribute("aria-selected", String(t.dataset.tab === blTab)));
    b.querySelector(".aim-conn").hidden = connOk;
    const tree = b.querySelector(".aim-tree"); tree.textContent = ""; tree.setAttribute("role", "tree");
    const groups = groupsOf(), req = pendingRequests();
    const group = (name, items, { count, cls = "", setup = false } = {}) => {
      const g = el("div", "aim-group " + cls);
      const h = el("button", "aim-ghead"); h.type = "button"; h.dataset.group = name;
      const open = !collapsed.has(name);
      h.setAttribute("aria-expanded", String(open));
      h.innerHTML = `<span class="aim-caret" aria-hidden="true">${open ? "▾" : "▸"}</span><span></span><small></small>`;
      h.querySelector("span:nth-child(2)").textContent = name; h.querySelector("small").textContent = count;
      g.appendChild(h);
      if (open) for (const it of items) g.appendChild(it);
      if (setup && open && !items.length) g.appendChild(el("div", "aim-empty", "(empty)"));
      tree.appendChild(g);
    };
    if (req.length) group("Buddy Requests", req.map(r => {
      const row = el("div", "aim-req");
      row.innerHTML = `<span class="trunc"></span><button type="button" class="aim-btn" data-accept="${esc(r.id)}">Add</button><button type="button" class="aim-btn" data-ignore="${esc(r.id)}">Ignore</button>`;
      row.querySelector("span").textContent = r.name; row.title = `${r.name} #${prettyId(r.id)} added you`;
      row.querySelector("[data-accept]").dataset.name = r.name;
      return row;
    }), { count: `(${req.length})`, cls: "aim-reqs" });
    const sorted = arr => arr.slice().sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    if (blTab === "online") {
      for (const g of groups) {
        const inG = list().filter(f => (f.group || groups[0]) === g);
        const on = sorted(inG.filter(f => online(f.id)));
        group(g, on.map(f => buddyRow(f, online(f.id))), { count: `(${on.length}/${inG.length})` });
      }
      const off = sorted(list().filter(f => !online(f.id)));
      group("Offline", off.map(f => buddyRow(f, null)), { count: `(${off.length}/${list().length})`, cls: "aim-offline" });
      if (!list().length) tree.appendChild(el("p", "aim-hint", "No buddies yet. Use ➕ Add (or People → Find a Buddy) to add someone. You'll see each other once they add you back."));
    } else {
      for (const g of groups) {
        const inG = sorted(list().filter(f => (f.group || groups[0]) === g));
        group(g, inG.map(f => buddyRow(f, online(f.id))), { count: `(${inG.length})`, setup: true });
      }
      const tools = el("div", "aim-setup");
      tools.innerHTML = `<button type="button" class="aim-btn" data-act="add">Add Buddy</button><button type="button" class="aim-btn" data-act="addgroup">Add Group</button>
        <button type="button" class="aim-btn" data-act="find">Find a Buddy</button>`;
      tree.appendChild(tools);
      tree.appendChild(el("p", "aim-hint", "Right-click a buddy to move, rename or remove them. Right-click is also how you open a buddy's menu on the Online tab."));
    }
    if (selected) select(selected);
  }
  function blClick(e) {
    const t = e.target.closest("button, [data-id]"); if (!t) return;
    if (t.dataset.id) return select(t.dataset.id);
    if (t.dataset.tab) { blTab = t.dataset.tab; return renderBuddyList(); }
    if (t.dataset.group) {
      const g = t.dataset.group; collapsed.has(g) ? collapsed.delete(g) : collapsed.add(g);
      Settings.set("aimCollapsed", [...collapsed]); return renderBuddyList();
    }
    if (t.dataset.accept) { const r = add(t.dataset.accept, t.dataset.name); if (!r.ok) toast(r.msg, { kind: "bad" }); return; }
    if (t.dataset.ignore) return save({ ignored: [...(mine().ignored || []), t.dataset.ignore].slice(-200) });
    if (t.dataset.menu) return mainMenu(t.dataset.menu, t);
    const a = t.dataset.act;
    if (a === "back") return save({ away: "" });
    if (a === "add") return addWin();
    if (a === "addgroup") return addGroupWin();
    if (a === "find") return findWin();
    if (a === "away") return awayWin();
    if (a === "send" || !a) return;
    if (!selected && (a === "im" || a === "info" || a === "invite")) return toast("Pick a buddy first.", { ms: 1500 });
    if (a === "im") openIm(selected);
    else if (a === "info") infoWin(selected);
    else if (a === "invite") invite(selected);
  }
  document.addEventListener("click", e => { if (e.target.closest(".aim-myicon")) iconWin(); });

  // ---------------------------------------------------------------- menus
  let menuEl = null;
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  function showMenu(items, x, y) {
    closeMenu();
    menuEl = el("div", "aim-menu"); menuEl.setAttribute("role", "menu");
    for (const it of items) {
      if (it === "-") { menuEl.appendChild(el("hr")); continue; }
      const b = el("button", "", it.label); b.type = "button"; b.setAttribute("role", "menuitem"); b.disabled = !!it.disabled;
      if (it.check != null) b.classList.add(it.check ? "checked" : "unchecked");
      b.onclick = () => { closeMenu(); it.run(); };
      menuEl.appendChild(b);
    }
    menuEl.style.zIndex = ++zTop + 10;
    layer.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.min(x, innerWidth - r.width - 4) + "px"; menuEl.style.top = Math.min(y, innerHeight - r.height - 4) + "px";
    menuEl.querySelector("button:not(:disabled)")?.focus();
    menuEl.addEventListener("keydown", e => {
      const bs = [...menuEl.querySelectorAll("button:not(:disabled)")], i = bs.indexOf(document.activeElement);
      if (e.key === "Escape") { e.stopPropagation(); closeMenu(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
    });
  }
  document.addEventListener("pointerdown", e => { if (menuEl && !e.target.closest(".aim-menu") && !e.target.closest("[data-menu]")) closeMenu(); }, true);
  function mainMenu(which, btn) {
    const r = btn.getBoundingClientRect(), m = mine();
    if (which === "me") showMenu([
      { label: "My Profile…", run: profileWin },
      { label: "Away Message…", run: awayWin },
      { label: "Buddy Icon…", run: iconWin },
      "-",
      { label: "Appear offline (invisible)", check: !!m.hidden, run: () => save({ hidden: !m.hidden }) },
      { label: "Sounds", check: m.sound !== false, run: () => save({ sound: m.sound === false }, { quiet: true }) },
      { label: "Pop up new IMs", check: m.popups !== false, run: () => save({ popups: m.popups === false }, { quiet: true }) },
      { label: "Show times in IMs", check: !!m.times, run: () => { save({ times: !m.times }, { quiet: true }); imWins.forEach(w => w.el.classList.toggle("times", !m.times)); } },
      "-",
      { label: "Copy my ID", run: () => window.RH.UI.copy("#" + prettyId(myId), "Your ID is copied. Send it to a friend so they can add you.") },
    ], r.left, r.bottom);
    else if (which === "people") showMenu([
      { label: "Send Instant Message…", run: () => selected ? openIm(selected) : toast("Pick a buddy first.", { ms: 1500 }) },
      { label: "Get Buddy Info", disabled: !selected, run: () => infoWin(selected) },
      { label: "Invite to my lobby", disabled: !selected || !inRoom, run: () => invite(selected) },
      "-",
      { label: "Add Buddy…", run: addWin },
      { label: "Add Group…", run: addGroupWin },
      { label: "Find a Buddy…", run: findWin },
    ], r.left, r.bottom);
    else showMenu([
      { label: "How buddies work", run: () => toast("Add someone by their ID (next to their name at the top of the hub) or with Find a Buddy. You see each other, and can IM, once both of you have added each other. Nothing is stored on the hub.", { ms: 12000 }) },
      { label: "Keys: double-click or Enter opens an IM; right-click a buddy for more", run: () => {} },
    ], r.left, r.bottom);
  }
  function buddyMenu(id, x, y) {
    const p = online(id), f = buddy(id);
    showMenu([
      { label: "Send Instant Message", run: () => openIm(id) },
      { label: "Get Info", run: () => infoWin(id) },
      { label: p?.room && p.room !== inRoom ? (p.state === "playing" ? "Watch / join their game" : "Join their lobby") : "Join their lobby", disabled: !(p?.room && p.room !== inRoom), run: () => goJoin(p.room) },
      { label: "Invite to my lobby", disabled: !p || !inRoom || p.room === inRoom, run: () => invite(id) },
      "-",
      { label: "Rename…", disabled: !f, run: () => { const n = prompt("Show this buddy as:", f.name || ""); if (n != null) save({ list: list().map(b => b.id === id ? { ...b, name: n.trim().slice(0, 20) || b.name } : b) }); } },
      ...(groupsOf().length > 1 ? [{ label: "Move to group…", disabled: !f, run: () => moveWin(id) }] : []),
      { label: "Copy their ID", run: () => window.RH.UI.copy("#" + prettyId(id), "ID copied.") },
      "-",
      { label: "Warn…", disabled: !p, run: () => warn(id) },
      { label: "Block", run: () => { if (confirm(`Block ${nameOf(id)}? They're removed from your Buddy List and can't IM you or see you online.`)) { block(id); imWins.get(id)?.close(); } } },
      { label: "Remove from Buddy List", disabled: !f, run: () => { if (confirm(`Remove ${nameOf(id)} from your Buddy List?`)) remove(id); } },
    ], x, y);
  }

  // ---------------------------------------------------------------- IM windows
  const imWins = new Map();                // buddy id -> window api + { log, input, typingEl }
  const HIST_KEY = "rh-im";
  const hist = (() => { try { return JSON.parse(sessionStorage.getItem(HIST_KEY) || "{}") || {}; } catch { return {}; } })();
  const saveHist = () => { try { sessionStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch {} };
  function record(id, entry) { (hist[id] = hist[id] || []).push(entry); if (hist[id].length > 100) hist[id].splice(0, hist[id].length - 100); saveHist(); }
  function lineEl(entry) {
    const li = el("div", "aim-line " + (entry.sys ? "sys" : entry.mine ? "me" : "them") + (entry.auto ? " auto" : "") + (entry.fail ? " fail" : ""));
    if (entry.sys) { li.textContent = entry.text; return li; }
    const t = el("time", "", new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    const who = el("b", "", (entry.auto ? "Auto response from " : "") + entry.name);
    const txt = el("span", "aim-txt", entry.text);
    if (window.RH.Emotes) window.RH.Emotes.render(txt, entry.text);
    li.append(t, who, document.createTextNode(": "), txt);
    if (entry.fail) li.appendChild(el("em", "", " (not delivered: " + entry.fail + ")"));
    return li;
  }
  function openIm(id, { focus = true, quiet = false } = {}) {
    let w = imWins.get(id);
    if (w && document.contains(w.el)) { if (!quiet) { w.show(); if (focus) w.input.focus(); } return w; }
    const p = online(id);
    w = makeWin({ key: "im", title: `${nameOf(id)} : Instant Message`, cls: "aim-im" + (mine().times ? " times" : ""), w: 360, h: 340, icon: "💬",
      onClose: () => { imWins.delete(id); renderDock(); } });
    w.body.innerHTML = `
      <div class="aim-imhead"><span class="aim-bicon" aria-hidden="true"></span><div class="min0"><b class="trunc"></b><small class="aim-imstatus trunc"></small></div></div>
      <div class="aim-log" role="log" aria-live="polite"></div>
      <div class="aim-typing" aria-live="polite"></div>
      <div class="aim-tools">
        <button type="button" class="aim-tool" data-act="smiley" title="Insert a smiley">🙂</button>
        <button type="button" class="aim-tool aim-duck" data-act="duck" title="Duck emotes"><img src="/emotes/lol.png" alt="Duck emotes"></button>
        <span class="spacer"></span>
        <small class="aim-left"></small>
      </div>
      <textarea class="aim-input" rows="3" maxlength="1000" aria-label="Message"></textarea>
      <footer class="aim-bar">
        <button type="button" data-act="warn" title="Warn this buddy"><i>⚠️</i>Warn</button>
        <button type="button" data-act="block" title="Block this buddy"><i>🚫</i>Block</button>
        <button type="button" data-act="invite" title="Invite them to your lobby"><i>🎮</i>Invite</button>
        <button type="button" data-act="join" title="Join the game they're in"><i>🚪</i>Join</button>
        <button type="button" data-act="info" title="Get their info"><i>ℹ️</i>Info</button>
        <button type="button" data-act="send" class="aim-send" title="Send (Enter)"><i>✉️</i>Send</button>
      </footer>`;
    w.id = id;
    w.log = w.body.querySelector(".aim-log"); w.input = w.body.querySelector(".aim-input"); w.typingEl = w.body.querySelector(".aim-typing");
    for (const e of hist[id] || []) w.log.appendChild(lineEl(e));
    w.log.scrollTop = w.log.scrollHeight;
    let typingOn = false, typingT = 0;
    const setTyping = on => { if (on !== typingOn) { typingOn = on; wsSend({ t: "typing", to: id, on }); } };
    w.input.addEventListener("input", () => {
      const n = w.input.value.length; w.body.querySelector(".aim-left").textContent = n > 850 ? `${1000 - n}` : "";
      setTyping(!!w.input.value); clearTimeout(typingT); typingT = setTimeout(() => setTyping(false), 4000);
    });
    w.input.addEventListener("focus", () => window.dispatchEvent(new Event("blur")));   // never leave a game key held down
    w.input.addEventListener("keydown", e => {
      e.stopPropagation();                  // typing here never reaches the game or hub shortcuts
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendIm(w); clearTimeout(typingT); setTyping(false); }
      else if (e.key === "Escape") { e.preventDefault(); w.minimize(); }
    });
    w.input.addEventListener("keyup", e => e.stopPropagation());
    w.body.addEventListener("click", e => {
      const a = e.target.closest("button")?.dataset.act; if (!a) return;
      if (a === "send") sendIm(w);
      else if (a === "info") infoWin(id);
      else if (a === "invite") invite(id);
      else if (a === "join") { const pp = online(id); if (pp?.room) goJoin(pp.room); }
      else if (a === "warn") warn(id);
      else if (a === "block") { if (confirm(`Block ${nameOf(id)}? They're removed from your Buddy List and can't IM you or see you online.`)) { block(id); w.close(); } }
      else if (a === "duck") window.RH.Emotes?.picker(e.target.closest("button"), s => window.RH.Emotes.insert(w.input, s));
      else if (a === "smiley") {
        const r = e.target.getBoundingClientRect();
        showMenu(SMILEYS.map(s => ({ label: s, run: () => { insertAt(w.input, s); w.input.focus(); } })), r.left, r.top - 4 - 30 * 4);
        menuEl?.classList.add("aim-smileys");
      }
    });
    imWins.set(id, w);
    renderImHead(w);
    if (quiet) w.minimize(); else if (focus) w.input.focus();
    renderDock();
    return w;
  }
  function insertAt(ta, s) { const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a; ta.value = ta.value.slice(0, a) + s + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + s.length; ta.dispatchEvent(new Event("input")); }
  function renderImHead(w) {
    const p = online(w.id);
    w.setTitle(`${nameOf(w.id)} : Instant Message`);
    w.body.querySelector(".aim-imhead .aim-bicon").textContent = p?.icon || "🙂";
    w.body.querySelector(".aim-imhead b").textContent = nameOf(w.id);
    w.body.querySelector(".aim-imstatus").textContent = statusText(p) + (p?.away ? ` (“${p.away}”)` : "");
    w.body.querySelector("[data-act=join]").disabled = !(p?.room && p.room !== inRoom);
    w.body.querySelector("[data-act=invite]").disabled = !p || !inRoom || p.room === inRoom;
    w.body.querySelector("[data-act=warn]").disabled = !p;
    w.el.classList.toggle("offline", !p);
  }
  function sysLine(w, text) { const e = { sys: true, text, at: Date.now() }; record(w.id, e); w.log.appendChild(lineEl(e)); w.log.scrollTop = w.log.scrollHeight; }
  let nonceN = 0;
  const pendingIm = new Map();             // nonce -> { id, li }
  function sendIm(w) {
    const text = w.input.value.trim(); if (!text) return;
    const nonce = String(++nonceN);
    const entry = { mine: true, name: myName, text, at: Date.now() };
    if (!online(w.id)) { entry.fail = "they're offline"; }
    else if (!wsSend({ t: "im", to: w.id, text, nonce })) entry.fail = "not connected to the hub";
    const li = lineEl(entry); w.log.appendChild(li); w.log.scrollTop = w.log.scrollHeight;
    if (!entry.fail) { pendingIm.set(nonce, { id: w.id, li, entry }); SND.sent(); }
    record(w.id, entry);
    w.input.value = ""; w.input.dispatchEvent(new Event("input"));
  }
  function onImResult(m) {
    const p = pendingIm.get(m.nonce); if (!p) return;
    pendingIm.delete(m.nonce);
    if (!m.ok) {
      p.entry.fail = m.msg.replace(/^is /, "they're ").replace(/\.$/, "");
      p.li.replaceWith(lineEl(p.entry)); saveHist();
    }
  }
  function onIm(m) {
    const id = m.from?.id; if (!id || !isFriend(id) || (mine().ignored || []).includes(id)) return;
    const entry = { name: m.from.name, text: String(m.text || ""), at: m.at || Date.now(), auto: !!m.auto };
    record(id, entry);
    const had = imWins.has(id);
    const quiet = mine().popups === false || inGameView();
    const w = openIm(id, { focus: false, quiet: had ? true : quiet });
    if (had || quiet) { /* window exists or stays minimized */ }
    w.log.appendChild(lineEl(entry)); w.log.scrollTop = w.log.scrollHeight;
    w.typingEl.textContent = "";
    if (!m.auto) {
      SND.im();
      w.flash();
      if (quiet || w.minimized) toast(`${m.from.name}: ${entry.text.slice(0, 80)}`, { ms: 6000, action: { label: "Reply", run: () => openIm(id) } });
      if (document.hidden) bumpTitle();
    }
  }
  function onTyping(m) { const w = imWins.get(m.from); if (w) w.typingEl.textContent = m.on ? `${nameOf(m.from)} is typing…` : ""; }
  // Don't throw windows over a running match: messages wait minimized in the dock (with a toast) instead.
  const inGameView = () => !!document.querySelector("#game:not([hidden])");
  let titleN = 0; const baseTitle = () => document.title.replace(/^\(\d+ IM\) /, "");
  function bumpTitle() { titleN++; document.title = `(${titleN} IM) ${baseTitle()}`; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && titleN) { titleN = 0; document.title = baseTitle(); } });

  // ---------------------------------------------------------------- small windows
  function formWin(key, title, html, w = 300, icon = "") {
    return single(key, () => { const x = makeWin({ key, title, cls: "aim-small", w, icon }); x.body.innerHTML = html; return x; });
  }
  function addWin(prefill = "") {
    const w = formWin("add", "Add Buddy", `
      <form class="aim-form">
        <label>Buddy's ID<input name="id" maxlength="40" placeholder="#9FD5-A732-4F9D-42EA" spellcheck="false" autocomplete="off"></label>
        <label>Group<select name="group"></select></label>
        <label class="aim-newg" hidden>New group name<input name="newgroup" maxlength="24"></label>
        <p class="aim-err" hidden></p>
        <p class="aim-hint">Ask your friend for their ID: it's next to their name at the top of their hub. Or use Find a Buddy.</p>
        <div class="aim-row"><button type="button" class="aim-btn" data-act="find">Find a Buddy…</button><span class="spacer"></span><button class="aim-btn primary">Add</button></div>
      </form>`, 300, "➕");
    const f = w.body.querySelector("form");
    const sel = f.group; sel.innerHTML = groupsOf().map(g => `<option>${esc(g)}</option>`).join("") + `<option value="__new">New group…</option>`;
    sel.onchange = () => { f.querySelector(".aim-newg").hidden = sel.value !== "__new"; };
    if (prefill) f.id.value = prefill;
    f.querySelector("[data-act=find]").onclick = findWin;
    f.onsubmit = e => {
      e.preventDefault();
      const g = sel.value === "__new" ? f.newgroup.value.trim() : sel.value;
      const r = add(f.id.value, "", g);
      const err = f.querySelector(".aim-err"); err.hidden = r.ok; err.textContent = r.ok ? "" : r.msg;
      if (r.ok) { w.close(); toast("Added. You'll see each other once they add you too.", { kind: "ok", ms: 4000 }); }
    };
    f.id.focus();
  }
  function addGroupWin() {
    const n = prompt("Name of the new group:", "");
    const g = String(n || "").trim().slice(0, 24);
    if (!g) return;
    if (groupsOf().includes(g)) return toast("You already have that group.", { ms: 2000 });
    save({ groups: [...groupsOf(), g] });
  }
  function moveWin(id) {
    const r = bl?.el.getBoundingClientRect() || { left: 100, top: 100 };
    showMenu(groupsOf().map(g => ({ label: g, check: (buddy(id)?.group || groupsOf()[0]) === g, run: () => save({ list: list().map(b => b.id === id ? { ...b, group: g } : b) }) })), r.left + 20, r.top + 120);
  }
  let findCb = null;
  function findWin() {
    const w = formWin("find", "Find a Buddy", `
      <form class="aim-form">
        <label>Search people online on this hub<input name="q" maxlength="30" placeholder="Name (or leave empty to see everyone)" autocomplete="off"></label>
        <div class="aim-row"><span class="spacer"></span><button class="aim-btn primary">Search</button></div>
        <div class="aim-results" role="list"></div>
        <p class="aim-hint">Only people on this hub right now who aren't invisible show up. Add someone and they'll see a buddy request from you.</p>
      </form>`, 320, "🔎");
    const f = w.body.querySelector("form"), out = f.querySelector(".aim-results");
    findCb = m => {
      out.textContent = "";
      if (!m.list.length) { out.appendChild(el("p", "aim-hint", "Nobody found.")); return; }
      for (const p of m.list) {
        const row = el("div", "aim-result"); row.setAttribute("role", "listitem");
        row.append(el("span", "aim-bicon", p.icon || "🙂"), el("span", "trunc grow", p.name));
        const b = el("button", "aim-btn", isFriend(p.id) ? "On your list" : "Add"); b.type = "button"; b.disabled = isFriend(p.id);
        b.onclick = () => { const r = add(p.id, p.name); toast(r.ok ? `Added ${p.name}. You'll see each other once they add you too.` : r.msg, { kind: r.ok ? "ok" : "bad", ms: 4000 }); b.disabled = true; b.textContent = "Added"; };
        row.appendChild(b); out.appendChild(row);
      }
    };
    f.onsubmit = e => { e.preventDefault(); out.textContent = "Searching…"; if (!wsSend({ t: "find", q: f.q.value })) out.textContent = "Not connected to the hub."; };
    f.q.focus();
  }
  function onFound(m) { findCb?.(m); }
  const infoWait = new Map();
  function infoWin(id) {
    const w = single("info-" + id, () => makeWin({ key: "info", title: `Buddy Info: ${nameOf(id)}`, cls: "aim-small aim-info", w: 300, icon: "ℹ️" }));
    w.body.innerHTML = `<div class="aim-infohead"><span class="aim-bicon big"></span><div class="min0"><b class="trunc"></b><small class="id"></small></div></div><div class="aim-infobody">Asking the hub…</div>`;
    w.body.querySelector("b").textContent = nameOf(id); w.body.querySelector(".id").textContent = "#" + prettyId(id);
    w.body.querySelector(".aim-bicon").textContent = online(id)?.icon || "🙂";
    infoWait.set(id, w);
    if (!wsSend({ t: "info", id })) w.body.querySelector(".aim-infobody").textContent = "Not connected to the hub.";
  }
  function onInfo(m) {
    const w = infoWait.get(m.id); if (!w || !document.contains(w.el)) return;
    infoWait.delete(m.id);
    const b = w.body.querySelector(".aim-infobody"); b.textContent = "";
    if (!m.online) { b.appendChild(el("p", "aim-hint", `${nameOf(m.id)} is offline (or hasn't added you back), so their profile isn't available.`)); return; }
    const p = online(m.id);
    const dl = el("dl", "aim-dl");
    const row = (k, v) => { dl.append(el("dt", "", k), el("dd", "", v)); };
    row("Online since", new Date(m.since).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }));
    row("Warning level", (m.warn || 0) + "%");
    row("Status", statusText(p));
    if (m.away) row("Away message", m.away);
    b.appendChild(dl);
    b.appendChild(el("h4", "", "Profile"));
    b.appendChild(el("div", "aim-profile", m.profile || "(no profile)"));
  }
  function awayWin() {
    const m = mine();
    const w = formWin("away", "Away Message", `
      <form class="aim-form">
        <label>Pick one<select name="preset"></select></label>
        <label>Away message (sent back when someone IMs you)<textarea name="text" rows="4" maxlength="300"></textarea></label>
        <label class="aim-check"><input type="checkbox" name="keep"> Save it to my list</label>
        <div class="aim-row">${m.away ? `<button type="button" class="aim-btn" data-act="back">I'm Back</button>` : ""}<span class="spacer"></span><button class="aim-btn primary">I'm Away</button></div>
      </form>`, 300, "📝");
    const f = w.body.querySelector("form");
    const presets = m.awayPresets?.length ? m.awayPresets : AWAY_PRESETS;
    f.preset.innerHTML = presets.map((p, i) => `<option value="${i}">${esc(p.slice(0, 40))}</option>`).join("") + `<option value="new">New message…</option>`;
    f.text.value = m.away || presets[0];
    f.preset.onchange = () => { f.text.value = f.preset.value === "new" ? "" : presets[Number(f.preset.value)]; f.text.focus(); };
    f.querySelector("[data-act=back]")?.addEventListener("click", () => { save({ away: "" }); w.close(); });
    f.onsubmit = e => {
      e.preventDefault();
      const t = f.text.value.trim().slice(0, 300); if (!t) return;
      save({ away: t, awayPresets: f.keep.checked && !presets.includes(t) ? [...presets, t].slice(-12) : presets });
      w.close(); toast("You're away. Anyone who IMs you gets your away message.", { ms: 3500 });
    };
  }
  function profileWin() {
    const w = formWin("profile", "My Profile", `
      <form class="aim-form">
        <label>Your profile (buddies see it in Get Info)<textarea name="text" rows="8" maxlength="1000" placeholder="Favorite games, quotes, song lyrics you wrote yourself…"></textarea></label>
        <div class="aim-row"><small class="aim-left"></small><span class="spacer"></span><button class="aim-btn primary">Save</button></div>
      </form>`, 320, "📇");
    const f = w.body.querySelector("form");
    f.text.value = mine().profile || "";
    const left = () => { f.querySelector(".aim-left").textContent = `${1000 - f.text.value.length} left`; };
    f.text.oninput = left; left();
    f.onsubmit = e => { e.preventDefault(); save({ profile: f.text.value.trim().slice(0, 1000) }); w.close(); toast("Profile saved.", { kind: "ok" }); };
    f.text.focus();
  }
  function iconWin() {
    const w = formWin("icon", "Buddy Icon", `<div class="aim-icons" role="listbox" aria-label="Buddy icons"></div><p class="aim-hint">Your buddies see it next to your name.</p>`, 280, "🖼️");
    const box = w.body.querySelector(".aim-icons");
    box.textContent = "";
    for (const ic of ["", ...ICONS]) {
      const b = el("button", "aim-iconpick" + ((mine().icon || "") === ic ? " sel" : ""), ic || "∅"); b.type = "button";
      b.title = ic ? "Use " + ic : "No icon"; b.setAttribute("role", "option");
      b.onclick = () => { save({ icon: ic }); w.close(); };
      box.appendChild(b);
    }
  }
  function warn(id) {
    if (!online(id)) return toast("They're not online.", { ms: 2000 });
    if (!confirm(`Warn ${nameOf(id)}? Their warning level goes up 10% (it drops by itself over time). Use it for rude or spammy messages.`)) return;
    wsSend({ t: "warn", id });
  }

  // ---------------------------------------------------------------- lobbies: join / invite
  function goJoin(code) {
    if (joinFn && !inRoom) return joinFn(code);              // on the hub page: the normal join flow (password dialog etc.)
    if (inRoom && !confirm("Leave this lobby and join your buddy's?")) return;
    location.href = "/?join=" + encodeURIComponent(code);
  }
  function invite(id) {
    if (!inRoom) return toast("Open or join a lobby first, then invite.", { ms: 2500 });
    wsSend({ t: "invite", to: id });
  }
  function onInvite(m) {
    if (!isFriend(m.from?.id) || (inRoom && inRoom === m.room)) return;
    const text = `invites you to ${m.game || "their lobby"}${m.locked ? " (it has a password: ask them for it)" : ""}.`;
    const w = imWins.get(m.from.id);
    if (w) {
      const li = el("div", "aim-line invite");
      li.append(el("b", "", m.from.name + " "), document.createTextNode(text + " "));
      const b = el("button", "aim-btn primary", "Join"); b.type = "button"; b.onclick = () => goJoin(m.room);
      li.appendChild(b); w.log.appendChild(li); w.log.scrollTop = w.log.scrollHeight; w.flash();
    }
    SND.im();
    toast(`${m.from.name} ${text}`, { ms: 15000, action: { label: "Join", run: () => goJoin(m.room) } });
  }

  // ---------------------------------------------------------------- idle (10 minutes without input)
  ["pointerdown", "keydown", "pointermove", "wheel"].forEach(t => addEventListener(t, () => {
    lastInput = Date.now();
    if (idle) { idle = false; sendState(); renderBuddyList(); }
  }, { passive: true, capture: true }));
  setInterval(() => { if (!idle && Date.now() - lastInput > 10 * 60e3) { idle = true; sendState(); renderBuddyList(); } }, 30e3);

  function setConn(ok) { connOk = ok; renderBuddyList(); }
  function renderAll() {
    renderBuddyList(); renderDock();
    for (const w of imWins.values()) renderImHead(w);
    const badge = document.getElementById("friends-badge"), n = presence.friends.length, req = pendingRequests().length;
    if (badge) { badge.hidden = !n && !req; badge.textContent = req ? `${n ? n + " · " : ""}${req} new` : String(n); badge.classList.toggle("req", !!req); }
  }

  // "+ Buddy" on a player in a lobby (app.js slot cards).
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-addfriend]"); if (!b || !myId) return;
    const r = add(b.dataset.addfriend, b.dataset.name);
    toast(r.ok ? `Added ${b.dataset.name} to your Buddy List. You'll see each other once they add you too.` : r.msg, { kind: r.ok ? "ok" : "bad", ms: 4000 });
  });

  window.RH = Object.assign(window.RH || {}, { Friends: {
    start(me) {
      if (started) return; started = true; myId = me.id; myName = me.name;
      document.body.append(layer, dock);
      const btn = document.getElementById("friends-btn");
      if (btn) btn.onclick = toggleBuddyList;
      if (Settings.get("aimBlOpen") !== false && !inGameView()) openBuddyList();
      for (const id of Object.keys(hist)) if (isFriend(id) && hist[id].some(e => !e.sys)) openIm(id, { quiet: true });   // conversations survive a reload, minimized
      connect(); renderAll();
    },
    setRoom(code) { inRoom = code || null; renderAll(); },
    onJoin(fn) { joinFn = fn; },
    isFriend, add, parseId,
    friendsIn: code => presence.friends.filter(f => f.room === code && isFriend(f.id)).map(f => f.name),
    open: toggleBuddyList, im: openIm,
  } });
})();
