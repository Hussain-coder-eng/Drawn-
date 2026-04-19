import { describe, it, expect } from "vitest";
import { GeminiService } from "../../src/services/geminiService";

// Access private static method via type cast for unit testing
const isNetworkError = (err: unknown): boolean =>
  (GeminiService as any).isNetworkError(err);

const isAbortLikeError = (err: unknown): boolean =>
  (GeminiService as any).isAbortLikeError(err);

describe("GeminiService.isNetworkError", () => {
  it("detects Chrome/Firefox TypeError: Failed to fetch", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("detects lowercase variant", () => {
    expect(isNetworkError(new Error("failed to fetch"))).toBe(true);
  });

  it("detects Firefox NetworkError by name", () => {
    const err = Object.assign(new Error("A network error occurred"), { name: "NetworkError" });
    expect(isNetworkError(err)).toBe(true);
  });

  it("detects 'network error' in message", () => {
    expect(isNetworkError(new Error("network error"))).toBe(true);
  });

  it("detects ERR_NETWORK in message", () => {
    expect(isNetworkError(new Error("ERR_NETWORK"))).toBe(true);
  });

  it("detects Safari load failed", () => {
    const err = Object.assign(new TypeError("Load failed"), { name: "TypeError" });
    expect(isNetworkError(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isNetworkError(new Error("Something went wrong"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isNetworkError(null)).toBe(false);
  });

  it("returns false for non-object primitives", () => {
    expect(isNetworkError("string error")).toBe(false);
    expect(isNetworkError(42)).toBe(false);
  });

  it("does NOT classify AbortError as a network error", () => {
    const abort = new DOMException("signal is aborted", "AbortError");
    expect(isNetworkError(abort)).toBe(false);
    // And confirm it IS classified as abort-like
    expect(isAbortLikeError(abort)).toBe(true);
  });

  it("does NOT classify TimeoutError as a network error", () => {
    const timeout = new DOMException("The operation timed out", "TimeoutError");
    expect(isNetworkError(timeout)).toBe(false);
    expect(isAbortLikeError(timeout)).toBe(true);
  });

  it("does NOT classify quota/rate-limit errors as network errors", () => {
    expect(isNetworkError(new Error("429 Too Many Requests"))).toBe(false);
    expect(isNetworkError(new Error("RESOURCE_EXHAUSTED"))).toBe(false);
  });
});
