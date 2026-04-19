# E2E API Testing — Design Spec
**Date:** 2026-04-16  
**Status:** Approved

## Overview

Add a hybrid test suite to the Drawn app that validates the full route-generation pipeline for all three input modes (shapes, text, freehand drawing) against real Overpass and Gemini APIs.

A test **passes** when:
1. No uncaught errors in the pipeline
2. Route renders on the map
3. Fitness score ≥ 50
4. Route distance within 30% of target distance

---

## Architecture

Two parallel test layers:

```
tests/
├── e2e/                          # Playwright — full pipeline, real APIs
│   ├── shapes.spec.ts            # Pre-made shapes (circle, star, heart, arrow)
│   ├── text.spec.ts              # Text: single char, short word, long phrase, multi-word
│   ├── drawing.spec.ts           # Freehand drawing — replays recorded coordinate fixtures
│   ├── fixtures/
│   │   ├── drawing-loop.json     # Rough loop path coordinates
│   │   ├── drawing-letter.json   # Letter-like freehand path
│   │   ├── drawing-polygon.json  # Irregular polygon path
│   │   └── drawing-complex.json  # Multi-stroke complex figure
│   └── helpers/
│       └── draw.ts               # drawPath() helper for canvas mouse simulation
└── unit/                         # Vitest — pure logic, no network
    ├── shapeMath.test.ts
    ├── optimizationService.test.ts
    └── fitnessService.test.ts
```

---

## Section 1: Playwright E2E Tests

### Setup
- `playwright.config.ts` at project root
- `webServer` config auto-starts Vite dev server before test run — no manual `npm run dev` needed
- API keys read from `.env` (same `GEMINI_API_KEY` and `VITE_OPENROUTESERVICE_API_KEY` used by the app)
- Timeout: 60s per test (Overpass mirror failover has 12s internal timeout; full pipeline stays under 45s in happy path)

### Test Pattern (all specs)

```typescript
// Common flow for every E2E test
await page.goto('http://localhost:3000');
// Configure input (shape/text/drawing)
await page.click('[data-testid="generate-btn"]');
await expect(page.locator('[data-testid="route-polyline"]')).toBeVisible({ timeout: 60000 });
const score = parseFloat(await page.locator('[data-testid="fitness-score"]').textContent());
expect(score).toBeGreaterThanOrEqual(50);
// Assert distance within 30% of target
```

Console errors are captured via `page.on('console')` and attached as test annotations — Overpass mirror failures and Gemini parse errors surface as named failure reasons, not generic crashes.

### shapes.spec.ts
Tests: circle, star, heart, arrow  
Each test: select shape → set 5km distance → set location "London, UK" → generate → assert

### text.spec.ts
Tests:
| Case | Input |
|------|-------|
| Single char | "A" |
| Short word | "RUN" |
| Medium word | "LONDON" |
| Multi-word | "HELLO WORLD" |

### drawing.spec.ts
Freehand drawing is arbitrary — users trace any path on the canvas. Tests replay realistic recorded coordinate sequences via mouse simulation:

```typescript
const drawPath = async (page, coordinates: {x: number, y: number}[]) => {
  await page.mouse.move(coordinates[0].x, coordinates[0].y);
  await page.mouse.down();
  for (const coord of coordinates.slice(1)) {
    await page.mouse.move(coord.x, coord.y, { steps: 2 });
  }
  await page.mouse.up();
};
```

Fixtures are JSON files of recorded `{x, y}` coordinate sequences captured by actually drawing in the app. Four fixtures cover diverse drawing styles: loop, letter-like, irregular polygon, complex multi-stroke.

### data-testid additions required
Small additions to existing UI components (no logic changes):
- `data-testid="shape-selector"` — shape dropdown
- `data-testid="distance-input"` — distance input field
- `data-testid="location-input"` — location search input
- `data-testid="generate-btn"` — generate/create route button
- `data-testid="route-polyline"` — rendered route on map
- `data-testid="fitness-score"` — fitness score display
- `data-testid="drawing-canvas"` — freehand drawing canvas

---

## Section 2: Vitest Unit Tests

Pure computation — no network, runs in milliseconds. Uses synthetic hand-crafted node/edge maps for deterministic assertions.

### shapeMath.test.ts
- All shape types produce normalized points within `[0, 1]` bounds
- `rotateShape` is invertible (rotate by θ then -θ returns original)
- `scaleShape` is invertible
- `projectShapeToLatLng` produces valid lat/lng for known inputs
- Text mode produces non-empty paths for single char, short word, long word

### optimizationService.test.ts
- `calculateGeodesicBearing`: due North = 0°, due East = 90°, due South = 180°, due West = 270°
- `scoreShapeAgainstRoadNetwork`: returns 0 when no roads nearby, >0 when roads align with shape
- `findBestOrientation`: always returns a valid `bestConfig` even when all scores equal
- Bearing diff threshold: segments >45° off are skipped (no score contribution)

### fitnessService.test.ts
- Empty route scores 0
- Score increases as route better matches ideal shape
- `rerouteFailingStages` correctly identifies segments below threshold
- Score is bounded [0, 100]

---

## Section 3: Environment & Running Tests

```bash
npm run test           # Vitest unit tests (fast, no network)
npm run test:e2e       # Playwright E2E (requires .env + auto-starts dev server)
npm run test:e2e:ui    # Playwright with visual debugger
```

New `package.json` scripts to add:
```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

**Not in scope:** CI/GitHub Actions setup — tests are designed to run locally first.

---

## New Files Summary

| File | Purpose |
|------|---------|
| `playwright.config.ts` | Playwright configuration with webServer |
| `tests/e2e/shapes.spec.ts` | Shape mode E2E tests |
| `tests/e2e/text.spec.ts` | Text mode E2E tests |
| `tests/e2e/drawing.spec.ts` | Drawing mode E2E tests |
| `tests/e2e/fixtures/*.json` | Recorded freehand drawing coordinates (4 files) |
| `tests/e2e/helpers/draw.ts` | `drawPath()` canvas helper |
| `tests/unit/shapeMath.test.ts` | shapeMath unit tests |
| `tests/unit/optimizationService.test.ts` | Optimization scoring unit tests |
| `tests/unit/fitnessService.test.ts` | Fitness scoring unit tests |

Existing files modified: UI components (add `data-testid` attributes only), `package.json` (add scripts), `package.json` (add `@playwright/test` dev dependency).
