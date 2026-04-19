import { test, expect } from '@playwright/test';
import { drawPath } from './helpers/draw';

/**
 * Tests for draw mode multi-stroke accumulation.
 *
 * BUG: DrawingCanvas.startDrawing calls setPoints([new start point]),
 * which resets the accumulated points on every new stroke. Only the
 * last stroke's points are ever passed to onShapeComplete.
 *
 * These tests verify:
 * 1. The accumulated point count grows after each additional stroke (not replaced).
 * 2. Clearing the canvas resets the "Shape Captured" indicator.
 *
 * Layout note: on Desktop Chrome (1280×720) the app renders a sidebar (no BottomSheet).
 * The BottomSheet is rendered but hidden via `md:hidden`. Both render the same
 * `panelContent`, so data-testid selectors resolve to 2 elements — we always
 * use .first() which resolves to the visible sidebar element.
 *
 * The DesignInput renders `data-point-count` on the "Shape Captured" span, which
 * lets us assert the combined path length grows across strokes.
 */

test.describe('Draw mode — multi-stroke accumulation', () => {
  // The visible (sidebar) drawing canvas is always the first match on desktop
  const CANVAS_SELECTOR = ':nth-match([data-testid="drawing-canvas"], 1)';

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        test.info().annotations.push({ type: 'console-error', description: msg.text() });
      }
    });
    await page.goto('/');

    // Dismiss auth screen by continuing as guest (if present)
    const guestBtn = page.locator('[data-testid="guest-btn"]');
    if (await guestBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await guestBtn.click();
      await page.locator('[data-testid="auth-screen"]').waitFor({ state: 'hidden', timeout: 10000 });
    }

    // Switch to draw mode. .first() targets the sidebar element (desktop viewport);
    // the hidden BottomSheet duplicate is second.
    await page.locator('[data-testid="mode-draw"]').first().click();

    // Wait for the drawing canvas to appear
    await page.locator('[data-testid="drawing-canvas"]').first().waitFor({ state: 'visible' });
  });

  test('point count accumulates across strokes — second stroke adds to first', async ({ page }) => {
    // First stroke: horizontal line across the top third of the canvas (15 points)
    await drawPath(page, [
      { x: 0.05, y: 0.2 }, { x: 0.10, y: 0.2 }, { x: 0.15, y: 0.2 },
      { x: 0.20, y: 0.2 }, { x: 0.25, y: 0.2 }, { x: 0.30, y: 0.2 },
      { x: 0.35, y: 0.2 }, { x: 0.40, y: 0.2 }, { x: 0.45, y: 0.2 },
      { x: 0.50, y: 0.2 }, { x: 0.55, y: 0.2 }, { x: 0.60, y: 0.2 },
      { x: 0.65, y: 0.2 }, { x: 0.70, y: 0.2 }, { x: 0.75, y: 0.2 },
    ], CANVAS_SELECTOR);

    // "Shape Captured" should now be visible
    const capturedSpan = page.locator('[data-point-count]').first();
    await expect(
      capturedSpan,
      'Shape Captured should appear after the first stroke'
    ).toBeVisible();

    // Record the point count after stroke 1
    const countAfterStroke1 = parseInt(
      await capturedSpan.getAttribute('data-point-count') ?? '0',
      10
    );
    expect(countAfterStroke1, 'First stroke should produce at least 1 point').toBeGreaterThan(0);

    // Second stroke: horizontal line across the bottom third of the canvas (15 points)
    await drawPath(page, [
      { x: 0.05, y: 0.75 }, { x: 0.10, y: 0.75 }, { x: 0.15, y: 0.75 },
      { x: 0.20, y: 0.75 }, { x: 0.25, y: 0.75 }, { x: 0.30, y: 0.75 },
      { x: 0.35, y: 0.75 }, { x: 0.40, y: 0.75 }, { x: 0.45, y: 0.75 },
      { x: 0.50, y: 0.75 }, { x: 0.55, y: 0.75 }, { x: 0.60, y: 0.75 },
      { x: 0.65, y: 0.75 }, { x: 0.70, y: 0.75 }, { x: 0.75, y: 0.75 },
    ], CANVAS_SELECTOR);

    // Shape Captured should still be visible
    await expect(
      capturedSpan,
      'Shape Captured should still be visible after the second stroke'
    ).toBeVisible();

    // BUG: currently startDrawing resets points to just the new start point,
    // so onShapeComplete is called with only the second stroke's points.
    // The point count after stroke 2 therefore equals ~the second stroke's
    // point count, NOT countAfterStroke1 + second-stroke-count.
    //
    // After the fix, the combined path is passed to onShapeComplete on each
    // stroke completion, so countAfterStroke2 > countAfterStroke1.
    const countAfterStroke2 = parseInt(
      await capturedSpan.getAttribute('data-point-count') ?? '0',
      10
    );
    expect(
      countAfterStroke2,
      `Point count after stroke 2 (${countAfterStroke2}) should be greater than after stroke 1 (${countAfterStroke1})`
    ).toBeGreaterThan(countAfterStroke1);
  });

  test('clear resets all accumulated strokes', async ({ page }) => {
    // Draw a single stroke (15 points for a comfortable margin over the >10 threshold)
    await drawPath(page, [
      { x: 0.05, y: 0.5 }, { x: 0.10, y: 0.5 }, { x: 0.15, y: 0.5 },
      { x: 0.20, y: 0.5 }, { x: 0.25, y: 0.5 }, { x: 0.30, y: 0.5 },
      { x: 0.35, y: 0.5 }, { x: 0.40, y: 0.5 }, { x: 0.45, y: 0.5 },
      { x: 0.50, y: 0.5 }, { x: 0.55, y: 0.5 }, { x: 0.60, y: 0.5 },
      { x: 0.65, y: 0.5 }, { x: 0.70, y: 0.5 }, { x: 0.75, y: 0.5 },
    ], CANVAS_SELECTOR);

    // Confirm shape is captured
    await expect(page.locator('text=Shape Captured').first()).toBeVisible();

    // BUG: DrawingCanvas.clear() resets local `points` state but never calls
    // onShapeComplete, so the parent's `drawnPath` is stale and "Shape Captured"
    // remains visible. After the fix, clear() notifies the parent with an empty
    // path, hiding the indicator.
    await page.getByRole('button', { name: /clear/i }).first().click();

    await expect(
      page.locator('text=Shape Captured').first(),
      'Shape Captured should disappear after clearing'
    ).not.toBeVisible();
  });
});
