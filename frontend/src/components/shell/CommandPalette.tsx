"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { usePaletteStore } from "@/store/usePaletteStore";
import { moduleItems, type PaletteItem } from "./paletteItems";
import PaletteView from "./PaletteView";
import { usePaletteSources } from "./usePaletteSources";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export default function CommandPalette() {
  const router = useRouter();
  const { open, setOpen, toggle } = usePaletteStore();
  const sources = usePaletteSources(open);
  const items = useMemo(() => [...moduleItems(), ...sources], [sources]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, setOpen]);

  const onSelect = (item: PaletteItem) => {
    setOpen(false);
    router.push(item.href);
  };

  return <PaletteView open={open} items={items} onClose={() => setOpen(false)} onSelect={onSelect} />;
}
