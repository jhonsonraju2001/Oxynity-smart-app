import React, { useState, useEffect } from 'react';
import { DeviceTelemetry, EnabledSensors } from '../types/iot';
import { Waves, Thermometer, Droplets, Activity, Gauge, WifiOff } from 'lucide-react';

interface AnimatedSensorsProps {
  device: DeviceTelemetry;
  isOnline?: boolean;
  sensorsEnabled?: EnabledSensors;
}

const defaultSensors: EnabledSensors = {
  do: true,
  ph: true,
  orp: true,
  temp: true,
  sal: true,
};

// Temperature color gradient interpolator (15°C cold to 40°C hot)
const TEMP_STOPS: [number, [number, number, number]][] = [
  [15, [59, 130, 214]],  // Cold Blue
  [22, [25, 195, 209]],  // Aqua
  [28, [61, 184, 107]],  // Optimal Green
  [32, [242, 209, 60]],  // Warm Yellow
  [36, [240, 138, 60]],  // Amber Orange
  [40, [229, 72, 77]],   // Danger Red
];

function getTemperatureColor(tempC: number): string {
  const v = Math.min(40, Math.max(15, tempC));
  for (let i = 0; i < TEMP_STOPS.length - 1; i++) {
    const a = TEMP_STOPS[i][0];
    const b = TEMP_STOPS[i + 1][0];
    if (v >= a && v <= b) {
      const t = (v - a) / (b - a);
      const ca = TEMP_STOPS[i][1];
      const cb = TEMP_STOPS[i + 1][1];
      const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
      const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
      const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
      return `rgb(${r}, ${g}, ${bl})`;
    }
  }
  return '#E5484D';
}

