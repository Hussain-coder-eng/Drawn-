import { useState, useCallback, useRef } from 'react';
import * as turf from '@turf/turf';
import { Point, NormalizedPoint } from '../lib/shapeMath';

interface Waypoint extends Point {
  nodeId: string;
  isLocked?: boolean;
  stageIndex?: number;
  letterIndex?: number;
  wasNudged?: boolean;
}

interface UseNudgeInterfaceProps {
  inputType: string;
  initialWaypoints: Waypoint[];
  originalShape: NormalizedPoint[];
  osmNodes: Map<string, Point>;
  distanceKm: number;
  centerLat: number;
  centerLng: number;
  onRouteChange: (data: { waypoints: Waypoint[], updatedSegment?: any }) => void;
}

export function useNudgeInterface({
  inputType,
  initialWaypoints,
  originalShape,
  osmNodes,
  distanceKm,
  centerLat,
  centerLng,
  onRouteChange
}: UseNudgeInterfaceProps) {
  const [waypoints, setWaypoints] = useState<Waypoint[]>(initialWaypoints);
  const [fitnessScore, setFitnessScore] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedWaypointIndex, setSelectedWaypointIndex] = useState<number | null>(null);
  const [highlightedLetter, setHighlightedLetter] = useState<number | null>(null);

  const snapToNearestNode = useCallback((lat: number, lng: number, maxDistanceM = 50) => {
    let nearestNodeId: string | null = null;
    let nearestDist = maxDistanceM;

    for (const [nodeId, node] of osmNodes.entries()) {
      const dist = turf.distance(
        turf.point([lng, lat]),
        turf.point([node.lng, node.lat]),
        { units: 'meters' }
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestNodeId = nodeId;
      }
    }

    if (!nearestNodeId) return null;

    const node = osmNodes.get(nearestNodeId)!;
    return {
      nodeId: nearestNodeId,
      lat: node.lat,
      lng: node.lng,
      snapDistanceM: nearestDist
    };
  }, [osmNodes]);

  const recalculateFitness = useCallback((currentWaypoints: Waypoint[], originalShape: NormalizedPoint[], inputType: string) => {
    if (currentWaypoints.length < 2) return 0;
    const routeLine = turf.lineString(currentWaypoints.map(w => [w.lng, w.lat]));

    const radiusKm = (distanceKm / (2 * Math.PI)) * 1.5;
    const idealPoints = originalShape.map(p => ({
      lat: centerLat + (0.5 - p.y) * radiusKm * 2 / 111.32,
      lng: centerLng + (p.x - 0.5) * radiusKm * 2 / (111.32 * Math.cos(centerLat * Math.PI / 180))
    }));

    const deviations = idealPoints.map(idealPt => {
      const pt = turf.point([idealPt.lng, idealPt.lat]);
      const snapped = turf.nearestPointOnLine(routeLine, pt, { units: 'meters' });
      return snapped.properties.dist || 0;
    });

    const avgDeviationM = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const maxAcceptableDeviationM = distanceKm * 1000 * 0.05;

    return Math.max(0, Math.round(100 - (avgDeviationM / maxAcceptableDeviationM) * 100));
  }, [distanceKm, centerLat, centerLng]);

  const handleWaypointDrag = useCallback(async (waypointIndex: number, newLat: number, newLng: number) => {
    const waypoint = waypoints[waypointIndex];
    const snapped = snapToNearestNode(newLat, newLng, 50);
    if (!snapped) return;

    if (inputType === 'text' && waypoint.letterIndex !== undefined) {
      setHighlightedLetter(waypoint.letterIndex);
    }

    const newWaypoints = waypoints.map((wp, i) => {
      if (i !== waypointIndex) return wp;
      return {
        ...wp,
        lat: snapped.lat,
        lng: snapped.lng,
        nodeId: snapped.nodeId,
        wasNudged: true
      };
    });

    setWaypoints(newWaypoints);

    const prevWaypoint = newWaypoints[Math.max(0, waypointIndex - 1)];
    const nextWaypoint = newWaypoints[Math.min(newWaypoints.length - 1, waypointIndex + 1)];

    try {
      const coordStr = [prevWaypoint, newWaypoints[waypointIndex], nextWaypoint]
        .map(w => `${w.lng},${w.lat}`)
        .join(';');

      const response = await fetch(
        `https://router.project-osrm.org/route/v1/foot/${coordStr}?overview=full&geometries=geojson`
      );
      const data = await response.json();

      if (data.code === 'Ok') {
        onRouteChange({
          waypoints: newWaypoints,
          updatedSegment: {
            fromIndex: waypointIndex - 1,
            toIndex: waypointIndex + 1,
            newCoords: data.routes[0].geometry.coordinates
          }
        });

        const newScore = recalculateFitness(newWaypoints, originalShape, inputType);
        setFitnessScore(newScore);
      }
    } catch (err) {
      console.error('OSRM re-route failed after nudge:', err);
    }
  }, [waypoints, inputType, originalShape, onRouteChange, snapToNearestNode, recalculateFitness]);

  const interpolateColor = (colorA: string, colorB: string, t: number) => {
    const parseHex = (hex: string) => ({
      r: parseInt(hex.slice(1,3), 16),
      g: parseInt(hex.slice(3,5), 16),
      b: parseInt(hex.slice(5,7), 16)
    });
    const a = parseHex(colorA);
    const b = parseHex(colorB);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bv = Math.round(a.b + (b.b - a.b) * t);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${bv.toString(16).padStart(2,'0')}`;
  };

  const computeSegmentAccuracy = useCallback((currentWaypoints: Waypoint[], originalShape: NormalizedPoint[]) => {
    if (currentWaypoints.length < 2) return [];
    const routeLine = turf.lineString(currentWaypoints.map(w => [w.lng, w.lat]));
    const radiusKm = (distanceKm / (2 * Math.PI)) * 1.5;

    return originalShape.map((p, i) => {
      if (i === originalShape.length - 1) return null;
      const idealPt = {
        lat: centerLat + (0.5 - p.y) * radiusKm * 2 / 111.32,
        lng: centerLng + (p.x - 0.5) * radiusKm * 2 / (111.32 * Math.cos(centerLat * Math.PI / 180))
      };
      const snapped = turf.nearestPointOnLine(
        routeLine,
        turf.point([idealPt.lng, idealPt.lat]),
        { units: 'meters' }
      );
      const devM = snapped.properties.dist || 0;
      const t = Math.min(devM / 100, 1);
      return {
        segmentIndex: i,
        deviationM: devM,
        color: interpolateColor('#00C896', '#FF4444', t)
      };
    }).filter((s): s is any => s !== null);
  }, [distanceKm, centerLat, centerLng]);

  return {
    waypoints,
    fitnessScore,
    isDragging,
    selectedWaypointIndex,
    highlightedLetter,
    handleWaypointDrag,
    snapToNearestNode,
    segmentAccuracy: computeSegmentAccuracy(waypoints, originalShape),
    setSelectedWaypointIndex,
    setIsDragging,
    getNudgeConstraints: (waypoint: Waypoint, allWaypoints: Waypoint[], letterBoundaries?: any[]) => {
      if (inputType === 'premade') {
        return {
          maxDragDistanceM: 100,
          snapRadiusM: 50,
          canDragLocked: true,
          constraint: null
        };
      }

      if (inputType === 'text') {
        const letter = letterBoundaries?.find(b =>
          (waypoint.stageIndex || 0) >= b.startIndex &&
          (waypoint.stageIndex || 0) <= b.endIndex
        );

        const letterWaypoints = allWaypoints.filter(w => w.letterIndex === letter?.letterIndex);
        const minLng = Math.min(...letterWaypoints.map(w => w.lng)) - 0.001;
        const maxLng = Math.max(...letterWaypoints.map(w => w.lng)) + 0.001;

        return {
          maxDragDistanceM: 60,
          snapRadiusM: 40,
          canDragLocked: true,
          constraint: {
            type: 'lng-range',
            minLng,
            maxLng
          }
        };
      }

      if (inputType === 'drawing') {
        return {
          maxDragDistanceM: 150,
          snapRadiusM: 60,
          canDragLocked: true,
          constraint: null
        };
      }
      
      return {
        maxDragDistanceM: 100,
        snapRadiusM: 50,
        canDragLocked: true,
        constraint: null
      };
    }
  };
}
