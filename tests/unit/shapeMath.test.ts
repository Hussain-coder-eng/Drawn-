import { describe, it, expect } from 'vitest';
import {
  generateNormalizedHeart,
  generateNormalizedStar,
  generateNormalizedCircle,
  generateNormalizedArrow,
  generateNormalizedInfinity,
  rotateShape,
  scaleShape,
  projectShapeToLatLng,
  NormalizedPoint,
} from '../../src/lib/shapeMath';

describe('shape generators produce normalized [0, 1] points', () => {
  const generators: Array<{ name: string; fn: () => NormalizedPoint[] }> = [
    { name: 'heart',    fn: generateNormalizedHeart },
    { name: 'star',     fn: generateNormalizedStar },
    { name: 'circle',   fn: generateNormalizedCircle },
    { name: 'arrow',    fn: generateNormalizedArrow },
    { name: 'infinity', fn: generateNormalizedInfinity },
  ];

  for (const { name, fn } of generators) {
    it(`${name} points are within [0, 1] bounds`, () => {
      const pts = fn();
      expect(pts.length).toBeGreaterThan(0);
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe('rotateShape', () => {
  it('rotate by 0° returns identical points', () => {
    const pts: NormalizedPoint[] = [{ x: 0.3, y: 0.7 }, { x: 0.8, y: 0.2 }];
    const result = rotateShape(pts, 0);
    expect(result[0].x).toBeCloseTo(pts[0].x, 10);
    expect(result[0].y).toBeCloseTo(pts[0].y, 10);
  });

  it('rotate by θ then -θ returns original (invertible)', () => {
    const pts: NormalizedPoint[] = [
      { x: 0.3, y: 0.7 },
      { x: 0.6, y: 0.2 },
      { x: 0.9, y: 0.5 },
    ];
    const rotated = rotateShape(pts, 45);
    const back = rotateShape(rotated, -45);
    for (let i = 0; i < pts.length; i++) {
      expect(back[i].x).toBeCloseTo(pts[i].x, 10);
      expect(back[i].y).toBeCloseTo(pts[i].y, 10);
    }
  });

  it('rotate by 360° returns original', () => {
    const pts: NormalizedPoint[] = [{ x: 0.4, y: 0.6 }];
    const result = rotateShape(pts, 360);
    expect(result[0].x).toBeCloseTo(pts[0].x, 10);
    expect(result[0].y).toBeCloseTo(pts[0].y, 10);
  });
});

describe('scaleShape', () => {
  it('scale by s then 1/s returns original (invertible)', () => {
    const pts: NormalizedPoint[] = [
      { x: 0.3, y: 0.7 },
      { x: 0.8, y: 0.2 },
    ];
    const scaled = scaleShape(pts, 2);
    const back = scaleShape(scaled, 0.5);
    for (let i = 0; i < pts.length; i++) {
      expect(back[i].x).toBeCloseTo(pts[i].x, 10);
      expect(back[i].y).toBeCloseTo(pts[i].y, 10);
    }
  });

  it('scale by 1.0 returns identical points', () => {
    const pts: NormalizedPoint[] = [{ x: 0.5, y: 0.5 }];
    const result = scaleShape(pts, 1.0);
    expect(result[0].x).toBe(0.5);
    expect(result[0].y).toBe(0.5);
  });
});

describe('projectShapeToLatLng', () => {
  it('center point (0.5, 0.5) maps exactly to center lat/lng', () => {
    const pts: NormalizedPoint[] = [{ x: 0.5, y: 0.5 }];
    const result = projectShapeToLatLng(pts, 51.5, -0.1, 1);
    expect(result[0].lat).toBeCloseTo(51.5, 8);
    expect(result[0].lng).toBeCloseTo(-0.1, 8);
  });

  it('produces valid lat/lng values for a circle', () => {
    const pts = generateNormalizedCircle();
    const result = projectShapeToLatLng(pts, 51.5, -0.1, 1);
    for (const p of result) {
      expect(p.lat).toBeGreaterThan(-90);
      expect(p.lat).toBeLessThan(90);
      expect(p.lng).toBeGreaterThan(-180);
      expect(p.lng).toBeLessThan(180);
    }
  });
});
