import React from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface NudgeMapProps {
  inputType: string;
  routePolyline: [number, number][];
  waypoints: any[];
  ghostShape: { lat: number, lng: number }[];
  segmentAccuracy: any[];
  fitnessScore: number | null;
  highlightedLetter: number | null;
  onWaypointDrag: (index: number, lat: number, lng: number) => void;
  letterBoundaries?: any[];
  centerLat: number;
  centerLng: number;
  onClose: () => void;
  onSave: () => void;
}

export function NudgeMap({
  inputType,
  routePolyline,
  waypoints,
  ghostShape,
  segmentAccuracy,
  fitnessScore,
  highlightedLetter,
  onWaypointDrag,
  letterBoundaries,
  centerLat,
  centerLng,
  onClose,
  onSave
}: NudgeMapProps) {
  return (
    <div className="relative w-full h-full bg-bg-primary">
      <div className="absolute top-6 left-6 z-[3000] flex items-center gap-4">
        <button 
          onClick={onClose}
          className="h-12 px-6 bg-bg-card/80 backdrop-blur-md border border-divider rounded-full text-white font-bold hover:bg-bg-subtle transition-all flex items-center gap-2"
        >
          Cancel
        </button>
        <button 
          onClick={onSave}
          className="h-12 px-8 bg-accent-primary text-white font-bold rounded-full shadow-lg shadow-accent-primary/20 hover:bg-accent-secondary transition-all flex items-center gap-2"
        >
          Save Changes
        </button>
      </div>

      <div className="absolute top-6 right-6 z-[3000] max-w-xs bg-bg-card/80 backdrop-blur-md border border-divider rounded-2xl p-4 shadow-2xl">
        <h3 className="text-white font-display font-bold uppercase tracking-tight mb-1">Fine-tune Mode</h3>
        <p className="text-text-secondary text-[12px] leading-relaxed">
          Drag the pink markers to snap the route to specific streets. The dashed line shows your ideal design.
        </p>
      </div>

      <MapContainer
        center={[centerLat, centerLng]}
        zoom={15}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='© CartoDB'
        />

        {/* Ghost ideal shape overlay */}
        {ghostShape.map((point, i) => {
          if (i === ghostShape.length - 1) return null;
          const accuracy = segmentAccuracy.find(s => s.segmentIndex === i);
          return (
            <Polyline
              key={`ghost-${i}`}
              positions={[[ghostShape[i].lat, ghostShape[i].lng], [ghostShape[i+1].lat, ghostShape[i+1].lng]]}
              pathOptions={{
                color: accuracy?.color ?? '#ffffff',
                weight: 3,
                opacity: 0.5,
                dashArray: '6 4'
              }}
            />
          );
        })}

        {/* Route glow layer */}
        <Polyline
          positions={routePolyline.map(([lng, lat]) => [lat, lng])}
          pathOptions={{ color: '#FF2D6B', weight: 16, opacity: 0.12 }}
        />

        {/* Route main line */}
        <Polyline
          positions={routePolyline.map(([lng, lat]) => [lat, lng])}
          pathOptions={{ color: '#FF2D6B', weight: 4, opacity: 1.0 }}
        />

        {/* Draggable waypoint markers */}
        {waypoints.map((wp, i) => (
          <DraggableWaypointMarker
            key={`wp-${i}`}
            waypoint={wp}
            index={i}
            inputType={inputType}
            isHighlighted={inputType === 'text' && wp.letterIndex === highlightedLetter}
            isLocked={wp.isLocked}
            onDrag={(newLat, newLng) => onWaypointDrag(i, newLat, newLng)}
          />
        ))}

        {/* Live fitness score overlay */}
        <div className="absolute top-4 right-4 z-[1000] pointer-events-none">
          <div className="bg-black/80 backdrop-blur-md border border-white/20 rounded-lg px-4 py-2 flex flex-col items-center shadow-xl">
            <span className="text-2xl font-bold text-[#00C896]">{fitnessScore ?? 0}%</span>
            <span className="text-[10px] uppercase tracking-widest text-white/50 font-medium">Match</span>
          </div>
        </div>
      </MapContainer>
    </div>
  );
}

function DraggableWaypointMarker({ waypoint, index, inputType, isHighlighted, isLocked, onDrag }: any) {
  const markerRef = React.useRef<L.Marker>(null);

  const eventHandlers = React.useMemo(() => ({
    dragend() {
      const marker = markerRef.current;
      if (marker != null) {
        const { lat, lng } = marker.getLatLng();
        onDrag(lat, lng);
      }
    },
  }), [onDrag]);

  const icon = React.useMemo(() => {
    const color = isLocked ? '#FFD700' : (isHighlighted ? '#00C896' : '#FF2D6B');
    const size = isLocked ? 12 : 10;
    return L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`,
      iconSize: [size, size],
      iconAnchor: [size/2, size/2],
    });
  }, [isLocked, isHighlighted]);

  return (
    <Marker
      draggable={true}
      eventHandlers={eventHandlers}
      position={[waypoint.lat, waypoint.lng]}
      icon={icon}
      ref={markerRef}
    >
      <Tooltip direction="top" offset={[0, -5]} opacity={1}>
        <div className="px-2 py-1 text-xs font-medium">
          {isLocked ? "Anchor Point — drag carefully" : "Drag to adjust"}
        </div>
      </Tooltip>
    </Marker>
  );
}
