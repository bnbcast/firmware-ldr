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
  watt:  { x: 0.0,    y: 1.13,                   z: 0.048, rotY: 0 },
  scc:   { x: 0.0,    y: 0.90,                   z: 0.056, rotY: 0 },
  ldr:   { x: -0.43,  y: RIG_DIMS.deckY + 0.010, z: RIG_DIMS.deckZ },
  xl:    { x: -0.215, y: RIG_DIMS.deckY + 0.011, z: RIG_DIMS.deckZ + 0.004 },
  bread: { x: -0.042, y: RIG_DIMS.deckY + 0.011, z: RIG_DIMS.deckZ + 0.004 },
  esp:   { x: 0.140,  y: RIG_DIMS.deckY + 0.010, z: RIG_DIMS.deckZ + 0.004 },
  rtc:   { x: 0.295,  y: RIG_DIMS.deckY + 0.010, z: RIG_DIMS.deckZ + 0.004 },
  bat:   { x: -0.22,  y: 0.0,                    z: -0.14, rotY: 0.26 }
};

export const GOOUUU_FRONT_PINS = [
  '3V3', 'EN', 'VP', 'VN', '34', '35', '32', '33', '25',
  '26', '27', '14', '12', 'GND', '13', 'D2', 'D3', 'CMD', '5V'
];

export const GOOUUU_REAR_PINS = [
  'GND', '23', '22', 'TX0', 'RX0', '21', 'GND', '19', '18',
  '5', '17', '16', '4', '0', '2', '15', 'D1', 'D0', 'CLK'
];

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
 * Breadboard Common Ground blue (−) bus rail — ONLY 3 connections:
 *  0 = XL4015 OUT− | 1 = Servo MG996R (Cokelat) | 2 = ESP32 GND
 * (LDR 1, LDR 2, and Tiny RTC connect their GND straight into GOOUUU ESP32 Row G!)
 */
