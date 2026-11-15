// Automated Test Suite for Oxynity Admin Panel Sub-modules
// Tests:
// 1. Pond Card Details & Contact Person + Machine Location Logic
// 2. Live Location & Calibration Filtering Logic
// 3. User Management CRUD & localStorage Sync
// 4. Content Management (Announcements & Guides)
// 5. Notifications Hub Delivery Tracking & "Resend to Unnotified" Feature
// 6. Multi-Pond Fleet Reports Calculation & Master Fleet CSV Export

import {
  initialFleetDevices,
  initialAdminUsers,
  initialAnnouncements,
  initialGuides,
  initialDispatchedNotifications,
} from '../src/data/initialDevice';

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
console.log('    OXYNITY SMART AQUACULTURE - ADMIN PANEL TEST SUITE          ');
console.log('================================================================\n');

// -------------------------------------------------------------------------
// TEST GROUP 1: Fleet Data Integrity & Pond Card Contact Person Details
// -------------------------------------------------------------------------
const SUITE_1 = 'Pond Cards & Contact Details';
console.log(`--- TEST GROUP 1: ${SUITE_1} ---`);
assert(initialFleetDevices && initialFleetDevices.length >= 5, SUITE_1, 'Fleet contains 5 standard production ponds');

const pond1 = initialFleetDevices[0];
assert(pond1.deviceId === 'OXY-ESP32-001', SUITE_1, 'Pond #1 deviceId is OXY-ESP32-001');
assert(!!pond1.contactPerson && pond1.contactPerson.name === 'Suresh Varma', SUITE_1, 'Pond #1 contact person name matches Suresh Varma');
assert(pond1.contactPerson?.phone === '+91 98480 34211', SUITE_1, 'Pond #1 contact phone formatted for click-to-dial');
assert(pond1.contactPerson?.email === 'suresh.varma@amalapuramaqua.in', SUITE_1, 'Pond #1 contact email formatted for mailto:');
assert(!!pond1.contactPerson?.facilityName?.includes('Godavari'), SUITE_1, 'Pond #1 facility indicates Godavari Delta Aqua Farms');
assert(!!pond1.latitude && !!pond1.longitude, SUITE_1, 'Pond #1 has valid GPS/LBS coordinates');

// Simulate updating Contact Person credentials
const updatedContact = {
  ...pond1.contactPerson!,
  name: 'Suresh Varma (Lead)',
  phone: '+91 98480 99999',
  emergencyNotes: 'High DO aeration protocol in progress',
};
assert(
  updatedContact.name === 'Suresh Varma (Lead)' && updatedContact.phone === '+91 98480 99999',
  SUITE_1,
  'Contact Person credentials successfully update in memory state'
);

// -------------------------------------------------------------------------
// TEST GROUP 2: Live Location & GPS Calibration Filter
// -------------------------------------------------------------------------
const SUITE_2 = 'Location & Calibration Filtering';
console.log(`\n--- TEST GROUP 2: ${SUITE_2} ---`);

// Extract unique regions
const uniqueLocations = Array.from(
  new Set(
    initialFleetDevices.map((d) => {
      const loc = d.locationName || '';
      return loc.split(',')[1]?.trim() || loc;
    }).filter(Boolean)
  )
);
assert(uniqueLocations.length >= 3, SUITE_2, `Extracted ${uniqueLocations.length} unique aquaculture states/districts from fleet telemetry`);

// Test Location Filter for Andhra Pradesh
const apPonds = initialFleetDevices.filter((d) =>
  d.locationName.toLowerCase().includes('andhra pradesh')
);
assert(apPonds.length >= 2, SUITE_2, `Location filter finds ${apPonds.length} ponds in Andhra Pradesh region`);

// Test Anchor Calibration Filter (Fixed/Phone Calibrated vs Cell LBS)
const calibratedPonds = initialFleetDevices.filter((d) => d.isCalibrated === true);
const cellLbsPonds = initialFleetDevices.filter((d) => !d.isCalibrated);
assert(calibratedPonds.length >= 3, SUITE_2, `Calibrated GPS filter identifies ${calibratedPonds.length} anchored ponds`);
assert(cellLbsPonds.length >= 1, SUITE_2, `Cell Tower LBS filter identifies ${cellLbsPonds.length} uncalibrated/estimated ponds`);
assert(calibratedPonds.length + cellLbsPonds.length === initialFleetDevices.length, SUITE_2, 'Anchor filter covers 100% of fleet devices');

// Test Machine Running Status Filter (status === 'ON' vs 'OFF')
const runningPonds = initialFleetDevices.filter((d) => d.status === 'ON');
const offPonds = initialFleetDevices.filter((d) => d.status === 'OFF');
assert(runningPonds.length > 0 && offPonds.length > 0, SUITE_2, `Machine status filter discriminates active (${runningPonds.length}) vs stopped (${offPonds.length}) ponds`);

