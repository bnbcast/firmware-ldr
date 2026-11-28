#pragma once

// Copy this file to include/secrets.h and fill in your WiFi credentials.
// include/secrets.h is gitignored so credentials are never committed.
// If STA connection fails after 10 s, the ESP32 automatically starts
// SoftAP "SolarTracker-Debug" so the Web UI works offline without router WiFi.

#define WIFI_STA_SSID "YOUR_WIFI_SSID"
#define WIFI_STA_PASSWORD "YOUR_WIFI_PASSWORD"
