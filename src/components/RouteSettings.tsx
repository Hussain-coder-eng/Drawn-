// src/components/RouteSettings.tsx
import { cn } from "@/src/lib/utils";
import { MapPin, ChevronDown, ChevronUp } from "lucide-react";
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";

interface RouteSettingsProps {
  distance: number;
  setDistance: (d: number) => void;
  unit: "mi" | "km";
  setUnit: (u: "mi" | "km") => void;
  location: string;
  setLocation: (l: string) => void;
  setUserLocation: (p: { lat: number; lng: number }) => void;
}

export default function RouteSettings({
  distance,
  setDistance,
  unit,
  setUnit,
  location,
  setLocation,
  setUserLocation,
}: RouteSettingsProps) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const moreOptionsLabel = location ? location.split(',')[0] : 'No location set';

  return (
    <div className="border-t border-divider mt-4 pt-4 space-y-4">
      {/* Target Distance — always visible */}
      <div>
        <label className="text-[11px] font-sans font-medium uppercase tracking-[0.12em] text-text-secondary ml-1">Target Distance</label>
        <div className="flex items-baseline justify-center gap-2 mt-2">
          <span className="text-[40px] font-display font-bold text-white leading-none">{distance.toFixed(1)}</span>
          <span className="text-[18px] font-display font-normal text-text-secondary uppercase">{unit}</span>
        </div>
        <input
          type="range"
          data-testid="distance-input"
          min="0.5"
          max="26.2"
          step="0.1"
          value={distance}
          onChange={(e) => setDistance(parseFloat(e.target.value))}
          className="w-full h-1 bg-divider rounded-full appearance-none cursor-pointer accent-accent-primary mt-3"
          style={{
            background: `linear-gradient(to right, #FF2D6B 0%, #FF2D6B ${(distance / 26.2) * 100}%, #2A2A2A ${(distance / 26.2) * 100}%, #2A2A2A 100%)`
          }}
        />
        <div className="flex justify-center mt-3">
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

      {/* More Options collapsible (location + surface) */}
      <div>
        <button
          className="w-full flex items-center justify-between py-1"
          onClick={() => setOpen(!open)}
        >
          <span className="text-[12px] font-sans text-text-secondary truncate pr-2">{moreOptionsLabel}</span>
          {open ? <ChevronUp className="w-4 h-4 text-text-muted flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />}
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden space-y-4 pt-4"
            >
              {/* Start Location */}
              <div className="space-y-2 relative">
                <label className="text-[11px] font-sans font-medium uppercase tracking-[0.12em] text-text-secondary ml-1">Start Location</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                    {isSearching ? (
                      <div className="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <MapPin className="w-4 h-4 text-accent-primary" />
                    )}
                  </div>
                  <input
                    type="text"
                    data-testid="location-input"
                    value={location}
                    onChange={(e) => {
                      setLocation(e.target.value);
                      if (e.target.value.length >= 3) {
                        if (debounceRef.current) clearTimeout(debounceRef.current);
                        debounceRef.current = setTimeout(() => searchLocation(e.target.value), 500);
                      } else {
                        setSuggestions([]);
                        setShowSuggestions(false);
                      }
                    }}
                    onFocus={() => setShowSuggestions(suggestions.length > 0)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    placeholder="Starting point…"
                    className="w-full h-[48px] bg-bg-card border border-divider rounded-[10px] pl-10 pr-4 text-[14px] font-sans text-white focus:outline-none focus:border-accent-primary transition-colors placeholder:text-text-muted"
                  />
                  {showSuggestions && (
                    <div className="absolute z-50 w-full mt-2 bg-bg-card border border-divider rounded-[16px] shadow-2xl overflow-hidden max-h-[200px] overflow-y-auto">
                      {suggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setLocation(s.label);
                            setUserLocation({ lat: s.lat, lng: s.lng });
                            setShowSuggestions(false);
                          }}
                          className="w-full px-4 py-3 text-left hover:bg-bg-subtle transition-colors border-b border-divider last:border-none"
                        >
                          <div className="text-[13px] font-sans text-white line-clamp-1">{s.label.split(',')[0]}</div>
                          <div className="text-[11px] font-sans text-text-secondary line-clamp-1">{s.label.split(',').slice(1).join(',').trim()}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
