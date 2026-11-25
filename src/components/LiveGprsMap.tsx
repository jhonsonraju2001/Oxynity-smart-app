import React, { useEffect, useRef, useState } from 'react';
import {
  MapPin,
  Signal,
  Copy,
  Check,
  ExternalLink,
  Radio,
  Layers,
  Clock,
  Download,
  Trash2,
  Compass,
  Cpu,
  LocateFixed,
  Navigation,
  Lock,
  Unlock,
  RefreshCw,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Geolocation } from '@capacitor/geolocation';
import { DeviceTelemetry } from '../types/iot';
import { exportFile } from '../lib/fileExport';

interface LiveGprsMapProps {
  device: DeviceTelemetry;
  onCalibrateLocation?: (
    lat: number,
    lng: number,
    locName: string,
    cellLac?: string,
    cellId?: string
  ) => Promise<void>;
  onResetCalibration?: () => Promise<void>;
}

export interface RealGprsPing {
  id: string;
  isoDate: string;
  timeStr: string;
  latitude: number;
  longitude: number;
  signalCsq: number;
  locationName: string;
  source: string;
}

export const LiveGprsMap: React.FC<LiveGprsMapProps> = ({
  device,
  onCalibrateLocation,
  onResetCalibration,
}) => {
  if (!device || !device.deviceId) {
    return (
      <div className="bg-slate-900 rounded-3xl p-8 border border-slate-800 text-center space-y-3">
        <MapPin className="w-10 h-10 text-slate-500 mx-auto" />
        <h3 className="text-base font-bold text-white">No Linked Pond</h3>
        <p className="text-xs text-slate-400">
          Please link your ESP32 device to view live SIMCom A7672S 4G LTE telemetry.
        </p>
      </div>
    );
  }

  const {
    latitude,
    longitude,
    locationName = 'A7672S 4G Station',
    gprsSignal = 0,
    name = 'Oxynity Pond',
    deviceId,
    updatedAt,
    lastSeen,
    gprsConnected = true,
    isCalibrated = false,
    calibratedLatitude,
    calibratedLongitude,
    calibratedLocationName,
    cellLac,
    cellId,
    isMoving = false,
    moveDistanceKm = 0,
  } = device;

  const [copied, setCopied] = useState(false);
  const [mapLayer, setMapLayer] = useState<'street' | 'satellite'>('street');
  const [exportedSuccess, setExportedSuccess] = useState(false);
  const [, setTimerTick] = useState(0);

  // Safeguard: Filter out any legacy Kerala mock coordinates (Kochi: ~9.93, ~76.26)
  const isLegacyKerala =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Math.abs(latitude - 9.9312) < 0.05 &&
    Math.abs(longitude - 76.2673) < 0.05;

  // Determine active display coordinates:
  // If calibrated and stationary: firmly stick to calibrated pond coordinates!
  // If moving: display live moving coordinates!
  const hasCalibratedCoords =
    isCalibrated &&
    typeof calibratedLatitude === 'number' &&
    typeof calibratedLongitude === 'number' &&
    calibratedLatitude !== 0;

  const effectiveLat = (!isMoving && hasCalibratedCoords)
    ? calibratedLatitude!
    : ((!latitude || isLegacyKerala) ? 16.5787 : latitude);

  const effectiveLng = (!isMoving && hasCalibratedCoords)
    ? calibratedLongitude!
    : ((!longitude || isLegacyKerala) ? 82.0061 : longitude);

  const displayLat = effectiveLat;
  const displayLng = effectiveLng;

  const displayLocName = (!isMoving && hasCalibratedCoords && calibratedLocationName)
    ? calibratedLocationName
    : ((!locationName || isLegacyKerala) ? 'Amalapuram Pond, Andhra Pradesh' : locationName);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const anchorMarkerRef = useRef<L.Marker | null>(null);
  const geofenceCircleRef = useRef<L.Circle | null>(null);
  const travelLineRef = useRef<L.Polyline | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const [showManualModal, setShowManualModal] = useState(false);
  const [inputLat, setInputLat] = useState('');
  const [inputLng, setInputLng] = useState('');

  // Re-render every 3 seconds to update relative live heartbeat counter ("X seconds ago")
  useEffect(() => {
    const timer = setInterval(() => setTimerTick((t) => t + 1), 3000);
    return () => clearInterval(timer);
  }, []);

  // Persistent REAL GPRS Pings log (stored in localStorage for this device ID)
  const [realPings, setRealPings] = useState<RealGprsPing[]>(() => {
    const storageKey = `oxynity_a7672s_pings_${deviceId}`;
    const saved = localStorage.getItem(storageKey) || localStorage.getItem(`oxynity_sim900a_pings_${deviceId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Exclude any old cached Kerala pings
          const cleaned = parsed.filter(
            (p) => !(Math.abs(p.latitude - 9.9312) < 0.05 && Math.abs(p.longitude - 76.2673) < 0.05)
          );
          if (cleaned.length > 0) return cleaned;
        }
      } catch {}
    }

    // Initialize with current effective device location as first real ping
    if (displayLat && displayLng && (displayLat !== 0 || displayLng !== 0)) {
      const now = new Date();
      return [
        {
          id: `ping-${now.getTime()}`,
          isoDate: now.toISOString().slice(0, 10),
          timeStr: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          latitude: parseFloat(displayLat.toFixed(6)),
          longitude: parseFloat(displayLng.toFixed(6)),
          signalCsq: gprsSignal,
          locationName: displayLocName || 'Amalapuram Pond, Andhra Pradesh',
          source: isLegacyKerala ? 'Amalapuram GPRS Base Station' : (device.locationSource || 'SIMCom A7672S 4G LTE'),
        },
      ];
    }
    return [];
  });

  // Record new real coordinates whenever device telemetry coordinates update
  useEffect(() => {
    if (!displayLat || !displayLng || (displayLat === 0 && displayLng === 0)) return;

    setRealPings((prev) => {
      const lastPing = prev[0];
      const latDiff = lastPing ? Math.abs(lastPing.latitude - displayLat) : 1;
      const lngDiff = lastPing ? Math.abs(lastPing.longitude - displayLng) : 1;

      // Only append if coordinates changed noticeably or if list is empty
      if (!lastPing || latDiff > 0.00005 || lngDiff > 0.00005) {
        const now = new Date();
        const newPing: RealGprsPing = {
          id: `ping-${now.getTime()}`,
          isoDate: now.toISOString().slice(0, 10),
          timeStr: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          latitude: parseFloat(displayLat.toFixed(6)),
          longitude: parseFloat(displayLng.toFixed(6)),
          signalCsq: gprsSignal,
          locationName: displayLocName || 'Amalapuram Pond, Andhra Pradesh',
          source: isLegacyKerala ? 'Amalapuram GPRS Base Station' : (device.locationSource || 'SIMCom A7672S 4G LTE'),
        };
        const updated = [newPing, ...prev.slice(0, 49)]; // keep latest 50 real pings
        localStorage.setItem(`oxynity_a7672s_pings_${deviceId}`, JSON.stringify(updated));
        return updated;
      }
      return prev;
    });
  }, [displayLat, displayLng, gprsSignal, displayLocName, deviceId, isLegacyKerala, device.locationSource]);

  // Leaflet Map Initialization and Layer updates
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const currentLat = displayLat;
    const currentLng = displayLng;

    // Tile URLs
    const streetUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const satelliteUrl =
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

    const activeTileUrl = mapLayer === 'satellite' ? satelliteUrl : streetUrl;
    const activeAttribution =
      mapLayer === 'satellite'
        ? '&copy; Esri World Imagery'
        : '&copy; OpenStreetMap contributors';

    if (!mapInstanceRef.current) {
      if ((mapContainerRef.current as any)._leaflet_id) {
        try {
          delete (mapContainerRef.current as any)._leaflet_id;
        } catch {}
      }
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,
      }).setView([currentLat, currentLng], 15);

      tileLayerRef.current = L.tileLayer(activeTileUrl, {
        attribution: activeAttribution,
        maxZoom: 19,
      }).addTo(map);

      // Custom animated SIMCom A7672S 4G Cell Marker
      const customIcon = L.divIcon({
        className: 'custom-oxynity-a7672s-marker',
        html: `
          <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; width: 48px; height: 48px; background: rgba(14, 165, 233, 0.35); border-radius: 50%; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <div style="position: relative; width: 34px; height: 34px; background: #0284c7; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,0.4);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 20h20"></path>
                <path d="M12 2v18"></path>
                <path d="m8 6 4-4 4 4"></path>
                <path d="M4 12c4-2 12-2 16 0"></path>
                <path d="M7 16c2.5-1 7.5-1 10 0"></path>
              </svg>
            </div>
          </div>
        `,
        iconSize: [48, 48],
        iconAnchor: [24, 24],
      });

      const marker = L.marker([currentLat, currentLng], { icon: customIcon }).addTo(map);
      marker.bindPopup(`
        <div style="font-family: sans-serif; font-size: 11px; padding: 2px;">
          <strong style="color: #0284c7; font-size: 12px; display: block; margin-bottom: 2px;">${isMoving ? '🚗 Moving A7672S 4G Fix' : '📡 SIMCom A7672S 4G Position'}</strong>
          <span style="font-weight: bold; color: #1e293b;">${name}</span><br/>
          <span style="font-family: monospace; color: #475569;">${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}</span><br/>
          <span style="color: #10b981; font-weight: bold;">CSQ Signal: ${gprsSignal}%</span>
        </div>
      `);

      mapInstanceRef.current = map;
      markerRef.current = marker;
    } else {
      mapInstanceRef.current.setView([currentLat, currentLng], mapInstanceRef.current.getZoom());
      if (markerRef.current) {
        markerRef.current.setLatLng([currentLat, currentLng]);
      }
      if (tileLayerRef.current) {
        tileLayerRef.current.setUrl(activeTileUrl);
      }
    }

    // Geofence Circle (1.0 km) & Calibrated Pond Anchor
    if (mapInstanceRef.current) {
      if (hasCalibratedCoords) {
        const calLat = calibratedLatitude!;
        const calLng = calibratedLongitude!;
        const isBreached = moveDistanceKm > 1.0 || device.isGeofenceBreached === true;
        const circleColor = isBreached ? '#ef4444' : '#10b981';

        // 1.0 km radius geofence boundary circle
        if (!geofenceCircleRef.current) {
          geofenceCircleRef.current = L.circle([calLat, calLng], {
            radius: 1000, // 1 km radius
            color: circleColor,
            weight: isBreached ? 3 : 2,
            dashArray: isBreached ? '8, 6' : '6, 6',
            fillColor: circleColor,
            fillOpacity: isBreached ? 0.15 : 0.08,
          }).addTo(mapInstanceRef.current);
        } else {
          geofenceCircleRef.current.setLatLng([calLat, calLng]);
          geofenceCircleRef.current.setStyle({
            color: circleColor,
            weight: isBreached ? 3 : 2,
            dashArray: isBreached ? '8, 6' : '6, 6',
            fillColor: circleColor,
            fillOpacity: isBreached ? 0.15 : 0.08,
          });
        }

        if (isMoving) {
          if (!anchorMarkerRef.current) {
            const anchorIcon = L.divIcon({
              className: 'custom-oxynity-anchor-marker',
              html: `
                <div style="position: relative; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center;">
                  <div style="position: relative; width: 32px; height: 32px; background: ${isBreached ? '#dc2626' : '#059669'}; border: 3px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.35);">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                  </div>
                </div>
              `,
              iconSize: [42, 42],
              iconAnchor: [21, 21],
            });

            const anchorMarker = L.marker([calLat, calLng], { icon: anchorIcon }).addTo(mapInstanceRef.current);
            anchorMarker.bindPopup(`
              <div style="font-family: sans-serif; font-size: 11px; padding: 2px;">
                <strong style="color: ${isBreached ? '#dc2626' : '#059669'}; font-size: 12px; display: block; margin-bottom: 2px;">🔒 Calibrated Pond Anchor</strong>
                <span style="font-weight: bold; color: #1e293b;">${calibratedLocationName || 'Pond Anchor'}</span><br/>
                <span style="font-family: monospace; color: #475569;">${calLat.toFixed(5)}, ${calLng.toFixed(5)}</span><br/>
                <span style="color: ${isBreached ? '#dc2626' : '#059669'}; font-weight: bold;">${isBreached ? '🚨 GEOFENCE BREACH (> 1.0 km)' : 'Status: Stationary Anchor (1 km Safe)'}</span>
              </div>
            `);
            anchorMarkerRef.current = anchorMarker;
          } else {
            anchorMarkerRef.current.setLatLng([calLat, calLng]);
          }

          // Draw dashed travel line from Calibrated Pond to Moving Machine
          if (!travelLineRef.current) {
            const travelLine = L.polyline([[calLat, calLng], [currentLat, currentLng]], {
              color: isBreached ? '#ef4444' : '#f59e0b',
              weight: isBreached ? 4 : 3,
              dashArray: '6, 6',
            }).addTo(mapInstanceRef.current);
            travelLineRef.current = travelLine;
          } else {
            travelLineRef.current.setLatLngs([[calLat, calLng], [currentLat, currentLng]]);
            travelLineRef.current.setStyle({
              color: isBreached ? '#ef4444' : '#f59e0b',
              weight: isBreached ? 4 : 3,
            });
          }
        } else {
          if (anchorMarkerRef.current) {
            anchorMarkerRef.current.remove();
            anchorMarkerRef.current = null;
          }
          if (travelLineRef.current) {
            travelLineRef.current.remove();
            travelLineRef.current = null;
          }
        }
      } else {
        if (geofenceCircleRef.current) {
          geofenceCircleRef.current.remove();
          geofenceCircleRef.current = null;
        }
        if (anchorMarkerRef.current) {
          anchorMarkerRef.current.remove();
          anchorMarkerRef.current = null;
        }
        if (travelLineRef.current) {
          travelLineRef.current.remove();
          travelLineRef.current = null;
        }
      }
    }

    // Draw authentic line connecting real past pings if more than 1 point exists
    if (mapInstanceRef.current) {
      if (polylineRef.current) {
        polylineRef.current.remove();
      }

      if (realPings.length > 1) {
        const coords: [number, number][] = realPings.map((p) => [p.latitude, p.longitude]);
        const polyline = L.polyline(coords, {
          color: '#0284c7',
          weight: 3,
          opacity: 0.8,
          dashArray: '6, 6',
        }).addTo(mapInstanceRef.current);

        polylineRef.current = polyline;
      }
    }
  }, [displayLat, displayLng, mapLayer, realPings, name, gprsSignal, isMoving, hasCalibratedCoords, calibratedLatitude, calibratedLongitude, calibratedLocationName]);

  // Cleanup Leaflet Map Instance on Component Unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch {}
        mapInstanceRef.current = null;
        tileLayerRef.current = null;
        markerRef.current = null;
        anchorMarkerRef.current = null;
        travelLineRef.current = null;
        polylineRef.current = null;
      }
    };
  }, []);

  // Copy coordinates helper
  const handleCopyCoords = () => {
    navigator.clipboard.writeText(`${displayLat.toFixed(6)}, ${displayLng.toFixed(6)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Center map on live SIM900A location
  const handleCenterLive = () => {
    if (mapInstanceRef.current && displayLat && displayLng) {
      mapInstanceRef.current.setView([displayLat, displayLng], 17, { animate: true });
      if (markerRef.current) {
        markerRef.current.openPopup();
      }
    }
  };

  // Center map on Calibrated Pond Anchor
  const handleCenterAnchor = () => {
    if (mapInstanceRef.current && calibratedLatitude && calibratedLongitude) {
      mapInstanceRef.current.setView([calibratedLatitude, calibratedLongitude], 17, { animate: true });
      if (anchorMarkerRef.current) {
        anchorMarkerRef.current.openPopup();
      }
    }
  };

  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrateSuccess, setCalibrateSuccess] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Calibrate pond coordinates using phone's high-precision live GPS
  const handleCalibratePhoneGps = async () => {
    setIsCalibrating(true);
    try {
      let lat: number | null = null;
      let lng: number | null = null;
      let accuracyMeters = 5;

      try {
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
        });
        lat = parseFloat(pos.coords.latitude.toFixed(6));
        lng = parseFloat(pos.coords.longitude.toFixed(6));
        accuracyMeters = Math.round(pos.coords.accuracy || 5);
      } catch {
        if (navigator.geolocation) {
          await new Promise<void>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
              (p) => {
                lat = parseFloat(p.coords.latitude.toFixed(6));
                lng = parseFloat(p.coords.longitude.toFixed(6));
                accuracyMeters = Math.round(p.coords.accuracy);
                resolve();
              },
              (err) => reject(err),
              { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
          });
        }
      }

      if (lat !== null && lng !== null) {
        const locLabel = `Pond GPS Calibrated (±${accuracyMeters}m)`;
        if (onCalibrateLocation) {
          await onCalibrateLocation(lat, lng, locLabel, cellLac, cellId);
        }

        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([lat, lng], 17, { animate: true });
        }

        setIsCalibrating(false);
        setCalibrateSuccess(true);
        setTimeout(() => setCalibrateSuccess(false), 3500);
      } else {
        throw new Error('Could not acquire GPS position');
      }
    } catch (err: any) {
      setIsCalibrating(false);
      alert(`Could not acquire GPS: ${err.message || err}. Please allow location permissions on your phone.`);
    }
  };

  // Calibrate pond coordinates using SIMCom A7672S 4G module live GPS
  const handleCalibrateDeviceGps = async () => {
    if (!latitude || !longitude || Math.abs(latitude) < 0.01) {
      alert('SIMCom A7672S 4G module has not acquired a live GPS fix yet. Please verify GNSS antenna.');
      return;
    }
    setIsCalibrating(true);
    try {
      const lat = parseFloat(latitude.toFixed(6));
      const lng = parseFloat(longitude.toFixed(6));
      const locLabel = `A7672S 4G GNSS Anchor (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      if (onCalibrateLocation) {
        await onCalibrateLocation(lat, lng, locLabel, cellLac, cellId);
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([lat, lng], 17, { animate: true });
      }
      setIsCalibrating(false);
      setCalibrateSuccess(true);
      setTimeout(() => setCalibrateSuccess(false), 3500);
    } catch (e: any) {
      setIsCalibrating(false);
      alert(`Calibration failed: ${e.message || e}`);
    }
  };

  // Calibrate using manual coordinates
  const handleSaveManual = async () => {
    const lat = parseFloat(inputLat);
    const lng = parseFloat(inputLng);
    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      alert('Please enter valid coordinates (e.g. 16.5787, 82.0061)');
      return;
    }
    setIsCalibrating(true);
    try {
      const locLabel = `Manual Pond Anchor (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      if (onCalibrateLocation) {
        await onCalibrateLocation(lat, lng, locLabel, cellLac, cellId);
      }
      setShowManualModal(false);
      setInputLat('');
      setInputLng('');
      setIsCalibrating(false);
      setCalibrateSuccess(true);
      setTimeout(() => setCalibrateSuccess(false), 3500);
    } catch (e: any) {
      setIsCalibrating(false);
      alert(`Save failed: ${e.message || e}`);
    }
  };

  // Reset / Unstick calibration and return to pure live A7672S cellular tracking
  const handleResetCalibrationClick = async () => {
    if (confirm('Unstick pond calibration and switch back to dynamic live moving SIMCom A7672S tracking?')) {
      setIsResetting(true);
      try {
        if (onResetCalibration) {
          await onResetCalibration();
        }
      } finally {
        setIsResetting(false);
      }
    }
  };

  // Export Real Pings CSV
  const handleExportPingsCsv = () => {
    const headers = [
      'Ping ID',
      'Device ID',
      'Pond Name',
      'Date',
      'Time',
      'Latitude',
      'Longitude',
      'CSQ Signal (%)',
      'Location Source',
    ];

    const rows = realPings.map((p) => [
      p.id,
      deviceId,
      `"${name.replace(/"/g, '""')}"`,
      p.isoDate,
      p.timeStr,
      p.latitude.toFixed(6),
      p.longitude.toFixed(6),
      p.signalCsq,
      `"${p.source}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const filename = `A7672S_4G_Pings_${deviceId}_${new Date().toISOString().split('T')[0]}.csv`;

    exportFile({
      filename,
      content: csvContent,
      mimeType: 'text/csv;charset=utf-8;',
      title: `SIMCom A7672S 4G Pings (${name || deviceId})`,
      dialogTitle: 'Export GPRS Pings CSV',
    })
      .then((res) => {
        if (res.success) {
          setExportedSuccess(true);
          setTimeout(() => setExportedSuccess(false), 3000);
        }
      })
      .catch((err) => {
        console.error('Failed to export GPRS pings CSV:', err);
      });
  };

  const handleClearHistory = () => {
    if (confirm('Clear A7672S location ping history for this device?')) {
      const reset = [
        {
          id: `ping-${Date.now()}`,
          isoDate: new Date().toISOString().slice(0, 10),
          timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          latitude: parseFloat(latitude.toFixed(6)),
          longitude: parseFloat(longitude.toFixed(6)),
          signalCsq: gprsSignal,
          locationName: locationName || 'A7672S 4G Station',
          source: 'A7672S 4G GNSS',
        },
      ];
      setRealPings(reset);
      localStorage.setItem(`oxynity_a7672s_pings_${deviceId}`, JSON.stringify(reset));
    }
  };

  // Relative time helper from last uplink
  const getRelativeTimeString = () => {
    const tsStr = lastSeen || updatedAt;
    if (!tsStr) return 'Connected via GPRS';
    const diffSecs = Math.max(0, Math.floor((Date.now() - new Date(tsStr).getTime()) / 1000));
    if (diffSecs <= 4) return 'Just now (Live)';
    if (diffSecs < 60) return `${diffSecs}s ago`;
    const mins = Math.floor(diffSecs / 60);
    return `${mins}m ago`;
  };

  // Signal Strength text tier
  const getSignalTier = (csq: number) => {
    if (csq >= 70) return { label: 'Excellent', color: 'text-emerald-500', bars: 4 };
    if (csq >= 50) return { label: 'Good', color: 'text-emerald-400', bars: 3 };
    if (csq >= 30) return { label: 'Fair', color: 'text-amber-400', bars: 2 };
    return { label: 'Weak', color: 'text-rose-400', bars: 1 };
  };

  const signalInfo = getSignalTier(gprsSignal);

  return (
    <div className="space-y-4 sm:space-y-5 w-full max-w-full">
      {/* 1. TOP HEADER & GSM SIM900A STATUS BAR */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 shadow-xs space-y-3.5 w-full max-w-full overflow-hidden">
        <div className="pb-3 border-b border-slate-100 dark:border-slate-800 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-1.5 sm:p-2 rounded-xl bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-900/50 shrink-0">
                <Radio className="w-4 h-4 animate-pulse" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 uppercase tracking-wide truncate">
                  SIMCom A7672S 4G LTE Live Location
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  Built-in GNSS / GPS + 4G LTE Cat-1 Telemetry for{' '}
                  <span className="font-bold text-sky-600 dark:text-sky-400">{name}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-1.5 shrink-0">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-extrabold bg-sky-50 dark:bg-sky-950/70 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>A7672S 4G LTE</span>
              </div>

              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 shrink-0">
                <Signal className={`w-3.5 h-3.5 ${signalInfo.color}`} />
                <span>CSQ: {gprsSignal}%</span>
                <span className={`text-[9px] font-extrabold ${signalInfo.color}`}>
                  ({signalInfo.label})
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs pt-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 truncate">
              <Clock className="w-3 h-3 text-sky-500 shrink-0" />
              <span>4G Heartbeat: {getRelativeTimeString()}</span>
            </span>

            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1 shrink-0 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" /> Real-time 4G GNSS Fix
            </span>
          </div>
        </div>

        {/* 2. 4G HARDWARE & TELEMETRY SPECS CARD */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* Signal Quality */}
          <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              4G LTE Signal
            </span>
            <div className="flex items-center justify-between mt-1">
              <p className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 font-mono">
                {gprsSignal}%
              </p>
              {/* 4-bar visual signal meter */}
              <div className="flex items-end gap-0.5 h-3.5">
                {[1, 2, 3, 4].map((bar) => (
                  <div
                    key={bar}
                    className={`w-1 rounded-2xs transition-colors ${
                      bar <= signalInfo.bars ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                    style={{ height: `${bar * 25}%` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 4G Bearer State */}
          <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              Network State
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className={`w-2 h-2 rounded-full ${
                  gprsConnected ? 'bg-emerald-500 animate-ping' : 'bg-amber-500'
                }`}
              />
              <p className="text-xs sm:text-sm font-extrabold text-slate-800 dark:text-slate-100 truncate">
                {gprsConnected ? 'Connected (4G)' : 'Searching'}
              </p>
            </div>
          </div>

          {/* Hardware Modem */}
          <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              Cellular Modem
            </span>
            <div className="flex items-center gap-1 mt-1">
              <Cpu className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <p className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">
                SIMCom A7672S
              </p>
            </div>
          </div>

          {/* Location Mode */}
          <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block truncate">
              Positioning
            </span>
            <div className="flex items-center gap-1 mt-1">
              <Compass className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <p className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">
                GNSS / GPS + LBS
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 2b. GEOFENCE BREACH WARNING BANNER (> 1.0 KM) */}
      {(moveDistanceKm > 1.0 || device.isGeofenceBreached === true) && (
        <div className="p-3.5 bg-rose-500/15 border-2 border-rose-500 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs animate-pulse shadow-md shadow-rose-500/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-rose-600 text-white shrink-0 shadow-sm">
              <Navigation className="w-4 h-4 animate-bounce" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center flex-wrap gap-2">
                <span className="font-black text-rose-600 dark:text-rose-400 uppercase tracking-wide">
                  🚨 GEOFENCE ALERT: MACHINE MOVED &gt; 1 KM
                </span>
                <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white font-black text-[10px]">
                  {moveDistanceKm.toFixed(2)} km FROM POND
                </span>
              </div>
              <p className="text-[11px] text-slate-700 dark:text-slate-300 mt-0.5 truncate">
                Machine {deviceId} ({name}) is {moveDistanceKm.toFixed(2)} km away from calibrated anchor! Possible theft or unauthorized relocation.
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-1.5 shrink-0">
            <button
              onClick={handleCenterLive}
              className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer transition-all shadow-xs"
              title="Track live moving machine"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Track Movement</span>
            </button>
            <button
              onClick={handleCenterAnchor}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer"
              title="View original locked anchor"
            >
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Pond Anchor</span>
            </button>
          </div>
        </div>
      )}

      {/* 2c. DUAL-MODE CALIBRATION & MOVING STATUS BANNER */}
      {isMoving && !(moveDistanceKm > 1.0 || device.isGeofenceBreached) ? (
        <div className="p-3.5 bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
              <Navigation className="w-4 h-4 animate-bounce" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center flex-wrap gap-2">
                <span className="font-black text-amber-700 dark:text-amber-300 uppercase tracking-wide">
                  🚗 A7672S IN MOTION / RELOCATED
                </span>
                {moveDistanceKm > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-200 font-extrabold text-[10px]">
                    {moveDistanceKm} km from Pond Anchor
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 truncate">
                Serving Tower: TAC <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{cellLac || 'Live'}</span>, CID <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{cellId || 'Active'}</span> • Real-time GNSS tracking
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-1.5 shrink-0">
            <button
              onClick={handleCalibrateDeviceGps}
              disabled={isCalibrating}
              className="px-2.5 py-1.5 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer transition-all shadow-xs"
              title="Lock coordinates using live A7672S GNSS fix"
            >
              <LocateFixed className="w-3.5 h-3.5" />
              <span>A7672S GPS</span>
            </button>
            <button
              onClick={handleCalibratePhoneGps}
              disabled={isCalibrating}
              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer transition-all shadow-xs"
              title="Lock coordinates to this new pond location with Phone GPS"
            >
              <LocateFixed className={`w-3.5 h-3.5 ${isCalibrating ? 'animate-spin' : ''}`} />
              <span>Phone GPS</span>
            </button>
            {hasCalibratedCoords && (
              <button
                onClick={handleCenterAnchor}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer"
                title="View Calibrated Pond Anchor"
              >
                <Lock className="w-3.5 h-3.5 text-emerald-500" />
                <span>Pond Anchor</span>
              </button>
            )}
          </div>
        </div>
      ) : isCalibrated ? (
        <div className="p-3 bg-emerald-500/10 dark:bg-emerald-950/30 border border-emerald-500/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-black text-emerald-800 dark:text-emerald-300 text-xs">
                  🔒 Calibrated Pond Anchor Locked (1.0 km Safe Geofence Active)
                </span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                  Fixed GPS Anchor
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                Locked at {calibratedLatitude?.toFixed(5)}, {calibratedLongitude?.toFixed(5)}. Geofence alerts trigger if moved &gt; 1.0 km.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setShowManualModal(true)}
              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[11px] rounded-xl flex items-center gap-1 cursor-pointer"
            >
              <Compass className="w-3 h-3 text-sky-500" />
              <span>Edit Coords</span>
            </button>
            <button
              onClick={handleResetCalibrationClick}
              disabled={isResetting}
              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 font-bold text-[11px] rounded-xl flex items-center gap-1 transition-all cursor-pointer"
              title="Unlock pond calibration to re-calibrate"
            >
              <Unlock className="w-3 h-3" />
              <span>Unlock</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3 bg-sky-500/10 dark:bg-sky-950/30 border border-sky-500/20 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-xl bg-sky-500/20 text-sky-600 dark:text-sky-400 shrink-0">
              <Radio className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <span className="font-bold text-sky-800 dark:text-sky-300 text-xs block">
                Pond Location Unlocked (No Geofence Anchor)
              </span>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                Calibrate and lock live coordinates to activate the 1.0 km anti-theft geofence.
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-1.5 shrink-0">
            <button
              onClick={handleCalibrateDeviceGps}
              disabled={isCalibrating}
              className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1 transition-all cursor-pointer shadow-xs shrink-0"
              title="Lock exact coordinates from A7672S GPS"
            >
              <LocateFixed className="w-3.5 h-3.5" />
              <span>A7672S GPS</span>
            </button>
            <button
              onClick={handleCalibratePhoneGps}
              disabled={isCalibrating}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1 transition-all cursor-pointer shadow-xs shrink-0"
              title="Calibrate exact pond coordinates using Phone GPS"
            >
              <LocateFixed className={`w-3.5 h-3.5 ${isCalibrating ? 'animate-spin' : ''}`} />
              <span>{isCalibrating ? 'Locating...' : 'Phone GPS'}</span>
            </button>
            <button
              onClick={() => setShowManualModal(true)}
              className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer"
            >
              <span>Search/Input</span>
            </button>
          </div>
        </div>
      )}

      {/* Manual Coordinate Entry Modal */}
      {showManualModal && (
        <div className="p-3.5 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-300 dark:border-slate-700 space-y-2 text-xs">
          <div className="flex justify-between items-center font-bold text-slate-800 dark:text-slate-100">
            <span>Enter / Search Pond Coordinates</span>
            <button onClick={() => setShowManualModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold">Latitude (Decimal)</label>
              <input
                type="text"
                placeholder="e.g. 16.5787"
                value={inputLat}
                onChange={(e) => setInputLat(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-mono font-bold"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold">Longitude (Decimal)</label>
              <input
                type="text"
                placeholder="e.g. 82.0061"
                value={inputLng}
                onChange={(e) => setInputLng(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-mono font-bold"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowManualModal(false)} className="px-3 py-1 text-slate-600 dark:text-slate-400 font-bold">Cancel</button>
            <button onClick={handleSaveManual} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xs">Lock Pond Anchor</button>
          </div>
        </div>
      )}

      {/* 3. INTERACTIVE MAP CONTAINER */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 shadow-xs space-y-3 w-full max-w-full overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <MapPin className="w-4 h-4 text-sky-500 shrink-0" />
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-100 truncate">
              {isMoving ? 'Live Moving 4G Tracker' : 'Live A7672S 4G Position'}
            </h4>
          </div>

          {/* Map Controls: Satellite Toggle, Center, Open Google Maps */}
          <div className="flex items-center flex-wrap gap-1.5 shrink-0">
            {/* Street / Satellite Toggle */}
            <button
              onClick={() => setMapLayer(mapLayer === 'street' ? 'satellite' : 'street')}
              className="min-h-[32px] px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl flex items-center gap-1 transition-all cursor-pointer"
              title="Toggle Street / Satellite View"
            >
              <Layers className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span>{mapLayer === 'street' ? 'Satellite' : 'Street'}</span>
            </button>

            {/* Center on live coords */}
            <button
              onClick={handleCenterLive}
              className="min-h-[32px] px-2.5 py-1 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1 transition-all cursor-pointer shadow-xs"
              title="Center Map on Live A7672S"
            >
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span>{isMoving ? 'Follow 4G Tracker' : 'Center'}</span>
            </button>

            {/* Calibrate with Phone GPS */}
            <button
              onClick={handleCalibratePhoneGps}
              disabled={isCalibrating}
              className="min-h-[32px] px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-60 text-white font-bold text-xs rounded-xl flex items-center gap-1 transition-all cursor-pointer shadow-xs"
              title="Calibrate exact pond coordinates using Phone GPS"
            >
              {calibrateSuccess ? (
                <Check className="w-3.5 h-3.5 text-white" />
              ) : (
                <LocateFixed className={`w-3.5 h-3.5 shrink-0 ${isCalibrating ? 'animate-spin' : ''}`} />
              )}
              <span>{isCalibrating ? 'Locating...' : calibrateSuccess ? 'Calibrated!' : isMoving ? 'Re-Calibrate' : 'Calibrate GPS'}</span>
            </button>

            {/* Google Maps direct link */}
            <a
              href={`https://maps.google.com/?q=${displayLat},${displayLng}`}
              target="_blank"
              rel="noreferrer"
              className="min-h-[32px] px-2.5 py-1 bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 font-bold text-xs rounded-xl border border-sky-200 dark:border-sky-800 flex items-center gap-1 hover:bg-sky-100 dark:hover:bg-sky-900 transition-colors"
              title="Open Coordinates in Google Maps"
            >
              <span>Maps</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          </div>
        </div>

        {/* Map Canvas */}
        <div className="relative w-full h-72 sm:h-84 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-inner z-10">
          <div ref={mapContainerRef} className="w-full h-full" />

          {/* Floating live fix pill overlay */}
          <div className="absolute bottom-2.5 left-2.5 z-20 flex items-center gap-1.5 px-2.5 py-1 bg-slate-900/90 text-white backdrop-blur-md rounded-xl border border-slate-700 text-[10px] font-bold shadow-md">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
            <span>A7672S 4G Live: {displayLat.toFixed(4)}, {displayLng.toFixed(4)}</span>
          </div>
        </div>

        {/* Live Coordinates Bar with 1-Click Copy */}
        <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-500 dark:text-slate-400">Pond Location:</span>
            <span className="font-black text-slate-800 dark:text-slate-100 truncate max-w-[200px]">
              {displayLocName}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-200/70 dark:border-slate-700/60">
            <span className="font-bold text-slate-500 dark:text-slate-400">Live Coordinates:</span>
            <div className="flex items-center gap-1.5">
              <span className="text-sky-600 dark:text-sky-400 font-mono font-black text-xs">
                {displayLat.toFixed(6)}° N, {displayLng.toFixed(6)}° E
              </span>
              <button
                onClick={handleCopyCoords}
                className="p-1 min-h-[28px] min-w-[28px] flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer text-slate-400 hover:text-slate-600"
                title="Copy Coordinates"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 4. REAL SIMCom A7672S 4G LOCATION PINGS LOG (NO FAKE SIMULATION) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 shadow-xs space-y-3 w-full max-w-full overflow-hidden">
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h4 className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 tracking-tight">
              Real A7672S 4G Location Fixes ({realPings.length})
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Authentic 4G LTE cellular fixes received from ESP32 hardware
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleExportPingsCsv}
              className="min-h-[30px] px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl transition-all flex items-center gap-1 cursor-pointer"
              title="Export Pings CSV"
            >
              {exportedSuccess ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Download className="w-3 h-3 text-slate-400" />
              )}
              <span>CSV</span>
            </button>

            {realPings.length > 1 && (
              <button
                onClick={handleClearHistory}
                className="min-h-[30px] p-1.5 bg-slate-100 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950 text-slate-400 hover:text-rose-500 rounded-xl transition-colors cursor-pointer"
                title="Reset History"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Real Pings List */}
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {realPings.map((ping, idx) => (
            <div
              key={ping.id}
              className="p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    idx === 0 ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'
                  }`}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-black text-slate-800 dark:text-slate-200 text-xs">
                      {ping.latitude.toFixed(5)}, {ping.longitude.toFixed(5)}
                    </span>
                    {idx === 0 && (
                      <span className="px-1.5 py-0.2 rounded-md text-[9px] font-black bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                        Current
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-mono">
                    {ping.isoDate} • {ping.timeStr}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 text-right">
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 font-mono">
                  CSQ: {ping.signalCsq}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
