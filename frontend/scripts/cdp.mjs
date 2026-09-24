// Dev-only Chrome DevTools Protocol driver used by scripts/ui-sweep.mjs and the other checks.
// Not shipped. Needs Node 22+ (global WebSocket). Set CHROME_PATH to override the browser.
import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(port = 9333) {
  const profile = join(tmpdir(), `pitwall-cdp-profile-${port}`);
  rmSync(profile, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, "--hide-scrollbars", "about:blank",
  ], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
    await sleep(200);
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method && listeners.has(d.method)) for (const fn of listeners.get(d.method)) fn(d.params);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (d) => (d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");

  const api = {
    send,
    // Subscribe to a CDP event, e.g. on("Fetch.requestPaused", (params) => ...).
    on(method, fn) { listeners.set(method, [...(listeners.get(method) || []), fn]); },
    async viewport(width, height, mobile = false) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
    },
    async goto(url, settle = 1500) { await send("Page.navigate", { url }); await sleep(settle); },
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expr, timeout = 90000, label = expr) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { try { if (await api.eval(expr)) return true; } catch {} await sleep(400); }
      throw new Error("timeout waiting for: " + label);
    },
    // Set a value on a React-controlled input/select/range and fire the events React listens for.
    async setValue(selector, value) {
      return api.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false;
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
    },
    async click(selector) { return api.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`); },
    async clickText(tag, text) { return api.eval(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find(e => e.textContent.trim().includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`); },
    async text(selector = "body") { return api.eval(`(document.querySelector(${JSON.stringify(selector)})||document.body).innerText`); },
    async shot(path, full = true) {
      let clip;
      if (full) { const m = await send("Page.getLayoutMetrics"); const s = m.cssContentSize || m.contentSize; clip = { x: 0, y: 0, width: s.width, height: Math.min(s.height, 6000), scale: 1 }; }
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full, ...(clip ? { clip } : {}) });
      writeFileSync(path, Buffer.from(r.data, "base64"));
    },
    // Horizontal overflow check: the classic mobile layout bug.
    async overflow() { return api.eval(`({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth })`); },
    async close() { try { ws.close(); } catch {} proc.kill(); },
  };
  return api;
}
