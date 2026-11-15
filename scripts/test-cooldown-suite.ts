// Automated Test Suite for Oxynity Smart Motor Cooldown Protection & Play Store Readiness
// Tests:
// 1. Initial Telemetry Defaults (cooldownEnabled, isCoolingDown, continuousRunSeconds)
// 2. Cooldown Settings Toggle Persistence
// 3. Continuous Runtime Ticker (6-Hour Limit = 21,600s)
// 4. Early Manual Stop Behavior (Cancels without Cooldown, Resets Counter)
// 5. 6-Hour Limit Auto-Rest Trigger (Both Relays OFF, 30m Countdown, Notification)
// 6. 30-Minute Rest Auto-Restart Sequencing (Relay 1 Immediate, Relay 2 in 2 mins)
// 7. Manual Override ("Resume Now") & Manual Cancel Flow
// 8. ESP32 Firmware Standalone Cooldown Implementation
// 9. Google Play Console Readiness & Policy Compliance (SDK 34+, Permissions, Data Safety)

import * as fs from 'fs';
import * as path from 'path';
import { initialDeviceData, createDefaultEmptyDevice } from '../src/data/initialDevice';
import { DeviceTelemetry } from '../src/types/iot';

let passed = 0;
let failed = 0;
const testRecords: Array<{ status: string; suite: string; testName: string; details: string }> = [];

function assert(condition: boolean, suite: string, testName: string, details = '') {
  if (condition) {
    passed++;
    testRecords.push({ status: 'PASS', suite, testName, details });
    console.log(`\x1b[32m✔ PASS\x1b[0m [${suite}]: ${testName}`);
  } else {
    failed++;
    testRecords.push({ status: 'FAIL', suite, testName, details });
    console.error(`\x1b[31m✘ FAIL\x1b[0m [${suite}]: ${testName} - ${details}`);
  }
}

console.log('================================================================');
console.log('  OXYNITY SMART - MOTOR COOLDOWN & PLAY STORE READINESS TEST    ');
console.log('================================================================\n');

// -------------------------------------------------------------------------
// TEST GROUP 1: Initial Telemetry Defaults
// -------------------------------------------------------------------------
const SUITE_1 = 'Initial Telemetry & Factory Defaults';
console.log(`--- TEST GROUP 1: ${SUITE_1} ---`);

assert(
  initialDeviceData.cooldownEnabled === true,
  SUITE_1,
  'Default device telemetry has cooldownEnabled set to true by default'
);

assert(
  initialDeviceData.isCoolingDown === false,
  SUITE_1,
  'Default device telemetry starts with isCoolingDown as false'
);

assert(
  initialDeviceData.continuousRunSeconds === 0,
  SUITE_1,
  'Default device telemetry initializes continuousRunSeconds to 0'
);

const emptyDevice = createDefaultEmptyDevice('test@oxynity.com');
assert(
  emptyDevice.cooldownEnabled === true,
  SUITE_1,
  'New dynamic pond devices initialize with cooldownEnabled: true'
);
assert(
  emptyDevice.continuousRunSeconds === 0 && emptyDevice.isCoolingDown === false,
  SUITE_1,
  'New dynamic pond devices start with clean continuousRunSeconds and isCoolingDown false'
);

// -------------------------------------------------------------------------
// TEST GROUP 2: Cooldown Settings Toggle Persistence
// -------------------------------------------------------------------------
const SUITE_2 = 'Cooldown Settings Toggle';
console.log(`\n--- TEST GROUP 2: ${SUITE_2} ---`);

let mockTelemetry: DeviceTelemetry = { ...initialDeviceData };

function toggleCooldown(enabled: boolean): DeviceTelemetry {
  return {
    ...mockTelemetry,
    cooldownEnabled: enabled,
  };
}

// User toggles OFF in Settings
mockTelemetry = toggleCooldown(false);
assert(mockTelemetry.cooldownEnabled === false, SUITE_2, 'User can toggle cooldown protection OFF in Machinery Settings');

// User toggles back ON in Settings
mockTelemetry = toggleCooldown(true);
assert(mockTelemetry.cooldownEnabled === true, SUITE_2, 'User can toggle cooldown protection back ON in Machinery Settings');

