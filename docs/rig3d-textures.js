'use strict';

import * as THREE from 'three';
import {
  GOOUUU_FRONT_PINS,
  GOOUUU_REAR_PINS,
  TINY_RTC_PINS,
  LM393_PINS,
  INA219_PINS,
  INA219_GEO,
  UPS_GEO
} from './rig3d-wiring.js';

function finalizeColorTex(canvas, anisotropy, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy || 4;
  if (repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  tex.needsUpdate = true;
  return tex;
}

function finalizeDataTex(canvas, anisotropy, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  // Linear data texture (NoColorSpace) for bumpMap / roughnessMap
  tex.anisotropy = anisotropy || 4;
  if (repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  tex.needsUpdate = true;
  return tex;
}

// ============================================================================
// PROCEDURAL MICRO-SURFACE BUMP / ROUGHNESS MAPS (Photorealistic tactile feel)
// ============================================================================

/**
 * Fine powder-coated matte black steel grain bump map (for stand, post, '+' cross bracket).
 */
export function createPowderCoatBumpMap(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  let seed = 1337;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = 112 + ((seed >>> 24) & 31);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finalizeDataTex(c, anisotropy, 6, 6);
}

/**
 * Fine directional brushed stainless/aluminum bump map (RF shield, CR2032, heatsink, Watt Meter).
 */
export function createBrushedMetalBumpMap(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  let seed = 4242;
  for (let y = 0; y < 256; y++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const tone = 104 + ((seed >>> 24) % 48);
    ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
    ctx.fillRect(0, y, 256, 1);
  }
  return finalizeDataTex(c, anisotropy, 2, 2);
}

/**
 * Woven FR-4 PCB fiberglass + micro-trace surface relief bump map.
 */
export function createPcbFiberglassBumpMap(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#787878';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 4) {
    ctx.fillStyle = y % 8 === 0 ? '#8c8c8c' : '#6c6c6c';
    ctx.fillRect(0, y, 256, 2);
  }
  for (let x = 0; x < 256; x += 4) {
    ctx.fillStyle = x % 8 === 0 ? 'rgba(155,155,155,0.45)' : 'rgba(95,95,95,0.45)';
    ctx.fillRect(x, 0, 2, 256);
  }
  return finalizeDataTex(c, anisotropy, 4, 4);
}

// ============================================================================
// SOLAR PANEL, JUNCTION BOX & INCOE BATTERY HIGH-DPI TEXTURES
// ============================================================================

export function createSolarFrontTexture(anisotropy) {
  const w = 768;
  const h = 1120;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#eceef2';
  ctx.fillRect(0, 0, w, h);

  const borderGrad = ctx.createLinearGradient(0, 0, w, h);
  borderGrad.addColorStop(0, 'rgba(255,255,255,0.48)');
  borderGrad.addColorStop(1, 'rgba(176,184,198,0.24)');
  ctx.fillStyle = borderGrad;
  ctx.fillRect(0, 0, w, h);

  const padX = 48;
  const padY = 56;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const cols = 6;
  const rows = 9;
  const cellW = innerW / cols;
  const cellH = innerH / rows;

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = padX + col * cellW + 2.5;
      const y = padY + r * cellH + 2.5;
      const cw = cellW - 5;
      const ch = cellH - 5;

      const isLeftMacroEdge = col % 3 === 0;
      const isRightMacroEdge = col % 3 === 2;
      const isTopMacroEdge = r % 3 === 0;
      const isBotMacroEdge = r % 3 === 2;
      const chm = 16;

      const tl = (isLeftMacroEdge && isTopMacroEdge) ? chm : 1.5;
      const tr = (isRightMacroEdge && isTopMacroEdge) ? chm : 1.5;
      const br = (isRightMacroEdge && isBotMacroEdge) ? chm : 1.5;
      const bl = (isLeftMacroEdge && isBotMacroEdge) ? chm : 1.5;

      const grad = ctx.createLinearGradient(x, y, x + cw, y + ch);
      const toneShift = ((r + col) % 2 === 0) ? 0 : 6;
      grad.addColorStop(0, `rgb(${36 + toneShift}, ${41 + toneShift}, ${52 + toneShift})`);
      grad.addColorStop(0.5, `rgb(${26 + toneShift}, ${31 + toneShift}, ${40 + toneShift})`);
      grad.addColorStop(1, `rgb(${20 + toneShift}, ${24 + toneShift}, ${32 + toneShift})`);

      ctx.beginPath();
      ctx.moveTo(x + tl, y);
      ctx.lineTo(x + cw - tr, y);
      ctx.lineTo(x + cw, y + tr);
      ctx.lineTo(x + cw, y + ch - br);
      ctx.lineTo(x + cw - br, y + ch);
      ctx.lineTo(x + bl, y + ch);
      ctx.lineTo(x, y + ch - bl);
      ctx.lineTo(x, y + tl);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Fine photovoltaic horizontal micro-fingers inside each monocrystalline wafer
      ctx.strokeStyle = 'rgba(205, 216, 232, 0.16)';
      ctx.lineWidth = 1;
      for (let f = 1; f <= 5; f++) {
        const fy = y + (ch * f) / 6;
        ctx.beginPath();
        ctx.moveTo(x + 2, fy);
        ctx.lineTo(x + cw - 2, fy);
        ctx.stroke();
      }
    }
  }

  // Silver soldered tabbing busbars
  ctx.strokeStyle = 'rgba(224, 231, 240, 0.78)';
  ctx.lineWidth = 2.2;
  for (let col = 1; col < cols; col++) {
    const gx = padX + col * cellW;
    ctx.beginPath();
    ctx.moveTo(gx, padY + 4);
    ctx.lineTo(gx, padY + innerH - 4);
    ctx.stroke();
  }
  for (let r = 1; r < rows; r++) {
    const gy = padY + r * cellH;
    ctx.beginPath();
    ctx.moveTo(padX + 4, gy);
    ctx.lineTo(padX + innerW - 4, gy);
    ctx.stroke();
  }

  const corners = [[24, 24], [w - 24, 24], [24, h - 24], [w - 24, h - 24]];
  for (const [cx, cy] of corners) {
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#c8ccd4';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#1e2228';
    ctx.fill();
  }

  return finalizeColorTex(c, anisotropy);
}

export function createSolarBackTexture(anisotropy) {
  const w = 512;
  const h = 460;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#e6e8ec';
  ctx.fillRect(0, 0, w, h);

  const padX = 32;
  const padY = 28;
  const cellW = (w - padX * 2) / 9;
  const cellH = (h - padY * 2) / 9;
  ctx.fillStyle = 'rgba(130, 136, 146, 0.14)';
  for (let r = 0; r < 9; r++) {
    for (let col = 0; col < 9; col++) {
      ctx.fillRect(padX + col * cellW + 2, padY + r * cellH + 2, cellW - 4, cellH - 4);
    }
  }
  ctx.fillStyle = '#383d46';
  ctx.fillRect(w * 0.29, h * 0.30, 12, h * 0.16);
  ctx.fillRect(w * 0.34, h * 0.30, 12, h * 0.16);
  return finalizeColorTex(c, anisotropy);
}

export function createJunctionBoxTexture(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#141619';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = 'rgba(235, 240, 248, 0.72)';
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, 220, 220);

  ctx.fillStyle = '#e5e9f0';
  ctx.font = '600 20px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('USB1', 84, 58);
  ctx.fillText('USB2', 172, 58);

  ctx.beginPath();
  ctx.arc(128, 118, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#cfd6e0';
  ctx.fill();

  ctx.fillStyle = '#dce2ec';
  ctx.font = '600 16px Inter, sans-serif';
  ctx.fillText('Output: DC 5V 3A (Max)', 128, 198);

  return finalizeColorTex(c, anisotropy);
}

export function createIncoeBatteryTexture(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 384;
  const ctx = c.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, 384);
  bg.addColorStop(0, '#0f6a6d');
  bg.addColorStop(1, '#094b4e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 384);

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let i = 0; i < 40; i++) {
    ctx.fillRect((i * 73) % 512, (i * 41) % 384, 24, 2);
  }

  ctx.fillStyle = '#edf3f5';
  ctx.font = '800 66px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('INCOE', 256, 118);
  ctx.fillRect(108, 128, 296, 8);

  ctx.font = '700 15px Inter, sans-serif';
  ctx.fillText('VALVE REGULATED LEAD ACID BATTERY', 256, 156);

  ctx.font = '800 40px Inter, sans-serif';
  ctx.fillText('SA-20', 256, 200);

  ctx.font = '600 16px "JetBrains Mono", monospace';
  ctx.fillText('12V, C20 22Ah (1.75V / Cell at 25°C)', 256, 224);

  ctx.strokeStyle = 'rgba(235, 245, 246, 0.78)';
  ctx.lineWidth = 2;
  ctx.strokeRect(42, 248, 248, 104);
  ctx.textAlign = 'left';
  ctx.font = '700 13px Inter, sans-serif';
  ctx.fillText('WARNING:', 54, 268);
  ctx.font = '500 11px Inter, sans-serif';
  ctx.fillText('• Do not shortcircuit terminals', 54, 288);
  ctx.fillText('• Do not charge in sealed container', 54, 306);
  ctx.fillText('• Recycle lead battery properly', 54, 324);

  ctx.font = '600 12px Inter, sans-serif';
  ctx.fillText('Produced by:', 318, 316);
  ctx.fillText('PT Century Batteries Indonesia', 318, 334);

  return finalizeColorTex(c, anisotropy);
}

export function createWorkshopFloorTexture(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#e9e5d9';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = 'rgba(130, 124, 112, 0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = i * 128;
    ctx.beginPath();
    ctx.moveTo(p, 0); ctx.lineTo(p, 512);
    ctx.moveTo(0, p); ctx.lineTo(512, p);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255, 252, 244, 0.22)';
  ctx.fillRect(4, 4, 120, 120);
  ctx.fillRect(260, 260, 120, 120);

  return finalizeColorTex(c, anisotropy, 6, 6);
}

export function createOutdoorGroundTexture(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#cfd5dc';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 900; i++) {
    const x = (i * 131) % 512;
    const y = (i * 89) % 512;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(90, 98, 110, 0.09)' : 'rgba(255, 255, 255, 0.10)';
    ctx.fillRect(x, y, 3, 3);
  }

  ctx.strokeStyle = 'rgba(100, 110, 122, 0.28)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 508, 508);
  ctx.beginPath();
  ctx.moveTo(256, 0); ctx.lineTo(256, 512);
  ctx.moveTo(0, 256); ctx.lineTo(512, 256);
  ctx.stroke();

  return finalizeColorTex(c, anisotropy, 8, 8);
}

