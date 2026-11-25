import React, { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { sendLocalNotification } from '../lib/notifications';
import { minutesSinceSeen, playAlarm, stopAlarm } from '../lib/oxynity';

interface Alarm {
  id: string;
  kind: 'service' | 'power';
  title: string;
  text: string;
  at: number;
}

const OFFLINE_AFTER_MIN = 5; // unit silent this long after being live = possible power cut

/**
 * Loud warnings (banner + siren + phone notification) while the app is open:
 *  - admin: a customer sends a new service request
 *  - admin + farmer: a pond's machine stops reporting (possible power cut / network loss), and when it is back
 * Background alerts with the app closed need push messaging (FCM) from a server – not part of this.
 */
export const AlarmCenter: React.FC<{ devices: any[]; watchServiceRequests?: boolean }> = ({ devices, watchServiceRequests }) => {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const state = useRef<Record<string, 'live' | 'down'>>({});
  const devRef = useRef<any[]>(devices);
  devRef.current = devices;

  const raise = (a: Alarm) => {
    setAlarms((prev) => (prev.some((x) => x.id === a.id) ? prev : [a, ...prev].slice(0, 5)));
    playAlarm(a.kind === 'power' ? 15 : 8);
    sendLocalNotification(a.title, a.text);
  };

  // New service requests (skip the ones that already existed when the app opened)
  useEffect(() => {
    if (!watchServiceRequests) return;
    let first = true;
    const unsub = onSnapshot(
      collection(db, 'service_requests'),
      (snap) => {
        if (first) {
          first = false;
          return;
        }
        snap.docChanges().forEach((c) => {
          if (c.type !== 'added') return;
          const d: any = c.doc.data();
          raise({
            id: `svc-${c.doc.id}`,
            kind: 'service',
            title: `🔧 New service request ${c.doc.id}`,
            text: `${d.farmer || 'Customer'} · ${d.pondName || d.deviceId || ''} · ${d.type || ''}: ${String(d.desc || '').slice(0, 90)}`,
            at: Date.now(),
          });
        });
      },
      () => {}
    );
    return () => unsub();
  }, [watchServiceRequests]);

  // Machine stopped reporting = possible power failure
  useEffect(() => {
    const check = () => {
      (devRef.current || []).forEach((d) => {
        if (!d?.deviceId || d.isDemo) return;
        const mins = minutesSinceSeen(d);
        const was = state.current[d.deviceId];
        const name = String(d.name || d.deviceId).replace(/\(.*?\)/g, '').trim();
        if (mins < 2) {
          if (was === 'down') {
            setAlarms((prev) => prev.filter((x) => x.id !== `pwr-${d.deviceId}`));
            sendLocalNotification(`✅ ${name} is back online`, 'The machine is reporting again.');
          }
          state.current[d.deviceId] = 'live';
        } else if (mins >= OFFLINE_AFTER_MIN && was === 'live') {
          state.current[d.deviceId] = 'down';
          raise({
            id: `pwr-${d.deviceId}`,
            kind: 'power',
            title: `⚠ POWER OFF / OFFLINE: ${name}`,
            text: `No signal from the machine for ${Math.round(mins)} minutes${d.status === 'ON' ? ' while it was RUNNING' : ''}. Possible power cut or network failure at the pond. Check immediately.`,
            at: Date.now(),
          });
        }
      });
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  if (!alarms.length) return null;
  const close = (id: string) => {
    stopAlarm();
    setAlarms((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div className="fixed top-2 left-2 right-2 z-[5000] flex flex-col gap-2 pointer-events-none">
      {alarms.map((a) => (
        <div
          key={a.id}
          className={`ox-alarm pointer-events-auto rounded-2xl px-3.5 py-3 text-white shadow-2xl flex items-start gap-3 ${
            a.kind === 'power' ? 'bg-red-600' : 'bg-amber-600'
          }`}
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black">{a.title}</div>
            <div className="text-xs font-semibold opacity-95 mt-0.5">{a.text}</div>
            <div className="text-[10px] opacity-80 mt-1">{new Date(a.at).toLocaleTimeString()}</div>
          </div>
          <button type="button" onClick={() => close(a.id)} className="shrink-0 bg-white/20 hover:bg-white/30 rounded-xl px-3 py-2 text-xs font-black cursor-pointer">
            STOP
          </button>
        </div>
      ))}
    </div>
  );
};
