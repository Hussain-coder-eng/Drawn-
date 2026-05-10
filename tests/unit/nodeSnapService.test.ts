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
    // First sampled interior point should be near the eastern side (lng >= 0)
    expect(sampledLngs[0]).toBeGreaterThanOrEqual(0);
  });
});
