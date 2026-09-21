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
