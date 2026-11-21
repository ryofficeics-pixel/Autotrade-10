const assert = require('assert');
const { loadAT } = require('./load');
const AT = loadAT(process.argv[2] || require('path').join(__dirname,'..','index.html'));
const cfg = { ...AT.DEFAULT_CFG };
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok', name); };
const deq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

t('default cfg valid', () => assert.strictEqual(AT.validateCfg(cfg).length, 0));
t('cfg rejects leverage 20, margin 0, liq<=sl, dailyLoss 0', () => {
  assert.ok(AT.validateCfg({ ...cfg, leverage: 20 }).length);
  assert.ok(AT.validateCfg({ ...cfg, marginUsd: 0 }).length);
  assert.ok(AT.validateCfg({ ...cfg, liqPct: 1.5 }).length);
  assert.ok(AT.validateCfg({ ...cfg, dailyLossStop: 0 }).length);
  assert.ok(AT.validateCfg({ ...cfg, slPct: NaN }).length);
});

t('ema matches manual', () => {
  const v = [1, 2, 3, 4, 5, 6];
  const e = AT.ema(v, 3);
  assert.ok(Number.isNaN(e[1]));
  near(e[2], 2);
  near(e[3], 4 * 0.5 + 2 * 0.5);
  near(e[4], 5 * 0.5 + 3 * 0.5);
});

t('atr wilder', () => {
  const c = [{ h: 10, l: 9, c: 9.5 }, { h: 11, l: 9.5, c: 10.5 }, { h: 10.8, l: 10, c: 10.2 }, { h: 12, l: 10.1, c: 11.9 }];
  const a = AT.atr(c, 2);
  near(a[2], (1.5 + 0.8) / 2);
  near(a[3], (a[2] * 1 + 1.9) / 2);
});

t('parseCandles drops open candle, dedupes, sorts, string fields', () => {
  const now = 1000 * 600 + 30000;
  const raw = [{ t: 600, o: '1', h: '2', l: '0.5', c: '1.5', sum: '100' }, { t: 300, o: '1', h: '1', l: '1', c: '1', sum: '5' }, { t: 300, o: '9', h: '9', l: '9', c: '9', sum: '9' }];
  const r = AT.parseCandles(raw, 300000, now);
  assert.strictEqual(r.all.length, 2);
  assert.strictEqual(r.closed.length, 1);
  assert.strictEqual(r.closed[0].t, 300);
  assert.strictEqual(r.all[1].h, 2);
});

t('baseOf strips 1000 prefix', () => {
  assert.strictEqual(AT.baseOf('1000PEPE_USDT'), 'PEPE');
  assert.strictEqual(AT.baseOf('BTC_USDT'), 'BTC');
});

t('universe filters', () => {
  const contracts = [
    { name: 'BTC_USDT', quanto_multiplier: '0.0001', order_size_min: 1, status: 'trading', in_delisting: false, type: 'direct', funding_next_apply: 1, funding_interval: 28800 },
    { name: 'ETH_USDT', quanto_multiplier: '0.01', order_size_min: 1, status: 'trading', in_delisting: false },
    { name: 'DOGE_USDT', quanto_multiplier: '10', order_size_min: 1, status: 'trading' },
    { name: 'OLD_USDT', quanto_multiplier: '1', order_size_min: 1, status: 'delisting', in_delisting: true },
    { name: 'THIN_USDT', quanto_multiplier: '1', order_size_min: 1, status: 'trading' },
    { name: 'WIDE_USDT', quanto_multiplier: '1', order_size_min: 1, status: 'trading' },
  ];
  const tk = (c, v, b, a) => ({ contract: c, volume_24h_quote: String(v), highest_bid: String(b), lowest_ask: String(a), funding_rate: '0.0001' });
  const tickers = [tk('BTC_USDT', 9e9, 90000, 90000.1), tk('ETH_USDT', 5e9, 3000, 3000.01), tk('DOGE_USDT', 2e9, 0.1, 0.10001), tk('OLD_USDT', 1e9, 1, 1.0001), tk('THIN_USDT', 1e6, 1, 1.0001), tk('WIDE_USDT', 1e9, 1, 1.01), tk('NOCONTRACT_USDT', 1e9, 1, 1.0001)];
  const u = AT.buildUniverse(contracts, tickers, cfg);
  assert.strictEqual(u.map(x => x.contract).join(), "BTC_USDT,ETH_USDT");
  near(u[0].mult, 0.0001);
  assert.strictEqual(AT.buildUniverse(contracts, tickers, { ...cfg, topN: 1 }).length, 1);
});

