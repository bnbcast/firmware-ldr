'use strict';

/**
 * Pure pin-coordinate, breadboard Common GND hub, clickable pin registry,
 * and pin-to-pin wiring specs for the SolarTracker 3D Digital Twin.
 * Zero DOM/WebGL dependencies so every coordinate, pin, and wire net is
 * unit-tested via node:test and shared by rig3d-model.js and rig3d.js.
 */

export const RIG_DIMS = {
  postHeight: 1.58,
  pivotPos: { x: 0, y: 1.58, z: 0 },
  panelWidth: 0.46,     // narrow along X (horizontal hinge axle) -> VERTICAL / PORTRAIT panel!
  panelDepth: 0.68,     // tall along Z (sweep plane: 15° facing Watt Meter +Z <-> 90° flat <-> 165° opposite -Z)
  panelThick: 0.012,
  panelFrontPitchRad: 0.0, // Symmetric 0° flat at 90° so panel flips cleanly toward +Z (Watt Meter) and -Z (opposite)!
  servoBodyPos: { x: 0.056, y: 1.40, z: -0.024 },
  hornOrigin: { x: 0.079, y: 1.425, z: -0.024 },
  hornLength: 0.052,
  bracketAnchorLocal: { x: 0.080, y: 0.022, z: -0.125 },
  deckY: 0.61,
  deckZ: 0.115
};

/**
 * Front-facing (+Z) vertical stack matching user's exact layout:
 *  TOP:    Solar Panel (front cells angled toward +Z)
 *  UPPER:  Blue Digital Watt Meter (front +Z, y = 1.13)
 *  MIDDLE: Blue PWM Solar Charge Controller (front +Z, y = 0.90)
 *  LOWER:  Horizontal White Electronics Deck (y = 0.61, z = +0.115):
 *            LDR Baffle (-0.42) | Red XL4015 (-0.21) | Breadboard Common GND (-0.04) | GOOUUU ESP32 (+0.14) | Tiny RTC (+0.30)
 *  FLOOR:  INCOE SA-20 12V Battery (y = 0)
 */
export const BOARD_ORIGINS = {
  watt:   { x: 0.0,    y: 1.13,                   z: 0.048, rotY: 0 },
  scc:    { x: 0.0,    y: 0.90,                   z: 0.056, rotY: 0 },
  ldr:    { x: -0.43,  y: RIG_DIMS.deckY + 0.010, z: RIG_DIMS.deckZ },
  ina219: { x: -0.306, y: RIG_DIMS.deckY + 0.011, z: RIG_DIMS.deckZ + 0.004 },
  xl:     { x: -0.215, y: RIG_DIMS.deckY + 0.011, z: RIG_DIMS.deckZ + 0.004 },
  bread:  { x: -0.042, y: RIG_DIMS.deckY + 0.011, z: RIG_DIMS.deckZ + 0.004 },
  esp:    { x: 0.140,  y: RIG_DIMS.deckY + 0.010, z: RIG_DIMS.deckZ + 0.004 },
  rtc:    { x: 0.295,  y: RIG_DIMS.deckY + 0.010, z: RIG_DIMS.deckZ + 0.004 },
  ups:    { x: 0.442,  y: RIG_DIMS.deckY + 0.028, z: RIG_DIMS.deckZ + 0.004 },
  bat:    { x: -0.22,  y: 0.0,                    z: -0.14, rotY: 0.26 }
};

export const GOOUUU_FRONT_PINS = [
  '3V3', 'EN', 'VP', 'VN', '34', '35', '32', '33', '25',
  '26', '27', '14', '12', 'GND', '13', 'D2', 'D3', 'CMD', '5V'
];

export const GOOUUU_REAR_PINS = [
  'GND', '23', '22', 'TX0', 'RX0', '21', 'GND', '19', '18',
  '5', '17', '16', '4', '0', '2', '15', 'D1', 'D0', 'CLK'
];

export const GOOUUU_AUX_PINS = ['D22', 'D21', 'VCC', 'GND'];
export const INA219_PINS = ['VCC', 'GND', 'SCL', 'SDA', 'VIN-', 'VIN+'];
export const TINY_RTC_PINS = ['SQ', 'DS', 'SCL', 'SDA', 'VCC', 'GND', 'BAT'];
export const LM393_PINS = ['VCC', 'GND', 'DO', 'AO'];
export const SCC_TERMINAL_PINS = ['PV+', 'PV-', 'BAT+', 'BAT-', 'LOAD+', 'LOAD-'];

export const GOOUUU_GEO = {
  width: 0.142,
  thick: 0.006,
  depth: 0.096,
  pinPitch: 0.0052,
  pinOffsetX: -0.0175,
  // Exact real GOOUUU ESP32S 38P/V4 order moving outward from center NodeMCU:
  // Innermost = Black G (GND), Middle = Red V (3.3V/5V), Outermost = Yellow S (Signal GPIO)
  rowZ: {
    G: 0.0295,
    V: 0.0348,
    S: 0.0401
  },
  pinTopY: 0.0155
};

export const INA219_GEO = {
  width: 0.056,
  thick: 0.004,
  depth: 0.048,
  headerPitch: 0.0072,
  headerZ: 0.0172,
  pinTopY: 0.0145
};

export const UPS_GEO = {
  width: 0.102,
  thick: 0.0036,
  depth: 0.050,
  cellRadius: 0.0090,
  cellLength: 0.065,
  cellZOffsets: [-0.0110, 0.0110],
  cellYOffset: -0.0112
};

export const BREADBOARD_GEO = {
  width: 0.112,
  thick: 0.010,
  depth: 0.072,
  gndRailZ: 0.0285, // Front blue (−) Common Ground bus rail holes!
  vccRailZ: 0.0225, // Front red (+) rail
  pinTopY: 0.0145
};

function rotateYPoint(localX, localY, localZ, origin) {
  const ang = origin.rotY || 0;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [
    origin.x + localX * c + localZ * s,
    origin.y + localY,
    origin.z - localX * s + localZ * c
  ];
}

export function getGoouuuPinPos(side, index, row = 'S') {
  const x = GOOUUU_GEO.pinOffsetX + (index - 9) * GOOUUU_GEO.pinPitch;
  const zSign = side === 'front' ? 1 : -1;
  const z = zSign * GOOUUU_GEO.rowZ[row];
  const local = [x, GOOUUU_GEO.pinTopY, z];
  const world = [
    BOARD_ORIGINS.esp.x + local[0],
    BOARD_ORIGINS.esp.y + local[1],
    BOARD_ORIGINS.esp.z + local[2]
  ];
  return { local, world };
}

/**
 * Rear-right auxiliary 2x4 header on GOOUUU ESP32S V4 (inner row: D22, D21, VCC, GND).
 */
export function getGoouuuAuxPinPos(pinName) {
  const idx = GOOUUU_AUX_PINS.indexOf(pinName);
  const k = idx >= 0 ? idx : 0;
  const local = [0.0345 + k * 0.0042, GOOUUU_GEO.pinTopY, -0.0338];
  const world = [
    BOARD_ORIGINS.esp.x + local[0],
    BOARD_ORIGINS.esp.y + local[1],
    BOARD_ORIGINS.esp.z + local[2]
  ];
  return { local, world };
}

/**
 * Front-right 2x4 power header on GOOUUU ESP32S V4 (5V | 3V top row, GND bottom row).
 */
export function getGoouuuPwrPinPos(pinName) {
  const map = {
    '5V':  [0.0338, GOOUUU_GEO.pinTopY, 0.0322],
    '3V':  [0.0414, GOOUUU_GEO.pinTopY, 0.0322],
    'GND': [0.0338, GOOUUU_GEO.pinTopY, 0.0368]
  };
  const local = map[pinName] || map['5V'];
  const world = [
    BOARD_ORIGINS.esp.x + local[0],
    BOARD_ORIGINS.esp.y + local[1],
    BOARD_ORIGINS.esp.z + local[2]
  ];
  return { local, world };
}

/**
 * QF-M6001-2 5V Boost UPS + Dual 18650 Battery Holder pads & cell positions.
 */
export function getUpsPadPos(padName) {
  const map = {
    'USBC_IN': [-0.068, 0.0046, 0.0],
    '5V+':     [-0.043, 0.0022, -0.021],
    '5V-':     [-0.043, 0.0022,  0.021],
    'UPS+':    [ 0.045, 0.0022, -0.020],
    'UPS-':    [ 0.045, 0.0022,  0.020],
    'BAT1':    [ 0.0,   UPS_GEO.cellYOffset, UPS_GEO.cellZOffsets[0]],
    'BAT2':    [ 0.0,   UPS_GEO.cellYOffset, UPS_GEO.cellZOffsets[1]]
  };
  const local = map[padName] || map['UPS+'];
  return {
    local,
    world: [
      BOARD_ORIGINS.ups.x + local[0],
      BOARD_ORIGINS.ups.y + local[1],
      BOARD_ORIGINS.ups.z + local[2]
    ]
  };
}

/**
 * Breadboard Common Ground blue (−) bus rail — 4 connections:
 *  0 = XL4015 OUT− | 1 = Servo MG996R (Cokelat) | 2 = ESP32 GND | 3 = INA219 GND
 * (LDR 1, LDR 2, and Tiny RTC connect their GND straight into GOOUUU ESP32 Row G!)
 */
export function getBreadboardGndPinPos(slotIndex) {
  const xs = [-0.012, 0.012, 0.036, -0.036];
  const local = [xs[slotIndex] ?? 0, BREADBOARD_GEO.pinTopY, BREADBOARD_GEO.gndRailZ];
  const world = [
    BOARD_ORIGINS.bread.x + local[0],
    BOARD_ORIGINS.bread.y + local[1],
    BOARD_ORIGINS.bread.z + local[2]
  ];
  return { local, world };
}

/**
 * INA219 DC Current/Voltage Sensor 6-pin front (+Z) header:
 *  0=VCC, 1=GND, 2=SCL, 3=SDA, 4=VIN-, 5=VIN+
 */
export function getIna219PinPos(index) {
  const local = [(index - 2.5) * INA219_GEO.headerPitch, INA219_GEO.pinTopY, INA219_GEO.headerZ];
  const world = [
    BOARD_ORIGINS.ina219.x + local[0],
    BOARD_ORIGINS.ina219.y + local[1],
    BOARD_ORIGINS.ina219.z + local[2]
  ];
  return { local, world };
}

/**
 * INA219 2-pin blue screw terminal block on rear (-Z) edge for high-current 12V path:
 *  VIN+ (left, from SCC LOAD+) | VIN- (right, to XL4015 IN+)
 */
export function getIna219ScrewPos(pinName) {
  const map = {
    'VIN+': [-0.0068, 0.011, -0.020],
    'VIN-': [ 0.0068, 0.011, -0.020]
  };
  const local = map[pinName];
  return {
    local,
    world: [
      BOARD_ORIGINS.ina219.x + local[0],
      BOARD_ORIGINS.ina219.y + local[1],
      BOARD_ORIGINS.ina219.z + local[2]
    ]
  };
}

/**
 * Tiny RTC DS1307 + AT24C32 sits on the right side of GOOUUU ESP32, so its 7-pin header
 * sits along its LEFT (-X) edge facing the ESP32 I2C pins (short clean jumper runs!).
 */
export function getTinyRtcPinPos(index) {
  const pitch = 0.0062;
  const local = [-0.023, 0.0135, (index - 3) * pitch];
  const world = [
    BOARD_ORIGINS.rtc.x + local[0],
    BOARD_ORIGINS.rtc.y + local[1],
    BOARD_ORIGINS.rtc.z + local[2]
  ];
  return { local, world };
}

export function getLdrPinPos(sideSign, pinIndex) {
  const modCenterX = sideSign * 0.044;
  const pitch = 0.0056;
  const localInLdr = [modCenterX + (pinIndex - 1.5) * pitch, 0.0155, 0.027];
  const world = [
    BOARD_ORIGINS.ldr.x + localInLdr[0],
    BOARD_ORIGINS.ldr.y + localInLdr[1],
    BOARD_ORIGINS.ldr.z + localInLdr[2]
  ];
  return { local: localInLdr, world };
}

/**
 * Red XL4015 CC/CV 5A Buck Converter lying flat on the electronics deck (top face +Y!),
 * matching the user's uploaded photo:
 *  - Left blue 2-pin screw terminal (-X): IN+ (rear -Z), IN- (front +Z)
 *  - Right blue 2-pin screw terminal (+X): OUT+ (rear -Z), OUT- (front +Z)
 */
