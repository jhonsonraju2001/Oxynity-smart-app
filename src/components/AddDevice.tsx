import React, { useState } from 'react';
import { doc, setDoc, getDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { DeviceTelemetry } from '../types/iot';
import { initialDeviceData } from '../data/initialDevice';
import {
  ArrowLeft,
  Cpu,
  Wifi,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  PlusCircle,
  Radio,
} from 'lucide-react';

interface AddDeviceProps {
  currentDevice?: DeviceTelemetry;
  allDevices: DeviceTelemetry[];
  onSelectDevice: (device: DeviceTelemetry) => void;
  onAddNewDevice: (newDevice: DeviceTelemetry) => void;
  onBackToDashboard: () => void;
  userEmail?: string;
}

export const AddDevice: React.FC<AddDeviceProps> = ({
  currentDevice,
  allDevices,
  onSelectDevice,
  onAddNewDevice,
  onBackToDashboard,
  userEmail,
}) => {
  const [pondId, setPondId] = useState('');
  const [pondName, setPondName] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [location, setLocation] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleLinkDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPondId = pondId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');

    if (!cleanPondId) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid Pond ID from your ESP32 device.' });
      return;
    }

    if (!pondName.trim()) {
      setStatusMessage({ type: 'error', text: 'Please enter a Pond Name.' });
      return;
    }

    setIsLinking(true);
    setStatusMessage(null);

    const cleanUserEmail = (userEmail || 'operator@oxynity.com').trim().toLowerCase();
    const docRef = doc(db, 'devices', cleanPondId);

    const customDevice: DeviceTelemetry = {
      ...initialDeviceData,
      deviceId: cleanPondId,
      name: pondName.trim() || `Pond ${cleanPondId}`,
      locationName: location.trim() || 'Farm Area A',
      ownerEmail: cleanUserEmail,
      linkedEmails: [cleanUserEmail],
      updatedAt: new Date().toISOString(),
    };

    // 0a. Verify against devices loaded in memory
    const conflictInLoaded = allDevices.find(
      (d) =>
        d.deviceId.toUpperCase() === cleanPondId &&
        d.ownerEmail &&
        d.ownerEmail.trim().toLowerCase() !== cleanUserEmail &&
        (!Array.isArray(d.linkedEmails) || !d.linkedEmails.some((e) => e.trim().toLowerCase() === cleanUserEmail))
    );
    if (conflictInLoaded) {
      setStatusMessage({
        type: 'error',
        text: 'This pond ID is already linked with another account.',
      });
      setIsLinking(false);
      return;
    }

    try {
      // 0b. Ownership Isolation: Verify Pond ID is not registered to another user account in Firestore
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        const existingData = existingSnap.data() as DeviceTelemetry;
        const existingOwner = existingData.ownerEmail?.trim().toLowerCase();
        const existingLinked = Array.isArray(existingData.linkedEmails)
          ? existingData.linkedEmails.map((e) => e.trim().toLowerCase())
          : [];

        if (existingOwner && existingOwner !== cleanUserEmail && !existingLinked.includes(cleanUserEmail)) {
          setStatusMessage({
            type: 'error',
            text: 'This pond ID is already linked with another account.',
          });
          setIsLinking(false);
          return;
        }
      }

      // 1. Save device record directly to Firestore database under doc ID = Pond ID
      await setDoc(docRef, customDevice, { merge: true });

      // 2. Link this pond ID to the user's account in Firestore
      const userDocRef = doc(db, 'users', cleanUserEmail);
      await setDoc(
        userDocRef,
        {
          email: cleanUserEmail,
          linkedPondIds: arrayUnion(cleanPondId),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});

      // 3. Save to user-scoped local storage for instant offline access
      const userPondsKey = `oxynity_user_ponds_${cleanUserEmail}`;
      const savedPondsStr = localStorage.getItem(userPondsKey);
      let userPonds: string[] = [];
      try {
        if (savedPondsStr) userPonds = JSON.parse(savedPondsStr);
      } catch {}
      if (!userPonds.includes(cleanPondId)) {
        userPonds.push(cleanPondId);
        localStorage.setItem(userPondsKey, JSON.stringify(userPonds));
      }
      localStorage.setItem(`oxynity_has_linked_device_${cleanUserEmail}`, 'true');
      localStorage.setItem(`oxynity_last_selected_pond_${cleanUserEmail}`, cleanPondId);

      onAddNewDevice(customDevice);
      onSelectDevice(customDevice);

      setStatusMessage({
        type: 'success',
        text: `Device "${pondName}" (${cleanPondId}) linked to your account in Real Time!`,
      });

      // Clear form
      setPondId('');
      setPondName('');
      setIpAddress('');
      setLocation('');
    } catch (err: any) {
      if (err?.message === 'OWNERSHIP_CONFLICT') {
        setIsLinking(false);
        return;
      }
      console.warn('Firebase setup fallback:', err);
      // Double check before falling back to local pairing:
      const conflictDevice = allDevices.find(
        (d) =>
          d.deviceId.toUpperCase() === cleanPondId &&
          d.ownerEmail &&
          d.ownerEmail.trim().toLowerCase() !== cleanUserEmail
      );
      if (conflictDevice) {
        setStatusMessage({
          type: 'error',
          text: 'This pond ID is already linked with another account.',
        });
        setIsLinking(false);
        return;
      }

      // Local pairing fallback scoped to user email
      const userPondsKey = `oxynity_user_ponds_${cleanUserEmail}`;
      const savedPondsStr = localStorage.getItem(userPondsKey);
      let userPonds: string[] = [];
      try {
        if (savedPondsStr) userPonds = JSON.parse(savedPondsStr);
      } catch {}
      if (!userPonds.includes(cleanPondId)) {
        userPonds.push(cleanPondId);
        localStorage.setItem(userPondsKey, JSON.stringify(userPonds));
      }
      localStorage.setItem(`oxynity_has_linked_device_${cleanUserEmail}`, 'true');
      localStorage.setItem(`oxynity_last_selected_pond_${cleanUserEmail}`, cleanPondId);

      onAddNewDevice(customDevice);
      onSelectDevice(customDevice);
      setStatusMessage({
        type: 'success',
        text: `Device "${pondName}" linked locally to your account!`,
      });
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-4">
      {/* 1. TOP HEADER BANNER */}
      <div className="bg-gradient-to-r from-sky-500 via-sky-600 to-cyan-500 text-white rounded-2xl p-4 flex items-center gap-3 shadow-md">
        <button
          onClick={onBackToDashboard}
          className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all active:scale-90"
          title="Back to Dashboard"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <h1 className="text-xl font-black text-white tracking-tight">Add Device</h1>
      </div>

      {/* 2. LINK ESP32 DEVICE FORM CARD */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-7 border border-slate-100 dark:border-slate-800 shadow-sm text-center">
        {/* Chip Icon Header */}
        <div className="w-16 h-16 bg-sky-50 dark:bg-sky-950/80 rounded-2xl flex items-center justify-center mx-auto mb-3 text-sky-500">
          <Cpu className="w-8 h-8 text-sky-500 stroke-[2]" />
        </div>

        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">
          Link ESP32 Device
        </h2>
        <p className="text-xs text-slate-400 dark:text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
          Enter the unique Pond ID from your ESP32 device to link it to your account
        </p>

        {/* Form Inputs */}
        <form onSubmit={handleLinkDevice} className="space-y-4 mt-6 text-left">
          {/* Field 1: Pond ID */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              Pond ID from ESP32 *
            </label>
            <input
              type="text"
              placeholder="e.g.  POND_ML4ZUZGN_E0E4"
              value={pondId}
              onChange={(e) => setPondId(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 text-slate-900 dark:text-slate-100 text-sm font-mono focus:ring-2 focus:ring-sky-500 focus:bg-white dark:focus:bg-slate-900 transition-all font-medium"
            />
          </div>

          {/* Field 2: Pond Name */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              Pond Name *
            </label>
            <input
              type="text"
              placeholder="e.g. Main Pond"
              value={pondName}
              onChange={(e) => setPondName(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 focus:bg-white dark:focus:bg-slate-900 transition-all font-medium"
            />
          </div>

          {/* Field 3: Device IP Address */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              Device IP Address *
            </label>
            <input
              type="text"
              placeholder="e.g. 192.168.1.101"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 text-slate-900 dark:text-slate-100 text-sm font-mono focus:ring-2 focus:ring-sky-500 focus:bg-white dark:focus:bg-slate-900 transition-all font-medium"
            />
          </div>

          {/* Field 4: Location (Optional) */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              Location (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Farm Area A"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 focus:bg-white dark:focus:bg-slate-900 transition-all font-medium"
            />
          </div>

          {/* Status Alert Banner */}
          {statusMessage && (
            <div
              className={`p-3.5 rounded-2xl text-xs font-medium flex items-center gap-2 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800'
                  : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Link Device Button */}
          <button
            type="submit"
            disabled={isLinking}
            className="w-full py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-base flex items-center justify-center gap-2 shadow-md hover:shadow-sky-500/25 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
          >
            {isLinking ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Linking Device...</span>
              </>
            ) : (
              <>
                <Wifi className="w-5 h-5 stroke-[2.5]" />
                <span>Link Device</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* 3. WHERE TO FIND POND ID INFO CARD */}
      <div className="bg-sky-500 text-white rounded-3xl p-5 shadow-sm space-y-1">
        <h3 className="font-extrabold text-sm tracking-tight text-white flex items-center gap-1.5">
          Where to find Pond ID?
        </h3>
        <p className="text-xs text-sky-50 leading-relaxed font-medium">
          Your ESP32 generates a unique Pond ID on first boot. Check the serial monitor output or the device label.
        </p>
      </div>

      {/* 4. LINKED DEVICES LIST / SWITCHER */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Radio className="w-4 h-4 text-sky-500" /> Linked Devices ({allDevices.length})
          </span>
          <span className="text-[11px] text-slate-400">Tap to select</span>
        </div>

        {allDevices.length === 0 ? (
          <div className="py-4 text-center text-xs text-slate-400 dark:text-slate-500 font-medium">
            No devices linked to your account yet. Use the form above to link your ESP32.
          </div>
        ) : (
          <div className="space-y-2">
            {allDevices.map((dev) => {
              const isSelected = currentDevice?.deviceId ? dev.deviceId === currentDevice.deviceId : false;
              return (
                <div
                  key={dev.deviceId}
                  onClick={() => onSelectDevice(dev)}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-800 ring-2 ring-sky-500/20'
                      : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${dev.status === 'ON' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                      <Cpu className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100">{dev.name}</h4>
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{dev.deviceId}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      dev.status === 'ON' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}>
                      {dev.status === 'ON' ? 'RUNNING' : 'OFF'}
                    </span>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-sky-500" />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
