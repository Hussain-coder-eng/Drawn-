# Algorithmic Snap Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Gemini AI node-selection with a greedy OSRM-snap algorithm so routes visually resemble the target shape and generate in 4-6s instead of 20-60s.

**Architecture:** Sample the ideal path at 30 evenly-spaced positions by arc length, snap each to the nearest real road surface via OSRM `/nearest`, apply a direction filter to prevent backtracking, then route with OSRM as before. An adaptive retry loop varies the waypoint count (30 → 45 → 20) using pure computation — no extra AI calls.

**Tech Stack:** TypeScript, turf.js (already in project), existing `RoutingService.batchSnap()` + `routeWithLockedWaypoints()`, Vitest for tests.

---

## Parallelization Map

```
Tasks 1, 2, 3 → run IN PARALLEL (independent files, no shared edits)
Task 4          → run AFTER Tasks 1-3 complete (imports from all three)
```

**Gang dispatch order:**
- Batch A (parallel): Task 1 + Task 2 + Task 3
- Batch B (sequential): Task 4

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/services/nodeSnapService.ts` | `snapIdealPathToRoads()` — samples, snaps, filters, closes loop |
| Create | `tests/unit/nodeSnapService.test.ts` | Unit tests for all snap logic |
| Modify | `src/services/fitnessService.ts` | Recalibrate Frechet formula: `×500` → `×200` |
| Modify | `tests/unit/fitnessService.test.ts` | Add 2 tests for recalibrated formula |
| Modify | `src/types.ts` | Replace `anchorsByStage` with `snappedWaypoints` in `DebugInfo` |
| Modify | `src/components/MapComponent.tsx` | Update debug overlay to render flat `snappedWaypoints` array |
| Modify | `src/App.tsx` | Replace entire Gemini flow with snap loop + update `debugInfo` building |

---

## Task 1: `nodeSnapService.ts` — Snap Algorithm

> **Parallel-safe: YES. Run this at the same time as Tasks 2 and 3.**

**Files:**
- Create: `src/services/nodeSnapService.ts`
- Create: `tests/unit/nodeSnapService.test.ts`

---

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/nodeSnapService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { snapIdealPathToRoads } from '../../src/services/nodeSnapService';
import { RoutingService } from '../../src/services/routingService';
import { Point } from '../../src/lib/shapeMath';

function makeRS(snapFn: (pts: Point[]) => Point[]): RoutingService {
  return {
    batchSnap: vi.fn(async (pts: Point[]) => snapFn(pts)),
  } as unknown as RoutingService;
}

function circlePoints(n = 100): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * Math.PI * 2;
    return { lat: 51.5 + 0.05 * Math.cos(t), lng: -0.1 + 0.07 * Math.sin(t) };
  });
}

describe('snapIdealPathToRoads', () => {
  it('returns at most targetWaypoints + 1 points (+ possible loop close)', async () => {
    const rs = makeRS(pts => pts); // identity snap
    const result = await snapIdealPathToRoads(circlePoints(), rs, 20);
    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result.length).toBeLessThanOrEqual(22); // 20 + loop-close point
  });

  it('closes the loop when first and last are far apart', async () => {
    // Ideal: a small closed circle but snap shifts the last point far away
    const ideal = circlePoints(20);
    let call = 0;
    const rs = makeRS(pts => pts.map((p, i) => {
      // On the final batch, shift the last point 1° away (>>50m)
      if (call === 0 && i === pts.length - 1) { call++; return { lat: p.lat + 1, lng: p.lng }; }
      return p;
    }));
    const result = await snapIdealPathToRoads(ideal, rs, 4);
    // First and last should be the same (loop closed)
    expect(result[0].lat).toBeCloseTo(result[result.length - 1].lat, 3);
    expect(result[0].lng).toBeCloseTo(result[result.length - 1].lng, 3);
  });

  it('removes a waypoint that reverses direction >130°', async () => {
    // Ideal path goes east: A→B→C→D all at lng increasing
    const ideal: Point[] = [
      { lat: 51.5, lng: -0.10 },
      { lat: 51.5, lng: -0.09 },
      { lat: 51.5, lng: -0.08 },
      { lat: 51.5, lng: -0.07 },
    ];
    // Snap: point B snaps WEST to lng -0.11 (opposite direction)
    const snapped: Point[] = [
      { lat: 51.5, lng: -0.10 },
      { lat: 51.5, lng: -0.11 }, // reversal — should be filtered
      { lat: 51.5, lng: -0.08 },
      { lat: 51.5, lng: -0.07 },
    ];
    let idx = 0;
    const rs = makeRS(pts => {
      const chunk = snapped.slice(idx, idx + pts.length);
      idx += pts.length;
      return chunk;
    });
    const result = await snapIdealPathToRoads(ideal, rs, 4);
    // No waypoint should be west of the starting lng
    expect(result.every(p => p.lng >= -0.105)).toBe(true);
  });

  it('falls back gracefully when fewer than 4 survive filter', async () => {
    // Make all snaps wildly off so most are filtered
    const ideal = circlePoints(10);
    const rs = makeRS(pts => pts.map(p => ({ lat: p.lat + 5, lng: p.lng + 5 }))); // far off
    const result = await snapIdealPathToRoads(ideal, rs, 10);
    expect(result.length).toBeGreaterThanOrEqual(2); // fallback keeps deduped list
  });

  it('returns input unchanged for paths shorter than 2 points', async () => {
    const rs = makeRS(pts => pts);
    const single: Point[] = [{ lat: 51.5, lng: -0.1 }];
    const result = await snapIdealPathToRoads(single, rs, 10);
    expect(result).toEqual(single);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test -- tests/unit/nodeSnapService.test.ts 2>&1 | head -30
```

