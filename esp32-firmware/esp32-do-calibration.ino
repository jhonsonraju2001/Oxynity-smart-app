/**
 * ==============================================================================
 * Oxynity Smart - High-Precision Dissolved Oxygen (DO) Sensor Calibration Tool
 * ==============================================================================
 * 
 * Target: ESP32 (30-pin NodeMCU / DevKit V1)
 * DO Sensor Pin: GPIO 34 (ADC1_CH6 - Input Only, ultra low noise)
 * 
 * WHY DID THE READING NOT RISE AS MUCH IN 1-POINT CALIBRATION?
 * ------------------------------------------------------------------------------
 * Almost all analog DO probes and amplifier boards have a hardware zero offset 
 * (typically 200mV - 350mV when DO = 0 mg/L). 
 * 
 * When you only calibrate at 1 point with CAL 4.6, the ESP32 assumed the zero 
 * offset was 0.00 mV. That cut the slope sensitivity in half!
 * 
 * BY DOING 2-POINT CALIBRATION:
 * 1. You calibrated at Point 1: 4.60 mg/L (Voltage ~573 mV).
 * 2. When your Digital DO Meter rises to another reading (e.g. 4.90 mg/L, 5.5 mg/L, etc.),
 *    gently stir the probe in the water and type:
 *       POINT2 4.90
 *    (replace 4.90 with your digital meter's current reading).
 * 3. The ESP32 instantly calculates the TRUE zero offset and TRUE slope!
 *    Now the serial monitor will track your digital DO meter with 100% accuracy!
 * 
 * AVAILABLE SERIAL COMMANDS:
 * ------------------------------------------------------------------------------
 *  CAL <value>     -> Set Point 1 (e.g. CAL 4.60)
 *  POINT2 <value>  -> Set Point 2 from Digital Meter (e.g. POINT2 4.90)
 *  ZERO            -> Set Zero Baseline (put probe in 0 mg/L solution)
 *  OFFSET <mv>     -> Manually set zero offset in mV (e.g. OFFSET 250)
 *  RESET           -> Reset to factory defaults
 *  INFO            -> Show current calibration parameters
 *  HELP            -> Show command list
 * ==============================================================================
 */

#include <Arduino.h>
#include <Preferences.h>

// ==============================================================================
// 1. PIN DEFINITIONS & SAMPLING CONSTANTS
// ==============================================================================
#define DO_PIN              34      // Analog DO probe signal (ESP32 ADC1 GPIO 34)
#define NUM_SAMPLES         30      // 30-sample trimmed-mean filter
#define SAMPLE_DELAY_MS     4       // 4ms per sample (~120ms total read time)
#define ESP32_VREF_MV       3300.0f // ESP32 3.3V reference (millivolts)
#define ADC_MAX_COUNT       4095.0f // 12-bit ADC

// ==============================================================================
// 2. CALIBRATION CONSTANTS & STORAGE
// ==============================================================================
Preferences prefs;
const char* PREF_NAMESPACE  = "oxynity_do";

// Point 1 (Base Calibration)
float pt1VoltageMv          = 573.0f;
float pt1DoMgL              = 4.60f;

// Point 2 (Second Calibration for true slope)
float pt2VoltageMv          = 592.0f;
float pt2DoMgL              = 4.90f;
bool  hasPoint2             = false;

// Computed Linear Calibration: DO = slopeK * (V - zeroVoltageMv)
float zeroVoltageMv         = 0.0f;     // Voltage at 0.0 mg/L
float slopeK                = 0.00803f; // mg/L per mV
bool  isCalibrated          = false;

// Live measurement state
float liveVoltageMv         = 0.0f;
int   liveRawAdc            = 0;
float liveDoMgL             = 0.0f;
unsigned long lastPrintMs   = 0;

// ==============================================================================
// 3. NOISE REJECTION & ADC OVERSAMPLING FILTER
// ==============================================================================
float readFilteredVoltageMv(int &rawMedian) {
  int samples[NUM_SAMPLES];

  for (int i = 0; i < NUM_SAMPLES; i++) {
    samples[i] = analogRead(DO_PIN);
    delay(SAMPLE_DELAY_MS);
  }

  // Insertion sort
  for (int i = 1; i < NUM_SAMPLES; i++) {
    int key = samples[i];
    int j = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }

  rawMedian = samples[NUM_SAMPLES / 2];

  // Trim lowest 6 and highest 6, average center 18
  long sum = 0;
  int count = 0;
  for (int i = 6; i < NUM_SAMPLES - 6; i++) {
    sum += samples[i];
    count++;
  }

  float avgRaw = (float)sum / (float)count;
  return (avgRaw / ADC_MAX_COUNT) * ESP32_VREF_MV;
}

// ==============================================================================
// 4. DO CALCULATION FORMULA
// ==============================================================================
float calculateDo(float voltageMv) {
  if (voltageMv <= zeroVoltageMv) {
    return 0.0f;
  }
  float doValue = slopeK * (voltageMv - zeroVoltageMv);
  return constrain(doValue, 0.0f, 25.0f);
}

