'use strict';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Maps ESP32 servo angle (15..165 deg, 90 = level flat horizontal skyward) into
 * the single-axis overhead pitch flip rotation around the horizontal X axle:
 * - 15 deg  -> +68 deg tilt FORWARD facing the Watt Meter (+Z side)
 * - 90 deg  ->   0 deg FLAT HORIZONTAL facing straight skyward (+Y)
 * - 165 deg -> -68 deg tilt BACKWARD facing the opposite side (-Z side)
 */
export function servoDegToPanelTiltRad(servoDeg, trimDeg = 0, invert = false) {
  const base = Number.isFinite(Number(servoDeg)) ? Number(servoDeg) : 90;
  const trim = Number.isFinite(Number(trimDeg)) ? Number(trimDeg) : 0;
  const effectiveDeg = clamp(base + trim, 15, 165);
  const offsetDeg = (90 - effectiveDeg) * (invert ? -1 : 1);
  const maxPhysicalTiltDeg = 68;
  const scaledDeg = clamp((offsetDeg / 75) * maxPhysicalTiltDeg, -maxPhysicalTiltDeg, maxPhysicalTiltDeg);
  return scaledDeg * DEG2RAD;
}

// Backwards-compatible alias
export const servoDegToPanelRollRad = servoDegToPanelTiltRad;

/**
 * Maps servo angle (15..165) to MG996R servo horn rotation in radians around the X-axis.
 * Positive horn angle lifts the rear (-Z) pushrod UP (tilting panel forward toward +Z Watt Meter);
 * negative horn angle pulls the rear (-Z) pushrod DOWN (tilting panel backward toward -Z opposite).
 */
export function servoDegToHornRad(servoDeg, trimDeg = 0, invert = false) {
  const base = Number.isFinite(Number(servoDeg)) ? Number(servoDeg) : 90;
  const trim = Number.isFinite(Number(trimDeg)) ? Number(trimDeg) : 0;
  const effectiveDeg = clamp(base + trim, 15, 165);
  const offsetDeg = (90 - effectiveDeg) * (invert ? -1 : 1);
  return clamp(offsetDeg, -72, 72) * DEG2RAD;
}

/**
 * Computes exact 3D pushrod endpoints (hornTip & panelAnchor), midpoint, and length
 * in RigRoot coordinates so the steel pushrod wire mechanically links the MG996R horn
 * to the panel's rear cross-bracket across the full +Z (Watt Meter) <-> -Z (opposite) flip.
 */
export function computePushrodGeometry(params) {
  const {
    hornOrigin,
    hornLength,
    hornAngleRad,
    pivotOrigin,
    bracketAnchorLocal,
    panelRollRad
  } = params;

  const tiltRad = Number.isFinite(params.panelTiltRad) ? params.panelTiltRad : (panelRollRad || 0);

  // Servo horn sits along -Z at hornAngle=0 and rotates in the Y-Z plane around X
  const hornTip = {
    x: hornOrigin.x,
    y: hornOrigin.y + Math.sin(hornAngleRad) * hornLength,
    z: hornOrigin.z - Math.cos(hornAngleRad) * hornLength
  };

  // Panel & '+' bracket rotate by tiltRad around X at pivotOrigin:
  // y' = y*cos - z*sin, z' = y*sin + z*cos
  const cosR = Math.cos(tiltRad);
  const sinR = Math.sin(tiltRad);
  const panelAnchor = {
    x: pivotOrigin.x + bracketAnchorLocal.x,
    y: pivotOrigin.y + bracketAnchorLocal.y * cosR - bracketAnchorLocal.z * sinR,
    z: pivotOrigin.z + bracketAnchorLocal.y * sinR + bracketAnchorLocal.z * cosR
  };

  const dx = panelAnchor.x - hornTip.x;
  const dy = panelAnchor.y - hornTip.y;
  const dz = panelAnchor.z - hornTip.z;
  const length = Math.hypot(dx, dy, dz);

  return {
    hornTip,
    panelAnchor,
    midpoint: {
      x: (hornTip.x + panelAnchor.x) * 0.5,
      y: (hornTip.y + panelAnchor.y) * 0.5,
      z: (hornTip.z + panelAnchor.z) * 0.5
    },
    direction: length > 1e-6
      ? { x: dx / length, y: dy / length, z: dz / length }
      : { x: 0, y: 1, z: 0 },
    length
  };
}

/**
 * Converts a light source angle along the overhead 15..165 deg sky arc
 * (15 = front Watt Meter side +Z, 90 = zenith overhead +Y, 165 = opposite back side -Z)
 * into a 3D world position in the panel's overhead tracking arc.
 */
