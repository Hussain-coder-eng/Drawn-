import type { DocumentReference } from "firebase/firestore";
import { onSnapshot } from "firebase/firestore";

export const DEFAULT_POLL_TIMEOUT_MS = 120_000;

export interface PollJobOpts {
  timeoutMs?: number;
  onProgress?: (msg: string) => void;
  timeoutMessage?: string;
  failedMessage?: string;
  processingMessage?: string;
}

/**
 * Polls a Firestore job document until it reaches a terminal status ("done" or "failed").
 * Resolves with the raw `result` string on "done"; rejects on "failed", snapshot error, or timeout.
 *
 * Defaults match geminiService's wording so calling `pollJobResult(jobRef, { onProgress })`
 * is byte-identical to geminiService's original inline poll.
 */
export function pollJobResult(
  jobRef: DocumentReference,
  opts?: PollJobOpts
): Promise<string> {
  const {
    timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    onProgress,
    timeoutMessage = "Route generation timed out. Please try again.",
    failedMessage = "Route generation failed.",
    processingMessage = "AI is analyzing the road network...",
  } = opts ?? {};

  return new Promise<string>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      unsubscribe();
      reject(new Error(timeoutMessage));
    }, timeoutMs);

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
          reject(new Error((data.error as string) || failedMessage));
        } else if (data.status === "processing") {
          onProgress?.(processingMessage);
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
