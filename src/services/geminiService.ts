import { GoogleGenAI, Type } from "@google/genai";
import { jsonrepair } from "jsonrepair";
import { Point } from "../lib/shapeMath";
import { OSMNode } from "./overpassService";
import { RouteStage } from "../lib/routeScripts";
import { RouteFitness } from "./fitnessService";

const SYSTEM_PROMPT = `
You are a precision GPS route planner. Your task is to select key "Anchor Points" (waypoints) from a road network to draw a specific shape.

CRITICAL RULES:
- Only use node IDs from the provided nodes list — never invent coordinates.
- Follow stages in strict order.
- Each stage must travel in the specified compass direction.
- Select "Anchor Points" that define the "skeleton" of the shape (corners, curves, apexes).
- The final node of each stage becomes the first node of the next stage.
- The last node of the final stage must be the same as the start node (closed loop).
- Avoid backtracking. Every node must progress the route in the stage direction.
- Between stages, take the most direct available road to transition.
- Each stage should typically have 3-6 high-quality Anchor Points.
- If a road doesn't exist in the exact direction, pick the closest one that still makes progress.
- IMPORTANT: Every stage in the "stages" array MUST have a "nodeIds" array, even if it only contains 2 nodes.

Return ONLY the JSON object with the exact keys "startNodeId" and "stages". Each stage object MUST use the keys "stageNumber" and "nodeIds".
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
  private getAI(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key is missing. Please check your settings.");
    }
    return new GoogleGenAI({ apiKey });
  }

  private async callWithRetry(fn: () => Promise<any>, maxRetries = 3): Promise<any> {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        return await fn();
      } catch (error: any) {
        attempt++;
        const isRateLimit = error.message?.includes("429") || error.status === "RESOURCE_EXHAUSTED" || JSON.stringify(error).includes("429");
        
        if (isRateLimit && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
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
    const model = "gemini-3.1-pro-preview";

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
      response = await this.callWithRetry(() => ai.models.generateContent({
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
    } catch (apiError: any) {
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
      return {
        startNodeId: indexToId.get(String(result.startNodeId)) || startNodeId,
        stages: result.stages.map((s: any) => ({
          stageNumber: s.stageNumber,
          nodeIds: (s.nodeIds || []).map((idx: any) => indexToId.get(String(idx))).filter(Boolean)
        }))
      };
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
    const model = "gemini-3.1-pro-preview";

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
    
    // Map previous results to indices
    const lockedStages = (previousResult.stages || [])
      .filter(s => !failingStageNumbers.includes(s.stageNumber))
      .map(s => ({
        stageNumber: s.stageNumber,
        nodeIds: s.nodeIds.map(id => idToIndex.get(id)).filter(Boolean)
      }));

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

The following stages PASSED and must remain exactly as returned previously (using the new node IDs):
${JSON.stringify(lockedStages)}

Available road nodes (ID: lat, lng):
${nodesForAI}

Replan ONLY the failing stages. Keep all locked stages unchanged.
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
    } catch (apiError: any) {
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
      this.validateRawResult(result);

      // Map indices back to real OSM IDs
      return {
        startNodeId: indexToId.get(String(result.startNodeId)) || previousResult.startNodeId,
        stages: result.stages.map((s: any) => ({
          stageNumber: s.stageNumber,
          nodeIds: (s.nodeIds || []).map((idx: any) => indexToId.get(String(idx))).filter(Boolean)
        }))
      };
    } catch (e: any) {
      if (e.message.startsWith("AI returned")) throw e;
      console.error("[DEBUG] Failed to parse Gemini response:", text, e);
      throw new Error(`Failed to parse AI response: ${e.message}`);
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
    
    result.stages.forEach((stage: any, index: number) => {
      if (!stage || typeof stage !== "object") {
        throw new Error(`AI returned an invalid stage object at index ${index}.`);
      }
      
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

