import { Page } from '@playwright/test';

/**
 * Simulates a freehand drawing gesture on the canvas.
 * Coordinates are normalized (0.0–1.0 range) relative to the canvas element.
 * The helper translates them to absolute page coordinates using the canvas bounding box.
 */
export async function drawPath(
  page: Page,
  coordinates: { x: number; y: number }[],
  canvasSelector = '[data-testid="drawing-canvas"]'
): Promise<void> {
  if (coordinates.length < 2) throw new Error('drawPath requires at least 2 coordinates');

  const canvas = page.locator(canvasSelector);
  const box = await canvas.boundingBox();
  if (!box) throw new Error(`Canvas element not found: ${canvasSelector}`);

  const toAbs = (coord: { x: number; y: number }) => ({
    x: box.x + coord.x * box.width,
    y: box.y + coord.y * box.height,
  });

  const first = toAbs(coordinates[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();

  for (const coord of coordinates.slice(1)) {
    const abs = toAbs(coord);
    await page.mouse.move(abs.x, abs.y, { steps: 3 });
  }

  await page.mouse.up();
}
