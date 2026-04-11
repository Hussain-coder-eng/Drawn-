import * as turf from "@turf/turf";

export interface Point {
  lat: number;
  lng: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export const SHAPE_SIMPLIFICATION_CONFIG: Record<string, { epsilon: number, targetSegments: number, minSegments: number }> = {
  heart:     { epsilon: 0.04, targetSegments: 8,  minSegments: 6  },
  star:      { epsilon: 0.03, targetSegments: 10, minSegments: 10 },
  circle:    { epsilon: 0.08, targetSegments: 6,  minSegments: 6  },
  infinity:  { epsilon: 0.04, targetSegments: 8,  minSegments: 8  },
  arrow:     { epsilon: 0.03, targetSegments: 6,  minSegments: 5  },
  lightning: { epsilon: 0.02, targetSegments: 6,  minSegments: 4  },
  spiral:    { epsilon: 0.06, targetSegments: 12, minSegments: 8  },
  // Text letters
  letterSimple: { epsilon: 0.05, targetSegments: 4, minSegments: 3 },
  letterMedium: { epsilon: 0.04, targetSegments: 6, minSegments: 4 },
  letterComplex:{ epsilon: 0.03, targetSegments: 8, minSegments: 6 },
  // Custom drawing
  drawing:   { epsilon: 0.03, targetSegments: 15, minSegments: 4  }
};

export function rdpSimplify(points: NormalizedPoint[], epsilon: number): NormalizedPoint[] {
  if (points.length < 3) return points;

  function perpendicularDistance(p: NormalizedPoint, p1: NormalizedPoint, p2: NormalizedPoint): number {
    let x = p1.x, y = p1.y, dx = p2.x - x, dy = p2.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2.x;
        y = p2.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p.x - x;
    dy = p.y - y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function rdpRecursive(points: NormalizedPoint[], epsilon: number, start: number, end: number): NormalizedPoint[] {
    let dmax = 0;
    let index = 0;

    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end]);
      if (d > dmax) {
        index = i;
        dmax = d;
      }
    }

    if (dmax > epsilon) {
      const res1 = rdpRecursive(points, epsilon, start, index);
      const res2 = rdpRecursive(points, epsilon, index, end);
      return [...res1.slice(0, res1.length - 1), ...res2];
    } else {
      return [points[start], points[end]];
    }
  }

  return rdpRecursive(points, epsilon, 0, points.length - 1);
}

export function adaptiveSimplify(points: NormalizedPoint[], config: { epsilon: number, targetSegments: number, minSegments: number }) {
  let epsilon = config.epsilon;
  let simplified = rdpSimplify(points, epsilon);
  let iterations = 0;
  const maxIterations = 10;

  while (iterations < maxIterations) {
    const segmentCount = simplified.length - 1;

    if (segmentCount > config.targetSegments) {
      epsilon *= 1.3;
      simplified = rdpSimplify(points, epsilon);
    } else if (segmentCount < config.minSegments) {
      epsilon *= 0.7;
      simplified = rdpSimplify(points, epsilon);
    } else {
      break;
    }
    iterations++;
  }

  return {
    points: simplified,
    segmentCount: simplified.length - 1,
    epsilonUsed: epsilon
  };
}

export function rotateShape(normalizedPoints: NormalizedPoint[], degrees: number, center = {x: 0.5, y: 0.5}): NormalizedPoint[] {
  const rad = degrees * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return normalizedPoints.map(point => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos
    };
  });
}

export function scaleShape(normalizedPoints: NormalizedPoint[], scaleFactor: number, center = {x: 0.5, y: 0.5}): NormalizedPoint[] {
  return normalizedPoints.map(point => ({
    x: center.x + (point.x - center.x) * scaleFactor,
    y: center.y + (point.y - center.y) * scaleFactor
  }));
}

export function projectShapeToLatLng(normalizedPoints: NormalizedPoint[], centerLat: number, centerLng: number, radiusKm: number): Point[] {
  return normalizedPoints.map(point => ({
    lat: centerLat + (0.5 - point.y) * radiusKm * 2 / 111.32,
    lng: centerLng + (point.x - 0.5) * radiusKm * 2 / (111.32 * Math.cos(centerLat * Math.PI / 180))
  }));
}

// --- Parametric Shape Definitions (Normalized 0-1) ---

export function generateNormalizedHeart(numPoints = 60): NormalizedPoint[] {
  const points: NormalizedPoint[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = (i / (numPoints - 1)) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    points.push({ x, y });
  }
  return normalizePoints(points);
}

export function generateNormalizedStar(numPoints = 50, innerRadius = 0.4): NormalizedPoint[] {
  const points: NormalizedPoint[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = (i / (numPoints - 1)) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : innerRadius;
    const x = Math.cos(t - Math.PI / 2) * r;
    const y = Math.sin(t - Math.PI / 2) * r;
    points.push({ x, y });
  }
  return normalizePoints(points);
}

