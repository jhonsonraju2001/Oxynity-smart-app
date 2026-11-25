/**
 * ==============================================================================
 * OXYNITY SMART - SIMCom A7672S 4G LTE Cat-1 + GNSS/GPS Autonomous ESP32 Firmware
 * ==============================================================================
 * Hardware:
 *   - ESP32 NodeMCU / DevKit v1
 *   - SIMCom A7672S 4G LTE Cat-1 Module with GNSS/GPS (Jio 4G, Airtel 4G, Vi 4G)
 *   - Dual 5V Active-LOW Relay Module (Relay 1: GPIO 27, Relay 2: GPIO 26)
 *   - XB2 Industrial Push Buttons (START: GPIO 32, STOP: GPIO 33)
 *   - Analog DO Probe (ADC1: GPIO 34)
 *   - Hardware Serial UART2 (RX2: GPIO 16, TX2: GPIO 17 @ 115200 baud)
 *
 * Key Capabilities:
 *   1. Pure 4G LTE Cat-1 data communication (Works on Jio VoLTE & Airtel/Vi LTE).
 *   2. Integrated GNSS/GPS live positioning (AT+CGNSSPWR=1 / AT+CGNSSINFO).
 *   3. Real-time cellular signal reporting (CSQ 0-31, 0-100%).
 *   4. Instant Remote Power Control (Relay 1 immediate, Relay 2 staggered by 2 min).
 *   5. ZERO ghost triggering: Physical buttons retained in code, protected by
 *      USE_PHYSICAL_BUTTONS (default false prevents floating pin noise).
 *   6. ZERO autonomous toggling: Relays switch ONLY when commanded by app or user.
 *   7. Drop-in, single-file sketch for Arduino IDE & Arduino Web Editor.
 * ==============================================================================
 */

#include <Arduino.h>
#include <HardwareSerial.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ==============================================================================
// 1. HARDWARE CONFIGURATION & PIN ASSIGNMENTS
// ==============================================================================
#define DEVICE_ID             "OXY-ESP32-004"   // Set matching Device ID in Oxynity App
#define FW_VERSION            "v3.0.0-A7672S-4G"
#define PROXY_URL             "https://oxynity-pond-bridge.jhonsonraju2003.workers.dev"

// SIMCom A7672S UART2 Connections
#define A7672S_RX_PIN         16   // ESP32 RX2 -> Connects to A7672S TXD
#define A7672S_TX_PIN         17   // ESP32 TX2 -> Connects to A7672S RXD
#define A7672S_BAUD           115200
#define A7672S_PWRKEY_PIN     -1   // Optional: GPIO to pulse PWRKEY, or -1 for auto-on

// Dual Relay Outputs
const int RELAY_PIN           = 27;  // Relay 1 - Main Aerator / Bubble Generator
const int RELAY_PIN_2         = 26;  // Relay 2 - Secondary Aerator / Booster
#define RELAY_ACTIVE_LOW      true   // Standard 5V relay module (LOW = ON, HIGH = OFF)

// Staggered Relay 2 Startup Delay (2 minutes = 120,000 ms)
const unsigned long RELAY_2_DELAY_MS = 120000UL;

// Physical XB2 Industrial Push Buttons (Retained with EMI noise protection)
// Set USE_PHYSICAL_BUTTONS to true ONLY when pushbuttons are physically wired.
// Set to false when running without physical buttons to prevent floating GPIO noise.
#define USE_PHYSICAL_BUTTONS       false
#define RED_BTN_NORMALLY_CLOSED    false  // Set true if Red XB2 has NC contact block (reads HIGH on press)
const int PIN_BTN_START            = 32;  // Green Button (NO) -> Connects to GND (INPUT_PULLUP)
const int PIN_BTN_STOP             = 33;  // Red Button (NC or NO) -> Connects to GND (INPUT_PULLUP)
#define BTN_DEBOUNCE_MS            150    // High-immunity debounce duration

// Status LEDs
const int LED_LTE             = 2;   // Onboard Blue LED (Solid = 4G LTE connected)
const int LED_MACHINE         = 25;  // Optional Machine Status LED (Solid = Relay 1 ON), -1 if unused

// Sensor Inputs
const int DO_SENSOR_PIN       = 34;  // Analog DO Sensor (ADC1 GPIO 34)

