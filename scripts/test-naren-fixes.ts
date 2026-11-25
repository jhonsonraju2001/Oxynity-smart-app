// Tests for the Nov 2026 fixes: admin allowlist, schedule windows, cooldown resume, installed sensors.
import { isAdminEmail, scheduleWindow, isWithinAnySchedule, isSensorInstalled, effectiveSensors, canUseAutoDo, pondLatLon, hasLiveFix, schedulesOverlap, findOverlappingSchedule, scheduleLengthMin, scheduleNameFor, restMinutesFor, fitCalibration, applySensorCalibration, rawValueOf } from '../src/lib/oxynity';
import { pondRangeRows, sensorStats, readingSlotId } from '../src/lib/reports';

let passed = 0, failed = 0;
const t = (ok: boolean, d: string) => { ok ? passed++ : failed++; console.log(`${ok ? '✔ PASS' : '✘ FAIL'} ${d}`); };
const at = (h: number, m: number) => new Date(2026, 10, 16, h, m);
const day = { startHour: 6, startMinute: 0, startAmPm: 'AM', stopHour: 12, stopMinute: 0, stopAmPm: 'PM', enabled: true };
const night = { startHour: 10, startMinute: 0, startAmPm: 'PM', stopHour: 4, stopMinute: 0, stopAmPm: 'AM', enabled: true };

t(isAdminEmail('systemadmin@oxynity.com') && isAdminEmail(' Info@Oxynity.in '), 'approved admin emails accepted');
t(!isAdminEmail('myadmin@gmail.com') && !isAdminEmail('admin@oxynity.com.evil'), 'emails merely containing "admin" rejected');
t(!scheduleWindow(day, at(5, 59)).inWin && scheduleWindow(day, at(6, 0)).inWin && scheduleWindow(day, at(6, 20)).inWin, 'day window start + late catch-up');
t(!scheduleWindow(day, at(12, 0)).inWin, 'day window ends at stop time');
t(scheduleWindow(night, at(23, 0)).inWin && scheduleWindow(night, at(2, 0)).inWin && !scheduleWindow(night, at(5, 0)).inWin, 'overnight window');
t(scheduleWindow(night, at(2, 0)).key === '2026-11-15', 'overnight window keyed to its start date');
t(isWithinAnySchedule([], at(13, 0)), 'no schedules -> cooldown may resume');
t(!isWithinAnySchedule([day], at(12, 15)), 'stop time passed during rest -> stay OFF');
t(isWithinAnySchedule([day], at(9, 0)), 'inside window -> resume after rest');
t(!isSensorInstalled({}, 'do') && isSensorInstalled({ voltageMv: 512 }, 'do'), 'DO shown only with real probe voltage');
t(!isSensorInstalled({ voltageMv: 512, doSensorEnabled: false }, 'do'), 'DO hidden when disabled');
t(isSensorInstalled({ installedSensors: { ph: true } }, 'ph') && !isSensorInstalled({ phLevel: 7.6 }, 'ph'), 'pH only when admin marks it installed');
const eff = effectiveSensors({ installedSensors: { do: true, temp: true } }, { do: true, ph: true, orp: true, temp: false, sal: true });
t(eff.do && !eff.temp && !eff.ph, 'visible = user choice AND installed');

t(!canUseAutoDo({}) && !canUseAutoDo({ shownSensors: { do: true }, doLevel: 6.8 }), 'Auto DO hidden without a real DO sensor (display toggle does not count)');
t(canUseAutoDo({ installedSensors: { do: true } }) && canUseAutoDo({ voltageMv: 480 }), 'Auto DO shown when admin marks DO installed or probe reports');
t(effectiveSensors({ shownSensors: { ph: true } }, { ph: true }).ph && !isSensorInstalled({ shownSensors: { ph: true } }, 'ph'), 'farmer toggle shows pH without marking it installed');

t(!hasLiveFix({ latitude: 16.5787, longitude: 82.0061 }) && pondLatLon({ latitude: 16.5787, longitude: 82.0061, calibratedLatitude: 16.7, calibratedLongitude: 81.4 })?.[0] === 16.7, 'placeholder location ignored, installation point used');
t(pondLatLon({ latitude: 17.01, longitude: 82.24, locationName: 'Cell Tower Fix', calibratedLatitude: 16.7, calibratedLongitude: 81.4 })?.[0] === 17.01, 'machine moved: live location used automatically');


