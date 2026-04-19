import * as turf from "@turf/turf";
import { GoogleGenAI, Type } from "@google/genai";
import { jsonrepair } from "jsonrepair";
import { Point } from "../lib/shapeMath";
import { OSMNode } from "./overpassService";
import { RouteStage } from "../lib/routeScripts";
import { RouteFitness, StageScore } from "./fitnessService";
import { RateLimiter } from "./rateLimiter";
import { measureLatency } from "../lib/latency";

const SYSTEM_PROMPT = `
You are a precision GPS route planner. Select "Anchor Points" (waypoints) from the road network to draw the requested shape.

RULES:
- Use ONLY provided node IDs.
- Follow stages in strict order.
- Each stage MUST travel in the specified compass direction.
- PRIORITIZE "Visual Silhouette": Pick nodes that define the corners, curves, and apexes of the shape.
- Select 4-8 Anchor Points per stage for high-fidelity tracing.
- Final node of a stage MUST be the first node of the next stage.
- Last node of the final stage MUST match the start node (closed loop).
- Avoid backtracking. Every node must progress the route.
- Every stage in the "stages" array MUST have a "nodeIds" array.

Return ONLY JSON:
{
  "startNodeId": "1",
  "stages": [
    { "stageNumber": 1, "nodeIds": ["1", "2", "3"] },
    { "stageNumber": 2, "nodeIds": ["3", "4", "5"] }
  ]
}
`;

/**
 * Client-side abort for `generateContent`.
 * Large stage prompts + JSON schema often exceed 10–20s; a short timeout produced
 * fetch aborts surfaced as "signal is aborted without reason" from the HTTP client.
 */
const GEMINI_REQUEST_TIMEOUT_MS = 120_000;

export interface GeminiStagedResult {
  startNodeId: number;
  stages: { stageNumber: number; nodeIds: number[] }[];
}

export class GeminiService {
  private rateLimiter: RateLimiter;
  private cache: Map<string, GeminiStagedResult> = new Map();

  private static isAbortLikeError(err: unknown): boolean {
    if (err == null || typeof err !== "object") return false;
    const e = err as { name?: string; message?: string };
    const name = e.name ?? "";
    const msg = (e.message ?? "").toLowerCase();
    if (name === "AbortError" || name === "TimeoutError") return true;
    if (msg.includes("abort")) return true;
    if (typeof DOMException !== "undefined" && err instanceof DOMException) {
      if (err.name === "TimeoutError" || err.name === "AbortError") return true;
      if (err.code === 20) return true; // DOMException.ABORT_ERR
    }
    return false;
  }

  private static logGeminiFailure(context: string, err: unknown, extra: Record<string, unknown> = {}): void {
    const payload: Record<string, unknown> = { context, ...extra };
    if (err instanceof Error) {
      payload.errorName = err.name;
      payload.errorMessage = err.message;
      payload.errorStack = err.stack;
    } else {
      payload.errorType = typeof err;
      payload.errorString = String(err);
    }
    if (typeof DOMException !== "undefined" && err instanceof DOMException) {
      payload.domException = true;
      payload.domExceptionName = err.name;
      payload.domExceptionCode = err.code;
    }
    const anyErr = err as { cause?: unknown };
    if (anyErr?.cause !== undefined) {
      const c = anyErr.cause;
      payload.cause =
        c instanceof Error ? { name: c.name, message: c.message } : c;
    }
    console.error("[Gemini]", payload);
  }

