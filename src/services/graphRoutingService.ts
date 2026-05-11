import * as turf from "@turf/turf";
import { Point } from "../lib/shapeMath";
import { OSMNode } from "./overpassService";
import { RoutingService } from "./routingService";
import { findNearestGraphNode, aStarSegment, AStarOptions } from "./graphService";

export async function graphRouteShape(
  snappedWaypoints: Point[],
  idealPath: Point[],
  nodeMap: Map<string, OSMNode>,
  edgeMap: Map<string, string[]>,
  routingService: Pick<RoutingService, "routeWithLockedWaypoints">,
  options?: AStarOptions
): Promise<{ polylineCoords: [number, number][] }> {
  if (snappedWaypoints.length < 2) {
    return routingService.routeWithLockedWaypoints(snappedWaypoints);
  }

  const idealLine = turf.lineString(idealPath.map(p => [p.lng, p.lat]));
  const totalIdealKm = turf.length(idealLine, { units: "kilometers" });
  const M = snappedWaypoints.length;
  const allCoords: [number, number][] = [];

  for (let i = 0; i < M - 1; i++) {
    const A = snappedWaypoints[i];
    const B = snappedWaypoints[i + 1];

    const fracA = i / (M - 1);
    const fracB = (i + 1) / (M - 1);
    const kmA = fracA * totalIdealKm;
    const kmB = fracB * totalIdealKm;

    // Extract ideal sub-path using turf.lineSliceAlong (same pattern as routingService.ts:566)
    let idealSubPath: Point[] = [A, B];
    try {
      const sliced = turf.lineSliceAlong(idealLine, kmA, kmB);
      idealSubPath = sliced.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
    } catch {
      // lineSliceAlong throws on degenerate segments — [A,B] fallback is fine
    }

    const startId = findNearestGraphNode(A, nodeMap);
    const goalId = findNearestGraphNode(B, nodeMap);

    let segmentCoords: [number, number][] | null = null;

    if (startId && goalId) {
      const path = aStarSegment(startId, goalId, nodeMap, edgeMap, idealSubPath, options);
      if (path) {
        segmentCoords = path.map(node => [node.lng, node.lat]);
      }
    }

    if (!segmentCoords) {
      console.warn(`graphRouteShape: A* returned null for segment ${i}→${i + 1}, OSRM fallback`);
      const fallback = await routingService.routeWithLockedWaypoints([A, B]);
      segmentCoords = fallback.polylineCoords;
    }

    if (i === 0) {
      allCoords.push(...segmentCoords);
    } else {
      // Skip first coord of each subsequent segment to avoid duplicate junction
      allCoords.push(...segmentCoords.slice(1));
    }
  }

  return { polylineCoords: allCoords };
}
