'use strict';

const IS_LOCAL = (
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1' ||
  location.hostname.endsWith('.run.app')
);
const API_BASE = IS_LOCAL ? '' : null;
const CF_API_BASE = 'https://solartracker-api.pages.dev';
const ADMIN_TOKEN_KEY = 'st_admin_token_v1';

let isAdmin = IS_LOCAL;
let activeViewName = document.querySelector('.nav-tab.active')?.dataset?.view || 'live';
let checklistDirty = false;
let logsDirty = false;
let chartDirty = false;
let chartRafId = 0;
let lastChecklistKey = '';
let lastFaultsKey = '';
let activeChartRange = 'live';
let historyPts = [];
let historySummaryTxt = '';

function scheduleChartDraw() {
  if (activeViewName !== 'live') {
    chartDirty = true;
    return;
  }
  if (chartRafId) return;
  chartRafId = requestAnimationFrame(() => {
    chartRafId = 0;
    drawChart();
  });
}

// Video-Editor-Style Interactive Timeline State (Zoom + Pan + Playhead)
let tlZoom = 1;       // 1x .. 12x
let tlPan = 1;        // 0 = oldest left, 1 = newest right
let tlHoverX = null;  // Canvas X of cursor/touch playhead
let tlPinnedIdx = null; // Clicked/pinned point index for detailed inspector
let tlDragging = false;
let tlDragMoved = false;
let tlDragStartX = 0;
let tlDragStartPan = 1;
let tlPinchDist = 0;
let tlPinchStartZoom = 1;

let lastLogId = 0;
let paused = false;
let sliderDragging = false;
const allLogs = [];
const chartPts = [];
const MAX_PTS = 300;

let webSerialActive = false;
let serialPort = null;
let serialWriter = null;
let mqttClient = null;
let mqttConnected = false;
let mqttConnectedAt = 0;
let mqttDeviceOnline = false;
let mqttDevId = 'rig1';
let lastRenderedStatus = null;
let wsPacketCount = 0;
let wsLastTrim = 0;

// Offline detection & timestamped Event Log state
const ESP_OFFLINE_TIMEOUT_MS = 6000;
let lastTelemRxAt = 0;
let espCurrentlyOnline = false;
let localServerOnline = true;
const eventLog = [];
let showAllEvents = false;
let seenServerEventIds = new Set();
let prevDirectFaults = new Set();
let prevDirectSagPeak = 0;
let prevDirectEmiPeak = 0;
let prevDirectBo = null;
let prevDirectSunOk = null;
let prevDirectSunRsn = '';
let lastUiEventDedup = { key: '', ts: 0 };

