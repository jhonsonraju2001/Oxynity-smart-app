import { isAdminEmail } from '../lib/oxynity';
import React, { useState, useEffect } from 'react';
import { X, Moon, Sun, Monitor, Bell, WifiOff, LogOut, PlusCircle, Wrench } from 'lucide-react';
import { DeviceTelemetry } from '../types/iot';

interface SettingsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  device?: DeviceTelemetry;
  userEmail?: string;
  userName?: string;
  onLogout?: () => void;
  onOpenAddDevice?: () => void;
  onOpenFullSettings?: () => void;
  isSimulatingOffline?: boolean;
  onToggleSimulateOffline?: () => void;
  onTestLowOxygen?: () => void;
  tempUnit?: 'C' | 'F';
  onUpdateTempUnit?: (unit: 'C' | 'F') => void;
}

export const SettingsSheet: React.FC<SettingsSheetProps> = ({
  isOpen,
  onClose,
  device,
  userEmail,
  userName,
  onLogout,
  onOpenAddDevice,
  onOpenFullSettings,
  isSimulatingOffline = false,
  onToggleSimulateOffline,
  onTestLowOxygen,
  tempUnit: propTempUnit,
  onUpdateTempUnit,
}) => {
  const [themeMode, setThemeMode] = useState<'auto' | 'light' | 'dark'>(() => {
    return (localStorage.getItem('oxynity_theme') as any) || 'auto';
  });
  const [tempUnit, setTempUnit] = useState<'C' | 'F'>(() => {
    return propTempUnit || (localStorage.getItem('oxynity_temp_unit') as any) || 'C';
  });
  const [alertsEnabled, setAlertsEnabled] = useState(true);

  useEffect(() => {
    if (propTempUnit) setTempUnit(propTempUnit);
  }, [propTempUnit]);

  // Apply theme to document element
  useEffect(() => {
    localStorage.setItem('oxynity_theme', themeMode);
    if (themeMode === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (themeMode === 'light') {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [themeMode]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end select-none animate-in fade-in duration-200">
      {/* Backdrop shade */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs"
        onClick={onClose}
      />

      {/* Slide-Up Bottom Sheet */}
      <div className="relative z-10 w-full sm:max-w-[430px] mx-auto bg-white dark:bg-[#12313A] rounded-t-[32px] p-5 shadow-2xl border-t border-[#DDE8EA] dark:border-[#1F4650] max-h-[90dvh] overflow-y-auto space-y-4 animate-in slide-in-from-bottom duration-300">
        {/* Header Row */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black text-[#0B2B33] dark:text-[#E8F4F6] tracking-tight">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-10 h-10 rounded-full bg-[#E6EFF1] dark:bg-[#08222A] flex items-center justify-center text-[#0B2B33] dark:text-[#E8F4F6] hover:bg-[#DCE9EC] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        {/* 1. Theme Segment */}
        <div>
          <label className="block text-xs font-bold text-[#5B7479] dark:text-[#9DB8BD] mb-1.5">
            Theme
          </label>
          <div className="flex bg-[#E6EFF1] dark:bg-[#08222A] p-1 rounded-xl border border-[#DDE8EA] dark:border-[#1F4650] gap-1">
            {(['auto', 'light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setThemeMode(mode)}
                className={`flex-1 py-2 rounded-lg font-bold text-xs capitalize transition-all cursor-pointer ${
                  themeMode === mode
                    ? 'bg-white dark:bg-[#12313A] text-[#0B2B33] dark:text-[#E8F4F6] shadow-xs font-black'
                    : 'text-[#5B7479] dark:text-[#9DB8BD]'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Temperature Unit Segment */}
        <div>
          <label className="block text-xs font-bold text-[#5B7479] dark:text-[#9DB8BD] mb-1.5">
            Temperature Unit
          </label>
          <div className="flex bg-[#E6EFF1] dark:bg-[#08222A] p-1 rounded-xl border border-[#DDE8EA] dark:border-[#1F4650] gap-1">
            {(['C', 'F'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => {
                  setTempUnit(u);
                  localStorage.setItem('oxynity_temp_unit', u);
                  onUpdateTempUnit?.(u);
                  window.dispatchEvent(new CustomEvent('oxynity_temp_unit_change', { detail: u }));
                }}
                className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                  tempUnit === u
                    ? 'bg-white dark:bg-[#12313A] text-[#0B2B33] dark:text-[#E8F4F6] shadow-xs font-black'
                    : 'text-[#5B7479] dark:text-[#9DB8BD]'
                }`}
              >
                °{u}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Alerts Toggle */}
        <div className="py-2.5 flex items-center justify-between border-b border-[#DDE8EA] dark:border-[#1F4650]">
          <div>
            <b className="block text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
              Alerts
            </b>
            <small className="text-xs text-[#5B7479] dark:text-[#9DB8BD]">
              Notify me when a reading is out of range
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={alertsEnabled}
            onClick={() => setAlertsEnabled((v) => !v)}
            className={`w-13 h-7.5 rounded-full relative transition-colors cursor-pointer shrink-0 ${
              alertsEnabled ? 'bg-[#0E7C86] dark:bg-[#19C3D1]' : 'bg-[#DCE9EC] dark:bg-[#24444D]'
            }`}
          >
            <span
              className={`block w-6 h-6 rounded-full bg-white shadow-md absolute top-0.75 left-1 transition-transform ${
                alertsEnabled ? 'translate-x-5.5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* 4. Demo & Simulation Tools (admins only) */}
        <div className={isAdminEmail(userEmail) ? 'space-y-2 pt-1' : 'hidden'}>
          <label className="block text-xs font-bold text-[#5B7479] dark:text-[#9DB8BD]">
            Demo & Test Tools
          </label>

          {/* Simulate Offline Switch */}
          <div className="py-2 flex items-center justify-between border-b border-[#DDE8EA] dark:border-[#1F4650]">
            <div>
              <b className="block text-xs sm:text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
                Simulate offline
              </b>
              <small className="text-xs text-[#5B7479] dark:text-[#9DB8BD]">
                Shows how the app looks without cellular connection
              </small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isSimulatingOffline}
              onClick={onToggleSimulateOffline}
              className={`w-13 h-7.5 rounded-full relative transition-colors cursor-pointer shrink-0 ${
                isSimulatingOffline ? 'bg-[#0E7C86] dark:bg-[#19C3D1]' : 'bg-[#DCE9EC] dark:bg-[#24444D]'
              }`}
            >
              <span
                className={`block w-6 h-6 rounded-full bg-white shadow-md absolute top-0.75 left-1 transition-transform ${
                  isSimulatingOffline ? 'translate-x-5.5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Test Low-Oxygen Alert Button */}
          {onTestLowOxygen && (
            <button
              type="button"
              onClick={() => {
                onTestLowOxygen();
                onClose();
              }}
              className="w-full min-h-[46px] rounded-xl bg-[#E6EFF1] dark:bg-[#08222A] hover:bg-[#DCE9EC] text-[#0B2B33] dark:text-[#E8F4F6] font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              Test low-oxygen alert (Simulate DO &lt; 5.0)
            </button>
          )}

          {/* Add / Sync New Pond ID */}
          {onOpenAddDevice && (
            <button
              type="button"
              onClick={() => {
                onOpenAddDevice();
                onClose();
              }}
              className="w-full min-h-[46px] rounded-xl bg-[#0E7C86] text-white hover:bg-[#0c6b73] font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Link New ESP32 Pond</span>
            </button>
          )}

          {/* Advanced Machinery & Calibration Settings */}
          {onOpenFullSettings && (
            <button
              type="button"
              onClick={() => {
                onOpenFullSettings();
                onClose();
              }}
              className="w-full min-h-[46px] rounded-xl bg-[#E6EFF1] dark:bg-[#08222A] hover:bg-[#DCE9EC] text-[#0B2B33] dark:text-[#E8F4F6] font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Wrench className="w-4 h-4" />
              <span>DO Calibration & Machinery Setup</span>
            </button>
          )}
        </div>

        {/* User Account & Sign Out */}
        <div className="pt-2 border-t border-[#DDE8EA] dark:border-[#1F4650] flex items-center justify-between">
          <div className="text-xs">
            <span className="font-extrabold text-[#0B2B33] dark:text-[#E8F4F6] block">
              {userName || 'Operator'}
            </span>
            <span className="text-[11px] text-[#5B7479] dark:text-[#9DB8BD]">
              {userEmail || 'operator@oxynity.com'}
            </span>
          </div>

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          )}
        </div>

        <p className="text-[10px] text-[#5B7479] dark:text-[#9DB8BD] text-center pt-2">
          Oxynity Smart App v2.4 · Dissolved Oxygen & Micro-Nano Aeration System
        </p>
      </div>
    </div>
  );
};
