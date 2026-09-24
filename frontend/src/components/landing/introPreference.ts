export const INTRO_KEY = "pitwall.intro.seen";

type WindowLike = Pick<Window, "matchMedia" | "sessionStorage">;

// The start-lights intro plays once per browser session, and never under reduced motion.
export function readIntroPreference(win: WindowLike): "play" | "skip" {
  try {
    if (win.matchMedia("(prefers-reduced-motion: reduce)").matches) return "skip";
    if (win.sessionStorage.getItem(INTRO_KEY)) return "skip";
  } catch {
    // storage blocked: play once per page view
  }
  return "play";
}

export function markIntroSeen(win: WindowLike): void {
  try {
    win.sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    // nothing to remember it with
  }
}
