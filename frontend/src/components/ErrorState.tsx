import React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import Button from "@/components/ui/Button";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export default function ErrorState({ title = "Something went wrong", message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-panel border border-live/40 bg-kerb p-8 text-center">
      <AlertTriangle aria-hidden className="h-6 w-6 text-live-text" />
      <h3 className="font-semibold text-chalk">{title}</h3>
      <p className="max-w-md text-sm text-mute">{message}</p>
      {onRetry && (
        <Button onClick={onRetry}>
          <RotateCw aria-hidden className="h-4 w-4" />
          Try again
        </Button>
      )}
    </div>
  );
}
