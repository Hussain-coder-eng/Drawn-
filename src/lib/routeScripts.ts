import * as turf from "@turf/turf";
import { Point } from "./shapeMath";

export interface RouteStage {
  stage: number;
  direction: string; // Compass direction (N, NE, E, SE, S, SW, W, NW)
  turn: "sharp-left" | "sharp-right" | "curve-left" | "curve-right" | "straight" | "close-loop";
  distancePct: number;
  description: string;
}

export interface ShapeScript {
  name: string;
  stages: RouteStage[];
}

export const SHAPE_SCRIPTS: Record<string, ShapeScript> = {
  heart: {
    name: "Heart",
    stages: [
      { stage: 1, direction: "NE", turn: "curve-right", distancePct: 15, description: "Curve up and to the right forming the top-right lobe of the heart" },
      { stage: 2, direction: "SE", turn: "curve-right", distancePct: 15, description: "Curve down and right, completing the right lobe" },
      { stage: 3, direction: "S",  turn: "sharp-left",  distancePct: 20, description: "Head south converging toward the bottom point of the heart" },
      { stage: 4, direction: "SW", turn: "sharp-right", distancePct: 20, description: "Mirror back up toward the left, passing through the bottom point" },
      { stage: 5, direction: "NW", turn: "curve-right", distancePct: 15, description: "Curve up and left forming the top-left lobe" },
      { stage: 6, direction: "NE", turn: "close-loop",  distancePct: 15, description: "Curve back to the starting point closing the top of the heart" }
    ]
  },
  star: {
    name: "Star",
    stages: [
      { stage: 1, direction: "NE", turn: "sharp-right", distancePct: 10, description: "Outward spike to the top-right" },
      { stage: 2, direction: "SE", turn: "sharp-left",  distancePct: 10, description: "Inward valley" },
      { stage: 3, direction: "E",  turn: "sharp-right", distancePct: 10, description: "Outward spike to the right" },
      { stage: 4, direction: "SW", turn: "sharp-left",  distancePct: 10, description: "Inward valley" },
      { stage: 5, direction: "SE", turn: "sharp-right", distancePct: 10, description: "Outward spike to the bottom-right" },
      { stage: 6, direction: "W",  turn: "sharp-left",  distancePct: 10, description: "Inward valley" },
      { stage: 7, direction: "SW", turn: "sharp-right", distancePct: 10, description: "Outward spike to the bottom-left" },
      { stage: 8, direction: "NW", turn: "sharp-left",  distancePct: 10, description: "Inward valley" },
      { stage: 9, direction: "W",  turn: "sharp-right", distancePct: 10, description: "Outward spike to the left" },
      { stage: 10, direction: "NE", turn: "close-loop", distancePct: 10, description: "Inward valley closing back to start" }
    ]
  },
  circle: {
    name: "Circle",
    stages: [
      { stage: 1, direction: "E",  turn: "curve-right", distancePct: 25, description: "90 degree arc through the top-right quadrant" },
      { stage: 2, direction: "S",  turn: "curve-right", distancePct: 25, description: "90 degree arc through the bottom-right quadrant" },
      { stage: 3, direction: "W",  turn: "curve-right", distancePct: 25, description: "90 degree arc through the bottom-left quadrant" },
      { stage: 4, direction: "N",  turn: "close-loop",  distancePct: 25, description: "90 degree arc through the top-left quadrant closing the loop" }
    ]
  },
  arrow: {
    name: "Arrow",
    stages: [
      { stage: 1, direction: "N",  turn: "sharp-left",  distancePct: 40, description: "Straight shaft heading North" },
      { stage: 2, direction: "SW", turn: "sharp-right", distancePct: 20, description: "Left diagonal of the arrowhead" },
      { stage: 3, direction: "NE", turn: "sharp-right", distancePct: 20, description: "Right diagonal of the arrowhead" },
      { stage: 4, direction: "S",  turn: "close-loop",  distancePct: 20, description: "Back down the shaft to the start" }
    ]
  },
  infinity: {
    name: "Infinity",
    stages: [
      { stage: 1, direction: "NE", turn: "curve-right", distancePct: 25, description: "Top half of the right loop" },
      { stage: 2, direction: "SW", turn: "curve-left",  distancePct: 25, description: "Bottom half of the right loop, crossing over center" },
      { stage: 3, direction: "NW", turn: "curve-right", distancePct: 25, description: "Top half of the left loop" },
      { stage: 4, direction: "SE", turn: "close-loop",  distancePct: 25, description: "Bottom half of the left loop, crossing back to start" }
    ]
  },
  lightning: {
    name: "Lightning",
    stages: [
      { stage: 1, direction: "SW", turn: "sharp-left",  distancePct: 30, description: "Top diagonal stroke down-left" },
      { stage: 2, direction: "E",  turn: "sharp-right", distancePct: 20, description: "Horizontal stroke right" },
      { stage: 3, direction: "SW", turn: "sharp-left",  distancePct: 30, description: "Middle diagonal stroke down-left" },
      { stage: 4, direction: "E",  turn: "sharp-right", distancePct: 20, description: "Final horizontal stroke right" }
    ]
  },
  letter_a: {
    name: "Letter A",
    stages: [
      { stage: 1, direction: "NW", turn: "sharp-right", distancePct: 35, description: "Up-left diagonal stroke" },
      { stage: 2, direction: "SE", turn: "sharp-left",  distancePct: 35, description: "Down-right diagonal stroke" },
      { stage: 3, direction: "W",  turn: "close-loop",  distancePct: 30, description: "Crossbar from right to left" }
    ]
  },
  letter_b: {
    name: "Letter B",
    stages: [
      { stage: 1, direction: "S",  turn: "sharp-left",  distancePct: 30, description: "Straight vertical stroke down" },
      { stage: 2, direction: "NE", turn: "curve-right", distancePct: 35, description: "Top curve bulging right" },
      { stage: 3, direction: "SW", turn: "close-loop",  distancePct: 35, description: "Bottom curve bulging right back to start" }
    ]
  },
  letter_c: {
    name: "Letter C",
    stages: [
      { stage: 1, direction: "W",  turn: "curve-left",  distancePct: 30, description: "Top curve heading left" },
      { stage: 2, direction: "S",  turn: "curve-left",  distancePct: 40, description: "Middle curve heading down" },
      { stage: 3, direction: "E",  turn: "curve-left",  distancePct: 30, description: "Bottom curve heading right" }
    ]
  },
  letter_d: {
    name: "Letter D",
    stages: [
      { stage: 1, direction: "S",  turn: "sharp-left",  distancePct: 40, description: "Straight vertical stroke down" },
      { stage: 2, direction: "NE", turn: "curve-right", distancePct: 30, description: "Top curve heading right" },
      { stage: 3, direction: "SE", turn: "curve-right", distancePct: 30, description: "Bottom curve heading right back to start" }
    ]
  },
  letter_e: {
    name: "Letter E",
    stages: [
      { stage: 1, direction: "W",  turn: "sharp-left",  distancePct: 25, description: "Top horizontal bar" },
      { stage: 2, direction: "S",  turn: "sharp-left",  distancePct: 50, description: "Vertical spine" },
      { stage: 3, direction: "E",  turn: "sharp-left",  distancePct: 25, description: "Bottom horizontal bar" }
    ]
  },
  letter_f: {
    name: "Letter F",
    stages: [
      { stage: 1, direction: "W",  turn: "sharp-left",  distancePct: 30, description: "Top horizontal bar" },
      { stage: 2, direction: "S",  turn: "sharp-left",  distancePct: 70, description: "Vertical spine" }
    ]
  },
  letter_g: {
    name: "Letter G",
    stages: [
      { stage: 1, direction: "W",  turn: "curve-left",  distancePct: 30, description: "Top curve" },
      { stage: 2, direction: "S",  turn: "curve-left",  distancePct: 40, description: "Middle curve" },
      { stage: 3, direction: "E",  turn: "sharp-left",  distancePct: 30, description: "Bottom curve and crossbar" }
    ]
  },
  letter_h: {
    name: "Letter H",
    stages: [
      { stage: 1, direction: "S",  turn: "sharp-right", distancePct: 40, description: "Left vertical bar" },
      { stage: 2, direction: "E",  turn: "sharp-left",  distancePct: 20, description: "Middle crossbar" },
      { stage: 3, direction: "N",  turn: "sharp-right", distancePct: 40, description: "Right vertical bar" }
    ]
  },
  letter_i: {
    name: "Letter I",
    stages: [
      { stage: 1, direction: "S",  turn: "straight",    distancePct: 100, description: "Single vertical stroke" }
    ]
  },
  letter_j: {
    name: "Letter J",
    stages: [
      { stage: 1, direction: "S",  turn: "curve-right", distancePct: 70, description: "Vertical stroke down" },
      { stage: 2, direction: "W",  turn: "curve-right", distancePct: 30, description: "Bottom hook" }
    ]
  },
  letter_k: {
    name: "Letter K",
    stages: [
      { stage: 1, direction: "S",  turn: "sharp-right", distancePct: 50, description: "Vertical spine" },
      { stage: 2, direction: "NE", turn: "sharp-left",  distancePct: 25, description: "Top diagonal" },
      { stage: 3, direction: "SE", turn: "sharp-left",  distancePct: 25, description: "Bottom diagonal" }
    ]
  },
  letter_l: {
    name: "Letter L",
    stages: [
      { stage: 1, direction: "S",  turn: "sharp-left",  distancePct: 70, description: "Vertical spine" },
      { stage: 2, direction: "E",  turn: "straight",    distancePct: 30, description: "Bottom horizontal bar" }
    ]
  },
  letter_m: {
    name: "Letter M",
    stages: [
      { stage: 1, direction: "N",  turn: "sharp-right", distancePct: 30, description: "Left vertical stroke up" },
      { stage: 2, direction: "SE", turn: "sharp-left",  distancePct: 20, description: "First diagonal down" },
      { stage: 3, direction: "NE", turn: "sharp-right", distancePct: 20, description: "Second diagonal up" },
      { stage: 4, direction: "S",  turn: "straight",    distancePct: 30, description: "Right vertical stroke down" }
    ]
  },
  letter_n: {
    name: "Letter N",
    stages: [
      { stage: 1, direction: "N",  turn: "sharp-right", distancePct: 40, description: "Left vertical stroke up" },
      { stage: 2, direction: "SE", turn: "sharp-left",  distancePct: 40, description: "Diagonal stroke down" },
      { stage: 3, direction: "N",  turn: "straight",    distancePct: 20, description: "Right vertical stroke up" }
    ]
  },
  letter_o: {
    name: "Letter O",
    stages: [
      { stage: 1, direction: "E",  turn: "curve-right", distancePct: 25, description: "Top right arc" },
      { stage: 2, direction: "S",  turn: "curve-right", distancePct: 25, description: "Bottom right arc" },
      { stage: 3, direction: "W",  turn: "curve-right", distancePct: 25, description: "Bottom left arc" },
      { stage: 4, direction: "N",  turn: "close-loop",  distancePct: 25, description: "Top left arc" }
    ]
  },
  letter_p: {
    name: "Letter P",
    stages: [
      { stage: 1, direction: "S",  turn: "sharp-left",  distancePct: 60, description: "Vertical spine" },
      { stage: 2, direction: "NE", turn: "curve-right", distancePct: 20, description: "Top curve" },
      { stage: 3, direction: "SE", turn: "sharp-left",  distancePct: 20, description: "Bottom curve back to spine" }
    ]
  },
  letter_q: {
    name: "Letter Q",
    stages: [
      { stage: 1, direction: "E",  turn: "curve-right", distancePct: 20, description: "Top right arc" },
      { stage: 2, direction: "S",  turn: "curve-right", distancePct: 20, description: "Bottom right arc" },
      { stage: 3, direction: "W",  turn: "curve-right", distancePct: 20, description: "Bottom left arc" },
      { stage: 4, direction: "N",  turn: "close-loop",  distancePct: 20, description: "Top left arc" },
      { stage: 5, direction: "SE", turn: "straight",    distancePct: 20, description: "Tail stroke" }
    ]
  },
  letter_r: {
    name: "Letter R",
    stages: [
      { stage: 1, direction: "S",  turn: "sharp-left",  distancePct: 50, description: "Vertical spine" },
      { stage: 2, direction: "NE", turn: "curve-right", distancePct: 20, description: "Top curve" },
      { stage: 3, direction: "SE", turn: "sharp-left",  distancePct: 30, description: "Diagonal leg" }
    ]
  },
  letter_s: {
    name: "Letter S",
    stages: [
      { stage: 1, direction: "W",  turn: "curve-left",  distancePct: 33, description: "Top curve heading left" },
      { stage: 2, direction: "E",  turn: "curve-right", distancePct: 33, description: "Middle reverse curve heading right" },
      { stage: 3, direction: "W",  turn: "close-loop",  distancePct: 34, description: "Bottom curve heading left back to start" }
    ]
  },
  letter_t: {
    name: "Letter T",
    stages: [
      { stage: 1, direction: "E",  turn: "sharp-right", distancePct: 30, description: "Top horizontal bar" },
      { stage: 2, direction: "S",  turn: "straight",    distancePct: 70, description: "Vertical spine" }
    ]
  },
  letter_u: {
    name: "Letter U",
    stages: [
      { stage: 1, direction: "S",  turn: "curve-left",  distancePct: 40, description: "Left vertical down" },
      { stage: 2, direction: "E",  turn: "curve-left",  distancePct: 20, description: "Bottom curve" },
      { stage: 3, direction: "N",  turn: "straight",    distancePct: 40, description: "Right vertical up" }
    ]
  },
  letter_v: {
    name: "Letter V",
    stages: [
      { stage: 1, direction: "SE", turn: "sharp-left",  distancePct: 50, description: "Diagonal down" },
      { stage: 2, direction: "NE", turn: "straight",    distancePct: 50, description: "Diagonal up" }
    ]
  },
  letter_w: {
    name: "Letter W",
    stages: [
      { stage: 1, direction: "S",  turn: "sharp-left",  distancePct: 30, description: "First vertical down" },
      { stage: 2, direction: "NE", turn: "sharp-right", distancePct: 20, description: "First diagonal up" },
      { stage: 3, direction: "SE", turn: "sharp-left",  distancePct: 20, description: "Second diagonal down" },
      { stage: 4, direction: "N",  turn: "straight",    distancePct: 30, description: "Second vertical up" }
    ]
  },
  letter_x: {
    name: "Letter X",
    stages: [
      { stage: 1, direction: "SE", turn: "sharp-right", distancePct: 50, description: "First diagonal" },
      { stage: 2, direction: "SW", turn: "straight",    distancePct: 50, description: "Second diagonal" }
    ]
  },
  letter_y: {
    name: "Letter Y",
    stages: [
      { stage: 1, direction: "SE", turn: "sharp-left",  distancePct: 30, description: "Top right diagonal" },
      { stage: 2, direction: "SW", turn: "sharp-right", distancePct: 30, description: "Top left diagonal" },
      { stage: 3, direction: "S",  turn: "straight",    distancePct: 40, description: "Bottom vertical tail" }
    ]
  },
  letter_z: {
    name: "Letter Z",
    stages: [
      { stage: 1, direction: "E",  turn: "sharp-right", distancePct: 30, description: "Top horizontal bar" },
      { stage: 2, direction: "SW", turn: "sharp-left",  distancePct: 40, description: "Diagonal stroke" },
      { stage: 3, direction: "E",  turn: "straight",    distancePct: 30, description: "Bottom horizontal bar" }
    ]
  },
  smiley: {
    name: "Smiley Face",
    stages: [
      { stage: 1, direction: "E",  turn: "curve-right", distancePct: 20, description: "Top-right arc of the face" },
      { stage: 2, direction: "S",  turn: "curve-right", distancePct: 20, description: "Bottom-right arc of the face" },
      { stage: 3, direction: "W",  turn: "curve-right", distancePct: 20, description: "Bottom-left arc of the face" },
      { stage: 4, direction: "N",  turn: "curve-right", distancePct: 20, description: "Top-left arc of the face" },
      { stage: 5, direction: "E",  turn: "close-loop",  distancePct: 20, description: "Closing the face circle" }
    ]
  },
  house: {
    name: "House",
    stages: [
      { stage: 1, direction: "N",  turn: "sharp-right", distancePct: 20, description: "Left wall up" },
      { stage: 2, direction: "NE", turn: "sharp-right", distancePct: 15, description: "Left roof slope up" },
      { stage: 3, direction: "SE", turn: "sharp-right", distancePct: 15, description: "Right roof slope down" },
      { stage: 4, direction: "S",  turn: "sharp-right", distancePct: 20, description: "Right wall down" },
      { stage: 5, direction: "W",  turn: "close-loop",  distancePct: 30, description: "Floor back to start" }
    ]
  },
  runner: {
    name: "Running Figure",
    stages: [
      { stage: 1, direction: "N",  turn: "curve-right", distancePct: 20, description: "Head and torso" },
      { stage: 2, direction: "E",  turn: "sharp-right", distancePct: 20, description: "Forward arm" },
      { stage: 3, direction: "S",  turn: "sharp-left",  distancePct: 30, description: "Back leg" },
      { stage: 4, direction: "NW", turn: "close-loop",  distancePct: 30, description: "Front leg back to start" }
    ]
  }
};

