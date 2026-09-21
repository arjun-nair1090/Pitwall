"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import Kbd from "@/components/ui/Kbd";
import { cn } from "@/lib/cn";
import { rankMatches } from "@/lib/search";
import { groupBySection, type PaletteItem } from "./paletteItems";

interface PaletteViewProps {
  open: boolean;
  items: readonly PaletteItem[];
  onClose: () => void;
  onSelect: (item: PaletteItem) => void;
}

export default function PaletteView({ open, items, onClose, onSelect }: PaletteViewProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const groups = useMemo(() => groupBySection(rankMatches(query, items, 40)), [query, items]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setActive(0), [query]);

  // Focus in, restore focus on close, and freeze page scroll while open.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
      setQuery("");
    };
  }, [open]);

  const optionId = (index: number) => `${listId}-opt-${index}`;
  const activeId = flat[active] ? optionId(active) : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      // Two focus stops (input, and the close button on phones): keep focus inside.
      e.preventDefault();
      const other = document.activeElement === inputRef.current ? closeRef.current : inputRef.current;
      (other && other.offsetParent !== null ? other : inputRef.current)?.focus();
      return;
    }
    if (e.target !== inputRef.current) return;
    if (e.key === "ArrowDown" && flat.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % flat.length);
    } else if (e.key === "ArrowUp" && flat.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      onSelect(flat[active]);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-tarmac/80 backdrop-blur-sm md:px-4 md:pt-[12vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onKeyDown={onKeyDown}
        className="flex h-full w-full flex-col overflow-hidden border-gantry bg-kerb md:h-auto md:max-h-[70vh] md:max-w-xl md:rounded-panel md:border"
      >
        {/* The input has no outline of its own; the row's bottom border lights up instead (focus-within). */}
        <div className="flex items-center gap-3 border-b border-gantry px-4 focus-within:border-chalk">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-mute" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-label="Search pages, drivers and races"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, drivers and races"
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-chalk placeholder:text-faint focus-visible:outline-none"
          />
          <Kbd className="hidden md:inline">Esc</Kbd>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="grid h-10 w-10 place-items-center rounded-control text-mute hover:bg-raised md:hidden"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>

        <div id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
          {flat.length === 0 ? (
            <p role="status" className="px-3 py-8 text-center text-sm text-mute">
              No matches for “{query}”. Try a driver name, a race or a page name.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.section} role="group" aria-label={group.section} className="mb-2 last:mb-0">
                <p aria-hidden className="px-3 py-1.5 font-display text-[10px] font-bold uppercase tracking-[0.18em] text-faint">{group.section}</p>
                {group.items.map((item, offset) => {
                  const index = group.start + offset;
                  const selected = index === active;
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActive(index)}
                      onClick={() => onSelect(item)}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-sm",
                        selected ? "bg-raised" : "",
                      )}
                    >
                      {Icon && <Icon aria-hidden className="h-4 w-4 shrink-0 text-mute" />}
                      <span className="truncate font-medium text-chalk">{item.label}</span>
                      {item.hint && <span className="ml-auto truncate text-xs text-faint">{item.hint}</span>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
