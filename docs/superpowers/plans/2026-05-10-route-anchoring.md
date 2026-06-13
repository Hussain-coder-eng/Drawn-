# Route Start/End Anchoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Closed-loop routes (heart, circle, star, square, infinity) start and end at the user's road-snapped GPS position; text and draw modes gain a "Return to start" toggle for the same behaviour.

**Architecture:** A new `isClosedShape()` predicate decides whether to snap `userLocation` before the retry loop and pass it as `forcedAnchor` to `snapIdealPathToRoads()`. The snap service rotates the ideal path to start from the point nearest the anchor, samples interior waypoints, then bookends them with `forcedAnchor` so OSRM routes from and back to the user's exact road position.

**Tech Stack:** TypeScript, turf.js (already in project), Vitest for tests.

---

## Parallelization Map

```
Tasks 1, 2, 3 → run IN PARALLEL (independent files, no shared edits)
Task 4         → run AFTER Tasks 1-3 complete
```

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/lib/shapeMath.ts` | Add `isClosedShape()` |
| Modify | `tests/unit/shapeMath.test.ts` | Tests for `isClosedShape()` |
| Modify | `src/types.ts` | Add `returnToStart: boolean` to `DrawnState` |
| Modify | `src/components/DesignInput.tsx` | Add "Return to start" toggle + new props |
| Modify | `src/services/nodeSnapService.ts` | Add `forcedAnchor` param + path rotation |
| Modify | `tests/unit/nodeSnapService.test.ts` | Tests for forced-anchor behaviour |
| Modify | `src/App.tsx` | Compute `closed`/`forcedAnchor`, wire new DesignInput props |

---

## Task 1: `isClosedShape()` — shapeMath.ts

> **Parallel-safe: YES.**

**Files:**
- Modify: `src/lib/shapeMath.ts`
- Modify: `tests/unit/shapeMath.test.ts`

---

- [ ] **Step 1: Write the failing tests**

Open `tests/unit/shapeMath.test.ts`. Add a new import at the top if not already present, then append this describe block after the existing ones:

```typescript
import { isClosedShape } from '../../src/lib/shapeMath';
import { NormalizedPoint } from '../../src/lib/shapeMath';
import { InputMode } from '../../src/types';

