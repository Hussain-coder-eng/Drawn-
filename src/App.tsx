import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Wand2, LogOut, User as UserIcon, AlertCircle, X } from "lucide-react";
import AuthScreen from "./components/AuthScreen";
import BottomSheet from "./components/BottomSheet";
import DesignInput from "./components/DesignInput";
import RouteSettings from "./components/RouteSettings";
import ResultCard from "./components/ResultCard";
import MapComponent from "./components/MapComponent";
import GenerationProgress from "./components/GenerationProgress";
import { InputMode, DrawnState, DebugInfo } from "./types";
import { SHAPES } from "./constants";

// Firebase imports
import { auth, db, googleProvider } from "./firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  deleteDoc,
  doc,
  orderBy,
  setDoc,
} from "firebase/firestore";

// Services and Libs
import { RoutingService } from "./services/routingService";
import { RateLimiter } from "./services/rateLimiter";
import { GeminiService } from "./services/geminiService";
import { OverpassService } from "./services/overpassService";
import { FitnessService } from "./services/fitnessService";
import { checkFeasibility } from "./services/feasibilityService";
import { snapIdealPathToRoads } from "./services/nodeSnapService";
import {
  SHAPE_SCRIPTS,
  getLetterScript,
  chainScripts,
  generateScriptFromPath
} from "./lib/routeScripts";
import {
  Point,
  generateNormalizedHeart,
  generateNormalizedStar,
  generateNormalizedCircle,
  generateNormalizedInfinity,
  generateNormalizedArrow,
  generateNormalizedLightning,
  generateNormalizedSpiral,
  generateHeart,
  generateStar,
  generateCircle,
  generateSquare,
  generateInfinity,
  generateArrow,
  generateLightning,
  scaleAndCenter,
  NormalizedPoint,
  adaptiveSimplify,
  SHAPE_SIMPLIFICATION_CONFIG,
  projectShapeToLatLng,
  isClosedShape,
} from "./lib/shapeMath";
import { downloadGPX } from "./lib/gpxExport";
import { validateDistance, validateText } from "./lib/validation";
import { preprocessorService } from "./services/preprocessorService";
import { composeWordPath } from "./lib/gpsFont";
import { findBestOrientation } from "./services/optimizationService";
import { useNudgeInterface } from "./hooks/useNudgeInterface";
import { NudgeMap } from "./components/NudgeMap";
import { RunScreen } from "./components/RunScreen";
import { PreRunChecklist } from "./components/PreRunChecklist";
import { NavRoute, preprocessRouteForNavigation } from "./lib/navigationService";

// Global limiters
const osrmLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });

const routingService = new RoutingService(import.meta.env.VITE_OPENROUTESERVICE_API_KEY);
const geminiService = new GeminiService();
const overpassService = new OverpassService();
const fitnessService = new FitnessService();

