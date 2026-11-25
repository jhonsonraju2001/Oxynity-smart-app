// Date-range (crop) reports: run hours, starts/stops, estimated power use. Shared by customer app and admin.
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { applySensorCalibration, hasLiveFix, isSensorInstalled, logSeconds, minutesSinceSeen, powerUse, SensorKey } from './oxynity';

// ---------- Sensor & GPS history (devices/{id}/readings, one record per 15 minutes) ----------

export const SENSOR_FIELDS: Record<SensorKey, { field: string; label: string; unit: string; dp: number }> = {
  do: { field: 'doLevel', label: 'DO', unit: 'ppm', dp: 2 },
  temp: { field: 'waterTemp', label: 'Water temp', unit: '°C', dp: 1 },
  ph: { field: 'phLevel', label: 'pH', unit: '', dp: 2 },
  orp: { field: 'orpLevel', label: 'ORP', unit: 'mV', dp: 0 },
  sal: { field: 'salinity', label: 'Salinity', unit: 'ppt', dp: 1 },
};
export const SENSOR_ORDER: SensorKey[] = ['do', 'temp', 'ph', 'orp', 'sal'];

/** 15-minute slot id, in UTC, shared by the app and the Cloudflare worker so both write the same record. */
export const readingSlotId = (ms: number = Date.now()) =>
  new Date(Math.floor(ms / 900000) * 900000).toISOString().slice(0, 16).replace(':', '-');

const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);

/** One history record from the live pond state: only installed sensors, GPS only when it is a real fix. */
export const readingFromDevice = (d: any) => {
  const r: any = { timestamp: new Date(Math.floor(Date.now() / 900000) * 900000).toISOString(), status: d?.status || 'OFF', source: 'app' };
  SENSOR_ORDER.forEach((k) => {
    // history keeps RAW values (same as the worker writes); calibration is applied when reports are made
    const f = SENSOR_FIELDS[k].field;
    const v = num(d?._raw && typeof d._raw[f] === 'number' ? d._raw[f] : d?.[f]);
    if (isSensorInstalled(d, k) && v !== null && v >= 0) r[f] = v;
  });
  if (num(d?.voltageMv) !== null) r.voltageMv = d.voltageMv;
  if (hasLiveFix(d)) { r.latitude = Number(d.latitude); r.longitude = Number(d.longitude); r.locationSource = String(d.locationSource || ''); }
  return r;
};

/** Save the current 15-minute record (merge, so the worker and several phones never create duplicates). */
export const saveReadingIfOnline = async (d: any): Promise<string | null> => {
  if (!d?.deviceId || minutesSinceSeen(d) > 5) return null; // machine offline: nothing new to record
  const id = readingSlotId();
  await setDoc(doc(db, 'devices', d.deviceId, 'readings', id), readingFromDevice(d), { merge: true });
  return id;
};

/** Sensor/GPS history of a pond inside [from, to]. */
export const fetchReadings = async (device: any, from: Date, to: Date): Promise<any[]> => {
  try {
    const q = query(
      collection(db, 'devices', device.deviceId, 'readings'),
      where('timestamp', '>=', from.toISOString()),
      where('timestamp', '<=', to.toISOString())
    );
    const snap = await Promise.race([getDocs(q), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000))]);
    const out: any[] = [];
    snap.forEach((x) => out.push(applySensorCalibration({ id: x.id, ...(x.data() as any) }, device?.sensorCalibration)));
    return out.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  } catch (e) {
    console.warn('Sensor history not loaded:', e);
    return [];
  }
};

export interface SensorStat { key: SensorKey; label: string; unit: string; count: number; min: number; max: number; avg: number; dp: number; low?: number }

