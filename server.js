'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MODE = process.argv.includes('--mode=prod') ? 'prod' : 'dev';
const NO_FLASH = process.argv.includes('--no-flash');
const PUBLIC_DIR = path.join(__dirname, 'docs');
const THREE_VENDOR_DIR = path.join(__dirname, 'node_modules', 'three');
const LOGS_DIR = path.join(__dirname, 'logs');
const PIO_PYTHON_DIRECT = 'C:\\Users\\User\\.platformio\\python3\\python.exe';
const PIO_SITE_PACKAGES = 'C:\\Users\\User\\.platformio\\penv\\Lib\\site-packages';
const PIO_PYTHON = 'C:\\Users\\User\\.platformio\\penv\\Scripts\\python.exe';
const BRIDGE_SCRIPT = path.join(__dirname, 'scripts', 'serial_bridge.py');
const FLASH_SCRIPT = path.join(__dirname, 'scripts', 'flash_fast.py');
const startTime = Date.now();

// Blackbox JSONL Session File
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
const sessionStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BLACKBOX_FILE = path.join(LOGS_DIR, `session-${sessionStamp}.jsonl`);

function writeBlackbox(type, payload) {
  try {
    const rec = JSON.stringify({ ts: new Date().toISOString(), type, ...payload });
    fs.appendFile(BLACKBOX_FILE, rec + '\n', () => {});
  } catch {}
}

const DEADBAND_PCT = 5;
const SAT_LOW_RAW = 180;
const SAT_HIGH_RAW = 3850;
const SAT_LOW_MV = 150;
const SAT_HIGH_MV = 3100;
const OFFLINE_TIMEOUT_MS = 5000;

const state = {
  mode: MODE,
  sourceMode: 'usb',
  hardwareConnected: false,
  espOnline: false,
  lastOnlineChangeMs: 0,
  serialPort: null,
  hardwareError: 'Mencari port USB ESP32...',
  firmwareType: 'UNKNOWN',
  firmwareVersion: '--',
  resetReason: '--',
  bootCount: 0,
  brownoutCount: 0,
  wdtCount: 0,
  panicCount: 0,
  freeHeap: 0,
  minHeap: 0,
  maxAlloc: 0,
  tempC: null,
  loopMs: null,
  i2cErr: 0,
  eeprom: false,
  pwr: { baseMv: 0, minMv: 0, sagMv: 0, emiSd: 0 },
  packetCount: 0,
  packetRateHz: 0,
  lastPacketMs: 0,
  rawDiff: 0,
  i2cAddresses: [],
  calibrated: false,
  preset: 'live',
  dark1: 500,
  bright1: 3500,
  dark2: 500,
  bright2: 3500,
  bih1: true,
  bih2: true,
  rtcOffsetMs: 0,
  rtcPresent: false,
  rtcRunning: false,
  rtcPlausible: false,
  rtcTimeStr: 'MENUNGGU DATA',
  guide: { state: 'IDLE', step: 0, phaseStart: 0, prompt: 'Siap dijalankan' },
  ldr1: { raw: 0, mv: 0, pct: 0, min: 0, max: 0, sd: 0, health: 'OK', bih: true },
  ldr2: { raw: 0, mv: 0, pct: 0, min: 0, max: 0, sd: 0, health: 'OK', bih: true },
  servo: { mode: 'AUTO', deg: 90, target: 90, trim: 0, min: 15, max: 165, ctr: 90, phys: 90, us: 1500, pwmS: 0, moves: 0, invert: false, moving: false, pwm: false, atLimit: false, locked: false, softStart: false },
  sun: { ok: false, st: 'DARK', rsn: 'TOO_DARK_NO_SUN', e1: 0, e2: 0, adv: 0, thr: 12, lx1: 0, lx2: 0 },
  park: { on: false, deg: 90, darkS: 0, thrS: 300 },
  clk: { deg: 90, day: false, pct: 0, sMin: 360, eMin: 1080, bias: 0, maxB: 15 },
  astro: { el: 0, az: 90, eot: 0, eff: 100, w: 0, logE: 0, lat: -6.2, lon: 106.82, tz: 7, step: 4 },
  faults: [],
  faultHistory: {},
  events: [],
  nextEventId: 1,
  sessionStats: {
    ldr1MinRaw: 4095, ldr1MaxRaw: 0,
    ldr2MinRaw: 4095, ldr2MaxRaw: 0,
    satCycles: 0, totalCycles: 0
  },
  decision: 'HOLD',
  delta: 0,
  simLight: { active: false, deg: 90, elevation: 55, intensity: 0.85 },
  history: [],
  logs: [],
  nextLogId: 1
};

let serialChild = null;
let pktCounterWindow = 0;
let prevActiveFaults = new Set();
let prevSagPeakMv = 0;
let prevEmiPeakSd = 0;
let prevSunOk = null;
let prevSunRsn = '';
let lastEventDedup = { key: '', ts: 0 };

function computeEspOnline() {
  if (state.sourceMode === 'sim') return true;
  if (!state.hardwareConnected || state.lastPacketMs <= 0) return false;
  return (Date.now() - state.lastPacketMs) <= OFFLINE_TIMEOUT_MS;
}

function addEvent(severity, category, message, meta = null) {
  const now = Date.now();
  const dedupKey = `${severity}|${category}|${message}`;
  if (lastEventDedup.key === dedupKey && (now - lastEventDedup.ts) < 2500) return;
  lastEventDedup = { key: dedupKey, ts: now };

  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const ev = {
    id: state.nextEventId++,
    ts: d.toISOString(),
    time: timeStr,
    severity, // 'ERROR' | 'WARN' | 'INFO'
    category, // 'PWR' | 'CONN' | 'FAULT' | 'SRVO' | 'SYS'
    message,
    meta: meta || undefined
  };
  state.events.push(ev);
  if (state.events.length > 200) state.events.shift();
  writeBlackbox('event', ev);
}

const rateInterval = setInterval(() => {
  state.packetRateHz = pktCounterWindow;
  pktCounterWindow = 0;
  const onlineNow = computeEspOnline();
  if (onlineNow !== state.espOnline) {
    state.espOnline = onlineNow;
    state.lastOnlineChangeMs = Date.now();
    if (!onlineNow) {
      addEvent('ERROR', 'CONN', `ESP32 OFFLINE (tidak ada paket data > ${OFFLINE_TIMEOUT_MS / 1000} dtk)`);
      addLog(0, 'CONN', `ESP32 OFFLINE (tidak ada paket > ${OFFLINE_TIMEOUT_MS / 1000} dtk)`);
    } else {
      addEvent('INFO', 'CONN', `ESP32 ONLINE (${state.sourceMode === 'sim' ? 'Simulator' : (state.serialPort || 'USB')})`);
    }
  }
}, 1000);

function uptimeMs() { return Date.now() - startTime; }