describe('isClosedShape', () => {
  it('returns true for closed preset shapes', () => {
    expect(isClosedShape('shapes', 'circle', [])).toBe(true);
    expect(isClosedShape('shapes', 'heart', [])).toBe(true);
    expect(isClosedShape('shapes', 'star', [])).toBe(true);
    expect(isClosedShape('shapes', 'square', [])).toBe(true);
    expect(isClosedShape('shapes', 'infinity', [])).toBe(true);
  });

  it('returns false for open preset shapes', () => {
    expect(isClosedShape('shapes', 'arrow', [])).toBe(false);
    expect(isClosedShape('shapes', 'lightning', [])).toBe(false);
    expect(isClosedShape('shapes', null, [])).toBe(false);
  });

  it('returns false for text mode regardless of path', () => {
    const path: NormalizedPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(isClosedShape('text', null, path)).toBe(false);
    expect(isClosedShape('text', 'heart', path)).toBe(false);
  });

  it('returns true for draw mode when first and last points are within 10% bbox diagonal', () => {
    // Near-closed square: first=[0,0], last=[0.05,0.05], bbox diagonal=√2≈1.414, gap=√(0.05²+0.05²)≈0.071 < 0.1414
    const path: NormalizedPoint[] = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0.05, y: 0.05 }
    ];
    expect(isClosedShape('draw', null, path)).toBe(true);
  });

  it('returns false for draw mode when first and last are far apart', () => {
    // Open diagonal line: gap = √2 ≈ 1.414, which equals bbox diagonal → not < 10%
    const path: NormalizedPoint[] = [
      { x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }
    ];
    expect(isClosedShape('draw', null, path)).toBe(false);
  });

  it('returns false for draw mode with fewer than 2 points', () => {
    expect(isClosedShape('draw', null, [])).toBe(false);
    expect(isClosedShape('draw', null, [{ x: 0, y: 0 }])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test -- tests/unit/shapeMath.test.ts 2>&1 | tail -15
```

Expected: FAIL with "isClosedShape is not a function" or similar.

- [ ] **Step 3: Implement `isClosedShape` in shapeMath.ts**

Open `src/lib/shapeMath.ts`. Add this import at the top if `InputMode` is not already imported:

```typescript
import { InputMode } from "../types";
```

Then append this function after `generateSquare` (the last function in the file, around line 313):

```typescript
export function isClosedShape(
  mode: InputMode,
  selectedShape: string | null,
  normalizedDrawnPath: NormalizedPoint[]
): boolean {
  if (mode === 'shapes') {
    return ['circle', 'heart', 'star', 'square', 'infinity'].includes(selectedShape ?? '');
  }
  if (mode === 'draw' && normalizedDrawnPath.length >= 2) {
    const first = normalizedDrawnPath[0];
    const last = normalizedDrawnPath[normalizedDrawnPath.length - 1];
    const gap = Math.sqrt((first.x - last.x) ** 2 + (first.y - last.y) ** 2);
    const xs = normalizedDrawnPath.map(p => p.x);
    const ys = normalizedDrawnPath.map(p => p.y);
    const bboxDiag = Math.sqrt(
      (Math.max(...xs) - Math.min(...xs)) ** 2 +
      (Math.max(...ys) - Math.min(...ys)) ** 2
    );
    return bboxDiag > 0 && gap < bboxDiag * 0.1;
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test -- tests/unit/shapeMath.test.ts 2>&1 | tail -15
```

Expected: All new tests PASS.

- [ ] **Step 5: Run lint**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main
git add src/lib/shapeMath.ts tests/unit/shapeMath.test.ts
git commit -m "feat: add isClosedShape() predicate for route anchoring"
```

---

## Task 2: `returnToStart` state + DesignInput toggle

> **Parallel-safe: YES.**

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/DesignInput.tsx`

---

- [ ] **Step 1: Add `returnToStart` to `DrawnState` in `src/types.ts`**

Open `src/types.ts`. The current `DrawnState` interface ends around line 26. Add `returnToStart` as the last field before the closing `}`:

```typescript
export interface DrawnState {
  mode: InputMode;
  selectedShape: string | null;
  textInput: string;
  distance: number;
  unit: "mi" | "km";
  location: string;
  isGenerating: boolean;
  hasResult: boolean;
  routeFidelity: number;
  idealCoords: Point[];
  snappedCoords: Point[];
  drawnPath: Point[];
  normalizedDrawnPath: { x: number; y: number }[];
  nodeMap?: Map<string, Point>;
  debugInfo?: DebugInfo | null;
  returnToStart: boolean;
}
```

- [ ] **Step 2: Update `DesignInputProps` and add toggle**

Open `src/components/DesignInput.tsx`.

**2a.** Add two new props to the `DesignInputProps` interface (after `onModeSelect`):

```typescript
interface DesignInputProps {
  mode: InputMode;
  selectedShape: string | null;
  setSelectedShape: (id: string | null) => void;
  textInput: string;
  setTextInput: (text: string) => void;
  drawnPath: Point[];
  setDrawnPath: (path: Point[]) => void;
  setNormalizedDrawnPath: (path: NormalizedPoint[]) => void;
  expanded: boolean;
  onModeSelect: (mode: InputMode) => void;
  returnToStart: boolean;
  onReturnToStartChange: (v: boolean) => void;
}
```

**2b.** Destructure the new props in the function signature:

```typescript
export default function DesignInput({
  mode,
  selectedShape,
  setSelectedShape,
  textInput,
  setTextInput,
  drawnPath,
  setDrawnPath,
  setNormalizedDrawnPath,
  expanded,
  onModeSelect,
  returnToStart,
  onReturnToStartChange,
}: DesignInputProps) {
```

**2c.** In the text mode block (currently `{mode === "text" && (...)}`, around line 110), add the toggle **after** the existing `<div className="space-y-4">` content — append it as a second child inside the `space-y-4` div:

```tsx
{mode === "text" && (
  <div className="space-y-4">
    <div className="relative">
      <div className="absolute left-4 top-1/2 -translate-y-1/2">
        <Keyboard className="w-5 h-5 text-accent-primary" />
      </div>
      <input
        type="text"
        data-testid="text-input"
        value={textInput}
        onChange={(e) => setTextInput(e.target.value)}
        maxLength={20}
        placeholder="Type a word or name…"
        className="w-full h-[52px] bg-bg-card border border-divider rounded-[10px] pl-12 pr-4 text-[15px] font-sans text-white focus:outline-none focus:border-accent-primary transition-colors placeholder:text-text-muted"
      />
    </div>
    <button
      data-testid="return-to-start-toggle"
      onClick={() => onReturnToStartChange(!returnToStart)}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-[10px] border w-full transition-colors",
        returnToStart
          ? "border-accent-primary/50 bg-accent-primary/10"
          : "border-divider bg-bg-card hover:border-accent-primary/30"
      )}
    >
      <div className={cn(
        "w-8 h-4 rounded-full transition-colors relative shrink-0",
        returnToStart ? "bg-accent-primary" : "bg-text-muted"
      )}>
        <div className={cn(
          "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform",
          returnToStart ? "left-0.5 translate-x-4" : "left-0.5 translate-x-0"
        )} />
      </div>
      <span className="text-[11px] font-sans font-medium uppercase tracking-[0.08em] text-text-secondary">
        Return to start
      </span>
    </button>
  </div>
)}
```

**2d.** In the draw mode block (currently `{mode === "draw" && (...)}`, around line 129), add the same toggle **after** the existing drawn-path confirmation badge. Replace the entire draw block with:

```tsx
{mode === "draw" && (
  <div className="space-y-3">
    <DrawingCanvas onShapeComplete={handleShapeComplete} />
    {drawnPath.length > 0 && (
      <div className="flex items-center justify-center gap-2 bg-success/20 border border-success/30 px-3 py-1.5 rounded-full w-fit mx-auto">
        <Check className="w-3 h-3 text-success" />
        <span data-point-count={drawnPath.length} className="text-[10px] font-bold text-success uppercase tracking-wider">Shape Captured</span>
      </div>
    )}
    <button
      data-testid="return-to-start-toggle"
      onClick={() => onReturnToStartChange(!returnToStart)}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-[10px] border w-full transition-colors",
        returnToStart
          ? "border-accent-primary/50 bg-accent-primary/10"
          : "border-divider bg-bg-card hover:border-accent-primary/30"
      )}
    >
      <div className={cn(
        "w-8 h-4 rounded-full transition-colors relative shrink-0",
        returnToStart ? "bg-accent-primary" : "bg-text-muted"
      )}>
        <div className={cn(
          "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform",
          returnToStart ? "left-0.5 translate-x-4" : "left-0.5 translate-x-0"
        )} />
      </div>
      <span className="text-[11px] font-sans font-medium uppercase tracking-[0.08em] text-text-secondary">
        Return to start
      </span>
    </button>
  </div>
)}
```

- [ ] **Step 3: Run lint**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint 2>&1 | tail -10
```

Expected errors: `App.tsx` will show errors because `returnToStart` is missing from initial state and `DesignInput` call — these are expected and fixed in Task 4. Confirm errors are ONLY in `App.tsx`, not in `types.ts` or `DesignInput.tsx`.

- [ ] **Step 4: Run tests**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test 2>&1 | tail -10
```

Expected: All existing tests pass (no tests import DesignInput or DrawnState directly).

- [ ] **Step 5: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main
git add src/types.ts src/components/DesignInput.tsx
git commit -m "feat: add returnToStart state and 'Return to start' toggle in text/draw modes"
```

---

## Task 3: `snapIdealPathToRoads` — `forcedAnchor` parameter

> **Parallel-safe: YES.**

**Files:**
- Modify: `src/services/nodeSnapService.ts`
- Modify: `tests/unit/nodeSnapService.test.ts`

---

- [ ] **Step 1: Write the failing tests**

Open `tests/unit/nodeSnapService.test.ts`. Append a new describe block after the existing `describe('snapIdealPathToRoads', ...)` closing `});`:

```typescript
describe('snapIdealPathToRoads — forcedAnchor', () => {
  it('uses forcedAnchor as first and last waypoint', async () => {
    const anchor: Point = { lat: 51.5, lng: -0.1 };
    const rs = makeRS(pts => pts); // identity snap
    const result = await snapIdealPathToRoads(circlePoints(), rs, 10, anchor);
    expect(result[0]).toEqual(anchor);
    expect(result[result.length - 1]).toEqual(anchor);
  });

  it('result length is at most targetWaypoints + 1 with forcedAnchor', async () => {
    const anchor: Point = { lat: 51.5, lng: -0.1 };
    const rs = makeRS(pts => pts);
    const result = await snapIdealPathToRoads(circlePoints(), rs, 20, anchor);
    expect(result.length).toBeLessThanOrEqual(21);
    expect(result.length).toBeGreaterThanOrEqual(4);
  });

  it('rotates ideal path so nearest point to anchor becomes first sample', async () => {
    // Straight east-west line: anchor is at the eastern end
    const anchor: Point = { lat: 51.5, lng: 0.1 }; // eastern point
    const line: Point[] = [
      { lat: 51.5, lng: -0.1 }, // western (index 0 originally)
      { lat: 51.5, lng:  0.0 }, // middle
      { lat: 51.5, lng:  0.1 }, // eastern — closest to anchor
      { lat: 51.5, lng:  0.0 }, // middle
      { lat: 51.5, lng: -0.1 }, // western
    ];
    // The batchSnap mock records all calls so we can inspect the sampled order
    const sampledLngs: number[] = [];
    const rs: RoutingService = {
      batchSnap: vi.fn(async (pts: Point[]) => {
        pts.forEach(p => sampledLngs.push(p.lng));
        return pts;
      }),
    } as unknown as RoutingService;
    await snapIdealPathToRoads(line, rs, 4, anchor);
    // First sampled interior point should be near the eastern side (lng ≥ 0)
    // (index 0 of result is anchor; middle samples come next)
    expect(sampledLngs[0]).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test -- tests/unit/nodeSnapService.test.ts 2>&1 | tail -15
```

Expected: The three new tests FAIL (function exists but doesn't accept 4th argument yet).

- [ ] **Step 3: Add `rotateToNearest` helper and `forcedAnchor` path to `nodeSnapService.ts`**

Open `src/services/nodeSnapService.ts`. Make the following changes:

**3a.** Change the function signature (line 21-25):

```typescript
export async function snapIdealPathToRoads(
  idealPath: Point[],
  routingService: RoutingService,
  targetWaypoints = 30,
  forcedAnchor?: Point
): Promise<Point[]> {
```

**3b.** Add the `forcedAnchor` branch immediately after the `if (idealPath.length < 2)` guard (after line 26). Insert this block before `// Step 1: sparse arc-length sampling`:

```typescript
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
```

**3c.** Add the `rotateToNearest` helper function at the bottom of the file, after `closeLoop`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test -- tests/unit/nodeSnapService.test.ts 2>&1 | tail -15
```

Expected: All 8 tests PASS (5 original + 3 new).

- [ ] **Step 5: Run lint**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint 2>&1 | tail -5
```

Expected: 0 errors (App.tsx errors from Task 2 may still be present — that's fine).

- [ ] **Step 6: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main
git add src/services/nodeSnapService.ts tests/unit/nodeSnapService.test.ts
git commit -m "feat: add forcedAnchor param to snapIdealPathToRoads for start/end anchoring"
```

---

## Task 4: Wire `App.tsx`

> **Sequential: run AFTER Tasks 1, 2, and 3 are committed.**

**Files:**
- Modify: `src/App.tsx`

---

- [ ] **Step 1: Add `isClosedShape` import**

Find the line:
```typescript
import { ..., computeBboxDiagonal } from "./lib/shapeMath";
```

Add `isClosedShape` to this import:
```typescript
import { ..., computeBboxDiagonal, isClosedShape } from "./lib/shapeMath";
```

(If `computeBboxDiagonal` is not in the import, just find the `shapeMath` import and add `isClosedShape` to it.)

- [ ] **Step 2: Add `returnToStart: false` to initial state**

Find the `useState<DrawnState>({` call (around line 97). The object currently ends with:
```typescript
    normalizedDrawnPath: [],
    nodeMap: new Map(),
  });
```

Add `returnToStart`:
```typescript
    normalizedDrawnPath: [],
    nodeMap: new Map(),
    returnToStart: false,
  });
```

- [ ] **Step 3: Add anchor computation before the retry loop**

Find the line in `handleGenerate`:
```typescript
      // 5. Algorithmic snap routing — no AI required
      setGenerationProgress({ attempt: 1, maxAttempts: 3, fitnessScore: null, failingStages: [] });
```

Insert this block **before** that line:

```typescript
      // Determine if this is a closed-loop shape and snap user location once
      const closed =
        isClosedShape(state.mode, state.selectedShape, state.normalizedDrawnPath) ||
        state.returnToStart;

      let forcedAnchor: Point | undefined;
      if (closed) {
        const [startOnRoad] = await routingService.batchSnap([userLocation]);
        forcedAnchor = startOnRoad;
      }
```

- [ ] **Step 4: Pass `forcedAnchor` to `snapIdealPathToRoads`**

Find the current call inside the retry loop:
```typescript
        const snappedWaypoints = await snapIdealPathToRoads(
          bestConfig.projectedPoints,
          routingService,
          WAYPOINT_COUNTS[attempt]
        );
```

Replace with:
```typescript
        const snappedWaypoints = await snapIdealPathToRoads(
          bestConfig.projectedPoints,
          routingService,
          WAYPOINT_COUNTS[attempt],
          forcedAnchor
        );
```

- [ ] **Step 5: Wire `returnToStart` into the `DesignInput` call**

Find the `<DesignInput` JSX block (around line 573). The current closing of the props looks like:

```tsx
        expanded={sheetExpanded}
        onModeSelect={(mode) => {
          updateState({ mode, hasResult: false });
          setSheetExpanded(true);
        }}
      />
```

Replace with:

```tsx
        expanded={sheetExpanded}
        onModeSelect={(mode) => {
          updateState({ mode, hasResult: false, returnToStart: false });
          setSheetExpanded(true);
        }}
        returnToStart={state.returnToStart}
        onReturnToStartChange={(v) => updateState({ returnToStart: v })}
      />
```

- [ ] **Step 6: Run lint — fix all errors**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint 2>&1
```

Expected: 0 errors. Common issues to fix:
- `returnToStart` missing from initial `DrawnState` (Step 2 above)
- `isClosedShape` import missing (Step 1 above)

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run test 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main
git add src/App.tsx
git commit -m "feat: anchor closed-loop routes to user GPS position via forcedAnchor"
```

---

## Self-Review Checklist

**Spec coverage check:**

| Spec requirement | Task that covers it |
|-----------------|-------------------|
| `isClosedShape()` for shapes/text/draw modes | Task 1 |
| `returnToStart: boolean` in DrawnState | Task 2 |
| "Return to start" toggle in text + draw UI | Task 2 |
| Toggle resets on mode switch | Task 4 (Step 5) |
| `snapIdealPathToRoads` forcedAnchor param | Task 3 |
| Path rotation to start from nearest point | Task 3 |
| Forced anchor at both ends of assembled waypoints | Task 3 |
| App.tsx: compute `closed` + `forcedAnchor` once before loop | Task 4 |
| App.tsx: pass `forcedAnchor` to snap service | Task 4 |

All spec requirements covered. ✓

**Placeholder scan:** No TBDs or incomplete steps. ✓

**Type consistency:**
- `isClosedShape(mode: InputMode, selectedShape: string | null, normalizedDrawnPath: NormalizedPoint[]): boolean` — used identically in Task 1 definition and Task 4 call ✓
- `forcedAnchor?: Point` — defined in Task 3, passed in Task 4 ✓
- `returnToStart: boolean` — added to `DrawnState` in Task 2, read in Task 4 ✓
