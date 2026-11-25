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
  /** Sensors physically installed on this pond (set by admin). Missing = all installed. */
  installedSensors?: EnabledSensors;
  onToggleSensor: (key: keyof EnabledSensors) => void;
}

export const SensorsView: React.FC<SensorsViewProps> = ({
  device,
  onUpdateThresholds,
  onUpdateSchedules,
  isOnline = true,
  sensorsEnabled,
  installedSensors,
  onToggleSensor,
}) => {
  const inst: EnabledSensors = installedSensors || { do: true, ph: true, orp: true, temp: true, sal: true };
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
          Switch a sensor on to show it on Home, off to hide it.
        </p>
      </div>

      {/* Sensor Switch List Card */}
      <div className="ox-card p-4 divide-y divide-[#DDE8EA] dark:divide-[#1F4650]">
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
            className="ox-switch"
          />
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
            className="ox-switch"
          />
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
            className="ox-switch"
          />
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
            className="ox-switch"
          />
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
            className="ox-switch"
          />
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
