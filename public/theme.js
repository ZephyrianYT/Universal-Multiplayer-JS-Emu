// Themes: loaded in <head> before anything draws, so the page never flashes the default colors. The choice is kept
// in this browser (rh-settings.theme, the same store as ui.js Settings) and applies to every Retro Hub page.
// The preset colors are in style.css (:root[data-theme="..."]); "coal" is the default and needs no attribute.
// "custom" is the player's own theme (rh-settings.customTheme): colors, font, corners and an optional background
// picture (kept in its own key rh-theme-bg because it is big). Its colors are set as inline CSS variables here.
(function () {
  "use strict";
  const KEY = "rh-settings", BG_KEY = "rh-theme-bg";
  const THEMES = [
    { id: "coal", name: "Coal", desc: "The original: charcoal and canary yellow.", sw: ["#0e0f11", "#22262b", "#ffd60a"] },
    { id: "midnight", name: "Midnight", desc: "Deep navy with ice-blue accents.", sw: ["#0a0f1c", "#1c2740", "#38bdf8"] },
    { id: "synthwave", name: "Synthwave", desc: "Purple night, neon pink.", sw: ["#120b1d", "#2a1c40", "#ff4fd8"] },
    { id: "forest", name: "Forest", desc: "Dark pine with lime.", sw: ["#0b120d", "#1d2b21", "#a3e635"] },
    { id: "crimson", name: "Crimson", desc: "Warm black with arcade red.", sw: ["#120c0c", "#2b1d1d", "#ff4d5e"] },
    { id: "pocket", name: "Pocket", desc: "Four shades of handheld green.", sw: ["#0f1a0f", "#29402a", "#9bbc0f"] },
    { id: "paper", name: "Paper", desc: "Light mode: off-white with amber.", sw: ["#f4f3ef", "#ffffff", "#b45309"] },
    { id: "duck", name: "Durag Duck", desc: "Mascot colors: duck red, bandana purple.", sw: ["#140d1c", "#2a1838", "#ff4a36"] },
    { id: "custom", name: "Custom", desc: "Your own colors, font and background.", sw: [] },
  ];
  const ids = new Set(THEMES.map(t => t.id));
  const FONTS = {
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    rounded: 'ui-rounded, "Segoe UI Rounded", "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif',
    mono: 'ui-monospace, "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace',
    serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',
    comic: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive, sans-serif',
  };
  const DEFAULT_CUSTOM = { bg: "#0e0f11", panel: "#15171a", line: "#2e333a", text: "#f3f4f6", accent: "#ffd60a",
    font: "system", radius: 6, dim: 60, headCase: "upper" };
  const HEX = /^#[0-9a-f]{6}$/i;

  const store = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } };
  function cleanCustom(c) {
    const o = { ...DEFAULT_CUSTOM };
    if (c && typeof c === "object") {
      for (const k of ["bg", "panel", "line", "text", "accent"]) if (HEX.test(c[k])) o[k] = c[k].toLowerCase();
      if (Object.prototype.hasOwnProperty.call(FONTS, c.font)) o.font = c.font;
      if (Number.isFinite(+c.radius)) o.radius = Math.max(0, Math.min(20, Math.round(+c.radius)));
      if (Number.isFinite(+c.dim)) o.dim = Math.max(0, Math.min(95, Math.round(+c.dim)));
      if (c.headCase === "upper" || c.headCase === "none") o.headCase = c.headCase;
    }
    return o;
  }
  const readCustom = () => cleanCustom(store().customTheme);
  const readBg = () => { try { const v = localStorage.getItem(BG_KEY) || ""; return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : ""; } catch { return ""; } };
  function read() { const t = store().theme; return ids.has(t) ? t : "coal"; }

  // ---- color math
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const hex = a => "#" + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const rgba = (h, a) => `rgba(${rgb(h).join(", ")}, ${a})`;

  // Inline variables the custom theme sets (removed again for presets).
  const VARS = ["--coal-950", "--coal-900", "--coal-850", "--coal-800", "--coal-700", "--coal-600", "--coal-400", "--coal-200", "--coal-50",
    "--canary", "--canary-d", "--canary-t", "--muted", "--on-accent", "--font", "--font-head", "--radius", "--bad", "--bad-t", "--ok", "--mid",
    "--ghost", "--bg-img", "--head-case", "color-scheme"];
  function customVars(c, bgImg) {
    const light = lum(c.bg) > .4;
    const v = {
      "--coal-950": c.bg, "--coal-900": c.panel, "--coal-850": mix(c.panel, c.line, .25), "--coal-800": mix(c.panel, c.line, .5),
      "--coal-700": c.line, "--coal-600": mix(c.line, c.text, .15), "--coal-400": mix(c.line, c.text, .45),
      "--coal-200": mix(c.line, c.text, .8), "--coal-50": c.text,
      "--canary": c.accent, "--canary-d": mix(c.accent, "#000000", .12), "--canary-t": rgba(c.accent, .15),
      "--muted": mix(c.bg, c.text, light ? .62 : .55),
      "--on-accent": contrast(c.accent, "#111111") >= contrast(c.accent, "#ffffff") ? "#111111" : "#ffffff",
      "--radius": c.radius + "px", "--font": FONTS[c.font],
      "--head-case": c.headCase === "none" ? "none" : "uppercase",
      "color-scheme": light ? "light" : "dark",
    };
    if (c.font !== "system") v["--font-head"] = FONTS[c.font];
    if (light) Object.assign(v, { "--bad": "#c62828", "--bad-t": "rgba(198, 40, 40, .1)", "--ok": "#15803d", "--mid": "#a16207", "--ghost": "#0e7490" });
    if (bgImg) v["--bg-img"] = `linear-gradient(${rgba(c.bg, c.dim / 100)}, ${rgba(c.bg, c.dim / 100)}), url("${bgImg}")`;
    return { v, light };
  }

  // preview = unsaved custom settings to show live ({...custom, bgImg}); otherwise the saved ones.
  function apply(id, preview) {
    id = ids.has(id) ? id : "coal";
    const root = document.documentElement;
    for (const k of VARS) root.style.removeProperty(k);
    if (id === "coal") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", id);
    let light = id === "paper", top = THEMES.find(t => t.id === id).sw[0];
    if (id === "custom") {
      const c = preview ? cleanCustom(preview) : readCustom();
      const r = customVars(c, preview && "bgImg" in preview ? preview.bgImg : readBg());
      for (const [k, val] of Object.entries(r.v)) root.style.setProperty(k, val);
      light = r.light; top = c.bg;
    }
    if (light) root.setAttribute("data-light", ""); else root.removeAttribute("data-light");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = top;
    return id;
  }
  // Saves through ui.js Settings when it is loaded (keeps its cache in step), else straight to the store.
  function save(key, val) {
    const S = window.RH && window.RH.UI && window.RH.UI.Settings;
    if (S) S.set(key, val);
    else try { const s = store(); s[key] = val; localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }
  function choose(id) {
    id = apply(id);
    save("theme", id);
    window.dispatchEvent(new Event("rh-theme"));
    return id;
  }
  // Stores the custom theme (and picture: a data: URL, "" = none, undefined = keep) and switches to it.
  function saveCustom(c, bgImg) {
    save("customTheme", cleanCustom(c));
    let res = { ok: true };
    if (bgImg !== undefined) {
      try { if (bgImg) localStorage.setItem(BG_KEY, bgImg); else localStorage.removeItem(BG_KEY); }
      catch { res = { ok: false, msg: "That picture is too big to keep in this browser. Try a smaller one." }; }
    }
    choose("custom");
    return res;
  }
  // Current colors of whatever theme is showing, as a starting point for Custom (read from the live CSS).
  function snapshot() {
    const cs = getComputedStyle(document.documentElement);
    const get = (n, d) => { const v = cs.getPropertyValue(n).trim(); return HEX.test(v) ? v.toLowerCase() : d; };
    const c = readCustom();
    return { ...c, bg: get("--coal-950", c.bg), panel: get("--coal-900", c.panel), line: get("--coal-700", c.line),
      text: get("--coal-50", c.text), accent: get("--canary", c.accent) };
  }
  // Share codes: "RH-THEME:" + base64 JSON (no picture: those are too big to paste).
  function exportCode(c) { return "RH-THEME:" + btoa(JSON.stringify(cleanCustom(c || readCustom()))); }
  function importCode(s) {
    s = String(s || "").trim().replace(/^RH-THEME:/i, "");
    if (!s || s.length > 2000) return null;
    try { const o = JSON.parse(s.startsWith("{") ? s : atob(s)); if (!o || typeof o !== "object") return null; return cleanCustom(o); }
    catch { return null; }
  }

  apply(read());
  // Another tab changed it: follow.
  window.addEventListener("storage", e => {
    if (e.key !== KEY && e.key !== BG_KEY) return;
    const id = apply(read());
    const S = window.RH && window.RH.UI && window.RH.UI.Settings;
    if (S) { S.all().theme = id; S.all().customTheme = readCustom(); }  // so this tab's next settings save doesn't write old values back
    window.dispatchEvent(new Event("rh-theme"));
  });
  // The Custom card's swatches follow the saved colors.
  Object.defineProperty(THEMES.find(t => t.id === "custom"), "sw", { get: () => { const c = readCustom(); return [c.bg, c.panel, c.accent]; } });
  window.RH = window.RH || {};
  window.RH.Theme = { list: THEMES, fonts: Object.keys(FONTS), current: read, apply, choose, custom: readCustom, customBg: readBg,
    saveCustom, snapshot, exportCode, importCode, defaults: DEFAULT_CUSTOM };
})();
