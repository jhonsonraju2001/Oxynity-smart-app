import React, { useState } from 'react';
import { X, ShieldCheck, FileText, Lock, MapPin, Bell, Database, ExternalLink } from 'lucide-react';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'privacy' | 'terms' | 'datasafety';
}

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'privacy',
}) => {
  const [activeTab, setActiveTab] = useState<'privacy' | 'terms' | 'datasafety'>(defaultTab);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Legal & Data Safety
              </h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Google Play Compliant Disclosures
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex px-4 pt-3 gap-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('privacy')}
            className={`pb-2 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
              activeTab === 'privacy'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('datasafety')}
            className={`pb-2 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
              activeTab === 'datasafety'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            Data Safety & Permissions
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('terms')}
            className={`pb-2 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
              activeTab === 'terms'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            Terms of Service
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          {activeTab === 'privacy' && (
            <div className="space-y-3">
              <div className="p-3 bg-sky-50 dark:bg-sky-950/40 border border-sky-100 dark:border-sky-900/60 rounded-2xl">
                <span className="font-bold text-sky-800 dark:text-sky-300 block mb-0.5">
                  Oxynity Smart Privacy Commitment
                </span>
                <span className="text-[11px] text-sky-700/90 dark:text-sky-400/90">
                  Effective Date: September 28, 2026. We collect only what is strictly required to power your aquaculture machinery and keep your dissolved oxygen levels safe.
                </span>
              </div>

              <h4 className="font-bold text-slate-800 dark:text-slate-100 text-xs">1. Information We Collect</h4>
              <p>
                <strong>Personal Data:</strong> We collect your Name and Email Address during registration to authenticate your mobile session and verify access to your specific ESP32 pond controller.
              </p>
              <p>
                <strong>Location Data:</strong> When you tap &quot;Calibrate Pond Location&quot; in the GPRS Map, the app requests high-accuracy GPS coordinates to anchor your pond. <em>We do not track your location in the background or sell location records.</em>
              </p>
              <p>
                <strong>Pond IoT Telemetry:</strong> Real-time Dissolved Oxygen (mg/L), cellular signal quality (CSQ), cellular tower LAC/CID, and dual-relay hardware switch states.
              </p>

              <h4 className="font-bold text-slate-800 dark:text-slate-100 text-xs">2. How Data Is Handled & Stored</h4>
              <p>
                All data is encrypted in transit using <strong>HTTPS / TLS 1.3</strong>. Cloud telemetry is stored in Google Cloud Firestore with AES-256 encryption at rest.
              </p>

              <h4 className="font-bold text-slate-800 dark:text-slate-100 text-xs">3. Account & Data Deletion Rights</h4>
              <p>
                You can delete your account and all associated telemetry directly from the app (Settings &rarr; Delete Account &amp; Wipe Data) or by emailing <span className="font-mono text-sky-600">support@oxynity.com</span>.
              </p>
            </div>
          )}

          {activeTab === 'datasafety' && (
            <div className="space-y-3">
              <h4 className="font-bold text-slate-800 dark:text-slate-100 text-xs">
                Google Play Data Safety Disclosures
              </h4>

              <div className="space-y-2">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200 block">
                      Approximate & Precise Location
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                      <strong>Purpose:</strong> App functionality (Calibrating pond coordinates). Collected only on user tap. Not shared with third parties.
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 flex items-start gap-3">
                  <Lock className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200 block">
                      User Email & Name
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                      <strong>Purpose:</strong> Account authentication and multi-user device authorization. Encrypted in transit via TLS.
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 flex items-start gap-3">
                  <Bell className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200 block">
                      Push & Local Notifications
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                      <strong>Purpose:</strong> Critical dissolved oxygen alerts and machinery fault warnings.
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 flex items-start gap-3">
                  <Database className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200 block">
                      Security & Encryption Standards
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                      Data is encrypted in transit using HTTPS/TLS 1.3. User data can be deleted anytime on request.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'terms' && (
            <div className="space-y-3">
              <h4 className="font-bold text-slate-800 dark:text-slate-100 text-xs">Terms of Service</h4>
              <p>
                <strong>1. Intended Use:</strong> Oxynity Smart is engineered for real-time monitoring and control of aquaculture micro-nano bubble generators, aeration pumps, and dissolved oxygen sensors.
              </p>
              <p>
                <strong>2. Hardware Operational Responsibility:</strong> While Oxynity Smart provides high-reliability cloud telemetry over 2G GPRS and automated switch controls, operators remain responsible for electrical safety, probe calibration, and backup pond power infrastructure.
              </p>
              <p>
                <strong>3. Service Availability:</strong> Cloud synchronization depends on active cellular network availability at the pond site.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-400">
            Oxynity Smart &copy; 2026
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-xs"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
};
