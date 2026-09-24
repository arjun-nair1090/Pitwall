import type { ReactNode } from "react";

// The title block of a broadcast graphic: a red bar, the name of the thing in heavy upper case, and
// a rule closing the block off from the page. Upper case is applied in CSS, so the accessible name
// and anything matching on the text are unaffected.
export default function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 border-b border-gantry pb-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-7 w-1.5 shrink-0 -skew-x-12 bg-live md:h-9" />
          <h1 className="min-w-0 font-display text-3xl font-black uppercase leading-[0.92] tracking-tight text-chalk md:text-4xl">{title}</h1>
        </div>
        {description && <p className="mt-2 max-w-prose text-sm text-mute">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
