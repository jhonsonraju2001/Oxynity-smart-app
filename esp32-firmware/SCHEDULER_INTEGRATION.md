# Oxynity firmware v1.7 – on-device scheduler (DONE in esp32-sim900a-firmware.ino)

The SIM900A firmware now runs schedules, the 6-hour run / rest cycle and run hours on the machine.
They work with every phone closed. **Not yet tested on a real machine: flash the Bhimavaram demo unit first.**

## Files
- `esp32-sim900a-firmware.ino` – firmware v1.7 (put `oxynity_scheduler.h` in the same folder)
- `oxynity_scheduler.h` – scheduler logic (no hardware code)
- `test/run_tests.sh` – PC tests: 32 scheduler tests + 13 firmware simulation tests (`g++` only)

## How it works
1. Every sync (30 s, or 5 s after the relay changed) the worker reply contains
   - `t`   – server time (unix seconds). Until it arrives, schedules wait; the 6 h rest still works.
   - `cfg` – `"scheduleEnabled,cooldownEnabled,defaultRest;enabled,startMin,stopMin,rest;..."` (minutes from midnight, IST)
   - `trh` – lifetime run hours in the cloud (taken over once, so hours are not reset).
2. Settings and state are saved in NVS (`Preferences` namespace `oxy`): a power cut loses nothing.
3. Every 10 s `schedulerTick()` decides ON / OFF (start at start time, stop at stop time, rest after 6 h,
   restart after the rest only if a schedule is still open, catch-up after a reboot inside a window).
4. A start/stop the machine decides itself is sent once: `triggerSource` (SCHEDULE / REST), `status`,
   `runEvent` (START / STOP), `runReason`, `durationSec`. The worker saves the status and a run-history record.
5. App ON/OFF and the panel buttons are a manual choice that holds until the next schedule start/stop time.
6. Every sync also sends `firmwareScheduler: true`, `fwVersion`, `isCoolingDown`, `cooldownEndsAt`,
   `continuousRunSeconds`, `totalRunHours`. When the app sees `firmwareScheduler`, it stops its own timers.

## Also changed
- Heartbeat 30 s instead of 6 s (5x fewer Firestore writes). Change `CYCLE_INTERVAL_MS` if needed.
- `gprsLocationFixed` / `latitude` / `longitude` are sent only for the modem's own fix (AT+CIPGSMLOC).
  The server's coordinates and the 16.5787, 82.0061 placeholder are never sent back as a position.
- `readExtraSensors()`: fill in when pH / ORP / temperature / salinity probes are fitted. Send RAW values as
  `phLevel`, `orpLevel`, `waterTemp`, `salinity`; calibration is done in the app (Sensor setup step 3).

## Requires
The updated Cloudflare worker (`cloudflare-worker/worker.js`) must be deployed **before** flashing v1.7.
An old worker sends no `t` / `cfg`: the machine then never runs schedules (the 6 h rest still works).

## Not changed
`esp32-firmware.ino` (Wi-Fi version) and the other sketches are still the original versions.
Port the same changes there if Wi-Fi units are used.
