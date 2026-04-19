import React from 'react';
import { MapContainer, TileLayer, Polyline, Marker } from 'react-leaflet';
import L from 'leaflet';
import { NavRoute } from '../lib/navigationService';
import { RunState } from '../hooks/useRunTracker';

interface RunMapProps {
  navRoute: NavRoute;
  runState: RunState;
  mapRef: React.MutableRefObject<any>;
}

export function RunMap({ navRoute, runState, mapRef }: RunMapProps) {
  return (
    <div className="w-full h-full">
      <MapContainer
        ref={mapRef}
        center={[navRoute.startPoint.lat, navRoute.startPoint.lng]}
        zoom={17}
        zoomControl={false}
        attributionControl={false}
        className="w-full h-full"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {/* Completed route — solid pink with glow */}
        {runState.completedPolyline.length > 1 && (
          <>
            <Polyline
              positions={runState.completedPolyline.map(([lng, lat]) => [lat, lng])}
              pathOptions={{
                color: '#FF2D6B',
                weight: 16,
                opacity: 0.15
              }}
            />
            <Polyline
              positions={runState.completedPolyline.map(([lng, lat]) => [lat, lng])}
              pathOptions={{
                color: '#FF2D6B',
                weight: 5,
                opacity: 1.0
              }}
            />
          </>
        )}

        {/* Remaining route — dashed pink, dimmer */}
        {runState.remainingPolyline.length > 1 && (
          <Polyline
            positions={runState.remainingPolyline.map(([lng, lat]) => [lat, lng])}
            pathOptions={{
              color: '#FF2D6B',
              weight: 3,
              opacity: 0.4,
              dashArray: '10 8'
            }}
          />
        )}

        {/* Runner position marker */}
        {runState.currentPosition && (
          <RunnerMarker
            position={runState.currentPosition}
            heading={runState.currentPosition.heading}
          />
        )}

        {/* Upcoming turn markers on the map */}
        {navRoute.turnPoints
          .filter(t =>
            t.cumulativeDistanceM > runState.completedDistanceM &&
            t.cumulativeDistanceM < runState.completedDistanceM + 500
          )
          .map((turn, i) => (
            <TurnMarker key={`turn-${turn.routePointIndex || i}`} turn={turn} />
          ))
        }

        {/* Finish line marker */}
        <Marker 
          position={[navRoute.finishPoint.lat, navRoute.finishPoint.lng]} 
          icon={L.divIcon({
            className: '',
            html: `<div class="w-8 h-8 bg-success rounded-full border-4 border-white shadow-lg flex items-center justify-center text-white font-bold text-xs">🏁</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
          })}
        />

      </MapContainer>
    </div>
  );
}

function RunnerMarker({ position, heading }: { position: { lat: number, lng: number }, heading: number | null }) {
  const icon = L.divIcon({
    className: '',
    html: `
      <div class="relative w-10 h-10 flex items-center justify-center">
        <div class="absolute inset-0 bg-accent-primary rounded-full sonar-ping"></div>
        <div class="relative w-4 h-4 bg-accent-primary rounded-full border-2 border-white shadow-[0_0_15px_rgba(255,45,107,0.8)] flex items-center justify-center">
          ${heading !== null ? `<div class="text-[8px] text-white" style="transform: rotate(${heading}deg)">▲</div>` : ''}
        </div>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });
  return <Marker position={[position.lat, position.lng]} icon={icon} />;
}

const TurnMarker: React.FC<{ turn: any }> = ({ turn }) => {
  const turnIcons: Record<string, string> = {
    'left':        '←',
    'right':       '→',
    'sharp-left':  '↰',
    'sharp-right': '↱',
    'u-turn':      '↩',
    'slight-left': '↖',
    'slight-right':'↗',
    'straight':    '↑'
  };
  const icon = L.divIcon({
    className: '',
    html: `<div class="w-8 h-8 bg-bg-card border border-divider rounded-full flex items-center justify-center text-accent-primary font-bold text-lg shadow-xl">${turnIcons[turn.turnType] ?? '•'}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
  return <Marker position={[turn.lat, turn.lng]} icon={icon} />;
}
