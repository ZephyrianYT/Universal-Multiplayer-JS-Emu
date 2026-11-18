// 🦆 Duck emotes for the lobby chat and Messenger IMs. Typed as :code: (e.g. :lol:) and drawn as pictures on
// every screen; the hub only ever relays the text. Pictures live in public/emotes/<code>.png (128x128, transparent).
(function () {
  "use strict";
  // "classic" = simple expression set drawn in Figma (file "Retro Hub Duck Emotes"; source in
  // Tools/retro-hub/duck_emotes_svg.mjs); "duck" = the Durag Duck sticker sheets.
  const GROUPS = { classic: "Classic", duck: "Durag Duck" };
  const LIST = [
    ...[["happy", "Happy"], ["laugh", "Laugh"], ["cheer", "Cheer"], ["sad", "Sad"], ["cry", "Cry"], ["angry", "Angry"],
      ["heart", "Heart eyes"], ["wow", "Wow"], ["wink", "Wink"], ["shades", "Shades"], ["think", "Thinking"], ["sleep", "Sleepy"],
      ["shy", "Shy"], ["nervous", "Nervous"], ["ko", "KO"], ["check", "Check / yes"]].map(e => [...e, "classic"]),
    ...[["lol", "LOL"], ["love", "Love"], ["grr", "Grr"], ["cool", "Cool"], ["lolduck", "LOL (drawn)"],
      ["gg", "GG"], ["tryhard", "Tryhard"], ["trophy", "Trophy"], ["esports", "Esports"],
      ["sleepy", "Sleepy (gamer)"], ["zzz", "Zzz"], ["wardogs", "Wardogs"], ["drip", "Drip"], ["pinkdrip", "Pink drip"],
      ["cowboy", "Cowboy"], ["scooter", "Scooter"], ["pumpkin", "Pumpkin"], ["boo", "Boo"], ["vampire", "Vampire"], ["witch", "Witch"]].map(e => [...e, "duck"]),
  ].map(([code, name, group]) => ({ code, name, group, src: `/emotes/${code}.png` }));
  const BY = new Map(LIST.map(e => [e.code, e]));
  const RE = /:([a-z0-9]+):/g;

  function img(e, big) {
    const i = document.createElement("img");
    i.className = "emote" + (big ? " big" : ""); i.src = e.src; i.alt = `:${e.code}:`; i.title = `:${e.code}:`;
    i.draggable = false; i.decoding = "async";
    return i;
  }
  // Fills el with text + emote pictures. Plain text stays text nodes (never HTML). A message that is only
  // emotes (up to 3) shows them big.
  function render(el, text) {
    el.textContent = "";
    text = String(text ?? "");
    const parts = []; let last = 0, m, onlyEmotes = true, count = 0;
    RE.lastIndex = 0;
    while ((m = RE.exec(text))) {
      const e = BY.get(m[1]); if (!e) continue;
      if (m.index > last) { parts.push(text.slice(last, m.index)); if (text.slice(last, m.index).trim()) onlyEmotes = false; }
      parts.push(e); count++; last = m.index + m[0].length;
    }
    if (last < text.length) { parts.push(text.slice(last)); if (text.slice(last).trim()) onlyEmotes = false; }
    const big = count > 0 && onlyEmotes && count <= 3;
    for (const p of parts) el.appendChild(typeof p === "string" ? document.createTextNode(p) : img(p, big));
    return count;
  }
  // Same, as plain text with no pictures (tab titles, notifications).
  const plain = text => String(text ?? "");

  // Picker pop-over next to a button; onPick(code) gets ":code:".
  let pop = null;
  function close() { if (pop) { pop.remove(); pop = null; document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc, true); } }
  function outside(e) { if (pop && !pop.contains(e.target) && !pop.anchor.contains(e.target)) close(); }
  function esc(e) { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); const a = pop?.anchor; close(); a?.focus(); } }
  function picker(anchor, onPick) {
    if (pop && pop.anchor === anchor) return close();
    close();
    pop = document.createElement("div");
    pop.className = "emote-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Duck emotes");
    pop.anchor = anchor;
    const grid = document.createElement("div"); grid.className = "emote-grid";
    let group = "";
    for (const e of LIST) {
      if (e.group !== group) {
        group = e.group;
        const h = document.createElement("div"); h.className = "emote-group"; h.textContent = GROUPS[group] || group;
        grid.appendChild(h);
      }
      const b = document.createElement("button"); b.type = "button"; b.title = `${e.name}  :${e.code}:`;
      b.setAttribute("aria-label", e.name); b.appendChild(img(e));
      b.onclick = () => { onPick(`:${e.code}:`); close(); };
      grid.appendChild(b);
    }
    const tip = document.createElement("div"); tip.className = "emote-tip"; tip.textContent = "Or type :name: (e.g. :happy: or :lol:)";
    pop.append(grid, tip);
    // Inside fullscreen or a modal dialog the pop-over must live there, or it is drawn underneath.
    const fs = document.fullscreenElement;
    (fs && fs.contains(anchor) ? fs : anchor.closest("dialog") || document.body).appendChild(pop);
    const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = Math.min(window.innerWidth - pw - 8, Math.max(8, r.right - pw));
    let y = r.top - ph - 6; if (y < 8) y = Math.min(window.innerHeight - ph - 8, r.bottom + 6);
    pop.style.left = x + "px"; pop.style.top = y + "px";
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc, true);
    grid.querySelector("button")?.focus();
  }
  // Inserts text at the caret of an input/textarea, with spaces around it when needed.
  function insert(input, s) {
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a, v = input.value;
    const pre = a > 0 && !/\s/.test(v[a - 1]) ? " " : "", post = b < v.length && !/\s/.test(v[b]) ? " " : " ";
    const add = pre + s + post;
    if (input.maxLength > 0 && v.length - (b - a) + add.length > input.maxLength) return false;
    input.value = v.slice(0, a) + add + v.slice(b);
    const c = a + add.length; input.setSelectionRange(c, c);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    return true;
  }
  window.RH = window.RH || {};
  window.RH.Emotes = { list: LIST, render, plain, picker, insert, close };
})();
