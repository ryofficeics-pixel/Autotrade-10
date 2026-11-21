# AUTOTRADE 10 — DESIGN & EVIDENCE LOG (PAPER ONLY)

Evidence levels: **validated** = measured on real Gate history, out-of-sample, ≥100 trades, ≥60 days. **unvalidated** = everything else. As of this file, **no parameter is validated.** No profitability claim is made.

## 1. Gate API facts — UNVERIFIED (task 1)
Run from the cloud session: `api.gateio.ws` returned HTTP 403 from the egress proxy, so nothing below could be checked live. Not guessed. What the code *assumes* (and where):

| Endpoint | Assumed fields | Used in | Status |
|---|---|---|---|
| `futures/usdt/contracts` | `name, quanto_multiplier, order_size_min, funding_interval, funding_next_apply, in_delisting, status, type` | `buildUniverse`, sizing, funding | unverified |
| `futures/usdt/tickers` | `contract, last, volume_24h_quote, highest_bid, lowest_ask, funding_rate` | universe/spread filter | unverified |
| `futures/usdt/candlesticks` | `t,o,h,l,c,v,sum`; max 2000 pts; `from`/`to` (no `limit` with from/to); `sum` = quote volume | `parseCandles`, `fetchBars` | unverified |
| `futures/usdt/funding_rate` | `t, r` | backtest funding | unverified |
| `wallet/fee` | `futures_taker_fee, futures_maker_fee` | optional fee sync | unverified |

Mock tests only prove self-consistency with these assumptions, not Gate behavior.
**To verify:** run from a reachable machine, e.g. `curl "https://api.gateio.ws/api/v4/futures/usdt/contracts" | head`, compare field names/types, paste results here.

## 2. Denylist (task 2) — metadata check NOT done
Contract metadata could not be inspected, so it is unknown whether Gate exposes a usable field (e.g. `type`) separating crypto from non-crypto perps. Kept the hand-written list (`denylist` in `DEFAULT_CFG`, editable and visible in "Setelan strategi"). Built from v1 backtest losers (XAG, QQQ, HYPE) plus judgment; `ANT` is uncertain. Evidence: unvalidated.

## 3. Grid + walk-forward (task 3)
`AT.runGrid(series, cfg, {startMs,endMs,btc4h,cancelled,onGridProgress})`
- Grid: SL {1,1.5,2,3}% × TP {1.5,2,3,4}% (TP ≥ 2×SL) × time stop {60,120,240} = **18** combos.
- IS = first 2/3 of period, OOS = last 1/3; both reported for every combo; full table in UI.
- `bestIS` = max IS net only. OOS never selects. Cancellable; yields to event loop per combo and inside `runBacktest`.
- **Not yet run on real data** (network). Run: UI → Backtest → "Grid + walk-forward" (needs `node server.js` reachable to Gate).
- Caveat: IS/OOS windows reuse indicator warm-up from earlier data; one regime per OOS slice; universe has survivorship bias.

## 4. BTC trend filter (task 4)
`btcTrendFilter` (0/1, default **0**), `btcEmaFast=20`, `btcEmaSlow=50` on 4h closed candles of `BTC_USDT`. Long only if EMA fast > slow, short only if <. Flat/insufficient/failed data ⇒ no entry (fail closed). One shared function `btcTrend` is used by live scan and backtest (last 200 bars). Tests: unit (up/down/flat/insufficient, evalSignal gating), backtest live-vs-backtest parity with `BTCF=up|down` (all trades on the correct side, 0 outcome mismatches), UI test. Effect on performance: **unvalidated**.

## 5. Report honesty (task 5)
Backtest and grid panels show trade count, warning if < 100 trades, warning if period < 60 days, and an unvalidated disclaimer. Single backtest Go-live is always **NOT READY**. Grid panel go-live: only the IS-selected combo's **OOS** stats, only if README criteria (≥100 trades, expectancy > 0, PF ≥ 1.3, max DD ≤ $5) pass **and** total period ≥ 60 days; even then "candidate, manual review".

## 6. Parameters
| Parameter | Default | Evidence |
|---|---|---|
| marginUsd / leverage | 5 / 5x | unvalidated |
| slPct / tpPct / timeStopMin | 2 / 4 / 120 | unvalidated (rev2 reaction to v1; v1: 173 trades, net −0.93, PF 0.96, 96% TIME exits) |
| maxTradesDay / dailyLossStop | 6 / $2 | unvalidated |
| consecSLPause / pauseMin | 3 / 120 | unvalidated |
| topN / minVol24hM / maxSpreadPct | 30 / 50 / 0.05 | unvalidated |
| minAtrPct / maxAtrPct | 0.25 / 1.0 | unvalidated |
| EMA 20/50 (15m), pullback 0.3%, volMult 1.5 | — | unvalidated |
| takerFeePct / slippagePct | 0.05 / 0.05 | assumed; fee verifiable via `wallet/fee` (unverified) |
| btcTrendFilter | 0 | unvalidated |
| gl* criteria | 100 / 1.3 / $5 | policy, not evidence |

Backtest v1 numbers come from the task brief (real data, old defaults); rev2 and everything after are measured only on synthetic data.

## 7. Windows
Commands in README work in PowerShell syntax; only Linux execution was verified in this session.