export function generateNormalizedCircle(numPoints = 48): NormalizedPoint[] {
  const points: NormalizedPoint[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = (i / (numPoints - 1)) * Math.PI * 2;
    const x = Math.cos(t);
    const y = Math.sin(t);
    points.push({ x, y });
  }
  return normalizePoints(points);
}

export function generateNormalizedInfinity(numPoints = 80): NormalizedPoint[] {
  const points: NormalizedPoint[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = (i / (numPoints - 1)) * Math.PI * 2;
    const denom = 1 + Math.pow(Math.sin(t), 2);
    const x = Math.cos(t) / denom;
    const y = (Math.sin(t) * Math.cos(t)) / denom;
    points.push({ x, y });
  }
  return normalizePoints(points);
}

export function generateNormalizedArrow(): NormalizedPoint[] {
  const points = [
    { x: 0.5, y: 0 },
    { x: 1, y: 0.4 },
    { x: 0.7, y: 0.4 },
    { x: 0.7, y: 1 },
    { x: 0.3, y: 1 },
    { x: 0.3, y: 0.4 },
    { x: 0, y: 0.4 },
    { x: 0.5, y: 0 }
  ];
  return normalizePoints(points);
}

export function generateNormalizedLightning(): NormalizedPoint[] {
  const points = [
    { x: 0.7, y: 0 },
    { x: 0.2, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 0, y: 1 }
  ];
  return normalizePoints(points);
}

export function generateNormalizedSpiral(turns = 2, numPoints = 100): NormalizedPoint[] {
  const points: NormalizedPoint[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = (i / (numPoints - 1)) * Math.PI * 2 * turns;
    const r = t / (Math.PI * 2 * turns);
    const x = Math.cos(t) * r;
    const y = Math.sin(t) * r;
    points.push({ x, y });
  }
  return normalizePoints(points);
}

function normalizePoints(points: NormalizedPoint[]): NormalizedPoint[] {
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));

  const width = maxX - minX;
  const height = maxY - minY;
  const scale = 1 / Math.max(width, height);

  return points.map(p => ({
    x: 0.5 + (p.x - (minX + maxX) / 2) * scale,
    y: 0.5 + (p.y - (minY + maxY) / 2) * scale
  }));
}

export function scaleAndCenter(points: Point[], center: Point, targetDistanceKm: number): Point[] {
  if (points.length === 0) return [];
  
  // Create turf lineString to calculate current length
  const line = turf.lineString(points.map(p => [p.lng, p.lat]));
  const currentLength = turf.length(line, { units: "kilometers" });
  
  // Scale factor
  const scale = targetDistanceKm / (currentLength || 1);
  
  // Center the shape
  const bbox = turf.bbox(line);
  const centerPoint = turf.center(line);
  const dLng = center.lng - centerPoint.geometry.coordinates[0];
  const dLat = center.lat - centerPoint.geometry.coordinates[1];
  
  // Apply scaling and centering
  return points.map(p => {
    const scaledLng = centerPoint.geometry.coordinates[0] + (p.lng - centerPoint.geometry.coordinates[0]) * scale + dLng;
    const scaledLat = centerPoint.geometry.coordinates[1] + (p.lat - centerPoint.geometry.coordinates[1]) * scale + dLat;
    return { lat: scaledLat, lng: scaledLng };
  });
}

export function generateCircle(center: Point, distanceKm: number): Point[] {
  return scaleAndCenter(generateNormalizedCircle().map(p => ({ lat: p.y, lng: p.x })), center, distanceKm);
}

export function generateHeart(center: Point, distanceKm: number): Point[] {
  return scaleAndCenter(generateNormalizedHeart().map(p => ({ lat: p.y, lng: p.x })), center, distanceKm);
}

export function generateStar(center: Point, distanceKm: number): Point[] {
  return scaleAndCenter(generateNormalizedStar().map(p => ({ lat: p.y, lng: p.x })), center, distanceKm);
}

export function generateInfinity(center: Point, distanceKm: number): Point[] {
  return scaleAndCenter(generateNormalizedInfinity().map(p => ({ lat: p.y, lng: p.x })), center, distanceKm);
}

export function generateArrow(center: Point, distanceKm: number): Point[] {
  return scaleAndCenter(generateNormalizedArrow().map(p => ({ lat: p.y, lng: p.x })), center, distanceKm);
}

export function generateLightning(center: Point, distanceKm: number): Point[] {
  return scaleAndCenter(generateNormalizedLightning().map(p => ({ lat: p.y, lng: p.x })), center, distanceKm);
}

export function generateSquare(center: Point, distanceKm: number): Point[] {
  const points = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }
  ];
  return scaleAndCenter(points.map(p => ({ lat: p.y, lng: p.x })), center, distanceKm);
}

export function generateText(text: string, center: Point, distanceKm: number): Point[] {
  // This is now handled by composeWordPath in gpsFont.ts
  // But we'll keep a stub for compatibility in App.tsx preview
  return [];
}
