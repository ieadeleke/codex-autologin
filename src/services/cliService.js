const { execFile } = require('child_process');
const { ENV } = require('../models/env');
const { warn } = require('../views/logger');

function runCLI(args, opts = {}) {
  return new Promise((resolve) => {
    const bin = ENV.CODEX_CLI_BIN;
    execFile(bin, args, { timeout: 20000, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err && err.code ? err.code : 0, err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function codexWhoAmI() {
  const res = await runCLI(['whoami']);
  const text = (res.stdout + '\n' + res.stderr).toLowerCase();
  const success = res.code === 0 && !/not\s+logged\s+in|expired|invalid|unauthorized|error/.test(text);
  return { success, raw: res.stdout || res.stderr, code: res.code };
}

async function discoverLoginURL() {
  if (ENV.CODEX_LOGIN_URL) return ENV.CODEX_LOGIN_URL;
  const candidates = [
    ['login', '--print-url'],
    ['login', '--show-url'],
    ['login', '--url'],
  ];
  for (const args of candidates) {
    const r = await runCLI(args);
    const text = (r.stdout || r.stderr || '').trim();
    const maybeURL = (text.match(/https?:\/[\w\-.~:?#\[\]@!$&'()*+,;=%/]+/i) || [])[0];
    if (maybeURL) return maybeURL;
  }
  warn('Could not discover login URL from CLI. Falling back to https://auth.openai.com/login');
  return 'https://auth.openai.com/login';
}

module.exports = { runCLI, codexWhoAmI, discoverLoginURL };
