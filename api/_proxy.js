// AUTOTRADE 10 — proxy ke Gate API v4, GET saja.
// Publik: 4 endpoint data pasar. Privat (read-only): saldo futures & fee akun.
// Tidak ada endpoint order. Secret tidak pernah dikirim ke proxy: browser hanya mengirim KEY + Timestamp + SIGN.
const BASE = 'https://api.gateio.ws/api/v4/';
const PUBLIC = new Set([
  'futures/usdt/contracts',
  'futures/usdt/tickers',
  'futures/usdt/order_book',
  'futures/usdt/candlesticks',
  'futures/usdt/funding_rate',
]);
const PRIVATE = new Set([
  'futures/usdt/accounts',
  'wallet/fee',
]);
const PATHS = new Set([...PUBLIC, ...PRIVATE]);
const PARAMS = {
  contract: /^[A-Z0-9_]{1,40}$/,
  interval: /^\d{1,2}[smhdw]$/,
  limit: /^\d{1,4}$/,
  from: /^\d{9,11}$/,
  to: /^\d{9,11}$/,
};

function hdr(headers, name) {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  const k = Object.keys(headers).find(h => h.toLowerCase() === want);
  const v = k === undefined ? undefined : headers[k];
  return Array.isArray(v) ? v[0] : v;
}

async function proxy(query, headers) {
  const path = String(query.path || '');
  if (!PATHS.has(path)) return { status: 400, body: { label: 'BAD_PATH', message: 'path tidak diizinkan' } };
  const isPrivate = PRIVATE.has(path);
  const qs = new URLSearchParams();
  if (!isPrivate) {
    for (const [k, re] of Object.entries(PARAMS)) {
      if (query[k] === undefined) continue;
      const v = String(query[k]);
      if (!re.test(v)) return { status: 400, body: { label: 'BAD_PARAM', message: 'parameter tidak valid: ' + k } };
      qs.set(k, v);
    }
  }
  const fwd = { Accept: 'application/json' };
  if (isPrivate) {
    const key = hdr(headers, 'x-gate-key'), ts = hdr(headers, 'x-gate-ts'), sign = hdr(headers, 'x-gate-sign');
    if (!/^[A-Za-z0-9]{8,128}$/.test(key || '') || !/^\d{9,11}$/.test(ts || '') || !/^[a-f0-9]{128}$/.test(sign || '')) {
      return { status: 400, body: { label: 'BAD_AUTH', message: 'header KEY/Timestamp/SIGN tidak valid' } };
    }
    fwd.KEY = key; fwd.Timestamp = ts; fwd.SIGN = sign;
  }
  const url = BASE + path + (qs.toString() ? '?' + qs.toString() : '');
  try {
    const r = await fetch(url, { headers: fwd });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { label: 'NON_JSON', message: text.slice(0, 200) }; }
    return { status: r.status, body };
  } catch (e) {
    return { status: 502, body: { label: 'UPSTREAM', message: String(e && e.message || e) } };
  }
}

module.exports = { proxy, PATHS, PUBLIC, PRIVATE };
