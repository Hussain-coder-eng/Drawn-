import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Navigation, Map, Settings, RefreshCw, Copy, CheckCircle2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Point } from "@/src/lib/shapeMath";
import { buildGoogleMapsUrl, buildAppleMapsUrl, copyMapsLink, calculateRouteDistanceKm } from "@/src/lib/mapsExport";

interface ResultCardProps {
  distance: number;
  unit: string;
  shapeLabel: string;
  fidelity: number;
  snappedCoords: Point[];
  onRegenerate: () => void;
  onFineTune: () => void;
  onStartRun: () => void;
}

export default function ResultCard({
  distance,
  unit,
  shapeLabel,
  fidelity,
  snappedCoords,
  onRegenerate,
  onFineTune,
  onStartRun,
}: ResultCardProps) {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  const actualKm = calculateRouteDistanceKm(snappedCoords);
  const displayDistance = unit === "mi" ? (actualKm / 1.60934).toFixed(2) : actualKm.toFixed(2);
  const displayUnit = unit;

  const handleCopyLink = async () => {
    await copyMapsLink(snappedCoords);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 pt-2"
    >
      {/* Summary line */}
      <p className="text-[12px] font-sans text-text-secondary text-center">
        <span data-testid="route-distance">{displayDistance} {displayUnit}</span>
        {' · '}{shapeLabel}{' · '}
        <span data-testid="fitness-score">{fidelity}%</span> match
      </p>

      {/* Primary action buttons */}
      <div className="flex gap-3">
        {/* Export to Maps */}
        <div className="flex-1 relative">
          <button
            data-testid="export-maps-btn"
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="w-full h-[56px] bg-accent-primary text-white rounded-[14px] flex items-center justify-center gap-2 font-sans font-bold text-[14px] uppercase tracking-wide glow-pink"
          >
            <Map className="w-5 h-5" />
            Export to Maps
          </button>

          {/* Export choice popover */}
          <AnimatePresence>
            {showExportMenu && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute top-[64px] left-0 right-0 bg-bg-card border border-divider rounded-[16px] shadow-2xl overflow-hidden z-10"
              >
                <button
                  onClick={() => { window.open(buildGoogleMapsUrl(snappedCoords), '_blank'); setShowExportMenu(false); }}
                  className="w-full px-4 py-3 text-left text-[13px] font-sans text-white hover:bg-bg-subtle transition-colors border-b border-divider flex items-center gap-3"
                >
                  <span className="text-[16px]">🗺</span> Google Maps
                </button>
                <button
                  onClick={() => { window.open(buildAppleMapsUrl(snappedCoords), '_blank'); setShowExportMenu(false); }}
                  className="w-full px-4 py-3 text-left text-[13px] font-sans text-white hover:bg-bg-subtle transition-colors border-b border-divider flex items-center gap-3"
                >
                  <span className="text-[16px]">🍎</span> Apple Maps
                </button>
                <button
                  onClick={() => { handleCopyLink(); setTimeout(() => setShowExportMenu(false), 1200); }}
                  className="w-full px-4 py-3 text-left text-[13px] font-sans text-white hover:bg-bg-subtle transition-colors flex items-center gap-3"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4 text-text-muted" />}
                  {copied ? "Copied!" : "Copy Link"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Start Run */}
        <button
          data-testid="start-run-btn"
          onClick={onStartRun}
          className="flex-1 h-[56px] bg-bg-card border border-accent-primary text-white rounded-[14px] flex items-center justify-center gap-2 font-sans font-bold text-[14px] uppercase tracking-wide hover:bg-accent-primary/10 transition-all"
        >
          <Navigation className="w-5 h-5 text-accent-primary" />
          Start Run
        </button>
      </div>

      {/* Ghost links */}
      <div className="flex justify-center gap-6">
        <button
          onClick={onFineTune}
          className="flex items-center gap-1.5 text-[12px] font-sans text-text-secondary hover:text-white transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          Fine-tune Route
        </button>
        <button
          data-testid="regenerate-btn"
          onClick={onRegenerate}
          className="flex items-center gap-1.5 text-[12px] font-sans text-accent-primary hover:text-accent-secondary transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Redesign
        </button>
      </div>
    </motion.div>
  );
}
