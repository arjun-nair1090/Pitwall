// Every channel the duel can chart, kept apart from ChannelChart so the picker can list them
// without loading Recharts.
export interface ChartDef {
  id: string;
  label: string;
  unit: string;
  height: number;
  defaultOn: boolean;
  // Either a channel plotted for both drivers, or one derived series.
  channel?: "speed" | "throttle" | "brake" | "gear" | "rpm" | "drs" | "acceleration";
  single?: "gap" | "speedDiff";
  stepped?: boolean;
  domain?: [number | "auto", number | "auto"];
  ticks?: number[];
  format?: (value: number) => string;
  zeroLine?: boolean;
  caption?: (code1: string, code2: string) => string;
}

const onOff = (v: number) => (v >= 0.5 ? "On" : "Off");
const drs = (v: number) => (v >= 10 ? "Open" : "Closed");

export const CHART_DEFS: ChartDef[] = [
  { id: "speed", label: "Speed", unit: "km/h", height: 220, defaultOn: true, channel: "speed", domain: ["auto", "auto"] },
  {
    id: "gap", label: "Gap", unit: "s", height: 160, defaultOn: true, single: "gap", zeroLine: true, domain: ["auto", "auto"],
    format: (v) => v.toFixed(3),
    caption: (a, b) => `Above zero, ${a} was ahead; below zero, ${b} was.`,
  },
  { id: "throttle", label: "Throttle", unit: "%", height: 130, defaultOn: true, channel: "throttle", domain: [0, 100] },
  { id: "brake", label: "Brake", unit: "", height: 90, defaultOn: true, channel: "brake", stepped: true, domain: [0, 1], ticks: [0, 1], format: onOff },
  { id: "gear", label: "Gear", unit: "", height: 130, defaultOn: true, channel: "gear", stepped: true, domain: [1, 8], ticks: [1, 2, 3, 4, 5, 6, 7, 8] },
  { id: "rpm", label: "Engine revs", unit: "rpm", height: 130, defaultOn: false, channel: "rpm", domain: ["auto", "auto"] },
  { id: "drs", label: "DRS", unit: "", height: 90, defaultOn: false, channel: "drs", stepped: true, domain: [0, 14], ticks: [0, 12], format: drs },
  { id: "acceleration", label: "Acceleration", unit: "m/s²", height: 130, defaultOn: false, channel: "acceleration", domain: ["auto", "auto"], zeroLine: true },
  {
    id: "speedDiff", label: "Speed difference", unit: "km/h", height: 130, defaultOn: false, single: "speedDiff", zeroLine: true, domain: ["auto", "auto"],
    caption: (a) => `Above zero, ${a} was faster.`,
  },
];
