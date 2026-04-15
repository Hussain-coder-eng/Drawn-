import { GoogleGenAI, Type } from "@google/genai";
import { jsonrepair } from "jsonrepair";
import { Point } from "../lib/shapeMath";
import { OSMNode } from "./overpassService";
import { RouteStage } from "../lib/routeScripts";
import { RouteFitness } from "./fitnessService";
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

export interface GeminiStagedResult {
  startNodeId: number;
  stages: { stageNumber: number; nodeIds: number[] }[];
}

export class GeminiService {
  private rateLimiter: RateLimiter;
  private cache: Map<string, GeminiStagedResult> = new Map();

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

  private async callWithRetry(fn: () => Promise<any>, maxRetries = 4): Promise<any> {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        return await fn();
      } catch (error: any) {
        attempt++;
        const errorStr = JSON.stringify(error);
        const isRateLimit = error.message?.includes("429") || 
                            error.status === "RESOURCE_EXHAUSTED" || 
                            errorStr.includes("429") ||
                            errorStr.includes("RESOURCE_EXHAUSTED");
        
        const isQuotaExceeded = errorStr.includes("exceeded your current quota") || 
                                error.message?.includes("quota") ||
                                error.message?.includes("RESOURCE_EXHAUSTED");

        if (isQuotaExceeded) {
          const quotaMsg = "Gemini API Daily Quota Exceeded. The free tier has a limit on how many routes you can generate per day. You can try again tomorrow, or use the 'Fine-tune' feature to manually adjust your route if you have a partial result.";
          throw new Error(quotaMsg);
        }

        if (isRateLimit && attempt < maxRetries) {
          // Exponential backoff: 2s, 4s, 8s, 16s...
          const delay = Math.pow(2, attempt) * 2000 + Math.random() * 1000;
          console.warn(`[DEBUG] Gemini Rate Limit hit. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }

  async selectNodesStaged(
    nodes: OSMNode[],
    script: RouteStage[],
    shapeName: string,
    distanceKm: number,
    startNodeId: number,
    onProgress?: (msg: string) => void
  ): Promise<GeminiStagedResult> {
    if (!script || !Array.isArray(script)) {
      throw new Error("Invalid shape script provided to AI.");
    }
    const ai = this.getAI();
    const model = "gemini-3-flash-preview";

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

    // Create a mapping to use small integer IDs for Gemini
    // This avoids precision issues with large OSM IDs and reduces tokens
    const idToIndex = new Map<number, string>();
    const indexToId = new Map<string, number>();
    
    const nodesForAI = nodes.map((n, i) => {
      const index = i + 1;
      const strIndex = String(index);
      idToIndex.set(n.id, strIndex);
      indexToId.set(strIndex, n.id);
      return `${strIndex}: ${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}`;
    }).join("\n");

    const aiStartNodeIndex = idToIndex.get(startNodeId) || "1";

    const stageDistances = script.map(s => ({
      ...s,
      targetDistanceKm: (s.distancePct / 100) * distanceKm
    }));

    const prompt = `
Available road nodes (ID: lat, lng):
${nodesForAI}

Shape script to execute:
${JSON.stringify(stageDistances)}

Total target distance: ${distanceKm}km
Preferred start node ID: ${aiStartNodeIndex}

Execute each stage in order selecting real node IDs from the list above.
The shape being drawn is: ${shapeName}
Remember — direction is more important than perfection. 
Follow the compass bearing for each stage using whatever roads are available.
`;

    let response;
    try {
      const { data: res } = await measureLatency("Gemini:GenerateContent", async () => {
        return await this.callWithRetry(() => ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: "application/json",
            maxOutputTokens: 4096,
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
        }));
      }, { silent: true });
      response = res;
    } catch (apiError: any) {
      if (apiError.message.includes("Quota Exceeded")) {
        throw apiError;
      }
      console.error("[DEBUG] Gemini API Call Failed:", apiError);
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
    nodes: OSMNode[],
    script: RouteStage[],
    distanceKm: number,
    shapeName: string,
    onProgress?: (msg: string) => void
  ): Promise<GeminiStagedResult> {
    const ai = this.getAI();
    const model = "gemini-3-flash-preview";

    // Rate Limit Check
    try {
      await this.rateLimiter.check();
    } catch (e: any) {
      throw new Error(`AI is busy: ${e.message}`);
    }

    onProgress?.("AI is refining the route...");

    // Create a mapping to use small integer IDs for Gemini
    const idToIndex = new Map<number, string>();
    const indexToId = new Map<string, number>();
    
    const nodesForAI = nodes.map((n, i) => {
      const index = i + 1;
      const strIndex = String(index);
      idToIndex.set(n.id, strIndex);
      indexToId.set(strIndex, n.id);
      return `${strIndex}: ${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}`;
    }).join("\n");

    const failingStageNumbers = (fitnessResult.failingStages || []).map(s => s.stageNumber);
    
    const stageDistances = script.map(s => ({
      ...s,
      targetDistanceKm: (s.distancePct / 100) * distanceKm
    }));

    const reroutePrompt = `
Your previous route attempt for ${shapeName} scored ${fitnessResult.overallFitness}/100.
The following stages failed and need to be replanned:

${(fitnessResult.failingStages || []).map(s => {
  const scriptIdx = s.stageNumber - 1;
  const scriptStage = script[scriptIdx];
  const targetDist = stageDistances[scriptIdx]?.targetDistanceKm;
  
  if (!scriptStage) return `Stage ${s.stageNumber}: Extra stage returned previously.`;
  
  return `
Stage ${s.stageNumber}:
- Direction score: ${s.directionScore}/100 (needed to travel ${scriptStage.direction})
- Distance score: ${s.distanceScore}/100 (needed to cover ${targetDist?.toFixed(2) || "unknown"}km)
- Problem: ${s.feedback}
`;
}).join('\n')}

Available road nodes (ID: lat, lng):
${nodesForAI}

Replan ONLY the failing stages listed above. 
Return a JSON object with a "stages" array containing ONLY the replanned stages.
Each stage MUST have "stageNumber" and "nodeIds".
`;

    let response;
    try {
      response = await this.callWithRetry(() => ai.models.generateContent({
        model,
        contents: reroutePrompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          maxOutputTokens: 4096,
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
      }));
    } catch (apiError: any) {
      if (apiError.message.includes("Quota Exceeded")) {
        throw apiError;
      }
      console.error("[DEBUG] Gemini Reroute API Call Failed:", apiError);
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

      // If nodeIds is a string (comma separated), convert to array
      if (typeof stage.nodeIds === "string") {
        stage.nodeIds = stage.nodeIds.split(",").map((s: string) => s.trim());
      }

      if (!stage.nodeIds || !Array.isArray(stage.nodeIds)) {
        const stageId = stage.stageNumber !== undefined ? stage.stageNumber : `at index ${index}`;
        const keysFound = Object.keys(stage).join(", ");
        throw new Error(`AI returned stage ${stageId} without a valid nodeIds array. Found keys: [${keysFound}]`);
      }
    });
  }
}

