import DataTable, { type Column } from "@/components/ui/DataTable";
import { formatChance } from "@/lib/championship";
import { statusLabel } from "@/lib/pitwindow";
import { gapText, type WinProbDriver, type WinProbRow } from "@/lib/winprob";

// Rows arrive in running order, which is the order shown.
export default function LapOdds({ rows, drivers }: { rows: readonly WinProbRow[]; drivers: readonly WinProbDriver[] }) {
  const byCode = new Map(drivers.map((d) => [d.code, d]));
  const columns: Column<WinProbRow>[] = [
    { key: "pos", header: "Pos", align: "right", className: "text-mute", cell: (r) => r.position },
    {
      key: "driver",
      header: "Driver",
      cell: (r) => (
        <span className="font-display font-bold" title={byCode.get(r.code)?.name}>
          {r.code}
        </span>
      ),
    },
    { key: "gap", header: "Gap", align: "right", cell: (r) => gapText(r.gap) },
    { key: "flag", header: "At the flag", align: "right", cell: (r) => gapText(r.projected_gap) },
    { key: "chance", header: "Win chance", align: "right", className: "font-semibold", cell: (r) => formatChance(r.probability) },
    { key: "strategy", header: "Strategy", cell: (r) => statusLabel(r.status, r.rule_breach, r.window_open) },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.code}
      caption="Gap, projected gap at the flag, win chance and pit strategy for each driver"
      accent={(r) => byCode.get(r.code)?.color}
      dense
    />
  );
}
