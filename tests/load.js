const fs = require('fs');
const vm = require('vm');
function loadAT(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('engine script not found');
  const sandbox = { module: { exports: {} }, console, Date, Math, JSON, Promise, setTimeout };
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox, { filename: 'engine.js' });
  return sandbox.module.exports;
}
module.exports = { loadAT };
