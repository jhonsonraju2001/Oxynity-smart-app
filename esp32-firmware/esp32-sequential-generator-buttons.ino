/**
 * ==============================================================================
 * Oxynity Smart - ESP32 SEQUENTIAL GENERATOR & MANUAL PUSH BUTTON CONTROLLER
 * ==============================================================================
 * 
 * OPERATIONAL LOGIC:
 *  1. One-Button / Single Trigger Start:
 *     - When "Generator ON" is triggered (via Green Push Button, App, or Serial):
 *       -> Relay 1 (Main Generator / Pump) turns ON IMMEDIATELY.
 *       -> Relay 2 remains OFF.
 *       -> A 2-minute non-blocking countdown begins (120 seconds).
 *       -> Exactly after 2 minutes, Relay 2 (Secondary Aerator / Bubble Booster)
 *          turns ON AUTOMATICALLY.
 *       -> Both Relay 1 and Relay 2 continue running together.
 * 
 *  2. Manual Push Buttons (Work 100% Standalone & Even if Cloud/Automation Fails):
 *     - GREEN Push Button (GPIO 32) : Manual START (Starts the 1-button 2-min sequence).
 *     - RED Push Button   (GPIO 33) : Manual STOP / EMERGENCY SHUTOFF (Instantly turns
 *                                     OFF both Relay 1 & Relay 2 and aborts any timer).
 * 
 *  3. Sensors:
 *     - DO and water sensors are disabled for now as requested, keeping code
 *       ultra-light, ultra-reliable, and deterministic with zero delays.
 * 
 * ==============================================================================
 * HARDWARE PIN CONNECTIONS (ESP32 30-PIN / 38-PIN DEVKIT V1)
 * ==============================================================================
 * 
 *  [RELAY MODULE (2-Channel 5V Relay with Optocoupler)]
 *   - VCC      -> External 5V DC Power (+)
 *   - GND      -> External Power GND & ESP32 GND (Common Ground!)
 *   - IN 1     -> ESP32 GPIO 27 (Relay 1: Main Generator)
 *   - IN 2     -> ESP32 GPIO 26 (Relay 2: Secondary Aerator / Booster)
 * 
 *  [PHYSICAL MANUAL PUSH BUTTONS (Momentary Normally-Open Tactile / Industrial Buttons)]
 *   - GREEN BUTTON (START):
 *       -> Terminal 1 -> ESP32 GPIO 32
 *       -> Terminal 2 -> ESP32 GND (Uses internal INPUT_PULLUP, no external resistor needed!)
 *   - RED BUTTON (STOP / EMERGENCY):
 *       -> Terminal 1 -> ESP32 GPIO 33
 *       -> Terminal 2 -> ESP32 GND (Uses internal INPUT_PULLUP, no external resistor needed!)
 * 
 *  [STATUS INDICATOR LEDS]
 *   - Onboard Blue LED   -> GPIO 2  (Blinks during 4-min delay, Solid when both ON)
 *   - Machine Run LED    -> GPIO 25 (Green external LED with 220Ω resistor to GND)
 * ==============================================================================
 */

#include <Arduino.h>

// ==============================================================================
// 1. PIN DEFINITIONS
// ==============================================================================
const int PIN_RELAY_1      = 27;  // Relay 1 (Main Bubble Generator / Water Intake)
const int PIN_RELAY_2      = 26;  // Relay 2 (Secondary Aerator / Booster)

const int PIN_BTN_START    = 32;  // GREEN Push Button (Momentary, connects to GND)
const int PIN_BTN_STOP     = 33;  // RED Push Button   (Momentary, connects to GND)

const int PIN_LED_STATUS   =  2;  // Built-in Blue LED (Blink = Countdown, Solid = Running)
const int PIN_LED_MACHINE  = 25;  // Optional External Machine Green LED (Set to -1 if unused)

// Set to true for standard Active-LOW 5V relay boards (most common blue Songle relays)
// Set to false if your relay module is Active-HIGH
#define RELAY_ACTIVE_LOW   true

