/**
 * ==============================================================================
 * Oxynity Smart - 100% PURE CELLULAR GPRS FIRMWARE (SIM900A ONLY - NO EXTRA GPS)
 * ==============================================================================
 * 
 * Hardware Setup:
 *  - ESP32 30-Pin NodeMCU / DevKit V1
 *  - SIM900A GSM/GPRS Cellular Modem ONLY (Vi / Idea SIM with 2G GPRS data pack)
 *  - Pins used:
 *      SIM900A TXD -> ESP32 GPIO 19 (Hardware UART2 RX)
 *      SIM900A RXD -> ESP32 GPIO 18 (Hardware UART2 TX)
 *      SIM900A GND -> ESP32 Common GND
 *      SIM900A VCC -> External 5V 2A Power Supply (Do NOT power modem from ESP32!)
 *      Relay 1 IN  -> ESP32 GPIO 25 (Bubble Generator)
 *      Relay 2 IN  -> ESP32 GPIO 26 (Secondary Aerator / Pump)
 *      DO Sensor   -> ESP32 GPIO 34 (Analog A0)
 *      LED GPRS    -> ESP32 GPIO 2  (Blue Onboard LED)
 *      LED Machine -> ESP32 GPIO 27 (Green LED)
 * 
 * Real-Time Moving Location (How it works with ONLY SIM900A):
 *  - As you travel anywhere in India or the world, the SIM900A continuously switches
 *    from cellular tower to cellular tower.
 *  - The ESP32 reads the physical tower's Location Area Code (LAC) and Cell ID (CID)
 *    and uploads them over GPRS to your Cloudflare Worker.
 *  - The Cloudflare Worker resolves the exact tower coordinates in real-time via
 *    the BeaconDB Cell Geolocation API and saves them to Firestore.
 *  - Your phone app map tracks your live moving location dynamically!
 * ==============================================================================
 */

#include <HardwareSerial.h>
#include <Preferences.h>

// ==============================================================================
// 1. PIN DEFINITIONS (SIM900A ONLY ON GPIO 18 & 19)
// ==============================================================================
#define SIM_RX_PIN          19    // ESP32 RX <- SIM900A TXD
#define SIM_TX_PIN          18    // ESP32 TX -> SIM900A RXD

const int RELAY_PIN         = 27; // Relay 1 - Bubble Generator / Main Aerator (GPIO 27)
const int RELAY_PIN_2       = 26; // Relay 2 - Secondary Pump / Aerator (GPIO 26)
const int PIN_BTN_START     = 32; // Green Push Button (START) -> Connects to GND (INPUT_PULLUP)
const int PIN_BTN_STOP      = 33; // Red Push Button (STOP)   -> Connects to GND (INPUT_PULLUP)
const int DO_SENSOR_PIN     = 34; // Analog DO Sensor (ADC1 GPIO 34)
const int LED_GPRS          =  2; // Blue Onboard LED (Solid ON when GPRS active)
const int LED_MACHINE       = 25; // Optional Status LED (GPIO 25, or set to -1 if unused)
const int SIM_PWRKEY_PIN    = -1; // Optional: Connect to SIM900A PWRKEY pin for auto-boot (e.g. GPIO 4, or -1 for manual button)

// Set true for standard Active-LOW 5V relay modules
#define RELAY_ACTIVE_LOW    true

// XB2 Industrial Push Button Polarity (from photo)
#define GREEN_BTN_NORMALLY_OPEN   true // Green XB2 NO contact (.3 - .4)
#define RED_BTN_NORMALLY_CLOSED   true // Red XB2 NC contact (.1 - .2)

// Sequential 2-Minute Delay (One-Button Start)
const unsigned long RELAY_2_DELAY_MS  = 2UL * 60UL * 1000UL; // 2 minutes (120,000 ms)
const unsigned long DEBOUNCE_DELAY_MS = 50;

bool          relay2Waiting        = false;
unsigned long relay1StartTime      = 0;

int lastStartBtnReading            = HIGH;
int startBtnState                  = HIGH;
unsigned long lastStartDebounceTime = 0;

int lastStopBtnReading             = HIGH;
int stopBtnState                   = HIGH;
unsigned long lastStopDebounceTime  = 0;

// ==============================================================================
// 2. CELLULAR APN & CLOUD BRIDGE CONFIGURATION
// ==============================================================================
// Vi / Idea APN:
#define SIM_APN             "portalnmms"

// Deployed Cloudflare Worker HTTP Bridge:
#define PROXY_URL           "http://oxynity-pond-bridge.jhonsonraju2003.workers.dev"

// Device ID matching the Oxynity App ("OXY-ESP32-002" for Jhonny, "OXY-ESP32-001" for Raju)
#define DEVICE_ID           "OXY-ESP32-002"

