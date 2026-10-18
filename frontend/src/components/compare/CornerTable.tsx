import DataTable, { type Column } from "@/components/ui/DataTable";
import EmptyState from "@/components/ui/EmptyState";
import { biggestGains, brakeVerdict, type CornerDuelRow } from "@/lib/corners";
import type { DuelStyle } from "@/lib/duel";

const seconds = (s: number) => Math.abs(s).toFixed(3);
const isLevel = (s: number) => seconds(s) === "0.000";
const pair = (a: number, b: number) => `${Math.round(a)} / ${Math.round(b)}`;

// Every corner of the lap with who was quicker through it, and the speeds and braking behind that.
// Rows follow the circuit, so the gains read as a story of the lap.
export default function CornerTable({ rows, code1, code2, style }: { rows: CornerDuelRow[]; code1: string; code2: string; style: DuelStyle }) {
  if (rows.length === 0) {
    return <EmptyState title="Corner data isn't available for this session" />;
  }

  const gainer = (r: CornerDuelRow) => (r.time_delta > 0 ? { code: code1, color: style.color1 } : { code: code2, color: style.color2 });
  const columns: Column<CornerDuelRow>[] = [
    { key: "turn", header: "Turn", cell: (r) => <span className="font-semibold">{r.label}</span> },
    {
      key: "time",
      header: "Time",
      cell: (r) => {
        if (isLevel(r.time_delta)) return <span className="text-mute">Level</span>;
        const g = gainer(r);
        return (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: g.color }} />
            <span>{`${g.code} ${seconds(r.time_delta)}`}</span>
          </span>
        );
      },
    },
    { key: "min", header: "Min speed", align: "right", cell: (r) => pair(r.driver1.apex_speed, r.driver2.apex_speed) },
    { key: "braking", header: "Braking", cell: (r) => brakeVerdict(r.driver1.brake_before_m, r.driver2.brake_before_m, code1, code2) },
    { key: "exit", header: "Exit speed", align: "right", cell: (r) => pair(r.driver1.exit_speed, r.driver2.exit_speed) },
  ];

  const { first, second } = biggestGains(rows);
  const parts = [
    first && `${code1} gained most at ${first.label} (${seconds(first.time_delta)} s)`,
    second && (first ? `${code2} at ${second.label} (${seconds(second.time_delta)} s)` : `${code2} gained most at ${second.label} (${seconds(second.time_delta)} s)`),
  ].filter(Boolean);

  return (
    <div>
      <p className="border-b border-gantry/60 px-4 py-3 text-sm text-mute">{parts.length ? parts.join("; ") : "Level through every corner"}</p>
      <p className="px-4 pt-3 text-xs text-faint">Min speed and exit speed are in km/h, {code1} / {code2}.</p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.label}
        caption="Corner by corner comparison"
        accent={(r) => (isLevel(r.time_delta) ? undefined : gainer(r).color)}
        dense
      />
    </div>
  );
}
