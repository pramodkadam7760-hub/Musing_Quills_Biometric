// ── LOGO & ICONS ──────────────────────────────────────────
#include "logo.h"
#include "fp_icon.h"

// ── LIBRARIES ─────────────────────────────────────────────
#include <Adafruit_Fingerprint.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <XPT2046_Touchscreen.h>
#include <pgmspace.h>
#include "esp_timer.h"

// 1. Office Wi-Fi details (default):
String ssid = "Quantumclk.Tech";
String password = "zxcvbnm009";

// 2. Active Server URL (default):
String serverUrl = "https://attendancemq.quantumclk.tech";

// ═══════════════════════════════════════════════════════════
//  PINS
// ═══════════════════════════════════════════════════════════
#define FP_RX 16
#define FP_TX 17
#define AUDIO_PIN 25
#define TOUCH_CS 5
#define TOUCH_IRQ 21
#define TOUCH_MOSI 23
#define TOUCH_MISO 19
#define TOUCH_CLK 18

// ═══════════════════════════════════════════════════════════
//  TUNABLES
// ═══════════════════════════════════════════════════════════
#define SAMPLE_RATE 16000
#define SAMPLE_DELAY_US (1000000 / SAMPLE_RATE)
#define DEFAULT_VOLUME 100 // Pre-attenuated WAV files: 100% gives pristine dynamic range at gentle volume
#define FP_SCAN_TIMEOUT 12000UL
#define RESULT_DWELL 2800UL
#define DEBOUNCE_MS 260UL
#define ADMIN_FP_SLOT 0
#define MAX_EMPLOYEES 200
#define NAME_MAX_LEN 18

#define SCREEN_W 320
#define SCREEN_H 240
#define LOGO_W 55 // actual pixel width from logo.h  (55×55)
#define LOGO_H 55 // actual pixel height from logo.h (55×55)

// Inverted Color Definitions for Inverted BGR Displays
#define C_WHITE 0x0000 // displays as white on inverted screen
#define C_BG 0x0000    // displays as white background
#define C_PANEL                                                                \
  0x10A3 // displays as card panel background (light grey: standard 0xEF5C
         // inverted in BGR is 0x10A3)
#define C_DIVIDER                                                              \
  0x31A6 // displays as divider line (light grey: standard 0xCE59 inverted in
         // BGR is 0x31A6)
#define C_TEXT 0xFFFF // displays as black text
#define C_SUBTEXT                                                              \
  0x7BEF // displays as dark/medium grey text (standard 0x8410 inverted is
         // 0x7BEF)
#define C_PRIMARY                                                              \
  0xFFE0 // displays as bright brand red (standard Yellow 0xFFE0 inverts to pure
         // Red in BGR!)
#define C_PRIMARY_DK 0xFBE0 // displays as darker red (inverted)
#define C_SUCCESS                                                              \
  0xF81F // displays as green (standard green ~0x07E0 is ~0x07E0 = 0xF81F)
#define C_DANGER 0xFFE0 // displays as red

TFT_eSPI tft = TFT_eSPI();
SPIClass touchSPI(VSPI);
XPT2046_Touchscreen touch(TOUCH_CS, TOUCH_IRQ);
HardwareSerial fpSerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fpSerial);
Preferences prefs;

struct SoftClock {
  uint32_t baseEpoch = 0;
  uint32_t baseMillis = 0;

  uint32_t now() {
    time_t nowSec;
    time(&nowSec);
    if (nowSec > 1700000000UL) {
      return (uint32_t)nowSec;
    }
    return baseEpoch + (millis() - baseMillis) / 1000;
  }

  void set(int h, int m, int s, int d, int mo, int y) {
    uint32_t days = 0;
    for (int yr = 2000; yr < y; yr++)
      days += (yr % 4 == 0 ? 366 : 365);
    const uint8_t dpm[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    for (int mn = 1; mn < mo; mn++)
      days += dpm[mn - 1];
    if (mo > 2 && y % 4 == 0)
      days++;
    days += (d - 1);
    baseEpoch = days * 86400UL + h * 3600UL + m * 60UL + s;
    baseMillis = millis();
  }

  void fmtFull(char *buf, size_t len) {
    uint32_t t = now();
    uint32_t sec = t % 60;
    t /= 60;
    uint32_t min = t % 60;
    t /= 60;
    uint32_t hr = t % 24;
    uint32_t days = now() / 86400;
    uint32_t rem = days;
    int year = 2000;
    while (true) {
      uint32_t yd = (year % 4 == 0) ? 366 : 365;
      if (rem < yd)
        break;
      rem -= yd;
      year++;
    }
    const uint8_t dpm[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    int month = 1;
    while (true) {
      uint8_t md = dpm[month - 1];
      if (month == 2 && year % 4 == 0)
        md = 29;
      if (rem < md)
        break;
      rem -= md;
      month++;
    }
    snprintf(buf, len, "%02d:%02d:%02d  %02d/%02d/%04d", (int)hr, (int)min,
             (int)sec, (int)(rem + 1), month, year);
  }
} clk;

enum Screen {
  SCR_HOME,
  SCR_SCANNING,
  SCR_ADMIN_AUTH,
  SCR_MANAGE,
  SCR_QWERTY,
  SCR_CONFIRM,
  SCR_ENROLL_FP,
  SCR_DELETE,
  SCR_RESULT
};
Screen currentScreen = SCR_HOME;

bool checkedIn[MAX_EMPLOYEES + 1];
uint32_t lastCheckInDay[MAX_EMPLOYEES + 1];
uint32_t lastCheckOutDay[MAX_EMPLOYEES + 1];
bool adminEnrolled = false;
char empNames[MAX_EMPLOYEES + 1][NAME_MAX_LEN + 1];

char nameBuf[NAME_MAX_LEN + 1];
uint8_t nameLen = 0;
bool capsOn = true;

uint8_t pendingSlot = 0;
char pendingName[NAME_MAX_LEN + 1];

unsigned long lastTouchMs = 0;

// ═══════════════════════════════════════════════════════════
//  WAV AUDIO PLAYBACK VIA LITTLEFS
// ═══════════════════════════════════════════════════════════
const char *WAV_CHECKED_IN     = "/checked_in.wav";
const char *WAV_CHECKED_OUT    = "/checked_out.wav";
const char *WAV_INVALID        = "/invalid_fingerprint.wav";
const char *WAV_ENROLL_SUCCESS = "/enrollment_success.wav";
const char *WAV_ENROLL_FAILED  = "/enrollment_failed.wav";

static const uint8_t DAC_SILENCE = 128;

static uint16_t readLE16(File &file) {
  uint16_t value = (uint16_t)file.read();
  value |= (uint16_t)file.read() << 8;
  return value;
}

static uint32_t readLE32(File &file) {
  uint32_t value = (uint32_t)file.read();
  value |= (uint32_t)file.read() << 8;
  value |= (uint32_t)file.read() << 16;
  value |= (uint32_t)file.read() << 24;
  return value;
}

static bool readFourCC(File &file, char id[5]) {
  if (file.read((uint8_t *)id, 4) != 4)
    return false;
  id[4] = '\0';
  return true;
}

static void enableAudioOutput() {
  dacWrite(AUDIO_PIN, DAC_SILENCE);
  delay(50);
}

static void disableAudioOutput() {
  dacWrite(AUDIO_PIN, DAC_SILENCE);
  delay(50);
  pinMode(AUDIO_PIN, INPUT);
}

bool playWav(const char *filename) {
  File wavFile = LittleFS.open(filename, "r");
  if (!wavFile) {
    Serial.print("[AUDIO] File not found: ");
    Serial.println(filename);
    return false;
  }

  char chunkID[5];
  if (!readFourCC(wavFile, chunkID) || strcmp(chunkID, "RIFF") != 0) {
    wavFile.close();
    return false;
  }

  readLE32(wavFile); // file size

  if (!readFourCC(wavFile, chunkID) || strcmp(chunkID, "WAVE") != 0) {
    wavFile.close();
    return false;
  }

  bool formatFound = false;
  bool dataFound   = false;
  uint16_t audioFormat = 0, channels = 0, bitsPerSample = 0;
  uint32_t sampleRate = 0, dataSize = 0;

  while (wavFile.available()) {
    if (!readFourCC(wavFile, chunkID))
      break;
    uint32_t chunkSize = readLE32(wavFile);
    uint32_t chunkStart = wavFile.position();

    if (strcmp(chunkID, "fmt ") == 0) {
      if (chunkSize < 16)
        break;
      audioFormat = readLE16(wavFile);
      channels = readLE16(wavFile);
      sampleRate = readLE32(wavFile);
      readLE32(wavFile);
      readLE16(wavFile);
      bitsPerSample = readLE16(wavFile);
      formatFound = true;
    } else if (strcmp(chunkID, "data") == 0) {
      dataSize = chunkSize;
      dataFound = true;
      break;
    }
    wavFile.seek(chunkStart + chunkSize + (chunkSize & 1U));
  }

  if (!formatFound || !dataFound || audioFormat != 1 || channels != 1 || bitsPerSample != 8) {
    Serial.printf("[AUDIO] Format mismatch in %s: fmt=%d (need 1), ch=%d (need 1), bits=%d (need 8)\n",
                  filename, audioFormat, channels, bitsPerSample);
    wavFile.close();
    return false;
  }

  enableAudioOutput();

  uint8_t playbackVolume = DEFAULT_VOLUME;
  if (strcmp(filename, WAV_INVALID) == 0)
    playbackVolume = (DEFAULT_VOLUME > 10) ? (DEFAULT_VOLUME - 10) : DEFAULT_VOLUME;
  else if (strcmp(filename, WAV_ENROLL_SUCCESS) == 0 || strcmp(filename, WAV_ENROLL_FAILED) == 0)
    playbackVolume = (DEFAULT_VOLUME > 10) ? (DEFAULT_VOLUME - 10) : DEFAULT_VOLUME;

  const uint32_t basePeriodUs = 1000000UL / sampleRate;
  const uint32_t periodRemainder = 1000000UL % sampleRate;
  uint32_t remainderAccumulator = 0;
  int64_t nextSampleTime = esp_timer_get_time() + basePeriodUs;
  uint8_t lastOutputSample = DAC_SILENCE;

  uint8_t *audioBuffer = (uint8_t *)malloc(dataSize);
  if (audioBuffer) {
    // In-memory playback: 0 SPI delay, pristine crystal clear audio with no robotic buzz!
    wavFile.read(audioBuffer, dataSize);
    wavFile.close();

    for (uint32_t i = 0; i < dataSize; i++) {
      int16_t amplitude = (int16_t)audioBuffer[i] - DAC_SILENCE;
      amplitude = (amplitude * playbackVolume) / 100;
      int16_t outputSample = DAC_SILENCE + amplitude;
      outputSample = constrain(outputSample, 0, 255);

      int64_t now = esp_timer_get_time();
      if (now - nextSampleTime > (int64_t)(basePeriodUs * 2U + 2U)) {
        nextSampleTime = now;
        remainderAccumulator = 0;
      }

      while (esp_timer_get_time() < nextSampleTime) {
        // wait for next sample interval
      }

      dacWrite(AUDIO_PIN, (uint8_t)outputSample);
      lastOutputSample = (uint8_t)outputSample;

      nextSampleTime += basePeriodUs;
      remainderAccumulator += periodRemainder;
      if (remainderAccumulator >= sampleRate) {
        nextSampleTime++;
        remainderAccumulator -= sampleRate;
      }
    }
    free(audioBuffer);
  } else {
    // Streaming fallback if RAM is constrained
    uint8_t chunk[512];
    uint32_t bytesRemaining = dataSize;
    while (bytesRemaining > 0 && wavFile.available()) {
      size_t toRead = (bytesRemaining > sizeof(chunk)) ? sizeof(chunk) : bytesRemaining;
      size_t bytesRead = wavFile.read(chunk, toRead);
      if (bytesRead == 0) break;
      bytesRemaining -= bytesRead;

      for (size_t i = 0; i < bytesRead; i++) {
        int16_t amplitude = (int16_t)chunk[i] - DAC_SILENCE;
        amplitude = (amplitude * playbackVolume) / 100;
        int16_t outputSample = DAC_SILENCE + amplitude;
        outputSample = constrain(outputSample, 0, 255);

        int64_t now = esp_timer_get_time();
        if (now - nextSampleTime > (int64_t)(basePeriodUs * 2U + 2U)) {
          nextSampleTime = now;
          remainderAccumulator = 0;
        }

        while (esp_timer_get_time() < nextSampleTime) {
          // wait for next sample interval
        }

        dacWrite(AUDIO_PIN, (uint8_t)outputSample);
        lastOutputSample = (uint8_t)outputSample;

        nextSampleTime += basePeriodUs;
        remainderAccumulator += periodRemainder;
        if (remainderAccumulator >= sampleRate) {
          nextSampleTime++;
          remainderAccumulator -= sampleRate;
        }
      }
    }
    wavFile.close();
  }

  int16_t currentSample = lastOutputSample;
  while (currentSample != DAC_SILENCE) {
    if (currentSample < DAC_SILENCE)
      currentSample++;
    else
      currentSample--;
    dacWrite(AUDIO_PIN, (uint8_t)currentSample);
    delayMicroseconds(100);
  }
  dacWrite(AUDIO_PIN, DAC_SILENCE);
  delay(50);
  disableAudioOutput();
  return true;
}

void playBeep(int freq, int duration_ms) {
  pinMode(AUDIO_PIN, OUTPUT);
  long delay_us = 1000000L / (freq * 2);
  long num_cycles = (duration_ms * 1000L) / (delay_us * 2);
  // Gentle, soft beep (only +- 6 amplitude steps around silence 128)
  for (long i = 0; i < num_cycles; i++) {
    dacWrite(AUDIO_PIN, 134);
    delayMicroseconds(delay_us);
    dacWrite(AUDIO_PIN, 122);
    delayMicroseconds(delay_us);
  }
  dacWrite(AUDIO_PIN, DAC_SILENCE);
  pinMode(AUDIO_PIN, INPUT);
}

void sfxCheckin() {
  if (!playWav(WAV_CHECKED_IN)) {
    Serial.println("[AUDIO] WAV_CHECKED_IN not found, playing fallback chime");
    playBeep(1800, 70);
    delay(40);
    playBeep(2400, 90);
  }
}

void sfxCheckout() {
  if (!playWav(WAV_CHECKED_OUT)) {
    Serial.println("[AUDIO] WAV_CHECKED_OUT not found, playing fallback chime");
    playBeep(2400, 70);
    delay(40);
    playBeep(1800, 90);
  }
}
void sfxValid() {
  playBeep(2000, 50);
  delay(30);
  playBeep(2400, 50);
}
void sfxInvalid() { playWav(WAV_INVALID); }
void sfxEnrolled() { playWav(WAV_ENROLL_SUCCESS); }
void sfxAdminEnrolled() {
  // Ascending 3-tone chime for admin enrollment (no speech)
  playBeep(1600, 60);
  delay(30);
  playBeep(2000, 60);
  delay(30);
  playBeep(2500, 90);
}

// ═══════════════════════════════════════════════════════════
//  HTTP NETWORK COMMUNICATIONS
// ═══════════════════════════════════════════════════════════
int sendAttendanceLogToServer(int fingerprint_id, const char *action,
                              const char *employee_name, String *outAction = nullptr) {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    unsigned long waitW = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - waitW < 1200) {
      delay(100);
    }
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[HTTP] Wi-Fi not connected. Attendance log skipped.");
      return -1; // Wi-Fi disconnected
    }
  }

  HTTPClient http;
  WiFiClientSecure sClient;
  WiFiClient bClient;
  String url = String(serverUrl) + "/api/hardware/log";
  if (url.startsWith("https://")) {
    sClient.setInsecure();
    http.begin(sClient, url);
  } else {
    http.begin(bClient, url);
  }
  http.setTimeout(5000); // 5 seconds explicit timeout
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Connection", "close");

  // Include employee_name so server can self-heal broken fingerprint links
  String payload = "{\"fingerprint_id\":" + String(fingerprint_id) +
                   ",\"action\":\"" + String(action) +
                   "\",\"employee_name\":\"" + String(employee_name) +
                   "\",\"device\":\"ESP32_READER_1\"}";

  Serial.println("[HTTP] Sending Log payload: " + payload);
  int httpResponseCode = http.POST(payload);
  int result = -2; // Default to connection failure

  if (httpResponseCode >= 200 && httpResponseCode < 300) {
    Serial.printf("[HTTP] Success response code: %d\n", httpResponseCode);
    String response = http.getString();
    Serial.println("[HTTP] Response payload: " + response);
    if (outAction) {
      if (response.indexOf("\"action\":\"OUT\"") != -1) {
        *outAction = "OUT";
      } else if (response.indexOf("\"action\":\"IN\"") != -1) {
        *outAction = "IN";
      } else {
        *outAction = action;
      }
    }
    if (response.indexOf("\"completed\":true") != -1) {
      result = 2; // Shift already completed for today
    } else if (response.indexOf("\"success\":true") != -1) {
      if (response.indexOf("\"late\":true") != -1) {
        result = 1; // Success, late
      } else {
        result = 0; // Success, not late
      }
    } else {
      result = -4; // Server responded with 200 but success wasn't true
    }
  } else if (httpResponseCode == 404) {
    result = -3; // Employee not found in database
    Serial.println("[HTTP] Employee not found in web database (404)");
  } else {
    Serial.printf("[HTTP] Connection failed, error: %s (code: %d)\n",
                  http.errorToString(httpResponseCode).c_str(),
                  httpResponseCode);
    result = -2;
  }
  http.end();
  return result;
}

