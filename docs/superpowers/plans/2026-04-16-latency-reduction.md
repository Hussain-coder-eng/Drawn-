# Latency Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce route generation click-to-result time to ≤15 seconds by fixing a cache key bug that prevents Overpass prefetch from ever hitting, and reducing the Gemini node cap from 800 to 400.

**Architecture:** Three targeted changes — (1) fix Overpass cache key by removing `idealAnchors.length` and unifying the radius formula between prefetch and generate, (2) lower `getRelevantNodes` node cap 800→400, (3) align prefetch trigger to use the same radius as generate. Note: OSRM chunk parallelization is already implemented (`Promise.all` at `routingService.ts:191`) — no change needed there.

**Tech Stack:** TypeScript, Vite, React, turf.js

---

## File Map

| File | Change |
|------|--------|
| `src/services/overpassService.ts` | Remove `idealAnchors` param from `fetchRoadNetwork` + cache key; lower node cap 800→400 in `getRelevantNodes` and `filterNodesForAI` |
| `src/App.tsx` | Remove `roughAnchors` arg from `fetchRoadNetwork` call; unify prefetch radius formula with generate formula |

---

## Task 1: Fix Overpass Cache Key Bug

**Root cause:** `fetchRoadNetwork` cache key includes `idealAnchors?.length ?? 0`. The prefetch call omits `idealAnchors` (key ends `,0`). The generate call passes `roughAnchors` (key ends `,N`). They never match — every generate call fetches from scratch despite the prefetch.

**Secondary issue:** Prefetch uses `overpassService.calculateRadius(distInKm)` (1.2× buffer, 500m floor, 5km cap) but generate uses its own formula `Math.max(800, Math.round((distInKm / (2*π)) * 1.3 * 1000))` (1.3× buffer, 800m floor). Different radii = different cache keys even without `idealAnchors`.

**Fix:** Remove `idealAnchors` from `fetchRoadNetwork` signature and cache key. Update prefetch in `App.tsx` to use the same radius formula as generate.

**Files:**
- Modify: `src/services/overpassService.ts:161-162`
- Modify: `src/services/overpassService.ts:170-183` (remove idealAnchors area filter branch)
- Modify: `src/App.tsx:309-320` (prefetch effect — unify radius formula)
- Modify: `src/App.tsx:400-402` (generate call — remove roughAnchors arg)

- [ ] **Step 1: Update `fetchRoadNetwork` signature and cache key**

In `src/services/overpassService.ts`, replace lines 161–183:

```typescript
// BEFORE (line 161):
async fetchRoadNetwork(center: Point, radiusMeters: number, onProgress?: (msg: string) => void, idealAnchors?: Point[]): Promise<RoadNetwork> {
  const cacheKey = `${center.lat.toFixed(4)},${center.lng.toFixed(4)},${radiusMeters},${idealAnchors ? idealAnchors.length : 0}`;

// AFTER:
async fetchRoadNetwork(center: Point, radiusMeters: number, onProgress?: (msg: string) => void): Promise<RoadNetwork> {
  const cacheKey = `${center.lat.toFixed(4)},${center.lng.toFixed(4)},${radiusMeters}`;
```

Also remove the `idealAnchors` branch that expanded the area filter (lines 172–183). The area filter should simply use `radiusMeters` as passed:

Replace the block:
```typescript
    let areaFilter = `(around:${radiusMeters},${center.lat},${center.lng})`;
    
    // If we have ideal anchors, use a circle that encompasses the entire shape plus a buffer
    if (idealAnchors && idealAnchors.length > 0) {
      const centerPt = turf.point([center.lng, center.lat]);
      const distances = idealAnchors.map(a => {
        const pt = turf.point([a.lng, a.lat]);
        return turf.distance(centerPt, pt, { units: 'meters' });
      });
      const maxDist = Math.max(...distances);
      // Use at least 1.5km or the shape's extent + 1000m
      const finalRadius = Math.max(1500, maxDist + 1000);
      areaFilter = `(around:${finalRadius},${center.lat},${center.lng})`;
    }
```

With:
```typescript
    const areaFilter = `(around:${radiusMeters},${center.lat},${center.lng})`;
```

- [ ] **Step 2: Update prefetch effect in `App.tsx` to use same radius formula as generate**

In `src/App.tsx`, the prefetch effect is at lines 309–320. Replace it:

```typescript
// BEFORE:
  useEffect(() => {
    if (userLocation.lat !== 0 && userLocation.lng !== 0 && isAuthReady) {
      const distInKm = state.unit === "mi" ? state.distance * 1.60934 : state.distance;
      const radiusMeters = overpassService.calculateRadius(distInKm);
      
      const timer = setTimeout(() => {
        overpassService.fetchRoadNetwork(userLocation, radiusMeters).catch(() => {});
      }, 2000); // Wait 2s after changes to avoid spamming
      
      return () => clearTimeout(timer);
    }
  }, [userLocation, state.distance, state.unit, isAuthReady]);

// AFTER:
  useEffect(() => {
    if (userLocation.lat !== 0 && userLocation.lng !== 0 && isAuthReady) {
      const distInKm = state.unit === "mi" ? state.distance * 1.60934 : state.distance;
      const baseRadiusMeters = Math.max(800, Math.round((distInKm / (2 * Math.PI)) * 1.3 * 1000));
      
      const timer = setTimeout(() => {
        overpassService.fetchRoadNetwork(userLocation, baseRadiusMeters).catch(() => {});
      }, 2000); // Wait 2s after changes to avoid spamming
      
      return () => clearTimeout(timer);
    }
  }, [userLocation, state.distance, state.unit, isAuthReady]);
```