export function getLetterScript(char: string): RouteStage[] | null {
  const key = `letter_${char.toLowerCase()}`;
  return SHAPE_SCRIPTS[key]?.stages || null;
}

export function chainScripts(scripts: RouteStage[][]): RouteStage[] {
  let globalStage = 1;
  const chained: RouteStage[] = [];

  scripts.forEach((script, scriptIdx) => {
    script.forEach((stage, stageIdx) => {
      chained.push({
        ...stage,
        stage: globalStage++
      });
    });

    // Add a linking stage between letters if not the last one
    if (scriptIdx < scripts.length - 1) {
      chained.push({
        stage: globalStage++,
        direction: "E",
        turn: "straight",
        distancePct: 5, // Small gap
        description: "Linking to next letter"
      });
    }
  });

  // Normalize distancePct
  const totalPct = chained.reduce((sum, s) => sum + s.distancePct, 0);
  return chained.map(s => ({
    ...s,
    distancePct: (s.distancePct / totalPct) * 100
  }));
}

export function generateScriptFromPath(path: Point[]): RouteStage[] {
  if (path.length < 2) return [];
  
  const stages: RouteStage[] = [];
  let currentStagePoints: Point[] = [path[0]];
  let lastBearing = -1;

  for (let i = 1; i < path.length; i++) {
    const p1 = path[i - 1];
    const p2 = path[i];
    
    // Calculate bearing
    const dy = p2.lat - p1.lat;
    const dx = Math.cos(Math.PI/180 * p1.lat) * (p2.lng - p1.lng);
    const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;

    if (lastBearing === -1) {
      lastBearing = bearing;
    }

    const diff = Math.abs(bearing - lastBearing);
    const normalizedDiff = diff > 180 ? 360 - diff : diff;

    // If direction changes significantly or it's the last point
    if (normalizedDiff > 45 || i === path.length - 1) {
      if (i === path.length - 1) currentStagePoints.push(p2);

      const direction = getCompassDirection(lastBearing);
      
      // Calculate distance of this stage
      let stageDist = 0;
      for (let j = 1; j < currentStagePoints.length; j++) {
        stageDist += turf.distance(
          turf.point([currentStagePoints[j-1].lng, currentStagePoints[j-1].lat]),
          turf.point([currentStagePoints[j].lng, currentStagePoints[j].lat])
        );
      }

      stages.push({
        stage: stages.length + 1,
        direction,
        turn: normalizedDiff > 90 ? "sharp-right" : (normalizedDiff > 30 ? "curve-right" : "straight"),
        distancePct: stageDist, // temporary
        description: `Move ${direction}`
      });

      currentStagePoints = [p2];
      lastBearing = bearing;
    } else {
      currentStagePoints.push(p2);
    }
  }

  // Normalize distances to percentages
  const totalDist = stages.reduce((sum, s) => sum + s.distancePct, 0);
  return stages.map(s => ({
    ...s,
    distancePct: totalDist > 0 ? (s.distancePct / totalDist) * 100 : 100 / stages.length
  }));
}

function getCompassDirection(bearing: number): string {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
}