t('sizing long: fill at ask+slip, SL/TP %, $25 target', () => {
  const p = AT.sizePosition({ symbol: 'X_USDT', side: 1, bid: 99.99, ask: 100, mult: 0.01, sizeMin: 1, now: 0 }, cfg);
  near(p.entry, 100 * 1.0005);
  assert.strictEqual(p.qty, Math.floor(25 / (p.entry * 0.01)));
  near(p.notional, p.qty * p.entry * 0.01);
  assert.ok(p.notional <= 25);
  near(p.sl, p.entry * (1 - cfg.slPct / 100)); near(p.tp, p.entry * (1 + cfg.tpPct / 100)); near(p.liq, p.entry * (1 - cfg.liqPct / 100));
  near(p.margin, p.notional / 5);
  near(p.entryFee, p.notional * 0.0005);
});

t('sizing short: fill at bid-slip', () => {
  const p = AT.sizePosition({ symbol: 'X_USDT', side: -1, bid: 100, ask: 100.01, mult: 0.01, sizeMin: 1, now: 0 }, cfg);
  near(p.entry, 100 * 0.9995);
  near(p.sl, p.entry * (1 + cfg.slPct / 100)); near(p.tp, p.entry * (1 - cfg.tpPct / 100));
});

t('sizing rejects contract too big / notional too small', () => {
  assert.ok(AT.sizePosition({ symbol: 'B', side: 1, bid: 99999, ask: 100000, mult: 0.001, sizeMin: 1, now: 0 }, cfg).err); // 1 contract = $100
  assert.ok(AT.sizePosition({ symbol: 'B', side: 1, bid: 13.9, ask: 14, mult: 1, sizeMin: 1, now: 0 }, cfg).err); // 1 contract $14 = 0.56 < 0.6
});

const P = AT.sizePosition({ symbol: 'X', side: 1, bid: 99.99, ask: 100, mult: 0.1, sizeMin: 1, now: 0 }, cfg);
t('checkCandle long: SL, TP, both→SL, gap SL at open, gap LIQ', () => {
  assert.strictEqual(AT.checkCandle(P, { o: 100, h: 101, l: 99, c: 100 }, false), null);
  deq(AT.checkCandle(P, { o: 100, h: 100, l: P.sl, c: 97 }, false), { reason: 'SL', px: P.sl });
  deq(AT.checkCandle(P, { o: 100, h: P.tp, l: 99, c: 107 }, false), { reason: 'TP', px: P.tp });
  assert.strictEqual(AT.checkCandle(P, { o: 100, h: P.tp + 1, l: P.sl - 1, c: 100 }, false).reason, 'SL');
  deq(AT.checkCandle(P, { o: P.sl - 1, h: P.sl - 0.5, l: P.sl - 2, c: P.sl - 1 }, false), { reason: 'SL', px: P.sl - 1 });
  deq(AT.checkCandle(P, { o: P.liq - 1, h: P.liq, l: P.liq - 2, c: P.liq - 1 }, false), { reason: 'LIQ', px: P.liq });
});
t('checkCandle entry candle: TP ignored, SL counted at SL price', () => {
  assert.strictEqual(AT.checkCandle(P, { o: 100, h: P.tp + 1, l: 99, c: 100 }, true), null);
  deq(AT.checkCandle(P, { o: P.sl - 5, h: 100, l: P.sl - 5, c: 100 }, true), { reason: 'SL', px: P.sl });
});
t('checkCandle short mirrors', () => {
  const S = AT.sizePosition({ symbol: 'X', side: -1, bid: 100, ask: 100.01, mult: 0.1, sizeMin: 1, now: 0 }, cfg);
  assert.strictEqual(AT.checkCandle(S, { o: 100, h: S.sl, l: 99, c: 100 }, false).reason, 'SL');
  assert.strictEqual(AT.checkCandle(S, { o: 100, h: 101, l: S.tp, c: 100 }, false).reason, 'TP');
});

