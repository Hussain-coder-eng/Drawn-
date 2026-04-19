# Route Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated routes visually recognizable as their intended shape by fixing broken fitness scoring, filtering nodes per stage, and giving Gemini precise geometric context.

**Architecture:** Five targeted changes across four files — no new services, no new dependencies. The pipeline structure (one Gemini call → OSRM routing → fitness → retry) stays the same. Changes are: (1) fix fitness bug, (2) add per-stage node filter, (3) build stage pools in App.tsx, (4) restructure Gemini prompt, (5) smarter reroute with spatial deviation.

**Tech Stack:** TypeScript, React, turf.js, Gemini API (`@google/genai`), Vitest

---

## File Map

| File | Changes |
|------|---------|
| `src/services/fitnessService.ts` | Delete `scoreFitness` + `extractStagesFromPolyline`; add `scoreFidelity`; lower thresholds |
| `src/services/overpassService.ts` | Add `getNodesForStage` method |
| `src/services/geminiService.ts` | Restructure `selectNodesStaged` prompt + signature; add `computeStageSpatialDeviation`; update `rerouteFailingStages` |
| `src/App.tsx` | Build `stageNodePools` + `idealStagePaths`; replace `scoreFitness` call; update Gemini call sites |
| `src/tests/unit/fitnessService.test.ts` | Add `scoreFidelity` tests; update imports |
| `src/tests/unit/overpassService.test.ts` | Add `getNodesForStage` tests (create if not exists) |

---

## Task 1: Fix Fitness Scoring — fitnessService.ts

**Files:**
- Modify: `src/services/fitnessService.ts`
- Test: `src/tests/unit/fitnessService.test.ts`

- [ ] **Step 1: Write failing tests for `scoreFidelity`**

Open `src/tests/unit/fitnessService.test.ts` and add at the end of the file (before the closing `}`):

```typescript
describe('scoreFidelity', () => {
  it('returns a number for premade mode', () => {
    const ideal: Point[] = [
      { lat: 51.5, lng: -0.1 }, { lat: 51.51, lng: -0.09 }, { lat: 51.52, lng: -0.1 }
    ];
    const routed: Point[] = [
      { lat: 51.5005, lng: -0.1005 }, { lat: 51.5105, lng: -0.0905 }, { lat: 51.5205, lng: -0.1005 }
    ];
    const score = service.scoreFidelity(routed, 'premade', ideal);
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('returns 50 for text mode (no geometric target)', () => {
    const ideal: Point[] = [{ lat: 51.5, lng: -0.1 }, { lat: 51.51, lng: -0.09 }];
    const routed: Point[] = [{ lat: 51.5, lng: -0.1 }, { lat: 51.51, lng: -0.09 }];
    expect(service.scoreFidelity(routed, 'text', ideal)).toBe(50);
  });

  it('scores higher when routed path closely matches ideal', () => {
    const ideal: Point[] = [
      { lat: 51.5, lng: -0.1 }, { lat: 51.505, lng: -0.095 }, { lat: 51.51, lng: -0.09 }
    ];
    const closeRoute: Point[] = [
      { lat: 51.5001, lng: -0.1001 }, { lat: 51.5051, lng: -0.0951 }, { lat: 51.5101, lng: -0.0901 }
    ];
    const farRoute: Point[] = [
      { lat: 51.52, lng: -0.08 }, { lat: 51.53, lng: -0.07 }, { lat: 51.54, lng: -0.06 }
    ];
    expect(service.scoreFidelity(closeRoute, 'premade', ideal)).toBeGreaterThan(
      service.scoreFidelity(farRoute, 'premade', ideal)
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm test -- --reporter=verbose 2>&1 | grep -A 3 "scoreFidelity"
```

Expected: `scoreFidelity is not a function` or similar error.

- [ ] **Step 3: Add `scoreFidelity` and update thresholds in fitnessService.ts**

In `src/services/fitnessService.ts`:

