import { MachineSpecsEditor } from './admin/MachineSpecsEditor';
import { motorKwOf } from '../lib/oxynity';
import { AlarmCenter } from './AlarmCenter';
import { DataDownload } from './admin/DataDownload';
import { applySensorCalibration } from '../lib/oxynity';
import { FleetMap } from './admin/FleetMap';
import { SensorSetup } from './admin/SensorSetup';
import { isSensorInstalled } from '../lib/oxynity';
import { InstalledSensorsEditor } from './admin/InstalledSensorsEditor';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  DeviceTelemetry,
  PondContact,
  ChatMessage,
} from '../types/iot';
import { collection, doc, setDoc, onSnapshot, arrayUnion } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  OXY_MAP_DATA,
  generateAdminFleet,
  generateAdminComplaints,
  generateAdminJobs,
  AdminDeviceRecord,
  AdminComplaintRecord,
  AdminJobRecord,
  fmtDate,
  addMonths,
  toCsv,
  saveCsvFile,
  telemetryToAdminRecord,
} from '../data/oxynityAdminData';
import { OxynityLiveLogo, OxynitySplashScreen } from './OxynityLiveLogo';
import { AdminUserManagement } from './admin/AdminUserManagement';
import { AdminContentManagement } from './admin/AdminContentManagement';
import { AdminNotificationsHub } from './admin/AdminNotificationsHub';
import { LiveGprsMap } from './LiveGprsMap';
import { Geolocation } from '@capacitor/geolocation';
import {
  Search,
  MapPin,
  FileDown,
  Phone,
  Compass,
  Plus,
  X,
  ChevronRight,
  LogOut,
  SlidersHorizontal,
  ShieldCheck,
  Wrench,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Layers,
  Monitor,
  Smartphone,
  ChevronDown,
  Navigation as NavIcon,
  MessageSquare,
  Send,
  User,
  Power,
  Play,
  Square,
  Clock,
  Activity,
  Zap,
  Calendar,
  Flame,
  RefreshCw,
  Snowflake,
  Timer,
  LocateFixed,
  Lock,
  Unlock,
  Radio,
  Check,
} from 'lucide-react';

