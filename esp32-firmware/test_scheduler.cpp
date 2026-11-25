// PC test for oxynity_scheduler.h :  g++ -std=c++17 test_scheduler.cpp -o t && ./t
#include "oxynity_scheduler.h"
#include <cstdio>

static int pass = 0, fail = 0;
static void ok(bool c, const char *d) { (c ? pass : fail)++; printf("%s %s\n", c ? "PASS" : "FAIL", d); }

// run the clock from `fromMin` for `minutes`, 10 s ticks; returns last non-NONE event
static OxyEvent run(const OxyConfig &c, OxyState &s, uint32_t &epoch, uint32_t minutes, bool valid = true) {
  OxyEvent last = OXY_NONE;
  for (uint32_t i = 0; i < minutes * 6; i++) {
    epoch += 10;
    uint16_t nowMin = (uint16_t)((epoch / 60) % 1440);
    OxyEvent e = oxyTick(c, s, epoch, nowMin, 10, valid);
    if (e != OXY_NONE) last = e;
  }
  return last;
}

int main() {
  ok(oxyMinutes(12, 0, false) == 0 && oxyMinutes(12, 30, true) == 750 && oxyMinutes(6, 0, true) == 1080, "12-hour time conversion");

  OxySchedule day = {true, 6 * 60, 12 * 60, 0}, night = {true, 22 * 60, 4 * 60, 45};
  ok(!oxyInWindow(day, 359) && oxyInWindow(day, 360) && oxyInWindow(day, 719) && !oxyInWindow(day, 720), "day window edges");
  ok(oxyInWindow(night, 23 * 60) && oxyInWindow(night, 2 * 60) && !oxyInWindow(night, 5 * 60), "overnight window");

  // Naren's example: 6 PM - 6 AM schedule, 6 h run, 30 min rest, restart, stop at 6 AM
  OxyConfig c = {true, true, 30, 1, {{true, 18 * 60, 6 * 60, 0}}};
  OxyState s; oxyInit(s);
  uint32_t epoch = 17 * 3600 + 50 * 60;                 // 17:50
  run(c, s, epoch, 9);  ok(!s.relayOn, "OFF before start time");
  run(c, s, epoch, 2);  ok(s.relayOn, "ON at 18:00 by schedule");
  run(c, s, epoch, 357); ok(s.relayOn && !s.resting, "still ON just before 6 h");
  OxyEvent e = run(c, s, epoch, 4); ok(!s.relayOn && s.resting && e == OXY_REST_START, "rest starts after 6 h (about 00:00)");
  run(c, s, epoch, 24); ok(!s.relayOn && s.resting, "still resting at about 27 min");
  e = run(c, s, epoch, 5); ok(s.relayOn && !s.resting && e == OXY_REST_END_RESUME, "auto restart after 30 min rest");
  run(c, s, epoch, 5 * 60 + 15); ok(s.relayOn, "running until just before 06:00");
  e = run(c, s, epoch, 20); ok(!s.relayOn && !s.resting, "OFF at 06:00 stop time");
  run(c, s, epoch, 120); ok(!s.relayOn, "stays OFF after stop time");
  ok(s.totalRunSec > 11 * 3600 && s.totalRunSec < 11 * 3600 + 45 * 60, "run hours counted on device (about 11.5 h)");

  // stop time arrives during the rest -> must NOT restart
  OxyConfig c2 = {true, true, 30, 1, {{true, 6 * 60, 12 * 60 + 10, 0}}};
  oxyInit(s); epoch = 5 * 3600 + 59 * 60;
  run(c2, s, epoch, 362); ok(s.resting, "resting at about 12:01");
  run(c2, s, epoch, 60);  ok(!s.relayOn && !s.resting, "stop time during rest: stays OFF");

  // farmer's rest time per schedule
  OxyConfig c3 = {true, true, 30, 1, {{true, 0, 23 * 60, 60}}};
  oxyInit(s); epoch = 0;
  run(c3, s, epoch, 362); ok(s.resting, "rest started (60 min schedule rest)");
  run(c3, s, epoch, 45);  ok(s.resting && !s.relayOn, "still resting at 45 min");
  run(c3, s, epoch, 17);  ok(s.relayOn, "restart after 60 min");

  // no schedules: manual run, 6 h rule, resume
  OxyConfig c4 = {false, true, 30, 0, {}};
  oxyInit(s); epoch = 10 * 3600; oxyManual(s, true);
  run(c4, s, epoch, 361); ok(s.resting, "manual run rests after 6 h");
  run(c4, s, epoch, 31);  ok(s.relayOn, "manual run resumes after rest");

  // manual OFF inside a window is respected until the next boundary
  oxyInit(s); epoch = 19 * 3600; run(c, s, epoch, 1); ok(s.relayOn, "catch-up start inside window after boot");
  oxyManual(s, false); run(c, s, epoch, 120); ok(!s.relayOn, "manual OFF is not overridden inside the window");

  // cooldown disabled
  OxyConfig c5 = {false, false, 30, 0, {}};
  oxyInit(s); epoch = 0; oxyManual(s, true); run(c5, s, epoch, 400); ok(s.relayOn && !s.resting, "no rest when cooldown is disabled");

  // clock not set: schedules skipped, protection still works
  oxyInit(s); epoch = 18 * 3600 + 60; run(c, s, epoch, 10, false); ok(!s.relayOn, "no schedule start while clock is invalid");

  // settings text from the worker
  OxyConfig pc;
  ok(oxyParseConfig("1,1,45;1,1080,590,30;0,0,360,0", pc), "parse worker cfg");
  ok(pc.scheduleEnabled && pc.cooldownEnabled && pc.defaultRestMinutes == 45 && pc.count == 2, "cfg header");
  ok(pc.items[0].enabled && pc.items[0].startMin == 1080 && pc.items[0].stopMin == 590 && pc.items[0].restMinutes == 30, "cfg overnight schedule");
  ok(!pc.items[1].enabled, "cfg paused schedule");
  ok(oxyParseConfig("0,1,30", pc) && pc.count == 0 && !pc.scheduleEnabled, "cfg with no schedules");
  OxyConfig keep = pc;
  ok(!oxyParseConfig("1,1;x", pc) && !oxyParseConfig("", pc) && !oxyParseConfig("1,1,30;1,2000,10,30", pc), "bad cfg rejected");
  ok(pc.defaultRestMinutes == keep.defaultRestMinutes && pc.count == keep.count, "bad cfg leaves old settings");
  // old overlapping data: longest rest wins (same as app)
  oxyParseConfig("1,1,30;1,1080,590,30;1,360,1110,90", pc);
  ok(oxyRestMinutes(pc, 7 * 60) == 90, "overlap: longest rest");

  printf("\nTOTAL %d | PASSED %d | FAILED %d\n", pass + fail, pass, fail);
  return fail ? 1 : 0;
}