t('closeTrade PnL long SL ≈ -$1 minus costs on $25', () => {
  const p = AT.sizePosition({ symbol: 'X', side: 1, bid: 99.99, ask: 100, mult: 0.25 / 100.05 * 100, sizeMin: 1, now: 0 }, cfg);
  // force exact $25 notional with qty 1
  p.qty = 1; p.mult = 25 / p.entry; p.notional = 25; p.entryFee = 25 * 0.0005; p.margin = 5;
  const tr = AT.closeTrade(p, p.sl, 'SL', 1);
  near(tr.exit, p.sl * 0.9995);
  near(tr.gross, (p.sl * 0.9995 - p.entry) * p.mult);
  near(tr.gross, -25 * (1 - (1 - cfg.slPct / 100) * 0.9995), 1e-9);
  near(tr.net, tr.gross - 25 * 0.0005 - 1 * p.mult * tr.exit * 0.0005);
  assert.ok(tr.net < -0.5 && tr.net > -0.56, String(tr.net));
  const tp = AT.closeTrade(p, p.tp, 'TP', 1);
  assert.ok(tp.net > 0.9 && tp.net < 1.0, String(tp.net));
});
t('closeTrade short sign + funding', () => {
  const s = AT.sizePosition({ symbol: 'X', side: -1, bid: 100, ask: 100.01, mult: 0.1, sizeMin: 1, now: 0 }, cfg);
  s.fundingPnl = 0.01;
  const tr = AT.closeTrade(s, s.tp, 'TP', 1);
  assert.ok(tr.gross > 0);
  near(tr.net, tr.gross - tr.fees + 0.01);
  const lq = AT.closeTrade(s, s.liq, 'LIQ', 1);
  near(lq.net, -s.margin - s.entryFee);
});

t('stats', () => {
  const trs = [{ net: 2, reason: 'TP' }, { net: -1, reason: 'SL' }, { net: -1, reason: 'SL' }, { net: 2, reason: 'TP' }, { net: -0.5, reason: 'TIME' }];
  const S = AT.stats(trs, cfg);
  assert.strictEqual(S.n, 5); near(S.total, 1.5); near(S.winrate, 0.4); near(S.pf, 4 / 2.5); near(S.exp, 0.3); near(S.mdd, 2);
  deq({ ...S.reasons }, { TP: 2, SL: 2, TIME: 1 });
  assert.strictEqual(S.ready, false);
  const S0 = AT.stats([], cfg); assert.strictEqual(S0.ready, false); assert.ok(Number.isNaN(S0.pf));
});

// synthetic signal: 15m uptrend, 5m pullback to EMA20 then bullish volume candle
function mk(n, start, step, iv) { const a = []; let p = start; for (let i = 0; i < n; i++) { const o = p; p = p + step; a.push({ t: i * iv, o, h: Math.max(o, p) + 0.02, l: Math.min(o, p) - 0.02, c: p, vq: 1000 }); } return a; }
t('evalSignal long fires on constructed pattern', () => {
  const c15 = mk(120, 100, 0.05, 900);
  const c5 = mk(100, 100, 0.01, 300);
  const f = AT.ema(c5.map(x => x.c), 20);
  const j = c5.length - 1;
  // last candle: dips to EMA then closes above, volume 3x
  const e = f[j - 1];
  c5[j] = { t: j * 300, o: e + 0.005, l: e - 0.01, h: e + 0.08, c: e + 0.07, vq: 3000 };
  const s = AT.evalSignal(c15, c5, { ...cfg, minAtrPct: 0 });
  assert.strictEqual(s.side, 1);
  assert.strictEqual(s.ok, true, s.why);
  // same but low volume → reject
  c5[j].vq = 1200;
  assert.strictEqual(AT.evalSignal(c15, c5, { ...cfg, minAtrPct: 0 }).why, 'volume rendah');
  // bearish close → reject
  c5[j] = { ...c5[j], vq: 3000, o: e + 0.07, c: e + 0.005 };
  assert.strictEqual(AT.evalSignal(c15, c5, { ...cfg, minAtrPct: 0 }).why, 'tidak konfirmasi');
});
t('evalSignal rejects high ATR and flat data', () => {
  const c15 = mk(120, 100, 0.05, 900);
  const c5 = mk(100, 100, 0.01, 300).map(x => ({ ...x, h: x.h + 3, l: x.l - 3 }));
  assert.strictEqual(AT.evalSignal(c15, c5, cfg).why, 'ATR tinggi');
  assert.strictEqual(AT.evalSignal(c15.slice(0, 10), c5, cfg).why, 'data kurang');
});


