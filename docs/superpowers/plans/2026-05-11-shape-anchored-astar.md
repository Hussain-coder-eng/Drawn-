# Shape-Anchored A* Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OSRM shortest-path segment routing with an on-graph A* search that minimizes `α·distance + β·perpendicular_deviation_from_ideal`, so routed polylines hug the intended shape instead of cutting shortcuts.

**Architecture:** Two new pure-TypeScript files: `graphService.ts` holds the A* algorithm and `graphRoutingService.ts` orchestrates it segment-by-segment with a per-segment OSRM fallback. `App.tsx` gets one import and one call swap. The existing `RoadNetwork.edgeMap` (already an undirected adjacency list built by the Overpass worker) is used as the graph with no additional construction.

**Tech Stack:** TypeScript, `@turf/turf` (already in project), Vitest (existing test runner), existing `RoutingService` (OSRM fallback), existing `OSMNode` / `RoadNetwork` types from `overpassService.ts`.

---

## Key Existing Facts (Do Not Reinvent)

- **`OSMNode`** type is `{ id: number; lat: number; lng: number }` — `id` is numeric.
- **`nodeMap`** is `Map<string, OSMNode>` — keys are `String(numericId)`.
- **`edgeMap`** is `Map<string, string[]>` — values are string node IDs matching nodeMap keys.
- **`turf.lineSliceAlong(line, startKm, endKm)`** exists and is already used in `routingService.ts:566`. Use it, do not reimplement arc-length slicing.
- **`RoutingService.routeWithLockedWaypoints`** returns `Promise<{ polylineCoords: [number, number][] }>`.
- **`Point`** type is `{ lat: number; lng: number }` from `src/lib/shapeMath.ts`.

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/services/graphService.ts` | **Create** | MinHeap, `findNearestGraphNode`, `aStarSegment`, cost constants |
| `src/tests/graphService.test.ts` | **Create** | Unit tests for both graphService and graphRoutingService |
| `src/services/graphRoutingService.ts` | **Create** | Segment-by-segment orchestrator, OSRM fallback |
| `src/App.tsx` | **Modify** | Add import + swap `routeWithLockedWaypoints` → `graphRouteShape` |

## Serialization

**Task 1 must be merged before Task 2 begins.** Tasks 2 and 3 can proceed in parallel once Task 1 is complete.

---

## Task 1: A* Core Algorithm (`graphService.ts` + Tests 1–4)

**Files:**
- Create: `src/services/graphService.ts`
- Create: `src/tests/graphService.test.ts`

- [ ] **Step 1: Create the test file with Tests 1–4 (all will fail — functions don't exist yet)**

Create `src/tests/graphService.test.ts` with this exact content:

```typescript
import { describe, it, expect } from "vitest";
import { findNearestGraphNode, aStarSegment } from "../services/graphService";
import type { OSMNode } from "../services/overpassService";
import type { Point } from "../lib/shapeMath";

// --- findNearestGraphNode ---

describe("findNearestGraphNode", () => {
  it("returns the id of the nearest node", () => {
    const nmap = new Map<string, OSMNode>([
      ["n1", { id: 1, lat: 0, lng: 0 }],
      ["n2", { id: 2, lat: 0.001, lng: 0.001 }],
      ["n3", { id: 3, lat: 0.1, lng: 0.1 }],
    ]);
    const result = findNearestGraphNode({ lat: 0.0011, lng: 0.0011 }, nmap);
    expect(result).toBe("n2");
  });

  it("returns null for empty nodeMap", () => {
    expect(findNearestGraphNode({ lat: 0, lng: 0 }, new Map())).toBeNull();
  });
});

// --- aStarSegment ---

