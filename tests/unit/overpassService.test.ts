import { describe, it, expect } from 'vitest';
import { OverpassService, OSMNode } from '../../src/services/overpassService';
import { Point } from '../../src/lib/shapeMath';

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
    // 10 nodes inside corridor — enough to exceed the 8-node threshold so no fallback
    const inBounds: OSMNode[] = Array.from({ length: 10 }, (_, i) =>
      makeNode(i + 1, 51.502 + i * 0.0005, -0.097 + i * 0.0005)
    );
    const outOfBounds: OSMNode[] = [
      makeNode(101, 51.60, -0.20),  // far outside
      makeNode(102, 51.61, -0.21),  // far outside
    ];
    const nodes = [...inBounds, ...outOfBounds];
    const result = service.getNodesForStage(nodes, stagePath, 400);
    expect(result.some(n => n.id === 1)).toBe(true);
    expect(result.some(n => n.id === 101)).toBe(false);
    expect(result.some(n => n.id === 102)).toBe(false);
  });

  it('falls back to 20 nearest when fewer than 8 nodes in bounds', () => {
    const stagePath: Point[] = [
      { lat: 51.50, lng: -0.10 },
      { lat: 51.51, lng: -0.09 }
    ];
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
