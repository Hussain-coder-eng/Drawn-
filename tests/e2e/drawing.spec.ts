import { test, expect } from '@playwright/test';
import { drawPath } from './helpers/draw';
import loopCoords from './fixtures/drawing-loop.json' with { type: 'json' };
import letterCoords from './fixtures/drawing-letter.json' with { type: 'json' };
import polygonCoords from './fixtures/drawing-polygon.json' with { type: 'json' };
import complexCoords from './fixtures/drawing-complex.json' with { type: 'json' };

const TARGET_KM = 5;

const DRAWING_CASES = [
  { label: 'loop',    coords: loopCoords    as { x: number; y: number }[] },
  { label: 'letter',  coords: letterCoords  as { x: number; y: number }[] },
  { label: 'polygon', coords: polygonCoords as { x: number; y: number }[] },
  { label: 'complex', coords: complexCoords as { x: number; y: number }[] },
];

test.beforeEach(async ({ page }) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      test.info().annotations.push({ type: 'console-error', description: msg.text() });
    }
  });
  await page.goto('/');
});

for (const { label, coords } of DRAWING_CASES) {
  test(`drawing mode — ${label}`, async ({ page }) => {
    // 1. Switch to draw mode
    await page.locator('[data-testid="mode-draw"]').click();

    // 2. Wait for canvas to be ready
    await page.locator('[data-testid="drawing-canvas"]').waitFor({ state: 'visible' });

    // 3. Replay the recorded drawing path on the canvas
    await drawPath(page, coords);

    // 4. Wait briefly for the app to process the drawn path
    await page.waitForTimeout(500);

    // 5. Set distance to 5km
    await page.locator('[data-testid="distance-input"]').evaluate((el: HTMLInputElement) => {
      el.value = '5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // 6. Set unit to km
    await page.locator('button:has-text("km")').click();

    // 7. Set location to London
    await page.locator('[data-testid="location-input"]').fill('London, UK');
    const suggestionButton = page.locator('button:has-text("London")').first();
    await suggestionButton.waitFor({ timeout: 8000 }).catch(() => {});
    const isVisible = await suggestionButton.isVisible().catch(() => false);
    if (isVisible) {
      await suggestionButton.click();
    }

    // 8. Generate
    await page.locator('[data-testid="generate-btn"]').click();

    // 9. Wait for route (60s — real API calls)
    await expect(page.locator('[data-testid="route-polyline"]')).toBeAttached({ timeout: 60_000 });

    // 10. Assert fitness score ≥ 50
    const scoreText = await page.locator('[data-testid="fitness-score"]').textContent({ timeout: 5000 });
    const score = parseFloat(scoreText?.replace(/[^0-9.]/g, '') ?? '0');
    expect(score, `Fitness for drawing "${label}" was ${score}, expected ≥ 50`).toBeGreaterThanOrEqual(50);

    // 11. Assert distance within 30% of 5km
    const distText = await page.locator('[data-testid="route-distance"]').textContent({ timeout: 5000 });
    const actualKm = parseFloat(distText?.replace(/[^0-9.]/g, '') ?? '0');
    expect(actualKm, `Distance ${actualKm}km not within 30% of ${TARGET_KM}km`).toBeGreaterThanOrEqual(TARGET_KM * 0.7);
    expect(actualKm, `Distance ${actualKm}km not within 30% of ${TARGET_KM}km`).toBeLessThanOrEqual(TARGET_KM * 1.3);
  });
}
