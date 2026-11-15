/**
 * ==============================================================================
 * Oxynity Smart - ESP32 FIRMWARE v3.0 (CLEAN STANDALONE ARCHITECTURE)
 * ==============================================================================
 * 
 * - Pure Dynamic Architecture: Single configurable DEVICE_ID.
 *   Scales to any number of ponds (OXY-ESP32-001, OXY-ESP32-002, POND-003, etc.)
 *   with NO hardcoded pairings or artificial coupling.
 * - ALL networking runs on Core 0 via FreeRTOS background task.
 *   -> Physical buttons, relays, and the 2-minute sequence NEVER freeze!
 * - Fast Cloudflare Bridge HTTP Polling (~50ms latency, zero TLS overhead on Core 0).
 * - Automatic direct Google Firestore REST fallback if bridge is ever unreachable.
 * - 1-Button 2-Minute Sequence: Relay 1 turns ON immediately; Relay 2 turns ON after 120 seconds.
 * - Manual Green (START, GPIO 32) & Red (STOP, GPIO 33) buttons work 100% offline.
 * - No boot overwrite: Booting or reconnecting never wipes remote app commands.
 * 
 * Hardware Pin Mapping:
 *   • Relay 1 (Main Generator) : GPIO 27 (Active LOW)
 *   • Relay 2 (Secondary Pump) : GPIO 26 (Active LOW)
 *   • Green Button (START)     : GPIO 32 (INPUT_PULLUP -> GND, XB2 NO .3-.4)
 *   • Red Button (STOP)        : GPIO 33 (INPUT_PULLUP -> GND, XB2 NC .1-.2)
 *   • Status LED               : GPIO 2  (Blinks during 2-min countdown, solid when running)
 *   • Machine State LED        : GPIO 25 (Optional Green LED, -1 if unused)
 * ==============================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

// ==============================================================================
// 1. HARDWARE CONFIGURATION & CREDENTIALS
// ==============================================================================
// Match this exact Device ID to the pond selected in your Oxynity Mobile App:
// e.g. "OXY-ESP32-001" (Raju Pond) or "OXY-ESP32-002" (Jhonny Pond) or any new Pond ID!
const char* DEVICE_ID     = "OXY-ESP32-002";

// Wi-Fi Credentials (supports 2.4 GHz hotspot/router)
const char* WIFI_SSID     = "Jhonny iPhone";  // Your iPhone Personal Hotspot
const char* WIFI_PASSWORD = "rajubabu";       // Your Hotspot Password
#define ENABLE_WIFI       true

// Ultra-fast HTTP Bridge (Cloudflare Worker -> Google Firestore)
const char* CLOUD_URL     = "http://oxynity-pond-bridge.jhonsonraju2003.workers.dev";
const char* FIREBASE_KEY  = "AIzaSyCqOvdeEt19ntPzv3Bne1V1GackCnWdfwM";

const unsigned long SYNC_INTERVAL_MS      = 2000;   // 2s App command polling
const unsigned long HEARTBEAT_INTERVAL_MS = 8000;   // 8s Telemetry heartbeat

// ==============================================================================
// 2. PIN DEFINITIONS
// ==============================================================================
const int RELAY_PIN       = 27; // Relay 1 - Main Generator / Bubble Intake (GPIO 27)
const int RELAY_PIN_2     = 26; // Relay 2 - Secondary Aerator / Booster (GPIO 26)
const int PIN_BTN_START   = 32; // Green Push Button (START) -> Connects to GND (GPIO 32)
const int PIN_BTN_STOP    = 33; // Red Push Button (STOP)   -> Connects to GND (GPIO 33, NC contact)
const int LED_STATUS      =  2; // Onboard Blue LED
const int LED_MACHINE     = 25; // Optional Machine State LED (-1 if unused)

#define RELAY_ACTIVE_LOW        true
#define RED_BTN_NORMALLY_CLOSED true   // NC to GND: LOW normally, HIGH when pressed

// ==============================================================================
// 3. TIMING & COOLDOWN CONSTANTS
// ==============================================================================
const unsigned long RELAY_2_DELAY_MS      = 2UL * 60UL * 1000UL; // 2 minutes (120 seconds)
const unsigned long DEBOUNCE_DELAY_MS     = 50;                  // 50ms button debounce
const unsigned long COOLDOWN_RUN_LIMIT_MS = 6UL * 60UL * 60UL * 1000UL; // 6 hours
const unsigned long COOLDOWN_REST_MS      = 30UL * 60UL * 1000UL;      // 30 minutes
bool cooldownEnabled = true;

// ==============================================================================
// 4. OPERATIONAL STATE
// ==============================================================================
enum GeneratorState {
  GEN_OFF,
  GEN_STAGE1_WAITING_R2,
  GEN_STAGE2_FULL_RUNNING,
  GEN_COOLDOWN_REST
};

volatile GeneratorState machineState     = GEN_OFF;
volatile bool          generatorState    = false;
volatile bool          relay2State       = false;
volatile unsigned long totalSessionSecs  = 0;
volatile bool          pushPending       = false;  // Do NOT force OFF at boot; poll cloud first
volatile int           pendingCmd        = 0;      // 1 = START, 2 = STOP (from app)
volatile unsigned long lastManualPressMs = 0;
volatile int           wifiSignalPercent = 0;

unsigned long stage1StartTime      = 0;
unsigned long continuousRunStartMs = 0;
unsigned long cooldownStartMs      = 0;
unsigned long lastStateChangeMs    = 0;
unsigned long lastLedBlinkMs       = 0;
bool          ledBlinkToggle       = false;

int lastStartBtnReading = HIGH, startBtnState = HIGH;
unsigned long lastStartDebounceTime = 0;
int lastStopBtnReading  = HIGH, stopBtnState  = HIGH;
unsigned long lastStopDebounceTime  = 0;

WiFiClientSecure secClient; // Global TLS client for direct REST fallback

// ==============================================================================
// 5. RELAYS
// ==============================================================================
void writeRelayPin(int pin, bool turnOn) {
  bool pinHigh = turnOn ? !RELAY_ACTIVE_LOW : RELAY_ACTIVE_LOW;
  digitalWrite(pin, pinHigh ? HIGH : LOW);
}

void startGeneratorSequence(const char* src) {
  if (machineState == GEN_STAGE1_WAITING_R2 || machineState == GEN_STAGE2_FULL_RUNNING) return;

  Serial.println(F("\n============================================================"));
  Serial.printf("[Sequence] 🚀 START triggered by %s\n", src);
  Serial.println(F("============================================================"));

  generatorState = true;
  relay2State    = false;
  writeRelayPin(RELAY_PIN, true);
  writeRelayPin(RELAY_PIN_2, false);
  if (LED_MACHINE >= 0) digitalWrite(LED_MACHINE, HIGH);

  unsigned long now    = millis();
  stage1StartTime      = now;
  continuousRunStartMs = now;
  lastStateChangeMs    = now;
  cooldownStartMs      = 0;
  totalSessionSecs     = 0;
  machineState         = GEN_STAGE1_WAITING_R2;

  if (strstr(src, "Button") || strstr(src, "Serial")) lastManualPressMs = now;
  pushPending = true;

  Serial.println(F("[Relay 1] ⚡ BUBBLE GENERATOR -> TURNED ON [IMMEDIATE]"));
  Serial.printf("[Relay 2] ⏳ Timer active: Secondary Aerator will turn ON in %lu seconds (2 mins)...\n\n",
                RELAY_2_DELAY_MS / 1000UL);
}

void stopGeneratorSequence(const char* src) {
  Serial.println(F("\n------------------------------------------------------------"));
  Serial.printf("[Sequence] 🛑 STOP triggered by %s\n", src);
  Serial.println(F("------------------------------------------------------------"));

  generatorState = false;
  relay2State    = false;
  writeRelayPin(RELAY_PIN, false);
  writeRelayPin(RELAY_PIN_2, false);
  if (LED_MACHINE >= 0) digitalWrite(LED_MACHINE, LOW);
  digitalWrite(LED_STATUS, LOW);

  machineState          = GEN_OFF;
  stage1StartTime       = 0;
  continuousRunStartMs  = 0;
  cooldownStartMs       = 0;
  totalSessionSecs      = 0;

  if (strstr(src, "Button") || strstr(src, "Serial")) lastManualPressMs = millis();
  pushPending = true;

  Serial.println(F("[Relay 1] 🛑 TURNED OFF"));
  Serial.println(F("[Relay 2] 🛑 TURNED OFF\n"));
}

// ==============================================================================
// 6. BUTTON HANDLER (Runs on Core 1 with zero lag)
// ==============================================================================
void handleManualButtons() {
  unsigned long now = millis();

  // Green Push Button (START) - XB2 Normally Open contact (.3 - .4)
  int startReading = digitalRead(PIN_BTN_START);
  if (startReading != lastStartBtnReading) lastStartDebounceTime = now;
  if ((now - lastStartDebounceTime) > DEBOUNCE_DELAY_MS && startReading != startBtnState) {
    startBtnState = startReading;
    if (startBtnState == LOW) {
      Serial.println(F("[Button] 🟢 GREEN Push Button Pressed!"));
      startGeneratorSequence("Manual Green Button");
    }
  }
  lastStartBtnReading = startReading;

  // Red Push Button (STOP) - XB2 Normally Closed contact (.1 - .2, Highest Priority Emergency Cutoff)
  int stopReading = digitalRead(PIN_BTN_STOP);
  if (stopReading != lastStopBtnReading) lastStopDebounceTime = now;
  if ((now - lastStopDebounceTime) > DEBOUNCE_DELAY_MS && stopReading != stopBtnState) {
    stopBtnState = stopReading;
    bool redPressed = RED_BTN_NORMALLY_CLOSED ? (stopBtnState == HIGH) : (stopBtnState == LOW);
    if (redPressed) {
      Serial.println(F("[Button] 🔴 RED Push Button Pressed (Emergency Shutoff)!"));
      stopGeneratorSequence("Manual Red Button");
    }
  }
  lastStopBtnReading = stopReading;
}

// ==============================================================================
// 7. SEQUENCE TIMER & 6-HOUR COOLDOWN
// ==============================================================================
void handleSequenceTimer() {
  unsigned long now = millis();

  if (machineState == GEN_STAGE1_WAITING_R2 || machineState == GEN_STAGE2_FULL_RUNNING) {
    totalSessionSecs = (now - lastStateChangeMs) / 1000UL;
  }

  // 1. Relay 2 2-Minute Delay Countdown
  if (machineState == GEN_STAGE1_WAITING_R2) {
    if (now - lastLedBlinkMs >= 250UL) {
      lastLedBlinkMs = now;
      ledBlinkToggle = !ledBlinkToggle;
      digitalWrite(LED_STATUS, ledBlinkToggle ? HIGH : LOW);
    }
    if (now - stage1StartTime >= RELAY_2_DELAY_MS) {
      machineState = GEN_STAGE2_FULL_RUNNING;
      relay2State  = true;
      writeRelayPin(RELAY_PIN_2, true);
      digitalWrite(LED_STATUS, HIGH);
      pushPending = true;

      Serial.println(F("\n============================================================"));
      Serial.println(F("[Relay 2] ⚡ 2 MINUTES ELAPSED -> SECONDARY AERATOR TURNED ON!"));
      Serial.println(F("[System]  🎉 BOTH RELAY 1 & RELAY 2 RUNNING SIMULTANEOUSLY!"));
      Serial.println(F("============================================================\n"));
    }
  }

  // 2. 6-Hour Continuous Run Cooldown Limit
  if (machineState == GEN_STAGE2_FULL_RUNNING) {
    if (cooldownEnabled && (now - continuousRunStartMs >= COOLDOWN_RUN_LIMIT_MS)) {
      Serial.println(F("\n[Cooldown] ❄️ 6 HOURS CONTINUOUS RUN REACHED -> resting 30 minutes"));
      machineState    = GEN_COOLDOWN_REST;
      cooldownStartMs = now;
      generatorState  = false;
      relay2State     = false;
      writeRelayPin(RELAY_PIN, false);
      writeRelayPin(RELAY_PIN_2, false);
      if (LED_MACHINE >= 0) digitalWrite(LED_MACHINE, LOW);
      digitalWrite(LED_STATUS, LOW);
      pushPending = true;
    }
  }

  // 3. 30-Minute Rest Complete Auto-Resume
  if (machineState == GEN_COOLDOWN_REST) {
    if (now - lastLedBlinkMs >= 1000UL) {
      lastLedBlinkMs = now;
      ledBlinkToggle = !ledBlinkToggle;
      digitalWrite(LED_STATUS, ledBlinkToggle ? HIGH : LOW);
    }
    if (now - cooldownStartMs >= COOLDOWN_REST_MS) {
      Serial.println(F("\n[Cooldown] ⚡ REST COMPLETE -> AUTO-RESUMING"));
      machineState = GEN_OFF;
      startGeneratorSequence("Auto 30-Min Cooldown Completed");
    }
  }
}

// ==============================================================================
// 8. CLOUD ENGINE (Runs on Core 0 in FreeRTOS Task)
// ==============================================================================
String isoNow() {
  time_t t = time(nullptr);
  if (t < 1700000000) return "";
  struct tm ti;
  gmtime_r(&t, &ti);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &ti);
  return String(buf);
}

String getStringField(const String& json, const char* field) {
  String key = String("\"") + field + "\":";
  int i = json.indexOf(key);
  if (i < 0) return "";
  int sv = json.indexOf("\"stringValue\"", i);
  if (sv < 0) return "";
  int colon = json.indexOf(':', sv);
  if (colon < 0) return "";
  int q1 = json.indexOf('"', colon + 1);
  if (q1 < 0) return "";
  int q2 = json.indexOf('"', q1 + 1);
  if (q2 < 0) return "";
  return json.substring(q1 + 1, q2);
}

// Push device status to Cloudflare Bridge (Fast 50ms) with direct Firestore fallback
bool pushStatus() {
  const char* st1 = generatorState ? "ON" : "OFF";
  const char* st2 = relay2State ? "ON" : "OFF";
  unsigned long secs = (machineState == GEN_STAGE1_WAITING_R2 || machineState == GEN_STAGE2_FULL_RUNNING)
                         ? (unsigned long)totalSessionSecs : 0;

  // METHOD 1: Fast Cloudflare Bridge HTTP POST (50ms)
  {
    HTTPClient http;
    if (http.begin(CLOUD_URL)) {
      http.addHeader("Content-Type", "application/json");
      http.setTimeout(2500);
      String payload = "{\"deviceId\":\"" + String(DEVICE_ID) +
                       "\",\"status\":\"" + String(st1) +
                       "\",\"status2\":\"" + String(st2) +
                       "\",\"isButtonEvent\":true" +
                       ",\"manualButtonTrigger\":\"" + String(generatorState ? "START" : "STOP") +
                       "\",\"currentSessionSeconds\":" + String(secs) +
                       ",\"currentSessionMinutes\":" + String(secs / 60) + "}";
      int code = http.POST(payload);
      http.end();
      if (code == 200) {
        Serial.printf("[Cloud] 📡 Push [%s] status=%s status2=%s -> HTTP 200\n", DEVICE_ID, st1, st2);
        return true;
      }
    }
  }

  // METHOD 2: Direct Google Firestore REST Fallback
  {
    String iso = isoNow();
    String url = "https://firestore.googleapis.com/v1/projects/oxynity-smart/databases/(default)/documents/devices/";
    url += DEVICE_ID;
    url += "?updateMask.fieldPaths=status&updateMask.fieldPaths=status2&updateMask.fieldPaths=isOnline";
    url += "&updateMask.fieldPaths=currentSessionSeconds&updateMask.fieldPaths=currentSessionMinutes";
    if (iso.length()) url += "&updateMask.fieldPaths=lastSeen&updateMask.fieldPaths=updatedAt";
    url += "&key=";
    url += FIREBASE_KEY;

    String payload = "{\"fields\":{";
    payload += "\"status\":{\"stringValue\":\"" + String(st1) + "\"},";
    payload += "\"status2\":{\"stringValue\":\"" + String(st2) + "\"},";
    payload += "\"isOnline\":{\"booleanValue\":true},";
    payload += "\"currentSessionSeconds\":{\"integerValue\":\"" + String(secs) + "\"},";
    payload += "\"currentSessionMinutes\":{\"integerValue\":\"" + String(secs / 60) + "\"}";
    if (iso.length()) {
      payload += ",\"lastSeen\":{\"stringValue\":\"" + iso + "\"}";
      payload += ",\"updatedAt\":{\"stringValue\":\"" + iso + "\"}";
    }
    payload += "}}";

    HTTPClient https;
    bool ok = false;
    if (https.begin(secClient, url)) {
      https.addHeader("Content-Type", "application/json");
      https.setTimeout(3500);
      int code = https.PATCH(payload);
      ok = (code == 200);
      Serial.printf("[Cloud REST] 📡 Push [%s] status=%s status2=%s -> HTTP %d\n", DEVICE_ID, st1, st2, code);
      https.end();
    }
    return ok;
  }
}

// Fetch App Switch Status: Fast Cloudflare bridge with instant ON/OFF detection
bool fetchAppStatus(String& appStatus) {
  // METHOD 1: Fast Cloudflare Bridge (Lightweight HTTP, 50ms)
  {
    HTTPClient http;
    if (http.begin(CLOUD_URL)) {
      http.addHeader("Content-Type", "application/json");
      http.setTimeout(2500);
      String payload = "{\"deviceId\":\"" + String(DEVICE_ID) + "\"}";
      int code = http.POST(payload);
      if (code == 200) {
        String reply = http.getString();
        reply.replace(" ", "");
        reply.replace("\n", "");
        if (reply.indexOf("\"r1\":\"ON\"") != -1) {
          appStatus = "ON";
          http.end();
          return true;
        } else if (reply.indexOf("\"r1\":\"OFF\"") != -1) {
          appStatus = "OFF";
          http.end();
          return true;
        }
      }
      http.end();
    }
  }

  // METHOD 2: Direct Google Firestore REST Fallback
  {
    String url = "https://firestore.googleapis.com/v1/projects/oxynity-smart/databases/(default)/documents/devices/";
    url += DEVICE_ID;
    url += "?mask.fieldPaths=status&key=";
    url += FIREBASE_KEY;

    HTTPClient https;
    if (https.begin(secClient, url)) {
      https.setTimeout(3500);
      int code = https.GET();
      if (code == 200) {
        String s = getStringField(https.getString(), "status");
        https.end();
        if (s == "ON" || s == "OFF") {
          appStatus = s;
          return true;
        }
      }
      https.end();
    }
  }

  return false;
}

void pollCommands() {
  String appStatus;
  if (!fetchAppStatus(appStatus)) return;

  static String lastLogged = "";
  static unsigned long lastLogMs = 0;
  if (appStatus != lastLogged || millis() - lastLogMs >= 6000UL) {
    lastLogged = appStatus;
    lastLogMs  = millis();
    Serial.printf("[Cloud Poll] 📡 [Device: %s] App Switch: %s | Hardware Relay 1: %s | Wi-Fi: %d%%\n",
                  DEVICE_ID, appStatus.c_str(), generatorState ? "ON" : "OFF", (int)wifiSignalPercent);
  }

  // Accept remote app state only if manual push button wasn't pressed in last 4 seconds
  if (millis() - lastManualPressMs > 4000UL) {
    GeneratorState st = machineState;
    if (appStatus == "ON" && st == GEN_OFF) {
      Serial.printf("[Cloud Command] 📲 Received START command for %s!\n", DEVICE_ID);
      pendingCmd = 1;
    } else if (appStatus == "OFF" &&
               (st == GEN_STAGE1_WAITING_R2 || st == GEN_STAGE2_FULL_RUNNING)) {
      Serial.printf("[Cloud Command] 🛑 Received STOP command for %s!\n", DEVICE_ID);
      pendingCmd = 2;
    }
  }
}

// Background Telemetry Heartbeat (Updates lastSeen, signal, runtime WITHOUT overwriting status)
void sendHeartbeat() {
  wifiSignalPercent = constrain(map(WiFi.RSSI(), -100, -40, 0, 100), 0, 100);
  bool running = (machineState == GEN_STAGE1_WAITING_R2 || machineState == GEN_STAGE2_FULL_RUNNING);
  unsigned long secs = running ? (unsigned long)totalSessionSecs : 0;

  // METHOD 1: Fast Cloudflare Bridge
  {
    HTTPClient http;
    if (http.begin(CLOUD_URL)) {
      http.addHeader("Content-Type", "application/json");
      http.setTimeout(2500);
      String payload = "{\"deviceId\":\"" + String(DEVICE_ID) +
                       "\",\"gprsSignal\":" + String(wifiSignalPercent) +
                       ",\"isOnline\":true" +
                       ",\"currentSessionSeconds\":" + String(secs) +
                       ",\"currentSessionMinutes\":" + String(secs / 60) + "}";
      int code = http.POST(payload);
      http.end();
      if (code == 200) return;
    }
  }

  // METHOD 2: Direct Google Firestore REST Fallback
  {
    String iso = isoNow();
    String url = "https://firestore.googleapis.com/v1/projects/oxynity-smart/databases/(default)/documents/devices/";
    url += DEVICE_ID;
    url += "?updateMask.fieldPaths=isOnline&updateMask.fieldPaths=gprsSignal";
    if (running) url += "&updateMask.fieldPaths=currentSessionSeconds&updateMask.fieldPaths=currentSessionMinutes";
    if (iso.length()) url += "&updateMask.fieldPaths=lastSeen&updateMask.fieldPaths=updatedAt";
    url += "&key=";
    url += FIREBASE_KEY;

    String payload = "{\"fields\":{";
    payload += "\"isOnline\":{\"booleanValue\":true},";
    payload += "\"gprsSignal\":{\"integerValue\":\"" + String((int)wifiSignalPercent) + "\"}";
    if (running) {
      payload += ",\"currentSessionSeconds\":{\"integerValue\":\"" + String(secs) + "\"}";
      payload += ",\"currentSessionMinutes\":{\"integerValue\":\"" + String(secs / 60) + "\"}";
    }
    if (iso.length()) {
      payload += ",\"lastSeen\":{\"stringValue\":\"" + iso + "\"}";
      payload += ",\"updatedAt\":{\"stringValue\":\"" + iso + "\"}";
    }
    payload += "}}";

    HTTPClient https;
    if (https.begin(secClient, url)) {
      https.addHeader("Content-Type", "application/json");
      https.setTimeout(3500);
      https.PATCH(payload);
      https.end();
    }
  }
}

// FreeRTOS Dedicated Task on Core 0
void cloudTask(void* pv) {
  unsigned long lastPoll = 0, lastBeat = 0;
  for (;;) {
    if (ENABLE_WIFI && WiFi.status() == WL_CONNECTED) {
      unsigned long now = millis();
      if (pushPending) {
        pushPending = false;
        if (!pushStatus()) pushPending = true; // Retry on failure
        lastPoll = millis();
      } else {
        if (now - lastPoll >= SYNC_INTERVAL_MS) {
          lastPoll = now;
          pollCommands();
        }
        if (millis() - lastBeat >= HEARTBEAT_INTERVAL_MS) {
          lastBeat = millis();
          sendHeartbeat();
        }
      }
    }
    vTaskDelay(50 / portTICK_PERIOD_MS);
  }
}

// ==============================================================================
// 9. WI-FI WATCHER (Non-blocking background connection)
// ==============================================================================
void connectWiFi() {
  if (!ENABLE_WIFI) return;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[Wi-Fi] Connecting to '%s' (running in background)...\n", WIFI_SSID);
}

void printWifiHelp() {
  Serial.println(F("\n============================================================"));
  Serial.printf( "[Wi-Fi] ❌ NOT CONNECTED to '%s' (Status: %d)\n", WIFI_SSID, WiFi.status());
  Serial.println(F("  1. ESP32 supports 2.4 GHz ONLY (no 5 GHz)."));
  Serial.println(F("     iPhone: Settings > Personal Hotspot > turn ON 'Maximize Compatibility'."));
  Serial.println(F("  2. Check the Wi-Fi password in the code."));
  Serial.println(F("  Buttons and relays keep working offline. Still retrying..."));
  Serial.println(F("============================================================\n"));
}

void wifiWatcher() {
  static unsigned long lastCheck = 0, lastReconnect = 0, bootMs = millis();
  static bool wasConnected = false, helpShown = false;
  unsigned long now = millis();
  if (now - lastCheck < 1000UL) return;
  lastCheck = now;

  bool connected = (WiFi.status() == WL_CONNECTED);
  if (connected && !wasConnected) {
    Serial.println(F("\n============================================================"));
    Serial.printf("[Wi-Fi] ✅ CONNECTED! IP: %s | RSSI: %d dBm | Device: %s\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI(), DEVICE_ID);
    Serial.println(F("============================================================\n"));
    configTime(19800, 0, "pool.ntp.org", "time.google.com"); // IST (GMT+5:30)
    helpShown = false;
  } else if (!connected && wasConnected) {
    Serial.println(F("[Wi-Fi] ⚠️ Connection lost. Auto-reconnecting..."));
  }
  wasConnected = connected;

  if (!connected) {
    if (!helpShown && now - bootMs > 20000UL) { helpShown = true; printWifiHelp(); }
    if (now - lastReconnect >= 10000UL) {
      lastReconnect = now;
      WiFi.reconnect();
    }
  }
}

// ==============================================================================
// 10. SERIAL COMMAND CONSOLE
// ==============================================================================
void handleSerialCommands() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  cmd.toUpperCase();
  if (cmd == "START" || cmd == "ON") {
    startGeneratorSequence("Serial Console");
  } else if (cmd == "STOP" || cmd == "OFF") {
    stopGeneratorSequence("Serial Console");
  } else if (cmd == "STATUS") {
    Serial.printf("[Status] State: %d | R1: %s | R2: %s | Runtime: %lu s | WiFi: %s | Device: %s\n",
                  (int)machineState, generatorState ? "ON" : "OFF",
                  relay2State ? "ON" : "OFF", (unsigned long)totalSessionSecs,
                  WiFi.status() == WL_CONNECTED ? "OK" : "DOWN", DEVICE_ID);
  }
}

// ==============================================================================
// 11. SETUP & MAIN LOOP (Runs on Core 1)
// ==============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println(F("\n============================================================"));
  Serial.println(F("  OXYNITY SMART - STANDALONE POND FIRMWARE v3.0              "));
  Serial.println(F("============================================================"));

  pinMode(RELAY_PIN,   OUTPUT);
  pinMode(RELAY_PIN_2, OUTPUT);
  pinMode(LED_STATUS,  OUTPUT);
  if (LED_MACHINE >= 0) pinMode(LED_MACHINE, OUTPUT);
  pinMode(PIN_BTN_START, INPUT_PULLUP);
  pinMode(PIN_BTN_STOP,  INPUT_PULLUP);

  writeRelayPin(RELAY_PIN,   false);
  writeRelayPin(RELAY_PIN_2, false);
  if (LED_MACHINE >= 0) digitalWrite(LED_MACHINE, LOW);
  digitalWrite(LED_STATUS, LOW);

  lastStartBtnReading = startBtnState = digitalRead(PIN_BTN_START);
  lastStopBtnReading  = stopBtnState  = digitalRead(PIN_BTN_STOP);

  Serial.printf("  Configured Device ID : %s\n", DEVICE_ID);
  Serial.printf("  Relay 1: GPIO %d | Relay 2: GPIO %d\n", RELAY_PIN, RELAY_PIN_2);
  Serial.printf("  Green START: GPIO %d | Red STOP: GPIO %d\n\n", PIN_BTN_START, PIN_BTN_STOP);

  if (ENABLE_WIFI) {
    secClient.setInsecure();
    connectWiFi();
    // Launch cloud sync on Core 0 with 16KB stack
    xTaskCreatePinnedToCore(cloudTask, "cloud", 16384, NULL, 1, NULL, 0);
  }
}

void loop() {
  // 1. Instant check for manual push buttons on Core 1 (0ms delay)
  handleManualButtons();

  // 2. Non-blocking 2-minute delay timer for Relay 2
  handleSequenceTimer();

  // 3. Serial command console
  handleSerialCommands();

  // 4. Apply cloud commands on Core 1 (same core controlling relays)
  int cmd = pendingCmd;
  if (cmd != 0) {
    pendingCmd = 0;
    if (cmd == 1) startGeneratorSequence("Mobile App Command");
    else if (cmd == 2) stopGeneratorSequence("Mobile App Command");
  }

  // 5. Background Wi-Fi monitor
  wifiWatcher();

  delay(5);
}
