# Reliable Puppeteer + Chromium runtime using the official image
FROM ghcr.io/puppeteer/puppeteer:24

WORKDIR /app

# Avoid downloading browsers during npm install; base image already includes one
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    SKIP_BROWSER_INSTALL=1

COPY package*.json ./
# Use npm install instead of npm ci to tolerate lockfile drift
RUN npm install --omit=dev

COPY . .

# Default command (Render Worker can use the image CMD)
CMD ["node", "codex-auto-login.js"]