void sendEnrollmentToServer(int fingerprint_id, const char *employee_name) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Wi-Fi not connected. Enrollment skipped.");
    return;
  }

  HTTPClient http;
  WiFiClientSecure sClient;
  WiFiClient bClient;
  String url = String(serverUrl) + "/api/hardware/enroll";
  if (url.startsWith("https://")) {
    sClient.setInsecure();
    http.begin(sClient, url);
  } else {
    http.begin(bClient, url);
  }
  http.setTimeout(6000); // 6 seconds explicit timeout
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Connection", "close");

  // Dynamic JSON enrollment payload containing slot and name
  String payload = "{\"fingerprint_id\":" + String(fingerprint_id) +
                   ",\"employee_name\":\"" + String(employee_name) +
                   "\",\"device\":\"ESP32_READER_1\"}";

  Serial.println("[HTTP] Sending Enroll payload: " + payload);
  int httpResponseCode = http.POST(payload);

  if (httpResponseCode >= 200 && httpResponseCode < 300) {
    Serial.printf("[HTTP] Success response code: %d\n", httpResponseCode);
    Serial.println("[HTTP] Response payload: " + http.getString());
  } else {
    Serial.printf("[HTTP] Connection failed, error: %s (code: %d)\n",
                  http.errorToString(httpResponseCode).c_str(),
                  httpResponseCode);
  }
  http.end();
}

void sendDeletionToServer(int fingerprint_id) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Wi-Fi not connected. Deletion sync skipped.");
    return;
  }

  HTTPClient http;
  WiFiClientSecure sClient;
  WiFiClient bClient;
  String url = String(serverUrl) + "/api/hardware/delete";
  if (url.startsWith("https://")) {
    sClient.setInsecure();
    http.begin(sClient, url);
  } else {
    http.begin(bClient, url);
  }
  http.setTimeout(6000); // 6 seconds explicit timeout
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Connection", "close");

  // Dynamic JSON deletion payload containing slot
  String payload = "{\"fingerprint_id\":" + String(fingerprint_id) + "}";

  Serial.println("[HTTP] Sending Delete payload: " + payload);
  int httpResponseCode = http.POST(payload);

  if (httpResponseCode >= 200 && httpResponseCode < 300) {
    Serial.printf("[HTTP] Success response code: %d\n", httpResponseCode);
    Serial.println("[HTTP] Response payload: " + http.getString());
  } else {
    Serial.printf("[HTTP] Connection failed, error: %s (code: %d)\n",
                  http.errorToString(httpResponseCode).c_str(),
                  httpResponseCode);
  }
  http.end();
}

// ═══════════════════════════════════════════════════════════
void loadAll() {
  prefs.begin("qclk", false);
  for (int i = 1; i <= MAX_EMPLOYEES; i++) {
    char k[10];
    snprintf(k, sizeof(k), "ci%d", i);
    checkedIn[i] = prefs.getBool(k, false);
    snprintf(k, sizeof(k), "cd%d", i);
    lastCheckInDay[i] = prefs.getULong(k, 0);
    snprintf(k, sizeof(k), "co%d", i);
    lastCheckOutDay[i] = prefs.getULong(k, 0);
    snprintf(k, sizeof(k), "nm%d", i);
    prefs.getString(k, empNames[i], NAME_MAX_LEN);
  }
  adminEnrolled = prefs.getBool("adminOK", false);
  serverUrl = prefs.getString("srv", serverUrl);
  // Auto-upgrade stale local or legacy addresses to the live cloud URL
  if (serverUrl.indexOf("192.168.") != -1 || serverUrl.indexOf("localhost") != -1 || serverUrl.indexOf("10.0.") != -1 || serverUrl.length() == 0) {
    serverUrl = "https://attendancemq.quantumclk.tech";
    prefs.putString("srv", serverUrl);
  }
  ssid = prefs.getString("ssid", ssid);
  password = prefs.getString("pass", password);
  prefs.end();
}
void saveCheckedIn(uint8_t id, bool v) {
  checkedIn[id] = v;
  prefs.begin("qclk", false);
  char k[10];
  snprintf(k, sizeof(k), "ci%d", id);
  prefs.putBool(k, v);
  uint32_t cDay = clk.now() / 86400UL;
  if (v) {
    lastCheckInDay[id] = cDay;
    snprintf(k, sizeof(k), "cd%d", id);
    prefs.putULong(k, cDay);
  } else {
    lastCheckOutDay[id] = cDay;
    snprintf(k, sizeof(k), "co%d", id);
    prefs.putULong(k, cDay);
  }
  prefs.end();
}
void saveEmpName(uint8_t id, const char *n) {
  strncpy(empNames[id], n, NAME_MAX_LEN);
  empNames[id][NAME_MAX_LEN] = '\0';
  prefs.begin("qclk", false);
  char k[10];
  snprintf(k, sizeof(k), "nm%d", id);
  prefs.putString(k, n);
  prefs.end();
}
void clearEmpName(uint8_t id) {
  empNames[id][0] = '\0';
  prefs.begin("qclk", false);
  char k[10];
  snprintf(k, sizeof(k), "nm%d", id);
  prefs.putString(k, "");
  prefs.end();
}
void setAdminEnrolled(bool v) {
  adminEnrolled = v;
  prefs.begin("qclk", false);
  prefs.putBool("adminOK", v);
  prefs.end();
}
uint8_t findFreeSlot() {
  finger.getTemplateCount();
  for (uint8_t i = 1; i <= MAX_EMPLOYEES; i++)
    if (strlen(empNames[i]) == 0)
      return i;
  return 0;
}

struct TPoint {
  int x, y;
  bool valid;
};

struct TPoint readTouch() {
  TPoint out = {0, 0, false};
  if (!touch.tirqTouched() || !touch.touched())
    return out;
  unsigned long n = millis();
  if (n - lastTouchMs < DEBOUNCE_MS)
    return out;
  lastTouchMs = n;
  TS_Point p = touch.getPoint();
  out.x = map(p.x, 200, 3700, 0, SCREEN_W);
  out.y = map(p.y, 200, 3700, 0, SCREEN_H);
  out.valid = true;
  return out;
}
bool hit(TPoint &t, int x, int y, int w, int h) {
  return t.valid && t.x >= x && t.x <= x + w && t.y >= y && t.y <= y + h;
}

