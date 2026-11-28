// Cloudflare Worker: SolarTracker History (D1) + Server-Side Admin Auth API
// Deployed at: https://solartracker-api.zakyazhari393.workers.dev

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Ingest-Key',
  'Cache-Control': 'no-store'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

async function issueToken(env, user) {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `${user}.${exp}`;
  const sig = await hmacHex(env.TOKEN_SECRET, payload);
  return `${payload}.${sig}`;
}

async function verifyToken(env, token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [user, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  const expected = await hmacHex(env.TOKEN_SECRET, `${user}.${expStr}`);
  return safeEqual(sig, expected) ? { user, exp } : null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/health' && request.method === 'GET') {
      return json({ ok: true, service: 'solartracker-api', ts: Date.now() });
    }

    // 1. Admin Login (Server-Side Credential Verification)
    if (path === '/api/auth/login' && request.method === 'POST') {
      try {
        const body = await request.json();
        const okUser = safeEqual((body.username || '').trim(), env.ADMIN_USER);
        const okPass = safeEqual(body.password || '', env.ADMIN_PASS);
        if (!okUser || !okPass) return json({ ok: false, error: 'Username atau password salah.' }, 401);
        const token = await issueToken(env, env.ADMIN_USER);
        return json({ ok: true, role: 'admin', user: env.ADMIN_USER, token });
      } catch {
        return json({ ok: false, error: 'Payload tidak valid.' }, 400);
      }
    }

    // 2. Verify Existing Admin Session Token
    if (path === '/api/auth/verify' && request.method === 'GET') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const valid = await verifyToken(env, token);
      if (!valid) return json({ ok: false }, 401);
      return json({ ok: true, role: 'admin', user: valid.user });
    }

    // 3. Telemetry History Ingest (Authenticated from ESP32 via X-Ingest-Key)
    if (path === '/api/ingest' && request.method === 'POST') {
      const key = request.headers.get('X-Ingest-Key') || '';
      if (!safeEqual(key, env.INGEST_KEY)) return json({ ok: false, error: 'Unauthorized' }, 401);
      try {
        const j = await request.json();
        const ts = Date.now();
        const dev = String(j.mqtt?.dev || j.dev || 'rig1').slice(0, 24);
        const faultsStr = Array.isArray(j.faults) ? j.faults.join(',') : '';

        await env.DB.prepare(
          `INSERT INTO telemetry_history
           (ts, dev, l1_raw, l1_mv, l1_pct, l2_raw, l2_mv, l2_pct, srv_deg, srv_mode, dec, delta, rssi, temp_c, heap, bo, faults)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          ts, dev,
          j.l1?.raw ?? 0, j.l1?.mv ?? 0, j.l1?.pct ?? 0,
          j.l2?.raw ?? 0, j.l2?.mv ?? 0, j.l2?.pct ?? 0,
          j.srv?.deg ?? 90, String(j.srv?.mode || 'AUTO').slice(0, 12),
          String(j.dec || 'HOLD').slice(0, 24), j.delta ?? 0,
          j.wifi?.rssi ?? 0, j.tempC ?? 0, j.heap ?? 0, j.bo ?? 0, faultsStr.slice(0, 160)
        ).run();

        // Opportunistic retention prune (> 30 days)
        if (Math.random() < 0.02) {
          const cutoff = ts - 30 * 24 * 60 * 60 * 1000;
          await env.DB.prepare('DELETE FROM telemetry_history WHERE ts < ?').bind(cutoff).run();
        }
        return json({ ok: true, ts });
      } catch (err) {
        return json({ ok: false, error: String(err) }, 400);
      }
    }

    // 4. Public Read-Only History Query (1h | 24h | 7d)
    if (path === '/api/history' && request.method === 'GET') {
      const dev = (url.searchParams.get('dev') || 'rig1').slice(0, 24);
      const range = url.searchParams.get('range') || '24h';
      const rangeMap = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3 };
      const windowMs = rangeMap[range] || 86400e3;
      const since = Date.now() - windowMs;

      const { results } = await env.DB.prepare(
        `SELECT ts, l1_raw, l1_pct, l2_raw, l2_pct, srv_deg, delta, rssi, temp_c, bo, faults
         FROM telemetry_history WHERE dev = ? AND ts >= ? ORDER BY ts ASC LIMIT 3000`
      ).bind(dev, since).all();

      const rows = results || [];
      const maxPts = 240;
      let points = rows;
      if (rows.length > maxPts) {
        const step = rows.length / maxPts;
        points = [];
        for (let i = 0; i < maxPts; i++) points.push(rows[Math.floor(i * step)]);
        if (points[points.length - 1] !== rows[rows.length - 1]) points.push(rows[rows.length - 1]);
      }

      let sum1 = 0, sum2 = 0, maxTemp = 0, maxBo = 0;
      for (const r of rows) {
        sum1 += r.l1_pct || 0;
        sum2 += r.l2_pct || 0;
        if ((r.temp_c || 0) > maxTemp) maxTemp = r.temp_c;
        if ((r.bo || 0) > maxBo) maxBo = r.bo;
      }

      return json({
        ok: true,
        dev,
        range,
        total: rows.length,
        summary: {
          avgL1: rows.length ? Math.round(sum1 / rows.length) : 0,
          avgL2: rows.length ? Math.round(sum2 / rows.length) : 0,
          maxTemp: Math.round(maxTemp * 10) / 10,
          maxBo
        },
        points: points.map(r => ({
          ts: r.ts, p1: r.l1_pct, p2: r.l2_pct, r1: r.l1_raw, r2: r.l2_raw,
          deg: r.srv_deg, rssi: r.rssi, tempC: r.temp_c
        }))
      });
    }

    return json({ ok: false, error: 'Not found' }, 404);
  }
};
