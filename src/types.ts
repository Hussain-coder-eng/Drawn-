import { Point } from "./lib/shapeMath";

export type InputMode = "shapes" | "text" | "draw";

export interface DebugInfo {
  idealPath: Array<{ lat: number; lng: number }>;
  snappedWaypoints: Array<{ lat: number; lng: number }>;
}

export interface DrawnState {
  mode: InputMode;
  selectedShape: string | null;
  textInput: string;
  distance: number;
  unit: "mi" | "km";
  location: string;
  isGenerating: boolean;
  hasResult: boolean;
  routeFidelity: number;
  idealCoords: Point[];
  snappedCoords: Point[];
  drawnPath: Point[];
  normalizedDrawnPath: { x: number; y: number }[];
  nodeMap?: Map<string, Point>;
  debugInfo?: DebugInfo | null;
}
