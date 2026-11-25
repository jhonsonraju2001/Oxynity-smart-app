import React, { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { CheckCircle2, Cpu, FlaskConical, Gauge, MapPin, Search, Wrench, X } from 'lucide-react';
import { db } from '../../lib/firebase';
import { AdminDeviceRecord } from '../../data/oxynityAdminData';
import { hasLiveFix, isSensorInstalled, minutesSinceSeen } from '../../lib/oxynity';
import { computeDoCalibration, doFromVoltage, parseLatLng } from '../../lib/doCalibration';
import { InstalledSensorsEditor } from './InstalledSensorsEditor';
import { MachineSpecsEditor } from './MachineSpecsEditor';
import { OtherSensorCalibration } from './OtherSensorCalibration';

interface Props {
  fleet: AdminDeviceRecord[];
  initialDeviceId?: string | null;
  adminEmail?: string;
  onClose: () => void;
}

interface Pt { meter: string; mv: string; at: string }

const Step: React.FC<{ n: number; title: string; icon: React.ReactNode; done?: boolean; children: React.ReactNode }> = ({ n, title, icon, done, children }) => (
  <section className="ox-card p-4">
    <div className="flex items-center gap-2.5 mb-3">
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${done ? 'bg-emerald-600 text-white' : 'bg-[#0B2440] text-white'}`}>
        {done ? <CheckCircle2 className="w-4 h-4" /> : n}
      </span>
      <span className="text-[#0E6FA3]">{icon}</span>
      <h3 className="text-sm font-extrabold text-[#0F2233]">{title}</h3>
    </div>
    {children}
  </section>
);

/**
 * Installation & calibration wizard for technicians / admin, one machine at a time:
 *  1. which sensors are installed  2. DO probe  3. pH / ORP / temperature / salinity  4. pond location  5. machine specs
 */
export const SensorSetup: React.FC<Props> = ({ fleet, initialDeviceId, adminEmail, onClose }) => {
  const [q, setQ] = useState('');
  const [id, setId] = useState<string>(initialDeviceId || fleet[0]?.id || '');
  const [live, setLive] = useState<any>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [calMsg, setCalMsg] = useState('');
  const [locText, setLocText] = useState('');
  const [locMsg, setLocMsg] = useState('');
  const [, tick] = useState(0);

  // live device document (voltage, DO, last seen)
  useEffect(() => {
    if (!id) return;
    setLive(null); setPts([]); setCalMsg(''); setLocMsg(''); setLocText('');
    const un = onSnapshot(doc(db, 'devices', id), (s) => setLive(s.exists() ? { ...s.data(), deviceId: id } : { deviceId: id }), () => {});
    const t = setInterval(() => tick((x) => x + 1), 5000);
    return () => { un(); clearInterval(t); };
  }, [id]);

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return fleet.filter((d) => !k || `${d.id} ${d.pond} ${d.farmer} ${d.village || ''} ${d.rawTelemetry?.ownerEmail || ''}`.toLowerCase().includes(k));
  }, [fleet, q]);

  const dev = live || fleet.find((d) => d.id === id)?.rawTelemetry || { deviceId: id };
  const mins = minutesSinceSeen(dev);
  const online = mins < 2;
  const mv = typeof dev.voltageMv === 'number' ? dev.voltageMv : null;
  const doInstalled = isSensorInstalled(dev, 'do');
  const lat = Number(dev.calibratedLatitude), lng = Number(dev.calibratedLongitude);
  const hasLoc = !!dev.isCalibrated && isFinite(lat) && isFinite(lng) && !!lat;

  const save = (data: any) => setDoc(doc(db, 'devices', id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });

  // ---------- DO calibration ----------
  const numPts = pts.map((p) => ({ meterDo: parseFloat(p.meter), voltageMv: parseFloat(p.mv) })).filter((p) => p.meterDo >= 0 && p.voltageMv > 50);
  const preview = numPts.length ? computeDoCalibration(numPts) : null;
  const capture = (i: number) =>
    setPts((P) => P.map((p, j) => (j === i ? { ...p, mv: mv != null ? String(Math.round(mv)) : p.mv, at: new Date().toISOString() } : p)));
  const saveCal = async () => {
    if (!preview) { setCalMsg('Add at least one point with a meter reading and a probe voltage.'); return; }
    setCalMsg('Saving…');
    try {
      await save({
        doSlopeK: preview.slope,
        doZeroMv: preview.zero,
        isDoCalibrated: true,
        doCalibrationPoints: numPts.map((p, i) => ({ id: `cal-${Date.now()}-${i}`, pointNum: i + 1, meterDo: p.meterDo, voltageMv: p.voltageMv, timestamp: pts[i]?.at || new Date().toISOString() })),
        doCalibratedAt: new Date().toISOString(),
        doCalibratedBy: adminEmail || '',
      });
      setCalMsg('Calibration saved ✓ The machine picks it up on its next report.');
      setPts([]);
    } catch (e: any) {
      setCalMsg(`Could not save: ${e?.message || e}`);
    }
  };

  // ---------- Location ----------
  const useMyLocation = async () => {
    setLocMsg('Getting GPS location… stand at the pond.');
    try {
      let c: { latitude: number; longitude: number; accuracy: number };
      if (Capacitor.isNativePlatform()) {
        try { const p = await Geolocation.checkPermissions(); if (p.location !== 'granted') await Geolocation.requestPermissions(); } catch {}
        c = (await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000 })).coords;
      } else {
        c = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition((p) => res(p.coords), rej, { enableHighAccuracy: true, timeout: 20000 }));
      }
      setLocText(`${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)}`);
      setLocMsg(`Got location (accuracy about ${Math.round(c.accuracy)} m). Tap "Save location".`);
    } catch {
      setLocMsg('Could not get GPS. Turn on Location, or paste a Google Maps link below.');
    }
  };
  const saveLoc = async () => {
    const ll = parseLatLng(locText);
    if (!ll) { setLocMsg('Paste coordinates like 16.711395, 81.464035 or a Google Maps link.'); return; }
    setLocMsg('Saving…');
    try {
      await save({ calibratedLatitude: ll[0], calibratedLongitude: ll[1], isCalibrated: true, locationCalibratedAt: new Date().toISOString(), locationCalibratedBy: adminEmail || '' });
      setLocMsg('Pond location saved ✓');
    } catch (e: any) {
      setLocMsg(`Could not save: ${e?.message || e}`);
    }
  };

  const sel = fleet.find((d) => d.id === id);

  return (
    <div className="fixed inset-0 z-[3000] bg-[#F3F7FA] overflow-y-auto">
      <div
        className="sticky top-0 z-10 bg-[#0B2440] text-white px-4 pb-3 flex items-center justify-between gap-3 shadow"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}
      >
        <div className="min-w-0">
          <b className="text-base block leading-tight">Sensor setup &amp; calibration</b>
          <div className="text-[11px] text-[#9DB8D0] leading-snug">At installation or service visit, at the pond</div>
        </div>
        <button type="button" onClick={onClose} className="ox-btn ox-btn-sm shrink-0" style={{ background: '#163A63', color: '#fff' }} aria-label="Close">
          <X className="w-4 h-4" /> Close
        </button>
      </div>

      <div className="max-w-2xl mx-auto p-3 sm:p-4 flex flex-col gap-3">
        {/* Machine picker */}
        <section className="ox-card p-4">
          <label className="text-xs font-extrabold text-[#0F2233] block">Choose machine</label>
          <div className="relative mt-1.5">
            <Search className="w-4 h-4 text-[#52677A] absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="ox-input pl-9" placeholder="Search farmer, pond, village or ID" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="ox-input mt-2" value={id} onChange={(e) => setId(e.target.value)}>
            {list.map((d) => (
              <option key={d.id} value={d.id}>{`${d.pond} · ${d.farmer} · ${d.id}`}</option>
            ))}
          </select>
          {sel && (
            <div className="grid grid-cols-3 gap-2 mt-3 text-center [&>div]:min-w-0">
              <div className="rounded-xl bg-[#F3F8F9] p-2">
                <div className="text-[10px] font-bold text-[#52677A] uppercase">Machine</div>
                <div className={`text-sm font-black ${online ? 'text-emerald-600' : 'text-red-600'}`}>{online ? 'Online' : 'Offline'}</div>
                <div className="text-[10px] text-[#52677A]">{isFinite(mins) ? `seen ${Math.round(mins)} min ago` : 'never seen'}</div>
              </div>
              <div className="rounded-xl bg-[#F3F8F9] p-2">
                <div className="text-[10px] font-bold text-[#52677A] uppercase">DO probe</div>
                <div className="text-sm font-black text-[#0F2233]">{mv != null ? `${Math.round(mv)} mV` : '—'}</div>
                <div className="text-[10px] text-[#52677A]">live voltage</div>
              </div>
              <div className="rounded-xl bg-[#F3F8F9] p-2">
                <div className="text-[10px] font-bold text-[#52677A] uppercase">DO reading</div>
                <div className="text-sm font-black text-[#0F2233]">{doInstalled && typeof dev.doLevel === 'number' && dev.doLevel >= 0 ? `${dev.doLevel.toFixed(2)} ppm` : '—'}</div>
                <div className="text-[10px] text-[#52677A]">{dev.isDoCalibrated ? 'calibrated' : 'not calibrated'}</div>
              </div>
            </div>
          )}
        </section>

        {id && (
          <>
            <Step n={1} title="Sensors installed on this pond" icon={<Cpu className="w-4 h-4" />} done={!!dev.installedSensors}>
              <InstalledSensorsEditor device={dev} deviceId={id} bare />
              <p className="text-[11px] text-[#52677A] mt-2">Only installed sensors are shown to the farmer. Auto (DO) mode appears only when DO is installed.</p>
            </Step>

            <Step n={2} title="Calibrate DO probe" icon={<Gauge className="w-4 h-4" />} done={!!dev.isDoCalibrated}>
              {!doInstalled ? (
                <p className="text-xs text-[#52677A]">Mark <b>DO</b> as installed in step 1 to calibrate it.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <ol className="text-xs text-[#33475A] list-decimal pl-4 space-y-1">
                    <li>Put the machine's probe and your handheld DO meter in the same water. Wait 2 minutes.</li>
                    <li>Type the handheld meter reading, then tap <b>Capture</b> to take the probe voltage.</li>
                    <li>For best accuracy add a second point in zero-oxygen solution (meter 0.0).</li>
                  </ol>
                  {!online && <div className="text-xs font-bold text-amber-700 bg-amber-50 rounded-xl p-2">Machine is offline. Capture needs a live voltage; you can also type the mV shown on the controller.</div>}
                  {pts.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
                      <label className="text-[11px] font-bold text-[#52677A]">Meter (mg/L)
                        <input className="ox-input mt-0.5" inputMode="decimal" value={p.meter} placeholder="e.g. 6.80" onChange={(e) => setPts((P) => P.map((x, j) => (j === i ? { ...x, meter: e.target.value } : x)))} />
                      </label>
                      <label className="text-[11px] font-bold text-[#52677A]">Probe (mV)
                        <input className="ox-input mt-0.5" inputMode="decimal" value={p.mv} placeholder="mV" onChange={(e) => setPts((P) => P.map((x, j) => (j === i ? { ...x, mv: e.target.value } : x)))} />
                      </label>
                      <button type="button" className="ox-btn ox-btn-secondary" disabled={mv == null} onClick={() => capture(i)}>Capture</button>
                      <button type="button" className="ox-btn ox-btn-outline" aria-label="Remove point" onClick={() => setPts((P) => P.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button type="button" className="ox-btn ox-btn-outline ox-btn-block" onClick={() => setPts((P) => [...P, { meter: '', mv: mv != null ? String(Math.round(mv)) : '', at: new Date().toISOString() }])}>
                    + Add calibration point
                  </button>
                  {preview && (
                    <div className="text-xs rounded-xl bg-[#EAF4FA] p-2.5 text-[#0F2233]">
                      Result: slope <b>{preview.slope}</b> mg/L per mV, zero <b>{preview.zero}</b> mV
                      {mv != null && <> · live DO will read <b>{doFromVoltage(mv, preview.slope, preview.zero).toFixed(2)} ppm</b></>}
                    </div>
                  )}
                  <button type="button" className="ox-btn ox-btn-primary ox-btn-block" disabled={!preview} onClick={saveCal}>Save calibration</button>
                  {calMsg && <div className="text-xs font-bold text-[#0E6FA3]">{calMsg}</div>}
                  {dev.doCalibratedAt && <div className="text-[11px] text-[#52677A]">Last calibrated {new Date(dev.doCalibratedAt).toLocaleString('en-IN')}{dev.doCalibratedBy ? ` by ${dev.doCalibratedBy}` : ''}. Re-calibrate every 45 days.</div>}
                </div>
              )}
            </Step>

            <Step
              n={3}
              title="Calibrate pH, ORP, temperature, salinity"
              icon={<FlaskConical className="w-4 h-4" />}
              done={(['ph', 'orp', 'temp', 'sal'] as const).filter((k) => isSensorInstalled(dev, k)).length > 0 && (['ph', 'orp', 'temp', 'sal'] as const).filter((k) => isSensorInstalled(dev, k)).every((k) => !!dev.sensorCalibration?.[k])}
            >
              <OtherSensorCalibration dev={dev} save={save} adminEmail={adminEmail} />
            </Step>

            <Step n={4} title="Pond location (installation point)" icon={<MapPin className="w-4 h-4" />} done={hasLoc}>
              <div className="flex flex-col gap-2">
                <div className="text-xs text-[#33475A]">
                  {hasLoc ? <>Installation point: <b>{lat.toFixed(6)}, {lng.toFixed(6)}</b></> : 'Installation point not saved yet.'}
                  <span className="block mt-1 text-[11px] text-[#52677A]">
                    The app follows the machine's live location automatically. This point is used while the machine has no
                    live fix, and as the home point to detect when the machine is moved.
                  </span>
                  <span className={`block mt-1 text-[11px] font-bold ${hasLiveFix(dev) ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {hasLiveFix(dev)
                      ? `Live location from machine: ${Number(dev.latitude).toFixed(5)}, ${Number(dev.longitude).toFixed(5)}${dev.isMoving ? ` · moved ${dev.moveDistanceKm || '?'} km from installation point` : ''}`
                      : 'No live location from the machine yet.'}
                  </span>
                </div>
                <button type="button" className="ox-btn ox-btn-primary ox-btn-block" onClick={useMyLocation}>
                  <MapPin className="w-4 h-4" /> Use my current location
                </button>
                <input className="ox-input" placeholder="or paste coordinates / Google Maps link" value={locText} onChange={(e) => setLocText(e.target.value)} />
                <button type="button" className="ox-btn ox-btn-secondary ox-btn-block" onClick={saveLoc}>Save location</button>
                {locMsg && <div className="text-xs font-bold text-[#0E6FA3]">{locMsg}</div>}
              </div>
            </Step>

            <Step n={5} title="Machine specifications" icon={<Wrench className="w-4 h-4" />} done={!!dev.specs?.model}>
              <p className="text-xs text-[#33475A]">Model, serial, motor HP / kW and power tariff (used for power reports), install and warranty dates, technician, farmer contact.</p>
              <MachineSpecsEditor device={dev} deviceId={id} />
            </Step>
          </>
        )}
      </div>
    </div>
  );
};
