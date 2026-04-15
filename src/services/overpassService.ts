import * as turf from "@turf/turf";
import { Point } from "../lib/shapeMath";
import { measureLatency } from "../lib/latency";

export interface OSMNode {
  id: number;
  lat: number;
  lng: number;
}

export interface RoadNetwork {
  nodes: OSMNode[];
  nodeMap: Map<string, OSMNode>;
  edgeMap: Map<string, string[]>;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
}

export class OverpassService {
  private cache: Map<string, { network: RoadNetwork; timestamp: number }> = new Map();
  private CACHE_EXPIRY = 1000 * 60 * 60; // 1 hour

  constructor() {
    this.loadCache();
  }

  private loadCache() {
    try {
      const saved = sessionStorage.getItem('overpass_cache');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Convert plain objects back to Maps
        for (const [key, val] of Object.entries(parsed)) {
          const entry = val as any;
          if (Date.now() - entry.timestamp < this.CACHE_EXPIRY) {
            const edgeMap = new Map<string, string[]>();
            for (const [ek, ev] of Object.entries(entry.network.edgeMap)) {
              edgeMap.set(ek, ev as string[]);
            }
            
            const nodeMap = new Map<string, OSMNode>();
            for (const [nk, nv] of Object.entries(entry.network.nodeMap)) {
              nodeMap.set(nk, nv as OSMNode);
            }

            entry.network.edgeMap = edgeMap;
            entry.network.nodeMap = nodeMap;
            this.cache.set(key, entry);
          }
        }
      }
    } catch (e) {
      console.warn("Failed to load Overpass cache", e);
    }
  }

  private saveCache() {
    try {
      const toSave: any = {};
      this.cache.forEach((val, key) => {
        toSave[key] = {
          ...val,
          network: {
            ...val.network,
            edgeMap: Object.fromEntries(val.network.edgeMap),
            nodeMap: Object.fromEntries(val.network.nodeMap)
          }
        };
      });
      sessionStorage.setItem('overpass_cache', JSON.stringify(toSave));
    } catch (e) {
      console.warn("Failed to save Overpass cache", e);
    }
  }
  private mirrorPerformance: Map<string, number[]> = new Map(); // Track last 5 latencies per mirror

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
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.viatech.com.ua/api/interpreter",
    "https://overpass.tiekoetter.com/api/interpreter",
    "https://overpass.jojo-t.me/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
  ];

  private getShuffledMirrors(): string[] {
    // Sort mirrors by their average performance (fastest first)
    // Add a small random jitter to avoid everyone hitting the same mirror if latencies are identical
    return [...this.MIRRORS].sort((a, b) => {
      const perfA = this.getAverageLatency(a) + (Math.random() * 10);
      const perfB = this.getAverageLatency(b) + (Math.random() * 10);
      return perfA - perfB;
    });
  }

  private getAverageLatency(mirror: string): number {
    const history = this.mirrorPerformance.get(mirror);
    if (!history || history.length === 0) return 0; // Prioritize unknown mirrors
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

  /**
   * Samples nodes to send to AI. 
   * Prioritizes junctions and nodes near the ideal shape.
   */
  filterNodesForAI(network: RoadNetwork, idealPath: Point[]): OSMNode[] {
    if (idealPath.length === 0) return network.nodes.slice(0, 500);

    const idealLine = turf.lineString(idealPath.map(p => [p.lng, p.lat]));
    const junctions = network.nodes.filter(n => {
      const neighbors = network.edgeMap.get(String(n.id)) || [];
      return neighbors.length > 2;
    });

    // Only take nodes within 100m of the ideal path
    const nearbyNodes = network.nodes.filter(n => {
      const pt = turf.point([n.lng, n.lat]);
      const dist = turf.pointToLineDistance(pt, idealLine, { units: 'meters' });
      return dist < 100;
    });

    // Combine and deduplicate
    const combined = [...new Set([...junctions, ...nearbyNodes])];
    
    // If still too many, sample them
    if (combined.length > 800) {
      return combined.filter((_, i) => i % Math.ceil(combined.length / 800) === 0);
    }
    
    return combined;
  }

  async fetchRoadNetwork(center: Point, radiusMeters: number, onProgress?: (msg: string) => void, idealAnchors?: Point[]): Promise<RoadNetwork> {
    const cacheKey = `${center.lat.toFixed(4)},${center.lng.toFixed(4)},${radiusMeters},${idealAnchors ? idealAnchors.length : 0}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < this.CACHE_EXPIRY)) {
      onProgress?.("Using cached road network...");
      return cached.network;
    }

    let areaFilter = `(around:${radiusMeters},${center.lat},${center.lng})`;
    
    // If we have ideal anchors, use a circle that encompasses the entire shape plus a buffer
    if (idealAnchors && idealAnchors.length > 0) {
      const centerPt = turf.point([center.lng, center.lat]);
      const distances = idealAnchors.map(a => {
        const pt = turf.point([a.lng, a.lat]);
        return turf.distance(centerPt, pt, { units: 'meters' });
      });
      const maxDist = Math.max(...distances);
      // Use at least 1.5km or the shape's extent + 1000m
      const finalRadius = Math.max(1500, maxDist + 1000);
      areaFilter = `(around:${finalRadius},${center.lat},${center.lng})`;
    }

    const query = `
      [out:json][timeout:60];
      way["highway"~"residential|living_street|primary|secondary|tertiary|unclassified|track|path|footway|pedestrian|cycleway|service|trunk|trunk_link|steps|bridleway|corridor|road"]${areaFilter}->.all;
      (
        .all;
        - .all["foot"="no"];
        - .all["access"~"private|no"];
        - .all["motorroad"="yes"];
      );
      out body;
      >;
      out skel qt;
    `;

    console.log("[DEBUG] Overpass Query:", query);

    let lastError: any = null;
    const shuffledMirrors = this.getShuffledMirrors();
    
    // Try mirrors in chunks of 2 (Racing Strategy)
    for (let i = 0; i < shuffledMirrors.length; i += 2) {
      const chunk = shuffledMirrors.slice(i, i + 2);
      const controllers = chunk.map(() => new AbortController());
      
      // Global timeout for this chunk
      const timeoutId = setTimeout(() => {
        controllers.forEach(c => c.abort());
      }, 25000); // Increased timeout for larger areas
      
      try {
        const result = await Promise.any(chunk.map(async (mirror, idx) => {
          const mirrorName = new URL(mirror).hostname;
          const controller = controllers[idx];
          
          try {
            const { data: response, latencyMs } = await measureLatency(`Overpass:${mirrorName}`, async () => {
              return await fetch(mirror, {
                method: "POST",
                body: "data=" + encodeURIComponent(query),
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded"
                },
                mode: 'cors',
                signal: controller.signal
              });
            }, { silent: true });

            this.recordLatency(mirror, latencyMs);

            if (!response.ok) {
              if (response.status === 429 || response.status >= 500) {
                this.recordLatency(mirror, 60000); // Penalty
              }
              throw new Error(`HTTP ${response.status}`);
            }

            const text = await response.text();
            const data = JSON.parse(text);

            if (!data.elements || data.elements.length === 0) {
              throw new Error("No elements");
            }

            // Success! Clear timeout and abort others in this chunk
            clearTimeout(timeoutId);
            controllers.forEach((c, cIdx) => {
              if (cIdx !== idx) c.abort();
            });

            onProgress?.("Processing map data in background...");
            const network = await this.processOSMDataWithWorker(data);
            this.cache.set(cacheKey, { network, timestamp: Date.now() });
            this.saveCache();
            return network;
          } catch (err: any) {
            if (err.name !== 'AbortError') {
              this.recordLatency(mirror, 60000); // Penalty
            }
            throw err;
          }
        }));

        if (result) return result;
      } catch (err: any) {
        if (typeof AggregateError !== 'undefined' && err instanceof AggregateError) {
          lastError = err.errors[0];
        } else {
          lastError = err;
        }
        clearTimeout(timeoutId);
        // Ensure all are aborted if chunk failed
        controllers.forEach(c => c.abort());
      }
    }

    throw new Error(`Failed to fetch road data from OpenStreetMap. All mirrors failed. Last error: ${lastError?.message || "Unknown"}`);
  }

  private async processOSMDataWithWorker(data: any): Promise<RoadNetwork> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../workers/overpassWorker.ts', import.meta.url), { type: 'module' });
      
      worker.onmessage = (e) => {
        const { nodes, nodeMap, edgeMap, bounds } = e.data;
        
        // Convert plain objects back to Maps
        const nMap = new Map<string, OSMNode>();
        for (const [k, v] of Object.entries(nodeMap)) {
          nMap.set(k, v as OSMNode);
        }

        const eMap = new Map<string, string[]>();
        for (const [k, v] of Object.entries(edgeMap)) {
          eMap.set(k, v as string[]);
        }

        worker.terminate();
        resolve({ nodes, nodeMap: nMap, edgeMap: eMap, bounds });
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };

      worker.postMessage({ data });
    });
  }

  private processOSMData(data: any): RoadNetwork {
    const nodes: OSMNode[] = [];
    const nodeMap = new Map<string, OSMNode>();
    const edgeMap = new Map<string, string[]>();
    const wayNodes = new Set<number>();

    // First pass: collect nodes used in ways (actual road points) and build edgeMap
    data.elements.forEach((el: any) => {
      if (el.type === "way" && el.nodes) {
        el.nodes.forEach((id: number) => wayNodes.add(id));
        
        for (let i = 0; i < el.nodes.length - 1; i++) {
          const u = el.nodes[i].toString();
          const v = el.nodes[i+1].toString();
          
          if (!edgeMap.has(u)) edgeMap.set(u, []);
          if (!edgeMap.has(v)) edgeMap.set(v, []);
          
          edgeMap.get(u)!.push(v);
          edgeMap.get(v)!.push(u);
        }
      }
    });

    // Second pass: extract node coordinates
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;

    data.elements.forEach((el: any) => {
      if (el.type === "node" && wayNodes.has(el.id)) {
        const node = { id: el.id, lat: el.lat, lng: el.lon };
        nodes.push(node);
        nodeMap.set(el.id.toString(), node);

        minLat = Math.min(minLat, el.lat);
        maxLat = Math.max(maxLat, el.lat);
        minLng = Math.min(minLng, el.lon);
        maxLng = Math.max(maxLng, el.lon);
      }
    });

    return {
      nodes,
      nodeMap,
      edgeMap,
      bounds: { minLat, maxLat, minLng, maxLng }
    };
  }

  /**
   * Find nodes that are physically close to the ideal shape path.
   * This implements "Idea #2: Pre-Filtering" to ensure the AI only sees nodes that could 
   * actually form the shape.
   */
  getRelevantNodes(allNodes: OSMNode[], anchors: Point[], edgeMap: Map<string, string[]>, limit: number = 800): OSMNode[] {
    if (allNodes.length === 0) return [];
    
    // Validate anchors
    const validAnchors = anchors.filter(a => typeof a.lat === 'number' && typeof a.lng === 'number' && !isNaN(a.lat) && !isNaN(a.lng));
    if (validAnchors.length < 2) return allNodes.slice(0, limit);

    const idealLine = turf.lineString(validAnchors.map(a => [a.lng, a.lat]));
    
    // Efficient distance-based filtering
    const filtered = allNodes.filter(node => {
      if (typeof node.lat !== 'number' || typeof node.lng !== 'number' || isNaN(node.lat) || isNaN(node.lng)) {
        return false;
      }
      const pt = turf.point([node.lng, node.lat]);
      // Use a fixed 150m buffer for speed instead of a loop
      const dist = turf.pointToLineDistance(pt, idealLine, { units: 'meters' });
      return dist < 150;
    });

    if (filtered.length > limit) {
      // Prioritize junctions if we're over the limit
      const junctions = filtered.filter(n => {
        const neighbors = edgeMap?.get(String(n.id)) || [];
        return neighbors.length > 2;
      });

      if (junctions.length >= limit) return junctions.slice(0, limit);
      
      const remaining = filtered.filter(n => !junctions.includes(n));
      return [...junctions, ...remaining.slice(0, limit - junctions.length)];
    }

    return filtered.length > 0 ? filtered : allNodes.slice(0, limit);
  }
}
