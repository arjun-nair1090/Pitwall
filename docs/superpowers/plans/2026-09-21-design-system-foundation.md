# Design System Foundation Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Timing Screen" design tokens, tested pure libraries, UI primitives, app shell with command palette, and the one backend endpoint the landing page needs, so Plan 2 can migrate every page onto them.

**Architecture:** CSS-variable tokens (RGB triplets) mapped into Tailwind so opacity utilities keep working; pure logic (timing, search, module registry, layout persistence) lives in `src/lib` with Vitest tests; presentational primitives in `src/components/ui`; shell in `src/components/shell` driven by a single module registry; one additive FastAPI endpoint serves the last race classification.

**Tech Stack:** Next.js 14 (App Router), React 18, Tailwind 3.4, TypeScript, Vitest + Testing Library + jsdom, react-grid-layout 1.5.4, framer-motion (already installed), FastAPI + pandas + FastF1 + pytest.

**Spec:** `docs/superpowers/specs/2026-09-21-design-system-and-shell-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- Palette, exact values: tarmac `#13161B`, kerb `#1B1F26`, raised `#232832`, gantry `#2A303A`, edge `#6C7789`, chalk `#E8EBEF`, mute `#A6AEBB`, faint `#8790A0`, timing purple `#B57BFF`, timing green `#35D07F`, timing yellow `#F6C945`, F1 red `#E10600` (non-text only), F1 red text `#FF6B60`.
- Colour only carries meaning: chrome is greys and white; colour appears only as timing semantics, live/danger red, tyre compounds, team colours. No brand accent. No cyan, no all-caps labels, no monospace data labels. Labels are sentence case.
- Type: Big Shoulders Display (headlines, position numerals), Barlow Semi Condensed (UI and data, tabular numerals). Measured result: Barlow is tabular; Big Shoulders is NOT (its 1 is narrower than its 0), so display numerals are used only as single values or centred in fixed-width cells, and every aligned column of digits uses the UI face with `tabular-nums`. Self-hosted woff2 via `next/font/local` (NOT `next/font/google`: the project self-hosts because the Google fetch hard-fails builds on restricted networks).
- Shape: panels 6px radius, controls 4px, pills full. Hairline borders carry structure; no shadows for hierarchy.
- Motion: only the start-lights sequence, live-tower row reordering, and interaction feedback. `prefers-reduced-motion` respected.
- Accessibility floor: `:focus-visible` ring on every control, WCAG AA contrast (4.5:1 text, 3:1 UI), labelled form controls, one `h1` per page, touch targets at least 40px on mobile, no horizontal page scroll at 390px.
- Backend: the only change allowed is the additive read-only `GET /api/v1/races/latest-result`. The 295 existing backend tests must keep passing.
- Never touch `backend/app/services/f1_data_service.py`, `frontend/src/app/advanced/`, `frontend/src/components/PedalBehaviorChart.tsx` in this plan (user's uncommitted work; Plan 2 handles the last two in their own commit).
- Never stage `frontend/tsconfig.tsbuildinfo`. Always `git add` explicit paths, never `git add -A` or `git add .`.
- Commit messages end with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- `next.config.mjs` sets `ignoreBuildErrors`/`ignoreDuringBuilds`, so `next build` does not type-check. Always run `npx tsc --noEmit` explicitly.
- In Git Bash on Windows, prefix any command that takes a `/route` argument (`ui-sweep.mjs --routes /stats`) with `MSYS_NO_PATHCONV=1`, or the shell rewrites it into a Windows path.
- Never run `next build` while `next dev` is running (it corrupts `.next`). Vitest, tsc and pytest are safe alongside the dev server. Frontend commands run from `C:\Users\arjun\f1-pitwall\frontend`; backend from `...\backend` with `SECRET_KEY=test RUNNING_LOCALLY=true`.

## File Structure

```
frontend/
  vitest.config.ts, vitest.setup.ts
  scripts/cdp.mjs, ui-sweep.mjs, measure-fonts.mjs
  src/design/tokens.css, tokens.test.ts
  src/fonts/big-shoulders-display-*.woff2, barlow-semi-condensed-*.woff2
  src/lib/cn.ts, timing.ts, search.ts, modules.ts, layoutStore.ts (+ .test.ts each)
  src/components/ui/{Panel,Button,IconButton,Kbd,Pill,Skeleton,EmptyState,PageHeader,Select,Input,Tabs,DataTable}.tsx (+ tests)
  src/components/charts/chartTheme.ts
  src/components/shell/{paletteItems.ts,usePaletteSources.ts,PaletteView.tsx,CommandPalette.tsx,Rail.tsx,TopBar.tsx,AccountControl.tsx,MobileTabBar.tsx,AppShell.tsx}
  src/store/usePaletteStore.ts
  src/app/layout.tsx (modified), globals.css (modified)
  tailwind.config.ts (modified)
backend/app/services/latest_result.py, backend/app/tests/test_latest_result.py
backend/app/api/v1/endpoints.py (modified: one route)
```

---

### Task 1: Tooling, spec amendments, `cn` helper

**Files:**
- Modify: `docs/superpowers/specs/2026-09-21-design-system-and-shell-design.md`
- Modify: `frontend/package.json`, `.github/workflows/ci.yml`
- Create: `frontend/vitest.config.ts`, `frontend/vitest.setup.ts`, `frontend/src/lib/cn.ts`, `frontend/src/lib/cn.test.ts`, `frontend/scripts/cdp.mjs`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` from `@/lib/cn`; npm scripts `test`, `test:watch`, `typecheck`.

- [ ] **Step 1: Amend the spec** (Read the file first, then Edit). Make these four replacements:
  - Non-goals line `New analysis modules, backend changes, a light theme, translations.` becomes `New analysis modules, a light theme, translations, and backend changes other than one additive read-only endpoint, GET /api/v1/races/latest-result, which feeds the landing race tower.`
  - Type paragraph: replace `Both via \`next/font/google\` with system fallbacks.` with `Both self-hosted as woff2 via \`next/font/local\` (the project already self-hosts fonts because the Google fetch at build time hard-fails on restricted networks), with system fallbacks.`
  - Verification first bullet: replace with `- \`tsc --noEmit\` (run explicitly, because next.config ignores type errors during builds), \`next lint\` and a production \`next build\` pass.`
  - Under Architecture, after the react-grid-layout bullet add: `- react-grid-layout is pinned to 1.5.4 (the 2.x line changed its API). Drag and resize are pointer-only; keyboard users get expand/collapse and a "Reset layout" action.`

- [ ] **Step 2: Install dependencies**

Run (from `frontend/`):
```bash
npm install react-grid-layout@1.5.4 --save-exact
npm install -D "@types/react-grid-layout@^1.3.5" "vitest@^3" "@vitejs/plugin-react@^4" "jsdom@^26" "@testing-library/react@^16" "@testing-library/dom@^10" "@testing-library/jest-dom@^6" "@testing-library/user-event@^14"
```
(Executed note: vitest 5 was rejected by npm because it wants `@types/node` 22+ and the project pins 20 with CI on Node 20; vitest 3 / plugin-react 4 / jsdom 26 are the compatible line. `@testing-library/dom` is a required peer of Testing Library 16. `npm audit` reports a critical/high finding in `next` 14.2.35, which pre-dates this work.)
Expected: installs without peer errors. If `react-grid-layout` fails to install, stop and record it: Plan 2 Task 3 uses its documented fallback.

- [ ] **Step 3: Add config files**

`frontend/vitest.config.ts`:
```ts
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
```
`frontend/vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```
In `frontend/package.json` `scripts` add: `"test": "vitest run"`, `"test:watch": "vitest"`, `"typecheck": "tsc --noEmit"`.

- [ ] **Step 4: Copy the CDP driver into the repo** (dev tool used by the sweep)

Run: `cp "C:/Users/arjun/AppData/Local/Temp/claude/C--Users-arjun-f1-pitwall/d55088ff-067b-4806-8dde-d1c09bda824a/scratchpad/cdp.mjs" frontend/scripts/cdp.mjs` (create `frontend/scripts/` first). Read the file: if it has a hard-coded absolute Chrome path, replace it with `process.env.CHROME_PATH || <existing default>` and add a one-line comment at the top: `// Dev-only Chrome DevTools Protocol driver used by scripts/ui-sweep.mjs. Not shipped.`

- [ ] **Step 5: Write the failing test** `frontend/src/lib/cn.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins truthy class names and drops falsy ones", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });
  it("lets the later Tailwind class win a conflict", () => {
    expect(cn("p-2 text-mute", "p-4")).toBe("text-mute p-4");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/lib/cn.test.ts`
Expected: FAIL ("Failed to resolve import ./cn").

- [ ] **Step 7: Implement** `frontend/src/lib/cn.ts`
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
```

- [ ] **Step 8: Run to verify it passes and the baseline is green**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 2 tests pass, tsc prints nothing.

- [ ] **Step 9: Add unit tests to CI.** In `.github/workflows/ci.yml`, in the `frontend` job insert after the `Type check` step:
```yaml
      - name: Unit tests
        run: npx vitest run
```
Also rename the job's `name` to `Frontend (tsc + tests + build)`.

- [ ] **Step 10: Commit**
```bash
git add docs/superpowers/specs/2026-09-21-design-system-and-shell-design.md frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/vitest.setup.ts frontend/scripts/cdp.mjs frontend/src/lib/cn.ts frontend/src/lib/cn.test.ts .github/workflows/ci.yml
git commit -m "chore(frontend): add Vitest, react-grid-layout and the cn helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Design tokens, Tailwind mapping, contrast tests

**Files:**
- Create: `frontend/src/design/tokens.css`, `frontend/src/design/tokens.test.ts`
- Modify: `frontend/tailwind.config.ts`, `frontend/src/app/globals.css`

**Interfaces:**
- Produces: CSS variables `--tarmac --kerb --raised --gantry --edge --chalk --mute --faint --timing-purple --timing-green --timing-yellow --f1-red --f1-red-text` (space-separated RGB triplets), radii `--radius-panel`, `--radius-control`. Tailwind colours `tarmac kerb raised gantry edge chalk mute faint timing-{purple,green,yellow} live live-text` (all alpha-capable), radii `rounded-panel`, `rounded-control`, families `font-display`, `font-sans`.

- [ ] **Step 1: Write the failing test** `frontend/src/design/tokens.test.ts`
```ts
// @vitest-environment node
// Reads tokens.css with node:fs; jsdom's URL class is not accepted by fs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
type Rgb = [number, number, number];

export function token(name: string): Rgb {
  const m = css.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`));
  if (!m) throw new Error(`token --${name} is missing from tokens.css`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const GROUNDS = ["tarmac", "kerb", "raised"] as const;
const TEXT = ["chalk", "mute", "faint", "timing-purple", "timing-green", "timing-yellow", "f1-red-text"] as const;

describe("token contrast", () => {
  for (const ground of GROUNDS) {
    for (const text of TEXT) {
      it(`${text} on ${ground} meets AA text contrast (4.5:1)`, () => {
        expect(ratio(token(text), token(ground))).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`edge on ${ground} meets UI contrast (3:1)`, () => {
      expect(ratio(token("edge"), token(ground))).toBeGreaterThanOrEqual(3);
    });
  }
  it("white text on f1-red meets 4.5:1 (live badge)", () => {
    expect(ratio([255, 255, 255], token("f1-red"))).toBeGreaterThanOrEqual(4.5);
  });
  it("tarmac text on chalk meets 4.5:1 (primary button)", () => {
    expect(ratio(token("tarmac"), token("chalk"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("token exact values", () => {
  it("matches the approved palette", () => {
    expect(token("tarmac")).toEqual([19, 22, 27]);
    expect(token("kerb")).toEqual([27, 31, 38]);
    expect(token("chalk")).toEqual([232, 235, 239]);
    expect(token("timing-purple")).toEqual([181, 123, 255]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/design/tokens.test.ts`
Expected: FAIL (tokens.css not found).

- [ ] **Step 3: Create** `frontend/src/design/tokens.css`
```css
/* Timing Screen tokens. RGB triplets so Tailwind can apply alpha: rgb(var(--kerb) / 0.6).
   Values are checked by tokens.test.ts (contrast) and mirrored in chartTheme.ts. */
:root {
  --tarmac: 19 22 27;
  --kerb: 27 31 38;
  --raised: 35 40 50;
  --gantry: 42 48 58;
  --edge: 108 119 137;
  --chalk: 232 235 239;
  --mute: 166 174 187;
  --faint: 135 144 160;
  --timing-purple: 181 123 255;
  --timing-green: 53 208 127;
  --timing-yellow: 246 201 69;
  --f1-red: 225 6 0;
  --f1-red-text: 255 107 96;
  --radius-panel: 6px;
  --radius-control: 4px;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/design/tokens.test.ts`
Expected: all pass (27 tests).

- [ ] **Step 5: Replace `frontend/tailwind.config.ts`** (legacy `f1`, `compound`, `titillium` stay until Plan 2 cleanup)
```ts
import type { Config } from "tailwindcss";

// rgb(var(--x) / <alpha-value>) keeps utilities like bg-kerb/60 working.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "Impact", "Arial Narrow", "sans-serif"],
        sans: ["var(--font-ui)", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        titillium: ["var(--font-titillium)", "sans-serif"], // legacy, removed in Plan 2 cleanup
      },
      borderRadius: {
        panel: "var(--radius-panel)",
        control: "var(--radius-control)",
      },
      colors: {
        tarmac: token("tarmac"),
        kerb: token("kerb"),
        raised: token("raised"),
        gantry: token("gantry"),
        edge: token("edge"),
        chalk: token("chalk"),
        mute: token("mute"),
        faint: token("faint"),
        timing: {
          purple: token("timing-purple"),
          green: token("timing-green"),
          yellow: token("timing-yellow"),
        },
        live: { DEFAULT: token("f1-red"), text: token("f1-red-text") },

        // ---- legacy (removed in Plan 2 cleanup) ----
        background: "var(--background)",
        foreground: "var(--foreground)",
        f1: {
          red: "#e10600",
          yellow: "#ffd12b",
          green: "#00b259",
          blue: "#00a2ed",
          cyan: "#66fcf1",
          dark: "#15151e",
          gray: "#38383f",
          light: "#f3f3f3",
        },
        // Real F1 tyre-compound colours. Keep in sync with src/lib/compounds.ts.
        compound: {
          soft: "#e10600",
          medium: "#ffd12b",
          hard: "#f3f3f3",
          inter: "#43b02a",
          wet: "#0067ad",
        },
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 6: Update `globals.css`.** Replace the `@layer base { ... }` block with the block below, and append the reduced-motion block at the end. Leave the `@layer utilities` block (scrollbar-none, neon-*, glass-panel), `.bg-carbon`, `.font-mono-f1` and the keyframes untouched; they are deleted in Plan 2 cleanup.
```css
@layer base {
  html {
    color-scheme: dark;
  }
  body {
    margin: 0;
    padding: 0;
    background-color: rgb(var(--tarmac));
    color: rgb(var(--chalk));
    overflow-x: hidden;
  }
  :focus-visible {
    outline: 2px solid rgb(var(--chalk));
    outline-offset: 2px;
  }
  ::selection {
    background: rgb(var(--chalk));
    color: rgb(var(--tarmac));
  }
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: rgb(var(--tarmac));
  }
  ::-webkit-scrollbar-thumb {
    background: rgb(var(--gantry));
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: rgb(var(--edge));
  }
}
```
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 7: Import tokens in the root layout.** In `frontend/src/app/layout.tsx` add `import "@/design/tokens.css";` directly above `import "./globals.css";`.

- [ ] **Step 8: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Then (dev server on :3000 is running):
```bash
node --input-type=module -e "import {launch} from './scripts/cdp.mjs'; const b=await launch(9672); await b.goto('http://localhost:3000/stats',2500); console.log(await b.eval('getComputedStyle(document.body).backgroundColor')); await b.close();"
```
Expected: `rgb(19, 22, 27)`. (At this point `layout.tsx` still has `bg-black` on `<body>`, which wins until Task 6, so the body reads `rgb(0, 0, 0)`; instead check `getComputedStyle(document.documentElement).getPropertyValue('--tarmac')` is `19 22 27` and that a probe element with `bg-kerb text-mute rounded-panel border-edge` resolves to `rgb(27, 31, 38)`, `rgb(166, 174, 187)`, `6px`, `rgb(108, 119, 137)`.)

- [ ] **Step 9: Commit**
```bash
git add frontend/src/design frontend/tailwind.config.ts frontend/src/app/globals.css frontend/src/app/layout.tsx
git commit -m "feat(ui): Timing Screen design tokens with AA contrast tests

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Timing library (`lib/timing.ts`)

**Files:**
- Create: `frontend/src/lib/timing.ts`, `frontend/src/lib/timing.test.ts`

**Interfaces:**
- Produces: `type TimingClass = "overall-best" | "personal-best" | "off-pace" | "none"`; `classifyTime(time, personalBest, overallBest): TimingClass`; `TIMING_TEXT_CLASS: Record<TimingClass, string>`; `formatLapTime(s)`, `formatSector(s)`, `formatGap(s)`, `formatDelta(s)` (all `(number | null | undefined) => string`, missing data renders `–`); `teamColor(team): string`; `UNKNOWN_TEAM_COLOR = "#8790A0"`.

- [ ] **Step 1: Write the failing tests** `frontend/src/lib/timing.test.ts`
```ts
import { describe, expect, it } from "vitest";
import {
  classifyTime, formatDelta, formatGap, formatLapTime, formatSector,
  teamColor, TIMING_TEXT_CLASS, UNKNOWN_TEAM_COLOR,
} from "./timing";

describe("classifyTime", () => {
  it("is overall-best when it matches the overall best", () => {
    expect(classifyTime(89.117, 89.2, 89.117)).toBe("overall-best");
  });
  it("is personal-best when it matches only the personal best", () => {
    expect(classifyTime(89.2, 89.2, 89.117)).toBe("personal-best");
  });
  it("is off-pace when slower than both", () => {
    expect(classifyTime(90.5, 89.2, 89.117)).toBe("off-pace");
  });
  it("is none for missing, zero, negative or NaN times", () => {
    for (const bad of [null, undefined, 0, -1, NaN]) expect(classifyTime(bad, 89, 88)).toBe("none");
  });
  it("still classifies against a missing best", () => {
    expect(classifyTime(89, null, null)).toBe("off-pace");
  });
  it("maps every class to a Tailwind text class", () => {
    expect(TIMING_TEXT_CLASS["overall-best"]).toBe("text-timing-purple");
    expect(TIMING_TEXT_CLASS["personal-best"]).toBe("text-timing-green");
    expect(TIMING_TEXT_CLASS["off-pace"]).toBe("text-timing-yellow");
    expect(TIMING_TEXT_CLASS.none).toBe("text-chalk");
  });
});

describe("formatLapTime", () => {
  it("formats m:ss.mmm", () => expect(formatLapTime(89.526)).toBe("1:29.526"));
  it("never shows 60 seconds", () => expect(formatLapTime(59.9996)).toBe("1:00.000"));
  it("pads seconds and millis", () => expect(formatLapTime(61.005)).toBe("1:01.005"));
  it("renders a dash when missing", () => {
    expect(formatLapTime(null)).toBe("–");
    expect(formatLapTime(NaN)).toBe("–");
  });
});

describe("formatSector", () => {
  it("formats seconds under a minute as s.mmm", () => expect(formatSector(17.984)).toBe("17.984"));
  it("falls back to lap format at a minute or more", () => expect(formatSector(61.2)).toBe("1:01.200"));
  it("renders a dash when missing", () => expect(formatSector(undefined)).toBe("–"));
});

describe("formatGap", () => {
  it("prefixes a plus and shows three decimals", () => expect(formatGap(0.409)).toBe("+0.409"));
  it("switches to minutes at 60s", () => expect(formatGap(62.345)).toBe("+1:02.345"));
  it("keeps a zero gap", () => expect(formatGap(0)).toBe("+0.000"));
  it("never shows a negative zero", () => expect(formatGap(-0.0004)).toBe("+0.000"));
  it("renders a dash when missing", () => expect(formatGap(null)).toBe("–"));
});

describe("formatDelta", () => {
  it("always signs non-zero deltas", () => {
    expect(formatDelta(0.409)).toBe("+0.409");
    expect(formatDelta(-1.56)).toBe("−1.560");
  });
  it("leaves zero unsigned", () => expect(formatDelta(0)).toBe("0.000"));
  it("renders a dash when missing", () => expect(formatDelta(NaN)).toBe("–"));
});

describe("teamColor", () => {
  it("matches team names case-insensitively", () => {
    expect(teamColor("Red Bull Racing")).toBe("#3671C6");
    expect(teamColor("FERRARI")).toBe("#E8002D");
    expect(teamColor("McLaren")).toBe("#FF8000");
  });
  it("tells the sister team apart from Red Bull", () => {
    expect(teamColor("Visa Cash App RB")).toBe("#6692FF");
    expect(teamColor("Racing Bulls")).toBe("#6692FF");
  });
  it("falls back for unknown or missing teams", () => {
    expect(teamColor("Some New Team")).toBe(UNKNOWN_TEAM_COLOR);
    expect(teamColor(null)).toBe(UNKNOWN_TEAM_COLOR);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/timing.test.ts`
Expected: FAIL (cannot resolve `./timing`).

- [ ] **Step 3: Implement** `frontend/src/lib/timing.ts`
```ts
// F1 timing conventions in one place: purple = overall best, green = personal
// best, yellow = slower than both. Formatters render missing data as an en dash.

export type TimingClass = "overall-best" | "personal-best" | "off-pace" | "none";

const EPSILON = 1e-6;
const DASH = "–";
const MINUS = "−";

function isTime(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export function classifyTime(
  time: number | null | undefined,
  personalBest: number | null | undefined,
  overallBest: number | null | undefined,
): TimingClass {
  if (!isTime(time)) return "none";
  if (isTime(overallBest) && time <= overallBest + EPSILON) return "overall-best";
  if (isTime(personalBest) && time <= personalBest + EPSILON) return "personal-best";
  return "off-pace";
}

// Full literal class names so Tailwind's scanner sees them.
export const TIMING_TEXT_CLASS: Record<TimingClass, string> = {
  "overall-best": "text-timing-purple",
  "personal-best": "text-timing-green",
  "off-pace": "text-timing-yellow",
  none: "text-chalk",
};

const pad = (n: number, width: number) => String(n).padStart(width, "0");

// Round to whole milliseconds first so 59.9996 becomes 1:00.000, never 0:60.000.
function fromMillis(total: number): string {
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return minutes > 0 ? `${minutes}:${pad(seconds, 2)}.${pad(millis, 3)}` : `${seconds}.${pad(millis, 3)}`;
}

export function formatLapTime(seconds: number | null | undefined): string {
  if (!isTime(seconds)) return DASH;
  const total = Math.round(seconds * 1000);
  const minutes = Math.floor(total / 60000);
  const rest = total % 60000;
  return `${minutes}:${pad(Math.floor(rest / 1000), 2)}.${pad(rest % 1000, 3)}`;
}

export function formatSector(seconds: number | null | undefined): string {
  if (!isTime(seconds)) return DASH;
  const total = Math.round(seconds * 1000);
  return total >= 60000 ? formatLapTime(seconds) : fromMillis(total);
}

export function formatGap(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return DASH;
  const total = Math.round(Math.abs(seconds) * 1000);
  return `${seconds < 0 && total > 0 ? MINUS : "+"}${fromMillis(total)}`;
}

export function formatDelta(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return DASH;
  const total = Math.round(Math.abs(seconds) * 1000);
  if (total === 0) return "0.000";
  return `${seconds < 0 ? MINUS : "+"}${fromMillis(total)}`;
}

export const UNKNOWN_TEAM_COLOR = "#8790A0";

// Order matters: the sister-team names are checked before "red bull".
const TEAM_COLORS: ReadonlyArray<readonly [string, string]> = [
  ["visa cash app rb", "#6692FF"],
  ["racing bulls", "#6692FF"],
  ["alphatauri", "#6692FF"],
  ["toro rosso", "#6692FF"],
  ["red bull", "#3671C6"],
  ["ferrari", "#E8002D"],
  ["mercedes", "#27F4D2"],
  ["mclaren", "#FF8000"],
  ["aston martin", "#229971"],
  ["alpine", "#FF87BC"],
  ["williams", "#64C4FF"],
  ["alfa romeo", "#52E252"],
  ["sauber", "#52E252"],
  ["haas", "#B6BABD"],
];

export function teamColor(team: string | null | undefined): string {
  if (!team) return UNKNOWN_TEAM_COLOR;
  const name = team.toLowerCase();
  return TEAM_COLORS.find(([needle]) => name.includes(needle))?.[1] ?? UNKNOWN_TEAM_COLOR;
}
```
- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/timing.test.ts && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/timing.ts frontend/src/lib/timing.test.ts
git commit -m "feat(ui): timing classification and formatting library

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Search ranking and module registry

**Files:**
- Create: `frontend/src/lib/search.ts`, `frontend/src/lib/search.test.ts`, `frontend/src/lib/modules.ts`, `frontend/src/lib/modules.test.ts`

**Interfaces:**
- Produces: `interface Searchable { label: string; keywords?: readonly string[] }`; `rankMatches<T extends Searchable>(query: string, items: readonly T[], limit?: number): T[]`.
- Produces: `type ModuleGroup = "Live" | "Analysis" | "Race" | "Play" | "More"`; `interface AppModule extends Searchable { id: string; description: string; href: string; group: ModuleGroup; icon: LucideIcon; shortLabel?: string; mobilePrimary?: boolean }`; `MODULES: AppModule[]`; `GROUP_ORDER: ModuleGroup[]`; `findModuleForPath(pathname: string): AppModule | undefined`; `searchModules(query: string): AppModule[]`.

- [ ] **Step 1: Verify the icon names exist** (installed lucide-react is old)

Run:
```bash
node -e "const l=require('lucide-react');for(const n of ['Radio','Map','Activity','Zap','FlaskConical','Trophy','Newspaper','Archive','Target','GitCommit','Search','Menu','X','ChevronDown','ChevronUp','Maximize2','Minimize2','RotateCcw','Loader2','GripVertical'])console.log(n,typeof l[n]!=='undefined')"
```
Expected: all `true`. Any `false`: substitute the closest existing icon and use it consistently below.

- [ ] **Step 2: Write failing tests** `frontend/src/lib/search.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { rankMatches } from "./search";

const items = [
  { label: "Live timing", keywords: ["race", "tower"] },
  { label: "Track map", keywords: ["circuit"] },
  { label: "Head to head", keywords: ["h2h", "compare"] },
  { label: "Strategy simulator", keywords: ["tyre", "pit"] },
];

describe("rankMatches", () => {
  it("returns everything in order for an empty query", () => {
    expect(rankMatches("  ", items)).toEqual(items);
  });
  it("ranks label prefix above word prefix above substring above keywords", () => {
    const list = [
      { label: "Xtiming", keywords: [] },
      { label: "Live timing", keywords: [] },
      { label: "Timing screen", keywords: [] },
      { label: "Other", keywords: ["timing"] },
    ];
    expect(rankMatches("tim", list).map((i) => i.label)).toEqual(["Timing screen", "Live timing", "Xtiming", "Other"]);
  });
  it("matches keywords", () => {
    expect(rankMatches("h2h", items).map((i) => i.label)).toEqual(["Head to head"]);
    expect(rankMatches("tyre", items).map((i) => i.label)).toEqual(["Strategy simulator"]);
  });
  it("ignores case and accents", () => {
    expect(rankMatches("LIVE", items)[0].label).toBe("Live timing");
    expect(rankMatches("Sérgio", [{ label: "Sergio Perez" }]).length).toBe(1);
  });
  it("returns nothing when nothing matches", () => {
    expect(rankMatches("zzz", items)).toEqual([]);
  });
  it("respects the limit", () => {
    expect(rankMatches("", items, 2)).toHaveLength(2);
  });
});
```
`frontend/src/lib/modules.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { findModuleForPath, GROUP_ORDER, MODULES, searchModules } from "./modules";

describe("module registry", () => {
  it("has unique ids and unique absolute hrefs", () => {
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length);
    expect(new Set(MODULES.map((m) => m.href)).size).toBe(MODULES.length);
    for (const m of MODULES) expect(m.href.startsWith("/")).toBe(true);
  });
  it("only uses declared groups", () => {
    for (const m of MODULES) expect(GROUP_ORDER).toContain(m.group);
  });
  it("marks exactly five modules for the mobile tab bar, each with a short label", () => {
    const primary = MODULES.filter((m) => m.mobilePrimary);
    expect(primary).toHaveLength(5);
    for (const m of primary) expect(m.shortLabel).toBeTruthy();
  });
  it("describes every module", () => {
    for (const m of MODULES) expect(m.description.length).toBeGreaterThan(10);
  });
});

describe("findModuleForPath", () => {
  it("matches exact paths", () => expect(findModuleForPath("/live")?.id).toBe("live"));
  it("matches nested paths by prefix", () => expect(findModuleForPath("/compare/x")?.id).toBe("compare"));
  it("does not match a longer sibling name", () => expect(findModuleForPath("/livestock")).toBeUndefined());
  it("returns undefined for the landing page and unknown routes", () => {
    expect(findModuleForPath("/")).toBeUndefined();
    expect(findModuleForPath("/drivers/VER")).toBeUndefined();
  });
});

describe("searchModules", () => {
  it("finds by title", () => expect(searchModules("live")[0].id).toBe("live"));
  it("finds by keyword", () => {
    expect(searchModules("h2h")[0].id).toBe("compare");
    expect(searchModules("tyre")[0].id).toBe("strategy");
  });
  it("returns nothing for gibberish", () => expect(searchModules("zzzz")).toEqual([]));
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/lib/search.test.ts src/lib/modules.test.ts`
Expected: FAIL (modules cannot be resolved).

- [ ] **Step 4: Implement** `frontend/src/lib/search.ts`
```ts
export interface Searchable {
  label: string;
  keywords?: readonly string[];
}

const normalize = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();

// Lower is better; null means no match.
function score(query: string, item: Searchable): number | null {
  const label = normalize(item.label);
  if (label.startsWith(query)) return 0;
  if (label.split(/[\s\-–—/]+/).some((word) => word.startsWith(query))) return 1;
  if (label.includes(query)) return 2;
  const keywords = (item.keywords ?? []).map(normalize);
  if (keywords.some((k) => k.startsWith(query))) return 3;
  if (keywords.some((k) => k.includes(query))) return 4;
  return null;
}

export function rankMatches<T extends Searchable>(query: string, items: readonly T[], limit = Infinity): T[] {
  const q = normalize(query);
  if (!q) return items.slice(0, limit);
  return items
    .map((item, index) => ({ item, index, score: score(q, item) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}
```
`frontend/src/lib/modules.ts` (descriptions reuse the existing landing-page copy)
```ts
import {
  Activity, Archive, FlaskConical, GitCommit, Map as MapIcon, Newspaper, Radio, Target, Trophy, Zap,
  type LucideIcon,
} from "lucide-react";
import { rankMatches, type Searchable } from "./search";

export type ModuleGroup = "Live" | "Analysis" | "Race" | "Play" | "More";

export interface AppModule extends Searchable {
  id: string;
  description: string;
  href: string;
  group: ModuleGroup;
  icon: LucideIcon;
  shortLabel?: string;
  mobilePrimary?: boolean;
}

export const GROUP_ORDER: ModuleGroup[] = ["Live", "Analysis", "Race", "Play", "More"];

// The single source of truth for navigation. The rail, the mobile tab bar, the
// command palette and the landing page all read this list, so a new module is
// one entry here plus its page.
export const MODULES: AppModule[] = [
  { id: "live", label: "Live timing", shortLabel: "Live", mobilePrimary: true, href: "/live", group: "Live", icon: Radio,
    description: "Positions, gaps and tyre ages as they happen, with an AI race engineer on the radio.",
    keywords: ["race", "tower", "positions", "gaps", "sectors"] },
  { id: "map", label: "Track map", shortLabel: "Map", mobilePrimary: true, href: "/map", group: "Live", icon: MapIcon,
    description: "Every car on the circuit in real time, or replay a full race lap by lap.",
    keywords: ["circuit", "cars", "replay"] },
  { id: "compare", label: "Head to head", shortLabel: "Compare", mobilePrimary: true, href: "/compare", group: "Analysis", icon: Activity,
    description: "Overlay two drivers' fastest laps and see exactly where the time was won.",
    keywords: ["h2h", "compare", "telemetry", "laps", "delta"] },
  { id: "advanced", label: "Advanced analytics", href: "/advanced", group: "Analysis", icon: Zap,
    description: "Throttle, brake and coasting behaviour for every driver across a session.",
    keywords: ["pedal", "throttle", "brake", "coasting", "trail braking"] },
  { id: "strategy", label: "Strategy simulator", href: "/strategy", group: "Analysis", icon: FlaskConical,
    description: "Test a tyre strategy against a real session's own degradation data.",
    keywords: ["tyre", "tire", "pit", "stops", "compound"] },
  { id: "stats", label: "Season stats", href: "/stats", group: "Analysis", icon: Trophy,
    description: "Championship standings for every driver and constructor since 2018.",
    keywords: ["standings", "championship", "points", "drivers", "constructors"] },
  { id: "debrief", label: "Race debrief", shortLabel: "Debrief", mobilePrimary: true, href: "/debrief", group: "Race", icon: Newspaper,
    description: "Auto-written race summaries, plus what-if counterfactuals on real strategies.",
    keywords: ["summary", "what if", "recap", "results"] },
  { id: "archive", label: "Archive", href: "/archive", group: "Race", icon: Archive,
    description: "Browse past seasons, calendars and race results.",
    keywords: ["history", "past", "seasons", "calendar"] },
  { id: "predictions", label: "Predictions", shortLabel: "Predict", mobilePrimary: true, href: "/predictions", group: "Play", icon: Target,
    description: "Call the podium before lights-out and climb the season leaderboard.",
    keywords: ["podium", "leaderboard", "game", "pick"] },
  { id: "changelog", label: "Changelog", href: "/changelog", group: "More", icon: GitCommit,
    description: "What changed in Pit Wall, and when.",
    keywords: ["updates", "release", "changes"] },
];

export function findModuleForPath(pathname: string): AppModule | undefined {
  return MODULES.find((m) => pathname === m.href || pathname.startsWith(`${m.href}/`));
}

export function searchModules(query: string): AppModule[] {
  return rankMatches(query, MODULES);
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/lib && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add frontend/src/lib/search.ts frontend/src/lib/search.test.ts frontend/src/lib/modules.ts frontend/src/lib/modules.test.ts
git commit -m "feat(ui): module registry and ranked search

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Workspace layout persistence (`lib/layoutStore.ts`)

**Files:**
- Create: `frontend/src/lib/layoutStore.ts`, `frontend/src/lib/layoutStore.test.ts`

**Interfaces:**
- Produces: `interface PanelLayout { i: string; x: number; y: number; w: number; h: number }`; `type Layouts = Record<string, PanelLayout[]>` (key = breakpoint); `loadLayouts(workspace: string, defaults: Layouts, storage?: StorageLike | null): Layouts`; `saveLayouts(workspace: string, layouts: Layouts, storage?): void`; `resetLayouts(workspace: string, storage?): void`. `StorageLike = Pick<Storage, "getItem"|"setItem"|"removeItem">`.

- [ ] **Step 1: Write the failing tests** `frontend/src/lib/layoutStore.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { loadLayouts, resetLayouts, saveLayouts, type Layouts } from "./layoutStore";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const throwing = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};

const defaults: Layouts = {
  lg: [{ i: "a", x: 0, y: 0, w: 6, h: 4 }, { i: "b", x: 6, y: 0, w: 6, h: 4 }],
  sm: [{ i: "a", x: 0, y: 0, w: 1, h: 4 }, { i: "b", x: 0, y: 4, w: 1, h: 4 }],
};
const moved: Layouts = {
  lg: [{ i: "a", x: 0, y: 0, w: 8, h: 6 }, { i: "b", x: 8, y: 0, w: 4, h: 6 }],
  sm: defaults.sm,
};

describe("layoutStore", () => {
  it("returns the defaults when nothing is saved", () => {
    expect(loadLayouts("live", defaults, new MemoryStorage())).toEqual(defaults);
  });
  it("round-trips a saved layout", () => {
    const s = new MemoryStorage();
    saveLayouts("live", moved, s);
    expect(loadLayouts("live", defaults, s)).toEqual(moved);
  });
  it("keeps workspaces separate", () => {
    const s = new MemoryStorage();
    saveLayouts("live", moved, s);
    expect(loadLayouts("map", defaults, s)).toEqual(defaults);
  });
  it("ignores corrupted JSON", () => {
    const s = new MemoryStorage();
    s.setItem("pitwall.layout.v1.live", "{nope");
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
  });
  it("ignores an unknown version", () => {
    const s = new MemoryStorage();
    s.setItem("pitwall.layout.v1.live", JSON.stringify({ v: 99, layouts: moved }));
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
  });
  it("discards a layout whose panels no longer match the defaults", () => {
    const s = new MemoryStorage();
    saveLayouts("live", { lg: [{ i: "a", x: 0, y: 0, w: 6, h: 4 }], sm: defaults.sm }, s);
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
    saveLayouts("live", { lg: [{ i: "a", x: 0, y: 0, w: 6, h: 4 }, { i: "zzz", x: 6, y: 0, w: 6, h: 4 }], sm: defaults.sm }, s);
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
  });
  it("discards a layout with invalid numbers", () => {
    const s = new MemoryStorage();
    saveLayouts("live", { lg: [{ i: "a", x: -1, y: 0, w: 6, h: 4 }, { i: "b", x: 6, y: 0, w: 0, h: 4 }], sm: defaults.sm }, s);
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
  });
  it("only returns the breakpoints the defaults define", () => {
    const s = new MemoryStorage();
    saveLayouts("live", { ...moved, xl: moved.lg }, s);
    expect(Object.keys(loadLayouts("live", defaults, s)).sort()).toEqual(["lg", "sm"]);
  });
  it("survives storage that throws", () => {
    expect(loadLayouts("live", defaults, throwing)).toEqual(defaults);
    expect(() => saveLayouts("live", moved, throwing)).not.toThrow();
    expect(() => resetLayouts("live", throwing)).not.toThrow();
  });
  it("resets to the defaults", () => {
    const s = new MemoryStorage();
    saveLayouts("live", moved, s);
    resetLayouts("live", s);
    expect(loadLayouts("live", defaults, s)).toEqual(defaults);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/layoutStore.test.ts`
Expected: FAIL (cannot resolve `./layoutStore`).

- [ ] **Step 3: Implement** `frontend/src/lib/layoutStore.ts`
```ts
// Per-browser workspace layouts. Versioned, and validated against the current
// default panels so adding or removing a panel later cannot break saved layouts:
// a stale layout is discarded in favour of the defaults.

export interface PanelLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Layouts = Record<string, PanelLayout[]>;
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const VERSION = 1;
const keyFor = (workspace: string) => `pitwall.layout.v${VERSION}.${workspace}`;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // blocked site data / private windows
  }
}

function validPanel(p: unknown): p is PanelLayout {
  if (typeof p !== "object" || p === null) return false;
  const q = p as Record<string, unknown>;
  const int = (v: unknown, min: number) => typeof v === "number" && Number.isFinite(v) && v >= min;
  return typeof q.i === "string" && int(q.x, 0) && int(q.y, 0) && int(q.w, 1) && int(q.h, 1);
}

function sameIds(a: PanelLayout[], b: PanelLayout[]): boolean {
  return a.length === b.length && new Set(a.map((p) => p.i)).size === a.length && b.every((d) => a.some((p) => p.i === d.i));
}

export function loadLayouts(workspace: string, defaults: Layouts, storage: StorageLike | null = browserStorage()): Layouts {
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(keyFor(workspace));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== VERSION || typeof parsed.layouts !== "object" || parsed.layouts === null) return defaults;
    const stored = parsed.layouts as Record<string, unknown>;
    const result: Layouts = {};
    for (const [breakpoint, panels] of Object.entries(defaults)) {
      const candidate = stored[breakpoint];
      if (!Array.isArray(candidate) || !candidate.every(validPanel) || !sameIds(candidate, panels)) return defaults;
      result[breakpoint] = candidate;
    }
    return result;
  } catch {
    return defaults;
  }
}

export function saveLayouts(workspace: string, layouts: Layouts, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(keyFor(workspace), JSON.stringify({ v: VERSION, layouts }));
  } catch {
    // quota or blocked storage: the layout simply won't persist
  }
}

export function resetLayouts(workspace: string, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(keyFor(workspace));
  } catch {
    // nothing to clean up
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/layoutStore.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/layoutStore.ts frontend/src/lib/layoutStore.test.ts
git commit -m "feat(ui): versioned workspace layout persistence

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Self-hosted fonts and root font wiring

**Files:**
- Create: `frontend/src/fonts/big-shoulders-display-latin-{700,800,900}-normal.woff2`, `frontend/src/fonts/barlow-semi-condensed-latin-{400,500,600,700}-normal.woff2`, `frontend/scripts/measure-fonts.mjs`
- Modify: `frontend/src/app/layout.tsx`

**Interfaces:**
- Produces: CSS variables `--font-display`, `--font-ui` set on `<html>`; `body` uses `font-sans`.

- [ ] **Step 1: Fetch the woff2 files without adding runtime dependencies**
```bash
SCRATCH="C:/Users/arjun/AppData/Local/Temp/claude/C--Users-arjun-f1-pitwall/d55088ff-067b-4806-8dde-d1c09bda824a/scratchpad/fonts"
mkdir -p "$SCRATCH" && cd "$SCRATCH" && npm init -y >/dev/null && npm i @fontsource/big-shoulders-display @fontsource/barlow-semi-condensed >/dev/null
for w in 700 800 900; do cp node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-$w-normal.woff2 /c/Users/arjun/f1-pitwall/frontend/src/fonts/; done
for w in 400 500 600 700; do cp node_modules/@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-$w-normal.woff2 /c/Users/arjun/f1-pitwall/frontend/src/fonts/; done
cd /c/Users/arjun/f1-pitwall/frontend && ls src/fonts
```
Expected: 7 new woff2 files beside the Titillium ones. (Both fonts are SIL OFL; fine to self-host.)

- [ ] **Step 2: Wire the fonts in `layout.tsx`.** Keep the existing `titillium` `localFont` (legacy pages still reference it until Plan 2 cleanup), and add:
```tsx
const display = localFont({
  src: [
    { path: "../fonts/big-shoulders-display-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../fonts/big-shoulders-display-latin-800-normal.woff2", weight: "800", style: "normal" },
    { path: "../fonts/big-shoulders-display-latin-900-normal.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

const ui = localFont({
  src: [
    { path: "../fonts/barlow-semi-condensed-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/barlow-semi-condensed-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/barlow-semi-condensed-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/barlow-semi-condensed-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-ui",
  display: "swap",
});
```
Change `<html lang="en" className={`${titillium.variable}`}>` to `<html lang="en" className={`${display.variable} ${ui.variable} ${titillium.variable}`}>` and the `<body>` className from `bg-black text-white font-titillium antialiased` to `bg-tarmac font-sans text-chalk antialiased`.

- [ ] **Step 3: Write the tabular-figure measurement** `frontend/scripts/measure-fonts.mjs`
```js
// Confirms both faces render tabular figures: "1111" must be exactly as wide as "0000".
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE || "http://localhost:3000";
const b = await launch(9670);
try {
  await b.viewport(1280, 800, false);
  await b.goto(`${BASE}/stats`, 2500);
  const result = await b.eval(`(async () => {
    await document.fonts.ready;
    const out = {};
    for (const [name, family, weight] of [["ui", "var(--font-ui)", 500], ["display", "var(--font-display)", 800]]) {
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
      out[name] = { ones: width("1111"), zeros: width("0000"), sample: width("1:29.526") };
    }
    return out;
  })()`);
  let ok = true;
  for (const [name, m] of Object.entries(result)) {
    const tabular = Math.abs(m.ones - m.zeros) < 0.01;
    ok &&= tabular;
    console.log(`${name.padEnd(8)} 1111=${m.ones.toFixed(2)} 0000=${m.zeros.toFixed(2)} -> ${tabular ? "tabular" : "NOT tabular"}`);
  }
  process.exitCode = ok ? 0 : 1;
} finally {
  await b.close();
}
```

- [ ] **Step 4: Run it** (dev server is running on :3000)

Run: `node scripts/measure-fonts.mjs`
Expected: both lines print `tabular` and exit 0. If `ui` is `NOT tabular`, replace the Barlow files with `@fontsource/ibm-plex-sans-condensed` (weights 400/500/600/700, latin), rename in `layout.tsx`, and re-run until it passes. If `display` is not tabular, that is acceptable only if the display face is never used for aligned columns (it is used for position numerals, single values); record the result in the commit message.

- [ ] **Step 5: Verify visually.** Screenshot `/stats` at 1280px with `b.shot` and confirm body text is Barlow (compare glyph shapes with the earlier Titillium look). Run `npx tsc --noEmit && npx vitest run`.

- [ ] **Step 6: Commit**
```bash
git add frontend/src/fonts frontend/src/app/layout.tsx frontend/scripts/measure-fonts.mjs
git commit -m "feat(ui): self-hosted Big Shoulders Display and Barlow Semi Condensed

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: UI primitives, part A

**Files (all under `frontend/src/components/ui/`):**
- Create: `Button.tsx`, `IconButton.tsx`, `Kbd.tsx`, `Pill.tsx`, `Skeleton.tsx`, `EmptyState.tsx`, `PageHeader.tsx`, `Panel.tsx`, `primitivesA.test.tsx`

**Interfaces:**
- Produces:
  - `Button` (default): props `variant?: "primary"|"secondary"|"ghost"|"danger"` (default `"secondary"`), `size?: "md"|"sm"`, `loading?: boolean` + all `<button>` props; `buttonClass({variant?, size?, className?}): string` for styling links as buttons.
  - `IconButton` (default): `label: string` (becomes `aria-label` and `title`), `size?`, `pressed?`, + button props.
  - `Kbd`, `Pill({tone?: "neutral"|"live"|"purple"|"green"|"yellow"})`, `EmptyState({title, description?, action?, icon?})`, `PageHeader({title, description?, actions?})` (renders the page's single `h1`).
  - `Skeleton` (default, `aria-hidden` block) and named export `Loading({label?, children})` (`role="status"` region with sr-only text).
  - `Panel({title, meta?, actions?, children, className?, bodyClassName?, headerClassName?})`: `<section>` labelled by its `h2`. `headerClassName` lets the workspace add `panel-drag-handle`.

- [ ] **Step 1: Write the failing tests** `primitivesA.test.tsx`
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Button, { buttonClass } from "./Button";
import EmptyState from "./EmptyState";
import IconButton from "./IconButton";
import PageHeader from "./PageHeader";
import Panel from "./Panel";
import Pill from "./Pill";
import { Loading } from "./Skeleton";

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });
  it("is disabled and busy while loading", () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
  });
  it("exposes its classes for links styled as buttons", () => {
    expect(buttonClass({ variant: "primary" })).toContain("bg-chalk");
    expect(buttonClass({ variant: "danger" })).toContain("bg-live");
  });
});

describe("IconButton", () => {
  it("is named by its label", () => {
    render(<IconButton label="Expand panel"><span aria-hidden>+</span></IconButton>);
    const b = screen.getByRole("button", { name: "Expand panel" });
    expect(b).toHaveAttribute("title", "Expand panel");
  });
  it("reports its pressed state", () => {
    render(<IconButton label="Mute" pressed><span aria-hidden>m</span></IconButton>);
    expect(screen.getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Panel", () => {
  it("is a region named by its title", () => {
    render(<Panel title="Race tower"><p>rows</p></Panel>);
    expect(screen.getByRole("region", { name: "Race tower" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Race tower" })).toBeInTheDocument();
  });
  it("renders meta and actions in the header", () => {
    render(<Panel title="T" meta="Lap 14/58" actions={<button>Go</button>}>x</Panel>);
    expect(screen.getByText("Lap 14/58")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });
});

describe("PageHeader", () => {
  it("renders exactly one h1", () => {
    render(<PageHeader title="Season stats" description="Standings" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("Loading", () => {
  it("announces itself politely with readable text", () => {
    render(<Loading label="Loading standings"><div /></Loading>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading standings");
  });
});

describe("EmptyState and Pill", () => {
  it("shows the title, description and action", () => {
    render(<EmptyState title="No races yet" description="Pick a season." action={<button>Change season</button>} />);
    expect(screen.getByText("No races yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change season" })).toBeInTheDocument();
  });
  it("renders pill text", () => {
    render(<Pill tone="green">Personal best</Pill>);
    expect(screen.getByText("Personal best")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/ui/primitivesA.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the components**

`Button.tsx`
```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const VARIANT: Record<Variant, string> = {
  primary: "bg-chalk text-tarmac hover:bg-white",
  secondary: "border border-edge text-chalk hover:bg-raised",
  ghost: "text-mute hover:bg-raised hover:text-chalk",
  danger: "bg-live text-white hover:bg-live/90",
};
// "sm" is compact only where a pointer is available; phones keep the 40px target.
const SIZE: Record<Size, string> = {
  md: "h-10 px-4 text-sm",
  sm: "h-10 px-3 text-sm md:h-8 md:text-xs",
};

export function buttonClass({ variant = "secondary", size = "md", className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading = false, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, className })}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export default Button;
```
`IconButton.tsx`
```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  label: string;
  pressed?: boolean;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, pressed, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-control text-mute transition-colors hover:bg-raised hover:text-chalk md:h-8 md:w-8",
        pressed && "bg-raised text-chalk",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
```
`Kbd.tsx`
```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export default function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("rounded-control border border-edge px-1.5 py-0.5 text-[11px] font-medium leading-none text-mute", className)}>
      {children}
    </kbd>
  );
}
```
`Pill.tsx`
```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "live" | "purple" | "green" | "yellow";
const TONE: Record<Tone, string> = {
  neutral: "border-edge text-mute",
  live: "border-live/60 text-live-text",
  purple: "border-timing-purple/60 text-timing-purple",
  green: "border-timing-green/60 text-timing-green",
  yellow: "border-timing-yellow/60 text-timing-yellow",
};

export default function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums", TONE[tone], className)}>
      {children}
    </span>
  );
}
```
`Skeleton.tsx`
```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export default function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-gantry", className)} />;
}

// One polite live region per loading area, instead of one per placeholder block.
export function Loading({ label = "Loading", children }: { label?: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
```
`EmptyState.tsx`
```tsx
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export default function EmptyState({
  title, description, action, icon: Icon, className,
}: { title: string; description?: string; action?: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}>
      {Icon && <Icon className="h-6 w-6 text-faint" aria-hidden />}
      <p className="text-sm font-semibold text-chalk">{title}</p>
      {description && <p className="max-w-sm text-sm text-mute">{description}</p>}
      {action}
    </div>
  );
}
```
`PageHeader.tsx`
```tsx
import type { ReactNode } from "react";

export default function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 pb-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-extrabold leading-none tracking-tight text-chalk md:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-prose text-sm text-mute">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
```
`Panel.tsx`
```tsx
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PanelProps {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
}

export default function Panel({ title, meta, actions, children, className, bodyClassName, headerClassName }: PanelProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("flex min-h-0 flex-col rounded-panel border border-gantry bg-kerb", className)}>
      <header className={cn("flex h-11 shrink-0 items-center gap-3 border-b border-gantry px-3", headerClassName)}>
        <h2 id={headingId} className="truncate text-sm font-semibold text-chalk">{title}</h2>
        {meta && <div className="truncate text-xs tabular-nums text-mute">{meta}</div>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/ui && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/ui
git commit -m "feat(ui): Button, IconButton, Panel, Pill, Skeleton, EmptyState, PageHeader

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: UI primitives, part B (Select, Input, Tabs, DataTable)

**Files (under `frontend/src/components/ui/`):**
- Create: `Select.tsx`, `Input.tsx`, `Tabs.tsx`, `DataTable.tsx`, `primitivesB.test.tsx`

**Interfaces:**
- Produces:
  - `Select({label, hideLabel?, id?, className?, selectClassName?, ...selectProps})`: always renders a real `<label>`.
  - `Input({label, hint?, error?, id?, className?, ...inputProps})`: sets `aria-invalid` and `aria-describedby` for hint/error.
  - `Tabs({tabs: TabItem[], value, onChange, idBase, label, className?})`; named exports `TabItem`, `tabId(base, id)`, `tabPanelProps(base, id)`.
  - `DataTable<T>({columns: Column<T>[], rows, rowKey, caption, accent?, dense?, className?})` with `Column<T> = { key: string; header: string; align?: "left"|"right"|"center"; className?: string; cell: (row: T) => ReactNode }`. `accent(row)` returns a colour for a 3px inset team spine on the row's first cell.

- [ ] **Step 1: Write the failing tests** `primitivesB.test.tsx`
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import DataTable from "./DataTable";
import Input from "./Input";
import Select from "./Select";
import Tabs, { tabPanelProps } from "./Tabs";

describe("Select", () => {
  it("is labelled by a real label", () => {
    render(<Select label="Season"><option>2025</option></Select>);
    expect(screen.getByLabelText("Season")).toBeInTheDocument();
  });
  it("keeps the label for screen readers when visually hidden", () => {
    render(<Select label="Season" hideLabel><option>2025</option></Select>);
    expect(screen.getByLabelText("Season")).toBeInTheDocument();
    expect(screen.getByText("Season")).toHaveClass("sr-only");
  });
});

describe("Input", () => {
  it("links the hint and marks errors invalid", () => {
    render(<Input label="Password" hint="At least 8 characters" error="Too short" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Too short/);
    expect(screen.getByRole("alert")).toHaveTextContent("Too short");
  });
  it("is valid without an error", () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
  });
});

function Harness() {
  const [value, setValue] = useState("a");
  return (
    <>
      <Tabs
        label="View" idBase="t" value={value} onChange={setValue}
        tabs={[{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }]}
      />
      <div {...tabPanelProps("t", value)}>panel {value}</div>
    </>
  );
}

describe("Tabs", () => {
  it("selects with arrow keys, wraps, and supports Home/End", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true");
  });
  it("only the selected tab is in the tab order and it controls the panel", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Alpha");
  });
});

describe("DataTable", () => {
  const rows = [
    { code: "VER", time: "1:29.526" },
    { code: "NOR", time: "1:29.890" },
  ];
  const columns = [
    { key: "code", header: "Driver", cell: (r: (typeof rows)[number]) => r.code },
    { key: "time", header: "Best lap", align: "right" as const, cell: (r: (typeof rows)[number]) => r.time },
  ];
  it("is an accessible table with a caption and column headers", () => {
    render(<DataTable caption="Fastest laps" columns={columns} rows={rows} rowKey={(r) => r.code} />);
    expect(screen.getByRole("table", { name: "Fastest laps" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Driver", "Best lap"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
  it("draws the team spine on the first cell of each row", () => {
    render(<DataTable caption="c" columns={columns} rows={rows} rowKey={(r) => r.code} accent={() => "#FF8000"} />);
    // jsdom may serialise the colour as hex or rgb(); accept either.
    expect(screen.getByText("VER").closest("td")?.getAttribute("style")).toMatch(/inset 3px 0(px)? 0(px)? (#ff8000|rgb\(255, 128, 0\))/i);
    expect(screen.getByText("1:29.526").closest("td")?.getAttribute("style") ?? "").not.toMatch(/inset/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/ui/primitivesB.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`Select.tsx`
```tsx
import { useId, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  label: string;
  hideLabel?: boolean;
  className?: string;
  selectClassName?: string;
}

export default function Select({ label, hideLabel = false, id, className, selectClassName, children, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={selectId} className={cn("text-xs font-medium text-mute", hideLabel && "sr-only")}>{label}</label>
      <div className="relative">
        <select
          id={selectId}
          className={cn("h-10 w-full appearance-none rounded-control border border-edge bg-raised pl-3 pr-9 text-sm text-chalk disabled:opacity-50", selectClassName)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
      </div>
    </div>
  );
}
```
`Input.tsx`
```tsx
import { useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
}

export default function Input({ label, hint, error, id, className, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={inputId} className="text-xs font-medium text-mute">{label}</label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={cn(
          "h-10 w-full rounded-control border bg-raised px-3 text-sm text-chalk placeholder:text-faint disabled:opacity-50",
          error ? "border-live-text" : "border-edge",
        )}
        {...rest}
      />
      {hint && <p id={hintId} className="text-xs text-faint">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-xs text-live-text">{error}</p>}
    </div>
  );
}
```
`Tabs.tsx`
```tsx
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  id: string;
  label: string;
}

export const tabId = (base: string, id: string) => `${base}-tab-${id}`;

// Spread onto the element that shows the selected tab's content.
export function tabPanelProps(base: string, id: string) {
  return { role: "tabpanel" as const, id: `${base}-panel-${id}`, "aria-labelledby": tabId(base, id), tabIndex: 0 };
}

interface TabsProps {
  tabs: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  idBase: string;
  label: string;
  className?: string;
}

export default function Tabs({ tabs, value, onChange, idBase, label, className }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((t) => t.id === value);
    if (e.key === "ArrowRight") { e.preventDefault(); move(current + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(current - 1); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(tabs.length - 1); }
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn("flex gap-1 border-b border-gantry", className)}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[tab.id] = el; }}
            role="tab"
            type="button"
            id={tabId(idBase, tab.id)}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "-mb-px h-10 border-b-2 px-3 text-sm font-medium transition-colors",
              selected ? "border-chalk text-chalk" : "border-transparent text-mute hover:text-chalk",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
```
`DataTable.tsx`
```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  className?: string;
  cell: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  caption: string;
  accent?: (row: T) => string | undefined;
  dense?: boolean;
  className?: string;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export default function DataTable<T>({ columns, rows, rowKey, caption, accent, dense = false, className }: DataTableProps<T>) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn("sticky top-0 border-b border-gantry bg-kerb px-3 py-2 text-xs font-medium text-mute", ALIGN[c.align ?? "left"])}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const spine = accent?.(row);
            return (
              <tr key={rowKey(row)} className="border-b border-gantry/60 hover:bg-raised/60">
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    style={i === 0 && spine ? { boxShadow: `inset 3px 0 0 ${spine}` } : undefined}
                    className={cn("px-3 text-chalk", dense ? "py-1.5" : "py-2.5", ALIGN[c.align ?? "left"], c.className)}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/ui && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/ui
git commit -m "feat(ui): Select, Input, Tabs and DataTable primitives

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Shared chart theme

**Files:**
- Create: `frontend/src/components/charts/chartTheme.ts`, `frontend/src/components/charts/chartTheme.test.ts`

**Interfaces:**
- Consumes: `teamColor`, `UNKNOWN_TEAM_COLOR` from `@/lib/timing`.
- Produces: `CHART` (props objects for Recharts `CartesianGrid`, axes, `Tooltip`, `Legend`), `seriesColor(team, index): string`, `seriesDash(index): string | undefined`.

- [ ] **Step 1: Write the failing test** `chartTheme.test.ts` (guards drift between the hex values here and the CSS tokens)
```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHART, seriesColor, seriesDash } from "./chartTheme";

const css = readFileSync(new URL("../../design/tokens.css", import.meta.url), "utf8");
function hex(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`))!;
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
}

describe("chartTheme", () => {
  it("uses the exact token colours", () => {
    expect(CHART.grid.stroke.toUpperCase()).toBe(hex("gantry"));
    expect(CHART.axis.tick.fill.toUpperCase()).toBe(hex("mute"));
    expect(CHART.tooltip.contentStyle.background.toUpperCase()).toBe(hex("raised"));
    expect(CHART.tooltip.contentStyle.color.toUpperCase()).toBe(hex("chalk"));
    expect(CHART.tooltip.cursor.stroke.toUpperCase()).toBe(hex("edge"));
  });
  it("uses the team colour when the team is known", () => {
    expect(seriesColor("McLaren", 0)).toBe("#FF8000");
  });
  it("falls back to neutral greys by index for unknown teams", () => {
    expect(seriesColor(null, 0)).toBe("#E8EBEF");
    expect(seriesColor("???", 1)).toBe("#A6AEBB");
  });
  it("dashes every second series so teammates stay distinguishable", () => {
    expect(seriesDash(0)).toBeUndefined();
    expect(seriesDash(1)).toBe("6 4");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/charts`
Expected: FAIL (cannot resolve `./chartTheme`).

- [ ] **Step 3: Implement** `chartTheme.ts`
```ts
import { teamColor, UNKNOWN_TEAM_COLOR } from "@/lib/timing";

// Recharts takes literal colours, not CSS variables. These mirror
// src/design/tokens.css; chartTheme.test.ts fails if they drift.
export const CHART = {
  grid: { stroke: "#2A303A", strokeDasharray: "2 4", vertical: false },
  axis: {
    stroke: "#2A303A",
    tickLine: false,
    tick: { fill: "#A6AEBB", fontSize: 11 },
  },
  tooltip: {
    contentStyle: {
      background: "#232832",
      border: "1px solid #2A303A",
      borderRadius: 6,
      color: "#E8EBEF",
      fontSize: 12,
    },
    labelStyle: { color: "#A6AEBB" },
    itemStyle: { color: "#E8EBEF" },
    cursor: { stroke: "#6C7789", strokeWidth: 1 },
  },
  legend: { wrapperStyle: { color: "#A6AEBB", fontSize: 12 } },
} as const;

const NEUTRAL_SERIES = ["#E8EBEF", "#A6AEBB", "#6C7789"] as const;

// Team colour when we know the team, otherwise a neutral grey by position.
export function seriesColor(team: string | null | undefined, index: number): string {
  const color = teamColor(team);
  return color === UNKNOWN_TEAM_COLOR ? NEUTRAL_SERIES[index % NEUTRAL_SERIES.length] : color;
}

// Teammates share a colour, so the second series is dashed.
export function seriesDash(index: number): string | undefined {
  return index % 2 === 1 ? "6 4" : undefined;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/charts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/charts
git commit -m "feat(ui): shared Recharts theme

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Command palette (view, sources, store)

**Files:**
- Create: `frontend/src/store/usePaletteStore.ts`, `frontend/src/components/shell/paletteItems.ts`, `paletteItems.test.ts`, `usePaletteSources.ts`, `PaletteView.tsx`, `PaletteView.test.tsx`, `CommandPalette.tsx`

**Interfaces:**
- Consumes: `MODULES` (`@/lib/modules`), `rankMatches` (`@/lib/search`), `Kbd`, `cn`.
- Produces:
  - `usePaletteStore`: `{ open: boolean; setOpen(open: boolean): void; toggle(): void }`.
  - `type PaletteSection = "Pages" | "Drivers" | "Races"`; `interface PaletteItem extends Searchable { id: string; section: PaletteSection; href: string; hint?: string; icon?: LucideIcon }`; `moduleItems(): PaletteItem[]`; `driverItems(drivers: {code: string; name: string; team: string}[]): PaletteItem[]`; `raceItems(races: RaceSummary[], year: number, now?: Date): PaletteItem[]`; `groupBySection(items): {section; items; start: number}[]`; `RaceSummary = { event_name: string; country: string; race_start_utc: string | null }`.
  - `PaletteView({open, items, onClose, onSelect})`; `CommandPalette()` (global, mounted once by the shell).

- [ ] **Step 1: Write failing tests**

`paletteItems.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { driverItems, groupBySection, moduleItems, raceItems } from "./paletteItems";

describe("paletteItems", () => {
  it("lists every module as a page", () => {
    const items = moduleItems();
    expect(items.every((i) => i.section === "Pages")).toBe(true);
    expect(items.find((i) => i.label === "Live timing")?.href).toBe("/live");
  });
  it("builds driver items searchable by code and team", () => {
    const [item] = driverItems([{ code: "NOR", name: "Lando Norris", team: "McLaren" }]);
    expect(item).toMatchObject({ section: "Drivers", label: "Lando Norris", href: "/drivers/NOR", hint: "McLaren" });
    expect(item.keywords).toContain("NOR");
  });
  it("only offers races that have started, newest first as given, with encoded links", () => {
    const now = new Date("2026-09-21T12:00:00Z");
    const items = raceItems(
      [
        { event_name: "Italian Grand Prix", country: "Italy", race_start_utc: "2026-09-06T13:00:00Z" },
        { event_name: "Singapore Grand Prix", country: "Singapore", race_start_utc: "2026-10-04T12:00:00Z" },
        { event_name: "Unknown Grand Prix", country: "X", race_start_utc: null },
      ],
      2026,
      now,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      section: "Races",
      label: "Italian Grand Prix",
      href: "/debrief?year=2026&race=Italian%20Grand%20Prix",
      hint: "2026",
    });
  });
  it("groups in a fixed order and records each group's start index", () => {
    const groups = groupBySection([
      { id: "r", section: "Races", label: "R", href: "/r" },
      { id: "p", section: "Pages", label: "P", href: "/p" },
      { id: "d", section: "Drivers", label: "D", href: "/d" },
      { id: "p2", section: "Pages", label: "P2", href: "/p2" },
    ]);
    expect(groups.map((g) => g.section)).toEqual(["Pages", "Drivers", "Races"]);
    expect(groups.map((g) => g.start)).toEqual([0, 2, 3]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["p", "p2"]);
  });
});
```
`PaletteView.test.tsx`
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PaletteView from "./PaletteView";
import type { PaletteItem } from "./paletteItems";

const items: PaletteItem[] = [
  { id: "p:live", section: "Pages", label: "Live timing", href: "/live", keywords: ["race"] },
  { id: "p:map", section: "Pages", label: "Track map", href: "/map" },
  { id: "d:NOR", section: "Drivers", label: "Lando Norris", href: "/drivers/NOR", hint: "McLaren", keywords: ["NOR"] },
];

function setup(open = true) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  render(<PaletteView open={open} items={items} onClose={onClose} onSelect={onSelect} />);
  return { onClose, onSelect, user: userEvent.setup() };
}

describe("PaletteView", () => {
  it("renders nothing when closed", () => {
    setup(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("is a modal dialog with a focused combobox and a listbox", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Search" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });
  it("filters as you type", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("combobox"), "norr");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Lando NorrisMcLaren"]);
  });
  it("moves the active option with arrow keys and wraps", async () => {
    const { user } = setup();
    const box = screen.getByRole("combobox");
    const options = () => screen.getAllByRole("option");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options()[0].id);
    await user.keyboard("{ArrowDown}");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(options()[2]).toHaveAttribute("aria-selected", "true");
  });
  it("selects the active option with Enter", async () => {
    const { user, onSelect } = setup();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });
  it("selects an option on click", async () => {
    const { user, onSelect } = setup();
    await user.click(screen.getByRole("option", { name: /Lando Norris/ }));
    expect(onSelect).toHaveBeenCalledWith(items[2]);
  });
  it("closes on Escape", async () => {
    const { user, onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
  it("explains an empty result and gives direction", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("combobox"), "zzzz");
    expect(screen.getByRole("status")).toHaveTextContent(/No matches for “zzzz”/);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
  it("does nothing on Enter when there is no match", async () => {
    const { user, onSelect } = setup();
    await user.type(screen.getByRole("combobox"), "zzzz{Enter}");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/shell`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`frontend/src/store/usePaletteStore.ts`
```ts
import { create } from "zustand";

interface PaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
```
`frontend/src/components/shell/paletteItems.ts`
```ts
import type { LucideIcon } from "lucide-react";
import { MODULES } from "@/lib/modules";
import type { Searchable } from "@/lib/search";

export type PaletteSection = "Pages" | "Drivers" | "Races";
const SECTION_ORDER: readonly PaletteSection[] = ["Pages", "Drivers", "Races"];

export interface PaletteItem extends Searchable {
  id: string;
  section: PaletteSection;
  href: string;
  hint?: string;
  icon?: LucideIcon;
}

export interface RaceSummary {
  event_name: string;
  country: string;
  race_start_utc: string | null;
}

export function moduleItems(): PaletteItem[] {
  return MODULES.map((m) => ({
    id: `page:${m.id}`,
    section: "Pages",
    label: m.label,
    href: m.href,
    hint: m.group,
    icon: m.icon,
    keywords: m.keywords,
  }));
}

export function driverItems(drivers: readonly { code: string; name: string; team: string }[]): PaletteItem[] {
  return drivers.map((d) => ({
    id: `driver:${d.code}`,
    section: "Drivers",
    label: d.name,
    href: `/drivers/${d.code}`,
    hint: d.team,
    keywords: [d.code, d.team, "driver"],
  }));
}

// Only races that have started can be debriefed.
export function raceItems(races: readonly RaceSummary[], year: number, now: Date = new Date()): PaletteItem[] {
  return races
    .filter((r) => r.race_start_utc !== null && Date.parse(r.race_start_utc) < now.getTime())
    .map((r) => ({
      id: `race:${year}:${r.event_name}`,
      section: "Races" as const,
      label: r.event_name,
      href: `/debrief?year=${year}&race=${encodeURIComponent(r.event_name)}`,
      hint: String(year),
      keywords: [r.country, "debrief", "race"],
    }));
}

export function groupBySection(items: readonly PaletteItem[]): { section: PaletteSection; items: PaletteItem[]; start: number }[] {
  const groups: { section: PaletteSection; items: PaletteItem[]; start: number }[] = [];
  let start = 0;
  for (const section of SECTION_ORDER) {
    const inSection = items.filter((i) => i.section === section);
    if (inSection.length === 0) continue;
    groups.push({ section, items: inSection, start });
    start += inSection.length;
  }
  return groups;
}
```
`frontend/src/components/shell/usePaletteSources.ts`
```ts
"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import { driverItems, raceItems, type PaletteItem } from "./paletteItems";

interface StandingsDriver { driver_code: string; driver_name: string; team_name: string }

let cached: Promise<PaletteItem[]> | null = null;

async function load(): Promise<PaletteItem[]> {
  const year = new Date().getFullYear();
  const [standings, thisYear, lastYear] = await Promise.allSettled([
    axios.get(`/api/v1/stats/standings?year=${year}`),
    axios.get(`/api/v1/races/historical?year=${year}`),
    axios.get(`/api/v1/races/historical?year=${year - 1}`),
  ]);
  const items: PaletteItem[] = [];
  if (standings.status === "fulfilled") {
    items.push(
      ...driverItems(
        (standings.value.data.driver_standings as StandingsDriver[]).map((d) => ({
          code: d.driver_code, name: d.driver_name, team: d.team_name,
        })),
      ),
    );
  }
  // Newest race first: the schedule is chronological, so reverse each season.
  for (const [result, y] of [[thisYear, year], [lastYear, year - 1]] as const) {
    if (result.status === "fulfilled") items.push(...raceItems(result.value.data, y).reverse());
  }
  return items;
}

// Fetched once, the first time the palette opens. A total failure is not cached,
// so the next open retries; pages stay searchable either way.
export function usePaletteSources(enabled: boolean): PaletteItem[] {
  const [items, setItems] = useState<PaletteItem[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const request = (cached ??= load());
    let live = true;
    request.then((result) => {
      if (result.length === 0) cached = null;
      if (live) setItems(result);
    });
    return () => { live = false; };
  }, [enabled]);
  return items;
}
```
`frontend/src/components/shell/PaletteView.tsx`
```tsx
"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import Kbd from "@/components/ui/Kbd";
import { cn } from "@/lib/cn";
import { rankMatches } from "@/lib/search";
import { groupBySection, type PaletteItem } from "./paletteItems";

interface PaletteViewProps {
  open: boolean;
  items: readonly PaletteItem[];
  onClose: () => void;
  onSelect: (item: PaletteItem) => void;
}

export default function PaletteView({ open, items, onClose, onSelect }: PaletteViewProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const groups = useMemo(() => groupBySection(rankMatches(query, items, 40)), [query, items]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setActive(0), [query]);

  // Focus in, restore focus on close, and freeze page scroll while open.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
      setQuery("");
    };
  }, [open]);

  const optionId = (index: number) => `${listId}-opt-${index}`;
  const activeId = flat[active] ? optionId(active) : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      // Two focus stops (input, and the close button on phones): keep focus inside.
      e.preventDefault();
      const other = document.activeElement === inputRef.current ? closeRef.current : inputRef.current;
      (other && other.offsetParent !== null ? other : inputRef.current)?.focus();
      return;
    }
    if (e.target !== inputRef.current) return;
    if (e.key === "ArrowDown" && flat.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % flat.length);
    } else if (e.key === "ArrowUp" && flat.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      onSelect(flat[active]);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-tarmac/80 backdrop-blur-sm md:px-4 md:pt-[12vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onKeyDown={onKeyDown}
        className="flex h-full w-full flex-col overflow-hidden border-gantry bg-kerb md:h-auto md:max-h-[70vh] md:max-w-xl md:rounded-panel md:border"
      >
        <div className="flex items-center gap-3 border-b border-gantry px-4 focus-within:border-chalk">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-mute" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-label="Search pages, drivers and races"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, drivers and races"
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-chalk placeholder:text-faint focus-visible:outline-none"
          />
          <Kbd className="hidden md:inline">Esc</Kbd>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="grid h-10 w-10 place-items-center rounded-control text-mute hover:bg-raised md:hidden"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>

        <div id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
          {flat.length === 0 ? (
            <p role="status" className="px-3 py-8 text-center text-sm text-mute">
              No matches for “{query}”. Try a driver name, a race or a page name.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.section} role="group" aria-label={group.section} className="mb-2 last:mb-0">
                <p aria-hidden className="px-3 py-1.5 text-xs font-medium text-faint">{group.section}</p>
                {group.items.map((item, offset) => {
                  const index = group.start + offset;
                  const selected = index === active;
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActive(index)}
                      onClick={() => onSelect(item)}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-sm",
                        selected ? "bg-raised" : "",
                      )}
                    >
                      {Icon && <Icon aria-hidden className="h-4 w-4 shrink-0 text-mute" />}
                      <span className="truncate font-medium text-chalk">{item.label}</span>
                      {item.hint && <span className="ml-auto truncate text-xs text-faint">{item.hint}</span>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```
`frontend/src/components/shell/CommandPalette.tsx`
```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { usePaletteStore } from "@/store/usePaletteStore";
import { moduleItems, type PaletteItem } from "./paletteItems";
import PaletteView from "./PaletteView";
import { usePaletteSources } from "./usePaletteSources";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export default function CommandPalette() {
  const router = useRouter();
  const { open, setOpen, toggle } = usePaletteStore();
  const sources = usePaletteSources(open);
  const items = useMemo(() => [...moduleItems(), ...sources], [sources]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, setOpen]);

  const onSelect = (item: PaletteItem) => {
    setOpen(false);
    router.push(item.href);
  };

  return <PaletteView open={open} items={items} onClose={() => setOpen(false)} onSelect={onSelect} />;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all suites PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/store/usePaletteStore.ts frontend/src/components/shell
git commit -m "feat(ui): accessible command palette

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: App shell (rail, top bar, mobile tab bar) and layout swap

**Files:**
- Create: `frontend/src/components/shell/Rail.tsx`, `TopBar.tsx`, `AccountControl.tsx`, `MobileTabBar.tsx`, `AppShell.tsx`
- Modify: `frontend/src/app/layout.tsx`
- Delete: `frontend/src/components/NavigationBar.tsx`

**Interfaces:**
- Consumes: `MODULES`, `GROUP_ORDER`, `findModuleForPath`; `usePaletteStore`; `useF1Store` (`activeSession`, `isConnected`, `weather`, `currentUser`, `setCurrentUser`); `buttonClass`/`Button`, `Kbd`, `cn`; `CommandPalette`.
- Produces: `AppShell({children})` used by the root layout; `<main id="main">` is the skip-link target.

- [ ] **Step 1: Implement** `Rail.tsx`
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { findModuleForPath, GROUP_ORDER, MODULES } from "@/lib/modules";

export default function Rail() {
  const current = findModuleForPath(usePathname());
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-14 overflow-hidden border-r border-gantry bg-tarmac transition-[width] duration-150 hover:w-56 focus-within:w-56 md:block">
      <nav aria-label="Main" className="flex h-full flex-col px-2 py-3">
        <Link href="/" aria-label="Pit Wall home" className="mb-3 flex h-10 items-center gap-3 rounded-control px-2.5 hover:bg-raised">
          <span aria-hidden className="h-5 w-1.5 shrink-0 rounded-sm bg-live" />
          <span className="whitespace-nowrap font-display text-xl font-extrabold text-chalk">Pit Wall</span>
        </Link>
        {GROUP_ORDER.map((group, index) => (
          <div
            key={group}
            role="group"
            aria-label={group}
            className={cn("flex flex-col gap-1", index > 0 && "mt-2 border-t border-gantry pt-2")}
          >
            {MODULES.filter((m) => m.group === group).map((m) => {
              const active = current?.id === m.id;
              const Icon = m.icon;
              return (
                <Link
                  key={m.id}
                  href={m.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-3 whitespace-nowrap rounded-control px-2.5 text-sm font-medium transition-colors",
                    active ? "bg-raised text-chalk shadow-[inset_2px_0_0_rgb(var(--chalk))]" : "text-mute hover:bg-raised hover:text-chalk",
                  )}
                >
                  <Icon aria-hidden className="h-5 w-5 shrink-0" />
                  <span>{m.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
```
`AccountControl.tsx` (logout behaviour is carried over unchanged from the old `NavigationBar`)
```tsx
"use client";

import axios from "axios";
import Link from "next/link";
import { useState } from "react";
import Button, { buttonClass } from "@/components/ui/Button";
import { useF1Store } from "@/store/useTelemetryStore";

export default function AccountControl() {
  const { currentUser, setCurrentUser } = useF1Store();
  const [logoutFailed, setLogoutFailed] = useState(false);

  const handleLogout = async () => {
    setLogoutFailed(false);
    try {
      await axios.post("/api/v1/auth/logout");
    } catch (err: any) {
      // 401 means the session was already gone server-side, so we're logged out
      // either way. Anything else (offline, server error) means the session may
      // still be live -- don't pretend otherwise.
      if (err?.response?.status !== 401) {
        setLogoutFailed(true);
        return;
      }
    }
    setCurrentUser(null);
  };

  if (!currentUser) {
    return <Link href="/login" className={buttonClass({ variant: "secondary", size: "sm" })}>Log in</Link>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-[10rem] truncate text-sm text-mute sm:inline" title={currentUser.email}>
        {currentUser.display_name}
      </span>
      <Button size="sm" variant="ghost" onClick={handleLogout}>{logoutFailed ? "Retry log out" : "Log out"}</Button>
      {logoutFailed && <span role="alert" className="hidden text-xs text-live-text lg:inline">Couldn't log out. Check your connection and retry.</span>}
    </div>
  );
}
```
`TopBar.tsx`
```tsx
"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Kbd from "@/components/ui/Kbd";
import { cn } from "@/lib/cn";
import { usePaletteStore } from "@/store/usePaletteStore";
import { useF1Store } from "@/store/useTelemetryStore";
import AccountControl from "./AccountControl";

export default function TopBar() {
  const { activeSession, isConnected, weather } = useF1Store();
  const setOpen = usePaletteStore((s) => s.setOpen);
  const [modKey, setModKey] = useState("Ctrl");
  useEffect(() => {
    if (/mac|iphone|ipad/i.test(navigator.platform)) setModKey("⌘");
  }, []);

  return (
    <header className="sticky top-0 z-20 flex min-h-12 items-center gap-3 border-b border-gantry bg-tarmac/90 px-4 backdrop-blur md:px-6">
      <Link href="/" className="font-display text-xl font-extrabold text-chalk md:hidden">Pit Wall</Link>

      <p className="hidden min-w-0 truncate text-sm md:block">
        {activeSession ? (
          <>
            <span className="font-semibold text-chalk">{activeSession.circuit_short_name}</span>{" "}
            <span className="text-mute">{activeSession.session_name}, {activeSession.year}</span>
          </>
        ) : (
          <span className="text-mute">Syncing sessions…</span>
        )}
      </p>

      <div className="ml-auto flex items-center gap-3">
        {weather && (
          <p className="hidden gap-3 text-xs tabular-nums text-mute lg:flex">
            <span>Air {weather.air_temperature}°</span>
            <span>Track {weather.track_temperature}°</span>
            <span>{weather.rainfall === 1 ? "Wet" : "Dry"}</span>
          </p>
        )}
        <span className="flex items-center gap-2 text-xs text-mute">
          <span aria-hidden className={cn("h-2 w-2 rounded-full", isConnected ? "animate-pulse bg-live" : "border border-faint")} />
          {isConnected ? "Live" : "Offline"}
        </span>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label="Search" aria-keyshortcuts="Control+K">
          <Search aria-hidden className="h-4 w-4" />
          <span className="hidden sm:inline">Search</span>
          <Kbd className="hidden md:inline">{modKey} K</Kbd>
        </Button>
        <AccountControl />
      </div>
    </header>
  );
}
```
`MobileTabBar.tsx`
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/cn";
import { findModuleForPath, MODULES } from "@/lib/modules";
import { usePaletteStore } from "@/store/usePaletteStore";

const PRIMARY = MODULES.filter((m) => m.mobilePrimary);

export default function MobileTabBar() {
  const current = findModuleForPath(usePathname());
  const setOpen = usePaletteStore((s) => s.setOpen);
  const item = "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors";
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-gantry bg-tarmac pb-[env(safe-area-inset-bottom)] md:hidden">
      {PRIMARY.map((m) => {
        const active = current?.id === m.id;
        const Icon = m.icon;
        return (
          <Link key={m.id} href={m.href} aria-current={active ? "page" : undefined} className={cn(item, active ? "text-chalk" : "text-mute")}>
            <Icon aria-hidden className="h-5 w-5" />
            {m.shortLabel}
          </Link>
        );
      })}
      <button type="button" onClick={() => setOpen(true)} aria-label="More pages and search" className={cn(item, "text-mute")}>
        <Menu aria-hidden className="h-5 w-5" />
        More
      </button>
    </nav>
  );
}
```
`AppShell.tsx`
```tsx
import type { ReactNode } from "react";
import CommandPalette from "./CommandPalette";
import MobileTabBar from "./MobileTabBar";
import Rail from "./Rail";
import TopBar from "./TopBar";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-chalk focus:px-3 focus:py-2 focus:text-tarmac"
      >
        Skip to content
      </a>
      <Rail />
      <div className="min-h-dvh md:pl-14">
        <TopBar />
        <main id="main" tabIndex={-1} className="flex flex-col px-4 pb-24 pt-4 md:px-6 md:pb-8 md:pt-6">
          {children}
        </main>
      </div>
      <MobileTabBar />
      <CommandPalette />
    </>
  );
}
```
`AppShell` is a server component composing client components: fine (no hooks in it).

- [ ] **Step 2: Swap the root layout.** In `layout.tsx`: remove the imports of `NavigationBar` and `BackgroundScene`; import `AppShell from "@/components/shell/AppShell"`; add `export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };` (import `type Viewport` from `next`); replace the body of `RootLayout` with:
```tsx
    <html lang="en" className={`${display.variable} ${ui.variable} ${titillium.variable}`}>
      <body className="bg-tarmac font-sans text-chalk antialiased">
        <AppInitializer>
          <LiveAlertBanner />
          <AppShell>{children}</AppShell>
        </AppInitializer>
      </body>
    </html>
```
Delete `frontend/src/components/NavigationBar.tsx` (`git rm`). `BackgroundScene.tsx`/`RacingScene.tsx` stay until Plan 2 (the landing page still imports `RacingScene`... verify with `grep -rn "RacingScene\|BackgroundScene" src`; if `page.tsx` renders `RacingScene` directly, leave it alone here).

- [ ] **Step 3: Write the palette keyboard check** `frontend/scripts/palette-check.mjs`
```js
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
  await b.goto(BASE + "/stats", 2500);
  await key("k", { modifiers: 2, vk: 75 }); // Ctrl+K
  await sleep(400);
  const opened = await b.eval(`!!document.querySelector('[role=dialog][aria-label=Search]') && document.activeElement?.getAttribute('role') === 'combobox'`);
  for (const ch of "live") await key(ch, { text: ch, vk: ch.toUpperCase().charCodeAt(0) });
  await sleep(300);
  const top = await b.eval(`document.querySelector('[role=option]')?.innerText || ''`);
  await key("Enter", { vk: 13, text: "\r" });
  await sleep(2000);
  const path = await b.eval("location.pathname");
  console.log({ opened, top, path });
  process.exitCode = opened && /Live timing/.test(top) && path === "/live" ? 0 : 1;
} finally {
  await b.close();
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run && node scripts/palette-check.mjs`
Expected: types clean, all tests pass, and the script prints `{ opened: true, top: 'Live timing...', path: '/live' }` with exit code 0.

Then take screenshots of `/stats` at 1280px and 390px (`b.shot`) and confirm: the rail is visible at 1280 and expands on hover; the tab bar is visible at 390 with the rail hidden; the top bar shows Search and Log in; legacy page content still renders (it will look old until Plan 2). If any of these is wrong, fix before committing.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/shell frontend/src/app/layout.tsx frontend/scripts/palette-check.mjs
git rm frontend/src/components/NavigationBar.tsx
git commit -m "feat(ui): app shell with rail, top bar, mobile tab bar and palette

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: UI sweep script

**Files:**
- Create: `frontend/scripts/ui-sweep.mjs`

**Interfaces:**
- Consumes: `launch` from `./cdp.mjs` (`viewport(w,h,mobile)`, `goto(url, settleMs)`, `eval(js)`, `shot(path)`, `send(method, params)`, `close()`).
- Produces: CLI `node scripts/ui-sweep.mjs [--base URL] [--routes /a,/b] [--shots DIR]`; prints one line per route and viewport; exit code 1 if any issue.

- [ ] **Step 1: Write the script**
```js
// Sweeps routes at three viewports and fails on: horizontal overflow, crash overlays,
// uncaught errors, h1 count != 1, unnamed buttons/links, unlabelled inputs, and text
// below WCAG AA contrast. Run against a running `next dev` (never during `next build`).
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length));
const BASE = args.base || "http://localhost:3000";
const ROUTES = (args.routes || "/,/live,/map,/stats,/compare,/strategy,/archive,/debrief,/predictions,/login,/changelog,/advanced,/drivers/VER?year=2023").split(",");
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
```

- [ ] **Step 2: Run against the current state** (Plan 2 pages are still legacy, so failures are expected here; this run is only to prove the script works)

Run: `node scripts/ui-sweep.mjs --routes /stats,/login --shots C:/Users/arjun/AppData/Local/Temp/claude/C--Users-arjun-f1-pitwall/d55088ff-067b-4806-8dde-d1c09bda824a/scratchpad/shots`
Expected: prints 6 lines (2 routes x 3 viewports), each `ok` or a specific `FAIL ...` reason; PNGs are written. If the script itself throws (not a page failure), fix the script until it prints results. Sanity-check the contrast checker by confirming it flags at least one legacy `text-white/30` style element on `/stats`; if it reports nothing there, the checker is not seeing text and must be fixed.

- [ ] **Step 3: Commit**
```bash
git add frontend/scripts/ui-sweep.mjs
git commit -m "chore(frontend): CDP UI sweep for overflow, a11y and contrast

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Backend `GET /api/v1/races/latest-result`

**Files:**
- Create: `backend/app/services/latest_result.py`, `backend/app/tests/test_latest_result.py`
- Modify: `backend/app/api/v1/endpoints.py` (imports + one route)

**Interfaces:**
- Consumes: `race_debrief.NoResultsError`, `session_frames.LruCache`, `predictions_service.race_start_utc` (returns a **naive UTC** `pd.Timestamp` or `None`).
- Produces: `build_classification(results: DataFrame) -> list[dict]`; `finished_races(year, now, get_schedule=None) -> list[dict]`; `latest_classification(now=None, *, list_races=finished_races, load_results=_load_results, clock=time.monotonic) -> dict`; `reset_caches() -> None`. All datetimes are naive UTC.
- Response JSON: `{"event": str, "year": int, "country": str, "classification": [{"position": int, "code": str, "name": str, "team": str, "grid": int, "status": str|null, "finished": bool, "race_time_seconds": float|null, "gap_seconds": float|null}]}` sorted by position. `race_time_seconds` is set for the winner only; `gap_seconds` for classified non-winners with a time. Errors: 404 (`No completed race results are available yet.`), 502 (`Couldn't load the latest race result. Try again shortly.`).

- [ ] **Step 1: Write the failing tests** `backend/app/tests/test_latest_result.py`
```python
from datetime import datetime, timedelta
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import latest_result
from app.services.race_debrief import NoResultsError

client = TestClient(app)
NOW = datetime(2026, 9, 21, 12, 0, 0)  # naive UTC, like predictions_service


def _results(rows=None) -> pd.DataFrame:
    rows = rows or [
        ("VER", "Max Verstappen", "Red Bull Racing", 1, 6, "Finished", 5400.0),
        ("NOR", "Lando Norris", "McLaren", 2, 1, "Finished", 3.5),
        ("LEC", "Charles Leclerc", "Ferrari", 3, 0, "Finished", 9.25),  # pit-lane start
        ("HAM", "Lewis Hamilton", "Ferrari", 4, 3, "Lapped", None),
        ("ALO", "Fernando Alonso", "Aston Martin", 5, 4, "Engine", None),
    ]
    return pd.DataFrame(
        [
            {
                "Abbreviation": c, "FullName": n, "TeamName": t, "Position": p, "GridPosition": g,
                "Status": s, "Time": None if tm is None else pd.Timedelta(seconds=tm),
            }
            for c, n, t, p, g, s, tm in rows
        ]
    )


# --- build_classification ---------------------------------------------------------

def test_classification_is_sorted_and_shaped():
    rows = latest_result.build_classification(_results())
    assert [r["code"] for r in rows] == ["VER", "NOR", "LEC", "HAM", "ALO"]
    winner = rows[0]
    assert winner["position"] == 1 and winner["race_time_seconds"] == 5400.0 and winner["gap_seconds"] is None
    assert rows[1]["gap_seconds"] == 3.5 and rows[1]["race_time_seconds"] is None
    assert rows[0]["team"] == "Red Bull Racing" and rows[0]["name"] == "Max Verstappen"


def test_pit_lane_start_is_last_on_the_grid_not_first():
    lec = next(r for r in latest_result.build_classification(_results()) if r["code"] == "LEC")
    assert lec["grid"] == 5  # field size, FastF1 reports pit-lane starts as 0


def test_retirements_are_flagged_and_lapped_cars_are_not():
    rows = {r["code"]: r for r in latest_result.build_classification(_results())}
    assert rows["ALO"]["finished"] is False and rows["ALO"]["status"] == "Engine"
    assert rows["HAM"]["finished"] is True and rows["HAM"]["gap_seconds"] is None
    assert rows["VER"]["finished"] is True


def test_missing_results_raise():
    for bad in (None, pd.DataFrame(), pd.DataFrame({"Abbreviation": ["VER"]})):
        with pytest.raises(NoResultsError):
            latest_result.build_classification(bad)


def test_results_without_a_winner_raise():
    frame = _results([("NOR", "Lando Norris", "McLaren", 2, 1, "Finished", 3.5)])
    with pytest.raises(NoResultsError):
        latest_result.build_classification(frame)


def test_unranked_rows_are_dropped():
    frame = _results()
    frame.loc[4, "Position"] = float("nan")
    assert [r["code"] for r in latest_result.build_classification(frame)] == ["VER", "NOR", "LEC", "HAM"]


# --- finished_races ---------------------------------------------------------------

def _schedule(events):
    rows = []
    for name, country, race_start, fmt in events:
        row = {f"Session{i}": None for i in range(1, 6)}
        row.update({f"Session{i}Date": pd.NaT for i in range(1, 6)})
        row.update({f"Session{i}DateUtc": pd.NaT for i in range(1, 6)})
        row.update({"EventName": name, "Country": country, "EventFormat": fmt})
        if race_start is not None:
            row.update({"Session5": "Race", "Session5DateUtc": pd.Timestamp(race_start)})
        rows.append(row)
    return pd.DataFrame(rows)


def test_finished_races_are_newest_first_and_skip_future_testing_and_unscheduled():
    schedule = _schedule([
        ("Pre-Season Testing", "Bahrain", None, "testing"),
        ("Italian Grand Prix", "Italy", NOW - timedelta(days=15), "conventional"),
        ("Dutch Grand Prix", "Netherlands", NOW - timedelta(days=22), "conventional"),
        ("Singapore Grand Prix", "Singapore", NOW + timedelta(days=13), "conventional"),
        ("TBC Grand Prix", "X", None, "conventional"),
    ])
    races = latest_result.finished_races(2026, NOW, get_schedule=lambda year: schedule)
    assert [r["event_name"] for r in races] == ["Italian Grand Prix", "Dutch Grand Prix"]
    assert races[0]["country"] == "Italy" and races[0]["year"] == 2026


def test_a_race_that_started_an_hour_ago_is_not_finished_yet():
    schedule = _schedule([("Live Grand Prix", "X", NOW - timedelta(hours=1), "conventional")])
    assert latest_result.finished_races(2026, NOW, get_schedule=lambda year: schedule) == []


# --- latest_classification --------------------------------------------------------

@pytest.fixture(autouse=True)
def fresh_caches():
    latest_result.reset_caches()


def _races(*names, year=2026):
    return [{"year": year, "event_name": n, "country": "X"} for n in names]


def test_uses_the_most_recent_race_with_results():
    calls = []

    def load(year, name):
        calls.append(name)
        return _results()

    out = latest_result.latest_classification(
        NOW, list_races=lambda y, n: _races("Italian Grand Prix", "Dutch Grand Prix") if y == 2026 else [], load_results=load
    )
    assert out["event"] == "Italian Grand Prix" and out["year"] == 2026
    assert out["classification"][0]["code"] == "VER"
    assert calls == ["Italian Grand Prix"]


def test_walks_back_when_the_newest_results_are_not_published_yet():
    def load(year, name):
        if name == "Italian Grand Prix":
            return pd.DataFrame()
        return _results()

    out = latest_result.latest_classification(
        NOW, list_races=lambda y, n: _races("Italian Grand Prix", "Dutch Grand Prix") if y == 2026 else [], load_results=load
    )
    assert out["event"] == "Dutch Grand Prix"


def test_falls_back_to_last_season_early_in_the_year():
    out = latest_result.latest_classification(
        NOW,
        list_races=lambda y, n: _races("Abu Dhabi Grand Prix", year=2025) if y == 2025 else [],
        load_results=lambda y, n: _results(),
    )
    assert out["year"] == 2025 and out["event"] == "Abu Dhabi Grand Prix"


def test_no_results_anywhere_raises_no_results():
    with pytest.raises(NoResultsError):
        latest_result.latest_classification(NOW, list_races=lambda y, n: _races("A", "B"), load_results=lambda y, n: pd.DataFrame())


def test_an_outage_is_not_reported_as_no_results():
    def boom(year, name):
        raise ConnectionError("f1 timing down")

    with pytest.raises(ConnectionError):
        latest_result.latest_classification(NOW, list_races=lambda y, n: _races("A", "B"), load_results=boom)


def test_results_are_cached_and_the_answer_is_memoised():
    loads = []

    def load(year, name):
        loads.append(name)
        return _results()

    kwargs = dict(list_races=lambda y, n: _races("Italian Grand Prix"), load_results=load)
    first = latest_result.latest_classification(NOW, **kwargs)
    second = latest_result.latest_classification(NOW, **kwargs)
    assert first == second and loads == ["Italian Grand Prix"]


def test_memo_expires_after_its_ttl():
    # Clock reads: 1) memo write after the first call, 2) memo check on the second call
    # (expired), 3) memo write after the recompute.
    ticks = iter([0.0, latest_result.LATEST_TTL_SECONDS + 1, latest_result.LATEST_TTL_SECONDS + 1])
    listings = []

    def list_races(y, n):
        listings.append(y)
        return _races("Italian Grand Prix")

    kwargs = dict(list_races=list_races, load_results=lambda y, n: _results(), clock=lambda: next(ticks))
    latest_result.latest_classification(NOW, **kwargs)
    assert listings == [2026, 2025]  # one candidate < MAX_CANDIDATES, so last season is listed too
    latest_result.latest_classification(NOW, **kwargs)
    assert listings == [2026, 2025, 2026, 2025]  # the expired memo forced a fresh listing


# --- endpoint ---------------------------------------------------------------------

def test_endpoint_returns_the_classification():
    payload = {"event": "Italian Grand Prix", "year": 2026, "country": "Italy", "classification": []}
    with patch("app.api.v1.endpoints.latest_result.latest_classification", return_value=payload):
        res = client.get("/api/v1/races/latest-result")
    assert res.status_code == 200 and res.json() == payload


def test_endpoint_404_when_there_are_no_results():
    with patch("app.api.v1.endpoints.latest_result.latest_classification", side_effect=NoResultsError("No completed race results are available yet.")):
        res = client.get("/api/v1/races/latest-result")
    assert res.status_code == 404 and "No completed race results" in res.json()["detail"]


def test_endpoint_502_with_a_generic_message_on_failure():
    with patch("app.api.v1.endpoints.latest_result.latest_classification", side_effect=ConnectionError("secret internal detail")):
        res = client.get("/api/v1/races/latest-result")
    assert res.status_code == 502
    assert "secret internal detail" not in res.json()["detail"]
    assert "Try again" in res.json()["detail"]
```

- [ ] **Step 2: Run to verify they fail**

Run (from `backend/`): `SECRET_KEY=test RUNNING_LOCALLY=true python -m pytest app/tests/test_latest_result.py -q`
Expected: FAIL (`cannot import name 'latest_result'`).

- [ ] **Step 3: Implement** `backend/app/services/latest_result.py`
```python
"""Classification of the most recent completed race, for the landing page.

Loads results only (no laps, telemetry or messages), so it takes a couple of
seconds rather than the debrief's tens. Finished results never change, so they
are cached; the "which race is latest" answer is memoised briefly so landing-page
traffic does not re-read the schedule on every request.

All datetimes are naive UTC, matching predictions_service.race_start_utc."""
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

import pandas as pd

from app.services.race_debrief import NoResultsError
from app.services.session_frames import LruCache

RACE_DURATION_BUFFER = timedelta(hours=3)  # a race started less than this ago may not be classified yet
MAX_CANDIDATES = 4
LATEST_TTL_SECONDS = 600

_RESULTS_CACHE = LruCache(maxsize=8)
_memo_lock = threading.Lock()
_memo: Dict[str, Any] = {}


def reset_caches() -> None:
    global _RESULTS_CACHE
    _RESULTS_CACHE = LruCache(maxsize=8)
    with _memo_lock:
        _memo.clear()


def _text(value: Any) -> Optional[str]:
    if value is None or pd.isna(value):
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _seconds(value: Any) -> Optional[float]:
    if value is None or pd.isna(value):
        return None
    return float(pd.Timedelta(value).total_seconds())


def _finished(status: Optional[str]) -> bool:
    return status is None or status in ("Finished", "Lapped") or status.startswith("+")


def build_classification(results: Optional[pd.DataFrame]) -> List[Dict[str, Any]]:
    if results is None or results.empty or not {"Abbreviation", "Position"}.issubset(results.columns):
        raise NoResultsError("This race has no final classification yet.")
    ranked = results.assign(Position=pd.to_numeric(results["Position"], errors="coerce"))
    ranked = ranked.dropna(subset=["Position"]).sort_values("Position")
    if ranked.empty or float(ranked.iloc[0]["Position"]) != 1.0:
        raise NoResultsError("This race has no final classification yet.")

    field_size = len(ranked)
    rows: List[Dict[str, Any]] = []
    for _, r in ranked.iterrows():
        position = int(r["Position"])
        grid = r.get("GridPosition")
        # FastF1 reports a pit-lane start as grid position 0: that is last, not first.
        grid = field_size if grid is None or pd.isna(grid) or float(grid) <= 0 else int(grid)
        status = _text(r.get("Status"))
        elapsed = _seconds(r.get("Time"))
        code = str(r["Abbreviation"])
        rows.append({
            "position": position,
            "code": code,
            "name": _text(r.get("FullName")) or code,
            "team": _text(r.get("TeamName")) or "Unknown",
            "grid": grid,
            "status": status,
            "finished": _finished(status),
            # For the winner FastF1's Time is the total race time; for everyone else it is the gap.
            "race_time_seconds": elapsed if position == 1 else None,
            "gap_seconds": None if position == 1 else elapsed,
        })
    return rows


def finished_races(
    year: int, now: datetime, get_schedule: Optional[Callable[[int], pd.DataFrame]] = None
) -> List[Dict[str, Any]]:
    """Races that have finished, newest first. Testing events and races with no known start are skipped."""
    if get_schedule is None:
        import fastf1

        get_schedule = fastf1.get_event_schedule
    from app.services.predictions_service import race_start_utc

    races: List[Dict[str, Any]] = []
    for _, row in get_schedule(year).iterrows():
        if str(row.get("EventFormat")) == "testing":
            continue
        start = race_start_utc(row)
        if start is None:
            continue
        start = start.to_pydatetime()
        if start + RACE_DURATION_BUFFER > now:
            continue
        races.append({
            "year": year,
            "event_name": str(row["EventName"]),
            "country": str(row.get("Country", "")),
            "start": start,
        })
    races.sort(key=lambda r: r["start"], reverse=True)
    return races


def _load_results(year: int, event_name: str) -> pd.DataFrame:
    import fastf1

    session = fastf1.get_session(year, event_name, "Race")
    session.load(laps=False, telemetry=False, weather=False, messages=False)
    return session.results


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def latest_classification(
    now: Optional[datetime] = None,
    *,
    list_races: Callable[[int, datetime], List[Dict[str, Any]]] = finished_races,
    load_results: Callable[[int, str], pd.DataFrame] = _load_results,
    clock: Callable[[], float] = time.monotonic,
) -> Dict[str, Any]:
    """Blocking -- call via asyncio.to_thread from async routes."""
    with _memo_lock:
        hit = _memo.get("latest")
        if hit is not None and clock() - hit[0] < LATEST_TTL_SECONDS:
            return hit[1]

    now = now or _utc_now()
    candidates = list_races(now.year, now)[:MAX_CANDIDATES]
    if len(candidates) < MAX_CANDIDATES:  # early in the year: reach back into last season
        candidates += list_races(now.year - 1, now)[: MAX_CANDIDATES - len(candidates)]

    errors: List[Exception] = []
    for race in candidates:
        key = (race["year"], race["event_name"])
        payload = _RESULTS_CACHE.get(key)
        if payload is None:
            try:
                payload = {
                    "event": race["event_name"],
                    "year": race["year"],
                    "country": race["country"],
                    "classification": build_classification(load_results(race["year"], race["event_name"])),
                }
            except NoResultsError:
                continue  # not published yet: try the race before it
            except Exception as e:
                print(f"latest-result: could not load {key}: {e}")
                errors.append(e)
                continue
            _RESULTS_CACHE.set(key, payload)
        with _memo_lock:
            _memo["latest"] = (clock(), payload)
        return payload

    if candidates and len(errors) == len(candidates):
        raise errors[-1]  # everything failed with a real error: surface it, don't say "no results"
    raise NoResultsError("No completed race results are available yet.")
```

- [ ] **Step 4: Add the route.** In `backend/app/api/v1/endpoints.py`, add `from app.services import latest_result` and `from app.services.race_debrief import NoResultsError` to the imports (add `import asyncio` if absent), and place this directly after the `/races/historical` route:
```python
@router.get("/races/latest-result")
async def get_latest_race_result():
    """Final classification of the most recent completed race (results only)."""
    try:
        return await asyncio.to_thread(latest_result.latest_classification)
    except NoResultsError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"latest-result failed: {e}")  # log the cause; the client only needs what to try next
        raise HTTPException(status_code=502, detail="Couldn't load the latest race result. Try again shortly.")
```

- [ ] **Step 5: Run the new tests, then the whole backend suite**

Run: `SECRET_KEY=test RUNNING_LOCALLY=true python -m pytest app/tests/test_latest_result.py -q` then `SECRET_KEY=test RUNNING_LOCALLY=true python -m pytest -q`
Expected: new file all pass; full suite `295 + new` passed, 0 failed. If `test_memo_expires_after_its_ttl` fails because `clock` is called a different number of times than the four ticks provided, adjust the tick list to match the actual call count (one call per memo check and one per memo write), not the implementation.

- [ ] **Step 6: Real-data smoke test.** With the backend running on :8000 (it is, via `run_local.py`; restart it first with TaskStop + relaunch so the new route loads), run `curl -s http://localhost:8000/api/v1/races/latest-result | head -c 600`. Expected: JSON with a real event and 20-ish classification rows, or a 404/502 with the documented messages. Time the first call (`curl -w "%{time_total}"`); record it. If FastF1 is unreachable in this sandbox, record that and rely on the unit tests.

- [ ] **Step 7: Commit**
```bash
git add backend/app/services/latest_result.py backend/app/tests/test_latest_result.py backend/app/api/v1/endpoints.py
git commit -m "feat(api): latest completed race classification for the landing tower

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Plan 1 exit criteria

- `npx vitest run` and `npx tsc --noEmit` clean; backend suite green; `node scripts/measure-fonts.mjs` prints `tabular` for the UI face.
- The app renders inside the new shell; Ctrl+K palette works by keyboard; legacy pages still function (they are restyled in Plan 2, `docs/superpowers/plans/2026-09-21-design-system-pages.md`).
