import { useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
}

export default function Input({ label, hint, error, id, className, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={inputId} className="font-display text-[11px] font-bold uppercase tracking-[0.12em] text-mute">{label}</label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={cn(
          "h-10 w-full rounded-control border bg-raised px-3 text-sm text-chalk placeholder:text-faint disabled:opacity-50",
          error ? "border-live-text" : "border-edge",
        )}
        {...rest}
      />
      {hint && <p id={hintId} className="text-xs text-faint">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-xs text-live-text">{error}</p>}
    </div>
  );
}
