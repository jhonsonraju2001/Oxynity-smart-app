import React, { useState, useEffect, useRef } from 'react';
import {
  Power,
  Timer,
  Zap,
  ShieldCheck,
  RefreshCw,
  WifiOff,
  AlertTriangle,
  ChevronRight,
  RotateCcw,
  Snowflake,
} from 'lucide-react';
import { DeviceTelemetry, DeviceStatus } from '../types/iot';

interface PowerControlProps {
  device: DeviceTelemetry;
  onTogglePower: (newStatus: 'ON' | 'OFF', targetDeviceId?: string) => void;
  onToggleAutoMode: (enabled: boolean) => void;
  onOverrideCooldown?: () => void;
  onCancelCooldown?: () => void;
  isUpdating?: boolean;
  isOnline?: boolean;
}

export const PowerControl: React.FC<PowerControlProps> = ({
  device,
  onTogglePower,
  onToggleAutoMode,
  onOverrideCooldown,
  onCancelCooldown,
  isUpdating = false,
  isOnline = true,
}) => {
  const {
    status,
    status2,
    currentSessionMinutes,
    currentSessionSeconds,
    autoMode,
    minDoAlert = 5.0,
    targetDo = 8.5,
  } = device;

  const isRunning = status === 'ON';
  const isCoolingDown = !!device.isCoolingDown;
  const cooldownEnabled = device.cooldownEnabled !== false;
  const [showOfflineModal, setShowOfflineModal] = useState(false);

  // ── Session Runtime Tracker & Safe Persistence ──
  // The timer calculates real wall-clock elapsed time from sessionStartedAt
  // so closing and reopening the app NEVER loses, freezes, or resets the running time!
  const storageKey = `oxynity_session_elapsed_${device.deviceId}`;
  const continuousStorageKey = `oxynity_continuous_run_${device.deviceId}`;
  const startedStorageKey = `oxynity_session_started_at_${device.deviceId}`;
  const contStartedStorageKey = `oxynity_continuous_started_at_${device.deviceId}`;

  const calculateCurrentSecs = (): number => {
    if (!isRunning) return 0;
    const now = Date.now();
    const startedIso =
      device.sessionStartedAt ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem(startedStorageKey) : null);

    let wallClockSecs = 0;
    if (startedIso) {
      const startTime = new Date(startedIso).getTime();
      if (!isNaN(startTime) && startTime > 0 && now >= startTime) {
        wallClockSecs = Math.floor((now - startTime) / 1000);
      }
    }
    const incomingSecs =
      currentSessionSeconds ?? (currentSessionMinutes ? currentSessionMinutes * 60 : 0);
    let savedSecs = 0;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) savedSecs = parseInt(saved, 10) || 0;
    } catch {}
    return Math.max(wallClockSecs, incomingSecs, savedSecs);
  };

  const calculateContinuousSecs = (): number => {
    if (!isRunning) return 0;
    const now = Date.now();
    const startedIso =
      device.continuousStartedAt ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem(contStartedStorageKey) : null);

    let wallClockSecs = 0;
    if (startedIso) {
      const startTime = new Date(startedIso).getTime();
      if (!isNaN(startTime) && startTime > 0 && now >= startTime) {
        wallClockSecs = Math.floor((now - startTime) / 1000);
      }
    }
    const incomingCont = device.continuousRunSeconds ?? (currentSessionSeconds ?? 0);
    let savedSecs = 0;
    try {
      const saved = localStorage.getItem(continuousStorageKey);
      if (saved) savedSecs = parseInt(saved, 10) || 0;
    } catch {}
    return Math.max(wallClockSecs, incomingCont, savedSecs);
  };

  const [localSecs, setLocalSecs] = useState<number>(calculateCurrentSecs);
  const [continuousSecs, setContinuousSecs] = useState<number>(calculateContinuousSecs);
  const prevStatusRef = useRef<DeviceStatus>(status);

  // Track remaining seconds of 30-min cooldown
  const [cooldownSecsLeft, setCooldownSecsLeft] = useState<number>(() => {
    if (device.cooldownEndsAt) {
      const diff = Math.max(0, Math.floor((new Date(device.cooldownEndsAt).getTime() - Date.now()) / 1000));
      return diff;
    }
    return device.cooldownRemainingSeconds ?? 1800;
  });

  // Keep cooldown countdown updated in real-time
  useEffect(() => {
    if (!isCoolingDown) return;

    const interval = setInterval(() => {
      if (device.cooldownEndsAt) {
        const diff = Math.max(0, Math.floor((new Date(device.cooldownEndsAt).getTime() - Date.now()) / 1000));
        setCooldownSecsLeft(diff);
      } else {
        setCooldownSecsLeft((prev) => Math.max(0, prev - 1));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isCoolingDown, device.cooldownEndsAt]);

  // Synchronize when telemetry or status updates
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (!isRunning) {
      if (!isCoolingDown && prevStatus === 'ON') {
        // ONLY reset when transitioning from ON to OFF
        setLocalSecs(0);
        setContinuousSecs(0);
        try {
          localStorage.removeItem(storageKey);
          localStorage.removeItem(continuousStorageKey);
          localStorage.removeItem(startedStorageKey);
          localStorage.removeItem(contStartedStorageKey);
        } catch {}
      }
      return;
    }

    // Machine is running: compute updated seconds
    const actual = calculateCurrentSecs();
    setLocalSecs((prev) => Math.max(prev, actual));

    const actualCont = calculateContinuousSecs();
    setContinuousSecs((prev) => Math.max(prev, actualCont));
  }, [
    status,
    currentSessionSeconds,
    currentSessionMinutes,
    device.sessionStartedAt,
    device.continuousStartedAt,
    isCoolingDown,
    storageKey,
    continuousStorageKey,
    startedStorageKey,
    contStartedStorageKey,
  ]);

  // Persist current running seconds and started timestamp
  useEffect(() => {
    if (isRunning && localSecs > 0) {
      try {
        localStorage.setItem(storageKey, String(localSecs));
        localStorage.setItem(continuousStorageKey, String(continuousSecs));
      } catch {}
    }
  }, [isRunning, localSecs, continuousSecs, storageKey, continuousStorageKey]);

  // Exact Running Time Ticker:
  // Computes actual wall-clock elapsed seconds every second.
  // When offline, pauses. When reconnected, resumes accurately.
  useEffect(() => {
    if (!isRunning || !isOnline) {
      return; // PAUSED when machine is offline or stopped!
    }

    const interval = setInterval(() => {
      const actual = calculateCurrentSecs();
      setLocalSecs((prev) => {
        const next = Math.max(prev + 1, actual);
        try {
          localStorage.setItem(storageKey, String(next));
        } catch {}
        return next;
      });

      const actualCont = calculateContinuousSecs();
      setContinuousSecs((prev) => {
        const next = Math.max(prev + 1, actualCont);
        try {
          localStorage.setItem(continuousStorageKey, String(next));
        } catch {}
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [
    isRunning,
    isOnline,
    device.sessionStartedAt,
    device.continuousStartedAt,
    storageKey,
    continuousStorageKey,
    startedStorageKey,
    contStartedStorageKey,
  ]);

  const hours = Math.floor(localSecs / 3600);
  const mins = Math.floor((localSecs % 3600) / 60);
  const secs = localSecs % 60;

  const sessionDurationText =
    hours > 0 ? `${hours}h ${mins}m ${secs}s` : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  // Continuous runtime towards 6-hour limit (21,600s)
  const continuousHours = Math.floor(continuousSecs / 3600);
  const continuousMins = Math.floor((continuousSecs % 3600) / 60);

  // Cooldown countdown formatting (30-min rest)
  const COOLDOWN_REST_SECS = 30 * 60; // 1,800s
  const cdMins = Math.floor(cooldownSecsLeft / 60);
  const cdSecs = cooldownSecsLeft % 60;
  const cooldownFormatted = `${cdMins}:${cdSecs.toString().padStart(2, '0')}`;
  const cooldownProgressPercent = Math.min(
    100,
    Math.round(((COOLDOWN_REST_SECS - cooldownSecsLeft) / COOLDOWN_REST_SECS) * 100)
  );

  // Relay 2 (Secondary Aerator) 2-Minute (120s) Countdown Logic:
  // Counts down from 2:00 to 0:00 when the machine turns ON.
  const RELAY_2_DELAY_SECS = 120; // 2 minutes = 120 seconds
  const remainingR2Secs = Math.max(0, RELAY_2_DELAY_SECS - localSecs);
  const r2Mins = Math.floor(remainingR2Secs / 60);
  const r2SecsRem = remainingR2Secs % 60;
  const r2CountdownFormatted = `${r2Mins}:${r2SecsRem.toString().padStart(2, '0')}`;
  const isRelay2Active = isRunning && (remainingR2Secs === 0 || status2 === 'ON');
  const r2ProgressPercent = Math.min(100, Math.round(((RELAY_2_DELAY_SECS - remainingR2Secs) / RELAY_2_DELAY_SECS) * 100));

  const handlePowerClick = () => {
    if (isUpdating) return;

    // If currently in cooldown: Clicking power button provides immediate manual override!
    if (isCoolingDown) {
      if (onOverrideCooldown) {
        onOverrideCooldown();
      } else {
        onTogglePower('ON', device.deviceId);
      }
      return;
    }

    // If attempting to turn ON while offline:
    // Prevent remote activation and pop up instructional message!
    if (!isRunning && !isOnline) {
      setShowOfflineModal(true);
      return;
    }

    if (isRunning) {
      // Stopping machine: reset timer immediately and clear storage
      setLocalSecs(0);
      setContinuousSecs(0);
      try {
        localStorage.removeItem(storageKey);
        localStorage.removeItem(continuousStorageKey);
        localStorage.removeItem(startedStorageKey);
        localStorage.removeItem(contStartedStorageKey);
      } catch {}
      onTogglePower('OFF', device.deviceId);
    } else {
      // Starting machine: record initial start timestamp
      const nowIso = new Date().toISOString();
      setLocalSecs(0);
      setContinuousSecs(0);
      try {
        localStorage.setItem(startedStorageKey, nowIso);
        localStorage.setItem(contStartedStorageKey, nowIso);
        localStorage.setItem(storageKey, '0');
        localStorage.setItem(continuousStorageKey, '0');
      } catch {}
      onTogglePower('ON', device.deviceId);
    }
  };

  return (
    <div className="space-y-3">
      {/* ── Main Generator Control Card (Matching Reference Design) ── */}
      <div className="bg-white dark:bg-[#12313A] rounded-[24px] p-5 border border-[#DDE8EA] dark:border-[#1F4650] shadow-xs flex flex-col items-center justify-center text-center">
        {/* Animated 144px Circular Button */}
        <button
          type="button"
          disabled={isUpdating}
          onClick={handlePowerClick}
          aria-label={isRunning ? 'Turn MNBG off' : 'Turn MNBG on'}
          className="relative block w-36 h-36 rounded-full focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-[#19C3D1] cursor-pointer transition-transform active:scale-95 disabled:opacity-60"
        >
          {isUpdating ? (
            <div className="w-36 h-36 rounded-full bg-slate-800 flex items-center justify-center border-4 border-cyan-500/50">
              <RefreshCw className="w-10 h-10 text-cyan-400 animate-spin" />
            </div>
          ) : isRunning ? (
            /* Generator ON SVG Animation with 18 rising nano-bubbles */
            <svg
              className="w-36 h-36 block drop-shadow-lg"
              viewBox="0 0 144 144"
              aria-hidden="true"
            >
              <defs>
                <clipPath id="gen-clip">
                  <circle cx="72" cy="72" r="60" />
                </clipPath>
              </defs>

              {/* Glowing Outer Ring */}
              <circle
                cx="72"
                cy="72"
                r="66"
                fill="none"
                style={{ stroke: 'var(--ring, #CDEFF2)' }}
                strokeWidth="8"
              />
              {/* Inner Teal Core */}
              <circle cx="72" cy="72" r="60" fill="#0E7C86" />

              {/* Nano-Bubbles in Clip Path */}
              <g clipPath="url(#gen-clip)">
                {/* Breathing Ambient Glow */}
                <circle cx="72" cy="72" r="60" fill="#19C3D1" opacity="0">
                  <animate
                    attributeName="opacity"
                    values="0;.35;0"
                    dur="2.4s"
                    repeatCount="indefinite"
                  />
                </circle>

                {/* 18 Rising Micro-Nano Bubbles */}
                <circle cx="56" cy="150" r="2.3" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="2.0s" begin="-3.3s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="56;63;62" dur="2.0s" begin="-3.3s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="2.0s" begin="-3.3s" repeatCount="indefinite" />
                </circle>
                <circle cx="100" cy="150" r="1.1" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="1.8s" begin="-3.0s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="100;100;103" dur="1.8s" begin="-3.0s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="1.8s" begin="-3.0s" repeatCount="indefinite" />
                </circle>
                <circle cx="55" cy="150" r="1.4" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="3.1s" begin="-1.9s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="55;62;53" dur="3.1s" begin="-1.9s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="3.1s" begin="-1.9s" repeatCount="indefinite" />
                </circle>
                <circle cx="107" cy="150" r="2.9" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="2.2s" begin="-0.5s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="107;115;105" dur="2.2s" begin="-0.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="2.2s" begin="-0.5s" repeatCount="indefinite" />
                </circle>
                <circle cx="27" cy="150" r="2.5" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="1.9s" begin="-2.7s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="27;20;22" dur="1.9s" begin="-2.7s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="1.9s" begin="-2.7s" repeatCount="indefinite" />
                </circle>
                <circle cx="29" cy="150" r="2.8" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="2.3s" begin="-2.1s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="29;33;37" dur="2.3s" begin="-2.1s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="2.3s" begin="-2.1s" repeatCount="indefinite" />
                </circle>
                <circle cx="80" cy="150" r="1.9" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="3.2s" begin="-1.6s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="80;76;94" dur="3.2s" begin="-1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="3.2s" begin="-1.6s" repeatCount="indefinite" />
                </circle>
                <circle cx="72" cy="150" r="1.2" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="2.0s" begin="-0.8s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="72;77;82" dur="2.0s" begin="-0.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="2.0s" begin="-0.8s" repeatCount="indefinite" />
                </circle>
                <circle cx="106" cy="150" r="2.9" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="2.6s" begin="-3.0s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="106;109;109" dur="2.6s" begin="-3.0s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="2.6s" begin="-3.0s" repeatCount="indefinite" />
                </circle>
                <circle cx="100" cy="150" r="1.9" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="2.2s" begin="-1.2s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="100;92;113" dur="2.2s" begin="-1.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="2.2s" begin="-1.2s" repeatCount="indefinite" />
                </circle>
                <circle cx="61" cy="150" r="3.2" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="3.0s" begin="-0.6s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="61;63;64" dur="3.0s" begin="-0.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="3.0s" begin="-0.6s" repeatCount="indefinite" />
                </circle>
                <circle cx="99" cy="150" r="2.3" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="3.1s" begin="-0.8s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="99;99;94" dur="3.1s" begin="-0.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="3.1s" begin="-0.8s" repeatCount="indefinite" />
                </circle>
                <circle cx="41" cy="150" r="1.1" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="3.3s" begin="-3.6s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="41;35;38" dur="3.3s" begin="-3.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="3.3s" begin="-3.6s" repeatCount="indefinite" />
                </circle>
                <circle cx="34" cy="150" r="1.9" fill="#D9FAFD" opacity="0">
                  <animate attributeName="cy" values="152;-4" dur="2.1s" begin="-1.1s" repeatCount="indefinite" />
                  <animate attributeName="cx" values="34;39;47" dur="2.1s" begin="-1.1s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;.8;0" dur="2.1s" begin="-1.1s" repeatCount="indefinite" />
                </circle>
              </g>

              {/* Power Icon */}
              <g
                transform="translate(41 41) scale(2.6)"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M12 3v9" />
                <path d="M6.3 6.8a8 8 0 1 0 11.4 0" />
              </g>
            </svg>
          ) : (
            /* Generator OFF SVG Animation with Expanding Halo and Heartbeat Beat */
            <svg
              className="w-36 h-36 block drop-shadow-md"
              viewBox="0 0 144 144"
              aria-hidden="true"
            >
              {/* Expanding Radar Halo Rings */}
              <circle className="halo" cx="72" cy="72" r="56" fill="#19C3D1" />
              <circle
                className="halo"
                style={{ animationDelay: '.39s' }}
                cx="72"
                cy="72"
                r="56"
                fill="#19C3D1"
              />

              {/* Gentle Beating Disc */}
              <g className="beat">
                <circle
                  cx="72"
                  cy="72"
                  r="54"
                  style={{ fill: 'var(--offdisc, #5B7479)', stroke: 'var(--ring, #CDEFF2)' }}
                  strokeWidth="6"
                />
                <g
                  transform="translate(46 46) scale(2.1667)"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M12 3v9" />
                  <path d="M6.3 6.8a8 8 0 1 0 11.4 0" />
                </g>
              </g>
            </svg>
          )}
        </button>

        {/* Generator Status Label */}
        <div className="mt-3 text-xl font-extrabold text-[#0B2B33] dark:text-[#E8F4F6] tracking-tight">
          {isCoolingDown
            ? '❄️ Motor Cooldown Rest'
            : isRunning
            ? 'MNBG - ON'
            : 'MNBG - OFF'}
        </div>

        {/* Running Duration / Tap to Start with Real-Time Offline Pause Indicator */}
        <div className="text-sm font-semibold text-[#5B7479] dark:text-[#9DB8BD] mt-0.5 flex flex-col items-center justify-center gap-1">
          {isCoolingDown ? (
            <div className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400 font-bold text-xs">
              <Snowflake className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '6s' }} />
              <span>Resting for 30 mins · {cooldownFormatted} remaining</span>
            </div>
          ) : isRunning ? (
            <>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <span>Running for {sessionDurationText}</span>
                {!isOnline && (
                  <span className="text-[10px] font-extrabold text-amber-700 dark:text-amber-300 bg-amber-100/80 dark:bg-amber-900/50 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-700">
                    Paused · Machine Offline
                  </span>
                )}
              </div>

              {cooldownEnabled && (
                <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <span>Continuous Run:</span>
                  <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                    {continuousHours}h {continuousMins}m / 6h
                  </span>
                  {continuousHours >= 5 && (
                    <span className="text-[9px] font-extrabold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 rounded-full">
                      Cooldown in {Math.max(0, 6 - continuousHours)}h
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <span>Tap the button to start aeration</span>
          )}
        </div>

        {/* ── Motor Cooldown Active Card Widget ── */}
        {isCoolingDown && (
          <div className="mt-3.5 w-full max-w-xs transition-all duration-300 text-left">
            <div className="bg-sky-50/95 dark:bg-[#0E2830] border border-sky-300 dark:border-sky-800 rounded-2xl p-3.5 space-y-2.5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Snowflake
                    className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 animate-spin"
                    style={{ animationDuration: '8s' }}
                  />
                  <span className="text-xs font-black text-sky-950 dark:text-sky-100 truncate">
                    Motor Cooldown in Progress
                  </span>
                </div>
                <span className="text-[11px] font-mono font-black px-2 py-0.5 rounded-full bg-sky-200/80 dark:bg-sky-900/80 text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-700 shrink-0">
                  {cooldownFormatted}
                </span>
              </div>

              {/* Progress bar towards 30 mins rest */}
              <div className="w-full bg-sky-200/60 dark:bg-sky-950 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-sky-500 h-2 rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${cooldownProgressPercent}%` }}
                />
              </div>

              <p className="text-[10px] text-sky-800 dark:text-sky-300/90 font-medium leading-relaxed">
                Ran 6 hours continuously. Taking a 30-minute rest to protect motor windings and pump bearings. Machine will auto-restart when timer reaches 0:00.
              </p>

              {/* Action Buttons: Resume Override or Cancel */}
              <div className="flex items-center gap-2 pt-1 border-t border-sky-200/60 dark:border-sky-800/60">
                <button
                  type="button"
                  onClick={handlePowerClick}
                  className="flex-1 py-1.5 px-2 bg-sky-600 hover:bg-sky-700 active:scale-95 text-white text-[11px] font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1 shadow-xs"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Resume Now</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onCancelCooldown) onCancelCooldown();
                    else onTogglePower('OFF');
                  }}
                  className="py-1.5 px-3 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-bold rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Relay 2 (Secondary Aerator) 4-Minute Countdown / Status Widget ── */}
        {isRunning && (
          <div className="mt-3.5 w-full max-w-xs transition-all duration-300 text-left">
            {!isRelay2Active ? (
              /* Counting down: 4:00 down to 0:00 */
              <div className="bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl p-3 space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Timer className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 animate-pulse" />
                    <span className="text-xs font-black text-amber-900 dark:text-amber-200 truncate">
                      Second Relay ON in {r2CountdownFormatted} mins
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-black px-2 py-0.5 rounded-full bg-amber-200/70 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 shrink-0">
                    {r2CountdownFormatted}
                  </span>
                </div>

                {/* Progress bar towards 2 minutes */}
                <div className="w-full bg-amber-200/50 dark:bg-amber-900/30 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-amber-500 h-1.5 rounded-full transition-all duration-1000 ease-linear"
                    style={{ width: `${r2ProgressPercent}%` }}
                  />
                </div>

                <p className="text-[10px] text-amber-800 dark:text-amber-300/90 font-medium leading-tight">
                  Main generator running. Secondary aerator booster will automatically turn ON at 0:00.
                </p>
              </div>
            ) : (
              /* Relay 2 is now ON */
              <div className="bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 rounded-2xl p-3 space-y-1 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-400 fill-emerald-500" />
                    <span className="text-xs font-black text-emerald-900 dark:text-emerald-200">
                      Second relay is turn on now
                    </span>
                  </div>
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-600 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                    ACTIVE
                  </span>
                </div>
                <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-medium leading-tight">
                  Relay 1 (Main Generator) & Relay 2 (Secondary Aerator) are both running together.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Auto DO Threshold Text */}
        <div className="text-xs font-medium text-[#5B7479] dark:text-[#9DB8BD] mt-2 mb-3">
          {autoMode
            ? `Auto: ON below ${minDoAlert.toFixed(1)} · OFF above ${targetDo.toFixed(1)} ppm`
            : 'Manual control'}
        </div>

        {/* Segmented Control Mode Toggle (Matching Reference) */}
        <div className="flex bg-[#E6EFF1] dark:bg-[#08222A] p-1 rounded-[14px] w-full max-w-xs gap-1 border border-[#DDE8EA]/60 dark:border-[#1F4650]">
          <button
            type="button"
            onClick={() => onToggleAutoMode(false)}
            aria-pressed={!autoMode}
            className={`flex-1 min-h-[44px] rounded-[11px] text-sm font-bold transition-all cursor-pointer ${
              !autoMode
                ? 'bg-white dark:bg-[#12313A] text-[#0B2B33] dark:text-[#E8F4F6] shadow-[0_1px_4px_rgba(11,43,51,0.15)]'
                : 'text-[#5B7479] dark:text-[#9DB8BD] hover:text-[#0B2B33] dark:hover:text-[#E8F4F6]'
            }`}
          >
            Manual
          </button>
          <button
            type="button"
            onClick={() => onToggleAutoMode(true)}
            aria-pressed={autoMode}
            className={`flex-1 min-h-[44px] rounded-[11px] text-sm font-bold transition-all cursor-pointer ${
              autoMode
                ? 'bg-white dark:bg-[#12313A] text-[#0B2B33] dark:text-[#E8F4F6] shadow-[0_1px_4px_rgba(11,43,51,0.15)]'
                : 'text-[#5B7479] dark:text-[#9DB8BD] hover:text-[#0B2B33] dark:hover:text-[#E8F4F6]'
            }`}
          >
            Auto · DO
          </button>
        </div>
      </div>

      {/* ── Offline Instruction Popup Modal ── */}
      {showOfflineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#12313A] rounded-3xl p-6 max-w-sm w-full border border-rose-200 dark:border-rose-900/60 shadow-2xl text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-center justify-center mx-auto text-rose-500">
              <WifiOff className="w-8 h-8" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                Machine is Offline
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                The machine is currently offline and remote app commands cannot reach the ESP32 controller. The button cannot turn on remotely.
              </p>
            </div>

            {/* Manual Button Instruction Highlight */}
            <div className="bg-emerald-50/90 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-3.5 text-left space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                <span className="text-xs font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                  Turn On Manually
                </span>
              </div>
              <p className="text-[11px] text-emerald-950 dark:text-emerald-100 leading-relaxed font-medium">
                If you need to turn on the machine, please press the <strong>manual GREEN push button</strong> directly on the physical control panel. It starts Relay 1 immediately and starts Relay 2 after 2 minutes even without internet!
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowOfflineModal(false)}
              className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white dark:text-slate-950 font-black text-sm tracking-wide transition-all shadow-md cursor-pointer"
            >
              Understood · Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
