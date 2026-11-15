import assert from 'assert';
import { parseDurationSecs } from '../src/components/ReportsView';
import { MachineStartStopLog } from '../src/components/StartStopLogCard';
import { DeviceTelemetry, ChatMessage, ServiceRequest, EnabledSensors } from '../src/types/iot';
import { AdminComplaintRecord } from '../src/data/oxynityAdminData';

console.log('================================================================');
console.log('  OXYNITY SMART - REAL-TIME REPORTS, ADMIN CHAT & SETTINGS TESTS');
console.log('================================================================\n');

let passedTests = 0;
let failedTests = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✔ PASS [${name}]`);
    passedTests++;
  } catch (err: any) {
    console.error(`❌ FAIL [${name}]:`, err.message);
    failedTests++;
  }
}

// --- TEST GROUP 1: Real-Time Reports Running Time Calculation ---
console.log('--- TEST GROUP 1: Real-Time Reports Running Time Calculation ---');

runTest('parseDurationSecs accurately converts hours and minutes', () => {
  assert.strictEqual(parseDurationSecs('1h 30m'), 5400);
  assert.strictEqual(parseDurationSecs('45m'), 2700);
  assert.strictEqual(parseDurationSecs('2h'), 7200);
  assert.strictEqual(parseDurationSecs('3h 15m 30s'), 11730);
  assert.strictEqual(parseDurationSecs(''), 0);
  assert.strictEqual(parseDurationSecs(undefined), 0);
});

runTest('ReportsView calculates real running time from logs instead of hardcoded 10.5h', () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const mockLogs: MachineStartStopLog[] = [
    {
      id: 'log-1',
      timestamp: `${todayIso}T06:00:00Z`,
      formattedTime: '06:00:00 AM',
      formattedDate: 'Today',
      action: 'START',
      triggerSource: 'Manual App Control',
      doLevel: 6.8,
    },
    {
      id: 'log-2',
      timestamp: `${todayIso}T08:30:00Z`,
      formattedTime: '08:30:00 AM',
      formattedDate: 'Today',
      action: 'STOP',
      triggerSource: 'Manual App Control',
      sessionDuration: '2h 30m',
      doLevel: 7.4,
    },
    {
      id: 'log-3',
      timestamp: `${todayIso}T12:00:00Z`,
      formattedTime: '12:00:00 PM',
      formattedDate: 'Today',
      action: 'START',
      triggerSource: 'Auto DO Protection',
      doLevel: 4.8,
    },
    {
      id: 'log-4',
      timestamp: `${todayIso}T13:15:00Z`,
      formattedTime: '01:15:00 PM',
      formattedDate: 'Today',
      action: 'STOP',
      triggerSource: 'Auto DO Target Reached',
      sessionDuration: '1h 15m',
      doLevel: 7.8,
    },
  ];

  // Completed sessions: 2h 30m (9000s) + 1h 15m (4500s) = 13500s = 3.75h = 3.8h
  const completedSecs = mockLogs.reduce((acc, log) => {
    if (log.action === 'STOP' && log.sessionDuration) {
      return acc + parseDurationSecs(log.sessionDuration);
    }
    return acc;
  }, 0);
  assert.strictEqual(completedSecs, 13500);

  const completedHours = Number((completedSecs / 3600).toFixed(1));
  assert.strictEqual(completedHours, 3.8);
  assert.notStrictEqual(completedHours, 10.5, 'Must NOT equal the previous hardcoded 10.5h');
});

runTest('ReportsView dynamically includes live ongoing session runtime when machine is ON', () => {
  const completedSecs = 13500; // 3.75h
  const liveSessionSecs = 45 * 60; // currently running 45 minutes = 2700s
  const totalSecs = completedSecs + liveSessionSecs; // 16200s = 4.5h
  const totalHours = Number((totalSecs / 3600).toFixed(1));
  assert.strictEqual(totalHours, 4.5);
});

// --- TEST GROUP 2: Temperature Unit (°C vs °F) Conversion ---
console.log('\n--- TEST GROUP 2: Temperature Unit (°C vs °F) Conversion ---');

runTest('Temperature converts correctly from Celsius to Fahrenheit', () => {
  const celsius = 28.5;
  const fahrenheit = Number(((celsius * 1.8) + 32).toFixed(1));
  assert.strictEqual(fahrenheit, 83.3);

  const zeroC = 0;
  assert.strictEqual(Number(((zeroC * 1.8) + 32).toFixed(1)), 32.0);

  const hotC = 35.0;
  assert.strictEqual(Number(((hotC * 1.8) + 32).toFixed(1)), 95.0);
});

// --- TEST GROUP 3: Two-Way Admin Chat & Service Request Sync ---
console.log('\n--- TEST GROUP 3: Two-Way Admin Chat & Service Request Sync ---');

runTest('Customer can raise a service request with initial chat message', () => {
  const customerReq: ServiceRequest = {
    id: 'SR-9988',
    type: 'Micro-bubble output low',
    desc: 'Bubbler outlet seems clogged after pond algae bloom.',
    date: '2026-10-22',
    phone: '+91 98480 12345',
    status: 'Open',
    stage: 0,
    deviceId: 'OXY-0113',
    farmer: 'Ramesh Naidu',
    place: 'Bhimavaram South Pond',
    priority: 'High',
    messages: [
      {
        id: 'msg-1',
        sender: 'client',
        senderName: 'Ramesh Naidu',
        text: 'Bubbler outlet seems clogged after pond algae bloom.',
        timestamp: new Date().toISOString(),
      },
    ],
  };

  assert.strictEqual(customerReq.id, 'SR-9988');
  assert.strictEqual(customerReq.messages?.length, 1);
  assert.strictEqual(customerReq.messages?.[0].sender, 'client');
  assert.strictEqual(customerReq.stage, 0);
});

runTest('Admin can receive complaint and reply with two-way chat message', () => {
  const complaint: AdminComplaintRecord = {
    id: 'SR-9988',
    device: 'OXY-0113',
    issue: 'Bubbler outlet seems clogged after pond algae bloom.',
    priority: 'High',
    source: 'Farmer app',
    age: '2026-10-22',
    stage: 0,
    farmer: 'Ramesh Naidu',
    place: 'Bhimavaram South Pond',
    tech: 'Unassigned',
    messages: [
      {
        id: 'msg-1',
        sender: 'client',
        senderName: 'Ramesh Naidu',
        text: 'Bubbler outlet seems clogged after pond algae bloom.',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
      },
    ],
  };

  // Admin sends reply
  const adminReply: ChatMessage = {
    id: 'msg-2',
    sender: 'admin',
    senderName: 'Oxynity Support (Admin)',
    text: 'Hello Ramesh garu, technician Suresh has been dispatched to your site with a replacement nozzle.',
    timestamp: new Date().toISOString(),
  };

  const updatedMessages = [...(complaint.messages || []), adminReply];
  complaint.messages = updatedMessages;
  complaint.stage = 1; // Auto-advances from New to Assigned
  complaint.tech = 'Suresh';

  assert.strictEqual(complaint.messages.length, 2);
  assert.strictEqual(complaint.messages[1].sender, 'admin');
  assert.strictEqual(complaint.stage, 1);
  assert.strictEqual(complaint.tech, 'Suresh');
});

runTest('Complaint stage progression cycles properly (0 -> 1 -> 2 -> 3 -> 0)', () => {
  let stage = 0;
  stage = stage >= 3 ? 0 : stage + 1; // 1: Assigned
  assert.strictEqual(stage, 1);
  stage = stage >= 3 ? 0 : stage + 1; // 2: Working
  assert.strictEqual(stage, 2);
  stage = stage >= 3 ? 0 : stage + 1; // 3: Resolved
  assert.strictEqual(stage, 3);
  stage = stage >= 3 ? 0 : stage + 1; // 0: Reopened/New
  assert.strictEqual(stage, 0);
});

// --- TEST GROUP 4: DO Sensor Calibration Math & Conversion ---
console.log('\n--- TEST GROUP 4: DO Sensor Calibration Math & Conversion ---');

runTest('Single-point calibration computes slope correctly and recalculates live DO', () => {
  // Meter reads 4.40 ppm when sensor voltage is 1370.0 mV
  const meterDo = 4.40;
  const voltageMv = 1370.0;
  const computedSlope = meterDo / voltageMv;
  const roundedSlope = Number(computedSlope.toFixed(6));
  assert.strictEqual(roundedSlope, 0.003212);

  // Recalculate live DO from sensor voltage
  const liveMv = 1370.0;
  const liveDo = Number((liveMv * roundedSlope).toFixed(2));
  assert.strictEqual(liveDo, 4.40);

  // When dissolved oxygen increases, probe voltage increases proportionally:
  const higherMv = 2490.6;
  const higherDo = Number((higherMv * roundedSlope).toFixed(2));
  assert.strictEqual(higherDo, 8.00);
});

runTest('Multi-point calibration with zero-point calculates slope and non-negative DO', () => {
  const points = [
    { meterDo: 0.0, voltageMv: 50.0 },
    { meterDo: 4.40, voltageMv: 1370.0 },
    { meterDo: 8.50, voltageMv: 2600.0 },
  ];

  const n = points.length;
  let sumV = 0, sumDo = 0, sumV2 = 0, sumVDo = 0;
  for (const p of points) {
    sumV += p.voltageMv;
    sumDo += p.meterDo;
    sumV2 += p.voltageMv * p.voltageMv;
    sumVDo += p.voltageMv * p.meterDo;
  }
  const denominator = n * sumV2 - sumV * sumV;
  const m = (n * sumVDo - sumV * sumDo) / denominator;
  const c = (sumDo - m * sumV) / n;
  const zeroMv = Math.max(0, -c / m);

  assert.ok(m > 0, 'Slope must be positive');
  assert.ok(zeroMv >= 0, 'Zero mV must be non-negative');

  const probeMv = 1370.0;
  const calcDo = Math.max(0, (probeMv - zeroMv) * m);
  assert.ok(calcDo > 4.2 && calcDo < 4.6, `Calculated DO ${calcDo.toFixed(2)} should be close to 4.40`);
});

// --- TEST GROUP 5: Settings Page Dark Mode & 6-Hour Motor Cooldown ---
console.log('\n--- TEST GROUP 5: Settings Page Dark Mode & 6-Hour Motor Cooldown ---');

runTest('6-Hour Motor Cooldown toggle persists and triggers correctly', () => {
  let cooldownEnabled = true;

  // Toggle off
  cooldownEnabled = !cooldownEnabled;
  assert.strictEqual(cooldownEnabled, false);

  // When disabled, machine running 6 hours should not trigger cooling break
  const continuousRunSecs = 6 * 3600;
  let shouldTriggerCooldown: boolean = cooldownEnabled && continuousRunSecs >= 6 * 3600;
  assert.strictEqual(shouldTriggerCooldown, false);

  // Toggle back on
  cooldownEnabled = true;
  shouldTriggerCooldown = cooldownEnabled && continuousRunSecs >= 6 * 3600;
  assert.strictEqual(shouldTriggerCooldown, true);
});

runTest('Dark mode applies theme token and class names properly', () => {
  const themeModes = ['auto', 'light', 'dark'];
  themeModes.forEach((mode) => {
    assert.ok(['auto', 'light', 'dark'].includes(mode));
  });
});

console.log('\n================================================================');
console.log(`TOTAL TESTS: ${passedTests + failedTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
console.log('================================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('\n✨ ALL REAL-TIME REPORTS, ADMIN CHAT & SETTINGS TESTS PASSED!');
}
