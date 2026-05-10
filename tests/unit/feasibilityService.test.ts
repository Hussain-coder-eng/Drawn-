import { describe, it, expect } from 'vitest';
import { checkFeasibility, FeasibilityError } from '../../src/services/feasibilityService';
import { RoadNetwork } from '../../src/services/overpassService';
import { Point } from '../../src/lib/shapeMath';

function makeNetwork(nodeCount: number): RoadNetwork {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: i + 1, lat: 51.5 + i * 0.001, lng: -0.1 + i * 0.001
  }));
  return {
    nodes,
    nodeMap: new Map(nodes.map(n => [String(n.id), n])),
    edgeMap: new Map(),
    bounds: { minLat: 51.5, maxLat: 51.6, minLng: -0.1, maxLng: 0 }
  };
}

function heartPoints(): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 39) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push({
      lat: 51.5 + (y / 30) * 0.02,
      lng: -0.1 + (x / 30) * 0.03
    });
  }
  return pts;
}

describe('checkFeasibility', () => {
  it('passes when road density is adequate', () => {
    const tiny: Point[] = [
      { lat: 51.50, lng: -0.10 },
      { lat: 51.501, lng: -0.10 },
      { lat: 51.501, lng: -0.101 },
      { lat: 51.50, lng: -0.101 },
      { lat: 51.50, lng: -0.10 },
    ];
    expect(() => checkFeasibility(makeNetwork(200), tiny)).not.toThrow();
  });

  it('throws FeasibilityError when road density is too low', () => {
    const pts = heartPoints();
    expect(() => checkFeasibility(makeNetwork(2), pts)).toThrow(FeasibilityError);
  });

  it('FeasibilityError message contains actionable suggestions', () => {
    const pts = heartPoints();
    try {
      checkFeasibility(makeNetwork(2), pts);
    } catch (e) {
      expect(e).toBeInstanceOf(FeasibilityError);
      const msg = (e as FeasibilityError).message;
      expect(msg).toMatch(/smaller distance|different location|simpler shape/i);
    }
  });

  it('does not throw for empty or single-point projectedPoints', () => {
    expect(() => checkFeasibility(makeNetwork(5), [])).not.toThrow();
    expect(() => checkFeasibility(makeNetwork(5), [{ lat: 51.5, lng: -0.1 }])).not.toThrow();
  });
});
