import DataTable, { type Column } from "@/components/ui/DataTable";
import { formatStartGain, type BattleDriver } from "@/lib/battles";

// Payload order is finishing order. A pit-lane starter has no grid slot, so Grid says so too.
export default function DriverMoves({ drivers }: { drivers: BattleDriver[] }) {
  const columns: Column<BattleDriver>[] = [
    {
      key: "driver", header: "Driver",
      cell: (d) => (
        <span className="flex flex-col leading-tight">
          <span className="font-display font-bold">{d.code}</span>
          <span className="text-xs text-mute">{d.team}</span>
        </span>
      ),
    },
    { key: "grid", header: "Grid", align: "right", className: "text-mute", cell: (d) => d.grid ?? "Pit lane" },
    { key: "finish", header: "Finish", align: "right", cell: (d) => d.finish ?? d.finish_note ?? "—" },
    { key: "start", header: "Start", align: "right", cell: (d) => formatStartGain(d.start_gain, d.grid) },
    { key: "made", header: "Passes made", align: "right", cell: (d) => d.made },
    { key: "lost", header: "Passes lost", align: "right", className: "text-mute", cell: (d) => d.lost },
  ];

  return (
    <DataTable
      columns={columns}
      rows={drivers}
      rowKey={(d) => d.code}
      caption="Drivers' grid, finish, start and passes"
      accent={(d) => d.color}
      dense
    />
  );
}