void fpWaitLift() {
  while (finger.getImage() != FINGERPRINT_NOFINGER)
    delay(50);
}

// ═══════════════════════════════════════════════════════════
//  UI DRAWING SCHEME
// ═══════════════════════════════════════════════════════════
void fillCard(int x, int y, int w, int h, uint16_t bg = C_WHITE) {
  tft.fillRoundRect(x, y, w, h, 6, bg);
}
void outlineCard(int x, int y, int w, int h, uint16_t col = C_DIVIDER) {
  tft.drawRoundRect(x, y, w, h, 6, col);
}

void drawLogo(int x, int y, int w, int h, int r, uint16_t bg_color) {
  tft.fillRoundRect(x, y, w, h, r, bg_color);
  int ox = x + (w - LOGO_W) / 2;
  int oy = y + (h - LOGO_H) / 2;
  for (int y_img = 0; y_img < LOGO_H; y_img++) {
    for (int x_img = 0; x_img < LOGO_W; x_img++) {
      uint16_t pixel = pgm_read_word(&logo_img[y_img * LOGO_W + x_img]);
      // In logo.h, 0x0000 is the emblem foreground
      if (pixel == 0x0000) {
        int px = ox + x_img;
        int py = oy + y_img;
        if (px >= x && px < x + w && py >= y && py < y + h) {
          tft.drawPixel(px, py, C_WHITE);
        }
      }
    }
  }
}

static void drawArcStroke(int16_t cx, int16_t cy, int16_t radius,
                          int16_t startDeg, int16_t endDeg,
                          uint16_t color, uint8_t thickness = 2) {
  for (uint8_t stroke = 0; stroke < thickness; ++stroke) {
    int16_t r = radius - stroke;
    int16_t oldX = cx + (int16_t)(cosf(startDeg * DEG_TO_RAD) * r);
    int16_t oldY = cy + (int16_t)(sinf(startDeg * DEG_TO_RAD) * r);
    for (int16_t angle = startDeg + 4; angle <= endDeg; angle += 4) {
      int16_t x = cx + (int16_t)(cosf(angle * DEG_TO_RAD) * r);
      int16_t y = cy + (int16_t)(sinf(angle * DEG_TO_RAD) * r);
      tft.drawLine(oldX, oldY, x, y, color);
      oldX = x;
      oldY = y;
    }
  }
}

void drawFingerprintRow(int x, int y, int row, uint16_t color) {
  if (row < 0 || row >= FP_ICON_H) return;
  int lineStart = -1;
  for (int i = 0; i < FP_ICON_W; i++) {
    uint16_t byteIndex = row * 12 + (i / 8);
    uint8_t b = pgm_read_byte(&fp_icon_bits[byteIndex]);
    bool isPixel = (b & (0x80 >> (i % 8))) != 0;
    if (isPixel) {
      if (lineStart < 0) lineStart = i;
    } else {
      if (lineStart >= 0) {
        tft.drawFastHLine(x + lineStart, y + row, i - lineStart, color);
        lineStart = -1;
      }
    }
  }
  if (lineStart >= 0) {
    tft.drawFastHLine(x + lineStart, y + row, FP_ICON_W - lineStart, color);
  }
}

void drawFingerprintIcon(int x, int y, uint16_t color) {
  for (int row = 0; row < FP_ICON_H; row++) {
    drawFingerprintRow(x, y, row, color);
  }
}

void animateScanLaser(int x, int y, uint16_t laserColor) {
  int bLen = 10;
  // Biometric cyber corner brackets framing 96x96 scanner
  tft.drawFastHLine(x - 5, y - 5, bLen, laserColor);
  tft.drawFastVLine(x - 5, y - 5, bLen, laserColor);
  tft.drawFastHLine(x + FP_ICON_W + 5 - bLen, y - 5, bLen, laserColor);
  tft.drawFastVLine(x + FP_ICON_W + 4, y - 5, bLen, laserColor);
  tft.drawFastHLine(x - 5, y + FP_ICON_H + 4, bLen, laserColor);
  tft.drawFastVLine(x - 5, y + FP_ICON_H + 5 - bLen, bLen, laserColor);
  tft.drawFastHLine(x + FP_ICON_W + 5 - bLen, y + FP_ICON_H + 4, bLen, laserColor);
  tft.drawFastVLine(x + FP_ICON_W + 4, y + FP_ICON_H + 5 - bLen, bLen, laserColor);

  // Fast smooth optical sweep across fingerprint ridges
  for (int row = 0; row < FP_ICON_H; row += 3) {
    tft.drawFastHLine(x - 2, y + row, FP_ICON_W + 4, laserColor);
    delay(4);
    tft.drawFastHLine(x - 2, y + row, FP_ICON_W + 4, C_BG);
    drawFingerprintRow(x, y, row, laserColor);
    drawFingerprintRow(x, y, row + 1, laserColor);
    drawFingerprintRow(x, y, row + 2, laserColor);
  }

  // Quick radar pulse ring
  for (int r = 40; r <= 56; r += 4) {
    tft.drawCircle(x + 48, y + 48, r, laserColor);
    delay(7);
    tft.drawCircle(x + 48, y + 48, r, C_BG);
  }
}

bool drawBmpFromLittleFS(const char *filename, int x, int y, uint16_t tintColor, bool useTint = true) {
  File bmpFile = LittleFS.open(filename, "r");
  if (!bmpFile) {
    return false;
  }

  // BMP signature 'BM'
  if (bmpFile.read() != 'B' || bmpFile.read() != 'M') {
    bmpFile.close();
    return false;
  }

  readLE32(bmpFile); // File size
  readLE32(bmpFile); // Reserved
  uint32_t imageOffset = readLE32(bmpFile);

  readLE32(bmpFile); // Header size
  int32_t bmpWidth = (int32_t)readLE32(bmpFile);
  int32_t bmpHeight = (int32_t)readLE32(bmpFile);
  uint16_t planes = readLE16(bmpFile);
  uint16_t depth = readLE16(bmpFile);
  uint32_t compression = readLE32(bmpFile);

  if (planes != 1 || depth != 24 || compression != 0) {
    bmpFile.close();
    return false;
  }

  bool flip = true;
  if (bmpHeight < 0) {
    bmpHeight = -bmpHeight;
    flip = false;
  }

  uint32_t rowSize = (bmpWidth * 3 + 3) & ~3;
  uint8_t rowBuffer[320];
  if (rowSize > sizeof(rowBuffer)) {
    bmpFile.close();
    return false;
  }

  for (int32_t row = 0; row < bmpHeight; row++) {
    int32_t screenY = flip ? (y + (bmpHeight - 1 - row)) : (y + row);
    if (screenY < 0 || screenY >= SCREEN_H) continue;

    uint32_t pos = imageOffset + (uint32_t)row * rowSize;
    if (bmpFile.position() != pos) {
      bmpFile.seek(pos);
    }
    if (bmpFile.read(rowBuffer, rowSize) != rowSize) {
      break;
    }

    for (int32_t col = 0; col < bmpWidth; col++) {
      int32_t screenX = x + col;
      if (screenX < 0 || screenX >= SCREEN_W) continue;

      uint8_t b = rowBuffer[col * 3 + 0];
      uint8_t g = rowBuffer[col * 3 + 1];
      uint8_t r = rowBuffer[col * 3 + 2];

      // Skip white background
      if (r > 200 && g > 200 && b > 200) {
        continue;
      }

      if (useTint) {
        tft.drawPixel(screenX, screenY, tintColor);
      } else {
        uint16_t c = tft.color565(r, g, b);
        tft.drawPixel(screenX, screenY, c);
      }
    }
  }

  bmpFile.close();
  return true;
}

static void drawLogoIcon(int bx, int by) {
  drawLogo(264, 4, 52, 50, 6, C_PRIMARY);
}

static void drawWifiIcon(int16_t x, int16_t y, uint16_t color) {
  tft.drawCircle(x, y, 10, color);
  tft.fillRect(x - 12, y, 24, 12, C_PANEL);
  tft.drawCircle(x, y, 6, color);
  tft.fillRect(x - 8, y, 16, 8, C_PANEL);
  tft.fillCircle(x, y + 4, 2, color);
}

static void drawGearIcon(int16_t cx, int16_t cy, uint16_t color) {
  tft.drawCircle(cx, cy, 5, color);
  tft.drawCircle(cx, cy, 6, color);
  tft.fillCircle(cx, cy, 2, color);
  for (uint8_t i = 0; i < 8; ++i) {
    float angle = i * PI / 4.0f;
    int16_t x1 = cx + (int16_t)(cosf(angle) * 7);
    int16_t y1 = cy + (int16_t)(sinf(angle) * 7);
    int16_t x2 = cx + (int16_t)(cosf(angle) * 9);
    int16_t y2 = cy + (int16_t)(sinf(angle) * 9);
    tft.drawLine(x1, y1, x2, y2, color);
  }
}

void drawHeader(const char *title, const char *subtitle = nullptr) {
  tft.fillScreen(C_BG);
  tft.setTextWrap(false);

  tft.setTextColor(C_TEXT, C_BG);
  tft.setTextSize(2);
  tft.setCursor(16, 11);
  tft.print(title);

  tft.setTextColor(C_SUBTEXT, C_BG);
  tft.setTextSize(1);
  tft.setCursor(17, 34);
  tft.print(subtitle ? subtitle : "Biometric Attendance");

  drawLogo(264, 4, 52, 50, 6, C_PRIMARY);
  tft.drawFastHLine(10, 58, 300, C_DIVIDER);
}

void drawBtn(int x, int y, int w, int h, const char *lbl,
             uint16_t bg = C_PRIMARY, uint16_t fg = C_WHITE) {
  tft.fillRoundRect(x, y, w, h, 6, bg);
  tft.setTextColor(fg, bg);
  tft.setTextSize(2);
  int tw = strlen(lbl) * 12;
  if (tw > w - 10) {
    tft.setTextSize(1);
    tw = strlen(lbl) * 6;
  }
  tft.setCursor(x + (w - tw) / 2, y + (h - 16) / 2);
  tft.print(lbl);
}

void drawGhostBtn(int x, int y, int w, int h, const char *lbl,
                  uint16_t col = C_SUBTEXT) {
  tft.fillRoundRect(x, y, w, h, 6, C_WHITE);
  tft.drawRoundRect(x, y, w, h, 6, col);
  tft.setTextColor(col, C_WHITE);
  tft.setTextSize(1);
  int tw = strlen(lbl) * 6;
  tft.setCursor(x + (w - tw) / 2, y + (h - 8) / 2);
  tft.print(lbl);
}

void drawBackBtn(int x = 8, int y = 208, int w = 72, int h = 26) {
  drawGhostBtn(x, y, w, h, "< Back", C_SUBTEXT);
}

void printCenter(const char *s, int y, uint16_t col, uint8_t sz = 1,
                 uint16_t bg = C_BG) {
  tft.setTextColor(col, bg);
  tft.setTextSize(sz);
  int tw = strlen(s) * (sz == 2 ? 12 : 6);
  tft.setCursor((SCREEN_W - tw) / 2, y);
  tft.print(s);
}

void drawFpRing(uint16_t col, int cx = 160, int cy = 120) {
  drawFingerprintIcon(cx - 48, cy - 48, col);
}

void drawTick(int cx, int cy, uint16_t col) {
  tft.fillCircle(cx, cy, 28, col);
  for (int t = 0; t < 4; t++) {
    tft.drawLine(cx - 13, cy + t, cx - 3, cy + 12 + t, C_WHITE);
    tft.drawLine(cx - 3, cy + 12 + t, cx + 14, cy - 8 + t, C_WHITE);
  }
}

void drawCross(int cx, int cy, uint16_t col) {
  tft.fillCircle(cx, cy, 28, col);
  for (int t = 0; t < 4; t++) {
    tft.drawLine(cx - 12, cy - 12 + t, cx + 12, cy + 12 + t, C_WHITE);
    tft.drawLine(cx + 12, cy - 12 + t, cx - 12, cy + 12 + t, C_WHITE);
  }
}

