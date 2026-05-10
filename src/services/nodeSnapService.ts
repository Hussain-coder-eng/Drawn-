import * as turf from "@turf/turf";
import { Point } from "../lib/shapeMath";
import { RoutingService } from "./routingService";

const SNAP_BATCH_SIZE = 8;
const MIN_WAYPOINTS = 4;

/**
 * Converts a dense ideal-path polyline into a sparse list of on-road waypoints
 * suitable for passing directly to routeWithLockedWaypoints().
 *
 * Algorithm:
 *   1. Sample targetWaypoints positions by arc length (not by index)
 *   2. Snap each sample to the nearest road surface via OSRM /nearest
 *      (batched in groups of 8 to avoid rate-limiting public mirrors)
 *   3. Deduplicate consecutive identical snapped points
 *   4. Direction-filter: remove waypoints that would make OSRM backtrack >130°
 *   5. Close the loop if first ≠ last and gap > 50m
 *   6. Fallback: if fewer than 4 remain, return the unfiltered deduped list
 */
export async function snapIdealPathToRoads(
  idealPath: Point[],
  routingService: RoutingService,
  targetWaypoints = 30,
  forcedAnchor?: Point
): Promise<Point[]> {
  if (idealPath.length < 2) return idealPath;

  // Forced-anchor path: start and end at a specific on-road point
  if (forcedAnchor) {
    const rotated = rotateToNearest(idealPath, forcedAnchor);
    const innerPath = rotated.slice(1, rotated.length - 1);
    if (innerPath.length < 2) return [forcedAnchor, forcedAnchor];

    const innerLine = turf.lineString(innerPath.map(p => [p.lng, p.lat]));
    const innerKm = turf.length(innerLine, { units: 'kilometers' });
    const middleCount = Math.max(2, targetWaypoints - 2);
    const middleSamples: Point[] = [];

    for (let i = 0; i < middleCount; i++) {
      const frac = i / (middleCount - 1);
      try {
        const pt = turf.along(innerLine, frac * innerKm, { units: 'kilometers' });
        middleSamples.push({ lat: pt.geometry.coordinates[1], lng: pt.geometry.coordinates[0] });
      } catch {
        middleSamples.push(innerPath[innerPath.length - 1]);
      }
    }

    const middleSnapped: Point[] = [];
    for (let i = 0; i < middleSamples.length; i += SNAP_BATCH_SIZE) {
      const batch = middleSamples.slice(i, i + SNAP_BATCH_SIZE);
      middleSnapped.push(...await routingService.batchSnap(batch));
      if (i + SNAP_BATCH_SIZE < middleSamples.length) {
        await new Promise<void>(r => setTimeout(r, 100));
      }
    }

    const assembled = [forcedAnchor, ...middleSnapped, forcedAnchor];

    const deduped: Point[] = [];
    for (const pt of assembled) {
      const prev = deduped[deduped.length - 1];
      if (!prev || prev.lat !== pt.lat || prev.lng !== pt.lng) deduped.push(pt);
    }

    const filtered = applyDirectionFilter(
      deduped,
      [forcedAnchor, ...middleSamples, forcedAnchor]
    );
    return filtered.length >= MIN_WAYPOINTS ? filtered : deduped;
  }

  // Step 1: sparse arc-length sampling
  const line = turf.lineString(idealPath.map(p => [p.lng, p.lat]));
  const totalKm = turf.length(line, { units: "kilometers" });
  const samples: Point[] = [];
  for (let i = 0; i < targetWaypoints; i++) {
    const frac = i / (targetWaypoints - 1);
    const km = frac * totalKm;
    try {
      const pt = turf.along(line, km, { units: "kilometers" });
      samples.push({ lat: pt.geometry.coordinates[1], lng: pt.geometry.coordinates[0] });
    } catch {
      samples.push(idealPath[idealPath.length - 1]);
    }
  }

  // Step 2: batch snap (micro-batches to avoid 429s on public OSRM mirrors)
  const snapped: Point[] = [];
  for (let i = 0; i < samples.length; i += SNAP_BATCH_SIZE) {
    const batch = samples.slice(i, i + SNAP_BATCH_SIZE);
    const result = await routingService.batchSnap(batch);
    snapped.push(...result);
    if (i + SNAP_BATCH_SIZE < samples.length) {
      await new Promise<void>(r => setTimeout(r, 100));
    }
  }

  // Step 3: deduplicate consecutive identical points
  const deduped: Point[] = [];
  for (const pt of snapped) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.lat !== pt.lat || prev.lng !== pt.lng) {
      deduped.push(pt);
    }
  }

  // Step 4: direction filter
  const filtered = applyDirectionFilter(deduped, samples);

  // Step 5: closed-loop close
  const result = closeLoop(filtered);

  // Step 6: fallback if too many points removed
  if (result.length < MIN_WAYPOINTS) {
    return deduped.length >= 2 ? closeLoop(deduped) : closeLoop(snapped);
  }

  return result;
}

/**
 * Removes waypoints where the snapped bearing deviates >130° from the ideal bearing.
 * This prevents OSRM from routing backwards to visit an off-direction snap.
 */
function applyDirectionFilter(waypoints: Point[], idealSamples: Point[]): Point[] {
  if (waypoints.length < 3) return waypoints;

  const result: Point[] = [waypoints[0]];

  for (let i = 1; i < waypoints.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = waypoints[i];

    // Ideal bearing at position i: from ideal[i-1] to ideal[i+1]
    const iSafe = Math.min(i, idealSamples.length - 1);
    const idealPrev = idealSamples[Math.max(0, iSafe - 1)];
    const idealNext = idealSamples[Math.min(idealSamples.length - 1, iSafe + 1)];

    const idealBearing = turf.bearing(
      turf.point([idealPrev.lng, idealPrev.lat]),
      turf.point([idealNext.lng, idealNext.lat])
    );

    // Snapped bearing: from the last kept point to curr
    const snappedBearing = turf.bearing(
      turf.point([prev.lng, prev.lat]),
      turf.point([curr.lng, curr.lat])
    );

    const diff = Math.abs(idealBearing - snappedBearing);
    const angularDiff = diff > 180 ? 360 - diff : diff;

    if (angularDiff <= 130) {
      result.push(curr);
    }
  }

  result.push(waypoints[waypoints.length - 1]);
  return result;
}

/** Appends the first point to the end if the gap between first and last is >50m. */
function closeLoop(waypoints: Point[]): Point[] {
  if (waypoints.length < 2) return waypoints;
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  if (first.lat === last.lat && first.lng === last.lng) return waypoints;
  const gapM = turf.distance(
    turf.point([first.lng, first.lat]),
    turf.point([last.lng, last.lat]),
    { units: "meters" }
  );
  return gapM > 50 ? [...waypoints, first] : waypoints;
}

/** Rotates a closed-loop path so the point nearest to `anchor` becomes index 0. */
function rotateToNearest(path: Point[], anchor: Point): Point[] {
  if (path.length < 2) return path;
  let closestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = turf.distance(
      turf.point([anchor.lng, anchor.lat]),
      turf.point([path[i].lng, path[i].lat]),
      { units: 'meters' }
    );
    if (d < minDist) { minDist = d; closestIdx = i; }
  }
  return [...path.slice(closestIdx), ...path.slice(0, closestIdx)];
}
