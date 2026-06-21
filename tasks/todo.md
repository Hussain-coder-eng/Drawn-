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

- Fixed blocking review finding: `downscaleImageToBase64` now returns the actual encoded blob MIME type (`blob.type || requestedMimeType`) so browser encoder fallback bytes are not sent to Gemini with a mismatched MIME type.
- Added focused unit coverage for WebP requests that encode as PNG, including verifying the returned base64 comes from the PNG blob.
- Fixed review finding: `downscaleImageToBase64` now enforces the inline byte budget for every final output, including JPEG uploads and JPEG fallback from PNG/WebP, using bounded JPEG recompression/downscale attempts.
- `npm run test -- --run`: passed, 12 files / 134 tests.
- `npm run lint`: passed.
- `npm --prefix functions run build -- --pretty false`: passed.
- Note: `functions/npm ci` reported Node 24 vs package engine Node 22 and 20 audit vulnerabilities.
