// src/components/DesignInput.tsx
import { SHAPES } from "@/src/constants";
import { cn } from "@/src/lib/utils";
import { InputMode } from "@/src/types";
import { motion } from "motion/react";
import { Check, Keyboard, Image as ImageIcon } from "lucide-react";
import { Point, NormalizedPoint } from "@/src/lib/shapeMath";
import React, { useState, useRef } from "react";
import { DrawingCanvas } from "./DrawingCanvas";
import { imageToOutline } from "@/src/services/visionService";

interface DesignInputProps {
  mode: InputMode;
  selectedShape: string | null;
  setSelectedShape: (id: string | null) => void;
  textInput: string;
  setTextInput: (text: string) => void;
  drawnPath: Point[];
  setDrawnPath: (path: Point[]) => void;
  setNormalizedDrawnPath: (path: NormalizedPoint[]) => void;
  expanded: boolean;
  onModeSelect: (mode: InputMode) => void;
  returnToStart: boolean;
  onReturnToStartChange: (v: boolean) => void;
}

function ReturnToStartToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      type="button"
      data-testid="return-to-start-toggle"
      onClick={() => onChange(!value)}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-[10px] border w-full transition-colors",
        value
          ? "border-accent-primary/50 bg-accent-primary/10"
          : "border-divider bg-bg-card hover:border-accent-primary/30"
      )}
    >
      <div className={cn(
        "w-8 h-4 rounded-full transition-colors relative shrink-0",
        value ? "bg-accent-primary" : "bg-text-muted"
      )}>
        <div className={cn(
          "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform",
          value ? "left-0.5 translate-x-4" : "left-0.5 translate-x-0"
        )} />
      </div>
      <span className="text-[11px] font-sans font-medium uppercase tracking-[0.08em] text-text-secondary">
        Return to start
      </span>
    </button>
  );
}

export default function DesignInput({
  mode,
  selectedShape,
  setSelectedShape,
  textInput,
  setTextInput,
  drawnPath,
  setDrawnPath,
  setNormalizedDrawnPath,
  expanded,
  onModeSelect,
  returnToStart,
  onReturnToStartChange,
}: DesignInputProps) {
  const handleShapeComplete = (points: NormalizedPoint[]) => {
    setNormalizedDrawnPath(points);
    const previewPoints = points.map(p => ({ lat: p.y * 100, lng: p.x * 100 }));
    setDrawnPath(previewPoints);
  };

  // Image mode local state
  const [imageProgress, setImageProgress] = useState<string>("");
  const [imageError, setImageError] = useState<string | null>(null);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [imageThumbnail, setImageThumbnail] = useState<string | null>(null);
  const [imageOutlineCaptured, setImageOutlineCaptured] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImageFile = async (file: File) => {
    setImageError(null);
    setImageOutlineCaptured(false);
    setImageProgress("");
    setIsImageLoading(true);
    setImageThumbnail(URL.createObjectURL(file));
    try {
      const outline = await imageToOutline(file, (msg) => setImageProgress(msg));
      handleShapeComplete(outline);
      setImageOutlineCaptured(true);
    } catch (err: any) {
      setImageError(err.message || "Failed to trace image. Please try again.");
      setImageThumbnail(null);
    } finally {
      setIsImageLoading(false);
      setImageProgress("");
    }
  };

  const modeLabels: Record<InputMode, string> = {
    shapes: "Premade",
    text: "Text",
    draw: "Draw",
    image: "Image",
  };

  return (
    <div className="space-y-4">
      {/* Mode cards — always visible */}
      <div className="grid grid-cols-4 gap-2 pt-2">
        {(["shapes", "text", "draw", "image"] as InputMode[]).map((m) => (
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
                  maxLength={20}
                  placeholder="Type a word or name…"
                  className="w-full h-[52px] bg-bg-card border border-divider rounded-[10px] pl-12 pr-4 text-[15px] font-sans text-white focus:outline-none focus:border-accent-primary transition-colors placeholder:text-text-muted"
                />
              </div>
              <ReturnToStartToggle value={returnToStart} onChange={onReturnToStartChange} />
            </div>
          )}

          {mode === "draw" && (
            <div className="space-y-3">
              <DrawingCanvas onShapeComplete={handleShapeComplete} />
              {drawnPath.length > 0 && (
                <div className="flex items-center justify-center gap-2 bg-success/20 border border-success/30 px-3 py-1.5 rounded-full w-fit mx-auto">
                  <Check className="w-3 h-3 text-success" />
                  <span data-point-count={drawnPath.length} className="text-[10px] font-bold text-success uppercase tracking-wider">Shape Captured</span>
                </div>
              )}
              <ReturnToStartToggle value={returnToStart} onChange={onReturnToStartChange} />
            </div>
          )}

          {mode === "image" && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={isImageLoading}
                className={cn(
                  "w-full h-[120px] flex flex-col items-center justify-center rounded-[12px] border-[1.5px] border-dashed transition-all duration-200 gap-2",
                  isImageLoading
                    ? "border-accent-primary/40 bg-accent-primary/5 cursor-not-allowed"
                    : "border-divider bg-bg-card hover:border-accent-primary/50"
                )}
              >
                {imageThumbnail ? (
                  <img src={imageThumbnail} alt="Uploaded" className="h-full w-full object-contain rounded-[10px] p-1" />
                ) : (
                  <>
                    <ImageIcon className="w-7 h-7 text-text-muted" />
                    <span className="text-[11px] font-sans font-medium uppercase tracking-[0.08em] text-text-secondary">
                      Tap to upload image
                    </span>
                  </>
                )}
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageFile(file);
                  e.target.value = "";
                }}
              />
              {isImageLoading && imageProgress && (
                <div className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-full w-fit mx-auto">
                  <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">{imageProgress}</span>
                </div>
              )}
              {imageOutlineCaptured && !isImageLoading && (
                <div className="flex items-center justify-center gap-2 bg-success/20 border border-success/30 px-3 py-1.5 rounded-full w-fit mx-auto">
                  <Check className="w-3 h-3 text-success" />
                  <span className="text-[10px] font-bold text-success uppercase tracking-wider">Outline Captured</span>
                </div>
              )}
              {imageError && (
                <div className="p-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-[11px] font-medium text-center">
                  {imageError}
                  <button
                    type="button"
                    onClick={() => { setImageError(null); setImageThumbnail(null); setImageOutlineCaptured(false); }}
                    className="block mx-auto mt-1 text-[10px] underline text-danger/70 hover:text-danger"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
