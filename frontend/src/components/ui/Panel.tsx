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

export default function Panel({ title, meta, actions, children, className, bodyClassName, headerClassName }: PanelProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("flex min-h-0 flex-col rounded-panel border border-gantry bg-kerb", className)}>
      <header className={cn("flex h-11 shrink-0 items-center gap-3 border-b border-gantry px-3", headerClassName)}>
        <h2 id={headingId} className="truncate text-sm font-semibold text-chalk">{title}</h2>
        {meta && <div className="truncate text-xs tabular-nums text-mute">{meta}</div>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
