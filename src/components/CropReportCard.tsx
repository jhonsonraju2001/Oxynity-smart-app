import React, { useEffect, useState } from 'react';
import { DeviceTelemetry } from '../types/iot';
import { saveCsvFile, toCsv } from '../data/oxynityAdminData';
import { dayEnd, dayStart, fetchReadings, fetchRunLogs, pondRangeRows, RangeSummary, SENSOR_ORDER, sensorStats, SensorStat, summarize, ymd } from '../lib/reports';
import { isSensorInstalled, SensorKey } from '../lib/oxynity';

/** Custom date / whole-crop report: pick stocking and harvest dates, see run hours and estimated power, download CSV. */
export const CropReportCard: React.FC<{
  device: DeviceTelemetry;
  onSaveDates?: (from: string, to: string) => void;
  /** sensors switched on by the farmer; only installed + switched-on sensors appear in the report */
  sensorsOn?: Partial<Record<SensorKey, boolean>>;
}> = ({ device, onSaveDates, sensorsOn }) => {
  const keys = SENSOR_ORDER.filter((k) => isSensorInstalled(device, k) && (sensorsOn ? sensorsOn[k] !== false : true));
  const [stats, setStats] = useState<SensorStat[]>([]);
  const today = ymd(new Date());
  const [from, setFrom] = useState(device.cropStartDate || ymd(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(device.cropEndDate || today);
  const [sum, setSum] = useState<RangeSummary | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    setFrom(device.cropStartDate || ymd(new Date(Date.now() - 30 * 864e5)));
    setTo(device.cropEndDate || today);
    setSum(null);
  }, [device.deviceId]);

  const valid = !!from && !!to && from <= to;

  const load = async () => {
    if (!valid || !device.deviceId) return null;
    setBusy(true);
    const a = dayStart(from), b = dayEnd(to);
    const [l, rd] = await Promise.all([fetchRunLogs(device, a, b), keys.length ? fetchReadings(device, a, b) : Promise.resolve([])]);
    const s = summarize(device, l, a, b);
    setLogs(l);
    setStats(sensorStats(device, rd, keys));
    setSum(s);
    setBusy(false);
    return { l, a, b, rd };
  };

  const download = async () => {
    const r = await load();
    if (!r) return;
    const rows = [['OXYNITY SMART - CROP / CUSTOM PERIOD REPORT'], ['Generated', new Date().toLocaleString('en-IN')], [], ...pondRangeRows(device, r.l, r.a, r.b, r.rd, { pumps: true, sensors: keys, gps: false, schedules: true })];
    saveCsvFile(`Oxynity_Crop_Report_${device.deviceId}_${from}_to_${to}.csv`, toCsv(rows));
  };

  const tile = (label: string, value: string, sub?: string) => (
    <div className="bg-[#F3F8F9] dark:bg-[#08222A] rounded-2xl p-2.5 border border-[#DDE8EA] dark:border-[#1F4650]">
      <small className="block text-[10px] font-bold text-[#5B7479] dark:text-[#9DB8BD] uppercase tracking-wider">{label}</small>
      <b className="text-lg font-black text-[#0B2B33] dark:text-[#E8F4F6] block leading-tight mt-0.5">{value}</b>
      {sub && <span className="text-[10px] font-bold text-[#0E7C86] dark:text-[#19C3D1]">{sub}</span>}
    </div>
  );
  const inputCls = 'ox-input mt-1';

  return (
    <div className="ox-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-extrabold text-[#0B2B33] dark:text-[#E8F4F6]">Crop / custom period report</h3>
        <p className="text-xs text-[#5B7479] dark:text-[#9DB8BD] mt-0.5">
          Choose any dates, for example stocking day to harvest day. Includes machine running{keys.length ? ` and ${keys.map((k) => ({ do: 'DO', temp: 'temperature', ph: 'pH', orp: 'ORP', sal: 'salinity' } as any)[k]).join(', ')}` : ''}.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-bold text-[#5B7479] dark:text-[#9DB8BD]">
          From (stocking)
          <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setSum(null); }} className={inputCls} />
        </label>
        <label className="text-[11px] font-bold text-[#5B7479] dark:text-[#9DB8BD]">
          To (harvest)
          <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setSum(null); }} className={inputCls} />
        </label>
      </div>
      {!valid && <div className="text-xs font-bold text-red-600">Choose a start date that is before the end date.</div>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={load} disabled={!valid || busy} className="ox-btn ox-btn-primary">
          {busy ? 'Loading…' : 'Show data'}
        </button>
        <button type="button" onClick={download} disabled={!valid || busy} className="ox-btn ox-btn-secondary">
          Download CSV
        </button>
        {onSaveDates && (
          <button
            type="button"
            disabled={!valid}
            onClick={() => { onSaveDates(from, to); setSaved("Saved as this pond's crop dates ✓"); setTimeout(() => setSaved(''), 3000); }}
            className="ox-btn ox-btn-outline col-span-2"
          >
            Save as this crop's dates
          </button>
        )}
      </div>
      {saved && <div className="text-xs font-bold text-green-700 dark:text-green-400">{saved}</div>}
      {sum && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {tile('Run hours', `${sum.hours.toFixed(1)} h`, `${sum.days} days · ${sum.avgPerDay.toFixed(1)} h/day`)}
            {tile('Starts / stops', `${sum.starts} / ${sum.stops}`)}
            {tile('Power used', sum.kw ? `${sum.kwh.toFixed(0)} units` : 'Not set', sum.kw ? `${sum.kw.toFixed(2)} kW motor · estimate` : 'Machine load not entered yet')}
            {tile('Power cost', sum.cost != null ? `₹${Math.round(sum.cost).toLocaleString('en-IN')}` : '—', sum.tariff ? `at ₹${sum.tariff}/unit` : 'Tariff not set')}
          </div>
          {stats.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-[#5B7479] dark:text-[#9DB8BD]">Sensors in this period</div>
              <div className="grid grid-cols-2 gap-2">
                {stats.map((x) => (
                  <React.Fragment key={x.key}>{tile(
                    x.label,
                    x.count ? `${x.avg.toFixed(x.dp)}${x.unit ? ` ${x.unit}` : ''}` : '—',
                    x.count
                      ? `avg · min ${x.min.toFixed(x.dp)} · max ${x.max.toFixed(x.dp)}${x.key === 'do' && x.low ? ` · ${x.low} low readings` : ''}`
                      : 'No readings saved'
                  )}</React.Fragment>
                ))}
              </div>
              {stats.every((x) => !x.count) && (
                <div className="text-xs text-[#5B7479] dark:text-[#9DB8BD]">Sensor readings are saved every 15 minutes from app version 1.7 onwards, while the machine is online.</div>
              )}
            </div>
          )}
          {logs.length === 0 && <div className="text-xs text-[#5B7479] dark:text-[#9DB8BD]">No start/stop records saved in this period. Records are saved from app version 1.1 onwards.</div>}
          <p className="text-[10px] text-[#5B7479] dark:text-[#9DB8BD]">Power is an estimate: run hours × the machine's motor load entered by Oxynity at installation. The electricity meter is the exact figure.</p>
        </>
      )}
    </div>
  );
};
