import { useCallback, useSyncExternalStore } from "react";
import { RAIL_KEY } from "./railScript";

// Whether the sidebar is collapsed lives on <html data-rail="collapsed">, not in React state, so
// the stylesheet can size everything from it. A tiny script in <head> (RAIL_INIT_SCRIPT) restores
// the saved choice before the first paint, which is what stops the sidebar flashing open and
// then snapping shut on every reload.

const listeners = new Set<() => void>();

export const isRailCollapsed = (): boolean => typeof document !== "undefined" && document.documentElement.dataset.rail === "collapsed";

export function setRailCollapsed(collapsed: boolean): void {
  if (collapsed) document.documentElement.dataset.rail = "collapsed";
  else delete document.documentElement.dataset.rail;
  try {
    localStorage.setItem(RAIL_KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    // storage blocked (private window): the choice still applies for this visit
  }
  listeners.forEach((listener) => listener());
}

export function subscribeRail(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// [collapsed, setCollapsed]. Renders expanded on the server and on first hydration, then follows
// the page attribute.
export function useRailCollapsed(): [boolean, (collapsed: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribeRail, isRailCollapsed, () => false);
  const set = useCallback((next: boolean) => setRailCollapsed(next), []);
  return [collapsed, set];
}
