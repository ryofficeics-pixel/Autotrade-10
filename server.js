// Jalankan lokal tanpa dependency:  node server.js   lalu buka http://localhost:8787
const http = require('http');
const fs = require('fs');
const path = require('path');
const { proxy } = require('./api/_proxy');

const PORT = Number(process.env.PORT) || 8787;
const INDEX = path.join(__dirname, 'index.html');

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/gate') {
    const { status, body } = await proxy(Object.fromEntries(u.searchParams), req.headers);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(body));
  }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(INDEX).pipe(res);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}).listen(PORT, () => console.log('AUTOTRADE 10 paper: http://localhost:' + PORT));
