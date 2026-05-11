# Shape-Anchored A* Routing — Design Spec (Tier 3)

**Date:** 2026-05-11
**Status:** Approved
**Builds on:** `2026-05-11-route-accuracy-tier1-design.md`
**Goal:** Between every pair of consecutive snapped waypoints, route along real streets using an A* search that minimizes `α·distance + β·perpendicular_deviation_from_ideal`, forcing the path to follow the intended shape rather than the shortest route.

---

## Problem

The current pipeline calls `routeWithLockedWaypoints()` which feeds waypoints to OSRM. OSRM finds the shortest-path route between waypoints — it has no concept of the target shape. When two consecutive waypoints are far apart (long star arm, lightning bolt leg), OSRM takes the fastest road route, which may cross perpendicular to the intended shape direction. The result: jogs, shortcuts, and missed features even when waypoints are well-placed.

---

## Data Structure Audit

**Already available in `RoadNetwork`:**

| Field | Type | Content |
|-------|------|---------|
| `nodeMap` | `Map<string, OSMNode>` | Node ID → `{id, lat, lng}` |
| `edgeMap` | `Map<string, string[]>` | Node ID → adjacent node IDs (bidirectional, all ways) |
| `nodes` | `OSMNode[]` | Same as nodeMap, as array |

**No additional graph construction needed.** The `edgeMap` is an undirected adjacency list ready for A*. One-way enforcement is not needed for the foot profile — pedestrians can walk against traffic direction.

---

## Architecture

### Before (OSRM shortest-path)
```
snappedWaypoints → routeWithLockedWaypoints() → OSRM → polyline
```

### After (shape-anchored A*)
```
snappedWaypoints → graphRouteShape() → [A*(segment_i, idealSubPath_i) per pair] → polyline
                                         ↓ (if A* returns null)
                                        OSRM segment fallback
```

---

## New File 1: `src/services/graphService.ts`

Pure, stateless graph utilities. No async, no external calls.

### Types

```typescript
export interface AStarOptions {
  alpha?: number;  // distance cost weight (default: 1.0)
  beta?: number;   // shape-deviation cost weight (default: 2.0)
  maxIterations?: number;  // safety cap (default: nodeMap.size × 4)
}
```

### `findNearestGraphNode(point, nodeMap): string | null`

Linear scan over nodeMap, returns ID of the closest node by Haversine distance. Returns null on empty map.

**Complexity:** O(N), N = node count (~1000). Called 2× per segment = 2×M calls total. Negligible.

### `aStarSegment(startId, goalId, nodeMap, edgeMap, idealSegment, options?): OSMNode[] | null`

Returns the path as an ordered array of `OSMNode` from start to goal (inclusive), or `null` if no path is found (disconnected graph or max iterations exceeded).

**Algorithm:**

1. **Priority queue:** Min-heap keyed by `f = g + h`.
2. **g(n):** accumulated `alpha × edgeLengthM + beta × midpointDeviationM` from start.
3. **h(n):** `alpha × haversineDistanceToGoalM` — admissible because `alpha × straightLine ≤ alpha × roadDist ≤ actual_cost`.
4. **Edge cost:** for edge u→v:
   - `edgeLengthM` = haversine distance between u and v
   - `midpointDeviationM` = `turf.pointToLineDistance(midpoint(u,v), idealLine, {units:'meters'})`
   - If `idealSegment.length < 2`, deviation = 0 (any path equally good)
5. **Visited set:** string node IDs. Once a node is popped from the heap, it is closed.
6. **Path reconstruction:** parent map (nodeId → parentId). Walk from goal back to start, reverse.
7. **Max iterations cap:** `maxIterations = options?.maxIterations ?? nodeMap.size * 4`. Return null on cap.

**MinHeap (internal class):** Binary min-heap of `{id: string, f: number}`. Standard push/pop with sift-up/sift-down. O(log N) per operation.

### Cost constants

```typescript
export const DEFAULT_ALPHA = 1.0;
export const DEFAULT_BETA = 2.0;
```

---

## New File 2: `src/services/graphRoutingService.ts`

Orchestrates segment-by-segment routing. Async (has OSRM fallback).

### `graphRouteShape(snappedWaypoints, idealPath, nodeMap, edgeMap, routingService, options?)`

**Signature:**
```typescript
export async function graphRouteShape(
  snappedWaypoints: Point[],
  idealPath: Point[],
  nodeMap: Map<string, OSMNode>,
  edgeMap: Map<string, string[]>,
  routingService: RoutingService,
  options?: AStarOptions
): Promise<{ polylineCoords: [number, number][] }>
```

**Return type matches `routeWithLockedWaypoints` output** — drop-in replacement at the call site.

**Steps:**

1. Guard: if `snappedWaypoints.length < 2`, fall back to `routeWithLockedWaypoints`.
2. Build `idealLine = turf.lineString(idealPath)` and compute `totalIdealKm`.
3. For each consecutive pair `(A, B)` of snapped waypoints (index i and i+1):
   a. Snap A and B to nearest graph nodes: `startId = findNearestGraphNode(A, nodeMap)`, `goalId = findNearestGraphNode(B, nodeMap)`.
   b. Extract ideal sub-path for this segment (see below).
   c. Run `aStarSegment(startId, goalId, nodeMap, edgeMap, idealSubPath, options)`.
   d. If A* returns a path: convert `OSMNode[]` to `[lng, lat][]` coordinates.
   e. If A* returns null (no path): fall back to OSRM for this segment only — call `routingService.routeWithLockedWaypoints([A, B])` and use its polylineCoords.
4. Concatenate all segment polylines (skip the first point of each subsequent segment to avoid duplicates).
5. Return `{ polylineCoords }`.

**Ideal sub-path extraction for segment i:**

