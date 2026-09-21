import React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export default function ErrorState({ title = "Something went wrong", message, onRetry }: ErrorStateProps) {
  return (
    <div
      className="glass-panel p-8 rounded-xl border border-red-500/20 flex flex-col items-center text-center gap-3"
      role="alert"
    >
      <AlertTriangle className="w-7 h-7 text-f1-red" />
      <h3 className="text-white font-titillium font-bold uppercase tracking-wide">{title}</h3>
      <p className="text-white/50 text-sm font-titillium max-w-md">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-titillium font-bold py-2 px-5 rounded-md transition-colors"
        >
          <RotateCw className="w-4 h-4" />
          Try again
        </button>
      )}
    </div>
  );
}
