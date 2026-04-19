# Latency Reduction — Design Spec
**Date:** 2026-04-16  
**Status:** Approved

## Overview

Reduce route generation time from 2-3 minutes to ≤15 seconds (click-to-result, after background prefetch has warmed up). Four targeted changes with no core pipeline restructuring.

A background prefetch is allowed — the 15s target is measured from when the user clicks Generate, assuming the Overpass road network cache is warm.

---

## Change 1: Fix Overpass Prefetch Cache Key

**Problem:** The cache key in `overpassService.ts` includes `idealAnchors?.length ?? 0`. The prefetch call omits `idealAnchors` (key ends `,0`). The actual generate call passes `roughAnchors` (key ends `,N`). They never match — every generate call fetches the road network from scratch despite the prefetch.

**Fix:** Remove `idealAnchors.length` from the cache key. The road network is determined solely by center lat/lng and radius — the number of anchors is irrelevant to what's cached.

**File:** `src/services/overpassService.ts`

Cache key before:
```
`${center.lat.toFixed(4)},${center.lng.toFixed(4)},${radiusMeters},${idealAnchors ? idealAnchors.length : 0}`
```

Cache key after:
```
`${center.lat.toFixed(4)},${center.lng.toFixed(4)},${radiusMeters}`
```

Remove the `idealAnchors` parameter from `fetchRoadNetwork` signature entirely — it is not used for any purpose other than the (now-removed) cache key differentiation.

**Expected impact:** Eliminates the 5-30s Overpass fetch from click-to-result on warm cache.

---

## Change 2: Reduce Gemini Node Count (800 → 400)

**Problem:** `filterNodesForAI` sends up to 800 nodes to Gemini. Larger prompts mean longer model response times (5-20s range).

**Fix:** Lower the node cap from 800 to 400. The existing prioritization logic (junctions first, then nodes within 100m of the ideal path) already selects the most relevant nodes, so halving the cap retains quality while cutting prompt size ~50%.

**File:** `src/services/overpassService.ts`

Change the constant:
```typescript
const MAX_NODES_FOR_AI = 400; // was 800
```

**Expected impact:** Gemini response time 3-10s (was 5-20s).

---

## Change 3: Parallelize OSRM Chunks

**Problem:** `routeWithLockedWaypoints` in `routingService.ts` routes waypoint chunks sequentially with `for...of`. Each chunk is an independent OSRM request — there is no dependency between chunks.

**Fix:** Replace the sequential `for...of` loop with `Promise.all` over all chunk requests. Stitch results in order after all chunks resolve (use indexed results, not insertion order).

**File:** `src/services/routingService.ts`

**Expected impact:** For routes with 2+ chunks, saves 2-5s. For single-chunk routes (most simple shapes), no change.

---

## Change 4: Expanded Prefetch Triggers

**Problem:** Prefetch currently runs once at page load. If the user changes location or distance after load, the cache goes stale and Generate hits a cold Overpass fetch.

**Fix:** Add prefetch triggers in `App.tsx` on:
- Location change: debounced 500ms after the user stops typing in the location input
- Distance change: debounced 500ms after the user stops adjusting
- Shape/mode change: immediate (road network is location+radius based, not shape based)

Each trigger calls `overpassService.fetchRoadNetwork(location, radius)` in the background (fire-and-forget, errors swallowed silently — prefetch failure is not user-facing).

**File:** `src/App.tsx`

---

## Files Modified

| File | Change |
|------|--------|
| `src/services/overpassService.ts` | Remove `idealAnchors` param from cache key and function signature; lower `MAX_NODES_FOR_AI` from 800 to 400 |
| `src/services/routingService.ts` | Parallelize OSRM chunk requests with `Promise.all` |
| `src/App.tsx` | Add debounced prefetch triggers on location/distance/shape change |

---

## Success Criteria

- Click-to-result ≤ 15s when cache is warm (location unchanged since page load or last input change)
- No regression in route quality (fitness score distribution unchanged)
- No new TypeScript errors (`npm run lint` passes)
- Prefetch trigger does not cause visible UI lag or errors when it fails silently