export function getXl4015PinPos(pinName) {
  const map = {
    'IN+':  [-0.049, 0.011, -0.010],
    'IN-':  [-0.049, 0.011,  0.004],
    'OUT+': [ 0.049, 0.011, -0.004],
    'OUT-': [ 0.049, 0.011,  0.010]
  };
  const local = map[pinName];
  return {
    local,
    world: [
      BOARD_ORIGINS.xl.x + local[0],
      BOARD_ORIGINS.xl.y + local[1],
      BOARD_ORIGINS.xl.z + local[2]
    ]
  };
}

export function getSccTerminalPos(index) {
  const local = [-0.055 + index * 0.022, -0.056, 0.015];
  const world = [
    BOARD_ORIGINS.scc.x + local[0],
    BOARD_ORIGINS.scc.y + local[1],
    BOARD_ORIGINS.scc.z + local[2]
  ];
  return { local, world };
}

/**
 * Watt Meter now faces FRONT (+Z, rotY = 0), mounted above Charge Controller!
 * SOURCE leads enter on LEFT (-X), LOAD leads exit on RIGHT (+X).
 */
export function getWattMeterPinPos(pinName) {
  const map = {
    'SRC+':  [-0.074,  0.012, 0.0],
    'SRC-':  [-0.074, -0.012, 0.0],
    'LOAD+': [ 0.074,  0.012, 0.0],
    'LOAD-': [ 0.074, -0.012, 0.0]
  };
  const local = map[pinName];
  return { local, world: rotateYPoint(local[0], local[1], local[2], BOARD_ORIGINS.watt) };
}

export function getBatteryClipPos(polarity) {
  const local = polarity === '+' ? [0.080, 0.258, 0.0] : [-0.080, 0.258, 0.0];
  return { local, world: rotateYPoint(local[0], local[1], local[2], BOARD_ORIGINS.bat) };
}

export const SERVO_PLUG_PINS = {
  PWM: [RIG_DIMS.servoBodyPos.x + 0.006, RIG_DIMS.servoBodyPos.y - 0.056, RIG_DIMS.servoBodyPos.z - 0.004],
  VCC: [RIG_DIMS.servoBodyPos.x,         RIG_DIMS.servoBodyPos.y - 0.056, RIG_DIMS.servoBodyPos.z - 0.004],
  GND: [RIG_DIMS.servoBodyPos.x - 0.006, RIG_DIMS.servoBodyPos.y - 0.056, RIG_DIMS.servoBodyPos.z - 0.004]
};

export const ACTIVE_DUPONT_PLUGS = {
  goouuu: [
    // Front (+Z): LDR1 (P34 S/V/G), LDR2 (P35 S/V/G), dan Common GND -> Breadboard!
    { side: 'front', index: 4, row: 'S', label: 'GPIO34 (LDR1 AO)', wireColor: 0xfacc15 },
    { side: 'front', index: 4, row: 'V', label: '3.3V (LDR1 VCC)',  wireColor: 0xef4444 },
    { side: 'front', index: 4, row: 'G', label: 'GND (LDR1 GND)',   wireColor: 0x1e2229 },
    { side: 'front', index: 5, row: 'S', label: 'GPIO35 (LDR2 AO)', wireColor: 0xa855f7 },
    { side: 'front', index: 5, row: 'V', label: '3.3V (LDR2 VCC)',  wireColor: 0xef4444 },
    { side: 'front', index: 5, row: 'G', label: 'GND (LDR2 GND)',   wireColor: 0x1e2229 },
    { side: 'front', index: 0, row: 'G', label: 'ESP32 GND → Common GND', wireColor: 0x1e2229 },
    // Rear (-Z): Tiny RTC I2C (SCL 22, SDA 21, 3.3V, GND) & Servo PWM (GPIO18)
    { side: 'rear',  index: 2, row: 'S', label: 'GPIO22 (RTC SCL)', wireColor: 0x0ea5e9 },
    { side: 'rear',  index: 5, row: 'S', label: 'GPIO21 (RTC SDA)', wireColor: 0x10b981 },
    { side: 'rear',  index: 5, row: 'V', label: '3.3V (RTC VCC)',   wireColor: 0xef4444 },
    { side: 'rear',  index: 5, row: 'G', label: 'GND (RTC GND)',    wireColor: 0x1e2229 },
    { side: 'rear',  index: 8, row: 'S', label: 'GPIO18 (Servo PWM)', wireColor: 0xf97316 }
  ],
  goouuuAux: [
    { pinName: 'D22', label: 'D22 (INA219 SCL)' },
    { pinName: 'D21', label: 'D21 (INA219 SDA)' },
    { pinName: 'VCC', label: 'VCC 3.3V (INA219 VCC)' }
  ],
  goouuuPwr: [
    { pinName: '5V',  label: '5V ← UPS+ (QF-M6001-2 5V)' },
    { pinName: 'GND', label: 'GND ← UPS− (QF-M6001-2)' }
  ],
  breadboard: [
    { slot: 0, label: 'Common GND ← XL4015 OUT−' },
    { slot: 1, label: 'Common GND ← Servo MG996R (Cokelat)' },
    { slot: 2, label: 'Common GND ← ESP32 GND' },
    { slot: 3, label: 'Common GND ← INA219 GND' }
  ],
  ina219: [
    { index: 0, label: 'VCC → ESP32 3.3V (Aux)' },
    { index: 1, label: 'GND → Breadboard Common GND' },
    { index: 2, label: 'SCL → ESP32 GPIO22 (D22)' },
    { index: 3, label: 'SDA → ESP32 GPIO21 (D21)' }
  ],
  rtc: [
    { index: 2, label: 'SCL → ESP32 GPIO22' },
    { index: 3, label: 'SDA → ESP32 GPIO21' },
    { index: 4, label: 'VCC → ESP32 3.3V' },
    { index: 5, label: 'GND → ESP32 GND' }
  ],
  ldr1: [
    { index: 0, label: 'VCC → ESP32 3.3V' },
    { index: 1, label: 'GND → ESP32 GND' },
    { index: 3, label: 'AO → ESP32 GPIO34' }
  ],
  ldr2: [
    { index: 0, label: 'VCC → ESP32 3.3V' },
    { index: 1, label: 'GND → ESP32 GND' },
    { index: 3, label: 'AO → ESP32 GPIO35' }
  ]
};

export const WIRE_NET_META = {
  pv: {
    label: 'Panel Surya → Watt Meter → SCC',
    colorHex: '#ff3b30',
    preset: 'watt_scc',
    summary: 'Listrik dari Panel Surya masuk ke Watt Meter (ukur daya), lalu lanjut ke terminal +PV− Charge Controller.',
    pins: 'Panel (+) (−) → Watt Meter → SCC +PV−'
  },
  bat: {
    label: 'Aki INCOE 12V ↔ SCC',
    colorHex: '#ef4444',
    preset: 'power',
    summary: 'Aki 12V INCOE nyambung langsung ke terminal +BAT− Charge Controller untuk simpan daya.',
    pins: 'Aki Merah (+) → SCC BAT+  |  Aki Hitam (−) → SCC BAT−'
  },
  buck12v: {
    label: 'SCC LOAD 12V → INA219 → XL4015',
    colorHex: '#ff5722',
    preset: 'xl4015',
    summary: 'Jalur 12V positif LOAD+ SCC melewati resistor shunt R100 INA219 (VIN+ → VIN−) sebelum masuk ke XL4015 IN+, sedangkan LOAD− langsung ke IN−.',
    pins: 'SCC LOAD+ → INA219 VIN+  |  INA219 VIN− → XL4015 IN+  |  SCC LOAD− → XL4015 IN−'
  },
  ina219: {
    label: 'INA219 (I2C & Shunt 12V)',
    colorHex: '#06b6d4',
    preset: 'ina219',
    summary: 'INA219 mengukur arus & tegangan jalur 12V (VIN+/VIN−) di sisi input XL4015, disuplai 3.3V, dan mengirim data via I2C (SDA 21, SCL 22).',
    pins: 'VIN+ ← SCC LOAD+ · VIN− → XL4015 IN+ · VCC→3.3V · GND→Common GND · SDA→21 · SCL→22'
  },
  servo6v: {
    label: 'XL4015 OUT+ (6V) → Servo Merah',
    colorHex: '#ff69b4',
    preset: 'xl4015',
    summary: 'Daya 6V dari XL4015 OUT+ khusus ke kabel merah Servo MG996R. Jangan sambung ke 3V3 atau 5V ESP32!',
    pins: 'XL4015 OUT+ (6V) → Servo MG996R Merah'
  },
  gnd: {
    label: 'Common GND (4 Kabel)',
    colorHex: '#00d4ff',
    preset: 'breadboard',
    summary: 'Menyatukan 4 jalur Common GND di Breadboard: INA219 GND, XL4015 OUT−, kabel cokelat Servo MG996R, dan GND ESP32 (terhubung juga dengan SCC LOAD−/IN−).',
    pins: 'INA219 GND + XL4015 OUT− + Servo Cokelat + ESP32 GND → Breadboard Common GND'
  },
  pwm: {
    label: 'ESP32 GPIO18 → Servo Oranye',
    colorHex: '#ff9f0a',
    preset: 'esp_pins',
    summary: 'Sinyal kendali gerak dari pin GPIO18 ESP32 ke kabel oranye Servo MG996R.',
    pins: 'ESP32 GPIO18 → Servo MG996R Oranye (PWM)'
  },
  i2c: {
    label: 'Bus I2C (Tiny RTC & INA219 ↔ ESP32)',
    colorHex: '#2ecc71',
    preset: 'esp_pins',
    summary: 'Tiny RTC (0x68/0x50) dan INA219 (0x40) berbagi bus I2C ESP32 pada GPIO21 (SDA), GPIO22 (SCL), dan suplai 3.3V.',
    pins: 'Tiny RTC & INA219 SDA/SCL/VCC → ESP32 GPIO21 / GPIO22 / 3.3V'
  },
  ldr: {
    label: 'LDR 1 & 2 ↔ ESP32',
    colorHex: '#a855f7',
    preset: 'ldr',
    summary: 'Semua kabel LDR 1 & LDR 2 (AO, VCC 3.3V, dan GND) nyambung langsung ke ESP32. Pin DO kosong.',
    pins: 'LDR1 → ESP32 GPIO34 / 3.3V / GND  |  LDR2 → ESP32 GPIO35 / 3.3V / GND'
  },
  usb: {
    label: 'UPS 5V (QF-M6001-2 · 2×18650) → ESP32',
    colorHex: '#22c55e',
    preset: 'ups',
    summary: 'Adaptor USB-C 5V masuk ke modul UPS QF-M6001-2 (isi 2× baterai 18650 paralel 4.2V), lalu output UPS+ (5V) & UPS− (GND) menyuplai ESP32 tanpa putus.',
    pins: 'USB-C 5V IN → QF-M6001-2 (2×18650) → UPS+ (5V) / UPS− (GND) → GOOUUU V4 5V / GND'
  }
};

/**
 * Generates all 25 exact pin-to-pin 3D cable splines with full from/to metadata
 * so every single wire is clickable and self-documenting!
 */
