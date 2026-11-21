// Proxy: allowlist, validasi, header auth hanya diteruskan untuk endpoint privat.
const assert = require('assert');
const { proxy } = require('../api/_proxy');
const calls = [];
global.fetch = async (url, opt) => { calls.push({ url, headers: opt.headers }); return { status: 200, text: async () => '{"ok":true}' }; };
const S = 'a'.repeat(128);
(async () => {
  let r = await proxy({ path: 'futures/usdt/orders' }, {}); assert.strictEqual(r.status, 400);
  r = await proxy({ path: 'futures/usdt/price_orders' }, {}); assert.strictEqual(r.status, 400);
  r = await proxy({ path: 'futures/usdt/candlesticks', contract: 'btc;x' }, {}); assert.strictEqual(r.status, 400);
  r = await proxy({ path: 'futures/usdt/accounts' }, {}); assert.strictEqual(r.body.label, 'BAD_AUTH');
  r = await proxy({ path: 'futures/usdt/accounts' }, { 'x-gate-key': 'abcd1234', 'x-gate-ts': '1763712000', 'x-gate-sign': 'zz' }); assert.strictEqual(r.body.label, 'BAD_AUTH');
  assert.strictEqual(calls.length, 0);
  r = await proxy({ path: 'futures/usdt/tickers', contract: 'BTC_USDT' }, { 'x-gate-key': 'abcd1234', 'x-gate-ts': '1763712000', 'x-gate-sign': S });
  assert.strictEqual(calls[0].url, 'https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=BTC_USDT');
  assert.strictEqual(calls[0].headers.KEY, undefined, 'public must not forward key');
  r = await proxy({ path: 'futures/usdt/accounts', contract: 'BTC_USDT' }, { 'x-gate-key': 'abcd1234', 'x-gate-ts': '1763712000', 'x-gate-sign': S });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls[1].url, 'https://api.gateio.ws/api/v4/futures/usdt/accounts', 'private: no query (must match signed string)');
  assert.deepStrictEqual([calls[1].headers.KEY, calls[1].headers.Timestamp, calls[1].headers.SIGN], ['abcd1234', '1763712000', S]);
  await proxy({ path: 'wallet/fee' }, { 'X-Gate-Key': 'abcd1234', 'X-Gate-Ts': '1763712000', 'X-Gate-Sign': S });
  assert.strictEqual(calls[2].url, 'https://api.gateio.ws/api/v4/wallet/fee');
  console.log('proxy tests PASS');
})().catch(e => { console.error(e); process.exit(1); });
