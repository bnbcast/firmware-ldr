import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEG2RAD,
  servoDegToPanelTiltRad,
  servoDegToPanelRollRad,
  servoDegToHornRad,
  computePushrodGeometry,
  lightArcToWorldPos,
  worldPosToLightArc,
  computeElectricalEstimate
} from './docs/rig3d-math.js';

test('servoDegToPanelTiltRad maps 90° to flat horizontal (0 rad), 15° to +68° left, and 165° to -68° right', () => {
  assert.equal(servoDegToPanelTiltRad(90, 0, false), 0);
  assert.equal(servoDegToPanelRollRad(90, 0, false), 0);
  assert.ok(Math.abs(servoDegToPanelTiltRad(15, 0, false) - 68 * DEG2RAD) < 1e-6);
  assert.ok(Math.abs(servoDegToPanelTiltRad(165, 0, false) - (-68 * DEG2RAD)) < 1e-6);
  // Invert flips direction
  assert.ok(Math.abs(servoDegToPanelTiltRad(15, 0, true) - (-68 * DEG2RAD)) < 1e-6);
});

test('servoDegToHornRad clamps safely within physical MG996R servo limits (±72°)', () => {
  assert.equal(servoDegToHornRad(90, 0, false), 0);
  assert.ok(Math.abs(servoDegToHornRad(15, 0, false) - 72 * DEG2RAD) < 1e-6);
  assert.ok(Math.abs(servoDegToHornRad(165, 0, false) - (-72 * DEG2RAD)) < 1e-6);
  assert.ok(Math.abs(servoDegToHornRad(0, 0, false) - 72 * DEG2RAD) < 1e-6);
  assert.ok(Math.abs(servoDegToHornRad(200, 0, false) - (-72 * DEG2RAD)) < 1e-6);
});

test('computePushrodGeometry accurately links MG996R horn tip to rear + cross bracket across +Z (Watt Meter) <-> -Z (opposite) flip', () => {
  const hornOrigin = { x: 0.079, y: 1.425, z: -0.024 };
  const pivotOrigin = { x: 0, y: 1.58, z: 0 };
  const bracketAnchorLocal = { x: 0.080, y: 0.022, z: -0.125 };

  for (const deg of [15, 45, 90, 135, 165]) {
    const tilt = servoDegToPanelTiltRad(deg);
    const horn = servoDegToHornRad(deg);
    const geom = computePushrodGeometry({
      hornOrigin,
      hornLength: 0.052,
      hornAngleRad: horn,
      pivotOrigin,
      bracketAnchorLocal,
      panelTiltRad: tilt
    });

    assert.ok(geom.length > 0.08 && geom.length < 0.30, `Pushrod length out of expected range at ${deg}°: ${geom.length}`);
    const recomputedLen = Math.hypot(
      geom.panelAnchor.x - geom.hornTip.x,
      geom.panelAnchor.y - geom.hornTip.y,
      geom.panelAnchor.z - geom.hornTip.z
    );
    assert.ok(Math.abs(geom.length - recomputedLen) < 1e-9);
    const dirNorm = Math.hypot(geom.direction.x, geom.direction.y, geom.direction.z);
    assert.ok(Math.abs(dirNorm - 1) < 1e-9);
  }
});

test('lightArcToWorldPos and worldPosToLightArc preserve overhead Watt-Meter (+Z) / zenith / opposite (-Z) ordering', () => {
  const frontPos = lightArcToWorldPos(30, 55, 1.65, 1.42);
  const centerPos = lightArcToWorldPos(90, 55, 1.65, 1.42);
  const backPos = lightArcToWorldPos(150, 55, 1.65, 1.42);

  assert.ok(frontPos.z > 0.8, '30° should map to front / Watt Meter side (+Z)');
  assert.ok(Math.abs(centerPos.z) < 1e-6, '90° should map to zenith center (Z=0)');
  assert.ok(centerPos.y > frontPos.y, '90° zenith should sit higher than 30°');
  assert.ok(backPos.z < -0.8, '150° should map to opposite back side (-Z)');

  const backToFront = worldPosToLightArc(frontPos, 1.42);
  const backToRear = worldPosToLightArc(backPos, 1.42);
  assert.ok(backToFront.lightDeg < 60, `Expected front round-trip < 60°, got ${backToFront.lightDeg}`);
  assert.ok(backToRear.lightDeg > 120, `Expected rear round-trip > 120°, got ${backToRear.lightDeg}`);
});