export function createContactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 12, 128, 128, 120);
  g.addColorStop(0, 'rgba(15, 20, 28, 0.50)');
  g.addColorStop(0.55, 'rgba(15, 20, 28, 0.22)');
  g.addColorStop(1, 'rgba(15, 20, 28, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// ============================================================================
// LIVE DYNAMIC LCD DISPLAYS (SCC + WATT METER)
// ============================================================================

export function createSccDisplay(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const ctx = c.getContext('2d');
  const tex = finalizeColorTex(c, anisotropy);
  let lastKey = '';

  function update(elec) {
    const vStr = (elec?.batteryVoltage ?? 12.3).toFixed(1);
    const chg = elec?.charging ? 1 : 0;
    const soc = elec?.batterySoc ?? 75;
    const key = `${vStr}|${chg}|${Math.round(soc / 15)}`;
    if (key === lastKey) return;
    lastKey = key;

    ctx.fillStyle = '#1b1f24';
    ctx.fillRect(0, 0, 512, 320);

    ctx.fillStyle = '#1576d1';
    ctx.fillRect(14, 14, 484, 244);

    ctx.fillStyle = '#eaf4ff';
    ctx.font = '700 22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SOLAR CHARGE CONTROLLER', 256, 46);

    const icons = [
      [30, 62, 'MCU', 'control'],
      [112, 62, 'SET', 'voltage'],
      [30, 142, 'TIMER', 'built-in'],
      [112, 142, 'FULL', 'protect']
    ];
    for (const [ix, iy, t1, t2] of icons) {
      ctx.fillStyle = 'rgba(130, 215, 255, 0.25)';
      ctx.fillRect(ix, iy, 72, 68);
      ctx.strokeStyle = 'rgba(220, 245, 255, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ix, iy, 72, 68);
      ctx.fillStyle = '#0c2340';
      ctx.font = '700 13px Inter, sans-serif';
      ctx.fillText(t1, ix + 36, iy + 32);
      ctx.font = '600 11px Inter, sans-serif';
      ctx.fillText(t2, ix + 36, iy + 52);
    }

    ctx.fillStyle = '#8b9987';
    ctx.fillRect(198, 62, 198, 128);
    ctx.strokeStyle = '#2c332d';
    ctx.lineWidth = 4;
    ctx.strokeRect(198, 62, 198, 128);

    ctx.fillStyle = '#1b241d';
    ctx.font = '700 52px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(vStr, 360, 122);
    ctx.font = '700 22px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('V', 366, 102);

    ctx.strokeStyle = '#1b241d';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(212, 144, 28, 28);
    ctx.beginPath();
    ctx.moveTo(226, 144); ctx.lineTo(226, 172);
    ctx.moveTo(212, 158); ctx.lineTo(240, 158);
    ctx.stroke();

    ctx.fillStyle = chg ? '#1b241d' : 'rgba(27, 36, 29, 0.25)';
    ctx.font = '700 22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('▶', 256, 166);

    ctx.strokeRect(272, 144, 48, 28);
    ctx.fillStyle = '#1b241d';
    ctx.fillRect(320, 151, 5, 14);
    const bars = Math.max(1, Math.min(4, Math.ceil(soc / 25)));
    for (let b = 0; b < bars; b++) {
      ctx.fillRect(277 + b * 10, 149, 7, 18);
    }

    ctx.fillStyle = '#1b241d';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.fillText('▶', 340, 165);
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.fillText('EST', 374, 166);

    ctx.fillStyle = '#eaf4ff';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('USB 5V', 446, 206);

    // Crisp recessed screw-terminal pinout silkscreen strip aligned with the 6 green terminals!
    ctx.fillStyle = '#1c2026';
    ctx.fillRect(14, 258, 484, 56);
    const termLabels = ['+PV', '-PV', '+BAT', '-BAT', '+LD', '-LD'];
    const termColors = ['#ff6b6b', '#cbd5e1', '#ff6b6b', '#cbd5e1', '#fb923c', '#cbd5e1'];
    ctx.font = '700 15px "JetBrains Mono", monospace';
    for (let i = 0; i < 6; i++) {
      const tx = 104 + i * 61;
      ctx.fillStyle = termColors[i];
      ctx.fillText(termLabels[i], tx, 292);
    }

    tex.needsUpdate = true;
  }

  update({ batteryVoltage: 12.3, charging: true, batterySoc: 72 });
  return { texture: tex, update };
}

export function createWattMeterDisplay(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 280;
  const ctx = c.getContext('2d');
  const tex = finalizeColorTex(c, anisotropy);
  let lastKey = '';
  let energyWh = 4.2;

  function update(elec, dtSec = 0) {
    if (elec?.watts > 0 && dtSec > 0) {
      energyWh += (elec.watts * dtSec) / 3600;
    }
    const v = (elec?.panelVoltage ?? 13.8).toFixed(2);
    const a = (elec?.currentAmp ?? 0.65).toFixed(2);
    const w = (elec?.watts ?? 9.0).toFixed(1);
    const wh = energyWh.toFixed(2);
    const key = `${v}|${a}|${w}|${wh}`;
    if (key === lastKey) return;
    lastKey = key;

    const bg = ctx.createLinearGradient(0, 0, 512, 280);
    bg.addColorStop(0, '#0997e6');
    bg.addColorStop(0.5, '#0084d4');
    bg.addColorStop(1, '#056eb2');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 280);

    ctx.fillStyle = '#1b1d22';
    ctx.font = '800 30px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Watt Meter', 442, 48);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Watt Meter', 440, 46);

    ctx.fillStyle = '#eaf6ff';
    ctx.font = '700 17px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    'SOURCE'.split('').forEach((ch, idx) => ctx.fillText(ch, 34, 82 + idx * 24));
    'LOAD'.split('').forEach((ch, idx) => ctx.fillText(ch, 478, 102 + idx * 28));

    ctx.fillStyle = '#071c45';
    ctx.fillRect(68, 66, 376, 134);
    ctx.strokeStyle = '#732934';
    ctx.lineWidth = 4;
    ctx.strokeRect(68, 66, 376, 134);

    ctx.fillStyle = '#c8f1ff';
    ctx.font = '700 34px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${v}V`, 86, 118);
    ctx.textAlign = 'right';
    ctx.fillText(`${a}A`, 426, 118);

    ctx.fillStyle = '#8ef5c8';
    ctx.textAlign = 'left';
    ctx.fillText(`${w}W`, 86, 174);
    ctx.fillStyle = '#a5d8ff';
    ctx.font = '600 24px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${wh}Wh EST`, 426, 174);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 24px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('CE', 68, 246);

    ctx.fillStyle = '#6d1e25';
    ctx.fillRect(118, 222, 92, 32);
    ctx.fillRect(284, 222, 96, 32);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 17px Inter, sans-serif';
    ctx.fillText('Voltage', 128, 244);
    ctx.fillText('0-60V', 218, 244);
    ctx.fillText('Current', 296, 244);
    ctx.fillText('0-100A', 388, 244);

    tex.needsUpdate = true;
  }

  update({ panelVoltage: 13.8, currentAmp: 0.65, watts: 9.0 }, 0);
  return { texture: tex, update };
}

// ============================================================================
// MACRO ULTRA-REALISTIC PCB SILKSCREENS (LEGIBLE INDIVIDUAL PIN LABELS!)
// ============================================================================

/**
 * 2048x1280 Photorealistic Purple GOOUUU ESP32S 38P/V4 Expansion Board PCB top face (matching Photo B):
 * - Rich royal purple FR-4 soldermask with visible copper traces & plated mounting holes
 * - Boxed white S / V / G rail legends + ALL 19x2 outer & inner vertical silkscreen pin labels
 * - Center 'ESP32S 38P/V4/Goouuu Expansion board' + exact 24.00mm & 25.500mm double-arrow callouts
 * - Rear-right TX/RX/VCC/GND & D22/D21/VCC/GND box, Front-right chamfered 5V|3V / GND box
 * - Vertical 3.3V / V / 5V + underlined JUMP box, DC6.5-16V, USB5V, and RPW-LED silkscreen
 */