// Timing Intervals
const unsigned long CYCLE_INTERVAL_MS    =  6000; // Heartbeat & Telemetry every 6s
const unsigned long LOCATION_INTERVAL_MS = 30000; // Query GPRS cell coordinates every 30s

// ==============================================================================
// 3. BASELINE COORDINATES (USED AS FALLBACK UNTIL CELL TOWER LOCKS)
// ==============================================================================
const float DEFAULT_LATITUDE   = 16.5787f;
const float DEFAULT_LONGITUDE  = 82.0061f;
const char* DEFAULT_LOC_LABEL  = "SIM900A GPRS Cellular Station";

// ==============================================================================
// 4. RUNTIME STATE
// ==============================================================================
HardwareSerial simSerial(2); // ESP32 Hardware UART 2

float         currentDoLevel       = 7.5f;
bool          doSensorConnected    = true;
bool          generatorState       = false; // Relay 1
bool          relay2State          = false; // Relay 2
int           gprsSignalPercent    = 0;     // 0 - 100%
bool          gprsConnected        = false;
int           failedSyncCount      = 0;

float         currentLatitude      = DEFAULT_LATITUDE;
float         currentLongitude     = DEFAULT_LONGITUDE;
String        locationLabel        = DEFAULT_LOC_LABEL;
bool          gprsLocationFixed    = false;
String        cellLac              = "";
String        cellId               = "";
String        carrierMcc           = "404";
String        carrierMnc           = "4";
bool          isMoving             = false;
String        lastKnownTower       = "";
String        pendingButtonTrigger = ""; // Set to "START" or "STOP" on physical button press

unsigned long totalSessionSecs     = 0;
unsigned long lastStateChangeMs    = 0;
unsigned long lastCycleMs          = 0;
unsigned long lastLocationMs       = 0;

// ==============================================================================
// 5. RELAY & SENSOR CONTROL
// ==============================================================================
void setRelay1(bool turnOn) {
  generatorState = turnOn;
  bool pinVal = turnOn ? !RELAY_ACTIVE_LOW : RELAY_ACTIVE_LOW;
  digitalWrite(RELAY_PIN, pinVal ? HIGH : LOW);
  if (LED_MACHINE >= 0) {
    digitalWrite(LED_MACHINE, turnOn ? HIGH : LOW);
  }
  if (turnOn) {
    totalSessionSecs = 0;
    lastStateChangeMs = millis();
  }
}

void setRelay2(bool turnOn) {
  relay2State = turnOn;
  bool pinVal = turnOn ? !RELAY_ACTIVE_LOW : RELAY_ACTIVE_LOW;
  digitalWrite(RELAY_PIN_2, pinVal ? HIGH : LOW);
}

// 1-Button 4-Minute Sequential Start
void startGeneratorSequence(const char* triggerSource) {
  if (generatorState) return;

  Serial.println(F("\n============================================================"));
  Serial.printf("[Sequence] 🚀 GENERATOR START TRIGGERED by %s\n", triggerSource);
  Serial.println(F("============================================================"));

  setRelay1(true);
  setRelay2(false);
  relay2Waiting    = true;
  relay1StartTime  = millis();

  Serial.println(F("[Relay 1] ⚡ BUBBLE GENERATOR -> TURNED ON [IMMEDIATE]"));
  Serial.printf("[Relay 2] ⏳ Timer active: Secondary Aerator will start in %lu seconds (2 mins)...\n\n",
                RELAY_2_DELAY_MS / 1000UL);
}

void stopGeneratorSequence(const char* triggerSource) {
  Serial.println(F("\n------------------------------------------------------------"));
  Serial.printf("[Sequence] 🛑 GENERATOR STOP TRIGGERED by %s\n", triggerSource);
  Serial.println(F("------------------------------------------------------------"));

  setRelay1(false);
  setRelay2(false);
  relay2Waiting   = false;
  relay1StartTime = 0;

  Serial.println(F("[Relay 1] 🛑 TURNED OFF"));
  Serial.println(F("[Relay 2] 🛑 TURNED OFF"));
  Serial.println(F("[System]  ALL RELAYS SAFELY STOPPED.\n"));
}

void handleManualButtons() {
  unsigned long now = millis();

  // Green Button (START)
  int startReading = digitalRead(PIN_BTN_START);
  if (startReading != lastStartBtnReading) {
    lastStartDebounceTime = now;
  }
  if ((now - lastStartDebounceTime) > DEBOUNCE_DELAY_MS) {
    if (startReading != startBtnState) {
      startBtnState = startReading;
      if (startBtnState == LOW) {
        Serial.println(F("[Button] 🟢 GREEN Push Button Pressed!"));
        pendingButtonTrigger = "START";
        startGeneratorSequence("Manual Green Button");
      }
    }
  }
  lastStartBtnReading = startReading;

  // Red Button (STOP) - Always Highest Priority (NC Contact Block)
  int stopReading = digitalRead(PIN_BTN_STOP);
  if (stopReading != lastStopBtnReading) {
    lastStopDebounceTime = now;
  }
  if ((now - lastStopDebounceTime) > DEBOUNCE_DELAY_MS) {
    if (stopReading != stopBtnState) {
      stopBtnState = stopReading;
      bool isRedPressed = RED_BTN_NORMALLY_CLOSED ? (stopBtnState == HIGH) : (stopBtnState == LOW);
      if (isRedPressed) {
        Serial.println(F("[Button] 🔴 RED Push Button Pressed!"));
        pendingButtonTrigger = "STOP";
        stopGeneratorSequence("Manual Red Button");
      }
    }
  }
  lastStopBtnReading = stopReading;
}