interface SavedRoute extends DrawnState {
  id: string;
  timestamp: number;
  label: string;
  uid: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userLocation, setUserLocation] = useState<Point>({ lat: 40.7128, lng: -74.006 });
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const [state, setState] = useState<DrawnState>({
    mode: "shapes",
    selectedShape: "heart",
    textInput: "",
    distance: 5.0,
    unit: "km",
    location: "",
    isGenerating: false,
    hasResult: false,
    routeFidelity: 0,
    idealCoords: [],
    snappedCoords: [],
    drawnPath: [],
    normalizedDrawnPath: [],
    nodeMap: new Map(),
    returnToStart: false,
  });
  const [isNudging, setIsNudging] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const [history, setHistory] = useState<DrawnState[]>([]);
  const [redoStack, setRedoStack] = useState<DrawnState[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [currentScriptStages, setCurrentScriptStages] = useState<number>(0);

  // Run Mode State
  const [navRoute, setNavRoute] = useState<NavRoute | null>(null);
  const [isPreRunChecklistOpen, setIsPreRunChecklistOpen] = useState(false);
  const [isRunScreenOpen, setIsRunScreenOpen] = useState(false);
  const [isPreparingRun, setIsPreparingRun] = useState(false);

  const [generationProgress, setGenerationProgress] = useState<{
    attempt: number;
    maxAttempts: number;
    fitnessScore: number | null;
    failingStages: number[];
  }>({
    attempt: 0,
    maxAttempts: 3,
    fitnessScore: null,
    failingStages: [],
  });
  const lastGenerationTime = useRef<number>(0);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStartRunFlow = async () => {
    if (!state.snappedCoords || state.snappedCoords.length === 0) return;

    setIsPreparingRun(true);
    setLoadingMessage("Preparing navigation...");

    try {
      const processed = await preprocessRouteForNavigation(
        state.snappedCoords.map(p => [p.lng, p.lat])
      );
      setNavRoute(processed);
      setIsPreRunChecklistOpen(true);
    } catch (err) {
      console.error("Failed to prepare run:", err);
      setError("Failed to prepare navigation data.");
    } finally {
      setIsPreparingRun(false);
      setLoadingMessage("");
    }
  };

  // Get user location on mount
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        () => console.warn("Geolocation failed or denied.")
      );
    }
  }, []);

  // Handle redirect result (fallback from signInWithRedirect)
  useEffect(() => {
    getRedirectResult(auth).then((result) => {
      if (result?.user) {
        setIsLoggingIn(false);
      }
    }).catch((error: any) => {
      if (error.code && error.code !== "auth/no-auth-event") {
        console.error("Redirect result error:", error.code, error.message);
        setError(`Login failed (${error.code}). Please try again.`);
        setIsLoggingIn(false);
      }
    });
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);

      if (currentUser) {
        const userRef = doc(db, "users", currentUser.uid);
        try {
          await setDoc(userRef, {
            uid: currentUser.uid,
            displayName: currentUser.displayName,
            email: currentUser.email,
            photoURL: currentUser.photoURL,
          }, { merge: true });
        } catch (error) {
          console.error("Error syncing user profile:", error);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Firestore Real-time Listener for Routes
  useEffect(() => {
    if (!user || !isAuthReady) {
      setSavedRoutes([]);
      return;
    }

    const q = query(
      collection(db, "routes"),
      where("uid", "==", user.uid),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const routes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SavedRoute[];
      setSavedRoutes(routes);
    }, (error) => {
      console.error("Firestore Error:", error);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // Firestore connectivity is handled silently — the SDK reconnects automatically.
  // A failed test call should never surface as a user-facing error or race with generation.

  // Prefetch road network when location or distance changes
  useEffect(() => {
    if (userLocation.lat !== 0 && userLocation.lng !== 0 && isAuthReady) {
      const validDist = validateDistance(state.distance);
      const distInKm = state.unit === "mi" ? validDist * 1.60934 : validDist;
      const baseRadiusMeters = Math.max(800, Math.round((distInKm / (2 * Math.PI)) * 1.3 * 1000));

      const timer = setTimeout(() => {
        prefetchTimerRef.current = null;
        overpassService.fetchRoadNetwork(userLocation, baseRadiusMeters).catch(() => {});
      }, 2000);
      prefetchTimerRef.current = timer;

      return () => {
        clearTimeout(timer);
        prefetchTimerRef.current = null;
      };
    }
  }, [userLocation, state.distance, state.unit, isAuthReady]);

  const updateState = useCallback((newState: Partial<DrawnState>, saveToHistory = true) => {
    setState((prev) => {
      const updated = { ...prev, ...newState };
      if (saveToHistory) {
        setHistory((h) => [...h, prev]);
        setRedoStack([]);
      }
      return updated;
    });
  }, []);

  const handleGenerate = async () => {
    if (!user) {
      setError("Please sign in to generate a route.");
      return;
    }

    const now = Date.now();
    if (now - lastGenerationTime.current < 5000) {
      setError("Please wait a few seconds before generating again.");
      return;
    }

    // Cancel any pending prefetch so it doesn't race with the real fetch
    if (prefetchTimerRef.current !== null) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }

    setError(null);
    setGenerationError(null);
    updateState({ isGenerating: true }, false);
    setGenerationProgress({ attempt: 0, maxAttempts: 3, fitnessScore: null, failingStages: [] });

    try {
      console.log("[DEBUG] handleGenerate started", { mode: state.mode, distance: state.distance, unit: state.unit });
      setLoadingMessage("Preprocessing your design...");

      await osrmLimiter.check();

      const validDist = validateDistance(state.distance);
      const distInKm = state.unit === "mi" ? validDist * 1.60934 : validDist;

      // 1. Get Normalized Points
      let normalizedPoints: NormalizedPoint[] = [];
      let shapeLabel = "";

      if (state.mode === "shapes") {
        shapeLabel = state.selectedShape || "Shape";
        switch (state.selectedShape) {
          case "heart": normalizedPoints = generateNormalizedHeart(); break;
          case "star": normalizedPoints = generateNormalizedStar(); break;
          case "circle": normalizedPoints = generateNormalizedCircle(); break;
          case "infinity": normalizedPoints = generateNormalizedInfinity(); break;
          case "arrow": normalizedPoints = generateNormalizedArrow(); break;
          case "lightning": normalizedPoints = generateNormalizedLightning(); break;
          default: normalizedPoints = generateNormalizedCircle();
        }
      } else if (state.mode === "text") {
        const validText = validateText(state.textInput);
        shapeLabel = validText;
        const wordResult = composeWordPath(validText, distInKm, userLocation);
        normalizedPoints = wordResult.waypoints.map(p => ({ x: p.lng, y: p.lat }));
      } else if (state.mode === "draw") {
        shapeLabel = "Custom Drawing";
        if (state.normalizedDrawnPath.length < 2) {
          throw new Error("Please draw a shape on the canvas first.");
        }
        normalizedPoints = state.normalizedDrawnPath;
      }

      // 2. Adaptive Simplification
      const configKey = state.mode === "shapes" ? state.selectedShape || "circle" : state.mode;
      const config = SHAPE_SIMPLIFICATION_CONFIG[configKey] || SHAPE_SIMPLIFICATION_CONFIG.circle;
      const simplifiedPoints = adaptiveSimplify(normalizedPoints, config).points;

      setLoadingMessage("Fetching local road network...");
      const baseRadiusMeters = Math.max(800, Math.round((distInKm / (2 * Math.PI)) * 1.3 * 1000));

      let network = await overpassService.fetchRoadNetwork(userLocation, baseRadiusMeters, (msg) => {
        setLoadingMessage(msg);
      });

      if (network.nodes.length < 80) {
        setLoadingMessage("Area seems sparse. Expanding search...");
        const retryRadius = Math.min(baseRadiusMeters * 2.5, 5000);
        network = await overpassService.fetchRoadNetwork(userLocation, retryRadius, (msg) => {
          setLoadingMessage(msg);
        });
      }

      if (network.nodes.length < 8) {
        throw new Error("We couldn't find enough roads in this area to form a route. This often happens in very remote areas, private property, or places with restricted access. Try moving your starting point or choosing a larger distance.");
      }

      // 3. Rotation and Scale Optimization
      setLoadingMessage("Optimizing orientation...");
      const { bestConfig } = await findBestOrientation(
        simplifiedPoints,
        userLocation.lat,
        userLocation.lng,
        distInKm,
        network.nodeMap,
        network.edgeMap,
        state.mode
      );

      // 4b. Feasibility gate — bail early if road density is too low for this shape/location
      checkFeasibility(network, bestConfig.projectedPoints);
      setCurrentScriptStages(0);

      // Determine anchor for closed-loop shapes
      const closed =
        isClosedShape(state.mode, state.selectedShape, state.normalizedDrawnPath) ||
        state.returnToStart;

      let forcedAnchor: Point | undefined;
      if (closed) {
        // batchSnap falls back to raw GPS if OSRM is unreachable; OSRM will re-snap during routing
        const [startOnRoad] = await routingService.batchSnap([userLocation]);
        forcedAnchor = startOnRoad;
      }

      // 5. Algorithmic snap routing — no AI required
      setGenerationProgress({ attempt: 1, maxAttempts: 3, fitnessScore: null, failingStages: [] });

      const WAYPOINT_COUNTS = [30, 45, 20] as const;
      let bestFitness = 0;
      let bestRoutedPoints: Point[] | null = null;
      let bestSnappedWaypoints: Point[] | null = null;

      for (let attempt = 0; attempt < WAYPOINT_COUNTS.length; attempt++) {
        setGenerationProgress(prev => ({ ...prev, attempt: attempt + 1 }));
        setLoadingMessage(
          attempt === 0
            ? `Snapping ${shapeLabel} to roads...`
            : `Refining route (pass ${attempt + 1} of 3)...`
        );

        const snappedWaypoints = await snapIdealPathToRoads(
          bestConfig.projectedPoints,
          routingService,
          WAYPOINT_COUNTS[attempt],
          forcedAnchor
        );

        setLoadingMessage("Routing on real streets...");
        const routingResult = await routingService.routeWithLockedWaypoints(snappedWaypoints);
        const routedPoints = routingResult.polylineCoords.map(c => ({ lat: c[1], lng: c[0] }));

        const fidelityScore = fitnessService.scoreFidelity(routedPoints, state.mode, bestConfig.projectedPoints);

        setGenerationProgress(prev => ({
          ...prev,
          fitnessScore: fidelityScore,
          failingStages: [],
        }));

        if (fidelityScore > bestFitness) {
          bestFitness = fidelityScore;
          bestRoutedPoints = routedPoints;
          bestSnappedWaypoints = snappedWaypoints;
        }

        if (fidelityScore >= 70) break;
        if (attempt === 0 && fidelityScore >= 50) break;
        if (attempt === 1 && fidelityScore >= 40) break;
      }

      if (!bestRoutedPoints) {
        throw new Error("Failed to generate a route. Please try again.");
      }

      const debugInfo: DebugInfo = {
        idealPath: bestConfig.projectedPoints,
        snappedWaypoints: bestSnappedWaypoints ?? [],
      };

      updateState({
        isGenerating: false,
        hasResult: true,
        idealCoords: bestConfig.projectedPoints,
        snappedCoords: bestRoutedPoints,
        routeFidelity: bestFitness,
        distance: validDist,
        textInput: state.textInput,
        nodeMap: network.nodeMap,
        debugInfo,
      }, true);

      if (bestFitness < 70) {
        setGenerationError(
          `Route quality is lower than expected (${bestFitness}% match). Try regenerating for a better result.`
        );
      }

      lastGenerationTime.current = Date.now();
    } catch (err: any) {
      console.error(err);
      let msg = err.message || "An unexpected error occurred.";
      if (msg === "Failed to fetch") {
        msg = "The routing server (OSRM) is currently unreachable or overloaded. Please try again in a few moments.";
      }
      setError(msg);
      setGenerationError(msg);
      updateState({ isGenerating: false }, false);
    } finally {
      setLoadingMessage("");
    }
  };

  const handleRegenerate = () => {
    updateState({ hasResult: false }, false);
    handleGenerate();
  };

  const saveRoute = async () => {
    if (!user) return;
    try {
      const label = state.mode === "shapes"
        ? (SHAPES.find(s => s.id === state.selectedShape)?.label || "Shape")
        : (validateText(state.textInput) || "Custom");
      const routeData = {
        uid: user.uid,
        label,
        mode: state.mode,
        selectedShape: state.selectedShape ?? null,
        textInput: state.mode === "text" ? validateText(state.textInput) : null,
        distance: state.distance,
        unit: state.unit,
        routeFidelity: state.routeFidelity ?? null,
        snappedCoords: state.snappedCoords,
        idealCoords: state.idealCoords,
        timestamp: Date.now(),
        // nodeMap excluded: it's a JS Map (not Firestore-serializable) and not needed for saved routes
      };
      await addDoc(collection(db, "routes"), routeData);
    } catch (error) {
      console.error("Error saving route:", error);
    }
  };

  const deleteSavedRoute = async (id: string) => {
    try {
      await deleteDoc(doc(db, "routes", id));
    } catch (error) {
      console.error("Error deleting route:", error);
    }
  };

  const loadSavedRoute = (route: SavedRoute) => {
    const { id, timestamp, label, uid, ...rest } = route;
    setState(rest);
  };

  const handleExportGPX = () => {
    const rawLabel = state.mode === "shapes" ? (SHAPES.find(s => s.id === state.selectedShape)?.label || "Shape") : (validateText(state.textInput) || "Custom");
    downloadGPX(state.snappedCoords, `Drawn - ${rawLabel}`);
  };

  const previewIdealCoords = useMemo(() => {
    if (state.hasResult) return state.idealCoords;
    const distInKm = state.unit === "mi" ? state.distance * 1.60934 : state.distance;
    const validText = validateText(state.textInput);
    if (state.mode === "shapes") {
      switch (state.selectedShape) {
        case "heart": return generateHeart(userLocation, distInKm);
        case "star": return generateStar(userLocation, distInKm);
        case "square": return generateSquare(userLocation, distInKm);
        case "infinity": return generateInfinity(userLocation, distInKm);
        case "arrow": return generateArrow(userLocation, distInKm);
        case "lightning": return generateLightning(userLocation, distInKm);
        default: return generateCircle(userLocation, distInKm);
      }
    } else if (state.mode === "text" && validText) {
      return composeWordPath(validText, distInKm, userLocation).waypoints;
    } else if (state.mode === "draw" && state.normalizedDrawnPath.length > 0) {
      return projectShapeToLatLng(state.normalizedDrawnPath, userLocation.lat, userLocation.lng, distInKm / 2);
    }
    return [];
  }, [state.mode, state.selectedShape, state.textInput, state.drawnPath, state.distance, state.unit, state.hasResult, state.idealCoords, userLocation]);

  const selectedShapeLabel = SHAPES.find(s => s.id === state.selectedShape)?.label || "Custom";

  const {
    waypoints: nudgedWaypoints,
    fitnessScore: nudgedFitness,
    handleWaypointDrag,
    segmentAccuracy,
    highlightedLetter
  } = useNudgeInterface({
    inputType: state.mode,
    initialWaypoints: state.snappedCoords.map((p, i) => ({ ...p, nodeId: "", id: `w-${i}` })),
    originalShape: state.normalizedDrawnPath,
    osmNodes: state.nodeMap || new Map(),
    distanceKm: state.unit === "mi" ? state.distance * 1.60934 : state.distance,
    centerLat: userLocation.lat,
    centerLng: userLocation.lng,
    onRouteChange: ({ waypoints, updatedSegment }) => {
      // Route change callback for nudge interface
    }
  });

  const panelContent = state.hasResult ? (
    <ResultCard
      distance={state.distance}
      unit={state.unit}
      shapeLabel={selectedShapeLabel}
      fidelity={state.routeFidelity}
      snappedCoords={state.snappedCoords}
      onRegenerate={handleRegenerate}
      onFineTune={() => setIsNudging(true)}
      onStartRun={handleStartRunFlow}
    />
  ) : (
    <div className="space-y-4">
      <DesignInput
        mode={state.mode}
        selectedShape={state.selectedShape}
        setSelectedShape={(id) => updateState({ selectedShape: id, hasResult: false })}
        textInput={state.textInput}
        setTextInput={(text) => updateState({ textInput: text, hasResult: false })}
        drawnPath={state.drawnPath}
        setDrawnPath={(path) => updateState({ drawnPath: path, hasResult: false })}
        setNormalizedDrawnPath={(path) => updateState({ normalizedDrawnPath: path, hasResult: false })}
        expanded={sheetExpanded}
        onModeSelect={(mode) => {
          updateState({ mode, hasResult: false, returnToStart: false });
          setSheetExpanded(true);
        }}
        returnToStart={state.returnToStart}
        onReturnToStartChange={(v) => updateState({ returnToStart: v })}
      />

      <RouteSettings
        distance={state.distance}
        setDistance={(d) => updateState({ distance: d, hasResult: false })}
        unit={state.unit}
        setUnit={(u) => updateState({ unit: u, hasResult: false })}
        location={state.location}
        setLocation={(l) => updateState({ location: l, hasResult: false })}
        setUserLocation={(p) => setUserLocation(p)}
      />

      {error && (
        <div className="p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-[12px] font-medium">
          {error}
        </div>
      )}

      <button
        data-testid="generate-btn"
        onClick={handleGenerate}
        disabled={state.isGenerating}
        className="w-full h-[64px] bg-gradient-to-r from-accent-primary to-accent-secondary hover:opacity-90 active:scale-[0.98] transition-all rounded-[16px] flex items-center justify-center gap-3 text-white text-[18px] font-display font-bold uppercase tracking-widest group relative overflow-hidden disabled:opacity-50 glow-pink-strong"
      >
        <Wand2 className="w-6 h-6 group-hover:rotate-12 transition-transform" />
        Generate Route
      </button>
    </div>
  );

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-bg-primary font-sans">
      {/* Auth Gate */}
      {!user && isAuthReady && (
        <AuthScreen
          onGoogleLogin={login}
          isLoggingIn={isLoggingIn}
          error={error}
        />
      )}

      {/* Full-screen Map — offset on desktop to account for sidebar */}
      <div className="absolute inset-0 md:left-[380px]">
        <MapComponent
          mode={state.mode}
          idealCoords={previewIdealCoords}
          snappedCoords={state.snappedCoords}
          isGenerating={state.isGenerating}
          hasResult={state.hasResult}
          center={userLocation}
          debugInfo={state.debugInfo}
          showDebug={showDebug}
          onToggleDebug={() => setShowDebug(v => !v)}
        />
      </div>

      {/* Generation Popup Overlay */}
      <AnimatePresence>
        {state.isGenerating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[3000] flex items-center justify-center bg-black/60"
          >
            <GenerationProgress
              message={loadingMessage}
              error={error}
              onRetry={handleGenerate}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generation Error Toast */}
      <AnimatePresence>
        {generationError && !state.isGenerating && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 md:left-[380px] md:translate-x-0 md:right-0 md:bottom-6 md:flex md:justify-center z-[5000] px-4 pointer-events-none"
          >
            <div className="flex items-start gap-3 p-4 bg-bg-card border border-danger/40 rounded-xl shadow-2xl max-w-sm w-full pointer-events-auto">
              <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
              <p className="text-danger text-[13px] font-medium flex-1 leading-snug">{generationError}</p>
              <button
                onClick={() => setGenerationError(null)}
                className="text-text-muted hover:text-white transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:flex-col md:fixed md:left-0 md:top-0 md:bottom-0 md:w-[380px] md:bg-bg-primary md:border-r md:border-divider md:z-[2000]">
        {/* Brand */}
        <div className="px-6 pt-6 pb-4 border-b border-divider flex items-center justify-between flex-shrink-0">
          <h1 className="text-[28px] font-display font-bold tracking-tighter text-white uppercase italic leading-none">
            Draw<span className="text-accent-primary">n</span>
          </h1>
          {user && (
            <button
              onClick={logout}
              className="flex items-center gap-2 bg-bg-card border border-divider rounded-full px-3 py-1.5 text-white text-[12px] font-medium hover:bg-bg-subtle transition-colors"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon className="w-4 h-4 text-text-secondary" />
              )}
              <span>{user.displayName?.split(' ')[0] || 'Account'}</span>
              <LogOut className="w-3.5 h-3.5 text-text-muted" />
            </button>
          )}
        </div>
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {panelContent}
        </div>
      </div>

      {/* User Avatar (top-right, mobile only) */}
      {user && (
        <div className="absolute top-4 right-4 z-[1500] md:hidden">
          <button
            onClick={logout}
            className="flex items-center gap-2 bg-bg-card/80 backdrop-blur-md border border-divider rounded-full px-3 py-2 text-white text-[12px] font-medium hover:bg-bg-card transition-colors"
          >
            {user.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <UserIcon className="w-5 h-5 text-text-secondary" />
            )}
          </button>
        </div>
      )}

      {/* Mobile Bottom Sheet */}
      <div className="md:hidden">
        <BottomSheet
          expanded={sheetExpanded}
          onToggle={() => setSheetExpanded(prev => !prev)}
        >
          {panelContent}
        </BottomSheet>
      </div>

      {/* Nudge Interface Overlay */}
      <AnimatePresence>
        {isNudging && state.hasResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[4000] bg-bg-primary"
          >
            <NudgeMap
              inputType={state.mode}
              routePolyline={state.snappedCoords.map(p => [p.lng, p.lat])}
              waypoints={nudgedWaypoints}
              ghostShape={state.idealCoords}
              segmentAccuracy={segmentAccuracy}
              fitnessScore={nudgedFitness || state.routeFidelity}
              highlightedLetter={highlightedLetter}
              onWaypointDrag={handleWaypointDrag}
              centerLat={userLocation.lat}
              centerLng={userLocation.lng}
              onClose={() => setIsNudging(false)}
              onSave={() => {
                updateState({ snappedCoords: nudgedWaypoints.map(({ lat, lng }) => ({ lat, lng })) }, true);
                setIsNudging(false);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Run Mode Overlays */}
      <AnimatePresence>
        {isPreRunChecklistOpen && navRoute && (
          <PreRunChecklist
            navRoute={navRoute}
            shapeName={state.mode === 'shapes' ? state.selectedShape : state.mode === 'text' ? 'Text' : 'Drawn'}
            onProceed={() => {
              setIsPreRunChecklistOpen(false);
              setIsRunScreenOpen(true);
            }}
            onCancel={() => setIsPreRunChecklistOpen(false)}
          />
        )}

        {isRunScreenOpen && navRoute && (
          <RunScreen
            navRoute={navRoute}
            shapeName={state.mode === 'shapes' ? state.selectedShape : state.mode === 'text' ? 'Text' : 'Drawn'}
            onClose={() => setIsRunScreenOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );

  async function login() {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      setIsLoggingIn(false);
    } catch (error: any) {
      console.error("Login failed:", error.code, error.message);
      // Popup-related failures: fall back to redirect automatically
      const popupFailureCodes = [
        "auth/popup-blocked",
        "auth/popup-closed-by-user",
        "auth/cancelled-popup-request",
      ];
      if (popupFailureCodes.includes(error.code) || !error.code) {
        try {
          // signInWithRedirect navigates away; page will return and getRedirectResult handles completion
          await signInWithRedirect(auth, googleProvider);
        } catch (redirectError: any) {
          console.error("Redirect login failed:", redirectError.code, redirectError.message);
          setError("Sign-in failed. Please allow popups for this site or try a different browser.");
          setIsLoggingIn(false);
        }
      } else if (error.code === "auth/unauthorized-domain") {
        setError("This domain is not authorized for Google sign-in. In your Firebase Console → Authentication → Settings → Authorized domains, add the domain you're running on (e.g. localhost).");
        setIsLoggingIn(false);
      } else if (error.code === "auth/operation-not-allowed") {
        setError("Google sign-in is not enabled for this Firebase project. Enable it under Firebase Console → Authentication → Sign-in method.");
        setIsLoggingIn(false);
      } else if (error.code === "auth/network-request-failed") {
        setError("Network error. Please check your internet connection and try again.");
        setIsLoggingIn(false);
      } else {
        setError(`Sign-in failed (${error.code || 'unknown'}). Please try again.`);
        setIsLoggingIn(false);
      }
    }
  }

  async function logout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }
}
