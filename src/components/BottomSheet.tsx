import React from "react";
import { motion, AnimatePresence } from "motion/react";

interface BottomSheetProps {
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export default function BottomSheet({ expanded, onToggle, children }: BottomSheetProps) {
  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[1000] bg-black/40"
            onClick={onToggle}
          />
        )}
      </AnimatePresence>

      {/* Sheet */}
      <motion.div
        data-testid="bottom-sheet"
        className="fixed bottom-0 left-0 right-0 z-[2000] bg-bg-primary rounded-t-[28px] shadow-[0_-20px_60px_rgba(0,0,0,0.9)] border-t border-divider"
        animate={{ height: expanded ? "65vh" : "180px" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      >
        {/* Drag handle */}
        <div
          data-testid="sheet-handle"
          className="w-full flex justify-center pt-4 pb-2 cursor-pointer"
          onClick={onToggle}
        >
          <div className="w-12 h-1.5 bg-divider rounded-full" />
        </div>

        {/* Scrollable content */}
        <div className="h-full overflow-y-auto px-5 pb-24">
          {children}
        </div>
      </motion.div>
    </>
  );
}
