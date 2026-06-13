import { NormalizedPoint } from "./shapeMath";

export interface Stage {
  stageIndex: number;
  bearingDeg: number;
  compassLabel: string;
  turnType: string;
  startPoint: NormalizedPoint;
  endPoint: NormalizedPoint;
  distancePct: number;
  targetDistanceKm: number;
}

export function bearingToCompass(degrees: number): string {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

export function classifyTurn(angleDelta: number): string {
  const normalizedDelta = ((angleDelta + 180) % 360) - 180;
  if (Math.abs(normalizedDelta) < 20) return "straight";
  if (normalizedDelta > 135 || normalizedDelta < -135) return "u-turn";
  if (normalizedDelta > 60) return "sharp-right";
  if (normalizedDelta > 20) return "curve-right";
  if (normalizedDelta < -60) return "sharp-left";
  if (normalizedDelta < -20) return "curve-left";
  return "straight";
}

export function calculateBearing(pointA: NormalizedPoint, pointB: NormalizedPoint): number {
  const dx = pointB.x - pointA.x;
  const dy = -(pointB.y - pointA.y); // Invert Y because screen coords vs geo coords
  const bearingRad = Math.atan2(dx, dy);
  const bearingDeg = ((bearingRad * 180 / Math.PI) + 360) % 360;
  return bearingDeg;
}

export function buildStageScript(simplifiedPoints: NormalizedPoint[], totalDistanceKm: number): Stage[] {
  const stages: Stage[] = [];

  for (let i = 0; i < simplifiedPoints.length - 1; i++) {
    const start = simplifiedPoints[i];
    const end = simplifiedPoints[i + 1];

    const bearingDeg = calculateBearing(start, end);
    const compassLabel = bearingToCompass(bearingDeg);

    const nextBearing = i < simplifiedPoints.length - 2
      ? calculateBearing(simplifiedPoints[i+1], simplifiedPoints[i+2])
      : bearingDeg;
    const turnAngle = nextBearing - bearingDeg;
    const turnType = classifyTurn(turnAngle);

    stages.push({
      stageIndex: i,
      bearingDeg,
      compassLabel,
      turnType,
      startPoint: start,
      endPoint: end,
      distancePct: 0,
      targetDistanceKm: 0
    });
  }

  const totalLength = stages.reduce((sum, s) => {
    const dx = s.endPoint.x - s.startPoint.x;
    const dy = s.endPoint.y - s.startPoint.y;
    return sum + Math.sqrt(dx * dx + dy * dy);
  }, 0);

  return stages.map(s => {
    const dx = s.endPoint.x - s.startPoint.x;
    const dy = s.endPoint.y - s.startPoint.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    return {
      ...s,
      distancePct: Math.round((len / (totalLength || 1)) * 100),
      targetDistanceKm: (len / (totalLength || 1)) * totalDistanceKm
    };
  });
}
