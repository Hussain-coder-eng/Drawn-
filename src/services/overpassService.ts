import * as turf from "@turf/turf";
import { Point } from "../lib/shapeMath";

export interface OSMNode {
  id: number;
  lat: number;
  lng: number;
}

export interface RoadNetwork {
  nodes: OSMNode[];
  nodeMap: Map<number, OSMNode>;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
}

export class OverpassService {
  private cache: Map<string, { network: RoadNetwork; timestamp: number }> = new Map();
  private CACHE_EXPIRY = 1000 * 60 * 15; // 15 minutes

  /**
   * Calculate search radius based on target distance.
   * A 5km route needs roughly 1km radius (circumference = 2*pi*r).
   * We add a buffer to ensure the shape fits.
   */
  calculateRadius(distanceKm: number): number {
    // radius = distance / (2 * PI) * buffer
    const radius = (distanceKm / (2 * Math.PI)) * 1.2;
    // Minimum 500m, Maximum 5km
    return Math.min(Math.max(radius * 1000, 500), 5000);
  }

  private MIRRORS = [
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
    "https://overpass.be/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.ext.paws.wmcloud.org/api/interpreter"
  ];

  async fetchRoadNetwork(center: Point, radiusMeters: number, onProgress?: (msg: string) => void, idealAnchors?: Point[]): Promise<RoadNetwork> {
    const cacheKey = `${center.lat.toFixed(4)},${center.lng.toFixed(4)},${radiusMeters},${idealAnchors ? idealAnchors.length : 0}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < this.CACHE_EXPIRY)) {
      onProgress?.("Using cached road network...");
      return cached.network;
    }

    let areaFilter = `(around:${radiusMeters},${center.lat},${center.lng})`;
    
    // If we have ideal anchors, we can use a much tighter bounding box instead of a giant circle
    if (idealAnchors && idealAnchors.length > 0) {
      const lats = idealAnchors.map(a => a.lat);
      const lngs = idealAnchors.map(a => a.lng);
      const minLat = Math.min(...lats) - 0.005; // ~500m buffer
      const maxLat = Math.max(...lats) + 0.005;
      const minLng = Math.min(...lngs) - 0.005;
      const maxLng = Math.max(...lngs) + 0.005;
      areaFilter = `(${minLat},${minLng},${maxLat},${maxLng})`;
    }

    const query = `
      [out:json][timeout:25];
      (
        way["highway"~"residential|living_street|primary|secondary|tertiary"]
          ${areaFilter};
      );
      out body;
      >;
      out skel qt;
    `;

    console.log("[DEBUG] Overpass Query:", query);

    let lastError: any = null;
    
    // Try each mirror with retries
    for (const mirror of this.MIRRORS) {
      const mirrorName = new URL(mirror).hostname;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          onProgress?.(`Contacting ${mirrorName} (Attempt ${attempt + 1})...`);
          
          // Use GET with data parameter for better CORS compatibility
          const url = new URL(mirror);
          url.searchParams.append('data', query);

          const response = await fetch(url.toString(), {
            method: "GET",
            signal: AbortSignal.timeout(30000) // 30s timeout
          });

          if (response.status === 504 || response.status === 503 || response.status === 502) {
            onProgress?.(`${mirrorName} is busy. Trying next...`);
            break; 
          }

          if (response.status === 429) {
            onProgress?.(`${mirrorName} rate limited. Trying next...`);
            break; // Try next mirror
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          onProgress?.(`Downloading road data from ${mirrorName}...`);
          const data = await response.json();
          console.log(`[DEBUG] Received data from ${mirrorName}`, { elementCount: data.elements?.length });
          if (!data.elements || data.elements.length === 0) {
            onProgress?.(`No roads found on ${mirrorName}.`);
            continue; // Try next attempt or mirror
          }

          onProgress?.(`Processing ${data.elements.length} map elements...`);
          const network = this.processOSMData(data);
          this.cache.set(cacheKey, { network, timestamp: Date.now() });
          return network;
        } catch (error: any) {
          lastError = error;
          console.error(`Error with ${mirror}:`, error.message);
          
          // If it's a timeout, don't retry this mirror, move to next
          if (error.name === "TimeoutError" || error.message.includes("timed out")) {
            onProgress?.(`${mirrorName} timed out. Trying next...`);
            break;
          }

          // Wait a bit before retry for other errors
          if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    throw new Error(`Failed to fetch road data from OpenStreetMap. All mirrors failed. Last error: ${lastError?.message || "Unknown"}`);
  }

  private processOSMData(data: any): RoadNetwork {
    const nodes: OSMNode[] = [];
    const nodeMap = new Map<number, OSMNode>();
    const wayNodes = new Set<number>();

    // First pass: collect nodes used in ways (actual road points)
    data.elements.forEach((el: any) => {
      if (el.type === "way" && el.nodes) {
        el.nodes.forEach((id: number) => wayNodes.add(id));
      }
    });

    // Second pass: extract node coordinates
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;

    data.elements.forEach((el: any) => {
      if (el.type === "node" && wayNodes.has(el.id)) {
        const node = { id: el.id, lat: el.lat, lng: el.lon };
        nodes.push(node);
        nodeMap.set(el.id, node);

        minLat = Math.min(minLat, el.lat);
        maxLat = Math.max(maxLat, el.lat);
        minLng = Math.min(minLng, el.lon);
        maxLng = Math.max(maxLng, el.lon);
      }
    });

    // Downsample if too many nodes (> 250)
    // We prioritize intersections (nodes appearing in multiple ways)
    // But for simplicity here, we'll just take a representative sample if huge
    let finalNodes = nodes;
    if (nodes.length > 250) {
      const step = Math.ceil(nodes.length / 250);
      finalNodes = nodes.filter((_, i) => i % step === 0);
    }

    return {
      nodes: finalNodes,
      nodeMap,
      bounds: { minLat, maxLat, minLng, maxLng }
    };
  }

  /**
   * Find nodes that are physically close to the ideal shape path.
   * This implements "Idea #2: Pre-Filtering" to ensure the AI only sees nodes that could 
   * actually form the shape.
   */
  getRelevantNodes(allNodes: OSMNode[], anchors: Point[], limit: number = 250): OSMNode[] {
    if (allNodes.length === 0) return [];
    if (anchors.length < 2) return allNodes.slice(0, limit);

    // Create a line representing the ideal shape
    const idealLine = turf.lineString(anchors.map(a => [a.lng, a.lat]));
    
    // We start with a tight buffer and expand if we don't get enough nodes
    let bufferMeters = 100;
    let filteredNodes: OSMNode[] = [];
    
    while (bufferMeters <= 500) {
      const buffer = turf.buffer(idealLine, bufferMeters, { units: "meters" });
      filteredNodes = allNodes.filter(node => {
        const pt = turf.point([node.lng, node.lat]);
        return turf.booleanPointInPolygon(pt, buffer as any);
      });

      // If we have a decent number of nodes (at least 50 or 20% of limit), we're good
      if (filteredNodes.length >= Math.min(50, limit * 0.2)) break;
      bufferMeters += 100;
    }

    // If we still have too many, sample them but keep the ones closest to the anchors
    if (filteredNodes.length > limit) {
      const nodePoints = turf.featureCollection(
        filteredNodes.map(n => turf.point([n.lng, n.lat], { id: n.id }))
      );

      const priorityIds = new Set<number>();
      anchors.forEach(anchor => {
        const pt = turf.point([anchor.lng, anchor.lat]);
        const nearest = turf.nearestPoint(pt, nodePoints);
        priorityIds.add(nearest.properties.id);
      });

      const remaining = filteredNodes.filter(n => !priorityIds.has(n.id));
      const needed = limit - priorityIds.size;
      const step = Math.ceil(remaining.length / needed);
      
      const sampled = remaining.filter((_, i) => i % step === 0).slice(0, needed);
      return [...filteredNodes.filter(n => priorityIds.has(n.id)), ...sampled];
    }

    return filteredNodes.length > 0 ? filteredNodes : allNodes.slice(0, limit);
  }
}
