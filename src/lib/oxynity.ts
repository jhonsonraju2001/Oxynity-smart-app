// Shared Oxynity rules: admin access, schedule windows, installed sensors.

/** Only these exact emails open the admin portal (never "email contains admin"). */
export const ADMIN_EMAILS = ['systemadmin@oxynity.com', 'admin@oxynity.com', 'info@oxynity.in'];

export const isAdminEmail = (email?: string | null): boolean =>
  ADMIN_EMAILS.includes(String(email || '').trim().toLowerCase());

/** Demo farmer login and its demo pond (not connected to any real machine). */
export const DEMO_FARMER_EMAIL = 'operator@oxynity.com';
export const DEMO_POND_ID = 'OXY-DEMO-001';

// ---------- Schedules ----------

export interface ScheduleLike {
  enabled?: boolean;
  startHour: number;
  startMinute: number;
  startAmPm: 'AM' | 'PM' | string;
  stopHour: number;
  stopMinute: number;
  stopAmPm: 'AM' | 'PM' | string;
}

const toMinutes = (h: number, m: number, ampm: string) => {
  let x = Number(h) % 12;
  if (ampm === 'PM') x += 12;
  return x * 60 + Number(m || 0);
};

export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Is `now` inside the schedule window? Supports overnight windows (e.g. 10 PM - 4 AM).
 * `key` = date the current window started, used so each window fires START/STOP once.
 */
export const scheduleWindow = (s: ScheduleLike, now: Date = new Date()): { inWin: boolean; key: string } => {
  const a = toMinutes(s.startHour, s.startMinute, s.startAmPm);
  const b = toMinutes(s.stopHour, s.stopMinute, s.stopAmPm);
  const n = now.getHours() * 60 + now.getMinutes();
  if (a === b) return { inWin: false, key: dateKey(now) };
  if (a < b) return { inWin: n >= a && n < b, key: dateKey(now) };
  if (n >= a) return { inWin: true, key: dateKey(now) };
  const yesterday = new Date(now.getTime() - 864e5);
  return { inWin: n < b, key: dateKey(n < b ? yesterday : now) };
};

/** Minutes from midnight for a schedule's start and stop. */
export const scheduleMinutes = (s: ScheduleLike) => ({
  start: toMinutes(s.startHour, s.startMinute, s.startAmPm),
  stop: toMinutes(s.stopHour, s.stopMinute, s.stopAmPm),
});

/** Length of a schedule in minutes (overnight windows wrap past midnight). */
export const scheduleLengthMin = (s: ScheduleLike): number => {
  const { start, stop } = scheduleMinutes(s);
  return start === stop ? 0 : (stop - start + 1440) % 1440;
};

/** Parts of the day a schedule covers, as [from, to) minute ranges inside 0..1440. */
const dayRanges = (s: ScheduleLike): [number, number][] => {
  const { start, stop } = scheduleMinutes(s);
  if (start === stop) return [];
  return start < stop ? [[start, stop]] : [[start, 1440], [0, stop]];
};

/** True when two schedules share any minute of the day (touching end-to-start is not an overlap). */
export const schedulesOverlap = (a: ScheduleLike, b: ScheduleLike): boolean =>
  dayRanges(a).some(([a1, a2]) => dayRanges(b).some(([b1, b2]) => a1 < b2 && b1 < a2));

/** First enabled schedule (other than `exceptId`) whose time overlaps `cand`, or null. */
export const findOverlappingSchedule = <T extends ScheduleLike & { id?: string; enabled?: boolean }>(
  cand: ScheduleLike,
  list: T[] | undefined,
  exceptId?: string | null
): T | null =>
  (Array.isArray(list) ? list : []).find((x) => x && x.enabled && x.id !== exceptId && schedulesOverlap(cand, x)) || null;