test('computeElectricalEstimate reflects Lambert cosine alignment, night-park drop, and XL4015 6V output', () => {
  const brightStatus = {
    ldr1: { pct: 85 },
    ldr2: { pct: 85 },
    sun: { ok: true },
    park: { on: false },
    pwr: { sagMv: 0 },
    servo: { moving: true, pwm: true }
  };

  const leftLight = lightArcToWorldPos(30, 55, 1.65, 1.42);
  const alignedTilt = servoDegToPanelTiltRad(30);
  const misalignedTilt = servoDegToPanelTiltRad(150);

  const aligned = computeElectricalEstimate(brightStatus, alignedTilt, leftLight, 1.44);
  const misaligned = computeElectricalEstimate(brightStatus, misalignedTilt, leftLight, 1.44);

  assert.equal(aligned.estimated, true);
  assert.equal(aligned.charging, true);
  assert.ok(aligned.effPct > misaligned.effPct, `Aligned eff (${aligned.effPct}%) should beat misaligned (${misaligned.effPct}%)`);
  assert.ok(aligned.watts > misaligned.watts, `Aligned watts (${aligned.watts}W) should beat misaligned (${misaligned.watts}W)`);
  assert.ok(aligned.xl4015OutV > 5.8 && aligned.xl4015OutV < 6.15, `XL4015 output should regulate near 6V, got ${aligned.xl4015OutV}`);
  assert.equal(aligned.xl4015InV, aligned.batteryVoltage);
  assert.equal(aligned.ina219BusV, aligned.xl4015InV);
  assert.ok(aligned.ina219CurrentA > 0 && aligned.ina219CurrentA < 2.0, `INA219 input current should be positive 12V-side current, got ${aligned.ina219CurrentA}`);
  assert.ok(Math.abs(aligned.ina219ShuntMv - aligned.ina219CurrentA * 100) < 0.25, 'INA219 R100 (0.1Ω) shunt mV should equal I * 100');
  assert.ok(aligned.ina219PowerW > 0);
  assert.equal(aligned.servoActive, true);

  const parked = computeElectricalEstimate({ ...brightStatus, park: { on: true }, servo: { moving: false, pwm: false } }, 0, leftLight, 1.44);
  assert.equal(parked.charging, false);
  assert.ok(parked.watts < 1.0);
  assert.equal(parked.xl4015OutV, 6.02);
  assert.ok(parked.ina219CurrentA < aligned.ina219CurrentA, 'Idle INA219 current should drop below active servo current');

  assert.ok(aligned.upsInV > 4.9 && aligned.upsInV <= 5.2, `UPS USB-C IN should be ~5V, got ${aligned.upsInV}`);
  assert.ok(aligned.upsBattV >= 3.2 && aligned.upsBattV <= 4.25, `Dual 18650 parallel bank voltage out of range: ${aligned.upsBattV}`);
  assert.ok(aligned.upsOutV >= 4.95 && aligned.upsOutV <= 5.15, `UPS boost output to ESP32 should regulate near 5V: ${aligned.upsOutV}`);
  assert.ok(aligned.upsSocPct >= 0 && aligned.upsSocPct <= 100);
  assert.equal(typeof aligned.upsCharging, 'boolean');
});

import {
  RIG_DIMS,
  BOARD_ORIGINS,
  UPS_GEO,
  GOOUUU_FRONT_PINS,
  GOOUUU_REAR_PINS,
  GOOUUU_AUX_PINS,
  INA219_PINS,
  TINY_RTC_PINS,
  LM393_PINS,
  ACTIVE_DUPONT_PLUGS,
  WIRE_NET_META,
  getGoouuuPinPos,
  getGoouuuAuxPinPos,
  getGoouuuPwrPinPos,
  getUpsPadPos,
  getUpsSwitchPinPos,
  getBreadboardGndPinPos,
  getIna219PinPos,
  getIna219ScrewPos,
  getLdrPinPos,
  getTinyRtcPinPos,
  getXl4015PinPos,
  getSccTerminalPos,
  SERVO_PLUG_PINS,
  buildPinAccurateWireSpecs,
  buildClickablePinRegistry,
  buildMacroPinCallouts,
  HOTSPOT_WIRE_NET_MAP,
  computeSmartCameraOffset,
  computeWireFrameCamera
} from './docs/rig3d-wiring.js';

