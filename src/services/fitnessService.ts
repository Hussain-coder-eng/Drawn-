import * as turf from "@turf/turf";
import { Point } from "../lib/shapeMath";
import { RouteStage } from "../lib/routeScripts";

export interface StageScore {
  stageNumber: number;
  directionScore: number;
  distanceScore: number;
  progressionScore: number;
  overallStageScore: number;
  feedback: string;
}

export interface RouteFitness {
  overallFitness: number;
  stageScores: StageScore[];
  failingStages: StageScore[];
  passed: boolean;
}

const DIRECTION_MAP: Record<string, number> = {
  "N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315
};

export class FitnessService {
  scoreFitness(
    finalPolyline: Point[],
    inputType: 'premade' | 'text' | 'draw',
    originalIdealPoints: Point[],
    script: RouteStage[],
    nodeMap: Map<string, any>,
    totalTargetDistanceKm: number
  ): RouteFitness {
    // 1. Calculate base stage scores
    const baseResult = this.scoreRoute(
      this.extractStagesFromPolyline(finalPolyline, script, nodeMap), 
      script, 
      nodeMap, 
      totalTargetDistanceKm
    );

    // 2. Calculate input-specific shape fidelity
    let fidelityScore = 0;
    if (inputType === 'premade') {
      fidelityScore = this.calculateFrechetFidelity(originalIdealPoints, finalPolyline);
    } else if (inputType === 'draw') {
      fidelityScore = this.calculateDTWFidelity(originalIdealPoints, finalPolyline);
    } else {
      fidelityScore = baseResult.overallFitness; 
    }

    const overallFitness = Math.round((baseResult.overallFitness * 0.6) + (fidelityScore * 0.4));

    return {
      ...baseResult,
      overallFitness,
      passed: overallFitness >= 90
    };
  }

  scoreRoute(
    geminiStages: { stageNumber: number; nodeIds: any[] }[],
    script: RouteStage[],
    nodeMap: Map<string, any>,
    totalTargetDistanceKm: number
  ): RouteFitness {
    const stageScores = geminiStages.map((stage, i) => {
      const scriptStage = script[i];
      if (!scriptStage) {
        return {
          stageNumber: stage.stageNumber,
          directionScore: 0,
          distanceScore: 0,
          progressionScore: 0,
          overallStageScore: 0,
          feedback: "Extra stage returned by AI."
        };
      }
      const stageNodes = (stage.nodeIds || [])
        .map(id => nodeMap.get(id))
        .filter((n): n is { lat: number; lng: number } => !!n);

      if (stageNodes.length < 2) {
        return {
          stageNumber: stage.stageNumber,
          directionScore: 0,
          distanceScore: 0,
          progressionScore: 0,
          overallStageScore: 0,
          feedback: "Not enough nodes in this stage."
        };
      }

      const targetDist = (scriptStage.distancePct / 100) * totalTargetDistanceKm;
      
      const dScore = this.calculateDirectionScore(stageNodes, scriptStage.direction);
      const distScore = this.calculateDistanceScore(stageNodes, targetDist);
      const pScore = this.calculateProgressionScore(stageNodes, scriptStage.direction);

      const overall = (dScore * 0.5) + (distScore * 0.3) + (pScore * 0.2);

      return {
        stageNumber: stage.stageNumber,
        directionScore: dScore,
        distanceScore: distScore,
        progressionScore: pScore,
        overallStageScore: Math.round(overall),
        feedback: this.generateStageFeedback(
          { directionScore: dScore, distanceScore: distScore, progressionScore: pScore, stageNumber: stage.stageNumber, overallStageScore: overall, feedback: "" },
          scriptStage,
          targetDist
        )
      };
    });

    const overallFitness = Math.round(
      stageScores.reduce((sum, s) => sum + s.overallStageScore, 0) / stageScores.length
    );

    return {
      overallFitness,
      stageScores,
      failingStages: stageScores.filter(s => s.overallStageScore < 75),
      passed: overallFitness >= 90
    };
  }

  private extractStagesFromPolyline(polyline: Point[], script: RouteStage[], nodeMap: Map<string, any>): { stageNumber: number; nodeIds: any[] }[] {
    // This is a helper to convert the final polyline back into stages for base scoring
    // In a real app, we'd track which polyline segments belong to which stage
    return script.map((s, i) => ({
      stageNumber: s.stage,
      nodeIds: [] // Placeholder
    }));
  }

