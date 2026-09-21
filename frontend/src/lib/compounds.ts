// Single source of truth for tire-compound presentation. Colors match the real
// F1 broadcast convention (soft=red, medium=yellow, hard=white, inter=green,
// wet=blue) so a compound reads the same on every page.

export type CompoundKey = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";

export interface CompoundStyle {
  key: CompoundKey | "UNKNOWN";
  letter: string;
  label: string;
  color: string;
}

export const COMPOUND_STYLES: Record<CompoundKey, CompoundStyle> = {
  SOFT: { key: "SOFT", letter: "S", label: "Soft", color: "#e10600" },
  MEDIUM: { key: "MEDIUM", letter: "M", label: "Medium", color: "#ffd12b" },
  HARD: { key: "HARD", letter: "H", label: "Hard", color: "#f3f3f3" },
  INTERMEDIATE: { key: "INTERMEDIATE", letter: "I", label: "Intermediate", color: "#43b02a" },
  WET: { key: "WET", letter: "W", label: "Wet", color: "#0067ad" },
};

const UNKNOWN_STYLE: CompoundStyle = { key: "UNKNOWN", letter: "?", label: "Unknown", color: "#6b6b76" };

export function getCompoundStyle(compound?: string | null): CompoundStyle {
  if (!compound) return UNKNOWN_STYLE;
  const upper = compound.toUpperCase();
  // Check INTERMEDIATE before anything shorter so "INTER" / "INTERMEDIATE" never fall through.
  if (upper.includes("INTER")) return COMPOUND_STYLES.INTERMEDIATE;
  if (upper.includes("SOFT")) return COMPOUND_STYLES.SOFT;
  if (upper.includes("MEDIUM")) return COMPOUND_STYLES.MEDIUM;
  if (upper.includes("HARD")) return COMPOUND_STYLES.HARD;
  if (upper.includes("WET")) return COMPOUND_STYLES.WET;
  return UNKNOWN_STYLE;
}
