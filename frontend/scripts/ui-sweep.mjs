// Sweeps routes at three viewports and fails on: horizontal overflow, crash overlays,
// uncaught errors, h1 count != 1, unnamed buttons/links, unlabelled inputs, and text
// below WCAG AA contrast. Run against a running `next dev` (never during `next build`).
//   node scripts/ui-sweep.mjs [--base URL] [--routes /a,/b] [--shots DIR]
// In Git Bash on Windows, prefix with MSYS_NO_PATHCONV=1 or it rewrites "/stats" into a Windows path.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length),
);
const BASE = args.base || "http://localhost:3000";
const ROUTES = (
  args.routes ||
  "/,/live,/map,/stats,/compare,/strategy,/archive,/debrief,/predictions,/login,/changelog,/advanced,/drivers/VER?year=2023"
).split(",");
const VIEWPORTS = [["390", 390, 844, true], ["768", 768, 1024, false], ["1280", 1280, 900, false]];
if (args.shots) mkdirSync(args.shots, { recursive: true });

const INSTALL_ERROR_HOOK = `
  window.__errs = [];
  window.addEventListener("error", (e) => window.__errs.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => window.__errs.push("rejection: " + String(e.reason)));
  const origError = console.error;
  console.error = (...a) => { window.__errs.push("console.error: " + a.map(String).join(" ").slice(0, 200)); origError(...a); };
`;

const AUDIT = `(() => {
  const issues = [];
  const doc = document.documentElement;
  if (doc.scrollWidth - doc.clientWidth > 0) issues.push("horizontal overflow " + (doc.scrollWidth - doc.clientWidth) + "px");
  if (document.querySelector("#__next_error__") || /Application error|Unhandled Runtime Error/i.test(document.body.innerText)) issues.push("crash overlay");
  for (const e of window.__errs || []) issues.push("error: " + e);
  const h1 = document.querySelectorAll("h1").length;
  if (h1 !== 1) issues.push("h1 count " + h1);

  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const named = (el) => (el.innerText || "").trim() || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.title || el.querySelector("img[alt]:not([alt=''])");
  const unnamed = [...document.querySelectorAll("button,a[href]")].filter((el) => visible(el) && !named(el));
  if (unnamed.length) issues.push(unnamed.length + " unnamed button/link(s): " + unnamed.slice(0, 3).map((e) => e.outerHTML.slice(0, 70)).join(" | "));
  const unlabelled = [...document.querySelectorAll("input:not([type=hidden]),select,textarea")].filter((el) => visible(el) && !(el.labels && el.labels.length) && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby"));
  if (unlabelled.length) issues.push(unlabelled.length + " unlabelled control(s): " + unlabelled.slice(0, 3).map((e) => e.outerHTML.slice(0, 70)).join(" | "));

  // Contrast: walk visible text nodes, resolve the first opaque ancestor background.
  const parse = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const p = parse(getComputedStyle(e).backgroundColor); if (p.length >= 3 && (p.length === 3 || p[3] > 0.95)) return p.slice(0, 3); } return [19, 22, 27]; };
  const seen = new Set(); const fails = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.trim(); const el = n.parentElement;
    if (!text || !el || !visible(el) || el.closest("script,style,noscript,canvas,svg")) continue;
    const s = getComputedStyle(el); const fg = parse(s.color); const bg = bgOf(el);
    const alpha = fg.length > 3 ? fg[3] : 1;
    const mixed = fg.slice(0, 3).map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
    const size = parseFloat(s.fontSize); const bold = parseInt(s.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const key = mixed.join() + "|" + bg.join() + "|" + large;
    if (seen.has(key)) continue; seen.add(key);
    const r = ratio(mixed, bg);
    if (r < (large ? 3 : 4.5)) fails.push(r.toFixed(2) + ":" + text.slice(0, 24));
  }
  if (fails.length) issues.push("low contrast " + fails.slice(0, 4).join(", "));
  return issues;
})()`;

const b = await launch(9671);
await b.send("Page.enable");
await b.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTALL_ERROR_HOOK });
let failed = 0;
try {
  for (const [label, w, h, mobile] of VIEWPORTS) {
    await b.viewport(w, h, mobile);
    for (const route of ROUTES) {
      await b.goto(BASE + route, 3500);
      const issues = await b.eval(AUDIT);
      if (args.shots) await b.shot(`${args.shots}/${label}${route.replace(/[^a-z0-9]+/gi, "_")}.png`, false);
      failed += issues.length ? 1 : 0;
      console.log(`${label.padEnd(5)}${route.padEnd(30)}${issues.length ? "FAIL " + issues.join(" ; ") : "ok"}`);
    }
  }
} finally {
  await b.close();
}
process.exitCode = failed ? 1 : 0;