/** Suggested schedule name from its start time. */
export const scheduleNameFor = (startMin: number): string => {
  const h = Math.floor(((startMin % 1440) + 1440) % 1440 / 60);
  if (h >= 4 && h < 12) return 'Morning Aeration';
  if (h >= 12 && h < 16) return 'Afternoon Aeration';
  if (h >= 16 && h < 20) return 'Evening Aeration';
  return 'Night Aeration';
};

/** True when the device has no enabled schedule, or `now` is inside one. Used before restarting after cooldown. */
export const isWithinAnySchedule = (schedules: ScheduleLike[] | undefined, now: Date = new Date()): boolean => {
  const list = Array.isArray(schedules) ? schedules.filter((x) => x && x.enabled) : [];
  if (list.length === 0) return true;
  return list.some((x) => scheduleWindow(x, now).inWin);
};

// ---------- Installed sensors ----------

export type SensorKey = 'do' | 'ph' | 'orp' | 'temp' | 'sal';
export const SENSOR_LIST: [SensorKey, string][] = [
  ['do', 'DO'],
  ['temp', 'Temperature'],
  ['ph', 'pH'],
  ['orp', 'ORP'],
  ['sal', 'Salinity'],
];

/**
 * A sensor is shown only when the admin marked it installed (device.installedSensors),
 * or, for DO only, when the unit actually reports a DO sensor voltage.
 */
export const isSensorInstalled = (d: any, k: SensorKey): boolean => {
  const dev = d || {};
  const m = dev.installedSensors;
  if (m && typeof m === 'object' && k in m) return !!m[k];
  if (k === 'do') return dev.doSensorEnabled !== false && dev.voltageMv !== undefined && dev.voltageMv !== null;
  return false;
};

/**
 * Sensors to display: the farmer's on/off choice AND (installed by admin, or the farmer
 * switched it on in the Sensors page = device.shownSensors). "Installed" itself is admin-only.
 */
export const effectiveSensors = (d: any, pref?: Partial<Record<SensorKey, boolean>>) => {
  const r = {} as Record<SensorKey, boolean>;
  const shown = (d && d.shownSensors) || {};
  (['do', 'ph', 'orp', 'temp', 'sal'] as SensorKey[]).forEach((k) => {
    // installed: visible unless the farmer switched it off; not installed: visible only if switched on
    const cloudOn = isSensorInstalled(d, k) ? shown[k] !== false : !!shown[k];
    r[k] = !!(pref ? pref[k] !== false : true) && cloudOn;
  });
  return r;
};

/**
 * Auto (DO) mode needs a real DO sensor (installed by admin or reporting probe voltage) that the
 * farmer has not switched off on the Sensors page. Otherwise the Auto DO option is hidden.
 */
export const canUseAutoDo = (d: any, pref?: Partial<Record<SensorKey, boolean>>): boolean =>
  isSensorInstalled(d, 'do') && effectiveSensors(d, pref).do;

// ---------- Weather ----------
// NOTE: for the Play Store build move this key behind a server (Cloudflare worker / Cloud Function).
export const OPENWEATHER_KEY = (import.meta as any).env?.VITE_OPENWEATHER_KEY || '2e83beac82358d9d5f49340ef87c79c7';

