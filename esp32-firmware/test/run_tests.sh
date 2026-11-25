#!/bin/sh
# PC tests (no ESP32 needed): scheduler logic + firmware v1.7 glue with stand-in Arduino APIs.
set -e
cd "$(dirname "$0")"
g++ -std=c++17 -Wall ../test_scheduler.cpp -o /tmp/oxy_sched && /tmp/oxy_sched | tail -1
sed -e 's|#include <HardwareSerial.h>||' -e 's|#include <Preferences.h>||' \
    -e 's|#include "oxynity_scheduler.h"|#include "../oxynity_scheduler.h"|' ../esp32-sim900a-firmware.ino > fw.cpp
g++ -std=gnu++17 -w sim_firmware.cpp -o /tmp/oxy_fw && /tmp/oxy_fw | tail -1
rm -f fw.cpp