function formatEventTime(tsMs = Date.now()) {
  const d = new Date(tsMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderEventLog() {
  const box = document.getElementById('eventLogBox');
  const cnt = document.getElementById('eventCountLabel');
  const tgl = document.getElementById('toggleEventsBtn');
  if (cnt) cnt.textContent = String(eventLog.length);
  if (tgl) tgl.textContent = showAllEvents ? '5 Terbaru' : `Semua (${eventLog.length})`;
  if (!box) return;
  if (eventLog.length === 0) {
    box.innerHTML = '<div class="event-empty">Belum ada event cahaya/error/warning/daya.</div>';
    return;
  }
  box.innerHTML = '';
  const limit = showAllEvents ? eventLog.length : Math.min(5, eventLog.length);
  for (let i = eventLog.length - 1; i >= eventLog.length - limit; i--) {
    const ev = eventLog[i];
    const row = document.createElement('div');
    row.className = `event-item ev-${ev.severity}`;
    const tsEl = document.createElement('span');
    tsEl.className = 'ev-ts';
    tsEl.textContent = ev.time;
    const catEl = document.createElement('span');
    catEl.className = 'ev-cat';
    catEl.textContent = `${ev.severity}/${ev.category}`;
    const msgEl = document.createElement('span');
    msgEl.className = 'ev-msg';
    msgEl.textContent = ev.message;
    row.appendChild(tsEl);
    row.appendChild(catEl);
    row.appendChild(msgEl);
    box.appendChild(row);
  }
}

function renderSunDebug(d) {
  const sun = d.sun;
  const txtEl = document.getElementById('sunDebugText');
  const metEl = document.getElementById('sunDebugMetrics');
  if (!txtEl || !metEl) return;
  if (!sun) {
    setPill('sunStatePill', 'sunStateText', 'st-neutral', 'FIRMWARE LAMA');
    txtEl.textContent = 'Flash firmware v0.5.5-astro-physics untuk diagnostik cahaya/matahari & NOAA lengkap.';
    metEl.textContent = `LDR1: ${d.ldr1?.raw ?? '--'} (${d.ldr1?.pct ?? 0}%) · LDR2: ${d.ldr2?.raw ?? '--'} (${d.ldr2?.pct ?? 0}%)`;
    return;
  }
  const map = {
    TRACKING_LDR1:       ['st-ok',      'TRACKING → LDR1',   'Matahari/cahaya lebih terang di LDR1 — panel sedang bergerak mengikuti cahaya.'],
    TRACKING_LDR2:       ['st-ok',      'TRACKING → LDR2',   'Matahari/cahaya lebih terang di LDR2 — panel sedang bergerak mengikuti cahaya.'],
    BALANCED_ON_SUN:     ['st-ok',      'SEIMBANG (ALIGNED)','Cahaya diterima merata di LDR1 & LDR2 — panel sudah menghadap lurus ke matahari.'],
    DIFF_BELOW_THRESH:   ['st-warn',    'SELISIH KECIL',     `Cahaya terdeteksi, tapi selisih LDR (${sun.adv >= 0 ? '+' : ''}${sun.adv}) < ambang (${sun.thr}). Untuk sumber cahaya jauh (>1–3 m), pasang sekat/baffle pemisah di antara LDR1 & LDR2 agar bayangan lebih kontras.`],
    TOO_DARK_NO_SUN:     ['st-neutral', 'GELAP / NO SUN',    `Belum ada cahaya cukup di atas dasar gelap (Exc LDR1=${sun.e1}, LDR2=${sun.e2}, ambang=${sun.thr}). Jika di ruangan redup/cahaya jauh, klik "Gelap 0%" dulu di kondisi gelap.`],
    BOTH_SATURATED_EQUAL:['st-warn',    'MENTOK CAHAYA',     'Kedua LDR mentok jenuh oleh matahari terik dengan nilai sama — pasang sekat bayangan di antara LDR atau putar trimpot modul LM393.'],
    CLOCK_MODE:          ['st-ok',      'CLOCK (ASTRO RTC)', 'Mode CLOCK (NOAA Astro) aktif — panel mengikuti sudut matahari dari jam RTC (bebas gangguan bayangan/awan).'],
    MANUAL_MODE:         ['st-warn',    'MODE MANUAL',       'Cahaya terdeteksi, tapi servo sedang di mode MANUAL. Klik "AUTO (LDR)" / "CLOCK" / "HYBRID" untuk tracking otomatis.'],
    SAFE_LOCKED:         ['st-err',     'SAFE-LOCK AKTIF',   'Cahaya terdeteksi, tapi PWM dikunci pasca BROWNOUT. Pastikan suplai 6V XL4015 & Common GND lalu klik AUTO TRACK / unlock.'],
    AT_LIMIT:            ['st-warn',    'MENTOK BATAS AMAN', `Cahaya masih lebih terang di satu sisi, tapi servo sudah di batas aman (${d.servo?.min ?? 15}°–${d.servo?.max ?? 165}°).`],
    NIGHT_PARKED:        ['st-neutral', 'NIGHT-PARK AKTIF',  `Panel diparkir di ${d.park?.deg ?? 90}° (PWM OFF) menunggu matahari pagi. Otomatis bangun saat cahaya terdeteksi > 10 dtk.`],
    WIRING_FAULT:        ['st-err',     'CEK KABEL LDR',     'Sensor LDR mengalami error wiring/noise — tracking dihentikan sementara.']
  };
  const [cls, badge, desc] = map[sun.rsn] || ['st-neutral', sun.st || '--', `Status: ${sun.rsn || '--'}`];
  setPill('sunStatePill', 'sunStateText', cls, badge);
  txtEl.textContent = desc;
  const parkInfo = d.park
    ? (d.park.on ? ` · NightPark ON (${d.park.deg}°)` : (d.park.darkS > 0 ? ` · Parkir dalam ${Math.max(0, (d.park.thrS || 300) - d.park.darkS)}d` : ` · Park: ${d.park.deg}°`))
    : '';
  metEl.textContent = `Lux: ${sun.lx1} / ${sun.lx2} lx · Exc: ${sun.e1} / ${sun.e2} · Selisih: ${sun.adv >= 0 ? '+' : ''}${sun.adv} (Ambang: ±${sun.thr})${parkInfo}`;
}

function pushEvent(severity, category, message, customTime = null) {
  const now = Date.now();
  const key = `${severity}|${category}|${message}`;
  if (!customTime && lastUiEventDedup.key === key && (now - lastUiEventDedup.ts) < 2500) return;
  if (!customTime) lastUiEventDedup = { key, ts: now };
  eventLog.push({
    time: customTime || formatEventTime(now),
    severity: severity || 'INFO',
    category: category || 'SYS',
    message: String(message || '')
  });
  while (eventLog.length > 200) eventLog.shift();
  renderEventLog();
}

function markEspOffline(reason) {
  const wasOnline = espCurrentlyOnline;
  espCurrentlyOnline = false;
  mqttDeviceOnline = false;
  setPill('connPill', 'connText', 'st-err', 'ESP32 OFFLINE');
  const exp = document.getElementById('explainText');
  if (exp) exp.textContent = `ESP32 OFFLINE (${formatEventTime()}): ${reason}`;
  const rx = document.getElementById('lastRxLabel');
  if (rx && lastTelemRxAt > 0) rx.textContent = `RX: ${Math.round((Date.now() - lastTelemRxAt) / 1000)} dtk lalu (OFFLINE)`;
  if (wasOnline || eventLog.length === 0) {
    pushEvent('ERROR', 'CONN', `ESP32 OFFLINE — ${reason}`);
  }
}

function setPill(pillId, textId, statusClass, text) {
  const pill = document.getElementById(pillId);
  const txt = document.getElementById(textId);
  if (pill) pill.className = 'status-pill ' + statusClass;
  if (txt) txt.textContent = text;
}

function mapHealth(h) {
  if (h === 'OK') return ['NORMAL', 'st-ok'];
  if (h === 'SATURATED_HIGH') return ['MENTOK ATAS', 'st-warn'];
  if (h === 'SATURATED_LOW') return ['MENTOK BAWAH', 'st-warn'];
  return ['CEK KABEL', 'st-err'];
}

function mapDecision(dec) {
  if (dec === 'HOLD') return 'DIAM (Deadband)';
  if (dec === 'LDR1 BRIGHTER') return 'KE LDR1 (Kiri)';
  if (dec === 'LDR2 BRIGHTER') return 'KE LDR2 (Kanan)';
  return dec;
}

function setupHiDpiCanvas(canvas, fixedW, fixedH) {
  const rect = canvas.getBoundingClientRect();
  const w = fixedW || Math.max(100, Math.round(rect.width));
  const h = fixedH || Math.max(80, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const needW = Math.round(w * dpr);
  const needH = Math.round(h * dpr);
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width = needW;
    canvas.height = needH;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function estimateLightSource(p1, p2, servoDeg, invert, fwLight) {
  const maxPct = Math.max(p1 || 0, p2 || 0);
  if (maxPct <= 1 && !(fwLight && fwLight.deg >= 0)) {
    return { active: false, deg: null, label: 'Gelap / Tidak Terdeteksi' };
  }
  const diff = (p1 || 0) - (p2 || 0);
  const dirSign = invert ? -1 : 1;
  const estDeg = (fwLight && typeof fwLight.deg === 'number' && fwLight.deg >= 0)
    ? fwLight.deg
    : Math.max(0, Math.min(180, Math.round((servoDeg ?? 90) + dirSign * (diff * 0.45))));
  const dirTxt = estDeg < 65 ? 'Kiri' : (estDeg > 115 ? 'Kanan' : 'Tengah');
  if (fwLight && typeof fwLight.lux === 'number' && fwLight.lux > 0) {
    const luxStr = fwLight.lux >= 1000 ? `${(fwLight.lux / 1000).toFixed(1)}k lux` : `${fwLight.lux} lux`;
    const distStr = fwLight.lux > 15000
      ? 'Matahari Terik'
      : (fwLight.cm > 0 ? `Est. ~${fwLight.cm} cm` : 'Jauh (>2 m)');
    return { active: true, deg: estDeg, label: `${dirTxt} ~${estDeg}° · ${luxStr} · ${distStr}` };
  }
  const distTxt = maxPct > 80
    ? 'Sangat Dekat (<15cm) / Terik'
    : (maxPct > 45 ? 'Dekat (15–40cm) / Cerah' : (maxPct > 15 ? 'Sedang (40–100cm)' : 'Jauh (>1m) / Redup'));
  return { active: true, deg: estDeg, label: `${dirTxt} ~${estDeg}° · ${distTxt}` };
}

function drawServoGauge(deg, targetDeg, lightDeg = null) {
  const c = document.getElementById('servoGauge');
  if (!c) return;
  const { ctx, w, h } = setupHiDpiCanvas(c, 210, 122);
  const cx = w / 2, cy = h - 18, r = 78;
  ctx.clearRect(0, 0, w, h);

  const rad = (d) => Math.PI + (Math.max(0, Math.min(180, d)) / 180) * Math.PI;

  // 1. Subtle radial precision ticks (every 15 deg)
  for (let d = 0; d <= 180; d += 15) {
    const a = rad(d);
    const major = (d % 45 === 0);
    const inner = major ? r - 17 : r - 13;
    const outer = r - 9;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.strokeStyle = major ? 'rgba(29, 29, 31, 0.28)' : 'rgba(29, 29, 31, 0.12)';
    ctx.lineWidth = major ? 1.5 : 1;
    ctx.stroke();
  }

  // 2. Soft recessed Apple track arc (0..180 deg)
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, rad(0), rad(180), false);
  ctx.strokeStyle = 'rgba(118, 118, 128, 0.14)';
  ctx.lineWidth = 10;
  ctx.stroke();

  // 3. Safe mechanical range arc (15..165 deg)
  ctx.beginPath();
  ctx.arc(cx, cy, r, rad(15), rad(165), false);
  ctx.strokeStyle = 'rgba(0, 122, 255, 0.16)';
  ctx.lineWidth = 10;
  ctx.stroke();

  // 4. Active System Blue progress arc from 90 deg center -> current deg
  const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  grad.addColorStop(0, '#34aadc');
  grad.addColorStop(0.5, '#007aff');
  grad.addColorStop(1, '#5856d6');
  const a0 = rad(Math.min(90, deg));
  const a1 = rad(Math.max(90, deg));
  if (Math.abs(deg - 90) > 0.5) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1, false);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 10;
    ctx.stroke();
  }

  // 5. Target marker (Apple Orange ring dot on arc)
  const ta = rad(targetDeg);
  const tx = cx + Math.cos(ta) * r;
  const ty = cy + Math.sin(ta) * r;
  ctx.beginPath();
  ctx.arc(tx, ty, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ff9500';
  ctx.stroke();

  // 5b. Estimated Light Source Sun Marker (golden glow dot on outer arc)
  if (typeof lightDeg === 'number') {
    const la = rad(lightDeg);
    const lx = cx + Math.cos(la) * (r + 1);
    const ly = cy + Math.sin(la) * (r + 1);
    ctx.save();
    ctx.shadowColor = 'rgba(255, 204, 0, 0.75)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcc00';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }

  // 6. Tapered macOS precision needle with soft shadow
  const ca = rad(deg);
  const tipX = cx + Math.cos(ca) * (r - 12);
  const tipY = cy + Math.sin(ca) * (r - 12);
  const perpX = -Math.sin(ca);
  const perpY = Math.cos(ca);

  ctx.save();
  ctx.shadowColor = 'rgba(0, 122, 255, 0.28)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.moveTo(cx + perpX * 3.4, cy + perpY * 3.4);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(cx - perpX * 3.4, cy - perpY * 3.4);
  ctx.closePath();
  ctx.fillStyle = '#1d1d1f';
  ctx.fill();
  ctx.restore();

  // 7. Glossy Apple pivot hub
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#007aff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // 8. Minimal degree labels (15°, 90°, 165°)
  ctx.fillStyle = '#86868b';
  ctx.font = '600 9.5px "SF Mono", "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('90°', cx, cy - r + 26);
  ctx.textAlign = 'left';
  ctx.fillText('15°', 10, h - 6);
  ctx.textAlign = 'right';
  ctx.fillText('165°', w - 10, h - 6);
  ctx.textAlign = 'start';
}

function updateZoomLabel() {
  const b = document.getElementById('btnZoomReset');
  if (b) b.textContent = tlZoom <= 1.01 ? '1×' : `${tlZoom.toFixed(1)}×`;
}

function getActiveChartPts() {
  return (activeChartRange !== 'live') ? historyPts : chartPts;
}

function clampTimeline() {
  tlZoom = Math.max(1, Math.min(12, tlZoom));
  tlPan = Math.max(0, Math.min(1, tlPan));
  updateZoomLabel();
}

function renderChartInspector() {
  const box = document.getElementById('chartInspector');
  if (!box) return;
  const allPts = getActiveChartPts();
  if (tlPinnedIdx === null || tlPinnedIdx < 0 || tlPinnedIdx >= allPts.length) {
    box.style.display = 'none';
    return;
  }
  const pt = allPts[tlPinnedIdx];
  const prev = tlPinnedIdx > 0 ? allPts[tlPinnedIdx - 1] : pt;
  const d1 = (pt.p1 || 0) - (prev.p1 || 0);
  const d2 = (pt.p2 || 0) - (prev.p2 || 0);
  const arrow = (d) => d > 0 ? ` ▲+${d}%` : (d < 0 ? ` ▼${d}%` : '');
  const dt = pt.ts ? new Date(pt.ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : `Titik #${tlPinnedIdx + 1}`;
  document.getElementById('inspTime').textContent = `📌 ${dt}`;
  document.getElementById('inspL1').textContent = `LDR1: ${pt.p1}%${arrow(d1)}${pt.r1 !== undefined ? ` (${pt.r1} raw${pt.mv1 ? `/${pt.mv1}mV` : ''})` : ''}`;
  document.getElementById('inspL2').textContent = `LDR2: ${pt.p2}%${arrow(d2)}${pt.r2 !== undefined ? ` (${pt.r2} raw${pt.mv2 ? `/${pt.mv2}mV` : ''})` : ''}`;
  const diff = (pt.p1 || 0) - (pt.p2 || 0);
  const metaParts = [`Δ ${diff >= 0 ? '+' : ''}${diff}%`];
  if (typeof pt.deg === 'number') metaParts.push(`Servo ${pt.deg}°`);
  if (typeof pt.tempC === 'number' && pt.tempC > 0) metaParts.push(`${pt.tempC}°C`);
  if (typeof pt.rssi === 'number' && pt.rssi < 0) metaParts.push(`${pt.rssi}dBm`);
  document.getElementById('inspMeta').textContent = metaParts.join(' · ');
  box.style.display = 'flex';
}

function drawChart() {
  const c = document.getElementById('chart');
  if (!c) return;
  const { ctx, w, h } = setupHiDpiCanvas(c);
  ctx.clearRect(0, 0, w, h);

  const isHist = activeChartRange !== 'live';
  const allPts = getActiveChartPts();
  const leftPad = 40, rightPad = 12, topPad = 14, botPad = 28;
  const plotW = w - leftPad - rightPad;
  const plotH = h - topPad - botPad;

  // Horizontal percentage grid
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.07)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#86868b';
  ctx.font = '11px "SF Mono", "JetBrains Mono", monospace';
  [100, 50, 0].forEach((pct, i) => {
    const py = topPad + plotH * (i / 2);
    ctx.beginPath();
    ctx.moveTo(leftPad, py);
    ctx.lineTo(w - rightPad, py);
    ctx.stroke();
    ctx.fillText(pct + '%', 4, py + 4);
  });

  if (allPts.length < 2) {
    ctx.fillStyle = '#86868b';
    ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(
      isHist
        ? 'Belum cukup data histori untuk rentang ini (ESP32 simpan 1 titik/menit ke Cloudflare D1).'
        : 'Menunggu data live...',
      leftPad + 12,
      topPad + plotH / 2
    );
    return;
  }

  // Compute visible slice based on zoom & pan
  const total = allPts.length;
  const visCount = Math.max(2, Math.round(total / tlZoom));
  const maxStart = Math.max(0, total - visCount);
  const startIdx = Math.round(tlPan * maxStart);
  const endIdx = Math.min(total - 1, startIdx + visCount - 1);
  const span = Math.max(1, endIdx - startIdx);

  const xAt = (idx) => leftPad + ((idx - startIdx) / span) * plotW;
  const yAt = (pct) => (topPad + plotH) - (Math.max(0, Math.min(100, pct || 0)) / 100) * plotH;

  // Soft Apple-blue gradient area fill under LDR1
  const grad = ctx.createLinearGradient(0, topPad, 0, topPad + plotH);
  grad.addColorStop(0, 'rgba(0, 122, 255, 0.14)');
  grad.addColorStop(1, 'rgba(0, 122, 255, 0.0)');
  ctx.beginPath();
  ctx.moveTo(xAt(startIdx), topPad + plotH);
  for (let i = startIdx; i <= endIdx; i++) ctx.lineTo(xAt(i), yAt(allPts[i].p1));
  ctx.lineTo(xAt(endIdx), topPad + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // LDR1 Solid (Apple Blue)
  ctx.strokeStyle = '#007aff';
  ctx.lineWidth = 2.4;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = startIdx; i <= endIdx; i++) {
    const x = xAt(i), y = yAt(allPts[i].p1);
    if (i === startIdx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // LDR2 Dashed (Dark Graphite)
  ctx.strokeStyle = '#515154';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  for (let i = startIdx; i <= endIdx; i++) {
    const x = xAt(i), y = yAt(allPts[i].p2);
    if (i === startIdx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // X-axis time ticks (5 evenly spaced marks)
  ctx.fillStyle = '#86868b';
  ctx.font = '10px "SF Mono", "JetBrains Mono", monospace';
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtTs = (ts) => {
    if (!ts) return '';
    const dt = new Date(ts);
    return activeChartRange === '7d'
      ? `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`
      : `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`;
  };
  for (let m = 0; m < 4; m++) {
    const idx = Math.round(startIdx + (span * m) / 3);
    const lbl = fmtTs(allPts[idx]?.ts);
    if (!lbl) continue;
    const tx = xAt(idx);
    const drawX = (m === 3) ? Math.min(tx - 54, w - 66) : (m === 0 ? leftPad : tx - 24);
    ctx.fillText(lbl, drawX, topPad + plotH + 13);
  }

  // Timeline mini scrollbar indicator at very bottom when zoomed
  if (tlZoom > 1.02) {
    const barY = h - 5;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.fillRect(leftPad, barY, plotW, 3);
    const thumbW = Math.max(24, plotW / tlZoom);
    const thumbX = leftPad + tlPan * (plotW - thumbW);
    ctx.fillStyle = '#007aff';
    ctx.fillRect(thumbX, barY, thumbW, 3);
  }

  // Draw Pinned Marker if user clicked a point
  if (tlPinnedIdx !== null && tlPinnedIdx >= startIdx && tlPinnedIdx <= endIdx) {
    const ptP = allPts[tlPinnedIdx];
    const pxP = xAt(tlPinnedIdx);
    ctx.strokeStyle = '#ff9500';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pxP, topPad);
    ctx.lineTo(pxP, topPad + plotH);
    ctx.stroke();
    ctx.fillStyle = '#ff9500';
    ctx.beginPath(); ctx.arc(pxP, yAt(ptP.p1), 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(pxP, yAt(ptP.p2), 4.5, 0, Math.PI * 2); ctx.fill();
  }

  // Video-Editor Playhead Crosshair & Floating Tooltip on Hover/Scrub
  if (tlHoverX !== null && tlHoverX >= leftPad && tlHoverX <= w - rightPad) {
    const ratio = (tlHoverX - leftPad) / plotW;
    const idx = Math.max(startIdx, Math.min(endIdx, Math.round(startIdx + ratio * span)));
    const pt = allPts[idx];
    const px = xAt(idx);
    const py1 = yAt(pt.p1);
    const py2 = yAt(pt.p2);

    // Playhead vertical line
    ctx.strokeStyle = 'rgba(0, 122, 255, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, topPad);
    ctx.lineTo(px, topPad + plotH);
    ctx.stroke();

    // Playhead cap triangle
    ctx.fillStyle = '#007aff';
    ctx.beginPath();
    ctx.moveTo(px - 5, topPad - 2);
    ctx.lineTo(px + 5, topPad - 2);
    ctx.lineTo(px, topPad + 5);
    ctx.closePath();
    ctx.fill();

    // Active point dots
    ctx.fillStyle = '#007aff';
    ctx.beginPath(); ctx.arc(px, py1, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#515154';
    ctx.beginPath(); ctx.arc(px, py2, 3.5, 0, Math.PI * 2); ctx.fill();

    // Frosted macOS tooltip box
    const timeStr = fmtTs(pt.ts) || `#${idx + 1}`;
    const line1 = `${timeStr}`;
    const line2 = `LDR1: ${pt.p1}%  ·  LDR2: ${pt.p2}%`;
    const line3 = (typeof pt.deg === 'number') ? `Servo: ${pt.deg}°${typeof pt.tempC === 'number' ? ` · ${pt.tempC}°C` : ''}` : '';
    const boxW = 172;
    const boxH = line3 ? 52 : 38;
    const bx = (px + 12 + boxW > w - rightPad) ? (px - boxW - 12) : (px + 12);
    const by = topPad + 8;

    ctx.fillStyle = 'rgba(29, 29, 31, 0.88)';
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 8);
    ctx.fill();

    ctx.fillStyle = '#a1a1a6';
    ctx.font = '10px "SF Mono", "JetBrains Mono", monospace';
    ctx.fillText(line1, bx + 9, by + 14);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 11px "SF Mono", "JetBrains Mono", monospace';
    ctx.fillText(line2, bx + 9, by + 29);
    if (line3) {
      ctx.fillStyle = '#93c5fd';
      ctx.font = '10px "SF Mono", "JetBrains Mono", monospace';
      ctx.fillText(line3, bx + 9, by + 44);
    }
  }
}

function renderChecklist(items) {
  const box = document.getElementById('checklistBox');
  if (!box || !Array.isArray(items)) return;
  if (activeViewName !== 'check') {
    checklistDirty = true;
    return;
  }
  const key = items.map((it) => `${it.title}|${it.status}|${it.badge}|${it.detail}`).join('||');
  if (key === lastChecklistKey && !checklistDirty) return;
  lastChecklistKey = key;
  checklistDirty = false;

  let okCount = 0, errCount = 0;
  const frag = document.createDocumentFragment();
  for (const it of items) {
    if (it.status === 'ok') okCount++;
    if (it.status === 'err') errCount++;
    const stClass = it.status === 'ok' ? 'st-ok' : (it.status === 'err' ? 'st-err' : 'st-warn');
    const div = document.createElement('div');
    div.className = 'check-row';
    div.innerHTML = `
      <div class="check-row-head">
        <span class="check-row-title">${it.title}</span>
        <span class="status-pill ${stClass}"><span class="status-dot"></span><span>${it.badge}</span></span>
      </div>
      <div class="check-row-detail">${it.detail}</div>
    `;
    frag.appendChild(div);
  }
  box.replaceChildren(frag);
  const sumClass = errCount > 0 ? 'st-err' : (okCount === items.length ? 'st-ok' : 'st-warn');
  setPill('checklistSummaryPill', 'checklistPillText', sumClass, `${okCount}/${items.length} OK`);
}

function renderStatus(d) {
  if (d.sourceMode === 'sim') setPill('connPill', 'connText', 'st-warn', `SIM (${d.preset})`);
  else if (d.espOnline === false) setPill('connPill', 'connText', 'st-err', 'ESP32 OFFLINE');
  else if (d.hardwareConnected) setPill('connPill', 'connText', 'st-ok', `LIVE ${d.serialPort}`);
  else setPill('connPill', 'connText', 'st-err', 'ESP32 OFFLINE');

  const presetEl = document.getElementById('presetSelect');
  if (presetEl && document.activeElement !== presetEl && d.preset && presetEl.value !== d.preset) {
    presetEl.value = d.preset;
  }

  if (Array.isArray(d.events)) {
    let added = false;
    for (const ev of d.events) {
      if (ev && ev.id && !seenServerEventIds.has(ev.id)) {
        seenServerEventIds.add(ev.id);
        eventLog.push({
          time: ev.time || formatEventTime(),
          severity: ev.severity || 'INFO',
          category: ev.category || 'SYS',
          message: ev.message || ''
        });
        added = true;
      }
    }
    if (added) {
      while (eventLog.length > 200) eventLog.shift();
      renderEventLog();
    }
  }

  const isV3 = /^(SIM-)?0\.[345]\./.test(d.firmwareVersion || '');
  setPill('fwPill', 'fwPillText', isV3 ? 'st-ok' : 'st-warn', d.firmwareVersion || '--');
  document.getElementById('rtcTopChip').textContent = d.rtc.time || '--';
  if (activeChartRange === 'live') {
    document.getElementById('pktChip').textContent = `${d.packetCount || 0} pkt · ${d.packetRateHz || 0} Hz`;
  } else if (historySummaryTxt) {
    document.getElementById('pktChip').textContent = historySummaryTxt;
  }

  // LDR 1
  const [h1Lbl, h1Cls] = mapHealth(d.ldr1.health);
  setPill('b1', 'b1Text', h1Cls, h1Lbl);
  document.getElementById('p1').textContent = `${d.ldr1.pct}%`;
  document.getElementById('bar1').style.width = `${d.ldr1.pct}%`;
  document.getElementById('raw1').textContent = `${d.ldr1.raw} / 4095`;
  document.getElementById('mv1').textContent = `${d.ldr1.mv} mV`;
  document.getElementById('win1').textContent = `${d.ldr1.min} / ${d.ldr1.max} (SD ${d.ldr1.sd})`;
  document.getElementById('bih1').textContent = d.ldr1.bih ? 'Normal (ADC naik saat terang)' : 'Inverted (ADC turun saat terang)';

  // LDR 2
  const [h2Lbl, h2Cls] = mapHealth(d.ldr2.health);
  setPill('b2', 'b2Text', h2Cls, h2Lbl);
  document.getElementById('p2').textContent = `${d.ldr2.pct}%`;
  document.getElementById('bar2').style.width = `${d.ldr2.pct}%`;
  document.getElementById('raw2').textContent = `${d.ldr2.raw} / 4095`;
  document.getElementById('mv2').textContent = `${d.ldr2.mv} mV`;
  document.getElementById('win2').textContent = `${d.ldr2.min} / ${d.ldr2.max} (SD ${d.ldr2.sd})`;
  document.getElementById('bih2').textContent = d.ldr2.bih ? 'Normal (ADC naik saat terang)' : 'Inverted (ADC turun saat terang)';

  // Servo MG996R (Metal Gear)
  const srv = d.servo || { mode: 'AUTO', deg: 90, target: 90, trim: 0, min: 15, max: 165, ctr: 90, invert: false, pwm: false, locked: false, softStart: false };
  const sMin = srv.min ?? 15;
  const sMax = srv.max ?? 165;
  const sCtr = srv.ctr ?? Math.round((sMin + sMax) / 2);
  const sCls = srv.locked ? 'st-err' : ((srv.mode === 'AUTO' || srv.mode === 'CLOCK' || srv.mode === 'HYBRID') ? 'st-ok' : 'st-warn');
  setPill('servoModePill', 'servoModeText', sCls, srv.locked ? 'SAFE-LOCK' : srv.mode);
  const curModeUpper = String(srv.mode || 'AUTO').toUpperCase();
  document.querySelectorAll('.mac-segmented .seg-btn[data-mode]').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === curModeUpper);
  });
  document.getElementById('servoDegBig').textContent = `${srv.deg}°`;
  document.getElementById('servoTargetTxt').textContent = `${srv.target}°`;
  const rangeEl = document.getElementById('servoRangeTxt');
  if (rangeEl) rangeEl.textContent = `${sMin}°–${sMax}°`;
  const minLbl = document.getElementById('sliderMinLbl');
  const maxLbl = document.getElementById('sliderMaxLbl');
  if (minLbl) minLbl.textContent = `${sMin}°`;
  if (maxLbl) maxLbl.textContent = `${sMax}°`;
  const goCtrBtn = document.getElementById('btnGoCenter');
  if (goCtrBtn) goCtrBtn.textContent = `Ke Tengah (${sCtr}°)`;
  const trimVal = srv.trim || 0;
  document.getElementById('servoTrimTxt').textContent = `${trimVal >= 0 ? '+' : ''}${trimVal}°`;
  document.getElementById('servoInvTxt').textContent = srv.invert ? 'Ya (Dibalik)' : 'Normal';
  document.getElementById('servoPwmTxt').textContent = srv.locked ? 'LOCKED (OFF)' : (srv.softStart ? 'RAMPING' : (srv.pwm ? 'AKTIF' : 'IDLE'));

  const clkEl = document.getElementById('clockTargetTxt');
  if (clkEl && d.clk) {
    const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const sStr = fmtMin(d.clk.sMin ?? 360);
    const eStr = fmtMin(d.clk.eMin ?? 1080);
    const biasTxt = (srv.mode === 'HYBRID' && d.clk.bias) ? ` (bias ${d.clk.bias >= 0 ? '+' : ''}${d.clk.bias}°)` : '';
    clkEl.textContent = d.clk.day
      ? `${d.clk.deg}°${biasTxt} · ${sStr}–${eStr} (${d.clk.pct || 0}%)`
      : `Malam → Parkir ${d.clk.deg}° (${sStr}–${eStr})`;
    const sInp = document.getElementById('clockStartInp');
    const eInp = document.getElementById('clockEndInp');
    const bInp = document.getElementById('clockBiasInp');
    if (sInp && document.activeElement !== sInp) sInp.value = sStr;
    if (eInp && document.activeElement !== eInp) eInp.value = eStr;
    if (bInp && document.activeElement !== bInp && typeof d.clk.maxB === 'number') bInp.value = String(d.clk.maxB);
  }
  const astroEl = document.getElementById('astroPhysicsTxt');
  if (astroEl && d.astro) {
    const a = d.astro;
    const eotStr = `${a.eot >= 0 ? '+' : ''}${Number(a.eot || 0).toFixed(1)}m`;
    astroEl.textContent = `El ${Number(a.el || 0).toFixed(1)}° · Az ${a.az ?? 90}° · EoT ${eotStr} · CosEff ${Number(a.eff ?? 100).toFixed(1)}% · w=${Number(a.w || 0).toFixed(2)} · lnR=${Number(a.logE || 0).toFixed(2)}`;
    const latInp = document.getElementById('geoLatInp');
    const lonInp = document.getElementById('geoLonInp');
    const stpInp = document.getElementById('cosStepInp');
    if (latInp && document.activeElement !== latInp && typeof a.lat === 'number') latInp.value = a.lat.toFixed(2);
    if (lonInp && document.activeElement !== lonInp && typeof a.lon === 'number') lonInp.value = a.lon.toFixed(2);
    if (stpInp && document.activeElement !== stpInp && typeof a.step === 'number') stpInp.value = String(a.step);
  }
  document.getElementById('dec').textContent = mapDecision(d.decision);
  document.getElementById('knDelta').textContent = `${d.delta >= 0 ? '+' : ''}${d.delta}%`;
  const lightEst = estimateLightSource(d.ldr1.pct, d.ldr2.pct, srv.deg, srv.invert, d.light);
  const lvEl = document.getElementById('lightVectorTxt');
  if (lvEl) lvEl.textContent = lightEst.label;
  const slEl = document.getElementById('servoSlider');
  if (slEl) {
    slEl.min = String(sMin);
    slEl.max = String(sMax);
    if (!sliderDragging) slEl.value = srv.target;
  }
  if (activeViewName === 'live') {
    drawServoGauge(srv.deg, srv.target, lightEst.deg);
  }
  renderSunDebug(d);

  // Faults & Diagnosis (memoized to prevent 4Hz DOM rebuilds)
  const faults = Array.isArray(d.faults) ? d.faults : [];
  const fb = document.getElementById('faultCountBadge');
  if (faults.length > 0) { fb.style.display = 'inline-block'; fb.textContent = String(faults.length); }
  else fb.style.display = 'none';

  const faultsKey = faults.join('|');
  if (faultsKey !== lastFaultsKey) {
    lastFaultsKey = faultsKey;
    const fp = document.getElementById('faultPills');
    if (faults.length === 0) {
      fp.innerHTML = '<span class="status-pill st-ok"><span class="status-dot"></span>NO FAULTS</span>';
    } else {
      fp.innerHTML = faults.map((f) => {
        const cls = (f.includes('BROWNOUT') || f.includes('WIRING') || f.includes('WRONG') || f.includes('NO_RESPONSE')) ? 'st-err' : 'st-warn';
        return `<span class="status-pill ${cls}"><span class="status-dot"></span>${f}</span>`;
      }).join('');
    }
  }

  document.getElementById('explainText').textContent = d.explain || '';
  const gb = document.getElementById('guideBanner');
  if (d.guide && d.guide.state && d.guide.state !== 'IDLE') {
    gb.style.display = 'block';
    document.getElementById('guideText').textContent = d.guide.prompt;
  } else gb.style.display = 'none';

  // Debug & Matrix
  const upMs = d.uptimeMs || 0;
  const upSec = Math.floor(upMs / 1000);
  const upH = Math.floor(upSec / 3600), upM = Math.floor((upSec % 3600) / 60), upS = upSec % 60;
  const upFmt = `${String(upH).padStart(2, '0')}j ${String(upM).padStart(2, '0')}m ${String(upS).padStart(2, '0')}d`;
  const elUp = document.getElementById('uptimeTxt');
  if (elUp) elUp.textContent = upMs ? upFmt : '--';
  const elBoot = document.getElementById('bootCountTxt');
  if (elBoot) elBoot.textContent = d.bootCount ? `#${d.bootCount}` : '#--';
  document.getElementById('blackboxLabel').textContent = d.wifi?.ok
    ? `WiFi: ${d.wifi.ssid} (${d.wifi.ip || '-'}) · ${d.wifi.rssi} dBm · CH${d.wifi.ch || '?'} · Putus ${d.wifi.disc || 0}x · MQTT Reconn ${d.mqtt?.reconn || 0}x`
    : `Blackbox: logs/${d.blackboxFile || '--'}`;
  document.getElementById('resetReasonTxt').textContent = d.resetReason || '--';
  const heapKb = d.freeHeap ? `${Math.round(d.freeHeap / 1024)} KB` : '--';
  const minHeapKb = d.minHeap ? ` (min ${Math.round(d.minHeap / 1024)} KB)` : '';
  document.getElementById('heapTxt').textContent = heapKb + minHeapKb;
  const elMetaWifi = document.getElementById('metaWifi');
  if (elMetaWifi) {
    elMetaWifi.textContent = d.wifi?.ok
      ? `${d.wifi.ssid} · ${d.wifi.ip || '-'} · ${d.wifi.rssi} dBm · Disc ${d.wifi.disc || 0}x · MQTT Reconn ${d.mqtt?.reconn || 0}x (Fail ${d.mqtt?.fail || 0})`
      : 'Offline / USB Only';
  }
  const elMetaUp = document.getElementById('metaUptime');
  if (elMetaUp) {
    const tempTxt = (typeof d.tempC === 'number') ? ` · ${d.tempC.toFixed(1)}°C` : '';
    const loopTxt = (typeof d.loopMs === 'number') ? ` · Loop ${d.loopMs}ms` : '';
    const allocTxt = d.maxAlloc ? ` · MaxAlloc ${Math.round(d.maxAlloc / 1024)}KB` : '';
    elMetaUp.textContent = `${upMs ? upFmt : '--'} · Boot #${d.bootCount ?? '?'}${tempTxt}${loopTxt}${allocTxt}`;
  }
  const elMetaPwr = document.getElementById('metaPower');
  if (elMetaPwr) {
    const pwr = d.pwr || {};
    const srvInfo = d.servo || {};
    elMetaPwr.textContent = `3V3 Sag ${pwr.sagMv || 0}mV · EMI +${pwr.emiSd || 0}SD · PWM ${srvInfo.us || 1500}µs (${srvInfo.moves || 0} step, ${srvInfo.pwmS || 0}s) · I2C Err ${d.i2cErr || 0}`;
  }

  // Public Summary Stat Tiles
  const elPubTemp = document.getElementById('pubTemp');
  if (elPubTemp) {
    const tc = (typeof d.tempC === 'number') ? d.tempC : null;
    elPubTemp.textContent = tc !== null ? `${tc.toFixed(1)}°C` : '--°C';
    const sub = document.getElementById('pubTempSub');
    if (sub) sub.textContent = tc === null ? 'Sensor internal' : (tc < 55 ? 'Normal & aman' : (tc < 70 ? 'Hangat' : 'Panas!'));
  }
  const elPubRssi = document.getElementById('pubRssi');
  if (elPubRssi) {
    const rssi = d.wifi?.ok ? d.wifi.rssi : null;
    elPubRssi.textContent = rssi !== null ? `${rssi} dBm` : 'Offline';
    const sub = document.getElementById('pubWifiSub');
    if (sub) sub.textContent = rssi === null ? 'Menunggu WiFi' : (rssi >= -55 ? 'Sangat Kuat' : (rssi >= -70 ? 'Stabil' : 'Lemah'));
  }
  const elPubUp = document.getElementById('pubUptime');
  if (elPubUp) {
    elPubUp.textContent = upMs ? upFmt : '--';
    const sub = document.getElementById('pubBootSub');
    if (sub) sub.textContent = `Boot #${d.bootCount ?? '--'} · ${d.resetReason || '--'}`;
  }
  const elPubPwr = document.getElementById('pubPower');
  if (elPubPwr) {
    elPubPwr.textContent = `${d.brownoutCount || 0}× BO`;
    const sub = document.getElementById('pubPowerSub');
    if (sub) sub.textContent = `3V3 Sag ${d.pwr?.sagMv || 0} mV · I2C Err ${d.i2cErr || 0}`;
  }
  const elPubMov = document.getElementById('pubMoves');
  if (elPubMov) {
    elPubMov.textContent = `${d.servo?.moves || 0} step`;
    const sub = document.getElementById('pubPwmSub');
    if (sub) sub.textContent = `PWM ${d.servo?.us || 1500} µs · ${d.servo?.pwmS || 0} dtk`;
  }
  const elPubTrk = document.getElementById('pubTrack');
  if (elPubTrk) {
    elPubTrk.textContent = `${d.stats?.trackS || 0} dtk`;
    const sub = document.getElementById('pubSatSub');
    if (sub) sub.textContent = `Diam ${d.stats?.holdS || 0}d · Gelap ${d.stats?.satS || 0}d`;
  }
  document.getElementById('lastRxLabel').textContent = d.lastRxAgoMs !== null ? `RX: ${d.lastRxAgoMs} ms lalu` : 'RX: --';
  document.getElementById('tbRaw1').textContent = d.ldr1.raw;
  document.getElementById('tbRaw2').textContent = d.ldr2.raw;
  document.getElementById('tbMv1').textContent = `${d.ldr1.mv} mV`;
  document.getElementById('tbMv2').textContent = `${d.ldr2.mv} mV`;
  document.getElementById('tbPct1').textContent = `${d.ldr1.pct}%`;
  document.getElementById('tbPct2').textContent = `${d.ldr2.pct}%`;
  document.getElementById('tbMinMax1').textContent = `${d.ldr1.min} / ${d.ldr1.max}`;
  document.getElementById('tbMinMax2').textContent = `${d.ldr2.min} / ${d.ldr2.max}`;
  document.getElementById('tbSd1').textContent = d.ldr1.sd;
  document.getElementById('tbSd2').textContent = d.ldr2.sd;
  if (d.cal) {
    document.getElementById('tbCal1').textContent = `${d.cal.dark1} .. ${d.cal.bright1}`;
    document.getElementById('tbCal2').textContent = `${d.cal.dark2} .. ${d.cal.bright2}`;
  }
  if (d.sessionStats && d.sessionStats.totalCycles > 0) {
    document.getElementById('tbSess1').textContent = `${d.sessionStats.ldr1MinRaw} .. ${d.sessionStats.ldr1MaxRaw}`;
    document.getElementById('tbSess2').textContent = `${d.sessionStats.ldr2MinRaw} .. ${d.sessionStats.ldr2MaxRaw}`;
  }
  document.getElementById('tbHealth1').textContent = d.ldr1.health;
  document.getElementById('tbHealth2').textContent = d.ldr2.health;
  document.getElementById('metaI2c').textContent = `SDA=21 · SCL=22 · 0x68${d.eeprom ? ', 0x50 (EEPROM)' : ''} · Err ${d.i2cErr || 0}`;
  document.getElementById('brownoutTxt').textContent = `BO ${d.brownoutCount || 0}x · WDT ${d.wdtCount || 0}x · Panic ${d.panicCount || 0}x (Reset: ${d.resetReason || '--'})`;

  if (d.checklist) renderChecklist(d.checklist);

  chartPts.push({
    ts: Date.now(),
    p1: d.ldr1.pct, p2: d.ldr2.pct,
    r1: d.ldr1.raw, r2: d.ldr2.raw,
    mv1: d.ldr1.mv, mv2: d.ldr2.mv,
    deg: srv.deg,
    tempC: d.tempC,
    rssi: d.wifi?.ok ? d.wifi.rssi : 0
  });
  if (chartPts.length > MAX_PTS) {
    chartPts.shift();
    if (activeChartRange === 'live' && tlPinnedIdx !== null) {
      tlPinnedIdx = Math.max(0, tlPinnedIdx - 1);
      renderChartInspector();
    }
  }
  if (activeViewName === 'live') {
    scheduleChartDraw();
  } else {
    chartDirty = true;
  }
  if (window.SolarRig3D) window.SolarRig3D.updateFromStatus(d);
}

function renderLogs() {
  const box = document.getElementById('logBox');
  if (!box) return;
  if (activeViewName !== 'debug') {
    logsDirty = true;
    return;
  }
  logsDirty = false;
  const maxLvl = parseInt(document.getElementById('lvlFilter').value, 10);
  const query = (document.getElementById('logSearch').value || '').toLowerCase();
  const frag = document.createDocumentFragment();
  let shown = 0;
  for (const item of allLogs) {
    if (item.lvl > maxLvl) continue;
    if (query && !item.txt.toLowerCase().includes(query)) continue;
    const div = document.createElement('div');
    div.className = `log-line lvl-${item.lvl}`;
    div.textContent = isAdmin
      ? item.txt
      : item.txt.replace(/(wss?:\/\/)?[a-z0-9.-]*emqxsl\.com(:\d+)?(\/\S*)?/gi, '[cloud-broker]');
    frag.appendChild(div);
    shown++;
  }
  box.replaceChildren(frag);
  document.getElementById('logCountLabel').textContent = String(shown);
  box.scrollTop = box.scrollHeight;
}

async function pollStatus() {
  if (!IS_LOCAL || webSerialActive || mqttConnected) return;
  try {
    const r = await fetch(API_BASE + '/api/status', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    const data = await r.json();
    if (!localServerOnline) {
      localServerOnline = true;
      pushEvent('INFO', 'CONN', 'Live server (localhost) terhubung kembali');
    }
    lastRenderedStatus = data;
    wsLastTrim = (data.servo && typeof data.servo.trim === 'number') ? data.servo.trim : 0;
    renderStatus(data);
  } catch {
    setPill('connPill', 'connText', 'st-err', 'SERVER OFFLINE');
    if (localServerOnline) {
      localServerOnline = false;
      pushEvent('ERROR', 'CONN', 'Live server (localhost) OFFLINE / tidak merespons');
    }
  }
}

async function pollLogs() {
  if (!IS_LOCAL || webSerialActive || mqttConnected || paused) return;
  try {
    const r = await fetch(API_BASE + '/api/logs?since=' + lastLogId, { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    if (d.logs && d.logs.length > 0) {
      for (const item of d.logs) {
        if (item.id > lastLogId) lastLogId = item.id;
        allLogs.push(item);
      }
      while (allLogs.length > 300) allLogs.shift();
      renderLogs();
    }
  } catch {}
}

function handleDirectTelem(j, transportLabel) {
  wsPacketCount++;
  lastTelemRxAt = Date.now();
  if (!espCurrentlyOnline) {
    espCurrentlyOnline = true;
    mqttDeviceOnline = (transportLabel === 'MQTT');
    pushEvent('INFO', 'CONN', `ESP32 ONLINE via ${transportLabel} (${j.fw || '--'})`);
  }
  const srv = j.srv || {};
  if (typeof srv.trim === 'number') wsLastTrim = srv.trim;
  const faults = Array.isArray(j.faults) ? j.faults : [];

  // Record fault transitions & electricity flow anomalies into timestamped Event Log
  const nextFaultSet = new Set(faults);
  for (const f of faults) {
    if (!prevDirectFaults.has(f)) {
      const isPower = f.includes('BROWNOUT') || f.includes('SAG') || f.includes('EMI');
      const isErr = f.includes('BROWNOUT') || f.includes('WIRING') || f.includes('WRONG') || f.includes('NO_RESPONSE') || f.includes('SAG');
      pushEvent(isErr ? 'ERROR' : 'WARN', isPower ? 'PWR' : 'FAULT', `Fault aktif: ${f}`);
    }
  }
  for (const old of prevDirectFaults) {
    if (!nextFaultSet.has(old)) pushEvent('INFO', 'FAULT', `Fault pulih: ${old}`);
  }
  prevDirectFaults = nextFaultSet;

  if (typeof j.bo === 'number') {
    if (prevDirectBo !== null && j.bo > prevDirectBo) {
      pushEvent('ERROR', 'PWR', `BROWNOUT RESET baru terdeteksi! Total=${j.bo}x (Boot #${j.boot ?? '?'})`);
    }
    prevDirectBo = j.bo;
  }
  if (j.pwr) {
    if ((j.pwr.sagMv || 0) >= 40 && j.pwr.sagMv > prevDirectSagPeak) {
      prevDirectSagPeak = j.pwr.sagMv;
      pushEvent('ERROR', 'PWR', `Tegangan 3.3V drop -${j.pwr.sagMv} mV (base ${j.pwr.baseMv} mV -> min ${j.pwr.minMv} mV)`);
    }
    if ((j.pwr.emiSd || 0) >= 35 && j.pwr.emiSd > prevDirectEmiPeak) {
      prevDirectEmiPeak = j.pwr.emiSd;
      pushEvent('WARN', 'PWR', `Noise EMI / ground bounce +${j.pwr.emiSd} SD saat servo aktif`);
    }
  }
  if (j.sun) {
    const sunOk = !!j.sun.ok;
    const sunRsn = j.sun.rsn || '';
    if (prevDirectSunOk !== null && sunOk !== prevDirectSunOk) {
      if (sunOk) {
        pushEvent('INFO', 'SUN', `Cahaya/Matahari terdeteksi! LDR1=${j.l1?.pct ?? 0}% (${j.sun.lx1 ?? 0} lx, exc=${j.sun.e1 ?? 0}) · LDR2=${j.l2?.pct ?? 0}% (${j.sun.lx2 ?? 0} lx, exc=${j.sun.e2 ?? 0})`);
      } else {
        pushEvent('INFO', 'SUN', `Cahaya hilang / gelap (HOLD · raw ${j.l1?.raw ?? 0}/${j.l2?.raw ?? 0})`);
      }
    }
    if (sunRsn === 'BOTH_SATURATED_EQUAL' && prevDirectSunRsn !== 'BOTH_SATURATED_EQUAL') {
      pushEvent('WARN', 'SUN', `Kedua LDR mentok cahaya sama kuat (raw ${j.l1?.raw ?? 0}/${j.l2?.raw ?? 0}) — pasang sekat pemisah LDR`);
    }
    prevDirectSunOk = sunOk;
    prevDirectSunRsn = sunRsn;
  }

  const rssiTxt = (j.wifi && j.wifi.ok) ? ` · ${j.wifi.rssi}dBm` : '';
  const d = {
    sourceMode: 'live',
    hardwareConnected: true,
    espOnline: true,
    serialPort: `${transportLabel}${rssiTxt}`,
    firmwareVersion: j.fw || '--',
    uptimeMs: j.up || 0,
    resetReason: j.rst || '--',
    bootCount: j.boot ?? null,
    wdtCount: j.wdt ?? 0,
    panicCount: j.panic ?? 0,
    freeHeap: j.heap || 0,
    minHeap: j.minHeap || 0,
    maxAlloc: j.maxAlloc || 0,
    tempC: (typeof j.tempC === 'number') ? j.tempC : null,
    loopMs: (typeof j.loopMs === 'number') ? j.loopMs : null,
    i2cErr: j.i2cErr || 0,
    eeprom: !!j.eeprom,
    pwr: j.pwr || null,
    stats: j.stats || null,
    lastCmd: j.lastCmd || '-',
    wifi: j.wifi || null,
    mqtt: j.mqtt || null,
    packetCount: wsPacketCount,
    packetRateHz: srv.mov ? 2 : 1,
    lastRxAgoMs: 0,
    brownoutCount: (typeof j.bo === 'number') ? j.bo : (faults.includes('BROWNOUT_RESET') ? 1 : 0),
    ldr1: {
      raw: j.l1?.raw ?? 0, mv: j.l1?.mv ?? 0, pct: j.l1?.pct ?? 0,
      min: j.l1?.min ?? 0, max: j.l1?.max ?? 0, sd: j.l1?.sd ?? 0,
      health: j.l1?.h || 'OK', bih: j.l1?.bih ?? true
    },
    ldr2: {
      raw: j.l2?.raw ?? 0, mv: j.l2?.mv ?? 0, pct: j.l2?.pct ?? 0,
      min: j.l2?.min ?? 0, max: j.l2?.max ?? 0, sd: j.l2?.sd ?? 0,
      health: j.l2?.h || 'OK', bih: j.l2?.bih ?? true
    },
    cal: j.cal ? {
      dark1: j.cal.d1, bright1: j.cal.b1,
      dark2: j.cal.d2, bright2: j.cal.b2,
      calibrated: !!j.cal.ok
    } : null,
    decision: j.dec || 'HOLD',
    delta: j.delta || 0,
    light: j.light || null,
    sun: j.sun || null,
    park: j.park || null,
    clk: j.clk || null,
    astro: j.astro || null,
    rtc: {
      time: j.rtc?.t || '--',
      present: !!j.rtc?.p,
      running: !!j.rtc?.r,
      plausible: !!j.rtc?.ok
    },
    servo: {
      mode: srv.mode || 'AUTO',
      deg: srv.deg ?? 90,
      target: srv.target ?? 90,
      trim: srv.trim ?? 0,
      min: srv.min ?? 15,
      max: srv.max ?? 165,
      ctr: srv.ctr ?? Math.round(((srv.min ?? 15) + (srv.max ?? 165)) / 2),
      phys: srv.phys ?? (srv.deg ?? 90),
      us: srv.us ?? 1500,
      pwmS: srv.pwmS ?? 0,
      moves: srv.moves ?? 0,
      dirChg: srv.dirChg ?? 0,
      invert: !!srv.inv,
      moving: !!srv.mov,
      pwm: !!srv.pwm,
      atLimit: !!srv.lim,
      locked: !!srv.lock,
      softStart: !!srv.soft
    },
    faults,
    checklist: [
      {
        title: '1. Koneksi & Firmware ESP32',
        status: (j.wifi?.ok && j.mqtt?.ok) ? 'ok' : (transportLabel === 'WEB SERIAL' ? 'ok' : 'warn'),
        badge: j.fw || '--',
        detail: j.wifi?.ok
          ? `WiFi "${j.wifi.ssid}" (${j.wifi.rssi} dBm) · MQTT ${j.mqtt?.ok ? 'terhubung' : 'terputus'} · Boot #${j.boot ?? '?'}`
          : `Terhubung via ${transportLabel}`
      },
      {
        title: '2. Daya & Stabilitas (Anti-Brownout)',
        status: faults.includes('BROWNOUT_RESET') ? 'err' : ((j.bo || 0) > 0 ? 'warn' : 'ok'),
        badge: faults.includes('BROWNOUT_RESET') ? 'BROWNOUT' : `${j.bo || 0}x Total`,
        detail: faults.includes('BROWNOUT_RESET')
          ? 'Reset terakhir karena tegangan drop! Pakai power 5V 2A / DC 9-12V di board ekspansi.'
          : `Reset terakhir: ${j.rst || '--'} · Free Heap: ${Math.round((j.heap || 0) / 1024)} KB`
      },
      {
        title: '3. Sensor LDR 1 (GPIO34 · Kiri)',
        status: j.l1?.h === 'CHECK WIRING' ? 'err' : (j.l1?.h === 'OK' ? 'ok' : 'warn'),
        badge: j.l1?.h || '--',
        detail: `Raw ${j.l1?.raw ?? 0} · ${j.l1?.mv ?? 0} mV · ${j.l1?.pct ?? 0}% · SD ${j.l1?.sd ?? 0}`
      },
      {
        title: '4. Sensor LDR 2 (GPIO35 · Kanan)',
        status: j.l2?.h === 'CHECK WIRING' ? 'err' : (j.l2?.h === 'OK' ? 'ok' : 'warn'),
        badge: j.l2?.h || '--',
        detail: `Raw ${j.l2?.raw ?? 0} · ${j.l2?.mv ?? 0} mV · ${j.l2?.pct ?? 0}% · SD ${j.l2?.sd ?? 0}`
      },
      {
        title: '5. Kalibrasi NVS & Polaritas',
        status: j.cal?.ok ? 'ok' : 'warn',
        badge: j.cal?.ok ? 'TERKALIBRASI' : 'BELUM',
        detail: j.cal
          ? `LDR1 (${j.cal.d1}..${j.cal.b1}) · LDR2 (${j.cal.d2}..${j.cal.b2})`
          : 'Jalankan Tes Terpandu atau Gelap 0% & Terang 100%.'
      },
      {
        title: '6. RTC DS1307 (I2C 0x68)',
        status: (j.rtc?.p && j.rtc?.r && j.rtc?.ok) ? 'ok' : 'err',
        badge: (j.rtc?.p && j.rtc?.r && j.rtc?.ok) ? 'VALID' : 'CEK RTC',
        detail: `Waktu: ${j.rtc?.t || '--'} · Running: ${j.rtc?.r ? 'Ya' : 'Tidak'}`
      },
      {
        title: '7. Servo MG996R (GPIO18 · 6V via XL4015)',
        status: (faults.includes('WRONG_DIRECTION_SUSPECTED') || faults.includes('SERVO_NO_RESPONSE') || srv.lock) ? 'err' : (srv.lim ? 'warn' : 'ok'),
        badge: srv.lock ? 'SAFE-LOCK' : (faults.includes('SERVO_NO_RESPONSE') ? 'NO RESPONSE' : `${srv.deg ?? 90}° (${srv.mode || 'AUTO'})`),
        detail: srv.lock
          ? 'PWM dimatikan otomatis pasca BROWNOUT untuk cegah boot-loop. Cek output 6V XL4015 & Common GND lalu klik AUTO TRACK / servo unlock.'
          : (faults.includes('SERVO_NO_RESPONSE')
            ? 'Servo MG996R tidak merespons saat AUTO! Cek kabel sinyal P18, output 6V XL4015, atau tuas macet.'
            : `Target ${srv.target ?? 90}° · Trim ${(srv.trim ?? 0) >= 0 ? '+' : ''}${srv.trim ?? 0}° · Fisik ${srv.phys ?? (srv.deg ?? 90)}° · Soft-start aktif`)
      }
    ],
    explain: faults.length === 0
      ? `Sistem normal (${transportLabel}${rssiTxt}). Boot #${j.boot ?? '?'} · Cmd terakhir: ${j.lastCmd || '-'}`
      : `Fault aktif: ${faults.join(', ')} · Boot #${j.boot ?? '?'} · Cmd: ${j.lastCmd || '-'}`
  };
  lastRenderedStatus = d;
  renderStatus(d);
}

// View Tabs
document.querySelectorAll('.nav-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const nextView = btn.dataset.view || 'live';
    if (nextView === activeViewName) return;
    activeViewName = nextView;

    document.querySelectorAll('.nav-tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById('view-' + nextView);
    if (target) target.classList.add('active');

    if (window.SolarRig3D) window.SolarRig3D.setActiveView(nextView);

    if (nextView === 'live') {
      chartDirty = false;
      scheduleChartDraw();
      if (lastRenderedStatus?.servo) {
        const srv = lastRenderedStatus.servo;
        const lightEst = estimateLightSource(lastRenderedStatus.ldr1?.pct || 0, lastRenderedStatus.ldr2?.pct || 0, srv.deg, srv.invert, lastRenderedStatus.light);
        drawServoGauge(srv.deg, srv.target, lightEst.deg);
      }
    } else if (nextView === 'debug' && logsDirty) {
      renderLogs();
    } else if (nextView === 'check' && checklistDirty && lastRenderedStatus?.checklist) {
      renderChecklist(lastRenderedStatus.checklist);
    }
  });
});

// Servo Controls (Admin-only guard)
function isDirectTransport() { return webSerialActive || mqttConnected; }

function postServo(payload) {
  if (!isAdmin) return;
  if (isDirectTransport()) {
    if (typeof payload.trimDelta === 'number') {
      wsLastTrim = Math.max(-45, Math.min(45, wsLastTrim + payload.trimDelta));
      sendSerialCmd('servo trim ' + wsLastTrim);
      return;
    }
    if (typeof payload.deg === 'number') {
      sendSerialCmd('servo ' + Math.round(payload.deg));
      return;
    }
    if (payload.mode) sendSerialCmd('servo ' + payload.mode);
    return;
  }
  if (!IS_LOCAL) { alert('Klik "MQTT" atau "Hubungkan USB" dulu untuk kontrol.'); return; }
  fetch(API_BASE + '/api/servo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

document.querySelectorAll('button[data-srv]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode) {
      document.querySelectorAll('.mac-segmented .seg-btn[data-mode]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
    }
    postServo({ mode: btn.dataset.srv });
  });
});

document.querySelectorAll('button[data-trim]').forEach((btn) => {
  btn.addEventListener('click', () => postServo({ trimDelta: Number(btn.dataset.trim) }));
});

const btnSaveClock = document.getElementById('btnSaveClock');
if (btnSaveClock) {
  btnSaveClock.addEventListener('click', () => {
    if (!isAdmin) return;
    const start = (document.getElementById('clockStartInp')?.value || '06:00').trim();
    const end = (document.getElementById('clockEndInp')?.value || '18:00').trim();
    const bias = Number(document.getElementById('clockBiasInp')?.value || 15);
    const lat = Number(document.getElementById('geoLatInp')?.value ?? -6.20);
    const lon = Number(document.getElementById('geoLonInp')?.value ?? 106.82);
    const step = Number(document.getElementById('cosStepInp')?.value || 4);
    const tz = 7;
    if (isDirectTransport()) {
      sendSerialCmd(`clock ${start} ${end} ${bias}`);
      setTimeout(() => sendSerialCmd(`geo ${lat.toFixed(2)} ${lon.toFixed(2)} ${tz} ${step}`), 150);
    } else if (IS_LOCAL) {
      fetch(API_BASE + '/api/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end, bias, lat, lon, tz, step })
      });
    } else {
      alert('Klik "MQTT" atau "Hubungkan USB" dulu untuk menyimpan jadwal RTC.');
      return;
    }
    const orig = btnSaveClock.textContent;
    btnSaveClock.textContent = 'Tersimpan!';
    setTimeout(() => { btnSaveClock.textContent = orig; }, 1400);
  });
}

const slider = document.getElementById('servoSlider');
slider.addEventListener('input', () => {
  sliderDragging = true;
  document.getElementById('servoTargetTxt').textContent = `${slider.value}°`;
});
slider.addEventListener('change', () => {
  sliderDragging = false;
  postServo({ mode: 'manual', deg: Number(slider.value) });
});

// Copy AI Debug Bundle
async function copyAiDebug(btn) {
  const orig = btn.textContent;
  try {
    let bundle;
    if (isDirectTransport() || !IS_LOCAL) {
      bundle = {
        generatedAt: new Date().toISOString(),
        source: mqttConnected ? 'mqtt-wss' : 'web-serial',
        status: lastRenderedStatus,
        events: eventLog.slice(-60),
        recentLogs: allLogs.slice(-60).map((x) => x.txt)
      };
    } else {
      bundle = await (await fetch(API_BASE + '/api/debug-bundle', { cache: 'no-store' })).json();
    }
    await navigator.clipboard.writeText('```json\n' + JSON.stringify(bundle, null, 2) + '\n```');
    btn.textContent = 'Tersalin!';
    setTimeout(() => { btn.textContent = orig; }, 1600);
  } catch {
    alert('Gagal menyalin otomatis.');
  }
}
document.getElementById('btnCopyAi').addEventListener('click', (e) => copyAiDebug(e.target));
document.getElementById('btnCopyAi2').addEventListener('click', (e) => copyAiDebug(e.target));

// Calibration & Hardware Actions
document.querySelectorAll('button[data-cal]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (isDirectTransport()) {
      const act = btn.dataset.cal;
      sendSerialCmd(act === 'resetstats' ? 'resetstats' : ('cal ' + act));
      return;
    }
    if (!IS_LOCAL) { alert('Klik "MQTT" atau "Hubungkan USB" dulu untuk kalibrasi.'); return; }
    fetch(API_BASE + '/api/cal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: btn.dataset.cal })
    });
  });
});

