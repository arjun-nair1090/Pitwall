import CompoundBadge from "@/components/CompoundBadge";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { formatLapTime } from "@/lib/timing";
import { wearText, type CompoundFit } from "@/lib/pitwindow";

export default function TyreModel({ model, pitLoss }: { model: CompoundFit[]; pitLoss: number }) {
  const columns: Column<CompoundFit>[] = [
    { key: "tyre", header: "Tyre", cell: (m) => <CompoundBadge compound={m.compound} showLabel /> },
    { key: "base", header: "Base lap", align: "right", cell: (m) => formatLapTime(m.base) },
    { key: "wear", header: "Wear", align: "right", cell: (m) => wearText(m.deg_per_lap) },
    {
      key: "evidence",
      header: "Evidence",
      className: "text-mute",
      cell: (m) => (m.fitted ? `From ${m.laps} laps` : "Estimate, not enough laps yet"),
    },
  ];

  return (
    <>
      <DataTable columns={columns} rows={model} rowKey={(m) => m.compound} caption="Fitted tyre model" dense />
      <p className="mt-3 text-sm text-chalk">{`Pit stop costs ${pitLoss.toFixed(1)} s`}</p>
    </>
  );
}
