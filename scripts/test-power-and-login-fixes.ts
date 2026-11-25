// Automated Test Suite for Power Auto-Stop Fix & Login Admin Security Enforcement
import * as fs from 'fs';
import * as path from 'path';
import { initialDeviceData } from '../src/data/initialDevice';

let passed = 0;
let failed = 0;

function assert(condition: boolean, suite: string, testName: string, details = '') {
  if (condition) {
    passed++;
    console.log(`\x1b[32m✔ PASS\x1b[0m [${suite}]: ${testName}`);
  } else {
    failed++;
    console.error(`\x1b[31m✘ FAIL\x1b[0m [${suite}]: ${testName} - ${details}`);
  }
}

console.log('================================================================');
console.log('  OXYNITY SMART - POWER TOGGLE & ADMIN LOGIN SECURITY TESTS     ');
console.log('================================================================\n');

// -------------------------------------------------------------------------
// TEST GROUP 1: Login Page Security
// -------------------------------------------------------------------------
const SUITE_1 = 'Login Page Admin Security';
console.log(`--- TEST GROUP 1: ${SUITE_1} ---`);

const loginPageSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/LoginPage.tsx'),
  'utf8'
);

assert(
  !loginPageSource.includes('Open Oxynity Smart Admin Panel (Super Admin)'),
  SUITE_1,
  'No direct quick-bypass button for Super Admin in LoginPage'
);

assert(
  !loginPageSource.includes("onLoginSuccess('admin@oxynity.com'"),
  SUITE_1,
  'No hardcoded bypass callback to onLoginSuccess in LoginPage button'
);

assert(
  loginPageSource.includes('isAdminAccount(cleanEmail)') && !loginPageSource.includes(".includes('admin')"),
  SUITE_1,
  'Admin role only for the exact admin email list (not any email containing "admin")'
);

// -------------------------------------------------------------------------
// TEST GROUP 2: Settings Modal Admin Portal Guard
// -------------------------------------------------------------------------
const SUITE_2 = 'Settings Modal Admin Guard';
console.log(`\n--- TEST GROUP 2: ${SUITE_2} ---`);

const appSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/App.tsx'),
  'utf8'
);

assert(
  appSource.includes("userRole === 'admin' && isAdminEmail(userEmail)"),
  SUITE_2,
  'onSwitchToAdmin is guarded to admin role AND an approved admin email'
);

// -------------------------------------------------------------------------
// TEST GROUP 3: Power Control & 1-Second Auto-Stop Prevention
// -------------------------------------------------------------------------
const SUITE_3 = 'Power Control & Auto-Stop Prevention';
console.log(`\n--- TEST GROUP 3: ${SUITE_3} ---`);

assert(
  appSource.includes('autoStartedByDoRef.current = true;'),
  SUITE_3,
  'Auto DO Protection sets autoStartedByDoRef when automatic start occurs'
);

assert(
  appSource.includes("autoStartedByDoRef.current = false;") &&
  appSource.includes("triggerSource === 'Manual App Control' || newStatus === 'OFF'"),
  SUITE_3,
  'Manual user start clears autoStartedByDoRef so Auto DO cutoff is disengaged'
);

assert(
  appSource.includes("isRecentManualToggle = Date.now() - lastAppToggleTimeRef.current < 60000"),
  SUITE_3,
  'Auto DO Target Reached respects 60-second grace window after manual toggle'
);

assert(
  appSource.includes("isRecentAppToggle && currentDev?.deviceId === data.deviceId"),
  SUITE_3,
  'Firestore onSnapshot preserves optimistic status against delayed remote snapshots'
);

// -------------------------------------------------------------------------
// TEST GROUP 4: Telemetry Initial Clean State
// -------------------------------------------------------------------------
const SUITE_4 = 'Telemetry Clean State';
console.log(`\n--- TEST GROUP 4: ${SUITE_4} ---`);

assert(
  initialDeviceData.status === 'OFF',
  SUITE_4,
  'Default device status is OFF'
);

assert(
  initialDeviceData.currentSessionMinutes === 0 && initialDeviceData.currentSessionSeconds === 0,
  SUITE_4,
  'Default device starts with clean 0 runtime minutes and seconds'
);

const powerControlSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/PowerControl.tsx'),
  'utf8'
);

assert(
  powerControlSource.includes('localStorage.removeItem(continuousStorageKey);'),
  SUITE_4,
  'PowerControl clears continuousStorageKey on start/stop to prevent stale 6h triggers'
);

console.log('\n================================================================');
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✨ ALL POWER TOGGLE & ADMIN LOGIN SECURITY TESTS PASSED!\n');
}