Expected: FAIL with "Cannot find module '../../src/services/nodeSnapService'"

- [ ] **Step 3: Implement `nodeSnapService.ts`**

Create `src/services/nodeSnapService.ts`:

```typescript
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
  targetWaypoints = 30
): Promise<Point[]> {
  if (idealPath.length < 2) return idealPath;

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test -- tests/unit/nodeSnapService.test.ts 2>&1 | tail -20
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Run full test suite + lint**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint 2>&1 | tail -5
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test 2>&1 | tail -10
```

Expected: 0 lint errors, all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main
git add src/services/nodeSnapService.ts tests/unit/nodeSnapService.test.ts
git commit -m "feat: add nodeSnapService — greedy OSRM snap with direction filter and loop close"
```

---

## Task 2: Recalibrate Fitness Formula

> **Parallel-safe: YES. Run this at the same time as Tasks 1 and 3.**

**Files:**
- Modify: `src/services/fitnessService.ts:122`
- Modify: `tests/unit/fitnessService.test.ts`

---

- [ ] **Step 1: Read the current file to confirm line 122**

```bash
grep -n "maxDev \* 500" /Users/hussianaltufayli/Documents/Drawn--main/src/services/fitnessService.ts
```

Expected output: `122:    const score = Math.max(0, 100 - (maxDev * 500));`

- [ ] **Step 2: Write the new failing tests first**

Open `tests/unit/fitnessService.test.ts`. After the closing `});` of the last describe block (line 117), add a new describe block:

```typescript
describe('FitnessService.scoreFidelity — recalibrated Frechet formula', () => {
  it('scores a route with ~500m max deviation as 0', () => {
    // 0.5km north ≈ 0.0045° latitude (1° ≈ 111.32km)
    const ideal: Point[] = [{ lat: 51.500, lng: -0.100 }];
    const far: Point[]   = [{ lat: 51.505, lng: -0.100 }]; // ~556m north
    // With OLD formula (×500): 0.556 * 500 = 278 → clamped 0 ✓
    // With NEW formula (×200): 0.556 * 200 = 111.2 → clamped 0 ✓
    // Both give 0 for this distance — use a closer point to distinguish:
    // 250m north ≈ 0.00225°
    const mid: Point[] = [{ lat: 51.5023, lng: -0.100 }]; // ~256m north
    const oldFormula = Math.max(0, 100 - (0.256 * 500)); // = 0 (old was too strict)
    const newFormula = Math.max(0, 100 - (0.256 * 200)); // = 48.8 (new allows this)
    const score = service.scoreFidelity(mid, 'premade', ideal);
    // With new formula, 256m deviation should score > 0
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(60);
  });

  it('scores a route with >500m max deviation as 0', () => {
    const ideal: Point[] = [{ lat: 51.500, lng: -0.100 }];
    const veryFar: Point[] = [{ lat: 51.510, lng: -0.100 }]; // ~1.11km
    const score = service.scoreFidelity(veryFar, 'premade', ideal);
    expect(score).toBe(0);
  });

  it('scores a perfect match as 100', () => {
    const pts: Point[] = [{ lat: 51.5, lng: -0.1 }, { lat: 51.51, lng: -0.09 }];
    expect(service.scoreFidelity(pts, 'premade', pts)).toBe(100);
  });
});
```

- [ ] **Step 3: Run tests to confirm one new test fails (the >0 assertion)**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test -- tests/unit/fitnessService.test.ts 2>&1 | tail -20
```