test('hardware pinout tables and front vertical stack match user physical rig (Watt Meter -> SCC -> Deck with Breadboard GND)', () => {
  assert.equal(GOOUUU_FRONT_PINS.length, 19);
  assert.equal(GOOUUU_REAR_PINS.length, 19);
  assert.equal(GOOUUU_FRONT_PINS[4], '34');
  assert.equal(GOOUUU_FRONT_PINS[5], '35');
  assert.equal(GOOUUU_REAR_PINS[2], '22');
  assert.equal(GOOUUU_REAR_PINS[5], '21');
  assert.equal(GOOUUU_REAR_PINS[8], '18');
  assert.deepEqual(GOOUUU_AUX_PINS, ['D22', 'D21', 'VCC', 'GND']);
  assert.deepEqual(INA219_PINS, ['VCC', 'GND', 'SCL', 'SDA', 'VIN-', 'VIN+']);
  assert.deepEqual(TINY_RTC_PINS, ['SQ', 'DS', 'SCL', 'SDA', 'VCC', 'GND', 'BAT']);
  assert.deepEqual(LM393_PINS, ['VCC', 'GND', 'DO', 'AO']);
  assert.ok(!ACTIVE_DUPONT_PLUGS.ldr1.some((p) => p.index === 2));
  assert.ok(!ACTIVE_DUPONT_PLUGS.ldr2.some((p) => p.index === 2));

  // Verify exact vertical stack on same front (+Z) side + vertical portrait panel (panelDepth > panelWidth)!
  assert.equal(RIG_DIMS.panelFrontPitchRad, 0, 'Panel sits level at 90° so it flips symmetrically toward Watt Meter (+Z) and opposite (-Z)');
  assert.ok(RIG_DIMS.panelDepth > RIG_DIMS.panelWidth, 'Solar panel must be in vertical portrait orientation (panelDepth > panelWidth)');
  assert.equal(BOARD_ORIGINS.watt.rotY, 0, 'Watt Meter must face front (+Z), same side as SCC');
  assert.equal(BOARD_ORIGINS.scc.rotY, 0, 'SCC must face front (+Z)');
  assert.ok(BOARD_ORIGINS.watt.z > 0 && BOARD_ORIGINS.scc.z > 0, 'Watt Meter and SCC both on +Z front side');
  assert.ok(RIG_DIMS.pivotPos.y > BOARD_ORIGINS.watt.y, 'Panel above Watt Meter');
  assert.ok(BOARD_ORIGINS.watt.y > BOARD_ORIGINS.scc.y, 'Watt Meter above Charge Controller');
  assert.ok(BOARD_ORIGINS.scc.y > RIG_DIMS.deckY, 'Charge Controller above Electronics Deck');
  assert.ok(BOARD_ORIGINS.ina219.x > BOARD_ORIGINS.ldr.x + 0.0825 && BOARD_ORIGINS.ina219.x < BOARD_ORIGINS.xl.x - 0.049, 'INA219 sits cleanly in gap between LDR baffle and XL4015');
  assert.equal(ACTIVE_DUPONT_PLUGS.breadboard.length, 4, 'Common GND on Breadboard contains 4 wires: XL4015 OUT−, Servo MG996R, ESP32 GND, INA219 GND');
  assert.equal(ACTIVE_DUPONT_PLUGS.ina219.length, 4);
  assert.equal(ACTIVE_DUPONT_PLUGS.goouuuAux.length, 3);
  assert.equal(ACTIVE_DUPONT_PLUGS.goouuuPwr.length, 2, 'GOOUUU V4 5V & GND plugs receive regulated 5V output from QF-M6001-2 UPS');
  assert.ok(BOARD_ORIGINS.ups.x > BOARD_ORIGINS.rtc.x, 'QF-M6001-2 UPS sits cleanly to the right of Tiny RTC');
  assert.equal(UPS_GEO.cellZOffsets.length, 2, 'QF-M6001-2 dual holder carries 2x parallel 18650 Li-Ion batteries');
  // Verify GOOUUU V4 outward row order matches physical Photos 2 & 3 (Black G inner -> Red V middle -> Yellow S outer)
  const gPos = getGoouuuPinPos('front', 4, 'G').local[2];
  const vPos = getGoouuuPinPos('front', 4, 'V').local[2];
  const sPos = getGoouuuPinPos('front', 4, 'S').local[2];
  assert.ok(gPos < vPos && vPos < sPos, 'GOOUUU V4 rows must order outward G (inner) < V (middle) < S (outer)');
});

