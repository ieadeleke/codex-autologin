const { execFile, spawn } = require('child_process');
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
  if (res.err && res.err.code === 'ENOENT') {
    // codex binary not installed or not on PATH
    return { success: false, raw: 'codex CLI not found on PATH', code: 127, missingCLI: true };
  }
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
    if (maybeURL) {
      try {
        const u = new URL(maybeURL);
        const p = (u.pathname || '').toLowerCase();
        // Avoid raw login endpoints that can trigger "Invalid client"; prefer platform login entry
        if (u.hostname === 'auth.openai.com' && (/^\/log-?in\/?$/.test(p) || /^\/login\/?$/.test(p))) {
          warn(`CLI returned ${u.href}; switching to https://platform.openai.com/login`);
          return 'https://platform.openai.com/login';
        }
      } catch {}
      return maybeURL;
    }
  }
  // Using platform.openai.com as a safer entry that issues a proper authorize URL
  warn('Could not discover login URL from CLI. Falling back to https://platform.openai.com/login');
  return 'https://platform.openai.com/login';
}

module.exports = { runCLI, codexWhoAmI, discoverLoginURL };

// Attempt to complete CLI login by supplying token either via flag or stdin.
async function codexLoginWithToken(token, { timeoutMs = 30000 } = {}) {
  const bin = ENV.CODEX_CLI_BIN;

  // Strategy 1: codex login --token <token>
  const viaArg = await new Promise((resolve) => {
    execFile(bin, ['login', '--token', token], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return resolve({ tried: true, ok: false, missingCLI: true, stdout: '', stderr: '' });
      const code = err && typeof err.code === 'number' ? err.code : 0;
      const out = String(stdout || '') + String(stderr || '');
      resolve({ tried: true, ok: code === 0, stdout: out, stderr: '' });
    });
  });
  if (viaArg.missingCLI) return { success: false, missingCLI: true };
  if (viaArg.ok) return { success: true };

  // Strategy 2: interactive: echo token into `codex login`
  const viaStdin = await new Promise((resolve) => {
    try {
      const child = spawn(bin, ['login'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let errOut = '';
      const t = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, timeoutMs);
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { errOut += d.toString(); });
      child.on('error', (e) => {
        clearTimeout(t);
        if (e && e.code === 'ENOENT') return resolve({ tried: true, ok: false, missingCLI: true, stdout: out, stderr: errOut });
        resolve({ tried: true, ok: false, stdout: out, stderr: errOut });
      });
      child.on('close', (code) => {
        clearTimeout(t);
        resolve({ tried: true, ok: code === 0, stdout: out, stderr: errOut });
      });
      // Write token followed by newline to satisfy paste prompt; flush and end
      child.stdin.write(String(token) + "\n");
      try { child.stdin.end(); } catch {}
    } catch (e) {
      resolve({ tried: true, ok: false, stdout: '', stderr: String(e && e.message ? e.message : e || '') });
    }
  });
  if (viaStdin.missingCLI) return { success: false, missingCLI: true };
  return { success: !!viaStdin.ok };
}

module.exports.codexLoginWithToken = codexLoginWithToken;
