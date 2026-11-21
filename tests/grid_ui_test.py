import os
# UI grid + walk-forward (+ filter BTC 4h aktif): mock histori Gate.
import json, math, time, random
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
from pathlib import Path
OUT = Path(__file__).resolve().parent / 'out'
OUT.mkdir(exist_ok=True)
random.seed(3)
NOW = int(time.time()); DAYS = 93
COINS = {'AAA_USDT': 50.0, 'BBB_USDT': 2.0, 'CCC_USDT': 800.0}
SHORT1M = 'CCC_USDT'  # 1m hanya 20 hari terakhir
start = (NOW // 60) * 60 - DAYS * 86400
bars = {}
for c, p in COINS.items():
    arr = []; t = start; drift = 0
    while t <= NOW:
        if (t // 60) % 240 == 0: drift = random.gauss(0, 0.0004)
        o = p; p = o * (1 + drift + random.gauss(0, 0.0012))
        arr.append((t, o, max(o, p) * 1.0005, min(o, p) * 0.9995, p, 1e5 * math.exp(random.gauss(0, 0.5)) * (4 if random.random() < 0.03 else 1)))
        t += 60
    bars[c] = arr
def agg5(arr):
    out = {}
    for t, o, h, l, cl, v in arr:
        k = t // 300 * 300
        if k not in out: out[k] = [k, o, h, l, cl, v]
        else: x = out[k]; x[2] = max(x[2], h); x[3] = min(x[3], l); x[4] = cl; x[5] += v
    return [tuple(x) for x in out.values()]
bars5 = {c: agg5(a) for c, a in bars.items()}
reqs = {'1m': 0, '5m': 0, '4h': 0, 'fund': 0}
def handle(route):
    q = {k: v[0] for k, v in parse_qs(urlparse(route.request.url).query).items()}
    path = q['path']
    if path == 'futures/usdt/contracts':
        body = [{'name': c, 'quanto_multiplier': '0.01' if p > 100 else ('0.1' if p > 10 else '1'), 'order_size_min': 1, 'status': 'trading', 'in_delisting': False, 'funding_interval': 28800, 'funding_next_apply': NOW // 28800 * 28800 + 28800} for c, p in COINS.items()]
    elif path == 'futures/usdt/tickers':
        body = [{'contract': c, 'last': str(bars[c][-1][4]), 'highest_bid': str(bars[c][-1][4] * 0.9999), 'lowest_ask': str(bars[c][-1][4] * 1.0001), 'volume_24h_quote': '900000000', 'funding_rate': '0.0001'} for c in COINS]
    elif path == 'futures/usdt/candlesticks':
        c, iv, f, t = q['contract'], q['interval'], int(q['from']), int(q['to'])
        assert 'limit' not in q
        reqs[iv] += 1
        if iv == '4h':
            assert c == 'BTC_USDT'
            sel = [(k, 100 + i, 101 + i, 99 + i, 100 + i, 1.0) for i, k in enumerate(range(f // 14400 * 14400, t + 1, 14400))]
            body = [{'t': x[0], 'o': str(x[1]), 'h': str(x[2]), 'l': str(x[3]), 'c': str(x[4]), 'v': 1, 'sum': '1'} for x in sel]
            return route.fulfill(status=200, content_type='application/json', body=json.dumps(body))
        src = bars[c] if iv == '1m' else bars5[c]
        lim = NOW - 20 * 86400 if (iv == '1m' and c == SHORT1M) else 0
        sel = [x for x in src if f <= x[0] <= t and x[0] >= lim]
        assert len(sel) <= 2000, len(sel)
        body = [{'t': x[0], 'o': str(x[1]), 'h': str(x[2]), 'l': str(x[3]), 'c': str(x[4]), 'v': 1, 'sum': str(x[5])} for x in sel]
    elif path == 'futures/usdt/funding_rate':
        reqs['fund'] += 1
        f, t = int(q['from']), int(q['to'])
        body = [{'t': k, 'r': '0.0001'} for k in range((f // 28800 + 1) * 28800, t + 1, 28800)]
    else:
        body = []
    route.fulfill(status=200, content_type='application/json', body=json.dumps(body))
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None); pg = b.new_page(viewport={'width': 1200, 'height': 900})
    pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.route('**/api/gate**', handle)
    pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    pg.goto('http://localhost:8787/'); pg.evaluate('localStorage.clear()'); pg.reload()
    pg.evaluate("document.querySelectorAll('details').forEach(d => d.open = true)")
    pg.fill('#btCoins', '3'); pg.fill('#btDays', '30'); pg.fill('#c_btcTrendFilter', '1'); pg.click('#bSave')
    pg.click('#bBtGrid')
    pg.wait_for_function("/^(Grid selesai|Grid gagal)/.test(document.getElementById('btStatus').textContent)", timeout=480000)
    st = pg.inner_text('#btStatus'); print('status:', st); print('requests:', reqs)
    res = pg.inner_text('#btRes'); print(res[:700].replace('\n', ' | '))
    assert st.startswith('Grid selesai'), st
    assert reqs['4h'] >= 1, 'BTC 4h tidak diambil'
    assert pg.locator('#btRes tbody tr').count() == 18
    assert 'NOT READY' in res and '(< 60)' in res and '(< 100)' in res  # 30 hari, sedikit trade: peringatan wajib muncul
    assert 'belum divalidasi' in res and 'tidak dipakai memilih' in res
    assert 'Trade OOS' in res and 'IS trade' in res and 'OOS trade' in res
    assert pg.inner_text('#kpis').find('20.00') >= 0, 'paper state touched'
    pg.screenshot(path=str(OUT / 'grid_ui.png'), full_page=True)
    b.close()
print('errors', errors); assert not errors
print('GRID UI PASS')