export function getBreadboardGndPinPos(slotIndex) {
  const xs = [-0.032, 0.000, 0.032];
  const local = [xs[slotIndex] ?? 0, BREADBOARD_GEO.pinTopY, BREADBOARD_GEO.gndRailZ];
  const world = [
    BOARD_ORIGINS.bread.x + local[0],
    BOARD_ORIGINS.bread.y + local[1],
    BOARD_ORIGINS.bread.z + local[2]
  ];
  return { local, world };
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
  breadboard: [
    { slot: 0, label: 'Common GND ← XL4015 OUT−' },
    { slot: 1, label: 'Common GND ← Servo MG996R (Cokelat)' },
    { slot: 2, label: 'Common GND ← ESP32 GND' }
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
    label: 'SCC LOAD 12V → XL4015',
    colorHex: '#ff5722',
    preset: 'xl4015',
    summary: 'Tegangan 12V dari terminal LOAD SCC masuk ke input IN+/IN− XL4015 untuk diturunkan jadi 6V.',
    pins: 'SCC LOAD+ → XL4015 IN+  |  SCC LOAD− → XL4015 IN−'
  },
  servo6v: {
    label: 'XL4015 OUT+ (6V) → Servo Merah',
    colorHex: '#ff69b4',
    preset: 'xl4015',
    summary: 'Daya 6V dari XL4015 OUT+ khusus ke kabel merah Servo MG996R. Jangan sambung ke 3V3 atau 5V ESP32!',
    pins: 'XL4015 OUT+ (6V) → Servo MG996R Merah'
  },
  gnd: {
    label: 'Common GND (3 Kabel)',
    colorHex: '#00d4ff',
    preset: 'breadboard',
    summary: 'Hanya 3 jalur GND yang disatukan di Breadboard: XL4015 OUT−, kabel cokelat Servo MG996R, dan GND ESP32.',
    pins: 'XL4015 OUT− + Servo Cokelat + ESP32 GND → Breadboard Common GND'
  },
  pwm: {
    label: 'ESP32 GPIO18 → Servo Oranye',
    colorHex: '#ff9f0a',
    preset: 'esp_pins',
    summary: 'Sinyal kendali gerak dari pin GPIO18 ESP32 ke kabel oranye Servo MG996R.',
    pins: 'ESP32 GPIO18 → Servo MG996R Oranye (PWM)'
  },
  i2c: {
    label: 'Tiny RTC ↔ ESP32',
    colorHex: '#2ecc71',
    preset: 'esp_pins',
    summary: '4 kabel Tiny RTC langsung nyambung ke ESP32: SDA→21, SCL→22, VCC→3.3V, dan GND→ESP32 GND.',
    pins: 'RTC SDA/SCL/VCC/GND → ESP32 GPIO21 / GPIO22 / 3.3V / GND'
  },
  ldr: {
    label: 'LDR 1 & 2 ↔ ESP32',
    colorHex: '#a855f7',
    preset: 'ldr',
    summary: 'Semua kabel LDR 1 & LDR 2 (AO, VCC 3.3V, dan GND) nyambung langsung ke ESP32. Pin DO kosong.',
    pins: 'LDR1 → ESP32 GPIO34 / 3.3V / GND  |  LDR2 → ESP32 GPIO35 / 3.3V / GND'
  },
  usb: {
    label: 'USB-C 5V → GOOUUU V4',
    colorHex: '#94a3b8',
    preset: 'esp_pins',
    summary: 'Kabel daya USB Type-C 5V masuk melalui port USB5V di papan ekspansi GOOUUU V4 (port Micro-USB ESP32 dilepas sementara).',
    pins: 'Adaptor / Power USB-C 5V → GOOUUU V4 Port USB5V (Type-C)'
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

  // Breadboard Common GND: ONLY 3 slots!
  const bbXl  = getBreadboardGndPinPos(0).world;
  const bbSrv = getBreadboardGndPinPos(1).world;
  const bbEsp = getBreadboardGndPinPos(2).world;

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

    // --- C. 12V BUCK INPUT: SCC +LOAD- -> Red XL4015 IN+/IN- ---
    {
      id: 'scc-xl-load-pos',
      fromPin: 'SCC LOAD+ (12V)',
      toPin: 'XL4015 IN+',
      fromPinId: 'scc-load-p',
      toPinId: 'xl-in-p',
      voltage: '12V DC',
      description: 'Nyambung dari terminal LOAD+ SCC (12V) ke input IN+ XL4015 merah.',
      category: 'buck12v',
      radius: 0.0034,
      baseColor: 0xd9381e,
      highlightHex: 0xff5722,
      points: [
        sccLoadP,
        drop(sccLoadP, -0.022, 0.004),
        [-0.045, 0.755, 0.072],
        [-0.255, 0.715, 0.088],
        [xlInP[0] - 0.016, xlInP[1] + 0.012, xlInP[2]],
        xlInP
      ]
    },
    {
      id: 'scc-xl-load-neg',
      fromPin: 'SCC LOAD−',
      toPin: 'XL4015 IN−',
      fromPinId: 'scc-load-n',
      toPinId: 'xl-in-n',
      voltage: '0V Input',
      description: 'Nyambung dari terminal LOAD− SCC ke input IN− XL4015 merah.',
      category: 'buck12v',
      radius: 0.0034,
      baseColor: 0x1d2026,
      highlightHex: 0xfb923c,
      points: [
        sccLoadN,
        drop(sccLoadN, -0.026, 0.002),
        [-0.035, 0.740, 0.068],
        [-0.265, 0.700, 0.105],
        [xlInN[0] - 0.016, xlInN[1] + 0.010, xlInN[2]],
        xlInN
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

    // --- E. COMMON GROUND ON BREADBOARD: ONLY THOSE 3 WIRES (XL4015 OUT−, Servo Cokelat, ESP32 GND)! ---
    {
      id: 'gnd-xl-bb',
      fromPin: 'XL4015 OUT−',
      toPin: 'Breadboard Common GND',
      fromPinId: 'xl-out-n',
      toPinId: 'bb-gnd-xl',
      voltage: '0V Common GND',
      description: 'Nyambung dari XL4015 OUT− ke Common GND Breadboard (disatukan dengan Servo & ESP32).',
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
      description: 'Nyambung dari kabel cokelat Servo MG996R ke Common GND Breadboard (disatukan dengan XL4015 OUT− & ESP32).',
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
      description: 'Nyambung dari pin GND ESP32 ke Common GND Breadboard supaya sinyal PWM ke servo terbaca benar.',
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

    // --- I. USB5V TYPE-C POWER CABLE PLUGGED INTO GOOUUU V4 USB5V PORT (NodeMCU Micro-USB currently unplugged) ---
    {
      id: 'usb-goouuu-5v',
      fromPin: 'GOOUUU V4 USB5V (Type-C)',
      toPin: 'Adaptor / Power USB-C 5V',
      fromPinId: 'esp-goouuu-usbc',
      toPinId: 'usbc-host',
      voltage: '5V USB-C',
      description: 'Nyambung dari port USB5V (Type-C) papan ekspansi GOOUUU V4 ke adaptor atau power bank USB-C 5V untuk suplai daya papan ekspansi & ESP32.',
      category: 'usb',
      radius: 0.0031,
      baseColor: 0x2a303b,
      highlightHex: 0x38bdf8,
      points: [
        [BOARD_ORIGINS.esp.x + 0.094, BOARD_ORIGINS.esp.y + 0.0054, BOARD_ORIGINS.esp.z + 0.022],
        [0.244, 0.625, 0.155],
        [0.252, 0.590, 0.196],
        [0.268, 0.300, 0.218],
        [0.285, 0.025, 0.242]
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
      voltage: '0V Common GND', wireIds: ['gnd-esp-bb', 'gnd-xl-bb', 'gnd-servo-bb'],
      connectedTo: ['Breadboard Common GND'],
      detail: 'Nyambung ke Common GND Breadboard bersama XL4015 OUT− & Servo MG996R.'
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
      color: '#38bdf8', status: 'AKTIF', voltage: '5V USB-C', wireIds: ['usb-goouuu-5v'],
      connectedTo: ['Adaptor / Power USB-C 5V'],
      detail: 'Nyambung ke kabel USB Type-C untuk suplai daya 5V papan ekspansi GOOUUU V4.'
    },

    // --- Breadboard Common Ground (ONLY 3 SLOTS: XL4015 OUT−, Servo MG996R, ESP32) ---
    {
      id: 'bb-gnd-xl', board: 'Breadboard Common GND', pinName: 'Slot 1 (XL4015)',
      pos: getBreadboardGndPinPos(0).world, color: '#00d4ff', status: 'AKTIF',
      voltage: '0V Common GND', wireIds: ['gnd-xl-bb'],
      connectedTo: ['XL4015 OUT−'],
      detail: 'Nyambung ke XL4015 OUT− (salah satu dari 3 kabel Common GND).'
    },
    {
      id: 'bb-gnd-srv', board: 'Breadboard Common GND', pinName: 'Slot 2 (Servo)',
      pos: getBreadboardGndPinPos(1).world, color: '#00d4ff', status: 'AKTIF',
      voltage: '0V Common GND', wireIds: ['gnd-servo-bb'],
      connectedTo: ['Servo Cokelat (GND)'],
      detail: 'Nyambung ke kabel cokelat Servo MG996R (salah satu dari 3 kabel Common GND).'
    },
    {
      id: 'bb-gnd-esp', board: 'Breadboard Common GND', pinName: 'Slot 3 (ESP32)',
      pos: getBreadboardGndPinPos(2).world, color: '#00d4ff', status: 'AKTIF',
      voltage: '0V Common GND', wireIds: ['gnd-esp-bb'],
      connectedTo: ['ESP32 GND'],
      detail: 'Nyambung ke GND ESP32 (salah satu dari 3 kabel Common GND).'
    },

    // --- Red XL4015 CC/CV 5A Screw Terminals ---
    {
      id: 'xl-in-p', board: 'XL4015 Merah', pinName: 'IN+',
      pos: getXl4015PinPos('IN+').world, color: '#ff5722', status: 'AKTIF',
      voltage: '12V DC', wireIds: ['scc-xl-load-pos'],
      connectedTo: ['SCC LOAD+ (12V)'],
      detail: 'Nyambung dari SCC LOAD+ (12V) masuk ke XL4015.'
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
      detail: 'Nyambung ke Common GND Breadboard (satu jalur dengan Servo & ESP32).'
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
      voltage: '12V DC', wireIds: ['scc-xl-load-pos'],
      connectedTo: ['XL4015 IN+'], detail: 'Nyambung ke IN+ XL4015 merah (12V).'
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
  const p18 = getGoouuuPinPos('rear', 8, 'S').world;
  const pBb = getBreadboardGndPinPos(1).world;
  const pRtc = getTinyRtcPinPos(3).world;
  const pLdr1 = getLdrPinPos(-1, 2).world;
  const pLdr2 = getLdrPinPos(1, 2).world;
  const pXlIn = getXl4015PinPos('IN+').world;
  const pXlOut = getXl4015PinPos('OUT+').world;
  const pScc = getSccTerminalPos(2).world;
  const pWatt = getWattMeterPinPos('SRC+').world;

  return [
    { id: 'pin-34-35',   label: 'LDR 1 & 2 → ESP32 (AO · 3.3V · GND)', pos: [p34[0] + 0.004, p34[1] - 0.003, p34[2] + 0.015], color: '#facc15', group: 'esp' },
    { id: 'pin-3v3',     label: 'JUMP 3.3V',                           pos: [BOARD_ORIGINS.esp.x + 0.053, BOARD_ORIGINS.esp.y + 0.020, BOARD_ORIGINS.esp.z + 0.028], color: '#c8d828', group: 'esp' },
    { id: 'pin-ports',   label: 'Port: DC6.5-16V · Micro-USB · USB5V Type-C', pos: [BOARD_ORIGINS.esp.x + 0.072, BOARD_ORIGINS.esp.y + 0.018, BOARD_ORIGINS.esp.z - 0.008], color: '#38bdf8', group: 'esp' },
    { id: 'pin-i2c',     label: 'Tiny RTC → ESP32 (21 · 22 · 3.3V · GND)', pos: [p22[0] - 0.008, p22[1] + 0.018, p22[2] - 0.008], color: '#2ecc71', group: 'esp' },
    { id: 'pin-18',      label: 'GPIO18 → Servo Oranye (PWM)',         pos: [p18[0] + 0.026, p18[1] + 0.028, p18[2] - 0.006], color: '#ff9f0a', group: 'esp' },
    { id: 'pin-rtc-i2c', label: 'Tiny RTC: SCL·SDA·VCC·GND',           pos: [pRtc[0] + 0.018, pRtc[1] + 0.022, pRtc[2] - 0.010], color: '#38bdf8', group: 'esp' },
    { id: 'pin-bb-gnd',  label: 'Common GND (3 Kabel: XL4015 · Servo · ESP32)', pos: [pBb[0], pBb[1] + 0.028, pBb[2] - 0.008], color: '#00d4ff', group: 'breadboard' },
    { id: 'pin-xl-in',   label: 'XL4015 IN+/IN− (12V SCC)',            pos: [pXlIn[0] - 0.008, pXlIn[1] + 0.024, pXlIn[2] - 0.010], color: '#ff5722', group: 'xl4015' },
    { id: 'pin-xl-out',  label: 'XL4015 OUT+ 6V · OUT− GND',           pos: [pXlOut[0] + 0.008, pXlOut[1] + 0.024, pXlOut[2] + 0.012], color: '#ff69b4', group: 'xl4015' },
    { id: 'pin-ldr1',    label: 'LDR 1 → ESP32 (DO kosong)',           pos: [pLdr1[0] - 0.008, pLdr1[1] + 0.008, pLdr1[2] + 0.010], color: '#facc15', group: 'ldr' },
    { id: 'pin-ldr2',    label: 'LDR 2 → ESP32 (DO kosong)',           pos: [pLdr2[0] + 0.008, pLdr2[1] + 0.008, pLdr2[2] + 0.010], color: '#c084fc', group: 'ldr' },
    { id: 'pin-watt',    label: 'Watt Meter: Panel → SCC',             pos: [pWatt[0] + 0.074, pWatt[1] + 0.048, pWatt[2] + 0.022], color: '#38bdf8', group: 'watt_scc' },
    { id: 'pin-scc-trm', label: 'SCC: +PV− · +BAT− · +LOAD−',          pos: [pScc[0] + 0.015, pScc[1] - 0.016, pScc[2] + 0.016], color: '#ff5722', group: 'watt_scc' }
  ];
}