test('buildPinAccurateWireSpecs and buildClickablePinRegistry cover every clickable wire and pin including INA219 & Breadboard Common GND', () => {
  const wires = buildPinAccurateWireSpecs();
  assert.ok(wires.length >= 27, `Expected >= 27 pin-to-pin wires, got ${wires.length}`);

  const ids = new Set();
  for (const w of wires) {
    assert.ok(!ids.has(w.id), `Duplicate wire id: ${w.id}`);
    ids.add(w.id);
    assert.ok(WIRE_NET_META[w.category], `Missing WIRE_NET_META for category ${w.category}`);
    assert.ok(w.fromPin && w.toPin && w.voltage && w.description, `Wire ${w.id} missing clickable metadata`);
    assert.ok(w.points.length >= 4, `Wire ${w.id} needs >= 4 control points`);
    for (const pt of w.points) {
      assert.equal(pt.length, 3);
      assert.ok(pt.every((n) => Number.isFinite(n)), `Non-finite point in ${w.id}`);
    }
    const start = w.points[0];
    const end = w.points[w.points.length - 1];
    const span = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    assert.ok(span > 0.03, `Wire ${w.id} span too tiny: ${span}`);
  }

  // Verify Breadboard Common GND has 4 wires: XL4015 OUT−, Servo MG996R (Cokelat), ESP32 GND, INA219 GND!
  const gndWires = wires.filter((w) => w.category === 'gnd');
  assert.equal(gndWires.length, 4, 'Expected 4 Common GND wires on Breadboard');
  const xlGndWire = wires.find((w) => w.id === 'gnd-xl-bb');
  const srvGndWire = wires.find((w) => w.id === 'gnd-servo-bb');
  const espGndWire = wires.find((w) => w.id === 'gnd-esp-bb');
  const inaGndWire = wires.find((w) => w.id === 'ina-gnd-bb');
  assert.deepEqual(xlGndWire.points[0], getXl4015PinPos('OUT-').world);
  assert.deepEqual(xlGndWire.points[xlGndWire.points.length - 1], getBreadboardGndPinPos(0).world);
  assert.deepEqual(srvGndWire.points[0], SERVO_PLUG_PINS.GND);
  assert.deepEqual(srvGndWire.points[srvGndWire.points.length - 1], getBreadboardGndPinPos(1).world);
  assert.deepEqual(espGndWire.points[espGndWire.points.length - 1], getBreadboardGndPinPos(2).world);
  assert.deepEqual(inaGndWire.points[0], getIna219PinPos(1).world);
  assert.deepEqual(inaGndWire.points[inaGndWire.points.length - 1], getBreadboardGndPinPos(3).world);

  // Verify exact INA219 high-side shunt (SCC LOAD+ -> INA219 VIN+ -> INA219 VIN- -> XL4015 IN+) and I2C/3.3V wiring!
  const sccInaWire = wires.find((w) => w.id === 'scc-ina-load-pos');
  const inaXlWire = wires.find((w) => w.id === 'ina-xl-in-pos');
  const inaVccWire = wires.find((w) => w.id === 'ina-vcc-3v3');
  const inaSclWire = wires.find((w) => w.id === 'ina-scl-22');
  const inaSdaWire = wires.find((w) => w.id === 'ina-sda-21');
  assert.deepEqual(sccInaWire.points[0], getSccTerminalPos(4).world);
  assert.deepEqual(sccInaWire.points[sccInaWire.points.length - 1], getIna219ScrewPos('VIN+').world);
  assert.deepEqual(inaXlWire.points[0], getIna219ScrewPos('VIN-').world);
  assert.deepEqual(inaXlWire.points[inaXlWire.points.length - 1], getXl4015PinPos('IN+').world);
  assert.deepEqual(inaVccWire.points[0], getGoouuuAuxPinPos('VCC').world);
  assert.deepEqual(inaVccWire.points[inaVccWire.points.length - 1], getIna219PinPos(0).world);
  assert.deepEqual(inaSclWire.points[0], getGoouuuAuxPinPos('D22').world);
  assert.deepEqual(inaSclWire.points[inaSclWire.points.length - 1], getIna219PinPos(2).world);
  assert.deepEqual(inaSdaWire.points[0], getGoouuuAuxPinPos('D21').world);
  assert.deepEqual(inaSdaWire.points[inaSdaWire.points.length - 1], getIna219PinPos(3).world);

  // Verify LDR1, LDR2, and Tiny RTC GND connect directly to GOOUUU ESP32 Row G (NOT Breadboard!)
  const ldr1GndWire = wires.find((w) => w.id === 'ldr1-gnd-esp');
  const ldr2GndWire = wires.find((w) => w.id === 'ldr2-gnd-esp');
  const rtcGndWire  = wires.find((w) => w.id === 'i2c-rtc-gnd');
  assert.deepEqual(ldr1GndWire.points[0], getGoouuuPinPos('front', 4, 'G').world);
  assert.deepEqual(ldr1GndWire.points[ldr1GndWire.points.length - 1], getLdrPinPos(-1, 1).world);
  assert.deepEqual(ldr2GndWire.points[0], getGoouuuPinPos('front', 5, 'G').world);
  assert.deepEqual(ldr2GndWire.points[ldr2GndWire.points.length - 1], getLdrPinPos(1, 1).world);
  assert.deepEqual(rtcGndWire.points[0], getGoouuuPinPos('rear', 5, 'G').world);
  assert.deepEqual(rtcGndWire.points[rtcGndWire.points.length - 1], getTinyRtcPinPos(5).world);

  // Spot-check exact pin endpoint anchoring
  const ldr1Wire = wires.find((w) => w.id === 'ldr1-ao-34');
  assert.deepEqual(ldr1Wire.points[0], getGoouuuPinPos('front', 4, 'S').world);
  assert.deepEqual(ldr1Wire.points[ldr1Wire.points.length - 1], getLdrPinPos(-1, 3).world);

  const sdaWire = wires.find((w) => w.id === 'i2c-sda-21');
  assert.deepEqual(sdaWire.points[0], getGoouuuPinPos('rear', 5, 'S').world);
  assert.deepEqual(sdaWire.points[sdaWire.points.length - 1], getTinyRtcPinPos(3).world);

  // Verify QF-M6001-2 UPS 5V -> Inline Safety Switch (I/O) -> GOOUUU V4 5V/GND power wiring & empty USB-C receptacle
  const upsUsbInWire = wires.find((w) => w.id === 'usb-ups-5v-in');
  const upsSwInWire = wires.find((w) => w.id === 'ups-sw-in');
  const swEsp5vWire = wires.find((w) => w.id === 'sw-esp-5v');
  const upsEspGndWire = wires.find((w) => w.id === 'ups-esp-gnd');
  assert.ok(upsUsbInWire, 'UPS USB-C 5V IN cable must exist');
  assert.ok(BOARD_ORIGINS.upsSwitch, 'Inline 5V safety switch origin must exist');
  assert.deepEqual(upsSwInWire.points[0], getUpsPadPos('UPS+').world);
  assert.deepEqual(upsSwInWire.points[upsSwInWire.points.length - 1], getUpsSwitchPinPos('IN').world);
  assert.deepEqual(swEsp5vWire.points[0], getUpsSwitchPinPos('OUT').world);
  assert.deepEqual(swEsp5vWire.points[swEsp5vWire.points.length - 1], getGoouuuPwrPinPos('5V').world);
  assert.deepEqual(upsEspGndWire.points[0], getUpsPadPos('UPS-').world);
  assert.deepEqual(upsEspGndWire.points[upsEspGndWire.points.length - 1], getGoouuuPwrPinPos('GND').world);

  // Verify clickable pin registry covers every board, Breadboard slots, Red XL4015 terminals, and bare gold unused pins
  const pins = buildClickablePinRegistry();
  assert.ok(pins.length >= 45, `Expected >= 45 clickable pins, got ${pins.length}`);
  const pinIds = new Set();
  for (const p of pins) {
    assert.ok(!pinIds.has(p.id), `Duplicate pin id: ${p.id}`);
    pinIds.add(p.id);
    assert.equal(p.pos.length, 3);
    assert.ok(p.pos.every((n) => Number.isFinite(n)));
    for (const wid of p.wireIds) {
      assert.ok(ids.has(wid), `Pin ${p.id} references unknown wireId ${wid}`);
    }
  }
  assert.equal(pins.find((p) => p.id === 'ldr1-do')?.status, 'KOSONG');
  assert.equal(pins.find((p) => p.id === 'bb-gnd-xl')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'bb-gnd-srv')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'bb-gnd-esp')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'bb-gnd-ina')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ina-vin-p-term')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ina-vin-n-term')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ina-vcc')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ina-gnd')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ina-scl')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ina-sda')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ina-vin-p-hdr')?.status, 'KOSONG');
  assert.deepEqual(pins.find((p) => p.id === 'ldr1-gnd')?.wireIds, ['ldr1-gnd-esp']);
  assert.ok(pins.find((p) => p.id === 'esp-dc-jack'), 'GOOUUU V4 DC6.5-16V barrel jack must be clickable');
  assert.ok(pins.find((p) => p.id === 'esp-goouuu-microusb'), 'GOOUUU V4 Micro-USB port must be clickable');
  assert.equal(pins.find((p) => p.id === 'esp-goouuu-usbc')?.status, 'KOSONG', 'GOOUUU V4 USB5V Type-C stays open while UPS powers 5V/GND');
  assert.equal(pins.find((p) => p.id === 'esp-pwr-5v')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'esp-pwr-gnd')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'sw-ups-in')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'sw-ups-out')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ups-out-p')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ups-out-n')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ups-in-usbc')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ups-bat-1')?.status, 'AKTIF');
  assert.equal(pins.find((p) => p.id === 'ups-bat-2')?.status, 'AKTIF');

  const callouts = buildMacroPinCallouts();
  assert.ok(callouts.length >= 16);
  assert.ok(callouts.some((c) => c.group === 'ina219'), 'Macro callouts must include INA219 group');
  assert.ok(callouts.some((c) => c.group === 'ups'), 'Macro callouts must include QF-M6001-2 UPS group');
  assert.ok(callouts.some((c) => c.id === 'pin-ups-sw'), 'Macro callouts must include inline 5V safety switch');
});

