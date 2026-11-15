import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Save,
  Check,
  Lock,
  KeyRound,
  ShieldCheck,
  Trash2,
  AlertTriangle,
  Mail,
  User,
  Eye,
  EyeOff,
  Bell,
  MapPin,
  Database,
  ExternalLink,
  Cpu,
  LogOut,
  Sparkles,
  Plus,
  Calculator,
  Gauge,
  Timer,
  RotateCcw,
  Moon,
  Sun,
  Thermometer,
} from 'lucide-react';
import {
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { DeviceTelemetry, DoCalibrationPoint } from '../types/iot';
import { PrivacyPolicyModal } from './PrivacyPolicyModal';

interface SettingsModalProps {
  device?: DeviceTelemetry;
  onSaveSettings: (updatedFields: Partial<DeviceTelemetry>) => void;
  userEmail?: string;
  userName?: string;
  userRole?: 'operator' | 'admin';
  onLogout?: () => void;
  onDeleteAccount?: () => Promise<void>;
  onSwitchToAdmin?: () => void;
  onDeletePond?: (pondId: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  device,
  onSaveSettings,
  userEmail,
  userName,
  userRole = 'operator',
  onLogout,
  onDeleteAccount,
  onSwitchToAdmin,
  onDeletePond,
}) => {
  // Navigation tabs within Settings
  const [activeTab, setActiveTab] = useState<'machinery' | 'security' | 'privacy'>('machinery');
  const [showUnlinkPondModal, setShowUnlinkPondModal] = useState(false);

  // Device & Sensor states (initialized if device exists)
  const [name, setName] = useState(device?.name || '');
  const [locationName, setLocationName] = useState(device?.locationName || '');
  const [targetDo, setTargetDo] = useState(device?.targetDo ?? 8.5);
  const [minDoAlert, setMinDoAlert] = useState(device?.minDoAlert ?? 5.0);
  const [maxDoAlert, setMaxDoAlert] = useState(device?.maxDoAlert ?? 12.0);
  const [autoMode, setAutoMode] = useState(device?.autoMode ?? false);
  const [doSensorEnabled, setDoSensorEnabled] = useState(device?.doSensorEnabled !== false);
  const [cooldownEnabled, setCooldownEnabled] = useState(device?.cooldownEnabled !== false);
  const [saved, setSaved] = useState(false);
  const [calibrating, setCalibrating] = useState<string | null>(null);

  // Multi-point calibration state (1 to 5 points)
  interface CalPointRow {
    id: string;
    pointNum: number;
    meterDo: string; // Keeps input as string while editing to prevent snap-backs or deleting decimal points
    voltageMv: string;
    timestamp: string;
  }

  // Theme & Temperature Preferences
  const [themeMode, setThemeMode] = useState<'auto' | 'light' | 'dark'>(() => {
    return (localStorage.getItem('oxynity_theme') as any) || 'auto';
  });
  const [tempUnit, setTempUnit] = useState<'C' | 'F'>(() => {
    return (localStorage.getItem('oxynity_temp_unit') as any) || 'C';
  });

  const handleUpdateTheme = (mode: 'auto' | 'light' | 'dark') => {
    setThemeMode(mode);
    localStorage.setItem('oxynity_theme', mode);
    if (mode === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (mode === 'light') {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  };

  const handleUpdateTempUnit = (unit: 'C' | 'F') => {
    setTempUnit(unit);
    localStorage.setItem('oxynity_temp_unit', unit);
    window.dispatchEvent(new CustomEvent('oxynity_temp_unit_change', { detail: unit }));
  };

  const [calPoints, setCalPoints] = useState<CalPointRow[]>(() => {
    if (device?.doCalibrationPoints && device.doCalibrationPoints.length > 0) {
      return device.doCalibrationPoints.map((p) => ({
        id: p.id,
        pointNum: p.pointNum,
        meterDo: String(p.meterDo),
        voltageMv: String(p.voltageMv),
        timestamp: p.timestamp,
      }));
    }
    return [
      {
        id: 'pt-1',
        pointNum: 1,
        meterDo: '4.40',
        voltageMv: String((device?.voltageMv ?? 1370.0).toFixed(1)),
        timestamp: new Date().toISOString(),
      },
    ];
  });
  const [calSuccessMsg, setCalSuccessMsg] = useState<string | null>(null);
  const [calErrorMsg, setCalErrorMsg] = useState<string | null>(null);
  const [calculatedSlope, setCalculatedSlope] = useState<number>(device?.doSlopeK ?? 0.003212);
  const [calculatedZero, setCalculatedZero] = useState<number>(device?.doZeroMv ?? 0.0);

  // Change Password states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdMessage, setPwdMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Account Deletion confirmation modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Privacy Policy modal state
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [privacyModalTab, setPrivacyModalTab] = useState<'privacy' | 'terms' | 'datasafety'>('privacy');

  // Prevent background 2-second telemetry polling from resetting user form inputs
  const loadedDeviceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (device && device.deviceId && loadedDeviceIdRef.current !== device.deviceId) {
      loadedDeviceIdRef.current = device.deviceId;
      setName(device.name || '');
      setLocationName(device.locationName || '');
      setTargetDo(device.targetDo ?? 8.5);
      setMinDoAlert(device.minDoAlert ?? 5.0);
      setMaxDoAlert(device.maxDoAlert ?? 12.0);
      setAutoMode(device.autoMode ?? false);
      setDoSensorEnabled(device.doSensorEnabled !== false);
      setCooldownEnabled(device.cooldownEnabled !== false);
      if (device.doCalibrationPoints && device.doCalibrationPoints.length > 0) {
        setCalPoints(
          device.doCalibrationPoints.map((p) => ({
            id: p.id,
            pointNum: p.pointNum,
            meterDo: String(p.meterDo),
            voltageMv: String(p.voltageMv),
            timestamp: p.timestamp,
          }))
        );
      }
      if (device.doSlopeK) {
        setCalculatedSlope(device.doSlopeK);
      }
      if (device.doZeroMv !== undefined) {
        setCalculatedZero(device.doZeroMv);
      }
    }
  }, [device?.deviceId]);

  const handleToggleSensor = (enabled: boolean) => {
    setDoSensorEnabled(enabled);
    onSaveSettings({ doSensorEnabled: enabled });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleToggleCooldown = (enabled: boolean) => {
    setCooldownEnabled(enabled);
    if (device?.deviceId) {
      localStorage.setItem(`oxynity_cooldown_enabled_${device.deviceId}`, String(enabled));
    }
    onSaveSettings({ cooldownEnabled: enabled });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveDeviceSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!device) return;
    onSaveSettings({
      name,
      locationName,
      targetDo: Number(targetDo),
      minDoAlert: Number(minDoAlert),
      maxDoAlert: Number(maxDoAlert),
      autoMode,
      doSensorEnabled,
      cooldownEnabled,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAddCalPoint = () => {
    if (calPoints.length >= 5) return;
    const nextNum = calPoints.length + 1;
    const newPt: CalPointRow = {
      id: `pt-${Date.now()}-${nextNum}`,
      pointNum: nextNum,
      meterDo: '', // Start empty so the user can easily enter their reading without deleting anything
      voltageMv: String((device?.voltageMv ?? 1370.0).toFixed(1)),
      timestamp: new Date().toISOString(),
    };
    setCalPoints([...calPoints, newPt]);
    setCalErrorMsg(null);
  };

  const handleRemoveCalPoint = (index: number) => {
    if (calPoints.length <= 1) return;
    const updated = calPoints.filter((_, i) => i !== index).map((pt, i) => ({
      ...pt,
      pointNum: i + 1,
    }));
    setCalPoints(updated);
    setCalErrorMsg(null);
  };

  const handleUpdateCalPoint = (index: number, field: 'meterDo' | 'voltageMv', val: string) => {
    setCalPoints((prev) =>
      prev.map((pt, i) => (i === index ? { ...pt, [field]: val } : pt))
    );
    setCalErrorMsg(null);
  };

  const handleCaptureLiveVoltage = (index: number) => {
    const liveV = device?.voltageMv ?? 1370.0;
    handleUpdateCalPoint(index, 'voltageMv', liveV.toFixed(1));
  };

  const handleCalculateAndSaveCalibration = () => {
    setCalErrorMsg(null);
    if (calPoints.length === 0) return;

    // Validate that all points have valid positive numbers
    for (let i = 0; i < calPoints.length; i++) {
      const pt = calPoints[i];
      const doVal = parseFloat(pt.meterDo);
      if (isNaN(doVal) || doVal <= 0 || doVal > 25) {
        setCalErrorMsg(`Please enter a valid digital DO meter reading (e.g. 4.40 mg/L) for Point ${i + 1}.`);
        return;
      }
      const vVal = parseFloat(pt.voltageMv);
      if (isNaN(vVal) || vVal <= 50) {
        setCalErrorMsg(`Please enter or capture a valid sensor voltage (> 50 mV) for Point ${i + 1}.`);
        return;
      }
    }

    const numericPoints: DoCalibrationPoint[] = calPoints.map((p) => ({
      id: p.id,
      pointNum: p.pointNum,
      meterDo: parseFloat(p.meterDo),
      voltageMv: parseFloat(p.voltageMv),
      timestamp: p.timestamp,
    }));

    let computedSlope = 0.003212;
    let computedZero = 0.0;

    if (numericPoints.length === 1) {
      const pt = numericPoints[0];
      const deltaV = pt.voltageMv > 0 ? pt.voltageMv : 1415.0;
      computedSlope = pt.meterDo / deltaV;
      computedZero = 0.0;
    } else {
      // Check if user measured a true zero-oxygen point (meterDo < 0.5)
      const hasZeroPoint = numericPoints.some((p) => p.meterDo < 0.5);
      if (hasZeroPoint) {
        const n = numericPoints.length;
        let sumV = 0, sumDo = 0, sumV2 = 0, sumVDo = 0;
        for (const p of numericPoints) {
          sumV += p.voltageMv;
          sumDo += p.meterDo;
          sumV2 += p.voltageMv * p.voltageMv;
          sumVDo += p.voltageMv * p.meterDo;
        }
        const denominator = n * sumV2 - sumV * sumV;
        if (Math.abs(denominator) > 0.0001) {
          const m = (n * sumVDo - sumV * sumDo) / denominator;
          const c = (sumDo - m * sumV) / n;
          if (m > 0) {
            computedSlope = m;
            computedZero = Math.max(0, -c / m);
          } else {
            computedSlope = sumDo / sumV;
            computedZero = 0.0;
          }
        } else {
          computedSlope = sumDo / sumV;
          computedZero = 0.0;
        }
      } else {
        // Origin-Constrained Linear Regression (DO = K * V, Zero = 0.0 mV)
        // Eliminates false zero offset and ensures DO strictly tracks probe voltage proportional to meter reading
        let sumV2 = 0;
        let sumVDo = 0;
        for (const p of numericPoints) {
          sumV2 += p.voltageMv * p.voltageMv;
          sumVDo += p.voltageMv * p.meterDo;
        }
        computedSlope = sumV2 > 0 ? sumVDo / sumV2 : numericPoints[0].meterDo / numericPoints[0].voltageMv;
        computedZero = 0.0;
      }
    }

    const roundedSlope = Number(computedSlope.toFixed(6));
    const roundedZero = Number(computedZero.toFixed(2));
    setCalculatedSlope(roundedSlope);
    setCalculatedZero(roundedZero);

    // Compute updated DO level immediately from live probe voltage
    const liveMv = device?.voltageMv ?? 1370.0;
    const newDoLevel = Number(Math.max(0, (liveMv - roundedZero) * roundedSlope).toFixed(2));

    if (device?.deviceId) {
      localStorage.setItem(`oxynity_calibrated_slope_${device.deviceId}`, String(roundedSlope));
      localStorage.setItem(`oxynity_calibrated_zero_${device.deviceId}`, String(roundedZero));
      localStorage.setItem(`oxynity_is_calibrated_${device.deviceId}`, 'true');
      localStorage.setItem(`oxynity_calibrated_do_${device.deviceId}`, String(newDoLevel));
    }

    onSaveSettings({
      doSlopeK: roundedSlope,
      doZeroMv: roundedZero,
      doCalibrationPoints: numericPoints,
      isDoCalibrated: true,
      doLevel: newDoLevel,
    });

    setCalSuccessMsg(`✅ Calibrated ${numericPoints.length} point(s)! New DO: ${newDoLevel.toFixed(2)} ppm.`);
    setTimeout(() => setCalSuccessMsg(null), 4000);
  };

  // Change Password Handler
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMessage(null);

    if (!newPassword || newPassword.length < 6) {
      setPwdMessage({ type: 'error', text: 'New password must be at least 6 characters long.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.email) {
      setPwdMessage({
        type: 'error',
        text: 'No active session found. Please sign in again.',
      });
      return;
    }

    setPwdLoading(true);

    try {
      if (currentPassword) {
        const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
        await reauthenticateWithCredential(currentUser, credential);
      }

      await updatePassword(currentUser, newPassword);
      setPwdMessage({ type: 'success', text: 'Password successfully updated!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.warn('Update password error:', err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPwdMessage({ type: 'error', text: 'Current password is incorrect.' });
      } else if (err.code === 'auth/requires-recent-login') {
        try {
          await sendPasswordResetEmail(auth, currentUser.email);
          setPwdMessage({
            type: 'success',
            text: 'Security notice: Password reset link sent to your email. Check your inbox.',
          });
        } catch {
          setPwdMessage({
            type: 'error',
            text: 'Please log out and log back in, then retry changing your password.',
          });
        }
      } else {
        setPwdMessage({
          type: 'error',
          text: err.message?.replace('Firebase: ', '') || 'Failed to update password.',
        });
      }
    } finally {
      setPwdLoading(false);
    }
  };

  // Send Reset Link to Inbox
  const handleSendResetLink = async () => {
    const emailToUse = userEmail || auth.currentUser?.email;
    if (!emailToUse) {
      setPwdMessage({ type: 'error', text: 'No registered email found.' });
      return;
    }
    setPwdLoading(true);
    setPwdMessage(null);
    try {
      await sendPasswordResetEmail(auth, emailToUse);
      setPwdMessage({
        type: 'success',
        text: `Password reset link sent to ${emailToUse}. Check your email!`,
      });
    } catch (err: any) {
      setPwdMessage({
        type: 'error',
        text: err.message?.replace('Firebase: ', '') || 'Could not send reset email.',
      });
    } finally {
      setPwdLoading(false);
    }
  };

  // Confirm Account Deletion
  const handleConfirmAccountDeletion = async () => {
    setIsDeleting(true);
    try {
      if (onDeleteAccount) {
        await onDeleteAccount();
      } else {
        if (auth.currentUser) {
          await auth.currentUser.delete().catch(() => {});
        }
        if (onLogout) onLogout();
      }
    } catch (err: any) {
      alert(`Account deletion notice: ${err.message || 'Please contact support@oxynity.com'}`);
      if (onLogout) onLogout();
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Settings Navigation Tabs */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-1 sm:p-1.5 shadow-xs grid grid-cols-3 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('machinery')}
          className={`min-w-0 py-2 px-1.5 sm:px-2.5 rounded-xl text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer ${
            activeTab === 'machinery'
              ? 'bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
          title="Machinery & DO Settings"
        >
          <Cpu className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
          <span className="truncate">Machinery</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`min-w-0 py-2 px-1.5 sm:px-2.5 rounded-xl text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer ${
            activeTab === 'security'
              ? 'bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
          title="Security & Password"
        >
          <KeyRound className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
          <span className="truncate">Security</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('privacy')}
          className={`min-w-0 py-2 px-1.5 sm:px-2.5 rounded-xl text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer ${
            activeTab === 'privacy'
              ? 'bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
          title="Data Safety & Privacy"
        >
          <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
          <span className="truncate">Data Safety</span>
        </button>
      </div>

      {/* TAB 1: MACHINERY & DO SENSOR SETTINGS */}
      {activeTab === 'machinery' && (
        <>
          {!device || !device.deviceId ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 text-center space-y-3">
              <Settings className="w-10 h-10 text-slate-400 dark:text-slate-500 mx-auto" />
              <h3 className="text-base font-bold text-slate-800 dark:text-white">No Linked Pond</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Please link your ESP32 device in the &quot;Add Device&quot; tab first to customize DO limits and relay configurations.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSaveDeviceSettings}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs transition-all space-y-4"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 shrink-0">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                      Generator & Sensor Settings
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Pond: <span className="font-mono font-bold text-sky-600">{device.deviceId}</span>
                    </p>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full sm:w-auto px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {saved ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-300" />
                      <span>Saved to Firebase!</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Save Settings</span>
                    </>
                  )}
                </button>
              </div>

              {/* General Info */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    1. Pond Identification & Rename
                  </h4>
                  <span className="text-[10px] font-mono text-slate-400">
                    ID: {device?.deviceId}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                      Pond Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. North Fingerling Pond"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                      Farm Area / Location
                    </label>
                    <input
                      type="text"
                      value={locationName}
                      onChange={(e) => setLocationName(e.target.value)}
                      placeholder="e.g. Sector 4 East"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                {/* Theme & Temperature Display Preferences */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                        <Moon className="w-3.5 h-3.5 text-sky-500" />
                        <span>Theme Mode</span>
                      </span>
                      <span className="text-[10px] font-bold text-sky-600 capitalize">{themeMode}</span>
                    </div>
                    <div className="flex bg-slate-200/80 dark:bg-slate-900/80 p-1 rounded-xl border border-slate-200 dark:border-slate-800 gap-1">
                      {(['auto', 'light', 'dark'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => handleUpdateTheme(mode)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-extrabold capitalize transition-all cursor-pointer ${
                            themeMode === mode
                              ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                        <Thermometer className="w-3.5 h-3.5 text-amber-500" />
                        <span>Temperature Unit</span>
                      </span>
                      <span className="text-[10px] font-bold text-amber-600">°{tempUnit}</span>
                    </div>
                    <div className="flex bg-slate-200/80 dark:bg-slate-900/80 p-1 rounded-xl border border-slate-200 dark:border-slate-800 gap-1">
                      {(['C', 'F'] as const).map((unit) => (
                        <button
                          key={unit}
                          type="button"
                          onClick={() => handleUpdateTempUnit(unit)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                            tempUnit === unit
                              ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                          }`}
                        >
                          °{unit} ({unit === 'C' ? 'Celsius' : 'Fahrenheit'})
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* DO Sensor & Target Levels */}
              <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    2. Dissolved Oxygen & Hardware Sensor
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {doSensorEnabled ? 'Sensor Active' : 'Sensor Disabled'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleSensor(!doSensorEnabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        doSensorEnabled ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                          doSensorEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {doSensorEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                        Target DO Level (mg/L)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        max="20"
                        value={targetDo}
                        onChange={(e) => setTargetDo(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 text-sky-600 dark:text-sky-400 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                        Low DO Alarm (mg/L)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="10"
                        value={minDoAlert}
                        onChange={(e) => setMinDoAlert(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 text-rose-600 dark:text-rose-400 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-rose-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                        High DO Limit (mg/L)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="10"
                        max="20"
                        value={maxDoAlert}
                        onChange={(e) => setMaxDoAlert(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 text-amber-600 dark:text-amber-400 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Multi-Point DO Sensor Calibration */}
              {doSensorEnabled && (
                <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gauge className="w-4 h-4 text-sky-500" />
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                        3. Digital DO Meter Multi-Point Calibration
                      </h4>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                      {calPoints.length}/5 Points
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Submerge your probe and handheld digital DO meter together. Enter the reading from your digital DO meter and capture the probe voltage. Add 2 to 5 points to calibrate the curve.
                  </p>

                  {/* Live Probe Telemetry Card */}
                  <div className="bg-sky-50/70 dark:bg-sky-950/40 p-3 rounded-xl border border-sky-100 dark:border-sky-900 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Live Sensor Reading</span>
                      <span className="font-extrabold text-sky-700 dark:text-sky-300 text-sm">
                        {device?.doLevel !== undefined && device.doLevel >= 0 ? `${device.doLevel.toFixed(2)} mg/L` : 'Connecting...'}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500 dark:text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Live Probe Voltage</span>
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                        {(device?.voltageMv ?? 1370.0).toFixed(1)} mV
                      </span>
                    </div>
                  </div>

                  {/* Points List */}
                  <div className="space-y-2">
                    {calPoints.map((pt, idx) => (
                      <div key={pt.id} className="bg-slate-50 dark:bg-slate-800/60 p-2.5 sm:p-3 rounded-xl border border-slate-200 dark:border-slate-700/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-sky-500 text-white font-black text-xs flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 shrink-0">
                            Point {idx + 1}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 grow max-w-sm">
                          <div>
                            <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">
                              Digital Meter (mg/L)
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="e.g. 4.40"
                              value={pt.meterDo}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                                  handleUpdateCalPoint(idx, 'meterDo', val);
                                }
                              }}
                              className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-100 rounded-lg border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-sky-500"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-0.5">
                              <label className="text-[10px] font-semibold text-slate-500">
                                Sensor (mV)
                              </label>
                              <button
                                type="button"
                                onClick={() => handleCaptureLiveVoltage(idx)}
                                className="text-[9px] text-sky-600 dark:text-sky-400 font-bold hover:underline cursor-pointer"
                              >
                                Capture Live
                              </button>
                            </div>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="1370.0"
                              value={pt.voltageMv}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                                  handleUpdateCalPoint(idx, 'voltageMv', val);
                                }
                              }}
                              className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 text-xs font-mono font-bold text-slate-800 dark:text-slate-100 rounded-lg border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-sky-500"
                            />
                          </div>
                        </div>

                        {calPoints.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveCalPoint(idx)}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg self-end sm:self-center transition-colors cursor-pointer"
                            title="Remove Point"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Buttons: Add Point & Calculate */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    {calPoints.length < 5 ? (
                      <button
                        type="button"
                        onClick={handleAddCalPoint}
                        className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Point {calPoints.length + 1}</span>
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400">Maximum 5 points reached</span>
                    )}

                    <button
                      type="button"
                      onClick={handleCalculateAndSaveCalibration}
                      className="px-4 py-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer ml-auto"
                    >
                      <Calculator className="w-3.5 h-3.5" />
                      <span>Apply Calibration to ESP32</span>
                    </button>
                  </div>

                  {/* Error Banner */}
                  {calErrorMsg && (
                    <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs font-bold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                      <span>{calErrorMsg}</span>
                    </div>
                  )}

                  {/* Success Banner */}
                  {calSuccessMsg && (
                    <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
                      <Check className="w-4 h-4 shrink-0 text-emerald-600" />
                      <span>{calSuccessMsg}</span>
                    </div>
                  )}

                  {/* Computed Parameters Card */}
                  <div className="bg-slate-100/70 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-400 flex flex-wrap justify-between gap-1">
                    <span>Slope K: <b className="text-sky-600 dark:text-sky-400">{calculatedSlope.toFixed(6)}</b> mg/L per mV</span>
                    <span>Zero Offset: <b className="text-slate-700 dark:text-slate-300">{calculatedZero.toFixed(1)}</b> mV</span>
                  </div>
                </div>
              )}

              {/* 4. Engine & Motor Cooldown Protection (6h Run / 30m Rest) */}
              <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Timer className="w-4 h-4 text-sky-500" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                        4. Motor Cooldown Protection
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        6-Hour Run / 30-Minute Rest Auto Cycle
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      {cooldownEnabled ? 'Protection Active' : 'Protection Disabled'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleCooldown(!cooldownEnabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        cooldownEnabled ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                          cooldownEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
                  <div className="flex items-start gap-2.5">
                    <RotateCcw className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      <p className="font-semibold text-slate-700 dark:text-slate-200">
                        How Automatic Cooldown Works:
                      </p>
                      <ul className="list-disc list-inside mt-1 space-y-1 text-slate-500 dark:text-slate-400">
                        <li>
                          When turned <b>ON</b>, the generator runs continuously for <b>6 hours</b>.
                        </li>
                        <li>
                          At 6 hours, it automatically takes a <b>30-minute cooling break</b> (both relays turn OFF) to prevent motor burnout.
                        </li>
                        <li>
                          After 30 minutes, it <b>automatically resumes</b> (Relay 1 ON, Relay 2 ON in 2 mins).
                        </li>
                        <li>
                          If you manually turn the machine <b>OFF before 6 hours</b>, cooldown will <b>not</b> trigger.
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px] text-slate-500">
                    <span>Status: <b className={cooldownEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>
                      {cooldownEnabled ? 'Cycle Active (6h on / 30m rest)' : 'Disabled (Continuous run)'}
                    </b></span>
                    <span>Safety Standard: IEEE 841 / Aqua-Grade</span>
                  </div>
                </div>
              </div>

              {/* 5. Pond Device Management & Unlink */}
              {device?.deviceId && onDeletePond && (
                <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Trash2 className="w-4 h-4 text-rose-500" />
                      <div>
                        <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                          5. Pond Device Management
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Unlink this pond from your account
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-slate-900 dark:text-slate-100 truncate">
                        Unlink {device.name || device.deviceId}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                        ID: {device.deviceId} {device.locationName ? `• ${device.locationName}` : ''}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowUnlinkPondModal(true)}
                      className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Unlink This Pond</span>
                    </button>
                  </div>
                </div>
              )}
            </form>
          )}
        </>
      )}

      {/* TAB 2: SECURITY & CHANGE PASSWORD */}
      {activeTab === 'security' && (
        <div className="space-y-4">
          {/* User Account Info Card */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-sky-500 text-white font-black flex items-center justify-center text-sm shadow-xs">
                {(userName || userEmail || 'O').charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {userName || (userRole === 'admin' ? 'System Administrator' : 'Operator')}
                </h4>
                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {userEmail || 'operator@oxynity.com'}
                </p>
              </div>
            </div>

            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
              {userRole}
            </span>
          </div>

          {/* Admin Dashboard Entry Card */}
          {onSwitchToAdmin && (
            <div className="bg-linear-to-r from-[#0E4D7A] to-[#0B2440] text-white p-4 rounded-2xl border border-sky-400/40 shadow-md flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#6CCBF2]" />
                  <b className="text-xs sm:text-sm font-black text-white">Oxynity Smart Admin Panel</b>
                </div>
                <span className="text-[11px] text-[#9DB8D0]">
                  Fleet Map, Multi-Pond Devices, Complaints &amp; Service Portal
                </span>
              </div>
              <button
                type="button"
                onClick={onSwitchToAdmin}
                className="px-3.5 py-2 rounded-xl bg-[#0E6FA3] hover:bg-[#133559] text-white text-xs font-bold transition-all shrink-0 cursor-pointer border border-sky-300/40 shadow-xs"
              >
                Open Admin Portal
              </button>
            </div>
          )}

          {/* Change Password Card */}
          <form
            onSubmit={handleChangePassword}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs space-y-3.5"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    Change Password
                  </h4>
                  <p className="text-[10px] text-slate-500">Update your account credentials</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSendResetLink}
                disabled={pwdLoading}
                className="text-[11px] font-bold text-sky-600 hover:text-sky-500 cursor-pointer"
              >
                Send Reset Link
              </button>
            </div>

            {pwdMessage && (
              <div
                className={`p-3 rounded-xl text-xs font-semibold flex items-start gap-2 ${
                  pwdMessage.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200'
                }`}
              >
                {pwdMessage.type === 'success' ? (
                  <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                )}
                <span>{pwdMessage.text}</span>
              </div>
            )}

            <div>
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Current Password (Optional if recently signed in)
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                New Password (minimum 6 characters)
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Confirm New Password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <button
              type="submit"
              disabled={pwdLoading}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {pwdLoading ? (
                <span>Updating password...</span>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Update Password</span>
                </>
              )}
            </button>
          </form>

          {/* Account Deletion & Wipe Card (Google Play Mandatory Requirement) */}
          <div className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/80 dark:border-rose-900/60 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-rose-800 dark:text-rose-200">
                  Delete Account & Wipe Farm Data
                </h4>
                <p className="text-[10px] text-rose-600/90 dark:text-rose-400/90">
                  Google Play user data deletion compliance
                </p>
              </div>
            </div>

            <p className="text-xs text-rose-700/90 dark:text-rose-300/80 leading-relaxed">
              Permanently removes your operator account, unlinks all connected ESP32 pond controllers, and wipes associated historical telemetry logs.
            </p>

            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete My Account & Data</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: DATA SAFETY & PRIVACY CENTER */}
      {activeTab === 'privacy' && (
        <div className="space-y-4">
          {/* Privacy & Legal Viewer Card */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    Privacy Policy & Disclosures
                  </h4>
                  <p className="text-[10px] text-slate-500">Google Play Data Safety Disclosures</p>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Oxynity Smart adheres strictly to Google Play Store data safety and user transparency standards. We collect only what is strictly necessary to run your aquaculture machinery and notify you of critical dissolved oxygen changes.
            </p>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setPrivacyModalTab('privacy');
                  setShowPrivacyModal(true);
                }}
                className="flex-1 py-2 px-3 bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 rounded-xl text-xs font-bold hover:bg-sky-100 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <span>View Privacy Policy</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setPrivacyModalTab('terms');
                  setShowPrivacyModal(true);
                }}
                className="flex-1 py-2 px-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <span>Terms of Service</span>
              </button>
            </div>
          </div>

          {/* Permissions Transparency Badges */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
              Permission Explanations
            </h4>

            <div className="space-y-2.5">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-start gap-3">
                <MapPin className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                    Location (GPS)
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                    Used only when you tap &quot;Calibrate Pond Location&quot; to anchor your pond coordinates. Location is never tracked in the background.
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-start gap-3">
                <Bell className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                    Notifications
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                    Used to sound alarms and show high-priority heads-up banners if dissolved oxygen drops below safe levels.
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-start gap-3">
                <Database className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                    End-to-End Encryption
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                    All telemetry and commands are encrypted in transit using HTTPS / TLS 1.3 and stored with AES-256 in Google Cloud Firestore.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Account Deletion Double Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1.5">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                Delete Account & Data?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                This will permanently delete your user profile (<span className="font-mono text-slate-700 dark:text-slate-300 font-bold">{userEmail}</span>) and clear associated pond assignments. This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAccountDeletion}
                disabled={isDeleting}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer transition-colors"
              >
                {isDeleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unlink Pond Confirmation Modal ── */}
      {showUnlinkPondModal && device?.deviceId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full border border-rose-200 dark:border-rose-900/60 shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-center justify-center mx-auto text-rose-500">
              <Trash2 className="w-7 h-7" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                Unlink & Delete Pond?
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                Are you sure you want to unlink <strong>{device.name || device.deviceId}</strong> from your account? You will no longer receive live telemetry or control this pond unless re-linked.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowUnlinkPondModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Keep Pond
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUnlinkPondModal(false);
                  onDeletePond?.(device.deviceId);
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs shadow-md transition-all cursor-pointer"
              >
                Yes, Unlink
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Privacy Policy Modal */}
      <PrivacyPolicyModal
        isOpen={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
        defaultTab={privacyModalTab}
      />
    </div>
  );
};
