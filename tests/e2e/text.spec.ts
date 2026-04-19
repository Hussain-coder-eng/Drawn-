import { test, expect } from '@playwright/test';

const TARGET_KM = 5;

const TEXT_CASES = [
  { label: 'single-char', input: 'A' },
  { label: 'short-word',  input: 'RUN' },
  { label: 'medium-word', input: 'LONDON' },
  { label: 'multi-word',  input: 'HELLO WORLD' },
];

test.beforeEach(async ({ page }) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      test.info().annotations.push({ type: 'console-error', description: msg.text() });
    }
  });
  await page.goto('/');
});

for (const { label, input } of TEXT_CASES) {
  test(`text mode — ${label} ("${input}")`, async ({ page }) => {
    // 1. Switch to text mode
    await page.locator('[data-testid="mode-text"]').click();

    // 2. Type the text input
    await page.locator('[data-testid="text-input"]').fill(input);

    // 3. Set distance to 5km
    await page.locator('[data-testid="distance-input"]').evaluate((el: HTMLInputElement) => {
      el.value = '5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // 4. Set unit to km
    await page.locator('button:has-text("km")').click();

    // 5. Set location to London
    await page.locator('[data-testid="location-input"]').fill('London, UK');
    const suggestionButton = page.locator('button:has-text("London")').first();
    await suggestionButton.waitFor({ timeout: 8000 }).catch(() => {});
    const isVisible = await suggestionButton.isVisible().catch(() => false);
    if (isVisible) {
      await suggestionButton.click();
    }

    // 6. Generate
    await page.locator('[data-testid="generate-btn"]').click();

    // 7. Wait for route
    await expect(page.locator('[data-testid="route-polyline"]')).toBeAttached({ timeout: 60_000 });

    // 8. Assert fitness score ≥ 50
    const scoreText = await page.locator('[data-testid="fitness-score"]').textContent({ timeout: 5000 });
    const score = parseFloat(scoreText?.replace(/[^0-9.]/g, '') ?? '0');
    expect(score, `Fitness for "${input}" was ${score}, expected ≥ 50`).toBeGreaterThanOrEqual(50);

    // 9. Assert distance within 30% of 5km
    const distText = await page.locator('[data-testid="route-distance"]').textContent({ timeout: 5000 });
    const actualKm = parseFloat(distText?.replace(/[^0-9.]/g, '') ?? '0');
    expect(actualKm, `Distance ${actualKm}km not within 30% of ${TARGET_KM}km`).toBeGreaterThanOrEqual(TARGET_KM * 0.7);
    expect(actualKm, `Distance ${actualKm}km not within 30% of ${TARGET_KM}km`).toBeLessThanOrEqual(TARGET_KM * 1.3);
  });
}
