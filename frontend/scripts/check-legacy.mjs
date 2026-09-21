// Objective "is this file migrated?" gate: fails on any legacy style token.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Legacy Tailwind classes only. CSS-variable references such as rgb(var(--f1-red)) are fine.
const LEGACY =
  /\b(text|bg|border|ring|fill|stroke|from|to|via|shadow|divide|outline)-f1-(cyan|red|yellow|green|blue|dark|gray|light)|glass-panel|font-mono-f1|neon-|font-titillium|text-white\/|bg-white\/|border-white|bg-black|\buppercase\b|bg-carbon|animate-status-blink|tracking-(wider|widest)|\b(text|bg|border)-(red|emerald|green|blue|yellow|gray|slate|neutral|zinc)-\d|\btext-black\b/;
// White text is legitimate only on solid F1 red (4.97:1), i.e. the danger button.
const WHITE = /text-white/;
const WHITE_ALLOWED = new Set(["src/components/ui/Button.tsx"]);

let files = process.argv.slice(2);
if (files[0] === "--all") {
  files = readdirSync("src", { recursive: true })
    .filter((f) => String(f).endsWith(".tsx"))
    .map((f) => join("src", String(f)));
  files.push("src/app/globals.css");
}

let violations = 0;
for (const file of files) {
  const allowWhite = WHITE_ALLOWED.has(file.replace(/\\/g, "/"));
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (LEGACY.test(line) || (!allowWhite && WHITE.test(line))) {
      violations += 1;
      console.log(`${file}:${i + 1}: ${line.trim().slice(0, 110)}`);
    }
  });
}
process.exitCode = violations ? 1 : 0;
