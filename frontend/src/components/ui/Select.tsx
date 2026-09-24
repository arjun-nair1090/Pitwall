import { useId, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  label: string;
  hideLabel?: boolean;
  className?: string;
  selectClassName?: string;
}

export default function Select({ label, hideLabel = false, id, className, selectClassName, children, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={selectId} className={cn("font-display text-[11px] font-bold uppercase tracking-[0.12em] text-mute", hideLabel && "sr-only")}>{label}</label>
      <div className="relative">
        <select
          id={selectId}
          className={cn("h-10 w-full appearance-none rounded-control border border-edge bg-raised pl-3 pr-9 text-sm text-chalk disabled:opacity-50", selectClassName)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
      </div>
    </div>
  );
}
