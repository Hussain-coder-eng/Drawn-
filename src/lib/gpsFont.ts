import * as turf from "@turf/turf";
import { Point, NormalizedPoint } from "./shapeMath";

export interface FontChar {
  waypoints: NormalizedPoint[];
  entry: NormalizedPoint;
  exit: NormalizedPoint;
  width: number;
}

export const GPS_FONT: Record<string, FontChar> = {
  'A': {
    waypoints: [
      { x: 0.0, y: 1.0 }, { x: 0.5, y: 0.0 }, { x: 1.0, y: 1.0 },
      { x: 0.75, y: 0.5 }, { x: 0.25, y: 0.5 }
    ],
    entry: { x: 0.0, y: 1.0 },
    exit: { x: 1.0, y: 1.0 },
    width: 1.0
  },
  'B': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 0.0, y: 1.0 }, { x: 0.7, y: 1.0 }, { x: 1.0, y: 0.75 },
      { x: 0.7, y: 0.5 }, { x: 0.0, y: 0.5 }, { x: 0.7, y: 0.5 }, { x: 1.0, y: 0.25 },
      { x: 0.7, y: 0.0 }, { x: 0.0, y: 0.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 0.0, y: 1.0 },
    width: 1.0
  },
  'C': {
    waypoints: [
      { x: 1.0, y: 0.2 }, { x: 0.8, y: 0.0 }, { x: 0.2, y: 0.0 }, { x: 0.0, y: 0.2 },
      { x: 0.0, y: 0.8 }, { x: 0.2, y: 1.0 }, { x: 0.8, y: 1.0 }, { x: 1.0, y: 0.8 }
    ],
    entry: { x: 1.0, y: 0.2 },
    exit: { x: 1.0, y: 0.8 },
    width: 1.0
  },
  'D': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 0.0, y: 1.0 }, { x: 0.6, y: 1.0 }, { x: 1.0, y: 0.7 },
      { x: 1.0, y: 0.3 }, { x: 0.6, y: 0.0 }, { x: 0.0, y: 0.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 0.0, y: 1.0 },
    width: 1.0
  },
  'E': {
    waypoints: [
      { x: 1.0, y: 0.0 }, { x: 0.0, y: 0.0 }, { x: 0.0, y: 0.5 }, { x: 0.7, y: 0.5 },
      { x: 0.0, y: 0.5 }, { x: 0.0, y: 1.0 }, { x: 1.0, y: 1.0 }
    ],
    entry: { x: 1.0, y: 0.0 },
    exit: { x: 1.0, y: 1.0 },
    width: 1.0
  },
  'F': {
    waypoints: [
      { x: 1.0, y: 0.0 }, { x: 0.0, y: 0.0 }, { x: 0.0, y: 0.5 }, { x: 0.7, y: 0.5 },
      { x: 0.0, y: 0.5 }, { x: 0.0, y: 1.0 }
    ],
    entry: { x: 1.0, y: 0.0 },
    exit: { x: 0.0, y: 1.0 },
    width: 1.0
  },
  'G': {
    waypoints: [
      { x: 1.0, y: 0.3 }, { x: 1.0, y: 0.0 }, { x: 0.2, y: 0.0 }, { x: 0.0, y: 0.2 },
      { x: 0.0, y: 0.8 }, { x: 0.2, y: 1.0 }, { x: 0.8, y: 1.0 }, { x: 1.0, y: 0.8 },
      { x: 1.0, y: 0.5 }, { x: 0.6, y: 0.5 }
    ],
    entry: { x: 1.0, y: 0.3 },
    exit: { x: 0.6, y: 0.5 },
    width: 1.0
  },
  'H': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 0.0, y: 1.0 }, { x: 0.0, y: 0.5 }, { x: 1.0, y: 0.5 },
      { x: 1.0, y: 0.0 }, { x: 1.0, y: 1.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 1.0, y: 1.0 },
    width: 1.0
  },
  'I': {
    waypoints: [
      { x: 0.2, y: 0.0 }, { x: 0.8, y: 0.0 }, { x: 0.5, y: 0.0 }, { x: 0.5, y: 1.0 },
      { x: 0.2, y: 1.0 }, { x: 0.8, y: 1.0 }
    ],
    entry: { x: 0.2, y: 0.0 },
    exit: { x: 0.8, y: 1.0 },
    width: 0.6
  },
  'J': {
    waypoints: [
      { x: 0.0, y: 0.7 }, { x: 0.3, y: 1.0 }, { x: 0.7, y: 1.0 }, { x: 0.7, y: 0.0 },
      { x: 0.2, y: 0.0 }, { x: 1.0, y: 0.0 }
    ],
    entry: { x: 0.0, y: 0.7 },
    exit: { x: 1.0, y: 0.0 },
    width: 1.0
  },
  'K': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 0.0, y: 1.0 }, { x: 0.0, y: 0.5 }, { x: 1.0, y: 0.0 },
      { x: 0.0, y: 0.5 }, { x: 1.0, y: 1.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 1.0, y: 1.0 },
    width: 1.0
  },
  'L': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 0.0, y: 1.0 }, { x: 1.0, y: 1.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 1.0, y: 1.0 },
    width: 1.0
  },
  'M': {
    waypoints: [
      { x: 0.0, y: 1.0 }, { x: 0.0, y: 0.0 }, { x: 0.5, y: 0.5 }, { x: 1.0, y: 0.0 },
      { x: 1.0, y: 1.0 }
    ],
    entry: { x: 0.0, y: 1.0 },
    exit: { x: 1.0, y: 1.0 },
    width: 1.2
  },
  'N': {
    waypoints: [
      { x: 0.0, y: 1.0 }, { x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }, { x: 1.0, y: 0.0 }
    ],
    entry: { x: 0.0, y: 1.0 },
    exit: { x: 1.0, y: 0.0 },
    width: 1.0
  },
  'O': {
    waypoints: [
      { x: 0.5, y: 1.0 }, { x: 0.1, y: 0.8 }, { x: 0.0, y: 0.5 }, { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.0 }, { x: 0.9, y: 0.2 }, { x: 1.0, y: 0.5 }, { x: 0.9, y: 0.8 },
      { x: 0.5, y: 1.0 }
    ],
    entry: { x: 0.5, y: 1.0 },
    exit: { x: 0.5, y: 1.0 },
    width: 1.0
  },
  'P': {
    waypoints: [
      { x: 0.0, y: 1.0 }, { x: 0.0, y: 0.0 }, { x: 0.7, y: 0.0 }, { x: 1.0, y: 0.25 },
      { x: 0.7, y: 0.5 }, { x: 0.0, y: 0.5 }
    ],
    entry: { x: 0.0, y: 1.0 },
    exit: { x: 0.0, y: 0.5 },
    width: 1.0
  },
  'Q': {
    waypoints: [
      { x: 0.5, y: 1.0 }, { x: 0.1, y: 0.8 }, { x: 0.0, y: 0.5 }, { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.0 }, { x: 0.9, y: 0.2 }, { x: 1.0, y: 0.5 }, { x: 0.9, y: 0.8 },
      { x: 0.5, y: 1.0 }, { x: 0.7, y: 0.7 }, { x: 1.0, y: 1.0 }
    ],
    entry: { x: 0.5, y: 1.0 },
    exit: { x: 1.0, y: 1.0 },
    width: 1.0
  },
  'R': {
    waypoints: [
      { x: 0.0, y: 1.0 }, { x: 0.0, y: 0.0 }, { x: 0.7, y: 0.0 }, { x: 1.0, y: 0.25 },
      { x: 0.7, y: 0.5 }, { x: 0.0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1.0, y: 1.0 }
    ],
    entry: { x: 0.0, y: 1.0 },
    exit: { x: 1.0, y: 1.0 },
    width: 1.0
  },
  'S': {
    waypoints: [
      { x: 1.0, y: 0.2 }, { x: 0.8, y: 0.0 }, { x: 0.2, y: 0.0 }, { x: 0.0, y: 0.2 },
      { x: 0.0, y: 0.4 }, { x: 0.5, y: 0.5 }, { x: 1.0, y: 0.6 }, { x: 1.0, y: 0.8 },
      { x: 0.8, y: 1.0 }, { x: 0.2, y: 1.0 }, { x: 0.0, y: 0.8 }
    ],
    entry: { x: 1.0, y: 0.2 },
    exit: { x: 0.0, y: 0.8 },
    width: 1.0
  },
  'T': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 1.0, y: 0.0 }, { x: 0.5, y: 0.0 }, { x: 0.5, y: 1.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 0.5, y: 1.0 },
    width: 1.0
  },
  'U': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 0.0, y: 0.8 }, { x: 0.2, y: 1.0 }, { x: 0.8, y: 1.0 },
      { x: 1.0, y: 0.8 }, { x: 1.0, y: 0.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 1.0, y: 0.0 },
    width: 1.0
  },
  'V': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 0.5, y: 1.0 }, { x: 1.0, y: 0.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 1.0, y: 0.0 },
    width: 1.0
  },
  'W': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 0.2, y: 1.0 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 1.0 },
      { x: 1.0, y: 0.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 1.0, y: 0.0 },
    width: 1.2
  },
  'X': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }, { x: 0.5, y: 0.5 }, { x: 1.0, y: 0.0 },
      { x: 0.0, y: 1.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 0.0, y: 1.0 },
    width: 1.0
  },
  'Y': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 0.5, y: 0.5 }, { x: 1.0, y: 0.0 }, { x: 0.5, y: 0.5 },
      { x: 0.5, y: 1.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 0.5, y: 1.0 },
    width: 1.0
  },
  'Z': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 1.0, y: 0.0 }, { x: 0.0, y: 1.0 }, { x: 1.0, y: 1.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 1.0, y: 1.0 },
    width: 1.0
  },
  '0': {
    waypoints: [
      { x: 0.5, y: 1.0 }, { x: 0.1, y: 0.8 }, { x: 0.0, y: 0.5 }, { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.0 }, { x: 0.9, y: 0.2 }, { x: 1.0, y: 0.5 }, { x: 0.9, y: 0.8 },
      { x: 0.5, y: 1.0 }, { x: 1.0, y: 0.0 }
    ],
    entry: { x: 0.5, y: 1.0 },
    exit: { x: 1.0, y: 0.0 },
    width: 1.0
  },
  '1': {
    waypoints: [
      { x: 0.2, y: 0.2 }, { x: 0.5, y: 0.0 }, { x: 0.5, y: 1.0 }, { x: 0.2, y: 1.0 },
      { x: 0.8, y: 1.0 }
    ],
    entry: { x: 0.2, y: 0.2 },
    exit: { x: 0.8, y: 1.0 },
    width: 0.6
  },
  '2': {
    waypoints: [
      { x: 0.0, y: 0.2 }, { x: 0.2, y: 0.0 }, { x: 0.8, y: 0.0 }, { x: 1.0, y: 0.2 },
      { x: 1.0, y: 0.4 }, { x: 0.0, y: 1.0 }, { x: 1.0, y: 1.0 }
    ],
    entry: { x: 0.0, y: 0.2 },
    exit: { x: 1.0, y: 1.0 },
    width: 1.0
  },
  '3': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 1.0, y: 0.0 }, { x: 0.5, y: 0.5 }, { x: 1.0, y: 0.5 },
      { x: 1.0, y: 1.0 }, { x: 0.0, y: 1.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 0.0, y: 1.0 },
    width: 1.0
  },
  '4': {
    waypoints: [
      { x: 0.7, y: 1.0 }, { x: 0.7, y: 0.0 }, { x: 0.0, y: 0.7 }, { x: 1.0, y: 0.7 }
    ],
    entry: { x: 0.7, y: 1.0 },
    exit: { x: 1.0, y: 0.7 },
    width: 1.0
  },
  '5': {
    waypoints: [
      { x: 1.0, y: 0.0 }, { x: 0.0, y: 0.0 }, { x: 0.0, y: 0.5 }, { x: 1.0, y: 0.5 },
      { x: 1.0, y: 1.0 }, { x: 0.0, y: 1.0 }
    ],
    entry: { x: 1.0, y: 0.0 },
    exit: { x: 0.0, y: 1.0 },
    width: 1.0
  },
  '6': {
    waypoints: [
      { x: 1.0, y: 0.0 }, { x: 0.0, y: 1.0 }, { x: 1.0, y: 1.0 }, { x: 1.0, y: 0.5 },
      { x: 0.0, y: 0.5 }
    ],
    entry: { x: 1.0, y: 0.0 },
    exit: { x: 0.0, y: 0.5 },
    width: 1.0
  },
  '7': {
    waypoints: [
      { x: 0.0, y: 0.0 }, { x: 1.0, y: 0.0 }, { x: 0.3, y: 1.0 }
    ],
    entry: { x: 0.0, y: 0.0 },
    exit: { x: 0.3, y: 1.0 },
    width: 1.0
  },
  '8': {
    waypoints: [
      { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.3 }, { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.0 },
      { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.3 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.7 },
      { x: 0.1, y: 0.9 }, { x: 0.5, y: 1.0 }, { x: 0.9, y: 0.9 }, { x: 0.9, y: 0.7 },
      { x: 0.5, y: 0.5 }
    ],
    entry: { x: 0.5, y: 0.5 },
    exit: { x: 0.5, y: 0.5 },
    width: 1.0
  },
  '9': {
    waypoints: [
      { x: 1.0, y: 0.5 }, { x: 0.0, y: 0.5 }, { x: 0.0, y: 0.0 }, { x: 1.0, y: 0.0 },
      { x: 1.0, y: 1.0 }
    ],
    entry: { x: 1.0, y: 0.5 },
    exit: { x: 1.0, y: 1.0 },
    width: 1.0
  },
  '.': {
    waypoints: [{ x: 0.5, y: 0.9 }, { x: 0.5, y: 1.0 }],
    entry: { x: 0.5, y: 0.9 },
    exit: { x: 0.5, y: 1.0 },
    width: 0.2
  },
  '!': {
    waypoints: [{ x: 0.5, y: 0.0 }, { x: 0.5, y: 0.7 }, { x: 0.5, y: 0.9 }, { x: 0.5, y: 1.0 }],
    entry: { x: 0.5, y: 0.0 },
    exit: { x: 0.5, y: 1.0 },
    width: 0.2
  },
  '\'': {
    waypoints: [{ x: 0.5, y: 0.0 }, { x: 0.5, y: 0.3 }],
    entry: { x: 0.5, y: 0.0 },
    exit: { x: 0.5, y: 0.3 },
    width: 0.2
  },
  ' ': {
    waypoints: [],
    entry: { x: 0.0, y: 0.5 },
    exit: { x: 1.0, y: 0.5 },
    width: 0.8
  }
};