**3a.** Replace `scoreFitness` and `extractStagesFromPolyline` with `scoreFidelity`. Find and delete the entire `scoreFitness` method (lines ~33–59) and the entire `extractStagesFromPolyline` method (lines ~128–135).

**3b.** Add `scoreFidelity` as a new public method right after the `scoreRoute` method closing brace:

```typescript
  scoreFidelity(routedPoints: Point[], mode: string, idealPoints: Point[]): number {
    if (mode === 'premade') {
      return this.calculateFrechetFidelity(idealPoints, routedPoints);
    } else if (mode === 'draw') {
      return this.calculateDTWFidelity(idealPoints, routedPoints);
    }
    return 50; // text mode — no geometric fidelity target
  }
```

**3c.** In `scoreRoute`, update both threshold lines:

```typescript
// BEFORE:
    return {
      overallFitness,
      stageScores,
      failingStages: stageScores.filter(s => s.overallStageScore < 75),
      passed: overallFitness >= 90
    };

// AFTER:
    return {
      overallFitness,
      stageScores,
      failingStages: stageScores.filter(s => s.overallStageScore < 60),
      passed: overallFitness >= 70
    };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm test -- --reporter=verbose 2>&1 | grep -A 3 "scoreFidelity"
```

Expected: all three `scoreFidelity` tests pass.

- [ ] **Step 5: Update App.tsx to use the new scoring**

In `src/App.tsx`, find the `scoreFitness` call (around line 483) and replace it:

```typescript
// BEFORE:
        fitness = fitnessService.scoreFitness(
          routedPoints,
          state.mode as any,
          bestConfig.projectedPoints,
          aiStages,
          network.nodeMap,
          distInKm
        );

// AFTER:
        const stageScore = fitnessService.scoreRoute(result.stages, aiStages, network.nodeMap, distInKm);
        const fidelityScore = fitnessService.scoreFidelity(routedPoints, state.mode, bestConfig.projectedPoints);
        const overallFitness = Math.round((stageScore.overallFitness * 0.6) + (fidelityScore * 0.4));
        fitness = {
          ...stageScore,
          overallFitness,
          passed: overallFitness >= 70
        };
```

- [ ] **Step 6: Lint**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint
```

Expected: no errors. If `scoreFitness` is still imported somewhere, remove it.

- [ ] **Step 7: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && git add src/services/fitnessService.ts src/App.tsx src/tests/unit/fitnessService.test.ts && git commit -m "fix: replace broken scoreFitness with direct scoreRoute+scoreFidelity blend; lower pass threshold to 70"
```

---

## Task 2: Add Per-Stage Node Filtering — overpassService.ts

**Files:**
- Modify: `src/services/overpassService.ts`

- [ ] **Step 1: Write failing test for `getNodesForStage`**

Create `src/tests/unit/overpassService.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { OverpassService } from '../../services/overpassService';
import { OSMNode } from '../../services/overpassService';
import { Point } from '../../lib/shapeMath';

const service = new OverpassService();

function makeNode(id: number, lat: number, lng: number): OSMNode {
  return { id, lat, lng };
}

describe('getNodesForStage', () => {
  it('returns nodes within the bounding corridor', () => {
    const stagePath: Point[] = [
      { lat: 51.50, lng: -0.10 },
      { lat: 51.51, lng: -0.09 }
    ];
    const nodes: OSMNode[] = [
      makeNode(1, 51.505, -0.095),  // inside corridor
      makeNode(2, 51.505, -0.096),  // inside corridor
      makeNode(3, 51.60, -0.20),    // far outside
      makeNode(4, 51.61, -0.21),    // far outside
    ];
    const result = service.getNodesForStage(nodes, stagePath, 400);
    expect(result.some(n => n.id === 1)).toBe(true);
    expect(result.some(n => n.id === 2)).toBe(true);
    expect(result.some(n => n.id === 3)).toBe(false);
    expect(result.some(n => n.id === 4)).toBe(false);
  });

  it('falls back to 20 nearest when fewer than 8 nodes in bounds', () => {
    const stagePath: Point[] = [
      { lat: 51.50, lng: -0.10 },
      { lat: 51.51, lng: -0.09 }
    ];
    // Only 2 nodes in bounds — triggers fallback
    const nodes: OSMNode[] = Array.from({ length: 30 }, (_, i) => 
      makeNode(i + 1, 51.50 + i * 0.001, -0.10 + i * 0.001)
    );
    const result = service.getNodesForStage(nodes, stagePath, 50); // tiny buffer → few in bounds
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty-safe result for empty stagePath', () => {
    const result = service.getNodesForStage([makeNode(1, 51.5, -0.1)], [], 400);
    expect(Array.isArray(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm test -- --reporter=verbose 2>&1 | grep -A 3 "getNodesForStage"
```

