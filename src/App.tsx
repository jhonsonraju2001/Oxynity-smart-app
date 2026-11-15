import React, { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot, setDoc, updateDoc, deleteDoc, collection, query, where } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { StatusBar, Style } from '@capacitor/status-bar';
import { db, auth } from './lib/firebase';
import { sendLocalNotification, requestNotificationPermission } from './lib/notifications';

import { DeviceTelemetry, TelemetryPoint, DeviceAlert, EnabledSensors, DeviceStatus, AeratorSchedule } from './types/iot';
import {
  initialDeviceData,
  initialTelemetryHistory,
  initialAlerts,
  initialStartStopLogs,
  DEFAULT_DEVICE_ID,
  createDefaultEmptyDevice,
} from './data/initialDevice';
import { Navbar } from './components/Navbar';
import { BottomNav, TabType } from './components/BottomNav';
import { DoGauge } from './components/DoGauge';
import { PowerControl } from './components/PowerControl';
import { StartStopLogCard, MachineStartStopLog } from './components/StartStopLogCard';
import { PondDashboard, getEsp32HeartbeatStatus } from './components/PondDashboard';
import { LiveGprsMap } from './components/LiveGprsMap';
import { RuntimeAnalytics } from './components/RuntimeAnalytics';
import { AddDevice } from './components/AddDevice';
import { SettingsModal } from './components/SettingsModal';
import { QuickGuideModal } from './components/QuickGuideModal';
import { AlertsModal } from './components/AlertsModal';
import { LoginPage } from './components/LoginPage';
import { AdminDashboard } from './components/AdminDashboard';
import { ReportsView } from './components/ReportsView';
import { SensorsView } from './components/SensorsView';
import { ServiceView } from './components/ServiceView';
import { SettingsSheet } from './components/SettingsSheet';

const defaultEnabledSensors: EnabledSensors = {
  do: true,
  ph: true,
  orp: true,
  temp: true,
  sal: true,
};