export function createGoouuuTexture(anisotropy) {
  const w = 2048;
  const h = 1280;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  // Rich royal purple FR-4 soldermask matching Photo B
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#5a2b8e');
  bg.addColorStop(0.5, '#4c227a');
  bg.addColorStop(1, '#411b6b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle glossy copper ground-pour reflections beneath purple mask
  ctx.fillStyle = 'rgba(135, 84, 198, 0.16)';
  ctx.fillRect(28, 28, w - 56, h - 56);

  // Board geometry mapping: 0.142m wide (X) x 0.096m deep (Z).
  // BoxGeometry +Y face maps U = (x / 0.142) + 0.5, V = (z / 0.096) + 0.5 (Y=0 is -Z rear, Y=h is +Z front).
  const boardW = 0.142;
  const boardD = 0.096;
  const pinOffsetX = -0.0175;
  const pinPitch = 0.0052;
  const pxFromX = (xMeters) => (xMeters / boardW + 0.5) * w;
  const pyFromZ = (zMeters) => (zMeters / boardD + 0.5) * h;

  // Authentic GOOUUU V4 silver plated mounting holes (4 corner/mid + small white fiducial on left)
  const mountHoles = [
    [pxFromX(-0.0655), pyFromZ(-0.0415), 34, 22],
    [pxFromX(-0.0655), pyFromZ(0.0415),  34, 22],
    [pxFromX(0.0485),  pyFromZ(-0.0415), 34, 22],
    [pxFromX(0.0485),  pyFromZ(0.0415),  34, 22],
    [pxFromX(-0.0605), pyFromZ(-0.0085), 14, 10]
  ];
  for (const [hx, hy, rOut, rIn] of mountHoles) {
    ctx.beginPath();
    ctx.arc(hx, hy, rOut, 0, Math.PI * 2);
    ctx.fillStyle = '#d4dce6';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx, hy, rIn, 0, Math.PI * 2);
    ctx.fillStyle = '#18141f';
    ctx.fill();
  }

  const rearActiveIdx = new Set([2, 5, 6, 8]); // P22, P21, GND, P18
  const frontActiveIdx = new Set([0, 4, 5]);   // 3V3, P34, P35

  // Subtle etched copper fanout traces connecting yellow female sockets to G/V/S triple rails
  ctx.strokeStyle = 'rgba(164, 118, 232, 0.38)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 19; i++) {
    const x = pxFromX(pinOffsetX + (i - 9) * pinPitch);
    ctx.beginPath();
    ctx.moveTo(x, pyFromZ(-0.0155));
    ctx.lineTo(x, pyFromZ(-0.0410));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, pyFromZ(0.0145));
    ctx.lineTo(x, pyFromZ(0.0410));
    ctx.stroke();
  }

  // Gold ENIG solder ring pads under all 19x3 rear & front pins
  const zRows = [-0.0295, -0.0348, -0.0401, 0.0295, 0.0348, 0.0401];
  for (let i = 0; i < 19; i++) {
    const x = pxFromX(pinOffsetX + (i - 9) * pinPitch);
    for (const zr of zRows) {
      const y = pyFromZ(zr);
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#e4c25d';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#241836';
      ctx.fill();
    }
  }

  // Crisp vertical rotated silkscreen pin names along OUTER edge AND INNER edge beside yellow sockets (exact Photo B!)
  const realFrontLabels = ['3V3', 'EN', 'SVP', 'SVN', 'P34', 'P35', 'P32', 'P33', 'P25', 'P26', 'P27', 'P14', 'P12', 'GND', 'P13', 'SD2', 'SD3', 'CMD', '5V'];
  const realRearLabels  = ['GND', 'P23', 'P22', 'TX',  'RX',  'P21', 'GND', 'P19', 'P18', 'P5',  'P17', 'P16', 'P4',  'P0',  'P2',  'P15', 'SD1', 'SD0', 'CLK'];

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 19; i++) {
    const x = pxFromX(pinOffsetX + (i - 9) * pinPitch);
    const rActive = rearActiveIdx.has(i);
    const fActive = frontActiveIdx.has(i);

    // Outer rear (-Z) vertical rotated text
    ctx.save();
    ctx.translate(x, pyFromZ(-0.0452));
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = rActive ? '#fef08a' : '#ffffff';
    ctx.font = rActive ? '800 22px "JetBrains Mono", monospace' : '700 20px "JetBrains Mono", monospace';
    ctx.fillText(realRearLabels[i], 0, 0);
    ctx.restore();

    // Outer front (+Z) vertical rotated text
    ctx.save();
    ctx.translate(x, pyFromZ(0.0452));
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = fActive ? '#fef08a' : '#ffffff';
    ctx.font = fActive ? '800 22px "JetBrains Mono", monospace' : '700 20px "JetBrains Mono", monospace';
    ctx.fillText(realFrontLabels[i], 0, 0);
    ctx.restore();

    // Inner rear (-Z) vertical text beside yellow female socket
    ctx.save();
    ctx.translate(x, pyFromZ(-0.0104));
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = rActive ? '#fef08a' : '#ffffff';
    ctx.font = rActive ? '800 21px "JetBrains Mono", monospace' : '700 19px "JetBrains Mono", monospace';
    ctx.fillText(realRearLabels[i], 0, 0);
    ctx.restore();

    // Inner front (+Z) vertical text beside double yellow female sockets
    ctx.save();
    ctx.translate(x, pyFromZ(0.0086));
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = fActive ? '#fef08a' : '#ffffff';
    ctx.font = fActive ? '800 21px "JetBrains Mono", monospace' : '700 19px "JetBrains Mono", monospace';
    ctx.fillText(realFrontLabels[i], 0, 0);
    ctx.restore();
  }

  // Exact Photo B White Boxed S / V / G Row Legends on left edge of triple headers!
  const drawSvgBox = (zTop, zBot, ch, fillHex) => {
    const bx = pxFromX(-0.0688);
    const bw = pxFromX(-0.0642) - bx;
    const by = pyFromZ(zTop);
    const bh = pyFromZ(zBot) - by;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = fillHex;
    ctx.font = '800 28px "JetBrains Mono", monospace';
    ctx.fillText(ch, bx + bw * 0.5, by + bh * 0.5 + 1);
  };
  drawSvgBox(-0.0426, -0.0375, 'S', '#fef08a');
  drawSvgBox(-0.0375, -0.0322, 'V', '#fda4af');
  drawSvgBox(-0.0322, -0.0268, 'G', '#ffffff');
  drawSvgBox(0.0268,  0.0322,  'G', '#ffffff');
  drawSvgBox(0.0322,  0.0375,  'V', '#fda4af');
  drawSvgBox(0.0375,  0.0426,  'S', '#fef08a');

  // Center silkscreen title matching Photo B verbatim
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 32px "JetBrains Mono", monospace';
  ctx.fillText('ESP32S 38P/V4/Goouuu Expansion board', pxFromX(-0.0205), pyFromZ(-0.001));

  // Exact vertical double-arrow dimension callouts: 24.00mm (inner) & 25.500mm (outer) matching Photo B!
  const drawDimArrow = (xMeters, zTop, zBot, label) => {
    const lx = pxFromX(xMeters);
    const y1 = pyFromZ(zTop);
    const y2 = pyFromZ(zBot);
    const yMid = (y1 + y2) * 0.5;
    const gap = 82;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    // Upper arrow shaft + head
    ctx.beginPath();
    ctx.moveTo(lx, y1);
    ctx.lineTo(lx, yMid - gap);
    ctx.moveTo(lx - 8, y1 + 16);
    ctx.lineTo(lx, y1);
    ctx.lineTo(lx + 8, y1 + 16);
    ctx.stroke();
    // Lower arrow shaft + head
    ctx.beginPath();
    ctx.moveTo(lx, yMid + gap);
    ctx.lineTo(lx, y2);
    ctx.moveTo(lx - 8, y2 - 16);
    ctx.lineTo(lx, y2);
    ctx.lineTo(lx + 8, y2 - 16);
    ctx.stroke();

    ctx.save();
    ctx.translate(lx, yMid);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 22px "JetBrains Mono", monospace';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  };
  drawDimArrow(0.0318, -0.0155, 0.0142, '24.00mm');
  drawDimArrow(0.0352, -0.0155, 0.0185, '25.500mm');

  // Rear-right (+X, -Z) 1x4 black header white silkscreen box & exact TX/RX/VCC/GND + D22/D21/VCC/GND labels!
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.5;
  ctx.strokeRect(
    pxFromX(0.0320), pyFromZ(-0.0402),
    pxFromX(0.0496) - pxFromX(0.0320), pyFromZ(-0.0308) - pyFromZ(-0.0402)
  );
  const rearAuxTop = ['TX', 'RX', 'VCC', 'GND'];
  const rearAuxBot = ['D22', 'D21', 'VCC', 'GND'];
  for (let k = 0; k < 4; k++) {
    const ax = pxFromX(0.0345 + k * 0.0042);
    ctx.save();
    ctx.translate(ax, pyFromZ(-0.0434));
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 18px "JetBrains Mono", monospace';
    ctx.fillText(rearAuxTop[k], 0, 0);
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 16px "JetBrains Mono", monospace';
    ctx.fillText(rearAuxBot[k], ax, pyFromZ(-0.0282));
  }

  // Front-right (+X, +Z) 2x4 black header chamfered octagon silkscreen box with 5V | 3V top & GND bottom (exact Photo B!)
  const bx1 = pxFromX(0.0305), bx2 = pxFromX(0.0485);
  const by1 = pyFromZ(0.0228), by2 = pyFromZ(0.0458);
  const cham = 24;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(bx1 + cham, by1);
  ctx.lineTo(bx2 - cham, by1);
  ctx.lineTo(bx2, by1 + cham);
  ctx.lineTo(bx2, by2 - cham);
  ctx.lineTo(bx2 - cham, by2);
  ctx.lineTo(bx1 + cham, by2);
  ctx.lineTo(bx1, by2 - cham);
  ctx.lineTo(bx1, by1 + cham);
  ctx.closePath();
  ctx.stroke();
  // Top divider bar separating 5V | 3V
  const byDiv = pyFromZ(0.0285);
  ctx.beginPath();
  ctx.moveTo(bx1, byDiv);
  ctx.lineTo(bx2, byDiv);
  ctx.moveTo((bx1 + bx2) * 0.5, by1);
  ctx.lineTo((bx1 + bx2) * 0.5, byDiv);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 26px "JetBrains Mono", monospace';
  ctx.fillText('5V', (bx1 + (bx1 + bx2) * 0.5) * 0.5, (by1 + byDiv) * 0.5 + 1);
  ctx.fillText('3V', ((bx1 + bx2) * 0.5 + bx2) * 0.5, (by1 + byDiv) * 0.5 + 1);
  ctx.font = '800 28px "JetBrains Mono", monospace';
  ctx.fillText('GND', (bx1 + bx2) * 0.5, pyFromZ(0.0434));

  // Right-side Vertical JUMP (3.3V / V / 5V) Voltage Selector silkscreen (exact Photo B!)
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.font = '800 24px "JetBrains Mono", monospace';
  ctx.fillText('3.3V', pxFromX(0.0522), pyFromZ(0.0205));
  ctx.fillText('V',    pxFromX(0.0522), pyFromZ(0.0252));
  ctx.fillText('5V',   pxFromX(0.0522), pyFromZ(0.0299));

  ctx.textAlign = 'center';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.5;
  ctx.strokeRect(
    pxFromX(0.0528), pyFromZ(0.0178),
    pxFromX(0.0582) - pxFromX(0.0528), pyFromZ(0.0326) - pyFromZ(0.0178)
  );
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 26px "JetBrains Mono", monospace';
  ctx.fillText('JUMP', pxFromX(0.0558), pyFromZ(0.0362));
  ctx.beginPath();
  ctx.moveTo(pxFromX(0.0512), pyFromZ(0.0384));
  ctx.lineTo(pxFromX(0.0604), pyFromZ(0.0384));
  ctx.stroke();

  // White SMD outlines around the 2x CS 47 35V caps, 1117 5.0 reg, SS24 diodes, tan ceramic caps
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 3;
  // Cap outlines
  ctx.strokeRect(pxFromX(0.0372), pyFromZ(-0.0242), pxFromX(0.0510) - pxFromX(0.0372), pyFromZ(-0.0102) - pyFromZ(-0.0242));
  ctx.strokeRect(pxFromX(0.0372), pyFromZ(-0.0062), pxFromX(0.0510) - pxFromX(0.0372), pyFromZ(0.0078)  - pyFromZ(-0.0062));
  // 1117 5.0 & SS24 outlines
  ctx.strokeRect(pxFromX(0.0530), pyFromZ(-0.0062), pxFromX(0.0640) - pxFromX(0.0530), pyFromZ(0.0062) - pyFromZ(-0.0062));
  ctx.strokeRect(pxFromX(0.0488), pyFromZ(0.0094),  pxFromX(0.0588) - pxFromX(0.0488), pyFromZ(0.0156) - pyFromZ(0.0094));
  ctx.strokeRect(pxFromX(0.0630), pyFromZ(-0.0038), pxFromX(0.0696) - pxFromX(0.0630), pyFromZ(0.0072) - pyFromZ(-0.0038));

  // Right-edge crisp white voltage & status legends matching Photo B!
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 28px "JetBrains Mono", monospace';
  ctx.fillText('DC6.5-16V', pxFromX(0.0616), pyFromZ(-0.0218));
  ctx.font = '800 28px "JetBrains Mono", monospace';
  ctx.fillText('USB5V', pxFromX(0.0646), pyFromZ(0.0342));

  // Bottom-right RPW-LED + 102 resistor silkscreen frame
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(pxFromX(0.0568), pyFromZ(0.0384), pxFromX(0.0620) - pxFromX(0.0568), pyFromZ(0.0414) - pyFromZ(0.0384));
  ctx.strokeRect(pxFromX(0.0626), pyFromZ(0.0384), pxFromX(0.0672) - pxFromX(0.0626), pyFromZ(0.0414) - pyFromZ(0.0384));
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 22px "JetBrains Mono", monospace';
  ctx.fillText('RPW-LED', pxFromX(0.0620), pyFromZ(0.0442));

  return finalizeColorTex(c, anisotropy);
}

/**
 * 1024x512 Photorealistic Matte-Black 38-Pin ESP32S / NodeMCU-32S daughterboard top silkscreen (matching Photo A):
 * - Glossy black FR-4 mask, 4 white-ring plated corner mounting holes
 * - Left (-X) PCB WiFi 2.4GHz meander antenna trace + white border + white fiducial + 'K' silkscreen
 * - Castellated silver/gold RF module solder pads on 3 edges of ESP-WROOM-32
 * - ALL 38 rotated crisp white pin labels (3V3..V5 front, GND..CLK rear) beside silver solder pads
 * - White SMD footprints for C226, 107J tantalum cap, AMS1117 3.3, CP2102, transistors, shunt resistors, RST & BOOT!
 */
