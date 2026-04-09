import { cn } from "@/src/lib/utils";
import { Plus, History, Activity, User } from "lucide-react";

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function BottomNav({ activeTab, setActiveTab }: BottomNavProps) {
  const tabs = [
    { id: "create", label: "Create", icon: Plus },
    { id: "routes", label: "My Routes", icon: History },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "profile", label: "Profile", icon: User },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[3000] bg-bg-card/80 backdrop-blur-xl border-t border-divider px-6 pb-8 pt-3 md:hidden">
      <div className="flex justify-between items-center max-w-md mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex flex-col items-center gap-1 group"
            >
              <div className={cn(
                "p-1 rounded-lg transition-all duration-200",
                isActive ? "text-accent-primary" : "text-text-muted group-hover:text-white"
              )}>
                <Icon className="w-6 h-6" />
              </div>
              <span className={cn(
                "text-[10px] font-sans font-medium uppercase tracking-widest transition-colors",
                isActive ? "text-accent-primary" : "text-text-muted group-hover:text-white"
              )}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