void handleSequenceTimer() {
  if (relay2Waiting) {
    if (millis() - relay1StartTime >= RELAY_2_DELAY_MS) {
      relay2Waiting = false;
      setRelay2(true);
      Serial.println(F("\n============================================================"));
      Serial.println(F("[Relay 2] ⚡ 2 MINUTES ELAPSED -> SECONDARY AERATOR TURNED ON!"));
      Serial.println(F("[System]  🎉 BOTH RELAY 1 & RELAY 2 RUNNING SIMULTANEOUSLY!"));
      Serial.println(F("============================================================\n"));
    }
  }
}

// ==============================================================================
// DO SENSOR CALIBRATION PARAMETERS (Calibrated with Handheld Digital DO Meter)
// ==============================================================================
// Live test data from your digital DO meter:
//   - 556.18 mV @ 5.50 mg/L
//   - 562.00 mV @ 5.80 mg/L
//   - 566.00 mV @ 6.00 mg/L
// Computed true baseline & sensitivity:
const float DEFAULT_DO_ZERO_MV   = 450.00f;   // Hardware baseline zero offset in mV
const float DEFAULT_DO_CAL_MV    = 562.50f;   // Span voltage at 5.80 mg/L
const float DEFAULT_DO_REF_MGL   = 5.80f;     // Reference DO value in mg/L
const float DEFAULT_DO_SLOPE_K   = 0.05155f;  // True sensitivity (mg/L per mV)

float doZeroMv                   = DEFAULT_DO_ZERO_MV;
float doCalMv                    = DEFAULT_DO_CAL_MV;
float doRefMgL                   = DEFAULT_DO_REF_MGL;
float doSlopeK                   = DEFAULT_DO_SLOPE_K;
bool  doIsCalibrated             = true;

void loadDoCalibration() {
  Preferences prefs;
  prefs.begin("oxynity_do", true); // Read-only mode
  float storedZero  = prefs.getFloat("zero_mv", -1.0f);
  float storedSlope = prefs.getFloat("slope_k", -1.0f);

  if (storedZero >= 100.0f && storedSlope > 0.01f) {
    // Valid 2-point calibration in NVS
    doZeroMv       = storedZero;
    doCalMv        = prefs.getFloat("cal_mv", DEFAULT_DO_CAL_MV);
    doRefMgL       = prefs.getFloat("ref_do", DEFAULT_DO_REF_MGL);
    doSlopeK       = storedSlope;
    doIsCalibrated = true;
  } else {
    // Verified constants derived from your digital DO meter test
    doZeroMv       = DEFAULT_DO_ZERO_MV;
    doCalMv        = DEFAULT_DO_CAL_MV;
    doRefMgL       = DEFAULT_DO_REF_MGL;
    doSlopeK       = DEFAULT_DO_SLOPE_K;
    doIsCalibrated = true;
  }
  prefs.end();

  Serial.println("\n--------------------------------------------------------------");
  Serial.println("[DO Calibration] ✅ Active Parameters (Calibrated with Digital Meter):");
  Serial.printf("  • Zero Voltage   : %.2f mV (at 0.00 mg/L)\n", doZeroMv);
  Serial.printf("  • Span Voltage   : %.2f mV\n", doCalMv);
  Serial.printf("  • Reference DO   : %.2f mg/L\n", doRefMgL);
  Serial.printf("  • Sensitivity K  : %.5f mg/L per mV\n", doSlopeK);
  Serial.println("--------------------------------------------------------------\n");
}

