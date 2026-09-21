import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export default function EmptyState({
  title, description, action, icon: Icon, className,
}: { title: string; description?: string; action?: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}>
      {Icon && <Icon className="h-6 w-6 text-faint" aria-hidden />}
      <p className="text-sm font-semibold text-chalk">{title}</p>
      {description && <p className="max-w-sm text-sm text-mute">{description}</p>}
      {action}
    </div>
  );
}
