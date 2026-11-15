import React, { useState, useEffect, useRef } from 'react';
import { Phone, Send, CheckCircle2, Clock, Wrench, MessageSquare, X, User, ShieldCheck } from 'lucide-react';
import { collection, doc, setDoc, onSnapshot, arrayUnion } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { DeviceTelemetry, ServiceRequest, ChatMessage } from '../types/iot';

interface ServiceViewProps {
  device: DeviceTelemetry;
  userName?: string;
  userEmail?: string;
}

const STORAGE_KEY = 'oxynity_service_requests';

const SEED_REQUESTS: ServiceRequest[] = [
  {
    id: 'SR-1002',
    type: 'Sensor issue',
    desc: 'pH probe reading drifts slightly after heavy rain. Needs cleaning check.',
    date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
    phone: '+91 98765 43210',
    status: 'In progress',
    stage: 2,
    deviceId: 'OXY-0113',
    pondName: 'North Fingerling Pond',
    farmer: 'Farmer Operator',
    messages: [
      {
        id: 'msg-seed-1',
        sender: 'client',
        senderName: 'Farmer Operator',
        text: 'pH probe reading drifts slightly after heavy rain. Needs cleaning check.',
        timestamp: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
      {
        id: 'msg-seed-2',
        sender: 'admin',
        senderName: 'Oxynity Support (Kiran)',
        text: 'Hello! Technician Kiran has been assigned. Please keep the probe submerged in clean pond water.',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
  },
  {
    id: 'SR-1001',
    type: 'Maintenance',
    desc: 'Routine scheduled six-month impeller & aeration tube inspection.',
    date: new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10),
    phone: '+91 98765 43210',
    status: 'Resolved',
    stage: 3,
    deviceId: 'OXY-0101',
    pondName: 'Venu Pond',
    farmer: 'Farmer Operator',
    messages: [
      {
        id: 'msg-seed-0',
        sender: 'client',
        senderName: 'Farmer Operator',
        text: 'Routine scheduled six-month impeller inspection.',
        timestamp: new Date(Date.now() - 20 * 86400000).toISOString(),
      },
    ],
  },
];

export const ServiceView: React.FC<ServiceViewProps> = ({ device, userName = 'Farmer Operator', userEmail }) => {
  const [requests, setRequests] = useState<ServiceRequest[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return SEED_REQUESTS;
  });

  const [reqType, setReqType] = useState('Maintenance');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [phone, setPhone] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Active Chat Modal State
  const [activeChatRequest, setActiveChatRequest] = useState<ServiceRequest | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isSendingMsg, setIsSendingMsg] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeChatRequest) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeChatRequest?.messages]);

  // Real-time Firestore Sync with fallback to local storage
  useEffect(() => {
    try {
      const colRef = collection(db, 'service_requests');
      const unsub = onSnapshot(
        colRef,
        (snap) => {
          if (!snap.empty) {
            const list: ServiceRequest[] = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as any),
            }));

            // Filter requests relevant to this user's pond or show all user's requests
            list.sort((a, b) => (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || ''));
            setRequests(list);
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
            } catch {}

            // Keep active chat modal in sync if open
            if (activeChatRequest) {
              const updated = list.find((r) => r.id === activeChatRequest.id);
              if (updated) setActiveChatRequest(updated);
            }
          }
        },
        (err) => {
          console.warn('Firestore service_requests live sync offline fallback:', err);
        }
      );
      return () => unsub();
    } catch (e) {
      console.warn('Could not set up Firestore service requests listener:', e);
    }
  }, [device.deviceId, activeChatRequest?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desc.trim()) {
      setErrorMsg('Please describe the problem.');
      return;
    }
    setErrorMsg('');

    const newId = `SR-${Date.now().toString().slice(-4)}`;
    const nowIso = new Date().toISOString();

    const newReq: ServiceRequest = {
      id: newId,
      type: reqType,
      desc: desc.trim(),
      date: date || nowIso.slice(0, 10),
      phone: phone.trim() || '+91 98480 00000',
      status: 'Open',
      stage: 0,
      deviceId: device.deviceId || 'OXY-DEFAULT',
      pondName: device.name || device.deviceId || 'Pond 1',
      farmer: userName || 'Farmer Operator',
      place: device.locationName || 'West Godavari',
      priority: reqType === 'Generator fault' ? 'High' : 'Medium',
      tech: 'Unassigned',
      source: 'Farmer app',
      createdAt: nowIso,
      messages: [
        {
          id: `msg-${Date.now()}`,
          sender: 'client',
          senderName: userName || 'Farmer Operator',
          text: desc.trim(),
          timestamp: nowIso,
        },
      ],
    };

    // Update local state and storage
    setRequests((prev) => [newReq, ...prev.filter((r) => r.id !== newReq.id)]);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([newReq, ...requests]));
    } catch {}

    // Save to Firestore so it appears in Admin Panel immediately
    try {
      const docRef = doc(db, 'service_requests', newReq.id);
      await setDoc(docRef, newReq, { merge: true });
    } catch (err) {
      console.warn('Could not save service request to Firestore:', err);
    }

    setDesc('');
    setPhone('');
    setSuccessMsg(`Service request ${newReq.id} submitted! Technician support has been notified.`);
    setTimeout(() => setSuccessMsg(''), 5000);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChatRequest || !chatInput.trim() || isSendingMsg) return;

    setIsSendingMsg(true);
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'client',
      senderName: userName || 'Farmer Operator',
      text: chatInput.trim(),
      timestamp: new Date().toISOString(),
    };

    const updatedRequest: ServiceRequest = {
      ...activeChatRequest,
      messages: [...(activeChatRequest.messages || []), newMsg],
    };

    setActiveChatRequest(updatedRequest);
    setRequests((prev) => prev.map((r) => (r.id === updatedRequest.id ? updatedRequest : r)));
    setChatInput('');

    try {
      const docRef = doc(db, 'service_requests', activeChatRequest.id);
      await setDoc(docRef, { messages: arrayUnion(newMsg) }, { merge: true });
    } catch (err) {
      console.warn('Could not sync chat message to Firestore:', err);
    } finally {
      setIsSendingMsg(false);
    }
  };

  return (
    <div className="space-y-4 select-none animate-in fade-in">
      {/* Title */}
      <div>
        <h2 className="text-xl sm:text-2xl font-black text-[#0B2B33] dark:text-[#E8F4F6] tracking-tight">
          Service Requests
        </h2>
        <p className="text-xs text-[#5B7479] dark:text-[#9DB8BD] mt-0.5">
          Request technician maintenance or report generator issues for {device.name || device.deviceId}
        </p>
      </div>

      {/* New Request Card */}
      <div className="bg-white dark:bg-[#12313A] rounded-[24px] p-4 sm:p-5 border border-[#DDE8EA] dark:border-[#1F4650] shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-[#0E7C86] dark:text-[#19C3D1]" />
          <h3 className="text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
            New service request
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Issue Type */}
          <div>
            <label className="block text-xs font-bold text-[#5B7479] dark:text-[#9DB8BD] mb-1">
              Request Type
            </label>
            <select
              value={reqType}
              onChange={(e) => setReqType(e.target.value)}
              className="w-full min-h-[46px] rounded-xl border-2 border-[#DDE8EA] dark:border-[#1F4650] bg-[#F2F7F8] dark:bg-[#071A1F] text-[#0B2B33] dark:text-[#E8F4F6] text-xs font-bold px-3 focus:outline-hidden focus:border-[#19C3D1]"
            >
              <option>Maintenance</option>
              <option>Sensor issue</option>
              <option>Generator fault</option>
              <option>Installation</option>
              <option>Other</option>
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-[#5B7479] dark:text-[#9DB8BD] mb-1">
              What is the problem?
            </label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Describe the issue with the generator, pump, or sensors"
              rows={3}
              className="w-full rounded-xl border-2 border-[#DDE8EA] dark:border-[#1F4650] bg-[#F2F7F8] dark:bg-[#071A1F] text-[#0B2B33] dark:text-[#E8F4F6] text-xs font-medium p-3 focus:outline-hidden focus:border-[#19C3D1] resize-none"
            />
          </div>

          {/* Preferred Date & Phone Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#5B7479] dark:text-[#9DB8BD] mb-1">
                Preferred Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full min-h-[46px] rounded-xl border-2 border-[#DDE8EA] dark:border-[#1F4650] bg-[#F2F7F8] dark:bg-[#071A1F] text-[#0B2B33] dark:text-[#E8F4F6] text-xs font-bold px-3 focus:outline-hidden focus:border-[#19C3D1]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#5B7479] dark:text-[#9DB8BD] mb-1">
                Contact Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 00000 00000"
                className="w-full min-h-[46px] rounded-xl border-2 border-[#DDE8EA] dark:border-[#1F4650] bg-[#F2F7F8] dark:bg-[#071A1F] text-[#0B2B33] dark:text-[#E8F4F6] text-xs font-bold px-3 focus:outline-hidden focus:border-[#19C3D1]"
              />
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs text-rose-500 font-bold" role="alert">
              {errorMsg}
            </p>
          )}

          {successMsg && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1.5" role="alert">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </p>
          )}

          {/* Action Buttons */}
          <div className="pt-1 space-y-2">
            <button
              type="submit"
              className="w-full min-h-[50px] rounded-2xl bg-[#0E7C86] hover:bg-[#0c6b73] text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md cursor-pointer active:scale-98 transition-all"
            >
              <Send className="w-4 h-4" />
              <span>Send request</span>
            </button>

            <a
              href="tel:+917382127722"
              className="w-full min-h-[48px] rounded-2xl bg-[#E6EFF1] dark:bg-[#08222A] hover:bg-[#DCE9EC] text-[#0B2B33] dark:text-[#E8F4F6] font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-all border border-[#DDE8EA] dark:border-[#1F4650]"
            >
              <Phone className="w-4 h-4 text-[#0E7C86] dark:text-[#19C3D1]" />
              <span>Call support (+91 7382127722)</span>
            </a>
          </div>
        </form>
      </div>

      {/* My Requests List Card */}
      <div className="bg-white dark:bg-[#12313A] rounded-[24px] p-4 sm:p-5 border border-[#DDE8EA] dark:border-[#1F4650] shadow-xs space-y-3">
        <h3 className="text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">
          My requests ({requests.length})
        </h3>

        <div className="divide-y divide-[#DDE8EA] dark:divide-[#1F4650]">
          {requests.map((q) => {
            const statusBadge =
              q.status === 'Resolved'
                ? { bg: 'bg-[#DFF4E8] dark:bg-[#12372A]', text: 'text-[#14673B] dark:text-[#7BE0A5]' }
                : q.status === 'In progress'
                ? { bg: 'bg-[#FDECC8] dark:bg-[#4A3510]', text: 'text-[#6B3F00] dark:text-[#FFD58A]' }
                : { bg: 'bg-[#FBE0E0] dark:bg-[#4A1A1A]', text: 'text-[#8A1C1C] dark:text-[#FFB4B4]' };

            const messageCount = (q.messages || []).length;
            const hasAdminReply = (q.messages || []).some((m) => m.sender === 'admin');

            return (
              <div key={q.id} className="py-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <b className="text-xs sm:text-sm font-black text-[#0B2B33] dark:text-[#E8F4F6]">
                      {q.id} · {q.type}
                    </b>
                    {hasAdminReply && (
                      <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 animate-pulse">
                        Admin Replied
                      </span>
                    )}
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${statusBadge.bg} ${statusBadge.text}`}
                  >
                    {q.status}
                  </span>
                </div>

                <p className="text-xs text-[#5B7479] dark:text-[#9DB8BD] leading-snug">
                  {q.desc}
                </p>

                <div className="flex items-center justify-between text-[10px] text-[#5B7479] dark:text-[#9DB8BD] pt-0.5 font-medium flex-wrap gap-2">
                  <span>Preferred: {q.date} · Phone: {q.phone}</span>

                  {/* Open Chat with Support Button */}
                  <button
                    type="button"
                    onClick={() => setActiveChatRequest(q)}
                    className="px-3 py-1.5 rounded-xl bg-[#0E7C86]/10 hover:bg-[#0E7C86]/20 text-[#0E7C86] dark:text-[#19C3D1] font-extrabold text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-[#0E7C86]/20"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chat with Support {messageCount > 0 ? `(${messageCount})` : ''}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Real-Time Two-Way Chat Modal ── */}
      {activeChatRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#12313A] rounded-[28px] max-w-md w-full border border-[#DDE8EA] dark:border-[#1F4650] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-[#DDE8EA] dark:border-[#1F4650] flex items-center justify-between bg-[#F2F7F8] dark:bg-[#071A1F]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#0E7C86] text-white flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-[#0B2B33] dark:text-[#E8F4F6] truncate">
                    Ticket {activeChatRequest.id}
                  </h3>
                  <p className="text-[11px] text-[#5B7479] dark:text-[#9DB8BD] truncate">
                    {activeChatRequest.type} · {activeChatRequest.status}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveChatRequest(null)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Conversation Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAFB] dark:bg-[#0B2329]">
              <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-[#14353E] text-[11px] text-[#5B7479] dark:text-[#9DB8BD] text-center border border-slate-200 dark:border-slate-800">
                Live Support thread connected. You are chatting directly with Oxynity Support &amp; Field Technicians.
              </div>

              {(activeChatRequest.messages || []).map((msg) => {
                const isMe = msg.sender === 'client';
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] text-[#5B7479] dark:text-[#9DB8BD]">
                      {isMe ? (
                        <>
                          <span>You</span>
                          <User className="w-3 h-3" />
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            {msg.senderName || 'Oxynity Support'}
                          </span>
                        </>
                      )}
                      <span>·</span>
                      <span>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs font-medium leading-relaxed shadow-xs ${
                        isMe
                          ? 'bg-[#0E7C86] text-white rounded-tr-xs'
                          : 'bg-white dark:bg-[#1A3F49] text-[#0B2B33] dark:text-[#E8F4F6] border border-[#DDE8EA] dark:border-[#22505C] rounded-tl-xs'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input Footer */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 border-t border-[#DDE8EA] dark:border-[#1F4650] flex items-center gap-2 bg-white dark:bg-[#12313A]"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type your message to support..."
                className="flex-1 bg-[#F2F7F8] dark:bg-[#071A1F] border border-[#DDE8EA] dark:border-[#1F4650] rounded-xl px-3.5 py-2.5 text-xs text-[#0B2B33] dark:text-[#E8F4F6] focus:outline-hidden focus:ring-2 focus:ring-[#19C3D1]"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || isSendingMsg}
                className="px-4 py-2.5 bg-[#0E7C86] hover:bg-[#0c6b73] disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
