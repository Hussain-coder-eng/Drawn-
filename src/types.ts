import { Point } from "./lib/shapeMath";

export type InputMode = "shapes" | "text" | "draw";
export type SurfacePreference = "roads" | "trails" | "mixed";

export interface DrawnState {
  mode: InputMode;
  selectedShape: string | null;
  textInput: string;
  fontStyle: string;
  distance: number;
  unit: "mi" | "km";
  location: string;
  surface: SurfacePreference;
  isGenerating: boolean;
  hasResult: boolean;
  routeFidelity: number;
  idealCoords: Point[];
  snappedCoords: Point[];
  drawnPath: Point[];
}