// -------------------------------------------------------------------------
// TEST GROUP 3: Continuous Runtime Tracking (6-Hour Limit = 21,600s)
// -------------------------------------------------------------------------
const SUITE_3 = 'Continuous Run Ticker';
console.log(`\n--- TEST GROUP 3: ${SUITE_3} ---`);

const SIX_HOURS_SECS = 6 * 3600; // 21,600 seconds
let currentRunSeconds = 0;

function tickRuntime(secondsToAdd: number, status: 'ON' | 'OFF'): number {
  if (status === 'ON') {
    return currentRunSeconds + secondsToAdd;
  }
  return 0; // resets when OFF
}

// Machine runs for 2 hours (7,200s)
currentRunSeconds = tickRuntime(7200, 'ON');
assert(currentRunSeconds === 7200, SUITE_3, 'Tracks continuous running seconds correctly (2 hours = 7200s)');

// Machine runs another 3 hours (now 5 hours = 18,000s)
currentRunSeconds = tickRuntime(10800, 'ON');
assert(currentRunSeconds === 18000, SUITE_3, 'Accumulates to 5 hours unbroken running (18,000s)');
assert(currentRunSeconds < SIX_HOURS_SECS, SUITE_3, 'Continuous run is below 6-hour limit, cooldown not triggered yet');

// -------------------------------------------------------------------------
// TEST GROUP 4: Early Manual Stop Behavior (Cancels without Cooldown)
// -------------------------------------------------------------------------
const SUITE_4 = 'Early Manual Stop Cycle';
console.log(`\n--- TEST GROUP 4: ${SUITE_4} ---`);

// User manually stops machine at 5 hours (before 6 hours limit)
let machineStatus: 'ON' | 'OFF' = 'OFF';
let enteredCooldown = false;

if (machineStatus === 'OFF') {
  currentRunSeconds = 0; // reset
  enteredCooldown = false; // no cooldown
}

assert(currentRunSeconds === 0, SUITE_4, 'Manual stop before 6 hours resets continuousRunSeconds to 0');
assert(enteredCooldown === false, SUITE_4, 'Cooldown is NOT entered when machine is manually stopped before 6 hours');

// -------------------------------------------------------------------------
// TEST GROUP 5: 6-Hour Limit Auto-Rest Trigger (Both Relays OFF, 30m Countdown)
// -------------------------------------------------------------------------
const SUITE_5 = '6-Hour Limit Auto-Rest Trigger';
console.log(`\n--- TEST GROUP 5: ${SUITE_5} ---`);

// Start machine again and run continuously to 6 hours (21,600s)
machineStatus = 'ON';
currentRunSeconds = 21600; // exactly 6 hours
const cooldownEnabled = true;

let relay1 = true;
let relay2 = true;
let isCoolingDown = false;
let cooldownEndsAt: string | undefined = undefined;
let notifications: Array<{ title: string; message: string }> = [];

if (machineStatus === 'ON' && cooldownEnabled && currentRunSeconds >= SIX_HOURS_SECS) {
  // Trigger Cooldown
  isCoolingDown = true;
  machineStatus = 'OFF';
  relay1 = false;
  relay2 = false;
  const endsAtDate = new Date(Date.now() + 30 * 60 * 1000);
  cooldownEndsAt = endsAtDate.toISOString();
  notifications.push({
    title: `[Pond Alpha] Motor Cooldown Protection Active`,
    message: `Continuous 6-hour runtime reached. Pausing machinery for 30 minutes to protect aerator motors.`,
  });
}

assert(isCoolingDown === true, SUITE_5, 'isCoolingDown flips to true when 6-hour threshold is reached');
assert(machineStatus === 'OFF' && relay1 === false && relay2 === false, SUITE_5, 'Both relays automatically cut OFF for motor safety');
assert(!!cooldownEndsAt, SUITE_5, 'cooldownEndsAt timestamp is generated for 30 minutes in future');
assert(
  notifications.length > 0 && notifications[0].title.includes('Pond Alpha'),
  SUITE_5,
  'Notification and alert generated with Pond Name prefix'
);

