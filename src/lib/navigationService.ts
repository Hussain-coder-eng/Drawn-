import * as turf from "@turf/turf";
import { Point } from "./shapeMath";

export interface NavRoutePoint {
  index: number;
  lat: number;
  lng: number;
  cumulativeDistanceM: number;
  distanceFromPrevM: number;
}

export interface TurnPoint {
  routePointIndex: number;
  lat: number;
  lng: number;
  cumulativeDistanceM: number;
  bearingDelta: number;
  absDelta: number;
  turnType: 'sharp-left' | 'left' | 'slight-left' | 'straight' | 'slight-right' | 'right' | 'sharp-right' | 'u-turn';
  turnInstruction: string;
  alertTriggeredAt: boolean;
  alertDistanceM: number;
  alertCumulativeDistanceM: number;
}

export interface NavRoute {
  routePoints: NavRoutePoint[];
  turnPoints: TurnPoint[];
  startPoint: { lat: number; lng: number; cumulativeDistanceM: number; isStart: boolean };
  finishPoint: { lat: number; lng: number; cumulativeDistanceM: number; isFinish: boolean };
  totalDistanceM: number;
  streetNames: Record<string, string>;
  routeLineString: any;
}

function classifyTurnFromDelta(bearingDelta: number): TurnPoint['turnType'] {
  if (bearingDelta < -150) return 'u-turn';
  if (bearingDelta < -90)  return 'sharp-left';
  if (bearingDelta < -35)  return 'left';
  if (bearingDelta < -25)  return 'slight-left';
  if (bearingDelta <= 25)  return 'straight';
  if (bearingDelta <= 35)  return 'slight-right';
  if (bearingDelta <= 90)  return 'right';
  if (bearingDelta <= 150) return 'sharp-right';
  return 'u-turn';
}

function buildTurnInstruction(turnType: TurnPoint['turnType']): string {
  const directionPhrases: Record<string, string> = {
    'u-turn':       'Make a U-turn',
    'sharp-left':   'Turn sharp left',
    'left':         'Turn left',
    'slight-left':  'Bear left',
    'straight':     'Continue straight',
    'slight-right': 'Bear right',
    'right':        'Turn right',
    'sharp-right':  'Turn sharp right'
  };
  return directionPhrases[turnType] ?? 'Continue';
}

async function fetchStreetNamesFromOSRM(polylineCoords: [number, number][]): Promise<Record<string, string>> {
  const sampled = polylineCoords.filter((_, i) => i % 10 === 0);
  if (sampled.length < 2) return {};
  
  const coordStr = sampled.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/foot/${coordStr}?steps=true&annotations=false`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    const streetNames: Record<string, string> = {};
    
    if (data.code === 'Ok') {
      data.routes[0].legs.forEach((leg: any) => {
        leg.steps.forEach((step: any) => {
          if (step.name && step.maneuver?.location) {
            streetNames[`${step.maneuver.location[1].toFixed(5)},${step.maneuver.location[0].toFixed(5)}`] = step.name;
          }
        });
      });
    }
    return streetNames;
  } catch (error) {
    console.error("Failed to fetch street names:", error);
    return {};
  }
}

export async function preprocessRouteForNavigation(osrmPolylineCoords: [number, number][]): Promise<NavRoute> {
  const validCoords = osrmPolylineCoords.filter(c => 
    typeof c[0] === 'number' && typeof c[1] === 'number' && 
    !isNaN(c[0]) && !isNaN(c[1])
  );

  if (validCoords.length < 2) {
    throw new Error("Insufficient valid coordinates for navigation preprocessing.");
  }

  const routePoints: NavRoutePoint[] = [];
  let cumulativeDistanceM = 0;

  for (let i = 0; i < validCoords.length; i++) {
    const [lng, lat] = validCoords[i];

    if (i > 0) {
      const [prevLng, prevLat] = validCoords[i - 1];
      const segmentDistanceM = turf.distance(
        turf.point([prevLng, prevLat]),
        turf.point([lng, lat]),
        { units: 'kilometers' }
      ) * 1000;
      cumulativeDistanceM += segmentDistanceM;
    }

    routePoints.push({
      index: i,
      lat,
      lng,
      cumulativeDistanceM,
      distanceFromPrevM: i === 0 ? 0 : cumulativeDistanceM - routePoints[i-1].cumulativeDistanceM
    });
  }

  const totalDistanceM = cumulativeDistanceM;
  const turnPoints: TurnPoint[] = [];

  for (let i = 1; i < routePoints.length - 1; i++) {
    const prevBearing = turf.bearing(
      turf.point([routePoints[i-1].lng, routePoints[i-1].lat]),
      turf.point([routePoints[i].lng, routePoints[i].lat])
    );
    const nextBearing = turf.bearing(
      turf.point([routePoints[i].lng, routePoints[i].lat]),
      turf.point([routePoints[i+1].lng, routePoints[i+1].lat])
    );

    const bearingDelta = ((nextBearing - prevBearing + 540) % 360) - 180;
    const absDelta = Math.abs(bearingDelta);

    if (absDelta > 25) {
      const turnType = classifyTurnFromDelta(bearingDelta);
      const lastTurn = turnPoints[turnPoints.length - 1];
      const tooClose = lastTurn && (routePoints[i].cumulativeDistanceM - lastTurn.cumulativeDistanceM) < 30;

      if (!tooClose) {
        turnPoints.push({
          routePointIndex: i,
          lat: routePoints[i].lat,
          lng: routePoints[i].lng,
          cumulativeDistanceM: routePoints[i].cumulativeDistanceM,
          bearingDelta,
          absDelta,
          turnType,
          turnInstruction: buildTurnInstruction(turnType),
          alertTriggeredAt: false,
          alertDistanceM: 40,
          alertCumulativeDistanceM: routePoints[i].cumulativeDistanceM - 40
        });
      }
    }
  }

  const streetNames = await fetchStreetNamesFromOSRM(validCoords);

  return {
    routePoints,
    turnPoints,
    startPoint: { lat: routePoints[0].lat, lng: routePoints[0].lng, cumulativeDistanceM: 0, isStart: true },
    finishPoint: { lat: routePoints[routePoints.length - 1].lat, lng: routePoints[routePoints.length - 1].lng, cumulativeDistanceM: totalDistanceM, isFinish: true },
    totalDistanceM,
    streetNames,
    routeLineString: turf.lineString(validCoords)
  };
}
