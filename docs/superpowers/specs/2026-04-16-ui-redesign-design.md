# UI Redesign — Design Spec

## Goal

Full visual redesign of Drawn for mobile-first use. Map becomes the primary surface. Design controls live in a bottom sheet. Auth is a proper first screen. Generation shows step-by-step progress. Results expose an Export to Maps action alongside the existing Start Run flow.

## Architecture Overview

The app has 4 distinct states managed in `App.tsx`. No routing library is added — screen switching is conditional rendering driven by existing state flags (`user`, new `guestMode`, `routePoints`).

| State | Trigger |
|---|---|
| Auth Screen | `user === null && !guestMode` |
| Design Screen | `user !== null \|\| guestMode`, no route yet |
| Generation Popup | `isGenerating === true` |
| Result State | `routePoints.length > 0` |

---

## Screen 1: Auth Screen

**Layout:** Full-screen `#0f0f13` background, vertically centered card.

**Elements (top to bottom):**
1. Large bold "DRAWN" wordmark — white italic, pink "N" — same typography as current `Header.tsx`
2. Tagline: `"Draw your run."` in muted uppercase tracking
3. Animated SVG preview — a pink polyline traces a circle/star shape on a dark map-style background (pure CSS/SVG, no real map data, ~200×120px)
4. `"Continue with Google"` — white pill button, Google logo SVG, dark text, full-width
5. `"Continue as Guest"` — ghost pill button, pink text, full-width
6. Footer: `"By continuing you agree to Terms & Privacy"` in muted 11px text

**State changes:**
- Google button → existing `signInWithPopup` flow → sets `user` → Auth Screen unmounts
- Guest button → sets `guestMode = true` → Auth Screen unmounts
- Guests can generate routes but cannot save to Firestore (save button is hidden / shows a "Sign in to save" tooltip)

**Files:**
- Create: `src/components/AuthScreen.tsx`
- Modify: `src/App.tsx` — add `guestMode` state, render `<AuthScreen>` when `user === null && !guestMode`

---

## Screen 2: Design Screen — Map + Bottom Sheet

### Map Layer

`MapComponent` fills 100% of the viewport (`w-screen h-screen`, no padding/margin). The existing map component is unchanged except for removing any container padding in `App.tsx`.

**Floating top-right:** A small circular avatar button (user photo or initials). Tapping opens a minimal popover with "Saved Routes" and "Sign Out." Guest users see "Sign In" instead.

### Bottom Sheet

A fixed-position panel anchored to the bottom of the screen. Two states:

**Collapsed (default, ~180px):**
- Drag handle pill at top center
- 3 horizontal mode cards side by side: "Premade" / "Text" / "Draw"
- Each card: pink icon + label, rounded border. Active card has pink border glow
- Tapping a card expands the sheet

**Expanded (~65% screen height):**
- Drag handle pill at top (swipe down to collapse)
- 3 mode cards remain at top — still tappable to switch modes
- Mode content area (scrollable if needed):
  - **Premade:** 3×3 shape grid (Circle, Star, Heart, Infinity, Arrow, Lightning, Spiral, Square) — same icons as current
  - **Text:** Text input field + font style picker (3 options)
  - **Draw:** `DrawingCanvas` component (existing, unchanged)
- **Settings row:** Single line — `"5.0 km · London · Roads"` with chevron. Tapping expands inline to show distance slider, location search, surface toggle (same controls as current `RouteSettings.tsx`, just repositioned)
- **Generate Route button:** Full-width pink pill at sheet bottom. Disabled (greyed) until shape/text/path is selected

**Backdrop:** When sheet is expanded, a `bg-black/40` overlay covers the map portion above the sheet (not full opacity — map remains readable at top).

**Files:**
- Create: `src/components/BottomSheet.tsx` — sheet container, drag handle, collapse/expand logic, backdrop
- Modify: `src/components/DesignInput.tsx` — remove outer wrapper padding; now rendered inside BottomSheet
- Modify: `src/components/RouteSettings.tsx` — add collapsible wrapper; rendered inside BottomSheet below mode content
- Delete: `src/components/Header.tsx` — replaced by Auth Screen branding
- Delete: `src/components/BottomNav.tsx` — replaced by bottom sheet

---

## Screen 3: Generation Popup

A centered modal overlay. Map and sheet are dimmed behind it (`bg-black/60` full-screen backdrop). Cannot be manually dismissed.

**Card contents (top to bottom):**
1. Large animated pink spinner ring (40px, no score number inside)
2. Step list — 5 steps rendered as rows:
   ```
   ✓  Fetching road network          ← completed: dot filled pink, text dimmed
   ●  Optimizing shape orientation   ← active: dot pulses, text white
   ○  Selecting route nodes          ← pending: dot hollow, text muted
   ○  Routing on real streets
   ○  Scoring & refining
   ```
