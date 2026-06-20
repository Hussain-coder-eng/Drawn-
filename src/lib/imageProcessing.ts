import { jsonrepair } from 'jsonrepair';
import type { NormalizedPoint } from './shapeMath';

const MAX_IMAGE_DIM = 896;
const JPEG_QUALITY = 0.82;
const MAX_INLINE_IMAGE_BYTES = 675_000;
const PNG_MIME_TYPE = 'image/png';
const JPEG_MIME_TYPE = 'image/jpeg';
const WEBP_MIME_TYPE = 'image/webp';
const TRANSPARENT_OR_LINE_ART_MIME_TYPES = new Set([PNG_MIME_TYPE, WEBP_MIME_TYPE]);
const NEAR_DUPLICATE_POINT_DISTANCE = 0.002;

/**
 * Compute scaled dimensions preserving aspect ratio.
 * If max(width, height) <= maxDim, returns original dimensions.
 * Otherwise scales so max(width, height) = maxDim.
 */
export function computeScaledDims(
  width: number,
  height: number,
  maxDim: number
): { width: number; height: number } {
  const max = Math.max(width, height);
  if (max <= maxDim) {
    return { width, height };
  }
  const scale = maxDim / max;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function preferredOutputMimeType(fileType: string): string {
  return TRANSPARENT_OR_LINE_ART_MIME_TYPES.has(fileType) ? fileType : JPEG_MIME_TYPE;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Downscale an image file and return base64-encoded data without the data URL prefix.
 * Preserves PNG/WebP uploads when they stay within a conservative inline payload budget.
 */
export async function downscaleImageToBase64(
  file: File,
  maxDim: number = MAX_IMAGE_DIM,
  quality: number = JPEG_QUALITY
): Promise<{ base64: string; mimeType: string }> {
  const preferredMimeType = preferredOutputMimeType(file.type);

  // Load image and get dimensions
  const bitmap = await createImageBitmap(file);
  const { width: scaledWidth, height: scaledHeight } = computeScaledDims(
    bitmap.width,
    bitmap.height,
    maxDim
  );

  // Draw onto offscreen canvas at scaled dimensions
  const canvas = new OffscreenCanvas(scaledWidth, scaledHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('OffscreenCanvas 2d context unavailable');
  }
  ctx.drawImage(bitmap, 0, 0, scaledWidth, scaledHeight);

  let mimeType = preferredMimeType;
  let blob = await canvas.convertToBlob({ type: mimeType, quality });

  if (mimeType !== JPEG_MIME_TYPE && blob.size > MAX_INLINE_IMAGE_BYTES) {
    mimeType = JPEG_MIME_TYPE;
    blob = await canvas.convertToBlob({ type: mimeType, quality });
  }

  const base64 = await blobToBase64(blob);

  return { base64, mimeType };
}

/**
 * Order and flatten multiple strokes using greedy nearest-endpoint strategy.
 * - Starts with the stroke containing the most points (silhouette).
 * - Repeatedly appends the nearest unused stroke.
 * - Reverses a stroke if its end is closer than its start to the current path end.
 */
export function orderAndFlattenStrokes(strokes: number[][][]): NormalizedPoint[] {
  if (strokes.length === 0) {
    return [];
  }

  // Track which strokes have been used
  const used = new Set<number>();

  // Start with stroke containing the most points
  let currentIndex = 0;
  let maxPoints = strokes[0].length;
  for (let i = 1; i < strokes.length; i++) {
    if (strokes[i].length > maxPoints) {
      maxPoints = strokes[i].length;
      currentIndex = i;
    }
  }

  // Initialize result with first stroke (as-is)
  const result: NormalizedPoint[] = [];
  let currentStroke = strokes[currentIndex];
  for (const [x, y] of currentStroke) {
    result.push({ x, y });
  }
  used.add(currentIndex);

  // Get current path endpoint
  let currentEnd = currentStroke[currentStroke.length - 1];

  // Greedily append nearest strokes
  while (used.size < strokes.length) {
    let bestStrokeIdx = -1;
    let bestDistance = Infinity;
    let shouldReverse = false;

    // Find nearest unused stroke
    for (let i = 0; i < strokes.length; i++) {
      if (used.has(i)) continue;

      const stroke = strokes[i];
      const strokeStart = stroke[0];
      const strokeEnd = stroke[stroke.length - 1];

      const distToStart = Math.hypot(
        currentEnd[0] - strokeStart[0],
        currentEnd[1] - strokeStart[1]
      );
      const distToEnd = Math.hypot(
        currentEnd[0] - strokeEnd[0],
        currentEnd[1] - strokeEnd[1]
      );

      const minDist = Math.min(distToStart, distToEnd);
      if (minDist < bestDistance) {
        bestDistance = minDist;
        bestStrokeIdx = i;
        shouldReverse = distToEnd < distToStart;
      }
    }

    if (bestStrokeIdx === -1) break; // Should not happen

    // Append the stroke (reversed if needed)
    const selectedStroke = strokes[bestStrokeIdx];
    if (shouldReverse) {
      for (let i = selectedStroke.length - 1; i >= 0; i--) {
        const [x, y] = selectedStroke[i];
        result.push({ x, y });
      }
      currentEnd = selectedStroke[0];
    } else {
      for (const [x, y] of selectedStroke) {
        result.push({ x, y });
      }
      currentEnd = selectedStroke[selectedStroke.length - 1];
    }

    used.add(bestStrokeIdx);
  }

  return result;
}

function extractJsonPayload(rawText: string): string {
  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return rawText.slice(firstBrace, lastBrace + 1);
  }

  return rawText;
}

function toFiniteClampedPoint(point: unknown): number[] | null {
  let rawX: unknown;
  let rawY: unknown;

  if (Array.isArray(point) && point.length >= 2) {
    [rawX, rawY] = point;
  } else if (point && typeof point === 'object') {
    const candidate = point as { x?: unknown; y?: unknown };
    rawX = candidate.x;
    rawY = candidate.y;
  }

  if (typeof rawX !== 'number' || typeof rawY !== 'number') {
    return null;
  }
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
    return null;
  }

  return [
    Math.max(0, Math.min(1, rawX)),
    Math.max(0, Math.min(1, rawY)),
  ];
}

