import DataTable, { type Column } from "@/components/ui/DataTable";
import { formatChance, formatGap, formatPoints, type ChampionDriver } from "@/lib/championship";
import { teamColor } from "@/lib/timing";

function statusLabel(d: ChampionDriver, seasonOver: boolean): string {
  switch (d.status) {
    case "clinched": return seasonOver ? "Champion" : "Clinched";
    case "eliminated": return "Out of contention";
    case "not racing": return "Not racing";
    default: return "";
  }
}

// The server's order: points, then wins. The gap is to the leader, so a dead heat reads as no gap.
export default function OddsTable({ drivers, seasonOver }: { drivers: ChampionDriver[]; seasonOver: boolean }) {
  const lead = drivers[0]?.points ?? 0;
  const columns: Column<ChampionDriver>[] = [
    { key: "pos", header: "Pos", align: "right", className: "w-12 text-mute", cell: (d) => drivers.indexOf(d) + 1 },
    {
      key: "driver", header: "Driver",
      cell: (d) => (
        <span className="flex flex-col leading-tight">
          <span className="font-semibold">{d.name}</span>
          <span className="text-xs text-mute">{d.code}</span>
        </span>
      ),
    },
    { key: "points", header: "Points", align: "right", className: "font-semibold", cell: (d) => formatPoints(d.points) },
    { key: "gap", header: "Gap", align: "right", className: "text-mute", cell: (d) => formatGap(lead - d.points) },
    {
      key: "chance", header: "Title chance", align: "right", className: "font-semibold",
      cell: (d) => (
        <span className={d.status === "eliminated" || d.status === "not racing" ? "text-faint" : undefined}>
          {formatChance(d.title_probability, d.status)}
        </span>
      ),
    },
    { key: "expected", header: "Expected", align: "right", className: "text-mute", cell: (d) => formatPoints(d.expected_points) },
    {
      key: "range", header: "Range", align: "right", className: "text-mute",
      cell: (d) => `${formatPoints(d.points_p10)}–${formatPoints(d.points_p90)}`,
    },
    { key: "status", header: "Status", className: "text-mute", cell: (d) => statusLabel(d, seasonOver) },
  ];

  return (
    <DataTable
      columns={columns}
      rows={drivers}
      rowKey={(d) => d.code}
      caption="Drivers' title chances"
      accent={(d) => teamColor(d.team)}
      dense
    />
  );
}
