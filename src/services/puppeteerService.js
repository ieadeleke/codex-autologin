const { ENV } = require('../models/env');
const path = require('path');
const { execFile } = require('child_process');
const { info, warn } = require('../views/logger');

let puppeteer; // lazy load (puppeteer or puppeteer-extra)

async function ensurePuppeteer() {
  if (puppeteer) return puppeteer;
  try {
    const ppe = require('puppeteer-extra');
    try {
      const stealth = require('puppeteer-extra-plugin-stealth')();
      ppe.use(stealth);
      info('Using puppeteer-extra with stealth plugin.');
    } catch (e) {
      warn('puppeteer-extra-plugin-stealth not available; continuing without stealth.');
    }
    puppeteer = ppe;
  } catch (e) {
    puppeteer = require('puppeteer');
    warn('puppeteer-extra not available; using puppeteer.');
  }
  return puppeteer;
}

function resolveCacheDir() {
  if (process.env.PUPPETEER_CACHE_DIR && process.env.PUPPETEER_CACHE_DIR.trim()) {
    return process.env.PUPPETEER_CACHE_DIR;
  }
  // Use project-local cache so the build slug contains the browser
  const localDefault = path.join(process.cwd(), '.cache', 'puppeteer');
  process.env.PUPPETEER_CACHE_DIR = localDefault;
  return localDefault;
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

  if (!puppeteer) await ensurePuppeteer();
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
    if (/Could not find Chrome/i.test(msg) || /executable file not found/i.test(msg) || /Browser was not found at the configured executablePath/i.test(msg)) {
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

function framesList(page) {
  const frames = [];
  try { frames.push(page); } catch {}
  try { for (const f of page.frames()) frames.push(f); } catch {}
  return frames;
}

async function findInput(page, candidates) {
  const frames = framesList(page);
  for (const frame of frames) {
    for (const sel of candidates) {
      try {
        const el = await frame.$(sel);
        if (el) return el;
      } catch {}
    }
  }
  return null;
}

async function waitForAnySelector(page, selectors = [], timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = await findInput(page, selectors);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function clickByText(page, texts = []) {
  const lc = texts.map((t) => t.toLowerCase());
  const frames = framesList(page);
  for (const frame of frames) {
    const handles = await frame.$$('button, input[type=submit], a, [role=button]');
    for (const h of handles) {
      const label = (await frame.evaluate((el) => (el.innerText || el.value || '').trim(), h)).toLowerCase();
      if (lc.some((t) => label.includes(t))) {
        try { await h.click(); return true; } catch {}
      }
    }
    // Fallback with XPath contains search (case-insensitive)
    for (const t of lc) {
      const xp = `//*[contains(translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${t}')]`;
      try {
        const els = await frame.$x(xp);
        for (const el of els) {
          try { await el.click(); return true; } catch {}
        }
      } catch {}
    }
  }
  return false;
}

async function dismissConsents(page) {
  const candidates = [
    'accept all', 'accept', 'agree', 'allow all', 'i agree', 'ok', 'got it', 'only essential', 'continue', 'yes', 'save and accept'
  ];
  // Try several times; banners can be async
  for (let i = 0; i < 5; i++) {
    const clicked = await clickByText(page, candidates);
    if (clicked) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function domSnapshot(page, limit = 1200) {
  try {
    const url = page.url();
    const title = await page.title().catch(() => '');
    const text = await page.evaluate(() => (document.body && document.body.innerText) || '').catch(() => '');
    const frames = [];
    try {
      for (const f of page.frames()) {
        try { frames.push({ url: f.url(), name: f.name && f.name() }); } catch {}
      }
    } catch {}
    const trimmed = String(text).replace(/\s+/g, ' ').slice(0, limit);
    return { url, title, text: trimmed, frames };
  } catch {
    return null;
  }
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

module.exports = { launchBrowser, findInput, clickByText, bindTokenSniffer, waitForAnySelector, dismissConsents, domSnapshot };
