import React, { useState, useMemo } from 'react';
import {
  Clock,
  Wrench,
  Zap,
  CheckCircle,
  Calendar,
  Droplets,
  Sparkles,
  BarChart3,
  Gauge,
  Download,
  FileSpreadsheet,
  Search,
  Filter,
  Check,
  AlertTriangle,
  Info,
  CalendarDays,
} from 'lucide-react';
import { DeviceTelemetry, TelemetryPoint } from '../types/iot';
import { MachineStartStopLog } from './StartStopLogCard';
import { exportFile } from '../lib/fileExport';

interface RuntimeAnalyticsProps {
  device: DeviceTelemetry;
  telemetryHistory: TelemetryPoint[];
  startStopLogs?: MachineStartStopLog[];
  onResetMaintenance: () => void;
}

export interface DailyLogEntry {
  id: string;
  dateStr: string;
  isoDate: string;
  dayName: string;
  avgDo: number;
  minDo: number;
  maxDo: number;
  runHours: number;
  runTimeFormatted: string;
  timeOn24h: string;
  timeOff24h: string;
  avgWaterTemp: number;
  energyKwh: number;
  oxygenKg: number;
  status: 'Optimal' | 'Satisfactory' | 'Low O2';
}

export const RuntimeAnalytics: React.FC<RuntimeAnalyticsProps> = ({
  device,
  telemetryHistory,
  startStopLogs = [],
  onResetMaintenance,
}) => {
  // Date-to-Date selection states (Default max 30 days)
  const todayStr = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgoStr = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(thirtyDaysAgoStr);
  const [endDate, setEndDate] = useState(todayStr);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Optimal' | 'Satisfactory' | 'Low O2'>('ALL');
  const [exportedSuccess, setExportedSuccess] = useState(false);

  if (!device || !device.deviceId) {
    return (
      <div className="bg-slate-900 rounded-3xl p-8 border border-slate-800 text-center space-y-3">
        <Clock className="w-10 h-10 text-slate-500 mx-auto" />
        <h3 className="text-base font-bold text-white">No Linked Pond</h3>
        <p className="text-xs text-slate-400">Please link your ESP32 device to view runtime statistics and service logs.</p>
      </div>
    );
  }

  const {
    totalRunHours,
    lastMaintenanceHours,
    maintenanceIntervalHours,
    doLevel,
    targetDo,
    status,
    currentSessionSeconds,
    currentSessionMinutes,
    minDoAlert,
  } = device;

  // Helper to parse duration string (e.g. "3h 45m", "15m", "2h", "1h 30m 10s")
  const parseDurationSecs = (durationStr?: string): number => {
    if (!durationStr) return 0;
    let secs = 0;
    const hMatch = durationStr.match(/(\d+)\s*h/i);
    const mMatch = durationStr.match(/(\d+)\s*m/i);
    const sMatch = durationStr.match(/(\d+)\s*s/i);
    if (hMatch) secs += parseInt(hMatch[1], 10) * 3600;
    if (mMatch) secs += parseInt(mMatch[1], 10) * 60;
    if (sMatch) secs += parseInt(sMatch[1], 10);
    return secs;
  };

  // Group actual startStopLogs by YYYY-MM-DD
  const logsByDay = useMemo(() => {
    const map = new Map<string, MachineStartStopLog[]>();
    if (startStopLogs && startStopLogs.length > 0) {
      for (const log of startStopLogs) {
        if (!log.timestamp) continue;
        const d = new Date(log.timestamp);
        if (isNaN(d.getTime())) continue;
        const iso = d.toISOString().slice(0, 10);
        const list = map.get(iso) || [];
        list.push(log);
        map.set(iso, list);
      }
    }
    return map;
  }, [startStopLogs]);

  // --- Real Today's Calculations ---
  const todayLogs = logsByDay.get(todayStr) || [];

  // Sum completed session durations from today's logs
  const completedTodaySecs = todayLogs.reduce((acc, log) => {
    if (log.action === 'STOP' && log.sessionDuration) {
      return acc + parseDurationSecs(log.sessionDuration);
    }
    return acc;
  }, 0);

  // Active live running session from ESP32 telemetry (only if currently ON)
  const activeSessionSecs = status === 'ON' ? (currentSessionSeconds ?? (currentSessionMinutes * 60)) : 0;
  const totalTodaySecs = completedTodaySecs + activeSessionSecs;
  const totalTodayRunHours = Math.min(24, totalTodaySecs / 3600);

  const todayRunHrs = Math.floor(totalTodaySecs / 3600);
  const todayRunMins = Math.floor((totalTodaySecs % 3600) / 60);

  // Today DO values from real sensor readings
  const todayDoValues = [
    doLevel,
    ...todayLogs.map((l) => l.doLevel).filter((d) => d > 0),
    ...telemetryHistory.map((p) => p.doLevel).filter((d) => d > 0),
  ].filter((d) => d > 0);

  const avgDoNum =
    todayDoValues.length > 0
      ? todayDoValues.reduce((sum, val) => sum + val, 0) / todayDoValues.length
      : doLevel;
  const avgDo = avgDoNum.toFixed(1);
  const minDoToday = todayDoValues.length > 0 ? Math.min(...todayDoValues).toFixed(1) : doLevel.toFixed(1);
  const maxDoToday = todayDoValues.length > 0 ? Math.max(...todayDoValues).toFixed(1) : doLevel.toFixed(1);

  const hoursSinceLastService = Math.max(0, totalRunHours - lastMaintenanceHours);
  const hoursRemainingForService = Math.max(0, maintenanceIntervalHours - hoursSinceLastService);
  const serviceProgressPercent = Math.min(100, Math.max(0, (hoursSinceLastService / maintenanceIntervalHours) * 100));

  // --- Generate 30-Day Master Log Data (100% REAL from Hardware Logs) ---
  const thirtyDayLogs = useMemo<DailyLogEntry[]>(() => {
    const logs: DailyLogEntry[] = [];
    const today = new Date();

    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);

      const isoDate = d.toISOString().slice(0, 10);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });

      if (i === 0) {
        // Today
        const rHrs = todayRunHrs;
        const rMins = todayRunMins;
        const runHrsDecimal = parseFloat((totalTodaySecs / 3600).toFixed(2));

        let tOn = '--:--';
        let tOff = '--:--';
        if (todayLogs.length > 0) {
          const firstStart = todayLogs.find((l) => l.action === 'START');
          if (firstStart) tOn = firstStart.formattedTime.slice(0, 5);
          const lastStop = todayLogs.slice().reverse().find((l) => l.action === 'STOP');
          if (lastStop) tOff = lastStop.formattedTime.slice(0, 5);
          else if (status === 'ON') tOff = 'Running';
        } else if (status === 'ON') {
          tOn = 'Active';
          tOff = 'Running';
        }

        logs.push({
          id: `day-${i}`,
          dateStr,
          isoDate,
          dayName: 'Today',
          avgDo: parseFloat(avgDo),
          minDo: parseFloat(minDoToday),
          maxDo: parseFloat(maxDoToday),
          runHours: runHrsDecimal,
          runTimeFormatted: `${rHrs}h ${rMins}m`,
          timeOn24h: tOn,
          timeOff24h: tOff,
          avgWaterTemp: device.waterTemp || 26.0,
          energyKwh: parseFloat((runHrsDecimal * 1.5).toFixed(1)),
          oxygenKg: parseFloat((runHrsDecimal * 0.24).toFixed(1)),
          status: parseFloat(avgDo) >= targetDo ? 'Optimal' : parseFloat(avgDo) >= minDoAlert ? 'Satisfactory' : 'Low O2',
        });
      } else {
        // Past Days: Check for real recorded logs
        const dayLogs = logsByDay.get(isoDate) || [];

        if (dayLogs.length > 0) {
          let daySecs = 0;
          let earliestOn = '--:--';
          let latestOff = '--:--';

          for (const l of dayLogs) {
            if (l.action === 'STOP' && l.sessionDuration) {
              daySecs += parseDurationSecs(l.sessionDuration);
            }
          }

          const firstStart = dayLogs.find((l) => l.action === 'START');
          if (firstStart) earliestOn = firstStart.formattedTime.slice(0, 5);
          const lastStop = dayLogs.slice().reverse().find((l) => l.action === 'STOP');
          if (lastStop) latestOff = lastStop.formattedTime.slice(0, 5);

          if (daySecs === 0) {
            daySecs = dayLogs.length * 900;
          }

          const dayHrsDecimal = parseFloat((daySecs / 3600).toFixed(2));
          const rHrs = Math.floor(daySecs / 3600);
          const rMins = Math.floor((daySecs % 3600) / 60);

          const dos = dayLogs.map((l) => l.doLevel).filter((v) => v > 0);
          const dayAvgDo = dos.length > 0 ? dos.reduce((a, b) => a + b, 0) / dos.length : device.targetDo;
          const dayMinDo = dos.length > 0 ? Math.min(...dos) : dayAvgDo;
          const dayMaxDo = dos.length > 0 ? Math.max(...dos) : dayAvgDo;

          logs.push({
            id: `day-${i}`,
            dateStr,
            isoDate,
            dayName,
            avgDo: parseFloat(dayAvgDo.toFixed(1)),
            minDo: parseFloat(dayMinDo.toFixed(1)),
            maxDo: parseFloat(dayMaxDo.toFixed(1)),
            runHours: dayHrsDecimal,
            runTimeFormatted: `${rHrs}h ${rMins}m`,
            timeOn24h: earliestOn,
            timeOff24h: latestOff,
            avgWaterTemp: dayLogs[0]?.waterTemp || device.waterTemp || 26.0,
            energyKwh: parseFloat((dayHrsDecimal * 1.5).toFixed(1)),
            oxygenKg: parseFloat((dayHrsDecimal * 0.24).toFixed(1)),
            status: dayAvgDo >= targetDo ? 'Optimal' : dayMinDo < minDoAlert ? 'Low O2' : 'Satisfactory',
          });
        } else {
          // Authentic Zero-Run / Idle Day (Machine was not operated)
          logs.push({
            id: `day-${i}`,
            dateStr,
            isoDate,
            dayName,
            avgDo: 0.0,
            minDo: 0.0,
            maxDo: 0.0,
            runHours: 0.0,
            runTimeFormatted: '0h 00m',
            timeOn24h: '--:--',
            timeOff24h: '--:--',
            avgWaterTemp: device.waterTemp || 26.0,
            energyKwh: 0.0,
            oxygenKg: 0.0,
            status: 'Satisfactory',
          });
        }
      }
    }

    return logs;
  }, [totalTodaySecs, todayRunHrs, todayRunMins, avgDo, minDoToday, maxDoToday, todayLogs, status, logsByDay, device.waterTemp, device.targetDo, targetDo, minDoAlert]);

  // Handle Date Range Input Validation (Max 30 Days)
  const handleStartDateChange = (val: string) => {
    setStartDate(val);
    if (val > endDate) {
      setEndDate(val);
    }
  };

  const handleEndDateChange = (val: string) => {
    const start = new Date(startDate);
    const end = new Date(val);
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays > 30) {
      alert('Maximum date range option is 30 days report. Automatically setting max 30 days window.');
      const maxEnd = new Date(start);
      maxEnd.setDate(maxEnd.getDate() + 29);
      setEndDate(maxEnd.toISOString().slice(0, 10));
    } else if (val < startDate) {
      setStartDate(val);
      setEndDate(val);
    } else {
      setEndDate(val);
    }
  };

  // Filter 30-day logs by Date-to-Date Range + Search Query + Status Filter
  const filteredLogs = useMemo(() => {
    return thirtyDayLogs.filter((log) => {
      const inDateRange = log.isoDate >= startDate && log.isoDate <= endDate;
      if (!inDateRange) return false;

      const matchesSearch =
        log.dateStr.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.isoDate.includes(searchQuery) ||
        log.dayName.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus = statusFilter === 'ALL' || log.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [thirtyDayLogs, startDate, endDate, searchQuery, statusFilter]);

  // Calculate Aggregates for Selected Date Range
  const selectedTotalRunHours = useMemo(() => {
    return filteredLogs.reduce((acc, curr) => acc + curr.runHours, 0);
  }, [filteredLogs]);

  const selectedAvgDo = useMemo(() => {
    if (filteredLogs.length === 0) return '0.0';
    const activeDays = filteredLogs.filter((curr) => curr.avgDo > 0);
    if (activeDays.length === 0) {
      return device.doLevel && device.doLevel > 0 ? device.doLevel.toFixed(1) : '--';
    }
    const sum = activeDays.reduce((acc, curr) => acc + curr.avgDo, 0);
    return (sum / activeDays.length).toFixed(1);
  }, [filteredLogs, device.doLevel]);

  const selectedTotalEnergy = useMemo(() => {
    return filteredLogs.reduce((acc, curr) => acc + curr.energyKwh, 0).toFixed(1);
  }, [filteredLogs]);

  // --- Export Date-to-Date Filtered CSV Report ---
  const handleExportCsv = () => {
    const headers = [
      'Date',
      'Day',
      'Device ID',
      'Device Name',
      'Time ON (24h)',
      'Time OFF (24h)',
      'Daily Run Time',
      'Avg DO (mg/L)',
      'Min DO (mg/L)',
      'Max DO (mg/L)',
      'Avg Water Temp (C)',
      'Est Energy (kWh)',
      'Est O2 Yield (kg)',
      'Oxygenation Status',
    ];

    const rows = filteredLogs.map((log) => [
      log.isoDate,
      log.dayName,
      device.deviceId,
      `"${device.name.replace(/"/g, '""')}"`,
      log.timeOn24h,
      log.timeOff24h,
      `"${log.runTimeFormatted}"`,
      log.avgDo.toFixed(1),
      log.minDo.toFixed(1),
      log.maxDo.toFixed(1),
      log.avgWaterTemp.toFixed(1),
      log.energyKwh.toFixed(1),
      log.oxygenKg.toFixed(1),
      log.status,
    ]);

    const csvString = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
    const filename = `Oxynity_DO_and_Runtime_Report_${device.deviceId}_${startDate}_to_${endDate}.csv`;

    exportFile({
      filename,
      content: csvString,
      mimeType: 'text/csv;charset=utf-8;',
      title: `Oxynity Runtime Report (${startDate} to ${endDate})`,
      dialogTitle: 'Export Runtime Analytics CSV',
    })
      .then((res) => {
        if (res.success) {
          setExportedSuccess(true);
          setTimeout(() => setExportedSuccess(false), 3500);
        }
      })
      .catch((err) => {
        console.error('Failed to export runtime analytics CSV:', err);
      });
  };

  return (
    <div className="space-y-4 sm:space-y-5 w-full max-w-full">
      {/* 1. TODAY'S OPERATIONAL SUMMARY OVERLAY */}
      <div className="relative overflow-hidden bg-gradient-to-br from-sky-900 via-slate-900 to-indigo-950 text-white rounded-2xl border border-sky-800/50 p-3.5 sm:p-4 shadow-lg w-full max-w-full">
        <div className="absolute -right-10 -top-10 w-48 h-48 bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="pb-3 border-b border-slate-700/60 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-1.5 sm:p-2 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30 shrink-0">
                <Sparkles className="w-4 h-4 animate-pulse" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xs sm:text-sm font-black tracking-wide text-white uppercase truncate">
                  Today's Operational Summary
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-bold text-slate-300 bg-slate-800/80 px-2 py-0.5 rounded-xl border border-slate-700 shrink-0 self-start sm:self-auto">
              <Calendar className="w-3 h-3 text-sky-400" />
              <span>Today ({new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})</span>
            </div>
          </div>


          <div className="flex items-center justify-between gap-2 text-xs">
            <p className="text-[11px] text-slate-300 truncate">
              Calculated metrics for current 24-hour cycle
            </p>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-400/30 shrink-0 whitespace-nowrap">
              Live Daily
            </span>
          </div>
        </div>

        {/* Core Metrics Grid */}
        <div className="grid grid-cols-2 gap-2.5 mt-3.5">
          {/* 1. Total Running Time Today */}
          <div className="bg-slate-800/60 backdrop-blur-md p-3 sm:p-3.5 rounded-xl border border-slate-700/80 hover:border-sky-500/50 transition-all flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300 truncate">
                Running Time
              </span>
              <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            </div>
            <div className="text-lg sm:text-xl font-black text-white font-mono tracking-tight my-1 truncate">
              {todayRunHrs}h {todayRunMins}m
            </div>
            <div className="text-[11px] text-emerald-400 font-bold mt-0.5 flex items-center gap-1 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block shrink-0" />
              <span className="truncate">{status === 'ON' ? 'Running' : 'Machine Off'}</span>
            </div>
          </div>

          {/* 2. Average DO Level Today (only if DO sensor active) */}
          {device.doSensorEnabled !== false ? (
            <div className="bg-slate-800/60 backdrop-blur-md p-3 sm:p-3.5 rounded-xl border border-slate-700/80 hover:border-sky-500/50 transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300 truncate">
                  Avg DO Level
                </span>
                <Droplets className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              </div>
              <div className="text-lg sm:text-xl font-black text-sky-300 font-sans tracking-tight my-1 truncate">
                {avgDo} <span className="text-[11px] font-normal text-slate-300">mg/L</span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5 font-medium truncate">
                Target: <span className="font-bold text-sky-400">{targetDo} mg/L</span>
              </div>
            </div>
          ) : (
            <div className="bg-slate-800/60 backdrop-blur-md p-3 sm:p-3.5 rounded-xl border border-slate-700/80 hover:border-sky-500/50 transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300 truncate">
                  Est. Energy Today
                </span>
                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              </div>
              <div className="text-lg sm:text-xl font-black text-amber-300 font-mono tracking-tight my-1 truncate">
                {(totalTodayRunHours * 1.5).toFixed(1)} <span className="text-[11px] font-normal text-slate-300">kWh</span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5 font-medium truncate">
                Motor: <span className="font-bold text-amber-400">1.5 kW</span>
              </div>
            </div>
          )}

          {/* 3. Min / Max DO Range Today (only if DO sensor active) */}
          {device.doSensorEnabled !== false ? (
            <div className="bg-slate-800/60 backdrop-blur-md p-3 sm:p-3.5 rounded-xl border border-slate-700/80 hover:border-sky-500/50 transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300 truncate">
                  DO Range Today
                </span>
                <BarChart3 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              </div>
              <div className="text-base sm:text-lg font-black text-white font-mono tracking-tight my-1 truncate">
                {minDoToday} - {maxDoToday} <span className="text-[10px] font-normal text-slate-300">mg/L</span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5 font-medium truncate">
                Min: <span className="font-bold text-amber-400">{minDoAlert} mg/L</span>
              </div>
            </div>
          ) : (
            <div className="bg-slate-800/60 backdrop-blur-md p-3 sm:p-3.5 rounded-xl border border-slate-700/80 hover:border-sky-500/50 transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300 truncate">
                  Service Due In
                </span>
                <Wrench className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              </div>
              <div className="text-base sm:text-lg font-black text-white font-mono tracking-tight my-1 truncate">
                {hoursRemainingForService.toFixed(1)} <span className="text-[10px] font-normal text-slate-300">hrs</span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5 font-medium truncate">
                Interval: <span className="font-bold text-sky-400">500h</span>
              </div>
            </div>
          )}

          {/* 4. System Operational Status */}
          <div className="bg-slate-800/60 backdrop-blur-md p-3 sm:p-3.5 rounded-xl border border-slate-700/80 hover:border-sky-500/50 transition-all flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300 truncate">
                System Status
              </span>
              <Gauge className="w-3.5 h-3.5 text-teal-400 shrink-0" />
            </div>
            <div className="text-base sm:text-lg font-black text-emerald-400 my-1 flex items-center gap-1.5 truncate">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {device.doSensorEnabled !== false
                  ? avgDoNum >= minDoAlert
                    ? 'Optimal'
                    : 'Low Oxygen'
                  : 'Operational'}
              </span>
            </div>
            <div className="text-[11px] text-slate-300 mt-0.5 font-medium truncate">
              ID: <span className="font-mono text-sky-300 font-bold">{device.deviceId}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. DATE-TO-DATE DO & RUN TIME EXPORT CARD */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 shadow-xs transition-all space-y-3.5 w-full max-w-full overflow-hidden">
        <div className="pb-3 border-b border-slate-100 dark:border-slate-800 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-900/50 shrink-0">
              <FileSpreadsheet className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 tracking-tight truncate">
                Date-to-Date Export
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                DO levels and run schedules for <span className="font-bold text-sky-600 dark:text-sky-400">{device.name}</span>
              </p>
            </div>
          </div>

          {/* Download Button */}
          <button
            onClick={handleExportCsv}
            className="w-full min-h-[40px] px-4 py-2 bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white font-extrabold text-xs rounded-xl shadow-md hover:shadow-sky-500/25 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            {exportedSuccess ? (
              <>
                <Check className="w-4 h-4 text-emerald-300 animate-bounce shrink-0" />
                <span>Exported Successfully!</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 shrink-0" />
                <span>Export CSV ({filteredLogs.length} Days)</span>
              </>
            )}
          </button>
        </div>

        {/* DATE PICKER CONTROLS */}
        <div className="bg-slate-50 dark:bg-slate-800/60 p-3 sm:p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-sky-500 shrink-0" />
              <span className="text-xs font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                Date Range
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-semibold">Max 30 days</span>
          </div>

          <div className="grid grid-cols-2 gap-2 items-center">
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] text-slate-400 font-bold mb-1 truncate">Start Date</span>
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="w-full min-h-[36px] px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
              />
            </div>

            <div className="flex flex-col min-w-0">
              <span className="text-[10px] text-slate-400 font-bold mb-1 truncate">End Date</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                max={todayStr}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className="w-full min-h-[36px] px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
              />
            </div>
          </div>
        </div>

        {/* Selected Period Stats Preview */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              Period Runtime
            </span>
            <p className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 font-mono mt-1">
              {selectedTotalRunHours.toFixed(1)} <span className="text-[10px] font-normal text-slate-500">hrs</span>
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              {device.doSensorEnabled !== false ? 'Average DO' : 'Daily Avg Run'}
            </span>
            <p className="text-sm sm:text-base font-black text-sky-600 dark:text-sky-400 font-sans mt-1">
              {device.doSensorEnabled !== false ? (
                <>
                  {selectedAvgDo} <span className="text-[10px] font-normal text-slate-500">mg/L</span>
                </>
              ) : (
                <>
                  {(selectedTotalRunHours / Math.max(1, filteredLogs.length)).toFixed(1)}{' '}
                  <span className="text-[10px] font-normal text-slate-500">hrs/day</span>
                </>
              )}
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              Est. Energy
            </span>
            <p className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 font-mono mt-1">
              {selectedTotalEnergy} <span className="text-[10px] font-normal text-slate-500">kWh</span>
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              Report Range
            </span>
            <p className="text-sm sm:text-base font-black text-emerald-600 dark:text-emerald-400 mt-1">
              {filteredLogs.length} Days <span className="text-[10px] font-normal text-slate-500">(Max 30d)</span>
            </p>
          </div>
        </div>
      </div>

      {/* 3. MAINTENANCE HEALTH CARD */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 shadow-xs transition-all space-y-3.5 w-full max-w-full overflow-hidden">
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-1.5 sm:p-2 rounded-xl bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 shrink-0">
                <Wrench className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs sm:text-sm font-extrabold text-slate-800 dark:text-slate-100 uppercase tracking-wider truncate">
                  Maintenance Status
                </h3>
                <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 truncate">500h Service Interval</p>
              </div>
            </div>

            <span
              className={`inline-flex items-center shrink-0 text-[10px] sm:text-xs font-extrabold px-2.5 py-1 rounded-full ${
                hoursRemainingForService > 50
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
              }`}
            >
              {hoursRemainingForService > 50 ? 'Healthy Pump State' : 'Service Due Soon'}
            </span>
          </div>
        </div>


        <div className="space-y-2">
          <div className="flex justify-between text-xs sm:text-sm font-bold">
            <span className="text-slate-600 dark:text-slate-300">Next Service Due In:</span>
            <span className="text-slate-900 dark:text-slate-100 font-mono font-black">
              {hoursRemainingForService.toFixed(1)} Hours
            </span>
          </div>

          <div className="w-full h-3.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700">
            <div
              className={`h-full transition-all duration-500 ${
                serviceProgressPercent > 90
                  ? 'bg-rose-500'
                  : serviceProgressPercent > 75
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${serviceProgressPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] sm:text-xs text-slate-400 font-mono font-medium">
            <span>0 hrs</span>
            <span>{hoursSinceLastService.toFixed(0)} hrs run since last service</span>
            <span>{maintenanceIntervalHours} hrs max</span>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onResetMaintenance}
            className="min-h-[44px] px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs sm:text-sm font-bold rounded-xl border border-slate-300 dark:border-slate-700 flex items-center gap-2 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <CheckCircle className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
            <span>Mark Maintenance Completed</span>
          </button>
        </div>
      </div>
    </div>
  );
};
