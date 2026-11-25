/**
 * Oxynity Smart - Cloudflare Worker Cellular 4G LTE Bridge
 * SIMCom A7672S 4G LTE Cat-1 Real-Time Telemetry & GNSS/GPS Geofence Tracking
 */
function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

// Hot state caches for instant live telemetry & app commands (avoids Firestore 429 quota exhaustion)
const liveCache = new Map();
const pendingCommands = new Map();
const lastFirestoreWrite = new Map();

export default {
  async fetch(request, env) {
    const FIREBASE_API_KEY = "AIzaSyCqOvdeEt19ntPzv3Bne1V1GackCnWdfwM";
    const FIREBASE_PROJECT_ID = "oxynity-smart";
    const FIRESTORE_DATABASE_ID = "(default)";

    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // App live telemetry polling endpoint (Instant zero-quota bridge for mobile app)
    if (request.method === "GET" && (url.pathname === "/api/live" || url.pathname === "/live")) {
      const devId = url.searchParams.get("deviceId") || "OXY-ESP32-004";
      let cached = liveCache.get(devId);
      if (!cached && env?.OXYNITY_KV) {
        try {
          const raw = await env.OXYNITY_KV.get(`device:${devId}`);
          if (raw) cached = JSON.parse(raw);
        } catch (e) {}
      }

      // If cached data is older than 30s or missing, refresh from Firestore
      const cachedMs = new Date(cached?.lastSeen || cached?.updatedAt || 0).getTime();
      if (!cached || (Date.now() - cachedMs > 30000)) {
        try {
          const fsRes = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/devices/${devId}?key=${FIREBASE_API_KEY}`);
          if (fsRes.ok) {
            const fsDoc = await fsRes.json();
            const fsLastSeen = fsDoc.fields?.lastSeen?.stringValue || fsDoc.fields?.updatedAt?.stringValue;
            const fsMs = new Date(fsLastSeen || 0).getTime();
            if (fsMs > cachedMs) {
              const liveObj = {
                deviceId: devId,
                status: fsDoc.fields?.status?.stringValue || "OFF",
                status2: fsDoc.fields?.status2?.stringValue || "OFF",
                lastSeen: fsLastSeen,
                updatedAt: fsDoc.fields?.updatedAt?.stringValue || fsLastSeen,
                currentSessionSeconds: Number(fsDoc.fields?.currentSessionSeconds?.integerValue || 0),
                currentSessionMinutes: Number(fsDoc.fields?.currentSessionMinutes?.integerValue || 0),
                totalRunHours: Number(fsDoc.fields?.totalRunHours?.doubleValue || 0),
                totalRunSecToday: Number(fsDoc.fields?.totalRunSecToday?.integerValue || 0),
                relay2RunSecToday: Number(fsDoc.fields?.relay2RunSecToday?.integerValue || 0),
                firmwareScheduler: fsDoc.fields?.firmwareScheduler?.booleanValue ?? true,
                isCoolingDown: fsDoc.fields?.isCoolingDown?.booleanValue ?? false,
                cooldownEndsAt: fsDoc.fields?.cooldownEndsAt?.stringValue || "",
              };
              cached = liveObj;
              liveCache.set(devId, liveObj);
              if (env?.OXYNITY_KV) await env.OXYNITY_KV.put(`device:${devId}`, JSON.stringify(liveObj)).catch(() => {});
            }
          }
        } catch (e) {}
      }

      if (cached) {
        const lastSeenMs = new Date(cached.lastSeen || cached.updatedAt || 0).getTime();
        const diffSecs = Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000));
        const isOnline = diffSecs <= 300; // Still online for up to 5 minutes (300 seconds)
        return new Response(JSON.stringify({ success: true, ...cached, isOnline, diffSecs }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      return new Response(JSON.stringify({
        success: false,
        deviceId: devId,
        message: "No live telemetry in memory yet",
        allDevices: Object.fromEntries(liveCache)
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // App command endpoint (Guaranteed instant command delivery to ESP32)
    if (request.method === "POST" && (url.pathname === "/api/command" || url.pathname === "/command")) {
      try {
        const cmdBody = await request.json();
        const devId = cmdBody.deviceId || "OXY-ESP32-004";
        const act = (cmdBody.action || cmdBody.command || cmdBody.status || "").toUpperCase();
        const nowIso = new Date().toISOString();
        if (act === "ON" || act === "START") {
          pendingCommands.set(devId, "ON");
          if (env?.OXYNITY_KV) {
            await env.OXYNITY_KV.put(`cmd:${devId}`, "ON").catch(() => {});
            await env.OXYNITY_KV.put(`state:${devId}`, "ON").catch(() => {});
          }
          const cur = liveCache.get(devId) || {};
          const updated = {
            ...cur,
            deviceId: devId,
            status: "ON",
            isOnline: true,
            lastSeen: nowIso,
            updatedAt: nowIso
          };
          liveCache.set(devId, updated);
          if (env?.OXYNITY_KV) await env.OXYNITY_KV.put(`device:${devId}`, JSON.stringify(updated)).catch(() => {});

          // Immediately synchronize Firestore so onSnapshot and /api/live never contradict
          try {
            const fsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/devices/${devId}?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt&key=${FIREBASE_API_KEY}`;
            await fetch(fsUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fields: {
                  status: { stringValue: "ON" },
                  updatedAt: { stringValue: nowIso },
                }
              })
            });
          } catch (e) {}
        } else if (act === "OFF" || act === "STOP") {
          pendingCommands.set(devId, "OFF");
          if (env?.OXYNITY_KV) {
            await env.OXYNITY_KV.put(`cmd:${devId}`, "OFF").catch(() => {});
            await env.OXYNITY_KV.put(`state:${devId}`, "OFF").catch(() => {});
          }
          const cur = liveCache.get(devId) || {};
          const updated = {
            ...cur,
            deviceId: devId,
            status: "OFF",
            status2: "OFF",
            isOnline: true,
            lastSeen: nowIso,
            updatedAt: nowIso
          };
          liveCache.set(devId, updated);
          if (env?.OXYNITY_KV) await env.OXYNITY_KV.put(`device:${devId}`, JSON.stringify(updated)).catch(() => {});

          // Immediately synchronize Firestore so onSnapshot and /api/live never contradict
          try {
            const fsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/devices/${devId}?updateMask.fieldPaths=status&updateMask.fieldPaths=status2&updateMask.fieldPaths=updatedAt&key=${FIREBASE_API_KEY}`;
            await fetch(fsUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fields: {
                  status: { stringValue: "OFF" },
                  status2: { stringValue: "OFF" },
                  updatedAt: { stringValue: nowIso },
                }
              })
            });
          } catch (e) {}
        }
        return new Response(JSON.stringify({ success: true, deviceId: devId, queuedAction: act }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    if (request.method === "POST") {
      try {
        let body;
        const rawText = await request.text();
        try {
          body = JSON.parse(rawText);
        } catch (e) {
          // Auto-sanitize unquoted numbers with leading zeroes (e.g. "mnc": 07 -> "mnc": "07")
          const sanitized = rawText.replace(/:\s*0+([0-9]+)/g, ':"$1"');
          body = JSON.parse(sanitized);
        }

        const deviceId = body.deviceId || "OXY-ESP32-001";
        const nowIso = new Date().toISOString();

        // 1. Fetch current device document from Firestore to read calibration status & relays
        const getUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/devices/${deviceId}?key=${FIREBASE_API_KEY}`;
        const getRes = await fetch(getUrl);
        let existingDoc = null;
        if (getRes.ok) {
          existingDoc = await getRes.json();
        }

        // Check KV for persistent master state authority
        let masterState = null;
        if (env?.OXYNITY_KV) {
          try {
            masterState = await env.OXYNITY_KV.get(`state:${deviceId}`);
          } catch (e) {}
        }

        const desiredStatus = existingDoc?.fields?.status?.stringValue || "";
        const desiredStatus2 = existingDoc?.fields?.status2?.stringValue || "";

        // Check if app has queued an explicit remote command from the mobile app
        let queued = pendingCommands.get(deviceId);
        if (!queued && env?.OXYNITY_KV) {
          try {
            queued = await env.OXYNITY_KV.get(`cmd:${deviceId}`);
          } catch (e) {}
        }

        // Hardware-initiated events (physical panel button or on-device schedule)
        const hasHardwareEvent =
          (body.manualButtonTrigger && body.manualButtonTrigger.length > 0) ||
          body.isButtonEvent === true ||
          (body.runEvent && body.runEvent.length > 0) ||
          (body.triggerSource &&
            body.triggerSource !== "Cloud/App" &&
            body.triggerSource !== "Mobile App Switch" &&
            body.triggerSource !== "Machine");

        // When a physical hardware event occurs, cancel any pending cloud command
        if (hasHardwareEvent) {
          pendingCommands.delete(deviceId);
          if (env?.OXYNITY_KV) await env.OXYNITY_KV.delete(`cmd:${deviceId}`).catch(() => {});
        }

        // If no explicit command is queued in memory/KV and no hardware event occurred,
        // check if Firestore document status demands a sync
        if (!queued && !hasHardwareEvent && desiredStatus) {
          if (desiredStatus === "ON" && body.status === "OFF") {
            queued = "ON";
          } else if (desiredStatus === "OFF" && body.status === "ON") {
            queued = "OFF";
          }
        }

        let cmdToSend = "";
        let relay1 = body.status || "OFF";
        let relay2 = body.status2 || "OFF";

        if (queued) {
          cmdToSend = queued;
          if (queued === "ON") {
            relay1 = "ON";
            if (body.status === "ON") {
              pendingCommands.delete(deviceId);
              cmdToSend = "";
              if (env?.OXYNITY_KV) await env.OXYNITY_KV.delete(`cmd:${deviceId}`).catch(() => {});
            }
          } else if (queued === "OFF") {
            relay1 = "OFF";
            relay2 = "OFF";
            if (body.status === "OFF") {
              pendingCommands.delete(deviceId);
              cmdToSend = "";
              if (env?.OXYNITY_KV) await env.OXYNITY_KV.delete(`cmd:${deviceId}`).catch(() => {});
            }
          }
        } else if (hasHardwareEvent) {
          relay1 = body.status || "OFF";
          relay2 = body.status2 || "OFF";
        } else {
          relay1 = body.status || "OFF";
          relay2 = body.status2 || "OFF";
        }

        // Only update Firestore relays when:
        // 1. Hardware event happened (button, on-device schedule)
        // 2. Hardware state matches the desired/commanded state (confirmation)
        // Never overwrite desiredStatus while a command is actively in flight!
        const shouldWriteRelayToFirestore =
          hasHardwareEvent ||
          (!queued && body.status === desiredStatus) ||
          (queued && body.status === queued);

        let hardwareStatusReported = shouldWriteRelayToFirestore;
        if (env?.OXYNITY_KV) {
          await env.OXYNITY_KV.put(`state:${deviceId}`, relay1).catch(() => {});
        }
        const rawK = existingDoc?.fields?.doSlopeK;
        const doSlopeK = rawK?.doubleValue !== undefined
          ? rawK.doubleValue
          : rawK?.integerValue !== undefined
          ? Number(rawK.integerValue)
          : null;

        const rawZ = existingDoc?.fields?.doZeroMv;
        const doZeroMv = rawZ?.doubleValue !== undefined
          ? rawZ.doubleValue
          : rawZ?.integerValue !== undefined
          ? Number(rawZ.integerValue)
          : 0.0;

        // Auto DO Mode: Dual Relay Automation (24/7 Cloud Guardian)
        const autoMode = existingDoc?.fields?.autoMode?.booleanValue ?? false;
        const doSensorEnabled = existingDoc?.fields?.doSensorEnabled?.booleanValue ?? true;
        const minDoAlert = existingDoc?.fields?.minDoAlert?.doubleValue ?? 5.0;
        const targetDo = existingDoc?.fields?.targetDo?.doubleValue ?? 8.5;
        const incomingDo = Number(body.doLevel || 0);

        // Auto DO Mode: Keep telemetry logging only; do not auto-override hardware relay states
        let autoRelayTriggered = false;

        // Read calibration & anchor configuration
        const isCalibrated = existingDoc?.fields?.isCalibrated?.booleanValue ?? false;
        const calLat = existingDoc?.fields?.calibratedLatitude?.doubleValue ?? null;
        const calLng = existingDoc?.fields?.calibratedLongitude?.doubleValue ?? null;
        const calLocName = existingDoc?.fields?.calibratedLocationName?.stringValue ?? null;
        const calCellLac = existingDoc?.fields?.calibratedCellLac?.stringValue ?? "";
        const calCellId = existingDoc?.fields?.calibratedCellId?.stringValue ?? "";

        // Current cellular tower reported by ESP32
        const currentLac = body.cellLac ? String(body.cellLac).trim() : "";
        const currentCid = body.cellId ? String(body.cellId).trim() : "";
        const mcc = Number(body.mcc || 404);
        const mnc = Number(body.mnc || 4);

        let liveLat = null;
        let liveLng = null;
        let locName = "SIMCom A7672S 4G Cellular Station";
        let locSource = "A7672S 4G LTE Cat-1";
        let isMoving = false;
        let isGeofenceBreached = false;
        let moveDistanceKm = 0;
        let realFix = false; // true only when this report carries a genuine position (ESP32 fix or tower lookup)
        let stationaryOnAnchor = false;

        // Check if raw GPS fix from A7672S is far from calibrated anchor (> 1 km = breach)
        let rawGpsDisplacementKm = 0;
        if (isCalibrated && calLat !== null && calLng !== null && body.latitude && body.longitude) {
          const bLat = Number(body.latitude);
          const bLng = Number(body.longitude);
          if (Math.abs(bLat) > 0.01 && Math.abs(bLng) > 0.01) {
            rawGpsDisplacementKm = calculateHaversineKm(calLat, calLng, bLat, bLng);
          }
        }

        // Check if serving cell tower has changed from the calibrated anchor tower
        let towerChanged = false;
        if (calCellLac && calCellId && currentLac && currentCid) {
          towerChanged =
            currentLac.toLowerCase() !== calCellLac.toLowerCase() ||
            currentCid.toLowerCase() !== calCellId.toLowerCase();
        }

        // =========================================================================
        // CASE A: CALIBRATED POND ANCHOR & WITHIN 1 KM & SAME TOWER -> STICK TO ANCHOR
        // =========================================================================
        if (isCalibrated && calLat !== null && calLng !== null && !towerChanged && !body.isMoving && rawGpsDisplacementKm <= 1.0) {
          liveLat = calLat;
          liveLng = calLng;
          locName = calLocName || "Calibrated Pond Location (Stationary)";
          locSource = "A7672S 4G Stationary Anchor";
          isMoving = false;
          isGeofenceBreached = false;
          moveDistanceKm = 0;
          stationaryOnAnchor = true;
        } else {
          // =========================================================================
          // CASE B: DEVICE IS MOVING OR TOWER CHANGED OR GEOFENCE BREACHED OR UNCALIBRATED
          // =========================================================================
          if (isCalibrated && (towerChanged || body.isMoving || rawGpsDisplacementKm > 1.0)) {
            isMoving = true;
          }

          // Priority 1: Direct High-Accuracy GNSS/GPS Coordinates from SIMCom A7672S
          if (body.latitude && body.longitude && body.gprsLocationFixed !== false) {
            const bLat = Number(body.latitude);
            const bLng = Number(body.longitude);
            if (
              Math.abs(bLat) > 0.01 &&
              !(Math.abs(bLat - 16.5787) < 0.001 && Math.abs(bLng - 82.0061) < 0.001) && // firmware placeholder
              Math.abs(bLng) > 0.01 &&
              !(Math.abs(bLat - 9.9312) < 0.05 && Math.abs(bLng - 76.2673) < 0.05) &&
              !(Math.abs(bLat - 13.08) < 0.05 && Math.abs(bLng - 80.27) < 0.05)
            ) {
              liveLat = bLat;
              liveLng = bLng;
              realFix = true;
              locSource = body.gpsFix ? "A7672S GNSS/GPS Live Fix" : (isMoving ? "A7672S Live Travel Fix" : "A7672S 4G LTE Triangulation");
              locName = body.locationName || `A7672S 4G GPS (${liveLat.toFixed(5)}, ${liveLng.toFixed(5)})`;
            }
          }

          // Priority 2: Real-Time Cell Tower Triangulation via BeaconDB (LTE / GSM)
          if ((!liveLat || !liveLng) && currentLac && currentCid) {
            try {
              const lacNum = parseInt(currentLac, 16);
              const cidNum = parseInt(currentCid, 16);
              if (!isNaN(lacNum) && !isNaN(cidNum) && lacNum > 0 && cidNum > 0) {
                const geoRes = await fetch("https://beacondb.net/v1/geolocate", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "OxynitySmart/1.0",
                  },
                  body: JSON.stringify({
                    cellTowers: [
                      {
                        radioType: "lte",
                        mobileCountryCode: mcc,
                        mobileNetworkCode: mnc,
                        locationAreaCode: lacNum,
                        cellId: cidNum,
                      },
                    ],
                  }),
                });

                if (geoRes.ok) {
                  const geoData = await geoRes.json();
                  if (
                    geoData.location?.lat &&
                    geoData.location?.lng &&
                    geoData.fallback !== "ipf" &&
                    (geoData.accuracy || 0) < 15000
                  ) {
                    liveLat = geoData.location.lat;
                    liveLng = geoData.location.lng;
                    realFix = true;
                    locSource = isMoving ? "A7672S 4G Tower Fix" : "A7672S 4G LTE LBS";
                    locName = `4G LTE Tower (TAC: ${currentLac}, CID: ${currentCid})`;
                  }
                }
              }
            } catch (e) {
              // Network timeout - proceed
            }
          }

          // Priority 3: Fallback handling
          if (!liveLat || !liveLng) {
            if (isCalibrated && calLat !== null && calLng !== null) {
              liveLat = calLat;
              liveLng = calLng;
              locName = isMoving
                ? `A7672S In Motion (Tower Handover: TAC ${currentLac}, CID ${currentCid})`
                : (calLocName || "Calibrated Pond Location");
              locSource = isMoving ? "A7672S 4G Moving (Tower Handover)" : "Pond GPS Calibrated";
            } else {
              liveLat = 16.5787;
              liveLng = 82.0061;
              locName = "A7672S 4G Signal Acquiring...";
              locSource = "A7672S 4G LTE (Cell Search)";
            }
          }

          // Calculate displacement if calibrated anchor exists and evaluate 1 km Geofence
          if (calLat !== null && calLng !== null && liveLat && liveLng) {
            moveDistanceKm = calculateHaversineKm(calLat, calLng, liveLat, liveLng);
            if (moveDistanceKm > 1.0) {
              isGeofenceBreached = true;
              isMoving = true;
              locName = `🚨 A7672S GEOFENCE BREACH: ${moveDistanceKm} km from Pond Anchor!`;
              locSource = "A7672S 4G Movement (> 1.0 km radius)";
            } else if (moveDistanceKm > 0.1) {
              isMoving = true;
              locName = `A7672S In Motion (${moveDistanceKm} km from Pond)`;
              locSource = "A7672S Live Cellular Movement";
            } else {
              isMoving = false;
              locName = calLocName || "Calibrated Pond Location (Stationary)";
              locSource = "Pond GPS Calibrated (Stationary)";
            }
          }
        }

        // =========================================================================
        // 1b. AUTO RE-ANCHOR: machine shifted to a new pond and stayed there 24 h
        // -------------------------------------------------------------------------
        // While the machine reports real positions away from its installation point, we remember
        // where it is ("candidate" spot, averaged because cell-tower fixes jump 0.5-2 km).
        // If it stays within RELOC_RADIUS_KM of that spot for RELOC_HOURS, the spot becomes the new
        // installation point (same as an admin calibration), so the app stops showing "moving".
        // Coming back to the old point, or moving on, resets the timer.
        // =========================================================================
        const RELOC_HOURS = 24;
        const RELOC_RADIUS_KM = 2;
        const f = existingDoc?.fields || {};
        const num = (v) => (v?.doubleValue ?? (v?.integerValue !== undefined ? Number(v.integerValue) : null));
        const cand = {
          lat: num(f.relocCandidateLat),
          lng: num(f.relocCandidateLng),
          since: f.relocCandidateSince?.stringValue || null,
          count: num(f.relocCandidateCount) || 0,
        };
        const hasCand = cand.lat !== null && cand.lng !== null && !!cand.since;
        let reloc = null; // fields to write for re-anchoring / candidate tracking
        let reanchored = false;

        // Only a clear shift counts: a cell fix within RELOC_RADIUS_KM of the installation point is just
        // tower noise, and must never replace an accurate point the admin set with phone GPS.
        const hasAnchor = calLat !== null && calLng !== null;
        const awayFromAnchor = realFix && (!hasAnchor || calculateHaversineKm(calLat, calLng, liveLat, liveLng) > RELOC_RADIUS_KM);
        if (awayFromAnchor) {
          const sameSpot = hasCand && calculateHaversineKm(cand.lat, cand.lng, liveLat, liveLng) <= RELOC_RADIUS_KM;
          if (!sameSpot) {
            // new candidate spot - start the 24 h timer
            reloc = { lat: liveLat, lng: liveLng, since: nowIso, count: 1 };
          } else {
            const n = Math.min(cand.count, 49);
            const mLat = (cand.lat * n + liveLat) / (n + 1);
            const mLng = (cand.lng * n + liveLng) / (n + 1);
            const hours = (Date.parse(nowIso) - Date.parse(cand.since)) / 3600000;
            if (hours >= RELOC_HOURS) {
              reanchored = true;
              reloc = { clear: true, newLat: Number(mLat.toFixed(6)), newLng: Number(mLng.toFixed(6)) };
            } else {
              reloc = { lat: Number(mLat.toFixed(6)), lng: Number(mLng.toFixed(6)), since: cand.since, count: n + 1 };
            }
          }
        } else if (hasCand && (stationaryOnAnchor || realFix)) {
          // back on the installation point (same tower) - forget the candidate
          reloc = { clear: true };
        }

        if (reanchored) {
          liveLat = reloc.newLat;
          liveLng = reloc.newLng;
          isMoving = false;
          moveDistanceKm = 0;
          locName = `Pond location (auto-updated ${nowIso.slice(0, 10)} after 24 h at new place)`;
          locSource = "Auto re-anchored (cell tower, 24 h stationary)";
        }

        // =========================================================================
        // 2. FORWARD TELEMETRY TO GOOGLE FIRESTORE
        // =========================================================================
        let firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/devices/${deviceId}?updateMask.fieldPaths=doLevel&updateMask.fieldPaths=doSensorConnected&updateMask.fieldPaths=doSensorStatus&updateMask.fieldPaths=latitude&updateMask.fieldPaths=longitude&updateMask.fieldPaths=locationName&updateMask.fieldPaths=locationSource&updateMask.fieldPaths=gprsSignal&updateMask.fieldPaths=csq&updateMask.fieldPaths=gprsConnected&updateMask.fieldPaths=gprsLocationFixed&updateMask.fieldPaths=isOnline&updateMask.fieldPaths=lastSeen&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=currentSessionSeconds&updateMask.fieldPaths=currentSessionMinutes&updateMask.fieldPaths=isMoving&updateMask.fieldPaths=moveDistanceKm&updateMask.fieldPaths=isGeofenceBreached&updateMask.fieldPaths=geofenceRadiusKm&updateMask.fieldPaths=modemModel&updateMask.fieldPaths=networkType&updateMask.fieldPaths=cellLac&updateMask.fieldPaths=cellId&updateMask.fieldPaths=voltageMv&updateMask.fieldPaths=rawAdc&key=${FIREBASE_API_KEY}`;

        const payload = {
          fields: {
            deviceId: { stringValue: deviceId },
            doLevel: { doubleValue: Number(body.doLevel || 7.5) },
            doSensorConnected: { booleanValue: body.doSensorConnected ?? true },
            doSensorStatus: { stringValue: body.doSensorConnected ? "OK" : "MISSING" },
            latitude: { doubleValue: liveLat },
            longitude: { doubleValue: liveLng },
            locationName: { stringValue: locName },
            locationSource: { stringValue: locSource },
            gprsSignal: { integerValue: Number(body.gprsSignal || (body.csq ? Math.round((Number(body.csq) / 31) * 100) : 50)) },
            csq: { integerValue: Number(body.csq || Math.round((Number(body.gprsSignal || 50) / 100) * 31)) },
            networkType: { stringValue: body.networkType || "4G LTE" },
            modemModel: { stringValue: body.modemModel || "SIMCom A7672S" },
            gprsConnected: { booleanValue: true },
            gprsLocationFixed: { booleanValue: realFix || stationaryOnAnchor || reanchored },
            isOnline: { booleanValue: true },
            isMoving: { booleanValue: isMoving },
            isGeofenceBreached: { booleanValue: isGeofenceBreached },
            geofenceRadiusKm: { doubleValue: 1.0 },
            moveDistanceKm: { doubleValue: moveDistanceKm },
            lastSeen: { stringValue: nowIso },
            updatedAt: { stringValue: nowIso },
            currentSessionSeconds: { integerValue: Number(body.currentSessionSeconds || 0) },
            currentSessionMinutes: { integerValue: Number(body.currentSessionMinutes || 0) },
          },
        };

        if (hardwareStatusReported || autoRelayTriggered) {
          firestoreUrl += "&updateMask.fieldPaths=status&updateMask.fieldPaths=status2";
          payload.fields.status = { stringValue: relay1 };
          payload.fields.status2 = { stringValue: relay2 };
        }

        if (body.manualButtonTrigger) {
          firestoreUrl += "&updateMask.fieldPaths=manualButtonTrigger";
          payload.fields.manualButtonTrigger = { stringValue: body.manualButtonTrigger };
        } else if (existingDoc?.fields?.manualButtonTrigger?.stringValue) {
          firestoreUrl += "&updateMask.fieldPaths=manualButtonTrigger";
          payload.fields.manualButtonTrigger = { stringValue: "" };
        }

        if (body.voltageMv !== undefined) payload.fields.voltageMv = { doubleValue: Number(body.voltageMv) };
        if (body.rawAdc !== undefined) payload.fields.rawAdc = { integerValue: Number(body.rawAdc) };
        if (currentLac) payload.fields.cellLac = { stringValue: currentLac };
        if (currentCid) payload.fields.cellId = { stringValue: currentCid };
        if (isMoving) payload.fields.lastMovementAt = { stringValue: nowIso };

        if (reloc) {
          const addMask = (k) => (firestoreUrl += `&updateMask.fieldPaths=${k}`);
          ["relocCandidateLat", "relocCandidateLng", "relocCandidateSince", "relocCandidateCount"].forEach(addMask);
          if (reloc.clear) {
            // fields in the mask but not in the payload are removed by Firestore
          } else {
            payload.fields.relocCandidateLat = { doubleValue: reloc.lat };
            payload.fields.relocCandidateLng = { doubleValue: reloc.lng };
            payload.fields.relocCandidateSince = { stringValue: reloc.since };
            payload.fields.relocCandidateCount = { integerValue: reloc.count };
          }
          if (reanchored) {
            ["isCalibrated", "calibratedLatitude", "calibratedLongitude", "calibratedLocationName", "calibratedCellLac", "calibratedCellId", "previousCalibratedLatitude", "previousCalibratedLongitude", "autoReanchoredAt"].forEach(addMask);
            payload.fields.isCalibrated = { booleanValue: true };
            payload.fields.calibratedLatitude = { doubleValue: reloc.newLat };
            payload.fields.calibratedLongitude = { doubleValue: reloc.newLng };
            payload.fields.calibratedLocationName = { stringValue: locName };
            payload.fields.calibratedCellLac = { stringValue: currentLac };
            payload.fields.calibratedCellId = { stringValue: currentCid };
            if (calLat !== null && calLng !== null) {
              payload.fields.previousCalibratedLatitude = { doubleValue: calLat };
              payload.fields.previousCalibratedLongitude = { doubleValue: calLng };
            }
            payload.fields.autoReanchoredAt = { stringValue: nowIso };
          }
        }

        // ---------------------------------------------------------------------
        // 2a. FIRMWARE v1.7 SCHEDULER STATE (machine runs schedules, rest and run hours itself)
        // ---------------------------------------------------------------------
        if (body.firmwareScheduler === true) {
          const add = (k, v) => {
            firestoreUrl += `&updateMask.fieldPaths=${k}`;
            payload.fields[k] = v;
          };
          add("firmwareScheduler", { booleanValue: true });
          if (body.fwVersion) add("firmwareVersion", { stringValue: String(body.fwVersion) });
          add("isCoolingDown", { booleanValue: body.isCoolingDown === true });
          const ce = Number(body.cooldownEndsAt || 0);
          add("cooldownEndsAt", { stringValue: body.isCoolingDown === true && ce > 0 ? new Date(ce * 1000).toISOString() : "" });
          if (isFinite(Number(body.continuousRunSeconds))) add("continuousRunSeconds", { integerValue: Math.max(0, Math.round(Number(body.continuousRunSeconds))) });
          if (isFinite(Number(body.totalRunHours)) && Number(body.totalRunHours) >= 0) add("totalRunHours", { doubleValue: Number(Number(body.totalRunHours).toFixed(3)) });
        }
        // Start/stop decided by the machine itself (schedule, rest, panel buttons) -> run history
        if (body.runEvent === "START" || body.runEvent === "STOP") {
          const id = `fw-${Date.parse(nowIso)}`;
          const ist = new Date(Date.parse(nowIso) + 19800000);
          const log = {
            id: { stringValue: id },
            deviceId: { stringValue: deviceId },
            timestamp: { stringValue: nowIso },
            action: { stringValue: body.runEvent },
            triggerSource: { stringValue: String(body.runReason || body.triggerSource || "Machine") },
            formattedDate: { stringValue: ist.toISOString().slice(0, 10) },
            formattedTime: { stringValue: ist.toISOString().slice(11, 19) },
            operator: { stringValue: "Machine" },
            by: { stringValue: "firmware" },
          };
          if (body.runEvent === "STOP" && isFinite(Number(body.durationSec))) {
            const d = Math.max(0, Math.round(Number(body.durationSec)));
            log.durationSec = { integerValue: d };
            log.sessionDuration = { stringValue: d >= 3600 ? `${Math.floor(d / 3600)}h ${Math.floor((d % 3600) / 60)}m` : `${Math.floor(d / 60)}m` };
          }
          try {
            await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/devices/${deviceId}/runLog/${id}?key=${FIREBASE_API_KEY}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fields: log }),
            });
          } catch (e) {}
        }

        // ---------------------------------------------------------------------
        // 2b. HISTORY FOR REPORTS: one record per 15 minutes in devices/{id}/readings/{slot}
        // Same slot id as the app (UTC, "2026-11-16T12-45"), so both writers update one record.
        // Only values the machine really reports are stored. Sensor field names:
        // doLevel, waterTemp, phLevel, orpLevel, salinity.
        // ---------------------------------------------------------------------
        const slotMs = Math.floor(Date.parse(nowIso) / 900000) * 900000;
        const slotId = new Date(slotMs).toISOString().slice(0, 16).replace(":", "-");
        const lastSlot = existingDoc?.fields?.lastReadingSlot?.stringValue || "";
        if (slotId !== lastSlot) {
          const r = {
            timestamp: { stringValue: new Date(slotMs).toISOString() },
            status: { stringValue: relay1 },
            source: { stringValue: "worker" },
          };
          const putNum = (k, v) => {
            const n = Number(v);
            if (v !== undefined && v !== null && v !== "" && isFinite(n) && n >= 0) r[k] = { doubleValue: n };
          };
          if (body.doSensorConnected !== false) putNum("doLevel", body.doLevel);
          putNum("waterTemp", body.waterTemp);
          putNum("phLevel", body.phLevel);
          putNum("orpLevel", body.orpLevel);
          putNum("salinity", body.salinity);
          putNum("voltageMv", body.voltageMv);
          if (realFix || stationaryOnAnchor || reanchored) {
            r.latitude = { doubleValue: liveLat };
            r.longitude = { doubleValue: liveLng };
            r.locationSource = { stringValue: locSource };
          }
          const histUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/devices/${deviceId}/readings/${slotId}?key=${FIREBASE_API_KEY}`;
          try {
            const hr = await fetch(histUrl, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: r }) });
            if (hr.ok) {
              firestoreUrl += "&updateMask.fieldPaths=lastReadingSlot";
              payload.fields.lastReadingSlot = { stringValue: slotId };
            }
          } catch (e) {
            // history is best-effort; live telemetry below must still be written
          }
        }

        // Update in-memory hot cache for instant live app telemetry
        const liveObj = {
          deviceId,
          status: relay1,
          status2: relay2,
          isOnline: true,
          lastSeen: nowIso,
          updatedAt: nowIso,
          phaseElapsedSec: body.phaseElapsedSec,
          phaseRemainingSec: body.phaseRemainingSec,
          currentSessionSeconds: body.currentSessionSeconds !== undefined ? body.currentSessionSeconds : (relay1 === "ON" ? (body.phaseElapsedSec || 0) : 0),
          currentSessionMinutes: body.currentSessionMinutes !== undefined ? body.currentSessionMinutes : (relay1 === "ON" ? Math.floor((body.phaseElapsedSec || 0) / 60) : 0),
          totalRunHours: body.totalRunHours,
          totalRunSecToday: body.totalRunSecToday,
          relay2RunSecToday: body.relay2RunSecToday,
          rssi: body.rssi,
          csq: body.csq || Math.round((Number(body.gprsSignal || 50) / 100) * 31),
          gprsSignal: Number(body.gprsSignal || (body.csq ? Math.round((Number(body.csq) / 31) * 100) : 50)),
          networkType: body.networkType || "4G LTE",
          modemModel: body.modemModel || "SIMCom A7672S",
          firmwareScheduler: body.firmwareScheduler,
          fwVersion: body.fwVersion || "v2.5.0-6H-EXACT",
          triggerSource: body.triggerSource,
          manualButtonTrigger: body.manualButtonTrigger || "",
          isCoolingDown: body.isCoolingDown || false,
          cooldownEndsAt: body.cooldownEndsAt || "",
          doLevel: 0,
          doSensorConnected: false,
          doSensorStatus: "DISABLED",
          latitude: liveLat,
          longitude: liveLng,
          locationName: locName,
          locationSource: locSource,
          isMoving,
          isGeofenceBreached,
          geofenceRadiusKm: 1.0,
          moveDistanceKm,
        };
        liveCache.set(deviceId, liveObj);
        if (env?.OXYNITY_KV) {
          await env.OXYNITY_KV.put(`device:${deviceId}`, JSON.stringify(liveObj)).catch(() => {});
        }

        // Throttle Firestore writes: write on status change, button event, or at most once every 60s
        const lastWrite = lastFirestoreWrite.get(deviceId) || 0;
        const timeSinceWrite = Date.now() - lastWrite;
        const prevFixed = existingDoc?.fields?.gprsLocationFixed?.booleanValue;
        const currentFixed = Boolean(realFix || stationaryOnAnchor || reanchored);
        const fixedChanged = prevFixed !== undefined && prevFixed !== currentFixed;
        const prevStatus = existingDoc?.fields?.status?.stringValue;
        const statusChanged = prevStatus !== undefined && prevStatus !== relay1;
        const isFirstDocWrite = !existingDoc?.fields?.deviceId;

        const shouldWriteFirestore =
          isFirstDocWrite ||
          statusChanged ||
          fixedChanged ||
          hardwareStatusReported ||
          autoRelayTriggered ||
          reanchored ||
          reloc !== null ||
          isGeofenceBreached ||
          timeSinceWrite >= 60000;

        if (shouldWriteFirestore) {
          try {
            const fsRes = await fetch(firestoreUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (fsRes.ok) {
              lastFirestoreWrite.set(deviceId, Date.now());
            } else {
              console.warn(`[Firestore] PATCH returned status ${fsRes.status}`);
            }
          } catch (e) {
            console.warn("[Firestore] PATCH error:", e);
          }
        }

        // Schedule settings for the machine, compact: "sched,cooldown,rest;en,startMin,stopMin,rest;..."
        const fv = existingDoc?.fields || {};
        const bool = (v, d) => (v?.booleanValue !== undefined ? v.booleanValue : d);
        const n = (v, d) => (v?.integerValue !== undefined ? Number(v.integerValue) : v?.doubleValue !== undefined ? v.doubleValue : d);
        const toMin = (h, m, ap) => ((Number(h) % 12) + (ap === "PM" ? 12 : 0)) * 60 + Number(m || 0);
        const schedOn = bool(fv.scheduleEnabled, bool(fv.autoMode, false));
        const cdOn = bool(fv.cooldownEnabled, true);
        const restDef = n(fv.restMinutes, 30);
        const items = (fv.schedules?.arrayValue?.values || [])
          .map((v) => v.mapValue?.fields || {})
          .slice(0, 6)
          .map((f) => [
            bool(f.enabled, false) ? 1 : 0,
            toMin(n(f.startHour, 0), n(f.startMinute, 0), f.startAmPm?.stringValue),
            toMin(n(f.stopHour, 0), n(f.stopMinute, 0), f.stopAmPm?.stringValue),
            n(f.restMinutes, 0),
          ].join(","));
        const cfg = [[schedOn ? 1 : 0, cdOn ? 1 : 0, restDef].join(","), ...items].join(";");

        return new Response(
          JSON.stringify({
            t: Math.floor(Date.parse(nowIso) / 1000),
            cfg,
            cmd: cmdToSend,
            trh: Number(n(fv.totalRunHours, 0)) || 0,
            r1: relay1,
            r2: relay2,
            lat: liveLat,
            lng: liveLng,
            loc: locName,
            isMoving,
            isGeofenceBreached,
            geofenceRadiusKm: 1.0,
            distKm: moveDistanceKm,
            reanchored,
            modem: "A7672S",
            networkType: "4G LTE",
            k: doSlopeK !== null ? Number(Number(doSlopeK).toFixed(6)) : null,
            z: doZeroMv !== null ? Number(Number(doZeroMv).toFixed(2)) : 0.0,
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // GET / Health check
    return new Response(
      `Oxynity Pond Cellular Bridge OK\nStatus: Dual Stationary-Lock & Live Moving Tracker Active\nDevice: OXY-ESP32-001`,
      { status: 200, headers: { "Content-Type": "text/plain" } }
    );
  }
};
