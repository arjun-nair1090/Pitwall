// Confirms both faces are really loaded (not a system fallback). The UI face must render
// tabular figures ("1111" exactly as wide as "0000") because it carries every aligned column.
// The display face has proportional digits, so it is only ever used for single
// values or centred in fixed-width cells, never for columns of numbers; that is reported, not failed.
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE || "http://localhost:3000";
const b = await launch(9670);
try {
  await b.viewport(1280, 800, false);
  await b.goto(`${BASE}/stats`, 3000);
  const result = await b.eval(`(async () => {
    const out = {};
    for (const [name, cssVar, weight] of [["ui", "--font-ui", 500], ["display", "--font-display", 800]]) {
      // next/font/local generates a hashed family name; resolve it from the CSS variable.
      const family = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
      const primary = family.split(",")[0].trim().replace(/['"]/g, "");
      await document.fonts.load(weight + " 32px " + family);
      await document.fonts.ready;
      const loaded = [...document.fonts].some((f) => f.family.replace(/['"]/g, "") === primary && f.status === "loaded");
      const width = (text) => {
        const s = document.createElement("span");
        s.textContent = text;
        s.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font-size:32px;font-weight:" + weight +
          ";font-family:" + family + ";font-variant-numeric:tabular-nums";
        document.body.appendChild(s);
        const w = s.getBoundingClientRect().width;
        s.remove();
        return w;
      };
      out[name] = { primary, loaded, ones: width("1111"), zeros: width("0000") };
    }
    return out;
  })()`);
  let ok = true;
  for (const [name, m] of Object.entries(result)) {
    const tabular = Math.abs(m.ones - m.zeros) < 0.01;
    const required = name === "ui";
    ok &&= m.loaded && (tabular || !required);
    console.log(
      `${name.padEnd(8)} ${m.primary} loaded=${m.loaded} 1111=${m.ones.toFixed(2)} 0000=${m.zeros.toFixed(2)} -> ${tabular ? "tabular" : required ? "NOT tabular (FAIL)" : "proportional (ok: single values only)"}`,
    );
  }
  process.exitCode = ok ? 0 : 1;
} finally {
  await b.close();
}
