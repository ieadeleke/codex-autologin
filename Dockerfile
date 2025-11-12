# Reliable Puppeteer + Chromium runtime using the official image
FROM ghcr.io/puppeteer/puppeteer:24

# Ensure working directory exists and is writable by pptruser
USER root
RUN mkdir -p /app && chown -R pptruser:pptruser /app
WORKDIR /app
USER pptruser

# Avoid downloading browsers during npm install; base image already includes one
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    SKIP_BROWSER_INSTALL=1

COPY --chown=pptruser:pptruser package*.json ./
# Prefer reproducible install; fall back if lockfile mismatched
RUN npm ci --omit=dev || npm install --omit=dev --no-package-lock

COPY --chown=pptruser:pptruser . .

# Default command (Render Worker can use the image CMD)
CMD ["node", "codex-auto-login.js"]
