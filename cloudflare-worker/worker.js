/**
 * Oxynity Smart - Cloudflare Worker Cellular GPRS Bridge
 * Pure SIM900A GSM Cell Tower Real-Time Moving Location (No Extra GPS Needed)
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

export default {
  async fetch(request, env) {
    const FIREBASE_API_KEY = "AIzaSyCqOvdeEt19ntPzv3Bne1V1GackCnWdfwM";
    const FIREBASE_PROJECT_ID = "oxynity-smart";
    const FIRESTORE_DATABASE_ID = "(default)";

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

        let relay1 = existingDoc?.fields?.status?.stringValue || "OFF";
        let relay2 = existingDoc?.fields?.status2?.stringValue || "OFF";

        // Hardware Push Button Status Synchronization:
        // Accept and persist hardware state ONLY when an explicit physical push button was triggered!
        // Routine background heartbeats must NEVER overwrite Firestore's app switch commands!
        let hardwareStatusReported = false;
        const isExplicitButtonEvent = (
          body.manualButtonTrigger === "START" ||
          body.manualButtonTrigger === "STOP" ||
          body.triggerSource === "BUTTON" ||
          body.triggerSource === "PANEL" ||
          body.isButtonEvent === true
        );

        if (isExplicitButtonEvent) {
          if (body.status) {
            relay1 = body.status;
            hardwareStatusReported = true;
          }
          if (body.status2) {
            relay2 = body.status2;
            hardwareStatusReported = true;
          }
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

        let autoRelayTriggered = false;
        if (autoMode && doSensorEnabled && incomingDo > 0) {
          // Low DO: Activate BOTH relays at once
          if (incomingDo < minDoAlert && (relay1 === "OFF" || relay2 === "OFF")) {
            relay1 = "ON";
            relay2 = "ON";
            autoRelayTriggered = true;
          }
          // Target DO reached: Turn OFF BOTH relays
          else if (incomingDo >= targetDo && (relay1 === "ON" || relay2 === "ON")) {
            relay1 = "OFF";
            relay2 = "OFF";
            autoRelayTriggered = true;
          }
        }

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
        let locName = "SIM900A Cellular Station";
        let locSource = "SIM900A 2G GPRS Tower";
        let isMoving = false;
        let moveDistanceKm = 0;

        // Check if serving cell tower has changed from the calibrated anchor tower
        let towerChanged = false;
        if (calCellLac && calCellId && currentLac && currentCid) {
          towerChanged =
            currentLac.toLowerCase() !== calCellLac.toLowerCase() ||
            currentCid.toLowerCase() !== calCellId.toLowerCase();
        }

        // =========================================================================
        // CASE A: CALIBRATED POND ANCHOR & SAME TOWER -> STICK TO CALIBRATED POND
        // =========================================================================
        if (isCalibrated && calLat !== null && calLng !== null && !towerChanged && !body.isMoving) {
          liveLat = calLat;
          liveLng = calLng;
          locName = calLocName || "Calibrated Pond Location (Stationary)";
          locSource = "Phone GPS Calibrated (Stationary)";
          isMoving = false;
          moveDistanceKm = 0;
        } else {
          // =========================================================================
          // CASE B: DEVICE IS MOVING OR TOWER CHANGED OR NOT CALIBRATED
          // =========================================================================
          if (isCalibrated && (towerChanged || body.isMoving)) {
            isMoving = true;
          }

          // Priority 1: Direct Coordinates from ESP32 (if SIMCOM CIPGSMLOC succeeded)
          if (body.latitude && body.longitude) {
            const bLat = Number(body.latitude);
            const bLng = Number(body.longitude);
            if (
              Math.abs(bLat) > 0.01 &&
              Math.abs(bLng) > 0.01 &&
              !(Math.abs(bLat - 9.9312) < 0.05 && Math.abs(bLng - 76.2673) < 0.05) &&
              !(Math.abs(bLat - 13.08) < 0.05 && Math.abs(bLng - 80.27) < 0.05)
            ) {
              liveLat = bLat;
              liveLng = bLng;
              locSource = isMoving ? "SIM900A Live Travel Fix" : "SIM900A Cell Triangulation";
              locName = body.locationName || `Cell Position (${liveLat.toFixed(4)}, ${liveLng.toFixed(4)})`;
            }
          }

          // Priority 2: Real-Time Cell Tower Triangulation via BeaconDB
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
                        radioType: "gsm",
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
                  // Strictly ignore IP fallback! Only accept genuine cellular tower fixes
                  if (
                    geoData.location?.lat &&
                    geoData.location?.lng &&
                    geoData.fallback !== "ipf" &&
                    (geoData.accuracy || 0) < 15000
                  ) {
                    liveLat = geoData.location.lat;
                    liveLng = geoData.location.lng;
                    locSource = isMoving ? "SIM900A Moving Tower Fix" : "SIM900A Cell Tower LBS";
                    locName = `Cell Tower Fix (LAC: ${currentLac}, CID: ${currentCid})`;
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
              // If new cell tower is resolving, retain calibrated pond coordinates until new fix locks
              liveLat = calLat;
              liveLng = calLng;
              locName = isMoving
                ? `SIM900A In Motion (Tower Handover: LAC ${currentLac}, CID ${currentCid})`
                : (calLocName || "Calibrated Pond Location");
              locSource = isMoving ? "SIM900A Moving (Cell Handover)" : "Phone GPS Calibrated";
            } else {
              liveLat = 16.5787;
              liveLng = 82.0061;
              locName = "Cellular Signal Acquiring...";
              locSource = "SIM900A GPRS (Cell Search)";
            }
          }

          // Calculate displacement if calibrated anchor exists
          if (calLat !== null && calLng !== null && liveLat && liveLng) {
            moveDistanceKm = calculateHaversineKm(calLat, calLng, liveLat, liveLng);
            if (moveDistanceKm > 0.3) {
              isMoving = true;
              locName = `SIM900A In Motion (${moveDistanceKm} km from Pond - LAC: ${currentLac}, CID: ${currentCid})`;
              locSource = "SIM900A Live Cellular Movement";
            }
          }
        }

        // =========================================================================
        // 2. FORWARD TELEMETRY TO GOOGLE FIRESTORE
        // =========================================================================
        let firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/devices/${deviceId}?updateMask.fieldPaths=doLevel&updateMask.fieldPaths=doSensorConnected&updateMask.fieldPaths=doSensorStatus&updateMask.fieldPaths=latitude&updateMask.fieldPaths=longitude&updateMask.fieldPaths=locationName&updateMask.fieldPaths=locationSource&updateMask.fieldPaths=gprsSignal&updateMask.fieldPaths=gprsConnected&updateMask.fieldPaths=gprsLocationFixed&updateMask.fieldPaths=isOnline&updateMask.fieldPaths=lastSeen&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=currentSessionSeconds&updateMask.fieldPaths=currentSessionMinutes&updateMask.fieldPaths=isMoving&updateMask.fieldPaths=moveDistanceKm&updateMask.fieldPaths=cellLac&updateMask.fieldPaths=cellId&updateMask.fieldPaths=voltageMv&updateMask.fieldPaths=rawAdc&key=${FIREBASE_API_KEY}`;

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
            gprsSignal: { integerValue: Number(body.gprsSignal || 50) },
            gprsConnected: { booleanValue: true },
            gprsLocationFixed: { booleanValue: true },
            isOnline: { booleanValue: true },
            isMoving: { booleanValue: isMoving },
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

        if (body.voltageMv !== undefined) payload.fields.voltageMv = { doubleValue: Number(body.voltageMv) };
        if (body.rawAdc !== undefined) payload.fields.rawAdc = { integerValue: Number(body.rawAdc) };
        if (currentLac) payload.fields.cellLac = { stringValue: currentLac };
        if (currentCid) payload.fields.cellId = { stringValue: currentCid };
        if (isMoving) payload.fields.lastMovementAt = { stringValue: nowIso };

        await fetch(firestoreUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        return new Response(
          JSON.stringify({
            r1: relay1,
            r2: relay2,
            lat: liveLat,
            lng: liveLng,
            loc: locName,
            isMoving,
            distKm: moveDistanceKm,
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
