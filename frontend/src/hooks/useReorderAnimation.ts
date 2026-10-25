"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
// Close to the critically damped spring the towers used before: quick off the mark, no overshoot.
const DURATION_MS = 450;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// Whether the device asks for reduced motion, kept up to date if the setting changes.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_MOTION);
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

// Slides each row from where it was to where it now is whenever the order changes, so a car visibly
// moves up or down the tower. Each row's top is measured after every change in order; a row that
// moved starts translated back to its old place and animates to its new one. Rows that appear are
// not animated. `rowRef(key)` goes on each row as its `ref`.
export function useReorderAnimation<T extends HTMLElement>(order: readonly (string | number)[], enabled: boolean) {
  const nodes = useRef(new Map<string | number, T>());
  const refs = useRef(new Map<string | number, (el: T | null) => void>());
  const tops = useRef(new Map<string | number, number>());
  const orderKey = order.join(",");

  useLayoutEffect(() => {
    const next = new Map<string | number, number>();
    nodes.current.forEach((el, key) => {
      const top = el.offsetTop;
      next.set(key, top);
      const from = tops.current.get(key);
      if (!enabled || from === undefined || from === top || typeof el.animate !== "function") return;
      el.animate([{ transform: `translateY(${from - top}px)` }, { transform: "none" }], { duration: DURATION_MS, easing: EASING });
    });
    tops.current = next;
  }, [orderKey, enabled]);

  return useCallback((key: string | number) => {
    let ref = refs.current.get(key);
    if (!ref) {
      ref = (el: T | null) => {
        if (el) nodes.current.set(key, el);
        else nodes.current.delete(key);
      };
      refs.current.set(key, ref);
    }
    return ref;
  }, []);
}