export function createNodeMcuTopTexture(anisotropy) {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  // Deep glossy matte-black soldermask matching Photo A
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#14171c');
  bg.addColorStop(0.5, '#101217');
  bg.addColorStop(1, '#161a20');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle etched dark-gray copper traces across PCB
  ctx.strokeStyle = 'rgba(54, 62, 76, 0.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(12, 12, w - 24, h - 24);

  // Mapping helper for mcuBoard (0.100m X x 0.035m Z)
  const boardW = 0.100;
  const boardD = 0.035;
  const pxX = (xm) => (xm / boardW + 0.5) * w;
  const pyZ = (zm) => (zm / boardD + 0.5) * h;

  // 4 Corner White-Ring Plated Mounting Holes (matching Photo A!)
  for (const [mx, mz] of [[-0.0470, -0.0148], [-0.0470, 0.0148], [0.0470, -0.0148], [0.0470, 0.0148]]) {
    const cx = pxX(mx), cy = pyZ(mz);
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#e5e7eb';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#090b0e';
    ctx.fill();
  }

  // Left-side (-X) PCB WiFi 2.4GHz Meander Antenna (subtle raised dark-charcoal copper relief under black mask)
  ctx.strokeStyle = '#242933';
  ctx.lineWidth = 10;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(pxX(-0.034), pyZ(0.008));
  ctx.lineTo(pxX(-0.046), pyZ(0.008));
  ctx.lineTo(pxX(-0.046), pyZ(0.003));
  ctx.lineTo(pxX(-0.038), pyZ(0.003));
  ctx.lineTo(pxX(-0.038), pyZ(-0.002));
  ctx.lineTo(pxX(-0.046), pyZ(-0.002));
  ctx.lineTo(pxX(-0.046), pyZ(-0.007));
  ctx.lineTo(pxX(-0.038), pyZ(-0.007));
  ctx.lineTo(pxX(-0.038), pyZ(-0.010));
  ctx.stroke();

  // White rectangular RF-module outline + fiducial white dot + 'K' antenna silkscreen (exact Photo A!)
  ctx.strokeStyle = 'rgba(241, 245, 249, 0.86)';
  ctx.lineWidth = 3;
  ctx.strokeRect(pxX(-0.049), pyZ(-0.0115), pxX(-0.003) - pxX(-0.049), pyZ(0.0115) - pyZ(-0.0115));

  // White round fiducial dot in antenna zone (front-left of antenna)
  ctx.beginPath();
  ctx.arc(pxX(-0.0435), pyZ(0.0045), 11, 0, Math.PI * 2);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 18px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('K', pxX(-0.0365), pyZ(-0.0018));

  // Castellated shiny silver/gold half-moon solder pads along the 3 sides (-Z, +X, +Z) of the ESP-WROOM-32 module!
  const drawCastPad = (cx, cy, rw, rh) => {
    ctx.fillStyle = '#d4dce6';
    ctx.fillRect(cx - rw * 0.5, cy - rh * 0.5, rw, rh);
    ctx.fillStyle = '#8b95a5';
    ctx.fillRect(cx - rw * 0.25, cy - rh * 0.25, rw * 0.5, rh * 0.5);
  };
  for (let k = 0; k < 14; k++) {
    const px = pxX(-0.032 + k * 0.0022);
    drawCastPad(px, pyZ(-0.0116), 9, 14);
    drawCastPad(px, pyZ(0.0116),  9, 14);
  }
  for (let k = 0; k < 10; k++) {
    const pz = pyZ(-0.0095 + k * 0.0021);
    drawCastPad(pxX(-0.0030), pz, 14, 9);
  }

  // ALL 38 Silver Through-Hole Solder Pads + Crisp White Rotated Pin Labels (matching Photo A verbatim!)
  const frontPins = ['3V3', 'EN', 'SP', 'SN', 'G34', 'G35', 'G32', 'G33', 'G25', 'G26', 'G27', 'G14', 'G12', 'GND', 'G13', 'SD2', 'SD3', 'CMD', 'V5'];
  const rearPins  = ['GND', 'G23', 'G22', 'TXD', 'RXD', 'G21', 'GND', 'G19', 'G18', 'G5', 'G17', 'G16', 'G4', 'G0', 'G2', 'G15', 'SD1', 'SD0', 'CLK'];

  for (let i = 0; i < 19; i++) {
    const xm = (i - 9) * 0.0052;
    const cx = pxX(xm);

    // Rear (-Z) & Front (+Z) bright tin-silver solder ring pads
    for (const zm of [-0.0156, 0.0156]) {
      const cy = pyZ(zm);
      ctx.beginPath();
      ctx.arc(cx, cy, 11.5, 0, Math.PI * 2);
      ctx.fillStyle = '#dce3ec';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 5.2, 0, Math.PI * 2);
      ctx.fillStyle = '#181c24';
      ctx.fill();
    }

    // Rear (-Z) pin label inward of pad
    ctx.save();
    ctx.translate(cx, pyZ(-0.0132));
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 15px "JetBrains Mono", monospace';
    ctx.fillText(rearPins[i], 0, 0);
    ctx.restore();

    // Front (+Z) pin label inward of pad
    ctx.save();
    ctx.translate(cx, pyZ(0.0132));
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 15px "JetBrains Mono", monospace';
    ctx.fillText(frontPins[i], 0, 0);
    ctx.restore();
  }

  // Crisp white SMD silkscreen footprints & silver solder pads across right-hand active circuitry (Photo A!)
  ctx.strokeStyle = 'rgba(241, 245, 249, 0.72)';
  ctx.lineWidth = 2.5;
  // Row of 6 SMD resistor/cap outlines right behind RF shield
  for (let r = 0; r < 6; r++) {
    const zm = -0.0088 + r * 0.0035;
    ctx.strokeRect(pxX(0.0012), pyZ(zm - 0.0011), pxX(0.0066) - pxX(0.0012), pyZ(zm + 0.0011) - pyZ(zm - 0.0011));
  }
  // C226, Yellow 107J tantalum cap, AMS1117 3.3, CP2102, transistors, rear shunt/cap bank footprints
  ctx.strokeRect(pxX(0.0082), pyZ(0.0020),  pxX(0.0145) - pxX(0.0082), pyZ(0.0068) - pyZ(0.0020)); // C226
  ctx.strokeRect(pxX(0.0140), pyZ(0.0032),  pxX(0.0202) - pxX(0.0140), pyZ(0.0088) - pyZ(0.0032)); // 107J
  ctx.strokeRect(pxX(0.0205), pyZ(0.0025),  pxX(0.0315) - pxX(0.0205), pyZ(0.0108) - pyZ(0.0025)); // AMS1117
  ctx.strokeRect(pxX(0.0222), pyZ(-0.0062), pxX(0.0314) - pxX(0.0222), pyZ(0.0020) - pyZ(-0.0062)); // CP2102

  // Pin-1 white alignment dot for CP2102
  ctx.beginPath();
  ctx.arc(pxX(0.0216), pyZ(-0.0066), 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Rear (-Z) row of 5 white SMD shunt/cap outlines
  for (let k = 0; k < 5; k++) {
    const xm = 0.0105 + k * 0.0052;
    ctx.strokeRect(pxX(xm - 0.0018), pyZ(-0.0102), pxX(xm + 0.0018) - pxX(xm - 0.0018), pyZ(-0.0068) - pyZ(-0.0102));
  }

  // Crisp white RST & BOOT silkscreen labels right beside tactile buttons (exact Photo A!)
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 22px "JetBrains Mono", monospace';
  ctx.save();
  ctx.translate(pxX(0.0365), pyZ(0.0052));
  ctx.rotate(Math.PI / 2);
  ctx.fillText('RST', 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(pxX(0.0365), pyZ(-0.0052));
  ctx.rotate(Math.PI / 2);
  ctx.fillText('BOOT', 0, 0);
  ctx.restore();

  // Small silver solder pads for Micro-USB 5 rear legs
  for (let p = 0; p < 5; p++) {
    const pz = pyZ(-0.0026 + p * 0.0013);
    ctx.fillStyle = '#dce3ec';
    ctx.fillRect(pxX(0.0405), pz - 3, 20, 6);
  }

  return finalizeColorTex(c, anisotropy);
}

/**
 * 512x512 Brushed stainless ESP-WROOM-32 RF shield laser-engraved top face (matching Photo A verbatim!):
 *  - [WiFi] box emblem + 'ESP-WROOM-32'
 *  - Large 'CE' + Espressif circular logo
 *  - Circular TELEC mark + '[R] 211-161007'
 *  - 'FCC ID:2AC7Z-ESPWROOM32' + recessed corner alignment dot
 */
export function createEspRfShieldTexture(anisotropy) {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');

  // Warm satin nickel-silver brushed steel base matching Photo A
  const bg = ctx.createLinearGradient(0, 0, s, s);
  bg.addColorStop(0, '#cfc8be');
  bg.addColorStop(0.45, '#bcb5aa');
  bg.addColorStop(1, '#c8c1b6');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, s, s);

  // Fine brushed metal grain
  for (let y = 0; y < s; y += 2) {
    ctx.fillStyle = y % 4 === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(38,34,30,0.06)';
    ctx.fillRect(0, y, s, 1);
  }

  // Crisp stamped metallic bezel perimeter
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, s - 20, s - 20);
  ctx.strokeStyle = 'rgba(55, 50, 44, 0.34)';
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, s - 36, s - 36);

  // Rotate canvas -90° so text reads cleanly upright when viewed from front (+Z) looking at the rig!
  // (On Photo A, WiFi/ESP-WROOM-32 runs parallel to the antenna edge.)
  ctx.save();
  ctx.translate(s * 0.5, s * 0.5);
  ctx.rotate(-Math.PI / 2);
  ctx.translate(-s * 0.5, -s * 0.5);

  const etch = '#1f1c18';
  const etchLight = '#2d2822';

  // Top row: [Wi Fi] rounded badge + 'ESP-WROOM-32'
  ctx.fillStyle = '#e8e2d8';
  ctx.beginPath();
  ctx.roundRect(62, 108, 104, 52, 14);
  ctx.fill();
  ctx.strokeStyle = etch;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = etch;
  ctx.font = '800 28px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Wi', 92, 134);
  ctx.fillStyle = etch;
  ctx.fillRect(118, 118, 38, 32);
  ctx.fillStyle = '#f2ede4';
  ctx.font = '800 26px Inter, sans-serif';
  ctx.fillText('Fi', 137, 135);

  ctx.fillStyle = etchLight;
  ctx.textAlign = 'left';
  ctx.font = '800 32px "JetBrains Mono", monospace';
  ctx.fillText('ESP-WROOM-32', 180, 136);

  // Middle row: Large 'CE' + Espressif circular logo
  ctx.fillStyle = etchLight;
  ctx.font = '800 72px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CE', 260, 232);

  // Espressif circular wireless emblem on right
  ctx.strokeStyle = etchLight;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(386, 232, 42, 0, Math.PI * 2);
  ctx.stroke();
  for (const r of [14, 24, 34]) {
    ctx.beginPath();
    ctx.arc(372, 246, r, -Math.PI * 0.45, 0.05);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(372, 246, 5, 0, Math.PI * 2);
  ctx.fillStyle = etchLight;
  ctx.fill();

  // Lower-middle row: Circular TELEC logo + [R] 211-161007
  ctx.strokeStyle = etchLight;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(138, 294, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = '800 26px "JetBrains Mono", monospace';
  ctx.fillText('〒', 138, 295);

  ctx.strokeRect(192, 276, 36, 36);
  ctx.font = '800 24px "JetBrains Mono", monospace';
  ctx.fillText('R', 210, 295);
  ctx.textAlign = 'left';
  ctx.font = '800 24px "JetBrains Mono", monospace';
  ctx.fillText('211-161007', 240, 295);

  // Bottom row: FCC ID:2AC7Z-ESPWROOM32
  ctx.textAlign = 'center';
  ctx.font = '800 25px "JetBrains Mono", monospace';
  ctx.fillText('FCC ID:2AC7Z-ESPWROOM32', 256, 366);

  // Subtle recessed circular alignment pin dimple in corner
  ctx.beginPath();
  ctx.arc(92, 412, 16, 0, Math.PI * 2);
  ctx.fillStyle = '#4a453e';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(92, 412, 11, 0, Math.PI * 2);
  ctx.fillStyle = '#25221e';
  ctx.fill();

  ctx.restore();
  return finalizeColorTex(c, anisotropy);
}

/**
 * Reusable high-contrast laser-etched / screen-printed top texture for micro-3D ICs,
 * SMD shunt/pull-up resistors (102/103/472), Schottky diodes (SS24), C226, and yellow tantalum caps (107J).
 */
export function createIcLabelTexture(anisotropy, {
  lines = [],
  bgHex = '#1a1d24',
  textHex = '#d5dde8',
  stripeSide = null,
  stripeHex = '#92400e',
  pinDot = false,
  rotateDeg = 0
} = {}) {
  const w = 256;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, w, h);

  // Subtle molded epoxy chamfer border
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  if (stripeSide === 'left') {
    ctx.fillStyle = stripeHex;
    ctx.fillRect(10, 10, 40, h - 20);
  } else if (stripeSide === 'right') {
    ctx.fillStyle = stripeHex;
    ctx.fillRect(w - 50, 10, 40, h - 20);
  } else if (stripeSide === 'top') {
    ctx.fillStyle = stripeHex;
    ctx.fillRect(10, 10, w - 20, 40);
  } else if (stripeSide === 'bottom') {
    ctx.fillStyle = stripeHex;
    ctx.fillRect(10, h - 50, w - 20, 40);
  }

  if (pinDot) {
    ctx.beginPath();
    ctx.arc(34, 34, 14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.fill();
  }

  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  if (rotateDeg) ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.fillStyle = textHex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const count = lines.length;
  const fontSize = count === 1 ? 84 : count === 2 ? 48 : count === 3 ? 38 : 32;
  const lineGap = fontSize * 1.24;
  ctx.font = `800 ${fontSize}px "JetBrains Mono", monospace`;
  lines.forEach((line, idx) => {
    const yOff = (idx - (count - 1) * 0.5) * lineGap;
    ctx.fillText(line, 0, yOff);
  });
  ctx.restore();

  return finalizeColorTex(c, anisotropy);
}

/**
 * Brushed stainless-steel top texture for Micro-USB receptacle with authentic twin dark
 * stamped T-shaped retention cutouts & chamfered front lip (matching Photo B).
 */
export function createMicroUsbTopTexture(anisotropy) {
  const w = 256;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  // Metallic brushed silver gradient (left -X rear -> right +X front opening)
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#cfd6df');
  bg.addColorStop(0.35, '#eef2f6');
  bg.addColorStop(0.7, '#bfc7d2');
  bg.addColorStop(1, '#dce2ea');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle horizontal brushed-steel grain lines
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  for (let y = 8; y < h; y += 10) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Outer stamped bevel edge + right-side flared rim crease (+X)
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(w - 28, 6, 8, h - 12);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(w - 20, 6, 14, h - 12);

  // Twin dark stamped T-shaped retention spring cutouts (top & bottom, matching Photo B!)
  const drawTSlot = (cy, flipY) => {
    ctx.fillStyle = '#181c22';
    ctx.fillRect(118, cy - 10, 64, 20);
    ctx.fillRect(142, flipY ? cy - 32 : cy + 6, 18, 26);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(118, cy - 10, 64, 20);
  };
  drawTSlot(56, false);
  drawTSlot(h - 56, true);

  // Rear (-X) small square crimp dimples
  ctx.fillStyle = '#475569';
  ctx.fillRect(24, 34, 26, 22);
  ctx.fillRect(24, h - 56, 26, 22);

  return finalizeColorTex(c, anisotropy);
}

/**
 * Brushed stainless-steel top texture for USB Type-C receptacle (USB5V) with authentic
 * stamped side spring tabs, interlocking center laser-weld seam & rounded front lip (matching Photo B).
 */
export function createUsbCTopTexture(anisotropy) {
  const w = 256;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  // Rich brushed stainless-steel sheen
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#a8b2be');
  bg.addColorStop(0.18, '#e6ebf1');
  bg.addColorStop(0.5, '#cbd3de');
  bg.addColorStop(0.82, '#eef2f7');
  bg.addColorStop(1, '#9ca6b3');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle metallic micro-grain
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = 2;
  for (let y = 10; y < h; y += 12) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Outer perimeter rim & right-edge (+X) rolled mouth highlight
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(w - 26, 6, 7, h - 12);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(w - 19, 6, 13, h - 12);

  // Subtle center interlocking dovetail seam along X
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(14, h * 0.5);
  ctx.lineTo(86, h * 0.5);
  ctx.lineTo(96, h * 0.5 - 12);
  ctx.lineTo(122, h * 0.5 - 12);
  ctx.lineTo(132, h * 0.5);
  ctx.lineTo(w - 26, h * 0.5);
  ctx.stroke();

  // Stamped U-shaped spring retention cutouts (upper & lower, exact Photo B!)
  const drawSpringCutout = (y) => {
    ctx.fillStyle = '#1e242c';
    ctx.fillRect(88, y - 14, 72, 28);
    // Bright stainless inner spring finger
    ctx.fillStyle = '#d6dde6';
    ctx.fillRect(98, y - 8, 52, 16);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.strokeRect(98, y - 8, 52, 16);
  };
  drawSpringCutout(56);
  drawSpringCutout(h - 56);

  // Rear-left (-X) shielding fold tabs
  ctx.fillStyle = '#334155';
  ctx.fillRect(18, 28, 30, 18);
  ctx.fillRect(18, h - 46, 30, 18);

  return finalizeColorTex(c, anisotropy);
}

/**
 * Brushed nickel-silver top texture for CR2032 3V Lithium Coin Cell Battery on Tiny RTC.
 */
export function createCoinCellTopTexture(anisotropy) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');

  // Metallic radial sheen
  const g = ctx.createRadialGradient(s * 0.42, s * 0.38, 12, s * 0.5, s * 0.5, s * 0.52);
  g.addColorStop(0, '#f8fafc');
  g.addColorStop(0.55, '#d5dde7');
  g.addColorStop(0.85, '#b6c1cf');
  g.addColorStop(1, '#8c99aa');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  // Subtle concentric brushed-steel rings
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 2;
  for (let r = 24; r < 118; r += 14) {
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Outer crimped metal bevel ring
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.5, 114, 0, Math.PI * 2);
  ctx.stroke();

  // Crisp laser-etched battery markings: '+', 'CR2032', '3V LITHIUM'
  ctx.fillStyle = '#334155';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 44px Inter, sans-serif';
  ctx.fillText('+', s * 0.5, 62);
  ctx.font = '800 32px "JetBrains Mono", monospace';
  ctx.fillText('CR2032', s * 0.5, 122);
  ctx.font = '700 18px "JetBrains Mono", monospace';
  ctx.fillStyle = '#475569';
  ctx.fillText('3V LITHIUM', s * 0.5, 162);
  ctx.font = '700 14px Inter, sans-serif';
  ctx.fillText('LIR2032 / RTC', s * 0.5, 192);

  return finalizeColorTex(c, anisotropy);
}

