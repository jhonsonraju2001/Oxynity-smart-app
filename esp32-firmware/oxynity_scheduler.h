// ============================================================================
//  Oxynity Smart - on-device scheduler (schedules + 6 h run / rest + run hours)
//  Add-on module for esp32-sim900a-firmware.ino / esp32-firmware.ino
//
//  Why: these timers used to run inside the phone app, so they only worked
//  while the app was open. With this file the machine itself follows the
//  schedule, takes its rest and counts run hours, with every phone closed.
//
//  This file has NO hardware code. It only decides "relay should be ON/OFF".
//  The same logic is in the app (src/lib/oxynity.ts: scheduleWindow,
//  isWithinAnySchedule, restMinutesFor), and is unit-tested (test_scheduler.cpp).
//
//  STATUS: logic tested on a PC. NOT yet tested on a real machine. Test on the
//  Bhimavaram demo unit before flashing any customer unit.
// ============================================================================
#ifndef OXYNITY_SCHEDULER_H
#define OXYNITY_SCHEDULER_H

#include <stdint.h>

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

// Everything that must survive a power cut. Save to NVS (Preferences) when
// `dirty` is true, and load it back in setup().
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

// ---- helpers ---------------------------------------------------------------

// App stores 12-hour time (hour 1-12, minute, AM/PM). Convert once when parsing.
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

// Rest minutes: the open schedule's choice (longest one if old data still overlaps, same as the app),
// else the pond default, else 30. Clamped 5..240.
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

// Settings sent by the Cloudflare worker in every reply as "cfg":
//   "scheduleEnabled,cooldownEnabled,defaultRest;enabled,startMin,stopMin,rest;..."
//   e.g. "1,1,30;1,1080,590,30;0,360,1110,90"
// Returns false (config untouched) if the text is not valid.
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
      // end of a group
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

// Call when the farmer presses ON/OFF (app command or the physical buttons).
static inline void oxyManual(OxyState &s, bool turnOn) {
  s.relayOn = turnOn;
  s.resting = false; s.restEndsEpoch = 0;
  s.continuousSec = 0;
  s.startedBySchedule = false;
  s.manualHold = true;           // respected until the next schedule start/stop time
  s.dirty = true;
}

// ---- main tick --------------------------------------------------------------
// Call every `elapsedSec` seconds (10 s is fine).
//   nowEpoch : unix time (seconds). Needs a correct clock: NTP on Wi-Fi, or
//              AT+CCLK? / AT+CIPGSMLOC time on SIM900A.
//   nowMin   : local minutes from midnight (IST = UTC + 5:30).
//   timeValid: false until the clock is set -> schedules are skipped, the 6 h
//              rule still works using elapsed seconds only.
static inline OxyEvent oxyTick(const OxyConfig &c, OxyState &s, uint32_t nowEpoch,
                               uint16_t nowMin, uint32_t elapsedSec, bool timeValid) {
  OxyEvent ev = OXY_NONE;

  // 1. count run time on the device itself
  if (s.relayOn) {
    s.continuousSec += elapsedSec;
    s.totalRunSec   += elapsedSec;
  }

  const bool inWin = timeValid && oxyAnyWindowOpen(c, nowMin);

  // 2. schedule boundaries (a boundary also ends a manual hold)
  if (timeValid && inWin != s.lastInWindow) {
    s.manualHold = false;
    if (inWin) {                                   // window just opened
      if (!s.relayOn && !s.resting) { s.relayOn = true; s.continuousSec = 0; ev = OXY_SCHEDULE_START; }
      s.startedBySchedule = true;
    } else {                                       // window just closed
      if (s.resting) {                             // stop time came during the rest: do not restart
        s.resting = false; s.restEndsEpoch = 0; s.continuousSec = 0; ev = OXY_REST_CANCELLED_BY_STOP_TIME;
      } else if (s.relayOn && s.startedBySchedule) {
        s.relayOn = false; s.continuousSec = 0; ev = OXY_SCHEDULE_STOP;
      }
      s.startedBySchedule = false;
    }
    s.lastInWindow = inWin;
    s.dirty = true;
  }

  // 3. catch-up after a reboot / power cut inside a window
  if (timeValid && inWin && !s.relayOn && !s.resting && !s.manualHold) {
    s.relayOn = true; s.continuousSec = 0; s.startedBySchedule = true; s.dirty = true;
    if (ev == OXY_NONE) ev = OXY_SCHEDULE_START;
  }

  // 4. 6-hour continuous-run protection
  if (c.cooldownEnabled && s.relayOn && s.continuousSec >= OXY_CONTINUOUS_LIMIT_SEC) {
    s.relayOn = false;
    s.resting = true;
    s.restEndsEpoch = nowEpoch + (uint32_t)oxyRestMinutes(c, nowMin) * 60UL;
    s.continuousSec = 0;
    s.dirty = true;
    ev = OXY_REST_START;
  }

  // 5. rest finished
  if (s.resting && nowEpoch >= s.restEndsEpoch) {
    s.resting = false; s.restEndsEpoch = 0; s.continuousSec = 0; s.dirty = true;
    // resume only if a schedule window is open, or the pond has no schedules at all
    const bool noSchedules = !c.scheduleEnabled || !oxyAnyEnabled(c);
    if (inWin || noSchedules || !timeValid) { s.relayOn = true; ev = OXY_REST_END_RESUME; }
    else                                    { ev = OXY_REST_END_STAY_OFF; }
  }

  return ev;
}

#endif // OXYNITY_SCHEDULER_H
