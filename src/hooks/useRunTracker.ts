import { useState, useRef, useCallback, useEffect } from 'react';
import * as turf from "@turf/turf";
import { NavRoute } from '../lib/navigationService';

export interface RunState {
  status: 'idle' | 'running' | 'paused' | 'complete' | 'off-route' | 'gps-error';
  currentPosition: { lat: number; lng: number; accuracy: number; heading: number | null; speed: number | null; timestamp: number } | null;
  projectedPosition: { lat: number; lng: number } | null;
  completedDistanceM: number;
  remainingDistanceM: number;
  completedPolyline: [number, number][];
  remainingPolyline: [number, number][];
  nextTurn: any | null;
  distanceToNextTurnM: number | null;
  elapsedSeconds: number;
  currentPaceSecPerKm: number | null;
  averagePaceSecPerKm: number | null;
  offRouteDistanceM: number;
  completedRoutePointIndex: number;
  gpsError?: string;
}

interface UseRunTrackerProps {
  navRoute: NavRoute;
  onTurnAlert: (alert: any) => void;
  onRunComplete: (result: any) => void;
  onPositionUpdate: (state: RunState) => void;
}

export function useRunTracker({
  navRoute,
  onTurnAlert,
  onRunComplete,
  onPositionUpdate
}: UseRunTrackerProps) {
  const [runState, setRunState] = useState<RunState>({
    status: 'idle',
    currentPosition: null,
    projectedPosition: null,
    completedDistanceM: 0,
    remainingDistanceM: navRoute.totalDistanceM,
    completedPolyline: [],
    remainingPolyline: navRoute.routePoints.map(p => [p.lng, p.lat]),
    nextTurn: null,
    distanceToNextTurnM: null,
    elapsedSeconds: 0,
    currentPaceSecPerKm: null,
    averagePaceSecPerKm: null,
    offRouteDistanceM: 0,
    completedRoutePointIndex: 0
  });

  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number | null>(null);
  const lastPositionRef = useRef<any>(null);
  const positionHistoryRef = useRef<any[]>([]);

  const finishRun = useCallback((finalDistanceM: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    
    const totalElapsedSeconds = startTimeRef.current ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0;
    const avgPaceSecPerKm = finalDistanceM > 0 ? (totalElapsedSeconds / finalDistanceM) * 1000 : 0;

    const result = {
      totalDistanceM: finalDistanceM,
      elapsedSeconds: totalElapsedSeconds,
      avgPaceSecPerKm,
      completedPolyline: runState.completedPolyline
    };

    setRunState(prev => ({ ...prev, status: 'complete' }));
    onRunComplete(result);
  }, [runState.completedPolyline, onRunComplete]);

  const handlePositionUpdate = useCallback((geoPosition: GeolocationPosition) => {
    const rawPosition = {
      lat: geoPosition.coords.latitude,
      lng: geoPosition.coords.longitude,
      accuracy: geoPosition.coords.accuracy,
      heading: geoPosition.coords.heading,
      speed: geoPosition.coords.speed,
      timestamp: geoPosition.timestamp
    };

    positionHistoryRef.current.push(rawPosition);
    if (positionHistoryRef.current.length > 5) {
      positionHistoryRef.current.shift();
    }
    
    const smoothedPosition = smoothGPSPosition(positionHistoryRef.current);
    if (typeof smoothedPosition.lat !== 'number' || typeof smoothedPosition.lng !== 'number' || isNaN(smoothedPosition.lat) || isNaN(smoothedPosition.lng)) {
      return;
    }
    const userPoint = turf.point([smoothedPosition.lng, smoothedPosition.lat]);
    const snapped = turf.nearestPointOnLine(
      navRoute.routeLineString,
      userPoint,
      { units: 'meters' }
    );

    const offRouteDistanceM = snapped.properties.dist || 0;
    const projectedCoord = snapped.geometry.coordinates as [number, number];
    const completedDistanceM = snapped.properties.location || 0;

    const isOffRoute = offRouteDistanceM > 30;
    const completedIndex = findRoutePointIndex(navRoute.routePoints, completedDistanceM);

    const completedPolyline = buildCompletedPolyline(navRoute.routePoints, completedIndex, projectedCoord);
    const remainingPolyline = buildRemainingPolyline(navRoute.routePoints, completedIndex, projectedCoord);

    const nextTurn = navRoute.turnPoints.find(
      t => t.cumulativeDistanceM > completedDistanceM && !t.alertTriggeredAt
    ) ?? null;

    const distanceToNextTurnM = nextTurn ? nextTurn.cumulativeDistanceM - completedDistanceM : null;

    if (nextTurn && distanceToNextTurnM !== null && distanceToNextTurnM <= nextTurn.alertDistanceM && !nextTurn.alertTriggeredAt) {
      nextTurn.alertTriggeredAt = true;
      onTurnAlert({
        turn: nextTurn,
        distanceM: distanceToNextTurnM,
        instruction: nextTurn.turnInstruction
      });
    }

    const currentPaceSecPerKm = calculateCurrentPace(lastPositionRef.current, smoothedPosition);
    
    const startPoint = navRoute.startPoint;
    const distanceFromStartM = (typeof startPoint.lat === 'number' && typeof startPoint.lng === 'number' && !isNaN(startPoint.lat) && !isNaN(startPoint.lng))
      ? turf.distance(
          userPoint,
          turf.point([startPoint.lng, startPoint.lat]),
          { units: 'meters' }
        )
      : Infinity;
    const routeCompletionPct = completedDistanceM / navRoute.totalDistanceM;

    if (distanceFromStartM < 30 && routeCompletionPct > 0.8) {
      finishRun(completedDistanceM);
      return;
    }

    lastPositionRef.current = smoothedPosition;

    const newRunState: Partial<RunState> = {
      status: isOffRoute ? 'off-route' : 'running',
      currentPosition: smoothedPosition,
      projectedPosition: { lat: projectedCoord[1], lng: projectedCoord[0] },
      completedDistanceM,
      remainingDistanceM: navRoute.totalDistanceM - completedDistanceM,
      completedPolyline,
      remainingPolyline,
      nextTurn,
      distanceToNextTurnM,
      offRouteDistanceM,
      currentPaceSecPerKm,
      completedRoutePointIndex: completedIndex
    };

    setRunState(prev => {
      const updated = { ...prev, ...newRunState };
      onPositionUpdate(updated as RunState);
      return updated;
    });
  }, [navRoute, onTurnAlert, finishRun, onPositionUpdate]);

  const handleGeolocationError = useCallback((error: GeolocationPositionError) => {
    console.error('Geolocation error:', error);
    setRunState(prev => ({ ...prev, status: 'gps-error', gpsError: error.message }));
  }, []);

  const startRun = useCallback(() => {
    startTimeRef.current = Date.now();
    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePositionUpdate,
      handleGeolocationError,
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000
      }
    );

    timerRef.current = setInterval(() => {
      setRunState(prev => ({
        ...prev,
        elapsedSeconds: startTimeRef.current ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0
      }));
    }, 1000);

    setRunState(prev => ({ ...prev, status: 'running' }));
  }, [handlePositionUpdate, handleGeolocationError]);

  const pauseRun = useCallback(() => {
    setRunState(prev => ({ ...prev, status: 'paused' }));
  }, []);

  const resumeRun = useCallback(() => {
    setRunState(prev => ({ ...prev, status: 'running' }));
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  return { runState, startRun, pauseRun, resumeRun, finishRun };
}

function smoothGPSPosition(history: any[]) {
  if (history.length === 1) return history[0];
  const weights = [1, 1, 2, 3, 5].slice(-history.length);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const smoothLat = history.reduce((sum, pos, i) => sum + pos.lat * weights[i], 0) / totalWeight;
  const smoothLng = history.reduce((sum, pos, i) => sum + pos.lng * weights[i], 0) / totalWeight;
  return { ...history[history.length - 1], lat: smoothLat, lng: smoothLng };
}

function findRoutePointIndex(routePoints: any[], targetDistanceM: number) {
  let lo = 0, hi = routePoints.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (routePoints[mid].cumulativeDistanceM < targetDistanceM) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildCompletedPolyline(routePoints: any[], upToIndex: number, projectedCoord: [number, number]): [number, number][] {
  const coords: [number, number][] = routePoints
    .slice(0, upToIndex + 1)
    .map(p => [p.lng, p.lat] as [number, number]);
  coords.push(projectedCoord);
  return coords;
}

function buildRemainingPolyline(routePoints: any[], fromIndex: number, projectedCoord: [number, number]): [number, number][] {
  const coords: [number, number][] = [projectedCoord];
  coords.push(...routePoints.slice(fromIndex + 1).map(p => [p.lng, p.lat] as [number, number]));
  return coords;
}

function calculateCurrentPace(prevPos: any, currentPos: any) {
  if (!prevPos || !currentPos) return null;
  if (typeof prevPos.lat !== 'number' || typeof prevPos.lng !== 'number' || isNaN(prevPos.lat) || isNaN(prevPos.lng) ||
      typeof currentPos.lat !== 'number' || typeof currentPos.lng !== 'number' || isNaN(currentPos.lat) || isNaN(currentPos.lng)) {
    return null;
  }
  const prevCoords: [number, number] = [prevPos.lng, prevPos.lat];
  const currCoords: [number, number] = [currentPos.lng, currentPos.lat];
  const distM = turf.distance(
    turf.point(prevCoords),
    turf.point(currCoords),
    { units: 'kilometers' }
  ) * 1000;
  const elapsedSec = (currentPos.timestamp - prevPos.timestamp) / 1000;
  if (distM < 1 || elapsedSec < 0.5) return null;
  const paceSecPerKm = (elapsedSec / distM) * 1000;
  return paceSecPerKm >= 120 && paceSecPerKm <= 900 ? paceSecPerKm : null;
}
