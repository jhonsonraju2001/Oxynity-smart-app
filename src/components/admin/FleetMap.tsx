import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { AdminDeviceRecord } from '../../data/oxynityAdminData';
import { kmBetween, pondLatLon } from '../../lib/oxynity';
import { WeatherCard } from '../WeatherCard';
import { InstalledSensorsEditor } from './InstalledSensorsEditor';

const STATUS: Record<string, { color: string; label: string }> = {
  running: { color: '#22C55E', label: 'Running' },
  standby: { color: '#94A3B8', label: 'Standby' },
  maint: { color: '#FACC15', label: 'Maintenance' },
  critical: { color: '#EF4444', label: 'Critical' },
};
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const navUrl = (la: number, lo: number) => `https://www.google.com/maps/dir/?api=1&destination=${la},${lo}&travelmode=driving`;
const esc = (t: any) => String(t ?? '').replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x] as string));

interface Props {
  items: AdminDeviceRecord[];
  selected: string | null;
  onSelect: (id: string) => void;
}

/**
 * Admin fleet map: street / satellite / hybrid, pinch zoom to street level, live "my location" follow,
 * nearby units by distance with Google Maps navigation, and an alert when a unit is within 5 km.
 */
export const FleetMap: React.FC<Props> = ({ items, selected, onSelect }) => {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const base = useRef<L.Layer[]>([]);
  const me = useRef<[L.Circle, L.CircleMarker] | null>(null);
  const watch = useRef<{ kind: 'cap' | 'web'; id: any } | null>(null);
  const fitted = useRef(false);
  const prevSel = useRef<string | null>(null);
  const told = useRef<Record<string, boolean>>({});
  const selBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) setTimeout(() => selBox.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300);
  }, [selected]);

  const [mode, setMode] = useState<'map' | 'satellite' | 'hybrid'>('map');
  const [pos, setPos] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [follow, setFollow] = useState(false);
  const [err, setErr] = useState('');
  const [near, setNear] = useState<{ d: AdminDeviceRecord; km: number; la: number; lo: number } | null>(null);
  const [radius, setRadius] = useState(25);
  // Phones: one finger scrolls the page, two fingers move/zoom the map (like Google Maps in a page).
  const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator as any).maxTouchPoints > 0);
  const [freeMove, setFreeMove] = useState(false);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<any>(null);

  const pts = items.filter((d) => pondLatLon(d.rawTelemetry));
  const noGps = items.length - pts.length;
  const ll = (d: AdminDeviceRecord) => pondLatLon(d.rawTelemetry) as [number, number];

  const openNav = (la: number, lo: number) => window.open(navUrl(la, lo), '_blank');

  const stopWatch = () => {
    const w = watch.current;
    watch.current = null;
    if (!w) return;
    try {
      if (w.kind === 'cap') Geolocation.clearWatch({ id: w.id });
      else navigator.geolocation.clearWatch(w.id);
    } catch {}
  };

  const startWatch = async () => {
    if (watch.current) return;
    const onPos = (c: GeolocationCoordinates | any) => {
      setErr('');
      setPos({ lat: c.latitude, lon: c.longitude, acc: c.accuracy || 0 });
    };
    try {
      if (Capacitor.isNativePlatform()) {
        try {
          const p = await Geolocation.checkPermissions();
          if (p.location !== 'granted') await Geolocation.requestPermissions();
        } catch {}
        const id = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }, (p, e) => {
          if (e || !p) setErr('Location not available. Please turn on GPS / Location.');
          else onPos(p.coords);
        });
        watch.current = { kind: 'cap', id };
      } else if (navigator.geolocation) {
        const id = navigator.geolocation.watchPosition((p) => onPos(p.coords), () => setErr('Location permission denied or GPS is off.'), {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 20000,
        });
        watch.current = { kind: 'web', id };
      } else setErr('Location is not supported on this device.');
    } catch (e: any) {
      setErr(`Could not start location: ${e?.message || e}`);
    }
  };

  // create map once
  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, {
      zoomControl: false,
      maxZoom: 20,
      minZoom: 4,
      zoomSnap: 0.5,
      wheelPxPerZoomLevel: 80,
      dragging: !isTouch, // touch: page scrolls with one finger; two-finger pinch moves and zooms
      scrollWheelZoom: !isTouch,
    }).setView([16.6, 81.6], 7);
    if (isTouch) {
      const el = box.current;
      const onMove = (e: TouchEvent) => {
        if (e.touches.length !== 1 || m.dragging.enabled()) return;
        setHint(true);
        clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setHint(false), 1400);
      };
      el.addEventListener('touchmove', onMove, { passive: true });
    }
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    m.on('dragstart', () => setFollow(false));
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    setTimeout(() => m.invalidateSize(), 250);
    return () => {
      ro.disconnect();
      stopWatch();
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !isTouch) return;
    if (freeMove || follow) m.dragging.enable();
    else m.dragging.disable();
  }, [freeMove, follow]);

  // base layers (Esri: free, no API key)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    base.current.forEach((l) => m.removeLayer(l));
    const ls: L.Layer[] = [];
    if (mode === 'map') {
      ls.push(L.tileLayer(`${ESRI}World_Street_Map/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 20, maxNativeZoom: 19, zIndex: 1, attribution: '&copy; Esri, HERE, Garmin, OpenStreetMap' }));
    } else {
      ls.push(L.tileLayer(`${ESRI}World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 20, maxNativeZoom: 18, zIndex: 1, attribution: '&copy; Esri' }));
      if (mode === 'hybrid') {
        ls.push(L.tileLayer(`${ESRI}Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 20, maxNativeZoom: 18, zIndex: 2 }));
        ls.push(L.tileLayer(`${ESRI}Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 20, maxNativeZoom: 18, zIndex: 3 }));
      }
    }
    ls.forEach((l) => l.addTo(m));
    base.current = ls;
  }, [mode]);

  // unit pins
  const sig = JSON.stringify(pts.map((d) => [d.id, d.status, d.hours, d.doNow, d.pond, ll(d)]));
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: [number, number][] = [];
    pts.forEach((d) => {
      const [la, lo] = ll(d);
      const st = STATUS[d.status] || { color: '#0E6FA3', label: d.status };
      const on = d.id === selected;
      bounds.push([la, lo]);
      const icon = L.divIcon({
        className: '',
        iconSize: [30, 40],
        iconAnchor: [15, 40],
        popupAnchor: [0, -36],
        html: `<svg width="30" height="40" viewBox="0 0 30 40" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M15 39C15 39 28 24 28 14A13 13 0 0 0 2 14C2 24 15 39 15 39Z" fill="${st.color}" stroke="${on ? '#0B2440' : '#fff'}" stroke-width="${on ? 3 : 2}"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>`,
      });
      const km = pos ? kmBetween(pos.lat, pos.lon, la, lo) : null;
      const html = `<div style="min-width:200px"><div style="font-weight:800;font-size:13px;color:#0F2233">${esc(d.pond)}</div><div style="font-size:11px;color:#52677A">${esc(d.farmer)} · ${esc(d.id)}</div><div style="font-size:11px;margin-top:4px;color:#33475A"><b style="color:${st.color}">${esc(st.label)}</b> · ${esc(d.hours)} h run${d.doNow ? ` · DO ${esc(d.doNow)}` : ''}${km != null ? ` · <b>${km.toFixed(1)} km</b> away` : ''}</div><div style="display:flex;gap:6px;margin-top:8px"><a href="${navUrl(la, lo)}" target="_blank" style="flex:1;text-align:center;background:#1a73e8;color:#fff;border-radius:8px;padding:7px 0;font-weight:700;font-size:12px;text-decoration:none">Navigate</a>${d.phone ? `<a href="tel:${esc(d.phone)}" style="flex:1;text-align:center;background:#E3F3FB;color:#0B2440;border-radius:8px;padding:7px 0;font-weight:700;font-size:12px;text-decoration:none">Call</a>` : ''}</div></div>`;
      const mk = L.marker([la, lo], { icon, zIndexOffset: on ? 1000 : 0, title: d.pond }).bindPopup(html).on('click', () => onSelect(d.id));
      mk.addTo(g);
      if (on && prevSel.current !== selected) {
        m.setView([la, lo], Math.max(m.getZoom(), 16));
        setTimeout(() => mk.openPopup(), 60);
      }
    });
    prevSel.current = selected;
    if (!fitted.current && bounds.length) {
      fitted.current = true;
      if (bounds.length === 1) m.setView(bounds[0], 15);
      else m.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [sig, selected, pos && Math.round(pos.lat * 2000), pos && Math.round(pos.lon * 2000)]);

  // my location + nearby alert
  useEffect(() => {
    const m = map.current;
    if (!m || !pos) return;
    const here: [number, number] = [pos.lat, pos.lon];
    if (!me.current) {
      me.current = [
        L.circle(here, { radius: pos.acc, color: '#1a73e8', weight: 1, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(m),
        L.circleMarker(here, { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).bindTooltip('You are here').addTo(m),
      ];
    } else {
      me.current[0].setLatLng(here).setRadius(pos.acc);
      me.current[1].setLatLng(here);
    }
    if (follow) {
      m.setView(here, Math.max(m.getZoom(), 14), { animate: true });
      const n = pts
        .map((d) => {
          const [la, lo] = ll(d);
          return { d, la, lo, km: kmBetween(pos.lat, pos.lon, la, lo) };
        })
        .filter((x) => x.km <= 5 && !told.current[x.d.id])
        .sort((a, b) => a.km - b.km)[0];
      if (n) {
        told.current[n.d.id] = true;
        setNear(n);
        try {
          navigator.vibrate?.(200);
        } catch {}
      }
    }
  }, [pos, follow]);

  const list = pos
    ? pts
        .map((d) => {
          const [la, lo] = ll(d);
          return { d, la, lo, km: kmBetween(pos.lat, pos.lon, la, lo) };
        })
        .sort((a, b) => a.km - b.km)
    : [];
  const inRadius = list.filter((x) => x.km <= radius);
  const sel = selected ? items.find((d) => d.id === selected) : undefined;

  const btn = (on: boolean): React.CSSProperties => ({
    border: 0,
    cursor: 'pointer',
    padding: '7px 11px',
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 800,
    background: on ? '#0B2440' : '#fff',
    color: on ? '#fff' : '#0B2440',
    boxShadow: '0 1px 4px rgba(0,0,0,.25)',
  });

  return (
    <div className="flex flex-col gap-2.5">
      {/* isolate: map layers (z-index 400+) must never cover the splash, menus or pop-ups of the page */}
      <div className="relative isolate w-full rounded-2xl overflow-hidden border border-[#DDE7EF]" style={{ height: '58vh', minHeight: 320 }}>
        <div ref={box} className="absolute inset-0" />
        {hint && (
          <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-black/35 pointer-events-none">
            <span className="bg-black/75 text-white text-[13px] font-bold px-4 py-2.5 rounded-xl">Use two fingers to move the map</span>
          </div>
        )}
        {isTouch && (
          <button
            type="button"
            onClick={() => setFreeMove((v) => !v)}
            className="absolute bottom-2.5 left-2.5 z-[1000] text-[11px] font-extrabold px-2.5 py-1.5 rounded-lg shadow"
            style={{ background: freeMove ? '#0B2440' : '#fff', color: freeMove ? '#fff' : '#0B2440', marginBottom: 18 }}
          >
            {freeMove ? '🔓 Map unlocked · tap to lock' : '🔒 Tap to move map with 1 finger'}
          </button>
        )}
        <div className="absolute top-2.5 left-2.5 z-[1000] flex gap-1 bg-white/90 p-[3px] rounded-xl">
          {(
            [
              ['map', 'Map'],
              ['satellite', 'Satellite'],
              ['hybrid', 'Hybrid'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setMode(k)} style={{ ...btn(mode === k), boxShadow: 'none' }}>
              {l}
            </button>
          ))}
        </div>
        <div className="absolute top-2.5 right-2.5 z-[1000] flex flex-col gap-1.5 items-end">
          <button
            type="button"
            style={btn(follow)}
            onClick={() => {
              startWatch();
              setFollow(true);
              if (pos && map.current) map.current.setView([pos.lat, pos.lon], Math.max(map.current.getZoom(), 15));
            }}
          >
            {follow ? '🧭 Following you' : '📍 My location'}
          </button>
          <button
            type="button"
            style={btn(false)}
            onClick={() => {
              if (!map.current || !pts.length) return;
              setFollow(false);
              map.current.fitBounds(pts.map(ll), { padding: [40, 40], maxZoom: 15 });
            }}
          >
            All units
          </button>
        </div>
        {near && (
          <div className="absolute left-2.5 right-2.5 top-[100px] z-[1000] bg-[#0B2440] text-white rounded-2xl px-3 py-2.5 flex items-center gap-2.5 shadow-xl">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] opacity-75 font-bold">Unit nearby</div>
              <div className="text-[13px] font-extrabold truncate">
                {near.d.pond} · {near.km.toFixed(1)} km
              </div>
            </div>
            <button type="button" style={{ ...btn(false), background: '#1a73e8', color: '#fff' }} onClick={() => openNav(near.la, near.lo)}>
              Navigate
            </button>
            <button type="button" className="text-lg bg-transparent border-0 text-white cursor-pointer" onClick={() => setNear(null)}>
              ×
            </button>
          </div>
        )}
      </div>

      {err && <div className="text-xs font-bold text-red-700">{err}</div>}

      {sel && (
        <div ref={selBox} className="bg-white border-2 border-[#0E6FA3] rounded-2xl p-3 text-[#0F2233]">
          <b className="text-sm">{sel.pond}</b>
          <div className="text-[11px] text-[#52677A]">
            {sel.farmer} · {sel.id}
          </div>
          <WeatherCard key={sel.id} device={sel.rawTelemetry} title="Weather at this pond" className="my-3" />
          <InstalledSensorsEditor device={sel.rawTelemetry} deviceId={sel.id} />
        </div>
      )}

      <div className="bg-white border border-[#DDE7EF] rounded-2xl p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <b className="text-[13px] text-[#0F2233]">{pos ? `Units near you (${inRadius.length} within ${radius} km)` : 'Units near you'}</b>
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="text-xs font-bold border border-[#D3DFE9] rounded-lg px-1.5 py-1 bg-white text-[#0F2233]"
          >
            {[5, 10, 25, 50, 100].map((r) => (
              <option key={r} value={r}>
                {r} km
              </option>
            ))}
          </select>
        </div>
        {pos ? (
          list.length ? (
            <div className="flex flex-col max-h-[300px] overflow-y-auto">
              {list.slice(0, 15).map((x) => {
                const st = STATUS[x.d.status] || { color: '#0E6FA3', label: x.d.status };
                return (
                  <div key={x.d.id} className="flex items-center gap-2 py-2 border-t border-[#EEF2F5]" style={{ opacity: x.km <= radius ? 1 : 0.55 }}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: st.color }} />
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer"
                      onClick={() => {
                        setFollow(false);
                        onSelect(x.d.id);
                      }}
                    >
                      <div className="text-[13px] font-extrabold text-[#0F2233] truncate">{x.d.pond}</div>
                      <div className="text-[11px] text-[#52677A] truncate">
                        {x.d.farmer} · {st.label}
                      </div>
                    </button>
                    <b className="text-xs text-[#0F2233] whitespace-nowrap">{x.km < 1 ? `${Math.round(x.km * 1000)} m` : `${x.km.toFixed(1)} km`}</b>
                    <button type="button" style={{ ...btn(false), background: '#1a73e8', color: '#fff', padding: '6px 10px' }} onClick={() => openNav(x.la, x.lo)}>
                      Go
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-[#52677A]">No units with GPS location yet.</div>
          )
        ) : (
          <div className="text-xs text-[#52677A]">Tap 📍 My location to see the nearest units while you drive. You will get an alert when a unit is within 5 km.</div>
        )}
        {noGps > 0 && (
          <div className="text-[11px] text-amber-700 mt-2 font-bold">
            {noGps} unit{noGps > 1 ? 's have' : ' has'} no GPS location and {noGps > 1 ? 'are' : 'is'} not shown on the map.
          </div>
        )}
      </div>

    </div>
  );
};
