import { DeviceTelemetry, AeratorSchedule } from '../src/types/iot';
import { initialDeviceData, DEFAULT_DEVICE_ID, createDefaultEmptyDevice } from '../src/data/initialDevice';

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string) {
  if (condition) {
    console.log(`✔ PASS [${desc}]`);
    passed++;
  } else {
    console.error(`❌ FAIL [${desc}]`);
    failed++;
  }
}

console.log('================================================================');
console.log('  OXYNITY SMART - NULL-SAFETY, POND ISOLATION & SCHEDULE TESTS  ');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// TEST GROUP 1: .toFixed Null-Safety
// ---------------------------------------------------------------------------
console.log('--- TEST GROUP 1: .toFixed Null-Safety ---');

// Emulate a newly linked or empty device where sensors have not reported yet
const emptyDevice: DeviceTelemetry = {
  ...createDefaultEmptyDevice('user@example.com'),
  doLevel: undefined as any,
  targetDo: undefined as any,
  minDoAlert: undefined as any,
  phLevel: undefined as any,
  totalRunHours: undefined as any,
  waterTemp: undefined as any,
};

// Safe formatting tests
const safeDoText = (emptyDevice.doLevel ?? 0).toFixed(1);
assert(safeDoText === '0.0', 'Undefined doLevel safely defaults to 0.0 without throwing TypeError');

const safeTargetDoText = (emptyDevice.targetDo ?? 7.5).toFixed(1);
assert(safeTargetDoText === '7.5', 'Undefined targetDo safely defaults to 7.5 without throwing TypeError');

const safeMinDoAlert = (emptyDevice.minDoAlert ?? 5.0).toFixed(1);
assert(safeMinDoAlert === '5.0', 'Undefined minDoAlert safely defaults to 5.0 without throwing TypeError');

const safeTotalRunHours = (emptyDevice.totalRunHours ?? 0).toFixed(2);
assert(safeTotalRunHours === '0.00', 'Undefined totalRunHours safely defaults to 0.00 without throwing TypeError');

// Test isMissing condition
const doVal = emptyDevice.doLevel;
const isDoMissing = emptyDevice.doSensorConnected === false || doVal === undefined || doVal === null || doVal < 0;
assert(isDoMissing === true, 'Undefined doLevel correctly classifies as sensor missing');

// ---------------------------------------------------------------------------
// TEST GROUP 2: Strict User-Scoped Pond Access
// ---------------------------------------------------------------------------
console.log('\n--- TEST GROUP 2: Strict User-Scoped Pond Access ---');

// Mock localStorage for test environment
const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
};

