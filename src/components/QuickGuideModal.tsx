import React from 'react';
import { HelpCircle, X, CheckCircle2, ShieldAlert, Cpu, Sparkles, Waves, ArrowRight } from 'lucide-react';

interface QuickGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QuickGuideModal: React.FC<QuickGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400 rounded-xl">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                Oxynity Smart Operator Guide
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Zero-Educator Easy Setup & Recommended DO Levels</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">

        {/* 3 Step Quick Start Guide */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
            ⚡ Quick Start (3 Easy Steps)
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1">
              <span className="text-xs font-black text-sky-600 dark:text-sky-400">1. Select Station</span>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                Select your active Oxynity station or pond from the top device selector menu.
              </p>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1">
              <span className="text-xs font-black text-sky-600 dark:text-sky-400">2. Submerge DO Sensor</span>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                Place the DO probe in your pond/tank water. Live DO reading updates via Firebase in real-time.
              </p>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1">
              <span className="text-xs font-black text-sky-600 dark:text-sky-400">3. Turn ON Generator</span>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                Tap the big <strong>ON/OFF</strong> button or enable <strong>Auto DO Mode</strong> for automated oxygenation.
              </p>
            </div>
          </div>
        </div>

        {/* Recommended DO Targets Cheat-Sheet */}
        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <Waves className="w-4 h-4 text-sky-500" />
            <span>Recommended Dissolved Oxygen (DO) Standards</span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-xl border border-emerald-100 dark:border-emerald-900/50 flex justify-between items-center">
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block">Shrimp Aquaculture</span>
                <span className="text-[10px] text-slate-500">Vannamei / Black Tiger</span>
              </div>
              <span className="font-black text-emerald-700 dark:text-emerald-400 text-sm">6.5 - 9.0 mg/L</span>
            </div>

            <div className="p-2.5 bg-sky-50/60 dark:bg-sky-950/30 rounded-xl border border-sky-100 dark:border-sky-900/50 flex justify-between items-center">
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block">Fish Hatchery & Nursery</span>
                <span className="text-[10px] text-slate-500">Tilapia, Carp, Pangasius</span>
              </div>
              <span className="font-black text-sky-700 dark:text-sky-400 text-sm">5.5 - 8.0 mg/L</span>
            </div>

            <div className="p-2.5 bg-purple-50/60 dark:bg-purple-950/30 rounded-xl border border-purple-100 dark:border-purple-900/50 flex justify-between items-center">
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block">Hydroponics & DWC</span>
                <span className="text-[10px] text-slate-500">Root Zone Oxygenation</span>
              </div>
              <span className="font-black text-purple-700 dark:text-purple-400 text-sm">8.0 - 12.0 mg/L</span>
            </div>

            <div className="p-2.5 bg-blue-50/60 dark:bg-blue-950/30 rounded-xl border border-blue-100 dark:border-blue-900/50 flex justify-between items-center">
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block">Wastewater Treatment</span>
                <span className="text-[10px] text-slate-500">Aerobic Digestion</span>
              </div>
              <span className="font-black text-blue-700 dark:text-blue-400 text-sm">6.0 - 8.0 mg/L</span>
            </div>
          </div>
        </div>

        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-400">Oxynity Smart Quick Reference</span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            Got It! Return to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};
