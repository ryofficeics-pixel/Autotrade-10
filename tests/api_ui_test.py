# UI: input API key, tanda tangan dicek ulang dengan hmac Python (cara SDK resmi Gate).
import json, hmac, hashlib, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
KEY, SECRET = 'testkey1234ABCD', 'testsecretXYZ7890abcdef'
seen = []
def handle(route):
    req = route.request
    path = parse_qs(urlparse(req.url).query)['path'][0]
    h = req.headers
    if path in ('futures/usdt/accounts', 'wallet/fee'):
        ts = h['x-gate-ts']
        s = '%s\n%s\n%s\n%s\n%s' % ('GET', '/api/v4/' + path, '', hashlib.sha512(b'').hexdigest(), ts)
        expect = hmac.new(SECRET.encode(), s.encode(), hashlib.sha512).hexdigest()
        ok = h['x-gate-sign'] == expect and h['x-gate-key'] == KEY and abs(int(ts) - time.time()) < 30
        seen.append((path, ok))
        if not ok: return route.fulfill(status=401, content_type='application/json', body='{"label":"INVALID_SIGNATURE","message":"bad"}')
        body = {'total': '123.45', 'available': '100.5', 'unrealised_pnl': '0', 'currency': 'USDT'} if path.endswith('accounts') else {'futures_taker_fee': '0.0005', 'futures_maker_fee': '0.0002'}
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(body))
    route.fulfill(status=200, content_type='application/json', body='[]')
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1100, 'height': 900})
    pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.route('**/api/gate**', handle)
    pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    pg.goto('http://localhost:8787/'); pg.evaluate('localStorage.clear(); sessionStorage.clear()'); pg.reload()
    pg.click('#apiBox summary')
    pg.fill('#apiKey', KEY); pg.fill('#apiSecret', SECRET)
    pg.click('#bApiSave'); pg.wait_for_timeout(200)
    ls = pg.evaluate('JSON.stringify(localStorage)'); ss = pg.evaluate('JSON.stringify(sessionStorage)')
    assert SECRET not in ls and SECRET in ss, 'not-remembered must use sessionStorage only'
    pg.click('#bApiTest'); pg.wait_for_timeout(1500)
    out = pg.inner_text('#apiOut'); print(out.replace('\n', ' | '))
    assert '123.45' in out and '0.0500%' in out, out
    assert all(ok for _, ok in seen) and len(seen) == 2, seen
    assert SECRET not in pg.inner_text('body') and 'testkey1234ABCD' not in pg.inner_text('#log')
    pg.click('#bApiFee'); pg.wait_for_timeout(200)
    assert pg.input_value('#c_takerFeePct') == '0.05'
    pg.check('#apiRemember'); pg.fill('#apiSecret', ''); pg.click('#bApiSave'); pg.wait_for_timeout(200)
    ls = pg.evaluate('JSON.stringify(localStorage)'); ss = pg.evaluate('JSON.stringify(sessionStorage)')
    assert SECRET in ls and SECRET not in ss, 'remember must move secret to localStorage'
    assert SECRET not in pg.evaluate("localStorage.getItem('autotrade10_v1') || ''"), 'secret leaked into engine state'
    pg.reload(); pg.click('#apiBox summary'); assert pg.input_value('#apiKey') == KEY and pg.input_value('#apiSecret') == ''
    pg.screenshot(path='/tmp/api_ui.png', full_page=True)
    pg.click('#bApiClear'); pg.wait_for_timeout(200)
    assert SECRET not in pg.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)')
    b.close()
print('errors', errors); assert not errors
print('API UI PASS')