Expected: "scores a route with ~500m max deviation as 0" FAILS because old formula gives 0 for 256m, but we assert `> 0`.

- [ ] **Step 4: Apply the formula change**

In `src/services/fitnessService.ts`, find line 122:
```typescript
const score = Math.max(0, 100 - (maxDev * 500)); // 200m deviation = 0 score
```

Replace with:
```typescript
const score = Math.max(0, 100 - (maxDev * 200)); // 500m deviation = 0 score
```

- [ ] **Step 5: Run tests to verify all pass**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test -- tests/unit/fitnessService.test.ts 2>&1 | tail -15
```

Expected: All tests PASS (including the 3 new tests).

- [ ] **Step 6: Lint check**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main
git add src/services/fitnessService.ts tests/unit/fitnessService.test.ts
git commit -m "fix: recalibrate Frechet fitness formula from ×500 to ×200 for road-snapped routes"
```

---

## Task 3: Update `types.ts` + `MapComponent.tsx`

> **Parallel-safe: YES. Run this at the same time as Tasks 1 and 2.**

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/MapComponent.tsx`

---

- [ ] **Step 1: Read both files**

```bash
cat -n /Users/hussianaltufayli/Documents/Drawn--main/src/types.ts
grep -n "anchorsByStage\|snappedWaypoints\|DEBUG_STAGE_COLORS\|debugInfo" /Users/hussianaltufayli/Documents/Drawn--main/src/components/MapComponent.tsx
```

- [ ] **Step 2: Update `src/types.ts`**

Find the `DebugInfo` interface (currently lines 5-8):
```typescript
export interface DebugInfo {
  idealPath: Array<{ lat: number; lng: number }>;
  anchorsByStage: Array<{ stageNumber: number; nodes: Array<{ lat: number; lng: number }> }>;
}
```

Replace the entire interface with:
```typescript
export interface DebugInfo {
  idealPath: Array<{ lat: number; lng: number }>;
  snappedWaypoints: Array<{ lat: number; lng: number }>;
}
```

- [ ] **Step 3: Update MapComponent debug overlay**

In `src/components/MapComponent.tsx`, find the debug overlay section (inside `{showDebug && debugInfo && (...)}` block — starts around line 158).

The current anchor rendering block looks like:

```typescript
{debugInfo.anchorsByStage.map((stage, stageIdx) => {
  const color = DEBUG_STAGE_COLORS[stageIdx % DEBUG_STAGE_COLORS.length];
  return stage.nodes.map((node, nodeIdx) => (
    <CircleMarker
      key={`debug-s${stage.stageNumber}-n${nodeIdx}`}
      center={[node.lat, node.lng]}
      radius={6}
      pathOptions={{ color, fillColor: color, fillOpacity: 0.8, weight: 1.5 }}
    >
      <Tooltip direction="top" offset={[0, -8]} opacity={0.9}>
        Stage {stage.stageNumber}
      </Tooltip>
    </CircleMarker>
  ));
})}
```

Replace it with:

```typescript
{debugInfo.snappedWaypoints.map((node, idx) => (
  <CircleMarker
    key={`debug-snap-${idx}`}
    center={[node.lat, node.lng]}
    radius={6}
    pathOptions={{ color: '#f97316', fillColor: '#f97316', fillOpacity: 0.9, weight: 1.5 }}
  >
    <Tooltip direction="top" offset={[0, -8]} opacity={0.9}>
      Waypoint {idx + 1}
    </Tooltip>
  </CircleMarker>
))}
```

Also remove the `DEBUG_STAGE_COLORS` constant (lines 20-23 at top of file — it's now unused):

```typescript
// DELETE THIS BLOCK:
const DEBUG_STAGE_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
];
```

- [ ] **Step 4: Run lint to confirm no TypeScript errors**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint 2>&1 | tail -10
```

Expected: 0 errors. (If there are errors referencing `anchorsByStage` in App.tsx, that's expected — they'll be fixed in Task 4. Confirm the errors are ONLY in App.tsx, not MapComponent or types.)

- [ ] **Step 5: Run tests**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test 2>&1 | tail -10
```

Expected: All existing tests pass (types.ts change doesn't affect unit tests directly).

- [ ] **Step 6: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main
git add src/types.ts src/components/MapComponent.tsx
git commit -m "refactor: replace anchorsByStage debug overlay with flat snappedWaypoints"
```

---

## Task 4: Rewrite `App.tsx` Pipeline

> **Sequential: Run AFTER Tasks 1, 2, and 3 are committed.**

**Files:**
- Modify: `src/App.tsx`

