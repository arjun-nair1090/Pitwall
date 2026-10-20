import DataTable, { type Column } from "@/components/ui/DataTable";
import EmptyState from "@/components/ui/EmptyState";
import { outcomeText, type Battle } from "@/lib/battles";

// Payload order: the longest fight first.
export default function BattleTable({ battles }: { battles: Battle[] }) {
  if (battles.length === 0) {
    return <EmptyState title="No sustained battles" description="Nobody stayed within a second of the car ahead for three laps in a row." />;
  }

  const columns: Column<Battle>[] = [
    { key: "battle", header: "Battle", cell: (b) => <span className="font-display font-bold">{`${b.chaser} on ${b.leader}`}</span> },
    { key: "laps", header: "Laps", align: "right", cell: (b) => `${b.start_lap}–${b.end_lap} (${b.laps})` },
    { key: "closest", header: "Closest", align: "right", cell: (b) => `${b.min_gap.toFixed(3)} s` },
    { key: "outcome", header: "Outcome", className: "text-mute", cell: (b) => outcomeText(b) },
  ];

  return (
    <DataTable
      columns={columns}
      rows={battles}
      rowKey={(b) => `${b.chaser}-${b.leader}-${b.start_lap}`}
      caption="Sustained battles within a second"
      dense
    />
  );
}
