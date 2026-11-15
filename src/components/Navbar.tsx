import React, { useState } from 'react';
import { Settings, ChevronDown, Check, Plus } from 'lucide-react';
import { DeviceTelemetry } from '../types/iot';

interface NavbarProps {
  device: DeviceTelemetry;
  allDevices: DeviceTelemetry[];
  onSelectDevice: (deviceId: string) => void;
  onOpenAddDevice?: () => void;
  isFirebaseConnected: boolean;
  onOpenGuide: () => void;
  onOpenAlerts: () => void;
  onOpenSettings?: () => void;
  unreadAlertCount: number;
  userEmail?: string;
  userName?: string;
  onLogout?: () => void;
  onOpenLogin?: () => void;
  isOnline?: boolean;
  statusText?: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  device,
  allDevices,
  onSelectDevice,
  onOpenAddDevice,
  onOpenSettings,
  unreadAlertCount,
  isOnline = true,
  statusText,
}) => {
  const [showPondDropdown, setShowPondDropdown] = useState(false);

  // Friendly short display name (e.g. "Pond 3" or dev name)
  const pondDisplayName =
    device.name && device.name.trim() !== ''
      ? device.name.replace(/\(.*?\)/g, '').trim()
      : device.deviceId || 'Pond 1';

  return (
    <header
      className="sticky top-0 z-30 bg-[#F2F7F8]/95 dark:bg-[#071A1F]/95 backdrop-blur-md px-4 py-2.5 transition-colors shrink-0"
      style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)' }}
    >
      <div className="w-full flex items-center justify-between gap-2">
        {/* ── Left: Brand Title & Interactive Pond Name Switcher ── */}
        <div className="relative">
          <small className="text-[11px] font-extrabold tracking-[0.12em] text-[#0E7C86] dark:text-[#19C3D1] uppercase block leading-tight">
            OXYNITY
          </small>

          <div>
            <button
              type="button"
              onClick={() => setShowPondDropdown((v) => !v)}
              className="flex items-center gap-1.5 text-xl sm:text-2xl font-black text-[#0B2B33] dark:text-[#E8F4F6] leading-tight cursor-pointer hover:opacity-80 transition-opacity text-left group"
              title="Click to switch pond or link a new one"
            >
              <span className="truncate max-w-[160px] sm:max-w-[210px]">{pondDisplayName}</span>
              <ChevronDown
                className={`w-4 h-4 text-[#5B7479] dark:text-[#9DB8BD] shrink-0 transition-transform duration-200 ${
                  showPondDropdown ? 'rotate-180 text-[#0E7C86] dark:text-[#19C3D1]' : ''
                }`}
              />
            </button>

            {/* Pond Switcher Dropdown Modal */}
            {showPondDropdown && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-black/20 backdrop-blur-xs"
                  onClick={() => setShowPondDropdown(false)}
                />
                <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-[#12313A] rounded-2xl border border-[#DDE8EA] dark:border-[#1F4650] shadow-2xl py-2.5 z-50 animate-in fade-in zoom-in-95">
                  <div className="px-3.5 pb-2 border-b border-[#DDE8EA]/60 dark:border-[#1F4650]/60 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase text-[#5B7479] dark:text-[#9DB8BD] tracking-wider">
                      Your Ponds ({allDevices.length})
                    </span>
                    <span className="text-[10px] font-bold text-[#0E7C86] dark:text-[#19C3D1] bg-[#0E7C86]/10 dark:bg-[#19C3D1]/15 px-2 py-0.5 rounded-full truncate max-w-[130px]">
                      {pondDisplayName}
                    </span>
                  </div>

                  {/* List of User's Linked Ponds */}
                  <div className="max-h-60 overflow-y-auto py-1">
                    {allDevices.length === 0 ? (
                      <div className="px-3.5 py-3 text-xs text-slate-500 text-center">
                        No ponds linked yet
                      </div>
                    ) : (
                      allDevices.map((d) => {
                        const isCurrent = d.deviceId === device.deviceId;
                        const isRunning = d.status === 'ON';
                        const name = d.name?.replace(/\(.*?\)/g, '').trim() || d.deviceId;

                        return (
                          <button
                            key={d.deviceId}
                            type="button"
                            onClick={() => {
                              onSelectDevice(d.deviceId);
                              setShowPondDropdown(false);
                            }}
                            className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1B3A43] transition-colors cursor-pointer ${
                              isCurrent
                                ? 'bg-[#0E7C86]/5 dark:bg-[#19C3D1]/10 text-[#0E7C86] dark:text-[#19C3D1]'
                                : 'text-[#0B2B33] dark:text-[#E8F4F6]'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                  isRunning
                                    ? 'bg-emerald-500 animate-pulse'
                                    : 'bg-slate-300 dark:bg-slate-600'
                                }`}
                                title={isRunning ? 'Generator Running' : 'Generator Stopped'}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-black truncate">{name}</div>
                                <div className="text-[10px] text-[#5B7479] dark:text-[#9DB8BD] font-mono truncate">
                                  {d.deviceId}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {isRunning && (
                                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                  RUNNING
                                </span>
                              )}
                              {isCurrent && (
                                <Check className="w-4 h-4 text-[#0E7C86] dark:text-[#19C3D1]" />
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* "+ Link Another Pond" Action Button */}
                  {onOpenAddDevice && (
                    <div className="pt-2 border-t border-[#DDE8EA]/60 dark:border-[#1F4650]/60 px-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowPondDropdown(false);
                          onOpenAddDevice();
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-bold text-[#0E7C86] dark:text-[#19C3D1] hover:bg-[#0E7C86]/10 dark:hover:bg-[#19C3D1]/15 rounded-xl transition-colors cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>+ Link Another Pond</span>
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Right: Status Pill & Settings Gear Button ────────────── */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Status Pill */}
          <div
            className="flex items-center gap-2 bg-white dark:bg-[#12313A] border border-[#DDE8EA] dark:border-[#1F4650] rounded-full px-3 py-1.5 shadow-xs"
            role="status"
            title={statusText || (isOnline ? 'System online' : 'System offline')}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isOnline ? 'bg-[#1E9E5A] animate-pulse' : 'bg-[#E5484D]'
              }`}
            />
            <span className="text-xs font-bold text-[#0B2B33] dark:text-[#E8F4F6] tracking-tight">
              {statusText || (isOnline ? 'System online' : 'System offline')}
            </span>
          </div>

          {/* Settings Gear Button */}
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="relative w-10 h-10 rounded-full bg-white dark:bg-[#12313A] border border-[#DDE8EA] dark:border-[#1F4650] flex items-center justify-center text-[#0B2B33] dark:text-[#E8F4F6] hover:bg-slate-50 dark:hover:bg-[#1B3A43] shadow-xs cursor-pointer active:scale-95 transition-all"
          >
            <Settings className="w-5 h-5 stroke-[2]" />
            {unreadAlertCount > 0 && (
              <span className="absolute 1 top-0.5 right-0.5 w-3 h-3 bg-rose-500 rounded-full border-2 border-white dark:border-[#12313A]" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
