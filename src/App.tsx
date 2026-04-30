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
import { InputMode, DrawnState } from "./types";
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
import { GeminiService, GeminiStagedResult } from "./services/geminiService";
import { OverpassService, OSMNode } from "./services/overpassService";
import { FitnessService, RouteFitness } from "./services/fitnessService";
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
  resamplePolylinePoints,
  projectShapeToLatLng,
} from "./lib/shapeMath";
import { downloadGPX } from "./lib/gpxExport";
import { validateDistance, validateText } from "./lib/validation";
import { preprocessorService } from "./services/preprocessorService";
import { composeWordPath } from "./lib/gpsFont";
import { buildStageScript } from "./lib/stageService";
import { findBestOrientation } from "./services/optimizationService";
import { useNudgeInterface } from "./hooks/useNudgeInterface";
import { NudgeMap } from "./components/NudgeMap";
import { RunScreen } from "./components/RunScreen";
import { PreRunChecklist } from "./components/PreRunChecklist";
import { NavRoute, preprocessRouteForNavigation } from "./lib/navigationService";

// Global limiters
const osrmLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });

/** Max vertices for AI stage script only (avoids hundreds of Gemini stages × huge prompts). */
const MAX_AI_SCRIPT_POINTS = 41;
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
    fontStyle: "normal",
    distance: 5.0,
    unit: "km",
    location: "",
    surface: "roads",
    isGenerating: false,
    hasResult: false,
    routeFidelity: 0,
    idealCoords: [],
    snappedCoords: [],
    drawnPath: [],
    normalizedDrawnPath: [],
    nodeMap: new Map(),
  });
  const [isNudging, setIsNudging] = useState(false);

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
        overpassService.fetchRoadNetwork(userLocation, baseRadiusMeters).catch(() => {});
      }, 2000);

      return () => clearTimeout(timer);
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

      // 4. Build Stage Script (dense shapes → many edges; cap polyline for AI/Gemini only)
      const aiPathForStages =
        bestConfig.projectedPoints.length <= MAX_AI_SCRIPT_POINTS
          ? bestConfig.projectedPoints
          : resamplePolylinePoints(bestConfig.projectedPoints, MAX_AI_SCRIPT_POINTS);

      const stages = buildStageScript(
        aiPathForStages.map(p => ({ x: p.lng, y: p.lat })),
        distInKm
      );
      setCurrentScriptStages(stages.length);

      // 5. AI Node Selection (Gemini)
      const startNode = overpassService.getRelevantNodes(network.nodes, [userLocation], network.edgeMap, 1)[0];
      const sampledNodes = overpassService.getRelevantNodes(network.nodes, bestConfig.projectedPoints, network.edgeMap, 400);

      const totalIdealPoints = aiPathForStages;
      let cumulativePct = 0;
      const idealStagePaths: Point[][] = stages.map((stage) => {
        const startFrac = cumulativePct / 100;
        cumulativePct += stage.distancePct;
        const endFrac = cumulativePct / 100;
        const n = totalIdealPoints.length;
        const startIdx = Math.floor(startFrac * (n - 1));
        const endIdx = Math.min(Math.ceil(endFrac * (n - 1)), n - 1);
        return totalIdealPoints.slice(startIdx, endIdx + 1);
      });
      const stageNodePools: OSMNode[][] = stages.map((_, i) =>
        overpassService.getNodesForStage(sampledNodes, idealStagePaths[i], 400)
      );

      let attempt = 1;
      let result: GeminiStagedResult | null = null;
      let fitness: RouteFitness | null = null;
      const maxAttempts = 2;

      while (attempt <= maxAttempts) {
        setGenerationProgress(prev => ({ ...prev, attempt }));
        setLoadingMessage(`Laying out your ${shapeLabel} — attempt ${attempt} of ${maxAttempts}...`);

        const aiStages = stages.map(s => ({
          stage: s.stageIndex + 1,
          direction: s.compassLabel,
          turn: s.turnType as any,
          distancePct: s.distancePct,
          description: `Move ${s.compassLabel}`
        }));

        setLoadingMessage("Selecting route nodes — contacting AI...");
        if (attempt === 1) {
          result = await geminiService.selectNodesStaged(
            stageNodePools,
            aiStages,
            shapeLabel,
            distInKm,
            startNode.id,
            bestConfig.projectedPoints,
            idealStagePaths,
            (msg) => setLoadingMessage(msg)
          );
        } else if (result && fitness) {
          result = await geminiService.rerouteFailingStages(
            result,
            fitness,
            stageNodePools,
            aiStages,
            idealStagePaths,
            distInKm,
            shapeLabel,
            network.nodeMap,
            (msg) => setLoadingMessage(msg)
          );
        }

        if (!result || !result.stages) throw new Error("AI failed to generate a valid route structure.");

        // 6. Anchor Point Locking (search only AI-relevant nodes — full nodeMap × all shape points freezes UI)
        setLoadingMessage("Routing on real streets...");
        const idealAnchors = bestConfig.projectedPoints.map((p, i) => ({ ...p, stageIndex: i }));
        const lockedAnchors = routingService.lockAnchorPointsToNodes(
          idealAnchors,
          network.nodeMap,
          sampledNodes
        );

        // 7. Route with Locked Waypoints
        // Anchor the route to the user's start location: prepend and append the nearest
        // OSM node to userLocation so the route always begins and ends where they are.
        const waypointArray = routingService.buildOSRMWaypointArray(result.stages, lockedAnchors, network.nodeMap);
        const startPoint = { lat: startNode.lat, lng: startNode.lng };
        const anchoredWaypointArray = [startPoint, ...waypointArray, startPoint];
        const routingResult = await routingService.routeWithLockedWaypoints(anchoredWaypointArray);

        const routedPoints = routingResult.polylineCoords.map(c => ({ lat: c[1], lng: c[0] }));

        const stageScore = fitnessService.scoreRoute(result.stages, aiStages, network.nodeMap, distInKm);
        const fidelityScore = fitnessService.scoreFidelity(routedPoints, state.mode, bestConfig.projectedPoints);
        const overallFitness = Math.round((stageScore.overallFitness * 0.6) + (fidelityScore * 0.4));
        fitness = {
          ...stageScore,
          overallFitness,
          passed: overallFitness >= 70
        };

        setGenerationProgress(prev => ({
          ...prev,
          fitnessScore: fitness?.overallFitness || 0,
          failingStages: fitness?.failingStages?.map(s => s.stageNumber) || []
        }));

        if (fitness.passed) {
          updateState({
            isGenerating: false,
            hasResult: true,
            idealCoords: bestConfig.projectedPoints,
            snappedCoords: routedPoints,
            routeFidelity: fitness.overallFitness,
            distance: validDist,
            textInput: state.textInput,
            nodeMap: network.nodeMap
          }, true);
          break;
        }
        attempt++;
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
        fontStyle={state.fontStyle}
        setFontStyle={(id) => updateState({ fontStyle: id, hasResult: false })}
        drawnPath={state.drawnPath}
        setDrawnPath={(path) => updateState({ drawnPath: path, hasResult: false })}
        setNormalizedDrawnPath={(path) => updateState({ normalizedDrawnPath: path, hasResult: false })}
        expanded={sheetExpanded}
        onModeSelect={(mode) => {
          updateState({ mode, hasResult: false });
          setSheetExpanded(true);
        }}
      />

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