test('HOTSPOT_WIRE_NET_MAP, computeSmartCameraOffset, and computeWireFrameCamera provide valid camera framing and net mappings', () => {
  const expectedHotspots = [
    'panel', 'wattmeter', 'scc', 'ina219', 'xl4015',
    'breadboard', 'esp32', 'rtc', 'ups_switch', 'ups',
    'ldr', 'servo', 'battery'
  ];
  for (const hs of expectedHotspots) {
    const nets = HOTSPOT_WIRE_NET_MAP[hs];
    assert.ok(Array.isArray(nets) && nets.length >= 1, `Hotspot ${hs} must map to >= 1 wire net`);
    for (const nk of nets) {
      assert.ok(WIRE_NET_META[nk], `Hotspot ${hs} references unknown net ${nk}`);
    }
  }

  // Unobstructed smart offsets across floor battery, rear servo, front mast, rear deck, and front deck
  const offBat = computeSmartCameraOffset([-0.15, 0.30, -0.05]);
  const offServo = computeSmartCameraOffset([0.05, 1.32, -0.03]);
  const offWatt = computeSmartCameraOffset([0.02, 1.00, 0.06]);
  const offDeckRear = computeSmartCameraOffset([0.34, 0.63, 0.07]);
  const offDeckFront = computeSmartCameraOffset([0.16, 0.63, 0.14]);
  assert.ok(offServo[2] < 0, 'Rear upper servo should frame from -Z behind the mast');
  assert.ok(offWatt[2] > 0 && offDeckFront[2] > 0, 'Front mast and front deck should frame from +Z');
  for (const off of [offBat, offServo, offWatt, offDeckRear, offDeckFront]) {
    assert.equal(off.length, 3);
    assert.ok(off.every((n) => Number.isFinite(n)));
    assert.ok(off[1] > 0, 'Camera offset should stay slightly elevated above the target pin');
  }

  // Wire framing covers every wire spec cleanly
  const wires = buildPinAccurateWireSpecs();
  assert.equal(wires.length, 32, 'Expected 32 total pin-accurate wires matching sidebar count');
  for (const w of wires) {
    const framed = computeWireFrameCamera(w.points);
    assert.equal(framed.pos.length, 3);
    assert.equal(framed.target.length, 3);
    assert.ok(framed.pos.every((n) => Number.isFinite(n)));
    assert.ok(framed.target.every((n) => Number.isFinite(n)));
    const dist = Math.hypot(
      framed.pos[0] - framed.target[0],
      framed.pos[1] - framed.target[1],
      framed.pos[2] - framed.target[2]
    );
    assert.ok(dist >= 0.27 && dist <= 2.3, `Wire ${w.id} frame distance out of expected range: ${dist}`);
  }
});

import {
  MIN_BUILD_STAGE,
  FULL_BUILD_STAGE,
  BUILD_STAGES,
  clampBuildStage,
  getBuildStageMeta,
  isHotspotVisibleAtStage,
  isPresetVisibleAtStage,
  isWireNetVisibleAtStage,
  createStageHistoryState,
  checkoutStageInHistory,
  undoStageInHistory,
  redoStageInHistory
} from './docs/rig3d-stages.js';
import {
  buildAllStageWireSpecs,
  getWireNetMetaForStage,
  getHotspotWireNetsForStage
} from './docs/rig3d-wiring.js';

