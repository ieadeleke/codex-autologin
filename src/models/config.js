const { expandTilde, readJSONSafe, writeJSONSecure } = require('../utils/file');
const { ENV } = require('./env');

function detectTokenKey(config) {
  if (!config || typeof config !== 'object') return ENV.CODEX_TOKEN_KEY;
  const candidates = ['token', 'access_token', 'accessToken', 'cliToken'];
  for (const k of candidates) {
    if (k in config && typeof config[k] === 'string') return k;
  }
  return ENV.CODEX_TOKEN_KEY;
}

function getConfigToken() {
  const configPath = expandTilde(ENV.CODEX_CONFIG_PATH);
  const cfg = readJSONSafe(configPath);
  if (!cfg) return null;
  const key = detectTokenKey(cfg);
  return cfg[key] || null;
}

function saveConfigToken(newToken) {
  const configPath = expandTilde(ENV.CODEX_CONFIG_PATH);
  const cfg = readJSONSafe(configPath) || {};
  const key = detectTokenKey(cfg);
  cfg[key] = newToken;
  cfg.updatedAt = new Date().toISOString();
  writeJSONSecure(configPath, cfg);
}

module.exports = { detectTokenKey, getConfigToken, saveConfigToken };

