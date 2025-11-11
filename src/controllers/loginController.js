const { ENV, FORCE } = require('../models/env');
const { saveConfigToken } = require('../models/config');
const { expandTilde } = require('../utils/file');
const { sleep } = require('../utils/helpers');
const { info, warn, error } = require('../views/logger');
const { codexWhoAmI, discoverLoginURL } = require('../services/cliService');
const { fetchVerificationCodeViaIMAP } = require('../services/imapService');
const { launchBrowser, findInput, clickByText, bindTokenSniffer } = require('../services/puppeteerService');

async function performLoginAndCaptureToken() {
  if (!ENV.OPENAI_EMAIL || !ENV.OPENAI_PASSWORD) {
    throw new Error('Missing OPENAI_EMAIL/OPENAI_PASSWORD in environment.');
  }

  const loginURL = await discoverLoginURL();
  info(`Launching Puppeteer (headless=${ENV.PUPPETEER_HEADLESS}).`);
  const browser = await launchBrowser();
  let context = null;
  let page = null;
  try {
    if (typeof browser.createIncognitoBrowserContext === 'function') {
      context = await browser.createIncognitoBrowserContext();
    } else if (typeof browser.createBrowserContext === 'function') {
      // Newer Puppeteer API (BiDi)
      context = await browser.createBrowserContext();
    } else if (typeof browser.defaultBrowserContext === 'function') {
      context = browser.defaultBrowserContext();
    }
  } catch {}
  if (context && typeof context.newPage === 'function') {
    page = await context.newPage();
  } else {
    // Fallback: open a page directly on the browser
    page = await browser.newPage();
    try { context = page.browserContext(); } catch {}
  }
  await page.setViewport({ width: 1280, height: 900 });
  const sniffer = bindTokenSniffer(page);

  try {
    info(`Navigating to login URL: ${loginURL}`);
    await page.goto(loginURL, { waitUntil: 'networkidle2', timeout: 120000 });

    const emailInput = await findInput(page, ['input[type=email]', 'input[name=email]', 'input#email', 'input[autocomplete=email]']);
    if (!emailInput) throw new Error('Email input not found on login page. Consider setting CODEX_LOGIN_URL.');
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(ENV.OPENAI_EMAIL, { delay: 20 });
    await clickByText(page, ['continue', 'next', 'sign in', 'log in']);
    await page.waitForNetworkIdle({ idleTime: 700, timeout: 60000 }).catch(() => {});

    const passwordInput = await findInput(page, ['input[type=password]', 'input[name=password]', 'input#password', 'input[autocomplete=current-password]']);
    if (!passwordInput) throw new Error('Password input not found after email submit.');
    await passwordInput.click({ clickCount: 3 });
    await passwordInput.type(ENV.OPENAI_PASSWORD, { delay: 20 });
    await clickByText(page, ['continue', 'next', 'sign in', 'log in']);
    await page.waitForNetworkIdle({ idleTime: 700, timeout: 60000 }).catch(() => {});

    const codeField = await findInput(page, [
      'input[name=code]',
      'input[autocomplete=one-time-code]',
      'input[type=tel]',
      'input[data-code-input]',
      'input[placeholder*="code" i]'
    ]);
    const multiInputs = await page.$$('input[autocomplete=one-time-code], input[data-code-input], input[type=tel]');

    if (codeField || (multiInputs && multiInputs.length >= 4)) {
      info('Verification code requested — polling IMAP...');
      const code = await fetchVerificationCodeViaIMAP();
      if (!code) throw new Error('No verification code received.');
      if (multiInputs && multiInputs.length >= 4) {
        const digits = String(code).replace(/\D/g, '').split('');
        for (let i = 0; i < Math.min(digits.length, multiInputs.length); i++) {
          await multiInputs[i].focus();
          await page.keyboard.type(digits[i]);
        }
      } else if (codeField) {
        await codeField.click({ clickCount: 3 });
        await codeField.type(String(code));
      }
      await clickByText(page, ['continue', 'verify', 'submit']);

      const invalid = await page.$x("//*[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'invalid code') or contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'incorrect code')]");
      if (invalid && invalid.length) {
        warn('Server indicated code was invalid. Polling for a fresh code...');
        const fresh = await fetchVerificationCodeViaIMAP();
        if (fresh && fresh !== code) {
          const allInputs = await page.$$('input');
          for (const inp of allInputs) {
            const type = await page.evaluate((el) => el.type || '', inp);
            if (/(tel|text)/i.test(type)) {
              await inp.click({ clickCount: 3 });
              await inp.type('');
            }
          }
          const single = await findInput(page, ['input[name=code]', 'input[autocomplete=one-time-code]', 'input[type=tel]']);
          if (single) {
            await single.type(String(fresh));
          } else if (multiInputs && multiInputs.length) {
            const d = String(fresh).replace(/\D/g, '').split('');
            for (let i = 0; i < Math.min(d.length, multiInputs.length); i++) {
              await multiInputs[i].focus();
              await page.keyboard.type(d[i]);
            }
          }
          await clickByText(page, ['continue', 'verify', 'submit']);
        } else {
          warn('Fresh code not obtained; continuing without retry.');
        }
      }
    }

    await page.waitForNetworkIdle({ idleTime: 1200, timeout: 120000 }).catch(() => {});
    const { token, source, lastURL } = await sniffer.waitForToken(120000);
    if (!token) {
      warn('Did not capture token from network/DOM/URL. Will attempt CLI/config verification.');
      return { token: null, source: null, lastURL };
    }
    info(`Captured token (${source}).`);
    return { token, source, lastURL };
  } finally {
    try { if (page && typeof page.close === 'function') await page.close(); } catch {}
    try { if (context && typeof context.close === 'function') await context.close(); } catch {}
    try { if (browser && typeof browser.close === 'function') await browser.close(); } catch {}
  }
}

async function main() {
  info('Checking Codex authentication status (codex whoami)...');
  let who = await codexWhoAmI();
  if (who.success && !FORCE) {
    info('Already logged in. Nothing to do.');
    return;
  }
  if (FORCE) info('Force mode enabled — proceeding to login.');
  else warn('Not logged in or token invalid — starting automated login.');

  const result = await performLoginAndCaptureToken();

  if (result.token) {
    saveConfigToken(result.token);
    info(`Token saved to ${expandTilde(ENV.CODEX_CONFIG_PATH)} with restricted permissions.`);
  } else {
    info('Attempting to verify login via codex whoami...');
  }

  who = await codexWhoAmI();
  if (who.success) {
    info('Codex login verified successfully.');
  } else {
    error('Codex login still not verified. You may need to set CODEX_LOGIN_URL or CODEX_TOKEN_SELECTOR appropriately, or re-check IMAP forwarding.');
    process.exitCode = 1;
  }
}

module.exports = { main };