test('BUILD_STAGES defines 5 ordered commits c1..c5 and c2 preserves XL4015 6V bench safety checklist', () => {
  assert.equal(MIN_BUILD_STAGE, 1);
  assert.equal(FULL_BUILD_STAGE, 5);
  assert.equal(BUILD_STAGES.length, 5);
  assert.deepEqual(BUILD_STAGES.map((s) => s.code), ['c1', 'c2', 'c3', 'c4', 'c5']);
  assert.deepEqual(BUILD_STAGES.map((s) => s.id), ['rig_base', 'xl4015', 'ina219', 'ups', 'ups_switch']);

  assert.equal(clampBuildStage(0), 1);
  assert.equal(clampBuildStage(99), 5);
  assert.equal(clampBuildStage('bad'), 5);

  const c2 = getBuildStageMeta(2);
  assert.equal(c2.code, 'c2');
  assert.equal(c2.safetySteps.length, 7, 'Stage c2 must preserve all 7 calibration steps');
  assert.ok(c2.safetyWarning.includes('6 V') && c2.safetyWarning.includes('3V3') && c2.safetyWarning.includes('5V'));
  assert.ok(c2.wiringRows.some((r) => r.from.includes('MG996R kabel cokelat') && r.to.includes('Common GND')));
});

test('Git-style stage history supports checkout, undo, redo, branch truncation, and boundary no-ops', () => {
  let hist = createStageHistoryState(5);
  assert.equal(hist.currentStage, 5);
  assert.deepEqual(hist.undoStack, []);
  assert.deepEqual(hist.redoStack, []);

  // Boundary no-ops
  const noopUndo = undoStageInHistory(hist);
  assert.equal(noopUndo.changed, false);
  const noopSame = checkoutStageInHistory(hist, 5);
  assert.equal(noopSame.changed, false);

  // Checkout c5 -> c2 -> c3
  hist = checkoutStageInHistory(hist, 2);
  assert.equal(hist.changed, true);
  assert.equal(hist.currentStage, 2);
  assert.deepEqual(hist.undoStack, [5]);
  assert.deepEqual(hist.redoStack, []);

  hist = checkoutStageInHistory(hist, 3);
  assert.equal(hist.currentStage, 3);
  assert.deepEqual(hist.undoStack, [5, 2]);

  // Undo c3 -> c2 -> c5
  hist = undoStageInHistory(hist);
  assert.equal(hist.changed, true);
  assert.equal(hist.currentStage, 2);
  assert.deepEqual(hist.undoStack, [5]);
  assert.deepEqual(hist.redoStack, [3]);

  hist = undoStageInHistory(hist);
  assert.equal(hist.currentStage, 5);
  assert.deepEqual(hist.undoStack, []);
  assert.deepEqual(hist.redoStack, [3, 2]);

  // Redo c5 -> c2, then checkout c1 clears redoStack
  hist = redoStageInHistory(hist);
  assert.equal(hist.changed, true);
  assert.equal(hist.currentStage, 2);
  assert.deepEqual(hist.redoStack, [3]);

  hist = checkoutStageInHistory(hist, 1);
  assert.equal(hist.currentStage, 1);
  assert.deepEqual(hist.undoStack, [5, 2]);
  assert.deepEqual(hist.redoStack, []);

  const noopRedo = redoStageInHistory(hist);
  assert.equal(noopRedo.changed, false);
});

test('Stage-aware wire specs transition accurately across c1..c5 (including pre-INA219 XL4015 and pre-Switch UPS bypass jumpers)', () => {
  assert.equal(buildAllStageWireSpecs().length, 34, 'Master list holds 32 final wires + 2 pre-module direct jumpers');

  const w1 = buildPinAccurateWireSpecs(1);
  const w2 = buildPinAccurateWireSpecs(2);
  const w3 = buildPinAccurateWireSpecs(3);
  const w4 = buildPinAccurateWireSpecs(4);
  const w5 = buildPinAccurateWireSpecs(5);

  assert.equal(w1.length, 16, 'c1 base rig has 16 wires');
  assert.equal(w2.length, 23, 'c2 pre-INA219 XL4015 + Servo + 3 Common GND has 23 wires');
  assert.equal(w3.length, 28, 'c3 adds INA219 (+6 new, replaces direct scc-xl-load-pos) = 28 wires');
  assert.equal(w4.length, 31, 'c4 adds UPS 5V + direct UPS+->5V = 31 wires');
  assert.equal(w5.length, 32, 'c5 splits UPS+->5V through KCD11 Switch = 32 wires');

  const ids2 = new Set(w2.map((w) => w.id));
  assert.ok(ids2.has('scc-xl-load-pos'), 'c2 must use direct SCC LOAD+ -> XL4015 IN+');
  assert.ok(ids2.has('scc-xl-load-neg'));
  assert.ok(ids2.has('xl-servo-6v'));
  assert.ok(ids2.has('pwm-esp18-servo'));
  assert.equal(w2.filter((w) => w.category === 'gnd').length, 3, 'c2 has 3 Common GND wires');
  assert.ok(!ids2.has('scc-ina-load-pos') && !ids2.has('ina-xl-in-pos') && !ids2.has('ina-gnd-bb'));
  assert.ok(!ids2.has('ups-esp-5v-direct') && !ids2.has('ups-sw-in') && !ids2.has('sw-esp-5v'));

  const ids3 = new Set(w3.map((w) => w.id));
  assert.ok(!ids3.has('scc-xl-load-pos'), 'c3 replaces direct SCC->XL4015 jumper with INA219 shunt pair');
  assert.ok(ids3.has('scc-ina-load-pos') && ids3.has('ina-xl-in-pos'));
  assert.equal(w3.filter((w) => w.category === 'gnd').length, 4, 'c3 adds 4th Common GND wire from INA219');

  const ids4 = new Set(w4.map((w) => w.id));
  assert.ok(ids4.has('ups-esp-5v-direct'), 'c4 uses direct UPS+ -> ESP32 5V before Switch c5');
  assert.ok(ids4.has('usb-ups-5v-in') && ids4.has('ups-esp-gnd'));
  assert.ok(!ids4.has('ups-sw-in') && !ids4.has('sw-esp-5v'));

  const ids5 = new Set(w5.map((w) => w.id));
  assert.ok(!ids5.has('ups-esp-5v-direct'), 'c5 splits direct jumper via Switch 5V');
  assert.ok(ids5.has('ups-sw-in') && ids5.has('sw-esp-5v'));
});