Expected: `getNodesForStage is not a function`.

- [ ] **Step 3: Add `getNodesForStage` to overpassService.ts**

In `src/services/overpassService.ts`, add the following method just before the closing `}` of the class (after `getRelevantNodes`):

```typescript
  /**
   * Returns nodes within a spatial bounding corridor around a stage's ideal sub-path.
   * If fewer than 8 nodes are found, falls back to the 20 nearest to the stage midpoint.
   */
  getNodesForStage(
    allNodes: OSMNode[],
    stagePath: Point[],
    bufferMeters: number = 400
  ): OSMNode[] {
    const validPath = stagePath.filter(
      p => typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng)
    );
    if (validPath.length < 2) return allNodes.slice(0, 20);

    // Convert buffer to approximate degrees (1 degree ≈ 111km)
    const bufferDeg = bufferMeters / 111000;

    const lats = validPath.map(p => p.lat);
    const lngs = validPath.map(p => p.lng);
    const minLat = Math.min(...lats) - bufferDeg;
    const maxLat = Math.max(...lats) + bufferDeg;
    const minLng = Math.min(...lngs) - bufferDeg;
    const maxLng = Math.max(...lngs) + bufferDeg;

    const inBounds = allNodes.filter(n =>
      typeof n.lat === 'number' && typeof n.lng === 'number' &&
      !isNaN(n.lat) && !isNaN(n.lng) &&
      n.lat >= minLat && n.lat <= maxLat &&
      n.lng >= minLng && n.lng <= maxLng
    );

    if (inBounds.length >= 8) return inBounds;

    // Fallback: 20 nearest nodes to stage midpoint
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const midPt = turf.point([midLng, midLat]);

    return [...allNodes]
      .filter(n =>
        typeof n.lat === 'number' && typeof n.lng === 'number' && !isNaN(n.lat) && !isNaN(n.lng)
      )
      .sort((a, b) =>
        turf.distance(midPt, turf.point([a.lng, a.lat])) -
        turf.distance(midPt, turf.point([b.lng, b.lat]))
      )
      .slice(0, 20);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm test -- --reporter=verbose 2>&1 | grep -A 3 "getNodesForStage"
```

Expected: all three tests pass.

- [ ] **Step 5: Lint**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && git add src/services/overpassService.ts src/tests/unit/overpassService.test.ts && git commit -m "feat: add getNodesForStage — per-stage spatial corridor node filtering"
```

---

## Task 3: Build Stage Pools in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add stage pool + ideal path computation after the stage script build**

In `src/App.tsx`, find the block that builds `stages` and `sampledNodes` (around lines 426–431):

```typescript
      // 4. Build Stage Script
      const stages = buildStageScript(bestConfig.projectedPoints.map(p => ({ x: p.lng, y: p.lat })), distInKm);
      setCurrentScriptStages(stages.length);

      // 5. AI Node Selection (Gemini)
      const startNode = overpassService.getRelevantNodes(network.nodes, [userLocation], network.edgeMap, 1)[0];
      const sampledNodes = overpassService.getRelevantNodes(network.nodes, bestConfig.projectedPoints, network.edgeMap, 400);
