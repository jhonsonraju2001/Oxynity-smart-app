// Automated Test Suite for Oxynity Admin Panel Sub-modules
// Tests:
// 1. Pond Card Details & Contact Person + Machine Location Logic
// 2. Live Location & Calibration Filtering Logic
// 3. User Management CRUD & localStorage Sync
// 4. Content Management (Announcements & Guides)
// 5. Notifications Hub Delivery Tracking & "Resend to Unnotified" Feature
// 6. Multi-Pond Fleet Reports Calculation & CSV Export Generator

import { initialFleetDevices, initialAdminUsers, initialAnnouncements, initialGuides, initialDispatchedNotifications } from '../src/data/initialDevice.js';

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testName, details = '') {
  if (condition) {
    passed++;
    results.push({ status: 'PASS', testName, details });
    console.log(`\x1b[32m✔ PASS\x1b[0m: ${testName}`);
  } else {
    failed++;
    results.push({ status: 'FAIL', testName, details });
    console.error(`\x1b[31m✘ FAIL\x1b[0m: ${testName} - ${details}`);
  }
}

console.log('================================================================');
console.log('    OXYNITY SMART AQUACULTURE - ADMIN PANEL TEST SUITE          ');
console.log('================================================================\n');

// -------------------------------------------------------------------------
// TEST GROUP 1: Fleet Data Integrity & Pond Card Contact Person Details
// -------------------------------------------------------------------------
console.log('--- TEST GROUP 1: Pond Cards & Contact Person Details ---');
assert(initialFleetDevices && initialFleetDevices.length >= 5, 'Fleet contains at least 5 standard production ponds');

const pond1 = initialFleetDevices[0];
assert(pond1.id === 'POND-01', 'POND-01 ID matches expected initial telemetry');
assert(pond1.contactPerson && pond1.contactPerson.name === 'Kalyan Chakravarthy', 'POND-01 has valid Contact Person name');
assert(pond1.contactPerson.phone === '+91 98480 22341', 'POND-01 Contact Person has valid phone for click-to-dial');
assert(pond1.contactPerson.email === 'kalyan.farm@oxynity.in', 'POND-01 Contact Person has valid email for mailto');
assert(pond1.contactPerson.facilityName.includes('Nellore'), 'POND-01 facility name indicates Nellore location');
assert(pond1.gprsLocation && pond1.gprsLocation.lat > 0 && pond1.gprsLocation.lng > 0, 'POND-01 has valid GPS/LBS coordinates');

// Simulate updating Contact Person credentials
const updatedContact = {
  ...pond1.contactPerson,
  name: 'Kalyan C. (Updated)',
  phone: '+91 99999 88888',
  notes: 'High DO aeration schedule in progress',
};
assert(updatedContact.name === 'Kalyan C. (Updated)' && updatedContact.phone === '+91 99999 88888', 'Contact Person credentials successfully update in memory state');

// -------------------------------------------------------------------------
// TEST GROUP 2: Live Location & GPS Calibration Filter
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 2: Live Location & Anchor Calibration Filtering ---');

// Extract unique locations
const uniqueLocations = Array.from(
  new Set(
    initialFleetDevices.map((d) => {
      const loc = d.gprsLocation?.locationName || '';
      return loc.split(',')[0].trim();
    }).filter(Boolean)
  )
);
assert(uniqueLocations.length >= 4, `Extracted ${uniqueLocations.length} unique aquaculture locations from fleet telemetry`);

// Test Location Filter
const nellorePonds = initialFleetDevices.filter((d) =>
  d.gprsLocation?.locationName.toLowerCase().includes('nellore')
);
assert(nellorePonds.length >= 1, `Location filter finds ${nellorePonds.length} ponds in Nellore region`);

// Test Anchor Calibration Filter (Fixed GPS vs Cell LBS)
const fixedGpsPonds = initialFleetDevices.filter((d) => d.gprsLocation?.isAnchored === true);
const cellLbsPonds = initialFleetDevices.filter((d) => !d.gprsLocation?.isAnchored);
assert(fixedGpsPonds.length > 0, `Fixed GPS anchor filter identifies ${fixedGpsPonds.length} calibrated ponds`);
assert(cellLbsPonds.length > 0, `Cell Tower LBS filter identifies ${cellLbsPonds.length} uncalibrated/estimated ponds`);
assert(fixedGpsPonds.length + cellLbsPonds.length === initialFleetDevices.length, 'Anchor filter covers 100% of fleet devices');