void readDoSensor() {
  // 30-sample oversampling with trimmed-mean filter to eliminate ESP32 ADC noise
  const int SAMPLES = 30;
  int rawList[SAMPLES];
  for (int i = 0; i < SAMPLES; i++) {
    rawList[i] = analogRead(DO_SENSOR_PIN);
    delay(4);
  }

  // Insertion sort to find median and remove extreme electrical spikes
  for (int i = 1; i < SAMPLES; i++) {
    int key = rawList[i];
    int j = i - 1;
    while (j >= 0 && rawList[j] > key) {
      rawList[j + 1] = rawList[j];
      j--;
    }
    rawList[j + 1] = key;
  }

  int medianRaw = rawList[SAMPLES / 2];

  // Discard lowest 6 and highest 6 outliers, average center 18 readings
  long sum = 0;
  int count = 0;
  for (int i = 6; i < SAMPLES - 6; i++) {
    sum += rawList[i];
    count++;
  }
  float avgRaw = (float)sum / (float)count;

  // Check if sensor is connected (floating pin is typically < 40 raw)
  if (medianRaw > 40) {
    float voltageMv = (avgRaw / 4095.0f) * 3300.0f;

    // Linear Calibration Formula based on Digital DO Meter readings:
    // DO (mg/L) = slopeK * (V_measured - V_zero)
    float calculated = 0.0f;
    if (voltageMv > doZeroMv) {
      calculated = doSlopeK * (voltageMv - doZeroMv);
    }
    currentDoLevel = constrain(calculated, 0.0f, 25.0f);
    doSensorConnected = true;

    Serial.printf("[Sensors] DO: %.2f mg/L  (Voltage: %.1f mV | Raw ADC: %d | Cal: %s)\n",
                  currentDoLevel, voltageMv, medianRaw, doIsCalibrated ? "Calibrated" : "Default");
  } else {
    currentDoLevel = -1.0f;
    doSensorConnected = false;
    Serial.println("[Sensors] DO Probe Disconnected (Pin 34 floating)");
  }
}

// ==============================================================================
// 6. SIM900A AT COMMAND HELPERS
// ==============================================================================
String sendATCommand(const String& cmd, unsigned long timeoutMs = 2000, bool debug = false) {
  while (simSerial.available()) simSerial.read();
  delay(10);
  simSerial.println(cmd);
  if (debug) Serial.printf("[SIM900A TX] %s\n", cmd.c_str());

  String response = "";
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    while (simSerial.available()) {
      char c = (char)simSerial.read();
      response += c;
    }
    if (response.indexOf("OK") != -1 || response.indexOf("ERROR") != -1) break;
    delay(10);
  }
  if (debug && response.length() > 0) Serial.printf("[SIM900A RX] %s\n", response.c_str());
  return response;
}

String waitForHttpAction(unsigned long timeoutMs = 12000) {
  String response = "";
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    while (simSerial.available()) {
      char c = (char)simSerial.read();
      response += c;
    }
    if (response.indexOf("+HTTPACTION:") != -1) {
      delay(200);
      while (simSerial.available()) {
        response += (char)simSerial.read();
      }
      break;
    }
    delay(20);
  }
  return response;
}

void updateSignalQuality() {
  String resp = sendATCommand("AT+CSQ", 1500);
  int idx = resp.indexOf("+CSQ:");
  if (idx != -1) {
    int comma = resp.indexOf(",", idx);
    if (comma != -1) {
      int rssi = resp.substring(idx + 5, comma).toInt();
      gprsSignalPercent = (rssi == 99 || rssi < 0) ? 0 : constrain(map(rssi, 0, 31, 0, 100), 0, 100);
      Serial.printf("[SIM900A] Cellular Signal: CSQ %d (%d%%)\n", rssi, gprsSignalPercent);
    }
  }
}

void detectCarrierMccMnc() {
  String imsiResp = sendATCommand("AT+CIMI", 2000);
  imsiResp.trim();
  int idx = -1;
  for (int i = 0; i < imsiResp.length(); i++) {
    if (isDigit(imsiResp[i])) {
      idx = i;
      break;
    }
  }
  if (idx != -1 && imsiResp.length() >= idx + 5) {
    carrierMcc = imsiResp.substring(idx, idx + 3);
    carrierMnc = imsiResp.substring(idx + 3, idx + 5);
    Serial.printf("[SIM900A] 📶 Carrier Auto-Detected -> MCC: %s, MNC: %s\n", carrierMcc.c_str(), carrierMnc.c_str());
  }
}