3. On failure: spinner replaced by red ✕ icon, error message text, "Try Again" button (calls `handleGenerate` again)

**Step mapping:** The existing `progressMessage` string emitted from `App.tsx` is mapped to step indices via substring matching:
| Message substring | Step index |
|---|---|
| `"road"` or `"network"` or `"map"` | 0 |
| `"orient"` or `"optim"` | 1 |
| `"node"` or `"AI"` or `"Gemini"` | 2 |
| `"Routing"` or `"street"` | 3 |
| `"Scor"` or `"refin"` or `"fitness"` | 4 |

**Files:**
- Modify: `src/components/GenerationProgress.tsx` — full rewrite with step list UI; remove `fitnessScore`, `failingStages`, `totalStages` props; add `steps` computed from `message` prop

---

## Screen 4: Result State

**Map:** Route polyline already overlaid. Map auto-fits bounds to show full route (`map.fitBounds(routeBounds)`).

**Action Bar (collapsed bottom sheet, ~120px):**
- Top row: `"5.2 km · Circle · 78% match"` in muted 12px text
- Two primary buttons (equal width, side by side):
  - **"Export to Maps"** — pink background. Tapping opens a small choice sheet (bottom-anchored popover): "Google Maps" / "Apple Maps" / "Copy Link"
  - **"Start Run"** — dark card background, pink border. Opens existing `RunScreen`
- Ghost links row below buttons: `"Fine-tune Route"` (opens `NudgeMap`) · `"Redesign"` (resets state)

**Files:**
- Modify: `src/components/ResultCard.tsx` — replace current layout with action bar layout; remove fitness score badge and stage bars; add Export to Maps button with choice popover

---

## Maps Export

A new pure utility with no external API calls.

**File:** `src/lib/mapsExport.ts`

**Functions:**

```typescript
export function buildGoogleMapsUrl(waypoints: {lat: number; lng: number}[]): string
```
- Subsamples waypoints to ≤10 using `adaptiveSimplify` (already in `shapeMath.ts`)
- Format: `https://www.google.com/maps/dir/?api=1&origin={lat},{lng}&destination={lat},{lng}&waypoints={lat},{lng}|...&travelmode=walking`

```typescript
export function buildAppleMapsUrl(waypoints: {lat: number; lng: number}[]): string
```
- Uses only first and last waypoint (Apple Maps URL scheme limitation)
- Format: `maps://?saddr={lat},{lng}&daddr={lat},{lng}&dirflg=w`

```typescript
export function copyMapsLink(waypoints: {lat: number; lng: number}[]): void
```
- Copies Google Maps URL to clipboard via `navigator.clipboard.writeText`

**Usage in `ResultCard.tsx`:** Import and call on button tap with `window.open(url, '_blank')`.

---

## Component Deletion / Replacement Summary

| File | Action |
|---|---|
| `src/components/Header.tsx` | Delete — branding moves to `AuthScreen.tsx` |
| `src/components/BottomNav.tsx` | Delete — replaced by `BottomSheet.tsx` |
| `src/components/GenerationProgress.tsx` | Rewrite — step list replaces score/bars |
| `src/components/ResultCard.tsx` | Rewrite — action bar layout |
| `src/components/DesignInput.tsx` | Modify — strip outer wrapper, live inside sheet |
| `src/components/RouteSettings.tsx` | Modify — add collapsible wrapper |
| `src/components/AuthScreen.tsx` | Create — new auth first-screen |
| `src/components/BottomSheet.tsx` | Create — sheet container with drag/expand |
| `src/lib/mapsExport.ts` | Create — Google + Apple Maps URL builders |

---

## Preserved / Unchanged

- `MapComponent.tsx` — unchanged internally; container in `App.tsx` becomes full-screen
- `NudgeMap.tsx` — unchanged; still opened from "Fine-tune Route" ghost link
- `RunScreen.tsx`, `PreRunChecklist.tsx`, `RunMap.tsx`, `RunCompleteScreen.tsx` — unchanged; still opened from "Start Run" button
- All services, hooks, and lib utilities — unchanged
- Pink accent color `#FF2D6B` — preserved throughout

---

## Testing

- `AuthScreen` renders Google and Guest buttons when `user === null`
- `BottomSheet` expands/collapses on card tap and drag
- `GenerationProgress` maps message strings to correct active step index
- `mapsExport.buildGoogleMapsUrl` subsamples to ≤10 waypoints and produces valid URL
- `mapsExport.buildAppleMapsUrl` uses first and last waypoint only
- Existing Playwright E2E tests updated: `data-testid` attributes moved to new component locations