// ---- BTC trend filter, grid, honesty (rev3) ----
const mkB = (arr) => arr.map((c, i) => ({ t: i * 14400, o: c, h: c, l: c, c, vq: 1 }));
t('btcTrend: up/down/flat/insufficient (fail closed)', () => {
  assert.strictEqual(AT.btcTrend(mkB(Array.from({ length: 80 }, (_, i) => 100 + i)), cfg), 1);
  assert.strictEqual(AT.btcTrend(mkB(Array.from({ length: 80 }, (_, i) => 200 - i)), cfg), -1);
  assert.strictEqual(AT.btcTrend(mkB(Array(80).fill(100)), cfg), 0);
  assert.strictEqual(AT.btcTrend(mkB([1, 2, 3]), cfg), 0);
  assert.strictEqual(AT.btcTrend(null, cfg), 0);
});
t('cfg btcTrendFilter default OFF + validation', () => {
  assert.strictEqual(AT.DEFAULT_CFG.btcTrendFilter, 0);
  assert.ok(AT.validateCfg({ ...cfg, btcTrendFilter: 2 }).length);
  assert.ok(AT.validateCfg({ ...cfg, btcEmaSlow: 10, btcEmaFast: 20 }).length);
});
t('evalSignal BTC filter: blocks opposite/0/undefined, allows same side; OFF ignores BTC', () => {
  // cari jendela dengan sinyal ok (filter off) pada seri tren naik bergelombang
  let found = null;
  for (let seed = 1; seed < 60 && !found; seed++) {
    let s = seed, p = 100; const r = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const c5 = [], c15 = [];
    for (let i = 0; i < 400; i++) { const o = p; p = o * (1 + (r() - 0.45) * 0.004); c5.push({ t: i * 300, o, h: Math.max(o, p) * 1.0008, l: Math.min(o, p) * 0.9992, c: p, vq: 1e5 * (r() < 0.3 ? 3 : 1) }); }
    for (let i = 0; i < 134; i++) { const b = c5.slice(i * 3, i * 3 + 3); if (b.length < 3) break; c15.push({ t: i * 900, o: b[0].o, h: Math.max(...b.map(x => x.h)), l: Math.min(...b.map(x => x.l)), c: b[2].c, vq: 0 }); }
    for (let j = 220; j < 399 && !found; j++) { const a = c5.slice(0, j + 1), b = c15.slice(0, Math.floor((j + 1) / 3)); const sg = AT.evalSignal(b, a, { ...cfg, minAtrPct: 0, maxAtrPct: 100 }); if (sg.ok) found = { a, b, side: sg.side }; }
  }
  assert.ok(found, 'butuh jendela sinyal');
  const on = { ...cfg, minAtrPct: 0, maxAtrPct: 100, btcTrendFilter: 1 }, off = { ...on, btcTrendFilter: 0 };
  assert.ok(AT.evalSignal(found.b, found.a, off, -found.side).ok, 'OFF: BTC diabaikan');
  assert.ok(AT.evalSignal(found.b, found.a, on, found.side).ok, 'searah lolos');
  for (const bad of [-found.side, 0, undefined]) { const r = AT.evalSignal(found.b, found.a, on, bad); assert.ok(!r.ok && r.why === 'filter BTC'); }
});
t('gridCombos: TP >= 2*SL, 18 kombinasi, sesuai spesifikasi', () => {
  const g = AT.gridCombos();
  assert.strictEqual(g.length, 18);
  assert.ok(g.every(c => c.tpPct >= 2 * c.slPct && [1, 1.5, 2, 3].includes(c.slPct) && [60, 120, 240].includes(c.timeStopMin)));
});
t('reportWarnings: <100 trade, <60 hari, selalu disclaimer; goLiveOOS butuh >=60 hari', () => {
  const w = AT.reportWarnings(50, 30, cfg).join(' ');
  assert.ok(/< 100/.test(w) && /< 60/.test(w) && /belum divalidasi/.test(w));
  const w2 = AT.reportWarnings(150, 90, cfg).join(' ');
  assert.ok(!/< 100/.test(w2) && !/< 60/.test(w2));
  assert.strictEqual(AT.goLiveOOS({ ready: true }, 59), false);
  assert.strictEqual(AT.goLiveOOS({ ready: false }, 90), false);
  assert.strictEqual(AT.goLiveOOS({ ready: true }, 90), true);
  assert.strictEqual(AT.goLiveOOS(null, 90), false);
});
console.log(`\n${pass} unit tests passed`);
