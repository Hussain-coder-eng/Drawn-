import * as turf from "@turf/turf";
import { Point } from "../lib/shapeMath";
import { RoadNetwork } from "./overpassService";

const MIN_NODES_PER_KM = 3;

export class FeasibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeasibilityError";
  }
}

export function checkFeasibility(network: RoadNetwork, projectedPoints: Point[]): void {
  if (projectedPoints.length < 2) return;

  const line = turf.lineString(projectedPoints.map(p => [p.lng, p.lat]));
  const perimeterKm = turf.length(line, { units: 'kilometers' });

  if (perimeterKm < 0.1) return;

  const nodesPerKm = network.nodes.length / perimeterKm;

  if (nodesPerKm < MIN_NODES_PER_KM) {
    throw new FeasibilityError(
      `Not enough roads to draw this shape here ` +
      `(${(Math.round(nodesPerKm * 10) / 10)} road nodes/km, need at least ${MIN_NODES_PER_KM}). ` +
      `Try a smaller distance, a different location, or a simpler shape.`
    );
  }
}