  constructor() {
    // Limit to 5 requests per minute to stay well within free tier limits
    this.rateLimiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });
  }

  private getAI(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key is missing. Please check your settings.");
    }
    return new GoogleGenAI({ apiKey });
  }

  private static isNetworkError(err: unknown): boolean {
    if (err == null || typeof err !== "object") return false;
    const e = err as { name?: string; message?: string };
    const name = (e.name ?? "").toLowerCase();
    const msg = (e.message ?? "").toLowerCase();
    // Covers: TypeError: Failed to fetch, NetworkError, ERR_NETWORK, etc.
    return (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network error") ||
      name === "networkerror" ||
      msg.includes("err_network") ||
      msg.includes("load failed") // Safari's equivalent of "Failed to fetch"; also fires on CORS errors — accepted as safe false-positive for this endpoint
    );
  }

  private async callWithRetry(
    fn: () => Promise<any>,
    maxRetries = 3,
    onProgress?: (msg: string) => void,
    operationLabel?: string
  ): Promise<any> {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        return await fn();
      } catch (error: any) {
        attempt++;
        console.error("[Gemini]", {
          event: "callWithRetry_catch",
          operationLabel,
          attempt,
          maxRetries,
          isAbortLike: GeminiService.isAbortLikeError(error),
          isNetworkError: GeminiService.isNetworkError(error),
          errorName: error?.name,
          errorMessage: error?.message,
        });
        const errorStr = JSON.stringify(error);
        const isRateLimit = error.message?.includes("429") ||
                            error.status === "RESOURCE_EXHAUSTED" ||
                            errorStr.includes("429") ||
                            errorStr.includes("RESOURCE_EXHAUSTED");

        const isQuotaExceeded = errorStr.includes("exceeded your current quota") ||
                                error.message?.includes("quota") ||
                                error.message?.includes("RESOURCE_EXHAUSTED");

        const isUnavailable = error.status === "UNAVAILABLE" ||
                              errorStr.includes("503") ||
                              errorStr.includes("UNAVAILABLE") ||
                              error.message?.includes("503") ||
                              error.message?.includes("high demand");

        const isNetworkBlip = GeminiService.isNetworkError(error);

        if (isQuotaExceeded) {
          const quotaMsg = "Gemini API Daily Quota Exceeded. The free tier has a limit on how many routes you can generate per day. You can try again tomorrow, or use the 'Fine-tune' feature to manually adjust your route if you have a partial result.";
          throw new Error(quotaMsg);
        }

        if ((isRateLimit || isUnavailable || isNetworkBlip) && attempt < maxRetries) {
          // Exponential backoff: 0.5s, 1s, 2s...
          const delay = Math.pow(2, attempt) * 500 + Math.random() * 500;
          const delaySec = Math.round(delay / 1000);
          if (isUnavailable) {
            console.warn(`[DEBUG] Gemini Unavailable (503). Retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxRetries})`);
            onProgress?.(`Gemini is busy — retrying in ${delaySec}s… (attempt ${attempt}/${maxRetries - 1})`);
          } else if (isNetworkBlip) {
            console.warn(`[DEBUG] Gemini network error. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxRetries})`);
            onProgress?.(`Connection issue — retrying in ${delaySec}s… (attempt ${attempt}/${maxRetries - 1})`);
          } else {
            console.warn(`[DEBUG] Gemini Rate Limit hit. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxRetries})`);
            onProgress?.(`AI rate limit reached — retrying in ${delaySec}s… (attempt ${attempt}/${maxRetries - 1})`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
          onProgress?.("AI is analyzing the road network...");
          continue;
        }
        throw error;
      }
    }
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
    const ai = this.getAI();
    const model = "gemini-2.5-flash";

    // 0. Check Cache
    const cacheKey = JSON.stringify({ shapeName, distanceKm, startNodeId, script: script.map(s => s.stage) });
    if (this.cache.has(cacheKey)) {
      console.log("[DEBUG] Returning cached Gemini result");
      return this.cache.get(cacheKey)!;
    }

    // 1. Rate Limit Check
    try {
      await this.rateLimiter.check();
    } catch (e: any) {
      throw new Error(`AI is busy: ${e.message}`);
    }

    onProgress?.("AI is analyzing the road network...");

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
    const idealPathSample = this.samplePoints(idealPath, 10);
    const idealPathStr = idealPathSample
      .map(p => `[${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}]`)
      .join(' → ');

    // Build per-stage blocks — cap at 80 nodes per stage to keep prompts fast.
    // Nodes are sorted by proximity to the stage midpoint so the closest (most useful) ones are kept.
    const MAX_NODES_PER_STAGE = 80;
    const stageBlocks = stageDistances.map((s, i) => {
      const pool = stageNodePools[i] || [];
      const idealSubPath = idealStagePaths[i] || [];
      const idealSubSampled = this.samplePoints(idealSubPath, 3);
      const idealSubStr = idealSubSampled
        .map(p => `[${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}]`)
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
          return `${nodeIdx}: ${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}`;
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

    let response;
    const apiCallStartedAt = performance.now();
    try {
      console.info("[Gemini] request_meta", {
        operation: "selectNodesStaged",
        model,
        promptCharLength: prompt.length,
        stageCount: script.length,
        stagePoolSizes: stageNodePools.map(p => p.length),
        stagePoolSizesCapped: stageNodePools.map(p => Math.min(p.length, MAX_NODES_PER_STAGE)),
        timeoutMs: GEMINI_REQUEST_TIMEOUT_MS,
      });
      const { data: res } = await measureLatency("Gemini:GenerateContent", async () => {
        return await this.callWithRetry(() => ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
            // Disable thinking: node selection is a deterministic lookup task,
            // not a reasoning task. Thinking adds latency and token cost with
            // no quality benefit for structured JSON output.
            thinkingConfig: { thinkingBudget: 0 },
            abortSignal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                startNodeId: { type: Type.STRING },
                stages: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      stageNumber: { type: Type.INTEGER },
                      nodeIds: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                      }
                    },
                    required: ["stageNumber", "nodeIds"]
                  }
                }
              },
              required: ["startNodeId", "stages"]
            }
          }
        }), 4, onProgress, "selectNodesStaged");
      }, { silent: true });
      response = res;
    } catch (apiError: any) {
      const elapsedMs = Math.round(performance.now() - apiCallStartedAt);
      GeminiService.logGeminiFailure("selectNodesStaged:generateContent", apiError, {
        elapsedMs,
        configuredTimeoutMs: GEMINI_REQUEST_TIMEOUT_MS,
        isAbortLike: GeminiService.isAbortLikeError(apiError),
      });
      if (apiError.message?.includes("Quota Exceeded")) {
        throw apiError;
      }
      const errorStr = JSON.stringify(apiError);
      const isUnavailable = apiError.status === "UNAVAILABLE" ||
                            errorStr.includes("503") ||
                            errorStr.includes("UNAVAILABLE") ||
                            apiError.message?.includes("high demand");
      if (isUnavailable) {
        throw new Error("Gemini is currently experiencing high demand. Please try again in a few moments.");
      }
      if (GeminiService.isAbortLikeError(apiError)) {
        throw new Error(
          `The AI request timed out after ${Math.round(GEMINI_REQUEST_TIMEOUT_MS / 1000)}s. Try again, or simplify the shape or map area.`
        );
      }
      throw new Error(`Failed to call the Gemini API: ${apiError.message || "Unknown error"}`);
    }

    let text = response.text;
    if (!text) {
      console.error("[DEBUG] Gemini returned an empty response.", response);
      throw new Error("Gemini returned an empty response.");
    }
    
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
      const cacheKey = JSON.stringify({ shapeName, distanceKm, startNodeId, script: script.map(s => s.stage) });
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
    const ai = this.getAI();
    const model = "gemini-2.5-flash";

    // Rate Limit Check
    try {
      await this.rateLimiter.check();
    } catch (e: any) {
      throw new Error(`AI is busy: ${e.message}`);
    }

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
        .map(p => `[${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}]`)
        .join(' → ');
      const nodesStr = pool
        .map(n => {
          const nodeIdx = idToIndex.get(n.id) || '?';
          return `${nodeIdx}: ${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}`;
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

    let response;
    const rerouteApiCallStartedAt = performance.now();
    try {
      console.info("[Gemini] request_meta", {
        operation: "rerouteFailingStages",
        model,
        promptCharLength: reroutePrompt.length,
        failingStageCount: (fitnessResult.failingStages || []).length,
        scriptStageCount: script.length,
        stagePoolSizes: stageNodePools.map(p => p.length),
        timeoutMs: GEMINI_REQUEST_TIMEOUT_MS,
      });
      const { data: rerouteRes } = await measureLatency("Gemini:RerouteStages", async () => {
        return await this.callWithRetry(() => ai.models.generateContent({
          model,
          contents: reroutePrompt,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
            // Disable thinking: same rationale as selectNodesStaged — rerouting
            // is a constrained lookup task, not a reasoning task.
            thinkingConfig: { thinkingBudget: 0 },
            abortSignal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                stages: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      stageNumber: { type: Type.INTEGER },
                      nodeIds: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                      }
                    },
                    required: ["stageNumber", "nodeIds"]
                  }
                }
              },
              required: ["stages"]
            }
          }
        }), 2, onProgress, "rerouteFailingStages");
      }, { silent: true });
      response = rerouteRes;
    } catch (apiError: any) {
      const elapsedMs = Math.round(performance.now() - rerouteApiCallStartedAt);
      GeminiService.logGeminiFailure("rerouteFailingStages:generateContent", apiError, {
        elapsedMs,
        configuredTimeoutMs: GEMINI_REQUEST_TIMEOUT_MS,
        isAbortLike: GeminiService.isAbortLikeError(apiError),
      });
      if (apiError.message?.includes("Quota Exceeded")) {
        throw apiError;
      }
      const errorStr = JSON.stringify(apiError);
      const isUnavailable = apiError.status === "UNAVAILABLE" ||
                            errorStr.includes("503") ||
                            errorStr.includes("UNAVAILABLE") ||
                            apiError.message?.includes("high demand");
      if (isUnavailable) {
        throw new Error("Gemini is currently experiencing high demand. Please try again in a few moments.");
      }
      if (GeminiService.isAbortLikeError(apiError)) {
        throw new Error(
          `The AI request timed out after ${Math.round(GEMINI_REQUEST_TIMEOUT_MS / 1000)}s. Try again, or simplify the shape or map area.`
        );
      }
      throw new Error(`Failed to call the Gemini API: ${apiError.message || "Unknown error"}`);
    }

    let text = response.text;
    if (!text) {
      console.error("[DEBUG] Gemini returned an empty response.", response);
      throw new Error("Gemini returned an empty response.");
    }

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

      return {
        startNodeId: previousResult.startNodeId,
        stages: mergedStages
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