// ==============================================================================
// 7. REAL-TIME CELL TOWER SCANNER (TRACKS LIVE TRAVEL MOVEMENT)
// ==============================================================================
void updateServingCellTower() {
  // Query serving cell tower (AT+CREG=2 enables LAC and Cell ID reporting)
  sendATCommand("AT+CREG=2", 800);
  String cregResp = sendATCommand("AT+CREG?", 1500);
  int idx = cregResp.indexOf("+CREG:");
  if (idx != -1) {
    int q1 = cregResp.indexOf('"', idx);
    if (q1 != -1) {
      int q2 = cregResp.indexOf('"', q1 + 1);
      int q3 = (q2 != -1) ? cregResp.indexOf('"', q2 + 1) : -1;
      int q4 = (q3 != -1) ? cregResp.indexOf('"', q3 + 1) : -1;
      if (q1 != -1 && q2 != -1 && q3 != -1 && q4 != -1) {
        String newLac = cregResp.substring(q1 + 1, q2);
        String newCid = cregResp.substring(q3 + 1, q4);
        newLac.trim();
        newCid.trim();
        if (newLac.length() > 0 && newCid.length() > 0) {
          String towerKey = newLac + ":" + newCid;
          if (lastKnownTower.length() > 0 && towerKey != lastKnownTower) {
            Serial.printf("[SIM900A] 🚗 TOWER HANDOVER! SIM900A Moved: %s -> %s\n", lastKnownTower.c_str(), towerKey.c_str());
            isMoving = true;
          }
          lastKnownTower = towerKey;
          cellLac = newLac;
          cellId  = newCid;
          Serial.printf("[SIM900A] 📡 Serving Cell Tower -> LAC: %s, CellID: %s\n", cellLac.c_str(), cellId.c_str());
        }
      }
    }
  }

  // Query SIMCOM CIPGSMLOC (LBS Server Triangulation) when moving or on timer
  unsigned long now = millis();
  if (isMoving || (now - lastLocationMs >= LOCATION_INTERVAL_MS)) {
    lastLocationMs = now;
    String resp = sendATCommand("AT+CIPGSMLOC=1,1", 5000, false);
    int cIdx = resp.indexOf("+CIPGSMLOC:");
    if (cIdx != -1) {
      int firstComma = resp.indexOf(",", cIdx);
      if (firstComma != -1) {
        int errCode = resp.substring(cIdx + 11, firstComma).toInt();
        if (errCode == 0) {
          int secondComma = resp.indexOf(",", firstComma + 1);
          int thirdComma  = resp.indexOf(",", secondComma + 1);
          if (secondComma != -1 && thirdComma != -1) {
            float lng = resp.substring(firstComma + 1, secondComma).toFloat();
            float lat = resp.substring(secondComma + 1, thirdComma).toFloat();
            if (lat != 0.0f && lng != 0.0f && lat >= -90.0f && lat <= 90.0f && lng >= -180.0f && lng <= 180.0f) {
              currentLatitude   = lat;
              currentLongitude  = lng;
              gprsLocationFixed = true;
              locationLabel     = isMoving ? "SIM900A Moving Fix" : "SIM900A Live Cell Fix";
              Serial.printf("[SIM900A] ✅ Carrier LBS Fix: Lat: %.6f, Lng: %.6f\n", lat, lng);
            }
          }
        }
      }
    }
  }
}

// ==============================================================================
// 8. AUTO-BAUD DETECTION & HARDWARE SETUP
// ==============================================================================
void pulsePwrKey() {
  if (SIM_PWRKEY_PIN >= 0) {
    Serial.println("[SIM900A] ⚡ Pulsing PWRKEY pin to wake up / reboot SIM900A...");
    pinMode(SIM_PWRKEY_PIN, OUTPUT);
    digitalWrite(SIM_PWRKEY_PIN, LOW); // Pull PWRKEY LOW for 1.5 seconds
    delay(1500);
    digitalWrite(SIM_PWRKEY_PIN, HIGH);
    pinMode(SIM_PWRKEY_PIN, INPUT);    // High-Z release
    delay(3000);                       // Allow modem internal boot sequence
  }
}

void autoBaudSIM900A() {
  const long bauds[] = {9600, 115200, 38400, 19200};
  const int numBauds = sizeof(bauds) / sizeof(bauds[0]);
  bool found = false;

  Serial.println("\n[SIM900A] Scanning SIM900A baud rate on GPIO 19 (RX) and GPIO 18 (TX)...");

  for (int i = 0; i < numBauds; i++) {
    long b = bauds[i];
    Serial.printf("[SIM900A] Testing %ld baud... ", b);
    simSerial.begin(b, SERIAL_8N1, SIM_RX_PIN, SIM_TX_PIN);
    delay(200);

    for (int retry = 0; retry < 3; retry++) {
      while (simSerial.available()) simSerial.read();
      simSerial.print("AT\r\n");
      delay(250);

      String resp = "";
      while (simSerial.available()) resp += (char)simSerial.read();

      if (resp.indexOf("OK") != -1) {
        Serial.printf("CONNECTED at %ld baud!\n", b);
        found = true;
        if (b != 9600) {
          Serial.println("[SIM900A] Locking to 9600 baud for stability (AT+IPR=9600)...");
          simSerial.print("AT+IPR=9600\r\n");
          delay(300);
          simSerial.print("AT&W\r\n");
          delay(300);
          simSerial.begin(9600, SERIAL_8N1, SIM_RX_PIN, SIM_TX_PIN);
        }
        break;
      }
    }
    if (found) break;
    Serial.println("No reply.");
  }

  // If no response and PWRKEY pin is configured, attempt auto-wake
  if (!found && SIM_PWRKEY_PIN >= 0) {
    Serial.println("\n[SIM900A] No response. Triggering automatic PWRKEY pulse on GPIO " + String(SIM_PWRKEY_PIN) + "...");
    pulsePwrKey();
    simSerial.begin(9600, SERIAL_8N1, SIM_RX_PIN, SIM_TX_PIN);
    delay(500);
    simSerial.print("AT\r\n");
    delay(300);
    String resp = "";
    while (simSerial.available()) resp += (char)simSerial.read();
    if (resp.indexOf("OK") != -1) {
      Serial.println("[SIM900A] ✅ SIM900A woke up successfully via PWRKEY!");
      found = true;
    }
  }

  if (!found) {
    Serial.println("\n==================================================================");
    Serial.println("  ⚠️ SIM900A DID NOT REPLY - HARDWARE CHECKLIST:");
    Serial.println("==================================================================");
    Serial.println("  1. Look at the RED LED on your SIM900A board:");
    Serial.println("     -> If RED LED is OFF or NOT blinking: The modem is powered off!");
    Serial.println("     -> Fix: Press and HOLD the onboard 'PWRKEY' button for 2-3 seconds.");
    Serial.println("             Once it blinks, the modem will wake up!");
    Serial.println("  2. Power Supply Check:");
    Serial.println("     -> SIM900A draws up to 2.0A peak in GSM transmission.");
    Serial.println("     -> When Relays switch, weak power drops below 3.4V,");
    Serial.println("        causing the SIM900A to instantly SHUT DOWN.");
    Serial.println("     -> Use a dedicated external 5V 2A DC adapter for SIM900A.");
    Serial.println("  3. Common GND:");
    Serial.println("     -> SIM900A GND MUST connect directly to ESP32 GND.");
    Serial.println("==================================================================\n");
    simSerial.begin(9600, SERIAL_8N1, SIM_RX_PIN, SIM_TX_PIN);
  }

  sendATCommand("ATE0", 1000);
  Serial.println("[SIM900A] SIM900A Serial initialized on GPIO 18 & 19.");
}

