import { describe, it, expect } from 'vitest';
import {
  calculateGeodesicBearing,
  scoreShapeAgainstRoadNetwork,
  findBestOrientation,
} from '../../src/services/optimizationService';
import { Point, NormalizedPoint } from '../../src/lib/shapeMath';

describe('calculateGeodesicBearing', () => {
  it('due North returns ~0°', () => {
    const bearing = calculateGeodesicBearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(bearing).toBeCloseTo(0, 0);
  });

  it('due East returns ~90°', () => {
    const bearing = calculateGeodesicBearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(bearing).toBeCloseTo(90, 0);
  });

  it('due South returns ~180°', () => {
    const bearing = calculateGeodesicBearing({ lat: 1, lng: 0 }, { lat: 0, lng: 0 });
    expect(bearing).toBeCloseTo(180, 0);
  });

  it('due West returns ~270°', () => {
    const bearing = calculateGeodesicBearing({ lat: 0, lng: 1 }, { lat: 0, lng: 0 });
    expect(bearing).toBeCloseTo(270, 0);
  });
});

describe('scoreShapeAgainstRoadNetwork', () => {
  it('returns 0 when no roads are nearby', () => {
    const shapePoints: Point[] = [
      { lat: 51.5, lng: -0.1 },
      { lat: 51.51, lng: -0.1 },
    ];
    const nodes = new Map<string, any>([
      ['1', { lat: 55.9, lng: -3.2 }],
      ['2', { lat: 55.91, lng: -3.2 }],
    ]);
    const edges = new Map<string, string[]>([
      ['1', ['2']],
      ['2', ['1']],
    ]);
    const score = scoreShapeAgainstRoadNetwork(shapePoints, nodes, edges);
    expect(score).toBe(0);
  });

  it('returns > 0 when a nearby road aligns with the shape', () => {
    const shapePoints: Point[] = [
      { lat: 51.5, lng: -0.1 },
      { lat: 51.51, lng: -0.1 },
    ];
    const nodes = new Map<string, any>([
      ['1', { lat: 51.5, lng: -0.0994 }],
      ['2', { lat: 51.51, lng: -0.0994 }],
    ]);
    const edges = new Map<string, string[]>([
      ['1', ['2']],
      ['2', ['1']],
    ]);
    const score = scoreShapeAgainstRoadNetwork(shapePoints, nodes, edges);
    expect(score).toBeGreaterThan(0);
  });

  it('returns 0 when bearing diff > 45° (East road, North shape)', () => {
    const shapePoints: Point[] = [
      { lat: 51.5, lng: -0.1 },
      { lat: 51.51, lng: -0.1 },
    ];
    const nodes = new Map<string, any>([
      ['1', { lat: 51.505, lng: -0.102 }],
      ['2', { lat: 51.505, lng: -0.098 }],
    ]);
    const edges = new Map<string, string[]>([
      ['1', ['2']],
      ['2', ['1']],
    ]);
    const score = scoreShapeAgainstRoadNetwork(shapePoints, nodes, edges);
    expect(score).toBe(0);
  });

  it('returns 0 for empty shape points', () => {
    const nodes = new Map<string, any>([['1', { lat: 51.5, lng: -0.1 }]]);
    const edges = new Map<string, string[]>([['1', []]]);
    const score = scoreShapeAgainstRoadNetwork([], nodes, edges);
    expect(score).toBe(0);
  });
});

describe('findBestOrientation', () => {
  it('always returns a valid bestConfig even when all scores are 0', async () => {
    const normalizedPoints: NormalizedPoint[] = [
      { x: 0.5, y: 0.5 },
      { x: 0.6, y: 0.5 },
    ];
    const nodes = new Map<string, any>();
    const edges = new Map<string, string[]>();

    const result = await findBestOrientation(
      normalizedPoints,
      51.5,
      -0.1,
      5,
      nodes,
      edges,
      'shapes'
    );

    expect(result.bestConfig).toBeDefined();
    expect(typeof result.bestConfig.rotation).toBe('number');
    expect(typeof result.bestConfig.scale).toBe('number');
    expect(result.allResults.length).toBeGreaterThan(0);
  });

  it('text input type uses only rotation=0 and scale=1.0', async () => {
    const normalizedPoints: NormalizedPoint[] = [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }];
    const nodes = new Map<string, any>();
    const edges = new Map<string, string[]>();

    const result = await findBestOrientation(normalizedPoints, 51.5, -0.1, 5, nodes, edges, 'text');

    expect(result.allResults.length).toBe(1);
    expect(result.allResults[0].rotation).toBe(0);
    expect(result.allResults[0].scale).toBe(1.0);
  });
});
