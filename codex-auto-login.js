#!/usr/bin/env node
/*
README — Codex CLI Auto Login (Local, Puppeteer + IMAP)

This tool automates Codex CLI login by driving the OpenAI login page with Puppeteer and pulling
the email verification code from a dedicated mailbox via IMAP. It detects expired/invalid tokens
via `codex whoami`, performs a headless (configurable) login, captures the resulting token via
network/URL/DOM heuristics, and saves it to your Codex config file with secure permissions.

Dependencies:
  npm i puppeteer imap-simple dotenv

Environment (.env) — required core:
  OPENAI_EMAIL=your_login_email@example.com
  OPENAI_PASSWORD=your_password

Environment — IMAP for the dedicated mailbox (forward OpenAI emails here):
  IMAP_HOST=imap.example.com
  IMAP_PORT=993
  IMAP_USER=imap-user@example.com
  IMAP_PASS=your-imap-password
  IMAP_TLS=true
  # Optional filters:
  IMAP_FROM_FILTER=openai.com
  IMAP_SUBJECT_FILTER=code
  VERIFICATION_TIMEOUT_MS=180000

Environment — Puppeteer & CLI config (optional):
  PUPPETEER_HEADLESS=true
  PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
  CODEX_CLI_BIN=codex
  CODEX_CONFIG_PATH=~/.codex/config.json
  CODEX_LOGIN_URL=...
  CODEX_TOKEN_SELECTOR=pre,code,.token,.cli-token
  CODEX_TOKEN_KEY=token

Usage:
  1) Create a dedicated mailbox and set a forward rule from your main OpenAI email to it.
  2) Put OPENAI_EMAIL/OPENAI_PASSWORD and IMAP_* in .env.
  3) Run: node automation/codex-auto-login.js

Gmail forwarding quick ref:
  Settings → See all settings → Forwarding and POP/IMAP → add forwarding address → confirm.
  Create a filter for From containing "openai.com" or Subject containing "verification code" → forward.

CLI options:
  --force   Force re-login even if whoami is valid
  --headful Run Puppeteer with a visible browser
*/

const { main } = require('./src/controllers/loginController');

main().catch((err) => {
  // Keep entrypoint minimal; let controller log most details
  console.error('[ERROR]', err && err.message ? err.message : String(err));
  process.exitCode = 1;
});
