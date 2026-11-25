import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { SENSOR_LIST, SensorKey, isSensorInstalled } from '../../lib/oxynity';

/** Admin: mark which water sensors are installed on a pond. Not installed = hidden for the customer. */
export const InstalledSensorsEditor: React.FC<{ device: any; deviceId: string; bare?: boolean }> = ({ device, deviceId, bare }) => {
  const [status, setStatus] = useState('');
  const current = {} as Record<SensorKey, boolean>;
  SENSOR_LIST.forEach(([k]) => (current[k] = isSensorInstalled(device, k)));

  const toggle = async (k: SensorKey) => {
    const next = { ...current, [k]: !current[k] };
    setStatus('Saving…');
    try {
      await setDoc(
        doc(db, 'devices', deviceId),
        { installedSensors: next, doSensorEnabled: next.do, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      setStatus('Saved ✓');
    } catch (e: any) {
      setStatus(`Could not save: ${e?.message || e}`);
    }
  };

  return (
    <div className={bare ? '' : 'mb-3.5 p-3.5 rounded-2xl border border-[#DDE7EF] bg-white'}>
      <div className="flex justify-between text-xs font-extrabold text-[#0F2233] mb-2">
        <span>{bare ? 'Tap to mark installed / not installed' : 'Sensors installed on this pond (tap to change)'}</span>
        <span className="font-semibold text-[#52677A]">{status}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SENSOR_LIST.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => toggle(k)}
            className={`ox-btn ox-btn-sm ${
              current[k] ? 'ox-btn-primary' : 'ox-btn-outline'
            }`}
          >
            {current[k] ? '✓ ' : '+ '}
            {label}
          </button>
        ))}
      </div>
      {!bare && <p className="text-[11px] text-[#52677A] mt-2">Sensors that are not installed are hidden for this customer.</p>}
    </div>
  );
};
