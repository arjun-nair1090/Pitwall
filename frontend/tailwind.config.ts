import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

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
      },
    },
  },
  plugins: [
    // The sidebar's state is an attribute on <html> (see src/lib/railState.ts), so the stylesheet can
    // size everything from it before any script runs: `rail-expanded:` / `rail-collapsed:` variants.
    plugin(({ addVariant }) => {
      addVariant("rail-expanded", "html:not([data-rail='collapsed']) &");
      addVariant("rail-collapsed", "html[data-rail='collapsed'] &");
    }),
  ],
};
export default config;