void recalculateCurve() {
  if (hasPoint2 && fabs(pt2VoltageMv - pt1VoltageMv) > 5.0f && fabs(pt2DoMgL - pt1DoMgL) > 0.05f) {
    // 2-Point Linear Curve:
    // slopeK = (DO2 - DO1) / (V2 - V1)
    slopeK = (pt2DoMgL - pt1DoMgL) / (pt2VoltageMv - pt1VoltageMv);
    
    // zeroVoltageMv = V1 - (DO1 / slopeK)
    zeroVoltageMv = pt1VoltageMv - (pt1DoMgL / slopeK);
    if (zeroVoltageMv < 0.0f) zeroVoltageMv = 0.0f; // zero voltage cannot be negative
    if (zeroVoltageMv > pt1VoltageMv - 50.0f) zeroVoltageMv = pt1VoltageMv - 50.0f;
    isCalibrated = true;
  } else {
    // 1-Point Fallback:
    float deltaV = pt1VoltageMv - zeroVoltageMv;
    if (deltaV <= 10.0f) deltaV = 573.0f;
    slopeK = pt1DoMgL / deltaV;
  }
}

// ==============================================================================
// 5. FLASH MEMORY (NVS) MANAGEMENT
// ==============================================================================
void loadCalibrationFromFlash() {
  prefs.begin(PREF_NAMESPACE, true);
  zeroVoltageMv  = prefs.getFloat("zero_mv", 0.0f);
  pt1VoltageMv   = prefs.getFloat("cal_mv", 572.93f);
  pt1DoMgL       = prefs.getFloat("ref_do", 4.60f);
  slopeK         = prefs.getFloat("slope_k", 0.00803f);
  hasPoint2      = prefs.getBool("has_pt2", false);
  pt2VoltageMv   = prefs.getFloat("pt2_v", 0.0f);
  pt2DoMgL       = prefs.getFloat("pt2_do", 0.0f);
  isCalibrated   = prefs.getBool("is_cal", false);
  prefs.end();

  if (slopeK <= 0.0001f) {
    recalculateCurve();
  }

  Serial.println("\n--------------------------------------------------------------");
  Serial.println("[NVS] Loaded Calibration Settings:");
  Serial.printf("  • Zero Baseline  : %.2f mV\n", zeroVoltageMv);
  Serial.printf("  • Point 1        : %.2f mV  ->  %.2f mg/L\n", pt1VoltageMv, pt1DoMgL);
  if (hasPoint2) {
    Serial.printf("  • Point 2        : %.2f mV  ->  %.2f mg/L\n", pt2VoltageMv, pt2DoMgL);
  }
  Serial.printf("  • Sensor Slope K : %.5f mg/L per mV\n", slopeK);
  Serial.printf("  • Mode           : %s\n", hasPoint2 ? "✅ 2-POINT (TRUE SENSITIVITY)" : (isCalibrated ? "✅ 1-POINT" : "⚠️ UNCALIBRATED"));
  Serial.println("--------------------------------------------------------------\n");
}

void saveCalibrationToFlash() {
  recalculateCurve();

  prefs.begin(PREF_NAMESPACE, false);
  prefs.putFloat("zero_mv", zeroVoltageMv);
  prefs.putFloat("cal_mv", pt1VoltageMv);
  prefs.putFloat("ref_do", pt1DoMgL);
  prefs.putFloat("slope_k", slopeK);
  prefs.putBool("has_pt2", hasPoint2);
  prefs.putFloat("pt2_v", pt2VoltageMv);
  prefs.putFloat("pt2_do", pt2DoMgL);
  prefs.putBool("is_cal", true);
  prefs.end();
  isCalibrated = true;

  Serial.println("\n==============================================================");
  Serial.println("✅ [SUCCESS] Calibration Saved Permanently to ESP32 Flash (NVS)!");
  Serial.printf("  • Point 1: %.2f mV  ->  %.2f mg/L\n", pt1VoltageMv, pt1DoMgL);
  if (hasPoint2) {
    Serial.printf("  • Point 2: %.2f mV  ->  %.2f mg/L\n", pt2VoltageMv, pt2DoMgL);
  }
  Serial.printf("  • Computed Zero Offset: %.2f mV\n", zeroVoltageMv);
  Serial.printf("  • Real Slope K       : %.5f mg/L per mV\n", slopeK);
  Serial.println("--------------------------------------------------------------");
  Serial.println("💡 COPY & PASTE CONSTANTS FOR YOUR MAIN FIRMWARE:");
  Serial.printf("   const float DO_ZERO_MV   = %.2ff;\n", zeroVoltageMv);
  Serial.printf("   const float DO_CAL_MV    = %.2ff;\n", pt1VoltageMv);
  Serial.printf("   const float DO_REF_MGL   = %.2ff;\n", pt1DoMgL);
  Serial.println("==============================================================\n");
}

