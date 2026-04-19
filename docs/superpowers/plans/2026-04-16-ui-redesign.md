# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full mobile-first redesign — map-first layout with expandable bottom sheet, proper auth screen, step-by-step generation popup, and Export to Maps action.

**Architecture:** `App.tsx` shifts from a sidebar+map split to a full-screen map with a fixed bottom sheet overlay. Auth becomes a full-screen gate. `GenerationProgress` becomes a centered popup with step messages. A new `mapsExport.ts` utility builds Google/Apple Maps URLs from routed waypoints.

**Tech Stack:** React, TypeScript, Framer Motion (`motion/react`), Tailwind CSS, Leaflet (`react-leaflet`), Vitest for unit tests.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/lib/mapsExport.ts` | Build Google/Apple Maps URLs from waypoints |
| Create | `src/components/AuthScreen.tsx` | Full-screen login/guest gate |
| Create | `src/components/BottomSheet.tsx` | Animated bottom sheet container |
| Rewrite | `src/components/GenerationProgress.tsx` | Step-list popup (remove score/bars) |
| Rewrite | `src/components/ResultCard.tsx` | Action bar with Export to Maps + Start Run |
| Modify | `src/components/DesignInput.tsx` | Accept `expanded` prop; hide content when collapsed |
| Modify | `src/components/RouteSettings.tsx` | Accept `expanded` prop; collapsible wrapper |
| Modify | `src/components/MapComponent.tsx` | Add `FitBounds` inner component |
| Modify | `src/App.tsx` | Full-screen layout, auth gate, sheet wiring, guestMode |
| Delete | `src/components/Header.tsx` | Replaced by AuthScreen branding |
| Delete | `src/components/BottomNav.tsx` | Replaced by bottom sheet |
| Create | `tests/unit/mapsExport.test.ts` | Unit tests for URL builders |
| Create | `tests/unit/generationProgress.test.ts` | Unit tests for step mapping |

---

### Task 1: mapsExport utility

**Files:**
- Create: `src/lib/mapsExport.ts`
- Create: `tests/unit/mapsExport.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/mapsExport.test.ts
import { describe, it, expect } from 'vitest';
import { buildGoogleMapsUrl, buildAppleMapsUrl } from '../../src/lib/mapsExport';
import { Point } from '../../src/lib/shapeMath';

function pts(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ lat: 51.5 + i * 0.001, lng: -0.1 + i * 0.001 }));
}

describe('buildGoogleMapsUrl', () => {
  it('returns empty string for fewer than 2 waypoints', () => {
    expect(buildGoogleMapsUrl([])).toBe('');
    expect(buildGoogleMapsUrl([{ lat: 51.5, lng: -0.1 }])).toBe('');
  });

  it('includes origin, destination, and walking mode', () => {
    const url = buildGoogleMapsUrl(pts(3));
    expect(url).toContain('origin=51.5,-0.1');
    expect(url).toContain('travelmode=walking');
    expect(url).toContain('google.com/maps/dir');
  });

  it('subsamples to at most 8 intermediate waypoints (10 total)', () => {
    const url = buildGoogleMapsUrl(pts(20));
    const match = url.match(/waypoints=([^&]+)/);
    if (match) {
      const count = decodeURIComponent(match[1]).split('|').length;
      expect(count).toBeLessThanOrEqual(8);
    }
  });

  it('works with exactly 2 waypoints (no intermediate)', () => {
    const url = buildGoogleMapsUrl(pts(2));
    expect(url).not.toContain('waypoints');
    expect(url).toContain('origin=');
    expect(url).toContain('destination=');
  });
});

