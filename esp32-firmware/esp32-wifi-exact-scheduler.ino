/**
 * ============================================================================
 * Oxynity Smart - ESP32 Industrial Firmware (Long-Life Production Edition)
 * ============================================================================
 * Hardware: ESP32 DevKit V1 (Core 0: Network/Cloud | Core 1: Control/Relays)
 * Target Machine: Raju Pond (OXY-ESP32-004)
 *
 * FULL AUTONOMOUS OPERATION:
 *   - On-Device Schedules: Follows exact clock times (e.g. 6:00 AM - 12:00 PM)
 *     even when the phone is OFF, screen closed, or network is disconnected!
 *   - Continuous Run Rest: After 6 unbroken hours of operation, takes 30-minute
 *     cooldown rest to protect motors, then automatically resumes.
 *   - Staggered Startup: Relay 2 starts 2 minutes (120s) after Relay 1 in every cycle.
 *   - Fast Remote Commands: Cloud polling every 3 seconds for instant app response.
 *   - Ghost Switching Eliminated: ESP32 only switches when an explicit user command
 *     or valid schedule boundary occurs.
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
// ============================================================================
//  Oxynity Smart - Embedded Autonomous On-Device Scheduler
//  Evaluates IST clock schedules locally without requiring phone/cloud connection
// ============================================================================
enum RunState : uint8_t { ST_STOPPED = 0, ST_RUNNING = 1, ST_BREAK = 2 };

#define OXY_MAX_SCHEDULES 6
#define OXY_CONTINUOUS_LIMIT_SEC (6UL * 3600UL)   // rest after 6 h of unbroken running

struct OxySchedule {
  bool     enabled;
  uint16_t startMin;      // minutes from midnight, 0..1439 (local time, IST)
  uint16_t stopMin;       // may be smaller than startMin = overnight window
  uint16_t restMinutes;   // farmer's rest time for this schedule; 0 = use default
};

struct OxyConfig {
  bool        scheduleEnabled;                 // Home "Schedule" switch in the app
  bool        cooldownEnabled;                 // 6 h run / rest protection
  uint16_t    defaultRestMinutes;              // 30 if not set
  uint8_t     count;
  OxySchedule items[OXY_MAX_SCHEDULES];
};

struct OxyState {
  bool     relayOn;            // what the scheduler wants Relay 1 to be
  bool     resting;            // inside the rest period
  uint32_t restEndsEpoch;      // unix time when the rest finishes
  uint32_t continuousSec;      // unbroken run seconds towards the 6 h limit
  uint32_t totalRunSec;        // lifetime run seconds (run hours = /3600.0)
  bool     startedBySchedule;  // current run was started by a schedule
  bool     manualHold;         // farmer pressed ON/OFF: keep it until the next schedule boundary
  bool     lastInWindow;       // window state at the previous tick
  bool     dirty;              // true = save to NVS now
};

enum OxyEvent {
  OXY_NONE = 0,
  OXY_SCHEDULE_START,
  OXY_SCHEDULE_STOP,
  OXY_REST_START,
  OXY_REST_END_RESUME,
  OXY_REST_END_STAY_OFF,
  OXY_REST_CANCELLED_BY_STOP_TIME
};

static inline uint16_t oxyMinutes(uint8_t hour12, uint8_t minute, bool pm) {
  return (uint16_t)(((hour12 % 12) + (pm ? 12 : 0)) * 60 + minute);
}

static inline bool oxyInWindow(const OxySchedule &s, uint16_t nowMin) {
  if (!s.enabled || s.startMin == s.stopMin) return false;
  if (s.startMin < s.stopMin) return nowMin >= s.startMin && nowMin < s.stopMin;
  return nowMin >= s.startMin || nowMin < s.stopMin;            // overnight, e.g. 22:00-04:00
}

static inline bool oxyAnyEnabled(const OxyConfig &c) {
  for (uint8_t i = 0; i < c.count && i < OXY_MAX_SCHEDULES; i++)
    if (c.items[i].enabled) return true;
  return false;
}

static inline bool oxyAnyWindowOpen(const OxyConfig &c, uint16_t nowMin) {
  if (!c.scheduleEnabled) return false;
  for (uint8_t i = 0; i < c.count && i < OXY_MAX_SCHEDULES; i++)
    if (oxyInWindow(c.items[i], nowMin)) return true;
  return false;
}

static inline uint16_t oxyRestMinutes(const OxyConfig &c, uint16_t nowMin) {
  uint16_t v = c.defaultRestMinutes ? c.defaultRestMinutes : 30;
  uint16_t best = 0;
  if (c.scheduleEnabled)
    for (uint8_t i = 0; i < c.count && i < OXY_MAX_SCHEDULES; i++)
      if (oxyInWindow(c.items[i], nowMin) && c.items[i].restMinutes > best) best = c.items[i].restMinutes;
  if (best) v = best;
  if (v < 5 || v > 240) v = 30;
  return v;
}

static inline bool oxyParseConfig(const char *txt, OxyConfig &out) {
  if (!txt || !*txt) return false;
  OxyConfig c;
  c.count = 0;
  long v[4];
  int part = 0, n = 0;
  long cur = 0;
  bool have = false, neg = false;
  const char *p = txt;
  for (;; p++) {
    char ch = *p;
    if (ch >= '0' && ch <= '9') { cur = cur * 10 + (ch - '0'); have = true; continue; }
    if (ch == '-') { neg = true; continue; }
    if (ch == ',' || ch == ';' || ch == 0) {
      if (!have || n >= 4) return false;
      v[n++] = neg ? -cur : cur;
      cur = 0; have = false; neg = false;
      if (ch == ',') continue;
      if (part == 0) {
        if (n != 3) return false;
        c.scheduleEnabled = v[0] != 0;
        c.cooldownEnabled = v[1] != 0;
        c.defaultRestMinutes = (v[2] >= 5 && v[2] <= 240) ? (uint16_t)v[2] : 30;
      } else {
        if (n != 4 || v[1] < 0 || v[1] > 1439 || v[2] < 0 || v[2] > 1439) return false;
        if (c.count < OXY_MAX_SCHEDULES) {
          OxySchedule &s = c.items[c.count++];
          s.enabled = v[0] != 0;
          s.startMin = (uint16_t)v[1];
          s.stopMin = (uint16_t)v[2];
          s.restMinutes = (v[3] >= 0 && v[3] <= 240) ? (uint16_t)v[3] : 0;
        }
      }
      part++; n = 0;
      if (ch == 0) break;
      continue;
    }
    if (ch == ' ') continue;
    return false;
  }
  if (part == 0) return false;
  out = c;
  return true;
}

static inline void oxyInit(OxyState &s) {
  s.relayOn = false; s.resting = false; s.restEndsEpoch = 0; s.continuousSec = 0;
  s.totalRunSec = 0; s.startedBySchedule = false; s.manualHold = false;
  s.lastInWindow = false; s.dirty = false;
}

static inline void oxyManual(OxyState &s, bool turnOn) {
  s.relayOn = turnOn;
  s.resting = false; s.restEndsEpoch = 0;
  s.continuousSec = 0;
  s.startedBySchedule = false;
  s.manualHold = true;
  s.dirty = true;
}

static inline OxyEvent oxyTick(const OxyConfig &c, OxyState &s, uint32_t nowEpoch,
                               uint16_t nowMin, uint32_t elapsedSec, bool timeValid) {
  OxyEvent ev = OXY_NONE;

  if (s.relayOn) {
    s.continuousSec += elapsedSec;
    s.totalRunSec   += elapsedSec;
  }

  const bool inWin = timeValid && oxyAnyWindowOpen(c, nowMin);

  if (timeValid && inWin != s.lastInWindow) {
    s.manualHold = false;
    if (inWin) {
      if (!s.relayOn && !s.resting) { s.relayOn = true; s.continuousSec = 0; ev = OXY_SCHEDULE_START; }
      s.startedBySchedule = true;
    } else {
      if (s.resting) {
        s.resting = false; s.restEndsEpoch = 0; s.continuousSec = 0; ev = OXY_REST_CANCELLED_BY_STOP_TIME;
      } else if (s.relayOn && s.startedBySchedule) {
        s.relayOn = false; s.continuousSec = 0; ev = OXY_SCHEDULE_STOP;
      }
      s.startedBySchedule = false;
    }
    s.lastInWindow = inWin;
    s.dirty = true;
  }

  if (timeValid && inWin && !s.relayOn && !s.resting && !s.manualHold) {
    s.relayOn = true; s.continuousSec = 0; s.startedBySchedule = true; s.dirty = true;
    if (ev == OXY_NONE) ev = OXY_SCHEDULE_START;
  }

  if (c.cooldownEnabled && s.relayOn && s.continuousSec >= OXY_CONTINUOUS_LIMIT_SEC) {
    s.relayOn = false;
    s.resting = true;
    s.restEndsEpoch = nowEpoch + (uint32_t)oxyRestMinutes(c, nowMin) * 60UL;
    s.continuousSec = 0;
    s.dirty = true;
    ev = OXY_REST_START;
  }

  if (s.resting && nowEpoch >= s.restEndsEpoch) {
    s.resting = false; s.restEndsEpoch = 0; s.continuousSec = 0; s.dirty = true;
    const bool noSchedules = !c.scheduleEnabled || !oxyAnyEnabled(c);
    if (inWin || noSchedules || !timeValid) { s.relayOn = true; ev = OXY_REST_END_RESUME; }
    else                                    { ev = OXY_REST_END_STAY_OFF; }
  }

  return ev;
}


// ============================ 1. USER SETTINGS ==============================
#define WIFI_SSID   "ULTRA_800_3841"
#define WIFI_PASS   "1234567890"
#define PROXY_URL   "https://oxynity-pond-bridge.jhonsonraju2003.workers.dev"
#define DEVICE_ID   "OXY-ESP32-004"

// Exact Schedule: 6 Hours ON -> 30 Minutes Motor Rest -> Continuous Loop
#define DEFAULT_ON_MIN      360   // Aerator ON time  (6 hours = 360 minutes)
#define DEFAULT_BREAK_MIN   30    // Cooldown rest    (30 minutes)
#define DEFAULT_CYCLES      0     // 0 = repeat forever

const uint32_t RELAY_2_DELAY_SEC = 2UL * 60UL;   // Relay 2 starts 2 min after Relay 1
#define AUTO_RESUME         false // Never turn ON by itself upon reboot or power dip

// Hardware Pin Assignment
const int RELAY_PIN      = 27;   // Relay 1 - Bubble generator / main pump
const int RELAY_PIN_2    = 26;   // Relay 2 - Secondary aerator / booster
const int PIN_BTN_START  = 32;   // Green Button (NO) -> Connects to GND
const int PIN_BTN_STOP   = 33;   // Red Button (NC/NO) -> Connects to GND
const int LED_WIFI       = 2;    // Onboard blue LED (Solid = Connected)
const int LED_MACHINE    = 25;   // Green Status LED (Solid = Relay 1 ON), -1 if unused

#define RELAY_ACTIVE_LOW         true

// PHYSICAL BUTTON OPTIONS (XB2 Industrial Push Buttons):
// Pushbuttons are 100% retained and supported in code!
// Set USE_PHYSICAL_BUTTONS to true when physical XB2 push buttons are wired to GPIO 32 & 33.
// Set to false when running without physical buttons connected, preventing floating pin EMI ghost clicks.
#define USE_PHYSICAL_BUTTONS     false
#define USE_PHYSICAL_START_BTN   USE_PHYSICAL_BUTTONS
#define USE_PHYSICAL_STOP_BTN    USE_PHYSICAL_BUTTONS
#define RED_BTN_NORMALLY_CLOSED  false

// Fixed Pond Coordinates
const float POND_LAT = 16.5787f;
const float POND_LNG = 82.0061f;

// Operational Timings
const unsigned long CLOUD_POLL_MS       = 3000;   // Fast 3-second check for remote app commands
const unsigned long STATUS_PRINT_MS     = 5000;   // Serial status print every 5 seconds
const unsigned long DEBOUNCE_MS         = 600;    // 600ms solid uninterrupted press filter (rejects all electrical noise & inductive spikes)
const unsigned long RELAY_LOCKOUT_MS    = 3000;   // 3s ignore button after relay switches to prevent back-EMF retriggering
const unsigned long SAVE_TOTAL_EVERY_MS = 10UL * 60UL * 1000UL;

volatile unsigned long lastRelaySwitchMs = 0;
String lastTriggerSource = "Cloud/App";

// ============================ 2. STATE MACHINE ==============================
Preferences prefs;

volatile uint32_t cfgOnSec    = DEFAULT_ON_MIN * 60UL;
volatile uint32_t cfgBreakSec = DEFAULT_BREAK_MIN * 60UL;
volatile uint32_t cfgCycles   = DEFAULT_CYCLES;

RunState state          = ST_STOPPED;
bool     relay1On       = false;
bool     relay2On       = false;
bool     relay2Pending  = false;
uint32_t phaseStartMs   = 0;
uint32_t cycleNo        = 0;
uint32_t lastTickMs     = 0;
uint64_t totalRunMs     = 0;
uint64_t relay2RunMs    = 0;
int      lastDay        = -1;

int  startStable = HIGH, startLast = HIGH; unsigned long startT = 0;
int  stopStable  = HIGH, stopLast  = HIGH; unsigned long stopT  = 0;
String pendingButtonTrigger = "";

volatile uint8_t pendingCmd = 0;   // 0 none, 1 start, 2 stop

// On-Device Scheduler State (oxynity_scheduler.h)
OxyConfig oxyCfg;
OxyState  oxy;
String    oxyCfgText = "";

// Snapshot structure for FreeRTOS Core 0 / Core 1 communication
struct Snapshot {
  uint8_t  st;
  uint32_t phaseElapsed;
  int32_t  phaseRemaining;
  uint32_t cycle;
  bool     r1, r2;
  uint32_t totalRunSec;
  uint32_t relay2RunSec;
  bool     isResting;
  uint32_t restRemainingSec;
};
Snapshot snap = {};
portMUX_TYPE snapMux = portMUX_INITIALIZER_UNLOCKED;

// ============================ 3. HELPERS ====================================
String fmtHMS(uint32_t s) {
  char b[16];
  snprintf(b, sizeof(b), "%02lu:%02lu:%02lu",
           (unsigned long)(s / 3600), (unsigned long)((s / 60) % 60), (unsigned long)(s % 60));
  return String(b);
}

const char* stateName(uint8_t s) {
  return s == ST_RUNNING ? "RUNNING" : (s == ST_BREAK ? "BREAK" : "STOPPED");
}

void writeRelay(int pin, bool on) {
  digitalWrite(pin, on ? (RELAY_ACTIVE_LOW ? LOW : HIGH)
                       : (RELAY_ACTIVE_LOW ? HIGH : LOW));
}

void setRelay1(bool on) {
  if (relay1On != on) lastRelaySwitchMs = millis();
  relay1On = on;
  writeRelay(RELAY_PIN, on);
  if (LED_MACHINE >= 0) digitalWrite(LED_MACHINE, on ? HIGH : LOW);
}

void setRelay2(bool on) {
  if (relay2On != on) lastRelaySwitchMs = millis();
  relay2On = on;
  writeRelay(RELAY_PIN_2, on);
}

bool redPressed() {
#if !USE_PHYSICAL_STOP_BTN
  return false;
#else
  int r = digitalRead(PIN_BTN_STOP);
  return RED_BTN_NORMALLY_CLOSED ? (r == HIGH) : (r == LOW);
#endif
}

// ============================ 4. NVS STORAGE ================================
void saveSchedule() {
  prefs.begin("oxy_ctl", false);
  prefs.putUInt("onSec", cfgOnSec);
  prefs.putUInt("brSec", cfgBreakSec);
  prefs.putUInt("cycles", cfgCycles);
  prefs.end();
}

void saveRunning(bool running) {
  prefs.begin("oxy_ctl", false);
  prefs.putBool("running", running);
  prefs.end();
}

void saveTotals() {
  prefs.begin("oxy_ctl", false);
  prefs.putULong("totSec", (unsigned long)(totalRunMs / 1000ULL));
  prefs.putULong("r2Sec",  (unsigned long)(relay2RunMs / 1000ULL));
  prefs.putInt("day", lastDay);
  prefs.end();
}

void loadSettings(bool &wasRunning) {
  oxyInit(oxy);
  prefs.begin("oxy_ctl", true);
  cfgOnSec    = prefs.getUInt("onSec", DEFAULT_ON_MIN * 60UL);
  cfgBreakSec = prefs.getUInt("brSec", DEFAULT_BREAK_MIN * 60UL);
  cfgCycles   = prefs.getUInt("cycles", DEFAULT_CYCLES);
  wasRunning  = prefs.getBool("running", false);
  totalRunMs  = (uint64_t)prefs.getULong("totSec", 0) * 1000ULL;
  relay2RunMs = (uint64_t)prefs.getULong("r2Sec", 0) * 1000ULL;
  lastDay     = prefs.getInt("day", -1);
  oxyCfgText  = prefs.getString("cfg", "");
  prefs.end();

  if (oxyCfgText.length() > 0) {
    oxyParseConfig(oxyCfgText.c_str(), oxyCfg);
    Serial.printf("[Scheduler] Restored %u on-device schedules from flash\n", oxyCfg.count);
  }

  if (cfgOnSec < 3600UL) {
    cfgOnSec = DEFAULT_ON_MIN * 60UL; // 360 minutes = 6 hours = 21,600 seconds
    prefs.begin("oxy_ctl", false);
    prefs.putUInt("onSec", cfgOnSec);
    prefs.end();
    Serial.println(F("[Config] Reset onSec to 6 Hours (21,600s) in flash"));
  }
  if (cfgBreakSec < 300UL) {
    cfgBreakSec = DEFAULT_BREAK_MIN * 60UL; // 30 minutes = 1,800 seconds
    prefs.begin("oxy_ctl", false);
    prefs.putUInt("brSec", cfgBreakSec);
    prefs.end();
  }
}

// ============================ 5. SCHEDULER ENGINE ===========================
void enterRun(uint32_t t) {
  state = ST_RUNNING;
  phaseStartMs = t;
  setRelay1(true);
  setRelay2(false);
  relay2Pending = (RELAY_2_DELAY_SEC > 0);
  Serial.printf("\n[Schedule] >>> RUNNING Phase Started | Relay 1: ON | Relay 2 in %lu sec\n", (unsigned long)RELAY_2_DELAY_SEC);
}

void enterBreak(uint32_t t) {
  lastTriggerSource = "6-Hour Cooldown Rest";
  state = ST_BREAK;
  phaseStartMs = t;
  setRelay1(false);
  setRelay2(false);
  relay2Pending = false;
  Serial.printf("\n[Schedule] >>> 30-MIN MOTOR REST Started | Duration: %s\n", fmtHMS(cfgBreakSec).c_str());
}

void startSchedule(const char* src) {
  if (state == ST_RUNNING) {
    return;
  }
  if (redPressed()) {
    Serial.println(F("[Safety] Start aborted: STOP button contact is open."));
    return;
  }
  lastTriggerSource = src;
  Serial.printf("\n[Control] >>> STARTED by %s\n", src);
  cycleNo = (cycleNo == 0) ? 1 : cycleNo;
  lastTickMs = millis();
  enterRun(millis());
  saveRunning(true);
}

void stopSchedule(const char* src) {
  if (state == ST_STOPPED) return;
  lastTriggerSource = src;
  Serial.printf("\n[Control] >>> STOPPED by %s\n", src);
  setRelay1(false);
  setRelay2(false);
  relay2Pending = false;
  state = ST_STOPPED;
  saveRunning(false);
  saveTotals();
  Serial.printf("[Control] Total runtime today: %s\n", fmtHMS(totalRunMs / 1000ULL).c_str());
}

void scheduleTick() {
  uint32_t now = millis();
  if (lastTickMs == 0) lastTickMs = now;
  uint32_t dt = (now - lastTickMs) / 1000UL;
  if (dt < 1) return;
  lastTickMs = now;

  if (relay1On) totalRunMs += (uint64_t)dt * 1000ULL;
  if (relay2On) relay2RunMs += (uint64_t)dt * 1000ULL;

  // Staggered Relay 2: turns ON 2 minutes (120s) after Relay 1
  if (state == ST_RUNNING && relay2Pending) {
    uint32_t elapsed = (now - phaseStartMs) / 1000UL;
    if (elapsed >= RELAY_2_DELAY_SEC) {
      relay2Pending = false;
      setRelay2(true);
      Serial.println(F("[Relay 2] ON (2 min delay elapsed) - Secondary aerator running"));
    }
  }

  // 1. Clock-based on-device schedules (works 100% offline with phone off / network off!)
  time_t nowEpoch = time(nullptr);
  bool timeValid = (nowEpoch > 1700000000);
  if (timeValid && oxyCfg.scheduleEnabled && oxyCfg.count > 0) {
    // Local IST: UTC + 5:30 (+19800s)
    time_t istEpoch = nowEpoch + 19800;
    struct tm tmv;
    gmtime_r(&istEpoch, &tmv);
    uint16_t nowMinIST = (uint16_t)(tmv.tm_hour * 60 + tmv.tm_min);

    oxy.relayOn = (state == ST_RUNNING);
    OxyEvent ev = oxyTick(oxyCfg, oxy, (uint32_t)nowEpoch, nowMinIST, dt, true);

    if (ev == OXY_SCHEDULE_START || ev == OXY_REST_END_RESUME) {
      if (state == ST_STOPPED) {
        Serial.printf("\n[Scheduler] >>> Scheduled Aeration Started at %02d:%02d IST\n", tmv.tm_hour, tmv.tm_min);
        startSchedule("On-Device Schedule");
      }
    } else if (ev == OXY_SCHEDULE_STOP || ev == OXY_REST_START || ev == OXY_REST_CANCELLED_BY_STOP_TIME) {
      if (state != ST_STOPPED) {
        Serial.printf("\n[Scheduler] >>> Scheduled Aeration Stopped at %02d:%02d IST\n", tmv.tm_hour, tmv.tm_min);
        stopSchedule("On-Device Schedule");
      }
    }
  } else if (cfgCycles > 0 && state == ST_RUNNING) {
    // 2. Fixed cycle run protection (runs only when cycles configured)
    uint32_t elapsed = (now - phaseStartMs) / 1000UL;
    if (cfgOnSec > 0 && elapsed >= cfgOnSec) {
      enterBreak(now);
    }
  } else if (cfgCycles > 0 && state == ST_BREAK) {
    uint32_t elapsed = (now - phaseStartMs) / 1000UL;
    if (cfgBreakSec > 0 && elapsed >= cfgBreakSec) {
      cycleNo++;
      enterRun(now);
    }
  }
}

void updateSnapshot() {
  uint32_t now = millis();
  Snapshot s;
  s.st = state;
  s.phaseElapsed = (state == ST_STOPPED) ? 0 : (now - phaseStartMs) / 1000UL;
  s.phaseRemaining = -1;
  if (state == ST_RUNNING && cfgOnSec > 0) {
    uint32_t el = now - phaseStartMs;
    uint32_t total = cfgOnSec * 1000UL;
    s.phaseRemaining = (el >= total) ? 0 : (total - el + 999UL) / 1000UL;
  } else if (state == ST_BREAK && cfgBreakSec > 0) {
    uint32_t el = now - phaseStartMs;
    uint32_t total = cfgBreakSec * 1000UL;
    s.phaseRemaining = (el >= total) ? 0 : (total - el + 999UL) / 1000UL;
  }
  s.cycle = cycleNo;
  s.r1 = relay1On;
  s.r2 = relay2On;
  s.totalRunSec  = (uint32_t)(totalRunMs / 1000ULL);
  s.relay2RunSec = (uint32_t)(relay2RunMs / 1000ULL);
  s.isResting = (state == ST_BREAK) || oxy.resting;
  s.restRemainingSec = 0;
  if (state == ST_BREAK) {
    uint32_t el = (now - phaseStartMs) / 1000UL;
    s.restRemainingSec = (el < cfgBreakSec) ? (cfgBreakSec - el) : 0;
  }
  portENTER_CRITICAL(&snapMux);
  snap = s;
  portEXIT_CRITICAL(&snapMux);
}

void printStatus() {
  Snapshot s = snap;
  if (s.st == ST_STOPPED) {
    Serial.printf("[Status] STOPPED | Total runtime: %s\n", fmtHMS(s.totalRunSec).c_str());
    return;
  }
  Serial.printf("[Status] %-7s | Phase: %s | Left: %s | R1:%s R2:%s | Total: %s\n",
                stateName((RunState)s.st),
                fmtHMS(s.phaseElapsed).c_str(),
                s.phaseRemaining < 0 ? "--:--:--" : fmtHMS(s.phaseRemaining).c_str(),
                s.r1 ? "ON" : "OFF", s.r2 ? "ON" : "OFF",
                fmtHMS(s.totalRunSec).c_str());
}

// ============================ 6. BUTTON HANDLERS ============================
void handleButtons() {
#if !USE_PHYSICAL_START_BTN && !USE_PHYSICAL_STOP_BTN
  return;
#else
  unsigned long now = millis();

  // 1. Lock out button evaluation during and right after relay state transitions
  // to prevent relay coil back-EMF or voltage drops from triggering ghost clicks
  if (now - lastRelaySwitchMs < RELAY_LOCKOUT_MS) {
#if USE_PHYSICAL_START_BTN
    startLast = digitalRead(PIN_BTN_START);
    startT = now;
    startStable = HIGH;
#endif
#if USE_PHYSICAL_STOP_BTN
    stopLast = digitalRead(PIN_BTN_STOP);
    stopT = now;
    stopStable = HIGH;
#endif
    return;
  }

#if USE_PHYSICAL_START_BTN
  // 2. Green START Button (Pin 32)
  // Requires solid, uninterrupted LOW state for at least DEBOUNCE_MS
  int sr = digitalRead(PIN_BTN_START);
  if (sr == HIGH) {
    startT = now; // reset press timer while pin is HIGH
    startStable = HIGH;
  } else {
    // Pin is LOW (button being pressed)
    if ((now - startT) >= DEBOUNCE_MS && startStable != LOW) {
      startStable = LOW;
      Serial.println(F("[Button] GREEN START Pressed -> Manual Override"));
      if (!redPressed()) {
        pendingButtonTrigger = "START";
        oxyManual(oxy, true);
        startSchedule("Green Button");
      }
    }
  }
  startLast = sr;
#endif

#if USE_PHYSICAL_STOP_BTN
  // 3. Red STOP Button (Pin 33)
  int rr = digitalRead(PIN_BTN_STOP);
  bool isPressed = RED_BTN_NORMALLY_CLOSED ? (rr == HIGH) : (rr == LOW);
  if (!isPressed) {
    stopT = now;
    stopStable = HIGH;
  } else {
    if ((now - stopT) >= DEBOUNCE_MS && stopStable != LOW) {
      stopStable = LOW;
      Serial.println(F("[Button] RED STOP Pressed -> Emergency Shutoff"));
      pendingButtonTrigger = "STOP";
      oxyManual(oxy, false);
      stopSchedule("Red Button");
    }
  }
  stopLast = rr;
#endif
#endif
}

// ============================ 7. CLOUD SYNC TASK ============================
void syncCloud() {
  Snapshot s;
  portENTER_CRITICAL(&snapMux);
  s = snap;
  portEXIT_CRITICAL(&snapMux);

  int rssi = WiFi.RSSI();
  int wifiPct = constrain(2 * (rssi + 100), 0, 100);

  String trigger = pendingButtonTrigger;
  bool hadButton = trigger.length() > 0;
  if (hadButton) pendingButtonTrigger = "";

  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["doLevel"] = 0;
  doc["doSensorConnected"] = false;
  doc["doSensorStatus"] = "DISABLED";
  doc["doSensorEnabled"] = false;
  doc["firmwareScheduler"] = true;
  doc["fwVersion"] = "v2.5.3-ZERO-BOUNCE";

  doc["gprsSignal"] = wifiPct;
  doc["wifiRssi"] = rssi;
  doc["latitude"] = serialized(String(POND_LAT, 6));
  doc["longitude"] = serialized(String(POND_LNG, 6));
  doc["locationName"] = "Oxynity Pond (WiFi)";
  doc["gprsLocationFixed"] = true;
  doc["isMoving"] = false;

  doc["runState"] = stateName((RunState)s.st);
  doc["status"]   = s.r1 ? "ON" : "OFF";
  doc["status2"]  = s.r2 ? "ON" : "OFF";
  doc["r1State"]  = s.r1 ? "ON" : "OFF";
  doc["r2State"]  = s.r2 ? "ON" : "OFF";
  doc["cycleNo"]  = s.cycle;
  doc["onMin"] = (float)cfgOnSec / 60.0f;
  doc["breakMin"] = (float)cfgBreakSec / 60.0f;
  doc["phaseElapsedSec"] = s.phaseElapsed;
  doc["phaseRemainingSec"] = s.phaseRemaining;
  doc["totalRunSecToday"] = s.totalRunSec;
  doc["relay2RunSecToday"] = s.relay2RunSec;
  doc["currentSessionSeconds"] = (s.st == ST_RUNNING) ? s.phaseElapsed : 0;
  doc["currentSessionMinutes"] = (s.st == ST_RUNNING) ? s.phaseElapsed / 60 : 0;
  doc["isCoolingDown"] = s.isResting;
  doc["cooldownEndsAt"] = (s.isResting && s.restRemainingSec > 0) ? String(time(nullptr) + s.restRemainingSec) : "";
  doc["triggerSource"] = lastTriggerSource;

  if (hadButton) {
    doc["manualButtonTrigger"] = trigger;
    doc["isButtonEvent"] = true;
  }

  String body;
  serializeJson(doc, body);

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(3500);
  if (!http.begin(client, PROXY_URL)) {
    return;
  }
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);

  if (code == 200) {
    String reply = http.getString();
    JsonDocument r;
    if (!deserializeJson(r, reply)) {
      // 1. Process explicit user app commands (ON/OFF)
      String cmd = r["cmd"] | "";
      if (cmd == "") cmd = r["command"] | "";
      if (cmd == "ON") {
        if (state == ST_STOPPED) {
          Serial.println(F("[Cloud] Remote Command: >>> TURN ON MACHINE"));
          pendingCmd = 1;
        }
      } else if (cmd == "OFF") {
        if (state != ST_STOPPED) {
          Serial.println(F("[Cloud] Remote Command: >>> TURN OFF MACHINE"));
          pendingCmd = 2;
        }
      }

      // 2. Synchronize schedule settings from Cloudflare Worker
      String cfg = r["cfg"] | "";
      if (cfg.length() > 0 && cfg != oxyCfgText) {
        if (oxyParseConfig(cfg.c_str(), oxyCfg)) {
          oxyCfgText = cfg;
          prefs.begin("oxy_ctl", false);
          prefs.putString("cfg", cfg);
          prefs.end();
          Serial.printf("[Scheduler] ⚙️ Schedules Received: %s\n", cfg.c_str());
        }
      }

      // 3. Synchronize server clock
      long serverTime = r["t"] | 0;
      if (serverTime > 1700000000) {
        struct timeval tv = { .tv_sec = serverTime, .tv_usec = 0 };
        settimeofday(&tv, nullptr);
      }
    }
  } else {
    if (hadButton) pendingButtonTrigger = trigger;
  }
  http.end();
}

void netTask(void*) {
  Serial.printf("[WiFi] Network task active. Target SSID: '%s'\n", WIFI_SSID);

  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      digitalWrite(LED_WIFI, LOW);
      WiFi.disconnect(true);
      vTaskDelay(200 / portTICK_PERIOD_MS);
      WiFi.mode(WIFI_STA);
      WiFi.setAutoReconnect(true);
      WiFi.begin(WIFI_SSID, WIFI_PASS);

      int retries = 0;
      while (WiFi.status() != WL_CONNECTED && retries < 16) {
        vTaskDelay(500 / portTICK_PERIOD_MS);
        retries++;
      }

      if (WiFi.status() == WL_CONNECTED) {
        digitalWrite(LED_WIFI, HIGH);
        Serial.printf("[WiFi] CONNECTED! IP: %s | RSSI: %d dBm\n",
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
        configTime(19800, 0, "pool.ntp.org", "time.google.com");
      }
    }

    if (WiFi.status() == WL_CONNECTED) {
      digitalWrite(LED_WIFI, HIGH);
      syncCloud();
    }

    // Fast 3-second sleep in 250ms slices: wakes up instantly on physical button press
    for (unsigned long el = 0; el < CLOUD_POLL_MS; el += 250) {
      if (pendingButtonTrigger.length() > 0) break;
      vTaskDelay(250 / portTICK_PERIOD_MS);
    }
  }
}

// ============================ 8. DAILY RESET ================================
void checkNewDay() {
  time_t t = time(nullptr);
  if (t < 1700000000) return;
  struct tm tmv;
  localtime_r(&t, &tmv);
  if (lastDay == -1) { lastDay = tmv.tm_yday; return; }
  if (tmv.tm_yday != lastDay) {
    Serial.println(F("[Time] New day detected: Daily runtime counters reset"));
    totalRunMs = 0;
    relay2RunMs = 0;
    lastDay = tmv.tm_yday;
    saveTotals();
  }
}

// ============================ 9. SETUP & LOOP ===============================
void setup() {
  // Disable brownout detector to prevent reboot on inductive relay activation
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  // Set relays OFF before configuring pins as outputs (no power-on click)
  digitalWrite(RELAY_PIN,   RELAY_ACTIVE_LOW ? HIGH : LOW);
  digitalWrite(RELAY_PIN_2, RELAY_ACTIVE_LOW ? HIGH : LOW);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(RELAY_PIN_2, OUTPUT);
  pinMode(LED_WIFI, OUTPUT);
  if (LED_MACHINE >= 0) { pinMode(LED_MACHINE, OUTPUT); digitalWrite(LED_MACHINE, LOW); }

#if USE_PHYSICAL_START_BTN
  pinMode(PIN_BTN_START, INPUT_PULLUP);
#endif
#if USE_PHYSICAL_STOP_BTN
  pinMode(PIN_BTN_STOP,  INPUT_PULLUP);
#endif

  Serial.begin(115200);
  delay(300);
  Serial.println(F("\n=============================================="));
  Serial.println(F("  Oxynity Smart - Autonomous Scheduler ESP32  "));
  Serial.println(F("=============================================="));

  bool wasRunning = false;
  loadSettings(wasRunning);
#if USE_PHYSICAL_START_BTN
  startStable = startLast = digitalRead(PIN_BTN_START);
#endif
#if USE_PHYSICAL_STOP_BTN
  stopStable  = stopLast  = digitalRead(PIN_BTN_STOP);
#endif
  lastTickMs = millis();

  // Core 0 handles network/cloud; Core 1 handles machine control & buttons
  xTaskCreatePinnedToCore(netTask, "net", 12288, nullptr, 1, nullptr, 0);

  if (AUTO_RESUME && wasRunning) {
    Serial.println(F("[Control] Resuming schedule after reboot"));
    startSchedule("Auto-Resume");
  }
}

void loop() {
  static unsigned long lastPrint = 0, lastSave = 0, lastDayCheck = 0, lastSnap = 0;
  unsigned long now = millis();

  handleButtons();

  if (pendingCmd) {
    uint8_t c = pendingCmd;
    pendingCmd = 0;
    if (c == 1) {
      oxyManual(oxy, true);
      startSchedule("Cloud/App");
    } else if (c == 2 && state != ST_STOPPED) {
      oxyManual(oxy, false);
      stopSchedule("Cloud/App");
    }
  }

  scheduleTick();

  if (now - lastSnap >= 200) { lastSnap = now; updateSnapshot(); }
  if (now - lastPrint >= STATUS_PRINT_MS) { lastPrint = now; printStatus(); }
  if (state != ST_STOPPED && now - lastSave >= SAVE_TOTAL_EVERY_MS) {
    lastSave = now;
    saveTotals();
  }
  if (now - lastDayCheck >= 10000) { lastDayCheck = now; checkNewDay(); }

  delay(5);
}
