import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
// Red is the one action colour, the way it is on every official F1 surface. Everything else is a
// quiet outline, so the primary action is the only thing on a page competing with the data.
const VARIANT: Record<Variant, string> = {
  primary: "bg-live text-white hover:bg-live-deep",
  secondary: "border border-edge text-chalk hover:border-chalk hover:bg-raised",
  ghost: "text-mute hover:bg-raised hover:text-chalk",
  danger: "border border-live text-live-text hover:bg-live hover:text-white",
};
// "sm" is compact only where a pointer is available; phones keep the 40px target.
const SIZE: Record<Size, string> = {
  md: "h-10 px-4 text-sm",
  sm: "h-10 px-3 text-sm md:h-8 md:text-xs",
};

export function buttonClass({ variant = "secondary", size = "md", className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading = false, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, className })}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export default Button;
