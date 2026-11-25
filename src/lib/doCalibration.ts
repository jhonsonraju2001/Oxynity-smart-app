// DO probe calibration maths (same method the farmer Settings screen uses), shared with the admin Sensor Setup page.
// The result (doSlopeK mg/L per mV, doZeroMv) is saved on the device; the Cloudflare worker sends it to the ESP32 as k / z.

export interface CalPoint {
  meterDo: number; // handheld DO meter reading, mg/L
  voltageMv: number; // probe voltage reported by the machine at that moment, mV
}

export const computeDoCalibration = (pts: CalPoint[]): { slope: number; zero: number } => {
  const p = pts.filter((x) => isFinite(x.meterDo) && isFinite(x.voltageMv) && x.voltageMv > 0);
  if (!p.length) return { slope: 0.003212, zero: 0 };
  if (p.length === 1) return { slope: Number((p[0].meterDo / p[0].voltageMv).toFixed(6)), zero: 0 };

  // With a zero-oxygen point (meter < 0.5 mg/L): full straight-line fit, zero offset allowed
  if (p.some((x) => x.meterDo < 0.5)) {
    const n = p.length;
    let sV = 0, sD = 0, sV2 = 0, sVD = 0;
    p.forEach((x) => { sV += x.voltageMv; sD += x.meterDo; sV2 += x.voltageMv ** 2; sVD += x.voltageMv * x.meterDo; });
    const den = n * sV2 - sV * sV;
    if (Math.abs(den) > 1e-4) {
      const m = (n * sVD - sV * sD) / den;
      const c = (sD - m * sV) / n;
      if (m > 0) return { slope: Number(m.toFixed(6)), zero: Number(Math.max(0, -c / m).toFixed(2)) };
    }
    return { slope: Number((sD / sV).toFixed(6)), zero: 0 };
  }

  // Otherwise a line through zero (DO = K x V)
  let sV2 = 0, sVD = 0;
  p.forEach((x) => { sV2 += x.voltageMv ** 2; sVD += x.voltageMv * x.meterDo; });
  return { slope: Number((sV2 > 0 ? sVD / sV2 : p[0].meterDo / p[0].voltageMv).toFixed(6)), zero: 0 };
};

export const doFromVoltage = (mv: number, slope: number, zero: number) => Math.max(0, (mv - zero) * slope);

/** "16.711395, 81.464035" or a Google Maps link -> [lat, lng] */
export const parseLatLng = (text: string): [number, number] | null => {
  const m = String(text || '').match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const la = Number(m[1]), lo = Number(m[2]);
  return Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? [la, lo] : null;
};