// Timing Intervals
const unsigned long CLOUD_POLL_INTERVAL_MS = 5000;   // 4G LTE telemetry poll every 5 seconds
const unsigned long GPS_READ_INTERVAL_MS   = 10000;  // Read GNSS coordinates every 10 seconds
const unsigned long SAVE_HOURS_INTERVAL_MS = 300000; // Save runtime hours to NVS every 5 minutes

// Default Baseline Coordinates (Amalapuram Pond, AP)
const float DEFAULT_LAT       = 16.5787f;
const float DEFAULT_LNG       = 82.0061f;

// ==============================================================================
// 2. RUNTIME STATE VARIABLES
// ==============================================================================
HardwareSerial a7672sSerial(2);
Preferences prefs;

bool          r1State             = false;
bool          r2State             = false;
bool          r2PendingStart      = false;
unsigned long r1StartTimeMs       = 0;
unsigned long runSessionStartMs   = 0;

float         liveLatitude        = DEFAULT_LAT;
float         liveLongitude       = DEFAULT_LNG;
bool          gpsFixAcquired      = false;
int           gpsSatellites       = 0;
float         gpsAltitude         = 0.0f;
float         gpsSpeedKmH         = 0.0f;

int           lteCsq              = 0;     // 0 - 31
int           lteSignalPercent    = 0;     // 0 - 100%
bool          lteRegistered       = false;
bool          networkAttached     = false;
String        carrierName         = "Searching...";
String        cellTacHex          = "";
String        cellIdHex           = "";

float         doLevelMgL          = 7.5f;
bool          doSensorDetected    = true;
float         supplyVoltageMv     = 3300.0f;

unsigned long totalCumulativeSec  = 0;
unsigned long lastLoopTickMs      = 0;
unsigned long lastCloudSyncMs     = 0;
unsigned long lastGpsReadMs       = 0;
unsigned long lastNvsSaveMs       = 0;

String        pendingButtonEvent  = "";
String        lastTriggerSource   = "System Boot";
bool          scheduleEnabled     = false;

// ==============================================================================
// 3. RELAY HARDWARE DRIVER (SEQUENTIAL 2-MINUTE STAGGERED START)
// ==============================================================================
void applyRelay1(bool on) {
  r1State = on;
  bool pinVal = on ? !RELAY_ACTIVE_LOW : RELAY_ACTIVE_LOW;
  digitalWrite(RELAY_PIN, pinVal ? HIGH : LOW);
  if (LED_MACHINE >= 0) digitalWrite(LED_MACHINE, on ? HIGH : LOW);
}

void applyRelay2(bool on) {
  r2State = on;
  bool pinVal = on ? !RELAY_ACTIVE_LOW : RELAY_ACTIVE_LOW;
  digitalWrite(RELAY_PIN_2, pinVal ? HIGH : LOW);
}

void startAeratorSequence(const char* trigger) {
  if (r1State) return; // Already running

  Serial.println(F("\n========================================================"));
  Serial.printf("[Sequencer] 🚀 STARTING AERATORS: Triggered by %s\n", trigger);
  Serial.println(F("========================================================"));

  applyRelay1(true);
  applyRelay2(false);
  r2PendingStart    = true;
  r1StartTimeMs     = millis();
  runSessionStartMs = millis();
  lastTriggerSource = String(trigger);

  Serial.println(F("[Relay 1] ⚡ BUBBLE GENERATOR -> ACTIVE [IMMEDIATE]"));
  Serial.printf("[Relay 2] ⏳ Timer active: Secondary aerator starts in %lu seconds...\n\n",
                RELAY_2_DELAY_MS / 1000UL);
}

void stopAeratorSequence(const char* trigger) {
  Serial.println(F("\n--------------------------------------------------------"));
  Serial.printf("[Sequencer] 🛑 STOPPING AERATORS: Triggered by %s\n", trigger);
  Serial.println(F("--------------------------------------------------------"));

  applyRelay1(false);
  applyRelay2(false);
  r2PendingStart    = false;
  r1StartTimeMs     = 0;
  runSessionStartMs = 0;
  lastTriggerSource = String(trigger);

  Serial.println(F("[Relay 1] 🛑 TURNED OFF"));
  Serial.println(F("[Relay 2] 🛑 TURNED OFF"));
  Serial.println(F("[System]  ALL RELAYS SAFELY STOPPED.\n"));
}

