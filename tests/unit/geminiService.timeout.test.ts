import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeminiService, hashString } from "../../src/services/geminiService";

const mockUnsubscribe = vi.fn();
const mockOnSnapshot = vi.fn();
const mockAddDoc = vi.fn();

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: any[]) => mockAddDoc(...args),
  collection: vi.fn(() => "mock-collection-ref"),
  onSnapshot: (...args: any[]) => mockOnSnapshot(...args),
  serverTimestamp: vi.fn(() => ({ _seconds: 0 })),
}));

vi.mock("../../src/firebase", () => ({
  auth: { currentUser: { uid: "test-user" } },
  db: {},
}));

function makeSnap(data: Record<string, any>) {
  return { data: () => data };
}

describe("GeminiService in-memory cache", () => {
  let service: GeminiService;

  beforeEach(() => {
    service = new GeminiService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockAddDoc.mockReset();
    mockOnSnapshot.mockReset();
  });

  it("does not call submitGeminiJob on cache hit", async () => {
    // Pre-populate in-memory cache using the v2 key format.
    // Empty pools → nodePoolHash is "", empty script → script array is [].
    // Key mirrors exactly what selectNodesStaged computes for these inputs.
    const cacheKey = `v2:circle:5:1:${hashString(JSON.stringify({ script: [], nodePoolHash: "" }))}`;
    const cachedResult = { startNodeId: 1, stages: [] };
    (service as any).cache.set(cacheKey, cachedResult);

    const submitSpy = vi.spyOn(service as any, "submitGeminiJob");

    // selectNodesStaged with empty script/pools
    const result = await service.selectNodesStaged(
      [],    // stageNodePools
      [],    // script
      "circle",
      5,
      1,
      [],    // idealPath
      [],    // idealStagePaths
    );

    expect(result).toEqual(cachedResult);
    expect(submitSpy).not.toHaveBeenCalled();
  });
});
