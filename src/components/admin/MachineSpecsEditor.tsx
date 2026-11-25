import React, { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';

const FIELDS: [string, string, 'text' | 'number' | 'date' | 'tel', string?][] = [
  ['model', 'Model', 'text', 'e.g. MNBG-2.0'],
  ['capacity', 'Capacity', 'text', 'e.g. 4 HP Micro-Nano Bubble Generator'],
  ['serial', 'Serial number', 'text'],
  ['motorHp', 'Motor HP', 'number', 'e.g. 4'],
  ['motorKw', 'Actual load (kW)', 'number', 'leave empty to use HP × 0.746'],
  ['tariffPerKwh', 'Power tariff (₹ per unit)', 'number', 'e.g. 3.85'],
  ['installedAt', 'Installed on', 'date'],
  ['warrantyEndsAt', 'Warranty ends', 'date'],
  ['installedBy', 'Installed by', 'text'],
  ['assignedTech', 'Assigned technician', 'text'],
  ['farmerName', 'Farmer name', 'text'],
  ['farmerPhone', 'Farmer phone', 'tel'],
  ['facilityName', 'Farm / business name', 'text'],
];

/** Admin: edit machine specifications & identity. Saved on the pond record; used for reports and power estimates. */
export const MachineSpecsEditor: React.FC<{ device: any; deviceId: string }> = ({ device, deviceId }) => {
  const read = () => {
    const d = device || {}, s = d.specs || {}, c = d.contactPerson || {};
    return {
      model: s.model || '', capacity: s.capacity || '', serial: s.serial || '',
      motorHp: s.motorHp ?? '', motorKw: s.motorKw ?? '', tariffPerKwh: s.tariffPerKwh ?? '',
      installedAt: (d.installedAt || '').slice(0, 10), warrantyEndsAt: (d.warrantyEndsAt || '').slice(0, 10),
      installedBy: d.installedBy || '', assignedTech: d.assignedTech || '',
      farmerName: c.name || '', farmerPhone: c.phone || '', facilityName: c.facilityName || '',
    } as Record<string, any>;
  };
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, any>>(read);
  const [status, setStatus] = useState('');
  useEffect(() => { if (!open) setV(read()); }, [deviceId, open]);

  const num = (x: any) => (x === '' || x == null || isNaN(Number(x)) ? null : Number(x));
  const save = async () => {
    setStatus('Saving…');
    try {
      await setDoc(
        doc(db, 'devices', deviceId),
        {
          specs: { model: v.model.trim(), capacity: v.capacity.trim(), serial: v.serial.trim(), motorHp: num(v.motorHp), motorKw: num(v.motorKw), tariffPerKwh: num(v.tariffPerKwh) },
          installedAt: v.installedAt || '', warrantyEndsAt: v.warrantyEndsAt || '',
          installedBy: v.installedBy.trim(), assignedTech: v.assignedTech.trim(),
          contactPerson: { ...(device?.contactPerson || {}), name: v.farmerName.trim(), phone: v.farmerPhone.trim(), facilityName: v.facilityName.trim() },
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      setStatus('Saved ✓');
      setTimeout(() => { setStatus(''); setOpen(false); }, 900);
    } catch (e: any) {
      setStatus(`Could not save: ${e?.message || e}`);
    }
  };

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="ox-btn ox-btn-primary ox-btn-block mt-2">
        ✎ Edit machine specifications &amp; identity
      </button>
    );

  return (
    <div className="mt-2 p-3 rounded-2xl border border-[#0E6FA3]/40 bg-[#F5FAFD] flex flex-col gap-2">
      <b className="text-xs text-[#0B2440]">Edit machine specifications &amp; identity</b>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {FIELDS.map(([k, label, type, hint]) => (
          <label key={k} className="text-[11px] font-bold text-[#52677A]">
            {label}
            <input
              type={type}
              step={type === 'number' ? 'any' : undefined}
              value={v[k]}
              placeholder={hint || ''}
              onChange={(e) => setV((p) => ({ ...p, [k]: e.target.value }))}
              className="ox-input mt-0.5"
            />
          </label>
        ))}
      </div>
      <p className="text-[11px] text-[#52677A]">Motor HP / load and tariff are used to estimate each farmer's power consumption in reports.</p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} className="ox-btn ox-btn-primary ox-btn-sm">Save</button>
        <button type="button" onClick={() => setOpen(false)} className="ox-btn ox-btn-outline ox-btn-sm">Cancel</button>
        <span className="text-xs font-semibold text-[#52677A]">{status}</span>
      </div>
    </div>
  );
};
