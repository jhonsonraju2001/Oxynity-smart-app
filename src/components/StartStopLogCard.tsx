import React, { useState } from 'react';
import {
  Power,
  Play,
  Square,
  Clock,
  Filter,
  Download,
  CheckCircle2,
  AlertCircle,
  Zap,
  RotateCcw,
  Search,
  Check,
  Calendar,
  Layers,
  Activity,
} from 'lucide-react';
import { DeviceTelemetry } from '../types/iot';
import { exportFile } from '../lib/fileExport';

export interface MachineStartStopLog {
  id: string;
  timestamp: string; // ISO string
  formattedTime: string; // e.g. "08:30:15 AM"
  formattedDate: string; // e.g. "Aug 06, 2026"
  action: 'START' | 'STOP';
  triggerSource: string;
  doLevel: number;
  waterTemp?: number;
  sessionDuration?: string; // e.g. "3h 45m" (populated for STOP actions)
  operator?: string;
}

interface StartStopLogCardProps {
  device: DeviceTelemetry;
  logs: MachineStartStopLog[];
  onClearLogs?: () => void;
}

export const StartStopLogCard: React.FC<StartStopLogCardProps> = ({
  device,
  logs,
  onClearLogs,
}) => {
  const [filterAction, setFilterAction] = useState<'ALL' | 'START' | 'STOP' | 'AUTO'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [exportedSuccess, setExportedSuccess] = useState(false);

  // Filter logs logic
  const filteredLogs = logs.filter((log) => {
    // Action filter
    if (filterAction === 'START' && log.action !== 'START') return false;
    if (filterAction === 'STOP' && log.action !== 'STOP') return false;
    if (filterAction === 'AUTO' && !log.triggerSource.includes('Auto')) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchDate = log.formattedDate.toLowerCase().includes(q);
      const matchTime = log.formattedTime.toLowerCase().includes(q);
      const matchTrigger = log.triggerSource.toLowerCase().includes(q);
      const matchAction = log.action.toLowerCase().includes(q);
      return matchDate || matchTime || matchTrigger || matchAction;
    }

    return true;
  });

  // Calculate statistics
  const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  const todayLogs = logs.filter((l) => l.formattedDate === todayStr || l.timestamp.startsWith(new Date().toISOString().split('T')[0]));
  const todayStarts = todayLogs.filter((l) => l.action === 'START').length;
  const todayStops = todayLogs.filter((l) => l.action === 'STOP').length;
  const totalCyclesToday = todayStarts + todayStops;

  const latestLog = logs[0];

  // CSV Export
  const handleExportCsv = () => {
    const headers = [
      'Log ID',
      'Device ID',
      'Device Name',
      'Action (START/STOP)',
      'Date',
      'Time',
      'Trigger Source',
      'DO Level (mg/L)',
      'Water Temp (°C)',
      'Session Duration',
      'Operator',
    ];

    const rows = filteredLogs.map((l) => [
      l.id,
      device.deviceId,
      `"${device.name.replace(/"/g, '""')}"`,
      l.action,
      l.formattedDate,
      l.formattedTime,
      `"${l.triggerSource}"`,
      l.doLevel.toFixed(1),
      l.waterTemp.toFixed(1),
      l.sessionDuration || 'N/A',
      l.operator || 'System',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const filename = `Machine_StartStop_Log_${device.deviceId}_${new Date().toISOString().split('T')[0]}.csv`;

    exportFile({
      filename,
      content: csvContent,
      mimeType: 'text/csv;charset=utf-8;',
      title: `Oxynity Machine Start/Stop Log (${device.name || device.deviceId})`,
      dialogTitle: 'Export Machine Start/Stop CSV Log',
    })
      .then((res) => {
        if (res.success) {
          setExportedSuccess(true);
          setTimeout(() => setExportedSuccess(false), 3000);
        }
      })
      .catch((err) => {
        console.error('Failed to export start/stop CSV log:', err);
      });
  };

  // View mode state for mobile/desktop preference
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 shadow-xs transition-all space-y-3.5 w-full max-w-full overflow-hidden">
      {/* 1. Header & Quick Actions */}
      <div className="flex flex-col gap-2.5 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start gap-2.5">
          <div
            className={`p-2 rounded-xl border shrink-0 ${
              device.status === 'ON'
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/80 shadow-xs'
                : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/80 shadow-xs'
            }`}
          >
            <Power className="w-4.5 h-4.5 animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 tracking-tight">
                Machine Start / Stop Sequence Log
              </h3>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black border shrink-0 ${
                  device.status === 'ON'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                    : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    device.status === 'ON' ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'
                  }`}
                />
                Currently {device.status}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              Timeline logs for <span className="font-bold text-sky-600 dark:text-sky-400">{device.name}</span>
            </p>
          </div>
        </div>

        {/* Action Buttons & View Toggle */}
        <div className="flex items-center gap-2 justify-between flex-wrap">
          {/* Mobile view toggle */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl text-xs">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                viewMode === 'cards'
                  ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Cards
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Table
            </button>
          </div>

          <button
            onClick={handleExportCsv}
            className="min-h-[32px] px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
            title="Download Start/Stop Log CSV"
          >
            {exportedSuccess ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Exported!</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                <span>Export CSV</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. Today's Power Cycle KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-2">
        {/* Today's Starts */}
        <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              Today's Starts
            </span>
            <div className="p-1 bg-emerald-100 dark:bg-emerald-950/80 rounded-lg text-emerald-600 dark:text-emerald-400 shrink-0">
              <Play className="w-3 h-3 fill-current" />
            </div>
          </div>
          <p className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 font-mono mt-1">
            {todayStarts} <span className="text-[10px] font-normal text-slate-500">starts</span>
          </p>
        </div>

        {/* Today's Stops */}
        <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              Today's Stops
            </span>
            <div className="p-1 bg-amber-100 dark:bg-amber-950/80 rounded-lg text-amber-600 dark:text-amber-400 shrink-0">
              <Square className="w-3 h-3 fill-current" />
            </div>
          </div>
          <p className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 font-mono mt-1">
            {todayStops} <span className="text-[10px] font-normal text-slate-500">stops</span>
          </p>
        </div>

        {/* Total Power Cycles */}
        <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              24h Power Cycles
            </span>
            <div className="p-1 bg-sky-100 dark:bg-sky-950/80 rounded-lg text-sky-600 dark:text-sky-400 shrink-0">
              <Activity className="w-3 h-3" />
            </div>
          </div>
          <p className="text-sm sm:text-base font-black text-sky-600 dark:text-sky-400 font-mono mt-1">
            {totalCyclesToday} <span className="text-[10px] font-normal text-slate-500">events</span>
          </p>
        </div>

        {/* Last Activity Time */}
        <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              Last State Switch
            </span>
            <div className="p-1 bg-purple-100 dark:bg-purple-950/80 rounded-lg text-purple-600 dark:text-purple-400 shrink-0">
              <Clock className="w-3 h-3" />
            </div>
          </div>
          <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 font-mono mt-1 truncate">
            {latestLog ? `${latestLog.action} @ ${latestLog.formattedTime}` : 'No recent switches'}
          </p>
        </div>
      </div>

      {/* 3. Filter & Search Controls */}
      <div className="flex flex-col gap-2 pt-1">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-[11px] overflow-x-auto no-scrollbar">
          <button
            onClick={() => setFilterAction('ALL')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap cursor-pointer ${
              filterAction === 'ALL'
                ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            All ({logs.length})
          </button>
          <button
            onClick={() => setFilterAction('START')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 ${
              filterAction === 'START'
                ? 'bg-emerald-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-emerald-600'
            }`}
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Starts</span>
          </button>
          <button
            onClick={() => setFilterAction('STOP')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 ${
              filterAction === 'STOP'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-amber-600'
            }`}
          >
            <Square className="w-3 h-3 fill-current" />
            <span>Stops</span>
          </button>
          <button
            onClick={() => setFilterAction('AUTO')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 ${
              filterAction === 'AUTO'
                ? 'bg-sky-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-sky-600'
            }`}
          >
            <Zap className="w-3 h-3" />
            <span>Auto</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search date, time, or trigger..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[36px] pl-8 pr-3 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
          />
        </div>
      </div>

      {/* 4. Logs Content Display (Cards for Mobile / Table or Cards based on viewMode) */}
      {viewMode === 'cards' ? (
        /* RESPONSIVE NON-OVERFLOWING CARD TIMELINE LIST VIEW */
        <div className="space-y-2 w-full">
          {filteredLogs.length > 0 ? (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className={`p-2.5 rounded-xl border transition-all bg-slate-50/80 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 flex flex-col gap-1.5 text-xs w-full overflow-hidden ${
                  log.action === 'START'
                    ? 'border-l-4 border-l-emerald-500 border-slate-200 dark:border-slate-800'
                    : 'border-l-4 border-l-amber-500 border-slate-200 dark:border-slate-800'
                }`}
              >
                {/* Row 1: Action Badge + Time + Date on left, Status / Duration on right */}
                <div className="flex items-center justify-between gap-1.5 w-full min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-black uppercase border shrink-0 ${
                        log.action === 'START'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800'
                          : 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800'
                      }`}
                    >
                      {log.action === 'START' ? (
                        <Play className="w-2.5 h-2.5 fill-current text-emerald-500 shrink-0" />
                      ) : (
                        <Square className="w-2.5 h-2.5 fill-current text-amber-500 shrink-0" />
                      )}
                      <span>{log.action}</span>
                    </span>

                    <span className="font-mono text-[10px] sm:text-[11px] font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 shrink-0">
                      {log.formattedTime}
                    </span>

                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-0.5 truncate">
                      <Calendar className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                      <span className="truncate">{log.formattedDate}</span>
                    </span>
                  </div>

                  <div className="shrink-0">
                    {log.sessionDuration ? (
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300 bg-slate-200/80 dark:bg-slate-700 px-1.5 py-0.5 rounded text-[10px]">
                        {log.sessionDuration}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/80">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Active
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 2: Trigger Source on left, DO Level + Operator on right */}
                <div className="flex items-center justify-between gap-1.5 w-full min-w-0 pt-1 border-t border-slate-200/70 dark:border-slate-700/50 text-[10px]">
                  <div className="flex items-center gap-1 text-slate-600 dark:text-slate-300 font-semibold truncate min-w-0 flex-1">
                    {log.triggerSource.includes('Auto') ? (
                      <Zap className="w-3 h-3 text-sky-500 shrink-0" />
                    ) : (
                      <Power className="w-3 h-3 text-indigo-500 shrink-0" />
                    )}
                    <span className="truncate">{log.triggerSource}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {device.doSensorEnabled !== false && log.doLevel >= 0 && (
                      <span className="font-mono font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-200 dark:border-sky-800">
                        DO: {log.doLevel.toFixed(1)} mg/L
                      </span>
                    )}

                    <span className="text-slate-400">
                      By: <strong className="text-slate-600 dark:text-slate-300">{log.operator || 'User'}</strong>
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
              No start/stop log records match your filter criteria.
            </div>
          )}
        </div>
      ) : (

        /* TABLE VIEW FOR DESKTOP / PREFERRED TABULAR LAYOUT */
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider text-[10px] sm:text-xs border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-4">State Action</th>
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Trigger / Source</th>
                {device.doSensorEnabled !== false && <th className="py-3 px-4">DO Level</th>}
                <th className="py-3 px-4">Session Duration</th>
                <th className="py-3 px-4">Operator</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-slate-800 dark:text-slate-200"
                  >
                    {/* Action Badge */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-black border ${
                          log.action === 'START'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800'
                            : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800'
                        }`}
                      >
                        {log.action === 'START' ? (
                          <Play className="w-3.5 h-3.5 fill-current text-emerald-500 shrink-0" />
                        ) : (
                          <Square className="w-3.5 h-3.5 fill-current text-amber-500 shrink-0" />
                        )}
                        <span>MACHINE {log.action}</span>
                      </span>
                    </td>

                    {/* Date & Time */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {log.formattedTime}
                        </span>
                        <span className="text-[11px] text-slate-400 font-sans">
                          {log.formattedDate}
                        </span>
                      </div>
                    </td>

                    {/* Trigger Source */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                        {log.triggerSource.includes('Auto') ? (
                          <Zap className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                        ) : log.triggerSource.includes('Manual') ? (
                          <Power className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                        <span>{log.triggerSource}</span>
                      </span>
                    </td>

                    {/* DO Level */}
                    {device.doSensorEnabled !== false && (
                      <td className="py-3.5 px-4 font-mono font-extrabold text-sky-600 dark:text-sky-400 whitespace-nowrap">
                        {log.doLevel < 0 ? 'MISSING' : `${log.doLevel.toFixed(1)} mg/L`}
                      </td>
                    )}

                    {/* Session Duration */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {log.sessionDuration ? (
                        <span className="font-mono font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-xs">
                          {log.sessionDuration}
                        </span>
                      ) : (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Ongoing Session
                        </span>
                      )}
                    </td>

                    {/* Operator */}
                    <td className="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {log.operator || 'System User'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400 font-medium">
                    No start/stop log records match your filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
