import * as turf from "@turf/turf";
import { Point } from "../lib/shapeMath";

const OSRM_MIRRORS = [
  "https://router.project-osrm.org",
  "https://routing.openstreetmap.de/routed-car",
  "https://osrm.map.m-v.de"
];
const ORS_BASE_URL = "https://api.openrouteservice.org/v2";

export class RoutingService {
  private orsApiKey: string;
  private currentMirrorIndex: number = 0;

  constructor(orsApiKey: string = "") {
    this.orsApiKey = orsApiKey;
  }

  private async fetchOSRM(urlPath: string): Promise<any> {
    let response;
    let retriesPerMirror = 2;
    
    // Try each mirror
    for (let m = 0; m < OSRM_MIRRORS.length; m++) {
      const mirror = OSRM_MIRRORS[(this.currentMirrorIndex + m) % OSRM_MIRRORS.length];
      const fullUrl = `${mirror}${urlPath}`;
      
      let attempt = 0;
      while (attempt < retriesPerMirror) {
        try {
          response = await fetch(fullUrl, {
            signal: AbortSignal.timeout(8000) // 8s timeout per attempt
          });
          
          if (response.ok) {
            this.currentMirrorIndex = (this.currentMirrorIndex + m) % OSRM_MIRRORS.length;
            return await response.json();
          }
          
          if (response.status === 429 || response.status >= 500) {
            const delay = Math.pow(2, attempt + 1) * 1000;
            console.warn(`OSRM mirror ${mirror} busy (${response.status}). Retrying...`);
            await new Promise(r => setTimeout(r, delay));
          } else {
            break; // Non-retryable status
          }
        } catch (e) {
          console.warn(`OSRM mirror ${mirror} error: ${e}.`);
        }
        attempt++;
      }
    }

    return null;
  }

  // 3a - Nearest Street Snap
  async snapToNearest(point: Point): Promise<Point> {
    const data = await this.fetchOSRM(`/nearest/v1/driving/${point.lng},${point.lat}?number=1`);
    if (data && data.code === "Ok" && data.waypoints.length > 0) {
      const snapped = data.waypoints[0].location;
      return { lat: snapped[1], lng: snapped[0] };
    }
    return point;
  }

  // Parallel batch snap
  async batchSnap(points: Point[]): Promise<Point[]> {
    return Promise.all(points.map(point => this.snapToNearest(point)));
  }