// Naren's case: 6 PM - 9:50 AM and 6 AM - 6:30 PM overlap twice and cover all 24 h
const eve = { id: 'a', name: 'Night', startHour: 6, startMinute: 0, startAmPm: 'PM', stopHour: 9, stopMinute: 50, stopAmPm: 'AM', enabled: true, restMinutes: 30 };
const dayLong = { id: 'b', name: 'Day', startHour: 6, startMinute: 0, startAmPm: 'AM', stopHour: 6, stopMinute: 30, stopAmPm: 'PM', enabled: true, restMinutes: 90 };
t(schedulesOverlap(eve, dayLong) && schedulesOverlap(dayLong, eve), 'overlap detected (overnight vs day)');
t(findOverlappingSchedule(eve, [eve, dayLong], 'a')?.id === 'b', 'overlapping schedule found, itself excluded');
t(!findOverlappingSchedule(eve, [{ ...dayLong, enabled: false }], 'a'), 'paused schedule does not block');
t(!schedulesOverlap(day, { ...day, startHour: 12, startAmPm: 'PM', stopHour: 6, stopAmPm: 'PM' }), 'touching end-to-start is not an overlap');
t(!schedulesOverlap(day, night), 'separate day and night schedules allowed');
t(scheduleLengthMin(eve) === 950 && scheduleLengthMin(dayLong) === 750, 'schedule length incl. overnight');
t(scheduleNameFor(18 * 60) === 'Evening Aeration' && scheduleNameFor(6 * 60) === 'Morning Aeration' && scheduleNameFor(22 * 60) === 'Night Aeration', 'name from start time');
t(restMinutesFor({ schedules: [eve, dayLong] }, at(7, 0)) === 90, 'old overlapping data: longest rest wins');
t(!canUseAutoDo({ installedSensors: { do: true }, shownSensors: { do: false } }), 'Auto DO hidden when farmer switches DO off');
t(!canUseAutoDo({ installedSensors: { do: true } }, { do: false }), 'Auto DO hidden when DO switched off on this phone');


// pH / ORP / temp / salinity calibration
const c2 = fitCalibration([{ ref: 7, raw: 7.3 }, { ref: 4.01, raw: 4.5 }])!;
t(Math.abs(7.3 * c2.slope + c2.offset - 7) < 0.01 && Math.abs(4.5 * c2.slope + c2.offset - 4.01) < 0.01, 'pH two-point calibration fits both buffers');
t(fitCalibration([{ ref: 28.5, raw: 27.9 }])!.slope === 1 && Math.abs(fitCalibration([{ ref: 28.5, raw: 27.9 }])!.offset - 0.6) < 1e-6, 'one point = offset only');
t(fitCalibration([{ ref: 7, raw: 4.5 }, { ref: 4.01, raw: 7.3 }]) === null, 'swapped buffers rejected');
const cd = applySensorCalibration({ phLevel: 7.3, waterTemp: 27.9, sensorCalibration: { ph: c2, temp: { slope: 1, offset: 0.6 } } } as any);
t(Math.abs(cd.phLevel - 7) < 0.01 && Math.abs(cd.waterTemp - 28.5) < 0.01 && rawValueOf(cd, 'ph') === 7.3, 'calibration applied, raw kept');
t(applySensorCalibration({ phLevel: 7.3 } as any).phLevel === 7.3, 'no calibration = unchanged');

// reports with sensor history
t(readingSlotId(Date.parse('2026-11-16T12:44:59Z')) === '2026-11-16T12-30', '15-minute slot id (UTC)');
const dev = { deviceId: 'P1', name: 'Pond', installedSensors: { do: true, ph: false }, minDoAlert: 5 };
const rd = [ { timestamp: '2026-11-16T01:00:00.000Z', doLevel: 4.2 }, { timestamp: '2026-11-16T02:00:00.000Z', doLevel: 6.8 }, { timestamp: '2026-11-16T03:00:00.000Z', doLevel: 7.0, latitude: 16.7, longitude: 81.4 } ];
const st = sensorStats(dev, rd, ['do']);
t(st[0].count === 3 && st[0].low === 1 && Math.abs(st[0].avg - 6) < 0.01, 'sensor stats: avg, low-DO count');
const rows = pondRangeRows(dev, [], new Date('2026-11-16T00:00:00'), new Date('2026-11-16T23:59:59'), rd, { pumps: false, schedules: false, gps: true, sensors: ['do', 'ph'] });
const flat = rows.map((r) => r.join('|')).join('\n');
t(flat.includes('SENSOR SUMMARY') && flat.includes('Not installed (skipped): pH') && !flat.includes('START / STOP LOG'), 'report has only chosen parts; pH skipped as not installed');
t(flat.includes('GPS / MACHINE LOCATION') && flat.includes('16.700000'), 'GPS rows from history');

console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed) process.exit(1);
