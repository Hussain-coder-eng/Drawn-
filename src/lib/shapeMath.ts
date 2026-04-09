import * as turf from "@turf/turf";

export interface Point {
  lat: number;
  lng: number;
}

// Simple font map for block letters (normalized 0-1 range)
const FONT_MAP: Record<string, [number, number][]> = {
  'A': [[0, 0], [0.5, 1], [1, 0], [0.75, 0.5], [0.25, 0.5]],
  'B': [[0, 0], [0, 1], [0.7, 1], [1, 0.75], [0.7, 0.5], [0, 0.5], [0.7, 0.5], [1, 0.25], [0.7, 0], [0, 0]],
  'C': [[1, 0.8], [0.8, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0], [0.8, 0], [1, 0.2]],
  'D': [[0, 0], [0, 1], [0.7, 1], [1, 0.7], [1, 0.3], [0.7, 0], [0, 0]],
  'E': [[1, 1], [0, 1], [0, 0.5], [0.8, 0.5], [0, 0.5], [0, 0], [1, 0]],
  'F': [[1, 1], [0, 1], [0, 0.5], [0.8, 0.5], [0, 0.5], [0, 0]],
  'G': [[1, 0.8], [0.8, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0], [0.8, 0], [1, 0.2], [1, 0.5], [0.6, 0.5]],
  'H': [[0, 1], [0, 0], [0, 0.5], [1, 0.5], [1, 1], [1, 0]],
  'I': [[0, 1], [1, 1], [0.5, 1], [0.5, 0], [0, 0], [1, 0]],
  'J': [[0.2, 0.2], [0.5, 0], [0.8, 0.2], [0.8, 1], [0, 1]],
  'K': [[0, 1], [0, 0], [0, 0.5], [1, 1], [0, 0.5], [1, 0]],
  'L': [[0, 1], [0, 0], [1, 0]],
  'M': [[0, 0], [0, 1], [0.5, 0.5], [1, 1], [1, 0]],
  'N': [[0, 0], [0, 1], [1, 0], [1, 1]],
  'O': [[0.2, 0], [0.8, 0], [1, 0.2], [1, 0.8], [0.8, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0]],
  'P': [[0, 0], [0, 1], [0.8, 1], [1, 0.8], [1, 0.6], [0.8, 0.5], [0, 0.5]],
  'Q': [[0.2, 0], [0.8, 0], [1, 0.2], [1, 0.8], [0.8, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0], [0.5, 0.5], [1, 0]],
  'R': [[0, 0], [0, 1], [0.8, 1], [1, 0.8], [1, 0.6], [0.8, 0.5], [0, 0.5], [0.8, 0.5], [1, 0]],
  'S': [[1, 0.8], [0.8, 1], [0.2, 1], [0, 0.8], [0, 0.6], [0.2, 0.5], [0.8, 0.5], [1, 0.4], [1, 0.2], [0.8, 0], [0, 0.2]],
  'T': [[0, 1], [1, 1], [0.5, 1], [0.5, 0]],
  'U': [[0, 1], [0, 0.2], [0.2, 0], [0.8, 0], [1, 0.2], [1, 1]],
  'V': [[0, 1], [0.5, 0], [1, 1]],
  'W': [[0, 1], [0.25, 0], [0.5, 0.5], [0.75, 0], [1, 1]],
  'X': [[0, 1], [1, 0], [0.5, 0.5], [0, 0], [1, 1]],
  'Y': [[0, 1], [0.5, 0.5], [1, 1], [0.5, 0.5], [0.5, 0]],
  'Z': [[0, 1], [1, 1], [0, 0], [1, 0]],
  ' ': [[0.5, 0.5]]
};

export function generateCircle(center: Point, distanceKm: number): Point[] {
  const radiusKm = distanceKm / (2 * Math.PI);
  const points: Point[] = [];
  for (let i = 0; i <= 36; i++) {
    const angle = (i * 10 * Math.PI) / 180;
    const destination = turf.destination(
      turf.point([center.lng, center.lat]),
      radiusKm,
      (angle * 180) / Math.PI,
      { units: "kilometers" }
    );
    points.push({
      lat: destination.geometry.coordinates[1],
      lng: destination.geometry.coordinates[0],
    });
  }
  return points;
}

export function generateHeart(center: Point, distanceKm: number): Point[] {
  // Parametric heart: x = 16sin^3(t), y = 13cos(t) - 5cos(2t) - 2cos(3t) - cos(4t)
  const points: Point[] = [];
  for (let t = 0; t <= Math.PI * 2; t += 0.1) {
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    points.push({ lat: y, lng: x });
  }
  return scaleAndCenter(points, center, distanceKm);
}

export function generateStar(center: Point, distanceKm: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= 10; i++) {
    const r = i % 2 === 0 ? 20 : 8;
    const angle = (i * Math.PI * 2) / 10;
    points.push({ lat: Math.cos(angle) * r, lng: Math.sin(angle) * r });
  }
  return scaleAndCenter(points, center, distanceKm);
}

export function generateInfinity(center: Point, distanceKm: number): Point[] {
  // Lemniscate of Bernoulli: x = cos(t)/(1+sin^2(t)), y = sin(t)cos(t)/(1+sin^2(t))
  const points: Point[] = [];
  for (let t = 0; t <= Math.PI * 2; t += 0.1) {
    const denom = 1 + Math.pow(Math.sin(t), 2);
    const x = Math.cos(t) / denom;
    const y = (Math.sin(t) * Math.cos(t)) / denom;
    points.push({ lat: y, lng: x });
  }
  return scaleAndCenter(points, center, distanceKm);
}

export function generateArrow(center: Point, distanceKm: number): Point[] {
  const points: Point[] = [
    { lat: 0, lng: 0 },
    { lat: 10, lng: 0 },
    { lat: 10, lng: -5 },
    { lat: 15, lng: 2.5 },
    { lat: 10, lng: 10 },
    { lat: 10, lng: 5 },
    { lat: 0, lng: 5 },
    { lat: 0, lng: 0 }
  ];
  return scaleAndCenter(points, center, distanceKm);
}

export function generateLightning(center: Point, distanceKm: number): Point[] {
  const points: Point[] = [
    { lat: 10, lng: 5 },
    { lat: 0, lng: 0 },
    { lat: 0, lng: 5 },
    { lat: -10, lng: 0 }
  ];
  return scaleAndCenter(points, center, distanceKm);
}

export function generateSquare(center: Point, distanceKm: number): Point[] {
  const side = distanceKm / 4;
  const points: Point[] = [
    { lat: 0, lng: 0 },
    { lat: side, lng: 0 },
    { lat: side, lng: side },
    { lat: 0, lng: side },
    { lat: 0, lng: 0 }
  ];
  return scaleAndCenter(points, center, distanceKm);
}

export function generateText(text: string, center: Point, distanceKm: number): Point[] {
  const points: Point[] = [];
  const chars = text.toUpperCase().split('');
  const charWidth = 1.2; // spacing between chars
  
  chars.forEach((char, index) => {
    const charCoords = FONT_MAP[char] || FONT_MAP[' '];
    const offset = index * charWidth;
    charCoords.forEach(([x, y]) => {
      points.push({ lat: y, lng: x + offset });
    });
  });
  
  return scaleAndCenter(points, center, distanceKm);
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
