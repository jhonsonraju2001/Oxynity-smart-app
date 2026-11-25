// Tests the Cloudflare worker's 24 h auto re-anchor with a fake Firestore and fake tower lookup.
import assert from 'node:assert/strict';
import worker from '../cloudflare-worker/worker.js';

const ANCHOR = { lat: 16.711395, lng: 81.464035 }; // installation point (admin, phone GPS)
const NEW_POND = { lat: 16.95, lng: 81.78 }; // ~40 km away
let doc; // fake Firestore document (REST "fields" shape)
let towerFix; // what BeaconDB returns
const history = {}; // devices/T1/readings
const runLogs = []; // devices/T1/runLog
let now = Date.parse('2026-11-16T06:00:00Z');

const toFields = (o) => {
  const f = {};
  for (const [k, v] of Object.entries(o))
    f[k] = typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { doubleValue: v } : { stringValue: v };
  return f;
};
const fromFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.doubleValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : v.booleanValue ?? v.stringValue)]));

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('beacondb')) return { ok: !!towerFix, json: async () => ({ location: towerFix, accuracy: 900 }) };
  if (opts.method === 'PATCH' && url.includes('/runLog/')) {
    runLogs.push(fromFields(JSON.parse(opts.body).fields));
    return { ok: true, json: async () => ({}) };
  }
  if (opts.method === 'PATCH' && url.includes('/readings/')) {
    const id = url.split('/readings/')[1].split('?')[0];
    history[id] = fromFields(JSON.parse(opts.body).fields);
    return { ok: true, json: async () => ({}) };
  }
  if (opts.method === 'PATCH') {
    const mask = [...url.matchAll(/updateMask\.fieldPaths=([A-Za-z0-9]+)/g)].map((m) => m[1]);
    const body = JSON.parse(opts.body);
    for (const k of mask) {
      if (k in body.fields) doc.fields[k] = body.fields[k];
      else delete doc.fields[k];
    }
    return { ok: true, json: async () => ({}) };
  }
  return { ok: true, json: async () => JSON.parse(JSON.stringify(doc)) };
};
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [now])); }
  static now() { return now; }
};

const report = async (lac, cid, extra = {}) => {
  const req = new Request('https://x/', { method: 'POST', body: JSON.stringify({ deviceId: 'T1', cellLac: lac, cellId: cid, ...extra }) });
  return (await worker.fetch(req, {})).json();
};
const hours = (h) => (now += h * 3600000);
const state = () => fromFields(doc.fields);

// 1. Calibrated pond on its own tower: stays on the installation point, no timer.
doc = { fields: toFields({ isCalibrated: true, calibratedLatitude: ANCHOR.lat, calibratedLongitude: ANCHOR.lng, calibratedCellLac: '1a', calibratedCellId: '2b', calibratedLocationName: 'Venu pond' }) };
let r = await report('1a', '2b');
assert.equal(r.isMoving, false); assert.equal(r.lat, ANCHOR.lat); assert.equal(state().relocCandidateSince, undefined);

// 2. Neighbouring tower flip 1 km away is noise: no timer, anchor kept.
towerFix = { lat: ANCHOR.lat + 0.008, lng: ANCHOR.lng };
r = await report('1a', '9c');
assert.equal(state().relocCandidateSince, undefined, 'tower noise must not start a re-anchor');

// 3. Machine taken to a new pond 40 km away: timer starts, shown as moving.
towerFix = { ...NEW_POND };
r = await report('77', '88');
assert.equal(r.isMoving, true); assert.ok(state().relocCandidateSince);
hours(10); towerFix = { lat: NEW_POND.lat + 0.005, lng: NEW_POND.lng }; await report('77', '89'); // cell jitter
hours(13); r = await report('77', '88');
assert.equal(r.reanchored, false, 'not yet 24 h'); assert.equal(state().calibratedLatitude, ANCHOR.lat);

// 4. After 24 h at the same place: new installation point, no longer "moving".
hours(1.5); r = await report('77', '88');
assert.equal(r.reanchored, true); assert.equal(r.isMoving, false);
let s = state();
assert.ok(Math.abs(s.calibratedLatitude - NEW_POND.lat) < 0.01 && Math.abs(s.calibratedLongitude - NEW_POND.lng) < 0.01);
assert.equal(s.calibratedCellLac, '77'); assert.equal(s.previousCalibratedLatitude, ANCHOR.lat);
assert.equal(s.relocCandidateSince, undefined, 'timer cleared'); assert.equal(s.gprsLocationFixed, true);

// 5. Next report on the new tower: stationary on the new point.
r = await report('77', '88'); assert.equal(r.isMoving, false); assert.ok(Math.abs(r.lat - NEW_POND.lat) < 0.01);