export const AnimatedSensors: React.FC<AnimatedSensorsProps> = ({
  device,
  isOnline = true,
  sensorsEnabled = defaultSensors,
}) => {
  const [activeFilter, setActiveFilter] = useState<'all' | 'do' | 'ph' | 'orp' | 'temp' | 'sal'>('all');
  const [tempUnit, setTempUnit] = useState<'C' | 'F'>(() => {
    return (localStorage.getItem('oxynity_temp_unit') as any) || 'C';
  });

  useEffect(() => {
    const handleUnit = (e: any) => {
      if (e.detail && (e.detail === 'C' || e.detail === 'F')) {
        setTempUnit(e.detail);
      }
    };
    window.addEventListener('oxynity_temp_unit_change', handleUnit);
    return () => window.removeEventListener('oxynity_temp_unit_change', handleUnit);
  }, []);

  const hasAnyEnabled =
    sensorsEnabled.do ||
    sensorsEnabled.ph ||
    sensorsEnabled.orp ||
    sensorsEnabled.temp ||
    sensorsEnabled.sal;

  const effectiveFilter =
    activeFilter !== 'all' && !sensorsEnabled[activeFilter] ? 'all' : activeFilter;

  // No sensor installed / switched on for this pond: hide the whole section.
  if (!hasAnyEnabled) return null;

  const filterButtons = [
    { key: 'all' as const, label: 'All', show: hasAnyEnabled },
    { key: 'do' as const, label: 'DO', show: sensorsEnabled.do },
    { key: 'ph' as const, label: 'pH', show: sensorsEnabled.ph },
    { key: 'orp' as const, label: 'ORP', show: sensorsEnabled.orp },
    { key: 'temp' as const, label: 'Temp', show: sensorsEnabled.temp },
    { key: 'sal' as const, label: 'Salinity', show: sensorsEnabled.sal },
  ].filter((b) => b.show);

  // Sensor Telemetry Values with realistic live fallbacks
  const doVal = device?.doLevel;
  const isDoMissing = device?.doSensorConnected === false || doVal === undefined || doVal === null || doVal < 0;
  const targetDo = device?.targetDo ?? 7.5;
  const minDoAlert = device?.minDoAlert ?? 5.0;

  const phVal = Number(((device?.phLevel ?? 7.6)).toFixed(1));
  const orpVal = Math.round(device?.orpLevel ?? 285);
  const tempValC = Number(((device?.waterTemp ?? 28.4)).toFixed(1));
  const tempDisplay = tempUnit === 'F' ? Number((tempValC * 1.8 + 32).toFixed(1)) : tempValC;
  const salVal = Number(((device?.salinity ?? 15.0)).toFixed(1));

  // DO Arc stroke-dasharray (0 to 10 ppm = 0 to 352 offset)
  const safeDo = isDoMissing || doVal === undefined || doVal === null ? 0 : Math.max(0, Math.min(10, doVal));
  const doArcLength = (safeDo / 10) * 352;
  const isDoCrit = !isDoMissing && doVal !== undefined && doVal !== null && doVal < 3.0;
  const isDoLow = !isDoMissing && doVal !== undefined && doVal !== null && doVal < minDoAlert;

  // pH tilt: clamp((ph - 7) * 10, -18, 18)
  const phTiltDeg = Math.min(18, Math.max(-18, (phVal - 7) * 10));

  // ORP needle rotation: clamp(orp / 500, 0, 1) * 180
  const orpDeg = Math.min(180, Math.max(0, (orpVal / 500) * 180));

  // Temperature mercury y-value
  const tempY = Math.min(140, Math.max(16, 140 - ((tempValC - 15) / 25) * 124));
  const tempHeight = 150 - tempY;
  const tempColor = getTemperatureColor(tempValC);

  // Salinity marker translateX (8px to 310px across 0-40 ppt)
  const salX = 8 + 302 * Math.min(1, Math.max(0, salVal / 40));

  // DO chip classification
  let doChip: { text: string; bg: string; textCol: string } = {
    text: 'Optimal · In range',
    bg: 'bg-emerald-100 dark:bg-emerald-950/80',
    textCol: 'text-emerald-800 dark:text-emerald-300',
  };
  if (isDoMissing) {
    doChip = {
      text: 'Sensor Missing',
      bg: 'bg-rose-100 dark:bg-rose-950/80',
      textCol: 'text-rose-800 dark:text-rose-300',
    };
  } else if (isDoCrit) {
    doChip = {
      text: 'Critical · below 3.0',
      bg: 'bg-rose-100 dark:bg-rose-950/80',
      textCol: 'text-rose-800 dark:text-rose-300',
    };
  } else if (isDoLow) {
    doChip = {
      text: `Low · below ${(minDoAlert ?? 5.0).toFixed(1)}`,
      bg: 'bg-amber-100 dark:bg-amber-950/80',
      textCol: 'text-amber-800 dark:text-amber-300',
    };
  }

  // pH chip
  const phChip = phVal < 7.5
    ? { text: 'Acidic · below 7.5', bg: 'bg-amber-100 dark:bg-amber-950', textCol: 'text-amber-800 dark:text-amber-300' }
    : phVal > 8.5
    ? { text: 'Alkaline · above 8.5', bg: 'bg-sky-100 dark:bg-sky-950', textCol: 'text-sky-800 dark:text-sky-300' }
    : { text: 'Optimal · 7.5–8.5', bg: 'bg-emerald-100 dark:bg-emerald-950', textCol: 'text-emerald-800 dark:text-emerald-300' };

  // ORP chip
  const orpChip = orpVal < 200
    ? { text: 'Low reduction', bg: 'bg-amber-100 dark:bg-amber-950', textCol: 'text-amber-800 dark:text-amber-300' }
    : orpVal > 350
    ? { text: 'High oxidation', bg: 'bg-rose-100 dark:bg-rose-950', textCol: 'text-rose-800 dark:text-rose-300' }
    : { text: 'Safe · 200–350 mV', bg: 'bg-emerald-100 dark:bg-emerald-950', textCol: 'text-emerald-800 dark:text-emerald-300' };

  // Temperature chip
  const tempChip = tempValC < 26
    ? { text: 'Cool · below 26°C', bg: 'bg-sky-100 dark:bg-sky-950', textCol: 'text-sky-800 dark:text-sky-300' }
    : tempValC > 32
    ? { text: 'Warm · above 32°C', bg: 'bg-amber-100 dark:bg-amber-950', textCol: 'text-amber-800 dark:text-amber-300' }
    : { text: 'Optimal · 26–32°C', bg: 'bg-emerald-100 dark:bg-emerald-950', textCol: 'text-emerald-800 dark:text-emerald-300' };

  // Salinity chip
  const salChip = salVal < 10
    ? { text: 'Low brackish', bg: 'bg-sky-100 dark:bg-sky-950', textCol: 'text-sky-800 dark:text-sky-300' }
    : salVal > 25
    ? { text: 'High saline', bg: 'bg-amber-100 dark:bg-amber-950', textCol: 'text-amber-800 dark:text-amber-300' }
    : { text: 'Optimal · 10–25 ppt', bg: 'bg-emerald-100 dark:bg-emerald-950', textCol: 'text-emerald-800 dark:text-emerald-300' };

  return (
    <div className="space-y-3.5 select-none">
      {/* ── Section Title & Filter Tabs ───────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Activity className="w-4.5 h-4.5 text-[#0E7C86] dark:text-[#19C3D1]" />
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-100">
            Water Quality Sensors
          </h2>
        </div>

        {/* Quick Filter Segment Buttons */}
        {hasAnyEnabled && filterButtons.length > 1 && (
          <div className="flex self-start max-w-full bg-[#E6EFF1] dark:bg-[#08222A] p-1 rounded-xl border border-[#DDE8EA] dark:border-[#1F4650] overflow-x-auto no-scrollbar">
            {filterButtons.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveFilter(key)}
                className={`px-3 py-1 text-[11px] font-extrabold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  effectiveFilter === key
                    ? 'bg-white dark:bg-[#12313A] text-[#0E7C86] dark:text-[#19C3D1] shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!hasAnyEnabled ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 p-8 text-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400 flex items-center justify-center mx-auto mb-3">
            <Gauge className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">All Sensors Switched Off</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
            No sensors turned on. Open the Sensors tab and switch a sensor on to see it here on Home.
          </p>
        </div>
      ) : (
        <>
          {/* ── 1. DISSOLVED OXYGEN CARD ─────────────────────────────── */}
          {sensorsEnabled.do && (effectiveFilter === 'all' || effectiveFilter === 'do') && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs relative overflow-hidden transition-all flex items-center justify-between gap-4">
          {/* Ambient Glow */}
          <div
            className="absolute -top-12 -left-12 w-36 h-36 rounded-full blur-3xl opacity-20 pointer-events-none"
            style={{ backgroundColor: isDoCrit ? '#E5484D' : isDoLow ? '#E8A33D' : '#19C3D1' }}
          />

          {/* Left Text Info */}
          <div className="min-w-0 flex-1 z-10">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Dissolved Oxygen (DO)
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              {isDoMissing ? (
                <span className="text-2xl font-black text-rose-500 dark:text-rose-400 tracking-tight animate-pulse">
                  MISSING
                </span>
              ) : (
                <>
                  <span className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
                    {doVal !== undefined && doVal !== null ? doVal.toFixed(1) : '—'}
                  </span>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">ppm (mg/L)</span>
                </>
              )}
            </div>
            <span
              className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border border-slate-300 dark:border-slate-700 ${doChip.bg} ${doChip.textCol}`}
            >
              {doChip.text}
            </span>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
              Target: <strong className="text-cyan-600 dark:text-cyan-400">{(targetDo ?? 7.5).toFixed(1)} ppm</strong> · Aeration {device?.status === 'ON' ? 'Active' : 'Standby'}
            </p>
          </div>

          {/* Right DO Glow Ring SVG */}
          <div className="relative shrink-0 flex items-center justify-center">
            <svg
              className={`w-36 h-36 sm:w-40 sm:h-40 doring ${isDoCrit ? 'crit' : isDoLow ? 'low' : ''}`}
              viewBox="0 0 160 168"
              role="img"
              aria-label="Dissolved oxygen glow ring"
            >
              <defs>
                <filter id="glw" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="5" />
                </filter>
              </defs>

              {/* Pulsing Outer Halo Ring */}
              <circle
                className="halo2"
                cx="80"
                cy="80"
                r="56"
                fill="none"
                style={{ stroke: 'var(--c)' }}
                strokeWidth="2"
              />

              {/* Background Track */}
              <circle
                cx="80"
                cy="80"
                r="56"
                fill="none"
                style={{ stroke: 'var(--zone, #24444D)' }}
                strokeWidth="12"
              />

              {/* Glowing Value Arc */}
              <circle
                cx="80"
                cy="80"
                r="56"
                fill="none"
                strokeWidth="16"
                strokeLinecap="round"
                transform="rotate(-90 80 80)"
                filter="url(#glw)"
                style={{
                  stroke: 'var(--c)',
                  opacity: 0.5,
                  strokeDasharray: `${doArcLength} 352`,
                  transition: 'stroke-dasharray .8s ease',
                }}
              />

              {/* Sharp Value Arc */}
              <circle
                cx="80"
                cy="80"
                r="56"
                fill="none"
                strokeWidth="12"
                strokeLinecap="round"
                transform="rotate(-90 80 80)"
                style={{
                  stroke: 'var(--c)',
                  strokeDasharray: `${doArcLength} 352`,
                  transition: 'stroke-dasharray .8s ease',
                }}
              />

              {/* Orbiting Particle */}
              <g className="orb">
                <circle cx="80" cy="24" r="9" style={{ fill: 'var(--c)' }} opacity=".35" />
                <circle cx="80" cy="24" r="4" fill="#fff" />
              </g>

              {/* Ticks at 5 and 9 ppm */}
              <path d="M80.0 144.0L80.0 153.0" style={{ stroke: 'var(--ink, #0B2B33)' }} strokeWidth="2.5" />
              <text
                x="80"
                y="167"
                textAnchor="middle"
                fontSize="10"
                fontWeight="800"
                style={{ fill: 'var(--ink, #0B2B33)' }}
              >
                5
              </text>
              <path d="M42.4 28.2L37.1 20.9" style={{ stroke: 'var(--ink, #0B2B33)' }} strokeWidth="2.5" />
              <text
                x="31"
                y="17"
                textAnchor="middle"
                fontSize="10"
                fontWeight="800"
                style={{ fill: 'var(--ink, #0B2B33)' }}
              >
                9
              </text>

              {/* Center DO Readout */}
              <text
                x="80"
                y="88"
                textAnchor="middle"
                fontSize="26"
                fontWeight="800"
                style={{ fill: 'var(--ink, #E8F4F6)' }}
              >
                {isDoMissing || doVal === undefined || doVal === null ? '—' : doVal.toFixed(1)}
              </text>
              <text
                x="80"
                y="104"
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                style={{ fill: 'var(--mut, #9DB8BD)' }}
              >
                ppm
              </text>
            </svg>
          </div>
        </div>
      )}

      {/* ── 2. pH BALANCE SCALE CARD ─────────────────────────────── */}
      {sensorsEnabled.ph && (effectiveFilter === 'all' || effectiveFilter === 'ph') && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs relative overflow-hidden transition-all flex items-center justify-between gap-4">
          {/* Left Text Info */}
          <div className="min-w-0 flex-1 z-10">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Pond pH Acidity / Alkalinity
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
                {(phVal ?? 7.4).toFixed(1)}
              </span>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">pH</span>
            </div>
            <span
              className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border border-slate-300 dark:border-slate-700 ${phChip.bg} ${phChip.textCol}`}
            >
              {phChip.text}
            </span>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
              {phVal > 7.4 ? 'Water leaning alkaline (Base)' : 'Water leaning acidic (Acid)'} · Ideal: 7.5–8.5
            </p>
          </div>

          {/* Right pH Seesaw Balance Animation */}
          <div className="relative shrink-0 flex items-center justify-center">
            <svg
              className="w-36 h-28 sm:w-40 sm:h-32 block"
              viewBox="0 0 170 112"
              role="img"
              aria-label="Acid base balance scale"
            >
              {/* Fulcrum base triangle */}
              <path d="M85 66L70 104H100Z" style={{ fill: 'var(--ink, #1F4650)' }} />

              {/* Seesaw Beam that rotates according to pH tilt */}
              <g
                style={{
                  transformOrigin: '85px 64px',
                  transform: `rotate(${phTiltDeg}deg)`,
                  transition: 'transform 1.2s ease',
                }}
              >
                {/* Rocking motion */}
                <g className="rock" style={{ transformOrigin: '85px 64px' }}>
                  <rect x="12" y="60" width="146" height="8" rx="4" style={{ fill: 'var(--ink, #1F4650)' }} />
                  <path d="M22 60V40M48 60V40" style={{ stroke: 'var(--ink, #1F4650)' }} strokeWidth="2" />
                  {/* Left ACID Pan (Red) */}
                  <path d="M12 40H58L52 56H18Z" fill="#E5484D" />
                  <path d="M122 60V40M148 60V40" style={{ stroke: 'var(--ink, #1F4650)' }} strokeWidth="2" />
                  {/* Right BASE Pan (Blue) */}
                  <path d="M112 40H158L152 56H118Z" fill="#3B82D6" />
                  <text
                    x="35"
                    y="31"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="800"
                    style={{ fill: 'var(--ink, #E8F4F6)' }}
                  >
                    ACID
                  </text>
                  <text
                    x="135"
                    y="31"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="800"
                    style={{ fill: 'var(--ink, #E8F4F6)' }}
                  >
                    BASE
                  </text>
                </g>
              </g>

              {/* Fulcrum Center Pivot Circle */}
              <circle cx="85" cy="64" r="6" fill="#22B7A5" stroke="#fff" strokeWidth="2" />
            </svg>
          </div>
        </div>
      )}

      {/* ── 3. ORP VOLTMETER CARD ────────────────────────────────── */}
      {sensorsEnabled.orp && (effectiveFilter === 'all' || effectiveFilter === 'orp') && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs relative overflow-hidden transition-all flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1 z-10">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Oxidation-Reduction Potential (ORP)
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
                {orpVal}
              </span>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">mV</span>
            </div>
            <span
              className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border border-slate-300 dark:border-slate-700 ${orpChip.bg} ${orpChip.textCol}`}
            >
              {orpChip.text}
            </span>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
              Safe sanitation range: 200–350 mV
            </p>
          </div>

          {/* Voltmeter SVG Gauge */}
          <div className="relative shrink-0 flex items-center justify-center">
            <svg
              className="w-36 h-28 sm:w-40 sm:h-32 block"
              viewBox="0 0 200 126"
              role="img"
              aria-label="ORP voltmeter"
            >
              {/* Amber Zone: 0 - 200 */}
              <path d="M22.0 100.0A78 78 0 0 1 75.9 25.8" fill="none" stroke="#E8A33D" strokeWidth="14" />
              {/* Green Zone: 200 - 350 */}
              <path d="M75.9 25.8A78 78 0 0 1 145.8 36.9" fill="none" stroke="#1E9E5A" strokeWidth="14" />
              {/* Red Zone: 350 - 500 */}
              <path d="M145.8 36.9A78 78 0 0 1 178.0 100.0" fill="none" stroke="#E5484D" strokeWidth="14" />

              {/* Swaying Needle */}
              <g
                style={{
                  transformOrigin: '100px 100px',
                  transform: `rotate(${orpDeg}deg)`,
                  transition: 'transform 1.2s ease',
                }}
              >
                <g className="sway" style={{ transformOrigin: '100px 100px' }}>
                  <path d="M100 100L42 100" style={{ stroke: 'var(--ink, #E8F4F6)' }} strokeWidth="3.5" strokeLinecap="round" />
                  <circle cx="40" cy="100" r="4.5" style={{ fill: 'var(--ink, #E8F4F6)' }} />
                </g>
              </g>

              {/* Center Pivot Pin */}
              <circle cx="100" cy="100" r="8" style={{ fill: 'var(--ink, #E8F4F6)' }} />

              {/* Markings */}
              <text x="12" y="120" fontSize="10" fontWeight="800" style={{ fill: 'var(--ink, #E8F4F6)' }}>
                0
              </text>
              <text x="188" y="120" textAnchor="end" fontSize="10" fontWeight="800" style={{ fill: 'var(--ink, #E8F4F6)' }}>
                500
              </text>
              <text
                x="100"
                y="124"
                textAnchor="middle"
                fontSize="18"
                fontWeight="800"
                style={{ fill: 'var(--ink, #E8F4F6)' }}
              >
                {orpVal}
              </text>
            </svg>
          </div>
        </div>
      )}

      {/* ── 4. WATER TEMPERATURE THERMOMETER CARD ────────────────── */}
      {sensorsEnabled.temp && (effectiveFilter === 'all' || effectiveFilter === 'temp') && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs relative overflow-hidden transition-all flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1 z-10">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                Water Temperature
              </span>
              <button
                onClick={() => setTempUnit((u) => (u === 'C' ? 'F' : 'C'))}
                className="text-[10px] font-extrabold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-cyan-600 dark:text-cyan-400 border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                Switch to °{tempUnit === 'C' ? 'F' : 'C'}
              </button>
            </div>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
                {tempDisplay}
              </span>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">°{tempUnit}</span>
            </div>
            <span
              className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border border-slate-300 dark:border-slate-700 ${tempChip.bg} ${tempChip.textCol}`}
            >
              {tempChip.text}
            </span>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
              Safe growth range: 26°C – 32°C (79°F – 90°F)
            </p>
          </div>

          {/* Thermometer Tube & Bulb Animation */}
          <div className="relative shrink-0 flex items-center justify-center">
            <svg
              className="w-28 h-36 sm:w-32 sm:h-40 block"
              viewBox="0 0 130 170"
              role="img"
              aria-label="Water thermometer"
            >
              {/* Glass Tube */}
              <rect
                x="52"
                y="10"
                width="16"
                height="140"
                rx="8"
                style={{ fill: 'var(--glass, #1B3A43)', stroke: 'var(--teal, #19C3D1)' }}
                strokeWidth="3"
              />
              <circle
                cx="60"
                cy="150"
                r="17"
                style={{ fill: 'var(--glass, #1B3A43)', stroke: 'var(--teal, #19C3D1)' }}
                strokeWidth="3"
              />
              <rect x="54" y="136" width="12" height="20" style={{ fill: 'var(--glass, #1B3A43)' }} />

              {/* Pulsing Glow Bulb */}
              <circle cx="60" cy="150" r="12" fill={tempColor} opacity=".45">
                <animate attributeName="r" values="12;28" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values=".5;0" dur="1.6s" repeatCount="indefinite" />
              </circle>

              {/* Mercury Column */}
              <rect
                x="56"
                y={tempY}
                width="8"
                height={tempHeight}
                rx="3"
                fill={tempColor}
                style={{ transition: 'all 1s ease' }}
              />
              {/* Solid Bulb */}
              <circle cx="60" cy="150" r="12" fill={tempColor} />

              {/* Scale Tick Marks */}
              <path
                d="M40 115.2H47M40 90.4H47M40 65.6H47M40 40.8H47M40 16H47"
                style={{ stroke: 'var(--ink, #E8F4F6)' }}
                strokeOpacity=".5"
                strokeWidth="1.5"
              />
              <path d="M72 85.4H82M72 55.7H82" style={{ stroke: 'var(--ink, #E8F4F6)' }} strokeWidth="2" />
              <text x="86" y="89" fontSize="10" fontWeight="800" style={{ fill: 'var(--ink, #E8F4F6)' }}>
                26
              </text>
              <text x="86" y="60" fontSize="10" fontWeight="800" style={{ fill: 'var(--ink, #E8F4F6)' }}>
                32
              </text>
            </svg>
          </div>
        </div>
      )}

      {/* ── 5. SALINITY SPECTRUM BAR CARD ────────────────────────── */}
      {sensorsEnabled.sal && (effectiveFilter === 'all' || effectiveFilter === 'sal') && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs relative overflow-hidden transition-all space-y-2.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                Water Salinity (Salt Concentration)
              </span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
                  {salVal}
                </span>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">ppt</span>
              </div>
            </div>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border border-slate-300 dark:border-slate-700 ${salChip.bg} ${salChip.textCol}`}
            >
              {salChip.text}
            </span>
          </div>

          {/* Salinity Gradient Track with Moving Light Shimmer and Bobbing Pin */}
          <svg viewBox="0 0 318 100" width="100%" role="img" aria-label="Fresh to salt scale" className="block">
            <defs>
              <linearGradient id="sg1" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#D5F1F5" />
                <stop offset=".4" stopColor="#19C3D1" />
                <stop offset=".75" stopColor="#0E7C86" />
                <stop offset="1" stopColor="#0B3C5D" />
              </linearGradient>
              <linearGradient id="sg2" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset=".5" stopColor="#fff" stopOpacity=".5" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <clipPath id="sc1">
                <rect x="8" y="58" width="302" height="18" rx="9" />
              </clipPath>
            </defs>

            {/* Base Spectrum Bar */}
            <rect x="8" y="58" width="302" height="18" rx="9" fill="url(#sg1)" />

            {/* Moving Shimmer Beam */}
            <g clipPath="url(#sc1)">
              <rect y="58" width="50" height="18" fill="url(#sg2)">
                <animate attributeName="x" values="-50;320" dur="3s" repeatCount="indefinite" />
              </rect>
            </g>

            {/* Target Optimal Brackish Box */}
            <rect
              x="86.5"
              y="54"
              width="75.5"
              height="26"
              rx="6"
              fill="none"
              style={{ stroke: 'var(--ink, #E8F4F6)' }}
              strokeWidth="2"
              strokeDasharray="4 3"
            >
              <animate attributeName="opacity" values=".4;1;.4" dur="1.6s" repeatCount="indefinite" />
            </rect>

            {/* Fresh Water Droplet with Expanding Ripple */}
            <path d="M18 15C18 15 11 24 11 28A7 7 0 0 0 25 28C25 24 18 15 18 15Z" fill="#19C3D1" />
            <ellipse cx="18" cy="38" rx="4" ry="1.6" fill="none" stroke="#19C3D1" strokeWidth="1.5" opacity="0">
              <animate attributeName="rx" values="4;16" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values=".8;0" dur="1.6s" repeatCount="indefinite" />
            </ellipse>

            {/* Salt Crystal 3D graphic on right side */}
            <g transform="translate(298 26) scale(1.5)">
              <path
                d="M0 -8L7 -4V4L0 8L-7 4V-4Z"
                fill="#E6F2F7"
                stroke="#0B2B33"
                strokeWidth=".8"
                strokeLinejoin="round"
              />
              <path d="M0 0V8M0 0L-7 -4M0 0L7 -4" stroke="#0B2B33" strokeWidth=".8" fill="none" />
            </g>
            {/* Sparkle Flash */}
            <path
              d="M312 8V16M308 12H316"
              stroke="#F2B01E"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0"
            >
              <animate attributeName="opacity" values="0;1;0" dur="1.4s" repeatCount="indefinite" />
            </path>

            {/* Bobbing Pin Indicator pointing to exact ppt reading */}
            <g
              style={{
                transform: `translateX(${salX}px)`,
                transition: 'transform 1.2s ease',
              }}
            >
              <g className="bobm">
                <path d="M0 52L-8 38A10 10 0 1 1 8 38Z" fill="#19C3D1" stroke="#fff" strokeWidth="2" />
                <circle cx="0" cy="32" r="3.5" fill="#fff" />
              </g>
            </g>

            {/* Scale Labels */}
            <text x="8" y="94" fontSize="10" fontWeight="800" style={{ fill: 'var(--ink, #E8F4F6)' }}>
              0 ppt
            </text>
            <text
              x="310"
              y="94"
              textAnchor="end"
              fontSize="10"
              fontWeight="800"
              style={{ fill: 'var(--ink, #E8F4F6)' }}
            >
              40 ppt
            </text>
          </svg>
        </div>
      )}
    </>
  )}
</div>
  );
};
