import { describe, it, expect, vi } from "vitest";
import { findNearestGraphNode, aStarSegment } from "../../src/services/graphService";
import { graphRouteShape } from "../../src/services/graphRoutingService";
import type { OSMNode } from "../../src/services/overpassService";
import type { Point } from "../../src/lib/shapeMath";

// --- findNearestGraphNode ---

describe("findNearestGraphNode", () => {
  it("returns the id of the nearest node", () => {
    const nmap = new Map<string, OSMNode>([
      ["n1", { id: 1, lat: 0, lng: 0 }],
      ["n2", { id: 2, lat: 0.001, lng: 0.001 }],
      ["n3", { id: 3, lat: 0.1, lng: 0.1 }],
    ]);
    const result = findNearestGraphNode({ lat: 0.0011, lng: 0.0011 }, nmap);
    expect(result).toBe("n2");
  });

  it("returns null for empty nodeMap", () => {
    expect(findNearestGraphNode({ lat: 0, lng: 0 }, new Map())).toBeNull();
  });
});

// --- aStarSegment ---

describe("aStarSegment", () => {
  it("finds path on a linear chain A→B→C→D", () => {
    const nmap = new Map<string, OSMNode>([
      ["A", { id: 1, lat: 0, lng: 0 }],
      ["B", { id: 2, lat: 0, lng: 0.001 }],
      ["C", { id: 3, lat: 0, lng: 0.002 }],
      ["D", { id: 4, lat: 0, lng: 0.003 }],
    ]);
    const emap = new Map([
      ["A", ["B"]],
      ["B", ["A", "C"]],
      ["C", ["B", "D"]],
      ["D", ["C"]],
    ]);
    const ideal: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.003 },
    ];
    const result = aStarSegment("A", "D", nmap, emap, ideal);
    expect(result).not.toBeNull();
    expect(result!.map(n => n.id)).toEqual([1, 2, 3, 4]);
  });

  it("prefers shape-hugging U-arc path over direct shortcut with default options", () => {
    // Direct edge: start→goal (short but deviates from ideal arc)
    // Arc edges:  start→topLeft→topRight→goal (longer but hugs ideal)
    // β > 4.0 required for arc to win; DEFAULT_BETA must be at least 4.0
    const nmap = new Map<string, OSMNode>([
      ["start",    { id: 1, lat: 0,    lng: 0 }],
      ["topLeft",  { id: 2, lat: 0.01, lng: 0 }],
      ["topRight", { id: 3, lat: 0.01, lng: 0.01 }],
      ["goal",     { id: 4, lat: 0,    lng: 0.01 }],
    ]);
    const emap = new Map([
      ["start",    ["topLeft", "goal"]],
      ["topLeft",  ["start", "topRight"]],
      ["topRight", ["topLeft", "goal"]],
      ["goal",     ["topRight", "start"]],
    ]);
    // Ideal traces the U-arc: top-left then top-right
    const ideal: Point[] = [
      { lat: 0,    lng: 0 },
      { lat: 0.01, lng: 0 },
      { lat: 0.01, lng: 0.01 },
      { lat: 0,    lng: 0.01 },
    ];
    // No explicit options — uses DEFAULT_ALPHA and DEFAULT_BETA
    const result = aStarSegment("start", "goal", nmap, emap, ideal);
    expect(result).not.toBeNull();
    const ids = result!.map(n => n.id);
    expect(ids).toContain(2); // topLeft
    expect(ids).toContain(3); // topRight
  });

  it("returns null for a disconnected graph", () => {
    const nmap = new Map<string, OSMNode>([
      ["A", { id: 1, lat: 0, lng: 0 }],
      ["B", { id: 2, lat: 1, lng: 1 }],
    ]);
    const emap = new Map([["A", []], ["B", []]]);
    expect(aStarSegment("A", "B", nmap, emap, [])).toBeNull();
  });
});

// --- graphRouteShape ---

describe("graphRouteShape", () => {
  it("concatenates two A* segments without duplicating the junction point", async () => {
    // 5-node linear graph: n1-n2-n3-n4-n5
    const nmap = new Map<string, OSMNode>([
      ["n1", { id: 1, lat: 0, lng: 0 }],
      ["n2", { id: 2, lat: 0, lng: 0.001 }],
      ["n3", { id: 3, lat: 0, lng: 0.002 }],
      ["n4", { id: 4, lat: 0, lng: 0.003 }],
      ["n5", { id: 5, lat: 0, lng: 0.004 }],
    ]);
    const emap = new Map([
      ["n1", ["n2"]],
      ["n2", ["n1", "n3"]],
      ["n3", ["n2", "n4"]],
      ["n4", ["n3", "n5"]],
      ["n5", ["n4"]],
    ]);
    // 3 waypoints → 2 segments
    // Segment 1: (0,0)→(0,0.002) snaps to n1→n3, A* returns [n1,n2,n3] = 3 coords
    // Segment 2: (0,0.002)→(0,0.004) snaps to n3→n5, A* returns [n3,n4,n5], skip first = 2 coords
    // Total = 5, not 6
    const waypoints: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.002 },
      { lat: 0, lng: 0.004 },
    ];
    const idealPath: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.004 },
    ];
    const mockRoutingService = {
      routeWithLockedWaypoints: vi.fn().mockResolvedValue({ polylineCoords: [] }),
    };

    const result = await graphRouteShape(
      waypoints,
      idealPath,
      nmap,
      emap,
      mockRoutingService as any
    );

    expect(result.polylineCoords.length).toBe(5);
    expect(mockRoutingService.routeWithLockedWaypoints).not.toHaveBeenCalled();
  });

  it("falls back to OSRM when A* returns null (disconnected segment)", async () => {
    // Two nodes with no edges — A* returns null → OSRM fallback per segment
    const nmap = new Map<string, OSMNode>([
      ["n1", { id: 1, lat: 0, lng: 0 }],
      ["n2", { id: 2, lat: 0, lng: 0.01 }],
    ]);
    const emap = new Map([["n1", []], ["n2", []]]);
    const waypoints: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
    ];
    const idealPath: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
    ];
    const mockCoords: [number, number][] = [[0, 0], [0.005, 0], [0.01, 0]];
    const mockRoutingService = {
      routeWithLockedWaypoints: vi.fn().mockResolvedValue({ polylineCoords: mockCoords }),
    };

    const result = await graphRouteShape(waypoints, idealPath, nmap, emap, mockRoutingService as any);

    expect(mockRoutingService.routeWithLockedWaypoints).toHaveBeenCalledWith([waypoints[0], waypoints[1]]);
    expect(result.polylineCoords).toEqual(mockCoords);
  });

  it("falls back to OSRM when idealPath has fewer than 2 points", async () => {
    const nmap = new Map<string, OSMNode>([["n1", { id: 1, lat: 0, lng: 0 }]]);
    const emap = new Map([["n1", []]]);
    const waypoints: Point[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }];
    const mockRoutingService = {
      routeWithLockedWaypoints: vi.fn().mockResolvedValue({ polylineCoords: [[0, 0], [0.01, 0]] as [number,number][] }),
    };

    await graphRouteShape(waypoints, [{ lat: 0, lng: 0 }], nmap, emap, mockRoutingService as any);

    expect(mockRoutingService.routeWithLockedWaypoints).toHaveBeenCalledWith(waypoints);
  });
});