function formatRtc() {
  const d = new Date(Date.now() + state.rtcOffsetMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pushRawLog(lvl, txt, src = 'ESP32') {
  const entry = {
    id: state.nextLogId++,
    lvl,
    src,
    time: new Date().toLocaleTimeString('id-ID', { hour12: false }),
    txt
  };
  state.logs.push(entry);
  if (state.logs.length > 300) state.logs.shift();
  writeBlackbox('log', { lvl, src, txt });
}

function addLog(lvl, tag, msg) {
  const up = String(uptimeMs()).padStart(6, '0');
  const lvlNames = ['ERROR', 'WARN ', 'INFO ', 'DEBUG', 'TRACE'];
  const lvlStr = lvlNames[lvl] || 'INFO ';
  pushRawLog(lvl, `[${up}][${formatRtc()}][${lvlStr}][${tag.padEnd(4, ' ')}] ${msg}`, 'NODE');
}

function classifyHealth(raw, mv, sd) {
  if (sd > 450 || (raw === 0 && mv === 0)) return 'CHECK WIRING';
  if (raw <= SAT_LOW_RAW || mv < SAT_LOW_MV) return 'SATURATED_LOW';
  if (raw >= SAT_HIGH_RAW || mv > SAT_HIGH_MV) return 'SATURATED_HIGH';
  return 'OK';
}

function normalizePct(raw, dark, bright, bih) {
  if (bih) {
    const span = bright > dark ? bright - dark : 4095;
    return Math.max(0, Math.min(100, Math.round(((raw - dark) * 100) / span)));
  }
  const span = dark > bright ? dark - bright : 4095;
  return Math.max(0, Math.min(100, Math.round(((dark - raw) * 100) / span)));
}

function evaluateDecision(p1, p2) {
  const d = p1 - p2;
  if (d > DEADBAND_PCT) return 'LDR1 BRIGHTER';
  if (d < -DEADBAND_PCT) return 'LDR2 BRIGHTER';
  return 'HOLD';
}

function recordSessionMetrics() {
  const s = state.sessionStats;
  s.totalCycles += 1;
  if (state.ldr1.raw < s.ldr1MinRaw) s.ldr1MinRaw = state.ldr1.raw;
  if (state.ldr1.raw > s.ldr1MaxRaw) s.ldr1MaxRaw = state.ldr1.raw;
  if (state.ldr2.raw < s.ldr2MinRaw) s.ldr2MinRaw = state.ldr2.raw;
  if (state.ldr2.raw > s.ldr2MaxRaw) s.ldr2MaxRaw = state.ldr2.raw;
  if (state.ldr1.health === 'SATURATED_HIGH' && state.ldr2.health === 'SATURATED_HIGH') {
    s.satCycles += 1;
  }
}

function updateFaultHistory(faultList) {
  state.faults = faultList;
  const nextSet = new Set(faultList);
  for (const f of faultList) {
    state.faultHistory[f] = (state.faultHistory[f] || 0) + 1;
    if (!prevActiveFaults.has(f)) {
      const isPower = f.includes('BROWNOUT') || f.includes('SAG') || f.includes('EMI');
      const isErr = f.includes('BROWNOUT') || f.includes('WIRING') || f.includes('WRONG') || f.includes('NO_RESPONSE') || f.includes('SAG');
      addEvent(isErr ? 'ERROR' : 'WARN', isPower ? 'PWR' : 'FAULT', `Fault aktif: ${f}`);
    }
  }
  for (const old of prevActiveFaults) {
    if (!nextSet.has(old)) {
      addEvent('INFO', 'FAULT', `Fault pulih: ${old}`);
    }
  }
  prevActiveFaults = nextSet;
}

function buildChecklist() {
  const items = [];
  const onlineNow = computeEspOnline();
  items.push({
    id: 'usb',
    title: '1. Koneksi USB Serial (NodeMCU-32S)',
    status: onlineNow ? 'ok' : 'err',
    badge: onlineNow ? `ONLINE (${state.serialPort || 'SIM'})` : (state.hardwareConnected ? 'ESP32 OFFLINE' : 'PUTUS'),
    detail: onlineNow
      ? `${state.packetCount} paket diterima (${state.packetRateHz} Hz). Blackbox: ${path.basename(BLACKBOX_FILE)}`
      : 'ESP32 offline / tidak ada paket data. Cek kabel USB & power 5V.'
  });

  items.push({
    id: 'pwr',
    title: '2. Stabilitas Power XL4015 (6V) & Brownout MG996R',
    status: (state.brownoutCount > 0 || state.pwr.sagMv >= 40) ? 'err' : 'ok',
    badge: state.brownoutCount > 0 ? `BROWNOUT (${state.brownoutCount}x)` : `AMAN (${state.resetReason})`,
    detail: state.brownoutCount > 0
      ? `ESP32 reset karena tegangan drop (Sag ${state.pwr.sagMv} mV). Pastikan MG996R disuplai ~6V dari XL4015 (5A Buck) dan Common GND terhubung solid ke ESP32.`
      : `Tidak ada brownout. Suplai MG996R via XL4015 (~6V + Common GND) · 3V3 Sag ${state.pwr.sagMv} mV · EMI +${state.pwr.emiSd} SD.`
  });

  const fwOk = /^(SIM-)?0\.[345]\./.test(state.firmwareVersion || '');
  items.push({
    id: 'fw',
    title: '3. Versi Firmware & Dukungan MG996R + Astro NOAA',
    status: fwOk ? 'ok' : 'warn',
    badge: state.firmwareVersion || '--',
    detail: fwOk
      ? `Firmware ${state.firmwareVersion} aktif (MG996R GPIO18 + NOAA Astro + Tiny RTC 0x68/AT24C32 0x50 + Soft-Start).`
      : 'Firmware di board belum terbaru. Klik Flash ESP32 untuk update.'
  });

  const makeLdrCheck = (idx, ldr) => {
    const pin = idx === 1 ? 'GPIO34' : 'GPIO35';
    if (ldr.health === 'CHECK WIRING') {
      return { id: `ldr${idx}`, title: `${idx + 3}. Sensor LDR ${idx} (${pin})`, status: 'err', badge: `CEK KABEL (SD ${ldr.sd})`, detail: 'Terdeteksi noise ekstrem atau 0 mV mati total.' };
    }
    if (ldr.health === 'SATURATED_HIGH') {
      return { id: `ldr${idx}`, title: `${idx + 3}. Sensor LDR ${idx} (${pin})`, status: 'warn', badge: `MENTOK ATAS (${ldr.raw})`, detail: 'Terhubung, sedang di batas atas ADC (gelap/terang penuh).' };
    }
    if (ldr.health === 'SATURATED_LOW') {
      return { id: `ldr${idx}`, title: `${idx + 3}. Sensor LDR ${idx} (${pin})`, status: 'warn', badge: `MENTOK BAWAH (${ldr.raw})`, detail: 'Terhubung, sinyal < 150 mV.' };
    }
    return { id: `ldr${idx}`, title: `${idx + 3}. Sensor LDR ${idx} (${pin})`, status: 'ok', badge: `NORMAL (${ldr.raw} · ${ldr.mv}mV)`, detail: `Cahaya ${ldr.pct}% | SD=${ldr.sd} | Arah: ${ldr.bih ? 'Naik' : 'Turun'} saat terang.` };
  };
  items.push(makeLdrCheck(1, state.ldr1));
  items.push(makeLdrCheck(2, state.ldr2));

  items.push({
    id: 'servo',
    title: '6. Servo MG996R Metal Gear (P18 / GPIO18 · 6V XL4015)',
    status: (state.faults.includes('WRONG_DIRECTION_SUSPECTED') || state.servo.locked) ? 'err' : (state.servo.mode === 'AUTO' ? 'ok' : 'warn'),
    badge: state.servo.locked ? 'SAFE-LOCK (PWM OFF)' : `${state.servo.mode} · ${state.servo.deg}°`,
    detail: state.servo.locked
      ? 'MG996R terkunci (PWM OFF) pasca BROWNOUT untuk mencegah boot-loop. Cek output 6V XL4015 & Common GND lalu kirim "servo unlock" atau "servo auto".'
      : (state.faults.includes('WRONG_DIRECTION_SUSPECTED')
        ? 'PERINGATAN: Arah servo kemungkinan terbalik! Klik tombol "Balik Arah Servo".'
        : `Target=${state.servo.target}° | Invert=${state.servo.invert ? 'Ya' : 'Tidak'} | Batas aman 15°–165° (90° datar).`)
  });

  items.push({
    id: 'cal',
    title: '7. Kalibrasi & Jam RTC I2C',
    status: (state.calibrated && state.rtcPresent && state.rtcPlausible) ? 'ok' : 'warn',
    badge: state.calibrated ? `TERKALIBRASI · ${state.rtcTimeStr}` : `BELUM KALIBRASI · ${state.rtcTimeStr}`,
    detail: state.calibrated
      ? `LDR1(${state.dark1}..${state.bright1}) LDR2(${state.dark2}..${state.bright2}) | I2C: ${state.i2cAddresses.join(',') || '0x68'}`
      : 'Klik "Gelap 0%" saat redup lalu "Terang 100%" saat disorot senter/matahari.'
  });

  return items;
}

function buildExplain() {
  if (state.sourceMode === 'usb' && !computeEspOnline()) {
    return state.hardwareConnected
      ? 'ESP32 OFFLINE: Port USB terbuka tetapi tidak ada data masuk > 5 detik (ESP32 mati / sedang reset / brownout).'
      : (state.hardwareError || 'ESP32 OFFLINE: USB ESP32 belum terdeteksi.');
  }
  if (state.servo.locked) {
    return 'MG996R SAFE-LOCK AKTIF: PWM dimatikan otomatis setelah BROWNOUT RESET. Pastikan suplai ~6V dari XL4015 (5A Buck) + Common GND dengan ESP32, lalu klik AUTO TRACK / kirim "servo unlock".';
  }
  if (state.brownoutCount > 0) {
    return 'PERINGATAN POWER: Terdeteksi BROWNOUT RESET pada ESP32! MG996R butuh suplai ~6V stabil dari XL4015 (5A Buck) dari terminal LOAD 12V SCC dengan Common GND solid ke ESP32.';
  }
  if (state.faults.includes('WRONG_DIRECTION_SUSPECTED')) {
    return 'ARAH SERVO TERBALIK: Saat servo bergerak, selisih cahaya justru makin besar. Klik tombol "Balik Arah Servo" sekarang.';
  }
  if (state.sourceMode === 'usb' && !state.hardwareConnected) {
    return state.hardwareError || 'USB ESP32 belum terdeteksi.';
  }
  if (state.ldr1.health === 'CHECK WIRING' || state.ldr2.health === 'CHECK WIRING') {
    return 'CEK KABEL: Terdeteksi noise ekstrem (SD > 450) atau 0 mV mati total pada salah satu pin LDR.';
  }
  if (state.ldr1.health === 'SATURATED_HIGH' && state.ldr2.health === 'SATURATED_HIGH') {
    return 'Kedua LDR mentok atas (4095). Jika di ruangan redup, arahkan senter HP atau klik "Gelap 0%" lalu sorot senter & klik "Terang 100%". Jika di matahari terik, beri peneduh/turunkan resistor.';
  }
  const d = state.delta;
  const srvInfo = `Servo [${state.servo.mode}] di ${state.servo.deg}° (target ${state.servo.target}°).`;
  if (state.decision === 'HOLD') return `Sensor normal. Selisih (${d >= 0 ? '+' : ''}${d}%) dalam deadband ±${DEADBAND_PCT}%. ${srvInfo}`;
  const t = state.decision === 'LDR1 BRIGHTER' ? 'LDR1' : 'LDR2';
  return `${t} lebih terang ${Math.abs(d)}% (melebihi deadband ±${DEADBAND_PCT}%). ${srvInfo}`;
}

function buildAiDebugBundle() {
  return {
    generatedAt: new Date().toISOString(),
    blackboxFile: path.basename(BLACKBOX_FILE),
    hardware: {
      port: state.serialPort,
      connected: state.hardwareConnected,
      firmwareVersion: state.firmwareVersion,
      resetReason: state.resetReason,
      brownoutCount: state.brownoutCount,
      freeHeap: state.freeHeap,
      i2cAddresses: state.i2cAddresses
    },
    sensors: {
      ldr1: state.ldr1,
      ldr2: state.ldr2,
      deltaPct: state.delta,
      rawDiff: state.rawDiff,
      decision: state.decision,
      calibration: {
        calibrated: state.calibrated,
        dark1: state.dark1, bright1: state.bright1, bih1: state.bih1,
        dark2: state.dark2, bright2: state.bright2, bih2: state.bih2
      }
    },
    servo: state.servo,
    rtc: { present: state.rtcPresent, running: state.rtcRunning, plausible: state.rtcPlausible, time: state.rtcTimeStr },
    sessionStats: state.sessionStats,
    activeFaults: state.faults,
    faultHistory: state.faultHistory,
    events: state.events.slice(-60),
    recentLogs: state.logs.slice(-35).map((l) => l.txt)
  };
}

// ============================================================================
// Simulator Tick (only when sourceMode === 'sim')
// ============================================================================
function computeSimLightRaw(lightDeg, panelDeg, elevationDeg, intensity, invert) {
  const elevFactor = Math.max(0.12, Math.sin(Math.max(5, Math.min(90, elevationDeg)) * Math.PI / 180));
  const clampedInt = Math.max(0, Math.min(1, intensity));
  // 15 deg = Left (LDR1), 90 deg = Center, 165 deg = Right (LDR2)
  // Positive rawDiffDeg means light is to the LEFT of the panel normal -> LDR1 illuminated, LDR2 shaded by baffle
  const rawDiffDeg = (panelDeg - lightDeg) * (invert ? -1 : 1);
  const leftLit = Math.max(0.08, Math.min(1, 0.78 + Math.sin(Math.max(-85, Math.min(85, rawDiffDeg)) * Math.PI / 180) * 0.65));
  const rightLit = Math.max(0.08, Math.min(1, 0.78 - Math.sin(Math.max(-85, Math.min(85, rawDiffDeg)) * Math.PI / 180) * 0.65));
  const baseDark = 520;
  const span = 2980;
  const r1 = Math.round(baseDark + span * clampedInt * elevFactor * leftLit);
  const r2 = Math.round(baseDark + span * clampedInt * elevFactor * rightLit);
  return { r1: Math.max(0, Math.min(4095, r1)), r2: Math.max(0, Math.min(4095, r2)) };
}

function tickSimulator() {
  if (state.sourceMode !== 'sim') return;
  state.firmwareType = 'SIMULATOR';
  state.firmwareVersion = 'SIM-0.5.5';
  const jitter = () => Math.round((Math.random() - 0.5) * 20);
  let r1 = 2150 + jitter(), r2 = 2100 + jitter(), sd1 = 8, sd2 = 7;

  if (state.simLight && state.simLight.active) {
    const opt = computeSimLightRaw(
      state.simLight.deg,
      state.servo.deg,
      state.simLight.elevation,
      state.simLight.intensity,
      state.servo.invert
    );
    r1 = opt.r1 + Math.round((Math.random() - 0.5) * 14);
    r2 = opt.r2 + Math.round((Math.random() - 0.5) * 14);
  } else if (state.preset === 'saturated_high') { r1 = 4095; r2 = 4095; sd1 = 0; sd2 = 0; }
  else if (state.preset === 'ldr1_brighter') { r1 = 3150 + jitter(); r2 = 1350 + jitter(); }
  else if (state.preset === 'ldr2_brighter') { r1 = 1350 + jitter(); r2 = 3150 + jitter(); }
  else if (state.preset === 'check_wiring') { r1 = 0; r2 = 2100 + Math.round((Math.random() - 0.5) * 1600); sd1 = 0; sd2 = 620; }

  r1 = Math.max(0, Math.min(4095, r1));
  r2 = Math.max(0, Math.min(4095, r2));

  state.ldr1 = { raw: r1, mv: Math.round((r1 / 4095) * 3300), pct: normalizePct(r1, state.dark1, state.bright1, state.bih1), min: Math.max(0, r1 - 12), max: Math.min(4095, r1 + 12), sd: sd1, health: classifyHealth(r1, Math.round((r1 / 4095) * 3300), sd1), bih: state.bih1 };
  state.ldr2 = { raw: r2, mv: Math.round((r2 / 4095) * 3300), pct: normalizePct(r2, state.dark2, state.bright2, state.bih2), min: Math.max(0, r2 - 12), max: Math.min(4095, r2 + 12), sd: sd2, health: classifyHealth(r2, Math.round((r2 / 4095) * 3300), sd2), bih: state.bih2 };

  state.rawDiff = r1 - r2;
  state.delta = state.ldr1.pct - state.ldr2.pct;
  state.decision = evaluateDecision(state.ldr1.pct, state.ldr2.pct);

  if (state.servo.mode === 'AUTO' && state.decision !== 'HOLD') {
    const dir = (state.decision === 'LDR1 BRIGHTER' ? -1 : 1) * (state.servo.invert ? -1 : 1);
    const step = state.simLight && state.simLight.active ? 3 : 2;
    state.servo.target = Math.max(state.servo.min ?? 15, Math.min(state.servo.max ?? 165, state.servo.target + dir * step));
  }
  if (state.servo.deg !== state.servo.target) {
    const diff = state.servo.target - state.servo.deg;
    const move = Math.sign(diff) * Math.min(Math.abs(diff), state.simLight && state.simLight.active ? 2 : 1);
    state.servo.deg += move;
    state.servo.moving = true;
    state.servo.pwm = true;
    state.servo.moves = (state.servo.moves || 0) + 1;
  } else {
    state.servo.moving = false;
    state.servo.pwm = false;
  }

  const maxPct = Math.max(state.ldr1.pct, state.ldr2.pct);
  const simSunOk = maxPct >= 15 && state.ldr1.health !== 'CHECK WIRING' && state.ldr2.health !== 'CHECK WIRING';
  const simSunRsn = (state.ldr1.health === 'CHECK WIRING' || state.ldr2.health === 'CHECK WIRING')
    ? 'WIRING_FAULT'
    : (state.ldr1.health === 'SATURATED_HIGH' && state.ldr2.health === 'SATURATED_HIGH')
      ? 'BOTH_SATURATED_EQUAL'
      : (!simSunOk
        ? 'TOO_DARK_NO_SUN'
        : (state.servo.mode === 'MANUAL'
          ? 'MANUAL_MODE'
          : (state.decision === 'LDR1 BRIGHTER'
            ? 'TRACKING_LDR1'
            : (state.decision === 'LDR2 BRIGHTER' ? 'TRACKING_LDR2' : 'BALANCED_ON_SUN'))));
  state.sun = {
    ok: simSunOk,
    st: simSunOk ? 'SUN' : 'DARK',
    rsn: simSunRsn,
    e1: Math.max(0, state.ldr1.raw - state.dark1),
    e2: Math.max(0, state.ldr2.raw - state.dark2),
    adv: state.ldr1.pct - state.ldr2.pct,
    thr: DEADBAND_PCT,
    lx1: Math.round(state.ldr1.pct * 250),
    lx2: Math.round(state.ldr2.pct * 250)
  };

  state.rtcPresent = true; state.rtcRunning = true; state.rtcPlausible = true;
  state.rtcTimeStr = formatRtc();
  state.packetCount += 1; pktCounterWindow += 1; state.lastPacketMs = Date.now();
  recordSessionMetrics();

  state.history.push({ uptimeMs: uptimeMs(), raw1: state.ldr1.raw, mv1: state.ldr1.mv, pct1: state.ldr1.pct, raw2: state.ldr2.raw, mv2: state.ldr2.mv, pct2: state.ldr2.pct, deg: state.servo.deg });
  if (state.history.length > 600) state.history.shift();
}
const simInterval = setInterval(tickSimulator, 250);

// ============================================================================
// Live ESP32 Serial Parser (Supports [TELEM] JSON + Text Lines)
// ============================================================================
function parseEsp32SerialLine(line) {
  state.packetCount += 1;
  pktCounterWindow += 1;
  state.lastPacketMs = Date.now();

  // Structured JSON telemetry packet from v0.3.0+
  if (line.startsWith('[TELEM] ')) {
    try {
      const t = JSON.parse(line.slice(8));
      state.firmwareType = 'NEW_BRINGUP_V3';
      state.firmwareVersion = t.fw || '0.5.5-astro-physics';
      state.resetReason = t.rst || '--';
      if (typeof t.boot === 'number') state.bootCount = t.boot;
      if (typeof t.bo === 'number') state.brownoutCount = t.bo;
      else if (t.rst === 'BROWNOUT' && !state.faults.includes('BROWNOUT_RESET')) state.brownoutCount += 1;
      if (typeof t.wdt === 'number') state.wdtCount = t.wdt;
      if (typeof t.panic === 'number') state.panicCount = t.panic;
      state.freeHeap = t.heap || 0;
      if (typeof t.minHeap === 'number') state.minHeap = t.minHeap;
      if (typeof t.maxAlloc === 'number') state.maxAlloc = t.maxAlloc;
      if (typeof t.tempC === 'number') state.tempC = t.tempC;
      if (typeof t.loopMs === 'number') state.loopMs = t.loopMs;
      if (typeof t.i2cErr === 'number') state.i2cErr = t.i2cErr;
      if (typeof t.eeprom === 'boolean') state.eeprom = t.eeprom;

      if (t.pwr) {
        state.pwr = {
          baseMv: t.pwr.baseMv || 0,
          minMv: t.pwr.minMv || 0,
          sagMv: t.pwr.sagMv || 0,
          emiSd: t.pwr.emiSd || 0
        };
        if (state.pwr.sagMv >= 40 && state.pwr.sagMv > prevSagPeakMv) {
          prevSagPeakMv = state.pwr.sagMv;
          addEvent('ERROR', 'PWR', `Tegangan 3.3V drop -${state.pwr.sagMv} mV (base ${state.pwr.baseMv} mV -> min ${state.pwr.minMv} mV)`);
        }
        if (state.pwr.emiSd >= 35 && state.pwr.emiSd > prevEmiPeakSd) {
          prevEmiPeakSd = state.pwr.emiSd;
          addEvent('WARN', 'PWR', `Lonjakan noise EMI/ground bounce +${state.pwr.emiSd} SD saat servo aktif`);
        }
      }

      if (t.l1) {
        state.ldr1 = { raw: t.l1.raw, mv: t.l1.mv, pct: t.l1.pct, min: t.l1.min, max: t.l1.max, sd: t.l1.sd, health: t.l1.h, bih: t.l1.bih };
        state.bih1 = t.l1.bih;
      }
      if (t.l2) {
        state.ldr2 = { raw: t.l2.raw, mv: t.l2.mv, pct: t.l2.pct, min: t.l2.min, max: t.l2.max, sd: t.l2.sd, health: t.l2.h, bih: t.l2.bih };
        state.bih2 = t.l2.bih;
      }
      if (t.cal) {
        state.dark1 = t.cal.d1; state.bright1 = t.cal.b1;
        state.dark2 = t.cal.d2; state.bright2 = t.cal.b2;
        state.calibrated = !!t.cal.ok;
      }
      state.decision = t.dec || 'HOLD';
      state.delta = t.delta || 0;
      state.rawDiff = state.ldr1.raw - state.ldr2.raw;

      if (t.rtc) {
        state.rtcTimeStr = t.rtc.t; state.rtcPresent = !!t.rtc.p;
        state.rtcRunning = !!t.rtc.r; state.rtcPlausible = !!t.rtc.ok;
      }
      if (t.srv) {
        state.servo = {
          mode: t.srv.mode || 'AUTO', deg: t.srv.deg ?? 90, target: t.srv.target ?? 90,
          trim: t.srv.trim ?? 0,
          min: t.srv.min ?? 15, max: t.srv.max ?? 165, ctr: t.srv.ctr ?? 90,
          phys: t.srv.phys ?? (t.srv.deg ?? 90),
          us: t.srv.us ?? 1500, pwmS: t.srv.pwmS ?? 0, moves: t.srv.moves ?? 0,
          invert: !!t.srv.inv, moving: !!t.srv.mov, pwm: !!t.srv.pwm, atLimit: !!t.srv.lim,
          locked: !!t.srv.lock, softStart: !!t.srv.soft
        };
      }
      if (t.sun) {
        state.sun = {
          ok: !!t.sun.ok, st: t.sun.st || 'DARK', rsn: t.sun.rsn || 'TOO_DARK_NO_SUN',
          e1: t.sun.e1 || 0, e2: t.sun.e2 || 0, adv: t.sun.adv || 0, thr: t.sun.thr || 10,
          lx1: t.sun.lx1 || 0, lx2: t.sun.lx2 || 0
        };
        if (prevSunOk !== null && state.sun.ok !== prevSunOk) {
          if (state.sun.ok) {
            addEvent('INFO', 'SUN', `Cahaya/Matahari terdeteksi! LDR1=${state.ldr1.pct}% (${state.sun.lx1} lx, exc=${state.sun.e1}) · LDR2=${state.ldr2.pct}% (${state.sun.lx2} lx, exc=${state.sun.e2})`);
          } else {
            addEvent('INFO', 'SUN', `Cahaya hilang / gelap (HOLD · raw ${state.ldr1.raw}/${state.ldr2.raw})`);
          }
        }
        if (state.sun.rsn === 'BOTH_SATURATED_EQUAL' && prevSunRsn !== 'BOTH_SATURATED_EQUAL') {
          addEvent('WARN', 'SUN', `Kedua LDR mentok cahaya sama kuat (raw ${state.ldr1.raw}/${state.ldr2.raw}) — pasang sekat pemisah LDR`);
        }
        prevSunOk = state.sun.ok;
        prevSunRsn = state.sun.rsn;
      }
      if (t.park) {
        state.park = {
          on: !!t.park.on,
          deg: t.park.deg ?? 90,
          darkS: t.park.darkS || 0,
          thrS: t.park.thrS || 300
        };
      }
      if (t.clk) {
        state.clk = {
          deg: t.clk.deg ?? 90,
          day: !!t.clk.day,
          pct: t.clk.pct || 0,
          sMin: t.clk.sMin ?? 360,
          eMin: t.clk.eMin ?? 1080,
          bias: t.clk.bias || 0,
          maxB: t.clk.maxB ?? 15
        };
      }
      if (t.astro) {
        state.astro = {
          el: t.astro.el ?? 0, az: t.astro.az ?? 90, eot: t.astro.eot ?? 0,
          eff: t.astro.eff ?? 100, w: t.astro.w ?? 0, logE: t.astro.logE ?? 0,
          lat: t.astro.lat ?? -6.2, lon: t.astro.lon ?? 106.82, tz: t.astro.tz ?? 7,
          step: t.astro.step ?? 4
        };
      }
      if (!state.espOnline) {
        state.espOnline = true;
        state.lastOnlineChangeMs = Date.now();
        addEvent('INFO', 'CONN', `ESP32 ONLINE (${state.serialPort || 'USB'} · ${state.firmwareVersion})`);
      }
      updateFaultHistory(Array.isArray(t.faults) ? t.faults : []);
      recordSessionMetrics();
      writeBlackbox('telem', t);

      state.history.push({ uptimeMs: uptimeMs(), raw1: state.ldr1.raw, mv1: state.ldr1.mv, pct1: state.ldr1.pct, raw2: state.ldr2.raw, mv2: state.ldr2.mv, pct2: state.ldr2.pct, deg: state.servo.deg });
      if (state.history.length > 600) state.history.shift();
      return;
    } catch {}
  }

  let lvl = 2;
  if (line.includes('[ERROR]') || line.includes('BROWNOUT')) lvl = 0;
  else if (line.includes('[WARN ]') || line.includes('WARN')) lvl = 1;
  else if (line.includes('[DEBUG]')) lvl = 3;
  else if (line.includes('[TRACE]')) lvl = 4;
  pushRawLog(lvl, line, 'ESP32');

  if (lvl <= 1 || line.includes('[SUN ]') || line.includes('[PARK]') || line.includes('[CLK ]')) {
    const tagMatch = line.match(/\[(PWR|EMI|SRVO|SUN|PARK|CLK|WIFI|MQTT|RTC|I2C|LDR[12]|BOOT|HIST)\s*\]/);
    const cat = tagMatch ? tagMatch[1].trim() : (line.includes('BROWNOUT') ? 'PWR' : 'SYS');
    const cleanMsg = line.replace(/^(\[[^\]]*\]\s*)+/, '').trim() || line;
    addEvent(lvl === 0 ? 'ERROR' : (lvl === 1 ? 'WARN' : 'INFO'), cat, cleanMsg);
  }

  if (state.sourceMode === 'sim') return;

  if (line.includes('BROWNOUT')) state.brownoutCount += 1;
  const i2cMatch = line.match(/0x([0-9A-Fa-f]{2})/);
  if (line.includes('[I2C') && i2cMatch) {
    const addr = '0x' + i2cMatch[1].toUpperCase();
    if (!state.i2cAddresses.includes(addr)) state.i2cAddresses.push(addr);
  }

  // Fallback parser for v0.2.0 text format before v0.3.0 is flashed
  const ldrMatch = line.match(/\[(LDR[12])\]\s+raw=(\d+)\s+mv=(\d+)\s+light=(\d+)%\s+win\(min\/max\/sd\)=(\d+)\/(\d+)\/(\d+)\s+state=([A-Z_ ]+?)(?:\s+->|$)/);
  if (ldrMatch) {
    if (state.firmwareType === 'UNKNOWN') { state.firmwareType = 'NEW_BRINGUP_V2'; state.firmwareVersion = 'v0.2.0-singlefile-id'; }
    const target = ldrMatch[1] === 'LDR1' ? state.ldr1 : state.ldr2;
    target.raw = Number(ldrMatch[2]); target.mv = Number(ldrMatch[3]); target.pct = Number(ldrMatch[4]);
    target.min = Number(ldrMatch[5]); target.max = Number(ldrMatch[6]); target.sd = Number(ldrMatch[7]);
    target.health = classifyHealth(target.raw, target.mv, target.sd);
    state.rawDiff = state.ldr1.raw - state.ldr2.raw;
    if (ldrMatch[1] === 'LDR2') {
      recordSessionMetrics();
      state.history.push({ uptimeMs: uptimeMs(), raw1: state.ldr1.raw, mv1: state.ldr1.mv, pct1: state.ldr1.pct, raw2: state.ldr2.raw, mv2: state.ldr2.mv, pct2: state.ldr2.pct, deg: state.servo.deg });
      if (state.history.length > 600) state.history.shift();
    }
    return;
  }

  const diffMatch = line.match(/\[DIFF\]\s+LDR1-LDR2\s*=\s*([+-]?\d+)%\s*\|\s*(?:DRY-RUN )?decision:\s*([A-Z0-9 ]+?)\s*(?:\(|\|)/);
  if (diffMatch) { state.delta = Number(diffMatch[1]); state.decision = diffMatch[2].trim(); return; }

  const rtcMatch = line.match(/\[RTC\s*\]\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}).*?running=(yes|no)\s+plausible=(yes|no)/);
  if (rtcMatch) { state.rtcPresent = true; state.rtcTimeStr = rtcMatch[1]; state.rtcRunning = rtcMatch[2] === 'yes'; state.rtcPlausible = rtcMatch[3] === 'yes'; }

  if (line.includes('[GUIDE]')) {
    const msg = line.split('[GUIDE]').pop().trim();
    state.guide.prompt = msg;
    if (msg.includes('BERHASIL') || msg.includes('PASSED')) { state.guide.state = 'PASS'; state.calibrated = true; }
    else if (msg.includes('GAGAL') || msg.includes('FAILED')) state.guide.state = 'FAIL';
    else state.guide.state = 'ACTIVE';
  }
}

