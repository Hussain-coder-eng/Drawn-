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

  async fetchRoadNetwork(center: Point, radiusMeters: number, onProgress?: (msg: string) => void): Promise<RoadNetwork> {
    const cacheKey = `${center.lat.toFixed(4)},${center.lng.toFixed(4)},${radiusMeters}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < this.CACHE_EXPIRY)) {
      onProgress?.("Using cached road network...");
      return cached.network;
    }

    const areaFilter = `(around:${radiusMeters},${center.lat},${center.lng})`;

    const query = `
      [out:json][timeout:45];
      way["highway"~"residential|living_street|primary|secondary|tertiary|unclassified|track|path|footway|pedestrian|cycleway|service|road"]["foot"!="no"]["access"!~"private|no"]["motorroad"!="yes"]${areaFilter};
      out body;
      >;
      out skel qt;
    `;

    console.log("[DEBUG] Overpass Query:", query);

    const shuffledMirrors = this.getShuffledMirrors();
    const controllers = shuffledMirrors.map(() => new AbortController());

    // Global timeout: abort all mirrors if none respond in time
    const globalTimeout = setTimeout(() => {
      controllers.forEach(c => c.abort());
    }, 12000);

    try {
      const result = await Promise.any(shuffledMirrors.map(async (mirror, idx) => {
        const mirrorName = new URL(mirror).hostname;
        const controller = controllers[idx];

        try {
          const { data: response, latencyMs } = await measureLatency(`Overpass:${mirrorName}`, async () => {
            return await fetch(mirror, {
              method: "POST",
              body: "data=" + encodeURIComponent(query),
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              mode: 'cors',
              signal: controller.signal
            });
          }, { silent: true });

          this.recordLatency(mirror, latencyMs);

          if (!response.ok) {
            if (response.status === 429 || response.status >= 500) {
              this.recordLatency(mirror, 60000);
            }
            throw new Error(`HTTP ${response.status}`);
          }

          const text = await response.text();
          const data = JSON.parse(text);

          if (!data.elements || data.elements.length === 0) {
            throw new Error("No elements");
          }

          // Success — abort all other in-flight requests
          clearTimeout(globalTimeout);
          controllers.forEach((c, cIdx) => { if (cIdx !== idx) c.abort(); });

          onProgress?.("Processing map data in background...");
          const network = await this.processOSMDataWithWorker(data);
          this.cache.set(cacheKey, { network, timestamp: Date.now() });
          this.saveCache();
          return network;
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            this.recordLatency(mirror, 60000);
          }
          throw err;
        }
      }));

      return result;
    } catch (err: any) {
      clearTimeout(globalTimeout);
      controllers.forEach(c => c.abort());
      const lastMsg = err instanceof AggregateError ? err.errors[0]?.message : err?.message;
      throw new Error(`Failed to fetch road data from OpenStreetMap. All mirrors failed. Last error: ${lastMsg || "Unknown"}`);
    }
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
  getRelevantNodes(allNodes: OSMNode[], anchors: Point[], edgeMap: Map<string, string[]>, limit: number = 400): OSMNode[] {
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

  /**
   * Returns nodes within a spatial bounding corridor around a stage's ideal sub-path.
   * If fewer than 8 nodes are found, falls back to the 20 nearest to the stage midpoint.
   */
  getNodesForStage(
    allNodes: OSMNode[],
    stagePath: Point[],
    bufferMeters: number = 400
  ): OSMNode[] {
    const validPath = stagePath.filter(
      p => typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng)
    );
    if (validPath.length < 2) return allNodes.slice(0, 20);

    // Convert buffer to approximate degrees (1 degree ≈ 111km)
    const bufferDeg = bufferMeters / 111000;

    const lats = validPath.map(p => p.lat);
    const lngs = validPath.map(p => p.lng);
    const minLat = Math.min(...lats) - bufferDeg;
    const maxLat = Math.max(...lats) + bufferDeg;
    const minLng = Math.min(...lngs) - bufferDeg;
    const maxLng = Math.max(...lngs) + bufferDeg;

    const inBounds = allNodes.filter(n =>
      typeof n.lat === 'number' && typeof n.lng === 'number' &&
      !isNaN(n.lat) && !isNaN(n.lng) &&
      n.lat >= minLat && n.lat <= maxLat &&
      n.lng >= minLng && n.lng <= maxLng
    );

    if (inBounds.length >= 8) return inBounds;

    // Fallback: 20 nearest nodes to stage PATH (distributes across full arc)
    const stageLine = turf.lineString(validPath.map(p => [p.lng, p.lat]));

    return [...allNodes]
      .filter(n =>
        typeof n.lat === 'number' && typeof n.lng === 'number' && !isNaN(n.lat) && !isNaN(n.lng)
      )
      .sort((a, b) =>
        turf.pointToLineDistance(turf.point([a.lng, a.lat]), stageLine, { units: 'meters' }) -
        turf.pointToLineDistance(turf.point([b.lng, b.lat]), stageLine, { units: 'meters' })
      )
      .slice(0, 20);
  }
}
