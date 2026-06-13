# Route Accuracy Tier 1 — Targeted Fixes Design Spec

**Date:** 2026-05-11
**Status:** Draft
**Builds on:** `2026-05-10-algorithmic-snap-routing-design.md`
**Goal:** Eliminate two specific failure modes visible on a 14.4 km closed-loop star (50% match): top apex unrouted (topology mismatch) and inward clipping of arms (forced-anchor artifact).

---

## Diagnostic Summary

Two independent failures reproducing on the star test case:

1. **Topology mismatch.** Overpass radius is `max(800, distKm/2π × 1.3 × 1000)` — a circle-equivalent heuristic. For a 14.4 km **star**, this gives ~2980 m, but the star's outer radius is ~2.5 km. The top apex sits in the margin or just outside the fetched road network. All snap candidates pulled back to the dense southern grid; the top point is lost.

2. **Inward clipping.** `forcedAnchor = userLocation` snapped to road. For closed loops, both start and end are pinned to this interior point. The loop must "return home," dragging the routed polyline inward and clipping features (lower-left arm in the screenshot) farthest from the user.

Both reproduce regardless of the snap algorithm. They are fixed by sizing the network correctly and relocating the closed-loop anchor — no changes to snap, OSRM, or fitness.

---

## Change 1 — Anchor closed loops to the ideal perimeter, not user GPS

### Location
`src/App.tsx`, `handleGenerate()`, the `if (closed)` block currently at lines 388–393.

### Behavior
For closed-loop shapes, find the **nearest point on the projected ideal shape's perimeter to the user's GPS position**, snap that to a road, and use it as `forcedAnchor`. The user's GPS is no longer the anchor; the anchor sits on the shape itself.

### Implementation
```typescript
let forcedAnchor: Point | undefined;
if (closed) {
  const idealLine = turf.lineString(
    bestConfig.projectedPoints.map(p => [p.lng, p.lat])
  );
  const nearestOnIdeal = turf.nearestPointOnLine(
    idealLine,
    turf.point([userLocation.lng, userLocation.lat])
  );
  const idealAnchor: Point = {
    lat: nearestOnIdeal.geometry.coordinates[1],
    lng: nearestOnIdeal.geometry.coordinates[0],
  };
  const [startOnRoad] = await routingService.batchSnap([idealAnchor]);
  forcedAnchor = startOnRoad;
}
```

This sits **after** `bestConfig` is produced (line 369+), so `projectedPoints` is available. The existing block at 388 moves down accordingly.

### UX Consequence
The start/end of the loop is now on the shape perimeter, not at the user's position. For a user standing at the center of a star, the start may be ~1 km away. This is an acceptable tradeoff: the alternative is the disfigured shape in the screenshot. A future enhancement (out of scope here) can prepend a "warp-in" segment from user → anchor for true door-to-door routing.

### Open-loop shapes
No change. `forcedAnchor` remains `undefined`, the start is whatever the snap pipeline produces from the ideal path's first vertex.

---

## Change 2 — Size Overpass radius to the projected shape bbox

### Location
`src/App.tsx`, the radius calculation currently at line 349.

### Behavior
Compute a **preview projection** of the shape at `userLocation` and target distance — this is a pure-math step using `scaleAndCenter` and the already-existing `simplifiedPoints`. Then size the network radius to cover the preview's bounding-box half-diagonal plus 20% margin. The existing circle-based heuristic remains as a floor — never go smaller than what it would have produced.

### Implementation
```typescript
import { scaleAndCenter, computeBboxDiagonal } from "./lib/shapeMath";

// (existing) simplifiedPoints already computed above this block

const previewPoints = scaleAndCenter(
  simplifiedPoints.map(p => ({ lat: p.y, lng: p.x })),
  userLocation,
  distInKm
);
const shapeHalfDiagonalM = (computeBboxDiagonal(previewPoints) / 2) * 1000;
const circleHeuristicM = (distInKm / (2 * Math.PI)) * 1.3 * 1000;

const baseRadiusMeters = Math.max(
  800,
  Math.round(Math.max(circleHeuristicM, shapeHalfDiagonalM * 1.2))
);
```

For the 14.4 km star: half-diagonal ≈ 3.5 km, so radius becomes ~4.2 km — covers the full extent. For a circle, half-diagonal equals the circle-heuristic radius, so radius is unchanged. No regression on circle/oval shapes.