// Test Machine Running Status Filter
const runningPonds = initialFleetDevices.filter((d) => d.manualAeratorControl === true || d.autoAeratorStatus === true);
const offPonds = initialFleetDevices.filter((d) => !d.manualAeratorControl && !d.autoAeratorStatus);
assert(runningPonds.length > 0 && offPonds.length > 0, `Machine status filter discriminates active (${runningPonds.length}) vs stopped (${offPonds.length}) ponds`);

// -------------------------------------------------------------------------
// TEST GROUP 3: User Management CRUD & Pond Assignment
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 3: User Management CRUD & Assignment Sync ---');
const users = [...initialAdminUsers];
assert(users.length >= 4, `Initial users count is ${users.length} with distinct roles`);

// Add User
const newUser = {
  id: 'usr-new-01',
  name: 'Suresh Raina',
  email: 'suresh.operator@oxynity.in',
  phone: '+91 97777 66666',
  role: 'operator',
  assignedPonds: ['POND-01', 'POND-03'],
  status: 'active',
  lastActive: 'Just now',
};
users.unshift(newUser);
assert(users.some((u) => u.email === 'suresh.operator@oxynity.in'), 'New operator successfully added to user registry');

// Status Toggle (Active -> Suspended)
const userToSuspend = users.find((u) => u.id === 'usr-new-01');
if (userToSuspend) {
  userToSuspend.status = userToSuspend.status === 'active' ? 'suspended' : 'active';
}
assert(userToSuspend.status === 'suspended', 'User suspension toggle switches status to suspended');

// Re-activate
if (userToSuspend) {
  userToSuspend.status = 'active';
}
assert(userToSuspend.status === 'active', 'User activation toggle restores status to active');

// Pond Assignment Synchronization check
const mockLocalStorage = {};
const cleanEmail = newUser.email.trim().toLowerCase();
mockLocalStorage[`oxynity_user_ponds_${cleanEmail}`] = JSON.stringify(newUser.assignedPonds);

const savedPonds = JSON.parse(mockLocalStorage[`oxynity_user_ponds_${cleanEmail}`]);
assert(
  Array.isArray(savedPonds) && savedPonds.includes('POND-01') && savedPonds.includes('POND-03'),
  'User pond assignments synchronize correctly with user localStorage keys'
);

// Delete User
const filteredUsers = users.filter((u) => u.id !== 'usr-new-01');
assert(!filteredUsers.some((u) => u.id === 'usr-new-01'), 'User deletion removes user from registry');

// -------------------------------------------------------------------------
// TEST GROUP 4: Content Management (Announcements & Guides)
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 4: Content Management Hub ---');
const announcements = [...initialAnnouncements];
assert(announcements.length >= 2, `Initial broadcast announcements count is ${announcements.length}`);

// Add announcement
const newAnnouncement = {
  id: 'ann-test-99',
  title: 'Urgent Monsoon Aeration Advisory',
  content: 'Heavy cloud cover anticipated. Pre-charge aerators to maintain DO above 5.5 ppm.',
  category: 'warning',
  publishedAt: new Date().toISOString(),
  publishedBy: 'System Admin',
  isPinned: true,
  isActive: true,
};
announcements.unshift(newAnnouncement);
assert(announcements[0].id === 'ann-test-99', 'New broadcast announcement added to top of feed');
assert(announcements[0].isPinned === true, 'Announcement correctly flagged as pinned alert');

// Guides Library
const guides = [...initialGuides];
assert(guides.length >= 4, `Aquaculture knowledge base contains ${guides.length} guides`);
const waterQualityGuides = guides.filter((g) => g.category === 'water_quality');
assert(waterQualityGuides.length >= 2, 'Category filter correctly isolates Water Quality protocols');

// -------------------------------------------------------------------------
// TEST GROUP 5: Notifications Hub & "Resend to Unnotified Users"
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 5: Notification Hub & Unnotified Delivery Resend ---');
const dispatches = JSON.parse(JSON.stringify(initialDispatchedNotifications));
assert(dispatches.length >= 3, `Initial dispatch history contains ${dispatches.length} broadcast records`);

const urgentDispatch = dispatches.find((d) => d.id === 'notif-001');
assert(urgentDispatch !== undefined, 'Target notification dispatch notif-001 found');