export function composeWordPath(text: string, totalDistanceKm: number, center: Point): {
  waypoints: Point[];
  letterBoundaries: { letter: string; startIndex: number; endIndex: number }[];
} {
  const letters = text.toUpperCase().split('').filter(c => GPS_FONT[c] || c === ' ');
  const letterSpacing = 0.2;
  
  let currentX = 0;
  const normalizedPath: NormalizedPoint[] = [];
  const letterBoundaries: { letter: string; startIndex: number; endIndex: number }[] = [];

  letters.forEach((char) => {
    const fontChar = GPS_FONT[char] || GPS_FONT[' '];
    const startIndex = normalizedPath.length;
    
    // Add waypoints with offset
    fontChar.waypoints.forEach(wp => {
      normalizedPath.push({ x: currentX + wp.x, y: wp.y });
    });

    const endIndex = normalizedPath.length - 1;
    letterBoundaries.push({ letter: char, startIndex, endIndex });

    currentX += fontChar.width + letterSpacing;
  });

  // Project to real world
  // 1. Calculate total font width
  const totalWidth = currentX - letterSpacing;
  
  // 2. Project normalized points to lat/lng
  // We'll assume the text is centered and scaled to match totalDistanceKm
  // A rough approximation: total length of path in unit space
  let unitLength = 0;
  for (let i = 1; i < normalizedPath.length; i++) {
    const p1 = normalizedPath[i-1];
    const p2 = normalizedPath[i];
    unitLength += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }

  const scale = totalDistanceKm / (unitLength || 1);
  
  // Center the word
  const avgX = totalWidth / 2;
  const avgY = 0.5;

  const realWaypoints = normalizedPath.map(p => {
    const dx = (p.x - avgX) * scale;
    const dy = (p.y - avgY) * scale;
    
    // Convert km to degrees (rough)
    const lat = center.lat - (dy / 111);
    const lng = center.lng + (dx / (111 * Math.cos(center.lat * Math.PI / 180)));
    
    return { lat, lng };
  });

  return {
    waypoints: realWaypoints,
    letterBoundaries
  };
}