export function buildPinAccurateWireSpecs() {
  const esp34S = getGoouuuPinPos('front', 4, 'S').world;
  const esp34V = getGoouuuPinPos('front', 4, 'V').world;
  const esp34G = getGoouuuPinPos('front', 4, 'G').world;
  const esp35S = getGoouuuPinPos('front', 5, 'S').world;
  const esp35V = getGoouuuPinPos('front', 5, 'V').world;
  const esp35G = getGoouuuPinPos('front', 5, 'G').world;
  const espGndBb = getGoouuuPinPos('front', 0, 'G').world;

  const esp22S = getGoouuuPinPos('rear', 2, 'S').world;
  const esp21S = getGoouuuPinPos('rear', 5, 'S').world;
  const esp21V = getGoouuuPinPos('rear', 5, 'V').world;
  const esp21G = getGoouuuPinPos('rear', 5, 'G').world;
  const esp18S = getGoouuuPinPos('rear', 8, 'S').world;

  const espAux22  = getGoouuuAuxPinPos('D22').world;
  const espAux21  = getGoouuuAuxPinPos('D21').world;
  const espAuxVcc = getGoouuuAuxPinPos('VCC').world;
  const espPwr5v  = getGoouuuPwrPinPos('5V').world;
  const espPwrGnd = getGoouuuPwrPinPos('GND').world;

  const upsUsbIn = getUpsPadPos('USBC_IN').world;
  const upsOutP  = getUpsPadPos('UPS+').world;
  const upsOutN  = getUpsPadPos('UPS-').world;

  // Breadboard Common GND: 4 slots (XL4015 OUT−, Servo, ESP32, INA219 GND)
  const bbXl  = getBreadboardGndPinPos(0).world;
  const bbSrv = getBreadboardGndPinPos(1).world;
  const bbEsp = getBreadboardGndPinPos(2).world;
  const bbIna = getBreadboardGndPinPos(3).world;

  const inaVcc   = getIna219PinPos(0).world;
  const inaGnd   = getIna219PinPos(1).world;
  const inaScl   = getIna219PinPos(2).world;
  const inaSda   = getIna219PinPos(3).world;
  const inaVinP  = getIna219ScrewPos('VIN+').world;
  const inaVinN  = getIna219ScrewPos('VIN-').world;

  const rtcScl = getTinyRtcPinPos(2).world;
  const rtcSda = getTinyRtcPinPos(3).world;
  const rtcVcc = getTinyRtcPinPos(4).world;
  const rtcGnd = getTinyRtcPinPos(5).world;

  const ldr1Vcc = getLdrPinPos(-1, 0).world;
  const ldr1Gnd = getLdrPinPos(-1, 1).world;
  const ldr1Ao  = getLdrPinPos(-1, 3).world;

  const ldr2Vcc = getLdrPinPos(1, 0).world;
  const ldr2Gnd = getLdrPinPos(1, 1).world;
  const ldr2Ao  = getLdrPinPos(1, 3).world;

  const xlInP  = getXl4015PinPos('IN+').world;
  const xlInN  = getXl4015PinPos('IN-').world;
  const xlOutP = getXl4015PinPos('OUT+').world;
  const xlOutN = getXl4015PinPos('OUT-').world;

  const sccPvP   = getSccTerminalPos(0).world;
  const sccPvN   = getSccTerminalPos(1).world;
  const sccBatP  = getSccTerminalPos(2).world;
  const sccBatN  = getSccTerminalPos(3).world;
  const sccLoadP = getSccTerminalPos(4).world;
  const sccLoadN = getSccTerminalPos(5).world;

  const wattSrcP  = getWattMeterPinPos('SRC+').world;
  const wattSrcN  = getWattMeterPinPos('SRC-').world;
  const wattLoadP = getWattMeterPinPos('LOAD+').world;
  const wattLoadN = getWattMeterPinPos('LOAD-').world;

  const batPos = getBatteryClipPos('+').world;
  const batNeg = getBatteryClipPos('-').world;

  const lift = (p, dy = 0.012, dz = 0) => [p[0], p[1] + dy, p[2] + dz];
  const drop = (p, dy = -0.018, dz = 0) => [p[0], p[1] + dy, p[2] + dz];

  return [
    // --- A. PV POWER: Panel -> Watt Meter -> SCC +PV- ---
    {
      id: 'pv-panel-watt-pos',
      fromPin: 'Panel Surya (+)',
      toPin: 'Watt Meter SOURCE+',
      fromPinId: 'panel-pos',
      toPinId: 'watt-src-p',
      voltage: '12–18V DC',
      description: 'Nyambung dari kabel merah Panel Surya ke input SOURCE+ Watt Meter.',
      category: 'pv',
      radius: 0.0040,
      baseColor: 0xcf2626,
      highlightHex: 0xff3b30,
      points: [
        [-0.016, 1.615, -0.135],
        [-0.068, 1.410, -0.028],
        [-0.105, 1.215,  0.036],
        [wattSrcP[0] - 0.018, wattSrcP[1], wattSrcP[2]],
        wattSrcP
      ]
    },
    {
      id: 'pv-panel-watt-neg',
      fromPin: 'Panel Surya (−)',
      toPin: 'Watt Meter SOURCE−',
      fromPinId: 'panel-neg',
      toPinId: 'watt-src-n',
      voltage: '0V PV',
      description: 'Nyambung dari kabel hitam Panel Surya ke input SOURCE− Watt Meter.',
      category: 'pv',
      radius: 0.0040,
      baseColor: 0x1a1d22,
      highlightHex: 0xf97316,
      points: [
        [-0.032, 1.615, -0.135],
        [-0.082, 1.400, -0.022],
        [-0.114, 1.185,  0.038],
        [wattSrcN[0] - 0.018, wattSrcN[1], wattSrcN[2]],
        wattSrcN
      ]
    },
    {
      id: 'pv-watt-scc-pos',
      fromPin: 'Watt Meter LOAD+',
      toPin: 'SCC PV+',
      fromPinId: 'watt-load-p',
      toPinId: 'scc-pv-p',
      voltage: '12–18V DC',
      description: 'Nyambung dari output LOAD+ Watt Meter ke terminal PV+ Charge Controller.',
      category: 'pv',
      radius: 0.0040,
      baseColor: 0xcf2626,
      highlightHex: 0xff3b30,
      points: [
        wattLoadP,
        [wattLoadP[0] + 0.025, wattLoadP[1] - 0.015, 0.052],
        [0.112, 0.99, 0.044],
        [0.095, 0.815, 0.068],
        [-0.055, 0.808, 0.072],
        drop(sccPvP, -0.016, 0.002),
        sccPvP
      ]
    },
    {
      id: 'pv-watt-scc-neg',
      fromPin: 'Watt Meter LOAD−',
      toPin: 'SCC PV−',
      fromPinId: 'watt-load-n',
      toPinId: 'scc-pv-n',
      voltage: '0V PV',
      description: 'Nyambung dari output LOAD− Watt Meter ke terminal PV− Charge Controller.',
      category: 'pv',
      radius: 0.0040,
      baseColor: 0x1a1d22,
      highlightHex: 0xf97316,
      points: [
        wattLoadN,
        [wattLoadN[0] + 0.032, wattLoadN[1] - 0.022, 0.048],
        [0.122, 0.96, 0.040],
        [0.102, 0.798, 0.064],
        [-0.033, 0.796, 0.068],
        drop(sccPvN, -0.016, 0.002),
        sccPvN
      ]
    },

    // --- B. BATTERY POWER: INCOE SA-20 12V <-> SCC +BAT- ---
    {
      id: 'bat-scc-pos',
      fromPin: 'Aki INCOE (+)',
      toPin: 'SCC BAT+',
      fromPinId: 'bat-pos',
      toPinId: 'scc-bat-p',
      voltage: '12V DC',
      description: 'Nyambung dari klip merah (+) Aki INCOE ke terminal BAT+ Charge Controller.',
      category: 'bat',
      radius: 0.0046,
      baseColor: 0xd62424,
      highlightHex: 0xff453a,
      points: [
        batPos,
        [batPos[0] + 0.025, 0.42, -0.05],
        [-0.055, 0.65, 0.015],
        [-0.018, 0.785, 0.060],
        drop(sccBatP, -0.016, 0.002),
        sccBatP
      ]
    },
    {
      id: 'bat-scc-neg',
      fromPin: 'Aki INCOE (−)',
      toPin: 'SCC BAT−',
      fromPinId: 'bat-neg',
      toPinId: 'scc-bat-n',
      voltage: '0V Aki',
      description: 'Nyambung dari klip hitam (−) Aki INCOE ke terminal BAT− Charge Controller.',
      category: 'bat',
      radius: 0.0046,
      baseColor: 0x191b20,
      highlightHex: 0x94a3b8,
      points: [
        batNeg,
        [batNeg[0] + 0.025, 0.42, -0.06],
        [-0.040, 0.64, 0.008],
        [0.008, 0.778, 0.056],
        drop(sccBatN, -0.016, 0.002),
        sccBatN
      ]
    },

    // --- C. 12V BUCK INPUT VIA INA219 SHUNT: SCC LOAD+ -> INA219 VIN+ -> INA219 VIN- -> XL4015 IN+ ---
    {
      id: 'scc-ina-load-pos',
      fromPin: 'SCC LOAD+ (12V)',
      toPin: 'INA219 VIN+',
      fromPinId: 'scc-load-p',
      toPinId: 'ina-vin-p-term',
      voltage: '12V DC',
      description: 'Nyambung dari terminal LOAD+ SCC (12V) masuk ke terminal sekrup VIN+ INA219 agar seluruh arus ke XL4015 melewati resistor shunt R100.',
      category: 'buck12v',
      nets: ['buck12v', 'ina219'],
      radius: 0.0034,
      baseColor: 0xd9381e,
      highlightHex: 0xff5722,
      points: [
        sccLoadP,
        drop(sccLoadP, -0.022, 0.004),
        [-0.045, 0.755, 0.072],
        [-0.295, 0.700, 0.082],
        [inaVinP[0], inaVinP[1] + 0.012, inaVinP[2] - 0.014],
        inaVinP
      ]
    },
    {
      id: 'ina-xl-in-pos',
      fromPin: 'INA219 VIN−',
      toPin: 'XL4015 IN+',
      fromPinId: 'ina-vin-n-term',
      toPinId: 'xl-in-p',
      voltage: '12V DC (Shunt Out)',
      description: 'Nyambung dari terminal sekrup VIN− INA219 (keluaran shunt R100) langsung ke input IN+ XL4015 merah.',
      category: 'buck12v',
      nets: ['buck12v', 'ina219'],
      radius: 0.0034,
      baseColor: 0xea580c,
      highlightHex: 0xfb923c,
      points: [
        inaVinN,
        [inaVinN[0], inaVinN[1] + 0.004, inaVinN[2] - 0.010],
        [-0.283, 0.642, 0.090],
        [xlInP[0] - 0.012, xlInP[1] + 0.007, xlInP[2] - 0.005],
        xlInP
      ]
    },
    {
      id: 'scc-xl-load-neg',
      fromPin: 'SCC LOAD−',
      toPin: 'XL4015 IN−',
      fromPinId: 'scc-load-n',
      toPinId: 'xl-in-n',
      voltage: '0V Input (Common GND)',
      description: 'Nyambung dari terminal LOAD− SCC ke input IN− XL4015 merah (terhubung ke Common GND).',
      category: 'buck12v',
      nets: ['buck12v'],
      radius: 0.0034,
      baseColor: 0x1d2026,
      highlightHex: 0xfb923c,
      points: [
        sccLoadN,
        drop(sccLoadN, -0.026, 0.002),
        [-0.035, 0.740, 0.068],
        [-0.268, 0.695, 0.114],
        [xlInN[0] - 0.016, xlInN[1] + 0.010, xlInN[2]],
        xlInN
      ]
    },

    // --- C2. INA219 SUPPLY & I2C BUS (VCC->3.3V, SCL->GPIO22, SDA->GPIO21) ---
    {
      id: 'ina-vcc-3v3',
      fromPin: 'ESP32 3.3V (Aux)',
      toPin: 'INA219 VCC',
      fromPinId: 'esp-aux-vcc',
      toPinId: 'ina-vcc',
      voltage: '3.3V DC',
      description: 'Nyambung dari pin VCC 3.3V papan ekspansi GOOUUU V4 ke pin VCC INA219 (suplai chip 3–5.5V, terpisah dari 12V VIN+/VIN−).',
      category: 'ina219',
      nets: ['ina219', 'i2c'],
      radius: 0.0018,
      baseColor: 0xdc2626,
      highlightHex: 0xf87171,
      points: [
        espAuxVcc,
        lift(espAuxVcc, 0.013, -0.014),
        [0.184, 0.646, 0.062],
        [0.046, 0.646, 0.064],
        [0.038, 0.646, 0.155],
        [-0.220, 0.644, 0.158],
        [-0.324, 0.644, 0.152],
        lift(inaVcc, 0.012, 0.006),
        inaVcc
      ]
    },
    {
      id: 'ina-scl-22',
      fromPin: 'ESP32 GPIO22 (D22)',
      toPin: 'INA219 SCL',
      fromPinId: 'esp-aux-d22',
      toPinId: 'ina-scl',
      voltage: '3.3V I2C',
      description: 'Nyambung dari GPIO22 (D22) GOOUUU V4 ke pin SCL INA219 (berbagi bus I2C dengan Tiny RTC).',
      category: 'ina219',
      nets: ['ina219', 'i2c'],
      radius: 0.0018,
      baseColor: 0x06b6d4,
      highlightHex: 0x22d3ee,
      points: [
        espAux22,
        lift(espAux22, 0.016, -0.014),
        [0.172, 0.650, 0.056],
        [0.042, 0.650, 0.058],
        [0.034, 0.649, 0.151],
        [-0.220, 0.647, 0.153],
        [-0.310, 0.646, 0.149],
        lift(inaScl, 0.013, 0.005),
        inaScl
      ]
    },
    {
      id: 'ina-sda-21',
      fromPin: 'ESP32 GPIO21 (D21)',
      toPin: 'INA219 SDA',
      fromPinId: 'esp-aux-d21',
      toPinId: 'ina-sda',
      voltage: '3.3V I2C',
      description: 'Nyambung dari GPIO21 (D21) GOOUUU V4 ke pin SDA INA219 (alamat default I2C 0x40).',
      category: 'ina219',
      nets: ['ina219', 'i2c'],
      radius: 0.0018,
      baseColor: 0x10b981,
      highlightHex: 0x34d399,
      points: [
        espAux21,
        lift(espAux21, 0.014, -0.014),
        [0.178, 0.648, 0.059],
        [0.044, 0.648, 0.061],
        [0.036, 0.647, 0.153],
        [-0.220, 0.645, 0.155],
        [-0.302, 0.645, 0.148],
        lift(inaSda, 0.012, 0.005),
        inaSda
      ]
    },

    // --- D. 6.0V SERVO POWER: XL4015 OUT+ -> Servo MG996R Red VCC ---
    {
      id: 'xl-servo-6v',
      fromPin: 'XL4015 OUT+ (6V)',
      toPin: 'Servo Merah (VCC)',
      fromPinId: 'xl-out-p',
      toPinId: 'servo-vcc',
      voltage: '6.0V DC',
      description: 'Nyambung dari XL4015 OUT+ (set 6V) ke kabel merah Servo MG996R. Jangan sambung ke 3V3/5V ESP32!',
      category: 'servo6v',
      radius: 0.0030,
      baseColor: 0xe11d48,
      highlightHex: 0xff69b4,
      points: [
        xlOutP,
        [xlOutP[0] + 0.016, xlOutP[1] + 0.014, xlOutP[2] - 0.015],
        [-0.085, 0.67, 0.018],
        [0.048, 0.85, -0.034],
        [0.056, 1.08, -0.036],
        [SERVO_PLUG_PINS.VCC[0], SERVO_PLUG_PINS.VCC[1] - 0.024, SERVO_PLUG_PINS.VCC[2] - 0.004],
        SERVO_PLUG_PINS.VCC
      ]
    },

    // --- E. COMMON GROUND ON BREADBOARD (4 WIRES: XL4015 OUT−, Servo Cokelat, ESP32 GND, INA219 GND)! ---
    {
      id: 'gnd-xl-bb',
      fromPin: 'XL4015 OUT−',
      toPin: 'Breadboard Common GND',
      fromPinId: 'xl-out-n',
      toPinId: 'bb-gnd-xl',
      voltage: '0V Common GND',
      description: 'Nyambung dari XL4015 OUT− ke Common GND Breadboard (disatukan dengan Servo, ESP32, & INA219).',
      category: 'gnd',
      radius: 0.0026,
      baseColor: 0x1e2229,
      highlightHex: 0x00d4ff,
      points: [
        xlOutN,
        [xlOutN[0] + 0.016, xlOutN[1] + 0.012, xlOutN[2] + 0.008],
        [-0.112, 0.648, 0.142],
        lift(bbXl, 0.013, 0),
        bbXl
      ]
    },
    {
      id: 'gnd-servo-bb',
      fromPin: 'Servo Cokelat (GND)',
      toPin: 'Breadboard Common GND',
      fromPinId: 'servo-gnd',
      toPinId: 'bb-gnd-srv',
      voltage: '0V Common GND',
      description: 'Nyambung dari kabel cokelat Servo MG996R ke Common GND Breadboard (disatukan dengan XL4015 OUT−, ESP32, & INA219).',
      category: 'gnd',
      radius: 0.0026,
      baseColor: 0x6b3e1b,
      highlightHex: 0x00d4ff,
      points: [
        SERVO_PLUG_PINS.GND,
        [SERVO_PLUG_PINS.GND[0], SERVO_PLUG_PINS.GND[1] - 0.022, SERVO_PLUG_PINS.GND[2]],
        [0.044, 1.05, -0.030],
        [0.032, 0.74, 0.015],
        [-0.034, 0.665, 0.115],
        lift(bbSrv, 0.016, -0.002),
        bbSrv
      ]
    },
    {
      id: 'gnd-esp-bb',
      fromPin: 'ESP32 GND',
      toPin: 'Breadboard Common GND',
      fromPinId: 'esp-gnd-bb',
      toPinId: 'bb-gnd-esp',
      voltage: '0V Common GND',
      description: 'Nyambung dari pin GND ESP32 ke Common GND Breadboard supaya sinyal PWM & referensi tegangan terbaca benar.',
      category: 'gnd',
      radius: 0.0025,
      baseColor: 0x1e2229,
      highlightHex: 0x00d4ff,
      points: [
        espGndBb,
        lift(espGndBb, 0.014, 0.002),
        [0.036, 0.652, 0.155],
        lift(bbEsp, 0.013, 0),
        bbEsp
      ]
    },
    {
      id: 'ina-gnd-bb',
      fromPin: 'INA219 GND',
      toPin: 'Breadboard Common GND',
      fromPinId: 'ina-gnd',
      toPinId: 'bb-gnd-ina',
      voltage: '0V Common GND',
      description: 'Nyambung dari pin GND INA219 ke Common GND Breadboard (satu ground dengan Controller LOAD−, XL4015 IN−/OUT−, & ESP32) sebagai referensi ukur tegangan bus 12V.',
      category: 'gnd',
      nets: ['gnd', 'ina219'],
      radius: 0.0022,
      baseColor: 0x1e2229,
      highlightHex: 0x00d4ff,
      points: [
        inaGnd,
        lift(inaGnd, 0.011, 0.007),
        [-0.220, 0.640, 0.150],
        [-0.122, 0.641, 0.150],
        lift(bbIna, 0.013, 0),
        bbIna
      ]
    },

    // --- F. SERVO PWM SIGNAL: ESP32 GPIO18 -> Servo Orange PWM ---
    {
      id: 'pwm-esp18-servo',
      fromPin: 'ESP32 GPIO18',
      toPin: 'Servo Oranye (PWM)',
      fromPinId: 'esp-18',
      toPinId: 'servo-pwm',
      voltage: '3.3V PWM',
      description: 'Nyambung dari pin GPIO18 ESP32 ke kabel oranye Servo MG996R untuk menggerakkan sudut panel.',
      category: 'pwm',
      radius: 0.0024,
      baseColor: 0xf97316,
      highlightHex: 0xffb300,
      points: [
        esp18S,
        lift(esp18S, 0.016, -0.006),
        [0.132, 0.74, 0.035],
        [0.072, 1.05, -0.022],
        [SERVO_PLUG_PINS.PWM[0], SERVO_PLUG_PINS.PWM[1] - 0.022, SERVO_PLUG_PINS.PWM[2]],
        SERVO_PLUG_PINS.PWM
      ]
    },

    // --- G. TINY RTC DIRECT TO ESP32 (SDA 21, SCL 22, 3.3V, GND) ---
    // Routed neatly behind the rear (-Z) edge of GOOUUU V4 so the DC6.5-16V barrel jack & silkscreen stay 100% clear!
    {
      id: 'i2c-sda-21',
      fromPin: 'ESP32 GPIO21 (SDA)',
      toPin: 'Tiny RTC SDA',
      fromPinId: 'esp-21',
      toPinId: 'rtc-sda',
      voltage: '3.3V I2C',
      description: 'Nyambung dari GPIO21 ESP32 langsung ke pin SDA Tiny RTC untuk baca data jam.',
      category: 'i2c',
      radius: 0.0019,
      baseColor: 0x10b981,
      highlightHex: 0x2ecc71,
      points: [
        esp21S,
        lift(esp21S, 0.015, -0.012),
        [0.145, 0.646, 0.056],
        [0.244, 0.646, 0.058],
        [0.258, 0.644, 0.104],
        lift(rtcSda, 0.013, 0),
        rtcSda
      ]
    },
    {
      id: 'i2c-scl-22',
      fromPin: 'ESP32 GPIO22 (SCL)',
      toPin: 'Tiny RTC SCL',
      fromPinId: 'esp-22',
      toPinId: 'rtc-scl',
      voltage: '3.3V I2C',
      description: 'Nyambung dari GPIO22 ESP32 langsung ke pin SCL Tiny RTC untuk jalur clock jam.',
      category: 'i2c',
      radius: 0.0019,
      baseColor: 0x0ea5e9,
      highlightHex: 0x38bdf8,
      points: [
        esp22S,
        lift(esp22S, 0.016, -0.012),
        [0.130, 0.650, 0.051],
        [0.246, 0.650, 0.053],
        [0.260, 0.646, 0.098],
        lift(rtcScl, 0.013, 0),
        rtcScl
      ]
    },
    {
      id: 'i2c-rtc-vcc',
      fromPin: 'ESP32 3.3V (P21)',
      toPin: 'Tiny RTC VCC',
      fromPinId: 'esp-v33-rtc',
      toPinId: 'rtc-vcc',
      voltage: '3.3V DC',
      description: 'Nyambung dari pin 3.3V ESP32 langsung ke pin VCC Tiny RTC sebagai daya modul jam.',
      category: 'i2c',
      radius: 0.0018,
      baseColor: 0xdc2626,
      highlightHex: 0xf87171,
      points: [
        esp21V,
        lift(esp21V, 0.013, -0.014),
        [0.150, 0.642, 0.061],
        [0.242, 0.642, 0.063],
        [0.256, 0.642, 0.112],
        lift(rtcVcc, 0.012, 0),
        rtcVcc
      ]
    },
    {
      id: 'i2c-rtc-gnd',
      fromPin: 'ESP32 GND (P21)',
      toPin: 'Tiny RTC GND',
      fromPinId: 'esp-gnd-rtc',
      toPinId: 'rtc-gnd',
      voltage: '0V GND',
      description: 'Nyambung dari pin GND ESP32 langsung ke pin GND Tiny RTC.',
      category: 'i2c',
      radius: 0.0018,
      baseColor: 0x1e2229,
      highlightHex: 0x64748b,
      points: [
        esp21G,
        lift(esp21G, 0.012, -0.016),
        [0.154, 0.638, 0.065],
        [0.240, 0.638, 0.067],
        [0.254, 0.640, 0.120],
        lift(rtcGnd, 0.012, 0),
        rtcGnd
      ]
    },

    // --- H. LDR 1 & LDR 2 DIRECT TO ESP32 (AO, 3.3V, AND GND STRAIGHT TO ESP32!) ---
    {
      id: 'ldr1-ao-34',
      fromPin: 'ESP32 GPIO34',
      toPin: 'LDR 1 (Kiri) AO',
      fromPinId: 'esp-34',
      toPinId: 'ldr1-ao',
      voltage: '0–3.3V Analog',
      description: 'Nyambung dari pin AO LDR 1 (kiri) langsung ke GPIO34 ESP32 untuk baca cahaya kiri.',
      category: 'ldr',
      radius: 0.0018,
      baseColor: 0xfacc15,
      highlightHex: 0xfef08a,
      points: [
        esp34S,
        lift(esp34S, 0.014, 0.006),
        [0.02, 0.640, 0.168],
        [-0.38, 0.637, 0.172],
        [-0.458, 0.635, 0.158],
        lift(ldr1Ao, 0.011, 0.005),
        ldr1Ao
      ]
    },
    {
      id: 'ldr1-vcc-3v3',
      fromPin: 'ESP32 3.3V (P34)',
      toPin: 'LDR 1 (Kiri) VCC',
      fromPinId: 'esp-v33-ldr1',
      toPinId: 'ldr1-vcc',
      voltage: '3.3V DC',
      description: 'Nyambung dari pin 3.3V ESP32 langsung ke pin VCC LDR 1.',
      category: 'ldr',
      radius: 0.0017,
      baseColor: 0xe11d48,
      highlightHex: 0xfb7185,
      points: [
        esp34V,
        lift(esp34V, 0.012, 0.006),
        [0.02, 0.636, 0.174],
        [-0.39, 0.634, 0.178],
        [-0.480, 0.634, 0.162],
        lift(ldr1Vcc, 0.011, 0.006),
        ldr1Vcc
      ]
    },
    {
      id: 'ldr1-gnd-esp',
      fromPin: 'ESP32 GND (P34)',
      toPin: 'LDR 1 (Kiri) GND',
      fromPinId: 'esp-gnd-ldr1',
      toPinId: 'ldr1-gnd',
      voltage: '0V GND',
      description: 'Nyambung dari pin GND ESP32 langsung ke pin GND LDR 1 (bukan lewat breadboard).',
      category: 'ldr',
      radius: 0.0017,
      baseColor: 0x1e2229,
      highlightHex: 0x94a3b8,
      points: [
        esp34G,
        lift(esp34G, 0.011, 0.007),
        [0.02, 0.632, 0.182],
        [-0.40, 0.630, 0.184],
        [-0.474, 0.631, 0.168],
        lift(ldr1Gnd, 0.011, 0.006),
        ldr1Gnd
      ]
    },
    {
      id: 'ldr2-ao-35',
      fromPin: 'ESP32 GPIO35',
      toPin: 'LDR 2 (Kanan) AO',
      fromPinId: 'esp-35',
      toPinId: 'ldr2-ao',
      voltage: '0–3.3V Analog',
      description: 'Nyambung dari pin AO LDR 2 (kanan) langsung ke GPIO35 ESP32 untuk baca cahaya kanan.',
      category: 'ldr',
      radius: 0.0018,
      baseColor: 0x9333ea,
      highlightHex: 0xc084fc,
      points: [
        esp35S,
        lift(esp35S, 0.015, 0.005),
        [0.02, 0.643, 0.162],
        [-0.33, 0.640, 0.164],
        lift(ldr2Ao, 0.011, 0.005),
        ldr2Ao
      ]
    },
    {
      id: 'ldr2-vcc-3v3',
      fromPin: 'ESP32 3.3V (P35)',
      toPin: 'LDR 2 (Kanan) VCC',
      fromPinId: 'esp-v33-ldr2',
      toPinId: 'ldr2-vcc',
      voltage: '3.3V DC',
      description: 'Nyambung dari pin 3.3V ESP32 langsung ke pin VCC LDR 2.',
      category: 'ldr',
      radius: 0.0017,
      baseColor: 0xdc2626,
      highlightHex: 0xf87171,
      points: [
        esp35V,
        lift(esp35V, 0.012, 0.005),
        [0.02, 0.638, 0.166],
        [-0.34, 0.636, 0.168],
        lift(ldr2Vcc, 0.011, 0.005),
        ldr2Vcc
      ]
    },
    {
      id: 'ldr2-gnd-esp',
      fromPin: 'ESP32 GND (P35)',
      toPin: 'LDR 2 (Kanan) GND',
      fromPinId: 'esp-gnd-ldr2',
      toPinId: 'ldr2-gnd',
      voltage: '0V GND',
      description: 'Nyambung dari pin GND ESP32 langsung ke pin GND LDR 2 (bukan lewat breadboard).',
      category: 'ldr',
      radius: 0.0017,
      baseColor: 0x262a33,
      highlightHex: 0x94a3b8,
      points: [
        esp35G,
        lift(esp35G, 0.011, 0.006),
        [0.02, 0.633, 0.178],
        [-0.35, 0.632, 0.176],
        lift(ldr2Gnd, 0.011, 0.005),
        ldr2Gnd
      ]
    },

    // --- I. UPS 5V (QF-M6001-2 + 2x 18650 PARALLEL) POWERING ESP32 GOOUUU V4 ---
    {
      id: 'usb-ups-5v-in',
      fromPin: 'Adaptor / Charger USB-C 5V',
      toPin: 'UPS QF-M6001-2 USB-C IN',
      fromPinId: 'usbc-host',
      toPinId: 'ups-in-usbc',
      voltage: '5V USB-C Input',
      description: 'Kabel daya USB Type-C 5V masuk ke input USB-C modul UPS QF-M6001-2 untuk mengisi 2 baterai 18650 paralel sekaligus menyuplai jalur boost 5V.',
      category: 'usb',
      radius: 0.0029,
      baseColor: 0x2a303b,
      highlightHex: 0x38bdf8,
      points: [
        [0.370, 0.025, 0.245],
        [0.362, 0.300, 0.215],
        [0.356, 0.560, 0.165],
        [0.362, 0.625, 0.132],
        [upsUsbIn[0] - 0.006, upsUsbIn[1], upsUsbIn[2]],
        upsUsbIn
      ]
    },
    {
      id: 'ups-esp-5v',
      fromPin: 'UPS QF-M6001-2 UPS+ (5V)',
      toPin: 'ESP32 GOOUUU V4 5V',
      fromPinId: 'ups-out-p',
      toPinId: 'esp-pwr-5v',
      voltage: '5.0V Boost DC (Max 20W)',
      description: 'Kabel merah dari pad solder UPS+ QF-M6001-2 menyuplai tegangan stabil 5V tanpa jeda (backup 2×18650) ke pin 5V papan ekspansi GOOUUU V4 ESP32.',
      category: 'usb',
      radius: 0.0023,
      baseColor: 0xdc2626,
      highlightHex: 0x22c55e,
      points: [
        upsOutP,
        [upsOutP[0] + 0.006, upsOutP[1] + 0.014, upsOutP[2] - 0.006],
        [0.440, 0.660, 0.088],
        [0.245, 0.660, 0.088],
        [0.215, 0.652, 0.145],
        [espPwr5v[0] + 0.012, espPwr5v[1] + 0.016, espPwr5v[2]],
        [espPwr5v[0], espPwr5v[1] + 0.013, espPwr5v[2]],
        espPwr5v
      ]
    },
    {
      id: 'ups-esp-gnd',
      fromPin: 'UPS QF-M6001-2 UPS− (GND)',
      toPin: 'ESP32 GOOUUU V4 GND',
      fromPinId: 'ups-out-n',
      toPinId: 'esp-pwr-gnd',
      voltage: '0V GND',
      description: 'Kabel hitam dari pad solder UPS− QF-M6001-2 ke pin GND header 5V/GND papan ekspansi GOOUUU V4 ESP32.',
      category: 'usb',
      radius: 0.0023,
      baseColor: 0x1e2229,
      highlightHex: 0x00d4ff,
      points: [
        upsOutN,
        [upsOutN[0] + 0.006, upsOutN[1] + 0.012, upsOutN[2] + 0.008],
        [0.420, 0.654, 0.168],
        [0.220, 0.652, 0.168],
        [espPwrGnd[0], espPwrGnd[1] + 0.013, espPwrGnd[2] + 0.004],
        espPwrGnd
      ]
    }
  ];
}