// ==============================================================================
// 9. GPRS CELLULAR BEARER MANAGEMENT
// ==============================================================================
bool initGPRS() {
  Serial.println("\n==================================================");
  Serial.println("[SIM900A] Initializing Pure Cellular GPRS...");
  Serial.println("==================================================");

  // Check if modem core is awake
  String atTest = sendATCommand("AT", 1000);
  if (atTest.indexOf("OK") == -1) {
    Serial.println("[SIM900A] ⚠️ Modem not responding to 'AT'. Checking power...");
    if (SIM_PWRKEY_PIN >= 0) {
      pulsePwrKey();
      atTest = sendATCommand("AT", 1000);
    }
    if (atTest.indexOf("OK") == -1) {
      Serial.println("[SIM900A] 🛑 MODEM IS OFF! Press the onboard PWRKEY button for 2s!");
      gprsConnected = false;
      digitalWrite(LED_GPRS, LOW);
      return false;
    }
  }

  sendATCommand("AT+CMEE=2", 1000);
  String cpin = sendATCommand("AT+CPIN?", 2000);
  if (cpin.indexOf("READY") == -1) {
    Serial.printf("[SIM900A] ⚠️ SIM Card Not Ready: %s\n", cpin.c_str());
  } else {
    Serial.println("[SIM900A] ✅ SIM Card: READY");
  }

  detectCarrierMccMnc();
  updateSignalQuality();

  String creg = sendATCommand("AT+CREG?", 2000);
  Serial.printf("[SIM900A] Network Registration: %s\n", creg.c_str());
  if (creg.indexOf(",1") == -1 && creg.indexOf(",5") == -1) {
    Serial.println("[SIM900A] Waiting for Network Registration (Searching 2G tower)...");
    for (int i = 0; i < 6; i++) {
      delay(2000);
      creg = sendATCommand("AT+CREG?", 1500);
      if (creg.indexOf(",1") != -1 || creg.indexOf(",5") != -1) {
        Serial.printf("[SIM900A] ✅ Network Registered: %s\n", creg.c_str());
        break;
      }
    }
  }

  String checkIp = sendATCommand("AT+SAPBR=2,1", 2000);
  if (checkIp.indexOf("+SAPBR: 1,1") != -1 && checkIp.indexOf("0.0.0.0") == -1) {
    Serial.printf("[SIM900A] 🚀 GPRS Bearer Already Active! Cellular IP: %s\n", checkIp.c_str());
    gprsConnected = true;
    digitalWrite(LED_GPRS, HIGH);
    updateServingCellTower();
    return true;
  }

  sendATCommand("AT+SAPBR=0,1", 2000);
  sendATCommand(String("AT+CGDCONT=1,\"IP\",\"") + SIM_APN + "\"", 2000);
  sendATCommand("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", 2000);
  sendATCommand(String("AT+SAPBR=3,1,\"APN\",\"") + SIM_APN + "\"", 2000);

  Serial.println("[SIM900A] Opening GPRS Bearer (AT+SAPBR=1,1)...");
  String bearerOpenResp = sendATCommand("AT+SAPBR=1,1", 8000, true);

  String ip = sendATCommand("AT+SAPBR=2,1", 3000);
  if (ip.indexOf("+SAPBR: 1,1") != -1 && ip.indexOf("0.0.0.0") == -1) {
    gprsConnected = true;
    digitalWrite(LED_GPRS, HIGH);
    Serial.printf("[SIM900A] 🚀 SUCCESS! GPRS Connected! Cellular IP: %s\n", ip.c_str());
    updateServingCellTower();
    return true;
  }

  gprsConnected = false;
  digitalWrite(LED_GPRS, LOW);
  Serial.printf("[SIM900A] ⚠️ GPRS Bearer opening failed (%s). Will retry in loop.\n", bearerOpenResp.c_str());
  return false;
}

