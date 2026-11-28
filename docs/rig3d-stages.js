'use strict';

/**
 * Pure ordered build-stage definitions, stage visibility predicates,
 * and Git-style Undo/Redo history state machine for the SolarTracker 3D Digital Twin.
 * Zero DOM/WebGL dependencies so all transitions and stage rules are unit-tested via node:test.
 */

export const MIN_BUILD_STAGE = 1;
export const FULL_BUILD_STAGE = 5;

export const BUILD_STAGES = [
  {
    index: 1,
    code: 'c1',
    id: 'rig_base',
    title: 'Rig Dasar, Aki 12V, LDR, RTC & ESP32',
    shortLabel: 'Rig Dasar & Kontrol',
    modulesLabel: 'Panel · Watt Meter · SCC · Aki 12V · Servo (Mekanis) · Breadboard · ESP32 · Tiny RTC · LDR 1/2',
    wireDeltaLabel: '16 kabel dasar',
    focusPreset: 'overview',
    summary: 'Rangka utama, panel surya, Watt Meter, SCC, Aki 12V, LDR 1 & 2, Tiny RTC, dan ESP32 siap (ESP32 disuplai lewat USB; XL4015, INA219, UPS, & Switch belum dipasang).',
    wiringRows: [
      { from: 'Panel Surya (+/−)', to: 'Watt Meter → SCC +PV−' },
      { from: 'Aki INCOE 12V (+/−)', to: 'SCC +BAT−' },
      { from: 'LDR 1 & LDR 2 (VCC/GND/AO)', to: 'ESP32 3.3V / GND / GPIO34 & 35' },
      { from: 'Tiny RTC (SCL/SDA/VCC/GND)', to: 'ESP32 GPIO22 / GPIO21 / 3.3V / GND' },
      { from: 'ESP32 Daya Uji', to: 'Sambungkan lewat kabel USB' }
    ],
    safetyTitle: 'Tahap Persiapan Kontrol (Sebelum Daya Servo)',
    safetyWarning: 'Pastikan sensor LDR 1/2 dan Tiny RTC terbaca lewat USB terlebih dahulu sebelum merakit jalur buck 6 V XL4015.',
    safetySteps: [
      'Sambungkan ESP32 ke laptop melalui kabel USB.',
      'Pastikan pembacaan LDR 1 (GPIO34), LDR 2 (GPIO35), dan jam Tiny RTC normal.',
      'Siapkan modul XL4015 sebelum lanjut ke Tahap c2.'
    ]
  },
  {
    index: 2,
    code: 'c2',
    id: 'xl4015',
    title: 'XL4015 Buck 6V, Common GND & Servo MG996R',
    shortLabel: 'XL4015 + Servo',
    modulesLabel: '+ XL4015 Merah · Kabel 12V Langsung · Common GND (3 Kabel) · Servo 6V & PWM',
    wireDeltaLabel: '+7 kabel (tanpa INA219)',
    focusPreset: 'xl4015',
    summary: 'Jalur kerja saat ini tanpa INA219, UPS, & Switch: SCC LOAD+/− langsung masuk ke XL4015 IN+/−, output XL4015 diset 6 V untuk Servo MG996R, dan 3 jalur GND disatukan di Common GND.',
    wiringRows: [
      { from: 'SCC LOAD+ & LOAD− (12V)', to: 'XL4015 IN+ & IN− (langsung)' },
      { from: 'XL4015 OUT+ (6 V)', to: 'MG996R kabel merah' },
      { from: 'XL4015 OUT−', to: 'Common GND (Breadboard)' },
      { from: 'MG996R kabel cokelat', to: 'Common GND (langsung ke titik distribusi)' },
      { from: 'ESP32 GND', to: 'Common GND (Breadboard)' },
      { from: 'ESP32 GPIO 18', to: 'MG996R kabel orange (PWM)' },
      { from: 'ESP32 Daya Uji', to: 'USB Laptop / Charger (belum pakai UPS)' }
    ],
    safetyTitle: 'Prosedur Wajib Sebelum Menyalakan (Set 6 V)',
    safetyWarning: 'Penting: Jangan menghubungkan output 6 V XL4015 ke pin 3V3 atau 5V ESP32! Kabel GND servo sebaiknya langsung ke titik distribusi GND, jangan lewat jalur panjang breadboard.',
    safetySteps: [
      '1. Jangan sambungkan servo dulu.',
      '2. Nyalakan controller (SCC) dan XL4015.',
      '3. Ukur output XL4015 dengan multimeter.',
      '4. Atur trimpot menjadi tepat 6 V.',
      '5. Matikan suplai, baru sambungkan servo.',
      '6. Sambungkan ESP32 melalui USB.',
      '7. Nyalakan kembali dan uji servo tanpa beban mekanis terlebih dahulu.'
    ]
  },
  {
    index: 3,
    code: 'c3',
    id: 'ina219',
    title: 'Sensor Arus & Tegangan INA219 (12V + I2C)',
    shortLabel: 'Sensor INA219',
    modulesLabel: '+ INA219 (0x40) · Shunt R100 seri SCC LOAD+ · I2C Aux · Common GND ke-4',
    wireDeltaLabel: '+5 bersih (+6 baru, ganti 1 jumper)',
    focusPreset: 'ina219',
    summary: 'Menyisipkan sensor INA219 secara seri pada jalur positif 12 V (SCC LOAD+ → VIN+ → VIN− → XL4015 IN+) serta menghubungkan VCC 3.3V, SCL/SDA (bus I2C), dan kabel ke-4 Common GND.',
    wiringRows: [
      { from: 'SCC LOAD+ (12V)', to: 'INA219 sekrup VIN+' },
      { from: 'INA219 sekrup VIN−', to: 'XL4015 IN+' },
      { from: 'INA219 VCC / SCL / SDA', to: 'ESP32 Aux 3.3V / D22 / D21' },
      { from: 'INA219 GND', to: 'Common GND (kabel ke-4)' }
    ],
    safetyTitle: 'Pemasangan Shunt 12V INA219',
    safetyWarning: 'Pastikan kabel 12 V hanya masuk ke terminal sekrup biru VIN+/VIN− (jangan salah masuk ke pin VCC 3.3V INA219), dan INA219 GND terhubung ke Common GND.',
    safetySteps: [
      'Matikan suplai 12 V SCC sebelum melepas kabel SCC LOAD+ → XL4015 IN+.',
      'Pasang SCC LOAD+ ke VIN+ dan VIN− ke XL4015 IN+ dengan kencang.',
      'Hubungkan VCC (3.3V), SCL (GPIO22), SDA (GPIO21), dan GND ke Common GND.'
    ]
  },
  {
    index: 4,
    code: 'c4',
    id: 'ups',
    title: 'UPS 5V QF-M6001-2 (2×18650 Paralel)',
    shortLabel: 'UPS 5V (2×18650)',
    modulesLabel: '+ Modul UPS QF-M6001-2 · USB-C 5V IN · 2× Sel 18650 · Suplai 5V ke ESP32',
    wireDeltaLabel: '+3 kabel daya 5V',
    focusPreset: 'ups',
    summary: 'Memasang modul UPS QF-M6001-2 dengan 2 baterai 18650 paralel dan adaptor USB-C 5V, lalu menyalurkan output UPS+ ke pin 5V ESP32 dan UPS− ke GND ESP32.',
    wiringRows: [
      { from: 'Adaptor USB-C 5V', to: 'UPS QF-M6001-2 USB-C IN' },
      { from: 'UPS+ (Boost 5V)', to: 'ESP32 GOOUUU V4 5V (langsung sebelum switch)' },
      { from: 'UPS− (GND)', to: 'ESP32 GOOUUU V4 GND' }
    ],
    safetyTitle: 'Pemeriksaan Tegangan 5V UPS',
    safetyWarning: 'Jangan mencolok USB laptop bersamaan dengan UPS+ yang masih tersambung langsung ke pin 5V sebelum Switch 5V dipasang pada tahap berikutnya.',
    safetySteps: [
      'Pastikan polaritas kedua baterai 18650 paralel benar sesuai tanda +/− pada holder.',
      'Ukur pad output UPS+ / UPS− dengan multimeter dan pastikan stabil di ~5.0 V.',
      'Lepas kabel USB laptop sebelum menyambungkan UPS+ ke header 5V GOOUUU V4.'
    ]
  },
  {
    index: 5,
    code: 'c5',
    id: 'ups_switch',
    title: 'Switch 5V KCD11 (Pengaman Flash · Rig Lengkap)',
    shortLabel: 'Switch 5V (HEAD)',
    modulesLabel: '+ Saklar Rocker KCD11 (I/O) seri UPS+ → ESP32 5V',
    wireDeltaLabel: '+1 bersih (pecah 2 segmen · 32 kabel)',
    focusPreset: 'ups_switch',
    summary: 'Rig lengkap (HEAD): memutus kabel merah UPS+ → ESP32 5V dan menyisipkan saklar KCD11 (I/O) agar rel 5V UPS dapat dimatikan aman saat flash ESP32 lewat USB laptop.',
    wiringRows: [
      { from: 'UPS+ (5V)', to: 'Switch 5V Terminal IN' },
      { from: 'Switch 5V Terminal OUT', to: 'ESP32 GOOUUU V4 5V' },
      { from: 'UPS− (GND)', to: 'ESP32 GOOUUU V4 GND' }
    ],
    safetyTitle: 'Prosedur Aman Flash USB Dengan UPS',
    safetyWarning: 'Selalu tekan Switch 5V ke posisi O (OFF) sebelum mencolok kabel Micro-USB laptop ke ESP32 untuk upload firmware.',
    safetySteps: [
      'Posisi I (ON): UPS 5V menyuplai ESP32 untuk operasi mandiri.',
      'Posisi O (OFF): Jalur 5V UPS terputus aman sehingga ESP32 bisa di-flash via USB laptop.'
    ]
  }
];

