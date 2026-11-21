// End-to-end: engine vs mock Gate API on synthetic market, fake clock, + independent re-check of every trade.
const assert = require('assert');
const { loadAT } = require('./load');
const AT = loadAT(process.argv[2] || require('path').join(__dirname,'..','index.html'));

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
  const tk = n => ({ contract: n, last: String(px(n)), highest_bid: String(px(n) * 0.99998), lowest_ask: String(px(n) * 1.00002), volume_24h_quote: '900000000', funding_rate: '0.0001' });
  if (path === 'futures/usdt/tickers') return q.contract ? [tk(q.contract)] : SYMS.map(s => tk(s[0]));
  if (path === 'futures/usdt/order_book') { const p = px(q.contract); return { asks: [{ p: String(p * 1.00002), s: 10 }], bids: [{ p: String(p * 0.99998), s: 10 }] }; }
  if (path === 'futures/usdt/candlesticks') { const iv = { '1m': 1, '5m': 5, '15m': 15 }[q.interval]; assert.ok(iv, 'interval'); assert.ok(q.limit <= 2000); return agg(q.contract, iv, Number(q.limit)); }
  throw new Error('unknown path ' + path);
}

(async () => {
  const cfg = { ...AT.DEFAULT_CFG, minVol24hM: 50, denylist: '' };
  let eng = AT.createEngine({ api, now, cfg });
  const CHAOS = process.env.CHAOS === '1';
  const end = T0 + (WARM + DAYS * 24 * 60) * M1;
  let maxOpen = 0, opens = 0, prevPos = null;
  const openLog = [];
  while (clock < end) {
    await eng.tick();
    const p = eng.state.position;
    if (p && (!prevPos || p.openedAt !== prevPos.openedAt)) { opens++; openLog.push({ at: clock, day: AT.utcDay(clock), dayPnlBefore: eng.state.day.pnl, dayTrades: eng.state.day.trades, p: JSON.parse(JSON.stringify(p)) }); }
    prevPos = p;
    maxOpen = Math.max(maxOpen, p ? 1 : 0);
    clock += 10000;
    if (CHAOS && rnd() < 0.002) {
      // simulasi tab tidur 1–90 menit + reload halaman (state lewat JSON)
      clock += Math.floor(1 + rnd() * 90) * M1;
      const saved = JSON.parse(JSON.stringify(eng.state));
      eng = AT.createEngine({ api, now, cfg, state: saved });
      prevPos = eng.state.position; // objek baru, bukan entry baru
    }
  }
  const st = eng.state, trades = st.trades;
  const S = eng.stats();
  console.log('ticks done; api calls', calls, 'trades', trades.length, 'open now', !!st.position, 'errors', st.errors);
  console.log('reasons', JSON.stringify(S.reasons), 'net', S.total.toFixed(3), 'balance', st.balance.toFixed(3), 'pf', S.pf, 'mdd', S.mdd.toFixed(3));
  assert.strictEqual(st.errors, 0, 'engine errors: ' + st.logs.filter(l => l.k === 'e').map(l => l.m).slice(0, 3).join(' | '));
  assert.ok(trades.length >= 5, 'too few trades to validate: ' + trades.length);

  // invariant: saldo = modal + Σ net
  const sum = trades.reduce((a, t) => a + t.net, 0);
  assert.ok(Math.abs(st.balance - (cfg.startBalance + sum)) < 1e-9, 'balance invariant');

  // invariant: tidak ada trade overlap
  for (let i = 1; i < trades.length; i++) assert.ok(trades[i].openedAt >= trades[i - 1].closedAt, 'overlap');

  // invariant: per hari ≤ maxTradesDay, tidak buka setelah day pnl ≤ -stop
  const perDay = {};
  for (const o of openLog) {
    perDay[o.day] = (perDay[o.day] || 0) + 1;
    assert.ok(perDay[o.day] <= cfg.maxTradesDay, 'max trades/day');
    assert.ok(o.dayPnlBefore > -cfg.dailyLossStop, 'opened after daily loss stop');
  }
  // invariant: tidak buka saat jeda SL beruntun
  let consec = 0, pauseUntil = 0;
  for (let i = 0; i < trades.length; i++) {
    if (i > 0) assert.ok(trades[i].openedAt >= pauseUntil, 'opened during pause');
    const t = trades[i];
    if (t.reason === 'SL' || t.reason === 'LIQ') consec++; else consec = 0;
    if (consec >= cfg.consecSLPause) { pauseUntil = t.closedAt + cfg.pauseMin * M1; consec = 0; }
  }

  // re-check independen: exit tiap trade dihitung ulang dari data 1m
  let checked = 0;
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i], o = openLog[i].p;
    assert.strictEqual(o.symbol, t.symbol);
    const arr = data[t.symbol];
    const e0 = Math.floor(o.openedAt / M1) * M1;
    const deadline = o.openedAt + o.timeStopMin * M1;
    let exp = null, exitT = 0;
    for (let k = idxAt(e0); k < arr.length; k++) {
      const c = arr[k], tMs = c.t * 1000;
      exitT = tMs;
      if (tMs >= deadline) { exp = { reason: 'TIME', px: c.o }; break; }
      const isE = tMs === e0, s = o.side;
      const slHit = s === 1 ? c.l <= o.sl : c.h >= o.sl;
      const tpHit = !isE && (s === 1 ? c.h >= o.tp : c.l <= o.tp);
      if (slHit) {
        if (!isE && (s === 1 ? c.o <= o.sl : c.o >= o.sl)) exp = (s === 1 ? c.o <= o.liq : c.o >= o.liq) ? { reason: 'LIQ', px: o.liq } : { reason: 'SL', px: c.o };
        else exp = { reason: 'SL', px: o.sl };
        break;
      }
      if (tpHit) { exp = { reason: 'TP', px: o.tp }; break; }
    }
    assert.ok(exp, 'no expected exit');
    assert.strictEqual(t.reason, exp.reason, `trade ${i} reason`);
    const expExit = exp.px * (1 - o.side * cfg.slippagePct / 100);
    assert.ok(Math.abs(t.exit - expExit) / expExit < 1e-12, `trade ${i} exit price`);
    // PnL recompute
    const gross = o.side * (expExit - o.entry) * o.qty * o.mult;
    const fees = o.entryFee + (t.reason === 'LIQ' ? 0 : o.qty * o.mult * expExit * cfg.takerFeePct / 100);
    const net = t.reason === 'LIQ' ? -o.margin - o.entryFee + Math.min(0, t.funding) : gross - fees + t.funding;
    assert.ok(Math.abs(t.net - net) < 1e-9, `trade ${i} net`);
    // entry = ask/bid saat entry ± slippage
    const k0 = idxAt(o.openedAt);
    const ref = arr[k0].c * (o.side === 1 ? 1.00002 : 0.99998);
    assert.ok(Math.abs(o.entry - ref * (1 + o.side * cfg.slippagePct / 100)) / o.entry < 1e-12, `trade ${i} entry`);
    assert.ok(o.notional <= cfg.marginUsd * cfg.leverage + 1e-9 && o.notional >= cfg.marginUsd * cfg.leverage * cfg.minNotionalRatio, 'notional range');
    // entry hanya di 8–240 dtk setelah batas 5m (scan)
    const age = o.openedAt % 300000;
    assert.ok(age >= 8000 && age <= 240000, 'entry timing');
    // funding: hitung jumlah settlement 8 jam yang dilewati
    const expClosed = exp.reason === 'TIME' ? exitT : exitT + M1;
    assert.ok(t.closedAt <= expClosed && t.closedAt >= exitT, `trade ${i} closedAt`);
    const settles = [];
    for (let f = Math.ceil(o.openedAt / 28800000) * 28800000; f <= exitT; f += 28800000) if (f > o.openedAt) settles.push(f);
    const expF = -o.side * o.notional * 0.0001 * settles.length;
    assert.ok(Math.abs(t.funding - expF) < 1e-12, `trade ${i} funding ${t.funding} vs ${expF}`);
    checked++;
  }
  console.log('independently verified trades:', checked, '| funding-applied trades:', trades.filter(t => t.funding !== 0).length);
  console.log('E2E PASS');
})().catch(e => { console.error('E2E FAIL', e); process.exit(1); });
