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

  const SAMPLE_COUNT = 20;
  const COVERAGE_RADIUS_M = 100;
  const idealLine = turf.lineString(projectedPoints.map(p => [p.lng, p.lat]));
  const lengthKm = turf.length(idealLine, { units: 'kilometers' });

  const samples: Point[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const frac = i / (SAMPLE_COUNT - 1);
    try {
      const pt = turf.along(idealLine, frac * lengthKm, { units: 'kilometers' });
      samples.push({ lat: pt.geometry.coordinates[1], lng: pt.geometry.coordinates[0] });
    } catch {
      // along() can throw at exact endpoints on degenerate lines — skip
    }
  }

  if (samples.length > 0) {
    let covered = 0;
    for (const s of samples) {
      for (const n of network.nodes) {
        const d = turf.distance(
          turf.point([s.lng, s.lat]),
          turf.point([n.lng, n.lat]),
          { units: 'meters' }
        );
        if (d <= COVERAGE_RADIUS_M) { covered++; break; }
      }
    }

    const coverage = covered / samples.length;
    if (coverage < 0.7) {
      throw new FeasibilityError(
        `This shape doesn't fit the available roads here ` +
        `(only ${Math.round(coverage * 100)}% of the shape has nearby roads). ` +
        `Try a smaller distance, a different location, or a simpler shape.`
      );
    }
  }
}