export const kmBetween = (a: number, b: number, c: number, d: number) => {
  const t = (x: number) => (x * Math.PI) / 180;
  const dl = t(c - a), dn = t(d - b);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dn / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

// Placeholder the firmware / worker send while no real fix exists ("Cellular Signal Acquiring...").
const NO_FIX_LAT = 16.5787, NO_FIX_LNG = 82.0061;

/** True when latitude/longitude on the device is a real live position from the machine (not the placeholder). */
export const hasLiveFix = (d: any): boolean => {
  const r = d || {};
  const la = Number(r.latitude), lo = Number(r.longitude);
  if (!la || !lo || !isFinite(la) || !isFinite(lo)) return false;
  if (Math.abs(la - NO_FIX_LAT) < 1e-4 && Math.abs(lo - NO_FIX_LNG) < 1e-4) return false;
  if (/acquiring|cell search/i.test(`${r.locationName || ''} ${r.locationSource || ''}`)) return false;
  return true;
};

/**
 * Pond coordinates used by maps, weather and distance:
 *  1. the machine's live location (the Cloudflare worker keeps it on the installation point while the
 *     machine stays on the same cell tower, and follows the machine when it moves to a new place)
 *  2. otherwise the installation location saved by admin (calibrated), until the machine gets a fix.
 */
export const pondLatLon = (d: any): [number, number] | null => {
  const r = d || {};
  if (hasLiveFix(r)) return [Number(r.latitude), Number(r.longitude)];
  const la = Number(r.calibratedLatitude), lo = Number(r.calibratedLongitude);
  return la && lo && isFinite(la) && isFinite(lo) ? [la, lo] : null;
};

// ---------- Rest (cooldown) time ----------

/** Minutes of rest after 6 h of continuous running: the active schedule's choice, else the pond default, else 30. */
export const restMinutesFor = (d: any, now: Date = new Date()): number => {
  const list: any[] = Array.isArray(d?.schedules) ? d.schedules.filter((x: any) => x && x.enabled) : [];
  // If old data still has overlapping schedules, the longest rest of the open ones wins (safer for the motor).
  const open = list.filter((x) => scheduleWindow(x, now).inWin && Number(x.restMinutes) > 0);
  const best = open.length ? Math.max(...open.map((x) => Number(x.restMinutes))) : undefined;
  const v = Number(best ?? d?.restMinutes ?? 30);
  return isFinite(v) && v >= 5 && v <= 240 ? v : 30;
};

// ---------- Power consumption ----------

/** Motor load in kW from the machine specs set by admin (motorKw, or HP x 0.746). 0 = not set. */
export const motorKwOf = (d: any): number => {
  const s = d?.specs || {};
  const kw = Number(s.motorKw);
  if (isFinite(kw) && kw > 0) return kw;
  const hp = Number(s.motorHp);
  return isFinite(hp) && hp > 0 ? Number((hp * 0.746).toFixed(3)) : 0;
};

/** Estimated energy (kWh) and cost for a number of run hours. Estimate = rated motor load x hours. */
export const powerUse = (d: any, hours: number) => {
  const kw = motorKwOf(d);
  const tariff = Number(d?.specs?.tariffPerKwh);
  const kwh = kw * Math.max(0, hours || 0);
  return { kw, kwh, cost: isFinite(tariff) && tariff > 0 ? kwh * tariff : null, tariff: isFinite(tariff) && tariff > 0 ? tariff : null };
};

/** Seconds from a start/stop log entry (new logs carry durationSec; old ones only "2h 15m" text). */
export const logSeconds = (l: any): number => {
  if (typeof l?.durationSec === 'number') return l.durationSec;
  const s = String(l?.sessionDuration || '');
  const h = /(\d+(?:\.\d+)?)\s*h/i.exec(s), m = /(\d+(?:\.\d+)?)\s*m/i.exec(s), sec = /(\d+(?:\.\d+)?)\s*s/i.exec(s);
  return (h ? parseFloat(h[1]) * 3600 : 0) + (m ? parseFloat(m[1]) * 60 : 0) + (sec ? parseFloat(sec[1]) : 0);
};

/** Run hours inside [from, to] from STOP log entries. */
export const runHoursInRange = (logs: any[], from: Date, to: Date): number => {
  const a = from.getTime(), b = to.getTime();
  return (
    (logs || [])
      .filter((l) => l && l.action === 'STOP')
      .filter((l) => {
        const t = new Date(l.timestamp).getTime();
        return t >= a && t <= b;
      })
      .reduce((s, l) => s + logSeconds(l), 0) / 3600
  );
};

// ---------- Alarm sound ----------

let alarmCtx: AudioContext | null = null;
let alarmTimer: any = null;

/** Loud two-tone siren for `seconds` (default 12). Call stopAlarm() to silence. */
export const playAlarm = (seconds = 12) => {
  try {
    stopAlarm();
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    alarmCtx = ctx;
    const end = ctx.currentTime + seconds;
    for (let t = ctx.currentTime, i = 0; t < end; t += 0.45, i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = i % 2 ? 660 : 990;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.42);
    }
    try { navigator.vibrate?.([400, 200, 400, 200, 400]); } catch {}
    alarmTimer = setTimeout(stopAlarm, seconds * 1000 + 200);
  } catch {}
};