// ==============================================================================
// 10. 2-IN-1 CLOUD SYNC (TELEMETRY UPLINK + RELAY DOWNLINK + LIVE LOCATION)
// ==============================================================================
void syncPondWithCloud() {
  readDoSensor();
  updateSignalQuality();

  // Read current physical cell tower before sending packet (captures travel!)
  updateServingCellTower();

  // JSON Payload with serving cell tower info
  String json = "{";
  json += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  json += "\"doLevel\":" + String(currentDoLevel, 2) + ",";
  json += "\"doSensorConnected\":" + String(doSensorConnected ? "true" : "false") + ",";
  json += "\"gprsSignal\":" + String(gprsSignalPercent) + ",";
  json += "\"latitude\":" + String(currentLatitude, 6) + ",";
  json += "\"longitude\":" + String(currentLongitude, 6) + ",";
  json += "\"locationName\":\"" + locationLabel + "\",";
  json += "\"gprsLocationFixed\":" + String(gprsLocationFixed ? "true" : "false") + ",";
  if (cellLac.length() > 0) json += "\"cellLac\":\"" + cellLac + "\",";
  if (cellId.length() > 0)  json += "\"cellId\":\"" + cellId + "\",";
  json += "\"mcc\":\"" + carrierMcc + "\",";
  json += "\"mnc\":\"" + carrierMnc + "\",";
  json += "\"isMoving\":" + String(isMoving ? "true" : "false") + ",";
  json += "\"currentSessionSeconds\":" + String(totalSessionSecs) + ",";
  json += "\"currentSessionMinutes\":" + String(totalSessionSecs / 60);

  // If physical button was pressed, send explicit trigger and current relay states
  if (pendingButtonTrigger.length() > 0) {
    json += ",\"manualButtonTrigger\":\"" + pendingButtonTrigger + "\"";
    json += ",\"status\":\"" + String(generatorState ? "ON" : "OFF") + "\"";
    json += ",\"status2\":\"" + String(relay2State ? "ON" : "OFF") + "\"";
    pendingButtonTrigger = ""; // Reset after dispatching
  }

  json += "}";

  Serial.println("\n[Cloud Sync] 📡 Syncing with Oxynity Cloud Bridge...");
  Serial.printf("[Cloud Sync Payload] %s\n", json.c_str());

  sendATCommand("AT+HTTPTERM", 500);
  sendATCommand("AT+HTTPINIT", 2000);
  sendATCommand("AT+HTTPPARA=\"CID\",1", 1000);
  sendATCommand(String("AT+HTTPPARA=\"URL\",\"") + PROXY_URL + "\"", 2000);
  sendATCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 1000);

  // Clear serial buffer before sending HTTPDATA
  while (simSerial.available()) simSerial.read();

  // Send HTTPDATA with exact byte count and 5-second timeout
  simSerial.println("AT+HTTPDATA=" + String(json.length()) + ",5000");

  // Wait specifically for "DOWNLOAD" prompt from SIM900A modem
  bool gotDownload = false;
  unsigned long startDownloadWait = millis();
  while (millis() - startDownloadWait < 3000) {
    if (simSerial.available()) {
      String line = simSerial.readStringUntil('\n');
      if (line.indexOf("DOWNLOAD") != -1) {
        gotDownload = true;
        break;
      }
    }
    delay(10);
  }

  if (!gotDownload) {
    Serial.println("[Cloud Sync] ⚠️ Modem did not prompt DOWNLOAD. Aborting HTTP POST.");
    sendATCommand("AT+HTTPTERM", 500);
    return;
  }

  // Stream raw JSON payload directly to modem buffer
  simSerial.print(json);

  // Wait for modem's "OK" acknowledging all data bytes buffered
  bool gotDataOk = false;
  unsigned long startOkWait = millis();
  while (millis() - startOkWait < 3000) {
    if (simSerial.available()) {
      String line = simSerial.readStringUntil('\n');
      if (line.indexOf("OK") != -1) {
        gotDataOk = true;
        break;
      }
    }
    delay(10);
  }

  // Trigger HTTP POST
  simSerial.println("AT+HTTPACTION=1");
  String act = waitForHttpAction(15000);

  if (act.indexOf(",200,") != -1) {
    String reply = sendATCommand("AT+HTTPREAD", 3000);
    Serial.printf("[Cloud Sync] ✅ Success! Server Reply: %s\n", reply.c_str());
    failedSyncCount = 0;

    // Check if server cleared movement (e.g. newly calibrated or stationary)
    if (reply.indexOf("\"isMoving\":false") != -1) {
      isMoving = false;
    }

    // Update coordinates if server resolved new cell tower location
    int latIdx = reply.indexOf("\"lat\":");
    int lngIdx = reply.indexOf("\"lng\":");
    if (latIdx != -1 && lngIdx != -1) {
      int commaLat = reply.indexOf(',', latIdx);
      int commaLng = reply.indexOf(',', lngIdx);
      if (commaLng == -1) commaLng = reply.indexOf('}', lngIdx);
      if (commaLat != -1 && commaLng != -1) {
        float rLat = reply.substring(latIdx + 6, commaLat).toFloat();
        float rLng = reply.substring(lngIdx + 6, commaLng).toFloat();
        if (rLat != 0.0f && rLng != 0.0f) {
          currentLatitude = rLat;
          currentLongitude = rLng;
          gprsLocationFixed = true;
          Serial.printf("[Cloud Sync] 📍 Updated Live Coordinates: %.6f, %.6f\n", currentLatitude, currentLongitude);
        }
      }
    }

    // Relay 1 & Generator Control (Sequential 4-Minute Start)
    if (reply.indexOf("\"r1\":\"ON\"") != -1 || reply.indexOf("\"status\":\"ON\"") != -1) {
      if (!generatorState) {
        startGeneratorSequence("Cloud Bridge Command");
      }
    } else if (reply.indexOf("\"r1\":\"OFF\"") != -1 || reply.indexOf("\"status\":\"OFF\"") != -1) {
      if (generatorState) {
        stopGeneratorSequence("Cloud Bridge Command");
      }
    }
  } else {
    Serial.printf("[Cloud Sync] ⚠️ Sync failed. Result: %s\n", act.c_str());
    failedSyncCount++;
    if (failedSyncCount >= 5) {
      Serial.println("[Cloud Sync] ⚠️ 5 consecutive failures. Resetting GPRS Bearer...");
      initGPRS();
      failedSyncCount = 0;
    }
  }

  sendATCommand("AT+HTTPTERM", 500);
}

