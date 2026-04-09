import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Wand2, Undo2, Redo2, History, Bookmark, Trash2, Map as MapIcon, LogIn, LogOut, User as UserIcon, Download, Search, Filter, ChevronRight, Settings, Activity as ActivityIcon, Trophy, MapPin, Navigation } from "lucide-react";
import Header from "./components/Header";
import DesignInput from "./components/DesignInput";
import RouteSettings from "./components/RouteSettings";
import ResultCard from "./components/ResultCard";
import MapComponent from "./components/MapComponent";
import GenerationProgress from "./components/GenerationProgress";
import BottomNav from "./components/BottomNav";
import { InputMode, DrawnState } from "./types";
import { cn } from "./lib/utils";
import { SHAPES, COLORS } from "./constants";

// Firebase imports
import { auth, db, googleProvider } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
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
  getDoc,
  getDocFromServer,
  Timestamp
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
  generateCircle, 
  generateHeart, 
  generateStar, 
  generateSquare,
  generateInfinity, 
  generateArrow,
  generateLightning,
  generateText,
  scaleAndCenter
} from "./lib/shapeMath";
import { downloadGPX } from "./lib/gpxExport";
import { validateDistance, validateText } from "./lib/validation";

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
  const [activeTab, setActiveTab] = useState("create");

  const [state, setState] = useState<DrawnState>({
    mode: "shapes",
    selectedShape: "heart",
    textInput: "",
    fontStyle: "stencil",
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
  });

  const [history, setHistory] = useState<DrawnState[]>([]);
  const [redoStack, setRedoStack] = useState<DrawnState[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [isMobile, setIsMobile] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [currentScriptStages, setCurrentScriptStages] = useState<number>(0);
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

  // Connection test for Firestore
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
          setError("Firestore is offline. Please check your internet connection or Firebase setup.");
        }
      }
    }
    if (isAuthReady) {
      testConnection();
    }
  }, [isAuthReady]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const login = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Login failed:", error);
      setError("Login failed. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setActiveTab("create");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  useEffect(() => {
    if (userLocation.lat !== 0 && userLocation.lng !== 0 && isAuthReady) {
      const distInKm = state.unit === "mi" ? state.distance * 1.60934 : state.distance;
      const radiusMeters = overpassService.calculateRadius(distInKm);
      
      const timer = setTimeout(() => {
        overpassService.fetchRoadNetwork(userLocation, radiusMeters).catch(() => {});
      }, 2000); // Wait 2s after changes to avoid spamming
      
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
    if (!user || !isAuthReady) {
      setError("Please sign in with Google to generate a route.");
      return;
    }

    const now = Date.now();
    if (now - lastGenerationTime.current < 5000) {
      setError("Please wait a few seconds before generating again.");
      return;
    }

    setError(null);
    updateState({ isGenerating: true }, false);
    setGenerationProgress({ attempt: 0, maxAttempts: 3, fitnessScore: null, failingStages: [] });

    try {
      console.log("[DEBUG] handleGenerate started", { mode: state.mode, distance: state.distance, unit: state.unit });
      setLoadingMessage("Fetching local road network...");

      await osrmLimiter.check();
      
      const validDist = validateDistance(state.distance);
      const distInKm = state.unit === "mi" ? validDist * 1.60934 : validDist;
      const radiusMeters = overpassService.calculateRadius(distInKm);

      console.log("[DEBUG] Fetching road network...", { userLocation, radiusMeters });
      const network = await overpassService.fetchRoadNetwork(userLocation, radiusMeters, (msg) => {
        setLoadingMessage(msg);
      });
      console.log("[DEBUG] Road network fetched", { nodeCount: network.nodes.length });
      if (network.nodes.length < 20) {
        throw new Error("Not enough roads found in this area. Try a larger distance.");
      }

      let script;
      const validText = validateText(state.textInput);
      if (state.mode === "shapes") {
        script = SHAPE_SCRIPTS[state.selectedShape || "circle"] || SHAPE_SCRIPTS["circle"];
      } else if (state.mode === "text" && validText) {
        const chars = validText.split("");
        const letterScripts = chars.map(char => getLetterScript(char)).filter(s => !!s);
        const missingChars = chars.filter(char => !getLetterScript(char) && char !== " ");
        
        if (missingChars.length > 0) {
          throw new Error(`Could not find scripts for: ${Array.from(new Set(missingChars)).join(", ")}`);
        }
        
        if (letterScripts.length === 0) throw new Error("Please enter some letters to generate a route.");
        script = { name: validText, stages: chainScripts(letterScripts as any) };
      } else if (state.mode === "draw") {
        if (state.drawnPath.length < 2) {
          throw new Error("Please draw a shape on the canvas first.");
        }
        script = { 
          name: "Custom Drawing", 
          stages: generateScriptFromPath(state.drawnPath) 
        };
      } else {
        throw new Error("Invalid generation mode.");
      }
      
      if (!script || !script.stages) {
        throw new Error(`Could not find a directional script for ${state.selectedShape}.`);
      }
      
      setCurrentScriptStages(script.stages.length);

      // Generate ideal anchor points to help sample the best nodes
      let idealAnchors: Point[] = [];
      if (state.mode === "shapes") {
        switch (state.selectedShape) {
          case "heart": idealAnchors = generateHeart(userLocation, distInKm); break;
          case "circle": idealAnchors = generateCircle(userLocation, distInKm); break;
          case "square": idealAnchors = generateSquare(userLocation, distInKm); break;
          case "star": idealAnchors = generateStar(userLocation, distInKm); break;
          case "arrow": idealAnchors = generateArrow(userLocation, distInKm); break;
          case "lightning": idealAnchors = generateLightning(userLocation, distInKm); break;
        }
      } else if (state.mode === "text" && validText) {
        idealAnchors = generateText(validText, userLocation, distInKm);
      } else if (state.mode === "draw") {
        idealAnchors = state.drawnPath;
      }

      const startNode = overpassService.getRelevantNodes(network.nodes, [userLocation], 1)[0];
      // Sample 250 nodes prioritized by proximity to the ideal shape path (Pre-Filtering)
      const sampledNodes = overpassService.getRelevantNodes(network.nodes, idealAnchors, 250);
      console.log("[DEBUG] Nodes sampled for AI", { sampledCount: sampledNodes.length, startNodeId: startNode.id });

      let attempt = 1;
      let result: GeminiStagedResult | null = null;
      let fitness: RouteFitness | null = null;
      const maxAttempts = 3;

      while (attempt <= maxAttempts) {
        setGenerationProgress(prev => ({ ...prev, attempt }));
        setLoadingMessage(`Planning your ${script.name} — attempt ${attempt} of ${maxAttempts}...`);

        if (attempt === 1) {
          console.log("[DEBUG] Calling Gemini selectNodesStaged (Attempt 1)");
          result = await geminiService.selectNodesStaged(
            sampledNodes,
            script.stages,
            script.name,
            distInKm,
            startNode.id,
            (msg) => setLoadingMessage(msg)
          );
        } else if (result && fitness) {
          console.log("[DEBUG] Calling Gemini rerouteFailingStages", { attempt, failingStages: fitness.failingStages?.map(s => s.stageNumber) || [] });
          setLoadingMessage(`Stage ${fitness.failingStages[0]?.stageNumber} needs work — retrying...`);
          result = await geminiService.rerouteFailingStages(
            result,
            fitness,
            sampledNodes,
            script.stages,
            distInKm,
            script.name,
            (msg) => setLoadingMessage(msg)
          );
        }

        if (!result || !result.stages) {
          console.error("[DEBUG] AI failed to generate a valid result structure", result);
          throw new Error("AI failed to generate a valid route structure.");
        }

        console.log("[DEBUG] AI result received", { stageCount: result.stages.length });
        fitness = fitnessService.scoreRoute(result.stages, script.stages, network.nodeMap, distInKm);
        
        if (!fitness || !fitness.failingStages) {
          console.error("[DEBUG] Fitness service failed to return valid scores", fitness);
          throw new Error("Failed to evaluate route quality.");
        }

        console.log("[DEBUG] Fitness score", { score: fitness.overallFitness, passing: fitness.overallFitness >= 90 });
        setGenerationProgress(prev => ({ 
          ...prev, 
          fitnessScore: fitness?.overallFitness || 0,
          failingStages: fitness?.failingStages?.map(s => s.stageNumber) || []
        }));

        if (fitness.passed) break;
        attempt++;
      }

      if (!result || !fitness) throw new Error("Route generation failed.");

      setLoadingMessage("Connecting streets...");
      
      const allSelectedNodeIds = result.stages.flatMap(s => s.nodeIds || []);
      const uniqueNodeIds = allSelectedNodeIds.filter((id, i, arr) => i === 0 || id !== arr[i-1]);
      
      const resolvedNodes = uniqueNodeIds
        .map(id => network.nodeMap.get(id))
        .filter((n): n is OSMNode => !!n)
        .map(n => ({ lat: n.lat, lng: n.lng }));

      console.log("[DEBUG] Connecting nodes with OSRM...", { nodeCount: resolvedNodes.length });

      const routedPoints = await routingService.connectNodesWithOSRM(resolvedNodes);
      console.log("[DEBUG] OSRM routing complete", { coordinateCount: routedPoints.length });

      let ideal: Point[] = [];
      if (state.mode === "shapes") {
        switch (state.selectedShape) {
          case "heart": ideal = generateHeart(userLocation, distInKm); break;
          case "star": ideal = generateStar(userLocation, distInKm); break;
          case "infinity": ideal = generateInfinity(userLocation, distInKm); break;
          default: ideal = generateCircle(userLocation, distInKm);
        }
      } else if (state.mode === "text" && validText) {
        ideal = generateText(validText, userLocation, distInKm);
      }

      updateState({
        isGenerating: false,
        hasResult: true,
        idealCoords: ideal,
        snappedCoords: routedPoints,
        routeFidelity: fitness.overallFitness,
        distance: validDist,
        textInput: validText
      }, true);

      lastGenerationTime.current = Date.now();
      if (isMobile) setIsSheetOpen(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred.");
      updateState({ isGenerating: false }, false);
    } finally {
      setLoadingMessage("");
    }
  };

  const saveRoute = async () => {
    if (!user) return;
    try {
      const routeData = {
        ...state,
        uid: user.uid,
        timestamp: Date.now(),
        label: state.mode === "shapes" ? (SHAPES.find(s => s.id === state.selectedShape)?.label || "Shape") : (state.textInput || "Custom"),
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
    setActiveTab("create");
    if (isMobile) setIsSheetOpen(true);
  };

  const handleExportGPX = () => {
    const label = state.mode === "shapes" ? (SHAPES.find(s => s.id === state.selectedShape)?.label || "Shape") : (state.textInput || "Custom");
    downloadGPX(state.snappedCoords, `Drawn - ${label}`);
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
      return generateText(validText, userLocation, distInKm);
    } else if (state.mode === "draw" && state.drawnPath.length > 0) {
      return state.drawnPath;
    }
    return [];
  }, [state.mode, state.selectedShape, state.textInput, state.drawnPath, state.distance, state.unit, state.hasResult, state.idealCoords, userLocation]);

  const selectedShapeLabel = SHAPES.find(s => s.id === state.selectedShape)?.label || "Custom";

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-bg-primary overflow-hidden font-sans">
      {/* Sidebar (Desktop) / Bottom Sheet (Mobile) */}
      <motion.div 
        className={cn(
          "z-[2000] bg-bg-primary border-divider transition-all duration-500 flex flex-col",
          isMobile 
            ? "fixed bottom-0 left-0 right-0 rounded-t-[32px] shadow-[0_-20px_40px_rgba(0,0,0,0.8)] border-t" 
            : "w-[380px] lg:w-[420px] border-r"
        )}
        animate={isMobile ? { height: isSheetOpen ? "88vh" : "100px" } : { height: "100vh" }}
      >
        {isMobile && (
          <div 
            className="w-full flex justify-center py-4 cursor-pointer"
            onClick={() => setIsSheetOpen(!isSheetOpen)}
          >
            <div className="w-12 h-1.5 bg-divider rounded-full" />
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-24 md:pb-8">
          <div className="flex justify-between items-center mb-8">
            <Header />
            {!user && (
              <button
                onClick={login}
                disabled={isLoggingIn}
                className="px-4 py-2 rounded-full bg-accent-primary text-white text-[12px] font-bold uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50 glow-pink"
              >
                {isLoggingIn ? "..." : "Login"}
              </button>
            )}
          </div>

          <AnimatePresence mode="wait">
            {activeTab === "create" && (
              <motion.div
                key="create"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                {state.isGenerating ? (
                  <GenerationProgress 
                    attempt={generationProgress.attempt}
                    maxAttempts={generationProgress.maxAttempts}
                    fitnessScore={generationProgress.fitnessScore}
                    failingStages={generationProgress.failingStages}
                    totalStages={currentScriptStages}
                    message={loadingMessage}
                  />
                ) : state.hasResult ? (
                  <ResultCard 
                    distance={state.distance}
                    unit={state.unit}
                    shapeLabel={selectedShapeLabel}
                    fidelity={state.routeFidelity}
                    onRegenerate={handleGenerate}
                    failingStages={generationProgress.failingStages}
                  />
                ) : (
                  <>
                    <DesignInput 
                      mode={state.mode}
                      setMode={(mode) => updateState({ mode })}
                      selectedShape={state.selectedShape}
                      setSelectedShape={(id) => updateState({ selectedShape: id })}
                      textInput={state.textInput}
                      setTextInput={(text) => updateState({ textInput: text })}
                      fontStyle={state.fontStyle}
                      setFontStyle={(id) => updateState({ fontStyle: id })}
                      drawnPath={state.drawnPath}
                      setDrawnPath={(path) => updateState({ drawnPath: path })}
                    />

                    <RouteSettings 
                      distance={state.distance}
                      setDistance={(d) => updateState({ distance: d })}
                      unit={state.unit}
                      setUnit={(u) => updateState({ unit: u })}
                      location={state.location}
                      setLocation={(l) => updateState({ location: l })}
                      surface={state.surface}
                      setSurface={(s) => updateState({ surface: s })}
                    />

                    <div className="space-y-4 pt-4">
                      {error && (
                        <div className="p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-[12px] font-medium">
                          {error}
                        </div>
                      )}
                      <button
                        onClick={handleGenerate}
                        disabled={state.isGenerating}
                        className="w-full h-[64px] bg-gradient-to-r from-accent-primary to-accent-secondary hover:opacity-90 active:scale-[0.98] transition-all rounded-[16px] flex items-center justify-center gap-3 text-white text-[18px] font-display font-bold uppercase tracking-widest group relative overflow-hidden disabled:opacity-50 glow-pink-strong"
                      >
                        <Wand2 className="w-6 h-6 group-hover:rotate-12 transition-transform" />
                        Generate Route
                      </button>
                      <p className="text-[11px] text-text-muted text-center italic font-sans">
                        Snapped to real roads only.
                      </p>
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {activeTab === "routes" && (
              <motion.div
                key="routes"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-[20px] font-display font-bold text-white uppercase tracking-tight">My Routes</h2>
                  <div className="flex gap-2">
                    <button className="p-2 bg-bg-subtle rounded-lg text-text-secondary"><Search className="w-4 h-4" /></button>
                    <button className="p-2 bg-bg-subtle rounded-lg text-text-secondary"><Filter className="w-4 h-4" /></button>
                  </div>
                </div>

                {savedRoutes.length === 0 ? (
                  <div className="py-20 text-center space-y-4">
                    <div className="w-16 h-16 bg-bg-subtle rounded-full flex items-center justify-center mx-auto">
                      <Bookmark className="w-8 h-8 text-text-muted" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-white font-bold">No saved routes</p>
                      <p className="text-text-secondary text-sm">Your GPS art masterpieces will appear here.</p>
                    </div>
                    <button onClick={() => setActiveTab("create")} className="text-accent-primary font-bold uppercase tracking-widest text-xs">Create your first route</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {savedRoutes.map((route) => (
                      <div 
                        key={route.id}
                        className="group bg-bg-card border border-divider rounded-[16px] p-4 flex items-center justify-between hover:border-accent-primary/50 transition-all cursor-pointer"
                        onClick={() => loadSavedRoute(route)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-bg-subtle rounded-[12px] flex items-center justify-center">
                            <MapIcon className="w-6 h-6 text-accent-primary" />
                          </div>
                          <div>
                            <p className="text-[16px] font-display font-bold text-white uppercase">{route.label}</p>
                            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                              <span>{route.distance.toFixed(1)} {route.unit}</span>
                              <span className="w-1 h-1 bg-text-muted rounded-full" />
                              <span>{new Date(route.timestamp).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="px-2 py-1 rounded-full bg-success/10 border border-success/20 text-success text-[10px] font-bold">
                            {route.routeFidelity}%
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSavedRoute(route.id);
                            }}
                            className="p-2 text-text-muted hover:text-danger transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <ChevronRight className="w-5 h-5 text-text-muted group-hover:text-white transition-colors" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "activity" && (
              <motion.div
                key="activity"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-[20px] font-display font-bold text-white uppercase tracking-tight">Global Masterpieces</h2>
                  <div className="px-3 py-1 bg-accent-primary/10 border border-accent-primary/20 rounded-full">
                    <span className="text-[10px] font-bold text-accent-primary uppercase tracking-wider">Live Feed</span>
                  </div>
                </div>

                <div className="space-y-4">
                  {[
                    { user: "Sarah J.", shape: "Heart", loc: "London, UK", dist: "5.2 km", time: "2h ago", avatar: "https://picsum.photos/seed/sarah/100/100" },
                    { user: "Mike R.", shape: "Star", loc: "New York, US", dist: "8.1 mi", time: "4h ago", avatar: "https://picsum.photos/seed/mike/100/100" },
                    { user: "Elena K.", shape: "Infinity", loc: "Berlin, DE", dist: "12.4 km", time: "6h ago", avatar: "https://picsum.photos/seed/elena/100/100" },
                  ].map((item, i) => (
                    <div key={i} className="bg-bg-card border border-divider rounded-[20px] p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <img src={item.avatar} alt={item.user} className="w-8 h-8 rounded-full border border-divider" referrerPolicy="no-referrer" />
                          <div>
                            <p className="text-[14px] font-bold text-white">{item.user}</p>
                            <p className="text-[10px] text-text-secondary uppercase tracking-wider">{item.time}</p>
                          </div>
                        </div>
                        <button className="p-2 text-text-muted hover:text-white transition-colors">
                          <Bookmark className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="aspect-[16/9] bg-bg-subtle rounded-[12px] overflow-hidden relative group cursor-pointer">
                        <img 
                          src={`https://picsum.photos/seed/${item.user}/800/450?blur=2`} 
                          alt="Route Map" 
                          className="w-full h-full object-cover opacity-50 group-hover:scale-105 transition-transform duration-700"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-12 h-12 rounded-full bg-accent-primary/20 border border-accent-primary/40 flex items-center justify-center backdrop-blur-sm">
                            <MapIcon className="w-6 h-6 text-accent-primary" />
                          </div>
                        </div>
                        <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                          <div className="bg-bg-primary/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-divider">
                            <p className="text-[12px] font-display font-bold text-white uppercase">{item.shape} in {item.loc}</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <div className="flex gap-4">
                          <div className="flex items-center gap-1.5">
                            <Trophy className="w-4 h-4 text-warning" />
                            <span className="text-[12px] font-bold text-white">94%</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-text-secondary">
                            <Navigation className="w-4 h-4" />
                            <span className="text-[12px]">{item.dist}</span>
                          </div>
                        </div>
                        <button className="text-[11px] font-bold text-accent-primary uppercase tracking-widest hover:underline">View Route</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="py-10 text-center">
                  <p className="text-text-secondary text-sm">Connect with other runners soon.</p>
                </div>
              </motion.div>
            )}

            {activeTab === "profile" && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="relative">
                    {user?.photoURL ? (
                      <img src={user.photoURL} alt="Profile" className="w-24 h-24 rounded-full border-2 border-accent-primary p-1" />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-bg-subtle flex items-center justify-center border-2 border-divider">
                        <UserIcon className="w-10 h-10 text-text-muted" />
                      </div>
                    )}
                    <div className="absolute bottom-0 right-0 bg-accent-primary p-1.5 rounded-full border-4 border-bg-primary">
                      <Trophy className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  <div>
                    <h2 className="text-[24px] font-display font-bold text-white uppercase">{user?.displayName || "Athlete"}</h2>
                    <p className="text-text-secondary text-sm">Level 12 Runner</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-bg-card p-4 rounded-[16px] border border-divider text-center">
                    <p className="text-[20px] font-display font-bold text-white leading-none">{savedRoutes.length}</p>
                    <p className="text-[10px] text-text-secondary uppercase mt-1">Routes</p>
                  </div>
                  <div className="bg-bg-card p-4 rounded-[16px] border border-divider text-center">
                    <p className="text-[20px] font-display font-bold text-white leading-none">142</p>
                    <p className="text-[10px] text-text-secondary uppercase mt-1">Miles</p>
                  </div>
                  <div className="bg-bg-card p-4 rounded-[16px] border border-divider text-center">
                    <p className="text-[20px] font-display font-bold text-white leading-none">88%</p>
                    <p className="text-[10px] text-text-secondary uppercase mt-1">Avg Score</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <button className="w-full flex items-center justify-between p-4 bg-bg-card rounded-[16px] border border-divider hover:bg-bg-subtle transition-colors">
                    <div className="flex items-center gap-3">
                      <Settings className="w-5 h-5 text-text-secondary" />
                      <span className="text-white font-medium">Settings</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-text-muted" />
                  </button>
                  <button 
                    onClick={logout}
                    className="w-full flex items-center justify-between p-4 bg-bg-card rounded-[16px] border border-divider hover:bg-bg-subtle transition-colors text-danger"
                  >
                    <div className="flex items-center gap-3">
                      <LogOut className="w-5 h-5" />
                      <span className="font-medium">Logout</span>
                    </div>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Map Area */}
      <div className="flex-1 relative h-full">
        <MapComponent 
          mode={state.mode}
          idealCoords={previewIdealCoords}
          snappedCoords={state.snappedCoords}
          isGenerating={state.isGenerating}
          hasResult={state.hasResult}
          center={userLocation}
        />
        
        {/* Map Overlays */}
        <div className="absolute top-6 left-6 z-[1000] hidden md:block">
          <div className="bg-bg-card/80 backdrop-blur-md border border-divider rounded-full px-4 py-2 flex items-center gap-3 shadow-2xl">
            <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse" />
            <span className="text-[12px] font-sans font-medium text-white uppercase tracking-widest">Live in {state.location || "Your Area"}</span>
          </div>
        </div>
      </div>

      {/* Bottom Navigation (Mobile) */}
      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}