export const HOTSPOT_MIN_STAGE = {
  panel: 1,
  wattmeter: 1,
  scc: 1,
  battery: 1,
  servo: 1,
  ldr: 1,
  breadboard: 1,
  esp32: 1,
  rtc: 1,
  xl4015: 2,
  ina219: 3,
  ups: 4,
  ups_switch: 5
};

export const PRESET_MIN_STAGE = {
  overview: 1,
  front: 1,
  watt_scc: 1,
  power: 1,
  rear: 1,
  esp_pins: 1,
  breadboard: 1,
  tiny_rtc: 1,
  ldr: 1,
  xl4015: 2,
  ina219: 3,
  ups: 4,
  ups_switch: 5
};

export const WIRE_NET_MIN_STAGE = {
  pv: 1,
  bat: 1,
  i2c: 1,
  ldr: 1,
  buck12v: 2,
  servo6v: 2,
  gnd: 2,
  pwm: 2,
  ina219: 3,
  usb: 4
};

export function clampBuildStage(stage) {
  const n = Number(stage);
  if (!Number.isFinite(n)) return FULL_BUILD_STAGE;
  return Math.max(MIN_BUILD_STAGE, Math.min(FULL_BUILD_STAGE, Math.round(n)));
}

export function isStageRangeActive(stage, minStage = MIN_BUILD_STAGE, maxStage = FULL_BUILD_STAGE) {
  const s = clampBuildStage(stage);
  return s >= (minStage ?? MIN_BUILD_STAGE) && s <= (maxStage ?? FULL_BUILD_STAGE);
}

