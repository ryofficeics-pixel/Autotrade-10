# Task: Migrate and continue AUTOTRADE 10 (paper trading bot, Gate USDT-M futures)

## 0. Read first
- `README.md` — setup, strategy, rev2 changes, backtest, API key behavior.
- `index.html` — the whole app: engine (`<script id="engine">`), UI (`<script id="ui">`), backtest.
- `api/_proxy.js`, `api/gate.js`, `server.js` — read-only proxy to Gate API v4.
- `tests/` — unit, e2e (with chaos mode), backtest-vs-live, proxy, and Playwright UI tests.
- `index_v1.html` — previous version, kept for diff reference only. Do not run it.

## 1. Hard constraints (never violate)
- PAPER ONLY. No code path may place, modify, or cancel an order. The proxy must keep its allowlist: market data endpoints plus `futures/usdt/accounts` and `wallet/fee`. Do not add any order endpoint.
- API keys are optional and read-only. Secret must never leave the browser: signing (HMAC-SHA512) stays client-side. Do not log, store in state, export, or send the secret.
- No claim of profitability. Parameters in rev2 are unvalidated. Any report must say so.
- Keep the app a single `index.html` plus the Node proxy. No build step, no framework, no new runtime dependencies without a clear reason.
- Keep all parameters in `DEFAULT_CFG` and make them user-configurable.

## 2. Current state (rev2)
- Defaults: margin $5, leverage 5x, SL 2%, TP 4%, time stop 120 min, max 6 trades/day, daily loss stop $2, pause 120 min after 3 consecutive SL, universe top 30 by 24h volume (>= $50M), spread <= 0.05%, ATR(5m) between 0.25% and 1.0%.
- Denylist: meme coins plus non-crypto perps (XAU, XAG, QQQ, NVDA, MU, SNDK, SKHY, ANT, ...). The ANT entry is uncertain; verify it against Gate contract metadata.
- Backtest v1 (90 days, 173 trades, old defaults): net -0.93 USDT, winrate 35.8%, PF 0.96. 96% of trades exited by time stop. Fees (3.96) exceeded gross (3.02). Shorts were profitable, longs were not. Non-crypto symbols lost money. Rev2 was made in response; its results are NOT yet measured on real data.
- Test status: all passing on synthetic data (unit 18, e2e, chaos, backtest-vs-live, proxy, UI x3).

## 3. Migration steps
1. Make sure `.gitignore` excludes `node_modules`, `*.zip`, and any local DB or cache files.
2. Environment: this project was built on Linux. The user works on Windows with PowerShell. Fix first:
   - `tests/ui_test.py`, `tests/api_ui_test.py`, `tests/bt_ui_test.py` contain hardcoded `/home/claude/...` and `/tmp/...` paths. Replace with repo-relative paths using `pathlib`.
   - Any `python3` call in docs or scripts should also work as `py` on Windows.
   - Verify `node server.js` and `node tests/unit.test.js` run in PowerShell.
3. Install test deps: `pip install playwright` then `playwright install chromium`.
4. Run the full suite and confirm it is green before changing logic:
   - `node tests/unit.test.js`
   - `node tests/proxy.test.js`
   - `node tests/e2e.test.js "" 3 10`
   - `node tests/e2e.test.js "" 13 10` with `CHAOS=1`
   - `node tests/backtest.test.js "" 7 20`
   - start `node server.js`, then run the three Playwright UI tests
5. Report the results. If anything fails here, fix the environment issue, not the test expectations.

## 4. Development tasks (in this order)
1. **Verify Gate facts against the live API** from an environment that can reach it. Check: `futures/usdt/contracts` fields (`quanto_multiplier`, `order_size_min`, `funding_interval`, `funding_next_apply`, `in_delisting`, `status`, `type`), `futures/usdt/tickers` fields (`volume_24h_quote`, `highest_bid`, `lowest_ask`, `funding_rate`), `futures/usdt/candlesticks` (max 2000 points; `from`/`to` behavior; `sum` as quote volume), `futures/usdt/funding_rate` (`t`, `r`), and `wallet/fee` (`futures_taker_fee`, `futures_maker_fee`). Record exact results in `DESIGN.md`. Fix any mismatch.
2. **Denylist from metadata:** replace the hand-written non-crypto list with a check against contract metadata if Gate exposes a usable field. If not, keep the list, document how it was built, and make it visible in the UI.
3. **Grid search + walk-forward** (main open item):
   - Grid: SL in {1, 1.5, 2, 3}%, TP in {1.5, 2, 3, 4}% with TP >= 2x SL, time stop in {60, 120, 240} min.
   - Walk-forward: optimize on the first ~2/3 of the period, test on the last ~1/3. Report in-sample and out-of-sample side by side.
   - Select nothing based on the out-of-sample period. Show the full grid as a table.
   - Keep it cancellable and non-blocking (yield to the event loop).
4. **Optional filter: BTC trend.** Add `btcTrendFilter` (off by default). When on, long only if BTC 4h EMA is up, short only if down. Must work identically in live and backtest, and needs a test.
5. **Report honesty:** the backtest result panel must show trade count, a warning if trades < 100, and a warning if the period is < 60 days. Go-live stays `NOT READY` unless the README criteria pass on out-of-sample data.
6. Update `README.md` and `DESIGN.md` with every parameter decision and its evidence level (`validated` / `unvalidated`).

## 5. Working rules
- Small commits, one per task. Run the full test suite before each commit.
- Do not weaken or delete a failing test to make it pass. If a test encodes a wrong assumption, fix the assumption and explain it in the commit message.
- When a finding is uncertain, state the evidence level. Do not present a backtest on synthetic data as evidence.
- If a Gate endpoint or field cannot be verified, stop and report it. Do not guess.

## 6. Definition of done for this session
- Full test suite green on Windows (PowerShell).
- Gate endpoint assumptions recorded and verified, or explicitly listed as unverified.
- Grid + walk-forward implemented and run on real Gate history if reachable; otherwise the code is ready and the run command is documented.
- A short summary: what changed, what passed, what is unverified, and the single next step.
