import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeScaledDims,
  downscaleImageToBase64,
  orderAndFlattenStrokes,
  parseVisionStrokes,
} from '../../src/lib/imageProcessing';
import type { NormalizedPoint } from '../../src/lib/shapeMath';

const TEST_IMAGE_BUDGET_BYTES = 675_000;
const MOCK_IMAGE_WIDTH = 2_000;
const MOCK_IMAGE_HEIGHT = 1_000;

type BlobRequest = { type?: string; quality?: number };

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(blob: Blob): void {
    this.result = `data:${blob.type};base64,mock-${blob.size}`;
    this.onload?.();
  }
}

function createSizedBlob(size: number, type: string): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

describe('imageProcessing', () => {
  describe('computeScaledDims', () => {
    it('scales down width when width > maxDim', () => {
      const result = computeScaledDims(1000, 500, 768);
      expect(result.width).toBe(768);
      expect(result.height).toBe(384);
    });

    it('scales down height when height > maxDim', () => {
      const result = computeScaledDims(500, 1000, 768);
      expect(result.width).toBe(384);
      expect(result.height).toBe(768);
    });

    it('does not scale when both dimensions fit within maxDim', () => {
      const result = computeScaledDims(400, 300, 768);
      expect(result.width).toBe(400);
      expect(result.height).toBe(300);
    });

    it('handles square images', () => {
      const result = computeScaledDims(1024, 1024, 768);
      expect(result.width).toBe(768);
      expect(result.height).toBe(768);
    });

    it('preserves aspect ratio exactly', () => {
      const result = computeScaledDims(800, 600, 768);
      expect(result.width / result.height).toBeCloseTo(800 / 600, 2);
    });

    it('handles edge case: maxDim = 1', () => {
      const result = computeScaledDims(100, 200, 1);
      expect(result.width).toBe(1);
      expect(result.height).toBeLessThanOrEqual(2);
    });

    it('clamps to minimum 1 for extreme aspect ratios', () => {
      const result = computeScaledDims(10, 20000, 768);
      expect(result.width).toBeGreaterThanOrEqual(1);
      expect(result.height).toBe(768);
    });
  });

  describe('orderAndFlattenStrokes', () => {
    it('returns empty array for empty input', () => {
      const result = orderAndFlattenStrokes([]);
      expect(result).toEqual([]);
    });

    it('flattens single stroke to NormalizedPoint[]', () => {
      const strokes = [[[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]];
      const result = orderAndFlattenStrokes(strokes);
      expect(result).toEqual([
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.4 },
        { x: 0.5, y: 0.6 },
      ]);
    });

    it('starts with stroke containing most points (silhouette)', () => {
      const strokes = [
        [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]], // 3 points
        [[0.9, 0.9], [0.95, 0.95]], // 2 points - this is smaller
      ];
      const result = orderAndFlattenStrokes(strokes);
      // Should start with the first stroke (3 points)
      expect(result[0]).toEqual({ x: 0.1, y: 0.1 });
      expect(result[1]).toEqual({ x: 0.2, y: 0.2 });
      expect(result[2]).toEqual({ x: 0.3, y: 0.3 });
    });

    it('appends nearest stroke by endpoint distance', () => {
      const strokes = [
        [[0.0, 0.0], [0.5, 0.5]], // 2 points
        [[0.51, 0.51], [1.0, 1.0]], // 2 points, start close to end of first
      ];
      const result = orderAndFlattenStrokes(strokes);
      // Should append second stroke as-is (start is closer than end)
      expect(result.length).toBe(4);
      expect(result[2]).toEqual({ x: 0.51, y: 0.51 });
      expect(result[3]).toEqual({ x: 1.0, y: 1.0 });
    });

    it('reverses stroke if its end is closer than start', () => {
      const strokes = [
        [[0.0, 0.0], [0.5, 0.5]], // 2 points, ends at (0.5, 0.5)
        [[1.0, 1.0], [0.51, 0.51]], // 2 points, end (0.51, 0.51) is closer to (0.5, 0.5)
      ];
      const result = orderAndFlattenStrokes(strokes);
      // Should append second stroke reversed
      expect(result.length).toBe(4);
      expect(result[2]).toEqual({ x: 0.51, y: 0.51 }); // reversed start
      expect(result[3]).toEqual({ x: 1.0, y: 1.0 }); // reversed end
    });

    it('orders multiple strokes by nearest endpoint minimization', () => {
      const strokes = [
        [[0.0, 0.0], [0.1, 0.1]], // silhouette (2 points)
        [[0.9, 0.9], [0.95, 0.95]], // far away
        [[0.12, 0.12], [0.2, 0.2]], // close to (0.1, 0.1)
      ];
      const result = orderAndFlattenStrokes(strokes);
      expect(result.length).toBe(6);
      // First 2 points from first stroke
      expect(result[0]).toEqual({ x: 0.0, y: 0.0 });
      expect(result[1]).toEqual({ x: 0.1, y: 0.1 });
      // Next should be stroke 3 (closest to end of stroke 1)
      expect(result[2]).toEqual({ x: 0.12, y: 0.12 });
      expect(result[3]).toEqual({ x: 0.2, y: 0.2 });
    });
  });

  describe('parseVisionStrokes', () => {
    it('parses valid JSON with strokes', () => {
      const input = '{"strokes": [[[0.1, 0.2], [0.3, 0.4]], [[0.5, 0.6], [0.7, 0.8]]]}';
      const result = parseVisionStrokes(input);
      expect(result.length).toBe(4);
      expect(result[0]).toEqual({ x: 0.1, y: 0.2 });
      expect(result[1]).toEqual({ x: 0.3, y: 0.4 });
      expect(result[2]).toEqual({ x: 0.5, y: 0.6 });
      expect(result[3]).toEqual({ x: 0.7, y: 0.8 });
    });

    it('clamps x,y values to [0,1]', () => {
      const input = '{"strokes": [[[1.5, -0.5], [0.5, 0.5]]]}';
      const result = parseVisionStrokes(input);
      expect(result[0]).toEqual({ x: 1, y: 0 });
      expect(result[1]).toEqual({ x: 0.5, y: 0.5 });
    });

    it('drops degenerate strokes with < 2 points', () => {
      const input = '{"strokes": [[[0.1, 0.2]], [[0.3, 0.4], [0.5, 0.6]]]}';
      const result = parseVisionStrokes(input);
      expect(result.length).toBe(2);
      expect(result[0]).toEqual({ x: 0.3, y: 0.4 });
      expect(result[1]).toEqual({ x: 0.5, y: 0.6 });
    });

    it('repairs malformed JSON and parses it', () => {
      // Missing closing bracket
      const input = '{"strokes": [[[0.1, 0.2], [0.3, 0.4]]}';
      const result = parseVisionStrokes(input);
      expect(result.length).toBe(2);
      expect(result[0]).toEqual({ x: 0.1, y: 0.2 });
    });

    it('parses markdown-fenced JSON responses', () => {
      const input = '```json\n{"strokes": [[[0.1, 0.2], [0.3, 0.4]]]}\n```';
      const result = parseVisionStrokes(input);
      expect(result).toEqual([
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.4 },
      ]);
    });

    it('parses short prose around a JSON object', () => {
      const input = 'Here is the trace:\n{"strokes": [[[0.2, 0.3], [0.4, 0.5]]]}\nHope this helps.';
      const result = parseVisionStrokes(input);
      expect(result).toEqual([
        { x: 0.2, y: 0.3 },
        { x: 0.4, y: 0.5 },
      ]);
    });

    it('accepts object points with x and y coordinates', () => {
      const input = '{"strokes": [[{"x": 0.15, "y": 0.25}, {"x": 0.35, "y": 0.45}]]}';
      const result = parseVisionStrokes(input);
      expect(result).toEqual([
        { x: 0.15, y: 0.25 },
        { x: 0.35, y: 0.45 },
      ]);
    });

    it('drops near-duplicate consecutive points after clamping', () => {
      const input = '{"strokes": [[[0.1, 0.1], [0.101, 0.101], [0.2, 0.2], [0.2, 0.2], [0.4, 0.4]]]}';
      const result = parseVisionStrokes(input);
      expect(result).toEqual([
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.4 },
      ]);
    });

    it('throws error when no usable strokes remain', () => {
      const input = '{"strokes": []}';
      expect(() => parseVisionStrokes(input)).toThrow(/no usable strokes/i);
    });

    it('throws error when all strokes are degenerate', () => {
      const input = '{"strokes": [[[0.1, 0.2]]]}';
      expect(() => parseVisionStrokes(input)).toThrow(/no usable strokes/i);
    });

    it('handles strokes with extra fields (real Gemini response)', () => {
      const input = '{"strokes": [[[0.2, 0.3], [0.4, 0.5]]], "confidence": 0.95}';
      const result = parseVisionStrokes(input);
      expect(result.length).toBe(2);
      expect(result[0]).toEqual({ x: 0.2, y: 0.3 });
    });

    it('throws when "strokes" key is missing', () => {
      const input = '{"data": []}';
      expect(() => parseVisionStrokes(input)).toThrow(/missing "strokes" array/i);
    });

    it('throws when "strokes" is not an array', () => {
      const input = '{"strokes": "bad"}';
      expect(() => parseVisionStrokes(input)).toThrow(/missing "strokes" array/i);
    });

    it('drops points with non-finite coordinates and keeps finite points', () => {
      // 3-point stroke: first point has NaN x — should be dropped, leaving 2 finite points
      const stroke1 = [['abc', 0.2], [0.3, 0.4], [0.5, 0.6]];
      const input = JSON.stringify({ strokes: [stroke1] });
      const result = parseVisionStrokes(input);
      // Only the two finite points survive
      expect(result.length).toBe(2);
      expect(result[0]).toEqual({ x: 0.3, y: 0.4 });
      expect(result[1]).toEqual({ x: 0.5, y: 0.6 });
    });

    it('drops stroke entirely when non-finite coords reduce it below 2 points', () => {
      // 2-point stroke where one coord is NaN — drops to <2 points, stroke removed
      const badStroke = [[NaN, 0.2], [0.3, 0.4]];
      const goodStroke = [[0.1, 0.1], [0.9, 0.9]];
      const input = JSON.stringify({ strokes: [badStroke, goodStroke] });
      const result = parseVisionStrokes(input);
      // Only points from the good stroke survive
      expect(result.length).toBe(2);
      expect(result[0]).toEqual({ x: 0.1, y: 0.1 });
      expect(result[1]).toEqual({ x: 0.9, y: 0.9 });
    });
  });

  describe('downscaleImageToBase64', () => {
    let convertResponses: number[];
    let convertRequests: BlobRequest[];
    let canvasSizes: Array<{ width: number; height: number }>;

    beforeEach(() => {
      convertResponses = [];
      convertRequests = [];
      canvasSizes = [];

      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
        width: MOCK_IMAGE_WIDTH,
        height: MOCK_IMAGE_HEIGHT,
      }));

      class MockOffscreenCanvas {
        width: number;
        height: number;

        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
          canvasSizes.push({ width, height });
        }

        getContext(): { drawImage: () => void } {
          return { drawImage: vi.fn() };
        }

        async convertToBlob(request: BlobRequest): Promise<Blob> {
          convertRequests.push(request);
          const size = convertResponses.shift();
          if (size === undefined) {
            throw new Error('Unexpected convertToBlob call');
          }
          return createSizedBlob(size, request.type ?? 'image/png');
        }
      }

      vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
      vi.stubGlobal('FileReader', MockFileReader);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('recompresses and downscales JPEG output until it fits the inline byte budget', async () => {
      convertResponses = [
        TEST_IMAGE_BUDGET_BYTES + 100_000,
        TEST_IMAGE_BUDGET_BYTES + 50_000,
        TEST_IMAGE_BUDGET_BYTES - 1,
      ];

      const result = await downscaleImageToBase64(
        new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' })
      );

      expect(result).toEqual({
        base64: `mock-${TEST_IMAGE_BUDGET_BYTES - 1}`,
        mimeType: 'image/jpeg',
      });
      expect(convertRequests).toEqual([
        { type: 'image/jpeg', quality: 0.82 },
        { type: 'image/jpeg', quality: expect.any(Number) },
        { type: 'image/jpeg', quality: 0.82 },
      ]);
      expect(convertRequests[1].quality).toBeLessThan(0.82);
      expect(canvasSizes).toEqual([
        { width: 896, height: 448 },
        { width: 896, height: 448 },
        { width: 717, height: 359 },
      ]);
    });

    it('falls back from oversized PNG to JPEG and enforces the final byte budget', async () => {
      convertResponses = [
        TEST_IMAGE_BUDGET_BYTES + 250_000,
        TEST_IMAGE_BUDGET_BYTES + 75_000,
        TEST_IMAGE_BUDGET_BYTES - 10,
      ];

      const result = await downscaleImageToBase64(
        new File(['png'], 'drawing.png', { type: 'image/png' })
      );

      expect(result).toEqual({
        base64: `mock-${TEST_IMAGE_BUDGET_BYTES - 10}`,
        mimeType: 'image/jpeg',
      });
      expect(convertRequests.map(({ type }) => type)).toEqual([
        'image/png',
        'image/jpeg',
        'image/jpeg',
      ]);
      expect(canvasSizes[0]).toEqual({ width: 896, height: 448 });
      expect(canvasSizes.at(-1)).toEqual({ width: 896, height: 448 });
    });
  });
});