/**
 * 1280x960 Photorealistic Deep-Blue HW-111 Tiny RTC DS1307 + AT24C32 PCB silkscreen
 * (0.076m wide x 0.056m deep, PCB localX spans -0.028 .. +0.048):
 *  - Left edge (P2, localX = -0.023): 7-pin header pads SQ..BAT aligned 1:1 with getTinyRtcPinPos(0..6)
 *  - Left-center (localX = -0.017 .. +0.012): Full HW-111 SMD circuitry (HW-111, X1, D1, R6/R4/R5/R8/R1/R3/R2, C1/C2, U2 DS1307, U3 24C32)
 *  - Right-center (localX = +0.0265): Top-mounted CR2032 Coin Cell Battery cradle footprint (BT1 3V +)
 *  - Far-right edge (P1, localX = +0.0435): 7 open silver-ring solder pads SQ..BAT + 'I2C modules' + 'P1'
 */
export function createTinyRtcTexture(anisotropy) {
  const w = 1280;
  const h = 960;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  // Deep glossy dark-blue soldermask matching HW-111 photo
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0a487a');
  bg.addColorStop(0.5, '#083d6a');
  bg.addColorStop(1, '#063259');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle etched copper ground-pour frame
  ctx.strokeStyle = 'rgba(30, 118, 184, 0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, w - 36, h - 36);

  // Coordinate helpers matching 0.076m x 0.056m PCB centered at rtcGroup localX = +0.010 (spans -0.028 .. +0.048)
  const pcbCenterX = 0.010;
  const pcbW = 0.076;
  const pcbD = 0.056;
  const pxX = (xm) => ((xm - pcbCenterX) / pcbW + 0.5) * w;
  const pyZ = (zm) => (zm / pcbD + 0.5) * h;

  const drawPlatedHole = (cx, cy, rOuter, rInner, square = false) => {
    ctx.fillStyle = '#dce3ec';
    if (square) {
      ctx.fillRect(cx - rOuter, cy - rOuter, rOuter * 2, rOuter * 2);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fillStyle = '#091b2e';
    ctx.fill();
  };

  // 2 Bottom Corner Plated Mounting Holes
  drawPlatedHole(pxX(-0.0225), pyZ(0.0228), 32, 21);
  drawPlatedHole(pxX(0.0422),  pyZ(0.0228), 32, 21);

  // Top-left 3x unpopulated DS18B20 vertical silver pads
  for (let k = 0; k < 3; k++) {
    drawPlatedHole(pxX(-0.0218), pyZ(-0.0238 + k * 0.0042), 13, 6);
  }

  // Top-center & Bottom-center vias
  ctx.strokeStyle = 'rgba(241, 245, 249, 0.85)';
  ctx.lineWidth = 3.5;
  ctx.strokeRect(pxX(-0.0032), pyZ(-0.0242), 46, 46);
  drawPlatedHole(pxX(-0.0012), pyZ(-0.0215), 15, 7);
  drawPlatedHole(pxX(-0.0015), pyZ(0.0195), 18, 9);

  // Top Edge Crisp White Silkscreen: 'HW-111' & 'I2C modules'
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '800 32px "JetBrains Mono", monospace';
  ctx.fillText('HW-111', pxX(-0.0175), pyZ(-0.0242));
  ctx.textAlign = 'right';
  ctx.font = '700 32px Inter, sans-serif';
  ctx.fillText('I2C modules', pxX(0.0458), pyZ(-0.0242));

  // Left edge (P2, localX = -0.023): 7 header pads aligned 1:1 with getTinyRtcPinPos(0..6)!
  ctx.strokeStyle = 'rgba(241, 245, 249, 0.82)';
  ctx.lineWidth = 3.5;
  ctx.strokeRect(pxX(-0.0258), pyZ(-0.0214), pxX(-0.0202) - pxX(-0.0258), pyZ(0.0214) - pyZ(-0.0214));
  for (let i = 0; i < 7; i++) {
    const zm = (i - 3) * 0.0062;
    const py = pyZ(zm);
    const px = pxX(-0.0230);
    drawPlatedHole(px, py, 14, 6, i === 6);

    const pinLbl = TINY_RTC_PINS[i];
    const used = i >= 2 && i <= 5;
    ctx.fillStyle = used ? '#fef08a' : '#f1f5f9';
    ctx.font = used ? '800 20px "JetBrains Mono", monospace' : '700 18px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(pinLbl, px + 20, py);
  }
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 22px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('P2', pxX(-0.0226), pyZ(0.0256));

  // Right edge (P1, localX = +0.0435): 7 open silver-ring solder pads inside white silkscreen frame
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 3.5;
  ctx.strokeRect(pxX(0.0406), pyZ(-0.0195), pxX(0.0466) - pxX(0.0406), pyZ(0.0198) - pyZ(-0.0195));
  for (let i = 0; i < 7; i++) {
    const zm = -0.0165 + i * 0.0055;
    const py = pyZ(zm);
    const px = pxX(0.0436);
    drawPlatedHole(px, py, 14, 7, i === 6);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 20px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(TINY_RTC_PINS[i], pxX(0.0396), py);
  }
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 22px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('P1', pxX(0.0362), pyZ(0.0252));

  // CR2032 Coin Cell Battery Holder silkscreen outline at localX = +0.0258, z = 0.000
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(pxX(0.0258), pyZ(0.000), 192, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fef08a';
  ctx.font = '800 22px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('BT1 · CR2032 3V', pxX(0.0258), pyZ(-0.0175));
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 24px "JetBrains Mono", monospace';
  ctx.fillText('+', pxX(0.0258), pyZ(0.0180));

  // Crisp White SMD Silkscreen Component Outlines & Reference Designators (shifted -0.002m in X cleanly beside CR2032)
  const ox = -0.0020;
  const box = (x1, z1, x2, z2) => {
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.88)';
    ctx.lineWidth = 3.2;
    ctx.strokeRect(pxX(x1 + ox), pyZ(z1), pxX(x2 + ox) - pxX(x1 + ox), pyZ(z2) - pyZ(z1));
  };

  box(-0.0114, -0.0192, -0.0056, -0.0010); // X1
  box(0.0038, -0.0195, 0.0146, -0.0138);   // D1
  box(-0.0018, -0.0180, 0.0026, -0.0102);  // R6
  box(-0.0018, -0.0076, 0.0026,  0.0002);  // R4
  box(0.0044, -0.0132, 0.0142, -0.0086);   // R5
  box(0.0044, -0.0076, 0.0142, -0.0030);   // R8
  box(0.0044, -0.0020, 0.0142,  0.0026);   // R1
  box(-0.0156, -0.0062, -0.0124, 0.0004);  // R7
  box(-0.0038,  0.0064, -0.0004, 0.0146);  // C1
  box( 0.0004,  0.0064,  0.0038, 0.0146);  // C2
  box(-0.0144,  0.0200, -0.0062, 0.0246);  // R3
  box( 0.0048,  0.0200,  0.0132, 0.0246);  // R2

  // Metallic pads for U2 (DS1307) & U3 (AT24C32)
  ctx.fillStyle = '#cfd8e3';
  for (const ucx of [-0.0098 + ox, 0.0096 + ox]) {
    for (let k = 0; k < 4; k++) {
      const px = pxX(ucx - 0.0031 + k * 0.0021);
      ctx.fillRect(px - 5, pyZ(0.0044) - 7, 10, 14);
      ctx.fillRect(px - 5, pyZ(0.0168) - 7, 10, 14);
    }
  }

  // Reference designators
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 21px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('D1', pxX(0.0118 + ox), pyZ(-0.0208));
  ctx.fillText('R7', pxX(-0.0136 + ox), pyZ(-0.0078));
  ctx.fillText('C1', pxX(-0.0022 + ox), pyZ(0.0042));
  ctx.fillText('C2', pxX(0.0022 + ox),  pyZ(0.0042));

  const drawRotText = (txt, xm, zm, deg) => {
    ctx.save();
    ctx.translate(pxX(xm + ox), pyZ(zm));
    ctx.rotate((deg * Math.PI) / 180);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 20px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, 0, 0);
    ctx.restore();
  };
  drawRotText('X1', -0.0130, -0.0130, 90);
  drawRotText('R6', -0.0034, -0.0142, 90);
  drawRotText('R4', -0.0034, -0.0038, 90);
  drawRotText('R5',  0.0034, -0.0108, 90);
  drawRotText('R8',  0.0034, -0.0052, 90);
  drawRotText('R1',  0.0034,  0.0004, 90);
  drawRotText('U2', -0.0048,  0.0192, 90);
  drawRotText('U3',  0.0148,  0.0192, 90);
  drawRotText('R3', -0.0046,  0.0226, 90);
  drawRotText('R2',  0.0148,  0.0226, 90);

  return finalizeColorTex(c, anisotropy);
}

/**
 * 512x768 Authentic Ocean-Teal Blue LM393 4-Pin LDR Sensor PCB matching Photo 1:
 *  - Rear (-Z, top of canvas): white rectangular silkscreen box with − / + solder pads for UPRIGHT LDR leads
 *  - Upper-mid: 2x 103 resistor footprints (left) + 2x ceramic cap footprints (right)
 *  - Center: LM393 8-pin SOIC footprint (left) + square blue open-frame trimmer pot outline (right)
 *  - Lower-mid: center plated mounting hole flanked by PWR-LED & DO-LED + 102 resistors
 *  - Front (+Z, bottom of canvas): VCC | GND | DO | AO aligned 1:1 with getLdrPinPos()!
 */
