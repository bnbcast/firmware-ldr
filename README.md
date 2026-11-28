# Monitor Sensor Solar Tracker ESP32 (Single-File Firmware + Live Web UI)

Firmware diagnostik & bring-up **satu file ([src/main.cpp](src/main.cpp))** untuk ESP32 (`esp32dev`) dengan 2 sensor cahaya LDR LM393 (`AO -> GPIO34`, `AO -> GPIO35`) dan RTC I2C DS1307 (`SDA -> GPIO21`, `SCL -> GPIO22`), lengkap dengan **Web UI Bahasa Indonesia** yang berjalan di:
- **GitHub Pages (Live Data lewat Web Serial USB / Localhost Bridge):** https://bnbcast.github.io/firmware-ldr/
- **Localhost Node.js (`http://localhost:3000`):** lewat `npm run prod` dan `npm run dev`
- **WiFi Hotspot Internal ESP32 (`SolarTracker-Debug`):** `http://192.168.4.1/`

---

## 1. Struktur Proyek (Simplified)

- `src/main.cpp` — Seluruh kode firmware ESP32 dalam **satu file C++** (pembacaan 20 Hz, filter median 16-sampel, deteksi saturasi & kabel putus, kalibrasi NVS, tes tutup sensor terpandu 4 langkah, jam RTC DS1307, shell serial, dan embedded Web UI Bahasa Indonesia).
- `docs/` — Web UI Vanilla JS Bahasa Indonesia (`index.html`, `styles.css`, `app.js`) yang di-host di **GitHub Pages** sekaligus disajikan oleh `server.js` di **`http://localhost:3000`**.
- `server.js` & `scripts/serial_bridge.py` — Server Node.js tanpa dependency eksternal untuk flash ESP32, membaca live serial USB, dan simulator mode dev.
- `platformio.ini` — Konfigurasi PlatformIO (`esp32dev`).

---

## 2. Cara Menjalankan (`npm run prod` & `npm run dev`)

```bash
# 1. Mode Produksi: Otomatis compile, flash ke ESP32, lalu buka live dashboard di http://localhost:3000
npm run prod

# 2. Mode Dev: Buka dashboard simulator & kontrol di http://localhost:3000
npm run dev

# 3. Hanya menghubungkan live USB ESP32 ke http://localhost:3000 tanpa flash ulang
npm run live
```

### Membaca Data Live di GitHub Pages (`https://bnbcast.github.io/firmware-ldr/`)
1. Buka **https://bnbcast.github.io/firmware-ldr/** menggunakan **Google Chrome** atau **Microsoft Edge**.
2. Colokkan ESP32 ke USB PC, lalu klik tombol biru **"Hubungkan USB ESP32 (Web Serial)"** di pojok kanan atas dan pilih port COM ESP32 Anda (`COM4`).
3. Atau jalankan `npm run prod` / `npm run live` di PC — halaman GitHub Pages juga otomatis terhubung ke `http://localhost:3000`.

---

## 3. Tabel Pengkabelan (Pastikan VCC = 3.3V!)

| Modul | Pin Modul | Pin ESP32 | Catatan |
|---|---|---|---|
| LDR #1 (LM393) | `AO` | `GPIO34` | Pin input ADC1_CH6 (aman saat WiFi aktif) |
| LDR #2 (LM393) | `AO` | `GPIO35` | Pin input ADC1_CH7 (aman saat WiFi aktif) |
| LDR #1 & #2 | `VCC` / `GND` | `3.3V` / `GND` | **Wajib 3.3V** (jangan 5V). Pin `DO` tidak dipakai |
| Tiny RTC DS1307 | `SDA` / `SCL` | `GPIO21` / `GPIO22` | I2C (`0x68`). Pin `DS` tidak dipakai |
