export type DeviceStatus = 'ON' | 'OFF' | 'MAINTENANCE' | 'ERROR';

export interface DeviceTelemetry {
  deviceId: string;
  name: string;
  status: DeviceStatus;
  status2?: DeviceStatus; // Relay 2 (Secondary Pump / Aerator) status
  doLevel: number; // Dissolved Oxygen in mg/L (ppm), -1 means sensor disconnected
  doSensorConnected?: boolean; // false when ESP32 reports sensor missing (doLevel = -1)
  doSensorEnabled?: boolean; // toggle in Settings to show/hide DO sensor on dashboard
  targetDo: number; // Target DO setting (e.g. 7.5 mg/L)
  phLevel: number; // pH level (e.g. 7.2)
  waterTemp?: number; // Water temperature in °C (e.g. 28.5)
  orpLevel?: number; // Oxidation-Reduction Potential in mV (e.g. 285)
  salinity?: number; // Salinity in ppt (e.g. 15.0)
  flowRate: number; // Water flow rate in L/min
  pressure: number; // Pressure in Bar
  totalRunHours: number; // Cumulative running hours
  currentSessionMinutes: number; // Minutes running in current session
  currentSessionSeconds?: number; // Total seconds running in current session
  sessionStartedAt?: string; // ISO timestamp when current running session started
  continuousStartedAt?: string; // ISO timestamp when unbroken 6h cycle started
  lastMaintenanceHours: number; // Total run hours at last service
  maintenanceIntervalHours: number; // Service needed every X hours (e.g. 500 hrs)
  latitude: number;
  longitude: number;
  locationName: string;
  gprsSignal: number; // CSQ 0-31 or %
  gprsConnected: boolean;
  gprsLocationFixed?: boolean; // true when SIM900A acquires real cell LBS / GPS fix
  locationSource?: string; // e.g. "SIM900A GPRS Cell LBS"
  calibratedLatitude?: number; // User's phone-calibrated pond latitude
  calibratedLongitude?: number; // User's phone-calibrated pond longitude
  calibratedLocationName?: string; // E.g. "Pond Live GPS Calibrated"
  calibratedAt?: string; // ISO timestamp of calibration
  calibratedCellLac?: string; // Serving cell tower LAC at time of calibration
  calibratedCellId?: string; // Serving cell tower CID at time of calibration
  isCalibrated?: boolean; // True when pond anchor is locked
  isMoving?: boolean; // True when SIM900A handover/displacement is detected
  moveDistanceKm?: number; // Distance moved from calibrated pond
  cellLac?: string; // Current serving cell tower LAC
  cellId?: string; // Current serving cell tower CID
  lastMovementAt?: string; // Timestamp of latest movement detection
  autoMode: boolean; // Auto turn ON when DO < minDoAlert
  minDoAlert: number; // Low DO alarm threshold (e.g. 5.0 mg/L)
  maxDoAlert: number; // High DO alarm threshold (e.g. 12.0 mg/L)
  updatedAt: string;
  lastSeen?: string;
  isOnline?: boolean;
  firmwareVersion: string;
  ownerEmail?: string; // Email of account that owns / linked this pond ID
  linkedEmails?: string[]; // Allowed emails who can access this pond
  voltageMv?: number; // Raw analog voltage from ESP32 in mV
  rawAdc?: number; // Raw ADC reading (0-4095)
  doSlopeK?: number; // Calibrated slope (mg/L per mV)
  doZeroMv?: number; // Calibrated zero offset (mV)
  isDoCalibrated?: boolean;
  doCalibrationPoints?: DoCalibrationPoint[];
  contactPerson?: PondContact;
  cooldownEnabled?: boolean; // Toggle in Settings: 6h run / 30m rest protection cycle
  isCoolingDown?: boolean; // True when machine is in the 30-minute rest phase
  cooldownEndsAt?: string; // ISO timestamp when cooldown rest finishes
  cooldownRemainingSeconds?: number; // Live seconds remaining in rest phase
  continuousRunSeconds?: number; // Unbroken continuous run seconds towards 6h limit
  schedules?: AeratorSchedule[]; // Automated ON/OFF run schedules
}

