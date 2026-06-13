import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeminiService } from "../../src/services/geminiService";

// Mock firebase/firestore
const mockUnsubscribe = vi.fn();
const mockOnSnapshot = vi.fn();
const mockAddDoc = vi.fn();

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: any[]) => mockAddDoc(...args),
  collection: vi.fn(() => "mock-collection-ref"),
  onSnapshot: (...args: any[]) => mockOnSnapshot(...args),
  serverTimestamp: vi.fn(() => ({ _seconds: 0 })),
}));

// Mock auth and db
vi.mock("../../src/firebase", () => ({
  auth: { currentUser: { uid: "user-123" } },
  db: {},
}));

// Helper: simulate a Firestore snapshot with given data
function makeSnap(data: Record<string, any>) {
  return { data: () => data };
}

// Access private method
function submitJob(service: GeminiService, prompt: string, cacheKey: string, onProgress?: (m: string) => void) {
  return (service as any).submitGeminiJob(prompt, cacheKey, onProgress);
}

describe("GeminiService.submitGeminiJob", () => {
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
    mockUnsubscribe.mockReset();
  });

  it("throws if user is not signed in", async () => {
    const firebase = await import("../../src/firebase");
    const origUser = firebase.auth.currentUser;
    (firebase.auth as any).currentUser = null;
    try {
      await expect(submitJob(service, "prompt", "key")).rejects.toThrow("signed in");
    } finally {
      (firebase.auth as any).currentUser = origUser;
    }
  });

  it("resolves with result when job status becomes 'done'", async () => {
    const mockDocRef = { id: "job-abc" };
    mockAddDoc.mockResolvedValue(mockDocRef);
    mockOnSnapshot.mockImplementation((_ref: any, handler: (snap: any) => void) => {
      // Simulate async status update: pending → done
      setTimeout(() => handler(makeSnap({ status: "pending" })), 10);
      setTimeout(() => handler(makeSnap({ status: "done", result: '{"startNodeId":"1","stages":[]}' })), 100);
      return mockUnsubscribe;
    });

    const promise = submitJob(service, "test prompt", "cache-key");
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result).toBe('{"startNodeId":"1","stages":[]}');
    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it("rejects with error message when job status becomes 'failed'", async () => {
    mockAddDoc.mockResolvedValue({ id: "job-fail" });
    mockOnSnapshot.mockImplementation((_ref: any, handler: (snap: any) => void) => {
      setTimeout(() => handler(makeSnap({ status: "failed", error: "Rate limited" })), 50);
      return mockUnsubscribe;
    });

    // Attach catch before advancing timers to prevent unhandled rejection
    let caughtErr: Error | undefined;
    const promise = submitJob(service, "prompt", "key").catch((e: Error) => { caughtErr = e; });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(caughtErr?.message).toMatch(/Rate limited/);
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it("calls onProgress when status is 'processing'", async () => {
    const onProgress = vi.fn();
    mockAddDoc.mockResolvedValue({ id: "job-proc" });
    mockOnSnapshot.mockImplementation((_ref: any, handler: (snap: any) => void) => {
      setTimeout(() => handler(makeSnap({ status: "processing" })), 10);
      setTimeout(() => handler(makeSnap({ status: "done", result: "ok" })), 100);
      return mockUnsubscribe;
    });

    const promise = submitJob(service, "prompt", "key", onProgress);
    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(onProgress).toHaveBeenCalledWith("AI is analyzing the road network...");
  });

  it("rejects with timeout error after 120 seconds", async () => {
    mockAddDoc.mockResolvedValue({ id: "job-slow" });
    mockOnSnapshot.mockImplementation((_ref: any, handler: (snap: any) => void) => {
      // Never resolves
      setTimeout(() => handler(makeSnap({ status: "processing" })), 100);
      return mockUnsubscribe;
    });

    const promise = submitJob(service, "prompt", "key").catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(120_001);
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/timed out/i);
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it("rejects if Firestore onSnapshot errors", async () => {
    mockAddDoc.mockResolvedValue({ id: "job-err" });
    mockOnSnapshot.mockImplementation((_ref: any, _handler: any, errorHandler: (e: Error) => void) => {
      setTimeout(() => errorHandler(new Error("Permission denied")), 10);
      return mockUnsubscribe;
    });

    // Attach catch before advancing timers to prevent unhandled rejection
    let caughtErr: Error | undefined;
    const promise = submitJob(service, "prompt", "key").catch((e: Error) => { caughtErr = e; });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(caughtErr?.message).toMatch(/Permission denied/);
  });
});

describe('GeminiService anchor quality helpers', () => {
  let service: GeminiService;
  beforeEach(() => { service = new GeminiService(); });

  it('computeAnchorFrechetKm returns 0 for empty inputs', () => {
    expect((service as any).computeAnchorFrechetKm([], [])).toBe(0);
    expect((service as any).computeAnchorFrechetKm([{ lat: 0, lng: 0 }], [])).toBe(0);
  });

  it('computeAnchorFrechetKm is small when anchors lie on the ideal path', () => {
    const ideal = [
      { lat: 51.50, lng: -0.10 },
      { lat: 51.51, lng: -0.10 },
      { lat: 51.52, lng: -0.10 },
    ];
    const anchors = [{ lat: 51.50, lng: -0.10 }, { lat: 51.51, lng: -0.10 }, { lat: 51.52, lng: -0.10 }];
    const d = (service as any).computeAnchorFrechetKm(anchors, ideal);
    expect(d).toBeLessThan(0.1);
  });

  it('computeAnchorFrechetKm is large when anchors miss the ideal path', () => {
    const ideal = [
      { lat: 51.50, lng: -0.10 },
      { lat: 51.51, lng: -0.10 },
    ];
    const anchors = [{ lat: 52.50, lng: -0.10 }];
    const d = (service as any).computeAnchorFrechetKm(anchors, ideal);
    expect(d).toBeGreaterThan(50);
  });

  it('computeAnchorFeedback identifies the missing compass direction', () => {
    const ideal = [
      { lat: 51.50, lng: -0.10 },
      { lat: 51.55, lng: -0.05 },
    ];
    // Anchors only cover southern portion
    const anchors = [{ lat: 51.50, lng: -0.10 }, { lat: 51.50, lng: -0.09 }];
    const feedback = (service as any).computeAnchorFeedback(anchors, ideal);
    expect(feedback).toMatch(/N/);
  });
});
