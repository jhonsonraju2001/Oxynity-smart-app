import React, { useMemo, useState } from 'react';
import { AdminDeviceRecord, saveCsvFile, toCsv } from '../../data/oxynityAdminData';
import { dayEnd, dayStart, fetchReadings, fetchRunLogs, pondRangeRows, ReportOptions, SENSOR_FIELDS, SENSOR_ORDER, summarize, ymd } from '../../lib/reports';
import { SensorKey } from '../../lib/oxynity';

/**
 * Admin: download exactly the data you want — one customer or all, one pond or all,
 * any dates, and any mix of pump running / schedules / each sensor / GPS. One CSV file (opens in Excel).
 */
export const DataDownload: React.FC<{ fleet: AdminDeviceRecord[]; deviceId?: string; title?: string; startOpen?: boolean }> = ({
  fleet,
  deviceId,
  title = 'Download customer data',
  startOpen = false,
}) => {
  const [open, setOpen] = useState(startOpen);
  const owner = (d: AdminDeviceRecord) => String(d.rawTelemetry?.ownerEmail || d.farmer || 'Unassigned').trim();
  const customers = useMemo(() => Array.from(new Set(fleet.map(owner))).sort(), [fleet]);
  const fixed = deviceId ? fleet.find((d) => d.id === deviceId) : undefined;

  const [cust, setCust] = useState<string>(fixed ? owner(fixed) : 'ALL');
  const [pond, setPond] = useState<string>(fixed ? fixed.id : 'ALL');
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 6 * 864e5)));
  const [to, setTo] = useState(ymd(new Date()));
  const [pumps, setPumps] = useState(true);
  const [sched, setSched] = useState(true);
  const [gps, setGps] = useState(false);
  const [sens, setSens] = useState<Record<SensorKey, boolean>>({ do: true, temp: true, ph: true, orp: true, sal: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const pondsOfCust = fleet.filter((d) => cust === 'ALL' || owner(d) === cust);
  const targets = pondsOfCust.filter((d) => pond === 'ALL' || d.id === pond);
  const sensorKeys = SENSOR_ORDER.filter((k) => sens[k]);
  const nothing = !pumps && !sched && !gps && !sensorKeys.length;
  const valid = !!from && !!to && from <= to && targets.length > 0 && !nothing;

  const quick = (days: number) => {
    setFrom(ymd(new Date(Date.now() - (days - 1) * 864e5)));
    setTo(ymd(new Date()));
  };
  const crop = targets.length === 1 ? targets[0].rawTelemetry : null;

  const download = async () => {
    if (!valid) return;
    setBusy(true);
    setMsg('');
    const a = dayStart(from), b = dayEnd(to);
    const opt: ReportOptions = { pumps, schedules: sched, gps, sensors: sensorKeys };
    const parts = [pumps && 'Pump running & power', sched && 'Schedules', ...sensorKeys.map((k) => SENSOR_FIELDS[k].label), gps && 'GPS'].filter(Boolean).join(', ');
    const rows: (string | number)[][] = [
      ['OXYNITY SMART - DATA EXPORT'],
      ['Customer', cust === 'ALL' ? 'All customers' : cust],
      ['Ponds', targets.length],
      ['Period', `${from} to ${to}`],
      ['Data included', parts],
      ['Generated', new Date().toLocaleString('en-IN')],
    ];
    let totalH = 0, totalKwh = 0;
    const blocks: (string | number)[][] = [];
    for (const d of targets) {
      const dev: any = { ...(d.rawTelemetry || {}), deviceId: d.id };
      const [logs, rd] = await Promise.all([
        pumps ? fetchRunLogs(dev, a, b) : Promise.resolve([]),
        sensorKeys.length || gps ? fetchReadings(dev, a, b) : Promise.resolve([]),
      ]);
      if (pumps) {
        const sm = summarize(dev, logs, a, b);
        totalH += sm.hours;
        totalKwh += sm.kwh;
      }
      blocks.push([], ['=============================='], ...pondRangeRows(dev, logs, a, b, rd, opt));
    }
    if (pumps && targets.length > 1)
      rows.push(['Total run hours (all ponds)', totalH.toFixed(2)], ['Total estimated power (kWh / units)', totalKwh ? totalKwh.toFixed(1) : 'Machine load not set']);
    rows.push(...blocks);
    const who = cust === 'ALL' ? 'all-customers' : cust.replace(/[^a-z0-9]+/gi, '_');
    const what = targets.length === 1 ? targets[0].id : `${targets.length}-ponds`;
    saveCsvFile(`oxynity-data-${who}-${what}-${from}_to_${to}.csv`, toCsv(rows));
    setBusy(false);
    setMsg(`Ready: ${targets.length} pond${targets.length > 1 ? 's' : ''}, ${from} to ${to}.`);
  };

  const lab = 'text-[11px] font-bold text-[#52677A]';
  const field = 'w-full mt-0.5 h-10 px-3 rounded-xl border border-[#D3DFE9] text-[13px] font-semibold bg-white text-[#0F2233]';
  const chk = (on: boolean, set: (v: boolean) => void, text: string, note?: string) => (
    <label key={text} className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border cursor-pointer select-none ${on ? 'bg-[#E3F3FB] border-[#0E6FA3]' : 'bg-white border-[#D3DFE9]'}`}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="w-4 h-4 accent-[#0E6FA3]" />
      <span className="text-[12px] font-bold text-[#0F2233] leading-tight">
        {text}
        {note && <span className="block text-[10px] font-semibold text-[#52677A]">{note}</span>}
      </span>
    </label>
  );
  const chip = (text: string, fn: () => void) => (
    <button key={text} type="button" onClick={fn} className="px-3 py-1.5 rounded-lg bg-[#F1F5F9] text-[#0F2233] text-[11px] font-bold border border-[#D3DFE9] cursor-pointer">
      {text}
    </button>
  );

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full h-11 rounded-xl bg-[#0B2440] text-white text-[13px] font-bold flex items-center justify-center gap-2 cursor-pointer">
        ⬇ {title}
      </button>
    );

  return (
    <div className="bg-white border border-[#DDE7EF] rounded-2xl p-3.5 flex flex-col gap-3 text-[#0F2233]">
      <div className="flex items-center justify-between gap-2">
        <b className="text-[14px]">⬇ {title}</b>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] font-bold text-[#52677A] px-2 py-1 cursor-pointer">
          Close
        </button>
      </div>

      {!fixed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className={lab}>
            Customer
            <select value={cust} onChange={(e) => { setCust(e.target.value); setPond('ALL'); }} className={field}>
              <option value="ALL">All customers ({fleet.length} ponds)</option>
              {customers.map((c) => (
                <option key={c} value={c}>
                  {c} ({fleet.filter((d) => owner(d) === c).length})
                </option>
              ))}
            </select>
          </label>
          <label className={lab}>
            Pond
            <select value={pond} onChange={(e) => setPond(e.target.value)} className={field}>
              <option value="ALL">All ponds ({pondsOfCust.length})</option>
              {pondsOfCust.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.pond} · {d.id}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div>
        <div className={lab}>Period</div>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {chip('Today', () => quick(1))}
          {chip('7 days', () => quick(7))}
          {chip('30 days', () => quick(30))}
          {chip('90 days', () => quick(90))}
          {crop?.cropStartDate && chip('This crop', () => { setFrom(crop.cropStartDate); setTo(crop.cropEndDate || ymd(new Date())); })}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <label className={lab}>
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={field} />
          </label>
          <label className={lab}>
            To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={field} />
          </label>
        </div>
      </div>

      <div>
        <div className={lab}>What to include</div>
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          {chk(pumps, setPumps, 'Pump running & power', 'hours, starts/stops, kWh')}
          {chk(sched, setSched, 'Schedules')}
          {SENSOR_ORDER.map((k) => chk(sens[k], (v) => setSens((p) => ({ ...p, [k]: v })), `${SENSOR_FIELDS[k].label} sensor`, 'only if installed'))}
          {chk(gps, setGps, 'GPS location', 'machine position changes')}
        </div>
      </div>

      {nothing && <div className="text-xs font-bold text-red-600">Choose at least one item.</div>}
      {from > to && <div className="text-xs font-bold text-red-600">"From" date must be before "To" date.</div>}

      <button
        type="button"
        onClick={download}
        disabled={!valid || busy}
        className="w-full h-11 rounded-xl bg-[#0E6FA3] text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
      >
        {busy ? 'Preparing…' : `Download CSV · ${targets.length} pond${targets.length === 1 ? '' : 's'}`}
      </button>
      {msg && <div className="text-xs font-bold text-green-700">{msg}</div>}
      <span className="text-[11px] text-[#52677A]">
        Opens in Excel. Sensors that are not installed on a pond are skipped. Sensor and GPS history is saved every 15 minutes from version 1.7.
      </span>
    </div>
  );
};
