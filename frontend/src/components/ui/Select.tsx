import { useId, type SelectHTMLAttributes } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  label: string;
  hideLabel?: boolean;
  className?: string;
  selectClassName?: string;
  // Options are still on their way: spins in place of the chevron and disables the select.
  loading?: boolean;
}

export default function Select({ label, hideLabel = false, id, className, selectClassName, loading = false, disabled, children, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={selectId} className={cn("font-display text-[11px] font-bold uppercase tracking-[0.12em] text-mute", hideLabel && "sr-only")}>{label}</label>
      <div className="relative">
        <select
          id={selectId}
          className={cn("h-10 w-full appearance-none rounded-control border border-edge bg-raised pl-3 pr-9 text-sm text-chalk disabled:opacity-50", selectClassName)}
          disabled={disabled || loading}
          aria-busy={loading || undefined}
          {...rest}
        >
          {children}
        </select>
        {/* Centred by flex, not translate: animate-spin's keyframes set transform too, and would
            replace the translate, so the icon slid up and down instead of turning. */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-mute">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </div>
    </div>
  );
}
