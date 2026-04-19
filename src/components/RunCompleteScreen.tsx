import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline } from 'react-leaflet';
import { NavRoute } from '../lib/navigationService';
import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Trophy, Share2, ChevronRight, Map as MapIcon, Clock, Footprints, Zap } from 'lucide-react';
import { motion } from 'motion/react';

interface RunCompleteScreenProps {
  result: {
    totalDistanceM: number;
    elapsedSeconds: number;
    avgPaceSecPerKm: number;
    completedPolyline: [number, number][];
  };
  shapeName: string;
  navRoute: NavRoute;
  onClose: () => void;
}

export function RunCompleteScreen({ result, shapeName, navRoute, onClose }: RunCompleteScreenProps) {
  useEffect(() => {
    async function saveRun() {
      const user = auth.currentUser;
      if (!user) return;
      try {
        await addDoc(collection(db, 'runs'), {
          userId: user.uid,
          shapeName,
          distanceM: result.totalDistanceM,
          elapsedSeconds: result.elapsedSeconds,
          avgPaceSecPerKm: result.avgPaceSecPerKm,
          completedPolyline: result.completedPolyline,
          completedAt: serverTimestamp()
        });
      } catch (error) {
        console.error("Failed to save run:", error);
      }
    }
    saveRun();
  }, [result, shapeName]);

  const bounds = getBoundsFromPolyline(result.completedPolyline);

  return (
    <div className="fixed inset-0 z-[6000] bg-bg-primary flex flex-col overflow-y-auto p-6">
      <div className="max-w-md mx-auto w-full space-y-8 py-10">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center space-y-2"
        >
          <div className="w-20 h-20 bg-warning/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-warning/30">
            <Trophy className="w-10 h-10 text-warning" />
          </div>
          <h1 className="text-[36px] font-display font-bold text-white uppercase italic tracking-tighter leading-tight">
            YOUR {shapeName.toUpperCase()} <br/> IS <span className="text-accent-primary">DONE</span>
          </h1>
          <p className="text-text-secondary font-medium uppercase tracking-widest text-[11px]">
            You just drew art with your feet
          </p>
        </motion.div>

        {/* Shape trace map */}
        <div className="aspect-square bg-bg-card rounded-[32px] border border-divider overflow-hidden relative shadow-2xl">
          <MapContainer
            bounds={bounds as any}
            zoomControl={false}
            dragging={false}
            scrollWheelZoom={false}
            attributionControl={false}
            className="w-full h-full"
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <Polyline
              positions={result.completedPolyline.map(([lng, lat]) => [lat, lng])}
              pathOptions={{ color: '#FF2D6B', weight: 4, opacity: 1.0 }}
            />
            <Polyline
              positions={result.completedPolyline.map(([lng, lat]) => [lat, lng])}
              pathOptions={{ color: '#FF2D6B', weight: 14, opacity: 0.15 }}
            />
          </MapContainer>
          <div className="absolute inset-0 bg-gradient-to-t from-bg-card via-transparent to-transparent pointer-events-none" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <StatBlock icon={<Footprints className="w-4 h-4" />} label="DISTANCE" value={formatDistance(result.totalDistanceM)} />
          <StatBlock icon={<Clock className="w-4 h-4" />} label="TIME" value={formatElapsedTime(result.elapsedSeconds)} />
          <StatBlock icon={<Zap className="w-4 h-4" />} label="AVG PACE" value={formatPace(result.avgPaceSecPerKm)} />
        </div>

        {/* Actions */}
        <div className="space-y-3 pt-4">
          <button 
            className="w-full h-[64px] bg-accent-primary text-white rounded-[20px] flex items-center justify-center gap-3 text-[18px] font-display font-bold uppercase tracking-widest glow-pink-strong hover:opacity-90 transition-all"
          >
            <Share2 className="w-6 h-6" />
            Share Your Art
          </button>
          <button 
            onClick={onClose}
            className="w-full h-[56px] bg-bg-subtle text-white rounded-[16px] flex items-center justify-center gap-2 text-[14px] font-sans font-bold uppercase tracking-widest hover:bg-bg-card transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBlock({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
  return (
    <div className="bg-bg-card border border-divider p-4 rounded-2xl flex flex-col items-center justify-center text-center">
      <div className="text-accent-primary mb-1.5">{icon}</div>
      <span className="text-text-secondary text-[9px] font-bold uppercase tracking-widest mb-1">{label}</span>
      <span className="text-white text-[18px] font-display font-bold italic leading-none">{value}</span>
    </div>
  );
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

function formatPace(secPerKm: number) {
  if (!secPerKm || isNaN(secPerKm)) return '--:--';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

function getBoundsFromPolyline(coords: [number, number][]) {
  if (coords.length === 0) return [[0, 0], [0, 0]];
  const lats = coords.map(([, lat]) => lat);
  const lngs = coords.map(([lng]) => lng);
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
}