function sendSerialCommand(cmd) {
  if (serialChild && serialChild.stdin.writable) {
    serialChild.stdin.write(cmd + '\n');
    addLog(2, 'TX', `Dikirim ke ${state.serialPort || 'ESP32'}: ${cmd}`);
    return true;
  }
  return false;
}

function stopSerialBridge() {
  if (serialChild) {
    const pid = serialChild.pid;
    try {
      if (process.platform === 'win32' && pid) execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      else serialChild.kill();
    } catch {}
    serialChild = null;
  }
  state.hardwareConnected = false;
}

function resolvePythonExe() {
  const useDirect = fs.existsSync(PIO_PYTHON_DIRECT) && fs.existsSync(PIO_SITE_PACKAGES);
  if (useDirect) return { pyExe: PIO_PYTHON_DIRECT, useDirect: true };
  if (fs.existsSync(PIO_PYTHON)) return { pyExe: PIO_PYTHON, useDirect: false };
  return { pyExe: process.platform === 'win32' ? 'python' : 'python3', useDirect: false };
}

function fallbackToSimIfNoHardware(reason) {
  state.hardwareConnected = false;
  state.espOnline = false;
  state.hardwareError = reason;
  addLog(1, 'USB', `Serial bridge tidak aktif: ${reason}`);
  if (MODE === 'dev' && state.sourceMode === 'usb' && state.packetCount === 0) {
    state.sourceMode = 'sim';
    state.preset = 'normal';
    addLog(2, 'SIM', 'Tidak ada perangkat USB ESP32 terdeteksi — beralih otomatis ke Simulator (mode dev).');
    addEvent('INFO', 'CONN', 'Beralih otomatis ke mode Simulator (tidak ada USB ESP32 di host)');
    tickSimulator();
  }
}

