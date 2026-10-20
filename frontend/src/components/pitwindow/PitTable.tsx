import CompoundBadge from "@/components/CompoundBadge";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { cheapStopText, lapsText, planText, statusText, windowText, type PitDriver } from "@/lib/pitwindow";

// Drivers arrive in running order, which is the order shown.
export default function PitTable({ drivers }: { drivers: PitDriver[] }) {
  const columns: Column<PitDriver>[] = [
    { key: "pos", header: "Pos", align: "right", className: "text-mute", cell: (d) => d.position },
    {
      key: "driver",
      header: "Driver",
      cell: (d) => (
        <span className="font-display font-bold" title={d.name}>
          {d.code}
        </span>
      ),
    },
    {
      key: "tyre",
      header: "Tyre",
      cell: (d) => (
        <span className="inline-flex items-center gap-2">
          <CompoundBadge compound={d.compound} showLabel />
          <span className="text-xs text-faint">{lapsText(d.tyre_age)}</span>
        </span>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      cell: (d) => (
        <>
          {planText(d)}
          {d.early && <span className="ml-2 text-xs text-mute">Early estimate</span>}
        </>
      ),
    },
    { key: "window", header: "Window", cell: (d) => windowText(d) },
    {
      key: "status",
      header: "Status",
      cell: (d) => (
        <>
          <span className={d.status === "box now" && !d.rule_breach ? "font-semibold text-timing-green" : undefined}>{statusText(d)}</span>
          {d.cheap_stop && <span className="block text-xs text-mute">{cheapStopText()}</span>}
        </>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={drivers}
      rowKey={(d) => d.code}
      caption="Best pit plan, window and status for each driver"
      accent={(d) => d.color}
      dense
    />
  );
}
