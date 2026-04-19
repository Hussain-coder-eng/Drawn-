import React, { useRef, useState, useEffect } from 'react';
import { NormalizedPoint, rdpSimplify } from '../lib/shapeMath';

interface DrawingCanvasProps {
  onShapeComplete: (points: NormalizedPoint[]) => void;
}

export function DrawingCanvas({ onShapeComplete }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [points, setPoints] = useState<{ x: number; y: number; t: number }[]>([]);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);
  // Accumulates all completed strokes for the current drawing session
  const allStrokesRef = useRef<NormalizedPoint[][]>([]);

  useEffect(() => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (context) {
        context.strokeStyle = '#ec4899'; // pink-500
        context.lineWidth = 3;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        setCtx(context);
      }
    }
  }, []);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    const { x, y } = getCoordinates(e);
    // Reset current-stroke points only (does NOT clear allStrokesRef)
    setPoints([{ x, y, t: Date.now() }]);

    if (ctx) {
      const canvas = canvasRef.current!;
      ctx.beginPath();
      ctx.moveTo(x * canvas.width, y * canvas.height);
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !ctx) return;
    const { x, y } = getCoordinates(e);
    const canvas = canvasRef.current!;
    
    ctx.lineTo(x * canvas.width, y * canvas.height);
    ctx.stroke();
    
    setPoints(prev => [...prev, { x, y, t: Date.now() }]);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (points.length > 10) {
      const cleaned = cleanPoints(points);
      // Accumulate this stroke alongside all previous ones
      allStrokesRef.current = [...allStrokesRef.current, cleaned];
      // Emit the full connected path (all strokes concatenated, same pattern as words/letters)
      onShapeComplete(allStrokesRef.current.flat());
    }
  };

  const cleanPoints = (raw: { x: number; y: number; t: number }[]): NormalizedPoint[] => {
    // 1. Temporal deduplication
    let processed = raw.filter((p, i) => i === 0 || p.t - raw[i-1].t > 16);

    // 2. Spatial deduplication
    processed = processed.filter((p, i) => {
      if (i === 0) return true;
      const dist = Math.sqrt(Math.pow(p.x - processed[i-1].x, 2) + Math.pow(p.y - processed[i-1].y, 2));
      return dist > 0.01;
    });

    // 3. Gaussian smoothing (simple moving average)
    const smoothed: NormalizedPoint[] = [];
    for (let i = 0; i < processed.length; i++) {
      let sumX = 0, sumY = 0, count = 0;
      for (let j = Math.max(0, i - 2); j <= Math.min(processed.length - 1, i + 2); j++) {
        sumX += processed[j].x;
        sumY += processed[j].y;
        count++;
      }
      smoothed.push({ x: sumX / count, y: sumY / count });
    }

    // 4. RDP Simplification
    return rdpSimplify(smoothed, 0.03);
  };

  const clear = () => {
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    // Reset both current stroke and all accumulated strokes
    allStrokesRef.current = [];
    setPoints([]);
    // Notify parent so it clears drawnPath (hides "Shape Captured" indicator)
    onShapeComplete([]);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative bg-slate-900 rounded-xl border-2 border-slate-700 overflow-hidden shadow-2xl">
        <canvas
          ref={canvasRef}
          data-testid="drawing-canvas"
          width={320}
          height={320}
          className="touch-none cursor-crosshair"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {points.length === 0 && allStrokesRef.current.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-500 font-medium">
            Draw your shape here
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={clear}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
