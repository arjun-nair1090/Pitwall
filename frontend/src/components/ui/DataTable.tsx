import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  className?: string;
  cell: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  caption: string;
  accent?: (row: T) => string | undefined;
  dense?: boolean;
  className?: string;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export default function DataTable<T>({ columns, rows, rowKey, caption, accent, dense = false, className }: DataTableProps<T>) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "sticky top-0 border-b border-gantry bg-raised/40 px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.1em] text-mute backdrop-blur",
                  ALIGN[c.align ?? "left"],
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const spine = accent?.(row);
            return (
              // Faintly banded, like the rows of a timing tower, with the team's colour flush to the
              // left edge of the row.
              <tr key={rowKey(row)} className="border-b border-gantry/60 even:bg-raised/20 hover:bg-raised/60">
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    style={i === 0 && spine ? { boxShadow: `inset 4px 0 0 ${spine}` } : undefined}
                    className={cn("px-3 text-chalk", dense ? "py-1.5" : "py-2.5", ALIGN[c.align ?? "left"], c.className)}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
