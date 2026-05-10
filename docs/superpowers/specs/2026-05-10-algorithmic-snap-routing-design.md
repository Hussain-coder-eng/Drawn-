# Algorithmic Snap Routing — Design Spec
**Date:** 2026-05-10
**Status:** Approved
**Supersedes:** `2026-05-09-route-accuracy-v2-design.md`
**Goal:** Routes must visually resemble the target shape. Debug data confirmed Gemini clusters all anchors in a tiny geographic area regardless of prompting — this is a fundamental failure of using an LLM to solve a 2D spatial distribution problem from text coordinates.

---

## Diagnostic Finding

The v2 debug overlay revealed the root cause conclusively:

- **Ideal path (blue dashed):** correctly spans the full heart extent across the Bronx (~11km)
- **Gemini anchors (colored dots):** ALL 8 stages clustered within 2-3 city blocks at one corner
- **OSRM route:** tries to connect these clustered anchors in stage order, producing a large rectangular detour

No prompting improvement can fix this. Gemini cannot reason about 2D spatial distribution from a text list of lat/lng coordinates. The node selection step must become algorithmic.

---

## Architecture

### Before (Gemini-based)
```
idealPath → stageScript → Gemini(nodeIds) → lockAnchors → OSRM → fitness → retry(Gemini)
```

### After (algorithmic snap)
```
idealPath → sparseSample → batchSnap(OSRM /nearest) → directionFilter → OSRM → fitness → retry(resample)
```

The Gemini Cloud Function stays deployed but is removed from the shape-routing critical path. It becomes the backend for the future image-to-route feature.

---

## Change 1: New Service — `nodeSnapService.ts`

### File
`src/services/nodeSnapService.ts` — new file, pure function, no class.

### Algorithm

```typescript
export async function snapIdealPathToRoads(
  idealPath: Point[],
  routingService: RoutingService,
  targetWaypoints: number = 30
): Promise<Point[]>
```

**Steps:**

**1. Sparse sampling** — sample `targetWaypoints` positions evenly along the ideal path by arc length (not by index):
```typescript
// For each i in [0, targetWaypoints-1]:
// position = (i / (targetWaypoints - 1)) * totalPathLength
// find point at that distance along idealPath using turf.along()
```
This gives evenly-spaced geographic samples regardless of how densely the input polyline is represented.

**2. Batch snap to road surface** — snap samples to road surface via OSRM `/nearest`, in sequential micro-batches of 8 with a 100ms delay between batches (prevents 429s on public OSRM mirrors — the same issue already addressed in `routeWithLockedWaypoints` via 150ms inter-chunk delays). Total snap time ~400-500ms for 30 points.

```typescript
const SNAP_BATCH_SIZE = 8;
const snapped: Point[] = [];
for (let i = 0; i < samples.length; i += SNAP_BATCH_SIZE) {
  const batch = samples.slice(i, i + SNAP_BATCH_SIZE);
  const batchResult = await routingService.batchSnap(batch);
  snapped.push(...batchResult);
  if (i + SNAP_BATCH_SIZE < samples.length) {
    await new Promise(r => setTimeout(r, 100));
  }
}
```

Each returned point is on an actual road surface, not just the nearest node from our ~400-node Overpass pool.

**3. Deduplicate** — remove consecutive identical coordinates (same road node selected for adjacent samples).

**4. Direction filter** — prevents backtracking that would force OSRM to double back:
```typescript
// For each waypoint[i], compute:
//   idealBearing = bearing along idealPath at position i (from i-1 to i+1 ideal sample)
//   snappedBearing = bearing from snapped[i-1] to snapped[i]
//   if angularDiff(idealBearing, snappedBearing) > 130°: remove snapped[i]
```
This removes waypoints where the snap pulled to a road running in the opposite direction.

**5. Closed-loop close** — if `first !== last` and gap > 50m, append `first` to the end of the array.

**6. Minimum count guard** — if fewer than 4 waypoints remain after filtering, return the unfiltered snapped list (better a backtrack than an empty route).

### Return
Ordered `Point[]` ready to pass directly to `routingService.routeWithLockedWaypoints()`.

---

## Change 2: Adaptive Retry

### Location
`src/App.tsx` — replaces the Gemini retry loop in `handleGenerate()`.

### Strategy
Three passes, pure computation (no API calls between passes):

| Pass | `targetWaypoints` | Condition to try |
|------|-------------------|-----------------|
| 1 | 30 | Always |
| 2 | 45 | Pass 1 Frechet score < 50 |
| 3 | 20 | Pass 2 Frechet score < 40 |

Track the best-scoring result across all passes and return it. Total retry cost: ~600ms (one extra batchSnap call) vs. 15-30s for a Gemini retry.

---

## Change 3: Fitness Scoring Recalibration

### Problem
`calculateFrechetFidelity` in `fitnessService.ts` currently scores: `100 - (maxDeviationKm × 500)`. This means 200m max deviation = 0 score. Algorithmic snap with sparse waypoints and real roads will have higher deviation (OSRM fills gaps with shortest-path, not shape-hugging). The current formula would score valid-looking hearts at 0%.

### Fix
Recalibrate: `100 - (maxDeviationKm × 200)` — meaning 500m max deviation = 0 score, 0m = 100 score. This matches realistic expectations for road-snapped routing.

**Before:** `Math.max(0, 100 - (maxDev * 500))`
**After:** `Math.max(0, 100 - (maxDev * 200))`

### Stage scoring
`scoreRoute()` remains in `fitnessService.ts` but is no longer called in the main pipeline — `scoreFidelity()` becomes the sole fitness signal. The `RouteFitness` interface returned will have `stageScores: []` and `overallFitness` derived from `scoreFidelity()` alone. The UI "X% match" display is driven by `overallFitness`, so the user experience is unchanged.

