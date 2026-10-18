import DataTable, { type Column } from "@/components/ui/DataTable";
import { getCompoundStyle } from "@/lib/compounds";
import { formatDeg, formatPaceGap, type PaceDriver, type PaceStint } from "@/lib/pace";
import { formatLapTime } from "@/lib/timing";

function StintBadge({ stint }: { stint: PaceStint }) {
  const style = getCompoundStyle(stint.compound);
  const deg = formatDeg(stint.deg_per_lap);
  return (
    <span
      role="img"
      aria-label={`Stint ${stint.stint}, ${style.label}, ${deg}`}
      title={`Stint ${stint.stint}: ${style.label}, laps ${stint.start_lap} to ${stint.end_lap}, ${deg}`}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-black leading-none text-chalk"
      style={{ borderColor: style.color }}
    >
      {style.letter}
    </span>
  );
}

// The ranking is the server's order: fastest fuel-corrected pace first, then the drivers with too
// few clean laps to measure, who get a dash instead of a position.
export default function PaceRanking({ drivers }: { drivers: PaceDriver[] }) {
  const unranked = drivers.filter((d) => d.pace === null).length;
  let position = 0;
  const positions = new Map(drivers.map((d) => [d.code, d.pace === null ? null : ++position]));

  const columns: Column<PaceDriver>[] = [
    { key: "pos", header: "Pos", align: "right", className: "w-12 text-mute", cell: (d) => positions.get(d.code) ?? "—" },
    {
      key: "driver", header: "Driver",
      cell: (d) => (
        <span className="flex flex-col leading-tight">
          <span className="font-display font-bold">{d.code}</span>
          <span className="text-xs text-mute">{d.team}</span>
        </span>
      ),
    },
    { key: "pace", header: "Pace", align: "right", cell: (d) => (d.pace === null ? "—" : formatLapTime(d.pace)) },
    { key: "gap", header: "Gap", align: "right", className: "text-mute", cell: (d) => formatPaceGap(d.gap) },
    { key: "laps", header: "Clean laps", align: "right", className: "text-mute", cell: (d) => d.clean_laps },
    {
      key: "stints", header: "Stints",
      cell: (d) =>
        d.stints.length === 0 ? (
          "—"
        ) : (
          <span className="flex gap-1.5">
            {d.stints.map((s) => <StintBadge key={s.stint} stint={s} />)}
          </span>
        ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={drivers}
        rowKey={(d) => d.code}
        caption="Drivers ranked by fuel-corrected race pace"
        accent={(d) => d.color}
        dense
      />
      {unranked > 0 ? (
        <p className="px-3 pt-3 text-xs text-faint">
          {`${unranked} ${unranked === 1 ? "driver" : "drivers"} had too few clean laps to rank.`}
        </p>
      ) : null}
    </>
  );
}