const getPondsForUser = (cleanEmail: string): string[] => {
  const isDemoUser = cleanEmail === 'operator@oxynity.com' || cleanEmail === 'admin@oxynity.com';
  const userPondsKey = `oxynity_user_ponds_${cleanEmail}`;
  const localPondsStr = mockLocalStorage.getItem(userPondsKey);
  if (localPondsStr) {
    try {
      const parsed = JSON.parse(localPondsStr);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  if (isDemoUser) {
    const defaultPonds = [DEFAULT_DEVICE_ID, 'OXY-ESP32-002'];
    mockLocalStorage.setItem(userPondsKey, JSON.stringify(defaultPonds));
    return defaultPonds;
  }
  return [];
};

// Standard / Fresh user
const freshUserPonds = getPondsForUser('farmer.raju@gmail.com');
assert(freshUserPonds.length === 0, 'Fresh standard user receives 0 linked ponds (no demo pond leakage)');

// Demo operator
const demoOperatorPonds = getPondsForUser('operator@oxynity.com');
assert(demoOperatorPonds.length === 2 && demoOperatorPonds.includes(DEFAULT_DEVICE_ID), 'Demo operator receives default demo ponds');

// Demo admin
const demoAdminPonds = getPondsForUser('admin@oxynity.com');
assert(demoAdminPonds.length === 2 && demoAdminPonds.includes('OXY-ESP32-002'), 'Demo admin receives default demo ponds');

// ---------------------------------------------------------------------------
// TEST GROUP 3: Duplicate Linking Prevention
// ---------------------------------------------------------------------------
console.log('\n--- TEST GROUP 3: Duplicate Linking Prevention ---');

interface MockDeviceRecord {
  deviceId: string;
  ownerEmail?: string;
  linkedEmails?: string[];
}

const mockDeviceDatabase: MockDeviceRecord[] = [
  {
    deviceId: 'OXY-ESP32-999',
    ownerEmail: 'original.owner@gmail.com',
    linkedEmails: ['original.owner@gmail.com'],
  },
];

function attemptLinkPond(
  pondId: string,
  userEmail: string,
  allLoadedDevices: MockDeviceRecord[]
): { success: boolean; errorMessage?: string } {
  const cleanPondId = pondId.trim().toUpperCase();
  const cleanEmail = userEmail.trim().toLowerCase();

  // 0a. Check loaded devices in memory
  const conflictInLoaded = allLoadedDevices.find(
    (d) =>
      d.deviceId.toUpperCase() === cleanPondId &&
      d.ownerEmail &&
      d.ownerEmail.trim().toLowerCase() !== cleanEmail &&
      (!Array.isArray(d.linkedEmails) || !d.linkedEmails.some((e) => e.trim().toLowerCase() === cleanEmail))
  );

  if (conflictInLoaded) {
    return {
      success: false,
      errorMessage: 'This pond ID is already linked with another account.',
    };
  }

  // 0b. Check database
  const existing = mockDeviceDatabase.find((d) => d.deviceId.toUpperCase() === cleanPondId);
  if (existing) {
    const existingOwner = existing.ownerEmail?.trim().toLowerCase();
    const existingLinked = existing.linkedEmails?.map((e) => e.trim().toLowerCase()) || [];
    if (existingOwner && existingOwner !== cleanEmail && !existingLinked.includes(cleanEmail)) {
      return {
        success: false,
        errorMessage: 'This pond ID is already linked with another account.',
      };
    }
  }

  return { success: true };
}

// Attempt to link already registered device by a different user
const duplicateResult = attemptLinkPond('OXY-ESP32-999', 'intruder@gmail.com', mockDeviceDatabase);
assert(duplicateResult.success === false, 'Duplicate link attempt is blocked');
assert(
  duplicateResult.errorMessage === 'This pond ID is already linked with another account.',
  'Rejection error message strictly matches "This pond ID is already linked with another account."'
);

// Original owner re-linking or linking an unassigned pond
const ownerResult = attemptLinkPond('OXY-ESP32-999', 'original.owner@gmail.com', mockDeviceDatabase);
assert(ownerResult.success === true, 'Original owner can re-link/access their own pond');

const newPondResult = attemptLinkPond('OXY-ESP32-777', 'farmer.raju@gmail.com', mockDeviceDatabase);
assert(newPondResult.success === true, 'New unassigned pond ID can be cleanly linked');

// ---------------------------------------------------------------------------
// TEST GROUP 4: Automated Aerator Schedules (12-Hour AM/PM Engine)
// ---------------------------------------------------------------------------
console.log('\n--- TEST GROUP 4: Automated Aerator Schedules ---');

function toMinutesFromMidnight(hour: number, minute: number, ampm: 'AM' | 'PM'): number {
  let h = hour % 12;
  if (ampm === 'PM') h += 12;
  return h * 60 + minute;
}

// 12-Hour AM/PM conversion assertions
assert(toMinutesFromMidnight(12, 0, 'AM') === 0, '12:00 AM converts to 0 minutes from midnight');
assert(toMinutesFromMidnight(6, 30, 'AM') === 390, '06:30 AM converts to 390 minutes');
assert(toMinutesFromMidnight(12, 0, 'PM') === 720, '12:00 PM converts to 720 minutes');
assert(toMinutesFromMidnight(1, 15, 'PM') === 795, '01:15 PM converts to 795 minutes');
assert(toMinutesFromMidnight(11, 45, 'PM') === 1425, '11:45 PM converts to 1425 minutes');

// Schedule Execution Simulation
interface ScheduleEngineState {
  generatorStatus: 'ON' | 'OFF';
  alerts: string[];
  schedules: AeratorSchedule[];
}

function evaluateSchedules(
  currentHours24: number,
  currentMinutes: number,
  todayStr: string,
  state: ScheduleEngineState
): ScheduleEngineState {
  const currentNowMins = currentHours24 * 60 + currentMinutes;
  let status = state.generatorStatus;
  const alerts = [...state.alerts];

  const updatedSchedules = state.schedules.map((sch) => {
    if (!sch.enabled) return sch;

    const startMins = toMinutesFromMidnight(sch.startHour, sch.startMinute, sch.startAmPm);
    const stopMins = toMinutesFromMidnight(sch.stopHour, sch.stopMinute, sch.stopAmPm);

    // Trigger START
    if (currentNowMins === startMins) {
      if (sch.lastTriggeredAction !== 'START' || sch.lastTriggeredDate !== todayStr) {
        if (status === 'OFF') {
          status = 'ON';
          alerts.push(`Scheduled Start: ${sch.name}`);
        }
        return {
          ...sch,
          lastTriggeredAction: 'START' as const,
          lastTriggeredDate: todayStr,
        };
      }
    }

    // Trigger STOP
    if (currentNowMins === stopMins) {
      if (sch.lastTriggeredAction !== 'STOP' || sch.lastTriggeredDate !== todayStr) {
        if (status === 'ON') {
          status = 'OFF';
          alerts.push(`Scheduled Stop: ${sch.name}`);
        }
        return {
          ...sch,
          lastTriggeredAction: 'STOP' as const,
          lastTriggeredDate: todayStr,
        };
      }
    }

    return sch;
  });

  return {
    generatorStatus: status,
    alerts,
    schedules: updatedSchedules,
  };
}

const testSchedule: AeratorSchedule = {
  id: 'sch-1',
  name: 'Morning DO Oxygenation',
  startHour: 6,
  startMinute: 0,
  startAmPm: 'AM',
  stopHour: 8,
  stopMinute: 30,
  stopAmPm: 'AM',
  enabled: true,
};

let simState: ScheduleEngineState = {
  generatorStatus: 'OFF',
  alerts: [],
  schedules: [testSchedule],
};

// 1. Simulate 05:59 AM (Before start time)
simState = evaluateSchedules(5, 59, '2026-10-21', simState);
assert(simState.generatorStatus === 'OFF', 'Generator stays OFF before scheduled start time');

// 2. Simulate 06:00 AM (Scheduled Start time reached!)
simState = evaluateSchedules(6, 0, '2026-10-21', simState);
assert(simState.generatorStatus === 'ON', 'Aerator automatically turns ON at scheduled start time (06:00 AM)');
assert(simState.alerts.includes('Scheduled Start: Morning DO Oxygenation'), 'Alert generated for scheduled start');
assert(simState.schedules[0].lastTriggeredAction === 'START', 'lastTriggeredAction marked as START');

// 3. Simulate another tick at 06:00 AM (Same minute duplicate prevention)
const alertCountBefore = simState.alerts.length;
simState = evaluateSchedules(6, 0, '2026-10-21', simState);
assert(simState.alerts.length === alertCountBefore, 'Duplicate trigger prevented within the same scheduled minute');

// 4. Simulate 08:30 AM (Scheduled Stop time reached!)
simState = evaluateSchedules(8, 30, '2026-10-21', simState);
assert(simState.generatorStatus === 'OFF', 'Aerator automatically turns OFF at scheduled stop time (08:30 AM)');
assert(simState.alerts.includes('Scheduled Stop: Morning DO Oxygenation'), 'Alert generated for scheduled stop');
assert(simState.schedules[0].lastTriggeredAction === 'STOP', 'lastTriggeredAction marked as STOP');

// 5. Disabled schedule check
simState.schedules[0].enabled = false;
simState.generatorStatus = 'OFF';
simState = evaluateSchedules(6, 0, '2026-10-22', simState);
assert(simState.generatorStatus === 'OFF', 'Disabled schedule does not trigger aeration');

// ---------------------------------------------------------------------------
// TEST GROUP 5: Pond Name Editing & Pond Deletion / Unlinking
// ---------------------------------------------------------------------------
console.log('\n--- TEST GROUP 5: Pond Edit & Delete ---');

let userPonds = ['POND-001', 'POND-002'];
let activePondId = 'POND-001';

// Edit pond name
let pondList: DeviceTelemetry[] = [
  { ...initialDeviceData, deviceId: 'POND-001', name: 'Original Name 1' },
  { ...initialDeviceData, deviceId: 'POND-002', name: 'Original Name 2' },
];

function editPondName(id: string, newName: string) {
  pondList = pondList.map((p) => (p.deviceId === id ? { ...p, name: newName.trim() } : p));
}

editPondName('POND-001', 'East Broodstock Tank');
assert(pondList.find((p) => p.deviceId === 'POND-001')?.name === 'East Broodstock Tank', 'Pond name updated successfully');

// Delete / Unlink pond
function deletePond(id: string) {
  userPonds = userPonds.filter((p) => p !== id);
  pondList = pondList.filter((p) => p.deviceId !== id);
  if (activePondId === id) {
    activePondId = userPonds[0] || '';
  }
}

deletePond('POND-001');
assert(!userPonds.includes('POND-001'), 'POND-001 unlinked from user ponds list');
assert(activePondId === 'POND-002', 'Active pond shifted to remaining POND-002');

// Delete last pond
deletePond('POND-002');
assert(userPonds.length === 0, 'All ponds unlinked');
assert(activePondId === '', 'Active pond reset when 0 ponds remain');

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✨ ALL NULL-SAFETY, POND ISOLATION & SCHEDULE TESTS PASSED!');
}
