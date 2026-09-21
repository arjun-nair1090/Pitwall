import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        titillium: ["var(--font-titillium)", "sans-serif"],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        f1: {
          red: "#e10600",
          yellow: "#ffd12b",
          green: "#00b259",
          blue: "#00a2ed",
          dark: "#15151e",
          gray: "#38383f",
          light: "#f3f3f3",
        },
        // Real F1 tire-compound colors. Keep in sync with src/lib/compounds.ts.
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
