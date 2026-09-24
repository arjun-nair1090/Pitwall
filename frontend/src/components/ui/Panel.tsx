import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PanelProps {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
}

// A broadcast panel: a squared box with a labelled header band across the top. The title is set in
// the display face, upper case and tracked out, the way every caption on a timing feed is.
export default function Panel({ title, meta, actions, children, className, bodyClassName, headerClassName }: PanelProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("flex min-h-0 flex-col rounded-panel border border-gantry bg-kerb", className)}>
      <header className={cn("flex h-10 shrink-0 items-center gap-3 border-b border-gantry bg-raised/40 px-3", headerClassName)}>
        <h2 id={headingId} className="truncate font-display text-xs font-bold uppercase tracking-[0.14em] text-chalk">{title}</h2>
        {meta && <div className="truncate text-xs tabular-nums text-mute">{meta}</div>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