/** min / avg / max for each requested sensor; DO also counts readings below the pond's low-DO alarm. */
export const sensorStats = (device: any, readings: any[], keys: SensorKey[]): SensorStat[] =>
  keys.map((k) => {
    const f = SENSOR_FIELDS[k];
    const vals = readings.map((r) => num(r[f.field])).filter((v): v is number => v !== null && v >= 0);
    const st: SensorStat = { key: k, label: f.label, unit: f.unit, dp: f.dp, count: vals.length, min: vals.length ? Math.min(...vals) : 0, max: vals.length ? Math.max(...vals) : 0, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
    if (k === 'do') st.low = vals.filter((v) => v < (Number(device?.minDoAlert) || 5)).length;
    return st;
  });

export interface ReportOptions { pumps: boolean; sensors: SensorKey[]; gps: boolean; schedules: boolean }
export const ALL_REPORT: ReportOptions = { pumps: true, sensors: SENSOR_ORDER, gps: true, schedules: true };

export const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00`);
export const dayEnd = (ymd: string) => new Date(`${ymd}T23:59:59.999`);
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** All start/stop records of a pond inside [from, to]: full cloud history + the latest ones kept on the device record. */
export const fetchRunLogs = async (device: any, from: Date, to: Date): Promise<any[]> => {
  const byId: Record<string, any> = {};
  (Array.isArray(device?.runLogs) ? device.runLogs : []).forEach((l: any) => l?.id && (byId[l.id] = l));
  try {
    const q = query(
      collection(db, 'devices', device.deviceId, 'runLog'),
      where('timestamp', '>=', from.toISOString()),
      where('timestamp', '<=', to.toISOString())
    );
    const snap = await Promise.race([getDocs(q), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
    snap.forEach((d) => (byId[d.id] = { id: d.id, ...(d.data() as any) }));
  } catch (e) {
    console.warn('Run log history not loaded, using latest records only:', e);
  }
  const a = from.getTime(), b = to.getTime();
  return Object.values(byId)
    .filter((l: any) => {
      const t = new Date(l.timestamp).getTime();
      return t >= a && t <= b;
    })
    .sort((x: any, y: any) => String(x.timestamp).localeCompare(String(y.timestamp)));
};

export interface RangeSummary {
  days: number;
  hours: number;
  starts: number;
  stops: number;
  avgPerDay: number;
  kw: number;
  kwh: number;
  cost: number | null;
  tariff: number | null;
  daily: { date: string; hours: number; starts: number }[];
}

export const summarize = (device: any, logs: any[], from: Date, to: Date): RangeSummary => {
  const perDay: Record<string, { hours: number; starts: number }> = {};
  let secs = 0, starts = 0, stops = 0;
  logs.forEach((l) => {
    const k = ymd(new Date(l.timestamp));
    perDay[k] = perDay[k] || { hours: 0, starts: 0 };
    if (l.action === 'START') { starts++; perDay[k].starts++; }
    if (l.action === 'STOP') { stops++; const s = logSeconds(l); secs += s; perDay[k].hours += s / 3600; }
  });
  const days = Math.max(1, Math.round((Math.min(to.getTime(), Date.now()) - from.getTime()) / 864e5) || 1);
  const hours = secs / 3600;
  const p = powerUse(device, hours);
  return {
    days, hours, starts, stops, avgPerDay: hours / days, kw: p.kw, kwh: p.kwh, cost: p.cost, tariff: p.tariff,
    daily: Object.keys(perDay).sort().map((d) => ({ date: d, hours: perDay[d].hours, starts: perDay[d].starts })),
  };
};

const schedLine = (device: any) =>
  (Array.isArray(device?.schedules) ? device.schedules : [])
    .filter((x: any) => x && x.enabled)
    .map((x: any) => `${x.name} ${x.startHour}:${String(x.startMinute).padStart(2, '0')} ${x.startAmPm}-${x.stopHour}:${String(x.stopMinute).padStart(2, '0')} ${x.stopAmPm} (rest ${x.restMinutes || 30} min)`)
    .join(' | ') || 'None';

/** CSV rows for one pond over a date range, with only the parts the user chose. */
export const pondRangeRows = (
  device: any,
  logs: any[],
  from: Date,
  to: Date,
  readings: any[] = [],
  opt: ReportOptions = { ...ALL_REPORT, gps: false }
): (string | number)[][] => {
  const s = summarize(device, logs, from, to);
  const sp = device?.specs || {};
  const keys = opt.sensors.filter((k) => isSensorInstalled(device, k));
  const skipped = opt.sensors.filter((k) => !keys.includes(k)).map((k) => SENSOR_FIELDS[k].label);
  const rows: (string | number)[][] = [
    ['Pond', String(device.name || device.deviceId)],
    ['Device ID', device.deviceId],
    ['Farmer', String(device.ownerName || device.contactPerson?.name || device.ownerEmail || '')],
    ['Period', `${ymd(from)} to ${ymd(to)} (${s.days} days)`],
    ['Machine', [sp.model, sp.capacity, sp.serial].filter(Boolean).join(' / ') || 'Not recorded'],
  ];
  if (opt.pumps) {
    rows.push(
      ['Run hours in period', s.hours.toFixed(2)],
      ['Average run hours per day', s.avgPerDay.toFixed(2)],
      ['Starts / Stops', `${s.starts} / ${s.stops}`],
      ['Lifetime run hours', (Number(device.totalRunHours) || 0).toFixed(2)],
      ['Motor load (kW)', s.kw ? s.kw.toFixed(2) : 'Not set by admin'],
      ['Estimated power used (kWh / units)', s.kw ? s.kwh.toFixed(1) : 'Not available'],
      ['Estimated power cost (Rs)', s.cost != null ? s.cost.toFixed(0) : 'Tariff not set']
    );
  }
  if (opt.schedules) rows.push(['Active schedules', schedLine(device)]);

  const stats = sensorStats(device, readings, keys);
  if (opt.sensors.length) {
    rows.push([], ['SENSOR SUMMARY (readings every 15 minutes)'], ['Sensor', 'Readings', 'Average', 'Minimum', 'Maximum', 'Unit', 'Note']);
    if (!keys.length) rows.push(['No selected sensor is installed on this pond']);
    stats.forEach((x) =>
      rows.push(
        x.count
          ? [x.label, x.count, x.avg.toFixed(x.dp), x.min.toFixed(x.dp), x.max.toFixed(x.dp), x.unit, x.key === 'do' ? `${x.low} readings below ${Number(device?.minDoAlert) || 5} ppm` : '']
          : [x.label, 0, '', '', '', x.unit, 'No readings saved in this period']
      )
    );
    if (skipped.length) rows.push([`Not installed (skipped): ${skipped.join(', ')}`]);
  }

  if (opt.pumps || keys.length) {
    // one line per day: run hours + daily sensor averages
    const perDay: Record<string, Record<string, number[]>> = {};
    readings.forEach((r) => {
      const d = ymd(new Date(r.timestamp));
      perDay[d] = perDay[d] || {};
      keys.forEach((k) => {
        const v = num(r[SENSOR_FIELDS[k].field]);
        if (v !== null && v >= 0) (perDay[d][k] = perDay[d][k] || []).push(v);
      });
    });
    const runByDay: Record<string, { hours: number; starts: number }> = {};
    s.daily.forEach((d) => (runByDay[d.date] = d));
    const dates = Array.from(new Set([...Object.keys(perDay), ...(opt.pumps ? Object.keys(runByDay) : [])])).sort();
    const head: string[] = ['Date'];
    if (opt.pumps) head.push('Run hours', 'Starts', 'Estimated kWh');
    keys.forEach((k) => head.push(`${SENSOR_FIELDS[k].label} avg${SENSOR_FIELDS[k].unit ? ` (${SENSOR_FIELDS[k].unit})` : ''}`, `${SENSOR_FIELDS[k].label} min`, `${SENSOR_FIELDS[k].label} max`));
    rows.push([], ['DAILY DATA'], head);
    dates.forEach((d) => {
      const r: (string | number)[] = [d];
      if (opt.pumps) { const x = runByDay[d]; r.push(x ? x.hours.toFixed(2) : '0.00', x ? x.starts : 0, x && s.kw ? (x.hours * s.kw).toFixed(1) : ''); }
      keys.forEach((k) => {
        const v = perDay[d]?.[k] || [];
        const dp = SENSOR_FIELDS[k].dp;
        r.push(v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(dp) : '', v.length ? Math.min(...v).toFixed(dp) : '', v.length ? Math.max(...v).toFixed(dp) : '');
      });
      rows.push(r);
    });
    if (!dates.length) rows.push(['No data saved in this period']);
  }

  if (opt.pumps) {
    rows.push([], ['START / STOP LOG'], ['Date', 'Time', 'Action', 'Trigger', 'Session duration']);
    logs.forEach((g) => rows.push([g.formattedDate || ymd(new Date(g.timestamp)), g.formattedTime || '', g.action || '', g.triggerSource || '', g.sessionDuration || '']));
    if (!logs.length) rows.push(['No start/stop records in this period']);
  }

  if (keys.length) {
    rows.push([], ['SENSOR READINGS (every 15 minutes)'], ['Date', 'Time', 'Machine', ...keys.map((k) => `${SENSOR_FIELDS[k].label}${SENSOR_FIELDS[k].unit ? ` (${SENSOR_FIELDS[k].unit})` : ''}`)]);
    readings.forEach((r) => {
      const t = new Date(r.timestamp);
      if (!keys.some((k) => num(r[SENSOR_FIELDS[k].field]) !== null)) return;
      rows.push([ymd(t), t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), r.status || '', ...keys.map((k) => { const v = num(r[SENSOR_FIELDS[k].field]); return v === null ? '' : v.toFixed(SENSOR_FIELDS[k].dp); })]);
    });
  }

  if (opt.gps) {
    const pts = readings.filter((r) => num(r.latitude) !== null && num(r.longitude) !== null);
    rows.push([], ['GPS / MACHINE LOCATION'], ['Installation point', device.calibratedLatitude ? `${device.calibratedLatitude}, ${device.calibratedLongitude}` : 'Not set']);
    rows.push(['Date', 'Time', 'Latitude', 'Longitude', 'Source', 'Google Maps']);
    let last = '';
    pts.forEach((r) => {
      const key = `${Number(r.latitude).toFixed(4)},${Number(r.longitude).toFixed(4)}`;
      if (key === last) return; // list only changes of position
      last = key;
      const t = new Date(r.timestamp);
      rows.push([ymd(t), t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), Number(r.latitude).toFixed(6), Number(r.longitude).toFixed(6), r.locationSource || '', `https://maps.google.com/?q=${r.latitude},${r.longitude}`]);
    });
    if (!pts.length) rows.push(['No machine positions recorded in this period (the machine has not sent a real GPS / tower fix)']);
  }
  return rows;
};
