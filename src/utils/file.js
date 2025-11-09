const fs = require('fs');
const os = require('os');
const path = require('path');

function expandTilde(p) {
  if (!p) return p;
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  }
}

function readJSONSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const data = fs.readFileSync(file, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function writeJSONSecure(file, obj) {
  const dir = path.dirname(file);
  ensureDirSync(dir);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}

module.exports = { expandTilde, ensureDirSync, readJSONSafe, writeJSONSecure };

