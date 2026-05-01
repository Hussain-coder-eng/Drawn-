import * as turf from "@turf/turf";
import { jsonrepair } from "jsonrepair";
import { addDoc, collection, onSnapshot, serverTimestamp } from "firebase/firestore";
import { Point } from "../lib/shapeMath";
import { OSMNode } from "./overpassService";
import { RouteStage } from "../lib/routeScripts";
import { RouteFitness, StageScore } from "./fitnessService";
import { auth, db } from "../firebase";

export interface GeminiStagedResult {
  startNodeId: number;
  stages: { stageNumber: number; nodeIds: number[] }[];
}

export class GeminiService {
  private cache: Map<string, GeminiStagedResult> = new Map();

  private async submitGeminiJob(
    prompt: string,
    cacheKey: string,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    const user = auth.currentUser;
    if (!user) throw new Error("You must be signed in to generate a route.");

    const jobRef = await addDoc(collection(db, "jobs"), {
      uid: user.uid,
      status: "pending",
      prompt,
      cacheKey,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return new Promise<string>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        unsubscribe();
        reject(new Error("Route generation timed out. Please try again."));
      }, 120_000);

      const unsubscribe = onSnapshot(
        jobRef,
        (snap) => {
          const data = snap.data();
          if (!data) return;
          if (data.status === "done") {
            clearTimeout(timeoutHandle);
            unsubscribe();
            resolve(data.result as string);
          } else if (data.status === "failed") {
            clearTimeout(timeoutHandle);
            unsubscribe();
            reject(new Error((data.error as string) || "Route generation failed."));
          } else if (data.status === "processing") {
            onProgress?.("AI is analyzing the road network...");
          }
        },
        (error) => {
          clearTimeout(timeoutHandle);
          unsubscribe();
          reject(error);
        }
      );
    });
  }

  private samplePoints(points: Point[], n: number): Point[] {
    if (points.length === 0) return [];
    if (points.length <= n) return points;
    const step = (points.length - 1) / (n - 1);
    return Array.from({ length: n }, (_, i) => points[Math.round(i * step)]);
  }

  private computeStageSpatialDeviation(
    failingStage: StageScore,
    geminiResult: GeminiStagedResult,
    idealStagePath: Point[],
    nodeMap: Map<string, any>
  ): string {
    const stageData = geminiResult.stages.find(s => s.stageNumber === failingStage.stageNumber);
    if (!stageData || !stageData.nodeIds.length || !idealStagePath.length) return '';

    const selectedNodes = stageData.nodeIds
      .map((id: number) => nodeMap.get(String(id)))
      .filter(Boolean);
    if (selectedNodes.length === 0) return '';

    const actualLat = selectedNodes.reduce((s: number, n: any) => s + n.lat, 0) / selectedNodes.length;
    const actualLng = selectedNodes.reduce((s: number, n: any) => s + n.lng, 0) / selectedNodes.length;
    const idealLat = idealStagePath.reduce((s, p) => s + p.lat, 0) / idealStagePath.length;
    const idealLng = idealStagePath.reduce((s, p) => s + p.lng, 0) / idealStagePath.length;

    const actualPt = turf.point([actualLng, actualLat]);
    const idealPt = turf.point([idealLng, idealLat]);
    const distM = Math.round(turf.distance(actualPt, idealPt, { units: 'meters' }));
    const bearing = turf.bearing(idealPt, actualPt);
    const compassLabels = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
    const dirLabel = compassLabels[Math.round(((bearing + 360) % 360) / 45) % 8];

    return `Your selected nodes were centered at ${actualLat.toFixed(5)}, ${actualLng.toFixed(5)}\n` +
      `The ideal path for this stage centers at ${idealLat.toFixed(5)}, ${idealLng.toFixed(5)}\n` +
      `You are ~${distM}m ${dirLabel} of where you should be`;
  }

  async selectNodesStaged(
    stageNodePools: OSMNode[][],
    script: RouteStage[],
    shapeName: string,
    distanceKm: number,
    startNodeId: number,
    idealPath: Point[],
    idealStagePaths: Point[][],
    onProgress?: (msg: string) => void
  ): Promise<GeminiStagedResult> {
    if (!script || !Array.isArray(script)) {
      throw new Error("Invalid shape script provided to AI.");
    }

    // 0. Check Cache
    // Include a hash of the first 10 node IDs per pool so cached results are invalidated
    // when the road network changes (e.g. user moves, cache expires, different fetch).
    const nodePoolHash = stageNodePools.map(pool => pool.slice(0, 10).map(n => n.id).sort().join(',')).join('|');
    const cacheKey = JSON.stringify({ shapeName, distanceKm, startNodeId, script: script.map(s => s.stage), nodePoolHash });
    if (this.cache.has(cacheKey)) {
      console.log("[DEBUG] Returning cached Gemini result");
      return this.cache.get(cacheKey)!;
    }

    // Build a global index map across all stage pools (deduplicating shared nodes)
    const idToIndex = new Map<number, string>();
    const indexToId = new Map<string, number>();
    const allUniqueNodes = new Map<number, OSMNode>();
    stageNodePools.forEach(pool => pool.forEach(n => allUniqueNodes.set(n.id, n)));
    let globalIdx = 1;
    for (const [, node] of allUniqueNodes) {
      const strIdx = String(globalIdx);
      idToIndex.set(node.id, strIdx);
      indexToId.set(strIdx, node.id);
      globalIdx++;
    }

    const aiStartNodeIndex = idToIndex.get(startNodeId) || "1";

    const stageDistances = script.map(s => ({
      ...s,
      targetDistanceKm: (s.distancePct / 100) * distanceKm
    }));

    // Sample 10 points from ideal path for shape reference
    const idealPathSample = this.samplePoints(idealPath, 5);
    const idealPathStr = idealPathSample
      .map(p => `[${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}]`)
      .join(' → ');

    // Build per-stage blocks — cap at 40 nodes per stage to keep prompts fast.
    // Nodes are sorted by proximity to the stage midpoint so the closest (most useful) ones are kept.
    const MAX_NODES_PER_STAGE = 40;
    const stageBlocks = stageDistances.map((s, i) => {
      const pool = stageNodePools[i] || [];
      const idealSubPath = idealStagePaths[i] || [];
      const idealSubSampled = this.samplePoints(idealSubPath, 3);
      const idealSubStr = idealSubSampled
        .map(p => `[${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}]`)
        .join(' → ');

      // Trim pool to the N closest nodes to the stage midpoint
      let trimmedPool = pool;
      if (pool.length > MAX_NODES_PER_STAGE && idealSubPath.length > 0) {
        const midLat = idealSubPath.reduce((s, p) => s + p.lat, 0) / idealSubPath.length;
        const midLng = idealSubPath.reduce((s, p) => s + p.lng, 0) / idealSubPath.length;
        trimmedPool = [...pool]
          .sort((a, b) => {
            const da = Math.hypot(a.lat - midLat, a.lng - midLng);
            const db = Math.hypot(b.lat - midLat, b.lng - midLng);
            return da - db;
          })
          .slice(0, MAX_NODES_PER_STAGE);
      }

      const nodesStr = trimmedPool
        .map(n => {
          const nodeIdx = idToIndex.get(n.id) || '?';
          return `${nodeIdx}: ${n.lat.toFixed(4)}, ${n.lng.toFixed(4)}`;
        })
        .join('\n');
      return `=== STAGE ${s.stage}: Move ${s.direction}, target ${s.targetDistanceKm.toFixed(2)}km ===\nIdeal path for this stage: ${idealSubStr}\nAvailable nodes (ID: lat, lng):\n${nodesStr}`;
    }).join('\n\n');

    const prompt = `You are drawing a ${shapeName}. The ideal shape passes through these reference points:
${idealPathStr}

Execute each stage below. Use ONLY nodes from that stage's node list.

${stageBlocks}

Preferred start node ID: ${aiStartNodeIndex}
`;

    onProgress?.("AI is analyzing the road network...");
    const text = await this.submitGeminiJob(prompt, cacheKey, onProgress);

    try {
      // Robust repair and parse
      const repaired = jsonrepair(text);
      const result = JSON.parse(repaired);
      this.validateRawResult(result);

      // Map indices back to real OSM IDs
      const finalResult = {
        startNodeId: indexToId.get(String(result.startNodeId)) || startNodeId,
        stages: result.stages.map((s: any) => ({
          stageNumber: s.stageNumber,
          nodeIds: (s.nodeIds || []).map((idx: any) => indexToId.get(String(idx))).filter(Boolean)
        }))
      };

      // Cache result
      this.cache.set(cacheKey, finalResult);

      return finalResult;
    } catch (e: any) {
      if (e.message.startsWith("AI returned")) throw e;
      console.error("[DEBUG] Failed to parse Gemini response:", text, e);
      throw new Error(`Failed to parse AI response: ${e.message}`);
    }
  }

  async rerouteFailingStages(
    previousResult: GeminiStagedResult,
    fitnessResult: RouteFitness,
    stageNodePools: OSMNode[][],
    script: RouteStage[],
    idealStagePaths: Point[][],
    distanceKm: number,
    shapeName: string,
    nodeMap: Map<string, any>,
    onProgress?: (msg: string) => void
  ): Promise<GeminiStagedResult> {
    onProgress?.("AI is refining the route...");

    // Rebuild global index map from all stage pools
    const idToIndex = new Map<number, string>();
    const indexToId = new Map<string, number>();
    const allUniqueNodes = new Map<number, OSMNode>();
    stageNodePools.forEach(pool => pool.forEach(n => allUniqueNodes.set(n.id, n)));
    let globalIdx = 1;
    for (const [, node] of allUniqueNodes) {
      const strIdx = String(globalIdx);
      idToIndex.set(node.id, strIdx);
      indexToId.set(strIdx, node.id);
      globalIdx++;
    }

    const stageDistances = script.map(s => ({
      ...s,
      targetDistanceKm: (s.distancePct / 100) * distanceKm
    }));

    const stageBlocks = (fitnessResult.failingStages || []).map(s => {
      const stageIdx = s.stageNumber - 1;
      const scriptStage = script[stageIdx];
      const pool = stageNodePools[stageIdx] || [];
      const idealSubPath = idealStagePaths[stageIdx] || [];
      const targetDist = stageDistances[stageIdx]?.targetDistanceKm;
      const deviation = this.computeStageSpatialDeviation(s, previousResult, idealSubPath, nodeMap);
      const idealSubStr = this.samplePoints(idealSubPath, 3)
        .map(p => `[${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}]`)
        .join(' → ');
      const nodesStr = pool
        .map(n => {
          const nodeIdx = idToIndex.get(n.id) || '?';
          return `${nodeIdx}: ${n.lat.toFixed(4)}, ${n.lng.toFixed(4)}`;
        })
        .join('\n');

      return `Stage ${s.stageNumber} failed (score: ${s.overallStageScore}/100):
- Direction: needed ${scriptStage?.direction || '?'}, direction score was ${s.directionScore}/100
- Distance: needed ~${targetDist?.toFixed(2) || '?'}km, distance score was ${s.distanceScore}/100
${deviation ? `- ${deviation}` : ''}
- Ideal sub-path to trace: ${idealSubStr}
- Available nodes (try nodes closer to the ideal path):
${nodesStr}`;
    }).join('\n\n');

    const reroutePrompt = `Your previous route attempt for ${shapeName} scored ${fitnessResult.overallFitness}/100.
The following stages failed and need to be replanned:

${stageBlocks}

Replan ONLY the failing stages listed above.
Return a JSON object with a "stages" array containing ONLY the replanned stages.
Each stage MUST have "stageNumber" and "nodeIds". Use ONLY node IDs from that stage's available nodes list.
`;

    const rerouteCacheKey = JSON.stringify({
      op: "reroute",
      shapeName,
      distanceKm,
      startNodeId: previousResult.startNodeId,
      failingStages: (fitnessResult.failingStages || [])
        .map(s => ({ stageNumber: s.stageNumber, directionScore: s.directionScore, distanceScore: s.distanceScore }))
        .sort((a, b) => a.stageNumber - b.stageNumber),
    });

    onProgress?.("AI is refining the route...");
    const text = await this.submitGeminiJob(reroutePrompt, rerouteCacheKey, onProgress);

    try {
      const repaired = jsonrepair(text);
      const result = JSON.parse(repaired);

      // Basic validation of the new stages
      if (!result.stages || !Array.isArray(result.stages)) {
        throw new Error("AI returned invalid refinement data.");
      }

      // Map indices back to real OSM IDs for the new stages
      const newStagesMap = new Map<number, number[]>();
      result.stages.forEach((s: any) => {
        // Apply same hallucination fixes as validateRawResult
        if (!s.nodeIds && s.anchorPoints) s.nodeIds = s.anchorPoints;
        if (!s.nodeIds && s.nodes) s.nodeIds = s.nodes;
        if (s.stage_number && !s.stageNumber) s.stageNumber = s.stage_number;

        if (s.stageNumber !== undefined && Array.isArray(s.nodeIds)) {
          const realIds = s.nodeIds.map((idx: any) => indexToId.get(String(idx))).filter(Boolean);
          if (realIds.length > 0) {
            newStagesMap.set(s.stageNumber, realIds);
          }
        }
      });

      // Merge with previous results
      const mergedStages = previousResult.stages.map(oldStage => {
        if (newStagesMap.has(oldStage.stageNumber)) {
          return {
            stageNumber: oldStage.stageNumber,
            nodeIds: newStagesMap.get(oldStage.stageNumber)!
          };
        }
        return oldStage;
      });

      const validMergedStages = mergedStages.filter(s => s.nodeIds && s.nodeIds.length > 0);
      if (validMergedStages.length === 0) {
        throw new Error("AI refinement produced no valid stages.");
      }

      return {
        startNodeId: previousResult.startNodeId,
        stages: validMergedStages
      };
    } catch (e: any) {
      console.error("[DEBUG] Failed to parse Gemini refinement response:", text, e);
      throw new Error(`Failed to parse AI refinement: ${e.message}`);
    }
  }

  private validateRawResult(result: any): void {
    if (!result || typeof result !== "object") {
      throw new Error("AI returned an empty or invalid response.");
    }
    if (!result.stages || !Array.isArray(result.stages)) {
      throw new Error("AI returned a response missing the 'stages' array.");
    }
    if (result.stages.length === 0) {
      throw new Error("AI returned an empty stages array.");
    }

    // Filter out any null/undefined/empty objects that might have slipped through
    result.stages = result.stages.filter((s: any) => s && typeof s === "object" && Object.keys(s).length > 0);

    if (result.stages.length === 0) {
      throw new Error("AI returned stages, but they were all empty objects.");
    }

    result.stages.forEach((stage: any, index: number) => {
      // Handle common AI hallucinations for key names
      if (!stage.nodeIds && stage.anchorPoints) stage.nodeIds = stage.anchorPoints;
      if (!stage.nodeIds && stage.nodes) stage.nodeIds = stage.nodes;
      if (!stage.nodeIds && stage.waypoints) stage.nodeIds = stage.waypoints;
      if (!stage.nodeIds && stage.path) stage.nodeIds = stage.path;
      if (stage.stage_number && !stage.stageNumber) stage.stageNumber = stage.stage_number;

      // If nodeIds is null/undefined after fallback checks, treat as empty array
      // (scores 0 → becomes a failing stage → triggers reroute gracefully)
      if (stage.nodeIds == null) stage.nodeIds = [];

      // If nodeIds is a string (comma separated), convert to array
      if (typeof stage.nodeIds === "string") {
        stage.nodeIds = stage.nodeIds.split(",").map((s: string) => s.trim());
      }

      if (!Array.isArray(stage.nodeIds)) {
        const stageId = stage.stageNumber !== undefined ? stage.stageNumber : `at index ${index}`;
        const keysFound = Object.keys(stage).join(", ");
        throw new Error(`AI returned stage ${stageId} without a valid nodeIds array. Found keys: [${keysFound}]`);
      }
    });
  }
}
