import React, { useState } from 'react';
import { X } from 'lucide-react';
import { deleteField } from 'firebase/firestore';
import { CAL_FIELDS, CalKey, fitCalibration, isSensorInstalled, rawValueOf } from '../../lib/oxynity';

const INFO: Record<CalKey, { name: string; unit: string; dp: number; refLabel: string; presets?: number[]; steps: string[] }> = {
  ph: {
    name: 'pH',
    unit: '',
    dp: 2,
    refLabel: 'Buffer pH',
    presets: [4.01, 7.0, 10.01],
    steps: [
      'Rinse the probe with clean water. Dip it in pH 7.00 buffer, wait 1 minute, tap Capture.',
      'Rinse again. Dip in pH 4.01 buffer (or 10.01 for high-pH ponds), wait 1 minute, add a point and Capture.',
      'Two points correct both offset and slope. Re-calibrate every 30 days.',
    ],
  },
  orp: {
    name: 'ORP',
    unit: 'mV',
    dp: 0,
    refLabel: 'Standard (mV)',
    presets: [225, 470],
    steps: ['Dip the probe in ORP standard solution (value on the bottle, e.g. 225 or 470 mV), wait 2 minutes, tap Capture.', 'One point is enough.'],
  },
  temp: {
    name: 'Water temperature',
    unit: '°C',
    dp: 1,
    refLabel: 'Thermometer (°C)',
    steps: ['Hold a good thermometer next to the probe in pond water for 2 minutes.', 'Type the thermometer reading and tap Capture.'],
  },
  sal: {
    name: 'Salinity',
    unit: 'ppt',
    dp: 1,
    refLabel: 'Refractometer (ppt)',
    presets: [0],
    steps: ['Take pond water from next to the probe and measure it with a refractometer.', 'Type the refractometer reading and tap Capture. Optional second point: clean fresh water = 0 ppt.'],
  },
};

interface Pt { ref: string; raw: string }

