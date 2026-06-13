import { addDoc, collection, onSnapshot, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { downscaleImageToBase64 } from "../lib/imageProcessing";
import { parseVisionStrokes } from "../lib/imageProcessing";
import type { NormalizedPoint } from "../lib/shapeMath";

const SIZE_LIMIT = 900_000;
const TIMEOUT_MS = 120_000;
const VISION_PROMPT = "Trace the main subject as ordered strokes.";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function imageToOutline(
  file: File,
  onProgress?: (msg: string) => void
): Promise<NormalizedPoint[]> {
  // 1. Downscale
  onProgress?.("Downscaling image…");
  const { base64, mimeType } = await downscaleImageToBase64(file);

  // 2. Size guard — must fire before any Firestore write
  if (base64.length > SIZE_LIMIT) {
    throw new Error(
      `Image is too large after downscaling (${base64.length} chars). Maximum allowed is ${SIZE_LIMIT}.`
    );
  }

  // 3. Auth guard
  const user = auth.currentUser;
  if (!user) {
    throw new Error("You must be signed in to trace an image.");
  }

  // 4. Compute cacheKey (sha256 hex = 64 chars, well within the ≤500 rule)
  const cacheKey = await sha256Hex(base64);

  // 5. Write the job doc
  onProgress?.("Tracing outline…");
  const jobRef = await addDoc(collection(db, "jobs"), {
    uid: user.uid,
    status: "pending",
    type: "vision",
    imageBase64: base64,
    mimeType,
    prompt: VISION_PROMPT,
    cacheKey,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 6. Poll via onSnapshot — mirror geminiService pattern exactly
  return new Promise<NormalizedPoint[]>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      unsubscribe();
      reject(new Error("Image tracing timed out. Please try again."));
    }, TIMEOUT_MS);

    const unsubscribe = onSnapshot(
      jobRef,
      (snap) => {
        const data = snap.data();
        if (!data) return;
        if (data.status === "done") {
          clearTimeout(timeoutHandle);
          unsubscribe();
          try {
            resolve(parseVisionStrokes(data.result as string));
          } catch (err) {
            reject(err);
          }
        } else if (data.status === "failed") {
          clearTimeout(timeoutHandle);
          unsubscribe();
          reject(new Error((data.error as string) || "Image tracing failed."));
        } else if (data.status === "processing") {
          onProgress?.("AI is tracing the image…");
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