export default function App() {
  // Authentication States
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  const [userName, setUserName] = useState<string | undefined>(undefined);
  const [userRole, setUserRole] = useState<'operator' | 'admin'>('operator');
  const [showLoginPage, setShowLoginPage] = useState<boolean>(true);
  const [isAuthInitializing, setIsAuthInitializing] = useState<boolean>(true);

  // User-scoped linked ponds
  const [userLinkedPondIds, setUserLinkedPondIds] = useState<string[]>([]);
  const [hasLinkedDevice, setHasLinkedDevice] = useState<boolean>(false);

  const [device, setDevice] = useState<DeviceTelemetry>(() => createDefaultEmptyDevice());
  const [allDevices, setAllDevices] = useState<DeviceTelemetry[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSimulatingOffline, setIsSimulatingOffline] = useState(false);
  const [alerts, setAlerts] = useState<DeviceAlert[]>(initialAlerts);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryPoint[]>(initialTelemetryHistory);
  const [startStopLogs, setStartStopLogs] = useState<MachineStartStopLog[]>(initialStartStopLogs);

  // Sensors Visibility State (Persisted across sessions)
  const [sensorsEnabled, setSensorsEnabled] = useState<EnabledSensors>(() => {
    try {
      const saved = localStorage.getItem('oxynity_sensors_enabled');
      if (saved) return JSON.parse(saved);
    } catch {}
    return defaultEnabledSensors;
  });

  // Temperature Unit State (°C or °F)
  const [tempUnit, setTempUnit] = useState<'C' | 'F'>(() => {
    return (localStorage.getItem('oxynity_temp_unit') as 'C' | 'F') || 'C';
  });

  useEffect(() => {
    const handleTempUnitEvt = (e: any) => {
      if (e.detail === 'C' || e.detail === 'F') {
        setTempUnit(e.detail);
      }
    };
    window.addEventListener('oxynity_temp_unit_change', handleTempUnitEvt);
    return () => window.removeEventListener('oxynity_temp_unit_change', handleTempUnitEvt);
  }, []);

  const handleToggleSensor = (key: keyof EnabledSensors) => {
    setSensorsEnabled((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('oxynity_sensors_enabled', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  // Real-time ESP32 Heartbeat Freshness Tracker (Updates every 2.5s)
  const [, setHeartbeatTicker] = useState<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setHeartbeatTicker(Date.now()), 2500);
    return () => clearInterval(timer);
  }, []);

  const espHeartbeat = getEsp32HeartbeatStatus(device);
  const isRealEspOnline = !isSimulatingOffline && isFirebaseConnected && espHeartbeat.isLive;
  const espStatusText = isSimulatingOffline
    ? 'System offline (Simulated)'
    : !isFirebaseConnected
    ? 'Connecting...'
    : espHeartbeat.isLive
    ? 'System online'
    : `System offline (${espHeartbeat.text.replace('Offline ', '').replace(/[()]/g, '')})`;

  const mainContentRef = useRef<HTMLElement>(null);
  const lastAppToggleTimeRef = useRef<number>(0);
  const autoStartedByDoRef = useRef<boolean>(false);

  // Configure Native Mobile Status Bar & Notifications
  useEffect(() => {
    requestNotificationPermission();

    const initStatusBar = async () => {
      try {
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setBackgroundColor({ color: '#0f172a' });
        await StatusBar.setStyle({ style: Style.Dark });
      } catch {
        // Safe to ignore in standard web browser
      }
    };
    initStatusBar();
  }, []);

  // Helper to get local ponds for a given user email
  const getPondsForUser = (cleanEmail: string): string[] => {
    const isDemoUser = cleanEmail === 'operator@oxynity.com' || cleanEmail === 'admin@oxynity.com';
    const userPondsKey = `oxynity_user_ponds_${cleanEmail}`;
    const localPondsStr = localStorage.getItem(userPondsKey);
    if (localPondsStr) {
      try {
        const parsed = JSON.parse(localPondsStr);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    // Only seed default demo ponds if this is a demo account
    if (isDemoUser) {
      const defaultPonds = [DEFAULT_DEVICE_ID, 'OXY-ESP32-002'];
      localStorage.setItem(userPondsKey, JSON.stringify(defaultPonds));
      return defaultPonds;
    }
    // Standard user accounts start fresh with strictly their own linked ponds
    return [];
  };

  // 0. Firebase Auth state listener
  useEffect(() => {
    let hasResolved = false;

    // Safety fallback timer: if Firebase Auth takes >2.5s (offline, slow connection, or WebView freeze), resolve gracefully
    const fallbackTimer = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        const savedSessionStr = localStorage.getItem('oxynity_active_session');
        if (savedSessionStr) {
          try {
            const savedSession = JSON.parse(savedSessionStr);
            if (savedSession && savedSession.email) {
              const email = savedSession.email.trim().toLowerCase();
              setUserEmail(email);
              setUserName(savedSession.name || email.split('@')[0] || 'Operator');
              setUserRole(email.includes('admin') ? 'admin' : (savedSession.role || 'operator'));
              setShowLoginPage(false);

              const initialPonds = getPondsForUser(email);
              setUserLinkedPondIds(initialPonds);
              if (initialPonds.length > 0) {
                setHasLinkedDevice(true);
                setActiveTab('home');
              } else {
                setHasLinkedDevice(false);
                setActiveTab('addDevice');
                setAllDevices([]);
                setDevice(createDefaultEmptyDevice(email));
              }
              setIsAuthInitializing(false);
              return;
            }
          } catch {}
        }
        setIsAuthInitializing(false);
      }
    }, 2500);

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      hasResolved = true;
      clearTimeout(fallbackTimer);
      if (currentUser) {
        const email = (currentUser.email || 'operator@oxynity.com').trim().toLowerCase();
        setUserEmail(email);
        setUserName(currentUser.displayName || email.split('@')[0] || 'Operator');
        if (email.includes('admin')) {
          setUserRole('admin');
        } else {
          setUserRole('operator');
        }
        setShowLoginPage(false);

        const initialPonds = getPondsForUser(email);
        setUserLinkedPondIds(initialPonds);
        if (initialPonds.length > 0) {
          setHasLinkedDevice(true);
          setActiveTab('home');
        } else {
          setHasLinkedDevice(false);
          setActiveTab('addDevice');
          setAllDevices([]);
          setDevice(createDefaultEmptyDevice(email));
        }
      } else {
        // If not signed in via cloud Firebase Auth, check persistent verified local session
        const savedSessionStr = localStorage.getItem('oxynity_active_session');
        if (savedSessionStr) {
          try {
            const savedSession = JSON.parse(savedSessionStr);
            if (savedSession && savedSession.email) {
              const email = savedSession.email.trim().toLowerCase();
              setUserEmail(email);
              setUserName(savedSession.name || email.split('@')[0] || 'Operator');
              setUserRole(email.includes('admin') ? 'admin' : (savedSession.role || 'operator'));
              setShowLoginPage(false);

              const initialPonds = getPondsForUser(email);
              setUserLinkedPondIds(initialPonds);
              if (initialPonds.length > 0) {
                setHasLinkedDevice(true);
                setActiveTab('home');
              } else {
                setHasLinkedDevice(false);
                setActiveTab('addDevice');
                setAllDevices([]);
                setDevice(createDefaultEmptyDevice(email));
              }
              setIsAuthInitializing(false);
              return;
            }
          } catch {}
        }

        setShowLoginPage(true);
        setUserEmail(undefined);
        setUserName(undefined);
        setUserRole('operator');
        setUserLinkedPondIds([]);
        setAllDevices([]);
        setDevice(createDefaultEmptyDevice());
        setHasLinkedDevice(false);
      }
      setIsAuthInitializing(false);
    });

    return () => {
      clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, []);

  // Sync user's linked ponds from Firestore users/{cleanEmail} document and owned devices query
  useEffect(() => {
    if (!userEmail) return;
    const cleanEmail = userEmail.trim().toLowerCase();
    const userDocRef = doc(db, 'users', cleanEmail);

    const unsubUser = onSnapshot(
      userDocRef,
      (userSnap) => {
        if (userSnap.exists()) {
          const data = userSnap.data();
          if (Array.isArray(data.linkedPondIds)) {
            const serverPonds: string[] = data.linkedPondIds;
            const userPondsKey = `oxynity_user_ponds_${cleanEmail}`;
            localStorage.setItem(userPondsKey, JSON.stringify(serverPonds));
            setUserLinkedPondIds(serverPonds);
            if (serverPonds.length > 0) {
              setHasLinkedDevice(true);
            } else {
              setHasLinkedDevice(false);
              setAllDevices([]);
              setDevice(createDefaultEmptyDevice(cleanEmail));
            }
          }
        }
      },
      (err) => {
        console.warn('User doc snapshot offline fallback:', err);
      }
    );

    // Also auto-discover any devices uniquely owned by this email in Firestore
    let unsubDevices: (() => void) | undefined;
    try {
      const q = query(collection(db, 'devices'), where('ownerEmail', '==', cleanEmail));
      unsubDevices = onSnapshot(
        q,
        (snap) => {
          const ownedIds = snap.docs.map((d) => d.id);
          if (ownedIds.length > 0) {
            const userPondsKey = `oxynity_user_ponds_${cleanEmail}`;
            const current = getPondsForUser(cleanEmail);
            const merged = Array.from(new Set([...current, ...ownedIds]));
            localStorage.setItem(userPondsKey, JSON.stringify(merged));
            setUserLinkedPondIds(merged);
            setHasLinkedDevice(true);
          }
        },
        (qErr) => {
          console.warn('Owned devices query fallback:', qErr);
        }
      );
    } catch (e) {
      console.warn('Could not query owned devices:', e);
    }

    return () => {
      unsubUser();
      if (unsubDevices) unsubDevices();
    };
  }, [userEmail]);

  // Handle Logout
  const handleLogout = async () => {
    try {
      localStorage.removeItem('oxynity_active_session');
      await signOut(auth);
    } catch (err) {
      console.warn('Signout warning:', err);
    }
    setUserEmail(undefined);
    setUserName(undefined);
    setUserRole('operator');
    setUserLinkedPondIds([]);
    setAllDevices([]);
    setDevice(createDefaultEmptyDevice());
    setHasLinkedDevice(false);
    setShowLoginPage(true);
  };

  // Handle Account & Data Deletion (Google Play Compliance)
  const handleDeleteAccount = async () => {
    try {
      if (userEmail) {
        const cleanEmail = userEmail.replace(/[.#$[\]]/g, '_');
        await deleteDoc(doc(db, 'users', cleanEmail)).catch((e) => console.warn('Could not delete user doc:', e));
        localStorage.removeItem(`oxynity_ponds_${userEmail}`);
      }
      localStorage.removeItem('oxynity_active_session');
      if (auth.currentUser) {
        await auth.currentUser.delete().catch((e) => console.warn('Auth user delete note:', e));
      }
      await signOut(auth).catch(() => {});
    } catch (err) {
      console.warn('Account deletion warning:', err);
    }
    setUserEmail(undefined);
    setUserName(undefined);
    setUserRole('operator');
    setUserLinkedPondIds([]);
    setAllDevices([]);
    setDevice(createDefaultEmptyDevice());
    setHasLinkedDevice(false);
    setShowLoginPage(true);
  };

  // Handle successful login
  const handleLoginSuccess = (email?: string, name?: string, role: 'operator' | 'admin' = 'operator') => {
    const cleanEmail = (email || 'operator@oxynity.com').trim().toLowerCase();
    const displayName = name || (role === 'admin' ? 'System Admin' : 'Operator');

    localStorage.setItem(
      'oxynity_active_session',
      JSON.stringify({ email: cleanEmail, name: displayName, role })
    );

    setUserEmail(cleanEmail);
    setUserName(displayName);
    setUserRole(role);
    setShowLoginPage(false);

    const userPonds = getPondsForUser(cleanEmail);
    setUserLinkedPondIds(userPonds);
    if (userPonds.length > 0) {
      setHasLinkedDevice(true);
      setActiveTab('home');
    } else {
      setHasLinkedDevice(false);
      setActiveTab('addDevice');
      setAllDevices([]);
      setDevice(createDefaultEmptyDevice(cleanEmail));
    }
  };

  // 1. Subscribe to Firebase Firestore Live Telemetry for linked device IDs only
  useEffect(() => {
    if (!userEmail || userLinkedPondIds.length === 0) {
      setAllDevices([]);
      setDevice(createDefaultEmptyDevice(userEmail));
      setHasLinkedDevice(false);
      return;
    }

    const cleanEmail = userEmail.trim().toLowerCase();
    setHasLinkedDevice(true);

    const unsubscribers = userLinkedPondIds.map((pondId) => {
      const docRef = doc(db, 'devices', pondId);
      return onSnapshot(
        docRef,
        (docSnap) => {
          setIsFirebaseConnected(true);
          if (docSnap.exists()) {
            const data = docSnap.data() as DeviceTelemetry;

            // Multi-user authorization check:
            // Allow access ONLY if this device belongs to this user:
            // 1. ownerEmail matches cleanEmail, OR
            // 2. cleanEmail is in linkedEmails, OR
            // 3. User is system admin, OR
            // 4. Fallback default device ONLY for operator@oxynity.com if unassigned
            const isOwner = !!(data.ownerEmail && data.ownerEmail.trim().toLowerCase() === cleanEmail);
            const isLinkedUser = Array.isArray(data.linkedEmails) && data.linkedEmails.some((e) => e.trim().toLowerCase() === cleanEmail);
            const isAdmin = userRole === 'admin';
            const isOperatorDemo = cleanEmail === 'operator@oxynity.com' && (!data.ownerEmail || data.ownerEmail === 'operator@oxynity.com');

            const isPondLinkedToUser = userLinkedPondIds.includes(pondId);
            const isAuthorized = isOwner || isLinkedUser || isAdmin || isOperatorDemo || isPondLinkedToUser;

            if (!isAuthorized) {
              console.warn(`Access denied to device ${pondId} for ${cleanEmail}: registered to another account.`);
              return;
            }

            const savedDo = localStorage.getItem(`oxynity_do_sensor_enabled_${data.deviceId}`);
            if (savedDo !== null && data.doSensorEnabled === undefined) {
              data.doSensorEnabled = savedDo === 'true';
            }

            if (data.schedules === undefined) {
              const savedSch = localStorage.getItem(`oxynity_schedules_${data.deviceId}`);
              if (savedSch) {
                try {
                  data.schedules = JSON.parse(savedSch);
                } catch {}
              }
            }

            // Restore cooldown state if not in remote payload
            if (data.cooldownEnabled === undefined) {
              const savedCooldown = localStorage.getItem(`oxynity_cooldown_enabled_${pondId}`);
              if (savedCooldown !== null) {
                data.cooldownEnabled = savedCooldown !== 'false';
              }
            }

            // Recalculate live DO if probe is calibrated
            if (data.voltageMv !== undefined) {
              const isCalibrated = data.isDoCalibrated || localStorage.getItem(`oxynity_is_calibrated_${pondId}`) === 'true';
              if (isCalibrated) {
                const slope = data.doSlopeK || parseFloat(localStorage.getItem(`oxynity_calibrated_slope_${pondId}`) || '0.003212');
                const zero = data.doZeroMv !== undefined ? data.doZeroMv : parseFloat(localStorage.getItem(`oxynity_calibrated_zero_${pondId}`) || '0');
                data.doLevel = Number(Math.max(0, (data.voltageMv - zero) * slope).toFixed(2));
              }
            }

            // Recalculate live elapsed runtime if device is currently ON
            if (data.status === 'ON') {
              const now = Date.now();
              const startedIso =
                data.sessionStartedAt ||
                localStorage.getItem(`oxynity_session_started_at_${data.deviceId || pondId}`);
              if (startedIso) {
                const startTime = new Date(startedIso).getTime();
                if (!isNaN(startTime) && startTime > 0 && now >= startTime) {
                  const wallClockSecs = Math.floor((now - startTime) / 1000);
                  data.currentSessionSeconds = Math.max(wallClockSecs, data.currentSessionSeconds || 0);
                  data.currentSessionMinutes = Math.floor(data.currentSessionSeconds / 60);
                  data.sessionStartedAt = startedIso;
                }
              }
            }

            // If user recently toggled status manually in the app, do NOT let a delayed snapshot overwrite the user's optimistic status!
            data.deviceId = data.deviceId || pondId;
            const isRecentAppToggle = Date.now() - lastAppToggleTimeRef.current < 15000;

            setAllDevices((prev) => {
              const idx = prev.findIndex((d) => d.deviceId === data.deviceId);
              const currentDev = idx >= 0 ? prev[idx] : undefined;
              const safeData = isRecentAppToggle && currentDev?.deviceId === data.deviceId
                ? {
                    ...data,
                    status: currentDev.status,
                    status2: currentDev.status2,
                    isCoolingDown: currentDev.isCoolingDown,
                  }
                : data;

              if (idx >= 0) {
                const next = [...prev];
                next[idx] = safeData;
                return next;
              }
              return [...prev, safeData];
            });

            // Set current device if matching or not initialized yet or matching last selected pond
            setDevice((current) => {
              const safeData = isRecentAppToggle && current.deviceId === data.deviceId
                ? {
                    ...data,
                    status: current.status,
                    status2: current.status2,
                    isCoolingDown: current.isCoolingDown,
                  }
                : data;

              const lastSelectedId = localStorage.getItem(`oxynity_last_selected_pond_${cleanEmail}`);
              if (lastSelectedId && lastSelectedId === data.deviceId) {
                return safeData;
              }
              if (!current.deviceId || current.deviceId === data.deviceId) {
                return safeData;
              }
              return current;
            });
          } else {
            // Document missing in Firestore: seed if default device
            if (pondId === DEFAULT_DEVICE_ID && cleanEmail === 'operator@oxynity.com') {
              setDoc(docRef, initialDeviceData).catch(() => {});
            }
          }
        },
        (error) => {
          console.warn('Firestore device listener error:', error);
          setIsFirebaseConnected(false);
        }
      );
    });

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [userLinkedPondIds, userEmail, userRole]);

  // 2. Machine Session Runtime Timer (Increment seconds every 1s when ON and ONLINE)
  // When offline, timer pauses. When back online, it resumes from where it paused!
  // 2. Exact Session Runtime & Continuous Run Ticker (6-Hour Cooldown Watcher)
  useEffect(() => {
    if (device.status !== 'ON' || !isRealEspOnline) return;

    const interval = setInterval(() => {
      setDevice((prev) => {
        if (prev.status !== 'ON') return prev;
        const now = Date.now();
        const startedIso =
          prev.sessionStartedAt ||
          (typeof localStorage !== 'undefined'
            ? localStorage.getItem(`oxynity_session_started_at_${prev.deviceId}`)
            : null);

        let actualSecs = (prev.currentSessionSeconds ?? (prev.currentSessionMinutes * 60)) + 1;
        if (startedIso) {
          const t = new Date(startedIso).getTime();
          if (!isNaN(t) && t > 0 && now >= t) {
            actualSecs = Math.max(actualSecs, Math.floor((now - t) / 1000));
          }
        }
        const newSecs = actualSecs;
        const newMinutes = Math.floor(newSecs / 60);

        const contStartedIso =
          prev.continuousStartedAt ||
          (typeof localStorage !== 'undefined'
            ? localStorage.getItem(`oxynity_continuous_started_at_${prev.deviceId}`)
            : null);

        let actualCont = (prev.continuousRunSeconds ?? 0) + 1;
        if (contStartedIso) {
          const ct = new Date(contStartedIso).getTime();
          if (!isNaN(ct) && ct > 0 && now >= ct) {
            actualCont = Math.max(actualCont, Math.floor((now - ct) / 1000));
          }
        }
        const continuousSecs = actualCont;
        const newTotalHours = (prev.totalRunHours ?? 0) + 1 / 3600;

        // Save continuous run and elapsed seconds to localStorage
        try {
          localStorage.setItem(`oxynity_continuous_run_${prev.deviceId}`, String(continuousSecs));
          localStorage.setItem(`oxynity_session_elapsed_${prev.deviceId}`, String(newSecs));
        } catch {}

        // 6-Hour Auto-Cooldown Threshold Check: 6 * 3600 = 21,600 seconds
        const isCooldownEnabled = prev.cooldownEnabled !== false;
        if (isCooldownEnabled && continuousSecs >= 6 * 3600) {
          // Trigger 30-minute cooling break!
          setTimeout(() => {
            const pondName = prev.name?.replace(/\(.*?\)/g, '').trim() || prev.deviceId || 'Pond';
            const title = `[${pondName}] ❄️ MOTOR COOLDOWN REST STARTED`;
            const msg = `[${pondName}] Generator ran for 6 continuous hours. Taking a 30-minute rest to protect the motor. Will auto-resume in 30 minutes.`;

            const newAlert: DeviceAlert = {
              id: `alt-cd-start-${Date.now()}`,
              timestamp: new Date().toISOString(),
              title,
              message: msg,
              severity: 'info',
              read: false,
            };
            setAlerts((alertsPrev) => [newAlert, ...alertsPrev]);
            sendLocalNotification(title, msg);

            handleTogglePower('OFF', 'Auto Cooldown Started');
          }, 0);

          return {
            ...prev,
            status: 'OFF',
            status2: 'OFF',
            sessionStartedAt: '',
            continuousStartedAt: '',
            isCoolingDown: true,
            cooldownEndsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            cooldownRemainingSeconds: 1800,
            continuousRunSeconds: 0,
            updatedAt: new Date().toISOString(),
          };
        }

        const updated = {
          ...prev,
          currentSessionSeconds: newSecs,
          currentSessionMinutes: newMinutes,
          continuousRunSeconds: continuousSecs,
          sessionStartedAt: startedIso || prev.sessionStartedAt,
          continuousStartedAt: contStartedIso || prev.continuousStartedAt,
          totalRunHours: Number((newTotalHours ?? 0).toFixed(4)),
          updatedAt: new Date().toISOString(),
        };

        // Sync to Firestore quietly every minute
        if (newSecs % 60 === 0) {
          const docRef = doc(db, 'devices', prev.deviceId);
          setDoc(
            docRef,
            {
              currentSessionSeconds: newSecs,
              currentSessionMinutes: newMinutes,
              continuousRunSeconds: continuousSecs,
              sessionStartedAt: startedIso || '',
              continuousStartedAt: contStartedIso || '',
              totalRunHours: Number((newTotalHours ?? 0).toFixed(2)),
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          ).catch(() => {});
        }

        return updated;
      });
    }, 1000); // 1 sec tick for live H - M - S display

    return () => clearInterval(interval);
  }, [device.status, isRealEspOnline, device.cooldownEnabled]);

  // 2b. Cooldown 30-Minute Rest Watcher (Auto resumes operation when 30 mins completes)
  useEffect(() => {
    if (!device.isCoolingDown || !device.deviceId) return;

    const interval = setInterval(() => {
      setDevice((prev) => {
        if (!prev.isCoolingDown) return prev;

        const targetEnd = prev.cooldownEndsAt ? new Date(prev.cooldownEndsAt).getTime() : 0;
        const now = Date.now();
        const diffSecs = targetEnd > 0 ? Math.max(0, Math.floor((targetEnd - now) / 1000)) : Math.max(0, (prev.cooldownRemainingSeconds ?? 1800) - 1);

        if (diffSecs <= 0) {
          // Cooldown 30 minutes rest finished! Auto resume generator!
          setTimeout(() => {
            const pondName = prev.name?.replace(/\(.*?\)/g, '').trim() || prev.deviceId || 'Pond';
            const title = `[${pondName}] ⚡ MOTOR COOLDOWN COMPLETED`;
            const msg = `[${pondName}] 30-minute motor rest completed! Generator has automatically resumed operation. Relay 2 starting in 2 minutes.`;

            const newAlert: DeviceAlert = {
              id: `alt-cd-end-${Date.now()}`,
              timestamp: new Date().toISOString(),
              title,
              message: msg,
              severity: 'info',
              read: false,
            };
            setAlerts((alertsPrev) => [newAlert, ...alertsPrev]);
            sendLocalNotification(title, msg);

            handleTogglePower('ON', 'Auto Cooldown Complete');
          }, 0);

          return {
            ...prev,
            isCoolingDown: false,
            cooldownEndsAt: '',
            cooldownRemainingSeconds: 0,
            continuousRunSeconds: 0,
            updatedAt: new Date().toISOString(),
          };
        }

        return {
          ...prev,
          cooldownRemainingSeconds: diffSecs,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [device.isCoolingDown, device.deviceId, device.cooldownEndsAt]);

  // 3. Auto DO Protection Logic (Activates Generator when DO < minDoAlert, shuts off when DO reaches targetDo)
  useEffect(() => {
    if (device.doSensorEnabled === false || !device.deviceId) return; // Do NOT trigger auto DO if sensor is disabled

    const minLimit = device.minDoAlert ?? 5.0;
    const targetLimit = device.targetDo ?? 8.5;
    const pondName = device.name?.replace(/\(.*?\)/g, '').trim() || device.deviceId || 'Pond';

    // Condition 1: DO drops below minDoAlert -> ACTIVATE GENERATOR
    if (device.autoMode && device.doLevel !== undefined && device.doLevel !== null && device.doLevel > 0 && device.doLevel < minLimit) {
      if (device.status === 'OFF') {
        autoStartedByDoRef.current = true;
        handleTogglePower('ON', 'Auto DO Protection');

        // Add auto-trigger alert
        const newAlert: DeviceAlert = {
          id: `alt-${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: `[${pondName}] Auto-Oxygenation Triggered`,
          message: `[${pondName}] DO dropped to ${(device.doLevel ?? 0).toFixed(1)} mg/L (Below min alert ${(minLimit ?? 5.0).toFixed(1)} mg/L). Generator started automatically.`,
          severity: 'critical',
          read: false,
        };

        setAlerts((prev) => [newAlert, ...prev]);

        // Push native mobile notification
        sendLocalNotification(
          `[${pondName}] ⚠️ LOW OXYGEN ALERT`,
          `[${pondName}] DO dropped to ${(device.doLevel ?? 0).toFixed(1)} mg/L! Generator started automatically.`
        );
      }
    }

    // Condition 2: DO reaches target level -> SHUT OFF GENERATOR
    // ONLY auto-shutoff if:
    // 1. autoMode is true
    // 2. Generator was automatically activated by Auto DO (autoStartedByDoRef.current === true)
    // 3. DO level has reached targetLimit
    // 4. No manual app toggle has occurred recently (within 60s) so manual operator controls are NEVER interrupted
    const isRecentManualToggle = Date.now() - lastAppToggleTimeRef.current < 60000;
    if (device.autoMode && device.doLevel !== undefined && device.doLevel !== null && device.doLevel >= targetLimit && !isRecentManualToggle) {
      if (device.status === 'ON' && autoStartedByDoRef.current) {
        autoStartedByDoRef.current = false;
        handleTogglePower('OFF', 'Auto DO Target Reached');

        const newAlert: DeviceAlert = {
          id: `alt-${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: `[${pondName}] Target DO Restored`,
          message: `[${pondName}] DO recovered to ${(device.doLevel ?? 0).toFixed(1)} mg/L (Target ${(targetLimit ?? 7.5).toFixed(1)} mg/L reached). Generator stopped automatically.`,
          severity: 'info',
          read: false,
        };

        setAlerts((prev) => [newAlert, ...prev]);

        sendLocalNotification(
          `[${pondName}] ✅ Target Oxygen Restored`,
          `[${pondName}] DO recovered to ${(device.doLevel ?? 0).toFixed(1)} mg/L. Generator turned off automatically.`
        );
      }
    }
  }, [device.doLevel, device.autoMode, device.status, device.minDoAlert, device.targetDo, device.doSensorEnabled, device.deviceId, device.name]);

  // 3b. Real-time Low DO Alert Notification Watcher (notifies user even when autoMode is OFF)
  const lastLowDoAlertTimeRefWatcher = useRef<number>(0);
  useEffect(() => {
    if (device.doSensorEnabled === false || !device.deviceId) return;
    if (device.doLevel !== undefined && device.doLevel !== null && device.doLevel > 0 && device.doLevel < (device.minDoAlert ?? 5.0)) {
      const now = Date.now();
      // Throttle notification to once every 5 minutes unless restored
      if (now - lastLowDoAlertTimeRefWatcher.current > 5 * 60 * 1000) {
        lastLowDoAlertTimeRefWatcher.current = now;
        const pondName = device.name?.replace(/\(.*?\)/g, '').trim() || device.deviceId || 'Pond';
        sendLocalNotification(
          `[${pondName}] ⚠️ LOW DISSOLVED OXYGEN ALERT`,
          `[${pondName}] DO dropped to ${(device.doLevel ?? 0).toFixed(1)} mg/L (Below safe threshold ${(device.minDoAlert ?? 5.0).toFixed(1)} mg/L)!`
        );
      }
    }
  }, [device.doLevel, device.minDoAlert, device.deviceId, device.doSensorEnabled, device.name]);

  // ---------------------------------------------------------------------------
  // 3c. Real-Time Generator Start/Stop & Push Button Notification Watcher
  // ---------------------------------------------------------------------------
  const prevStatusRef = useRef<DeviceStatus | null>(null);

  useEffect(() => {
    if (!device.deviceId) return;

    if (prevStatusRef.current === null) {
      prevStatusRef.current = device.status;
      return;
    }

    const prev = prevStatusRef.current;
    const current = device.status;

    if (prev !== current) {
      const pondName = device.name?.replace(/\(.*?\)/g, '').trim() || device.deviceId || 'Pond';
      const isAppTrigger = Date.now() - lastAppToggleTimeRef.current < 20000;

      if (current === 'ON') {
        const source = isAppTrigger ? 'Mobile App Switch' : 'Manual Green Push Button (Panel)';
        const title = `[${pondName}] ⚡ GENERATOR STARTED`;
        const msg = `[${pondName}] Generator is now RUNNING via ${source}. Relay 2 starting automatically in 2 minutes.`;

        const newAlert: DeviceAlert = {
          id: `alt-gen-on-${Date.now()}`,
          timestamp: new Date().toISOString(),
          title,
          message: msg,
          severity: 'info',
          read: false,
        };
        setAlerts((prevAlerts) => [newAlert, ...prevAlerts]);
        sendLocalNotification(title, msg);
      } else if (current === 'OFF') {
        const source = isAppTrigger ? 'Mobile App Switch' : 'Manual Red Push Button (Emergency Cutoff)';
        const title = `[${pondName}] 🛑 GENERATOR STOPPED`;
        const msg = `[${pondName}] Generator stopped via ${source}. All aerator relays safely shut down.`;

        const newAlert: DeviceAlert = {
          id: `alt-gen-off-${Date.now()}`,
          timestamp: new Date().toISOString(),
          title,
          message: msg,
          severity: 'warning',
          read: false,
        };
        setAlerts((prevAlerts) => [newAlert, ...prevAlerts]);
        sendLocalNotification(title, msg);
      }
    }

    prevStatusRef.current = current;
  }, [device.status, device.deviceId, device.name]);

  // ---------------------------------------------------------------------------
  // 3d. System Online / Offline Real-Time Notification Watcher
  // ---------------------------------------------------------------------------
  const prevOnlineRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!device.deviceId) return;

    if (prevOnlineRef.current === null) {
      prevOnlineRef.current = isRealEspOnline;
      return;
    }

    const prev = prevOnlineRef.current;
    const current = isRealEspOnline;

    if (prev !== current) {
      const pondName = device.name?.replace(/\(.*?\)/g, '').trim() || device.deviceId || 'Pond';

      if (!current) {
        // Transition to OFFLINE
        const title = `[${pondName}] ⚠️ SYSTEM OFFLINE ALERT`;
        const msg = `[${pondName}] Machine disconnected from cloud. Timer paused. Remote controls disabled; use physical manual buttons.`;

        const newAlert: DeviceAlert = {
          id: `alt-offline-${Date.now()}`,
          timestamp: new Date().toISOString(),
          title,
          message: msg,
          severity: 'critical',
          read: false,
        };
        setAlerts((prevAlerts) => [newAlert, ...prevAlerts]);
        sendLocalNotification(title, msg);
      } else {
        // Transition back to ONLINE
        const title = `[${pondName}] ✅ SYSTEM ONLINE RESTORED`;
        const msg = `[${pondName}] Machine reconnected to cloud! Live telemetry restored and running timer resumed.`;

        const newAlert: DeviceAlert = {
          id: `alt-online-${Date.now()}`,
          timestamp: new Date().toISOString(),
          title,
          message: msg,
          severity: 'info',
          read: false,
        };
        setAlerts((prevAlerts) => [newAlert, ...prevAlerts]);
        sendLocalNotification(title, msg);
      }
    }

    prevOnlineRef.current = current;
  }, [isRealEspOnline, device.deviceId, device.name]);

  // Handler: Update Firebase Firestore Device State
  const updateDeviceInFirebase = async (updates: Partial<DeviceTelemetry>, targetDeviceId?: string) => {
    const targetId = targetDeviceId || device.deviceId;
    if (!targetId) return;

    setIsUpdating(true);

    const baseDev = allDevices.find((d) => d.deviceId === targetId) || (device.deviceId === targetId ? device : undefined);
    const nowIso = new Date().toISOString();
    const updatedDevice: DeviceTelemetry = {
      ...(baseDev || device),
      ...updates,
      deviceId: targetId,
      updatedAt: updates.updatedAt || nowIso,
      lastSeen: updates.lastSeen || nowIso,
    };

    // Optimistic local update for active device and allDevices list
    if (device.deviceId === targetId || !device.deviceId) {
      setDevice(updatedDevice);
    }
    setAllDevices((prev) =>
      prev.map((d) => (d.deviceId === targetId ? updatedDevice : d))
    );

    if (updates.doSensorEnabled !== undefined) {
      localStorage.setItem(`oxynity_do_sensor_enabled_${targetId}`, String(updates.doSensorEnabled));
    }

    if (updates.cooldownEnabled !== undefined) {
      localStorage.setItem(`oxynity_cooldown_enabled_${targetId}`, String(updates.cooldownEnabled));
    }

    if (updates.isDoCalibrated && updates.doSlopeK) {
      localStorage.setItem(`oxynity_calibrated_slope_${targetId}`, String(updates.doSlopeK));
      localStorage.setItem(`oxynity_calibrated_zero_${targetId}`, String(updates.doZeroMv ?? 0));
      localStorage.setItem(`oxynity_is_calibrated_${targetId}`, 'true');
    }

    try {
      const docRef = doc(db, 'devices', targetId);
      const cleanUpdates: Record<string, any> = {};
      for (const [key, val] of Object.entries(updates)) {
        if (val !== undefined) {
          cleanUpdates[key] = val;
        }
      }
      await setDoc(docRef, cleanUpdates, { merge: true });
    } catch (err) {
      console.warn('Syncing to local state (Firestore offline fallback):', err);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleTogglePower = (
    newStatus: 'ON' | 'OFF',
    triggerSource:
      | 'Manual App Control'
      | 'Auto DO Protection'
      | 'Auto DO Target Reached'
      | 'Scheduled Timer'
      | 'GPRS Remote Command'
      | 'Emergency Cutoff'
      | 'Auto Cooldown Started'
      | 'Auto Cooldown Complete'
      | string = 'Manual App Control',
    targetDeviceId?: string
  ) => {
    const targetId = targetDeviceId || device.deviceId;
    if (!targetId) return;

    const targetDev = allDevices.find((d) => d.deviceId === targetId) || (device.deviceId === targetId ? device : undefined) || device;

    lastAppToggleTimeRef.current = Date.now();
    if (triggerSource === 'Manual App Control' || newStatus === 'OFF') {
      autoStartedByDoRef.current = false;
    }
    const currentSecs = targetDev.currentSessionSeconds ?? (targetDev.currentSessionMinutes * 60);
    const nowIso = new Date().toISOString();
    const updates: Partial<DeviceTelemetry> = {
      status: newStatus,
      status2: newStatus === 'OFF' ? 'OFF' : targetDev.status2,
      currentSessionSeconds: newStatus === 'OFF' ? 0 : currentSecs,
      currentSessionMinutes: newStatus === 'OFF' ? 0 : Math.floor(currentSecs / 60),
      updatedAt: nowIso,
      lastSeen: nowIso,
      isOnline: true,
    };

    if (newStatus === 'OFF') {
      updates.sessionStartedAt = '';
      updates.continuousStartedAt = '';
      if (triggerSource === 'Auto Cooldown Started') {
        updates.isCoolingDown = true;
        updates.cooldownEndsAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        updates.cooldownRemainingSeconds = 30 * 60;
        updates.continuousRunSeconds = 0;
      } else {
        // Normal manual stop before 6 hours: clear cooldown and continuous running seconds!
        updates.isCoolingDown = false;
        updates.cooldownEndsAt = '';
        updates.cooldownRemainingSeconds = 0;
        updates.continuousRunSeconds = 0;
        try {
          localStorage.removeItem(`oxynity_continuous_run_${targetId}`);
          localStorage.removeItem(`oxynity_session_elapsed_${targetId}`);
          localStorage.removeItem(`oxynity_session_started_at_${targetId}`);
          localStorage.removeItem(`oxynity_continuous_started_at_${targetId}`);
        } catch {}
      }
    } else {
      // Starting machine: record fresh start timestamps and clear cooldown
      updates.isCoolingDown = false;
      updates.cooldownEndsAt = '';
      updates.cooldownRemainingSeconds = 0;
      updates.continuousRunSeconds = 0;
      updates.sessionStartedAt = nowIso;
      updates.continuousStartedAt = targetDev.continuousStartedAt || nowIso;
      try {
        localStorage.setItem(`oxynity_session_started_at_${targetId}`, nowIso);
        if (!targetDev.continuousStartedAt) {
          localStorage.setItem(`oxynity_continuous_started_at_${targetId}`, nowIso);
        }
        localStorage.setItem(`oxynity_session_elapsed_${targetId}`, '0');
        localStorage.setItem(`oxynity_continuous_run_${targetId}`, '0');
      } catch {}
    }

    // Calculate session duration if stopping
    let durationStr: string | undefined = undefined;
    if (newStatus === 'OFF') {
      let finalSecs = currentSecs;
      const started =
        targetDev.sessionStartedAt ||
        localStorage.getItem(`oxynity_session_started_at_${targetId}`);
      if (started) {
        const t = new Date(started).getTime();
        if (!isNaN(t) && t > 0) {
          finalSecs = Math.max(finalSecs, Math.floor((Date.now() - t) / 1000));
        }
      }
      if (finalSecs > 0) {
        const h = Math.floor(finalSecs / 3600);
        const m = Math.floor((finalSecs % 3600) / 60);
        durationStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
      }
    }

    // Append Start/Stop Log
    const newLog: MachineStartStopLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      formattedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      formattedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      action: newStatus === 'ON' ? 'START' : 'STOP',
      triggerSource,
      doLevel: targetDev.doLevel,
      sessionDuration: durationStr,
      operator: triggerSource.includes('Auto') ? 'Automated Sensor' : 'App User',
    };

    setStartStopLogs((prev) => [newLog, ...prev]);

    // Append telemetry history point
    const newPoint: TelemetryPoint = {
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timeLabel: 'Now',
      doLevel: targetDev.doLevel,
      status: newStatus,
    };
    setTelemetryHistory((prev) => [...prev.slice(1), newPoint]);

    updateDeviceInFirebase(updates, targetId);
  };

  const handleOverrideCooldown = () => {
    handleTogglePower('ON', 'Manual App Control');
  };

  const handleCancelCooldown = () => {
    handleTogglePower('OFF', 'Manual App Control');
  };

  const handleResetMaintenance = () => {
    if (!device.deviceId) return;
    if (confirm('Are you sure you want to mark pump/filter maintenance as completed? This resets the service interval counter.')) {
      updateDeviceInFirebase({ lastMaintenanceHours: device.totalRunHours });
      alert('Maintenance reset recorded! Counter set for next 500 hours service interval.');
    }
  };

  // Handle Delete/Unlink Pond
  const handleDeletePond = async (pondId: string) => {
    if (!userEmail) return;
    const cleanEmail = userEmail.trim().toLowerCase();
    const updatedPonds = userLinkedPondIds.filter((id) => id !== pondId);

    // 1. Update local state
    setUserLinkedPondIds(updatedPonds);
    const userPondsKey = `oxynity_user_ponds_${cleanEmail}`;
    localStorage.setItem(userPondsKey, JSON.stringify(updatedPonds));

    const remainingDevices = allDevices.filter((d) => d.deviceId !== pondId);
    setAllDevices(remainingDevices);

    if (updatedPonds.length === 0) {
      setHasLinkedDevice(false);
      setDevice(createDefaultEmptyDevice(cleanEmail));
      localStorage.removeItem(`oxynity_last_selected_pond_${cleanEmail}`);
      localStorage.setItem(`oxynity_has_linked_device_${cleanEmail}`, 'false');
      setActiveTab('addDevice');
    } else {
      const nextDevice = remainingDevices[0] || createDefaultEmptyDevice(cleanEmail);
      setDevice(nextDevice);
      localStorage.setItem(`oxynity_last_selected_pond_${cleanEmail}`, nextDevice.deviceId);
    }

    // 2. Persist to Firestore: update user doc
    try {
      const userDocRef = doc(db, 'users', cleanEmail);
      await setDoc(
        userDocRef,
        {
          email: cleanEmail,
          linkedPondIds: updatedPonds,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Could not unlink pond from user in Firestore:', e);
    }
  };

  // Handle Edit Pond Name
  const handleEditPondName = async (pondId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    setDevice((prev) => (prev.deviceId === pondId ? { ...prev, name: trimmed } : prev));
    setAllDevices((prev) =>
      prev.map((d) => (d.deviceId === pondId ? { ...d, name: trimmed } : d))
    );

    try {
      const deviceRef = doc(db, 'devices', pondId);
      await setDoc(
        deviceRef,
        { name: trimmed, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (e) {
      console.warn('Could not update pond name in Firestore:', e);
    }
  };

  // Handle Update Aerator Schedules
  const handleUpdateSchedules = (newSchedules: AeratorSchedule[], targetDeviceId?: string) => {
    const targetId = targetDeviceId || device.deviceId;
    if (!targetId) return;

    setDevice((prev) => (prev.deviceId === targetId ? { ...prev, schedules: newSchedules } : prev));
    setAllDevices((prev) =>
      prev.map((d) => (d.deviceId === targetId ? { ...d, schedules: newSchedules } : d))
    );

    try {
      localStorage.setItem(`oxynity_schedules_${targetId}`, JSON.stringify(newSchedules));
    } catch {}

    const deviceRef = doc(db, 'devices', targetId);
    setDoc(deviceRef, { schedules: newSchedules, updatedAt: new Date().toISOString() }, { merge: true }).catch(
      (err) => console.warn('Could not save schedules to Firestore:', err)
    );
  };

  // ---------------------------------------------------------------------------
  // 3e. Automated Aerator Schedule Execution Engine (Evaluates every 10 seconds)
  // ---------------------------------------------------------------------------
  const lastScheduleCheckMinuteRef = useRef<string>('');

  useEffect(() => {
    if (!device.deviceId) return;

    const interval = setInterval(() => {
      const now = new Date();
      const currentHours24 = now.getHours(); // 0-23
      const currentMinutes = now.getMinutes(); // 0-59
      const currentNowMins = currentHours24 * 60 + currentMinutes;
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const minuteKey = `${todayStr}_${currentHours24}:${currentMinutes}`;

      if (lastScheduleCheckMinuteRef.current === minuteKey) return;

      if (!device.autoMode) return;

      const schedules = device.schedules || [];
      if (!Array.isArray(schedules) || schedules.length === 0) return;

      let schedulesChanged = false;
      const updatedSchedules = schedules.map((sch) => {
        if (!sch.enabled) return sch;

        const toMinutesFromMidnight = (hour: number, minute: number, ampm: 'AM' | 'PM') => {
          let h = hour % 12;
          if (ampm === 'PM') h += 12;
          return h * 60 + minute;
        };

        const startMins = toMinutesFromMidnight(sch.startHour, sch.startMinute, sch.startAmPm);
        const stopMins = toMinutesFromMidnight(sch.stopHour, sch.stopMinute, sch.stopAmPm);
        const pondName = device.name?.replace(/\(.*?\)/g, '').trim() || device.deviceId || 'Pond';

        // Check START condition (exact minute match)
        if (currentNowMins === startMins) {
          if (sch.lastTriggeredAction !== 'START' || sch.lastTriggeredDate !== todayStr) {
            lastScheduleCheckMinuteRef.current = minuteKey;
            schedulesChanged = true;

            if (device.status === 'OFF') {
              handleTogglePower('ON', `Schedule: ${sch.name}`);
              const title = `[${pondName}] ⏰ Scheduled Aeration Started`;
              const msg = `"${sch.name}" reached start time (${sch.startHour}:${String(sch.startMinute).padStart(2, '0')} ${sch.startAmPm}). Aerator turned ON automatically.`;
              sendLocalNotification(title, msg);
              setAlerts((prev) => [
                {
                  id: `alt-sch-start-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  title,
                  message: msg,
                  severity: 'info',
                  read: false,
                },
                ...prev,
              ]);
            }

            return {
              ...sch,
              lastTriggeredAction: 'START' as const,
              lastTriggeredDate: todayStr,
            };
          }
        }

        // Check STOP condition (exact minute match)
        if (currentNowMins === stopMins) {
          if (sch.lastTriggeredAction !== 'STOP' || sch.lastTriggeredDate !== todayStr) {
            lastScheduleCheckMinuteRef.current = minuteKey;
            schedulesChanged = true;

            if (device.status === 'ON') {
              handleTogglePower('OFF', `Schedule: ${sch.name}`);
              const title = `[${pondName}] ⏰ Scheduled Aeration Stopped`;
              const msg = `"${sch.name}" reached stop time (${sch.stopHour}:${String(sch.stopMinute).padStart(2, '0')} ${sch.stopAmPm}). Aerator turned OFF automatically.`;
              sendLocalNotification(title, msg);
              setAlerts((prev) => [
                {
                  id: `alt-sch-stop-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  title,
                  message: msg,
                  severity: 'info',
                  read: false,
                },
                ...prev,
              ]);
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

      if (schedulesChanged) {
        handleUpdateSchedules(updatedSchedules, device.deviceId);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [device.schedules, device.deviceId, device.status, device.name]);

  const unreadAlertCount = alerts.filter((a) => !a.read).length;

  // Branded Splash Screen during initial Firebase Auth state verification
  if (isAuthInitializing) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="relative flex flex-col items-center space-y-4">
          <div className="relative w-24 h-24 flex items-center justify-center animate-pulse">
            <img
              src="/logo.png"
              alt="Oxynity Logo"
              className="w-24 h-24 object-contain drop-shadow-[0_0_25px_rgba(2,132,199,0.5)]"
            />
          </div>
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black italic tracking-wider text-sky-400 font-sans">
                OXYNITY
              </span>
              <span className="text-xs font-black uppercase tracking-wider bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-md border border-sky-500/30">
                SMART
              </span>
            </div>
            <span className="text-[9px] font-bold tracking-widest text-slate-400 uppercase mt-1">
              MICRO - NANO BUBBLE GENERATORS
            </span>
          </div>
          <div className="w-8 h-8 border-3 border-sky-500/30 border-t-sky-400 rounded-full animate-spin mt-4" />
        </div>
      </div>
    );
  }

  // Display Login Page first when unauthenticated
  if (showLoginPage || !userEmail) {
    return (
      <LoginPage
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  const handleCalibrateLocation = async (
    lat: number,
    lng: number,
    locName: string,
    cellLac?: string,
    cellId?: string
  ) => {
    await updateDeviceInFirebase({
      latitude: lat,
      longitude: lng,
      calibratedLatitude: lat,
      calibratedLongitude: lng,
      calibratedLocationName: locName,
      calibratedAt: new Date().toISOString(),
      calibratedCellLac: cellLac || device.cellLac || '',
      calibratedCellId: cellId || device.cellId || '',
      isCalibrated: true,
      isMoving: false,
      moveDistanceKm: 0,
      locationName: locName,
      locationSource: 'Phone GPS Calibrated (Stationary)',
      gprsLocationFixed: true,
    });
  };

  const handleResetCalibration = async () => {
    await updateDeviceInFirebase({
      isCalibrated: false,
      isMoving: false,
      moveDistanceKm: 0,
      calibratedLatitude: 0,
      calibratedLongitude: 0,
      calibratedLocationName: '',
      calibratedCellLac: '',
      calibratedCellId: '',
      locationSource: 'SIM900A GPRS Cell LBS',
      locationName: 'SIM900A Cellular Station',
    });
  };

  // Render Admin Dashboard View if Admin Role is Logged In
  if (userRole === 'admin') {
    return (
      <AdminDashboard
        currentDevice={device}
        allDevices={allDevices}
        adminEmail={userEmail || 'admin@oxynity.com'}
        adminName={userName || 'System Admin'}
        onLogout={handleLogout}
        onCalibrateLocation={handleCalibrateLocation}
        onResetCalibration={handleResetCalibration}
      />
    );
  }

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (mainContentRef.current) {
      mainContentRef.current.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  // Render Standard Operator App Mobile Shell View
  return (
    <div className="h-full h-[100dvh] w-full bg-[#F2F7F8] dark:bg-[#071A1F] text-[#0B2B33] dark:text-[#E8F4F6] flex flex-col items-center justify-start sm:justify-center font-sans antialiased selection:bg-[#0E7C86] selection:text-white sm:py-4 overflow-hidden transition-colors">
      {/* Outer ambient glow for desktop view */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-teal-900/10 via-[#071A1F] to-[#071A1F] hidden sm:block" />

      {/* Mobile Device Viewport Shell Container */}
      <div className="w-full sm:max-w-[430px] h-full h-[100dvh] sm:h-[850px] sm:max-h-[850px] bg-[#F2F7F8] dark:bg-[#071A1F] text-[#0B2B33] dark:text-[#E8F4F6] flex flex-col relative sm:rounded-[36px] sm:border-4 sm:border-[#DDE8EA] dark:sm:border-[#1F4650] sm:shadow-[0_4px_30px_rgba(14,124,134,0.15)] overflow-hidden">
        
        {/* Top Mobile Status Header (Desktop Frame View only) */}
        <div className="hidden sm:flex items-center justify-between px-5 pt-2.5 pb-1 bg-[#F2F7F8] dark:bg-[#071A1F] text-[10px] font-semibold text-[#5B7479] dark:text-[#9DB8BD] border-b border-[#DDE8EA] dark:border-[#1F4650] select-none shrink-0">
          <span>9:41</span>
          <div className="w-16 h-3.5 bg-[#EEF3F4] dark:bg-[#12313A] rounded-full flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-[#5B7479] dark:bg-[#9DB8BD]" />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-bold text-[#0E7C86] dark:text-[#19C3D1]">5G</span>
            <div className="w-3.5 h-2 border border-[#5B7479] rounded-xs p-0.5 flex items-center">
              <div className="w-full h-full bg-emerald-500 rounded-2xs" />
            </div>
          </div>
        </div>

        {/* Top Navigation Matching Reference Screenshot */}
        <Navbar
          device={device}
          allDevices={allDevices}
          onSelectDevice={(id) => {
            const found = allDevices.find((d) => d.deviceId === id);
            if (found) {
              setDevice(found);
              if (userEmail) {
                const cleanEmail = userEmail.trim().toLowerCase();
                localStorage.setItem(`oxynity_last_selected_pond_${cleanEmail}`, id);
              }
            }
          }}
          onOpenAddDevice={() => setActiveTab('addDevice')}
          isFirebaseConnected={isFirebaseConnected}
          onOpenGuide={() => setIsGuideOpen(true)}
          onOpenAlerts={() => setIsAlertsOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          unreadAlertCount={unreadAlertCount}
          userEmail={userEmail}
          userName={userName}
          onLogout={handleLogout}
          onOpenLogin={() => setShowLoginPage(true)}
          isOnline={isRealEspOnline}
          statusText={espStatusText}
        />

        {/* Scrollable Mobile Main Content Viewport */}
        <main
          ref={mainContentRef}
          className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden px-3 sm:px-3.5 py-3 space-y-4 pb-20 overscroll-contain"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {!hasLinkedDevice && activeTab !== 'addDevice' && (
            <div className="bg-[#0E7C86]/10 border border-[#0E7C86]/30 text-[#0E7C86] dark:text-[#19C3D1] p-3.5 rounded-2xl text-xs font-bold flex items-center justify-between">
              <span>⚠️ Please link your ESP32 device first to view the live dashboard.</span>
              <button
                onClick={() => setActiveTab('addDevice')}
                className="px-3 py-1 bg-[#0E7C86] dark:bg-[#19C3D1] text-white dark:text-[#0B2B33] rounded-xl text-xs font-black shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
              >
                Add Device
              </button>
            </div>
          )}

          {/* 1. Home Dashboard (Multi-Pond, Animated Aquatic Tank & Bubbler Button & Sensor Suite) */}
          {(activeTab === 'home' || activeTab === 'dashboard') && (
            <PondDashboard
              allDevices={allDevices}
              activeDevice={device}
              onSelectDevice={setDevice}
              onTogglePower={(status, targetId) => handleTogglePower(status, 'Manual App Control', targetId)}
              onToggleAutoMode={(enabled) => updateDeviceInFirebase({ autoMode: enabled })}
              onOverrideCooldown={handleOverrideCooldown}
              onCancelCooldown={handleCancelCooldown}
              isUpdating={isUpdating}
              onOpenAddDevice={() => setActiveTab('addDevice')}
              sensorsEnabled={sensorsEnabled}
              isOnline={isSimulatingOffline ? false : (!isFirebaseConnected ? false : undefined)}
              onDeletePond={handleDeletePond}
              onEditPondName={handleEditPondName}
              onUpdateSchedules={handleUpdateSchedules}
            />
          )}

          {/* 2. Reports View (Daily/Weekly/Monthly bar chart, stats, StartStopLogCard & multi-period CSV download) */}
          {(activeTab === 'reports' || activeTab === 'analytics') && (
            <ReportsView
              device={device}
              startStopLogs={startStopLogs}
              telemetryHistory={telemetryHistory}
              userName={userName || 'Operator'}
              sensorsEnabled={sensorsEnabled}
              tempUnit={tempUnit}
            />
          )}

          {/* 3. Sensors View (Live animated sensors, toggles, schedules) */}
          {activeTab === 'sensors' && (
            <SensorsView
              device={device}
              onUpdateThresholds={(th) => {
                updateDeviceInFirebase({
                  minDoAlert: th.minDoAlert,
                  targetDo: th.targetDo,
                });
              }}
              onUpdateSchedules={handleUpdateSchedules}
              isOnline={isRealEspOnline}
              sensorsEnabled={sensorsEnabled}
              onToggleSensor={handleToggleSensor}
            />
          )}

          {/* 4. Service View (Maintenance requests, telephone support hotline) */}
          {activeTab === 'service' && (
            <ServiceView
              device={device}
              userName={userName}
              userEmail={userEmail}
            />
          )}

          {/* Add Device Modal/View */}
          {activeTab === 'addDevice' && (
            <AddDevice
              currentDevice={device}
              allDevices={allDevices}
              userEmail={userEmail}
              onSelectDevice={(dev) => {
                setDevice(dev);
                const cleanEmail = (userEmail || 'operator@oxynity.com').trim().toLowerCase();
                localStorage.setItem(`oxynity_last_selected_pond_${cleanEmail}`, dev.deviceId);
                setHasLinkedDevice(true);
                setActiveTab('home');
              }}
              onAddNewDevice={(newDev) => {
                const cleanEmail = (userEmail || 'operator@oxynity.com').trim().toLowerCase();
                setUserLinkedPondIds((prev) => Array.from(new Set([...prev, newDev.deviceId])));
                setAllDevices((prev) => {
                  if (prev.some((d) => d.deviceId === newDev.deviceId)) return prev;
                  return [...prev, newDev];
                });
                setDevice(newDev);
                localStorage.setItem(`oxynity_last_selected_pond_${cleanEmail}`, newDev.deviceId);
                setHasLinkedDevice(true);
                setActiveTab('home');
              }}
              onBackToDashboard={() => setActiveTab('home')}
            />
          )}

          {/* Full Settings Modal */}
          {activeTab === 'settings' && (
            <SettingsModal
              device={device}
              onSaveSettings={(updatedFields) => updateDeviceInFirebase(updatedFields)}
              userEmail={userEmail}
              userName={userName}
              userRole={userRole}
              onLogout={handleLogout}
              onDeleteAccount={handleDeleteAccount}
              onDeletePond={handleDeletePond}
              onSwitchToAdmin={
                (userRole === 'admin' || userEmail?.toLowerCase().includes('admin'))
                  ? () => setUserRole('admin')
                  : undefined
              }
            />
          )}
        </main>

        {/* Mobile Bottom Navigation: Home, Reports, Sensors, Service */}
        <BottomNav activeTab={activeTab} onChangeTab={handleTabChange} hasDeviceLinked={hasLinkedDevice} />
      </div>

      {/* Slide-up Settings Sheet */}
      <SettingsSheet
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        device={device}
        userEmail={userEmail}
        userName={userName}
        onLogout={handleLogout}
        onOpenAddDevice={() => {
          setIsSettingsOpen(false);
          setActiveTab('addDevice');
        }}
        onOpenFullSettings={() => {
          setIsSettingsOpen(false);
          setActiveTab('settings');
        }}
        isSimulatingOffline={isSimulatingOffline}
        onToggleSimulateOffline={() => setIsSimulatingOffline((v) => !v)}
        tempUnit={tempUnit}
        onUpdateTempUnit={setTempUnit}
        onTestLowOxygen={() => {
          const testAlert: DeviceAlert = {
            id: `alert-${Date.now()}`,
            title: 'Critical DO Warning (< 3.5 mg/L)',
            message: 'Automated test: Dissolved oxygen dropped below safe biological threshold!',
            timestamp: new Date().toISOString(),
            severity: 'critical',
            read: false,
          };
          setAlerts((prev) => [testAlert, ...prev]);
          sendLocalNotification(
            'Oxynity Alert: Critical DO Level',
            'Automated test: Dissolved oxygen dropped below safe biological threshold!'
          );
        }}
      />

      {/* Guided Help Modal */}
      <QuickGuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />

      {/* System Alerts Modal */}
      <AlertsModal
        isOpen={isAlertsOpen}
        onClose={() => setIsAlertsOpen(false)}
        alerts={alerts}
        onMarkAllRead={() => setAlerts((prev) => prev.map((a) => ({ ...a, read: true })))}
      />
    </div>
  );
}
