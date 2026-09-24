// Real-keyboard regression check: Ctrl+K opens the palette with the combobox focused,
// typing filters, Enter navigates.
import { launch, sleep } from "./cdp.mjs";

const BASE = process.env.BASE || "http://localhost:3000";
const b = await launch(9673);
const key = async (k, { modifiers = 0, text, vk } = {}) => {
  const base = { key: k, modifiers, ...(vk ? { windowsVirtualKeyCode: vk } : {}) };
  await b.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text } : {}) });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
};
try {
  await b.viewport(1280, 800, false);
  await b.goto(BASE + "/stats", 3000);
  await key("k", { modifiers: 2, vk: 75 }); // Ctrl+K
  await sleep(500);
  const opened = await b.eval(`!!document.querySelector('[role=dialog][aria-label=Search]') && document.activeElement?.getAttribute('role') === 'combobox'`);
  for (const ch of "live") await key(ch, { text: ch, vk: ch.toUpperCase().charCodeAt(0) });
  await sleep(300);
  const top = await b.eval(`document.querySelector('[role=option]')?.innerText || ''`);
  await key("Enter", { vk: 13, text: "\r" });
  await sleep(2500);
  const path = await b.eval("location.pathname");
  console.log({ opened, top, path });
  process.exitCode = opened && /Live timing/.test(top) && path === "/live" ? 0 : 1;
} finally {
  await b.close();
}
