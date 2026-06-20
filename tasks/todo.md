# Image Upload Recognition Refinement

## Checklist

- [x] Confirm branch/worktree and inspect current image tracing flow.
- [x] Improve upload preprocessing fidelity with conservative output sizing.
- [x] Make vision stroke parsing tolerant of fenced/prose JSON, object points, and duplicate points.
- [x] Preserve more image outline detail during simplification and loop detection.
- [x] Refine backend vision prompt for recognizable silhouettes.
- [x] Add focused unit coverage for parser and image-mode shape behavior.
- [x] Run project and functions verification.
- [x] Commit changes on `feat-image-upload-recognition`.

## Review / Results

- `npm run test -- --run`: passed, 12 files / 132 tests.
- `npm run lint`: passed.
- `functions`: installed local dependencies with `npm ci`, then `timeout 120 ./node_modules/.bin/tsc --noEmit --pretty false` passed.
- Note: `functions/npm ci` reported Node 24 vs package engine Node 22 and 20 audit vulnerabilities.