export function createLm393Texture(anisotropy, labelSuffix = 'LDR1') {
  const w = 512;
  const h = 768;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  // Deep glossy ocean-teal blue soldermask matching Photo 1
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#065078');
  bg.addColorStop(0.5, '#085d8a');
  bg.addColorStop(1, '#054669');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle etched copper ground plane traces
  ctx.strokeStyle = 'rgba(26, 134, 186, 0.42)';
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, w - 36, h - 36);

  // Rear (-Z, y = 76) white silkscreen box with − and + markings for the 2 upright LDR legs
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 6;
  ctx.strokeRect(140, 34, 232, 86);
  ctx.beginPath();
  ctx.moveTo(256, 34);
  ctx.lineTo(256, 120);
  ctx.stroke();

  // Silver solder pads inside the − / + LDR box + outer silver corner vias
  for (const px of [194, 318]) {
    ctx.beginPath();
    ctx.arc(px, 77, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#d7dfe8';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, 77, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#334155';
    ctx.fill();
  }
  for (const vx of [66, 446]) {
    ctx.beginPath();
    ctx.arc(vx, 74, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#cbd5e1';
    ctx.fill();
  }
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 38px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('−', 110, 77);
  ctx.fillText('+', 402, 77);

  // Upper-mid white SMD component silkscreen outlines (2x 103 left, 2x tan caps right)
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.78)';
  ctx.lineWidth = 4;
  ctx.strokeRect(86, 166, 126, 52);
  ctx.strokeRect(86, 232, 126, 52);
  ctx.strokeRect(296, 166, 126, 52);
  ctx.strokeRect(296, 232, 126, 52);

  // Center square white silkscreen frame for right-side blue trimmer pot
  ctx.strokeRect(268, 308, 198, 184);

  // Center plated mounting hole between LEDs (matching Photo 1!)
  ctx.beginPath();
  ctx.arc(w * 0.5, 578, 48, 0, Math.PI * 2);
  ctx.fillStyle = '#c8d2de';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(w * 0.5, 578, 36, 0, Math.PI * 2);
  ctx.fillStyle = '#111620';
  ctx.fill();

  // PWR-LED & DO-LED silkscreen boxes & vertical edge labels
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 4;
  ctx.strokeRect(58, 536, 84, 52);
  ctx.strokeRect(370, 536, 84, 52);

  ctx.save();
  ctx.translate(32, 572);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 24px "JetBrains Mono", monospace';
  ctx.fillText('PWR-LED', 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(w - 32, 572);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 24px "JetBrains Mono", monospace';
  ctx.fillText('DO-LED', 0, 0);
  ctx.restore();

  // Bottom 4-pin header traces, silver pads & crisp silkscreen (VCC | GND | DO | AO)
  ctx.strokeStyle = 'rgba(42, 164, 214, 0.55)';
  ctx.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    const px = ((i - 1.5) * 0.0056 / 0.028 + 0.5) * w;
    ctx.beginPath();
    ctx.moveTo(px, 646);
    ctx.lineTo(px, 730);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(px, 722, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#d5dde7';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, 722, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#0e2438';
    ctx.fill();

    const lbl = LM393_PINS[i];
    const isDo = lbl === 'DO';
    ctx.fillStyle = isDo ? '#bae6fd' : '#fef08a';
    ctx.font = isDo ? '700 26px "JetBrains Mono", monospace' : '800 28px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl, px, 672);
  }

  // Subtle module ID tag near center-left
  ctx.fillStyle = 'rgba(224, 242, 254, 0.78)';
  ctx.font = '700 20px "JetBrains Mono", monospace';
  ctx.fillText(labelSuffix, 146, 488);

  return finalizeColorTex(c, anisotropy);
}

/**
 * Authentic Photo 1 terracotta-orange CdS photoresistor top face with crisp wavy serpentine zigzag!
 */
export function createCdsPhotoresistorTexture(anisotropy) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');

  // Warm ceramic ivory/peach housing edge
  ctx.fillStyle = '#edd2be';
  ctx.fillRect(0, 0, s, s);

  // Translucent glossy terracotta-orange epoxy disk (matching Photo 1!)
  const rad = ctx.createRadialGradient(118, 114, 18, 128, 128, 118);
  rad.addColorStop(0, '#f38961');
  rad.addColorStop(0.68, '#d95c34');
  rad.addColorStop(1, '#b84321');
  ctx.beginPath();
  ctx.arc(128, 128, 116, 0, Math.PI * 2);
  ctx.fillStyle = rad;
  ctx.fill();

  // Outer light ceramic bezel ring
  ctx.strokeStyle = '#f2dfd0';
  ctx.lineWidth = 10;
  ctx.stroke();

  // Iconic bright serpentine metallic CdS zigzag trace across face
  ctx.strokeStyle = '#f9e1cd';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let row = 0; row < 6; row++) {
    const y = 52 + row * 30;
    const xL = row === 0 || row === 5 ? 64 : 44;
    const xR = row === 0 || row === 5 ? 192 : 212;
    if (row % 2 === 0) {
      ctx.moveTo(xL, y);
      ctx.lineTo(xR, y);
      if (row < 5) ctx.lineTo(xR, y + 30);
    } else {
      ctx.moveTo(xR, y);
      ctx.lineTo(xL, y);
      if (row < 5) ctx.lineTo(xL, y + 30);
    }
  }
  ctx.stroke();

  // Side silver electrode pads
  ctx.fillStyle = '#dce3ec';
  ctx.fillRect(24, 112, 22, 32);
  ctx.fillRect(210, 112, 22, 32);

  return finalizeColorTex(c, anisotropy);
}

/**
 * 512x280 Authentic RED XL4015 CC/CV 5A DC-DC Buck Converter PCB (matching user's uploaded photo!):
 * Crimson red soldermask, silver mounting pads, IN+/IN- left, OUT+/OUT- right, CV/CC W103 trimpot outlines.
 */
export function createXl4015Texture(anisotropy) {
  const w = 512;
  const h = 280;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  // Glossy crimson-red PCB soldermask matching photo image_e2c7a5ff.png
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#a61c24');
  bg.addColorStop(0.5, '#8f161d');
  bg.addColorStop(1, '#7a1118');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle bright-red copper pour zones beneath soldermask
  ctx.fillStyle = 'rgba(210, 48, 56, 0.35)';
  ctx.fillRect(20, 20, 140, 240);
  ctx.fillRect(352, 20, 140, 240);

  ctx.strokeStyle = 'rgba(255, 244, 244, 0.72)';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  // 4 silver HASL corner mounting holes
  for (const [hx, hy] of [[20, 20], [w - 20, 20], [20, h - 20], [w - 20, h - 20]]) {
    ctx.beginPath();
    ctx.arc(hx, hy, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#d4dbe3';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#241416';
    ctx.fill();
  }

  // Crisp white silkscreen markings
  ctx.fillStyle = '#fff5f5';
  ctx.font = '800 20px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('XL4015 5A CC/CV', 256, 266);

  ctx.font = '800 24px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fef08a';
  ctx.fillText('IN+', 66, 78);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText('IN-', 66, 132);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#f9a8d4';
  ctx.fillText('OUT+', 446, 142);
  ctx.fillStyle = '#67e8f9';
  ctx.fillText('OUT-', 446, 204);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = '700 14px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CV  CC', 194, 250);
  ctx.fillText('XL4015E1', 316, 250);

  return finalizeColorTex(c, anisotropy);
}

/**
 * Brushed silver SMD electrolytic capacitor top cap with '220 50V VT' & black polarity band (matching user photo!).
 */
export function createCap220TopTexture(anisotropy) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#cfd5dd';
  ctx.fillRect(0, 0, s, s);

  // Black negative polarity crescent at bottom
  ctx.beginPath();
  ctx.arc(128, 128, 122, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.fillStyle = '#181b20';
  ctx.fill();

  ctx.fillStyle = '#15181e';
  ctx.textAlign = 'center';
  ctx.font = '800 44px "JetBrains Mono", monospace';
  ctx.fillText('220', 128, 86);
  ctx.font = '800 38px "JetBrains Mono", monospace';
  ctx.fillText('50V', 128, 132);
  ctx.font = '800 36px "JetBrains Mono", monospace';
  ctx.fillText('VT', 128, 174);

  return finalizeColorTex(c, anisotropy);
}

/**
 * Brushed-silver SMD electrolytic capacitor top stamp ('CS / 47 / 35V' + black negative crescent)
 * for the 2 aluminum capacitors on the GOOUUU ESP32S 38P/V4 expansion board (Photo B).
 */
export function createCap47TopTexture(anisotropy) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#d3d9e1';
  ctx.fillRect(0, 0, s, s);

  // Black negative polarity crescent at top (-Z) matching Photo B
  ctx.beginPath();
  ctx.arc(128, 128, 122, 1.18 * Math.PI, 1.82 * Math.PI);
  ctx.fillStyle = '#181b20';
  ctx.fill();

  ctx.fillStyle = '#15181e';
  ctx.textAlign = 'center';
  ctx.font = '800 40px "JetBrains Mono", monospace';
  ctx.fillText('CS', 128, 108);
  ctx.font = '800 48px "JetBrains Mono", monospace';
  ctx.fillText('47', 128, 156);
  ctx.font = '800 40px "JetBrains Mono", monospace';
  ctx.fillText('35V', 128, 200);

  return finalizeColorTex(c, anisotropy);
}

/**
 * Photorealistic white half-size Solderless Breadboard top face with red (+) & blue (−) Common GND rails!
 */
export function createBreadboardTexture(anisotropy) {
  const w = 1024;
  const h = 640;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  // Off-white molded ABS breadboard plastic
  ctx.fillStyle = '#f2f3f6';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#d3d8e2';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  // Center DIP channel groove
  ctx.fillStyle = '#e2e5ec';
  ctx.fillRect(28, h * 0.468, w - 56, h * 0.044);

  // Top & Bottom Red (+) and Blue (−) Power Bus Stripes!
  const drawBusRail = (yRed, yHolePlus, yHoleMinus, yBlue, isFrontCommonGnd) => {
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(36, yRed, w - 72, 5);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(36, yBlue, w - 72, 6);

    ctx.font = '800 20px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#dc2626';
    ctx.fillText('+', 22, yRed + 2);
    ctx.fillText('+', w - 22, yRed + 2);
    ctx.fillStyle = '#2563eb';
    ctx.fillText('−', 22, yBlue + 3);
    ctx.fillText('−', w - 22, yBlue + 3);

    // Subtle tinted strip behind the active Common GND hole row (never covering holes!)
    if (isFrontCommonGnd) {
      ctx.fillStyle = 'rgba(37, 99, 235, 0.10)';
      ctx.fillRect(42, yHoleMinus - 11, w - 84, 22);
    }

    // Bus tie-point holes in groups of 5
    ctx.fillStyle = '#232831';
    for (let grp = 0; grp < 5; grp++) {
      for (let k = 0; k < 5; k++) {
        const hx = 68 + grp * 184 + k * 28;
        ctx.fillRect(hx - 5, yHolePlus - 5, 10, 10);
        ctx.fillRect(hx - 5, yHoleMinus - 5, 10, 10);
      }
    }

    if (isFrontCommonGnd) {
      // Crisp silkscreen caption tucked cleanly into the front white margin below the blue stripe
      ctx.fillStyle = '#1d4ed8';
      ctx.font = '800 20px "JetBrains Mono", monospace';
      ctx.fillText('COMMON GND (−) · XL4015 · SERVO · ESP32 · INA219', w * 0.5, yBlue + 24);
    }
  };

  drawBusRail(28, 52, 78, 100, false);
  // Front Common GND rail: blue (−) holes at y=573 match BREADBOARD_GEO.gndRailZ = +0.0285 exactly!
  drawBusRail(522, 546, 573, 593, true);

  // Main 30-column x (a-e + f-j) tie-point matrix
  ctx.fillStyle = '#333944';
  for (let col = 0; col < 30; col++) {
    const cx = 64 + col * 31;
    for (let r = 0; r < 5; r++) {
      ctx.fillRect(cx - 4.5, 152 + r * 26, 9, 9);
      ctx.fillRect(cx - 4.5, 356 + r * 26, 9, 9);
    }
    if (col === 0 || (col + 1) % 5 === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '700 15px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(col + 1), cx, 134);
      ctx.fillText(String(col + 1), cx, 502);
      ctx.fillStyle = '#333944';
    }
  }

  return finalizeColorTex(c, anisotropy);
}

