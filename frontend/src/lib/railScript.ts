// Server-safe (no React): imported by the root layout, which is a Server Component.
export const RAIL_KEY = "pitwall.rail";

// Runs in <head> before the first paint and restores a collapsed sidebar, so it never flashes open
// and then snaps shut on reload. Must not throw if storage is blocked.
export const RAIL_INIT_SCRIPT = `try{if(localStorage.getItem("${RAIL_KEY}")==="collapsed")document.documentElement.dataset.rail="collapsed"}catch(e){}`;