document.getElementById('btnHeaderFlash').addEventListener('click', () => {
  if (!IS_LOCAL) { connectWebSerial(); return; }
  fetch(API_BASE + '/api/pio/flash', { method: 'POST' });
});
document.getElementById('btnSelfTest').addEventListener('click', () => {
  if (isDirectTransport()) { sendSerialCmd('selftest'); return; }
  if (!IS_LOCAL) return;
  fetch(API_BASE + '/api/selftest', { method: 'POST' });
});
document.getElementById('btnReconnect').addEventListener('click', () => {
  if (!IS_LOCAL) { connectWebSerial(); return; }
  fetch(API_BASE + '/api/pio/reconnect', { method: 'POST' });
});
document.getElementById('btnCsv').addEventListener('click', () => {
  if (!IS_LOCAL) {
    const r = activeChartRange === 'live' ? '7d' : activeChartRange;
    window.location = `${CF_API_BASE}/api/history.csv?dev=${encodeURIComponent(mqttDevId)}&range=${encodeURIComponent(r)}`;
    return;
  }
  window.location = API_BASE + '/api/export.csv';
});
document.getElementById('btnJsonl').addEventListener('click', () => {
  if (!IS_LOCAL) { alert('Export JSONL tersedia di server lokal (npm run dev).'); return; }
  window.location = API_BASE + '/api/export.jsonl';
});

