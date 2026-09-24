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