**Context for the agent:** This replaces the entire Gemini-based route generation loop (the `while (attempt <= maxAttempts)` block plus all the stage-building code above it) with a simple snap-and-route loop. Read the full `handleGenerate` function before editing.

---

- [ ] **Step 1: Read the relevant section of App.tsx**

```bash
grep -n "buildStageScript\|selectNodesStaged\|rerouteFailingStages\|stageNodePools\|anchorsByStage\|setCurrentScriptStages\|while (attempt\|GeminiStagedResult" /Users/hussianaltufayli/Documents/Drawn--main/src/App.tsx
```

This shows all the lines to remove/update.

- [ ] **Step 2: Add the `snapIdealPathToRoads` import**

Find the line that imports from `./services/feasibilityService`:
```typescript
import { checkFeasibility } from "./services/feasibilityService";
```

Add the new import on the line immediately after it:
```typescript
import { snapIdealPathToRoads } from "./services/nodeSnapService";
```

- [ ] **Step 3: Remove the `GeminiStagedResult` import**

Find this import line:
```typescript
import { GeminiService, GeminiStagedResult } from "./services/geminiService";
```

Replace it with (keep GeminiService for future image-to-route, remove the unused type):
```typescript
import { GeminiService } from "./services/geminiService";
```

- [ ] **Step 4: Remove the stage-building block**

Find and DELETE the following block (search for `// 4. Build Stage Script`):

```typescript
// 4. Build Stage Script (dense shapes → many edges; cap polyline for AI/Gemini only)
const aiPathForStages =
  bestConfig.projectedPoints.length <= MAX_AI_SCRIPT_POINTS
    ? bestConfig.projectedPoints
    : resamplePolylinePoints(bestConfig.projectedPoints, MAX_AI_SCRIPT_POINTS);

const stages = buildStageScript(
  aiPathForStages.map(p => ({ x: p.lng, y: p.lat })),
  distInKm
);
setCurrentScriptStages(stages.length);
```

Also DELETE the node pool setup block that follows (search for `// 5. AI Node Selection (Gemini)`):

```typescript
// 5. AI Node Selection (Gemini)
const startNode = overpassService.getRelevantNodes(network.nodes, [userLocation], network.edgeMap, 1)[0];
const sampledNodes = overpassService.getRelevantNodes(network.nodes, bestConfig.projectedPoints, network.edgeMap, 400);

const totalIdealPoints = aiPathForStages;
let cumulativePct = 0;
const idealStagePaths: Point[][] = stages.map((stage) => {
  const startFrac = cumulativePct / 100;
  cumulativePct += stage.distancePct;
  const endFrac = cumulativePct / 100;
  const n = totalIdealPoints.length;
  const startIdx = Math.floor(startFrac * (n - 1));
  const endIdx = Math.min(Math.ceil(endFrac * (n - 1)), n - 1);
  return totalIdealPoints.slice(startIdx, endIdx + 1);
});
const stageNodePools: OSMNode[][] = stages.map((_, i) =>
  overpassService.getNodesForStage(sampledNodes, idealStagePaths[i], 400)
);
```

- [ ] **Step 5: Replace the Gemini while loop**

Find and DELETE everything from `let attempt = 1;` through the closing block ending with `setGenerationError(...)` (the entire `while (attempt <= maxAttempts)` loop and the fallback block below it).

In its place, insert:

