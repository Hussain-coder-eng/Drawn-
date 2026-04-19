import { test, expect } from '@playwright/test';

/**
 * For each shape: navigate → select shape → set 5km → set London → generate → assert
 * Pass criteria: route-polyline visible, fitness ≥ 50, actual distance within 30% of 5km.
 */

const TARGET_KM = 5;
const LOCATION = 'London, UK';

const SHAPES = ['circle', 'star', 'heart', 'arrow'];

test.beforeEach(async ({ page }) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      test.info().annotations.push({ type: 'console-error', description: msg.text() });
    }
  });
  await page.goto('/');
});

for (const shape of SHAPES) {
  test(`shapes mode — ${shape}`, async ({ page }) => {
    // 1. Switch to shapes mode
    await page.locator('[data-testid="mode-shapes"]').click();

    // 2. Select the shape
    await page.locator(`[data-testid="shape-${shape}"]`).click();

    // 3. Set distance to 5km using JS (range slider)
    await page.locator('[data-testid="distance-input"]').evaluate((el: HTMLInputElement) => {
      el.value = '5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // 4. Set unit to km
    await page.locator('button:has-text("km")').click();

    // 5. Type location and pick first suggestion
    await page.locator('[data-testid="location-input"]').fill(LOCATION);
    const suggestionButton = page.locator('button:has-text("London")').first();
    await suggestionButton.waitFor({ timeout: 8000 }).catch(() => {});
    const isVisible = await suggestionButton.isVisible().catch(() => false);
    if (isVisible) {
      await suggestionButton.click();
    }

    // 6. Generate
    await page.locator('[data-testid="generate-btn"]').click();

    // 7. Wait for route to render (up to 60s for real API calls)
    await expect(page.locator('[data-testid="route-polyline"]')).toBeAttached({ timeout: 60_000 });

    // 8. Assert fitness score ≥ 50
    const scoreText = await page.locator('[data-testid="fitness-score"]').textContent({ timeout: 5000 });
    const score = parseFloat(scoreText?.replace(/[^0-9.]/g, '') ?? '0');
    expect(score, `Fitness score for ${shape} was ${score}, expected ≥ 50`).toBeGreaterThanOrEqual(50);

    // 9. Assert distance within 30% of 5km
    const distText = await page.locator('[data-testid="route-distance"]').textContent({ timeout: 5000 });
    const actualKm = parseFloat(distText?.replace(/[^0-9.]/g, '') ?? '0');
    expect(actualKm, `Distance ${actualKm}km is not within 30% of ${TARGET_KM}km`).toBeGreaterThanOrEqual(TARGET_KM * 0.7);
    expect(actualKm, `Distance ${actualKm}km is not within 30% of ${TARGET_KM}km`).toBeLessThanOrEqual(TARGET_KM * 1.3);
  });
}
