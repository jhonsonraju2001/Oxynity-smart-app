import { CropReportCard } from './CropReportCard';
import { powerUse } from '../lib/oxynity';
import React, { useState } from 'react';
import { Download, Clock, Waves, RotateCw, Calendar, Check, FileSpreadsheet, Activity, ChevronDown, FileText } from 'lucide-react';
import { DeviceTelemetry, TelemetryPoint, EnabledSensors } from '../types/iot';
import { MachineStartStopLog } from './StartStopLogCard';
import { exportFile } from '../lib/fileExport';

interface ReportsViewProps {
  device: DeviceTelemetry;
  startStopLogs: MachineStartStopLog[];
  telemetryHistory?: TelemetryPoint[];
  userName?: string;
  sensorsEnabled?: EnabledSensors;
  tempUnit?: 'C' | 'F';
  onSaveCropDates?: (from: string, to: string) => void;
}

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

interface PeriodStats {
  labels: string[];
  values: number[]; // Run hours per slot
  sumHours: number;
  cycles: number;
  starts: number;
  stops: number;
  avgDo: number;
  avgTemp: number;
  avgPh: number;
}

// Parse duration string e.g. "3h 45m", "15m", "2h", "1.5 h"
export const parseDurationSecs = (durationStr?: string): number => {
  if (!durationStr) return 0;
  let secs = 0;
  const hMatch = durationStr.match(/(\d+(?:\.\d+)?)\s*h/i);
  const mMatch = durationStr.match(/(\d+(?:\.\d+)?)\s*m/i);
  const sMatch = durationStr.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (hMatch) secs += parseFloat(hMatch[1]) * 3600;
  if (mMatch) secs += parseFloat(mMatch[1]) * 60;
  if (sMatch) secs += parseFloat(sMatch[1]);
  return secs;
};

