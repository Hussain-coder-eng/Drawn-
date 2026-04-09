import { SHAPES, FONT_STYLES } from "@/src/constants";
import { cn } from "@/src/lib/utils";
import { InputMode } from "@/src/types";
import { motion } from "motion/react";
import { Pencil, Trash2, Check, Keyboard, Type } from "lucide-react";
import { Point } from "@/src/lib/shapeMath";
import React, { useRef, useEffect, useState } from "react";

interface DesignInputProps {
  mode: InputMode;
  setMode: (mode: InputMode) => void;
  selectedShape: string | null;
  setSelectedShape: (id: string | null) => void;
  textInput: string;
  setTextInput: (text: string) => void;
  fontStyle: string;
  setFontStyle: (id: string) => void;
  drawnPath: Point[];
  setDrawnPath: (path: Point[]) => void;
}

export default function DesignInput({
  mode,
  setMode,
  selectedShape,
  setSelectedShape,
  textInput,
  setTextInput,
  fontStyle,
  setFontStyle,
  drawnPath,
  setDrawnPath,
}: DesignInputProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [localPath, setLocalPath] = useState<Point[]>([]);

  // Clear canvas when mode changes to draw
  useEffect(() => {
    if (mode === "draw") {
      clearCanvas();
    }
  }, [mode]);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ("touches" in e) ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = ("touches" in e) ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setLocalPath([{ lat: y, lng: x }]);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ("touches" in e) ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = ("touches" in e) ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.strokeStyle = "#FF2D6B";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();

    setLocalPath(prev => [...prev, { lat: y, lng: x }]);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (localPath.length >= 2) {
      setDrawnPath(localPath);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setLocalPath([]);
    setDrawnPath([]);
  };

  const handleUseShape = () => {
    if (localPath.length > 0) {
      setDrawnPath(localPath);
    }
  };

  return (
    <div className="space-y-6">
      {/* Label */}
      <label className="text-[11px] font-sans font-medium uppercase tracking-[0.12em] text-text-secondary">
        Choose Your Shape
      </label>

      {/* Pill Tabs */}
      <div className="flex bg-bg-subtle p-1 rounded-full">
        {(["shapes", "text", "draw"] as InputMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "flex-1 py-2 text-[12px] font-sans font-medium uppercase tracking-[0.08em] rounded-full transition-all duration-200",
              mode === m ? "bg-accent-primary text-white glow-pink" : "text-text-secondary hover:text-white"
            )}
          >
            {m === "shapes" ? "Premade" : m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {/* Mode Content */}
      <motion.div
        key={mode}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="min-h-[200px]"
      >
        {mode === "shapes" && (
          <div className="grid grid-cols-3 gap-2">
            {SHAPES.map((shape) => {
              const Icon = shape.icon;
              const isSelected = selectedShape === shape.id;
              return (
                <button
                  key={shape.id}
                  onClick={() => setSelectedShape(shape.id)}
                  className={cn(
                    "flex flex-col items-center justify-center w-full aspect-square rounded-[12px] border-[1.5px] transition-all duration-200 group",
                    isSelected 
                      ? "border-accent-primary bg-bg-card glow-pink-strong" 
                      : "border-transparent bg-bg-card hover:border-divider"
                  )}
                >
                  <Icon className={cn("w-10 h-10 mb-2 transition-colors", isSelected ? "text-accent-primary" : "text-white")} />
                  <span className={cn("text-[10px] font-sans font-medium uppercase tracking-tighter", isSelected ? "text-accent-primary" : "text-text-secondary")}>
                    {shape.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {mode === "text" && (
          <div className="space-y-6">
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2">
                <Keyboard className="w-5 h-5 text-accent-primary" />
              </div>
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type a word, name, or number..."
                className="w-full h-[56px] bg-bg-card border border-divider rounded-[10px] pl-12 pr-4 text-[15px] font-sans text-white focus:outline-none focus:border-accent-primary transition-colors placeholder:text-text-muted"
              />
              <p className="text-[12px] text-text-secondary mt-3 ml-1 font-sans">
                Letters connect into one continuous path
              </p>
            </div>

            <div className="space-y-3">
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
          </div>
        )}

        {mode === "draw" && (
          <div className="space-y-4">
            <div className="relative aspect-square w-full bg-bg-card rounded-[16px] border border-divider overflow-hidden group">
              <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#505050 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
              <canvas
                ref={canvasRef}
                width={300}
                height={300}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className="w-full h-full cursor-crosshair relative z-10"
              />
              <div className="absolute top-4 left-4 flex gap-2 z-20">
                <button className="p-2 bg-bg-subtle rounded-lg text-accent-primary border border-accent-primary/20">
                  <Pencil className="w-4 h-4" />
                </button>
                <button 
                  onClick={clearCanvas}
                  className="p-2 bg-bg-subtle rounded-lg text-text-secondary hover:text-white transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <div className="ml-2 flex flex-col justify-center">
                  <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest leading-none">Draw</p>
                  <p className="text-[8px] text-text-muted mt-0.5">Single stroke</p>
                </div>
              </div>
              {drawnPath.length > 0 && (
                <div className="absolute bottom-4 right-4 z-20">
                  <div className="flex items-center gap-2 bg-success/20 border border-success/30 px-3 py-1.5 rounded-full backdrop-blur-md">
                    <Check className="w-3 h-3 text-success" />
                    <span className="text-[10px] font-bold text-success uppercase tracking-wider">Shape Saved</span>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={handleUseShape}
              disabled={localPath.length < 2}
              className={cn(
                "w-full flex items-center justify-center gap-2 py-3 rounded-[12px] border text-[15px] font-sans font-bold transition-all",
                localPath.length >= 2 
                  ? "border-accent-primary text-accent-primary hover:bg-accent-primary/5" 
                  : "border-divider text-text-muted cursor-not-allowed"
              )}
            >
              {drawnPath.length > 0 ? "Update Shape →" : "Use This Shape →"}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
