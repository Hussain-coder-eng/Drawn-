# Image Recognition Fixtures

Deterministic fixtures for future image recognizability tests. Regenerate with:

```bash
node scripts/generate-image-recognition-fixtures.mjs
```

Each manifest entry includes normalized outline metadata in `[0, 1]` image space and a short note describing what the fixture is meant to catch.

## Fixtures

- `circle-loop` (circle-loop.svg): Checks that recognition preserves a plain closed loop without adding corners, gaps, or extra strokes.
- `star` (star.svg): Checks that recognizers keep sharp corners and concave turns instead of smoothing an angular icon into a blob.
- `open-path` (open-path.svg): Checks that open drawings remain open and are not incorrectly closed into a loop by outline extraction.
- `face-multistroke` (face-multistroke.svg): Checks that multi-stroke icon recognition keeps internal features as separate strokes while preserving the outer silhouette.
- `transparent-icon` (transparent-icon.png): Checks alpha handling for icon-style PNG uploads so transparent backgrounds do not become part of the recognized shape.