void checkRelaySequenceTimer() {
  if (r2PendingStart && r1State && !r2State) {
    if (millis() - r1StartTimeMs >= RELAY_2_DELAY_MS) {
      applyRelay2(true);
      r2PendingStart = false;
      Serial.println(F("\n[Relay 2] ⚡ SECONDARY AERATOR -> ACTIVE (2-Minute Stagger Delay Complete)\n"));
    }
  }
}

// ==============================================================================
// 4. AT COMMAND COMMUNICATION ENGINE
// ==============================================================================
String sendAT(const String& cmd, unsigned long timeoutMs = 2000, bool debug = false) {
  while (a7672sSerial.available()) a7672sSerial.read(); // Clear input buffer
  a7672sSerial.println(cmd);

  String response = "";
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    while (a7672sSerial.available()) {
      char c = (char)a7672sSerial.read();
      response += c;
    }
    if (response.indexOf("OK\r\n") != -1 || response.indexOf("ERROR\r\n") != -1) {
      break;
    }
    delay(5);
  }

  if (debug) {
    Serial.printf("[AT Send] %s\n[AT Resp] %s\n", cmd.c_str(), response.c_str());
  }
  return response;
}

// ==============================================================================
// 5. SIMCom A7672S 4G LTE & GNSS INITIALIZATION
// ==============================================================================
bool initA7672S() {
  Serial.println(F("[A7672S] Initializing SIMCom A7672S 4G LTE Cat-1 Modem..."));

  // Auto-baud detection: send AT multiple times
  bool alive = false;
  for (int i = 0; i < 5; i++) {
    String r = sendAT("AT", 1000);
    if (r.indexOf("OK") != -1) {
      alive = true;
      break;
    }
    delay(500);
  }

  if (!alive) {
    Serial.println(F("[A7672S] ⚠️ No response from module. Check wiring (RX->17, TX->16) and power."));
    return false;
  }

  sendAT("ATE0", 1000);      // Disable local echo
  sendAT("AT+CMEE=2", 1000);  // Verbose error messages

  // Check SIM Card
  String cpin = sendAT("AT+CPIN?", 3000);
  if (cpin.indexOf("READY") == -1) {
    Serial.printf("[A7672S] ⚠️ SIM Card Not Ready: %s\n", cpin.c_str());
    return false;
  }
  Serial.println(F("[A7672S] ✅ SIM Card: READY"));

  // Check Carrier Operator
  String cops = sendAT("AT+COPS?", 3000);
  int firstQ = cops.indexOf('"');
  int secondQ = cops.indexOf('"', firstQ + 1);
  if (firstQ != -1 && secondQ != -1) {
    carrierName = cops.substring(firstQ + 1, secondQ);
    Serial.printf("[A7672S] 📶 Network Operator: %s\n", carrierName.c_str());
  }

  // Check Signal Quality
  updateSignalCSQ();

  // Wait for 4G LTE Network Registration (AT+CEREG?)
  Serial.println(F("[A7672S] Verifying 4G LTE Network Registration (AT+CEREG?)..."));
  for (int retry = 0; retry < 10; retry++) {
    String cereg = sendAT("AT+CEREG?", 2000);
    if (cereg.indexOf(",1") != -1 || cereg.indexOf(",5") != -1) {
      lteRegistered = true;
      Serial.printf("[A7672S] ✅ Registered on 4G LTE Network! (%s)\n", cereg.c_str());
      break;
    }
    delay(2000);
  }

  // Attach Packet Domain
  sendAT("AT+CGATT=1", 3000);

  // Set APN if needed based on operator (Jio, Airtel, Vi)
  String apn = "jionet";
  String lowerCarrier = carrierName;
  lowerCarrier.toLowerCase();
  if (lowerCarrier.indexOf("airtel") != -1) apn = "airtelgprs.com";
  else if (lowerCarrier.indexOf("vi") != -1 || lowerCarrier.indexOf("vodafone") != -1 || lowerCarrier.indexOf("idea") != -1) apn = "portalnmms";
  else if (lowerCarrier.indexOf("bsnl") != -1) apn = "bsnlnet";

  sendAT(String("AT+CGDCONT=1,\"IP\",\"") + apn + "\"", 2000);

  // Activate PDP Context 1 for 4G Data Bearer
  sendAT("AT+CGACT=1,1", 3000);

  // Configure SSL Profile 0 for Cloudflare HTTPS (TLS 1.2, bypass CA certificate check)
  sendAT("AT+CSSLCFG=\"sslversion\",0,4", 1000);
  sendAT("AT+CSSLCFG=\"authmode\",0,0", 1000);

  // Activate GNSS / GPS Engine
  Serial.println(F("[A7672S] Starting Built-in GNSS / GPS Engine..."));
  sendAT("AT+CGNSSPWR=1", 2000); // Standard A7672S GNSS power command
  sendAT("AT+CGPS=1", 2000);     // Compatibility fallback command

  digitalWrite(LED_LTE, HIGH);
  Serial.println(F("[A7672S] 🚀 SIMCom A7672S 4G LTE Modem Setup Complete!\n"));
  return true;
}

