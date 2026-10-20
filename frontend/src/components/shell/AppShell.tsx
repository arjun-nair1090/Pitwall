import type { ReactNode } from "react";
import CommandPalette from "./CommandPalette";
import MobileTabBar from "./MobileTabBar";
import Rail from "./Rail";
import SessionStoppedBanner from "./SessionStoppedBanner";
import TopBar from "./TopBar";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-chalk focus:px-3 focus:py-2 focus:text-tarmac"
      >
        Skip to content
      </a>
      <Rail />
      <div className="min-h-dvh transition-[padding-left] duration-200 motion-reduce:transition-none md:pl-[var(--rail-w)]">
        {/* One sticky block, so a stopped-session notice stays in view under the top bar while scrolling. */}
        <div className="sticky top-0 z-20">
          <TopBar />
          <SessionStoppedBanner />
        </div>
        <main id="main" tabIndex={-1} className="flex flex-col px-4 pb-24 pt-4 md:px-6 md:pb-8 md:pt-6">
          {children}
        </main>
      </div>
      <MobileTabBar />
      <CommandPalette />
    </>
  );
}
