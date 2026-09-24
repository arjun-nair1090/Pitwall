import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  label: string;
  pressed?: boolean;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, pressed, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-control text-mute transition-colors hover:bg-raised hover:text-chalk md:h-8 md:w-8",
        pressed && "bg-raised text-chalk",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
