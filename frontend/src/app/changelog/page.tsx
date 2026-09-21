import { GitCommit } from "lucide-react";

interface ChangelogEntry {
  date: string;
  title: string;
  items: string[];
}

const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-09-22",
    title: "Replay any race, and a round of fixes",
    items: [
      "Track map: choose any finished race since 2018 and replay it lap by lap. Every car is where it really was, so the gaps are the true gaps, and 1x is real time. Pick a car for its speed, pedals, gear and DRS; the next lap loads while this one plays. Live is now its own tab.",
      "Head to head is rebuilt. Only drivers who actually ran laps are offered, teammates are told apart (the second driver is lighter and dashed), the dominance map always matches the laps you chose, and the ghost cars are placed by lap time. Races are picked by round, so Miami, Austin and Las Vegas are no longer one \"United States\".",
      "Strategy simulator: the race distance is always in view with a lap-budget bar, a plan can't outgrow the race, and one click fills the laps left. Add stints, use 1, 2 or 3 stop quick plans, or load a driver's real strategy and compare against it. The tyre model now separates fuel burn from wear, so tyres no longer appear to get faster with age.",
      "Advanced analytics: the session dropdown now matches what was analysed, drivers can be ranked by braking, coasting or trail braking, bars use team colours, and each state is explained in plain words.",
      "Archive: past races and standings show again for every season (the page was silently failing to load them), with a race classification for each round and links to replay it or compare its drivers.",
      "A new sidebar: labelled, grouped and collapsible, and it pushes the page instead of covering it. Live timing gets a red dot only while a session is genuinely live.",
      "Fixes: errors such as \"no live session\" are no longer reported as server failures, and tyre letters are readable on every background.",
    ],
  },
  {
    date: "2026-09-22",
    title: "A new look, and a live workspace",
    items: [
      "A new visual design across every page. Colour now only ever carries meaning: purple for the fastest time, green for a personal best, yellow for off the pace, red for live and alerts, plus tyre and team colours.",
      "Press Ctrl+K (or /) to search any page, driver or race. On a phone, the bottom bar has your five most-used pages and a More button.",
      "Live timing is now a workspace: drag panels by their titles, resize them, expand any panel to full screen, and your layout is remembered. Reset layout puts everything back.",
      "The home page now shows the latest race result as a race tower, with the five start lights on your first visit of a session (skippable, and off when your device asks for reduced motion).",
      "Lap and sector times only claim a personal best once a driver has shown you a comparison, and lapped cars no longer show a misleading gap.",
      "Fixes: the calendar dropdowns no longer list a country twice, keyboard focus is visible on every control, and duplicate session alerts are gone.",
    ],
  },
  {
    date: "2026-09-22",
    title: "Race debriefs, what-if strategy, and a mobile pass",
    items: [
      "New Race debrief: an auto-written summary of any race since 2018 with the podium, fastest lap, tyre strategies, movers, retirements and safety cars. Every debrief has a shareable link.",
      "What-if strategy: move a real driver's pit stop or change a tyre compound and see the estimated effect on their race time, with a plain-English explanation and a confidence rating.",
      "Mobile: the navigation scrolls instead of clipping, live timing and the track map stack properly on phones, and the map dots are big enough to tap.",
      "Fixes: race locking for predictions now uses the true UTC start time, the prediction form offers the season's real drivers and only open races, and validation errors show as messages instead of blanking the page.",
      "A new home page, and a Live link in the navigation (the live dashboard was previously only reachable by URL).",
    ],
  },
  {
    date: "2026-09-21",
    title: "Accounts and the prediction game",
    items: [
      "Sign up and log in with an email and password. Sessions use httpOnly cookies with CSRF protection, and logging out revokes the session server-side.",
      "New Predictions page: call the top 3 for an upcoming race. Picks lock automatically once the race session starts, checked against the official schedule.",
      "Public leaderboard scored against real official results: 25 points for an exact podium, 10 points per driver named anywhere in the real top 3.",
    ],
  },
  {
    date: "2026-09-20",
    title: "AI memory, strategy simulation, and shareability",
    items: [
      "AI Race Engineer can now answer cross-season questions (\"how did Verstappen's strategy at Spa compare across recent years\") via a real retrieval pipeline over historical FastF1 data, not just the live session.",
      "New Strategy simulator: pick a hypothetical tire strategy and get a predicted race time from a degradation model fit to that session's own real lap data.",
      "Shareable result cards and dominance-map PNG export, for sharing a result or a head-to-head comparison outside the app.",
      "Driver season pages with race-by-race insights layered on top of championship standings.",
      "Live mode: gap-to-leader evolution chart, and live alerts for session starts, safety cars, and flag changes.",
      "Stability pass: fixed a duplicate API route, an event-loop-blocking AI call, a broken production build, and patched a critical Next.js vulnerability; added CI so these can't silently regress.",
    ],
  },
  {
    date: "2026-08-24",
    title: "Dominance maps and ghost cars",
    items: [
      "Track dominance maps comparing two drivers' pace mini-sector by mini-sector.",
      "Ghost-car overlay: watch both drivers' cars move around the circuit in sync with the telemetry.",
    ],
  },
  {
    date: "2026-08-23",
    title: "UI overhaul",
    items: [
      "Reworked head-to-head comparison with per-lap selection.",
      "Mini race replay: watch a full session unfold lap by lap.",
    ],
  },
  {
    date: "2026-07-28",
    title: "Live telemetry",
    items: [
      "Real-time car telemetry and timing over WebSockets.",
    ],
  },
  {
    date: "2026-07-27",
    title: "Initial release",
    items: [
      "F1 Pit Wall launches: historical telemetry comparison, season stats, and the AI Race Engineer.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="w-full py-4 md:p-8 max-w-3xl mx-auto space-y-8">
      <div className="pb-5">
        <h1 className="font-display text-3xl font-extrabold leading-none tracking-tight text-chalk md:text-4xl">
          Changelog
        </h1>
        <p className="mt-2 max-w-prose text-sm text-mute">
          What's new on F1 Pit Wall
        </p>
      </div>

      <div className="space-y-10">
        {CHANGELOG.map((entry) => (
          <div key={`${entry.date}-${entry.title}`} className="relative pl-8 border-l border-gantry">
            <div className="absolute left-[-5px] top-1 h-2.5 w-2.5 rounded-full bg-live" />
            <div className="text-xs text-faint tabular-nums mb-1">{entry.date}</div>
            <h2 className="text-xl font-bold text-chalk mb-3">{entry.title}</h2>
            <ul className="space-y-2">
              {entry.items.map((item, i) => (
                <li key={i} className="text-sm text-mute leading-relaxed flex gap-2">
                  <span className="text-chalk shrink-0">—</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
