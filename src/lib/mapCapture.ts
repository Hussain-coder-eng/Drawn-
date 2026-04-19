import { Point } from "../lib/shapeMath";

/**
 * Step 1 — Capture a Static Map Snapshot of the User's Area
 * Method A — OpenStreetMap Static Image URL
 */
export async function captureOSMStaticMap(center: Point, zoom: number = 15, size: string = "600x600"): Promise<string> {
  const url = `https://staticmap.openstreetmap.de/staticmap.php?center=${center.lat},${center.lng}&zoom=${zoom}&size=${size}&maptype=osm`;
  
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Error capturing OSM static map:", error);
    throw new Error("Failed to capture map snapshot. Please try again.");
  }
}

/**
 * Adjust zoom level based on target distance
 * Zoom 15 is ~1-2km, Zoom 13 is ~5-10km
 */
export function getZoomForDistance(distanceKm: number): number {
  if (distanceKm <= 2) return 16;
  if (distanceKm <= 5) return 15;
  if (distanceKm <= 10) return 14;
  if (distanceKm <= 20) return 13;
  return 12;
}

/**
 * Calculate radius in KM shown in image based on zoom level
 * (Very rough approximation for 600x600 image)
 */
export function getRadiusForZoom(zoom: number): number {
  const radii: Record<number, number> = {
    16: 0.5,
    15: 1.0,
    14: 2.5,
    13: 5.0,
    12: 10.0
  };
  return radii[zoom] || 1.0;
}
