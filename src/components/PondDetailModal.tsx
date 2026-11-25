// NOTE: not used anywhere (no screen opens it). Pond location is set by admin in Sensor setup & calibration.
// Kept for reference; safe to delete.
import React, { useState } from 'react';
import { DeviceTelemetry, PondContact } from '../types/iot';
import {
  X,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  Activity,
  Waves,
  Thermometer,
  Droplets,
  Gauge,
  Radio,
  Clock,
  CheckCircle2,
  AlertTriangle,
  User,
  Building,
  Edit2,
  Save,
  Lock,
  Navigation,
  Compass,
  Signal,
  Check,
} from 'lucide-react';

interface PondDetailModalProps {
  device: DeviceTelemetry | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateContact?: (deviceId: string, contact: PondContact) => void;
  onCalibrateLocation?: (
    lat: number,
    lng: number,
    locName: string,
    cellLac?: string,
    cellId?: string
  ) => Promise<void>;
  onResetCalibration?: () => Promise<void>;
}

export const PondDetailModal: React.FC<PondDetailModalProps> = ({
  device,
  isOpen,
  onClose,
  onUpdateContact,
  onCalibrateLocation,
  onResetCalibration,
}) => {
  if (!isOpen || !device) return null;

  const [activeTab, setActiveTab] = useState<'telemetry' | 'contact' | 'location'>('telemetry');
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);

  // Editable Contact State
  const defaultContact: PondContact = device.contactPerson || {
    name: 'Unassigned Contact',
    phone: '+91 98480 00000',
    email: 'contact@aquafarm.in',
    facilityName: device.name,
    address: device.locationName,
    emergencyNotes: 'No special emergency instructions recorded.',
  };

  const [contactForm, setContactForm] = useState<PondContact>(defaultContact);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationSuccess, setCalibrationSuccess] = useState(false);

  const handleSaveContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (onUpdateContact) {
      onUpdateContact(device.deviceId, contactForm);
    }
    setIsEditingContact(false);
    setContactSaved(true);
    setTimeout(() => setContactSaved(false), 2500);
  };

  const handleCalibratePhoneGps = async () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser/device.');
      return;
    }
    setIsCalibrating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          if (onCalibrateLocation) {
            await onCalibrateLocation(
              pos.coords.latitude,
              pos.coords.longitude,
              `${device.locationName} (Calibrated Anchor)`,
              device.cellLac,
              device.cellId
            );
          }
          setCalibrationSuccess(true);
          setTimeout(() => setCalibrationSuccess(false), 3000);
        } catch (err) {
          console.error(err);
        } finally {
          setIsCalibrating(false);
        }
      },
      (err) => {
        alert(`Location permission error: ${err.message}`);
        setIsCalibrating(false);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const isRunning = device.status === 'ON';
  const totalSecs = device.currentSessionSeconds ?? (device.currentSessionMinutes * 60);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in select-none">
      <div
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-sky-600 via-cyan-600 to-sky-700 text-white flex items-center justify-between shrink-0">
          <div className="min-w-0 pr-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-black bg-white/20 px-2 py-0.5 rounded-md tracking-wider uppercase">
                {device.deviceId}
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black ${
                  isRunning ? 'bg-emerald-400 text-emerald-950' : 'bg-slate-200 text-slate-800'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isRunning ? 'bg-emerald-900 animate-ping' : 'bg-slate-500'
                  }`}
                />
                {device.status}
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-black truncate mt-1 text-white">
              {device.name}
            </h3>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex bg-slate-100 p-1.5 border-b border-slate-200 gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('telemetry')}
            className={`flex-1 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'telemetry'
                ? 'bg-white text-sky-700 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Telemetry</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('contact')}
            className={`flex-1 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'contact'
                ? 'bg-white text-sky-700 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Contact Person</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('location')}
            className={`flex-1 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'location'
                ? 'bg-white text-sky-700 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Machine Location</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* TAB 1: MACHINERY & TELEMETRY */}
          {activeTab === 'telemetry' && (
            <div className="space-y-4">
              {/* Running Time Card */}
              <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200 space-y-2">
                <span className="text-[11px] font-extrabold uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-sky-600" />
                  Machine Session & Cumulative Run Time
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold block">Current Active Session</span>
                    <span className="text-sm font-black text-emerald-600 font-mono">
                      {String(hours).padStart(2, '0')}h : {String(mins).padStart(2, '0')}m : {String(secs).padStart(2, '0')}s
                    </span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold block">Total Lifetime Hours</span>
                    <span className="text-sm font-black text-slate-900 font-mono">
                      {(device.totalRunHours ?? 0).toFixed(2)} hrs
                    </span>
                  </div>
                </div>
              </div>

              {/* Water Quality Telemetry Grid */}
              <div className="space-y-2">
                <span className="text-[11px] font-extrabold uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                  <Waves className="w-3.5 h-3.5 text-sky-600" />
                  Live Sensor Telemetry
                </span>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-sky-50 p-2.5 rounded-xl border border-sky-200">
                    <span className="text-[10px] text-sky-700 font-extrabold block">DO Level</span>
                    <span className="text-sm font-black text-sky-800">
                      {device.doLevel === undefined || device.doLevel === null || device.doLevel < 0
                        ? 'MISSING'
                        : `${device.doLevel.toFixed(1)} ppm`}
                    </span>
                    <span className="text-[9px] text-sky-600 block mt-0.5">
                      Target: {(device.targetDo ?? 7.5).toFixed(1)}
                    </span>
                  </div>

                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-bold block">pH Level</span>
                    <span className="text-sm font-black text-slate-800 font-mono">
                      {device.phLevel !== undefined && device.phLevel !== null ? device.phLevel.toFixed(1) : '7.4'}
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">Safe 7.5–8.5</span>
                  </div>

                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-bold block">Temperature</span>
                    <span className="text-sm font-black text-slate-800 font-mono">
                      {(device.waterTemp ?? 28.4).toFixed(1)} °C
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">26–32 °C</span>
                  </div>

                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-bold block">ORP (Redox)</span>
                    <span className="text-sm font-black text-slate-800 font-mono">
                      {Math.round(device.orpLevel ?? 285)} mV
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">200–350 mV</span>
                  </div>

                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-bold block">Salinity</span>
                    <span className="text-sm font-black text-slate-800 font-mono">
                      {(device.salinity ?? 15.0).toFixed(1)} ppt
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">10–25 ppt</span>
                  </div>

                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-bold block">Fluid Flow</span>
                    <span className="text-sm font-black text-slate-800 font-mono">
                      {(device.flowRate ?? 35.0).toFixed(1)} L/m
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">{(device.pressure ?? 2.1).toFixed(1)} Bar</span>
                  </div>
                </div>
              </div>

              {/* Hardware Node Status */}
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200 text-xs space-y-2">
                <div className="flex items-center justify-between text-slate-600">
                  <span className="font-bold flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-sky-600" />
                    ESP32 GPRS Node
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{device.firmwareVersion}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 pt-1 border-t border-slate-200/80">
                  <span>GPRS Signal: <strong className="text-emerald-600 font-mono">{device.gprsSignal}% CSQ</strong></span>
                  <span>Auto DO Protection: <strong className="text-sky-600 font-bold">{device.autoMode ? 'ACTIVE' : 'MANUAL'}</strong></span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CONTACT PERSON DETAILS */}
          {activeTab === 'contact' && (
            <div className="space-y-4">
              {contactSaved && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-2xl flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Contact person details updated successfully!</span>
                </div>
              )}

              {!isEditingContact ? (
                <div className="space-y-3.5">
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-600 text-white font-black text-lg flex items-center justify-center shrink-0 shadow-md">
                          {contactForm.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h4 className="text-base font-black text-slate-900">{contactForm.name}</h4>
                          <span className="text-xs text-sky-700 font-bold flex items-center gap-1 mt-0.5">
                            <Building className="w-3 h-3 text-sky-600" />
                            {contactForm.facilityName || 'Aquaculture Facility'}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setIsEditingContact(true)}
                        className="px-3 py-1.5 bg-white hover:bg-slate-100 text-sky-700 text-xs font-extrabold rounded-xl border border-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    </div>

                    {/* Direct Contact Actions (Call & Email) */}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200">
                      <a
                        href={`tel:${contactForm.phone.replace(/\s+/g, '')}`}
                        className="p-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-extrabold flex items-center justify-center gap-2 transition-colors"
                      >
                        <Phone className="w-4 h-4 text-emerald-600" />
                        <span>Call Person</span>
                      </a>

                      <a
                        href={`mailto:${contactForm.email}?subject=Oxynity%20Alert%20for%20${encodeURIComponent(device.name)}`}
                        className="p-2.5 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 text-xs font-extrabold flex items-center justify-center gap-2 transition-colors"
                      >
                        <Mail className="w-4 h-4 text-sky-600" />
                        <span>Send Email</span>
                      </a>
                    </div>
                  </div>

                  {/* Details List */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 text-xs">
                    <div>
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Phone Number</span>
                      <span className="font-mono font-bold text-slate-800 text-sm mt-0.5 block">{contactForm.phone}</span>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Email Address</span>
                      <span className="font-medium text-slate-800 text-xs mt-0.5 block">{contactForm.email}</span>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Farm Address</span>
                      <span className="font-medium text-slate-700 leading-snug mt-0.5 block">{contactForm.address}</span>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Emergency Instructions</span>
                      <span className="font-medium text-slate-600 leading-snug mt-0.5 block">{contactForm.emergencyNotes}</span>
                    </div>
                  </div>
                </div>
              ) : (
                /* Edit Contact Form */
                <form onSubmit={handleSaveContact} className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <span className="font-extrabold text-slate-800">Edit Contact Information</span>
                    <button
                      type="button"
                      onClick={() => setIsEditingContact(false)}
                      className="text-slate-400 hover:text-slate-600 font-bold"
                    >
                      Cancel
                    </button>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-600 block mb-1">Contact Person Name</label>
                    <input
                      type="text"
                      required
                      value={contactForm.name}
                      onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 block mb-1">Phone Number</label>
                      <input
                        type="text"
                        required
                        value={contactForm.phone}
                        onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                        className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white font-mono text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 block mb-1">Email Address</label>
                      <input
                        type="email"
                        required
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                        className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-600 block mb-1">Farm / Facility Name</label>
                    <input
                      type="text"
                      value={contactForm.facilityName || ''}
                      onChange={(e) => setContactForm({ ...contactForm, facilityName: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-600 block mb-1">Address / Landmark</label>
                    <input
                      type="text"
                      value={contactForm.address || ''}
                      onChange={(e) => setContactForm({ ...contactForm, address: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-600 block mb-1">Emergency Notes</label>
                    <textarea
                      rows={2}
                      value={contactForm.emergencyNotes || ''}
                      onChange={(e) => setContactForm({ ...contactForm, emergencyNotes: e.target.value })}
                      className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Contact Changes</span>
                  </button>
                </form>
              )}
            </div>
          )}

          {/* TAB 3: MACHINE LOCATION & CALIBRATION */}
          {activeTab === 'location' && (
            <div className="space-y-4">
              {calibrationSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-2xl flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>GPS anchor locked successfully for this pond!</span>
                </div>
              )}

              {/* Location Card */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-black text-slate-900 leading-snug">{device.locationName}</h4>
                      <span className="text-[11px] text-slate-500 mt-0.5 block">{device.locationSource || 'SIMCom A7672S 4G LTE'}</span>
                    </div>
                  </div>

                  <a
                    href={`https://maps.google.com/?q=${device.latitude},${device.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold rounded-xl flex items-center gap-1.5 transition-colors shadow-xs shrink-0"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>Google Maps</span>
                  </a>
                </div>

                {/* GPS Coordinates & Cell Tower Info */}
                <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-200">
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold block uppercase">Latitude</span>
                    <span className="text-xs font-black text-slate-800 font-mono">{(device.latitude ?? 0).toFixed(6)}° N</span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold block uppercase">Longitude</span>
                    <span className="text-xs font-black text-slate-800 font-mono">{(device.longitude ?? 0).toFixed(6)}° E</span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold block uppercase">Cell Tower LAC</span>
                    <span className="text-xs font-bold text-slate-700 font-mono">{device.cellLac || '404-45-1204'}</span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold block uppercase">Cell Tower CID</span>
                    <span className="text-xs font-bold text-slate-700 font-mono">{device.cellId || '9841'}</span>
                  </div>
                </div>

                {/* Displacement / Moving Status */}
                <div className="bg-white p-3 rounded-xl border border-slate-200 text-xs flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block">Displacement from Anchor</span>
                    <span className="font-extrabold text-slate-800">
                      {device.moveDistanceKm ? `${device.moveDistanceKm.toFixed(2)} km` : '0.00 km (At Station)'}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      device.isCalibrated ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {device.isCalibrated ? 'Anchor Locked' : 'Cell Tower Estimate'}
                  </span>
                </div>
              </div>

              {/* Calibration Actions */}
              <div className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-2.5 text-xs">
                <span className="text-[11px] font-extrabold uppercase text-slate-600 block">
                  Pond Location Anchor Tools
                </span>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Stand beside this micro-nano bubble generator machine at the pond and tap calibrate to lock the phone's high-precision GPS as the reference anchor.
                </p>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleCalibratePhoneGps}
                    disabled={isCalibrating}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <Compass className={`w-4 h-4 ${isCalibrating ? 'animate-spin' : ''}`} />
                    <span>{isCalibrating ? 'Calibrating...' : 'Lock Phone GPS Anchor'}</span>
                  </button>

                  {device.isCalibrated && onResetCalibration && (
                    <button
                      type="button"
                      onClick={onResetCalibration}
                      className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-all cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span className="font-medium">Device: <strong className="text-slate-700 font-mono">{device.deviceId}</strong></span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-extrabold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
