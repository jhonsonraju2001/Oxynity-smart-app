# 🚀 Oxynity Smart - Google Play Store Deployment & Compliance Guide

This guide contains everything required to publish **Oxynity Smart** onto the **Google Play Console**, including exact answers for the **Data Safety Form**, permission justifications, store listing metadata, release keystore generation, and building the production Android App Bundle (`.aab`).

---

## 📋 1. App Store Listing Metadata

| Field | Value | Policy Limit |
|---|---|---|
| **App Name** | `Oxynity Smart: DO & Aeration` | Max 30 chars (29 used) |
| **Short Description** | `Smart aquaculture DO monitoring, 2G GPRS telemetry & automated aerator control.` | Max 80 chars (79 used) |
| **Category** | Tools / Business / Productivity | |
| **Tags** | Aquaculture, IoT, Water Quality, Agriculture, Smart Farming | |

### Full Description (Copy & Paste directly into Play Console - 3,559 chars / 4,000 limit)
```text
Oxynity Smart is an industrial-grade aquaculture telemetry and machinery automation system engineered specifically for modern shrimp, fish, and biofloc aquaculture operations.

Connected directly to authorized Oxynity ESP32 and SIM900A GPRS cellular hardware, Oxynity Smart bridges the gap between field pond conditions and smart farm management. Monitor live dissolved oxygen (DO) levels, track water temperature, automate pond aerators, manage power switching, and safeguard aquatic livestock against hypoxia 24 hours a day, 7 days a week—even across remote rural ponds without local Wi-Fi or broadband.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ KEY HIGHLIGHTS & CAPABILITIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌊 REAL-TIME DISSOLVED OXYGEN (DO) & WATER QUALITY
• High-precision optical DO sensor readings presented in mg/L with rapid live telemetry refresh.
• Automatic water temperature compensation ensuring laboratory-accurate measurements in varied climate conditions.
• Color-coded interactive gauge with user-definable Optimum, Warning, and Critical Hypoxia safety zones.
• Instant real-time warnings whenever dissolved oxygen levels drop below target thresholds.

🎮 AUTOMATED & REMOTE AERATION CONTROL
• Dual-relay remote control for aerators, micro-nano bubble generators, paddlewheel aerators, and roots blowers.
• Smart Auto-DO Protection: The system autonomously starts generators and aerators when DO drops below safe levels, and shuts them down when optimal dissolved oxygen saturation is achieved.
• Anti-Rapid-Cycling Protection: Prevents frequent switching surges, protecting heavy electric motors and contactors from overload or premature burnout.
• Manual override buttons for immediate pond intervention with live timer confirmation.

📡 2G GPRS SIM900A CELLULAR TELEMETRY
• Engineered for rural aquaculture farm belts where Wi-Fi is unavailable or impractical.
• Direct cellular telemetry over ultra-reliable 2G GPRS cellular networks.
• Real-time Cellular Signal Quality index (CSQ) and base station cell tower tracking (MCC, MNC, LAC, Cell ID).
• Interactive Pond Geolocation Map featuring one-tap GPS coordinate calibration to anchor your physical pond position and detect unauthorized hardware relocation.

📊 COMPREHENSIVE RUNTIME ANALYTICS & 30-DAY LOGS
• 100% authentic hardware operational logs tracking daily runtime hours, start/stop timestamps, and session durations.
• Exportable Date-to-Date CSV Reports: Download detailed 30-day spreadsheets including average DO, minimum DO, maximum DO, water temperature, estimated energy consumption (kWh), and oxygen yield.
• Accurate zero-run idle tracking: Distinguishes between active operating days and maintenance rest periods.
• Predictive Maintenance Engine: Tracks cumulative pump runtime with countdown alarms for scheduled 500-hour service intervals.

👥 MULTI-POND & OPERATOR SECURITY
• Manage multiple ponds from a single, unified mobile dashboard.
• Role-based security differentiating between farm operators and system administrators.
• In-App Password Management with secure Firebase Authentication.
• Dedicated Google Play compliant Account & Data Deletion self-service workflow.

🔒 ENTERPRISE-GRADE SECURITY & DATA SAFETY
• End-to-end data encryption in transit via TLS 1.3 / HTTPS.
• AES-256 cloud database encryption powered by Google Cloud Firestore.
• Zero background location tracking—GPS is requested exclusively during manual pond calibration.

Note: Oxynity Smart works in conjunction with authorized Oxynity Smart ESP32 + SIM900A aquaculture IoT controller hardware units.
```

---

## 🛡️ 2. Google Play Data Safety Form Answers

Google Play requires developers to complete the **Data Safety Questionnaire**. Use the exact selections below:

### A. Data Collection & Sharing Overview
- **Does your app collect or share any of the required user data types?**  
  👉 **Yes**
- **Is all of the user data collected by your app encrypted in transit?**  
  👉 **Yes** (Oxynity Smart routes all network communication over TLS 1.3 / HTTPS).
- **Do you provide a way for users to request that their data be deleted?**  
  👉 **Yes** (Built into Settings &rarr; Delete Account & Wipe Data, and via support email).

---