/** Calibrate one installed sensor against a reference; saves device.sensorCalibration[k]. */
const OneSensor: React.FC<{ k: CalKey; dev: any; save: (d: any) => Promise<void>; adminEmail?: string }> = ({ k, dev, save, adminEmail }) => {
  const info = INFO[k];
  const raw = rawValueOf(dev, k);
  const cur = dev?.sensorCalibration?.[k];
  const [pts, setPts] = useState<Pt[]>([{ ref: '', raw: raw != null ? String(raw) : '' }]);
  const [msg, setMsg] = useState('');
  const num = pts.map((p) => ({ ref: parseFloat(p.ref), raw: parseFloat(p.raw) })).filter((p) => isFinite(p.ref) && isFinite(p.raw));
  const fit = num.length ? fitCalibration(num) : null;
  const fmt = (v: number) => v.toFixed(info.dp) + (info.unit ? ` ${info.unit}` : '');
  const setP = (i: number, f: keyof Pt, v: string) => setPts((P) => P.map((x, j) => (j === i ? { ...x, [f]: v } : x)));

  const doSave = async () => {
    if (!fit) return setMsg(num.length > 1 ? 'Points do not make sense (check buffers / readings).' : 'Enter the reference value and the machine reading.');
    setMsg('Saving…');
    try {
      // merge write: only this sensor's entry changes
      await save({ sensorCalibration: { [k]: { ...fit, points: num, at: new Date().toISOString(), by: adminEmail || '' } } });
      setMsg('Saved ✓ Farmer app and reports now show corrected values.');
    } catch (e: any) {
      setMsg(`Could not save: ${e?.message || e}`);
    }
  };
  const reset = async () => {
    try {
      await save({ sensorCalibration: { [k]: deleteField() } });
      setMsg('Calibration removed. Raw values are shown.');
    } catch (e: any) {
      setMsg(`Could not save: ${e?.message || e}`);
    }
  };

  return (
    <div className="rounded-2xl border border-[#DDE7EF] p-3 flex flex-col gap-2.5 bg-white">
      <div className="flex items-center justify-between gap-2">
        <b className="text-[13px] text-[#0F2233]">{info.name}</b>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${cur ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {cur ? 'Calibrated' : 'Not calibrated'}
        </span>
      </div>
      <div className="text-[12px] text-[#33475A]">
        Machine reading now (raw): <b>{raw != null ? fmt(raw) : 'no reading'}</b>
        {raw != null && cur && <> · shown to farmer: <b>{fmt(raw * cur.slope + cur.offset)}</b></>}
      </div>
      {raw == null && (
        <div className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-xl p-2">
          The machine is not sending a {info.name} value yet. You can still type the reading shown on the controller.
        </div>
      )}
      <ol className="text-[12px] text-[#33475A] list-decimal pl-4 space-y-0.5">
        {info.steps.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      {pts.map((p, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-xl bg-[#F6F9FB] p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-bold text-[#52677A]">
              {info.refLabel}
              <input className="ox-input mt-0.5" inputMode="decimal" value={p.ref} placeholder="reference" onChange={(e) => setP(i, 'ref', e.target.value)} />
            </label>
            <label className="text-[11px] font-bold text-[#52677A]">
              Machine reading
              <input className="ox-input mt-0.5" inputMode="decimal" value={p.raw} placeholder="raw" onChange={(e) => setP(i, 'raw', e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {info.presets?.map((v) => (
              <button key={v} type="button" onClick={() => setP(i, 'ref', String(v))} className="px-2.5 py-1 rounded-lg bg-white border border-[#D3DFE9] text-[11px] font-bold text-[#0F2233]">
                {v}
              </button>
            ))}
            <span className="flex-1" />
            <button type="button" className="ox-btn ox-btn-secondary ox-btn-sm" disabled={raw == null} onClick={() => setP(i, 'raw', String(raw))}>
              Capture
            </button>
            {pts.length > 1 && (
              <button type="button" className="ox-btn ox-btn-outline ox-btn-sm" aria-label="Remove point" onClick={() => setPts((P) => P.filter((_, j) => j !== i))}>
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="ox-btn ox-btn-outline ox-btn-block" onClick={() => setPts((P) => [...P, { ref: '', raw: raw != null ? String(raw) : '' }])}>
        + Add point
      </button>
      {fit && (
        <div className="text-[12px] rounded-xl bg-[#EAF4FA] p-2.5 text-[#0F2233]">
          Correction: × <b>{fit.slope}</b> {fit.offset >= 0 ? '+' : '−'} <b>{Math.abs(fit.offset)}</b>
          {raw != null && <> · now reads <b>{fmt(raw * fit.slope + fit.offset)}</b></>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="ox-btn ox-btn-primary" disabled={!fit} onClick={doSave}>
          Save
        </button>
        <button type="button" className="ox-btn ox-btn-outline" disabled={!cur} onClick={reset}>
          Remove calibration
        </button>
      </div>
      {msg && <div className="text-xs font-bold text-[#0E6FA3]">{msg}</div>}
      {cur?.at && <div className="text-[11px] text-[#52677A]">Last calibrated {new Date(cur.at).toLocaleString('en-IN')}{cur.by ? ` by ${cur.by}` : ''}.</div>}
    </div>
  );
};

/** pH, ORP, temperature and salinity calibration for the sensors installed on this pond. */
export const OtherSensorCalibration: React.FC<{ dev: any; save: (d: any) => Promise<void>; adminEmail?: string }> = ({ dev, save, adminEmail }) => {
  const keys = (['ph', 'orp', 'temp', 'sal'] as CalKey[]).filter((k) => isSensorInstalled(dev, k));
  const [tab, setTab] = useState<CalKey | null>(null);
  const cur = tab && keys.includes(tab) ? tab : keys[0];
  if (!keys.length)
    return <p className="text-xs text-[#52677A]">No pH, ORP, temperature or salinity sensor is marked installed. Mark them in step 1 first.</p>;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1.5">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-3 py-2 rounded-xl text-[12px] font-extrabold border ${k === cur ? 'bg-[#0B2440] text-white border-[#0B2440]' : 'bg-white text-[#0F2233] border-[#D3DFE9]'}`}
          >
            {INFO[k].name}
            {dev?.sensorCalibration?.[k] ? ' ✓' : ''}
          </button>
        ))}
      </div>
      {cur && <OneSensor key={`${dev?.deviceId}-${cur}`} k={cur} dev={dev} save={save} adminEmail={adminEmail} />}
      <p className="text-[11px] text-[#52677A]">Field names the machine must send: {Object.values(CAL_FIELDS).join(', ')}.</p>
    </div>
  );
};
