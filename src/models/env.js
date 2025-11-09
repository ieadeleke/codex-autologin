const os = require('os');
const path = require('path');
const dotenv = require('dotenv');

// Load environment from .env once
dotenv.config();

const ENV = {
  OPENAI_EMAIL: process.env.OPENAI_EMAIL,
  OPENAI_PASSWORD: process.env.OPENAI_PASSWORD,
  IMAP_HOST: process.env.IMAP_HOST,
  IMAP_PORT: Number(process.env.IMAP_PORT || 993),
  IMAP_USER: process.env.IMAP_USER,
  IMAP_PASS: process.env.IMAP_PASS,
  IMAP_TLS: String(process.env.IMAP_TLS || 'true').toLowerCase() === 'true',
  IMAP_FROM_FILTER: process.env.IMAP_FROM_FILTER || 'openai.com',
  IMAP_SUBJECT_FILTER: process.env.IMAP_SUBJECT_FILTER || 'code',
  VERIFICATION_TIMEOUT_MS: Number(process.env.VERIFICATION_TIMEOUT_MS || 180000),
  PUPPETEER_HEADLESS: (() => {
    if (process.argv.includes('--headful')) return false;
    return String(process.env.PUPPETEER_HEADLESS ?? 'true').toLowerCase() !== 'false';
  })(),
  PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
  CODEX_CLI_BIN: process.env.CODEX_CLI_BIN || 'codex',
  CODEX_CONFIG_PATH: process.env.CODEX_CONFIG_PATH || path.join(os.homedir(), '.codex', 'config.json'),
  CODEX_LOGIN_URL: process.env.CODEX_LOGIN_URL,
  CODEX_TOKEN_SELECTOR: process.env.CODEX_TOKEN_SELECTOR || 'pre, code, .token, .cli-token',
  CODEX_TOKEN_KEY: process.env.CODEX_TOKEN_KEY || 'token',
};

const FORCE = process.argv.includes('--force');

module.exports = { ENV, FORCE };

