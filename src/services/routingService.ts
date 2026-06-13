import * as turf from "@turf/turf";
import { Point } from "../lib/shapeMath";
import { measureLatency } from "../lib/latency";
import type { OSMNode } from "./overpassService";

// OSRM mirrors with their internal profile name.
// router.project-osrm.org uses the standard /foot/ profile.
// routing.openstreetmap.de selects the engine via path prefix (/routed-foot/),
// but the OSRM API profile name on that server is still "driving" — sending
// /v1/foot/ returns HTTP 400 from that host.
interface OSRMMirror { base: string; profile: string; }
const OSRM_MIRRORS: OSRMMirror[] = [
  { base: "https://router.project-osrm.org", profile: "foot" },
  { base: "https://routing.openstreetmap.de/routed-foot", profile: "driving" },
];
const ORS_BASE_URL = "https://api.openrouteservice.org/v2";

export class RoutingService {
  private orsApiKey: string;
  private currentMirrorIndex: number = 0;
  private snapCache: Map<string, Point> = new Map();
  private mirrorPerformance: Map<string, number[]> = new Map();

  constructor(orsApiKey: string = "") {
    this.orsApiKey = orsApiKey;
  }

  // pathFn receives the mirror's profile name and returns the OSRM API path.
  // e.g. profile => `/route/v1/${profile}/lng,lat;lng,lat?overview=full&geometries=geojson`
  private async fetchOSRM(pathFn: (profile: string) => string): Promise<any> {
    const mirrors = this.getSortedMirrors();
    const controllers = mirrors.map(() => new AbortController());

    const globalTimeout = setTimeout(() => {
      console.warn('[OSRM] Global 20s timeout fired — aborting all mirrors');
      controllers.forEach(c => c.abort());
    }, 20000);

    try {
      const result = await Promise.any(mirrors.map(async (mirror, idx) => {
        const mirrorName = new URL(mirror.base).hostname;
        const urlPath = pathFn(mirror.profile);
        const fullUrl = `${mirror.base}${urlPath}`;

        try {
          const { data: res, latencyMs } = await measureLatency(`OSRM:${mirrorName}`, async () => {
            return await fetch(fullUrl, { signal: controllers[idx].signal });
          }, { silent: true });

          this.recordLatency(mirror.base, latencyMs);

          if (!res.ok) {
            if (res.status === 429 || res.status >= 500) this.recordLatency(mirror.base, 60000);
            const errMsg = `HTTP ${res.status}`;
            console.warn(`[OSRM] ${mirrorName} responded ${errMsg} for ${urlPath.slice(0, 80)}`);
            throw new Error(errMsg);
          }

          // Success — cancel others
          clearTimeout(globalTimeout);
          controllers.forEach((c, cIdx) => { if (cIdx !== idx) c.abort(); });
          return await res.json();
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            this.recordLatency(mirror.base, 60000);
            console.warn(`[OSRM] ${mirrorName} failed: ${err.name} — ${err.message}`);
          } else {
            console.warn(`[OSRM] ${mirrorName} aborted (timeout or cancelled)`);
          }
          throw err;
        }
      }));

      return result;
    } catch (aggErr: any) {
      clearTimeout(globalTimeout);
      controllers.forEach(c => c.abort());
      if (aggErr?.errors) {
        console.warn('[OSRM] All mirrors failed:', aggErr.errors.map((e: any) => `${e.name}: ${e.message}`));
      } else {
        console.warn('[OSRM] All mirrors failed:', aggErr?.message ?? aggErr);
      }
      return null;
    }
  }

  // 3a - Nearest Street Snap
  async snapToNearest(point: Point): Promise<Point> {
    const cacheKey = `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
    if (this.snapCache.has(cacheKey)) return this.snapCache.get(cacheKey)!;

    const data = await this.fetchOSRM(profile => `/nearest/v1/${profile}/${point.lng},${point.lat}?number=1`);
    if (data && data.code === "Ok" && data.waypoints.length > 0) {
      const snapped = data.waypoints[0].location;
      const result = { lat: snapped[1], lng: snapped[0] };
      this.snapCache.set(cacheKey, result);
      return result;
    }
    return point;
  }

  private getSortedMirrors(): OSRMMirror[] {
    return [...OSRM_MIRRORS].sort((a, b) => {
      const perfA = this.getAverageLatency(a.base);
      const perfB = this.getAverageLatency(b.base);
      return perfA - perfB;
    });
  }

  private getAverageLatency(mirror: string): number {
    const history = this.mirrorPerformance.get(mirror);
    if (!history || history.length === 0) return 0;
    return history.reduce((a, b) => a + b, 0) / history.length;
  }

  private recordLatency(mirror: string, latency: number) {
    if (!this.mirrorPerformance.has(mirror)) {
      this.mirrorPerformance.set(mirror, []);
    }
    const history = this.mirrorPerformance.get(mirror)!;
    history.push(latency);
    if (history.length > 5) history.shift();
  }

  // Parallel batch snap
  async batchSnap(points: Point[]): Promise<Point[]> {
    return Promise.all(points.map(point => this.snapToNearest(point)));
  }

  /**
   * Snap each anchor to the nearest OSM node. Prefer `searchPool` (e.g. AI-relevant ~400 nodes):
   * scanning the full `nodeMap` for every projected shape point is O(anchors × nodes) and can
   * freeze the main thread for minutes before OSRM runs.
   */
  lockAnchorPointsToNodes(
    anchorPoints: (Point & { anchorRank?: number })[],
    osmNodes: Map<string, any>,
    searchPool?: OSMNode[]
  ) {
    const candidates: { id: string; lat: number; lng: number }[] = searchPool?.length
      ? searchPool.map(n => ({ id: String(n.id), lat: n.lat, lng: n.lng }))
      : Array.from(osmNodes.entries()).map(([id, n]) => ({
          id,
          lat: n.lat,
          lng: n.lng
        }));

    return anchorPoints.map(anchor => {
      let nearestNodeId: string | null = null;
      let nearestDistance = Infinity;

      for (const node of candidates) {
        const dist = turf.distance(
          turf.point([anchor.lng, anchor.lat]),
          turf.point([node.lng, node.lat]),
          { units: 'meters' }
        );
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestNodeId = node.id;
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
      const scriptStageIndex =
        typeof stage.stageNumber === "number"
          ? stage.stageNumber - 1
          : stage.stageIndex;
      const stageAnchor =
        typeof scriptStageIndex === "number"
          ? lockedAnchors.find(a => a.stageIndex === scriptStageIndex)
          : undefined;

      if (stageAnchor) {
        // nodeIds may be numbers; nodeMap keys are strings — coerce to match
        const stageNodes = stage.nodeIds.map((id: any) => osmNodes.get(String(id))).filter(Boolean);
        const anchorNode = osmNodes.get(stageAnchor.lockedNodeId);

        if (anchorNode) {
          waypointArray.push(...stageNodes.slice(0, -1));
          waypointArray.push({ ...anchorNode, isLocked: true });
        }
      } else {
        const stageNodes = stage.nodeIds.map((id: any) => osmNodes.get(String(id))).filter(Boolean);
        waypointArray.push(...stageNodes);
      }
    }

    // Deduplicate: remove any exact coordinate duplicates (not just consecutive ones)
    // to prevent OSRM from routing A → B → A backtracks.
    const seen = new Set<string>();
    return waypointArray.filter(node => {
      const key = `${node.lat},${node.lng}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async routeWithLockedWaypoints(waypointArray: (Point & { isLocked?: boolean })[]) {
    const OSRM_LIMIT = 25;

    // Guard: OSRM requires at least 2 waypoints. If Gemini returned mostly hallucinated
    // node indices (all failing the indexToId lookup), the array can end up with 0 or 1
    // entries — producing an invalid single-coordinate URL and HTTP 400 on all mirrors.
    if (waypointArray.length < 2) {
      throw new Error(
        `Route generation failed: the AI selected too few valid road nodes (got ${waypointArray.length}). ` +
        `Try generating again — a different road network snapshot usually resolves this.`
      );
    }

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

      // Drop any chunk that ends up with fewer than 2 waypoints — OSRM rejects them.
      return chunks.filter(c => c.length >= 2);
    }

    // Subsample waypoints to at most MAX_WAYPOINTS total to prevent flooding OSRM
    // with hundreds of requests. Locked anchors are always kept; intermediate points
    // are evenly thinned so the route still follows the shape.
    const MAX_WAYPOINTS = 50;
    let routingWaypoints = waypointArray;
    if (waypointArray.length > MAX_WAYPOINTS) {
      const lockedSet = new Set(
        waypointArray.map((w, i) => w.isLocked ? i : -1).filter(i => i !== -1)
      );
      // Always keep first, last, and all locked anchors; fill remaining budget evenly
      const budget = MAX_WAYPOINTS - lockedSet.size - 2; // -2 for first/last
      if (budget > 0) {
        const step = (waypointArray.length - 2) / (budget + 1);
        routingWaypoints = waypointArray.filter((_, i) => {
          if (i === 0 || i === waypointArray.length - 1) return true;
          if (lockedSet.has(i)) return true;
          // Keep evenly-spaced intermediate points within budget
          const slot = Math.round((i - 1) / step);
          return slot > 0 && slot <= budget && Math.round(slot * step) + 1 === i;
        });
      } else {
        // budget <= 0: too many locked anchors to fit unlocked intermediates.
        // Subsample the locked anchors themselves to enforce the MAX_WAYPOINTS cap —
        // keeping all of them unconditionally would exceed ORS/OSRM limits.
        const allowedLocked = MAX_WAYPOINTS - 2; // reserve slots for first + last
        const lockedIndicesAll = Array.from(lockedSet).sort((a, b) => a - b);
        let chosenLocked: number[];
        if (lockedIndicesAll.length > allowedLocked) {
          // Evenly subsample locked indices by position in the sorted array
          chosenLocked = Array.from({ length: allowedLocked }, (_, k) =>
            lockedIndicesAll[Math.round(k * (lockedIndicesAll.length - 1) / (allowedLocked - 1))]
          ).filter((v, i, arr) => arr.indexOf(v) === i); // dedup, preserves order
        } else {
          chosenLocked = lockedIndicesAll;
        }
        const firstIndex = 0;
        const lastIndex = waypointArray.length - 1;
        const chosenSet = new Set(chosenLocked);
        routingWaypoints = waypointArray.filter((_, i) =>
          i === firstIndex || i === lastIndex || chosenSet.has(i)
        );
      }
      // Ensure we have at least 2
      if (routingWaypoints.length < 2) routingWaypoints = [waypointArray[0], waypointArray[waypointArray.length - 1]];
    }

    const lockedIndices = routingWaypoints
      .map((w, i) => w.isLocked ? i : -1)
      .filter(i => i !== -1);

    const chunks = chunkWithAnchorRespect(routingWaypoints, lockedIndices, OSRM_LIMIT);

    if (chunks.length === 0) {
      throw new Error("Route generation failed: no valid waypoint segments to route. Try generating again.");
    }

    console.info('[Routing] waypointArray', {
      originalLength: waypointArray.length,
      subsampledTo: routingWaypoints.length,
      chunkCount: chunks.length,
      hasNaN: routingWaypoints.some(p => isNaN(p.lat) || isNaN(p.lng)),
    });

    // Process chunks sequentially with a small delay to avoid rate-limiting OSRM
    // public mirrors. Parallel was causing 28 simultaneous requests → HTTP 429.
    let results: [number, number][][];
    try {
      results = [];
      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const chunk = chunks[chunkIdx];
        if (chunkIdx > 0) await new Promise(r => setTimeout(r, 150)); // pace requests
        const coordStr = chunk.map((p: Point) => `${p.lng},${p.lat}`).join(";");
        console.info(`[Routing] OSRM chunk ${chunkIdx}/${chunks.length}: ${chunk.length} pts`);
        const data = await this.fetchOSRM(profile => `/route/v1/${profile}/${coordStr}?overview=full&geometries=geojson`);

        if (data && data.code === "Ok" && data.routes.length > 0) {
          results.push(data.routes[0].geometry.coordinates.map((c: [number, number]) => [c[0], c[1]] as [number, number]));
          continue;
        }
        const osrmCode = data?.code ?? 'all mirrors unavailable';
        console.warn(`[Routing] OSRM chunk ${chunkIdx} failed: code=${osrmCode}`);
        throw new Error(`OSRM: ${osrmCode}`);
      }
    } catch (osrmErr: any) {
      console.warn(`[RoutingService] OSRM routing failed (${osrmErr?.message}), trying ORS fallback`);
      if (this.orsApiKey && this.orsApiKey.length > 10) {
        // ORS fallback: routingWaypoints is already ≤50 points, so use it directly.
        const orsPoints = await this.routeORS(routingWaypoints.map(p => ({ lat: p.lat, lng: p.lng })));
        const polylineCoords: [number, number][] = orsPoints.map(p => [p.lng, p.lat]);
        const validCoords = polylineCoords.filter(c => !isNaN(c[0]) && !isNaN(c[1]));
        if (validCoords.length < 2) throw new Error("ORS fallback returned insufficient coordinates.");
        return { polylineCoords: validCoords, anchorVerification: [] };
      }
      throw new Error(
        `Routing failed (${osrmErr?.message ?? 'unknown'}). ` +
        `Try generating again — if this persists, the road network may be too sparse for this area.`
      );
    }

    const allCoords: [number, number][] = [];
    for (let i = 0; i < results.length; i++) {
      const coords = results[i];
      if (i === 0) {
        allCoords.push(...coords);
      } else {
        allCoords.push(...coords.slice(1));
      }
    }

    // Filter out any invalid coordinates that might have slipped through from OSRM
    const validCoords = allCoords.filter(c => 
      typeof c[0] === 'number' && typeof c[1] === 'number' && 
      !isNaN(c[0]) && !isNaN(c[1])
    );

    if (validCoords.length < 2) {
      throw new Error("OSRM returned insufficient valid coordinates for routing.");
    }

    const anchorVerification = lockedIndices.map(idx => {
      const anchor = routingWaypoints[idx];
      if (typeof anchor.lat !== 'number' || typeof anchor.lng !== 'number' || isNaN(anchor.lat) || isNaN(anchor.lng)) {
        return { anchorLat: 0, anchorLng: 0, distanceFromPolylineM: Infinity, passed: false };
      }
      const anchorPoint = turf.point([anchor.lng, anchor.lat]);
      const polyline = turf.lineString(validCoords);
      const snapped = turf.nearestPointOnLine(polyline, anchorPoint, { units: 'meters' });
      return {
        anchorLat: anchor.lat,
        anchorLng: anchor.lng,
        distanceFromPolylineM: snapped.properties.dist,
        passed: (snapped.properties.dist || 0) < 30
      };
    });

    return {
      polylineCoords: validCoords,
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
        const data = await this.fetchOSRM(profile => `/route/v1/${profile}/${coordStr}?overview=full&geometries=geojson`);

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

    // Pass the key as a query parameter instead of an Authorization header.
    // The Authorization header triggers a CORS preflight that ORS rejects in browser contexts,
    // resulting in "Failed to fetch". Query-param auth skips the preflight entirely.
    // Profile is foot-walking (pedestrian) to match the app's pedestrian routing intent —
    // consistent with the OSRM "foot" profile. Do not change to driving-car.
    const url = `${ORS_BASE_URL}/directions/foot-walking/geojson?api_key=${encodeURIComponent(this.orsApiKey)}`;
    let lastError: any = null;
    let attempt = 0;
    const maxRetries = 3;

    console.info('[ORS] Starting request', {
      url: url.replace(/api_key=[^&]+/, 'api_key=***'),
      pointCount: points.length,
      sampleFirst: points[0],
      sampleLast: points[points.length - 1],
      hasNaN: points.some(p => isNaN(p.lat) || isNaN(p.lng)),
    });

    while (attempt < maxRetries) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
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
        console.warn(`[ORS] Attempt ${attempt} failed:`, {
          name: e.name,
          message: e.message,
          cause: e.cause,
          stack: e.stack?.split('\n')[0],
        });
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`[ORS] Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    const lastMsg = lastError?.message || "Network Error";
    // "Failed to fetch" in a browser typically means the server returned an error (like 403)
    // without Access-Control-Allow-Origin headers, so the browser blocked the response.
    // This is usually caused by an invalid or expired ORS API key.
    const isCorsOrNetworkBlock = lastMsg.toLowerCase().includes("failed to fetch") ||
                                  lastMsg.toLowerCase().includes("load failed");
    if (isCorsOrNetworkBlock) {
      throw new Error(
        `OpenRouteService could not be reached. This is usually caused by an invalid or expired API key. ` +
        `Please check your VITE_OPENROUTESERVICE_API_KEY in .env — you can get a free key at openrouteservice.org.`
      );
    }
    throw new Error(`OpenRouteService failed after ${maxRetries} attempts. Error: ${lastMsg}`);
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
        const data = await this.fetchOSRM(profile => `/route/v1/${profile}/${coordStr}?overview=full&geometries=geojson`);

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
