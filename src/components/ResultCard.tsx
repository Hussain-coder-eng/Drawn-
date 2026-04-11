import { motion } from "motion/react";
import { Download, Share2, RefreshCw, Footprints, Clock, Heart, CheckCircle2, AlertTriangle, XCircle, Settings } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface ResultCardProps {
  distance: number;
  unit: string;
  shapeLabel: string;
  fidelity: number;
  onRegenerate: () => void;
  onFineTune: () => void;
  failingStages?: number[];
}

export default function ResultCard({
  distance,
  unit,
  shapeLabel,
  fidelity,
  onRegenerate,
  onFineTune,
  failingStages = [],
}: ResultCardProps) {
  const getStatusColor = (score: number) => {
    if (score >= 90) return "text-success border-success bg-success/10";
    if (score >= 70) return "text-warning border-warning bg-warning/10";
    return "text-danger border-danger bg-danger/10";
  };

  const getStatusIcon = (score: number) => {
    if (score >= 90) return <CheckCircle2 className="w-5 h-5" />;
    if (score >= 70) return <AlertTriangle className="w-5 h-5" />;
    return <XCircle className="w-5 h-5" />;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pt-8 border-t border-divider"
    >
      {/* Fitness Score Badge */}
      <div className={cn(
        "w-full h-[64px] rounded-[16px] border flex items-center justify-between px-6 transition-all duration-500",
        getStatusColor(fidelity),
        fidelity >= 90 && "glow-pink" // Using pink glow as signature even for success if requested, but spec says "The fitness score badge when it passes"
      )}>
        <div className="flex flex-col">
          <span className="text-[24px] font-display font-bold leading-none uppercase tracking-tight">
            {fidelity}% Shape Match
          </span>
          {fidelity < 50 && (
            <span className="text-[10px] font-sans font-medium uppercase opacity-80">
              Streets here couldn't fit this shape well
            </span>
          )}
        </div>
        {getStatusIcon(fidelity)}
      </div>

      {/* Stat Pills */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-bg-card p-4 rounded-[16px] border border-divider flex flex-col items-center justify-center text-center">
          <Footprints className="w-5 h-5 text-accent-primary mb-2" />
          <span className="text-[18px] font-display font-bold text-white leading-none">{distance.toFixed(1)} {unit}</span>
          <span className="text-[10px] text-text-secondary uppercase font-medium tracking-[0.08em] mt-1">Distance</span>
        </div>
        <div className="bg-bg-card p-4 rounded-[16px] border border-divider flex flex-col items-center justify-center text-center">
          <Clock className="w-5 h-5 text-accent-primary mb-2" />
          <span className="text-[18px] font-display font-bold text-white leading-none">~{Math.round(distance * 10)} MIN</span>
          <span className="text-[10px] text-text-secondary uppercase font-medium tracking-[0.08em] mt-1">Est. Time</span>
        </div>
        <div className="bg-bg-card p-4 rounded-[16px] border border-divider flex flex-col items-center justify-center text-center">
          <Heart className="w-5 h-5 text-accent-primary mb-2" />
          <span className="text-[18px] font-display font-bold text-white leading-none uppercase">{shapeLabel}</span>
          <span className="text-[10px] text-text-secondary uppercase font-medium tracking-[0.08em] mt-1">Shape</span>
        </div>
      </div>

      {/* Per-stage breakdown (Simplified for now as requested) */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <label className="text-[11px] font-sans font-medium uppercase tracking-[0.12em] text-text-secondary">Stage Accuracy</label>
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div 
              key={i} 
              className={cn(
                "flex-1 h-2 rounded-[4px]",
                failingStages.includes(i + 1) ? "bg-accent-primary" : "bg-success"
              )} 
            />
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <button className="flex-1 h-[48px] flex items-center justify-center gap-2 rounded-[12px] bg-accent-primary text-white text-[15px] font-sans font-bold hover:bg-accent-secondary transition-all group">
            <Download className="w-5 h-5" />
            Export GPX
          </button>
          <button className="flex-1 h-[48px] flex items-center justify-center gap-2 rounded-[12px] bg-bg-card border border-accent-primary text-white text-[15px] font-sans font-bold hover:bg-bg-subtle transition-all group">
            <Share2 className="w-5 h-5 text-accent-primary" />
            Share Route
          </button>
        </div>
        
        <button 
          onClick={onFineTune}
          className="w-full h-[48px] flex items-center justify-center gap-2 rounded-[12px] bg-bg-subtle border border-divider text-white text-[15px] font-sans font-bold hover:border-accent-primary transition-all"
        >
          <Settings className="w-5 h-5 text-accent-primary" />
          Fine-tune Route (Manual Nudge)
        </button>
      </div>

      <button
        onClick={onRegenerate}
        className="w-full flex items-center justify-center gap-2 py-2 text-[12px] font-sans font-medium text-accent-primary hover:text-accent-secondary transition-colors group"
      >
        <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
        Regenerate with different streets →
      </button>
    </motion.div>
  );
}
