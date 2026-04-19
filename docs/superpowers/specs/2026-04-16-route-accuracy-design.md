# Route Accuracy — Design Spec
**Date:** 2026-04-16  
**Status:** Approved  
**Goal:** Make generated routes visually recognizable as their intended shape (circle, star, letter, freehand). Pass criterion: route looks like the shape — not a fitness score threshold.

---

## Overview

The pipeline stays structurally unchanged — one Gemini call per attempt, up to 3 retries. Five targeted changes address the root causes of unrecognizable routes:

| # | Change | File(s) |
|---|--------|---------|
| 1 | Per-stage spatial node filtering | `overpassService.ts`, `App.tsx` |
| 2 | Enriched Gemini prompt with ideal path coords + per-stage node pools | `geminiService.ts` |
| 3 | Fix `extractStagesFromPolyline` bug so fitness scoring works | `fitnessService.ts`, `App.tsx` |
| 4 | Smarter reroute prompt with spatial deviation feedback | `geminiService.ts` |
| 5 | Lower pass threshold 90 → 70, failing stage threshold 75 → 60 | `fitnessService.ts`, `App.tsx` |

---

## Change 1: Per-Stage Spatial Node Filtering

### Problem
Gemini receives a flat pool of 400 nodes covering the entire shape area. When selecting nodes for the "top of a circle" stage, it must ignore 350+ irrelevant nodes — noise that degrades selections.

### Solution
For each stage, compute a spatial bounding corridor around that stage's segment of the ideal path and filter to only nodes within it.

### Algorithm
1. The ideal path is already projected to lat/lng as `bestConfig.projectedPoints`. Divide those points proportionally to match each stage's `distancePct`.
2. For each stage segment, compute a bounding box around the start→end points expanded by **400m** on each side.
3. Filter the 400-node pool to nodes within that bounding box.
4. If fewer than **8 nodes** remain after filtering (sparse area), fall back to the **20 nearest nodes** to the stage segment midpoint.

### New API
```typescript
// overpassService.ts
getNodesForStage(
  allNodes: OSMNode[],
  stagePath: Point[],      // ideal sub-path for this stage
  bufferMeters: number     // default: 400
): OSMNode[]
```

Called in `App.tsx` before the Gemini call to produce `stageNodePools: OSMNode[][]` — one filtered pool per stage.

### Expected Result
Each stage gets 15–40 highly relevant nodes instead of 400 mixed ones. A "go north" stage only sees nodes to the north. A curve stage sees nodes along that curve.

---

## Change 2: Enriched Gemini Prompt

### Problem
Gemini receives a direction label and distance target per stage, but no visibility into the actual geometric shape it's tracing. It selects nodes by compass direction alone, with no reference to the curve or silhouette.

### Solution
Restructure the prompt into per-stage blocks. Add the ideal path coordinates as a geometric reference. Use per-stage filtered node pools.

### Prompt Structure
```
You are drawing a CIRCLE. The ideal shape passes through these reference points:
[lat, lng] → [lat, lng] → ... (8–12 evenly sampled points from the full ideal path)

Execute each stage below. Use ONLY nodes from that stage's node list.

=== STAGE 1: Move NE, target 0.8km ===
Ideal path for this stage: [lat,lng] → [lat,lng] → [lat,lng]
Available nodes (ID: lat, lng):
1: 51.50123, -0.12456
2: 51.50201, -0.12389
...

=== STAGE 2: Move SE, target 0.8km ===
Ideal path for this stage: [lat,lng] → [lat,lng] → [lat,lng]
Available nodes (ID: lat, lng):
47: 51.49876, -0.12234
...
```

### Key Additions vs Current Prompt
- Shape name prominently stated at top ("You are drawing a CIRCLE")
- Full ideal path as 8–12 sampled reference waypoints (token-conscious, not all points)
- Per-stage ideal sub-path so Gemini knows the exact curve to trace per segment
- Per-stage node lists (15–40 nodes, not 400) from filtered pools
- Explicit instruction to use only that stage's nodes — eliminates cross-stage confusion

### Token Impact
Fewer nodes per stage (15–40 vs 400) more than compensates for added ideal path coordinates. Net token count is similar to or lower than current.

### Index Mapping
The existing small-integer index mapping (OSM ID → short index → back) is preserved. A single global index is built across all nodes in all stage pools (deduplicating nodes that appear in multiple stage corridors). Gemini references these global indices in its response, and the same `indexToId` map resolves them back to OSM IDs.

---

## Change 3: Fitness Bug Fix

### Problem
`scoreFitness` calls `extractStagesFromPolyline` which returns empty `nodeIds` arrays (placeholder). `scoreRoute` gets 0 nodes per stage → every stage scores 0 → `failingStages` = all stages → retry logic has no real signal.

### Solution
Remove `extractStagesFromPolyline` and `scoreFitness`. Replace with two explicit steps called directly from `App.tsx`.

