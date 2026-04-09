import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, useState, useMemo } from "react";
import { cn } from "@/src/lib/utils";
import { InputMode } from "@/src/types";
import { Maximize, ZoomIn, ZoomOut, Navigation } from "lucide-react";
import { Point } from "@/src/lib/shapeMath";

// Custom pulsing icon for start/finish
const pulsingIcon = L.divIcon({
  className: "custom-div-icon",
  html: `<div class="relative flex items-center justify-center">
    <div class="absolute w-6 h-6 bg-accent-primary rounded-full sonar-ping"></div>
    <div class="relative w-3 h-3 bg-accent-primary rounded-full border-2 border-white shadow-[0_0_15px_rgba(255,45,107,0.8)]"></div>
  </div>`,
  iconSize: [0, 0],
  iconAnchor: [0, 0],
});

interface MapComponentProps {
  mode: InputMode;
  idealCoords: Point[];
  snappedCoords: Point[];
  isGenerating: boolean;
  hasResult: boolean;
  center: Point;
}

// Component to handle map view updates
function MapController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

export default function MapComponent({
  mode,
  idealCoords,
  snappedCoords,
  isGenerating,
  hasResult,
  center,
}: MapComponentProps) {
  const [zoom, setZoom] = useState(13);

  const leafletIdeal = useMemo(() => idealCoords.map(p => [p.lat, p.lng] as [number, number]), [idealCoords]);
  const leafletSnapped = useMemo(() => snappedCoords.map(p => [p.lat, p.lng] as [number, number]), [snappedCoords]);

  return (
    <div className="relative w-full h-full bg-bg-primary overflow-hidden">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        zoomControl={false}
        className="w-full h-full"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <MapController center={[center.lat, center.lng]} zoom={zoom} />

        {/* Ghost Overlay */}
        {!hasResult && leafletIdeal.length > 0 && (
          <Polyline
            positions={leafletIdeal}
            pathOptions={{
              color: "#FF2D6B",
              weight: 2,
              className: "marching-ants",
              opacity: 0.6,
            }}
          />
        )}

        {/* Snapped Route */}
        {hasResult && leafletSnapped.length > 0 && (
          <>
            {/* Glow effect */}
            <Polyline
              positions={leafletSnapped}
              pathOptions={{
                color: "#FF2D6B",
                weight: 16,
                opacity: 0.15,
                className: "route-line-glow",
              }}
            />
            {/* Main line */}
            <Polyline
              positions={leafletSnapped}
              pathOptions={{
                color: "#FF2D6B",
                weight: 4,
                opacity: 1,
                className: "route-draw-animation",
              }}
            />
            {/* Start/Finish Pulsing Dot */}
            <Marker 
              position={leafletSnapped[0]}
              icon={pulsingIcon}
            />
          </>
        )}
      </MapContainer>

      {/* Floating Controls */}
      <div className="absolute top-6 right-6 z-[1000] flex flex-col gap-2">
        <div className="bg-bg-card/80 backdrop-blur-md border border-divider rounded-[12px] overflow-hidden shadow-2xl">
          <button 
            onClick={() => setZoom(z => z + 1)}
            className="p-3 hover:bg-white/5 text-white transition-colors border-b border-divider"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setZoom(z => z - 1)}
            className="p-3 hover:bg-white/5 text-white transition-colors"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
        </div>
        <button 
          onClick={() => {
            // Recenter logic
          }}
          className="bg-bg-card/80 backdrop-blur-md border border-divider rounded-[12px] p-3 shadow-2xl hover:bg-white/5 text-white transition-colors"
        >
          <Navigation className="w-5 h-5" />
        </button>
      </div>

      {/* Bottom Right Info */}
      <div className="absolute bottom-6 right-6 z-[1000] hidden md:block">
        <div className="bg-bg-card/80 backdrop-blur-md border border-divider rounded-full px-4 py-2 shadow-2xl flex items-center gap-4 text-[10px] font-sans font-medium uppercase tracking-[0.12em] text-text-secondary">
          <div className="flex items-center gap-1.5">
            <Maximize className="w-3 h-3" />
            Scroll to zoom
          </div>
          <div className="w-px h-3 bg-divider" />
          <div className="flex items-center gap-1.5">
            <Navigation className="w-3 h-3 rotate-45" />
            Drag to pan
          </div>
        </div>
      </div>
    </div>
  );
}