```typescript
const M = snappedWaypoints.length;
const fracA = i / (M - 1);
const fracB = (i + 1) / (M - 1);
const kmA = fracA * totalIdealKm;
const kmB = fracB * totalIdealKm;

// Walk idealPath accumulating arc length; collect vertices in [kmA, kmB]
const interior: Point[] = [];
let cumKm = 0;
for (let j = 1; j < idealPath.length; j++) {
  const segLen = turf.distance(
    turf.point([idealPath[j-1].lng, idealPath[j-1].lat]),
    turf.point([idealPath[j].lng, idealPath[j].lat]),
    { units: 'kilometers' }
  );
  if (cumKm + segLen > kmA && cumKm < kmB) {
    interior.push(idealPath[j]);
  }
  cumKm += segLen;
  if (cumKm >= kmB) break;
}

const startPt = turf.along(idealLine, kmA, { units: 'kilometers' });
const endPt   = turf.along(idealLine, kmB, { units: 'kilometers' });
const idealSubPath: Point[] = [
  { lat: startPt.geometry.coordinates[1], lng: startPt.geometry.coordinates[0] },
  ...interior,
  { lat: endPt.geometry.coordinates[1],   lng: endPt.geometry.coordinates[0] },
];
```

This is a pure sub-polyline extraction — no API calls. `turf.along` is synchronous.

**OSRM fallback per segment:** A single `routeWithLockedWaypoints([A, B])` call with 2 waypoints is cheap (one OSRM request). This is the safety net for disconnected graph areas (parks, waterways cutting through the road network).

---

## Modified File: `src/App.tsx`

### Change: swap routing call

**Before (in the retry loop):**
```typescript
const routingResult = await routingService.routeWithLockedWaypoints(snappedWaypoints);
```

**After:**
```typescript
const routingResult = await graphRouteShape(
  snappedWaypoints,
  bestConfig.projectedPoints,
  network.nodeMap,
  network.edgeMap,
  routingService
);
```

Add `import { graphRouteShape } from "./services/graphRoutingService";` at the top.

No other changes to App.tsx — the return type is compatible.

---

## New File: `src/tests/graphService.test.ts`

Unit tests using Vitest.

### Test 1 — A* finds path on simple grid
```
4-node grid: A-B-C-D (linear chain A→B→C→D)
edgeMap: A:[B], B:[A,C], C:[B,D], D:[C]
idealSegment: straight line A→D
Expected: path [A, B, C, D]
```

### Test 2 — A* finds shape-hugging path over shortcut
```
5-node graph: start-topLeft-topRight-bottomRight-goal (U-shape vs direct)
With ideal segment along top U arc, beta=3.0
Expected: path goes through topLeft→topRight rather than direct start→goal (even if longer)
```

### Test 3 — Disconnected graph returns null
```
startId not connected to goalId
Expected: null
```

### Test 4 — findNearestGraphNode returns correct node
```
3 nodes at known positions, query near node 2
Expected: returns node 2's ID
```

### Test 5 — graphRouteShape concatenates segments without duplicates
```
Mock: 3 snapped waypoints, 2 segments, each A* returns 3-node path
Expected: result has 5 coords (not 6 — no duplicate junction point)
```

---

## Non-Changes

| Component | Status |
|-----------|--------|
| `nodeSnapService.ts` | Unchanged — still produces snapped waypoints |
| `routingService.ts` | Unchanged — used as OSRM fallback per-segment |
| `fitnessService.ts` | Unchanged |
| `optimizationService.ts` | Unchanged |
| `overpassService.ts` | Unchanged — edgeMap/nodeMap reused as-is |
| Debug overlay | Unchanged |
| Retry logic (3 passes) | Unchanged — graphRouteShape is called inside each pass |

---

## Tuning Constants

| Constant | Default | Effect |
|----------|---------|--------|
| `DEFAULT_ALPHA` | 1.0 | Cost per meter of road traveled |
| `DEFAULT_BETA` | 2.0 | Cost per meter of perpendicular deviation from ideal |

Higher β → tighter shape hugging at the cost of longer routes. At β=2.0: a 1m deviation costs as much as traveling 2m of extra road. Tune upward (β=3.0) if shapes still cut corners after this change.

---

## Parallel Agent Decomposition

Four independent agents can run simultaneously:

| Agent | Files touched | Depends on |
|-------|---------------|------------|
| A | `src/services/graphService.ts` (new) | Nothing — pure function |
| B | `src/services/graphRoutingService.ts` (new) | graphService.ts interface (in spec) |
| C | `src/App.tsx` (one import + one call swap) | graphRoutingService.ts interface (in spec) |
| D | `src/tests/graphService.test.ts` (new) | graphService.ts interface (in spec) |

Agents B, C, D use the TypeScript interfaces from this spec — they don't need Agent A's code to exist first, only to agree on the interface. After all agents complete, run `npm run lint` and `npm run test` to verify consistency.

---

## Success Criteria

| Metric | Before (OSRM only) | Target |
|--------|--------------------|--------|
| Star at 14.4 km: visual fidelity | 50% match | ≥70% match |
| Star: all 5 outer points reached | 2–3 of 5 | 5 of 5 |
| Generation time | 4–6s | 4–8s (A* adds <100ms) |
| Disconnected-graph segment | Route failure | Graceful OSRM fallback, no error |
| Circle / heart regression | baseline | Same or better |

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| A* max iterations exceeded | Return null → OSRM fallback; log warning |
| Disconnected graph node (isolated road stub) | OSRM fallback per segment |
| β too high causing very long detours | Capped by maxIterations; OSRM fallback if path is absurdly long (future: add max-path-length guard) |
| Beta/alpha need tuning per shape type | Constants exported — can be passed per-shape in a future enhancement |
