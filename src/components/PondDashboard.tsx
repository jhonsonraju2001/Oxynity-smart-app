import React, { useState, useEffect } from 'react';
import { Radio, Clock } from 'lucide-react';
import { DeviceTelemetry, EnabledSensors, AeratorSchedule } from '../types/iot';
import { PowerControl } from './PowerControl';
import { AnimatedTankBanner } from './AnimatedTankBanner';
import { AnimatedSensors } from './AnimatedSensors';
import { WeatherCard } from './WeatherCard';
import { canUseAutoDo } from '../lib/oxynity';

interface PondDashboardProps {
  allDevices: DeviceTelemetry[];
  activeDevice: DeviceTelemetry;
  onSelectDevice: (device: DeviceTelemetry) => void;
  onTogglePower: (newStatus: 'ON' | 'OFF', targetDeviceId?: string) => void;
  onToggleAutoMode: (enabled: boolean) => void;
  onOverrideCooldown?: () => void;
  onCancelCooldown?: () => void;
  isUpdating?: boolean;
  onOpenAddDevice: () => void;
  sensorsEnabled?: EnabledSensors;
  isOnline?: boolean;
  onDeletePond?: (pondId: string) => void;
  onEditPondName?: (pondId: string, newName: string) => void;
  onUpdateSchedules?: (schedules: AeratorSchedule[]) => void;
  /** Home "Schedule" switch: turns the pond's schedules on/off (separate from Auto DO mode). */
  onToggleSchedule?: (enabled: boolean) => void;
}

/** Calculate ESP32 heartbeat status & last seen age */
export function getEsp32HeartbeatStatus(device?: DeviceTelemetry): {
  text: string;
  isLive: boolean;
  secondsAgo: number;
} {
  if (!device) return { text: 'No signal', isLive: false, secondsAgo: 9999 };
  const tsStr = device.lastSeen || device.updatedAt;
  if (!tsStr) return { text: 'No signal', isLive: false, secondsAgo: 9999 };

  const diffMs = Date.now() - new Date(tsStr).getTime();
  const diffSecs = Math.max(0, Math.floor(diffMs / 1000));

  // 1. Machine remains Online for up to 5 minutes (300 seconds) after lastSeen
  if (diffSecs <= 300) {
    let text = 'Live (Just now)';
    if (diffSecs > 30 && diffSecs < 60) {
      text = `Live (${diffSecs}s ago)`;
    } else if (diffSecs >= 60) {
      const mins = Math.floor(diffSecs / 60);
      text = `Live (${mins}m ago)`;
    }
    return {
      text,
      isLive: true,
      secondsAgo: diffSecs,
    };
  }

  // 2. Confirmed Offline: strictly when no lastSeen was received for more than 5 minutes (300 seconds)
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) {
    return { text: `Offline (${mins}m ago)`, isLive: false, secondsAgo: diffSecs };
  }
  const hrs = Math.floor(mins / 60);
  return { text: `Offline (${hrs}h ago)`, isLive: false, secondsAgo: diffSecs };
}

export const PondDashboard: React.FC<PondDashboardProps> = ({
  allDevices,
  activeDevice,
  onSelectDevice,
  onTogglePower,
  onToggleAutoMode,
  onOverrideCooldown,
  onCancelCooldown,
  isUpdating = false,
  onOpenAddDevice,
  sensorsEnabled,
  isOnline,
  onDeletePond,
  onEditPondName,
  onUpdateSchedules,
  onToggleSchedule,
}) => {
  const [, setTick] = useState(0);

  // Force re-render every 2 seconds to update "last seen X seconds ago" live timers
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(timer);
  }, []);

  // If user has 0 linked ponds, show empty state prompting to link
  if (allDevices.length === 0) {
    return (
      <div className="bg-slate-900 rounded-3xl p-8 border border-slate-800 text-center space-y-4 animate-in fade-in">
        <div className="w-16 h-16 bg-sky-950/80 rounded-2xl flex items-center justify-center mx-auto text-sky-400">
          <Radio className="w-8 h-8 stroke-[2]" />
        </div>
        <h3 className="text-base font-bold text-white">No Linked Ponds</h3>
        <p className="text-xs text-slate-400 max-w-xs mx-auto">
          No ESP32 pond device is currently linked to your login account. Link your device to view live dissolved oxygen and machinery controls.
        </p>
        <button
          onClick={onOpenAddDevice}
          className="px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer transition-all"
        >
          + Link ESP32 Device
        </button>
      </div>
    );
  }

  // Active pond device (switched via top Navbar dropdown)
  const currentDevice =
    allDevices.find((d) => d.deviceId === activeDevice?.deviceId) ||
    activeDevice ||
    allDevices[0];
  const heartbeat = getEsp32HeartbeatStatus(currentDevice);
  // Schedules switch; older ponds without the field follow Auto mode like before
  const schedOn = currentDevice.scheduleEnabled ?? currentDevice.autoMode;
  const liveOnline = isOnline !== undefined ? isOnline : heartbeat.isLive;

  return (
    <div className="space-y-3.5 animate-in fade-in duration-300">
      {/* 1. Animated Aquatic Fish & Shrimp Tank Banner */}
      <AnimatedTankBanner device={currentDevice} isOnline={liveOnline} />

      {/* 2. Interactive Single Nano-Bubble Generator Power Control */}
      <PowerControl
        device={currentDevice}
        onTogglePower={onTogglePower}
        onToggleAutoMode={onToggleAutoMode}
        onOverrideCooldown={onOverrideCooldown}
        onCancelCooldown={onCancelCooldown}
        isUpdating={isUpdating}
        isOnline={liveOnline}
        doInstalled={canUseAutoDo(currentDevice, sensorsEnabled)}
      />

      {/* 2b. Schedule ON / OFF Switch Toggle */}
      <div className="ox-card p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#E6EFF1] dark:bg-[#08222A] text-[#0E7C86] dark:text-[#19C3D1] flex items-center justify-center shrink-0 border border-[#DDE8EA]/60 dark:border-[#1F4650]">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
                Schedule
              </span>
              <span
                className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                  schedOn
                    ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {schedOn ? 'ON' : 'OFF'}
              </span>
            </div>
            <p className="text-xs text-[#5B7479] dark:text-[#9DB8BD] mt-0.5">
              {schedOn
                ? 'On · runs automatically'
                : 'Off · manual control'}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={schedOn}
          onClick={() => (onToggleSchedule || onToggleAutoMode)(!schedOn)}
          className="ox-switch"
          aria-label="Schedule on or off"
        />
      </div>

      {/* 3. Animated Water Quality Sensors (Filtered by toggle switches) */}
      <AnimatedSensors
        device={currentDevice}
        isOnline={liveOnline}
        sensorsEnabled={sensorsEnabled}
      />

      {/* 4. Weather at the pond (by GPS) with DO-related warnings */}
      <WeatherCard device={currentDevice} />
    </div>
  );
};
