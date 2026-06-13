# Handoff — Image → Route feature

_Last updated: 2026-06-13_

## Status: code-complete, deployed, PR open, awaiting CodeRabbit re-review

- **Branch:** `feat-image-to-route`
- **PR:** [#2](https://github.com/Hussain-coder-eng/Drawn-/pull/2) → `main`
- **Backend deployed:** `processGeminiJob` + `firestore.rules` (project `gen-lang-client-0367257006`, us-central1) — re-deployed after CodeRabbit fixes.
- **Static verification:** `npm run lint` clean · `npm run build` OK · `npm run test` 123/123 green · `functions` tsc clean.

## What the feature does
New **Image** input mode: user uploads an image → Gemini vision (server-side, Vertex AI/ADC) traces it into a multi-stroke outline → outline lands in the existing `normalizedDrawnPath` state → reuses the **entire** draw-mode pipeline (simplify → overpass → optimize → route → fitness). No pipeline changes.

## Architecture / data flow
1. `src/components/DesignInput.tsx` — Image mode card + upload dropzone → `visionService.imageToOutline(file)`.
2. `src/services/visionService.ts` — downscale (Task 1), 900k base64 guard, auth guard, sha256 cacheKey, write `jobs/{id}` doc (`type:"vision"`), poll via shared `pollJobResult`, then `parseVisionStrokes`.
3. `src/services/jobPoller.ts` — shared Firestore job poll/timeout helper (used by both `visionService` and `geminiService`).
4. `functions/src/index.ts` `processGeminiJob` — branches on `type:"vision"`; multimodal `gemini-2.5-flash` call with `VISION_SYSTEM_PROMPT`; shared rate-limit + cache + leased concurrency slots.
5. `src/lib/imageProcessing.ts` — pure transforms (`computeScaledDims`, `downscaleImageToBase64`, `orderAndFlattenStrokes`, `parseVisionStrokes`) + 25 unit tests.
6. Wiring: `types.ts` (`InputMode += "image"`), `shapeMath.ts` (`SHAPE_SIMPLIFICATION_CONFIG.image`), `App.tsx` (handleGenerate branch, preview projection, mode-change path clear), `fitnessService.ts` (DTW scoring for image like draw).

## Job contract (client → rules → function → client)
Client writes `jobs/{id}`: `{ uid, status:"pending", type:"vision", imageBase64, mimeType:"image/jpeg", prompt, cacheKey, createdAt, updatedAt }`.
- `prompt` is a dummy required only by firestore.rules; the function ignores it for vision and uses `VISION_SYSTEM_PROMPT` (commented on both sides).
- Function writes terminal `status:"done"` + `result` (JSON string) or `status:"failed"` + `error`.
- Size budget: client 900k base64 guard < rules ≤1,000,000 < Firestore 1,048,576-byte doc limit.

## Review history
- Per-task two-stage review (spec + code quality) + final full-feature review; all Critical/Important fixed on-branch.
- **CodeRabbit round 1: all 10 comments fixed** (commits `32de425` backend, `d8a64ba` rest):
  1. firebase-blueprint.json valid JSON header
  2. geminiCache/config → `allow read: if false` (backend-only)
  3. rate-limit state → `/rateLimits/{uid}` (not `/users`)
  4. shared-cache lookup before concurrency-slot acquisition
  5. leased concurrency slots (`ownerJobId`+`expiresAt`) replacing blind `activeCalls` counter
  6. DesignInput resets shared outline on new/failed upload; "Outline Captured" from explicit success flag
  7. MapComponent floating controls: aria-labels/aria-pressed/aria-hidden
  8. node-pool fingerprint folded into shared Firestore cache key (initial + reroute) via deterministic `hashString`
  9. routingWaypoints capped at MAX_WAYPOINTS when `budget<=0` (subsample locked anchors)
  10. documented `foot-walking` ORS profile rationale

## Remaining / next steps
- [ ] **Awaiting CodeRabbit re-review** (re-requested via `@coderabbitai review` on PR #2). Resolve any new findings before merge.
- [ ] **End-to-end manual test** (not runnable in dev env): app → Image mode → upload PNG/JPG → confirm outline preview renders → Generate → confirm real-street route. Backend now deployed, so this is testable.
- [ ] Merge PR #2 to `main` only after CodeRabbit passes (per CLAUDE.md: no direct main merge).

## Notes / known minor items (intentionally deferred)
- `downscaleImageToBase64` has a placeholder test (OffscreenCanvas unavailable in jsdom; scaling math covered via `computeScaledDims`).
- Vision call omits `maxOutputTokens` (output is tiny JSON; safe).
- Stale inert `activeCalls` field left on `config/gemini` doc after leased-slot migration (no code reads it).
- Working tree has pre-existing unrelated edits in `.gitignore` and `skills-lock.json` — NOT part of this PR.
- `hashString` in `geminiService.ts` is a non-crypto cache-key hash (djb2+sdbm, ~64-bit); `v2:` key prefix invalidates old v1 cache entries.
