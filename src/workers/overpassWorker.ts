import * as turf from "@turf/turf";

/**
 * This worker handles the heavy lifting of processing OpenStreetMap JSON data
 * into a searchable RoadNetwork graph.
 */
self.onmessage = (e) => {
  const { data } = e.data;
  
  const nodes = [];
  const nodeMap = new Map();
  const edgeMap = new Map();
  const wayNodes = new Set();

  // 1. Collect nodes used in ways
  data.elements.forEach((el) => {
    if (el.type === "way" && el.nodes) {
      el.nodes.forEach((id) => wayNodes.add(id));
    }
  });

  // 2. Build node map
  data.elements.forEach((el) => {
    if (el.type === "node" && wayNodes.has(el.id)) {
      const node = { id: el.id, lat: el.lat, lng: el.lon };
      nodes.push(node);
      nodeMap.set(String(el.id), node);
    }
  });

  // 3. Build adjacency list (edgeMap)
  data.elements.forEach((el) => {
    if (el.type === "way" && el.nodes) {
      for (let i = 0; i < el.nodes.length - 1; i++) {
        const u = String(el.nodes[i]);
        const v = String(el.nodes[i + 1]);
        
        if (!edgeMap.has(u)) edgeMap.set(u, []);
        if (!edgeMap.has(v)) edgeMap.set(v, []);
        
        edgeMap.get(u).push(v);
        edgeMap.get(v).push(u);
      }
    }
  });

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const validNodes = [];
  
  for (const n of nodes) {
    if (typeof n.lat !== 'number' || typeof n.lng !== 'number' || isNaN(n.lat) || isNaN(n.lng)) {
      continue;
    }
    validNodes.push(n);
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
    if (n.lng < minLng) minLng = n.lng;
    if (n.lng > maxLng) maxLng = n.lng;
  }

  const bounds = {
    minLat: minLat === Infinity ? 0 : minLat,
    maxLat: maxLat === -Infinity ? 0 : maxLat,
    minLng: minLng === Infinity ? 0 : minLng,
    maxLng: maxLng === -Infinity ? 0 : maxLng,
  };

  self.postMessage({ 
    nodes: validNodes, 
    nodeMap: Object.fromEntries(nodeMap), 
    edgeMap: Object.fromEntries(edgeMap),
    bounds
  });
};
