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
  computeBboxDiagonal,
  isClosedShape,
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

describe('computeBboxDiagonal', () => {
  it('returns 0 for fewer than 2 points', () => {
    expect(computeBboxDiagonal([])).toBe(0);
    expect(computeBboxDiagonal([{ lat: 0, lng: 0 }])).toBe(0);
  });

  it('returns approximate diagonal for a degree-scale rectangle', () => {
    // 1° lat × 1° lng at equator → diagonal ≈ 157km
    const pts = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }];
    const d = computeBboxDiagonal(pts);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(200);
  });

  it('returns non-zero for a projected heart shape', () => {
    const pts = projectShapeToLatLng(generateNormalizedHeart(), 51.5, -0.1, 2);
    expect(computeBboxDiagonal(pts)).toBeGreaterThan(0);
  });
});

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