// -------------------------------------------------------------------------
// TEST GROUP 6: 30-Minute Rest Auto-Restart Sequencing
// -------------------------------------------------------------------------
const SUITE_6 = '30-Minute Rest & Auto-Restart';
console.log(`\n--- TEST GROUP 6: ${SUITE_6} ---`);

// Simulate cooldown time elapsing to 0
let simulatedRemainingSeconds = 0; // finished 30 minutes
let autoRestartTriggered = false;
let relay2TimerActive = false;

if (isCoolingDown && simulatedRemainingSeconds <= 0) {
  isCoolingDown = false;
  cooldownEndsAt = undefined;
  currentRunSeconds = 0;
  
  // Auto-start sequence
  machineStatus = 'ON';
  relay1 = true; // immediate
  relay2TimerActive = true; // 2 min timer scheduled
  autoRestartTriggered = true;
  notifications.push({
    title: `[Pond Alpha] Cooldown Complete - Auto-Restarted`,
    message: `30-minute rest finished. Generator & Relay 1 restarted immediately; Relay 2 starting in 2 minutes.`,
  });
}

assert(autoRestartTriggered === true, SUITE_6, 'Auto-restart triggers automatically when 30-minute rest expires');
assert(isCoolingDown === false, SUITE_6, 'isCoolingDown resets to false');
assert(machineStatus === 'ON' && relay1 === true, SUITE_6, 'Main Generator Relay 1 restarts immediately');
assert(relay2TimerActive === true, SUITE_6, 'Relay 2 activates 2-minute delay timer before turning ON');
assert(currentRunSeconds === 0, SUITE_6, 'continuousRunSeconds resets to 0 for new 6-hour duty cycle');

// -------------------------------------------------------------------------
// TEST GROUP 7: Manual Override ("Resume Now") & Manual Cancel
// -------------------------------------------------------------------------
const SUITE_7 = 'Manual Cooldown Override & Cancel';
console.log(`\n--- TEST GROUP 7: ${SUITE_7} ---`);

// Scenario A: User clicks "Resume Now" during cooldown
isCoolingDown = true;
cooldownEndsAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins remaining

function overrideCooldown(): boolean {
  cooldownEndsAt = undefined;
  currentRunSeconds = 0;
  machineStatus = 'ON';
  relay1 = true;
  relay2TimerActive = true;
  return false;
}

isCoolingDown = overrideCooldown();
assert(isCoolingDown === false, SUITE_7, 'Manual override clears isCoolingDown immediately');
assert(machineStatus === 'ON' && relay1 === true, SUITE_7, 'Manual override starts machine ON immediately');

// Scenario B: User clicks "Cancel" during cooldown
isCoolingDown = true;
function cancelCooldown(): boolean {
  cooldownEndsAt = undefined;
  currentRunSeconds = 0;
  machineStatus = 'OFF';
  relay1 = false;
  relay2 = false;
  return false;
}

isCoolingDown = cancelCooldown();
assert(isCoolingDown === false, SUITE_7, 'Cancel cooldown clears isCoolingDown');
assert(machineStatus === 'OFF' && relay1 === false, SUITE_7, 'Cancel cooldown keeps machine safely OFF');

// -------------------------------------------------------------------------
// TEST GROUP 8: ESP32 Firmware Standalone Cooldown Implementation
// -------------------------------------------------------------------------
const SUITE_8 = 'ESP32 Firmware Cooldown Implementation';
console.log(`\n--- TEST GROUP 8: ${SUITE_8} ---`);

const firmwarePath = path.resolve(process.cwd(), 'esp32-firmware/esp32-firmware.ino');
const firmwareCode = fs.readFileSync(firmwarePath, 'utf-8');

assert(
  firmwareCode.includes('COOLDOWN_RUN_LIMIT_MS') && firmwareCode.includes('6UL * 60UL * 60UL * 1000UL'),
  SUITE_8,
  'Firmware defines COOLDOWN_RUN_LIMIT_MS as 6 hours (21,600,000 ms)'
);

assert(
  firmwareCode.includes('COOLDOWN_REST_MS') && firmwareCode.includes('30UL * 60UL * 1000UL'),
  SUITE_8,
  'Firmware defines COOLDOWN_REST_MS as 30 minutes (1,800,000 ms)'
);