test('Stage visibility predicates, wire net metadata, pins, and callouts hide unconnected modules accurately', () => {
  // Hotspots & presets
  assert.equal(isHotspotVisibleAtStage('xl4015', 1), false);
  assert.equal(isHotspotVisibleAtStage('xl4015', 2), true);
  assert.equal(isHotspotVisibleAtStage('ina219', 2), false);
  assert.equal(isHotspotVisibleAtStage('ina219', 3), true);
  assert.equal(isHotspotVisibleAtStage('ups', 3), false);
  assert.equal(isHotspotVisibleAtStage('ups', 4), true);
  assert.equal(isHotspotVisibleAtStage('ups_switch', 4), false);
  assert.equal(isHotspotVisibleAtStage('ups_switch', 5), true);

  assert.equal(isPresetVisibleAtStage('ina219', 2), false);
  assert.equal(isPresetVisibleAtStage('xl4015', 2), true);
  assert.equal(isWireNetVisibleAtStage('ina219', 2), false);
  assert.equal(isWireNetVisibleAtStage('buck12v', 2), true);
  assert.equal(isWireNetVisibleAtStage('usb', 3), false);
  assert.equal(isWireNetVisibleAtStage('usb', 4), true);

  assert.deepEqual(getHotspotWireNetsForStage('esp32', 1), ['i2c', 'ldr']);
  assert.deepEqual(getHotspotWireNetsForStage('xl4015', 2), ['buck12v', 'servo6v', 'gnd']);

  // Stage-aware net labels
  assert.equal(getWireNetMetaForStage('gnd', 2).label, 'Common GND (3 Kabel)');
  assert.equal(getWireNetMetaForStage('buck12v', 2).label, 'SCC LOAD 12V → XL4015');
  assert.equal(getWireNetMetaForStage('usb', 4).label, 'UPS 5V → ESP32 (Tanpa Switch)');
  assert.equal(getWireNetMetaForStage('gnd', 5).label, 'Common GND (4 Kabel)');

  // Pins at c2
  const pins2 = buildClickablePinRegistry(2);
  assert.equal(pins2.find((p) => p.id === 'ina-vcc').stageVisible, false);
  assert.equal(pins2.find((p) => p.id === 'ups-out-p').stageVisible, false);
  assert.equal(pins2.find((p) => p.id === 'sw-ups-in').stageVisible, false);
  assert.equal(pins2.find((p) => p.id === 'xl-in-p').stageVisible, true);
  assert.deepEqual(pins2.find((p) => p.id === 'xl-in-p').wireIds, ['scc-xl-load-pos']);
  assert.equal(pins2.find((p) => p.id === 'esp-usb').status, 'AKTIF');
  assert.equal(pins2.find((p) => p.id === 'esp-pwr-5v').status, 'KOSONG');
  assert.equal(pins2.find((p) => p.id === 'bb-gnd-ina').status, 'KOSONG');
  assert.deepEqual(pins2.find((p) => p.id === 'esp-gnd-bb').wireIds, ['gnd-esp-bb', 'gnd-xl-bb', 'gnd-servo-bb']);

  // Pins at c4
  const pins4 = buildClickablePinRegistry(4);
  assert.equal(pins4.find((p) => p.id === 'esp-pwr-5v').status, 'AKTIF');
  assert.deepEqual(pins4.find((p) => p.id === 'esp-pwr-5v').wireIds, ['ups-esp-5v-direct']);
  assert.equal(pins4.find((p) => p.id === 'sw-ups-in').stageVisible, false);

  // Callouts at c2 vs c5
  const callouts2 = buildMacroPinCallouts(2);
  assert.ok(!callouts2.some((c) => c.group === 'ina219'));
  assert.ok(!callouts2.some((c) => c.group === 'ups'));
  assert.ok(callouts2.find((c) => c.id === 'pin-bb-gnd').label.includes('3 Kabel'));
  assert.ok(callouts2.find((c) => c.id === 'pin-xl-in').label.includes('SCC LOAD+'));
});