### New Flow in App.tsx
```typescript
// Score stages directly from Gemini result (not re-extracted from polyline)
const stageScore = fitnessService.scoreRoute(result.stages, aiStages, network.nodeMap, distInKm);

// Score shape fidelity from routed polyline vs ideal
const fidelityScore = fitnessService.scoreFidelity(routedPoints, state.mode, bestConfig.projectedPoints);

// Blend 60/40
const overallFitness = Math.round((stageScore.overallFitness * 0.6) + (fidelityScore * 0.4));
const fitness: RouteFitness = {
  ...stageScore,
  overallFitness,
  passed: overallFitness >= 70
};
```

### Changes to fitnessService.ts
- Extract fidelity logic from `scoreFitness` into new public `scoreFidelity(routedPoints, mode, idealPoints): number`
- Delete `scoreFitness` and `extractStagesFromPolyline`
- `scoreRoute` remains unchanged (already works correctly)
- Change `passed: overallFitness >= 90` → `passed: overallFitness >= 70`
- Change `failingStages` threshold: `overallStageScore < 75` → `overallStageScore < 60`

### Result
Fitness score now reflects what Gemini actually selected. A stage that went the wrong direction correctly shows a low `directionScore`. Only genuinely bad stages get rereouted.

---

## Change 4: Smarter Reroute Prompt

### Problem
The current reroute prompt says "Stage 2 direction score: 40/100, needed to go NE." Gemini has no spatial context for where it went wrong — it retries with the same nodes and the same vague instruction.

### Solution
Add concrete spatial deviation feedback per failing stage. Compute the centroid of Gemini's selected nodes vs the centroid of the ideal sub-path for that stage, and describe the gap in plain terms.

### New Reroute Prompt Structure (per failing stage)
```
Stage 2 failed (score: 38/100):
- Direction: needed NE, your nodes traveled SW
- Your selected nodes were centered at 51.4923, -0.1187
- The ideal path for this stage centers at 51.5021, -0.1089
- You are ~140m south and ~60m west of where you should be
- Ideal sub-path to trace: [lat,lng] → [lat,lng] → [lat,lng]
- Available nodes (try nodes closer to the ideal path):
  [per-stage filtered node pool]
```

### New Helper
```typescript
// geminiService.ts
computeStageSpatialDeviation(
  failingStage: StageScore,
  geminiResult: GeminiStagedResult,
  stageNodePool: OSMNode[],
  idealStagePath: Point[],
  nodeMap: Map<string, any>
): { deviationText: string; idealCentroid: Point; actualCentroid: Point }
```

Uses turf to compute bearing + distance between centroids and returns a human-readable description.

### Token Impact
Reroute calls send only failing stages + their filtered node pools. If 2 of 6 stages fail, Gemini sees ~30–80 nodes total — significantly smaller than the current reroute which resends all 400 nodes.

---

## Change 5: Threshold Adjustments

| Threshold | Before | After | Reason |
|-----------|--------|-------|--------|
| `passed` (overall) | ≥ 90 | ≥ 70 | User confirmed 70+ is acceptable if shape is recognizable |
| `failingStages` (per stage) | < 75 | < 60 | Only retry truly bad stages, not borderline ones |

---

## Data Flow (Updated)

```
bestConfig.projectedPoints
    │
    ├─ buildStageScript() → aiStages[]
    │
    ├─ getNodesForStage() × N stages → stageNodePools[][]   ← NEW
    │
    └─ geminiService.selectNodesStaged(stageNodePools, aiStages, idealPath)
            │   ↑ enriched prompt with per-stage pools + ideal path coords
            │
            ▼
       GeminiStagedResult (node IDs per stage)
            │
            ├─ routingService.routeWithLockedWaypoints()
            │       ↓
            │   routedPoints[]
            │
            ├─ fitnessService.scoreRoute(result.stages, ...)   ← was broken, now direct
            ├─ fitnessService.scoreFidelity(routedPoints, ...)
            └─ blend → RouteFitness { overallFitness, passed, failingStages }
                    │
                    └─ if !passed && attempt < 3:
                         geminiService.rerouteFailingStages(
                           stageNodePools,      ← per-stage pools reused
                           spatialDeviation,    ← NEW
                           ...
                         )
```

---

## Files Modified

| File | Changes |
|------|---------|
| `src/services/overpassService.ts` | Add `getNodesForStage()` |
| `src/services/geminiService.ts` | Restructure `selectNodesStaged` prompt; add `computeStageSpatialDeviation`; update `rerouteFailingStages` prompt |
| `src/services/fitnessService.ts` | Delete `scoreFitness` + `extractStagesFromPolyline`; add `scoreFidelity`; update thresholds |
| `src/App.tsx` | Build `stageNodePools` before Gemini call; replace `scoreFitness` call with `scoreRoute` + `scoreFidelity` + manual blend |

---

## Success Criteria

- Premade shapes (circle, star, heart, arrow): route visually resembles the shape
- Text (e.g. "RUN", "A"): letter outline is traceable from the route
- Freehand drawings: route follows the general silhouette of the drawing
- No regression on fitness score distribution (routes don't get worse)
- `npm run lint` passes — no TypeScript errors
- Free-tier Gemini token usage does not increase (net neutral or lower due to per-stage filtering)