### B. Specific Data Types Collected

#### 1. Location
- **Approximate location (Coarse)**: Collected? **Yes** | Shared? **No**
- **Precise location (Fine GPS)**: Collected? **Yes** | Shared? **No**
  - **Is this data processed ephemerally?**  
    👉 **No** (Stored in your pond profile in Firestore as the calibrated pond GPS anchor).
  - **Is this data required for your app, or can users choose whether it’s collected?**  
    👉 **Optional** (Users only trigger location collection when calibrating pond coordinates via the GPS button).
  - **Why is this user data collected?**  
    👉 Select: **App functionality** (Pond site geolocation calibration for telemetry mapping).

#### 2. Personal Info
- **Name**: Collected? **Yes** | Shared? **No**
  - **Ephemeral?** No | **Required?** Yes (for account profile).
  - **Purpose:** **Account management**, **App functionality**.
- **Email Address**: Collected? **Yes** | Shared? **No**
  - **Ephemeral?** No | **Required?** Yes (for login and password reset).
  - **Purpose:** **Account management**, **Authentication**.

#### 3. Health & Fitness
- Collected? 👉 **No**

#### 4. Financial Info
- Collected? 👉 **No**

#### 5. Photos & Videos, Audio, Files
- Collected? 👉 **No**

#### 6. App Activity & Performance
- Collected? 👉 **No** (Crash logs are only standard Google Play Vitals).

#### 7. Device or other IDs
- Collected? 👉 **No** (Oxynity does not collect IMEI or Google Advertising ID).

---

## 🔒 3. App Content & Policy Declarations

| Policy Section | Required Selection | Details |
|---|---|---|
| **Privacy Policy URL** | Host `public/privacy-policy.html` on your domain or GitHub Pages (e.g. `https://oxynity.com/privacy-policy.html`) | Covers account deletion, location, and telemetry storage. |
| **Ads** | Select **"No, my app does not contain ads"** | Oxynity Smart is 100% ad-free. |
| **App Access** | Select **"All or some functionality is restricted"** | Provide test account credentials for Google Play reviewers:<br>• **Email**: `operator@oxynity.com`<br>• **Password**: `Oxynity2026!`<br>• Note: Demo pond controller linked for inspection. |
| **Target Audience** | Select **18 and over** (Commercial / Industrial Aquaculture) | Does not target children. |
| **News Apps** | Select **No** | |
| **COVID-19 Contact Tracing** | Select **No** | |
| **Data Safety** | Filled as per Section 2 above | |
| **Government Apps** | Select **No** | |
| **Financial Features** | Select **No financial features** | |
| **Health Apps** | Select **No health features** | Monitors water DO in aquaculture, not human health. |

---

## 🔑 4. Release Keystore Generation & Signing

Before uploading to Google Play Console, you need a release keystore.

### Step 1: Generate Release Keystore (Run once in PowerShell or CMD)
```powershell
keytool -genkey -v -keystore android/oxynity-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias oxynity -dname "CN=Oxynity Smart, OU=Engineering, O=Oxynity Aquaculture, L=Chennai, ST=Tamil Nadu, C=IN"
```
*(Store the password safely; you will need it for every update!)*

### Step 2: Configure Signing in `android/app/build.gradle`
In `android/app/build.gradle`, locate the `signingConfigs` block and configure:
```groovy
android {
    ...
    signingConfigs {
        release {
            storeFile file('../../oxynity-release-key.jks')
            storePassword System.getenv("OXYNITY_KEYSTORE_PASSWORD") ?: "YOUR_PASSWORD"
            keyAlias "oxynity"
            keyPassword System.getenv("OXYNITY_KEY_PASSWORD") ?: "YOUR_PASSWORD"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

---

## 📦 5. Building the Production Release Bundle (.aab)

Google Play requires the **Android App Bundle (.aab)** format:

```bash
# 1. Build web production assets
cmd.exe /c npm run build

# 2. Sync into Android native container
cmd.exe /c npx cap sync android

# 3. Build signed Release App Bundle (.aab)
cd android
cmd.exe /c gradlew.bat bundleRelease
```

The compiled release bundle will be generated at:
```
android/app/build/outputs/bundle/release/app-release.aab
```
Upload this `app-release.aab` directly to the **Internal Testing** or **Production** track on your Google Play Console dashboard.

---

## 🎨 6. Play Store Graphic Assets Checklist

1. **App Icon**: `512 x 512 px` (32-bit PNG with alpha). Located at `public/favicon.png` / `android/app/src/main/res/mipmap-*`.
2. **Feature Graphic**: `1024 x 500 px` (JPEG or 24-bit PNG, no alpha). Oxynity branding with DO gauge illustration.
3. **Phone Screenshots**: Minimum 2 screenshots (1080x2400 or 1080x1920):
   - **Screenshot 1**: Live Pond Dashboard showing DO level, GPRS signal, and Aerator controls.
   - **Screenshot 2**: Interactive GPRS Cellular Map with calibrated pond location.
   - **Screenshot 3**: Runtime Analytics & Machinery Maintenance counter.
   - **Screenshot 4**: Settings & Data Safety Center.