document.getElementById('btnRtc').addEventListener('click', () => {
  const now = new Date();
  if (isDirectTransport()) {
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    sendSerialCmd('settime ' + ts);
    return;
  }
  if (!IS_LOCAL) { alert('Klik "MQTT" atau "Hubungkan USB" dulu untuk sinkron RTC.'); return; }
  const utcEpoch = Math.floor(now.getTime() / 1000);
  const localEpoch = Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 1000);
  fetch(API_BASE + '/api/rtc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ epoch: localEpoch, utcEpoch })
  });
});

document.getElementById('presetSelect').addEventListener('change', (e) => {
  if (!IS_LOCAL) return;
  fetch(API_BASE + '/api/sim/preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: e.target.value })
  });
});

function auditAdminCmd(cmd) {
  const tok = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!tok || IS_LOCAL) return;
  fetch(`${CF_API_BASE}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ dev: mqttDevId, category: 'CMD', detail: cmd })
  }).catch(() => {});
}

function sendSerialCmd(cmd) {
  if (!cmd || !isAdmin) return;
  if (mqttConnected && mqttClient) {
    mqttClient.publish(`solartracker/${mqttDevId}/cmd`, cmd, { qos: 1 });
    pushClientLog(2, `[MQTT TX] ${cmd}`);
    auditAdminCmd(cmd);
    return;
  }
  if (webSerialActive && serialWriter) { serialWriter.write(new TextEncoder().encode(cmd + '\n')); return; }
  if (!IS_LOCAL) return;
  fetch(API_BASE + '/api/serial/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd })
  });
}

function pushClientLog(lvl, txt) {
  allLogs.push({ id: ++lastLogId, lvl, txt });
  while (allLogs.length > 300) allLogs.shift();
  if (!paused) renderLogs();
  if ((lvl <= 1 || String(txt).includes('[SUN ]') || String(txt).includes('[PARK]') || String(txt).includes('[CLK ]')) && !String(txt).includes('[MQTT STATUS]')) {
    const tagMatch = String(txt).match(/\[(PWR|EMI|SRVO|SUN|PARK|CLK|WIFI|MQTT|RTC|I2C|LDR[12]|BOOT|HIST|CONN)\s*\]/);
    const cat = tagMatch ? tagMatch[1].trim() : (String(txt).includes('BROWNOUT') ? 'PWR' : 'SYS');
    const clean = String(txt).replace(/^(\[[^\]]*\]\s*)+/, '').trim() || String(txt);
    pushEvent(lvl === 0 ? 'ERROR' : (lvl === 1 ? 'WARN' : 'INFO'), cat, clean);
  }
}
document.getElementById('btnSendSerial').addEventListener('click', () => {
  const inp = document.getElementById('serialCmdInput');
  sendSerialCmd(inp.value.trim());
  inp.value = '';
});
document.getElementById('serialCmdInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { sendSerialCmd(e.target.value.trim()); e.target.value = ''; }
});
document.querySelectorAll('button[data-quickcmd]').forEach((btn) => {
  btn.addEventListener('click', () => sendSerialCmd(btn.dataset.quickcmd));
});
const btnPingRtt = document.getElementById('btnPingRtt');
if (btnPingRtt) {
  btnPingRtt.addEventListener('click', () => {
    btnPingRtt.textContent = 'Ping...';
    sendSerialCmd('ping ' + Date.now());
  });
}

document.getElementById('lvlFilter').addEventListener('change', renderLogs);
document.getElementById('logSearch').addEventListener('input', renderLogs);
document.getElementById('pauseBtn').addEventListener('click', (e) => { paused = !paused; e.target.textContent = paused ? 'Lanjut' : 'Jeda'; });
document.getElementById('clearLogBtn').addEventListener('click', () => { allLogs.length = 0; renderLogs(); });
const clearEventsBtn = document.getElementById('clearEventsBtn');
if (clearEventsBtn) {
  clearEventsBtn.addEventListener('click', () => { eventLog.length = 0; renderEventLog(); });
}
const toggleEventsBtn = document.getElementById('toggleEventsBtn');
if (toggleEventsBtn) {
  toggleEventsBtn.addEventListener('click', () => { showAllEvents = !showAllEvents; renderEventLog(); });
}

async function connectWebSerial() {
  if (!('serial' in navigator)) { alert('Gunakan Chrome/Edge untuk Web Serial USB.'); return; }
  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });
    webSerialActive = true;
    wsPacketCount = 0;
    serialWriter = serialPort.writable.getWriter();
    setPill('connPill', 'connText', 'st-ok', 'WEB SERIAL');
    const decoder = new TextDecoderStream();
    serialPort.readable.pipeTo(decoder.writable);
    const reader = decoder.readable.getReader();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const rawLine of lines) {
        const l = rawLine.trim();
        if (!l) continue;
        if (l.startsWith('[TELEM] ')) {
          try { handleDirectTelem(JSON.parse(l.slice(8)), 'WEB SERIAL'); } catch {}
          continue;
        }
        pushClientLog(l.includes('[ERROR]') ? 0 : (l.includes('[WARN') ? 1 : 2), l);
      }
    }
    webSerialActive = false;
    markEspOffline('Koneksi Web Serial USB terputus');
  } catch (err) {
    console.warn('Web Serial:', err);
    if (webSerialActive) {
      webSerialActive = false;
      markEspOffline('Koneksi Web Serial USB terputus');
    } else {
      setPill('connPill', 'connText', 'st-warn', 'KLIK MQTT / USB');
    }
  }
}

document.getElementById('btnWebSerial').addEventListener('click', connectWebSerial);

// ==================== MQTT WSS CLOUD CLIENT (Auto-Connect Default) ====================
const MQTT_LS_KEY = 'st_mqtt_cfg_v2';
const DEFAULT_MQTT_CFG = {
  url: 'wss://u99bd9a9.ala.asia-southeast1.emqxsl.com:8084/mqtt',
  user: 'solartracker',
  pass: 'bbpvp',
  dev: 'rig1'
};

function normalizeBrokerUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return DEFAULT_MQTT_CFG.url;
  u = u.replace(/^https?:\/\//i, 'wss://');
  if (!/^wss?:\/\//i.test(u)) u = 'wss://' + u;
  if (!/:\d+/.test(u.replace(/^wss?:\/\//i, ''))) {
    u = u.replace(/\/+$/, '') + ':8084/mqtt';
  }
  return u;
}

function loadMqttConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(MQTT_LS_KEY) || 'null');
    if (saved && saved.url) return { ...DEFAULT_MQTT_CFG, ...saved, url: normalizeBrokerUrl(saved.url) };
  } catch {}
  return { ...DEFAULT_MQTT_CFG };
}

function saveMqttConfig(cfg) {
  localStorage.setItem(MQTT_LS_KEY, JSON.stringify(cfg));
}

function disconnectMqtt() {
  if (mqttClient) { try { mqttClient.end(true); } catch {} mqttClient = null; }
  mqttConnected = false;
  mqttDeviceOnline = false;
  setPill('mqttModalPill', 'mqttModalStatus', 'st-neutral', 'Terputus');
  if (!IS_LOCAL && !webSerialActive) setPill('connPill', 'connText', 'st-warn', 'KLIK MQTT / USB');
}

function connectMqtt(cfg) {
  if (typeof window.mqtt === 'undefined') { alert('Library mqtt.js belum termuat. Cek koneksi internet.'); return; }
  if (!cfg || !cfg.url) return;
  disconnectMqtt();
  mqttDevId = (cfg.dev || 'rig1').trim() || 'rig1';
  setPill('mqttModalPill', 'mqttModalStatus', 'st-warn', 'Menghubungkan...');
  setPill('connPill', 'connText', 'st-warn', 'MQTT CONNECT...');

  const brokerUrl = normalizeBrokerUrl(cfg.url);
  mqttClient = window.mqtt.connect(brokerUrl, {
    username: cfg.user || undefined,
    password: cfg.pass || undefined,
    clean: true,
    reconnectPeriod: 4000,
    connectTimeout: 10000
  });

  mqttClient.on('connect', () => {
    mqttConnected = true;
    mqttConnectedAt = Date.now();
    wsPacketCount = 0;
    setPill('mqttModalPill', 'mqttModalStatus', 'st-ok', 'Terhubung');
    setPill('connPill', 'connText', 'st-warn', `MQTT · MENUNGGU ESP32...`);
    mqttClient.subscribe([
      `solartracker/${mqttDevId}/status`,
      `solartracker/${mqttDevId}/telem`,
      `solartracker/${mqttDevId}/log`
    ], { qos: 0 });
    pushClientLog(2, `[MQTT] Terhubung ke ${cfg.url} (device: ${mqttDevId})`);
  });

  mqttClient.on('message', (topic, payload) => {
    const txt = payload.toString();
    if (topic.endsWith('/status')) {
      mqttDeviceOnline = (txt.trim() === 'online');
      if (mqttDeviceOnline) {
        espCurrentlyOnline = true;
        setPill('connPill', 'connText', 'st-ok', `MQTT ONLINE (${mqttDevId})`);
        pushEvent('INFO', 'CONN', `ESP32 ONLINE (MQTT status: online · ${mqttDevId})`);
      } else {
        markEspOffline(`Status MQTT LWT = "${txt.trim() || 'offline'}"`);
      }
      pushClientLog(mqttDeviceOnline ? 2 : 1, `[MQTT STATUS] ESP32 ${txt.trim().toUpperCase()}`);
    } else if (topic.endsWith('/telem')) {
      try { handleDirectTelem(JSON.parse(txt), 'MQTT'); } catch {}
    } else if (topic.endsWith('/log')) {
      const m = txt.match(/\[PONG\]\s+(\d+)/);
      if (m) {
        const rtt = Date.now() - Number(m[1]);
        const btn = document.getElementById('btnPingRtt');
        if (btn && rtt >= 0 && rtt < 30000) btn.textContent = `Ping: ${rtt} ms`;
      }
      pushClientLog(txt.includes('[ERROR]') ? 0 : (txt.includes('[WARN') ? 1 : 2), txt);
    }
  });

  mqttClient.on('error', (err) => {
    setPill('mqttModalPill', 'mqttModalStatus', 'st-err', 'Error: ' + (err.message || 'auth/url'));
    pushClientLog(0, `[MQTT ERROR] ${err.message || err}`);
  });

  mqttClient.on('close', () => {
    mqttConnected = false;
    mqttDeviceOnline = false;
    espCurrentlyOnline = false;
    setPill('connPill', 'connText', 'st-err', 'ESP32 OFFLINE');
    pushEvent('WARN', 'CONN', 'Koneksi broker MQTT terputus, mencoba reconnect...');
  });
}

// Offline staleness watchdog for MQTT & Web Serial direct transports
setInterval(() => {
  const now = Date.now();
  if (mqttConnected) {
    if (lastTelemRxAt > 0 && (now - lastTelemRxAt) > ESP_OFFLINE_TIMEOUT_MS) {
      if (espCurrentlyOnline || mqttDeviceOnline) {
        markEspOffline(`Tidak ada telemetri MQTT > ${ESP_OFFLINE_TIMEOUT_MS / 1000} dtk`);
      } else {
        const rx = document.getElementById('lastRxLabel');
        if (rx) rx.textContent = `RX: ${Math.round((now - lastTelemRxAt) / 1000)} dtk lalu (OFFLINE)`;
      }
    } else if (lastTelemRxAt === 0 && mqttConnectedAt > 0 && (now - mqttConnectedAt) > ESP_OFFLINE_TIMEOUT_MS) {
      if (espCurrentlyOnline || document.getElementById('connText')?.textContent !== 'ESP32 OFFLINE') {
        markEspOffline(`ESP32 belum mengirim data dalam ${ESP_OFFLINE_TIMEOUT_MS / 1000} dtk`);
      }
    }
  } else if (webSerialActive && lastTelemRxAt > 0 && (now - lastTelemRxAt) > ESP_OFFLINE_TIMEOUT_MS) {
    if (espCurrentlyOnline) {
      markEspOffline(`Tidak ada data Web Serial > ${ESP_OFFLINE_TIMEOUT_MS / 1000} dtk`);
    }
  }
}, 1000);

// ==================== ADMIN AUTH (Cloudflare Workers) & HISTORY (D1) ====================
function setAdminRole(flag) {
  isAdmin = !!flag;
  document.body.classList.toggle('role-admin', isAdmin);
  document.body.classList.toggle('role-public', !isAdmin);
  const dbgLbl = document.getElementById('debugTabLabel');
  if (dbgLbl) dbgLbl.textContent = isAdmin ? '2. Serial & AI Debug' : '2. Serial & Log';
  const btn = document.getElementById('btnAdminAuth');
  if (btn) {
    btn.textContent = isAdmin ? 'Admin · Keluar' : 'Login Admin';
    btn.className = isAdmin ? 'btn btn-primary' : 'btn btn-secondary';
  }
  renderLogs();
}

async function verifySavedAdminToken() {
  if (IS_LOCAL) { setAdminRole(true); return; }
  const tok = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!tok) { setAdminRole(false); return; }
  try {
    const r = await fetch(`${CF_API_BASE}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${tok}` },
      cache: 'no-store'
    });
    if (r.ok) setAdminRole(true);
    else { localStorage.removeItem(ADMIN_TOKEN_KEY); setAdminRole(false); }
  } catch {
    setAdminRole(false);
  }
}

async function loadCloudflareHistory(range) {
  const titleEl = document.getElementById('chartTitleLbl');
  const pktEl = document.getElementById('pktChip');
  const rangeNames = { '1h': '1 JAM', '24h': '24 JAM', '7d': '7 HARI' };
  if (titleEl) titleEl.textContent = `GRAFIK CAHAYA · ${rangeNames[range] || range}`;
  if (pktEl) pktEl.textContent = 'Memuat...';
  try {
    const r = await fetch(`${CF_API_BASE}/api/history?dev=${encodeURIComponent(mqttDevId)}&range=${encodeURIComponent(range)}`, { cache: 'no-store' });
    const d = await r.json();
    historyPts = Array.isArray(d.points) ? d.points : [];
    const s = d.summary || {};
    historySummaryTxt = `${d.total || 0} data · ${s.maxTemp || 0}°C`;
    if (pktEl) pktEl.textContent = historySummaryTxt;
    drawChart();
  } catch {
    historyPts = [];
    historySummaryTxt = 'Gagal muat';
    if (pktEl) pktEl.textContent = historySummaryTxt;
    drawChart();
  }
}

document.querySelectorAll('.range-btn[data-range]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn[data-range]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeChartRange = btn.dataset.range || 'live';
    tlZoom = 1;
    tlPan = 1;
    tlHoverX = null;
    tlPinnedIdx = null;
    renderChartInspector();
    clampTimeline();
    const titleEl = document.getElementById('chartTitleLbl');
    if (activeChartRange === 'live') {
      if (titleEl) titleEl.textContent = 'GRAFIK CAHAYA · LIVE';
      drawChart();
    } else {
      loadCloudflareHistory(activeChartRange);
    }
  });
});

// Interactive Timeline Controls (Mouse Wheel Zoom, Drag Pan, Touch Pinch-Zoom & Scrub)
const chartCanvas = document.getElementById('chart');
function canvasXFromClient(clientX) {
  const rect = chartCanvas.getBoundingClientRect();
  return clientX - rect.left;
}

if (chartCanvas) {
  window.addEventListener('resize', () => {
    drawChart();
    if (lastRenderedStatus?.servo) drawServoGauge(lastRenderedStatus.servo.deg, lastRenderedStatus.servo.target);
  });
  // Mouse wheel zoom centered on cursor
  chartCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    const prevZoom = tlZoom;
    tlZoom *= factor;
    clampTimeline();
    if (tlZoom !== prevZoom && tlZoom > 1) {
      const rect = chartCanvas.getBoundingClientRect();
      const cx = canvasXFromClient(e.clientX);
      const frac = Math.max(0, Math.min(1, (cx - 40) / Math.max(1, rect.width - 52)));
      tlPan = Math.max(0, Math.min(1, tlPan + (frac - 0.5) * (1 - prevZoom / tlZoom)));
      clampTimeline();
    }
    drawChart();
  }, { passive: false });

  // Mouse drag pan & click-to-pin inspector
  chartCanvas.addEventListener('mousedown', (e) => {
    tlDragging = true;
    tlDragMoved = false;
    tlDragStartX = e.clientX;
    tlDragStartPan = tlPan;
  });
  window.addEventListener('mousemove', (e) => {
    if (tlDragging) {
      const rect = chartCanvas.getBoundingClientRect();
      if (Math.abs(e.clientX - tlDragStartX) > 4) tlDragMoved = true;
      const dxFrac = (e.clientX - tlDragStartX) / Math.max(1, rect.width);
      if (tlZoom > 1) {
        tlPan = tlDragStartPan - dxFrac / (tlZoom - 1) * tlZoom;
        clampTimeline();
      }
      tlHoverX = e.clientX - rect.left;
      scheduleChartDraw();
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (tlDragging && !tlDragMoved) {
      const allPts = getActiveChartPts();
      if (allPts.length >= 2) {
        const rect = chartCanvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const plotW = Math.max(1, rect.width - 52);
        const visCount = Math.max(2, Math.round(allPts.length / tlZoom));
        const maxStart = Math.max(0, allPts.length - visCount);
        const startIdx = Math.round(tlPan * maxStart);
        const endIdx = Math.min(allPts.length - 1, startIdx + visCount - 1);
        const ratio = Math.max(0, Math.min(1, (cx - 40) / plotW));
        tlPinnedIdx = Math.max(startIdx, Math.min(endIdx, Math.round(startIdx + ratio * Math.max(1, endIdx - startIdx))));
        renderChartInspector();
        scheduleChartDraw();
      }
    }
    tlDragging = false;
  });

  const btnInspClose = document.getElementById('btnInspClose');
  if (btnInspClose) {
    btnInspClose.addEventListener('click', () => {
      tlPinnedIdx = null;
      renderChartInspector();
      scheduleChartDraw();
    });
  }

  chartCanvas.addEventListener('mousemove', (e) => {
    if (!tlDragging) {
      tlHoverX = canvasXFromClient(e.clientX);
      scheduleChartDraw();
    }
  });
  chartCanvas.addEventListener('mouseleave', () => {
    if (!tlDragging) { tlHoverX = null; scheduleChartDraw(); }
  });
  chartCanvas.addEventListener('dblclick', () => {
    tlZoom = 1; tlPan = 1; clampTimeline(); scheduleChartDraw();
  });

  // Touch: 1-finger pan/scrub, 2-finger pinch-zoom
  chartCanvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      tlPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      tlPinchStartZoom = tlZoom;
      tlDragging = false;
    } else if (e.touches.length === 1) {
      tlDragging = true;
      tlDragStartX = e.touches[0].clientX;
      tlDragStartPan = tlPan;
      tlHoverX = canvasXFromClient(e.touches[0].clientX);
      scheduleChartDraw();
    }
  }, { passive: true });

  chartCanvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && tlPinchDist > 0) {
      e.preventDefault();
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      tlZoom = tlPinchStartZoom * (d / tlPinchDist);
      clampTimeline();
      scheduleChartDraw();
    } else if (e.touches.length === 1 && tlDragging) {
      e.preventDefault();
      const rect = chartCanvas.getBoundingClientRect();
      const dxFrac = (e.touches[0].clientX - tlDragStartX) / Math.max(1, rect.width);
      if (tlZoom > 1) {
        tlPan = tlDragStartPan - dxFrac / (tlZoom - 1) * tlZoom;
        clampTimeline();
      }
      tlHoverX = e.touches[0].clientX - rect.left;
      scheduleChartDraw();
    }
  }, { passive: false });

  chartCanvas.addEventListener('touchend', () => {
    tlDragging = false;
    tlPinchDist = 0;
  });
}

const btnZoomIn = document.getElementById('btnZoomIn');
const btnZoomOut = document.getElementById('btnZoomOut');
const btnZoomReset = document.getElementById('btnZoomReset');
if (btnZoomIn) btnZoomIn.addEventListener('click', () => { tlZoom *= 1.5; clampTimeline(); drawChart(); });
if (btnZoomOut) btnZoomOut.addEventListener('click', () => { tlZoom /= 1.5; clampTimeline(); drawChart(); });
if (btnZoomReset) btnZoomReset.addEventListener('click', () => { tlZoom = 1; tlPan = 1; clampTimeline(); drawChart(); });

// Admin Login Modal Handlers
const adminModal = document.getElementById('adminModal');
const adminErrEl = document.getElementById('adminLoginErr');
const btnAdminAuth = document.getElementById('btnAdminAuth');
if (btnAdminAuth) {
  btnAdminAuth.addEventListener('click', () => {
    if (isAdmin && !IS_LOCAL) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      setAdminRole(false);
      return;
    }
    if (adminErrEl) adminErrEl.style.display = 'none';
    if (adminModal) adminModal.style.display = 'flex';
    const u = document.getElementById('adminUserInp');
    if (u) u.focus();
  });
}
const btnAdminCancel = document.getElementById('btnAdminCancel');
if (btnAdminCancel) btnAdminCancel.addEventListener('click', () => { if (adminModal) adminModal.style.display = 'none'; });

async function submitAdminLogin() {
  const username = (document.getElementById('adminUserInp')?.value || '').trim();
  const password = document.getElementById('adminPassInp')?.value || '';
  const submitBtn = document.getElementById('btnAdminSubmit');
  if (!username || !password) {
    if (adminErrEl) { adminErrEl.textContent = 'Isi username dan password.'; adminErrEl.style.display = 'block'; }
    return;
  }
  if (submitBtn) submitBtn.textContent = 'Memeriksa...';
  try {
    const r = await fetch(`${CF_API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const d = await r.json();
    if (r.ok && d.ok && d.token) {
      localStorage.setItem(ADMIN_TOKEN_KEY, d.token);
      setAdminRole(true);
      if (adminModal) adminModal.style.display = 'none';
      const p = document.getElementById('adminPassInp');
      if (p) p.value = '';
    } else {
      if (adminErrEl) { adminErrEl.textContent = d.error || 'Login gagal.'; adminErrEl.style.display = 'block'; }
    }
  } catch {
    if (adminErrEl) { adminErrEl.textContent = 'Gagal menghubungi Cloudflare Auth API.'; adminErrEl.style.display = 'block'; }
  } finally {
    if (submitBtn) submitBtn.textContent = 'Masuk';
  }
}
const btnAdminSubmit = document.getElementById('btnAdminSubmit');
if (btnAdminSubmit) btnAdminSubmit.addEventListener('click', submitAdminLogin);
const adminPassInp = document.getElementById('adminPassInp');
if (adminPassInp) adminPassInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdminLogin(); });

