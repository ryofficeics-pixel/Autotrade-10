// Backtest: (1) verifikasi independen tiap trade, (2) cross-check vs engine live pada data & pasar tiruan yang sama.
const assert = require('assert');
const { loadAT } = require('./load');
const AT = loadAT(process.argv[2] || require('path').join(__dirname, '..', 'index.html'));
let seed = Number(process.argv[3] || 7);
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

const M1 = 60000;
const T0 = Date.UTC(2026, 10, 1, 0, 0, 0);
const DAYS = Number(process.argv[4] || 5);
const WARM = 3 * 24 * 60; // 3 hari warm-up sebelum start
const N = WARM + DAYS * 24 * 60 + 10;
const SYMS = [['AAA_USDT', 50, 0.1], ['BBB_USDT', 2.5, 1], ['CCC_USDT', 1200, 0.001], ['DDD_USDT', 0.8, 10], ['EEE_USDT', 15, 0.1]];

const data = {};
for (const [sym, p0] of SYMS) {
  const arr = [];
  let p = p0, drift = 0, shock = 0;
  for (let i = 0; i < N; i++) {
    if (i % 240 === 0) drift = gauss() * 0.0004;
    if (rnd() < 0.0015) shock = (rnd() < 0.5 ? -1 : 1) * (0.003 + rnd() * 0.004); // dorongan beberapa menit
    if (rnd() < 0.05) shock *= 0.5;
    const o = p;
    let ret = drift + shock + gauss() * 0.0012;
    if (rnd() < 0.0004) ret += (rnd() < 0.5 ? -1 : 1) * 0.06; // gap kecil
    p = Math.max(o * (1 + ret), 1e-6);
    const h = Math.max(o, p) * (1 + Math.abs(gauss()) * 0.0007);
    const l = Math.min(o, p) * (1 - Math.abs(gauss()) * 0.0007);
    const vq = Math.exp(gauss() * 0.4) * 1e5 * (rnd() < 0.03 ? 3 + rnd() * 3 : 1);
    arr.push({ t: (T0 + i * M1) / 1000, o, h, l, c: p, vq });
  }
  data[sym] = arr;
}

let clock = T0 + WARM * M1 + 5000;
const now = () => clock;
const idxAt = ms => Math.floor((ms - T0) / M1);
let calls = 0;

function agg(sym, ivMin, limit) {
  const arr = data[sym];
  const cur = idxAt(clock);
  const out = [];
  const lastStart = Math.floor(cur / ivMin) * ivMin;
  for (let s = lastStart; s >= 0 && out.length < limit; s -= ivMin) {
    const e = Math.min(s + ivMin - 1, cur);
    let h = -Infinity, l = Infinity, vq = 0;
    for (let i = s; i <= e; i++) { h = Math.max(h, arr[i].h); l = Math.min(l, arr[i].l); vq += arr[i].vq; }
    out.push({ t: arr[s].t, o: String(arr[s].o), h: String(h), l: String(l), c: String(arr[e].c), v: 1, sum: String(vq) });
  }
  return out.reverse();
}
const px = sym => data[sym][idxAt(clock)].c;
const nextFunding = () => Math.ceil(clock / 28800000) * 28800;

async function api(path, q) {
  calls++;
  const mult = Object.fromEntries(SYMS.map(s => [s[0], s[2]]));
  if (path === 'futures/usdt/contracts') return SYMS.map(([n, , m]) => ({ name: n, quanto_multiplier: String(m), order_size_min: 1, status: 'trading', in_delisting: false, type: 'direct', funding_next_apply: nextFunding(), funding_interval: 28800 }));
  const tk = n => ({ contract: n, last: String(px(n)), highest_bid: String(px(n) * 0.9998), lowest_ask: String(px(n) * 1.0002), volume_24h_quote: '900000000', funding_rate: '0.0001' });
  if (path === 'futures/usdt/tickers') return q.contract ? [tk(q.contract)] : SYMS.map(s => tk(s[0]));
  if (path === 'futures/usdt/order_book') { const p = data[q.contract][idxAt(clock)].o; return { asks: [{ p: String(p * 1.0002), s: 10 }], bids: [{ p: String(p * 0.9998), s: 10 }] }; }
  if (path === 'futures/usdt/candlesticks') { const iv = { '1m': 1, '5m': 5, '15m': 15 }[q.interval]; assert.ok(iv, 'interval'); assert.ok(q.limit <= 2000); return agg(q.contract, iv, Number(q.limit)); }
  throw new Error('unknown path ' + path);
}


