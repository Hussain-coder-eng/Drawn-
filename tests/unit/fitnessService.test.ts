import { describe, it, expect } from 'vitest';
import { FitnessService } from '../../src/services/fitnessService';
import { RouteStage } from '../../src/lib/routeScripts';
import { Point } from '../../src/lib/shapeMath';

const service = new FitnessService();

const makeStage = (overrides: Partial<RouteStage> = {}): RouteStage => ({
  stage: 1,
  direction: 'N',
  turn: 'straight',
  distancePct: 100,
  description: 'Go North',
  ...overrides,
});

describe('FitnessService.scoreRoute', () => {
  it('empty route (no node IDs) scores 0', () => {
    const result = service.scoreRoute(
      [{ stageNumber: 1, nodeIds: [] }],
      [makeStage()],
      new Map(),
      5
    );
    expect(result.overallFitness).toBe(0);
  });

  it('score is bounded within [0, 100]', () => {
    const nodeMap = new Map<string, any>([
      ['a', { lat: 51.5, lng: -0.1 }],
      ['b', { lat: 51.51, lng: -0.1 }],
    ]);
    const result = service.scoreRoute(
      [{ stageNumber: 1, nodeIds: ['a', 'b'] }],
      [makeStage({ distancePct: 100 })],
      nodeMap,
      1.1
    );
    expect(result.overallFitness).toBeGreaterThanOrEqual(0);
    expect(result.overallFitness).toBeLessThanOrEqual(100);
  });

  it('correctly identifies failing stages (stage score < 75)', () => {
    const result = service.scoreRoute(
      [{ stageNumber: 1, nodeIds: [] }],
      [makeStage()],
      new Map(),
      5
    );
    expect(result.failingStages).toHaveLength(1);
    expect(result.failingStages[0].stageNumber).toBe(1);
  });

  it('a stage going due North with nodes aligned North scores high direction', () => {
    const nodeMap = new Map<string, any>([
      ['a', { lat: 51.500, lng: -0.100 }],
      ['b', { lat: 51.510, lng: -0.100 }],
    ]);
    const result = service.scoreRoute(
      [{ stageNumber: 1, nodeIds: ['a', 'b'] }],
      [makeStage({ direction: 'N', distancePct: 100 })],
      nodeMap,
      1.1
    );
    expect(result.stageScores[0].directionScore).toBe(100);
  });

  it('a West-bound stage going East scores direction 0', () => {
    const nodeMap = new Map<string, any>([
      ['a', { lat: 51.5, lng: -0.2 }],
      ['b', { lat: 51.5, lng: -0.1 }],
    ]);
    const result = service.scoreRoute(
      [{ stageNumber: 1, nodeIds: ['a', 'b'] }],
      [makeStage({ direction: 'W', distancePct: 100 })],
      nodeMap,
      10
    );
    expect(result.stageScores[0].directionScore).toBe(0);
  });
});

describe('FitnessService.scoreFidelity', () => {
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

describe('FitnessService.scoreFidelity — recalibrated Frechet formula', () => {
  it('scores a route with ~256m max deviation > 0 (new ×200 formula allows it)', () => {
    // calculateFrechetFidelity requires at least 2 points; single-point arrays short-circuit to 0
    // 256m north ≈ 0.0023° latitude (1° ≈ 111.32km)
    // With OLD formula (×500): 100 - 0.256 * 500 = -28 → clamped 0  (too strict)
    // With NEW formula (×200): 100 - 0.256 * 200 =  49 → score 49   (correct)
    const ideal: Point[] = [{ lat: 51.500, lng: -0.100 }, { lat: 51.5001, lng: -0.100 }];
    const mid: Point[]   = [{ lat: 51.5023, lng: -0.100 }, { lat: 51.5024, lng: -0.100 }]; // ~256m north
    const score = service.scoreFidelity(mid, 'premade', ideal);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(60);
  });

  it('scores a route with >500m max deviation as 0', () => {
    // ~1.11km deviation — clamped to 0 by both old and new formula
    const ideal: Point[]   = [{ lat: 51.500, lng: -0.100 }, { lat: 51.5001, lng: -0.100 }];
    const veryFar: Point[] = [{ lat: 51.510, lng: -0.100 }, { lat: 51.5101, lng: -0.100 }]; // ~1.11km
    const score = service.scoreFidelity(veryFar, 'premade', ideal);
    expect(score).toBe(0);
  });

  it('scores a perfect match as 100', () => {
    const pts: Point[] = [{ lat: 51.5, lng: -0.1 }, { lat: 51.51, lng: -0.09 }];
    expect(service.scoreFidelity(pts, 'premade', pts)).toBe(100);
  });
});