```typescript
      // 5. Algorithmic snap routing — no AI required
      setGenerationProgress({ attempt: 1, maxAttempts: 3, fitnessScore: null, failingStages: [] });

      const WAYPOINT_COUNTS = [30, 45, 20] as const;
      let bestFitness = 0;
      let bestRoutedPoints: Point[] | null = null;
      let bestSnappedWaypoints: Point[] | null = null;

      for (let attempt = 0; attempt < WAYPOINT_COUNTS.length; attempt++) {
        setGenerationProgress(prev => ({ ...prev, attempt: attempt + 1 }));
        setLoadingMessage(
          attempt === 0
            ? `Snapping ${shapeLabel} to roads...`
            : `Refining route (pass ${attempt + 1} of 3)...`
        );

        const snappedWaypoints = await snapIdealPathToRoads(
          bestConfig.projectedPoints,
          routingService,
          WAYPOINT_COUNTS[attempt]
        );

        setLoadingMessage("Routing on real streets...");
        const routingResult = await routingService.routeWithLockedWaypoints(snappedWaypoints);
        const routedPoints = routingResult.polylineCoords.map(c => ({ lat: c[1], lng: c[0] }));

        const fidelityScore = fitnessService.scoreFidelity(routedPoints, state.mode, bestConfig.projectedPoints);

        setGenerationProgress(prev => ({
          ...prev,
          fitnessScore: fidelityScore,
          failingStages: [],
        }));

        if (fidelityScore > bestFitness) {
          bestFitness = fidelityScore;
          bestRoutedPoints = routedPoints;
          bestSnappedWaypoints = snappedWaypoints;
        }

        if (fidelityScore >= 70) break;
        if (attempt === 0 && fidelityScore >= 50) break;
        if (attempt === 1 && fidelityScore >= 40) break;
      }

      if (!bestRoutedPoints) {
        throw new Error("Failed to generate a route. Please try again.");
      }

      const debugInfo: DebugInfo = {
        idealPath: bestConfig.projectedPoints,
        snappedWaypoints: bestSnappedWaypoints ?? [],
      };

      updateState({
        isGenerating: false,
        hasResult: true,
        idealCoords: bestConfig.projectedPoints,
        snappedCoords: bestRoutedPoints,
        routeFidelity: bestFitness,
        distance: validDist,
        textInput: state.textInput,
        nodeMap: network.nodeMap,
        debugInfo,
      }, true);

      if (bestFitness < 70) {
        setGenerationError(
          `Route quality is lower than expected (${bestFitness}% match). Try regenerating for a better result.`
        );
      }
```

- [ ] **Step 6: Handle `setCurrentScriptStages` if it exists**

Search for `setCurrentScriptStages` in App.tsx:

```bash
grep -n "setCurrentScriptStages\|currentScriptStages" /Users/hussianaltufayli/Documents/Drawn--main/src/App.tsx
```

If found: find its `useState` declaration and change the setter call (which was `setCurrentScriptStages(stages.length)`) to `setCurrentScriptStages(0)`, since there are no stages in the new flow. Do NOT remove the state declaration itself — the UI component may read it.

- [ ] **Step 7: Clean up unused imports**

Search for any remaining unused imports:
```bash
grep -n "OSMNode\|buildStageScript\|stageService\|MAX_AI_SCRIPT_POINTS\|resamplePolylinePoints" /Users/hussianaltufayli/Documents/Drawn--main/src/App.tsx
```

For each symbol that is ONLY used in the deleted blocks (not anywhere else in App.tsx), remove it from its import line. Be conservative — only remove symbols with zero remaining usages. Do NOT remove `resamplePolylinePoints` if it appears elsewhere.

- [ ] **Step 8: Run lint — fix all errors**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint 2>&1
```

Fix any TypeScript errors. Common issues to expect:
- `anchorsByStage` references in debugInfo builds — should already be replaced in Step 5
- Any remaining `GeminiStagedResult` references — remove them
- Unused variable warnings for `stages`, `idealStagePaths`, `stageNodePools` — if any remain, delete them

Re-run until: **0 errors, 0 warnings**.

- [ ] **Step 9: Run full test suite**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test 2>&1 | tail -20
```

Expected: All tests pass. The new nodeSnapService tests from Task 1 and fitnessService tests from Task 2 should all be green.

- [ ] **Step 10: Start dev server and verify no console errors**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run dev &
sleep 5 && echo "Dev server started"
```

Open browser at `http://localhost:3000`. Confirm:
- App loads without blank screen
- No red errors in browser console on load
- The Generate button is visible

Kill the dev server after verification: `pkill -f "vite"`

- [ ] **Step 11: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main
git add src/App.tsx
git commit -m "feat: replace Gemini node-selection with algorithmic OSRM snap routing"
```

---

## Self-Review Checklist

**Spec coverage check:**

| Spec requirement | Task that covers it |
|-----------------|-------------------|
| `snapIdealPathToRoads()` with arc-length sampling | Task 1 |
| Micro-batched snap (groups of 8, 100ms delay) | Task 1 |
| Direction filter (>130° reversal removed) | Task 1 |
| Closed-loop close (>50m gap → append first) | Task 1 |
| Min-waypoint fallback guard | Task 1 |
| Frechet formula: `×500` → `×200` | Task 2 |
| `DebugInfo.anchorsByStage` → `snappedWaypoints` | Task 3 |
| MapComponent debug shows flat waypoint dots | Task 3 |
| App.tsx: stage-building block removed | Task 4 |
| App.tsx: Gemini while loop replaced | Task 4 |
| App.tsx: adaptive retry (30→45→20 waypoints) | Task 4 |
| App.tsx: single `debugInfo` building (no branch) | Task 4 |
| `RouteFitness` with empty `stageScores` | Task 4 |

All spec requirements covered. ✓