// 6. A trip that comes back before 24 h does not move the installation point.
const before = state().calibratedLatitude;
towerFix = { lat: 17.3, lng: 82.2 }; await report('55', '66'); assert.ok(state().relocCandidateSince);
hours(5); await report('77', '88'); // back home, same tower
assert.equal(state().relocCandidateSince, undefined); assert.equal(state().calibratedLatitude, before);

// 7. Moving on along a road keeps restarting the timer (never re-anchors while driving).
towerFix = { lat: 17.3, lng: 82.2 }; await report('55', '66'); const t0 = state().relocCandidateSince;
hours(30); towerFix = { lat: 17.6, lng: 82.5 }; r = await report('56', '67');
assert.equal(r.reanchored, false); assert.notEqual(state().relocCandidateSince, t0);

// 8. No position at all: honest "no fix" flag.
doc = { fields: {} }; towerFix = null; r = await report('', '');
assert.equal(state().gprsLocationFixed, false); assert.equal(r.reanchored, false);

// 9. History: one record per 15-minute slot, real values only.
for (const k in history) delete history[k];
doc = { fields: {} }; now = Date.parse('2026-11-17T06:01:00Z'); towerFix = null;
await report('', '', { doLevel: 6.4, doSensorConnected: true, voltageMv: 512 });
now += 5 * 60000; await report('', '', { doLevel: 6.1, doSensorConnected: true });
let ids = Object.keys(history);
assert.equal(ids.length, 1, 'one record per slot'); assert.equal(ids[0], '2026-11-17T06-00');
assert.equal(history[ids[0]].doLevel, 6.4); assert.equal(history[ids[0]].latitude, undefined, 'no GPS without a real fix');
now += 15 * 60000; await report('', '', { doLevel: 5.9, doSensorConnected: false, phLevel: 7.8 });
ids = Object.keys(history).sort();
assert.equal(ids.length, 2); assert.equal(history[ids[1]].doLevel, undefined, 'disconnected DO probe not recorded'); assert.equal(history[ids[1]].phLevel, 7.8);

// 10. Firmware v1.7: schedule settings and server time go to the machine
doc = { fields: { scheduleEnabled: { booleanValue: true }, cooldownEnabled: { booleanValue: true }, restMinutes: { integerValue: '45' }, totalRunHours: { doubleValue: 812.5 },
  schedules: { arrayValue: { values: [
    { mapValue: { fields: { enabled: { booleanValue: true }, startHour: { integerValue: '6' }, startMinute: { integerValue: '0' }, startAmPm: { stringValue: 'PM' }, stopHour: { integerValue: '9' }, stopMinute: { integerValue: '50' }, stopAmPm: { stringValue: 'AM' }, restMinutes: { integerValue: '30' } } } },
    { mapValue: { fields: { enabled: { booleanValue: false }, startHour: { integerValue: '12' }, startMinute: { integerValue: '0' }, startAmPm: { stringValue: 'AM' }, stopHour: { integerValue: '6' }, stopMinute: { integerValue: '0' }, stopAmPm: { stringValue: 'AM' } } } },
  ] } } } };
r = await report('', '');
assert.equal(r.cfg, '1,1,45;1,1080,590,30;0,0,360,0', 'compact schedule config'); assert.equal(r.trh, 812.5); assert.equal(r.t, Math.floor(now / 1000));

// 11. Machine-decided start: status saved, run history written, scheduler state stored
r = await report('', '', { firmwareScheduler: true, fwVersion: '1.7', triggerSource: 'SCHEDULE', status: 'ON', runEvent: 'START', runReason: 'Schedule', isCoolingDown: false, continuousRunSeconds: 0, totalRunHours: 812.6 });
assert.equal(state().status, 'ON'); assert.equal(r.r1, 'ON'); assert.equal(state().firmwareScheduler, true); assert.equal(state().totalRunHours, 812.6);
assert.equal(runLogs.at(-1).action, 'START');
r = await report('', '', { firmwareScheduler: true, triggerSource: 'REST', status: 'OFF', runEvent: 'STOP', runReason: '6 h rest', durationSec: 21600, isCoolingDown: true, cooldownEndsAt: Math.floor(now / 1000) + 1800, totalRunHours: 818.6 });
assert.equal(state().status, 'OFF'); assert.equal(state().isCoolingDown, true); assert.ok(state().cooldownEndsAt.endsWith('Z'));
assert.equal(runLogs.at(-1).durationSec, 21600); assert.equal(runLogs.at(-1).sessionDuration, '6h 0m');

// 12. Placeholder coordinates from the machine are never treated as a real position
doc = { fields: {} }; towerFix = null;
await report('', '', { latitude: 16.5787, longitude: 82.0061, gprsLocationFixed: true });
assert.equal(state().gprsLocationFixed, false);

console.log('worker: 12/12 scenarios pass (re-anchor, history, firmware scheduler)');
