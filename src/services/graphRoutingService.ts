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
  if (snappedWaypoints.length < 2 || idealPath.length < 2) {
    return routingService.routeWithLockedWaypoints(snappedWaypoints);
  }

  const idealLine = turf.lineString(idealPath.map(p => [p.lng, p.lat]));
  const totalIdealKm = turf.length(idealLine, { units: "kilometers" });
  if (totalIdealKm === 0) {
    return routingService.routeWithLockedWaypoints(snappedWaypoints);
  }
  const M = snappedWaypoints.length;
  const allCoords: [number, number][] = [];

  for (let i = 0; i < M - 1; i++) {
    const A = snappedWaypoints[i];
    const B = snappedWaypoints[i + 1];

    // Project snapped waypoints onto ideal line for accurate sub-path bounds
    // (same nearestPointOnLine pattern used at routingService.ts:556)
    const projA = turf.nearestPointOnLine(idealLine, turf.point([A.lng, A.lat]));
    const projB = turf.nearestPointOnLine(idealLine, turf.point([B.lng, B.lat]));
    const kmA = projA.properties.location ?? 0;
    const kmB = projB.properties.location ?? 0;

    // Extract ideal sub-path using turf.lineSliceAlong (same pattern as routingService.ts:566)
    let idealSubPath: Point[] = [A, B];
    try {
      const sliced = turf.lineSliceAlong(idealLine, Math.min(kmA, kmB), Math.max(kmA, kmB));
      idealSubPath = sliced.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
    } catch {
      // lineSliceAlong throws on degenerate segments — [A,B] fallback is fine
    }

    // Use ideal sub-path endpoints for graph lookup (avoids snap-to-road-midpoint mismatch)
    const lookupA = idealSubPath.length >= 2 ? idealSubPath[0] : A;
    const lookupB = idealSubPath.length >= 2 ? idealSubPath[idealSubPath.length - 1] : B;
    const startId = findNearestGraphNode(lookupA, nodeMap);
    const goalId = findNearestGraphNode(lookupB, nodeMap);

    let segmentCoords: [number, number][] | null = null;

    if (startId && goalId) {
      const path = aStarSegment(startId, goalId, nodeMap, edgeMap, idealSubPath, options);
      if (path) {
        segmentCoords = path.map(node => [node.lng, node.lat]);
      }
    }

    if (!segmentCoords) {
      console.warn(`graphRouteShape: A* returned null for segment ${i}→${i + 1}, OSRM fallback`);
      try {
        const fallback = await routingService.routeWithLockedWaypoints([A, B]);
        segmentCoords = fallback.polylineCoords.length > 0
          ? fallback.polylineCoords
          : [[A.lng, A.lat], [B.lng, B.lat]];
      } catch {
        console.warn(`graphRouteShape: OSRM fallback also failed for segment ${i}→${i + 1}, straight-line`);
        segmentCoords = [[A.lng, A.lat], [B.lng, B.lat]];
      }
    }

    if (segmentCoords.length === 0) continue;

    if (i === 0) {
      allCoords.push(...segmentCoords);
    } else {
      // Skip first coord of each subsequent segment to avoid duplicate junction
      allCoords.push(...segmentCoords.slice(1));
    }
  }

  return { polylineCoords: allCoords };
}