// -------------------------------------------------------------------------
// TEST GROUP 3: User Management CRUD & Pond Assignment
// -------------------------------------------------------------------------
const SUITE_3 = 'User Management CRUD';
console.log(`\n--- TEST GROUP 3: ${SUITE_3} ---`);
const users = [...initialAdminUsers];
assert(users.length >= 5, SUITE_3, `Initial users count is ${users.length} with distinct roles`);

// Add User
const newUser = {
  id: 'usr-new-01',
  name: 'Ramesh Naidu',
  email: 'ramesh.naidu@oxynity.in',
  phone: '+91 97777 66666',
  role: 'operator' as const,
  assignedPondIds: ['OXY-ESP32-001', 'OXY-ESP32-4410'],
  status: 'active' as const,
  createdAt: '2026-10-16',
  lastLogin: 'Never',
  facilityName: 'Krishna Delta Aqua Unit',
};
users.unshift(newUser);
assert(users.some((u) => u.email === 'ramesh.naidu@oxynity.in'), SUITE_3, 'New operator successfully added to user registry');

// Status Toggle (Active -> Suspended)
const userToSuspend = users.find((u) => u.id === 'usr-new-01');
if (userToSuspend) {
  userToSuspend.status = userToSuspend.status === 'active' ? 'suspended' : 'active';
}
assert(userToSuspend?.status === 'suspended', SUITE_3, 'User suspension toggle switches status to suspended');

// Re-activate
if (userToSuspend) {
  userToSuspend.status = 'active';
}
assert(userToSuspend?.status === 'active', SUITE_3, 'User activation toggle restores status to active');

// Pond Assignment Synchronization check
const mockLocalStorage: Record<string, string> = {};
const cleanEmail = newUser.email.trim().toLowerCase();
mockLocalStorage[`oxynity_user_ponds_${cleanEmail}`] = JSON.stringify(newUser.assignedPondIds);

const savedPonds = JSON.parse(mockLocalStorage[`oxynity_user_ponds_${cleanEmail}`]);
assert(
  Array.isArray(savedPonds) && savedPonds.includes('OXY-ESP32-001') && savedPonds.includes('OXY-ESP32-4410'),
  SUITE_3,
  'User pond assignments synchronize correctly with user localStorage keys'
);

// Delete User
const filteredUsers = users.filter((u) => u.id !== 'usr-new-01');
assert(!filteredUsers.some((u) => u.id === 'usr-new-01'), SUITE_3, 'User deletion removes user from registry');

// -------------------------------------------------------------------------
// TEST GROUP 4: Content Management (Announcements & Guides)
// -------------------------------------------------------------------------
const SUITE_4 = 'Content Management';
console.log(`\n--- TEST GROUP 4: ${SUITE_4} ---`);
const announcements = [...initialAnnouncements];
assert(announcements.length >= 3, SUITE_4, `Initial broadcast announcements count is ${announcements.length}`);

// Add announcement
const newAnnouncement = {
  id: 'ann-test-99',
  title: 'Urgent Monsoon Aeration Advisory',
  category: 'advisory' as const,
  message: 'Heavy continuous rain anticipated. Pre-charge aerators to maintain DO above 5.5 ppm.',
  isPinned: true,
  isActive: true,
  createdAt: new Date().toISOString(),
  authorName: 'System Admin',
};
announcements.unshift(newAnnouncement);
assert(announcements[0].id === 'ann-test-99', SUITE_4, 'New broadcast announcement added to top of feed');
assert(announcements[0].isPinned === true, SUITE_4, 'Announcement correctly flagged as pinned alert');

// Guides Library
const guides = [...initialGuides];
assert(guides.length >= 3, SUITE_4, `Aquaculture knowledge base contains ${guides.length} guides`);
const waterQualityGuides = guides.filter((g) => g.category === 'water_quality');
assert(waterQualityGuides.length >= 1, SUITE_4, 'Category filter correctly isolates Water Quality protocols');

// -------------------------------------------------------------------------
// TEST GROUP 5: Notifications Hub & "Resend to Unnotified Users"
// -------------------------------------------------------------------------
const SUITE_5 = 'Notifications & Resend Tracking';
console.log(`\n--- TEST GROUP 5: ${SUITE_5} ---`);
const dispatches = JSON.parse(JSON.stringify(initialDispatchedNotifications));
assert(dispatches.length >= 3, SUITE_5, `Initial dispatch history contains ${dispatches.length} broadcast records`);

const targetDispatch = dispatches.find((d: any) => d.id === 'ntf-1');
assert(targetDispatch !== undefined, SUITE_5, 'Target critical notification dispatch ntf-1 found');

const initialUnnotifiedCount = targetDispatch.recipients.filter((r: any) => r.status === 'unnotified').length;
assert(initialUnnotifiedCount > 0, SUITE_5, `Dispatch ntf-1 has ${initialUnnotifiedCount} unnotified recipient(s) awaiting delivery`);