```

Replace with:

```typescript
      // 4. Build Stage Script
      const stages = buildStageScript(bestConfig.projectedPoints.map(p => ({ x: p.lng, y: p.lat })), distInKm);
      setCurrentScriptStages(stages.length);

      // 5. AI Node Selection (Gemini)
      const startNode = overpassService.getRelevantNodes(network.nodes, [userLocation], network.edgeMap, 1)[0];
      const sampledNodes = overpassService.getRelevantNodes(network.nodes, bestConfig.projectedPoints, network.edgeMap, 400);

      // Build per-stage node pools and ideal sub-paths
      const totalIdealPoints = bestConfig.projectedPoints;
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
      const stageNodePools: OSMNode[] = stages.map((_, i) =>
        overpassService.getNodesForStage(sampledNodes, idealStagePaths[i], 400)
      );
```

- [ ] **Step 2: Add the OSMNode import if not already present**

At the top of `src/App.tsx`, check for the `overpassService` import line. It should already exist. Check if `OSMNode` is imported:

```typescript
import { OverpassService, OSMNode } from "./services/overpassService";
```

If `OSMNode` is missing from the import, add it.

- [ ] **Step 3: Lint**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint
```

Expected: no errors. Fix any unused variable warnings.

- [ ] **Step 4: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && git add src/App.tsx && git commit -m "feat: build per-stage node pools and ideal sub-paths before Gemini call"
```

---

## Task 4: Restructure Gemini Initial Prompt — geminiService.ts

**Files:**
- Modify: `src/services/geminiService.ts`

- [ ] **Step 1: Add `samplePoints` private helper and update `selectNodesStaged` signature**

In `src/services/geminiService.ts`, add a private helper just before the `selectNodesStaged` method:

```typescript
  private samplePoints(points: Point[], n: number): Point[] {
    if (points.length === 0) return [];
    if (points.length <= n) return points;
    const step = (points.length - 1) / (n - 1);
    return Array.from({ length: n }, (_, i) => points[Math.round(i * step)]);
  }
