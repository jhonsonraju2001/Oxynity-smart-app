import React, { useState } from 'react';
import {
  AdminNotificationDispatch,
  AdminNotificationRecipient,
  AdminUser,
  DeviceTelemetry,
} from '../../types/iot';
import { sendLocalNotification } from '../../lib/notifications';
import {
  Bell,
  Send,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCw,
  Search,
  Filter,
  Users,
  Radio,
  Check,
  AlertCircle,
  Sparkles,
  RefreshCw,
  MessageSquare,
} from 'lucide-react';

interface AdminNotificationsHubProps {
  initialDispatches: AdminNotificationDispatch[];
  allUsers: AdminUser[];
  allPonds: DeviceTelemetry[];
  onDispatchesUpdated?: (dispatches: AdminNotificationDispatch[]) => void;
}

export const AdminNotificationsHub: React.FC<AdminNotificationsHubProps> = ({
  initialDispatches,
  allUsers,
  allPonds,
  onDispatchesUpdated,
}) => {
  const [dispatches, setDispatches] = useState<AdminNotificationDispatch[]>(() => {
    try {
      const saved = localStorage.getItem('oxynity_admin_notifications');
      if (saved) return JSON.parse(saved);
    } catch {}
    return initialDispatches;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<'ALL' | 'critical' | 'warning' | 'info'>('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'unnotified' | 'all_read'>('ALL');

  // Compose State
  const [composeForm, setComposeForm] = useState({
    title: '',
    message: '',
    severity: 'critical' as 'critical' | 'warning' | 'info',
    targetAudience: 'all' as 'all' | 'specific_user' | 'specific_pond',
    targetPondId: '',
    targetUserEmail: '',
  });

  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [resentDispatchId, setResentDispatchId] = useState<string | null>(null);

  const saveDispatches = (updated: AdminNotificationDispatch[]) => {
    setDispatches(updated);
    try {
      localStorage.setItem('oxynity_admin_notifications', JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }
    if (onDispatchesUpdated) onDispatchesUpdated(updated);
  };

  // Dispatch new notification
  const handleSendNotification = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeForm.title.trim() || !composeForm.message.trim()) return;

    setIsSending(true);

    // Build recipient list based on audience
    let targetRecipients: AdminNotificationRecipient[] = [];

    if (composeForm.targetAudience === 'all') {
      targetRecipients = allUsers.map((u) => ({
        userId: u.id,
        userEmail: u.email,
        userName: u.name,
        pondId: u.assignedPondIds[0] || 'Unassigned',
        status: 'unnotified',
        deliveredAt: new Date().toISOString(),
      }));
    } else if (composeForm.targetAudience === 'specific_user') {
      const foundUser = allUsers.find((u) => u.email === composeForm.targetUserEmail) || allUsers[0];
      targetRecipients = [
        {
          userId: foundUser.id,
          userEmail: foundUser.email,
          userName: foundUser.name,
          pondId: foundUser.assignedPondIds[0] || 'Unassigned',
          status: 'unnotified',
          deliveredAt: new Date().toISOString(),
        },
      ];
    } else {
      // specific_pond
      const matchingUsers = allUsers.filter((u) =>
        u.assignedPondIds.includes(composeForm.targetPondId)
      );
      targetRecipients = (matchingUsers.length > 0 ? matchingUsers : [allUsers[0]]).map((u) => ({
        userId: u.id,
        userEmail: u.email,
        userName: u.name,
        pondId: composeForm.targetPondId,
        status: 'unnotified',
        deliveredAt: new Date().toISOString(),
      }));
    }

    const newDispatch: AdminNotificationDispatch = {
      id: `ntf-${Date.now()}`,
      title: composeForm.title.trim(),
      message: composeForm.message.trim(),
      severity: composeForm.severity,
      targetAudience: composeForm.targetAudience,
      targetPondId: composeForm.targetPondId || undefined,
      targetUserEmail: composeForm.targetUserEmail || undefined,
      createdAt: new Date().toISOString(),
      recipients: targetRecipients,
      resendCount: 0,
    };

    // Trigger Native Mobile Push Notification
    sendLocalNotification(
      `${composeForm.severity === 'critical' ? '🚨 ' : composeForm.severity === 'warning' ? '⚠️ ' : 'ℹ️ '}${newDispatch.title}`,
      newDispatch.message
    );

    saveDispatches([newDispatch, ...dispatches]);

    setIsSending(false);
    setSendSuccess(true);
    setComposeForm({
      title: '',
      message: '',
      severity: 'critical',
      targetAudience: 'all',
      targetPondId: '',
      targetUserEmail: '',
    });
    setTimeout(() => setSendSuccess(false), 3000);
  };

  // Key User Requirement: "we sent the notification when user was not notified"
  // Resend notification exclusively to recipients who haven't read/acknowledged
  const handleResendToUnnotified = (dispatchId: string) => {
    const target = dispatches.find((d) => d.id === dispatchId);
    if (!target) return;

    const unnotifiedRecipients = target.recipients.filter((r) => r.status === 'unnotified');
    if (unnotifiedRecipients.length === 0) {
      alert('All recipients have already read and acknowledged this notification!');
      return;
    }

    // Trigger escalated push notification
    sendLocalNotification(
      `🔔 REMINDER (URGENT): ${target.title}`,
      `High priority follow-up: ${target.message}`
    );

    const updated = dispatches.map((d) => {
      if (d.id === dispatchId) {
        return {
          ...d,
          resendCount: (d.resendCount ?? 0) + 1,
          lastResentAt: new Date().toISOString(),
          // Update delivered time for unnotified recipients
          recipients: d.recipients.map((r) =>
            r.status === 'unnotified'
              ? { ...r, deliveredAt: new Date().toISOString() }
              : r
          ),
        };
      }
      return d;
    });

    saveDispatches(updated);
    setResentDispatchId(dispatchId);
    setTimeout(() => setResentDispatchId(null), 3000);
  };

  // Mark recipient as read (simulate operator opening notification)
  const handleSimulateUserRead = (dispatchId: string, userEmail: string) => {
    const updated = dispatches.map((d) => {
      if (d.id === dispatchId) {
        return {
          ...d,
          recipients: d.recipients.map((r) =>
            r.userEmail === userEmail
              ? { ...r, status: 'read' as const, readAt: new Date().toISOString() }
              : r
          ),
        };
      }
      return d;
    });
    saveDispatches(updated);
  };

  // Calculate unnotified across all active dispatches
  const totalUnnotifiedCount = dispatches.reduce(
    (acc, d) => acc + d.recipients.filter((r) => r.status === 'unnotified').length,
    0
  );

  const totalDeliveredCount = dispatches.reduce((acc, d) => acc + d.recipients.length, 0);

  // Filter Dispatches
  const filteredDispatches = dispatches.filter((d) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      d.title.toLowerCase().includes(q) ||
      d.message.toLowerCase().includes(q) ||
      d.recipients.some((r) => r.userName.toLowerCase().includes(q) || r.userEmail.toLowerCase().includes(q));

    const matchSev = filterSeverity === 'ALL' || d.severity === filterSeverity;

    const hasUnnotified = d.recipients.some((r) => r.status === 'unnotified');
    const matchStatus =
      filterStatus === 'ALL'
        ? true
        : filterStatus === 'unnotified'
        ? hasUnnotified
        : !hasUnnotified;

    return matchSearch && matchSev && matchStatus;
  });

  return (
    <div className="space-y-4 animate-in fade-in select-none">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Bell className="w-5 h-5 text-sky-600" />
            Alert Dispatch & Delivery Tracking Center
          </h2>
          <p className="text-xs text-slate-500 font-medium">
            Send critical alerts, monitor delivery status, and re-dispatch alerts to unnotified operators
          </p>
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-extrabold uppercase text-slate-400 block">Total Dispatches</span>
          <span className="text-xl font-black text-slate-900 font-mono mt-0.5 block">{dispatches.length}</span>
        </div>

        <div className="bg-white p-3 rounded-2xl border border-amber-200 bg-amber-50/20 shadow-xs">
          <span className="text-[10px] font-extrabold uppercase text-amber-700 block">Unnotified Users</span>
          <span className="text-xl font-black text-amber-600 font-mono mt-0.5 block">
            {totalUnnotifiedCount}
          </span>
          <span className="text-[9px] text-amber-600 font-bold">Needs Attention</span>
        </div>

        <div className="bg-white p-3 rounded-2xl border border-emerald-200 bg-emerald-50/20 shadow-xs">
          <span className="text-[10px] font-extrabold uppercase text-emerald-700 block">Read & Confirmed</span>
          <span className="text-xl font-black text-emerald-600 font-mono mt-0.5 block">
            {totalDeliveredCount - totalUnnotifiedCount} / {totalDeliveredCount}
          </span>
          <span className="text-[9px] text-emerald-600 font-bold">Delivery Success</span>
        </div>
      </div>

      {/* COMPOSE NOTIFICATION CARD */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-sky-600" />
            <h3 className="text-xs sm:text-sm font-black text-slate-900">
              Compose & Dispatch Alert to Pond Operators
            </h3>
          </div>
          <span className="text-[10px] text-sky-700 font-extrabold bg-sky-50 px-2 py-0.5 rounded-lg border border-sky-200">
            Native Push + In-App
          </span>
        </div>

        {sendSuccess && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-2xl flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Notification dispatched successfully to all targeted recipients!</span>
          </div>
        )}

        <form onSubmit={handleSendNotification} className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">Target Audience</label>
              <select
                value={composeForm.targetAudience}
                onChange={(e) => setComposeForm({ ...composeForm, targetAudience: e.target.value as any })}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-white"
              >
                <option value="all">Broadcast to All Operators ({allUsers.length} Users)</option>
                <option value="specific_pond">Specific Pond Basin</option>
                <option value="specific_user">Specific Operator</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">Alert Severity</label>
              <select
                value={composeForm.severity}
                onChange={(e) => setComposeForm({ ...composeForm, severity: e.target.value as any })}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-white"
              >
                <option value="critical">🚨 Critical Low DO / Power Failure</option>
                <option value="warning">⚠️ Warning / High Weather Advisory</option>
                <option value="info">ℹ️ Info / Maintenance Notice</option>
              </select>
            </div>
          </div>

          {composeForm.targetAudience === 'specific_pond' && (
            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">Select Pond Basin</label>
              <select
                required
                value={composeForm.targetPondId}
                onChange={(e) => setComposeForm({ ...composeForm, targetPondId: e.target.value })}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-white"
              >
                <option value="">Choose a pond device...</option>
                {allPonds.map((p) => (
                  <option key={p.deviceId} value={p.deviceId}>
                    {p.deviceId} - {p.name} ({p.locationName})
                  </option>
                ))}
              </select>
            </div>
          )}

          {composeForm.targetAudience === 'specific_user' && (
            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">Select User Email</label>
              <select
                required
                value={composeForm.targetUserEmail}
                onChange={(e) => setComposeForm({ ...composeForm, targetUserEmail: e.target.value })}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-white"
              >
                <option value="">Choose operator account...</option>
                {allUsers.map((u) => (
                  <option key={u.id} value={u.email}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-[11px] font-bold text-slate-700 block mb-1">Notification Title *</label>
            <input
              type="text"
              required
              placeholder="e.g. Critical Low DO Alert (Below 4.5 ppm) - Immediate Inspection Needed"
              value={composeForm.title}
              onChange={(e) => setComposeForm({ ...composeForm, title: e.target.value })}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-700 block mb-1">Alert Message *</label>
            <textarea
              rows={2}
              required
              placeholder="Describe the condition, safe action steps, and urgency..."
              value={composeForm.message}
              onChange={(e) => setComposeForm({ ...composeForm, message: e.target.value })}
              className="w-full p-2.5 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isSending}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-600 via-cyan-600 to-sky-700 hover:from-sky-700 hover:to-cyan-800 text-white font-extrabold flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>{isSending ? 'Dispatching...' : 'Dispatch Instant Notification'}</span>
          </button>
        </form>
      </div>

      {/* FILTER DISPATCHES */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search sent alerts by title, operator name or pond ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-4 bg-white rounded-2xl border border-slate-200 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all shadow-xs"
          />
        </div>

        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 gap-1 text-xs">
          <button
            type="button"
            onClick={() => setFilterStatus('ALL')}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
              filterStatus === 'ALL'
                ? 'bg-white text-sky-700 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            All Logs ({dispatches.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('unnotified')}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
              filterStatus === 'unnotified'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-500 hover:text-amber-800'
            }`}
          >
            Has Unnotified
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('all_read')}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
              filterStatus === 'all_read'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-500 hover:text-emerald-800'
            }`}
          >
            All Read
          </button>
        </div>
      </div>

      {/* SENT NOTIFICATIONS DELIVERY TRACKER */}
      <div className="space-y-3.5">
        <div className="flex items-center justify-between text-xs font-bold text-slate-600 px-1">
          <span>DELIVERY & READ TRACKER ({filteredDispatches.length})</span>
          <span className="text-[10px] text-sky-600 font-extrabold flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Live Sync
          </span>
        </div>

        {filteredDispatches.map((disp) => {
          const unnotifiedList = disp.recipients.filter((r) => r.status === 'unnotified');
          const hasUnnotified = unnotifiedList.length > 0;
          const isJustResent = resentDispatchId === disp.id;

          const sevStyle =
            disp.severity === 'critical'
              ? 'bg-rose-100 text-rose-800 border-rose-200'
              : disp.severity === 'warning'
              ? 'bg-amber-100 text-amber-800 border-amber-200'
              : 'bg-sky-100 text-sky-800 border-sky-200';

          return (
            <div
              key={disp.id}
              className={`bg-white rounded-3xl border transition-all p-4 space-y-3 shadow-xs ${
                hasUnnotified ? 'border-amber-300 bg-amber-50/10' : 'border-slate-200'
              }`}
            >
              {/* Dispatch Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 pr-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase border ${sevStyle}`}>
                      {disp.severity}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(disp.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {new Date(disp.createdAt).toLocaleDateString()}
                    </span>
                    {disp.resendCount && disp.resendCount > 0 ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-purple-50 text-purple-700 border border-purple-200">
                        Resent {disp.resendCount}x
                      </span>
                    ) : null}
                  </div>
                  <h4 className="text-sm font-extrabold text-slate-900 leading-snug mt-1">{disp.title}</h4>
                </div>

                {/* RESEND TO UNNOTIFIED USERS BUTTON */}
                {hasUnnotified && (
                  <button
                    type="button"
                    onClick={() => handleResendToUnnotified(disp.id)}
                    className="px-3 py-1.5 bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-700 hover:to-rose-700 text-white text-xs font-black rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0 animate-pulse"
                    title="Resend alert immediately to operators who haven't read/acknowledged"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Resend to ({unnotifiedList.length}) Unnotified</span>
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-600 leading-relaxed font-medium">{disp.message}</p>

              {isJustResent && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-800 font-bold flex items-center gap-1.5 animate-in fade-in">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Alert re-dispatched to {unnotifiedList.length} unnotified operators!</span>
                </div>
              )}

              {/* Recipient Delivery Status Breakdown */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                  Recipient Acknowledgment Status ({disp.recipients.length})
                </span>

                <div className="divide-y divide-slate-100 bg-slate-50 rounded-2xl p-2.5 border border-slate-200 text-xs">
                  {disp.recipients.map((rec, idx) => {
                    const isRead = rec.status === 'read';
                    const isDelivered = rec.status === 'delivered';

                    return (
                      <div
                        key={idx}
                        className="py-2 flex items-center justify-between gap-2 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-slate-800 truncate">{rec.userName}</span>
                            <span className="text-[10px] text-slate-400 font-mono truncate max-w-[140px]">
                              ({rec.userEmail})
                            </span>
                          </div>
                          {rec.pondId && (
                            <span className="text-[10px] text-sky-700 font-mono font-bold block">
                              Pond: {rec.pondId}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold flex items-center gap-1 border ${
                              isRead
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                : isDelivered
                                ? 'bg-sky-100 text-sky-800 border-sky-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200 font-black'
                            }`}
                          >
                            {isRead ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600 stroke-[3]" />
                                <span>Read</span>
                              </>
                            ) : isDelivered ? (
                              <>
                                <CheckCircle2 className="w-3 h-3 text-sky-600" />
                                <span>Delivered</span>
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="w-3 h-3 text-amber-600" />
                                <span>Unnotified</span>
                              </>
                            )}
                          </span>

                          {!isRead && (
                            <button
                              type="button"
                              onClick={() => handleSimulateUserRead(disp.id, rec.userEmail)}
                              className="text-[10px] text-slate-400 hover:text-slate-600 underline font-semibold cursor-pointer"
                              title="Mark as Read"
                            >
                              Mark Read
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}

        {filteredDispatches.length === 0 && (
          <div className="p-8 text-center text-slate-400 bg-white rounded-3xl border border-dashed border-slate-200 text-xs">
            No dispatch records matching your filter. Use the form above to send an alert.
          </div>
        )}
      </div>
    </div>
  );
};
