import React, { useState, useEffect } from 'react';
import { DeviceTelemetry, EnabledSensors, AeratorSchedule } from '../types/iot';
import { AnimatedSensors } from './AnimatedSensors';
import { AeratorSchedules } from './AeratorSchedules';

interface SensorsViewProps {
  device: DeviceTelemetry;
  onUpdateThresholds?: (thresholds: { minDoAlert: number; targetDo: number }) => void;
  onUpdateSchedules?: (schedules: AeratorSchedule[]) => void;
  isOnline?: boolean;
  sensorsEnabled: EnabledSensors;
  onToggleSensor: (key: keyof EnabledSensors) => void;
}

export const SensorsView: React.FC<SensorsViewProps> = ({
  device,
  onUpdateThresholds,
  onUpdateSchedules,
  isOnline = true,
  sensorsEnabled,
  onToggleSensor,
}) => {
  const [tempUnit, setTempUnit] = useState<'C' | 'F'>(() => {
    return (localStorage.getItem('oxynity_temp_unit') as any) || 'C';
  });

  useEffect(() => {
    const handleTempEvt = (e: any) => {
      if (e.detail === 'C' || e.detail === 'F') {
        setTempUnit(e.detail);
      }
    };
    window.addEventListener('oxynity_temp_unit_change', handleTempEvt);
    return () => window.removeEventListener('oxynity_temp_unit_change', handleTempEvt);
  }, []);

  const toggleSensor = (key: keyof EnabledSensors) => {
    onToggleSensor(key);
  };

  return (
    <div className="space-y-4 select-none animate-in fade-in">
      {/* Title */}
      <div>
        <h2 className="text-xl sm:text-2xl font-black text-[#0B2B33] dark:text-[#E8F4F6] tracking-tight">
          Sensors
        </h2>
        <p className="text-xs text-[#5B7479] dark:text-[#9DB8BD] mt-0.5">
          Switch a sensor on to show its animation on Home.
        </p>
      </div>

      {/* Sensor Switch List Card */}
      <div className="bg-white dark:bg-[#12313A] rounded-[24px] p-4 border border-[#DDE8EA] dark:border-[#1F4650] shadow-xs divide-y divide-[#DDE8EA] dark:divide-[#1F4650]">
        {/* DO Sensor */}
        <div className="py-3 flex items-center justify-between gap-3">
          <div>
            <b className="block text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
              Dissolved oxygen (DO)
            </b>
            <small className="text-xs text-[#5B7479] dark:text-[#9DB8BD]">
              {sensorsEnabled.do
                ? `${device.doLevel >= 0 ? device.doLevel.toFixed(1) : '--'} ppm · ${
                    device.doLevel < (device.minDoAlert ?? 5.0) ? 'Low' : 'In range'
                  }`
                : 'Off · not shown on Home'}
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sensorsEnabled.do}
            onClick={() => toggleSensor('do')}
            className={`w-13 h-7.5 rounded-full relative transition-colors cursor-pointer shrink-0 ${
              sensorsEnabled.do ? 'bg-[#0E7C86] dark:bg-[#19C3D1]' : 'bg-[#DCE9EC] dark:bg-[#24444D]'
            }`}
          >
            <span
              className={`block w-6 h-6 rounded-full bg-white shadow-md absolute top-0.75 left-1 transition-transform ${
                sensorsEnabled.do ? 'translate-x-5.5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* pH Sensor */}
        <div className="py-3 flex items-center justify-between gap-3">
          <div>
            <b className="block text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
              pH
            </b>
            <small className="text-xs text-[#5B7479] dark:text-[#9DB8BD]">
              {sensorsEnabled.ph
                ? `${(device.phLevel ?? 7.4).toFixed(1)} pH · Optimal`
                : 'Off · not shown on Home'}
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sensorsEnabled.ph}
            onClick={() => toggleSensor('ph')}
            className={`w-13 h-7.5 rounded-full relative transition-colors cursor-pointer shrink-0 ${
              sensorsEnabled.ph ? 'bg-[#0E7C86] dark:bg-[#19C3D1]' : 'bg-[#DCE9EC] dark:bg-[#24444D]'
            }`}
          >
            <span
              className={`block w-6 h-6 rounded-full bg-white shadow-md absolute top-0.75 left-1 transition-transform ${
                sensorsEnabled.ph ? 'translate-x-5.5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* ORP Sensor */}
        <div className="py-3 flex items-center justify-between gap-3">
          <div>
            <b className="block text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
              ORP (Redox Potential)
            </b>
            <small className="text-xs text-[#5B7479] dark:text-[#9DB8BD]">
              {sensorsEnabled.orp
                ? `${Math.round(device.orpLevel ?? 285)} mV · Safe 200–350 mV`
                : 'Off · not shown on Home'}
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sensorsEnabled.orp}
            onClick={() => toggleSensor('orp')}
            className={`w-13 h-7.5 rounded-full relative transition-colors cursor-pointer shrink-0 ${
              sensorsEnabled.orp ? 'bg-[#0E7C86] dark:bg-[#19C3D1]' : 'bg-[#DCE9EC] dark:bg-[#24444D]'
            }`}
          >
            <span
              className={`block w-6 h-6 rounded-full bg-white shadow-md absolute top-0.75 left-1 transition-transform ${
                sensorsEnabled.orp ? 'translate-x-5.5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Temperature Sensor */}
        <div className="py-3 flex items-center justify-between gap-3">
          <div>
            <b className="block text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
              Temperature
            </b>
            <small className="text-xs text-[#5B7479] dark:text-[#9DB8BD]">
              {sensorsEnabled.temp
                ? tempUnit === 'F'
                  ? `${(((device.waterTemp ?? 28.4) * 1.8) + 32).toFixed(1)} °F · Safe 79–90 °F`
                  : `${(device.waterTemp ?? 28.4).toFixed(1)} °C · Safe 26–32 °C`
                : 'Off · not shown on Home'}
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sensorsEnabled.temp}
            onClick={() => toggleSensor('temp')}
            className={`w-13 h-7.5 rounded-full relative transition-colors cursor-pointer shrink-0 ${
              sensorsEnabled.temp ? 'bg-[#0E7C86] dark:bg-[#19C3D1]' : 'bg-[#DCE9EC] dark:bg-[#24444D]'
            }`}
          >
            <span
              className={`block w-6 h-6 rounded-full bg-white shadow-md absolute top-0.75 left-1 transition-transform ${
                sensorsEnabled.temp ? 'translate-x-5.5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Salinity Sensor */}
        <div className="py-3 flex items-center justify-between gap-3">
          <div>
            <b className="block text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
              Salinity
            </b>
            <small className="text-xs text-[#5B7479] dark:text-[#9DB8BD]">
              {sensorsEnabled.sal
                ? `${(device.salinity ?? 15.0).toFixed(1)} ppt · Optimal`
                : 'Off · not shown on Home'}
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sensorsEnabled.sal}
            onClick={() => toggleSensor('sal')}
            className={`w-13 h-7.5 rounded-full relative transition-colors cursor-pointer shrink-0 ${
              sensorsEnabled.sal ? 'bg-[#0E7C86] dark:bg-[#19C3D1]' : 'bg-[#DCE9EC] dark:bg-[#24444D]'
            }`}
          >
            <span
              className={`block w-6 h-6 rounded-full bg-white shadow-md absolute top-0.75 left-1 transition-transform ${
                sensorsEnabled.sal ? 'translate-x-5.5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Schedules Card */}
      <AeratorSchedules
        device={device}
        onUpdateSchedules={onUpdateSchedules || (() => {})}
        isOnline={isOnline}
      />

      {/* Live Animated Sensor Gauges */}
      <AnimatedSensors device={device} isOnline={isOnline} sensorsEnabled={sensorsEnabled} />
    </div>
  );
};