```

- [ ] **Step 2: Update `selectNodesStaged` signature**

Change the method signature from:

```typescript
  async selectNodesStaged(
    nodes: OSMNode[],
    script: RouteStage[],
    shapeName: string,
    distanceKm: number,
    startNodeId: number,
    onProgress?: (msg: string) => void
  ): Promise<GeminiStagedResult> {
```

To:

```typescript
  async selectNodesStaged(
    stageNodePools: OSMNode[][],
    script: RouteStage[],
    shapeName: string,
    distanceKm: number,
    startNodeId: number,
    idealPath: Point[],
    idealStagePaths: Point[][],
    onProgress?: (msg: string) => void
  ): Promise<GeminiStagedResult> {
```

- [ ] **Step 3: Update cache key and flat node derivation**

Inside `selectNodesStaged`, find the cache key and node listing logic. Replace it:

```typescript
    // Cache key
    const cacheKey = JSON.stringify({ shapeName, distanceKm, startNodeId, script: script.map(s => s.stage) });
    if (this.cache.has(cacheKey)) {
      console.log("[DEBUG] Returning cached Gemini result");
      return this.cache.get(cacheKey)!;
    }
```

This part stays the same — the cache key is unchanged.

Now find the node mapping section (previously `nodes.map((n, i) => ...)`). Replace the entire block that builds `idToIndex`, `indexToId`, and `nodesForAI`:

```typescript
    // Build a global index map across all stage pools (deduplicating shared nodes)
    const idToIndex = new Map<number, string>();
    const indexToId = new Map<string, number>();
    const allUniqueNodes = new Map<number, OSMNode>();
    stageNodePools.forEach(pool => pool.forEach(n => allUniqueNodes.set(n.id, n)));
    let globalIdx = 1;
    for (const [, node] of allUniqueNodes) {
      const strIdx = String(globalIdx);
      idToIndex.set(node.id, strIdx);
      indexToId.set(strIdx, node.id);
      globalIdx++;
    }

    const aiStartNodeIndex = idToIndex.get(startNodeId) || "1";

    const stageDistances = script.map(s => ({
      ...s,
      targetDistanceKm: (s.distancePct / 100) * distanceKm
    }));
```

- [ ] **Step 4: Replace the prompt string**

Find the `const prompt = \`` block and replace it entirely:

```typescript
    // Sample 10 points from ideal path for shape reference
    const idealPathSample = this.samplePoints(idealPath, 10);
    const idealPathStr = idealPathSample
      .map(p => `[${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}]`)
      .join(' → ');

    // Build per-stage blocks
    const stageBlocks = stageDistances.map((s, i) => {
      const pool = stageNodePools[i] || [];
      const idealSubPath = idealStagePaths[i] || [];
      const idealSubSampled = this.samplePoints(idealSubPath, 3);
      const idealSubStr = idealSubSampled
        .map(p => `[${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}]`)
        .join(' → ');
      const nodesStr = pool
        .map(n => {
          const nodeIdx = idToIndex.get(n.id) || '?';
          return `${nodeIdx}: ${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}`;
        })
        .join('\n');
      return `=== STAGE ${s.stage}: Move ${s.direction}, target ${s.targetDistanceKm.toFixed(2)}km ===\nIdeal path for this stage: ${idealSubStr}\nAvailable nodes (ID: lat, lng):\n${nodesStr}`;
    }).join('\n\n');

    const prompt = `You are drawing a ${shapeName}. The ideal shape passes through these reference points:
${idealPathStr}

Execute each stage below. Use ONLY nodes from that stage's node list.

${stageBlocks}

Preferred start node ID: ${aiStartNodeIndex}
`;
```

- [ ] **Step 5: Update the cache-set call to use `indexToId`**

Verify the bottom of the method still uses `indexToId` for mapping back to OSM IDs — it should be unchanged from before (the same `indexToId` map is still populated).

- [ ] **Step 6: Update call site in App.tsx**

In `src/App.tsx`, find the `geminiService.selectNodesStaged` call (attempt === 1 branch) and update it:

```typescript
// BEFORE:
          result = await geminiService.selectNodesStaged(
            sampledNodes,
            aiStages,
            shapeLabel,
            distInKm,
            startNode.id,
            (msg) => setLoadingMessage(msg)
          );

// AFTER:
          result = await geminiService.selectNodesStaged(
            stageNodePools,
            aiStages,
            shapeLabel,
            distInKm,
            startNode.id,
            bestConfig.projectedPoints,
            idealStagePaths,
            (msg) => setLoadingMessage(msg)
          );
```

- [ ] **Step 7: Lint**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && git add src/services/geminiService.ts src/App.tsx && git commit -m "feat: restructure Gemini prompt with per-stage node pools and ideal path reference"
```

---

## Task 5: Smarter Reroute with Spatial Deviation — geminiService.ts + App.tsx

**Files:**
- Modify: `src/services/geminiService.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `computeStageSpatialDeviation` private helper to geminiService.ts**

Add this private method after `samplePoints`:

```typescript
  private computeStageSpatialDeviation(
    failingStage: StageScore,
    geminiResult: GeminiStagedResult,
    idealStagePath: Point[],
    nodeMap: Map<string, any>
  ): string {
    const stageData = geminiResult.stages.find(s => s.stageNumber === failingStage.stageNumber);
    if (!stageData || !stageData.nodeIds.length || !idealStagePath.length) return '';

    const selectedNodes = stageData.nodeIds
      .map((id: number) => nodeMap.get(String(id)))
      .filter(Boolean);
    if (selectedNodes.length === 0) return '';

    const actualLat = selectedNodes.reduce((s: number, n: any) => s + n.lat, 0) / selectedNodes.length;
    const actualLng = selectedNodes.reduce((s: number, n: any) => s + n.lng, 0) / selectedNodes.length;
    const idealLat = idealStagePath.reduce((s, p) => s + p.lat, 0) / idealStagePath.length;
    const idealLng = idealStagePath.reduce((s, p) => s + p.lng, 0) / idealStagePath.length;

    const actualPt = turf.point([actualLng, actualLat]);
    const idealPt = turf.point([idealLng, idealLat]);
    const distM = Math.round(turf.distance(actualPt, idealPt, { units: 'meters' }));
    const bearing = turf.bearing(idealPt, actualPt);
    const compassLabels = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
    const dirLabel = compassLabels[Math.round(((bearing + 360) % 360) / 45) % 8];

    return `Your selected nodes were centered at ${actualLat.toFixed(5)}, ${actualLng.toFixed(5)}\n` +
      `The ideal path for this stage centers at ${idealLat.toFixed(5)}, ${idealLng.toFixed(5)}\n` +
      `You are ~${distM}m ${dirLabel} of where you should be`;
  }
```

- [ ] **Step 2: Add `turf` import to geminiService.ts if missing**

Check the top of `src/services/geminiService.ts` for `import * as turf`. If missing, add:

```typescript
import * as turf from "@turf/turf";
```

- [ ] **Step 3: Update `rerouteFailingStages` signature**

Change the method signature from:

```typescript
  async rerouteFailingStages(
    previousResult: GeminiStagedResult,
    fitnessResult: RouteFitness,
    nodes: OSMNode[],
    script: RouteStage[],
    distanceKm: number,
    shapeName: string,
    onProgress?: (msg: string) => void
  ): Promise<GeminiStagedResult> {
```

To:

```typescript
  async rerouteFailingStages(
    previousResult: GeminiStagedResult,
    fitnessResult: RouteFitness,
    stageNodePools: OSMNode[][],
    script: RouteStage[],
    idealStagePaths: Point[][],
    distanceKm: number,
    shapeName: string,
    nodeMap: Map<string, any>,
    onProgress?: (msg: string) => void
  ): Promise<GeminiStagedResult> {
```

- [ ] **Step 4: Replace the node mapping and reroute prompt inside `rerouteFailingStages`**

Find and replace the block that builds `idToIndex`, `indexToId`, `nodesForAI`, and `reroutePrompt`:

```typescript
    // Rebuild global index map from stage pools (only failing stage pools needed)
    const idToIndex = new Map<number, string>();
    const indexToId = new Map<string, number>();
    const allUniqueNodes = new Map<number, OSMNode>();
    stageNodePools.forEach(pool => pool.forEach(n => allUniqueNodes.set(n.id, n)));
    let globalIdx = 1;
    for (const [, node] of allUniqueNodes) {
      const strIdx = String(globalIdx);
      idToIndex.set(node.id, strIdx);
      indexToId.set(strIdx, node.id);
      globalIdx++;
    }

    const failingStageNumbers = (fitnessResult.failingStages || []).map(s => s.stageNumber);

    const stageDistances = script.map(s => ({
      ...s,
      targetDistanceKm: (s.distancePct / 100) * distanceKm
    }));

    const stageBlocks = (fitnessResult.failingStages || []).map(s => {
      const stageIdx = s.stageNumber - 1;
      const scriptStage = script[stageIdx];
      const pool = stageNodePools[stageIdx] || [];
      const idealSubPath = idealStagePaths[stageIdx] || [];
      const targetDist = stageDistances[stageIdx]?.targetDistanceKm;
      const deviation = this.computeStageSpatialDeviation(s, previousResult, idealSubPath, nodeMap);
      const idealSubStr = this.samplePoints(idealSubPath, 3)
        .map(p => `[${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}]`)
        .join(' → ');
      const nodesStr = pool
        .map(n => {
          const nodeIdx = idToIndex.get(n.id) || '?';
          return `${nodeIdx}: ${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}`;
        })
        .join('\n');

      return `Stage ${s.stageNumber} failed (score: ${s.overallStageScore}/100):
- Direction: needed ${scriptStage?.direction || '?'}, direction score was ${s.directionScore}/100
- Distance: needed ~${targetDist?.toFixed(2) || '?'}km, distance score was ${s.distanceScore}/100
${deviation ? `- ${deviation}` : ''}
- Ideal sub-path to trace: ${idealSubStr}
- Available nodes (try nodes closer to the ideal path):
${nodesStr}`;
    }).join('\n\n');

    const reroutePrompt = `Your previous route attempt for ${shapeName} scored ${fitnessResult.overallFitness}/100.
The following stages failed and need to be replanned:

${stageBlocks}

Replan ONLY the failing stages listed above.
Return a JSON object with a "stages" array containing ONLY the replanned stages.
Each stage MUST have "stageNumber" and "nodeIds". Use ONLY node IDs from that stage's available nodes list.
`;
```

Remove the old `nodesForAI` and `reroutePrompt` variables entirely — they are fully replaced by the above.

Also remove the old `failingStageNumbers` usage in the prompt (it's now embedded in `stageBlocks`).

- [ ] **Step 5: Update the index mapping in the reroute result parsing**

The bottom of `rerouteFailingStages` already maps indices back via `indexToId`. Verify it still reads:

```typescript
          const realIds = s.nodeIds.map((idx: any) => indexToId.get(String(idx))).filter(Boolean);
```

This is unchanged — it still works because we rebuilt the same `indexToId` map above.

- [ ] **Step 6: Update call site in App.tsx**

In `src/App.tsx`, find the `geminiService.rerouteFailingStages` call (the `else if` branch) and update it:

```typescript
// BEFORE:
          result = await geminiService.rerouteFailingStages(
            result,
            fitness,
            sampledNodes,
            aiStages,
            distInKm,
            shapeLabel,
            (msg) => setLoadingMessage(msg)
          );

// AFTER:
          result = await geminiService.rerouteFailingStages(
            result,
            fitness,
            stageNodePools,
            aiStages,
            idealStagePaths,
            distInKm,
            shapeLabel,
            network.nodeMap,
            (msg) => setLoadingMessage(msg)
          );
```

- [ ] **Step 7: Lint**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint
```

Expected: no errors. Fix any `failingStageNumbers` unused variable warning (remove it if it remains).

- [ ] **Step 8: Run full test suite**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm test
```

Expected: all existing tests pass. New `getNodesForStage` and `scoreFidelity` tests pass.

- [ ] **Step 9: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && git add src/services/geminiService.ts src/App.tsx && git commit -m "feat: smarter reroute prompt with spatial deviation feedback and per-stage node pools"
```

---

## Task 6: Final Verification

**Files:** none (verification only)

- [ ] **Step 1: Run full lint + test suite**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint && npm test
```

Expected: lint passes with 0 errors. All tests pass.

- [ ] **Step 2: Start dev server and do a visual smoke test**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run dev
```

Open `http://localhost:3000`. Test one route from each category:

**Premade shape:** Select "Circle", set distance to 3km, click Generate. The route should visibly loop back near its starting point.

**Text:** Select Text mode, type "A", set distance to 2km, click Generate. The route should trace an A-like path (two legs up, crossbar).

**Freehand:** Draw a rough triangle on the canvas, click Generate. The route should follow the three sides.

If any category produces a wildly unrecognizable route, check the browser console for Gemini errors or fitness scores. A score ≥ 70 should accept the route; retry attempts should show improved spatial feedback in the console.

- [ ] **Step 3: Verify token usage is not higher than before**

In browser DevTools → Network tab, watch the Gemini request payload size. It should be similar to or smaller than pre-change (fewer nodes per stage compensates for added ideal path text).

- [ ] **Step 4: Final commit if any cleanup was done**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && git add -p && git commit -m "chore: route accuracy cleanup"
```

Only commit if there are actual changes. If clean, skip.