describe("aStarSegment", () => {
  it("finds path on a linear chain A→B→C→D", () => {
    const nmap = new Map<string, OSMNode>([
      ["A", { id: 1, lat: 0, lng: 0 }],
      ["B", { id: 2, lat: 0, lng: 0.001 }],
      ["C", { id: 3, lat: 0, lng: 0.002 }],
      ["D", { id: 4, lat: 0, lng: 0.003 }],
    ]);
    const emap = new Map([
      ["A", ["B"]],
      ["B", ["A", "C"]],
      ["C", ["B", "D"]],
      ["D", ["C"]],
    ]);
    const ideal: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.003 },
    ];
    const result = aStarSegment("A", "D", nmap, emap, ideal);
    expect(result).not.toBeNull();
    expect(result!.map(n => n.id)).toEqual([1, 2, 3, 4]);
  });

  it("prefers shape-hugging U-arc path over direct shortcut when beta is high", () => {
    // Direct edge: start→goal (short but deviates from ideal arc)
    // Arc edges:  start→topLeft→topRight→goal (longer but hugs ideal)
    const nmap = new Map<string, OSMNode>([
      ["start",    { id: 1, lat: 0,    lng: 0 }],
      ["topLeft",  { id: 2, lat: 0.01, lng: 0 }],
      ["topRight", { id: 3, lat: 0.01, lng: 0.01 }],
      ["goal",     { id: 4, lat: 0,    lng: 0.01 }],
    ]);
    const emap = new Map([
      ["start",    ["topLeft", "goal"]],
      ["topLeft",  ["start", "topRight"]],
      ["topRight", ["topLeft", "goal"]],
      ["goal",     ["topRight", "start"]],
    ]);
    // Ideal traces the U-arc: top-left then top-right
    const ideal: Point[] = [
      { lat: 0,    lng: 0 },
      { lat: 0.01, lng: 0 },
      { lat: 0.01, lng: 0.01 },
      { lat: 0,    lng: 0.01 },
    ];
    const result = aStarSegment("start", "goal", nmap, emap, ideal, {
      alpha: 1.0,
      beta: 5.0,  // β > 4.0 required: direct edge costs α·1113+β·556; arc costs 3·α·1113; arc wins when 3339 < 1113+556β → β>4.0
    });
    expect(result).not.toBeNull();
    const ids = result!.map(n => n.id);
    expect(ids).toContain(2); // topLeft
    expect(ids).toContain(3); // topRight
  });

  it("returns null for a disconnected graph", () => {
    const nmap = new Map<string, OSMNode>([
      ["A", { id: 1, lat: 0, lng: 0 }],
      ["B", { id: 2, lat: 1, lng: 1 }],
    ]);
    const emap = new Map([["A", []], ["B", []]]);
    expect(aStarSegment("A", "B", nmap, emap, [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail with "Cannot find module"**

```bash
npx vitest run src/tests/graphService.test.ts
```

Expected output: `Error: Cannot find module '../services/graphService'`

- [ ] **Step 3: Create `src/services/graphService.ts`**

```typescript
import * as turf from "@turf/turf";
import { Point } from "../lib/shapeMath";
import { OSMNode } from "./overpassService";

export interface AStarOptions {
  alpha?: number;
  beta?: number;
  maxIterations?: number;
}

export const DEFAULT_ALPHA = 1.0;
export const DEFAULT_BETA = 2.0;

class MinHeap {
  private heap: { id: string; f: number }[] = [];

  push(item: { id: string; f: number }): void {
    this.heap.push(item);
    this.siftUp(this.heap.length - 1);
  }

  pop(): { id: string; f: number } | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  get size(): number {
    return this.heap.length;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].f <= this.heap[i].f) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.heap[left].f < this.heap[smallest].f) smallest = left;
      if (right < n && this.heap[right].f < this.heap[smallest].f) smallest = right;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

export function findNearestGraphNode(
  point: Point,
  nodeMap: Map<string, OSMNode>
): string | null {
  if (nodeMap.size === 0) return null;
  const pt = turf.point([point.lng, point.lat]);
  let closestId: string | null = null;
  let minDist = Infinity;
  for (const [id, node] of nodeMap) {
    const d = turf.distance(pt, turf.point([node.lng, node.lat]), { units: "meters" });
    if (d < minDist) {
      minDist = d;
      closestId = id;
    }
  }
  return closestId;
}

export function aStarSegment(
  startId: string,
  goalId: string,
  nodeMap: Map<string, OSMNode>,
  edgeMap: Map<string, string[]>,
  idealSegment: Point[],
  options?: AStarOptions
): OSMNode[] | null {
  const alpha = options?.alpha ?? DEFAULT_ALPHA;
  const beta = options?.beta ?? DEFAULT_BETA;
  const maxIterations = options?.maxIterations ?? nodeMap.size * 4;

  if (startId === goalId) {
    const node = nodeMap.get(startId);
    return node ? [node] : null;
  }

  const goalNode = nodeMap.get(goalId);
  if (!goalNode) return null;

  const idealLine = idealSegment.length >= 2
    ? turf.lineString(idealSegment.map(p => [p.lng, p.lat]))
    : null;

  const gScore = new Map<string, number>([[startId, 0]]);
  const parent = new Map<string, string>();
  const closed = new Set<string>();
  const open = new MinHeap();

  const heuristic = (id: string): number => {
    const node = nodeMap.get(id);
    if (!node) return 0;
    return alpha * turf.distance(
      turf.point([node.lng, node.lat]),
      turf.point([goalNode.lng, goalNode.lat]),
      { units: "meters" }
    );
  };

  open.push({ id: startId, f: heuristic(startId) });

  let iterations = 0;
  while (open.size > 0 && iterations < maxIterations) {
    iterations++;
    const current = open.pop()!;
    if (closed.has(current.id)) continue;
    closed.add(current.id);

    if (current.id === goalId) {
      const path: OSMNode[] = [];
      let cur: string | undefined = goalId;
      while (cur !== undefined && cur !== startId) {
        const node = nodeMap.get(cur);
        if (node) path.push(node);
        cur = parent.get(cur);
      }
      const startNode = nodeMap.get(startId);
      if (startNode) path.push(startNode);
      return path.reverse();
    }

    const currentNode = nodeMap.get(current.id);
    if (!currentNode) continue;

    for (const neighborId of edgeMap.get(current.id) ?? []) {
      if (closed.has(neighborId)) continue;
      const neighborNode = nodeMap.get(neighborId);
      if (!neighborNode) continue;

      const edgeLengthM = turf.distance(
        turf.point([currentNode.lng, currentNode.lat]),
        turf.point([neighborNode.lng, neighborNode.lat]),
        { units: "meters" }
      );

      let deviationM = 0;
      if (idealLine) {
        const midLng = (currentNode.lng + neighborNode.lng) / 2;
        const midLat = (currentNode.lat + neighborNode.lat) / 2;
        deviationM = turf.pointToLineDistance(
          turf.point([midLng, midLat]),
          idealLine,
          { units: "meters" }
        );
      }

      const tentativeG = (gScore.get(current.id) ?? Infinity)
        + alpha * edgeLengthM
        + beta * deviationM;

      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        gScore.set(neighborId, tentativeG);
        parent.set(neighborId, current.id);
        open.push({ id: neighborId, f: tentativeG + heuristic(neighborId) });
      }
    }
  }

  if (iterations >= maxIterations) {
    console.warn(`aStarSegment: max iterations exceeded for ${startId}→${goalId}`);
  }
  return null;
}
```

- [ ] **Step 4: Run tests — verify Tests 1–4 all pass**

```bash
npx vitest run src/tests/graphService.test.ts
```

Expected output:
```
 ✓ src/tests/graphService.test.ts (5)
   ✓ findNearestGraphNode > returns the id of the nearest node
   ✓ findNearestGraphNode > returns null for empty nodeMap
   ✓ aStarSegment > finds path on a linear chain A→B→C→D
   ✓ aStarSegment > prefers shape-hugging U-arc path over direct shortcut when beta is high
   ✓ aStarSegment > returns null for a disconnected graph

 Test Files  1 passed (1)
 Tests       5 passed (5)
```

Actually there are 5 tests (2 + 3). All 5 should pass.

- [ ] **Step 5: Run lint — verify no type errors**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/graphService.ts src/tests/graphService.test.ts
git commit -m "feat: add shape-anchored A* algorithm and core graph utilities"
```

---

## Task 2: Segment Orchestrator (`graphRoutingService.ts` + Test 5)

> **Prerequisite:** Task 1 must be committed and merged first.

**Files:**
- Create: `src/services/graphRoutingService.ts`
- Modify: `src/tests/graphService.test.ts` (add Test 5)

- [ ] **Step 1: Add Test 5 to `src/tests/graphService.test.ts` (will fail — graphRoutingService doesn't exist yet)**

Open `src/tests/graphService.test.ts` and add these imports at the top:

```typescript
import { vi } from "vitest";
import { graphRouteShape } from "../services/graphRoutingService";
```

Then append this `describe` block at the end of the file:

```typescript
// --- graphRouteShape ---

describe("graphRouteShape", () => {
  it("concatenates two A* segments without duplicating the junction point", async () => {
    // 5-node linear graph: n1-n2-n3-n4-n5
    const nmap = new Map<string, OSMNode>([
      ["n1", { id: 1, lat: 0, lng: 0 }],
      ["n2", { id: 2, lat: 0, lng: 0.001 }],
      ["n3", { id: 3, lat: 0, lng: 0.002 }],
      ["n4", { id: 4, lat: 0, lng: 0.003 }],
      ["n5", { id: 5, lat: 0, lng: 0.004 }],
    ]);
    const emap = new Map([
      ["n1", ["n2"]],
      ["n2", ["n1", "n3"]],
      ["n3", ["n2", "n4"]],
      ["n4", ["n3", "n5"]],
      ["n5", ["n4"]],
    ]);
    // 3 waypoints → 2 segments
    // Segment 1: (0,0)→(0,0.002) snaps to n1→n3, A* returns [n1,n2,n3]
    // Segment 2: (0,0.002)→(0,0.004) snaps to n3→n5, A* returns [n3,n4,n5]
    // After dedup: [n1,n2,n3] + [n4,n5] = 5 coords, not 6
    const waypoints: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.002 },
      { lat: 0, lng: 0.004 },
    ];
    const idealPath: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.004 },
    ];
    const mockRoutingService = {
      routeWithLockedWaypoints: vi.fn().mockResolvedValue({ polylineCoords: [] }),
    };

    const result = await graphRouteShape(
      waypoints,
      idealPath,
      nmap,
      emap,
      mockRoutingService as any
    );

    expect(result.polylineCoords.length).toBe(5);
    expect(mockRoutingService.routeWithLockedWaypoints).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — verify Test 5 fails with "Cannot find module"**

```bash
npx vitest run src/tests/graphService.test.ts
```

Expected: `Error: Cannot find module '../services/graphRoutingService'` (5 tests pass, 1 fails)

- [ ] **Step 3: Create `src/services/graphRoutingService.ts`**

```typescript
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

    // Extract ideal sub-path for this segment (same pattern as routingService.ts:566)
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
```

- [ ] **Step 4: Run all tests — verify all 6 pass**

```bash
npx vitest run src/tests/graphService.test.ts
```

Expected:
```
 ✓ src/tests/graphService.test.ts (6)
   ✓ findNearestGraphNode > returns the id of the nearest node
   ✓ findNearestGraphNode > returns null for empty nodeMap
   ✓ aStarSegment > finds path on a linear chain A→B→C→D
   ✓ aStarSegment > prefers shape-hugging U-arc path over direct shortcut when beta is high
   ✓ aStarSegment > returns null for a disconnected graph
   ✓ graphRouteShape > concatenates two A* segments without duplicating the junction point

 Test Files  1 passed (1)
 Tests       6 passed (6)
```

- [ ] **Step 5: Run lint — verify no type errors**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/graphRoutingService.ts src/tests/graphService.test.ts
git commit -m "feat: add graphRouteShape segment orchestrator with OSRM fallback"
```

---

## Task 3: Wire Up App.tsx

> **Prerequisite:** Task 2 must be committed (the `graphRouteShape` export must exist).

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the import to `src/App.tsx`**

In the `// Services and Libs` block (around line 28), add one line after the `snapIdealPathToRoads` import:

Find this line:
```typescript
import { snapIdealPathToRoads } from "./services/nodeSnapService";
```

Add immediately after it:
```typescript
import { graphRouteShape } from "./services/graphRoutingService";
```

- [ ] **Step 2: Swap the routing call in `src/App.tsx`**

Find line ~444 (inside the retry loop):
```typescript
        const routingResult = await routingService.routeWithLockedWaypoints(snappedWaypoints);
```

Replace with:
```typescript
        const routingResult = await graphRouteShape(
          snappedWaypoints,
          bestConfig.projectedPoints,
          network.nodeMap,
          network.edgeMap,
          routingService
        );
```

`network` is in scope (fetched at the top of `handleGenerate` around line 363). `bestConfig.projectedPoints` is also in scope (set before this loop).

- [ ] **Step 3: Run lint — verify no type errors**

```bash
npm run lint
```

Expected: no errors. The return type of `graphRouteShape` is `Promise<{ polylineCoords: [number, number][] }>`, which matches `routeWithLockedWaypoints`, so `routingResult.polylineCoords` on the next line is type-safe.

- [ ] **Step 4: Run full test suite**

```bash
npm run test
```

Expected: all existing tests pass plus the 6 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: route shape segments via A* graph search instead of OSRM shortest-path"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| `findNearestGraphNode` — linear scan, returns null on empty | Task 1, Step 3 |
| `aStarSegment` — MinHeap, g=α·dist+β·deviation, h=α·haversineToGoal | Task 1, Step 3 |
| Max-iterations cap → return null + console.warn | Task 1, Step 3 |
| `graphRouteShape` — per-segment A*, OSRM fallback on null | Task 2, Step 3 |
| `turf.lineSliceAlong` for ideal sub-path extraction | Task 2, Step 3 |
| Junction dedup (skip first coord of subsequent segments) | Task 2, Step 3; Test 5 validates |
| `DEFAULT_ALPHA = 1.0`, `DEFAULT_BETA = 2.0` exported | Task 1, Step 3 |
| `App.tsx` import + call swap | Task 3 |
| Test 1: linear chain | Task 1, Step 1 |
| Test 2: shape-hugging over shortcut | Task 1, Step 1 |
| Test 3: disconnected graph → null | Task 1, Step 1 |
| Test 4: findNearestGraphNode nearest node | Task 1, Step 1 |
| Test 5: segment concatenation, no duplicate junction | Task 2, Step 1 |

**Placeholder scan:** None. All steps contain complete code.

**Type consistency:**
- `AStarOptions` defined in Task 1 → imported in Task 2 ✓
- `OSMNode` from `overpassService.ts` used consistently (numeric `id` field) ✓
- `Point` from `shapeMath.ts` used consistently ✓
- `graphRouteShape` return type `{ polylineCoords: [number, number][] }` matches `routeWithLockedWaypoints` output ✓
- `RoutingService` imported via `Pick<RoutingService, "routeWithLockedWaypoints">` — only the method needed ✓
