import DataTable, { type Column } from "@/components/ui/DataTable";
import { formatChance, formatPoints, type ChampionTeam } from "@/lib/championship";
import { teamColor } from "@/lib/timing";

export default function ConstructorsTable({ teams }: { teams: ChampionTeam[] }) {
  const columns: Column<ChampionTeam>[] = [
    { key: "pos", header: "Pos", align: "right", className: "w-12 text-mute", cell: (t) => teams.indexOf(t) + 1 },
    { key: "team", header: "Team", className: "font-semibold", cell: (t) => t.team },
    { key: "points", header: "Points", align: "right", className: "font-semibold", cell: (t) => formatPoints(t.points) },
    {
      key: "chance", header: "Title chance", align: "right", className: "font-semibold",
      cell: (t) => (
        <span className={t.status === "eliminated" ? "text-faint" : undefined}>{formatChance(t.title_probability, t.status)}</span>
      ),
    },
    { key: "expected", header: "Expected", align: "right", className: "text-mute", cell: (t) => formatPoints(t.expected_points) },
  ];
  return (
    <DataTable
      columns={columns}
      rows={teams}
      rowKey={(t) => t.team}
      caption="Constructors' title chances"
      accent={(t) => teamColor(t.team)}
      dense
    />
  );
}
