# Oxynity Smart - ESP32 Hardware Integration Guide

This directory contains the production-ready firmware files for the **Oxynity Smart Aquaculture Hardware Controller** (ESP32 DevKit V1).

---

## 📁 Firmware Options

| Firmware File | Purpose | When to Use |
| :--- | :--- | :--- |
| **`esp32-sequential-generator-buttons.ino`** *(Recommended)* | **Dedicated 1-Button 4-Minute Sequential Start + Manual Push Buttons** | Use for your machine control box. Has zero sensor overhead, 100% non-blocking execution, and works standalone. |
| **`esp32-firmware.ino`** | **Wi-Fi Cloud Connected Firmware** | Connects to farm Wi-Fi / Hotspot for remote control via the Oxynity Web & Mobile App + 4-min sequence + manual buttons. |
| **`esp32-sim900a-firmware.ino`** | **Pure 2G SIM900A GPRS Cellular Firmware** | Uses a SIM card for remote GSM cloud telemetry & live tower tracking + 4-min sequence + manual buttons. |

---

## ⚙️ 1-Button 4-Minute Sequential Operation Logic

### 🚀 Generator START (Single Action Trigger):
Triggered by:
- Pressing the **Physical Green Push Button** on the machine control panel, OR
- Tapping **"Generator ON"** in the Oxynity App, OR
- Typing `START` in the Arduino Serial Monitor.

**Sequence Execution:**
1. **Relay 1 (Main Generator / Water Intake Pump)** turns **ON IMMEDIATELY**.
2. **Relay 2 (Secondary Aerator / Booster)** remains **OFF**.
3. A **4-Minute (240 seconds)** non-blocking timer runs in the background.
4. The Onboard Status LED blinks at 2 Hz during the 4-minute delay.
5. Exactly after **4 minutes**, **Relay 2 turns ON AUTOMATICALLY**.
6. Both Relay 1 and Relay 2 run simultaneously. The Status LED turns solid ON.

### 🛑 Generator STOP / Emergency Shutoff:
Triggered by:
- Pressing the **Physical Red Push Button**, OR
- Tapping **"Generator OFF"** in the Oxynity App, OR
- Typing `STOP` in the Arduino Serial Monitor.

**Sequence Execution:**
1. **Relay 1** turns **OFF IMMEDIATELY**.
2. **Relay 2** turns **OFF IMMEDIATELY**.
3. Any pending 4-minute countdown timer is **cancelled**.
4. Both machine running LEDs turn OFF.

---

## 🔘 Physical Manual Push Buttons (Zero-Lag Standalone Operation)

When automation or internet is down, the manual push buttons provide **100% reliable local control**:
- Uses ESP32 internal `INPUT_PULLUP` resistors (no external resistors needed).
- Industrial 50ms software debouncing eliminates false electrical triggers.
- Interrupt-free non-blocking polling responds within milliseconds even during network reconnects.

### Wiring the XB2 Push Buttons (As Shown in Your Photo):
- **GREEN Button (XB2 NO - Normally Open, Terminals .3 & .4)**:
  - Terminal `.3` (or screw terminal 1) $\rightarrow$ **ESP32 GPIO 32**
  - Terminal `.4` (or screw terminal 2) $\rightarrow$ **ESP32 GND**
  - When pressed, it closes the contact to GND and triggers the **START** sequence.
- **RED Button (XB2 NC - Normally Closed, Terminals .1 & .2)**:
  - Terminal `.1` (or screw terminal 1) $\rightarrow$ **ESP32 GPIO 33**
  - Terminal `.2` (or screw terminal 2) $\rightarrow$ **ESP32 GND**
  - In normal running position, it holds GND (`LOW`). When pressed, it breaks the connection (`HIGH`), immediately triggering **STOP / Emergency Shutoff**. If a wire is accidentally cut or unplugged, it also fails-safe and stops the machine automatically.

---

## 🔌 Hardware Connection Map (ESP32 30-Pin / 38-Pin DevKit)

```
                     +-----------------------+
                     |      ESP32 DevKit     |
                     |                       |
   [2-CH RELAY]      |                       |   [PUSH BUTTONS]
   IN 1 (Relay 1) <--| GPIO 27       GPIO 32 |<-- GREEN BUTTON (Terminal 1)
   IN 2 (Relay 2) <--| GPIO 26       GPIO 33 |<-- RED BUTTON   (Terminal 1)
   GND            <--| GND               GND |---> COMMON GND  (Both Buttons Terminal 2)
   VCC (External) <--| 5V Power Supply       |
                     |                       |   [LEDS]
                     | GPIO 2                |---> Built-in Blue LED (Status / Blink)
                     | GPIO 25               |---> External Green LED (Running Indication)
                     +-----------------------+
```

| Component | Pin on Component | ESP32 GPIO Pin | Description / Electrical Notes |
| :--- | :--- | :--- | :--- |
| **Relay 1 (Generator / Intake)** | `IN 1` | **`GPIO 27`** | Primary micro-nano bubble generator power relay (Active LOW) |
| **Relay 2 (Aerator / Booster)** | `IN 2` | **`GPIO 26`** | Secondary aeration pump (turns ON automatically 4 mins after Relay 1) |
| **Relay Module Power** | `VCC` | **External 5V DC (+)** | Provide clean 5V DC from a power supply |
| **Relay Module Ground** | `GND` | **ESP32 GND & Power (-)** | **Common Ground (Must connect together!)** |
| **Green Push Button (START)** | Pin 1 & Pin 2 | **`GPIO 32` & `GND`** | Momentary push-to-make. Pulls GPIO 32 LOW when pressed |
| **Red Push Button (STOP)** | Pin 1 & Pin 2 | **`GPIO 33` & `GND`** | Momentary push-to-make. Pulls GPIO 33 LOW when pressed |
| **Status LED** | Onboard | **`GPIO 2`** | Blinks during 4-min delay, Solid when running |
| **Machine State LED** | Anode (+) | **`GPIO 25`** | Optional external 5mm green LED (with 220Ω resistor to GND) |

---

## 💻 Upload Instructions (Arduino IDE)

1. Connect your ESP32 to your computer via micro-USB.
2. In Arduino IDE:
   - Select **Tools > Board > ESP32 Arduino > ESP32 Dev Module**.
   - Select the correct COM Port (**Tools > Port**).
3. Open `esp32-firmware/esp32-sequential-generator-buttons.ino`.
4. Click **Upload** (Ctrl + U).
5. Open **Serial Monitor** at **115200 baud**.
6. Press the **Green Button** $\rightarrow$ Observe Relay 1 click ON immediately and the 4-minute countdown begin!
7. After 4 minutes $\rightarrow$ Observe Relay 2 click ON automatically!
8. Press the **Red Button** at any time $\rightarrow$ Both relays click OFF immediately.

### Bench Test Shortcut
In `esp32-sequential-generator-buttons.ino`:
```cpp
#define BENCH_TEST_FAST_MODE  true  // Changes delay from 4 mins to 10 seconds for bench testing
```
Set to `false` when ready for actual pond installation.
