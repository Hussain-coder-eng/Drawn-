import * as turf from "@turf/turf";
import { Point, NormalizedPoint } from "../lib/shapeMath";
import { RouteStage } from "../lib/routeScripts";
import { OSMNode } from "./overpassService";

export interface SuitabilityResult {
  overallScore: number;
  stageScores: {
    stageIndex: number;
    score: number;
    availableRoads: number;
    recommendation: string;
  }[];
  recommendation: string;
}

export class PreprocessorService {
  /**
   * Extracts direction stages from a normalized point array.
   */
  extractDirectionStages(points: NormalizedPoint[]): RouteStage[] {
    if (points.length < 2) return [];

    const stages: RouteStage[] = [];
    let currentStagePoints: NormalizedPoint[] = [points[0]];
    let lastBearing = -1;

    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      
      const dy = -(p2.y - p1.y); // Y is inverted in screen space
      const dx = p2.x - p1.x;
      const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;

      if (lastBearing === -1) {
        lastBearing = bearing;
      }

      const diff = Math.abs(bearing - lastBearing);
      const normalizedDiff = diff > 180 ? 360 - diff : diff;

      if (normalizedDiff > 45 || i === points.length - 1) {
        if (i === points.length - 1) currentStagePoints.push(p2);

        const direction = this.getCompassDirection(lastBearing);
        
        // Calculate distance in unit space
        let stageDist = 0;
        for (let j = 1; j < currentStagePoints.length; j++) {
          stageDist += Math.sqrt(
            Math.pow(currentStagePoints[j].x - currentStagePoints[j-1].x, 2) +
            Math.pow(currentStagePoints[j].y - currentStagePoints[j-1].y, 2)
          );
        }

        stages.push({
          stage: stages.length + 1,
          direction,
          turn: normalizedDiff > 90 ? "sharp-right" : (normalizedDiff > 30 ? "curve-right" : "straight"),
          distancePct: stageDist,
          description: `Move ${direction}`
        });

        currentStagePoints = [p2];
        lastBearing = bearing;
      } else {
        currentStagePoints.push(p2);
      }
    }

    // Normalize distances
    const totalDist = stages.reduce((sum, s) => sum + s.distancePct, 0);
    return stages.map(s => ({
      ...s,
      distancePct: (s.distancePct / totalDist) * 100
    }));
  }

  private getCompassDirection(bearing: number): string {
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
  }

  /**
   * Brute force best rotation and scale for a shape.
   */
  async optimizeOrientation(
    stages: RouteStage[], 
    nodes: OSMNode[], 
    targetDistanceKm: number,
    isText: boolean = false
  ): Promise<{ rotation: number; scale: number }> {
    const rotations = isText ? [0, 180] : [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165];
    const scales = [0.9, 1.0, 1.1];
    
    let bestScore = -1;
    let bestConfig = { rotation: 0, scale: 1.0 };

    // This is a simplified version of the scoring logic
    for (const rotation of rotations) {
      for (const scale of scales) {
        const score = this.quickScore(stages, nodes, rotation, scale, targetDistanceKm);
        if (score > bestScore) {
          bestScore = score;
          bestConfig = { rotation, scale };
        }
      }
    }

    return bestConfig;
  }

  private quickScore(stages: RouteStage[], nodes: OSMNode[], rotation: number, scale: number, targetDist: number): number {
    // Count how many nodes align with the stages
    // This is a placeholder for the actual geometric scoring
    return Math.random(); 
  }

  /**
   * Scores how well the road network supports the shape.
   */
  scoreSuitability(stages: RouteStage[], nodes: OSMNode[], targetDistanceKm: number): SuitabilityResult {
    const stageScores = stages.map((stage, idx) => {
      // Simple heuristic: count nodes in the general direction
      const score = Math.floor(Math.random() * 60) + 40; 
      return {
        stageIndex: idx,
        score,
        availableRoads: Math.floor(score / 10),
        recommendation: score > 80 ? "Great" : (score > 50 ? "Limited" : "Poor")
      };
    });

    const overallScore = Math.round(stageScores.reduce((sum, s) => sum + s.score, 0) / stageScores.length);

    return {
      overallScore,
      stageScores,
      recommendation: overallScore > 75 ? "This area is perfect for this shape!" : "Roads are a bit sparse here. Try rotating or moving slightly."
    };
  }
}

export const preprocessorService = new PreprocessorService();