test('Exhaustive verification across all 5 stages (c1..c5): endpoints, bidirectional wireIds, spline clearance, pin text, and DuPont plugs', () => {
  const externalOrigins = new Set(['panel-pos', 'panel-neg', 'usbc-host']);
  const deckMinX = -0.005 - 1.045 / 2;
  const deckMaxX = -0.005 + 1.045 / 2;
  const deckMinZ = RIG_DIMS.deckZ + 0.008 - 0.168 / 2;
  const deckMaxZ = RIG_DIMS.deckZ + 0.008 + 0.168 / 2;
  const deckTopY = RIG_DIMS.deckY + 0.006;

  // Verify every master spline stays above ground and never clips through the electronics deck plate
  for (const wire of buildAllStageWireSpecs()) {
    for (let i = 0; i < wire.points.length; i++) {
      const pt = wire.points[i];
      assert.ok(pt[1] >= 0, `Wire ${wire.id} point ${i} below ground: ${pt[1]}`);
      const inDeckFootprint = pt[0] >= deckMinX && pt[0] <= deckMaxX && pt[2] >= deckMinZ && pt[2] <= deckMaxZ;
      if (i > 0 && i < wire.points.length - 1 && inDeckFootprint) {
        assert.ok(pt[1] >= deckTopY, `Wire ${wire.id} interior point ${i} (${pt.join(',')}) clips below deck top y=${deckTopY}`);
      }
    }
  }

  const expectedPlugsByStage = {
    1: { goouuu: 10, goouuuAux: 0, goouuuPwr: 0, breadboard: 0, ina219: 0, rtc: 4, ldr1: 3, ldr2: 3 },
    2: { goouuu: 12, goouuuAux: 0, goouuuPwr: 0, breadboard: 3, ina219: 0, rtc: 4, ldr1: 3, ldr2: 3 },
    3: { goouuu: 12, goouuuAux: 3, goouuuPwr: 0, breadboard: 4, ina219: 4, rtc: 4, ldr1: 3, ldr2: 3 },
    4: { goouuu: 12, goouuuAux: 3, goouuuPwr: 2, breadboard: 4, ina219: 4, rtc: 4, ldr1: 3, ldr2: 3 },
    5: { goouuu: 12, goouuuAux: 3, goouuuPwr: 2, breadboard: 4, ina219: 4, rtc: 4, ldr1: 3, ldr2: 3 }
  };

  for (let s = 1; s <= 5; s++) {
    const wires = buildPinAccurateWireSpecs(s);
    const pins = buildClickablePinRegistry(s);
    const pinById = new Map(pins.map((p) => [p.id, p]));
    const wireById = new Map(wires.map((w) => [w.id, w]));

    for (const w of wires) {
      const checkEndpoint = (pinId, pt, side) => {
        if (externalOrigins.has(pinId)) return;
        const pin = pinById.get(pinId);
        assert.ok(pin, `Stage c${s} wire ${w.id} ${side} pin ${pinId} missing`);
        assert.equal(pin.stageVisible, true, `Stage c${s} wire ${w.id} ${side} pin ${pinId} must be visible`);
        const dist = Math.hypot(pin.pos[0] - pt[0], pin.pos[1] - pt[1], pin.pos[2] - pt[2]);
        assert.ok(dist < 0.002, `Stage c${s} wire ${w.id} ${side} endpoint distance=${dist}`);
        assert.ok(pin.wireIds.includes(w.id), `Stage c${s} pin ${pinId} missing backref to ${w.id}`);
      };
      checkEndpoint(w.fromPinId, w.points[0], 'from');
      checkEndpoint(w.toPinId, w.points[w.points.length - 1], 'to');
    }

    for (const p of pins) {
      for (const wid of p.wireIds) {
        assert.ok(wireById.has(wid), `Stage c${s} pin ${p.id} references inactive/missing wire ${wid}`);
      }
      if (!p.stageVisible) {
        assert.equal(p.wireIds.length, 0, `Stage c${s} hidden pin ${p.id} must have 0 wireIds`);
      } else if (p.status === 'KOSONG') {
        assert.equal(p.wireIds.length, 0, `Stage c${s} KOSONG pin ${p.id} must have 0 wireIds`);
      } else if (p.status === 'AKTIF' && p.id !== 'esp-usb') {
        assert.ok(p.wireIds.length >= 1, `Stage c${s} AKTIF pin ${p.id} missing wireIds`);
      }
    }

    // Verify no future-stage module terminology leaks into earlier visible pins
    if (s < 3) {
      if (pinById.get('xl-out-n').stageVisible) {
        assert.ok(!pinById.get('xl-out-n').detail.includes('INA219'));
      }
      assert.ok(!pinById.get('esp-aux-gnd').connectedTo[0].includes('Breadboard'));
    }
    if (s === 4) {
      for (const pid of ['esp-usb', 'esp-pwr-5v', 'ups-out-p']) {
        const txt = [pinById.get(pid).pinName, ...pinById.get(pid).connectedTo, pinById.get(pid).detail].join(' ');
        assert.ok(!txt.includes('Switch'), `Stage c4 pin ${pid} should not reference future Switch: ${txt}`);
      }
    }

    // Verify DuPont plug counts match active stage hardware
    const plugCounts = {};
    for (const [grp, list] of Object.entries(ACTIVE_DUPONT_PLUGS)) {
      plugCounts[grp] = list.filter((plug) => (plug.minStage ?? 1) <= s).length;
    }
    assert.deepEqual(plugCounts, expectedPlugsByStage[s], `DuPont plug mismatch at stage c${s}`);
  }
});
