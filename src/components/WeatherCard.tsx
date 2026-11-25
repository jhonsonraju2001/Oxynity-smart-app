import React, { useEffect, useState } from 'react';
import { OPENWEATHER_KEY, pondLatLon } from '../lib/oxynity';

interface WeatherData {
  temp: number;
  hum: number;
  p: number; // pressure now (hPa)
  minP: number; // lowest pressure in next 24 h
  drop: number; // fall in pressure over next 24 h
  wind: number; // km/h
  gust: number; // max gust next 24 h, km/h
  clouds: number; // %
  cl24: number; // average cloud % next 24 h
  rain24: number; // mm next 24 h
  desc: string;
  place: string;
}

const CACHE_MS = 30 * 60 * 1000;

/** Weather at the pond (by GPS) plus warnings that matter for dissolved oxygen. */
export const WeatherCard: React.FC<{ device: any; title?: string; className?: string }> = ({ device, title, className = '' }) => {
  const ll = pondLatLon(device);
  const la = ll?.[0];
  const lo = ll?.[1];
  const [w, setW] = useState<WeatherData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setW(null);
    setErr('');
    if (!la || !lo) return;
    let dead = false;
    const key = `oxw_${la.toFixed(2)}_${lo.toFixed(2)}`;
    try {
      const c = JSON.parse(localStorage.getItem(key) || 'null');
      if (c && Date.now() - c.t < CACHE_MS) {
        setW(c.v);
        return;
      }
    } catch {}
    const q = `lat=${la}&lon=${lo}&units=metric&appid=${OPENWEATHER_KEY}`;
    Promise.all([
      fetch(`https://api.openweathermap.org/data/2.5/weather?${q}`).then((r) => r.json()),
      fetch(`https://api.openweathermap.org/data/2.5/forecast?${q}&cnt=8`).then((r) => r.json()).catch(() => ({})),
    ])
      .then(([a, f]) => {
        if (dead) return;
        if (!a || !a.main) {
          setErr(a && a.message ? `Weather: ${a.message}` : 'Weather not available');
          return;
        }
        const list: any[] = Array.isArray(f?.list) ? f.list : [];
        const p = a.main.pressure;
        const wd = a.wind || {};
        const minP = Math.min(p, ...list.map((x) => x.main?.pressure || p));
        const gust = Math.max(wd.gust || wd.speed || 0, ...list.map((x) => x.wind?.gust || x.wind?.speed || 0)) * 3.6;
        const cl24 = list.length ? list.reduce((s, x) => s + (x.clouds?.all || 0), 0) / list.length : a.clouds?.all || 0;
        const rain24 = list.reduce((s, x) => s + (x.rain?.['3h'] || 0), 0);
        const v: WeatherData = {
          temp: a.main.temp,
          hum: a.main.humidity,
          p,
          minP,
          drop: p - minP,
          wind: (wd.speed || 0) * 3.6,
          gust,
          clouds: a.clouds?.all || 0,
          cl24,
          rain24,
          desc: a.weather?.[0]?.description || '',
          place: a.name || '',
        };
        try {
          localStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
        } catch {}
        setW(v);
      })
      .catch(() => {
        if (!dead) setErr('No internet – weather not updated');
      });
    return () => {
      dead = true;
    };
  }, [la, lo]);

  if (!la || !lo) return null;

  const warnings: { level: 'warn' | 'danger'; text: string }[] = [];
  if (w) {
    if (w.p < 1005 || w.drop >= 4)
      warnings.push({ level: 'warn', text: `Low / falling air pressure (${Math.round(w.minP)} hPa). DO may drop tonight – run the generator longer at night.` });
    if (w.cl24 >= 75)
      warnings.push({ level: 'warn', text: 'Cloudy for the next 24 h – less natural oxygen from algae. Watch DO in the early morning.' });
    if (w.gust >= 62)
      warnings.push({ level: 'danger', text: `Very strong winds up to ${Math.round(w.gust)} km/h – possible cyclone conditions. Follow IMD warnings.` });
    else if (w.gust >= 45) warnings.push({ level: 'warn', text: `Strong winds up to ${Math.round(w.gust)} km/h expected.` });
    if (w.rain24 >= 30) warnings.push({ level: 'warn', text: `Heavy rain expected (${Math.round(w.rain24)} mm in 24 h).` });
  }

  const kind: 'rain' | 'wind' | 'cloud' | 'sun' = !w
    ? 'cloud'
    : /rain|drizzle|thunder|storm/i.test(w.desc)
    ? 'rain'
    : w.wind >= 28
    ? 'wind'
    : w.clouds >= 55
    ? 'cloud'
    : 'sun';
  // Brand teal family for every weather type, so the card matches the rest of the app
  const bg: Record<string, string> = {
    sun: 'linear-gradient(120deg,#0E7C86,#12A3AE,#F2B33D)',
    cloud: 'linear-gradient(120deg,#0B4F5A,#0E7C86,#3E8E99)',
    rain: 'linear-gradient(120deg,#0B3A52,#0E6FA3,#0E7C86)',
    wind: 'linear-gradient(120deg,#0B4F5A,#0E7C86,#19C3D1)',
  };
  const danger = warnings.some((x) => x.level === 'danger');

  return (
    <div className={`ox-card overflow-hidden ${className}`}>
      {/* Animated header */}
      <div className="ox-wx relative px-4 pt-4 pb-3.5 text-white" style={{ backgroundImage: bg[kind] }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wider opacity-90">{title || 'Weather at pond'}</span>
          {w && (
            <span className={`shrink-0 text-[10px] font-black px-2.5 py-1 rounded-full ${warnings.length ? (danger ? 'bg-red-600' : 'bg-amber-500') : 'bg-emerald-500'}`}>
              {warnings.length ? `${warnings.length} ALERT${warnings.length > 1 ? 'S' : ''}` : 'DO SAFE'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <svg width="64" height="54" viewBox="0 0 74 62" className="shrink-0" aria-hidden="true">
            {(kind === 'sun' || kind === 'cloud') && (
              <g className="ox-sun" style={{ transformBox: 'fill-box' }}>
                <circle cx="24" cy="22" r="11" fill="#FDE047" />
                {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                  <rect key={a} x="23" y="3" width="2" height="6" rx="1" fill="#FDE047" transform={`rotate(${a} 24 22)`} />
                ))}
              </g>
            )}
            {kind !== 'sun' && (
              <>
                <g className="ox-cloud2" opacity="0.65">
                  <ellipse cx="50" cy="20" rx="14" ry="8" fill="#fff" />
                </g>
                <g className="ox-cloud">
                  <ellipse cx="34" cy="34" rx="20" ry="11" fill="#fff" />
                  <circle cx="26" cy="27" r="9" fill="#fff" />
                  <circle cx="40" cy="25" r="11" fill="#fff" />
                </g>
              </>
            )}
            {kind === 'rain' &&
              [20, 30, 40, 50].map((x, i) => (
                <rect key={x} className="ox-drop" style={{ animationDelay: `${i * 0.22}s` }} x={x} y="44" width="2.4" height="8" rx="1.2" fill="#BAE6FD" />
              ))}
            {kind === 'wind' &&
              [46, 52, 58].map((y, i) => (
                <rect key={y} className="ox-gust" style={{ animationDelay: `${i * 0.35}s` }} x={18 + i * 6} y={y} width={30 - i * 6} height="2.4" rx="1.2" fill="#fff" />
              ))}
          </svg>
          {w ? (
            <div className="min-w-0 flex-1">
              <div className="text-[36px] leading-none font-black">{Math.round(w.temp)}°C</div>
              <div className="text-[13px] font-bold capitalize mt-1 leading-snug">{w.desc}</div>
              {w.place && <div className="text-[11px] font-semibold opacity-85">{w.place}</div>}
            </div>
          ) : (
            <div className="text-sm font-bold">{err || 'Loading weather…'}</div>
          )}
        </div>
        {w && (
          <div className="grid grid-cols-5 gap-1 mt-3 text-center">
            {(
              [
                ['Pressure', `${Math.round(w.p)}`, 'hPa'],
                ['Wind', `${Math.round(w.wind)}`, 'km/h'],
                ['Clouds', `${Math.round(w.clouds)}`, '%'],
                ['Humidity', `${Math.round(w.hum)}`, '%'],
                ['Rain 24h', w.rain24.toFixed(1), 'mm'],
              ] as const
            ).map(([label, value, unit]) => (
              <div key={label} className="rounded-xl bg-white/15 backdrop-blur-xs px-1 py-1.5">
                <div className="text-[9px] font-extrabold uppercase opacity-80">{label}</div>
                <div className="text-[15px] font-black leading-tight">{value}</div>
                <div className="text-[9px] font-bold opacity-80">{unit}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DO-related warnings */}
      {w && (
        <div className="px-3.5 py-3 space-y-2">
          {warnings.map((x, i) => (
            <div
              key={i}
              className={`ox-warn px-2.5 py-2 rounded-xl text-xs font-bold ${
                x.level === 'danger' ? 'bg-red-500/15 text-red-700 dark:text-red-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              }`}
            >
              ⚠ {x.text}
            </div>
          ))}
          {warnings.length === 0 && <div className="text-xs font-bold text-green-700 dark:text-green-400">✓ No weather risk for DO in the next 24 hours.</div>}
        </div>
      )}
    </div>
  );
};
