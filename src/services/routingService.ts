import * as turf from "@turf/turf";
import { Point } from "../lib/shapeMath";

const OSRM_BASE_URL = "https://router.project-osrm.org";
const ORS_BASE_URL = "https://api.openrouteservice.org/v2";

export class RoutingService {
  private orsApiKey: string;

  constructor(orsApiKey: string = "") {
    this.orsApiKey = orsApiKey;
  }

  private async fetchOSRM(url: string): Promise<any> {
    let response;
    let retries = 3;
    while (retries > 0) {
      try {
        response = await fetch(url, {
          signal: AbortSignal.timeout(10000) // 10s timeout
        });
        if (response.ok) break;
        console.warn(`OSRM fetch failed with status ${response.status}. Retrying... (${retries} left)`);
      } catch (e) {
        console.warn(`OSRM fetch error: ${e}. Retrying... (${retries} left)`);
      }
      retries--;
      if (retries > 0) await new Promise(r => setTimeout(r, 1000));
    }

    if (!response || !response.ok) {
      throw new Error("The routing server (OSRM) is currently unreachable or overloaded. Please try again in a few moments.");
    }

    return await response.json();
  }

  // 3a - Nearest Street Snap
  async snapToNearest(point: Point): Promise<Point> {
    const url = `${OSRM_BASE_URL}/nearest/v1/driving/${point.lng},${point.lat}?number=1`;
    const data = await this.fetchOSRM(url);
    if (data.code === "Ok" && data.waypoints.length > 0) {
      const snapped = data.waypoints[0].location;
      return { lat: snapped[1], lng: snapped[0] };
    }
    return point;
  }

  // Parallel batch snap
  async batchSnap(points: Point[]): Promise<Point[]> {
    return Promise.all(points.map(point => this.snapToNearest(point)));
  }

  // 3b - Route Between Snapped Waypoints (OSRM)
  async routeOSRM(points: Point[]): Promise<Point[]> {
    if (points.length < 2) return points;

    // OSRM limit is 25 coordinates per request
    const CHUNK_SIZE = 25;
    const chunks: Point[][] = [];
    for (let i = 0; i < points.length; i += CHUNK_SIZE - 1) {
      chunks.push(points.slice(i, i + CHUNK_SIZE));
      if (i + CHUNK_SIZE >= points.length) break;
    }

    const chunkPromises = chunks.map(async (chunk) => {
      const coordStr = chunk.map(p => `${p.lng},${p.lat}`).join(";");
      const url = `${OSRM_BASE_URL}/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
      const data = await this.fetchOSRM(url);

      if (data.code === "Ok" && data.routes.length > 0) {
        return data.routes[0].geometry.coordinates.map((c: [number, number]) => ({
          lat: c[1],
          lng: c[0]
        }));
      } else {
        console.error("OSRM Route Error:", data);
        throw new Error(`Routing failed: ${data.message || data.code}`);
      }
    });

    const results = await Promise.all(chunkPromises);
    const allCoords = results.flat();

    // Remove duplicate consecutive points
    return allCoords.filter((p, i, arr) => i === 0 || p.lat !== arr[i-1].lat || p.lng !== arr[i-1].lng);
  }

  // 3c - Fallback to OpenRouteService
  async routeORS(points: Point[]): Promise<Point[]> {
    if (!this.orsApiKey) throw new Error("OpenRouteService API key missing");
    
    const url = `${ORS_BASE_URL}/directions/driving-car/geojson`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": this.orsApiKey
      },
      body: JSON.stringify({
        coordinates: points.map(p => [p.lng, p.lat])
      })
    });

    const data = await response.json();
    if (data.features && data.features.length > 0) {
      return data.features[0].geometry.coordinates.map((c: [number, number]) => ({
        lat: c[1],
        lng: c[0]
      }));
    }
    throw new Error("OpenRouteService failed to generate route");
  }

  async connectNodesWithOSRM(nodes: Point[]): Promise<Point[]> {
    if (nodes.length < 2) return nodes;

    // OSRM limit is 25 coordinates per request
    const CHUNK_SIZE = 25;
    const chunks: Point[][] = [];
    for (let i = 0; i < nodes.length; i += CHUNK_SIZE - 1) {
      chunks.push(nodes.slice(i, i + CHUNK_SIZE));
      if (i + CHUNK_SIZE >= nodes.length) break;
    }

    const chunkPromises = chunks.map(async (chunk) => {
      const coordStr = chunk.map(p => `${p.lng},${p.lat}`).join(";");
      const url = `${OSRM_BASE_URL}/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
      const data = await this.fetchOSRM(url);

      if (data.code === "Ok" && data.routes.length > 0) {
        return data.routes[0].geometry.coordinates.map((c: [number, number]) => ({
          lat: c[1],
          lng: c[0]
        }));
      } else {
        console.error("OSRM Route Error:", data);
        throw new Error(`Routing failed: ${data.message || data.code}`);
      }
    });

    const results = await Promise.all(chunkPromises);
    const allCoords = results.flat();

    // Remove duplicate consecutive points
    const finalRoute = allCoords.filter((p, i, arr) => i === 0 || p.lat !== arr[i-1].lat || p.lng !== arr[i-1].lng);

    // Verify no gaps larger than 100 meters (OSRM usually snaps to roads, but let's be safe)
    for (let i = 0; i < finalRoute.length - 1; i++) {
      const p1 = turf.point([finalRoute[i].lng, finalRoute[i].lat]);
      const p2 = turf.point([finalRoute[i+1].lng, finalRoute[i+1].lat]);
      const dist = turf.distance(p1, p2, { units: "meters" });
      if (dist > 1000) { // 1km gap is a major failure in routing
        console.warn(`Large gap detected in route at index ${i}: ${dist}m`);
      }
    }

    return finalRoute;
  }

  // Step 4 - Calculate Shape Fidelity Using Turf.js
  calculateFidelity(idealPoints: Point[], snappedPoints: Point[]): number {
    if (idealPoints.length < 2 || snappedPoints.length < 2) return 0;

    // Use convex hull area comparison for visual fidelity
    const idealHull = turf.convex(turf.featureCollection(idealPoints.map(p => turf.point([p.lng, p.lat]))));
    const snappedHull = turf.convex(turf.featureCollection(snappedPoints.map(p => turf.point([p.lng, p.lat]))));

    if (!idealHull || !snappedHull) return 0;

    const idealArea = turf.area(idealHull);
    const snappedArea = turf.area(snappedHull);

    // Accuracy score based on area similarity
    const ratio = Math.min(idealArea, snappedArea) / Math.max(idealArea, snappedArea);
    return Math.round(ratio * 100);
  }
}