export function getBuildStageMeta(stage) {
  const s = clampBuildStage(stage);
  return BUILD_STAGES.find((item) => item.index === s) || BUILD_STAGES[BUILD_STAGES.length - 1];
}

export function isHotspotVisibleAtStage(hotspotId, stage) {
  const minS = HOTSPOT_MIN_STAGE[hotspotId] ?? 1;
  return clampBuildStage(stage) >= minS;
}

export function isPresetVisibleAtStage(presetName, stage) {
  const minS = PRESET_MIN_STAGE[presetName] ?? 1;
  return clampBuildStage(stage) >= minS;
}

export function isWireNetVisibleAtStage(netKey, stage) {
  if (!netKey) return true;
  const minS = WIRE_NET_MIN_STAGE[netKey] ?? 1;
  return clampBuildStage(stage) >= minS;
}

export function createStageHistoryState(
  initialStage = FULL_BUILD_STAGE,
  undoStack = [],
  redoStack = []
) {
  return {
    currentStage: clampBuildStage(initialStage),
    undoStack: Array.isArray(undoStack)
      ? undoStack.map(clampBuildStage).slice(-32)
      : [],
    redoStack: Array.isArray(redoStack)
      ? redoStack.map(clampBuildStage).slice(-32)
      : []
  };
}

export function checkoutStageInHistory(state, nextStage) {
  const cur = createStageHistoryState(state?.currentStage, state?.undoStack, state?.redoStack);
  const target = clampBuildStage(nextStage);
  if (target === cur.currentStage) {
    return { ...cur, changed: false };
  }
  const undoStack = [...cur.undoStack, cur.currentStage].slice(-32);
  return {
    currentStage: target,
    undoStack,
    redoStack: [],
    changed: true
  };
}

export function undoStageInHistory(state) {
  const cur = createStageHistoryState(state?.currentStage, state?.undoStack, state?.redoStack);
  if (cur.undoStack.length === 0) {
    return { ...cur, changed: false };
  }
  const prevStage = cur.undoStack[cur.undoStack.length - 1];
  return {
    currentStage: prevStage,
    undoStack: cur.undoStack.slice(0, -1),
    redoStack: [...cur.redoStack, cur.currentStage].slice(-32),
    changed: true
  };
}

export function redoStageInHistory(state) {
  const cur = createStageHistoryState(state?.currentStage, state?.undoStack, state?.redoStack);
  if (cur.redoStack.length === 0) {
    return { ...cur, changed: false };
  }
  const nextStage = cur.redoStack[cur.redoStack.length - 1];
  return {
    currentStage: nextStage,
    undoStack: [...cur.undoStack, cur.currentStage].slice(-32),
    redoStack: cur.redoStack.slice(0, -1),
    changed: true
  };
}
