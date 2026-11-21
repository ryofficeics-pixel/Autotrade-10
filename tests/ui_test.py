import os
import json, math, time, sys
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
from pathlib import Path
OUT = Path(__file__).resolve().parent / 'out'
OUT.mkdir(exist_ok=True)

NOW = time.time()
def candles(contract, interval, limit):
    iv = {'1m': 60, '5m': 300, '15m': 900}[interval]
    last = int(NOW // iv) * iv
    out = []
    for k in range(limit - 1, -1, -1):
        t = last - k * iv
        p = 100 + 2 * math.sin(t / 7000)
        out.append({'t': t, 'o': str(p), 'h': str(p * 1.001), 'l': str(p * 0.999), 'c': str(p * 1.0002), 'v': 10, 'sum': '100000'})
    return out

def handle(route):
    q = {k: v[0] for k, v in parse_qs(urlparse(route.request.url).query).items()}
    path = q.get('path')
    if path == 'futures/usdt/contracts':
        body = [{'name': n, 'quanto_multiplier': '0.1', 'order_size_min': 1, 'status': 'trading', 'in_delisting': False, 'funding_next_apply': int(NOW // 28800 + 1) * 28800, 'funding_interval': 28800} for n in ['AAA_USDT', 'BBB_USDT']]
    elif path == 'futures/usdt/tickers':
        body = [{'contract': n, 'last': '100', 'highest_bid': '99.999', 'lowest_ask': '100.001', 'volume_24h_quote': '900000000', 'funding_rate': '0.0001'} for n in ['AAA_USDT', 'BBB_USDT']]
        if q.get('contract'): body = body[:1]
    elif path == 'futures/usdt/order_book':
        body = {'asks': [{'p': '100.001', 's': 5}], 'bids': [{'p': '99.999', 's': 5}]}
    elif path == 'futures/usdt/candlesticks':
        body = candles(q['contract'], q['interval'], int(q['limit']))
    else:
        return route.fulfill(status=400, content_type='application/json', body='{"label":"BAD_PATH"}')
    route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

opened = int((NOW - 30 * 60) * 1000)
state = {
  'v': 1, 'balance': 20.98, 'position': {
    'symbol': 'AAA_USDT', 'side': 1, 'qty': 2, 'mult': 0.1, 'entry': 100.05, 'ref': 100, 'notional': 20.01, 'margin': 4.002, 'entryFee': 0.010005,
    'sl': 96.048, 'tp': 108.054, 'liq': 82.041, 'takerFeePct': 0.05, 'slippagePct': 0.05, 'timeStopMin': 240, 'openedAt': opened,
    'fundingPnl': 0, 'fundingRate': 0.0001, 'nextFunding': int(NOW // 28800 + 1) * 28800, 'fundingInterval': 28800, 'lastClosedT': None, 'mark': 100.05, 'signal': None},
  'trades': [
    {'symbol': 'BBB_USDT', 'side': 1, 'qty': 2, 'entry': 100, 'exit': 108, 'notional': 20, 'openedAt': opened - 9e6, 'closedAt': opened - 8e6, 'reason': 'TP', 'gross': 1.6, 'fees': 0.02, 'funding': 0, 'net': 1.58},
    {'symbol': 'AAA_USDT', 'side': -1, 'qty': 2, 'entry': 100, 'exit': 104, 'notional': 20, 'openedAt': opened - 7e6, 'closedAt': opened - 6e6, 'reason': 'SL', 'gross': -0.8, 'fees': 0.02, 'funding': 0.2, 'net': -0.6}],
  'day': {'key': time.strftime('%Y-%m-%d', time.gmtime(NOW)), 'trades': 1, 'pnl': 0},
  'consecSL': 0, 'pauseUntil': 0, 'lastScanBoundary': 0, 'lastBlockLog': 0, 'universe': [], 'universeAt': 0, 'errors': 0, 'logs': []}

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
    for w, name in [(1280, 'desk'), (390, 'phone')]:
        pg = b.new_page(viewport={'width': w, 'height': 900})
        pg.on('console', lambda m: m.type in ('error',) and errors.append(m.text))
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.route('**/api/gate**', handle)
        pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
        pg.goto('http://localhost:8787/')
        pg.evaluate("s => localStorage.setItem('autotrade10_v1', s)", json.dumps(state))
        pg.reload()
        pg.click('#bStart')
        pg.wait_for_timeout(2500)
        status = pg.inner_text('#status'); pos = pg.inner_text('#pos'); kp = pg.inner_text('#kpis'); gl = pg.inner_text('#golive')
        logs = pg.inner_text('#log')
        print(name, '| status:', status.replace('\n', ' '))
        print(name, '| kpis:', kp.replace('\n', ' ')[:200])
        print(name, '| pos:', pos.replace('\n', ' ')[:220])
        print(name, '| golive:', gl.replace('\n', ' ')[:200])
        print(name, '| log tail:', logs.strip().split('\n')[-3:])
        sw = pg.evaluate('document.documentElement.scrollWidth')
        print(name, '| scrollWidth', sw)
        assert sw <= w + 1, 'horizontal overflow'
        pg.screenshot(path=str(OUT / f'ui_{name}.png'), full_page=True)
        # settings validation
        pg.click('summary')
        pg.fill('#c_leverage', '50'); pg.click('#bSave'); pg.wait_for_timeout(200)
        assert 'Setelan ditolak' in pg.inner_text('#log'), 'validation not shown'
        pg.click('#bStop')
        pg.click('#bReset'); pg.click('#bReset'); pg.wait_for_timeout(300)
        assert 'Tidak ada posisi' in pg.inner_text('#pos')
        assert '20.00' in pg.inner_text('#kpis')
        pg.close()
    b.close()
print('console errors:', errors)
assert not errors
print('UI PASS')