void drawRule(int y, int x = 10, int w = 300) {
  tft.fillRect(x, y, w, 1, C_DIVIDER);
}

void drawKey(int x, int y, int w, int h, const char *lbl, uint16_t bg,
             uint16_t fg, uint16_t border = C_DIVIDER) {
  tft.fillRoundRect(x, y, w, h, 4, bg);
  tft.drawRoundRect(x, y, w, h, 4, border);
  tft.setTextColor(fg, bg);
  int fs = (strlen(lbl) > 2) ? 1 : 2;
  tft.setTextSize(fs);
  int tw = strlen(lbl) * (fs == 2 ? 12 : 6);
  tft.setCursor(x + (w - tw) / 2, y + (h - (fs == 2 ? 16 : 8)) / 2);
  tft.print(lbl);
}

void buttonTouchFeedback(int x, int y, int w, int h, uint16_t currentBg, const char *label = nullptr, uint16_t fg = C_WHITE) {
  tft.fillRoundRect(x, y, w, h, 6, C_WHITE);
  tft.drawRoundRect(x, y, w, h, 6, currentBg);
  if (label) {
    tft.setTextColor(currentBg, C_WHITE);
    int fs = (strlen(label) > 8) ? 1 : 2;
    tft.setTextSize(fs);
    int tw = strlen(label) * (fs == 2 ? 12 : 6);
    tft.setCursor(x + (w - tw) / 2, y + (h - (fs == 2 ? 16 : 8)) / 2);
    tft.print(label);
  }
  delay(45);
}

void drawStatusIndicator(const char *msg, uint16_t dotColor, int y = 172) {
  int len = strlen(msg);
  uint8_t sz = (len > 18) ? 1 : 2;
  int charW = (sz == 2) ? 12 : 6;
  int textW = len * charW;
  int dotR = 5;
  int gap = 8;
  int totalW = (dotR * 2) + gap + textW;
  int startX = (SCREEN_W - totalW) / 2;

  // Clear previous status text band smoothly
  tft.fillRect(0, y - 4, SCREEN_W, 26, C_BG);

  // Status dot
  int dotY = y + ((sz == 2) ? 8 : 4);
  tft.fillCircle(startX + dotR, dotY, dotR, dotColor);

  // Status text
  tft.setTextColor(C_TEXT, C_BG);
  tft.setTextSize(sz);
  tft.setCursor(startX + (dotR * 2) + gap, y);
  tft.print(msg);
}

void drawResultCard(const char *heading, const char *line1, const char *line2, uint16_t badgeColor, bool ok) {
  tft.fillScreen(C_BG);
  tft.setTextWrap(false);

  // 1. Header (Standard unified terminal header)
  tft.setTextColor(C_TEXT, C_BG);
  tft.setTextSize(2);
  tft.setCursor(16, 11);
  tft.print("QuantumClk");
  tft.setTextSize(1);
  tft.setTextColor(C_SUBTEXT, C_BG);
  tft.setCursor(17, 34);
  tft.print("Biometric Attendance Terminal");

  drawLogo(264, 4, 52, 50, 6, C_PRIMARY);
  tft.drawFastHLine(10, 58, 300, C_DIVIDER);

  // 2. Center Card (x=10, y=66, w=300, h=122)
  fillCard(10, 66, 300, 122, C_PANEL);
  outlineCard(10, 66, 300, 122, C_DIVIDER);

  // Status Badge Pill inside card (e.g. CHECKED IN / CHECKED OUT / SHIFT ENDED)
  int badgeW = strlen(heading) * 12 + 28;
  if (badgeW < 140) badgeW = 140;
  if (badgeW > 280) badgeW = 280;
  int badgeX = (SCREEN_W - badgeW) / 2;
  tft.fillRoundRect(badgeX, 78, badgeW, 30, 6, badgeColor);
  tft.setTextColor(C_WHITE, badgeColor);
  tft.setTextSize(2);
  int tw = strlen(heading) * 12;
  tft.setCursor((SCREEN_W - tw) / 2, 85);
  tft.print(heading);

  // Employee Name / Primary Line
  tft.setTextColor(C_TEXT, C_PANEL);
  int nameLen = strlen(line1);
  uint8_t nSz = (nameLen > 18) ? 1 : 2;
  tft.setTextSize(nSz);
  tw = nameLen * (nSz == 2 ? 12 : 6);
  tft.setCursor((SCREEN_W - tw) / 2, 122);
  tft.print(line1);

  // Subtitle / Detail Line
  tft.setTextColor(C_SUBTEXT, C_PANEL);
  tft.setTextSize(1);
  tw = strlen(line2) * 6;
  tft.setCursor((SCREEN_W - tw) / 2, 150);
  tft.print(line2);

  // 3. Footer (Standard terminal footer without date/time)
  tft.fillRect(0, 198, 320, 42, C_PANEL);
  tft.drawFastHLine(0, 198, 320, C_DIVIDER);

  const bool wifiOk = (WiFi.status() == WL_CONNECTED);
  const uint16_t wifiCol = wifiOk ? C_SUCCESS : C_SUBTEXT;
  drawWifiIcon(24, 218, wifiCol);
  tft.setTextColor(wifiCol, C_PANEL);
  tft.setTextSize(1);
  tft.setCursor(38, 215);
  tft.print(wifiOk ? "Connected" : "Offline");

  tft.drawFastVLine(105, 204, 29, C_DIVIDER);
  tft.drawFastVLine(232, 204, 29, C_DIVIDER);

  char enrolledText[24];
  finger.getTemplateCount();
  snprintf(enrolledText, sizeof(enrolledText), "%u/200 enrolled", finger.templateCount);
  tw = strlen(enrolledText) * 6;
  tft.setTextColor(C_TEXT, C_PANEL);
  tft.setTextSize(1);
  tft.setCursor(169 - (tw / 2), 215);
  tft.print(enrolledText);

  tft.fillRoundRect(240, 205, 72, 27, 5, C_PRIMARY);
  drawGearIcon(252, 218, C_WHITE);
  tft.setTextColor(C_WHITE, C_PRIMARY);
  tft.setTextSize(1);
  tft.setCursor(267, 215);
  tft.print("Admin");
}

void showMessage(const char *heading, const char *line1, const char *line2, uint16_t hColor = C_PRIMARY) {
  bool ok = (hColor == C_SUCCESS || strstr(heading, "GRANTED") || strstr(heading, "ENROLLED") || strstr(heading, "SUCCESS") || strstr(heading, "OK"));
  drawResultCard(heading, line1, line2, hColor, ok);
}

void showResult(const char *l1, const char *l2, bool ok, uint16_t icol = 0) {
  if (!icol)
    icol = C_PRIMARY;

  const char *heading = ok ? "ATTENDANCE" : "NOTICE";
  uint16_t badgeColor = icol;

  if (strstr(l2, "Completed") || strstr(l2, "Shift Completed")) {
    heading = "SHIFT ENDED";
    badgeColor = C_SUBTEXT;
  } else if (strstr(l2, "Offline") || strstr(l2, "Not Logged")) {
    heading = "SERVER OFFLINE";
    badgeColor = C_PRIMARY;
  } else if (strstr(l2, "Disconnected")) {
    heading = "NO WI-FI";
    badgeColor = C_PRIMARY;
  } else if (strstr(l2, "Database")) {
    heading = "NOT FOUND";
    badgeColor = C_PRIMARY;
  } else if (strstr(l2, "Verifying") || strstr(l2, "Syncing") || strstr(l2, "Connecting")) {
    heading = "VERIFYING";
    badgeColor = C_PRIMARY;
  } else if (strstr(l2, "LATE") || strstr(l1, "LATE")) {
    heading = "LATE CHECK-IN";
    badgeColor = C_PRIMARY;
  } else if (strstr(l2, "Check-in") || strstr(l2, "CHECK-IN") || strstr(l2, "Checked in")) {
    heading = "CHECKED IN";
    badgeColor = C_SUCCESS;
  } else if (strstr(l2, "Check-out") || strstr(l2, "CHECK-OUT") || strstr(l2, "Checked out")) {
    heading = "CHECKED OUT";
    badgeColor = C_SUBTEXT;
  } else if (strcmp(l1, "ADMIN SLOT") == 0) {
    heading = "ADMIN ONLY";
    badgeColor = C_PRIMARY;
  } else if (strcmp(l1, "NOT RECOGNISED") == 0) {
    heading = "NOT RECOGNISED";
    badgeColor = C_PRIMARY;
  } else if (ok) {
    heading = "SUCCESS";
    badgeColor = C_SUCCESS;
  } else {
    heading = l1;
  }

  drawResultCard(heading, l1, l2, badgeColor, ok);
}

void showDeleteConfirmation(const char *name) {
  tft.fillScreen(C_BG);
  tft.setTextWrap(false);
  tft.setTextColor(C_TEXT, C_BG);
  tft.setTextSize(2);
  tft.setCursor(72, 61);
  tft.print("DELETE EMPLOYEE?");
  int tw = strlen(name) * 12;
  tft.setCursor((SCREEN_W - tw) / 2, 103);
  tft.print(name);

  // YES button
  tft.fillRoundRect(25, 155, 125, 48, 7, C_PRIMARY);
  tft.setTextColor(C_WHITE, C_PRIMARY);
  tft.setTextSize(2);
  tft.setCursor(66, 171);
  tft.print("YES");

  // NO button
  fillCard(170, 155, 125, 48, C_PANEL);
  outlineCard(170, 155, 125, 48, C_DIVIDER);
  tft.setTextColor(C_TEXT, C_PANEL);
  tft.setTextSize(2);
  tft.setCursor(214, 171);
  tft.print("NO");
}

void drawHomeScreen() {
  currentScreen = SCR_HOME;
  tft.fillScreen(C_BG);
  tft.setTextWrap(false);

  // Header (matches Photo 1)
  tft.setTextColor(C_TEXT, C_BG);
  tft.setTextSize(2);
  tft.setCursor(16, 11);
  tft.print("QuantumClk");
  tft.setTextSize(1);
  tft.setTextColor(C_SUBTEXT, C_BG);
  tft.setCursor(17, 34);
  tft.print("Biometric Attendance");

  // Red logo container top-right using logo.h
  drawLogo(264, 4, 52, 50, 6, C_PRIMARY);
  tft.drawFastHLine(10, 58, 300, C_DIVIDER);

  // Centered high-resolution 96x96 fingerprint directly from PROGMEM
  drawFingerprintIcon(112, 66, C_TEXT);

  const bool wifiOk = (WiFi.status() == WL_CONNECTED);
  if (wifiOk) {
    drawStatusIndicator("Ready to scan", C_SUCCESS, 172);
  } else {
    drawStatusIndicator("Wi-Fi Required - Scan Disabled", C_PRIMARY, 172);
  }

  // Three-part footer (y=198 to 240, h=42)
  tft.fillRect(0, 198, 320, 42, C_PANEL);
  tft.drawFastHLine(0, 198, 320, C_DIVIDER);

  const uint16_t wifiCol = wifiOk ? C_SUCCESS : C_PRIMARY;
  drawWifiIcon(24, 218, wifiCol);
  tft.setTextColor(wifiCol, C_PANEL);
  tft.setTextSize(1);
  tft.setCursor(38, 215);
  tft.print(wifiOk ? "Connected" : "No Wi-Fi");

  tft.drawFastVLine(105, 204, 29, C_DIVIDER);
  tft.drawFastVLine(232, 204, 29, C_DIVIDER);

  // Enrolled count
  char enrolledText[24];
  finger.getTemplateCount();
  snprintf(enrolledText, sizeof(enrolledText), "%u/200 enrolled", finger.templateCount);
  int tw = strlen(enrolledText) * 6;
  tft.setTextColor(C_TEXT, C_PANEL);
  tft.setTextSize(1);
  tft.setCursor(169 - (tw / 2), 215);
  tft.print(enrolledText);

  // Red Admin button with gear icon
  tft.fillRoundRect(240, 205, 72, 27, 5, C_PRIMARY);
  drawGearIcon(252, 218, C_WHITE);
  tft.setTextColor(C_WHITE, C_PRIMARY);
  tft.setTextSize(1);
  tft.setCursor(267, 215);
  tft.print("Admin");
}