function startSerialBridge() {
  stopSerialBridge();
  const { pyExe, useDirect } = resolvePythonExe();
  const env = { ...process.env };
  if (useDirect) {
    env.PYTHONPATH = PIO_SITE_PACKAGES + (env.PYTHONPATH ? ';' + env.PYTHONPATH : '');
  }
  let child;
  try {
    child = spawn(pyExe, ['-u', BRIDGE_SCRIPT, 'AUTO', '115200'], { cwd: __dirname, env });
  } catch (err) {
    fallbackToSimIfNoHardware(err.message || 'Gagal menjalankan Python serial bridge');
    return;
  }
  serialChild = child;
  let buf = '';
  let stderrBuf = '';
  let handledError = false;

  child.on('error', (err) => {
    if (serialChild === child) serialChild = null;
    handledError = true;
    fallbackToSimIfNoHardware(`${pyExe}: ${err.code || err.message}`);
  });

  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
  });

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || '';
    for (const l of lines) {
      if (!l) continue;
      try {
        const msg = JSON.parse(l);
        if (msg.type === 'connected') {
          state.hardwareConnected = true; state.serialPort = msg.port; state.hardwareError = '';
          addLog(2, 'USB', `Terhubung ke ESP32 di ${msg.port} @ ${msg.baud} baud`);
        } else if (msg.type === 'line') parseEsp32SerialLine(msg.line);
        else if (msg.type === 'error') {
          handledError = true;
          fallbackToSimIfNoHardware(msg.error);
          if (state.sourceMode === 'usb') {
            addEvent('ERROR', 'CONN', `USB Serial error: ${msg.error}`);
          }
        }
      } catch {}
    }
  });

  child.on('close', (code) => {
    const wasOnline = state.espOnline;
    if (serialChild === child) serialChild = null;
    if (state.sourceMode === 'usb') {
      state.hardwareConnected = false;
      state.espOnline = false;
    }
    if (wasOnline && state.sourceMode === 'usb') {
      addEvent('ERROR', 'CONN', 'ESP32 OFFLINE (koneksi USB terputus)');
    } else if (!handledError && code && code !== 0) {
      const errLine = stderrBuf.trim().split(/\r?\n/).pop() || `exit code ${code}`;
      fallbackToSimIfNoHardware(errLine);
    }
  });
}

