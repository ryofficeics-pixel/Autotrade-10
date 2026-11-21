// Vercel serverless function: GET /api/gate?path=futures/usdt/tickers&...
const { proxy } = require('./_proxy');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ label: 'METHOD', message: 'GET only' }));
  }
  const { status, body } = await proxy(req.query || {}, req.headers || {});
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};