void drawScanningScreen(const char *msg = "Verifying...") {
  currentScreen = SCR_SCANNING;
  drawStatusIndicator(msg, C_PRIMARY, 172);
  animateScanLaser(112, 66, C_PRIMARY);
}

void runAttendanceScan() {
  // Device requires active Wi-Fi — DO NOT run attendance if Wi-Fi is unavailable
  if (WiFi.status() != WL_CONNECTED) {
    playBeep(700, 150);
    showResult("NO WI-FI", "Device cannot run without Wi-Fi", false, C_PRIMARY);
    fpWaitLift();
    delay(2000);
    drawHomeScreen();
    return;
  }

  currentScreen = SCR_SCANNING;

  // 1. Futuristic laser scan beam sweeping down through fingerprint ridges
  drawStatusIndicator("Scanning fingerprint...", C_PRIMARY, 172);
  animateScanLaser(112, 66, C_PRIMARY);

  if (finger.image2Tz() != FINGERPRINT_OK) {
    drawStatusIndicator("Poor placement - Lift & try again", C_PRIMARY, 172);
    playBeep(700, 100);
    delay(1200);
    drawHomeScreen();
    return;
  }

  int r = finger.fingerFastSearch();

  if (r == FINGERPRINT_OK) {
    uint8_t id = finger.fingerID;
    if (id == ADMIN_FP_SLOT) {
      playBeep(600, 200);
      showResult("ADMIN SLOT", "Not an employee profile", false, C_SUBTEXT);
      fpWaitLift();
      delay(RESULT_DWELL);
      drawHomeScreen();
      return;
    }
    char ts[28];
    clk.fmtFull(ts, sizeof(ts));
    const char *name = (strlen(empNames[id]) > 0) ? empNames[id] : "Unknown";

    uint32_t currentDay = clk.now() / 86400UL;
    // Smart Local Reset: If last check-in was on a previous day, auto-reset
    // checkedIn to false for new day
    if (checkedIn[id] && lastCheckInDay[id] != 0 &&
        lastCheckInDay[id] < currentDay) {
      saveCheckedIn(id, false);
      Serial.printf("[LOCAL RESET] Auto-reset forgotten checkout for slot %d "
                    "from day %u to day %u\n",
                    id, lastCheckInDay[id], currentDay);
    }

    // Check if employee has ALREADY completed check-in and check-out today!
    if (!checkedIn[id] && lastCheckInDay[id] == currentDay && lastCheckOutDay[id] == currentDay && lastCheckInDay[id] != 0) {
      showResult(name, "Shift Completed For Today", false, C_SUBTEXT);
      playBeep(600, 100);
      delay(60);
      playBeep(800, 120);
      Serial.printf("EVENT : REJECTED (Already checked in and checked out for today)\nNAME  : %s\n", name);
      fpWaitLift();
      delay(RESULT_DWELL);
      drawHomeScreen();
      return;
    }

    // Biometric match verified! Illuminate fingerprint in emerald green and show connecting badge
    drawFingerprintIcon(112, 66, C_SUCCESS);
    char connectingMsg[48];
    snprintf(connectingMsg, sizeof(connectingMsg), "Verified: %s", name);
    drawStatusIndicator(connectingMsg, C_SUCCESS, 172);

    // Perform HTTP sync request - RECORDED IN CLOUD DATABASE
    const char *desiredAction = (!checkedIn[id]) ? "IN" : "OUT";
    String confirmedAction = desiredAction;
    int syncRes = sendAttendanceLogToServer(id, desiredAction, name, &confirmedAction);

    if (syncRes == 2) {
      // Server confirmed: Shift already completed for today!
      lastCheckOutDay[id] = currentDay;
      saveCheckedIn(id, false);
      showResult(name, "Shift Completed For Today", false, C_SUBTEXT);
      playBeep(600, 100);
      delay(60);
      playBeep(800, 120);
      Serial.println("---ATTENDANCE---");
      Serial.printf("EVENT : SHIFT ALREADY COMPLETED\nNAME  : %s\nTIME  : %s\n", name, ts);
      Serial.println("----------------");
    } else if (syncRes >= 0) {
      // Entry successfully recorded on the website!
      if (confirmedAction == "IN") {
        saveCheckedIn(id, true);
        if (syncRes == 1) {
          showResult(name, "Late check-in recorded", true, C_PRIMARY);
        } else {
          showResult(name, "Checked in successfully", true, C_SUCCESS);
        }
        sfxCheckin();
      } else {
        saveCheckedIn(id, false);
        showResult(name, "Checked out successfully", true, C_SUBTEXT);
        sfxCheckout();
      }
      Serial.println("---ATTENDANCE---");
      Serial.printf("EVENT : %s\nNAME  : %s\nTIME  : %s\nSYNC  : ONLINE\n",
                    confirmedAction.c_str(), name, ts);
      Serial.println("----------------");
    } else {
      // Server offline / sync failed: DO NOT log attendance, DO NOT say check-in, DO NOT say invalid fingerprint
      const char *errMsg = "Server Offline - Not Logged";
      if (syncRes == -1) errMsg = "Wi-Fi Disconnected";
      else if (syncRes == -3) errMsg = "Not in Web Database";

      showResult(name, errMsg, false, C_PRIMARY);
      playBeep(700, 120);
      delay(80);
      playBeep(700, 120);

      Serial.println("---ATTENDANCE REJECTED---");
      Serial.printf("EVENT : %s (NOT LOGGED)\nNAME  : %s\nREASON: %s\n",
                    desiredAction, name, errMsg);
      Serial.println("-------------------------");
    }
  } else {
    sfxInvalid();
    drawFingerprintIcon(112, 66, C_PRIMARY);
    showResult("NOT RECOGNISED", "Please enrol with admin", false, C_PRIMARY);
    Serial.println("ATTENDANCE: No match");
  }
  fpWaitLift();
  delay(RESULT_DWELL);
  drawHomeScreen();
}

bool runPinScreen() {
  char pinBuf[10] = "";
  int pinLen = 0;
  tft.fillScreen(C_BG);

  auto drawPinField = [&]() {
    tft.fillRoundRect(75, 70, 170, 30, 5, C_WHITE);
    tft.drawRoundRect(75, 70, 170, 30, 5, C_PRIMARY);
    tft.setTextColor(C_TEXT, C_WHITE);
    tft.setTextSize(2);
    char mask[10] = "";
    for (int i = 0; i < pinLen; i++)
      mask[i] = '*';
    mask[pinLen] = '\0';
    int tw = pinLen * 12;
    tft.setCursor(75 + (170 - tw) / 2, 77);
    tft.print(mask);
  };

  auto drawKeypad = [&]() {
    drawHeader("Setup Admin", "Enter password to verify");
    drawPinField();

    // 1 to 9
    for (int r = 0; r < 3; r++) {
      for (int c = 0; c < 3; c++) {
        int num = r * 3 + c + 1;
        char lbl[2] = {(char)('0' + num), 0};
        drawKey(75 + c * 60, 110 + r * 30, 50, 26, lbl, C_WHITE, C_TEXT);
      }
    }
    // Bottom row
    drawKey(75, 200, 50, 26, "DEL", C_PRIMARY, C_WHITE);
    drawKey(135, 200, 50, 26, "0", C_WHITE, C_TEXT);
    drawKey(195, 200, 50, 26, "OK", C_PRIMARY, C_WHITE);

    drawGhostBtn(8, 208, 60, 26, "< Back", C_SUBTEXT);
  };

  drawKeypad();

  unsigned long start = millis();
  while (millis() - start < 45000UL) {
    TPoint t = readTouch();
    if (!t.valid) {
      delay(12);
      continue;
    }
    // Cancel/Back
    if (hit(t, 8, 208, 60, 26)) {
      return false;
    }
    // Number keys 1-9
    for (int r = 0; r < 3; r++) {
      for (int c = 0; c < 3; c++) {
        int num = r * 3 + c + 1;
        if (hit(t, 75 + c * 60, 110 + r * 30, 50, 26)) {
          if (pinLen < 8) {
            char lbl[2] = {(char)('0' + num), 0};
            drawKey(75 + c * 60, 110 + r * 30, 50, 26, lbl, C_PRIMARY, C_WHITE);
            delay(40);
            drawKey(75 + c * 60, 110 + r * 30, 50, 26, lbl, C_WHITE, C_TEXT);
            pinBuf[pinLen++] = '0' + num;
            pinBuf[pinLen] = '\0';
            drawPinField();
            delay(50);
          }
        }
      }
    }
    // 0 key
    if (hit(t, 135, 200, 50, 26)) {
      if (pinLen < 8) {
        drawKey(135, 200, 50, 26, "0", C_PRIMARY, C_WHITE);
        delay(40);
        drawKey(135, 200, 50, 26, "0", C_WHITE, C_TEXT);
        pinBuf[pinLen++] = '0';
        pinBuf[pinLen] = '\0';
        drawPinField();
        delay(50);
      }
    }
    // DEL key
    if (hit(t, 75, 200, 50, 26)) {
      if (pinLen > 0) {
        drawKey(75, 200, 50, 26, "DEL", C_WHITE, C_PRIMARY);
        delay(40);
        drawKey(75, 200, 50, 26, "DEL", C_PRIMARY, C_WHITE);
        pinBuf[--pinLen] = '\0';
        drawPinField();
        delay(50);
      }
    }
    // OK key
    if (hit(t, 195, 200, 50, 26)) {
      drawKey(195, 200, 50, 26, "OK", C_WHITE, C_PRIMARY);
      delay(50);
      drawKey(195, 200, 50, 26, "OK", C_PRIMARY, C_WHITE);
      if (strcmp(pinBuf, "123456") == 0) {
        sfxValid();
        return true;
      } else {
        playBeep(600, 300); // low fail beep
        tft.fillScreen(C_BG);
        printCenter("WRONG PASSWORD", 110, C_PRIMARY, 2, C_BG);
        delay(1500);
        drawKeypad();
        pinLen = 0;
        pinBuf[0] = '\0';
      }
    }
  }
  return false;
}

void drawAdminAuthScreen() {
  currentScreen = SCR_ADMIN_AUTH;
  tft.fillScreen(C_BG);
  tft.setTextWrap(false);

  // Authentication title pill (Photo 4)
  tft.fillRoundRect(8, 12, 304, 44, 6, C_PRIMARY);
  tft.setTextColor(C_WHITE, C_PRIMARY);
  tft.setTextSize(2);
  tft.setCursor(100, 27);
  tft.print("ADMIN AUTH");

  // Main instruction card (Photo 4)
  fillCard(8, 66, 304, 104, C_PANEL);
  outlineCard(8, 66, 304, 104, C_DIVIDER);
  tft.setTextColor(C_TEXT, C_PANEL);
  tft.setTextSize(2);
  tft.setCursor(52, 91);
  tft.print("Place admin finger");
  tft.setTextColor(C_SUBTEXT, C_PANEL);
  tft.setTextSize(1);
  tft.setCursor(101, 130);
  tft.print("Verification required");

  // Bottom buttons (Photo 4)
  tft.fillRoundRect(10, 188, 92, 38, 6, C_PRIMARY);
  tft.setTextColor(C_WHITE, C_PRIMARY);
  tft.setTextSize(2);
  tft.setCursor(32, 199);
  tft.print("BACK");

  tft.fillRoundRect(214, 188, 98, 38, 6, C_PRIMARY);
  tft.setTextColor(C_WHITE, C_PRIMARY);
  tft.setTextSize(1);
  tft.setCursor(235, 203);
  tft.print("USE PIN");
}

