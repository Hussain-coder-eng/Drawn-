import { Point } from "./shapeMath";

function haversineKm(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function calculateRouteDistanceKm(points: Point[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(points[i - 1], points[i]);
  }
  return total;
}

function subsample(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

export function buildGoogleMapsUrl(waypoints: Point[]): string {
  if (waypoints.length < 2) return "";
  const sampled = subsample(waypoints, 10);
  const origin = `${sampled[0].lat},${sampled[0].lng}`;
  const destination = `${sampled[sampled.length - 1].lat},${sampled[sampled.length - 1].lng}`;
  const middle = sampled.slice(1, -1).map(p => `${p.lat},${p.lng}`).join("|");
  const base = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;
  return middle ? `${base}&waypoints=${encodeURIComponent(middle)}` : base;
}

// Apple Maps supports chained stops via "+to:" in the daddr parameter.
// We subsample the route to 7 points (start + 5 intermediate + end) so the
// user is guided through the actual GPS art path, not just A→B.
export function buildAppleMapsUrl(waypoints: Point[]): string {
  if (waypoints.length < 2) return "";
  const sampled = subsample(waypoints, 7);
  const start = sampled[0];
  const stops = sampled.slice(1).map(p => `${p.lat},${p.lng}`).join("+to:");
  return `maps://?saddr=${start.lat},${start.lng}&daddr=${stops}&dirflg=w`;
}

export function copyMapsLink(waypoints: Point[]): Promise<void> {
  const url = buildGoogleMapsUrl(waypoints);
  if (!url) return Promise.resolve();
  return navigator.clipboard.writeText(url);
}