describe('buildAppleMapsUrl', () => {
  it('returns empty string for fewer than 2 waypoints', () => {
    expect(buildAppleMapsUrl([])).toBe('');
  });

  it('uses only first and last point with walking mode', () => {
    const url = buildAppleMapsUrl(pts(10));
    expect(url).toContain('maps://?saddr=51.5,-0.1');
    expect(url).toContain('dirflg=w');
    // Only 3 params: saddr, daddr, dirflg
    expect(url.split('&').length).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/unit/mapsExport.test.ts
```
Expected: FAIL — `Cannot find module '../../src/lib/mapsExport'`

- [ ] **Step 3: Implement mapsExport.ts**

```typescript
// src/lib/mapsExport.ts
import { Point } from "./shapeMath";

function subsample(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

export function buildGoogleMapsUrl(waypoints: Point[]): string {
  if (waypoints.length < 2) return "";
  const sampled = subsample(waypoints, 10);
  const origin = `${sampled[0].lat},${sampled[0].lng}`;
  const destination = `${sampled[sampled.length - 1].lat},${sampled[sampled.length - 1].lng}`;
  const middle = sampled.slice(1, -1).map(p => `${p.lat},${p.lng}`).join("|");
  const base = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;
  return middle ? `${base}&waypoints=${encodeURIComponent(middle)}` : base;
}

export function buildAppleMapsUrl(waypoints: Point[]): string {
  if (waypoints.length < 2) return "";
  const start = waypoints[0];
  const end = waypoints[waypoints.length - 1];
  return `maps://?saddr=${start.lat},${start.lng}&daddr=${end.lat},${end.lng}&dirflg=w`;
}

export function copyMapsLink(waypoints: Point[]): void {
  const url = buildGoogleMapsUrl(waypoints);
  navigator.clipboard.writeText(url);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/unit/mapsExport.test.ts
```
Expected: PASS (all 6 assertions green)

---

### Task 2: GenerationProgress rewrite + step mapping test

**Files:**
- Rewrite: `src/components/GenerationProgress.tsx`
- Create: `tests/unit/generationProgress.test.ts`

- [ ] **Step 1: Write failing test for messageToStepIndex**

```typescript
// tests/unit/generationProgress.test.ts
import { describe, it, expect } from 'vitest';
import { messageToStepIndex } from '../../src/components/GenerationProgress';

describe('messageToStepIndex', () => {
  it('maps road/fetch messages to step 0', () => {
    expect(messageToStepIndex('Fetching local road network...')).toBe(0);
    expect(messageToStepIndex('Using cached road network...')).toBe(0);
    expect(messageToStepIndex('Processing map data in background...')).toBe(0);
  });
  it('maps orientation messages to step 1', () => {
    expect(messageToStepIndex('Optimizing orientation...')).toBe(1);
  });
  it('maps node/AI/planning messages to step 2', () => {
    expect(messageToStepIndex('Planning your Circle — attempt 1 of 3...')).toBe(2);
    expect(messageToStepIndex('Asking Gemini...')).toBe(2);
  });
  it('maps routing messages to step 3', () => {
    expect(messageToStepIndex('Routing on real streets...')).toBe(3);
  });
  it('maps scoring messages to step 4', () => {
    expect(messageToStepIndex('Scoring & refining...')).toBe(4);
  });
  it('returns -1 for unrecognized messages', () => {
    expect(messageToStepIndex('')).toBe(-1);
    expect(messageToStepIndex('Preprocessing your design...')).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/generationProgress.test.ts
```
Expected: FAIL — `messageToStepIndex is not a function`

- [ ] **Step 3: Rewrite GenerationProgress.tsx**

```tsx
// src/components/GenerationProgress.tsx
import { motion } from "motion/react";
import { Check, XCircle, RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";

const STEPS = [
  "Fetching road network",
  "Optimizing shape orientation",
  "Selecting route nodes",
  "Routing on real streets",
  "Scoring & refining",
];

export function messageToStepIndex(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes('road') || lower.includes('network') || lower.includes('map') || lower.includes('fetch')) return 0;
  if (lower.includes('orient') || lower.includes('optim')) return 1;
  if (lower.includes('node') || lower.includes('ai') || lower.includes('gemini') || lower.includes('planning')) return 2;
  if (lower.includes('rout') || lower.includes('street')) return 3;
  if (lower.includes('scor') || lower.includes('refin') || lower.includes('fitness')) return 4;
  return -1;
}

interface GenerationProgressProps {
  message: string;
  error: string | null;
  onRetry: () => void;
}

export default function GenerationProgress({ message, error, onRetry }: GenerationProgressProps) {
  const activeStep = messageToStepIndex(message);

  if (error) {
    return (
      <div className="bg-bg-card border border-divider rounded-[24px] p-8 w-[320px] space-y-6 text-center">
        <XCircle className="w-12 h-12 text-danger mx-auto" />
        <p className="text-[14px] font-sans text-white">{error}</p>
        <button
          onClick={onRetry}
          className="w-full h-[48px] bg-accent-primary text-white rounded-[12px] font-bold uppercase tracking-widest text-[13px]"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div data-testid="generation-progress" className="bg-bg-card border border-divider rounded-[24px] p-8 w-[320px] space-y-6">
      {/* Spinner */}
      <div className="flex justify-center">
        <div className="w-12 h-12 border-4 border-accent-primary/20 border-t-accent-primary rounded-full animate-spin" />
      </div>

      {/* Step list */}
      <div className="space-y-3">
        {STEPS.map((label, i) => {
          const isDone = activeStep > i;
          const isActive = activeStep === i;
          return (
            <div key={i} className="flex items-center gap-3">
              <div className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300",
                isDone ? "bg-accent-primary" : isActive ? "bg-accent-primary/30 ring-2 ring-accent-primary animate-pulse" : "bg-divider"
              )}>
                {isDone && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className={cn(
                "text-[13px] font-sans transition-colors duration-300",
                isDone ? "text-text-muted line-through" : isActive ? "text-white font-medium" : "text-text-muted"
              )}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/generationProgress.test.ts
```
Expected: PASS (all 7 assertions green)

---

### Task 3: AuthScreen component

**Files:**
- Create: `src/components/AuthScreen.tsx`

- [ ] **Step 1: Create AuthScreen.tsx**

```tsx
// src/components/AuthScreen.tsx

interface AuthScreenProps {
  onGoogleLogin: () => void;
  onGuest: () => void;
  isLoggingIn: boolean;
  error: string | null;
}

export default function AuthScreen({ onGoogleLogin, onGuest, isLoggingIn, error }: AuthScreenProps) {
  return (
    <div
      data-testid="auth-screen"
      className="fixed inset-0 z-[9999] bg-[#0f0f13] flex flex-col items-center justify-center px-8"
    >
      {/* Wordmark */}
      <div className="mb-12 text-center">
        <h1 className="text-[56px] font-display font-bold tracking-tighter text-white uppercase italic leading-none">
          Draw<span className="text-accent-primary">n</span>
        </h1>
        <p className="text-[12px] text-text-secondary mt-2 font-medium uppercase tracking-[0.2em]">
          Draw your run.
        </p>
      </div>

      {/* Animated route preview */}
      <div className="mb-12 w-[200px] h-[120px]">
        <svg viewBox="0 0 200 120" className="w-full h-full">
          <rect width="200" height="120" rx="12" fill="#18181f" />
          {/* Grid lines for map feel */}
          <line x1="0" y1="40" x2="200" y2="40" stroke="#2a2a38" strokeWidth="1" />
          <line x1="0" y1="80" x2="200" y2="80" stroke="#2a2a38" strokeWidth="1" />
          <line x1="66" y1="0" x2="66" y2="120" stroke="#2a2a38" strokeWidth="1" />
          <line x1="133" y1="0" x2="133" y2="120" stroke="#2a2a38" strokeWidth="1" />
          {/* Animated circle trace */}
          <circle
            cx="100" cy="60" r="36"
            fill="none"
            stroke="#FF2D6B"
            strokeWidth="2.5"
            strokeDasharray="226"
            strokeDashoffset="226"
            strokeLinecap="round"
          >
            <animate
              attributeName="stroke-dashoffset"
              from="226"
              to="0"
              dur="2.5s"
              repeatCount="indefinite"
              calcMode="ease"
            />
          </circle>
        </svg>
      </div>

      {/* Buttons */}
      <div className="w-full max-w-[320px] space-y-3">
        {error && (
          <p className="text-danger text-[12px] text-center font-medium">{error}</p>
        )}

        <button
          data-testid="google-login-btn"
          onClick={onGoogleLogin}
          disabled={isLoggingIn}
          className="w-full h-[56px] bg-white rounded-full flex items-center justify-center gap-3 text-[15px] font-sans font-semibold text-gray-800 hover:opacity-90 transition-all disabled:opacity-50"
        >
          <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {isLoggingIn ? "Signing in…" : "Continue with Google"}
        </button>

        <button
          data-testid="guest-btn"
          onClick={onGuest}
          className="w-full h-[48px] rounded-full border border-accent-primary/40 flex items-center justify-center text-[14px] font-sans font-medium text-accent-primary hover:bg-accent-primary/10 transition-all"
        >
          Continue as Guest
        </button>
      </div>

      <p className="mt-8 text-[11px] text-text-muted text-center">
        By continuing you agree to our Terms &amp; Privacy
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors in `AuthScreen.tsx`

---

### Task 4: BottomSheet component

**Files:**
- Create: `src/components/BottomSheet.tsx`

- [ ] **Step 1: Create BottomSheet.tsx**

```tsx
// src/components/BottomSheet.tsx
import { motion, AnimatePresence } from "motion/react";

interface BottomSheetProps {
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export default function BottomSheet({ expanded, onToggle, children }: BottomSheetProps) {
  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[1000] bg-black/40 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Sheet */}
      <motion.div
        data-testid="bottom-sheet"
        className="fixed bottom-0 left-0 right-0 z-[2000] bg-bg-primary rounded-t-[28px] shadow-[0_-20px_60px_rgba(0,0,0,0.9)] border-t border-divider"
        animate={{ height: expanded ? "65vh" : "180px" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      >
        {/* Drag handle */}
        <div
          data-testid="sheet-handle"
          className="w-full flex justify-center pt-4 pb-2 cursor-pointer"
          onClick={onToggle}
        >
          <div className="w-12 h-1.5 bg-divider rounded-full" />
        </div>

        {/* Scrollable content */}
        <div className="h-full overflow-y-auto px-5 pb-24">
          {children}
        </div>
      </motion.div>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors in `BottomSheet.tsx`

---

### Task 5: Modify DesignInput + RouteSettings for collapsed/expanded state

**Files:**
- Modify: `src/components/DesignInput.tsx`
- Modify: `src/components/RouteSettings.tsx`

- [ ] **Step 1: Add `expanded` prop to DesignInput**

The full file content of `src/components/DesignInput.tsx` after modification:

```tsx
// src/components/DesignInput.tsx
import { SHAPES, FONT_STYLES } from "@/src/constants";
import { cn } from "@/src/lib/utils";
import { InputMode } from "@/src/types";
import { motion } from "motion/react";
import { Check, Keyboard } from "lucide-react";
import { Point, NormalizedPoint } from "@/src/lib/shapeMath";
import React from "react";
import { DrawingCanvas } from "./DrawingCanvas";

interface DesignInputProps {
  mode: InputMode;
  setMode: (mode: InputMode) => void;
  selectedShape: string | null;
  setSelectedShape: (id: string | null) => void;
  textInput: string;
  setTextInput: (text: string) => void;
  fontStyle: string;
  setFontStyle: (id: string) => void;
  drawnPath: Point[];
  setDrawnPath: (path: Point[]) => void;
  setNormalizedDrawnPath: (path: NormalizedPoint[]) => void;
  expanded: boolean;
  onModeSelect: (mode: InputMode) => void;
}

export default function DesignInput({
  mode,
  setMode,
  selectedShape,
  setSelectedShape,
  textInput,
  setTextInput,
  fontStyle,
  setFontStyle,
  drawnPath,
  setDrawnPath,
  setNormalizedDrawnPath,
  expanded,
  onModeSelect,
}: DesignInputProps) {
  const handleShapeComplete = (points: NormalizedPoint[]) => {
    setNormalizedDrawnPath(points);
    const previewPoints = points.map(p => ({ lat: p.y * 100, lng: p.x * 100 }));
    setDrawnPath(previewPoints);
  };

  const modeLabels: Record<InputMode, string> = {
    shapes: "Premade",
    text: "Text",
    draw: "Draw",
  };

  return (
    <div className="space-y-4">
      {/* Mode cards — always visible */}
      <div className="grid grid-cols-3 gap-2 pt-2">
        {(["shapes", "text", "draw"] as InputMode[]).map((m) => (
          <button
            key={m}
            data-testid={`mode-${m}`}
            onClick={() => onModeSelect(m)}
            className={cn(
              "h-[56px] flex flex-col items-center justify-center rounded-[14px] border-[1.5px] transition-all duration-200 gap-1",
              mode === m
                ? "border-accent-primary bg-accent-primary/10"
                : "border-divider bg-bg-card hover:border-accent-primary/50"
            )}
          >
            <span className={cn(
              "text-[11px] font-sans font-bold uppercase tracking-[0.08em]",
              mode === m ? "text-accent-primary" : "text-text-secondary"
            )}>
              {modeLabels[m]}
            </span>
          </button>
        ))}
      </div>

      {/* Expanded content */}
      {expanded && (
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="min-h-[160px]"
        >
          {mode === "shapes" && (
            <div className="grid grid-cols-4 gap-2">
              {SHAPES.map((shape) => {
                const Icon = shape.icon;
                const isSelected = selectedShape === shape.id;
                return (
                  <button
                    key={shape.id}
                    data-testid={`shape-${shape.id}`}
                    onClick={() => setSelectedShape(shape.id)}
                    className={cn(
                      "flex flex-col items-center justify-center aspect-square rounded-[12px] border-[1.5px] transition-all duration-200",
                      isSelected
                        ? "border-accent-primary bg-bg-card glow-pink-strong"
                        : "border-transparent bg-bg-card hover:border-divider"
                    )}
                  >
                    <Icon className={cn("w-7 h-7 mb-1 transition-colors", isSelected ? "text-accent-primary" : "text-white")} />
                    <span className={cn("text-[9px] font-sans font-medium uppercase tracking-tighter", isSelected ? "text-accent-primary" : "text-text-secondary")}>
                      {shape.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {mode === "text" && (
            <div className="space-y-4">
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2">
                  <Keyboard className="w-5 h-5 text-accent-primary" />
                </div>
                <input
                  type="text"
                  data-testid="text-input"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Type a word or name…"
                  className="w-full h-[52px] bg-bg-card border border-divider rounded-[10px] pl-12 pr-4 text-[15px] font-sans text-white focus:outline-none focus:border-accent-primary transition-colors placeholder:text-text-muted"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {FONT_STYLES.map((font) => (
                  <button
                    key={font.id}
                    onClick={() => setFontStyle(font.id)}
                    className={cn(
                      "flex flex-col items-center justify-center py-3 rounded-[10px] border-[1.5px] transition-all duration-200",
                      fontStyle === font.id ? "border-accent-primary bg-bg-card" : "border-transparent bg-bg-card hover:border-divider"
                    )}
                  >
                    <span className={cn(font.className, "text-[14px]", fontStyle === font.id ? "text-white" : "text-text-secondary")}>A</span>
                    <span className="text-[10px] font-sans font-medium uppercase tracking-widest text-text-muted mt-1">{font.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "draw" && (
            <div className="space-y-3">
              <DrawingCanvas onShapeComplete={handleShapeComplete} />
              {drawnPath.length > 0 && (
                <div className="flex items-center justify-center gap-2 bg-success/20 border border-success/30 px-3 py-1.5 rounded-full w-fit mx-auto">
                  <Check className="w-3 h-3 text-success" />
                  <span className="text-[10px] font-bold text-success uppercase tracking-wider">Shape Captured</span>
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add `expanded` prop to RouteSettings**

Replace the opening `<div className="space-y-8 pt-6 border-t border-divider">` wrapper and add an expand toggle. The full file:

```tsx
// src/components/RouteSettings.tsx
import { cn } from "@/src/lib/utils";
import { SurfacePreference } from "@/src/types";
import { MapPin, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface RouteSettingsProps {
  distance: number;
  setDistance: (d: number) => void;
  unit: "mi" | "km";
  setUnit: (u: "mi" | "km") => void;
  location: string;
  setLocation: (l: string) => void;
  setUserLocation: (p: { lat: number; lng: number }) => void;
  surface: SurfacePreference;
  setSurface: (s: SurfacePreference) => void;
  sheetExpanded: boolean;
}

export default function RouteSettings({
  distance,
  setDistance,
  unit,
  setUnit,
  location,
  setLocation,
  setUserLocation,
  surface,
  setSurface,
  sheetExpanded,
}: RouteSettingsProps) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const searchLocation = async (query: string) => {
    if (query.length < 3) return;
    setIsSearching(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
      const data = await response.json();
      const results = data.map((item: any) => ({
        label: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon)
      }));
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } catch (error) {
      console.error("Geocoding failed:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const summaryText = `${distance.toFixed(1)} ${unit} · ${location ? location.split(',')[0] : 'No location'} · ${surface}`;

  if (!sheetExpanded) return null;

  return (
    <div className="border-t border-divider mt-4 pt-4">
      {/* Collapsible header row */}
      <button
        className="w-full flex items-center justify-between py-2"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[12px] font-sans text-text-secondary truncate pr-2">{summaryText}</span>
        {open ? <ChevronUp className="w-4 h-4 text-text-muted flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden space-y-6 pt-4"
          >
            {/* Target Distance */}
            <div className="space-y-4">
              <div className="flex items-baseline justify-center gap-2">
                <span className="text-[48px] font-display font-bold text-white leading-none">{distance.toFixed(1)}</span>
                <span className="text-[20px] font-display font-normal text-text-secondary uppercase">{unit}</span>
              </div>
              <div className="space-y-2">
                <input
                  type="range"
                  data-testid="distance-input"
                  min="0.5"
                  max="26.2"
                  step="0.1"
                  value={distance}
                  onChange={(e) => setDistance(parseFloat(e.target.value))}
                  className="w-full h-1 bg-divider rounded-full appearance-none cursor-pointer accent-accent-primary"
                  style={{
                    background: `linear-gradient(to right, #FF2D6B 0%, #FF2D6B ${(distance / 26.2) * 100}%, #2A2A2A ${(distance / 26.2) * 100}%, #2A2A2A 100%)`
                  }}
                />
              </div>
              <div className="flex justify-center">
                <div className="flex bg-bg-subtle p-1 rounded-full">
                  {(["mi", "km"] as const).map((u) => (
                    <button
                      key={u}
                      onClick={() => setUnit(u)}
                      className={cn(
                        "px-6 py-1.5 text-[12px] font-sans font-medium uppercase tracking-[0.08em] rounded-full transition-all duration-200",
                        unit === u ? "bg-accent-primary text-white" : "text-text-secondary hover:text-white"
                      )}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Start Location */}
            <div className="space-y-2 relative">
              <label className="text-[11px] font-sans font-medium uppercase tracking-[0.12em] text-text-secondary ml-1">Start Location</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                  {isSearching ? (
                    <div className="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <MapPin className="w-4 h-4 text-accent-primary" />
                  )}
                </div>
                <input
                  type="text"
                  data-testid="location-input"
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    if (e.target.value.length >= 3) {
                      const timer = setTimeout(() => searchLocation(e.target.value), 500);
                      return () => clearTimeout(timer);
                    } else {
                      setSuggestions([]);
                      setShowSuggestions(false);
                    }
                  }}
                  onFocus={() => setShowSuggestions(suggestions.length > 0)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  placeholder="Starting point…"
                  className="w-full h-[48px] bg-bg-card border border-divider rounded-[10px] pl-10 pr-4 text-[14px] font-sans text-white focus:outline-none focus:border-accent-primary transition-colors placeholder:text-text-muted"
                />
                {showSuggestions && (
                  <div className="absolute z-50 w-full mt-2 bg-bg-card border border-divider rounded-[16px] shadow-2xl overflow-hidden max-h-[200px] overflow-y-auto">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setLocation(s.label);
                          setUserLocation({ lat: s.lat, lng: s.lng });
                          setShowSuggestions(false);
                        }}
                        className="w-full px-4 py-3 text-left hover:bg-bg-subtle transition-colors border-b border-divider last:border-none"
                      >
                        <div className="text-[13px] font-sans text-white line-clamp-1">{s.label.split(',')[0]}</div>
                        <div className="text-[11px] font-sans text-text-secondary line-clamp-1">{s.label.split(',').slice(1).join(',').trim()}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Surface */}
            <div className="space-y-2">
              <label className="text-[11px] font-sans font-medium uppercase tracking-[0.12em] text-text-secondary ml-1">Surface</label>
              <div className="flex gap-2">
                {(["roads", "trails", "mixed"] as SurfacePreference[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSurface(s)}
                    className={cn(
                      "flex-1 h-[32px] px-4 rounded-full text-[12px] font-sans font-medium uppercase tracking-[0.08em] transition-all duration-200",
                      surface === s
                        ? "bg-accent-primary text-white"
                        : "bg-bg-subtle text-text-secondary hover:text-white"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors

---

### Task 6: Rewrite ResultCard (action bar + Export to Maps)

**Files:**
- Rewrite: `src/components/ResultCard.tsx`

- [ ] **Step 1: Rewrite ResultCard.tsx**

```tsx
// src/components/ResultCard.tsx
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Navigation, Map, Settings, RefreshCw, Copy, CheckCircle2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Point } from "@/src/lib/shapeMath";
import { buildGoogleMapsUrl, buildAppleMapsUrl, copyMapsLink } from "@/src/lib/mapsExport";

interface ResultCardProps {
  distance: number;
  unit: string;
  shapeLabel: string;
  fidelity: number;
  snappedCoords: Point[];
  onRegenerate: () => void;
  onFineTune: () => void;
  onStartRun: () => void;
}

export default function ResultCard({
  distance,
  unit,
  shapeLabel,
  fidelity,
  snappedCoords,
  onRegenerate,
  onFineTune,
  onStartRun,
}: ResultCardProps) {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    copyMapsLink(snappedCoords);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 pt-2"
    >
      {/* Summary line */}
      <p className="text-[12px] font-sans text-text-secondary text-center">
        {distance.toFixed(1)} {unit} · {shapeLabel} · {fidelity}% match
      </p>

      {/* Primary action buttons */}
      <div className="flex gap-3">
        {/* Export to Maps */}
        <div className="flex-1 relative">
          <button
            data-testid="export-maps-btn"
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="w-full h-[56px] bg-accent-primary text-white rounded-[14px] flex items-center justify-center gap-2 font-sans font-bold text-[14px] uppercase tracking-wide glow-pink"
          >
            <Map className="w-5 h-5" />
            Export to Maps
          </button>

          {/* Export choice popover */}
          <AnimatePresence>
            {showExportMenu && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-[64px] left-0 right-0 bg-bg-card border border-divider rounded-[16px] shadow-2xl overflow-hidden z-10"
              >
                <button
                  onClick={() => { window.open(buildGoogleMapsUrl(snappedCoords), '_blank'); setShowExportMenu(false); }}
                  className="w-full px-4 py-3 text-left text-[13px] font-sans text-white hover:bg-bg-subtle transition-colors border-b border-divider flex items-center gap-3"
                >
                  <span className="text-[16px]">🗺</span> Google Maps
                </button>
                <button
                  onClick={() => { window.open(buildAppleMapsUrl(snappedCoords), '_blank'); setShowExportMenu(false); }}
                  className="w-full px-4 py-3 text-left text-[13px] font-sans text-white hover:bg-bg-subtle transition-colors border-b border-divider flex items-center gap-3"
                >
                  <span className="text-[16px]">🍎</span> Apple Maps
                </button>
                <button
                  onClick={() => { handleCopyLink(); setShowExportMenu(false); }}
                  className="w-full px-4 py-3 text-left text-[13px] font-sans text-white hover:bg-bg-subtle transition-colors flex items-center gap-3"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4 text-text-muted" />}
                  {copied ? "Copied!" : "Copy Link"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Start Run */}
        <button
          data-testid="start-run-btn"
          onClick={onStartRun}
          className="flex-1 h-[56px] bg-bg-card border border-accent-primary text-white rounded-[14px] flex items-center justify-center gap-2 font-sans font-bold text-[14px] uppercase tracking-wide hover:bg-accent-primary/10 transition-all"
        >
          <Navigation className="w-5 h-5 text-accent-primary" />
          Start Run
        </button>
      </div>

      {/* Ghost links */}
      <div className="flex justify-center gap-6">
        <button
          onClick={onFineTune}
          className="flex items-center gap-1.5 text-[12px] font-sans text-text-secondary hover:text-white transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          Fine-tune Route
        </button>
        <button
          data-testid="regenerate-btn"
          onClick={onRegenerate}
          className="flex items-center gap-1.5 text-[12px] font-sans text-accent-primary hover:text-accent-secondary transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Redesign
        </button>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors

---

### Task 7: Add FitBounds to MapComponent

**Files:**
- Modify: `src/components/MapComponent.tsx`

- [ ] **Step 1: Read current MapComponent to find where to insert FitBounds**

Read `src/components/MapComponent.tsx` lines 1–80.

- [ ] **Step 2: Add FitBounds inner component and wire it**

After the existing `MapController` component definition (around line 36), add:

```tsx
function FitBounds({ coords, hasResult }: { coords: [number, number][]; hasResult: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (hasResult && coords.length > 1) {
      const bounds = L.latLngBounds(coords);
      map.fitBounds(bounds, { padding: [60, 60] });
    }
  }, [hasResult]);
  return null;
}
```

Then inside the `<MapContainer>` JSX (after `<MapController>`), add:

```tsx
<FitBounds coords={leafletSnapped} hasResult={hasResult} />
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors

---

### Task 8: Restructure App.tsx

**Files:**
- Modify: `src/App.tsx`

This is the largest change. The steps below make precise, targeted edits.

- [ ] **Step 1: Add guestMode state and sheetExpanded state**

After `const [isNudging, setIsNudging] = useState(false);` (line ~116), add:

```typescript
const [guestMode, setGuestMode] = useState(false);
const [sheetExpanded, setSheetExpanded] = useState(false);
```

- [ ] **Step 2: Allow guests to generate**

In `handleGenerate`, replace:
```typescript
if (!user || !isAuthReady) {
  setError("Please sign in with Google to generate a route.");
  return;
}
```
with:
```typescript
if (!user && !guestMode) {
  setError("Please sign in or continue as guest to generate a route.");
  return;
}
```

- [ ] **Step 3: Add onModeSelect handler**

After `handleStartRunFlow`, add:

```typescript
const handleModeSelect = (m: typeof state.mode) => {
  updateState({ mode: m, hasResult: false });
  setSheetExpanded(true);
};
```

- [ ] **Step 4: Replace the entire return JSX**

Replace the `return (...)` block (from line ~628 to end of file) with:

```tsx
  // Add this import at the top of App.tsx:
  // import AuthScreen from "./components/AuthScreen";
  // import BottomSheet from "./components/BottomSheet";

  const shapeLabel = state.mode === "shapes"
    ? (SHAPES.find(s => s.id === state.selectedShape)?.label || "Shape")
    : state.textInput || "Custom";

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#0f0f13]">
      {/* Auth Gate */}
      {!user && !guestMode && isAuthReady && (
        <AuthScreen
          onGoogleLogin={login}
          onGuest={() => setGuestMode(true)}
          isLoggingIn={isLoggingIn}
          error={error}
        />
      )}

      {/* Full-screen Map */}
      <div className="absolute inset-0">
        <MapComponent
          mode={state.mode}
          idealCoords={previewIdealCoords}
          snappedCoords={state.snappedCoords}
          isGenerating={state.isGenerating}
          hasResult={state.hasResult}
          center={userLocation}
        />
      </div>

      {/* User avatar (top-right) */}
      {(user || guestMode) && (
        <div className="absolute top-4 right-4 z-[2500]">
          <button
            onClick={logout}
            className="w-10 h-10 rounded-full bg-bg-card border border-divider flex items-center justify-center text-[12px] font-bold text-white hover:border-accent-primary transition-all"
            title="Sign out"
          >
            {user?.photoURL ? (
              <img src={user.photoURL} alt="" className="w-full h-full rounded-full object-cover" />
            ) : (
              <span>{user?.displayName?.[0] || "G"}</span>
            )}
          </button>
        </div>
      )}

      {/* Generation Popup */}
      {state.isGenerating && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 px-6">
          <GenerationProgress
            message={loadingMessage}
            error={null}
            onRetry={handleGenerate}
          />
        </div>
      )}

      {/* Error popup (non-generation errors) */}
      {error && !state.isGenerating && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 px-6">
          <div className="bg-bg-card border border-divider rounded-[24px] p-8 w-[320px] space-y-4 text-center">
            <p className="text-[14px] font-sans text-white">{error}</p>
            <button
              onClick={() => setError(null)}
              className="w-full h-[44px] bg-accent-primary text-white rounded-[12px] font-bold uppercase tracking-widest text-[13px]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Bottom Sheet */}
      {(user || guestMode) && !state.isGenerating && (
        <BottomSheet
          expanded={sheetExpanded}
          onToggle={() => setSheetExpanded(!sheetExpanded)}
        >
          {state.hasResult ? (
            <ResultCard
              distance={state.distance}
              unit={state.unit}
              shapeLabel={shapeLabel}
              fidelity={state.routeFidelity}
              snappedCoords={state.snappedCoords}
              onRegenerate={() => {
                updateState({ hasResult: false }, false);
                setSheetExpanded(false);
              }}
              onFineTune={() => setIsNudging(true)}
              onStartRun={handleStartRunFlow}
            />
          ) : (
            <>
              <DesignInput
                mode={state.mode}
                setMode={(m) => updateState({ mode: m, hasResult: false })}
                selectedShape={state.selectedShape}
                setSelectedShape={(id) => updateState({ selectedShape: id, hasResult: false })}
                textInput={state.textInput}
                setTextInput={(text) => updateState({ textInput: text, hasResult: false })}
                fontStyle={state.fontStyle}
                setFontStyle={(id) => updateState({ fontStyle: id, hasResult: false })}
                drawnPath={state.drawnPath}
                setDrawnPath={(path) => updateState({ drawnPath: path, hasResult: false })}
                setNormalizedDrawnPath={(path) => updateState({ normalizedDrawnPath: path, hasResult: false })}
                expanded={sheetExpanded}
                onModeSelect={handleModeSelect}
              />

              {sheetExpanded && (
                <>
                  <RouteSettings
                    distance={state.distance}
                    setDistance={(d) => updateState({ distance: d, hasResult: false })}
                    unit={state.unit}
                    setUnit={(u) => updateState({ unit: u, hasResult: false })}
                    location={state.location}
                    setLocation={(l) => updateState({ location: l, hasResult: false })}
                    setUserLocation={(p) => setUserLocation(p)}
                    surface={state.surface}
                    setSurface={(s) => updateState({ surface: s, hasResult: false })}
                    sheetExpanded={sheetExpanded}
                  />

                  <div className="pt-4">
                    <button
                      data-testid="generate-btn"
                      onClick={handleGenerate}
                      disabled={state.isGenerating}
                      className="w-full h-[60px] bg-gradient-to-r from-accent-primary to-accent-secondary hover:opacity-90 active:scale-[0.98] transition-all rounded-[16px] flex items-center justify-center gap-3 text-white text-[18px] font-display font-bold uppercase tracking-widest disabled:opacity-50 glow-pink-strong"
                    >
                      Generate Route
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </BottomSheet>
      )}

      {/* NudgeMap overlay */}
      {isNudging && (
        <NudgeMap
          waypoints={nudgedWaypoints}
          onWaypointDrag={handleWaypointDrag}
          segmentAccuracy={segmentAccuracy}
          highlightedLetter={highlightedLetter}
          onClose={() => setIsNudging(false)}
        />
      )}

      {/* Pre-run checklist */}
      {isPreRunChecklistOpen && navRoute && (
        <PreRunChecklist
          route={navRoute}
          onStart={() => {
            setIsPreRunChecklistOpen(false);
            setIsRunScreenOpen(true);
          }}
          onCancel={() => setIsPreRunChecklistOpen(false)}
        />
      )}

      {/* Run screen */}
      {isRunScreenOpen && navRoute && (
        <RunScreen
          route={navRoute}
          onComplete={() => setIsRunScreenOpen(false)}
          onExit={() => setIsRunScreenOpen(false)}
        />
      )}
    </div>
  );
```

- [ ] **Step 5: Add missing imports to App.tsx**

At the top of App.tsx, add/update imports:

```typescript
import AuthScreen from "./components/AuthScreen";
import BottomSheet from "./components/BottomSheet";
```

Remove the existing imports for:
```typescript
import Header from "./components/Header";
import BottomNav from "./components/BottomNav";
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npm run lint
```
Expected: no errors

---

### Task 9: Delete obsolete files + run full test suite

**Files:**
- Delete: `src/components/Header.tsx`
- Delete: `src/components/BottomNav.tsx`

- [ ] **Step 1: Delete Header.tsx**

```bash
rm src/components/Header.tsx
```

- [ ] **Step 2: Delete BottomNav.tsx**

```bash
rm src/components/BottomNav.tsx
```

- [ ] **Step 3: Final lint check**

```bash
npm run lint
```
Expected: 0 errors

- [ ] **Step 4: Run full test suite**

```bash
npm test
```
Expected: all tests pass (existing 33 + 2 new = 35 total)

- [ ] **Step 5: Smoke test in browser**

```bash
npm run dev
```

Open `http://localhost:3000`. Verify:
1. Auth screen appears with "Draw**n**" wordmark and animated circle
2. "Continue as Guest" dismisses auth screen and shows map full-screen
3. Bottom sheet shows 3 mode cards (Premade / Text / Draw)
4. Tapping a mode card expands the sheet
5. Settings row shows and can be expanded
6. Generate button appears when sheet is expanded
7. On generate: popup appears with step list (no score bars)
8. On completion: route on map, action bar with "Export to Maps" and "Start Run"
9. "Export to Maps" shows Google Maps / Apple Maps / Copy Link choices