bool runAdminAuth() {
  if (!adminEnrolled) {
    if (runPinScreen()) {
      return true; // PIN success -> open manage menu directly!
    }
    drawHomeScreen();
    return false;
  }

  drawAdminAuthScreen();

  unsigned long start = millis();
  while (true) {
    TPoint t = readTouch();
    if (hit(t, 10, 188, 92, 38)) {
      buttonTouchFeedback(10, 188, 92, 38, C_PRIMARY, "BACK");
      drawHomeScreen();
      return false;
    }
    if (hit(t, 214, 188, 98, 38)) {
      buttonTouchFeedback(214, 188, 98, 38, C_PRIMARY, "USE PIN");
      if (runPinScreen()) {
        return true; // PIN success -> open manage menu directly!
      }
      drawHomeScreen();
      return false;
    }
    if (millis() - start > FP_SCAN_TIMEOUT) {
      showMessage("TIMEOUT", "Verification timed out", "Returning to home screen", C_PRIMARY);
      delay(1200);
      drawHomeScreen();
      return false;
    }
    int fr = finger.getImage();
    if (fr == FINGERPRINT_NOFINGER) {
      delay(30);
      continue;
    }
    if (fr != FINGERPRINT_OK) {
      delay(30);
      continue;
    }
    if (finger.image2Tz() != FINGERPRINT_OK) {
      delay(30);
      continue;
    }
    fr = finger.fingerFastSearch();
    if (fr == FINGERPRINT_OK && finger.fingerID == ADMIN_FP_SLOT) {
      sfxValid();
      fpWaitLift();
      showMessage("ACCESS GRANTED", "Administrator verified", "Opening menu", C_PRIMARY);
      delay(1200);
      return true;
    }
    sfxInvalid();
    showMessage("ACCESS DENIED", "Not an admin fingerprint", "Admin only", C_PRIMARY);
    fpWaitLift();
    delay(1800);
    drawAdminAuthScreen();
    start = millis();
  }
}

