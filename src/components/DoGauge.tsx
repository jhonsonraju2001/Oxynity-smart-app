import React from 'react';
import { Waves, AlertTriangle, WifiOff } from 'lucide-react';
import { DeviceTelemetry } from '../types/iot';

interface DoGaugeProps {
  device: DeviceTelemetry;
}

export const DoGauge: React.FC<DoGaugeProps> = ({ device }) => {
  if (!device || device.doSensorEnabled === false) return null;

  const doLevel = typeof device?.doLevel === 'number' ? device.doLevel : 0;
  const targetDo = typeof device?.targetDo === 'number' ? device.targetDo : 7.5;
  const minDoAlert = typeof device?.minDoAlert === 'number' ? device.minDoAlert : 5.0;
  const maxDoAlert = typeof device?.maxDoAlert === 'number' ? device.maxDoAlert : 12.0;
  const status = device?.status || 'OFF';
  const doSensorConnected = device?.doSensorConnected;
  // doSensorStatus is written by ESP32 firmware as "OK" or "MISSING"
  const doSensorStatus = (device as any)?.doSensorStatus as string | undefined;

  // Sensor missing when ESP32 sends doSensorConnected=false OR doLevel < 0 OR undefined
  const isMissing = doSensorConnected === false || device?.doLevel === undefined || device?.doLevel === null || doLevel < 0;

  // ── Determine status tier & colours ─────────────────────────────────
  let statusText = 'Optimal Oxygenation';
  let badgeColor =
    'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800';
  let gaugeColor = '#0ea5e9'; // sky cyan

  if (isMissing) {
    statusText = 'DO SENSOR MISSING';
    badgeColor = 'bg-rose-600 text-white border-rose-700 animate-bounce font-black shadow-lg';
    gaugeColor = '#dc2626';
  } else if (doLevel < minDoAlert) {
    statusText = 'Low DO Warning';
    badgeColor =
      'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800 animate-pulse';
    gaugeColor = '#f43f5e';
  } else if (doLevel > maxDoAlert) {
    statusText = 'Super-Saturated';
    badgeColor =
      'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800';
    gaugeColor = '#f59e0b';
  } else if (doLevel >= 7.0) {
    statusText = 'High Nano-Bubble';
    badgeColor =
      'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800';
    gaugeColor = '#0284c7';
  }

  // ── SVG arc calculation (0–15 mg/L = 0–100%) ──────────────────────
  const maxScale = 15.0;
  const safeLevel = isMissing ? 0 : doLevel;
  const percentage = Math.min(Math.max((safeLevel / maxScale) * 100, 0), 100);
  const strokeDashoffset = 440 - (440 * percentage * 0.75) / 100; // 270° arc

  return (
    <div className="h-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 shadow-xs relative overflow-hidden transition-all flex flex-col justify-between w-full max-w-full">
      {/* Ambient glow */}
      <div
        className="absolute -top-24 -right-24 w-48 h-48 rounded-full blur-3xl opacity-20 pointer-events-none"
        style={{ backgroundColor: gaugeColor }}
      />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 shrink-0">
            <Waves className="w-4.5 h-4.5" />
          </div>
          <div>
            <h3 className="text-xs font-extrabold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
              Dissolved Oxygen
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
              Live Micro-Nano Bubble Concentration
            </p>
          </div>
        </div>

        <span
          className={`inline-flex items-center text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border text-center shrink-0 ${badgeColor}`}
        >
          {statusText}
        </span>
      </div>

      {/* ── Gauge ──────────────────────────────────────────────────── */}
      <div className="relative flex flex-col items-center justify-center my-auto py-1">
        <div className="relative w-48 h-40 sm:w-56 sm:h-48 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-225" viewBox="0 0 160 160">
            {/* Track */}
            <circle
              cx="80" cy="80" r="70"
              fill="none"
              stroke="currentColor"
              className="text-slate-100 dark:text-slate-800"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray="440"
              strokeDashoffset="110"
            />
            {/* Value arc */}
            <circle
              cx="80" cy="80" r="70"
              fill="none"
              stroke={gaugeColor}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray="440"
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-700 ease-out"
            />
          </svg>

          {/* Centre readout */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
            <div className="flex items-baseline gap-1">
              {isMissing ? (
                <span className="text-xl sm:text-2xl font-black text-rose-500 dark:text-rose-400 tracking-tight animate-pulse">
                  MISSING
                </span>
              ) : (
                <>
                  <span className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
                    {(doLevel ?? 0).toFixed(1)}
                  </span>
                  <span className="text-xs font-extrabold text-slate-500 dark:text-slate-400">mg/L</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1 mt-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
              <span>Target:</span>
              <strong className="text-sky-600 dark:text-sky-400">{(targetDo ?? 7.5).toFixed(1)} mg/L</strong>
            </div>

            {/* Bubble animation when generator ON & sensor connected */}
            {status === 'ON' && !isMissing && (
              <div className="flex gap-1.5 mt-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                <span className="w-2   h-2   rounded-full bg-sky-500 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-sky-300 animate-ping delay-100" />
              </div>
            )}
          </div>
        </div>

        {/* Scale labels */}
        <div className="w-full max-w-xs flex justify-between px-2 text-[10px] font-bold text-slate-400 mt-0">
          <span>0 mg/L</span>
          <span className="text-amber-500">Min: {(minDoAlert ?? 5.0).toFixed(1)}</span>
          <span className="text-sky-500">Target: {(targetDo ?? 7.5).toFixed(1)}</span>
          <span>15 mg/L</span>
        </div>
      </div>

      {/* ── Sensor Missing Banner ──────────────────────────────────── */}
      {isMissing && (
        <div className="mt-3 flex items-start gap-2.5 bg-rose-950/60 border border-rose-700/60 rounded-xl px-3.5 py-3">
          <WifiOff className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[11px] font-black text-rose-300 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              No Sensor Detected
            </p>
            <p className="text-[10px] text-rose-400/80 mt-0.5 leading-tight">
              {doSensorStatus === 'MISSING'
                ? 'ESP32 reports DO probe disconnected on GPIO 34. Check probe wiring.'
                : 'DO sensor signal lost. Verify the analog probe is connected and powered.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