const btnAuditLog = document.getElementById('btnAuditLog');
if (btnAuditLog) {
  btnAuditLog.addEventListener('click', async () => {
    const tok = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (!tok) { alert('Login Admin dulu untuk melihat log login & audit.'); return; }
    try {
      const r = await fetch(`${CF_API_BASE}/api/events?limit=40`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' });
      const d = await r.json();
      if (!r.ok || !d.ok) { alert('Gagal memuat audit log.'); return; }
      pushClientLog(2, `=== AUDIT CLOUDFLARE D1 (${(d.events || []).length} event terakhir) ===`);
      for (const ev of (d.events || []).slice().reverse()) {
        const dt = new Date(ev.ts).toLocaleString('id-ID', { hour12: false });
        const lvl = ev.detail.includes('FAILED') || ev.category === 'FAULT' ? 1 : 2;
        pushClientLog(lvl, `[${dt}][${ev.category}][${ev.actor}@${ev.ip}] ${ev.detail}`);
      }
    } catch {
      alert('Gagal menghubungi Cloudflare Audit API.');
    }
  });
}

if (IS_LOCAL) {
  setAdminRole(true);
  if (btnAdminAuth) btnAdminAuth.style.display = 'none';
  setInterval(pollStatus, 250);
  setInterval(pollLogs, 500);
  pollStatus();
  pollLogs();
} else {
  // On GitHub Pages: pure zero-setup MQTT mode + Public Read-Only until Admin logs in
  ['btnHeaderFlash', 'btnReconnect', 'btnWebSerial', 'btnJsonl', 'presetSelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  verifySavedAdminToken();
  connectMqtt(DEFAULT_MQTT_CFG);
}
