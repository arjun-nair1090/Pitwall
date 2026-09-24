import CompoundBadge from "@/components/CompoundBadge";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Panel from "@/components/ui/Panel";
import { getCompoundStyle } from "@/lib/compounds";
import type { CompoundModel, SimulatedStint, SimulationResult } from "@/lib/strategy";
import { formatLapTime, formatRaceTime } from "@/lib/timing";

interface StrategyResultProps {
  result: SimulationResult;
  // The driver's real strategy run through the same model, for a like-for-like comparison.
  baseline?: SimulationResult | null;
  driver?: { code: string; name: string } | null;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-panel border border-gantry bg-kerb p-4">
      <p className="font-display text-[11px] font-bold uppercase tracking-[0.12em] text-mute">{label}</p>
      <p className="font-display text-3xl font-black leading-none tabular-nums text-chalk">{value}</p>
      {note && <p className="text-xs text-mute">{note}</p>}
    </div>
  );
}

const STINT_COLUMNS: Column<SimulatedStint & { n: number }>[] = [
  { key: "n", header: "Stint", className: "w-14 text-mute", cell: (s) => s.n },
  { key: "tyre", header: "Tyre", cell: (s) => <CompoundBadge compound={s.compound} showLabel /> },
  { key: "laps", header: "Laps", cell: (s) => `Laps ${s.start_lap} to ${s.end_lap}` },
  { key: "time", header: "Stint time", align: "right", cell: (s) => formatRaceTime(s.seconds) },
  { key: "avg", header: "Average lap", align: "right", cell: (s) => formatLapTime(s.avg_lap_seconds) },
];

type ModelRow = CompoundModel & { compound: string };

const MODEL_COLUMNS: Column<ModelRow>[] = [
  { key: "tyre", header: "Tyre", cell: (m) => <CompoundBadge compound={m.compound} showLabel /> },
  {
    key: "laps",
    header: "Laps sampled",
    align: "right",
    cell: (m) => (
      <span className="flex flex-col items-end">
        <span>{m.sample_size}</span>
        {m.sample_size < 5 && <span className="text-xs text-mute">Few laps: default wear</span>}
      </span>
    ),
  },
  { key: "pace", header: "Pace on fresh tyres", align: "right", cell: (m) => formatLapTime(m.base_pace) },
  { key: "wear", header: "Wear per lap", align: "right", cell: (m) => `+${m.deg_rate.toFixed(3)} s` },
];

const DRY_FIRST = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

// What the plan comes to, and how far to trust it. Comparing with a real driver is done two ways:
// against their real race (which mixes in the model's own error) and against their real strategy
// run through the same model (which cancels that error out), and the difference is stated.
export default function StrategyResult({ result, baseline = null, driver = null }: StrategyResultProps) {
  const stops = result.num_pit_stops;
  const model = Object.entries(result.compound_stats)
    .map(([compound, m]) => ({ compound, ...m }))
    .sort((a, b) => DRY_FIRST.indexOf(a.compound) - DRY_FIRST.indexOf(b.compound));
  const fuel = model.find((m) => (m.fuel_rate ?? 0) < -0.0005)?.fuel_rate;

  const actual = result.actual_driver_total_seconds;
  const versus = baseline ? result.predicted_total_seconds - baseline.predicted_total_seconds : null;
  const modelError = baseline && actual !== undefined ? Math.abs(baseline.predicted_total_seconds - actual) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Predicted race time" value={formatRaceTime(result.predicted_total_seconds)} />
        <Stat label="Average lap" value={formatLapTime(result.predicted_avg_lap_seconds)} />
        <Stat
          label="Pit stops"
          value={stops === 0 ? "No stops" : `${stops} stop${stops === 1 ? "" : "s"}`}
          note={stops > 0 ? `About ${result.pit_loss_seconds_used.toFixed(1)} s lost in the pits each time` : undefined}
        />
      </div>

      {driver && (
        <Panel title={`Against ${driver.name}`}>
          <div className="flex flex-col gap-3 p-4">
            {versus !== null && (
              <p className="text-sm font-medium text-chalk">
                {Math.abs(versus) < 0.05
                  ? `Your plan is exactly as fast as ${driver.code}'s real strategy, judged by the same model.`
                  : `Your plan is ${Math.abs(versus).toFixed(1)} s ${versus < 0 ? "faster" : "slower"} than ${driver.code}'s real strategy, judged by the same model.`}
              </p>
            )}
            {baseline === null && result.delta_seconds !== undefined && (
              <p className="text-sm font-medium text-chalk">
                Your plan is {Math.abs(result.delta_seconds).toFixed(1)} s {result.delta_seconds < 0 ? "faster" : "slower"} than {driver.code}'s real race.
              </p>
            )}
            {baseline && actual !== undefined && (
              <DataTable
                caption={`Compared with ${driver.name}`}
                columns={[
                  { key: "what", header: "Race time", cell: (r: { what: string; time: number }) => r.what },
                  { key: "time", header: "Time", align: "right", cell: (r) => formatRaceTime(r.time) },
                ]}
                rows={[
                  { what: "Your plan (predicted)", time: result.predicted_total_seconds },
                  { what: `${driver.code}'s real strategy (predicted)`, time: baseline.predicted_total_seconds },
                  { what: `${driver.code}'s real race (actual)`, time: actual },
                ]}
                rowKey={(r) => r.what}
                dense
              />
            )}
            {modelError !== null && (
              <p className="text-xs text-mute">
                The model was {modelError.toFixed(1)} s out on {driver.code}'s real strategy, so a gap that small isn't a real difference. Comparing two plans through the same model is the fairer measure.
              </p>
            )}
          </div>
        </Panel>
      )}

      <Panel title="Stint by stint">
        <DataTable
          caption="Stint breakdown"
          columns={STINT_COLUMNS}
          rows={result.stints.map((s, i) => ({ ...s, n: i + 1 }))}
          rowKey={(s) => String(s.n)}
          accent={(s) => getCompoundStyle(s.compound).color}
        />
      </Panel>

      <Panel title="What the model learned from this race">
        <div className="flex flex-col gap-3 p-4">
          <DataTable caption="How the model sees each tyre" columns={MODEL_COLUMNS} rows={model} rowKey={(m) => m.compound} dense />
          {fuel !== undefined && (
            <p className="text-xs text-mute">
              Cars get about {Math.abs(fuel).toFixed(3)} s quicker every lap as fuel burns off. The model adds that back before measuring how quickly each tyre wears, so wear isn't hidden by the car getting lighter.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
