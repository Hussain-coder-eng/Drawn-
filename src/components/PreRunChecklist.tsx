import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, ShieldCheck, MapPin, Volume2, Zap } from 'lucide-react';
import { NavRoute } from '../lib/navigationService';
import { cn } from '../lib/utils';

interface PreRunChecklistProps {
  onProceed: () => void;
  onCancel: () => void;
  navRoute: NavRoute;
  shapeName: string;
}

export function PreRunChecklist({ onProceed, onCancel, navRoute, shapeName }: PreRunChecklistProps) {
  const [checks, setChecks] = useState({
    gpsPermission: 'pending' as 'pending' | 'granted' | 'denied',
    isHttps: typeof window !== 'undefined' && window.location.protocol === 'https:',
    wakeLockSupported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
    speechSupported: typeof window !== 'undefined' && 'speechSynthesis' in window
  });

  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' as any }).then(result => {
        setChecks(c => ({ ...c, gpsPermission: result.state as any }));
        result.onchange = () => {
          setChecks(c => ({ ...c, gpsPermission: result.state as any }));
        };
      }).catch(() => {
        // Fallback if permissions API not supported for geolocation
        navigator.geolocation.getCurrentPosition(
          () => setChecks(c => ({ ...c, gpsPermission: 'granted' })),
          () => setChecks(c => ({ ...c, gpsPermission: 'denied' }))
        );
      });
    }
  }, []);

  const canStart = checks.gpsPermission === 'granted';

  return (
    <div className="fixed inset-0 z-[4000] bg-bg-primary flex flex-col p-6 overflow-y-auto">
      <div className="max-w-md mx-auto w-full space-y-8 py-10">
        <div className="space-y-2 text-center">
          <h1 className="text-[32px] font-display font-bold text-white uppercase italic tracking-tighter">
            Ready to <span className="text-accent-primary">Run?</span>
          </h1>
          <p className="text-text-secondary font-medium uppercase tracking-widest text-[11px]">
            Check your gear before we start
          </p>
        </div>

        <div className="bg-bg-card rounded-[24px] border border-divider p-6 space-y-6">
          <CheckItem 
            icon={<MapPin className="w-5 h-5" />}
            label="GPS Location"
            status={checks.gpsPermission === 'granted' ? 'pass' : checks.gpsPermission === 'denied' ? 'fail' : 'pending'}
            description={checks.gpsPermission === 'denied' ? "Enable location in your browser settings" : "Required for real-time tracking"}
          />
          <CheckItem 
            icon={<ShieldCheck className="w-5 h-5" />}
            label="Secure Connection"
            status={checks.isHttps ? 'pass' : 'fail'}
            description={!checks.isHttps ? "Navigation requires HTTPS" : "Connection is secure"}
          />
          <CheckItem 
            icon={<Zap className="w-5 h-5" />}
            label="Wake Lock"
            status={checks.wakeLockSupported ? 'pass' : 'warn'}
            description={!checks.wakeLockSupported ? "Screen might turn off during run" : "Screen will stay awake"}
          />
          <CheckItem 
            icon={<Volume2 className="w-5 h-5" />}
            label="Audio Cues"
            status={checks.speechSupported ? 'pass' : 'fail'}
            description={!checks.speechSupported ? "Voice navigation not supported" : "Turn-by-turn audio enabled"}
          />
        </div>

        <div className="bg-accent-primary/10 border border-accent-primary/20 rounded-[16px] p-4">
          <p className="text-[12px] text-accent-primary font-medium text-center">
            Tip: Turn up your volume for audio cues!
          </p>
        </div>

        <div className="space-y-3 pt-4">
          <button
            onClick={onProceed}
            disabled={!canStart}
            className={cn(
              "w-full h-[64px] rounded-[16px] flex items-center justify-center text-[18px] font-display font-bold uppercase tracking-widest transition-all",
              canStart 
                ? "bg-accent-primary text-white glow-pink-strong hover:opacity-90 active:scale-[0.98]" 
                : "bg-bg-subtle text-text-muted cursor-not-allowed"
            )}
          >
            Start {shapeName} Run
          </button>
          <button
            onClick={onCancel}
            className="w-full h-[48px] text-text-secondary font-sans font-bold uppercase tracking-widest text-[12px] hover:text-white transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckItem({ icon, label, status, description }: { icon: React.ReactNode, label: string, status: 'pass' | 'fail' | 'pending' | 'warn', description: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className={cn(
        "p-2.5 rounded-xl border",
        status === 'pass' ? "bg-success/10 border-success/20 text-success" :
        status === 'fail' ? "bg-danger/10 border-danger/20 text-danger" :
        status === 'warn' ? "bg-warning/10 border-warning/20 text-warning" :
        "bg-bg-subtle border-divider text-text-muted"
      )}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-bold text-white uppercase tracking-tight">{label}</span>
          {status === 'pass' && <CheckCircle2 className="w-4 h-4 text-success" />}
          {status === 'fail' && <XCircle className="w-4 h-4 text-danger" />}
        </div>
        <p className="text-[11px] text-text-secondary mt-0.5">{description}</p>
      </div>
    </div>
  );
}
