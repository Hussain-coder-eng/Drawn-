import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";

const geminiApiKey = defineSecret("GEMINI_API_KEY");

initializeApp();

const DB_ID = process.env.FIRESTORE_DATABASE_ID || "ai-studio-8d05534a-096d-44c8-89cf-8276f572cb75";

const RATE_LIMIT_PER_HOUR = 20;
const MAX_ACTIVE_CALLS = 10;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GEMINI_TIMEOUT_MS = 45_000;
const MAX_GEMINI_RETRIES = 3;

const SYSTEM_PROMPT = `You are a precision GPS route planner. Select "Anchor Points" (waypoints) from the road network to draw the requested shape.

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
}`;

async function callGeminiWithRetry(prompt: string, apiKey: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  let lastError: Error = new Error("Gemini API failed after exhausting all retries.");

  for (let attempt = 1; attempt <= MAX_GEMINI_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: controller.signal,
        },
      });
      clearTimeout(timer);

      if (!response) throw new Error("Gemini returned no response object.");
      const text = response.text;
      if (!text) throw new Error("Gemini returned an empty response.");
      return text;
    } catch (err: unknown) {
      clearTimeout(timer);
      const e = err instanceof Error ? err : new Error(String(err));
      lastError = e;

      const msg = e.message ?? "";
      const isQuota = msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED");
      if (isQuota) throw new Error("Gemini API Daily Quota Exceeded. Try again tomorrow.");

      const isRetryable =
        msg.includes("429") ||
        msg.includes("503") ||
        msg.includes("UNAVAILABLE") ||
        e.name === "AbortError" ||
        e.name === "TimeoutError";

      if (attempt < MAX_GEMINI_RETRIES && isRetryable) {
        const delay = Math.min(Math.pow(2, attempt) * 1000 + Math.random() * 500, 15_000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }
  throw lastError;
}

export const processGeminiJob = onDocumentCreated(
  {
    document: "jobs/{jobId}",
    database: DB_ID,
    secrets: [geminiApiKey],
    timeoutSeconds: 120,
    memory: "256MiB",
  },
  async (event) => {
    const db = getFirestore(DB_ID);
    const jobId = event.params.jobId;
    const jobRef = db.collection("jobs").doc(jobId);
    const raw = event.data?.data();
    if (!raw || raw.status !== "pending") return;

    const uid: string = raw.uid;
    const prompt: string = raw.prompt;
    const cacheKey: string = raw.cacheKey;

    // 1. Per-user rate limit
    const userRef = db.collection("users").doc(uid);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const now = Date.now();
        const d = snap.data() ?? {};
        const windowStart: number = d.routeGenWindowStart ?? 0;
        let count: number = d.routeGenCount ?? 0;
        if (now - windowStart > 60 * 60 * 1000) count = 0;

        if (count >= RATE_LIMIT_PER_HOUR) {
          const waitMin = Math.ceil((60 * 60 * 1000 - (now - windowStart)) / 60_000);
          throw new Error(
            `RATE_LIMITED:You've reached 20 routes this hour. Try again in ${waitMin} minute${waitMin === 1 ? "" : "s"}.`
          );
        }

        const update: Record<string, unknown> =
          count === 0
            ? { routeGenCount: 1, routeGenWindowStart: now }
            : { routeGenCount: FieldValue.increment(1), routeGenWindowStart: windowStart };
        tx.set(userRef, update, { merge: true });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("RATE_LIMITED:")) {
        await jobRef.update({
          status: "failed",
          error: msg.replace("RATE_LIMITED:", ""),
          updatedAt: Timestamp.now(),
        });
        return;
      }
      throw err;
    }

    // 2. Global concurrency cap
    const configRef = db.collection("config").doc("gemini");
    let slotAcquired = false;
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(configRef);
        const active: number = snap.data()?.activeCalls ?? 0;
        if (active >= MAX_ACTIVE_CALLS) throw new Error("BUSY");
        tx.set(configRef, { activeCalls: FieldValue.increment(1) }, { merge: true });
      });
      slotAcquired = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "BUSY") {
        await jobRef.update({
          status: "failed",
          error: "The server is busy right now. Please try again in 30 seconds.",
          updatedAt: Timestamp.now(),
        });
        return;
      }
      throw err;
    }

    await jobRef.update({ status: "processing", updatedAt: Timestamp.now() });

    try {
      // 3. Shared Firestore cache
      const safeCacheKey = cacheKey.replace(/[^a-zA-Z0-9_-]/g, "_");
      const cacheRef = db.collection("geminiCache").doc(safeCacheKey);
      const cacheSnap = await cacheRef.get();
      if (cacheSnap.exists) {
        const cacheData = cacheSnap.data()!;
        const expiresAt = cacheData.expiresAt as Timestamp;
        if (expiresAt.toMillis() > Date.now()) {
          await cacheRef.update({ hitCount: FieldValue.increment(1) });
          await jobRef.update({
            status: "done",
            result: cacheData.text,
            fromCache: true,
            updatedAt: Timestamp.now(),
          });
          return;
        }
      }

      // 4. Call Gemini
      const text = await callGeminiWithRetry(prompt, geminiApiKey.value());

      // 5. Write to cache
      await cacheRef.set({
        cacheKey,
        text,
        hitCount: 0,
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + CACHE_TTL_MS),
      });

      // 6. Resolve job
      await jobRef.update({
        status: "done",
        result: text,
        updatedAt: Timestamp.now(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error from AI service.";
      await jobRef.update({
        status: "failed",
        error: msg,
        updatedAt: Timestamp.now(),
      });
    } finally {
      if (slotAcquired) {
        await configRef.update({ activeCalls: FieldValue.increment(-1) }).catch(() => {});
      }
    }
  }
);
