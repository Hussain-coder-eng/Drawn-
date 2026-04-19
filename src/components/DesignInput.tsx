// src/components/DesignInput.tsx
import { SHAPES, FONT_STYLES } from "@/src/constants";
import { cn } from "@/src/lib/utils";
import { InputMode } from "@/src/types";
import { motion } from "motion/react";
import { Check, Keyboard } from "lucide-react";
import { Point, NormalizedPoint } from "@/src/lib/shapeMath";
import React from "react";
import { DrawingCanvas } from "./DrawingCanvas";

interface DesignInputProps {
  mode: InputMode;
  selectedShape: string | null;
  setSelectedShape: (id: string | null) => void;
  textInput: string;
  setTextInput: (text: string) => void;
  fontStyle: string;
  setFontStyle: (id: string) => void;
  drawnPath: Point[];
  setDrawnPath: (path: Point[]) => void;
  setNormalizedDrawnPath: (path: NormalizedPoint[]) => void;
  expanded: boolean;
  onModeSelect: (mode: InputMode) => void;
}

export default function DesignInput({
  mode,
  selectedShape,
  setSelectedShape,
  textInput,
  setTextInput,
  fontStyle,
  setFontStyle,
  drawnPath,
  setDrawnPath,
  setNormalizedDrawnPath,
  expanded,
  onModeSelect,
}: DesignInputProps) {
  const handleShapeComplete = (points: NormalizedPoint[]) => {
    setNormalizedDrawnPath(points);
    const previewPoints = points.map(p => ({ lat: p.y * 100, lng: p.x * 100 }));
    setDrawnPath(previewPoints);
  };

  const modeLabels: Record<InputMode, string> = {
    shapes: "Premade",
    text: "Text",
    draw: "Draw",
  };

  return (
    <div className="space-y-4">
      {/* Mode cards — always visible */}
      <div className="grid grid-cols-3 gap-2 pt-2">
        {(["shapes", "text", "draw"] as InputMode[]).map((m) => (
          <button
            key={m}
            data-testid={`mode-${m}`}
            onClick={() => onModeSelect(m)}
            className={cn(
              "h-[56px] flex flex-col items-center justify-center rounded-[14px] border-[1.5px] transition-all duration-200 gap-1",
              mode === m
                ? "border-accent-primary bg-accent-primary/10"
                : "border-divider bg-bg-card hover:border-accent-primary/50"
            )}
          >
            <span className={cn(
              "text-[11px] font-sans font-bold uppercase tracking-[0.08em]",
              mode === m ? "text-accent-primary" : "text-text-secondary"
            )}>
              {modeLabels[m]}
            </span>
          </button>
        ))}
      </div>

      {/* Expanded content */}
      {expanded && (
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="min-h-[160px]"
        >
          {mode === "shapes" && (
            <div className="grid grid-cols-4 gap-2">
              {SHAPES.map((shape) => {
                const Icon = shape.icon;
                const isSelected = selectedShape === shape.id;
                return (
                  <button
                    key={shape.id}
                    data-testid={`shape-${shape.id}`}
                    onClick={() => setSelectedShape(shape.id)}
                    className={cn(
                      "flex flex-col items-center justify-center aspect-square rounded-[12px] border-[1.5px] transition-all duration-200",
                      isSelected
                        ? "border-accent-primary bg-bg-card glow-pink-strong"
                        : "border-transparent bg-bg-card hover:border-divider"
                    )}
                  >
                    <Icon className={cn("w-7 h-7 mb-1 transition-colors", isSelected ? "text-accent-primary" : "text-white")} />
                    <span className={cn("text-[9px] font-sans font-medium uppercase tracking-tighter", isSelected ? "text-accent-primary" : "text-text-secondary")}>
                      {shape.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {mode === "text" && (
            <div className="space-y-4">
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2">
                  <Keyboard className="w-5 h-5 text-accent-primary" />
                </div>
                <input
                  type="text"
                  data-testid="text-input"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Type a word or name…"
                  className="w-full h-[52px] bg-bg-card border border-divider rounded-[10px] pl-12 pr-4 text-[15px] font-sans text-white focus:outline-none focus:border-accent-primary transition-colors placeholder:text-text-muted"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {FONT_STYLES.map((font) => (
                  <button
                    key={font.id}
                    onClick={() => setFontStyle(font.id)}
                    className={cn(
                      "flex flex-col items-center justify-center py-3 rounded-[10px] border-[1.5px] transition-all duration-200",
                      fontStyle === font.id ? "border-accent-primary bg-bg-card" : "border-transparent bg-bg-card hover:border-divider"
                    )}
                  >
                    <span className={cn(font.className, "text-[14px]", fontStyle === font.id ? "text-white" : "text-text-secondary")}>A</span>
                    <span className="text-[10px] font-sans font-medium uppercase tracking-widest text-text-muted mt-1">{font.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "draw" && (
            <div className="space-y-3">
              <DrawingCanvas onShapeComplete={handleShapeComplete} />
              {drawnPath.length > 0 && (
                <div className="flex items-center justify-center gap-2 bg-success/20 border border-success/30 px-3 py-1.5 rounded-full w-fit mx-auto">
                  <Check className="w-3 h-3 text-success" />
                  <span className="text-[10px] font-bold text-success uppercase tracking-wider">Shape Captured</span>
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