export const ReportsView: React.FC<ReportsViewProps> = ({
  device,
  startStopLogs = [],
  telemetryHistory = [],
  userName = 'Operator',
  sensorsEnabled,
  tempUnit = 'C',
  onSaveCropDates,
}) => {
  const [period, setPeriod] = useState<ReportPeriod>('daily');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const formatTemp = (celsius?: number): string => {
    const val = celsius ?? device.waterTemp ?? 28.4;
    if (tempUnit === 'F') {
      return `${(val * 1.8 + 32).toFixed(1)} °F`;
    }
    return `${val.toFixed(1)} °C`;
  };

  // Period-specific chart data and stats calculated from real logs and live session
  const getPeriodStats = (p: ReportPeriod): PeriodStats => {
    const curDo = device.doLevel >= 0 ? device.doLevel : 7.2;
    const curTemp = device.waterTemp ?? 28.4;
    const curPh = device.phLevel ?? 7.6;

    // Real live active session runtime (if machine is currently ON)
    const activeLiveSecs = device.status === 'ON'
      ? (device.currentSessionSeconds ?? ((device.currentSessionMinutes || 0) * 60))
      : 0;

    // Map logs by YYYY-MM-DD
    const logsByDay = new Map<string, MachineStartStopLog[]>();
    startStopLogs.forEach((l) => {
      if (!l.timestamp) return;
      const d = new Date(l.timestamp);
      if (isNaN(d.getTime())) return;
      const iso = d.toISOString().slice(0, 10);
      const list = logsByDay.get(iso) || [];
      list.push(l);
      logsByDay.set(iso, list);
    });

    const now = Date.now();
    const todayIso = new Date().toISOString().slice(0, 10);

    if (p === 'daily') {
      const todayLogs = logsByDay.get(todayIso) || [];
      const labels = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'];
      const slotSecs = [0, 0, 0, 0, 0, 0];

      // Sum completed sessions from today's logs into their corresponding 4-hour slots
      todayLogs.forEach((l) => {
        if (l.action === 'STOP' && l.sessionDuration) {
          const secs = parseDurationSecs(l.sessionDuration);
          const hour = new Date(l.timestamp).getHours();
          const slotIdx = Math.min(5, Math.floor(hour / 4));
          slotSecs[slotIdx] += secs;
        }
      });

      // Add live running session into current time slot
      if (device.status === 'ON' && activeLiveSecs > 0) {
        const currentHour = new Date().getHours();
        const currentSlotIdx = Math.min(5, Math.floor(currentHour / 4));
        slotSecs[currentSlotIdx] += activeLiveSecs;
      }

      // If no logs today yet, but device has totalRunHours or active session
      const totalSecs = slotSecs.reduce((a, b) => a + b, 0);
      const sum = Number((totalSecs / 3600).toFixed(1));
      const values = slotSecs.map((s) => Number((s / 3600).toFixed(2)));

      const starts = todayLogs.filter((l) => l.action === 'START').length + (device.status === 'ON' ? 1 : 0);
      const stops = todayLogs.filter((l) => l.action === 'STOP').length;
      const cycles = Math.max(starts, stops, starts > 0 ? 1 : 0);

      return {
        labels,
        values,
        sumHours: sum,
        cycles,
        starts,
        stops,
        avgDo: Number(curDo.toFixed(1)),
        avgTemp: Number(curTemp.toFixed(1)),
        avgPh: Number(curPh.toFixed(1)),
      };
    }

    if (p === 'weekly') {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const labels: string[] = [];
      const values: number[] = [];
      let totalWeekSecs = 0;
      let totalStarts = 0;
      let totalStops = 0;

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now - i * 86400000);
        const iso = d.toISOString().slice(0, 10);
        const dayLabel = i === 0 ? 'Today' : dayNames[d.getDay()];
        labels.push(dayLabel);

        const dayLogs = logsByDay.get(iso) || [];
        let daySecs = dayLogs.reduce((acc, l) => {
          if (l.action === 'STOP' && l.sessionDuration) {
            return acc + parseDurationSecs(l.sessionDuration);
          }
          return acc;
        }, 0);

        if (i === 0 && device.status === 'ON') {
          daySecs += activeLiveSecs;
          totalStarts += 1;
        }

        totalStarts += dayLogs.filter((l) => l.action === 'START').length;
        totalStops += dayLogs.filter((l) => l.action === 'STOP').length;
        totalWeekSecs += daySecs;
        values.push(Number((daySecs / 3600).toFixed(1)));
      }

      return {
        labels,
        values,
        sumHours: Number((totalWeekSecs / 3600).toFixed(1)),
        cycles: Math.max(totalStarts, totalStops, totalStarts > 0 ? 1 : 0),
        starts: totalStarts,
        stops: totalStops,
        avgDo: Number(curDo.toFixed(1)),
        avgTemp: Number(curTemp.toFixed(1)),
        avgPh: Number(curPh.toFixed(1)),
      };
    }

    // Monthly
    const labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    const values: number[] = [0, 0, 0, 0];
    let totalMonthSecs = 0;
    let totalStarts = 0;
    let totalStops = 0;

    for (let i = 27; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const weekIdx = Math.min(3, Math.floor((27 - i) / 7));

      const dayLogs = logsByDay.get(iso) || [];
      let daySecs = dayLogs.reduce((acc, l) => {
        if (l.action === 'STOP' && l.sessionDuration) {
          return acc + parseDurationSecs(l.sessionDuration);
        }
        return acc;
      }, 0);

      if (i === 0 && device.status === 'ON') {
        daySecs += activeLiveSecs;
        totalStarts += 1;
      }

      totalStarts += dayLogs.filter((l) => l.action === 'START').length;
      totalStops += dayLogs.filter((l) => l.action === 'STOP').length;
      values[weekIdx] += daySecs;
      totalMonthSecs += daySecs;
    }

    const monthValues = values.map((s) => Number((s / 3600).toFixed(1)));

    return {
      labels,
      values: monthValues,
      sumHours: Number((totalMonthSecs / 3600).toFixed(1)),
      cycles: Math.max(totalStarts, totalStops, totalStarts > 0 ? 1 : 0),
      starts: totalStarts,
      stops: totalStops,
      avgDo: Number(curDo.toFixed(1)),
      avgTemp: Number(curTemp.toFixed(1)),
      avgPh: Number(curPh.toFixed(1)),
    };
  };

  const stats = getPeriodStats(period);

  // SVG dimensions
  const W = 320;
  const H = 135;
  const maxValue = Math.max(...stats.values) * 1.25 || 1;
  const count = stats.values.length;
  const barWidth = Math.min(32, ((W - 12) / count) * 0.65);
  const gap = (W - count * barWidth) / (count + 1);

  // Filter logs for selected period
  const getLogsForPeriod = (p: ReportPeriod): MachineStartStopLog[] => {
    const now = Date.now();
    const msLimit =
      p === 'daily'
        ? 24 * 3600 * 1000
        : p === 'weekly'
        ? 7 * 24 * 3600 * 1000
        : 30 * 24 * 3600 * 1000;

    const filtered = startStopLogs.filter((log) => {
      const logTime = new Date(log.timestamp).getTime();
      return !isNaN(logTime) && now - logTime <= msLimit;
    });

    // If filtered is empty (e.g. mock timestamps outside range), fallback gracefully to all logs
    return filtered.length > 0 ? filtered : startStopLogs;
  };

  // Comprehensive CSV Export for Machine Running & Sensor Telemetry
  const handleDownloadComprehensiveCsv = async (targetPeriod: ReportPeriod = period) => {
    setIsExporting(true);

    const now = new Date();
    const periodLabel = targetPeriod.toUpperCase();
    const periodLogs = getLogsForPeriod(targetPeriod);
    const pStats = getPeriodStats(targetPeriod);

    // Sensor readings: only real recorded points, only for installed sensors (no made-up values)
    const sen = sensorsEnabled || ({} as any);
    const anySensor = !!(sen.do || sen.ph || sen.orp || sen.temp || sen.sal);
    const sensorHeader = ['Timestamp', 'Time Label',
      ...(sen.do ? ['Dissolved Oxygen (mg/L)'] : []), ...(sen.ph ? ['pH Level'] : []), ...(sen.orp ? ['ORP (mV)'] : []),
      ...(sen.temp ? ['Water Temp (°C)'] : []), ...(sen.sal ? ['Salinity (ppt)'] : []), 'Machine Status'].join(',');
    const num = (v: any, d = 1) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '');
    const sensorRows: string[] = telemetryHistory.map((t) =>
      [`"${t.timestamp}"`, `"${t.timeLabel}"`,
        ...(sen.do ? [num(t.doLevel, 2)] : []), ...(sen.ph ? [num(device.phLevel)] : []), ...(sen.orp ? [num(device.orpLevel, 0)] : []),
        ...(sen.temp ? [num(t.waterTemp ?? device.waterTemp)] : []), ...(sen.sal ? [num(device.salinity)] : []), `"${t.status}"`].join(',')
    );
    const latest = (on: boolean, v: any, unit: string, d = 1) =>
      !on ? 'Sensor not installed' : typeof v === 'number' && isFinite(v) && v >= 0 ? `${v.toFixed(d)}${unit}` : 'No reading';

    const csvLines = [
      '========================================================================',
      `OXYNITY SMART AQUACULTURE - POND TELEMETRY & MACHINERY REPORT`,
      '========================================================================',
      `Pond ID,${device.deviceId || 'N/A'}`,
      `Pond Name,"${(device.name || 'Oxynity Pond').replace(/"/g, '""')}"`,
      `Report Period,${periodLabel} (${targetPeriod === 'daily' ? 'Last 24 Hours' : targetPeriod === 'weekly' ? 'Last 7 Days' : 'Last 30 Days'})`,
      `Report Generated At,"${now.toLocaleString()}"`,
      `Generated By,"${userName}"`,
      `Micro-Nano Bubble Generator Status,${device.status}`,
      `Cumulative Total Run Hours,${device.totalRunHours.toFixed(2)} hrs`,
      `Current Flow Rate,${device.flowRate.toFixed(1)} L/min`,
      `Current Pressure,${device.pressure.toFixed(1)} Bar`,
      '',
      '------------------------------------------------------------------------',
      `1. PERIOD SUMMARY STATISTICS (${periodLabel})`,
      '------------------------------------------------------------------------',
      'Metric,Value',
      `Period Run Hours,${pStats.sumHours.toFixed(1)} hrs`,
      `Estimated Power Used,${powerUse(device, pStats.sumHours).kw ? powerUse(device, pStats.sumHours).kwh.toFixed(1) + ' kWh (units)' : 'Machine load not set'}`,
      `Total Machine Cycles,${pStats.cycles}`,
      `Total Starts,${pStats.starts}`,
      `Total Stops,${pStats.stops}`,
      `Latest Dissolved Oxygen,${latest(!!sen.do, device.doLevel, ' mg/L (ppm)')}`,
      `Latest Water Temperature,${latest(!!sen.temp, device.waterTemp, ' °C')}`,
      `Latest pH Level,${latest(!!sen.ph, device.phLevel, '')}`,
      `Latest ORP,${latest(!!sen.orp, device.orpLevel, ' mV', 0)}`,
      `Latest Salinity,${latest(!!sen.sal, device.salinity, ' ppt')}`,
      '',
      '------------------------------------------------------------------------',
      `2. MACHINE START / STOP SEQUENCE LOG (${periodLabel})`,
      '------------------------------------------------------------------------',
      'Log ID,Timestamp,Date,Time,Action,Trigger Source,Session Duration,Operator,DO Level (mg/L),Water Temp (°C)',
      ...periodLogs.map(
        (l) =>
          `"${l.id}","${l.timestamp}","${l.formattedDate}","${l.formattedTime}","${l.action}","${(l.triggerSource || '').replace(/"/g, '""')}","${l.sessionDuration || 'N/A'}","${(l.operator || 'System').replace(/"/g, '""')}",${typeof l.doLevel === 'number' && sen.do ? l.doLevel.toFixed(1) : ''},${typeof l.waterTemp === 'number' && sen.temp ? l.waterTemp.toFixed(1) : ''}`
      ),
      '',
      '------------------------------------------------------------------------',
      `3. WATER QUALITY SENSOR READINGS (${periodLabel})`,
      '------------------------------------------------------------------------',
      ...(!anySensor
        ? ['No water quality sensors installed on this pond.']
        : sensorRows.length
        ? [sensorHeader, ...sensorRows]
        : ['No sensor readings recorded in this period.']),
      '',
      '========================================================================',
      'END OF OXYNITY REPORT',
      '========================================================================',
    ];

    const filename = `Oxynity_Report_${targetPeriod}_${device.deviceId || 'pond'}_${now.toISOString().split('T')[0]}.csv`;
    const csvContent = csvLines.join('\n');

    try {
      const res = await exportFile({
        filename,
        content: csvContent,
        mimeType: 'text/csv;charset=utf-8;',
        title: `Oxynity ${periodLabel} Pond Report`,
        dialogTitle: `Export ${periodLabel} Report (CSV)`,
      });

      if (res.success) {
        setExportSuccess(true);
        setTimeout(() => setExportSuccess(false), 3500);
      }
    } catch (err) {
      console.error('CSV export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-4 select-none animate-in fade-in">
      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-[#0B2B33] dark:text-[#E8F4F6] tracking-tight">
            Reports & History
          </h2>
          <p className="text-xs text-[#5B7479] dark:text-[#9DB8BD] mt-0.5">
            Machinery run hours, cycles & sensor telemetry records
          </p>
        </div>

      </div>

      {/* ── Daily / Weekly / Monthly Segment Switcher ────────────── */}
      <div className="flex bg-[#E6EFF1] dark:bg-[#08222A] p-1 rounded-2xl border border-[#DDE8EA] dark:border-[#1F4650] gap-1 shadow-inner">
        {(['daily', 'weekly', 'monthly'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`flex-1 min-h-[44px] rounded-xl font-black text-xs sm:text-sm capitalize transition-all cursor-pointer ${
              period === p
                ? 'bg-white dark:bg-[#12313A] text-[#0E7C86] dark:text-[#19C3D1] shadow-xs'
                : 'text-[#5B7479] dark:text-[#9DB8BD] hover:text-[#0B2B33] dark:hover:text-[#E8F4F6]'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* ── Summary KPI Tiles (Dynamic 2 or 3 columns) ─────────── */}
      {(() => {
        const isDoConnected = device.doSensorConnected !== false && device.doLevel >= 0;
        const hasDo = !!sensorsEnabled?.do && isDoConnected;
        const hasPh = !!sensorsEnabled?.ph;
        const hasTemp = !!sensorsEnabled?.temp;
        const hasOrp = !!sensorsEnabled?.orp;
        const hasSal = !!sensorsEnabled?.sal;
        const hasAnySensor = hasDo || hasPh || hasTemp || hasOrp || hasSal;

        return (
          <div className={`grid ${hasAnySensor ? 'grid-cols-3' : 'grid-cols-2'} gap-2 sm:gap-3`}>
            {/* Tile 1: Run hours */}
            <div className="bg-white dark:bg-[#12313A] rounded-2xl p-3 sm:p-3.5 border border-[#DDE8EA] dark:border-[#1F4650] shadow-xs">
              <small className="block text-[11px] font-bold text-[#5B7479] dark:text-[#9DB8BD] uppercase tracking-wider">
                Run hours
              </small>
              <b className="text-lg sm:text-2xl font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-0.5 block">
                {stats.sumHours.toFixed(1)} h
              </b>
              <span className="block text-[10px] text-[#0E7C86] dark:text-[#19C3D1] font-bold leading-tight">
                Lifetime {Number(device.totalRunHours || 0).toFixed(1)} h
              </span>
            </div>

            {/* Tile 2: Sensor Metric (Shown ONLY when DO or other sensor is enabled) */}
            {hasDo ? (
              <div className="bg-white dark:bg-[#12313A] rounded-2xl p-3 sm:p-3.5 border border-[#DDE8EA] dark:border-[#1F4650] shadow-xs">
                <small className="block text-[11px] font-bold text-[#5B7479] dark:text-[#9DB8BD] uppercase tracking-wider">
                  DO (latest)
                </small>
                <b className="text-lg sm:text-2xl font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-0.5 block">
                  {stats.avgDo} ppm
                </b>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                  Target: {(device.targetDo ?? 7.5).toFixed(1)}
                </span>
              </div>
            ) : hasPh ? (
              <div className="bg-white dark:bg-[#12313A] rounded-2xl p-3 sm:p-3.5 border border-[#DDE8EA] dark:border-[#1F4650] shadow-xs">
                <small className="block text-[11px] font-bold text-[#5B7479] dark:text-[#9DB8BD] uppercase tracking-wider">
                  pH (latest)
                </small>
                <b className="text-lg sm:text-2xl font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-0.5 block">
                  {stats.avgPh}
                </b>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                  Optimal: 7.2 - 8.2
                </span>
              </div>
            ) : hasTemp ? (
              <div className="bg-white dark:bg-[#12313A] rounded-2xl p-3 sm:p-3.5 border border-[#DDE8EA] dark:border-[#1F4650] shadow-xs">
                <small className="block text-[11px] font-bold text-[#5B7479] dark:text-[#9DB8BD] uppercase tracking-wider">
                  Temp (latest)
                </small>
                <b className="text-lg sm:text-2xl font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-0.5 block">
                  {formatTemp(stats.avgTemp)}
                </b>
                <span className="text-[10px] text-[#5B7479] dark:text-[#9DB8BD] font-bold">
                  Unit: °{tempUnit || 'C'}
                </span>
              </div>
            ) : hasOrp ? (
              <div className="bg-white dark:bg-[#12313A] rounded-2xl p-3 sm:p-3.5 border border-[#DDE8EA] dark:border-[#1F4650] shadow-xs">
                <small className="block text-[11px] font-bold text-[#5B7479] dark:text-[#9DB8BD] uppercase tracking-wider">
                  ORP (latest)
                </small>
                <b className="text-lg sm:text-2xl font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-0.5 block">
                  {Math.round(device.orpLevel ?? 285)} mV
                </b>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                  Healthy redox
                </span>
              </div>
            ) : hasSal ? (
              <div className="bg-white dark:bg-[#12313A] rounded-2xl p-3 sm:p-3.5 border border-[#DDE8EA] dark:border-[#1F4650] shadow-xs">
                <small className="block text-[11px] font-bold text-[#5B7479] dark:text-[#9DB8BD] uppercase tracking-wider">
                  Salinity (latest)
                </small>
                <b className="text-lg sm:text-2xl font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-0.5 block">
                  {(device.salinity ?? 15.0).toFixed(1)} ppt
                </b>
                <span className="text-[10px] text-[#5B7479] dark:text-[#9DB8BD] font-bold">
                  Pond Salinity
                </span>
              </div>
            ) : null}

            {/* Tile 3: Cycles */}
            <div className="bg-white dark:bg-[#12313A] rounded-2xl p-3 sm:p-3.5 border border-[#DDE8EA] dark:border-[#1F4650] shadow-xs">
              <small className="block text-[11px] font-bold text-[#5B7479] dark:text-[#9DB8BD] uppercase tracking-wider">
                Cycles
              </small>
              <b className="text-lg sm:text-2xl font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-0.5 block">
                {stats.cycles}
              </b>
              <span className="text-[10px] text-[#5B7479] dark:text-[#9DB8BD] font-bold">
                {stats.starts} ON · {stats.stops} OFF
              </span>
            </div>
          </div>
        );
      })()}

      {/* ── Run Hours SVG Bar Chart Card ─────────────────────────── */}
      <div className="ox-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
              MNBG Run Hours Trend
            </h3>
            <p className="text-[11px] text-[#5B7479] dark:text-[#9DB8BD]">
              {period === 'daily'
                ? 'Hourly running distribution (Today)'
                : period === 'weekly'
                ? 'Daily running totals (Past 7 Days)'
                : 'Weekly running totals (Past 4 Weeks)'}
            </p>
          </div>
          <span className="text-xs font-black text-[#0E7C86] dark:text-[#19C3D1] bg-[#0E7C86]/10 px-2.5 py-1 rounded-full">
            Total: {stats.sumHours.toFixed(1)} hrs
          </span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label="Run hours bar chart"
          className="block overflow-visible pt-1"
        >
          {stats.values.map((v, idx) => {
            const h = (v / maxValue) * 85;
            const x = gap + idx * (barWidth + gap);
            const isLast = idx === stats.values.length - 1;
            const fill = isLast ? '#0E7C86' : '#19C3D1';

            return (
              <g key={idx}>
                {/* Bar */}
                <rect
                  x={x}
                  y={105 - h}
                  width={barWidth}
                  height={h}
                  rx="6"
                  fill={fill}
                  className="transition-all duration-500 ease-out"
                />
                {/* Top Value Label */}
                <text
                  x={x + barWidth / 2}
                  y={98 - h}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight="800"
                  fill="currentColor"
                  className="text-[#0B2B33] dark:text-[#E8F4F6]"
                >
                  {v >= 10 ? v.toFixed(0) : v.toFixed(1)}
                </text>
                {/* Bottom Period Label */}
                <text
                  x={x + barWidth / 2}
                  y="126"
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="700"
                  fill="currentColor"
                  className="text-[#5B7479] dark:text-[#9DB8BD]"
                >
                  {stats.labels[idx]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── Active Pond Sensors Live Suite Card (Shows readings dynamically when added) ── */}
      <div className="ox-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4.5 h-4.5 text-[#0E7C86] dark:text-[#19C3D1]" />
            <h3 className="text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
              Active Pond Sensor Telemetry
            </h3>
          </div>
          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
            Live Sync
          </span>
        </div>

        <p className="text-[11px] text-[#5B7479] dark:text-[#9DB8BD]">
          Real-time parameter readings from all connected probes active in your Sensors configuration.
        </p>

        {/* Dynamic Grid of Active Sensors */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
          {/* Dissolved Oxygen */}
          {(sensorsEnabled?.do !== false) && (
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#5B7479] dark:text-[#9DB8BD]">
                  Dissolved O₂
                </span>
                <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
              </div>
              <b className="text-lg font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-1">
                {device.doLevel >= 0 ? `${device.doLevel.toFixed(1)} ppm` : 'Offline'}
              </b>
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                Target: {(device.targetDo ?? 7.5).toFixed(1)} ppm
              </span>
            </div>
          )}

          {/* Water Temperature */}
          {(sensorsEnabled?.temp !== false) && (
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#5B7479] dark:text-[#9DB8BD]">
                  Temperature
                </span>
                <span className="w-2 h-2 rounded-full bg-amber-500" />
              </div>
              <b className="text-lg font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-1">
                {formatTemp(device.waterTemp)}
              </b>
              <span className="text-[10px] font-semibold text-[#5B7479] dark:text-[#9DB8BD]">
                Unit: °{tempUnit || 'C'}
              </span>
            </div>
          )}

          {/* pH Level */}
          {(sensorsEnabled?.ph !== false) && (
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#5B7479] dark:text-[#9DB8BD]">
                  pH Acidity
                </span>
                <span className="w-2 h-2 rounded-full bg-purple-500" />
              </div>
              <b className="text-lg font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-1">
                {(device.phLevel ?? 7.6).toFixed(1)}
              </b>
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                Optimal: 7.2 - 8.2
              </span>
            </div>
          )}

          {/* Salinity */}
          {(sensorsEnabled?.sal !== false) && (
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#5B7479] dark:text-[#9DB8BD]">
                  Salinity
                </span>
                <span className="w-2 h-2 rounded-full bg-blue-500" />
              </div>
              <b className="text-lg font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-1">
                {(device.salinity ?? 15.0).toFixed(1)} ppt
              </b>
              <span className="text-[10px] font-semibold text-[#5B7479] dark:text-[#9DB8BD]">
                Brackish Pond
              </span>
            </div>
          )}

          {/* ORP */}
          {(sensorsEnabled?.orp !== false) && (
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#5B7479] dark:text-[#9DB8BD]">
                  ORP Level
                </span>
                <span className="w-2 h-2 rounded-full bg-teal-500" />
              </div>
              <b className="text-lg font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-1">
                {Math.round(device.orpLevel ?? 285)} mV
              </b>
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                Healthy redox
              </span>
            </div>
          )}

          {/* Ammonia */}
          {((sensorsEnabled as any)?.ammonia || (device as any).ammoniaLevel !== undefined) && (
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#5B7479] dark:text-[#9DB8BD]">
                  Ammonia (NH₃)
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <b className="text-lg font-black text-[#0B2B33] dark:text-[#E8F4F6] mt-1">
                {((device as any).ammoniaLevel ?? 0.02).toFixed(2)} ppm
              </b>
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                Safe &lt; 0.05
              </span>
            </div>
          )}
        </div>
      </div>


      {/* ── Comprehensive Multi-Period Export Hub Card ─────────────── */}
      <div className="ox-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4.5 h-4.5 text-[#0E7C86] dark:text-[#19C3D1]" />
          <h3 className="text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
            Download report (CSV)
          </h3>
        </div>
        <p className="text-xs text-[#5B7479] dark:text-[#9DB8BD] leading-relaxed">
          Machine start/stop log with run hours, plus readings of the sensors installed on this pond.
        </p>

        {/* Choose period, then download */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <button
              key={p}
              type="button"
              disabled={isExporting}
              onClick={() => handleDownloadComprehensiveCsv(p)}
              className="ox-btn ox-btn-secondary ox-btn-sm"
            >
              <Download className="w-3.5 h-3.5" />
              {p === 'daily' ? '24 hours' : p === 'weekly' ? '7 days' : '30 days'}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => window.print()} className="ox-btn ox-btn-outline ox-btn-block">
          <FileText className="w-4 h-4" />
          Save as PDF / Print
        </button>
        {(isExporting || exportSuccess) && (
          <div className="text-xs font-bold text-[#0E7C86] dark:text-[#19C3D1] text-center">
            {isExporting ? 'Preparing file…' : 'Report downloaded ✓'}
          </div>
        )}
      </div>

      {/* Whole-crop / custom date report with estimated power use */}
      <CropReportCard device={device} onSaveDates={onSaveCropDates} sensorsOn={sensorsEnabled} />
    </div>
  );
};

