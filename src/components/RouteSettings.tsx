import { cn } from "@/src/lib/utils";
import { SurfacePreference } from "@/src/types";
import { MapPin, Search } from "lucide-react";
import { useState } from "react";

interface RouteSettingsProps {
  distance: number;
  setDistance: (d: number) => void;
  unit: "mi" | "km";
  setUnit: (u: "mi" | "km") => void;
  location: string;
  setLocation: (l: string) => void;
  setUserLocation: (p: { lat: number; lng: number }) => void;
  surface: SurfacePreference;
  setSurface: (s: SurfacePreference) => void;
}

export default function RouteSettings({
  distance,
  setDistance,
  unit,
  setUnit,
  location,
  setLocation,
  setUserLocation,
  surface,
  setSurface,
}: RouteSettingsProps) {
  const [suggestions, setSuggestions] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const searchLocation = async (query: string) => {
    if (query.length < 3) return;
    setIsSearching(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
      const data = await response.json();
      const results = data.map((item: any) => ({
        label: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon)
      }));
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } catch (error) {
      console.error("Geocoding failed:", error);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-8 pt-6 border-t border-divider">
      <h2 className="text-[11px] font-sans font-medium uppercase tracking-[0.12em] text-text-secondary">Route Settings</h2>

      {/* Target Distance */}
      <div className="space-y-6">
        <div className="flex items-baseline justify-center gap-2">
          <span className="text-[64px] font-display font-bold text-white leading-none">{distance.toFixed(1)}</span>
          <span className="text-[24px] font-display font-normal text-text-secondary uppercase">{unit}</span>
        </div>
        
        <div className="space-y-2">
          <input
            type="range"
            min="0.5"
            max="26.2"
            step="0.1"
            value={distance}
            onChange={(e) => setDistance(parseFloat(e.target.value))}
            className="w-full h-1 bg-divider rounded-full appearance-none cursor-pointer accent-accent-primary"
            style={{
              background: `linear-gradient(to right, #FF2D6B 0%, #FF2D6B ${(distance / 26.2) * 100}%, #2A2A2A ${(distance / 26.2) * 100}%, #2A2A2A 100%)`
            }}
          />
          <div className="flex justify-between px-1">
            {[5, 10, 13.1, 20, 26.2].map((tick) => (
              <div key={tick} className="flex flex-col items-center gap-1">
                <div className="w-0.5 h-1 bg-text-muted" />
                <span className="text-[8px] font-sans font-bold text-text-muted">{tick}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-center">
          <div className="flex bg-bg-subtle p-1 rounded-full">
            {(["mi", "km"] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={cn(
                  "px-6 py-1.5 text-[12px] font-sans font-medium uppercase tracking-[0.08em] rounded-full transition-all duration-200",
                  unit === u ? "bg-accent-primary text-white" : "text-text-secondary hover:text-white"
                )}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Start Location */}
      <div className="space-y-3">
        <label className="text-[11px] font-sans font-medium uppercase tracking-[0.12em] text-text-secondary ml-1">Start Location</label>
        <div className="relative">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            {isSearching ? (
              <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <MapPin className="w-5 h-5 text-accent-primary" />
            )}
          </div>
          <input
            type="text"
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              if (e.target.value.length >= 3) {
                const timer = setTimeout(() => searchLocation(e.target.value), 500);
                return () => clearTimeout(timer);
              } else {
                setSuggestions([]);
                setShowSuggestions(false);
              }
            }}
            onFocus={() => setShowSuggestions(suggestions.length > 0)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="Starting point..."
            className="w-full h-[56px] bg-bg-card border border-divider rounded-[10px] pl-12 pr-4 text-[15px] font-sans text-white focus:outline-none focus:border-accent-primary transition-colors placeholder:text-text-muted"
          />
          {showSuggestions && (
            <div className="absolute z-50 w-full mt-2 bg-bg-card border border-divider rounded-[16px] shadow-2xl overflow-hidden backdrop-blur-xl max-h-[300px] overflow-y-auto">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setLocation(s.label);
                    setUserLocation({ lat: s.lat, lng: s.lng });
                    setShowSuggestions(false);
                  }}
                  className="w-full px-4 py-4 text-left hover:bg-bg-subtle transition-colors border-b border-divider last:border-none group"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <MapPin className="w-4 h-4 text-text-muted group-hover:text-accent-primary transition-colors" />
                    </div>
                    <div>
                      <div className="text-[14px] font-sans text-white line-clamp-1">{s.label.split(',')[0]}</div>
                      <div className="text-[12px] font-sans text-text-secondary line-clamp-2">{s.label.split(',').slice(1).join(',').trim()}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Surface Preference */}
      <div className="space-y-3">
        <label className="text-[11px] font-sans font-medium uppercase tracking-[0.12em] text-text-secondary ml-1">Surface</label>
        <div className="flex gap-2">
          {(["roads", "trails", "mixed"] as SurfacePreference[]).map((s) => (
            <button
              key={s}
              onClick={() => setSurface(s)}
              className={cn(
                "flex-1 h-[32px] px-4 rounded-full text-[12px] font-sans font-medium uppercase tracking-[0.08em] transition-all duration-200",
                surface === s 
                  ? "bg-accent-primary text-white glow-pink" 
                  : "bg-bg-subtle text-text-secondary hover:text-white"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