- [ ] **Step 3: Update generate call in `App.tsx` to not pass `roughAnchors`**

In `src/App.tsx` around lines 396–402, remove the `roughAnchors` computation and the `roughAnchors` argument:

```typescript
// BEFORE (lines 396-402):
      // Get rough projected points to help Overpass focus on the right area
      const roughRadiusKm = distInKm / (2 * Math.PI);
      const roughAnchors = projectShapeToLatLng(simplifiedPoints, userLocation.lat, userLocation.lng, roughRadiusKm);

      let network = await overpassService.fetchRoadNetwork(userLocation, baseRadiusMeters, (msg) => {
        setLoadingMessage(msg);
      }, roughAnchors);

// AFTER:
      let network = await overpassService.fetchRoadNetwork(userLocation, baseRadiusMeters, (msg) => {
        setLoadingMessage(msg);
      });
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint
```

Expected: no errors. If `projectShapeToLatLng` is now unused in `handleGenerate`, check if it's still imported and used elsewhere before removing the import.

- [ ] **Step 5: Commit**

```bash
git add src/services/overpassService.ts src/App.tsx
git commit -m "fix: repair Overpass prefetch cache key — remove idealAnchors from key and unify radius formula"
```

---

## Task 2: Reduce Gemini Node Cap 800 → 400

**Problem:** `getRelevantNodes` (called at `App.tsx:435` with `limit: 800`) and `filterNodesForAI` (internal cap at 800) send up to 800 nodes to Gemini. Halving to 400 cuts prompt token size ~50%, reducing Gemini response time from 5-20s to ~3-10s.

**Files:**
- Modify: `src/services/overpassService.ts:154-155` (`filterNodesForAI` cap)
- Modify: `src/services/overpassService.ts:345` (`getRelevantNodes` default param)
- Modify: `src/App.tsx:435` (explicit `800` argument to `getRelevantNodes`)

- [ ] **Step 1: Lower `filterNodesForAI` cap from 800 to 400**

In `src/services/overpassService.ts`, replace lines 154–155:

```typescript
// BEFORE:
    if (combined.length > 800) {
      return combined.filter((_, i) => i % Math.ceil(combined.length / 800) === 0);
    }

// AFTER:
    if (combined.length > 400) {
      return combined.filter((_, i) => i % Math.ceil(combined.length / 400) === 0);
    }
```

- [ ] **Step 2: Lower `getRelevantNodes` default limit from 800 to 400**

In `src/services/overpassService.ts` line 345:

```typescript
// BEFORE:
  getRelevantNodes(allNodes: OSMNode[], anchors: Point[], edgeMap: Map<string, string[]>, limit: number = 800): OSMNode[] {

// AFTER:
  getRelevantNodes(allNodes: OSMNode[], anchors: Point[], edgeMap: Map<string, string[]>, limit: number = 400): OSMNode[] {
```

Also update the internal cap references within `getRelevantNodes`. At lines 365, 372, 375, the variable `limit` is already used (not hardcoded 800), so those are fine.

- [ ] **Step 3: Update explicit 800 call in `App.tsx`**

In `src/App.tsx` line 435:

```typescript
// BEFORE:
      const sampledNodes = overpassService.getRelevantNodes(network.nodes, bestConfig.projectedPoints, network.edgeMap, 800);

// AFTER:
      const sampledNodes = overpassService.getRelevantNodes(network.nodes, bestConfig.projectedPoints, network.edgeMap, 400);
```

- [ ] **Step 4: Run lint**

```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/overpassService.ts src/App.tsx
git commit -m "perf: reduce Gemini node cap 800→400 to halve prompt size and response time"
```

---

## Task 3: Add Shape/Mode Change as Prefetch Trigger

**Problem:** The existing prefetch triggers on `userLocation`, `state.distance`, and `state.unit` — but not on `state.mode` or `state.selectedShape`. If a user changes the shape mode (which doesn't change road network needs) this is fine, but explicitly including mode in the dependency array causes unnecessary re-fetches. The current dependencies are correct — verify the prefetch is working end-to-end after Tasks 1 and 2.

**Verification only — no code change needed for this task.** The spec mentioned shape/mode as a trigger, but road network is purely location+radius based. Mode changes don't change what road data is needed. The existing trigger set (`userLocation`, `state.distance`, `state.unit`) is already correct.

- [ ] **Step 1: Verify prefetch triggers correctly in browser**

Start the dev server:
```bash
cd /Users/hussianaltufayli/Documents/Drawn--main && npm run dev
```

Open browser DevTools → Network tab → filter by "overpass".

1. Load the app → confirm one Overpass request fires within ~2 seconds (prefetch)
2. Change the distance input → confirm a new Overpass request fires ~2s after typing stops
3. Change the location → confirm a new Overpass request fires
4. Click Generate → confirm **no** new Overpass request fires (cache hit — request should not appear in Network tab)

If step 4 shows a new Overpass request, the cache key is still mismatched — check that `baseRadiusMeters` is computed identically in both the prefetch effect and `handleGenerate`.

- [ ] **Step 2: Verify end-to-end generation time**

With cache warm (after step 1 above), click Generate. Observe:
- Generation should complete in ≤20s (15s target; allow 5s margin for Gemini variability)
- No errors in DevTools console

- [ ] **Step 3: Commit if any debug changes were made**

If you made no changes, no commit needed. If you added/removed debug logging:
```bash
git add src/App.tsx
git commit -m "chore: clean up prefetch debug logging"
```
