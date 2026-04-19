import * as turf from "@turf/turf";
import { Point, NormalizedPoint, rotateShape, scaleShape, projectShapeToLatLng } from "../lib/shapeMath";

export function calculateGeodesicBearing(pointA: Point, pointB: Point): number {
  const lat1 = pointA.lat * Math.PI / 180;
  const lon1 = pointA.lng * Math.PI / 180;
  const lat2 = pointB.lat * Math.PI / 180;
  const lon2 = pointB.lng * Math.PI / 180;

  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const brng = Math.atan2(y, x);
  return ((brng * 180 / Math.PI) + 360) % 360;
}

export function closestPointOnSegment(point: Point, segStart: Point, segEnd: Point): Point {
  if (typeof point.lat !== 'number' || typeof point.lng !== 'number' || isNaN(point.lat) || isNaN(point.lng) ||
      typeof segStart.lat !== 'number' || typeof segStart.lng !== 'number' || isNaN(segStart.lat) || isNaN(segStart.lng) ||
      typeof segEnd.lat !== 'number' || typeof segEnd.lng !== 'number' || isNaN(segEnd.lat) || isNaN(segEnd.lng)) {
    return point;
  }
  const p = turf.point([point.lng, point.lat]);
  const line = turf.lineString([[segStart.lng, segStart.lat], [segEnd.lng, segEnd.lat]]);
  const snapped = turf.nearestPointOnLine(line, p);
  return {
    lat: snapped.geometry.coordinates[1],
    lng: snapped.geometry.coordinates[0]
  };
}

export function scoreShapeAgainstRoadNetwork(
  projectedShapePoints: Point[], 
  osmNodes: Map<string, any>, 
  osmEdges: Map<string, string[]>
): number {
  const shapeSegments = [];
  for (let i = 0; i < projectedShapePoints.length - 1; i++) {
    const start = projectedShapePoints[i];
    const end = projectedShapePoints[i + 1];
    shapeSegments.push({
      start,
      end,
      bearing: calculateGeodesicBearing(start, end),
      lengthM: (typeof start.lat === 'number' && typeof start.lng === 'number' && typeof end.lat === 'number' && typeof end.lng === 'number' && !isNaN(start.lat) && !isNaN(start.lng) && !isNaN(end.lat) && !isNaN(end.lng)) 
        ? turf.distance(
            turf.point([start.lng, start.lat]),
            turf.point([end.lng, end.lat]),
            { units: 'meters' }
          )
        : 0
    });
  }

  let totalScore = 0;

  for (const segment of shapeSegments) {
    let bestRoadCoverage = 0;
    const segmentMidpoint = {
      lat: (segment.start.lat + segment.end.lat) / 2,
      lng: (segment.start.lng + segment.end.lng) / 2
    };

    // Optimization: only check edges near the segment
    for (const [nodeIdA, connectedIds] of osmEdges.entries()) {
      const nodeA = osmNodes.get(nodeIdA);
      if (!nodeA) continue;

      for (const nodeIdB of connectedIds) {
        const nodeB = osmNodes.get(nodeIdB);
        if (!nodeB) continue;

        const edgeBearing = calculateGeodesicBearing(nodeA, nodeB);
        const bearingDiff = Math.abs(((edgeBearing - segment.bearing) + 180) % 360 - 180);
        
        if (bearingDiff > 45) continue;

        const bearingScore = 1 - (bearingDiff / 45);
        const closestPoint = closestPointOnSegment(segmentMidpoint, nodeA, nodeB);
        const distanceM = turf.distance(
          turf.point([segmentMidpoint.lng, segmentMidpoint.lat]),
          turf.point([closestPoint.lng, closestPoint.lat]),
          { units: 'meters' }
        );

        if (distanceM > 100) continue;

        const proximityScore = 1 - (distanceM / 100);
        const combinedScore = bearingScore * 0.5 + proximityScore * 0.5;
        bestRoadCoverage = Math.max(bestRoadCoverage, combinedScore);
      }
    }
    totalScore += bestRoadCoverage * segment.lengthM;
  }

  const totalShapeLength = shapeSegments.reduce((sum, s) => sum + s.lengthM, 0);
  return totalShapeLength > 0 ? (totalScore / totalShapeLength) * 100 : 0;
}

export async function findBestOrientation(
  normalizedPoints: NormalizedPoint[], 
  centerLat: number, 
  centerLng: number, 
  targetDistanceKm: number, 
  osmNodes: Map<string, any>, 
  osmEdges: Map<string, string[]>, 
  inputType: string
) {
  const rotations = inputType === 'text' ? [0] : [0, 30, 60, 90, 120, 150];
  const scales = inputType === 'text' ? [1.0] : [0.9, 1.0, 1.1];

  const radiusKm = (targetDistanceKm / (2 * Math.PI)) * 1.5;

  let bestScore = -1;
  let bestConfig: any = { rotation: 0, scale: 1.0, score: 0 };
  const allResults = [];

  for (const rotation of rotations) {
    for (const scale of scales) {
      const rotated = rotateShape(normalizedPoints, rotation);
      const scaled = scaleShape(rotated, scale);
      const projected = projectShapeToLatLng(scaled, centerLat, centerLng, radiusKm * scale);
      const score = scoreShapeAgainstRoadNetwork(projected, osmNodes, osmEdges);

      allResults.push({ rotation, scale, score });

      if (score > bestScore) {
        bestScore = score;
        bestConfig = { rotation, scale, score, projectedPoints: projected };
      }
    }
  }

  allResults.sort((a, b) => b.score - a.score);

  return {
    bestConfig,
    allResults,
    improvementFromDefault: bestScore - (allResults.find(r => r.rotation === 0 && r.scale === 1.0)?.score || 0)
  };
}
