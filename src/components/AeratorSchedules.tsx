import React, { useState } from 'react';
import { Clock, Plus, Trash2, Edit2, Check, X, Calendar, Power, AlertCircle, ChevronDown } from 'lucide-react';
import { DeviceTelemetry, AeratorSchedule } from '../types/iot';
import { findOverlappingSchedule, scheduleLengthMin, scheduleMinutes, scheduleNameFor } from '../lib/oxynity';

const fmtLen = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
const DEFAULT_NAMES = ['Morning Aeration', 'Afternoon Aeration', 'Evening Aeration', 'Night Aeration'];

interface AeratorSchedulesProps {
  device: DeviceTelemetry;
  onUpdateSchedules: (schedules: AeratorSchedule[]) => void;
  isOnline?: boolean;
}

export const AeratorSchedules: React.FC<AeratorSchedulesProps> = ({
  device,
  onUpdateSchedules,
  isOnline = true,
}) => {
  const schedules: AeratorSchedule[] = Array.isArray(device.schedules) ? device.schedules : [];

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('Morning Aeration');
  const [startHour, setStartHour] = useState<number>(6);
  const [startMinute, setStartMinute] = useState<number>(0);
  const [startAmPm, setStartAmPm] = useState<'AM' | 'PM'>('AM');

  const [stopHour, setStopHour] = useState<number>(8);
  const [stopMinute, setStopMinute] = useState<number>(30);
  const [stopAmPm, setStopAmPm] = useState<'AM' | 'PM'>('AM');

  const [restMinutes, setRestMinutes] = useState<number>(30);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const errRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (formError) errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [formError]);
  // Name follows the start time until the farmer types his own name.
  const [nameTouched, setNameTouched] = useState(false);
  React.useEffect(() => {
    if (nameTouched) return;
    const start = scheduleMinutes({ startHour, startMinute, startAmPm, stopHour, stopMinute, stopAmPm }).start;
    setName(scheduleNameFor(start));
  }, [startHour, startMinute, startAmPm, nameTouched]);

  // In-App Time Picker Modal State
  const [activePicker, setActivePicker] = useState<{
    title: string;
    currentValue: number;
    options: { label: string; value: number }[];
    onSelect: (val: number) => void;
  } | null>(null);

  const resetForm = () => {
    setName('Morning Aeration');
    setStartHour(6);
    setStartMinute(0);
    setStartAmPm('AM');
    setStopHour(8);
    setStopMinute(30);
    setStopAmPm('AM');
    setRestMinutes(30);
    setFormError(null);
    setListError(null);
    setNameTouched(false);
    setEditingId(null);
    setIsFormOpen(false);
  };

  const handleStartEdit = (sch: AeratorSchedule) => {
    setEditingId(sch.id);
    setName(sch.name);
    setStartHour(sch.startHour);
    setStartMinute(sch.startMinute);
    setStartAmPm(sch.startAmPm);
    setStopHour(sch.stopHour);
    setStopMinute(sch.stopMinute);
    setStopAmPm(sch.stopAmPm);
    setRestMinutes(sch.restMinutes || 30);
    setNameTouched(!DEFAULT_NAMES.includes(sch.name));
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleToggleSchedule = (id: string) => {
    const sch = schedules.find((s) => s.id === id);
    if (sch && !sch.enabled) {
      const clash = findOverlappingSchedule(sch, schedules, id);
      if (clash) {
        setListError(
          `"${sch.name}" cannot be switched on: its time overlaps "${clash.name}" (${formatTime(clash.startHour, clash.startMinute, clash.startAmPm)} - ${formatTime(clash.stopHour, clash.stopMinute, clash.stopAmPm)}). Edit the times first.`
        );
        return;
      }
    }
    setListError(null);
    const next = schedules.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
    onUpdateSchedules(next);
  };

  const handleDeleteSchedule = (id: string) => {
    const next = schedules.filter((s) => s.id !== id);
    onUpdateSchedules(next);
    if (editingId === id) resetForm();
  };

  const handleSaveSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Please enter a schedule name.');
      return;
    }

    if (startHour === stopHour && startMinute === stopMinute && startAmPm === stopAmPm) {
      setFormError('Start time and Stop time cannot be identical.');
      return;
    }

    // Two schedules must never cover the same time: the machine would not stop when one of them ends.
    const cand = { startHour, startMinute, startAmPm, stopHour, stopMinute, stopAmPm };
    const clash = findOverlappingSchedule(cand, schedules, editingId);
    if (clash) {
      setFormError(
        `This time overlaps "${clash.name}" (${formatTime(clash.startHour, clash.startMinute, clash.startAmPm)} - ${formatTime(clash.stopHour, clash.stopMinute, clash.stopAmPm)}). During the overlap the machine cannot stop. Change the start or stop time, or edit "${clash.name}".`
      );
      return;
    }

    if (editingId) {
      // Update existing
      const next = schedules.map((s) =>
        s.id === editingId
          ? {
              ...s,
              name: name.trim(),
              startHour,
              startMinute,
              startAmPm,
              stopHour,
              stopMinute,
              stopAmPm,
              restMinutes,
            }
          : s
      );
      onUpdateSchedules(next);
    } else {
      // Add new
      const newSchedule: AeratorSchedule = {
        id: `sch-${Date.now()}`,
        name: name.trim(),
        startHour,
        startMinute,
        startAmPm,
        stopHour,
        stopMinute,
        stopAmPm,
        restMinutes,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      onUpdateSchedules([...schedules, newSchedule]);
    }

    resetForm();
  };

  const formatTime = (hour: number, minute: number, ampm: 'AM' | 'PM') => {
    return `${hour}:${String(minute).padStart(2, '0')} ${ampm}`;
  };

  const activeCount = schedules.filter((s) => s.enabled).length;

  return (
    <div className="ox-card p-4 space-y-3 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between gap-1.5 sm:gap-2 w-full min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#E6EFF1] dark:bg-[#08222A] text-[#0E7C86] dark:text-[#19C3D1] flex items-center justify-center shrink-0 border border-[#DDE8EA]/60 dark:border-[#1F4650]">
            <Clock className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="text-xs sm:text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6] uppercase tracking-wider">
              Schedules
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E6EFF1] dark:bg-[#08222A] text-[#0E7C86] dark:text-[#19C3D1] border border-[#DDE8EA] dark:border-[#1F4650] shrink-0">
              {activeCount} Active
            </span>
          </div>
        </div>

        {!isFormOpen && (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setIsFormOpen(true);
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-[#0E7C86] hover:bg-[#0c6b73] active:scale-95 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Schedule</span>
          </button>
        )}
      </div>

      {/* Add / Edit Form Modal / Inline Card */}
      {isFormOpen && (
        <form
          onSubmit={handleSaveSchedule}
          className="bg-[#F8FBFC] dark:bg-[#0E2830] rounded-2xl p-3.5 border border-[#DDE8EA] dark:border-[#1F4650] space-y-3 animate-in fade-in"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-[#0B2B33] dark:text-[#E8F4F6] flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#0E7C86] dark:text-[#19C3D1]" />
              {editingId ? 'Edit Schedule' : 'Create New Schedule'}
            </span>
            <button
              type="button"
              onClick={resetForm}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {formError && (
            <div ref={errRef} className="text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 p-2 rounded-lg flex items-center gap-1.5 border border-rose-200 dark:border-rose-800">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Schedule Name & Quick Presets */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#5B7479] dark:text-[#9DB8BD] block">
              Schedule Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              placeholder="e.g. Morning DO Boost"
              className="w-full bg-white dark:bg-[#071A1F] border border-[#DDE8EA] dark:border-[#1F4650] rounded-xl px-3 py-2 text-xs font-bold text-[#0B2B33] dark:text-[#E8F4F6] focus:outline-hidden focus:ring-2 focus:ring-[#0E7C86] dark:focus:ring-[#19C3D1]"
            />
            {/* Presets */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {['Morning Aeration', 'Afternoon Aeration', 'Evening Aeration', 'Night Aeration'].map((preset) => (
                <button
                  type="button"
                  key={preset}
                  onClick={() => {
                    setName(preset);
                    setNameTouched(true);
                  }}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white dark:bg-[#12313A] text-[#0B2B33] dark:text-[#E8F4F6] border border-[#DDE8EA] dark:border-[#1F4650] hover:border-[#0E7C86] cursor-pointer transition-colors"
                >
                  + {preset}
                </button>
              ))}
            </div>
          </div>

          {/* 12-Hour AM/PM Time Pickers: Start & Stop */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {/* Start Time Block */}
            <div className="bg-white dark:bg-[#071A1F] rounded-xl p-3 border border-emerald-300 dark:border-emerald-800 space-y-2">
              <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-extrabold text-[11px] uppercase tracking-wider">
                <Power className="w-3 h-3" />
                <span>Start Time (Aerator ON)</span>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Hour */}
                <button
                  type="button"
                  onClick={() =>
                    setActivePicker({
                      title: 'Select Start Hour',
                      currentValue: startHour,
                      options: Array.from({ length: 12 }, (_, i) => ({
                        label: String(i + 1),
                        value: i + 1,
                      })),
                      onSelect: (val) => setStartHour(val),
                    })
                  }
                  className="flex-1 flex items-center justify-between bg-white dark:bg-[#12313A] border border-[#DDE8EA] dark:border-[#1F4650] text-[#0B2B33] dark:text-[#E8F4F6] rounded-lg px-2.5 py-1.5 text-xs font-black hover:border-[#0E7C86] dark:hover:border-[#19C3D1] transition-colors cursor-pointer"
                >
                  <span>{startHour}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>
                <span className="font-black text-[#5B7479] dark:text-[#9DB8BD]">:</span>
                {/* Minute */}
                <button
                  type="button"
                  onClick={() =>
                    setActivePicker({
                      title: 'Select Start Minute',
                      currentValue: startMinute,
                      options: Array.from({ length: 12 }, (_, i) => ({
                        label: String(i * 5).padStart(2, '0'),
                        value: i * 5,
                      })),
                      onSelect: (val) => setStartMinute(val),
                    })
                  }
                  className="flex-1 flex items-center justify-between bg-white dark:bg-[#12313A] border border-[#DDE8EA] dark:border-[#1F4650] text-[#0B2B33] dark:text-[#E8F4F6] rounded-lg px-2.5 py-1.5 text-xs font-black hover:border-[#0E7C86] dark:hover:border-[#19C3D1] transition-colors cursor-pointer"
                >
                  <span>{String(startMinute).padStart(2, '0')}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>
                {/* AM / PM Segmented Control */}
                <div className="flex rounded-lg border border-[#DDE8EA] dark:border-[#1F4650] overflow-hidden shrink-0">
                  <button
                    type="button"
                    onClick={() => setStartAmPm('AM')}
                    className={`px-2.5 py-1.5 text-xs font-black transition-colors cursor-pointer ${
                      startAmPm === 'AM'
                        ? 'bg-emerald-600 dark:bg-emerald-500 text-white'
                        : 'bg-[#F2F7F8] dark:bg-[#08222A] text-[#5B7479] dark:text-[#9DB8BD] hover:bg-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => setStartAmPm('PM')}
                    className={`px-2.5 py-1.5 text-xs font-black transition-colors cursor-pointer ${
                      startAmPm === 'PM'
                        ? 'bg-emerald-600 dark:bg-emerald-500 text-white'
                        : 'bg-[#F2F7F8] dark:bg-[#08222A] text-[#5B7479] dark:text-[#9DB8BD] hover:bg-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    PM
                  </button>
                </div>
              </div>
            </div>

            {/* Stop Time Block */}
            <div className="bg-white dark:bg-[#071A1F] rounded-xl p-3 border border-rose-300 dark:border-rose-800 space-y-2">
              <div className="flex items-center gap-1.5 text-rose-700 dark:text-rose-400 font-extrabold text-[11px] uppercase tracking-wider">
                <Power className="w-3 h-3 rotate-180" />
                <span>Stop Time (Aerator OFF)</span>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Hour */}
                <button
                  type="button"
                  onClick={() =>
                    setActivePicker({
                      title: 'Select Stop Hour',
                      currentValue: stopHour,
                      options: Array.from({ length: 12 }, (_, i) => ({
                        label: String(i + 1),
                        value: i + 1,
                      })),
                      onSelect: (val) => setStopHour(val),
                    })
                  }
                  className="flex-1 flex items-center justify-between bg-white dark:bg-[#12313A] border border-[#DDE8EA] dark:border-[#1F4650] text-[#0B2B33] dark:text-[#E8F4F6] rounded-lg px-2.5 py-1.5 text-xs font-black hover:border-[#0E7C86] dark:hover:border-[#19C3D1] transition-colors cursor-pointer"
                >
                  <span>{stopHour}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>
                <span className="font-black text-[#5B7479] dark:text-[#9DB8BD]">:</span>
                {/* Minute */}
                <button
                  type="button"
                  onClick={() =>
                    setActivePicker({
                      title: 'Select Stop Minute',
                      currentValue: stopMinute,
                      options: Array.from({ length: 12 }, (_, i) => ({
                        label: String(i * 5).padStart(2, '0'),
                        value: i * 5,
                      })),
                      onSelect: (val) => setStopMinute(val),
                    })
                  }
                  className="flex-1 flex items-center justify-between bg-white dark:bg-[#12313A] border border-[#DDE8EA] dark:border-[#1F4650] text-[#0B2B33] dark:text-[#E8F4F6] rounded-lg px-2.5 py-1.5 text-xs font-black hover:border-[#0E7C86] dark:hover:border-[#19C3D1] transition-colors cursor-pointer"
                >
                  <span>{String(stopMinute).padStart(2, '0')}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>
                {/* AM / PM Segmented Control */}
                <div className="flex rounded-lg border border-[#DDE8EA] dark:border-[#1F4650] overflow-hidden shrink-0">
                  <button
                    type="button"
                    onClick={() => setStopAmPm('AM')}
                    className={`px-2.5 py-1.5 text-xs font-black transition-colors cursor-pointer ${
                      stopAmPm === 'AM'
                        ? 'bg-rose-600 dark:bg-rose-500 text-white'
                        : 'bg-[#F2F7F8] dark:bg-[#08222A] text-[#5B7479] dark:text-[#9DB8BD] hover:bg-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => setStopAmPm('PM')}
                    className={`px-2.5 py-1.5 text-xs font-black transition-colors cursor-pointer ${
                      stopAmPm === 'PM'
                        ? 'bg-rose-600 dark:bg-rose-500 text-white'
                        : 'bg-[#F2F7F8] dark:bg-[#08222A] text-[#5B7479] dark:text-[#9DB8BD] hover:bg-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    PM
                  </button>
                </div>
              </div>
            </div>
          </div>

          {(() => {
            const len = scheduleLengthMin({ startHour, startMinute, startAmPm, stopHour, stopMinute, stopAmPm });
            const overnight = scheduleMinutes({ startHour, startMinute, startAmPm, stopHour, stopMinute, stopAmPm });
            return len > 0 ? (
              <p className="text-[11px] font-bold text-[#0B2B33] dark:text-[#E8F4F6]">
                Runs {fmtLen(len)}
                {overnight.start > overnight.stop ? ' (overnight, stops next day)' : ''}
                {len > 360 ? ` · rests ${Math.floor(len / 360) === 1 ? 'once' : `${Math.floor(len / 360)} times`} after every 6 h` : ' · no rest needed (under 6 h)'}
              </p>
            ) : null;
          })()}

          {/* Rest time after 6 hours of continuous running (farmer decides) */}
          <div className="pt-2 border-t border-[#DDE8EA] dark:border-[#1F4650]">
            <label className="block text-xs font-extrabold text-[#0B2B33] dark:text-[#E8F4F6] mb-1">
              Machine rest time
            </label>
            <p className="text-[11px] text-[#5B7479] dark:text-[#9DB8BD] mb-2">
              After every 6 hours of continuous running the machine rests, then restarts by itself.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[15, 20, 30, 45, 60, 90].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRestMinutes(m)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border cursor-pointer ${
                    restMinutes === m
                      ? 'bg-[#0E7C86] text-white border-[#0E7C86]'
                      : 'bg-white dark:bg-[#12313A] text-[#0B2B33] dark:text-[#E8F4F6] border-[#DDE8EA] dark:border-[#1F4650]'
                  }`}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>

          {/* Form Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DDE8EA] dark:border-[#1F4650]">
            <button
              type="button"
              onClick={resetForm}
              className="px-3 py-1.5 text-xs font-bold text-[#5B7479] dark:text-[#9DB8BD] hover:text-[#0B2B33] dark:hover:text-[#E8F4F6] rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#0E7C86] hover:bg-[#0c6b73] active:scale-95 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{editingId ? 'Update Schedule' : 'Save Schedule'}</span>
            </button>
          </div>
        </form>
      )}

      {listError && (
        <div className="text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 p-2 rounded-lg flex items-start gap-1.5 border border-rose-200 dark:border-rose-800">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{listError}</span>
        </div>
      )}

      {/* Schedule Items List */}
      {schedules.length === 0 ? (
        <div className="bg-[#F8FBFC] dark:bg-[#0E2830] rounded-xl p-4 text-center border border-dashed border-[#DDE8EA] dark:border-[#1F4650] space-y-1.5">
          <Clock className="w-6 h-6 text-[#5B7479] dark:text-[#9DB8BD] mx-auto opacity-60" />
          <p className="text-xs font-bold text-[#0B2B33] dark:text-[#E8F4F6]">
            No schedules set
          </p>
          <p className="text-[11px] text-[#5B7479] dark:text-[#9DB8BD] max-w-xs mx-auto">
            Schedule automatic daily start and stop times to optimize dissolved oxygen cycles and conserve electricity.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((sch) => {
            const startLabel = formatTime(sch.startHour, sch.startMinute, sch.startAmPm);
            const stopLabel = formatTime(sch.stopHour, sch.stopMinute, sch.stopAmPm);
            const clash = sch.enabled ? findOverlappingSchedule(sch, schedules, sch.id) : null;
            const len = scheduleLengthMin(sch);

            return (
              <div
                key={sch.id}
                className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-2.5 ${
                  sch.enabled
                    ? 'bg-slate-50/80 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700/80'
                    : 'bg-slate-100/50 dark:bg-slate-900/50 border-slate-200/60 dark:border-slate-800/60 opacity-60'
                }`}
              >
                {/* Left Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-black text-slate-900 dark:text-slate-100 truncate">
                      {sch.name}
                    </h4>
                    <span
                      className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md uppercase tracking-wider ${
                        sch.enabled
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                      }`}
                    >
                      {sch.enabled ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </div>

                  {/* Time Range Badge */}
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-mono font-extrabold mt-1 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    <span className="text-emerald-600 dark:text-emerald-400 font-black">
                      {startLabel}
                    </span>
                    <span className="text-slate-400 font-sans text-[10px]">to</span>
                    <span className="text-rose-600 dark:text-rose-400 font-black">
                      {stopLabel}
                    </span>
                    <span className="basis-full text-slate-500 dark:text-slate-400 font-sans text-[11px] font-bold whitespace-normal">
                      Runs {fmtLen(len)}{len > 360 ? ` · rest ${sch.restMinutes || 30} min after every 6 h` : ''}
                    </span>
                  </div>
                  {clash && (
                    <div className="mt-1.5 text-[10.5px] font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 rounded-lg px-2 py-1">
                      ⚠ Overlaps "{clash.name}". The machine will not stop at {stopLabel}. Edit one of them.
                    </div>
                  )}
                </div>

                {/* Right Actions: Enable Toggle, Edit, Delete */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Enable / Disable Toggle Switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!sch.enabled}
                    onClick={() => handleToggleSchedule(sch.id)}
                    className="ox-switch"
                    title={sch.enabled ? 'Disable schedule' : 'Enable schedule'}
                  />

                  {/* Edit */}
                  <button
                    type="button"
                    onClick={() => handleStartEdit(sch)}
                    className="p-1.5 text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Edit schedule"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => handleDeleteSchedule(sch.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                    title="Delete schedule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Custom In-App Time Picker Modal - High Contrast, guaranteed mobile visibility */}
      {activePicker && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setActivePicker(null)}
        >
          <div
            className="w-full max-w-xs bg-white dark:bg-[#0E2830] rounded-2xl shadow-2xl border border-[#DDE8EA] dark:border-[#1F4650] p-4 space-y-4 animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#DDE8EA] dark:border-[#1F4650] pb-2.5">
              <span className="text-sm font-black text-[#0B2B33] dark:text-[#E8F4F6]">
                {activePicker.title}
              </span>
              <button
                type="button"
                onClick={() => setActivePicker(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#12313A] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Grid of 12 numbers: 4 columns x 3 rows */}
            <div className="grid grid-cols-4 gap-2">
              {activePicker.options.map((opt) => {
                const isSelected = opt.value === activePicker.currentValue;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      activePicker.onSelect(opt.value);
                      setActivePicker(null);
                    }}
                    className={`py-2.5 text-sm font-black rounded-xl transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#0E7C86] dark:bg-[#19C3D1] text-white shadow-md scale-105'
                        : 'bg-[#F2F7F8] dark:bg-[#12313A] text-[#0B2B33] dark:text-[#E8F4F6] hover:bg-slate-200 dark:hover:bg-[#1B434F]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setActivePicker(null)}
              className="w-full py-2 bg-slate-100 dark:bg-[#12313A] hover:bg-slate-200 dark:hover:bg-[#1B434F] text-[#5B7479] dark:text-[#9DB8BD] text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
