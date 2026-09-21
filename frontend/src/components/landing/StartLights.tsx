import { cn } from "@/lib/cn";

// Decorative: the real content (the classification) is below it and the Skip button
// is the accessible control, so the lamps are hidden from assistive tech.
export default function StartLights({ lit }: { lit: number }) {
  return (
    <div aria-hidden className="inline-flex items-center gap-3 rounded-full border border-gantry bg-tarmac px-4 py-2.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-6 w-6 rounded-full border border-gantry transition-colors duration-100",
            i < lit ? "bg-live shadow-[0_0_14px_rgb(var(--f1-red)/0.7)]" : "bg-kerb",
          )}
        />
      ))}
    </div>
  );
}
