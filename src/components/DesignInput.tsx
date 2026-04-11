import { SHAPES, FONT_STYLES } from "@/src/constants";
import { cn } from "@/src/lib/utils";
import { InputMode } from "@/src/types";
import { motion } from "motion/react";
import { Pencil, Trash2, Check, Keyboard, Type } from "lucide-react";
import { Point, NormalizedPoint } from "@/src/lib/shapeMath";
import React, { useRef, useEffect, useState } from "react";
import { DrawingCanvas } from "./DrawingCanvas";

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
  setNormalizedDrawnPath: (path: NormalizedPoint[]) => void;
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
  setNormalizedDrawnPath,
}: DesignInputProps) {
  const handleShapeComplete = (points: NormalizedPoint[]) => {
    setNormalizedDrawnPath(points);
    // Convert normalized points back to a rough lat/lng for preview
    const previewPoints = points.map(p => ({
      lat: p.y * 100,
      lng: p.x * 100
    }));
    setDrawnPath(previewPoints);
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
            <DrawingCanvas onShapeComplete={handleShapeComplete} />
            {drawnPath.length > 0 && (
              <div className="flex items-center justify-center gap-2 bg-success/20 border border-success/30 px-3 py-1.5 rounded-full backdrop-blur-md w-fit mx-auto">
                <Check className="w-3 h-3 text-success" />
                <span className="text-[10px] font-bold text-success uppercase tracking-wider">Shape Captured</span>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