export function lightArcToWorldPos(lightDeg, elevationDeg = 55, radius = 1.65, centerY = 1.42) {
  const clampedDeg = clamp(lightDeg, 10, 170);
  const clampedEl = clamp(elevationDeg, 10, 88);
  // Map 15..165 deg onto an overhead semicircle (+68° front/+Z Watt Meter side to -68° back/-Z opposite side)
  const zenithRad = ((90 - clampedDeg) / 75) * (68 * DEG2RAD);
  // Subtle X offset so the sun/flashlight orb stays visually clear from the 3/4 overview camera
  const xOffset = Math.cos(clampedEl * DEG2RAD) * 0.35 + 0.16;
  return {
    x: xOffset,
    y: centerY + Math.cos(zenithRad) * radius * 0.82,
    z: Math.sin(zenithRad) * radius
  };
}

/**
 * Inverse mapping: converts a dragged 3D point on the overhead arc back into
 * lightDeg (12..168) and elevationDeg (14..85) for the simulator API.
 */
export function worldPosToLightArc(pos, centerY = 1.42) {
  const relY = Math.max(0.15, pos.y - centerY);
  const zenithRad = Math.atan2(pos.z, relY);
  const lightDeg = clamp(Math.round(90 - (zenithRad / (68 * DEG2RAD)) * 75), 12, 168);
  const distYZ = Math.max(0.4, Math.hypot(pos.z, relY));
  const elevationDeg = clamp(Math.round(Math.atan2(relY, Math.max(0.2, Math.abs(pos.z) * 0.7)) * RAD2DEG), 14, 85);
  return { lightDeg, elevationDeg, radius: distYZ };
}

/**
 * Computes Lambert cosine incidence efficiency (0..100%) and physically-modeled
 * electrical estimates for the 12V PWM Charge Controller, Digital Watt Meter,
 * and XL4015 5A Buck Converter (12V LOAD -> 6.0V MG996R Servo rail).
 */
export function computeElectricalEstimate(status, panelTiltRad, lightPos, panelCenterY = 1.44) {
  const l1 = status?.ldr1?.pct ?? 0;
  const l2 = status?.ldr2?.pct ?? 0;
  const avgPct = (l1 + l2) * 0.5;
  const maxPct = Math.max(l1, l2);
  const sunOk = status?.sun ? !!status.sun.ok : maxPct >= 15;
  const parked = !!status?.park?.on;
  const servoActive = !!(status?.servo?.moving || status?.servo?.pwm);

  // Panel lies flat horizontal (+Y normal) at tilt=0, tilts around X (+Z Watt Meter <-> -Z opposite):
  // normal = (0, cos(panelTiltRad), sin(panelTiltRad))
  const nx = 0;
  const ny = Math.cos(panelTiltRad);
  const nz = Math.sin(panelTiltRad);

  let cosIncidence = 0.85;
  if (lightPos) {
    const lx = lightPos.x * 0.25;
    const ly = lightPos.y - panelCenterY;
    const lz = lightPos.z;
    const lLen = Math.hypot(lx, ly, lz);
    if (lLen > 1e-4) {
      cosIncidence = clamp((nx * lx + ny * ly + nz * lz) / lLen, 0, 1);
    }
  }

  const effPct = Math.round(cosIncidence * 100);
  const activeIrradiance = (sunOk && !parked) ? (avgPct / 100) : (avgPct / 100) * 0.15;

  // Model 20W 12V monocrystalline panel + INCOE SA-20 12V 22Ah VRLA battery + XL4015 6.0V buck
  const batteryVoltage = Number((12.2 + activeIrradiance * cosIncidence * 1.45 - (status?.pwr?.sagMv || 0) * 0.001).toFixed(1));
  const panelVoltage = Number((batteryVoltage + (sunOk && !parked ? (1.2 + activeIrradiance * 4.4) : 0.0)).toFixed(2));
  const currentAmp = Number(((sunOk && !parked ? 1.35 : 0.04) * activeIrradiance * Math.max(0.25, cosIncidence)).toFixed(2));
  const watts = Number((panelVoltage * currentAmp).toFixed(1));
  const batterySoc = clamp(Math.round(((batteryVoltage - 11.8) / (13.6 - 11.8)) * 100), 10, 100);

  // XL4015 Buck Converter (12V LOAD -> ~6.0V MG996R servo rail)
  const xl4015InV = batteryVoltage;
  const xl4015OutV = Number((servoActive ? 5.92 : 6.02).toFixed(2));
  const xl4015OutA = Number((servoActive ? 0.85 : 0.05).toFixed(2));

  return {
    estimated: true,
    charging: sunOk && !parked && currentAmp >= 0.12,
    batteryVoltage,
    panelVoltage,
    currentAmp,
    watts,
    batterySoc,
    effPct,
    xl4015InV,
    xl4015OutV,
    xl4015OutA,
    servoActive
  };
}