  /**
   * Simplified Frechet distance for shape comparison.
   */
  private calculateFrechetFidelity(ideal: Point[], actual: Point[]): number {
    if (ideal.length < 2 || actual.length < 2) return 0;
    
    // Measure max deviation
    let maxDev = 0;
    ideal.forEach(p1 => {
      if (typeof p1.lat !== 'number' || typeof p1.lng !== 'number' || isNaN(p1.lat) || isNaN(p1.lng)) return;
      let minDist = Infinity;
      actual.forEach(p2 => {
        if (typeof p2.lat !== 'number' || typeof p2.lng !== 'number' || isNaN(p2.lat) || isNaN(p2.lng)) return;
        const d = turf.distance(turf.point([p1.lng, p1.lat]), turf.point([p2.lng, p2.lat]));
        if (d < minDist) minDist = d;
      });
      if (minDist > maxDev) maxDev = minDist;
    });

    const score = Math.max(0, 100 - (maxDev * 500)); // 200m deviation = 0 score
    return Math.round(score);
  }

  /**
   * Simplified Dynamic Time Warping for drawing comparison.
   */
  private calculateDTWFidelity(ideal: Point[], actual: Point[]): number {
    // For now, use the same logic as Frechet but more lenient
    return this.calculateFrechetFidelity(ideal, actual);
  }

  private calculateDirectionScore(nodes: Point[], targetDir: string): number {
    const n1 = nodes[0];
    const n2 = nodes[nodes.length - 1];
    if (typeof n1.lat !== 'number' || typeof n1.lng !== 'number' || isNaN(n1.lat) || isNaN(n1.lng) ||
        typeof n2.lat !== 'number' || typeof n2.lng !== 'number' || isNaN(n2.lat) || isNaN(n2.lng)) {
      return 0;
    }
    const start = turf.point([n1.lng, n1.lat]);
    const end = turf.point([n2.lng, n2.lat]);
    const actualBearing = (turf.bearing(start, end) + 360) % 360;
    const targetBearing = DIRECTION_MAP[targetDir] || 0;

    const diff = Math.abs(actualBearing - targetBearing);
    const normalizedDiff = diff > 180 ? 360 - diff : diff;

    if (normalizedDiff <= 15) return 100;
    if (normalizedDiff >= 60) return 0;
    return Math.round(100 * (1 - (normalizedDiff - 15) / 45));
  }

  private calculateDistanceScore(nodes: Point[], targetDistKm: number): number {
    const validNodes = nodes.filter(n => typeof n.lat === 'number' && typeof n.lng === 'number' && !isNaN(n.lat) && !isNaN(n.lng));
    if (validNodes.length < 2) return 0;
    const line = turf.lineString(validNodes.map(n => [n.lng, n.lat]));
    const actualDist = turf.length(line, { units: "kilometers" });

    const ratio = Math.min(actualDist, targetDistKm) / Math.max(actualDist, targetDistKm);
    
    if (ratio >= 0.95) return 100;
    if (ratio <= 0.7) return 0;
    return Math.round(100 * (ratio - 0.7) / 0.25);
  }

  private calculateProgressionScore(nodes: Point[], targetDir: string): number {
    const targetBearing = DIRECTION_MAP[targetDir] || 0;
    const rad = (targetBearing * Math.PI) / 180;
    const dirVec = [Math.sin(rad), Math.cos(rad)];

    let forwardMoves = 0;
    for (let i = 1; i < nodes.length; i++) {
      const p1 = nodes[i - 1];
      const p2 = nodes[i];
      const moveVec = [p2.lng - p1.lng, p2.lat - p1.lat];
      
      // Dot product to see if moving in general direction
      const dot = moveVec[0] * dirVec[0] + moveVec[1] * dirVec[1];
      if (dot > 0) forwardMoves++;
    }

    const ratio = forwardMoves / (nodes.length - 1);
    if (ratio >= 0.8) return 100;
    return Math.round(ratio * 100);
  }

  private generateStageFeedback(score: StageScore, scriptStage: RouteStage, targetDist: number): string {
    let feedback = "";
    if (score.directionScore < 70) {
      feedback += `Route traveled in the wrong direction (needed ${scriptStage.direction}). `;
    }
    if (score.distanceScore < 70) {
      feedback += `Stage distance was off (needed ~${targetDist.toFixed(2)}km). `;
    }
    if (score.progressionScore < 70) {
      feedback += "Route backtracked too much. ";
    }
    return feedback || "Stage looks good!";
  }
}
