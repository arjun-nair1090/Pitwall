import { undercutLead, VERDICT_LABEL, type Undercut, type Verdict } from "@/lib/pitwindow";

const VERDICT_CLASS: Record<Verdict, string> = {
  likely: "text-timing-green",
  possible: "text-timing-yellow",
  unlikely: "text-mute",
};

// Payload order: the best chance first.
export default function UndercutList({ undercuts }: { undercuts: Undercut[] }) {
  if (undercuts.length === 0) return <p className="text-sm text-mute">No car within 3 s of the car ahead.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm text-chalk">
      {undercuts.map((u) => (
        <li key={`${u.chaser}-${u.leader}`}>
          {undercutLead(u)}
          <span className={`font-semibold ${VERDICT_CLASS[u.verdict]}`}>{VERDICT_LABEL[u.verdict]}</span>
        </li>
      ))}
    </ul>
  );
}
