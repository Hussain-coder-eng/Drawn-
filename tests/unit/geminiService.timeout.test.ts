import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeminiService } from "../../src/services/geminiService";

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
    // Pre-populate in-memory cache
    // Format: firestoreCacheKey + '|' + nodePoolHash (empty string for empty pools)
    const firestoreCacheKey = JSON.stringify({ shapeName: "circle", distanceKm: 5, startNodeId: 1, script: [] });
    const cacheKey = firestoreCacheKey + '|';
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