/**
 * Master registry of EVERY clickable physical pin & screw terminal on the entire rig!
 * Clicking any pin in 3D highlights its exact wires & destination pin(s) and explains what it does.
 */
export function buildClickablePinRegistry() {
  const pins = [
    // --- GOOUUU ESP32-S V4 Active Pins ---
    {
      id: 'esp-34', board: 'ESP32', pinName: 'GPIO34',
      pos: getGoouuuPinPos('front', 4, 'S').world, color: '#facc15', status: 'AKTIF',
      voltage: '0–3.3V Analog', wireIds: ['ldr1-ao-34'],
      connectedTo: ['LDR 1 (Kiri) AO'],
      detail: 'Nyambung ke pin AO LDR 1 (kiri) untuk membaca cahaya kiri.'
    },
    {
      id: 'esp-v33-ldr1', board: 'ESP32', pinName: '3.3V (P34)',
      pos: getGoouuuPinPos('front', 4, 'V').world, color: '#ef4444', status: 'AKTIF',
      voltage: '3.3V DC', wireIds: ['ldr1-vcc-3v3'],
      connectedTo: ['LDR 1 (Kiri) VCC'],
      detail: 'Nyambung ke pin VCC LDR 1 sebagai daya 3.3V.'
    },
    {
      id: 'esp-gnd-ldr1', board: 'ESP32', pinName: 'GND (P34)',
      pos: getGoouuuPinPos('front', 4, 'G').world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V GND', wireIds: ['ldr1-gnd-esp'],
      connectedTo: ['LDR 1 (Kiri) GND'],
      detail: 'Nyambung langsung ke pin GND LDR 1.'
    },
    {
      id: 'esp-35', board: 'ESP32', pinName: 'GPIO35',
      pos: getGoouuuPinPos('front', 5, 'S').world, color: '#a855f7', status: 'AKTIF',
      voltage: '0–3.3V Analog', wireIds: ['ldr2-ao-35'],
      connectedTo: ['LDR 2 (Kanan) AO'],
      detail: 'Nyambung ke pin AO LDR 2 (kanan) untuk membaca cahaya kanan.'
    },
    {
      id: 'esp-v33-ldr2', board: 'ESP32', pinName: '3.3V (P35)',
      pos: getGoouuuPinPos('front', 5, 'V').world, color: '#ef4444', status: 'AKTIF',
      voltage: '3.3V DC', wireIds: ['ldr2-vcc-3v3'],
      connectedTo: ['LDR 2 (Kanan) VCC'],
      detail: 'Nyambung ke pin VCC LDR 2 sebagai daya 3.3V.'
    },
    {
      id: 'esp-gnd-ldr2', board: 'ESP32', pinName: 'GND (P35)',
      pos: getGoouuuPinPos('front', 5, 'G').world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V GND', wireIds: ['ldr2-gnd-esp'],
      connectedTo: ['LDR 2 (Kanan) GND'],
      detail: 'Nyambung langsung ke pin GND LDR 2.'
    },
    {
      id: 'esp-gnd-bb', board: 'ESP32', pinName: 'GND (Common)',
      pos: getGoouuuPinPos('front', 0, 'G').world, color: '#00d4ff', status: 'AKTIF',
      voltage: '0V Common GND', wireIds: ['gnd-esp-bb', 'gnd-xl-bb', 'gnd-servo-bb', 'ina-gnd-bb'],
      connectedTo: ['Breadboard Common GND'],
      detail: 'Nyambung ke Common GND Breadboard bersama XL4015 OUT−, Servo MG996R, & INA219 GND.'
    },
    {
      id: 'esp-aux-d22', board: 'GOOUUU V4 (Aux)', pinName: 'D22 (GPIO22 SCL)',
      pos: getGoouuuAuxPinPos('D22').world, color: '#06b6d4', status: 'AKTIF',
      voltage: '3.3V I2C', wireIds: ['ina-scl-22'],
      connectedTo: ['INA219 SCL'],
      detail: 'Pin aux D22 (terhubung ke GPIO22) nyambung ke pin SCL INA219 (bus I2C).'
    },
    {
      id: 'esp-aux-d21', board: 'GOOUUU V4 (Aux)', pinName: 'D21 (GPIO21 SDA)',
      pos: getGoouuuAuxPinPos('D21').world, color: '#10b981', status: 'AKTIF',
      voltage: '3.3V I2C', wireIds: ['ina-sda-21'],
      connectedTo: ['INA219 SDA'],
      detail: 'Pin aux D21 (terhubung ke GPIO21) nyambung ke pin SDA INA219 (alamat 0x40).'
    },
    {
      id: 'esp-aux-vcc', board: 'GOOUUU V4 (Aux)', pinName: 'VCC (3.3V JUMP)',
      pos: getGoouuuAuxPinPos('VCC').world, color: '#ef4444', status: 'AKTIF',
      voltage: '3.3V DC', wireIds: ['ina-vcc-3v3'],
      connectedTo: ['INA219 VCC'],
      detail: 'Pin aux VCC (3.3V sesuai posisi JUMP kuning) nyambung ke pin VCC INA219.'
    },
    {
      id: 'esp-aux-gnd', board: 'GOOUUU V4 (Aux)', pinName: 'GND (Aux)',
      pos: getGoouuuAuxPinPos('GND').world, color: '#94a3b8', status: 'KOSONG',
      voltage: '0V GND', wireIds: [],
      connectedTo: ['Kosong (INA219 GND terhubung ke Breadboard Common GND)'],
      detail: 'Pin aux GND cadangan pada header belakang GOOUUU V4.'
    },
    {
      id: 'esp-22', board: 'ESP32', pinName: 'GPIO22 (SCL)',
      pos: getGoouuuPinPos('rear', 2, 'S').world, color: '#38bdf8', status: 'AKTIF',
      voltage: '3.3V I2C', wireIds: ['i2c-scl-22'],
      connectedTo: ['Tiny RTC SCL'],
      detail: 'Nyambung ke pin SCL Tiny RTC.'
    },
    {
      id: 'esp-21', board: 'ESP32', pinName: 'GPIO21 (SDA)',
      pos: getGoouuuPinPos('rear', 5, 'S').world, color: '#2ecc71', status: 'AKTIF',
      voltage: '3.3V I2C', wireIds: ['i2c-sda-21'],
      connectedTo: ['Tiny RTC SDA'],
      detail: 'Nyambung ke pin SDA Tiny RTC.'
    },
    {
      id: 'esp-v33-rtc', board: 'ESP32', pinName: '3.3V (P21)',
      pos: getGoouuuPinPos('rear', 5, 'V').world, color: '#ef4444', status: 'AKTIF',
      voltage: '3.3V DC', wireIds: ['i2c-rtc-vcc'],
      connectedTo: ['Tiny RTC VCC'],
      detail: 'Nyambung ke pin VCC Tiny RTC.'
    },
    {
      id: 'esp-gnd-rtc', board: 'ESP32', pinName: 'GND (P21)',
      pos: getGoouuuPinPos('rear', 5, 'G').world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V GND', wireIds: ['i2c-rtc-gnd'],
      connectedTo: ['Tiny RTC GND'],
      detail: 'Nyambung langsung ke pin GND Tiny RTC.'
    },
    {
      id: 'esp-18', board: 'ESP32', pinName: 'GPIO18 (PWM)',
      pos: getGoouuuPinPos('rear', 8, 'S').world, color: '#ff9f0a', status: 'AKTIF',
      voltage: '3.3V PWM', wireIds: ['pwm-esp18-servo'],
      connectedTo: ['Servo Oranye (PWM)'],
      detail: 'Nyambung ke kabel oranye Servo MG996R untuk atur gerak panel.'
    },
    {
      id: 'esp-usb', board: 'ESP32S NodeMCU', pinName: 'Port Micro-USB (Data + 5V)',
      pos: [BOARD_ORIGINS.esp.x + 0.030, BOARD_ORIGINS.esp.y + 0.0175, BOARD_ORIGINS.esp.z - 0.0006],
      color: '#94a3b8', status: 'KOSONG', voltage: '5V USB + Serial', wireIds: [],
      connectedTo: ['Kosong (daya saat ini lewat USB-C 5V GOOUUU V4)'],
      detail: 'Port Micro-USB ESP32S (chip CP2102) sedang tidak dicolok; suplai daya 5V saat ini dihubungkan lewat port USB5V Type-C papan ekspansi GOOUUU V4.'
    },
    {
      id: 'esp-dc-jack', board: 'GOOUUU V4', pinName: 'Port DC6.5-16V (Barrel Jack)',
      pos: [BOARD_ORIGINS.esp.x + 0.068, BOARD_ORIGINS.esp.y + 0.009, BOARD_ORIGINS.esp.z - 0.034],
      color: '#f59e0b', status: 'KOSONG', voltage: '6.5–16V DC In', wireIds: [],
      connectedTo: ['Opsional · Adaptor DC 6.5–16V (5.5×2.1mm)'],
      detail: 'Input daya DC barrel jack 6.5–16V di pojok belakang kanan GOOUUU V4 (diturunkan ke 5V oleh IC 1117 5.0 & 2 kapasitor CS 47 35V).'
    },
    {
      id: 'esp-goouuu-microusb', board: 'GOOUUU V4', pinName: 'Port Micro-USB (5V Power)',
      pos: [BOARD_ORIGINS.esp.x + 0.068, BOARD_ORIGINS.esp.y + 0.0055, BOARD_ORIGINS.esp.z - 0.011],
      color: '#94a3b8', status: 'KOSONG', voltage: '5V DC In', wireIds: [],
      connectedTo: ['Opsional · Power USB 5V'],
      detail: 'Port Micro-USB di sisi tengah kanan papan ekspansi GOOUUU V4 untuk suplai daya 5V (khusus power, bukan data Serial).'
    },
    {
      id: 'esp-goouuu-usbc', board: 'GOOUUU V4', pinName: 'Port USB5V (Type-C)',
      pos: [BOARD_ORIGINS.esp.x + 0.067, BOARD_ORIGINS.esp.y + 0.0055, BOARD_ORIGINS.esp.z + 0.022],
      color: '#94a3b8', status: 'KOSONG', voltage: '5V USB-C In', wireIds: [],
      connectedTo: ['Kosong (ESP32 kini disuplai lewat UPS QF-M6001-2 → header 5V/GND)'],
      detail: 'Port USB5V Type-C GOOUUU V4 bebas karena daya 5V utama sekarang disuplai tanpa putus dari modul UPS QF-M6001-2 (2×18650).'
    },
    {
      id: 'esp-pwr-5v', board: 'GOOUUU V4 (Power)', pinName: 'Pin 5V (dari UPS+)',
      pos: getGoouuuPwrPinPos('5V').world, color: '#ef4444', status: 'AKTIF',
      voltage: '5.0V DC (UPS)', wireIds: ['ups-esp-5v'],
      connectedTo: ['UPS QF-M6001-2 UPS+ (5V)'],
      detail: 'Menerima suplai 5V stabil tanpa jeda dari pad output UPS+ QF-M6001-2 (didukung 2 baterai 18650 paralel) untuk menyalakan ESP32.'
    },
    {
      id: 'esp-pwr-gnd', board: 'GOOUUU V4 (Power)', pinName: 'Pin GND (dari UPS−)',
      pos: getGoouuuPwrPinPos('GND').world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V GND', wireIds: ['ups-esp-gnd'],
      connectedTo: ['UPS QF-M6001-2 UPS− (GND)'],
      detail: 'Jalur balik ground 5V dari pad output UPS− QF-M6001-2 ke header GND GOOUUU V4.'
    },

    // --- UPS QF-M6001-2 (5V Boost UPS + 2x 18650 Parallel Battery Holder) ---
    {
      id: 'ups-in-usbc', board: 'UPS QF-M6001-2', pinName: 'Port USB-C 5V IN',
      pos: getUpsPadPos('USBC_IN').world, color: '#38bdf8', status: 'AKTIF',
      voltage: '5V USB-C In', wireIds: ['usb-ups-5v-in'],
      connectedTo: ['Adaptor / Charger USB-C 5V'],
      detail: 'Input USB Type-C 5V pada modul UPS QF-M6001-2 untuk mengisi 2 baterai 18650 paralel (4.2V) sekaligus menyuplai konverter boost 5V.'
    },
    {
      id: 'ups-in-5vp', board: 'UPS QF-M6001-2', pinName: 'Pad Solder 5V+',
      pos: getUpsPadPos('5V+').world, color: '#eab308', status: 'KOSONG',
      voltage: '5V Input (Paralel USB-C)', wireIds: [],
      connectedTo: ['Paralel dengan USB-C 5V IN'],
      detail: 'Pad solder alternatif input 5V+ (paralel dengan port USB Type-C di sisi kiri PCB QF-M6001-2).'
    },
    {
      id: 'ups-in-5vn', board: 'UPS QF-M6001-2', pinName: 'Pad Solder 5V−',
      pos: getUpsPadPos('5V-').world, color: '#eab308', status: 'KOSONG',
      voltage: '0V Input (Paralel USB-C)', wireIds: [],
      connectedTo: ['Paralel dengan USB-C GND'],
      detail: 'Pad solder negatif input 5V− di pojok kiri bawah PCB QF-M6001-2.'
    },
    {
      id: 'ups-out-p', board: 'UPS QF-M6001-2', pinName: 'UPS+ (Output 5V)',
      pos: getUpsPadPos('UPS+').world, color: '#22c55e', status: 'AKTIF',
      voltage: '5.0V Boost DC', wireIds: ['ups-esp-5v'],
      connectedTo: ['ESP32 GOOUUU V4 5V'],
      detail: 'Pad solder output positif UPS+ (induktor boost 2R2 + SS54 + 2×220µF 16V) menyuplai 5V tanpa putus ke ESP32 GOOUUU V4.'
    },
    {
      id: 'ups-out-n', board: 'UPS QF-M6001-2', pinName: 'UPS− (Output GND)',
      pos: getUpsPadPos('UPS-').world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V GND', wireIds: ['ups-esp-gnd'],
      connectedTo: ['ESP32 GOOUUU V4 GND'],
      detail: 'Pad solder output negatif UPS− (terhubung melalui proteksi baterai U2/U3) ke GND GOOUUU V4.'
    },
    {
      id: 'ups-bat-1', board: 'UPS QF-M6001-2', pinName: 'Baterai 18650 #1 (Belakang)',
      pos: getUpsPadPos('BAT1').world, color: '#0ea5e9', status: 'AKTIF',
      voltage: '3.7–4.2V Li-Ion (Paralel)', wireIds: ['ups-esp-5v', 'ups-esp-gnd'],
      connectedTo: ['Bus Paralel Baterai + / −'],
      detail: 'Sel Li-Ion 18650 #1 terpasang paralel pada holder bawah PCB QF-M6001-2 (proteksi overcharge/overdischarge/short).'
    },
    {
      id: 'ups-bat-2', board: 'UPS QF-M6001-2', pinName: 'Baterai 18650 #2 (Depan)',
      pos: getUpsPadPos('BAT2').world, color: '#0ea5e9', status: 'AKTIF',
      voltage: '3.7–4.2V Li-Ion (Paralel)', wireIds: ['ups-esp-5v', 'ups-esp-gnd'],
      connectedTo: ['Bus Paralel Baterai + / −'],
      detail: 'Sel Li-Ion 18650 #2 terpasang paralel dengan sel #1 untuk backup daya ESP32 hingga 20W max.'
    },

    // --- Breadboard Common Ground (4 SLOTS: XL4015 OUT−, Servo MG996R, ESP32, INA219) ---
    {
      id: 'bb-gnd-xl', board: 'Breadboard Common GND', pinName: 'Slot 1 (XL4015)',
      pos: getBreadboardGndPinPos(0).world, color: '#00d4ff', status: 'AKTIF',
      voltage: '0V Common GND', wireIds: ['gnd-xl-bb'],
      connectedTo: ['XL4015 OUT−'],
      detail: 'Nyambung ke XL4015 OUT− (Common GND bersama Servo, ESP32, & INA219).'
    },
    {
      id: 'bb-gnd-srv', board: 'Breadboard Common GND', pinName: 'Slot 2 (Servo)',
      pos: getBreadboardGndPinPos(1).world, color: '#00d4ff', status: 'AKTIF',
      voltage: '0V Common GND', wireIds: ['gnd-servo-bb'],
      connectedTo: ['Servo Cokelat (GND)'],
      detail: 'Nyambung ke kabel cokelat Servo MG996R (Common GND).'
    },
    {
      id: 'bb-gnd-esp', board: 'Breadboard Common GND', pinName: 'Slot 3 (ESP32)',
      pos: getBreadboardGndPinPos(2).world, color: '#00d4ff', status: 'AKTIF',
      voltage: '0V Common GND', wireIds: ['gnd-esp-bb'],
      connectedTo: ['ESP32 GND'],
      detail: 'Nyambung ke GND ESP32 (Common GND).'
    },
    {
      id: 'bb-gnd-ina', board: 'Breadboard Common GND', pinName: 'Slot 4 (INA219)',
      pos: getBreadboardGndPinPos(3).world, color: '#00d4ff', status: 'AKTIF',
      voltage: '0V Common GND', wireIds: ['ina-gnd-bb'],
      connectedTo: ['INA219 GND'],
      detail: 'Nyambung ke GND INA219 (Common GND bersama Controller LOAD−, XL4015 OUT−, & ESP32).'
    },

    // --- INA219 High-Side Current/Voltage Sensor (Screw Terminals + 6-Pin Header) ---
    {
      id: 'ina-vin-p-term', board: 'INA219', pinName: 'VIN+ (Sekrup 12V In)',
      pos: getIna219ScrewPos('VIN+').world, color: '#ff5722', status: 'AKTIF',
      voltage: '12V DC (SCC LOAD+)', wireIds: ['scc-ina-load-pos'],
      connectedTo: ['SCC LOAD+ (12V)'],
      detail: 'Terminal sekrup sisi tinggi VIN+ menerima 12V dari terminal LOAD+ Solar Charge Controller menuju resistor shunt R100 (0.1Ω).'
    },
    {
      id: 'ina-vin-n-term', board: 'INA219', pinName: 'VIN− (Sekrup 12V Out)',
      pos: getIna219ScrewPos('VIN-').world, color: '#fb923c', status: 'AKTIF',
      voltage: '12V DC (Shunt Out)', wireIds: ['ina-xl-in-pos'],
      connectedTo: ['XL4015 IN+'],
      detail: 'Terminal sekrup VIN− keluar dari sisi hilir resistor shunt R100 langsung menuju input IN+ XL4015 merah.'
    },
    {
      id: 'ina-vcc', board: 'INA219', pinName: 'VCC (3.3V)',
      pos: getIna219PinPos(0).world, color: '#ef4444', status: 'AKTIF',
      voltage: '3.3V DC', wireIds: ['ina-vcc-3v3'],
      connectedTo: ['ESP32 3.3V (Aux)'],
      detail: 'Suplai chip INA219 3.3V dari ESP32 (chip mendukung 3–5.5V, terpisah dari tegangan bus 12V pada VIN+/VIN−).'
    },
    {
      id: 'ina-gnd', board: 'INA219', pinName: 'GND',
      pos: getIna219PinPos(1).world, color: '#00d4ff', status: 'AKTIF',
      voltage: '0V Common GND', wireIds: ['ina-gnd-bb'],
      connectedTo: ['Breadboard Common GND'],
      detail: 'Nyambung ke Common GND (sama dengan Controller LOAD− & ESP32 GND) agar pengukuran bus voltage 0–26V akurat.'
    },
    {
      id: 'ina-scl', board: 'INA219', pinName: 'SCL (I2C)',
      pos: getIna219PinPos(2).world, color: '#06b6d4', status: 'AKTIF',
      voltage: '3.3V I2C', wireIds: ['ina-scl-22'],
      connectedTo: ['ESP32 GPIO22 (D22)'],
      detail: 'Jalur clock I2C ke GPIO22 (D22) ESP32 (bus I2C bersama Tiny RTC).'
    },
    {
      id: 'ina-sda', board: 'INA219', pinName: 'SDA (I2C)',
      pos: getIna219PinPos(3).world, color: '#10b981', status: 'AKTIF',
      voltage: '3.3V I2C', wireIds: ['ina-sda-21'],
      connectedTo: ['ESP32 GPIO21 (D21)'],
      detail: 'Jalur data I2C ke GPIO21 (D21) ESP32 (alamat default I2C 0x40).'
    },
    {
      id: 'ina-vin-n-hdr', board: 'INA219', pinName: 'VIN− (Pin Header)',
      pos: getIna219PinPos(4).world, color: '#eab308', status: 'KOSONG',
      voltage: 'Paralel Sekrup VIN−', wireIds: [],
      connectedTo: ['Kosong (jalur 12V lewat terminal sekrup VIN−)'],
      detail: 'Pin header VIN− paralel secara internal dengan terminal sekrup biru VIN−; jalur arus utama memakai terminal sekrup.'
    },
    {
      id: 'ina-vin-p-hdr', board: 'INA219', pinName: 'VIN+ (Pin Header)',
      pos: getIna219PinPos(5).world, color: '#eab308', status: 'KOSONG',
      voltage: 'Paralel Sekrup VIN+', wireIds: [],
      connectedTo: ['Kosong (jalur 12V lewat terminal sekrup VIN+)'],
      detail: 'Pin header VIN+ paralel secara internal dengan terminal sekrup biru VIN+; jalur arus utama memakai terminal sekrup.'
    },

    // --- Red XL4015 CC/CV 5A Screw Terminals ---
    {
      id: 'xl-in-p', board: 'XL4015 Merah', pinName: 'IN+',
      pos: getXl4015PinPos('IN+').world, color: '#ff5722', status: 'AKTIF',
      voltage: '12V DC', wireIds: ['ina-xl-in-pos'],
      connectedTo: ['INA219 VIN−'],
      detail: 'Menerima 12V dari keluaran shunt INA219 VIN− (berasal dari SCC LOAD+).'
    },
    {
      id: 'xl-in-n', board: 'XL4015 Merah', pinName: 'IN−',
      pos: getXl4015PinPos('IN-').world, color: '#fb923c', status: 'AKTIF',
      voltage: '0V Input', wireIds: ['scc-xl-load-neg'],
      connectedTo: ['SCC LOAD−'],
      detail: 'Nyambung dari SCC LOAD− masuk ke XL4015.'
    },
    {
      id: 'xl-out-p', board: 'XL4015 Merah', pinName: 'OUT+ (6V)',
      pos: getXl4015PinPos('OUT+').world, color: '#ff69b4', status: 'AKTIF',
      voltage: '6.0V DC', wireIds: ['xl-servo-6v'],
      connectedTo: ['Servo Merah (VCC)'],
      detail: 'Nyambung ke kabel merah Servo MG996R (6V). Jangan sambung ke 3V3/5V ESP32!'
    },
    {
      id: 'xl-out-n', board: 'XL4015 Merah', pinName: 'OUT− (GND)',
      pos: getXl4015PinPos('OUT-').world, color: '#00d4ff', status: 'AKTIF',
      voltage: '0V Common GND', wireIds: ['gnd-xl-bb'],
      connectedTo: ['Breadboard Common GND'],
      detail: 'Nyambung ke Common GND Breadboard (satu jalur dengan Servo, ESP32, & INA219).'
    },

    // --- Tiny RTC DS1307 All 7 Pins ---
    {
      id: 'rtc-sq', board: 'Tiny RTC', pinName: 'SQ',
      pos: getTinyRtcPinPos(0).world, color: '#eab308', status: 'KOSONG',
      voltage: 'Kosong', wireIds: [], connectedTo: ['Tidak dipakai'],
      detail: 'Pin kosong — tidak perlu disambung.'
    },
    {
      id: 'rtc-ds', board: 'Tiny RTC', pinName: 'DS',
      pos: getTinyRtcPinPos(1).world, color: '#eab308', status: 'KOSONG',
      voltage: 'Kosong', wireIds: [], connectedTo: ['Tidak dipakai'],
      detail: 'Pin kosong — tidak perlu disambung.'
    },
    {
      id: 'rtc-scl', board: 'Tiny RTC', pinName: 'SCL',
      pos: getTinyRtcPinPos(2).world, color: '#38bdf8', status: 'AKTIF',
      voltage: '3.3V I2C', wireIds: ['i2c-scl-22'],
      connectedTo: ['ESP32 GPIO22 (SCL)'],
      detail: 'Nyambung ke GPIO22 ESP32.'
    },
    {
      id: 'rtc-sda', board: 'Tiny RTC', pinName: 'SDA',
      pos: getTinyRtcPinPos(3).world, color: '#2ecc71', status: 'AKTIF',
      voltage: '3.3V I2C', wireIds: ['i2c-sda-21'],
      connectedTo: ['ESP32 GPIO21 (SDA)'],
      detail: 'Nyambung ke GPIO21 ESP32.'
    },
    {
      id: 'rtc-vcc', board: 'Tiny RTC', pinName: 'VCC',
      pos: getTinyRtcPinPos(4).world, color: '#ef4444', status: 'AKTIF',
      voltage: '3.3V DC', wireIds: ['i2c-rtc-vcc'],
      connectedTo: ['ESP32 3.3V (P21)'],
      detail: 'Nyambung ke pin 3.3V ESP32.'
    },
    {
      id: 'rtc-gnd', board: 'Tiny RTC', pinName: 'GND',
      pos: getTinyRtcPinPos(5).world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V GND', wireIds: ['i2c-rtc-gnd'],
      connectedTo: ['ESP32 GND (P21)'],
      detail: 'Nyambung langsung ke pin GND ESP32.'
    },
    {
      id: 'rtc-bat', board: 'Tiny RTC', pinName: 'BAT',
      pos: getTinyRtcPinPos(6).world, color: '#eab308', status: 'KOSONG',
      voltage: 'Kosong', wireIds: [], connectedTo: ['Tidak dipakai'],
      detail: 'Pin kosong — tidak perlu disambung.'
    },

    // --- LDR 1 & LDR 2 (All 4 pins each; ALL active pins go straight to ESP32!) ---
    {
      id: 'ldr1-vcc', board: 'LDR 1 (Kiri)', pinName: 'VCC',
      pos: getLdrPinPos(-1, 0).world, color: '#ef4444', status: 'AKTIF',
      voltage: '3.3V DC', wireIds: ['ldr1-vcc-3v3'],
      connectedTo: ['ESP32 3.3V (P34)'],
      detail: 'Nyambung langsung ke pin 3.3V ESP32.'
    },
    {
      id: 'ldr1-gnd', board: 'LDR 1 (Kiri)', pinName: 'GND',
      pos: getLdrPinPos(-1, 1).world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V GND', wireIds: ['ldr1-gnd-esp'],
      connectedTo: ['ESP32 GND (P34)'],
      detail: 'Nyambung langsung ke pin GND ESP32.'
    },
    {
      id: 'ldr1-do', board: 'LDR 1 (Kiri)', pinName: 'DO',
      pos: getLdrPinPos(-1, 2).world, color: '#eab308', status: 'KOSONG',
      voltage: 'Kosong', wireIds: [], connectedTo: ['Tidak dipakai (pakai pin AO)'],
      detail: 'Pin DO kosong — sensor ini pakai pin AO.'
    },
    {
      id: 'ldr1-ao', board: 'LDR 1 (Kiri)', pinName: 'AO',
      pos: getLdrPinPos(-1, 3).world, color: '#facc15', status: 'AKTIF',
      voltage: '0–3.3V Analog', wireIds: ['ldr1-ao-34'],
      connectedTo: ['ESP32 GPIO34'],
      detail: 'Nyambung langsung ke GPIO34 ESP32.'
    },
    {
      id: 'ldr2-vcc', board: 'LDR 2 (Kanan)', pinName: 'VCC',
      pos: getLdrPinPos(1, 0).world, color: '#ef4444', status: 'AKTIF',
      voltage: '3.3V DC', wireIds: ['ldr2-vcc-3v3'],
      connectedTo: ['ESP32 3.3V (P35)'],
      detail: 'Nyambung langsung ke pin 3.3V ESP32.'
    },
    {
      id: 'ldr2-gnd', board: 'LDR 2 (Kanan)', pinName: 'GND',
      pos: getLdrPinPos(1, 1).world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V GND', wireIds: ['ldr2-gnd-esp'],
      connectedTo: ['ESP32 GND (P35)'],
      detail: 'Nyambung langsung ke pin GND ESP32.'
    },
    {
      id: 'ldr2-do', board: 'LDR 2 (Kanan)', pinName: 'DO',
      pos: getLdrPinPos(1, 2).world, color: '#eab308', status: 'KOSONG',
      voltage: 'Kosong', wireIds: [], connectedTo: ['Tidak dipakai (pakai pin AO)'],
      detail: 'Pin DO kosong — sensor ini pakai pin AO.'
    },
    {
      id: 'ldr2-ao', board: 'LDR 2 (Kanan)', pinName: 'AO',
      pos: getLdrPinPos(1, 3).world, color: '#a855f7', status: 'AKTIF',
      voltage: '0–3.3V Analog', wireIds: ['ldr2-ao-35'],
      connectedTo: ['ESP32 GPIO35'],
      detail: 'Nyambung langsung ke GPIO35 ESP32.'
    },

    // --- SCC 6 Screw Terminals ---
    {
      id: 'scc-pv-p', board: 'Charge Controller', pinName: '+PV',
      pos: getSccTerminalPos(0).world, color: '#ff3b30', status: 'AKTIF',
      voltage: '12–18V DC', wireIds: ['pv-watt-scc-pos'],
      connectedTo: ['Watt Meter LOAD+'], detail: 'Nyambung dari LOAD+ Watt Meter.'
    },
    {
      id: 'scc-pv-n', board: 'Charge Controller', pinName: '−PV',
      pos: getSccTerminalPos(1).world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V PV', wireIds: ['pv-watt-scc-neg'],
      connectedTo: ['Watt Meter LOAD−'], detail: 'Nyambung dari LOAD− Watt Meter.'
    },
    {
      id: 'scc-bat-p', board: 'Charge Controller', pinName: '+BAT',
      pos: getSccTerminalPos(2).world, color: '#ef4444', status: 'AKTIF',
      voltage: '12V DC', wireIds: ['bat-scc-pos'],
      connectedTo: ['Aki INCOE (+)'], detail: 'Nyambung ke kutub merah (+) Aki INCOE.'
    },
    {
      id: 'scc-bat-n', board: 'Charge Controller', pinName: '−BAT',
      pos: getSccTerminalPos(3).world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V Aki', wireIds: ['bat-scc-neg'],
      connectedTo: ['Aki INCOE (−)'], detail: 'Nyambung ke kutub hitam (−) Aki INCOE.'
    },
    {
      id: 'scc-load-p', board: 'Charge Controller', pinName: '+LOAD',
      pos: getSccTerminalPos(4).world, color: '#ff5722', status: 'AKTIF',
      voltage: '12V DC', wireIds: ['scc-ina-load-pos'],
      connectedTo: ['INA219 VIN+ (12V)'], detail: 'Nyambung ke terminal sekrup VIN+ INA219 sebelum masuk XL4015 IN+.'
    },
    {
      id: 'scc-load-n', board: 'Charge Controller', pinName: '−LOAD',
      pos: getSccTerminalPos(5).world, color: '#fb923c', status: 'AKTIF',
      voltage: '0V Input', wireIds: ['scc-xl-load-neg'],
      connectedTo: ['XL4015 IN−'], detail: 'Nyambung ke IN− XL4015 merah.'
    },

    // --- Watt Meter Leads ---
    {
      id: 'watt-src-p', board: 'Watt Meter', pinName: 'SOURCE+',
      pos: getWattMeterPinPos('SRC+').world, color: '#ff3b30', status: 'AKTIF',
      voltage: '12–18V DC', wireIds: ['pv-panel-watt-pos'],
      connectedTo: ['Panel Surya (+)'], detail: 'Nyambung dari kabel merah (+) Panel Surya.'
    },
    {
      id: 'watt-src-n', board: 'Watt Meter', pinName: 'SOURCE−',
      pos: getWattMeterPinPos('SRC-').world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V PV', wireIds: ['pv-panel-watt-neg'],
      connectedTo: ['Panel Surya (−)'], detail: 'Nyambung dari kabel hitam (−) Panel Surya.'
    },
    {
      id: 'watt-load-p', board: 'Watt Meter', pinName: 'LOAD+',
      pos: getWattMeterPinPos('LOAD+').world, color: '#ff3b30', status: 'AKTIF',
      voltage: '12–18V DC', wireIds: ['pv-watt-scc-pos'],
      connectedTo: ['SCC PV+'], detail: 'Nyambung ke terminal PV+ Charge Controller.'
    },
    {
      id: 'watt-load-n', board: 'Watt Meter', pinName: 'LOAD−',
      pos: getWattMeterPinPos('LOAD-').world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V PV', wireIds: ['pv-watt-scc-neg'],
      connectedTo: ['SCC PV−'], detail: 'Nyambung ke terminal PV− Charge Controller.'
    },

    // --- Servo MG996R 3-Pin Connector ---
    {
      id: 'servo-pwm', board: 'Servo MG996R', pinName: 'Oranye (PWM)',
      pos: SERVO_PLUG_PINS.PWM, color: '#ff9f0a', status: 'AKTIF',
      voltage: '3.3V PWM', wireIds: ['pwm-esp18-servo'],
      connectedTo: ['ESP32 GPIO18'], detail: 'Nyambung dari GPIO18 ESP32 untuk atur sudut servo.'
    },
    {
      id: 'servo-vcc', board: 'Servo MG996R', pinName: 'Merah (VCC 6V)',
      pos: SERVO_PLUG_PINS.VCC, color: '#ff69b4', status: 'AKTIF',
      voltage: '6.0V DC', wireIds: ['xl-servo-6v'],
      connectedTo: ['XL4015 OUT+ (6V)'], detail: 'Nyambung dari XL4015 OUT+ (6V).'
    },
    {
      id: 'servo-gnd', board: 'Servo MG996R', pinName: 'Cokelat (GND)',
      pos: SERVO_PLUG_PINS.GND, color: '#00d4ff', status: 'AKTIF',
      voltage: '0V Common GND', wireIds: ['gnd-servo-bb'],
      connectedTo: ['Breadboard Common GND'], detail: 'Nyambung ke Common GND Breadboard bersama XL4015 OUT− & ESP32.'
    },

    // --- Battery Clips ---
    {
      id: 'bat-pos', board: 'Aki INCOE 12V', pinName: 'Klip Merah (+)',
      pos: getBatteryClipPos('+').world, color: '#ef4444', status: 'AKTIF',
      voltage: '12V DC', wireIds: ['bat-scc-pos'],
      connectedTo: ['SCC BAT+'], detail: 'Nyambung ke terminal BAT+ Charge Controller.'
    },
    {
      id: 'bat-neg', board: 'Aki INCOE 12V', pinName: 'Klip Hitam (−)',
      pos: getBatteryClipPos('-').world, color: '#94a3b8', status: 'AKTIF',
      voltage: '0V Aki', wireIds: ['bat-scc-neg'],
      connectedTo: ['SCC BAT−'], detail: 'Nyambung ke terminal BAT− Charge Controller.'
    }
  ];
  return pins;
}

