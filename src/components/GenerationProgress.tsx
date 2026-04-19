// src/components/GenerationProgress.tsx
import { Check, XCircle } from "lucide-react";
import { cn } from "../lib/utils";

const STEPS = [
  "Fetching road network",
  "Optimizing shape orientation",
  "Selecting route nodes",
  "Routing on real streets",
  "Scoring & refining",
];

export function messageToStepIndex(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes('road') || lower.includes('network') || lower.includes('map') || lower.includes('fetch')) return 0;
  if (lower.includes('orient') || lower.includes('optim')) return 1;
  if (
    lower.includes('selecting route') ||
    lower.includes('contacting ai') ||
    lower.includes('laying out') ||
    lower.includes('gemini') ||
    lower.includes('node') ||
    lower.includes(' ai ') ||
    lower.startsWith('ai ') ||
    lower.includes('ai is') ||
    lower.includes('ai rate')
  ) {
    return 2;
  }
  if (lower.includes('rout') || lower.includes('street')) return 3;
  if (lower.includes('scor') || lower.includes('refin') || lower.includes('fitness')) return 4;
  return -1;
}

interface GenerationProgressProps {
  message: string;
  error: string | null;
  onRetry: () => void;
}

export default function GenerationProgress({ message, error, onRetry }: GenerationProgressProps) {
  const activeStep = messageToStepIndex(message);

  if (error) {
    return (
      <div className="bg-bg-card border border-divider rounded-[24px] p-8 w-[320px] space-y-6 text-center">
        <XCircle className="w-12 h-12 text-danger mx-auto" />
        <p className="text-[14px] font-sans text-white">{error}</p>
        <button
          onClick={onRetry}
          className="w-full h-[48px] bg-accent-primary text-white rounded-[12px] font-bold uppercase tracking-widest text-[13px]"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div data-testid="generation-progress" className="bg-bg-card border border-divider rounded-[24px] p-8 w-[320px] space-y-6">
      {/* Spinner */}
      <div className="flex justify-center">
        <div className="w-12 h-12 border-4 border-accent-primary/20 border-t-accent-primary rounded-full animate-spin" />
      </div>

      {/* Step list */}
      <div className="space-y-3">
        {STEPS.map((label, i) => {
          const isDone = activeStep > i;
          const isActive = activeStep === i;
          return (
            <div key={i} className="flex items-center gap-3">
              <div className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300",
                isDone ? "bg-accent-primary" : isActive ? "bg-accent-primary/30 ring-2 ring-accent-primary animate-pulse" : "bg-divider"
              )}>
                {isDone && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className={cn(
                "text-[13px] font-sans transition-colors duration-300",
                isDone ? "text-text-muted line-through" : isActive ? "text-white font-medium" : "text-text-muted"
              )}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