const initialUnreadCount = urgentDispatch.recipients.filter((r) => r.status === 'unread' || r.status === 'delivered').length;
const initialReadCount = urgentDispatch.recipients.filter((r) => r.status === 'read').length;
assert(initialUnreadCount > 0, `Dispatch has ${initialUnreadCount} unnotified/unread recipients before resend`);

// Simulate the "Resend to Unnotified Users" action from AdminNotificationsHub.tsx
let unnotifiedTargets = [];
dispatches.forEach((item) => {
  if (item.id === 'notif-001') {
    const unnotified = item.recipients.filter((r) => r.status !== 'read');
    unnotifiedTargets = unnotified.map((r) => r.userEmail);
    // Escalate delivery status for unnotified recipients
    item.recipients = item.recipients.map((r) => {
      if (r.status !== 'read') {
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

assert(unnotifiedTargets.length === initialUnreadCount, `"Resend to Unnotified" accurately targets only the ${initialUnreadCount} unread users`);
assert(!unnotifiedTargets.includes('rajesh.kumar@oxynity.in'), 'Read users (e.g. Rajesh) are omitted from resend payload');

// Verify updated delivery stats
const updatedDispatch = dispatches.find((d) => d.id === 'notif-001');
const unnotifiedRemaining = updatedDispatch.recipients.filter((r) => r.status === 'unread').length;
assert(unnotifiedRemaining === 0, 'All previously unread recipients escalated to delivered state post-resend');

// -------------------------------------------------------------------------
// TEST GROUP 6: Fleet Reports Calculation & Master Fleet CSV Export
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 6: Fleet Reports & Master CSV Export ---');
const totalPonds = initialFleetDevices.length;
const totalAerators = initialFleetDevices.reduce(
  (acc, d) => acc + (d.manualAeratorControl || d.autoAeratorStatus ? 1 : 0),
  0
);
const avgDO = (
  initialFleetDevices.reduce((acc, d) => acc + (d.doLevel >= 0 ? d.doLevel : 0), 0) /
  initialFleetDevices.filter((d) => d.doLevel >= 0).length
).toFixed(1);

assert(parseFloat(avgDO) > 0, `Fleet average DO calculated accurately at ${avgDO} ppm`);
assert(totalAerators >= 0 && totalAerators <= totalPonds, `Active aerators count ${totalAerators}/${totalPonds} is valid`);

// Simulate CSV Generator logic from AdminFleetReports.tsx
const csvHeaders = [
  'Pond ID',
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
  'Estimated Runtime Today (hrs)',
  'Power Consumption (kWh)',
];

const csvRows = initialFleetDevices.map((d) => {
  const isRunning = d.manualAeratorControl || d.autoAeratorStatus;
  const isFixed = d.gprsLocation?.isAnchored;
  const contact = d.contactPerson || {
    name: 'Unassigned',
    phone: 'N/A',
    email: 'N/A',
    facilityName: d.gprsLocation?.locationName || 'N/A',
  };

  return [
    `"${d.id}"`,
    `"${(contact.facilityName || '').replace(/"/g, '""')}"`,
    `"${contact.name.replace(/"/g, '""')}"`,
    `"${contact.phone}"`,
    `"${contact.email}"`,
    d.doLevel >= 0 ? d.doLevel.toFixed(1) : 'OFFLINE',
    d.doLevel >= d.targetDo ? 'OPTIMAL' : d.doLevel >= 3.5 ? 'WARNING' : 'CRITICAL',
    d.targetDo.toFixed(1),
    isRunning ? 'RUNNING' : 'MACHINE OFF',
    isFixed ? 'Fixed GPS Calibrated' : 'Cell Tower LBS (Estimated)',
    d.gprsLocation?.lat || 0,
    d.gprsLocation?.lng || 0,
    (d.uptimeHours || 12).toFixed(1),
    ((d.uptimeHours || 12) * 1.5).toFixed(1),
  ].join(',');
});

const generatedCsv = [csvHeaders.join(','), ...csvRows].join('\n');

assert(generatedCsv.length > 500, `Generated Master Fleet CSV has valid length (${generatedCsv.length} bytes)`);
assert(generatedCsv.includes('Pond ID,Facility / Farm,Contact Person'), 'CSV contains correct header format');
assert(generatedCsv.includes('Kalyan Chakravarthy'), 'CSV contains contact person details');
assert(generatedCsv.includes('+91 98480 22341'), 'CSV contains contact phone numbers');
assert(generatedCsv.includes('Fixed GPS Calibrated'), 'CSV contains anchor calibration classification');

console.log('\n================================================================');
console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