void resetCalibrationToDefault() {
  prefs.begin(PREF_NAMESPACE, false);
  prefs.clear();
  prefs.end();

  zeroVoltageMv = 0.0f;
  pt1VoltageMv  = 572.93f;
  pt1DoMgL      = 4.60f;
  hasPoint2     = false;
  recalculateCurve();

  Serial.println("\n[RESET] Restored to defaults.\n");
}

void printHelp() {
  Serial.println("\n==============================================================");
  Serial.println("         Oxynity Smart DO Calibration Console (2-Point)        ");
  Serial.println("==============================================================");
  Serial.println(" COMMANDS:");
  Serial.println("   CAL <value>     -> Set Point 1 (e.g. CAL 4.60)");
  Serial.println("   POINT2 <value>  -> Set Point 2 when DO changes (e.g. POINT2 4.90)");
  Serial.println("                      (Gently stir probe, wait 30s, type POINT2 <val>)");
  Serial.println("   ZERO            -> Set Zero Baseline (put probe in 0 mg/L water)");
  Serial.println("   OFFSET <mv>     -> Set custom zero offset in mV (e.g. OFFSET 250)");
  Serial.println("   RESET           -> Reset to factory defaults");
  Serial.println("   INFO            -> Show current calibration saved in NVS");
  Serial.println("   HELP            -> Show this menu");
  Serial.println("==============================================================\n");
}

// ==============================================================================
// 6. SERIAL COMMAND PARSER
// ==============================================================================
void handleSerialCommands() {
  if (!Serial.available()) return;

  String input = Serial.readStringUntil('\n');
  input.trim();
  if (input.length() == 0) return;

  String cmd = input;
  cmd.toUpperCase();

  if (cmd.startsWith("POINT2") || cmd.startsWith("PT2")) {
    int spaceIdx = cmd.indexOf(' ');
    if (spaceIdx == -1) {
      Serial.println("\n⚠️ Usage: POINT2 <meter_reading>  (e.g. POINT2 4.90)\n");
      return;
    }
    float val = cmd.substring(spaceIdx + 1).toFloat();
    if (val <= 0.5f || val > 25.0f) {
      Serial.println("\n⚠️ Invalid DO value! Must be between 0.5 and 25.0 mg/L.\n");
      return;
    }
    pt2VoltageMv = liveVoltageMv;
    pt2DoMgL     = val;
    hasPoint2    = true;
    saveCalibrationToFlash();

  } else if (cmd.startsWith("CAL")) {
    int spaceIdx = cmd.indexOf(' ');
    if (spaceIdx == -1) {
      Serial.println("\n⚠️ Usage: CAL <meter_reading>  (e.g. CAL 4.60)\n");
      return;
    }
    float targetDo = cmd.substring(spaceIdx + 1).toFloat();
    if (targetDo <= 0.5f || targetDo > 25.0f) {
      Serial.println("\n⚠️ Invalid DO value! Must be between 0.5 and 25.0 mg/L.\n");
      return;
    }
    pt1VoltageMv = liveVoltageMv;
    pt1DoMgL     = targetDo;
    saveCalibrationToFlash();

  } else if (cmd.startsWith("OFFSET")) {
    int spaceIdx = cmd.indexOf(' ');
    if (spaceIdx != -1) {
      zeroVoltageMv = cmd.substring(spaceIdx + 1).toFloat();
      saveCalibrationToFlash();
      Serial.printf("\n✅ Zero offset set to %.2f mV\n", zeroVoltageMv);
    }

  } else if (cmd == "ZERO") {
    zeroVoltageMv = liveVoltageMv;
    saveCalibrationToFlash();
    Serial.printf("\n✅ [Zero Locked] Zero baseline locked at %.2f mV\n", zeroVoltageMv);

  } else if (cmd == "RESET") {
    resetCalibrationToDefault();

  } else if (cmd == "INFO") {
    loadCalibrationFromFlash();

  } else if (cmd == "HELP") {
    printHelp();

  } else {
    Serial.printf("❓ Unknown command: '%s'. Type HELP for command list.\n", input.c_str());
  }
}

// ==============================================================================
// 7. SETUP & MAIN LOOP
// ==============================================================================
void setup() {
  Serial.begin(115200);
  delay(1500);

  analogReadResolution(12);
  analogSetPinAttenuation(DO_PIN, ADC_11db);
  pinMode(DO_PIN, INPUT);

  printHelp();
  loadCalibrationFromFlash();

  Serial.println("[Monitoring] Active. Remember to gently swirl/stir probe in water!\n");
}

void loop() {
  handleSerialCommands();

  liveVoltageMv = readFilteredVoltageMv(liveRawAdc);
  liveDoMgL     = calculateDo(liveVoltageMv);

  if (millis() - lastPrintMs >= 1000) {
    lastPrintMs = millis();

    Serial.printf("[DO Sensor] Voltage: %6.1f mV | Raw ADC: %4d | DO: %5.2f mg/L | %s\n",
                  liveVoltageMv,
                  liveRawAdc,
                  liveDoMgL,
                  hasPoint2 ? "[2-Point Calibrated]" : (isCalibrated ? "[1-Point Calibrated]" : "[Uncalibrated]"));
  }
}
