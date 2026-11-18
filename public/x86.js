// PC page (x86.html): v86 (public/v86/, BSD-2) boots DOS / Windows 9x disk images.
// Own disks are handed to v86 as File objects (read in the browser, never uploaded); hub disks come from /x86/<path>
// (roms/x86), big ones streamed with Range requests. Snapshots are downloaded as .v86state files.
"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const enc = p => p.split("/").map(encodeURIComponent).join("/");
  let emu = null, own = { boot: null, cd: null, state: null }, title = "";

  const fail = m => { $("pc-error").textContent = m; $("pc-error").hidden = !m; };
  const status = m => { $("pc-status").textContent = m || ""; };
  const isFloppy = (name, size) => /\.(img|ima|vfd|flp)$/i.test(name) && size <= 2949120;

  // ---------- hub list
  (async () => {
    let games = [];
    try { games = (await (await fetch("/api/x86-games")).json()).games || []; } catch {}
    for (const g of games) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "fl-game";
      if (g.cover) { const im = document.createElement("img"); im.src = "/x86/" + enc(g.cover); im.alt = ""; im.loading = "lazy"; b.appendChild(im); }
      const t = document.createElement("span"); t.textContent = g.name; b.appendChild(t);
      const kinds = { fda: "floppy", hda: "hard disk", cdrom: "CD", state: "snapshot" };
      const s = document.createElement("small"); s.className = "muted";
      s.textContent = g.disks.map(d => kinds[d.kind]).join(" + ");
      b.appendChild(s);
      b.addEventListener("click", () => bootHub(g));
      $("pc-lib").appendChild(b);
    }
    $("pc-lib-wrap").hidden = !games.length;
  })();

  function bootHub(g) {
    const cfg = {}, url = d => ({ url: "/x86/" + enc(d.file), size: d.size, async: d.size > 64 * 1048576 });
    for (const d of g.disks) {
      if (d.kind === "state") { if (!cfg.initial_state) cfg.initial_state = { url: "/x86/" + enc(d.file) }; continue; }
      if (!cfg[d.kind]) cfg[d.kind] = url(d);
    }
    power(cfg, g.name);
  }

  // ---------- own disks
  function pickBoot(file) {
    fail("");
    if (!file) return;
    if (!/\.(img|ima|vfd|flp|iso)$/i.test(file.name)) return fail("Pick a disk image: .img (hard disk or floppy) or .iso (CD).");
    own.boot = file;
    $("pc-boot-name").textContent = "Boot disk: " + file.name + " (" + (file.size / 1048576).toFixed(1) + " MB)";
    $("pc-start").disabled = false;
  }
  $("pc-boot").addEventListener("change", e => pickBoot(e.target.files[0]));
  const drop = $("pc-drop");
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", e => { e.preventDefault(); pickBoot(e.dataTransfer.files[0]); });
  $("pc-cd").addEventListener("change", e => { own.cd = e.target.files[0] || null; $("pc-cd-name").textContent = own.cd ? own.cd.name : "none"; });
  $("pc-state").addEventListener("change", e => { own.state = e.target.files[0] || null; $("pc-state-name").textContent = own.state ? own.state.name : "none (cold boot)"; });
  $("pc-start").addEventListener("click", () => {
    const f = own.boot; if (!f) return;
    const cfg = {};
    if (/\.iso$/i.test(f.name)) cfg.cdrom = { buffer: f };
    else if (isFloppy(f.name, f.size)) cfg.fda = { buffer: f };
    else cfg.hda = { buffer: f };
    if (own.cd && !cfg.cdrom) cfg.cdrom = { buffer: own.cd };
    if (own.state) cfg.initial_state = { buffer: own.state };
    power(cfg, f.name.replace(/\.[^.]+$/, ""));
  });

  // ---------- running
  function power(disks, name) {
    fail("");
    if (typeof V86 !== "function") return fail("The PC emulator (v86) didn't load. Reload the page.");
    off();
    title = name;
    $("pc-setup").hidden = true; $("pc-play").hidden = false; $("pc-back").hidden = true;
    $("pc-now").textContent = name; $("pc-name").textContent = "";
    document.title = "Retro Hub · " + name;
    status("Starting…");
    const mb = Number($("pc-ram").value) || 128;
    try {
      emu = new V86({
        wasm_path: "/v86/v86.wasm",
        memory_size: mb * 1048576,
        vga_memory_size: 16 * 1048576,
        screen_container: $("pc-screen"),
        bios: { url: "/v86/seabios.bin" },
        vga_bios: { url: "/v86/vgabios.bin" },
        autostart: true,          // boot order: v86 picks floppy, then hard disk, then CD
        ...disks,
      });
    } catch (e) { return back("Couldn't start the PC: " + (e.message || e)); }
    emu.add_listener("emulator-ready", () => status(""));
    emu.add_listener("download-error", e => status("Couldn't load " + (e && e.file_name || "a file")));
  }
  function off() { if (emu) { try { emu.destroy(); } catch {} emu = null; } $("pc-screen").querySelector(".pc-text").textContent = ""; }
  function back(msg) {
    off();
    $("pc-play").hidden = true; $("pc-setup").hidden = false; $("pc-back").hidden = false;
    document.title = "Retro Hub · PC (DOS / Windows 9x)";
    if (msg) fail(msg);
  }

  $("pc-swap-cd").addEventListener("change", async e => { const f = e.target.files[0]; if (f && emu) { await emu.set_cdrom({ buffer: f }); status("CD: " + f.name); } e.target.value = ""; });
  $("pc-eject").addEventListener("click", () => { if (emu) { emu.eject_cdrom(); status("CD drive empty"); } });
  $("pc-swap-fd").addEventListener("change", async e => { const f = e.target.files[0]; if (f && emu) { await emu.set_fda({ buffer: f }); status("Floppy: " + f.name); } e.target.value = ""; });
  $("pc-cad").addEventListener("click", () => emu && emu.keyboard_send_scancodes([0x1D, 0x38, 0xE0, 0x53, 0xE0, 0xD3, 0xB8, 0x9D]));
  $("pc-mouse").addEventListener("click", () => emu && emu.lock_mouse());
  $("pc-full").addEventListener("click", () => emu && emu.screen_go_fullscreen());
  $("pc-off").addEventListener("click", () => { if (confirm("Power off? Anything not in a snapshot is lost.")) back(); });
  $("pc-snap").addEventListener("click", async () => {
    if (!emu) return;
    status("Saving snapshot…");
    try {
      const state = await emu.save_state();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([state], { type: "application/octet-stream" }));
      a.download = (title || "pc").replace(/[\\/:*?"<>|]+/g, "_") + ".v86state";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      status("Snapshot saved (" + (state.byteLength / 1048576).toFixed(0) + " MB)");
    } catch (e) { status("Snapshot failed: " + (e.message || e)); }
  });
  $("pc-screen").addEventListener("click", () => window.focus());
  window.addEventListener("beforeunload", e => { if (emu) { e.preventDefault(); e.returnValue = ""; } });
})();