### `passed` threshold
Keep at `overallFitness >= 70` — with the recalibrated formula this now means ≤150m max deviation.

---

## Change 4: App.tsx Pipeline Simplification

### Removed from `handleGenerate()`
- `geminiService.selectNodesStaged()` call
- `geminiService.rerouteFailingStages()` call
- `buildOSRMWaypointArray()` call (Gemini-specific waypoint building)
- `lockAnchorPointsToNodes()` call
- Anchor quality check block (`anchorQualityFailed`)
- Gemini-specific progress messages

### Replaced with
```typescript
// 5. Snap ideal path to road network
const snappedWaypoints = await snapIdealPathToRoads(
  bestConfig.projectedPoints,
  routingService,
  30
);

// 6. Route with OSRM
const { polylineCoords } = await routingService.routeWithLockedWaypoints(snappedWaypoints);

// 7. Score
const fidelity = fitnessService.scoreFidelity(routedPoints, mode, bestConfig.projectedPoints);
const fitness: RouteFitness = {
  overallFitness: fidelity,
  stageScores: [],
  failingStages: [],
  passed: fidelity >= 70
};

// 8. Adaptive retry
if (!fitness.passed && attempt < maxAttempts) {
  // retry with different targetWaypoints
}
```

### `maxAttempts`
Change from 2 to 3 (to allow the three-pass adaptive retry).

### Debug overlay
The debug overlay from v2 bugfixes (`debugInfo` in state) needs updating:
- `idealPath` stays (still useful)
- `anchorsByStage`: replace with flat `snappedWaypoints` array (no stages)
- Debug now shows: ideal path (blue dashed) + snapped waypoints (colored dots) + route (pink)

---

## Non-Changes

| Component | Status |
|-----------|--------|
| `overpassService.ts` | Unchanged — road network fetch still needed |
| `feasibilityService.ts` | Unchanged — density gate still needed |
| `optimizationService.ts` | Unchanged — orientation still needed |
| `geminiService.ts` | Unchanged — stays for future image-to-route |
| Cloud Function (`functions/src/index.ts`) | Unchanged — stays deployed |
| `routingService.batchSnap()` | Unchanged — reused as-is |
| `routingService.routeWithLockedWaypoints()` | Unchanged — reused as-is |
| `shapeMath.ts` | Unchanged |
| `routeScripts.ts` | Unchanged — stage scripts no longer used in routing but kept for future reference / image-to-route orientation hints |
| `src/lib/stageService.ts` | Unused after this change — generated `idealStagePaths` and stage pools for Gemini. Left in place (no deletion) to avoid breaking any imports; can be removed in a future cleanup. |

---

## Future: Image-to-Route

When a user uploads an image (hand-drawn heart, logo, sketch):
1. Send image to Gemini Vision → extract as a normalized polyline
2. Project polyline to target lat/lng area at target scale
3. Feed projected polyline into `snapIdealPathToRoads()` as `idealPath`
4. Steps 5-8 above run identically

No new infrastructure needed. The Gemini Cloud Function handles step 1. The snap pipeline handles steps 3+.

---

## Data Flow (After Changes)

```
1. Shape math → projectedPoints (dense ideal polyline)
2. Overpass → RoadNetwork
3. Orientation optimization → bestConfig
4. Feasibility gate → fail fast if sparse
5. [NEW] Sparse sample idealPath at 30 positions by arc length
6. [NEW] batchSnap() → 30 on-road points (parallel OSRM /nearest, ~300ms)
7. [NEW] Direction filter → remove backtrack-inducing waypoints
8. [NEW] Closed-loop close → append start to end if gap > 50m
9. OSRM routing via routeWithLockedWaypoints() → polyline
10. scoreFidelity() → Frechet-based fitness (recalibrated formula)
11. [NEW] Adaptive retry: resample at 45 or 20 waypoints if score < threshold
12. Return best result
```

---

## Files

| Action | File | Change |
|--------|------|--------|
| Create | `src/services/nodeSnapService.ts` | `snapIdealPathToRoads()` function |
| Modify | `src/App.tsx` | Replace Gemini flow with snap flow; update debug overlay |
| Modify | `src/services/fitnessService.ts` | Recalibrate Frechet formula (`×500` → `×200`) |
| Modify | `src/types.ts` | Update `DebugInfo.anchorsByStage` → `snappedWaypoints: Point[]` |
| Modify | `src/components/MapComponent.tsx` | Update debug overlay to render snapped waypoints (flat, no stages) |

---

## Success Criteria

| Metric | Before (Gemini) | Target |
|--------|-----------------|--------|
| Visual resemblance | Unrecognizable | Clearly recognizable as intended shape |
| Generation time | 20-60s | 4-6s |
| Retry cost | 15-30s (another Gemini call) | <600ms (re-snap, no API) |
| Score (Frechet, recalibrated) | 34% on dense-city heart | ≥60% on dense-city heart |
| Anchor distribution | All 8 stages in 2-3 blocks | Waypoints span full shape extent |

---

## Testing Plan

1. **Unit** — `nodeSnapService`: verify sparse sampling produces correct count, direction filter removes reversal waypoints, closed-loop close fires on gap > 50m
2. **Unit** — `fitnessService`: verify recalibrated formula scores 500m deviation as 0, 0m as 100
3. **Integration** — generate heart at Bronx location from debug screenshot; confirm waypoints visually distributed around heart shape (not clustered); Frechet ≥ 60
4. **Regression** — generate circle, star, arrow at Naperville; confirm scores don't drop vs. before
5. **Manual** — enable debug overlay; confirm snapped waypoints visible around full heart perimeter