// ==============================================================================
// XB2 INDUSTRIAL BUTTON CONTACT POLARITY (Matches your XB2 Buttons in Picture!)
// ==============================================================================
// GREEN BUTTON: Has XB2 1NO contact block (Terminals .3 and .4):
//   - Released = Open Circuit (reads HIGH via INPUT_PULLUP)
//   - Pressed  = Closed to GND (reads LOW) -> Triggers START!
#define GREEN_BTN_NORMALLY_OPEN   true

// RED BUTTON: Has XB2 1NC contact block (Terminals .1 and .2):
//   - Released = Closed to GND (reads LOW in normal operation)
//   - Pressed  = Circuit Opens (reads HIGH via INPUT_PULLUP) -> Triggers STOP!
//   - Wire cut / disconnected = Fails safe and STOPS the aerators immediately!
// Set to true for standard industrial XB2 NC Red buttons (as shown in your picture).
// If you ever swap the block to an NO block, set this to false.
#define RED_BTN_NORMALLY_CLOSED   true

// ==============================================================================
// 2. TIMING CONFIGURATION
// ==============================================================================
// Delay between Relay 1 ON and Relay 2 ON: 2 minutes = 120,000 milliseconds
const unsigned long RELAY_2_DELAY_MS = 2UL * 60UL * 1000UL; // 120,000 ms (2 minutes)

// Debounce interval for push buttons (eliminates mechanical contact bounce)
const unsigned long DEBOUNCE_DELAY_MS = 50;

// Bench Test Mode: Set to true if you want 10 seconds delay instead of 2 mins for quick bench testing!
#define BENCH_TEST_FAST_MODE  false
const unsigned long ACTIVE_DELAY_MS = BENCH_TEST_FAST_MODE ? (10UL * 1000UL) : RELAY_2_DELAY_MS;

// ==============================================================================
// 3. SYSTEM STATE MACHINE
// ==============================================================================
enum MachineState {
  STATE_IDLE,                 // Both Relays OFF, waiting for Start trigger
  STATE_STAGE1_COUNTDOWN,     // Relay 1 ON, Relay 2 waiting for 2-minute timer
  STATE_STAGE2_FULL_RUNNING   // Both Relay 1 and Relay 2 ON simultaneously
};

MachineState currentState = STATE_IDLE;

// Timing counters (100% non-blocking using millis())
unsigned long sequenceStartTime   = 0;
unsigned long sessionTotalSeconds = 0;
unsigned long lastSecondTickMs    = 0;
unsigned long lastLedBlinkMs      = 0;
bool          statusLedBlinkState = false;

// Button debouncing state
int lastStartBtnReading = HIGH;
int startBtnState       = HIGH;
unsigned long lastStartDebounceTime = 0;

int lastStopBtnReading  = HIGH;
int stopBtnState        = HIGH;
unsigned long lastStopDebounceTime  = 0;

// ==============================================================================
// 4. LOW-LEVEL RELAY DRIVERS
// ==============================================================================
void writeRelay(int pin, bool turnOn) {
  bool level;
  if (RELAY_ACTIVE_LOW) {
    level = turnOn ? LOW : HIGH;
  } else {
    level = turnOn ? HIGH : LOW;
  }
  digitalWrite(pin, level);
}

void setMachineLeds(bool isRunning, bool isBlinking) {
  if (PIN_LED_MACHINE >= 0) {
    digitalWrite(PIN_LED_MACHINE, isRunning ? HIGH : LOW);
  }

  if (!isRunning) {
    digitalWrite(PIN_LED_STATUS, LOW);
  } else if (!isBlinking) {
    digitalWrite(PIN_LED_STATUS, HIGH);
  }
}

// ==============================================================================
// 5. HIGH-LEVEL GENERATOR ACTIONS (ONE-BUTTON CONTROL)
// ==============================================================================

/**
 * Starts the generator sequence:
 *  - Relay 1 ON immediately.
 *  - Begins 2-minute non-blocking countdown for Relay 2.
 */
