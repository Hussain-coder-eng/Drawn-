# Route Start/End Anchoring — Design Spec
**Date:** 2026-05-10
**Status:** Approved
**Goal:** Closed-loop routes start and end at the user's exact GPS location. Text and draw modes expose a "Return to start" toggle for the same behaviour.

---

## Problem

1. **Route doesn't close at the user's position** — `closeLoop()` appends the first snapped waypoint to the end of the array, but that point is the road-snap of `projectedPoints[0]` (an arbitrary point on the shape perimeter), not the road nearest the user. OSRM routes back to that perimeter corner, not to where the user is standing.

2. **"X meters off route" on start** — the first snapped waypoint is the road nearest `projectedPoints[0]`, which may be tens of metres from the user's GPS position. `useRunTracker` fires `isOffRoute` at >30 m, so the alarm triggers immediately.

---

## Architecture

### Before
```
projectedPoints[0] → arc-length sample → batchSnap → closeLoop(gap>50m) → OSRM
```

### After (closed shape)
```
userLocation → batchSnap → startOnRoad
projectedPoints → rotateToNearest(startOnRoad) → arc-length sample (middle only)
[startOnRoad, ...middleWaypoints, startOnRoad] → OSRM
```

### After (open shape)
```
projectedPoints → arc-length sample → batchSnap → (no forced anchor) → OSRM
```

---

## Change 1: `isClosedShape()` — `src/lib/shapeMath.ts`

New exported pure function, no class:

```typescript
export function isClosedShape(
  mode: InputMode,
  selectedShape: string | null,
  normalizedDrawnPath: { x: number; y: number }[]
): boolean
```

- `mode === 'shapes'`: return `['circle', 'heart', 'star', 'square', 'infinity'].includes(selectedShape ?? '')`
- `mode === 'text'`: return `false` (toggle handled externally)
- `mode === 'draw'`: geometric check — compute bounding-box diagonal of `normalizedDrawnPath`; return `true` if distance between `normalizedDrawnPath[0]` and `normalizedDrawnPath[last]` < 10% of that diagonal

---

## Change 2: `returnToStart` state — `src/types.ts`

Add field to `DrawnState`:

```typescript
returnToStart: boolean; // default false
```

Initialised `false` in `App.tsx`'s initial state. Persists across retries within a session; resets on mode switch (same pattern as `selectedShape`).

---

## Change 3: `snapIdealPathToRoads` — `src/services/nodeSnapService.ts`

Add optional parameter:

```typescript
export async function snapIdealPathToRoads(
  idealPath: Point[],
  routingService: RoutingService,
  targetWaypoints?: number,        // default 30
  forcedAnchor?: Point             // NEW — if provided, route starts and ends here
): Promise<Point[]>
```

**When `forcedAnchor` is provided:**

1. **Rotate ideal path** — find the index `i` of the `idealPath` point closest to `forcedAnchor` (by Haversine distance). Reorder: `rotated = [...idealPath.slice(i), ...idealPath.slice(0, i)]`. This makes the loop entry/exit align with the user's position.

2. **Sample middle waypoints only** — sample `targetWaypoints - 2` positions from `rotated[1]` through `rotated[last-1]` by arc length (skip first and last since they'll be replaced by `forcedAnchor`).

3. **Assemble** — `[forcedAnchor, ...batchSnap(middleSamples), forcedAnchor]`.

4. **Direction filter and dedup** run on the full assembled array as before.

5. **Skip `closeLoop()`** — not needed; first and last are already identical.

**When `forcedAnchor` is absent** — behaviour unchanged (existing algorithm).

---

## Change 4: `handleGenerate` — `src/App.tsx`

Before calling `snapIdealPathToRoads`:

```typescript
const closed =
  isClosedShape(state.mode, state.selectedShape, state.normalizedDrawnPath) ||
  state.returnToStart;

let forcedAnchor: Point | undefined;
if (closed) {
  const [startOnRoad] = await routingService.batchSnap([userLocation]);
  forcedAnchor = startOnRoad;
}

const snappedWaypoints = await snapIdealPathToRoads(
  bestConfig.projectedPoints,
  routingService,
  WAYPOINT_COUNTS[attempt],
  forcedAnchor
);
```

`forcedAnchor` is computed once before the retry loop and reused across all passes (same user location, different waypoint counts).

---

## Change 5: "Return to start" toggle — UI

### Where it appears
Below the main input in text mode and draw mode only. Not shown in shapes mode (auto-detected).

### Component
Small inline toggle row using existing `Switch`/checkbox pattern from the codebase:

```
[ ] Return to start
```

Label: **"Return to start"** — toggles `returnToStart` in state.

### Behaviour
- Default: `false`
- Persists within the session; resets when switching modes
- When `true`, `handleGenerate` passes `forcedAnchor = snap(userLocation)` regardless of shape geometry

---

## Non-Changes

| Component | Status |
|-----------|--------|
| `useRunTracker.ts` | Unchanged — 30 m threshold stays; off-route alarm naturally silent since route now starts at the user's road position |
| `routingService.ts` | Unchanged — `batchSnap` reused as-is |
| `fitnessService.ts` | Unchanged |
| `nodeSnapService.ts` | Additive only — new optional parameter, existing path unaffected when absent |
| `MapComponent.tsx` | Unchanged |

---

## Data Flow (closed shape)

```
1. isClosedShape() OR returnToStart → closed = true
2. batchSnap([userLocation]) → startOnRoad  (1 snap call, ~100ms)
3. rotateToNearest(projectedPoints, startOnRoad) → rotatedPath
4. arc-length sample targetWaypoints-2 from rotatedPath interior
5. batchSnap(middleSamples) → middleOnRoad  (~300-400ms)
6. assemble [startOnRoad, ...middleOnRoad, startOnRoad]
7. directionFilter + dedup
8. routeWithLockedWaypoints() → OSRM polyline  (~500ms)
9. scoreFidelity → retry if needed
```

Total added latency: ~100ms for one extra snap call.

---

## Files

| Action | File | Change |
|--------|------|--------|
| Modify | `src/lib/shapeMath.ts` | Add `isClosedShape()` |
| Modify | `src/types.ts` | Add `returnToStart: boolean` to `DrawnState` |
| Modify | `src/services/nodeSnapService.ts` | Add `forcedAnchor` parameter; path rotation logic |
| Modify | `src/App.tsx` | Compute `closed` + `forcedAnchor`; pass to snap service |
| Modify | `src/components/DesignInput.tsx` | Add "Return to start" toggle for text + draw modes |

---

## Success Criteria

| Metric | Before | After |
|--------|--------|-------|
| Closed-shape end point | Arbitrary road near perimeter | Same road node as start |
| Off-route alarm on start | Fires if user >30m from perimeter start | Silent — user is at route start |
| Text/draw loop routes | Not possible | Toggle enables it |
| Added latency | 0ms | ~100ms (one extra snap call) |

---

## Testing Plan

1. **Unit** — `isClosedShape`: circle/heart/star/square/infinity → true; arrow/lightning → false; text → false; draw closed → true; draw open → false
2. **Unit** — `snapIdealPathToRoads` with `forcedAnchor`: result[0] === forcedAnchor, result[last] === forcedAnchor, length ≤ targetWaypoints+1
3. **Unit** — path rotation: closest point to anchor becomes index 0 of rotated path
4. **Integration** — generate heart at Bronx location; confirm route starts and ends at same map point
5. **Manual** — enable a text route with "Return to start" toggle; confirm route loops back to start
6. **Manual** — start a run on a closed-loop heart route; confirm no off-route alert fires at t=0
