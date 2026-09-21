import Link from "next/link";
import HeroTower from "@/components/landing/HeroTower";
import { buttonClass } from "@/components/ui/Button";
import { MODULES } from "@/lib/modules";

const INDEX = MODULES.filter((m) => m.group !== "More");

export default function LandingPage() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-16 py-4 md:py-10">
      <section className="grid items-center gap-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-chalk md:text-7xl">
            The pit wall, in your browser.
          </h1>
          <p className="mt-5 max-w-md text-base text-mute md:text-lg">
            Live timing, telemetry and race analysis for every Grand Prix since 2018.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/live" className={buttonClass({ variant: "primary" })}>Open live timing</Link>
            <Link href="/compare" className={buttonClass({ variant: "secondary" })}>Compare two drivers</Link>
          </div>
        </div>
        <div className="lg:col-span-7">
          <HeroTower />
        </div>
      </section>

      <section aria-labelledby="inside-heading">
        <h2 id="inside-heading" className="font-display text-3xl font-extrabold text-chalk">What's inside</h2>
        <ul className="mt-6 grid gap-x-10 md:grid-cols-2">
          {INDEX.map((m) => {
            const Icon = m.icon;
            return (
              <li key={m.id} className="border-t border-gantry">
                <Link href={m.href} className="flex items-start gap-4 py-5 transition-colors hover:bg-raised/50">
                  <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-mute" />
                  <span>
                    <span className="block font-semibold text-chalk">{m.label}</span>
                    <span className="mt-1 block text-sm text-mute">{m.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
