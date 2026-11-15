import React from 'react';
import { Bell, X, Info, AlertTriangle, ShieldAlert, CheckCircle } from 'lucide-react';
import { DeviceAlert } from '../types/iot';

interface AlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: DeviceAlert[];
  onMarkAllRead: () => void;
}

export const AlertsModal: React.FC<AlertsModalProps> = ({ isOpen, onClose, alerts, onMarkAllRead }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400 rounded-xl">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                System & DO Alerts
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Live Hardware Events & Warning Log</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alerts List */}
        <div className="p-5 space-y-2 overflow-y-auto flex-1">
          {alerts.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              No alerts logged yet. Everything running smoothly!
            </div>
          ) : (
            alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3 rounded-xl border text-xs space-y-1 transition-all ${
                  alert.severity === 'critical'
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60 text-rose-900 dark:text-rose-200'
                    : alert.severity === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200'
                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between font-bold">
                  <div className="flex items-center gap-1.5">
                    {alert.severity === 'critical' ? (
                      <ShieldAlert className="w-4 h-4 text-rose-500" />
                    ) : alert.severity === 'warning' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    ) : (
                      <Info className="w-4 h-4 text-sky-500" />
                    )}
                    <span>{alert.title}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-normal">
                    {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug pl-5">
                  {alert.message}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center shrink-0">
          <button
            onClick={onMarkAllRead}
            className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer min-h-[40px] px-2 flex items-center"
          >
            Mark all as read
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer min-h-[40px]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
