import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  id: string;
  label: string;
}

export const tabId = (base: string, id: string) => `${base}-tab-${id}`;

// Spread onto the element that shows the selected tab's content.
export function tabPanelProps(base: string, id: string) {
  return { role: "tabpanel" as const, id: `${base}-panel-${id}`, "aria-labelledby": tabId(base, id), tabIndex: 0 };
}

interface TabsProps {
  tabs: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  idBase: string;
  label: string;
  className?: string;
}

export default function Tabs({ tabs, value, onChange, idBase, label, className }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((t) => t.id === value);
    if (e.key === "ArrowRight") { e.preventDefault(); move(current + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(current - 1); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(tabs.length - 1); }
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn("flex gap-1 border-b border-gantry", className)}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[tab.id] = el; }}
            role="tab"
            type="button"
            id={tabId(idBase, tab.id)}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "-mb-px h-10 border-b-2 px-3 text-sm font-medium transition-colors",
              selected ? "border-chalk text-chalk" : "border-transparent text-mute hover:text-chalk",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
