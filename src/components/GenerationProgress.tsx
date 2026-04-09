import { motion } from "motion/react";
import { CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";

interface GenerationProgressProps {
  attempt: number;
  maxAttempts: number;
  fitnessScore: number | null;
  failingStages: number[];
  totalStages: number;
  message: string;
}

export default function GenerationProgress({
  attempt,
  maxAttempts,
  fitnessScore,
  failingStages,
  totalStages,
  message
}: GenerationProgressProps) {
  return (
    <div className="p-8 bg-bg-card border border-divider rounded-[24px] space-y-8 shadow-2xl">
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-accent-primary/20 border-t-accent-primary rounded-full animate-spin" />
          {fitnessScore !== null && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[14px] font-display font-bold text-accent-primary">
                {fitnessScore}%
              </span>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-[18px] font-display font-bold uppercase tracking-tight text-white">
            {message}
          </p>
          <p className="text-[11px] text-text-secondary uppercase font-sans font-medium tracking-[0.12em]">
            Attempt {attempt} of {maxAttempts}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between items-center px-1">
          <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-text-muted">Stage Accuracy</span>
          <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-text-muted">{totalStages - failingStages.length}/{totalStages}</span>
        </div>
        <div className="flex justify-center gap-1.5">
          {Array.from({ length: totalStages }).map((_, i) => {
            const stageNum = i + 1;
            const isFailing = failingStages.includes(stageNum);
            const isScored = fitnessScore !== null;
            
            return (
              <motion.div
                key={i}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.05 }}
                className={cn(
                  "flex-1 h-2 rounded-full transition-colors duration-500",
                  !isScored ? "bg-divider" : isFailing ? "bg-accent-primary" : "bg-success"
                )}
              />
            );
          })}
        </div>
      </div>

      {fitnessScore !== null && failingStages.length > 0 && (
        <div className="flex items-center justify-center gap-2 text-[11px] font-sans font-bold text-accent-primary uppercase tracking-wider">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Refining {failingStages.length} stages for better shape
        </div>
      )}
    </div>
  );
}
