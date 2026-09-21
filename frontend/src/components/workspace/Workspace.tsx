"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import IconButton from "@/components/ui/IconButton";
import Panel from "@/components/ui/Panel";
import { loadLayouts, resetLayouts, saveLayouts, type Layouts } from "@/lib/layoutStore";

export interface WorkspacePanelDef {
  id: string;
  title: string;
  meta?: ReactNode;
  render: () => ReactNode;
}

interface WorkspaceProps {
  name: string;
  panels: WorkspacePanelDef[];
  defaults: Layouts;
  rowHeight?: number;
  /** Increment to reset to the default layout. */
  resetKey?: number;
}

const Grid = WidthProvider(Responsive);

// Each panel's content lives in a detached host element that is *moved* between the
// grid cell and the full-screen overlay. The content is rendered once, through a
// portal into that host, so expanding never remounts it (chat logs and typed input survive).
function WorkspacePanel({
  def, expanded, overlay, onToggle,
}: { def: WorkspacePanelDef; expanded: boolean; overlay: HTMLElement | null; onToggle: () => void }) {
  const slot = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "h-full min-h-0";
    return el;
  });

  useLayoutEffect(() => {
    const target = expanded ? overlay : slot.current;
    if (target && host.parentElement !== target) target.appendChild(host);
  }, [expanded, overlay, host]);

  return (
    <>
      {createPortal(def.render(), host)}
      <Panel
        title={def.title}
        meta={def.meta}
        className="h-full"
        headerClassName="panel-drag-handle cursor-grab active:cursor-grabbing"
        actions={
          <IconButton label={`Expand ${def.title}`} onClick={onToggle}>
            <Maximize2 aria-hidden className="h-4 w-4" />
          </IconButton>
        }
      >
        <div ref={slot} className="h-full min-h-0" />
      </Panel>
    </>
  );
}

export default function Workspace({ name, panels, defaults, rowHeight = 56, resetKey = 0 }: WorkspaceProps) {
  const [layouts, setLayouts] = useState<Layouts>(() => loadLayouts(name, defaults));
  const [breakpoint, setBreakpoint] = useState("lg");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const firstReset = useRef(true);

  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    resetLayouts(name);
    setLayouts(defaults);
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setExpandedId(null);
    returnFocus.current?.focus();
  };

  useEffect(() => {
    if (!expandedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setExpandedId(null);
        returnFocus.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  const expanded = panels.find((p) => p.id === expandedId);
  const desktop = breakpoint === "lg";

  return (
    <>
      <Grid
        layouts={layouts}
        breakpoints={{ lg: 1024, sm: 0 }}
        cols={{ lg: 12, sm: 1 }}
        rowHeight={rowHeight}
        margin={[12, 12]}
        isDraggable={desktop}
        isResizable={desktop}
        draggableHandle=".panel-drag-handle"
        // Buttons in the title strip (Expand) must click, not start a drag.
        draggableCancel="button, a, input, select, textarea"
        onBreakpointChange={(bp: string) => setBreakpoint(bp)}
        onLayoutChange={(_current: unknown, all: Layouts) => {
          setLayouts(all);
          saveLayouts(name, all);
        }}
      >
        {panels.map((def) => (
          <div key={def.id}>
            <WorkspacePanel
              def={def}
              expanded={expandedId === def.id}
              overlay={overlay}
              onToggle={() => {
                returnFocus.current = document.activeElement as HTMLElement | null;
                setExpandedId(def.id);
              }}
            />
          </div>
        ))}
      </Grid>

      {expanded && (
        <div role="dialog" aria-modal="true" aria-label={expanded.title} className="fixed inset-0 z-40 flex flex-col bg-tarmac p-3 md:p-6">
          <div className="flex items-center gap-3 pb-3">
            <h2 className="font-display text-2xl font-extrabold text-chalk">{expanded.title}</h2>
            <IconButton className="ml-auto" label="Exit full screen" onClick={close} autoFocus>
              <Minimize2 aria-hidden className="h-4 w-4" />
            </IconButton>
          </div>
          <div ref={setOverlay} className="min-h-0 flex-1 overflow-auto rounded-panel border border-gantry bg-kerb" />
        </div>
      )}
    </>
  );
}