function runFastFlash(onDone) {
  stopSerialBridge();
  const { pyExe } = resolvePythonExe();
  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    onDone(code);
  };
  let child;
  try {
    child = spawn(pyExe, [FLASH_SCRIPT], { cwd: __dirname });
  } catch (err) {
    addLog(0, 'FLASH', `Gagal memulai flash: ${err.message}`);
    return finish(1);
  }
  child.on('error', (err) => {
    addLog(0, 'FLASH', `Python/PlatformIO tidak tersedia (${err.code || err.message})`);
    finish(1);
  });
  child.stdout.on('data', (d) => {
    process.stdout.write(d);
    d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => addLog(2, 'FLASH', l.slice(0, 180)));
  });
  child.stderr.on('data', (d) => {
    process.stderr.write(d);
    d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => addLog(1, 'FLASH', l.slice(0, 180)));
  });
  child.on('close', (code) => finish(code));
}

// ============================================================================
// HTTP Server
// ============================================================================
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function sendJson(res, status, obj) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/status') {
    const espOnline = computeEspOnline();
    state.espOnline = espOnline;
    return sendJson(res, 200, {
      mode: MODE, sourceMode: state.sourceMode, hardwareConnected: state.hardwareConnected,
      espOnline,
      serialPort: state.serialPort, hardwareError: state.hardwareError,
      firmwareType: state.firmwareType, firmwareVersion: state.firmwareVersion,
      resetReason: state.resetReason, bootCount: state.bootCount,
      brownoutCount: state.brownoutCount, wdtCount: state.wdtCount, panicCount: state.panicCount,
      freeHeap: state.freeHeap, minHeap: state.minHeap, maxAlloc: state.maxAlloc,
      tempC: state.tempC, loopMs: state.loopMs, i2cErr: state.i2cErr, eeprom: state.eeprom,
      pwr: state.pwr,
      packetCount: state.packetCount, packetRateHz: espOnline ? state.packetRateHz : 0,
      lastRxAgoMs: state.lastPacketMs > 0 ? (Date.now() - state.lastPacketMs) : null,
      rawDiff: state.rawDiff, i2cAddresses: state.i2cAddresses, calibrated: state.calibrated,
      cal: { dark1: state.dark1, bright1: state.bright1, bih1: state.bih1, dark2: state.dark2, bright2: state.bright2, bih2: state.bih2 },
      ldr1: { ...state.ldr1, bih: state.bih1 }, ldr2: { ...state.ldr2, bih: state.bih2 },
      servo: state.servo, sun: state.sun, park: state.park, clk: state.clk, astro: state.astro, faults: state.faults, events: state.events.slice(-80),
      sessionStats: state.sessionStats,
      delta: state.delta, deadband: DEADBAND_PCT, decision: state.decision,
      explain: buildExplain(), checklist: buildChecklist(),
      rtc: { present: state.rtcPresent, running: state.rtcRunning, plausible: state.rtcPlausible, time: state.rtcTimeStr || formatRtc() },
      guide: state.guide, preset: state.preset, simLight: state.simLight, blackboxFile: path.basename(BLACKBOX_FILE)
    });
  }

  if (req.method === 'GET' && p === '/api/events') {
    const since = Number(url.searchParams.get('since') || 0);
    return sendJson(res, 200, { events: state.events.filter((e) => e.id > since).slice(-100) });
  }

  if (req.method === 'GET' && p === '/api/logs') {
    const since = Number(url.searchParams.get('since') || 0);
    return sendJson(res, 200, { logs: state.logs.filter((l) => l.id > since).slice(-60) });
  }

  if (req.method === 'GET' && p === '/api/debug-bundle') {
    return sendJson(res, 200, buildAiDebugBundle());
  }

  if (req.method === 'POST' && p === '/api/servo') {
    const body = await readBody(req);
    const mode = body.mode || '';
    if (mode === 'manual') { state.servo.mode = 'MANUAL'; sendSerialCommand('servo manual'); }
    else if (mode === 'auto') { state.servo.mode = 'AUTO'; sendSerialCommand('servo auto'); }
    else if (mode === 'clock') { state.servo.mode = 'CLOCK'; sendSerialCommand('servo clock'); }
    else if (mode === 'hybrid') { state.servo.mode = 'HYBRID'; sendSerialCommand('servo hybrid'); }
    else if (mode === 'stop') { state.servo.mode = 'MANUAL'; state.servo.locked = true; sendSerialCommand('servo stop'); }
    else if (mode === 'unlock') { state.servo.locked = false; sendSerialCommand('servo unlock'); }
    else if (mode === 'center') { state.servo.mode = 'MANUAL'; state.servo.target = state.servo.ctr ?? 90; sendSerialCommand('servo center'); }
    else if (mode === 'park') { state.park.on = true; sendSerialCommand('servo park'); }
    else if (mode === 'unpark') { state.park.on = false; sendSerialCommand('servo unpark'); }
    else if (mode === 'setpark') { state.park.deg = state.servo.deg; sendSerialCommand('servo setpark'); }
    else if (mode === 'setcenter') { sendSerialCommand('servo setcenter'); }
    else if (mode === 'setmin') { sendSerialCommand('servo setmin'); }
    else if (mode === 'setmax') { sendSerialCommand('servo setmax'); }
    else if (mode === 'resetlim') { sendSerialCommand('servo resetlim'); }
    else if (mode === 'resettrim') { state.servo.trim = 0; sendSerialCommand('servo resettrim'); }
    else if (mode === 'invert') { state.servo.invert = !state.servo.invert; sendSerialCommand('servo invert'); }
    if (typeof body.trimDelta === 'number') {
      const nextTrim = Math.max(-45, Math.min(45, (state.servo.trim || 0) + Math.round(body.trimDelta)));
      state.servo.trim = nextTrim;
      sendSerialCommand(`servo trim ${nextTrim}`);
    }
    if (typeof body.deg === 'number') {
      const lo = state.servo.min ?? 15;
      const hi = state.servo.max ?? 165;
      const clamped = Math.max(lo, Math.min(hi, Math.round(body.deg)));
      state.servo.mode = 'MANUAL';
      state.servo.target = clamped;
      sendSerialCommand(`servo ${clamped}`);
    }
    return sendJson(res, 200, { ok: true, servo: state.servo });
  }

  if (req.method === 'POST' && p === '/api/clock') {
    const body = await readBody(req);
    const start = String(body.start || '06:00').trim();
    const end = String(body.end || '18:00').trim();
    const bias = Math.max(0, Math.min(45, Math.round(Number(body.bias ?? 15))));
    sendSerialCommand(`clock ${start} ${end} ${bias}`);
    if (typeof body.lat === 'number' && typeof body.lon === 'number') {
      const tz = typeof body.tz === 'number' ? body.tz : 7;
      const step = Math.max(1, Math.min(15, Math.round(Number(body.step ?? 4))));
      sendSerialCommand(`geo ${body.lat.toFixed(2)} ${body.lon.toFixed(2)} ${tz} ${step}`);
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/serial/send') {
    const body = await readBody(req);
    const cmd = (body.cmd || '').trim();
    return sendJson(res, cmd ? 200 : 400, { ok: cmd ? sendSerialCommand(cmd) : false });
  }

  if (req.method === 'POST' && p === '/api/cal') {
    const body = await readBody(req);
    const map = { guide: 'cal guide', dark: 'cal dark', bright: 'cal bright', reset: 'cal reset', resetstats: 'resetstats' };
    if (state.hardwareConnected && state.sourceMode === 'usb' && map[body.action]) sendSerialCommand(map[body.action]);
    if (body.action === 'dark') { state.dark1 = state.ldr1.raw; state.dark2 = state.ldr2.raw; state.calibrated = true; }
    else if (body.action === 'bright') { state.bright1 = state.ldr1.raw; state.bright2 = state.ldr2.raw; state.bih1 = state.bright1 >= state.dark1; state.bih2 = state.bright2 >= state.dark2; state.calibrated = true; }
    else if (body.action === 'reset') { state.dark1 = 500; state.bright1 = 3500; state.dark2 = 500; state.bright2 = 3500; state.calibrated = false; }
    else if (body.action === 'resetstats') { state.history = []; }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/rtc') {
    const body = await readBody(req);
    if (state.hardwareConnected && state.sourceMode === 'usb' && body.epoch) {
      const d = new Date(body.epoch * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      sendSerialCommand(`settime ${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`);
    }
    const ep = body.utcEpoch || body.epoch;
    if (ep) { state.rtcOffsetMs = (ep * 1000) - Date.now(); state.rtcTimeStr = formatRtc(); }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/selftest') {
    if (state.hardwareConnected && state.sourceMode === 'usb') sendSerialCommand('selftest');
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/sim/preset') {
    const body = await readBody(req);
    state.simLight.active = false;
    if (body.preset === 'live') { state.sourceMode = 'usb'; state.preset = 'live'; if (!state.hardwareConnected) startSerialBridge(); }
    else if (body.preset) { state.sourceMode = 'sim'; state.preset = body.preset; }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/sim/light') {
    const body = await readBody(req);
    const active = !!body.active;
    state.simLight.active = active;
    if (typeof body.deg === 'number' && Number.isFinite(body.deg)) {
      state.simLight.deg = Math.max(10, Math.min(170, Math.round(body.deg)));
    }
    if (typeof body.elevation === 'number' && Number.isFinite(body.elevation)) {
      state.simLight.elevation = Math.max(10, Math.min(88, Math.round(body.elevation)));
    }
    if (typeof body.intensity === 'number' && Number.isFinite(body.intensity)) {
      state.simLight.intensity = Math.max(0, Math.min(1, Number(body.intensity)));
    }
    if (active && state.sourceMode === 'sim') {
      tickSimulator();
    }
    return sendJson(res, 200, { ok: true, simLight: state.simLight });
  }

  if (req.method === 'POST' && p === '/api/pio/disconnect') {
    stopSerialBridge();
    addLog(2, 'USB', 'Port serial dilepaskan sementara untuk proses flash...');
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/pio/reconnect') {
    state.sourceMode = 'usb'; startSerialBridge();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/pio/flash') {
    addLog(2, 'FLASH', 'Memulai Fast Flash ke ESP32 — TAHAN TOMBOL BOOT (IO0) SEKARANG!');
    return runFastFlash((code) => {
      setTimeout(() => startSerialBridge(), 1200);
      sendJson(res, code === 0 ? 200 : 500, { ok: code === 0 });
    });
  }

  if (req.method === 'GET' && p === '/api/export.csv') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="solar-tracker-export.csv"' });
    res.write('uptime_ms,ldr1_raw,ldr1_mv,ldr1_pct,ldr2_raw,ldr2_mv,ldr2_pct,servo_deg\n');
    for (const pt of state.history) res.write(`${pt.uptimeMs},${pt.raw1},${pt.mv1},${pt.pct1},${pt.raw2},${pt.mv2},${pt.pct2},${pt.deg ?? 90}\n`);
    return res.end();
  }

  if (req.method === 'GET' && p === '/api/export.jsonl') {
    if (!fs.existsSync(BLACKBOX_FILE)) { res.writeHead(404); return res.end('No session log yet'); }
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/x-ndjson', 'Content-Disposition': `attachment; filename="${path.basename(BLACKBOX_FILE)}"` });
    return fs.createReadStream(BLACKBOX_FILE).pipe(res);
  }

  if (p.startsWith('/vendor/three/')) {
    const vendorRel = p.slice('/vendor/three/'.length).replace(/^\/+/, '');
    const vendorPath = path.resolve(THREE_VENDOR_DIR, vendorRel);
    if (!vendorPath.startsWith(THREE_VENDOR_DIR + path.sep) || !fs.existsSync(vendorPath) || fs.statSync(vendorPath).isDirectory()) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, { ...CORS, 'Content-Type': MIME[path.extname(vendorPath)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
    return fs.createReadStream(vendorPath).pipe(res);
  }

  const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not Found'); }
  res.writeHead(200, { ...CORS, 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

if (require.main === module) {
  if (MODE === 'prod' && !NO_FLASH) {
    runFastFlash(() => {
      setTimeout(() => startSerialBridge(), 1200);
      server.listen(PORT, HOST, () => console.log(`SolarTracker PROD listening at http://${HOST}:${PORT}/`));
    });
  } else {
    startSerialBridge();
    server.listen(PORT, HOST, () => console.log(`SolarTracker ${MODE.toUpperCase()} + Live USB + Blackbox (${path.basename(BLACKBOX_FILE)}) at http://${HOST}:${PORT}/`));
  }
} else {
  clearInterval(simInterval);
  clearInterval(rateInterval);
}

module.exports = {
  server,
  state,
  classifyHealth,
  normalizePct,
  evaluateDecision,
  computeSimLightRaw,
  tickSimulator,
  startSerialBridge,
  stopSerialBridge
};