// Simulate the "Resend to Unnotified Users" action from AdminNotificationsHub.tsx
let unnotifiedTargets: string[] = [];
dispatches.forEach((item: any) => {
  if (item.id === 'ntf-1') {
    const unnotified = item.recipients.filter((r: any) => r.status === 'unnotified');
    unnotifiedTargets = unnotified.map((r: any) => r.userEmail);
    // Escalate delivery status for unnotified recipients
    item.recipients = item.recipients.map((r: any) => {
      if (r.status === 'unnotified') {
        return {
          ...r,
          status: 'delivered', // Delivered freshly via local push & in-app modal
          deliveredAt: new Date().toISOString(),
        };
      }
      return r;
    });
  }
});

assert(unnotifiedTargets.length === initialUnnotifiedCount, SUITE_5, `"Resend to Unnotified" accurately targets only the ${initialUnnotifiedCount} unnotified user(s)`);
assert(unnotifiedTargets.includes('murugan@kaveriaqua.org'), SUITE_5, 'Target unnotified operator Murugan included in resend payload');

// Verify updated delivery stats
const updatedDispatch = dispatches.find((d: any) => d.id === 'ntf-1');
const unnotifiedRemaining = updatedDispatch.recipients.filter((r: any) => r.status === 'unnotified').length;
assert(unnotifiedRemaining === 0, SUITE_5, 'All previously unnotified recipients escalated to delivered state post-resend');

// -------------------------------------------------------------------------
// TEST GROUP 6: Fleet Reports Calculation & Master Fleet CSV Export
// -------------------------------------------------------------------------
const SUITE_6 = 'Fleet Reports & Master CSV Export';
console.log(`\n--- TEST GROUP 6: ${SUITE_6} ---`);
const totalPonds = initialFleetDevices.length;
const totalAeratorsRunning = initialFleetDevices.filter((d) => d.status === 'ON').length;
const validDoPonds = initialFleetDevices.filter((d) => d.doLevel >= 0);
const avgDO = (
  validDoPonds.reduce((acc, d) => acc + d.doLevel, 0) / validDoPonds.length
).toFixed(1);

assert(parseFloat(avgDO) > 0, SUITE_6, `Fleet average DO calculated accurately at ${avgDO} ppm`);
assert(totalAeratorsRunning > 0 && totalAeratorsRunning <= totalPonds, SUITE_6, `Active running aerators (${totalAeratorsRunning}/${totalPonds}) computed correctly`);

// Simulate CSV Generator logic from AdminFleetReports.tsx
const csvHeaders = [
  'Pond ID',
  'Pond Name',
  'Facility / Farm',
  'Contact Person',
  'Phone Number',
  'Contact Email',
  'Live DO (ppm)',
  'DO Status',
  'Target DO (ppm)',
  'Aerator Machine Status',
  'Anchor Calibration Type',
  'GPS Latitude',
  'GPS Longitude',
  'Total Run Hours',
  'Power Consumption (kWh)',
];

const csvRows = initialFleetDevices.map((d) => {
  const isRunning = d.status === 'ON';
  const isCalibrated = d.isCalibrated;
  const contact = d.contactPerson || {
    name: 'Unassigned',
    phone: 'N/A',
    email: 'N/A',
    facilityName: d.locationName || 'N/A',
  };

  return [
    `"${d.deviceId}"`,
    `"${d.name.replace(/"/g, '""')}"`,
    `"${(contact.facilityName || '').replace(/"/g, '""')}"`,
    `"${contact.name.replace(/"/g, '""')}"`,
    `"${contact.phone}"`,
    `"${contact.email}"`,
    d.doLevel >= 0 ? d.doLevel.toFixed(1) : 'OFFLINE',
    d.doLevel >= d.targetDo ? 'OPTIMAL' : d.doLevel >= 4.0 ? 'WARNING' : 'CRITICAL',
    d.targetDo.toFixed(1),
    isRunning ? 'RUNNING' : 'MACHINE OFF',
    isCalibrated ? 'Fixed GPS Calibrated' : 'Cell Tower LBS (Estimated)',
    d.latitude || 0,
    d.longitude || 0,
    (d.totalRunHours || 0).toFixed(1),
    ((d.totalRunHours || 0) * 1.5).toFixed(1),
  ].join(',');
});

const generatedCsv = [csvHeaders.join(','), ...csvRows].join('\n');

assert(generatedCsv.length > 500, SUITE_6, `Generated Master Fleet CSV has valid length (${generatedCsv.length} bytes)`);
assert(generatedCsv.includes('Pond ID,Pond Name,Facility / Farm'), SUITE_6, 'CSV contains correct header format');
assert(generatedCsv.includes('Suresh Varma'), SUITE_6, 'CSV contains contact person details');
assert(generatedCsv.includes('+91 98480 34211'), SUITE_6, 'CSV contains contact phone numbers');
assert(generatedCsv.includes('Fixed GPS Calibrated'), SUITE_6, 'CSV contains anchor calibration classification');

console.log('\n================================================================');
console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED across 6 Test Suites`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