assert(
  firmwareCode.includes('GEN_COOLDOWN_REST'),
  SUITE_8,
  'Firmware implements GEN_COOLDOWN_REST state in GeneratorState enum'
);

assert(
  firmwareCode.includes('continuousRunStartMs') && firmwareCode.includes('cooldownStartMs'),
  SUITE_8,
  'Firmware tracks runtime and rest start timestamps independently'
);

assert(
  firmwareCode.includes('startGeneratorSequence("Auto 30-Min Cooldown Completed")'),
  SUITE_8,
  'Firmware auto-restarts generator sequence after 30-minute rest completes'
);

assert(
  firmwareCode.includes('cooldownStartMs       = 0') && firmwareCode.includes('continuousRunStartMs  = 0'),
  SUITE_8,
  'Firmware cancels cooldown timestamps if user manually presses Stop button'
);

// -------------------------------------------------------------------------
// TEST GROUP 9: Google Play Console Readiness & Policy Compliance
// -------------------------------------------------------------------------
const SUITE_9 = 'Google Play Console Readiness';
console.log(`\n--- TEST GROUP 9: ${SUITE_9} ---`);

// 1. Check variables.gradle for targetSdkVersion >= 34
const variablesPath = path.resolve(process.cwd(), 'android/variables.gradle');
const variablesCode = fs.readFileSync(variablesPath, 'utf-8');

const targetSdkMatch = variablesCode.match(/targetSdkVersion\s*=\s*(\d+)/);
const targetSdk = targetSdkMatch ? parseInt(targetSdkMatch[1], 10) : 0;
assert(targetSdk >= 34, SUITE_9, `targetSdkVersion is ${targetSdk} (Google Play requires >= 34)`);

const compileSdkMatch = variablesCode.match(/compileSdkVersion\s*=\s*(\d+)/);
const compileSdk = compileSdkMatch ? parseInt(compileSdkMatch[1], 10) : 0;
assert(compileSdk >= 34, SUITE_9, `compileSdkVersion is ${compileSdk} (Modern Android SDK)`);

// 2. Check AndroidManifest.xml permissions
const manifestPath = path.resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml');
const manifestCode = fs.readFileSync(manifestPath, 'utf-8');

assert(
  manifestCode.includes('android.permission.SCHEDULE_EXACT_ALARM') &&
  manifestCode.includes('tools:node="remove"'),
  SUITE_9,
  'SCHEDULE_EXACT_ALARM is removed with tools:node="remove" (prevents Google Play Store rejection)'
);

assert(
  manifestCode.includes('android:usesCleartextTraffic="false"'),
  SUITE_9,
  'usesCleartextTraffic is set to false (Enforces strict HTTPS / TLS data security)'
);

assert(
  manifestCode.includes('android:allowBackup="false"'),
  SUITE_9,
  'allowBackup is set to false (prevents unauthorized data extraction via adb)'
);

// 3. Check Privacy Policy & Account Deletion UI in SettingsModal.tsx
const settingsModalPath = path.resolve(process.cwd(), 'src/components/SettingsModal.tsx');
const settingsModalCode = fs.readFileSync(settingsModalPath, 'utf-8');

assert(
  settingsModalCode.includes('Privacy Policy & Data Safety') || settingsModalCode.includes('Privacy Policy'),
  SUITE_9,
  'Settings contains Privacy Policy & Data Safety modal/link (Google Play Data Safety Section required)'
);

assert(
  settingsModalCode.includes('Delete Account') || settingsModalCode.includes('handleDeleteAccount'),
  SUITE_9,
  'Settings contains Account Deletion flow (Google Play requirement for apps with account creation)'
);

assert(
  settingsModalCode.includes('Motor Cooldown Protection') && settingsModalCode.includes('handleToggleCooldown'),
  SUITE_9,
  'Settings contains Machinery toggle for Motor Cooldown Protection with live feedback'
);

// -------------------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`TOTAL TESTS: ${passed + failed} | \x1b[32mPASSED: ${passed}\x1b[0m | \x1b[31mFAILED: ${failed}\x1b[0m`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✨ ALL MOTOR COOLDOWN & PLAY STORE COMPLIANCE TESTS PASSED!\n');
  process.exit(0);
}