// ==============================================================================
// 6. SIGNAL QUALITY (CSQ)
// ==============================================================================
void updateSignalCSQ() {
  String csqResp = sendAT("AT+CSQ", 1500);
  int idx = csqResp.indexOf("+CSQ: ");
  if (idx != -1) {
    int comma = csqResp.indexOf(',', idx);
    if (comma != -1) {
      lteCsq = csqResp.substring(idx + 6, comma).toInt();
      if (lteCsq == 99) {
        lteSignalPercent = 0;
      } else {
        lteSignalPercent = constrain((int)round((lteCsq / 31.0f) * 100.0f), 0, 100);
      }
    }
  }
}

// ==============================================================================
// 7. GNSS / GPS COORDINATES ACQUISITION
// ==============================================================================
void updateGpsCoordinates() {
  // Query GNSS information (AT+CGNSSINFO)
  String gnssResp = sendAT("AT+CGNSSINFO", 2000);
  int prefixIdx = gnssResp.indexOf("+CGNSSINFO: ");

  if (prefixIdx != -1) {
    String payload = gnssResp.substring(prefixIdx + 12);
    payload.trim();

    // Format: <mode>,<sat_gps>,<sat_glonass>,<sat_bd>,<lat>,<N/S>,<lon>,<E/W>,<date>,<time>,<alt>,<speed>,...
    int commaIdx[12];
    int curPos = 0;
    bool validSplit = true;
    for (int i = 0; i < 12; i++) {
      commaIdx[i] = payload.indexOf(',', curPos);
      if (commaIdx[i] == -1 && i < 8) { validSplit = false; break; }
      curPos = commaIdx[i] + 1;
    }

    if (validSplit && commaIdx[4] > commaIdx[3] + 1 && commaIdx[6] > commaIdx[5] + 1) {
      String rawLat = payload.substring(commaIdx[3] + 1, commaIdx[4]);
      String latNs  = payload.substring(commaIdx[4] + 1, commaIdx[5]);
      String rawLon = payload.substring(commaIdx[5] + 1, commaIdx[6]);
      String lonEw  = payload.substring(commaIdx[6] + 1, commaIdx[7]);

      if (rawLat.length() >= 7 && rawLon.length() >= 7) {
        // Parse NMEA ddmm.mmmm to decimal degrees
        float rawLatVal = rawLat.toFloat();
        int latDeg = (int)(rawLatVal / 100.0f);
        float latMin = rawLatVal - (latDeg * 100.0f);
        float decimalLat = latDeg + (latMin / 60.0f);
        if (latNs == "S") decimalLat = -decimalLat;

        float rawLonVal = rawLon.toFloat();
        int lonDeg = (int)(rawLonVal / 100.0f);
        float lonMin = rawLonVal - (lonDeg * 100.0f);
        float decimalLon = lonDeg + (lonMin / 60.0f);
        if (lonEw == "W") decimalLon = -decimalLon;

        if (abs(decimalLat) > 0.1f && abs(decimalLon) > 0.1f) {
          liveLatitude   = decimalLat;
          liveLongitude  = decimalLon;
          gpsFixAcquired = true;

          // Parse Satellites & Speed
          int satGps = payload.substring(commaIdx[0] + 1, commaIdx[1]).toInt();
          int satGlo = payload.substring(commaIdx[1] + 1, commaIdx[2]).toInt();
          gpsSatellites  = satGps + satGlo;

          if (commaIdx[10] != -1 && commaIdx[11] != -1) {
            gpsAltitude  = payload.substring(commaIdx[9] + 1, commaIdx[10]).toFloat();
            gpsSpeedKmH  = payload.substring(commaIdx[10] + 1, commaIdx[11]).toFloat() * 1.852f; // Knots to km/h
          }

          Serial.printf("[A7672S GPS] 🛰️ Fix Acquired! Lat: %.6f, Lon: %.6f | Sats: %d | Speed: %.1f km/h\n",
                        liveLatitude, liveLongitude, gpsSatellites, gpsSpeedKmH);
          return;
        }
      }
    }
  }

  // If GNSS has no satellite fix yet (e.g. indoor test), read Serving Cell Info (AT+CPSI?)
  String cpsi = sendAT("AT+CPSI?", 1500);
  int lteIdx = cpsi.indexOf("LTE,");
  if (lteIdx != -1) {
    // Format: +CPSI: LTE,Online,404-45,0x1A2B,1234567,...
    int p1 = cpsi.indexOf(',', lteIdx + 4);
    int p2 = cpsi.indexOf(',', p1 + 1);
    int p3 = cpsi.indexOf(',', p2 + 1);
    int p4 = cpsi.indexOf(',', p3 + 1);
    if (p3 != -1 && p4 != -1) {
      cellTacHex = cpsi.substring(p2 + 1, p3);
      cellIdHex  = cpsi.substring(p3 + 1, p4);
      cellTacHex.trim();
      cellIdHex.trim();
    }
  }
}

