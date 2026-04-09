import { Footprints } from "lucide-react";

export default function Header() {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-0">
        <h1 className="text-[32px] font-display font-bold tracking-tighter text-white uppercase italic">
          Draw<span className="text-accent-primary">n</span>
        </h1>
      </div>
      <p className="text-[11px] text-text-secondary mt-1 font-medium uppercase tracking-[0.2em]">Drawn to run.</p>
    </div>
  );
}