(async () => {
  const cfg = { ...AT.DEFAULT_CFG, denylist: '' };
  const startMs = T0 + WARM * M1, endMs = T0 + (WARM + DAYS * 24 * 60) * M1;
  const funding = [];
  for (let f = Math.ceil(T0 / 28800000) * 28800; f * 1000 <= endMs + 86400000; f += 28800) funding.push({ t: f, r: '0.0001' });
  const series = SYMS.map(([n, , m]) => ({ contract: n, mult: m, sizeMin: 1, baseSec: 60, base: data[n].filter(b => b.t * 1000 < endMs + 86400000), funding }));
  const bt = await AT.runBacktest(series, cfg, { startMs, endMs, halfSpreadPct: 0.02 });
  const S = bt.stats;
  console.log('backtest trades', S.n, 'reasons', JSON.stringify(S.reasons), 'net', S.total.toFixed(3), 'evals', bt.evals);
  assert.ok(S.n >= 10, 'too few trades');
  assert.ok(Math.abs(bt.balance - cfg.startBalance - S.total) < 1e-9, 'balance invariant');
  const T = bt.trades;
  for (let i = 1; i < T.length; i++) assert.ok(T[i].openedAt >= T[i - 1].closedAt, 'overlap');
  const perDay = {}, dayPnl = {};
  let consec = 0, pauseUntil = 0;
  for (const t of T) {
    const d = AT.utcDay(t.openedAt);
    perDay[d] = (perDay[d] || 0) + 1;
    assert.ok(perDay[d] <= cfg.maxTradesDay, 'max/day');
    assert.ok((dayPnl[d] || 0) > -cfg.dailyLossStop, 'daily stop');
    assert.ok(t.openedAt >= pauseUntil, 'pause');
    assert.strictEqual(t.openedAt % 300000, 8000, 'entry at boundary+8s');
    const dc = AT.utcDay(t.closedAt); dayPnl[dc] = (dayPnl[dc] || 0) + t.net;
    if (t.reason === 'SL' || t.reason === 'LIQ') consec++; else consec = 0;
    if (consec >= cfg.consecSLPause) { pauseUntil = t.closedAt + cfg.pauseMin * M1; consec = 0; }
  }
  // verifikasi independen per trade
  for (const [i, t] of T.entries()) {
    const arr = data[t.symbol], B = t.openedAt - 8000, k0 = idxAt(B);
    const side = t.side, entry = arr[k0].o * (1 + side * 0.0002) * (1 + side * 0.0005);
    assert.ok(Math.abs(t.entry - entry) / entry < 1e-12, 'entry ' + i);
    const sl = entry * (1 - side * 0.02), tp = entry * (1 + side * 0.04), liq = entry * (1 - side * 0.18), deadline = t.openedAt + 120 * M1;
    let exp = null, exitT = 0;
    for (let k = k0; k < arr.length; k++) {
      const c = arr[k], tMs = c.t * 1000; exitT = tMs;
      if (tMs >= deadline) { exp = { r: 'TIME', px: c.o, at: tMs }; break; }
      const isE = tMs === B;
      const slHit = side === 1 ? c.l <= sl : c.h >= sl, tpHit = !isE && (side === 1 ? c.h >= tp : c.l <= tp);
      if (slHit) { exp = (!isE && (side === 1 ? c.o <= sl : c.o >= sl)) ? ((side === 1 ? c.o <= liq : c.o >= liq) ? { r: 'LIQ', px: liq } : { r: 'SL', px: c.o }) : { r: 'SL', px: sl }; exp.at = tMs + M1; break; }
      if (tpHit) { exp = { r: 'TP', px: tp, at: tMs + M1 }; break; }
    }
    if (t.reason === 'END') continue;
    assert.strictEqual(t.reason, exp.r, 'reason ' + i);
    const ex = exp.px * (1 - side * 0.0005);
    assert.ok(Math.abs(t.exit - ex) / ex < 1e-12, 'exit ' + i);
    assert.strictEqual(t.closedAt, exp.at, 'closedAt ' + i);
    let nf = 0; for (const f of funding) if (f.t * 1000 > t.openedAt && f.t * 1000 <= exitT) nf++;
    assert.ok(Math.abs(t.funding - (-side * t.notional * 0.0001 * nf)) < 1e-12, 'funding ' + i);
  }
  console.log('independently verified', T.length, 'backtest trades');

  // cross-check vs engine live (mock API, tick 10 dtk)
  clock = startMs + 5000;
  const eng = AT.createEngine({ api, now, cfg });
  while (clock < endMs) { await eng.tick(); clock += 10000; }
  const L = eng.state.trades;
  const key = t => t.symbol + '@' + Math.floor(t.openedAt / 300000);
  const lm = new Map(L.map(t => [key(t), t]));
  let same = 0, diffReason = 0;
  for (const t of T) { const l = lm.get(key(t)); if (!l) continue; same++; if (l.reason !== t.reason || l.side !== t.side) diffReason++; }
  console.log('live trades', L.length, '| backtest trades', T.length, '| matched entries', same, '| outcome mismatches', diffReason);
  assert.ok(same / Math.max(T.length, L.length) >= 0.8, 'backtest vs live match too low');
  assert.ok(diffReason / Math.max(1, same) <= 0.05, 'outcome mismatch too high');
  console.log('BACKTEST PASS');
})().catch(e => { console.error('BACKTEST FAIL', e); process.exit(1); });