  lockAnchorPointsToNodes(anchorPoints: (Point & { anchorRank?: number })[], osmNodes: Map<string, any>) {
    return anchorPoints.map(anchor => {
      let nearestNodeId: string | null = null;
      let nearestDistance = Infinity;

      for (const [nodeId, node] of osmNodes.entries()) {
        const dist = turf.distance(
          turf.point([anchor.lng, anchor.lat]),
          turf.point([node.lng, node.lat]),
          { units: 'meters' }
        );
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestNodeId = nodeId;
        }
      }

      const nearestNode = nearestNodeId ? osmNodes.get(nearestNodeId) : null;

      return {
        ...anchor,
        lockedNodeId: nearestNodeId,
        lockedNode: nearestNode,
        snapDistanceM: nearestDistance,
        snapWarning: nearestDistance > 80
      };
    });
  }

  buildOSRMWaypointArray(geminiStages: any[], lockedAnchors: any[], osmNodes: Map<string, any>) {
    const waypointArray: (Point & { isLocked?: boolean })[] = [];

    for (const stage of geminiStages) {
      const stageAnchor = lockedAnchors.find(a => a.stageIndex === stage.stageIndex);

      if (stageAnchor) {
        const stageNodes = stage.nodeIds.map((id: string) => osmNodes.get(id)).filter(Boolean);
        const anchorNode = osmNodes.get(stageAnchor.lockedNodeId);

        if (anchorNode) {
          waypointArray.push(...stageNodes.slice(0, -1));
          waypointArray.push({ ...anchorNode, isLocked: true });
        }
      } else {
        const stageNodes = stage.nodeIds.map((id: string) => osmNodes.get(id)).filter(Boolean);
        waypointArray.push(...stageNodes);
      }
    }

    return waypointArray.filter((node, i) => {
      if (i === 0) return true;
      return node.lat !== waypointArray[i-1].lat || node.lng !== waypointArray[i-1].lng;
    });
  }

  async routeWithLockedWaypoints(waypointArray: (Point & { isLocked?: boolean })[]) {
    const OSRM_LIMIT = 25;

    function chunkWithAnchorRespect(waypoints: any[], lockedIndices: number[], limit: number) {
      const chunks = [];
      let start = 0;

      while (start < waypoints.length) {
        let end = Math.min(start + limit - 1, waypoints.length - 1);

        const lockedInChunk = lockedIndices.filter(i => i > start && i < end);
        if (lockedInChunk.length > 0) {
          end = lockedInChunk[lockedInChunk.length - 1];
        }

        chunks.push(waypoints.slice(start, end + 1));
        if (end === waypoints.length - 1) break;
        start = end;
      }

      return chunks;
    }

    const lockedIndices = waypointArray
      .map((w, i) => w.isLocked ? i : -1)
      .filter(i => i !== -1);

    const chunks = chunkWithAnchorRespect(waypointArray, lockedIndices, OSRM_LIMIT);
    const results = await Promise.all(chunks.map(async (chunk) => {
      const coordStr = chunk.map(p => `${p.lng},${p.lat}`).join(";");
      const data = await this.fetchOSRM(`/route/v1/foot/${coordStr}?overview=full&geometries=geojson`);

      if (data && data.code === "Ok" && data.routes.length > 0) {
        return data.routes[0].geometry.coordinates.map((c: [number, number]) => [c[0], c[1]]);
      }
      throw new Error(`OSRM routing failed for chunk: ${data?.code || 'Unknown'}`);
    }));

    const allCoords: [number, number][] = [];
    for (let i = 0; i < results.length; i++) {
      const coords = results[i];
      if (i === 0) {
        allCoords.push(...coords);
      } else {
        allCoords.push(...coords.slice(1));
      }
    }

    const anchorVerification = lockedIndices.map(idx => {
      const anchor = waypointArray[idx];
      const anchorPoint = turf.point([anchor.lng, anchor.lat]);
      const polyline = turf.lineString(allCoords);
      const snapped = turf.nearestPointOnLine(polyline, anchorPoint, { units: 'meters' });
      return {
        anchorLat: anchor.lat,
        anchorLng: anchor.lng,
        distanceFromPolylineM: snapped.properties.dist,
        passed: (snapped.properties.dist || 0) < 30
      };
    });

    return {
      polylineCoords: allCoords,
      anchorVerification
    };
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

    try {
      const results = await Promise.all(chunks.map(async (chunk) => {
        const coordStr = chunk.map(p => `${p.lng},${p.lat}`).join(";");
        const data = await this.fetchOSRM(`/route/v1/driving/${coordStr}?overview=full&geometries=geojson`);

        if (data && data.code === "Ok" && data.routes.length > 0) {
          return data.routes[0].geometry.coordinates.map((c: [number, number]) => ({
            lat: c[1],
            lng: c[0]
          }));
        }
        throw new Error("OSRM_FAILED");
      }));

      const allCoords = results.flat();
      return allCoords.filter((p, i, arr) => i === 0 || p.lat !== arr[i-1].lat || p.lng !== arr[i-1].lng);
    } catch (e) {
      if (this.orsApiKey && this.orsApiKey.length > 10) {
        console.warn("All OSRM mirrors failed, falling back to OpenRouteService...");
        return this.routeORS(points);
      }
      throw new Error("Routing servers are currently unreachable. Please check your internet connection or try again later.");
    }
  }

  // 3c - Fallback to OpenRouteService
  async routeORS(points: Point[]): Promise<Point[]> {
    if (!this.orsApiKey) throw new Error("OpenRouteService API key missing. Please check your .env file.");
    
    const url = `${ORS_BASE_URL}/directions/driving-car/geojson`;
    let lastError: any = null;
    let attempt = 0;
    const maxRetries = 3;

    while (attempt < maxRetries) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": this.orsApiKey
          },
          body: JSON.stringify({
            coordinates: points.map(p => [p.lng, p.lat])
          }),
          signal: AbortSignal.timeout(15000) // 15s timeout
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`ORS HTTP ${response.status}: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        if (data.features && data.features.length > 0) {
          return data.features[0].geometry.coordinates.map((c: [number, number]) => ({
            lat: c[1],
            lng: c[0]
          }));
        }
        throw new Error("OpenRouteService returned no route features.");
      } catch (e: any) {
        lastError = e;
        attempt++;
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`ORS fetch failed: ${e.message}. Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw new Error(`OpenRouteService failed after ${maxRetries} attempts. Error: ${lastError?.message || "Network Error"}`);
  }

  async connectNodesWithOSRM(nodes: Point[], idealPath: Point[] = []): Promise<Point[]> {
    if (nodes.length < 2) return nodes;

    // If we have an ideal path, we can inject intermediate waypoints to force the router to follow it
    let waypoints = nodes;
    if (idealPath.length > 2) {
      waypoints = this.injectIntermediateWaypoints(nodes, idealPath);
    }

    // OSRM limit is 25 coordinates per request
    const CHUNK_SIZE = 25;
    const chunks: Point[][] = [];
    for (let i = 0; i < waypoints.length; i += CHUNK_SIZE - 1) {
      chunks.push(waypoints.slice(i, i + CHUNK_SIZE));
      if (i + CHUNK_SIZE >= waypoints.length) break;
    }

    try {
      const results = await Promise.all(chunks.map(async (chunk) => {
        const coordStr = chunk.map(p => `${p.lng},${p.lat}`).join(";");
        const data = await this.fetchOSRM(`/route/v1/driving/${coordStr}?overview=full&geometries=geojson`);

        if (data && data.code === "Ok" && data.routes.length > 0) {
          return data.routes[0].geometry.coordinates.map((c: [number, number]) => ({
            lat: c[1],
            lng: c[0]
          }));
        }
        throw new Error("OSRM_FAILED");
      }));

      const allCoords = results.flat();

      // Remove duplicate consecutive points
      const finalRoute = allCoords.filter((p, i, arr) => i === 0 || p.lat !== arr[i-1].lat || p.lng !== arr[i-1].lng);

      // Verify no gaps larger than 1000 meters
      for (let i = 0; i < finalRoute.length - 1; i++) {
        const p1 = turf.point([finalRoute[i].lng, finalRoute[i].lat]);
        const p2 = turf.point([finalRoute[i+1].lng, finalRoute[i+1].lat]);
        const dist = turf.distance(p1, p2, { units: "meters" });
        if (dist > 1000) {
          console.warn(`Large gap detected in route at index ${i}: ${dist}m`);
        }
      }

      return finalRoute;
    } catch (e) {
      if (this.orsApiKey && this.orsApiKey.length > 10) {
        console.warn("All OSRM mirrors failed, falling back to OpenRouteService...");
        return this.routeORS(waypoints);
      }
      throw new Error("Routing servers are currently unreachable. Please check your internet connection or try again later.");
    }
  }

  /**
   * Injects points from the ideal path between AI-selected nodes to force the router to follow the curve.
   */
  private injectIntermediateWaypoints(selectedNodes: Point[], idealPath: Point[]): Point[] {
    if (selectedNodes.length < 2 || idealPath.length < 2) return selectedNodes;

    const result: Point[] = [selectedNodes[0]];
    const idealLine = turf.lineString(idealPath.map(p => [p.lng, p.lat]));

    for (let i = 0; i < selectedNodes.length - 1; i++) {
      const start = selectedNodes[i];
      const end = selectedNodes[i + 1];

      // Find the segments of the ideal path that lie between these two nodes
      const startPt = turf.point([start.lng, start.lat]);
      const endPt = turf.point([end.lng, end.lat]);

      // Find the closest points on the ideal line to our start/end nodes
      const startOnLine = turf.nearestPointOnLine(idealLine, startPt);
      const endOnLine = turf.nearestPointOnLine(idealLine, endPt);

      const startLoc = startOnLine.properties.location || 0;
      const endLoc = endOnLine.properties.location || 0;

      // If they are far apart on the ideal line, inject the points in between
      if (Math.abs(endLoc - startLoc) > 0.1) {
        // Slice the ideal line
        try {
          const sliced = turf.lineSliceAlong(idealLine, Math.min(startLoc, endLoc), Math.max(startLoc, endLoc));
          const intermediatePoints = sliced.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
          
          // If reversed, flip them
          if (startLoc > endLoc) intermediatePoints.reverse();

          // Add them to result (skipping first and last as they are roughly our start/end)
          for (let j = 1; j < intermediatePoints.length - 1; j++) {
            result.push(intermediatePoints[j]);
          }
        } catch (e) {
          console.warn("Failed to slice ideal line:", e);
        }
      }

      result.push(end);
    }

    return result;
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