void startGeneratorSequence(const char* triggerSource) {
  if (currentState != STATE_IDLE) {
    Serial.println(F("[Generator] ⚠️ Already running or staging! Ignoring duplicate START."));
    return;
  }

  Serial.println(F("\n============================================================"));
  Serial.printf("[Generator] 🚀 START COMMAND RECEIVED (Trigger: %s)\n", triggerSource);
  Serial.println(F("============================================================"));

  // 1. Turn Relay 1 ON immediately
  writeRelay(PIN_RELAY_1, true);
  writeRelay(PIN_RELAY_2, false);

  // 2. Start non-blocking timer
  sequenceStartTime   = millis();
  sessionTotalSeconds = 0;
  lastSecondTickMs    = millis();
  currentState        = STATE_STAGE1_COUNTDOWN;

  setMachineLeds(true, true);

  Serial.println(F("[Relay 1] ⚡ MAIN GENERATOR / PUMP -> TURNED ON [IMMEDIATE]"));
  Serial.printf("[Relay 2] ⏳ Timer started: Relay 2 will turn ON in %lu seconds (2 mins)...\n", ACTIVE_DELAY_MS / 1000UL);
}

/**
 * Emergency / Manual Stop:
 *  - Instantly shuts off Relay 1 and Relay 2.
 *  - Cancels any pending countdown timer.
 */
void stopGeneratorSequence(const char* triggerSource) {
  Serial.println(F("\n------------------------------------------------------------"));
  Serial.printf("[Generator] 🛑 STOP COMMAND RECEIVED (Trigger: %s)\n", triggerSource);
  Serial.println(F("------------------------------------------------------------"));

  // 1. Immediately kill both relays
  writeRelay(PIN_RELAY_1, false);
  writeRelay(PIN_RELAY_2, false);

  // 2. Reset state machine
  currentState        = STATE_IDLE;
  sequenceStartTime   = 0;
  sessionTotalSeconds = 0;

  setMachineLeds(false, false);

  Serial.println(F("[Relay 1] 🛑 TURNED OFF"));
  Serial.println(F("[Relay 2] 🛑 TURNED OFF"));
  Serial.println(F("[System]  STATUS: IDLE (Safe / Standby Mode)\n"));
}

// ==============================================================================
// 6. BUTTON HANDLER (NON-BLOCKING DEBOUNCED MOMENTARY SWITCHES)
// ==============================================================================
void handleManualButtons() {
  unsigned long now = millis();

  // --------------------------------------------------------------------------
  // A. GREEN BUTTON (START SEQUENCE - XB2 Normally Open NO .3 - .4)
  // --------------------------------------------------------------------------
  int startReading = digitalRead(PIN_BTN_START);

  if (startReading != lastStartBtnReading) {
    lastStartDebounceTime = now;
  }

  if ((now - lastStartDebounceTime) > DEBOUNCE_DELAY_MS) {
    if (startReading != startBtnState) {
      startBtnState = startReading;

      // When pressed, NO contact connects to GND -> reads LOW
      bool isGreenPressed = (startBtnState == LOW);
      if (isGreenPressed) {
        Serial.println(F("\n[Button] 🟢 GREEN Push Button Pressed (NO Closed)!"));
        startGeneratorSequence("Manual Green Push Button");
      }
    }
  }
  lastStartBtnReading = startReading;

  // --------------------------------------------------------------------------
  // B. RED BUTTON (STOP / EMERGENCY SHUTOFF - XB2 Normally Closed NC .1 - .2)
  // --------------------------------------------------------------------------
  int stopReading = digitalRead(PIN_BTN_STOP);

  if (stopReading != lastStopBtnReading) {
    lastStopDebounceTime = now;
  }

  if ((now - lastStopDebounceTime) > DEBOUNCE_DELAY_MS) {
    if (stopReading != stopBtnState) {
      stopBtnState = stopReading;

      // With NC contact block:
      //  - Normal released state: Connected to GND -> reads LOW
      //  - Pushed down (or wire disconnected): Contact opens -> reads HIGH
      // With NO contact block:
      //  - Pushed down: connects to GND -> reads LOW
      bool isRedPressed = RED_BTN_NORMALLY_CLOSED ? (stopBtnState == HIGH) : (stopBtnState == LOW);

      if (isRedPressed) {
        Serial.println(F("\n[Button] 🔴 RED Push Button Pressed (NC Opened - Emergency Stop)!"));
        stopGeneratorSequence("Manual Red Push Button");
      }
    }
  }
  lastStopBtnReading = stopReading;
}

