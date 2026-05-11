import * as turf from "@turf/turf";
import { Point } from "../lib/shapeMath";
import { OSMNode } from "./overpassService";

export interface AStarOptions {
  alpha?: number;
  beta?: number;
  maxIterations?: number;
}

export const DEFAULT_ALPHA = 1.0;
export const DEFAULT_BETA = 2.0;

class MinHeap {
  private heap: { id: string; f: number }[] = [];

  push(item: { id: string; f: number }): void {
    this.heap.push(item);
    this.siftUp(this.heap.length - 1);
  }

  pop(): { id: string; f: number } | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  get size(): number {
    return this.heap.length;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].f <= this.heap[i].f) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.heap[left].f < this.heap[smallest].f) smallest = left;
      if (right < n && this.heap[right].f < this.heap[smallest].f) smallest = right;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

export function findNearestGraphNode(
  point: Point,
  nodeMap: Map<string, OSMNode>
): string | null {
  if (nodeMap.size === 0) return null;
  const pt = turf.point([point.lng, point.lat]);
  let closestId: string | null = null;
  let minDist = Infinity;
  for (const [id, node] of nodeMap) {
    const d = turf.distance(pt, turf.point([node.lng, node.lat]), { units: "meters" });
    if (d < minDist) {
      minDist = d;
      closestId = id;
    }
  }
  return closestId;
}

export function aStarSegment(
  startId: string,
  goalId: string,
  nodeMap: Map<string, OSMNode>,
  edgeMap: Map<string, string[]>,
  idealSegment: Point[],
  options?: AStarOptions
): OSMNode[] | null {
  const alpha = options?.alpha ?? DEFAULT_ALPHA;
  const beta = options?.beta ?? DEFAULT_BETA;
  const maxIterations = options?.maxIterations ?? nodeMap.size * 4;

  if (startId === goalId) {
    const node = nodeMap.get(startId);
    return node ? [node] : null;
  }

  const goalNode = nodeMap.get(goalId);
  if (!goalNode) return null;

  const idealLine = idealSegment.length >= 2
    ? turf.lineString(idealSegment.map(p => [p.lng, p.lat]))
    : null;

  const gScore = new Map<string, number>([[startId, 0]]);
  const parent = new Map<string, string>();
  const closed = new Set<string>();
  const open = new MinHeap();

  const heuristic = (id: string): number => {
    const node = nodeMap.get(id);
    if (!node) return 0;
    return alpha * turf.distance(
      turf.point([node.lng, node.lat]),
      turf.point([goalNode.lng, goalNode.lat]),
      { units: "meters" }
    );
  };

  open.push({ id: startId, f: heuristic(startId) });

  let iterations = 0;
  while (open.size > 0 && iterations < maxIterations) {
    iterations++;
    const current = open.pop()!;
    if (closed.has(current.id)) continue;
    closed.add(current.id);

    if (current.id === goalId) {
      const path: OSMNode[] = [];
      let cur: string | undefined = goalId;
      while (cur !== undefined && cur !== startId) {
        const node = nodeMap.get(cur);
        if (node) path.push(node);
        cur = parent.get(cur);
      }
      const startNode = nodeMap.get(startId);
      if (startNode) path.push(startNode);
      return path.reverse();
    }

    const currentNode = nodeMap.get(current.id);
    if (!currentNode) continue;

    for (const neighborId of edgeMap.get(current.id) ?? []) {
      if (closed.has(neighborId)) continue;
      const neighborNode = nodeMap.get(neighborId);
      if (!neighborNode) continue;

      const edgeLengthM = turf.distance(
        turf.point([currentNode.lng, currentNode.lat]),
        turf.point([neighborNode.lng, neighborNode.lat]),
        { units: "meters" }
      );

      let deviationM = 0;
      if (idealLine) {
        const midLng = (currentNode.lng + neighborNode.lng) / 2;
        const midLat = (currentNode.lat + neighborNode.lat) / 2;
        deviationM = turf.pointToLineDistance(
          turf.point([midLng, midLat]),
          idealLine,
          { units: "meters" }
        );
      }

      const tentativeG = (gScore.get(current.id) ?? Infinity)
        + alpha * edgeLengthM
        + beta * deviationM;

      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        gScore.set(neighborId, tentativeG);
        parent.set(neighborId, current.id);
        open.push({ id: neighborId, f: tentativeG + heuristic(neighborId) });
      }
    }
  }

  if (iterations >= maxIterations) {
    console.warn(`aStarSegment: max iterations exceeded for ${startId}→${goalId}`);
  }
  return null;
}