// ==============================================================================
// 8. 4G LTE TELEMETRY UPLINK & REMOTE COMMAND DOWNLINK
// ==============================================================================
void syncWithCloudBridge() {
  updateSignalCSQ();

  // Read DO sensor
  int rawAdc = analogRead(DO_SENSOR_PIN);
  supplyVoltageMv = (rawAdc / 4095.0f) * 3300.0f;
  doLevelMgL = constrain((supplyVoltageMv / 250.0f), 0.0f, 15.0f);

  // Compute active session runtime
  unsigned long sessionSecs = 0;
  if (r1State && runSessionStartMs > 0) {
    sessionSecs = (millis() - runSessionStartMs) / 1000UL;
  }

  // Construct JSON Telemetry Body (Universal ArduinoJson v6 & v7 compatibility)
#if defined(ARDUINOJSON_VERSION_MAJOR) && ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<768> doc;
#endif
  doc["deviceId"]               = DEVICE_ID;
  doc["status"]                 = r1State ? "ON" : "OFF";
  doc["status2"]                = r2State ? "ON" : "OFF";
  doc["gprsSignal"]             = lteSignalPercent;
  doc["csq"]                    = lteCsq;
  doc["networkType"]            = "4G LTE";
  doc["modemModel"]             = "SIMCom A7672S";
  doc["latitude"]               = serialized(String(liveLatitude, 6));
  doc["longitude"]              = serialized(String(liveLongitude, 6));
  doc["gpsFix"]                 = gpsFixAcquired;
  doc["satellites"]             = gpsSatellites;
  doc["speedKmH"]               = gpsSpeedKmH;
  doc["altitudeM"]              = gpsAltitude;
  doc["doLevel"]                = doLevelMgL;
  doc["voltageMv"]              = supplyVoltageMv;
  doc["currentSessionSeconds"]  = sessionSecs;
  doc["currentSessionMinutes"]  = sessionSecs / 60;
  doc["totalRunHours"]          = (float)totalCumulativeSec / 3600.0f;
  doc["firmwareScheduler"]      = true;
  doc["fwVersion"]              = FW_VERSION;
  doc["triggerSource"]          = lastTriggerSource;

  if (cellTacHex.length() > 0) doc["cellLac"] = cellTacHex;
  if (cellIdHex.length() > 0)  doc["cellId"]  = cellIdHex;

  if (pendingButtonEvent.length() > 0) {
    doc["manualButtonTrigger"] = pendingButtonEvent;
    doc["isButtonEvent"]       = true;
  }

  String jsonBody;
  serializeJson(doc, jsonBody);

  // Perform HTTP POST via SIMCom AT Commands
  sendAT("AT+HTTPTERM", 500);  // Terminate any old session
  sendAT("AT+HTTPINIT", 2000);
  sendAT(String("AT+HTTPPARA=\"URL\",\"") + PROXY_URL + "\"", 1500);
  sendAT("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 1000);
  sendAT("AT+HTTPPARA=\"SSLCFG\",0", 1000); // Route HTTPS traffic through SSL Profile 0

  // Prepare HTTPDATA with size and 5-second buffer timeout
  while (a7672sSerial.available()) a7672sSerial.read();
  a7672sSerial.printf("AT+HTTPDATA=%d,5000\r\n", jsonBody.length());

  bool gotDownload = false;
  unsigned long startWait = millis();
  while (millis() - startWait < 3000) {
    if (a7672sSerial.available()) {
      String line = a7672sSerial.readStringUntil('\n');
      if (line.indexOf("DOWNLOAD") != -1) {
        gotDownload = true;
        break;
      }
    }
    delay(10);
  }

  if (!gotDownload) {
    Serial.println(F("[Cloud Bridge] ⚠️ Modem did not prompt DOWNLOAD."));
    sendAT("AT+HTTPTERM", 500);
    return;
  }

  // Stream raw JSON payload
  a7672sSerial.print(jsonBody);

  // Trigger POST action (1 = POST)
  String actResp = sendAT("AT+HTTPACTION=1", 10000);

  if (actResp.indexOf(",200,") != -1) {
    // Read response body
    String readResp = sendAT("AT+HTTPREAD", 3000);
    sendAT("AT+HTTPTERM", 500);

    // Clear one-time button trigger upon successful delivery
    if (pendingButtonEvent.length() > 0) {
      pendingButtonEvent = "";
    }

    // Parse Downlink Server JSON Response
    int bodyStart = readResp.indexOf('{');
    int bodyEnd   = readResp.lastIndexOf('}');
    if (bodyStart != -1 && bodyEnd != -1) {
      String jsonReply = readResp.substring(bodyStart, bodyEnd + 1);
#if defined(ARDUINOJSON_VERSION_MAJOR) && ARDUINOJSON_VERSION_MAJOR >= 7
      JsonDocument r;
#else
      StaticJsonDocument<512> r;
#endif
      if (!deserializeJson(r, jsonReply)) {
        // 1. Process Authoritative Remote App Command ("cmd")
        String cmd = r["cmd"] | "";
        if (cmd == "ON") {
          if (!r1State) {
            Serial.println(F("[Cloud Command] >>> TURN ON MACHINE"));
            startAeratorSequence("Mobile App Switch");
          }
        } else if (cmd == "OFF") {
          if (r1State) {
            Serial.println(F("[Cloud Command] >>> TURN OFF MACHINE"));
            stopAeratorSequence("Mobile App Switch");
          }
        }

        // 2. Geofence status from server
        bool breached = r["isGeofenceBreached"] | false;
        if (breached) {
          float dist = r["distKm"] | 0.0f;
          Serial.printf("[ALERT] 🚨 GEOFENCE BREACH DETECTED! Machine moved %.2f km from pond anchor!\n", dist);
        }

        // 3. Synchronize Server Clock
        long epoch = r["t"] | 0;
        if (epoch > 1700000000) {
          struct timeval tv = { .tv_sec = epoch, .tv_usec = 0 };
          settimeofday(&tv, nullptr);
        }
      }
    }
    Serial.println(F("[Cloud Bridge] ✅ 4G LTE Telemetry Synchronized Successfully"));
  } else {
    static int syncFailures = 0;
    syncFailures++;
    Serial.printf("[Cloud Bridge] ⚠️ HTTP POST failed (attempt %d): %s\n", syncFailures, actResp.c_str());
    sendAT("AT+HTTPTERM", 500);

    // Self-healing: if 3 consecutive cloud sync attempts fail, reactivate PDP context and bearer
    if (syncFailures >= 3) {
      Serial.println(F("[A7672S] 🔄 3 consecutive sync failures: self-healing 4G LTE connection..."));
      sendAT("AT+CGATT=1", 3000);
      sendAT("AT+CGACT=1,1", 3000);
      syncFailures = 0;
    }
  }
}

// ==============================================================================
// 9. PHYSICAL XB2 PUSH BUTTON HANDLER (NOISE FILTERED)
// ==============================================================================
void handlePhysicalButtons() {
#if USE_PHYSICAL_BUTTONS
  static int lastStartRead = HIGH;
  static int lastStopRead  = HIGH;
  static unsigned long lastStartDebounce = 0;
  static unsigned long lastStopDebounce  = 0;
  unsigned long now = millis();

  // START Button (Green NO -> Pulls to GND when pressed)
  int startRead = digitalRead(PIN_BTN_START);
  if (startRead != lastStartRead) { lastStartDebounce = now; }
  if ((now - lastStartDebounce) > BTN_DEBOUNCE_MS) {
    if (startRead == LOW && !r1State) {
      Serial.println(F("[Push Button] 🟢 GREEN XB2 Button Pressed -> STARTING AERATOR"));
      pendingButtonEvent = "START";
      startAeratorSequence("Manual Green Button");
    }
  }
  lastStartRead = startRead;

  // STOP Button (Red XB2 -> filtered by NC/NO configuration)
  int stopRead = digitalRead(PIN_BTN_STOP);
  if (stopRead != lastStopRead) { lastStopDebounce = now; }
  if ((now - lastStopDebounce) > BTN_DEBOUNCE_MS) {
    bool isRedPressed = RED_BTN_NORMALLY_CLOSED ? (stopRead == HIGH) : (stopRead == LOW);
    if (isRedPressed && r1State) {
      Serial.println(F("[Push Button] 🔴 RED XB2 Button Pressed -> STOPPING AERATOR"));
      pendingButtonEvent = "STOP";
      stopAeratorSequence("Manual Red Button");
    }
  }
  lastStopRead = stopRead;
#endif
}

// ==============================================================================
// 10. SETUP & MAIN LOOP
// ==============================================================================
void setup() {
  // Disable brownout detector to prevent reboot during inductive relay switching
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  // Initialize Relays OFF immediately (prevents click on reboot)
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(RELAY_PIN_2, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? HIGH : LOW);
  digitalWrite(RELAY_PIN_2, RELAY_ACTIVE_LOW ? HIGH : LOW);

  pinMode(LED_LTE, OUTPUT);
  digitalWrite(LED_LTE, LOW);
  if (LED_MACHINE >= 0) {
    pinMode(LED_MACHINE, OUTPUT);
    digitalWrite(LED_MACHINE, LOW);
  }

#if USE_PHYSICAL_BUTTONS
  pinMode(PIN_BTN_START, INPUT_PULLUP);
  pinMode(PIN_BTN_STOP,  INPUT_PULLUP);
#endif

  Serial.begin(115200);
  delay(500);

  Serial.println(F("\n========================================================"));
  Serial.println(F("  Oxynity Smart - SIMCom A7672S 4G LTE Autonomous ESP32 "));
  Serial.printf("  Device ID: %s | Firmware: %s\n", DEVICE_ID, FW_VERSION);
  Serial.println(F("========================================================"));

  // Load lifetime runtime hours from flash memory (NVS)
  prefs.begin("oxy_a7672s", false);
  totalCumulativeSec = prefs.getULong("run_sec", 0);
  prefs.end();
  Serial.printf("[NVS] Loaded Cumulative Run Time: %.2f hours\n", (float)totalCumulativeSec / 3600.0f);

  // Initialize Hardware UART2 for SIMCom A7672S
  a7672sSerial.begin(A7672S_BAUD, SERIAL_8N1, A7672S_RX_PIN, A7672S_TX_PIN);
  delay(1000);

  initA7672S();
  lastLoopTickMs = millis();
}

void loop() {
  unsigned long now = millis();

  // 1. Check physical buttons
  handlePhysicalButtons();

  // 2. Check 2-minute staggered start for Relay 2
  checkRelaySequenceTimer();

  // 3. Accumulate runtime seconds while Relay 1 is active
  if (r1State && (now - lastLoopTickMs >= 1000)) {
    unsigned long elapsed = (now - lastLoopTickMs) / 1000UL;
    totalCumulativeSec += elapsed;
    lastLoopTickMs = now;
  } else if (!r1State) {
    lastLoopTickMs = now;
  }

  // 4. Save total runtime hours to NVS every 5 minutes while running
  if (r1State && (now - lastNvsSaveMs >= SAVE_HOURS_INTERVAL_MS)) {
    lastNvsSaveMs = now;
    prefs.begin("oxy_a7672s", false);
    prefs.putULong("run_sec", totalCumulativeSec);
    prefs.end();
    Serial.printf("[NVS] Saved Run Time: %.2f hours\n", (float)totalCumulativeSec / 3600.0f);
  }

  // 5. Query GNSS/GPS coordinates
  if (now - lastGpsReadMs >= GPS_READ_INTERVAL_MS) {
    lastGpsReadMs = now;
    updateGpsCoordinates();
  }

  // 6. 4G LTE Cloud Telemetry Sync & Remote Command Poll
  if (now - lastCloudSyncMs >= CLOUD_POLL_INTERVAL_MS || pendingButtonEvent.length() > 0) {
    lastCloudSyncMs = now;
    syncWithCloudBridge();
  }

  delay(20);
}