// ==============================================================================
// 11. SETUP & MAIN LOOP
// ==============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n============================================================");
  Serial.println("  Oxynity Smart - 100% PURE SIM900A GPRS FIRMWARE (NO WI-FI) ");
  Serial.println("============================================================");

  pinMode(RELAY_PIN,      OUTPUT);
  pinMode(RELAY_PIN_2,    OUTPUT);
  pinMode(LED_GPRS,       OUTPUT);
  if (LED_MACHINE >= 0) {
    pinMode(LED_MACHINE,  OUTPUT);
    digitalWrite(LED_MACHINE, LOW);
  }

  setRelay1(false);
  setRelay2(false);
  digitalWrite(LED_GPRS, LOW);

  // Manual Push Buttons (Active LOW with internal PULLUP to GND)
  pinMode(PIN_BTN_START, INPUT_PULLUP);
  pinMode(PIN_BTN_STOP,  INPUT_PULLUP);

  Serial.println("[Relays & Buttons] Configured:");
  Serial.printf("  • Relay 1 (Main Generator) : GPIO %d (Active %s)\n", RELAY_PIN, RELAY_ACTIVE_LOW ? "LOW" : "HIGH");
  Serial.printf("  • Relay 2 (Secondary Aerator): GPIO %d (Active %s)\n", RELAY_PIN_2, RELAY_ACTIVE_LOW ? "LOW" : "HIGH");
  Serial.printf("  • Green Push Button (START): GPIO %d (PULLUP -> GND)\n", PIN_BTN_START);
  Serial.printf("  • Red Push Button (STOP)   : GPIO %d (PULLUP -> GND)\n\n", PIN_BTN_STOP);

  analogSetAttenuation(ADC_11db);
  loadDoCalibration();

  autoBaudSIM900A();
  initGPRS();
}

void loop() {
  // 1. Instantly poll physical push buttons (zero delay, works even without GPRS!)
  handleManualButtons();

  // 2. Non-blocking 4-minute delay timer for Relay 2
  handleSequenceTimer();

  unsigned long now = millis();

  if (generatorState) {
    totalSessionSecs = (now - lastStateChangeMs) / 1000UL;
  }

  if (!gprsConnected) {
    initGPRS();
    delay(2000);
    return;
  }

  // 3. Sync telemetry, relay commands, and live tower location every 6 seconds
  if (now - lastCycleMs >= CYCLE_INTERVAL_MS) {
    lastCycleMs = now;
    syncPondWithCloud();
  }

  delay(10);
}