function isNearDuplicatePoint(a: number[], b: number[]): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= NEAR_DUPLICATE_POINT_DISTANCE;
}

/**
 * Parse Gemini vision response JSON and return flattened, clamped strokes.
 * - Repairs malformed JSON using jsonrepair.
 * - Accepts markdown fences or short prose around the JSON object.
 * - Accepts [x,y] arrays and {x,y} objects.
 * - Clamps x,y to [0,1].
 * - Drops near-duplicate consecutive points.
 * - Drops degenerate strokes (<2 points).
 * - Orders and flattens remaining strokes.
 * - Throws Error if no usable strokes remain.
 */
export function parseVisionStrokes(rawText: string): NormalizedPoint[] {
  // Repair and parse JSON
  let parsed: { strokes?: unknown };
  try {
    const repaired = jsonrepair(extractJsonPayload(rawText));
    parsed = JSON.parse(repaired);
  } catch (err) {
    throw new Error(`Failed to parse vision response: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!parsed.strokes || !Array.isArray(parsed.strokes)) {
    throw new Error('Vision response missing "strokes" array');
  }

  // Filter and clamp strokes
  const validStrokes: number[][][] = [];
  for (const stroke of parsed.strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2) {
      continue; // Skip degenerate strokes
    }

    const clampedStroke: number[][] = [];
    for (const point of stroke) {
      const clampedPoint = toFiniteClampedPoint(point);
      if (clampedPoint) {
        const previousPoint = clampedStroke[clampedStroke.length - 1];
        if (!previousPoint || !isNearDuplicatePoint(previousPoint, clampedPoint)) {
          clampedStroke.push(clampedPoint);
        }
      }
    }

    if (clampedStroke.length >= 2) {
      validStrokes.push(clampedStroke);
    }
  }

  if (validStrokes.length === 0) {
    throw new Error('No usable strokes found in vision response');
  }

  return orderAndFlattenStrokes(validStrokes);
}