### Mode coverage
`adaptiveSimplify` runs unconditionally for all three modes at App.tsx:346, so `simplifiedPoints` is defined whether the input is a shape, drawing, or text. Text mode's `composeWordPath` already produces geographic coordinates which are then re-normalized into `NormalizedPoint` (`{x: lng, y: lat}`); passing those through `scaleAndCenter(..., userLocation, distInKm)` is effectively idempotent (scale ≈ 1, recenter at same userLocation), so the preview projection is well-defined for all modes.

---

## Change 3 — Feasibility check upgrade

### Current state
`feasibilityService.ts` checks `nodesPerKm < 3` and throws `FeasibilityError`.

### Addition
Add a second check: **fraction of ideal-path samples that have a road node within 100 m**. If less than 70% of ideal samples have nearby road coverage, the shape physically does not fit the available road network — surface the same error, with a more specific message.

```typescript
// In checkFeasibility, after the existing nodesPerKm check:
const SAMPLE_COUNT = 20;
const COVERAGE_RADIUS_M = 100;
const idealLine = turf.lineString(projectedPoints.map(p => [p.lng, p.lat]));
const lengthKm = turf.length(idealLine, { units: 'kilometers' });
const samples: Point[] = [];
for (let i = 0; i < SAMPLE_COUNT; i++) {
  const frac = i / (SAMPLE_COUNT - 1);
  const pt = turf.along(idealLine, frac * lengthKm, { units: 'kilometers' });
  samples.push({ lat: pt.geometry.coordinates[1], lng: pt.geometry.coordinates[0] });
}

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

const coverage = covered / SAMPLE_COUNT;
if (coverage < 0.7) {
  throw new FeasibilityError(
    `This shape doesn't fit the available roads here ` +
    `(only ${Math.round(coverage * 100)}% of the shape has nearby roads). ` +
    `Try a smaller distance, a different location, or a simpler shape.`
  );
}
```

Performance: 20 samples × ~1000 nodes worst case = 20k distance computations. Negligible vs. the rest of the pipeline.

---

## Non-Changes

| Component | Status |
|-----------|--------|
| `nodeSnapService.ts` | Unchanged |
| `routingService.ts` | Unchanged |
| `fitnessService.ts` | Unchanged |
| `optimizationService.ts` | Unchanged |
| Snap/route retry logic in `handleGenerate` | Unchanged |
| Debug overlay | Unchanged |

---

## Success Criteria

| Metric | Before | Target |
|--------|--------|--------|
| 14.4 km star at the screenshot location: top apex reached | No | Yes |
| 14.4 km star at the screenshot location: all 5 outer points reached | No (2/5) | All 5 |
| Closed-loop shapes with user near shape center: loop traces full perimeter | No (clipped) | Yes |
| Circle shape at any distance: regression check | OK | OK (radius unchanged for circles) |
| Topology-mismatch case (shape physically too large for area): user message | Generic "low fitness" | Specific "shape doesn't fit" error before routing |

---

## Testing Plan

1. **Unit — `feasibilityService`:** synthetic case where 5/20 ideal samples have no node within 100 m → throws `FeasibilityError` with coverage message.
2. **Unit — radius calc:** for star at distInKm=14.4, verify `baseRadiusMeters > 4000`. For circle at distInKm=14.4, verify ≤ ~3000 (no regression).
3. **Unit — anchor relocation:** given a star polyline centered at (0,0) and user at (0,0), assert `forcedAnchor` lands on one of the perimeter vertices (within snap tolerance), not at (0,0).
4. **Integration — screenshot reproduction:** regenerate the 14.4 km star at the same userLocation. Top apex routed; all 5 outer points reached; closed loop does not chop the lower-left arm.
5. **Regression — small circles, hearts, squares at modest distances:** confirm no visible degradation and same-or-better fidelity scores.

---

## Out of Scope (Tier 2 / Tier 3)

- Multi-candidate snapping (`/nearest?number=5` + bearing-aligned selection)
- Corner-aware sampling (vertex detection via curvature/Douglas-Peucker)
- Graph-based A* with shape-deviation cost
- User → anchor warp-in routing for door-to-door experience
