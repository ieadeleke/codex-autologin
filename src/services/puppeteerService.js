const { ENV } = require('../models/env');
const path = require('path');
const { execFile } = require('child_process');
const { info, warn } = require('../views/logger');

let puppeteer; // lazy load

function resolveCacheDir() {
  if (process.env.PUPPETEER_CACHE_DIR && process.env.PUPPETEER_CACHE_DIR.trim()) {
    return process.env.PUPPETEER_CACHE_DIR;
  }
  // Prefer Render default if running there; otherwise project-local cache
  const renderDefault = '/opt/render/.cache/puppeteer';
  const localDefault = path.join(process.cwd(), '.cache', 'puppeteer');
  const chosen = process.env.RENDER ? renderDefault : localDefault;
  process.env.PUPPETEER_CACHE_DIR = chosen;
  return chosen;
}

function installChrome(cacheDir) {
  return new Promise((resolve) => {
    const env = { ...process.env, PUPPETEER_CACHE_DIR: cacheDir };
    info(`Puppeteer: installing Chrome into ${cacheDir} ...`);
    execFile(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['--yes', 'puppeteer', 'browsers', 'install', 'chrome'],
      { env, timeout: 5 * 60 * 1000 },
      (err, stdout, stderr) => {
        if (err) {
          warn(`Puppeteer browser install failed: ${stderr || err.message}`);
          resolve(false);
        } else {
          info('Puppeteer browser install completed.');
          resolve(true);
        }
      }
    );
  });
}

async function launchBrowser() {
  // Ensure a deterministic cache dir across build/runtime
  const cacheDir = resolveCacheDir();

  if (!puppeteer) puppeteer = require('puppeteer');
  const launchOpts = {
    headless: ENV.PUPPETEER_HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
  if (ENV.PUPPETEER_EXECUTABLE_PATH) launchOpts.executablePath = ENV.PUPPETEER_EXECUTABLE_PATH;
  else if (typeof puppeteer.executablePath === 'function') {
    const p = puppeteer.executablePath();
    if (p) launchOpts.executablePath = p;
  }

  try {
    return await puppeteer.launch(launchOpts);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e || '');
    if (/Could not find Chrome/i.test(msg) || /executable file not found/i.test(msg)) {
      warn('Chrome not found for Puppeteer. Attempting runtime install...');
      const ok = await installChrome(cacheDir);
      if (!ok) throw e;
      // Refresh executable path after install
      if (!ENV.PUPPETEER_EXECUTABLE_PATH && typeof puppeteer.executablePath === 'function') {
        const p = puppeteer.executablePath();
        if (p) launchOpts.executablePath = p;
      }
      return await puppeteer.launch(launchOpts);
    }
    throw e;
  }
}

async function findInput(page, candidates) {
  for (const sel of candidates) {
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}

async function clickByText(page, texts = []) {
  const lc = texts.map((t) => t.toLowerCase());
  const handles = await page.$$('button, input[type=submit], a');
  for (const h of handles) {
    const label = (await page.evaluate((el) => (el.innerText || el.value || '').trim(), h)).toLowerCase();
    if (lc.some((t) => label.includes(t))) {
      await h.click();
      return true;
    }
  }
  return false;
}

function bindTokenSniffer(page) {
  let token = null;
  let lastURL = '';
  const tokenRe = /(?:access[_-]?token|cli[_-]?token|codex[_-]?token|token)["\']?\s*[:=]\s*["\']([A-Za-z0-9._~\-+/=]{20,})["\']/i;
  const queryRe = /[?&#](?:access[_-]?token|cli[_-]?token|codex[_-]?token|token)=([A-Za-z0-9._~\-+/=]{20,})/i;

  page.on('framenavigated', (frame) => {
    try { lastURL = frame.url() || lastURL; } catch {}
  });

  page.on('response', async (res) => {
    try {
      const url = res.url();
      const ct = res.headers()['content-type'] || '';
      if (queryRe.test(url)) {
        const m = url.match(queryRe);
        if (m) token = m[1];
      }
      if (/application\/json|text\/html|text\/plain/i.test(ct)) {
        const text = await res.text();
        const m = text.match(tokenRe);
        if (m) token = m[1];
      }
    } catch {}
  });

  return {
    async waitForToken(timeoutMs = 120000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (token) return { token, source: 'network', lastURL };
        const el = await page.$(ENV.CODEX_TOKEN_SELECTOR);
        if (el) {
          const txt = (await page.evaluate((e) => e.innerText || e.textContent || '', el)) || '';
          const t = (txt.match(tokenRe) || [])[1] || (txt.match(/[A-Za-z0-9._~\-+/=]{20,}/) || [])[0];
          if (t) return { token: t, source: 'dom', lastURL };
        }
        const url = page.url();
        const m = url.match(queryRe);
        if (m) return { token: m[1], source: 'url', lastURL: url };
        await new Promise((r) => setTimeout(r, 1000));
      }
      return { token: null, source: null, lastURL };
    },
  };
}

module.exports = { launchBrowser, findInput, clickByText, bindTokenSniffer };