export const stopAlarm = () => {
  try { clearTimeout(alarmTimer); alarmCtx?.close(); } catch {}
  alarmCtx = null;
};

/** Minutes since the unit last reported (lastSeen / updatedAt). */
export const minutesSinceSeen = (d: any): number => {
  const t = new Date(d?.lastSeen || d?.updatedAt || 0).getTime();
  return t > 0 ? (Date.now() - t) / 60000 : Infinity;
};

// ---------- Calibration of pH / ORP / temperature / salinity ----------
// The machine sends raw values; the admin calibrates against a reference (buffer, standard solution,
// thermometer, refractometer) in Sensor setup. The app shows: corrected = raw × slope + offset.
// DO is calibrated separately (doSlopeK / doZeroMv, applied inside the ESP32).

export type CalKey = 'temp' | 'ph' | 'orp' | 'sal';
export const CAL_FIELDS: Record<CalKey, string> = { temp: 'waterTemp', ph: 'phLevel', orp: 'orpLevel', sal: 'salinity' };
export interface SensorCal { slope: number; offset: number; points?: { ref: number; raw: number }[]; at?: string; by?: string }

/** Line through calibration points: 1 point = offset only; 2+ points = least-squares slope and offset. */
export const fitCalibration = (pts: { ref: number; raw: number }[]): SensorCal | null => {
  const p = (pts || []).filter((x) => isFinite(x.ref) && isFinite(x.raw));
  if (!p.length) return null;
  if (p.length === 1) return { slope: 1, offset: +(p[0].ref - p[0].raw).toFixed(4) };
  const n = p.length;
  const mx = p.reduce((a, x) => a + x.raw, 0) / n, my = p.reduce((a, x) => a + x.ref, 0) / n;
  const sxx = p.reduce((a, x) => a + (x.raw - mx) ** 2, 0);
  if (sxx < 1e-9) return { slope: 1, offset: +(my - mx).toFixed(4) }; // same raw value twice: offset only
  const slope = p.reduce((a, x) => a + (x.raw - mx) * (x.ref - my), 0) / sxx;
  if (!(slope > 0.2 && slope < 5)) return null; // probe or points wrong (e.g. buffers swapped)
  return { slope: +slope.toFixed(5), offset: +(my - slope * mx).toFixed(4) };
};

const validCal = (c: any): c is SensorCal => !!c && isFinite(Number(c.slope)) && isFinite(Number(c.offset)) && Number(c.slope) > 0;

/** Copy of a device / reading with calibrated values; raw values kept in `_raw`. */
export const applySensorCalibration = <T extends Record<string, any>>(d: T, cal: any = d?.sensorCalibration): T => {
  if (!d || !cal || typeof cal !== 'object') return d;
  let out: any = null;
  (Object.keys(CAL_FIELDS) as CalKey[]).forEach((k) => {
    const f = CAL_FIELDS[k], v = d[f], c = cal[k];
    if (typeof v !== 'number' || !isFinite(v) || !validCal(c)) return;
    out = out || { ...d, _raw: { ...(d as any)._raw } };
    out._raw[f] = v;
    out[f] = +(v * Number(c.slope) + Number(c.offset)).toFixed(3);
  });
  return (out || d) as T;
};

/** Raw value of a field (undo calibration), used for capture and for saved history. */
export const rawValueOf = (d: any, k: CalKey): number | null => {
  const f = CAL_FIELDS[k];
  if (d?._raw && typeof d._raw[f] === 'number') return d._raw[f];
  return typeof d?.[f] === 'number' && isFinite(d[f]) ? d[f] : null;
};