/**
 * Exact 3D anchor coordinates for crisp, well-spaced macro pin callout badges (zero overlap).
 */
export function buildMacroPinCallouts() {
  const p34 = getGoouuuPinPos('front', 4, 'S').world;
  const p22 = getGoouuuPinPos('rear', 2, 'S').world;
  const pAux22 = getGoouuuAuxPinPos('D22').world;
  const p18 = getGoouuuPinPos('rear', 8, 'S').world;
  const pBb = getBreadboardGndPinPos(1).world;
  const pRtc = getTinyRtcPinPos(3).world;
  const pInaVin = getIna219ScrewPos('VIN+').world;
  const pInaHdr = getIna219PinPos(2).world;
  const pLdr1 = getLdrPinPos(-1, 2).world;
  const pLdr2 = getLdrPinPos(1, 2).world;
  const pXlIn = getXl4015PinPos('IN+').world;
  const pXlOut = getXl4015PinPos('OUT+').world;
  const pScc = getSccTerminalPos(2).world;
  const pWatt = getWattMeterPinPos('SRC+').world;

  const pUpsIn = getUpsPadPos('USBC_IN').world;
  const pUpsOut = getUpsPadPos('UPS+').world;
  const pUpsBat = getUpsPadPos('BAT2').world;
  const pEsp5v = getGoouuuPwrPinPos('5V').world;

  return [
    { id: 'pin-34-35',   label: 'LDR 1 & 2 → ESP32 (AO · 3.3V · GND)', pos: [p34[0] + 0.004, p34[1] - 0.003, p34[2] + 0.015], color: '#facc15', group: 'esp' },
    { id: 'pin-3v3',     label: 'JUMP 3.3V',                           pos: [BOARD_ORIGINS.esp.x + 0.053, BOARD_ORIGINS.esp.y + 0.020, BOARD_ORIGINS.esp.z + 0.028], color: '#c8d828', group: 'esp' },
    { id: 'pin-esp-5v',  label: '5V & GND ← UPS QF-M6001-2',           pos: [pEsp5v[0] - 0.004, pEsp5v[1] + 0.014, pEsp5v[2] + 0.015], color: '#22c55e', group: 'esp' },
    { id: 'pin-ports',   label: 'Port: DC6.5-16V · Micro-USB · USB5V Type-C', pos: [BOARD_ORIGINS.esp.x + 0.072, BOARD_ORIGINS.esp.y + 0.018, BOARD_ORIGINS.esp.z - 0.008], color: '#38bdf8', group: 'esp' },
    { id: 'pin-i2c',     label: 'Tiny RTC → ESP32 (21 · 22 · 3.3V · GND)', pos: [p22[0] - 0.008, p22[1] + 0.018, p22[2] - 0.008], color: '#2ecc71', group: 'esp' },
    { id: 'pin-aux-i2c', label: 'Aux INA219: D22 · D21 · VCC 3.3V',    pos: [pAux22[0] + 0.006, pAux22[1] + 0.020, pAux22[2] - 0.014], color: '#06b6d4', group: 'esp' },
    { id: 'pin-18',      label: 'GPIO18 → Servo Oranye (PWM)',         pos: [p18[0] + 0.026, p18[1] + 0.028, p18[2] - 0.006], color: '#ff9f0a', group: 'esp' },
    { id: 'pin-rtc-i2c', label: 'Tiny RTC: SCL·SDA·VCC·GND',           pos: [pRtc[0] + 0.018, pRtc[1] + 0.022, pRtc[2] - 0.010], color: '#38bdf8', group: 'esp' },
    { id: 'pin-ups-in',  label: 'USB-C 5V IN → Charger U1 + Q1-Q4',    pos: [pUpsIn[0] - 0.008, pUpsIn[1] + 0.024, pUpsIn[2] - 0.018], color: '#38bdf8', group: 'ups' },
    { id: 'pin-ups-ic',  label: 'Boost 2R2 · U4 · 3×SS54 · 4×220µF 16V', pos: [BOARD_ORIGINS.ups.x - 0.002, BOARD_ORIGINS.ups.y + 0.028, BOARD_ORIGINS.ups.z - 0.024], color: '#22c55e', group: 'ups' },
    { id: 'pin-ups-out', label: 'UPS+ (5V) / UPS− → ESP32 5V/GND',     pos: [pUpsOut[0] - 0.018, pUpsOut[1] + 0.014, pUpsOut[2] + 0.016], color: '#ef4444', group: 'ups' },
    { id: 'pin-ups-bat', label: '2× Baterai 18650 (4.2V Paralel)',     pos: [pUpsBat[0], pUpsBat[1] - 0.008, pUpsBat[2] + 0.022], color: '#0ea5e9', group: 'ups' },
    { id: 'pin-ina-vin', label: 'VIN+ ← SCC LOAD+ · VIN− → XL4015 IN+', pos: [pInaVin[0] + 0.007, pInaVin[1] + 0.025, pInaVin[2] - 0.015], color: '#ff5722', group: 'ina219' },
    { id: 'pin-ina-ic',  label: 'IC INA219A (0x40) · Shunt R100 (0.1Ω)', pos: [BOARD_ORIGINS.ina219.x - 0.026, BOARD_ORIGINS.ina219.y + 0.018, BOARD_ORIGINS.ina219.z + 0.003], color: '#06b6d4', group: 'ina219' },
    { id: 'pin-ina-hdr', label: 'VCC(3.3V) · GND · SCL(22) · SDA(21)', pos: [pInaHdr[0], pInaHdr[1] - 0.006, pInaHdr[2] + 0.018], color: '#2ecc71', group: 'ina219' },
    { id: 'pin-bb-gnd',  label: 'Common GND (4 Kabel: XL4015 · Servo · ESP32 · INA219)', pos: [pBb[0], pBb[1] + 0.028, pBb[2] - 0.008], color: '#00d4ff', group: 'breadboard' },
    { id: 'pin-xl-in',   label: 'XL4015 IN+ ← INA219 VIN− · IN− ← LOAD−', pos: [pXlIn[0] - 0.008, pXlIn[1] + 0.024, pXlIn[2] - 0.010], color: '#ff5722', group: 'xl4015' },
    { id: 'pin-xl-out',  label: 'XL4015 OUT+ 6V · OUT− GND',           pos: [pXlOut[0] + 0.008, pXlOut[1] + 0.024, pXlOut[2] + 0.012], color: '#ff69b4', group: 'xl4015' },
    { id: 'pin-ldr1',    label: 'LDR 1 → ESP32 (DO kosong)',           pos: [pLdr1[0] - 0.008, pLdr1[1] + 0.008, pLdr1[2] + 0.010], color: '#facc15', group: 'ldr' },
    { id: 'pin-ldr2',    label: 'LDR 2 → ESP32 (DO kosong)',           pos: [pLdr2[0] + 0.008, pLdr2[1] + 0.008, pLdr2[2] + 0.010], color: '#c084fc', group: 'ldr' },
    { id: 'pin-watt',    label: 'Watt Meter: Panel → SCC',             pos: [pWatt[0] + 0.074, pWatt[1] + 0.048, pWatt[2] + 0.022], color: '#38bdf8', group: 'watt_scc' },
    { id: 'pin-scc-trm', label: 'SCC: +PV− · +BAT− · +LOAD−',          pos: [pScc[0] + 0.015, pScc[1] - 0.016, pScc[2] + 0.016], color: '#ff5722', group: 'watt_scc' }
  ];
}
