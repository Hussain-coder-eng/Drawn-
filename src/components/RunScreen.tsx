import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { NavRoute } from '../lib/navigationService';
import { useRunTracker } from '../hooks/useRunTracker';
import { useTurnAlerts } from '../hooks/useTurnAlerts';
import { RunMap } from './RunMap';
import { RunCompleteScreen } from './RunCompleteScreen';
import { cn } from '../lib/utils';
import { Pause, Play, Flag, AlertTriangle, ChevronRight } from 'lucide-react';

interface RunScreenProps {
  navRoute: NavRoute;
  shapeName: string;
  onClose: () => void;
}

export function RunScreen({ navRoute, shapeName, onClose }: RunScreenProps) {
  const [activeAlert, setActiveAlert] = useState<any>(null);
  const [runResult, setRunResult] = useState<any>(null);
  const [showPauseMenu, setShowPauseMenu] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const [countdownActive, setCountdownActive] = useState(true);
  const mapRef = useRef<any>(null);
  const { handleTurnAlert, speakInstruction } = useTurnAlerts();

  const { runState, startRun, pauseRun, resumeRun, finishRun } = useRunTracker({
    navRoute,
    onTurnAlert: (alert) => {
      const alertData = handleTurnAlert(alert);
      if (alertData) {
        setActiveAlert(alertData);
        setTimeout(() => setActiveAlert(null), 6000);
      }
    },
    onRunComplete: (result) => setRunResult(result),
    onPositionUpdate: (state) => {
      if (mapRef.current && state.currentPosition) {
        mapRef.current.setView(
          [state.currentPosition.lat, state.currentPosition.lng],
          17,
          { animate: true, duration: 0.5 }
        );
      }
    }
  });

  useEffect(() => {
    if (!countdownActive) return;
    if (countdownSeconds === 0) {
      setCountdownActive(false);
      startRun();
      speakInstruction(`Starting your ${shapeName} route. ${formatDistance(navRoute.totalDistanceM)} total. Good luck!`);
      return;
    }
    const timer = setTimeout(() => setCountdownSeconds(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdownSeconds, countdownActive, startRun, speakInstruction, shapeName, navRoute.totalDistanceM]);

  useEffect(() => {
    let wakeLock: any = null;
    async function requestWakeLock() {
      if ('wakeLock' in navigator) {
        try {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        } catch (err) {
          console.warn('Wake lock not available:', err);
        }
      }
    }
    requestWakeLock();
    return () => {
      if (wakeLock) wakeLock.release();
    };
  }, []);

  if (runResult) {
    return <RunCompleteScreen result={runResult} shapeName={shapeName} navRoute={navRoute} onClose={onClose} />;
  }

  return (
    <div className="fixed inset-0 z-[5000] bg-bg-primary flex flex-col overflow-hidden touch-none">
      {/* Fullscreen map */}
      <div className="absolute inset-0">
        <RunMap
          navRoute={navRoute}
          runState={runState}
          mapRef={mapRef}
        />
      </div>

      {/* Top HUD — stats bar */}
      {!countdownActive && (
        <div className="absolute top-0 left-0 right-0 p-4 pt-10 bg-gradient-to-b from-bg-primary/80 to-transparent z-[5001]">
          <div className="flex justify-between items-center max-w-md mx-auto">
            <StatPill label="TIME" value={formatElapsedTime(runState.elapsedSeconds)} />
            <StatPill label="DISTANCE" value={formatDistance(runState.completedDistanceM)} />
            <StatPill label="PACE" value={formatPace(runState.currentPaceSecPerKm)} />
          </div>
          
          {/* Progress bar */}
          <div className="mt-4 h-1 bg-white/10 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-accent-primary"
              initial={{ width: 0 }}
              animate={{ width: `${(runState.completedDistanceM / navRoute.totalDistanceM) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Turn alert card */}
      <AnimatePresence>
        {activeAlert && (
          <motion.div 
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="absolute top-24 left-4 right-4 z-[5002]"
          >
            <div className="bg-bg-card/90 backdrop-blur-xl border border-accent-primary/50 rounded-2xl p-4 shadow-2xl flex items-center gap-4">
              <div className="w-12 h-12 bg-accent-primary rounded-xl flex items-center justify-center text-white text-2xl font-bold">
                {getTurnArrow(activeAlert.turnType)}
              </div>
              <div className="flex-1">
                <div className="text-accent-primary text-[12px] font-bold uppercase tracking-widest">In {activeAlert.distanceM}m</div>
                <div className="text-white text-[16px] font-bold leading-tight">{activeAlert.instruction}</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Next turn indicator */}
      {!activeAlert && runState.nextTurn && runState.distanceToNextTurnM !== null && runState.distanceToNextTurnM < 300 && (
        <div className="absolute top-32 left-1/2 -translate-x-1/2 z-[5001] bg-bg-card/60 backdrop-blur-md px-4 py-2 rounded-full border border-divider flex items-center gap-3">
          <span className="text-accent-primary font-bold">{getTurnArrow(runState.nextTurn.turnType)}</span>
          <span className="text-white text-[12px] font-bold uppercase tracking-tight">{runState.nextTurn.turnInstruction}</span>
          <span className="text-text-secondary text-[12px]">{Math.round(runState.distanceToNextTurnM)}m</span>
        </div>
      )}

      {/* Off-route warning */}
      {runState.status === 'off-route' && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[5003] w-full px-6">
          <div className="bg-danger/90 backdrop-blur-xl p-6 rounded-[24px] text-center space-y-2 border border-white/20 shadow-2xl animate-pulse">
            <AlertTriangle className="w-10 h-10 text-white mx-auto" />
            <div className="text-white font-display font-bold text-[24px] uppercase italic">Off Route!</div>
            <p className="text-white/80 text-[14px]">Return to the pink line — {Math.round(runState.offRouteDistanceM)}m away</p>
          </div>
        </div>
      )}

      {/* Bottom HUD */}
      {!countdownActive && (
        <div className="absolute bottom-0 left-0 right-0 p-8 pb-12 bg-gradient-to-t from-bg-primary/90 to-transparent z-[5001]">
          <div className="flex items-end justify-between max-w-md mx-auto">
            <div className="flex flex-col">
              <span className="text-text-secondary text-[11px] font-bold uppercase tracking-widest">Remaining</span>
              <span className="text-white text-[32px] font-display font-bold leading-none italic">
                {formatDistance(runState.remainingDistanceM)}
              </span>
            </div>
            
            <button 
              onClick={() => {
                pauseRun();
                setShowPauseMenu(true);
              }}
              className="w-16 h-16 bg-bg-card border border-divider rounded-full flex items-center justify-center text-white shadow-2xl active:scale-90 transition-transform"
            >
              <Pause className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}

      {/* Countdown overlay */}
      <AnimatePresence>
        {countdownActive && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[5005] bg-bg-primary flex flex-col items-center justify-center text-center p-6"
          >
            <motion.div 
              key={countdownSeconds}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-[120px] font-display font-bold text-accent-primary italic leading-none"
            >
              {countdownSeconds === 0 ? 'GO!' : countdownSeconds}
            </motion.div>
            <p className="text-text-secondary font-bold uppercase tracking-[0.3em] mt-4">
              {countdownSeconds > 0 ? 'Get ready' : 'Run!'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pause menu */}
      <AnimatePresence>
        {showPauseMenu && (
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            className="absolute inset-0 z-[5010] bg-bg-primary/95 backdrop-blur-xl flex flex-col p-8"
          >
            <div className="flex-1 flex flex-col justify-center space-y-12">
              <div className="text-center space-y-2">
                <h2 className="text-[40px] font-display font-bold text-white uppercase italic tracking-tighter">Run <span className="text-accent-primary">Paused</span></h2>
                <p className="text-text-secondary font-medium uppercase tracking-widest text-[11px]">Catch your breath</p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <PauseStat label="DISTANCE" value={formatDistance(runState.completedDistanceM)} />
                <PauseStat label="TIME" value={formatElapsedTime(runState.elapsedSeconds)} />
                <PauseStat label="PACE" value={formatPace(runState.averagePaceSecPerKm)} />
              </div>

              <div className="space-y-4">
                <button 
                  onClick={() => {
                    resumeRun();
                    setShowPauseMenu(false);
                  }}
                  className="w-full h-[72px] bg-accent-primary text-white rounded-[20px] flex items-center justify-center gap-3 text-[20px] font-display font-bold uppercase tracking-widest glow-pink-strong"
                >
                  <Play className="w-6 h-6 fill-current" />
                  Resume Run
                </button>
                <button 
                  onClick={() => finishRun(runState.completedDistanceM)}
                  className="w-full h-[56px] bg-bg-subtle text-text-secondary rounded-[16px] flex items-center justify-center gap-2 text-[14px] font-sans font-bold uppercase tracking-widest hover:text-white transition-colors"
                >
                  <Flag className="w-5 h-5" />
                  Finish Run Early
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatPill({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-text-secondary text-[9px] font-bold uppercase tracking-widest mb-0.5">{label}</span>
      <span className="text-white text-[18px] font-display font-bold leading-none italic">{value}</span>
    </div>
  );
}

function PauseStat({ label, value }: { label: string, value: string }) {
  return (
    <div className="bg-bg-card border border-divider p-4 rounded-2xl flex flex-col items-center justify-center text-center">
      <span className="text-text-secondary text-[10px] font-bold uppercase tracking-widest mb-1">{label}</span>
      <span className="text-white text-[20px] font-display font-bold italic leading-none">{value}</span>
    </div>
  );
}

function getTurnArrow(turnType: string) {
  const arrows: Record<string, string> = {
    'left':        '←',
    'right':       '→',
    'sharp-left':  '↰',
    'sharp-right': '↱',
    'u-turn':      '↩',
    'slight-left': '↖',
    'slight-right':'↗',
    'straight':    '↑'
  };
  return arrows[turnType] ?? '↑';
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

function formatElapsedTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function formatPace(secPerKm: number | null) {
  if (!secPerKm) return '--:--';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
