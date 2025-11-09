const imaps = require('imap-simple');
const { ENV } = require('../models/env');
const { info } = require('../views/logger');
const { maskEmail } = require('../views/logger');
const { sleep } = require('../utils/helpers');

async function fetchVerificationCodeViaIMAP({ timeoutMs = ENV.VERIFICATION_TIMEOUT_MS, pollIntervalMs = 5000 } = {}) {
  const sinceDate = new Date(Date.now() - Math.max(5 * 60 * 1000, timeoutMs));

  const config = {
    imap: {
      user: ENV.IMAP_USER,
      password: ENV.IMAP_PASS,
      host: ENV.IMAP_HOST,
      port: ENV.IMAP_PORT,
      tls: ENV.IMAP_TLS,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false },
    },
  };

  if (!ENV.IMAP_HOST || !ENV.IMAP_USER || !ENV.IMAP_PASS) {
    throw new Error('IMAP configuration missing (IMAP_HOST/IMAP_USER/IMAP_PASS).');
  }

  info(`Connecting IMAP ${ENV.IMAP_HOST}:${ENV.IMAP_PORT} as ${maskEmail(ENV.IMAP_USER)} (TLS=${ENV.IMAP_TLS})`);
  const connection = await imaps.connect(config);
  try {
    await connection.openBox('INBOX');

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const searchCriteria = ['UNSEEN', ['SINCE', sinceDate]];
      const fetchOptions = { bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)', 'TEXT'], markSeen: true };
      const results = await connection.search(searchCriteria, fetchOptions).catch(() => []);

      results.sort((a, b) => {
        const da = new Date((a.parts.find(p => p.which.startsWith('HEADER'))?.body?.date || [])[0] || 0).getTime();
        const db = new Date((b.parts.find(p => p.which.startsWith('HEADER'))?.body?.date || [])[0] || 0).getTime();
        return db - da;
      });

      for (const res of results) {
        const headerPart = res.parts.find(p => p.which.startsWith('HEADER'));
        const textPart = res.parts.find(p => p.which === 'TEXT');

        const from = ((headerPart?.body?.from || [])[0] || '').toLowerCase();
        const subject = ((headerPart?.body?.subject || [])[0] || '').toLowerCase();
        const body = String(textPart?.body || '');

        const fromOk = !ENV.IMAP_FROM_FILTER || from.includes(ENV.IMAP_FROM_FILTER.toLowerCase());
        const subjectOk = !ENV.IMAP_SUBJECT_FILTER || subject.includes(ENV.IMAP_SUBJECT_FILTER.toLowerCase());
        if (!fromOk || !subjectOk) continue;

        const cleaned = body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
        const preferred = cleaned.match(/(^|\D)(\d{6})(?=\D|$)/);
        const fallback = cleaned.match(/(^|\D)(\d{4,8})(?=\D|$)/);
        const code = (preferred && preferred[2]) || (fallback && fallback[2]) || null;
        if (code) {
          info(`Verification code received via IMAP (length=${code.length}).`);
          return code;
        }
      }

      await sleep(pollIntervalMs);
    }

    throw new Error('Timed out waiting for verification email via IMAP.');
  } finally {
    try { await connection.end(); } catch {}
  }
}

module.exports = { fetchVerificationCodeViaIMAP };

