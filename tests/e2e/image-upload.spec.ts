import { expect, test } from '@playwright/test';
import path from 'node:path';

const FIXTURE_IMAGE = path.join(import.meta.dirname, 'fixtures', 'image-outline.svg');

const OUTLINE_POINTS = [
  { x: 0.2, y: 0.8 },
  { x: 0.5, y: 0.2 },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
];

test.describe('Image upload mode', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        test.info().annotations.push({ type: 'console-error', description: msg.text() });
      }
    });

    await page.addInitScript(({ outlinePoints }) => {
      window.__DRAWN_TEST_USER__ = {
        uid: 'e2e-image-upload-user',
        displayName: 'E2E Image Upload',
        email: 'image-upload@example.test',
        photoURL: null,
      };
      window.__DRAWN_TEST_HOOKS__ = {
        imageTraceMode: 'success',
        imageToOutline: async (_file, onProgress) => {
          onProgress?.('Tracing image outline...');
          await new Promise((resolve) => window.setTimeout(resolve, 250));

          if (window.__DRAWN_TEST_HOOKS__?.imageTraceMode === 'failure') {
            throw new Error('Mock trace failed');
          }

          return outlinePoints;
        },
      };
    }, { outlinePoints: OUTLINE_POINTS });

    await page.goto('/');
    await expect(page.locator('[data-testid="auth-screen"]')).toBeHidden();
  });

  test('uploads an image and shows preview, progress, and captured outline state', async ({ page }) => {
    await page.locator('[data-testid="mode-image"]').first().click();

    await expect(page.locator('[data-testid="image-upload-button"]').first()).toBeVisible();
    await page.locator('[data-testid="image-file-input"]').first().setInputFiles(FIXTURE_IMAGE);

    await expect(page.locator('[data-testid="image-preview"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="image-progress"]').first()).toContainText('Tracing image outline');

    const success = page.locator('[data-testid="image-outline-success"]').first();
    await expect(success).toBeVisible();
    await expect(success).toContainText('Outline Captured');
    await expect(success).toHaveAttribute('data-outline-point-count', String(OUTLINE_POINTS.length));
    await expect(page.locator('[data-testid="image-progress"]').first()).not.toBeVisible();
  });

  test('shows a clean error state when tracing fails', async ({ page }) => {
    await page.evaluate(() => {
      window.__DRAWN_TEST_HOOKS__!.imageTraceMode = 'failure';
    });
    await page.locator('[data-testid="mode-image"]').first().click();

    await page.locator('[data-testid="image-file-input"]').first().setInputFiles(FIXTURE_IMAGE);

    const error = page.locator('[data-testid="image-error"]').first();
    await expect(error).toBeVisible();
    await expect(error).toContainText('Mock trace failed');
    await expect(page.locator('[data-testid="image-error-clear"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="image-outline-success"]').first()).not.toBeVisible();
    await expect(page.locator('[data-testid="image-progress"]').first()).not.toBeVisible();
  });

  test('replacing and clearing a failed upload removes stale outline state', async ({ page }) => {
    await page.locator('[data-testid="mode-image"]').first().click();

    await page.locator('[data-testid="image-file-input"]').first().setInputFiles(FIXTURE_IMAGE);
    const success = page.locator('[data-testid="image-outline-success"]').first();
    await expect(success).toBeVisible();
    await expect(success).toHaveAttribute('data-outline-point-count', String(OUTLINE_POINTS.length));

    await page.evaluate(() => {
      window.__DRAWN_TEST_HOOKS__!.imageTraceMode = 'failure';
    });
    await page.locator('[data-testid="image-file-input"]').first().setInputFiles(FIXTURE_IMAGE);

    await expect(page.locator('[data-testid="image-error"]').first()).toContainText('Mock trace failed');
    await expect(page.locator('[data-testid="image-outline-success"]')).toHaveCount(0);

    await page.locator('[data-testid="image-error-clear"]').first().click();

    await expect(page.locator('[data-testid="image-error"]').first()).not.toBeVisible();
    await expect(page.locator('[data-testid="image-preview"]').first()).not.toBeVisible();
    await expect(page.locator('[data-testid="image-outline-success"]')).toHaveCount(0);

    await page.evaluate(() => {
      window.__DRAWN_TEST_HOOKS__!.imageTraceMode = 'success';
    });
    await page.locator('[data-testid="image-file-input"]').first().setInputFiles(FIXTURE_IMAGE);

    await expect(page.locator('[data-testid="image-preview"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="image-outline-success"]').first()).toHaveAttribute(
      'data-outline-point-count',
      String(OUTLINE_POINTS.length),
    );
    await expect(page.locator('[data-testid="image-error"]').first()).not.toBeVisible();
  });
});