void drawManageScreen() {
  currentScreen = SCR_MANAGE;
  drawHeader("Admin Panel", "Manage employees & settings");

  // Row 1: ENROLL and DELETE (y = 68 to 116, h = 48)
  tft.fillRoundRect(15, 68, 140, 48, 7, C_PRIMARY);
  tft.setTextColor(C_WHITE, C_PRIMARY);
  tft.setTextSize(2);
  tft.setCursor(42, 84);
  tft.print("ENROLL");

  tft.fillRoundRect(165, 68, 140, 48, 7, C_PRIMARY);
  tft.setCursor(192, 84);
  tft.print("DELETE");

  // Row 2: EMPLOYEES and CHANGE ADMIN (y = 124 to 167, h = 43)
  fillCard(15, 124, 140, 43, C_PANEL);
  outlineCard(15, 124, 140, 43, C_DIVIDER);
  tft.setTextColor(C_TEXT, C_PANEL);
  tft.setTextSize(1);
  tft.setCursor(54, 141);
  tft.print("EMPLOYEES");

  fillCard(165, 124, 140, 43, C_PANEL);
  outlineCard(165, 124, 140, 43, C_DIVIDER);
  tft.setCursor(184, 141);
  tft.print("CHANGE ADMIN");

  // Row 3: BACK (y = 178 to 220, h = 42, full-width balanced button)
  tft.fillRoundRect(15, 178, 290, 42, 7, C_PRIMARY);
  tft.setTextColor(C_WHITE, C_PRIMARY);
  tft.setTextSize(2);
  tft.setCursor(134, 191);
  tft.print("BACK");
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  QWERTY KEYBOARD SETUP (Exact Match to Device Photo)
// ═══════════════════════════════════════════════════════════
const char *KB_ROW0 = "QWERTYUIOP";
const char *KB_ROW1 = "ASDFGHJKL";
const char *KB_ROW2 = "ZXCVBNM";

void drawNameField() {
  tft.fillRoundRect(12, 22, 296, 34, 4, C_WHITE);
  tft.drawRoundRect(12, 22, 296, 34, 4, C_DIVIDER);
  tft.setTextColor(C_TEXT, C_WHITE);
  tft.setTextSize(2);
  char d[NAME_MAX_LEN + 3];
  snprintf(d, sizeof(d), "%s|", nameBuf);
  tft.setCursor(20, 31);
  tft.print(d);
}

void drawQwertyScreen() {
  tft.fillScreen(C_BG);

  // Top header label: EMPLOYEE NAME
  tft.setTextColor(C_TEXT, C_BG);
  tft.setTextSize(1);
  tft.setCursor(14, 8);
  tft.print("EMPLOYEE NAME");

  drawNameField();

  // Row 0 (y = 66, h = 34): 10 keys (q w e r t y u i o p)
  for (int i = 0; i < 10; i++) {
    char lbl[2] = {capsOn ? KB_ROW0[i] : (char)(KB_ROW0[i] + 32), 0};
    drawKey(7 + i * 31, 66, 28, 34, lbl, C_PANEL, C_TEXT);
  }

  // Row 1 (y = 106, h = 34): 9 keys (a s d f g h j k l)
  for (int i = 0; i < 9; i++) {
    char lbl[2] = {capsOn ? KB_ROW1[i] : (char)(KB_ROW1[i] + 32), 0};
    drawKey(22 + i * 31, 106, 28, 34, lbl, C_PANEL, C_TEXT);
  }

  // Row 2 (y = 146, h = 34): 7 keys (z x c v b n m)
  for (int i = 0; i < 7; i++) {
    char lbl[2] = {capsOn ? KB_ROW2[i] : (char)(KB_ROW2[i] + 32), 0};
    drawKey(53 + i * 31, 146, 28, 34, lbl, C_PANEL, C_TEXT);
  }

  // Row 3 (y = 188, h = 38): CANCEL | CAPS | DEL | SPACE | OK (Red)
  drawKey(5, 188, 58, 38, "CANCEL", C_PANEL, C_TEXT);
  drawKey(67, 188, 50, 38, "CAPS", capsOn ? C_PRIMARY : C_PANEL,
          capsOn ? C_WHITE : C_TEXT, capsOn ? C_PRIMARY : C_DIVIDER);
  drawKey(121, 188, 46, 38, "DEL", C_PANEL, C_TEXT);
  drawKey(171, 188, 84, 38, "SPACE", C_PANEL, C_TEXT);
  drawKey(259, 188, 56, 38, "OK", C_PRIMARY, C_WHITE, C_PRIMARY);
}

bool letterHit(TPoint &t, char *ch) {
  const char *rows[3] = {KB_ROW0, KB_ROW1, KB_ROW2};
  const int xofs[3] = {7, 22, 53};
  const int ys[3] = {66, 106, 146};
  const int lens[3] = {10, 9, 7};
  for (int r = 0; r < 3; r++) {
    for (int i = 0; i < lens[r]; i++) {
      int x = xofs[r] + i * 31;
      if (hit(t, x, ys[r], 28, 34)) {
        *ch = capsOn ? rows[r][i] : (char)(rows[r][i] + 32);
        char lbl[2] = {*ch, 0};
        drawKey(x, ys[r], 28, 34, lbl, C_WHITE, C_PRIMARY);
        delay(35);
        drawKey(x, ys[r], 28, 34, lbl, C_PANEL, C_TEXT);
        return true;
      }
    }
  }
  return false;
}

bool runQwerty() {
  nameLen = 0;
  nameBuf[0] = '\0';
  capsOn = false;
  currentScreen = SCR_QWERTY;
  drawQwertyScreen();
  unsigned long start = millis();
  while (millis() - start < 60000UL) {
    TPoint t = readTouch();
    if (!t.valid) {
      delay(12);
      continue;
    }
    // CANCEL button
    if (hit(t, 5, 188, 58, 38)) {
      drawKey(5, 188, 58, 38, "CANCEL", C_WHITE, C_PRIMARY);
      delay(40);
      return false;
    }
    // CAPS button
    if (hit(t, 67, 188, 50, 38)) {
      capsOn = !capsOn;
      drawQwertyScreen();
      delay(50);
      continue;
    }
    // DEL button
    if (hit(t, 121, 188, 46, 38)) {
      drawKey(121, 188, 46, 38, "DEL", C_WHITE, C_PRIMARY);
      delay(35);
      drawKey(121, 188, 46, 38, "DEL", C_PANEL, C_TEXT);
      if (nameLen > 0) {
        nameBuf[--nameLen] = '\0';
        drawNameField();
      }
      delay(40);
      continue;
    }
    // SPACE button
    if (hit(t, 171, 188, 84, 38)) {
      drawKey(171, 188, 84, 38, "SPACE", C_WHITE, C_PRIMARY);
      delay(35);
      drawKey(171, 188, 84, 38, "SPACE", C_PANEL, C_TEXT);
      if (nameLen < NAME_MAX_LEN && nameLen > 0) {
        nameBuf[nameLen++] = ' ';
        nameBuf[nameLen] = '\0';
        drawNameField();
      }
      delay(40);
      continue;
    }
    // OK button (Red)
    if (hit(t, 259, 188, 56, 38)) {
      drawKey(259, 188, 56, 38, "OK", C_WHITE, C_PRIMARY);
      delay(40);
      if (nameLen > 0) {
        sfxValid();
        return true;
      }
      drawKey(259, 188, 56, 38, "OK", C_PRIMARY, C_WHITE, C_PRIMARY);
      continue;
    }

    char ch = 0;
    if (letterHit(t, &ch) && nameLen < NAME_MAX_LEN) {
      nameBuf[nameLen++] = ch;
      nameBuf[nameLen] = '\0';
      drawNameField();
      delay(40);
    }
  }
  return false;
}

bool runConfirmScreen(const char *name) {
  currentScreen = SCR_CONFIRM;
  drawHeader("Confirm Enrol", "Review before fingerprint scan");

  drawRule(70);

  tft.setTextColor(C_SUBTEXT, C_BG);
  tft.setTextSize(1);
  tft.setCursor(10, 66);
  tft.print("Enrolling employee:");

  fillCard(10, 76, 300, 52, C_WHITE);
  outlineCard(10, 76, 300, 52, C_DIVIDER);
  tft.setTextColor(C_TEXT, C_WHITE);
  tft.setTextSize(2);
  int tw = strlen(name) * 12;
  if (tw > 284) {
    tft.setTextSize(1);
    tw = strlen(name) * 6;
  }
  tft.setCursor((SCREEN_W - tw) / 2, 92);
  tft.print(name);

  tft.setTextColor(C_SUBTEXT, C_BG);
  tft.setTextSize(1);
  tw = strlen("Fingerprint scan follows — place same finger twice") * 6;
  tft.setCursor((SCREEN_W - tw) / 2, 138);
  tft.print("Fingerprint scan follows — place same finger twice");

  drawRule(150);

  drawBtn(10, 158, 146, 44, "CONFIRM");
  drawGhostBtn(164, 158, 146, 44, "EDIT", C_SUBTEXT);

  unsigned long start = millis();
  while (millis() - start < 30000UL) {
    TPoint t = readTouch();
    if (hit(t, 10, 158, 146, 44))
      return true;
    if (hit(t, 164, 158, 146, 44))
      return false;
    delay(12);
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
//  FINGERPRINT ENROLLMENT FLOW
// ═══════════════════════════════════════════════════════════
#define FP_CANCELLED 98
#define FP_TIMEOUT 99

int getFingerImageOrCancel() {
  unsigned long start = millis();
  while (true) {
    TPoint t = readTouch();
    if (hit(t, 10, 206, 80, 24)) {
      return FP_CANCELLED;
    }

    handleSerial();
    if (millis() - start > FP_SCAN_TIMEOUT) {
      return FP_TIMEOUT;
    }

    int r = finger.getImage();
    if (r == FINGERPRINT_OK)
      return FINGERPRINT_OK;
    if (r != FINGERPRINT_NOFINGER)
      return r;

    delay(30);
  }
}

void runEnroll() {
  while (true) {
    if (!runQwerty()) {
      drawHomeScreen();
      return;
    }
    if (runConfirmScreen(nameBuf))
      break;
  }
  strncpy(pendingName, nameBuf, NAME_MAX_LEN);
  pendingName[NAME_MAX_LEN] = '\0';
  pendingSlot = findFreeSlot();
  if (pendingSlot == 0) {
    showResult("SENSOR FULL", "Delete an employee first", false, C_SUBTEXT);
    delay(RESULT_DWELL);
    drawHomeScreen();
    return;
  }

  currentScreen = SCR_ENROLL_FP;

  auto banner = [&](const char *l1, const char *l2) {
    drawHeader("Enrol Fingerprint");
    fillCard(10, 58, 300, 134, C_WHITE);
    outlineCard(10, 58, 300, 134, C_DIVIDER);

    tft.setTextColor(C_SUBTEXT, C_WHITE);
    tft.setTextSize(1);
    char topMsg[48];
    snprintf(topMsg, sizeof(topMsg), "Enrolling: %s", pendingName);
    int tw = strlen(topMsg) * 6;
    tft.setCursor((SCREEN_W - tw) / 2, 66);
    tft.print(topMsg);

    drawFpRing(C_PRIMARY, 160, 116);

    tft.setTextColor(C_TEXT, C_WHITE);
    tft.setTextSize(2);
    tw = strlen(l1) * 12;
    tft.setCursor((SCREEN_W - tw) / 2, 158);
    tft.print(l1);

    tft.setTextColor(C_SUBTEXT, C_WHITE);
    tft.setTextSize(1);
    tw = strlen(l2) * 6;
    tft.setCursor((SCREEN_W - tw) / 2, 178);
    tft.print(l2);

    drawGhostBtn(10, 206, 80, 24, "Cancel", C_SUBTEXT);
  };

  while (true) {
    banner("PLACE ON SENSOR", "Scan 1 of 2");

    int r;
    bool step1_ok = false;
    while (true) {
      r = getFingerImageOrCancel();
      if (r == FP_CANCELLED) {
        drawHomeScreen();
        return;
      }
      if (r == FP_TIMEOUT) {
        showResult("TIMED OUT", "Enrollment cancelled", false, C_SUBTEXT);
        delay(1500);
        drawHomeScreen();
        return;
      }
      if (r == FINGERPRINT_OK) {
        if (finger.image2Tz(1) == FINGERPRINT_OK) {
          step1_ok = true;
          break;
        } else {
          showResult("Poor Finger Placement", "Try scanning again", false, C_SUBTEXT);
          delay(2000);
          break;
        }
      }
      showResult("CAPTURE ERROR", "Sensor error occurred", false, C_SUBTEXT);
      delay(2000);
      break;
    }

    if (!step1_ok) {
      continue;
    }

    banner("LIFT FINGER", "Scan 1 OK — lift now");
    unsigned long liftStart = millis();
    while (finger.getImage() != FINGERPRINT_NOFINGER) {
      TPoint t = readTouch();
      if (hit(t, 10, 206, 80, 24)) {
        drawHomeScreen();
        return;
      }
      if (millis() - liftStart > 5000)
        break;
      delay(50);
    }
    delay(500);

    banner("PLACE SAME FINGER", "Scan 2 of 2");
    bool step2_ok = false;
    while (true) {
      r = getFingerImageOrCancel();
      if (r == FP_CANCELLED) {
        drawHomeScreen();
        return;
      }
      if (r == FP_TIMEOUT) {
        showResult("TIMED OUT", "Enrollment cancelled", false, C_SUBTEXT);
        delay(1500);
        drawHomeScreen();
        return;
      }
      if (r == FINGERPRINT_OK) {
        if (finger.image2Tz(2) == FINGERPRINT_OK) {
          step2_ok = true;
          break;
        } else {
          showResult("Poor Finger Placement", "Try scanning again", false, C_SUBTEXT);
          delay(2000);
          break;
        }
      }
      showResult("CAPTURE ERROR", "Sensor error occurred", false, C_SUBTEXT);
      delay(2000);
      break;
    }

    if (!step2_ok) {
      continue;
    }

    if (finger.createModel() != FINGERPRINT_OK) {
      showResult("Mismatch", "Use the same finger both times", false,
                 C_SUBTEXT);
      delay(2000);
      continue;
    }

    if (finger.storeModel(pendingSlot) != FINGERPRINT_OK) {
      showResult("Store Failed", "Sensor may be full", false, C_SUBTEXT);
      delay(2000);
      continue;
    }

    break;
  }

  saveEmpName(pendingSlot, pendingName);

  sendEnrollmentToServer(pendingSlot, pendingName);

  char det2[32];
  snprintf(det2, sizeof(det2), "Enrolled: %s", pendingName);
  showResult("ENROLLED!", det2, true, C_SUCCESS);
  Serial.printf("ENROLL OK: %s  slot=%d\n", pendingName, pendingSlot);
  sfxEnrolled();
  fpWaitLift();
  delay(RESULT_DWELL);
  drawHomeScreen();
}

// ═══════════════════════════════════════════════════════════
//  DELETE EMPLOYEE VIEW
// ═══════════════════════════════════════════════════════════
uint8_t delScroll = 0;

bool executeDeleteConfirmation(uint8_t slot) {
  currentScreen = SCR_DELETE;
  showDeleteConfirmation(empNames[slot]);

  unsigned long ct = millis();
  while (millis() - ct < 15000UL) {
    TPoint c = readTouch();
    if (!c.valid) {
      delay(15);
      continue;
    }
    if (hit(c, 25, 155, 125, 48)) {
      if (finger.deleteModel(slot) == FINGERPRINT_OK) {
        char msg[32];
        snprintf(msg, sizeof(msg), "%s removed", empNames[slot]);
        saveCheckedIn(slot, false);
        sendDeletionToServer(slot);
        clearEmpName(slot);
        showResult("DELETED", msg, true, C_SUCCESS);
        Serial.printf("DELETE OK: ID %d\n", slot);
      } else {
        showResult("ERROR", "Sensor returned an error", false, C_SUBTEXT);
      }
      delay(RESULT_DWELL);
      return true;
    }
    if (hit(c, 170, 155, 125, 48)) {
      return false; // Cancelled
    }
    delay(15);
  }
  return false;
}

void drawDeleteList() {
  currentScreen = SCR_DELETE;
  drawHeader("Employee Roster", "Tap [DEL] or row to remove");

  uint8_t ids[MAX_EMPLOYEES];
  uint8_t cnt = 0;
  for (uint8_t i = 1; i <= MAX_EMPLOYEES; i++)
    if (strlen(empNames[i]) > 0)
      ids[cnt++] = i;

  if (cnt == 0) {
    fillCard(40, 90, 240, 80, C_WHITE);
    outlineCard(40, 90, 240, 80, C_DIVIDER);
    printCenter("No employees enrolled", 126, C_SUBTEXT, 1, C_WHITE);
    drawBackBtn(120, 208, 80, 26);
    return;
  }

  drawRule(70);

  // Limit display rows to 4 to prevent overlapping bottom controls
  int rH = 28, sY = 70;
  for (int r = 0; r < 4; r++) {
    int idx = delScroll + r;
    if (idx >= cnt)
      break;
    uint8_t id = ids[idx];
    uint16_t rowBg = (r % 2 == 0) ? C_WHITE : C_BG;
    tft.fillRect(0, sY + r * rH, SCREEN_W, rH, rowBg);

    // Employee Name
    tft.setTextColor(C_TEXT, rowBg);
    tft.setTextSize(1);
    tft.setCursor(10, sY + r * rH + 10);
    char dispName[22];
    strncpy(dispName, empNames[id], sizeof(dispName));
    dispName[sizeof(dispName) - 1] = '\0';
    if (strlen(dispName) > 17) {
      dispName[16] = '.';
      dispName[17] = '\0';
    }
    tft.print(dispName);

    // Status badge (IN / OUT)
    const char *st = checkedIn[id] ? "IN" : "OUT";
    uint16_t sc = checkedIn[id] ? C_SUCCESS : C_SUBTEXT;
    tft.fillRoundRect(196, sY + r * rH + 4, 44, 20, 4, sc);
    tft.setTextColor(C_WHITE, sc);
    tft.setCursor(208, sY + r * rH + 9);
    tft.print(st);

    // RED DIRECT DELETE BUTTON WITH TRASH ICON + "DEL"
    tft.fillRoundRect(248, sY + r * rH + 4, 64, 20, 4, C_PRIMARY);
    // Mini trash icon
    tft.drawFastHLine(254, sY + r * rH + 8, 7, C_WHITE);
    tft.drawFastHLine(256, sY + r * rH + 6, 3, C_WHITE);
    tft.drawRect(255, sY + r * rH + 9, 5, 7, C_WHITE);
    // DEL text
    tft.setTextColor(C_WHITE, C_PRIMARY);
    tft.setCursor(266, sY + r * rH + 9);
    tft.print("DEL");
  }

  tft.fillRect(0, 184, SCREEN_W, 6, C_BG);
  if (delScroll > 0) {
    drawGhostBtn(6, 208, 52, 26, "^ UP", C_SUBTEXT);
  }
  if (delScroll + 4 < cnt) {
    drawGhostBtn(62, 208, 66, 26, "DOWN v", C_SUBTEXT);
  }
  drawBtn(134, 208, 120, 26, "DEL BY NAME", C_PRIMARY, C_WHITE);
  drawBackBtn(260, 208, 54, 26);
}

void runDelete() {
  delScroll = 0;
  while (true) {
    drawDeleteList();

    uint8_t ids[MAX_EMPLOYEES];
    uint8_t cnt = 0;
    for (uint8_t i = 1; i <= MAX_EMPLOYEES; i++)
      if (strlen(empNames[i]) > 0)
        ids[cnt++] = i;

    if (cnt == 0) {
      while (true) {
        TPoint t = readTouch();
        if (t.valid && hit(t, 120, 208, 80, 26)) {
          drawHomeScreen();
          return;
        }
        delay(15);
      }
    }

    bool needRedisplay = false;
    unsigned long start = millis();
    while (millis() - start < 30000UL) {
      TPoint t = readTouch();
      if (!t.valid) {
        delay(15);
        continue;
      }

      if (hit(t, 260, 208, 54, 26)) {
        drawHomeScreen();
        return;
      }

      if (hit(t, 6, 208, 52, 26) && delScroll > 0) {
        delScroll = (delScroll > 4 ? delScroll - 4 : 0);
        needRedisplay = true;
        break;
      }

      if (hit(t, 62, 208, 66, 26) && delScroll + 4 < cnt) {
        delScroll += 4;
        needRedisplay = true;
        break;
      }

      // 1. Direct Tap on any Employee Row or its [DEL] button
      int sY = 70, rH = 28;
      if (t.y >= sY && t.y < sY + 4 * rH && t.x < SCREEN_W) {
        int rClick = (t.y - sY) / rH;
        if (rClick >= 0 && rClick < 4 && (delScroll + rClick) < cnt) {
          uint8_t targetSlot = ids[delScroll + rClick];
          executeDeleteConfirmation(targetSlot);
          needRedisplay = true;
          break;
        }
      }

      // 2. DEL BY NAME (Search with QWERTY keyboard)
      if (hit(t, 134, 208, 120, 26)) {
        if (!runQwerty()) {
          needRedisplay = true;
          break;
        }

        int matchedSlot = -1;
        String searchName = String(nameBuf);
        searchName.trim();
        searchName.toLowerCase();

        for (int i = 1; i <= MAX_EMPLOYEES; i++) {
          if (strlen(empNames[i]) > 0) {
            String empName = String(empNames[i]);
            empName.trim();
            empName.toLowerCase();
            if (empName == searchName) {
              matchedSlot = i;
              break;
            }
          }
        }

        if (matchedSlot == -1) {
          showResult("NOT FOUND", "Employee not enrolled", false, C_SUBTEXT);
          delay(2000);
          needRedisplay = true;
          break;
        }

        executeDeleteConfirmation(matchedSlot);
        needRedisplay = true;
        break;
      }
      delay(15);
    }

    if (needRedisplay) {
      continue;
    }

    drawHomeScreen();
    return;
  }
}

void handleHomeTouch(TPoint &t) {
  // Admin button on bottom-right of footer (230, 198, 88, 40)
  if (hit(t, 230, 198, 88, 40)) {
    buttonTouchFeedback(240, 205, 72, 27, C_PRIMARY, "Admin");
    if (!runAdminAuth())
      return;
    drawManageScreen();
    unsigned long mt = millis();
    while (millis() - mt < 30000UL) {
      TPoint m = readTouch();
      if (!m.valid) {
        delay(15);
        continue;
      }
      // Row 1: ENROLL (15, 68, 140, 48)
      if (hit(m, 15, 68, 140, 48)) {
        buttonTouchFeedback(15, 68, 140, 48, C_PRIMARY, "ENROLL");
        runEnroll();
        return;
      }
      // Row 1: DELETE (165, 68, 140, 48)
      if (hit(m, 165, 68, 140, 48)) {
        buttonTouchFeedback(165, 68, 140, 48, C_PRIMARY, "DELETE");
        runDelete();
        return;
      }
      // Row 2: EMPLOYEES (15, 124, 140, 43)
      if (hit(m, 15, 124, 140, 43)) {
        buttonTouchFeedback(15, 124, 140, 43, C_PANEL, "EMPLOYEES", C_TEXT);
        runDelete(); // Shows roster view
        return;
      }
      // Row 2: CHANGE ADMIN (165, 124, 140, 43)
      if (hit(m, 165, 124, 140, 43)) {
        buttonTouchFeedback(165, 124, 140, 43, C_PANEL, "CHANGE ADMIN", C_TEXT);
        showMessage("CHANGE ADMIN", "Scan new admin finger", "Replaces current admin", C_PRIMARY);
        delay(1200);
        enrollAdminSerial();
        drawManageScreen();
        mt = millis();
        continue;
      }
      // Row 3: BACK (15, 178, 290, 42)
      if (hit(m, 15, 178, 290, 42)) {
        buttonTouchFeedback(15, 178, 290, 42, C_PRIMARY, "BACK");
        drawHomeScreen();
        return;
      }
      delay(15);
    }
    drawHomeScreen();
  }
}

void enrollAdminSerial() {
  Serial.println("=== ADMIN ENROLL === Place finger...");
  drawHeader("Admin Setup", "Scan admin fingerprint");
  fillCard(10, 58, 300, 134, C_WHITE);
  outlineCard(10, 58, 300, 134, C_DIVIDER);
  printCenter("Scan 1 of 2", 66, C_SUBTEXT, 1, C_WHITE);
  drawFpRing(C_PRIMARY, 160, 116);
  printCenter("PLACE ON SENSOR", 158, C_TEXT, 2, C_WHITE);

  auto waitScan = [&](uint8_t slot) -> bool {
    unsigned long t0 = millis();
    while (millis() - t0 < 30000UL) {
      int r = finger.getImage();
      if (r == FINGERPRINT_NOFINGER) {
        delay(50);
        continue;
      }
      if (r != FINGERPRINT_OK)
        return false;
      return finger.image2Tz(slot) == FINGERPRINT_OK;
    }
    return false;
  };

  if (!waitScan(1)) {
    Serial.println("Scan 1 failed.");
    drawHomeScreen();
    return;
  }
  printCenter("LIFT FINGER", 158, C_TEXT, 2, C_WHITE);
  printCenter("Lift finger — scan 2 follows", 178, C_SUBTEXT, 1, C_WHITE);
  fpWaitLift();
  delay(800);

  fillCard(10, 58, 300, 134, C_WHITE);
  outlineCard(10, 58, 300, 134, C_DIVIDER);
  printCenter("Scan 2 of 2", 66, C_SUBTEXT, 1, C_WHITE);
  drawFpRing(C_PRIMARY, 160, 116);
  printCenter("PLACE ON SENSOR", 158, C_TEXT, 2, C_WHITE);

  if (!waitScan(2)) {
    Serial.println("Scan 2 failed.");
    drawHomeScreen();
    return;
  }
  if (finger.createModel() != FINGERPRINT_OK) {
    Serial.println("Mismatch.");
    drawHomeScreen();
    return;
  }
  if (finger.storeModel(ADMIN_FP_SLOT) != FINGERPRINT_OK) {
    Serial.println("Store failed.");
    drawHomeScreen();
    return;
  }
  setAdminEnrolled(true);
  showResult("ADMIN SET", "Admin fingerprint enrolled", true, C_SUCCESS);
  Serial.println("SETADMIN: OK");
  sfxAdminEnrolled();
  fpWaitLift();
  delay(RESULT_DWELL);
  drawHomeScreen();
}

void handleSerial() {
  if (!Serial.available())
    return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  if (!cmd.length())
    return;
  String up = cmd;
  up.toUpperCase();
  if (up.startsWith("TIME ")) {
    int h, m, s, d, mo, y;
    if (sscanf(cmd.c_str() + 5, "%d:%d:%d %d/%d/%d", &h, &m, &s, &d, &mo, &y) ==
        6) {
      clk.set(h, m, s, d, mo, y);
      char ts[32];
      clk.fmtFull(ts, sizeof(ts));
      Serial.printf("Clock set: %s\n", ts);
    } else
      Serial.println("Format: TIME HH:MM:SS DD/MM/YYYY");
    return;
  }
  if (up == "SETADMIN") {
    enrollAdminSerial();
    return;
  }
  if (up == "LIST") {
    finger.getTemplateCount();
    Serial.printf("Templates: %d / %d\n", finger.templateCount, MAX_EMPLOYEES);
    for (int i = 1; i <= MAX_EMPLOYEES; i++)
      if (strlen(empNames[i]))
        Serial.printf("  slot%d : %-20s [%s]\n", i, empNames[i],
                      checkedIn[i] ? "IN" : "OUT");
    return;
  }
  if (up == "CLEARALL") {
    finger.emptyDatabase(); // Completely erase templates from the fingerprint
                            // sensor
    prefs.begin("qclk", false);
    prefs.clear();
    prefs.end();
    memset(checkedIn, 0, sizeof(checkedIn));
    memset(empNames, 0, sizeof(empNames));
    Serial.println("Cleared database & sensor.");
    drawHomeScreen();
    return;
  }
  if (up.startsWith("SERVER ")) {
    String s = cmd.substring(7);
    s.trim();
    if (s.length() > 0) {
      serverUrl = s;
      prefs.begin("qclk", false);
      prefs.putString("srv", serverUrl);
      prefs.end();
      Serial.printf("[CONFIG] Server URL saved: %s\n", serverUrl.c_str());
    }
    return;
  }
  if (up.startsWith("WIFI ")) {
    int sp = cmd.indexOf(' ', 5);
    if (sp != -1) {
      ssid = cmd.substring(5, sp);
      password = cmd.substring(sp + 1);
      ssid.trim();
      password.trim();
      prefs.begin("qclk", false);
      prefs.putString("ssid", ssid);
      prefs.putString("pass", password);
      prefs.end();
      Serial.printf("[CONFIG] Wi-Fi updated to '%s'. Reconnecting...\n", ssid.c_str());
      WiFi.disconnect();
      WiFi.begin(ssid.c_str(), password.c_str());
    } else {
      Serial.println("Format: WIFI <ssid> <password>");
    }
    return;
  }
  Serial.println(
      "Commands: TIME HH:MM:SS DD/MM/YYYY | SERVER <url> | WIFI <ssid> <pass> | SETADMIN | LIST | CLEARALL");
}

// ═══════════════════════════════════════════════════════════
//  SPLASH SCREEN
// ═══════════════════════════════════════════════════════════
void showSplash() {
  tft.fillScreen(C_BG);

  drawLogo(124, 14, 72, 72, 14, C_PRIMARY);

  printCenter("QuantumClk", 96, C_TEXT, 2, C_BG);
  printCenter("Technologies", 116, C_SUBTEXT, 1, C_BG);

  drawRule(132, 60, 200);

  printCenter("Smart Biometric Attendance &", 140, C_SUBTEXT, 1, C_BG);
  printCenter("Payroll Management System", 154, C_SUBTEXT, 1, C_BG);

  printCenter("Initialising...", 200, C_SUBTEXT, 1, C_BG);
}

void setup() {
  Serial.begin(115200);
  while (!Serial)
    delay(10);
  pinMode(AUDIO_PIN, OUTPUT);
  digitalWrite(AUDIO_PIN, LOW);
  clk.set(8, 0, 0, 1, 1, 2025);
  loadAll();
  if (!LittleFS.begin(true)) {
    Serial.println("[FS] LittleFS Mount Failed");
  } else {
    Serial.println("[FS] LittleFS Mounted Successfully");
    File root = LittleFS.open("/");
    File file = root.openNextFile();
    int fileCount = 0;
    Serial.println("[FS] Listing audio files on LittleFS:");
    while (file) {
      Serial.printf("  -> %s (%d bytes)\n", file.name(), file.size());
      fileCount++;
      file = root.openNextFile();
    }
    if (fileCount == 0) {
      Serial.println("  [!] WARNING: No files found on LittleFS! Please upload the 'data' folder using LittleFS upload tool.");
    }
  }
  tft.init();
  tft.setRotation(1);
  tft.fillScreen(C_BG);
  showSplash();
  touchSPI.begin(TOUCH_CLK, TOUCH_MISO, TOUCH_MOSI, TOUCH_CS);
  touch.begin(touchSPI);
  touch.setRotation(1);
  delay(500);
  fpSerial.begin(57600, SERIAL_8N1, FP_RX, FP_TX);
  finger.begin(57600);

  tft.fillRect(0, 196, SCREEN_W, 16, C_BG);
  tft.setTextSize(1);
  tft.setCursor(100, 200);
  bool fpOk = false;
  for (int i = 0; i < 5 && !fpOk; i++) {
    fpOk = finger.verifyPassword();
    delay(400);
  }

  // Connect to Wi-Fi with auto-reconnect
  tft.fillRect(0, 196, SCREEN_W, 24, C_BG);
  printCenter("Connecting to Wi-Fi...", 200, C_SUBTEXT, 1, C_BG);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);
  WiFi.begin(ssid.c_str(), password.c_str());
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 10000UL) {
    delay(500);
    Serial.print(".");
  }

  tft.fillRect(0, 196, SCREEN_W, 24, C_BG);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWiFi Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    configTime(19800, 0, "pool.ntp.org", "time.google.com");
    printCenter("Wi-Fi Connected ✓", 200, C_SUCCESS, 1, C_BG);
    delay(1000);
  } else {
    Serial.println("\nWiFi Connection Timeout!");
    printCenter("No Wi-Fi! Device requires Wi-Fi.", 200, C_PRIMARY, 1, C_BG);
    delay(2000);
  }

  if (fpOk) {
    finger.getTemplateCount();
    tft.setTextColor(C_SUCCESS, C_BG);
    printCenter("System Ready ✓", 180, C_SUCCESS, 1, C_BG);
    delay(1200);
    drawHomeScreen();
  } else {
    tft.setTextColor(C_PRIMARY, C_BG);
    printCenter("Sensor Connection Error ✗", 180, C_PRIMARY, 1, C_BG);
    delay(3000);
    drawHomeScreen();
  }
}

unsigned long lastWifiCheck = 0;

void loop() {
  handleSerial();
  TPoint t = readTouch();
  if (t.valid) {
    if (currentScreen == SCR_HOME)
      handleHomeTouch(t);
  }

  // Periodic Wi-Fi watchdog & auto-reconnect
  if (millis() - lastWifiCheck > 4000UL) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.reconnect();
    }
  }

  if (currentScreen == SCR_HOME) {
    if (WiFi.status() == WL_CONNECTED) {
      int r = finger.getImage();
      if (r == FINGERPRINT_OK) {
        runAttendanceScan();
      }
    } else {
      // Disallow scanning if Wi-Fi is disconnected
      int r = finger.getImage();
      if (r == FINGERPRINT_OK) {
        playBeep(700, 150);
        showResult("NO WI-FI", "Device cannot run without Wi-Fi", false, C_PRIMARY);
        fpWaitLift();
        delay(2000);
        drawHomeScreen();
      }
    }
  }
  delay(20);
}