// ==============================================================================
// 7. SEQUENTIAL TIMING & STATE CONTROLLER (NON-BLOCKING)
// ==============================================================================
void handleSequenceTimer() {
  unsigned long now = millis();

  // Handle runtime session seconds ticking
  if (currentState != STATE_IDLE) {
    if (now - lastSecondTickMs >= 1000UL) {
      lastSecondTickMs += 1000UL;
      sessionTotalSeconds++;

      // Print status updates during 2-min countdown
      if (currentState == STATE_STAGE1_COUNTDOWN) {
        unsigned long elapsedMs = now - sequenceStartTime;
        if (elapsedMs < ACTIVE_DELAY_MS) {
          unsigned long remainingSecs = (ACTIVE_DELAY_MS - elapsedMs + 999UL) / 1000UL;
          
          // Print countdown every 30 seconds or in the final 10 seconds
          if (remainingSecs % 30 == 0 || remainingSecs <= 10) {
            Serial.printf("[Countdown] ⏱️ Relay 2 starting in %lu seconds... (Relay 1 is RUNNING)\n", remainingSecs);
          }
        }
      }
    }
  }

  // Handle State 1 -> State 2 Transition after 2 minutes
  if (currentState == STATE_STAGE1_COUNTDOWN) {
    // Blink Status LED while waiting (rapid 2Hz blink: 250ms toggle)
    if (now - lastLedBlinkMs >= 250UL) {
      lastLedBlinkMs = now;
      statusLedBlinkState = !statusLedBlinkState;
      digitalWrite(PIN_LED_STATUS, statusLedBlinkState ? HIGH : LOW);
    }

    // Check if 2 minutes have elapsed
    if (now - sequenceStartTime >= ACTIVE_DELAY_MS) {
      currentState = STATE_STAGE2_FULL_RUNNING;

      // 2 minutes elapsed: Turn Relay 2 ON automatically!
      writeRelay(PIN_RELAY_2, true);

      // Solid Status LED
      digitalWrite(PIN_LED_STATUS, HIGH);

      Serial.println(F("\n============================================================"));
      Serial.println(F("[Relay 2] ⚡ 2 MINUTES ELAPSED -> SECONDARY RELAY TURNED ON!"));
      Serial.println(F("[System]  🎉 BOTH RELAY 1 & RELAY 2 ARE NOW FULLY ACTIVE!"));
      Serial.println(F("============================================================\n"));
    }
  }
}

// ==============================================================================
// 8. SERIAL COMMAND CONSOLE (TEST VIA ARDUINO SERIAL MONITOR)
// ==============================================================================
void handleSerialCommands() {
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();

    if (cmd == "START" || cmd == "ON" || cmd == "1") {
      startGeneratorSequence("Serial Command (START)");
    } else if (cmd == "STOP" || cmd == "OFF" || cmd == "0") {
      stopGeneratorSequence("Serial Command (STOP)");
    } else if (cmd == "STATUS") {
      Serial.println(F("\n--- CURRENT MACHINE STATUS ---"));
      if (currentState == STATE_IDLE) {
        Serial.println(F("Status: OFF / IDLE"));
        Serial.println(F("Relay 1: OFF | Relay 2: OFF"));
      } else if (currentState == STATE_STAGE1_COUNTDOWN) {
        unsigned long rem = (ACTIVE_DELAY_MS - (millis() - sequenceStartTime)) / 1000UL;
        Serial.println(F("Status: STAGE 1 (Relay 1 ON, Waiting for Relay 2)"));
        Serial.printf("Relay 1: ON | Relay 2: OFF (Starts in %lu sec)\n", rem);
        Serial.printf("Total Session: %lu seconds\n", sessionTotalSeconds);
      } else if (currentState == STATE_STAGE2_FULL_RUNNING) {
        Serial.println(F("Status: STAGE 2 (Full Operation)"));
        Serial.println(F("Relay 1: ON | Relay 2: ON (Both running simultaneously)"));
        Serial.printf("Total Session: %lu seconds\n", sessionTotalSeconds);
      }
      Serial.println(F("------------------------------\n"));
    } else if (cmd == "HELP") {
      Serial.println(F("\nAvailable Commands:"));
      Serial.println(F("  START  - Turn Generator ON (Relay 1 immediately, Relay 2 in 2 mins)"));
      Serial.println(F("  STOP   - Turn Generator OFF (Both Relays shut off immediately)"));
      Serial.println(F("  STATUS - Print live relay states and elapsed session time"));
      Serial.println(F("  HELP   - Show this help menu\n"));
    }
  }
}

