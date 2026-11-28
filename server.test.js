'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  server,
  state,
  classifyHealth,
  normalizePct,
  evaluateDecision,
  computeSimLightRaw,
  tickSimulator
} = require('./server');

test('classifyHealth detects wiring faults, saturation, and normal ranges', () => {
  assert.equal(classifyHealth(0, 0, 0), 'CHECK WIRING');
  assert.equal(classifyHealth(2000, 1600, 500), 'CHECK WIRING');
  assert.equal(classifyHealth(100, 80, 5), 'SATURATED_LOW');
  assert.equal(classifyHealth(4095, 3300, 0), 'SATURATED_HIGH');
  assert.equal(classifyHealth(2100, 1700, 8), 'OK');
});

test('normalizePct maps raw ADC values across normal and inverted polarity', () => {
  assert.equal(normalizePct(500, 500, 3500, true), 0);
  assert.equal(normalizePct(2000, 500, 3500, true), 50);
  assert.equal(normalizePct(3500, 500, 3500, true), 100);
  assert.equal(normalizePct(3500, 3500, 500, false), 0);
  assert.equal(normalizePct(500, 3500, 500, false), 100);
});

test('evaluateDecision respects deadband threshold', () => {
  assert.equal(evaluateDecision(52, 50), 'HOLD');
  assert.equal(evaluateDecision(60, 50), 'LDR1 BRIGHTER');
  assert.equal(evaluateDecision(40, 50), 'LDR2 BRIGHTER');
});

test('computeSimLightRaw brightens LDR1 on left light (<90) and LDR2 on right light (>90)', () => {
  const left = computeSimLightRaw(35, 90, 55, 0.9, false);
  assert.ok(left.r1 > left.r2 + 300, `Expected LDR1 > LDR2 when light is left, got ${left.r1} vs ${left.r2}`);

  const right = computeSimLightRaw(145, 90, 55, 0.9, false);
  assert.ok(right.r2 > right.r1 + 300, `Expected LDR2 > LDR1 when light is right, got ${right.r1} vs ${right.r2}`);

  const balanced = computeSimLightRaw(90, 90, 55, 0.9, false);
  assert.ok(Math.abs(balanced.r1 - balanced.r2) < 20, `Expected balanced LDRs at 90°, got ${balanced.r1} vs ${balanced.r2}`);
});

test('HTTP server serves dashboard HTML, favicon, Three.js vendor files, and simulator API endpoints', async () => {
  state.sourceMode = 'sim';
  state.preset = 'normal';
  state.simLight.active = false;
  tickSimulator();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const htmlRes = await fetch(`${base}/`);
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers.get('content-type') || '', /text\/html/);
    const html = await htmlRes.text();
    assert.match(html, /SolarTracker/);
    assert.match(html, /view-twin3d/);

    const favRes = await fetch(`${base}/favicon.jpg`);
    assert.equal(favRes.status, 200);
    assert.equal(favRes.headers.get('content-type'), 'image/jpeg');

    const threeRes = await fetch(`${base}/vendor/three/build/three.module.js`);
    assert.equal(threeRes.status, 200);
    assert.match(threeRes.headers.get('content-type') || '', /javascript/);

    const statusRes = await fetch(`${base}/api/status`);
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json();
    assert.equal(status.sourceMode, 'sim');
    assert.equal(status.espOnline, true);
    assert.equal(status.sun.ok, true);

    const presetRes = await fetch(`${base}/api/sim/preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'ldr1_brighter' })
    });
    assert.equal(presetRes.status, 200);
    tickSimulator();
    assert.equal(state.decision, 'LDR1 BRIGHTER');

    // Test interactive 3D light override endpoint (left light -> LDR1 brighter & AUTO servo tracks left)
    state.servo.mode = 'AUTO';
    state.servo.deg = 90;
    state.servo.target = 90;
    const simLightRes = await fetch(`${base}/api/sim/light`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true, deg: 35, elevation: 55, intensity: 0.9 })
    });
    assert.equal(simLightRes.status, 200);
    const simLightData = await simLightRes.json();
    assert.equal(simLightData.simLight.active, true);
    assert.equal(simLightData.simLight.deg, 35);

    const afterLightRes = await fetch(`${base}/api/status`);
    const afterLight = await afterLightRes.json();
    assert.ok(afterLight.ldr1.pct > afterLight.ldr2.pct);
    assert.equal(afterLight.decision, 'LDR1 BRIGHTER');
    assert.ok(afterLight.servo.target < 90, `Expected AUTO servo target to move left (<90), got ${afterLight.servo.target}`);

    // Disable sim light override cleanly
    await fetch(`${base}/api/sim/light`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false })
    });

    const servoRes = await fetch(`${base}/api/servo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'manual', deg: 120 })
    });
    assert.equal(servoRes.status, 200);
    const servoData = await servoRes.json();
    assert.equal(servoData.servo.mode, 'MANUAL');
    assert.equal(servoData.servo.target, 120);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
