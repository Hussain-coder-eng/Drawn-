/**
 * Unit tests for GeminiService.callWithRetry timeout logic.
 *
 * Tests are focused on the private `callWithRetry` method, accessed via `as any`.
 * No real API calls are made. Fake timers are used to control setTimeout delays.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeminiService } from "../../src/services/geminiService";

// Helper: build a TimeoutError that `isAbortLikeError` detects
function makeTimeoutError(msg = "The operation timed out"): Error {
  return Object.assign(new Error(msg), { name: "TimeoutError" });
}

// Helper: build an AbortError that `isAbortLikeError` detects
function makeAbortError(msg = "signal is aborted"): Error {
  return Object.assign(new Error(msg), { name: "AbortError" });
}

// Helper: build a 503/UNAVAILABLE error
function makeUnavailableError(): Error {
  return Object.assign(new Error("503 Service Unavailable"), { status: "UNAVAILABLE" });
}

// Helper: quota-exceeded error (should throw immediately)
function makeQuotaError(): Error {
  return new Error("exceeded your current quota — please upgrade");
}

// Shortcut: invoke the private method
function callWithRetry(
  service: GeminiService,
  fn: () => Promise<any>,
  maxRetries = 6,
  onProgress?: (msg: string) => void,
  label?: string
): Promise<any> {
  return (service as any).callWithRetry(fn, maxRetries, onProgress, label);
}

describe("GeminiService.callWithRetry — timeout retry logic", () => {
  let service: GeminiService;

  beforeEach(() => {
    // Constructor only creates a RateLimiter — no API key needed
    service = new GeminiService();
    // Use fake timers so we can control setTimeout delays
    vi.useFakeTimers();
    // Pin Math.random to 0 → deterministic 5000ms timeout delay
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─── Happy path ──────────────────────────────────────────────────────────────

  it("happy path: returns result immediately when fn succeeds", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const promise = callWithRetry(service, fn);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("happy path: onProgress is NOT called when fn succeeds on the first try", async () => {
    const onProgress = vi.fn();
    const fn = vi.fn().mockResolvedValue("ok");
    await callWithRetry(service, fn, 6, onProgress);
    expect(onProgress).not.toHaveBeenCalled();
  });

  // ─── Timeout: single retry ───────────────────────────────────────────────────

  it("retries exactly once on a TimeoutError, then resolves", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeTimeoutError())
      .mockResolvedValueOnce("success after retry");

    const promise = callWithRetry(service, fn);

    // Advance past the 5000ms retry delay
    await vi.advanceTimersByTimeAsync(5100);

    const result = await promise;
    expect(result).toBe("success after retry");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls onProgress with 'taking longer than expected' message on timeout", async () => {
    const onProgress = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeTimeoutError())
      .mockResolvedValueOnce("ok");

    const promise = callWithRetry(service, fn, 6, onProgress);
    await vi.advanceTimersByTimeAsync(5100);
    await promise;

    // First onProgress call should contain the "taking longer" message
    const calls = onProgress.mock.calls.map(([msg]) => msg as string);
    expect(calls.some(m => m.toLowerCase().includes("taking longer"))).toBe(true);
    expect(calls.some(m => m.toLowerCase().includes("retrying"))).toBe(true);
  });

  it("calls onProgress with 'analyzing' after the retry delay elapses", async () => {
    const onProgress = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeTimeoutError())
      .mockResolvedValueOnce("ok");

    const promise = callWithRetry(service, fn, 6, onProgress);
    await vi.advanceTimersByTimeAsync(5100);
    await promise;

    const calls = onProgress.mock.calls.map(([msg]) => msg as string);
    // After the delay the code fires "AI is analyzing the road network..."
    expect(calls.some(m => m.toLowerCase().includes("analyzing"))).toBe(true);
  });

  it("retry delay is ~5000ms (Math.random pinned to 0)", async () => {
    // If we advance by only 4999ms the fn should NOT have been called a second time yet
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeTimeoutError())
      .mockResolvedValueOnce("ok");

    const promise = callWithRetry(service, fn);

    // Advance to just before the 5s mark — still waiting
    await vi.advanceTimersByTimeAsync(4999);
    expect(fn).toHaveBeenCalledTimes(1); // second call hasn't fired yet

    // Now cross the threshold
    await vi.advanceTimersByTimeAsync(2);
    await promise;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // ─── Timeout: exhausted after 1 retry ────────────────────────────────────────

  it("throws the error after the single timeout retry is exhausted (does NOT retry again)", async () => {
    // fn always throws TimeoutError — after 1 retry it should propagate.
    const timeoutErr = makeTimeoutError();
    let callCount = 0;
    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      throw callCount === 1 ? makeTimeoutError() : timeoutErr;
    });

    // Attach the catch handler IMMEDIATELY on the same tick to prevent
    // Node from ever seeing the rejection as unhandled.
    let thrown: unknown;
    const promise = callWithRetry(service, fn).catch(err => { thrown = err; });

    // Advance past the first 5s retry delay
    await vi.advanceTimersByTimeAsync(5100);
    await promise;

    expect(thrown).toBe(timeoutErr);
    // fn called: 1 original + 1 timeout retry = 2 calls total
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("AbortError (name='AbortError') is also retried exactly once", async () => {
    const abortErr = makeAbortError();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce("resolved");

    const promise = callWithRetry(service, fn);
    await vi.advanceTimersByTimeAsync(5100);

    const result = await promise;
    expect(result).toBe("resolved");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("DOMException TimeoutError is also handled as a timeout", async () => {
    const domTimeout = new DOMException("The operation timed out", "TimeoutError");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(domTimeout)
      .mockResolvedValueOnce("resolved");

    const promise = callWithRetry(service, fn);
    await vi.advanceTimersByTimeAsync(5100);

    const result = await promise;
    expect(result).toBe("resolved");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // ─── Timeout retries are tracked separately from 503 retries ─────────────────

  it("503 followed by timeout: both retry independently and resolve successfully", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeUnavailableError()) // 503 on attempt 1
      .mockRejectedValueOnce(makeTimeoutError())     // timeout on attempt 2
      .mockResolvedValueOnce("final success");       // success on attempt 3

    const promise = callWithRetry(service, fn, 6);

    // Advance well past all retry delays (503 uses 3000ms base, timeout uses 5000ms)
    await vi.advanceTimersByTimeAsync(15000);

    const result = await promise;
    expect(result).toBe("final success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("timeout then 503: both retry independently and resolve successfully", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeTimeoutError())      // timeout first
      .mockRejectedValueOnce(makeUnavailableError())  // 503 second
      .mockResolvedValueOnce("ok");

    const promise = callWithRetry(service, fn, 6);
    await vi.advanceTimersByTimeAsync(15000);

    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("503 retries do NOT consume the timeout retry budget", async () => {
    // After multiple 503 retries, one timeout should still be retried
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeUnavailableError())  // 503 — attempt 1
      .mockRejectedValueOnce(makeUnavailableError())  // 503 — attempt 2
      .mockRejectedValueOnce(makeTimeoutError())      // timeout — attempt 3
      .mockResolvedValueOnce("success");              // success — attempt 4

    const promise = callWithRetry(service, fn, 6);
    await vi.advanceTimersByTimeAsync(60000);

    const result = await promise;
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("after 1 timeout retry, a second timeout throws even if 503 retries remain", async () => {
    // 1st timeout → retried (timeoutAttempts = 1)
    // 2nd timeout → NOT retried (timeoutAttempts already = GEMINI_TIMEOUT_MAX_RETRIES = 1)
    const timeoutErr = makeTimeoutError();
    let callCount = 0;
    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw makeUnavailableError();  // 503 first — attempt 1
      if (callCount === 2) throw makeTimeoutError();      // timeout — attempt 2, retried
      throw timeoutErr;                                   // timeout — attempt 3, should throw
    });

    // Attach the catch handler IMMEDIATELY on the same tick to prevent
    // Node from ever seeing the rejection as unhandled.
    let thrown: unknown;
    const promise = callWithRetry(service, fn, 6).catch(err => { thrown = err; });
    await vi.advanceTimersByTimeAsync(60000);
    await promise;

    expect(thrown).toBe(timeoutErr);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  // ─── QuotaExceeded: must throw immediately (no retry) ─────────────────────────

  it("quota exceeded error throws immediately without any retry", async () => {
    const quotaErr = makeQuotaError();
    const fn = vi.fn().mockRejectedValue(quotaErr);

    // The quota branch re-throws a *new* Error with a custom message
    await expect(callWithRetry(service, fn)).rejects.toThrow(
      "Gemini API Daily Quota Exceeded"
    );
    // fn was called exactly once — no retry
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("quota exceeded error message contains upgrade/retry guidance", async () => {
    const fn = vi.fn().mockRejectedValue(makeQuotaError());
    try {
      await callWithRetry(service, fn);
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).toMatch(/quota/i);
    }
  });

  it("quota exceeded does not call onProgress with retry messages", async () => {
    const onProgress = vi.fn();
    const fn = vi.fn().mockRejectedValue(makeQuotaError());
    await expect(callWithRetry(service, fn, 6, onProgress)).rejects.toThrow();
    // onProgress may or may not be called, but should NOT contain "retrying"
    const retryingCalls = onProgress.mock.calls.filter(([msg]) =>
      (msg as string).toLowerCase().includes("retrying")
    );
    expect(retryingCalls).toHaveLength(0);
  });
});