/**
 * MG996R Metal Gear Servo side decal label.
 */
export function createMg996rLabelTexture(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#15171c';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#d4a442';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 240, 112);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 30px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MG996R', 128, 52);
  ctx.fillStyle = '#facc15';
  ctx.font = '700 16px "JetBrains Mono", monospace';
  ctx.fillText('DIGI HI-TORQUE', 128, 80);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '600 14px "JetBrains Mono", monospace';
  ctx.fillText('METAL GEAR · 6.0V', 128, 104);

  return finalizeColorTex(c, anisotropy);
}

/**
 * 1024x896 Authentic Royal-Blue INA219 I2C High-Side DC Current/Voltage Sensor PCB:
 *  - Rear (-Z): 2-pin screw terminal footprint + VIN+ / VIN− silkscreen & mounting holes
 *  - Upper-mid: Heavy copper Kelvin shunt traces routing VIN+/VIN− to R100 (0.1Ω 2512 shunt)
 *  - Center: U1 INA219A SOT-23-8 pads, R1/R2 (10k I2C pull-ups), C1 bypass cap, PWR LED + R3
 *  - Right: A0 / A1 I2C address solder jumper pads + 0x40 legend
 *  - Front (+Z): 6-pin gold header pads & crisp silkscreen aligned 1:1 with INA219_GEO
 */
export function createIna219Texture(anisotropy) {
  const w = 1024;
  const h = 896;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  const pcbW = INA219_GEO.width;
  const pcbD = INA219_GEO.depth;
  const pxX = (xm) => ((xm + pcbW * 0.5) / pcbW) * w;
  const pyZ = (zm) => ((zm + pcbD * 0.5) / pcbD) * h;

  // Royal-blue glossy INA219 soldermask
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0f3f7a');
  bg.addColorStop(0.5, '#15549e');
  bg.addColorStop(1, '#0d3669');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle hatched copper ground plane & inner silkscreen border
  ctx.strokeStyle = 'rgba(56, 152, 236, 0.28)';
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, w - 36, h - 36);

  // Heavy high-current copper traces (12V path: VIN+ -> R100 left, R100 right -> VIN-)
  ctx.strokeStyle = 'rgba(59, 165, 245, 0.45)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 24;
  ctx.beginPath();
  ctx.moveTo(pxX(-0.0068), pyZ(-0.0165));
  ctx.lineTo(pxX(-0.0068), pyZ(-0.0045));
  ctx.lineTo(pxX(-0.0055), pyZ(-0.0045));
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pxX(0.0068), pyZ(-0.0165));
  ctx.lineTo(pxX(0.0068), pyZ(-0.0045));
  ctx.lineTo(pxX(0.0055), pyZ(-0.0045));
  ctx.stroke();

  // Kelvin sense lines from R100 to INA219A IC
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(96, 186, 250, 0.55)';
  ctx.beginPath();
  ctx.moveTo(pxX(-0.0055), pyZ(-0.0020));
  ctx.lineTo(pxX(-0.0065), pyZ(0.0045));
  ctx.moveTo(pxX(0.0055), pyZ(-0.0020));
  ctx.lineTo(pxX(0.0010), pyZ(0.0032));
  ctx.lineTo(pxX(-0.0040), pyZ(0.0045));
  ctx.stroke();

  // I2C & power traces to front 6-pin header
  for (let i = 0; i < 6; i++) {
    const hx = pxX((i - 2.5) * INA219_GEO.headerPitch);
    const hy = pyZ(INA219_GEO.headerZ);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx, pyZ(0.0125));
    ctx.stroke();
  }

  // Plated mounting holes helper
  const drawPlatedHole = (cx, cy, rOuter, rInner) => {
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = '#d4dde8';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
  };

  // Top-left & top-right plated mounting holes flanking screw terminal block
  drawPlatedHole(pxX(-0.0225), pyZ(-0.0185), 34, 21);
  drawPlatedHole(pxX(0.0225),  pyZ(-0.0185), 34, 21);

  // Rear screw terminal white silkscreen outline & labels
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 4;
  ctx.strokeRect(
    pxX(-0.0138), pyZ(-0.0235),
    pxX(0.0138) - pxX(-0.0138), pyZ(-0.0095) - pyZ(-0.0235)
  );
  ctx.fillStyle = '#fef08a';
  ctx.font = '800 26px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VIN+', pxX(-0.0108), pyZ(-0.0068));
  ctx.fillText('VIN−', pxX(0.0108),  pyZ(-0.0068));

  // Top board identification silkscreen
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 25px "JetBrains Mono", monospace';
  ctx.fillText('INA219', pxX(-0.0205), pyZ(-0.0105));
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '700 16px "JetBrains Mono", monospace';
  ctx.fillText('0-26V', pxX(0.0205), pyZ(-0.0105));

  // R100 (0.1Ω 2512 shunt) white silkscreen box & silver solder pads
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.90)';
  ctx.lineWidth = 3.5;
  ctx.strokeRect(
    pxX(-0.0072), pyZ(-0.0082),
    pxX(0.0072) - pxX(-0.0072), pyZ(-0.0008) - pyZ(-0.0082)
  );
  ctx.fillStyle = '#d4dde8';
  ctx.fillRect(pxX(-0.0066), pyZ(-0.0074), 22, 56);
  ctx.fillRect(pxX(0.0054),  pyZ(-0.0074), 22, 56);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 18px "JetBrains Mono", monospace';
  ctx.fillText('R100', pxX(0.000), pyZ(-0.0102));

  // U1 INA219A SOT-23-8 outline + label
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(
    pxX(-0.0102), pyZ(0.0022),
    pxX(-0.0008) - pxX(-0.0102), pyZ(0.0108) - pyZ(0.0022)
  );
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 17px "JetBrains Mono", monospace';
  ctx.fillText('U1', pxX(-0.0112), pyZ(0.0012));

  // C1 ceramic cap, R1/R2 103 pull-ups, R3/PWR LED silkscreen outlines
  ctx.strokeRect(pxX(-0.0192), pyZ(0.0040), pxX(-0.0138) - pxX(-0.0192), pyZ(0.0090) - pyZ(0.0040));
  ctx.fillText('C1', pxX(-0.0165), pyZ(0.0114));

  ctx.strokeRect(pxX(0.0044), pyZ(0.0030), pxX(0.0106) - pxX(0.0044), pyZ(0.0060) - pyZ(0.0030));
  ctx.strokeRect(pxX(0.0044), pyZ(0.0075), pxX(0.0106) - pxX(0.0044), pyZ(0.0105) - pyZ(0.0075));
  ctx.font = '700 15px "JetBrains Mono", monospace';
  ctx.fillText('R1', pxX(0.0126), pyZ(0.0045));
  ctx.fillText('R2', pxX(0.0126), pyZ(0.0090));

  ctx.strokeRect(pxX(-0.0230), pyZ(-0.0042), pxX(-0.0180) - pxX(-0.0230), pyZ(-0.0008) - pyZ(-0.0042));
  ctx.strokeRect(pxX(-0.0230), pyZ(0.0000),  pxX(-0.0180) - pxX(-0.0230), pyZ(0.0030)  - pyZ(0.0000));
  ctx.fillText('R3', pxX(-0.0205), pyZ(-0.0062));
  ctx.fillStyle = '#86efac';
  ctx.fillText('PWR', pxX(-0.0205), pyZ(0.0052));

  // A0 & A1 I2C address jumper pad legend
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 17px "JetBrains Mono", monospace';
  ctx.fillText('A0', pxX(0.0154), pyZ(0.0045));
  ctx.fillText('A1', pxX(0.0154), pyZ(0.0100));
  ctx.fillStyle = '#bae6fd';
  ctx.font = '700 15px "JetBrains Mono", monospace';
  ctx.fillText('I2C:0x40', pxX(0.0195), pyZ(-0.0010));

  // Bottom 6 plated through-holes & crisp front-edge silkscreen labels aligned 1:1 with INA219_GEO
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(
    pxX(-2.95 * INA219_GEO.headerPitch), pyZ(INA219_GEO.headerZ - 0.0028),
    pxX(2.95 * INA219_GEO.headerPitch) - pxX(-2.95 * INA219_GEO.headerPitch),
    pyZ(INA219_GEO.headerZ + 0.0028) - pyZ(INA219_GEO.headerZ - 0.0028)
  );
  for (let i = 0; i < 6; i++) {
    const px = pxX((i - 2.5) * INA219_GEO.headerPitch);
    const py = pyZ(INA219_GEO.headerZ);
    drawPlatedHole(px, py, 20, 9);

    const lbl = INA219_PINS[i];
    const isActive = i <= 3;
    ctx.fillStyle = isActive ? '#fef08a' : '#e2e8f0';
    ctx.font = '800 18px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(lbl, px, pyZ(0.0220));
  }

  return finalizeColorTex(c, anisotropy);
}

/**
 * 1536x768 Photorealistic Green QF-M6001-2 5V Boost UPS PCB top silkscreen matching photo image_c3e0ae71.png:
 * - '5V+' / '5V-' left input pads + USB-C IN footprint + R10/R5/R6/R11
 * - '品名: UPS不间断升压电源' & '型号: QF-M6001-2' header
 * - 'Q3 Q2 Q1 Q4' SOT-23 pads, 'U1' charger + 'R1 C1 R2 D3 D2 充满 充电'
 * - 3x 'SS54' diode outlines, 4x '220 16v VT' cap outlines (C3, C8 + 2 output), '2R2' inductor footprint
 * - 'U4' boost controller IC, 'C7 C9', 'R7 R9'
 * - Exposed bright tinned copper solder busbar rail along lower trace
 * - Spec box (输入电压 DC5V, UPS输出 DC5V/DC9V/DC12V, 输出功率 20W(MAX), BOOST升压, 单节锂电 4.2V)
 * - Parallel battery polarity graphic (+ − / + − + 电池安装)
 * - Top-right '注:' warning box, 'C4 C10 D6 R8 U3 U2 R3 C2', 'UPS+' & 'UPS-' output solder pads
 * - 4 Corner plated mounting holes + 4 battery holder lug solder pads
 */
