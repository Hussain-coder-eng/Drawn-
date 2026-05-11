# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server at http://localhost:3000
npm run build     # Production build
npm run lint      # TypeScript type checking (tsc --noEmit)
npm run test      # Run tests with Vitest
npm run preview   # Preview production build
```

## Environment Variables

Create a `.env` file in the root:
```
GEMINI_API_KEY=your_gemini_key
VITE_OPENROUTESERVICE_API_KEY=your_ors_key
```

Note: `GEMINI_API_KEY` is injected as `process.env.GEMINI_API_KEY` via Vite's `define` config (not `import.meta.env`). `VITE_OPENROUTESERVICE_API_KEY` uses the standard `import.meta.env` pattern.

## Architecture

**Drawn** is a single-page GPS art route designer. Users pick a shape/text/freehand drawing, and the app snaps it to real streets using a multi-step pipeline.

### Route Generation Pipeline (in `App.tsx` `handleGenerate`)

1. **Shape Math** (`src/lib/shapeMath.ts`) — generates normalized `[0,1]` coordinate paths for shapes/text/drawings
2. **Overpass API** (`src/services/overpassService.ts`) — fetches the real-world road network within a radius
3. **Orientation Optimization** (`src/services/optimizationService.ts`) — rotates/scales the shape to best fit the local road network
4. **Stage Script** (`src/lib/stageService.ts`, `src/lib/routeScripts.ts`) — breaks the shape into directional stages (N/S/E/W segments with compass labels)
5. **Gemini AI** (`src/services/geminiService.ts`) — given OSM nodes and stage descriptors, selects "Anchor Point" node IDs that trace the shape
6. **OSRM Routing** (`src/services/routingService.ts`) — routes between AI-selected anchors on real streets
7. **Fitness Scoring** (`src/services/fitnessService.ts`) — scores the route against the ideal shape; retries up to 3× with `rerouteFailingStages` on poor results

### Key Directories

- `src/services/` — external API wrappers with rate limiting and caching
- `src/lib/` — pure computational utilities (geometry, GPS font rendering, GPX export, navigation)
- `src/components/` — UI components; `MapComponent` uses react-leaflet, `NudgeMap` allows post-generation waypoint drag adjustment
- `src/hooks/` — `useNudgeInterface` (drag-to-adjust route), `useRunTracker` (GPS tracking during run), `useTurnAlerts` (audio cues)

### State Management

All route state lives in a single `DrawnState` object in `App.tsx`. `updateState()` wraps `setState` with undo/redo history tracking. There is no external state library.

### Firebase

- Google Auth via popup (`firebase.ts`)
- Routes saved to Firestore `routes` collection with `uid` field
- User profile synced to `users/{uid}` on login

### GPS Font (`src/lib/gpsFont.ts`)

Text mode renders words as GPS-drawable paths using a custom stroke font. `composeWordPath` returns waypoints that trace letter outlines at the requested distance/location.

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake from recurring
- Review lessons at session start for relevant context

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: implement the elegant solution instead
- Skip this for simple, obvious fixes — don't over-engineer

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Go fix failing CI tests without being told how

### 7. CodeRabbit Review Before Merge
- Every PR must be reviewed by CodeRabbit before merging — wait as long as needed for the review to complete
- After CodeRabbit posts its review, read all feedback and fix every raised issue before attempting to merge
- Do not merge until CodeRabbit issues are resolved; re-request review if significant changes were made

## Task Management

1. **Plan First** — write plan to `tasks/todo.md` with checkable items
2. **Verify Plan** — check in before starting implementation
3. **Track Progress** — mark items complete as you go
4. **Explain Changes** — high-level summary at each step
5. **Document Results** — add review section to `tasks/todo.md`
6. **Capture Lessons** — update `tasks/lessons.md` after corrections

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

## Core Principles

- **Simplicity First** — make every change as simple as possible; impact minimal code
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — changes should only touch what's necessary; avoid introducing bugs

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
