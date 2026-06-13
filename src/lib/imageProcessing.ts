import { jsonrepair } from 'jsonrepair';
import type { NormalizedPoint } from './shapeMath';

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
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Downscale an image file to JPEG and return base64-encoded data.
 * Strips the "data:image/jpeg;base64," prefix.
 */
export async function downscaleImageToBase64(
  file: File,
  maxDim: number = 768,
  quality: number = 0.72
): Promise<{ base64: string; mimeType: string }> {
  const mimeType = 'image/jpeg';

  // Load image and get dimensions
  const bitmap = await createImageBitmap(file);
  const { width: scaledWidth, height: scaledHeight } = computeScaledDims(
    bitmap.width,
    bitmap.height,
    maxDim
  );

  // Draw onto offscreen canvas at scaled dimensions
  const canvas = new OffscreenCanvas(scaledWidth, scaledHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, scaledWidth, scaledHeight);

  // Export to JPEG and convert to base64
  const blob = await canvas.convertToBlob({ type: mimeType, quality });
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const binary = String.fromCharCode(...uint8Array);
  const base64 = btoa(binary);

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

/**
 * Parse Gemini vision response JSON and return flattened, clamped strokes.
 * - Repairs malformed JSON using jsonrepair.
 * - Clamps x,y to [0,1].
 * - Drops degenerate strokes (<2 points).
 * - Orders and flattens remaining strokes.
 * - Throws Error if no usable strokes remain.
 */
export function parseVisionStrokes(rawText: string): NormalizedPoint[] {
  // Repair and parse JSON
  let parsed: { strokes?: number[][][] };
  try {
    const repaired = jsonrepair(rawText);
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
      if (Array.isArray(point) && point.length >= 2) {
        const x = Math.max(0, Math.min(1, point[0]));
        const y = Math.max(0, Math.min(1, point[1]));
        clampedStroke.push([x, y]);
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
