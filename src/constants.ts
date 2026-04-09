import { Heart, Star, ArrowRight, Infinity, Smile, Zap, Home, PersonStanding, Plus, Type } from "lucide-react";

export const COLORS = {
  bgPrimary: "#0D0D0D",
  bgCard: "#1A1A1A",
  bgSubtle: "#242424",
  accentPrimary: "#FF2D6B",
  accentSecondary: "#FF6B9D",
  textPrimary: "#FFFFFF",
  textSecondary: "#A0A0A0",
  textMuted: "#505050",
  success: "#00C896",
  warning: "#FFB020",
  danger: "#FF4444",
  divider: "#2A2A2A",
};

export const SHAPES = [
  { id: "heart", label: "Heart", icon: Heart },
  { id: "star", label: "Star", icon: Star },
  { id: "infinity", label: "Infinity", icon: Infinity },
  { id: "arrow", label: "Arrow", icon: ArrowRight },
  { id: "lightning", label: "Lightning", icon: Zap },
  { id: "circle", label: "Circle", icon: Smile },
  { id: "letter", label: "Letter", icon: Type },
  { id: "custom", label: "Custom+", icon: Plus },
];

export const FONT_STYLES = [
  { id: "stencil", label: "Stencil", className: "font-mono font-black uppercase tracking-tighter" },
  { id: "block", label: "Block", className: "font-sans font-black uppercase" },
  { id: "outline", label: "Outline", className: "font-sans font-bold uppercase border-2 border-white px-1" },
];