export interface AeratorSchedule {
  id: string;
  name: string; // e.g. "Morning Aeration"
  startHour: number; // 1-12
  startMinute: number; // 0-59
  startAmPm: 'AM' | 'PM';
  stopHour: number; // 1-12
  stopMinute: number; // 0-59
  stopAmPm: 'AM' | 'PM';
  enabled: boolean;
  createdAt?: string;
  lastTriggeredAction?: 'START' | 'STOP';
  lastTriggeredDate?: string; // YYYY-MM-DD
}

export interface PondContact {
  name: string;
  phone: string;
  email: string;
  facilityName?: string;
  address?: string;
  emergencyNotes?: string;
}

export interface DoCalibrationPoint {
  id: string;
  pointNum: number;
  meterDo: number; // Reading on handheld digital DO meter (mg/L)
  voltageMv: number; // Sensor voltage from ESP32 at that reading (mV)
  rawAdc?: number;
  timestamp: string;
}

export interface TelemetryPoint {
  timestamp: string;
  timeLabel: string;
  doLevel: number;
  waterTemp?: number;
  status: DeviceStatus;
}

export interface DeviceAlert {
  id: string;
  timestamp: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  read: boolean;
}

export interface EnabledSensors {
  do: boolean;
  ph: boolean;
  orp: boolean;
  temp: boolean;
  sal: boolean;
}

export interface Esp32Config {
  wifiSsid: string;
  wifiPass: string;
  gprsApn: string;
  deviceId: string;
  firebaseApiKey: string;
  firebaseProjectId: string;
  firebaseDbUrl: string;
  doPin: number;
  relayPin: number;
  tempPin: number;
  txPinGprs: number;
  rxPinGprs: number;
  sampleIntervalMs: number;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'operator' | 'admin' | 'supervisor';
  status: 'active' | 'suspended';
  assignedPondIds: string[];
  createdAt: string;
  lastLogin?: string;
  facilityName?: string;
}

export interface AdminAnnouncement {
  id: string;
  title: string;
  category: 'emergency' | 'maintenance' | 'weather' | 'advisory';
  targetPondId?: string; // empty means all ponds
  message: string;
  isPinned: boolean;
  isActive: boolean;
  createdAt: string;
  authorName: string;
}

export interface AdminGuide {
  id: string;
  title: string;
  category: 'water_quality' | 'aeration' | 'maintenance' | 'hardware';
  readTime: string;
  summary: string;
  content: string;
  updatedAt: string;
}

export interface AdminNotificationRecipient {
  userId: string;
  userEmail: string;
  userName: string;
  pondId?: string;
  status: 'read' | 'delivered' | 'unnotified';
  deliveredAt: string;
  readAt?: string;
}

export interface AdminNotificationDispatch {
  id: string;
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  targetAudience: 'all' | 'specific_user' | 'specific_pond';
  targetPondId?: string;
  targetUserEmail?: string;
  createdAt: string;
  recipients: AdminNotificationRecipient[];
  resendCount?: number;
  lastResentAt?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'client' | 'admin';
  senderName: string;
  text: string;
  timestamp: string;
}

export interface ServiceRequest {
  id: string;
  type: string;
  desc: string;
  date: string;
  phone: string;
  status: 'Open' | 'In progress' | 'Resolved';
  stage?: number; // 0: New, 1: Assigned, 2: Working, 3: Done
  deviceId?: string;
  pondName?: string;
  farmer?: string;
  place?: string;
  priority?: 'High' | 'Medium' | 'Low';
  tech?: string;
  source?: string;
  createdAt?: string;
  messages?: ChatMessage[];
}