export function createUpsQfM6001Texture(anisotropy) {
  const w = 1536;
  const h = 768;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  const pcbW = UPS_GEO.width;
  const pcbD = UPS_GEO.depth;
  const pxX = (xm) => ((xm + pcbW * 0.5) / pcbW) * w;
  const pyZ = (zm) => ((zm + pcbD * 0.5) / pcbD) * h;

  // Rich solder-mask green base with subtle copper-pour variation
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#168746');
  bg.addColorStop(0.5, '#12773d');
  bg.addColorStop(1, '#0f6834');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Darker fiberglass border margin
  ctx.strokeStyle = '#0c5229';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  // Lighter green raised copper pour zones under soldermask (authentic QF-M6001-2 copper geometry!)
  ctx.fillStyle = 'rgba(42, 168, 92, 0.42)';
  ctx.fillRect(pxX(-0.044), pyZ(-0.015), pxX(-0.014) - pxX(-0.044), pyZ(0.012) - pyZ(-0.015));
  ctx.fillRect(pxX(-0.012), pyZ(-0.018), pxX(0.022) - pxX(-0.012), pyZ(0.011) - pyZ(-0.018));
  ctx.fillRect(pxX(0.024), pyZ(-0.016), pxX(0.048) - pxX(0.024), pyZ(0.018) - pyZ(-0.016));
  ctx.fillRect(pxX(-0.022), pyZ(0.012), pxX(0.036) - pxX(-0.022), pyZ(0.023) - pyZ(0.012));

  // Exposed shiny tinned silver solder busbar strip + vertical high-current relief fingers!
  const tinGrad = ctx.createLinearGradient(0, pyZ(0.0112), 0, pyZ(0.0142));
  tinGrad.addColorStop(0, '#cfd8e3');
  tinGrad.addColorStop(0.45, '#f1f5f9');
  tinGrad.addColorStop(1, '#94a3b8');
  ctx.fillStyle = tinGrad;
  ctx.fillRect(pxX(-0.020), pyZ(0.0115), pxX(0.034) - pxX(-0.020), pyZ(0.0138) - pyZ(0.0115));
  for (let i = 0; i < 6; i++) {
    const fx = pxX(-0.020 + i * 0.0018);
    ctx.fillRect(fx, pyZ(0.0138), 11, pyZ(0.0228) - pyZ(0.0138));
  }

  // Plated holes & HASL solder pads helpers
  const drawPlatedHole = (cx, cy, rOuter, rInner) => {
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = '#dce3ec';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fillStyle = '#181c22';
    ctx.fill();
  };

  // 4 Corner mounting holes
  for (const [mx, mz] of [[-0.0472, -0.0212], [0.0472, -0.0212], [-0.0472, 0.0212], [0.0472, 0.0212]]) {
    drawPlatedHole(pxX(mx), pyZ(mz), 22, 13);
  }
  // 4 Large silver battery-holder solder lug rings (flanking left & right)
  for (const [bx, bz] of [[-0.0410, -0.0135], [-0.0410, 0.0135], [0.0410, -0.0135], [0.0410, 0.0135]]) {
    drawPlatedHole(pxX(bx), pyZ(bz), 28, 12);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(pxX(bx), pyZ(bz), 32, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 5V+ / 5V- (left) & UPS+ / UPS- (right) HASL solder pads + bold white legends
  for (const [pxm, pzm] of [[-0.0430, -0.0212], [-0.0430, 0.0212], [0.0445, -0.0205], [0.0445, 0.0205]]) {
    ctx.fillStyle = '#dce3ec';
    ctx.fillRect(pxX(pxm) - 20, pyZ(pzm) - 16, 40, 32);
    ctx.beginPath();
    ctx.arc(pxX(pxm), pyZ(pzm), 8, 0, Math.PI * 2);
    ctx.fillStyle = '#1e242c';
    ctx.fill();
  }

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '800 32px "JetBrains Mono", monospace';
  ctx.fillText('5V+', pxX(-0.0392), pyZ(-0.0208));
  ctx.fillText('5V-', pxX(-0.0392), pyZ(0.0212));

  ctx.textAlign = 'right';
  ctx.fillStyle = '#fef08a';
  ctx.font = '800 34px "JetBrains Mono", monospace';
  ctx.fillText('UPS+', pxX(0.0472), pyZ(-0.0160));
  ctx.fillStyle = '#ffffff';
  ctx.fillText('UPS-', pxX(0.0472), pyZ(0.0195));

  // Header Silkscreen: 品名 & 型号 QF-M6001-2
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 22px Inter, sans-serif';
  ctx.fillText('品名: UPS不间断升压电源', pxX(-0.0315), pyZ(-0.0214));
  ctx.font = '800 24px "JetBrains Mono", sans-serif';
  ctx.fillText('型号: QF-M6001-2', pxX(-0.0315), pyZ(-0.0180));

  // Top-right Warning Box (注:)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(pxX(0.0082), pyZ(-0.0235), pxX(0.0355) - pxX(0.0082), pyZ(-0.0138) - pyZ(-0.0235));
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 17px Inter, sans-serif';
  ctx.fillText('注:', pxX(0.0092), pyZ(-0.0214));
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText('1. UPS电源大功率输出发热属正常现象', pxX(0.0130), pyZ(-0.0216));
  ctx.fillText('2. UPS电源采用两节电池并联结构', pxX(0.0130), pyZ(-0.0190));
  ctx.fillText('3. 5V输入电源需要大于输出实际功率', pxX(0.0130), pyZ(-0.0160));

  // Bottom Spec Box (输入电压 DC5V, UPS输出, 输出功率 20W MAX, BOOST升压, 单节锂电 4.2V)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(pxX(-0.0092), pyZ(0.0145), pxX(0.0195) - pxX(-0.0092), pyZ(0.0238) - pyZ(0.0145));
  ctx.fillStyle = '#f8fafc';
  ctx.font = '600 12px "JetBrains Mono", sans-serif';
  ctx.fillText('输入电压: DC5V', pxX(-0.0082), pyZ(0.0159));
  ctx.fillText('UPS输出: DC5V/DC9V/DC12V', pxX(-0.0082), pyZ(0.0176));
  ctx.fillText('输出功率: 20W (MAX)', pxX(-0.0082), pyZ(0.0193));
  ctx.fillText('结构: BOOST升压 (大功率)', pxX(-0.0082), pyZ(0.0210));
  ctx.fillText('电池: 单节锂电并联(4.2V) 保护: 短/过/欠压', pxX(-0.0082), pyZ(0.0227));

  // Bottom-Right Twin Parallel 18650 Battery Installation Silkscreen Diagram (+ − / + −)
  for (const bz of [0.0165, 0.0210]) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(pxX(0.0210), pyZ(bz - 0.0017), pxX(0.0345) - pxX(0.0210), pyZ(bz + 0.0017) - pyZ(bz - 0.0017));
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 16px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('+', pxX(0.0225), pyZ(bz));
    ctx.fillText('-', pxX(0.0330), pyZ(bz));
  }
  ctx.save();
  ctx.translate(pxX(0.0372), pyZ(0.0188));
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 15px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('电池安装', 0, 0);
  ctx.restore();

  // Component Reference Designators matching image_c3e0ae71.png!
  const lbl = (txt, xm, zm, sz = 17, col = '#ffffff') => {
    ctx.fillStyle = col;
    ctx.font = `800 ${sz}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(txt, pxX(xm), pyZ(zm));
  };
  lbl('Q3', -0.0365, -0.0155, 16);
  lbl('Q2', -0.0322, -0.0155, 16);
  lbl('Q1', -0.0279, -0.0155, 16);
  lbl('Q4', -0.0236, -0.0155, 16);

  lbl('R10', -0.0408, -0.0072, 13);
  lbl('R5',  -0.0408, -0.0024, 13);
  lbl('R6',  -0.0408,  0.0024, 13);
  lbl('R11', -0.0408,  0.0072, 13);

  lbl('C3',  -0.0110, -0.0092, 17);
  lbl('C8',  -0.0110,  0.0068, 17);
  lbl('R1',  -0.0238,  0.0132, 16);
  lbl('C1',  -0.0422,  0.0168, 14);
  lbl('R2',  -0.0385,  0.0168, 14);
  lbl('D3',  -0.0352,  0.0168, 14);
  lbl('D2',  -0.0325,  0.0168, 14);
  lbl('充满 充电', -0.0340, 0.0226, 13, '#fef08a');
  lbl('U1',  -0.0242,  0.0218, 17);

  lbl('C7',  -0.0102,  0.0026, 15);
  lbl('C9',  -0.0068,  0.0026, 15);
  lbl('U4',   0.0065,  0.0068, 17);
  lbl('R7',   0.0102,  0.0002, 15);
  lbl('R9',   0.0102,  0.0046, 15);

  lbl('C4',   0.0298, -0.0128, 15);
  lbl('C10',  0.0332, -0.0128, 15);
  lbl('D6',   0.0382, -0.0092, 15);
  lbl('R8',   0.0382, -0.0042, 15);
  lbl('U3',   0.0384,  0.0005, 16);
  lbl('U2',   0.0384,  0.0052, 16);
  lbl('R3',   0.0382,  0.0092, 15);
  lbl('C2',   0.0382,  0.0132, 15);

  // White SMD outlines for Inductor 2R2, SS54 diodes, and 220 16v VT cans
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(pxX(-0.0068), pyZ(-0.0176), pxX(0.0068) - pxX(-0.0068), pyZ(-0.0042) - pyZ(-0.0176)); // 2R2
  ctx.strokeRect(pxX(-0.0355), pyZ(-0.0110), pxX(-0.0255) - pxX(-0.0355), pyZ(-0.0030) - pyZ(-0.0110)); // SS54 #1
  ctx.strokeRect(pxX(-0.0355), pyZ(0.0002),  pxX(-0.0255) - pxX(-0.0355), pyZ(0.0082) - pyZ(0.0002));   // SS54 #2
  ctx.strokeRect(pxX(0.0100),  pyZ(-0.0148), pxX(0.0200) - pxX(0.0100),  pyZ(-0.0068) - pyZ(-0.0148));  // SS54 #3

  return finalizeColorTex(c, anisotropy);
}

/**
 * Brushed silver SMD electrolytic capacitor top stamp ('220 / 16v / VT' + black negative crescent)
 * matching QF-M6001-2 photo image_c3e0ae71.png!
 */
export function createCap220_16vTopTexture(anisotropy) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#cfd5dd';
  ctx.fillRect(0, 0, s, s);

  ctx.beginPath();
  ctx.arc(128, 128, 122, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.fillStyle = '#181b20';
  ctx.fill();

  ctx.fillStyle = '#15181e';
  ctx.textAlign = 'center';
  ctx.font = '800 44px "JetBrains Mono", monospace';
  ctx.fillText('220', 128, 86);
  ctx.font = '800 38px "JetBrains Mono", monospace';
  ctx.fillText('16v', 128, 132);
  ctx.font = '800 36px "JetBrains Mono", monospace';
  ctx.fillText('VT', 128, 174);

  return finalizeColorTex(c, anisotropy);
}

/**
 * High-contrast wrapped cylindrical Li-Ion 18650 Battery skin ('INR18650-30Q · 3.7V 3000mAh · + / -').
 */
export function createBattery18650Texture(anisotropy) {
  const w = 512;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  // Vibrant satin sapphire-blue heatshrink PVC sleeve with subtle metallic sheen gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1d6fe8');
  grad.addColorStop(0.28, '#2b86ff');
  grad.addColorStop(0.65, '#1357bd');
  grad.addColorStop(1, '#0e4191');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Positive-end dark navy polarity band + crisp '+' marks
  ctx.fillStyle = '#0b2247';
  ctx.fillRect(0, 0, w, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 22px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let x = 44; x < w; x += 92) {
    ctx.fillText('+', x, 17);
  }

  // Printed white label repeated cleanly around cylinder circumference
  for (const yc of [92, 184]) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 24px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('INR18650-30Q  Li-Ion', w * 0.5, yc);
    ctx.fillStyle = '#bae6fd';
    ctx.font = '700 17px "JetBrains Mono", monospace';
    ctx.fillText('3.7V  3000mAh  11.1Wh  CE', w * 0.5, yc + 28);
  }

  // Negative-end ring stripe
  ctx.fillStyle = '#091a36';
  ctx.fillRect(0, h - 22, w, 22);

  return finalizeColorTex(c, anisotropy);
}

/**
 * Carrier PCB silkscreen for the inline 5V UPS safety rocker switch (SW1 · I/O).
 */
export function createUpsSwitchCarrierTexture(anisotropy) {
  const w = 512;
  const h = 320;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  // Deep matte dark-slate breakout board matching deck hardware
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#133a27');
  bg.addColorStop(1, '#0e2d1e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, w - 28, h - 28);

  // Corner mounting holes
  for (const [hx, hy] of [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]]) {
    ctx.beginPath();
    ctx.arc(hx, hy, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#d1d5db';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx, hy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();
  }

  // Left (OUT -> ESP32 5V) & Right (IN <- UPS+) solder pads aligned 1:1 with getUpsSwitchPinPos
  const pxX = (xm) => (xm / 0.036 + 0.5) * w;
  for (const [xm, lbl] of [[-0.0125, 'OUT'], [0.0125, 'IN']]) {
    const px = pxX(xm);
    ctx.beginPath();
    ctx.arc(px, h * 0.5, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, h * 0.5, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#334155';
    ctx.fill();

    ctx.fillStyle = '#fef08a';
    ctx.font = '800 22px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl, px, h * 0.5 + 36);
  }

  // Crisp top & bottom silkscreen labels
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 24px "JetBrains Mono", monospace';
  ctx.fillText('SW1 · SAKLAR 5V UPS', w * 0.5, 42);

  ctx.fillStyle = '#93c5fd';
  ctx.font = '700 17px "JetBrains Mono", monospace';
  ctx.fillText('O: PUTUS (FLASH) | I: ON (UPS)', w * 0.5, h - 38);

  return finalizeColorTex(c, anisotropy);
}

/**
 * Red KCD11 boat-rocker actuator paddle top texture with crisp white 'O' & 'I' markings.
 */
export function createRockerPaddleTexture(anisotropy) {
  const w = 256;
  const h = 160;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#b91c1c');
  g.addColorStop(0.5, '#ef4444');
  g.addColorStop(1, '#b91c1c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Subtle anti-slip grip ridges at center
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  for (let rx = w * 0.5 - 12; rx <= w * 0.5 + 12; rx += 8) {
    ctx.fillRect(rx - 1.5, 22, 3, h - 44);
  }

  // Left = 'O' (OFF), Right = 'I' (ON)
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(54, h * 0.5, 24, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillRect(w - 60, h * 0.5 - 24, 12, 48);

  return finalizeColorTex(c, anisotropy);
}