/** Users saved by the User Management screen (stored on this phone only). */
const savedAdminUsers = (): any[] => {
  try {
    const v = JSON.parse(localStorage.getItem('oxynity_admin_users') || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

interface AdminDashboardProps {
  currentDevice: DeviceTelemetry;
  allDevices: DeviceTelemetry[];
  adminEmail?: string;
  adminName?: string;
  onLogout: () => void;
  onCalibrateLocation?: (
    lat: number,
    lng: number,
    locName: string,
    cellLac?: string,
    cellId?: string
  ) => Promise<void>;
  onResetCalibration?: () => Promise<void>;
}

export type AdminTab = 'map' | 'devices' | 'complaints' | 'service' | 'more';
export type DeviceDetailTab = 'overview' | 'sensors' | 'service' | 'warranty' | 'activity';

const META = {
  running: { label: 'Running', color: '#22C55E', bg: '#DCFCE7', fg: '#14532D', text: '#15803D', rank: 3 },
  standby: { label: 'Standby', color: '#94A3B8', bg: '#EEF2F5', fg: '#33475A', text: '#52677A', rank: 2 },
  maint: { label: 'Maintenance', color: '#FACC15', bg: '#FEF9C3', fg: '#713F12', text: '#A16207', rank: 1 },
  critical: { label: 'Critical', color: '#EF4444', bg: '#FEE2E2', fg: '#7F1D1D', text: '#B91C1C', rank: 0 },
};

const STATUS_ORDER: Array<'critical' | 'maint' | 'standby' | 'running'> = [
  'critical',
  'maint',
  'standby',
  'running',
];

const P = (lat: number, lon: number): [number, number] => [
  (lon - 67) * 20 * 0.93,
  (37 - lat) * 20,
];

export function calculateHaversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}



export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentDevice,
  allDevices,
  adminEmail = 'admin@oxynity.com',
  adminName = 'System Admin',
  onLogout,
  onCalibrateLocation,
  onResetCalibration,
}) => {
  // Splash Screen State
  // The admin panel is designed in light colours only. If the phone (or the farmer app) is in dark
  // mode, shared cards and inputs turned dark while admin text stayed dark = unreadable. Force light
  // while the admin panel is open and restore the previous theme when it closes.
  useEffect(() => {
    const html = document.documentElement;
    const prevTheme = html.getAttribute('data-theme');
    const hadDark = html.classList.contains('dark');
    const force = () => {
      if (html.classList.contains('dark')) html.classList.remove('dark');
      if (html.getAttribute('data-theme') !== 'light') html.setAttribute('data-theme', 'light');
    };
    force();
    const mo = new MutationObserver(force);
    mo.observe(html, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => {
      mo.disconnect();
      if (prevTheme) html.setAttribute('data-theme', prevTheme);
      else html.removeAttribute('data-theme');
      if (hadDark) html.classList.add('dark');
    };
  }, []);

  const [showSplash, setShowSplash] = useState<boolean>(() => {
    return !sessionStorage.getItem('oxynity_admin_splash_dismissed');
  });

  const handleDismissSplash = () => {
    setShowSplash(false);
    sessionStorage.setItem('oxynity_admin_splash_dismissed', 'true');
  };

  // Viewport Size Mode: 'browser' (full web browser responsive layout) vs 'mobile' (phone preview)
  const [viewportMode, setViewportMode] = useState<'browser' | 'mobile'>('browser');

  // Main navigation tab
  const [route, setRoute] = useState<AdminTab>('map');
  const [toastMessage, setToastMessage] = useState<string>('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? '' : prev));
    }, 2800);
  };

  // Build full fleet exclusively from real devices
  const buildInitialFleet = (): AdminDeviceRecord[] => {
    const list: DeviceTelemetry[] = [];
    if (allDevices && allDevices.length > 0) {
      allDevices.forEach((ad) => {
        if (!list.some((b) => b.deviceId === ad.deviceId)) {
          list.push(ad);
        }
      });
    }
    if (currentDevice && currentDevice.deviceId && currentDevice.deviceId !== 'OXY-DEFAULT-DEV') {
      const idx = list.findIndex((b) => b.deviceId === currentDevice.deviceId);
      if (idx >= 0) {
        list[idx] = currentDevice;
      } else {
        list.unshift(currentDevice);
      }
    }
    return list.map((d, i) => telemetryToAdminRecord(d, i));
  };

  // Fleet devices data
  const [fleet, setFleet] = useState<AdminDeviceRecord[]>(buildInitialFleet);

  // Real-Time Sync of All Fleet Devices from Firestore
  useEffect(() => {
    try {
      const unsub = onSnapshot(
        collection(db, 'devices'),
        (snap) => {
          const firestoreDevices: DeviceTelemetry[] = snap.docs.map((d) => {
            const data = applySensorCalibration(d.data() as any) as DeviceTelemetry;
            return {
              ...data,
              deviceId: data.deviceId || d.id,
              name: data.name || (d.id === 'OXY-ESP32-001' ? 'Pond 1' : d.id),
              status: data.status || 'OFF',
            };
          });

          // Include currentDevice if active and not yet present in Firestore docs
          if (
            currentDevice?.deviceId &&
            currentDevice.deviceId !== 'OXY-DEFAULT-DEV' &&
            !firestoreDevices.some((d) => d.deviceId === currentDevice.deviceId)
          ) {
            firestoreDevices.unshift(currentDevice);
          }

          const mapped = firestoreDevices.map((d, idx) => {
            if (currentDevice?.deviceId === d.deviceId) {
              return telemetryToAdminRecord({ ...d, ...currentDevice }, idx);
            }
            return telemetryToAdminRecord(d, idx);
          });

          setFleet(mapped);
        },
        (err) => {
          console.warn('Real-time devices listener warning:', err);
        }
      );

      return () => unsub();
    } catch (err) {
      console.warn('Could not attach Firestore devices listener:', err);
    }
  }, [currentDevice]);

  // 1-second live ticker for running machines elapsed seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setFleet((prevFleet) => {
        let hasActiveRunning = false;
        const next = prevFleet.map((rec) => {
          if (rec.rawTelemetry && rec.rawTelemetry.status === 'ON') {
            hasActiveRunning = true;
            const started = rec.rawTelemetry.sessionStartedAt
              ? new Date(rec.rawTelemetry.sessionStartedAt).getTime()
              : Date.now() - (rec.rawTelemetry.currentSessionSeconds || 0) * 1000;
            const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
            const mins = Math.floor(elapsed / 60);

            return {
              ...rec,
              status: 'running' as const,
              rawTelemetry: {
                ...rec.rawTelemetry,
                currentSessionSeconds: elapsed,
                currentSessionMinutes: mins,
              },
            };
          }
          return rec;
        });
        return hasActiveRunning ? next : prevFleet;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Remote power toggle action for Admin
  const handleAdminTogglePower = async (targetId: string, newStatus: 'ON' | 'OFF') => {
    const nowIso = new Date().toISOString();
    try {
      setFleet((prev) =>
        prev.map((d) => {
          if (d.id === targetId) {
            const raw = d.rawTelemetry || ({} as DeviceTelemetry);
            const updatedRaw: DeviceTelemetry = {
              ...raw,
              deviceId: targetId,
              name: d.pond,
              status: newStatus,
              sessionStartedAt: newStatus === 'ON' ? nowIso : undefined,
              currentSessionMinutes: 0,
              currentSessionSeconds: 0,
              updatedAt: nowIso,
              lastSeen: nowIso,
            };
            return {
              ...d,
              status: newStatus === 'ON' ? ('running' as const) : ('standby' as const),
              rawTelemetry: updatedRaw,
            };
          }
          return d;
        })
      );

      const devRef = doc(db, 'devices', targetId);
      await setDoc(
        devRef,
        {
          deviceId: targetId,
          status: newStatus,
          sessionStartedAt: newStatus === 'ON' ? nowIso : null,
          currentSessionMinutes: 0,
          currentSessionSeconds: 0,
          updatedAt: nowIso,
          lastSeen: nowIso,
        },
        { merge: true }
      );

      showToast(`MNBG Generator successfully turned ${newStatus} for ${targetId}!`);
    } catch (err) {
      console.error('Error toggling power from admin panel:', err);
      showToast(`Failed to update machine power for ${targetId}.`);
    }
  };

  // Complaints & Jobs data
  // Only real complaints / jobs (no generated sample data for real customers)
  const [complaints, setComplaints] = useState<AdminComplaintRecord[]>([]);
  const [jobs, setJobs] = useState<AdminJobRecord[]>([]);

  // Map State
  const [mapState, setMapState] = useState<string>('All');
  const [mapDist, setMapDist] = useState<string>('All');
  const [mapStatusFilter, setMapStatusFilter] = useState<string>('All');
  const [mapSelectedDeviceId, setMapSelectedDeviceId] = useState<string | null>(null);
  const [mapTab, setMapTab] = useState<'loc' | 'dev'>('loc');
  const [mapExportStatus, setMapExportStatus] = useState<string>('critical');
  const [mapSort, setMapSort] = useState<'idle' | 'district' | 'id' | 'hours'>('idle');

  // Devices Tab State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [groupBy, setGroupBy] = useState<'farmer' | 'place' | 'status' | 'none'>('farmer');
  const [deviceStatusFilter, setDeviceStatusFilter] = useState<string>('All');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [selectedDevice, setSelectedDevice] = useState<AdminDeviceRecord | null>(null);
  const [deviceDetailTab, setDeviceDetailTab] = useState<DeviceDetailTab>('overview');

  // Keep selectedDevice in sync with live fleet updates (running timers, DO, status)
  useEffect(() => {
    if (selectedDevice) {
      const match = fleet.find((d) => d.id === selectedDevice.id);
      if (match && match !== selectedDevice) {
        setSelectedDevice(match);
      }
    }
  }, [fleet, selectedDevice?.id]);

  // Seed jobs, complaints, and default newComplaintDevice once fleet loads if empty
  useEffect(() => {
    if (fleet.length > 0) {
      setNewComplaintDevice((prev) => (prev ? prev : fleet[0].id));
    }
  }, [fleet]);

  // Complaints Tab State
  const [complaintStage, setComplaintStage] = useState<number>(0);
  const [openedComplaintId, setOpenedComplaintId] = useState<string | null>(null);
  const [showNewComplaintModal, setShowNewComplaintModal] = useState<boolean>(false);
  const [newComplaintDevice, setNewComplaintDevice] = useState<string>(fleet[0]?.id || '');
  const [newComplaintIssue, setNewComplaintIssue] = useState<string>('Low bubble output');
  const [newComplaintPriority, setNewComplaintPriority] = useState<'High' | 'Medium' | 'Low'>(
    'Medium'
  );
  const [newComplaintSource, setNewComplaintSource] = useState<string>('Phone call');
  const [newComplaintNotes, setNewComplaintNotes] = useState<string>('');

  // Two-Way Admin Chat State
  const [adminChatReply, setAdminChatReply] = useState<string>('');
  const [isSendingChat, setIsSendingChat] = useState<boolean>(false);

  // Real-Time Sync of Customer Complaints & Service Requests from Firestore
  useEffect(() => {
    try {
      const unsub = onSnapshot(collection(db, 'service_requests'), (snap) => {
        if (!snap.empty) {
          const liveComplaints: AdminComplaintRecord[] = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              device: data.deviceId || '',
              issue: data.desc || data.type || 'Service Request',
              priority: (data.priority as 'High' | 'Medium' | 'Low') || 'Medium',
              source: data.source || 'Farmer app',
              age: data.date ? `${data.date}` : 'Just now',
              stage: data.stage !== undefined ? data.stage : data.status === 'Resolved' ? 3 : data.status === 'In progress' ? 2 : 0,
              farmer: data.farmer || 'Farmer Operator',
              place: data.place || data.pondName || 'Primary Pond',
              tech: data.tech || 'Unassigned',
              phone: data.phone || '',
              messages: Array.isArray(data.messages) ? data.messages : [],
              createdAt: data.createdAt || data.date,
            };
          });

          setComplaints((prev) => {
            const liveIds = new Set(liveComplaints.map((c) => c.id));
            const existingSeeds = prev.filter((c) => !liveIds.has(c.id));
            return [...liveComplaints, ...existingSeeds];
          });
        }
      }, (err) => {
        console.warn('Admin Firestore service_requests live sync warning:', err);
      });

      return () => unsub();
    } catch (e) {
      console.warn('Could not initialize Admin complaints live listener:', e);
    }
  }, []);

  // Service Tab State
  const [selectedTech, setSelectedTech] = useState<string>('Suresh');

  // More Tab State
  const [automationRules, setAutomationRules] = useState<Record<string, boolean>>({
    auto: true,
    night: true,
    restart: true,
    sms: true,
  });
  const [pushAlertsEnabled, setPushAlertsEnabled] = useState<boolean>(true);

  // System Tools Sub-Modal State (for legacy admin sub-modules)
  // Sensor setup & calibration wizard: null = closed, '' = open with first machine, id = open for that machine
  const [sensorSetupFor, setSensorSetupFor] = useState<string | null>(null);
  const [showSystemTools, setShowSystemTools] = useState<boolean>(false);
  const [systemToolsTab, setSystemToolsTab] = useState<
    'users' | 'content' | 'notifications' | 'calibrate'
  >('users');
  // SIMCom A7672S 4G LTE Geofence & Calibration State
  const [calibratingDeviceId, setCalibratingDeviceId] = useState<string | null>(null);
  const [showLiveMapInDetail, setShowLiveMapInDetail] = useState<boolean>(false);
  const [manualCalibrateModal, setManualCalibrateModal] = useState<{
    open: boolean;
    deviceId: string;
    pondName: string;
    lat: string;
    lng: string;
    name: string;
  } | null>(null);

  // Real-time Geofence Breach Detection (Alert when machine moves > 1.0 km from locked anchor)
  const geofenceBreaches = useMemo(() => {
    return fleet.filter((d) => {
      const raw = d.rawTelemetry;
      if (!raw) return false;
      if (raw.isGeofenceBreached) return true;
      const calLat = raw.calibratedLatitude;
      const calLng = raw.calibratedLongitude;
      const liveLat = raw.latitude;
      const liveLng = raw.longitude;
      if (
        calLat &&
        calLng &&
        liveLat &&
        liveLng &&
        Math.abs(calLat) > 0.01 &&
        Math.abs(liveLat) > 0.01
      ) {
        const dist = calculateHaversineKm(calLat, calLng, liveLat, liveLng);
        if (dist > 1.0) return true;
      }
      return (raw.moveDistanceKm ?? 0) > 1.0;
    });
  }, [fleet]);

  const handleCalibratePondLocation = async (
    targetDeviceId: string,
    lat: number,
    lng: number,
    locName: string
  ) => {
    try {
      const docRef = doc(db, 'devices', targetDeviceId);
      await setDoc(
        docRef,
        {
          latitude: lat,
          longitude: lng,
          calibratedLatitude: lat,
          calibratedLongitude: lng,
          calibratedLocationName: locName,
          calibratedAt: new Date().toISOString(),
          isCalibrated: true,
          isMoving: false,
          moveDistanceKm: 0,
          isGeofenceBreached: false,
          geofenceRadiusKm: 1.0,
          locationName: locName,
          locationSource: 'A7672S Calibrated Anchor (1 km Radius Lock)',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      if (onCalibrateLocation && targetDeviceId === currentDevice?.deviceId) {
        await onCalibrateLocation(lat, lng, locName);
      }
      showToast(`✓ Pond ${targetDeviceId} location calibrated & locked within 1.0 km radius!`);
    } catch (err: any) {
      console.error('Calibration error:', err);
      showToast(`Failed to calibrate location: ${err?.message || err}`);
    }
  };

  const handleResetPondCalibration = async (targetDeviceId: string) => {
    try {
      const docRef = doc(db, 'devices', targetDeviceId);
      await setDoc(
        docRef,
        {
          isCalibrated: false,
          isMoving: false,
          moveDistanceKm: 0,
          isGeofenceBreached: false,
          calibratedLatitude: 0,
          calibratedLongitude: 0,
          calibratedLocationName: '',
          calibratedAt: '',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      if (onResetCalibration && targetDeviceId === currentDevice?.deviceId) {
        await onResetCalibration();
      }
      showToast(`✓ Pond ${targetDeviceId} anchor reset.`);
    } catch (err: any) {
      console.error('Reset calibration error:', err);
      showToast(`Failed to reset calibration: ${err?.message || err}`);
    }
  };

  const handleDetectFromPhoneGps = async (targetDeviceId: string) => {
    setCalibratingDeviceId(targetDeviceId);
    try {
      let lat: number | null = null;
      let lng: number | null = null;

      try {
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch (geoErr) {
        if ('geolocation' in navigator) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
            });
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } else {
          throw geoErr;
        }
      }

      if (lat !== null && lng !== null) {
        const roundedLat = parseFloat(lat.toFixed(6));
        const roundedLng = parseFloat(lng.toFixed(6));
        const locName = `Pond Anchor (${roundedLat.toFixed(4)}, ${roundedLng.toFixed(4)})`;
        await handleCalibratePondLocation(targetDeviceId, roundedLat, roundedLng, locName);
      } else {
        throw new Error('Unable to acquire phone GPS coordinates');
      }
    } catch (err: any) {
      console.error('Phone GPS calibration error:', err);
      showToast(`GPS Detection failed: ${err?.message || 'Permission denied or timed out'}`);
    } finally {
      setCalibratingDeviceId(null);
    }
  };

  const handleDetectFromDeviceGps = async (dev: AdminDeviceRecord) => {
    const raw = dev.rawTelemetry;
    if (!raw?.latitude || !raw?.longitude || Math.abs(raw.latitude) < 0.01) {
      showToast('⚠️ SIMCom A7672S 4G module has not acquired a live GPS fix yet. Verify antenna.');
      return;
    }
    const lat = parseFloat(raw.latitude.toFixed(6));
    const lng = parseFloat(raw.longitude.toFixed(6));
    const locName = `A7672S 4G GNSS Anchor (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    await handleCalibratePondLocation(dev.id, lat, lng, locName);
  };

  // Helpers
  const shortOf = (d: AdminDeviceRecord) => {
    if (d.complaint) return 'Complaint';
    if (d.status === 'running') return 'Running';
    return `Off ${d.idle} ${d.idle === 1 ? 'day' : 'days'}`;
  };

  const reasonOf = (d: AdminDeviceRecord) => {
    if (d.complaint) return `Complaint: ${d.complaint} · assigned to ${d.tech}`;
    if (d.status === 'critical') return `Not running for ${d.idle} days (exceeds 7-day limit)`;
    if (d.status === 'maint') return `Not running for ${d.idle} days · maintenance check due`;
    if (d.status === 'standby')
      return `Stopped ${d.idle} ${d.idle === 1 ? 'day' : 'days'} ago · normal auto standby`;
    return `Running now${d.doNow ? ` · DO ${d.doNow} ppm` : ''}`;
  };

  const countBy = (list: AdminDeviceRecord[]) => {
    const c = { running: 0, standby: 0, maint: 0, critical: 0 };
    list.forEach((d) => {
      if (c[d.status] !== undefined) c[d.status]++;
    });
    return c;
  };

  const sortAttention = (a: AdminDeviceRecord, b: AdminDeviceRecord) => {
    return (
      META[a.status].rank - META[b.status].rank ||
      (b.complaint ? 99 : b.idle) - (a.complaint ? 99 : a.idle)
    );
  };

  // Map Level & Scope Calculations
  const mapLevel = mapDist !== 'All' ? 'district' : mapState !== 'All' ? 'state' : 'country';
  const mapScope = useMemo(() => {
    return fleet.filter(
      (d) =>
        (mapState === 'All' || d.state === mapState) && (mapDist === 'All' || d.district === mapDist)
    );
  }, [fleet, mapState, mapDist]);

  const mapShown = useMemo(() => {
    return mapScope.filter((d) => mapStatusFilter === 'All' || d.status === mapStatusFilter);
  }, [mapScope, mapStatusFilter]);

  const mapCounts = useMemo(() => countBy(mapScope), [mapScope]);

  const statesList = useMemo(() => {
    return Array.from(new Set(fleet.map((d) => d.state)));
  }, [fleet]);

  const distsList = useMemo(() => {
    return Array.from(
      new Set(fleet.filter((d) => d.state === mapState).map((d) => d.district))
    );
  }, [fleet, mapState]);

  // Map Bounding Box calculations
  const mapBox = useMemo(() => {
    const fit = (cx: number, cy: number, w: number, h: number): [number, number, number, number] => {
      const s = Math.max(w, h);
      return [cx - s / 2, cy - s / 2, s, s];
    };
    if (mapLevel === 'country') {
      return fit(285, 300, 600, 620);
    }
    const pts = mapScope.map((d) => P(d.lat, d.lon));
    if (pts.length === 0) return fit(285, 300, 600, 620);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const pad = mapLevel === 'state' ? 50 : 4;
    const minSpan = mapLevel === 'state' ? 110 : 8;
    return fit((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0 + pad, minSpan), Math.max(y1 - y0 + pad, minSpan));
  }, [mapLevel, mapScope]);

  const pct = (p: [number, number]) => ({
    left: `${(((p[0] - mapBox[0]) / mapBox[2]) * 100).toFixed(2)}%`,
    top: `${(((p[1] - mapBox[1]) / mapBox[3]) * 100).toFixed(2)}%`,
  });

  const selectedMapDevice = mapSelectedDeviceId
    ? fleet.find((d) => d.id === mapSelectedDeviceId)
    : null;

  // CSV Report Generator
  const handleDownloadCsv = (type: string) => {
    const dateStamp = new Date().toISOString().split('T')[0];
    if (type === 'service') {
      const rows: (string | number)[][] = [
        ['Device ID', 'Pond', 'Farmer', 'Date', 'Type', 'Work Performed', 'By Technician', 'Notes'],
      ];
      fleet.forEach((d) => {
        d.svc.forEach((s) => {
          rows.push([d.id, d.pond, d.farmer, fmtDate(s.dt), s.type, s.title, s.by, s.note]);
        });
      });
      saveCsvFile(`oxynity-service-history-${dateStamp}.csv`, toCsv(rows));
      showToast('Service history report downloaded');
      return;
    }
    if (type === 'warranty') {
      const rows: (string | number)[][] = [
        ['Device ID', 'Pond', 'Farmer', 'Village', 'Installed', 'Warranty Ends', 'Days Left', 'AMC Status'],
      ];
      fleet
        .slice()
        .sort((a, b) => a.wDays - b.wDays)
        .forEach((d) => {
          rows.push([
            d.id,
            d.pond,
            d.farmer,
            d.village,
            fmtDate(d.installed),
            fmtDate(d.wEnd),
            d.wDays,
            d.amc === 'warranty'
              ? 'Under Warranty'
              : d.amc === 'active'
              ? `Active until ${d.amcEnd}`
              : 'Not Taken',
          ]);
        });
      saveCsvFile(`oxynity-warranty-status-${dateStamp}.csv`, toCsv(rows));
      showToast('Warranty status report downloaded');
      return;
    }
    const filter = type === 'All' ? 'All' : type;
    const targets = fleet.filter((d) => filter === 'All' || d.status === filter);
    const rows: (string | number)[][] = [
      [
        'Device ID',
        'Pond',
        'Status',
        'Condition',
        'Days Not Running',
        'Farmer',
        'Business',
        'Village',
        'District',
        'State',
        'Model',
        'Mode',
        'DO Level (ppm)',
        'Total Run Hours',
        'Installed Date',
        'Warranty Ends',
        'Latitude',
        'Longitude',
      ],
    ];
    targets.sort(sortAttention).forEach((d) => {
      rows.push([
        d.id,
        d.pond,
        META[d.status].label,
        reasonOf(d),
        d.idle,
        d.farmer,
        d.business,
        d.village,
        d.district,
        d.state,
        d.model,
        d.mode,
        d.doNow || 'N/A',
        d.hours,
        fmtDate(d.installed),
        fmtDate(d.wEnd),
        d.lat.toFixed(5),
        d.lon.toFixed(5),
      ]);
    });
    saveCsvFile(`oxynity-fleet-${type.toLowerCase()}-${dateStamp}.csv`, toCsv(rows));
    showToast(`Exported ${targets.length} devices to CSV`);
  };

  // Map Zoom Controls
  const handleMapZoomIn = () => {
    if (mapState === 'All') {
      const topState = Object.entries(
        fleet.reduce((acc, d) => {
          acc[d.state] = (acc[d.state] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0];
      if (topState) setMapState(topState);
    } else if (mapDist === 'All') {
      const topDist = Object.entries(
        fleet
          .filter((d) => d.state === mapState)
          .reduce((acc, d) => {
            acc[d.district] = (acc[d.district] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
      ).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0];
      if (topDist) setMapDist(topDist);
    }
  };

  const handleMapZoomOut = () => {
    if (mapDist !== 'All') {
      setMapDist('All');
    } else if (mapState !== 'All') {
      setMapState('All');
    }
    setMapSelectedDeviceId(null);
  };

  // Handle saving new complaint
  const handleSaveComplaint = (e: React.FormEvent) => {
    e.preventDefault();
    const targetDev = fleet.find((d) => d.id === newComplaintDevice) || fleet[0];
    const newId = `CMP-${1050 + complaints.length}`;
    const newRecord: AdminComplaintRecord = {
      id: newId,
      device: targetDev?.id || newComplaintDevice || 'OXY-001',
      issue: newComplaintIssue,
      priority: newComplaintPriority,
      source: newComplaintSource,
      age: 'Just now',
      stage: 0,
      farmer: targetDev?.farmer || 'Farmer Operator',
      place: targetDev ? `${targetDev.village}, ${targetDev.district}` : 'Aquaculture Facility',
      tech: 'Unassigned',
    };
    setComplaints([newRecord, ...complaints]);
    setShowNewComplaintModal(false);
    setNewComplaintNotes('');
    showToast(`New complaint ${newId} logged for ${targetDev?.farmer || 'device'}`);
  };

  // Advance complaint stage
  const handleAdvanceComplaint = async (cmpId: string) => {
    let nextStageNum = 0;
    let nextStatusStr = 'Open';

    setComplaints((prev) =>
      prev.map((c) => {
        if (c.id !== cmpId) return c;
        const nextStage = c.stage >= 3 ? 0 : c.stage + 1;
        nextStageNum = nextStage;
        const stageNames = ['New', 'Assigned', 'Working', 'Done'];
        showToast(`${c.id} updated to ${stageNames[nextStage]}`);
        nextStatusStr = nextStage === 3 ? 'Resolved' : nextStage === 0 ? 'Open' : 'In progress';
        return {
          ...c,
          stage: nextStage,
          tech: nextStage === 0 ? 'Unassigned' : c.tech === 'Unassigned' ? 'Suresh' : c.tech,
        };
      })
    );

    // Sync to Firestore if this is a registered service_request
    try {
      await setDoc(
        doc(db, 'service_requests', cmpId),
        {
          stage: nextStageNum,
          status: nextStatusStr,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Could not update complaint stage in Firestore:', e);
    }
  };

  // Two-Way Admin Chat: Send Reply to Customer
  const handleSendAdminReply = async (complaintId: string) => {
    if (!adminChatReply.trim()) return;
    const text = adminChatReply.trim();
    setIsSendingChat(true);

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'admin',
      senderName: adminName || 'Oxynity Support (Admin)',
      text,
      timestamp: new Date().toISOString(),
    };

    // Optimistically update local complaint chat
    setComplaints((prev) =>
      prev.map((c) => {
        if (c.id !== complaintId) return c;
        const msgs = Array.isArray(c.messages) ? [...c.messages, newMsg] : [newMsg];
        return {
          ...c,
          messages: msgs,
          stage: c.stage === 0 ? 1 : c.stage, // Auto-advance to Assigned if in New stage
        };
      })
    );
    setAdminChatReply('');

    try {
      await setDoc(
        doc(db, 'service_requests', complaintId),
        {
          messages: arrayUnion(newMsg),
          status: 'In progress',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      showToast('Reply sent to farmer!');
    } catch (e) {
      console.warn('Could not send admin reply to Firestore:', e);
      showToast('Reply saved locally');
    } finally {
      setIsSendingChat(false);
    }
  };

  // Handle Service Job Next
  const handleAdvanceJob = (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const nextProg = Math.min(2, j.prog + 1);
        showToast(`Job ${j.id} updated to ${['Next', 'On site', 'Done'][nextProg]}`);
        return { ...j, prog: nextProg };
      })
    );
  };

  // Grouped devices logic
  const filteredDevices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return fleet.filter((d) => {
      const matchesQuery =
        !q ||
        (d.id + ' ' + d.farmer + ' ' + d.business + ' ' + d.pond + ' ' + d.village + ' ' + d.district)
          .toLowerCase()
          .includes(q);
      const matchesStatus = deviceStatusFilter === 'All' || d.status === deviceStatusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [fleet, searchQuery, deviceStatusFilter]);

  const deviceGroups = useMemo(() => {
    const groups: Record<string, AdminDeviceRecord[]> = {};
    filteredDevices.forEach((d) => {
      let key = d.farmer;
      if (groupBy === 'place') key = `${d.district}, ${d.state}`;
      else if (groupBy === 'status') key = META[d.status].label;
      else if (groupBy === 'none') key = 'All Devices';
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });
    return groups;
  }, [filteredDevices, groupBy]);

  return (
    <div className="h-screen w-full bg-[#F1F5F9] text-[#0F2233] font-sans antialiased selection:bg-[#0E6FA3] selection:text-white flex flex-col items-center overflow-y-auto overflow-x-hidden">
      {/* ── Optional Opening Splash Screen ── */}
      {showSplash && <OxynitySplashScreen onDismiss={handleDismissSplash} />}
      {/* Loud warnings: new service requests + pond power-off / offline */}
      <AlarmCenter devices={fleet.map((d) => d.rawTelemetry).filter(Boolean)} watchServiceRequests />
      {sensorSetupFor !== null && (
        <SensorSetup fleet={fleet} initialDeviceId={sensorSetupFor || null} adminEmail={adminEmail} onClose={() => setSensorSetupFor(null)} />
      )}

      {/* ── Toast Notification Bar ── */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-[#0B2440] text-white text-xs sm:text-sm font-bold px-4 py-2.5 rounded-2xl shadow-2xl border border-sky-400/30 animate-in fade-in slide-in-from-bottom-4 flex items-center gap-2 max-w-[90vw]"
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ── Main Container: Full Web Browser Responsive Layout (or phone preview) ── */}
      <div
        className={`w-full flex flex-col transition-all duration-300 pb-32 ${
          viewportMode === 'mobile'
            ? 'max-w-[430px] min-h-full bg-[#F1F5F9] shadow-2xl border-x border-[#DDE7EF]'
            : 'max-w-7xl px-0 sm:px-4 lg:px-6'
        }`}
      >
        {/* ── TOP HEADER (Dark Navy Theme with Live Animated Bubbling Oxynity Logo) ── */}
        <header
          className={`bg-[#0B2440] text-white ${
            viewportMode === 'mobile'
              ? 'px-3 py-3 rounded-b-2xl'
              : 'px-4 sm:px-6 pt-3.5 pb-4 rounded-b-[24px] sm:rounded-b-[28px]'
          } shadow-lg flex flex-col gap-2.5 shrink-0 w-full overflow-hidden`}
          style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}
        >
          {/* Top Row: Animated Spray Logo & Title + Actions */}
          <div className="flex items-center justify-between gap-2 w-full min-w-0">
            <div className="flex items-center gap-2 shrink min-w-0">
              <OxynityLiveLogo size={viewportMode === 'mobile' ? 32 : 42} />
              <div className="flex flex-col leading-none select-none truncate">
                <div className="flex items-center gap-1">
                  <b className="font-black italic text-white text-base sm:text-xl tracking-tight">
                    OXYNITY
                  </b>
                  <i className="font-bold italic text-[#6CCBF2] text-[10px] sm:text-xs tracking-[0.2em] pl-0.5">
                    SMART
                  </i>
                </div>
                <span className="text-[10px] text-[#9DB8D0] font-semibold mt-0.5 truncate">
                  Admin Fleet
                </span>
              </div>
            </div>

            {/* Desktop / Viewport Switcher & Logout Buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Web Browser vs Phone Preview Toggle */}
              <div className="flex items-center bg-[#133559] p-0.5 rounded-xl border border-[#2A5584]">
                <button
                  type="button"
                  onClick={() => setViewportMode('browser')}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    viewportMode === 'browser'
                      ? 'bg-[#0E6FA3] text-white shadow-xs'
                      : 'text-[#9DB8D0] hover:text-white'
                  }`}
                  title="Web Browser Full Width View"
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span className={viewportMode === 'mobile' ? 'hidden' : 'hidden md:inline'}>
                    Browser
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewportMode('mobile')}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    viewportMode === 'mobile'
                      ? 'bg-[#0E6FA3] text-white shadow-xs'
                      : 'text-[#9DB8D0] hover:text-white'
                  }`}
                  title="Mobile Phone View Preview"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span className={viewportMode === 'mobile' ? 'hidden' : 'hidden md:inline'}>
                    Mobile
                  </span>
                </button>
              </div>

              {/* Admin Profile */}
              <div className="flex items-center gap-1 bg-[#133559] px-2 py-1 rounded-xl border border-[#2A5584] text-xs font-bold text-white">
                <ShieldCheck className="w-3.5 h-3.5 text-[#54B7E7]" />
                <span className={viewportMode === 'mobile' ? 'hidden' : 'hidden sm:inline'}>
                  {adminName.split(' ')[0]}
                </span>
              </div>

              {/* Logout Button */}
              <button
                type="button"
                onClick={onLogout}
                className="w-8 h-8 rounded-xl bg-[#163A63] hover:bg-rose-900/60 text-white flex items-center justify-center transition-colors border border-transparent hover:border-rose-400 cursor-pointer"
                title="Sign Out"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Navigation Bar (Adaptive for Browser View vs Mobile View) */}
          {viewportMode === 'mobile' ? (
            <div className="flex flex-col gap-2 border-t border-[#1D4C80]/80 pt-2.5 mt-0.5">
              {/* Wrapped Tab Pills for Mobile (All options visible, scrolling vertically) */}
              <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                {(
                  [
                    ['map', 'Map View', MapPin],
                    ['devices', 'Devices Fleet', SlidersHorizontal],
                    ['complaints', 'Complaints', AlertTriangle],
                    ['service', 'Service Portal', Wrench],
                    ['more', 'Reports & Settings', Layers],
                  ] as const
                ).map(([tId, tLabel, Icon]) => {
                  const isActive = route === tId;
                  return (
                    <button
                      key={tId}
                      type="button"
                      onClick={() => {
                        setRoute(tId);
                        setSelectedDevice(null);
                      }}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex-1 min-w-[28%] ${
                        isActive
                          ? 'bg-[#0E6FA3] text-white shadow-xs'
                          : 'text-[#B9CDDF] bg-[#133559]/70 hover:text-white hover:bg-[#1D4C80]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="whitespace-nowrap">{tLabel}</span>
                    </button>
                  );
                })}
              </div>

              {/* Mobile Quick Metrics Banner */}
              <div className="flex items-center justify-between bg-[#133559]/80 px-3 py-1.5 rounded-xl border border-[#2A5584]/60 text-xs">
                <span className="text-[#9DB8D0]">
                  Fleet: <b className="text-white font-mono">{fleet.length}</b>
                </span>
                <span className="text-emerald-400 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 ox-blink" />
                  <b>{fleet.filter((d) => d.status === 'running').length} Running</b>
                </span>
                <span className="text-rose-400 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <b>{fleet.filter((d) => d.status === 'critical').length} Critical</b>
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5 border-t border-[#1D4C80]/80 pt-2.5 mt-0.5">
              <div className="flex items-center gap-1 bg-[#133559] p-1 rounded-xl border border-[#2A5584]/80 overflow-x-auto no-scrollbar">
                {(
                  [
                    ['map', 'Map View', MapPin],
                    ['devices', 'Devices Fleet', SlidersHorizontal],
                    ['complaints', 'Complaints', AlertTriangle],
                    ['service', 'Service Portal', Wrench],
                    ['more', 'Reports & Settings', Layers],
                  ] as const
                ).map(([tId, tLabel, Icon]) => {
                  const isActive = route === tId;
                  return (
                    <button
                      key={tId}
                      type="button"
                      onClick={() => {
                        setRoute(tId);
                        setSelectedDevice(null);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'bg-[#0E6FA3] text-white shadow-xs'
                          : 'text-[#B9CDDF] hover:text-white hover:bg-[#1D4C80]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tLabel}</span>
                    </button>
                  );
                })}
              </div>

              {/* Desktop Quick Metrics Bar */}
              <div className="flex items-center gap-3 text-xs shrink-0 bg-[#133559]/60 px-3 py-1.5 rounded-xl border border-[#2A5584]/60">
                <span className="text-[#9DB8D0]">
                  Fleet:{' '}
                  <b className="text-white font-mono">{fleet.length} Machines</b>
                </span>
                <span className="text-emerald-400 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 ox-blink" />
                  <b>{fleet.filter((d) => d.status === 'running').length} Running</b>
                </span>
                <span className="text-rose-400 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <b>{fleet.filter((d) => d.status === 'critical').length} Critical</b>
                </span>
              </div>
            </div>
          )}
        </header>

        {/* 🚨 GEOFENCE BREACH ALERT BANNER (> 1.0 KM RADIUS) */}
        {geofenceBreaches.length > 0 && (
          <div className="mx-3 sm:mx-5 mt-3 p-3.5 sm:p-4 bg-gradient-to-r from-rose-50 via-rose-100 to-rose-50 border-2 border-rose-500 rounded-2xl shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-md">
                <AlertTriangle className="w-6 h-6 animate-bounce" />
              </div>
              <div className="flex flex-col">
                <b className="text-rose-950 text-sm sm:text-base font-black flex items-center gap-1.5">
                  🚨 CRITICAL GEOFENCE BREACH ALERT ({geofenceBreaches.length} {geofenceBreaches.length === 1 ? 'Pond Machine' : 'Pond Machines'})
                </b>
                <span className="text-rose-900 text-xs font-semibold">
                  {geofenceBreaches.map(b => {
                    const raw = b.rawTelemetry;
                    const d = (raw?.moveDistanceKm ?? (raw?.calibratedLatitude && raw?.latitude ? calculateHaversineKm(raw.calibratedLatitude, raw.calibratedLongitude || 0, raw.latitude, raw.longitude || 0) : 0));
                    return `${b.id} (${b.pond}) moved ${d.toFixed(2)} km`;
                  }).join(', ')} — Exceeds 1.0 km pond safety radius!
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSelectedDevice(geofenceBreaches[0]);
                  setRoute('devices');
                }}
                className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>Inspect Pond Location</span>
              </button>
            </div>
          </div>
        )}

        {/* ── TAB 1: INTERACTIVE MAP VIEW ── */}
        {route === 'map' && (
          <div className="p-3 sm:p-5 flex flex-col gap-3.5 animate-in fade-in">
            {/* Top Filter Chips */}
            <div
              className={`items-center justify-between gap-2 py-0.5 ${
                viewportMode === 'mobile' ? 'flex flex-wrap' : 'flex overflow-x-auto no-scrollbar'
              }`}
            >
              <div className={`items-center gap-2 ${viewportMode === 'mobile' ? 'flex flex-wrap' : 'flex'}`}>
                <button
                  type="button"
                  onClick={() => {
                    setMapStatusFilter('All');
                    setMapSelectedDeviceId(null);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border cursor-pointer ${
                    mapStatusFilter === 'All'
                      ? 'bg-[#0B2440] text-white border-[#0B2440]'
                      : 'bg-white text-[#33475A] border-[#D3DFE9] hover:bg-slate-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-[#0E6FA3]" />
                  <span>All ({mapScope.length})</span>
                </button>

                {STATUS_ORDER.map((st) => {
                  const m = META[st];
                  const count = mapCounts[st];
                  const isActive = mapStatusFilter === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => {
                        setMapStatusFilter(st);
                        setMapSelectedDeviceId(null);
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border cursor-pointer ${
                        isActive
                          ? 'bg-[#0B2440] text-white border-[#0B2440]'
                          : 'bg-white text-[#33475A] border-[#D3DFE9] hover:bg-slate-100'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ background: m.color }} />
                      <span>
                        {m.label} ({count})
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Geographic Dropdowns */}
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={mapState}
                  onChange={(e) => {
                    setMapState(e.target.value);
                    setMapDist('All');
                    setMapSelectedDeviceId(null);
                  }}
                  className="h-8 px-2.5 rounded-xl border border-[#C9D6DE] bg-white text-xs font-bold text-[#0F2233]"
                >
                  <option value="All">All States</option>
                  {statesList.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>

                <select
                  value={mapDist}
                  onChange={(e) => {
                    setMapDist(e.target.value);
                    setMapSelectedDeviceId(null);
                  }}
                  className="h-8 px-2.5 rounded-xl border border-[#C9D6DE] bg-white text-xs font-bold text-[#0F2233]"
                >
                  <option value="All">All Districts</option>
                  {distsList.map((dt) => (
                    <option key={dt} value={dt}>
                      {dt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Desktop 2-Column Grid: Map on Left, Location Drilldown & Reports on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left Column: Interactive Vector SVG Map Canvas (7 or 8 cols on desktop) */}
              <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-3">
                <FleetMap items={mapShown} selected={mapSelectedDeviceId} onSelect={(id) => setMapSelectedDeviceId(id)} />

                {/* Map Legend Indicators */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-[#33475A] bg-white p-3 rounded-2xl border border-[#DDE7EF] shadow-xs">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E] ox-blink" />
                    <b>Running (Active)</b>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#94A3B8]" />
                    <span>Standby (&lt;3 days)</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#FACC15]" />
                    <span>Maintenance (3-7 d)</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444]" />
                    <span>Critical (&gt;7 d / Issue)</span>
                  </span>
                </div>

                {/* Selected Machine Detail Card Popup */}
                {selectedMapDevice && (
                  <div className="bg-white rounded-2xl p-4 border border-[#DDE7EF] shadow-xl flex flex-col gap-3 animate-in fade-in zoom-in-95">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <b className="font-mono text-base text-[#0B2440]">
                            {selectedMapDevice.id}
                          </b>
                          <span className="text-sm font-bold text-[#0F2233]">
                            · {selectedMapDevice.pond}
                          </span>
                        </div>
                        <span className="text-xs text-[#52677A]">
                          {selectedMapDevice.farmer} ({selectedMapDevice.business}) ·{' '}
                          {selectedMapDevice.village}, {selectedMapDevice.district}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => setMapSelectedDeviceId(null)}
                        className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-[#52677A] flex items-center justify-center cursor-pointer"
                        title="Close popover"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold"
                        style={{
                          background: META[selectedMapDevice.status].bg,
                          color: META[selectedMapDevice.status].fg,
                        }}
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ background: META[selectedMapDevice.status].color }}
                        />
                        <span>{META[selectedMapDevice.status].label}</span>
                      </span>
                      <span className="text-xs text-[#52677A]">
                        {reasonOf(selectedMapDevice)}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-[#F1F5F9] p-2 rounded-xl flex flex-col">
                        <span className="text-[10px] text-[#52677A] font-semibold">DO LEVEL</span>
                        <b className="font-mono text-sm text-[#0B2440]">
                          {selectedMapDevice.doNow ? `${selectedMapDevice.doNow} ppm` : 'No sensor'}
                        </b>
                      </div>
                      <div className="bg-[#F1F5F9] p-2 rounded-xl flex flex-col">
                        <span className="text-[10px] text-[#52677A] font-semibold">RUN HOURS</span>
                        <b className="font-mono text-sm text-[#0B2440]">
                          {selectedMapDevice.hours.toLocaleString('en-IN')} h
                        </b>
                      </div>
                      <div className="bg-[#F1F5F9] p-2 rounded-xl flex flex-col">
                        <span className="text-[10px] text-[#52677A] font-semibold">MODE</span>
                        <b className="text-xs text-[#0B2440]">
                          {selectedMapDevice.hasDO ? 'Auto DO' : 'Manual'}
                        </b>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDevice(selectedMapDevice);
                          setRoute('devices');
                        }}
                        className="py-2 px-3 rounded-xl bg-[#0E6FA3] text-white font-bold text-xs hover:bg-[#0b5982] transition-colors flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>Open Details</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>

                      <a
                        href={`tel:${selectedMapDevice.phone}`}
                        className="py-2 px-3 rounded-xl bg-white border border-[#C9D6DE] text-[#0F2233] font-bold text-xs hover:bg-slate-50 transition-colors flex items-center justify-center gap-1"
                      >
                        <Phone className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Call</span>
                      </a>

                      <a
                        href={`https://maps.google.com/?q=${selectedMapDevice.lat},${selectedMapDevice.lon}`}
                        target="_blank"
                        rel="noreferrer"
                        className="py-2 px-3 rounded-xl bg-white border border-[#C9D6DE] text-[#0F2233] font-bold text-xs hover:bg-slate-50 transition-colors flex items-center justify-center gap-1"
                      >
                        <Compass className="w-3.5 h-3.5 text-sky-600" />
                        <span>Navigate</span>
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Reports & Location Tree Drilldown (4 or 5 cols on desktop) */}
              <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-3">
                {/* 1-Click Excel CSV Download Card */}
                <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <b className="text-sm font-bold text-[#0B2440]">Download Fleet Report</b>
                    <span className="text-xs text-[#52677A]">
                      {mapLevel === 'country' ? 'All India' : mapState}
                    </span>
                  </div>

                  <div
                    className={`items-center gap-1.5 py-0.5 ${
                      viewportMode === 'mobile' ? 'flex flex-wrap' : 'flex overflow-x-auto no-scrollbar'
                    }`}
                  >
                    {(['critical', 'maint', 'running', 'All'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setMapExportStatus(st)}
                        className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer whitespace-nowrap ${
                          mapExportStatus === st
                            ? 'bg-[#0B2440] text-white border-[#0B2440]'
                            : 'bg-[#F1F5F9] text-[#33475A] border-transparent hover:border-[#D3DFE9]'
                        }`}
                      >
                        {st === 'All' ? 'All Status' : META[st].label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDownloadCsv(mapExportStatus)}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#0E6FA3] hover:bg-[#0b5982] text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-xs cursor-pointer"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>Download CSV (Excel Compatible)</span>
                  </button>
                  <span className="text-[11px] text-[#52677A]">
                    Includes GPS coordinates, farmer details, run hours, DO levels, and warranty status.
                  </span>
                  <DataDownload fleet={fleet} />
                </div>

                {/* Sub-tabs: Location Breakdown vs Device List */}
                <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-3 flex-1">
                  <div className="flex items-center gap-1 bg-[#E3EBF1] p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setMapTab('loc')}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        mapTab === 'loc' ? 'bg-white text-[#0F2233] shadow-xs' : 'text-[#52677A]'
                      }`}
                    >
                      Location Tree
                    </button>
                    <button
                      type="button"
                      onClick={() => setMapTab('dev')}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        mapTab === 'dev' ? 'bg-white text-[#0F2233] shadow-xs' : 'text-[#52677A]'
                      }`}
                    >
                      Devices ({mapShown.length})
                    </button>
                  </div>

                  {mapTab === 'loc' ? (
                    <div className="flex flex-col divide-y divide-slate-100 max-h-[380px] overflow-y-auto no-scrollbar">
                      {/* India Root */}
                      <button
                        type="button"
                        onClick={() => {
                          setMapState('All');
                          setMapDist('All');
                          setMapSelectedDeviceId(null);
                        }}
                        className={`py-2 px-1 flex items-center justify-between text-xs font-bold text-left hover:bg-slate-50 transition-colors ${
                          mapState === 'All' ? 'text-[#0E6FA3]' : 'text-[#0F2233]'
                        }`}
                      >
                        <span>🇮🇳 All India</span>
                        <span className="font-mono text-[#52677A]">{fleet.length} Machines</span>
                      </button>

                      {/* States & Districts Hierarchy */}
                      {statesList.map((st) => {
                        const stDevices = fleet.filter((d) => d.state === st);
                        const isCurrentState = mapState === st;
                        const stDistricts = Array.from(
                          new Set(stDevices.map((d) => d.district))
                        );

                        return (
                          <div key={st} className="flex flex-col">
                            <button
                              type="button"
                              onClick={() => {
                                setMapState(st);
                                setMapDist('All');
                                setMapSelectedDeviceId(null);
                              }}
                              className={`py-2 pl-3 pr-1 flex items-center justify-between text-xs font-semibold text-left hover:bg-slate-50 transition-colors ${
                                isCurrentState ? 'text-[#0E6FA3] font-bold' : 'text-[#0F2233]'
                              }`}
                            >
                              <span>{st}</span>
                              <div className="flex items-center gap-1.5 font-mono text-[#52677A]">
                                <span>{stDevices.length}</span>
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              </div>
                            </button>

                            {/* Districts if state expanded */}
                            {isCurrentState &&
                              stDistricts.map((dt) => {
                                const dtDevices = stDevices.filter((d) => d.district === dt);
                                const isCurrentDist = mapDist === dt;
                                return (
                                  <button
                                    key={dt}
                                    type="button"
                                    onClick={() => {
                                      setMapDist(dt);
                                      setMapSelectedDeviceId(null);
                                    }}
                                    className={`py-1.5 pl-7 pr-1 flex items-center justify-between text-xs text-left hover:bg-slate-50 transition-colors ${
                                      isCurrentDist
                                        ? 'text-[#0E6FA3] font-bold'
                                        : 'text-[#52677A]'
                                    }`}
                                  >
                                    <span>{dt}</span>
                                    <span className="font-mono text-[11px]">
                                      {dtDevices.length}
                                    </span>
                                  </button>
                                );
                              })}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#52677A] font-semibold">Sort by:</span>
                        <select
                          value={mapSort}
                          onChange={(e) => setMapSort(e.target.value as any)}
                          className="h-7 px-2 rounded-lg border border-[#C9D6DE] text-xs font-bold text-[#0F2233]"
                        >
                          <option value="idle">Needs Attention</option>
                          <option value="district">District A–Z</option>
                          <option value="id">Device ID</option>
                          <option value="hours">Run Hours</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5 max-h-[340px] overflow-y-auto no-scrollbar">
                        {mapShown
                          .slice()
                          .sort((a, b) => {
                            if (mapSort === 'idle') return sortAttention(a, b);
                            if (mapSort === 'district') return a.district.localeCompare(b.district);
                            if (mapSort === 'id') return a.id.localeCompare(b.id);
                            return b.hours - a.hours;
                          })
                          .map((d) => {
                            const mm = META[d.status];
                            const isSelected = mapSelectedDeviceId === d.id;
                            return (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => {
                                  setMapSelectedDeviceId(d.id);
                                  setMapDist(d.district);
                                  setMapState(d.state);
                                }}
                                className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-left transition-all cursor-pointer ${
                                  isSelected
                                    ? 'bg-[#E3F3FB] border-[#7CC6EA]'
                                    : 'bg-white border-[#EEF2F5] hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ background: mm.color }}
                                  />
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-1.5">
                                      <b className="font-mono text-xs text-[#0B2440]">{d.id}</b>
                                      <span className="text-xs font-semibold text-[#0F2233]">
                                        · {d.pond}
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-[#52677A] truncate max-w-[170px]">
                                      {d.farmer} · {d.village}
                                    </span>
                                  </div>
                                </div>
                                <span
                                  className="text-xs font-bold shrink-0"
                                  style={{ color: mm.text }}
                                >
                                  {shortOf(d)}
                                </span>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: DEVICES FLEET & DETAIL VIEWS ── */}
        {route === 'devices' && (
          <div className="p-3 sm:p-5 flex flex-col gap-3.5 animate-in fade-in">
            {/* If Device Detail View is active */}
            {selectedDevice ? (
              <div className="flex flex-col gap-3.5">
                {/* Detail View Top Header */}
                <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedDevice(null)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0E6FA3] hover:underline cursor-pointer"
                    >
                      <span>← Back to Fleet</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <a
                        href={`tel:${selectedDevice.phone}`}
                        className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0B2440] text-xs font-bold flex items-center gap-1"
                      >
                        <Phone className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="hidden sm:inline">Call Farmer</span>
                      </a>
                      <a
                        href={`https://maps.google.com/?q=${selectedDevice.lat},${selectedDevice.lon}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0B2440] text-xs font-bold flex items-center gap-1"
                      >
                        <Compass className="w-3.5 h-3.5 text-sky-600" />
                        <span className="hidden sm:inline">Navigate</span>
                      </a>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <b className="font-mono text-xl text-[#0B2440]">{selectedDevice.id}</b>
                        <h2 className="text-lg font-black text-[#0F2233]">
                          {selectedDevice.pond}
                        </h2>
                      </div>
                      <span className="text-xs text-[#52677A]">
                        {selectedDevice.farmer} ({selectedDevice.business}) · {selectedDevice.village},{' '}
                        {selectedDevice.district}, {selectedDevice.state}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
                        style={{
                          background: META[selectedDevice.status].bg,
                          color: META[selectedDevice.status].fg,
                        }}
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ background: META[selectedDevice.status].color }}
                        />
                        <span>{META[selectedDevice.status].label}</span>
                      </span>
                      <span className="text-xs text-[#52677A]">
                        {reasonOf(selectedDevice)}
                      </span>
                    </div>
                  </div>

                  {/* Sibling Ponds Carousel */}
                  {Boolean(selectedDevice?.farmer) &&
                    fleet.filter((x) => x?.farmer && x.farmer === selectedDevice.farmer).length > 1 && (
                      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-2 border-t border-slate-100">
                        <span className="text-[11px] font-bold text-[#52677A] whitespace-nowrap">
                          Ponds by {selectedDevice.farmer}:
                        </span>
                        {fleet
                          .filter((x) => x?.farmer && x.farmer === selectedDevice.farmer)
                          .map((sib) => (
                            <button
                              key={sib.id}
                              type="button"
                              onClick={() => setSelectedDevice(sib)}
                              className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                                sib.id === selectedDevice.id
                                  ? 'bg-[#0B2440] text-white border-[#0B2440]'
                                  : 'bg-[#F1F5F9] text-[#33475A] border-transparent hover:border-[#D3DFE9]'
                            }`}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ background: META[sib.status].color }}
                            />
                            <span>{sib.pond}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <DataDownload key={selectedDevice.id} fleet={fleet} deviceId={selectedDevice.id} title="Download this pond's data" />

                {/* Sub-Tabs: Overview, Sensors, Service, Warranty, Activity (Wrapped on mobile so all 5 options are visible) */}
                <div
                  className={`p-1 bg-[#E3EBF1] rounded-2xl ${
                    viewportMode === 'mobile'
                      ? 'flex flex-wrap gap-1'
                      : 'flex flex-wrap sm:flex-nowrap items-center gap-1 overflow-x-auto no-scrollbar'
                  }`}
                >
                  {(
                    [
                      ['overview', 'Overview'],
                      ['sensors', 'Sensors'],
                      ['service', 'Service History'],
                      ['warranty', 'Warranty & AMC'],
                      ['activity', 'Activity Logs'],
                    ] as const
                  ).map(([tabKey, tabLabel]) => (
                    <button
                      key={tabKey}
                      type="button"
                      onClick={() => setDeviceDetailTab(tabKey)}
                      className={`${
                        viewportMode === 'mobile'
                          ? 'flex-1 min-w-[28%] py-2 text-xs font-bold rounded-xl text-center'
                          : 'flex-1 min-w-[100px] py-2 text-xs font-bold rounded-xl whitespace-nowrap'
                      } transition-all cursor-pointer ${
                        deviceDetailTab === tabKey
                          ? 'bg-white text-[#0F2233] shadow-xs'
                          : 'text-[#52677A] hover:text-[#0F2233]'
                      }`}
                    >
                      {tabLabel}
                    </button>
                  ))}
                </div>

                {/* TAB CONTENT: Overview */}
                {deviceDetailTab === 'overview' && (() => {
                  const raw = selectedDevice.rawTelemetry;
                  const isRunning = selectedDevice.status === 'running' || raw?.status === 'ON';
                  const isCoolingDown = Boolean(raw?.isCoolingDown);
                  const isCritical = selectedDevice.status === 'critical' || raw?.status === 'ERROR';

                  // Live running time calculation
                  const sessionSecs =
                    raw?.currentSessionSeconds !== undefined
                      ? raw.currentSessionSeconds
                      : (raw?.currentSessionMinutes || 0) * 60;
                  const runHours = Math.floor(sessionSecs / 3600);
                  const runMins = Math.floor((sessionSecs % 3600) / 60);
                  const runSecs = sessionSecs % 60;
                  const formattedRunTime = `${String(runHours).padStart(2, '0')}:${String(runMins).padStart(2, '0')}:${String(runSecs).padStart(2, '0')}`;

                  // Start Time formatted
                  let startTimeStr = 'Not started';
                  if (raw?.sessionStartedAt) {
                    try {
                      const stDate = new Date(raw.sessionStartedAt);
                      startTimeStr =
                        stDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
                        ' (' +
                        stDate.toLocaleDateString([], { day: '2-digit', month: 'short' }) +
                        ')';
                    } catch {
                      startTimeStr = raw.sessionStartedAt;
                    }
                  } else if (isRunning) {
                    startTimeStr = 'Active session';
                  }

                  // Stop / Last Updated Time & Idle duration calculation
                  let stopTimeStr = 'N/A';
                  let idleDurationStr = 'N/A';
                  const lastTs = raw?.updatedAt || raw?.lastSeen;
                  if (lastTs) {
                    try {
                      const spDate = new Date(lastTs);
                      stopTimeStr =
                        spDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
                        ' (' +
                        spDate.toLocaleDateString([], { day: '2-digit', month: 'short' }) +
                        ')';
                      if (!isRunning) {
                        const idleMs = Math.max(0, Date.now() - spDate.getTime());
                        const idleM = Math.floor(idleMs / 60000);
                        const idleH = Math.floor(idleM / 60);
                        const remM = idleM % 60;
                        idleDurationStr = idleH > 0 ? `${idleH}h ${remM}m` : `${remM}m`;
                      }
                    } catch {
                      stopTimeStr = lastTs;
                    }
                  } else if (!isRunning) {
                    stopTimeStr = 'Earlier today';
                    idleDurationStr = 'Standby mode';
                  }

                  // Last seen formatted
                  let lastSeenStr = 'Just now';
                  if (raw?.lastSeen || raw?.updatedAt) {
                    try {
                      const lsDate = new Date(raw?.lastSeen || raw?.updatedAt || '');
                      const diffSec = Math.floor((Date.now() - lsDate.getTime()) / 1000);
                      if (diffSec < 45) lastSeenStr = 'Just now (Live online)';
                      else if (diffSec < 3600) lastSeenStr = `${Math.floor(diffSec / 60)}m ago`;
                      else
                        lastSeenStr =
                          lsDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
                          ' · ' +
                          lsDate.toLocaleDateString([], { day: '2-digit', month: 'short' });
                    } catch {
                      lastSeenStr = 'Just now';
                    }
                  }

                  return (
                    <div className="flex flex-col gap-3.5">
                      {/* HERO CARD: Real-Time Machine Operational Status */}
                      <div className="bg-gradient-to-br from-[#0B2440] via-[#103860] to-[#0A2035] text-white p-4 sm:p-5 rounded-2xl border border-[#2A5584] shadow-md flex flex-col gap-4">
                        {/* Status Header Badge (Remote control disabled from admin; status clearly visible) */}
                        <div
                          className={`flex justify-between gap-3 border-b border-white/10 pb-3.5 ${
                            viewportMode === 'mobile'
                              ? 'flex-col items-start'
                              : 'flex-col sm:flex-row sm:items-center'
                          }`}
                        >
                          <div className="flex items-start sm:items-center gap-3 min-w-0">
                            <div
                              className={`w-3.5 h-3.5 rounded-full shrink-0 mt-1 sm:mt-0 ${
                                isRunning
                                  ? 'bg-emerald-400 ox-blink'
                                  : isCoolingDown
                                  ? 'bg-amber-400 ox-blink'
                                  : 'bg-slate-400'
                              }`}
                            />
                            <div className="flex flex-col gap-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-[#9DB8D0]">
                                  Machine Operational Status
                                </span>
                                <span
                                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-black tracking-wide uppercase whitespace-nowrap ${
                                    isRunning
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                      : isCoolingDown
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                      : isCritical
                                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                      : 'bg-slate-500/20 text-slate-300 border border-slate-500/40'
                                  }`}
                                >
                                  {isRunning
                                    ? 'MNBG - RUNNING (ON)'
                                    : isCoolingDown
                                    ? 'COOLDOWN REST (OFF)'
                                    : 'MNBG - STOPPED (OFF)'}
                                </span>
                              </div>
                              <span className="text-sm sm:text-base font-bold text-white truncate">
                                {selectedDevice.pond} ({selectedDevice.id}) · {selectedDevice.farmer}
                              </span>
                            </div>
                          </div>

                          {/* Machine Running / Stopped Status Badge (Disabled remote power toggle per user request) */}
                          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                            <span
                              className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-2 border select-none ${
                                isRunning
                                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/50'
                                  : isCoolingDown
                                  ? 'bg-amber-950/70 text-amber-300 border-amber-500/50'
                                  : 'bg-slate-900/70 text-slate-300 border-slate-600/50'
                              }`}
                              title="Machine power is controlled on-site by the farmer/operator (Remote control disabled from admin panel)"
                            >
                              {isRunning ? (
                                <>
                                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                                  <span>MACHINE IS RUNNING</span>
                                </>
                              ) : isCoolingDown ? (
                                <>
                                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                                  <span>COOLDOWN REST (OFF)</span>
                                </>
                              ) : (
                                <>
                                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                                  <span>MACHINE IS STOPPED</span>
                                </>
                              )}
                            </span>
                          </div>
                        </div>

                        {/* Operational Detail Metrics Grid */}
                        <div
                          className={`grid gap-2.5 sm:gap-3 ${
                            viewportMode === 'mobile'
                              ? 'grid-cols-2'
                              : 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-4'
                          }`}
                        >
                          {/* Card 1: Machine State & Ticking Running Time */}
                          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 sm:p-3 flex flex-col justify-between gap-1 min-w-0">
                            <span className="text-[11px] font-semibold text-[#9DB8D0] flex items-center gap-1">
                              <Timer className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                              <span className="truncate">{isRunning ? 'Current Run Time' : 'Machine State'}</span>
                            </span>
                            {isRunning ? (
                              <div className="flex flex-col min-w-0">
                                <b className="font-mono text-base sm:text-xl font-black text-emerald-400 tracking-wide truncate">
                                  {formattedRunTime}
                                </b>
                                <span className="text-[10px] text-emerald-300 font-medium truncate">
                                  Live Wall-Clock Ticking
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col min-w-0">
                                <b className="text-sm sm:text-base font-bold text-slate-200 truncate">
                                  IDLE / STANDBY
                                </b>
                                <span className="text-[10px] text-[#9DB8D0] truncate">
                                  {idleDurationStr !== 'N/A'
                                    ? `Idle for ${idleDurationStr}`
                                    : 'Standby mode'}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Card 2: Start Time / Stop Time */}
                          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 sm:p-3 flex flex-col justify-between gap-1 min-w-0">
                            <span className="text-[11px] font-semibold text-[#9DB8D0] flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span className="truncate">{isRunning ? 'Started At' : 'Stopped At'}</span>
                            </span>
                            <b
                              className="font-mono text-xs sm:text-sm font-bold text-white truncate"
                              title={isRunning ? startTimeStr : stopTimeStr}
                            >
                              {isRunning ? startTimeStr : stopTimeStr}
                            </b>
                            <span className="text-[10px] text-[#9DB8D0] truncate">
                              {isRunning
                                ? `Duration: ${Math.floor(sessionSecs / 60)} mins`
                                : `Idle: ${idleDurationStr}`}
                            </span>
                          </div>

                          {/* Card 3: Last Seen Time & Connectivity */}
                          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 sm:p-3 flex flex-col justify-between gap-1 min-w-0">
                            <span className="text-[11px] font-semibold text-[#9DB8D0] flex items-center gap-1">
                              <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span className="truncate">Machine Last Seen</span>
                            </span>
                            <b
                              className="text-xs sm:text-sm font-bold text-white truncate"
                              title={lastSeenStr}
                            >
                              {lastSeenStr}
                            </b>
                            <span className="text-[10px] text-[#9DB8D0] truncate">
                              Signal:{' '}
                              {raw?.gprsSignal !== undefined
                                ? `CSQ ${raw.gprsSignal}/31`
                                : 'Connected'}{' '}
                              · {raw?.isOnline !== false ? 'Live' : 'Offline'}
                            </span>
                          </div>

                          {/* Card 4: Total Cumulative Run Hours */}
                          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 sm:p-3 flex flex-col justify-between gap-1 min-w-0">
                            <span className="text-[11px] font-semibold text-[#9DB8D0] flex items-center gap-1">
                              <Zap className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                              <span className="truncate">Total Run Hours</span>
                            </span>
                            <b className="font-mono text-sm sm:text-base font-bold text-white truncate">
                              {(raw?.totalRunHours !== undefined
                                ? raw.totalRunHours
                                : selectedDevice.hours
                              ).toLocaleString('en-IN')}{' '}
                              hrs
                            </b>
                            <span className="text-[10px] text-[#9DB8D0] truncate">
                              Service: {raw?.maintenanceIntervalHours || 500} hrs
                            </span>
                          </div>
                        </div>

                        {/* Real-Time Live Telemetry Bar */}
                        <div
                          className={`bg-white/5 border border-white/10 rounded-xl p-3 text-xs ${
                            viewportMode === 'mobile'
                              ? 'grid grid-cols-2 gap-2.5'
                              : 'flex flex-wrap items-center justify-between gap-3'
                          }`}
                        >
                          {isSensorInstalled(raw, 'do') && (
                          <div className="flex flex-col min-w-0">
                            <span className="text-[11px] text-[#9DB8D0]">Dissolved Oxygen (DO)</span>
                            <b className="text-emerald-400 font-mono text-sm truncate">
                              {raw?.doLevel !== undefined && raw.doLevel >= 0
                                ? `${raw.doLevel.toFixed(1)} mg/L (ppm)`
                                : selectedDevice.doNow
                                ? `${selectedDevice.doNow} ppm`
                                : 'Sensor N/A'}
                              {raw?.targetDo && (
                                <span className="text-[10px] text-[#9DB8D0] font-normal ml-1">
                                  (Target: {raw.targetDo} ppm)
                                </span>
                              )}
                            </b>
                          </div>
                          )}

                          {isSensorInstalled(raw, 'temp') && (
                          <div className="flex flex-col min-w-0">
                            <span className="text-[11px] text-[#9DB8D0]">Water Temp</span>
                            <b className="text-sky-300 font-mono text-sm">
                              {typeof raw?.waterTemp === 'number' ? `${raw.waterTemp.toFixed(1)} °C` : 'No reading'}
                            </b>
                          </div>
                          )}

                          <div className="flex flex-col min-w-0">
                            <span className="text-[11px] text-[#9DB8D0]">Control Mode</span>
                            <b className="text-white text-xs truncate">
                              {raw?.autoMode ? 'Auto (DO Triggered)' : 'Manual (Local Operator)'}
                            </b>
                          </div>

                          <div className="flex flex-col min-w-0">
                            <span className="text-[11px] text-[#9DB8D0]">Relay Outputs</span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-[#9DB8D0]">MNBG:</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    isRunning
                                      ? 'bg-emerald-500/30 text-emerald-300'
                                      : 'bg-slate-600 text-slate-300'
                                  }`}
                                >
                                  {isRunning ? 'ON' : 'OFF'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-[#9DB8D0]">R2:</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    raw?.status2 === 'ON'
                                      ? 'bg-emerald-500/30 text-emerald-300'
                                      : 'bg-slate-600 text-slate-300'
                                  }`}
                                >
                                  {raw?.status2 || 'OFF'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ── CARD: SIMCom A7672S 4G LTE POND LOCATION & 1.0 KM GEOFENCE ANCHOR ── */}
                      {(() => {
                        const calLat = raw?.calibratedLatitude;
                        const calLng = raw?.calibratedLongitude;
                        const liveLat = raw?.latitude;
                        const liveLng = raw?.longitude;
                        const isCalibrated = Boolean(raw?.isCalibrated && calLat && calLng && Math.abs(calLat) > 0.01);
                        const csqVal = raw?.csq ?? raw?.gprsSignal ?? 0;
                        const signalPercent = Math.min(100, Math.round((csqVal / 31) * 100));
                        
                        let currentDistanceKm = raw?.moveDistanceKm ?? 0;
                        if (isCalibrated && liveLat && liveLng && Math.abs(liveLat) > 0.01) {
                          currentDistanceKm = calculateHaversineKm(calLat!, calLng!, liveLat, liveLng);
                        }
                        const isBreached = isCalibrated && (currentDistanceKm > 1.0 || raw?.isGeofenceBreached);

                        return (
                          <div className={`p-4 sm:p-5 rounded-2xl border shadow-sm flex flex-col gap-3.5 transition-all ${
                            isBreached
                              ? 'bg-gradient-to-br from-rose-50 via-white to-rose-50 border-rose-500 shadow-rose-100 ring-2 ring-rose-400'
                              : isCalibrated
                              ? 'bg-gradient-to-br from-sky-50/50 via-white to-emerald-50/30 border-[#DDE7EF]'
                              : 'bg-white border-[#DDE7EF]'
                          }`}>
                            {/* Card Top Header */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
                              <div className="flex items-center gap-2.5">
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                  isBreached
                                    ? 'bg-rose-600 text-white shadow-md animate-bounce'
                                    : isCalibrated
                                    ? 'bg-[#0E6FA3] text-white shadow-xs'
                                    : 'bg-slate-200 text-[#52677A]'
                                }`}>
                                  <Radio className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <h3 className="text-sm sm:text-base font-bold text-[#0B2440]">
                                      Pond Location &amp; 1.0 km Geofence
                                    </h3>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase bg-[#E3F3FB] text-[#0A4F75] border border-[#BFE2F3]">
                                      SIMCom A7672S 4G LTE
                                    </span>
                                  </div>
                                  <span className="text-xs text-[#52677A]">
                                    Pond ID: <b className="font-mono text-[#0B2440]">{selectedDevice.id}</b> · {selectedDevice.pond}
                                  </span>
                                </div>
                              </div>

                              {/* Geofence Status Badge */}
                              <div className="flex items-center gap-2 self-start sm:self-auto">
                                <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 border ${
                                  isBreached
                                    ? 'bg-rose-100 text-rose-800 border-rose-400 animate-pulse'
                                    : isCalibrated
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                    : 'bg-amber-100 text-amber-800 border-amber-300'
                                }`}>
                                  {isBreached ? (
                                    <>
                                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                                      <span>🚨 BREACHED ({currentDistanceKm.toFixed(2)} km &gt; 1.0 km)</span>
                                    </>
                                  ) : isCalibrated ? (
                                    <>
                                      <Lock className="w-3.5 h-3.5 text-emerald-700" />
                                      <span>🔒 Anchor Locked (Within 1.0 km Radius)</span>
                                    </>
                                  ) : (
                                    <>
                                      <Unlock className="w-3.5 h-3.5 text-amber-700" />
                                      <span>⚠️ Not Calibrated (Unanchored)</span>
                                    </>
                                  )}
                                </span>
                              </div>
                            </div>

                            {/* 4-Item Telemetry & Geofence Metric Grid */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                              {/* 1: 4G LTE Signal & Network */}
                              <div className="bg-[#F8FAFC] border border-[#E2E8F0] p-3 rounded-xl flex flex-col justify-between gap-1">
                                <span className="text-[11px] font-semibold text-[#64748B] flex items-center gap-1">
                                  <Radio className="w-3.5 h-3.5 text-sky-600" />
                                  <span>4G LTE Signal</span>
                                </span>
                                <div className="flex items-baseline gap-1.5">
                                  <b className="font-mono text-base font-black text-[#0F172A]">
                                    CSQ {csqVal}/31
                                  </b>
                                  <span className="text-xs font-bold text-sky-600">
                                    ({signalPercent}%)
                                  </span>
                                </div>
                                <span className="text-[10px] text-[#64748B] truncate">
                                  {raw?.networkType || '4G LTE Cat-1'} · {raw?.modemModel || 'SIMCom A7672S'}
                                </span>
                              </div>

                              {/* 2: Live GNSS / GPS Position */}
                              <div className="bg-[#F8FAFC] border border-[#E2E8F0] p-3 rounded-xl flex flex-col justify-between gap-1">
                                <span className="text-[11px] font-semibold text-[#64748B] flex items-center gap-1">
                                  <Compass className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>Live GNSS / GPS</span>
                                </span>
                                <b className="font-mono text-xs sm:text-sm font-bold text-[#0F172A] truncate" title={liveLat && liveLng ? `${liveLat.toFixed(6)}, ${liveLng.toFixed(6)}` : 'Searching...'}>
                                  {liveLat && liveLng && Math.abs(liveLat) > 0.01
                                    ? `${liveLat.toFixed(5)}, ${liveLng.toFixed(5)}`
                                    : 'Acquiring GPS fix...'}
                                </b>
                                <span className="text-[10px] text-[#64748B] truncate">
                                  {raw?.gpsFix ? '3D GPS Fixed' : 'Cell Tower LBS'} · {raw?.satellites !== undefined ? `${raw.satellites} Sats` : 'Fix Ready'}
                                </span>
                              </div>

                              {/* 3: Calibrated Pond Anchor */}
                              <div className="bg-[#F8FAFC] border border-[#E2E8F0] p-3 rounded-xl flex flex-col justify-between gap-1">
                                <span className="text-[11px] font-semibold text-[#64748B] flex items-center gap-1">
                                  <MapPin className="w-3.5 h-3.5 text-blue-600" />
                                  <span>Locked Pond Anchor</span>
                                </span>
                                <b className="font-mono text-xs sm:text-sm font-bold text-[#0F172A] truncate" title={calLat && calLng ? `${calLat.toFixed(6)}, ${calLng.toFixed(6)}` : 'No Anchor Set'}>
                                  {isCalibrated
                                    ? `${calLat!.toFixed(5)}, ${calLng!.toFixed(5)}`
                                    : 'No Anchor Set'}
                                </b>
                                <span className="text-[10px] text-[#64748B] truncate">
                                  {raw?.calibratedLocationName || 'Pond Anchor Location'}
                                </span>
                              </div>

                              {/* 4: Displacement vs 1.0 km Safety Radius */}
                              <div className={`border p-3 rounded-xl flex flex-col justify-between gap-1 ${
                                isBreached
                                  ? 'bg-rose-50 border-rose-300 text-rose-900'
                                  : 'bg-[#F8FAFC] border-[#E2E8F0]'
                              }`}>
                                <span className="text-[11px] font-semibold flex items-center gap-1">
                                  <AlertTriangle className={`w-3.5 h-3.5 ${isBreached ? 'text-rose-600' : 'text-amber-500'}`} />
                                  <span>Displacement / Radius</span>
                                </span>
                                <div className="flex items-baseline gap-1.5">
                                  <b className={`font-mono text-base font-black ${isBreached ? 'text-rose-700' : 'text-[#0F172A]'}`}>
                                    {isCalibrated ? `${currentDistanceKm.toFixed(3)} km` : '0.000 km'}
                                  </b>
                                  <span className="text-xs text-[#64748B]">/ 1.0 km</span>
                                </div>
                                <span className={`text-[10px] font-bold truncate ${isBreached ? 'text-rose-700' : 'text-emerald-700'}`}>
                                  {isBreached ? '🚨 EXCEEDED 1.0 KM RADIUS' : isCalibrated ? '✓ Inside 1.0 km perimeter' : 'Awaiting calibration'}
                                </span>
                              </div>
                            </div>

                            {/* Action Buttons: Detect / Calibrate / Search / Reset */}
                            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                              {/* 1: Detect from A7672S GPS */}
                              <button
                                type="button"
                                onClick={() => handleDetectFromDeviceGps(selectedDevice)}
                                disabled={calibratingDeviceId === selectedDevice.id}
                                className="px-3 py-2 bg-[#0E6FA3] hover:bg-[#0b5982] active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                                title="Lock coordinates directly from SIMCom A7672S live GPS fix"
                              >
                                <LocateFixed className="w-3.5 h-3.5" />
                                <span>🛰️ Detect from A7672S GPS</span>
                              </button>

                              {/* 2: Detect from Phone GPS */}
                              <button
                                type="button"
                                onClick={() => handleDetectFromPhoneGps(selectedDevice.id)}
                                disabled={calibratingDeviceId === selectedDevice.id}
                                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                                title="Calibrate and lock exact pond coordinates using current phone / browser GPS"
                              >
                                <Smartphone className={`w-3.5 h-3.5 ${calibratingDeviceId === selectedDevice.id ? 'animate-spin' : ''}`} />
                                <span>{calibratingDeviceId === selectedDevice.id ? 'Locating...' : '📱 Detect from Phone GPS'}</span>
                              </button>

                              {/* 3: Search / Input Coordinates */}
                              <button
                                type="button"
                                onClick={() => {
                                  setManualCalibrateModal({
                                    open: true,
                                    deviceId: selectedDevice.id,
                                    pondName: selectedDevice.pond,
                                    lat: String(calLat || liveLat || 16.711395),
                                    lng: String(calLng || liveLng || 81.464035),
                                    name: raw?.calibratedLocationName || `${selectedDevice.pond} Anchor`,
                                  });
                                }}
                                className="px-3 py-2 bg-white border border-[#C9D6DE] hover:bg-slate-50 active:scale-95 text-[#0F2233] font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                                title="Manually search or enter pond coordinates"
                              >
                                <Search className="w-3.5 h-3.5 text-[#52677A]" />
                                <span>🔍 Search / Input Coordinates</span>
                              </button>

                              {/* 4: Reset Anchor */}
                              {isCalibrated && (
                                <button
                                  type="button"
                                  onClick={() => handleResetPondCalibration(selectedDevice.id)}
                                  className="px-3 py-2 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
                                  title="Clear pond anchor and reset calibration"
                                >
                                  <Unlock className="w-3.5 h-3.5" />
                                  <span>Reset Anchor</span>
                                </button>
                              )}

                              {/* Toggle Map View */}
                              <button
                                type="button"
                                onClick={() => setShowLiveMapInDetail((prev) => !prev)}
                                className={`px-3 py-2 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer border ${
                                  showLiveMapInDetail
                                    ? 'bg-[#0B2440] text-white border-[#0B2440]'
                                    : 'bg-slate-100 text-[#33475A] border-slate-200 hover:bg-slate-200'
                                }`}
                              >
                                <Compass className="w-3.5 h-3.5" />
                                <span>{showLiveMapInDetail ? 'Hide Map' : '🗺️ View 1.0 km Geofence Map'}</span>
                              </button>
                            </div>

                            {/* Embedded Live GPRS Map with 1.0 km Radius Circle */}
                            {showLiveMapInDetail && (
                              <div className="mt-2 rounded-2xl overflow-hidden border border-[#DDE7EF] shadow-inner animate-in fade-in">
                                <LiveGprsMap
                                  device={raw || currentDevice}
                                  onCalibrateLocation={async (lat, lng, locName) => {
                                    await handleCalibratePondLocation(selectedDevice.id, lat, lng, locName);
                                  }}
                                  onResetCalibration={async () => {
                                    await handleResetPondCalibration(selectedDevice.id);
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* 2-Column Grid: Machine Specs + Warranty & Active Sensors */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-2">
                          <h3 className="text-sm font-bold text-[#0B2440] border-b border-slate-100 pb-2">
                            Machine Specifications &amp; Identity
                          </h3>
                          {[
                            ['Model', `Oxynity ${selectedDevice.model}`],
                            ['Capacity', selectedDevice.capacity],
                            ['Serial Number', selectedDevice.serial],
                            ['Commissioned On', fmtDate(selectedDevice.installed)],
                            ['Installed By', selectedDevice.installer],
                            ['Operating Mode', raw?.autoMode ? 'Auto (DO Trigger)' : 'Manual Remote'],
                            [
                              'Total Run Hours',
                              `${(raw?.totalRunHours !== undefined
                                ? raw.totalRunHours
                                : selectedDevice.hours
                              ).toLocaleString('en-IN')} h`,
                            ],
                            ['Firmware Version', raw?.firmwareVersion || selectedDevice.fw],
                            ['Assigned Technician', selectedDevice.tech],
                            ['Farmer Phone', selectedDevice.phone || 'Not recorded'],
                            ['Farmer Email', raw?.ownerEmail || 'Not recorded'],
                            ['Motor load', motorKwOf(raw) ? `${motorKwOf(raw).toFixed(2)} kW` : 'Not set'],
                            ['Power tariff', raw?.specs?.tariffPerKwh ? `₹${raw.specs.tariffPerKwh} / unit` : 'Not set'],
                          ].map(([lbl, val]) => (
                            <div
                              key={lbl}
                              className="flex justify-between py-1.5 text-xs border-b border-slate-50"
                            >
                              <span className="text-[#52677A]">{lbl}</span>
                              <b className="text-[#0F2233] text-right font-mono">{val}</b>
                            </div>
                          ))}
                          <MachineSpecsEditor device={raw} deviceId={selectedDevice.id} />
                        </div>

                        <div className="flex flex-col gap-3.5">
                          {/* Warranty Progress Card */}
                          <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                              <h3 className="text-sm font-bold text-[#0B2440]">Warranty Status</h3>
                              <span
                                className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                                style={{
                                  background: selectedDevice.wDays > 60 ? '#DCFCE7' : '#FEF3C7',
                                  color: selectedDevice.wDays > 60 ? '#14532D' : '#92400E',
                                }}
                              >
                                {selectedDevice.wDays > 60 ? 'Active' : 'Ending Soon'}
                              </span>
                            </div>
                            <span className="text-2xl font-mono font-bold text-[#0B2440]">
                              {selectedDevice.wDays > 0
                                ? `${selectedDevice.wDays} days left`
                                : 'Expired'}
                            </span>
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{
                                  width: `${Math.max(
                                    5,
                                    Math.min(100, Math.round((selectedDevice.wDays / 730) * 100))
                                  )}%`,
                                }}
                              />
                            </div>
                            <div className="flex justify-between text-[11px] text-[#52677A]">
                              <span>Start: {fmtDate(selectedDevice.installed)}</span>
                              <span>End: {fmtDate(selectedDevice.wEnd)}</span>
                            </div>
                          </div>

                          {/* Sensors Chip List */}
                          <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-2">
                            <h3 className="text-sm font-bold text-[#0B2440]">
                              Active Sensors &amp; Probes
                            </h3>
                            <div className="flex flex-wrap gap-1.5">
                              {[
                                {
                                  name: 'Dissolved Oxygen (DO)',
                                  on: isSensorInstalled(raw, 'do'),
                                },
                                {
                                  name: 'Water Temperature',
                                  on: isSensorInstalled(raw, 'temp'),
                                },
                                {
                                  name: 'pH Sensor',
                                  on: isSensorInstalled(raw, 'ph'),
                                },
                                {
                                  name: 'ORP Sensor',
                                  on: isSensorInstalled(raw, 'orp'),
                                },
                                {
                                  name: 'Salinity Sensor',
                                  on: isSensorInstalled(raw, 'sal'),
                                },
                              ].map((s) => (
                                <span
                                  key={s.name}
                                  className={`px-2.5 py-1 rounded-xl text-xs font-bold border ${
                                    s.on
                                      ? 'bg-[#E3F3FB] text-[#0A4F75] border-[#BFE2F3]'
                                      : 'bg-slate-50 text-[#6B7F90] border-dashed border-slate-200'
                                  }`}
                                >
                                  {s.name} {s.on ? '✓ Active' : '(Optional)'}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* TAB CONTENT: Sensors */}
                {deviceDetailTab === 'sensors' && (
                  <>
                  <InstalledSensorsEditor device={selectedDevice.rawTelemetry} deviceId={selectedDevice.id} />
                  <button type="button" onClick={() => setSensorSetupFor(selectedDevice.id)} className="ox-btn ox-btn-primary ox-btn-block mb-3.5">
                    Calibrate DO probe &amp; set pond location
                  </button>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {[
                      {
                        name: 'Dissolved Oxygen (DO)',
                        on: isSensorInstalled(selectedDevice.rawTelemetry, 'do'),
                        serial: `DO-5200-${selectedDevice.id}`,
                        cal: selectedDevice.rawTelemetry?.isDoCalibrated
                          ? 'Calibrated (Multi-point)'
                          : '15 Sep 2026',
                        reading:
                          selectedDevice.rawTelemetry?.doLevel !== undefined &&
                          selectedDevice.rawTelemetry.doLevel >= 0
                            ? `${selectedDevice.rawTelemetry.doLevel.toFixed(1)} ppm`
                            : `${selectedDevice.doNow || '6.8'} ppm`,
                        status:
                          selectedDevice.rawTelemetry?.doLevel !== undefined &&
                          selectedDevice.rawTelemetry.doLevel <
                            (selectedDevice.rawTelemetry.minDoAlert || 5.0)
                            ? `Low DO Alarm (< ${selectedDevice.rawTelemetry.minDoAlert || 5.0} ppm)`
                            : 'Optimal (5.0 - 9.0 ppm)',
                      },
                      {
                        name: 'Water Temperature',
                        on: isSensorInstalled(selectedDevice.rawTelemetry, 'temp'),
                        serial: `TMP-810-${selectedDevice.id}`,
                        cal: 'Factory Calibrated',
                        reading: selectedDevice.rawTelemetry?.waterTemp
                          ? `${selectedDevice.rawTelemetry.waterTemp.toFixed(1)} °C`
                          : '28.4 °C',
                        status: 'Normal Water Temp',
                      },
                      {
                        name: 'pH Sensor',
                        on: isSensorInstalled(selectedDevice.rawTelemetry, 'ph'),
                        serial:
                          selectedDevice.rawTelemetry?.phLevel &&
                          selectedDevice.rawTelemetry.phLevel > 0
                            ? `PH-900-${selectedDevice.id}`
                            : 'Slot Ready',
                        cal:
                          selectedDevice.rawTelemetry?.phLevel &&
                          selectedDevice.rawTelemetry.phLevel > 0
                            ? 'Calibrated'
                            : 'Not connected',
                        reading:
                          selectedDevice.rawTelemetry?.phLevel &&
                          selectedDevice.rawTelemetry.phLevel > 0
                            ? `${selectedDevice.rawTelemetry.phLevel.toFixed(1)} pH`
                            : 'Slot Available',
                        status:
                          selectedDevice.rawTelemetry?.phLevel &&
                          selectedDevice.rawTelemetry.phLevel > 0
                            ? 'Optimal (7.5 - 8.5)'
                            : 'Future Upgrade Ready',
                      },
                      {
                        name: 'ORP Sensor',
                        on: isSensorInstalled(selectedDevice.rawTelemetry, 'orp'),
                        serial:
                          selectedDevice.rawTelemetry?.orpLevel &&
                          selectedDevice.rawTelemetry.orpLevel > 0
                            ? `ORP-400-${selectedDevice.id}`
                            : 'Slot Ready',
                        cal:
                          selectedDevice.rawTelemetry?.orpLevel &&
                          selectedDevice.rawTelemetry.orpLevel > 0
                            ? 'Calibrated'
                            : 'Not connected',
                        reading:
                          selectedDevice.rawTelemetry?.orpLevel &&
                          selectedDevice.rawTelemetry.orpLevel > 0
                            ? `${selectedDevice.rawTelemetry.orpLevel} mV`
                            : 'Slot Available',
                        status:
                          selectedDevice.rawTelemetry?.orpLevel &&
                          selectedDevice.rawTelemetry.orpLevel > 0
                            ? 'Normal Redox Potential'
                            : 'Future Upgrade Ready',
                      },
                    ].map((s) => (
                      <div
                        key={s.name}
                        className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-2"
                      >
                        <div className="flex justify-between items-center">
                          <b className="text-sm font-bold text-[#0B2440]">{s.name}</b>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              s.on ? 'bg-[#DCFCE7] text-[#14532D]' : 'bg-slate-100 text-[#52677A]'
                            }`}
                          >
                            {s.on ? 'Fitted & Live' : 'Optional Slot'}
                          </span>
                        </div>
                        {s.on ? (
                          <>
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono text-2xl font-bold text-[#0B2440]">
                                {s.reading}
                              </span>
                              <span className="text-xs text-emerald-600 font-semibold">
                                {s.status}
                              </span>
                            </div>
                            <span className="text-xs text-[#52677A]">
                              Serial: {s.serial} · Last Calibrated: {s.cal}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-[#52677A]">
                            The controller board has dedicated ports ready to receive this sensor as an add-on.
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  </>
                )}

                {/* TAB CONTENT: Service History */}
                {deviceDetailTab === 'service' && (
                  <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-3">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                      <b className="text-sm font-bold text-[#0B2440]">
                        Service Log ({selectedDevice.svc.length} records)
                      </b>
                      <button
                        type="button"
                        onClick={() => showToast('Service record form opens here')}
                        className="px-3 py-1.5 rounded-xl bg-[#0E6FA3] text-white text-xs font-bold hover:bg-[#0b5982] cursor-pointer"
                      >
                        + Add Service Record
                      </button>
                    </div>

                    <div className="flex flex-col gap-3 pl-4 border-l-2 border-[#DDE7EF] ml-2">
                      {selectedDevice.svc.map((s, idx) => (
                        <div key={idx} className="relative flex flex-col gap-0.5">
                          <div className="absolute -left-[23px] top-1 w-3 h-3 rounded-full bg-[#0E6FA3] border-2 border-white" />
                          <div className="flex items-center justify-between text-xs">
                            <b className="text-[#0F2233]">{s.title}</b>
                            <span className="font-mono text-[#52677A]">{fmtDate(s.dt)}</span>
                          </div>
                          <span className="text-[11px] text-[#52677A]">Technician: {s.by}</span>
                          {s.note && <span className="text-xs text-[#33475A]">{s.note}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: Warranty & AMC */}
                {deviceDetailTab === 'warranty' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-3">
                      <h3 className="text-sm font-bold text-[#0B2440]">Annual Maintenance Contract</h3>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[#52677A]">AMC Status</span>
                        <b className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                          {selectedDevice.amc === 'active'
                            ? `Active till ${selectedDevice.amcEnd}`
                            : 'Standard Warranty'}
                        </b>
                      </div>
                      <button
                        type="button"
                        onClick={() => showToast('AMC renewal notice sent to farmer')}
                        className="py-2 px-3 rounded-xl bg-[#0E6FA3] text-white font-bold text-xs hover:bg-[#0b5982] transition-colors"
                      >
                        Send AMC Renewal Proposal
                      </button>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-2">
                      <h3 className="text-sm font-bold text-[#0B2440]">Machine Documents</h3>
                      {[
                        ['Tax Invoice', 'Original Sales Record'],
                        ['Warranty Certificate', '2-Year Official Protection'],
                        ['Commissioning Signoff', 'Farmer & Technician Handover'],
                      ].map(([docTitle, docDesc]) => (
                        <div
                          key={docTitle}
                          className="flex justify-between items-center py-2 border-b border-slate-50 text-xs"
                        >
                          <div className="flex flex-col">
                            <b className="text-[#0F2233]">{docTitle}</b>
                            <span className="text-[10px] text-[#52677A]">{docDesc}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => showToast(`Document "${docTitle}" ready to view`)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold cursor-pointer"
                          >
                            View
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: Activity Logs */}
                {deviceDetailTab === 'activity' && (() => {
                  const raw = selectedDevice.rawTelemetry;
                  const isRunning = selectedDevice.status === 'running' || raw?.status === 'ON';
                  const logs = [
                    {
                      time: raw?.updatedAt
                        ? new Date(raw.updatedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Live',
                      desc: isRunning
                        ? `MNBG Micro-Nano Bubble Aeration active · Run time: ${
                            raw?.currentSessionMinutes || 0
                          } mins`
                        : `MNBG in standby · Stopped / ready for dispatch`,
                      color: isRunning ? '#22C55E' : '#94A3B8',
                    },
                    {
                      time: raw?.sessionStartedAt
                        ? new Date(raw.sessionStartedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Earlier',
                      desc: isRunning
                        ? `Generator started session at ${
                            raw?.sessionStartedAt
                              ? new Date(raw.sessionStartedAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : 'earlier'
                          }`
                        : `Last telemetry sync verified from SIMCom A7672S 4G LTE`,
                      color: '#0E6FA3',
                    },
                    {
                      time: raw?.lastSeen
                        ? new Date(raw.lastSeen).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Today',
                      desc: `Cellular LBS Heartbeat verified · Lat: ${selectedDevice.lat.toFixed(
                        4
                      )}, Lon: ${selectedDevice.lon.toFixed(4)}`,
                      color: '#0E6FA3',
                    },
                    {
                      time: 'Auto-Mode',
                      desc: raw?.autoMode
                        ? `Automated DO Control Active (Trigger < ${raw.minDoAlert || 5.0} ppm)`
                        : 'Manual Operating Mode active',
                      color: raw?.autoMode ? '#22C55E' : '#64748B',
                    },
                  ];

                  return (
                    <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-2">
                      <h3 className="text-sm font-bold text-[#0B2440] border-b border-slate-100 pb-2">
                        Live Telemetry &amp; Controller Actions
                      </h3>
                      {logs.map((log, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2.5 py-1.5 border-b border-slate-50 text-xs"
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: log.color }}
                          />
                          <span className="text-[#0F2233] flex-1">{log.desc}</span>
                          <span className="font-mono text-[#52677A] text-[11px] shrink-0">
                            {log.time}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            ) : (
              // Fleet Listing View
              <div className="flex flex-col gap-3.5">
                <DataDownload fleet={fleet} title="Download data (pumps, sensors, GPS)" />
                {/* Search & Grouping Controls */}
                <div
                  className={`flex ${
                    viewportMode === 'mobile'
                      ? 'flex-col'
                      : 'flex-col sm:flex-row sm:items-center'
                  } justify-between gap-2.5 bg-white p-3 rounded-2xl border border-[#DDE7EF] shadow-xs`}
                >
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-[#9DB8D0] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search farmer, device ID, pond, village..."
                      className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#C9D6DE] text-xs font-semibold text-[#0F2233] bg-[#F8FAFC] focus:bg-white focus:outline-none focus:border-[#0E6FA3]"
                    />
                  </div>

                  {/* Group By Selector */}
                  <div
                    className={`flex items-center gap-1.5 bg-[#E3EBF1] p-1 rounded-xl text-xs font-bold ${
                      viewportMode === 'mobile'
                        ? 'w-full justify-between'
                        : 'overflow-x-auto no-scrollbar'
                    }`}
                  >
                    <span className="text-[11px] text-[#52677A] px-2 hidden sm:inline">Group:</span>
                    {(
                      [
                        ['farmer', 'Farmer'],
                        ['place', 'District'],
                        ['status', 'Status'],
                        ['none', 'None'],
                      ] as const
                    ).map(([gId, gLabel]) => (
                      <button
                        key={gId}
                        type="button"
                        onClick={() => {
                          setGroupBy(gId);
                          setOpenGroups({});
                        }}
                        className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                          viewportMode === 'mobile' ? 'flex-1 text-center' : ''
                        } ${
                          groupBy === gId ? 'bg-white text-[#0F2233] shadow-xs' : 'text-[#52677A]'
                        }`}
                      >
                        {gLabel}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Status Chips Filter */}
                <div
                  className={`flex ${
                    viewportMode === 'mobile'
                      ? 'flex-col gap-2'
                      : 'flex-col sm:flex-row sm:items-center justify-between gap-2'
                  }`}
                >
                  <div
                    className={`items-center gap-1.5 py-1 w-full min-w-0 ${
                      viewportMode === 'mobile'
                        ? 'flex flex-wrap'
                        : 'flex overflow-x-auto no-scrollbar'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setDeviceStatusFilter('All')}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                        deviceStatusFilter === 'All'
                          ? 'bg-[#0B2440] text-white border-[#0B2440]'
                          : 'bg-white text-[#33475A] border-[#D3DFE9]'
                      }`}
                    >
                      All ({fleet.length})
                    </button>
                    {STATUS_ORDER.map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setDeviceStatusFilter(st)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                          deviceStatusFilter === st
                            ? 'bg-[#0B2440] text-white border-[#0B2440]'
                            : 'bg-white text-[#33475A] border-[#D3DFE9]'
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ background: META[st].color }}
                        />
                        <span>
                          {META[st].label} ({fleet.filter((d) => d.status === st).length})
                        </span>
                      </button>
                    ))}
                  </div>

                  {groupBy !== 'none' && (
                    <div
                      className={
                        viewportMode === 'mobile' ? 'flex justify-end w-full' : 'shrink-0'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => {
                          const allKeys = Object.keys(deviceGroups);
                          const allOpen = allKeys.every((k) => openGroups[k]);
                          const updated: Record<string, boolean> = {};
                          if (!allOpen) allKeys.forEach((k) => (updated[k] = true));
                          setOpenGroups(updated);
                        }}
                        className="text-xs font-bold text-[#0E6FA3] hover:underline whitespace-nowrap cursor-pointer"
                      >
                        {Object.keys(deviceGroups).every((k) => openGroups[k])
                          ? 'Collapse All'
                          : 'Expand All'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Device Group Cards */}
                <div className="flex flex-col gap-3">
                  {fleet.length === 0 ? (
                    <div className="bg-white p-6 rounded-2xl border border-[#DDE7EF] shadow-xs text-center flex flex-col items-center gap-2">
                      <span className="text-sm font-bold text-[#0B2440]">
                        No Devices Found in Firebase
                      </span>
                      <span className="text-xs text-[#52677A]">
                        Connected ESP32 microcontrollers and registered ponds will appear here live.
                      </span>
                    </div>
                  ) : Object.keys(deviceGroups).length === 0 ? (
                    <div className="bg-white p-6 rounded-2xl border border-[#DDE7EF] shadow-xs text-center flex flex-col items-center gap-2">
                      <span className="text-sm font-bold text-[#0B2440]">
                        No matching devices found
                      </span>
                      <span className="text-xs text-[#52677A]">
                        Try clearing your search query or status filter.
                      </span>
                    </div>
                  ) : null}
                  {(Object.entries(deviceGroups) as [string, AdminDeviceRecord[]][]).map(([groupName, groupDevs]) => {
                    const isOpen = Boolean(openGroups[groupName] || searchQuery.trim() !== '');
                    const cc = countBy(groupDevs);
                    const total = groupDevs.length;
                    const alertCount = cc.critical + cc.maint;

                    return (
                      <div
                        key={groupName}
                        className="bg-white rounded-2xl border border-[#DDE7EF] shadow-xs overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }))
                          }
                          className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-[#E3F3FB] text-[#0A4F75] font-black text-xs flex items-center justify-center shrink-0">
                              {groupName.substring(0, 2).toUpperCase()}
                            </div>
                            <div className="flex flex-col">
                              <b className="text-sm text-[#0F2233]">{groupName}</b>
                              <span className="text-xs text-[#52677A]">
                                {total} {total === 1 ? 'Machine' : 'Machines'} · {groupDevs[0]?.village}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {alertCount > 0 && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEE2E2] text-[#7F1D1D]">
                                {alertCount} Needs Attention
                              </span>
                            )}
                            <ChevronDown
                              className={`w-4 h-4 text-[#52677A] transition-transform duration-200 ${
                                isOpen ? 'rotate-180' : ''
                              }`}
                            />
                          </div>
                        </button>

                        {/* Expandable Group Body */}
                        {isOpen && (
                          <div className="p-3 pt-0 border-t border-slate-100 flex flex-col gap-2">
                            {groupDevs.sort(sortAttention).map((d) => {
                              const mm = META[d.status];
                              return (
                                <button
                                  key={d.id}
                                  type="button"
                                  onClick={() => setSelectedDevice(d)}
                                  className="p-3 rounded-xl border border-[#EEF2F5] hover:border-[#7CC6EA] hover:bg-[#E3F3FB]/40 flex items-center justify-between gap-2 text-left transition-all cursor-pointer"
                                >
                                  <div className="flex items-center gap-2.5">
                                    <span
                                      className="w-2.5 h-2.5 rounded-full shrink-0"
                                      style={{ background: mm.color }}
                                    />
                                    <div className="flex flex-col">
                                      <div className="flex items-center gap-1.5">
                                        <b className="text-xs text-[#0F2233]">{d.pond}</b>
                                        <span className="font-mono text-[11px] text-[#52677A]">
                                          ({d.id})
                                        </span>
                                      </div>
                                      <span className="text-[11px] text-[#52677A]">
                                        {d.model} · {d.village} · {reasonOf(d)}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex flex-col items-end shrink-0">
                                    <span className="text-xs font-bold" style={{ color: mm.text }}>
                                      {shortOf(d)}
                                    </span>
                                    {d.wDays >= 0 && d.wDays <= 60 && (
                                      <span className="text-[10px] text-amber-700 font-semibold">
                                        Warranty {d.wDays}d
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: COMPLAINTS WORKFLOW ── */}
        {route === 'complaints' && (
          <div className="p-3 sm:p-5 flex flex-col gap-3.5 animate-in fade-in">
            {/* Top Stat Summary Counters */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="bg-[#133559] text-white p-3 rounded-2xl flex flex-col">
                <span className="text-[10px] text-[#9DB8D0] font-bold uppercase">OPEN</span>
                <b className="text-xl font-mono">
                  {complaints.filter((c) => c.stage < 3).length}
                </b>
              </div>
              <div className="bg-[#133559] text-white p-3 rounded-2xl flex flex-col">
                <span className="text-[10px] text-rose-300 font-bold uppercase">HIGH PRIORITY</span>
                <b className="text-xl font-mono text-rose-400">
                  {complaints.filter((c) => c.priority === 'High' && c.stage < 3).length}
                </b>
              </div>
              <div className="bg-[#133559] text-white p-3 rounded-2xl flex flex-col">
                <span className="text-[10px] text-emerald-300 font-bold uppercase">RESOLVED</span>
                <b className="text-xl font-mono text-emerald-400">
                  {complaints.filter((c) => c.stage === 3).length}
                </b>
              </div>
            </div>

            {/* Stages Tab Controller */}
            <div className="flex items-center gap-1 bg-[#E3EBF1] p-1 rounded-2xl">
              {(['New', 'Assigned', 'Working', 'Done'] as const).map((stageLabel, idx) => {
                const count = complaints.filter((c) => c.stage === idx).length;
                return (
                  <button
                    key={stageLabel}
                    type="button"
                    onClick={() => setComplaintStage(idx)}
                    className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex flex-col items-center leading-none gap-1 ${
                      complaintStage === idx
                        ? 'bg-white text-[#0F2233] shadow-xs'
                        : 'text-[#52677A]'
                    }`}
                  >
                    <span>{stageLabel}</span>
                    <span className="font-mono text-[11px] opacity-75">({count})</span>
                  </button>
                );
              })}
            </div>

            {/* Action Bar: Log New Complaint */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-[#52677A] font-semibold">
                Showing {['New Unassigned', 'Assigned', 'In Progress', 'Resolved'][complaintStage]} Complaints
              </span>
              <button
                type="button"
                onClick={() => setShowNewComplaintModal(true)}
                className="py-1.5 px-3 rounded-xl bg-[#0E6FA3] text-white text-xs font-bold hover:bg-[#0b5982] flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Ticket</span>
              </button>
            </div>

            {/* Complaint Cards List */}
            <div className="flex flex-col gap-3">
              {complaints
                .filter((c) => c.stage === complaintStage)
                .map((cmp) => {
                  const isOpen = openedComplaintId === cmp.id;
                  const isHigh = cmp.priority === 'High';
                  return (
                    <div
                      key={cmp.id}
                      className={`bg-white rounded-2xl border p-4 shadow-xs flex flex-col gap-2.5 transition-all ${
                        isHigh ? 'border-l-4 border-l-rose-500 border-[#F5C2C2]' : 'border-[#DDE7EF]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenedComplaintId((prev) => (prev === cmp.id ? null : cmp.id))
                        }
                        className="flex flex-col gap-1 text-left cursor-pointer w-full"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs text-[#52677A]">
                            {cmp.id} · {cmp.age}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              cmp.priority === 'High'
                                ? 'bg-[#FEE2E2] text-[#7F1D1D]'
                                : cmp.priority === 'Medium'
                                ? 'bg-[#FEF9C3] text-[#713F12]'
                                : 'bg-[#EEF2F5] text-[#33475A]'
                            }`}
                          >
                            {cmp.priority}
                          </span>
                        </div>
                        <b className="text-sm text-[#0F2233]">{cmp.issue}</b>
                        <span className="text-xs text-[#52677A]">
                          {cmp.device} · {cmp.farmer} · {cmp.place}
                        </span>
                      </button>

                      {/* Card Expand Details */}
                      {isOpen && (
                        <div className="pt-2 border-t border-slate-100 flex flex-col gap-2.5 animate-in fade-in">
                          <div className="flex items-center justify-between text-xs text-[#52677A]">
                            <span>
                              <b>Assigned Technician:</b> {cmp.tech}
                            </span>
                            <span>
                              <b>Source:</b> {cmp.source}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleAdvanceComplaint(cmp.id)}
                              className="py-2 px-3 rounded-xl bg-[#0E6FA3] text-white font-bold text-xs hover:bg-[#0b5982] cursor-pointer"
                            >
                              {['Assign', 'Start Work', 'Resolve', 'Reopen'][cmp.stage]}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                const target = fleet.find((d) => d.id === cmp.device);
                                if (target) {
                                  setSelectedDevice(target);
                                  setRoute('devices');
                                }
                              }}
                              className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0F2233] font-bold text-xs cursor-pointer text-center"
                            >
                              Open Machine
                            </button>

                            <a
                              href={`tel:${fleet.find((d) => d.id === cmp.device)?.phone || ''}`}
                              className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0F2233] font-bold text-xs flex items-center justify-center gap-1"
                            >
                              <Phone className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Call Farmer</span>
                            </a>
                          </div>

                          {/* ── Two-Way Customer Live Chat Panel ── */}
                          <div className="mt-2 pt-2.5 border-t border-slate-100 flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-xs font-bold text-[#0B2440]">
                                <MessageSquare className="w-3.5 h-3.5 text-[#0E6FA3]" />
                                <span>Two-Way Farmer Live Chat</span>
                                {Array.isArray(cmp.messages) && cmp.messages.length > 0 && (
                                  <span className="px-1.5 py-0.2 rounded-full bg-sky-100 text-sky-700 text-[10px] font-extrabold">
                                    {cmp.messages.length}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Real-Time Connected
                              </span>
                            </div>

                            {/* Chat Messages Stream */}
                            <div className="bg-[#F8FAFC] rounded-xl p-2.5 max-h-48 overflow-y-auto flex flex-col gap-2 border border-slate-200">
                              {Array.isArray(cmp.messages) && cmp.messages.length > 0 ? (
                                cmp.messages.map((m: any, mIdx: number) => {
                                  const isAdmin = m.sender === 'admin';
                                  return (
                                    <div
                                      key={m.id || mIdx}
                                      className={`flex flex-col max-w-[85%] ${
                                        isAdmin ? 'self-end items-end' : 'self-start items-start'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1 mb-0.5">
                                        <span className="text-[9.5px] font-bold text-[#52677A]">
                                          {isAdmin ? 'Admin (You)' : m.senderName || cmp.farmer}
                                        </span>
                                        <span className="text-[9px] text-[#94A3B8]">
                                          {m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                        </span>
                                      </div>
                                      <div
                                        className={`p-2 rounded-xl text-xs font-medium leading-relaxed break-words shadow-2xs ${
                                          isAdmin
                                            ? 'bg-[#0E6FA3] text-white rounded-tr-xs'
                                            : 'bg-white text-[#0F2233] border border-slate-200 rounded-tl-xs'
                                        }`}
                                      >
                                        {m.text}
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="py-4 text-center text-xs text-slate-400">
                                  No conversation messages yet. Send a reply below to reach the customer directly on their app.
                                </div>
                              )}
                            </div>

                            {/* Reply Box */}
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                handleSendAdminReply(cmp.id);
                              }}
                              className="flex items-center gap-1.5"
                            >
                              <input
                                type="text"
                                placeholder={`Reply to ${cmp.farmer || 'farmer'}...`}
                                value={adminChatReply}
                                onChange={(e) => setAdminChatReply(e.target.value)}
                                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-[#0F2233] focus:outline-hidden focus:ring-1 focus:ring-[#0E6FA3]"
                              />
                              <button
                                type="submit"
                                disabled={isSendingChat || !adminChatReply.trim()}
                                className="px-3.5 py-2 rounded-xl bg-[#0E6FA3] text-white text-xs font-bold hover:bg-[#0b5982] disabled:opacity-50 flex items-center gap-1 cursor-pointer transition-all shrink-0"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>Reply</span>
                              </button>
                            </form>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* Modal: Log New Complaint */}
            {showNewComplaintModal && (
              <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
                <form
                  onSubmit={handleSaveComplaint}
                  className="bg-white rounded-2xl p-5 border border-[#DDE7EF] shadow-2xl w-full max-w-md flex flex-col gap-3"
                >
                  <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                    <b className="text-base text-[#0B2440]">Log New Ticket</b>
                    <button
                      type="button"
                      onClick={() => setShowNewComplaintModal(false)}
                      className="text-[#52677A] hover:text-[#0F2233] cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <label className="flex flex-col gap-1 text-xs font-bold text-[#52677A]">
                    Select Pond / Machine
                    <select
                      value={newComplaintDevice}
                      onChange={(e) => setNewComplaintDevice(e.target.value)}
                      className="h-10 px-3 rounded-xl border border-[#C9D6DE] text-xs font-semibold text-[#0F2233]"
                    >
                      {fleet.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.id} · {d.pond} ({d.farmer})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-xs font-bold text-[#52677A]">
                    Reported Issue
                    <select
                      value={newComplaintIssue}
                      onChange={(e) => setNewComplaintIssue(e.target.value)}
                      className="h-10 px-3 rounded-xl border border-[#C9D6DE] text-xs font-semibold text-[#0F2233]"
                    >
                      <option>Not starting</option>
                      <option>Low bubble output</option>
                      <option>Water leak at mixer</option>
                      <option>DO reading stuck / inaccurate</option>
                      <option>Pump motor noise</option>
                      <option>Controller power cut</option>
                      <option>Mobile app telemetry offline</option>
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-xs font-bold text-[#52677A]">
                      Priority
                      <select
                        value={newComplaintPriority}
                        onChange={(e) => setNewComplaintPriority(e.target.value as any)}
                        className="h-10 px-3 rounded-xl border border-[#C9D6DE] text-xs font-semibold text-[#0F2233]"
                      >
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                      </select>
                    </label>

                    <label className="flex flex-col gap-1 text-xs font-bold text-[#52677A]">
                      Intake Channel
                      <select
                        value={newComplaintSource}
                        onChange={(e) => setNewComplaintSource(e.target.value)}
                        className="h-10 px-3 rounded-xl border border-[#C9D6DE] text-xs font-semibold text-[#0F2233]"
                      >
                        <option>Phone call</option>
                        <option>Farmer app</option>
                        <option>Field Technician</option>
                        <option>Automated Sensor Alert</option>
                      </select>
                    </label>
                  </div>

                  <label className="flex flex-col gap-1 text-xs font-bold text-[#52677A]">
                    Notes / Description
                    <textarea
                      rows={2}
                      value={newComplaintNotes}
                      onChange={(e) => setNewComplaintNotes(e.target.value)}
                      placeholder="Enter details from farmer..."
                      className="p-2.5 rounded-xl border border-[#C9D6DE] text-xs text-[#0F2233]"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowNewComplaintModal(false)}
                      className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0F2233] text-xs font-bold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="py-2.5 rounded-xl bg-[#0B2440] hover:bg-[#133559] text-white text-xs font-bold cursor-pointer"
                    >
                      Save Ticket
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 4: TECHNICIAN SERVICE PORTAL ── */}
        {route === 'service' && (
          <div className="p-3 sm:p-5 flex flex-col gap-3.5 animate-in fade-in">
            {/* Tech Selector & Daily Progress Bar */}
            <div className="bg-[#0B2440] text-white p-4 rounded-2xl shadow-xs flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-xs text-[#9DB8D0]">Field Technician Route</span>
                  <b className="text-base text-white">{selectedTech}</b>
                </div>

                <select
                  value={selectedTech}
                  onChange={(e) => setSelectedTech(e.target.value)}
                  className="h-8 px-2.5 rounded-xl border border-[#2A5584] bg-[#133559] text-white text-xs font-bold cursor-pointer"
                >
                  {['Suresh', 'Ravi', 'Kiran'].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Progress Bar */}
              {(() => {
                const techJobs = jobs.filter((j) => j.tech === selectedTech);
                const doneCount = techJobs.filter((j) => j.prog === 2).length;
                const pctDone = techJobs.length ? Math.round((doneCount / techJobs.length) * 100) : 0;
                return (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs text-[#9DB8D0]">
                      <span>Today's Schedule</span>
                      <b className="text-emerald-400">
                        {doneCount} of {techJobs.length} Completed ({pctDone}%)
                      </b>
                    </div>
                    <div className="w-full h-2 bg-[#1D4470] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 rounded-full transition-all duration-300"
                        style={{ width: `${pctDone}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Desktop 2-Column: Today's Jobs on Left, Upcoming Maintenance on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Today's Jobs List */}
              <div className="flex flex-col gap-2.5">
                <b className="text-sm font-bold text-[#0B2440]">Assigned Route Jobs</b>
                {jobs
                  .filter((j) => j.tech === selectedTech)
                  .map((j, idx) => {
                    const devItem = fleet.find((d) => d.id === j.device) || (fleet.length > 0 ? fleet[0] : undefined);
                    const stBadge = [
                      ['Next', '#A16207', '#FEF9C3'],
                      ['On Site', '#0E6FA3', '#E3F3FB'],
                      ['Completed', '#15803D', '#DCFCE7'],
                    ][j.prog];

                    return (
                      <div
                        key={j.id}
                        className={`bg-white rounded-2xl border p-4 shadow-xs flex flex-col gap-2.5 transition-all ${
                          j.prog === 1 ? 'border-2 border-[#0E6FA3]' : 'border-[#DDE7EF]'
                        } ${j.prog === 2 ? 'opacity-70' : ''}`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="w-7 h-7 rounded-full font-bold text-xs flex items-center justify-center shrink-0"
                            style={{ background: stBadge[2], color: stBadge[1] }}
                          >
                            {idx + 1}
                          </div>
                          <div className="flex flex-col flex-1">
                            <div className="flex justify-between items-center">
                              <b className="text-sm text-[#0F2233]">{j.job}</b>
                              <span
                                className="text-xs font-bold px-2 py-0.5 rounded-full"
                                style={{ background: stBadge[2], color: stBadge[1] }}
                              >
                                {stBadge[0]}
                              </span>
                            </div>
                            <span className="text-xs text-[#52677A]">
                              {devItem
                                ? `${devItem.id} · ${devItem.pond} (${devItem.farmer || 'Farmer Operator'}) · ${devItem.village}`
                                : `${j.device} · Assigned Device`}
                            </span>
                            <span className="text-xs text-[#33475A] font-semibold mt-1">
                              {j.why}
                            </span>
                          </div>
                        </div>

                        {j.prog < 2 && (
                          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => handleAdvanceJob(j.id)}
                              className="py-2 px-3 rounded-xl bg-[#0E6FA3] text-white font-bold text-xs hover:bg-[#0b5982] cursor-pointer"
                            >
                              {j.prog === 0 ? 'Start Job' : 'Mark Done'}
                            </button>
                            <a
                              href={`https://maps.google.com/?q=${devItem.lat},${devItem.lon}`}
                              target="_blank"
                              rel="noreferrer"
                              className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0F2233] font-bold text-xs flex items-center justify-center gap-1"
                            >
                              <Compass className="w-3.5 h-3.5 text-sky-600" />
                              <span>Route</span>
                            </a>
                            <a
                              href={`tel:${devItem.phone}`}
                              className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0F2233] font-bold text-xs flex items-center justify-center gap-1"
                            >
                              <Phone className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Call</span>
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>

              {/* Maintenance Rules & Upcoming Cleaning Thresholds */}
              <div className="flex flex-col gap-3.5">
                <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-2.5">
                  <b className="text-sm font-bold text-[#0B2440]">
                    Next Ultrasonic Mixer Cleaning
                  </b>
                  <span className="text-xs text-[#52677A]">
                    Due every 2,000 run hours. Track upcoming service cycles.
                  </span>

                  <div className="flex flex-col divide-y divide-slate-100">
                    {fleet
                      .filter((d) => d.tech === selectedTech)
                      .map((d) => {
                        const nextAt = (Math.floor(d.hours / 2000) + 1) * 2000;
                        const left = nextAt - d.hours;
                        return { d, left };
                      })
                      .sort((a, b) => a.left - b.left)
                      .slice(0, 5)
                      .map(({ d, left }) => (
                        <div key={d.id} className="py-2 flex justify-between items-center text-xs">
                          <div className="flex flex-col">
                            <b className="text-[#0F2233]">
                              {d.pond} ({d.id})
                            </b>
                            <span className="text-[11px] text-[#52677A]">
                              {d.farmer} · {d.village}
                            </span>
                          </div>
                          <span
                            className={`font-mono font-bold ${
                              left < 300 ? 'text-amber-600' : 'text-[#33475A]'
                            }`}
                          >
                            {left.toLocaleString('en-IN')} h left
                          </span>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-2 text-xs">
                  <b className="text-sm font-bold text-[#0B2440]">Standard Service Protocols</b>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-[#52677A]">Mixer Cleaning</span>
                    <b>Every 2,000 Run Hours</b>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-[#52677A]">DO Sensor Calibration</span>
                    <b>Every 45 Days</b>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-[#52677A]">Inactivity On-Site Visit</span>
                    <b>After 3 Days Off</b>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 5: MORE, REPORTS & SETTINGS ── */}
        {route === 'more' && (
          <div className="p-3 sm:p-5 flex flex-col gap-3.5 animate-in fade-in">
            {/* Super Admin Profile Card */}
            <div className="bg-[#0B2440] text-white p-4 sm:p-5 rounded-2xl shadow-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[#54B7E7] text-[#04223A] font-black text-base flex items-center justify-center shrink-0">
                  KN
                </div>
                <div className="flex flex-col">
                  <b className="text-base text-white">Kollu Narendra</b>
                  <span className="text-xs text-[#9DB8D0]">Founder &amp; Super Admin</span>
                  <span className="text-[11px] text-[#54B7E7] font-mono">{adminEmail}</span>
                </div>
              </div>

              {/* Admin System Tools Hub Button */}
              <button
                type="button"
                onClick={() => setShowSystemTools(true)}
                className="py-2 px-3 rounded-xl bg-[#163A63] hover:bg-[#1D4C80] text-[#54B7E7] text-xs font-bold border border-[#2A5584] flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Admin Tools</span>
              </button>
            </div>

            {/* Installation: sensors, DO calibration, pond location, machine specs */}
            <button
              type="button"
              onClick={() => setSensorSetupFor('')}
              className="ox-card p-4 flex items-center gap-3 text-left cursor-pointer hover:border-[#0E6FA3] transition-colors"
            >
              <span className="w-11 h-11 rounded-2xl bg-[#E3F3FB] text-[#0E6FA3] flex items-center justify-center shrink-0">
                <SlidersHorizontal className="w-5 h-5" />
              </span>
              <span className="flex-1 min-w-0">
                <b className="block text-sm text-[#0B2440]">Sensor setup &amp; calibration</b>
                <span className="block text-xs text-[#52677A]">Install sensors, calibrate DO probe, save pond location and machine specs</span>
              </span>
              <span className="ox-btn ox-btn-primary ox-btn-sm">Open</span>
            </button>

            {/* Desktop 2-Column: Reports on Left, Automation Rules & Info on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Reports Download Hub */}
              <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-3">
                <b className="text-sm font-bold text-[#0B2440]">Fleet CSV Reports</b>
                <span className="text-xs text-[#52677A]">
                  Generate clean Excel-ready CSV files for audits, farmer billing, and field service.
                </span>

                <div className="flex flex-col divide-y divide-slate-100">
                  {[
                    ['critical', 'Critical Machines Report', 'Off 7+ days or active tickets', '#EF4444'],
                    ['maint', 'Maintenance Checklist', 'Off 3 to 7 days', '#FACC15'],
                    ['running', 'Active Running Machines', 'Live DO and run-hours', '#22C55E'],
                    ['All', 'Complete Fleet Directory', 'Every machine in database', '#0E6FA3'],
                    ['service', 'Service History Log', 'Every technician service record', '#6366F1'],
                    ['warranty', 'Warranty & AMC Expiry', 'Sorted by expiry countdown', '#0F2233'],
                  ].map(([repId, repTitle, repDesc, repColor]) => (
                    <div key={repId} className="py-2.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: repColor }} />
                        <div className="flex flex-col">
                          <b className="text-xs text-[#0F2233]">{repTitle}</b>
                          <span className="text-[11px] text-[#52677A]">{repDesc}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownloadCsv(repId)}
                        className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-[#DDE7EF] text-[#0E6FA3] cursor-pointer"
                        title={`Download ${repTitle}`}
                      >
                        <FileDown className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Automation Rules & Settings */}
              <div className="flex flex-col gap-3.5">
                <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-3">
                  <b className="text-sm font-bold text-[#0B2440]">Fleet Automation Rules</b>
                  <span className="text-xs text-[#52677A]">
                    Autonomous thresholds managed across all controller firmware.
                  </span>

                  {[
                    ['auto', 'DO Auto Control', 'Auto ON below 5.0 ppm, OFF above 9.0 ppm'],
                    ['night', 'Night Boost Aeration', 'Guaranteed run 02:00 to 06:00 during DO dips'],
                    ['restart', 'Power Cut Auto Resume', 'Resume motor within 30s of grid power return'],
                    ['sms', 'Farmer Low-DO Alerts', 'Dispatch SMS when DO stays under 4.0 ppm for 10 min'],
                  ].map(([ruleKey, ruleName, ruleDesc]) => {
                    const isChecked = Boolean(automationRules[ruleKey]);
                    return (
                      <div key={ruleKey} className="flex items-center justify-between py-2 border-b border-slate-50 text-xs">
                        <div className="flex flex-col">
                          <b className="text-[#0F2233]">{ruleName}</b>
                          <span className="text-[11px] text-[#52677A]">{ruleDesc}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAutomationRules((prev) => ({
                              ...prev,
                              [ruleKey]: !prev[ruleKey],
                            }));
                            showToast(`Automation rule "${ruleName}" updated`);
                          }}
                          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                            isChecked ? 'bg-[#0E6FA3]' : 'bg-slate-200'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                              isChecked ? 'left-6' : 'left-1'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Company Support & Sign Out Card */}
                <div className="bg-white p-4 rounded-2xl border border-[#DDE7EF] shadow-xs flex flex-col gap-2 text-xs">
                  <b className="text-sm font-bold text-[#0B2440]">Oxynity Smart Aquaculture</b>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-[#52677A]">Headquarters</span>
                    <span>Plot 77, APIIC Industrial Area, Bhimavaram</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-[#52677A]">Emergency Techline</span>
                    <span>+91 72079 47722</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-[#52677A]">App Platform</span>
                    <span>v2.4.1 (Web Browser &amp; Mobile)</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onLogout}
                  className="w-full py-3 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs border border-rose-200 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out of Admin Portal</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── MOBILE BOTTOM NAVIGATION BAR (Visible on Mobile or Small Viewports) ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#DDE7EF] px-3 py-1.5 shadow-2xl sm:hidden"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
        aria-label="Admin Mobile Navigation"
      >
        <div className="max-w-md mx-auto grid grid-cols-5 gap-1">
          {(
            [
              ['map', 'Map', MapPin],
              ['devices', 'Devices', SlidersHorizontal],
              ['complaints', 'Complaints', AlertTriangle],
              ['service', 'Service', Wrench],
              ['more', 'More', Layers],
            ] as const
          ).map(([tId, tLabel, Icon]) => {
            const isActive = route === tId;
            return (
              <button
                key={tId}
                type="button"
                onClick={() => {
                  setRoute(tId);
                  setSelectedDevice(null);
                }}
                className={`flex flex-col items-center justify-center py-1 rounded-xl transition-all cursor-pointer ${
                  isActive ? 'text-[#0E6FA3] font-bold bg-[#E3F3FB]' : 'text-[#52677A]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-[10px] mt-0.5">{tLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── MODAL: ADMIN SYSTEM TOOLS (Users, Content, Broadcasts, Live GPS Calibration) ── */}
      {showSystemTools && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
            {/* Modal Header */}
            <div className="bg-[#0B2440] text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#54B7E7]" />
                <b className="text-base">Oxynity Core Admin System Tools</b>
              </div>
              <button
                type="button"
                onClick={() => setShowSystemTools(false)}
                className="text-[#9DB8D0] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sub-Tabs */}
            <div className="flex items-center gap-1 bg-[#133559] p-2 overflow-x-auto no-scrollbar text-xs">
              {(
                [
                  ['users', 'User Accounts'],
                  ['content', 'Announcements & Guides'],
                  ['notifications', 'Notifications Hub'],
                  ['calibrate', 'Live GPS Anchor'],
                ] as const
              ).map(([tabId, tabName]) => (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => setSystemToolsTab(tabId)}
                  className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer transition-all ${
                    systemToolsTab === tabId
                      ? 'bg-[#0E6FA3] text-white shadow-xs'
                      : 'text-[#9DB8D0] hover:text-white'
                  }`}
                >
                  {tabName}
                </button>
              ))}
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {systemToolsTab === 'users' && <AdminUserManagement initialUsers={[]} allPonds={allDevices || []} />}
              {systemToolsTab === 'content' && <AdminContentManagement initialAnnouncements={[]} initialGuides={[]} allPonds={allDevices || []} />}
              {systemToolsTab === 'notifications' && <AdminNotificationsHub initialDispatches={[]} allUsers={savedAdminUsers()} allPonds={allDevices || []} />}
              {systemToolsTab === 'calibrate' && (
                <div className="flex flex-col gap-3">
                  <span className="text-xs text-[#52677A]">
                    Calibrate and lock real coordinates for SIMCom A7672S 4G LTE Cat-1 stations (1.0 km radius geofence lock).
                  </span>
                  <LiveGprsMap
                    device={currentDevice}
                    onCalibrateLocation={onCalibrateLocation}
                    onResetCalibration={onResetCalibration}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: SEARCH / INPUT POND COORDINATES & CALIBRATE ── */}
      {manualCalibrateModal && manualCalibrateModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 flex flex-col">
            <div className="bg-[#0B2440] text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-sky-400" />
                <b className="text-base">Calibrate Pond Anchor ({manualCalibrateModal.deviceId})</b>
              </div>
              <button
                type="button"
                onClick={() => setManualCalibrateModal(null)}
                className="text-[#9DB8D0] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 flex flex-col gap-4 text-xs">
              <p className="text-[#52677A]">
                Calibrate and lock the reference center coordinates for <b>{manualCalibrateModal.pondName}</b> ({manualCalibrateModal.deviceId}). Oxynity will maintain a <b>1.0 km geofence safety perimeter</b> around this anchor.
              </p>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-[#0F2233]">Pond Anchor Name / Label</label>
                <input
                  type="text"
                  value={manualCalibrateModal.name}
                  onChange={(e) =>
                    setManualCalibrateModal({ ...manualCalibrateModal, name: e.target.value })
                  }
                  placeholder="e.g. Raju South Pond #1"
                  className="h-10 px-3 rounded-xl border border-[#C9D6DE] bg-white font-medium text-xs text-[#0F2233]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-[#0F2233]">Latitude (°N)</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={manualCalibrateModal.lat}
                    onChange={(e) =>
                      setManualCalibrateModal({ ...manualCalibrateModal, lat: e.target.value })
                    }
                    placeholder="16.711395"
                    className="h-10 px-3 rounded-xl border border-[#C9D6DE] bg-white font-mono text-xs text-[#0F2233]"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-[#0F2233]">Longitude (°E)</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={manualCalibrateModal.lng}
                    onChange={(e) =>
                      setManualCalibrateModal({ ...manualCalibrateModal, lng: e.target.value })
                    }
                    placeholder="81.464035"
                    className="h-10 px-3 rounded-xl border border-[#C9D6DE] bg-white font-mono text-xs text-[#0F2233]"
                  />
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex flex-col gap-1.5">
                <span className="font-bold text-[#52677A]">Quick Presets / Aquaculture Zones:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'Bhimavaram Delta', lat: '16.544892', lng: '81.521235' },
                    { label: 'Kakinada Coast', lat: '16.989064', lng: '82.247562' },
                    { label: 'Nellore Shrimp Farm', lat: '14.442600', lng: '79.986500' },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() =>
                        setManualCalibrateModal({
                          ...manualCalibrateModal,
                          lat: p.lat,
                          lng: p.lng,
                          name: `${manualCalibrateModal.pondName} (${p.label})`,
                        })
                      }
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[#33475A] font-bold text-[11px] cursor-pointer"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 mt-2">
                <button
                  type="button"
                  onClick={() => setManualCalibrateModal(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#33475A] font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const latNum = parseFloat(manualCalibrateModal.lat);
                    const lngNum = parseFloat(manualCalibrateModal.lng);
                    if (isNaN(latNum) || isNaN(lngNum)) {
                      showToast('Please enter valid latitude and longitude numbers.');
                      return;
                    }
                    const locName =
                      manualCalibrateModal.name ||
                      `Pond Anchor (${latNum.toFixed(4)}, ${lngNum.toFixed(4)})`;
                    await handleCalibratePondLocation(
                      manualCalibrateModal.deviceId,
                      latNum,
                      lngNum,
                      locName
                    );
                    setManualCalibrateModal(null);
                  }}
                  className="px-5 py-2 rounded-xl bg-[#0E6FA3] hover:bg-[#0b5982] text-white font-bold cursor-pointer shadow-md flex items-center gap-1.5"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Lock &amp; Calibrate 1.0 km Anchor</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
