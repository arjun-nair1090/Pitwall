// Real-browser check of the /live workspace, run against served fixtures (see live-fixtures.mjs):
// drag persists across reload, Reset layout restores the default, expand keeps typed text,
// selecting a driver drives the telemetry panel. Needs `next dev` on :3000 and the API on :8000.
import { launch, sleep } from "./cdp.mjs";
import { installLiveFixtures } from "./live-fixtures.mjs";

const BASE = process.env.BASE || "http://localhost:3000";
let ok = true;
const check = (name, cond, detail = "") => { ok &&= !!cond; console.log(`${cond ? "PASS" : "FAIL"} ${name} ${detail}`); };

const b = await launch(9682);
await installLiveFixtures(b);
await b.viewport(1440, 1000, false);

const rectOf = (title) => `(() => {
  const h = [...document.querySelectorAll('section h2')].find((x) => x.textContent === ${JSON.stringify(title)});
  const r = h.closest('section').getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
})()`;
const handleOf = (title) => `(() => {
  const h = [...document.querySelectorAll('section h2')].find((x) => x.textContent === ${JSON.stringify(title)});
  const r = h.closest('header').getBoundingClientRect();
  return { x: Math.round(r.x + 60), y: Math.round(r.y + r.height / 2) };
})()`;
const mouse = (type, x, y) => b.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });

await b.goto(`${BASE}/live`, 5000);
await b.eval("localStorage.clear()");
await b.goto(`${BASE}/live`, 5000);
await b.waitFor("!!document.querySelector('[role=table]')", 30000, "timing table");

// 1. Drag "Telemetry" down and to the left of the engineer panel, then verify it moved and persisted.
const before = await b.eval(rectOf("Telemetry"));
const grab = await b.eval(handleOf("Telemetry"));
await mouse("mousePressed", grab.x, grab.y);
for (let i = 1; i <= 12; i++) { await mouse("mouseMoved", grab.x - i * 25, grab.y + i * 40); await sleep(30); }
await mouse("mouseReleased", grab.x - 300, grab.y + 480);
await sleep(600);
const after = await b.eval(rectOf("Telemetry"));
check("dragging a panel by its title moves it", after.x !== before.x || after.y !== before.y, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
check("the layout is saved to this browser", await b.eval("!!localStorage.getItem('pitwall.layout.v1.live')"));

await b.goto(`${BASE}/live`, 5000);
await b.waitFor("!!document.querySelector('[role=table]')", 30000, "timing table again");
const reloaded = await b.eval(rectOf("Telemetry"));
check("the moved layout survives a reload", Math.abs(reloaded.x - after.x) < 3 && Math.abs(reloaded.y - after.y) < 3, JSON.stringify(reloaded));

// 2. Reset layout restores the default.
await b.clickText("button", "Reset layout");
await sleep(700);
const reset = await b.eval(rectOf("Telemetry"));
check("Reset layout returns the panel to its default place", Math.abs(reset.x - before.x) < 3 && Math.abs(reset.y - before.y) < 3, JSON.stringify(reset));
// RGL may re-save the defaults it lays out after a reset, so assert on the content, not on absence.
const savedAfterReset = await b.eval("localStorage.getItem('pitwall.layout.v1.live')");
check("Reset layout leaves no moved layout behind", savedAfterReset === null || JSON.parse(savedAfterReset).layouts.lg.find((p) => p.i === "telemetry").y === 0, savedAfterReset ? "re-saved defaults" : "cleared");

// 3. Selecting a driver in the tower drives the telemetry panel.
await b.click("[role=table] button[aria-pressed]");
await sleep(300);
check("selecting VER shows his telemetry", /Max Verstappen/.test(await b.text("body")));

// 4. Expanding a panel keeps its state and Escape closes it.
await b.setValue("input[aria-label='Ask the race engineer']", "box box");
await sleep(150);
await b.click("button[aria-label='Expand Race engineer']");
await sleep(500);
check("expand opens a full-screen dialog", await b.eval("!!document.querySelector('[role=dialog][aria-label=\"Race engineer\"]')"));
check("typed text survives the expand", (await b.eval("document.querySelector('input[aria-label=\"Ask the race engineer\"]')?.value")) === "box box");
check("the panel content now lives inside the dialog", await b.eval("!!document.querySelector('[role=dialog] input[aria-label=\"Ask the race engineer\"]')"));
await b.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", windowsVirtualKeyCode: 27 });
await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
await sleep(400);
check("Escape closes the dialog", await b.eval("!document.querySelector('[role=dialog]')"));
check("typed text survives the collapse", (await b.eval("document.querySelector('input[aria-label=\"Ask the race engineer\"]')?.value")) === "box box");

await b.close();
process.exitCode = ok ? 0 : 1;
