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
  assert.equal(aligned.servoActive, true);

  const parked = computeElectricalEstimate({ ...brightStatus, park: { on: true }, servo: { moving: false, pwm: false } }, 0, leftLight, 1.44);
  assert.equal(parked.charging, false);
  assert.ok(parked.watts < 1.0);
  assert.equal(parked.xl4015OutV, 6.02);
});

import {
  RIG_DIMS,
  BOARD_ORIGINS,
  GOOUUU_FRONT_PINS,
  GOOUUU_REAR_PINS,
  TINY_RTC_PINS,
  LM393_PINS,
  ACTIVE_DUPONT_PLUGS,
  WIRE_NET_META,
  getGoouuuPinPos,
  getBreadboardGndPinPos,
  getLdrPinPos,
  getTinyRtcPinPos,
  getXl4015PinPos,
  SERVO_PLUG_PINS,
  buildPinAccurateWireSpecs,
  buildClickablePinRegistry,
  buildMacroPinCallouts
} from './docs/rig3d-wiring.js';

test('hardware pinout tables and front vertical stack match user physical rig (Watt Meter -> SCC -> Deck with Breadboard GND)', () => {
  assert.equal(GOOUUU_FRONT_PINS.length, 19);
  assert.equal(GOOUUU_REAR_PINS.length, 19);
  assert.equal(GOOUUU_FRONT_PINS[4], '34');
  assert.equal(GOOUUU_FRONT_PINS[5], '35');
  assert.equal(GOOUUU_REAR_PINS[2], '22');
  assert.equal(GOOUUU_REAR_PINS[5], '21');
  assert.equal(GOOUUU_REAR_PINS[8], '18');
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
  assert.equal(ACTIVE_DUPONT_PLUGS.breadboard.length, 3, 'Common GND on Breadboard contains ONLY 3 wires: XL4015 OUT−, Servo MG996R, ESP32 GND');
  // Verify GOOUUU V4 outward row order matches physical Photos 2 & 3 (Black G inner -> Red V middle -> Yellow S outer)
  const gPos = getGoouuuPinPos('front', 4, 'G').local[2];
  const vPos = getGoouuuPinPos('front', 4, 'V').local[2];
  const sPos = getGoouuuPinPos('front', 4, 'S').local[2];
  assert.ok(gPos < vPos && vPos < sPos, 'GOOUUU V4 rows must order outward G (inner) < V (middle) < S (outer)');
});

test('buildPinAccurateWireSpecs and buildClickablePinRegistry cover every clickable wire and pin including Breadboard Common GND', () => {
  const wires = buildPinAccurateWireSpecs();
  assert.ok(wires.length >= 23, `Expected >= 23 pin-to-pin wires, got ${wires.length}`);

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
    assert.ok(span > 0.04, `Wire ${w.id} span too tiny: ${span}`);
  }

  // Verify Breadboard Common GND has ONLY 3 wires: XL4015 OUT−, Servo MG996R (Cokelat), ESP32 GND!
  const gndWires = wires.filter((w) => w.category === 'gnd');
  assert.equal(gndWires.length, 3, 'Expected ONLY 3 Common GND wires on Breadboard');
  const xlGndWire = wires.find((w) => w.id === 'gnd-xl-bb');
  const srvGndWire = wires.find((w) => w.id === 'gnd-servo-bb');
  const espGndWire = wires.find((w) => w.id === 'gnd-esp-bb');
  assert.deepEqual(xlGndWire.points[0], getXl4015PinPos('OUT-').world);
  assert.deepEqual(xlGndWire.points[xlGndWire.points.length - 1], getBreadboardGndPinPos(0).world);
  assert.deepEqual(srvGndWire.points[0], SERVO_PLUG_PINS.GND);
  assert.deepEqual(srvGndWire.points[srvGndWire.points.length - 1], getBreadboardGndPinPos(1).world);
  assert.deepEqual(espGndWire.points[espGndWire.points.length - 1], getBreadboardGndPinPos(2).world);

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

  // Verify clickable pin registry covers every board, Breadboard slots, Red XL4015 terminals, and bare gold unused pins
  const pins = buildClickablePinRegistry();
  assert.ok(pins.length >= 40, `Expected >= 40 clickable pins, got ${pins.length}`);
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
  assert.deepEqual(pins.find((p) => p.id === 'ldr1-gnd')?.wireIds, ['ldr1-gnd-esp']);
  assert.ok(pins.find((p) => p.id === 'esp-dc-jack'), 'GOOUUU V4 DC6.5-16V barrel jack must be clickable');
  assert.ok(pins.find((p) => p.id === 'esp-goouuu-microusb'), 'GOOUUU V4 Micro-USB port must be clickable');
  assert.ok(pins.find((p) => p.id === 'esp-goouuu-usbc'), 'GOOUUU V4 USB5V Type-C port must be clickable');

  const callouts = buildMacroPinCallouts();
  assert.ok(callouts.length >= 12);
});