// ==============================================================================
// 9. SETUP & INITIALIZATION
// ==============================================================================
void setup() {
  // Initialize Serial Monitor
  Serial.begin(115200);
  delay(500);

  Serial.println(F("\n\n============================================================"));
  Serial.println(F("  OXYNITY SMART - SEQUENTIAL GENERATOR & BUTTON CONTROLLER  "));
  Serial.println(F("============================================================"));
  Serial.println(F("Firmware Version : v3.2.0-SEQUENTIAL-2MIN"));
  Serial.printf( "Relay 2 Delay    : %lu ms (%lu minutes)\n", ACTIVE_DELAY_MS, ACTIVE_DELAY_MS / 60000UL);
  Serial.printf( "Relay Logic      : Active %s\n", RELAY_ACTIVE_LOW ? "LOW" : "HIGH");
  Serial.println(F("============================================================\n"));

  // Configure Relay Pins as OUTPUT
  pinMode(PIN_RELAY_1, OUTPUT);
  pinMode(PIN_RELAY_2, OUTPUT);

  // Configure Status LEDs
  pinMode(PIN_LED_STATUS, OUTPUT);
  if (PIN_LED_MACHINE >= 0) {
    pinMode(PIN_LED_MACHINE, OUTPUT);
  }

  // Ensure Relays and LEDs start in OFF state
  writeRelay(PIN_RELAY_1, false);
  writeRelay(PIN_RELAY_2, false);
  setMachineLeds(false, false);

  // Configure Manual Push Buttons with internal Pullup resistors
  pinMode(PIN_BTN_START, INPUT_PULLUP);
  pinMode(PIN_BTN_STOP,  INPUT_PULLUP);

  // Read initial stable states
  startBtnState       = digitalRead(PIN_BTN_START);
  lastStartBtnReading = startBtnState;
  stopBtnState        = digitalRead(PIN_BTN_STOP);
  lastStopBtnReading  = stopBtnState;

  Serial.println(F("[Hardware] Pin Mapping Initialized:"));
  Serial.printf("  • Relay 1 (Main Generator) : GPIO %d\n", PIN_RELAY_1);
  Serial.printf("  • Relay 2 (Secondary Pump) : GPIO %d\n", PIN_RELAY_2);
  Serial.printf("  • Green Push Button (START): GPIO %d (XB2 NO .3-.4 -> GND)\n", PIN_BTN_START);
  Serial.printf("  • Red Push Button (STOP)   : GPIO %d (XB2 NC .1-.2 -> GND)\n", PIN_BTN_STOP);
  Serial.printf("  • Onboard Status LED       : GPIO %d\n", PIN_LED_STATUS);
  Serial.println(F("\n[Ready] System standing by. Press Green button or send 'START' in Serial!\n"));
}

// ==============================================================================
// 10. MAIN NON-BLOCKING EXECUTION LOOP
// ==============================================================================
void loop() {
  // 1. Poll Physical Push Buttons (Instant response, zero lag)
  handleManualButtons();

  // 2. Manage 4-Minute Sequential Countdown & Relay 2 Transition
  handleSequenceTimer();

  // 3. Listen for Serial Commands from Computer / Console
  handleSerialCommands();

  // Ultra-short 5ms yield to prevent CPU starvation and watchdog triggers
  delay(5);
}
