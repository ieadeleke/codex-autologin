const { ENV } = require('../models/env');

let puppeteer; // lazy load

async function launchBrowser() {
  if (!puppeteer) puppeteer = require('puppeteer');
  const launchOpts = {
    headless: ENV.PUPPETEER_HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
  if (ENV.PUPPETEER_EXECUTABLE_PATH) launchOpts.executablePath = ENV.PUPPETEER_EXECUTABLE_PATH;
  return puppeteer.launch(launchOpts);
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

